import {
	adverbSurfaceEndsWithTo,
	classifyAdverbCandidate,
	type AdverbCandidateIdentity,
} from "../../../src/adverb/adverbFamily";
import {
	buildAdverbObservationIndex,
	observeAdverbSlot,
	type AdverbObservationIndex,
} from "../../../src/adverb/adverbObservation";
import { evaluateAdverbCandidate } from "../../../src/adverb/adverbCapability";
import type { JapaneseToken } from "../../../src/tokenizer/JapaneseTokenizer";

/**
 * The adverb half of the SPIKE1 profile question, as a model over the existing
 * `PRE-RELEASE-ADVERB-SPIKE1` authority. Test support only.
 *
 * Policy 1 §4.4 relaxes adverbs by *dropping requirements*, not by adding a
 * new source of candidates, so this module adds no morphology and no
 * observation of its own. strict is `evaluateAdverbCandidate()` itself — the
 * production function, unchanged — and High and MAX are that same evaluation
 * with named constraints removed, so a strict behaviour change moves all three
 * columns together instead of leaving the model asserting a stale contract.
 *
 * Two things never relax, at any level:
 *
 *   - The **Target bridge is retained**. Only the candidate surface is
 *     replaced; the external `と` token is not added, removed or rewritten by
 *     any profile, and every level reads the Target's own observed bridge.
 *   - The **duplicate-`と` guard** is applied last and unconditionally, so a
 *     candidate whose own surface ends in `と` never stands in front of an
 *     external `と`. ADVERB-SPIKE1 established that `意外とと` and `ちょっとと`
 *     are reachable, which is what makes the guard load-bearing rather than
 *     defensive.
 *
 * The production adverb path is not changed by this slice.
 */

export type AdverbProfileLevel = "strict" | "high" | "max";

export type AdverbSlotResult =
	| { readonly usable: true; readonly surface: string }
	| { readonly usable: false; readonly reason: string };

/**
 * Whether `candidate` may fill the adverb slot at `targetIndex`, under `level`.
 *
 * strict delegates entirely. High keeps the `regular-adverb` family and the
 * requirement that the candidate was observed at all, and drops head class,
 * polarity and bridge capability. MAX keeps only "this is a safe independent
 * adverb of the family" — no observation, no head, no polarity, no bridge
 * capability. Both still refuse a Target position that is not an adverb slot,
 * because the Target's own requirement is not a candidate constraint.
 */
export function evaluateAdverbAtLevel(input: {
	readonly level: AdverbProfileLevel;
	readonly index: AdverbObservationIndex;
	readonly targetTokens: readonly JapaneseToken[];
	readonly targetIndex: number;
	readonly candidateToken: JapaneseToken;
}): AdverbSlotResult {
	const family = classifyAdverbCandidate(input.candidateToken);
	if (!family.supported) {
		return { usable: false, reason: family.reason };
	}
	const candidate: AdverbCandidateIdentity = family.identity;

	if (input.level === "strict") {
		const result = evaluateAdverbCandidate({
			index: input.index,
			targetTokens: input.targetTokens,
			targetIndex: input.targetIndex,
			candidate,
		});
		return result.usable
			? { usable: true, surface: result.candidate.surface }
			: { usable: false, reason: result.reason };
	}

	// The Target requirement is read the same way at every level, from the
	// same observation function, and nothing past the Target's own head or
	// comma is consulted.
	const observed = observeAdverbSlot({
		tokens: input.targetTokens,
		index: input.targetIndex,
	});
	if (!observed.supported) {
		return { usable: false, reason: observed.reason };
	}
	const targetProfile = observed.observation.profile;

	if (input.level === "high") {
		// The family is kept, and so is the requirement that this candidate was
		// genuinely observed somewhere in the authenticated Sources — High
		// relaxes *which* context it was observed in, not whether it exists.
		const entry = input.index.lookup(candidate.identityKey);
		if (entry === null || entry.profiles.length === 0) {
			return { usable: false, reason: "no-observation" };
		}
		if (entry.identity.surface !== candidate.surface || entry.identity.adverbClass !== candidate.adverbClass) {
			return { usable: false, reason: "candidate-identity-mismatch" };
		}
	}

	// Applied last and unconditionally, exactly as strict applies it.
	if (targetProfile.bridge === "to" && adverbSurfaceEndsWithTo(candidate.surface)) {
		return { usable: false, reason: "duplicate-to-bridge" };
	}
	return { usable: true, surface: candidate.surface };
}

export { buildAdverbObservationIndex };
