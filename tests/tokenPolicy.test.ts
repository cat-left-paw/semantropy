import { describe, expect, it } from "vitest";
import {
	isEligibleReplacementToken,
	isSingleCodePointSymbol,
	vocabularyPoolKey,
} from "../src/transform/tokenPolicy";
import { token } from "./tokenFixtures";

describe("isSingleCodePointSymbol", () => {
	it("detects punctuation and symbols by Unicode category", () => {
		expect(isSingleCodePointSymbol("。")).toBe(true);
		expect(isSingleCodePointSymbol("★")).toBe(true);
		expect(isSingleCodePointSymbol("😔")).toBe(true);
	});

	it("does not treat letters or multi-code-point strings as symbols", () => {
		expect(isSingleCodePointSymbol("駅")).toBe(false);
		expect(isSingleCodePointSymbol("𠮷")).toBe(false);
		expect(isSingleCodePointSymbol("!!")).toBe(false);
		expect("😔".length).toBe(2);
		expect([...("😔")].length).toBe(1);
	});
});

describe("isEligibleReplacementToken", () => {
	it("accepts the PoC noun classes", () => {
		expect(isEligibleReplacementToken(token({ surface: "駅", detail1: "一般" }))).toBe(
			true,
		);
		expect(
			isEligibleReplacementToken(
				token({ surface: "太郎", detail1: "固有名詞", detail2: "人名" }),
			),
		).toBe(true);
		expect(
			isEligibleReplacementToken(token({ surface: "運動", detail1: "サ変接続" })),
		).toBe(true);
		expect(
			isEligibleReplacementToken(
				token({ surface: "静か", detail1: "形容動詞語幹" }),
			),
		).toBe(true);
	});

	it("rejects protected noun subclasses", () => {
		for (const detail1 of ["数", "接尾", "非自立", "代名詞"]) {
			expect(
				isEligibleReplacementToken(token({ surface: "それ", detail1 })),
			).toBe(false);
		}
	});

	it("rejects non-nouns", () => {
		expect(
			isEligibleReplacementToken(
				token({ surface: "は", pos: "助詞", detail1: "係助詞" }),
			),
		).toBe(false);
		expect(
			isEligibleReplacementToken(
				token({ surface: "た", pos: "助動詞", detail1: "*" }),
			),
		).toBe(false);
		expect(
			isEligibleReplacementToken(
				token({ surface: "待つ", pos: "動詞", detail1: "自立" }),
			),
		).toBe(false);
		expect(
			isEligibleReplacementToken(
				token({ surface: "長い", pos: "形容詞", detail1: "自立" }),
			),
		).toBe(false);
		expect(
			isEligibleReplacementToken(
				token({ surface: "。", pos: "記号", detail1: "句点" }),
			),
		).toBe(false);
	});

	it("rejects unknown nouns even when the class would otherwise be eligible", () => {
		expect(
			isEligibleReplacementToken(
				token({ surface: "未知", detail1: "一般", isUnknown: true }),
			),
		).toBe(false);
	});

	it("rejects a single Unicode symbol even if tagged as a common noun", () => {
		expect(
			isEligibleReplacementToken(token({ surface: "😔", detail1: "一般" })),
		).toBe(false);
	});

	it("keeps a single non-symbol code point eligible", () => {
		expect(
			isEligibleReplacementToken(token({ surface: "𠮷", detail1: "一般" })),
		).toBe(true);
	});
});

describe("vocabularyPoolKey", () => {
	it("uses pos and detail1 for common nouns", () => {
		expect(vocabularyPoolKey(token({ surface: "駅", detail1: "一般" }))).toBe(
			"名詞\u001f一般",
		);
	});

	it("includes detail2 for proper nouns when it is usable", () => {
		expect(
			vocabularyPoolKey(
				token({ surface: "太郎", detail1: "固有名詞", detail2: "人名" }),
			),
		).toBe("名詞\u001f固有名詞\u001f人名");
		expect(
			vocabularyPoolKey(
				token({ surface: "東京", detail1: "固有名詞", detail2: "地域" }),
			),
		).toBe("名詞\u001f固有名詞\u001f地域");
	});

	it("falls back to pos and detail1 when proper-noun detail2 is empty or *", () => {
		expect(
			vocabularyPoolKey(
				token({ surface: "甲", detail1: "固有名詞", detail2: "*" }),
			),
		).toBe("名詞\u001f固有名詞");
		expect(
			vocabularyPoolKey(
				token({ surface: "乙", detail1: "固有名詞", detail2: "" }),
			),
		).toBe("名詞\u001f固有名詞");
	});
});
