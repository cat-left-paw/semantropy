import type { FragmentMetadata } from "./CollectedFragment";
import {
	serializeManualOverride,
	serializePathIdentity,
	serializeVocabularyProvenance,
} from "./collectProvenance";

/** Body keys in write order. Manual fields appear only when hasManualEdits is true. */
export const BODY_FRAGMENT_METADATA_KEY_ORDER = Object.freeze([
	"id",
	"metadataVersion",
	"type",
	"created",
	"algorithmVersion",
	"target",
	"vocabulary",
	"bodySemantropy",
	"hasManualEdits",
	"manualAlgorithmVersion",
	"manualOverrides",
] as const);

export const FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER = Object.freeze([
	"id",
	"metadataVersion",
	"type",
	"created",
	"algorithmVersion",
	"target",
	"vocabulary",
	"dictionarySemantropy",
	"templateId",
	"templateSetVersion",
] as const);

export const COLLISION_FRAGMENT_METADATA_KEY_ORDER = Object.freeze([
	"id",
	"metadataVersion",
	"type",
	"created",
	"algorithmVersion",
	"vocabulary",
	"patternId",
	"patternSetVersion",
	"batchId",
	"rowId",
] as const);

/**
 * Characters that could end the surrounding HTML comment early, or break a
 * line in a context that reads the file as script. `<` and `>` alone make
 * `-->`, `--!>` and a nested `<!--` impossible; `&` is escaped with them so no
 * entity can be assembled either. All three are legal JSON string escapes, so
 * the result still parses back to the original value.
 */
const COMMENT_UNSAFE = /[<>&\u2028\u2029]/g;

function escapeForHtmlComment(json: string): string {
	return json.replace(
		COMMENT_UNSAFE,
		(character) =>
			`\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}

function serializeBodyMetadata(metadata: Extract<FragmentMetadata, { type: "body" }>): Record<string, unknown> {
	const ordered: Record<string, unknown> = {
		id: metadata.id,
		metadataVersion: metadata.metadataVersion,
		type: metadata.type,
		created: metadata.created,
		algorithmVersion: metadata.algorithmVersion,
		target: serializePathIdentity(metadata.target),
		vocabulary: serializeVocabularyProvenance(metadata.vocabulary),
		bodySemantropy: metadata.bodySemantropy,
		hasManualEdits: metadata.hasManualEdits,
	};
	if (metadata.hasManualEdits) {
		ordered["manualAlgorithmVersion"] = metadata.manualAlgorithmVersion;
		ordered["manualOverrides"] = metadata.manualOverrides.map(serializeManualOverride);
	}
	return ordered;
}

function serializeFakeDictionaryMetadata(
	metadata: Extract<FragmentMetadata, { type: "fake-dictionary" }>,
): Record<string, unknown> {
	return {
		id: metadata.id,
		metadataVersion: metadata.metadataVersion,
		type: metadata.type,
		created: metadata.created,
		algorithmVersion: metadata.algorithmVersion,
		target: serializePathIdentity(metadata.target),
		vocabulary: serializeVocabularyProvenance(metadata.vocabulary),
		dictionarySemantropy: metadata.dictionarySemantropy,
		templateId: metadata.templateId,
		templateSetVersion: metadata.templateSetVersion,
	};
}

function serializeCollisionMetadata(
	metadata: Extract<FragmentMetadata, { type: "collision" }>,
): Record<string, unknown> {
	return {
		id: metadata.id,
		metadataVersion: metadata.metadataVersion,
		type: metadata.type,
		created: metadata.created,
		algorithmVersion: metadata.algorithmVersion,
		vocabulary: serializeVocabularyProvenance(metadata.vocabulary),
		patternId: metadata.patternId,
		patternSetVersion: metadata.patternSetVersion,
		batchId: metadata.batchId,
		rowId: metadata.rowId,
	};
}

/**
 * The metadata as it is written, in fixed key order.
 *
 * Type-specific keys that do not apply are omitted rather than written as
 * null. Extra properties on the metadata object never reach the comment.
 */
export function serializeFragmentMetadata(metadata: FragmentMetadata): string {
	const ordered =
		metadata.type === "body"
			? serializeBodyMetadata(metadata)
			: metadata.type === "fake-dictionary"
				? serializeFakeDictionaryMetadata(metadata)
				: serializeCollisionMetadata(metadata);
	return escapeForHtmlComment(JSON.stringify(ordered));
}

/** The whole comment line content, without indentation. */
export function fragmentMetadataComment(metadata: FragmentMetadata): string {
	return `<!-- semantropy: ${serializeFragmentMetadata(metadata)} -->`;
}
