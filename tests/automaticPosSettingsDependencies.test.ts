import { build } from "esbuild";
import { expect, it } from "vitest";
async function graph(entry: string) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
		external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}
const base = ["path/vaultRelativePath", "settings/semantropyRange", "settings/bodySemantropy", "settings/dictionarySemantropy", "settings/collectionPath", "settings/displaySettings", "settings/semantropySettings", "settings/settingsData", "settings/automaticPosSettings",
	// LOCALE1: schema 5 reads the closed interface-language pair from its pure leaf.
	"i18n/language"];
it.each(["automaticPosSettings", "AutomaticPosSettingsStore", "AutomaticPosSettingsController"])("has a closed settings-only graph: %s", async entry => {
	const { inputs, code } = await graph(`src/settings/${entry}.ts`);
	expect([...inputs].sort()).toEqual([...base, ...(entry === "automaticPosSettings" ? [] : [`settings/${entry}`])].map(path => `src/${path}.ts`).sort());
	expect(code).not.toMatch(/Math\.random|Date\.now|new Date|crypto|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|node:fs|readFile|writeFile|clipboard|localStorage|saveData|loadData|\.tokenize\(|MarkdownRenderer|console\./u);
	expect(inputs.some(path => /\/(?:analysis|tokenizer|vocabulary|collect|collision|dictionary|render)\/|obsidian|node_modules/u.test(path))).toBe(false);
});
it("limits the presenter to chrome and the pure schema contract", async () => {
	const { inputs, code } = await graph("src/view/AutomaticPosToolbar.ts");
	// LOCALE1: the presenter's words come from the pure catalog and are re-applied in place.
	expect([...inputs].sort()).toEqual([...base, "view/AutomaticPosToolbar", "i18n/attributionLabels", "i18n/catalog", "i18n/uiLabels"].map(path => `src/${path}.ts`).sort());
	expect(code).not.toMatch(/Chunk|DisplaySlot|saveData|loadData|\.save\(|\.tokenize\(/u);
});
it.each(["src/main.ts", "src/SemantropyPlugin.ts"])("connects schema 4 and Automatic Toolbar in production graph %s", async entry => {
	const { inputs, code } = await graph(entry);
	for (const name of ["settings/automaticPosSettings", "settings/AutomaticPosSettingsStore", "settings/AutomaticPosSettingsController", "view/AutomaticPosToolbar", "application/AutomaticPosCoordinator"]) expect(inputs).toContain(`src/${name}.ts`);
	expect(code).toContain("Automatic parts of speech");
});
