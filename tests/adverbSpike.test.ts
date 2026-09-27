import { describe, expect, it } from "vitest";
import { vocabularyCandidateId } from "../src/analysis/rubyVocabulary";
import {
	adverbBridgeCapabilities,
	evaluateAdverbCandidate,
} from "../src/adverb/adverbCapability";
import {
	ADVERB_FAMILY,
	adverbProfileIdentityKey,
	adverbSurfaceEndsWithTo,
	classifyAdverbCandidate,
} from "../src/adverb/adverbFamily";
import {
	ADVERB_TAIL_SCAN_LIMIT,
	buildAdverbObservationIndex,
	observeAdverbSlot,
} from "../src/adverb/adverbObservation";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";

/**
 * `PRE-RELEASE-ADVERB-SPIKE1` pure core.
 *
 * The token shapes here are the ones the shipped compact dictionary actually
 * produces — `tests/distribution/adverbSpike.test.ts` re-derives every sentence
 * below from the real tokenizer and the real bytes, so this suite can stay fast
 * while still describing real morphology rather than an invented one.
 *
 * Synthetic tokens are used for exactly one thing the real tokenizer will not
 * hand over on demand: two candidates that differ only in `detail1`. 33 adverb
 * surfaces carry entries in both `副詞` classes, but Lindera picks one of them
 * by cost, so the *existence* of the pair is pinned against the dictionary in
 * the distribution suite and the *isolation* of their evidence is pinned here.
 */

const UNSET = "*";

/** A `副詞` token exactly as compaction leaves it: slots 0-1 and nothing else. */
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

function plain(surface: string, pos: string, detail1: string, detail2 = UNSET): JapaneseToken {
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

function iAdjective(surface: string, baseForm: string): JapaneseToken {
	return {
		surface,
		pos: "形容詞",
		detail1: "自立",
		detail2: UNSET,
		detail3: UNSET,
		conjugationType: "形容詞・イ段",
		conjugationForm: "基本形",
		baseForm,
		isUnknown: false,
	};
}

function unknown(surface: string): JapaneseToken {
	return {
		surface,
		pos: UNSET,
		detail1: UNSET,
		detail2: UNSET,
		detail3: UNSET,
		conjugationType: UNSET,
		conjugationForm: UNSET,
		baseForm: UNSET,
		isUnknown: true,
	};
}

const BRIDGE = plain("と", "助詞", "副詞化");
const QUOTATIVE = plain("と", "助詞", "格助詞", "引用");
const PERIOD = plain("。", "記号", "句点");
const COMMA = plain("、", "記号", "読点");
const AUX_NAI = plain("ない", "助動詞", UNSET);
const AUX_MASE = plain("ませ", "助動詞", UNSET);
const AUX_N = plain("ん", "助動詞", UNSET);
const AUX_TA = plain("た", "助動詞", UNSET);
const AUX_DA = plain("だ", "助動詞", UNSET);
const PARTICLE_TE = plain("て", "助詞", "接続助詞");
const PARTICLE_BA = plain("ば", "助詞", "接続助詞");
const ARUKU = verb("歩く", "基本形", "歩く");
const ARUKA = verb("歩か", "未然形", "歩く");

function profileOf(tokens: readonly JapaneseToken[], index = 0) {
	const result = observeAdverbSlot({ tokens, index });
	if (!result.supported) {
		throw new Error(`expected an observation, got ${result.reason}`);
	}
	return result.observation.profile;
}

function reasonOf(
	tokens: readonly JapaneseToken[],
	index = 0,
	barriers?: readonly number[],
) {
	const result = observeAdverbSlot({
		tokens,
		index,
		...(barriers === undefined ? {} : { barriers }),
	});
	if (result.supported) {
		throw new Error(
			`expected a rejection, got ${JSON.stringify(result.observation.profile)}`,
		);
	}
	return result.reason;
}

describe("the regular-adverb family", () => {
	it("unites both 副詞 classes the shipped dictionary has", () => {
		for (const detail1 of ["一般", "助詞類接続"] as const) {
			const result = classifyAdverbCandidate(adverb("ゆっくり", detail1));
			expect(result.supported).toBe(true);
			if (result.supported) {
				expect(result.identity.family).toBe(ADVERB_FAMILY);
				expect(result.identity.adverbClass).toBe(detail1);
			}
		}
	});

	it("refuses every other token fail-closed, with a fixed reason", () => {
		expect(classifyAdverbCandidate(unknown("\n"))).toEqual({
			supported: false,
			reason: "unknown-token",
		});
		// 名詞 / 副詞可能 is never promoted (policy §6).
		expect(classifyAdverbCandidate(plain("時間", "名詞", "副詞可能"))).toEqual({
			supported: false,
			reason: "unsupported-part-of-speech",
		});
		expect(classifyAdverbCandidate(plain("もし", "副詞", "その他"))).toEqual({
			supported: false,
			reason: "unsupported-adverb-class",
		});
		expect(classifyAdverbCandidate(adverb(UNSET, "一般"))).toEqual({
			supported: false,
			reason: "missing-surface",
		});
	});

	it("uses the Snapshot's own candidate identity, not a surface", () => {
		const token = adverb("ゆっくり", "助詞類接続");
		const result = classifyAdverbCandidate(token);
		expect(result.supported).toBe(true);
		if (result.supported) {
			// Shared with the Vocabulary Snapshot so ADVERB-MANUAL1 can bind
			// observations to records without a second notion of identity.
			expect(result.identity.identityKey).toBe(vocabularyCandidateId(token));
			expect(result.identity.identityKey).toBe(
				adverbProfileIdentityKey("ゆっくり", "助詞類接続"),
			);
		}
	});

	it("gives one surface two identities when the classes differ", () => {
		const general = classifyAdverbCandidate(adverb("ちょっと", "一般"));
		const connective = classifyAdverbCandidate(
			adverb("ちょっと", "助詞類接続"),
		);
		expect(general.supported && connective.supported).toBe(true);
		if (general.supported && connective.supported) {
			expect(general.identity.identityKey).not.toBe(
				connective.identity.identityKey,
			);
		}
	});

	it("tests the final と literally and nothing more", () => {
		expect(adverbSurfaceEndsWithTo("そっと")).toBe(true);
		expect(adverbSurfaceEndsWithTo("意外と")).toBe(true);
		expect(adverbSurfaceEndsWithTo("延々と")).toBe(true);
		expect(adverbSurfaceEndsWithTo("ゆっくり")).toBe(false);
		expect(adverbSurfaceEndsWithTo("とても")).toBe(false);
	});
});

describe("bounded head and bridge observation", () => {
	it("reads an external と only as 助詞 / 副詞化 / と", () => {
		expect(profileOf([adverb("ゆっくり", "助詞類接続"), BRIDGE, ARUKU])).toEqual({
			headClass: "verb-predicate",
			polarity: "nonnegative",
			bridge: "to",
			profileKey: JSON.stringify(["verb-predicate", "nonnegative", "to"]),
		});
		expect(profileOf([adverb("ゆっくり", "助詞類接続"), ARUKU]).bridge).toBe(
			"none",
		);
		// `そっと` carries its と inside the surface: bridge is none.
		expect(profileOf([adverb("そっと", "一般"), ARUKU]).bridge).toBe("none");
	});

	it("refuses a quotative と instead of treating it as a bridge", () => {
		// `ゆっくりと言った` is 助詞 / 格助詞 / 引用, so the head search lands on
		// a particle and stops rather than skipping to 言っ.
		expect(
			reasonOf([adverb("ゆっくり", "助詞類接続"), QUOTATIVE, verb("言っ", "連用タ接続", "言う", "五段・ワ行促音便"), AUX_TA]),
		).toBe("unsupported-head");
	});

	it("distinguishes the three head classes", () => {
		expect(profileOf([adverb("ゆっくり", "助詞類接続"), ARUKU]).headClass).toBe(
			"verb-predicate",
		);
		expect(
			profileOf([adverb("意外と", "一般"), iAdjective("難しい", "難しい")]),
		).toEqual({
			headClass: "adjective-predicate",
			polarity: "not-applicable",
			bridge: "none",
			profileKey: JSON.stringify([
				"adjective-predicate",
				"not-applicable",
				"none",
			]),
		});
		expect(
			profileOf([
				adverb("ゆっくり", "助詞類接続"),
				plain("静か", "名詞", "形容動詞語幹"),
				AUX_DA,
			]).headClass,
		).toBe("adjective-predicate");
		expect(
			profileOf([adverb("もちろん", "一般"), COMMA, plain("彼", "名詞", "代名詞")]),
		).toEqual({
			headClass: "sentence-modifier",
			polarity: "not-applicable",
			bridge: "none",
			profileKey: JSON.stringify([
				"sentence-modifier",
				"not-applicable",
				"none",
			]),
		});
	});

	it("refuses a 形容動詞語幹 that is not followed by a copula", () => {
		// `ゆっくりと丁寧に歩く`: 丁寧 is adverbialized by 助詞 / 副詞化 に, so
		// the real head is elsewhere and this slice does not guess which.
		expect(
			reasonOf([
				adverb("ゆっくり", "助詞類接続"),
				BRIDGE,
				plain("丁寧", "名詞", "形容動詞語幹"),
				plain("に", "助詞", "副詞化"),
				ARUKU,
			]),
		).toBe("unsupported-head");
	});

	it("refuses rather than searching past an unsupported head", () => {
		expect(reasonOf([adverb("ゆっくり", "助詞類接続")])).toBe("no-head");
		expect(reasonOf([adverb("ゆっくり", "助詞類接続"), BRIDGE])).toBe("no-head");
		expect(reasonOf([adverb("ゆっくり", "助詞類接続"), plain("人", "名詞", "一般")])).toBe(
			"unsupported-head",
		);
		expect(reasonOf([adverb("ゆっくり", "助詞類接続"), unknown("\n"), ARUKU])).toBe(
			"unsupported-head",
		);
		expect(reasonOf([adverb("ゆっくり", "助詞類接続"), PERIOD])).toBe(
			"unsupported-head",
		);
	});

	it("never crosses a caller barrier", () => {
		const tokens = [adverb("ゆっくり", "助詞類接続"), BRIDGE, ARUKU, AUX_NAI];
		// A barrier on the bridge hides it; the head search then cannot reach
		// past the same barrier either, so nothing is observed at all.
		expect(reasonOf(tokens, 0, [1])).toBe("boundary-crossed");
		// A barrier on the head itself.
		expect(reasonOf(tokens, 0, [2])).toBe("boundary-crossed");
		// A barrier inside the tail must not be read as "nothing follows".
		expect(reasonOf(tokens, 0, [3])).toBe("boundary-crossed");
	});
});

describe("verb polarity", () => {
	it("reads the closed negative auxiliaries", () => {
		expect(
			profileOf([adverb("決して", "一般"), verb("行か", "未然形", "行く", "五段・カ行促音便"), AUX_NAI])
				.polarity,
		).toBe("negative");
		expect(
			profileOf([
				adverb("決して", "一般"),
				verb("行き", "連用形", "行く", "五段・カ行促音便"),
				AUX_MASE,
				AUX_N,
			]).polarity,
		).toBe("negative");
		expect(
			profileOf([adverb("ゆっくり", "助詞類接続"), ARUKA, plain("なかっ", "助動詞", UNSET), AUX_TA])
				.polarity,
		).toBe("negative");
	});

	it("reads an affirmative predicate only from a real terminator", () => {
		expect(profileOf([adverb("決して", "一般"), ARUKU]).polarity).toBe(
			"nonnegative",
		);
		expect(profileOf([adverb("ゆっくり", "助詞類接続"), ARUKU, PERIOD]).polarity).toBe(
			"nonnegative",
		);
		// A content word ends the predicate's tail: 歩く is still affirmative.
		expect(
			profileOf([adverb("ゆっくり", "助詞類接続"), ARUKU, plain("人", "名詞", "一般")])
				.polarity,
		).toBe("nonnegative");
		// Helper chains are crossed, not stopped at. The 句点 matters: a helper
		// verb carries no conjugation fields at all in the shipped dictionary,
		// so at a bare run end the predicate is undetermined instead — see
		// `tests/adverbReviewRegressions.test.ts`.
		expect(
			profileOf([
				adverb("ゆっくり", "助詞類接続"),
				verb("歩い", "連用タ接続", "歩く"),
				PARTICLE_TE,
				plain("おく", "動詞", "非自立"),
				PERIOD,
			]).polarity,
		).toBe("nonnegative");
		expect(
			profileOf([
				adverb("ゆっくり", "助詞類接続"),
				verb("歩い", "連用タ接続", "歩く"),
				PARTICLE_TE,
				plain("い", "動詞", "非自立"),
				AUX_NAI,
			]).polarity,
		).toBe("negative");
	});

	it("never falls back to nonnegative for an undefined structure", () => {
		// 歩くのではない: the clause negation is a 形容詞 past a 名詞 / 非自立.
		expect(
			reasonOf([
				adverb("ゆっくり", "助詞類接続"),
				ARUKU,
				plain("の", "名詞", "非自立", "一般"),
				plain("で", "助動詞", UNSET),
				plain("は", "助詞", "係助詞"),
				iAdjective("ない", "ない"),
			]),
		).toBe("polarity-undetermined");
		// 歩かなければ…: the front half of an obligation, not a negation.
		expect(
			reasonOf([adverb("ゆっくり", "助詞類接続"), ARUKA, plain("なけれ", "助動詞", UNSET), PARTICLE_BA]),
		).toBe("polarity-undetermined");
		// A bound form with nothing after it is truncated text.
		expect(reasonOf([adverb("ゆっくり", "助詞類接続"), ARUKA])).toBe(
			"polarity-undetermined",
		);
		expect(reasonOf([adverb("ゆっくり", "助詞類接続"), ARUKA, PERIOD])).toBe(
			"polarity-undetermined",
		);
		// An unknown token — including a restored whitespace gap — is opaque.
		expect(reasonOf([adverb("ゆっくり", "助詞類接続"), ARUKU, unknown(" ")])).toBe(
			"polarity-undetermined",
		);
	});

	it("stops at the scan limit instead of walking on", () => {
		const tail = Array.from({ length: ADVERB_TAIL_SCAN_LIMIT + 1 }, () => AUX_TA);
		expect(reasonOf([adverb("ゆっくり", "助詞類接続"), ARUKU, ...tail])).toBe(
			"scan-limit-reached",
		);
		const short = Array.from({ length: ADVERB_TAIL_SCAN_LIMIT }, () => AUX_TA);
		expect(
			profileOf([adverb("ゆっくり", "助詞類接続"), ARUKU, ...short]).polarity,
		).toBe("nonnegative");
	});

	it("leaves a non-verb head explicitly not-applicable", () => {
		expect(
			profileOf([adverb("意外と", "一般"), iAdjective("難しい", "難しい")]).polarity,
		).toBe("not-applicable");
		expect(
			profileOf([
				adverb("ゆっくり", "助詞類接続"),
				plain("静か", "名詞", "形容動詞語幹"),
				AUX_DA,
			]).polarity,
		).toBe("not-applicable");
		expect(
			profileOf([adverb("もちろん", "一般"), COMMA, plain("彼", "名詞", "代名詞")])
				.polarity,
		).toBe("not-applicable");
	});
});

describe("the observation index", () => {
	it("keeps two identities of one surface apart", () => {
		const index = buildAdverbObservationIndex([
			{ tokens: [adverb("ちょっと", "助詞類接続"), BRIDGE, ARUKU] },
			{ tokens: [adverb("ちょっと", "一般"), ARUKU] },
		]);
		const connective = adverbProfileIdentityKey("ちょっと", "助詞類接続");
		const general = adverbProfileIdentityKey("ちょっと", "一般");
		expect(
			index.lookup(connective)?.profiles.map((profile) => profile.bridge),
		).toEqual(["to"]);
		expect(
			index.lookup(general)?.profiles.map((profile) => profile.bridge),
		).toEqual(["none"]);
	});

	it("records nothing for a rejected occurrence", () => {
		const index = buildAdverbObservationIndex([
			{ tokens: [adverb("ゆっくり", "助詞類接続"), plain("人", "名詞", "一般")] },
		]);
		expect(index.candidates).toEqual([]);
		expect(index.entries).toEqual([]);
		expect(index.lookup(adverbProfileIdentityKey("ゆっくり", "助詞類接続"))).toBe(
			null,
		);
	});
});

describe("the capability matrix", () => {
	const YUKKURI = adverb("ゆっくり", "助詞類接続");
	const JIKKURI = adverb("じっくり", "一般");
	const SUGU = adverb("すぐ", "助詞類接続");
	const SOTTO = adverb("そっと", "一般");
	const IGAITO = adverb("意外と", "一般");

	function identity(token: JapaneseToken) {
		const result = classifyAdverbCandidate(token);
		if (!result.supported) {
			throw new Error("expected a family member");
		}
		return result.identity;
	}

	/** Every candidate below is observed in exactly the stated contexts. */
	const index = buildAdverbObservationIndex([
		// じっくり, observed only without a bridge, before an affirmative verb.
		{ tokens: [JIKKURI, verb("考える", "基本形", "考える", "一段")] },
		// すぐ, observed only without a bridge.
		{ tokens: [SUGU, ARUKU] },
		// そっと and 意外と, observed only without a bridge.
		{ tokens: [SOTTO, ARUKU] },
		{ tokens: [IGAITO, iAdjective("難しい", "難しい")] },
		// 決して, observed only before a negative verb.
		{ tokens: [adverb("決して", "一般"), verb("行か", "未然形", "行く", "五段・カ行促音便"), AUX_NAI] },
	]);

	const toTarget = [YUKKURI, BRIDGE, ARUKU] as const;
	const noneTarget = [YUKKURI, ARUKU] as const;

	function evaluate(
		target: readonly JapaneseToken[],
		candidate: JapaneseToken,
		observations = index,
	) {
		return evaluateAdverbCandidate({
			index: observations,
			targetTokens: target,
			targetIndex: 0,
			candidate: identity(candidate),
		});
	}

	it("lets the profile carry じっくり onto a と Target it never observed", () => {
		const result = evaluate(toTarget, JIKKURI);
		expect(result).toMatchObject({
			usable: true,
			bridge: "to",
			capabilities: { none: true, to: true },
		});
	});

	it("lets the profile carry a と-observed じっくり onto a bridgeless Target", () => {
		const observed = buildAdverbObservationIndex([
			{ tokens: [JIKKURI, BRIDGE, verb("考える", "基本形", "考える", "一段")] },
		]);
		expect(evaluate(noneTarget, JIKKURI, observed)).toMatchObject({
			usable: true,
			bridge: "none",
			capabilities: { none: true, to: true },
		});
	});

	it("keeps すぐ to the bridge it was observed with", () => {
		expect(evaluate(noneTarget, SUGU)).toMatchObject({
			usable: true,
			bridge: "none",
			capabilities: { none: true, to: false },
		});
		expect(evaluate(toTarget, SUGU)).toEqual({
			usable: false,
			stage: "candidate",
			reason: "bridge-not-capable",
		});
	});

	it("lets a Source observation alone make すぐ to-capable", () => {
		// The structural evidence a later slice would need — no profile entry,
		// no guess, just the same candidate identity seen with an external と.
		const observed = buildAdverbObservationIndex([
			{ tokens: [SUGU, ARUKU] },
			{ tokens: [SUGU, BRIDGE, ARUKU] },
		]);
		expect(evaluate(toTarget, SUGU, observed)).toMatchObject({
			usable: true,
			bridge: "to",
			capabilities: { none: true, to: true },
		});
	});

	it("refuses a と-final candidate in front of an external と", () => {
		for (const candidate of [SOTTO, IGAITO]) {
			expect(evaluate(toTarget, candidate)).toMatchObject({
				usable: false,
				stage: "candidate",
			});
		}
		// 意外と's head class differs; そっと reaches the guard itself.
		expect(evaluate(toTarget, SOTTO)).toEqual({
			usable: false,
			stage: "candidate",
			reason: "duplicate-to-bridge",
		});
	});

	it("never lets an observation lift the duplicate-と guard", () => {
		const observed = buildAdverbObservationIndex([
			{ tokens: [SOTTO, ARUKU] },
			// そっと genuinely observed before an external と.
			{ tokens: [SOTTO, BRIDGE, ARUKU] },
		]);
		expect(
			adverbBridgeCapabilities({
				index: observed,
				candidate: identity(SOTTO),
				headClass: "verb-predicate",
				polarity: "nonnegative",
			}),
		).toEqual({ none: true, to: true });
		expect(evaluate(toTarget, SOTTO, observed)).toEqual({
			usable: false,
			stage: "candidate",
			reason: "duplicate-to-bridge",
		});
	});

	it("refuses a head class mismatch", () => {
		expect(evaluate(noneTarget, IGAITO)).toEqual({
			usable: false,
			stage: "candidate",
			reason: "head-class-mismatch",
		});
	});

	it("refuses a polarity mismatch in both directions", () => {
		const KESSHITE = adverb("決して", "一般");
		expect(evaluate(noneTarget, KESSHITE)).toEqual({
			usable: false,
			stage: "candidate",
			reason: "polarity-mismatch",
		});
		const negativeTarget = [
			YUKKURI,
			verb("行か", "未然形", "行く", "五段・カ行促音便"),
			AUX_NAI,
		] as const;
		expect(evaluate(negativeTarget, KESSHITE)).toMatchObject({ usable: true });
		// じっくり was only observed before an affirmative verb.
		expect(evaluate(negativeTarget, JIKKURI)).toEqual({
			usable: false,
			stage: "candidate",
			reason: "polarity-mismatch",
		});
	});

	it("builds the bridge dimension only from observations that already match", () => {
		// すぐ before a negative verb with と, and before an affirmative one
		// without. The affirmative Target must not inherit the negative
		// context's `to`.
		const observed = buildAdverbObservationIndex([
			{ tokens: [SUGU, ARUKU] },
			{
				tokens: [
					SUGU,
					BRIDGE,
					verb("行か", "未然形", "行く", "五段・カ行促音便"),
					AUX_NAI,
				],
			},
		]);
		expect(evaluate(toTarget, SUGU, observed)).toEqual({
			usable: false,
			stage: "candidate",
			reason: "bridge-not-capable",
		});
	});

	it("refuses an identity the index never saw", () => {
		expect(evaluate(noneTarget, adverb("やがて", "一般"))).toEqual({
			usable: false,
			stage: "candidate",
			reason: "no-observation",
		});
		// Same surface, other class: evidence is not shared.
		const connective = buildAdverbObservationIndex([
			{ tokens: [adverb("ちょっと", "助詞類接続"), ARUKU] },
		]);
		expect(evaluate(noneTarget, adverb("ちょっと", "一般"), connective)).toEqual({
			usable: false,
			stage: "candidate",
			reason: "no-observation",
		});
	});

	it("reports an unobservable Target as a Target-stage refusal", () => {
		expect(
			evaluateAdverbCandidate({
				index,
				targetTokens: [YUKKURI, plain("人", "名詞", "一般")],
				targetIndex: 0,
				candidate: identity(JIKKURI),
			}),
		).toEqual({ usable: false, stage: "target", reason: "unsupported-head" });
		expect(
			evaluateAdverbCandidate({
				index,
				targetTokens: [YUKKURI, ARUKU],
				targetIndex: 1,
				candidate: identity(JIKKURI),
			}),
		).toEqual({
			usable: false,
			stage: "target",
			reason: "unsupported-part-of-speech",
		});
	});
});
