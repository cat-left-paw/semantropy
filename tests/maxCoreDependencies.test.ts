import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { applyFakeProverbViewDelta } from "./support/fakeProverbViewGraph";
import { applyExperienceDelta } from "./support/experienceVocabularyGraph";

/**
 * PRE-RELEASE-MAX-CORE1 boundaries, read from the module graph.
 *
 * CORE1 was production-disconnected; PRE-RELEASE-MAX-VIEW1 connected it. The
 * production graph is now pinned in `maxViewGraphs.json`, and only the five
 * reviewed wiring modules import the core. The core's own graph is a closed,
 * pinned set with no UI, storage, Clipboard, network, clock or random source,
 * and no tokenizer call in its emitted code.
 */
// PRE-RELEASE-FAKE-PROVERB-CORE1 adds the production-disconnected Fake Proverb authority, which may import only the
// pure `maxRealizer` leaf (pinned below and in fakeProverbCoreDependencies.test.ts).
const WIRING = ["src/analysis/displaySlots.ts", "src/application/bodyFragmentFromAutomatic.ts", "src/collect/v3/CollectedFragmentV3.ts",
	"src/fakeProverb/fakeProverbAuthority.ts", "src/render/automaticPosBodyOwner.ts", "src/render/chunkTargetBodyController.ts"];
async function graph(entry: string) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
		external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs).sort(), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}
const CORE1_MODULES = ["maxAdverbBridge", "maxCore", "maxLevel", "maxProjection", "maxRealizer", "maxVersions"].map(name => `src/transform/${name}.ts`);
const SHARED = ["adverb/adverbBridgeProfile", "adverb/adverbCapability", "adverb/adverbFamily", "adverb/adverbObservation",
	"analysis/activeContinuation", "analysis/locateTokens", "analysis/projectMarkdownSource", "analysis/reuseTargetAnalysis", "analysis/rubyAnalysis",
	"analysis/rubyVocabulary", "analysis/targetChunkIr", "application/analyzeSelectedSource", "dictionary/placeholders", "random/seededRandom",
	"transform/automaticPosGuard", "transform/manualAdverbAuthority", "transform/manualAdverbGuard", "transform/manualMorphology",
	"transform/regularConjugationTypes", "transform/slotScore", "transform/tokenPolicy", "transform/transformTokens", "vocabulary/sha256",
	"vocabulary/vocabularySnapshot"].map(name => `src/${name}.ts`);

describe("MAX-CORE1 dependency boundary", () => {
	it.each(["src/main.ts", "src/SemantropyPlugin.ts"])("connects the exact MAX-VIEW1 production graph, as FAKE-PROVERB-VIEW1 extended it: %s", async entry => {
		const { inputs } = await graph(entry);
		const expected = JSON.parse(await readFile("tests/fixtures/regression/fakeProverbViewGraphs.json", "utf8")) as Record<string, string[]>;
		const maxView = JSON.parse(await readFile("tests/fixtures/regression/maxViewGraphs.json", "utf8")) as Record<string, string[]>;
		expect([...inputs].sort()).toEqual(applyExperienceDelta(expected[entry]!));
		expect(applyFakeProverbViewDelta(maxView[entry]!)).toEqual(expected[entry]);
		expect(inputs.filter(path => /\/max[A-Z]/u.test(path)).sort()).toEqual(CORE1_MODULES);
		expect(inputs.filter(path => /tests\/|scripts\/|automaticPos(?:Core|Projection|Versions)\.ts/u.test(path))).toEqual([]);
	});
	it("adds exactly six production-disconnected modules under src/, and none under src/adverb", async () => {
		const names = (await readdir("src", { recursive: true })).map(name => `src/${name.replaceAll("\\", "/")}`);
		expect(names.filter(name => /\/max[A-Z][^/]*\.ts$/u.test(name)).sort()).toEqual(CORE1_MODULES);
		// ADVERB-SPIKE1's four reviewed modules stay the only ones under src/adverb.
		expect(names.filter(name => name.startsWith("src/adverb/")).length).toBe(4);
	});
	it.each([
		["src/transform/maxCore.ts", [...SHARED, ...CORE1_MODULES]],
		["src/transform/maxAdverbBridge.ts", ["src/transform/maxAdverbBridge.ts", "src/adverb/adverbFamily.ts", "src/adverb/adverbObservation.ts",
			"src/analysis/rubyVocabulary.ts", "src/random/seededRandom.ts", "src/transform/slotScore.ts", "src/transform/tokenPolicy.ts", "src/transform/transformTokens.ts"]],
		["src/transform/maxProjection.ts", [...SHARED, ...CORE1_MODULES.filter(path => !/maxCore|maxLevel|maxAdverbBridge/u.test(path))]],
		["src/transform/maxRealizer.ts", ["src/transform/maxRealizer.ts", "src/transform/regularConjugationTypes.ts"]],
		["src/transform/maxLevel.ts", ["src/random/seededRandom.ts", "src/transform/maxLevel.ts", "src/transform/slotScore.ts", "src/vocabulary/sha256.ts"]],
		["src/transform/maxVersions.ts", ["src/transform/maxVersions.ts"]],
	] as const)("has a closed pure graph: %s", async (entry, expected) => {
		const { inputs, code } = await graph(entry);
		expect(inputs).toEqual([...expected].sort());
		for (const path of inputs) expect(path).not.toMatch(/node_modules|obsidian|\/view\/|\/render\/|\/collect\/|\/copy\/|\/settings\/|\/collision\/|lindera|\/tokenizer\/|automaticPos(?:Core|Projection|Versions)|tests\/|scripts\//u);
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\.|crypto|getRandomValues|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|node:fs|readFile|writeFile|clipboard|localStorage|saveData|loadData|\.tokenize\(|MarkdownRenderer|console\./u);
		expect(code).not.toMatch(/resources\/|dict\.words|\.md["']/u);
	});
	it("delegates strict to the reviewed authorities and keeps morphology rules in the realizer leaf", async () => {
		const { code } = await graph("src/transform/maxCore.ts");
		for (const seam of ["evaluateManualMorphSlot", "evaluateManualAdverbSlot", "transformWithVocabularySnapshot", "isSlotApplied", "manualMorphConnection", "inspectManualAdverbOwner", "adverbSurfaceEndsWithTo"])
			expect(code).toContain(seam);
		for (const name of ["maxCore", "maxProjection", "maxLevel"]) {
			const source = await readFile(`src/transform/${name}.ts`, "utf8");
			expect(source).not.toMatch(/sentence-modifier|verb-predicate|助詞類接続|五段|一段|形容詞・|endsWith\("と"\)|conjugationForm\s*===|baseEnding/u);
		}
	});
	it("is imported only by the reviewed wiring modules, and imports nothing from tests or scripts", async () => {
		const importers: string[] = [];
		for (const name of (await readdir("src", { recursive: true })).filter(item => item.endsWith(".ts"))) {
			const path = `src/${name.replaceAll("\\", "/")}`, source = await readFile(path, "utf8");
			expect(source, path).not.toMatch(/from\s+["'][^"']*(?:tests|scripts)\//u);
			if (!CORE1_MODULES.includes(path) && /from\s+["']\.\/max[A-Z]|from\s+["'][^"']*\/transform\/max[A-Z]/u.test(source)) importers.push(path);
		}
		expect(importers.sort()).toEqual(WIRING);
	});
});
