import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { isSingleCodePointSymbol } from "../transform/tokenPolicy";

/**
 * The eight placeholders a Fake Dictionary template may use.
 *
 * Every one of them is decidable from `pos` / `detail1` / `detail2` alone,
 * which the compact dictionary keeps for every entry. Nothing here needs the
 * base form, the reading or `detail3`, all of which the compact dictionary
 * drops outside the four exchangeable noun classes — see
 * `Docs/Fake Dictionary の標準テンプレート案.md` §1, which is the historical
 * design record for this list. The templates themselves are edited in
 * `resources/fake-dictionary/standard-templates.md`.
 *
 * No verb, adjective, semantic-category or inflected placeholder joins this
 * list in v1. `sahen` inflection lives in the template's own fixed text
 * (`{{sahen}}した`), not in a placeholder DSL.
 */
export const FAKE_DICTIONARY_PLACEHOLDERS = [
	"noun",
	"proper",
	"person",
	"place",
	"organization",
	"sahen",
	"adverbialNoun",
	"number",
] as const;

export type FakeDictionaryPlaceholder =
	(typeof FAKE_DICTIONARY_PLACEHOLDERS)[number];

const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set(
	FAKE_DICTIONARY_PLACEHOLDERS,
);

export function isFakeDictionaryPlaceholder(
	value: string,
): value is FakeDictionaryPlaceholder {
	return PLACEHOLDER_NAMES.has(value);
}

const NOUN = "名詞";
const PROPER_NOUN = "固有名詞";

/**
 * The IPADIC classification each placeholder stands for, for documentation and
 * for tests that pin the mapping. `detail2` is `null` where the placeholder is
 * decided by `detail1` alone.
 */
export const PLACEHOLDER_CLASSIFICATIONS: Readonly<
	Record<
		FakeDictionaryPlaceholder,
		{ readonly detail1: string; readonly detail2: string | null }
	>
> = Object.freeze({
	noun: Object.freeze({ detail1: "一般", detail2: null }),
	proper: Object.freeze({ detail1: PROPER_NOUN, detail2: "一般" }),
	person: Object.freeze({ detail1: PROPER_NOUN, detail2: "人名" }),
	place: Object.freeze({ detail1: PROPER_NOUN, detail2: "地域" }),
	organization: Object.freeze({ detail1: PROPER_NOUN, detail2: "組織" }),
	sahen: Object.freeze({ detail1: "サ変接続", detail2: null }),
	adverbialNoun: Object.freeze({ detail1: "副詞可能", detail2: null }),
	number: Object.freeze({ detail1: "数", detail2: null }),
});

/**
 * The placeholder this token supplies a candidate for, or `null`.
 *
 * `null` means exactly that — not "try something else". A token that lands in
 * no placeholder is dropped; it is never promoted into a neighbouring class to
 * make some template usable. Unknown words, pronouns, dependent nouns,
 * suffixes, IPADIC's `特殊` class and single-code-point symbols are excluded
 * here rather than filtered by each caller.
 */
export function classifyPlaceholder(
	token: JapaneseToken,
): FakeDictionaryPlaceholder | null {
	if (token.isUnknown) {
		return null;
	}
	if (token.pos !== NOUN) {
		return null;
	}
	if (isSingleCodePointSymbol(token.surface)) {
		return null;
	}
	if (token.detail1 === PROPER_NOUN) {
		switch (token.detail2) {
			case "人名":
				return "person";
			case "地域":
				return "place";
			case "組織":
				return "organization";
			case "一般":
				return "proper";
			default:
				// A proper noun whose subclass the dictionary does not record.
				// It is not silently folded into `proper`.
				return null;
		}
	}
	switch (token.detail1) {
		case "一般":
			return "noun";
		case "サ変接続":
			return "sahen";
		case "副詞可能":
			return "adverbialNoun";
		case "数":
			return "number";
		default:
			// 代名詞 / 非自立 / 接尾 / 特殊 / 形容動詞語幹 and anything else.
			return null;
	}
}
