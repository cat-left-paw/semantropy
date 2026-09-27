import { COLLECT_METADATA_VERSION } from "../src/collect/CollectedFragment";
import type {
	BodyFragmentInput,
	CollisionFragmentInput,
	FakeDictionaryFragmentInput,
	FragmentMetadata,
} from "../src/collect/CollectedFragment";
import type {
	CollectPathIdentity,
	CollectVocabularyProvenance,
} from "../src/collect/collectProvenance";
import { VOCABULARY_FINGERPRINT_VERSION } from "../src/vocabulary/vocabularySnapshot";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";

export const COLLECT_FIXTURE_HASH = "ab".repeat(32);
export const COLLECT_FIXTURE_FINGERPRINT = `${VOCABULARY_FINGERPRINT_VERSION}:${COLLECT_FIXTURE_HASH}`;
export const COLLECT_FIXTURE_ID = "11111111-2222-4333-8444-555555555555";
export const COLLECT_FIXTURE_CREATED = "2026-09-05T12:34:56.000Z";

export function collectPath(
	path: string,
	contentHash: string = COLLECT_FIXTURE_HASH,
): CollectPathIdentity {
	return { path, contentHash };
}

export function collectVocabulary(
	paths: readonly string[] = ["n.md"],
	options: Partial<CollectVocabularyProvenance> = {},
): CollectVocabularyProvenance {
	const sources = [...paths]
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
		.map((path) => collectPath(path, options.sources?.find((source) => source.path === path)?.contentHash));
	return {
		sources: options.sources ?? sources,
		fingerprint: options.fingerprint ?? COLLECT_FIXTURE_FINGERPRINT,
		drawMode: options.drawMode ?? "uniform",
	};
}

export function bodyCollectInput(
	overrides: Partial<BodyFragmentInput> = {},
): BodyFragmentInput {
	return {
		type: "body",
		text: "おかき的な自殺",
		target: collectPath("桜桃.md"),
		vocabulary: collectVocabulary(["桜桃.md"]),
		bodySemantropy: assertBodySemantropy(50),
		algorithmVersion: 9,
		hasManualEdits: false,
		...overrides,
	} as BodyFragmentInput;
}

export function dictionaryCollectInput(
	overrides: Partial<FakeDictionaryFragmentInput> = {},
): FakeDictionaryFragmentInput {
	return {
		type: "fake-dictionary",
		text: "幸福：通常三人以上では行わない移動方法。",
		target: collectPath("folder/note.md", "b".repeat(64)),
		vocabulary: collectVocabulary(["folder/note.md"], {
			sources: [collectPath("folder/note.md", "b".repeat(64))],
		}),
		dictionarySemantropy: assertDictionarySemantropy(75),
		algorithmVersion: 1,
		templateId: "core-noun-1",
		templateSetVersion: 1,
		...overrides,
	};
}

export function collisionCollectInput(
	overrides: Partial<CollisionFragmentInput> = {},
): CollisionFragmentInput {
	return {
		type: "collision",
		text: "夜光階段を観測する",
		vocabulary: collectVocabulary(["vocab-a.md", "vocab-b.md"]),
		algorithmVersion: 1,
		patternId: "noun-sahen-1",
		patternSetVersion: 1,
		batchId: "batch-1",
		rowId: "row-1",
		...overrides,
	};
}

export function bodyCollectMetadata(
	overrides: Partial<Extract<FragmentMetadata, { type: "body" }>> = {},
): Extract<FragmentMetadata, { type: "body" }> {
	return {
		id: COLLECT_FIXTURE_ID,
		metadataVersion: COLLECT_METADATA_VERSION,
		type: "body",
		created: COLLECT_FIXTURE_CREATED,
		algorithmVersion: 9,
		target: collectPath("桜桃.md"),
		vocabulary: collectVocabulary(["桜桃.md"]),
		bodySemantropy: 50,
		hasManualEdits: false,
		...overrides,
	} as Extract<FragmentMetadata, { type: "body" }>;
}
