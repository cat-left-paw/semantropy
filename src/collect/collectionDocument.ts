/** Written into the frontmatter of a collection this plugin creates. */
export const COLLECTION_DOCUMENT_VERSION = 1;

export const COLLECTION_DOCUMENT_HEADING = "# Semantropy Fragments";

/**
 * The file Collect creates the first time, when nothing is there yet.
 *
 * It is an ordinary note: frontmatter, a heading, and bullets. Nothing about
 * it requires this plugin to read it back.
 */
export function createCollectionDocument(entry: string): string {
	return [
		"---",
		`semantropy-collection-version: ${COLLECTION_DOCUMENT_VERSION}`,
		"---",
		"",
		COLLECTION_DOCUMENT_HEADING,
		"",
		entry,
	].join("\n");
}

/**
 * Adds one entry at the end of a collection.
 *
 * What is already in the file is never edited, reformatted, re-indented or
 * re-parsed — the result always begins with the existing bytes exactly as they
 * were. The user owns that file and may have rewritten any of it by hand.
 *
 * Only padding is added, and only enough to leave exactly one blank line
 * before the new entry, so a file that ends without a newline, with one, or
 * with several all end up equally readable.
 */
export function appendCollectionEntry(existing: string, entry: string): string {
	if (existing.length === 0) {
		return createCollectionDocument(entry);
	}
	const trailing = countTrailingNewlines(existing);
	const padding = trailing >= 2 ? "" : "\n".repeat(2 - trailing);
	return `${existing}${padding}${entry}`;
}

function countTrailingNewlines(text: string): number {
	let count = 0;
	while (count < text.length && text[text.length - 1 - count] === "\n") {
		count += 1;
	}
	return count;
}
