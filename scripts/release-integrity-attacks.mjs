import { spawn } from "node:child_process";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
	createGitSourceStage,
	inspectTree,
	scanPrivacy,
	validateTestEvidence,
	verifyReleaseDirectory,
} from "./release-candidate.mjs";
import { verifyBundleIntegrity, writeBundleIntegrityManifest } from "./create-review-bundle.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fail = (message) => { throw new Error(message); };
const scrub = (value) => String(value)
	.replace(/(?:\/Users|\/private|\/home|\/tmp|\/var\/folders)\/[^\s"'`]+/gu, "<path>")
	.replace(/[A-Z]:[\\/]Users[\\/][^\s"'`]+/gu, "<path>");

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
	const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.once("error", reject);
	child.once("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
});

const expectReject = async (operation, label) => {
	let rejected = false;
	try { await operation(); } catch { rejected = true; }
	if (!rejected) fail(`${label} was accepted`);
};

const parseArgs = (argv) => {
	let releaseDir;
	let output;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--release-dir") releaseDir = argv[++index];
		else if (argv[index] === "--output") output = argv[++index];
		else if (argv[index] === "--help") return { help: true };
		else fail(`unknown argument: ${argv[index]}`);
	}
	if (!releaseDir) fail("usage: node scripts/release-integrity-attacks.mjs --release-dir DIR [--output FILE]");
	const resolvedRelease = resolve(releaseDir);
	return { releaseDir: resolvedRelease, output: output ? resolve(output) : join(resolvedRelease, "release-integrity-evidence.json"), help: false };
};

const writeExecutable = async (path, body) => {
	await writeFile(path, body, "utf8");
	await chmod(path, 0o755);
};

const treeContains = async (root, marker) => {
	const tree = await inspectTree(root);
	if (tree.symlinks.length > 0 || tree.special.length > 0) fail("test output contains an unexpected non-regular entry");
	for (const path of tree.files) if ((await readFile(join(root, path))).includes(Buffer.from(marker))) return true;
	return false;
};

const copyAndMutate = async (base, temporaryRoot, name, mutate) => {
	const target = join(temporaryRoot, name);
	await cp(base, target, { recursive: true });
	await mutate(target);
	return target;
};

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) return;
	const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-m11-r8-attacks-"));
	const attacks = [];
	const attack = async (id, name, operation) => {
		try {
			await operation();
			attacks.push({ id, name, status: "PASS" });
		} catch (error) {
			attacks.push({ id, name, status: "FAIL", error: scrub(error instanceof Error ? error.message : error) });
		}
	};
	try {
		const manifest = JSON.parse(await readFile(join(args.releaseDir, "release-manifest.json"), "utf8"));
		const testEvidence = JSON.parse(await readFile(join(args.releaseDir, "test-evidence.json"), "utf8"));
		validateTestEvidence(testEvidence, manifest);

		const sourceStage = await createGitSourceStage();
		let poisonedOutput;
		let fakeNpmMarker;
		try {
			const poisonMarker = "M11_R8_UNTRACKED_SOURCE_MUST_NOT_SHIP";
			const staleMarker = "M11_R8_STALE_IGNORED_BUILD_MUST_NOT_SHIP";
			await writeFile(join(sourceStage.sourceRoot, "src", "m11-r8-untracked.ts"), `export const marker = ${JSON.stringify(poisonMarker)};\n`, "utf8");
			await mkdir(join(sourceStage.sourceRoot, "dist", "host"), { recursive: true });
			await writeFile(join(sourceStage.sourceRoot, "dist", "host", "m11-r8-stale.js"), `export const marker = ${JSON.stringify(staleMarker)};\n`, "utf8");
			const fakeBin = join(temporaryRoot, "fake-bin");
			await mkdir(fakeBin, { recursive: true });
			fakeNpmMarker = join(temporaryRoot, "fake-npm-executed");
			await writeExecutable(join(fakeBin, "npm"), "#!/bin/sh\nprintf attacked > \"$M11_R8_FAKE_NPM_MARKER\"\nexit 0\n");
			poisonedOutput = join(temporaryRoot, "poisoned-release");
			const releaseRun = await run(process.execPath, [join(sourceStage.sourceRoot, "scripts", "release-candidate.mjs"), "--output", poisonedOutput], {
				cwd: sourceStage.sourceRoot,
				env: {
					PATH: [fakeBin, dirname(process.execPath), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"].join(delimiter),
					HOME: temporaryRoot,
					TMPDIR: tmpdir(),
					LANG: "C",
					LC_ALL: "C",
					M11_R8_FAKE_NPM_MARKER: fakeNpmMarker,
				},
			});
			if (releaseRun.code !== 0) fail(`poisoned-source release fixture failed: ${releaseRun.stderr}`);
			const poisonManifest = JSON.parse(await readFile(join(poisonedOutput, "release-manifest.json"), "utf8"));
			await attack(1, "untracked malicious source is excluded by Git staging", async () => {
				if (poisonManifest.gitCommit !== sourceStage.sourceIdentity.gitCommit || poisonManifest.sourceDigest !== sourceStage.sourceIdentity.sourceDigest || poisonManifest.untrackedIncluded !== false || await treeContains(join(poisonedOutput, "directory-source"), poisonMarker)) fail("untracked source affected the candidate");
			});
			await attack(2, "stale ignored build output is excluded", async () => {
				if (await treeContains(join(poisonedOutput, "directory-source"), staleMarker)) fail("ignored stale output affected the candidate");
			});
			await attack(6, "fake npm earlier on PATH is not executed", async () => {
				if (await lstat(fakeNpmMarker).then(() => true, () => false)) fail("fake npm executed");
			});
		} finally {
			await rm(sourceStage.temporaryRoot, { recursive: true, force: true });
		}

		await attack(3, "0/0 test evidence is rejected", async () => {
			const forged = structuredClone(testEvidence);
			forged.check.tests = { total: 0, suites: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
			await expectReject(async () => validateTestEvidence(forged, manifest), "0/0 test evidence");
		});
		await attack(5, "changed test definition and forged PASS are rejected", async () => {
			const forged = structuredClone(testEvidence);
			forged.source.testDefinition.scripts.check = "node -e pass";
			await expectReject(async () => validateTestEvidence(forged, manifest), "changed test definition");
		});

		await attack(7, "fake Pi identity is rejected before execution", async () => {
			const fakePi = join(temporaryRoot, "fake-pi");
			const marker = join(temporaryRoot, "fake-pi-executed");
			await writeExecutable(fakePi, "#!/bin/sh\nprintf attacked > \"$M11_R8_FAKE_PI_MARKER\"\nprintf '0.84.1\\n'\n");
			const result = await run(process.execPath, [join(repoRoot, "scripts", "verify-pi-release.mjs"), "--release-dir", args.releaseDir, "--output", join(temporaryRoot, "fake-pi-evidence.json")], {
				cwd: repoRoot,
				env: { PATH: process.env.PATH ?? "", HOME: temporaryRoot, TMPDIR: tmpdir(), LANG: "C", LC_ALL: "C", PI_BIN: fakePi, M11_R8_FAKE_PI_MARKER: marker },
			});
			if (result.code === 0 || !/does not resolve to the validated/u.test(result.stderr) || await lstat(marker).then(() => true, () => false)) fail("fake Pi was accepted or executed");
		});

		await attack(8, "private paths after assignments are rejected", async () => {
			const fixture = join(temporaryRoot, "privacy-assignments");
			await mkdir(fixture, { recursive: true });
			await writeFile(join(fixture, "fixture.log"), "source=/Users/reviewer/project\nhome = '/home/reviewer/project'\nwin=C:\\Users\\reviewer\\project\n", "utf8");
			const report = await scanPrivacy(fixture);
			if (report.clean || !report.issues.some((issue) => issue.kind === "local-absolute-path")) fail("private assignment path was missed");
			const benign = join(temporaryRoot, "privacy-benign");
			await mkdir(benign, { recursive: true });
			await writeFile(join(benign, "README.md"), "Extract under /tmp/example for a disposable test.\n", "utf8");
			if (!(await scanPrivacy(benign)).clean) fail("generic documented /tmp path was incorrectly rejected");
		});
		await attack(9, "JSON private profile paths are rejected", async () => {
			const fixture = join(temporaryRoot, "privacy-json");
			await mkdir(fixture, { recursive: true });
			await writeFile(join(fixture, "fixture.json"), JSON.stringify({ unix: "/Users/reviewer/project", linux: "/home/reviewer/project", windows: "C:\\Users\\reviewer\\project" }), "utf8");
			if ((await scanPrivacy(fixture)).clean) fail("JSON private paths were missed");
		});

		await attack(10, "artifact symlink is rejected", async () => {
			const copy = join(temporaryRoot, "artifact-symlink-release");
			await cp(args.releaseDir, copy, { recursive: true });
			const artifact = join(copy, manifest.artifact.file);
			await rm(artifact, { force: true });
			await symlink(join(args.releaseDir, manifest.artifact.file), artifact);
			await expectReject(() => verifyReleaseDirectory(copy), "artifact symlink");
		});

		const integrityBase = join(temporaryRoot, "integrity-base");
		for (const directory of ["directory-source/dist/host", "m10-baseline/dist/host"]) await mkdir(join(integrityBase, directory), { recursive: true });
		const fixtureFiles = {
			"RELEASE_REVIEW.md": "review instructions\n",
			"package.json": "{\"name\":\"pi-multi-orchestrator\"}\n",
			"directory-source/package.json": "{\"name\":\"pi-multi-orchestrator\"}\n",
			"directory-source/dist/host/pi-extension.js": "export default () => {};\n",
			"m10-baseline/package.json": "{\"name\":\"pi-multi-orchestrator\",\"version\":\"0.0.0-development\"}\n",
			"m10-baseline/dist/host/pi-extension.js": "export default () => {};\n",
			"m10-baseline.tgz": "m10-artifact-fixture\n",
			"test-evidence.json": "{\"tests\":169}\n",
			"pi-install-evidence.json": "{\"snapshot\":\"preserved\"}\n",
		};
		for (const [path, content] of Object.entries(fixtureFiles)) await writeFile(join(integrityBase, path), content, "utf8");
		const integrity = await writeBundleIntegrityManifest(integrityBase);
		await verifyBundleIntegrity(integrityBase, integrity.rootSha256);

		await attack(4, "synthetic 999/999 evidence fails the external root", async () => {
			const copy = await copyAndMutate(integrityBase, temporaryRoot, "attack-4", (target) => writeFile(join(target, "test-evidence.json"), "{\"tests\":999,\"passed\":999,\"status\":\"PASS\"}\n", "utf8"));
			await expectReject(() => verifyBundleIntegrity(copy, integrity.rootSha256), "999/999 evidence tamper");
		});
		await attack(11, "top-level bundle symlink is rejected", async () => {
			const copy = await copyAndMutate(integrityBase, temporaryRoot, "attack-11", async (target) => { await rm(join(target, "RELEASE_REVIEW.md")); await symlink(join(integrityBase, "RELEASE_REVIEW.md"), join(target, "RELEASE_REVIEW.md")); });
			await expectReject(() => verifyBundleIntegrity(copy, integrity.rootSha256), "top-level symlink");
		});
		await attack(12, "nested M10 symlink is rejected", async () => {
			const copy = await copyAndMutate(integrityBase, temporaryRoot, "attack-12", async (target) => { const path = join(target, "m10-baseline/dist/host/pi-extension.js"); await rm(path); await symlink(join(integrityBase, "m10-baseline/dist/host/pi-extension.js"), path); });
			await expectReject(() => verifyBundleIntegrity(copy, integrity.rootSha256), "nested M10 symlink");
		});
		for (const [id, name, path, content] of [
			[13, "nested M10 content tamper is rejected", "m10-baseline/package.json", "tampered-m10\n"],
			[14, "M10 artifact swap is rejected", "m10-baseline.tgz", "candidate-artifact-swap\n"],
			[15, "review documentation tamper is rejected", "RELEASE_REVIEW.md", "tampered-review\n"],
			[16, "root package metadata tamper is rejected", "package.json", "tampered-package\n"],
			[17, "test evidence tamper is rejected", "test-evidence.json", "tampered-tests\n"],
			[18, "compatibility snapshot tamper is rejected", "pi-install-evidence.json", "tampered-snapshot\n"],
		]) {
			await attack(id, name, async () => {
				const copy = await copyAndMutate(integrityBase, temporaryRoot, `attack-${id}`, (target) => writeFile(join(target, path), content, "utf8"));
				await expectReject(() => verifyBundleIntegrity(copy, integrity.rootSha256), name);
			});
		}
		await attack(19, "extra unmanifested critical file is rejected", async () => {
			const copy = await copyAndMutate(integrityBase, temporaryRoot, "attack-19", (target) => writeFile(join(target, "directory-source/dist/unmanifested-critical.js"), "unexpected\n", "utf8"));
			await expectReject(() => verifyBundleIntegrity(copy, integrity.rootSha256), "extra critical file");
		});
		await attack(20, "wrong external root SHA-256 is rejected", async () => {
			await expectReject(() => verifyBundleIntegrity(integrityBase, "0".repeat(64)), "wrong external root");
		});

		attacks.sort((left, right) => left.id - right.id);
		const failed = attacks.filter((item) => item.status !== "PASS").length;
		const report = {
			schemaVersion: 1,
			status: failed === 0 && attacks.length === 20 ? "PASS" : "FAIL",
			total: attacks.length,
			passed: attacks.length - failed,
			failed,
			liveCalls: 0,
			paidInference: 0,
			attacks,
		};
		await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
		if (report.status !== "PASS") fail(`release integrity attacks failed (${report.passed}/${report.total})`);
		console.log(JSON.stringify(report, null, 2));
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(scrub(error instanceof Error ? error.message : error)); process.exitCode = 1; });
