import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { createSubmitAgentResultTool } from "./result-tool.js";
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
	try {
		created = await createAgentSession({
			cwd: options.cwd,
			agentDir: options.cwd,
			model: options.route.model,
			thinkingLevel: "off",
			// An empty scope prevents Ctrl+P/model cycling to another route.
			scopedModels: [],
			modelRuntime: options.route.modelRuntime,
			tools: [...options.toolNames, "submit_agent_result"],
			customTools: [options.submitTool],
			resourceLoader,
			sessionManager: SessionManager.inMemory(options.cwd),
			settingsManager,
		});
	} catch {
		throw new WorkerError("session-create", "Child Pi session could not be created");
	}
	const session = created.session;
	const toolNames = session.getActiveToolNames();
	const expected = new Set([...options.toolNames, "submit_agent_result"]);
	if (toolNames.length !== expected.size || toolNames.some((name) => !expected.has(name)) || [...expected].some((name) => !toolNames.includes(name)) || toolNames.includes("delegate_agent")) {
		session.dispose();
		throw new WorkerError("session-create", "Child session exposed an unexpected tool");
	}
	let disposed = false;
	return {
		session,
		toolNames,
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
	"Do only the assigned scope. Report evidence and use submit_agent_result exactly once when done.",
	"Do not claim overall mission completion; the parent/Boss owns acceptance.",
	].filter((line) => line.length > 0).join("\n");
}

export function createChildResultTool(): ToolDefinition {
	return createSubmitAgentResultTool();
}

export { ModelRuntime };
