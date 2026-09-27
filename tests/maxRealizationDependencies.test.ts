import { readdir } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * `PRE-RELEASE-MAX-REALIZATION-SPIKE1` boundaries, read from the module graph
 * rather than inferred from behaviour.
 *
 * The slice is an investigation, so its strongest structural claim is a
 * negative one: none of it can reach production. That is asserted here rather
 * than argued from the fact that `main.js` is byte-identical, because
 * byte-identity is the *consequence* and this is the cause.
 *
 * Three claims:
 *
 *   - Production cannot reach the prototype. No module the plugin entry point
 *     imports leads to `tests/` or to `scripts/max/`.
 *   - The prototype adds nothing to `src/`. The whole slice lives in
 *     `scripts/max/` (a read-only dictionary reader) and `tests/support/max/`
 *     (the prototype), so there is no new production module to review, and
 *     CORE1 is free to design its own API instead of inheriting this one.
 *   - The prototype is a leaf over reviewed production code. It imports the
 *     shared conjugation allowlist, the surface-safety predicate, the Manual
 *     contract and the adverb authority — and nothing that tokenizes, reads a
 *     file, reaches the network, writes the Clipboard, the Vault or settings,
 *     or draws a random number.
 */

const SPIKE_SUPPORT = [
	"tests/support/max/adverbProfiles.ts",
	"tests/support/max/corpus.ts",
	"tests/support/max/maxRealizer.ts",
	"tests/support/max/profiles.ts",
	"tests/support/max/roundTrip.ts",
	"tests/support/max/targetFormKey.ts",
];

const SPIKE_SCRIPTS = [
	// PRE-RELEASE-MAX-CORE1's development-only probes (`--max-core`), added later beside SPIKE1's.
	"scripts/max/coreMutationProbes.mjs",
	// Development-only mutation probes, run in a private temporary copy.
	"scripts/max/mutationProbes.mjs",
	"scripts/max/scanDictionary.d.mts",
	"scripts/max/scanDictionary.mjs",
	// PRE-RELEASE-MAX-VIEW1's development-only probes (`--max-view`).
	"scripts/max/viewMutationProbes.mjs",
];

async function graph(entry: string, external: readonly string[] = []) {
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		metafile: true,
		platform: "neutral",
		format: "esm",
		external: [...external],
		legalComments: "none",
	});
	return Object.keys(result.metafile.inputs);
}

describe("the MAX realization spike dependency boundary", () => {
	it("adds no module under src/ of its own", async () => {
		// SPIKE1 added nothing under src/. PRE-RELEASE-MAX-CORE1 later added exactly
		// these production-disconnected modules, pinned by
		// `tests/maxCoreDependencies.test.ts`; none of them is this prototype.
		const entries = await readdir("src/transform");
		expect(entries.filter((name) => name.toLowerCase().includes("max")).sort()).toEqual(
			["maxAdverbBridge.ts", "maxCore.ts", "maxLevel.ts", "maxProjection.ts", "maxRealizer.ts", "maxVersions.ts"],
		);
		// The whole slice is here, and nowhere else.
		expect((await readdir("tests/support/max")).map((name) => `tests/support/max/${name}`).sort()).toEqual(
			SPIKE_SUPPORT,
		);
		expect((await readdir("scripts/max")).map((name) => `scripts/max/${name}`).sort()).toEqual(
			SPIKE_SCRIPTS,
		);
	});

	it("is unreachable from the production entry points", async () => {
		for (const [entry, external] of [
			["src/SemantropyPlugin.ts", ["obsidian"]],
			["src/main.ts", ["obsidian", "virtual:semantropy-lindera-wasm", "virtual:semantropy-lindera-payload"]],
		] as const) {
			const inputs = await graph(entry, external);
			expect(inputs.filter((name) => name.includes("tests/"))).toEqual([]);
			expect(inputs.filter((name) => name.includes("scripts/max"))).toEqual([]);
			// MAX-VIEW1 connected the production realizer `src/transform/maxRealizer.ts`; the prototype stays unreachable.
			expect(inputs.filter((name) => name.includes("tests/support/max"))).toEqual([]);
			expect(inputs.filter((name) => name.toLowerCase().includes("targetformkey"))).toEqual([]);
		}
	});

	it("keeps the realizer a leaf over the shared allowlist and nothing else", async () => {
		const inputs = await graph("tests/support/max/maxRealizer.ts");
		expect(inputs.sort()).toEqual(
			[
				"src/collision/regularInflection.ts",
				"src/transform/regularConjugationTypes.ts",
				"tests/support/max/maxRealizer.ts",
			].sort(),
		);
		// It cannot tokenize, read a file, or reach a random number generator,
		// because none of that is in its graph.
		for (const forbidden of ["tokenizer/", "random/", "vocabulary/", "view/", "settings/", "collect/", "node:"]) {
			expect(inputs.filter((name) => name.includes(forbidden))).toEqual([]);
		}
	});

	it("reaches the Manual contract for the Target requirement, and no further", async () => {
		const inputs = await graph("tests/support/max/targetFormKey.ts", [
			"virtual:semantropy-lindera-wasm",
		]);
		// The Target requirement is derived from `manualMorphConnection()`, so
		// the analyzer it lives beside is in the graph. What must not be there
		// is anything that could act: a View, a setting, the Clipboard, storage.
		expect(inputs.some((name) => name.includes("src/transform/manualMorphology.ts"))).toBe(true);
		for (const forbidden of ["src/view/", "src/settings/", "src/copy/", "src/collect/", "src/render/", "src/application/Semantropy"]) {
			expect(inputs.filter((name) => name.includes(forbidden))).toEqual([]);
		}
	});
});
