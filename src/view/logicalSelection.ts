/**
 * The recorded form of an explicit body selection.
 *
 * It exists so that moving focus to the Toolbar — which is what pressing Copy
 * or Collect does — cannot cost the reader the fragment they picked, while
 * still refusing every selection that is no longer the one they saw.
 *
 * It holds offsets into the current logical body text and the string those
 * offsets covered. It never holds a Node, a Range, a Selection, a token, a
 * candidate or a path, so it is not a store of note content and has nothing
 * that could be written to `data.json`; it lives for one view session only.
 *
 * `displayRevision` changes whenever the displayed string can change — a
 * Reshuffle, a Text Semantropy change, a Vocabulary Apply — and the owner and
 * generation change on Refresh, Open and close. A marker or colour change
 * moves none of them, so a purely visual change keeps the selection.
 */
export type LogicalSelectionSnapshot = {
	viewId: string;
	bodyGeneration: number;
	displayRevision: number;
	start: number;
	end: number;
	text: string;
};

/** Fixed string; it never repeats the text that was selected. */
export const SELECTION_INVALIDATED_MESSAGE =
	"The earlier selection is no longer valid. Select the text again.";

export type LogicalSelectionOwner = {
	getBodyGeneration: () => number;
	getDisplayRevision: () => number;
	resolveLogicalRange: (start: number, end: number) => string | null;
};

/**
 * Re-reads a recorded selection against the body on screen now.
 *
 * Identity is checked before content: a snapshot from another view, another
 * body owner, an older generation or an older display revision is refused
 * outright. Only then is the interval re-read, and only an exact match with
 * the recorded string is accepted — the text is never searched for elsewhere.
 */
export function resolveLogicalSelection(input: {
	snapshot: LogicalSelectionSnapshot;
	owner: LogicalSelectionOwner;
	currentOwner: LogicalSelectionOwner;
	viewId: string;
}): { status: "selected"; text: string } | { status: "invalid" } {
	const { snapshot, owner, currentOwner, viewId } = input;
	if (
		owner !== currentOwner ||
		snapshot.viewId !== viewId ||
		snapshot.bodyGeneration !== currentOwner.getBodyGeneration() ||
		snapshot.displayRevision !== currentOwner.getDisplayRevision()
	) {
		return { status: "invalid" };
	}
	const text = currentOwner.resolveLogicalRange(snapshot.start, snapshot.end);
	return text !== null && text === snapshot.text
		? { status: "selected", text }
		: { status: "invalid" };
}
