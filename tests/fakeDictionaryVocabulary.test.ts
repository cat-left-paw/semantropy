import { describe, expect, it } from "vitest";
import {
	FAKE_DICTIONARY_PLACEHOLDERS,
	classifyPlaceholder,
} from "../src/dictionary/placeholders";
import {
	buildDictionaryVocabularyPool,
	fingerprintDictionaryVocabularyPool,
} from "../src/dictionary/vocabularyPool";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { token } from "./tokenFixtures";

function poolOf(...tokens: JapaneseToken[]) {
	return buildDictionaryVocabularyPool([tokens]);
}

describe("placeholder classification", () => {
	const cases: readonly [string, string, string, string][] = [
		["猫", "一般", "*", "noun"],
		["セマントロピー", "固有名詞", "一般", "proper"],
		["太郎", "固有名詞", "人名", "person"],
		["東京", "固有名詞", "地域", "place"],
		["ソニー", "固有名詞", "組織", "organization"],
		["研究", "サ変接続", "*", "sahen"],
		["本日", "副詞可能", "*", "adverbialNoun"],
		["三", "数", "*", "number"],
	];

	for (const [surface, detail1, detail2, placeholder] of cases) {
		it(`puts 名詞-${detail1}-${detail2} in ${placeholder}`, () => {
			const pool = poolOf(token({ surface, detail1, detail2 }));

			expect(pool[placeholder as keyof typeof pool]).toEqual([surface]);
			for (const other of FAKE_DICTIONARY_PLACEHOLDERS) {
				if (other !== placeholder) {
					expect(pool[other]).toEqual([]);
				}
			}
		});
	}

	it("keeps person, place and organization in three separate pools", () => {
		const pool = poolOf(
			token({ surface: "太郎", detail1: "固有名詞", detail2: "人名" }),
			token({ surface: "東京", detail1: "固有名詞", detail2: "地域" }),
			token({ surface: "ソニー", detail1: "固有名詞", detail2: "組織" }),
		);

		expect(pool.person).toEqual(["太郎"]);
		expect(pool.place).toEqual(["東京"]);
		expect(pool.organization).toEqual(["ソニー"]);
		// A place is never offered where a person is required, at any value.
		expect(pool.proper).toEqual([]);
		expect(pool.noun).toEqual([]);
	});

	it("admits only 固有名詞-一般 to proper", () => {
		const pool = poolOf(
			token({ surface: "セマントロピー", detail1: "固有名詞", detail2: "一般" }),
			token({ surface: "太郎", detail1: "固有名詞", detail2: "人名" }),
			// A proper noun the dictionary does not subclassify is dropped rather
			// than folded into `proper`.
			token({ surface: "謎", detail1: "固有名詞", detail2: "*" }),
		);

		expect(pool.proper).toEqual(["セマントロピー"]);
	});

	it("classifies 副詞可能 and 数 with no base form or reading at all", () => {
		// The compact dictionary keeps neither for these classes; classification
		// must rest on pos/detail1/detail2 only.
		const pool = poolOf(
			token({ surface: "本日", detail1: "副詞可能", baseForm: "*", reading: "*" }),
			token({ surface: "三", detail1: "数", baseForm: "*", reading: "*" }),
		);

		expect(pool.adverbialNoun).toEqual(["本日"]);
		expect(pool.number).toEqual(["三"]);
	});

	it("returns null for classes the pool excludes", () => {
		const excluded: readonly JapaneseToken[] = [
			token({ surface: "ぬるぽ", isUnknown: true }),
			token({ surface: "それ", detail1: "代名詞" }),
			token({ surface: "こと", detail1: "非自立" }),
			token({ surface: "的", detail1: "接尾" }),
			token({ surface: "ー", detail1: "特殊" }),
			token({ surface: "静か", detail1: "形容動詞語幹" }),
			token({ surface: "＄", detail1: "一般" }),
			token({ surface: "走る", pos: "動詞", detail1: "自立" }),
			token({ surface: "、", pos: "記号", detail1: "読点" }),
		];

		for (const excludedToken of excluded) {
			expect(classifyPlaceholder(excludedToken)).toBeNull();
		}

		const pool = buildDictionaryVocabularyPool([excluded]);
		for (const placeholder of FAKE_DICTIONARY_PLACEHOLDERS) {
			expect(pool[placeholder]).toEqual([]);
		}
	});
});

describe("the Current Note vocabulary pool", () => {
	it("deduplicates surfaces in first-appearance order", () => {
		const pool = buildDictionaryVocabularyPool([
			[token({ surface: "猫" }), token({ surface: "犬" })],
			[token({ surface: "猫" }), token({ surface: "鳥" }), token({ surface: "犬" })],
		]);

		expect(pool.noun).toEqual(["猫", "犬", "鳥"]);
	});

	it("presents every placeholder, empty ones included", () => {
		const pool = buildDictionaryVocabularyPool([]);

		expect(Object.keys(pool).sort()).toEqual(
			[...FAKE_DICTIONARY_PLACEHOLDERS].sort(),
		);
		for (const placeholder of FAKE_DICTIONARY_PLACEHOLDERS) {
			expect(pool[placeholder]).toEqual([]);
		}
	});

	it("freezes the pool and each candidate list", () => {
		const pool = poolOf(token({ surface: "猫" }));

		expect(Object.isFrozen(pool)).toBe(true);
		for (const placeholder of FAKE_DICTIONARY_PLACEHOLDERS) {
			expect(Object.isFrozen(pool[placeholder])).toBe(true);
		}
	});

	it("modifies neither the tokens nor the sequences it is given", () => {
		const first = [token({ surface: "猫" }), token({ surface: "犬" })];
		const second = [token({ surface: "東京", detail1: "固有名詞", detail2: "地域" })];
		const sequences = [first, second];
		const snapshot = JSON.stringify(sequences);

		buildDictionaryVocabularyPool(sequences);

		expect(JSON.stringify(sequences)).toBe(snapshot);
		expect(sequences).toHaveLength(2);
		expect(first).toHaveLength(2);
	});
});

describe("the pool fingerprint", () => {
	it("ignores the order the note's text nodes were analysed in", () => {
		const forward = buildDictionaryVocabularyPool([
			[token({ surface: "猫" })],
			[token({ surface: "犬" })],
		]);
		const reversed = buildDictionaryVocabularyPool([
			[token({ surface: "犬" })],
			[token({ surface: "猫" })],
		]);

		// The first-appearance contract still shows the two apart...
		expect(forward.noun).toEqual(["猫", "犬"]);
		expect(reversed.noun).toEqual(["犬", "猫"]);
		// ...but the same set of words fingerprints identically.
		expect(fingerprintDictionaryVocabularyPool(reversed)).toBe(
			fingerprintDictionaryVocabularyPool(forward),
		);
	});

	it("changes when a word is added", () => {
		const small = poolOf(token({ surface: "猫" }));
		const large = poolOf(token({ surface: "猫" }), token({ surface: "犬" }));

		expect(fingerprintDictionaryVocabularyPool(large)).not.toBe(
			fingerprintDictionaryVocabularyPool(small),
		);
	});

	it("distinguishes the same word held in different placeholders", () => {
		const asNoun = poolOf(token({ surface: "東京", detail1: "一般" }));
		const asPlace = poolOf(
			token({ surface: "東京", detail1: "固有名詞", detail2: "地域" }),
		);

		expect(fingerprintDictionaryVocabularyPool(asPlace)).not.toBe(
			fingerprintDictionaryVocabularyPool(asNoun),
		);
	});

	it("does not sort the pool's own arrays while fingerprinting", () => {
		const pool = buildDictionaryVocabularyPool([
			[token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "亜" })],
		]);

		fingerprintDictionaryVocabularyPool(pool);

		expect(pool.noun).toEqual(["猫", "犬", "亜"]);
	});

	it("is a uint32", () => {
		const fingerprint = fingerprintDictionaryVocabularyPool(
			poolOf(token({ surface: "猫" })),
		);

		expect(Number.isInteger(fingerprint)).toBe(true);
		expect(fingerprint).toBeGreaterThanOrEqual(0);
		expect(fingerprint).toBeLessThanOrEqual(0xffffffff);
	});
});
