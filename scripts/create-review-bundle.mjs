import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const releaseIndex = args.indexOf("--release-dir");
if (releaseIndex < 0 || !args[releaseIndex + 1]) {
	throw new Error("usage: node scripts/create-review-bundle.mjs --release-dir DIR [--output DIR]");
}
const releaseDir = resolve(args[releaseIndex + 1]);
const outputIndex = args.indexOf("--output");
const output = resolve(outputIndex >= 0 && args[outputIndex + 1]
	? args[outputIndex + 1]
	: join(resolve(root, ".."), "pi-multi-orchestrator-review-bundle"));

await mkdir(output, { recursive: true });
for (const name of ["release-manifest.json", "verification.json", "artifact-files.txt"]) {
	await cp(join(releaseDir, name), join(output, name));
}
for (const name of ["COMPATIBILITY.md", "RELEASE_CHECKLIST.md", "DOGFOOD_LOG.md", "RELEASE_REVIEW.md"]) {
	await cp(join(root, "docs", name), join(output, name));
}
const manifest = JSON.parse(await readFile(join(releaseDir, "release-manifest.json"), "utf8"));
await writeFile(join(output, "REVIEW_PROMPT.md"), `# Independent M11 review\n\nStatus: EXTERNAL_REVIEW_PENDING\n\nInspect the candidate named ${manifest.package?.name ?? "unknown"}@${manifest.package?.version ?? "unknown"}. Verify the artifact checksum, allowlist, unpacked source independence, isolated Pi install/upgrade/rollback, rescue path, compatibility claims, privacy boundary, and documentation. Do not treat this bundle as a Planner acceptance or public release. Record reviewer identity, separate context/process, result, and blocker/high findings in a separate handoff.\n`, "utf8");
console.log(JSON.stringify({ output, status: "EXTERNAL_REVIEW_PENDING", artifact: manifest.artifact?.file ?? null }, null, 2));
