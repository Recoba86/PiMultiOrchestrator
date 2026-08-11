import type { CatalogErrorKind } from "./types.js";

export type SecretErrorCode = "unsupported-store" | "invalid-reference" | "missing" | "empty";

/** Error whose public text is safe to show in diagnostics. */
export class SecretResolutionError extends Error {
  readonly code: SecretErrorCode;

  constructor(code: SecretErrorCode, message: string) {
    super(message);
    this.name = "SecretResolutionError";
    this.code = code;
  }
}

export class NineRouterError extends Error {
  readonly kind: CatalogErrorKind;
  readonly stage: string;
  readonly status?: number;

  constructor(
    kind: CatalogErrorKind,
    stage: string,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "NineRouterError";
    this.kind = kind;
    this.stage = stage;
    if (status !== undefined) this.status = status;
  }

  toJSON(): { kind: CatalogErrorKind; stage: string; message: string; status?: number } {
    return {
      kind: this.kind,
      stage: safeCatalogErrorStage(this.stage),
      message: safeCatalogErrorMessage(this),
      ...(this.status === undefined ? {} : { status: this.status }),
    };
  }
}

export function safeCatalogErrorStage(stage: string): string {
  return /^(?:auth|body|cache|config|connection|decode|request|response|schema(?:\.data\[\d+\](?:\.[A-Za-z_]+)?)?)$/u.test(stage)
    ? stage
    : "request";
}

/** Never persist or display arbitrary provider/network error text. */
export function safeCatalogErrorMessage(error: Pick<NineRouterError, "kind" | "status">): string {
  switch (error.kind) {
    case "auth":
      return "9Router authentication failed";
    case "http":
      return error.status === undefined ? "9Router returned an HTTP error" : `9Router returned HTTP ${error.status}`;
    case "timeout":
      return "The 9Router catalog request timed out";
    case "cancelled":
      return "The 9Router catalog request was cancelled";
    case "malformed":
      return "The 9Router catalog response is malformed";
    case "oversized":
      return "The 9Router catalog response is too large";
    case "duplicate":
      return "The 9Router catalog contains duplicate model IDs";
    case "invalid-url":
      return "The 9Router URL is invalid";
    case "secret":
      return "The 9Router credential is unavailable";
    case "transport":
      return "The 9Router catalog request failed";
  }
}

export type ManagerErrorCode =
  | "not-configured"
  | "gateway-disabled"
  | "catalog-empty"
  | "model-not-found"
  | "model-ambiguous"
  | "active-route"
  | "provider-unavailable"
  | "route-id-collision";

export class NineRouterManagerError extends Error {
  readonly code: ManagerErrorCode;

  constructor(code: ManagerErrorCode, message: string) {
    super(message);
    this.name = "NineRouterManagerError";
    this.code = code;
  }
}
