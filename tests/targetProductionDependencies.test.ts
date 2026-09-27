import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const LEGACY_RENDER_PATH = [
	"markdownBodyController", "rubyBodyRenderer", "renderMarkdownSnapshot", "applySnapshotToBody",
	"transformDetachedBody", "buildAnalysisDocument", "collectTextNodes", "safeTargetPrototype",
];

describe("production Target dependency boundary", () => {
	it("the plugin bundle reaches the safe Target controller and no MarkdownRenderer path", async () => {
		const result = await build({
			entryPoints: ["src/SemantropyPlugin.ts"], bundle: true, write: false, metafile: true,
			platform: "neutral", format: "esm", external: ["obsidian"], legalComments: "none",
		});
		const inputs = Object.keys(result.metafile.inputs);
		for (const legacy of LEGACY_RENDER_PATH) expect(inputs.filter((name) => name.includes(legacy))).toEqual([]);
		expect(inputs.some((name) => name.endsWith("src/render/targetBodyController.ts"))).toBe(true);
		const code = result.outputFiles[0]!.text;
		expect(code).not.toMatch(/MarkdownRenderer|registerMarkdownPostProcessor|MarkdownPreviewRenderer|DOMParser|insertAdjacentHTML|createContextualFragment|\.innerHTML\s*=|\.outerHTML\s*=/u);
	});

	it("the Target controller itself has no Obsidian, renderer, resource or HTML-string capability", async () => {
		const result = await build({
			entryPoints: ["src/render/targetBodyController.ts"], bundle: true, write: false, metafile: true,
			platform: "neutral", format: "esm", legalComments: "none",
		});
		for (const name of Object.keys(result.metafile.inputs)) {
			expect(name).not.toMatch(/obsidian|node_modules|SemantropyView|SemantropyPlugin|selectSourceText/u);
			for (const legacy of LEGACY_RENDER_PATH) expect(name).not.toContain(legacy);
		}
		const code = result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
		expect(code).not.toMatch(/MarkdownRenderer|postProcess|fetch\(|XMLHttpRequest|WebSocket|new Image|new Audio|DOMParser|innerHTML|insertAdjacentHTML|setAttribute|\.style\b|\.src\b|\.href\b|require\(/u);
	});
});
