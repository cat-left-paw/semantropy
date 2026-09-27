import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

/**
 * `PRE-RELEASE-ADVERB-SPIKE1` mutation script isolation.
 *
 * `PRE-RELEASE-COLLISION-BATCH1`'s independent review found a development
 * mutation script that wrote into the working checkout, so the same property
 * is established here rather than assumed from the shared shape: this script
 * mutates a private temporary copy only, and neither ordinary completion, a
 * concurrent editor, nor forced termination can restore stale bytes over the
 * checkout.
 *
 * The runner is a stub — filesystem isolation is the subject here. The real
 * mutation assertions are exercised by running the script itself.
 */

const temporaryRoot = realpathSync(tmpdir());
const SOURCE = "src/adverb/adverbCapability.ts";
const AUTO_SOURCE = "src/transform/automaticPosProjection.ts";
const SCRIPT = "scripts/adverb/verifyAdverbMutations.mjs";
const MUTATION_PREFIX = "semantropy-adverb-mutations-";
const FIXTURE_PREFIX = "semantropy-adverb-script-test-";

/** Only our immediate mkdtemp children; never delete a checkout or follow a link. */
function removeTemporary(directory: string, prefix: string) {
	if (
		dirname(directory) !== temporaryRoot ||
		!basename(directory).startsWith(prefix) ||
		lstatSync(directory).isSymbolicLink() ||
		realpathSync(directory) !== directory
	) {
		throw new Error("Unexpected temporary directory");
	}
	rmSync(directory, { recursive: true, force: true });
}

type ProbeMode = "spike" | "automatic" | "settings" | "collect" | "view" | "max" | "max-core" | "max-view";
function fixture(mode: "normal" | "edit" | "kill", probe: ProbeMode) {
	const directory = realpathSync(
		mkdtempSync(join(temporaryRoot, FIXTURE_PREFIX)),
	);
	// The `max` probes mutate the SPIKE1 prototype, which lives under tests/.
	const sourceFile = probe === "max-view" ? "src/render/chunkTargetBodyController.ts" : probe === "max-core" ? "src/transform/maxRealizer.ts" : probe === "max" ? "tests/support/max/maxRealizer.ts" : probe === "view" ? "src/settings/AutomaticPosSettingsStore.ts" : probe === "collect" ? "src/collect/v3/CollectedFragmentV3.ts" : probe === "settings" ? "src/settings/automaticPosSettings.ts" : probe === "automatic" ? AUTO_SOURCE : SOURCE;
	const original = readFileSync(sourceFile);
	const source = join(directory, sourceFile);
	const script = join(directory, SCRIPT);
	const report = join(directory, "runner-report.json");
	for (const name of [
		"src/adverb",
		"src/transform",
		"src/settings",
		"src/view", "src/render", "src/application", "src/analysis",
		"src/collect/v3",
		"scripts/adverb",
		"scripts/lindera",
		"scripts/max",
		"tests/support/max",
		"tests/distribution",
		"node_modules/vitest",
		".cache",
	]) {
		mkdirSync(join(directory, name), { recursive: true });
	}
	const sourceFiles = [
		"src/adverb/adverbCapability.ts",
		"src/adverb/adverbFamily.ts",
		"src/adverb/adverbObservation.ts",
		"src/adverb/adverbBridgeProfile.ts",
		"src/transform/automaticPosProjection.ts",
		"src/transform/automaticPosCore.ts",
		"src/transform/manualMorphology.ts",
		"src/transform/manualAdverbAuthority.ts",
		"src/transform/maxCore.ts",
		"src/transform/maxAdverbBridge.ts",
		"src/transform/maxLevel.ts",
		"src/transform/maxProjection.ts",
		"src/transform/maxRealizer.ts",
		"src/settings/automaticPosSettings.ts",
		"src/settings/AutomaticPosSettingsStore.ts",
		"src/settings/AutomaticPosSettingsController.ts",
		"src/main.ts", "src/view/SemantropyView.ts", "src/render/chunkTargetBodyController.ts", "src/application/AutomaticPosCoordinator.ts", "src/application/bodyFragmentFromAutomatic.ts",
		"src/render/automaticPosBodyOwner.ts",
		"src/analysis/displaySlots.ts",
		"src/analysis/manualDisplay.ts",
		"src/collect/v3/CollectedFragmentV3.ts",
		"src/collect/v3/automaticPartsOfSpeech.ts",
		"src/collect/v3/FragmentRepositoryV3.ts",
		"src/collect/v3/serializeFragmentV3.ts",
		"src/collect/collectionDocument.ts",
		"src/collect/fragmentIdentityValidation.ts",
		"tests/support/max/maxRealizer.ts",
		"tests/support/max/targetFormKey.ts",
		"tests/support/max/profiles.ts",
		"tests/support/max/adverbProfiles.ts",
		// The `max` coverage probes mutate the gate's own expected counts.
		"tests/distribution/maxRealization.test.ts",
		"tests/distribution/maxAdverbProfiles.test.ts",
	];
	for (const file of sourceFiles) {
		writeFileSync(join(directory, file), readFileSync(file));
	}
	writeFileSync(script, readFileSync(SCRIPT));
	writeFileSync(join(directory, "scripts/adverb/automaticPosViewMutationProbes.mjs"), readFileSync("scripts/adverb/automaticPosViewMutationProbes.mjs"));
	writeFileSync(join(directory, "scripts/adverb/automaticPosMutationProbes.mjs"), readFileSync("scripts/adverb/automaticPosMutationProbes.mjs"));
	writeFileSync(join(directory, "scripts/adverb/automaticPosSettingsMutationProbes.mjs"), readFileSync("scripts/adverb/automaticPosSettingsMutationProbes.mjs"));
	writeFileSync(join(directory, "scripts/adverb/automaticPosCollectMutationProbes.mjs"), readFileSync("scripts/adverb/automaticPosCollectMutationProbes.mjs"));
	writeFileSync(join(directory, "scripts/max/mutationProbes.mjs"), readFileSync("scripts/max/mutationProbes.mjs"));
	writeFileSync(join(directory, "scripts/max/coreMutationProbes.mjs"), readFileSync("scripts/max/coreMutationProbes.mjs"));
	writeFileSync(join(directory, "scripts/max/viewMutationProbes.mjs"), readFileSync("scripts/max/viewMutationProbes.mjs"));
	writeFileSync(join(directory, "scripts/lindera/placeholder.mjs"), "export {};\n");
	for (const name of [
		"package.json",
		"tsconfig.json",
		"vitest.config.ts",
		"vitest.distribution.config.ts",
		"scripts/vitestAliases.mjs",
	]) {
		writeFileSync(
			join(directory, name),
			name.endsWith(".json") ? "{}" : "export {};\n",
		);
	}
	const runner = join(directory, "node_modules/vitest/vitest.mjs");
	writeFileSync(
		runner,
		`
import { existsSync, writeFileSync, statSync } from "node:fs";
const report = ${JSON.stringify(report)};
const source = ${JSON.stringify(source)};
const mode = ${JSON.stringify(mode)};
if (!existsSync(report)) {
  if (mode === "edit") writeFileSync(source, "concurrent editor bytes");
  writeFileSync(report, JSON.stringify({ directory: process.cwd(), mtime: String(statSync(source, { bigint: true }).mtimeNs) }));
}
if (mode === "kill") {
  setInterval(() => {}, 1000);
} else {
  const title = process.argv[process.argv.indexOf("-t") + 1];
  process.stdout.write(JSON.stringify({ testResults: [{ assertionResults: [{ status: "failed", title }] }] }));
  process.exitCode = 1;
}
`,
	);
	const watched = sourceFiles.map(file => ({ path: join(directory, file), bytes: readFileSync(join(directory, file)), mtime: statSync(join(directory, file), { bigint: true }).mtimeNs }));
	return { directory, source, sourceFile, script, report, runner, original, watched };
}

function start(script: string, directory: string, probe: ProbeMode) {
	const child = spawn(process.execPath, [script, ...(probe === "spike" ? [] : [`--${probe}`])], {
		cwd: directory,
		windowsHide: true,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout.on("data", (data: Buffer) => {
		output += data.toString();
	});
	child.stderr.on("data", (data: Buffer) => {
		output += data.toString();
	});
	const finished = new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	return { child, finished, output: () => output };
}

function terminateTree(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
		return;
	}
	// Only the PID/process group this test spawned, including its stub runner.
	if (process.platform === "win32") {
		execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
			windowsHide: true,
			stdio: "ignore",
		});
	} else {
		process.kill(-child.pid, "SIGKILL");
	}
}

describe("the adverb mutation script's checkout isolation", () => {
	it.each((["normal", "edit", "kill"] as const).flatMap(mode => (["spike", "automatic", "settings", "collect", "view", "max", "max-core", "max-view"] as const).map(probe => ({ mode, probe }))))(
		"preserves the checkout during $mode probe=$probe",
		async ({ mode, probe }) => {
			const copy = fixture(mode, probe);
			const before = statSync(copy.source, { bigint: true });
			const task = start(copy.script, copy.directory, probe);
			let scratch: string | undefined;
			try {
				if (mode === "kill") {
					const deadline = Date.now() + 10000;
					while (!existsSync(copy.report) && Date.now() < deadline) {
						await delay(20);
					}
					expect(existsSync(copy.report), task.output()).toBe(true);
					const running = JSON.parse(readFileSync(copy.report, "utf8")) as { directory: string };
					// Prove the mutant exists before killing. Windows taskkill can
					// terminate the runner before its parent, allowing parent cleanup.
					expect(readFileSync(join(running.directory, copy.sourceFile))).not.toEqual(readFileSync(copy.sourceFile));
					terminateTree(task.child);
					await task.finished;
				} else {
					expect(await task.finished, task.output()).toBe(0);
					expect(task.output()).toContain('"isolation": "temporary-copy"');
					expect(task.output()).toContain(`"caught": ${probe === "max-view" ? 12 : probe === "max-core" ? 32 : probe === "max" ? 20 : probe === "view" ? 9 : probe === "collect" ? 21 : probe === "settings" ? 12 : probe === "automatic" ? 22 : 23}`);
				}
				const report = JSON.parse(readFileSync(copy.report, "utf8")) as {
					directory: string;
					mtime: string;
				};
				scratch = report.directory;
				expect(dirname(scratch)).toBe(temporaryRoot);
				expect(basename(scratch)).toMatch(/^semantropy-adverb-mutations-/u);
				expect(scratch).not.toBe(copy.directory);
				if (mode !== "edit") {
					expect(readFileSync(copy.source)).toEqual(copy.original);
					expect(statSync(copy.source, { bigint: true }).mtimeNs).toBe(
						before.mtimeNs,
					);
				} else {
					// A concurrent editor's bytes survive: the script never writes
					// its own copy of the source back over the checkout.
					expect(readFileSync(copy.source, "utf8")).toBe(
						"concurrent editor bytes",
					);
					expect(String(statSync(copy.source, { bigint: true }).mtimeNs)).toBe(report.mtime);
				}
				expect(existsSync(copy.runner)).toBe(true);
				for (const file of copy.watched) {
					if (mode === "edit" && file.path === copy.source) continue;
					expect(readFileSync(file.path)).toEqual(file.bytes);
					expect(statSync(file.path, { bigint: true }).mtimeNs).toBe(file.mtime);
				}
				// Cleanup is mandatory normally; a killed process may leave a temp
				// copy or finish cleanup. Neither outcome may touch the checkout.
				if (mode !== "kill") expect(existsSync(scratch)).toBe(false);
				if (mode === "kill" && existsSync(scratch)) {
					expect(readFileSync(join(scratch, copy.sourceFile))).not.toEqual(
						readFileSync(copy.sourceFile),
					);
				}
			} finally {
				terminateTree(task.child);
				await task.finished;
				if (scratch && existsSync(scratch)) {
					removeTemporary(scratch, MUTATION_PREFIX);
				}
				removeTemporary(copy.directory, FIXTURE_PREFIX);
			}
		},
		30000,
	);
});
