import {
	buildCollectedFragmentV4,
	type CollectFragmentInputV4,
	type FakeProverbFragmentInputV4,
} from "../src/collect/v4/CollectedFragmentV4";
import { fakeProverbCanonicalText } from "../src/fakeProverb/fakeProverbText";
import { collectVocabulary } from "./collectFixtures";
import { identityV3, inputsV3 } from "./collectV3Fixtures";

export const identityV4 = identityV3;
export const FIXTURE_BATCH_ID = "1a".repeat(32);
export const FIXTURE_ROW_ID = "2b".repeat(32);
export const FIXTURE_CANONICAL = fakeProverbCanonicalText("猫に小判", "猫が小判において月を見ることのたとえ。");

/** Target-less, three Vocabulary Sources: the Selected Notes shape. */
export function fakeProverbV4(overrides: Partial<Record<keyof FakeProverbFragmentInputV4, unknown>> = {}): FakeProverbFragmentInputV4 {
	return {
		metadataVersion: 4,
		type: "fake-proverb",
		text: FIXTURE_CANONICAL,
		algorithmVersion: 1,
		recipeDataVersion: 1,
		vocabulary: collectVocabulary(["a.md", "b.md", "c.md"]),
		proverbRecipeId: "offered-to",
		glossRecipeId: "misplaced-purpose",
		batchId: FIXTURE_BATCH_ID,
		rowId: FIXTURE_ROW_ID,
		canonicalText: FIXTURE_CANONICAL,
		...overrides,
	} as FakeProverbFragmentInputV4;
}

/** The three v3 types relabelled 4, with exactly their v3 fields. */
export function v3TypesV4(): CollectFragmentInputV4[] {
	return inputsV3().map((input) => ({ ...input, metadataVersion: 4 }));
}
export function inputsV4(): CollectFragmentInputV4[] {
	return [...v3TypesV4(), fakeProverbV4()];
}
export function fragmentV4(input: CollectFragmentInputV4 = fakeProverbV4()) {
	return buildCollectedFragmentV4(input, identityV4);
}
