export type QualityErrorCode = "invalid-result" | "duplicate-result" | "loop-unauthorized" | "loop-limit";

export class QualityError extends Error {
	readonly code: QualityErrorCode;
	constructor(code: QualityErrorCode, message: string) {
		super(message);
		this.name = "QualityError";
		this.code = code;
	}
}
