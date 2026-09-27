import type { BodySemantropy } from "../settings/bodySemantropy";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import {
	buildVocabularyPool,
	transformTokenSequences,
	type TokenSequences,
	type TransformResult,
	type VocabularyPool,
} from "../transform/transformTokens";

export const ANALYZE_ERROR_MESSAGE =
	"Could not analyze the note. Run Semantropy: Open again.";

export type AnalyzedNote = {
	tokenSequences: TokenSequences;
	pool: VocabularyPool;
};

export async function analyzeNoteTexts(
	texts: readonly string[],
	tokenize: (text: string) => Promise<JapaneseToken[]>,
): Promise<AnalyzedNote> {
	const tokenSequences = await Promise.all(
		texts.map((text) => tokenize(text)),
	);
	return {
		tokenSequences,
		pool: buildVocabularyPool(tokenSequences),
	};
}

export function transformAnalyzedNote(
	analyzed: AnalyzedNote,
	bodySeed: number,
	bodySemantropy: BodySemantropy,
): TransformResult {
	return transformTokenSequences(
		analyzed.tokenSequences,
		analyzed.pool,
		bodySeed,
		bodySemantropy,
	);
}
