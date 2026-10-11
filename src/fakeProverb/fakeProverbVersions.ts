/**
 * PRE-RELEASE-FAKE-PROVERB-CORE1 versions. A pure leaf so later slices can
 * record them without importing the authority or the core.
 *
 * Algorithm 1 names what a draft means: the authority's candidate derivation
 * (safe independent nouns and the closed MAX realizer, bound per form), the
 * pairing, the ordered composition and the canonical text. Recipe schema and
 * data versions belong to the recipe set (`recipeData.ts` and the generated
 * entries) and are not restated here.
 *
 * Algorithm 2 (FAKE-PROVERB-NA1, `Docs/fake_proverb_na_amendment1.md`) adds the
 * ナ-adjective stem candidates (a stem plus な or に) to that derivation. The draw
 * itself is unchanged: a Vocabulary with no stem draws exactly as under
 * algorithm 1. The authority policy version names the candidate derivation and
 * moves with it; it is never persisted.
 */
export const FAKE_PROVERB_ALGORITHM_VERSION = 2;
export const FAKE_PROVERB_AUTHORITY_POLICY_VERSION = "fake-proverb-authority-2";
