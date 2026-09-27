// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectTransformableTextNodes } from "../src/render/collectTextNodes";

const fixtureHtml = readFileSync(
	path.join(process.cwd(), "tests/fixtures/obsidian-preview.html"),
	"utf8",
);
const markdownFixture = readFileSync(
	path.join(process.cwd(), "tests/fixtures/markdown-protection.md"),
	"utf8",
);

function parseHtml(html: string): HTMLElement {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const preview = parsed.body.querySelector(".markdown-preview-view");
	if (preview instanceof HTMLElement) {
		return preview;
	}
	const wrapper = parsed.body;
	if (!(wrapper instanceof HTMLElement)) {
		throw new Error("Failed to parse HTML fixture.");
	}
	return wrapper;
}

function collectedTexts(root: HTMLElement): string[] {
	return collectTransformableTextNodes(root).map((node) => node.nodeValue ?? "");
}

describe("collectTransformableTextNodes", () => {
	it("keeps a markdown protection fixture with the required constructs", () => {
		expect(markdownFixture).toContain("title: 保護されるべき");
		expect(markdownFixture).toContain("# 見出し駅");
		expect(markdownFixture).toContain("段落花子は病院へ行った。");
		expect(markdownFixture).toContain("- リスト病院");
		expect(markdownFixture).toContain("> 引用太郎");
		expect(markdownFixture).toContain("| 表セル |");
		expect(markdownFixture).toContain("> [!note]");
		expect(markdownFixture).toContain("[[小説断片]]");
		expect(markdownFixture).toContain("https://example.com");
		expect(markdownFixture).toContain("#タグ");
		expect(markdownFixture).toContain("`code保護`");
		expect(markdownFixture).toContain("code block保護");
		expect(markdownFixture).toContain("$x=1$");
		expect(markdownFixture).toContain("E=mc^2");
		expect(markdownFixture).toContain("![[embed.png]]");
		expect(markdownFixture).toContain("![画像](image.png)");
		expect(markdownFixture).toContain("<div>HTML本文 <code>保護コード</code></div>");
	});

	it("collects heading, paragraph, list, quote, table, and callout text in document order", () => {
		const texts = collectedTexts(parseHtml(fixtureHtml));
		const order = [
			"見出し駅",
			"段落花子は病院へ行った。",
			"リスト病院",
			"項目",
			"引用太郎",
			"列",
			"表セル",
			"コールアウト猫",
			"HTML本文 ",
		];
		let lastIndex = -1;
		for (const expected of order) {
			const index = texts.indexOf(expected);
			expect(index, expected).toBeGreaterThan(lastIndex);
			lastIndex = index;
		}
	});

	it("skips whitespace-only text nodes while keeping visible body text", () => {
		const root = document.createElement("div");
		const blank = document.createElement("p");
		blank.textContent = "   ";
		const visible = document.createElement("p");
		visible.textContent = "駅";
		const newline = document.createElement("p");
		newline.textContent = "\n\t";
		root.append(blank, visible, newline);
		expect(collectedTexts(root)).toEqual(["駅"]);
	});

	it("excludes link labels, tags, code, frontmatter, embeds, math, and controls", () => {
		const root = parseHtml(fixtureHtml);
		const texts = collectedTexts(root);
		const joined = texts.join("");
		expect(root.textContent).toContain("内部");
		expect(root.textContent).toContain("外部");
		expect(root.textContent).toContain("#タグ");
		expect(texts).not.toContain("内部");
		expect(texts).not.toContain("外部");
		expect(texts).not.toContain("#タグ");
		for (const forbidden of [
			"FRONTMATTER",
			"METADATA",
			"code保護",
			"code block保護",
			"MATHINLINE",
			"MATHBLOCK",
			"EMBEDINTERNAL",
			"EMBEDMARKDOWN",
			"EMBEDFILE",
			"EMBEDMEDIA",
			"EMBEDIMAGE",
			"SCRIPTTEXT",
			"STYLETEXT",
			"SVGTEXT",
			"BUTTONTEXT",
			"TEXTAREA",
			"OPTIONTEXT",
			"保護コード",
			"NESTEDPROTECTED",
		]) {
			expect(root.textContent, forbidden).toContain(forbidden);
			expect(joined).not.toContain(forbidden);
		}
		expect(joined).toContain("見出し駅");
		expect(joined).toContain("HTML本文");
		expect(joined).toContain("内部リンク");
	});

	it("does not change link hrefs or other attributes", () => {
		const root = parseHtml(fixtureHtml);
		const beforeHref = root.querySelector("a.internal-link")?.getAttribute("href");
		collectTransformableTextNodes(root);
		expect(root.querySelector("a.internal-link")?.getAttribute("href")).toBe(
			beforeHref,
		);
		expect(root.querySelector("a.external-link")?.getAttribute("href")).toBe(
			"https://example.com/path",
		);
		expect(root.querySelector("a.internal-link")?.getAttribute("data-href")).toBe(
			"小説断片.md",
		);
	});

	it("collects ordinary text inside raw HTML and skips nested code", () => {
		const root = document.createElement("div");
		const wrap = document.createElement("div");
		wrap.append("通常本文 ");
		const code = document.createElement("code");
		code.textContent = "保護コード";
		wrap.append(code);
		root.append(wrap);
		expect(collectedTexts(root)).toEqual(["通常本文 "]);
	});

	it("excludes text under a protected ancestor several levels up", () => {
		const root = parseHtml(fixtureHtml);
		const joined = collectedTexts(root).join("");
		expect(joined).not.toContain("NESTEDPROTECTED");
		expect(joined).toContain("段落花子は病院へ行った。");
	});

	it("does not collect text nodes outside the root", () => {
		const wrapper = document.createElement("div");
		const inner = document.createElement("p");
		inner.textContent = "内側駅";
		wrapper.append(inner);
		const outside = document.createElement("p");
		outside.textContent = "外側病院";
		document.body.append(wrapper, outside);
		expect(collectedTexts(wrapper)).toEqual(["内側駅"]);
		outside.remove();
		wrapper.remove();
	});

	it("leaves innerHTML unchanged", () => {
		const root = parseHtml(fixtureHtml);
		const before = root.innerHTML;
		collectTransformableTextNodes(root);
		expect(root.innerHTML).toBe(before);
	});

	it("returns the original text nodes, not clones", () => {
		const root = parseHtml(fixtureHtml);
		const heading = root.querySelector("h1");
		const original = heading?.firstChild;
		const collected = collectTransformableTextNodes(root);
		expect(original).toBeInstanceOf(Text);
		expect(collected).toContain(original);
	});
});
