import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("production Source projection import boundary", () => {
	it("has no transitive renderer, Obsidian, resource or filesystem dependency", async () => {
		const result = await build({ entryPoints: ["src/application/analyzeSelectedSource.ts"], bundle: true, write: false, metafile: true, platform: "neutral" });
		for (const name of Object.keys(result.metafile.inputs)) expect(name).not.toMatch(/obsidian|\/render\/|node_modules|SourceSnapshot|selectSourceText/);
		expect(result.outputFiles[0]!.text).not.toMatch(/MarkdownRenderer|postProcess|fetch\(|XMLHttpRequest|new Image|new DOMParser|document\.(?:create|query|body)|window\.|require\(/);
	});
 it("keeps multi-Source preparation free of rendering and writes", async () => {
  const result = await build({entryPoints:["src/application/prepareVocabulary.ts"],bundle:true,write:false,metafile:true,platform:"neutral"});
  for (const name of Object.keys(result.metafile.inputs)) expect(name).not.toMatch(/obsidian|\/render\/|node_modules|SemantropyView/);
  expect(result.outputFiles[0]!.text).not.toMatch(/MarkdownRenderer|postProcess|fetch\(|XMLHttpRequest|new Image|new DOMParser|document\.(?:create|query|body|write)|writeClipboard|saveData|cachedRead/);
 });

});
