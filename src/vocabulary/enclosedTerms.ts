import type { JapaneseToken, JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import { STANDARD_ENCLOSED_TERM_DELIMITER, type EnclosedTermDelimiter } from "../text/enclosedTermDelimiters";

export {
	ENCLOSED_TERM_LIST_SEPARATOR,
	ENCLOSED_TERM_MAX_EXTRA_PAIRS,
	STANDARD_ENCLOSED_TERM_DELIMITER,
	enclosedTermSyntax,
	extraEnclosedTermDelimiters,
	formatEnclosedTermDelimiterList,
	isEnclosedTermDelimiterText,
	parseEnclosedTermDelimiterList,
	type EnclosedTermDelimiter,
} from "../text/enclosedTermDelimiters";

/**
 * 0.1.0 S4 (Docs/release_0_1_0_policy.md decision 10): in a Vocabulary Source,
 * text between an opening and a closing delimiter is one noun (名詞・一般).
 *
 * The standard pair `{{` `}}` is always on; settings may add pairs but never
 * remove or replace it. The Target is never analyzed this way: only Sources
 * read as vocabulary are.
 *
 * Recognition is a tokenizer wrapper, so the tokens still tile the text
 * exactly: the delimiters become 記号・括弧開 / 括弧閉 tokens (never
 * vocabulary) and the inner text one noun token. Text that does not qualify
 * (empty, too long, whitespace, markup characters, a nested delimiter) is left
 * to the tokenizer as ordinary text.
 */

/** Appended to a Source's projection policy only when at least one term was recognized in it. */
export const ENCLOSED_TERM_POLICY_VERSION = "enclosed-terms-1";
export const ENCLOSED_TERM_MAX_LENGTH = 64;

/**
 * Whether inner text can be one noun: 1-64 characters, NFC, and nothing a
 * vocabulary surface may not carry (space, control or format characters,
 * Markdown, HTML or Ruby markup, or a delimiter of the syntax).
 */
export function isEnclosedTermText(value: string, syntax: readonly EnclosedTermDelimiter[] = [STANDARD_ENCLOSED_TERM_DELIMITER]): boolean {
	const length = [...value].length;
	return length >= 1 && length <= ENCLOSED_TERM_MAX_LENGTH && value === value.normalize("NFC") &&
		!/[\p{C}\s<>`{}[\]|*\\｜《》]/u.test(value) &&
		!syntax.some((pair) => value.includes(pair.open) || value.includes(pair.close));
}

export type EnclosedTermSpan = {
	readonly start: number;
	readonly end: number;
	readonly delimiter: EnclosedTermDelimiter;
	readonly term: string;
};

/**
 * Non-overlapping spans, left to right. At each position the earliest opening
 * delimiter wins (the longer one on a tie), closed by the first matching close;
 * an unqualified span is skipped one character at a time.
 */
export function findEnclosedTerms(text: string, syntax: readonly EnclosedTermDelimiter[]): readonly EnclosedTermSpan[] {
	const spans: EnclosedTermSpan[] = [];
	// Next known position of each delimiter's open and close marks (-2 unknown, -1 none left). Every search
	// moves forward only, so a text with many unclosed marks stays linear rather than rescanning (S3+S4 review).
	const opens = syntax.map(() => -2), closes = syntax.map(() => -2);
	const next = (cache: number[], i: number, needle: string, from: number): number => {
		const known = cache[i]!;
		if (known === -1 || known >= from) return known;
		return (cache[i] = text.indexOf(needle, from));
	};
	let index = 0;
	while (index < text.length) {
		let best: { at: number; i: number } | null = null;
		for (let i = 0; i < syntax.length; i += 1) {
			const at = next(opens, i, syntax[i]!.open, index);
			if (at < 0) continue;
			if (!best || at < best.at || (at === best.at && syntax[i]!.open.length > syntax[best.i]!.open.length)) best = { at, i };
		}
		if (!best) break;
		const delimiter = syntax[best.i]!;
		const innerStart = best.at + delimiter.open.length;
		const innerEnd = next(closes, best.i, delimiter.close, innerStart);
		// A span longer than the term limit (in UTF-16 units, two per code point at most) is never read.
		if (innerEnd > innerStart && innerEnd - innerStart <= ENCLOSED_TERM_MAX_LENGTH * 2) {
			const term = text.slice(innerStart, innerEnd);
			if (isEnclosedTermText(term, syntax)) {
				const end = innerEnd + delimiter.close.length;
				spans.push({ start: best.at, end, delimiter, term });
				index = end;
				continue;
			}
		}
		index = best.at + 1;
	}
	return spans;
}

export function hasEnclosedTerm(text: string, syntax: readonly EnclosedTermDelimiter[]): boolean {
	return findEnclosedTerms(text, syntax).length > 0;
}

/**
 * The `detail2` of a delimiter token this wrapper made, so a reader that copies
 * Source text (Recompose) can leave the markup out. The tokenizer never uses it.
 */
export const ENCLOSED_TERM_DELIMITER_DETAIL = "囲み記号";

function symbol(surface: string, detail1: "括弧開" | "括弧閉"): JapaneseToken {
	return { surface, pos: "記号", detail1, detail2: ENCLOSED_TERM_DELIMITER_DETAIL, detail3: "*", conjugationType: "*", conjugationForm: "*", baseForm: surface, isUnknown: false };
}

export function isEnclosedTermDelimiterToken(token: Pick<JapaneseToken, "pos" | "detail2">): boolean {
	return token.pos === "記号" && token.detail2 === ENCLOSED_TERM_DELIMITER_DETAIL;
}

/** The one noun an enclosed term becomes. No reading: the writer gave none. */
export function enclosedTermToken(term: string): JapaneseToken {
	return { surface: term, pos: "名詞", detail1: "一般", detail2: "*", detail3: "*", conjugationType: "*", conjugationForm: "*", baseForm: term, isUnknown: false };
}

/**
 * Wraps a tokenizer so each enclosed term becomes delimiter / noun / delimiter
 * tokens and the text between terms goes to the tokenizer as before. A text
 * with no term is passed through in one call, unchanged.
 */
export function enclosedTermTokenizer(base: JapaneseTokenizer, syntax: readonly EnclosedTermDelimiter[]): JapaneseTokenizer & { readonly used: () => boolean } {
	let used = false;
	return {
		used: () => used,
		tokenize: async (text) => {
			const spans = findEnclosedTerms(text, syntax);
			if (spans.length === 0) return await base.tokenize(text);
			used = true;
			const tokens: JapaneseToken[] = [];
			let cursor = 0;
			for (const span of spans) {
				if (span.start > cursor) tokens.push(...await base.tokenize(text.slice(cursor, span.start)));
				tokens.push(symbol(span.delimiter.open, "括弧開"), enclosedTermToken(span.term), symbol(span.delimiter.close, "括弧閉"));
				cursor = span.end;
			}
			if (cursor < text.length) tokens.push(...await base.tokenize(text.slice(cursor)));
			return tokens;
		},
	};
}
