import {
	CommandSafetyPolicy,
	PathSafetyPolicy,
	type SafetyResult,
	type TrustStore,
} from "../security/index.js";
import {
	isPotentiallyMutatingTool,
	isWorkerResultToolName,
	toolProfileForWorker,
	type WorkerProfileId,
} from "./profiles.js";

const PATH_TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write"]);
const MUTATING_TOOLS = new Set(["edit", "write", "bash"]);

/** Existing application trust state supplied to a worker boundary. */
export interface WorkerSafetyContext {
	readonly trusted?: boolean;
	readonly trustStore?: TrustStore;
}

export interface WorkerSafetyGuardOptions extends WorkerSafetyContext {
	readonly projectRoot: string;
	readonly profile: WorkerProfileId;
	/** Requested tools are intersected with the profile; they never expand it. */
	readonly requestedTools: readonly string[];
	readonly resultToolName?: string;
}

/**
 * Single pre-execution worker policy. Pi's beforeToolCall hook is the only
 * place where this guard can prevent the built-in tool from running.
 */
export class WorkerSafetyGuard {
	readonly projectRoot: string;
	readonly profile: WorkerProfileId;
	readonly pathPolicy: PathSafetyPolicy;
	readonly commandPolicy: CommandSafetyPolicy;
	readonly trusted: boolean;
	private readonly activeTools: ReadonlySet<string>;
	private readonly profileTools: ReadonlySet<string>;
	private readonly resultToolName: string | undefined;

	constructor(options: WorkerSafetyGuardOptions) {
		this.projectRoot = options.projectRoot;
		this.profile = options.profile;
		this.trusted = options.trusted
			?? options.trustStore?.isTrusted(options.projectRoot)
			?? false;
		this.pathPolicy = new PathSafetyPolicy({
			projectRoot: options.projectRoot,
			...(options.trustStore === undefined ? {} : { trustStore: options.trustStore }),
			trusted: this.trusted,
		});
		this.commandPolicy = new CommandSafetyPolicy();
		this.profileTools = new Set(toolProfileForWorker(options.profile));
		this.activeTools = new Set([
			...options.requestedTools.filter((toolName) => this.profileTools.has(toolName)),
			...(options.resultToolName !== undefined && isWorkerResultToolName(options.resultToolName) ? [options.resultToolName] : []),
		]);
		this.resultToolName = options.resultToolName;
	}

	authorize(toolName: string, args: unknown): SafetyResult {
		if (!this.activeTools.has(toolName)) return blocked("tool is not active for this worker", "TOOL_NOT_ACTIVE");
		if (!this.profileTools.has(toolName) && !(toolName === this.resultToolName && isWorkerResultToolName(toolName))) {
			return blocked("tool is outside the worker profile", "PROFILE_TOOL_NOT_ALLOWED");
		}
		if (toolName === this.resultToolName && isWorkerResultToolName(toolName)) return allowed("bounded result submission is allowed");
		if (MUTATING_TOOLS.has(toolName) && this.profile !== "implementation") {
			return blocked("mutating tools are not allowed for this worker profile", "PROFILE_MUTATION_DENIED");
		}
		if (toolName === "bash") return this.authorizeBash(args);
		if (PATH_TOOLS.has(toolName)) return this.authorizePath(toolName, args);
		if (isPotentiallyMutatingTool(toolName)) return blocked("unrecognized mutating tool", "UNKNOWN_MUTATING_TOOL");
		return allowed("read-only worker tool is allowed");
	}

	private authorizeBash(args: unknown): SafetyResult {
		if (!this.trusted) return blocked("mutating command execution requires explicit project trust", "PROJECT_TRUST_REQUIRED");
		const command = recordString(args, "command");
		if (command === undefined) return blocked("bash command is invalid", "INVALID_COMMAND");
		return this.commandPolicy.evaluate(command, { pathPolicy: this.pathPolicy, trusted: this.trusted });
	}

	private authorizePath(toolName: string, args: unknown): SafetyResult {
		const rawPath = recordString(args, "path") ?? recordString(args, "file_path") ?? (toolName === "grep" || toolName === "find" || toolName === "ls" ? "." : undefined);
		if (rawPath === undefined) return blocked("tool path is invalid", "INVALID_PATH");
		if (toolName === "grep" || toolName === "find") return this.pathPolicy.authorizeRecursiveRead(rawPath);
		return MUTATING_TOOLS.has(toolName) ? this.pathPolicy.authorizeWrite(rawPath) : this.pathPolicy.authorizeRead(rawPath);
	}
}

export function createWorkerSafetyGuard(options: WorkerSafetyGuardOptions): WorkerSafetyGuard {
	return new WorkerSafetyGuard(options);
}

export function workerSafetyBlockMessage(toolName: string, result: SafetyResult): string {
	return `Worker safety blocked ${toolName}: ${result.code ?? "POLICY_DENIAL"}`;
}

function recordString(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

function allowed(reason: string): SafetyResult {
	return { decision: "ALLOW", reason };
}

function blocked(reason: string, code: string): SafetyResult {
	return { decision: "BLOCK", reason, code };
}
