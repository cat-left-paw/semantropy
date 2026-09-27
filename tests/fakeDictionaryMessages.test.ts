import { describe, expect, it } from "vitest";
import {
	COPY_DEFINITION_EMPTY_MESSAGE,
	COPY_DEFINITION_FAILED_MESSAGE,
	COLLECT_DEFINITION_EMPTY_MESSAGE,
	DEFINE_ANALYZE_ERROR_MESSAGE,
	DEFINE_EMPTY_SELECTION_MESSAGE,
	DEFINE_GENERATION_ERROR_MESSAGE,
	DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE,
	DEFINE_MISSING_MODAL_MESSAGE,
	DEFINE_MISSING_VIEW_MESSAGE,
	DEFINE_MULTIPLE_TOKENS_MESSAGE,
	DEFINE_NOT_NOUN_MESSAGE,
	DEFINE_OFF_MESSAGE,
	DEFINE_SYMBOL_MESSAGE,
	DEFINE_SURFACE_MISMATCH_MESSAGE,
	DEFINE_UNKNOWN_WORD_MESSAGE,
	DEFINE_UNSUPPORTED_NOUN_MESSAGE,
	DICTIONARY_LEVEL_ERROR_MESSAGE,
	RESHUFFLE_DEFINITION_UNAVAILABLE_MESSAGE,
	headwordRejectionMessage,
} from "../src/application/fakeDictionaryMessages";
import type { HeadwordRejection } from "../src/dictionary/headword";

const SECRET = "秘密の見出し語";
const PATH = "/Users/hidden/vault/notes/桜桃.md";

const MESSAGES = [
	DEFINE_MISSING_VIEW_MESSAGE,
	DEFINE_EMPTY_SELECTION_MESSAGE,
	DEFINE_MULTIPLE_TOKENS_MESSAGE,
	DEFINE_SURFACE_MISMATCH_MESSAGE,
	DEFINE_UNKNOWN_WORD_MESSAGE,
	DEFINE_NOT_NOUN_MESSAGE,
	DEFINE_UNSUPPORTED_NOUN_MESSAGE,
	DEFINE_SYMBOL_MESSAGE,
	DEFINE_OFF_MESSAGE,
	DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE,
	DEFINE_ANALYZE_ERROR_MESSAGE,
	DEFINE_GENERATION_ERROR_MESSAGE,
	DEFINE_MISSING_MODAL_MESSAGE,
	RESHUFFLE_DEFINITION_UNAVAILABLE_MESSAGE,
	COPY_DEFINITION_EMPTY_MESSAGE,
	COPY_DEFINITION_FAILED_MESSAGE,
	COLLECT_DEFINITION_EMPTY_MESSAGE,
	DICTIONARY_LEVEL_ERROR_MESSAGE,
];

describe("Fake Dictionary messages", () => {
	it("maps every headword rejection to a distinct fixed string", () => {
		const reasons: HeadwordRejection[] = [
			"empty",
			"multiple-tokens",
			"surface-mismatch",
			"unknown",
			"not-noun",
			"unsupported-noun",
			"symbol",
		];
		const mapped = reasons.map(headwordRejectionMessage);
		expect(new Set(mapped).size).toBe(reasons.length);
		expect(headwordRejectionMessage("empty")).toBe(DEFINE_EMPTY_SELECTION_MESSAGE);
		expect(headwordRejectionMessage("multiple-tokens")).toBe(
			DEFINE_MULTIPLE_TOKENS_MESSAGE,
		);
		expect(headwordRejectionMessage("unknown")).toBe(DEFINE_UNKNOWN_WORD_MESSAGE);
		expect(headwordRejectionMessage("not-noun")).toBe(DEFINE_NOT_NOUN_MESSAGE);
	});

	it("never interpolates a selection, path or exception", () => {
		for (const message of MESSAGES) {
			expect(message).not.toContain(SECRET);
			expect(message).not.toContain(PATH);
			expect(message).not.toMatch(/%s|\$\{/);
		}
	});
});
