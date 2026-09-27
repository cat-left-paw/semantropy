import type { SemantropySessionState } from "../application/SemantropySession";
import {
	INSUFFICIENT_POOL_MESSAGE,
	NO_SUPPORTED_TEXT_MESSAGE,
	TEXT_TRANSFORMATION_OFF_MESSAGE,
} from "../application/reshuffleNote";
import {
	STALE_SOURCE_MESSAGE,
	type SourceFreshness,
} from "../application/sourceFreshness";
import {
	bodySemantropyChoices,
	bodySemantropyLabel,
	type BodySemantropy,
} from "../settings/bodySemantropy";
import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";

export type SemantropyLevelChoice = {
	value: BodySemantropy;
	label: string;
};

export type SemantropyViewModel = {
	sourceLabel: string | null;
	levelLabel: string | null;
	replacementLabel: string | null;
	bodyText: string | null;
	message: string | null;
	/** Non-null only while the note has moved on from the snapshot. */
	staleMessage: string | null;
	freshness: SourceFreshness | null;
	bodySemantropy: BodySemantropy | null;
	replaceableSlotCount: number | null;
	levelChoices: readonly SemantropyLevelChoice[] | null;
	showLevelControl: boolean;
	levelControlEnabled: boolean;
	showReshuffle: boolean;
	reshuffleEnabled: boolean;
	showRefresh: boolean;
	refreshEnabled: boolean;
	showCopy: boolean;
	copyEnabled: boolean;
	showCollect: boolean;
	collectEnabled: boolean;
	bodyAsTextContent: true;
};

const IDLE_MODEL: Omit<SemantropyViewModel, "message"> = {
	sourceLabel: null,
	levelLabel: null,
	replacementLabel: null,
	bodyText: null,
	staleMessage: null,
	freshness: null,
	bodySemantropy: null,
	replaceableSlotCount: null,
	levelChoices: null,
	showLevelControl: false,
	levelControlEnabled: false,
	showReshuffle: false,
	reshuffleEnabled: false,
	showRefresh: false,
	refreshEnabled: false,
	showCopy: false,
	copyEnabled: false,
	showCollect: false,
	collectEnabled: false,
	bodyAsTextContent: true,
};

/**
 * "Nothing to work with" and "the level chose nothing" are different states
 * and must read differently: only an empty pool is an insufficient-pool note.
 */
function readyMessage(
	replaceableSlotCount: number,
	bodySemantropy: BodySemantropy,
	analysisRunCount: number,
): string | null {
	if (replaceableSlotCount === 0) {
		// No analysis run at all means everything visible is protected or
		// frontmatter; that is not a vocabulary shortage.
		return analysisRunCount === 0
			? NO_SUPPORTED_TEXT_MESSAGE
			: INSUFFICIENT_POOL_MESSAGE;
	}
	if (bodySemantropy === 0) {
		return TEXT_TRANSFORMATION_OFF_MESSAGE;
	}
	return null;
}

export function toSemantropyViewModel(
	state: SemantropySessionState,
	options: {
		busy?: boolean;
		/**
		 * A cancellable Reshuffle is being prepared. It holds the busy claim,
		 * but Refresh stays available because it supersedes that work instead
		 * of competing with it. A Text-level change is not cancellable by
		 * Refresh and leaves this false, so Refresh stays disabled (busy).
		 */
		transforming?: boolean;
	} = {},
): SemantropyViewModel {
	const busy = options.busy === true;
	const transforming = options.transforming === true;
	switch (state.status) {
		case "empty":
			return {
				...IDLE_MODEL,
				message: "Open a Markdown note, then run Semantropy: Open.",
			};
		case "loading":
			// No control is offered while a request is in flight, so a second
			// Reshuffle, Refresh or level change cannot start from the shell.
			return { ...IDLE_MODEL, message: "Analyzing…" };
		case "ready":
			return {
				// LOCALE1: labels in the current language; the note name is shown as written.
				sourceLabel: ui().status.source(state.snapshot.sourceName),
				levelLabel: ui().toolbar.levelStatus(localize(bodySemantropyLabel(state.bodySemantropy))),
				replacementLabel: ui().status.replacements(state.replacementCount),
				bodyText: null,
				message: readyMessage(
					state.replaceableSlotCount,
					state.bodySemantropy,
					// One token sequence per analysis run; transient session state.
					state.tokenSequences.length,
				),
				// Stale keeps the body, the current generation and the analysis;
				// it only adds a label telling the reader what they are looking at.
				staleMessage:
					state.freshness === "stale" ? STALE_SOURCE_MESSAGE : null,
				freshness: state.freshness,
				bodySemantropy: state.bodySemantropy,
				replaceableSlotCount: state.replaceableSlotCount,
				levelChoices: bodySemantropyChoices(state.bodySemantropy),
				showLevelControl: true,
				levelControlEnabled: !busy,
				showReshuffle: true,
				// A Reshuffle needs slots that could change, not slots that
				// happened to change at this value.
				reshuffleEnabled:
					state.bodySemantropy > 0 &&
					state.replaceableSlotCount > 0 &&
					!busy,
				showRefresh: true,
				refreshEnabled: !busy || transforming,
				showCopy: true,
				copyEnabled: !busy,
				showCollect: true,
				collectEnabled: !busy,
				bodyAsTextContent: true,
			};
		case "error":
			return { ...IDLE_MODEL, message: state.message };
	}
}
