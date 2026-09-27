/**
 * Every message Copy can show.
 *
 * They are fixed strings. None of them interpolates the selected fragment, a
 * Vault path, or an exception's text — a failure the user can read must not
 * become a place where what they wrote leaks out.
 */
export const COPY_COPIED_MESSAGE = "Copied.";
export const COPY_EMPTY_SELECTION_MESSAGE = "Nothing is selected to copy.";
export const COPY_FAILED_MESSAGE = "Could not copy the fragment.";
export const COPY_MISSING_VIEW_MESSAGE = "Open a Semantropy view first.";
