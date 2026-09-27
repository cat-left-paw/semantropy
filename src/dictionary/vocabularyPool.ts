import type { TokenSequences } from "../transform/transformTokens";
import {
	canonicalList,
	canonicalString,
	hashCanonical,
} from "./canonicalHash";
import {
	FAKE_DICTIONARY_PLACEHOLDERS,
	classifyPlaceholder,
	type FakeDictionaryPlaceholder,
} from "./placeholders";

/**
 * Candidate surfaces per placeholder, drawn from the Current Note.
 *
 * Separate from the body transform's `VocabularyPool`, which is keyed by a
 * `pos/detail1[/detail2]` string and exists to swap one noun for another. This
 * one is keyed by template placeholder and its keys are a closed set. The two
 * must not be conflated: they answer different questions and their key spaces
 * are not the same.
 *
 * Every placeholder is present, possibly with an empty list, so a caller never
 * has to distinguish "absent" from "no candidates".
 */
export type DictionaryVocabularyPool = Readonly<
	Record<FakeDictionaryPlaceholder, readonly string[]>
>;

/**
 * Builds the pool from the ready session's own token sequences.
 *
 * The input is the sequences produced from the source snapshot, never a
 * re-tokenization of the transformed DOM: candidates come from what the note
 * actually says, not from what the body transform made of it.
 *
 * Surfaces are deduplicated per placeholder and kept in first-appearance
 * order. That order is part of the contract even though the generator does not
 * depend on it — a caller listing a pool gets the note's own order, and the
 * generator sorts its own copy before drawing.
 *
 * Tokens, sequences and the returned pool are never modified.
 */
export function buildDictionaryVocabularyPool(
	tokenSequences: TokenSequences,
): DictionaryVocabularyPool {
	const surfaces = new Map<FakeDictionaryPlaceholder, string[]>();
	const seen = new Map<FakeDictionaryPlaceholder, Set<string>>();
	for (const placeholder of FAKE_DICTIONARY_PLACEHOLDERS) {
		surfaces.set(placeholder, []);
		seen.set(placeholder, new Set());
	}

	for (const sequence of tokenSequences) {
		for (const token of sequence) {
			const placeholder = classifyPlaceholder(token);
			if (placeholder === null) {
				continue;
			}
			const bucket = surfaces.get(placeholder);
			const known = seen.get(placeholder);
			if (!bucket || !known || known.has(token.surface)) {
				continue;
			}
			known.add(token.surface);
			bucket.push(token.surface);
		}
	}

	const pool = {} as Record<FakeDictionaryPlaceholder, readonly string[]>;
	for (const placeholder of FAKE_DICTIONARY_PLACEHOLDERS) {
		pool[placeholder] = Object.freeze([...(surfaces.get(placeholder) ?? [])]);
	}
	return Object.freeze(pool);
}

export function poolCandidates(
	pool: DictionaryVocabularyPool,
	placeholder: FakeDictionaryPlaceholder,
): readonly string[] {
	return pool[placeholder];
}

export function hasCandidates(
	pool: DictionaryVocabularyPool,
	placeholder: FakeDictionaryPlaceholder,
): boolean {
	return pool[placeholder].length > 0;
}

/**
 * A uint32 summarising which words the pool holds.
 *
 * Order-independent: placeholders are walked in their fixed declaration order
 * and each candidate list is sorted in a copy first, so the same set of words
 * fingerprints identically no matter what order the note's text nodes were
 * analysed in. That is what lets the same headword keep the same definition
 * when the DOM is rebuilt.
 *
 * The pool's own arrays are not sorted in place; the first-appearance contract
 * survives fingerprinting.
 */
function calculateFingerprint(
	pool: DictionaryVocabularyPool,
): number {
	const parts: string[] = [];
	for (const placeholder of FAKE_DICTIONARY_PLACEHOLDERS) {
		const sorted = [...pool[placeholder]].sort();
		parts.push(
			canonicalList([
				canonicalString(placeholder),
				canonicalList(sorted.map(canonicalString)),
			]),
		);
	}
	return hashCanonical(parts);
}

/** Immutable pools alone may be memoized; callers with mutable arrays retain value semantics. */
const preparedPools = new WeakMap<DictionaryVocabularyPool, { sorted: DictionaryVocabularyPool; fingerprint: number }>();
export function prepareDictionaryPool(pool: DictionaryVocabularyPool): { sorted: DictionaryVocabularyPool; fingerprint: number } {
 const prior = preparedPools.get(pool);
 if (prior) return prior;
 const sorted = Object.freeze(Object.fromEntries(FAKE_DICTIONARY_PLACEHOLDERS.map(key =>
  [key, Object.freeze([...pool[key]].sort())])) as Record<FakeDictionaryPlaceholder, readonly string[]>);
 const prepared = Object.freeze({ sorted, fingerprint: calculateFingerprint(pool) });
 if (Object.isFrozen(pool) && FAKE_DICTIONARY_PLACEHOLDERS.every(key => Object.isFrozen(pool[key]))) preparedPools.set(pool, prepared);
 return prepared;
}
export function fingerprintDictionaryVocabularyPool(pool: DictionaryVocabularyPool): number {
 return prepareDictionaryPool(pool).fingerprint;
}
