import { ConfigError, ConfigImportError } from "./errors.js";
import { migrateConfig } from "./migrations.js";
import { serializeConfig } from "./serialize.js";
import { validateConfig } from "./schema.js";
import type { ConfigV1 } from "./types.js";

export const DEFAULT_IMPORT_MAX_BYTES = 1_048_576;

export interface ImportParseOptions {
  readonly maxBytes?: number;
  readonly migrate?: (value: unknown) => unknown;
}

export interface TransferPreview {
  readonly config: ConfigV1;
  readonly changed: boolean;
  readonly before?: string;
  readonly after: string;
}

/** Export semantic configuration only; storage/runtime metadata is omitted. */
export function exportConfig(config: ConfigV1): string {
  return serializeConfig(validateConfig(config));
}

/** Parse, migrate, and validate an import without touching disk. */
export function parseConfigImport(input: string | unknown, options: ImportParseOptions = {}): ConfigV1 {
  const maxBytes = options.maxBytes ?? DEFAULT_IMPORT_MAX_BYTES;
  let value: unknown;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > maxBytes) throw new ConfigImportError("input-too-large");
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      throw new ConfigImportError("invalid-json");
    }
  } else {
    value = input;
    try {
      if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) throw new ConfigImportError("input-too-large");
    } catch (error) {
      if (error instanceof ConfigImportError) throw error;
      throw new ConfigImportError("non-serializable-input");
    }
  }
  try {
    const migrated = options.migrate ? options.migrate(value) : migrateConfig(value);
    return validateConfig(migrated);
  } catch (error) {
    if (error instanceof ConfigImportError) throw error;
    if (error instanceof ConfigError) throw new ConfigImportError("validation-failed");
    throw new ConfigImportError("validation-failed");
  }
}

export function previewConfigImport(
  input: string | unknown,
  current: ConfigV1 | undefined,
  options: ImportParseOptions = {},
): TransferPreview {
  const config = parseConfigImport(input, options);
  const before = current ? serializeConfig(validateConfig(current)) : undefined;
  const after = serializeConfig(config);
  return { config, changed: before !== after, ...(before === undefined ? {} : { before }), after };
}
