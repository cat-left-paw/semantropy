import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("Vocabulary Snapshot pure-core dependency boundary", () => {
	it("has no Obsidian, DOM, Vault, renderer, resource or filesystem dependency", async () => {
		const result = await build({
			entryPoints: ["src/vocabulary/vocabularySnapshot.ts"],
			bundle: true,
			write: false,
			metafile: true,
			platform: "neutral",
			format: "esm",
			legalComments: "none",
		});
		for (const name of Object.keys(result.metafile.inputs)) {
			expect(name).not.toMatch(
				/obsidian|node_modules|\/render\/|SemantropyView|SemantropySession|SourceSnapshot|projectMarkdownSource|analyzeSelectedSource/u,
			);
		}
		const code = result.outputFiles[0]!.text.replace(
			/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu,
			"",
		);
		expect(code).not.toMatch(
			/MarkdownRenderer|MarkdownPreviewRenderer|postProcess|\bVault\b|TFile|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|require\(|node:fs|resourcePath|createObjectURL/u,
		);
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\./u);
	});

	it("is connected to production through the approved integration seam", async () => {
		const result = await build({
			entryPoints: ["src/SemantropyPlugin.ts"],
			bundle: true,
			write: false,
			metafile: true,
			platform: "neutral",
			format: "esm",
			external: ["obsidian"],
			legalComments: "none",
		});
		expect(
			Object.keys(result.metafile.inputs).filter((name) =>
				name.endsWith("src/vocabulary/vocabularySnapshot.ts"),
			),
		).toEqual(["src/vocabulary/vocabularySnapshot.ts"]);
	});
});
