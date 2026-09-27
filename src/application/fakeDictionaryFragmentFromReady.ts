import type { FakeDictionaryFragmentInput } from "../collect/CollectedFragment";
import { copyPathIdentity, copyVocabularyProvenance } from "../collect/collectProvenance";
import { assertDictionarySemantropy } from "../settings/dictionarySemantropy";
import type { FakeDictionaryCurrent } from "./fakeDictionaryWorld";

/**
 * PRE-RELEASE-EXPERIENCE-DICTIONARY-OUTPUT1: the one text Fake Dictionary Copy
 * and Collect both write.
 *
 * Plain text: the displayed headword, one LF, the generated definition — both
 * taken from the same committed Fake Dictionary current, so the Modal and the
 * hover Popover, a cache hit and a definition reshuffle all produce it from
 * one object and never from two moments. No reading, part of speech, Markdown
 * or DOM decoration is added. Null when nothing was generated, which callers
 * treat as "nothing to write".
 */
export function fakeDictionaryCanonicalText(current: FakeDictionaryCurrent): string | null {
	if (current.result.outcome !== "generated") return null;
	return `${current.headword.surface}\n${current.result.definition}`;
}

/**
 * Builds the Collect input for the Fake Definition currently on screen.
 *
 * The text is `fakeDictionaryCanonicalText()`, byte for byte what Copy writes.
 * Target, Vocabulary provenance, Dictionary Semantropy, algorithm version,
 * template id and template set version were frozen onto the committed
 * definition when it was generated — never reconstructed from the View's later
 * Snapshot. Body Semantropy, tokens, the pool, the note body and internal
 * generation state are not fields of this input.
 */
export function fakeDictionaryFragmentFromCurrent(
	current: FakeDictionaryCurrent,
): FakeDictionaryFragmentInput | null {
	const text = fakeDictionaryCanonicalText(current);
	if (text === null || current.result.outcome !== "generated") {
		return null;
	}
	return {
		type: "fake-dictionary",
		text,
		target: copyPathIdentity({
			path: current.snapshot.sourcePath,
			contentHash: current.snapshot.contentHash,
		}),
		vocabulary: copyVocabularyProvenance(current.vocabulary),
		dictionarySemantropy: assertDictionarySemantropy(
			current.dictionarySemantropy,
		),
		algorithmVersion: current.result.algorithmVersion,
		templateId: current.result.templateId,
		templateSetVersion: current.result.templateSetVersion,
	};
}
