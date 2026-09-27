import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	createAnalysisDocument,
	parseRubyAwareInlineRun,
	type AnalysisRun,
	type InlineAnalysisInput,
} from "../src/analysis/rubyAnalysis";
import {
	TokenSurfaceCoverageError,
	locateTokens,
	tokenizeAnalysisDocument,
} from "../src/analysis/locateTokens";
import { buildVocabularyPool } from "../src/transform/transformTokens";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { token } from "./tokenFixtures";

function parseText(...texts: string[]): AnalysisRun {
	const parsed = parseRubyAwareInlineRun({
		runId: "run:test",
		inputs: texts.map((text, index) => ({
			kind: "text",
			sourceId: `source:${index}`,
			text,
		})),
	});
	if (parsed.kind !== "analysis") {
		throw new Error(`Expected analysis run, got ${parsed.run.reason}.`);
	}
	return parsed.run;
}

function parseProtected(
	text: string,
): Extract<
	ReturnType<typeof parseRubyAwareInlineRun>,
	{ kind: "protected" }
> {
	const parsed = parseRubyAwareInlineRun({
		runId: "run:protected",
		inputs: [{ kind: "text", sourceId: "source:0", text }],
	});
	if (parsed.kind !== "protected") {
		throw new Error("Expected a protected run.");
	}
	return parsed;
}

describe("Ruby-aware pure analysis core", () => {
	it("turns 歩《ある》く into continuous analysis text with UTF-16 mappings", () => {
		const run = parseText("歩《ある》く");
		expect(run.originalText).toBe("歩《ある》く");
		expect(run.analysisText).toBe("歩く");
		expect(run.annotations).toEqual([
			expect.objectContaining({
				annotationId: "run:test:ruby:0",
				baseRange: { start: 0, end: 1 },
				reading: "ある",
				notation: "aozora-short",
				originalRange: { start: 0, end: 5 },
			}),
		]);
		expect(run.mapping.map(({ originalRange, analysisRange }) => ({
			originalRange,
			analysisRange,
		}))).toEqual([
			{
				originalRange: { start: 0, end: 1 },
				analysisRange: { start: 0, end: 1 },
			},
			{
				originalRange: { start: 5, end: 6 },
				analysisRange: { start: 1, end: 2 },
			},
		]);
		expect(
			run.sourceParts.filter((part) => part.kind === "ruby-reading"),
		).toEqual([expect.objectContaining({ text: "ある" })]);
	});

	it("limits shorthand bases to the preceding Han/々〆ヶヵ run", () => {
		const run = parseText("かな漢字々〆ヶヵ《よみ》後");
		expect(run.analysisText).toBe("かな漢字々〆ヶヵ後");
		expect(run.annotations[0]).toMatchObject({
			baseRange: { start: 2, end: 8 },
			reading: "よみ",
			notation: "aozora-short",
		});
	});

	it("supports full-width explicit bases across adjacent source parts", () => {
		const run = parseText("前｜親", "文字 ABC《よみ》後");
		expect(run.analysisText).toBe("前親文字 ABC後");
		expect(run.annotations[0]).toMatchObject({
			baseRange: { start: 1, end: 8 },
			reading: "よみ",
			notation: "aozora-explicit",
		});
		const baseSources = run.sourceParts
			.filter((part) => part.kind === "ruby-base")
			.map((part) => ({ sourceId: part.source.sourceId, range: part.source.range }));
		expect(baseSources).toEqual([
			{ sourceId: "source:0", range: { start: 2, end: 3 } },
			{ sourceId: "source:1", range: { start: 0, end: 6 } },
		]);
	});

	it("keeps emoji and repeated surfaces in accumulated UTF-16 positions", () => {
		const run = parseText("😀猫と猫🐈");
		const located = locateTokens(run, [
			token({ surface: "😀", isUnknown: true }),
			token({ surface: "猫" }),
			token({ surface: "と", pos: "助詞" }),
			token({ surface: "猫" }),
			token({ surface: "🐈", isUnknown: true }),
		]);
		expect(located.map(({ token: found, range }) => ({
			surface: found.surface,
			range,
		}))).toEqual([
			{ surface: "😀", range: { start: 0, end: 2 } },
			{ surface: "猫", range: { start: 2, end: 3 } },
			{ surface: "と", range: { start: 3, end: 4 } },
			{ surface: "猫", range: { start: 4, end: 5 } },
			{ surface: "🐈", range: { start: 5, end: 7 } },
		]);
	});

	it("measures ruby source and analysis ranges in UTF-16 around emoji", () => {
		const run = parseText("😀歩《ある》く🐈");
		expect(run.analysisText).toBe("😀歩く🐈");
		expect(run.annotations[0]).toMatchObject({
			baseRange: { start: 2, end: 3 },
			originalRange: { start: 2, end: 7 },
		});
		expect(run.mapping.map((segment) => ({
			originalRange: segment.originalRange,
			analysisRange: segment.analysisRange,
		}))).toEqual([
			{
				originalRange: { start: 0, end: 2 },
				analysisRange: { start: 0, end: 2 },
			},
			{
				originalRange: { start: 2, end: 3 },
				analysisRange: { start: 2, end: 3 },
			},
			{
				originalRange: { start: 7, end: 10 },
				analysisRange: { start: 3, end: 6 },
			},
		]);
	});

	it("lets one ruby base overlap multiple located tokens", () => {
		const run = parseText("東京都《とうきょうと》へ");
		const located = locateTokens(run, [
			token({ surface: "東京" }),
			token({ surface: "都" }),
			token({ surface: "へ", pos: "助詞" }),
		]);
		expect(run.annotations[0]?.baseRange).toEqual({ start: 0, end: 3 });
		expect(located.map((item) => item.range)).toEqual([
			{ start: 0, end: 2 },
			{ start: 2, end: 3 },
			{ start: 3, end: 4 },
		]);
	});

	it.each([
		["shorthand marker", "漢字\\《かんじ》"],
		["explicit marker", "\\｜親文字《よみ》"],
	] as const)("keeps a visible escaped %s as literal analysis text", (_name, text) => {
		const run = parseText(text);
		expect(run.originalText).toBe(text);
		expect(run.analysisText).toBe(text);
		expect(run.annotations).toEqual([]);
		expect(run.sourceParts).toEqual([
			expect.objectContaining({ kind: "text", text }),
		]);
		expect(run.mapping).toEqual([
			expect.objectContaining({
				originalRange: { start: 0, end: text.length },
				analysisRange: { start: 0, end: text.length },
			}),
		]);
	});

	it("keeps an escaped expression literal and parses a later supported ruby", () => {
		const run = parseText("漢字\\《かんじ》と歩《ある》く");
		expect(run.analysisText).toBe("漢字\\《かんじ》と歩く");
		expect(run.annotations).toEqual([
			expect.objectContaining({
				baseRange: { start: 9, end: 10 },
				reading: "ある",
				notation: "aozora-short",
			}),
		]);
		expect(
			run.sourceParts.filter((part) => part.kind === "ruby-reading"),
		).toEqual([expect.objectContaining({ text: "ある" })]);
	});

	it("accepts a structured simple HTML ruby without analyzing rt/rp", () => {
		const inputs: InlineAnalysisInput[] = [
			{ kind: "text", sourceId: "before", text: "前" },
			{
				kind: "html-ruby",
				notation: "html",
				parts: [
					{ sourceId: "base", text: "歩", role: "base" },
					{ sourceId: "rp-open", text: "（", role: "marker" },
					{ sourceId: "rt", text: "ある", role: "reading" },
					{ sourceId: "rp-close", text: "）", role: "marker" },
				],
			},
			{ kind: "text", sourceId: "after", text: "く" },
		];
		const parsed = parseRubyAwareInlineRun({ runId: "run:html", inputs });
		expect(parsed.kind).toBe("analysis");
		if (parsed.kind !== "analysis") {
			return;
		}
		expect(parsed.run.originalText).toBe("前歩（ある）く");
		expect(parsed.run.analysisText).toBe("前歩く");
		expect(parsed.run.annotations[0]).toMatchObject({
			baseRange: { start: 1, end: 2 },
			reading: "ある",
			notation: "html",
			originalRange: { start: 1, end: 6 },
		});
	});

	it.each([
		["ASCII bar", "|親文字《よみ》", "unsupported-ruby"],
		["empty base", "《よみ》", "malformed-ruby"],
		["empty reading", "漢字《》", "malformed-ruby"],
		["missing close", "漢字《かんじ", "malformed-ruby"],
		["nested", "漢字《かん《じ》》", "malformed-ruby"],
		["newline", "漢字《かん\nじ》", "malformed-ruby"],
	] as const)("protects %s notation as one un-tokenized inline run", (_name, text, reason) => {
		const parsed = parseProtected(text);
		expect(parsed.run.reason).toBe(reason);
		expect(parsed.run.originalText).toBe(text);
	});

	it("protects an invalid structured HTML ruby", () => {
		const parsed = parseRubyAwareInlineRun({
			runId: "run:html-invalid",
			inputs: [
				{
					kind: "html-ruby",
					notation: "html",
					parts: [
						{ sourceId: "base", text: "漢字", role: "base" },
						{ sourceId: "rt-1", text: "かん", role: "reading" },
						{ sourceId: "rt-2", text: "じ", role: "reading" },
					],
				},
			],
		});
		expect(parsed).toMatchObject({
			kind: "protected",
			run: { reason: "invalid-html-ruby", originalText: "漢字かんじ" },
		});
	});
});

describe("LocatedToken coverage", () => {
	it("tokenizes analysis text only, excluding readings, markers, and protected runs", async () => {
		const safe = parseRubyAwareInlineRun({
			runId: "run:safe",
			inputs: [
				{ kind: "text", sourceId: "safe", text: "歩《ある》く" },
			],
		});
		const blocked = parseRubyAwareInlineRun({
			runId: "run:blocked",
			inputs: [
				{ kind: "text", sourceId: "blocked", text: "|猫《ねこ》" },
			],
		});
		const document = createAnalysisDocument([safe, blocked]);
		const calls: string[] = [];
		const located = await tokenizeAnalysisDocument(document, {
			tokenize: async (text) => {
				calls.push(text);
				return [
					token({ surface: "歩", pos: "動詞" }),
					token({ surface: "く", pos: "助動詞" }),
				];
			},
		});
		expect(calls).toEqual(["歩く"]);
		expect(located.runs[0]?.tokens.map((item) => item.token.surface)).toEqual([
			"歩",
			"く",
		]);
		const pool = buildVocabularyPool(
			located.runs.map((run) => run.tokens.map((item) => item.token)),
		);
		const serializedPool = JSON.stringify([...pool.values()]);
		expect(serializedPool).not.toContain("ある");
		expect(serializedPool).not.toContain("《");
		expect(serializedPool).not.toContain("ねこ");
	});

	it.each([
		{ tokens: [token({ surface: "歩" })] },
		{ tokens: [token({ surface: "歩いた" })] },
		{ tokens: [token({ surface: "" })] },
	] satisfies Array<{ tokens: JapaneseToken[] }>)("fails explicitly when surfaces do not cover analysis text", ({ tokens }) => {
		const run = parseText("歩く");
		expect(() => locateTokens(run, tokens)).toThrow(TokenSurfaceCoverageError);
	});

	it("does not re-discover parser, token, or DOM offsets with indexOf", () => {
		for (const relativePath of [
			["src", "analysis", "rubyAnalysis.ts"],
			["src", "analysis", "locateTokens.ts"],
			["src", "render", "buildAnalysisDocument.ts"],
		]) {
			const source = readFileSync(
				path.join(process.cwd(), ...relativePath),
				"utf8",
			);
			expect(source).not.toMatch(/\bindexOf\s*\(/u);
		}
	});
});

describe("Ruby Markdown fixture", () => {
	it("records the supported, protected, emoji, and escape cases", () => {
		const fixture = readFileSync(
			path.join(process.cwd(), "tests", "fixtures", "ruby-analysis.md"),
			"utf8",
		);
		for (const expected of [
			"漢字《かんじ》",
			"歩《ある》く",
			"｜親文字《よみ》",
			"<ruby>東京都",
			"😀猫と猫",
			"`code漢字《かんじ》`",
			"[link漢字《かんじ》]",
			"|親文字《よみ》",
			"漢字《》",
			"漢字《かん《じ》》",
			"漢字\\《かんじ》",
		]) {
			expect(fixture).toContain(expected);
		}
	});
});
