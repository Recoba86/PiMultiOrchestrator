import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { ConfigConflictError, ConfigRecoveryError, ConfigValidationError } from "../config/errors.js";
import { ensureStorageDirectories, STORAGE_DIRECTORY_MODE, withStorageLock, writeAtomicFile } from "../config/history.js";
import { deterministicJson } from "../config/serialize.js";

export const ROUTING_MEMORY_SCHEMA_VERSION = 1 as const;
export const ROUTING_MEMORY_STORAGE_VERSION = 1 as const;
export const DEFAULT_ROUTING_MEMORY_FILE = "routing-memory.json" as const;
export const DEFAULT_ROUTING_MEMORY_RETENTION = 20;
export const DEFAULT_MAX_LEARNED_RULES = 64;

export type RoutingLanguage = "en" | "fa" | "mixed";
export type RoutingTaskFamily =
	| "explanation"
	| "question"
	| "action"
	| "debug"
	| "implementation"
	| "testing"
	| "verification"
	| "audit"
	| "research"
	| "release"
	| "other";
export type RoutingProjectScope = "none" | "file" | "module" | "repository" | "multiple";
export type RoutingRisk = "low" | "medium" | "high";
export type RoutingAction = "mission" | "normal";
export type RoutingRuleSource = "explicit" | "learned";

/** Prompt-derived, bounded semantic data. It deliberately has no text field. */
export interface RoutingSignature {
	readonly schemaVersion: typeof ROUTING_MEMORY_SCHEMA_VERSION;
	readonly language: RoutingLanguage;
	readonly taskFamily: RoutingTaskFamily;
	readonly explanation: boolean;
	readonly question: boolean;
	readonly action: boolean;
	readonly projectScope: RoutingProjectScope;
	readonly investigation: boolean;
	readonly mutation: boolean;
	readonly implementation: boolean;
	readonly testing: boolean;
	readonly verification: boolean;
	readonly audit: boolean;
	readonly remediation: boolean;
	readonly research: boolean;
	readonly release: boolean;
	readonly multiStep: boolean;
	readonly dependentSteps: boolean;
	readonly deliverables: number;
	readonly multiRole: boolean;
	readonly sensitive: boolean;
	readonly destructive: boolean;
	readonly risk: RoutingRisk;
}

export interface RoutingMemoryRule {
	readonly id: string;
	readonly schemaVersion: typeof ROUTING_MEMORY_SCHEMA_VERSION;
	readonly action: RoutingAction;
	readonly source: RoutingRuleSource;
	readonly signature: RoutingSignature;
	readonly confidence: number;
	readonly observations: number;
	readonly enabled: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly lastObservedAt: string;
}

export type RoutingMemoryRuleView = RoutingMemoryRule;
export type RoutingMemoryRuleWrite = RoutingMemoryRuleView & { readonly created: boolean };

export interface RoutingLocalSignals {
	readonly missionScore?: number;
	readonly confidence?: number;
	readonly signals?: readonly string[];
	readonly path?: "simple" | "complex" | "ambiguous" | string;
}

export interface RoutingMemoryPolicy {
	readonly enabled?: boolean;
	readonly learnFromChoices?: boolean;
	readonly existingRulesApply?: boolean;
	/** Alias accepted for callers that use the imperative wording. */
	readonly applyExistingRules?: boolean;
}

export interface RoutingMemoryStoreOptions extends RoutingMemoryPolicy {
	readonly root: string;
	readonly activeFile?: string;
	readonly retention?: number;
	readonly maxLearnedRules?: number;
	readonly now?: () => string;
	readonly id?: () => string;
}

export interface RoutingMemoryCallOptions extends RoutingMemoryPolicy {
	readonly expectedGeneration?: number;
}

export type RoutingMemoryMatchKind = "none" | "conflict" | "strong";
export type RoutingMemoryMode = "AUTO_MISSION" | "SUGGEST_MISSION" | "NORMAL";

export interface RoutingMemoryMatch {
	readonly kind: RoutingMemoryMatchKind;
	/** Equivalent spelling useful to adapters that call this a status. */
	readonly status: RoutingMemoryMatchKind;
	readonly mode?: RoutingMemoryMode;
	readonly action?: RoutingAction;
	readonly source?: RoutingRuleSource;
	readonly ruleId?: string;
	readonly confidence?: number;
	readonly similarity?: number;
	readonly reason: string;
	readonly conflict?: boolean;
}

export interface RoutingMemoryLoadResult {
	readonly status: "missing" | "valid" | "corrupt";
	readonly generation: number;
	readonly savedAt?: string;
	readonly rules: readonly RoutingMemoryRuleView[];
	readonly repairRequired: boolean;
	readonly diagnostics: readonly string[];
}

export interface RoutingMemoryMutationResult {
	readonly changed: boolean;
	readonly generation: number;
	readonly previousGeneration?: number;
	readonly historyPath?: string;
	readonly warnings?: readonly string[];
}

export interface ObserveChoiceResult extends RoutingMemoryMutationResult {
	readonly learned: boolean;
	readonly created: boolean;
	readonly ruleCreated: boolean;
	readonly rule?: RoutingMemoryRuleView;
	readonly prunedRuleId?: string;
}

interface StoredRoutingMemory {
	readonly storageVersion: typeof ROUTING_MEMORY_STORAGE_VERSION;
	readonly generation: number;
	readonly savedAt: string;
	readonly rules: readonly RoutingMemoryRule[];
}

interface ParsedStoredRoutingMemory {
	readonly stored: StoredRoutingMemory;
	readonly diagnostics: readonly string[];
	readonly migrated: boolean;
}

interface ActiveRead {
	readonly kind: "missing" | "valid" | "invalid";
	readonly bytes?: Buffer;
	readonly parsed?: ParsedStoredRoutingMemory;
}

const RULE_KEYS = [
	"id", "schemaVersion", "action", "source", "signature", "confidence", "observations", "enabled",
	"createdAt", "updatedAt", "lastObservedAt",
] as const;
const SIGNATURE_KEYS = [
	"schemaVersion", "language", "taskFamily", "explanation", "question", "action", "projectScope",
	"investigation", "mutation", "implementation", "testing", "verification", "audit", "remediation",
	"research", "release", "multiStep", "dependentSteps", "deliverables", "multiRole", "sensitive",
	"destructive", "risk",
] as const;
const STORED_KEYS = ["storageVersion", "generation", "savedAt", "rules"] as const;
const LEGACY_SIGNATURE_KEYS = new Set<string>([
	...SIGNATURE_KEYS,
	"intent", "multipleDeliverables",
]);
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/u;
const MAX_OBSERVATIONS = 10_000;
const MAX_DELIVERABLES = 8;
const MATCH_THRESHOLD = 0.78;
const LEARNED_MATCH_THRESHOLD = 0.8;
const EXPLICIT_MERGE_THRESHOLD = 0.86;
const LEARNED_MERGE_THRESHOLD = 0.8;
const LEARNED_CONFIDENCE_THRESHOLD = 0.84;
const MAX_EXPLICIT_RULES = 256;
const MAX_TOTAL_RULES = MAX_EXPLICIT_RULES + DEFAULT_MAX_LEARNED_RULES;
const MAX_LEARNED_RULES = MAX_TOTAL_RULES - MAX_EXPLICIT_RULES;
const MAX_ACTIVE_BYTES = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
	Object.keys(value).every((key) => allowed.includes(key));
const validDate = (value: unknown): value is string =>
	typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
const issue = (path: string, message: string): never => {
	throw new ConfigValidationError([{ code: "routing-memory", path, message }]);
};
const invalidRule = (path: string, message: string): never => {
	throw new ConfigValidationError([{ code: "routing-memory-rule", path, message }]);
};
const expectRecord = (value: unknown, path: string): Record<string, unknown> => {
	if (!isRecord(value)) issue(path, "Expected an object");
	return value as Record<string, unknown>;
};

const normalize = (value: string): string => value
	.normalize("NFKC")
	.replace(/[\u200c\u200d]/gu, " ")
	.toLocaleLowerCase()
	.trim();
const containsPersian = (value: string): boolean => /[\u0600-\u06ff]/u.test(value);
const containsLatin = (value: string): boolean => /[a-z]/iu.test(value);
const anyPattern = (value: string, patterns: readonly RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));
const countPattern = (value: string, pattern: RegExp): number => [...value.matchAll(new RegExp(pattern.source, pattern.flags.replace("g", "") + "g"))].length;

const explanationPattern = /\b(?:explain|describe|summari[sz]e|translate|what\s+is|what\s+does|how\s+does|tell\s+me)\b|(?:توضیح|شرح|خلاصه|ترجمه|چیست|چگونه|چطور|چه کاری)/iu;
const questionPattern = /(?:\?|؟)\s*$|\b(?:what|why|how|when|where|which|can|could|is|are|does|do)\b/iu;
const actionPattern = /\b(?:make|run|add|remove|change|update|create|build|implement|fix|edit|modify|write|rename|replace|migrate|check|review|handle|delete|deploy|release|publish|verify|test|format)\b|(?:لطفا|لطفاً|انجام|بساز|ایجاد|بررسی|اصلاح|تغییر|حذف|اجرا|پیاده|مستقر|منتشر|اضافه|ویرایش|بازنویسی|بنویس|قالب)/iu;
const projectPattern = /(?:\/|\\|\.(?:ts|tsx|js|jsx|py|go|rs|json|md|sql)\b|\b(?:repo(?:sitory)?|project|codebase|file|folder|branch|commit|git|package|module|repository|api|ui|frontend|backend)\b|(?:مخزن|ریپو|ریپازیتوری|پروژه|کدبیس|کد|فایل|پوشه|شاخه|کامیت|ماژول|بسته|رابط|رابط کاربری))/iu;
const investigationPattern = /\b(?:investigate|diagnose|debug|analy[sz]e|inspect|find\s+out|why|root\s+cause|trace|research|understand|look\s+(?:into|at))\b|(?:بررسی|عیب.?یابی|اشکال.?زدایی|تحقیق|تحلیل|ریشه|علت|چرا|ردیابی|بفهم|متوجه|نگاهی|بنداز)/iu;
const mutationPattern = /\b(?:add|change|create|delete|remove|edit|modify|update|write|refactor|implement|patch|fix|migrate|rename|replace|upgrade|downgrade|apply)\b|(?:اضافه|تغییر|ایجاد|حذف|پاک|ویرایش|اصلاح|درست|به.?روزرسان|بازنویسی|پیاده|مهاجرت|جایگزین|ارتقا|اعمال)/iu;
const implementationPattern = /\b(?:implement|build|develop|create|add|write|code|feature|refactor)\b|(?:پیاده.?سازی|بساز|توسعه|ایجاد|قابلیت|کدنویسی|بازنویسی)/iu;
const testingPattern = /\b(?:test|tests|testing|test\s+suite|coverage|assertions?|regression|smoke\s+test)\b|(?:تست|آزمون|پوشش|اعتبارسنج|رگرسیون|اسموک)/iu;
const verificationPattern = /\b(?:verify|verification|validate|confirm|prove|evidence|independent(?:ly)?|cross.?check|separate\s+review)\b|(?:تأیید|تایید|اعتبارسنجی|اثبات|شواهد|مستقل|راستی.?آزمایی|بررسی جدا)/iu;
const auditPattern = /\b(?:audit|security\s+review|code\s+review|review|compliance|vulnerabilit(?:y|ies))\b|(?:ممیزی|بازبینی|بررسی کد|بررسی\s+(?:این\s+)?(?:مخزن|ریپو|ریپازیتوری)|(?:مخزن|ریپو|ریپازیتوری)\s+(?:را|رو)?\s*بررسی|انطباق|آسیب.?پذیری)/iu;
const remediationPattern = /\b(?:remediate|repair|root\s+cause|fix\s+finding|resolve|patch)\b|(?:رفع|درمان|اصلاح|ریشه.?یابی)/iu;
const researchPattern = /\b(?:research|compare|survey|look\s+up|study|options?)\b|(?:تحقیق|پژوهش|مقایسه|مطالعه|گزینه)/iu;
const releasePattern = /\b(?:release|deploy|deployment|publish|production|staging|tag|ship|rollout|rollback)\b|(?:انتشار|استقرار|تولید|محیط آزمایشی|برچسب|تحویل|بازگشت)/iu;
const sensitivePattern = /\b(?:security|credential|secret|token|password|private\s+key|auth|authentication|login|sign.?in|permission|payment|financial|customer|production|live|database)\b|(?:امنیت|اعتبارنامه|محرمانه|توکن|گذرواژه|کلید خصوصی|احراز|ورود|دسترسی|پرداخت|مالی|مشتری|تولید|زنده|پایگاه.?داده)/iu;
const destructivePattern = /\b(?:delete|remove|drop|reset|destroy|wipe|purge|revoke|overwrite|destructive)\b|(?:حذف|پاک|ریست|نابود|ابطال|بازنویسی|مخرب)/iu;
const dependentPattern = /\b(?:then|after(?:wards)?|before|once|next|finally|until|first)\b|(?:سپس|بعد(?: از آن)?|قبل|پس از|درنهایت|تا وقتی|اول)/iu;
const multiRolePattern = /\b(?:investigator|implementer|reviewer|planner|operator|separately|independent review|multiple roles?)\b|(?:نقش|بازرس|پیاده.?ساز|بازبین|برنامه.?ریز|اپراتور|چند نقش)/iu;

const localSignal = (signals: ReadonlySet<string>, ...names: readonly string[]): boolean =>
	names.some((name) => signals.has(name));

const taskWorkFlags = (signature: RoutingSignature): readonly boolean[] => [
	signature.investigation, signature.mutation, signature.implementation, signature.testing,
	signature.verification, signature.audit, signature.remediation, signature.research,
	signature.release, signature.multiStep, signature.dependentSteps, signature.multiRole,
	signature.sensitive, signature.destructive,
];

const complexityScore = (signature: RoutingSignature): number => {
	const weights: readonly [boolean, number][] = [
		[signature.investigation, 0.08], [signature.mutation, 0.1], [signature.implementation, 0.1],
		[signature.testing, 0.06], [signature.verification, 0.08], [signature.audit, 0.1],
		[signature.remediation, 0.1], [signature.research, 0.09], [signature.release, 0.14],
		[signature.multiStep, 0.14], [signature.dependentSteps, 0.08], [signature.multiRole, 0.12],
		[signature.sensitive, 0.2], [signature.destructive, 0.24],
		[signature.projectScope === "multiple" || signature.projectScope === "repository", 0.08],
		[signature.deliverables > 1, 0.1], [signature.risk === "medium", 0.04], [signature.risk === "high", 0.14],
	];
	return clamp(weights.reduce((total, [present, weight]) => total + (present ? weight : 0), 0));
};

const explanatoryOnly = (signature: RoutingSignature): boolean =>
	(signature.explanation || signature.question) && !signature.action && taskWorkFlags(signature).every((item) => !item);
const materiallyEscalated = (left: RoutingSignature, right: RoutingSignature): boolean => {
	const leftScore = complexityScore(left);
	const rightScore = complexityScore(right);
	const highRiskMismatch = (left.sensitive || left.destructive || left.risk === "high") !==
		(right.sensitive || right.destructive || right.risk === "high");
	return highRiskMismatch || Math.abs(leftScore - rightScore) >= 0.28 && Math.max(leftScore, rightScore) >= 0.42;
};
const learnedNormalCompatible = (current: RoutingSignature, stored: RoutingSignature): boolean => {
	if (current.sensitive || current.destructive || current.risk === "high") return false;
	if (materiallyEscalated(current, stored)) return false;
	const currentScore = complexityScore(current);
	const storedScore = complexityScore(stored);
	if (currentScore >= 0.32 && currentScore > storedScore + 0.12) return false;
	if ((current.projectScope === "repository" || current.projectScope === "multiple") && stored.projectScope !== current.projectScope) return false;
	for (const key of ["release", "sensitive", "destructive", "multiStep", "dependentSteps", "multiRole"] as const) if (current[key] && !stored[key]) return false;
	return true;
};

const signatureAnchor = (signature: RoutingSignature): boolean =>
	signature.explanation || signature.question || signature.projectScope !== "none" ||
	taskWorkFlags(signature).some(Boolean);

const relatedTaskFamily = (left: RoutingTaskFamily, right: RoutingTaskFamily): number => {
	if (left === right) return 1;
	if ((left === "debug" && (right === "action" || right === "implementation")) ||
		(right === "debug" && (left === "action" || left === "implementation")) ||
		(left === "audit" && right === "verification") || (right === "audit" && left === "verification")) return 0.4;
	return 0;
};

const roundSimilarity = (value: number): number => Math.round(clamp(value) * 1000) / 1000;

const canonicalSignature = (value: unknown): RoutingSignature => {
	const record = expectRecord(value, "$.signature");
	if (!hasOnlyKeys(record, SIGNATURE_KEYS)) issue("$.signature", "Routing signature has unknown fields");
	if (record.schemaVersion !== ROUTING_MEMORY_SCHEMA_VERSION) issue("$.signature.schemaVersion", "Routing signature schema version is unsupported");
	const strings: readonly [string, readonly string[]][] = [
		["language", ["en", "fa", "mixed"]],
		["taskFamily", ["explanation", "question", "action", "debug", "implementation", "testing", "verification", "audit", "research", "release", "other"]],
		["projectScope", ["none", "file", "module", "repository", "multiple"]],
		["risk", ["low", "medium", "high"]],
	];
	for (const [key, allowed] of strings) if (typeof record[key] !== "string" || !allowed.includes(record[key])) issue(`$.signature.${key}`, "Routing signature value is invalid");
	for (const key of ["explanation", "question", "action", "investigation", "mutation", "implementation", "testing", "verification", "audit", "remediation", "research", "release", "multiStep", "dependentSteps", "multiRole", "sensitive", "destructive"] as const) {
		if (typeof record[key] !== "boolean") issue(`$.signature.${key}`, "Expected a boolean");
	}
	if (typeof record.deliverables !== "number" || !Number.isSafeInteger(record.deliverables) || record.deliverables < 0 || record.deliverables > MAX_DELIVERABLES) issue("$.signature.deliverables", "Deliverables are out of bounds");
	return {
		schemaVersion: ROUTING_MEMORY_SCHEMA_VERSION,
		language: record.language as RoutingLanguage,
		taskFamily: record.taskFamily as RoutingTaskFamily,
		explanation: record.explanation as boolean,
		question: record.question as boolean,
		action: record.action as boolean,
		projectScope: record.projectScope as RoutingProjectScope,
		investigation: record.investigation as boolean,
		mutation: record.mutation as boolean,
		implementation: record.implementation as boolean,
		testing: record.testing as boolean,
		verification: record.verification as boolean,
		audit: record.audit as boolean,
		remediation: record.remediation as boolean,
		research: record.research as boolean,
		release: record.release as boolean,
		multiStep: record.multiStep as boolean,
		dependentSteps: record.dependentSteps as boolean,
		deliverables: record.deliverables as number,
		multiRole: record.multiRole as boolean,
		sensitive: record.sensitive as boolean,
		destructive: record.destructive as boolean,
		risk: record.risk as RoutingRisk,
	};
};

export function validateRoutingSignature(value: unknown): RoutingSignature {
	return canonicalSignature(value);
}

/**
 * Compare only bounded concepts. Language is intentionally neutral so the same
 * English and Persian intent can match; lexical overlap is never considered.
 */
export function routingSignatureSimilarity(left: RoutingSignature, right: RoutingSignature): number {
	const a = canonicalSignature(left);
	const b = canonicalSignature(right);
	if (explanatoryOnly(a) !== explanatoryOnly(b)) return 0.05;
	if (materiallyEscalated(a, b)) return 0.08;
	if (a.projectScope !== b.projectScope && (a.projectScope === "repository" || a.projectScope === "multiple" || b.projectScope === "repository" || b.projectScope === "multiple")) return 0.12;

	let weighted = 0;
	let total = 0;
	const add = (weight: number, score: number): void => {
		weighted += weight * score;
		total += weight;
	};
	add(0.08, 1); // language-neutral conceptual comparison
	add(0.14, relatedTaskFamily(a.taskFamily, b.taskFamily));
	for (const key of ["explanation", "question", "action"] as const) add(0.06, a[key] === b[key] ? 1 : 0);
	add(0.08, a.projectScope === b.projectScope ? 1 : (a.projectScope === "none" || b.projectScope === "none" ? 0.2 : 0.5));
	for (const key of ["investigation", "mutation", "implementation", "testing", "verification", "audit", "remediation", "research", "release", "multiStep", "dependentSteps", "multiRole", "sensitive", "destructive"] as const) {
		add(key === "multiStep" || key === "release" || key === "destructive" ? 0.08 : 0.06, a[key] === b[key] ? 1 : 0);
	}
	add(0.07, 1 - Math.min(1, Math.abs(a.deliverables - b.deliverables) / 4));
	add(0.08, a.risk === b.risk ? 1 : (a.risk === "low" || b.risk === "low" ? 0.25 : 0.5));
	const score = weighted / total;
	const aStructuralCount = taskWorkFlags(a).filter(Boolean).length;
	const bStructuralCount = taskWorkFlags(b).filter(Boolean).length;
	const keywordOnly = aStructuralCount <= 1 && bStructuralCount <= 1 && a.projectScope === "none" && b.projectScope === "none" && !a.explanation && !a.question && !b.explanation && !b.question;
	return roundSimilarity(!signatureAnchor(a) || !signatureAnchor(b) || keywordOnly ? Math.min(score, 0.66) : score);
}

const migrateLegacySignature = (value: Record<string, unknown>): Record<string, unknown> => {
	if (!hasOnlyKeys(value, [...LEGACY_SIGNATURE_KEYS])) invalidRule("$.signature", "Legacy signature has unknown fields");
	const intent = typeof value.intent === "string" ? value.intent : undefined;
	const boolean = (key: string, fallback = false): boolean => typeof value[key] === "boolean" ? value[key] as boolean : fallback;
	const signature: Record<string, unknown> = {
		schemaVersion: ROUTING_MEMORY_SCHEMA_VERSION,
		language: value.language ?? "en",
		taskFamily: value.taskFamily ?? (intent === "explanation" || intent === "question" ? intent : "other"),
		explanation: boolean("explanation", intent === "explanation"), question: boolean("question", intent === "question"),
		action: boolean("action"), projectScope: value.projectScope ?? "none",
		investigation: boolean("investigation"), mutation: boolean("mutation"), implementation: boolean("implementation"),
		testing: boolean("testing"), verification: boolean("verification"), audit: boolean("audit"), remediation: boolean("remediation"),
		research: boolean("research"), release: boolean("release"), multiStep: boolean("multiStep"), dependentSteps: boolean("dependentSteps"),
		deliverables: typeof value.deliverables === "number" ? value.deliverables : (value.multipleDeliverables === true ? 2 : 0),
		multiRole: boolean("multiRole"), sensitive: boolean("sensitive"), destructive: boolean("destructive"), risk: value.risk ?? "low",
	};
	return signature;
};

const migrateLegacyRule = (value: Record<string, unknown>): Record<string, unknown> => {
	if ("prompt" in value || !hasOnlyKeys(value, RULE_KEYS)) invalidRule("$.rule", "Legacy rule has unknown fields");
	const signature = isRecord(value.signature) && value.signature.schemaVersion === 0
		? migrateLegacySignature(value.signature)
		: value.signature;
	return { ...value, schemaVersion: ROUTING_MEMORY_SCHEMA_VERSION, signature };
};

const canonicalRule = (value: unknown): RoutingMemoryRule => {
	const record = expectRecord(value, "$.rule");
	if ("prompt" in record || !hasOnlyKeys(record, RULE_KEYS)) invalidRule("$.rule", "Rule has unknown fields");
	if (record.schemaVersion !== ROUTING_MEMORY_SCHEMA_VERSION) {
		if (record.schemaVersion === 0) return canonicalRule(migrateLegacyRule(record));
		invalidRule("$.rule.schemaVersion", "Rule schema version is unsupported");
	}
	if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)) invalidRule("$.rule.id", "Rule ID is invalid");
	if (record.action !== "mission" && record.action !== "normal") invalidRule("$.rule.action", "Rule action is invalid");
	if (record.source !== "explicit" && record.source !== "learned") invalidRule("$.rule.source", "Rule source is invalid");
	const signature = canonicalSignature(record.signature);
	if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) invalidRule("$.rule.confidence", "Rule confidence is out of bounds");
	if (typeof record.observations !== "number" || !Number.isSafeInteger(record.observations) || record.observations < 1 || record.observations > MAX_OBSERVATIONS) invalidRule("$.rule.observations", "Rule observations are out of bounds");
	if (typeof record.enabled !== "boolean") invalidRule("$.rule.enabled", "Rule enabled state is invalid");
	for (const key of ["createdAt", "updatedAt", "lastObservedAt"] as const) if (!validDate(record[key])) invalidRule(`$.rule.${key}`, "Rule timestamp is invalid");
	return {
		id: record.id as string,
		schemaVersion: ROUTING_MEMORY_SCHEMA_VERSION,
		action: record.action as RoutingAction,
		source: record.source as RoutingRuleSource,
		signature,
		confidence: record.confidence as number,
		observations: record.observations as number,
		enabled: record.enabled as boolean,
		createdAt: record.createdAt as string,
		updatedAt: record.updatedAt as string,
		lastObservedAt: record.lastObservedAt as string,
	};
};

export function validateRoutingMemoryRule(value: unknown): RoutingMemoryRule {
	return canonicalRule(value);
}

const migrateLegacyStored = (value: Record<string, unknown>): Record<string, unknown> => {
	if (!hasOnlyKeys(value, STORED_KEYS)) issue("$", "Stored Routing Memory has unknown fields");
	if (value.storageVersion !== 0) issue("$.storageVersion", "Stored Routing Memory version is unsupported");
	if (!Array.isArray(value.rules)) issue("$.rules", "Expected stored rules");
	const rules = value.rules as unknown[];
	return { ...value, storageVersion: ROUTING_MEMORY_STORAGE_VERSION, rules };
};

const parseStored = (value: unknown): ParsedStoredRoutingMemory => {
	let candidate = expectRecord(value, "$");
	let migrated = false;
	if (candidate.storageVersion === 0) {
		candidate = migrateLegacyStored(candidate);
		migrated = true;
	}
	if (!hasOnlyKeys(candidate, STORED_KEYS)) issue("$", "Stored Routing Memory has unknown fields");
	if (candidate.storageVersion !== ROUTING_MEMORY_STORAGE_VERSION) issue("$.storageVersion", "Stored Routing Memory version is unsupported");
	if (typeof candidate.generation !== "number" || !Number.isSafeInteger(candidate.generation) || candidate.generation < 0) issue("$.generation", "Generation is invalid");
	if (!validDate(candidate.savedAt)) issue("$.savedAt", "Timestamp is invalid");
	if (!Array.isArray(candidate.rules)) issue("$.rules", "Expected stored rules");
	const candidateRules = candidate.rules as unknown[];
	const diagnostics: string[] = [];
	const rules: RoutingMemoryRule[] = [];
	const ids = new Set<string>();
	for (const [index, rawRule] of candidateRules.entries()) {
		if (rules.length >= MAX_TOTAL_RULES) {
			diagnostics.push(`rule ${index} ignored: storage rule limit exceeded`);
			continue;
		}
		try {
			const rule = canonicalRule(rawRule);
			if (ids.has(rule.id)) throw new Error("duplicate rule ID");
			ids.add(rule.id);
			rules.push(rule);
		} catch {
			diagnostics.push(`rule ${index} ignored: invalid or unsupported schema`);
		}
	}
	return {
		stored: {
			storageVersion: ROUTING_MEMORY_STORAGE_VERSION,
				generation: candidate.generation as number,
				savedAt: candidate.savedAt as string,
			rules,
		},
		diagnostics,
		migrated,
	};
};

export function validateStoredRoutingMemory(value: unknown): StoredRoutingMemory {
	const parsed = parseStored(value);
	if (parsed.diagnostics.length > 0) issue("$.rules", "Stored Routing Memory contains invalid rules");
	return parsed.stored;
}

const signalsFromInput = (localSignals?: RoutingLocalSignals): ReadonlySet<string> =>
	new Set((localSignals?.signals ?? []).map((signal) => signal.toLocaleLowerCase()));

export function buildRoutingSignature(prompt: string, localSignals?: RoutingLocalSignals): RoutingSignature {
	if (typeof prompt !== "string") throw new TypeError("prompt-required");
	const text = normalize(prompt);
	const signals = signalsFromInput(localSignals);
	const explanation = localSignal(signals, "explanation_only") || explanationPattern.test(text);
	const question = localSignal(signals, "question_only") || /(?:\?|؟)\s*$/u.test(text) || (!explanation && questionPattern.test(text) && !actionPattern.test(text));
	const investigation = localSignal(signals, "investigation", "debug_and_fix") || investigationPattern.test(text);
	const mutation = localSignal(signals, "mutation", "debug_and_fix") || mutationPattern.test(text);
	const implementation = localSignal(signals, "research_and_implementation") || implementationPattern.test(text);
	const testing = localSignal(signals, "tests_requested") || testingPattern.test(text);
	const verification = localSignal(signals, "independent_verification") || verificationPattern.test(text);
	const audit = localSignal(signals, "audit_review") || auditPattern.test(text);
	const remediation = localSignal(signals, "debug_and_fix") || remediationPattern.test(text);
	const research = localSignal(signals, "research_and_implementation") || researchPattern.test(text);
	const release = localSignal(signals, "release_deployment") || releasePattern.test(text);
	const projectScope: RoutingProjectScope = localSignal(signals, "repository_scope") || projectPattern.test(text)
		? /(?:\/[^\s]+){2,}|\b(?:api\s+and\s+ui|frontend\s+and\s+backend|across\s+(?:the\s+)?(?:repo|repository|modules?))\b|(?:رابط و رابط کاربری|فرانت.?اند و بک.?اند|چند فایل)/iu.test(text)
			? "multiple"
			: /\b(?:repo(?:sitory)?|project|codebase|repository|git|branch|entire)\b|(?:مخزن|ریپو|ریپازیتوری|پروژه|کدبیس|شاخه|تمام)/iu.test(text)
				? "repository"
				: /\b(?:module|package|component)\b|(?:ماژول|بسته|کامپوننت)/iu.test(text)
					? "module"
					: "file"
		: "none";
	const action = localSignal(signals, "action_requested") || actionPattern.test(text) || mutation || investigation || release;
	const dependentSteps = dependentPattern.test(text);
	const clauseCount = text.split(/(?:\r?\n|[.!?؟؛;]|\b(?:and|then|after|before|next|finally|until|first)\b|(?:و|سپس|بعد|قبل|درنهایت|تا)\b)/iu).map((part) => part.trim()).filter(Boolean).length;
	const conceptCount = [investigation, mutation || implementation, testing, verification, audit, research, release].filter(Boolean).length;
	const multiStep = localSignal(signals, "multi_step", "multiple_deliverables", "multiple_roles", "research_and_implementation") || dependentSteps || conceptCount >= 2 || clauseCount >= 3;
	const deliverables = action
		? Math.min(MAX_DELIVERABLES, Math.max(localSignal(signals, "multiple_deliverables") ? 2 : 1, [mutation || implementation, testing, verification, audit, research, release].filter(Boolean).length))
		: 0;
	const multiRole = localSignal(signals, "multiple_roles", "research_and_implementation") || multiRolePattern.test(text) ||
		(investigation && (mutation || implementation)) || (mutation && (testing || verification)) || (audit && (mutation || remediation));
	const sensitive = localSignal(signals, "high_consequence", "destructive_sensitive") || sensitivePattern.test(text);
	const destructive = localSignal(signals, "destructive_sensitive") || destructivePattern.test(text);
	const risk: RoutingRisk = sensitive || destructive || (release && /\b(?:production|live|database|financial)\b|(?:تولید|زنده|پایگاه|مالی)/iu.test(text)) ? "high" : (mutation || multiStep || multiRole || release ? "medium" : "low");
	const taskFamily: RoutingTaskFamily = explanation && !action && !investigation && !research ? "explanation"
		: question && !action && !investigation && !research ? "question"
		: release ? "release"
		: audit ? "audit"
		: research && implementation ? "research"
		: research ? "research"
		: investigation && (mutation || implementation || remediation) ? "debug"
		: implementation ? "implementation"
		: testing && !mutation ? "testing"
		: verification && !mutation ? "verification"
		: action || mutation ? "action"
		: "other";
	const language: RoutingLanguage = containsPersian(text) && containsLatin(text) ? "mixed" : containsPersian(text) ? "fa" : "en";
	return {
		schemaVersion: ROUTING_MEMORY_SCHEMA_VERSION, language, taskFamily, explanation, question, action, projectScope,
		investigation, mutation, implementation, testing, verification, audit, remediation, research, release,
		multiStep, dependentSteps, deliverables, multiRole, sensitive, destructive, risk,
	};
}

const toPublicRule = (rule: RoutingMemoryRule): RoutingMemoryRuleView => structuredClone(rule);
const cloneRules = (rules: readonly RoutingMemoryRule[]): RoutingMemoryRule[] => rules.map((rule) => structuredClone(rule));
const sameRules = (left: readonly RoutingMemoryRule[], right: readonly RoutingMemoryRule[]): boolean =>
	deterministicJson(left) === deterministicJson(right);

export class RoutingMemoryStore {
	private readonly root: string;
	private readonly activeFile: string;
	private readonly historyDir: string;
	private readonly retention: number;
	private readonly maxLearnedRules: number;
	private readonly now: () => string;
	private readonly nextId: () => string;
	private policy: Required<Pick<RoutingMemoryPolicy, "enabled" | "learnFromChoices" | "existingRulesApply">>;
	private queue: Promise<unknown> = Promise.resolve();
	private loaded = false;
	private generation = 0;
	private savedAt: string | undefined;
	private rules: RoutingMemoryRule[] = [];

	constructor(options: RoutingMemoryStoreOptions) {
		if (typeof options.root !== "string" || options.root.length === 0) throw new TypeError("root-required");
		this.root = options.root;
		this.activeFile = options.activeFile ?? DEFAULT_ROUTING_MEMORY_FILE;
		if (!/^[a-zA-Z0-9._-]+\.json$/u.test(this.activeFile)) throw new TypeError("active-file-invalid");
		this.historyDir = "routing-memory-history";
		this.retention = Math.max(1, Math.min(100, options.retention ?? DEFAULT_ROUTING_MEMORY_RETENTION));
		this.maxLearnedRules = Math.max(1, Math.min(MAX_LEARNED_RULES, options.maxLearnedRules ?? DEFAULT_MAX_LEARNED_RULES));
		this.now = options.now ?? (() => new Date().toISOString());
		this.nextId = options.id ?? (() => `rm-${randomUUID()}`);
		this.policy = {
			enabled: options.enabled ?? true,
			learnFromChoices: options.learnFromChoices ?? true,
			existingRulesApply: options.existingRulesApply ?? options.applyExistingRules ?? true,
		};
	}

	load(): Promise<RoutingMemoryLoadResult> {
		return this.enqueue(() => this.loadUnlocked());
	}

	/** Set application gating without deleting retained rules. */
	setEnabled(enabled: boolean): void;
	/** Enable or disable one stored rule. */
	setEnabled(ruleId: string, enabled: boolean, options?: RoutingMemoryCallOptions): Promise<RoutingMemoryMutationResult>;
	setEnabled(ruleIdOrEnabled: string | boolean, enabled?: boolean, options: RoutingMemoryCallOptions = {}): void | Promise<RoutingMemoryMutationResult> {
		if (typeof ruleIdOrEnabled === "boolean") {
			this.policy = { ...this.policy, enabled: ruleIdOrEnabled };
			return;
		}
		if (enabled === undefined) return Promise.reject(new TypeError("enabled-required"));
		return this.mutate((rules) => {
			const index = rules.findIndex((rule) => rule.id === ruleIdOrEnabled);
			if (index < 0 || rules[index]?.enabled === enabled) return rules;
			const rule = rules[index];
			if (!rule) return rules;
			rules[index] = { ...rule, enabled, updatedAt: this.timestamp() };
			return rules;
		}, options.expectedGeneration);
	}

	async match(input: string | RoutingSignature, options: RoutingMemoryCallOptions = {}): Promise<RoutingMemoryMatch> {
		const policy = this.resolvePolicy(options);
		if (!policy.enabled || !policy.existingRulesApply) return this.none(policy.enabled ? "application-disabled" : "memory-disabled");
		return this.enqueue(async () => {
			const loaded = await this.loadUnlocked();
			if (loaded.status === "corrupt") return this.none("memory-corrupt");
			const signature = this.inputSignature(input);
			const candidates = this.rules.filter((rule) => rule.enabled).map((rule) => ({ rule, similarity: routingSignatureSimilarity(signature, rule.signature) }));
			const explicit = candidates.filter(({ rule, similarity }) => rule.source === "explicit" && similarity >= MATCH_THRESHOLD);
			const learned = candidates.filter(({ rule, similarity }) => rule.source === "learned" && similarity >= LEARNED_MATCH_THRESHOLD && rule.observations >= 3 && rule.confidence >= LEARNED_CONFIDENCE_THRESHOLD && (rule.action !== "normal" || learnedNormalCompatible(signature, rule.signature)));
			const strong = [...explicit, ...learned];
			if (strong.length === 0) {
				const best = candidates.sort((left, right) => right.similarity - left.similarity)[0];
				if (best && (materiallyEscalated(signature, best.rule.signature) || (best.rule.source === "learned" && best.rule.action === "normal" && !learnedNormalCompatible(signature, best.rule.signature)))) return this.none("memory-bypassed-due-to-current-complexity", best.similarity);
				return best && best.similarity >= LEARNED_MATCH_THRESHOLD
					? this.none("matching-rule-lacks-repeated-evidence", best.similarity)
					: this.none("no-sufficiently-similar-rule", best?.similarity);
			}
			// Explicit user rules outrank learned evidence. Conflicts remain
			// undecided only within the same authority tier.
			const effective = explicit.length > 0 ? explicit : strong;
			const mission = effective.filter(({ rule }) => rule.action === "mission");
			const normal = effective.filter(({ rule }) => rule.action === "normal");
			if (mission.length > 0 && normal.length > 0) {
				return { kind: "conflict", status: "conflict", reason: "conflicting routing rules require user choice", conflict: true };
			}
			effective.sort((left, right) => this.compareCandidates(left, right));
			const winner = effective[0];
			if (!winner) return this.none("no-sufficiently-similar-rule");
			const { rule, similarity } = winner;
			const mode: RoutingMemoryMode = rule.action === "mission"
				? rule.source === "explicit" ? "AUTO_MISSION" : "SUGGEST_MISSION"
				: "NORMAL";
			return {
				kind: "strong", status: "strong", mode, action: rule.action, source: rule.source, ruleId: rule.id,
				confidence: rule.confidence, similarity,
				reason: rule.source === "explicit" ? "explicit routing rule matched" : "repeated routing choice met the evidence threshold",
			};
		});
	}

	addExplicitMissionRule(input: string | RoutingSignature, options: RoutingMemoryCallOptions & { readonly id?: string } = {}): Promise<RoutingMemoryRuleWrite> {
		return this.addExplicitRule(input, "mission", options);
	}

	addExplicitRule(input: string | RoutingSignature, action: RoutingAction, options: RoutingMemoryCallOptions & { readonly id?: string } = {}): Promise<RoutingMemoryRuleWrite> {
		if (action !== "mission" && action !== "normal") return Promise.reject(new TypeError("action-invalid"));
		const signature = this.inputSignature(input);
		return this.enqueue(async () => {
			const current = await this.readCurrentForMutation();
			const now = this.timestamp();
			const rules = cloneRules(current?.rules ?? []);
			const existing = rules
				.filter((rule) => rule.source === "explicit" && rule.action === action)
				.map((rule) => ({ rule, similarity: routingSignatureSimilarity(signature, rule.signature) }))
				.filter((item) => item.similarity >= EXPLICIT_MERGE_THRESHOLD)
				.sort((left, right) => right.similarity - left.similarity)[0];
			let rule: RoutingMemoryRule;
			let created = false;
			if (existing) {
				const index = rules.findIndex((item) => item.id === existing.rule.id);
				const updated = { ...existing.rule, enabled: true, confidence: 1, observations: Math.min(MAX_OBSERVATIONS, existing.rule.observations + 1), updatedAt: now, lastObservedAt: now };
				rules[index] = updated;
				rule = updated;
			} else {
				created = true;
				if (rules.filter((item) => item.source === "explicit").length >= MAX_EXPLICIT_RULES) throw new ConfigValidationError([{ code: "routing-memory-limit", path: "$.rules", message: "Explicit routing rule limit reached" }]);
				const id = options.id ?? this.nextId();
				if (!ID_PATTERN.test(id)) throw new ConfigValidationError([{ code: "routing-memory-rule", path: "$.id", message: "Rule ID is invalid" }]);
				rule = { id, schemaVersion: ROUTING_MEMORY_SCHEMA_VERSION, action, source: "explicit", signature, confidence: 1, observations: 1, enabled: true, createdAt: now, updatedAt: now, lastObservedAt: now };
				rules.push(rule);
			}
			await this.commit(rules, current, options.expectedGeneration);
			return { ...toPublicRule(rule), created };
		});
	}

	setRuleEnabled(ruleId: string, enabled: boolean, options: RoutingMemoryCallOptions = {}): Promise<RoutingMemoryMutationResult> {
		return this.setEnabled(ruleId, enabled, options);
	}

	observeChoice(input: string | RoutingSignature, action: RoutingAction, options: RoutingMemoryCallOptions = {}): Promise<ObserveChoiceResult> {
		if (action !== "mission" && action !== "normal") return Promise.reject(new TypeError("action-invalid"));
		const signature = this.inputSignature(input);
		const policy = this.resolvePolicy(options);
		if (!policy.enabled || !policy.learnFromChoices) return this.noopObserve();
		return this.enqueue(async () => {
			const current = await this.readCurrentForMutation();
			const now = this.timestamp();
			const rules = cloneRules(current?.rules ?? []);
			const matching = rules
				.filter((rule) => rule.source === "learned" && rule.action === action)
				.map((rule) => ({ rule, similarity: routingSignatureSimilarity(signature, rule.signature) }))
				.filter((item) => item.similarity >= LEARNED_MERGE_THRESHOLD)
				.sort((left, right) => right.similarity - left.similarity)[0];
			let rule: RoutingMemoryRule;
			let prunedRuleId: string | undefined;
			let created = false;
			if (matching) {
				const index = rules.findIndex((item) => item.id === matching.rule.id);
				const observations = Math.min(MAX_OBSERVATIONS, matching.rule.observations + 1);
				const updated = { ...matching.rule, observations, confidence: Math.max(matching.rule.confidence, clamp(0.48 + observations * 0.12)), updatedAt: now, lastObservedAt: now };
				rules[index] = updated;
				rule = updated;
			} else {
				created = true;
				const learned = rules.filter((item) => item.source === "learned");
				if (learned.length >= this.maxLearnedRules) {
					const prune = [...learned].sort((left, right) => left.observations - right.observations || left.confidence - right.confidence || left.updatedAt.localeCompare(right.updatedAt))[0];
					if (prune) {
						prunedRuleId = prune.id;
						const index = rules.findIndex((item) => item.id === prune.id);
						if (index >= 0) rules.splice(index, 1);
					}
				}
				const id = this.nextId();
				if (!ID_PATTERN.test(id)) throw new ConfigValidationError([{ code: "routing-memory-rule", path: "$.id", message: "Rule ID is invalid" }]);
				rule = { id, schemaVersion: ROUTING_MEMORY_SCHEMA_VERSION, action, source: "learned", signature, confidence: 0.6, observations: 1, enabled: true, createdAt: now, updatedAt: now, lastObservedAt: now };
				rules.push(rule);
			}
			const mutation = await this.commit(rules, current, options.expectedGeneration);
			return { ...mutation, learned: true, created, ruleCreated: created, rule: toPublicRule(rule), ...(prunedRuleId === undefined ? {} : { prunedRuleId }) };
		});
	}

	deleteRule(ruleId: string, options: RoutingMemoryCallOptions = {}): Promise<RoutingMemoryMutationResult> {
		return this.mutate((rules) => rules.filter((rule) => rule.id !== ruleId), options.expectedGeneration);
	}

	forgetLearned(options: RoutingMemoryCallOptions = {}): Promise<RoutingMemoryMutationResult> {
		return this.mutate((rules) => rules.filter((rule) => rule.source !== "learned"), options.expectedGeneration);
	}

	reset(options: RoutingMemoryCallOptions = {}): Promise<RoutingMemoryMutationResult> {
		return this.enqueue(async () => {
			const current = await this.readCurrentForMutation();
			if (options.expectedGeneration !== undefined && options.expectedGeneration !== (current?.generation ?? 0)) throw new ConfigConflictError(options.expectedGeneration, current?.generation ?? 0);
			const mutation = current && current.rules.length > 0 ? await this.commit([], current, options.expectedGeneration) : { changed: false, generation: current?.generation ?? 0 };
			await this.clearHistory();
			return mutation;
		});
	}

	listViews(): Promise<readonly RoutingMemoryRuleView[]> {
		return this.enqueue(async () => {
			const loaded = await this.loadUnlocked();
			if (loaded.status === "corrupt") throw new ConfigRecoveryError("active-config-invalid");
			return this.rules.map(toPublicRule);
		});
	}

	backup(destination?: string): Promise<string> {
		return this.enqueue(async () => {
			const loaded = await this.loadUnlocked();
			if (loaded.status === "corrupt") throw new ConfigRecoveryError("active-config-invalid");
			const target = destination ?? join(this.root, "routing-memory.backup.json");
			if (resolve(target) === resolve(join(this.root, this.activeFile))) throw new TypeError("backup-target-is-active-file");
			const stored: StoredRoutingMemory = { storageVersion: ROUTING_MEMORY_STORAGE_VERSION, generation: this.generation, savedAt: this.savedAt ?? this.timestamp(), rules: cloneRules(this.rules) };
			await mkdir(dirname(target), { recursive: true, mode: STORAGE_DIRECTORY_MODE });
			await writeAtomicFile(target, deterministicJson(stored), undefined, "active");
			return target;
		});
	}

	restore(sourceOrGeneration: string | number, options: RoutingMemoryCallOptions = {}): Promise<RoutingMemoryMutationResult> {
		return this.enqueue(async () => {
			const current = await this.readCurrentForMutation();
			if (sourceOrGeneration === 0) throw new ConfigRecoveryError("history-generation-not-found");
			let target: StoredRoutingMemory | undefined;
			if (typeof sourceOrGeneration === "number") {
				if (!Number.isSafeInteger(sourceOrGeneration) || sourceOrGeneration < 1) throw new ConfigRecoveryError("history-generation-not-found");
				for (const stored of await this.readHistory()) if (stored.generation === sourceOrGeneration) { target = stored; break; }
			} else {
				try {
					const bytes = await readFile(sourceOrGeneration);
					if (bytes.length > MAX_ACTIVE_BYTES) throw new Error("backup-size-limit");
					const parsed = parseStored(JSON.parse(bytes.toString("utf8")) as unknown);
					if (parsed.diagnostics.length > 0) throw new Error("backup-contains-invalid-rules");
					target = parsed.stored;
				}
				catch { throw new ConfigRecoveryError("backup-invalid"); }
			}
			if (!target) throw new ConfigRecoveryError("history-generation-not-found");
			return this.commit(target.rules, current, options.expectedGeneration);
		});
	}

	restoreBackup(source: string, options: RoutingMemoryCallOptions = {}): Promise<RoutingMemoryMutationResult> {
		return this.restore(source, options);
	}

	private inputSignature(input: string | RoutingSignature): RoutingSignature {
		return typeof input === "string" ? buildRoutingSignature(input) : canonicalSignature(input);
	}

	private resolvePolicy(options: RoutingMemoryPolicy): Required<Pick<RoutingMemoryPolicy, "enabled" | "learnFromChoices" | "existingRulesApply">> {
		return {
			enabled: options.enabled ?? this.policy.enabled,
			learnFromChoices: options.learnFromChoices ?? this.policy.learnFromChoices,
			existingRulesApply: options.existingRulesApply ?? options.applyExistingRules ?? this.policy.existingRulesApply,
		};
	}

	private none(reason: string, similarity?: number): RoutingMemoryMatch {
		return similarity === undefined ? { kind: "none", status: "none", reason } : { kind: "none", status: "none", similarity, reason };
	}

	private compareCandidates(left: { readonly rule: RoutingMemoryRule; readonly similarity: number }, right: { readonly rule: RoutingMemoryRule; readonly similarity: number }): number {
		const source = (right.rule.source === "explicit" ? 1 : 0) - (left.rule.source === "explicit" ? 1 : 0);
		return source || right.similarity - left.similarity || right.rule.confidence - left.rule.confidence || right.rule.observations - left.rule.observations || left.rule.id.localeCompare(right.rule.id);
	}

	private noopObserve(): Promise<ObserveChoiceResult> {
		return this.enqueue(async () => {
			const loaded = await this.loadUnlocked();
			return { changed: false, generation: loaded.generation, learned: false, created: false, ruleCreated: false };
		});
	}

	private mutate(mutator: (rules: RoutingMemoryRule[]) => RoutingMemoryRule[], expectedGeneration?: number): Promise<RoutingMemoryMutationResult> {
		return this.enqueue(async () => {
			const current = await this.readCurrentForMutation();
			if (expectedGeneration !== undefined && expectedGeneration !== (current?.generation ?? 0)) throw new ConfigConflictError(expectedGeneration, current?.generation ?? 0);
			const next = mutator(cloneRules(current?.rules ?? []));
			if (current && sameRules(current.rules, next)) return { changed: false, generation: current.generation, previousGeneration: current.generation };
			if (!current && next.length === 0) return { changed: false, generation: 0 };
			return this.commit(next, current);
		});
	}

	private enqueue<T>(operation: () => Promise<T>, lock = true): Promise<T> {
		const run = this.queue.then(() => lock ? withStorageLock(this.root, operation) : operation(), () => lock ? withStorageLock(this.root, operation) : operation());
		this.queue = run.then(() => undefined, () => undefined);
		return run;
	}

	private async loadUnlocked(): Promise<RoutingMemoryLoadResult> {
		const active = await this.readActive();
		if (active.kind === "missing") {
			this.loaded = true; this.generation = 0; this.savedAt = undefined; this.rules = [];
			return { status: "missing", generation: 0, rules: [], repairRequired: false, diagnostics: [] };
		}
		if (active.kind === "invalid" || !active.parsed) {
			this.loaded = true; this.generation = 0; this.savedAt = undefined; this.rules = [];
			return { status: "corrupt", generation: 0, rules: [], repairRequired: true, diagnostics: ["active routing memory is invalid"] };
		}
		this.loaded = true; this.generation = active.parsed.stored.generation; this.savedAt = active.parsed.stored.savedAt; this.rules = cloneRules(active.parsed.stored.rules);
		if (active.parsed.migrated || active.parsed.diagnostics.length > 0) await this.repairActive(active.parsed.stored);
		return { status: "valid", generation: this.generation, savedAt: this.savedAt, rules: this.rules.map(toPublicRule), repairRequired: active.parsed.migrated || active.parsed.diagnostics.length > 0, diagnostics: active.parsed.diagnostics };
	}

	private async readActive(): Promise<ActiveRead> {
		let bytes: Buffer;
		try { bytes = await readFile(join(this.root, this.activeFile)); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
			return { kind: "invalid" };
		}
		if (bytes.length > MAX_ACTIVE_BYTES) return { kind: "invalid", bytes };
		try { return { kind: "valid", bytes, parsed: parseStored(JSON.parse(bytes.toString("utf8")) as unknown) }; }
		catch { return { kind: "invalid", bytes }; }
	}

	private async readCurrentForMutation(): Promise<(StoredRoutingMemory & { readonly rules: readonly RoutingMemoryRule[] }) | undefined> {
		const active = await this.readActive();
		if (active.kind === "missing") {
			this.loaded = true; this.generation = 0; this.savedAt = undefined; this.rules = [];
			return undefined;
		}
		if (active.kind === "invalid" || !active.parsed) throw new ConfigRecoveryError("active-config-invalid");
		const current = active.parsed.stored;
		this.loaded = true; this.generation = current.generation; this.savedAt = current.savedAt; this.rules = cloneRules(current.rules);
		return current;
	}

	private async commit(nextRules: readonly RoutingMemoryRule[], current: StoredRoutingMemory | undefined, expectedGeneration?: number): Promise<RoutingMemoryMutationResult> {
		if (expectedGeneration !== undefined && expectedGeneration !== (current?.generation ?? 0)) throw new ConfigConflictError(expectedGeneration, current?.generation ?? 0);
		const generation = (current?.generation ?? 0) + 1;
		if (!Number.isSafeInteger(generation)) throw new ConfigRecoveryError("generation-exhausted");
		const savedAt = this.timestamp();
		const stored: StoredRoutingMemory = { storageVersion: ROUTING_MEMORY_STORAGE_VERSION, generation, savedAt, rules: cloneRules(nextRules) };
		await ensureStorageDirectories(this.root);
		await mkdir(join(this.root, this.historyDir), { recursive: true, mode: STORAGE_DIRECTORY_MODE });
		let historyPath: string | undefined;
		if (current) {
			historyPath = join(this.root, this.historyDir, `routing-memory-${current.generation.toString().padStart(20, "0")}.json`);
			await writeAtomicFile(historyPath, deterministicJson(current), undefined, "history");
			const warnings: string[] = [];
			try { await this.pruneHistory(); } catch { warnings.push("history retention cleanup failed"); }
			await writeAtomicFile(join(this.root, this.activeFile), deterministicJson(stored), undefined, "active");
			this.apply(stored);
			return { changed: true, generation, previousGeneration: current.generation, historyPath, ...(warnings.length === 0 ? {} : { warnings }) };
		}
		await writeAtomicFile(join(this.root, this.activeFile), deterministicJson(stored), undefined, "active");
		this.apply(stored);
		return { changed: true, generation };
	}

	private async readHistory(): Promise<readonly StoredRoutingMemory[]> {
		let names: string[];
		try { names = await readdir(join(this.root, this.historyDir)); } catch { return []; }
		const entries: StoredRoutingMemory[] = [];
		for (const name of names.filter((item) => /^routing-memory-\d{20}\.json$/u.test(item))) {
			try {
				const parsed = parseStored(JSON.parse(await readFile(join(this.root, this.historyDir, name), "utf8")) as unknown);
				if (parsed.diagnostics.length > 0) throw new ConfigRecoveryError("history-entry-invalid");
				entries.push(parsed.stored);
			} catch (error) {
				if (error instanceof ConfigRecoveryError) throw error;
				throw new ConfigRecoveryError("history-entry-invalid");
			}
		}
		return entries.sort((left, right) => right.generation - left.generation);
	}

	private async pruneHistory(): Promise<void> {
		const names = (await readdir(join(this.root, this.historyDir))).filter((item) => /^routing-memory-\d{20}\.json$/u.test(item)).sort().reverse();
		await Promise.all(names.slice(this.retention).map((name) => unlink(join(this.root, this.historyDir, name)).catch(() => undefined)));
	}

	private async repairActive(stored: StoredRoutingMemory): Promise<void> {
		await ensureStorageDirectories(this.root);
		await writeAtomicFile(join(this.root, this.activeFile), deterministicJson(stored), undefined, "active");
	}

	private async clearHistory(): Promise<void> {
		let names: string[];
		try { names = await readdir(join(this.root, this.historyDir)); } catch { return; }
		await Promise.all(names.filter((name) => /^routing-memory-\d{20}\.json$/u.test(name)).map((name) => unlink(join(this.root, this.historyDir, name)).catch(() => undefined)));
	}

	private apply(stored: StoredRoutingMemory): void {
		this.loaded = true; this.generation = stored.generation; this.savedAt = stored.savedAt; this.rules = cloneRules(stored.rules);
	}

	private timestamp(): string {
		const value = this.now();
		if (!validDate(value)) throw new TypeError("clock-invalid");
		return value;
	}
}
