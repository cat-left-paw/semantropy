import { build } from "esbuild";
import { expect, it } from "vitest";

it("safe Target transitive bundle contains no renderer / postprocessor / resource / file capability", async () => {
	const result = await build({ entryPoints: ["src/render/safeTargetPrototype.ts"], bundle: true, write: false, metafile: true, platform: "neutral" });
	for (const name of Object.keys(result.metafile.inputs)) expect(name).not.toMatch(/obsidian|node_modules|buildAnalysisDocument|rubyBodyRenderer|renderMarkdownSnapshot|SemantropyView/);
	expect(result.outputFiles[0]!.text).not.toMatch(/MarkdownRenderer|postProcess|fetch\(|XMLHttpRequest|WebSocket|new Image|new Audio|DOMParser|innerHTML|insertAdjacentHTML|setAttribute|\.style\b|\.src\b|\.href\b|require\(|indexOf\(/);
});
