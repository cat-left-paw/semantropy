import type { JapaneseToken } from "../JapaneseTokenizer";

/**
 * IPADIC's own "no value" marker (metadata.json `default_field_value`). The
 * Semantropy-compact dictionary writes it into every slot it drops, so a
 * dropped slot is indistinguishable from a slot IPADIC never filled — and, in
 * particular, is never replaced by a plausible-looking substitute.
 */
export const LINDERA_UNSET = "*";

/** The nine IPADIC detail slots, in the order Lindera returns them. */
export const DETAIL_SLOT_COUNT = 9;

/**
 * One token as lindera-wasm returns it: a plain object, not a class instance.
 * `details` is always the nine IPADIC slots — for an unknown word they come
 * from `unk.bin`, which this spike does not touch. `byteStart` and `byteEnd`
 * are offsets into the UTF-8 encoding of the input.
 */
export type LinderaRawToken = {
	surface: string;
	isUnknown: boolean;
	details: readonly string[];
	byteStart: number;
	byteEnd: number;
};

/**
 * A slot Lindera did not return at all. Treated exactly like `"*"`: the
 * adapter never invents a value.
 */
function slot(details: readonly string[], index: number): string {
	const value = details[index];
	return typeof value === "string" && value.length > 0 ? value : LINDERA_UNSET;
}

/**
 * Maps one Lindera token onto the tokenizer-agnostic `JapaneseToken`.
 *
 * The normalization rules, stated once here and fixed by tests:
 *
 *   - `surface` is the surface form, verbatim.
 *   - `pos`, `detail1`, `detail2` are slots 0-2. These survive compaction for
 *     every entry, so they are as complete as the full dictionary's.
 *   - `detail3`, `conjugationType`, `conjugationForm`, `baseForm` are slots 3,
 *     4, 5 and 6. Compact keeps slots 3 and 6 for exchangeable nouns, and
 *     slots 3-7 for every independent verb and i-adjective. Other system
 *     entries keep only slots 0-2. Unknown entries are unchanged.
 *   - `reading` is slot 7. It is omitted when the slot is `"*"` or empty, so
 *     an absent `reading` means "this build does not have one", never "the
 *     reading is the surface form".
 *   - `isUnknown` is Lindera's own flag.
 *
 * A slot dropped by compaction is reported as `"*"` and nothing else: it is
 * never back-filled from the surface, the base form or the reading, so no
 * caller can mistake a compacted token for complete morphological data.
 * Pronunciation (slot 8) has no place in `JapaneseToken` and is dropped.
 */
export function toJapaneseTokenFromLindera(
	token: LinderaRawToken,
): JapaneseToken {
	const details = token.details;
	const normalized: JapaneseToken = {
		surface: token.surface,
		pos: slot(details, 0),
		detail1: slot(details, 1),
		detail2: slot(details, 2),
		detail3: slot(details, 3),
		conjugationType: slot(details, 4),
		conjugationForm: slot(details, 5),
		baseForm: slot(details, 6),
		isUnknown: token.isUnknown,
	};
	const reading = slot(details, 7);
	if (reading !== LINDERA_UNSET) {
		normalized.reading = reading;
	}
	return normalized;
}

/**
 * A stretch of input that Lindera returned no token for.
 *
 * lindera-wasm 6.0.0 drops ASCII whitespace — spaces, tabs and newlines —
 * from its output, and `setKeepWhitespace(true)` does not change that in this
 * version (verified for the builder's sequential and chained forms and for
 * the direct `new Tokenizer(...)` construction the product build uses).
 * Semantropy rebuilds the body by concatenating token surfaces in order, so a
 * dropped run would silently delete that whitespace from the transformed
 * text: "Hello world" would render as "Helloworld".
 *
 * The adapter therefore restores full coverage of the input before anything
 * above it sees the tokens. That is a boundary concern, not a change to the
 * transform: the transform still concatenates every token surface exactly as
 * before.
 *
 * The restored token claims no morphology. Every detail slot is `"*"` and it
 * is marked unknown, because it did not come from the dictionary at all —
 * calling it 記号/空白 would be this adapter inventing a classification rather
 * than reporting one. Being unknown also keeps it out of the exchangeable
 * pool, so restored whitespace is carried through untouched.
 */
export function createCoverageGapToken(surface: string): JapaneseToken {
	return {
		surface,
		pos: LINDERA_UNSET,
		detail1: LINDERA_UNSET,
		detail2: LINDERA_UNSET,
		detail3: LINDERA_UNSET,
		conjugationType: LINDERA_UNSET,
		conjugationForm: LINDERA_UNSET,
		baseForm: LINDERA_UNSET,
		isUnknown: true,
	};
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/**
 * Maps a whole tokenize result, restoring any stretch of the input Lindera
 * skipped so that the surfaces concatenate back to `text` exactly.
 *
 * Gaps are recovered from the tokens' UTF-8 byte offsets rather than by
 * searching for surfaces, so a run that happens to repeat elsewhere in the
 * text cannot be matched to the wrong position.
 */
export function toJapaneseTokensFromLindera(
	text: string,
	tokens: readonly LinderaRawToken[],
): JapaneseToken[] {
	const mapped: JapaneseToken[] = [];
	// Encoding is skipped entirely unless a gap actually appears, which is the
	// common case for prose with no ASCII whitespace.
	let bytes: Uint8Array | null = null;
	const encoded = (): Uint8Array => {
		bytes ??= utf8Encoder.encode(text);
		return bytes;
	};

	let cursor = 0;
	for (const token of tokens) {
		if (token.byteStart > cursor) {
			mapped.push(
				createCoverageGapToken(
					utf8Decoder.decode(encoded().subarray(cursor, token.byteStart)),
				),
			);
		}
		mapped.push(toJapaneseTokenFromLindera(token));
		cursor = Math.max(cursor, token.byteEnd);
	}

	const total = text.length === 0 ? 0 : encoded().length;
	if (cursor < total) {
		mapped.push(
			createCoverageGapToken(utf8Decoder.decode(encoded().subarray(cursor))),
		);
	}
	return mapped;
}
