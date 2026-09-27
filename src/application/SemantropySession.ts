import { assertUint32Seed } from "../random/seededRandom";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type {
	TokenSequences,
	VocabularyPool,
} from "../transform/transformTokens";
import { createSourceSnapshot, type SourceSnapshot } from "./SourceSnapshot";
import type { SourceFreshness } from "./sourceFreshness";
import {
	selectSourceText,
	type CachedReadFn,
	type SourceCapture,
} from "./selectSourceText";

export type SemantropyReadyAnalysis = {
	tokenSequences: TokenSequences;
	pool: VocabularyPool;
	replacementCount: number;
	/** Independent of the Semantropy value; 0 means nothing to work with. */
	replaceableSlotCount: number;
	bodySemantropy: BodySemantropy;
	algorithmVersion: number;
};

export type SemantropySessionState =
	| { status: "empty" }
	| { status: "loading"; requestId: number }
	| {
			status: "ready";
			snapshot: SourceSnapshot;
			/** Seed for the body transformation only; the Fake Dictionary gets its own. */
			bodySeed: number;
			tokenSequences: TokenSequences;
			pool: VocabularyPool;
			replacementCount: number;
			replaceableSlotCount: number;
			bodySemantropy: BodySemantropy;
			algorithmVersion: number;
			/** Whether the note still matches `snapshot.contentHash`. */
			freshness: SourceFreshness;
	  }
	| { status: "error"; message: string };

export type OpenSourceDependencies = {
	readCached: CachedReadFn;
	hashText: (text: string) => Promise<string>;
	issueSeed: () => number;
};

export const OPEN_SNAPSHOT_ERROR_MESSAGE =
	"Could not open the note. Run Semantropy: Open again.";

export class SemantropySession {
	private requestId = 0;
	/**
	 * Monotonic counter for freshness checks, independent of `requestId`. A
	 * check started before an Open or a Refresh can never write its verdict
	 * onto the session that replaced it.
	 */
	private freshnessGeneration = 0;
	private state: SemantropySessionState = { status: "empty" };

	getState(): SemantropySessionState {
		return this.state;
	}

	isCurrent(requestId: number): boolean {
		return requestId === this.requestId;
	}

	/** The snapshot on screen, or null when nothing is ready. */
	getReadySnapshot(): SourceSnapshot | null {
		return this.state.status === "ready" ? this.state.snapshot : null;
	}

	beginFreshnessCheck(): number {
		this.freshnessGeneration += 1;
		return this.freshnessGeneration;
	}

	isCurrentFreshnessCheck(generation: number): boolean {
		return generation === this.freshnessGeneration;
	}

	/**
	 * Records a freshness verdict, but only for the snapshot the check was run
	 * against. A verdict for a replaced snapshot is dropped.
	 */
	setSourceFreshness(
		snapshot: SourceSnapshot,
		freshness: SourceFreshness,
	): boolean {
		if (this.state.status !== "ready" || this.state.snapshot !== snapshot) {
			return false;
		}
		if (this.state.freshness !== freshness) {
			this.state = { ...this.state, freshness };
		}
		return true;
	}

	/**
	 * Marks the current snapshot stale without reading anything, for a rename
	 * or delete. Bumping the generation first stops an in-flight check from
	 * answering "fresh" afterwards.
	 */
	markSourceStale(): boolean {
		this.freshnessGeneration += 1;
		return (
			this.state.status === "ready" &&
			this.setSourceFreshness(this.state.snapshot, "stale")
		);
	}

	/** Refresh owns a new request while the committed snapshot remains usable. */
	beginRefresh(): number {
		this.requestId += 1;
		this.freshnessGeneration += 1;
		return this.requestId;
	}

	/** Prepare first, publish DOM second, then finalize by assignment. A DOM exception never advances session state. */
	updateMaterializedAnalysis(snapshot: SourceSnapshot, analysis: SemantropyReadyAnalysis, publishDom?: () => void): boolean {
		const previous = this.state;
		if (previous.status !== "ready" || previous.snapshot !== snapshot) return false;
		const next = { ...previous, ...analysis };
		publishDom?.();
		// Never resurrect a session invalidated by a synchronous publication hook.
		if (this.state !== previous) return false;
		this.state = next;
		return true;
	}

	beginLoading(): number {
		this.requestId += 1;
		this.freshnessGeneration += 1;
		this.state = { status: "loading", requestId: this.requestId };
		return this.requestId;
	}

	/** Reversible state participant; DOM publication is owned by the View. */
	prepareMaterializedAnalysis(snapshot: SourceSnapshot, analysis: SemantropyReadyAnalysis) {
		const previous = this.state, request = this.requestId;
		if (previous.status !== "ready" || previous.snapshot !== snapshot) return null;
		const next = { ...previous, ...analysis };
		return {
			current: () => this.state === previous && this.requestId === request,
			commit: () => { if (this.state !== previous || this.requestId !== request) throw Error("Stale automatic session."); this.state = next; },
			rollback: () => { if (this.state === next && this.requestId === request) this.state = previous; },
		};
	}

	completeEmpty(requestId: number): void {
		if (!this.isCurrent(requestId)) {
			return;
		}
		this.state = { status: "empty" };
	}

	completeReady(
		requestId: number,
		snapshot: SourceSnapshot,
		bodySeed: number,
		analysis: SemantropyReadyAnalysis,
  publishDom?: () => void,
	): boolean {
		if (!this.isCurrent(requestId)) {
			return false;
		}
		const previous = this.state;
  const next: SemantropySessionState = {
			status: "ready",
			snapshot,
			bodySeed: assertUint32Seed(bodySeed),
			tokenSequences: analysis.tokenSequences,
			pool: analysis.pool,
			replacementCount: analysis.replacementCount,
			replaceableSlotCount: analysis.replaceableSlotCount,
			bodySemantropy: analysis.bodySemantropy,
			algorithmVersion: analysis.algorithmVersion,
			freshness: "fresh",
		};
  publishDom?.();
  if (!this.isCurrent(requestId) || this.state !== previous) return false;
  this.state = next; return true;
	}

	completeError(requestId: number, message: string): void {
		if (!this.isCurrent(requestId)) {
			return;
		}
		this.state = { status: "error", message };
	}

	/**
	 * Replaces only what a Reshuffle or a level change produces. The snapshot,
	 * token sequences, pool and freshness are carried through untouched.
	 */
	updateReadyTransform(next: {
		bodySeed: number;
		replacementCount: number;
		replaceableSlotCount: number;
		bodySemantropy: BodySemantropy;
		algorithmVersion: number;
	}, publishDom?: () => void): boolean {
		if (this.state.status !== "ready") {
			return false;
		}
		const previous = this.state;
  const prepared = {
			...this.state,
			bodySeed: assertUint32Seed(next.bodySeed),
			replacementCount: next.replacementCount,
   replaceableSlotCount: next.replaceableSlotCount,
			bodySemantropy: next.bodySemantropy,
			algorithmVersion: next.algorithmVersion,
		};
  publishDom?.();
  if (this.state !== previous) return false;
  this.state = prepared;
		return true;
	}

	dispose(): void {
		this.requestId += 1;
		this.freshnessGeneration += 1;
		this.state = { status: "empty" };
	}
}

export async function captureSourceSnapshot(
	session: SemantropySession,
	requestId: number,
	capture: SourceCapture,
	deps: OpenSourceDependencies,
): Promise<{ snapshot: SourceSnapshot; bodySeed: number } | null> {
	try {
		if (capture.kind === "none") {
			session.completeEmpty(requestId);
			return null;
		}

		const selected = await selectSourceText(capture.note, deps.readCached);
		if (!session.isCurrent(requestId)) {
			return null;
		}

		const contentHash = await deps.hashText(selected.text);
		if (!session.isCurrent(requestId)) {
			return null;
		}

		const snapshot = createSourceSnapshot({
			sourcePath: selected.sourcePath,
			sourceName: selected.sourceName,
			text: selected.text,
			contentHash,
		});
		return {
			snapshot,
			bodySeed: deps.issueSeed(),
		};
	} catch {
		session.completeError(requestId, OPEN_SNAPSHOT_ERROR_MESSAGE);
		return null;
	}
}
