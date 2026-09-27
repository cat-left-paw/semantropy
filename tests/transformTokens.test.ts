import { describe, expect, it } from "vitest";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import {
	buildVocabularyPool,
	transformTokenSequences,
} from "../src/transform/transformTokens";
import { token } from "./tokenFixtures";
import { MAX } from "./readyAnalysis";

const particle = token({ surface: "は", pos: "助詞", detail1: "係助詞" });
const auxiliary = token({ surface: "た", pos: "助動詞", detail1: "*" });
const verb = token({
	surface: "待っ",
	pos: "動詞",
	detail1: "自立",
	conjugationType: "五段・タ行",
	conjugationForm: "連用タ接続",
	baseForm: "待つ",
});
const adjective = token({ surface: "長い", pos: "形容詞", detail1: "自立" });
const period = token({ surface: "。", pos: "記号", detail1: "句点" });

const cat = token({ surface: "猫" });
const dog = token({ surface: "犬" });
const bird = token({ surface: "鳥" });

function snapshot<T>(value: T): T {
	return structuredClone(value);
}

describe("buildVocabularyPool", () => {
	it("deduplicates surfaces while preserving first-seen order", () => {
		const pool = buildVocabularyPool([
			[cat, particle, cat, dog, bird],
		]);
		expect([...pool.values()][0]).toEqual(["猫", "犬", "鳥"]);
	});

	it("builds one Current Note pool across multiple sequences", () => {
		const pool = buildVocabularyPool([[cat], [dog, bird]]);
		expect([...pool.values()][0]).toEqual(["猫", "犬", "鳥"]);
	});

	it("does not put ineligible tokens into the pool", () => {
		const unknown = token({ surface: "未知", isUnknown: true });
		const pool = buildVocabularyPool([[unknown, particle, cat]]);
		expect([...pool.values()][0]).toEqual(["猫"]);
	});
});

describe("transformTokenSequences", () => {
	const animalSequences = [[cat, dog, bird]] as const;
	const animalPool = buildVocabularyPool(animalSequences);

	it("returns identical results for the same input, pool, and seed", () => {
		const first = transformTokenSequences(animalSequences, animalPool, 0, MAX);
		const second = transformTokenSequences(animalSequences, animalPool, 0, MAX);
		expect(first).toEqual(second);
		expect(first.texts).toEqual(["犬猫猫"]);
		expect(first.algorithmVersion).toBe(SEMANTROPY_ALGORITHM_VERSION);
	});

	it("reproduces seed 0 and changes result for a fixed different seed", () => {
		const zero = transformTokenSequences(animalSequences, animalPool, 0, MAX);
		const one = transformTokenSequences(animalSequences, animalPool, 1, MAX);
		expect(zero.texts).toEqual(["犬猫猫"]);
		expect(one.texts).toEqual(["鳥猫犬"]);
		expect(zero.texts).not.toEqual(one.texts);
	});

	it("does not mutate token sequences, token objects, or the pool", () => {
		const sequence = [cat, particle, dog];
		const sequences = [sequence];
		const pool = buildVocabularyPool(sequences);
		const sequenceBefore = snapshot(sequences);
		const tokenBefore = snapshot(cat);
		const poolBefore = [...pool.entries()].map(([key, surfaces]) => [
			key,
			[...surfaces],
		]);

		transformTokenSequences(sequences, pool, 1, MAX);

		expect(sequences).toEqual(sequenceBefore);
		expect(cat).toEqual(tokenBefore);
		expect([...pool.entries()].map(([key, surfaces]) => [key, [...surfaces]])).toEqual(
			poolBefore,
		);
	});

	it("leaves particles, auxiliaries, symbols, verbs, and adjectives unchanged", () => {
		const sequences = [
			[
				token({ surface: "駅" }),
				particle,
				token({ surface: "病院" }),
				verb,
				adjective,
				auxiliary,
				period,
			],
		];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			1,
			MAX,
		);
		expect(result.texts[0]?.includes("は")).toBe(true);
		expect(result.texts[0]?.includes("待っ")).toBe(true);
		expect(result.texts[0]?.includes("長い")).toBe(true);
		expect(result.texts[0]?.includes("た")).toBe(true);
		expect(result.texts[0]?.endsWith("。")).toBe(true);
	});

	it("does not replace numbers, suffixes, dependent nouns, or pronouns", () => {
		const protectedNouns = [
			token({ surface: "三", detail1: "数" }),
			token({ surface: "さん", detail1: "接尾" }),
			token({ surface: "の", detail1: "非自立" }),
			token({ surface: "それ", detail1: "代名詞" }),
		];
		const sequences = [protectedNouns];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			1,
			MAX,
		);
		expect(result.texts).toEqual(["三さんのそれ"]);
		expect(result.replacementCount).toBe(0);
	});

	it("does not replace unknown nouns", () => {
		const sequences = [
			[
				token({ surface: "未知甲", isUnknown: true }),
				token({ surface: "未知乙", isUnknown: true }),
			],
		];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			1,
			MAX,
		);
		expect(result.texts).toEqual(["未知甲未知乙"]);
		expect(result.replacementCount).toBe(0);
	});

	it("does not replace a single Unicode symbol token", () => {
		const sequences = [
			[
				token({ surface: "😔" }),
				token({ surface: "★" }),
			],
		];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			1,
			MAX,
		);
		expect(result.texts).toEqual(["😔★"]);
		expect(result.replacementCount).toBe(0);
	});

	it("swaps common nouns, sahen nouns, and adjectival stems within their pools", () => {
		const sequences = [
			[
				token({ surface: "駅", detail1: "一般" }),
				token({ surface: "病院", detail1: "一般" }),
				token({ surface: "運動", detail1: "サ変接続" }),
				token({ surface: "勉強", detail1: "サ変接続" }),
				token({ surface: "静か", detail1: "形容動詞語幹" }),
				token({ surface: "穏やか", detail1: "形容動詞語幹" }),
			],
		];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			0,
			MAX,
		);
		expect(result.texts).toEqual(["病院駅勉強運動穏やか静か"]);
		expect(result.replacementCount).toBe(6);
	});

	it("does not mix proper nouns that differ in detail2", () => {
		const sequences = [
			[
				token({ surface: "太郎", detail1: "固有名詞", detail2: "人名" }),
				token({ surface: "花子", detail1: "固有名詞", detail2: "人名" }),
				token({ surface: "東京", detail1: "固有名詞", detail2: "地域" }),
				token({ surface: "大阪", detail1: "固有名詞", detail2: "地域" }),
			],
		];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			0,
			MAX,
		);
		expect(result.texts[0]).toMatch(/^(花子太郎|太郎花子)(大阪東京|東京大阪)$/);
		expect(result.texts[0]?.includes("太郎東京")).toBe(false);
		expect(result.texts[0]?.includes("東京太郎")).toBe(false);
	});

	it("uses the fallback key when proper-noun detail2 is unavailable", () => {
		const sequences = [
			[
				token({ surface: "甲", detail1: "固有名詞", detail2: "*" }),
				token({ surface: "乙", detail1: "固有名詞", detail2: "" }),
				token({ surface: "太郎", detail1: "固有名詞", detail2: "人名" }),
			],
		];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			0,
			MAX,
		);
		expect(result.texts[0]?.startsWith("乙甲") || result.texts[0]?.startsWith("甲乙")).toBe(
			true,
		);
		expect(result.texts[0]?.endsWith("太郎")).toBe(true);
		expect(result.replacementCount).toBe(2);
	});

	it("keeps the original text when a pool has 0 or 1 unique surfaces", () => {
		const empty = transformTokenSequences([[particle, period]], buildVocabularyPool([[particle, period]]), 1, MAX);
		expect(empty.texts).toEqual(["は。"]);
		expect(empty.replacementCount).toBe(0);

		const singleton = transformTokenSequences(
			[[cat, particle]],
			buildVocabularyPool([[cat, particle]]),
			1,
			MAX,
		);
		expect(singleton.texts).toEqual(["猫は"]);
		expect(singleton.replacementCount).toBe(0);
	});

	it("avoids self-replacement when another candidate exists", () => {
		const sequences = [[cat, dog]];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			0,
			MAX,
		);
		expect(result.texts).toEqual(["犬猫"]);
		expect(result.replacementCount).toBe(2);
	});

	it("shares one pool and one PRNG stream across multiple token sequences", () => {
		const sequences = [
			[cat, particle],
			[dog, token({ surface: "と", pos: "助詞", detail1: "並立助詞" }), bird],
		];
		const pool = buildVocabularyPool(sequences);
		const shared = transformTokenSequences(sequences, pool, 1, MAX);
		expect(shared.texts).toEqual(["鳥は", "猫と犬"]);
		expect(shared.replacementCount).toBe(3);

		const independent = [
			transformTokenSequences([sequences[0]!], pool, 1, MAX).texts[0],
			transformTokenSequences([sequences[1]!], pool, 1, MAX).texts[0],
		];
		expect(independent).toEqual(["鳥は", "鳥と猫"]);
		expect(shared.texts).not.toEqual(independent);
	});

	it("concatenates replacement surfaces in token order", () => {
		const sequences = [[cat, particle, dog, period]];
		const result = transformTokenSequences(
			sequences,
			buildVocabularyPool(sequences),
			0,
			MAX,
		);
		expect(result.texts).toEqual(["犬は猫。"]);
	});

	it("counts only tokens whose surface actually changed", () => {
		const result = transformTokenSequences(
			animalSequences,
			animalPool,
			0,
			MAX,
		);
		expect(result.replacementCount).toBe(3);
		expect(result.texts.join("")).not.toBe("猫犬鳥");
	});
});
