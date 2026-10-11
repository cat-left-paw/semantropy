import { validateHeadword, type FakeDictionaryHeadword } from "../dictionary/headword";
import { RECOMPOSE_CLOSING_BRACKETS, type RecomposeCorpus, type RecomposeOutputUnit } from "../recompose/recompose";
import type { RecomposeMorph } from "../recompose/recomposeCorpus";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";

/**
 * FAKE-DICT-RECOMPOSE1 (`Docs/fake_dictionary_recompose_amendment1.md`): the words of a Recompose piece that the
 * Fake Dictionary can look up.
 *
 * A word is a morpheme of the piece's own span of the corpus that the dictionary accepts as a headword by the rule
 * the Shuffle body uses (`validateHeadword`: one noun token of a supported class, known, not a lone symbol), and
 * where it stands in the piece's text. The corpus is read once, when the piece is made, and only copied strings
 * remain: a piece keeps no corpus, no model and no Vocabulary owner.
 *
 * The text of a piece is not always its morphemes' surfaces joined: the core drops a closing bracket that closes
 * nothing, appends the closing brackets a sentence leaves open, and the n-gram method adds a 。 to a sentence it had
 * to end. The words are found by laying the morphemes on the text in order; only a closing bracket may be skipped
 * (it was dropped), and what is left after the last morpheme must be nothing but closing brackets and 。 (they were
 * added). Any other difference means the text is not what this reads, and the piece has no words — nothing is guessed.
 */
export type RecomposeWord = Readonly<{
	/** `[start, end)` into the piece's `text`, in UTF-16 code units. */
	start: number;
	end: number;
	headword: FakeDictionaryHeadword;
}>;

export type RecomposeShownUnit = RecomposeOutputUnit & { readonly words: readonly RecomposeWord[] };

const NO_WORDS: readonly RecomposeWord[] = Object.freeze([]);

function isClosingBrackets(text: string): boolean {
	if (text === "") return false;
	for (const char of text) if (!RECOMPOSE_CLOSING_BRACKETS.has(char)) return false;
	return true;
}

/** What the dictionary reads of a morpheme: the corpus keeps no `detail3`, which no headword rule uses. */
function tokenOf(morph: RecomposeMorph): JapaneseToken {
	return { surface: morph.surface, pos: morph.pos, detail1: morph.detail1, detail2: morph.detail2, detail3: "*",
		conjugationType: morph.conjugationType, conjugationForm: morph.conjugationForm, baseForm: morph.baseForm,
		...(morph.reading === undefined ? {} : { reading: morph.reading }), isUnknown: morph.isUnknown };
}

export function recomposeWordsOf(corpus: RecomposeCorpus, unit: Pick<RecomposeOutputUnit, "text" | "start" | "end">): readonly RecomposeWord[] {
	const { text } = unit;
	if (!(unit.start >= 0) || unit.end > corpus.morphs.length || unit.start > unit.end) return NO_WORDS;
	const words: RecomposeWord[] = [];
	let cursor = 0;
	for (let index = unit.start; index < unit.end; index += 1) {
		const morph = corpus.morphs[index]!;
		const { surface } = morph;
		if (surface === "") continue;
		if (text.startsWith(surface, cursor)) {
			const validation = validateHeadword(surface, [tokenOf(morph)]);
			if (validation.outcome === "accepted") words.push(Object.freeze({ start: cursor, end: cursor + surface.length, headword: validation.headword }));
			cursor += surface.length;
		} else if (!isClosingBrackets(surface)) {
			return NO_WORDS;
		}
	}
	// What follows the last morpheme was added by the core: closing brackets, and the 。 an n-gram sentence is ended with.
	for (const char of text.slice(cursor)) if (char !== "。" && !RECOMPOSE_CLOSING_BRACKETS.has(char)) return NO_WORDS;
	return words.length === 0 ? NO_WORDS : Object.freeze(words);
}

/** The piece as the screen keeps it: the core's unit, with its words. */
export function withRecomposeWords(corpus: RecomposeCorpus, unit: RecomposeOutputUnit): RecomposeShownUnit {
	return Object.freeze({ ...unit, words: recomposeWordsOf(corpus, unit) });
}
