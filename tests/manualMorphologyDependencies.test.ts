import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const CORE = "src/transform/manualMorphology.ts";

describe("Manual morphology pure-core dependency boundary", () => {
	it("has no Obsidian, DOM, Vault, renderer, resource or filesystem dependency", async () => {
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
		// Sources enter only through the production, non-rendering Source
		// analyzer; that dependency is the provenance anchor, not an accident.
		expect(inputs).toContain("src/application/analyzeSelectedSource.ts");
		const code = result.outputFiles[0]!.text.replace(
			/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu,
			"",
		);
		expect(code).not.toMatch(
			/MarkdownRenderer|postProcess|\bVault\b|TFile|fetch\(|XMLHttpRequest|WebSocket|DOMParser|new Image|document\.(?:create|query|body|write)|window\.|require\(|node:fs|resourcePath|createObjectURL/u,
		);
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\./u);
	});

	it("is connected through the production entry points by MANUAL-MORPH2", async () => {
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
		}
	});
});
