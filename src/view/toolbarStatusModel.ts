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
	| "error";

/**
 * English message identities; the Toolbar shows each in the current language
 * (LOCALE1). The one interpolated sentence, progress, is built by `ui()`.
 */
export const ONBOARDING_MESSAGE = EN_MESSAGES.status.onboarding;

export const PREPARING_VOCABULARY_MESSAGE = EN_MESSAGES.status.preparingVocabulary;

export const VOCABULARY_STALE_MESSAGE = EN_MESSAGES.status.vocabularyStale;

export const VOCABULARY_MISSING_MESSAGE = EN_MESSAGES.status.vocabularyMissing;

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
		case "empty":
			return {
				...base,
				kind: "empty",
				message: model.message,
				detail: ONBOARDING_MESSAGE,
				showOnboarding: true,
			};
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
