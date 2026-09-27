import {
	SEMANTROPY_ALGORITHM_VERSION,
	createSeededRandom,
} from "../random/seededRandom";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { isSlotApplied } from "./slotScore";
import {
	isEligibleReplacementToken,
	vocabularyPoolKey,
} from "./tokenPolicy";

export type TokenSequences = readonly (readonly JapaneseToken[])[];
export type VocabularyPool = ReadonlyMap<string, readonly string[]>;

/** Provenance of a chosen replacement, including its exact UTF-16 spelling. */
export type SelectedVocabularyCandidate = {
	candidateId: string;
	displayFormId: string;
	surface: string;
};

export type TransformResult = {
	texts: string[];
	/** Optional logical-token output used by the Ruby-aware renderer. */
	tokenSurfaces?: readonly (readonly string[])[];
	/** Null for unchanged slots. Resolved after, never during, the surface draw. */
	candidateSelections?: readonly (readonly (SelectedVocabularyCandidate | null)[])[];
	displaySeed?: number;
	/** Slots actually exchanged at this Semantropy value. */
	replacementCount: number;
	/**
	 * Slots that have a candidate to exchange with, independent of the
	 * Semantropy value. This is what separates "nothing to work with" from
	 * "the value chose not to apply anything".
	 */
	replaceableSlotCount: number;
	bodySemantropy: BodySemantropy;
	algorithmVersion: number;
};

export function buildVocabularyPool(
	tokenSequences: TokenSequences,
): VocabularyPool {
	const surfacesByKey = new Map<string, string[]>();
	const seenByKey = new Map<string, Set<string>>();

	for (const sequence of tokenSequences) {
		for (const token of sequence) {
			if (!isEligibleReplacementToken(token)) {
				continue;
			}
			const key = vocabularyPoolKey(token);
			let surfaces = surfacesByKey.get(key);
			let seen = seenByKey.get(key);
			if (!surfaces || !seen) {
				surfaces = [];
				seen = new Set();
				surfacesByKey.set(key, surfaces);
				seenByKey.set(key, seen);
			}
			if (!seen.has(token.surface)) {
				seen.add(token.surface);
				surfaces.push(token.surface);
			}
		}
	}

	const pool = new Map<string, readonly string[]>();
	for (const [key, surfaces] of surfacesByKey) {
		pool.set(key, Object.freeze([...surfaces]));
	}
	return pool;
}

/**
 * The surfaces this token could be exchanged with, or null when the slot is
 * not replaceable at all: ineligible, no pool entry, or no candidate other
 * than the token's own surface.
 *
 * Pool surfaces are deduplicated, so two or more entries always leave at least
 * one alternative.
 */
export function replaceableChoices(
	token: JapaneseToken,
	pool: VocabularyPool,
): readonly string[] | null {
	if (!isEligibleReplacementToken(token)) {
		return null;
	}
	const candidates = pool.get(vocabularyPoolKey(token));
	if (!candidates || candidates.length < 2) {
		return null;
	}
	const alternatives = candidates.filter(
		(surface) => surface !== token.surface,
	);
	return alternatives.length > 0 ? alternatives : null;
}

/**
 * Transforms every logical analysis run's tokens at one Semantropy value.
 *
 * The candidate for a replaceable slot is drawn first, for every replaceable
 * slot, whether or not it will be used. That keeps the Mulberry32 sequence
 * identical across Semantropy values: a slot the value skips does not shift
 * the draw for any later slot, so a slot chosen at two values gets the same
 * replacement at both.
 *
 * Inputs are read only; tokens, sequences and the pool are never mutated.
 */
export function transformTokenSequences(
	tokenSequences: TokenSequences,
	pool: VocabularyPool,
	bodySeed: number,
	bodySemantropy: BodySemantropy,
	collectTokenSurfaces = false,
): TransformResult {
	const random = createSeededRandom(bodySeed);
	const texts: string[] = [];
	const tokenSurfaces: string[][] = [];
	let replacementCount = 0;
	let replaceableSlotCount = 0;

	for (
		let sequenceIndex = 0;
		sequenceIndex < tokenSequences.length;
		sequenceIndex += 1
	) {
		const sequence = tokenSequences[sequenceIndex] ?? [];
		const surfaces: string[] = [];
		let text = "";
		for (let tokenIndex = 0; tokenIndex < sequence.length; tokenIndex += 1) {
			const token = sequence[tokenIndex];
			if (!token) {
				continue;
			}
			const choices = replaceableChoices(token, pool);
			if (!choices) {
				text += token.surface;
				surfaces.push(token.surface);
				continue;
			}

			replaceableSlotCount += 1;
			// Drawn unconditionally: the draw order must not depend on the value.
			const chosen =
				choices[Math.floor(random.next() * choices.length)] ?? token.surface;
			const applied = isSlotApplied(
				bodySeed,
				{ sequenceIndex, tokenIndex },
				bodySemantropy,
			);
			const surface = applied ? chosen : token.surface;
			if (surface !== token.surface) {
				replacementCount += 1;
			}
			text += surface;
			surfaces.push(surface);
		}
		texts.push(text);
		tokenSurfaces.push(surfaces);
	}

	return {
		...(collectTokenSurfaces ? { tokenSurfaces } : {}),
		texts,
		replacementCount,
		replaceableSlotCount,
		bodySemantropy,
		algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
	};
}
