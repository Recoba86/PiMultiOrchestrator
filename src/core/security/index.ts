import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

export type TrustState = "trusted" | "untrusted";

export interface ProjectTrustRecord {
	readonly projectRoot: string;
	readonly state: TrustState;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly label?: string;
}

export class ProjectTrustRequiredError extends Error {
	readonly code = "PROJECT_TRUST_REQUIRED" as const;
	constructor(message = "Mutating execution requires explicit project trust") {
		super(message);
		this.name = "ProjectTrustRequiredError";
	}
}

const TRUST_FILE = ".project-trust.json";
const MAX_LABEL = 128;

function canonicalExisting(path: string): string {
	try { return realpathSync(path); } catch { return resolve(path); }
}

function expandUserPath(path: string): string {
	return path === "~" ? homedir() : path.startsWith(`~${sep}`) ? join(homedir(), path.slice(2)) : path;
}

function safeLabel(label: unknown): string | undefined {
	if (typeof label !== "string") return undefined;
	const value = label.trim().slice(0, MAX_LABEL);
	return value.length > 0 ? value : undefined;
}

/** Local-only trust state. It is deliberately not part of ConfigStore export/import. */
export class TrustStore {
	private readonly file: string;
	private readonly clock: () => Date;
	private records = new Map<string, ProjectTrustRecord>();

	constructor(options: { readonly root: string; readonly clock?: () => Date }) {
		if (!options.root) throw new Error("trust root is required");
		mkdirSync(options.root, { recursive: true, mode: 0o700 });
		this.file = join(options.root, TRUST_FILE);
		this.clock = options.clock ?? (() => new Date());
		this.load();
	}

	private load(): void {
		try {
			const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
			if (!Array.isArray(parsed)) return;
			for (const item of parsed) {
				if (!item || typeof item !== "object") continue;
				const value = item as Record<string, unknown>;
				const projectRoot = typeof value.projectRoot === "string" ? canonicalExisting(value.projectRoot) : "";
				const state = value.state === "trusted" || value.state === "untrusted" ? value.state : undefined;
				if (!projectRoot || !state || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") continue;
				const label = safeLabel(value.label);
				this.records.set(projectRoot, Object.freeze({ projectRoot, state, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(label ? { label } : {}) }));
			}
		} catch { /* Unknown/corrupt local trust state is conservatively untrusted. */ }
	}

	private persist(): void {
		const temporary = `${this.file}.tmp-${randomUUID()}`;
		const bytes = JSON.stringify([...this.records.values()].sort((a, b) => a.projectRoot.localeCompare(b.projectRoot)));
		try {
			writeFileSync(temporary, bytes, { encoding: "utf8", mode: 0o600 });
			chmodSync(temporary, 0o600);
			renameSync(temporary, this.file);
			chmodSync(this.file, 0o600);
		} finally {
			try { unlinkSync(temporary); } catch { /* already renamed */ }
		}
	}

	get(projectRoot: string): ProjectTrustRecord {
		const canonical = canonicalExisting(projectRoot);
		return this.records.get(canonical) ?? Object.freeze({ projectRoot: canonical, state: "untrusted", createdAt: "", updatedAt: "" });
	}

	isTrusted(projectRoot: string): boolean { return this.get(projectRoot).state === "trusted"; }

	trust(projectRoot: string, label?: string): ProjectTrustRecord {
		const canonical = canonicalExisting(projectRoot);
		const previous = this.records.get(canonical);
		const now = this.clock().toISOString();
		const nextLabel = safeLabel(label) ?? previous?.label;
		const record = Object.freeze({ projectRoot: canonical, state: "trusted" as const, createdAt: previous?.createdAt || now, updatedAt: now, ...(nextLabel ? { label: nextLabel } : {}) });
		this.records.set(canonical, record);
		this.persist();
		return record;
	}

	revoke(projectRoot: string): ProjectTrustRecord {
		const canonical = canonicalExisting(projectRoot);
		const previous = this.records.get(canonical);
		const now = this.clock().toISOString();
		const record = Object.freeze({ projectRoot: canonical, state: "untrusted" as const, createdAt: previous?.createdAt || now, updatedAt: now, ...(previous?.label ? { label: previous.label } : {}) });
		this.records.set(canonical, record);
		this.persist();
		return record;
	}

	list(): readonly ProjectTrustRecord[] { return [...this.records.values()].sort((a, b) => a.projectRoot.localeCompare(b.projectRoot)); }
}

export type SafetyDecision = "ALLOW" | "REVIEW_REQUIRED" | "BLOCK";

export interface SafetyResult {
	readonly decision: SafetyDecision;
	readonly reason: string;
	readonly path?: string;
	readonly code?: string;
}

function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resolveWithExistingAncestor(path: string, seen = new Set<string>()): string {
	const absolute = resolve(expandUserPath(path));
	if (seen.has(absolute)) return absolute;
	seen.add(absolute);
	try { return realpathSync(absolute); } catch { /* The target may be a new file. */ }
	const missing: string[] = [];
	let cursor = absolute;
	while (true) {
		try {
			const base = realpathSync(cursor);
			return missing.reverse().reduce((current, part) => join(current, part), base);
		} catch {
			const parent = dirname(cursor);
			if (parent === cursor) return absolute;
			try {
				if (lstatSync(cursor).isSymbolicLink()) {
					const target = resolve(parent, readlinkSync(cursor, "utf8"));
					return resolveWithExistingAncestor(join(target, ...missing.reverse()), seen);
				}
			} catch { /* Missing paths and broken links are handled conservatively below. */ }
			missing.push(cursor.slice(parent.length + 1));
			cursor = parent;
		}
	}
}

function pathLooksCredential(path: string): boolean {
	const lower = path.toLowerCase();
	return lower.split(sep).some((part) => part === ".ssh" || part === ".aws" || part === ".gnupg" || part === ".npmrc" || part.startsWith(".env") || part === "auth.json" || part.includes("credential") || part.includes("secret") || part === "private-key")
		|| /(?:^|[._/-])(?:id_rsa|id_ed25519|private[-_]?key|key|token|password)(?:$|[._/-])/iu.test(lower)
		|| /\.(?:pem|key|p12|pfx)$/iu.test(lower);
}

export interface PathSafetyOptions {
	readonly projectRoot: string;
	readonly trusted?: boolean;
	readonly trustStore?: TrustStore;
	readonly protectedPaths?: readonly string[];
	readonly internalRoots?: readonly string[];
}

/** Central application-level path policy; it is not an OS sandbox. */
export class PathSafetyPolicy {
	readonly projectRoot: string;
	private readonly trusted: boolean;
	private readonly protectedPaths: readonly string[];

	constructor(options: PathSafetyOptions) {
		this.projectRoot = canonicalExisting(options.projectRoot);
		this.trusted = options.trusted ?? options.trustStore?.isTrusted(this.projectRoot) ?? false;
		const defaults = [
			join(this.projectRoot, ".git"), join(this.projectRoot, ".pi"), join(this.projectRoot, ".ssh"),
			join(this.projectRoot, ".env"), join(this.projectRoot, "mission.sqlite"), join(this.projectRoot, "analytics.sqlite"),
			join(this.projectRoot, "health.json"), join(this.projectRoot, TRUST_FILE), join(this.projectRoot, "config.json"),
		];
		this.protectedPaths = [...new Set([...(options.internalRoots ?? []), ...(options.protectedPaths ?? []), ...defaults].map(canonicalExisting))];
	}

	get isTrusted(): boolean { return this.trusted; }

	canonicalize(path: string): string { const expanded = expandUserPath(path); return resolveWithExistingAncestor(isAbsolute(expanded) ? expanded : join(this.projectRoot, expanded)); }

	check(path: string, operation: "read" | "write" | "execute" = "read"): SafetyResult {
		const target = this.canonicalize(path);
		if (pathLooksCredential(target)) return { decision: "BLOCK", reason: "credential or private-key path is protected", code: "CREDENTIAL_PATH", path: target };
		if (this.protectedPaths.some((protectedPath) => inside(protectedPath, target))) return { decision: "BLOCK", reason: "target is an orchestrator or repository-internal protected path", code: "PROTECTED_PATH", path: target };
		if (!inside(this.projectRoot, target)) return { decision: "BLOCK", reason: "target resolves outside trusted project", code: "OUTSIDE_WORKSPACE", path: target };
		if (operation !== "read" && !this.trusted) return { decision: "BLOCK", reason: "mutating execution requires explicit project trust", code: "PROJECT_TRUST_REQUIRED", path: target };
		return { decision: "ALLOW", reason: operation === "read" ? "read is within the project boundary" : "trusted project mutation is within the project boundary", path: target };
	}

	authorizeRead(path: string): SafetyResult { return this.check(path, "read"); }
	authorizeWrite(path: string): SafetyResult { return this.check(path, "write"); }
	authorizeExecute(path: string): SafetyResult { return this.check(path, "execute"); }

	assertWrite(path: string): string {
		const result = this.authorizeWrite(path);
		if (result.decision !== "ALLOW") {
			if (result.code === "PROJECT_TRUST_REQUIRED") throw new ProjectTrustRequiredError(result.reason);
			throw new PathSafetyError(result);
		}
		return result.path!;
	}
}

export class PathSafetyError extends Error {
	readonly code: string;
	constructor(readonly result: SafetyResult) { super(`${result.decision} — ${result.reason}`); this.name = "PathSafetyError"; this.code = result.code ?? "PATH_POLICY"; }
}

export interface CommandSafetyOptions {
	readonly projectRoot?: string;
	readonly trusted?: boolean;
	readonly pathPolicy?: PathSafetyPolicy;
	readonly explicitlyAuthorized?: boolean;
}

export interface CommandSafetyResult extends SafetyResult {
	readonly command: string;
}

function commandResult(command: string, decision: SafetyDecision, reason: string, code: string): CommandSafetyResult { return { command, decision, reason, code }; }

/** Conservative command policy. Shell parsing is intentionally bounded; ambiguity is reviewed, not guessed. */
export class CommandSafetyPolicy {
	evaluate(command: string, options: CommandSafetyOptions = {}): CommandSafetyResult {
		const source = command.trim();
		if (!source) return commandResult(command, "BLOCK", "empty command", "EMPTY_COMMAND");
		if (/(?:^|[;&|])\s*(?:sudo|doas|su)\b|\b(?:sudo|doas|su)\s+/iu.test(source)) return commandResult(command, "BLOCK", "privilege escalation is not allowed", "PRIVILEGE_ESCALATION");
		if (/\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk|diskutil\s+erase|dd\s+if=|shutdown|reboot)\b/iu.test(source)) return commandResult(command, "BLOCK", "filesystem/device operation is not allowed", "DEVICE_OPERATION");
		if (/\b(?:chmod|chown|chgrp)\b/iu.test(source) || /(?:ssh-keygen|security\s+(?:add-generic-password|delete-generic-password)|passwd)\b/iu.test(source)) return commandResult(command, "BLOCK", "credential or permission manipulation is not allowed", "CREDENTIAL_OR_PERMISSION");
		if (/\brm\s+(?:-[^-\s]*r[^\s]*\s+|--recursive\b)|\bfind\b[^\n]*\s-delete\b/iu.test(source)) return commandResult(command, "BLOCK", "recursive destructive deletion is not allowed", "DESTRUCTIVE_DELETE");
		if (/\bgit\s+(?:reset\s+--hard|clean\s+-[^\n]*f|restore\b|checkout\s+--\b)/iu.test(source)) return commandResult(command, "BLOCK", "destructive Git operation requires explicit recovery tooling", "DESTRUCTIVE_GIT");
		if (/(?:^|\s)(?:>|>>|<)|\$\(|`|\$[A-Za-z_][A-Za-z0-9_]*|\*\*|\b(?:eval|exec)\b/iu.test(source)) return commandResult(command, "REVIEW_REQUIRED", "shell target cannot be established safely", "AMBIGUOUS_SHELL");
		if (options.pathPolicy) {
			const tokens = source.split(/\s+/u).filter((token) => !token.startsWith("-")).map((token) => token.replace(/^['"]|['"]$/gu, "")).filter(Boolean);
			for (const token of tokens) {
				const pathResult = options.pathPolicy.authorizeExecute(token);
				if (pathResult.decision !== "ALLOW") return commandResult(command, pathResult.decision, pathResult.reason, pathResult.code ?? "PATH_POLICY");
			}
		}
		if (options.trusted === false && /\b(?:edit|write|rm|mv|cp|touch|mkdir|npm\s+install)\b/iu.test(source)) return commandResult(command, "BLOCK", "mutating command requires explicit project trust", "PROJECT_TRUST_REQUIRED");
		if (options.explicitlyAuthorized) return commandResult(command, "ALLOW", "explicitly authorized bounded command", "AUTHORIZED");
		return commandResult(command, "ALLOW", "command is within the conservative safe set", "SAFE_COMMAND");
	}
}

export function evaluateCommandSafety(command: string, options: CommandSafetyOptions = {}): CommandSafetyResult { return new CommandSafetyPolicy().evaluate(command, options); }

export interface SecretSanitizerOptions { readonly maxDepth?: number; readonly maxItems?: number; readonly maxStringLength?: number; }

/** In-memory value-based redaction. The secret dictionary is never serializable. */
export class SecretSanitizer {
	private readonly secrets = new Set<string>();
	private readonly maxDepth: number;
	private readonly maxItems: number;
	private readonly maxStringLength: number;

	constructor(options: SecretSanitizerOptions = {}) { this.maxDepth = options.maxDepth ?? 6; this.maxItems = options.maxItems ?? 128; this.maxStringLength = options.maxStringLength ?? 8_192; }
	register(value: unknown): void { if (typeof value === "string" && value.length >= 4 && value.length <= this.maxStringLength) this.secrets.add(value); }
	registerMany(values: Iterable<unknown>): void { for (const value of values) this.register(value); }
	sanitizeText(value: unknown): string {
		let text = typeof value === "string" ? value.slice(0, this.maxStringLength) : String(value ?? "");
		for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join("[REDACTED]");
		text = text.replace(/(authorization\s*[:=]\s*(?:bearer\s+)?|bearer\s+)([^\s,;]+)/giu, "$1[REDACTED]");
		return text;
	}
	sanitize<T>(value: T, depth = 0): T {
		if (depth > this.maxDepth) return "[REDACTED_DEPTH]" as T;
		if (typeof value === "string") return this.sanitizeText(value) as T;
		if (Array.isArray(value)) return value.slice(0, this.maxItems).map((item) => this.sanitize(item, depth + 1)) as T;
		if (!value || typeof value !== "object") return value;
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, this.maxItems)) {
			if (/^(?:authorization|proxy-authorization|api[-_]?key|token|secret|password|private[-_]?key)$/iu.test(key)) output[key] = "[REDACTED]";
			else output[key] = this.sanitize(item, depth + 1);
		}
		return output as T;
	}
	safeError(error: unknown): { readonly message: string; readonly code?: string } { const value = error && typeof error === "object" ? error as Record<string, unknown> : {}; return { message: this.sanitizeText(value.message ?? error), ...(typeof value.code === "string" ? { code: this.sanitizeText(value.code) } : {}) }; }
}

export interface CapabilityRow {
	readonly profile: "investigation" | "implementation" | "verification" | "recommendation-analyst";
	readonly tools: readonly string[];
	readonly mutation: boolean;
	readonly bash: boolean;
	readonly trustRequired: boolean;
	readonly protectedPathRestrictions: string;
}

export function getCapabilityMatrix(): readonly CapabilityRow[] {
	return [
		{ profile: "investigation", tools: ["read", "grep", "find", "ls"], mutation: false, bash: false, trustRequired: false, protectedPathRestrictions: "protected reads denied" },
		{ profile: "implementation", tools: ["read", "grep", "find", "ls", "edit", "write", "bash"], mutation: true, bash: true, trustRequired: true, protectedPathRestrictions: "trusted root only; internal/credential paths denied" },
		{ profile: "verification", tools: ["read", "grep", "find", "ls", "bash"], mutation: false, bash: true, trustRequired: false, protectedPathRestrictions: "read-only; bash remains policy-guarded" },
		{ profile: "recommendation-analyst", tools: ["submit_recommendation_analysis"], mutation: false, bash: false, trustRequired: false, protectedPathRestrictions: "analytics packet only; no source/transcript/secret" },
	];
}

export const permissionMatrix = getCapabilityMatrix;

export function fingerprintSafetyInput(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
