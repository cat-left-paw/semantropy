import { createHash } from "node:crypto";
import { targetChunkLineCases } from "./support/targetChunkLineCases";
import { fixtureHash, readPinnedFixture } from "./support/pinnedFixture";
import { build } from "esbuild";
import { describe, expect, it, vi, afterEach } from "vitest";
import { projectMarkdownSource, TARGET_PRESENTATION_POLICY_VERSION } from "../src/analysis/projectMarkdownSource";
import { buildTargetLineIndex, planTargetLineChunks, projectTargetLineChunk } from "../src/analysis/targetChunkIr";

type Modes<T> = Record<"source" | "target-prototype", T>;
/**
 * TRAILING-SPACE1 renamed the Target policy (target-presentation-2 to -3), because a line that ends in a half-width space or
 * a tab is now read instead of protected. Of the corpus's 4,018 cases, 698 have such a line and 3,320 have none. The
 * 3,320 are read exactly as they were, apart from the policy's name: their digests, taken from the code before the change,
 * are checked with the old name put back. The 698 are pinned as they are read now (243 of them are read differently; the
 * others have their blank where nothing is analyzed anyway, as in a code fence or a list).
 */
const POLICY_BEFORE_TRAILING_SPACE1 = "target-presentation-2";
const nameBefore = (key: string, value: unknown): unknown => key === "policyVersion" && value === TARGET_PRESENTATION_POLICY_VERSION ? POLICY_BEFORE_TRAILING_SPACE1 : value;
const blankEnded = (text: string): boolean => text.split(/\r\n|\n|\r/u).some((line) => /[ \t]$/u.test(line));
const TARGET_WITHOUT_BLANK = { cases: 3320, historical: "b5931bf8d69e763bc1ab8e7a828560d49a7c9209ccbe4f9b5f8177d4f2a04c96", display1: "b14728a0ce5ef8d4e3b2a9dddedd68c9701db911dab5bd63f9ea15ac44da978d" };
const TARGET_WITH_BLANK = { cases: 698, now: "e17e0d88421fd4990d344d4c1ae8d83f35d2c3798be59391320db249413388ae" };
const baseline = readPinnedFixture<{ count: number; inputSha256: string; outputs: Modes<string>;
	display1: { outputs: Modes<string>; hiddenFrontmatter: Modes<number> } }>(
	"targetChunkLineBaseline", "76f703110a6646ece514d239881237b74fd8715fbc8b4e42c934bb3d4197171a",
);

describe("line boundary production baseline and retention", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("leaves Source mode and the Target cases without a blank at the end of a line exactly equal to pinned full-output digests without Git", () => {
		const cases = targetChunkLineCases();
		expect(cases).toHaveLength(baseline.count);
		expect(fixtureHash(JSON.stringify(cases))).toBe(baseline.inputSha256);
		for (const mode of ["source", "target-prototype"] as const) {
			// Source mode reads every case as it did; Target mode is read in two parts (see above).
			const parts = mode === "source" ? [cases] : [cases.filter((text) => !blankEnded(text)), cases.filter(blankEnded)];
			if (mode === "target-prototype") expect(parts.map((part) => part.length)).toEqual([TARGET_WITHOUT_BLANK.cases, TARGET_WITH_BLANK.cases]);
			const digest = createHash("sha256"), changed = createHash("sha256"), current = createHash("sha256"), now = createHash("sha256");
			let hidden = 0;
			for (const [index, text] of parts[0]!.entries()) {
				const result = projectMarkdownSource(text, mode);
				current.update(JSON.stringify(result, nameBefore) + "\n");
				// EXPERIENCE-DISPLAY1 adds one field, `hidden`, to a Target block the parser
				// recognized as a closed leading frontmatter. Without that field every
				// projection must still be byte-identical to the historical recording.
				digest.update(JSON.stringify(result, (key, value: unknown) => key === "hidden" ? undefined : nameBefore(key, value)) + "\n");
				// Negative control: even one changed projection field must fail the oracle.
				changed.update(JSON.stringify(index === 0 ? { ...result, policyVersion: "wrong-policy" } : result) + "\n");
				for (const [b, block] of result.presentation.blocks.entries()) if (block.hidden) {
					hidden += 1;
					expect(mode).toBe("target-prototype");
					expect(b === 0 && block.rawRange.start === 0 && block.tag === "pre" && block.hidden === "frontmatter").toBe(true);
				}
			}
			if (mode === "source") {
				expect(digest.digest("hex")).toBe(baseline.outputs.source);
				expect(changed.digest("hex")).not.toBe(baseline.outputs.source);
				expect({ output: current.digest("hex"), hidden }).toEqual({ output: baseline.display1.outputs.source, hidden: baseline.display1.hiddenFrontmatter.source });
				continue;
			}
			// The cases without a blank: the same as before the change (the digests were taken from the code before it).
			expect(digest.digest("hex")).toBe(TARGET_WITHOUT_BLANK.historical);
			expect(changed.digest("hex")).not.toBe(TARGET_WITHOUT_BLANK.historical);
			expect(current.digest("hex")).toBe(TARGET_WITHOUT_BLANK.display1);
			// The cases with a blank: as they are read now.
			for (const text of parts[1]!) now.update(JSON.stringify(projectMarkdownSource(text, mode)) + "\n");
			expect(now.digest("hex")).toBe(TARGET_WITH_BLANK.now);
			// The recorded hidden-frontmatter count covers the whole corpus, blank-ended cases included.
			let allHidden = 0;
			for (const text of cases) allHidden += projectMarkdownSource(text, mode).presentation.blocks.filter((block) => block.hidden).length;
			expect(allHidden).toBe(baseline.display1.hiddenFrontmatter[mode]);
		}
	}, 30000);
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
