import { describe, expect, it } from "vitest";
import { isFrontmatterOpenerLine, markdownLineEnd, projectMarkdownSource } from "../src/analysis/projectMarkdownSource";
import type { Utf16Range } from "../src/analysis/rubyAnalysis";
import {
	buildTargetBlockIndex, planTargetChunks, scanTargetChunks, targetChunkId,
	chunkRawText, toRawOffset, toRawRange,
	TargetChunkError, TARGET_CHUNK_IR_VERSION,
	type TargetChunkDescriptor, type TargetSnapshotIndex,
} from "../src/analysis/targetChunkIr";

const TARGETS = [3000, 5000] as const;
const DESCRIPTOR_KEYS = ["chunkId", "targetRevision", "rawRange", "blockRange", "status"];

/** Raw spans no boundary may cross, found in the raw text itself, not in the IR. */
function inviolableSpans(text: string): { label: string; start: number; end: number }[] {
	const patterns: [string, RegExp][] = [
		["aozora-short", /[\p{Script=Han}々〆ヶヵ]+《[^《》｜\r\n]+》/gu],
		["aozora-explicit", /｜[^《》｜\r\n]+《[^《》｜\r\n]+》/gu],
		["aozora-annotation", /※?［＃[^［］\r\n]*］(?:《[^《》｜\r\n]+》)?/gu],
		["html-ruby", /<ruby>(?:<rb>)?[^<]*(?:<\/rb>)?(?:<rp>[^<]*<\/rp>)?<rt>[^<]*<\/rt>(?:<rp>[^<]*<\/rp>)?<\/ruby>/gu],
		["embed", /!\[\[[^\]\r\n[]+\]\]/gu],
		["wikilink", /\[\[[^\]\r\n[]+\]\]/gu],
		["link", /\[[^\]\\\r\n[]*\]\([^()\s\\]*\)/gu],
		["code-span", /`+[^`\r\n]+`+/gu],
		["math-inline", /\$[^$\r\n]+\$/gu],
		["fence", /^ {0,3}(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}(?:`{3,}|~{3,})[^\n]*|$)/gmu],
		["html-comment", /<!--[\s\S]*?(?:-->|$)/gu],
		["obsidian-comment", /%%[\s\S]*?(?:%%|$)/gu],
		["display-math", /\$\$[\s\S]*?(?:\$\$|$)/gu],
		["raw-html-block", /<(script|style|div)\b[\s\S]*?(?:<\/\1>|$)/gu],
	];
	const spans: { label: string; start: number; end: number }[] = [];
	for (const [label, pattern] of patterns) {
		for (const match of text.matchAll(pattern)) spans.push({ label, start: match.index, end: match.index + match[0].length });
	}
	return spans;
}

/** Every contract that must hold for any non-empty snapshot, at any target size. */
function assertInvariants(text: string, descriptors: readonly TargetChunkDescriptor[], revision: number): void {
	const blocks = projectMarkdownSource(text, "target-prototype").presentation.blocks.map((b) => b.rawRange);
	const blockIndex = buildTargetBlockIndex(text, revision);
	if (!text.length) {
		expect(descriptors).toEqual([]);
		return;
	}
	expect(descriptors.length).toBeGreaterThan(0);
	expect(descriptors[0]!.rawRange.start).toBe(0);
	expect(descriptors.at(-1)!.rawRange.end).toBe(text.length);
	expect(descriptors[0]!.blockRange.start).toBe(0);
	expect(descriptors.at(-1)!.blockRange.end).toBe(blockIndex.blocks.length);
	let covered = "";
	for (const [i, descriptor] of descriptors.entries()) {
		expect(Object.keys(descriptor).sort()).toEqual([...DESCRIPTOR_KEYS].sort());
		expect(descriptor.status).toBe("unloaded");
		expect(descriptor.targetRevision).toBe(revision);
		expect(descriptor.chunkId).toBe(`chunk:${revision}:${i}`);
		expect(descriptor.rawRange.start).toBeLessThan(descriptor.rawRange.end);
		expect(descriptor.blockRange.start).toBeLessThan(descriptor.blockRange.end);
		const previous = descriptors[i - 1];
		if (previous) {
			expect(descriptor.rawRange.start).toBe(previous.rawRange.end);
			expect(descriptor.blockRange.start).toBe(previous.blockRange.end);
		}
		expect(blockIndex.blocks[descriptor.blockRange.start]!.rawRange.start).toBe(descriptor.rawRange.start);
		expect(blockIndex.blocks[descriptor.blockRange.end - 1]!.rawRange.end).toBe(descriptor.rawRange.end);
		covered += text.slice(descriptor.rawRange.start, descriptor.rawRange.end);
	}
	expect(covered).toBe(text);
	for (const descriptor of descriptors.slice(1)) {
		const at = descriptor.rawRange.start;
		// Never inside a surrogate pair.
		expect(text.charCodeAt(at - 1) >= 0xd800 && text.charCodeAt(at - 1) <= 0xdbff).toBe(false);
		// Always an edge the safe Target projection itself produced.
		expect(blocks.some((b) => b.start === at || b.end === at)).toBe(true);
		for (const span of inviolableSpans(text)) {
			expect({ at, crosses: at > span.start && at < span.end, label: span.label })
				.toEqual({ at, crosses: false, label: span.label });
		}
	}
}

const scanned = (text: string, size: number, revision = 7): readonly TargetChunkDescriptor[] => {
	const descriptors = scanTargetChunks(text, revision, size);
	assertInvariants(text, descriptors, revision);
	return descriptors;
};

const paragraph = (label: string, length: number): string => `${label}${"本".repeat(Math.max(0, length - label.length))}\n\n`;
const longBody = (count: number, length: number): string =>
	Array.from({ length: count }, (_, i) => paragraph(`段落${i}。`, length)).join("");

describe("Target Chunk IR version", () => {
	it("is a fixed internal contract", () => {
		expect(TARGET_CHUNK_IR_VERSION).toBe("target-chunk-ir-1");
	});
});

describe("CHUNK-01 boundary scanning", () => {
	it.each(TARGETS)("splits many paragraphs at safe boundaries for target %i", (size) => {
		const text = longBody(20, 900);
		const descriptors = scanned(text, size);
		expect(descriptors.length).toBeGreaterThan(2);
		for (const descriptor of descriptors.slice(0, -1)) {
			const length = descriptor.rawRange.end - descriptor.rawRange.start;
			expect(length).toBeGreaterThanOrEqual(size);
			// The first safe boundary after the target, not an arbitrary run-on.
			expect(length).toBeLessThan(size + 900 + 2);
		}
	});

	it.each(TARGETS)("splits mixed block kinds for target %i", (size) => {
		const text = [
			`# 見出し\n\n`, paragraph("序文。", 1200), "- 項目1\n- 項目2\n\n",
			"```js\nconst a = 1;\n```\n\n", paragraph("本文。", 2500), "> 引用文。\n\n",
			paragraph("中盤。", 4000), "| a | b |\n\n", paragraph("転。", 3500),
			"<!-- 注釈 -->\n\n", paragraph("結び。", 4000),
		].join("");
		const descriptors = scanned(text, size);
		expect(descriptors.length).toBeGreaterThan(1);
	});

	it("closes exactly at a boundary that already falls on the target", () => {
		// Two 1,500-code-unit blocks: the first boundary at or after 3,000 is the
		// end of the second block, so the third block must not be pulled in.
		const block = `${"本".repeat(1498)}\n\n`;
		const text = block.repeat(4);
		const descriptors = scanned(text, 3000);
		expect(descriptors.map((d) => d.rawRange)).toEqual([{ start: 0, end: 3000 }, { start: 3000, end: 6000 }]);
		expect(descriptors.map((d) => d.blockRange)).toEqual([{ start: 0, end: 4 }, { start: 4, end: 8 }]);
	});

	it("extends past a target that falls inside a block", () => {
		const text = `${"本".repeat(2000)}\n\n${"文".repeat(2000)}\n\n${"字".repeat(500)}\n`;
		const descriptors = scanned(text, 3000);
		expect(descriptors[0]!.rawRange.end).toBe(4004);
		expect(descriptors).toHaveLength(2);
	});

	it("keeps a Chunk identity that depends only on revision and canonical index", () => {
		expect(targetChunkId(0, 0)).toBe("chunk:0:0");
		expect(targetChunkId(12, 3)).toBe("chunk:12:3");
	});
});

describe("CHUNK-02 non-splitting guarantees", () => {
	it.each(TARGETS)("keeps one huge paragraph whole at target %i", (size) => {
		const text = `${"巨".repeat(size * 3)}\n\n${paragraph("次。", 100)}`;
		const descriptors = scanned(text, size);
		expect(descriptors[0]!.rawRange).toEqual({ start: 0, end: size * 3 + 2 });
		expect(descriptors[0]!.blockRange).toEqual({ start: 0, end: 2 });
	});

	it("keeps a huge fenced code block whole", () => {
		const code = Array.from({ length: 400 }, (_, i) => `const value${i} = ${i};`).join("\n");
		const text = `${paragraph("前文。", 100)}\`\`\`js\n${code}\n\`\`\`\n\n${paragraph("後文。", 100)}`;
		const descriptors = scanned(text, 3000);
		const fenceStart = text.indexOf("```js");
		const fenceEnd = text.indexOf("```\n\n後文") + 3;
		expect(descriptors.some((d) => d.rawRange.start > fenceStart && d.rawRange.start < fenceEnd)).toBe(false);
	});

	it.each(TARGETS)("never splits Aozora Ruby at target %i", (size) => {
		const dense = "漢字《かんじ》｜親文字《おやもじ》歩《ある》く走《はし》る言葉《ことば》。\n";
		const text = `${dense.repeat(200)}\n${paragraph("普通の段落。", 200)}`;
		const descriptors = scanned(text, size);
		expect(descriptors.length).toBeGreaterThan(1);
	});

	it("never splits HTML ruby", () => {
		const line = "<ruby>漢<rt>かん</rt></ruby>字と<ruby><rb>親</rb><rp>(</rp><rt>おや</rt><rp>)</rp></ruby>文字。\n";
		scanned(`${line.repeat(120)}\n${paragraph("後。", 300)}`, 3000);
	});

	it("never splits an Aozora external-character annotation", () => {
		const line = "文字※［＃「口＋禺」、第3水準1-15-9］《ぐう》の話。\n";
		scanned(`${line.repeat(200)}\n${paragraph("後。", 300)}`, 3000);
	});

	it.each(TARGETS)("never splits protected regions at target %i", (size) => {
		const line = "![[image.png]]と[link](http://example.com)と`code span`と$x=1$と[[note]]。\n";
		scanned(`${line.repeat(150)}\n${paragraph("後。", 300)}`, size);
	});

	it("never splits a closed multi-line construct", () => {
		const text = [
			paragraph("前。", 2000), "<!-- 注釈\n複数行\nまだ続く\n-->\n\n", paragraph("中。", 2000),
			"$$\nx = 1\ny = 2\n$$\n\n", "%%\nObsidian comment\n%%\n\n", paragraph("後。", 2000),
		].join("");
		scanned(text, 3000);
	});

	it.each([
		["html-comment", "<!-- 閉じない注釈\n続きの行\nさらに行\n"],
		["obsidian-comment", "%%\n閉じないObsidian注釈\nさらに行\n"],
		["display-math", "$$\nx = 1\n閉じない数式\n"],
		["raw-html", "<div>\n閉じないHTML\nさらに行\n"],
		["ruby", "本文《閉じない読み\n続きの行\nさらに行\n"],
	])("never splits an unclosed %s that runs to EOF", (_label, tail) => {
		const text = `${paragraph("前文。", 3500)}${tail}`;
		const descriptors = scanned(text, 3000);
		const open = text.length - tail.length;
		expect(descriptors.some((d) => d.rawRange.start > open)).toBe(false);
	});

	it.each(TARGETS)("never splits a surrogate pair near the target at %i", (size) => {
		for (let offset = -4; offset <= 4; offset += 1) {
			const text = `${"あ".repeat(size + offset)}${"😀".repeat(40)}\n\n${paragraph("後。", 200)}`;
			scanned(text, size);
		}
	});
});

describe("raw UTF-16 coverage", () => {
	it("keeps CRLF, blank lines and trailing whitespace inside the coverage", () => {
		const text = `\r\n\r\n${paragraph("本文。", 1000).replace(/\n/g, "\r\n")}\r\n\r\n   \r\n${paragraph("次。", 1000).replace(/\n/g, "\r\n")}\r\n\r\n`;
		const descriptors = scanned(text, 500);
		expect(descriptors[0]!.rawRange.start).toBe(0);
		expect(descriptors.at(-1)!.rawRange.end).toBe(text.length);
	});

	it("keeps leading and trailing blank lines", () => {
		const text = `\n\n\n${paragraph("本文。", 100)}\n\n  \n`;
		const descriptors = scanned(text, 50);
		expect(text.slice(descriptors[0]!.rawRange.start, descriptors[0]!.rawRange.end)).toBe(text);
	});

	it("returns no descriptor for an empty Target", () => {
		expect(scanTargetChunks("", 1, 3000)).toEqual([]);
		const index = buildTargetBlockIndex("", 1);
		expect({ rawText: index.rawText, rawLength: index.rawLength, blocks: index.blocks })
			.toEqual({ rawText: "", rawLength: 0, blocks: [] });
	});

	it("returns one Chunk for a single character and for short text", () => {
		expect(scanned("あ", 3000)).toHaveLength(1);
		expect(scanned(`${paragraph("短い。", 50)}${paragraph("文。", 50)}`, 3000)).toHaveLength(1);
	});

	it("covers an entirely blank Target as one Chunk", () => {
		const text = "\n\n   \n\n";
		const descriptors = scanned(text, 3000);
		expect(descriptors).toHaveLength(1);
		expect(descriptors[0]!.rawRange).toEqual({ start: 0, end: text.length });
	});
});

describe("boundary-only retention", () => {
	const forge = (value: unknown): TargetSnapshotIndex => value as TargetSnapshotIndex;
	const text = `${longBody(6, 900)}漢字《かんじ》と![[image.png]]と\`code\`。\n`;

	it("keeps no full-text analysis, binding, presentation or Ruby mapping", () => {
		const index = buildTargetBlockIndex(text, 1);
		expect(Object.keys(index).sort()).toEqual(["blocks", "rawLength", "rawText", "targetRevision"]);
		for (const block of index.blocks) expect(Object.keys(block).sort()).toEqual(["kind", "rawRange"]);
	});

	it("has no reachable AnalysisDocument, Token or display plan from an unloaded state", () => {
		const index = buildTargetBlockIndex(text, 1);
		const descriptors = planTargetChunks(index, 3000);
		const seen = new Set<object>();
		const walk = (value: unknown, path: string): void => {
			if (value === null || typeof value !== "object" || seen.has(value)) return;
			seen.add(value);
			for (const [key, child] of Object.entries(value)) {
				expect({ path: `${path}.${key}`, forbidden: /^(document|runs|segments|bindings|exclusions|presentation|decorations|annotations|tokens|analysis|displayPlan|slots|root|policyVersion)$/u.test(key) })
					.toEqual({ path: `${path}.${key}`, forbidden: false });
				walk(child, `${path}.${key}`);
			}
		};
		walk(index, "index");
		for (const descriptor of descriptors) walk(descriptor, descriptor.chunkId);
		// The whole retained graph is small because it is boundary metadata only.
		expect(seen.size).toBeLessThan(index.blocks.length * 4);
	});

	it("slices a Chunk's raw text only for a descriptor of that same index", () => {
		const index = buildTargetBlockIndex(text, 1);
		const descriptors = planTargetChunks(index, 3000);
		expect(descriptors.map((d) => chunkRawText(index, d)).join("")).toBe(text);
		const other = buildTargetBlockIndex(text, 2);
		expect(() => chunkRawText(other, descriptors[0]!)).toThrow(TargetChunkError);
		expect(() => chunkRawText(forge({ ...index }), descriptors[0]!)).toThrow(TargetChunkError);
	});

	it("maps Chunk-local offsets back to raw absolute offsets without re-searching text", () => {
		const index = buildTargetBlockIndex(text, 1);
		const descriptor = planTargetChunks(index, 3000).at(-1)!;
		expect(toRawOffset(descriptor, 0)).toBe(descriptor.rawRange.start);
		const length = descriptor.rawRange.end - descriptor.rawRange.start;
		expect(toRawOffset(descriptor, length)).toBe(descriptor.rawRange.end);
		expect(toRawRange(descriptor, { start: 2, end: 5 })).toEqual({ start: descriptor.rawRange.start + 2, end: descriptor.rawRange.start + 5 });
		expect(() => toRawOffset(descriptor, length + 1)).toThrow(TargetChunkError);
		expect(() => toRawOffset(descriptor, -1)).toThrow(TargetChunkError);
		expect(() => toRawRange(descriptor, { start: 5, end: 2 })).toThrow(TargetChunkError);
	});
});

/** Blocks and protected / syntax ranges of `range` alone, mapped back, equal the whole-snapshot result. */
function expectRangeEquivalence(text: string, whole: ReturnType<typeof projectMarkdownSource>, range: Utf16Range): void {
	const inside = (r: Utf16Range): boolean => r.start >= range.start && r.end <= range.end;
	const sliced = projectMarkdownSource(text.slice(range.start, range.end), "target-prototype");
	const shift = (r: Utf16Range): Utf16Range => ({ start: r.start + range.start, end: r.end + range.start });
	expect({ range, blocks: sliced.presentation.blocks.map((b) => shift(b.rawRange)) })
		.toEqual({ range, blocks: whole.presentation.blocks.filter((b) => inside(b.rawRange)).map((b) => shift({ start: b.rawRange.start - range.start, end: b.rawRange.end - range.start })) });
	expect({ range, exclusions: sliced.exclusions.map((e) => ({ ...shift(e.range), reason: e.reason })) })
		.toEqual({ range, exclusions: whole.exclusions.filter((e) => inside(e.range)).map((e) => ({ start: e.range.start, end: e.range.end, reason: e.reason })) });
}

/**
 * What CHUNK-VIEW1 will actually do: slice one Chunk's raw range and project
 * that slice alone, then map its ranges back through the offset adapter.
 */
function expectSliceEquivalence(text: string, targetSize: number): void {
	const index = buildTargetBlockIndex(text, 1);
	const whole = projectMarkdownSource(text, "target-prototype");
	const inside = (range: Utf16Range, descriptor: TargetChunkDescriptor): boolean =>
		range.start >= descriptor.rawRange.start && range.end <= descriptor.rawRange.end;
	for (const descriptor of planTargetChunks(index, targetSize)) {
		const sliced = projectMarkdownSource(chunkRawText(index, descriptor), "target-prototype");
		expect({ at: descriptor.rawRange, blocks: sliced.presentation.blocks.map((b) => toRawRange(descriptor, b.rawRange)) })
			.toEqual({ at: descriptor.rawRange, blocks: whole.presentation.blocks.filter((b) => inside(b.rawRange, descriptor)).map((b) => ({ start: b.rawRange.start, end: b.rawRange.end })) });
		expect({ at: descriptor.rawRange, exclusions: sliced.exclusions.map((e) => ({ ...toRawRange(descriptor, e.range), reason: e.reason })) })
			.toEqual({ at: descriptor.rawRange, exclusions: whole.exclusions.filter((e) => inside(e.range, descriptor)).map((e) => ({ start: e.range.start, end: e.range.end, reason: e.reason })) });
	}
}

describe("Chunk slice matches the whole-document projection", () => {
	const fixtures: [string, string][] = [
		["plain paragraphs", longBody(8, 700)],
		["Ruby dense", `${"漢字《かんじ》｜親文字《おやもじ》歩《ある》く。\n".repeat(200)}\n${longBody(2, 500)}`],
		["protected regions", `${`![[image.png]]と[link](http://example.com)と${"`"}code${"`"}と$x=1$。\n`.repeat(150)}\n${longBody(2, 500)}`],
		["headings and fences", `${longBody(3, 900)}# 見出し\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\n${longBody(3, 900)}`],
		["CRLF", longBody(8, 700).replace(/\n/gu, "\r\n")],
	];

	// Every character JavaScript `\s` accepts that does not end a parser line.
	const LINE_WHITESPACE = [" ", "\t", "\v", "\f", " ", " ", " ", " ", " ",
		" ", " ", " ", " ", "　", "﻿"];

	it.each(LINE_WHITESPACE.map((c) => [c.codePointAt(0)!.toString(16).padStart(4, "0"), c]))(
		"never starts a Chunk on a frontmatter opener with trailing U+%s", (_code, whitespace) => {
			for (const newline of ["\n", "\r\n"]) {
				const opener = `---${whitespace}`;
				expect(isFrontmatterOpenerLine(opener)).toBe(true);
				const text = [longBody(2, 40), `${opener}${newline}${newline}`, longBody(3, 40)].join("").replace(/\n/gu, newline);
				const index = buildTargetBlockIndex(text, 1);
				for (const size of [1, 2, 5, 13, 40, 90]) {
					for (const descriptor of planTargetChunks(index, size).slice(1)) {
						const slice = chunkRawText(index, descriptor);
						expect(isFrontmatterOpenerLine(slice.slice(0, markdownLineEnd(slice, 0)))).toBe(false);
					}
					expectSliceEquivalence(text, size);
				}
			}
		});

	it.each([["BOM", "﻿---"], ["BOM and space", "﻿--- "]])("never starts a Chunk on a %s frontmatter opener", (_label, opener) => {
		const text = `${longBody(2, 40)}${opener}\n\n${longBody(3, 40)}`;
		for (const size of [1, 5, 40]) expectSliceEquivalence(text, size);
		const index = buildTargetBlockIndex(text, 1);
		expect(planTargetChunks(index, 1).some((d) => chunkRawText(index, d).startsWith(opener))).toBe(false);
	});

	it.each([["--- text"], ["---  text"], ["---\t\ttext"], ["---x"], ["----"], ["-- -"], [" ---x"]])("still allows a Chunk to start on non-frontmatter %j", (line) => {
		expect(isFrontmatterOpenerLine(line)).toBe(false);
		const text = `${longBody(1, 40)}${line}\n\n${longBody(1, 40)}`;
		const index = buildTargetBlockIndex(text, 1);
		// The boundary is not forbidden just because the line looks similar.
		expect(planTargetChunks(index, 1).some((d) => chunkRawText(index, d).startsWith(`${line}\n`))).toBe(true);
		expectSliceEquivalence(text, 1);
	});

	it("never starts a Chunk inside one paragraph range", () => {
		// Found by checking every start/end block pair: the slice's first line
		// would take the paragraph-opening path and protect to the range end.
		const text = "普通の段落です。\n    <!-- open\n本文<!-- open\n-->\n》閉じ\n- 項目\n--- text\n    <!-- open\n";
		const index = buildTargetBlockIndex(text, 1);
		expect(index.blocks.length).toBeGreaterThan(1);
		for (let size = 1; size <= text.length; size += 1) {
			for (const descriptor of planTargetChunks(index, size).slice(1)) {
				expect(index.blocks[descriptor.blockRange.start - 1]!.kind).toBe("separator");
			}
			expectSliceEquivalence(text, size);
		}
	});

	it("parses every slice that starts after a blank separator exactly as the whole snapshot", () => {
		// The soundness of the start rule itself, over every start/end block pair
		// it permits, independent of any target size.
		const FRAGMENTS = [
			"普通の段落です。", "漢字《かんじ》", "本文《よみ", "》閉じ", "", "", "<!-- open", "本文<!-- open", "    <!-- open", "-->",
			"$$", "x=1", "%%", "<div>本文", "</div>", "- 項目", "> 引用", "    indented", "```", "# 見出し",
			"---", "--- ", "--- ", "---　", "﻿---", "--- text", "----", "![[x.png]]", "`code`", "絵文字😀です",
		];
		let seed = 2026;
		const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
		let checked = 0;
		for (let iteration = 0; iteration < 3000; iteration += 1) {
			const lines: string[] = [];
			for (let k = 0, n = 2 + Math.floor(rnd() * 9); k < n; k += 1) lines.push(FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]!);
			const text = lines.join(rnd() < 0.25 ? "\r\n" : "\n") + "\n";
			const whole = projectMarkdownSource(text, "target-prototype");
			const { blocks } = buildTargetBlockIndex(text, 1);
			for (let first = 0; first < blocks.length; first += 1) {
				const start = blocks[first]!.rawRange.start;
				if (first > 0 && (blocks[first - 1]!.kind !== "separator" ||
					isFrontmatterOpenerLine(text.slice(start, markdownLineEnd(text, start))))) continue;
				for (let last = first; last < blocks.length; last += 1) {
					expectRangeEquivalence(text, whole, { start, end: blocks[last]!.rawRange.end });
					checked += 1;
				}
			}
		}
		expect(checked).toBeGreaterThan(5000);
	});

	it("holds for planned Chunks over randomly combined Markdown lines", () => {
		const FRAGMENTS = [
			"普通の段落です。", "漢字《かんじ》", "｜親文字《よみ》", "本文《よみ", "", "", "<!-- open", "本文<!-- open", "    <!-- open", "-->",
			"$$", "%%", "<div>", "</div>", "- 項目", "> 引用", "1. 番号", "---", "﻿---", "--- ", "--- ", "---　",
			"--- text", "----", "===", "```", "~~~", "    indented", "# 見出し", "| a | b |", "![[x.png]]", "[link](http://x)",
			"`code`", "==highlight==", "※［＃「口＋禺」、第3水準1-15-9］《ぐう》", "<ruby>漢<rt>かん</rt></ruby>", "絵文字😀です",
			"末尾空白 ", "**強調**", "\\《esc", "😀《よみ》",
		];
		let seed = 999;
		const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
		for (let iteration = 0; iteration < 1500; iteration += 1) {
			const lines: string[] = [];
			for (let k = 0, n = 1 + Math.floor(rnd() * 12); k < n; k += 1) lines.push(FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]!);
			const text = lines.join(rnd() < 0.25 ? "\r\n" : "\n") + (rnd() < 0.5 ? "\n" : "");
			for (const size of [1, 3, 8, 21, 55]) expectSliceEquivalence(text, size);
		}
	});

	it.each(fixtures)("%s: every Chunk re-projects to the same safe ranges", (_label, text) => {
		expectSliceEquivalence(text, 3000);
	});
});

describe("descriptor ownership", () => {
	const forgeDescriptor = (value: unknown): TargetChunkDescriptor => value as TargetChunkDescriptor;

	it("refuses a descriptor planned from another index with the same revision", () => {
		const a = buildTargetBlockIndex("甲。\n\n甲の続き。\n", 1);
		const b = buildTargetBlockIndex("乙。\n\n乙の続き。\n", 1);
		const descriptor = planTargetChunks(a, 1)[0]!;
		expect(chunkRawText(a, descriptor)).toBe("甲。\n\n");
		expect(() => chunkRawText(b, descriptor)).toThrow(TargetChunkError);
	});

	it("refuses a descriptor planned from the same text in another index", () => {
		const text = "同じ本文。\n\n続き。\n";
		const a = buildTargetBlockIndex(text, 1);
		const b = buildTargetBlockIndex(text, 1);
		expect(() => chunkRawText(b, planTargetChunks(a, 1)[0]!)).toThrow(TargetChunkError);
	});

	it("refuses cloned and hand-built descriptors for slicing and offsets", () => {
		const index = buildTargetBlockIndex("甲。\n\n甲の続き。\n", 1);
		const real = planTargetChunks(index, 1)[0]!;
		const fakes = [
			forgeDescriptor({ ...real }),
			forgeDescriptor(JSON.parse(JSON.stringify(real))),
			forgeDescriptor({ chunkId: "chunk:1:0", targetRevision: 1, rawRange: { start: 0, end: 4 }, blockRange: { start: 0, end: 2 }, status: "unloaded" }),
		];
		for (const fake of fakes) {
			expect(() => chunkRawText(index, fake)).toThrow(TargetChunkError);
			expect(() => toRawOffset(fake, 0)).toThrow(TargetChunkError);
			expect(() => toRawRange(fake, { start: 0, end: 1 })).toThrow(TargetChunkError);
		}
	});

	it("accepts every descriptor its own index planned, across repeated plans", () => {
		const text = longBody(6, 900);
		const index = buildTargetBlockIndex(text, 3);
		for (const size of [3000, 5000]) {
			const descriptors = planTargetChunks(index, size);
			expect(descriptors.map((d) => chunkRawText(index, d)).join("")).toBe(text);
		}
	});
});

describe("determinism and identity", () => {
	const text = longBody(12, 800);

	it("produces the same descriptors from the same text, revision and size", () => {
		expect(scanTargetChunks(text, 4, 3000)).toEqual(scanTargetChunks(text, 4, 3000));
		expect(scanTargetChunks(text, 4, 3000)).not.toEqual(scanTargetChunks(text, 4, 5000));
	});

	it("changes only the identity when the Target revision changes", () => {
		const first = scanTargetChunks(text, 1, 3000);
		const second = scanTargetChunks(text, 2, 3000);
		expect(second.map((d) => d.chunkId)).not.toEqual(first.map((d) => d.chunkId));
		expect(second.map((d) => d.rawRange)).toEqual(first.map((d) => d.rawRange));
		expect(second.map((d) => d.blockRange)).toEqual(first.map((d) => d.blockRange));
		expect(second.map((d) => d.chunkId)).toEqual(first.map((_, i) => `chunk:2:${i}`));
	});

	it("takes no display surface, Semantropy value or nonce as input", () => {
		expect(scanTargetChunks.length).toBe(3);
		expect(planTargetChunks.length).toBe(2);
		const source = String(scanTargetChunks) + String(planTargetChunks) + String(buildTargetBlockIndex);
		expect(source).not.toMatch(/semantropy|nonce|random|token|surface|display/i);
	});
});

describe("unloaded descriptors carry boundary metadata only", () => {
	it("has no analysis, Token, DOM or interaction field, and is frozen", () => {
		const descriptors = scanned(longBody(8, 900), 3000);
		for (const descriptor of descriptors) {
			expect(Object.keys(descriptor)).toEqual(DESCRIPTOR_KEYS);
			expect(Object.isFrozen(descriptor)).toBe(true);
			expect(Object.isFrozen(descriptor.rawRange)).toBe(true);
			const serialized = JSON.stringify(descriptor);
			expect(serialized).not.toMatch(/analysis|token|plan|slot|node|listener|selection|hover|override|ruby/i);
		}
	});
});

describe("fixed safe failures", () => {
	const index = buildTargetBlockIndex(longBody(4, 100), 1);
	const forge = (value: unknown): TargetSnapshotIndex => value as TargetSnapshotIndex;

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses target size %s", (size) => {
		expect(() => planTargetChunks(index, size)).toThrow(TargetChunkError);
	});

	it.each([-1, 2.5, Number.NaN])("refuses revision %s at mint time", (revision) => {
		expect(() => buildTargetBlockIndex("本文。", revision)).toThrow(TargetChunkError);
		expect(() => targetChunkId(revision, 0)).toThrow(TargetChunkError);
	});

	it.each([
		["a gap", [{ rawRange: { start: 0, end: 4 }, kind: "content" }, { rawRange: { start: 6, end: 10 }, kind: "content" }]],
		["an overlap", [{ rawRange: { start: 0, end: 6 }, kind: "content" }, { rawRange: { start: 4, end: 10 }, kind: "content" }]],
		["an empty block", [{ rawRange: { start: 0, end: 0 }, kind: "content" }, { rawRange: { start: 0, end: 4 }, kind: "content" }]],
		["a surrogate-pair split", [{ rawRange: { start: 0, end: 1 }, kind: "content" }, { rawRange: { start: 1, end: 2 }, kind: "content" }]],
		["no block at all", []],
	] as const)("refuses a hand-built block index with %s", (_label, blocks) => {
		const text = "😀".repeat(5);
		expect(() => planTargetChunks(forge({ rawText: text, rawLength: text.length, targetRevision: 1, blocks }), 1))
			.toThrow(TargetChunkError);
	});

	it("refuses a structural copy or a mutated clone of a real index", () => {
		expect(() => planTargetChunks(forge({ ...index }), 3000)).toThrow(TargetChunkError);
		expect(() => planTargetChunks(forge({ ...index, blocks: index.blocks.slice(0, 1) }), 3000)).toThrow(TargetChunkError);
		expect(() => planTargetChunks(forge(JSON.parse(JSON.stringify(index))), 3000)).toThrow(TargetChunkError);
	});

	it("keeps full coverage for malformed Markdown instead of falling back to fixed length", () => {
		const text = [
			"本文《壊れた\n", "｜《\n", "<ruby>不正<rt>\n", "※［＃閉じない\n", "\n", "<div>\n",
			`${"長".repeat(9000)}\n`, "</div>\n", "\n", "$$\n", "未閉鎖\n",
		].join("");
		const descriptors = scanned(text, 3000);
		expect(descriptors.length).toBeGreaterThan(0);
	});

	it("returns no partial descriptor when it refuses", () => {
		for (const attempt of [(): unknown => planTargetChunks(index, 0), (): unknown => planTargetChunks(forge({ ...index }), 3000)]) {
			let returned: unknown = "not called";
			try { returned = attempt(); } catch (error) { expect(error).toBeInstanceOf(TargetChunkError); }
			expect(returned).toBe("not called");
		}
	});
});

describe("snapshot provenance", () => {
	const forge = (value: unknown): TargetSnapshotIndex => value as TargetSnapshotIndex;

	it("has no path that relabels a minted index with another revision", () => {
		const stale = buildTargetBlockIndex("古い本文", 7);
		// The revision is the index's own; there is no second argument to override it.
		expect(planTargetChunks).toHaveLength(2);
		expect(stale.targetRevision).toBe(7);
		expect(planTargetChunks(stale, 1).every((d) => d.targetRevision === 7 && d.chunkId.startsWith("chunk:7:"))).toBe(true);
		// Re-stamping the frozen index, or copying it with a new revision, is refused.
		expect(() => { (stale as { targetRevision: number }).targetRevision = 42; }).toThrow(TypeError);
		expect(stale.targetRevision).toBe(7);
		expect(() => planTargetChunks(forge({ ...stale, targetRevision: 42 }), 1)).toThrow(TargetChunkError);
		// A new revision requires a new index, which re-reads the current raw text.
		expect(planTargetChunks(buildTargetBlockIndex("新しい本文", 42), 1)[0]!.chunkId).toBe("chunk:42:0");
	});

	it("cannot pair a snapshot with another Target revision's projection", () => {
		// The reported P1 case: an equally long, perfectly valid projection of a
		// different Target. There is no API that accepts the pair at all.
		const stale = buildTargetBlockIndex("a\n\nbbbb", 1);
		const current = "漢字《かんじ》";
		expect(stale.rawText).toHaveLength(current.length);
		expect(() => planTargetChunks(forgeIndex(current, stale.blocks), 1)).toThrow(TargetChunkError);
		expect(buildTargetBlockIndex).toHaveLength(2);
	});

	it("never splits a Ruby pair when the current raw text is the only source of truth", () => {
		const current = "漢字《かんじ》";
		const descriptors = scanned(current, 1);
		expect(descriptors).toHaveLength(1);
		expect(descriptors[0]!.rawRange).toEqual({ start: 0, end: current.length });
	});

	it("puts no boundary between an Aozora base, marker and reading at the smallest target", () => {
		const text = "漢字《かんじ》と歩《ある》く。\n\n次の段落《だんらく》。\n";
		for (const descriptor of scanned(text, 1).slice(1)) {
			for (const marker of ["《", "》"]) {
				let at = text.indexOf(marker);
				while (at !== -1) {
					expect(descriptor.rawRange.start).not.toBe(at + 1);
					at = text.indexOf(marker, at + 1);
				}
			}
		}
	});

	it("puts no boundary inside a surrogate pair at the smallest target", () => {
		const text = "😀😀😀\n\n😀🎌👩‍👩‍👧‍👦\n";
		for (const descriptor of scanned(text, 1)) {
			for (const at of [descriptor.rawRange.start, descriptor.rawRange.end]) {
				expect(at === 0 || at === text.length || !(text.charCodeAt(at - 1) >= 0xd800 && text.charCodeAt(at - 1) <= 0xdbff)).toBe(true);
			}
		}
	});

	it("projects the current snapshot itself rather than trusting a caller's parse", () => {
		const text = "漢字《かんじ》\n\n段落。\n";
		const index = buildTargetBlockIndex(text, 1);
		expect(index.rawText).toBe(text);
		expect(index.blocks[0]!.rawRange).toEqual({ start: 0, end: 8 });
		expect(Object.isFrozen(index)).toBe(true);
	});
});

const forgeIndex = (rawText: string, blocks: unknown): TargetSnapshotIndex =>
	({ rawText, rawLength: rawText.length, targetRevision: 1, blocks }) as TargetSnapshotIndex;
