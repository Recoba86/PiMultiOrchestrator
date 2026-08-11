import { constants } from "node:fs";
import { chmod, mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { ConfigPersistenceError } from "./errors.js";
import type { StoredConfigV1 } from "./types.js";

/** History is intentionally bounded; M1 does not expose a tuning knob. */
export const DEFAULT_HISTORY_RETENTION = 20;
export const STORAGE_FILE_MODE = 0o600;
export const STORAGE_DIRECTORY_MODE = 0o700;

export type StorageFaultPoint =
  | "directory-create"
  | "history-temp-open"
  | "history-write"
  | "history-sync"
  | "history-close"
  | "history-rename"
  | "active-temp-open"
  | "active-write"
  | "active-sync"
  | "active-close"
  | "active-rename"
  | "quarantine-temp-open"
  | "quarantine-write"
  | "quarantine-sync"
  | "quarantine-close"
  | "quarantine-rename"
  | "directory-sync"
  | "history-prune";

export interface HistoryHooks {
  readonly fault?: (point: StorageFaultPoint) => void | Promise<void>;
  readonly id?: () => string;
  readonly now?: () => string;
}

export interface HistoryEntry {
  readonly generation: number;
  readonly savedAt: string;
  readonly path: string;
  readonly stored: StoredConfigV1;
}

export interface HistoryDiagnostic {
  readonly path: string;
  readonly message: string;
}

const historyName = (generation: number): string =>
  `config-${generation.toString().padStart(20, "0")}.json`;

const isHistoryName = (name: string): boolean => /^config-\d{20}\.json$/.test(name);

const defaultId = (): string => randomUUID();

const persistenceError = (operation: string, reasonCode: string, cause?: unknown): ConfigPersistenceError => {
  const error = new ConfigPersistenceError(operation, reasonCode);
  if (cause !== undefined) Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  return error;
};

async function fault(hooks: HistoryHooks | undefined, point: StorageFaultPoint): Promise<void> {
  await hooks?.fault?.(point);
}

export async function ensureStorageDirectories(root: string, hooks?: HistoryHooks): Promise<void> {
  try {
    await mkdir(root, { recursive: true, mode: STORAGE_DIRECTORY_MODE });
    await chmod(root, STORAGE_DIRECTORY_MODE);
    await mkdir(join(root, "history"), { recursive: true, mode: STORAGE_DIRECTORY_MODE });
    await chmod(join(root, "history"), STORAGE_DIRECTORY_MODE);
    await mkdir(join(root, "quarantine"), { recursive: true, mode: STORAGE_DIRECTORY_MODE });
    await chmod(join(root, "quarantine"), STORAGE_DIRECTORY_MODE);
    await fault(hooks, "directory-create");
  } catch (error) {
    if (error instanceof ConfigPersistenceError) throw error;
    throw persistenceError("directory-create", "directory-create-failed", error);
  }
}

/**
 * Write a file using a same-directory temporary file and atomic rename.
 * The parent directory sync is deliberately best effort: some supported
 * filesystems reject fsync on directory handles after a successful rename.
 */
export async function writeAtomicFile(
  target: string,
  content: string | Uint8Array,
  hooks: HistoryHooks | undefined,
  phase: "history" | "active" | "quarantine",
): Promise<{ readonly directorySyncWarning?: string }> {
  const parent = dirname(target);
  const suffix = hooks?.id?.() ?? defaultId();
  const temporary = `${target}.tmp-${suffix}`;
  const points = {
    open: `${phase}-temp-open` as StorageFaultPoint,
    write: `${phase}-write` as StorageFaultPoint,
    sync: `${phase}-sync` as StorageFaultPoint,
    close: `${phase}-close` as StorageFaultPoint,
    rename: `${phase}-rename` as StorageFaultPoint,
  };
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let renamed = false;
  try {
    await fault(hooks, points.open);
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, STORAGE_FILE_MODE);
    await handle.chmod(STORAGE_FILE_MODE);
    await fault(hooks, points.write);
    if (typeof content === "string") await handle.writeFile(content, "utf8");
    else await handle.writeFile(content);
    await fault(hooks, points.sync);
    await handle.sync();
    await fault(hooks, points.close);
    await handle.close();
    handle = undefined;
    await fault(hooks, points.rename);
    await rename(temporary, target);
    renamed = true;
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the original failure; cleanup below is best effort.
      }
    }
    if (!renamed) {
      try {
        await unlink(temporary);
      } catch {
        // The temp file may not have been created or may already be gone.
      }
    }
    if (error instanceof ConfigPersistenceError) throw error;
    throw persistenceError(`${phase}-write`, `${phase}-write-failed`, error);
  }

  let directorySyncWarning: string | undefined;
  try {
    await fault(hooks, "directory-sync");
    const directory = await open(parent, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    directorySyncWarning = error instanceof Error ? error.message : "directory sync unavailable";
  }
  return directorySyncWarning ? { directorySyncWarning } : {};
}

export async function writeHistorySnapshot(
  root: string,
  stored: StoredConfigV1,
  serialized: string,
  hooks?: HistoryHooks,
): Promise<HistoryEntry> {
  await ensureStorageDirectories(root, hooks);
  const target = join(root, "history", historyName(stored.generation));
  try {
    await writeAtomicFile(target, serialized, hooks, "history");
  } catch (error) {
    if (error instanceof ConfigPersistenceError) throw error;
    throw persistenceError("history-write", "history-write-failed", error);
  }
  return { generation: stored.generation, savedAt: stored.savedAt, path: target, stored };
}

export async function readHistory(
  root: string,
  decode: (value: unknown, path: string) => StoredConfigV1,
): Promise<{ readonly entries: readonly HistoryEntry[]; readonly diagnostics: readonly HistoryDiagnostic[] }> {
  const directory = join(root, "history");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { entries: [], diagnostics: [] };
    throw persistenceError("history-list", "history-list-failed", error);
  }
  const entries: HistoryEntry[] = [];
  const diagnostics: HistoryDiagnostic[] = [];
  for (const name of names.filter(isHistoryName).sort()) {
    const path = join(directory, name);
    try {
      const text = await readFile(path, "utf8");
      const stored = decode(JSON.parse(text) as unknown, path);
      if (stored.generation !== Number.parseInt(name.slice("config-".length, -".json".length), 10)) {
        throw new Error("generation does not match history filename");
      }
      entries.push({ generation: stored.generation, savedAt: stored.savedAt, path, stored });
    } catch (error) {
      diagnostics.push({ path, message: error instanceof Error ? error.message : "invalid history snapshot" });
    }
  }
  entries.sort((a, b) => b.generation - a.generation);
  return { entries, diagnostics };
}

export async function pruneHistory(root: string, retention = DEFAULT_HISTORY_RETENTION, hooks?: HistoryHooks): Promise<void> {
  if (retention < 1) return;
  const directory = join(root, "history");
  let names: string[];
  try {
    names = (await readdir(directory)).filter(isHistoryName).sort().reverse();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
      throw persistenceError("history-prune", "history-list-failed", error);
  }
  for (const name of names.slice(retention)) {
    await fault(hooks, "history-prune");
    try {
      await unlink(join(directory, name));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw persistenceError("history-prune", "history-delete-failed", error);
    }
  }
}

export async function quarantineBytes(
  root: string,
  bytes: Uint8Array | string,
  hooks?: HistoryHooks,
): Promise<string> {
  await ensureStorageDirectories(root, hooks);
  const timestamp = hooks?.now?.() ?? new Date().toISOString();
  const name = `config-corrupt-${timestamp.replaceAll(":", "-")}-${hooks?.id?.() ?? defaultId()}.json`;
  const target = join(root, "quarantine", name);
  await writeAtomicFile(target, bytes, hooks, "quarantine");
  return target;
}

export async function cleanupTemporaryFiles(root: string): Promise<void> {
  const directories = [root, join(root, "history"), join(root, "quarantine")];
  for (const directory of directories) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    await Promise.all(
      names
        .filter((name) => name.includes(".tmp-") && (name.startsWith("config.json") || name.startsWith("config-")))
        .map(async (name) => {
          try {
            await unlink(join(directory, name));
          } catch {
            // A concurrent cleanup or a vanished temp is harmless.
          }
        }),
    );
  }
}

export function historyPath(root: string, generation: number): string {
  return join(root, "history", historyName(generation));
}

export function historyBasename(generation: number): string {
  return basename(historyName(generation));
}
