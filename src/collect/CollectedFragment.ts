import type { BodySemantropy } from "../settings/bodySemantropy";
import type { DictionarySemantropy } from "../settings/dictionarySemantropy";
import { isSemantropyValue } from "../settings/semantropyRange";
import type { FragmentIdentity } from "./fragmentIdentity";
import {
	COLLECT_METADATA_VERSION,
	copyManualOverride,
	copyPathIdentity,
	copyVocabularyProvenance,
	freezeCollectValue,
	isCollectManualKind,
	isNonEmptyId,
	isNonNegativeSafeInteger,
	isPositiveSafeInteger,
	pathIdentityReason,
	vocabularyProvenanceReason,
	type CollectManualOverrideRecord,
	type CollectMetadataVersion,
	type CollectPathIdentity,
	type CollectVocabularyProvenance,
} from "./collectProvenance";

export type { CollectManualOverrideRecord, CollectPathIdentity, CollectVocabularyProvenance };
export { COLLECT_METADATA_VERSION };

/** What Collect can be asked to save. */
export type FragmentType = "body" | "fake-dictionary" | "collision";

export type BodyFragmentInputAutomatic = {
	readonly type: "body";
	readonly text: string;
	readonly target: CollectPathIdentity;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly bodySemantropy: BodySemantropy;
	readonly algorithmVersion: number;
	readonly hasManualEdits: false;
};

export type BodyFragmentInputManual = {
	readonly type: "body";
	readonly text: string;
	readonly target: CollectPathIdentity;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly bodySemantropy: BodySemantropy;
	readonly algorithmVersion: number;
	readonly hasManualEdits: true;
	readonly manualAlgorithmVersion: number;
	readonly manualOverrides: readonly CollectManualOverrideRecord[];
};

/**
 * A fragment the user picked out of the transformed body.
 *
 * The body Semantropy value is named as such on purpose: it is a separate
 * setting from the Fake Dictionary one and must never be passed through a
 * shared field where the two could be confused. Internal generation state is
 * not a Collect field.
 */
export type BodyFragmentInput = BodyFragmentInputAutomatic | BodyFragmentInputManual;

/** A fragment the user picked out of a generated Fake Definition. */
export type FakeDictionaryFragmentInput = {
	readonly type: "fake-dictionary";
	readonly text: string;
	readonly target: CollectPathIdentity;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly dictionarySemantropy: DictionarySemantropy;
	readonly algorithmVersion: number;
	readonly templateId: string;
	readonly templateSetVersion: number;
};

/**
 * Writer-contract input for a Collision row. This slice does not generate
 * Collision results; the next slice consumes this shape.
 */
export type CollisionFragmentInput = {
	readonly type: "collision";
	readonly text: string;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly algorithmVersion: number;
	readonly patternId: string;
	readonly patternSetVersion: number;
	readonly batchId: string;
	readonly rowId: string;
};

export type CollectFragmentInput =
	| BodyFragmentInput
	| FakeDictionaryFragmentInput
	| CollisionFragmentInput;

type BodyFragmentMetadataShared = {
	readonly id: string;
	readonly metadataVersion: CollectMetadataVersion;
	readonly type: "body";
	readonly created: string;
	readonly algorithmVersion: number;
	readonly target: CollectPathIdentity;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly bodySemantropy: number;
};

export type BodyFragmentMetadataAutomatic = BodyFragmentMetadataShared & {
	readonly hasManualEdits: false;
};

export type BodyFragmentMetadataManual = BodyFragmentMetadataShared & {
	readonly hasManualEdits: true;
	readonly manualAlgorithmVersion: number;
	readonly manualOverrides: readonly CollectManualOverrideRecord[];
};

export type BodyFragmentMetadata =
	| BodyFragmentMetadataAutomatic
	| BodyFragmentMetadataManual;

export type FakeDictionaryFragmentMetadata = {
	readonly id: string;
	readonly metadataVersion: CollectMetadataVersion;
	readonly type: "fake-dictionary";
	readonly created: string;
	readonly algorithmVersion: number;
	readonly target: CollectPathIdentity;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly dictionarySemantropy: number;
	readonly templateId: string;
	readonly templateSetVersion: number;
};

export type CollisionFragmentMetadata = {
	readonly id: string;
	readonly metadataVersion: CollectMetadataVersion;
	readonly type: "collision";
	readonly created: string;
	readonly algorithmVersion: number;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly patternId: string;
	readonly patternSetVersion: number;
	readonly batchId: string;
	readonly rowId: string;
};

/**
 * The machine-readable part of a stored entry, as a discriminated union.
 *
 * Known fields are copied explicitly. Note body, token sequence, pool,
 * absolute path, generation nonce, Seed, Ruby reading and candidate records
 * are not Collect fields.
 */
export type FragmentMetadata =
	| BodyFragmentMetadata
	| FakeDictionaryFragmentMetadata
	| CollisionFragmentMetadata;

/** One entry: the text as the user selected it, plus its metadata. */
export type CollectedFragment = {
	readonly text: string;
	readonly metadata: FragmentMetadata;
};

export type FragmentValidationReason =
	| "empty-text"
	| "invalid-source-path"
	| "invalid-content-hash"
	| "invalid-semantropy"
	| "invalid-algorithm-version"
	| "invalid-template-id"
	| "invalid-template-set-version"
	| "invalid-pattern-id"
	| "invalid-pattern-set-version"
	| "invalid-batch-id"
	| "invalid-row-id"
	| "invalid-vocabulary-sources"
	| "invalid-fingerprint"
	| "invalid-draw-mode"
	| "invalid-manual-edits"
	| "invalid-fragment-fields"
	| "invalid-metadata-version";

function hasOwn(input: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(input, key);
}

function hasAny(input: object, keys: readonly string[]): boolean {
	return keys.some((key) => hasOwn(input, key));
}

const BODY_FORBIDDEN = [
	"templateId",
	"templateSetVersion",
	"patternId",
	"patternSetVersion",
	"batchId",
	"rowId",
	"dictionarySemantropy",
] as const;

const FAKE_DICTIONARY_FORBIDDEN = [
	"hasManualEdits",
	"manualAlgorithmVersion",
	"manualOverrides",
	"patternId",
	"patternSetVersion",
	"batchId",
	"rowId",
	"bodySemantropy",
] as const;

const COLLISION_FORBIDDEN = [
	"target",
	"bodySemantropy",
	"dictionarySemantropy",
	"templateId",
	"templateSetVersion",
	"hasManualEdits",
	"manualAlgorithmVersion",
	"manualOverrides",
] as const;

function metadataVersionReason(input: object): FragmentValidationReason | null {
	if (!hasOwn(input, "metadataVersion")) {
		return null;
	}
	return (input as { metadataVersion: unknown }).metadataVersion ===
		COLLECT_METADATA_VERSION
		? null
		: "invalid-metadata-version";
}

function validateManual(
	input: BodyFragmentInput,
): FragmentValidationReason | null {
	if (input.hasManualEdits !== true && input.hasManualEdits !== false) {
		return "invalid-manual-edits";
	}
	if (!input.hasManualEdits) {
		if (hasOwn(input, "manualAlgorithmVersion") || hasOwn(input, "manualOverrides")) {
			return "invalid-manual-edits";
		}
		return null;
	}
	if (!isPositiveSafeInteger(input.manualAlgorithmVersion)) {
		return "invalid-manual-edits";
	}
	if (!Array.isArray(input.manualOverrides) || input.manualOverrides.length === 0) {
		return "invalid-manual-edits";
	}
	const tokenIds = new Set<string>();
	const overrides: readonly unknown[] = input.manualOverrides;
	for (const item of overrides) {
		if (!item || typeof item !== "object") {
			return "invalid-manual-edits";
		}
		const override = item as CollectManualOverrideRecord;
		if (!isNonEmptyId(override.tokenId) || tokenIds.has(override.tokenId)) {
			return "invalid-manual-edits";
		}
		tokenIds.add(override.tokenId);
		if (!isCollectManualKind(override.kind)) {
			return "invalid-manual-edits";
		}
		if (!isNonNegativeSafeInteger(override.localRevision)) {
			return "invalid-manual-edits";
		}
	}
	return null;
}

/**
 * Checks an input before any identity is issued.
 *
 * Returns the first reason the input cannot be collected, or `null`. Reasons
 * are fixed labels: they never carry the fragment, the path, the hash or
 * generation state, so a caller can log or display one without leaking what
 * the user wrote.
 *
 * Text is judged only on whether it holds something other than whitespace. A
 * non-empty selection is never summarized, split into a sentence, or trimmed
 * for tidiness — what the user picked is what gets saved.
 */
export function validateFragmentInput(
	input: CollectFragmentInput,
): FragmentValidationReason | null {
	if (input.text.trim().length === 0) {
		return "empty-text";
	}
	const versionReason = metadataVersionReason(input);
	if (versionReason) {
		return versionReason;
	}
	if (!isPositiveSafeInteger(input.algorithmVersion)) {
		return "invalid-algorithm-version";
	}

	if (input.type === "body") {
		if (hasAny(input, BODY_FORBIDDEN)) {
			return hasOwn(input, "templateId") || hasOwn(input, "templateSetVersion")
				? "invalid-template-id"
				: "invalid-fragment-fields";
		}
		const targetReason = pathIdentityReason(input.target);
		if (targetReason) {
			return targetReason;
		}
		const vocabularyReason = vocabularyProvenanceReason(input.vocabulary);
		if (vocabularyReason) {
			return vocabularyReason;
		}
		if (!isSemantropyValue(input.bodySemantropy)) {
			return "invalid-semantropy";
		}
		return validateManual(input);
	}

	if (input.type === "fake-dictionary") {
		if (hasAny(input, FAKE_DICTIONARY_FORBIDDEN)) {
			return hasOwn(input, "hasManualEdits") ||
				hasOwn(input, "manualAlgorithmVersion") ||
				hasOwn(input, "manualOverrides")
				? "invalid-manual-edits"
				: "invalid-fragment-fields";
		}
		const targetReason = pathIdentityReason(input.target);
		if (targetReason) {
			return targetReason;
		}
		const vocabularyReason = vocabularyProvenanceReason(input.vocabulary);
		if (vocabularyReason) {
			return vocabularyReason;
		}
		if (!isSemantropyValue(input.dictionarySemantropy)) {
			return "invalid-semantropy";
		}
		if (!isNonEmptyId(input.templateId)) {
			return "invalid-template-id";
		}
		if (!isPositiveSafeInteger(input.templateSetVersion)) {
			return "invalid-template-set-version";
		}
		return null;
	}

	if (input.type !== "collision") {
		return "invalid-fragment-fields";
	}
	if (hasAny(input, COLLISION_FORBIDDEN)) {
		return "invalid-fragment-fields";
	}
	const vocabularyReason = vocabularyProvenanceReason(input.vocabulary);
	if (vocabularyReason) {
		return vocabularyReason;
	}
	if (!isNonEmptyId(input.patternId)) {
		return "invalid-pattern-id";
	}
	if (!isPositiveSafeInteger(input.patternSetVersion)) {
		return "invalid-pattern-set-version";
	}
	if (!isNonEmptyId(input.batchId)) {
		return "invalid-batch-id";
	}
	if (!isNonEmptyId(input.rowId)) {
		return "invalid-row-id";
	}
	return null;
}

function buildBodyMetadata(
	input: BodyFragmentInput,
	identity: FragmentIdentity,
): BodyFragmentMetadata {
	const shared = {
		id: identity.id,
		metadataVersion: COLLECT_METADATA_VERSION,
		type: "body" as const,
		created: identity.created,
		algorithmVersion: input.algorithmVersion,
		target: copyPathIdentity(input.target),
		vocabulary: copyVocabularyProvenance(input.vocabulary),
		bodySemantropy: input.bodySemantropy,
	};
	if (!input.hasManualEdits) {
		return freezeCollectValue({ ...shared, hasManualEdits: false as const });
	}
	return freezeCollectValue({
		...shared,
		hasManualEdits: true as const,
		manualAlgorithmVersion: input.manualAlgorithmVersion,
		manualOverrides: input.manualOverrides.map(copyManualOverride),
	});
}

/**
 * Builds one entry from a validated input and an issued identity.
 *
 * The identity is supplied, never invented here, so the same call with the
 * same identity always produces the same entry. Known fields are copied
 * explicitly so a cast extra property cannot reach stored metadata.
 */
export function buildCollectedFragment(
	input: CollectFragmentInput,
	identity: FragmentIdentity,
): CollectedFragment {
	let metadata: FragmentMetadata;
	if (input.type === "body") {
		metadata = buildBodyMetadata(input, identity);
	} else if (input.type === "fake-dictionary") {
		metadata = freezeCollectValue({
			id: identity.id,
			metadataVersion: COLLECT_METADATA_VERSION,
			type: "fake-dictionary" as const,
			created: identity.created,
			algorithmVersion: input.algorithmVersion,
			target: copyPathIdentity(input.target),
			vocabulary: copyVocabularyProvenance(input.vocabulary),
			dictionarySemantropy: input.dictionarySemantropy,
			templateId: input.templateId,
			templateSetVersion: input.templateSetVersion,
		});
	} else {
		metadata = freezeCollectValue({
			id: identity.id,
			metadataVersion: COLLECT_METADATA_VERSION,
			type: "collision" as const,
			created: identity.created,
			algorithmVersion: input.algorithmVersion,
			vocabulary: copyVocabularyProvenance(input.vocabulary),
			patternId: input.patternId,
			patternSetVersion: input.patternSetVersion,
			batchId: input.batchId,
			rowId: input.rowId,
		});
	}

	return freezeCollectValue({ text: input.text, metadata });
}
