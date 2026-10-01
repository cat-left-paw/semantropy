import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { COLLISION_PRODUCTION_MODULES } from "./support/collisionProductionGraph";

async function graph(entry: string, external: string[] = []) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true,
		platform: "neutral", format: "esm", external, legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs).sort(), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}
const ENTRY = "src/collision/collisionBatch.ts";
describe("Collision batch dependency boundary", () => {
	it("has exactly the authenticated core graph plus pure Collect provenance adapters", async () => {
		const { inputs, code } = await graph(ENTRY);
		expect(inputs).toEqual([
			"src/analysis/activeContinuation.ts", "src/analysis/locateTokens.ts", "src/analysis/projectMarkdownSource.ts", "src/analysis/reuseTargetAnalysis.ts",
			"src/analysis/rubyAnalysis.ts", "src/analysis/rubyVocabulary.ts", "src/analysis/targetChunkIr.ts", "src/application/analyzeSelectedSource.ts",
			"src/application/collectVocabulary.ts", "src/collect/collectProvenance.ts", "src/collision/collisionBatch.ts",
			"src/collision/collisionCore.ts", "src/collision/collisionLexemePool.ts", "src/collision/collisionVocabulary.ts",
			"src/collision/compilePatternSet.ts", "src/collision/patternData.ts", "src/collision/regularInflection.ts",
			"src/dictionary/placeholders.ts", "src/path/vaultRelativePath.ts", "src/random/seededRandom.ts", "src/text/enclosedTermDelimiters.ts", "src/transform/manualMorphology.ts",
			"src/transform/regularConjugationTypes.ts", "src/transform/slotScore.ts", "src/transform/tokenPolicy.ts",
			"src/transform/transformTokens.ts", "src/vocabulary/enclosedTerms.ts", "src/vocabulary/sha256.ts", "src/vocabulary/sourceWeights.ts", "src/vocabulary/vocabularySnapshot.ts",
		]);
		expect(inputs.join("\n")).not.toMatch(/node_modules|\/tokenizer\/|\/view\/|\/render\/|\/settings\/|fragmentRepository|generated\//u);
		expect(code).not.toMatch(/MarkdownRenderer|\bVault\b|TFile|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|require\(|node:fs|readFile|writeFile|resourcePath|clipboard|localStorage|saveData|loadData/u);
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\.|getRandomValues|issueUint32Seed/u);
	});
	it("calls no Source analyzer, tokenizer or Snapshot builder", async () => {
		// The registry's owning module is in the graph to authenticate an owner;
		// the controller itself never invokes the Source analysis entry points.
		const source = await readFile(ENTRY, "utf8");
		expect(source).not.toMatch(/\b(?:analyzeManualMorphSource|analyzeSelectedSource|buildManualMorphVocabulary|buildVocabularySnapshot|tokenize)\s*\(/u);
		expect(source).toContain("buildAuthenticatedCollisionLexemePool({ vocabulary, patternData: patternSet })");
		expect(source).toContain("viableCollisionRecipes(capture)");
	});
	it("connects exactly the reviewed Collision modules through the production View", async () => {
		const { inputs } = await graph("src/SemantropyPlugin.ts", ["obsidian"]);
		expect(inputs.filter((name) => name.includes("src/collision/"))).toEqual(COLLISION_PRODUCTION_MODULES);
		expect(inputs).toEqual(expect.arrayContaining(["src/view/CollisionSession.ts", "src/view/CollisionModal.ts"]));
	});
});
