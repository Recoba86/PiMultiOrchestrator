import { evaluateQualityGate, parseVerificationResult } from "./gate.js";
import { QualityError } from "./errors.js";
import type {
	DiversityPreference, QualityDecisionRecord, QualityEscalationRequest, QualityGatePolicy, QualityLoopOptions,
	QualityPersistence, ReviewerRouteCandidate, TaskQualityStatus, VerificationResultV1, VerificationRunRecord,
} from "./types.js";

const MAX_ROUNDS = 4;
const boundedRounds = (value: number | undefined): number => {
	const rounds = value ?? 2;
	if (!Number.isSafeInteger(rounds) || rounds < 0 || rounds > MAX_ROUNDS) throw new RangeError("quality max rounds is outside the bound");
	return rounds;
};

/** Selects by authoritative route/resource/model identity, never display names. */
export function selectReviewerRoute(candidates: readonly ReviewerRouteCandidate[], implementationRouteId: string | undefined, preference: DiversityPreference = "prefer"): ReviewerRouteCandidate | undefined {
	const available = candidates.filter((candidate) => candidate.routeId.length > 0);
	const different = implementationRouteId === undefined ? available : available.filter((candidate) => candidate.routeId !== implementationRouteId);
	if (preference === "require") return different[0];
	return different[0] ?? (preference === "none" ? available[0] : available[0]);
}

export class QualityService {
	constructor(private readonly store: QualityPersistence, private readonly gatePolicy: Partial<QualityGatePolicy> = {}) {}

	startVerification(input: Parameters<QualityPersistence["createVerificationRun"]>[0]): VerificationRunRecord {
		const run = this.store.createVerificationRun(input);
		this.store.setTaskQualityStatus({ taskId: input.taskId as TaskQualityStatus["taskId"], missionId: input.missionId as TaskQualityStatus["missionId"], status: "verification_running", qualityRound: input.round ?? 0, latestVerificationId: run.verificationId, updatedAt: run.startedAt });
		return run;
	}

	completeVerification(verificationId: string, result: unknown, acceptanceCriteria: readonly string[] = []): { readonly run: VerificationRunRecord; readonly decision: QualityDecisionRecord; readonly status: TaskQualityStatus } {
		const run = this.store.getVerificationRun(verificationId);
		if (!run) throw new Error("verification run not found");
		if (run.status !== "running") throw new QualityError("duplicate-result", "Verification run is already terminal");
		let parsed: VerificationResultV1;
		try {
			parsed = parseVerificationResult(result);
		} catch {
			try {
				this.store.finalizeQualityFailure({ verificationId, status: "blocked", failureSummary: "invalid verification result" });
			} catch { /* preserve the typed protocol error */ }
			throw new QualityError("invalid-result", "Verification result is invalid");
		}
		const gate = evaluateQualityGate({ acceptanceCriteria, mechanicalChecks: parsed.mechanicalChecks, reviewerResult: parsed, policy: this.gatePolicy });
		const completed = this.store.finalizeQualityVerification({ verificationId, decision: { missionId: run.missionId, taskId: run.taskId, verificationId, targetRunId: run.targetRunId, ...(run.targetPacketId === undefined ? {} : { targetPacketId: run.targetPacketId }), round: run.round, gate, reviewerSummary: parsed.summary, findings: parsed.findings, requiredFixes: parsed.requiredFixes, risks: parsed.risks, ...(run.reviewerRouteId === undefined ? {} : { reviewerRouteId: run.reviewerRouteId }) } });
		try { this.store.recordCheckpoint?.(run.missionId, "gate-evaluated"); } catch { /* checkpoint failure cannot rewrite a persisted decision */ }
		return completed;
	}

	/** Record reviewer/runner interruption without manufacturing a quality verdict. */
	failVerification(verificationId: string, status: "interrupted" | "blocked", failureSummary: string): VerificationRunRecord {
		const run = this.store.getVerificationRun(verificationId);
		if (!run) throw new Error("verification run not found");
		if (run.status !== "running") return run;
		return this.store.finalizeQualityFailure({ verificationId, status: status === "interrupted" ? "review_required" : "blocked", failureSummary: failureSummary.slice(0, 400) }).run;
	}

	recordDecision(input: Parameters<QualityPersistence["recordQualityDecision"]>[0]): QualityDecisionRecord {
		const decision = this.store.recordQualityDecision(input);
		this.store.setTaskQualityStatus({ taskId: input.taskId as TaskQualityStatus["taskId"], missionId: input.missionId as TaskQualityStatus["missionId"], status: decision.verdict === "pass" ? "passed" : decision.verdict === "reject" ? "rejected" : "blocked", qualityRound: decision.round, latestVerificationId: decision.verificationId, latestDecisionId: decision.decisionId, updatedAt: decision.createdAt });
		return decision;
	}

	escalate(input: Parameters<QualityPersistence["createQualityEscalation"]>[0]): QualityEscalationRequest {
		const escalation = this.store.createQualityEscalation(input);
		try { this.store.recordCheckpoint?.(escalation.missionId, "escalation"); } catch { /* escalation remains durable even if checkpointing is unavailable */ }
		return escalation;
	}

	async runQualityLoop<T>(options: QualityLoopOptions & { readonly verify: (round: number, exclusions: readonly string[]) => Promise<{ readonly result: unknown; readonly implementationRouteId?: string; readonly verificationId: string }>; readonly repair: (round: number, feedback: VerificationResultV1, exclusions: readonly string[]) => Promise<{ readonly implementationRouteId: string }> }): Promise<{ readonly status: "passed" | "rejected" | "blocked"; readonly rounds: number; readonly lastDecision?: QualityDecisionRecord }> {
		if (!options.authorizedForMutation) throw new QualityError("loop-unauthorized", "Quality loop mutation authorization is required");
		const maxRounds = boundedRounds(options.maxRounds);
		let exclusions: string[] = [];
		let lastDecision: QualityDecisionRecord | undefined;
		for (let round = 0; round <= maxRounds; round += 1) {
			const verified = await options.verify(round, exclusions);
			const completed = this.completeVerification(verified.verificationId, verified.result, options.acceptanceCriteria ?? []);
			lastDecision = completed.decision;
			if (completed.decision.verdict === "pass") return { status: "passed", rounds: round, lastDecision };
			if (completed.decision.verdict === "blocked") return { status: "blocked", rounds: round, lastDecision };
			this.escalate({ missionId: completed.run.missionId, taskId: completed.run.taskId, rejectedRunId: completed.run.targetRunId, verificationId: completed.run.verificationId, qualityRound: round, failedCriteria: completed.decision.criterionResults.filter((item) => item.status === "failed").map((item) => item.criterion), requiredFixes: completed.decision.requiredFixes, reviewerFindings: completed.decision.findings, priorImplementationRouteIds: exclusions, ...(completed.run.reviewerRouteId === undefined ? {} : { reviewerRouteId: completed.run.reviewerRouteId }), ...(options.diversity === undefined ? {} : { diversity: options.diversity }), status: round >= maxRounds ? "exhausted" : "ready" });
			if (round >= maxRounds) {
				return { status: "rejected", rounds: round, lastDecision };
			}
			if (verified.implementationRouteId) exclusions = [...new Set([...exclusions, verified.implementationRouteId])];
			const repair = await options.repair(round + 1, { verdict: completed.decision.verdict, criterionResults: completed.decision.criterionResults, mechanicalChecks: completed.decision.mechanicalChecks, findings: completed.decision.findings, requiredFixes: completed.decision.requiredFixes, risks: completed.decision.risks, summary: completed.decision.reviewerSummary }, exclusions);
			if (repair.implementationRouteId) exclusions = [...new Set([...exclusions, repair.implementationRouteId])];
		}
		return { status: "rejected", rounds: maxRounds, ...(lastDecision === undefined ? {} : { lastDecision }) };
	}
}
