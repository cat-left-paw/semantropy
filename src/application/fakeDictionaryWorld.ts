import { assertUint32Seed } from "../random/seededRandom";
import type { DictionarySemantropy } from "../settings/dictionarySemantropy";
import type { FakeDefinitionResult } from "../dictionary/generateFakeDefinition";
import type { FakeDictionaryHeadword } from "../dictionary/headword";
import type { DictionaryVocabularyPool } from "../dictionary/vocabularyPool";
import {
	copyVocabularyProvenance,
	freezeCollectValue,
	type CollectVocabularyProvenance,
} from "../collect/collectProvenance";
import type { SourceSnapshot } from "./SourceSnapshot";

/**
 * The snapshot fields a Fake Dictionary result is allowed to remember.
 *
 * Path and content hash identify the note the pool came from. The note body,
 * its name, tokens and freshness are all absent: they must not leak into
 * Collect metadata, notices, or logs.
 */
export type DictionarySnapshotIdentity = {
	readonly sourcePath: string;
	readonly contentHash: string;
};

export function dictionarySnapshotIdentityOf(
	snapshot: SourceSnapshot,
): DictionarySnapshotIdentity {
	return Object.freeze({
		sourcePath: snapshot.sourcePath,
		contentHash: snapshot.contentHash,
	});
}

export function sameDictionarySnapshotIdentity(
	left: DictionarySnapshotIdentity,
	right: DictionarySnapshotIdentity,
): boolean {
	return (
		left.sourcePath === right.sourcePath &&
		left.contentHash === right.contentHash
	);
}

/**
 * The last Fake Dictionary result this View session committed.
 *
 * Headword, pool and snapshot identity live here so Reshuffle definition and a
 * Dictionary Semantropy change can rerun the generator without tokenizing.
 * Nothing DOM-shaped belongs on this object.
 */
export type FakeDictionaryCurrent = {
	readonly requestId: number;
	readonly headword: FakeDictionaryHeadword;
	readonly pool: DictionaryVocabularyPool;
	readonly snapshot: DictionarySnapshotIdentity;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly dictionarySeed: number;
	readonly dictionarySemantropy: DictionarySemantropy;
	readonly result: FakeDefinitionResult;
};

export type FakeDictionaryCommit = Omit<FakeDictionaryCurrent, "requestId">;

/**
 * The Fake Dictionary's own session, owned by one Semantropy View.
 *
 * It holds the dictionary Seed and the current definition, and it hands out
 * request ids so an older tokenize cannot overwrite a newer one. It does not
 * hold a Modal, an HTMLElement, a Selection, a Range, a TFile, a Vault or an
 * Editor, and it does not share a field or a random stream with the body.
 */
export class FakeDictionaryWorld {
	private dictionarySeed: number | null = null;
	private requestId = 0;
	private current: FakeDictionaryCurrent | null = null;
	private disposed = false;

	/**
	 * Starts a new request. In-flight work that still holds an older id is
	 * no longer current and must not commit.
	 */
	beginRequest(): number {
		this.requestId += 1;
		return this.requestId;
	}

	isCurrent(requestId: number): boolean {
		return !this.disposed && this.requestId === requestId;
	}

	currentRequestId(): number {
		return this.requestId;
	}

	/**
	 * Issues the session Seed the first time a Define needs one. Later calls
	 * return the same value, including `0`.
	 */
	ensureSeed(issueSeed: () => number): number {
		if (this.dictionarySeed === null) {
			this.dictionarySeed = assertUint32Seed(issueSeed());
		}
		return this.dictionarySeed;
	}

	getSeed(): number | null {
		return this.dictionarySeed;
	}

	/**
	 * Adopts a Seed that Reshuffle definition has already drawn a result from.
	 * Define never calls this; only a successful reshuffle does.
	 */
	adoptSeed(seed: number): void {
		this.dictionarySeed = assertUint32Seed(seed);
	}

	getCurrent(): FakeDictionaryCurrent | null {
		return this.current;
	}

	commit(requestId: number, next: FakeDictionaryCommit, publishDom?: () => void): boolean {
		if (!this.isCurrent(requestId)) {
			return false;
		}
		const previous = this.current;
		const prepared = Object.freeze({
			requestId,
			headword: next.headword,
			pool: next.pool,
			snapshot: next.snapshot,
			vocabulary: freezeCollectValue(copyVocabularyProvenance(next.vocabulary)),
			dictionarySeed: next.dictionarySeed,
			dictionarySemantropy: next.dictionarySemantropy,
			result: next.result,
		});
  publishDom?.();
  if (!this.isCurrent(requestId) || this.current !== previous) return false;
  this.current = prepared;
		return true;
	}

	/**
	 * Drops the displayed definition and cancels in-flight work. The Seed is
	 * kept: Open and Refresh invalidate the display, they do not reshuffle.
	 */
	invalidateDisplay(): void {
		this.current = null;
		this.requestId += 1;
	}

	dispose(): void {
		this.disposed = true;
		this.current = null;
		this.dictionarySeed = null;
		this.requestId += 1;
	}
}
