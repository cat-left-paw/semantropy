import { headwordIdentityKey, type FakeDictionaryHeadword } from "../dictionary/headword";
import { FAKE_DICTIONARY_ALGORITHM_VERSION, type FakeDefinitionResult } from "../dictionary/generateFakeDefinition";
import { STANDARD_TEMPLATE_SET_VERSION } from "../dictionary/standardTemplateSet";
import type { CollectVocabularyProvenance } from "../collect/collectProvenance";
import { copyVocabularyProvenance, freezeCollectValue } from "../collect/collectProvenance";
import type { DictionarySnapshotIdentity } from "./fakeDictionaryWorld";
import type { VocabularySnapshot } from "../vocabulary/vocabularySnapshot";

export type CachedFakeDefinition = {
	readonly result: FakeDefinitionResult;
	readonly target: DictionarySnapshotIdentity;
	readonly vocabulary: CollectVocabularyProvenance;
};

/**
 * Exact cache hit: the stored result object was reused. The Target and
 * Vocabulary that generated it must be committed together. A later Target
 * Refresh can keep the same Vocabulary fingerprint, so the current snapshot
 * identity is not a substitute for `cached.target`.
 */
export function cachedDefinitionCommit(
	cached: CachedFakeDefinition | undefined,
	result: FakeDefinitionResult,
): Pick<CachedFakeDefinition, "target" | "vocabulary"> | null {
	if (!cached || cached.result !== result) {
		return null;
	}
	return { target: cached.target, vocabulary: cached.vocabulary };
}

export function definitionCacheKey(headword: FakeDictionaryHeadword, nonce: number, level: number, snapshot: Pick<VocabularySnapshot, "fingerprint" | "drawMode">): string {
 return JSON.stringify([headword.surface, headwordIdentityKey(headword.identity), nonce, level,
  STANDARD_TEMPLATE_SET_VERSION, snapshot.fingerprint, snapshot.drawMode, FAKE_DICTIONARY_ALGORITHM_VERSION]);
}

function freezeCached(value: CachedFakeDefinition): CachedFakeDefinition {
	return Object.freeze({
		result: value.result,
		target: Object.freeze({
			sourcePath: value.target.sourcePath,
			contentHash: value.target.contentHash,
		}),
		vocabulary: freezeCollectValue(copyVocabularyProvenance(value.vocabulary)),
	});
}

/** View-owned, insertion ordered LRU. Failed/stale work never enters this map. */
export class DefinitionCache {
 private entries = new Map<string, CachedFakeDefinition>();
 private latest = new Map<string, string>();
 private worldKey(key: string): string {
  // The stored key always includes the nonce. This bounded index locates the last
  // explicit definition for a word without reshuffling other cached words.
  try { const fields = JSON.parse(key) as unknown; if (!Array.isArray(fields)) return key; const values: readonly unknown[] = fields; return JSON.stringify([values[0], values[1], ...values.slice(3)]); }
  catch { return key; }
 }
 getForWorld(key: string): CachedFakeDefinition | undefined { return this.get(this.latest.get(this.worldKey(key)) ?? key); }
 get size(): number { return this.entries.size; }
 get(key: string): CachedFakeDefinition | undefined {
  const value = this.entries.get(key);
  if (value !== undefined) { this.entries.delete(key); this.entries.set(key, value); }
  return value;
 }
 set(key: string, value: CachedFakeDefinition): void {
  const frozen = freezeCached(value);
  const world = this.worldKey(key), previous = this.latest.get(world);
  if (previous) this.entries.delete(previous);
  this.entries.delete(key); this.entries.set(key, frozen); this.latest.set(world, key);
  if (this.entries.size > 64) {
   const oldest = this.entries.keys().next().value!;
   this.entries.delete(oldest); this.latest.delete(this.worldKey(oldest));
  }
 }
 clear(): void { this.entries.clear(); this.latest.clear(); }
}
