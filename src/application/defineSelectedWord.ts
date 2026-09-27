import {
	generateFakeDefinition,
	type FakeDefinitionResult,
	type GeneratedFakeDefinition,
} from "../dictionary/generateFakeDefinition";
import {
	validateHeadword,
	type FakeDictionaryHeadword,
	type HeadwordRejection,
 type HeadwordValidation,
} from "../dictionary/headword";
import {
	buildDictionaryVocabularyPool,
	type DictionaryVocabularyPool,
} from "../dictionary/vocabularyPool";
import type { DictionarySemantropy } from "../settings/dictionarySemantropy";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import type { TokenSequences } from "../transform/transformTokens";
import {
	sameDictionarySnapshotIdentity,
	type DictionarySnapshotIdentity,
} from "./fakeDictionaryWorld";

export type DefineGenerate = (request: {
	headword: FakeDictionaryHeadword;
	pool: DictionaryVocabularyPool;
	dictionarySeed: number;
	dictionarySemantropy: DictionarySemantropy | number;
}) => FakeDefinitionResult;

export type DefineSelectedWordResult =
	| { readonly status: "stale" }
	| { readonly status: "rejected"; readonly reason: HeadwordRejection }
	| { readonly status: "error"; readonly kind: "analyze" | "generate" }
	| {
			readonly status: "ready";
			readonly headword: FakeDictionaryHeadword;
			readonly pool: DictionaryVocabularyPool;
			readonly snapshot: DictionarySnapshotIdentity;
			readonly result: FakeDefinitionResult;
	  };

export type DefineSelectedWordInput = {
	selection: string;
 /** Supplied only after exact committed DisplaySlot coverage and owner validation. */
 identified?: HeadwordValidation;
	snapshot: DictionarySnapshotIdentity;
	tokenSequences: TokenSequences;
	/** Prepared Current Note pool, independent of the materialized Target prefix. */
	preparedPool?: DictionaryVocabularyPool;
	dictionarySeed: number;
	dictionarySemantropy: DictionarySemantropy;
	getTokenizer: () => JapaneseTokenizer;
	isCurrent: () => boolean;
	getSnapshotIdentity: () => DictionarySnapshotIdentity | null;
	generate?: DefineGenerate;
};

function snapshotStillMatches(input: DefineSelectedWordInput): boolean {
	const current = input.getSnapshotIdentity();
	return (
		current !== null &&
		sameDictionarySnapshotIdentity(current, input.snapshot)
	);
}

/**
 * Tokenizes one captured selection and produces a Fake Definition.
 *
 * The caller captures the selection, the ready snapshot and its token
 * sequences synchronously. This function tokenizes only that selection, builds
 * the vocabulary pool from those sequences, and never re-tokenizes a
 * transformed DOM. `getTokenizer` throwing and `tokenize` rejecting take the
 * same analyze-error path.
 */
export async function runDefineSelectedWord(
	input: DefineSelectedWordInput,
): Promise<DefineSelectedWordResult> {
	if (!input.isCurrent()) {
		return { status: "stale" };
	}

 let validated = input.identified;
 if (!validated) {
  try { validated = validateHeadword(input.selection, await input.getTokenizer().tokenize(input.selection)); }
  catch { return input.isCurrent() ? { status: "error", kind: "analyze" } : { status: "stale" }; }
 }
 if (!input.isCurrent() || !snapshotStillMatches(input)) return { status: "stale" };
 if (validated.outcome === "accepted" && validated.headword.surface !== input.selection) return { status: "rejected", reason: "surface-mismatch" };

	if (validated.outcome === "rejected") {
		return { status: "rejected", reason: validated.reason };
	}

	let pool: DictionaryVocabularyPool;
	let result: FakeDefinitionResult;
	try {
		pool = input.preparedPool ?? buildDictionaryVocabularyPool(input.tokenSequences);
		const generate = input.generate ?? generateFakeDefinition;
		result = generate({
			headword: validated.headword,
			pool,
			dictionarySeed: input.dictionarySeed,
			dictionarySemantropy: input.dictionarySemantropy,
		});
	} catch {
		return input.isCurrent()
			? { status: "error", kind: "generate" }
			: { status: "stale" };
	}

	if (!input.isCurrent() || !snapshotStillMatches(input)) {
		return { status: "stale" };
	}

	return {
		status: "ready",
		headword: validated.headword,
		pool,
		snapshot: input.snapshot,
		result,
	};
}

export function generatedDefinitionOf(
	result: FakeDefinitionResult,
): GeneratedFakeDefinition | null {
	return result.outcome === "generated" ? result : null;
}
