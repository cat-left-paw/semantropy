/**
 * PRE-RELEASE-FAKE-PROVERB-VIEW1 production graph delta, relative to the
 * historical MAX-VIEW1 pin (`maxViewGraphs.json`). The current production graph
 * is pinned in full in `fakeProverbViewGraphs.json`; this states exactly what
 * connecting Fake Proverb and switching the live writer to metadata 4 changed.
 */
export const FAKE_PROVERB_VIEW_ADDED = [
	"src/collect/v4/CollectFragmentUseCaseV4.ts",
	"src/collect/v4/CollectedFragmentV4.ts",
	"src/collect/v4/FragmentRepositoryV4.ts",
	"src/collect/v4/collectDataV4.ts",
	"src/collect/v4/serializeFragmentV4.ts",
	"src/fakeProverb/compileRecipeSet.ts",
	"src/fakeProverb/fakeProverbAuthority.ts",
	"src/fakeProverb/fakeProverbBatch.ts",
	"src/fakeProverb/fakeProverbCore.ts",
	"src/fakeProverb/fakeProverbText.ts",
	"src/fakeProverb/fakeProverbVersions.ts",
	"src/fakeProverb/generated/standardFakeProverbRecipeEntries.ts",
	"src/fakeProverb/recipeData.ts",
	"src/view/FakeProverbModal.ts",
	"src/view/FakeProverbSession.ts",
] as const;

/** The metadata 3 use case and repository leave production; the v3 reader and serializer stay, as v4 delegates to them. */
export const FAKE_PROVERB_VIEW_REMOVED = [
	"src/collect/v3/CollectFragmentUseCaseV3.ts",
	"src/collect/v3/FragmentRepositoryV3.ts",
] as const;

export function applyFakeProverbViewDelta(graph: readonly string[]): string[] {
	const removed: readonly string[] = FAKE_PROVERB_VIEW_REMOVED;
	return [...graph.filter(path => !removed.includes(path)), ...FAKE_PROVERB_VIEW_ADDED].sort();
}
