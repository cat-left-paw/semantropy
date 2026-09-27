import type { CollectedFragment } from "./CollectedFragment";
import { escapeFragmentMarkdown } from "./escapeFragmentMarkdown";
import { fragmentMetadataComment } from "./fragmentMetadata";

/**
 * Continuation indent for a list item. Two spaces is the content column of a
 * `- ` bullet, so every later line — and the metadata comment — stays inside
 * the same item instead of starting a new one.
 */
export const COLLECTION_ENTRY_INDENT = "  ";

/**
 * One collection entry: a readable bullet, then its metadata comment.
 *
 * A multi-line fragment stays one entry. Blank lines inside it are kept as
 * blank lines and do not split it, because everything after them is still
 * indented into the same list item.
 *
 * Escaping and metadata are two separate concerns and stay in two separate
 * functions: the text is made inert as Markdown, and the metadata is made safe
 * as an HTML comment. Neither has to know how the other works.
 */
export function serializeFragmentEntry(fragment: CollectedFragment): string {
	const [first = "", ...rest] = escapeFragmentMarkdown(fragment.text).split(
		"\n",
	);

	const lines = [first.length === 0 ? "-" : `- ${first}`];
	for (const line of rest) {
		lines.push(line.length === 0 ? "" : `${COLLECTION_ENTRY_INDENT}${line}`);
	}
	lines.push(
		`${COLLECTION_ENTRY_INDENT}${fragmentMetadataComment(fragment.metadata)}`,
	);

	return `${lines.join("\n")}\n`;
}
