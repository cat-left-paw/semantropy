import { describe, expect, it, vi } from "vitest";
import { projectMarkdownSource, type MarkdownSourceProjection } from "../src/analysis/projectMarkdownSource";
import { analyzeSafeTarget } from "../src/render/safeTargetDom";
import { SemantropySession } from "../src/application/SemantropySession";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import { INSUFFICIENT_POOL_MESSAGE, NO_SUPPORTED_TEXT_MESSAGE } from "../src/application/reshuffleNote";
import { toSemantropyViewModel } from "../src/view/semantropyViewModel";
import { buildVocabularyPool } from "../src/transform/transformTokens";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import { referenceProjectMarkdownSource } from "./support/referenceProjectMarkdownSource";
import { denseRubyNovel, safeTargetFixtures, unsafeTargetFixtures } from "./fixtures/targetSafeFixtures";
import { token } from "./tokenFixtures";
import { MAX } from "./readyAnalysis";

// Synthetic Aozora external-character notes (no text copied from any work).
const NOTE_A = "※［＃「木＋合」、第3水準1-1-1］《よみこ》";
const NOTE_B = "※［＃「説明語＋石」、第4水準2-2-2］《よみそ》";
const WORDS = ["猫", "犬", "鳥", "魚", "東京", "漢字", "言葉", "森"];

const target = (md: string) => projectMarkdownSource(md, "target-prototype");
const runTexts = (p: Omit<MarkdownSourceProjection, "policyVersion">) => p.document.runs.map((run) => run.analysisText);
const rawExtent = (p: MarkdownSourceProjection, runIndex: number) => {
	const ids = new Set(p.document.runs[runIndex]!.sourceParts.map((part) => part.source.sourceId));
	const ranges = p.bindings.filter((b) => ids.has(b.sourceId)).map((b) => b.rawRange);
	return { start: Math.min(...ranges.map((r) => r.start)), end: Math.max(...ranges.map((r) => r.end)) };
};
const protectedRanges = (p: MarkdownSourceProjection) => p.exclusions.filter((e) => e.reason === "protected").map((e) => e.range);
function tokenizer() {
	const calls: string[] = [];
	return { calls, tokenize: vi.fn(async (text: string) => {
		calls.push(text);
		const tokens = [];
		for (let i = 0; i < text.length;) {
			const word = WORDS.find((w) => text.startsWith(w, i));
			const surface = word ?? String.fromCodePoint(text.codePointAt(i)!);
			tokens.push(token({ surface, ...(word ? {} : { pos: "記号", isUnknown: true }) }));
			i += surface.length;
		}
		return tokens;
	}) };
}

describe("Target recovery from local unsupported notation", () => {
	it("keeps soft lines before and after a mid-block external-character note analyzable", () => {
		const md = `---\ntitle: x\n---\n猫の話。\n犬は${NOTE_A}を見た。\n鳥が鳴く。`;
		const p = target(md);
		expect(runTexts(p)).toEqual(["猫の話。", "\n犬は", "を見た。", "\n鳥が鳴く。"]);
		const statics = p.presentation.blocks.flatMap((b) => b.items).filter((item) => item.kind === "static" && !item.placeholder);
		expect(statics.map((item) => item.kind === "static" && item.text)).toContain(NOTE_A);
		// The old recovery discarded the whole block for this one note.
		expect(runTexts(referenceProjectMarkdownSource(md, "target-prototype"))).toEqual([]);
	});

	it("collects nouns after the note, and never tokenizes the note's description or reading", async () => {
		const engine = tokenizer();
		const md = `猫と犬。\n森で${NOTE_A}を見た。\n鳥と魚。${NOTE_B}のあと東京。`;
		const result = await analyzeSafeTarget({ text: md, sourcePath: "synthetic.md", contentHash: "h", tokenizer: engine });
		if (result.status !== "ready") throw new Error("expected a ready model");
		const surfaces = result.model.vocabulary.candidates.map((c) => c.surface);
		for (const noun of ["猫", "犬", "森", "鳥", "魚", "東京"]) expect(surfaces).toContain(noun);
		const tokenized = engine.calls.join("|");
		for (const inert of ["木＋合", "説明語", "水準", "よみこ", "よみそ", "［", "＃", "※"]) expect(tokenized).not.toContain(inert);
		expect(surfaces.some((s) => /[［＃※]|よみ/u.test(s))).toBe(false);
	});

	it("protects the kanji base a note's reading belongs to, together with the note", () => {
		const md = `前の猫。\n漢字${NOTE_A}と犬。`;
		const p = target(md);
		expect(runTexts(p)).toEqual(["前の猫。", "と犬。"]);
		const start = md.indexOf("漢字");
		expect(protectedRanges(p)).toContainEqual({ start, end: start + 2 + NOTE_A.length });
	});

	it("does not protect to EOF because a well-formed ｜親文字《よみ》 shares the block", () => {
		const md = "猫は｜東京《とうきょう》へ行った。\n表|列\n犬と鳥。\n\n最後の猫。";
		const p = target(md);
		expect(runTexts(p)).toEqual(["猫は東京へ行った。", "\n犬と鳥。", "最後の猫。"]);
		expect(p.document.runs[0]!.annotations.map((a) => a.reading)).toEqual(["とうきょう"]);
		expect(p.presentation.blocks.filter((b) => b.tag === "pre")).toHaveLength(0);
		expect(runTexts(referenceProjectMarkdownSource(md, "target-prototype"))).toEqual([]);
	});

	it("analyzes the text between and after several notes, including two on one line", () => {
		const md = `猫と${NOTE_A}の犬と${NOTE_B}の鳥\n魚\n${NOTE_A}\n東京`;
		expect(runTexts(target(md))).toEqual(["猫と", "の犬と", "の鳥", "\n魚", "\n東京"]);
		// A kanji run written directly before a note with a reading is its base.
		expect(runTexts(target(`猫${NOTE_A}の犬`))).toEqual(["の犬"]);
	});

	it("never lets an analysis run (or so any token) cross a protected boundary", () => {
		for (const md of [
			`猫${NOTE_A}犬${NOTE_B}鳥\n魚\n${NOTE_A}\n東京`,
			`---\ntitle: x\n---\n猫の話。\n犬は${NOTE_A}を見た。\n鳥が鳴く。`,
			"猫は`code`と[犬](x.md)と$式$と #tag の鳥\n表|列\n魚",
			"猫。\n| 記法 | `%%` |\n犬と鳥。",
			"猫。\n| 記法 | `$$` |\n犬と鳥。",
			"猫。\n| 記法 | `<script>` |\n犬と鳥。",
			"猫。\n| 記法 | \\《 |\n犬と鳥。",
			"猫。\n| 記法 | `<!--` |\n犬と鳥。",
			"猫。\n| 記法 | `《` |\n犬と鳥。",
			"猫。\n| 記法 | `` `%%` `` |\n犬と鳥。",
			"猫。\n<span title=\"%%\">犬</span>\n犬と鳥。",
			"猫。\n<span title=\"$$\">犬</span>\n犬と鳥。",
			"猫。\n<span title=\"<script>\">犬</span>\n犬と鳥。",
		]) {
			const p = target(md);
			const guarded = protectedRanges(p);
			p.document.runs.forEach((_run, index) => {
				const extent = rawExtent(p, index);
				for (const range of guarded) expect(extent.end <= range.start || range.end <= extent.start).toBe(true);
			});
		}
	});

	it.each([
		["unclosed ruby, closed later", "猫《ねこ\n犬は走る。\n鳥《とり》だ。\n\n後の猫。", ["後の猫。"]],
		["unclosed ruby, never closed", "前の魚。\n\n猫《ねこ\n犬\n\n鳥", ["前の魚。"]],
		["unclosed HTML comment", "猫\n<!-- 犬\n\n鳥 -->\n魚。\n\n後。", ["猫", "魚。", "後。"]],
		["HTML comment never closed", "猫\n<!-- 犬\n\n鳥", ["猫"]],
		["Obsidian comment", "猫\n%% 犬\n\n鳥 %%\n魚", ["猫", "魚"]],
		["display math", "猫\n$$\n犬\n$$\n魚", ["猫", "魚"]],
		["raw-text HTML element", "猫\n<script>\n犬\n\n</script>\n魚", ["猫", "魚"]],
		["HTML block owns its paragraph", "猫\n<div>\n犬\n\n鳥", ["猫", "鳥"]],
		["open tag owns its paragraph", "猫\n<span title=\"犬\n鳥\">\n\n魚", ["猫", "魚"]],
	])("still protects a genuinely unclosed construct: %s", (_label, md, expected) => {
		const p = target(md);
		expect(runTexts(p).map((t) => t.replace(/^\n/u, ""))).toEqual(expected);
		for (const inside of ["犬", "鳥"]) {
			if (!expected.some((t) => t.includes(inside))) expect(runTexts(p).join("")).not.toContain(inside);
		}
	});

	it("keeps a list, quote or heading local to its own block", () => {
		const md = "猫。\n- 犬\n- 鳥\n\n# 題\n魚。\n> 引用\n\n後。";
		expect(runTexts(target(md)).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。", "題", "魚。", "後。"]);
	});

	it.each([
		["code %%", "猫。\n| 記法 | `%%` |\n犬と鳥。"],
		["code $$", "猫。\n| 記法 | `$$` |\n犬と鳥。"],
		["code <script>", "猫。\n| 記法 | `<script>` |\n犬と鳥。"],
		["escaped ruby", "猫。\n| 記法 | \\《 |\n犬と鳥。"],
		["code HTML comment", "猫。\n| 記法 | `<!--` |\n犬と鳥。"],
		["code ruby", "猫。\n| 記法 | `《` |\n犬と鳥。"],
		["unequal backticks", "猫。\n| 記法 | `` `%%` `` |\n犬と鳥。"],
	])("does not continue to EOF for an inert opener: %s", (_label, md) => {
		const p = target(md);
		expect(runTexts(p).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。", "犬と鳥。"]);
		expect(p.presentation.blocks.some((b) => b.items.some((item) => item.kind === "static" && item.text.includes("|")))).toBe(true);
		expect(runTexts(p).join("")).not.toContain("|");
		const tableAt = md.indexOf("|");
		const recoveredAt = md.indexOf("犬と鳥");
		expect(protectedRanges(p).some((range) => range.start <= tableAt && tableAt < range.end)).toBe(true);
		expect(protectedRanges(p).some((range) => range.start <= recoveredAt && recoveredAt < range.end)).toBe(false);
		p.document.runs.forEach((_run, index) => {
			const extent = rawExtent(p, index);
			for (const range of protectedRanges(p)) expect(extent.end <= range.start || range.end <= extent.start).toBe(true);
		});
		expect(JSON.stringify(projectMarkdownSource(md))).toBe(JSON.stringify(referenceProjectMarkdownSource(md)));
	});

	it("detects only the genuine opener after inert code or an escape", () => {
		const afterCode = "猫。\n| 記法 | `%%` <!-- 犬\n鳥 -->\n魚。";
		expect(runTexts(target(afterCode)).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。", "魚。"]);
		expect(runTexts(target(afterCode)).join("")).not.toContain("犬");
		const afterEscape = "猫。\n| 記法 | \\《 本当《ねこ\n犬》閉じ\n魚。";
		expect(runTexts(target(afterEscape)).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。", "魚。"]);
		expect(runTexts(target(afterEscape)).join("")).not.toContain("ねこ");
	});

	it.each([
		["double %%", "猫。\n<span title=\"%%\">犬</span>\n犬と鳥。"],
		["double $$", "猫。\n<span title=\"$$\">犬</span>\n犬と鳥。"],
		["double ruby", "猫。\n<span title=\"《\">犬</span>\n犬と鳥。"],
		["double comment", "猫。\n<span title=\"<!--\">犬</span>\n犬と鳥。"],
		["double script", "猫。\n<span title=\"<script>\">犬</span>\n犬と鳥。"],
		["single %%", "猫。\n<span title='%%'>犬</span>\n犬と鳥。"],
		["> in attribute", "猫。\n<span title=\"a>b\">犬</span>\n犬と鳥。"],
		["unquoted %%", "猫。\n<span title=%%>犬</span>\n犬と鳥。"],
		["unquoted $$", "猫。\n<span title=$$>犬</span>\n犬と鳥。"],
		["unquoted ruby", "猫。\n<span title=《>犬</span>\n犬と鳥。"],
	])("does not continue to EOF for an HTML attribute value: %s", (_label, md) => {
		const p = target(md);
		expect(runTexts(p).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。", "犬と鳥。"]);
		expect(p.presentation.blocks.some((b) => b.items.some((item) => item.kind === "static" && item.text.includes("<span")))).toBe(true);
		const htmlAt = md.indexOf("<span");
		const recoveredAt = md.indexOf("犬と鳥");
		expect(protectedRanges(p).some((range) => range.start <= htmlAt && htmlAt < range.end)).toBe(true);
		expect(protectedRanges(p).some((range) => range.start <= recoveredAt && recoveredAt < range.end)).toBe(false);
		p.document.runs.forEach((_run, index) => {
			const extent = rawExtent(p, index);
			for (const range of protectedRanges(p)) expect(extent.end <= range.start || range.end <= extent.start).toBe(true);
		});
		expect(JSON.stringify(projectMarkdownSource(md))).toBe(JSON.stringify(referenceProjectMarkdownSource(md)));
	});

	it("keeps a raw-text opener and a marker after a tag active", () => {
		const script = "猫。\n<script data-x=\"%%\">\n内側\n\n</script>\n魚。";
		expect(runTexts(target(script)).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。", "魚。"]);
		expect(runTexts(target(script)).join("")).not.toContain("内側");
		const afterTag = "猫。\nx </span> %%\n犬と鳥。";
		expect(runTexts(target(afterTag)).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。"]);
		expect(runTexts(target(afterTag)).join("")).not.toContain("犬と鳥");
		const tickAttr = "猫。\n<script data-x=`value`>\n内側\n\n</script>\n魚。";
		expect(runTexts(target(tickAttr)).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。", "魚。"]);
		expect(runTexts(target(tickAttr)).join("")).not.toContain("内側");
	});

	it.each([
		["%%", "猫。\n<span title=\"`\"></span> %% `\n犬と鳥。"],
		["$$", "猫。\n<span title=\"`\"></span> $$ `\n犬と鳥。"],
		["comment", "猫。\n<span title=\"`\"></span> <!-- `\n犬と鳥。"],
		["ruby", "猫。\n<span title=\"`\"></span> 《 `\n犬と鳥。"],
		["script", "猫。\n<span title=\"`\"></span> <script> `\n犬と鳥。"],
	])("does not hide a genuine opener after a backtick in an HTML attribute: %s", (_label, md) => {
		const p = target(md);
		expect(runTexts(p).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。"]);
		expect(runTexts(p).join("")).not.toContain("犬と鳥");
		p.document.runs.forEach((_run, index) => {
			const extent = rawExtent(p, index);
			for (const range of protectedRanges(p)) expect(extent.end <= range.start || range.end <= extent.start).toBe(true);
		});
		expect(JSON.stringify(projectMarkdownSource(md))).toBe(JSON.stringify(referenceProjectMarkdownSource(md)));
	});

	it.each([
		["%%", "猫。\n`<span title=\"`\"></span> %% `\n犬と鳥。"],
		["$$", "猫。\n`<span title=\"`\"></span> $$ `\n犬と鳥。"],
		["comment", "猫。\n`<span title=\"`\"></span> <!-- `\n犬と鳥。"],
		["ruby", "猫。\n`<span title=\"`\"></span> 《 `\n犬と鳥。"],
		["script", "猫。\n`<span title=\"`\"></span> <script> `\n犬と鳥。"],
	])("does not hide a genuine opener after a code span that closes inside HTML: %s", (_label, md) => {
		const p = target(md);
		expect(runTexts(p).map((t) => t.replace(/^\n/u, ""))).toEqual(["猫。"]);
		expect(runTexts(p).join("")).not.toContain("犬と鳥");
		p.document.runs.forEach((_run, index) => {
			const extent = rawExtent(p, index);
			for (const range of protectedRanges(p)) expect(extent.end <= range.start || range.end <= extent.start).toBe(true);
		});
		expect(JSON.stringify(projectMarkdownSource(md))).toBe(JSON.stringify(referenceProjectMarkdownSource(md)));
	});
});

describe("unchanged contracts", () => {
	const corpus = [
		...safeTargetFixtures.map((f) => f.md), ...unsafeTargetFixtures, denseRubyNovel(3_000),
		`猫${NOTE_A}犬`, `---\ntitle: x\n---\n猫の話。\n犬は${NOTE_A}を見た。\n鳥が鳴く。`,
		"猫は｜東京《とうきょう》へ行った。\n表|列\n犬と鳥。\n\n最後の猫。", "猫\n<!-- 犬\n\n鳥 -->\n魚。", "漢字《かん\nじ》", "# 題名 ###",
		"猫。\n| 記法 | `%%` |\n犬と鳥。", "猫。\n| 記法 | `$$` |\n犬と鳥。",
		"猫。\n| 記法 | `<script>` |\n犬と鳥。", "猫。\n| 記法 | \\《 |\n犬と鳥。",
		"猫。\n<span title=\"%%\">犬</span>\n犬と鳥。",
		"猫。\n<span title=%%>犬</span>\n犬と鳥。",
		"猫。\n<span title=\"`\"></span> %% `\n犬と鳥。",
		"猫。\n`<span title=\"`\"></span> %% `\n犬と鳥。",
	];

	it("leaves Source mode byte-identical, still failing closed on the same inputs", () => {
		for (const md of corpus) expect(JSON.stringify(projectMarkdownSource(md))).toBe(JSON.stringify(referenceProjectMarkdownSource(md)));
		expect(runTexts(projectMarkdownSource(`猫${NOTE_A}犬`))).toEqual([]);
		expect(runTexts(projectMarkdownSource("猫は｜東京《とうきょう》へ行った。\n表|列\n犬と鳥。\n\n最後の猫。"))).toEqual([]);
		expect(runTexts(projectMarkdownSource("猫。\n| 記法 | `%%` |\n犬と鳥。"))).toEqual([]);
		expect(runTexts(projectMarkdownSource("猫。\n<span title=\"%%\">犬</span>\n犬と鳥。"))).toEqual([]);
		expect(runTexts(projectMarkdownSource("猫。\n<span title=%%>犬</span>\n犬と鳥。"))).toEqual([]);
	});

	it("leaves Target mode identical where the old recovery did not over-protect", () => {
		for (const md of [...safeTargetFixtures.map((f) => f.md), denseRubyNovel(3_000)]) {
			// Only the Target policy id moved (target-presentation-1 -> -2).
			expect(target(md).policyVersion).toBe("target-presentation-2");
			expect(JSON.stringify({ ...target(md), policyVersion: null })).toBe(JSON.stringify({ ...referenceProjectMarkdownSource(md, "target-prototype"), policyVersion: null }));
		}
		// Inputs that were (and stay) wholly protected: same blocks, ranges and no runs.
		// Only unused bindings of lines the new recovery never parses may differ.
		const shape = (p: Omit<MarkdownSourceProjection, "policyVersion">) => JSON.stringify({ runs: runTexts(p), blocks: p.presentation.blocks, exclusions: p.exclusions });
		for (const md of ["漢字《かん\nじ》", "# 題名 ###", "漢字《`code`中`code`よみ》", "|漢字《よみ》", ...unsafeTargetFixtures]) {
			expect(shape(target(md))).toBe(shape(referenceProjectMarkdownSource(md, "target-prototype")));
			expect(target(md).document.runs).toEqual([]);
		}
	});
});

describe("ready-state messages", () => {
	function ready(tokenSequences: ReturnType<typeof token>[][]) {
		const session = new SemantropySession();
		const id = session.beginLoading();
		session.completeReady(id, createSourceSnapshot({ sourcePath: "n.md", sourceName: "n.md", text: "x", contentHash: "h" }), 1, {
			tokenSequences, pool: buildVocabularyPool(tokenSequences), replacementCount: 0, replaceableSlotCount: 0,
			bodySemantropy: MAX, algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
		});
		return toSemantropyViewModel(session.getState());
	}

	it("keeps Refresh available only while a cancellable Reshuffle holds the view", () => {
		const session = new SemantropySession();
		const id = session.beginLoading();
		session.completeReady(id, createSourceSnapshot({ sourcePath: "n.md", sourceName: "n.md", text: "x", contentHash: "h" }), 1, {
			tokenSequences: [[token({ surface: "猫" })]], pool: new Map(), replacementCount: 0, replaceableSlotCount: 1,
			bodySemantropy: MAX, algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
		});
		// Reshuffle in flight: busy but cancellable. Text-level change: busy only.
		expect(toSemantropyViewModel(session.getState(), { busy: true, transforming: true }).refreshEnabled).toBe(true);
		expect(toSemantropyViewModel(session.getState(), { busy: true }).refreshEnabled).toBe(false);
	});

	it("tells a note with no analyzable text apart from a vocabulary shortage", () => {
		expect(ready([]).message).toBe(NO_SUPPORTED_TEXT_MESSAGE);
		expect(ready([[token({ surface: "孤" })]]).message).toBe(INSUFFICIENT_POOL_MESSAGE);
		expect(NO_SUPPORTED_TEXT_MESSAGE).not.toBe(INSUFFICIENT_POOL_MESSAGE);
	});
});
