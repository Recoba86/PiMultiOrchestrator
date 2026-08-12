import { readFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { ConfigConflictError, ConfigRecoveryError, ConfigValidationError } from "./errors.js";
import { migrateConfigV1ToV2 } from "./migrations.js";
import { deterministicJson, } from "./serialize.js";
import { ensureStorageDirectories, writeAtomicFile, withStorageLock, STORAGE_DIRECTORY_MODE } from "./history.js";
import { validateConfigV2, validateStoredConfig, validateStoredConfigV2 } from "./schema.js";
import type { ConfigV1, ConfigV2, StoredConfigV2 } from "./types.js";

const ACTIVE_FILE = "config.json";
const V2_ACTIVE_FILE = "config-v2.json";
const HISTORY_DIR = "history-v2";
const HISTORY_RETENTION = 20;

export interface ConfigV2Snapshot {
  readonly generation: number;
  readonly savedAt?: string;
  readonly config: ConfigV2;
  readonly source: "active" | "migrated" | "history";
}

export interface ConfigV2LoadResult {
  readonly status: "missing" | "valid" | "migrated" | "corrupt";
  readonly snapshot?: ConfigV2Snapshot;
  readonly repairRequired: boolean;
  readonly diagnostics: readonly string[];
}

export interface ConfigV2MutationResult {
  readonly changed: boolean;
  readonly generation: number;
  readonly previousGeneration?: number;
  readonly historyPath?: string;
}

/**
 * V2 persistence boundary. Legacy ConfigStore remains available for V1
 * callers; this store migrates an existing V1 config in memory and writes V2
 * only after an explicit V2 save/update.
 */
export class ConfigV2Store {
  private readonly root: string;
  private readonly activeFile: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: { readonly root: string; readonly activeFile?: string }) {
    if (!options.root) throw new TypeError("root-required");
    this.root = options.root;
    // Keep the accepted V1 ConfigStore's config.json readable while the V2
    // adapter is introduced. The legacy file is used as an import source only.
    this.activeFile = options.activeFile ?? V2_ACTIVE_FILE;
  }

  load(): Promise<ConfigV2LoadResult> { return this.enqueue(() => this.loadUnlocked(), false); }

  initialize(config: ConfigV2): Promise<ConfigV2MutationResult> {
    const candidate = validateConfigV2(config);
    return this.enqueue(async () => {
      const current = await this.readActive();
      if (current) return { changed: false, generation: current.generation, previousGeneration: current.generation };
      return this.commit(candidate, undefined);
    });
  }

  save(config: ConfigV2, options: { readonly expectedGeneration?: number } = {}): Promise<ConfigV2MutationResult> {
    const candidate = validateConfigV2(config);
    return this.enqueue(async () => {
      const current = await this.readActive();
      this.assertExpected(options.expectedGeneration, current?.generation ?? 0);
      return this.commit(candidate, current);
    });
  }

  update(mutator: (draft: ConfigV2) => ConfigV2 | void | Promise<ConfigV2 | void>): Promise<ConfigV2MutationResult> {
    return this.enqueue(async () => {
      const current = await this.readActive();
      if (!current) throw new ConfigRecoveryError("no-valid-config-to-update");
      const draft = structuredClone(current.config);
      const next = validateConfigV2((await mutator(draft)) ?? draft);
      if (deterministicJson(next) === deterministicJson(current.config)) return { changed: false, generation: current.generation, previousGeneration: current.generation };
      return this.commit(next, current);
    });
  }

  restore(generation: number, options: { readonly expectedGeneration?: number } = {}): Promise<ConfigV2MutationResult> {
    return this.enqueue(async () => {
      const current = await this.readActive();
      if (!current) throw new ConfigRecoveryError("no-valid-config-to-restore");
      this.assertExpected(options.expectedGeneration, current.generation);
      const history = await this.readHistory();
      const target = history.find((entry) => entry.generation === generation);
      if (!target) throw new ConfigRecoveryError("history-generation-not-found");
      return this.commit(target.config, current);
    });
  }

  private enqueue<T>(operation: () => Promise<T>, lock = true): Promise<T> {
    const run = this.queue.then(() => lock ? withStorageLock(this.root, operation) : operation(), () => lock ? withStorageLock(this.root, operation) : operation());
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async loadUnlocked(): Promise<ConfigV2LoadResult> {
    let bytes: Buffer;
    try { bytes = await readFile(join(this.root, this.activeFile)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (this.activeFile !== V2_ACTIVE_FILE) return { status: "missing", repairRequired: false, diagnostics: [] };
      try { bytes = await readFile(join(this.root, ACTIVE_FILE)); }
      catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", repairRequired: false, diagnostics: [] };
        throw legacyError;
      }
      return this.parseLoaded(bytes, true);
    }
    return this.parseLoaded(bytes, false);
  }

  private parseLoaded(bytes: Buffer, legacySource: boolean): ConfigV2LoadResult {
    try {
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      if (this.isStoredV2(parsed)) return { status: "valid", snapshot: this.snapshot(validateStoredConfigV2(parsed), legacySource ? "migrated" : "active"), repairRequired: false, diagnostics: [] };
      if (this.isStoredV1(parsed)) {
        const legacy = validateStoredConfig(parsed);
        const migrated = migrateConfigV1ToV2(legacy.config);
        return { status: "migrated", snapshot: { generation: legacy.generation, savedAt: legacy.savedAt, config: migrated, source: "migrated" }, repairRequired: false, diagnostics: ["legacy ConfigV1 was migrated in memory; save V2 to persist the migration"] };
      }
      throw new ConfigValidationError([{ code: "version", path: "config", message: "Configuration envelope is unsupported" }]);
    } catch (error) {
      return { status: "corrupt", repairRequired: true, diagnostics: [error instanceof Error ? error.message : "active config is invalid"] };
    }
  }

  private async readActive(): Promise<StoredConfigV2 | undefined> {
    const result = await this.loadUnlocked();
    if (!result.snapshot) return undefined;
    return { storageVersion: 1, generation: result.snapshot.generation, savedAt: result.snapshot.savedAt ?? new Date(0).toISOString(), config: result.snapshot.config };
  }

  private async commit(config: ConfigV2, current: StoredConfigV2 | undefined): Promise<ConfigV2MutationResult> {
    const generation = (current?.generation ?? 0) + 1;
    const savedAt = new Date().toISOString();
    const stored: StoredConfigV2 = { storageVersion: 1, generation, savedAt, config: structuredClone(config) };
    await ensureStorageDirectories(this.root);
    const historyRoot = join(this.root, HISTORY_DIR);
    await mkdir(historyRoot, { recursive: true, mode: STORAGE_DIRECTORY_MODE });
    if (current) {
      const historyPath = join(historyRoot, `config-${current.generation.toString().padStart(20, "0")}.json`);
      await writeAtomicFile(historyPath, deterministicJson(current), undefined, "history");
      await this.pruneHistory(historyRoot);
      const write = await writeAtomicFile(join(this.root, this.activeFile), deterministicJson(stored), undefined, "active");
      return { changed: true, generation, previousGeneration: current.generation, historyPath, ...(write.directorySyncWarning ? {} : {}) };
    }
    await writeAtomicFile(join(this.root, this.activeFile), deterministicJson(stored), undefined, "active");
    return { changed: true, generation };
  }

  private async readHistory(): Promise<readonly StoredConfigV2[]> {
    const root = join(this.root, HISTORY_DIR);
    let names: string[];
    try { names = await readdir(root); } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : []; }
    const entries: StoredConfigV2[] = [];
    for (const name of names.filter((item) => /^config-\d{20}\.json$/u.test(item))) {
      try { entries.push(validateStoredConfigV2(JSON.parse(await readFile(join(root, name), "utf8")) as unknown)); } catch { /* retain valid history only */ }
    }
    return entries.sort((a, b) => b.generation - a.generation);
  }

  private async pruneHistory(root: string): Promise<void> {
    const names = (await readdir(root)).filter((item) => /^config-\d{20}\.json$/u.test(item)).sort().reverse();
    await Promise.all(names.slice(HISTORY_RETENTION).map((name) => unlink(join(root, name)).catch(() => undefined)));
  }

  private snapshot(stored: StoredConfigV2, source: ConfigV2Snapshot["source"]): ConfigV2Snapshot { return { generation: stored.generation, savedAt: stored.savedAt, config: structuredClone(stored.config), source }; }
  private assertExpected(expected: number | undefined, actual: number): void { if (expected !== undefined && expected !== actual) throw new ConfigConflictError(expected, actual); }
  private isStoredV2(value: unknown): value is StoredConfigV2 { return typeof value === "object" && value !== null && "storageVersion" in value && typeof (value as { config?: unknown }).config === "object" && (value as { config?: { schemaVersion?: unknown } }).config?.schemaVersion === 2; }
  private isStoredV1(value: unknown): value is { storageVersion: 1; generation: number; savedAt: string; config: ConfigV1 } { return typeof value === "object" && value !== null && "storageVersion" in value && typeof (value as { config?: unknown }).config === "object" && (value as { config?: { schemaVersion?: unknown } }).config?.schemaVersion === 1; }
}

/** Billing/profile-focused name for callers that do not need the schema term. */
export const BillingProfileStore = ConfigV2Store;
