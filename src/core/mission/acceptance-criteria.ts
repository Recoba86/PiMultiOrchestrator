export type MissionAcceptanceCriteriaProvenance = "explicit" | "labelled-goal" | "derived-from-goal";

const MAX_CRITERION_CHARS = 2_000;
const MAX_CRITERIA = 16;
const LABELLED_HEADING = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:mission\s+)?(?:acceptance|success)\s+criteria\s*[:\-–]?\s*/iu;
const LIST_ITEM = /^(?:[-*•]|\d+[.)])\s+(\S.*)$/u;
const MARKDOWN_HEADING = /^#{1,6}\s+\S/u;

const normalizeCriterion = (value: string): string => value.normalize("NFKC").replace(/[\u200b\ufeff\u2060]/gu, "").replace(/\s+/gu, " ").trim().slice(0, MAX_CRITERION_CHARS);

export function normalizeAcceptanceCriteriaList(values: readonly unknown[] | undefined): readonly string[] {
	if (!Array.isArray(values)) return [];
	const seen = new Set<string>();
	const criteria: string[] = [];
	for (const item of values) {
		if (typeof item !== "string") continue;
		const normalized = normalizeCriterion(item);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		criteria.push(normalized);
		if (criteria.length >= MAX_CRITERIA) break;
	}
	return criteria;
}

const splitInlineCriteria = (value: string): readonly string[] => {
	const parts = value.split(/\s*;\s*/u).flatMap((item) => item.includes(";") ? [item] : item.split(/\s+(?:and|&)\s+(?=[A-Z])/u));
	const items = parts.map((item) => normalizeCriterion(item.replace(/^[-*•]\s+/u, ""))).filter(Boolean);
	return items.length > 1 ? items.slice(0, MAX_CRITERIA) : items.length === 1 ? [items[0]!] : [];
};

export function extractLabelledAcceptanceCriteria(goal: string): readonly string[] {
	const source = goal.normalize("NFKC").replace(/\r\n/gu, "\n");
	const match = LABELLED_HEADING.exec(source);
	if (!match) return [];
	const after = source.slice(match.index + match[0].length);
	const lines = after.split("\n");
	const items: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const raw = lines[index] ?? "";
		const trimmed = raw.trim();
		if (!trimmed) {
			if (items.length === 0) continue;
			const next = lines.slice(index + 1).find((line) => line.trim());
			if (next && (MARKDOWN_HEADING.test(next.trim()) || LABELLED_HEADING.test(`\n${next}`))) break;
			continue;
		}
		if (index > 0 && (MARKDOWN_HEADING.test(trimmed) || /^(?:mission\s+)?(?:constraints?|next steps?|tasks?)\s*[:\-–]?\s*$/iu.test(trimmed))) break;
		const list = LIST_ITEM.exec(trimmed);
		if (list) {
			const criterion = normalizeCriterion(list[1] ?? "");
			if (criterion) items.push(criterion);
			if (items.length >= MAX_CRITERIA) break;
			continue;
		}
		if (items.length === 0) {
			items.push(...splitInlineCriteria(trimmed));
			if (items.length > 0) break;
		}
		break;
	}
	return normalizeAcceptanceCriteriaList(items);
}

export function deriveAcceptanceCriteriaFromGoal(goal: string): readonly string[] {
	const compact = normalizeCriterion(goal);
	if (!compact) return [];
	const prefix = "Achieve the Mission goal: ";
	return [`${prefix}${compact.slice(0, MAX_CRITERION_CHARS - prefix.length)}`];
}

export function resolveMissionAcceptanceCriteria(
	goal: string,
	explicit?: readonly string[],
): { readonly criteria: readonly string[]; readonly provenance: MissionAcceptanceCriteriaProvenance } {
	const explicitCriteria = normalizeAcceptanceCriteriaList(explicit);
	if (explicitCriteria.length > 0) return { criteria: explicitCriteria, provenance: "explicit" };
	const labelled = extractLabelledAcceptanceCriteria(goal);
	if (labelled.length > 0) return { criteria: labelled, provenance: "labelled-goal" };
	return { criteria: deriveAcceptanceCriteriaFromGoal(goal), provenance: "derived-from-goal" };
}

export function inferAcceptanceCriteriaProvenance(goal: string, criteria: readonly string[]): MissionAcceptanceCriteriaProvenance {
	if (criteria.length === 0) return "derived-from-goal";
	const labelled = extractLabelledAcceptanceCriteria(goal);
	if (labelled.length > 0 && labelled.length === criteria.length && labelled.every((item, index) => item === criteria[index])) return "labelled-goal";
	const derived = deriveAcceptanceCriteriaFromGoal(goal);
	if (derived.length > 0 && derived.length === criteria.length && derived.every((item, index) => item === criteria[index])) return "derived-from-goal";
	return "explicit";
}
