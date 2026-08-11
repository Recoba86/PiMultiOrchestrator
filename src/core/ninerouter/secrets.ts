import type { SecretRefV1 } from "../config/types.js";
import { SecretResolutionError } from "./errors.js";

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

export type SecretEnvironment = Readonly<Record<string, string | undefined>>;

/** Resolves environment references only; it never writes or persists secrets. */
export class EnvSecretResolver {
  private readonly environment: SecretEnvironment;

  constructor(environment: SecretEnvironment = process.env) {
    this.environment = environment;
  }

  async resolve(reference: SecretRefV1 | string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new SecretResolutionError("missing", "Secret resolution was cancelled");

    const ref = typeof reference === "string" ? parseReference(reference) : reference;
    if (!ref || ref.store !== "env") {
      throw new SecretResolutionError("unsupported-store", "The configured secret store is unavailable");
    }
    if (!ENV_NAME.test(ref.key)) {
      throw new SecretResolutionError("invalid-reference", "The environment secret reference is invalid");
    }
    const value = this.environment[ref.key];
    if (value === undefined) throw new SecretResolutionError("missing", "The environment secret is not configured");
    if (value.length === 0 || /[\r\n]/u.test(value)) {
      throw new SecretResolutionError("empty", "The environment secret is unusable");
    }
    return value;
  }
}

function parseReference(value: string): SecretRefV1 | undefined {
  const match = /^env:([A-Za-z_][A-Za-z0-9_]*)$/u.exec(value);
  return match ? { store: "env", key: match[1]! } : undefined;
}

export function isEnvironmentReference(reference: SecretRefV1 | undefined): boolean {
  return reference?.store === "env" && ENV_NAME.test(reference.key);
}
