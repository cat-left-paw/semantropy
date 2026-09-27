import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { applyExperienceDelta } from "./support/experienceVocabularyGraph";

/**
 * PRE-RELEASE-FAKE-PROVERB-BATCH1 boundaries. The batch owner is
 * production-disconnected, reaches CORE1 and nothing past it, and has no DOM,
 * Clipboard, Vault, network, clock, entropy source, scheduler, Collect or
 * settings dependency in its graph or emitted code.
 */
async function graph(entry: string) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
		external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs).sort(), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}

const CORE_GRAPH = ["analysis/activeContinuation", "analysis/locateTokens", "analysis/projectMarkdownSource", "analysis/reuseTargetAnalysis",
	"analysis/rubyAnalysis", "analysis/rubyVocabulary", "analysis/targetChunkIr", "application/analyzeSelectedSource", "dictionary/placeholders",
	"fakeProverb/compileRecipeSet", "fakeProverb/fakeProverbAuthority", "fakeProverb/fakeProverbCore", "fakeProverb/fakeProverbVersions",
	"fakeProverb/fakeProverbText", "fakeProverb/recipeData", "random/seededRandom", "transform/manualMorphology", "transform/maxRealizer", "transform/regularConjugationTypes",
	"transform/slotScore", "transform/tokenPolicy", "transform/transformTokens", "vocabulary/sha256", "vocabulary/vocabularySnapshot"].map((name) => `src/${name}.ts`);

describe("FAKE-PROVERB-BATCH1 dependency boundary", () => {
	// Production-disconnected in BATCH1; FAKE-PROVERB-VIEW1 reaches it only through the View-owned session.
	it.each(["src/main.ts", "src/SemantropyPlugin.ts"])("is reached from production only through FakeProverbSession: %s", async (entry) => {
		const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
			external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
		const inputs = result.metafile.inputs;
		const pinned = JSON.parse(await readFile("tests/fixtures/regression/fakeProverbViewGraphs.json", "utf8")) as Record<string, string[]>;
		expect(Object.keys(inputs).sort()).toEqual(applyExperienceDelta(pinned[entry]!));
		const importers = Object.keys(inputs).filter((name) => inputs[name]!.imports.some((item) => item.path === "src/fakeProverb/fakeProverbBatch.ts"));
		expect(importers).toEqual(["src/view/FakeProverbSession.ts"]);
	});

	it("has a closed graph: CORE1 plus the batch owner, no Collect, view or storage", async () => {
		const { inputs, code } = await graph("src/fakeProverb/fakeProverbBatch.ts");
		expect(inputs).toEqual([...CORE_GRAPH, "src/fakeProverb/fakeProverbBatch.ts"].sort());
		for (const path of inputs) {
			expect(path).not.toMatch(/node_modules|obsidian|\/view\/|\/render\/|\/collect\/|\/copy\/|\/settings\/|\/collision\/|\/application\/(?!analyzeSelectedSource)|lindera|\/tokenizer\/|generated\/|tests\/|scripts\//u);
		}
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\.|crypto|getRandomValues|setTimeout|setInterval|queueMicrotask|requestAnimationFrame|fetch\(|XMLHttpRequest|WebSocket|document\.|window\.|navigator\.|node:fs|readFile|writeFile|clipboard|localStorage|saveData|loadData|\.tokenize\(|MarkdownRenderer|console\./u);
		expect(code).not.toMatch(/metadataVersion|collection|resources\/|\.md["']/iu);
	});

	it("is imported at runtime by FakeProverbSession alone; Collect 4 names only the row record type", async () => {
		for (const name of (await readdir("src", { recursive: true })).filter((item) => item.endsWith(".ts"))) {
			const path = `src/${name.replaceAll("\\", "/")}`;
			if (path === "src/fakeProverb/fakeProverbBatch.ts") continue;
			const source = await readFile(path, "utf8");
			if (path === "src/collect/v4/CollectedFragmentV4.ts") {
				// COLLECT1: a type-only import of the row record, erased at build time.
				expect(source.match(/^import[^;]*fakeProverbBatch[^;]*;/gmu)).toEqual(['import type { FakeProverbRowRecord } from "../../fakeProverb/fakeProverbBatch";']);
				expect((await graph(path)).inputs).not.toContain("src/fakeProverb/fakeProverbBatch.ts");
				continue;
			}
			if (path === "src/view/FakeProverbModal.ts") {
				// FAKE-PROVERB-VIEW1 review 1: publishBatch() names the batch type only; the Modal calls no BATCH1 function.
				expect(source.match(/^import[^;]*fakeProverbBatch[^;]*;/gmu)).toEqual(['import type { FakeProverbBatch } from "../fakeProverb/fakeProverbBatch";']);
				expect(source).not.toMatch(/createFakeProverbBatchController|readFakeProverbRow/u);
				continue;
			}
			if (path === "src/view/FakeProverbSession.ts") {
				// FAKE-PROVERB-VIEW1: the View-owned session, the only runtime importer.
				expect(source.match(/from\s+["'][^"']*fakeProverbBatch["']/gu)).toEqual(['from "../fakeProverb/fakeProverbBatch"']);
				continue;
			}
			expect(source, path).not.toMatch(/fakeProverbBatch/u);
		}
	});
});
