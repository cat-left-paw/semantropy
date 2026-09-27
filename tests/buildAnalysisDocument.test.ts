// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildAnalysisDocument,
	projectAnalysisRangeToDomParts,
} from "../src/render/buildAnalysisDocument";

const fixture = readFileSync(
	path.join(process.cwd(), "tests", "fixtures", "ruby-rendered.html"),
	"utf8",
);

function parse(html: string): HTMLElement {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const root = parsed.body.firstElementChild;
	if (!(root instanceof HTMLElement)) {
		throw new Error("Ruby DOM fixture has no root element.");
	}
	return root;
}

function fixtureCase(name: string): HTMLElement {
	const root = parse(fixture);
	const found = root.querySelector(`[data-case="${name}"]`);
	if (!(found instanceof HTMLElement)) {
		throw new Error(`Missing fixture case ${name}.`);
	}
	return found;
}

describe("rendered DOM analysis adapter prototype", () => {
	it.each([
		["short", "漢字と歩く。", ["かんじ", "ある"], ["aozora-short", "aozora-short"]],
		["explicit", "親文字とAlice in Wonderland。", ["よみ", "ありす"], ["aozora-explicit", "aozora-explicit"]],
		["html", "前歩く後", ["ある"], ["html"]],
		["multi-token", "東京都へ行く。", ["とうきょうと"], ["html"]],
		["emoji-repeat", "😀猫と猫、漢字の周辺🐈。", ["かんじ"], ["aozora-short"]],
	] as const)("builds %s as one Ruby-aware run", (name, analysisText, readings, notations) => {
		const result = buildAnalysisDocument(fixtureCase(name));
		expect(result.document.runs).toHaveLength(1);
		expect(result.document.protectedRuns).toEqual([]);
		expect(result.document.runs[0]?.analysisText).toBe(analysisText);
		expect(result.document.runs[0]?.annotations.map((ruby) => ruby.reading)).toEqual(
			readings,
		);
		expect(result.document.runs[0]?.annotations.map((ruby) => ruby.notation)).toEqual(
			notations,
		);
	});

	it("keeps one inline flow across adjacent styled Text nodes", () => {
		const root = fixtureCase("inline");
		const result = buildAnalysisDocument(root);
		const run = result.document.runs[0];
		expect(run?.analysisText).toBe("歩く");
		if (!run) {
			return;
		}
		const parts = projectAnalysisRangeToDomParts(
			run,
			{ start: 0, end: 2 },
			result.bindings,
		);
		expect(parts.map((part) => ({
			text: part.node.nodeValue,
			range: part.sourceRange,
		}))).toEqual([
			{ text: "歩", range: { start: 0, end: 1 } },
			{ text: "く", range: { start: 0, end: 1 } },
		]);
	});

	it("projects an HTML ruby base and following okurigana without rt/rp", () => {
		const result = buildAnalysisDocument(fixtureCase("html"));
		const run = result.document.runs[0];
		if (!run) {
			throw new Error("Expected HTML ruby analysis run.");
		}
		const parts = projectAnalysisRangeToDomParts(
			run,
			{ start: 1, end: 3 },
			result.bindings,
		);
		expect(parts.map((part) => part.node.nodeValue)).toEqual(["歩", "く後"]);
		expect(parts.map((part) => part.sourceRange)).toEqual([
			{ start: 0, end: 1 },
			{ start: 0, end: 1 },
		]);
		expect(parts.map((part) => part.node.parentElement?.tagName)).toEqual([
			"RUBY",
			"P",
		]);
	});

	it("splits at every existing protected DOM boundary", () => {
		const result = buildAnalysisDocument(fixtureCase("protected"));
		const analysisTexts = result.document.runs.map((run) => run.analysisText);
		const protectedText = result.document.protectedRuns
			.map((run) => run.originalText)
			.join("");
		expect(analysisTexts).toEqual(["\n\t\t前", "後\n\t\t", "末\n\t\t", "外\n\t\t", "端\n\t\t", "完\n\t"]);
		for (const markerText of [
			"code漢字《かんじ》",
			"link漢字《かんじ》",
			"math漢字《かんじ》",
			"tag漢字《かんじ》",
			"embed漢字《かんじ》",
		]) {
			expect(protectedText).toContain(markerText);
			expect(analysisTexts.join("")).not.toContain(markerText);
		}
		expect(result.document.protectedRuns.every((run) => run.reason === "protected-dom")).toBe(true);
	});

	it("preserves pre, metadata, and form-control subtrees as protected", () => {
		const root = parse(fixture);
		const result = buildAnalysisDocument(root);
		const protectedText = result.document.protectedRuns
			.map((run) => run.originalText)
			.join("\n");
		for (const expected of [
			"pre漢字《かんじ》",
			"metadata漢字《かんじ》",
			"control漢字《かんじ》",
		]) {
			expect(protectedText).toContain(expected);
			expect(result.document.runs.map((run) => run.analysisText).join("\n")).not.toContain(expected);
		}
	});

	it.each([
		["escaped-visible", "漢字\\《かんじ》"],
		["escaped-explicit", "\\親文字よみ"],
	] as const)("keeps %s as an annotation-free literal run", (name, text) => {
		const result = buildAnalysisDocument(fixtureCase(name));
		expect(result.document.protectedRuns).toEqual([]);
		expect(result.document.runs).toHaveLength(1);
		expect(result.document.runs[0]).toMatchObject({
			originalText: text,
			analysisText: text,
			annotations: [],
		});
	});

	it("maps a rendered explicit escape only to text nodes that exist in the DOM", () => {
		const result = buildAnalysisDocument(fixtureCase("escaped-explicit"));
		const run = result.document.runs[0];
		if (!run) {
			throw new Error("Expected escaped explicit literal run.");
		}
		const parts = projectAnalysisRangeToDomParts(
			run,
			{ start: 0, end: run.analysisText.length },
			result.bindings,
		);
		expect(parts.map((part) => part.node.nodeValue)).toEqual([
			"\\",
			"親文字",
			"よみ",
		]);
		expect(parts.map((part) => part.analysisRange)).toEqual([
			{ start: 0, end: 1 },
			{ start: 1, end: 4 },
			{ start: 4, end: 6 },
		]);
	});

	it("keeps an escaped expression literal while parsing a later rendered ruby", () => {
		const result = buildAnalysisDocument(fixtureCase("escaped-mixed"));
		expect(result.document.protectedRuns).toEqual([]);
		expect(result.document.runs).toHaveLength(1);
		expect(result.document.runs[0]).toMatchObject({
			analysisText: "漢字\\《かんじ》と歩く",
			annotations: [
				expect.objectContaining({ reading: "ある", notation: "aozora-short" }),
			],
		});
	});

	it.each([
		["ascii", "unsupported-ruby"],
		["empty-reading", "malformed-ruby"],
		["nested-text", "malformed-ruby"],
		["nested-html", "invalid-html-ruby"],
		["multiple-rt", "invalid-html-ruby"],
		["raw-mismatch", "invalid-html-ruby"],
	] as const)("protects %s without tokenizable fallback", (name, reason) => {
		const result = buildAnalysisDocument(fixtureCase(name));
		expect(result.document.runs).toEqual([]);
		expect(result.document.protectedRuns).toHaveLength(1);
		expect(result.document.protectedRuns[0]?.reason).toBe(reason);
	});

	it("does not join a ruby across a rendered line break", () => {
		const result = buildAnalysisDocument(fixtureCase("line-break"));
		expect(result.document.runs).toEqual([]);
		expect(result.document.protectedRuns.map((run) => run.originalText)).toEqual([
			"漢字《かん",
			"じ》",
		]);
	});

	it("does not join separate Markdown blocks", () => {
		const root = parse("<div><p>東京</p><p>都</p></div>");
		const result = buildAnalysisDocument(root);
		expect(result.document.runs.map((run) => run.analysisText)).toEqual([
			"東京",
			"都",
		]);
	});
});
