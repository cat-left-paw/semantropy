import { describe, expect, it } from "vitest";
import {
	closedCodeSpanEnd, hasActiveContinuationCloser, isActiveOpenerIndex, unclosedContinuations,
} from "../src/analysis/activeContinuation";

describe("active vs inert continuation markers", () => {
	it("treats matching code spans as inert, including %% $$ <!-- <script> and 《", () => {
		for (const [line, marker] of [
			["| 記法 | `%%` |", "%%"],
			["| 記法 | `$$` |", "$$"],
			["| 記法 | `<!--` |", "<!--"],
			["| 記法 | `<script>` |", "<script>"],
			["| 記法 | `《` |", "《"],
		] as const) {
			const at = line.indexOf(marker);
			expect(at).toBeGreaterThan(-1);
			expect(isActiveOpenerIndex(line, at)).toBe(false);
			expect(unclosedContinuations(line)).toEqual([]);
		}
	});

	it("does not count a Ruby opener escaped with an odd number of backslashes", () => {
		const escaped = "| 記法 | \\《 |";
		expect(escaped.includes("\\《")).toBe(true);
		expect(isActiveOpenerIndex(escaped, escaped.indexOf("《"))).toBe(false);
		expect(unclosedContinuations(escaped)).toEqual([]);
		const active = "| 記法 | \\\\《 |";
		expect(isActiveOpenerIndex(active, active.indexOf("《"))).toBe(true);
		expect(unclosedContinuations(active)).toEqual([{ kind: "ruby" }]);
	});

	it("matches code spans by delimiter length, so inner backticks of another length stay content", () => {
		const line = "| 記法 | `` `%%` `` |";
		expect(closedCodeSpanEnd(line, line.indexOf("``"))).toBe(line.indexOf("``", line.indexOf("%%")) + 2);
		expect(isActiveOpenerIndex(line, line.indexOf("%%"))).toBe(false);
		expect(unclosedContinuations(line)).toEqual([]);
		expect(closedCodeSpanEnd("`%%`", 0)).toBe(4);
		expect(closedCodeSpanEnd("``%%`", 0)).toBeNull();
	});

	it("still reports a genuine opener that follows inert code or an escape on the same line", () => {
		const afterCode = "| x | `%%` <!-- 犬";
		expect(isActiveOpenerIndex(afterCode, afterCode.indexOf("%%"))).toBe(false);
		expect(unclosedContinuations(afterCode)).toEqual([{ kind: "html-comment" }]);
		const afterEscape = "| x | \\《 本当《ねこ";
		expect(isActiveOpenerIndex(afterEscape, afterEscape.indexOf("《"))).toBe(false);
		expect(isActiveOpenerIndex(afterEscape, afterEscape.lastIndexOf("《"))).toBe(true);
		expect(unclosedContinuations(afterEscape)).toEqual([{ kind: "ruby" }]);
	});

	it("does not treat an inert closer as closing a previous construct", () => {
		expect(hasActiveContinuationCloser("`%%`", "obsidian-comment")).toBe(false);
		expect(hasActiveContinuationCloser("`$$`", "display-math")).toBe(false);
		expect(hasActiveContinuationCloser("`-->`", "html-comment")).toBe(false);
		expect(hasActiveContinuationCloser("`<script>`", { rawHtml: "script" })).toBe(false);
		expect(hasActiveContinuationCloser("`》`", "ruby")).toBe(false);
		expect(hasActiveContinuationCloser("\\》", "ruby")).toBe(false);
		expect(hasActiveContinuationCloser("鳥 %%", "obsidian-comment")).toBe(true);
		expect(hasActiveContinuationCloser("鳥 -->", "html-comment")).toBe(true);
		expect(hasActiveContinuationCloser("</script>", { rawHtml: "script" })).toBe(true);
	});

	it("keeps ordinary-text unclosed HTML comments, raw-text HTML, %%, $$ and Ruby active", () => {
		expect(unclosedContinuations("<!-- 犬")).toEqual([{ kind: "html-comment" }, { kind: "html-block" }]);
		expect(unclosedContinuations("<script>")).toEqual([{ kind: "raw-html", tag: "script" }, { kind: "html-block" }]);
		expect(unclosedContinuations("%% 犬")).toEqual([{ kind: "obsidian-comment" }]);
		expect(unclosedContinuations("$$")).toEqual([{ kind: "display-math" }]);
		expect(unclosedContinuations("猫《ねこ")).toEqual([{ kind: "ruby" }]);
		expect(unclosedContinuations("<!-- 犬 -->")).toEqual([{ kind: "html-block" }]);
		expect(unclosedContinuations("<script></script>")).toEqual([]);
		expect(unclosedContinuations("<div>")).toEqual([{ kind: "html-block" }]);
		expect(unclosedContinuations("%% 犬 %%")).toEqual([]);
		expect(unclosedContinuations("$$ 犬 $$")).toEqual([]);
		expect(unclosedContinuations("猫《ねこ》")).toEqual([]);
	});

	it("treats quoted HTML attribute values as inert, including %%, $$, 《, <!-- and <script>", () => {
		for (const [line, marker] of [
			['<span title="%%">犬</span>', "%%"],
			['<span title="$$">犬</span>', "$$"],
			['<span title="《">犬</span>', "《"],
			['<span title="<!--">犬</span>', "<!--"],
			['<span title="<script>">犬</span>', "<script>"],
			["<span title='%%'>犬</span>", "%%"],
		] as const) {
			const at = line.indexOf(marker);
			expect(at).toBeGreaterThan(-1);
			expect(isActiveOpenerIndex(line, at)).toBe(false);
			expect(unclosedContinuations(line)).toEqual([]);
		}
		const withGt = '<span title="a>b">犬</span>';
		expect(unclosedContinuations(withGt)).toEqual([]);
		const script = '<script data-x="%%">';
		expect(isActiveOpenerIndex(script, script.indexOf("%%"))).toBe(false);
		expect(unclosedContinuations(script)).toEqual([{ kind: "raw-html", tag: "script" }, { kind: "html-block" }]);
		const afterTag = "x </span> %%";
		expect(isActiveOpenerIndex(afterTag, afterTag.indexOf("%%"))).toBe(true);
		expect(unclosedContinuations(afterTag)).toEqual([{ kind: "obsidian-comment" }]);
	});

	it("treats unquoted HTML attribute values as inert", () => {
		for (const [line, marker] of [
			["<span title=%%>犬</span>", "%%"],
			["<span title=$$>犬</span>", "$$"],
			["<span title=《>犬</span>", "《"],
		] as const) {
			const at = line.indexOf(marker);
			expect(at).toBeGreaterThan(-1);
			expect(isActiveOpenerIndex(line, at)).toBe(false);
			expect(unclosedContinuations(line)).toEqual([]);
		}
	});

	it("does not pair a code span across an HTML attribute boundary", () => {
		const line = '<span title="`"></span> %% `';
		expect(isActiveOpenerIndex(line, line.indexOf("%%"))).toBe(true);
		expect(unclosedContinuations(line)).toEqual([{ kind: "obsidian-comment" }]);
		for (const [lineWithOpener, expected] of [
			['<span title="`"></span> $$ `', { kind: "display-math" as const }],
			['<span title="`"></span> <!-- `', { kind: "html-comment" as const }],
			['<span title="`"></span> 《 `', { kind: "ruby" as const }],
		] as const) {
			expect(unclosedContinuations(lineWithOpener)).toEqual([expected]);
		}
		const scriptAfter = '<span title="`"></span> <script> `';
		expect(unclosedContinuations(scriptAfter)).toEqual([{ kind: "raw-html", tag: "script" }]);
		const scriptTick = "<script data-x=`value`>";
		expect(unclosedContinuations(scriptTick)).toEqual([{ kind: "raw-html", tag: "script" }, { kind: "html-block" }]);
	});

	it("closes a leading code span on the first matching backtick, even inside later HTML", () => {
		const line = '`<span title="`"></span> %% `';
		expect(closedCodeSpanEnd(line, 0)).toBe(line.indexOf("`", 1) + 1);
		expect(isActiveOpenerIndex(line, line.indexOf("%%"))).toBe(true);
		expect(unclosedContinuations(line)).toEqual([{ kind: "obsidian-comment" }]);
		for (const [lineWithOpener, expected] of [
			['`<span title="`"></span> $$ `', { kind: "display-math" as const }],
			['`<span title="`"></span> <!-- `', { kind: "html-comment" as const }],
			['`<span title="`"></span> 《 `', { kind: "ruby" as const }],
		] as const) {
			expect(unclosedContinuations(lineWithOpener)).toEqual([expected]);
		}
		expect(unclosedContinuations('`<span title="`"></span> <script> `')).toEqual([{ kind: "raw-html", tag: "script" }]);
	});
});
