import { beforeAll, describe, expect, it } from "vitest";
import type { JapaneseToken } from "../../src/tokenizer/JapaneseTokenizer";
import { analyzeNoteTexts } from "../../src/application/analyzeNoteTexts";
import { transformTokenSequences } from "../../src/transform/transformTokens";
import { assertBodySemantropy } from "../../src/settings/bodySemantropy";
import {
	LONE_SURROGATE_FIXTURE,
	TEXT_NODE_SEQUENCE,
	TOKENIZER_FIXTURES,
} from "./fixtures";
import {
	buildTokenize,
	compactDictionaryDir,
	fullDictionaryDir,
	initLindera,
	isTargetNounToken,
	semantropyProjection,
	type Tokenize,
} from "./linderaFixture";

/** One fixed seed and three fixed levels, so every comparison is reproducible. */
const BODY_SEED = 1_234_567;
const LEVELS = [0, 25, 50, 75, 100].map(assertBodySemantropy);

let full: Tokenize;
let compact: Tokenize;

beforeAll(async () => {
	await initLindera();
	full = buildTokenize(fullDictionaryDir());
	compact = buildTokenize(compactDictionaryDir());
}, 600_000);

/**
 * The hard requirement of the compaction: on the shared corpus the compact
 * dictionary must be indistinguishable from the full one for everything
 * Semantropy reads, and for the exchangeable nouns' kept slots.
 */
describe("compact dictionary equivalence with the full dictionary", () => {
	for (const fixture of TOKENIZER_FIXTURES) {
		it(`produces the same token boundaries and classification for ${fixture.name}`, () => {
			const expected = full(fixture.text);
			const actual = compact(fixture.text);

			expect(actual.map((token) => token.surface)).toEqual(
				expected.map((token) => token.surface),
			);
			expect(actual.map(semantropyProjection)).toEqual(
				expected.map(semantropyProjection),
			);
			expect(actual.map((token) => token.isUnknown)).toEqual(
				expected.map((token) => token.isUnknown),
			);
		});

		it(`keeps subcategory 3, base form and reading for exchangeable nouns in ${fixture.name}`, () => {
			const expected = full(fixture.text);
			const actual = compact(fixture.text);

			const kept = (tokens: JapaneseToken[]) =>
				tokens
					.filter(isTargetNounToken)
					.map((token) =>
						[
							token.surface,
							token.detail3,
							token.baseForm,
							token.reading ?? "",
						].join("|"),
					);

			expect(kept(actual)).toEqual(kept(expected));
		});
	}

	it("covers every fixture with at least one exchangeable noun somewhere", () => {
		const total = TOKENIZER_FIXTURES.reduce(
			(sum, fixture) => sum + compact(fixture.text).filter(isTargetNounToken).length,
			0,
		);
		expect(total).toBeGreaterThan(100);
	});

	it("rebuilds the input text from token surfaces", () => {
		for (const fixture of TOKENIZER_FIXTURES) {
			if (fixture.name === LONE_SURROGATE_FIXTURE.name) {
				// Not representable in UTF-8; covered separately below.
				continue;
			}
			expect(compact(fixture.text).map((token) => token.surface).join("")).toBe(
				fixture.text,
			);
		}
	});

	it("tokenizes a lone surrogate instead of throwing", () => {
		// A lone high surrogate has no UTF-8 encoding, so Lindera sees U+FFFD
		// in its place. The character count is preserved and the source note is
		// never written, so this can only ever show up in the preview.
		const tokens = compact(LONE_SURROGATE_FIXTURE.text);
		expect(tokens.length).toBeGreaterThan(0);
		const text = tokens.map((token) => token.surface).join("");
		expect(text).not.toBe(LONE_SURROGATE_FIXTURE.text);
		expect(text).toContain("\uFFFD");
		expect(text).toHaveLength(LONE_SURROGATE_FIXTURE.text.length);
	});
});

describe("the compact dictionary drops what it says it drops", () => {
	it("drops conjugation type and form outside independent verbs and adjectives", () => {
		for (const fixture of TOKENIZER_FIXTURES) {
			for (const token of compact(fixture.text)) {
    if ((token.pos === "動詞" || token.pos === "形容詞") && token.detail1 === "自立") continue;
				expect(token.conjugationType).toBe("*");
				expect(token.conjugationForm).toBe("*");
			}
		}
	});

	it("keeps independent verb base form and reading exactly as full IPADIC", () => {
		const verbs = compact("書いた本を読んで走った。").filter(
			(token) => token.pos === "動詞",
		);
		expect(verbs.length).toBeGreaterThan(0);
		for (const token of verbs) {
			const original = full("書いた本を読んで走った。").find(t => t.surface === token.surface)!;
   expect(token).toEqual(original);
   expect(token.conjugationType).not.toBe("*");
   expect(token.reading).toBeDefined();
		}
	});

	it("still reports base form and reading for the four exchangeable noun classes", () => {
		const byDetail = new Map<string, JapaneseToken>();
		for (const token of compact(
			"太郎は駅で研究を静かに続けた。東京大学の処理が自然だ。",
		)) {
			if (isTargetNounToken(token)) {
				byDetail.set(token.detail1, token);
			}
		}
		expect([...byDetail.keys()].sort()).toEqual(
			["サ変接続", "一般", "固有名詞", "形容動詞語幹"].sort(),
		);
		for (const token of byDetail.values()) {
			expect(token.baseForm).not.toBe("*");
			expect(token.reading).toBeDefined();
		}
	});

	it("keeps the full dictionary's own values for those nouns", () => {
		const text = "太郎は東京大学で自然言語処理の研究をした。";
		const kept = (tokenize: Tokenize) =>
			tokenize(text)
				.filter(isTargetNounToken)
				.map((token) => `${token.surface}=${token.baseForm}/${token.reading}`);
		expect(kept(compact)).toEqual(kept(full));
		expect(kept(compact)).toContain("太郎=太郎/タロウ");
		expect(kept(compact)).toContain("東京大学=東京大学/トウキョウダイガク");
	});
});

/**
 * The end of the chain: with a fixed seed and fixed Semantropy values, the
 * compact dictionary must drive the body transform to exactly the result the
 * full dictionary does.
 */
describe("body transform at a fixed seed", () => {
	async function analyze(
		tokenize: (text: string) => Promise<JapaneseToken[]>,
	) {
		return analyzeNoteTexts([...TEXT_NODE_SEQUENCE], tokenize);
	}

	it("produces the same texts and replacement counts for full and compact Lindera", async () => {
		const fullAnalysis = await analyze(async (text) => full(text));
		const compactAnalysis = await analyze(async (text) => compact(text));

		for (const level of LEVELS) {
			const expected = transformTokenSequences(
				fullAnalysis.tokenSequences,
				fullAnalysis.pool,
				BODY_SEED,
				level,
			);
			const actual = transformTokenSequences(
				compactAnalysis.tokenSequences,
				compactAnalysis.pool,
				BODY_SEED,
				level,
			);
			expect(actual.texts).toEqual(expected.texts);
			expect(actual.replacementCount).toBe(expected.replacementCount);
			expect(actual.replaceableSlotCount).toBe(expected.replaceableSlotCount);
		}
	});

	it("actually exchanges something, so the comparison is not vacuous", async () => {
		const analysis = await analyze(async (text) => compact(text));
		const off = transformTokenSequences(
			analysis.tokenSequences,
			analysis.pool,
			BODY_SEED,
			LEVELS[0]!,
		);
		const max = transformTokenSequences(
			analysis.tokenSequences,
			analysis.pool,
			BODY_SEED,
			LEVELS.at(-1)!,
		);
		expect(off.replacementCount).toBe(0);
		expect(max.replacementCount).toBeGreaterThan(0);
		expect(max.texts.join("")).not.toBe(off.texts.join(""));
	});
});
