import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDefaultConfig, ConfigStore } from "../src/core/config/index.js";
import { createMissionStore, restoreMissionStore } from "../src/core/mission/index.js";
import { SQLiteAnalyticsStore, restoreAnalyticsStore, type AnalyticsEventV1 } from "../src/core/analytics/index.js";

const tempRoot = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix));

async function child(code: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { stdio: ["ignore", "pipe", "pipe"] });
		let out = ""; let err = "";
		proc.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
		proc.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
		proc.on("error", reject);
		proc.on("close", (status) => status === 0 ? resolve(out.trim()) : reject(new Error(`child failed ${status}: ${err}`)));
	});
}

test("mission lease allows one cross-process owner and rejects non-owner release", async () => {
	const root = await tempRoot("pmo-m10-lease-");
	try {
		const seed = createMissionStore({ root }); seed.createMission({ missionId: "m1", goal: "lease" }); seed.close();
		const modulePath = join(process.cwd(), "dist-test/src/core/mission/index.js");
		const script = `import { createMissionStore } from ${JSON.stringify(modulePath)}; const [root,owner]=process.argv.slice(-2); const s=createMissionStore({root}); try { const l=s.acquireLease("m1",owner,{ttlMs:5000}); console.log("acquired:"+l.owner); } catch (e) { console.log("rejected:"+(e?.code??"error")); } finally { s.close(); }`;
		const [a, b] = await Promise.all([child(script, [root, "owner-a"]), child(script, [root, "owner-b"])]);
		assert.equal([a, b].filter((value) => value.startsWith("acquired:")).length, 1);
		const store = createMissionStore({ root });
		assert.throws(() => store.releaseLease("m1", "not-owner"), /another process/u);
		store.releaseLease("m1", [a, b].find((value) => value.startsWith("acquired:"))!.slice("acquired:".length));
		store.close();
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("two processes cannot start the same task lease", async () => {
	const root = await tempRoot("pmo-m10-task-lease-");
	try {
		const seed = createMissionStore({ root }); seed.createMission({ missionId: "m1", goal: "task lease" }); seed.createTask({ taskId: "t1", missionId: "m1", roleId: "worker", executionClass: "implementation", objective: "work" }); seed.close();
		const modulePath = join(process.cwd(), "dist-test/src/core/mission/index.js");
		const script = `import { createMissionStore } from ${JSON.stringify(modulePath)}; const [root,owner]=process.argv.slice(-2); const s=createMissionStore({root}); try { const a=s.createAttempt({taskId:"t1",leaseOwner:owner,leaseTtlMs:5000}); console.log("started:"+a.attemptId); } catch (e) { console.log("rejected:"+(e?.code??"error")); } finally { s.close(); }`;
		const [a, b] = await Promise.all([child(script, [root, "owner-a"]), child(script, [root, "owner-b"])]);
		assert.equal([a, b].filter((value) => value.startsWith("started:")).length, 1);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("lease heartbeat rejects stale timestamps and recovery records prior owner", async () => {
	const root = await tempRoot("pmo-m10-lease-time-");
	try {
		let now = new Date("2026-01-01T00:00:00.000Z"); const store = createMissionStore({ root, clock: () => now }); store.createMission({ missionId: "m1", goal: "lease time" });
		const first = store.acquireLease("m1", "owner-a", { ttlMs: 100 }); now = new Date("2026-01-01T00:00:00.050Z"); assert.equal(store.heartbeatLease("m1", first.ownerToken ?? first.owner, 100).owner, "owner-a"); now = new Date("2026-01-01T00:00:00.150Z"); assert.throws(() => store.heartbeatLease("m1", "owner-a"), /expired/u);
		const recovered = store.acquireLease("m1", "owner-b", { ttlMs: 100 }); assert.equal(recovered.recoveredFrom, "owner-a"); now = new Date("2026-01-01T00:00:00.200Z"); assert.throws(() => store.acquireLease("m1", "owner-c"), /leased by another/u); store.close();
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("ConfigStore cross-process updates reread under the lock and preserve both fields", async () => {
	const root = await tempRoot("pmo-m10-config-");
	try {
		const store = new ConfigStore({ root }); await store.initialize(createDefaultConfig());
		const modulePath = join(process.cwd(), "dist-test/src/core/config/index.js");
		const script = `import { ConfigStore } from ${JSON.stringify(modulePath)}; const [root,field,value]=process.argv.slice(-3); const s=new ConfigStore({root}); await s.update(d=>{ if(field==="routing") d.routing.maxAttempts=Number(value); else d.safety.maxAgents=Number(value); });`;
		await Promise.all([child(script, [root, "routing", "2"]), child(script, [root, "safety", "3"])]);
		const loaded = await new ConfigStore({ root }).load();
		assert.equal(loaded.snapshot?.config.routing.maxAttempts, 2);
		assert.equal(loaded.snapshot?.config.safety.maxAgents, 3);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("SQLite backups are validated and explicit restore never invents state", async () => {
	const root = await tempRoot("pmo-m10-backup-");
	try {
		const mission = createMissionStore({ root }); mission.createMission({ missionId: "m1", goal: "backup" });
		const missionBackup = join(root, "mission-backup.sqlite"); await mission.backup!(missionBackup); mission.close();
		const raw = new DatabaseSync(join(root, "mission.sqlite")); raw.prepare("INSERT INTO missions(mission_id,revision,status,title,objective,goal,constraints_json,acceptance_json,repository_json,plan_json,approved_decisions_json,validated_findings_json,completed_work_json,current_change_state_json,test_review_evidence_json,unresolved_issues_json,next_steps_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("m2", 1, "draft", "m2", "m2", "m2", "[]", "[]", "{}", "null", "[]", "[]", "[]", "null", "[]", "[]", "[]", "2026-01-01", "2026-01-01"); raw.close();
		const restored = await restoreMissionStore({ root }, missionBackup); assert.deepEqual(restored.listMissions().map((item) => item.missionId), ["m1"]); restored.close();

		const analytics = new SQLiteAnalyticsStore({ root: join(root, "analytics"), enabled: true });
		const event: AnalyticsEventV1 = { eventId: "e1", occurredAt: "2026-01-01T00:00:00.000Z", eventType: "run", outcome: "success" }; analytics.append(event);
		const analyticsBackup = join(root, "analytics-backup.sqlite"); await analytics.backup(analyticsBackup); analytics.close();
		const analyticsRestored = await restoreAnalyticsStore({ root: join(root, "analytics-restored"), enabled: true }, analyticsBackup); assert.equal(analyticsRestored.list().length, 1); analyticsRestored.close();
		const emptyBackup = join(root, "empty.sqlite"); const empty = new DatabaseSync(emptyBackup); empty.close(); await assert.rejects(restoreMissionStore({ root: join(root, "invalid-restore") }, emptyBackup));
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("SQLite backup and restore reject normalized and inode aliases", async () => {
	const root = await tempRoot("pmo-alias-");
	try {
		const mission = createMissionStore({ root });
		mission.createMission({ missionId: "m1", goal: "alias" });
		await assert.rejects(() => mission.backup!(`${root}/./mission.sqlite`), /destination-matches-source/u);
		await symlink(join(root, "mission.sqlite"), join(root, "mission-alias.sqlite"));
		await assert.rejects(() => mission.backup!(join(root, "mission-alias.sqlite")), /destination-matches-source/u);
		const missionBackup = join(root, "mission-backup.sqlite");
		await mission.backup!(missionBackup);
		mission.close();
		await assert.rejects(() => restoreMissionStore({ root, databasePath: `${root}/./mission-backup.sqlite` }, missionBackup), /source-matches-destination/u);

		const analyticsRoot = join(root, "analytics");
		const analytics = new SQLiteAnalyticsStore({ root: analyticsRoot, enabled: true });
		await assert.rejects(() => analytics.backup(`${analyticsRoot}/./analytics.sqlite`), /destination-matches-source/u);
		await symlink(join(analyticsRoot, "analytics.sqlite"), join(analyticsRoot, "analytics-alias.sqlite"));
		await assert.rejects(() => analytics.backup(join(analyticsRoot, "analytics-alias.sqlite")), /destination-matches-source/u);
		const analyticsBackup = join(analyticsRoot, "analytics-backup.sqlite");
		await analytics.backup(analyticsBackup);
		analytics.close();
		await assert.rejects(() => restoreAnalyticsStore({ root: analyticsRoot, databasePath: `${analyticsRoot}/./analytics-backup.sqlite`, enabled: true }, analyticsBackup), /source-matches-destination/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("corrupt analytics schema degrades to diagnostics instead of taking down callers", async () => {
	const root = await tempRoot("pmo-m10-analytics-corrupt-");
	try {
		const path = join(root, "analytics.sqlite"); const store = new SQLiteAnalyticsStore({ root, enabled: true }); store.close();
		const raw = new DatabaseSync(path); raw.prepare("UPDATE analytics_meta SET value='99' WHERE key='schema_version'").run(); raw.close();
		const degraded = new SQLiteAnalyticsStore({ root, enabled: true }); assert.ok(degraded.diagnostics.length > 0); assert.deepEqual(degraded.list(), []); assert.equal(degraded.append({ eventId: "x", occurredAt: "2026-01-01T00:00:00.000Z", eventType: "run" }), false); degraded.close();
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("config fault injection leaves no silent empty replacement", async () => {
	const root = await tempRoot("pmo-m10-fault-");
	try {
		let fail = true; const store = new ConfigStore({ root, hooks: { fault: (point) => { if (point === "active-write" && fail) throw new Error("injected"); } } });
		await assert.rejects(store.initialize(createDefaultConfig())); fail = false; await store.initialize(createDefaultConfig()); const before = await readFile(join(root, "config.json"));
		fail = true; await assert.rejects(store.update((draft) => { draft.routing.maxAttempts = 2; })); assert.deepEqual(await readFile(join(root, "config.json")), before);
	} finally { await rm(root, { recursive: true, force: true }); }
});
