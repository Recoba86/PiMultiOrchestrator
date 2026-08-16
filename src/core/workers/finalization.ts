import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type { ProtocolCaptureState, ResultProtocolSpec, WorkerFinalizationReport } from "./types.js";

export function resultFinalizationPrompt(toolName: string): string {
	return `The work phase is complete. Do not perform additional investigation or modification. Submit the result of the work already performed by calling ${toolName} exactly once.`;
}

export function shouldRunResultFinalization(input: {
	readonly captured: boolean;
	readonly cancelled: boolean;
	readonly safetyTerminated: boolean;
	readonly providerSucceeded: boolean;
	readonly protocolViolation?: boolean;
}): boolean {
	return input.providerSucceeded && !input.captured && !input.cancelled && !input.safetyTerminated && input.protocolViolation !== true;
}

export function restrictSessionToResultTool(session: AgentSession, toolName: string): readonly string[] {
	session.setActiveToolsByName([toolName]);
	return session.getActiveToolNames();
}

export function installOneTurnStop(session: AgentSession): () => void {
	const previous = session.agent.shouldStopAfterTurn;
	session.agent.shouldStopAfterTurn = () => true;
	return () => {
		session.agent.shouldStopAfterTurn = previous ?? (() => false);
	};
}

export function notRequiredFinalization(): WorkerFinalizationReport {
	return { required: false, attempted: false, succeeded: false, outcome: "not_required" };
}

export function skippedSafetyFinalization(): WorkerFinalizationReport {
	return { required: false, attempted: false, succeeded: false, outcome: "safety_stop" };
}

export function reportFromCapture(state: ProtocolCaptureState, toolsExposed: readonly string[], parsed?: unknown, stopReason?: string): WorkerFinalizationReport {
	if (parsed !== undefined) {
		return { required: true, attempted: true, succeeded: true, outcome: "succeeded", toolsExposed, ...(stopReason === undefined ? {} : { stopReason }) };
	}
	if (state.protocolViolation) {
		return { required: true, attempted: true, succeeded: false, outcome: "protocol_violation", toolsExposed, ...(stopReason === undefined ? {} : { stopReason }) };
	}
	return { required: true, attempted: true, succeeded: false, outcome: "missing", toolsExposed, ...(stopReason === undefined ? {} : { stopReason }) };
}

export function resultToolName(protocol: ResultProtocolSpec): string {
	return protocol.toolName;
}
