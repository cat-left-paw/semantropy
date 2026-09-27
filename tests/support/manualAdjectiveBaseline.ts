import type { JapaneseToken } from "../../src/tokenizer/JapaneseTokenizer";
import type { ManualMorphCandidate, ManualMorphRejection } from "../../src/transform/manualMorphology";
import type { VocabularySnapshot, transformWithVocabularySnapshot } from "../../src/vocabulary/vocabularySnapshot";
import { readPinnedFixture } from "./pinnedFixture";

type FormerEvaluation =
	| { available: true; candidates: readonly ManualMorphCandidate[] }
	| { available: false; candidates: readonly ManualMorphCandidate[]; reason: ManualMorphRejection };
type Baseline = {
	format: number; origin: string; source: string; adjectiveSource: string;
	verbs: (FormerEvaluation & { index: number; target: JapaneseToken; next: JapaneseToken | null })[];
	targets: { text: string; tokens: JapaneseToken[]; targetSupported: boolean; result: FormerEvaluation }[];
	nounSource: string; nounTarget: string; snapshot: VocabularySnapshot;
	draws: { bodySeed: number; level: number; result: ReturnType<typeof transformWithVocabularySnapshot> }[];
};

/** Recorded outputs of the reviewed core, not executable private history. */
export const adjectiveBaseline = readPinnedFixture<Baseline>(
	"manualAdjectiveBaseline", "eb34cd424768d1985996449d7918116ca83d09b27e5d91963206c1facc895232",
);
export const adjectiveTargets = adjectiveBaseline.targets.map(row => row.text);
