import { createHash } from "node:crypto";
import { targetChunkLineCases } from "./support/targetChunkLineCases";
import { fixtureHash, readPinnedFixture } from "./support/pinnedFixture";
import { build } from "esbuild";
import { describe, expect, it, vi, afterEach } from "vitest";
import { projectMarkdownSource } from "../src/analysis/projectMarkdownSource";
import { buildTargetLineIndex, planTargetLineChunks, projectTargetLineChunk } from "../src/analysis/targetChunkIr";

type Modes<T> = Record<"source" | "target-prototype", T>;
const baseline = readPinnedFixture<{ count: number; inputSha256: string; outputs: Modes<string>;
	display1: { outputs: Modes<string>; hiddenFrontmatter: Modes<number> } }>(
	"targetChunkLineBaseline", "76f703110a6646ece514d239881237b74fd8715fbc8b4e42c934bb3d4197171a",
);

describe("line boundary production baseline and retention", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("leaves both production projection policies exactly equal to pinned full-output digests without Git", () => {
		const cases = targetChunkLineCases();
		expect(cases).toHaveLength(baseline.count);
		expect(fixtureHash(JSON.stringify(cases))).toBe(baseline.inputSha256);
		for (const mode of ["source", "target-prototype"] as const) {
			const digest = createHash("sha256"), changed = createHash("sha256"), current = createHash("sha256");
			let hidden = 0;
			for (const [index, text] of cases.entries()) {
				const result = projectMarkdownSource(text, mode);
				current.update(JSON.stringify(result) + "\n");
				// EXPERIENCE-DISPLAY1 adds one field, `hidden`, to a Target block the parser
				// recognized as a closed leading frontmatter. Without that field every
				// projection must still be byte-identical to the historical recording.
				digest.update(JSON.stringify(result, (key, value: unknown) => key === "hidden" ? undefined : value) + "\n");
				// Negative control: even one changed projection field must fail the oracle.
				changed.update(JSON.stringify(index === 0 ? { ...result, policyVersion: "wrong-policy" } : result) + "\n");
				for (const [b, block] of result.presentation.blocks.entries()) if (block.hidden) {
					hidden += 1;
					expect(mode).toBe("target-prototype");
					expect(b === 0 && block.rawRange.start === 0 && block.tag === "pre" && block.hidden === "frontmatter").toBe(true);
				}
			}
			expect(digest.digest("hex")).toBe(baseline.outputs[mode]);
			expect(changed.digest("hex")).not.toBe(baseline.outputs[mode]);
			expect({ output: current.digest("hex"), hidden }).toEqual({ output: baseline.display1.outputs[mode], hidden: baseline.display1.hiddenFrontmatter[mode] });
		}
	}, 20000);
	it("connects certified Chunk replay and barrier scanning to production", async () => {
		const result = await build({ entryPoints: ["src/SemantropyPlugin.ts"], bundle: true, write: false, metafile: true,
			format: "esm", platform: "neutral", external: ["obsidian"], treeShaking: true });
		expect(Object.keys(result.metafile.inputs).some(name => name.includes("targetChunkIr"))).toBe(true);
		for (const name of ["projectTargetFragments", "targetBoundaryBarriers", "boundaryRange"]) expect(result.outputFiles[0]!.text).toContain(name);
		expect(result.outputFiles[0]!.text).not.toMatch(/buildTargetBlockIndex|planTargetChunks|scanTargetChunks/);
	});
	it("retains ranges and scalar context only and materializes only the requested Chunk", () => {
		const index = buildTargetLineIndex("本文。漢字《かんじ》\n".repeat(500), 7);
		const descriptors = planTargetLineChunks(index, 300);
		const seen = new Set<object>();
		const walk = (value: unknown): void => {
			if (value === null || typeof value !== "object" || seen.has(value)) return;
			seen.add(value);
			for (const [key, child] of Object.entries(value)) {
				expect(key).not.toMatch(/^(document|runs|segments|bindings|exclusions|presentation|decorations|annotations|tokens|analysis|displayPlan|slots|root|listeners|selection|hover)$/);
				walk(child);
			}
		};
		walk(index); walk(descriptors);
		const result = projectTargetLineChunk(index, descriptors[1]!);
		const size = descriptors[1]!.rawRange.end - descriptors[1]!.rawRange.start;
		for (const b of result.projection.bindings) {
			expect(b.rawRange.start).toBeGreaterThanOrEqual(0);
			expect(b.rawRange.end).toBeLessThanOrEqual(size);
		}
		expect(Object.isFrozen(index)).toBe(true);
		expect(Object.isFrozen(index.boundaries[0])).toBe(true);
		walk(index); walk(descriptors);
	});
	it("has no runtime I/O, timer, DOM, settings or tokenizer capability", () => {
		const touched: string[] = [];
		for (const name of ["document", "window", "app", "fetch", "XMLHttpRequest", "DOMParser", "Image", "requestUrl", "localStorage", "setTimeout", "setInterval", "queueMicrotask"]) {
			vi.stubGlobal(name, new Proxy(() => touched.push(name), { get: () => { touched.push(name); return undefined; } }));
		}
		const index = buildTargetLineIndex("本文。\n".repeat(100), 1);
		const descriptors = planTargetLineChunks(index, 30);
		projectTargetLineChunk(index, descriptors[0]!);
		expect(touched).toEqual([]);
	});
});
