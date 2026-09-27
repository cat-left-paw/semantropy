import { freezeAnalysis } from "../analysis/rubyVocabulary";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { isToOptionalAdverb } from "./adverbBridgeProfile";
import {
	type AdverbCandidateIdentity,
	adverbSurfaceEndsWithTo,
} from "./adverbFamily";
import {
	type AdverbBridge,
	type AdverbHeadClass,
	type AdverbObservationIndex,
	type AdverbObservationProfile,
	type AdverbObservationRejection,
	type AdverbPolarity,
	observeAdverbSlot,
} from "./adverbObservation";

/**
 * `PRE-RELEASE-ADVERB-SPIKE1`: may this observed candidate stand in this
 * observed Target slot?
 *
 * The answer is assembled in a fixed order, and each step is a refusal rather
 * than a preference:
 *
 *   1. The Target slot is *observed*, never described. The caller hands over
 *      the Target's own analysis run and an index; head class, polarity and
 *      bridge come from `observeAdverbSlot()`. A caller cannot assert
 *      "this slot takes an external と" and be believed.
 *   2. The candidate identity is **resolved to the index's own canonical
 *      record**, and every field must agree. See below.
 *   3. Head class and polarity are hard equalities (policy §7). Only the
 *      candidate observations that match *both* survive; the bridge dimension
 *      is then built from those survivors alone, so a candidate observed with
 *      `と` before a negative verb gains nothing at a nonnegative Target.
 *   4. Bridge capability is the union of what those survivors observed and
 *      what the reviewed `to-optional` profile declares (policy §8.3). The
 *      profile grants both directions — that is what "optional" means — so a
 *      profiled candidate observed only without `と` still fits a Target that
 *      has one, and vice versa.
 *   5. The duplicate-`と` guard (policy §8.4) is applied last and is
 *      unconditional: a candidate surface that already ends in `と` is refused
 *      at a Target that has an external `と`, whatever the observations or the
 *      profile say. Source evidence cannot lift it.
 *
 * ## Why step 2 resolves rather than trusts
 *
 * An earlier revision looked observations up by `identityKey` and then used the
 * caller's own `surface` and `adverbClass` for the profile lookup and the
 * duplicate-`と` guard. Independent review found that the two halves were never
 * tied together, so a candidate that kept `じっくり`'s genuine key while
 * carrying `すぐ`'s surface and class was accepted and reached `to` through
 * `じっくり`'s profile entry:
 *
 *     { identityKey: "<じっくり's real key>", surface: "すぐ", adverbClass: "助詞類接続" }
 *
 * The key was never the problem — it is public and deterministic, so any
 * self-consistent identity is reproducible by anyone. The problem was that the
 * fields the decision actually read were not the fields the evidence was filed
 * under. So the index's own record is resolved first, the supplied identity
 * must agree with it field for field, and **every later step reads the resolved
 * record**, not the argument. A disagreement is `candidate-identity-mismatch`.
 *
 * The Target's own bridge token is never inserted, deleted or moved; only the
 * candidate surface would be exchanged, by a later slice. This slice performs
 * no draw, no selection and no replacement.
 */

export type AdverbBridgeCapabilities = {
	readonly none: boolean;
	readonly to: boolean;
};

export type AdverbCapabilityRejection =
	| "no-observation"
	| "candidate-identity-mismatch"
	| "head-class-mismatch"
	| "polarity-mismatch"
	| "bridge-not-capable"
	| "duplicate-to-bridge";

export type AdverbCandidateEvaluation =
	| {
			readonly usable: true;
			readonly candidate: AdverbCandidateIdentity;
			readonly targetProfile: AdverbObservationProfile;
			readonly bridge: AdverbBridge;
			readonly capabilities: AdverbBridgeCapabilities;
	  }
	| {
			readonly usable: false;
			readonly stage: "target";
			readonly reason: AdverbObservationRejection;
	  }
	| {
			readonly usable: false;
			readonly stage: "candidate";
			readonly reason: AdverbCapabilityRejection;
	  };

/**
 * Bridge capability for one candidate in one observed context.
 *
 * The profile extends this dimension and no other: it is consulted only after
 * the hard constraints have filtered the observations, so it can never
 * introduce a head class or a polarity that was never seen.
 *
 * Like `evaluateAdverbCandidate()`, this resolves the candidate against the
 * index rather than believing its argument, and it takes the head class and
 * polarity to filter by rather than a caller-assembled list of observations.
 * An earlier revision accepted both the identity and the already-filtered
 * `matching` profiles from the caller, which made this published seam
 * forgeable even after the top-level entry point had been corrected —
 * independent review found that. `null` means the index does not hold this
 * candidate, or holds a different record under its key.
 */
export function adverbBridgeCapabilities(input: {
	readonly index: AdverbObservationIndex;
	readonly candidate: AdverbCandidateIdentity;
	readonly headClass: AdverbHeadClass;
	readonly polarity: AdverbPolarity;
}): AdverbBridgeCapabilities | null {
	const entry =
		input.candidate !== null && typeof input.candidate === "object"
			? input.index.lookup(input.candidate.identityKey)
			: null;
	if (entry === null || !agrees(input.candidate, entry.identity)) {
		return null;
	}
	const matching = entry.profiles.filter(
		(profile) =>
			profile.headClass === input.headClass &&
			profile.polarity === input.polarity,
	);
	// No observation in this context means no capability in it. Returning the
	// profile's `to` here would let it grant a head class or a polarity that
	// was never observed, which policy §8.3 forbids — the profile extends the
	// bridge dimension and nothing else.
	return matching.length === 0 ? null : capabilitiesOf(entry.identity, matching);
}

/** The union itself, over a resolved record and its already-filtered profiles. */
function capabilitiesOf(
	identity: AdverbCandidateIdentity,
	matching: readonly AdverbObservationProfile[],
): AdverbBridgeCapabilities {
	const optional = isToOptionalAdverb(identity);
	return Object.freeze({
		none: optional || matching.some((profile) => profile.bridge === "none"),
		to: optional || matching.some((profile) => profile.bridge === "to"),
	});
}

/** Field-for-field agreement between a supplied identity and the index's own. */
function agrees(
	supplied: AdverbCandidateIdentity,
	canonical: AdverbCandidateIdentity,
): boolean {
	return (
		supplied.family === canonical.family &&
		supplied.adverbClass === canonical.adverbClass &&
		supplied.surface === canonical.surface &&
		supplied.identityKey === canonical.identityKey
	);
}

/**
 * Evaluates one candidate against one Target slot.
 *
 * `candidate` must agree with an identity the index holds. An identity the
 * index does not know yields `no-observation`; one whose key the index knows
 * but whose other fields disagree yields `candidate-identity-mismatch`.
 */
export function evaluateAdverbCandidate(input: {
	readonly index: AdverbObservationIndex;
	readonly targetTokens: readonly JapaneseToken[];
	readonly targetIndex: number;
	readonly targetBarriers?: readonly number[];
	readonly candidate: AdverbCandidateIdentity;
}): AdverbCandidateEvaluation {
	const observed = observeAdverbSlot({
		tokens: input.targetTokens,
		index: input.targetIndex,
		...(input.targetBarriers === undefined
			? {}
			: { barriers: input.targetBarriers }),
	});
	if (!observed.supported) {
		return freezeAnalysis({
			usable: false,
			stage: "target",
			reason: observed.reason,
		});
	}
	const targetProfile = observed.observation.profile;

	const entry =
		input.candidate !== null && typeof input.candidate === "object"
			? input.index.lookup(input.candidate.identityKey)
			: null;
	if (entry === null || entry.profiles.length === 0) {
		return freezeAnalysis({
			usable: false,
			stage: "candidate",
			reason: "no-observation",
		});
	}
	if (!agrees(input.candidate, entry.identity)) {
		return freezeAnalysis({
			usable: false,
			stage: "candidate",
			reason: "candidate-identity-mismatch",
		});
	}
	// From here on the argument is not read again: only the resolved record is.
	const candidate = entry.identity;

	const sameHead = entry.profiles.filter(
		(profile) => profile.headClass === targetProfile.headClass,
	);
	if (sameHead.length === 0) {
		return freezeAnalysis({
			usable: false,
			stage: "candidate",
			reason: "head-class-mismatch",
		});
	}
	const matching = sameHead.filter(
		(profile) => profile.polarity === targetProfile.polarity,
	);
	if (matching.length === 0) {
		return freezeAnalysis({
			usable: false,
			stage: "candidate",
			reason: "polarity-mismatch",
		});
	}

	const capabilities = capabilitiesOf(candidate, matching);

	// The guard comes before the capability answer for a `to` Target, so a
	// profiled or observed `to` capability can never place `そっと` in front of
	// an external `と`.
	if (
		targetProfile.bridge === "to" &&
		adverbSurfaceEndsWithTo(candidate.surface)
	) {
		return freezeAnalysis({
			usable: false,
			stage: "candidate",
			reason: "duplicate-to-bridge",
		});
	}
	if (!capabilities[targetProfile.bridge]) {
		return freezeAnalysis({
			usable: false,
			stage: "candidate",
			reason: "bridge-not-capable",
		});
	}

	return freezeAnalysis({
		usable: true,
		candidate,
		targetProfile,
		bridge: targetProfile.bridge,
		capabilities,
	});
}
