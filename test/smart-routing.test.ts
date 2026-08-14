import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	analyzeLocalSignals,
	createDefaultSmartRoutingSettings,
	parseTriageResult,
	SmartRouter,
	SmartRoutingSettingsStore,
	TriageCapabilityError,
	type SmartRoutingSettings,
	type TriageClient,
} from "../src/core/smart-routing/index.js";
import type { StableId } from "../src/core/config/types.js";
import { SQLiteAnalyticsStore, summarize } from "../src/core/analytics/index.js";

const route = (value: string): StableId => value as StableId;

test("M12.2 local analyzer keeps ordinary questions and narrow edits fast", () => {
	const cases = [
		"What is a closure?",
		"Explain what this test does",
		"How do I configure TypeScript?",
		"Summarize this paragraph in one sentence",
		"Translate this sentence to Persian",
		"Create README.md",
		"Rename this variable",
		"Run the tests",
		"Format this JSON",
		"یه توضیح کوتاه درباره این تابع بده",
		"این تست چه کاری انجام می‌دهد؟",
		"What does @orchestrator mean?",
		"Show me the current git branch",
		"Explain this code briefly in mixed فارسی",
	];
	for (const prompt of cases) assert.equal(analyzeLocalSignals(prompt).path, "simple", prompt);
});

test("M12.2 local analyzer recognizes bilingual multi-stage work without length-only rules", () => {
	const cases = [
		"Fix the bug in src/auth.ts and add tests, then verify independently",
		"Investigate the flaky login, fix the root cause, add regression coverage, and keep iterating until green",
		"Audit the security issue, remediate it, run tests, and prepare a release",
		"Research OAuth options and implement the selected approach",
		"Migrate the database, update the application, test rollback, and review the diff",
		"Delete the production database and redeploy",
		"Implement the feature across the API and UI, document it, and verify the result",
		"این باگ را در پروژه بررسی و اصلاح کن و تست بنویس",
		"مخزن را ممیزی کن، مشکل امنیتی را رفع کن، تست بگیر و گزارش بده",
		"بررسی کن، تغییرات را اعمال کن، سپس مستقل تأیید کن",
		"Fix src/a.ts, src/b.ts, and src/c.ts; run the suite and publish a release",
		"Please diagnose the issue, implement a safe fix, retest it, and report evidence",
	];
	for (const prompt of cases) assert.equal(analyzeLocalSignals(prompt).path, "complex", prompt);
});

test("M12.2 local analyzer leaves semantic ambiguity for bounded triage", () => {
	for (const prompt of [
		"Take a look at this feature; something feels wrong sometimes. Clean it up if needed.",
		"Something is odd in this module. Investigate if necessary.",
		"به این بخش یه نگاهی بنداز، بعضی وقت‌ها عجیب رفتار می‌کنه؛ اگر لازم بود درستش کن.",
		"Could you improve this workflow somehow?",
	]) assert.equal(analyzeLocalSignals(prompt).path, "ambiguous", prompt);
});

test("M12.2 deterministic corpus covers 100 representative bilingual routing cases", () => {
	const cases: readonly { readonly label: string; readonly prompt: string; readonly expected: "simple" | "complex" | "ambiguous" }[] = [
		...[
			"What is a closure?", "How does the event loop schedule tasks?", "Explain what this test does", "Explain how this fixture uses a fake provider", "Describe the purpose of the retry counter", "Summarize this long paragraph in one sentence: the system records bounded metadata and keeps the provider opaque", "Translate this sentence to Persian", "این تابع چه کاری انجام می‌دهد؟", "یه توضیح کوتاه درباره این تابع بده", "Explain this code briefly in mixed فارسی", "Format this JSON", "Rename the local variable from x to count", "Create README.md", "Run the tests once", "Show me the current git branch", "List the files in this folder", "What does @orchestrator mean?", "What is a Mission in this project?", "Explain the word mission in this context", "Fix the typo in README.md", "Update the port number in this config file", "Add one import to src/a.ts", "Rename this function", "Remove the unused variable", "Format src/index.ts", "Check the current git status", "Describe this test fixture", "Give a technical explanation of promises", "این تست چه کاری انجام می‌دهد؟", "این کد را کوتاه توضیح بده", "Show the configured route IDs", "How should I name this variable?", "What is the purpose of this helper?", "Run npm test once", "Check the current package version", "What is the difference between a route and a model?",
		].map((prompt, index) => ({ label: "simple-" + (index + 1), prompt, expected: "simple" as const })),
		...[
			"Fix the bug in src/auth.ts and add tests, then verify independently", "Investigate the flaky login, fix the root cause, add regression coverage, and keep iterating until green", "Audit the security issue, remediate it, run tests, and prepare a release", "Research OAuth options and implement the selected approach", "Migrate the database, update the application, test rollback, and review the diff", "Delete the production database and redeploy", "Implement the feature across the API and UI, document it, and verify the result", "Please diagnose the issue, implement a safe fix, retest it, and report evidence", "Refactor the auth module and add tests, then review the behavior", "Run the migration and verify rollback independently", "Review the entire repository for security, fix findings, and run the suite", "Update the API contract across clients, add compatibility tests, and publish a release", "Investigate the performance regression, profile the code, implement a fix, benchmark it, and review the result", "Build the feature across modules, update docs, and add tests", "Compare provider choices, choose one, implement it, and test fallback", "Debug the deployment issue, fix the config, stage a release, and verify it", "Plan and implement context persistence, test recovery, and audit the result", "Analyze the flaky test, patch the root cause, and repeat until all pass", "Add the permission model across frontend and backend, migrate data, and test rollback", "Inspect repository history, identify the regression, fix it, add a regression test, and write release notes", "این باگ را در پروژه بررسی و اصلاح کن و تست بنویس", "مخزن را ممیزی کن، مشکل امنیتی را رفع کن، تست بگیر و گزارش بده", "بررسی کن، تغییرات را اعمال کن، سپس مستقل تأیید کن", "این قابلیت را در API و UI پیاده‌سازی کن، مستند کن و نتیجه را تأیید کن", "مسیر ورود را بررسی کن، علت را پیدا کن، اصلاح کن و تا سبز شدن تست‌ها ادامه بده", "تنظیمات مهاجرت پایگاه داده را تغییر بده، rollback را تست کن و گزارش بده", "Investigate این module، fix root cause، add tests و verify مستقل", "Please audit این repository، remediate findings، run tests، and prepare release", "این workflow را تحقیق کن و approach انتخاب‌شده را implement کن و review بگیر", "برای این feature plan بنویس، across API/UI implement کن، test و independently verify", "Review امنیتی این مسیر را انجام بده، vulnerability را fix کن، تست و release آماده کن", "Diagnose مشکل deploy در staging، config را اصلاح کن، smoke test بگیر و evidence بده", "Update src/a.ts and src/b.ts, add tests, then verify", "Investigate the production payment issue, apply a safe fix, test rollback, and get independent review", "Research migration options, implement the chosen plan, document rollback, and run checks", "Refactor the routing policy, preserve compatibility, add regression tests, and inspect the diff", "Build a complete workflow, implement each responsibility, test every stage, and report evidence", "Check the root cause of the outage, patch the service, redeploy staging, validate health, and prepare a release", "این تغییر حساس را بررسی کن، پیاده‌سازی کن، تست امنیتی بگیر و مستقل بررسی کن", "bug را diagnose کن، safe fix را implement کن، regression test بنویس و release evidence آماده کن",
		].map((prompt, index) => ({ label: "complex-" + (index + 1), prompt, expected: "complex" as const })),
		...[
			"Take a look at this feature; something feels wrong sometimes. Clean it up if needed.", "Something is odd in this module. Investigate if necessary.", "به این بخش یه نگاهی بنداز، بعضی وقت‌ها عجیب رفتار می‌کنه؛ اگر لازم بود درستش کن.", "Could you improve this workflow somehow?", "Fix this if needed.", "Review this somehow.", "Maybe update the workflow.", "Do something about this issue.", "I am not sure what this component needs; take a look.", "Can you inspect this and decide what to do?", "این بخش را اگر لازم بود بهتر کن.", "به این مسیر یه نگاهی بنداز، شاید نیاز به تغییر داشته باشد.", "گاهی این تست عجیب می‌شود؛ ببین چه کار می‌کنی.", "Could you make the flow more robust somehow?", "Look at the feature and help if possible.", "Something feels off; handle it as you see fit.", "این workflow را هر طور صلاح می‌دانی بهتر کن.", "Maybe investigate the cache.", "Can you improve this module when you have time?", "Is this design okay; change it if needed?", "به نظرت این بخش خوب است؟ اگر لازم بود اصلاحش کن.", "I think something is wrong here; make it better somehow.", "Could you handle this situation, maybe?", "Check the module and do something if necessary.", "این قسمت را review کن، اگر لازم بود fix کن.",
		].map((prompt, index) => ({ label: "ambiguous-" + (index + 1), prompt, expected: "ambiguous" as const })),
	];
	assert.ok(cases.length >= 100);
	for (const item of cases) assert.equal(analyzeLocalSignals(item.prompt).path, item.expected, item.label + ": " + item.prompt);
});

test("M12.2 smart policy skips AI on clear paths and uses one primary result", async () => {
	const calls: string[] = [];
	const client: TriageClient = { classify: async (_request, routeId) => { calls.push(routeId); return { recommendedMode: "normal", confidence: 0.9, reasons: ["question_only"] }; } };
	const router = new SmartRouter({ settings: { ...createDefaultSmartRoutingSettings(), aiTriageEnabled: true, primaryRouteId: route("triage-primary"), fallbackRouteId: route("triage-fallback") }, triageClient: client });
	assert.equal((await router.decide("What is a closure?", undefined)).mode, "NORMAL");
	assert.equal((await router.decide("Fix the bug in src/a.ts and add tests", undefined)).mode, "SUGGEST_MISSION");
	assert.equal(calls.length, 0);
	const ambiguous = await router.decide("Take a look at this feature; something feels wrong sometimes. Clean it up if needed.", undefined);
	assert.equal(ambiguous.mode, "NORMAL");
	assert.deepEqual(calls, ["triage-primary"]);
	assert.equal(ambiguous.triage?.fallbackUsed, false);
});

test("M12.2 triage fallback is capability-only and never quality-shops disagreement", async () => {
	const calls: string[] = [];
	const router = new SmartRouter({
		settings: { ...createDefaultSmartRoutingSettings(), aiTriageEnabled: true, primaryRouteId: route("triage-primary"), fallbackRouteId: route("triage-fallback") },
		triageClient: {
			classify: async (_request, routeId) => {
				calls.push(routeId);
				if (routeId === "triage-primary") throw new TriageCapabilityError("timeout");
				return { recommendedMode: "mission", confidence: 0.8, reasons: ["investigation"] };
			},
		},
	});
	const fallback = await router.decide("Take a look at this feature; something feels wrong sometimes. Clean it up if needed.");
	assert.equal(fallback.mode, "SUGGEST_MISSION");
	assert.deepEqual(calls, ["triage-primary", "triage-fallback"]);
	assert.equal(fallback.triage?.fallbackUsed, true);

	calls.length = 0;
	const disagreement = new SmartRouter({
		settings: { ...createDefaultSmartRoutingSettings(), aiTriageEnabled: true, primaryRouteId: route("triage-primary"), fallbackRouteId: route("triage-fallback") },
		triageClient: { classify: async (_request, routeId) => { calls.push(routeId); return { recommendedMode: "normal", confidence: 0.9, reasons: ["question_only"] }; } },
	});
	assert.equal((await disagreement.decide("Take a look at this feature; something feels wrong sometimes. Clean it up if needed.")).mode, "NORMAL");
	assert.deepEqual(calls, ["triage-primary"]);
});

test("M12.2 triage degradation preserves a user-choice recommendation", async () => {
	const router = new SmartRouter({
		settings: { ...createDefaultSmartRoutingSettings(), aiTriageEnabled: true, primaryRouteId: route("triage-primary") },
		triageClient: { classify: async () => { throw new TriageCapabilityError("unavailable"); } },
	});
	const decision = await router.decide("Take a look at this feature; something feels wrong sometimes. Clean it up if needed.");
	assert.equal(decision.mode, "SUGGEST_MISSION");
	assert.ok(decision.reasonCodes.includes("triage_unavailable"));
	assert.equal(decision.triage?.calls, 1);

	const noAi = new SmartRouter({ settings: { ...createDefaultSmartRoutingSettings(), aiTriageEnabled: false } });
	assert.equal((await noAi.decide("Take a look at this feature; something feels wrong sometimes. Clean it up if needed.")).mode, "SUGGEST_MISSION");
	const disabled = new SmartRouter({ settings: { ...createDefaultSmartRoutingSettings(), enabled: false }, triageClient: { classify: async () => { throw new Error("must not call"); } } });
	assert.equal((await disabled.decide("Fix the bug in src/a.ts and add tests")).mode, "NORMAL");
});

test("M12.2 triage result is strict and settings retain stale route IDs", async () => {
	assert.deepEqual(parseTriageResult({ recommendedMode: "mission", confidence: 0.8, reasons: ["mutation"] }).recommendedMode, "mission");
	assert.throws(() => parseTriageResult({ recommendedMode: "mission", confidence: 0.8, reasons: ["mutation"], prompt: "raw" }), /unsupported shape/);
	assert.throws(() => parseTriageResult("mission"), /unsupported shape/);

	const root = await mkdtemp(join(tmpdir(), "pi-m12-smart-routing-"));
	try {
		const store = new SmartRoutingSettingsStore({ root });
		assert.equal((await store.load()).status, "missing");
		const first = await store.update((draft) => ({ ...draft, primaryRouteId: route("stale-route") }));
		assert.equal(first.generation, 1);
		assert.equal((await store.load()).settings.primaryRouteId, "stale-route");
		const second = await store.update((draft) => ({ ...draft, fallbackRouteId: route("fallback-route") }));
		assert.equal(second.generation, 2);
		await store.restore(1, { expectedGeneration: 2 });
		const restored = await store.load();
		assert.equal(restored.settings.primaryRouteId, "stale-route");
		assert.equal(restored.settings.fallbackRouteId, undefined);
		const duplicate = { ...restored.settings, fallbackRouteId: restored.settings.primaryRouteId } as SmartRoutingSettings;
		assert.throws(() => store.save(duplicate, { expectedGeneration: restored.generation }), /Configuration validation failed/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("M12.2 routing telemetry stores bounded metadata only", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-m12-routing-analytics-"));
	try {
		const store = new SQLiteAnalyticsStore({ root, enabled: true });
		store.append({
			eventId: "routing-1",
			occurredAt: "2026-08-14T00:00:00.000Z",
			eventType: "routing",
			routing: { decision: "suggest_mission", localPath: "ambiguous", triageCalls: 2, fallbackUsed: true, reasonCodes: ["investigation", "prompt contents must not persist"], action: "run_normally", failureClass: "timeout" },
		});
		const events = store.list();
		assert.equal(events.length, 1);
		assert.deepEqual(events[0]?.routing?.reasonCodes, ["investigation"]);
		assert.equal(store.summary().routing?.fallbackCalls, 1);
		assert.equal(JSON.stringify(events).includes("prompt contents"), false);
		assert.equal(summarize(events).routing?.decisions, 1);
		store.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
