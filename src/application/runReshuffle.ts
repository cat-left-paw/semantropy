import type { SemantropySession } from "./SemantropySession";
import { planReshuffle, type BodyTransform } from "./reshuffleNote";
import type { BusyGuard } from "./refreshSource";
import type { TransformResult } from "../transform/transformTokens";

export type ReshuffleOutcome =
	| "applied"
	| "busy"
	| "unavailable"
	| "aborted"
	| "failed";

/** A fully prepared next body, or why there is none. */
export type PreparedBody =
	| { status: "prepared"; commit: (accept?: (publishDom: () => void) => boolean) => "applied" | "stale" }
	| { status: "stale" }
	| { status: "failed" };

/** Also accepts a bare commit step, or null for "this result cannot be applied". */
export type PreparedBodyLike = PreparedBody | (() => "applied" | "stale") | null;

export function normalizePreparedBody(value: PreparedBodyLike): PreparedBody {
	if (value === null) {
		return { status: "failed" };
	}
	if (typeof value === "function") {
		return { status: "prepared", commit: value };
	}
	return value;
}

export type PreparableResult = Pick<
	TransformResult,
	"texts" | "tokenSurfaces" | "displaySeed" | "replacementCount"
>;

export type ReshuffleHost = {
	getBodyGeneration: () => number;
	getTextNodeCount: () => number;
	/**
	 * Builds the next body off-screen. It may yield to the event loop; the
	 * body on screen stays untouched until the returned commit runs.
	 */
	prepareResult: (
		generation: number,
		result: PreparableResult,
	) => Promise<PreparedBodyLike> | PreparedBodyLike;
};

export type RunReshuffleInput = {
	session: SemantropySession;
	host: ReshuffleHost;
	issueSeed: () => number;
	isAbandoned: () => boolean;
	transform?: BodyTransform;
};

function reshuffleRefusal(input: RunReshuffleInput): ReshuffleOutcome | null {
	if (input.isAbandoned()) {
		return "aborted";
	}
	const state = input.session.getState();
	// Reshuffle needs slots that could change, not slots that happened to change:
	// at a low value a Seed may exchange nothing and still be worth rerolling.
	if (
		state.status !== "ready" ||
		state.bodySemantropy === 0 ||
		state.replaceableSlotCount === 0
	) {
		return "unavailable";
	}
	return null;
}

/**
 * Issues a new body Seed, prepares the whole next body, then commits it in one
 * step. Seed, replacement count and the displayed body change together or not
 * at all: a failed, cancelled or superseded run leaves all three as they were.
 */
export async function runReshuffle(input: RunReshuffleInput): Promise<ReshuffleOutcome> {
	const refused = reshuffleRefusal(input);
	if (refused) {
		return refused;
	}
	const state = input.session.getState();
	if (state.status !== "ready") {
		return "unavailable";
	}

	const generation = input.host.getBodyGeneration();
	const planned = planReshuffle({
		tokenSequences: state.tokenSequences,
		pool: state.pool,
		currentBodySeed: state.bodySeed,
		bodySemantropy: state.bodySemantropy,
		expectedNodeCount: input.host.getTextNodeCount(),
		issueSeed: input.issueSeed,
		transform: input.transform,
	});
	if (planned.status !== "planned") {
		return "failed";
	}

	const moved = (): boolean => {
		const current = input.session.getState();
		return (
			input.isAbandoned() ||
			current.status !== "ready" ||
			current.snapshot !== state.snapshot ||
			input.host.getBodyGeneration() !== generation
		);
	};
	if (moved()) {
		return "aborted";
	}

	let prepared: PreparedBody;
	try {
		prepared = normalizePreparedBody(
			await input.host.prepareResult(generation, planned.plan),
		);
	} catch {
		prepared = { status: "failed" };
	}
	// Preparation yields: an Open, a Refresh or a close may have landed since.
	if (moved() || prepared.status === "stale") {
		return "aborted";
	}
	if (prepared.status === "failed") {
		return "failed";
	}
 let updated = false, invoked = false;
 const update = (publishDom?: () => void) => input.session.updateReadyTransform({
  bodySeed: planned.plan.bodySeed, replacementCount: planned.plan.replacementCount,
  replaceableSlotCount: planned.plan.replaceableSlotCount, bodySemantropy: planned.plan.bodySemantropy,
  algorithmVersion: planned.plan.algorithmVersion,
 }, publishDom);
 try {
  if (prepared.commit(publish => { invoked = true; return updated = update(publish); }) === "stale") return "aborted";
  if (!invoked) updated = update(); // Legacy non-Chunk host.
 } catch { return "failed"; }

	if (!updated) {
		return "aborted";
	}
	return "applied";
}

/**
 * Serializes Reshuffle against the view's other actions. The claim is taken
 * before the first await, so a double click starts exactly one run. `begin`
 * runs with the claim held and before any heavy work: it is where the view
 * shows its busy state and lets that state paint.
 */
export async function runReshuffleGuarded(
	input: RunReshuffleInput & {
		busy: BusyGuard;
		begin?: () => Promise<void> | void;
	},
): Promise<ReshuffleOutcome> {
	const token = input.busy.acquire();
	if (token === null) {
		return "busy";
	}
	try {
		const refused = reshuffleRefusal(input);
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
		return await runReshuffle(input);
	} finally {
		input.busy.release(token);
	}
}
