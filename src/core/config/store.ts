import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createDefaultConfig } from "./defaults.js";
import {
  ConfigConflictError,
  ConfigImportError,
  ConfigPersistenceError,
  ConfigRecoveryError,
} from "./errors.js";
import {
  cleanupTemporaryFiles,
  DEFAULT_HISTORY_RETENTION,
  ensureStorageDirectories,
  quarantineBytes,
  pruneHistory,
  readHistory,
  writeAtomicFile,
  writeHistorySnapshot,
  withStorageLock,
  type HistoryDiagnostic,
  type HistoryEntry,
  type HistoryHooks,
  type StorageFaultPoint,
} from "./history.js";
import { serializeConfig, deterministicJson } from "./serialize.js";
import { migrateConfig, migratePoolRuntimeDefaults } from "./migrations.js";
import { validateConfig, validateStoredConfig } from "./schema.js";
import { exportConfig, parseConfigImport } from "./transfer.js";
import type { ConfigV1, StoredConfigV1 } from "./types.js";

const ACTIVE_FILE = "config.json";
const CURRENT_STORAGE_VERSION = 1;
const DEFAULT_IMPORT_BYTES = 1_048_576;

export type ConfigSource = "active" | "default" | "history";

export interface ConfigSnapshot {
  readonly generation: number;
  readonly savedAt?: string;
  readonly config: ConfigV1;
  readonly source: ConfigSource;
}

export type ConfigLoadStatus = "missing" | "valid" | "recovered" | "corrupt";

export interface ConfigLoadResult {
  readonly status: ConfigLoadStatus;
  readonly snapshot?: ConfigSnapshot;
  readonly repairRequired: boolean;
  readonly diagnostics: readonly string[];
}

export interface ConfigMutationResult {
  readonly changed: boolean;
  readonly activated: boolean;
  readonly generation: number;
  readonly previousGeneration?: number;
  readonly historyPath?: string;
  readonly warnings: readonly string[];
}

export type ConfigAuditAction = "initialize" | "save" | "update" | "restore" | "import" | "recover";

export interface ConfigAuditEvent {
  readonly action: ConfigAuditAction;
  readonly generation: number;
  readonly previousGeneration?: number;
  readonly timestamp: string;
}

export interface HistoryListResult {
  readonly entries: readonly HistoryEntry[];
  readonly diagnostics: readonly HistoryDiagnostic[];
}

export interface ImportPreview {
  readonly config: ConfigV1;
  readonly changed: boolean;
  readonly before?: string;
  readonly after: string;
  readonly expectedGeneration?: number;
}

export interface StorageFaultHooks {
  readonly fault?: (point: StorageFaultPoint) => void | Promise<void>;
  readonly id?: () => string;
  readonly now?: () => string;
}

export interface ConfigStoreOptions {
  readonly root: string;
  readonly defaults?: () => ConfigV1;
  readonly clock?: () => Date;
  readonly maxImportBytes?: number;
  readonly hooks?: StorageFaultHooks;
  /** Optional no-content post-commit audit boundary; M1 provides no durable sink. */
  readonly onAudit?: (event: ConfigAuditEvent) => void | Promise<void>;
  /** Optional pure migration for old storage/config fixtures. */
  readonly migrateConfig?: (value: unknown) => unknown;
}

export type ConfigMutator = (draft: ConfigV1) => ConfigV1 | void | Promise<ConfigV1 | void>;

export class ConfigStore {
  private readonly root: string;
  private readonly defaults: () => ConfigV1;
  private readonly clock: () => Date;
  private readonly maxImportBytes: number;
  private readonly hooks: StorageFaultHooks;
  private readonly onAudit: ((event: ConfigAuditEvent) => void | Promise<void>) | undefined;
  private readonly migrateConfig: ((value: unknown) => unknown) | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ConfigStoreOptions) {
    if (!options.root) throw new ConfigPersistenceError("constructor", "root-required");
    this.root = options.root;
    this.defaults = options.defaults ?? createDefaultConfig;
    this.clock = options.clock ?? (() => new Date());
    this.maxImportBytes = options.maxImportBytes ?? DEFAULT_IMPORT_BYTES;
    this.hooks = options.hooks ?? {};
    this.onAudit = options.onAudit;
    this.migrateConfig = options.migrateConfig;
  }

  /** Read active state. This method never repairs or overwrites files. */
  load(): Promise<ConfigLoadResult> {
    return this.enqueue(() => this.loadUnlocked(), false);
  }

  /** Write defaults only when no active configuration exists. */
  initialize(config?: ConfigV1): Promise<ConfigMutationResult> {
    let candidate: ConfigV1;
    try {
      candidate = this.validateCandidate(config ?? this.defaults());
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueue(async () => {
      const active = await this.readActive();
      if (active.kind === "valid") {
        return {
          changed: false,
          activated: true,
          generation: active.stored.generation,
          previousGeneration: active.stored.generation,
          warnings: [],
        };
      }
		if (active.kind === "invalid") throw new ConfigRecoveryError("active-config-invalid");
		return this.commit(candidate, undefined, "initialize");
    });
  }

  save(config: ConfigV1, options: { readonly expectedGeneration?: number } = {}): Promise<ConfigMutationResult> {
    let candidate: ConfigV1;
    try {
      candidate = this.validateCandidate(config);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueue(async () => {
      const active = await this.readActive();
		const current = active.kind === "valid" ? active.stored : undefined;
		this.assertExpected(options.expectedGeneration, current?.generation ?? 0);
		if (active.kind === "invalid") throw new ConfigRecoveryError("active-config-invalid");
		return this.commit(candidate, current, "save");
    });
  }

  /** Apply a synchronous/async mutation to the latest queued generation. */
  update(mutator: ConfigMutator): Promise<ConfigMutationResult> {
    return this.enqueue(async () => {
      const active = await this.readActive();
      if (active.kind === "invalid") throw new ConfigRecoveryError("active-config-invalid");
      const current = active.kind === "valid" ? active.stored : undefined;
      const base = current ? structuredClone(current.config) : this.validateCandidate(this.defaults());
      const result = await mutator(base);
		const candidate = migratePoolRuntimeDefaults(this.validateCandidate(result ?? base));
      if (current && serializeConfig(current.config) === serializeConfig(candidate)) {
        return {
          changed: false,
          activated: true,
          generation: current.generation,
          previousGeneration: current.generation,
          warnings: [],
        };
      }
      return this.commit(candidate, current, "update");
    });
  }

  listHistory(): Promise<HistoryListResult> {
    return this.enqueue(() => this.readHistoryUnlocked(), false);
  }

  restore(generation: number, options: { readonly expectedGeneration?: number } = {}): Promise<ConfigMutationResult> {
    return this.enqueue(async () => {
      const active = await this.readActive();
      if (active.kind !== "valid") throw new ConfigRecoveryError("active-config-invalid");
      this.assertExpected(options.expectedGeneration, active.stored.generation);
      const history = await this.readHistoryUnlocked();
      const target = history.entries.find((entry) => entry.generation === generation);
      if (!target) throw new ConfigRecoveryError("history-generation-not-found");
      return this.commit(target.stored.config, active.stored, "restore");
    });
  }

  /** Quarantine and repair an invalid active file using the newest valid history. */
  recover(): Promise<ConfigLoadResult> {
    return this.enqueue(async () => {
      const active = await this.readActive();
      if (active.kind === "missing") return { status: "missing", repairRequired: false, diagnostics: [] };
      if (active.kind === "valid") {
        return {
          status: "valid",
          snapshot: this.snapshot(active.stored, "active"),
          repairRequired: false,
          diagnostics: [],
        };
      }
      const history = await this.readHistoryUnlocked();
      const diagnostics = history.diagnostics.map((item) => `${item.path}: ${item.message}`);
      try {
        await quarantineBytes(this.root, active.bytes, this.hooks);
      } catch (error) {
        throw this.recoveryError("quarantine-failed", error);
      }
      const target = history.entries[0];
      if (!target) throw new ConfigRecoveryError("no-valid-recovery-snapshot");
      // The corrupt active envelope may have held a generation that is no
      // longer readable. Leave a gap so recovery never reuses that identity.
      const generation = await this.nextGeneration(history.entries, true);
      const candidate = this.validateCandidate(target.stored.config);
      const savedAt = this.nowIso();
		const stored: StoredConfigV1 = { storageVersion: CURRENT_STORAGE_VERSION, generation, savedAt, config: migratePoolRuntimeDefaults(candidate) };
      try {
        await ensureStorageDirectories(this.root, this.hooks);
        const write = await writeAtomicFile(join(this.root, ACTIVE_FILE), this.serializeStored(stored), this.hooks, "active");
        const warnings = write.directorySyncWarning ? [write.directorySyncWarning] : [];
        await this.emitAudit({ action: "recover", generation, previousGeneration: target.generation, timestamp: savedAt }, warnings);
        return {
          status: "recovered",
          snapshot: this.snapshot(stored, "active"),
          repairRequired: false,
          diagnostics,
        };
      } catch (error) {
        throw this.recoveryError("recovery-write-failed", error);
      }
    });
  }

  export(): Promise<string> {
    return this.enqueue(async () => {
      const result = await this.loadUnlocked();
      if (!result.snapshot) throw new ConfigRecoveryError("no-valid-config-to-export");
      return exportConfig(result.snapshot.config);
    }, false);
  }

  previewImport(input: string | unknown): Promise<ImportPreview> {
    return this.enqueue(async () => {
      const candidate = this.parseImport(input);
      const active = await this.readActive();
      const before = active.kind === "valid" ? serializeConfig(active.stored.config) : undefined;
      const after = serializeConfig(candidate);
      return {
        config: candidate,
        changed: before !== after,
        ...(before === undefined ? {} : { before }),
        after,
        expectedGeneration: active.kind === "valid" ? active.stored.generation : 0,
      };
    }, false);
  }

  activateImport(input: string | unknown | ImportPreview, options: { readonly confirmed: boolean; readonly expectedGeneration?: number } ): Promise<ConfigMutationResult> {
    if (!options.confirmed) return Promise.reject(new ConfigImportError("confirmation-required"));
    return this.enqueue(async () => {
      const candidate = this.parseImport("config" in Object(input) && Object(input).config ? Object(input).config : input);
      const active = await this.readActive();
      const current = active.kind === "valid" ? active.stored : undefined;
      this.assertExpected(options.expectedGeneration, current?.generation ?? 0);
      if (active.kind === "invalid") throw new ConfigRecoveryError("active-config-invalid");
      return this.commit(candidate, current, "import");
    });
  }

  private enqueue<T>(operation: () => Promise<T>, lock = true): Promise<T> {
    const run = this.queue.then(() => lock ? withStorageLock(this.root, operation, this.hooks) : operation(), () => lock ? withStorageLock(this.root, operation, this.hooks) : operation());
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private validateCandidate(value: unknown): ConfigV1 {
    const migrated = this.migrateConfig
      ? this.migrateConfig(value)
      : this.currentSchemaValue(value)
        ? value
        : migrateConfig(value);
		return migratePoolRuntimeDefaults(structuredClone(validateConfig(migrated)));
  }

  private validateStored(value: unknown): StoredConfigV1 {
    if (this.isStoredEnvelope(value)) {
      const envelope = value as StoredConfigV1;
      const migratedConfig = this.migrateConfig
        ? this.migrateConfig(envelope.config)
        : this.currentSchemaValue(envelope.config)
          ? envelope.config
          : migrateConfig(envelope.config);
			return validateStoredConfig({ ...envelope, config: migratePoolRuntimeDefaults(validateConfig(migratedConfig)) });
    }
    return validateStoredConfig(value);
  }

  private async readActive(): Promise<
    | { readonly kind: "missing" }
    | { readonly kind: "valid"; readonly stored: StoredConfigV1 }
    | { readonly kind: "invalid"; readonly bytes: Buffer; readonly error: unknown }
  > {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.root, ACTIVE_FILE));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      throw this.persistenceError("active-read", "active-read-failed", error);
    }
    try {
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      return { kind: "valid", stored: this.validateStored(parsed) };
    } catch (error) {
      return { kind: "invalid", bytes, error };
    }
  }

  private async loadUnlocked(): Promise<ConfigLoadResult> {
    const active = await this.readActive();
    if (active.kind === "missing") {
      return {
        status: "missing",
        snapshot: { generation: 0, config: this.validateCandidate(this.defaults()), source: "default" },
        repairRequired: false,
        diagnostics: [],
      };
    }
    if (active.kind === "valid") {
      return { status: "valid", snapshot: this.snapshot(active.stored, "active"), repairRequired: false, diagnostics: [] };
    }
    const history = await this.readHistoryUnlocked();
    const diagnostics = [
      active.error instanceof Error ? active.error.message : "active config is invalid",
      ...history.diagnostics.map((item) => `${item.path}: ${item.message}`),
    ];
    const newest = history.entries[0];
    return {
      status: newest ? "recovered" : "corrupt",
      ...(newest ? { snapshot: this.snapshot(newest.stored, "history") } : {}),
      repairRequired: true,
      diagnostics,
    };
  }

  private async readHistoryUnlocked(): Promise<HistoryListResult> {
    return readHistory(this.root, (value) => this.validateStored(value));
  }

  private snapshot(stored: StoredConfigV1, source: ConfigSource): ConfigSnapshot {
    return { generation: stored.generation, savedAt: stored.savedAt, config: structuredClone(stored.config), source };
  }

  private serializeStored(stored: StoredConfigV1): string {
    return deterministicJson(stored);
  }

  private parseImport(input: string | unknown): ConfigV1 {
    return parseConfigImport(input, {
      maxBytes: this.maxImportBytes,
      ...(this.migrateConfig ? { migrate: this.migrateConfig } : {}),
    });
  }

  private isStoredEnvelope(value: unknown): value is StoredConfigV1 {
    return typeof value === "object" && value !== null && "storageVersion" in value && "config" in value;
  }

  private currentSchemaValue(value: unknown): boolean {
    return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { schemaVersion?: unknown }).schemaVersion === 1;
  }

  private async commit(
    candidate: ConfigV1,
    current: StoredConfigV1 | undefined,
    action: Exclude<ConfigAuditAction, "recover">,
  ): Promise<ConfigMutationResult> {
    const generation = await this.nextGeneration(current ? [current] : []);
    const savedAt = this.nowIso();
		const stored: StoredConfigV1 = { storageVersion: CURRENT_STORAGE_VERSION, generation, savedAt, config: migratePoolRuntimeDefaults(candidate) };
    await ensureStorageDirectories(this.root, this.hooks);
    let historyPath: string | undefined;
    if (current) {
      const history = await writeHistorySnapshot(this.root, current, this.serializeStored(current), this.hooks);
      historyPath = history.path;
    }
    const write = await writeAtomicFile(join(this.root, ACTIVE_FILE), this.serializeStored(stored), this.hooks, "active");
    const warnings: string[] = [];
    if (write.directorySyncWarning) warnings.push(write.directorySyncWarning);
    try {
      await pruneHistory(this.root, DEFAULT_HISTORY_RETENTION, this.hooks);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "history retention cleanup failed");
    }
    await this.emitAudit(
      { action, generation, ...(current ? { previousGeneration: current.generation } : {}), timestamp: savedAt },
      warnings,
    );
    return {
      changed: true,
      activated: true,
      generation,
      ...(current ? { previousGeneration: current.generation } : {}),
      ...(historyPath ? { historyPath } : {}),
      warnings,
    };
  }

  private async nextGeneration(
    entries: readonly HistoryEntry[] | readonly StoredConfigV1[],
    skipUnknownActive = false,
  ): Promise<number> {
    const history = await this.readHistoryUnlocked();
    let maximum = 0;
    for (const item of [...entries, ...history.entries]) maximum = Math.max(maximum, "stored" in item ? item.stored.generation : item.generation);
    if (maximum >= Number.MAX_SAFE_INTEGER) throw new ConfigPersistenceError("generation", "generation-exhausted");
    return maximum + (skipUnknownActive ? 2 : 1);
  }

  private assertExpected(expected: number | undefined, actual: number): void {
    if (expected !== undefined && expected !== actual) throw new ConfigConflictError(expected, actual);
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private async emitAudit(event: ConfigAuditEvent, warnings: string[]): Promise<void> {
    if (!this.onAudit) return;
    try {
      await this.onAudit(event);
    } catch (error) {
      warnings.push(error instanceof Error ? `audit: ${error.message}` : "audit callback failed");
    }
  }

  private persistenceError(operation: string, reasonCode: string, cause?: unknown): ConfigPersistenceError {
    const error = new ConfigPersistenceError(operation, reasonCode);
    if (cause !== undefined) Object.defineProperty(error, "cause", { value: cause, enumerable: false });
    return error;
  }

  private recoveryError(reasonCode: string, cause?: unknown): ConfigRecoveryError {
    const error = new ConfigRecoveryError(reasonCode);
    if (cause !== undefined) Object.defineProperty(error, "cause", { value: cause, enumerable: false });
    return error;
  }
}

export async function removeTemporaryStorageFiles(root: string): Promise<void> {
  await cleanupTemporaryFiles(root);
}
