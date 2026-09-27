import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const CORE = "src/analysis/displaySlots.ts";

describe("DisplaySlot pure-core dependency boundary", () => {
	it("has no Obsidian, DOM, Vault, renderer, view dependency; authentication reaches the pure morphology registry", async () => {
		const result = await build({
			entryPoints: [CORE],
			bundle: true,
			write: false,
			metafile: true,
			platform: "neutral",
			format: "esm",
			legalComments: "none",
		});
		const inputs = Object.keys(result.metafile.inputs);
		for (const name of inputs) {
			expect(name).not.toMatch(
				/obsidian|node_modules|\/render\/|\/view\/|SemantropySession|SourceSnapshot|selectSourceText|prepareVocabulary|lindera/u,
			);
		}
		expect(inputs).toContain("src/vocabulary/vocabularySnapshot.ts");
		expect(inputs).toContain("src/dictionary/headword.ts");
		expect(inputs).toContain("src/transform/manualMorphology.ts");
		const code = result.outputFiles[0]!.text.replace(
			/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu,
			"",
		);
		expect(code).not.toMatch(
			/MarkdownRenderer|postProcess|\bVault\b|TFile|fetch\(|XMLHttpRequest|WebSocket|DOMParser|new Image|document\.(?:create|query|body|write)|window\.|require\(|node:fs|resourcePath|createObjectURL|HTMLElement|innerHTML/u,
		);
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\./u);
	});

	it("is reachable with Manual Morph while prototype cores stay disconnected", async () => {
		for (const entryPoint of ["src/main.ts", "src/SemantropyPlugin.ts"]) {
			const result = await build({
				entryPoints: [entryPoint],
				bundle: true,
				write: false,
				metafile: true,
				platform: "neutral",
				format: "esm",
				external: ["obsidian", "virtual:semantropy-lindera-*"],
				legalComments: "none",
			});
			expect(Object.keys(result.metafile.inputs)).toContain(CORE);
   expect(Object.keys(result.metafile.inputs)).toContain("src/transform/manualMorphology.ts");
   expect(Object.keys(result.metafile.inputs).join(" ")).not.toMatch(/rubyBodyRenderer|buildAnalysisDocument/);
			expect(result.outputFiles[0]!.text).toMatch(/display-slots-1/u);
   expect(result.outputFiles[0]!.text).not.toMatch(/analyzeSafeTarget|planSafeTarget|buildLegacyTargetDisplay|class TargetBodyController/);
		}
	});

	it("does not search source text with indexOf", async () => {
		const source = await readFile(CORE, "utf8");
		expect(source).not.toMatch(/indexOf/u);
		expect(source).not.toMatch(/lastIndexOf/u);
	});
});
