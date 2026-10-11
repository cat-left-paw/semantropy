/**
 * FAKE-DICT-LEXEME1: the words a Vocabulary Snapshot supplies for each Fake
 * Dictionary placeholder, read the same way by the pool, the slot
 * availability and the diagnostics.
 *
 * The eight placeholders read the Snapshot's own dictionary projection, as
 * before. The lexical ones read the shared lists of
 * `src/vocabulary/lexicalProjection.ts`, which never enter that projection or
 * the Snapshot fingerprint. A list is computed the first time it is asked for
 * and kept beside the (frozen) Snapshot, never inside it.
 */

import type { VocabularySnapshot } from "../vocabulary/vocabularySnapshot";
import { iAdjectiveBasicForms, naAdjectiveStems, regularVerbBasicForms, type LexicalForm } from "../vocabulary/lexicalProjection";
import { isFakeDictionaryLexicalPlaceholder, type FakeDictionaryLexicalPlaceholder, type FakeDictionaryTemplatePlaceholder } from "./placeholders";

type Snapshot = Pick<VocabularySnapshot, "projections">;

const LISTS: Readonly<Record<FakeDictionaryLexicalPlaceholder, (snapshot: Snapshot) => readonly LexicalForm[]>> = Object.freeze({
	verb: regularVerbBasicForms,
	iAdjective: iAdjectiveBasicForms,
	naStem: naAdjectiveStems,
});

const cache = new WeakMap<object, Map<FakeDictionaryLexicalPlaceholder, readonly LexicalForm[]>>();

/** The lexical words of one Snapshot, in surface order, merged by surface. */
export function snapshotLexicalForms(snapshot: Snapshot, placeholder: FakeDictionaryLexicalPlaceholder): readonly LexicalForm[] {
	let lists = cache.get(snapshot);
	if (!lists) {
		lists = new Map();
		if (Object.isFrozen(snapshot)) cache.set(snapshot, lists);
	}
	let forms = lists.get(placeholder);
	if (!forms) {
		forms = LISTS[placeholder](snapshot);
		lists.set(placeholder, forms);
	}
	return forms;
}

/** The candidates a Snapshot supplies for a placeholder, with their origins. */
export function snapshotPlaceholderSurfaces(
	snapshot: Snapshot,
	placeholder: FakeDictionaryTemplatePlaceholder,
): readonly { readonly surface: string; readonly origins: readonly { readonly path: string; readonly contentHash: string }[] }[] {
	return isFakeDictionaryLexicalPlaceholder(placeholder)
		? snapshotLexicalForms(snapshot, placeholder)
		: snapshot.projections.dictionary.byPlaceholder[placeholder];
}
