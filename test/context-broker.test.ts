import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	ContextBroker,
	ContextBrokerError,
	assertPacketDigest,
	packetDigest,
	packetToSubagentRequest,
	renderTaskPacketPrompt,
	verifyPacketDigest,
	type ContextRepository,
} from "../src/core/context/index.js";

const repository = (items: readonly unknown[] = []): ContextRepository => ({
	getMission: () => ({
		missionId: "mission-1",
		revision: 7,
		goal: "Ship the bounded change",
		objective: "Ship the bounded change",
		constraints: ["keep the diff small"],
		acceptanceCriteria: ["tests pass"],
		repository: { cwd: "/tmp/project", revision: "abc123" },
	}),
	getTask: () => ({
		taskId: "task-1",
		missionId: "mission-1",
		roleId: "implementer",
		executionClass: "implementation",
		objective: "Implement the accepted finding",
		acceptanceCriteria: ["focused test passes"],
		allowedTools: ["read", "edit"],
		allowedActions: ["change-source"],
		outputSchemaId: "implementer-v1",
	}),
	listCanonicalItems: () => items as never,
});

describe("M6 Context Broker and Task Packets", () => {
	it("projects accepted canonical state only, redacts sensitive/transcript keys, and freezes the packet", () => {
		const broker = new ContextBroker(repository([
			{ itemId: "finding-b", kind: "finding", status: "approved", tags: ["src"], scopes: ["src"], value: { detail: "second" } },
			{ itemId: "finding-a", kind: "finding", status: "accepted", sourceEvidenceId: "evidence-a", tags: ["src"], scopes: ["src"], value: { detail: "first", apiKey: "do-not-copy", transcript: "do-not-copy" } },
			{ itemId: "finding-proposed", kind: "finding", status: "proposed", value: { detail: "not canonical" } },
			{ itemId: "finding-rejected", kind: "finding", status: "rejected", value: { detail: "not canonical" } },
			{ itemId: "boss-transcript", kind: "transcript", status: "approved", value: [{ role: "user", content: "do not copy" }] },
		]));
		const packet = broker.buildPacket({ missionId: "mission-1", taskId: "task-1", scopes: ["src"], tags: ["src"] });

		assert.deepEqual(packet.includedCanonicalItemIds, ["finding-a", "finding-b"]);
		assert.equal(packet.approvedFindings[0]?.itemId, "finding-a");
		assert.deepEqual(packet.approvedFindings[0]?.value, { detail: "first" });
		assert.equal(packet.approvedFindings[0]?.sourceEvidenceId, "evidence-a");
		assert.equal(packet.approvedFindings[0]?.validationStatus, "accepted");
		assert.equal(packet.omittedCount, 3);
		assert.equal(packet.sourceMissionRevision, 7);
		assert.equal(packet.canonicalGeneration, 7);
		assert.equal(verifyPacketDigest(packet), true);
		assert.equal(packet.digest, packetDigest(packet));
		assert.throws(() => (packet.approvedFindings as unknown as unknown[]).push({}), TypeError);
		assert.doesNotThrow(() => assertPacketDigest(packet));
	});

	it("keeps ordering, packet ID, and digest deterministic while reporting bounds", () => {
		const items = [
			{ itemId: "z", kind: "finding", value: { text: "z" } },
			{ itemId: "a", kind: "finding", value: { text: "a" } },
			{ itemId: "m", kind: "finding", value: { text: "m" } },
		];
		const input = { missionId: "mission-1", taskId: "task-1", maxItems: 1, maxChars: 8_000 } as const;
		const first = new ContextBroker(repository(items)).buildPacket(input);
		const second = new ContextBroker(repository([...items].reverse())).buildPacket(input);
		assert.deepEqual(first, second);
		assert.deepEqual(first.includedCanonicalItemIds, ["a"]);
		assert.equal(first.omittedCount, 2);
		assert.deepEqual(first.omittedItemIds, ["m", "z"]);
	});

	it("keeps the serialized packet within the explicit character bound", () => {
		const packet = new ContextBroker(repository([
			{ itemId: "a", kind: "finding", value: { detail: "a" } },
			{ itemId: "b", kind: "finding", value: { detail: "b" } },
		]), { maxChars: 1_024 }).buildPacket({
			missionId: "mission-1",
			taskId: "task-1",
			constraints: Array.from({ length: 20 }, (_, index) => "constraint-".repeat(20) + index),
		});
		assert.ok(JSON.stringify(packet).length <= 1_024);
		assert.equal(verifyPacketDigest(packet), true);
	});

	it("bounds omitted-ID detail while preserving the complete omitted count", () => {
		const items = Array.from({ length: 200 }, (_, index) => ({ itemId: `item-${index.toString().padStart(3, "0")}`, kind: "finding", value: { detail: index } }));
		const packet = new ContextBroker(repository(items), { maxItems: 1, maxChars: 1_024 }).buildPacket({ missionId: "mission-1", taskId: "task-1" });
		assert.equal(packet.omittedCount, items.length - packet.includedCanonicalItemIds.length);
		assert.ok(packet.omittedItemIds.length < packet.omittedCount);
		assert.ok(JSON.stringify(packet).length <= 1_024);
	});

	it("supports explicit packet-to-worker adaptation without copying a transcript", () => {
		const packet = new ContextBroker(repository([
			{ itemId: "finding-a", kind: "finding", status: "approved", value: { detail: "approved" } },
		])).buildPacket({ missionId: "mission-1", taskId: "task-1" });
		const request = packetToSubagentRequest(packet);
		assert.equal(request.roleId, "implementer");
		assert.equal(request.poolId, "implementation");
		assert.equal(request.cwd, "/tmp/project");
		assert.match(request.task, new RegExp(packet.packetId));
		assert.doesNotMatch(request.task, /transcript|apiKey/u);
		assert.equal(renderTaskPacketPrompt(packet), request.task);
	});

	it("rejects stale revision expectations and missing mission/task data", () => {
		const broker = new ContextBroker(repository());
		assert.throws(() => broker.buildPacket({ missionId: "mission-1", taskId: "task-1", sourceMissionRevision: 6 }), (error: unknown) => error instanceof ContextBrokerError && error.code === "revision-mismatch");
		assert.throws(() => new ContextBroker({ getMission: () => undefined }).buildPacket({ missionId: "mission-1", taskId: "task-1" }), (error: unknown) => error instanceof ContextBrokerError && error.code === "mission-not-found");
		assert.throws(() => new ContextBroker({ getMission: () => ({ missionId: "mission-1", revision: 1 }), getTask: () => undefined }).buildPacket({ missionId: "mission-1", taskId: "task-1" }), (error: unknown) => error instanceof ContextBrokerError && error.code === "task-not-found");
	});
});
