import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { applyExperienceDelta } from "./support/experienceVocabularyGraph";

/**
 * PRE-RELEASE-FAKE-PROVERB-COLLECT1 boundaries. Collect metadata 4 is
 * production-disconnected: no production entry reaches it, its graph reuses
 * the reviewed v3 contract plus the pure Fake Proverb version / schema / text
 * leaves, and never the Fake Proverb authority, core, batch owner, generated
 * recipes, a View, a tokenizer or a storage adapter.
 */
async function graph(entry: string) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
		external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs).sort(), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}

const V3_COMMON = ["analysis/rubyVocabulary", "collect/collectProvenance", "collect/fragmentIdentityValidation", "collect/v3/CollectedFragmentV3",
	"collect/v3/automaticPartsOfSpeech", "collect/v3/collectDataV3", "dictionary/placeholders", "path/vaultRelativePath", "random/seededRandom",
	"settings/semantropyRange", "transform/maxVersions", "transform/slotScore", "transform/tokenPolicy", "transform/transformTokens",
	"vocabulary/sha256", "vocabulary/sourceWeights", "vocabulary/vocabularySnapshot"];
const V4_COMMON = [...V3_COMMON, "collect/v4/CollectedFragmentV4", "collect/v4/collectDataV4", "fakeProverb/fakeProverbText",
	"fakeProverb/fakeProverbVersions", "fakeProverb/recipeData",
	// 0.1.0 S5: metadata 5 validates a recompose entry against the pure Recompose versions leaf, not the generator.
	"recompose/recomposeVersions"];
const SERIALIZER = ["collect/escapeFragmentMarkdown", "collect/v3/serializeFragmentV3", "collect/v4/serializeFragmentV4",
	"collect/v4/collectAttribution", "i18n/attributionLabels"];
const EXPECTED: Record<string, readonly string[]> = {
	collectDataV4: ["collect/v3/collectDataV3", "collect/v4/collectDataV4"],
	CollectedFragmentV4: V4_COMMON,
	collectAttribution: ["collect/escapeFragmentMarkdown", "collect/v4/collectAttribution", "i18n/attributionLabels"],
	serializeFragmentV4: [...V4_COMMON, ...SERIALIZER],
	CollectFragmentUseCaseV4: [...V4_COMMON, "collect/fragmentIdentity", "collect/v4/CollectFragmentUseCaseV4"],
	FragmentRepositoryV4: [...V4_COMMON, ...SERIALIZER, "collect/collectionDocument", "collect/v4/FragmentRepositoryV4", "settings/collectionPath"],
};

describe("FAKE-PROVERB-COLLECT1 dependency boundary", () => {
	// Production-disconnected in COLLECT1; FAKE-PROVERB-VIEW1 made it the live writer for every type.
	it.each(["src/main.ts", "src/SemantropyPlugin.ts"])("is the production Collect writer since FAKE-PROVERB-VIEW1: %s", async (entry) => {
		const { inputs, code } = await graph(entry);
		const pinned = JSON.parse(await readFile("tests/fixtures/regression/fakeProverbViewGraphs.json", "utf8")) as Record<string, string[]>;
		expect([...inputs].sort()).toEqual(applyExperienceDelta(pinned[entry]!));
		expect(inputs.filter((path) => path.startsWith("src/collect/v4/"))).toEqual(Object.keys(EXPECTED).map((name) => `src/collect/v4/${name}.ts`).sort());
		// The metadata 3 use case and repository are no longer live; v4 still delegates to the v3 reader and serializer.
		expect(inputs.filter((path) => /\/collect\/v3\/(?:CollectFragmentUseCaseV3|FragmentRepositoryV3)\.ts$/u.test(path))).toEqual([]);
		expect(code).toContain("fake-proverb");
	});

	it.each(Object.keys(EXPECTED))("has a closed, pure graph: %s", async (name) => {
		const { inputs, code } = await graph(`src/collect/v4/${name}.ts`);
		expect(inputs).toEqual(EXPECTED[name]!.map((path) => `src/${path}.ts`).sort());
		expect(inputs.some((path) => /node_modules|obsidian|\/view\/|\/render\/|\/tokenizer\/|\/collision\/|analyzeSelectedSource|manualMorphology|automaticPos|fakeProverb(?:Authority|Core|Batch)|compileRecipeSet|generated\/|ObsidianCollectionStorage|lindera/u.test(path))).toBe(false);
		// The sole Date constructor parses a supplied timestamp; current-time acquisition remains forbidden.
		expect(code.replaceAll("new Date(timestamp)", "parsedDate")).not.toMatch(/Math\.random|Date\.now|new Date|performance\.|crypto|getRandomValues|setTimeout|setInterval|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|node:fs|readFile|writeFile|clipboard|localStorage|saveData|loadData|\.tokenize\(|MarkdownRenderer|console\.|resources\//u);
	});

	it("is imported only by the plugin writer and the Collect callers, and the v3 modules never import it", async () => {
		const importers: string[] = [];
		for (const name of (await readdir("src", { recursive: true })).filter((item) => item.endsWith(".ts"))) {
			const path = `src/${name.replaceAll("\\", "/")}`;
			if (path.startsWith("src/collect/v4/")) continue;
			if (/from\s+["'][^"']*(?:collect\/v4\/|\.\/v4\/)/u.test(await readFile(path, "utf8"))) importers.push(path);
		}
		expect(importers.sort()).toEqual(["src/SemantropyPlugin.ts", "src/application/bodyFragmentFromAutomatic.ts", "src/collect/collectMessages.ts",
			"src/view/CollisionSession.ts", "src/view/FakeProverbSession.ts", "src/view/RecomposeModal.ts", "src/view/SemantropyView.ts"]);
		expect(importers.filter((path) => path.startsWith("src/collect/v3/"))).toEqual([]);
	});
});
