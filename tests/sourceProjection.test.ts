// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMarkdownSource } from "../src/analysis/projectMarkdownSource";
import { analyzeSelectedSource } from "../src/application/analyzeSelectedSource";
import { buildAnalysisDocument } from "../src/render/buildAnalysisDocument";
import type { AnalysisDocument } from "../src/analysis/rubyAnalysis";
import { token } from "./tokenFixtures";
const rendererTrap = vi.hoisted(() => vi.fn(() => { throw new Error("Forbidden renderer"); }));
vi.mock("obsidian", () => ({ MarkdownRenderer: { render: rendererTrap } }));

const ruby = (base: string, reading: string, raw: string) => `<ruby data-ruby-raw="${raw}"><rb>${base}</rb><rt>${reading}</rt></ruby>`;
const safeFixtures = [
	{ name: "paragraph blocks", md: "東京\n\n都", html: "<p>東京</p><p>都</p>" },
	{ name: "heading", md: "# 題名\n\n本文", html: "<h1>題名</h1><p>本文</p>" },
	{ name: "inline formatting", md: "漢**字**と*言葉*、__文字__。と~~猫~~", html: "<p>漢<strong>字</strong>と<em>言葉</em>、<strong>文字</strong>。と<del>猫</del></p>" },
	{ name: "short / okurigana", md: "漢字《かんじ》と歩《ある》く", html: `<p>${ruby("漢字", "かんじ", "漢字《かんじ》")}と${ruby("歩", "ある", "歩《ある》")}く</p>` },
	{ name: "explicit / emoji / repeat", md: "😀｜親文字《よみ》猫猫🐈", html: `<p>😀${ruby("親文字", "よみ", "｜親文字《よみ》")}猫猫🐈</p>` },
	{ name: "HTML ruby with rp", md: "前<ruby>歩<rp>（</rp><rt>ある</rt><rp>）</rp></ruby>く後", html: "<p>前<ruby>歩<rp>（</rp><rt>ある</rt><rp>）</rp></ruby>く後</p>" },
	{ name: "HTML rb", md: "<ruby><rb>東京都</rb><rt>とうきょうと</rt></ruby>へ", html: "<p><ruby><rb>東京都</rb><rt>とうきょうと</rt></ruby>へ</p>" },
	{ name: "HTML literal letters / spaces / punctuation / rp", md: "<ruby>第2章 Alice・猫<rp>(</rp><rt>アリス ねこ</rt><rp>)</rp></ruby>", html: "<p><ruby>第2章 Alice・猫<rp>(</rp><rt>アリス ねこ</rt><rp>)</rp></ruby></p>" },
	{ name: "HTML decomposed UTF-16 form", md: "😀<ruby>か\u3099<rt>が</rt></ruby>後", html: "<p>😀<ruby>か\u3099<rt>が</rt></ruby>後</p>" },
	{ name: "visible escape / genuine mixed", md: "漢字\\《かんじ》と歩《ある》く", html: `<p>漢字\\《かんじ》と${ruby("歩", "ある", "歩《ある》")}く</p>` },
	{ name: "Markdown punctuation escape", md: "\\*猫\\*", html: "<p>*猫*</p>" },
	{ name: "protected code / link / math / tag", md: "前`漢字《よみ》`後[語](note.md)末$式$外 #tag 終", html: '<p>前<code>漢字《よみ》</code>後<a href="note.md">語</a>末<span class="math">式</span>外 <a class="tag">#tag</a> 終</p>' },
	{ name: "image / embed boundaries", md: "東![x](https://example.invalid/x)京![[other]]都", html: '<p>東<img src="https://example.invalid/x">京<span class="internal-embed"></span>都</p>' },
] as const;

function signature(doc: AnalysisDocument) {
	return doc.segments.map(s => ({
		kind: s.kind, original: s.run.originalText,
		...(s.kind === "analysis" ? { analysis: s.run.analysisText, annotations: s.run.annotations.map(a => ({
			base: a.baseRange, reading: a.reading, notation: a.notation, original: a.originalRange,
		})) } : {}),
		}));
}
function domDocument(html: string) {
	const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
	return buildAnalysisDocument(doc.body.firstElementChild as HTMLElement).document;
}
function text(md: string) { return projectMarkdownSource(md).document.runs.map(r => r.analysisText); }
const nestedInlineSyntax = [
	"漢*字*", "漢**字**", "_文字_", "~~文字~~", "`文字`",
	"[文字](note.md)", "![画像](https://example.invalid/x)", "[[文字]]", "![[文字]]",
	"$文字$", "#tag", "\\*文字\\*", "漢字\\《よみ》", "==文字==", "%%文字%%",
	"文字::注釈", "https://example.invalid/x", "&amp;",
];
function htmlRubyPart(role: string, value: string) {
	return `<ruby>${role === "base" ? value : "漢字"}<rp>${role === "marker" ? value : "（"}</rp><rt>${role === "reading" ? value : "かんじ"}</rt><rp>）</rp></ruby>`;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("allowlisted non-rendering Source projection", () => {
	it.each(safeFixtures)("matches DOM adapter: $name", fixture => {
		expect(signature(projectMarkdownSource(fixture.md).document)).toEqual(signature(domDocument(fixture.html)));
	});
	it.each(safeFixtures)("retains exact UTF-16 raw provenance: $name", fixture => {
		const projection = projectMarkdownSource(fixture.md);
		for (const binding of projection.bindings) expect(fixture.md.slice(binding.rawRange.start, binding.rawRange.end)).toBe(binding.text);
		for (const run of projection.document.runs) {
			let end = 0;
			for (const position of run.mapping) {
				expect(position.analysisRange.start).toBe(end); end = position.analysisRange.end;
				const binding = projection.bindings.find(b => b.sourceId === position.sourcePart.sourceId)!;
				const raw = { start: binding.rawRange.start + position.sourcePart.range.start, end: binding.rawRange.start + position.sourcePart.range.end };
				expect(fixture.md.slice(raw.start, raw.end)).toBe(run.analysisText.slice(position.analysisRange.start, position.analysisRange.end));
			}
			expect(end).toBe(run.analysisText.length);
		}
	});
	it.each([
		"---\nsecret: 漢字《よみ》\n---\n\n猫",
		"```md\n漢字《よみ》\n\n内側\n```\n\n猫",
		"~~~\n漢字《よみ》\n~~~\n\n猫",
		"    漢字《よみ》\n    内側\n\n猫",
	])("excludes metadata / code blocks: %s", md => { expect(text(md)).toEqual(["猫"]); });
	it("a fence interrupts a paragraph and protects content past blank lines", () => {
		expect(text("前\n```\n\n内部\n```\n\n後")).toEqual(["前", "後"]);
	});
	it.each([
		"[reference][id]", "[shortcut]", "[outer [nested]](url)", "a | b", "a:: b", "***nested***",
		"- list\n  continuation", "> quote", "a\n---", "plain\nwrapped", "&#x732b;", "&amp;",
		"漢字《》", "｜《reading》", "|漢字《よみ》", "漢字《かん《じ》》",
		"漢字《`boundary`中`boundary`よみ》", "\\｜親文字《よみ》",
		"https://example.invalid/漢字", "www.example.invalid/漢字",
		"a_猫_", "_猫_a", " 猫", "猫 ",
		"漢**字**と*言葉*、__文字__と~~猫~~",
	])("fails closed for ambiguous syntax: %s", md => { expect(text(md)).toEqual([]); });
	it.each([
		"<script>\n\n内部\n\n</script>", "<style>\n\n内部\n\n</style>", "<!--\n\n内部\n-->",
		"$$\n\n内部\n$$", "%%\n\n内部\n%%", "漢字《\n\n内部\n\nよみ》", "```\n\n内部",
		"》漢字《\n\n内部\n\nよみ》", "｜親\n\n内部\n\n文字《よみ》",
	])("does not leak through blank lines inside open protected constructs: %s", md => {
		expect(text(md)).toEqual([]);
	});
	it.each([
		'<ruby>外<ruby>内<rt>うち</rt></ruby><rt>そと</rt></ruby>',
		'<ruby>漢字<rt>かん</rt><rt>じ</rt></ruby>', '<ruby>漢字<rt></rt></ruby>',
		'<ruby onclick="anything()">漢字<rt>よみ</rt></ruby>', '<ruby>漢字<rt>&amp;</rt></ruby>',
		'<ruby>漢字<rt>よ\nみ</rt></ruby>', '<ruby>漢字<rt>よみ</rt>余分</ruby>',
	])("rejects HTML ruby outside the lexical allowlist", md => { expect(text(md)).toEqual([]); });
	it.each(["base", "reading", "marker"].flatMap(role => nestedInlineSyntax.map(value => ({ role, value }))))(
		"protects HTML ruby with nested inline syntax in $role: $value", ({ role, value }) => {
			const md = `前${htmlRubyPart(role, value)}後`;
			const result = projectMarkdownSource(md);
			expect(result.document.runs).toEqual([]);
			expect(result.document.segments).toHaveLength(1);
			expect(result.document.segments[0]?.run.originalText).toBe(md);
			expect(result.exclusions).toContainEqual({ range: { start: 0, end: md.length }, reason: "protected" });
		},
	);
	it.each(["base", "reading"])("matches DOM rejection of nested strong / image in HTML ruby %s", role => {
		for (const [md, html] of [["漢**字**", "漢<strong>字</strong>"], ["![画像](https://example.invalid/x)", '<img src="https://example.invalid/x" alt="画像">']]) {
			expect(domDocument(`<p>${htmlRubyPart(role, html!)}</p>`).runs).toEqual([]);
			expect(projectMarkdownSource(htmlRubyPart(role, md!)).document.runs).toEqual([]);
		}
	});
	it("protects ATX headings with an unsupported closing sequence", () => {
		expect(text("# 題名 ###")).toEqual([]);
	});
	it("is immutable, deterministic and handles dense ruby without offset searches", () => {
		const md = "😀漢字《かんじ》と".repeat(600);
		const result = projectMarkdownSource(md);
		expect(result).toEqual(projectMarkdownSource(md));
		expect(result.document.runs[0]?.annotations).toHaveLength(600);
		expect(Object.isFrozen(result.document.runs[0]?.annotations)).toBe(true);
	});
});

describe("Source analysis capability and provenance boundary", () => {
	it("traps DOM/resource/MarkdownRenderer/postprocessors/writes: zero calls", async () => {
		const trap = vi.fn(() => { throw new Error("Forbidden resource capability"); });
		for (const key of ["fetch", "XMLHttpRequest", "WebSocket", "Image", "Audio", "DOMParser", "Worker", "MarkdownRenderer"]) vi.stubGlobal(key, trap);
		vi.spyOn(document, "createElement").mockImplementation(trap);
		vi.stubGlobal("app", { vault: { read: trap, modify: trap, create: trap }, plugins: { markdownPostProcessor: trap } });
		vi.stubGlobal("navigator", { clipboard: { writeText: trap } });
		const tokenizer = { tokenize: vi.fn(async (surface: string) => [token({ surface })]) };
		for (const resource of [
			"![x](https://example.invalid/x)", "![[other]]",
			'<img src="https://example.invalid/x" srcset="https://example.invalid/y 2x">',
			'<iframe src="https://example.invalid/x"></iframe>', '<video poster="https://example.invalid/x"></video>',
			'<audio src="https://example.invalid/x"></audio>', '<object data="https://example.invalid/x"></object>',
			'<embed src="https://example.invalid/x">', '<source srcset="https://example.invalid/x">',
			'<style>p{background:url(https://example.invalid/x)}</style>', '<div style="background:url(https://example.invalid/x)">x</div>',
			...["base", "reading", "marker"].flatMap(role => nestedInlineSyntax.map(value => htmlRubyPart(role, value))),
		]) {
			const result = await analyzeSelectedSource({ text: resource, sourcePath: "selected.md", contentHash: "hash", tokenizer });
			expect(result.status).toBe("ready");
			if (result.status === "ready") expect(result.vocabulary.candidates).toEqual([]);
		}
		expect(tokenizer.tokenize).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
		expect(rendererTrap).not.toHaveBeenCalled();
	});
	it("passes only bases to tokenization, retaining verified exact display form provenance", async () => {
		const tokenizer = { tokenize: vi.fn(async (surface: string) => [token({ surface, baseForm: surface.normalize("NFC"), reading: "morphology" })]) };
		const result = await analyzeSelectedSource({ text: "歩《ある》く\n\n<ruby>が<rt>が</rt></ruby>\n\nが", sourcePath: "selected.md", contentHash: "hash", tokenizer });
		expect(tokenizer.tokenize.mock.calls.map(c => c[0])).toEqual(["歩く", "が", "が"]);
		if (result.status !== "ready") throw new Error("Expected prepared source");
		expect(result.located.runs[0]!.tokens[0]!.range).toEqual({ start: 0, end: 2 });
		const forms = result.vocabulary.candidates.filter(c => c.surface !== "歩く");
		expect(forms[0]!.candidateId).toBe(forms[1]!.candidateId);
		expect(forms[0]!.displayFormId).not.toBe(forms[1]!.displayFormId);
		expect(forms.find(c => c.surface === "が")!.verifiedRubyVariants[0]!.baseRangeInSurface).toEqual({ start: 0, end: 2 });
		expect(forms.find(c => c.surface === "が")!.verifiedRubyVariants).toEqual([]);
		expect(result.vocabulary.candidates.every(c => c.origins[0]?.path === "selected.md")).toBe(true);
	});
	it("coverage failure / arbitrary errors return fixed privacy-safe failures without logging", async () => {
		const log = vi.spyOn(console, "error");
		for (const tokenize of [async () => [], async () => { throw new Error("private body /absolute/vault/path.md"); }]) {
			const result = await analyzeSelectedSource({ text: "秘密", sourcePath: "/absolute/vault/path.md", contentHash: "hash", tokenizer: { tokenize } });
			expect(result).toEqual({ status: "error", message: "Could not analyze the selected source." });
		}
		expect(log).not.toHaveBeenCalled();
	});
	it("close / disable generation revocation discards pending work, without owners or listeners", async () => {
		let current = true;
		const tokenizer = { tokenize: vi.fn(async (surface: string) => { current = false; return [token({ surface })]; }) };
		const result = await analyzeSelectedSource({ text: "前\n\n後", sourcePath: "a.md", contentHash: "hash", tokenizer, isCurrent: () => current });
		expect(result).toEqual({ status: "stale" }); expect(tokenizer.tokenize).toHaveBeenCalledTimes(1);
	});
});
