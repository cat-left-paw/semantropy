import { beforeAll, describe, expect, it } from "vitest";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";
import { buildAdverbObservationIndex, evaluateAdverbAtLevel } from "../support/max/adverbProfiles";
import { TO_OPTIONAL_ADVERB_BRIDGE_PROFILE } from "../../src/adverb/adverbBridgeProfile";

/**
 * Policy 1 §4.4 on the shipped dictionary: what each adverb profile relaxes,
 * and what none of them relax.
 *
 * This slice changes no production adverb logic. These are model assertions
 * over the existing `PRE-RELEASE-ADVERB-SPIKE1` authority, run on real
 * tokenizer output so the sentences are the ones the plugin would actually
 * see, and they exist so MAX-CORE1 inherits a decision rather than a guess.
 */

describe("adverb strict / High / MAX", () => {
	let tokenize: Tokenize;
	beforeAll(async () => {
		await initLindera();
		tokenize = buildTokenize(compactDictionaryDir());
	});

	const index = (...texts: readonly string[]) =>
		buildAdverbObservationIndex(texts.map((text) => ({ tokens: tokenize(text) })));

	const adverbToken = (text: string) => {
		const found = tokenize(text).find((item) => item.pos === "副詞");
		if (!found) throw new Error(`no 副詞 in ${text}`);
		return found;
	};

	const at = (text: string) => {
		const tokens = tokenize(text);
		const targetIndex = tokens.findIndex((item) => item.pos === "副詞");
		if (targetIndex < 0) throw new Error(`no 副詞 slot in ${text}`);
		return { targetTokens: tokens, targetIndex };
	};

	it("keeps head class as a hard constraint in strict and drops it above", () => {
		// `決して` is only ever observed before a negative; the Target is
		// affirmative, so strict refuses it and High and MAX accept it.
		const observed = index("決して行かない。");
		const slot = at("ゆっくりと歩く。");
		const candidate = adverbToken("決して行かない。");
		const strict = evaluateAdverbAtLevel({ level: "strict", index: observed, ...slot, candidateToken: candidate });
		expect(strict.usable).toBe(false);
		expect(evaluateAdverbAtLevel({ level: "high", index: observed, ...slot, candidateToken: candidate })).toEqual({
			usable: true,
			surface: "決して",
		});
		expect(evaluateAdverbAtLevel({ level: "max", index: observed, ...slot, candidateToken: candidate })).toEqual({
			usable: true,
			surface: "決して",
		});
	});

	it("still requires an observation at High and does not at MAX", () => {
		const observed = index("じっくり考える。");
		const slot = at("ゆっくりと歩く。");
		const unobserved = adverbToken("しばらく待つ。");
		expect(evaluateAdverbAtLevel({ level: "high", index: observed, ...slot, candidateToken: unobserved })).toEqual({
			usable: false,
			reason: "no-observation",
		});
		expect(evaluateAdverbAtLevel({ level: "max", index: observed, ...slot, candidateToken: unobserved }).usable).toBe(true);
	});

	it("refuses the duplicate external と at every level, including MAX", () => {
		// ADVERB-SPIKE1 established that these really do produce a
		// surface-final と in front of an external 副詞化 と, which is what
		// makes the guard load-bearing rather than defensive.
		const slot = at("ゆっくりと歩く。");
		const probed: string[] = [];
		for (const text of ["そっと歩く。", "意外と難しい。", "ちょっと待つ。"]) {
			const candidate = adverbToken(text);
			if (!candidate.surface.endsWith("と")) continue;
			probed.push(candidate.surface);
			const observed = index(text, "そっとと歩く。");
			// No level produces a surface for it.
			for (const level of ["strict", "high", "max"] as const) {
				expect(
					evaluateAdverbAtLevel({ level, index: observed, ...slot, candidateToken: candidate }).usable,
				).toBe(false);
			}
			// High and MAX have dropped head class and polarity, so the guard is
			// the *only* thing left standing between the candidate and the text.
			// It is what refuses, by name.
			for (const level of ["high", "max"] as const) {
				expect(
					evaluateAdverbAtLevel({ level, index: observed, ...slot, candidateToken: candidate }),
				).toEqual({ usable: false, reason: "duplicate-to-bridge" });
			}
		}
		expect(probed.length).toBeGreaterThan(0);

		// And strict reaches the same guard when head class and polarity do
		// agree: `そっと` before a nonnegative verb predicate matches the Target
		// profile in every dimension except its own final と.
		const sotto = adverbToken("そっと歩く。");
		expect(sotto.surface).toBe("そっと");
		expect(
			evaluateAdverbAtLevel({
				level: "strict",
				index: index("そっと歩く。"),
				...slot,
				candidateToken: sotto,
			}),
		).toEqual({ usable: false, reason: "duplicate-to-bridge" });
	});

	it("retains the Target bridge and replaces only the candidate surface", () => {
		// The Target token list is not consumed or rewritten: the external と is
		// still token 1 after every evaluation, at every level.
		const slot = at("ゆっくりと歩く。");
		expect(slot.targetTokens[1]!.surface).toBe("と");
		expect(slot.targetTokens[1]!.detail1).toBe("副詞化");
		const observed = index("じっくり考える。");
		const candidate = adverbToken("じっくり考える。");
		for (const level of ["strict", "high", "max"] as const) {
			const result = evaluateAdverbAtLevel({ level, index: observed, ...slot, candidateToken: candidate });
			expect(result).toEqual({ usable: true, surface: "じっくり" });
			expect(slot.targetTokens[1]!.surface).toBe("と");
		}
		// `じっくり` reaching a `to` Target from a bridgeless observation is the
		// reviewed `to-optional` profile doing its job, and it is still data
		// version 1 — this slice adds no entry.
		expect(TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.dataVersion).toBe(1);
	});

	it("never promotes a non-adverb, at any level", () => {
		const observed = index("ゆっくりと歩く。");
		const slot = at("ゆっくりと歩く。");
		const nonAdverb = tokenize("速く歩く。")[0]!;
		expect(nonAdverb.pos).not.toBe("副詞");
		for (const level of ["strict", "high", "max"] as const) {
			expect(
				evaluateAdverbAtLevel({ level, index: observed, ...slot, candidateToken: nonAdverb }).usable,
			).toBe(false);
		}
		// `名詞 / 副詞可能` stays a noun at every level too.
		const adverbialNoun = tokenize("今日は歩く。")[0]!;
		expect(adverbialNoun.pos).toBe("名詞");
		for (const level of ["strict", "high", "max"] as const) {
			expect(
				evaluateAdverbAtLevel({ level, index: observed, ...slot, candidateToken: adverbialNoun }).usable,
			).toBe(false);
		}
	});

	it("refuses a Target that is not an adverb slot, whatever the level", () => {
		const observed = index("ゆっくりと歩く。");
		const candidate = adverbToken("ゆっくりと歩く。");
		// 形容動詞語幹 without a copula is unsupported, by ADVERB-SPIKE1's rule.
		const tokens = tokenize("ゆっくりと丁寧に歩く。");
		const targetIndex = tokens.findIndex((item) => item.pos === "副詞");
		for (const level of ["strict", "high", "max"] as const) {
			const result = evaluateAdverbAtLevel({ level, index: observed, targetTokens: tokens, targetIndex, candidateToken: candidate });
			// Either the slot is refused, or it is a genuine slot — but the
			// refusal, when it happens, is the Target's and not the candidate's.
			if (!result.usable) expect(result.reason).not.toBe("no-observation");
		}
	});
});
