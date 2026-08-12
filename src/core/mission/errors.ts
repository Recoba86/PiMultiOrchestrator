export type MissionStoreErrorCode =
  | "MISSION_VALIDATION"
  | "MISSION_VERSION"
  | "MISSION_PERSISTENCE"
  | "MISSION_NOT_FOUND"
  | "MISSION_CONFLICT"
  | "MISSION_LEASE"
  | "MISSION_EVIDENCE"
  | "MISSION_UNAUTHORIZED"
  | "MISSION_CORRUPT"
  | "MISSION_CLOSED";

export interface MissionIssue {
  readonly path: string;
  readonly message: string;
}

export class MissionStoreError extends Error {
  readonly code: MissionStoreErrorCode;
  readonly issues: readonly MissionIssue[];

  constructor(code: MissionStoreErrorCode, message: string, issues: readonly MissionIssue[] = []) {
    super(message);
    this.name = "MissionStoreError";
    this.code = code;
    this.issues = [...issues];
  }
}

export class MissionValidationError extends MissionStoreError {
  constructor(issues: readonly MissionIssue[]) {
    super("MISSION_VALIDATION", `Mission validation failed (${issues.length} issue${issues.length === 1 ? "" : "s"})`, issues);
    this.name = "MissionValidationError";
  }
}

export class MissionVersionError extends MissionStoreError {
  readonly foundVersion: number | undefined;
  readonly currentVersion: number;

  constructor(foundVersion: number | undefined, currentVersion: number) {
    super("MISSION_VERSION", "Mission database schema version is unsupported");
    this.name = "MissionVersionError";
    this.foundVersion = foundVersion;
    this.currentVersion = currentVersion;
  }
}

export class MissionPersistenceError extends MissionStoreError {
  readonly operation: string;

  constructor(operation: string, message = "Mission persistence failed") {
    super("MISSION_PERSISTENCE", `${message} during ${operation}`);
    this.name = "MissionPersistenceError";
    this.operation = operation;
  }
}

export class MissionNotFoundError extends MissionStoreError {
  readonly entity: string;
  readonly id: string;

  constructor(entity: string, id: string) {
    super("MISSION_NOT_FOUND", `${entity} '${id}' was not found`);
    this.name = "MissionNotFoundError";
    this.entity = entity;
    this.id = id;
  }
}

export class MissionConflictError extends MissionStoreError {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super("MISSION_CONFLICT", "Mission changed before the requested mutation committed");
    this.name = "MissionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class MissionLeaseError extends MissionStoreError {
  constructor(message: string) {
    super("MISSION_LEASE", message);
    this.name = "MissionLeaseError";
  }
}

export class MissionEvidenceError extends MissionStoreError {
  constructor(message: string, issues: readonly MissionIssue[] = []) {
    super("MISSION_EVIDENCE", message, issues);
    this.name = "MissionEvidenceError";
  }
}

export class MissionUnauthorizedError extends MissionStoreError {
  constructor(message: string) {
    super("MISSION_UNAUTHORIZED", message);
    this.name = "MissionUnauthorizedError";
  }
}

export class MissionCorruptError extends MissionStoreError {
  constructor(message = "Mission database integrity check failed") {
    super("MISSION_CORRUPT", message);
    this.name = "MissionCorruptError";
  }
}

export class MissionClosedError extends MissionStoreError {
  constructor() {
    super("MISSION_CLOSED", "Mission store is closed");
    this.name = "MissionClosedError";
  }
}
