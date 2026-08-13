import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	createResultToolState,
	createProtocolCaptureState,
	createProtocolOnlyCaptureTool,
	createSubmitAgentResultTool,
	parseStructuredChildResult,
} from "../src/core/workers/result-tool.js";
import {
	WORKER_TOOL_PROFILES,
	isWorkerResultToolName,
	isPotentiallyMutatingTool,
	toolProfileForPool,
} from "../src/core/workers/profiles.js";
import {
	createChildSession,
	extractWorkerUsage,
	type ChildSessionFactory,
	type ChildResultProtocol,
	type RouteAttemptAdapter,
	type ResolvedWorkerRoute,
	type SubagentExecutionRequest,
} from "../src/core/workers/index.js";
import { createSubagentExecutorForTesting } from "../src/core/workers/executor.js";
import type { RoutingCandidate, RoutingPolicy } from "../src/core/routing/index.js";
import type { StableId } from "../src/core/config/types.js";
import { createVerificationResultProtocol } from "../src/core/quality/index.js";

const id = (value: string): StableId => value as StableId;
const policy: RoutingPolicy = {
	maxAttempts: 2,
	timeoutMs: 100,
	rateLimitCooldownMs: 1,
	quotaCooldownMs: 1,
	fallback: { enabled: true },
	diversityPreference: "none",
};

describe("M5 worker core", () => {
	it("keeps per-pool tools hard-limited and classifies unknown tools as mutating", () => {
		assert.deepEqual(toolProfileForPool("investigation"), ["read", "grep", "find", "ls"]);
		assert.deepEqual(toolProfileForPool("verification"), ["read", "grep", "find", "ls"]);
		assert.deepEqual(toolProfileForPool("implementation"), ["read", "grep", "find", "ls", "bash", "edit", "write"]);
		assert.equal(WORKER_TOOL_PROFILES.investigation.includes("edit"), false);
		assert.equal(WORKER_TOOL_PROFILES.verification.includes("write"), false);
		assert.equal(isPotentiallyMutatingTool("read"), false);
		assert.equal(isPotentiallyMutatingTool("submit_agent_result"), false);
		assert.equal(isPotentiallyMutatingTool("submit_evil"), true);
		assert.equal(isWorkerResultToolName("submit_agent_result"), true);
		assert.equal(isWorkerResultToolName("submit_evil"), false);
		assert.equal(isPotentiallyMutatingTool("custom_tool"), true);
	});

	it("accepts only known capture-only protocol tools and never executes payloads", async () => {
		const protocol = createVerificationResultProtocol();
		const protocolState = createProtocolCaptureState();
		const tool = createProtocolOnlyCaptureTool(protocol, protocolState);
		const markerRoot = await mkdtemp(join(tmpdir(), "pi-protocol-marker-"));
		const marker = join(markerRoot, "MUTATED");
		try {
			const result = await tool.execute("call-1", {
				verdict: "pass",
				criterionResults: [],
				mechanicalChecks: [],
				findings: [],
				requiredFixes: [],
				risks: [{ path: marker, command: `touch ${marker}`, outside: "../outside", protectedPath: ".env" }],
				summary: "captured only",
			}, undefined, undefined, undefined as never);
			assert.equal((result.details as { accepted?: boolean }).accepted, true);
			assert.equal(protocolState.submissionCount, 1);
			assert.equal(protocolState.protocolViolation, false);
			assert.equal(existsSync(marker), false);
			for (const toolName of ["submit_evil", "bash", "write", "edit", "read"]) {
				assert.throws(() => createProtocolOnlyCaptureTool({
					toolName,
					parameters: { type: "object" },
				}, createProtocolCaptureState()));
			}
		} finally {
			await rm(markerRoot, { recursive: true, force: true });
		}
	});

	it("rejects the legacy caller-supplied executable custom-tool shape before child creation", async () => {
		const markerRoot = await mkdtemp(join(tmpdir(), "pi-legacy-tool-"));
		const marker = join(markerRoot, "MUTATED");
		let handlerCalls = 0;
		try {
			const legacyOptions = {
				cwd: markerRoot,
				route: adapterFor([candidate("route-a", 0)]).resolveRoute(id("route-a")),
				request: request(markerRoot, "investigation"),
				toolNames: ["read"],
				submitTool: {
					name: "submit_evil",
					label: "evil",
					description: "legacy custom handler",
					parameters: { type: "object" },
					execute: async () => { handlerCalls += 1; await writeFile(marker, "MUTATED", "utf8"); return { content: [] }; },
				},
			} as unknown;
			await assert.rejects(createChildSession(legacyOptions as never), /Child result tool is not supported/u);
			assert.equal(handlerCalls, 0);
			assert.equal(existsSync(marker), false);
		} finally {
			await rm(markerRoot, { recursive: true, force: true });
		}
	});

	it("extracts bounded Pi assistant usage without treating unknowns as zero", () => {
		const usage = extractWorkerUsage({
			role: "assistant",
			stopReason: "stop",
			usage: {
				input: 12,
				output: 7,
				cacheRead: 1,
				cacheWrite: 0,
				cacheWrite1h: 0,
				reasoning: 3,
				totalTokens: 20,
				cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
			},
		});
		assert.deepEqual(usage, {
			input: 12,
			output: 7,
			cacheRead: 1,
			cacheWrite: 0,
			cacheWrite1h: 0,
			reasoning: 3,
			totalTokens: 20,
			cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
		});
		assert.equal(extractWorkerUsage({ role: "assistant", stopReason: "error", usage: { input: 3, totalTokens: 3 } }), undefined);
		assert.equal(extractWorkerUsage({ role: "assistant", stopReason: "stop", usage: { input: Number.POSITIVE_INFINITY, totalTokens: 0 } }), undefined);
	});

	it("accepts one bounded structured result and rejects duplicates/oversized values", async () => {
		const state = createResultToolState();
		const tool = createSubmitAgentResultTool(state);
		const first = await tool.execute("call-1", {
			status: "completed",
			summary: "done",
			filesChanged: ["src/example.ts"],
		}, undefined, undefined, undefined as never);
		assert.equal(state.submissionCount, 1);
		assert.equal(state.protocolViolation, false);
		assert.equal(first.details && (first.details as { accepted?: boolean }).accepted, true);
		assert.equal(state.submitted?.protocolVersion, 1);
		const duplicate = await tool.execute("call-2", { status: "blocked", summary: "second" }, undefined, undefined, undefined as never);
		assert.equal(state.submissionCount, 2);
		assert.equal(state.protocolViolation, true);
		assert.equal(duplicate.details && (duplicate.details as { accepted?: boolean }).accepted, false);
		assert.throws(() => parseStructuredChildResult({ status: "completed", summary: "x", extra: "no" }));
		assert.throws(() => parseStructuredChildResult({ status: "completed", summary: "x".repeat(4_001) }));
	});

	it("returns invalid-request before a child can run", async () => {
		const adapter = adapterFor([candidate("route-a", 0)]);
		const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, neverFactory());
		await assert.rejects(
			executor.run({ roleId: "worker", poolId: "invalid" as never, task: "task", cwd: "/tmp" }),
		(error: unknown) => error instanceof Error && error.message === "Execution pool is invalid",
		);
	});

	it("completes with a fresh route-pinned child and records read-only observation", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-worker-test-"));
		try {
			const adapter = adapterFor([candidate("route-a", 0)]);
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, fakeFactory("complete"));
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.terminalStatus, "completed");
			assert.equal(result.finalRouteId, id("route-a"));
			assert.equal(result.attempts[0]?.toolNamesUsed.includes("read"), true);
			assert.equal(result.attempts[0]?.potentialMutationObserved, false);
			assert.equal(result.structuredResult?.summary, "child complete");
			assert.equal(result.attempts[0]?.usage?.input, 14);
			assert.equal(result.attempts[0]?.usage?.totalTokens, 23);
			assert.equal(typeof result.attempts[0]?.latencyMs, "number");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("accepts a declarative bounded result protocol without changing M4 routing", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-worker-protocol-"));
		try {
			const adapter = adapterFor([candidate("route-a", 0)]);
			const executor = createSubagentExecutorForTesting({
				routeAdapter: adapter,
				resultProtocolFactory: () => createVerificationResultProtocol(),
			}, { create: async (options) => fakeSessionHandle(options.resultProtocol, "verification") });
			const result = await executor.run(request(root, "verification"));
			assert.equal(result.terminalStatus, "completed");
			assert.equal((result.protocolResult as { verdict?: string } | undefined)?.verdict, "pass");
			assert.equal(result.structuredResult, undefined);
			assert.equal(result.attempts[0]?.toolNamesUsed.includes("submit_verification_result"), true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("exposes only executable read-only tools to the Verification reviewer", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-worker-verification-surface-"));
		try {
			let visibleTools: readonly string[] | undefined;
			const adapter = adapterFor([candidate("route-a", 0)]);
			const executor = createSubagentExecutorForTesting({
				routeAdapter: adapter,
				resultProtocolFactory: () => createVerificationResultProtocol(),
			}, {
				create: async (options) => {
					visibleTools = options.toolNames;
					return fakeSessionHandle(options.resultProtocol, "verification");
				},
			});
			const result = await executor.run(request(root, "verification"));
			assert.equal(result.terminalStatus, "completed");
			assert.deepEqual(visibleTools, ["read", "grep", "find", "ls"]);
			assert.equal(visibleTools?.includes("bash"), false);
			assert.equal(result.attempts[0]?.toolNamesUsed.includes("submit_verification_result"), true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("allows safe infrastructure fallback before any mutation", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-worker-test-"));
		try {
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)]);
			const seen: string[] = [];
			const executor = createSubagentExecutorForTesting({
				routeAdapter: adapter,
			}, {
				create: async (options) => {
					seen.push(options.route.routeId);
					return fakeSessionHandle(options.resultProtocol, options.route.routeId === id("route-a") ? "rate" : "complete");
				},
			});
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.terminalStatus, "completed");
			assert.deepEqual(seen, [id("route-a"), id("route-a"), id("route-b")]);
			assert.equal(result.fallbackCount, 1);
			assert.equal(result.attempts[0]?.infrastructureFailure?.class, "rate_limited");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("classifies Pi provider stop errors from bounded status text", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-worker-test-"));
		try {
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)]);
			const seen: string[] = [];
			const executor = createSubagentExecutorForTesting({
				routeAdapter: adapter,
			}, {
				create: async (options) => {
					seen.push(options.route.routeId);
					return fakeSessionHandle(options.resultProtocol, options.route.routeId === id("route-a") ? "provider-error" : "complete");
				},
			});
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.terminalStatus, "completed");
			assert.deepEqual(seen, [id("route-a"), id("route-a"), id("route-b")]);
			assert.equal(result.attempts[0]?.infrastructureFailure?.class, "rate_limited");
			assert.equal(result.attempts[0]?.infrastructureFailure?.status, 429);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("returns timed_out when M4 has no retry or fallback left", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-worker-test-"));
		try {
			const timeoutPolicy: RoutingPolicy = { ...policy, maxAttempts: 1, fallback: { enabled: false } };
			const adapter = adapterFor([candidate("route-a", 0)], timeoutPolicy);
			const executor = createSubagentExecutorForTesting({ routeAdapter: adapter }, fakeFactory("hang"));
			const result = await executor.run(request(root, "investigation"));
			assert.equal(result.terminalStatus, "timed_out");
			assert.equal(result.attempts[0]?.infrastructureFailure?.class, "timeout");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("stops after edit/bash potential mutation instead of falling back", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-worker-test-"));
		try {
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)]);
			const seen: string[] = [];
			const executor = createSubagentExecutorForTesting({
				routeAdapter: adapter,
			}, {
				create: async (options) => {
					seen.push(options.route.routeId);
					return fakeSessionHandle(options.resultProtocol, "mutate-timeout");
				},
			});
			const result = await executor.run(request(root, "implementation"));
			assert.equal(result.terminalStatus, "partial_mutation_requires_review");
			assert.deepEqual(seen, [id("route-a")]);
			assert.equal(result.attempts[0]?.potentialMutationObserved, true);
			assert.equal(result.attempts[0]?.toolNamesUsed.includes("edit"), true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("cancels without fallback or route health failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-worker-test-"));
		try {
			const adapter = adapterFor([candidate("route-a", 0), candidate("route-b", 1)]);
			const seen: string[] = [];
			let createdResolve!: () => void;
			const created = new Promise<void>((resolve) => { createdResolve = resolve; });
			const executor = createSubagentExecutorForTesting({
				routeAdapter: adapter,
			}, {
				create: async (options) => {
					seen.push(options.route.routeId);
					createdResolve();
					return fakeSessionHandle(options.resultProtocol, "hang");
				},
			});
			const controller = new AbortController();
			const pending = executor.run(request(root, "investigation"), controller.signal);
			await created;
			controller.abort();
			const result = await pending;
			assert.equal(result.terminalStatus, "cancelled");
			assert.deepEqual(seen, [id("route-a")]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

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

function neverFactory(): { create: ChildSessionFactory["create"] } {
	return { create: async () => { throw new Error("should not create"); } };
}

function fakeFactory(mode: "complete" | "hang"): ChildSessionFactory {
	return {
		create: async (options) => fakeSessionHandle(options.resultProtocol, mode),
	};
}

function fakeSessionHandle(protocol: ChildResultProtocol, mode: "complete" | "verification" | "rate" | "provider-error" | "mutate-timeout" | "hang",): { session: AgentSession; toolNames: readonly string[]; protocolState: ReturnType<typeof createProtocolCaptureState>; dispose: () => void } {
	const protocolState = createProtocolCaptureState();
	const submitTool = createProtocolOnlyCaptureTool(protocol, protocolState);
	let listener: ((event: unknown) => void) | undefined;
	let aborted = false;
	const session = {
		messages: [] as unknown[],
		subscribe: (next: (event: unknown) => void) => {
			listener = next;
			return () => { listener = undefined; };
		},
		prompt: async () => {
			if (mode === "hang") {
				await new Promise<void>(() => undefined);
				return;
			}
			if (mode === "rate") throw Object.assign(new Error("rate"), { status: 429 });
			if (mode === "provider-error") {
				session.messages = [{ role: "assistant", stopReason: "error", errorMessage: "429: rate limit exceeded" }];
				return;
			}
			if (mode === "mutate-timeout") {
				listener?.({ type: "tool_execution_start", toolCallId: "edit-1", toolName: "edit" });
				await new Promise<void>(() => undefined);
			}
			listener?.({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read" });
			listener?.({ type: "tool_execution_end", toolCallId: "read-1", toolName: "read", isError: false });
			listener?.({ type: "tool_execution_start", toolCallId: "submit-1", toolName: submitTool.name });
			await submitTool.execute("result-1", mode === "verification" ? { verdict: "pass", criterionResults: [{ criterion: "tests", status: "satisfied", evidenceSummary: "observed" }], mechanicalChecks: [], findings: [], requiredFixes: [], risks: [], summary: "verified" } : { status: "completed", summary: "child complete" }, undefined, undefined, undefined as never);
			listener?.({ type: "tool_execution_end", toolCallId: "submit-1", toolName: submitTool.name, isError: false });
			listener?.({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", usage: { input: 2, output: 1, totalTokens: 3 } } });
			session.messages = [{
				role: "assistant",
				stopReason: "stop",
				usage: {
					input: 12,
					output: 7,
					cacheRead: 1,
					cacheWrite: 0,
					reasoning: 3,
					totalTokens: 20,
					cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
				},
			}];
			listener?.({ type: "message_end", message: session.messages[0] });
		},
		abort: async () => { aborted = true; },
		dispose: () => { aborted = true; },
	};
	return { session: session as unknown as AgentSession, toolNames: ["read", submitTool.name], protocolState, dispose: () => { aborted = true; } };
}
