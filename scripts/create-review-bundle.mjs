import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DIRECTORY_SOURCE,
	inspectTree,
	releaseBindingFor,
	scanPrivacy,
	validateTestEvidence,
	verifyReleaseDirectory,
} from "./release-candidate.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_DOCS = ["COMPATIBILITY.md", "RELEASE_CHECKLIST.md", "DOGFOOD_LOG.md", "RELEASE_REVIEW.md"];
const RELEASE_EVIDENCE_FILES = ["test-evidence.json", "pi-install-evidence.json", "worker-safety-evidence.json", "release-integrity-evidence.json"];
const M10_BASELINE_ENTRIES = ["m10-baseline", "m10-baseline.tgz", "m10-baseline.tgz.sha256"];
export const BUNDLE_MANIFEST = "review-bundle-files.json";
const BUNDLE_OUTPUT_MARKERS = [BUNDLE_MANIFEST, "REVIEW_EVIDENCE.json", "release-manifest.json"];
const REQUIRED_ROOT_FILES = ["artifact-files.txt", "release-manifest.json", "verification.json", "package.json", "privacy-report.json", ...RELEASE_EVIDENCE_FILES, "REVIEW_PROMPT.md", "REVIEW_EVIDENCE.json", BUNDLE_MANIFEST];
const RELEASE_ROOT_FILES = ["artifact-files.txt", "release-manifest.json", "verification.json"];

const fail = (message) => { throw new Error(message); };
const pathCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sha256File = async (path) => {
	const details = await lstat(path);
	if (details.isSymbolicLink() || !details.isFile()) fail(`bundle entry must be a regular file: ${basename(path)}`);
	return sha256(await readFile(path));
};
const canonical = (value) => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
};
const equalJson = (left, right) => canonical(left) === canonical(right);
const isPathInside = (parent, candidate) => {
	const child = relative(parent, candidate);
	return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
};
const assertMachineNeutral = (value, name) => {
	if (/(?:\/(?:Users|private|home|var\/folders)\/|[A-Z]:[\\/]+Users[\\/]+)/u.test(JSON.stringify(value))) fail(`${name} contains an absolute private machine path`);
};

const parseArgs = (argv) => {
	let releaseDir;
	let output = join(resolve(root, ".."), "pi-multi-orchestrator-review-bundle");
	let verify;
	let expectedRootSha256;
	let force = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--release-dir") releaseDir = argv[++index];
		else if (arg === "--output") output = argv[++index];
		else if (arg === "--verify") verify = argv[++index];
		else if (arg === "--expected-root-sha256") expectedRootSha256 = argv[++index];
		else if (arg === "--force") force = true;
		else if (arg === "--help" || arg === "-h") return { help: true };
		else fail(`unknown argument: ${arg}`);
	}
	if (verify) {
		if (!expectedRootSha256) fail("--verify requires --expected-root-sha256");
		return { mode: "verify", verify: resolve(verify), expectedRootSha256, help: false };
	}
	if (!releaseDir) fail("usage: node scripts/create-review-bundle.mjs --release-dir DIR [--output DIR] [--force]");
	if (!output) fail("--output requires a directory");
	return { mode: "create", releaseDir: resolve(releaseDir), output: resolve(output), force, help: false };
};

const assertEmptyOrForce = async (output, force) => {
	const outputStat = await lstat(output).catch((error) => {
		if (error?.code === "ENOENT") return null;
		throw error;
	});
	if (outputStat?.isSymbolicLink() || (outputStat && !outputStat.isDirectory())) fail("review bundle output must be a real directory");
	const entries = await readdir(output).catch((error) => {
		if (error?.code === "ENOENT") return [];
		throw error;
	});
	if (entries.length > 0 && !force) fail(`review bundle output is not empty: ${output}; use --force to overwrite it`);
	if (entries.length > 0) {
		for (const marker of BUNDLE_OUTPUT_MARKERS) {
			const details = await lstat(join(output, marker)).catch(() => undefined);
			if (!details || details.isSymbolicLink() || !details.isFile()) fail("refusing --force on a directory that is not a review-bundle output");
		}
		await rm(output, { recursive: true, force: true });
	}
	await mkdir(output, { recursive: true });
};

const assertBundlePrivacy = async (bundle, artifact) => {
	const binaryFiles = new Set([artifact, "m10-baseline.tgz"]);
	const report = await scanPrivacy(bundle);
	const issues = report.issues.filter((issue) => !(issue.kind === "nul-byte" && binaryFiles.has(issue.path)));
	if (issues.length > 0) fail(`review bundle privacy scan failed: ${issues.map((issue) => `${issue.path}: ${issue.kind}`).join(", ")}`);
};

const bundleRecords = async (bundle, excluded = new Set()) => {
	const rootDetails = await lstat(bundle);
	if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) fail("review bundle must be a real directory");
	const tree = await inspectTree(bundle);
	if (tree.symlinks.length > 0) fail(`review bundle contains symlinks: ${tree.symlinks.join(", ")}`);
	if (tree.special.length > 0) fail(`review bundle contains non-regular entries: ${tree.special.join(", ")}`);
	const records = [];
	for (const path of tree.files.filter((path) => !excluded.has(path)).sort(pathCompare)) {
		const fullPath = join(bundle, path);
		const details = await lstat(fullPath);
		if (details.isSymbolicLink() || !details.isFile()) fail(`review bundle entry is not a regular file: ${path}`);
		records.push({ path, size: details.size, sha256: await sha256File(fullPath) });
	}
	return records;
};

export async function writeBundleIntegrityManifest(bundleDir) {
	const bundle = resolve(bundleDir);
	const manifest = {
		schemaVersion: 1,
		algorithm: "sha256",
		rootDefinition: `sha256(exact UTF-8 bytes of ${BUNDLE_MANIFEST})`,
		excluded: [BUNDLE_MANIFEST],
		files: await bundleRecords(bundle, new Set([BUNDLE_MANIFEST])),
	};
	const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	await writeFile(join(bundle, BUNDLE_MANIFEST), bytes);
	return { manifest, rootSha256: sha256(bytes) };
}

export async function verifyBundleIntegrity(bundleDir, expectedRootSha256) {
	if (!/^[0-9a-f]{64}$/u.test(expectedRootSha256 ?? "")) fail("an explicit expected review-bundle root SHA-256 is required");
	const bundle = resolve(bundleDir);
	const bundleDetails = await lstat(bundle);
	if (bundleDetails.isSymbolicLink() || !bundleDetails.isDirectory()) fail("review bundle must be a real directory");
	const manifestPath = join(bundle, BUNDLE_MANIFEST);
	const details = await lstat(manifestPath);
	if (details.isSymbolicLink() || !details.isFile()) fail("review bundle integrity manifest must be a regular file");
	const bytes = await readFile(manifestPath);
	if (sha256(bytes) !== expectedRootSha256) fail("review bundle external root SHA-256 mismatch");
	const manifest = JSON.parse(bytes.toString("utf8"));
	if (manifest.schemaVersion !== 1 || manifest.algorithm !== "sha256" || manifest.rootDefinition !== `sha256(exact UTF-8 bytes of ${BUNDLE_MANIFEST})` || !equalJson(manifest.excluded, [BUNDLE_MANIFEST]) || !Array.isArray(manifest.files)) fail("review bundle integrity manifest is invalid");
	const actual = await bundleRecords(bundle, new Set([BUNDLE_MANIFEST]));
	if (!equalJson(actual, manifest.files)) fail("review bundle recursive file manifest mismatch");
	return { verified: true, rootSha256: expectedRootSha256, fileCount: actual.length };
}

export async function createReviewBundle({ releaseDir, output, force = false }) {
	const source = resolve(releaseDir);
	const target = resolve(output);
	if (isPathInside(root, target)) fail("review bundle output must be outside the source checkout");
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

Inspect ${artifact} for ${manifest.package?.name ?? "unknown"}@${manifest.package?.version ?? "unknown"}. Verify the copied SHA-256 sidecar, extracted directory source, recursive bundle manifest, separately supplied bundle-root SHA-256, exact Git source, independent test execution, isolated Pi install/upgrade/rollback, rescue path, authentic M10 baseline, compatibility claims, and privacy boundary. The supported Pi 0.84.1 install input is the copied \`${DIRECTORY_SOURCE}/\` directory, not the \`.tgz\` path. Treat bundled claims as audit material; the separately supplied root digest is the bundle trust anchor. Do not treat this bundle as Planner acceptance or a public release. Record reviewer identity, separate context/process, result, and blocker/high findings in a separate handoff.
`, "utf8");
	const verification = JSON.parse(await readFile(join(source, "verification.json"), "utf8"));
	const digestNames = {
		manifest: "release-manifest.json",
		verification: "verification.json",
		testEvidence: "test-evidence.json",
		piEvidence: "pi-install-evidence.json",
		safetyEvidence: "worker-safety-evidence.json",
		integrityEvidence: "release-integrity-evidence.json",
	};
	const digests = Object.fromEntries(await Promise.all(Object.entries(digestNames).map(async ([key, name]) => [key, await sha256File(join(target, name))])));
	await writeFile(join(target, "REVIEW_EVIDENCE.json"), `${JSON.stringify({
		schemaVersion: 3,
		status: "EXTERNAL_REVIEW_PENDING",
		artifact,
		sha256: manifest.artifact.sha256,
		release: releaseBindingFor(manifest),
		evidence: manifest.evidence,
		digests,
		bundleIntegrity: {
			manifest: BUNDLE_MANIFEST,
			algorithm: "sha256",
			trustRoot: "must be supplied separately; internal bundle data is not authentication",
		},
		verification,
		reviewer: null,
		result: null,
		findings: [],
	}, null, 2)}\n`, "utf8");
	await assertBundlePrivacy(target, artifact);
	const { rootSha256 } = await writeBundleIntegrityManifest(target);
	const rootFile = resolve(`${target}.root.sha256`);
	await writeFile(rootFile, `${rootSha256}  ${basename(target)}/${BUNDLE_MANIFEST}\n`, "utf8");
	await verifyReviewBundle(target, rootSha256);
	return { output: target, status: "EXTERNAL_REVIEW_PENDING", artifact, rootSha256, rootFile };
}

export async function verifyReviewBundle(bundleDir, expectedRootSha256) {
	const bundle = resolve(bundleDir);
	const recursive = await verifyBundleIntegrity(bundle, expectedRootSha256);
	const manifest = JSON.parse(await readFile(join(bundle, "release-manifest.json"), "utf8"));
	const artifact = manifest.artifact?.file;
	if (typeof artifact !== "string") fail("bundle manifest has no artifact");
	await verifyReleaseDirectory(bundle);
	await assertBundlePrivacy(bundle, artifact);
	const expected = new Set([...REQUIRED_ROOT_FILES, ...M10_BASELINE_ENTRIES, ...REVIEW_DOCS, artifact, `${artifact}.sha256`, DIRECTORY_SOURCE]);
	const actual = await readdir(bundle);
	for (const name of actual) if (!expected.has(name)) fail(`unexpected review bundle entry: ${name}`);
	for (const name of expected) if (!actual.includes(name)) fail(`review bundle is missing ${name}`);
	if (!(await readFile(join(bundle, "package.json"))).equals(await readFile(join(bundle, DIRECTORY_SOURCE, "package.json")))) fail("bundle root package.json differs from the artifact-derived package metadata");
	const testEvidence = JSON.parse(await readFile(join(bundle, "test-evidence.json"), "utf8"));
	const piEvidence = JSON.parse(await readFile(join(bundle, "pi-install-evidence.json"), "utf8"));
	const safetyEvidence = JSON.parse(await readFile(join(bundle, "worker-safety-evidence.json"), "utf8"));
	const integrityEvidence = JSON.parse(await readFile(join(bundle, "release-integrity-evidence.json"), "utf8"));
	const privacyReport = JSON.parse(await readFile(join(bundle, "privacy-report.json"), "utf8"));
	if (privacyReport.schemaVersion !== 1 || privacyReport.artifact?.clean !== true || privacyReport.directorySource?.clean !== true || !Array.isArray(privacyReport.artifact?.rules) || !Array.isArray(privacyReport.directorySource?.rules)) fail("review bundle privacy report is incomplete");
	validateTestEvidence(testEvidence, manifest);
	if (piEvidence.schemaVersion !== 3 || piEvidence.status !== "PASS" || piEvidence.artifact !== artifact || piEvidence.sha256 !== manifest.artifact.sha256 || !equalJson(piEvidence.piIdentity, manifest.piIdentity)) fail("Pi evidence is not bound to the copied release and Pi identity");
	const baseline = piEvidence.m10Baseline;
	if (!baseline || baseline.commit !== "c65470c001e539c36f0a53cacd912f48eb05ff7f" || baseline.artifact !== "m10-baseline.tgz" || !/^[0-9a-f]{64}$/u.test(baseline.sha256)) fail("real M10 baseline evidence is missing or unbound");
	if (await sha256File(join(bundle, "m10-baseline.tgz")) !== baseline.sha256) fail("M10 baseline artifact checksum mismatch");
	const baselineSidecar = (await readFile(join(bundle, "m10-baseline.tgz.sha256"), "utf8")).trim();
	if (baselineSidecar !== `${baseline.sha256}  m10-baseline.tgz`) fail("M10 baseline checksum sidecar mismatch");
	const compatibility = piEvidence.upgradeRollback;
	if (!baseline.directorySource || !compatibility?.before || !compatibility?.baseline || !compatibility?.candidate || !compatibility?.rollback || compatibility.semanticStatePreserved !== true || compatibility.configMissionAnalyticsTrustPreserved !== true || compatibility.dataLoss !== false) fail("compatibility state evidence is missing or reports loss");
	for (const [stage, expectedRole] of [[compatibility.before, "m10"], [compatibility.baseline, "m10"], [compatibility.candidate, "candidate"], [compatibility.rollback, "m10"]]) {
		if (stage.source?.role !== expectedRole || !stage.nonEmpty || !Object.values(stage.nonEmpty).every(Boolean) || !stage.hashes || !stage.counts) fail("compatibility snapshot provenance or non-empty state is invalid");
	}
	if (!piEvidence.seed || !Object.values(piEvidence.seed).every((value) => value === true || typeof value === "string")) fail("compatibility seed evidence is incomplete");
	if (piEvidence.rescue?.brokenCandidateSimulated !== true || piEvidence.rescue?.extensionIndependentRecovery !== true || piEvidence.rescue?.realM10Restore !== true || piEvidence.rescue?.seededStateRecovered !== true || piEvidence.rescue?.finalListEmpty !== true) fail("rescue evidence is incomplete");
	for (const [item, expectedPackage] of [[piEvidence.packageLists?.baseline, baseline.package], [piEvidence.packageLists?.candidate, manifest.package], [piEvidence.packageLists?.rollback, baseline.package]]) {
		if (!item?.asserted || item.configuredSourceMatches !== true || item.installedPathMatches !== true || item.package?.name !== expectedPackage?.name || item.package?.version !== expectedPackage?.version || !equalJson(item.package?.pi?.extensions, expectedPackage?.pi?.extensions)) fail("Pi list package identity evidence is incomplete");
	}
	if (piEvidence.packageLists?.final?.empty !== true) fail("final Pi list is not empty");
	if (safetyEvidence.schemaVersion !== 1 || safetyEvidence.status !== "PASS" || safetyEvidence.actualPi !== "0.84.1" || safetyEvidence.liveCalls !== 0 || safetyEvidence.paidInference !== 0) fail("worker safety evidence is incomplete");
	if (safetyEvidence.customToolBoundary?.tool !== "submit_evil" || safetyEvidence.customToolBoundary?.projectTrust !== "UNTRUSTED" || safetyEvidence.customToolBoundary?.regressionAttempted !== true || safetyEvidence.customToolBoundary?.advertisedToChild !== false || safetyEvidence.customToolBoundary?.handlerExecuted !== false || safetyEvidence.customToolBoundary?.filesystemMutation !== false) fail("custom-tool bypass evidence is incomplete");
	if (safetyEvidence.protocolBoundary?.callerExecuteCallback !== false || safetyEvidence.protocolBoundary?.ambientInheritance !== false || safetyEvidence.effectiveTools?.unknown !== "FAIL_CLOSED") fail("protocol boundary evidence is incomplete");
	if (integrityEvidence.schemaVersion !== 1 || integrityEvidence.status !== "PASS" || integrityEvidence.total !== 20 || integrityEvidence.passed !== 20 || integrityEvidence.failed !== 0 || !Array.isArray(integrityEvidence.attacks) || integrityEvidence.attacks.length !== 20) fail("release integrity attack evidence is incomplete");
	assertMachineNeutral(testEvidence, "test evidence");
	assertMachineNeutral(piEvidence, "Pi evidence");
	assertMachineNeutral(safetyEvidence, "worker safety evidence");
	assertMachineNeutral(integrityEvidence, "release integrity evidence");
	const evidence = JSON.parse(await readFile(join(bundle, "REVIEW_EVIDENCE.json"), "utf8"));
	const verification = JSON.parse(await readFile(join(bundle, "verification.json"), "utf8"));
	const releaseBinding = releaseBindingFor(manifest);
	if (evidence.schemaVersion !== 3 || evidence.status !== "EXTERNAL_REVIEW_PENDING" || evidence.artifact !== artifact || evidence.sha256 !== manifest.artifact.sha256 || !equalJson(evidence.release, releaseBinding) || !equalJson(evidence.evidence, manifest.evidence) || !equalJson(evidence.verification, verification) || evidence.bundleIntegrity?.manifest !== BUNDLE_MANIFEST || evidence.bundleIntegrity?.algorithm !== "sha256") fail("review evidence is not pending for the copied artifact");
	const digestNames = {
		manifest: "release-manifest.json",
		verification: "verification.json",
		testEvidence: "test-evidence.json",
		piEvidence: "pi-install-evidence.json",
		safetyEvidence: "worker-safety-evidence.json",
		integrityEvidence: "release-integrity-evidence.json",
	};
	const digests = Object.fromEntries(await Promise.all(Object.entries(digestNames).map(async ([key, name]) => [key, await sha256File(join(bundle, name))])));
	if (!equalJson(evidence.digests, digests)
		|| !equalJson(manifest.evidence?.test, { file: "test-evidence.json", sha256: digests.testEvidence })
		|| !equalJson(manifest.evidence?.pi, { file: "pi-install-evidence.json", sha256: digests.piEvidence })
		|| !equalJson(manifest.evidence?.safety, { file: "worker-safety-evidence.json", sha256: digests.safetyEvidence })
		|| !equalJson(manifest.evidence?.integrity, { file: "release-integrity-evidence.json", sha256: digests.integrityEvidence })) fail("review evidence digests do not match copied evidence");
	return { verified: true, artifact, sha256: manifest.artifact.sha256, status: evidence.status, rootSha256: recursive.rootSha256, fileCount: recursive.fileCount };
}

const main = async () => {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log("Usage: node scripts/create-review-bundle.mjs --release-dir DIR [--output DIR] [--force]\n       node scripts/create-review-bundle.mjs --verify DIR --expected-root-sha256 HEX");
		return;
	}
	console.log(JSON.stringify(options.mode === "verify"
		? await verifyReviewBundle(options.verify, options.expectedRootSha256)
		: await createReviewBundle(options), null, 2));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
