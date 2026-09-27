/**
 * Every ASCII punctuation character, which is exactly the set CommonMark lets
 * a backslash escape.
 *
 * Escaping all of them, rather than hand-picking the ones that start markup
 * today, is what makes the result provably inert: there is no construct left
 * that could open a link, an image, a heading, a tag, a code span, a table, a
 * list, or raw HTML. It also costs nothing on the content this feature exists
 * for — Japanese text carries almost no ASCII punctuation, and Japanese
 * punctuation is not in this set, so a typical fragment comes through
 * untouched.
 */
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;

/** Leading or trailing spaces and tabs, which markup reads positionally. */
const SPACE_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
	" ": "&#32;",
	"\t": "&#9;",
});

const LINE_PARTS = /^([ \t]*)([\s\S]*?)([ \t]*)$/;

/** CRLF and lone CR become LF, so one fragment has one line structure. */
export function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

/**
 * Renders a fragment's text as literal characters inside a Markdown document.
 *
 * Two different hazards are handled separately. Inline markup is neutralized
 * by backslash-escaping ASCII punctuation. Leading and trailing spaces are
 * neutralized by writing them as numeric character references instead: a
 * backslash cannot escape a space, and a run of leading spaces would otherwise
 * turn the line into an indented code block, where escapes stop working and
 * the text would be shown with its backslashes.
 *
 * A line that is entirely spaces or tabs is escaped once, as a leading run, so
 * it stays a line with content rather than becoming a blank line.
 */
export function escapeFragmentMarkdown(text: string): string {
	return normalizeNewlines(text).split("\n").map(escapeLine).join("\n");
}

function escapeLine(line: string): string {
	const parts = LINE_PARTS.exec(line);
	if (!parts) {
		return escapeInline(line);
	}
	const [, leading = "", body = "", trailing = ""] = parts;
	return `${escapeSpaces(leading)}${escapeInline(body)}${escapeSpaces(trailing)}`;
}

function escapeInline(text: string): string {
	return text.replace(ASCII_PUNCTUATION, (character) => `\\${character}`);
}

function escapeSpaces(run: string): string {
	let escaped = "";
	for (const character of run) {
		escaped += SPACE_ENTITIES[character] ?? character;
	}
	return escaped;
}
