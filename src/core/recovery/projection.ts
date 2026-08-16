import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ChangedFileProjection, WorktreeProjection } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_FILES = 32;
const MAX_STAT = 2_000;
const SECRET = /(?:sk-[a-z0-9_-]{8,}|bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+)/giu;

const redact = (value: string): string => value.replace(SECRET, "[redacted]");

export async function projectChangedWorktree(cwd: string): Promise<WorktreeProjection> {
	let status = "";
	let diffStat = "";
	try {
		const result = await execFileAsync("git", ["status", "--porcelain", "-uall"], { cwd, timeout: 5_000, maxBuffer: 64_000 });
		status = result.stdout;
	} catch {
		return { changedFileCount: 0, files: [] };
	}
	try {
		const result = await execFileAsync("git", ["diff", "--stat"], { cwd, timeout: 5_000, maxBuffer: 32_000 });
		diffStat = redact(result.stdout).trim().slice(0, MAX_STAT);
	} catch {
		diffStat = "";
	}
	const files: ChangedFileProjection[] = [];
	for (const line of status.split("\n")) {
		if (!line.trim() || files.length >= MAX_FILES) continue;
		const statusCode = line.slice(0, 2).trim() || "?";
		const rawPath = line.slice(3).trim().split(" -> ").pop() ?? "";
		const path = redact(rawPath).slice(0, 240);
		if (!path) continue;
		files.push({ path, status: porcelainStatus(statusCode) });
	}
	return {
		changedFileCount: files.length,
		files,
		...(diffStat.length > 0 ? { diffStat } : {}),
	};
}

function porcelainStatus(code: string): string {
	if (code.includes("?")) return "untracked";
	if (code.includes("D")) return "deleted";
	if (code.includes("A")) return "added";
	if (code.includes("M") || code.includes(" ")) return "modified";
	return "changed";
}
