import { createHash } from "node:crypto";

export function qualityRejectionFingerprint(input: {
	readonly taskId: string;
	readonly verdict: string;
	readonly requiredFixes?: readonly string[];
	readonly notVerified?: readonly string[];
	readonly evidenceKind?: string;
	readonly repairInstruction?: string;
}): string {
	const material = [
		input.taskId,
		input.verdict,
		...(input.requiredFixes ?? []).map((item) => item.trim().toLowerCase()).sort(),
		...(input.notVerified ?? []).map((item) => item.trim().toLowerCase()).sort(),
		input.evidenceKind ?? "",
		(input.repairInstruction ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ").slice(0, 500),
	].join("\n");
	return createHash("sha256").update(material).digest("hex").slice(0, 24);
}
