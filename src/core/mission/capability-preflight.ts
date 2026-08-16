import { CommandSafetyPolicy } from "../security/index.js";

export type MissionCapabilityIssueCode =
	| "NETWORK_OR_PUBLICATION"
	| "COMMAND_NOT_ALLOWLISTED"
	| "DESTRUCTIVE_GIT"
	| "WORKER_CAPABILITY";

export interface MissionCapabilityIssue {
	readonly criterion: string;
	readonly code: MissionCapabilityIssueCode;
	readonly reason: string;
}

export interface MissionCapabilityPreflight {
	readonly allowed: boolean;
	readonly issues: readonly MissionCapabilityIssue[];
}

const PUBLICATION_INTENT = /\b(?:git\s+(?:push|fetch|pull|clone)|commit\s+and\s+push|npm\s+publish|pnpm\s+publish|yarn\s+publish|docker\s+push|gh\s+(?:release|auth|repo)\b)/giu;
const COMMIT_INTENT = /\b(?:git\s+commit|commit\s+and\s+push)\b/giu;

const bounded = (value: string): string => value.trim().replace(/\s+/gu, " ").slice(0, 240);

const issue = (criterion: string, code: MissionCapabilityIssueCode, reason: string): MissionCapabilityIssue => ({
	criterion: bounded(criterion),
	code,
	reason: bounded(reason),
});

function negatedAt(source: string, index: number): boolean {
	const prefix = source.slice(Math.max(0, index - 48), index);
	return /(?:do\s+not|don't|without|never|must\s+not|cannot|can't|no)\s+$/iu.test(prefix);
}

function hasUnnegatedMatch(pattern: RegExp, source: string): boolean {
	for (const match of source.matchAll(pattern)) {
		if (!negatedAt(source, match.index ?? 0)) return true;
	}
	return false;
}

function scanText(source: string, policy: CommandSafetyPolicy): readonly MissionCapabilityIssue[] {
	const text = source.trim();
	if (!text) return [];
	const found: MissionCapabilityIssue[] = [];
	if (hasUnnegatedMatch(PUBLICATION_INTENT, text)) {
		found.push(issue(text, "NETWORK_OR_PUBLICATION", "Goal requires network or publication that implementation workers cannot perform"));
	} else if (hasUnnegatedMatch(COMMIT_INTENT, text)) {
		found.push(issue(text, "COMMAND_NOT_ALLOWLISTED", "Goal requires git commit, which is outside the worker command allowlist"));
	}
	const commandLike = /^\s*(?:git|npm|pnpm|yarn|gh|docker|curl|ssh)\b/iu.test(text);
	if (commandLike) {
		const result = policy.evaluate(text, { trusted: true });
		if (result.decision !== "ALLOW") {
			const code: MissionCapabilityIssueCode = result.code === "NETWORK_OR_PUBLICATION" || result.code === "DESTRUCTIVE_GIT" || result.code === "COMMAND_NOT_ALLOWLISTED"
				? result.code
				: "WORKER_CAPABILITY";
			if (!found.some((item) => item.code === code)) found.push(issue(text, code, result.reason));
		}
	}
	return found;
}

/** Mission-level Goal/criteria that workers cannot satisfy in-band. */
export function evaluateMissionCapability(goal: string, acceptanceCriteria: readonly string[] = []): MissionCapabilityPreflight {
	const policy = new CommandSafetyPolicy();
	const issues = [
		...scanText(goal, policy),
		...acceptanceCriteria.flatMap((criterion) => scanText(criterion, policy)),
	];
	const unique: MissionCapabilityIssue[] = [];
	for (const item of issues) {
		if (unique.some((existing) => existing.code === item.code && existing.criterion === item.criterion)) continue;
		unique.push(item);
		if (unique.length >= 16) break;
	}
	return { allowed: unique.length === 0, issues: unique };
}

export function capabilityMismatchReason(result: MissionCapabilityPreflight): string {
	const first = result.issues[0];
	if (!first) return "Goal requires operations outside worker capability";
	return `${first.reason}; ${first.code}`.slice(0, 240);
}
