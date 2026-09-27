import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { isSingleCodePointSymbol } from "../transform/tokenPolicy";
import {
	canonicalList,
	canonicalOptionalString,
	canonicalString,
} from "./canonicalHash";
import {
	classifyPlaceholder,
	type FakeDictionaryPlaceholder,
} from "./placeholders";

/** IPADIC `detail1` values a headword may carry. */
const HEADWORD_NOUN_DETAILS: ReadonlySet<string> = new Set([
	"一般",
	"固有名詞",
	"サ変接続",
	"形容動詞語幹",
	"副詞可能",
	"数",
]);

/**
 * Why a selection cannot be a headword.
 *
 * A closed union, and deliberately coarse. No variant carries the selected
 * text, a token, an exception message or a path: a rejection reason travels to
 * the UI and to logs, and the user's own words must not travel with it.
 */
export type HeadwordRejection =
	/** Blank, whitespace only, or analysed into no token at all. */
	| "empty"
	| "multiple-tokens"
	/** The single token does not cover the whole selection. */
	| "surface-mismatch"
	| "unknown"
	| "not-noun"
	/** A noun, but not one of the six supported `detail1` classes. */
	| "unsupported-noun"
	| "symbol";

/**
 * A headword's identity: what makes two occurrences of a word the same word.
 *
 * Built only from the dictionary's view of the token. Where the word sat in
 * the DOM, which text node it came from, and the body Seed are all absent by
 * design — the same word in the same note must get the same definition however
 * the note is laid out or re-rendered.
 */
export type HeadwordIdentity = {
	/** NFC-normalized base form, or the surface where the dictionary has none. */
	readonly baseForm: string;
	/**
	 * NFC-normalized reading, or `null`.
	 *
	 * `adverbialNoun` and `number` candidates always land here as `null`: the
	 * compact dictionary keeps readings only for exchangeable nouns, so a
	 * reading is genuinely absent rather than merely unread.
	 */
	readonly reading: string | null;
	readonly pos: string;
	readonly detail1: string;
	readonly detail2: string;
};

export type FakeDictionaryHeadword = {
	readonly surface: string;
	readonly identity: HeadwordIdentity;
	/**
	 * The placeholder class this headword itself belongs to, or `null`.
	 *
	 * Only used to prefer a template family. `形容動詞語幹` headwords are
	 * accepted but match no placeholder, and get no preferred family.
	 */
	readonly classification: FakeDictionaryPlaceholder | null;
};

export type HeadwordValidation =
	| { readonly outcome: "accepted"; readonly headword: FakeDictionaryHeadword }
	| { readonly outcome: "rejected"; readonly reason: HeadwordRejection };

/** IPADIC's own "field not set" marker. */
const UNSET = "*";

function normalize(value: string): string {
	return value.normalize("NFC");
}

function fieldOrFallback(value: string | undefined, fallback: string): string {
	if (value === undefined || value === "" || value === UNSET) {
		return fallback;
	}
	return value;
}

/**
 * Builds the identity of one already-validated token.
 *
 * The base form falls back to the surface when the dictionary records none,
 * which is the normal case for `名詞-副詞可能` and `名詞-数` under the compact
 * dictionary. An absent reading stays absent — it is not faked from the
 * surface, because a surface is not a reading.
 */
export function headwordIdentity(token: JapaneseToken): HeadwordIdentity {
	const surface = normalize(token.surface);
	const baseForm = normalize(fieldOrFallback(token.baseForm, surface));
	const rawReading = fieldOrFallback(token.reading, "");
	return Object.freeze({
		baseForm,
		reading: rawReading === "" ? null : normalize(rawReading),
		pos: token.pos,
		detail1: token.detail1,
		detail2: token.detail2,
	});
}

/** The identity's canonical form, for hashing into the definition Seed. */
export function headwordIdentityKey(identity: HeadwordIdentity): string {
	return canonicalList([
		canonicalString(identity.baseForm),
		canonicalOptionalString(identity.reading),
		canonicalString(identity.pos),
		canonicalString(identity.detail1),
		canonicalString(identity.detail2),
	]);
}

/**
 * Decides whether a selection is a headword the dictionary will define.
 *
 * The caller tokenizes; this function only judges. The checks run in the order
 * the specification lists them, so a selection that fails several is reported
 * by the first — `symbol` therefore means "an otherwise supported noun that is
 * a single punctuation or symbol character", not "anything symbol-like".
 *
 * A selection that analyses into no token at all is `empty`: there is nothing
 * to define, and it is not a `multiple-tokens` case.
 *
 * Inputs are read, never modified.
 */
export function validateHeadword(
	selection: string,
	tokens: readonly JapaneseToken[],
): HeadwordValidation {
	if (selection.trim() === "") {
		return rejected("empty");
	}
	if (tokens.length === 0) {
		return rejected("empty");
	}
	if (tokens.length > 1) {
		return rejected("multiple-tokens");
	}
	const token = tokens[0];
	if (!token) {
		return rejected("empty");
	}
	if (token.surface !== selection) {
		return rejected("surface-mismatch");
	}
	if (token.isUnknown) {
		return rejected("unknown");
	}
	if (token.pos !== "名詞") {
		return rejected("not-noun");
	}
	if (!HEADWORD_NOUN_DETAILS.has(token.detail1)) {
		return rejected("unsupported-noun");
	}
	if (isSingleCodePointSymbol(token.surface)) {
		return rejected("symbol");
	}
	return Object.freeze({
		outcome: "accepted",
		headword: Object.freeze({
			surface: token.surface,
			identity: headwordIdentity(token),
			classification: classifyPlaceholder(token),
		}),
	} as const);
}

function rejected(reason: HeadwordRejection): HeadwordValidation {
	return Object.freeze({ outcome: "rejected", reason } as const);
}
