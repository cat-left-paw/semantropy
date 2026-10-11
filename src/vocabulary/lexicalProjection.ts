/**
 * LEXEME-SHARE1: the regular verbs, イ-adjectives and ナ-adjective stems a
 * Vocabulary Snapshot holds, read from its Manual candidates
 * (`Docs/release_0_2_0_plan.md` §2.3).
 *
 * Fake Alert was the first to need these (FAKE-ALERT-VERB1, FAKE-ALERT-ADJ1);
 * this module is where they now come from, so Fake Proverb and the Fake
 * Dictionary can take the same sets later. It reads the Snapshot and nothing
 * else: no Source, no tokenizer, no inflection of its own. A verb or an
 * イ-adjective is given in its basic form by the closed `verb-basic` /
 * `adjective-basic` rule of the MAX realizer, which refuses an irregular or
 * unadmitted lexeme (ある, する, 来る, 行く, いい …), a dictionary artifact and
 * an unknown word. A ナ-adjective stem is an eligible noun the dictionary marks
 * 形容動詞語幹, as written, less the stems that cannot take な.
 *
 * A record of the Snapshot is one observed form (歩い, 歩き, 歩く). Each list
 * merges by surface, so the forms of one lexeme are one entry with all their
 * counts and every origin, in record order; the lists are in canonical surface
 * order. Nothing is cached here and nothing touches the Snapshot's shape or
 * fingerprint: a caller that keeps a list keeps it outside the Snapshot.
 */

import type { VocabularyOrigin } from "../analysis/rubyVocabulary";
import { maxSlotClassOf, realizeMaxLexeme } from "../transform/maxRealizer";
import type { ManualVocabularyCandidate, VocabularySnapshot } from "./vocabularySnapshot";

/**
 * 形容動詞語幹 that never take な: the dictionary lists each as a 連体詞 too, so it
 * modifies a noun as it is (こんな問題, 同じ問題). The set is every surface the
 * shipped dictionary gives both classes, pinned against it by a distribution test.
 */
export const NA_STEM_EXCLUDED: readonly string[] = Object.freeze(["おんなじ", "こんな", "そんな", "どんな", "同じ"]);

/** One word of a list: its surface, the counts of every record merged into it and their origins. */
export type LexicalForm = {
	readonly surface: string;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
};

type Snapshot = Pick<VocabularySnapshot, "projections">;
type Counted = { readonly surface: string; readonly frequency: number; readonly origins: readonly VocabularyOrigin[] };

/** Merges by surface, keeping record order within a surface, and sorts by surface. */
function merged(entries: readonly Counted[]): readonly LexicalForm[] {
	const bySurface = new Map<string, { frequency: number; origins: VocabularyOrigin[] }>();
	for (const entry of entries) {
		const form = bySurface.get(entry.surface) ?? { frequency: 0, origins: [] };
		form.frequency += entry.frequency;
		form.origins.push(...entry.origins);
		bySurface.set(entry.surface, form);
	}
	return Object.freeze([...bySurface].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([surface, form]) => Object.freeze({ surface, frequency: form.frequency, origins: Object.freeze(form.origins) })));
}

function basicFormsOf(candidates: readonly ManualVocabularyCandidate[], slotClass: "verb" | "i-adjective", key: "verb-basic" | "adjective-basic"): readonly LexicalForm[] {
	const forms: Counted[] = [];
	for (const record of candidates) {
		const token = record.morphology;
		if (token.isUnknown || maxSlotClassOf(token) !== slotClass) continue;
		const realized = realizeMaxLexeme(key, {
			pos: token.pos, detail1: token.detail1, conjugationType: token.conjugationType, baseForm: token.baseForm, isUnknown: false,
		});
		if (realized.realized) forms.push({ surface: realized.surface, frequency: record.frequency, origins: record.origins });
	}
	return merged(forms);
}

/** The regular verbs the Snapshot holds, each in its basic form. The set Collision offers as its Predicates. */
export function regularVerbBasicForms(snapshot: Snapshot): readonly LexicalForm[] {
	return basicFormsOf(snapshot.projections.manual.candidates, "verb", "verb-basic");
}

/** The regular イ-adjectives the Snapshot holds, each in its basic form. The set Collision offers as its イ-adjective Modifiers. */
export function iAdjectiveBasicForms(snapshot: Snapshot): readonly LexicalForm[] {
	return basicFormsOf(snapshot.projections.manual.candidates, "i-adjective", "adjective-basic");
}

/**
 * The ナ-adjective stems the Snapshot holds: its eligible nouns the dictionary
 * marks 形容動詞語幹, as written. Each stays a noun as well. A stem that cannot
 * take な is left out: one that ends in な, and the ones in `NA_STEM_EXCLUDED`.
 * The set is otherwise the one Collision offers with な.
 */
export function naAdjectiveStems(snapshot: Snapshot): readonly LexicalForm[] {
	return merged(snapshot.projections.manual.candidates.filter((record) => record.collisionRole === "noun" && record.morphology.detail1 === "形容動詞語幹" &&
		!record.surface.endsWith("な") && !NA_STEM_EXCLUDED.includes(record.surface)));
}
