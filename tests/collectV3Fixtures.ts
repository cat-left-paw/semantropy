import type { BodyFragmentInputV3, CollectFragmentInputV3 } from "../src/collect/v3/CollectedFragmentV3";
import { buildCollectedFragmentV3 } from "../src/collect/v3/CollectedFragmentV3";
import { bodyCollectInput, collisionCollectInput, collectVocabulary, dictionaryCollectInput, COLLECT_FIXTURE_ID, COLLECT_FIXTURE_CREATED } from "./collectFixtures";

export const identityV3 = { id: COLLECT_FIXTURE_ID, created: COLLECT_FIXTURE_CREATED };
export function bodyV3(overrides: Partial<BodyFragmentInputV3> = {}): BodyFragmentInputV3 {
	return { ...bodyCollectInput(), metadataVersion: 3, algorithmVersion: 11, automaticPartsOfSpeech: ["noun"],
		vocabulary: collectVocabulary(["a.md", "b.md", "c.md"], { fingerprint: `vocabulary-fingerprint-sha256-3:${"ab".repeat(32)}` }), ...overrides } as BodyFragmentInputV3;
}
export function inputsV3(): CollectFragmentInputV3[] {
	return [bodyV3(), { ...dictionaryCollectInput(), metadataVersion: 3, vocabulary: collectVocabulary(["a.md", "b.md", "c.md"]) },
		{ ...collisionCollectInput(), metadataVersion: 3, patternSetVersion: 2, vocabulary: collectVocabulary(["a.md", "b.md", "c.md"]) }];
}
export function fragmentV3(input: CollectFragmentInputV3 = bodyV3()) { return buildCollectedFragmentV3(input, identityV3); }
