import { describe, expect, it, vi } from "vitest";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import {
	BODY_SLOT_SCORE_DOMAIN,
	bodySlotScore,
	isSlotApplied,
} from "../src/transform/slotScore";
import {
	buildVocabularyPool,
	transformTokenSequences,
} from "../src/transform/transformTokens";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { HIGH, LOW, MAX, MEDIUM, OFF } from "./readyAnalysis";
import { token } from "./tokenFixtures";

const LEVELS = [OFF, LOW, MEDIUM, HIGH, MAX];

const particle = token({ surface: "は", pos: "助詞", detail1: "係助詞" });

/** Eight interchangeable nouns in one node, so every level differs visibly. */
const wideSequences = [
	[
		token({ surface: "猫" }),
		token({ surface: "犬" }),
		token({ surface: "鳥" }),
		token({ surface: "魚" }),
		token({ surface: "虫" }),
		token({ surface: "貝" }),
		token({ surface: "馬" }),
		token({ surface: "牛" }),
	],
] as const;
const widePool = buildVocabularyPool(wideSequences);

/** The same eight nouns spread over three nodes, plus a protected particle. */
const splitSequences = [
	[token({ surface: "猫" }), particle, token({ surface: "犬" })],
	[token({ surface: "鳥" }), token({ surface: "魚" }), token({ surface: "虫" })],
	[token({ surface: "貝" }), token({ surface: "馬" }), token({ surface: "牛" })],
] as const;
const splitPool = buildVocabularyPool(splitSequences);

/** Which slots actually changed, as "sequence:token" identities. */
function appliedSlots(
	sequences: typeof wideSequences | typeof splitSequences,
	pool: ReturnType<typeof buildVocabularyPool>,
	bodySeed: number,
	level: ReturnType<typeof assertBodySemantropy>,
): Map<string, string> {
	const result = transformTokenSequences(sequences, pool, bodySeed, level);
	const applied = new Map<string, string>();
	for (const [sequenceIndex, sequence] of sequences.entries()) {
		const text = result.texts[sequenceIndex] ?? "";
		let offset = 0;
		for (const [tokenIndex, entry] of sequence.entries()) {
			// Every surface here is one character, so offsets stay aligned.
			const surface = text.slice(offset, offset + entry.surface.length);
			offset += entry.surface.length;
			if (surface !== entry.surface) {
				applied.set(`${sequenceIndex}:${tokenIndex}`, surface);
			}
		}
	}
	return applied;
}

describe("bodySlotScore", () => {
	it("uses the documented domain constant", () => {
		expect(BODY_SLOT_SCORE_DOMAIN).toBe(0x534d5442);
	});

	it("matches a frozen vector for known slots", () => {
		// Regenerating these means the transform output moved; bump the
		// algorithm version rather than editing them in place.
		expect(bodySlotScore(0, { sequenceIndex: 0, tokenIndex: 0 })).toBe(
			797645537,
		);
		expect(bodySlotScore(0, { sequenceIndex: 0, tokenIndex: 1 })).toBe(
			3466500361,
		);
		expect(bodySlotScore(1, { sequenceIndex: 0, tokenIndex: 0 })).toBe(
			3147027295,
		);
		expect(bodySlotScore(7, { sequenceIndex: 2, tokenIndex: 3 })).toBe(
			241867051,
		);
	});

	it("returns a uint32 that depends on the Seed and both indices", () => {
		const base = bodySlotScore(5, { sequenceIndex: 1, tokenIndex: 2 });
		expect(Number.isInteger(base)).toBe(true);
		expect(base).toBeGreaterThanOrEqual(0);
		expect(base).toBeLessThanOrEqual(0xffffffff);
		expect(bodySlotScore(6, { sequenceIndex: 1, tokenIndex: 2 })).not.toBe(base);
		expect(bodySlotScore(5, { sequenceIndex: 2, tokenIndex: 2 })).not.toBe(base);
		expect(bodySlotScore(5, { sequenceIndex: 1, tokenIndex: 3 })).not.toBe(base);
	});

	it("never applies at 0 and always applies at 100", () => {
		for (let tokenIndex = 0; tokenIndex < 64; tokenIndex += 1) {
			const slot = { sequenceIndex: 0, tokenIndex };
			expect(isSlotApplied(11, slot, 0)).toBe(false);
			expect(isSlotApplied(11, slot, 100)).toBe(true);
		}
	});

	it("uses no ambient randomness", () => {
		const random = vi.spyOn(Math, "random");
		try {
			bodySlotScore(3, { sequenceIndex: 0, tokenIndex: 0 });
			isSlotApplied(3, { sequenceIndex: 0, tokenIndex: 0 }, 50);
			expect(random).not.toHaveBeenCalled();
		} finally {
			random.mockRestore();
		}
	});
});

describe("transformTokenSequences at each Semantropy value", () => {
	it("reports the current production algorithm version", () => {
		expect(
			transformTokenSequences(wideSequences, widePool, 7, MEDIUM)
				.algorithmVersion,
		).toBe(SEMANTROPY_ALGORITHM_VERSION);
		expect(SEMANTROPY_ALGORITHM_VERSION).toBe(9);
	});

	it("produces every level's result and carries the value back", () => {
		for (const level of LEVELS) {
			const result = transformTokenSequences(
				wideSequences,
				widePool,
				7,
				level,
			);
			expect(result.bodySemantropy).toBe(level);
			expect(result.texts).toHaveLength(1);
		}
	});

	it("returns the original text at 0", () => {
		const result = transformTokenSequences(wideSequences, widePool, 7, OFF);
		expect(result.texts).toEqual(["猫犬鳥魚虫貝馬牛"]);
		expect(result.replacementCount).toBe(0);
		expect(result.replaceableSlotCount).toBe(8);
	});

	it("exchanges every replaceable slot at 100", () => {
		const result = transformTokenSequences(wideSequences, widePool, 7, MAX);
		expect(result.replacementCount).toBe(result.replaceableSlotCount);
		expect(result.replacementCount).toBe(8);
		expect(result.texts[0]).not.toBe("猫犬鳥魚虫貝馬牛");
	});

	it("is fully reproducible for the same input, Seed and value", () => {
		for (const level of LEVELS) {
			expect(
				transformTokenSequences(wideSequences, widePool, 7, level),
			).toEqual(transformTokenSequences(wideSequences, widePool, 7, level));
		}
	});

	it("grows the applied slot set monotonically as the value rises", () => {
		let previous = new Set<string>();
		for (const level of LEVELS) {
			const current = new Set(
				appliedSlots(wideSequences, widePool, 7, level).keys(),
			);
			for (const slot of previous) {
				expect(current.has(slot)).toBe(true);
			}
			expect(current.size).toBeGreaterThanOrEqual(previous.size);
			previous = current;
		}
		expect(previous.size).toBe(8);
	});

	it("stays monotonic across several text nodes", () => {
		for (const bodySeed of [0, 1, 7, 4242, 0xffffffff]) {
			let previous = new Set<string>();
			for (const level of LEVELS) {
				const current = new Set(
					appliedSlots(splitSequences, splitPool, bodySeed, level).keys(),
				);
				for (const slot of previous) {
					expect(current.has(slot)).toBe(true);
				}
				previous = current;
			}
		}
	});

	it("gives a slot the same replacement at every level that applies it", () => {
		for (const bodySeed of [0, 7, 4242]) {
			const byLevel = LEVELS.map((level) =>
				appliedSlots(splitSequences, splitPool, bodySeed, level),
			);
			const atMax = byLevel[byLevel.length - 1];
			if (!atMax) {
				throw new Error("expected a MAX result");
			}
			for (const applied of byLevel) {
				for (const [slot, surface] of applied) {
					// A slot skipped at a low value must not shift the draw for any
					// later slot, so the surface chosen here is the MAX surface.
					expect(surface).toBe(atMax.get(slot));
				}
			}
		}
	});

	it("keeps the replaceable slot count independent of the value", () => {
		const counts = LEVELS.map(
			(level) =>
				transformTokenSequences(splitSequences, splitPool, 7, level)
					.replaceableSlotCount,
		);
		expect(new Set(counts).size).toBe(1);
		expect(counts[0]).toBe(8);
	});

	it("excludes slots with no candidate from the replaceable count", () => {
		const lonely = [
			[token({ surface: "孤語" }), particle, token({ surface: "数", detail1: "数" })],
		] as const;
		const result = transformTokenSequences(
			lonely,
			buildVocabularyPool(lonely),
			7,
			MAX,
		);
		expect(result.replaceableSlotCount).toBe(0);
		expect(result.replacementCount).toBe(0);
		expect(result.texts).toEqual(["孤語は数"]);
	});

	it("separates an off value from an empty pool", () => {
		const off = transformTokenSequences(wideSequences, widePool, 7, OFF);
		expect(off.replacementCount).toBe(0);
		expect(off.replaceableSlotCount).toBeGreaterThan(0);

		const lonely = [[token({ surface: "孤語" })]] as const;
		const empty = transformTokenSequences(
			lonely,
			buildVocabularyPool(lonely),
			7,
			MAX,
		);
		expect(empty.replacementCount).toBe(0);
		expect(empty.replaceableSlotCount).toBe(0);
	});

	it("rejects a value outside the validated range", () => {
		for (const bad of [-1, 101, 0.5, Number.NaN]) {
			expect(() => assertBodySemantropy(bad)).toThrow(RangeError);
		}
	});

	it("does not mutate the tokens, the sequences or the pool", () => {
		const before = structuredClone(splitSequences);
		const poolBefore = [...splitPool.entries()].map(([key, surfaces]) => [
			key,
			[...surfaces],
		]);

		for (const level of LEVELS) {
			transformTokenSequences(splitSequences, splitPool, 7, level);
		}

		expect(structuredClone(splitSequences)).toEqual(before);
		expect(
			[...splitPool.entries()].map(([key, surfaces]) => [key, [...surfaces]]),
		).toEqual(poolBefore);
	});

	it("uses no ambient randomness", () => {
		const random = vi.spyOn(Math, "random");
		try {
			for (const level of LEVELS) {
				transformTokenSequences(splitSequences, splitPool, 7, level);
			}
			expect(random).not.toHaveBeenCalled();
		} finally {
			random.mockRestore();
		}
	});
});
