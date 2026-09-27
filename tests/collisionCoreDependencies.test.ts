import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { COLLISION_PRODUCTION_MODULES } from "./support/collisionProductionGraph";

/**
 * `PRE-RELEASE-COLLISION-CORE1` boundaries, read from the module graph rather
 * than inferred from behaviour.
 *
 *   - The generation core is a leaf: it cannot tokenize, read a file or a
 *     runtime resource, reach the network, touch the DOM, settings, the
 *     Clipboard or the Vault, because none of that is reachable from it.
 *   - It does not import the generated standard pattern entries. Choosing a
 *     pattern set is the caller's decision, so the core cannot become a
 *     production entry point by accident; tests and a later explicit caller
 *     are the only places that data is connected.
 *   - VIEW1 now connects the reviewed graph from production. That changes no
 *     capability of this pure core; the negative assertions below remain.
 */

const CORE_ENTRY = "src/collision/collisionCore.ts";

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
	return {
		inputs: Object.keys(result.metafile.inputs),
		code: result.outputFiles[0]!.text.replace(
			/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu,
			"",
		),
	};
}

describe("the Collision core dependency boundary", () => {
	it("reaches no tokenizer, Obsidian, DOM, Vault, renderer, settings or filesystem module", async () => {
		const { inputs, code } = await graph(CORE_ENTRY);
		for (const name of inputs) {
			expect(name).not.toMatch(
				/obsidian|node_modules|\/tokenizer\/|\/render\/|\/view\/|\/collect\/|\/settings\/|SemantropyView|SemantropySession|SourceSnapshot|generateFakeDefinition|standardTemplate/u,
			);
		}
		expect(code).not.toMatch(
			/MarkdownRenderer|postProcess|\bVault\b|TFile|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|require\(|node:fs|readFile|writeFile|resourcePath|clipboard|localStorage|saveData|loadData/u,
		);
		// The nonce arrives as a number: the core issues none and reads no clock.
		expect(code).not.toMatch(
			/Math\.random|Date\.now|new Date|performance\.|getRandomValues|issueUint32Seed/u,
		);
	});

	it("never imports the generated standard pattern entries", async () => {
		const { inputs } = await graph(CORE_ENTRY);
		expect(
			inputs.filter((name) => name.includes("generated/standardCollisionPattern")),
		).toEqual([]);
	});

	it("reaches exactly this closed set of pure modules", async () => {
		// Pinned whole rather than pattern-matched: a new dependency has to be
		// looked at, not merely be unlike a forbidden name.
		//
		// The Source analyzer is reachable, and deliberately so. A consumer has
		// to be able to ask whether a pool came through the authenticated chain,
		// and that chain begins at `analyzeManualMorphSource()`, so the module
		// holding the private registry is in the graph. Everything it brings is
		// pure: `analyzeSelectedSource` takes a tokenizer as an argument and
		// imports no implementation, and the capability assertions above still
		// hold over the bundled code. `src/dictionary/placeholders.ts` is a pure
		// part-of-speech classifier the Snapshot module uses, not the Fake
		// Dictionary.
		const { inputs } = await graph(CORE_ENTRY);
		expect([...inputs].sort()).toEqual([
			"src/analysis/activeContinuation.ts",
			"src/analysis/locateTokens.ts",
			"src/analysis/projectMarkdownSource.ts", "src/analysis/reuseTargetAnalysis.ts",
			"src/analysis/rubyAnalysis.ts",
			"src/analysis/rubyVocabulary.ts", "src/analysis/targetChunkIr.ts",
			"src/application/analyzeSelectedSource.ts",
			"src/collision/collisionCore.ts",
			"src/collision/collisionLexemePool.ts",
			"src/collision/collisionVocabulary.ts",
			"src/collision/compilePatternSet.ts",
			"src/collision/patternData.ts",
			"src/collision/regularInflection.ts",
			"src/dictionary/placeholders.ts",
			"src/random/seededRandom.ts",
			"src/transform/manualMorphology.ts",
			"src/transform/regularConjugationTypes.ts",
			"src/transform/slotScore.ts",
			"src/transform/tokenPolicy.ts",
			"src/transform/transformTokens.ts",
			"src/vocabulary/sha256.ts",
			"src/vocabulary/vocabularySnapshot.ts",
		]);
	});

	it("keeps the pure lexeme builder a leaf", async () => {
		// The pool builder itself must not reach the Source analyzer: that is
		// what lets it stay a pure function over a Snapshot. Authentication
		// lives in `collisionVocabulary.ts`, which is the module that may.
		const { inputs } = await graph("src/collision/collisionLexemePool.ts");
		expect(
			inputs.filter(
				(name) =>
					name.includes("analyzeSelectedSource") ||
					name.includes("manualMorphology") ||
					name.includes("projectMarkdownSource"),
			),
		).toEqual([]);
	});

	it("is reachable through the closed VIEW1 production graph", async () => {
		const { inputs } = await graph("src/SemantropyPlugin.ts", ["obsidian"]);
		expect(inputs).toContain(CORE_ENTRY);
		expect(inputs.filter((name) => name.includes("src/collision/")).sort()).toEqual(COLLISION_PRODUCTION_MODULES);
	});
});
