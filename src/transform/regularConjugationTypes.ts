/**
 * The single runtime source of truth for "which conjugation classes count as
 * regular".
 *
 * `manual-morph-2` decides which slots may be manually shuffled, and Collision
 * decides which lexemes may be inflected into finished surfaces. Those are
 * different questions, but both answer them from the same closed allowlists,
 * and a Collision slice must not be able to widen them. Keeping the names here
 * lets `src/transform/manualMorphology.ts` and `src/collision/regularInflection.ts`
 * import one definition instead of agreeing by convention.
 *
 * This module has no imports and no side effects on purpose: the Collision
 * lexeme builder is a leaf, and `manualMorphology.ts` reaches the Source
 * analyzer, so the shared constants cannot live there.
 *
 * Changing either list changes `manual-morph-2` semantics and requires a policy
 * review, not only a code change.
 */

/**
 * Regular 五段 classes and 一段. Irregular, archaic and single-lemma classes
 * (サ変・スル, カ変・クル, 五段・カ行促音便, 五段・ラ行特殊, 五段・ワ行ウ音便,
 * the 文語 classes) are out.
 */
export const REGULAR_VERB_CONJUGATION_TYPES = Object.freeze([
	"一段",
	"五段・カ行イ音便",
	"五段・ガ行",
	"五段・サ行",
	"五段・タ行",
	"五段・ナ行",
	"五段・バ行",
	"五段・マ行",
	"五段・ラ行",
	"五段・ワ行促音便",
] as const);

export type RegularVerbConjugationType =
	(typeof REGULAR_VERB_CONJUGATION_TYPES)[number];

/** The two regular イ-adjective classes. 形容詞・イイ and 不変化型 are out. */
export const REGULAR_ADJECTIVE_CONJUGATION_TYPES = Object.freeze([
	"形容詞・アウオ段",
	"形容詞・イ段",
] as const);

export type RegularAdjectiveConjugationType =
	(typeof REGULAR_ADJECTIVE_CONJUGATION_TYPES)[number];
