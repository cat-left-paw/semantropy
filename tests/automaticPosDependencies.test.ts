import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { applyFakeProverbViewDelta } from "./support/fakeProverbViewGraph";
import { applyExperienceDelta } from "./support/experienceVocabularyGraph";
async function graph(entry: string) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
		external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}
it.each(["src/main.ts", "src/SemantropyPlugin.ts"])("no longer reaches the Body 10 core from production after MAX-VIEW1: %s", async entry => {
	// The reviewed VIEW1 graph (automaticPosViewGraphs.json) is historical. MAX-VIEW1 replaced exactly the three
	// Body 10 modules with the six MAX-CORE1 modules; Body 10 stays in src only as a comparison oracle.
	// FAKE-PROVERB-VIEW1 then applied its own pinned delta (tests/support/fakeProverbViewGraph.ts), and
	// EXPERIENCE-VOCABULARY1 its own (tests/support/experienceVocabularyGraph.ts).
	const { inputs } = await graph(entry);
	const view1 = JSON.parse(await readFile("tests/fixtures/regression/automaticPosViewGraphs.json", "utf8")) as Record<string, string[]>;
	const body10 = ["automaticPosCore", "automaticPosProjection", "automaticPosVersions"].map(name => `src/transform/${name}.ts`);
	const max = ["maxAdverbBridge", "maxCore", "maxLevel", "maxProjection", "maxRealizer", "maxVersions"].map(name => `src/transform/${name}.ts`);
	expect([...inputs].sort()).toEqual(applyExperienceDelta(applyFakeProverbViewDelta([...view1[entry]!.filter(path => !body10.includes(path)), ...max])));
	for (const path of body10) expect(inputs).not.toContain(path);
});
it.each(["src/transform/automaticPosProjection.ts", "src/transform/automaticPosCore.ts"])("has a pure authenticated graph without retokenization: %s", async entry => {
	const { inputs, code } = await graph(entry);
	const expected = ["adverb/adverbBridgeProfile", "adverb/adverbCapability", "adverb/adverbFamily", "adverb/adverbObservation",
		"analysis/activeContinuation", "analysis/locateTokens", "analysis/projectMarkdownSource", "analysis/rubyAnalysis", "analysis/rubyVocabulary", "analysis/reuseTargetAnalysis", "analysis/targetChunkIr",
		"application/analyzeSelectedSource", "dictionary/placeholders", "random/seededRandom", "transform/automaticPosGuard", "transform/automaticPosProjection",
		"transform/manualAdverbAuthority", "transform/manualAdverbGuard", "transform/manualMorphology", "transform/regularConjugationTypes",
		"transform/automaticPosVersions", "transform/slotScore", "transform/tokenPolicy", "transform/transformTokens", "vocabulary/sha256", "vocabulary/vocabularySnapshot",
		...(entry.endsWith("Core.ts") ? ["transform/automaticPosCore"] : [])].map(name => `src/${name}.ts`).sort();
	expect([...inputs].sort()).toEqual(expected);
	expect(inputs).toContain("src/transform/manualMorphology.ts"); expect(inputs).toContain("src/transform/manualAdverbAuthority.ts");
	// Registry and Source analyzer share a module; emitted code proves the distinct no-retokenization claim.
	expect(inputs).toContain("src/application/analyzeSelectedSource.ts");
	for (const path of inputs) expect(path).not.toMatch(/node_modules|obsidian|\/view\/|\/render\/|\/collect\/|\/copy\/|\/settings\/|\/collision\/|lindera|\/tokenizer\//u);
	expect(inputs.filter(path => path.includes("/dictionary/"))).toEqual(["src/dictionary/placeholders.ts"]);
	expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\.|crypto|getRandomValues|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|node:fs|readFile|writeFile|clipboard|localStorage|saveData|loadData|\.tokenize\(|MarkdownRenderer|console\./u);
	expect(code).not.toMatch(/resources\/|dict\.words/u);
	expect(code).toContain("inspectManualAdverbOwner");
	if (entry.endsWith("Core.ts")) {
		for (const seam of ["evaluateManualMorphSlot", "evaluateManualAdverbSlot", "transformWithVocabularySnapshot", "isSlotApplied"])
			expect(code).toContain(seam);
	}
});
it("keeps morphology interpretation and inflection out of Automatic modules", async () => {
	for (const name of ["automaticPosProjection", "automaticPosCore", "automaticPosGuard"]) {
		const source = await readFile(`src/transform/${name}.ts`, "utf8");
		expect(source).not.toMatch(/sentence-modifier|verb-predicate|adjective-predicate|助詞類接続|助動詞|五段|endsWith\("と"\)|detail1\s*===|conjugationForm\s*===/u);
	}
});
