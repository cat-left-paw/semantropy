/**
 * FAKE-DICT-LEXEME1: what may follow a lexical placeholder in a Fake
 * Dictionary template. Build-time only: the template generator
 * (`scripts/fakeDictionary/standardTemplates.mjs`) runs it after
 * `compileTemplateSet()`, and nothing in the plugin imports it, so it adds
 * nothing to `main.js`.
 *
 * It is a guard, not a grammar proof (`Docs/fake_dictionary_lexeme_amendment1.md`
 * §5). It looks at what directly follows the placeholder in the same entry:
 *
 * - `{{verb}}` and `{{iAdjective}}` hold a basic form, which ends a clause or
 *   modifies a noun. What follows is one of the eight (noun) placeholders, fixed
 *   text starting with a Han or Katakana character (a noun), one of
 *   `LEXICAL_NOUNS` followed by one of `LEXICAL_NOUN_TAILS` or the end of the
 *   text, or text starting with one of the closed followers below. Every other
 *   form (歩いた, 歩かない, 高かった, 高くて) is built on another stem, so its tail
 *   never follows a basic form.
 * - `{{naStem}}` holds a stem as written (静か). It is completed by fixed text:
 *   な before a noun (one of the eight placeholders, Han or Katakana, or a listed
 *   noun), に, さ before a noun tail, or one of `NA_STEM_FOLLOWERS`.
 *
 * None of them may end an entry: a core template is followed by an Optional
 * Clause written for any core text, so a placeholder's follower must be its own.
 *
 * The lists are the dictionary's own. Fake Alert keeps similar lists in its
 * own recipe schema for a different register (dialog lines, ます / です);
 * importing them would make the Fake Dictionary depend on Fake Alert, and moving
 * them to a shared place would change Fake Alert, which this slice leaves alone.
 */

import { isFakeDictionaryLexicalPlaceholder, isFakeDictionaryPlaceholder } from "./placeholders";
import type { CompiledTemplateSet, TemplateSegment } from "./template";

/** Nouns a basic form or a stem plus な may modify, when written in hiragana. */
export const LEXICAL_NOUNS = Object.freeze(["こと", "もの", "ところ", "ため", "はず", "わけ", "ほう", "とき", "さま"] as const);

/** What may follow one of `LEXICAL_NOUNS` (or a stem plus さ). */
export const LEXICAL_NOUN_TAILS = Object.freeze(["が", "を", "に", "は", "も", "で", "の", "と", "か", "だ", "や", "へ", "、", "。"] as const);

/** Fixed text that may follow a verb's basic form. Matched as a prefix, so each is written to differ from a tail that asks for another form. */
export const VERB_FOLLOWERS = Object.freeze(["と、", "という", "とされ", "ように", "ような", "ようだ", "まで", "だけ", "べき", "、", "。"] as const);

/** Fixed text that may follow an イ-adjective's basic form: as a verb's, but never べき or まで. */
export const I_ADJECTIVE_FOLLOWERS = Object.freeze(["と、", "という", "とされ", "ように", "ような", "ようだ", "だけ", "、", "。"] as const);

/** Fixed text that may follow a stem, besides な, に and さ (checked by shape). */
export const NA_STEM_FOLLOWERS = Object.freeze(["だ。", "だ、", "だった", "だとされ", "である", "であり", "でない", "で、", "すぎ", "、", "。"] as const);

export type LexicalFollowerIssue = {
	readonly code: "lexical-follower" | "lexical-at-end";
	readonly id: string;
	readonly detail: string;
};

const NOUN_SCRIPT = /^[\p{Script=Han}\p{Script=Katakana}]/u;

function startsWithAny(text: string, list: readonly string[]): boolean {
	return list.some((entry) => text.startsWith(entry));
}

/** Text that starts with a noun: Han or Katakana, or a listed noun alone or with a tail. */
function startsWithNoun(text: string): boolean {
	if (NOUN_SCRIPT.test(text)) return true;
	const tails: readonly string[] = LEXICAL_NOUN_TAILS;
	return LEXICAL_NOUNS.some((noun) => text.startsWith(noun) &&
		(text.length === noun.length || tails.includes(text.charAt(noun.length))));
}

function isNounSegment(segment: TemplateSegment | undefined): boolean {
	return segment?.kind === "placeholder" && isFakeDictionaryPlaceholder(segment.placeholder);
}

/** True when what follows (the rest of a text segment, then the next segment) is a noun. */
function nounFollows(rest: string, next: TemplateSegment | undefined): boolean {
	return rest === "" ? isNounSegment(next) : startsWithNoun(rest);
}

function fits(placeholder: string, following: TemplateSegment, after: TemplateSegment | undefined): boolean {
	if (following.kind === "placeholder") {
		// A basic form may stand directly before a noun placeholder; a stem never stands before anything bare.
		return placeholder !== "naStem" && isNounSegment(following);
	}
	const text = following.text;
	if (placeholder === "naStem") {
		if (text.startsWith("な")) return nounFollows(text.slice(1), after);
		if (text.startsWith("に")) return true;
		if (text.startsWith("さ")) {
			// さ makes the stem a noun (静かさ); the noun's tail is written with it.
			const tails: readonly string[] = LEXICAL_NOUN_TAILS;
			return tails.includes(text.charAt(1));
		}
		return startsWithAny(text, NA_STEM_FOLLOWERS);
	}
	if (startsWithNoun(text)) return true;
	return startsWithAny(text, placeholder === "verb" ? VERB_FOLLOWERS : I_ADJECTIVE_FOLLOWERS);
}

/** Every lexical placeholder whose follower the guard does not accept, in set order. */
export function checkLexicalFollowers(set: CompiledTemplateSet): readonly LexicalFollowerIssue[] {
	const issues: LexicalFollowerIssue[] = [];
	for (const entry of [...set.coreTemplates, ...set.optionalClauses]) {
		entry.segments.forEach((segment, index) => {
			if (segment.kind !== "placeholder" || !isFakeDictionaryLexicalPlaceholder(segment.placeholder)) return;
			const following = entry.segments[index + 1];
			if (following === undefined) {
				issues.push({ code: "lexical-at-end", id: entry.id, detail: segment.placeholder });
			} else if (!fits(segment.placeholder, following, entry.segments[index + 2])) {
				issues.push({ code: "lexical-follower", id: entry.id, detail: segment.placeholder });
			}
		});
	}
	return Object.freeze(issues);
}
