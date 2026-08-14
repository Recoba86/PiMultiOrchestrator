import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	buildRoutingSignature,
	RoutingMemoryStore,
	routingSignatureSimilarity,
	type RoutingMemoryRuleView,
} from "../src/core/routing-memory/index.js";

const NOW = "2026-08-14T00:00:00.000Z";
const complexPrompt = "Investigate the auth bug, fix the root cause, add tests, then verify independently";
const simplePrompt = "What is a closure?";
type StoreOptions = Omit<ConstructorParameters<typeof RoutingMemoryStore>[0], "root">;
const makeStore = (root: string, options: StoreOptions = {}): RoutingMemoryStore => {
	let id = 0;
	return new RoutingMemoryStore({ root, now: () => NOW, id: () => `rm-test-${++id}`, ...options });
};

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-routing-memory-"));
	try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("signatures are versioned, abstract, bilingual, and accept M12.2 signals", () => {
	const raw = "RAW_PROMPT_SHOULD_NEVER_BE_RETURNED";
	const signature = buildRoutingSignature(raw, { path: "complex", signals: ["investigation", "mutation", "tests_requested", "independent_verification"] });
	assert.equal(signature.schemaVersion, 1);
	assert.equal("prompt" in signature, false);
	assert.equal(signature.investigation, true);
	assert.equal(signature.mutation, true);
	assert.equal(signature.testing, true);
	assert.equal(signature.verification, true);
	assert.equal(buildRoutingSignature("Explain this function").language, "en");
	assert.equal(buildRoutingSignature("این تابع را توضیح بده").language, "fa");
	assert.equal(buildRoutingSignature("Explain این تابع را توضیح بده").language, "mixed");
	assert.equal(buildRoutingSignature("این تابع را توضیح بده").taskFamily, "explanation");
});

test("similarity is conservative around intent, complexity, and keyword-only overlap", () => {
	const explanation = buildRoutingSignature("Explain how this function works");
	const complex = buildRoutingSignature("Delete the production database and redeploy it");
	const simple = buildRoutingSignature("Run tests once");
	const keywordA = buildRoutingSignature("Fix this issue");
	const keywordB = buildRoutingSignature("Fix another issue");
	const repositoryWork = buildRoutingSignature("Audit the repository and fix findings");
	const fileWork = buildRoutingSignature("Fix the bug in src/auth.ts");
	assert.ok(routingSignatureSimilarity(explanation, complex) <= 0.2);
	assert.ok(routingSignatureSimilarity(simple, complex) <= 0.2);
	assert.ok(routingSignatureSimilarity(keywordA, keywordB) <= 0.66);
	assert.ok(routingSignatureSimilarity(repositoryWork, fileWork) < 0.78);
	assert.ok(routingSignatureSimilarity(buildRoutingSignature("Explain this function"), buildRoutingSignature("این تابع را توضیح بده")) >= 0.78);
});

test("representative English, Persian, and mixed semantic cases match", () => {
	const scenarios: readonly (readonly [string, string])[] = [
		["Explain this function", "این تابع را توضیح بده"],
		["What does this test do?", "این تست چه کاری انجام می‌دهد؟"],
		["How does the retry counter work?", "شمارنده تلاش مجدد چگونه کار می‌کند؟"],
		["Summarize this paragraph", "این پاراگراف را خلاصه کن"],
		["Translate this sentence", "این جمله را ترجمه کن"],
		["Why is this value null?", "چرا این مقدار خالی است؟"],
		["Rename the variable in src/user.ts", "متغیر src/user.ts را تغییر نام بده"],
		["Create README.md", "فایل README.md را ایجاد کن"],
		["Run the tests in src/", "تست‌های src را اجرا کن"],
		["Update this config file", "این فایل تنظیمات را به‌روزرسانی کن"],
		["Format config.json", "config.json را قالب‌بندی کن"],
		["Remove the unused import in src/index.ts", "import بدون استفاده در src/index.ts را حذف کن"],
		["Investigate the auth bug and fix it", "باگ احراز هویت را بررسی و اصلاح کن"],
		["Implement the API feature and add tests", "قابلیت API را پیاده‌سازی و تست اضافه کن"],
		["Audit the repository and remediate findings", "مخزن را ممیزی کن و یافته‌ها را رفع کن"],
		["Research options and implement the selected plan", "گزینه‌ها را تحقیق و برنامه انتخابی را پیاده‌سازی کن"],
		["Deploy staging and verify rollback independently", "استیجینگ را مستقر کن و rollback را مستقل تأیید کن"],
		["Fix the security issue, test it, and prepare a release", "مشکل امنیتی را اصلاح کن، تست بگیر و انتشار را آماده کن"],
		["Audit this repository, fix issues, add tests, and verify it", "این ریپو رو بررسی کن، مشکلاتش رو درست کن، تست اضافه کن و آخرش verify کن"],
	];
	const cases: Array<[string, string]> = [];
	for (const [english, persian] of scenarios) {
		const variants = [english, persian, `${english} (فارسی)`];
		for (const left of variants) for (const right of variants) if (left !== right) cases.push([left, right]);
	}
	assert.ok(cases.length >= 100);
	for (const [left, right] of cases) {
		assert.ok(routingSignatureSimilarity(buildRoutingSignature(left), buildRoutingSignature(right)) >= 0.78, `${left} ~= ${right}`);
	}
});

test("explicit mission rules persist across restart and auto-route only on a strong match", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root);
		const rule = await store.addExplicitMissionRule(`${complexPrompt} RAW_PROMPT_SHOULD_NOT_PERSIST`, { id: "explicit-auth", expectedGeneration: 0 });
		assert.equal(rule.source, "explicit");
		assert.equal(rule.action, "mission");
		const match = await store.match(complexPrompt);
		assert.equal(match.kind, "strong");
		assert.equal(match.mode, "AUTO_MISSION");
		assert.equal(match.source, "explicit");
		assert.equal(match.ruleId, "explicit-auth");
		assert.equal(match.confidence, 1);
		const restarted = makeStore(root);
		const loaded = await restarted.load();
		assert.equal(loaded.status, "valid");
		assert.equal(loaded.rules.length, 1);
		assert.equal((await restarted.match(complexPrompt)).mode, "AUTO_MISSION");
		const stored = await readFile(join(root, "routing-memory.json"), "utf8");
		assert.equal(stored.includes("RAW_PROMPT_SHOULD_NOT_PERSIST"), false);
	});
});

test("malformed rules are isolated while unknown envelopes and versions reject", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root);
		await store.addExplicitMissionRule(complexPrompt, { id: "valid-rule" });
		const activePath = join(root, "routing-memory.json");
		const active = JSON.parse(await readFile(activePath, "utf8")) as { rules: Record<string, unknown>[] };
		active.rules.push({ ...active.rules[0], id: "bad-prompt", prompt: "RAW_BAD_PROMPT" });
		active.rules.push({ ...active.rules[0], id: "bad-confidence", confidence: null });
		await writeFile(activePath, JSON.stringify(active));
		const loaded = await makeStore(root).load();
		assert.equal(loaded.status, "valid");
		assert.equal(loaded.rules.length, 1);
		assert.ok(loaded.diagnostics.length >= 2);
		assert.equal(JSON.stringify(loaded.rules).includes("RAW_BAD_PROMPT"), false);
		assert.equal((await readFile(activePath, "utf8")).includes("RAW_BAD_PROMPT"), false);

		await writeFile(activePath, JSON.stringify({ ...active, unknown: true }));
		assert.equal((await makeStore(root).load()).status, "corrupt");
		await writeFile(activePath, JSON.stringify({ ...active, storageVersion: 99, unknown: undefined }));
		assert.equal((await makeStore(root).load()).status, "corrupt");
	});
});

test("schema version 0 migrates per rule and current unsupported rule versions isolate", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root);
		await store.addExplicitMissionRule(complexPrompt, { id: "migrate-me" });
		const activePath = join(root, "routing-memory.json");
		const active = JSON.parse(await readFile(activePath, "utf8")) as { storageVersion: number; rules: Array<Record<string, unknown>> };
		active.storageVersion = 0;
		const rule = active.rules[0];
		assert.ok(rule);
		rule.schemaVersion = 0;
		(rule.signature as Record<string, unknown>).schemaVersion = 0;
		await writeFile(activePath, JSON.stringify(active));
		const migrated = await makeStore(root).load();
		assert.equal(migrated.status, "valid");
		assert.equal(migrated.repairRequired, true);
		assert.equal(migrated.rules[0]?.schemaVersion, 1);
		assert.equal((await readFile(activePath, "utf8")).includes("RAW_PROMPT"), false);

		const current = JSON.parse(await readFile(activePath, "utf8")) as { rules: Array<Record<string, unknown>> };
		current.rules.push({ ...current.rules[0], id: "future-rule", schemaVersion: 99 });
		await writeFile(activePath, JSON.stringify(current));
		const rejected = await makeStore(root).load();
		assert.equal(rejected.status, "valid");
		assert.equal(rejected.rules.length, 1);
	});
});

test("learned mission and normal choices require repeated evidence", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root);
		const first = await store.observeChoice(complexPrompt, "mission");
		assert.equal(first.learned, true);
		assert.equal((await store.match(complexPrompt)).kind, "none");
		await store.observeChoice(complexPrompt, "mission");
		assert.equal((await store.match(complexPrompt)).kind, "none");
		await store.observeChoice(complexPrompt, "mission");
		const learnedMission = await store.match(complexPrompt);
		assert.equal(learnedMission.kind, "strong");
		assert.equal(learnedMission.mode, "SUGGEST_MISSION");
		assert.equal(learnedMission.source, "learned");
		assert.equal(learnedMission.confidence, 0.84);

		const normalStore = makeStore(join(root, "normal"));
		await normalStore.observeChoice(simplePrompt, "normal");
		assert.equal((await normalStore.match(simplePrompt)).kind, "none");
		await normalStore.observeChoice(simplePrompt, "normal");
		await normalStore.observeChoice(simplePrompt, "normal");
		const learnedNormal = await normalStore.match(simplePrompt);
		assert.equal(learnedNormal.kind, "strong");
		assert.equal(learnedNormal.mode, "NORMAL");
		assert.equal(learnedNormal.action, "normal");
	});
});

test("conflicting repeated choices never auto-decide", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root);
		for (let index = 0; index < 3; index += 1) {
			await store.observeChoice(complexPrompt, "mission");
			await store.observeChoice(complexPrompt, "normal");
		}
		const result = await store.match(complexPrompt);
		assert.equal(result.kind, "strong");
		assert.equal(result.mode, "SUGGEST_MISSION");
		assert.equal(result.source, "learned");
	});
});

test("explicit rules outrank opposite learned evidence while same-tier conflicts stay undecided", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root);
		await store.observeChoice(complexPrompt, "normal");
		await store.observeChoice(complexPrompt, "normal");
		await store.observeChoice(complexPrompt, "normal");
		await store.addExplicitMissionRule(complexPrompt, { id: "explicit-wins" });
		const explicit = await store.match(complexPrompt);
		assert.equal(explicit.kind, "strong");
		assert.equal(explicit.source, "explicit");
		assert.equal(explicit.mode, "AUTO_MISSION");

		const strongerLearned = makeStore(join(root, "stronger-learned"));
		for (let index = 0; index < 3; index += 1) await strongerLearned.observeChoice(complexPrompt, "normal");
		await strongerLearned.addExplicitMissionRule("Investigate the auth bug and fix it", { id: "explicit-lower-similarity" });
		const precedence = await strongerLearned.match(complexPrompt);
		assert.equal(precedence.source, "explicit");
		assert.equal(precedence.mode, "AUTO_MISSION");

		const sameTier = makeStore(join(root, "same-tier"));
		await sameTier.addExplicitMissionRule(complexPrompt, { id: "explicit-mission" });
		await sameTier.addExplicitRule(complexPrompt, "normal", { id: "explicit-normal" });
		assert.equal((await sameTier.match(complexPrompt)).kind, "conflict");
	});
});

test("learned Normal does not match a materially escalated current task", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root);
		const normal = "Take a look at this feature; something feels wrong sometimes. Clean it up if needed.";
		for (let index = 0; index < 3; index += 1) await store.observeChoice(normal, "normal");
		const result = await store.match("Investigate the production payment bug, fix it, add rollback tests, and verify independently");
		assert.equal(result.kind, "none");
		assert.match(result.reason, /complexity/iu);

		const moderate = makeStore(join(root, "moderate-normal"));
		for (let index = 0; index < 3; index += 1) await moderate.observeChoice("Fix the bug and add tests", "normal");
		const escalated = await moderate.match("Fix the bug, add tests, verify independently, and keep iterating until green");
		assert.equal(escalated.kind, "none");
		assert.match(escalated.reason, /complexity/iu);

		const sensitive = makeStore(join(root, "sensitive-normal"));
		for (let index = 0; index < 3; index += 1) await sensitive.observeChoice("Review the production authentication issue", "normal");
		const sensitiveMatch = await sensitive.match("Review the production authentication issue");
		assert.equal(sensitiveMatch.kind, "none");
		assert.match(sensitiveMatch.reason, /complexity/iu);
	});
});

test("gates retain rules, stop learning, and allow caller-controlled application", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root, { learnFromChoices: false });
		const explicit = await store.addExplicitMissionRule(complexPrompt, { id: "retained" });
		const notLearned = await store.observeChoice("Audit the repository and fix findings", "mission");
		assert.equal(notLearned.learned, false);
		assert.equal((await store.listViews()).length, 1);
		assert.equal((await store.match(complexPrompt)).ruleId, explicit.id);
		assert.equal((await store.match(complexPrompt, { existingRulesApply: false })).kind, "none");
		assert.equal((await store.match(complexPrompt, { enabled: false })).kind, "none");
		store.setEnabled(false);
		assert.equal((await store.match(complexPrompt)).kind, "none");
		assert.equal((await store.listViews()).length, 1);
		store.setEnabled(true);
		assert.equal((await store.match(complexPrompt)).kind, "strong");
	});
});

test("rule disable, learned forget, reset, and bounded learned growth are explicit", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root, { maxLearnedRules: 3 });
		const explicit = await store.addExplicitMissionRule(complexPrompt, { id: "keep-explicit" });
		assert.ok(explicit.enabled);
		for (const prompt of [
			"Investigate src/a.ts and fix the bug",
			"Research API options and implement the selected approach",
			"Audit the repository and remediate security findings",
			"Deploy staging, verify rollback, and prepare a release",
			"Implement the frontend and backend feature and test it",
			"Migrate the database, test recovery, and review the result",
		]) await store.observeChoice(prompt, "mission");
		const views = await store.listViews();
		assert.ok(views.filter((rule) => rule.source === "learned").length <= 3);
		assert.equal(views.some((rule) => rule.id === "keep-explicit"), true);
		await store.setEnabled("keep-explicit", false);
		assert.equal((await store.match(complexPrompt)).kind, "none");
		await store.setEnabled("keep-explicit", true);
		assert.equal((await store.match(complexPrompt)).kind, "strong");
		await store.forgetLearned();
		assert.equal((await store.listViews()).every((rule) => rule.source === "explicit"), true);
		await store.reset();
		assert.deepEqual(await store.listViews(), []);
	});
});

test("history stays bounded and backup restore is atomic and private", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root, { retention: 2 });
		await store.addExplicitMissionRule(complexPrompt, { id: "backup-rule" });
		const backupPath = await store.backup(join(root, "safe-backup.json"));
		assert.equal((await readFile(backupPath, "utf8")).includes("RAW_PROMPT"), false);
		await store.setEnabled("backup-rule", false);
		await store.setEnabled("backup-rule", true);
		await store.reset();
		assert.equal((await store.match(complexPrompt)).kind, "none");
		const malformedHistory = JSON.parse(await readFile(backupPath, "utf8")) as { generation: number; rules: Array<Record<string, unknown>> };
		malformedHistory.generation = 1;
		malformedHistory.rules.push({ ...malformedHistory.rules[0], id: "invalid-history-rule", prompt: "RAW_HISTORY_PROMPT" });
		await writeFile(join(root, "routing-memory-history", "routing-memory-00000000000000000001.json"), JSON.stringify(malformedHistory));
		await assert.rejects(() => store.restore(1), /Configuration recovery failed/);
		const invalidBackupPath = join(root, "invalid-backup.json");
		const invalidBackup = JSON.parse(await readFile(backupPath, "utf8")) as { rules: Array<Record<string, unknown>> };
		invalidBackup.rules.push({ ...invalidBackup.rules[0], id: "invalid-backup-rule", prompt: "RAW_BACKUP_PROMPT" });
		await writeFile(invalidBackupPath, JSON.stringify(invalidBackup));
		await assert.rejects(() => store.restore(invalidBackupPath), /Configuration recovery failed/);
		const oversizedBackupPath = join(root, "oversized-backup.json");
		await writeFile(oversizedBackupPath, `${await readFile(backupPath, "utf8")}\n${" ".repeat(1_000_001)}`);
		await assert.rejects(() => store.restore(oversizedBackupPath), /Configuration recovery failed/);
		assert.equal((await store.match(complexPrompt)).kind, "none");
		await store.restore(backupPath);
		assert.equal((await store.match(complexPrompt)).mode, "AUTO_MISSION");
		const history = await readdir(join(root, "routing-memory-history"));
		assert.ok(history.filter((name) => name.endsWith(".json")).length <= 2);
		const files = [await readFile(join(root, "routing-memory.json"), "utf8"), await readFile(backupPath, "utf8")];
		assert.equal(files.some((value) => value.includes("RAW_PROMPT_SHOULD_NOT_PERSIST")), false);
	});
});

test("public views expose only bounded rule fields", async () => {
	await withRoot(async (root) => {
		const store = makeStore(root);
		await store.addExplicitMissionRule(complexPrompt, { id: "public-rule" });
		const view: RoutingMemoryRuleView | undefined = (await store.listViews())[0];
		assert.ok(view);
		assert.deepEqual(Object.keys(view).sort(), [
			"action", "confidence", "createdAt", "enabled", "id", "lastObservedAt", "observations", "schemaVersion", "signature", "source", "updatedAt",
		]);
		assert.equal("prompt" in view.signature, false);
	});
});
