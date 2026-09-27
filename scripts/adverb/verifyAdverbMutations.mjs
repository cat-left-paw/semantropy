/** Development-only probes in a private temporary copy. The checkout is read
 * only: neither normal cleanup nor forced termination can restore over edits.
 * Never imported by production.
 *
 * `PRE-RELEASE-ADVERB-SPIKE1`. Each probe reverts one closed rule to the wrong
 * implementation the policy or the task names, then runs the single focused
 * assertion that is supposed to notice. A probe that "passes" because the file
 * no longer parses is treated as a survivor, not a catch: the named assertion
 * has to be the thing that fails.
 */
import {
	cpSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));

const FAMILY = "src/adverb/adverbFamily.ts";
const OBSERVATION = "src/adverb/adverbObservation.ts";
const PROFILE = "src/adverb/adverbBridgeProfile.ts";
const CAPABILITY = "src/adverb/adverbCapability.ts";
const PURE = "tests/adverbSpike.test.ts";
const PROFILE_TEST = "tests/adverbBridgeProfile.test.ts";
const REVIEW = "tests/adverbReviewRegressions.test.ts";

/** [source file, test file, name, before, after, test name] */
const probes = [
	[
		CAPABILITY,
		PURE,
		"split-regular-adverb-family",
		"		(profile) => profile.headClass === targetProfile.headClass,\n	);",
		"		(profile) =>\n			profile.headClass === targetProfile.headClass &&\n			input.candidate.adverbClass ===\n				observed.observation.identity.adverbClass,\n	);",
		"lets the profile carry じっくり onto a と Target it never observed",
	],
	[
		CAPABILITY,
		PURE,
		"exact-bridge-equality",
		"	const capabilities = capabilitiesOf(candidate, matching);",
		"	const capabilities = Object.freeze({\n		none: matching.some((profile) => profile.bridge === \"none\"),\n		to: matching.some((profile) => profile.bridge === \"to\"),\n	});",
		"lets the profile carry じっくり onto a と Target it never observed",
	],
	[
		PROFILE,
		PURE,
		"unconditionally-to-capable-sugu",
		'	{ surface: "じっくり", adverbClass: "一般" },\n];',
		'	{ surface: "じっくり", adverbClass: "一般" },\n	{ surface: "すぐ", adverbClass: "助詞類接続" },\n];',
		"keeps すぐ to the bridge it was observed with",
	],
	[
		CAPABILITY,
		PURE,
		"duplicate-to-guard-removed",
		"	if (\n		targetProfile.bridge === \"to\" &&\n		adverbSurfaceEndsWithTo(candidate.surface)\n	) {",
		"	if (false) {",
		"never lets an observation lift the duplicate-と guard",
	],
	[
		FAMILY,
		PURE,
		"surface-only-candidate-identity",
		"			identityKey: vocabularyCandidateId(token),",
		'			identityKey: vocabularyCandidateId({ ...token, detail1: "一般" }),',
		"refuses an identity the index never saw",
	],
	[
		OBSERVATION,
		PURE,
		"unknown-falls-back-to-nonnegative",
		'		if (token.isUnknown) {\n			return { decided: false, reason: "polarity-undetermined" };\n		}',
		'		if (token.isUnknown) {\n			return { decided: true, polarity: "nonnegative" };\n		}',
		"never falls back to nonnegative for an undefined structure",
	],
	[
		OBSERVATION,
		"tests/distribution/adverbSpike.test.ts",
		"scan-crosses-punctuation",
		"		if (isTailContinuation(token)) {",
		"		if (isTailContinuation(token) || true) {",
		"never crosses a 句点 or a 読点 into the next clause",
	],
	[
		OBSERVATION,
		PURE,
		"scan-limit-removed",
		'			if (crossed > ADVERB_TAIL_SCAN_LIMIT) {\n				return { decided: false, reason: "scan-limit-reached" };\n			}\n',
		"",
		"stops at the scan limit instead of walking on",
	],
	[
		PROFILE,
		PROFILE_TEST,
		"profile-version-validation-removed",
		'	if (\n		!Number.isSafeInteger(input.dataVersion) ||\n		input.dataVersion < 1\n	) {\n		throw new AdverbBridgeProfileError("invalid profile data version");\n	}\n',
		"",
		"refuses an invalid data version",
	],
	[
		PROFILE,
		PROFILE_TEST,
		"profile-entry-validation-removed",
		'		if (adverbSurfaceEndsWithTo(surface)) {\n			throw new AdverbBridgeProfileError("profile surface already ends in と");\n		}\n',
		"",
		"refuses an entry whose surface already ends in と",
	],
	// The four defects the first independent review found. Each probe restores
	// the exact implementation that was rejected.
	// Owner-approved amendment 1: the comma rule is the contract. These two
	// probe it in both directions — dropping it, and letting it infer a
	// polarity from past the comma, which the amendment explicitly excludes.
	[
		OBSERVATION,
		REVIEW,
		"comma-head-no-longer-observed",
		'		return { supported: true, headClass: "sentence-modifier" };',
		'		return { supported: false, reason: "unsupported-head" };',
		"observes the comma and reads nothing past it",
	],
	[
		OBSERVATION,
		REVIEW,
		"sentence-modifier-polarity-inferred",
		'	if (head.headClass === "verb-predicate") {',
		'	if (head.headClass !== "adjective-predicate") {',
		"observes the comma and reads nothing past it",
	],
	[
		OBSERVATION,
		REVIEW,
		"bound-forms-narrowed-to-mizen-and-katei",
		"	const bound = !STANDALONE_VERB_FORMS.has(tokens[headIndex]!.conjugationForm);",
		'	const bound = ["未然形", "未然ウ接続", "未然ヌ接続", "未然レル接続", "未然特殊", "仮定形", "仮定縮約１"].includes(tokens[headIndex]!.conjugationForm);',
		"refuses every bound head form, not only 未然 and 仮定",
	],
	[
		CAPABILITY,
		REVIEW,
		"candidate-fields-trusted-over-resolved-record",
		// The reviewed defect exactly: look the evidence up by key, then decide
		// with the caller's own fields. Reverting only one half is not the
		// defect — the agreement check alone already refuses the forgery — so
		// the probe restores both.
		'	if (!agrees(input.candidate, entry.identity)) {\n		return freezeAnalysis({\n			usable: false,\n			stage: "candidate",\n			reason: "candidate-identity-mismatch",\n		});\n	}\n	// From here on the argument is not read again: only the resolved record is.\n	const candidate = entry.identity;',
		"	const candidate = input.candidate;",
		"refuses じっくり's genuine key carrying すぐ's surface and class",
	],
	[
		CAPABILITY,
		REVIEW,
		"candidate-identity-agreement-removed",
		"	if (!agrees(input.candidate, entry.identity)) {",
		"	if (false) {",
		"refuses any single substituted field",
	],
	[
		OBSERVATION,
		REVIEW,
		"index-published-unsorted",
		"	const entries: AdverbObservationEntry[] = [...identities.values()]\n		.sort((a, b) => compare(a.identityKey, b.identityKey))",
		"	const entries: AdverbObservationEntry[] = [...identities.values()]",
		"does not depend on the order the runs arrived in",
	],
	[
		OBSERVATION,
		REVIEW,
		"index-published-as-a-mutable-map",
		"	return Object.freeze({\n		entries: Object.freeze(entries),\n		candidates: Object.freeze(entries.map((entry) => entry.identity)),\n		lookup,\n	});",
		"	return Object.freeze({\n		entries,\n		candidates: entries.map((entry) => entry.identity),\n		lookup,\n		byKey,\n	} as never);",
		"exposes no mutable collection",
	],
	[
		OBSERVATION,
		REVIEW,
		"rule-sets-published-mutable",
		'export const ADVERB_STANDALONE_VERB_FORMS: readonly string[] = Object.freeze([',
		"export const ADVERB_STANDALONE_VERB_FORMS: readonly string[] = ([",
		"publishes the closed rule sets as frozen arrays",
	],
	// The second independent review's findings.
	[
		OBSERVATION,
		REVIEW,
		"crossing-anything-completes-the-predicate",
		"			const complete = crossed === 0 ? !bound : clauseFinal;",
		"			const complete = crossed === 0 ? !bound : true;",
		"refuses the three reported truncations",
	],
	[
		OBSERVATION,
		REVIEW,
		"helper-verbs-treated-as-clause-final",
		'	return (\n		token.pos === "助動詞" && CLAUSE_FINAL_AUXILIARY_SURFACES.has(token.surface)\n	);',
		'	return token.pos === "助動詞" || token.pos === "動詞";',
		"never calls a helper verb or a 接続助詞 clause-final",
	],
	[
		PROFILE,
		REVIEW,
		"profile-helper-matches-key-only",
		"	const entry = PROFILE_ENTRIES.get(identity.identityKey);\n	return (\n		entry !== undefined &&\n		identity.family === ADVERB_FAMILY &&\n		identity.surface === entry.surface &&\n		identity.adverbClass === entry.adverbClass\n	);",
		"	return PROFILE_ENTRIES.get(identity.identityKey) !== undefined;",
		"refuses じっくり's key carrying すぐ's surface and class",
	],
	[
		CAPABILITY,
		REVIEW,
		"capability-seam-trusts-its-argument",
		"	if (entry === null || !agrees(input.candidate, entry.identity)) {\n		return null;\n	}",
		"	if (entry === null) {\n		return null;\n	}",
		"resolves the capability seam against the index, not its argument",
	],
	[
		CAPABILITY,
		REVIEW,
		"profile-grants-an-unobserved-context",
		"	return matching.length === 0 ? null : capabilitiesOf(entry.identity, matching);",
		"	return capabilitiesOf(entry.identity, matching);",
		"resolves the capability seam against the index, not its argument",
	],
];

const evidence = [];
let failure = null;
// Same reviewed temporary-copy runner; Manual probes never write into the checkout either.
const selectedProbes = process.argv.includes("--max-view")
	? (await import("../max/viewMutationProbes.mjs")).probes
	: process.argv.includes("--max-core")
	? (await import("../max/coreMutationProbes.mjs")).probes
	: process.argv.includes("--max")
	? (await import("../max/mutationProbes.mjs")).probes
	: process.argv.includes("--view")
	? (await import("./automaticPosViewMutationProbes.mjs")).probes
	: process.argv.includes("--collect")
	? (await import("./automaticPosCollectMutationProbes.mjs")).probes
	: process.argv.includes("--settings")
	? (await import("./automaticPosSettingsMutationProbes.mjs")).probes
	: process.argv.includes("--automatic")
	? (await import("./automaticPosMutationProbes.mjs")).probes
	: process.argv.includes("--manual") ? (await import("./manualAdverbMutationProbes.mjs")).probes : probes;

function removeMutationDirectory(directory) {
	if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
		throw new Error("Mutation directory identity changed");
	}
	rmSync(directory, { recursive: true, force: true });
}

const temporaryRoot = realpathSync(tmpdir());
const directory = realpathSync(
	mkdtempSync(join(temporaryRoot, "semantropy-adverb-mutations-")),
);
const fromCheckout = relative(root, directory);
// Check the resolved deletion/mutation boundary before copying or writing.
if (
	dirname(directory) !== temporaryRoot ||
	!basename(directory).startsWith("semantropy-adverb-mutations-") ||
	(!isAbsolute(fromCheckout) &&
		fromCheckout !== ".." &&
		!fromCheckout.startsWith(`..${sep}`))
) {
	throw new Error("Mutation directory must be outside the checkout");
}
try {
	// Regular copies, never source hardlinks/junctions. The distribution probe
	// additionally needs the prepared dictionary directory, which is read only.
	for (const entry of [
		"src",
		"tests",
		"package.json",
		"tsconfig.json",
		"vitest.config.ts",
		"vitest.distribution.config.ts",
		"scripts/vitestAliases.mjs",
		"scripts/lindera",
		// `--max` probes run the SPIKE1 gate, which reads the dictionary itself.
		"scripts/max",
	]) {
		const destination = join(directory, entry);
		mkdirSync(dirname(destination), { recursive: true });
		cpSync(join(root, entry), destination, { recursive: true, dereference: true });
	}
	symlinkSync(join(root, ".cache"), join(directory, ".cache"), "junction");
	// Reuse installed packages, but keep node_modules itself local so Vite's
	// .vite / .vite-temp caches cannot follow a junction into the checkout.
	const dependencies = join(directory, "node_modules");
	mkdirSync(dependencies);
	for (const entry of readdirSync(join(root, "node_modules"), { withFileTypes: true })) {
		if (!entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) {
			symlinkSync(
				join(root, "node_modules", entry.name),
				join(dependencies, entry.name),
				"junction",
			);
		}
	}
	for (const [sourceFile, testFile, name, before, after, testName] of selectedProbes) {
		const file = join(directory, sourceFile);
		const source = readFileSync(file, "utf8");
		if (source.split(before).length !== 2) {
			throw new Error(`Mutation anchor is not unique: ${name}`);
		}
		writeFileSync(file, source.replace(before, after));
		const distribution = testFile.startsWith("tests/distribution/");
		const run = spawnSync(
			process.execPath,
			[
				resolve(dependencies, "vitest/vitest.mjs"),
				"run",
				...(distribution ? ["--config", "vitest.distribution.config.ts"] : []),
				testFile,
				"-t",
				testName,
				"--reporter=json",
			],
			{
				cwd: directory,
				encoding: "utf8",
				timeout: 120000,
				windowsHide: true,
				maxBuffer: 8 * 1024 * 1024,
			},
		);
		const result = JSON.parse(run.stdout);
		// A parse/import error is not a caught mutation: the named assertion must fail.
		const failures = result.testResults
			.flatMap((test) => test.assertionResults)
			.filter(
				(assertion) =>
					assertion.status === "failed" && assertion.title.includes(testName),
			);
		if (run.status !== 1 || failures.length === 0) {
			throw new Error(`Mutation survived or test did not run: ${name}`);
		}
		evidence.push({ name, sourceFile, testName, failedAssertions: failures.length });
		writeFileSync(file, source); // Restore only the disposable copy for the next probe.
		process.stdout.write(`[adverb-mutation] ${name}: caught\n`);
	}
} catch (error) {
	failure = error;
} finally {
	// Remove only this mkdtemp directory. Refuse a replaced root; rm removes
	// package junctions themselves, without traversing their installed targets.
	try {
		removeMutationDirectory(directory);
	} catch (cleanupError) {
		failure = new AggregateError(
			failure === null ? [cleanupError] : [failure, cleanupError],
			"Mutation cleanup failed",
		);
	}
}
if (failure !== null) throw failure;
process.stdout.write(
	`${JSON.stringify({ caught: evidence.length, isolation: "temporary-copy", evidence }, null, 2)}\n`,
);
