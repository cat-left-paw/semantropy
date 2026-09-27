import { describe, expect, it } from "vitest";
import {
	headwordIdentity,
	headwordIdentityKey,
	validateHeadword,
	type HeadwordRejection,
} from "../src/dictionary/headword";
import { token } from "./tokenFixtures";

function accept(surface: string, overrides: Record<string, unknown> = {}) {
	const one = token({ surface, ...overrides });
	return validateHeadword(surface, [one]);
}

function rejectionOf(
	selection: string,
	tokens: Parameters<typeof validateHeadword>[1],
): HeadwordRejection | "accepted" {
	const result = validateHeadword(selection, tokens);
	return result.outcome === "accepted" ? "accepted" : result.reason;
}

describe("headword validation accepts the supported noun classes", () => {
	const cases: readonly [string, string, string, string | null][] = [
		["猫", "一般", "*", "noun"],
		["セマントロピー", "固有名詞", "一般", "proper"],
		["太郎", "固有名詞", "人名", "person"],
		["東京", "固有名詞", "地域", "place"],
		["ソニー", "固有名詞", "組織", "organization"],
		["研究", "サ変接続", "*", "sahen"],
		["静か", "形容動詞語幹", "*", null],
		["本日", "副詞可能", "*", "adverbialNoun"],
		["三", "数", "*", "number"],
	];

	for (const [surface, detail1, detail2, classification] of cases) {
		it(`accepts 名詞-${detail1}-${detail2} and classifies it as ${classification ?? "no placeholder"}`, () => {
			const result = accept(surface, { detail1, detail2 });

			expect(result.outcome).toBe("accepted");
			if (result.outcome !== "accepted") {
				return;
			}
			expect(result.headword.surface).toBe(surface);
			expect(result.headword.classification).toBe(classification);
		});
	}

	it("accepts 形容動詞語幹 as a headword even though no placeholder holds it", () => {
		// The headword classes and the pool classes are deliberately different
		// sets: a word can be worth defining without being a candidate word.
		const result = accept("静か", { detail1: "形容動詞語幹" });

		expect(result.outcome).toBe("accepted");
	});
});

describe("headword validation rejects everything else", () => {
	it("rejects an unknown word", () => {
		expect(rejectionOf("ぬるぽ", [token({ surface: "ぬるぽ", isUnknown: true })])).toBe(
			"unknown",
		);
	});

	it("rejects a non-noun", () => {
		expect(
			rejectionOf("走る", [
				token({ surface: "走る", pos: "動詞", detail1: "自立" }),
			]),
		).toBe("not-noun");
	});

	const unsupported = ["代名詞", "非自立", "接尾", "特殊"];
	for (const detail1 of unsupported) {
		it(`rejects 名詞-${detail1} as an unsupported noun`, () => {
			expect(
				rejectionOf("それ", [token({ surface: "それ", detail1 })]),
			).toBe("unsupported-noun");
		});
	}

	it("rejects a punctuation token as a non-noun before it can be a symbol", () => {
		// 記号 never reaches the symbol check; the reason reported is the first
		// one that fails, and this fails `pos`.
		expect(
			rejectionOf("、", [
				token({ surface: "、", pos: "記号", detail1: "読点" }),
			]),
		).toBe("not-noun");
	});

	it("rejects a single-code-point symbol that the dictionary calls a noun", () => {
		expect(rejectionOf("＄", [token({ surface: "＄", detail1: "一般" })])).toBe(
			"symbol",
		);
	});

	it("keeps a surrogate-pair symbol a single code point", () => {
		// Two UTF-16 units, one code point: still a symbol, not a word.
		expect(rejectionOf("🀄", [token({ surface: "🀄", detail1: "一般" })])).toBe(
			"symbol",
		);
	});
});

describe("headword validation rejects malformed selections", () => {
	it("rejects an empty selection", () => {
		expect(rejectionOf("", [])).toBe("empty");
	});

	it("rejects a whitespace-only selection before looking at tokens", () => {
		expect(
			rejectionOf("  　\t", [token({ surface: "  　\t" })]),
		).toBe("empty");
	});

	it("rejects a selection that analysed into no token", () => {
		expect(rejectionOf("猫", [])).toBe("empty");
	});

	it("rejects two tokens", () => {
		expect(
			rejectionOf("黒猫", [token({ surface: "黒" }), token({ surface: "猫" })]),
		).toBe("multiple-tokens");
	});

	it("rejects one token that does not cover the whole selection", () => {
		expect(rejectionOf("黒猫", [token({ surface: "猫" })])).toBe(
			"surface-mismatch",
		);
	});

	it("rejects a selection whose token carries surrounding whitespace away", () => {
		expect(rejectionOf(" 猫", [token({ surface: "猫" })])).toBe(
			"surface-mismatch",
		);
	});

	it("carries neither the selection nor an exception message in the reason", () => {
		const result = validateHeadword("秘密の言葉", [
			token({ surface: "秘密" }),
			token({ surface: "の" }),
		]);

		expect(result).toEqual({ outcome: "rejected", reason: "multiple-tokens" });
		expect(JSON.stringify(result)).not.toContain("秘密");
	});
});

describe("headword identity", () => {
	it("falls back to the surface when the base form is unset", () => {
		for (const baseForm of ["", "*"]) {
			const identity = headwordIdentity(
				token({ surface: "本日", detail1: "副詞可能", baseForm }),
			);

			expect(identity.baseForm).toBe("本日");
		}
	});

	it("keeps a real base form that differs from the surface", () => {
		const identity = headwordIdentity(
			token({ surface: "研究", detail1: "サ変接続", baseForm: "研究" }),
		);

		expect(identity.baseForm).toBe("研究");
	});

	it("marks an absent reading as absent rather than inventing one", () => {
		for (const reading of [undefined, "", "*"]) {
			const identity = headwordIdentity(
				token({ surface: "三", detail1: "数", reading }),
			);

			// The compact dictionary drops readings outside the exchangeable noun
			// classes, so 名詞-数 and 名詞-副詞可能 land here every time.
			expect(identity.reading).toBeNull();
		}
	});

	it("keeps a reading the dictionary does record", () => {
		expect(
			headwordIdentity(token({ surface: "猫", reading: "ネコ" })).reading,
		).toBe("ネコ");
	});

	it("normalizes to NFC so a decomposed selection is the same headword", () => {
		// U+30AC, versus U+30AB followed by the combining voiced mark U+3099.
		const composed = headwordIdentity(
			token({ surface: "\u30ac", baseForm: "\u30ac", reading: "\u30ac" }),
		);
		const decomposed = headwordIdentity(
			token({
				surface: "\u30ab\u3099",
				baseForm: "\u30ab\u3099",
				reading: "\u30ab\u3099",
			}),
		);

		expect("\u30ab\u3099".length).toBe(2);
		expect(decomposed).toEqual(composed);
		expect(headwordIdentityKey(decomposed)).toBe(headwordIdentityKey(composed));
	});

	it("matches a known fixture", () => {
		const identity = headwordIdentity(
			token({
				surface: "研究",
				detail1: "サ変接続",
				detail2: "*",
				baseForm: "研究",
				reading: "ケンキュウ",
			}),
		);

		expect(identity).toEqual({
			baseForm: "研究",
			reading: "ケンキュウ",
			pos: "名詞",
			detail1: "サ変接続",
			detail2: "*",
		});
		expect(headwordIdentityKey(identity)).toBe(
			"5:2:研究5:ケンキュウ2:名詞4:サ変接続1:*",
		);
	});

	it("separates fields that a plain join would let collide", () => {
		// "a|b" + "" versus "a" + "b|": identical under a delimiter, distinct
		// under a length prefix.
		const left = headwordIdentityKey(
			headwordIdentity(token({ surface: "ab", baseForm: "ab", reading: "" })),
		);
		const right = headwordIdentityKey(
			headwordIdentity(token({ surface: "a", baseForm: "a", reading: "b" })),
		);

		expect(left).not.toBe(right);
	});

	it("distinguishes an absent reading from an empty one", () => {
		const absent = headwordIdentityKey({
			baseForm: "猫",
			reading: null,
			pos: "名詞",
			detail1: "一般",
			detail2: "*",
		});
		const empty = headwordIdentityKey({
			baseForm: "猫",
			reading: "",
			pos: "名詞",
			detail1: "一般",
			detail2: "*",
		});

		expect(absent).not.toBe(empty);
	});

	it("is frozen and does not modify the token", () => {
		const source = token({ surface: "猫", reading: "ネコ" });
		const before = { ...source };

		const identity = headwordIdentity(source);

		expect(Object.isFrozen(identity)).toBe(true);
		expect(source).toEqual(before);
	});
});
