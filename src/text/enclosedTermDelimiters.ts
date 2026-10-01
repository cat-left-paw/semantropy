/**
 * 0.1.0 S4: the enclosed-term delimiter pairs, shared by settings and the Source reading. A pure
 * leaf outside settings/ and vocabulary/, so both graphs stay closed; the Vocabulary Source
 * reading lives in `src/vocabulary/enclosedTerms.ts`.
 *
 * The standard pair `{{` `}}` is always on; settings may add pairs but never
 * remove or replace it.
 */
export type EnclosedTermDelimiter = { readonly open: string; readonly close: string };

export const STANDARD_ENCLOSED_TERM_DELIMITER: EnclosedTermDelimiter = Object.freeze({ open: "{{", close: "}}" });
export const ENCLOSED_TERM_MAX_EXTRA_PAIRS = 4;
const DELIMITER_MAX_LENGTH = 4;

/** A delimiter is 1-4 symbols: no letter, digit, space, control, or Markdown / Ruby markup character. */
export function isEnclosedTermDelimiterText(value: unknown): value is string {
	if (typeof value !== "string" || value !== value.normalize("NFC")) return false;
	const length = [...value].length;
	return length >= 1 && length <= DELIMITER_MAX_LENGTH && !/[\p{L}\p{N}\p{C}\s\\`*_~#|<>｜《》…]/u.test(value);
}

/**
 * The pairs recognized: the standard pair first, then valid extra pairs in the
 * order given, without duplicates, at most `ENCLOSED_TERM_MAX_EXTRA_PAIRS`.
 */
export function enclosedTermSyntax(extra: readonly unknown[] | null | undefined): readonly EnclosedTermDelimiter[] {
	const pairs: EnclosedTermDelimiter[] = [STANDARD_ENCLOSED_TERM_DELIMITER];
	for (const item of extra ?? []) {
		if (pairs.length > ENCLOSED_TERM_MAX_EXTRA_PAIRS) break;
		if (item === null || typeof item !== "object") continue;
		const { open, close } = item as { open?: unknown; close?: unknown };
		if (!isEnclosedTermDelimiterText(open) || !isEnclosedTermDelimiterText(close)) continue;
		if (pairs.some((pair) => pair.open === open && pair.close === close)) continue;
		pairs.push(Object.freeze({ open, close }));
	}
	return Object.freeze(pairs);
}

/** The extra pairs a stored or requested value holds: valid ones only, never the standard pair. */
export function extraEnclosedTermDelimiters(value: unknown): readonly EnclosedTermDelimiter[] {
	return Object.freeze(enclosedTermSyntax(Array.isArray(value) ? value : []).slice(1));
}

/** Settings text: space-separated `open…close` items, for example `【…】 ［［…］］`. */
export const ENCLOSED_TERM_LIST_SEPARATOR = "…";

/**
 * Reads the settings text. `invalid` lists the items that are not a pair (or
 * exceed the limit); the standard pair and repeats are dropped silently.
 */
export function parseEnclosedTermDelimiterList(text: string): { pairs: readonly EnclosedTermDelimiter[]; invalid: readonly string[] } {
	const pairs: EnclosedTermDelimiter[] = [];
	const invalid: string[] = [];
	for (const item of text.split(/\s+/u).filter(Boolean)) {
		const at = item.indexOf(ENCLOSED_TERM_LIST_SEPARATOR);
		const open = at < 0 ? "" : item.slice(0, at), close = at < 0 ? "" : item.slice(at + ENCLOSED_TERM_LIST_SEPARATOR.length);
		if (!isEnclosedTermDelimiterText(open) || !isEnclosedTermDelimiterText(close)) { invalid.push(item); continue; }
		if ((open === STANDARD_ENCLOSED_TERM_DELIMITER.open && close === STANDARD_ENCLOSED_TERM_DELIMITER.close) ||
			pairs.some((pair) => pair.open === open && pair.close === close)) continue;
		if (pairs.length >= ENCLOSED_TERM_MAX_EXTRA_PAIRS) { invalid.push(item); continue; }
		pairs.push(Object.freeze({ open, close }));
	}
	return { pairs: Object.freeze(pairs), invalid: Object.freeze(invalid) };
}

export function formatEnclosedTermDelimiterList(pairs: readonly EnclosedTermDelimiter[]): string {
	return pairs.map((pair) => `${pair.open}${ENCLOSED_TERM_LIST_SEPARATOR}${pair.close}`).join(" ");
}
