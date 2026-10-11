import type { SemantropyViewModel } from "./semantropyViewModel";
import type { VocabularySourceIssue } from "./VocabularyControls";
import { EN_MESSAGES, ui } from "../i18n/catalog";

/**
 * The compact status line under the Toolbar.
 *
 * It exists so the reader is never given one ambiguous sentence for several
 * different situations: a Target still being analyzed, a Vocabulary being
 * prepared, a stale Target, a stale Vocabulary Source, an empty pool and a
 * failure are distinct states with distinct wording and distinct controls.
 *
 * Every string here is fixed. None of them interpolates note text, a selected
 * word, a Vault path, an internal nonce or an exception's message; the only
 * interpolated values are counts the reader already sees on screen. Source
 * paths belong to the Vocabulary picker's own status, which renders them as
 * plain text.
 */

export type ToolbarStatusKind =
	| "empty"
	| "loading-target"
	| "preparing-vocabulary"
	| "ready"
	| "target-stale"
	| "vocabulary-stale"
	| "insufficient-pool"
	/** WORKBENCH-UI1: ready, opened without a Shuffle and not generated yet. */
	| "not-generated"
	| "error";

/**
 * English message identities; the Toolbar shows each in the current language
 * (LOCALE1). The one interpolated sentence, progress, is built by `ui()`.
 */
export const ONBOARDING_MESSAGE = EN_MESSAGES.status.onboarding;

export const PREPARING_VOCABULARY_MESSAGE = EN_MESSAGES.status.preparingVocabulary;

export const VOCABULARY_STALE_MESSAGE = EN_MESSAGES.status.vocabularyStale;

export const VOCABULARY_MISSING_MESSAGE = EN_MESSAGES.status.vocabularyMissing;

export const REFRESH_TO_GENERATE_MESSAGE = EN_MESSAGES.status.refreshToGenerate;

/** WORKBENCH-UI5 (review 2, P3 11): what the Open command says when it has no note to take and the View keeps what it has. */
export const OPEN_KEPT_MESSAGE = EN_MESSAGES.status.openKept;

/**
 * WORKBENCH-UI5: on a host with tabs the Shuffle tab has its own area (target, state and
 * actions). The persistent state of the body is shown there; progress, errors, the
 * Vocabulary and the onboarding stay in the Toolbar's status line, which is read on
 * every tab. The model still picks one message by its own priority; this says where it goes.
 */
export const SHUFFLE_BAR_KINDS: readonly ToolbarStatusKind[] = ["target-stale", "not-generated", "insufficient-pool", "ready"];

export type ToolbarStatusModel = {
	kind: ToolbarStatusKind;
	/** The primary sentence for this state, or null when there is nothing to say. */
	message: string | null;
	/** A second line: progress counts, or a fixed hint. Never a path. */
	detail: string | null;
	sourceLabel: string | null;
	replacementLabel: string | null;
	showCancelVocabulary: boolean;
	showOnboarding: boolean;
};

export function toToolbarStatusModel(input: {
	/** The session's own status; never re-derived from a message string. */
	sessionStatus: "empty" | "loading" | "ready" | "error";
	model: SemantropyViewModel;
	/** The message of the body task in flight, if any. */
	taskMessage: string | null;
	/** A failure or notice already chosen by the view, if any. */
	noticeMessage: string | null;
	vocabulary: {
		preparing: boolean;
		progress: { done: number; total: number } | null;
		error: string | null;
		staleSources: readonly VocabularySourceIssue[];
	};
	/** WORKBENCH-UI1: the ready body shows no Chunk yet; `generateBlocked` while Generate waits for Refresh. */
	ungenerated?: boolean;
	generateBlocked?: boolean;
}): ToolbarStatusModel {
	const { model, vocabulary } = input;
	const base = {
		sourceLabel: model.sourceLabel,
		replacementLabel: model.replacementLabel,
		showCancelVocabulary: vocabulary.preparing,
		showOnboarding: false,
	};

	if (vocabulary.preparing) {
		return {
			...base,
			kind: "preparing-vocabulary",
			message: PREPARING_VOCABULARY_MESSAGE,
			detail: vocabulary.progress
				? ui().status.preparing(vocabulary.progress.done, vocabulary.progress.total)
				: null,
		};
	}
	if (vocabulary.error !== null) {
		return { ...base, kind: "error", message: vocabulary.error, detail: null };
	}
	if (input.taskMessage !== null) {
		return {
			...base,
			kind: "loading-target",
			message: input.taskMessage,
			detail: null,
		};
	}
	if (input.noticeMessage !== null) {
		return { ...base, kind: "error", message: input.noticeMessage, detail: null };
	}

	switch (input.sessionStatus) {
		case "empty": {
			// WORKBENCH-UI5 (review 1, P3 1): a Vocabulary applied from Selected Notes with no note can go stale too; the line says so.
			const staleSources = vocabulary.staleSources;
			if (staleSources.length > 0) {
				return {
					...base,
					kind: "vocabulary-stale",
					message: staleSources.some((issue) => issue.reason === "missing") ? VOCABULARY_MISSING_MESSAGE : VOCABULARY_STALE_MESSAGE,
					detail: model.message,
				};
			}
			return {
				...base,
				kind: "empty",
				message: model.message,
				detail: ONBOARDING_MESSAGE,
				showOnboarding: true,
			};
		}
		case "loading":
			return {
				...base,
				kind: "loading-target",
				message: model.message,
				detail: null,
			};
		case "error":
			return { ...base, kind: "error", message: model.message, detail: null };
		case "ready":
			break;
	}

	if (model.freshness === "stale") {
		return {
			...base,
			kind: "target-stale",
			message: model.staleMessage,
			detail: model.message,
		};
	}
	const missing = vocabulary.staleSources.some((issue) => issue.reason === "missing");
	if (vocabulary.staleSources.length > 0) {
		return {
			...base,
			kind: "vocabulary-stale",
			message: missing ? VOCABULARY_MISSING_MESSAGE : VOCABULARY_STALE_MESSAGE,
			detail: model.message,
		};
	}
	// Zero Chunks have no replaceable slot; that is not a shortage, so it is said first.
	if (input.ungenerated === true) {
		return {
			...base,
			kind: "not-generated",
			message: model.message,
			detail: input.generateBlocked === true ? REFRESH_TO_GENERATE_MESSAGE : null,
		};
	}
	if (model.replaceableSlotCount === 0) {
		return {
			...base,
			kind: "insufficient-pool",
			message: model.message,
			detail: null,
		};
	}
	return { ...base, kind: "ready", message: model.message, detail: null };
}

/**
 * WORKBENCH-UI5: the Toolbar's share of the status on a host with tabs. The target's name, the
 * replacement count and the body-state message belong to the Shuffle area (`ShuffleBar`);
 * what is left is what every tab needs. `kind` stays, so the line's state attribute still
 * says what the whole status is.
 */
export function toolbarStatusWithoutBody(model: ToolbarStatusModel): ToolbarStatusModel {
	const body = SHUFFLE_BAR_KINDS.includes(model.kind);
	return { ...model, sourceLabel: null, replacementLabel: null, ...(body ? { message: null, detail: null } : {}) };
}
