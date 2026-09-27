import type { CollectFragmentResultV3 } from "./v3/CollectFragmentUseCaseV3";
import type { CollectFragmentResultV4 } from "./v4/CollectFragmentUseCaseV4";
import type { CollectFragmentResult } from "./CollectFragmentUseCase";
import type { CollectionPathConflict } from "./FragmentRepository";

/**
 * Every message Collect can show.
 *
 * They are fixed strings. None of them interpolates the fragment, the source
 * path, the content hash, generation state, the metadata, an absolute path, or an
 * exception's text — a failure the user can read must not become a place where
 * what they wrote leaks out.
 */
export const COLLECT_EMPTY_SELECTION_MESSAGE =
	"Nothing is selected to collect.";
export const COLLECT_FAILED_MESSAGE = "Could not save the fragment.";
export const COLLECT_PATH_NOT_MARKDOWN_MESSAGE =
	"The Collection path is not a Markdown file.";
export const COLLECT_PATH_IS_FOLDER_MESSAGE =
	"The Collection path is a folder.";
export const COLLECT_PATH_PARENT_MISSING_MESSAGE =
	"The Collection folder does not exist.";
export const COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE =
	"A Target or Vocabulary Source note cannot be used as the Collection file.";
export const COLLECT_PATH_INVALID_MESSAGE =
	"The Collection path is not a valid Vault path.";
export const COLLECT_SAVED_MESSAGE = "Collected.";
export const COLLECT_MISSING_VIEW_MESSAGE = "Open a Semantropy view first.";

/**
 * The message for one outcome. Wiring it to a Notice is the view's job; the
 * mapping itself belongs with the outcomes it covers.
 */
function conflictMessage(reason: CollectionPathConflict): string {
	switch (reason) {
		case "folder":
			return COLLECT_PATH_IS_FOLDER_MESSAGE;
		case "non-markdown":
			return COLLECT_PATH_NOT_MARKDOWN_MESSAGE;
		case "parent-missing":
			return COLLECT_PATH_PARENT_MISSING_MESSAGE;
		case "source-note":
			return COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE;
	}
}

export function collectFragmentMessage(result: CollectFragmentResult | CollectFragmentResultV3 | CollectFragmentResultV4): string {
	switch (result.status) {
		case "created":
		case "appended":
			return COLLECT_SAVED_MESSAGE;
		case "invalid":
			return result.reason === "empty-text"
				? COLLECT_EMPTY_SELECTION_MESSAGE
				: COLLECT_FAILED_MESSAGE;
		case "invalid-path":
			return COLLECT_PATH_INVALID_MESSAGE;
		case "conflict":
			return conflictMessage(result.reason);
		case "failed":
			return COLLECT_FAILED_MESSAGE;
	}
}
