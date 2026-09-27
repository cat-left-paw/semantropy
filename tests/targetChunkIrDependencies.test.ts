import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTargetBlockIndex, planTargetChunks, scanTargetChunks } from "../src/analysis/targetChunkIr";

const FORBIDDEN_INPUT = /obsidian|node_modules|\/render\/|\/view\/|\/collect\/|\/copy\/|\/settings\/|\/tokenizer\/|\/application\/|\/dictionary\/|\/vocabulary\/|\/path\/|SemantropyPlugin/u;

/** Tree shaking must not be able to hide a source-level import. */
async function inputsOf(entry: string): Promise<Set<string>> {
	const result = await build({
		entryPoints: [entry], bundle: true, write: false, metafile: true,
		platform: "neutral", format: "esm", treeShaking: false, legalComments: "none",
	});
	return new Set(Object.keys(result.metafile.inputs));
}

describe("Target Chunk IR dependency boundary", () => {
	it("adds nothing to the safe Target projection's own module graph", async () => {
		// The Chunk IR reuses that projection and depends on nothing else, so its
		// only extra input is the module itself. Any generation, render, tokenizer
		// or settings import added here would show up as a second entry, with or
		// without tree shaking.
		const chunk = await inputsOf("src/analysis/targetChunkIr.ts");
		const projection = await inputsOf("src/analysis/projectMarkdownSource.ts");
		expect([...chunk].filter((name) => !projection.has(name))).toEqual(["src/analysis/targetChunkIr.ts"]);
	});

	it("bundles no Obsidian, Vault, renderer, DOM, tokenizer, view or settings module", async () => {
		for (const name of await inputsOf("src/analysis/targetChunkIr.ts")) expect(name).not.toMatch(FORBIDDEN_INPUT);
		const result = await build({
			entryPoints: ["src/analysis/targetChunkIr.ts"], bundle: true, write: false, metafile: true,
			platform: "neutral", format: "esm", legalComments: "none",
		});
		const code = result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
		expect(code).not.toMatch(
			/MarkdownRenderer|postProcess|fetch\(|XMLHttpRequest|WebSocket|new Image|new Audio|DOMParser|innerHTML|document\.|window\.|localStorage|requestUrl|require\(|process\./u,
		);
	});

	it("imports no generation, random or transform module directly", async () => {
		const source = await readFile("src/analysis/targetChunkIr.ts", "utf8");
		const imported = [...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]!);
		expect(imported.sort()).toEqual(["./projectMarkdownSource", "./rubyAnalysis"]);
	});

	it("keeps the legacy block-only APIs out of the production Chunk View", async () => {
		const result = await build({
			entryPoints: ["src/SemantropyPlugin.ts"], bundle: true, write: false, metafile: true,
			platform: "neutral", format: "esm", external: ["obsidian"], legalComments: "none", treeShaking: true,
		});
		expect(result.outputFiles[0]!.text).not.toMatch(/buildTargetBlockIndex|planTargetChunks|scanTargetChunks/);
		expect(result.outputFiles[0]!.text).toMatch(/buildTargetLineIndex/);
	});
});

describe("Target Chunk IR runtime purity", () => {
	afterEach(() => { vi.unstubAllGlobals(); });

	it("touches no Obsidian, DOM, timer, network or tokenizer global while scanning", () => {
		const touched: string[] = [];
		const trap = (name: string): unknown => new Proxy(function forbidden(): void { touched.push(`${name}()`); }, {
			get: (_target, key): undefined => { touched.push(`${name}.${String(key)}`); return undefined; },
			set: (): boolean => { touched.push(`${name}=`); return true; },
		});
		for (const name of ["document", "window", "app", "fetch", "XMLHttpRequest", "DOMParser", "Image", "requestUrl", "localStorage", "setTimeout", "setInterval", "queueMicrotask"]) {
			vi.stubGlobal(name, trap(name));
		}
		const text = `${"本".repeat(4000)}\n\n漢字《かんじ》の段落。\n\n${"文".repeat(2500)}\n`;
		const descriptors = planTargetChunks(buildTargetBlockIndex(text, 3), 3000);
		expect(descriptors.length).toBeGreaterThan(1);
		expect(scanTargetChunks(text, 3, 3000)).toEqual(descriptors);
		expect(touched).toEqual([]);
	});
});
