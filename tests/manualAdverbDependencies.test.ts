import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

async function graph(entry: string) {
	const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
		external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
	return { inputs: Object.keys(result.metafile.inputs), code: result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "") };
}
describe("Manual adverb ownership graph", () => {
	it.each(["src/main.ts", "src/SemantropyPlugin.ts"])("is connected through both authorities from %s", async entry => {
		const { inputs } = await graph(entry);
		expect(inputs).toContain("src/transform/manualMorphology.ts");
		expect(inputs).toContain("src/transform/manualAdverbAuthority.ts");
		expect(inputs).toContain("src/transform/manualAdverbController.ts");
	});
	it.each(["src/transform/manualAdverbAuthority.ts", "src/transform/manualAdverbController.ts"])("authenticates through the existing owner without forbidden capabilities: %s", async entry => {
		const { inputs, code } = await graph(entry);
		expect(inputs).toContain("src/transform/manualMorphology.ts");
		// The existing owner registry lives beside its pure analyzer. Emission must not include that analyzer's tokenizer invocation.
		expect(inputs).toContain("src/application/analyzeSelectedSource.ts");
		for (const path of inputs) expect(path).not.toMatch(/node_modules|obsidian|\/view\/|\/render\/|\/collect\/|\/copy\/|\/settings\/|\/collision\/|lindera|\/tokenizer\//u);
		// Snapshot's pure projection uses this one leaf; no Dictionary generator or presenter is reachable.
		expect(inputs.filter(path => path.includes("/dictionary/"))).toEqual(["src/dictionary/placeholders.ts"]);
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\.|crypto|getRandomValues|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|node:fs|readFile|writeFile|clipboard|localStorage|saveData|loadData|\.tokenize\(|MarkdownRenderer|console\./u);
		expect(code).not.toMatch(/resources\/|dict\.words|runtime.*Markdown/u);
		const seams = entry.endsWith("Authority.ts")
			? ["buildAdverbObservationIndex", "adverbBridgeCapabilities", "TO_OPTIONAL_ADVERB_BRIDGE_PROFILE"] : [];
		for (const seam of [...seams, "classifyAdverbCandidate", "observeAdverbSlot", "evaluateAdverbCandidate", "isToOptionalAdverb"])
			expect(code).toContain(seam);
	});
	it("keeps grammar and inflection decisions out of the ownership and transaction modules", async () => {
		for (const name of ["manualAdverbAuthority", "manualAdverbController", "manualAdverbGuard"]) {
			const source = await readFile(`src/transform/${name}.ts`, "utf8");
			expect(source).not.toMatch(/sentence-modifier|verb-predicate|adjective-predicate|助詞類接続|助動詞|五段|endsWith\("と"\)|detail1\s*===|conjugationForm\s*===/u);
		}
	});
});
