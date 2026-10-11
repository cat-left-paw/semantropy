import type { TokenSequences } from "../transform/transformTokens";
import {
	canonicalList,
	canonicalString,
	hashCanonical,
} from "./canonicalHash";
import {
	FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS,
	FAKE_DICTIONARY_PLACEHOLDERS,
	classifyPlaceholder,
	type FakeDictionaryLexicalPlaceholder,
	type FakeDictionaryPlaceholder,
	type FakeDictionaryTemplatePlaceholder,
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
 * Every one of the eight placeholders is present, possibly with an empty list,
 * so a caller never has to distinguish "absent" from "no candidates".
 *
 * A lexical placeholder (FAKE-DICT-LEXEME1) is present only when the template
 * set the pool is built for uses it (`lexicalPlaceholdersOf()`); absent reads
 * as no candidates. Only a present one enters the fingerprint, so a pool built
 * for a set that uses none fingerprints exactly as before.
 */
export type DictionaryVocabularyPool = Readonly<
	Record<FakeDictionaryPlaceholder, readonly string[]>
> & Readonly<Partial<Record<FakeDictionaryLexicalPlaceholder, readonly string[]>>>;

const NO_CANDIDATES: readonly string[] = Object.freeze([]);

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
	placeholder: FakeDictionaryTemplatePlaceholder,
): readonly string[] {
	return pool[placeholder] ?? NO_CANDIDATES;
}

export function hasCandidates(
	pool: DictionaryVocabularyPool,
	placeholder: FakeDictionaryTemplatePlaceholder,
): boolean {
	return poolCandidates(pool, placeholder).length > 0;
}

/** The lexical placeholders this pool carries, in declared order. */
function presentLexical(pool: DictionaryVocabularyPool): readonly FakeDictionaryLexicalPlaceholder[] {
	return FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS.filter((placeholder) => pool[placeholder] !== undefined);
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
	for (const placeholder of [...FAKE_DICTIONARY_PLACEHOLDERS, ...presentLexical(pool)]) {
		const sorted = [...poolCandidates(pool, placeholder)].sort();
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
 const keys = [...FAKE_DICTIONARY_PLACEHOLDERS, ...presentLexical(pool)];
 const sorted = Object.freeze(Object.fromEntries(keys.map(key =>
  [key, Object.freeze([...poolCandidates(pool, key)].sort())])) as DictionaryVocabularyPool);
 const prepared = Object.freeze({ sorted, fingerprint: calculateFingerprint(pool) });
 if (Object.isFrozen(pool) && keys.every(key => Object.isFrozen(pool[key]))) preparedPools.set(pool, prepared);
 return prepared;
}
export function fingerprintDictionaryVocabularyPool(pool: DictionaryVocabularyPool): number {
 return prepareDictionaryPool(pool).fingerprint;
}
