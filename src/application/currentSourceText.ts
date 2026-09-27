/**
 * Reads the note that a Semantropy session was built from, by Vault path.
 *
 * The boundary is deliberately narrow: callers hand in two adapters and get a
 * string back. No `Vault`, `TFile`, `Editor` or `MarkdownView` crosses into
 * this module, so the editor-first rule can be tested on its own.
 */
export type CurrentSourceLookup = {
	/**
	 * The unsaved editor buffer for this path, or `null` when no editor holds
	 * it. An empty string is a real, empty note body — never a "not found".
	 */
	readEditorText: (sourcePath: string) => string | null;
	/** The saved Vault contents for this path. Rejects when unresolvable. */
	readSavedText: (sourcePath: string) => Promise<string>;
};

/**
 * Editor first, saved contents second. A note open in any leaf — including a
 * background one — wins over disk, so an unsaved edit is never judged against
 * a stale saved body.
 */
export async function readCurrentSourceText(
	sourcePath: string,
	lookup: CurrentSourceLookup,
): Promise<string> {
	const editorText = lookup.readEditorText(sourcePath);
	if (editorText !== null) {
		return editorText;
	}
	return await lookup.readSavedText(sourcePath);
}
