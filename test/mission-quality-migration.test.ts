import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { createMissionStore } from "../src/core/mission/index.js";
import { MISSION_STORE_SCHEMA_V1_SQL } from "../src/core/mission/schema.js";

describe("MissionStore M7 schema migration", () => {
	it("migrates a real v1 database without rewriting M6 rows", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-mission-m7-migration-"));
		try {
			const path = join(root, "mission.sqlite");
			const db = new DatabaseSync(path);
			db.exec(MISSION_STORE_SCHEMA_V1_SQL);
			db.prepare("INSERT INTO mission_store_meta(key,value) VALUES ('schema_version','1')").run();
			db.prepare("INSERT INTO missions(mission_id,revision,status,title,objective,goal,constraints_json,acceptance_json,repository_json,plan_json,approved_decisions_json,validated_findings_json,completed_work_json,current_change_state_json,test_review_evidence_json,unresolved_issues_json,next_steps_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("m1", 2, "running", "Title", "Objective", "Goal", "[\"constraint\"]", "[\"tests\"]", "{\"revision\":\"r1\"}", "{\"step\":1}", "[]", "[]", "[]", "{\"status\":\"running\"}", "[]", "[]", "[\"next\"]", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z");
			db.prepare("INSERT INTO mission_revisions(mission_id,revision,snapshot_json,created_at) VALUES (?,?,?,?)").run("m1", 2, "{\"goal\":\"Goal\"}", "2026-01-01T00:00:01.000Z");
			db.prepare("INSERT INTO tasks(task_id,mission_id,revision,role_id,execution_class,pool_id,objective,constraints_json,acceptance_json,allowed_tools_json,allowed_actions_json,packet_json,packet_revision,last_run_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("t1", "m1", 2, "implementer", "implementation", "implementation", "Implement", "[]", "[\"tests\"]", "[\"read\"]", "[\"inspect\"]", "{\"packetVersion\":1}", 3, "a1", "execution_completed", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z");
			db.prepare("INSERT INTO attempts(attempt_id,task_id,mission_id,revision,route_id,remote_model_id,status,started_at,mutation_observed,packet_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("a1", "t1", "m1", 3, "route-a", "model-a", "succeeded", "2026-01-01T00:00:00.000Z", 0, 3, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z");
			db.prepare("INSERT INTO evidence(evidence_id,mission_id,task_id,attempt_id,kind,status,content_json,artifact_refs_json,source_revision,admitted_at,packet_revision,run_id,route_id,remote_model_id,role_id,execution_class) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("e1", "m1", "t1", "a1", "finding", "accepted", "{\"ok\":true}", "[\"file.ts\"]", 2, "2026-01-01T00:00:01.000Z", 3, "a1", "route-a", "model-a", "implementer", "implementation");
			db.prepare("INSERT INTO canonical_items(item_id,mission_id,revision,kind,value_json,source_evidence_id,promoted_at) VALUES (?,?,?,?,?,?,?)").run("c1", "m1", 2, "finding", "{\"ok\":true}", "e1", "2026-01-01T00:00:01.000Z");
			db.prepare("INSERT INTO mission_checkpoints(checkpoint_id,mission_id,revision,kind,status,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?)").run("cp1", "m1", 2, "task-ended", "running", "{\"goal\":\"Goal\"}", "2026-01-01T00:00:01.000Z");
			db.prepare("INSERT INTO mission_events(event_id,mission_id,revision,kind,actor,payload_json,created_at) VALUES (?,?,?,?,?,?,?)").run("ev1", "m1", 2, "task-ended", "system", "{\"taskId\":\"t1\"}", "2026-01-01T00:00:01.000Z");
			db.close();

			const store = createMissionStore({ root, id: () => "generated" });
			assert.equal(store.getMission("m1")?.goal, "Goal");
			assert.equal(store.getTask("t1")?.packetRevision, 3);
			assert.equal(store.listEvidence("m1").length, 1);
			assert.equal(store.listCanonicalItems("m1").length, 1);
			assert.equal(store.listCheckpoints("m1").length, 1);
			assert.equal(store.listEvents("m1").length, 1);
			assert.deepEqual(store.getTaskQualityStatus("t1")?.status, "unverified");

			const verification = store.createVerificationRun({ missionId: "m1", taskId: "t1", targetRunId: "a1", targetPacketId: "packet-3", implementationRouteId: "route-a" });
			const decision = store.recordQualityDecision({ missionId: "m1", taskId: "t1", verificationId: verification.verificationId, targetRunId: "a1", targetPacketId: "packet-3", round: 0, reviewerSummary: "rejected", reviewerRouteId: "route-b", gate: { verdict: "reject", reasons: ["criterion failed"], criterionResults: [{ criterion: "tests", status: "failed", evidenceSummary: "failed" }], mechanicalChecks: [] } });
			const escalation = store.createQualityEscalation({ missionId: "m1", taskId: "t1", rejectedRunId: "a1", verificationId: verification.verificationId, qualityRound: 0, failedCriteria: ["tests"], requiredFixes: ["fix tests"], reviewerFindings: ["failure"], priorImplementationRouteIds: ["route-a"], reviewerRouteId: "route-b" });
			store.setTaskQualityStatus({ taskId: "t1" as never, missionId: "m1" as never, status: "rejected", qualityRound: 0, latestVerificationId: verification.verificationId, latestDecisionId: decision.decisionId, updatedAt: decision.createdAt });
			assert.equal(store.listVerificationRuns("m1", "t1").length, 1);
			assert.equal(store.listQualityDecisions("m1", "t1")[0]?.verdict, "reject");
			assert.equal(store.listQualityEscalations("m1", "t1")[0]?.escalationId, escalation.escalationId);
			store.close();

			const reopened = createMissionStore({ root });
			const raw = new DatabaseSync(path);
			assert.equal(raw.prepare("SELECT value FROM mission_store_meta WHERE key='schema_version'").get()?.value, "2");
			const migratedMission = raw.prepare("SELECT mission_id,revision FROM missions").get() as { mission_id: string; revision: number };
			assert.equal(migratedMission.mission_id, "m1");
			assert.equal(migratedMission.revision, 2);
			assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM task_quality_status").get()?.count, 1);
			raw.close();
			assert.equal(reopened.getTaskQualityStatus("t1")?.status, "rejected");
			reopened.integrityCheck();
			reopened.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
