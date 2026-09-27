import type { SemantropyReadyAnalysis, SemantropySession } from "./SemantropySession";
import { createSourceSnapshot, type SourceSnapshot } from "./SourceSnapshot";
import type { BodySemantropy } from "../settings/bodySemantropy";

export const REFRESH_ERROR_MESSAGE =
	"Could not refresh the source note. Run Semantropy: Open again.";
export const REFRESH_UNAVAILABLE_MESSAGE = "Nothing to refresh yet.";
export const REFRESH_MISSING_VIEW_MESSAGE = "Open a Semantropy view first.";

export type RefreshOutcome =
	| "refreshed"
	| "busy"
	| "unavailable"
	| "aborted"
	| "failed";

/**
 * Result of rendering and transforming one snapshot. Supplied by the view so
 * that no DOM handle reaches this coordinator.
 */
export type SnapshotApplication =
	| { status: "applied"; analysis: SemantropyReadyAnalysis }
	| { status: "stale" }
	| { status: "render-error" }
	| { status: "analyze-error" };

export type RunRefreshSourceInput = {
	session: SemantropySession;
	/** Reads the note by path: editor buffer first, saved contents second. */
	readCurrentText: (sourcePath: string) => Promise<string>;
	hashText: (text: string) => Promise<string>;
	issueSeed: () => number;
	/** The value in force when this refresh started; Refresh never changes it. */
	bodySemantropy: BodySemantropy;
	/**
	 * Starts a new request generation, binds the path being refreshed so source
	 * events still reach this view, and clears the displayed body.
	 */
	beginRequest: (sourcePath: string) => number;
	/**
	 * True when a source event arrived after `beginRequest`. The refreshed body
	 * may predate that change, so it must not be published as `fresh`.
	 */
	sourceChangedDuringRequest: () => boolean;
	applySnapshot: (input: {
		requestId: number;
		snapshot: SourceSnapshot;
		bodySeed: number;
		bodySemantropy: BodySemantropy;
	}) => Promise<SnapshotApplication>;
	isAbandoned: () => boolean;
	/** Redraws for an outcome reached after `beginRequest`. */
	settle: (requestId: number, outcome: RefreshOutcome) => void;
};

/**
 * Re-reads the note this session was built from and rebuilds everything.
 *
 * Identity comes from the ready snapshot, never from whatever note happens to
 * be active — the view may well have been left behind while the user moved
 * on. On success the snapshot, hash, Seed, tokens, pool, replacement count and
 * rendered body are all new, and freshness returns to `fresh`.
 *
 * Every failure path ends in one generalized message. Nothing falls back to a
 * simpler tokenizer, a regex split, or the previous analysis.
 */
export async function runRefreshSource(
	input: RunRefreshSourceInput,
): Promise<RefreshOutcome> {
	if (input.isAbandoned()) {
		return "aborted";
	}
	const current = input.session.getReadySnapshot();
	if (!current) {
		return "unavailable";
	}
	const { sourcePath, sourceName } = current;

	const requestId = input.beginRequest(sourcePath);
	const abandoned = (): boolean =>
		input.isAbandoned() || !input.session.isCurrent(requestId);

	try {
		const text = await input.readCurrentText(sourcePath);
		if (abandoned()) {
			return settled(input, requestId, "aborted");
		}

		const contentHash = await input.hashText(text);
		if (abandoned()) {
			return settled(input, requestId, "aborted");
		}

		const snapshot = createSourceSnapshot({
			sourcePath,
			sourceName,
			text,
			contentHash,
		});
		const bodySeed = input.issueSeed();
		const applied = await input.applySnapshot({
			requestId,
			snapshot,
			bodySeed,
			bodySemantropy: input.bodySemantropy,
		});
		if (abandoned() || applied.status === "stale") {
			return settled(input, requestId, "aborted");
		}
		if (applied.status !== "applied") {
			input.session.completeError(requestId, REFRESH_ERROR_MESSAGE);
			return settled(input, requestId, "failed");
		}

		input.session.completeReady(
			requestId,
			snapshot,
			bodySeed,
			applied.analysis,
		);
		if (input.sourceChangedDuringRequest()) {
			// The note moved on while this refresh was reading, rendering or
			// tokenizing. Fail closed: label the new snapshot stale rather than
			// claim it matches a note it may already lag behind.
			input.session.setSourceFreshness(snapshot, "stale");
		}
		return settled(input, requestId, "refreshed");
	} catch {
		if (abandoned()) {
			return settled(input, requestId, "aborted");
		}
		input.session.completeError(requestId, REFRESH_ERROR_MESSAGE);
		return settled(input, requestId, "failed");
	}
}

function settled(
	input: RunRefreshSourceInput,
	requestId: number,
	outcome: RefreshOutcome,
): RefreshOutcome {
	input.settle(requestId, outcome);
	return outcome;
}

/** Token-scoped exclusion, so a superseded run cannot free a newer claim. */
export type BusyGuard = {
	acquire: () => number | null;
	release: (token: number) => void;
};

/**
 * Serializes Refresh so a double click, a held command shortcut, or a button
 * press racing the command palette all start exactly one run. The claim is
 * taken before the first await, so a second synchronous call already sees it.
 */
export async function runRefreshSourceGuarded(
	input: RunRefreshSourceInput & { busy: BusyGuard },
): Promise<RefreshOutcome> {
	const token = input.busy.acquire();
	if (token === null) {
		return "busy";
	}
	try {
		return await runRefreshSource(input);
	} finally {
		// A no-op when an Open or a close already took the gate away.
		input.busy.release(token);
	}
}


/** Chunk Refresh stages a distinct owner. Failure and source races retain the committed session. */
export async function runRefreshTarget(input: Omit<RunRefreshSourceInput, "applySnapshot"> & {
	busy: BusyGuard;
	prepareSnapshot: (input: { requestId: number; snapshot: SourceSnapshot; bodySeed: number; bodySemantropy: BodySemantropy }) =>
		Promise<{ analysis: SemantropyReadyAnalysis; commit: (accept?: (publishDom: () => void) => boolean) => boolean; discard: () => void } | null>;
}): Promise<RefreshOutcome> {
	const token = input.busy.acquire();
	if (token === null) return "busy";
	let staged: Awaited<ReturnType<typeof input.prepareSnapshot>> = null;
	let id: number | null = null;
	let outcome: RefreshOutcome = "failed";
	try {
		const previous = input.session.getReadySnapshot();
		if (input.isAbandoned()) return "aborted";
		if (!previous) return "unavailable";
		const requestId = input.beginRequest(previous.sourcePath); id = requestId;
		const current = () => !input.isAbandoned() && input.session.isCurrent(requestId) &&
			input.session.getReadySnapshot() === previous && !input.sourceChangedDuringRequest();
		const text = await input.readCurrentText(previous.sourcePath);
		if (!current()) return outcome = "aborted";
		const contentHash = await input.hashText(text);
		if (!current()) return outcome = "aborted";
		const snapshot = createSourceSnapshot({ sourcePath: previous.sourcePath, sourceName: previous.sourceName, text, contentHash });
		const bodySeed = input.issueSeed();
		staged = await input.prepareSnapshot({ requestId, snapshot, bodySeed, bodySemantropy: input.bodySemantropy });
		if (!current()) return outcome = "aborted";
		if (!staged) return outcome = "failed";
		let invoked = false;
  const analysis = staged.analysis;
  if (!staged.commit(publish => { invoked = true; return input.session.completeReady(requestId, snapshot, bodySeed, analysis, publish); })) return outcome = "aborted";
  if (!invoked) input.session.completeReady(requestId, snapshot, bodySeed, analysis);
		staged = null;
		return outcome = "refreshed";
	} catch {
		return outcome = input.isAbandoned() || (id !== null && !input.session.isCurrent(id)) ? "aborted" : "failed";
	} finally {
		staged?.discard();
		if (id !== null) input.settle(id, outcome);
		input.busy.release(token);
	}
}
