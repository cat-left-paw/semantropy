import { describe, expect, it } from "vitest";
import { targetBoundaryBarriers } from "../src/analysis/activeContinuation";
import { projectMarkdownSource, type MarkdownSourceProjection } from "../src/analysis/projectMarkdownSource";
import {
	buildTargetLineIndex, planTargetLineChunks, projectTargetLineChunk, lineChunkRawText, lineChunkRawRange,
	TargetChunkError, type TargetLineChunk, type TargetLineIndex,
} from "../src/analysis/targetChunkIr";

/** Canonical raw-position oracle: run/source IDs and Text node coalescing are local, not semantics. */
function facts(p: MarkdownSourceProjection, offset = 0, identities = p.presentation.blocks.map(b => b.rawRange)) {
	const bindings = new Map(p.bindings.map(b => [b.sourceId, b]));
	const absolute = (ref: { sourceId: string; range: { start: number; end: number } }) => {
		const b = bindings.get(ref.sourceId)!;
		return { start: offset + b.rawRange.start + ref.range.start, end: offset + b.rawRange.start + ref.range.end };
	};
	const cells = (start: number, text: string, role: string) => text.split("").map((c, i) => [start + i, role, c]);
	const segments = new Map(p.document.segments.map(s => [s.run.runId, s]));
	const presentation = p.presentation.blocks.flatMap((b, i) => b.items.flatMap(item => {
		const key = `${identities[i]!.start}:${identities[i]!.end}:${b.tag}`;
		if (item.kind === "break") return [[key, "break", offset + item.rawRange.start, offset + item.rawRange.end]];
		if (item.kind === "static") return cells(offset + item.visibleRange.start, item.text, `static:${item.tag}:${item.placeholder}`).map(c => [key, ...c]);
		const segment = segments.get(item.runId)!;
		return segment.run.sourceParts.flatMap(part => cells(absolute(part.source).start, part.text, part.kind).map(c => [key, ...c]));
	}));
	const analysis = p.document.runs.flatMap(r => r.mapping.flatMap(m => {
		const start = absolute(m.sourcePart).start;
		return cells(start, r.analysisText.slice(m.analysisRange.start, m.analysisRange.end), "analysis");
	}));
	const exclusions = p.exclusions.flatMap(e => Array.from({ length: e.range.end - e.range.start }, (_, i) => [offset + e.range.start + i, e.reason]));
	const ruby = p.document.runs.flatMap(r => r.annotations.map(a => ({ notation: a.notation, reading: a.reading,
		base: r.analysisText.slice(a.baseRange.start, a.baseRange.end), parts: a.originalParts.map(absolute) })));
	const decorations = p.presentation.decorations.map(d => ({ tag: d.tag, start: offset + d.rawRange.start, end: offset + d.rawRange.end }));
	// Copy/Collect reads base/text + protected visible strings; br contributes no extra text.
	const logical = p.presentation.blocks.map(b => b.items.map(item => {
		if (item.kind === "break") return "";
		if (item.kind === "static") return item.placeholder ? "" : item.text;
		const s = segments.get(item.runId)!;
		return s.run.sourceParts.filter(part => part.kind === "text" || part.kind === "ruby-base").map(part => part.text).join("");
	}).join(""));
	return { presentation, analysis, exclusions, ruby, decorations, logical };
}

export function expectLineEquivalence(text: string, size: number): void {
	const index = buildTargetLineIndex(text, 5);
	const descriptors = planTargetLineChunks(index, size);
	const whole = projectMarkdownSource(text, "target-prototype");
	const expected = facts(whole);
	const actual = descriptors.map(d => {
		const p = projectTargetLineChunk(index, d);
		return facts(p.projection, d.rawRange.start, p.blockFragments.map(f => f.wholeRange));
	});
	for (const key of ["presentation", "analysis", "exclusions", "ruby", "decorations"] as const) {
		expect(actual.flatMap<unknown>(a => a[key]), `${key}: ${JSON.stringify(text)} @${size}`).toEqual(expected[key]);
	}
	// Group logical fragments by original block identity; insert paragraph separator only once per whole block.
	const logical = new Map<string, string>();
	for (const d of descriptors) {
		const p = projectTargetLineChunk(index, d);
		facts(p.projection).logical.forEach((value, i) => {
			const range = p.blockFragments[i]!.wholeRange, key = `${range.start}:${range.end}`;
			logical.set(key, (logical.get(key) ?? "") + value);
		});
	}
	expect([...logical.values()].join("\n\n")).toBe(expected.logical.join("\n\n"));
	expect(descriptors.map(d => lineChunkRawText(index, d)).join("")).toBe(text);
	let at = 0, boundary = 0;
	for (const d of descriptors) {
		expect(d.rawRange.start).toBe(at);
		expect(d.rawRange.end).toBeGreaterThan(at);
		expect(d.boundaryRange.start).toBe(boundary);
		expect(lineChunkRawRange(index, d, { start: 0, end: d.rawRange.end - at })).toEqual(d.rawRange);
		at = d.rawRange.end; boundary = d.boundaryRange.end;
	}
	expect(at).toBe(text.length);
}

const fixtures = [
	"普通の文章。\n次の段落。\nさらに文章。\n",
	"漢字《かんじ》と｜親文字《おやもじ》。\n<ruby>漢<rt>かん</rt></ruby>。\n終わり。\n",
	"前。\n本文《閉じない\n続く\n読み》\n後。\n",
	"前。\n\\《escape\n\\｜親《よみ》\n後。\n",
	"前。\n`code` と ![[image]] と [link](url) と $x$。\n後。\n",
	"前。\n```js\nconst x = 1;\n```\n後。\n",
	"前。\n<div>\n中\n</div>\n\n後。\n",
	"前。\n<span title=\"属性\n続き\">中</span>\n後。\n",
	"前。\n<!--\n中\n-->\n後。\n",
	"前。\n<script>\n中\n</script>\n\n後。\n",
	"前。\n%%\n中\n%%\n後。\n",
	"前。\n$$\n中\n$$\n後。\n",
	"前。\n本文《未閉鎖\n中\n後。\n",
	"前。\n<!-- 未閉鎖\n\n後。\n",
	"😀🎌👩‍👩‍👧‍👦か\u3099\n　日本語。\n次。\n",
	"普通の段落です。\n    <!-- open\n本文<!-- open\n-->\n》閉じ\n- 項目\n--- text\n    <!-- open\n",
	"前。\n    indented\n普通の文章。\n末尾空白 \n後。\n",
	"---\na: b\n---\n\n前。\n\n---\u00a0\n\n後。\n\n\ufeff---\n\n後。\n",
	"前。\n**強調**と漢字《かんじ》。\n末尾。\n",
	"前。\n~~~\n$ [ <!-- 《 \n~~~\n後。\nさらに後。\n",
	"---\nvalue: [\n$ literal\n---\n本文。\n次。\n",
	"前。\n`code\n中\ncode`\n後。\n",
	"前。\n[link\n中\n](url)\n後。\n",
	"前。\n![[embed\n中\n]]\n後。\n",
	"前。\n$math\n中\n$\n後。\n",
];

describe("standard Japanese line boundary", () => {
	it("chooses nearest on either side and breaks ties earlier", () => {
		const index = buildTargetLineIndex("あああ\nいいいいい\nううううううううう\n", 1);
		expect(planTargetLineChunks(index, 6)[0]!.rawRange.end).toBe(4);
		expect(planTargetLineChunks(index, 8)[0]!.rawRange.end).toBe(10);
		expect(planTargetLineChunks(index, 7)[0]!.rawRange.end).toBe(4);
	});
	it("uses non-newline EOF only to finish the remaining tail", () => {
		const chunks = planTargetLineChunks(buildTargetLineIndex("ああ\nいいいいいいい", 1), 8);
		expect(chunks.map(c => c.rawRange)).toEqual([{ start: 0, end: 3 }, { start: 3, end: 10 }]);
	});
	it.each(["\n", "\r\n", "\r"])("uses atomic %j", newline => {
		const text = Array.from({ length: 80 }, () => "日本語の長い原稿。".repeat(10)).join(newline) + newline;
		const index = buildTargetLineIndex(text, 1);
		const chunks = planTargetLineChunks(index, 300);
		expect(chunks.length).toBeGreaterThan(20);
		for (const c of chunks) expect(text[c.rawRange.end - 1] === "\r" && text[c.rawRange.end] === "\n").toBe(false);
		expectLineEquivalence(text, 300);
	});
	it("keeps a huge line whole, empty input empty, and deterministic identities", () => {
		expect(planTargetLineChunks(buildTargetLineIndex("巨".repeat(100000), 1), 3000)).toHaveLength(1);
		expect(planTargetLineChunks(buildTargetLineIndex("", 1), 1)).toEqual([]);
		const text = "本文。\n".repeat(500);
		expect(planTargetLineChunks(buildTargetLineIndex(text, 3), 100)).toEqual(planTargetLineChunks(buildTargetLineIndex(text, 3), 100));
	});
	it.each(fixtures.map((text, i) => [i, text] as const))("preserves complete projection fixture %i", (_i, text) => {
		for (const newline of ["\n", "\r\n", "\r"]) for (const size of [1, 3, 8, 21, 55, 3000]) expectLineEquivalence(text.replace(/\n/g, newline), size);
	});
	it.each([
		"本文《読み\n途中\n》", "｜親\n文字《よみ》", "［＃注記\n途中\n］《よみ》", "<!--\n中\n-->", "%%\n中\n%%", "$$\n中\n$$", "```\n中\n```",
		"<script>\n中\n</script>", "<div>\n中\n</div>", "<span title=\"\n属性\n\">中</span>",
		"<span>\n<!-- </span> -->\n\n中\n</span>", "<span>\n<script>\n</span>\n</script>\n\n中\n</span>",
		"`code\n中\ncode`", "[link\n中\n](url)", "![[embed\n中\n]]", "$math\n中\n$",
	])("does not split syntax interior %j", syntax => {
		const text = `前。\n${syntax}\n\n後。\n`;
		const chunks = planTargetLineChunks(buildTargetLineIndex(text, 1), 1);
		for (const c of chunks) expect(c.rawRange.end > 3 && c.rawRange.end < 3 + syntax.length).toBe(false);
	});
	it("matches the whole projection across deterministic adversarial line combinations", () => {
		const parts = ["普通。", "漢字《かんじ》", "\\《esc", "\\｜親《よみ》", "本文《よみ", "》閉じ", "", "", "<!-- open", "本文<!-- open", "    <!-- open", "-->",
			"$$", "$open", "%%", "<div>", "</div>", "<span title=\"%%\">中</span>", "- 項目", "> 引用", "1. 番号", "---", "﻿---", "--- ", "--- ", "---　",
			"--- text", "----", "===", "```", "~~~", "    indented", "# 見出し", "| a | b |", "![[x.png]]", "[link](http://x)", "[link", "](url)",
			"`code`", "`open", "==highlight==", "※［＃注記］《よみ》", "<ruby>漢<rt>かん</rt></ruby>", "絵文字😀か\u3099", "末尾空白 ", "**強調**"];
		let seed = 107;
		const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
		for (let i = 0; i < 1200; i += 1) {
			const newline = ["\n", "\r\n", "\r"][i % 3]!;
			const text = Array.from({ length: 1 + random() % 15 }, () => parts[random() % parts.length]!).join(newline) + (i % 2 ? newline : "");
			for (const size of [1, 3, 8, 21, 55]) expectLineEquivalence(text, size);
		}
	});
	it.each(["`unclosed", "[unclosed", "![[unclosed", "$unclosed", "<span>unclosed"])("retains the entire continuation for %s", opener => {
		const text = `前。\n${opener}\n${"文章。\n".repeat(100)}`;
		const chunks = planTargetLineChunks(buildTargetLineIndex(text, 1), 30);
		for (const chunk of chunks) expect(chunk.rawRange.end <= 3 || chunk.rawRange.end === text.length).toBe(true);
	});
	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses invalid target %s", size => {
		expect(() => planTargetLineChunks(buildTargetLineIndex("本文。", 1), size)).toThrow(TargetChunkError);
	});
	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses invalid revision %s", revision => {
		expect(() => buildTargetLineIndex("本文。", revision)).toThrow(TargetChunkError);
	});
	it("keeps tokenization units separate across soft newlines and Chunks", () => {
		const index = buildTargetLineIndex("漢字《かんじ》と日本語。\n".repeat(100), 1);
		for (const chunk of planTargetLineChunks(index, 40)) for (const run of projectTargetLineChunk(index, chunk).projection.document.runs) {
			expect(run.analysisText.split(/[\r\n]+/).filter(line => line.trim())).toHaveLength(run.analysisText.trim() ? 1 : 0);
		}
	});
	it("rejects stale relabels, cross-index, same-revision, clones and hand-built descriptors", () => {
		const index = buildTargetLineIndex("本文。\n次。", 1), d = planTargetLineChunks(index, 1)[0]!;
		for (const other of [buildTargetLineIndex(index.rawText, 1), buildTargetLineIndex("別。\n次。", 1), buildTargetLineIndex(index.rawText, 2), { ...index }, { ...index, targetRevision: 3 }] as TargetLineIndex[]) {
			expect(() => projectTargetLineChunk(other, d)).toThrow(TargetChunkError);
			expect(() => lineChunkRawRange(other, d, { start: 0, end: 1 })).toThrow(TargetChunkError);
		}
		for (const fake of [{ ...d }, JSON.parse(JSON.stringify(d)), { rawRange: { start: 0, end: 2 } }] as TargetLineChunk[]) {
			expect(() => projectTargetLineChunk(index, fake)).toThrow(TargetChunkError);
			expect(() => lineChunkRawText(index, fake)).toThrow(TargetChunkError);
		}
		expect(() => planTargetLineChunks({ ...index }, 1)).toThrow(TargetChunkError);
	});
});


describe("independent review regressions: final tails and void HTML", () => {
	it.each(["\n", "\r\n", "\r"])("keeps short and exactly-target notes whole with %j", newline => {
		for (const body of ["一行", ["一行", "二行"].join(newline), ["一行", "二行", "三行"].join(newline), "本".repeat(1997) + newline + "文"])
			for (const suffix of ["", newline]) {
				const text = body + suffix;
				for (const target of [text.length, 3000, 5000]) {
					const chunks = planTargetLineChunks(buildTargetLineIndex(text, 1), target);
					expect(chunks.map(c => c.rawRange)).toEqual([{ start: 0, end: text.length }]);
					expectLineEquivalence(text, target);
				}
			}
	});
	it.each(["\n", "\r\n", "\r"])("absorbs a multiline final tail without changing earlier chunks with %j", newline => {
		const first = "前".repeat(20 - newline.length) + newline;
		const body = first.repeat(2) + ["末尾", "さらに", "最後"].join(newline);
		for (const suffix of ["", newline]) {
			const text = body + suffix;
			const chunks = planTargetLineChunks(buildTargetLineIndex(text, 1), 20);
			expect(chunks.map(c => c.rawRange)).toEqual([{ start: 0, end: 20 }, { start: 20, end: 40 }, { start: 40, end: text.length }]);
			expectLineEquivalence(text, 20);
		}
	});
	it.each(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])(
		"ends the barrier at the complete %s tag", name => {
			for (const tag of [`<${name}>`, `<${name.toUpperCase()} SRC="x" title='> %% <'>`, `<${name} data-x=x>`, `<${name}/>`, `<${name.toUpperCase()} src="x" />`]) {
				const text = `前。\n\n${tag}\n\n後続。\nさらに後続。`;
				expect(targetBoundaryBarriers(text)).toEqual([{ start: 4, end: 4 + tag.length }]);
			}
		});
	it.each(["<br>", "<BR>", "<br title='x'>", "<br/>", '<img src="x">', '<IMG src="x" />', "<hr>", "<input>"])(
		"chunks ordinary paragraphs after blank-separated %s near the target", tag => {
			for (const target of [3000, 5000]) {
				const prefix = `前。\n\n${tag}\n\n`;
				const line = "後".repeat(99) + "\n";
				const text = prefix + line.repeat(160);
				const index = buildTargetLineIndex(text, 1);
				const chunks = planTargetLineChunks(index, target);
				expect(index.boundaries.filter(b => b.offset > prefix.length)).toHaveLength(160);
				expect(chunks.length).toBeGreaterThanOrEqual(4);
				for (const chunk of chunks.slice(0, -1)) expect(Math.abs(chunk.rawRange.end - chunk.rawRange.start - target)).toBeLessThanOrEqual(100);
				expect(chunks.at(-1)!.rawRange.end - chunks.at(-1)!.rawRange.start).toBeLessThanOrEqual(target);
				expectLineEquivalence(text, target);
			}
		});
	it.each(["<div>", "<SPAN>", "<script>", "<brick>", "<input-widget>", '<img src="unclosed'])(
		"keeps genuinely unclosed %s fail-closed", tag => {
			const prefix = "前。\n\n", text = prefix + tag + "\n\n" + "後続。\n".repeat(100);
			expect(targetBoundaryBarriers(text)).toEqual([{ start: prefix.length, end: text.length }]);
			const chunks = planTargetLineChunks(buildTargetLineIndex(text, 1), 20);
			for (const c of chunks) expect(c.rawRange.end <= prefix.length || c.rawRange.end === text.length).toBe(true);
			expectLineEquivalence(text, 20);
		});
});

describe("review regression: HTML whitespace in unquoted attributes", () => {
	it.each(["\n", "\r\n", "\r", "\f", "\t"])("terminates unquoted attributes and consumes separator %j", separator => {
		for (const name of ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])
			for (const tag of [
				`<${name} src=x${separator}alt=y>`,
				`<${name.toUpperCase()} src=x${separator}alt=y />`,
				`<${name} src=x${separator}alt${separator}=${separator}y${separator}>`,
			]) {
				const prefix = "前。\n\n", text = prefix + tag + "\n\n後続。\nさらに後続。\n";
				expect(targetBoundaryBarriers(text)).toEqual([{ start: prefix.length, end: prefix.length + tag.length }]);
				expectLineEquivalence(text, 8);
			}
	});
	it.each(["\n", "\r\n", "\r"])("keeps 16k following text chunkable after multiline void attributes with %j", newline => {
		for (const tag of [`<img src=x${newline}alt=y>`, `<IMG src=x${newline}alt=y />`])
			for (const target of [3000, 5000]) {
				const prefix = `前。${newline}${newline}${tag}${newline}${newline}`;
				const line = "後".repeat(100 - newline.length) + newline;
				const text = prefix + line.repeat(160);
				const index = buildTargetLineIndex(text, 1);
				const chunks = planTargetLineChunks(index, target);
				expect(index.boundaries.filter(b => b.offset > prefix.length)).toHaveLength(160);
				expect(chunks.length).toBeGreaterThanOrEqual(4);
				for (const chunk of chunks.slice(0, -1)) expect(Math.abs(chunk.rawRange.end - chunk.rawRange.start - target)).toBeLessThanOrEqual(100);
				expect(chunks.at(-1)!.rawRange.end - chunks.at(-1)!.rawRange.start).toBeLessThanOrEqual(target);
				expectLineEquivalence(text, target);
			}
	});
	it.each(["\n", "\r\n", "\r", "\f"])("keeps unclosed quoted values, tags and nonvoid elements fail-closed with %j", separator => {
		for (const tag of [`<img src="x${separator}alt=y>`, `<IMG src='x${separator}alt=y />`, `<img src=x${separator}alt=y`, `<div src=x${separator}alt=y>`]) {
			const prefix = "前。\n\n", text = prefix + tag + "\n\n" + "後続。\n".repeat(100);
			expect(targetBoundaryBarriers(text)).toEqual([{ start: prefix.length, end: text.length }]);
			for (const c of planTargetLineChunks(buildTargetLineIndex(text, 1), 30)) expect(c.rawRange.end <= prefix.length || c.rawRange.end === text.length).toBe(true);
			expectLineEquivalence(text, 30);
		}
	});
	it.each(["\v", "\u00a0", "\u3000"])("does not treat non-HTML whitespace %j as an attribute separator", separator => {
		const text = `<img src=x${separator}alt=y>\n\n後続。\n`;
		expect(targetBoundaryBarriers(text)).toEqual([{ start: 0, end: text.length }]);
	});
});
