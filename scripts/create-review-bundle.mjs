import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseDirectory, DIRECTORY_SOURCE } from "./release-candidate.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_DOCS = ["COMPATIBILITY.md", "RELEASE_CHECKLIST.md", "DOGFOOD_LOG.md", "RELEASE_REVIEW.md"];
const RELEASE_EVIDENCE_FILES = ["test-evidence.json", "pi-install-evidence.json"];
const REQUIRED_ROOT_FILES = ["artifact-files.txt", "release-manifest.json", "verification.json", "package.json", ...RELEASE_EVIDENCE_FILES, "REVIEW_PROMPT.md", "REVIEW_EVIDENCE.json"];
const RELEASE_ROOT_FILES = ["artifact-files.txt", "release-manifest.json", "verification.json"];

const fail = (message) => { throw new Error(message); };

const parseArgs = (argv) => {
	let releaseDir;
	let output = join(resolve(root, ".."), "pi-multi-orchestrator-review-bundle");
	let force = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--release-dir") releaseDir = argv[++index];
		else if (arg === "--output") output = argv[++index];
		else if (arg === "--force") force = true;
		else if (arg === "--help" || arg === "-h") return { help: true };
		else fail(`unknown argument: ${arg}`);
	}
	if (!releaseDir) fail("usage: node scripts/create-review-bundle.mjs --release-dir DIR [--output DIR] [--force]");
	if (!output) fail("--output requires a directory");
	return { releaseDir: resolve(releaseDir), output: resolve(output), force, help: false };
};

const assertEmptyOrForce = async (output, force) => {
	const entries = await readdir(output).catch((error) => {
		if (error?.code === "ENOENT") return [];
		throw error;
	});
	if (entries.length > 0 && !force) fail(`review bundle output is not empty: ${output}; use --force to overwrite it`);
	if (entries.length > 0) await rm(output, { recursive: true, force: true });
	await mkdir(output, { recursive: true });
};

export async function createReviewBundle({ releaseDir, output, force = false }) {
	const source = resolve(releaseDir);
	const target = resolve(output);
	await assertEmptyOrForce(target, force);
	await verifyReleaseDirectory(source);
	const manifest = JSON.parse(await readFile(join(source, "release-manifest.json"), "utf8"));
	const artifact = manifest.artifact?.file;
	if (typeof artifact !== "string") fail("release manifest has no artifact");
	for (const name of [...RELEASE_ROOT_FILES, ...RELEASE_EVIDENCE_FILES, artifact, `${artifact}.sha256`]) {
		await cp(join(source, name), join(target, name));
	}
	await cp(join(source, DIRECTORY_SOURCE), join(target, DIRECTORY_SOURCE), { recursive: true });
	await cp(join(source, DIRECTORY_SOURCE, "package.json"), join(target, "package.json"));
	for (const name of REVIEW_DOCS) await cp(join(root, "docs", name), join(target, name));
	await writeFile(join(target, "REVIEW_PROMPT.md"), `# Independent M11 review

Status: EXTERNAL_REVIEW_PENDING

Inspect ${artifact} for ${manifest.package?.name ?? "unknown"}@${manifest.package?.version ?? "unknown"}. Verify the copied SHA-256 sidecar, extracted directory source, allowlist, source independence, isolated Pi install/upgrade/rollback, rescue path, compatibility claims, and privacy boundary. The supported Pi 0.84.1 install input is the copied \`${DIRECTORY_SOURCE}/\` directory, not the \`.tgz\` path. Do not treat this bundle as Planner acceptance or a public release. Record reviewer identity, separate context/process, result, and blocker/high findings in a separate handoff.
`, "utf8");
	const verification = JSON.parse(await readFile(join(source, "verification.json"), "utf8"));
	await writeFile(join(target, "REVIEW_EVIDENCE.json"), `${JSON.stringify({
		schemaVersion: 1,
		status: "EXTERNAL_REVIEW_PENDING",
		artifact,
		sha256: manifest.artifact.sha256,
		verification,
		reviewer: null,
		result: null,
		findings: [],
	}, null, 2)}\n`, "utf8");
	await verifyReviewBundle(target);
	return { output: target, status: "EXTERNAL_REVIEW_PENDING", artifact };
}

export async function verifyReviewBundle(bundleDir) {
	const bundle = resolve(bundleDir);
	const manifest = JSON.parse(await readFile(join(bundle, "release-manifest.json"), "utf8"));
	const artifact = manifest.artifact?.file;
	if (typeof artifact !== "string") fail("bundle manifest has no artifact");
	await verifyReleaseDirectory(bundle);
	const expected = new Set([...REQUIRED_ROOT_FILES, ...REVIEW_DOCS, artifact, `${artifact}.sha256`, DIRECTORY_SOURCE]);
	const actual = await readdir(bundle);
	for (const name of actual) if (!expected.has(name)) fail(`unexpected review bundle entry: ${name}`);
	for (const name of [...REQUIRED_ROOT_FILES, ...REVIEW_DOCS, artifact, `${artifact}.sha256`, DIRECTORY_SOURCE]) {
		if (!actual.includes(name)) fail(`review bundle is missing ${name}`);
	}
	const testEvidence = JSON.parse(await readFile(join(bundle, "test-evidence.json"), "utf8"));
	const piEvidence = JSON.parse(await readFile(join(bundle, "pi-install-evidence.json"), "utf8"));
	if (testEvidence.status !== "PASS" || piEvidence.status !== "PASS") fail("review bundle evidence is not a passing generated result");
	const evidence = JSON.parse(await readFile(join(bundle, "REVIEW_EVIDENCE.json"), "utf8"));
	if (evidence.status !== "EXTERNAL_REVIEW_PENDING" || evidence.artifact !== artifact || evidence.sha256 !== manifest.artifact.sha256) fail("review evidence is not pending for the copied artifact");
	if (JSON.stringify(evidence.verification) !== JSON.stringify(JSON.parse(await readFile(join(bundle, "verification.json"), "utf8")))) fail("review evidence verification differs from verification.json");
	return { verified: true, artifact, sha256: manifest.artifact.sha256, status: evidence.status };
}

const main = async () => {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log("Usage: node scripts/create-review-bundle.mjs --release-dir DIR [--output DIR] [--force]");
		return;
	}
	console.log(JSON.stringify(await createReviewBundle(options), null, 2));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
