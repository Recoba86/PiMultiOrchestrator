import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	deriveAcceptanceCriteriaFromGoal,
	extractLabelledAcceptanceCriteria,
	resolveMissionAcceptanceCriteria,
} from "../src/core/mission/acceptance-criteria.js";
import { createCanonicalMission, createMissionStore } from "../src/core/mission/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("RC27 Goal acceptance-criteria bootstrap", () => {
	it("extracts labelled Mission acceptance criteria without requiring a giant prompt format", () => {
		const goal = [
			"Perform a bounded docs-only repository task.",
			"",
			"Mission acceptance criteria:",
			"- docs mention the orchestrator loop",
			"- no production code changes",
			"",
			"Next steps: start planning",
		].join("\n");
		assert.deepEqual(extractLabelledAcceptanceCriteria(goal), [
			"docs mention the orchestrator loop",
			"no production code changes",
		]);
		assert.deepEqual(
			extractLabelledAcceptanceCriteria("Ship the fix.\nAcceptance criteria: tests pass; review complete"),
			["tests pass", "review complete"],
		);
		assert.deepEqual(extractLabelledAcceptanceCriteria("Just a free-form goal with no labelled section"), []);
	});

	it("lets explicit user criteria outrank labelled and derived criteria", () => {
		const goal = "Do the work\nSuccess criteria:\n- labelled item";
		assert.deepEqual(resolveMissionAcceptanceCriteria(goal, ["keep the explicit criterion"]).provenance, "explicit");
		assert.deepEqual(resolveMissionAcceptanceCriteria(goal, ["keep the explicit criterion"]).criteria, ["keep the explicit criterion"]);
		assert.equal(resolveMissionAcceptanceCriteria(goal).provenance, "labelled-goal");
		assert.equal(resolveMissionAcceptanceCriteria("Ship a bounded docs-only change").provenance, "derived-from-goal");
		assert.match(deriveAcceptanceCriteriaFromGoal("Ship a bounded docs-only change")[0] ?? "", /Ship a bounded docs-only change/u);
	});

	it("persists non-zero Goal criteria on autonomous Mission creation", async () => {
		const root = await mkdtemp(join(tmpdir(), "pmo-rc27-criteria-"));
		try {
			const store = createMissionStore({ root });
			const labelled = createCanonicalMission(store, "Goal text\nAcceptance criteria:\n- durable docs proof");
			assert.deepEqual(labelled.acceptanceCriteria, ["durable docs proof"]);
			const derived = createCanonicalMission(store, "Perform a bounded docs-only repository task");
			assert.equal(derived.acceptanceCriteria.length > 0, true);
			const explicit = createCanonicalMission(store, "Goal text\nAcceptance criteria:\n- ignored labelled", { acceptanceCriteria: ["user supplied"] });
			assert.deepEqual(explicit.acceptanceCriteria, ["user supplied"]);
			store.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
