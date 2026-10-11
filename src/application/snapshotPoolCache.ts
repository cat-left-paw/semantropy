import type { DictionaryVocabularyPool } from "../dictionary/vocabularyPool";
import type { VocabularySnapshot } from "../vocabulary/vocabularySnapshot";
import { snapshotDictionaryPool } from "./prepareVocabulary";

/**
 * FAKE-DICT-RECOMPOSE1: the Fake Dictionary pool of a Vocabulary Snapshot, made once for a word looked up in a
 * Recompose sentence (which has no Target body to have prepared it).
 *
 * `snapshotDictionaryPool()` is the function the Shuffle body's pool comes from, so a word has the same pool, and
 * therefore the same definition, in both panes. The pool is only strings and is kept under the Snapshot it was made
 * from in a `WeakMap`: nothing here keeps a Snapshot, and a Snapshot the View has let go takes its pool with it.
 */
export class SnapshotPoolCache {
	private pools = new WeakMap<VocabularySnapshot, DictionaryVocabularyPool>();

	poolOf(snapshot: VocabularySnapshot): DictionaryVocabularyPool {
		let pool = this.pools.get(snapshot);
		if (!pool) {
			pool = snapshotDictionaryPool(snapshot);
			this.pools.set(snapshot, pool);
		}
		return pool;
	}
}
