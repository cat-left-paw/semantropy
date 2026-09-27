// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { collectTransformableTextNodes } from "../../src/render/collectTextNodes";
import { isEligibleReplacementToken } from "../../src/transform/tokenPolicy";
import { analyzeNoteTexts } from "../../src/application/analyzeNoteTexts";
import { transformTokenSequences } from "../../src/transform/transformTokens";
import { assertBodySemantropy } from "../../src/settings/bodySemantropy";
import { LINDERA_UNSET } from "../../src/tokenizer/lindera/linderaToken";
import {
	buildTokenize,
	compactDictionaryDir,
	initLindera,
	type Tokenize,
} from "./linderaFixture";

let tokenize: Tokenize;

beforeAll(async () => {
	await initLindera();
	tokenize = buildTokenize(compactDictionaryDir());
}, 600_000);

/**
 * lindera-wasm 6.0.0 drops ASCII whitespace from its output, and
 * `setKeepWhitespace(true)` does not change that in this version — verified
 * for the builder's sequential and chained forms and for the direct
 * `new Tokenizer(...)` construction the product build uses.
 *
 * Semantropy rebuilds the displayed body by concatenating token surfaces in
 * order, so a dropped run would silently delete that whitespace from the
 * transformed text. The adapter restores full coverage from the tokens' UTF-8
 * byte offsets before anything above it sees them, and this is the product
 * contract that keeps it honest: for every input below, concatenating the
 * surfaces must reproduce the input exactly.
 */
const COVERAGE_CASES: { name: string; text: string }[] = [
	{ name: "ascii space", text: "Hello world and Semantropy" },
	{ name: "ascii space between Japanese", text: "太郎は 駅で 花子を待っていた。" },
	{ name: "ideographic space", text: "太郎は　駅で　花子を待っていた。" },
	{ name: "tab", text: "太郎\t駅\t花子" },
	{ name: "line feed", text: "一行目\n二行目\n三行目" },
	{ name: "carriage return line feed", text: "一行目\r\n二行目\r\n三行目" },
	{ name: "blank line between paragraphs", text: "一行目\n\n三行目" },
	{ name: "runs of ascii spaces", text: "太郎    駅     花子" },
	{ name: "mixed whitespace run", text: "太郎 \t　 \r\n 駅" },
	{ name: "leading and trailing whitespace", text: "  \t太郎は駅にいた。\n " },
	{ name: "whitespace only", text: " \t　\n\r\n " },
	{ name: "punctuation", text: "「重要」、それは（本当に）？　そう！——だ。" },
	{ name: "ascii punctuation", text: "Semantropy: a plugin; for writing -- yes." },
	{ name: "emoji", text: "猫は🐈で犬は🐕、そして😀と❤️と🇯🇵。" },
	{ name: "emoji with spaces", text: "猫 🐈 犬 🐕 そして 😀" },
	{ name: "surrogate pairs", text: "𠮷野家と𩸽と𣗄と鷗外、それに𝔘𝔫𝔦𝔠𝔬𝔡𝔢。" },
	{ name: "surrogate pair adjacent to whitespace", text: "𠮷野家 \t 𩸽\n𣗄" },
	{ name: "empty", text: "" },
	{ name: "single space", text: " " },
];

describe("token surfaces reconstruct the input exactly", () => {
	for (const { name, text } of COVERAGE_CASES) {
		it(`covers ${name}`, () => {
			const tokens = tokenize(text);
			expect(tokens.map((token) => token.surface).join("")).toBe(text);
		});
	}

	it("gives a restored run no morphology at all", () => {
		// Only the runs Lindera drops are restored ones. Two whitespace
		// characters are not dropped and so are excluded here: the ideographic
		// space, which Lindera returns as 名詞/サ変接続, and a carriage
		// return, which it returns as 記号/一般. Both are covered by the
		// eligibility check below.
		const RESTORED = /^[ \t\n\f\v]+$/;
		let restoredCount = 0;

		for (const { text } of COVERAGE_CASES) {
			for (const token of tokenize(text)) {
				if (!RESTORED.test(token.surface)) {
					continue;
				}
				restoredCount += 1;
				// A restored run did not come from the dictionary, so calling it
				// 記号/空白 would be the adapter inventing a classification
				// rather than reporting one.
				expect(token.pos).toBe(LINDERA_UNSET);
				expect(token.detail1).toBe(LINDERA_UNSET);
				expect(token.detail2).toBe(LINDERA_UNSET);
				expect(token.detail3).toBe(LINDERA_UNSET);
				expect(token.conjugationType).toBe(LINDERA_UNSET);
				expect(token.conjugationForm).toBe(LINDERA_UNSET);
				expect(token.baseForm).toBe(LINDERA_UNSET);
				expect(token).not.toHaveProperty("reading");
				expect(token.isUnknown).toBe(true);
			}
		}
		// If this ever reached zero the assertions above would be vacuous.
		expect(restoredCount).toBeGreaterThan(10);
	});

	it("keeps every whitespace-only token out of the exchangeable pool", () => {
		for (const { text } of COVERAGE_CASES) {
			for (const token of tokenize(text)) {
				if (token.surface === "" || token.surface.trim() !== "") {
					continue;
				}
				expect(isEligibleReplacementToken(token)).toBe(false);
			}
		}
	});

	it("splits CRLF into Lindera's own carriage return and a restored line feed", () => {
		// Recorded rather than smoothed over: lindera-wasm returns \r as a
		// symbol token and drops \n, so a CRLF arrives as two tokens. What
		// matters for the body transform is that together they still restore
		// the input and neither one can be exchanged.
		const tokens = tokenize("一行目\r\n二行目");
		const surfaces = tokens.map((token) => token.surface);
		expect(surfaces.join("")).toBe("一行目\r\n二行目");
		expect(surfaces).toContain("\r");
		expect(surfaces).toContain("\n");

		const carriageReturn = tokens.find((token) => token.surface === "\r");
		const lineFeed = tokens.find((token) => token.surface === "\n");
		expect(carriageReturn?.pos).toBe("記号");
		expect(lineFeed?.pos).toBe(LINDERA_UNSET);
		expect(isEligibleReplacementToken(carriageReturn!)).toBe(false);
		expect(isEligibleReplacementToken(lineFeed!)).toBe(false);
	});

	it("returns the ideographic space as Lindera's own token, not a restored one", () => {
		const token = tokenize("太郎　駅").find((entry) => entry.surface === "　");
		expect(token).toBeDefined();
		expect(token?.pos).toBe("名詞");
		expect(token?.isUnknown).toBe(true);
		// Unknown, so it never joins the exchangeable pool.
		expect(isEligibleReplacementToken(token!)).toBe(false);
	});

	it("still analyses the prose around the whitespace", () => {
		// A restoration that swallowed the sentence would also round-trip, so
		// the surrounding text has to stay segmented.
		const tokens = tokenize("太郎は 駅で 花子を待っていた。");
		const surfaces = tokens.map((token) => token.surface);
		expect(surfaces).toContain("太郎");
		expect(surfaces).toContain("駅");
		expect(surfaces).toContain("花子");
		expect(surfaces.filter((surface) => surface === " ")).toHaveLength(2);
	});
});

/**
 * The renderer hands the analyzer one string per Text node, not one string per
 * note, so the coverage contract has to hold for the fragments a real Markdown
 * render produces, not only for whole sentences.
 */
describe("text nodes collected from rendered Markdown", () => {
	const parsed = new DOMParser().parseFromString(
		readFileSync(
			path.join(process.cwd(), "tests/fixtures/obsidian-preview.html"),
			"utf8",
		),
		"text/html",
	);
	const preview = parsed.body.querySelector(".markdown-preview-view");
	if (!(preview instanceof HTMLElement)) {
		throw new Error("The preview fixture has no .markdown-preview-view root.");
	}
	const texts = collectTransformableTextNodes(preview).map(
		(node) => node.nodeValue ?? "",
	);

	it("collects the nodes a real render would hand the analyzer", () => {
		expect(texts.length).toBeGreaterThan(5);
		// Several nodes carry whitespace inside them, which is what makes the
		// round-trip below a real test of the restoration.
		expect(texts.some((text) => /\s/.test(text))).toBe(true);
	});

	it("reconstructs every collected node", () => {
		for (const text of texts) {
			expect(tokenize(text).map((token) => token.surface).join("")).toBe(text);
		}
	});

	it("leaves the rendered body unchanged at Semantropy 0 and changes it at 100", async () => {
		const analysis = await analyzeNoteTexts(texts, async (text) =>
			tokenize(text),
		);
		const off = transformTokenSequences(
			analysis.tokenSequences,
			analysis.pool,
			1_234_567,
			assertBodySemantropy(0),
		);
		const max = transformTokenSequences(
			analysis.tokenSequences,
			analysis.pool,
			1_234_567,
			assertBodySemantropy(100),
		);

		// Off must be the input, byte for byte, across every node.
		expect(off.texts).toEqual(texts);
		expect(off.replacementCount).toBe(0);
		expect(max.replacementCount).toBeGreaterThan(0);
		// And every transformed node must still be the same length in nodes:
		// the transform replaces surfaces, it never drops or merges them.
		expect(max.texts).toHaveLength(texts.length);
	});
});
