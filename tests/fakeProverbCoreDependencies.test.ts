import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { applyExperienceDelta } from "./support/experienceVocabularyGraph";

/**
 * PRE-RELEASE-FAKE-PROVERB-CORE1 boundaries, read from the module graph. The
 * core is production-disconnected: no production entry reaches it, and its own
 * graph is a closed set with no UI, storage, Clipboard, network, clock, random
 * source, Collision module or tokenizer call in its emitted code.
 */
async function graph(entry: string) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
		external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs).sort(), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}

// COLLECT1 moved the safe text grammar and canonical serializer into the pure fakeProverbText leaf.
const CORE1_MODULES = ["fakeProverbAuthority", "fakeProverbCore", "fakeProverbText", "fakeProverbVersions"].map((name) => `src/fakeProverb/${name}.ts`);
const SHARED = ["analysis/activeContinuation", "analysis/locateTokens", "analysis/projectMarkdownSource", "analysis/reuseTargetAnalysis",
	"analysis/rubyAnalysis", "analysis/rubyVocabulary", "analysis/targetChunkIr", "application/analyzeSelectedSource", "dictionary/placeholders",
	"fakeProverb/compileRecipeSet", "fakeProverb/recipeData", "random/seededRandom", "transform/manualMorphology", "transform/maxRealizer",
	"transform/regularConjugationTypes", "transform/slotScore", "transform/tokenPolicy", "transform/transformTokens", "vocabulary/sha256",
	"vocabulary/vocabularySnapshot"].map((name) => `src/${name}.ts`);

describe("FAKE-PROVERB-CORE1 dependency boundary", () => {
	// Production-disconnected in CORE1; FAKE-PROVERB-VIEW1 reaches the authority and core only through BATCH1.
	it.each(["src/main.ts", "src/SemantropyPlugin.ts"])("is reached from production only through the batch owner: %s", async (entry) => {
		const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
			external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
		const inputs = result.metafile.inputs;
		const pinned = JSON.parse(await readFile("tests/fixtures/regression/fakeProverbViewGraphs.json", "utf8")) as Record<string, string[]>;
		expect(Object.keys(inputs).sort()).toEqual(applyExperienceDelta(pinned[entry]!));
		const importersOf = (target: string) => Object.keys(inputs).filter((name) => inputs[name]!.imports.some((item) => item.path === target)).sort();
		expect(importersOf("src/fakeProverb/fakeProverbCore.ts")).toEqual(["src/fakeProverb/fakeProverbBatch.ts"]);
		expect(importersOf("src/fakeProverb/fakeProverbAuthority.ts")).toEqual(["src/fakeProverb/fakeProverbBatch.ts", "src/fakeProverb/fakeProverbCore.ts"]);
	});

	it.each([
		["src/fakeProverb/fakeProverbCore.ts", [...SHARED, ...CORE1_MODULES]],
		["src/fakeProverb/fakeProverbAuthority.ts", [...SHARED, ...CORE1_MODULES.filter((path) => !path.endsWith("fakeProverbCore.ts"))]],
		["src/fakeProverb/fakeProverbVersions.ts", ["src/fakeProverb/fakeProverbVersions.ts"]],
		["src/fakeProverb/fakeProverbText.ts", ["src/fakeProverb/fakeProverbText.ts"]],
	] as const)("has a closed, pure graph: %s", async (entry, expected) => {
		const { inputs, code } = await graph(entry);
		expect(inputs).toEqual([...expected].sort());
		for (const path of inputs) {
			expect(path).not.toMatch(/node_modules|obsidian|\/view\/|\/render\/|\/collect\/|\/copy\/|\/settings\/|\/collision\/|lindera|\/tokenizer\/|generated\/|tests\/|scripts\//u);
		}
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\.|crypto|getRandomValues|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|node:fs|readFile|writeFile|clipboard|localStorage|saveData|loadData|\.tokenize\(|MarkdownRenderer|console\./u);
		expect(code).not.toMatch(/resources\/|\.md["']|standard-recipes/u);
	});

	it("keeps conjugation rules in the realizer leaf, never in the authority or core", async () => {
		for (const name of ["fakeProverbAuthority", "fakeProverbCore"]) {
			const source = (await readFile(`src/fakeProverb/${name}.ts`, "utf8")).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
			expect(source).not.toMatch(/五段|一段|形容詞・|baseEnding|taStem|taVoicing|endsWith\(|slice\(0, -/u);
		}
		const authority = await readFile("src/fakeProverb/fakeProverbAuthority.ts", "utf8");
		// Of the MAX modules, only the pure realizer leaf: never the Body-bound projection, core, level or bridge.
		expect(authority.match(/from\s+["'][^"']*\/max[A-Z]\w*["']/gu)).toEqual(['from "../transform/maxRealizer"']);
		expect(await readFile("src/fakeProverb/fakeProverbCore.ts", "utf8")).not.toMatch(/\/max[A-Z]/u);
		for (const seam of ["realizeMaxLexeme", "maxLexemeIdentity", "maxSlotClassOf", "MAX_REALIZER_RULES", "isManualMorphVocabulary", "readManualMorphVocabularySources"]) {
			expect(authority).toContain(seam);
		}
	});

	it("is imported only inside src/fakeProverb, and imports nothing from tests or scripts", async () => {
		const importers: string[] = [];
		for (const name of (await readdir("src", { recursive: true })).filter((item) => item.endsWith(".ts"))) {
			const path = `src/${name.replaceAll("\\", "/")}`;
			const source = await readFile(path, "utf8");
			expect(source, path).not.toMatch(/from\s+["'][^"']*(?:tests|scripts)\//u);
			if (/from\s+["'][^"']*fakeProverb(?:Authority|Core|Versions)["']/u.test(source)) importers.push(path);
		}
		// BATCH1 adds the batch owner, the only module outside CORE1 that uses the authority and core.
		// COLLECT1 adds Collect metadata 4, which reads only the algorithm version constant.
		expect(importers.sort()).toEqual(["src/collect/v4/CollectedFragmentV4.ts", "src/fakeProverb/fakeProverbAuthority.ts", "src/fakeProverb/fakeProverbBatch.ts", "src/fakeProverb/fakeProverbCore.ts"]);
		expect((await readFile("src/collect/v4/CollectedFragmentV4.ts", "utf8")).match(/from\s+["'][^"']*fakeProverb(?:Authority|Core|Versions)["']/gu)).toEqual(['from "../../fakeProverb/fakeProverbVersions"']);
	});
});
