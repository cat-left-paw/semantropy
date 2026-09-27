import type { HeadwordRejection } from "../dictionary/headword";

/**
 * Every Fake Dictionary message the UI can show.
 *
 * They are fixed strings. None of them interpolates the selection, a headword,
 * a definition, a note body, a token, a pool candidate, a Vault path, an
 * absolute path, or an exception's text.
 */
export const DEFINE_MISSING_VIEW_MESSAGE = "Open a Semantropy view first.";
export const DEFINE_EMPTY_SELECTION_MESSAGE = "Nothing is selected to define.";
export const DEFINE_MULTIPLE_TOKENS_MESSAGE = "Select a single word.";
export const DEFINE_SURFACE_MISMATCH_MESSAGE =
	"The selection does not match a single word.";
export const DEFINE_UNKNOWN_WORD_MESSAGE =
	"That word is not in the dictionary.";
export const DEFINE_NOT_NOUN_MESSAGE = "Select a noun.";
export const DEFINE_UNSUPPORTED_NOUN_MESSAGE =
	"That noun class is not supported.";
export const DEFINE_SYMBOL_MESSAGE = "Symbols cannot be defined.";
export const DEFINE_OFF_MESSAGE = "Fake Dictionary is off.";
export const DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE =
	"This note does not contain enough vocabulary to generate a definition.";
export const DEFINE_ANALYZE_ERROR_MESSAGE =
	"Could not analyze the selected word.";
export const DEFINE_GENERATION_ERROR_MESSAGE =
	"Could not generate a definition.";
export const DEFINE_LOADING_MESSAGE = "Generating a definition.";
export const DEFINE_MISSING_MODAL_MESSAGE = "Open a definition first.";
export const RESHUFFLE_DEFINITION_UNAVAILABLE_MESSAGE =
	"Nothing to reshuffle.";
export const COPY_DEFINITION_EMPTY_MESSAGE = "Nothing is generated to copy.";
export const COPY_DEFINITION_FAILED_MESSAGE =
	"Could not copy the definition.";
export const COLLECT_DEFINITION_EMPTY_MESSAGE =
	"Nothing is generated to collect.";
export const DICTIONARY_LEVEL_ERROR_MESSAGE =
	"Could not save the Dictionary level. Try again.";

export function headwordRejectionMessage(reason: HeadwordRejection): string {
	switch (reason) {
		case "empty":
			return DEFINE_EMPTY_SELECTION_MESSAGE;
		case "multiple-tokens":
			return DEFINE_MULTIPLE_TOKENS_MESSAGE;
		case "surface-mismatch":
			return DEFINE_SURFACE_MISMATCH_MESSAGE;
		case "unknown":
			return DEFINE_UNKNOWN_WORD_MESSAGE;
		case "not-noun":
			return DEFINE_NOT_NOUN_MESSAGE;
		case "unsupported-noun":
			return DEFINE_UNSUPPORTED_NOUN_MESSAGE;
		case "symbol":
			return DEFINE_SYMBOL_MESSAGE;
	}
}
