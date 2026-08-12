import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { createSubmitAgentResultTool } from "./result-tool.js";
import { createWorkerSafetyGuard, workerSafetyBlockMessage } from "./safety.js";
import { toolProfileForWorker, workerProfileFor } from "./profiles.js";
import { WorkerError, type ChildSessionFactory, type ChildSessionHandle, type ChildSessionOptions } from "./types.js";


/**
 * Pi SDK child-session factory. Every call gets a fresh in-memory session,
 * exact model, bounded tools, and an empty resource loader; parent extensions,
 * commands, skills, context files, and transcripts are intentionally absent.
 */
export const defaultChildSessionFactory: ChildSessionFactory = {
	create: createChildSession,
};

export function createChildSessionFactory(): ChildSessionFactory {
	return defaultChildSessionFactory;
}

export async function createChildSession(options: ChildSessionOptions): Promise<ChildSessionHandle> {
	if (options.signal?.aborted) throw new WorkerError("session-create", "Child session creation was cancelled");
	if (options.route.model.id !== options.route.remoteModelId) {
		throw new WorkerError("route-model-mismatch", "Resolved route model does not match its exact remote model ID");
	}
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: options.cwd,
		// In-memory settings plus all discovery switches off prevents the child
		// from loading the parent extension or project context.
		agentDir: options.cwd,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: childSystemPrompt(options),
		appendSystemPrompt: [],
	});
	try {
		await resourceLoader.reload();
	} catch {
		throw new WorkerError("session-create", "Child resource loader could not be initialized");
	}
	if (options.signal?.aborted) throw new WorkerError("session-create", "Child session creation was cancelled");

	let created: Awaited<ReturnType<typeof createAgentSession>>;
	const resultToolName = options.resultToolName ?? options.submitTool.name ?? "submit_agent_result";
	const profile = workerProfileFor(options.request.poolId, resultToolName);
	const toolNames = toolProfileForWorker(profile).filter((toolName) => options.toolNames.includes(toolName));
	try {
		created = await createAgentSession({
			cwd: options.cwd,
			agentDir: options.cwd,
			model: options.route.model,
			thinkingLevel: "off",
			// An empty scope prevents Ctrl+P/model cycling to another route.
			scopedModels: [],
			modelRuntime: options.route.modelRuntime,
			tools: [...toolNames, resultToolName],
			customTools: [options.submitTool],
			resourceLoader,
			sessionManager: SessionManager.inMemory(options.cwd),
			settingsManager,
		});
	} catch {
		throw new WorkerError("session-create", "Child Pi session could not be created");
	}
	const session = created.session;
	const activeToolNames = session.getActiveToolNames();
	const expected = new Set([...toolNames, resultToolName]);
	if (activeToolNames.length !== expected.size || activeToolNames.some((name) => !expected.has(name)) || [...expected].some((name) => !activeToolNames.includes(name)) || activeToolNames.includes("delegate_agent")) {
		session.dispose();
		throw new WorkerError("session-create", "Child session exposed an unexpected tool");
	}
	const guard = createWorkerSafetyGuard({
		projectRoot: options.cwd,
		profile,
		requestedTools: toolNames,
		resultToolName,
		...(options.safety === undefined ? {} : options.safety),
	});
	const previousBeforeToolCall = session.agent.beforeToolCall;
	session.agent.beforeToolCall = async (context, signal) => {
		const safety = guard.authorize(context.toolCall.name, context.args);
		if (safety.decision !== "ALLOW") {
			return { block: true, reason: workerSafetyBlockMessage(context.toolCall.name, safety), terminate: true };
		}
		return previousBeforeToolCall?.(context, signal);
	};
	let disposed = false;
	return {
		session,
		toolNames: activeToolNames,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			session.dispose();
		},
	};
}

function childSystemPrompt(options: ChildSessionOptions): string {
	const criteria = options.request.acceptanceCriteria?.length
		? `\nAcceptance criteria:\n${options.request.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
		: "";
	return [
		`You are a bounded child worker for role ${options.request.roleId}.`,
	`Execution pool: ${options.request.poolId}. Working directory: ${options.cwd}.`,
	`Assigned task:\n${options.request.task}`,
	criteria,
	"Use only the tools provided to this session. Do not delegate or call another orchestrator.",
		`Do only the assigned scope. Report evidence and use ${options.resultToolName ?? options.submitTool.name ?? "submit_agent_result"} exactly once when done.`,
	"Do not claim overall mission completion; the parent/Boss owns acceptance.",
	].filter((line) => line.length > 0).join("\n");
}

export function createChildResultTool(): ToolDefinition {
	return createSubmitAgentResultTool();
}

export { ModelRuntime };
