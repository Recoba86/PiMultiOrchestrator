import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseDirectory, DIRECTORY_SOURCE } from "./release-candidate.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_DOCS = ["COMPATIBILITY.md", "RELEASE_CHECKLIST.md", "DOGFOOD_LOG.md", "RELEASE_REVIEW.md"];
const RELEASE_EVIDENCE_FILES = ["test-evidence.json", "pi-install-evidence.json", "worker-safety-evidence.json"];
const M10_BASELINE_ENTRIES = ["m10-baseline", "m10-baseline.tgz", "m10-baseline.tgz.sha256"];
const REQUIRED_ROOT_FILES = ["artifact-files.txt", "release-manifest.json", "verification.json", "package.json", "privacy-report.json", ...RELEASE_EVIDENCE_FILES, "REVIEW_PROMPT.md", "REVIEW_EVIDENCE.json"];
const RELEASE_ROOT_FILES = ["artifact-files.txt", "release-manifest.json", "verification.json"];

const fail = (message) => { throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
};
const equalJson = (left, right) => canonical(left) === canonical(right);
const assertMachineNeutral = (value, name) => {
	if (/(?:\/Users|\/private|\/home|\/tmp|\/var\/folders)\/|[A-Z]:[\\/]Users[\\/]/u.test(JSON.stringify(value))) fail(`${name} contains an absolute machine path`);
};

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
	const outputStat = await lstat(output).catch((error) => {
		if (error?.code === "ENOENT") return null;
		throw error;
	});
	if (outputStat?.isSymbolicLink()) fail("review bundle output must not be a symlink");
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
	const sourceStat = await lstat(source);
	if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) fail("release directory must be a real directory");
	await assertEmptyOrForce(target, force);
	await verifyReleaseDirectory(source);
	const manifest = JSON.parse(await readFile(join(source, "release-manifest.json"), "utf8"));
	const artifact = manifest.artifact?.file;
	if (typeof artifact !== "string") fail("release manifest has no artifact");
	for (const name of [...RELEASE_ROOT_FILES, "privacy-report.json", ...RELEASE_EVIDENCE_FILES, ...M10_BASELINE_ENTRIES, artifact, `${artifact}.sha256`]) {
		await cp(join(source, name), join(target, name), { recursive: true });
	}
	await cp(join(source, DIRECTORY_SOURCE), join(target, DIRECTORY_SOURCE), { recursive: true });
	await cp(join(source, DIRECTORY_SOURCE, "package.json"), join(target, "package.json"));
	for (const name of REVIEW_DOCS) await cp(join(root, "docs", name), join(target, name));
	await writeFile(join(target, "REVIEW_PROMPT.md"), `# Independent M11 review

Status: EXTERNAL_REVIEW_PENDING

Inspect ${artifact} for ${manifest.package?.name ?? "unknown"}@${manifest.package?.version ?? "unknown"}. Verify the copied SHA-256 sidecar, extracted directory source, allowlist, source independence, isolated Pi install/upgrade/rollback, rescue path, compatibility claims, and privacy boundary. The supported Pi 0.84.1 install input is the copied \`${DIRECTORY_SOURCE}/\` directory, not the \`.tgz\` path. Do not treat this bundle as Planner acceptance or a public release. Record reviewer identity, separate context/process, result, and blocker/high findings in a separate handoff.
`, "utf8");
	const verification = JSON.parse(await readFile(join(source, "verification.json"), "utf8"));
	const manifestBytes = await readFile(join(target, "release-manifest.json"));
	const verificationBytes = await readFile(join(target, "verification.json"));
	const testEvidenceBytes = await readFile(join(target, "test-evidence.json"));
	const piEvidenceBytes = await readFile(join(target, "pi-install-evidence.json"));
	const safetyEvidenceBytes = await readFile(join(target, "worker-safety-evidence.json"));
	await writeFile(join(target, "REVIEW_EVIDENCE.json"), `${JSON.stringify({
		schemaVersion: 2,
		status: "EXTERNAL_REVIEW_PENDING",
		artifact,
		sha256: manifest.artifact.sha256,
		release: {
			gitCommit: manifest.gitCommit,
			gitTree: manifest.gitTree,
			sourceDigest: manifest.sourceDigest,
			buildDigest: manifest.buildDigest,
			artifact: manifest.artifact,
			piIdentity: manifest.piIdentity,
		},
		evidence: manifest.evidence,
		digests: {
			manifest: sha256(manifestBytes),
			verification: sha256(verificationBytes),
			testEvidence: sha256(testEvidenceBytes),
			piEvidence: sha256(piEvidenceBytes),
			safetyEvidence: sha256(safetyEvidenceBytes),
		},
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
	const expected = new Set([...REQUIRED_ROOT_FILES, ...M10_BASELINE_ENTRIES, ...REVIEW_DOCS, artifact, `${artifact}.sha256`, DIRECTORY_SOURCE]);
	const actual = await readdir(bundle);
	for (const name of actual) if (!expected.has(name)) fail(`unexpected review bundle entry: ${name}`);
	for (const name of [...REQUIRED_ROOT_FILES, ...M10_BASELINE_ENTRIES, ...REVIEW_DOCS, artifact, `${artifact}.sha256`, DIRECTORY_SOURCE]) {
		if (!actual.includes(name)) fail(`review bundle is missing ${name}`);
		if ((await lstat(join(bundle, name))).isSymbolicLink()) fail(`review bundle entry must not be a symlink: ${name}`);
	}
	const testEvidence = JSON.parse(await readFile(join(bundle, "test-evidence.json"), "utf8"));
	const piEvidence = JSON.parse(await readFile(join(bundle, "pi-install-evidence.json"), "utf8"));
	const safetyEvidence = JSON.parse(await readFile(join(bundle, "worker-safety-evidence.json"), "utf8"));
	const privacyReport = JSON.parse(await readFile(join(bundle, "privacy-report.json"), "utf8"));
	if (privacyReport.schemaVersion !== 1 || privacyReport.artifact?.clean !== true || privacyReport.directorySource?.clean !== true || !Array.isArray(privacyReport.artifact?.rules) || !Array.isArray(privacyReport.directorySource?.rules)) fail("review bundle privacy report is incomplete");
	const releaseBinding = {
		gitCommit: manifest.gitCommit,
		gitTree: manifest.gitTree,
		sourceDigest: manifest.sourceDigest,
		buildDigest: manifest.buildDigest,
		artifact: manifest.artifact,
		piIdentity: manifest.piIdentity,
	};
	if (testEvidence.schemaVersion !== 2 || testEvidence.status !== "PASS" || !equalJson(testEvidence.release, releaseBinding)) fail("test evidence is not bound to the copied release");
	if (testEvidence.commands?.check !== "npm run check" || testEvidence.commands?.packDryRun !== "npm pack --dry-run --ignore-scripts --json") fail("test evidence commands are not strict release commands");
	const tests = testEvidence.check?.tests;
	if (testEvidence.check?.code !== 0 || testEvidence.check?.signal !== null || !tests || tests.failed !== 0 || tests.cancelled !== 0 || tests.total !== tests.passed + tests.failed + tests.cancelled + tests.skipped + tests.todo) fail("test evidence TAP totals are not a passing complete summary");
	for (const digest of [testEvidence.check?.stdoutSha256, testEvidence.check?.stderrSha256, testEvidence.pack?.stdoutSha256, testEvidence.pack?.stderrSha256]) if (!/^[0-9a-f]{64}$/u.test(digest ?? "")) fail("test evidence is missing output digests");
	if (testEvidence.pack?.code !== 0 || testEvidence.pack?.signal !== null || !testEvidence.pack?.evidence?.filename || !Number.isSafeInteger(testEvidence.pack.evidence.fileCount)) fail("pack evidence is incomplete");
	if (piEvidence.schemaVersion !== 2 || piEvidence.status !== "PASS" || piEvidence.artifact !== artifact || piEvidence.sha256 !== manifest.artifact.sha256 || !equalJson(piEvidence.piIdentity, manifest.piIdentity)) fail("Pi evidence is not bound to the copied release and Pi identity");
	const baseline = piEvidence.m10Baseline;
	if (!baseline || baseline.commit !== "c65470c001e539c36f0a53cacd912f48eb05ff7f" || baseline.artifact !== "m10-baseline.tgz" || !/^[0-9a-f]{64}$/u.test(baseline.sha256)) fail("real M10 baseline evidence is missing or unbound");
	if (sha256(await readFile(join(bundle, "m10-baseline.tgz"))) !== baseline.sha256) fail("M10 baseline artifact checksum mismatch");
	const baselineSidecar = (await readFile(join(bundle, "m10-baseline.tgz.sha256"), "utf8")).trim();
	if (baselineSidecar !== `${baseline.sha256}  m10-baseline.tgz`) fail("M10 baseline checksum sidecar mismatch");
	if (!baseline.directorySource || !piEvidence.upgradeRollback?.before || !piEvidence.upgradeRollback?.candidate || !piEvidence.upgradeRollback?.rollback) fail("compatibility state evidence is missing");
	if (piEvidence.upgradeRollback.semanticStatePreserved !== true || piEvidence.seed?.config !== true || piEvidence.seed?.mission !== true || piEvidence.seed?.analytics !== true || piEvidence.seed?.trust !== true) fail("non-empty compatibility state evidence is incomplete");
	if (piEvidence.rescue?.brokenCandidateSimulated !== true || piEvidence.rescue?.extensionIndependentRecovery !== true || piEvidence.rescue?.realM10Restore !== true || piEvidence.rescue?.seededStateRecovered !== true) fail("rescue evidence is incomplete");
	if (safetyEvidence.schemaVersion !== 1 || safetyEvidence.status !== "PASS" || safetyEvidence.actualPi !== "0.84.1" || safetyEvidence.liveCalls !== 0 || safetyEvidence.paidInference !== 0) fail("worker safety evidence is incomplete");
	if (safetyEvidence.customToolBoundary?.tool !== "submit_evil" || safetyEvidence.customToolBoundary?.projectTrust !== "UNTRUSTED" || safetyEvidence.customToolBoundary?.regressionAttempted !== true || safetyEvidence.customToolBoundary?.advertisedToChild !== false || safetyEvidence.customToolBoundary?.handlerExecuted !== false || safetyEvidence.customToolBoundary?.filesystemMutation !== false) fail("custom-tool bypass evidence is incomplete");
	if (safetyEvidence.protocolBoundary?.callerExecuteCallback !== false || safetyEvidence.protocolBoundary?.ambientInheritance !== false || safetyEvidence.effectiveTools?.unknown !== "FAIL_CLOSED") fail("protocol boundary evidence is incomplete");
	assertMachineNeutral(testEvidence, "test evidence");
	assertMachineNeutral(piEvidence, "Pi evidence");
	assertMachineNeutral(safetyEvidence, "worker safety evidence");
	const evidence = JSON.parse(await readFile(join(bundle, "REVIEW_EVIDENCE.json"), "utf8"));
	const verification = JSON.parse(await readFile(join(bundle, "verification.json"), "utf8"));
	if (evidence.schemaVersion !== 2 || evidence.status !== "EXTERNAL_REVIEW_PENDING" || evidence.artifact !== artifact || evidence.sha256 !== manifest.artifact.sha256 || !equalJson(evidence.release, releaseBinding) || !equalJson(evidence.evidence, manifest.evidence) || !equalJson(evidence.verification, verification)) fail("review evidence is not pending for the copied artifact");
	const digests = {
		manifest: sha256(await readFile(join(bundle, "release-manifest.json"))),
		verification: sha256(await readFile(join(bundle, "verification.json"))),
		 testEvidence: sha256(await readFile(join(bundle, "test-evidence.json"))),
		piEvidence: sha256(await readFile(join(bundle, "pi-install-evidence.json"))),
		safetyEvidence: sha256(await readFile(join(bundle, "worker-safety-evidence.json"))),
	};
	if (!equalJson(evidence.digests, digests) || !equalJson(manifest.evidence?.test, { file: "test-evidence.json", sha256: digests.testEvidence }) || !equalJson(manifest.evidence?.pi, { file: "pi-install-evidence.json", sha256: digests.piEvidence }) || !equalJson(manifest.evidence?.safety, { file: "worker-safety-evidence.json", sha256: digests.safetyEvidence })) fail("review evidence digests do not match copied evidence");
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
