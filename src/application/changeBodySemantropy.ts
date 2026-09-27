import type { BodySemantropy } from "../settings/bodySemantropy";
import { transformTokenSequences } from "../transform/transformTokens";
import type { TransformResult } from "../transform/transformTokens";
import type { BodyTransform } from "./reshuffleNote";
import type { BusyGuard } from "./refreshSource";
import {
	normalizePreparedBody,
	type PreparedBody,
	type PreparedBodyLike,
} from "./runReshuffle";
import type { SemantropySession } from "./SemantropySession";

export const BODY_LEVEL_ERROR_MESSAGE =
	"Could not change the Text level. Try again.";
export const BODY_LEVEL_UPDATING_MESSAGE = "Updating text…";

export type BodyLevelChangeOutcome =
	| "applied"
	| "unchanged"
	| "busy"
	| "unavailable"
	| "aborted"
	| "failed";

/**
 * The body seen through a prepare/commit boundary: whether a result can be
 * displayed is settled before anything is persisted, and the display change
 * itself is all-or-nothing.
 */
export type BodyLevelHost = {
	getBodyGeneration: () => number;
	getTextNodeCount: () => number;
	/**
	 * Builds the next body off-screen. It may yield to the event loop; the
	 * body on screen stays untouched until the returned commit runs.
	 */
	prepareResult: (
		generation: number,
		result: TransformResult,
	) => Promise<PreparedBodyLike> | PreparedBodyLike;
};

export type ChangeBodySemantropyInput = {
	session: SemantropySession;
	next: BodySemantropy;
	/** Writes the new value to `data.json`; false means the write failed. */
	persist: (value: BodySemantropy) => Promise<boolean>;
	/** Production save success commits the setting even when the display owner has become stale. */
	persistAndCommit?: (value: BodySemantropy, commit: () => boolean) => Promise<"applied" | "stale" | "failed">;
	host: BodyLevelHost;
	isAbandoned: () => boolean;
	transform?: BodyTransform;
};

function levelChangeRefusal(
	input: ChangeBodySemantropyInput,
): BodyLevelChangeOutcome | null {
	if (input.isAbandoned()) {
		return "aborted";
	}
	const state = input.session.getState();
	if (state.status !== "ready") {
		return "unavailable";
	}
	if (state.bodySemantropy === input.next) {
		return "unchanged";
	}
	return null;
}

/**
 * Re-transforms the note at a new Semantropy value.
 *
 * It works only from what the ready session already holds — token sequences,
 * pool and body Seed. Nothing is re-read, re-hashed, re-rendered, re-tokenized
 * or re-pooled, and no new Seed is issued, so the snapshot, its freshness and
 * the rendered DOM all survive the change.
 *
 * Order: transform, detached prepare, persistence, synchronous DOM/session
 * commit. Persistence success is the setting commit point; a stale or closed
 * owner cannot roll it back. Open / Refresh await pending saves and re-read the
 * effective setting. Save failure alone preserves the old persisted setting.
 * The legacy persistence seam remains for its pre-Chunk regression harness.
 */
export async function runChangeBodySemantropy(
	input: ChangeBodySemantropyInput,
): Promise<BodyLevelChangeOutcome> {
	const refused = levelChangeRefusal(input);
	if (refused) {
		return refused;
	}
	const state = input.session.getState();
	if (state.status !== "ready") {
		return "unavailable";
	}

	const snapshot = state.snapshot;
	const generation = input.host.getBodyGeneration();

	// The transform is pure and synchronous, so it runs — and is validated —
	// before anything is written. A level that cannot be produced must not
	// reach `data.json`: that would leave the stored value ahead of a body the
	// user never saw, with no error path back.
	let transformed;
	try {
		const transform = input.transform ?? transformTokenSequences;
		transformed = transform(
			state.tokenSequences,
			state.pool,
			state.bodySeed,
			input.next,
		);
	} catch {
		return "failed";
	}
	if (transformed.texts.length !== input.host.getTextNodeCount()) {
		return "failed";
	}

	const moved = (): boolean => {
		const current = input.session.getState();
		return (
			input.isAbandoned() ||
			current.status !== "ready" ||
			current.snapshot !== snapshot ||
			current.bodySeed !== state.bodySeed ||
			input.host.getBodyGeneration() !== generation
		);
	};

	// Applicability is settled here, while nothing has been written yet. The
	// preparation may yield: a superseded change stops without persisting.
	let prepared: PreparedBody;
	try {
		prepared = normalizePreparedBody(
			await input.host.prepareResult(generation, transformed),
		);
	} catch {
		prepared = { status: "failed" };
	}
	if (prepared.status === "stale" || moved()) {
		return "aborted";
	}
	if (prepared.status === "failed") {
		return "failed";
	}

	const updateSession = (publishDom?: () => void) => input.session.updateReadyTransform({
		// The Seed is deliberately carried over: a level change is not a reroll.
		bodySeed: state.bodySeed,
		replacementCount: transformed.replacementCount,
		replaceableSlotCount: transformed.replaceableSlotCount,
		bodySemantropy: transformed.bodySemantropy,
		algorithmVersion: transformed.algorithmVersion,
	}, publishDom);
 const commit = () => {
  if (moved()) return false;
  let invoked = false, updated = false;
  if (prepared.commit(publish => { invoked = true; return updated = updateSession(publish); }) === "stale") return false;
  return invoked ? updated : updateSession();
 };
 try {
  if (input.persistAndCommit) {
   const outcome = await input.persistAndCommit(input.next, commit);
   return outcome === "applied" ? "applied" : outcome === "stale" ? "aborted" : "failed";
  }
  if (!(await input.persist(input.next))) return "failed";
  return commit() ? "applied" : "aborted";
 } catch { return "failed"; }

}

/**
 * Serializes level changes against Reshuffle and Refresh. The claim is taken
 * before the first await, so a run of rapid selections starts exactly one.
 * `begin` runs with the claim held and before any heavy work.
 */
export async function runChangeBodySemantropyGuarded(
	input: ChangeBodySemantropyInput & {
		busy: BusyGuard;
		begin?: () => Promise<void> | void;
	},
): Promise<BodyLevelChangeOutcome> {
	const token = input.busy.acquire();
	if (token === null) {
		return "busy";
	}
	try {
		const refused = levelChangeRefusal(input);
		if (refused) {
			return refused;
		}
		const generation = input.host.getBodyGeneration();
		try {
			await input.begin?.();
		} catch {
			return "failed";
		}
		// The busy state had a frame to paint; the body may have been replaced meanwhile.
		if (input.host.getBodyGeneration() !== generation) {
			return "aborted";
		}
		return await runChangeBodySemantropy(input);
	} finally {
		input.busy.release(token);
	}
}
