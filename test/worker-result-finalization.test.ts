import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type { StableId } from "../src/core/config/types.js";
import type { RoutingCandidate, RoutingPolicy } from "../src/core/routing/index.js";
import { createProtocolCaptureState, createProtocolOnlyCaptureTool } from "../src/core/workers/result-tool.js";
import { createSubagentExecutorForTesting } from "../src/core/workers/executor.js";
import { resultFinalizationPrompt } from "../src/core/workers/finalization.js";
import type {
	ChildResultProtocol,
	ChildSessionFactory,
	ResolvedWorkerRoute,
	RouteAttemptAdapter,
	SubagentExecutionRequest,
} from "../src/core/workers/index.js";

const id = (value: string): StableId => value as StableId;
const policy: RoutingPolicy = {
	maxAttempts: 2,
	timeoutMs: 100,
	rateLimitCooldownMs: 1,
	quotaCooldownMs: 1,
	fallback: { enabled: true },
	diversityPreference: "none",
};

type FakeMode =
	| "complete"
	| "omit"
	| "omit-then-finalize"
	| "omit-then-missing"
	| "omit-then-invalid"
	| "omit-then-infra"
	| "omit-then-cancel"
	| "protocol-invalid"
	| "protocol-invalid-then-finalize"
	| "rate"
	| "safety-stop"
	| "mutate-omit-then-finalize"
	| "mutate-omit-then-missing"
	| "mutate-omit-then-infra"
	| "hang";

describe("RC29 two-phase worker result finalization", () => {
	it("does not invoke finalization when work phase captured submit_agent_result", async () => {
		const root = await tmp();
		try {
			const seen: string[] = [];
			const { executor, tracker } = executorFor("complete", seen);
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.terminalStatus, "completed");
			assert.equal(tracker.promptCount, 1);
			assert.equal(result.resultFinalization?.outcome, "not_required");
			assert.equal(result.structuredResult?.summary, "child complete");
			assert.equal(result.attempts.length, 1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("runs exactly one finalization turn when work phase captured nothing", async () => {
		const root = await tmp();
		try {
			const { executor, tracker } = executorFor("omit-then-finalize");
			const result = await executor.run(request(root, "investigation"));
			assert.equal(tracker.promptCount, 2);
			assert.equal(result.resultFinalization?.attempted, true);
			assert.equal(result.resultFinalization?.outcome, "succeeded");
			assert.equal(result.terminalStatus, "completed");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("exposes only submit_agent_result during finalization", async () => {
		const root = await tmp();
		try {
			const { executor, tracker } = executorFor("omit-then-finalize");
			await executor.run(request(root, "investigation"));
			assert.deepEqual(tracker.finalizationTools, ["submit_agent_result"]);
			assert.equal(tracker.finalizationTools?.includes("read"), false);
			assert.equal(tracker.workTools.includes("read"), true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("completes the same Attempt when finalization captures a valid result", async () => {
		const root = await tmp();
		try {
			const { executor } = executorFor("omit-then-finalize");
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.attempts.length, 1);
			assert.equal(result.attempts[0]?.outcome, "completed");
			assert.equal(result.structuredResult?.status, "completed");
			assert.equal(result.structuredResult?.summary, "finalized");
			assert.equal(result.resultFinalization?.succeeded, true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("returns a structured result that Evidence admission can consume", async () => {
		const root = await tmp();
		try {
			const { executor } = executorFor("omit-then-finalize");
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.structuredResult?.protocolVersion, 1);
			assert.equal(typeof result.structuredResult?.summary, "string");
			assert.ok(result.structuredResult);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails deterministically without a second finalization when the tool is still missing", async () => {
		const root = await tmp();
		try {
			const { executor, tracker } = executorFor("omit-then-missing", [], { ...policy, fallback: { enabled: false } });
			const result = await executor.run(request(root, "investigation"));
			assert.equal(tracker.promptCount, 2);
			assert.equal(result.terminalStatus, "invalid_child_result");
			assert.equal(result.resultFinalization?.outcome, "missing");
			assert.equal(result.structuredResult, undefined);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("classifies invalid finalization arguments as protocol/finalization failure", async () => {
		const root = await tmp();
		try {
			const { executor, tracker } = executorFor("omit-then-invalid", [], { ...policy, fallback: { enabled: false } });
			const result = await executor.run(request(root, "investigation"));
			assert.equal(tracker.promptCount, 2);
			assert.equal(result.resultFinalization?.outcome, "protocol_violation");
			assert.equal(result.terminalStatus, "invalid_child_result");
			assert.equal(result.structuredResult, undefined);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not loop after a work-phase protocol violation with no valid capture", async () => {
		const root = await tmp();
		try {
			const { executor, tracker } = executorFor("protocol-invalid");
			const result = await executor.run(request(root, "investigation"));
			assert.equal(tracker.promptCount, 1);
			assert.equal(result.terminalStatus, "invalid_child_result");
			assert.equal(result.structuredResult, undefined);
			assert.equal(result.resultFinalization?.attempted ?? false, false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("runs finalization after timeout same-route retry when retry work omits the result", async () => {
		const root = await tmp();
		try {
			const seen: string[] = [];
			const tracker = createTracker();
			const routingPolicy: RoutingPolicy = { ...policy, maxAttempts: 3, timeoutMs: 40, fallback: { enabled: true } };
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)], routingPolicy);
			let creates = 0;
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => {
					creates += 1;
					seen.push(options.route.routeId);
					const mode = creates === 1 ? "hang" : creates === 2 ? "omit-then-missing" : "complete";
					return fakeSessionHandle(options.resultProtocol, mode, tracker);
				},
			});
			const result = await executor.run({ ...request(root, "investigation"), timeoutMs: 40 });
			assert.equal(creates, 3);
			assert.deepEqual(seen, [id("route-a"), id("route-a"), id("route-b")]);
			assert.equal(result.attempts[0]?.failureAction, "RETRY_SAME_ROUTE");
			assert.equal(result.attempts[1]?.resultFinalization?.attempted, true);
			assert.equal(result.attempts[1]?.failureAction, "FALLBACK_NEXT_ROUTE");
			assert.equal(result.attempts[2]?.selectionKind, "fallback");
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.fallbackCount, 1);
			assert.equal(result.structuredResult?.summary, "child complete");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("completes after timeout same-route retry when retry finalization captures the result", async () => {
		const root = await tmp();
		try {
			const tracker = createTracker();
			const routingPolicy: RoutingPolicy = { ...policy, maxAttempts: 3, timeoutMs: 40, fallback: { enabled: true } };
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)], routingPolicy);
			let creates = 0;
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => {
					creates += 1;
					return fakeSessionHandle(options.resultProtocol, creates === 1 ? "hang" : "omit-then-finalize", tracker);
				},
			});
			const result = await executor.run({ ...request(root, "investigation"), timeoutMs: 40 });
			assert.equal(creates, 2);
			assert.equal(result.attempts[0]?.failureAction, "RETRY_SAME_ROUTE");
			assert.equal(result.attempts[1]?.resultFinalization?.outcome, "succeeded");
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.fallbackCount, 0);
			assert.equal(result.structuredResult?.summary, "finalized");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not run finalization after a work-phase infrastructure failure", async () => {
		const root = await tmp();
		try {
			const adapter = adapterFor([candidate("route-a", 0)], { ...policy, maxAttempts: 1, fallback: { enabled: false } });
			const tracker = createTracker();
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, fakeFactory("rate", tracker));
			const result = await executor.run(request(root, "investigation"));
			assert.equal(tracker.promptCount, 1);
			assert.notEqual(result.terminalStatus, "completed");
			assert.equal(result.resultFinalization?.attempted ?? false, false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not run finalization after a work-phase safety stop", async () => {
		const root = await tmp();
		try {
			const { executor, tracker } = executorFor("safety-stop");
			const result = await executor.run(request(root, "investigation"));
			assert.equal(tracker.promptCount, 1);
			assert.equal(result.resultFinalization?.outcome, "safety_stop");
			assert.equal(result.terminalStatus, "invalid_child_result");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not run finalization after work-phase cancellation", async () => {
		const root = await tmp();
		try {
			const adapter = adapterFor([candidate("route-a", 0)]);
			const tracker = createTracker();
			let createdResolve!: () => void;
			const created = new Promise<void>((resolve) => { createdResolve = resolve; });
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => {
					createdResolve();
					return fakeSessionHandle(options.resultProtocol, "hang", tracker);
				},
			});
			const controller = new AbortController();
			const pending = executor.run(request(root, "investigation"), controller.signal);
			await created;
			controller.abort();
			const result = await pending;
			assert.equal(result.terminalStatus, "cancelled");
			assert.equal(tracker.promptCount <= 1, true);
			assert.equal(result.resultFinalization?.attempted ?? false, false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("cancels when aborted during finalization", async () => {
		const root = await tmp();
		try {
			const adapter = adapterFor([candidate("route-a", 0)]);
			const tracker = createTracker();
			let secondPrompt!: () => void;
			const enteredFinalization = new Promise<void>((resolve) => { secondPrompt = resolve; });
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => fakeSessionHandle(options.resultProtocol, "omit-then-cancel", tracker, { onFinalizationStart: secondPrompt }),
			});
			const controller = new AbortController();
			const pending = executor.run(request(root, "investigation"), controller.signal);
			await Promise.race([
				enteredFinalization,
				new Promise((_, reject) => { setTimeout(() => reject(new Error("finalization was not entered")), 50); }),
			]);
			controller.abort();
			const result = await pending;
			assert.equal(result.terminalStatus, "cancelled");
			assert.equal(result.resultFinalization?.outcome, "cancelled");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("captures via finalization after mutation without creating another Attempt or fallback", async () => {
		const root = await tmp();
		try {
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)]);
			const seen: string[] = [];
			const tracker = createTracker();
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => {
					seen.push(options.route.routeId);
					return fakeSessionHandle(options.resultProtocol, "mutate-omit-then-finalize", tracker);
				},
			});
			const result = await executor.run(request(root, "implementation"));
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.potentialMutationObserved, true);
			assert.equal(result.fallbackCount, 0);
			assert.deepEqual(seen, [id("route-a")]);
			assert.equal(result.attempts.length, 1);
			assert.equal(result.structuredResult?.summary, "finalized");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not replay a mutated worker after finalization infrastructure failure", async () => {
		const root = await tmp();
		try {
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)]);
			const seen: string[] = [];
			const tracker = createTracker();
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => {
					seen.push(options.route.routeId);
					return fakeSessionHandle(options.resultProtocol, "mutate-omit-then-infra", tracker);
				},
			});
			const result = await executor.run(request(root, "implementation"));
			assert.equal(result.terminalStatus, "partial_mutation_requires_review");
			assert.equal(result.fallbackCount, 0);
			assert.deepEqual(seen, [id("route-a")]);
			assert.equal(result.resultFinalization?.outcome, "infrastructure_failure");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not create another Task or worker Attempt for finalization", async () => {
		const root = await tmp();
		try {
			const { executor } = executorFor("omit-then-finalize");
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.attempts.length, 1);
			assert.equal(result.attempts[0]?.resultFinalization?.outcome, "succeeded");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps Task → original Attempt → result lineage", async () => {
		const root = await tmp();
		try {
			const { executor } = executorFor("omit-then-finalize");
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.attempts[0]?.structuredResult?.summary, result.structuredResult?.summary);
			assert.equal(result.attempts[0]?.attemptId, result.attempts[0]?.attemptId);
			assert.ok(result.structuredResult);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not persist hidden reasoning or raw completion on the result", async () => {
		const root = await tmp();
		try {
			const { executor } = executorFor("omit-then-finalize");
			const result = await executor.run(request(root, "investigation"));
			const serialized = JSON.stringify(result);
			assert.equal(serialized.includes("hidden reasoning"), false);
			assert.equal("transcript" in result, false);
			assert.equal("rawCompletion" in result, false);
			assert.equal(result.structuredResult?.summary, "finalized");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reproduces DeepSeek-shaped omit then submit_agent_result completion", async () => {
		const root = await tmp();
		try {
			const { executor, tracker } = executorFor("omit-then-finalize");
			const result = await executor.run(request(root, "investigation"));
			assert.equal(tracker.promptCount, 2);
			assert.match(tracker.finalizationPrompt ?? "", /submit_agent_result/u);
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.resultFinalization?.outcome, "succeeded");
			assert.deepEqual(tracker.finalizationTools, ["submit_agent_result"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps invalid_child_result truthful when the bounded finalizer also fails", async () => {
		const root = await tmp();
		try {
			const { executor } = executorFor("omit", [], { ...policy, fallback: { enabled: false } });
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.terminalStatus, "invalid_child_result");
			assert.equal(result.resultFinalization?.outcome, "missing");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("falls back to another route after a non-mutating result-capability miss", async () => {
		const root = await tmp();
		try {
			const seen: string[] = [];
			const health: string[] = [];
			const tracker = createTracker();
			const adapter: RouteAttemptAdapter = {
				...adapterFor([candidate("route-a", 0), candidate("route-b", 1)]),
				recordFailure: async (routeId) => { health.push(`fail:${routeId}`); },
				recordSuccess: async (routeId) => { health.push(`ok:${routeId}`); },
			};
			let creates = 0;
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => {
					creates += 1;
					seen.push(options.route.routeId);
					return fakeSessionHandle(options.resultProtocol, creates === 1 ? "omit-then-missing" : "complete", tracker);
				},
			});
			const result = await executor.run(request(root, "investigation"));
			assert.deepEqual(seen, [id("route-a"), id("route-b")]);
			assert.equal(result.attempts[0]?.failureAction, "FALLBACK_NEXT_ROUTE");
			assert.equal(result.attempts[1]?.selectionKind, "fallback");
			assert.equal(result.attempts[1]?.outcome, "completed");
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.fallbackCount, 1);
			assert.equal(result.structuredResult?.summary, "child complete");
			assert.equal(health.includes(`fail:${id("route-a")}`), false);
			assert.equal(health.includes(`ok:${id("route-a")}`), true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("completes via route-B finalization after route-A result-capability miss", async () => {
		const root = await tmp();
		try {
			const seen: string[] = [];
			const tracker = createTracker();
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)]);
			let creates = 0;
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => {
					creates += 1;
					seen.push(options.route.routeId);
					return fakeSessionHandle(options.resultProtocol, creates === 1 ? "omit-then-missing" : "omit-then-finalize", tracker);
				},
			});
			const result = await executor.run(request(root, "investigation"));
			assert.deepEqual(seen, [id("route-a"), id("route-b")]);
			assert.equal(result.attempts[1]?.resultFinalization?.outcome, "succeeded");
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.structuredResult?.summary, "finalized");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not replay a mutated worker after result-capability miss", async () => {
		const root = await tmp();
		try {
			const seen: string[] = [];
			const { executor } = executorFor("mutate-omit-then-missing", seen);
			const result = await executor.run(request(root, "implementation"));
			assert.deepEqual(seen, [id("route-a")]);
			assert.equal(result.terminalStatus, "partial_mutation_requires_review");
			assert.equal(result.fallbackCount, 0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("stops result-capability failure when fallback is disabled", async () => {
		const root = await tmp();
		try {
			const seen: string[] = [];
			const { executor } = executorFor("omit-then-missing", seen, { ...policy, fallback: { enabled: false } });
			const result = await executor.run(request(root, "investigation"));
			assert.deepEqual(seen, [id("route-a")]);
			assert.equal(result.terminalStatus, "invalid_child_result");
			assert.equal(result.fallbackCount, 0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("returns no_eligible_route when result-capability fallback has no remaining route", async () => {
		const root = await tmp();
		try {
			const adapter = adapterFor([candidate("route-a", 0)], { ...policy, fallback: { enabled: true } });
			const tracker = createTracker();
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
				create: async (options) => fakeSessionHandle(options.resultProtocol, "omit-then-missing", tracker),
			});
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.terminalStatus, "no_eligible_route");
			assert.equal(result.attempts[0]?.failureAction, "FALLBACK_NEXT_ROUTE");
			assert.equal(result.structuredResult, undefined);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not treat a valid structured result as result-capability fallback", async () => {
		const root = await tmp();
		try {
			const seen: string[] = [];
			const { executor } = executorFor("complete", seen);
			const result = await executor.run(request(root, "investigation"));
			assert.deepEqual(seen, [id("route-a")]);
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.fallbackCount, 0);
			assert.equal(result.attempts[0]?.failureAction, undefined);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("declares constrainedSampling on the capture-only result tool", () => {
		const tool = createProtocolOnlyCaptureTool({
			toolName: "submit_agent_result",
			parameters: { type: "object" },
		}, createProtocolCaptureState());
		assert.deepEqual(tool.constrainedSampling, { type: "json_schema", strict: "prefer" });
	});

	it("uses the capture-only finalization prompt contract", () => {
		assert.match(resultFinalizationPrompt("submit_agent_result"), /Submit the result of the work already performed/u);
		assert.match(resultFinalizationPrompt("submit_agent_result"), /submit_agent_result exactly once/u);
	});
});

interface Tracker {
	promptCount: number;
	workTools: string[];
	finalizationTools?: string[];
	finalizationPrompt?: string;
}

function createTracker(): Tracker {
	return { promptCount: 0, workTools: ["read", "grep", "find", "ls", "submit_agent_result"] };
}

function executorFor(mode: FakeMode, seen: string[] = [], routingPolicy: RoutingPolicy = policy) {
	const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)], routingPolicy);
	const tracker = createTracker();
	const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, {
		create: async (options) => {
			seen.push(options.route.routeId);
			return fakeSessionHandle(options.resultProtocol, mode, tracker);
		},
	});
	return { executor, tracker, seen };
}

async function tmp(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-worker-finalize-"));
}

function request(cwd: string, poolId: SubagentExecutionRequest["poolId"]): SubagentExecutionRequest {
	return { roleId: "worker", poolId, task: "inspect the fixture", cwd, timeoutMs: 80 };
}

function candidate(routeId: string, poolPosition: number): RoutingCandidate {
	return {
		routeId: id(routeId),
		poolId: "implementation",
		poolPosition,
		poolEnabled: true,
		globalEnabled: true,
		remoteModelId: `remote/${routeId}`,
		availability: "available",
	};
}

function adapterFor(candidates: readonly RoutingCandidate[], routingPolicy: RoutingPolicy = policy): RouteAttemptAdapter {
	return {
		policy: routingPolicy,
		routingRequest: ({ request, attemptedRouteIds, excludedRouteIds }) => ({
			poolId: request.poolId,
			candidates: candidates.map((item) => ({ ...item, poolId: request.poolId })),
			policy: routingPolicy,
			now: new Date(),
			attemptedRouteIds,
			excludedRouteIds,
		}),
		resolveRoute: (routeId) => ({
			routeId,
			remoteModelId: candidates.find((item) => item.routeId === routeId)?.remoteModelId ?? "remote/missing",
			model: { id: candidates.find((item) => item.routeId === routeId)?.remoteModelId ?? "remote/missing", provider: "9router" } as ResolvedWorkerRoute["model"],
			modelRuntime: {} as ResolvedWorkerRoute["modelRuntime"],
		}),
	};
}

function fakeFactory(mode: FakeMode, tracker: Tracker): ChildSessionFactory {
	return { create: async (options) => fakeSessionHandle(options.resultProtocol, mode, tracker) };
}

function fakeSessionHandle(
	protocol: ChildResultProtocol,
	mode: FakeMode,
	tracker: Tracker,
	hooks: { onFinalizationStart?: () => void } = {},
): { session: AgentSession; toolNames: readonly string[]; protocolState: ReturnType<typeof createProtocolCaptureState>; dispose: () => void; safetyTerminated?: boolean } {
	const protocolState = createProtocolCaptureState();
	const submitTool = createProtocolOnlyCaptureTool(protocol, protocolState);
	let listener: ((event: unknown) => void) | undefined;
	let activeTools = ["read", "grep", "find", "ls", submitTool.name];
	let safetyTerminated = mode === "safety-stop";
	let turn = 0;
	const emitRead = () => {
		listener?.({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read" });
		listener?.({ type: "tool_execution_end", toolCallId: "read-1", toolName: "read", isError: false });
	};
	const emitEdit = () => {
		listener?.({ type: "tool_execution_start", toolCallId: "edit-1", toolName: "edit" });
		listener?.({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "edit", isError: false });
	};
	const emitSubmit = async (params: Record<string, unknown>) => {
		listener?.({ type: "tool_execution_start", toolCallId: "submit-1", toolName: submitTool.name });
		await submitTool.execute("result-1", params, undefined, undefined, undefined as never);
		listener?.({ type: "tool_execution_end", toolCallId: "submit-1", toolName: submitTool.name, isError: false });
	};
	const finish = (stopReason = "stop") => {
		const message = { role: "assistant", stopReason, usage: { input: 2, output: 1, totalTokens: 3 } };
		(session as { messages: unknown[] }).messages = [message];
		listener?.({ type: "message_end", message });
	};
	const session = {
		messages: [] as unknown[],
		agent: {},
		subscribe: (next: (event: unknown) => void) => {
			listener = next;
			return () => { listener = undefined; };
		},
		getActiveToolNames: () => [...activeTools],
		setActiveToolsByName: (names: string[]) => {
			activeTools = [...names];
		},
		prompt: async (text?: string) => {
			tracker.promptCount += 1;
			turn += 1;
			if (turn === 1) tracker.workTools = [...activeTools];
			if (mode === "hang") await new Promise<void>(() => undefined);
			if (mode === "rate") throw Object.assign(new Error("rate"), { status: 429 });
			if (turn === 1) {
				if (mode.startsWith("mutate-")) emitEdit();
				else emitRead();
				if (mode === "complete") {
					await emitSubmit({ status: "completed", summary: "child complete" });
					finish("toolUse");
					return;
				}
				if (mode === "protocol-invalid" || mode === "protocol-invalid-then-finalize") {
					await emitSubmit({ status: "nope", summary: "bad" });
					finish("toolUse");
					return;
				}
				if (mode === "safety-stop") {
					safetyTerminated = true;
					finish("toolUse");
					return;
				}
				finish("stop");
				return;
			}
			tracker.finalizationTools = [...activeTools];
			if (typeof text === "string") tracker.finalizationPrompt = text;
			hooks.onFinalizationStart?.();
			if (mode === "omit-then-cancel") await new Promise<void>(() => undefined);
			if (mode === "omit-then-infra" || mode === "mutate-omit-then-infra") throw Object.assign(new Error("502"), { status: 502 });
			if (mode === "omit-then-invalid") {
				await emitSubmit({ status: "nope", summary: "bad" });
				finish("toolUse");
				return;
			}
			if (mode === "omit-then-finalize" || mode === "mutate-omit-then-finalize" || mode === "protocol-invalid-then-finalize") {
				await emitSubmit({ status: "completed", summary: "finalized" });
				finish("toolUse");
				return;
			}
			finish("stop");
		},
		abort: async () => undefined,
		dispose: () => undefined,
	};
	return {
		session: session as unknown as AgentSession,
		toolNames: ["read", submitTool.name],
		protocolState,
		dispose: () => undefined,
		...(safetyTerminated ? { safetyTerminated: true } : {}),
	};
}
