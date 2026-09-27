/**
 * The Fake Proverb text contract as a pure leaf: the safe text grammar every
 * surface, proverb and gloss must satisfy, and the single canonical serializer
 * of a proverb and its gloss. PRE-RELEASE-FAKE-PROVERB-COLLECT1 moved both here
 * unchanged from the authority and core (which re-export them), so Collect
 * metadata 4 can validate canonical text without the authority's module graph.
 */

/**
 * Controls, format characters, unassigned code points, surrogates, separators
 * and whitespace, and every ASCII punctuation or symbol character — which
 * covers every Markdown delimiter the canonical `**…**` / `> …` wrapping could
 * be broken by. ASCII letters and digits are ordinary text.
 */
const UNSAFE_TEXT = /[\p{C}\p{Z}\s]|[!-/:-@[-`{-~]/u;

function hasIsolatedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

/** The Fake Proverb safe text grammar for surfaces, proverbs and glosses. */
export function isFakeProverbSafeText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.normalize("NFC") &&
		!hasIsolatedSurrogate(value) && !UNSAFE_TEXT.test(value);
}

/** The only way a proverb and a gloss become shared text. */
export function fakeProverbCanonicalText(proverb: string, gloss: string): string {
	return `**${proverb}**\n\n> ${gloss}`;
}
