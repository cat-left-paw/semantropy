import { describe, expect, it } from "vitest";
import {
	LINDERA_UNSET,
	createCoverageGapToken,
	toJapaneseTokenFromLindera,
	toJapaneseTokensFromLindera,
	type LinderaRawToken,
} from "../src/tokenizer/lindera/linderaToken";
import { isEligibleReplacementToken } from "../src/transform/tokenPolicy";

function rawToken(
	overrides: Partial<LinderaRawToken> & { details: string[] },
): LinderaRawToken {
	return {
		surface: "駅",
		isUnknown: false,
		byteStart: 0,
		byteEnd: 3,
		...overrides,
	};
}

/** A noun Semantropy exchanges: every kept slot has a value. */
const targetNounDetails = [
	"名詞",
	"固有名詞",
	"人名",
	"名",
	LINDERA_UNSET,
	LINDERA_UNSET,
	"太郎",
	"タロウ",
	LINDERA_UNSET,
];

/** A token compaction stripped: only the three part-of-speech slots survive. */
const compactedVerbDetails = [
	"動詞",
	"自立",
	LINDERA_UNSET,
	LINDERA_UNSET,
	LINDERA_UNSET,
	LINDERA_UNSET,
	LINDERA_UNSET,
	LINDERA_UNSET,
	LINDERA_UNSET,
];

describe("toJapaneseTokenFromLindera", () => {
	it("maps the nine IPADIC slots onto JapaneseToken in order", () => {
		expect(
			toJapaneseTokenFromLindera(
				rawToken({
					surface: "待っ",
					details: [
						"動詞",
						"自立",
						"*",
						"*",
						"五段・タ行",
						"連用タ接続",
						"待つ",
						"マッ",
						"マッ",
					],
				}),
			),
		).toEqual({
			surface: "待っ",
			pos: "動詞",
			detail1: "自立",
			detail2: "*",
			detail3: "*",
			// Slot 4 is the conjugation type and slot 5 the conjugation form,
			// as in the IPADIC CSV and as Kuromoji exposes them.
			conjugationType: "五段・タ行",
			conjugationForm: "連用タ接続",
			baseForm: "待つ",
			reading: "マッ",
			isUnknown: false,
		});
	});

	it("keeps classification, base form and reading for an exchangeable noun", () => {
		const token = toJapaneseTokenFromLindera(
			rawToken({ surface: "太郎", details: targetNounDetails }),
		);
		expect(token.pos).toBe("名詞");
		expect(token.detail1).toBe("固有名詞");
		expect(token.detail2).toBe("人名");
		expect(token.detail3).toBe("名");
		expect(token.baseForm).toBe("太郎");
		expect(token.reading).toBe("タロウ");
	});

	it("reports a slot the compact dictionary dropped as \"*\", not as a substitute", () => {
		const token = toJapaneseTokenFromLindera(
			rawToken({ surface: "待っ", details: compactedVerbDetails }),
		);
		// The surface, a plausible base form and a plausible reading are all
		// available here; none of them may be used to fill a dropped slot.
		expect(token.detail3).toBe(LINDERA_UNSET);
		expect(token.conjugationType).toBe(LINDERA_UNSET);
		expect(token.conjugationForm).toBe(LINDERA_UNSET);
		expect(token.baseForm).toBe(LINDERA_UNSET);
		expect(token.baseForm).not.toBe(token.surface);
	});

	it("omits reading rather than substituting the surface when the slot is unset", () => {
		const token = toJapaneseTokenFromLindera(
			rawToken({ surface: "待っ", details: compactedVerbDetails }),
		);
		expect(token).not.toHaveProperty("reading");
	});

	it("omits reading when the slot is an empty string", () => {
		const details = [...targetNounDetails];
		details[7] = "";
		expect(
			toJapaneseTokenFromLindera(rawToken({ details })),
		).not.toHaveProperty("reading");
	});

	it("normalizes a slot Lindera did not return at all to \"*\"", () => {
		const token = toJapaneseTokenFromLindera(
			rawToken({ surface: "駅", details: ["名詞", "一般"] }),
		);
		expect(token.detail2).toBe(LINDERA_UNSET);
		expect(token.baseForm).toBe(LINDERA_UNSET);
		expect(token).not.toHaveProperty("reading");
	});

	it("carries Lindera's unknown flag through without exposing Lindera fields", () => {
		const token = toJapaneseTokenFromLindera(
			rawToken({
				surface: "ヴォエゴルヅィ",
				isUnknown: true,
				details: ["名詞", "一般", "*", "*", "*", "*", "*", "*", "*"],
			}),
		);
		expect(token.isUnknown).toBe(true);
		expect(token).not.toHaveProperty("byteStart");
		expect(token).not.toHaveProperty("details");
		expect(token).not.toHaveProperty("wordId");
	});
});

describe("createCoverageGapToken", () => {
	it("claims no morphology at all", () => {
		const token = createCoverageGapToken(" \t ");
		expect(token.surface).toBe(" \t ");
		expect(token.isUnknown).toBe(true);
		for (const value of [
			token.pos,
			token.detail1,
			token.detail2,
			token.detail3,
			token.conjugationType,
			token.conjugationForm,
			token.baseForm,
		]) {
			expect(value).toBe(LINDERA_UNSET);
		}
		expect(token).not.toHaveProperty("reading");
	});

	it("is never eligible for exchange", () => {
		expect(isEligibleReplacementToken(createCoverageGapToken("   "))).toBe(
			false,
		);
	});
});

describe("toJapaneseTokensFromLindera", () => {
	/** Byte offsets, so multi-byte text is addressed the way Lindera addresses it. */
	function encoded(text: string): number {
		return new TextEncoder().encode(text).length;
	}

	it("restores whitespace Lindera dropped so the surfaces rebuild the input", () => {
		const text = "猫 と 犬";
		const tokens = toJapaneseTokensFromLindera(text, [
			rawToken({ surface: "猫", details: ["名詞", "一般"], byteStart: 0, byteEnd: 3 }),
			rawToken({ surface: "と", details: ["助詞", "並立助詞"], byteStart: 4, byteEnd: 7 }),
			rawToken({ surface: "犬", details: ["名詞", "一般"], byteStart: 8, byteEnd: 11 }),
		]);

		expect(tokens.map((token) => token.surface).join("")).toBe(text);
		expect(tokens.map((token) => token.surface)).toEqual([
			"猫",
			" ",
			"と",
			" ",
			"犬",
		]);
	});

	it("restores a gap at the start and at the end", () => {
		const text = "\n猫\t";
		const tokens = toJapaneseTokensFromLindera(text, [
			rawToken({ surface: "猫", details: ["名詞", "一般"], byteStart: 1, byteEnd: 4 }),
		]);
		expect(tokens.map((token) => token.surface)).toEqual(["\n", "猫", "\t"]);
		expect(tokens[0]?.isUnknown).toBe(true);
		expect(tokens[2]?.isUnknown).toBe(true);
	});

	it("marks every restored stretch unknown with no part of speech", () => {
		const tokens = toJapaneseTokensFromLindera("  猫", [
			rawToken({ surface: "猫", details: ["名詞", "一般"], byteStart: 2, byteEnd: 5 }),
		]);
		expect(tokens[0]).toMatchObject({
			surface: "  ",
			pos: LINDERA_UNSET,
			detail1: LINDERA_UNSET,
			isUnknown: true,
		});
	});

	it("leaves a fully covered sentence untouched", () => {
		const text = "猫だ";
		const tokens = toJapaneseTokensFromLindera(text, [
			rawToken({ surface: "猫", details: ["名詞", "一般"], byteStart: 0, byteEnd: 3 }),
			rawToken({ surface: "だ", details: ["助動詞"], byteStart: 3, byteEnd: encoded(text) }),
		]);
		expect(tokens).toHaveLength(2);
		expect(tokens.every((token) => token.pos !== LINDERA_UNSET)).toBe(true);
	});

	it("returns nothing for empty input", () => {
		expect(toJapaneseTokensFromLindera("", [])).toEqual([]);
	});
});
