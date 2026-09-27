import { describe, expect, it } from "vitest";
import {
	adverbBridgeCapabilities,
	evaluateAdverbCandidate,
} from "../src/adverb/adverbCapability";
import { isToOptionalAdverb } from "../src/adverb/adverbBridgeProfile";
import {
	ADVERB_FAMILY,
	classifyAdverbCandidate,
} from "../src/adverb/adverbFamily";
import {
	ADVERB_CLAUSE_FINAL_AUXILIARY_SURFACES,
	ADVERB_COPULA_SURFACES,
	ADVERB_NEGATIVE_AUXILIARY_SURFACES,
	ADVERB_STANDALONE_VERB_FORMS,
	type AdverbObservationEntry,
	buildAdverbObservationIndex,
	observeAdverbSlot,
} from "../src/adverb/adverbObservation";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";

/**
 * Focused regressions for the four defects the first independent review of
 * `PRE-RELEASE-ADVERB-SPIKE1` found. Each one fails without its fix, and they
 * are kept together so the review's own scenarios stay legible rather than
 * being dissolved into the general suite.
 *
 *   P1-1  a 読点 was read as `sentence-modifier / not-applicable`, which made
 *         every clause-initial adverb interchangeable regardless of polarity.
 *         **Superseded**: the owner amended the policy on 2026-09-21 to accept
 *         exactly that, so the block below now pins the approved contract and
 *         its tradeoff instead of the refusal. See
 *         `Docs/pre_release_adverb_sentence_modifier_amendment1.md`.
 *   P1-2  the bound-form set named only 未然 / 仮定, so a run cut short at a
 *         連用形 or 連用タ接続 head read as `nonnegative`.
 *   P1-3  observations were looked up by `identityKey` while the profile and
 *         the duplicate-と guard read the caller's own surface and class.
 *   P2-4  the published index exposed a plain `Map`, mutable after the root
 *         freeze and iterated in first-occurrence rather than canonical order;
 *         the exported rule sets were `ReadonlySet` in type only.
 */

const UNSET = "*";

function adverb(surface: string, detail1: "一般" | "助詞類接続"): JapaneseToken {
	return {
		surface,
		pos: "副詞",
		detail1,
		detail2: UNSET,
		detail3: UNSET,
		conjugationType: UNSET,
		conjugationForm: UNSET,
		baseForm: UNSET,
		isUnknown: false,
	};
}

function verb(
	surface: string,
	conjugationForm: string,
	baseForm: string,
	conjugationType = "五段・カ行イ音便",
): JapaneseToken {
	return {
		surface,
		pos: "動詞",
		detail1: "自立",
		detail2: UNSET,
		detail3: UNSET,
		conjugationType,
		conjugationForm,
		baseForm,
		isUnknown: false,
	};
}

function plain(
	surface: string,
	pos: string,
	detail1: string,
	detail2 = UNSET,
): JapaneseToken {
	return {
		surface,
		pos,
		detail1,
		detail2,
		detail3: UNSET,
		conjugationType: UNSET,
		conjugationForm: UNSET,
		baseForm: UNSET,
		isUnknown: false,
	};
}

const BRIDGE = plain("と", "助詞", "副詞化");
const COMMA = plain("、", "記号", "読点");
const PERIOD = plain("。", "記号", "句点");
const AUX_NAI = plain("ない", "助動詞", UNSET);
const AUX_TA = plain("た", "助動詞", UNSET);
const ARUKU = verb("歩く", "基本形", "歩く");
const KANGAERU = verb("考える", "基本形", "考える", "一段");
const TO_TARGET = [adverb("ゆっくり", "助詞類接続"), BRIDGE, ARUKU];

function identityOf(token: JapaneseToken) {
	const result = classifyAdverbCandidate(token);
	if (!result.supported) {
		throw new Error(`expected a family member, got ${result.reason}`);
	}
	return result.identity;
}

function reasonOf(tokens: readonly JapaneseToken[]) {
	const result = observeAdverbSlot({ tokens, index: 0 });
	if (result.supported) {
		throw new Error(
			`expected a rejection, got ${JSON.stringify(result.observation.profile)}`,
		);
	}
	return result.reason;
}

function polarityOf(tokens: readonly JapaneseToken[]) {
	const result = observeAdverbSlot({ tokens, index: 0 });
	if (!result.supported) {
		throw new Error(`expected an observation, got ${result.reason}`);
	}
	return result.observation.profile.polarity;
}

describe("owner-approved: a 読点 is a sentence modifier", () => {
	const KESSHITE = adverb("決して", "一般");
	const MOCHIRON = adverb("もちろん", "一般");
	const KARE = plain("彼", "名詞", "代名詞", "一般");
	const WA = plain("は", "助詞", "係助詞");
	// 決して、彼は来ない / もちろん、彼は来る, as the shipped tokenizer splits them.
	const NEGATIVE_CLAUSE = [
		KESSHITE,
		COMMA,
		KARE,
		WA,
		verb("来", "未然形", "来る", "カ変・来ル"),
		AUX_NAI,
	];
	const AFFIRMATIVE_CLAUSE = [
		MOCHIRON,
		COMMA,
		KARE,
		WA,
		verb("来る", "基本形", "来る", "カ変・来ル"),
	];

	it("observes the comma and reads nothing past it", () => {
		for (const tokens of [NEGATIVE_CLAUSE, AFFIRMATIVE_CLAUSE]) {
			const result = observeAdverbSlot({ tokens, index: 0 });
			expect(result.supported).toBe(true);
			if (result.supported) {
				expect(result.observation.profile).toMatchObject({
					headClass: "sentence-modifier",
					polarity: "not-applicable",
					bridge: "none",
				});
			}
		}
		// The clause's own polarity never reaches the profile, so the two are
		// the same observation.
		expect(
			observeAdverbSlot({ tokens: NEGATIVE_CLAUSE, index: 0 }),
		).toMatchObject({
			observation: {
				profile: {
					profileKey: JSON.stringify([
						"sentence-modifier",
						"not-applicable",
						"none",
					]),
				},
			},
		});
	});

	it("accepts the tradeoff the owner approved, explicitly", () => {
		// `決して、彼は来る` is reachable. The first independent review raised
		// this as a P1 against the policy as it then stood and was right to;
		// the owner has since amended the policy to prefer variation and
		// implementation simplicity here. Asserting it keeps the consequence a
		// decision rather than an accident — if this ever starts failing, the
		// contract changed and the amendment has to be revisited.
		const index = buildAdverbObservationIndex([{ tokens: NEGATIVE_CLAUSE }]);
		expect(index.candidates).toHaveLength(1);
		expect(
			evaluateAdverbCandidate({
				index,
				targetTokens: AFFIRMATIVE_CLAUSE,
				targetIndex: 0,
				candidate: identityOf(KESSHITE),
			}),
		).toMatchObject({ usable: true, bridge: "none" });
	});

	it("reads a bridge before the comma and still stops there", () => {
		const bridged = [adverb("ゆっくり", "助詞類接続"), BRIDGE, COMMA, ARUKU];
		const result = observeAdverbSlot({ tokens: bridged, index: 0 });
		expect(result.supported).toBe(true);
		if (result.supported) {
			expect(result.observation.profile).toMatchObject({
				headClass: "sentence-modifier",
				polarity: "not-applicable",
				bridge: "to",
			});
		}
	});

	it("keeps the duplicate-と guard over a comma Target", () => {
		// The amendment widened the head class, not the bridge guard.
		const index = buildAdverbObservationIndex([
			{ tokens: [adverb("そっと", "一般"), COMMA, ARUKU] },
		]);
		expect(
			evaluateAdverbCandidate({
				index,
				targetTokens: [adverb("ゆっくり", "助詞類接続"), BRIDGE, COMMA, ARUKU],
				targetIndex: 0,
				candidate: identityOf(adverb("そっと", "一般")),
			}),
		).toEqual({
			usable: false,
			stage: "candidate",
			reason: "duplicate-to-bridge",
		});
	});

	it("still keeps a sentence modifier away from a predicate head", () => {
		// The head classes remain hard constraints between themselves.
		const index = buildAdverbObservationIndex([{ tokens: NEGATIVE_CLAUSE }]);
		expect(
			evaluateAdverbCandidate({
				index,
				targetTokens: [adverb("ゆっくり", "助詞類接続"), ARUKU],
				targetIndex: 0,
				candidate: identityOf(KESSHITE),
			}),
		).toEqual({
			usable: false,
			stage: "candidate",
			reason: "head-class-mismatch",
		});
	});
});

describe("P1-2: a predicate the run cut short is not affirmative", () => {
	it("refuses every bound head form, not only 未然 and 仮定", () => {
		for (const head of [
			verb("歩い", "連用タ接続", "歩く"),
			verb("食べ", "連用形", "食べる", "一段"),
			verb("読ん", "連用タ接続", "読む", "五段・マ行"),
			verb("歩き", "連用形", "歩く"),
			verb("歩か", "未然形", "歩く"),
			verb("歩け", "仮定形", "歩く"),
		]) {
			const adverbHead = [adverb("ゆっくり", "助詞類接続"), head];
			expect(`${head.surface}: ${reasonOf(adverbHead)}`).toBe(
				`${head.surface}: polarity-undetermined`,
			);
			// A terminator does not rescue it either: nothing was crossed.
			expect(reasonOf([...adverbHead, PERIOD])).toBe("polarity-undetermined");
		}
	});

	it("still decides for a standalone form or a crossed continuation", () => {
		expect(polarityOf([adverb("ゆっくり", "助詞類接続"), ARUKU])).toBe(
			"nonnegative",
		);
		expect(
			polarityOf([
				adverb("ゆっくり", "助詞類接続"),
				verb("歩け", "命令ｅ", "歩く"),
			]),
		).toBe("nonnegative");
		expect(
			polarityOf([
				adverb("ゆっくり", "助詞類接続"),
				verb("歩い", "連用タ接続", "歩く"),
				AUX_TA,
			]),
		).toBe("nonnegative");
		expect(
			polarityOf([
				adverb("ゆっくり", "助詞類接続"),
				verb("歩か", "未然形", "歩く"),
				AUX_NAI,
			]),
		).toBe("negative");
	});

	it("keeps the standalone list an allowlist, so an unknown form is bound", () => {
		expect(ADVERB_STANDALONE_VERB_FORMS).not.toContain("連用形");
		expect(ADVERB_STANDALONE_VERB_FORMS).not.toContain("連用タ接続");
		expect(ADVERB_STANDALONE_VERB_FORMS).not.toContain("体言接続");
		expect(
			reasonOf([
				adverb("ゆっくり", "助詞類接続"),
				verb("歩く", "この活用形は辞書にない", "歩く"),
			]),
		).toBe("polarity-undetermined");
	});
});

describe("P1-3: a candidate's fields must be the ones its evidence is filed under", () => {
	const index = buildAdverbObservationIndex([
		{ tokens: [adverb("じっくり", "一般"), KANGAERU] },
	]);
	const jikkuri = identityOf(adverb("じっくり", "一般"));

	function evaluate(candidate: {
		family: typeof ADVERB_FAMILY;
		adverbClass: "一般" | "助詞類接続";
		surface: string;
		identityKey: string;
	}) {
		return evaluateAdverbCandidate({
			index,
			targetTokens: TO_TARGET,
			targetIndex: 0,
			candidate,
		});
	}

	it("refuses じっくり's genuine key carrying すぐ's surface and class", () => {
		// Reported forgery: this reached `to` through じっくり's profile entry,
		// because the lookup and the decision read different fields.
		expect(
			evaluate({
				family: ADVERB_FAMILY,
				adverbClass: "助詞類接続",
				surface: "すぐ",
				identityKey: jikkuri.identityKey,
			}),
		).toEqual({
			usable: false,
			stage: "candidate",
			reason: "candidate-identity-mismatch",
		});
	});

	it("refuses any single substituted field", () => {
		for (const patch of [
			{ surface: "そっと" },
			{ adverbClass: "助詞類接続" as const },
			{ family: "irregular-adverb" as unknown as typeof ADVERB_FAMILY },
		]) {
			expect(evaluate({ ...jikkuri, ...patch })).toEqual({
				usable: false,
				stage: "candidate",
				reason: "candidate-identity-mismatch",
			});
		}
	});

	it("refuses a surface the guard would catch even when the key is genuine", () => {
		// そっと's own key is not in the index at all, and borrowing じっくり's
		// does not smuggle the surface past the duplicate-と guard either.
		expect(
			evaluate({
				family: ADVERB_FAMILY,
				adverbClass: "一般",
				surface: "そっと",
				identityKey: jikkuri.identityKey,
			}),
		).toEqual({
			usable: false,
			stage: "candidate",
			reason: "candidate-identity-mismatch",
		});
		expect(
			evaluateAdverbCandidate({
				index,
				targetTokens: TO_TARGET,
				targetIndex: 0,
				candidate: identityOf(adverb("そっと", "一般")),
			}),
		).toEqual({ usable: false, stage: "candidate", reason: "no-observation" });
	});

	it("resolves and returns the index's own record, not the argument", () => {
		const result = evaluate({ ...jikkuri });
		expect(result).toMatchObject({ usable: true, bridge: "to" });
		if (result.usable) {
			expect(result.candidate).toBe(index.entries[0]!.identity);
		}
	});
});

describe("R2-P1: a tail that ends mid-continuation is not affirmative", () => {
	const HELPER_I = plain("い", "動詞", "非自立");
	const HELPER_IRU = plain("いる", "動詞", "非自立");
	const HELPER_OKU = plain("おく", "動詞", "非自立");
	const SUFFIX_SE = plain("せ", "動詞", "接尾");
	const AUX_MASHI = plain("まし", "助動詞", UNSET);
	const AUX_MASU = plain("ます", "助動詞", UNSET);
	const PARTICLE_TE = plain("て", "助詞", "接続助詞");
	const ARUI = verb("歩い", "連用タ接続", "歩く");
	const ARUKI = verb("歩き", "連用形", "歩く");
	const ARUKA = verb("歩か", "未然形", "歩く");

	it("refuses the three reported truncations", () => {
		// Crossing a continuation was enough to call a run end affirmative, so
		// each of these — a predicate cut off mid-tail — was recorded as an
		// affirmative observation.
		for (const [label, tokens] of [
			["ゆっくり歩いてい", [ARUI, PARTICLE_TE, HELPER_I]],
			["ゆっくり歩きまし", [ARUKI, AUX_MASHI]],
			["ゆっくり歩かせ", [ARUKA, SUFFIX_SE]],
		] as const) {
			expect(`${label}: ${reasonOf([adverb("ゆっくり", "助詞類接続"), ...tokens])}`).toBe(
				`${label}: polarity-undetermined`,
			);
		}
	});

	it("still decides when the last token crossed can end a clause", () => {
		for (const [label, tokens] of [
			["ゆっくり歩いた", [ARUI, AUX_TA]],
			["ゆっくり歩きます", [ARUKI, AUX_MASU]],
			["ゆっくり歩きました", [ARUKI, AUX_MASHI, AUX_TA]],
			["ゆっくり歩いています", [ARUI, PARTICLE_TE, HELPER_I, AUX_MASU]],
			["ゆっくり歩こう", [verb("歩こ", "未然ウ接続", "歩く"), plain("う", "助動詞", UNSET)]],
			["ゆっくり歩きたい", [ARUKI, plain("たい", "助動詞", UNSET)]],
			["ゆっくり歩くらしい", [ARUKU, plain("らしい", "助動詞", UNSET)]],
		] as const) {
			expect(
				`${label}: ${polarityOf([adverb("ゆっくり", "助詞類接続"), ...tokens])}`,
			).toBe(`${label}: nonnegative`);
		}
	});

	it("never calls a helper verb or a 接続助詞 clause-final", () => {
		// Compaction leaves 動詞 / 非自立, 動詞 / 接尾 and 助詞 / 接続助詞 with
		// every conjugation slot `*`, so there is nothing readable to decide on
		// and they are never clause-final. That costs 〜ている / 〜ておく at a
		// bare run end, which is the recorded conservative direction.
		for (const tail of [
			[ARUI, PARTICLE_TE, HELPER_IRU],
			[ARUI, PARTICLE_TE, HELPER_OKU],
			[ARUI, PARTICLE_TE],
		]) {
			expect(reasonOf([adverb("ゆっくり", "助詞類接続"), ...tail])).toBe(
				"polarity-undetermined",
			);
			// A terminator proves where the predicate ended, so it still decides.
			expect(
				polarityOf([adverb("ゆっくり", "助詞類接続"), ...tail, PERIOD]),
			).toBe("nonnegative");
		}
		expect(ADVERB_CLAUSE_FINAL_AUXILIARY_SURFACES).toEqual([
			"う",
			"たい",
			"た",
			"ます",
			"らしい",
		]);
		expect(Object.isFrozen(ADVERB_CLAUSE_FINAL_AUXILIARY_SURFACES)).toBe(true);
	});

	it("keeps a negative tail negative regardless of what precedes it", () => {
		expect(
			polarityOf([
				adverb("ゆっくり", "助詞類接続"),
				ARUI,
				PARTICLE_TE,
				HELPER_I,
				AUX_NAI,
			]),
		).toBe("negative");
	});
});

describe("R2-P2: the published profile seam verifies more than a key", () => {
	const jikkuri = identityOf(adverb("じっくり", "一般"));

	it("refuses じっくり's key carrying すぐ's surface and class", () => {
		// `evaluateAdverbCandidate()` already refused this, but these two are
		// published seams for ADVERB-MANUAL1 and must refuse it themselves.
		const forged = {
			family: ADVERB_FAMILY,
			adverbClass: "助詞類接続",
			surface: "すぐ",
			identityKey: jikkuri.identityKey,
		} as const;
		expect(isToOptionalAdverb(forged)).toBe(false);
		expect(isToOptionalAdverb(jikkuri)).toBe(true);
	});

	it("refuses any single substituted field", () => {
		for (const patch of [
			{ surface: "すぐ" },
			{ adverbClass: "助詞類接続" as const },
			{ family: "irregular-adverb" as unknown as typeof ADVERB_FAMILY },
		]) {
			expect(isToOptionalAdverb({ ...jikkuri, ...patch })).toBe(false);
		}
	});

	it("resolves the capability seam against the index, not its argument", () => {
		const index = buildAdverbObservationIndex([
			{ tokens: [adverb("じっくり", "一般"), KANGAERU] },
		]);
		expect(
			adverbBridgeCapabilities({
				index,
				candidate: jikkuri,
				headClass: "verb-predicate",
				polarity: "nonnegative",
			}),
		).toEqual({ none: true, to: true });
		// A forged candidate gets no capabilities at all, rather than じっくり's.
		expect(
			adverbBridgeCapabilities({
				index,
				candidate: {
					family: ADVERB_FAMILY,
					adverbClass: "助詞類接続",
					surface: "すぐ",
					identityKey: jikkuri.identityKey,
				},
				headClass: "verb-predicate",
				polarity: "nonnegative",
			}),
		).toBeNull();
		// A context the candidate was never observed in gets no capability at
		// all. The profile must not grant a head class or a polarity that was
		// never seen; it extends the bridge dimension and nothing else.
		expect(
			adverbBridgeCapabilities({
				index,
				candidate: jikkuri,
				headClass: "adjective-predicate",
				polarity: "not-applicable",
			}),
		).toBeNull();
		expect(
			adverbBridgeCapabilities({
				index,
				candidate: jikkuri,
				headClass: "verb-predicate",
				polarity: "negative",
			}),
		).toBeNull();
	});
});

describe("P2-4: the published index and rule sets are immutable and canonical", () => {
	const runs = [
		{ tokens: [adverb("ゆっくり", "助詞類接続"), ARUKU] },
		{ tokens: [adverb("じっくり", "一般"), KANGAERU] },
		{ tokens: [adverb("そっと", "一般"), ARUKU] },
	];
	const keysOf = (index: { entries: readonly AdverbObservationEntry[] }) =>
		index.entries.map((entry) => entry.identity.identityKey);

	it("does not depend on the order the runs arrived in", () => {
		const forward = buildAdverbObservationIndex(runs);
		const reversed = buildAdverbObservationIndex([...runs].reverse());
		expect(keysOf(forward)).toEqual(keysOf(reversed));
		expect(keysOf(forward)).toEqual([...keysOf(forward)].sort());
		expect(forward.candidates.map((identity) => identity.identityKey)).toEqual(
			keysOf(forward),
		);
	});

	it("exposes no mutable collection", () => {
		const index = buildAdverbObservationIndex(runs);
		const before = keysOf(index);
		expect(Object.isFrozen(index)).toBe(true);
		expect(Object.isFrozen(index.entries)).toBe(true);
		expect(Object.isFrozen(index.candidates)).toBe(true);
		for (const entry of index.entries) {
			expect(Object.isFrozen(entry)).toBe(true);
			expect(Object.isFrozen(entry.profiles)).toBe(true);
			for (const profile of entry.profiles) {
				expect(Object.isFrozen(profile)).toBe(true);
			}
		}
		// The original published a plain Map, so `index.observations.clear()`
		// emptied a "frozen" index. There is no collection to clear now.
		expect(
			Object.values(index).some(
				(value) => value instanceof Map || value instanceof Set,
			),
		).toBe(false);
		expect(() => {
			(index.entries as AdverbObservationEntry[]).length = 0;
		}).toThrow();
		expect(() => {
			(index.candidates as unknown[]).pop();
		}).toThrow();
		expect(keysOf(index)).toEqual(before);
		expect(index.lookup(before[0]!)).not.toBeNull();
	});

	it("publishes the closed rule sets as frozen arrays", () => {
		// Exported `ReadonlySet`s were readonly at type level only: both
		// `clear()` and `add()` worked at runtime.
		for (const list of [
			ADVERB_STANDALONE_VERB_FORMS,
			ADVERB_NEGATIVE_AUXILIARY_SURFACES,
			ADVERB_COPULA_SURFACES,
		]) {
			expect(Array.isArray(list)).toBe(true);
			expect(Object.isFrozen(list)).toBe(true);
			expect(() => {
				(list as string[]).push("mutated");
			}).toThrow();
		}
		expect(ADVERB_NEGATIVE_AUXILIARY_SURFACES).toContain("ない");
		expect(ADVERB_COPULA_SURFACES).toContain("だ");
	});
});
