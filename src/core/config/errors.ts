export type ConfigErrorCode =
  | "CONFIG_VALIDATION"
  | "CONFIG_VERSION"
  | "CONFIG_MIGRATION"
  | "CONFIG_PERSISTENCE"
  | "CONFIG_RECOVERY"
  | "CONFIG_IMPORT"
  | "CONFIG_CONFLICT";

export interface ConfigIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** Base error for domain failures at the configuration boundary. */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

export class ConfigValidationError extends ConfigError {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      "CONFIG_VALIDATION",
      `Configuration validation failed (${issues.length} issue${issues.length === 1 ? "" : "s"})`,
    );
    this.name = "ConfigValidationError";
    this.issues = [...issues];
  }
}

export class ConfigVersionError extends ConfigError {
  readonly foundVersion: number | undefined;
  readonly currentVersion: number;

  constructor(foundVersion: number | undefined, currentVersion: number) {
    super("CONFIG_VERSION", "Configuration schema version is unsupported");
    this.name = "ConfigVersionError";
    this.foundVersion = foundVersion;
    this.currentVersion = currentVersion;
  }
}

export class ConfigMigrationError extends ConfigError {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly reasonCode: string;

  constructor(fromVersion: number, toVersion: number, reasonCode: string) {
    super("CONFIG_MIGRATION", "Configuration migration failed");
    this.name = "ConfigMigrationError";
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
    this.reasonCode = reasonCode;
  }
}

export class ConfigPersistenceError extends ConfigError {
  readonly operation: string;

  constructor(operation: string, reasonCode = "operation-failed") {
    super("CONFIG_PERSISTENCE", `Configuration persistence failed during ${operation}`);
    this.name = "ConfigPersistenceError";
    this.operation = operation;
    this.reasonCode = reasonCode;
  }

  readonly reasonCode: string;
}

export class ConfigRecoveryError extends ConfigError {
  readonly reasonCode: string;

  constructor(reasonCode = "no-valid-recovery-snapshot") {
    super("CONFIG_RECOVERY", "Configuration recovery failed");
    this.name = "ConfigRecoveryError";
    this.reasonCode = reasonCode;
  }
}

export class ConfigImportError extends ConfigError {
  readonly reasonCode: string;

  constructor(reasonCode = "invalid-import") {
    super("CONFIG_IMPORT", "Configuration import failed");
    this.name = "ConfigImportError";
    this.reasonCode = reasonCode;
  }
}

export class ConfigConflictError extends ConfigError {
  readonly expectedGeneration: number;
  readonly actualGeneration: number;

  constructor(expectedGeneration: number, actualGeneration: number) {
    super("CONFIG_CONFLICT", "Configuration changed before the requested mutation committed");
    this.name = "ConfigConflictError";
    this.expectedGeneration = expectedGeneration;
    this.actualGeneration = actualGeneration;
  }
}
