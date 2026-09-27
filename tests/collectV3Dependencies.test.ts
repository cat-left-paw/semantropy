import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { expect, it } from "vitest";
const pinned = JSON.parse(readFileSync("tests/fixtures/regression/collectV2Graphs.json", "utf8")) as Record<string, string[]>;
async function graph(entry: string) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm", external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs).sort(), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}
it.each(Object.keys(pinned).filter(entry => !["src/main.ts", "src/SemantropyPlugin.ts"].includes(entry)))("allows only the shared identity validator in production and v2 graphs: %s", async entry => {
	const { inputs } = await graph(entry);
	const baseline = pinned[entry]!;
	expect(inputs).toEqual([...baseline, ...(baseline.includes("src/collect/fragmentIdentity.ts") ? ["src/collect/fragmentIdentityValidation.ts"] : [])].sort());
	expect(inputs.filter(path => /\/collect\/v3\/|automaticPosVersions|maxVersions/u.test(path))).toEqual([]);
});
const common = ["analysis/rubyVocabulary", "collect/collectProvenance", "collect/fragmentIdentityValidation", "collect/v3/CollectedFragmentV3", "collect/v3/automaticPartsOfSpeech", "collect/v3/collectDataV3", "dictionary/placeholders", "path/vaultRelativePath", "random/seededRandom", "settings/semantropyRange", "transform/maxVersions", "transform/slotScore", "transform/tokenPolicy", "transform/transformTokens", "vocabulary/sha256", "vocabulary/vocabularySnapshot"];
it.each(["CollectFragmentUseCaseV3", "FragmentRepositoryV3", "automaticPartsOfSpeech"])("keeps the v3 graph pure: %s", async name => {
	const { inputs, code } = await graph(`src/collect/v3/${name}.ts`);
	const modules = name === "automaticPartsOfSpeech" ? ["collect/v3/automaticPartsOfSpeech", "collect/v3/collectDataV3"] : [...common,
		...(name === "CollectFragmentUseCaseV3" ? ["collect/fragmentIdentity", "collect/v3/CollectFragmentUseCaseV3"] : ["collect/collectionDocument", "collect/escapeFragmentMarkdown", "collect/v3/FragmentRepositoryV3", "collect/v3/serializeFragmentV3", "settings/collectionPath"])];
	expect(inputs).toEqual(modules.map(path => `src/${path}.ts`).sort());
	expect(inputs.some(path => /node_modules|obsidian|\/view\/|\/render\/|\/tokenizer\/|analyzeSelectedSource|manualMorphology|automaticPosCore|automaticPosProjection|ObsidianCollectionStorage/u.test(path))).toBe(false);
	// The sole Date constructor parses a supplied timestamp; current-time acquisition remains forbidden.
	if (name !== "automaticPartsOfSpeech") expect(code).toContain("const timestamp = Date.parse(value)");
	expect(code.replaceAll("new Date(timestamp)", "parsedDate")).not.toMatch(/Math\.random|Date\.now|new Date|crypto|getRandomValues|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|node:fs|readFile|writeFile|clipboard|localStorage|saveData|loadData|\.tokenize\(|MarkdownRenderer|console\.|resources\//u);
});
