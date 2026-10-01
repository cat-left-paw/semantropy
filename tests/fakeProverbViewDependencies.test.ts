import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * PRE-RELEASE-FAKE-PROVERB-VIEW1 capability boundaries. The View-owned session
 * reaches CORE1 only through BATCH1, reads the recipes as generated typed data,
 * and has no file, network, Markdown, settings, storage or tokenizer capability
 * of its own. The Modal writes generated text as text only.
 */
describe("Fake Proverb View production and capability boundaries", () => {
	it("routes the View through the session, BATCH1, the typed recipes and the Collect 4 row conversion", async () => {
		const result = await build({ entryPoints: ["src/SemantropyPlugin.ts"], bundle: true, write: false, metafile: true,
			platform: "neutral", format: "esm", external: ["obsidian"] });
		const inputs = result.metafile.inputs;
		const imports = (name: string) => inputs[name]!.imports.map(item => item.path);
		expect(imports("src/view/SemantropyView.ts")).toEqual(expect.arrayContaining(["src/view/FakeProverbSession.ts", "src/view/FakeProverbModal.ts"]));
		expect(imports("src/view/FakeProverbSession.ts").filter(name => /\/fakeProverb\/|\/collect\//u.test(name)).sort()).toEqual([
			"src/collect/collectMessages.ts", "src/collect/v4/CollectedFragmentV4.ts", "src/fakeProverb/compileRecipeSet.ts",
			"src/fakeProverb/fakeProverbBatch.ts", "src/fakeProverb/generated/standardFakeProverbRecipeEntries.ts",
		]);
		// 0.1.0 S1: the row actions are icon buttons drawn by controlIcon (Obsidian's setIcon only).
		expect(imports("src/view/FakeProverbModal.ts").filter(name => name.startsWith("src/") && !name.startsWith("src/i18n/"))).toEqual(["src/view/controlIcon.ts", "src/view/FakeProverbSession.ts"]);
		// LOCALE1: its fixed words, and nothing else, come from the interface catalog.
		expect(imports("src/view/FakeProverbModal.ts").filter(name => name.startsWith("src/i18n/")).sort()).toEqual(["src/i18n/catalog.ts", "src/i18n/messages.ts", "src/i18n/uiLabels.ts"]);
	});

	it("gives the session no runtime file, network, Markdown, settings, writer or tokenizer capability", async () => {
		const result = await build({ entryPoints: ["src/view/FakeProverbSession.ts"], bundle: true, write: false, metafile: true,
			platform: "neutral", format: "esm", legalComments: "none" });
		const code = result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
		const inputs = Object.keys(result.metafile.inputs);
		// The only settings module is the pure 0-100 range validator the v3 Collect reader uses: no store, no persistence.
		expect(inputs.filter(name => name.startsWith("src/settings/"))).toEqual(["src/settings/semantropyRange.ts"]);
		expect(inputs.filter(name => /node_modules|\/tokenizer\/|\/render\/|FragmentRepository|CollectionStorage|\.md$/u.test(name))).toEqual([]);
		expect(code).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|MarkdownRenderer|DOMParser|readFile|writeFile|readText|tokenize\(|localStorage|saveData|loadData|console\.|Math\.random|Date\.now|STANDARD_FAKE_PROVERB_RECIPE_DATA_JSON/u);
		const session = await readFile("src/view/FakeProverbSession.ts", "utf8");
		for (const method of ["createFakeProverbBatchController", "beginGenerate", "prepare", "complete", "cancel", "sourceChanged", "close", "dispose",
			"readFakeProverbRow", "fakeProverbFragmentInputFromRow"]) expect(session).toContain(`${method}(`);
		// No generator, authority or Vocabulary construction of its own.
		expect(session).not.toMatch(/\b(?:generateFakeProverbs|createFakeProverbAuthority|buildManualMorphVocabulary|analyzeManualMorphSource|fakeProverbCanonicalText)\s*\(/u);
	});

	it("renders generated text as text only and keeps private material out of the DOM, settings and logs", async () => {
		// Code only: the module's doc comment names MarkdownRenderer to say it is never used.
		const modal = (await readFile("src/view/FakeProverbModal.ts", "utf8")).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
		expect(modal).toContain("textContent");
		expect(modal).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|MarkdownRenderer|DOMParser|createContextualFragment|localStorage|console\.|nonce|operationMaterial|identityMaterial|canonicalText/u);
		const view = await readFile("src/view/SemantropyView.ts", "utf8");
		const begin = view.indexOf("private privateMaterial(): string"), end = view.indexOf("disableFakeProverb(): void", begin);
		const entry = view.slice(begin, end);
		expect(entry).toContain("new Uint8Array(32)"); expect(entry).toContain("crypto.getRandomValues(bytes)");
		expect(entry).not.toMatch(/issueUint32Seed|Math\.random|Date\.now|readCurrentText|tokenize|setDisplaySettings|saveData|console\./u);
	});
});
