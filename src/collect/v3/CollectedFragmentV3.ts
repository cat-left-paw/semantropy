import type { BodyFragmentInput, BodyFragmentMetadata, CollisionFragmentInput, CollisionFragmentMetadata,
	FakeDictionaryFragmentInput, FakeDictionaryFragmentMetadata } from "../CollectedFragment";
import { copyManualOverride, copyPathIdentity, copyVocabularyProvenance, freezeCollectValue, isCollectDrawMode,
	isCollectFingerprint, isCollectManualKind, isNonEmptyId, isNonNegativeSafeInteger, isPositiveSafeInteger,
	pathIdentityReason, type CollectManualOverrideRecord, type CollectPathIdentity, type CollectVocabularyProvenance } from "../collectProvenance";
import type { FragmentIdentity } from "../fragmentIdentity";
import { isFragmentCreated, isFragmentId } from "../fragmentIdentityValidation";
import { isSemantropyValue } from "../../settings/semantropyRange";
import type { BodySemantropy } from "../../settings/bodySemantropy";
import type { DictionarySemantropy } from "../../settings/dictionarySemantropy";
import { MAX_BODY_ALGORITHM_VERSION, MAX_FINGERPRINT_VERSION } from "../../transform/maxVersions";
import { readAutomaticPartsOfSpeech, type AutomaticPartOfSpeech } from "./automaticPartsOfSpeech";
import { exactCollectFields, guardCollectV3, ownCollectArray, ownCollectData, refuseCollectV3,
	type FragmentValidationReasonV3 } from "./collectDataV3";
export type { FragmentValidationReasonV3 } from "./collectDataV3";

/** Current writer version; legacy v2 types remain available for historical entries. */
export const COLLECT_METADATA_VERSION_V3 = 3 as const;
type Version3<T> = T extends unknown ? Omit<T, "metadataVersion"> & { readonly metadataVersion: typeof COLLECT_METADATA_VERSION_V3 } : never;
export type BodyFragmentInputV3 = Version3<BodyFragmentInput> & { readonly automaticPartsOfSpeech: readonly AutomaticPartOfSpeech[] };
export type FakeDictionaryFragmentInputV3 = Version3<FakeDictionaryFragmentInput>;
export type CollisionFragmentInputV3 = Version3<CollisionFragmentInput>;
export type CollectFragmentInputV3 = BodyFragmentInputV3 | FakeDictionaryFragmentInputV3 | CollisionFragmentInputV3;
export type BodyFragmentMetadataV3 = Version3<BodyFragmentMetadata> & { readonly automaticPartsOfSpeech: readonly AutomaticPartOfSpeech[] };
export type FakeDictionaryFragmentMetadataV3 = Version3<FakeDictionaryFragmentMetadata>;
export type CollisionFragmentMetadataV3 = Version3<CollisionFragmentMetadata>;
export type FragmentMetadataV3 = BodyFragmentMetadataV3 | FakeDictionaryFragmentMetadataV3 | CollisionFragmentMetadataV3;
export type CollectedFragmentV3 = { readonly text: string; readonly metadata: FragmentMetadataV3 };

const baseKeys = ["metadataVersion", "type", "text", "algorithmVersion", "vocabulary"];
const bodyKeys = ["target", "bodySemantropy", "automaticPartsOfSpeech", "hasManualEdits"];
const manualKeys = ["manualAlgorithmVersion", "manualOverrides"];
const dictionaryKeys = ["target", "dictionarySemantropy", "templateId", "templateSetVersion"];
const collisionKeys = ["patternId", "patternSetVersion", "batchId", "rowId"];
// MAX-VIEW1: the live Body writer is Body 11 with fingerprint format 3, one compatible pair.
// Existing Collection bytes are append-only and never re-read, so older entries are untouched.
const bodyFingerprint = new RegExp(`^${MAX_FINGERPRINT_VERSION}:[0-9a-f]{64}$`);

function readPath(value: unknown): CollectPathIdentity {
	const data = ownCollectData(value);
	exactCollectFields(data, ["path", "contentHash"]);
	const identity = data as CollectPathIdentity;
	const reason = pathIdentityReason(identity);
	if (reason) refuseCollectV3(reason);
	return copyPathIdentity(identity);
}
function readVocabulary(value: unknown, type: CollectFragmentInputV3["type"]): CollectVocabularyProvenance {
	const data = ownCollectData(value);
	exactCollectFields(data, ["sources", "fingerprint", "drawMode"]);
	const sources = ownCollectArray(data.sources, "invalid-vocabulary-sources").map(readPath);
	if (!sources.length || sources.some((source, index) => index > 0 && source.path <= sources[index - 1]!.path))
		refuseCollectV3("invalid-vocabulary-sources");
	const fingerprint = data.fingerprint;
	if (typeof fingerprint !== "string" || !(type === "body" ? bodyFingerprint.test(fingerprint) : isCollectFingerprint(fingerprint)))
		refuseCollectV3("invalid-fingerprint");
	if (!isCollectDrawMode(data.drawMode)) refuseCollectV3("invalid-draw-mode");
	return { sources, fingerprint, drawMode: data.drawMode };
}
function readOverrides(value: unknown): readonly CollectManualOverrideRecord[] {
	const items = ownCollectArray(value, "invalid-manual-edits"), seen = new Set<string>();
	if (!items.length) refuseCollectV3("invalid-manual-edits");
	return items.map(item => {
		const data = ownCollectData(item);
		exactCollectFields(data, ["tokenId", "kind", "localRevision"]);
		if (!isNonEmptyId(data.tokenId) || seen.has(data.tokenId) || !isCollectManualKind(data.kind) || !isNonNegativeSafeInteger(data.localRevision))
			refuseCollectV3("invalid-manual-edits");
		seen.add(data.tokenId);
		return { tokenId: data.tokenId, kind: data.kind, localRevision: data.localRevision };
	});
}

/** Structural validation and detached capture, never evidence of authenticated generation.
 * VIEW1 must supply the committed text, captured options and provenance together.
 */
export function readCollectFragmentInputV3(input: unknown) {
	return guardCollectV3<CollectFragmentInputV3>(() => {
		const data = ownCollectData(input);
		if (data.metadataVersion !== COLLECT_METADATA_VERSION_V3) refuseCollectV3("invalid-metadata-version");
		const type = data.type;
		if (type !== "body" && type !== "fake-dictionary" && type !== "collision") refuseCollectV3("invalid-fragment-fields");
		exactCollectFields(data, [...baseKeys, ...(type === "body" ? [...bodyKeys, ...(data.hasManualEdits === true ? manualKeys : [])] : type === "fake-dictionary" ? dictionaryKeys : collisionKeys)]);
		if (typeof data.text !== "string" || !data.text.trim()) refuseCollectV3("empty-text");
		if (!isPositiveSafeInteger(data.algorithmVersion)) refuseCollectV3("invalid-algorithm-version");
		const common = { metadataVersion: COLLECT_METADATA_VERSION_V3, text: data.text, algorithmVersion: data.algorithmVersion, vocabulary: readVocabulary(data.vocabulary, type) };
		if (type === "body") {
			if (data.algorithmVersion !== MAX_BODY_ALGORITHM_VERSION) refuseCollectV3("invalid-algorithm-version");
			const target = readPath(data.target);
			if (!isSemantropyValue(data.bodySemantropy)) refuseCollectV3("invalid-semantropy");
			const automaticPartsOfSpeech = readAutomaticPartsOfSpeech(data.automaticPartsOfSpeech);
			const body = { ...common, type: "body" as const, target, bodySemantropy: data.bodySemantropy as BodySemantropy, automaticPartsOfSpeech };
			if (data.hasManualEdits === false) return freezeCollectValue({ ...body, hasManualEdits: false });
			if (data.hasManualEdits !== true || !isPositiveSafeInteger(data.manualAlgorithmVersion)) refuseCollectV3("invalid-manual-edits");
			return freezeCollectValue({ ...body, hasManualEdits: true, manualAlgorithmVersion: data.manualAlgorithmVersion, manualOverrides: readOverrides(data.manualOverrides) });
		}
		if (type === "fake-dictionary") {
			const target = readPath(data.target);
			if (!isSemantropyValue(data.dictionarySemantropy)) refuseCollectV3("invalid-semantropy");
			if (!isNonEmptyId(data.templateId)) refuseCollectV3("invalid-template-id");
			if (!isPositiveSafeInteger(data.templateSetVersion)) refuseCollectV3("invalid-template-set-version");
			return freezeCollectValue({ ...common, type, target, dictionarySemantropy: data.dictionarySemantropy as DictionarySemantropy, templateId: data.templateId, templateSetVersion: data.templateSetVersion });
		}
		if (!isNonEmptyId(data.patternId)) refuseCollectV3("invalid-pattern-id");
		if (!isPositiveSafeInteger(data.patternSetVersion)) refuseCollectV3("invalid-pattern-set-version");
		if (!isNonEmptyId(data.batchId)) refuseCollectV3("invalid-batch-id");
		if (!isNonEmptyId(data.rowId)) refuseCollectV3("invalid-row-id");
		return freezeCollectValue({ ...common, type, patternId: data.patternId, patternSetVersion: data.patternSetVersion, batchId: data.batchId, rowId: data.rowId });
	});
}
export function validateFragmentInputV3(input: unknown): FragmentValidationReasonV3 | null {
	const result = readCollectFragmentInputV3(input);
	return result.ok ? null : result.reason;
}

/** Exact whitelist in canonical metadata order, shared by builder and serializer. */
function copyFragmentMetadataV3(input: CollectFragmentInputV3 | FragmentMetadataV3, identity: FragmentIdentity): FragmentMetadataV3 {
	const common = { id: identity.id, metadataVersion: COLLECT_METADATA_VERSION_V3, type: input.type, created: identity.created, algorithmVersion: input.algorithmVersion };
	if (input.type === "body") {
		const body = { ...common, type: input.type, target: copyPathIdentity(input.target), vocabulary: copyVocabularyProvenance(input.vocabulary), bodySemantropy: input.bodySemantropy,
			automaticPartsOfSpeech: [...input.automaticPartsOfSpeech], hasManualEdits: input.hasManualEdits };
		return input.hasManualEdits ? { ...body, hasManualEdits: true, manualAlgorithmVersion: input.manualAlgorithmVersion, manualOverrides: input.manualOverrides.map(copyManualOverride) } : { ...body, hasManualEdits: false };
	}
	if (input.type === "fake-dictionary") return { ...common, type: input.type, target: copyPathIdentity(input.target), vocabulary: copyVocabularyProvenance(input.vocabulary), dictionarySemantropy: input.dictionarySemantropy, templateId: input.templateId, templateSetVersion: input.templateSetVersion };
	return { ...common, type: input.type, vocabulary: copyVocabularyProvenance(input.vocabulary), patternId: input.patternId, patternSetVersion: input.patternSetVersion, batchId: input.batchId, rowId: input.rowId };
}
/** Invalid programmer input throws a fixed code; use case returns structured refusals. */
export function buildCollectedFragmentV3(input: CollectFragmentInputV3, identity: FragmentIdentity): CollectedFragmentV3 {
	const captured = readCollectFragmentInputV3(input);
	if (!captured.ok) throw new Error(captured.reason);
	return freezeCollectValue({ text: captured.value.text, metadata: copyFragmentMetadataV3(captured.value, captureFragmentIdentityV3(identity)) });
}

/** Revalidate supplied identities without issuing a UUID or reading the clock. */
export function captureFragmentIdentityV3(identity: unknown): FragmentIdentity {
	const result = guardCollectV3(() => {
		const data = ownCollectData(identity);
		exactCollectFields(data, ["id", "created"]);
		if (!isFragmentId(data.id) || !isFragmentCreated(data.created)) refuseCollectV3("invalid-fragment-fields");
		return Object.freeze({ id: data.id, created: data.created });
	});
	if (!result.ok) throw new Error(result.reason);
	return result.value;
}

function pick(data: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
	return Object.fromEntries(keys.map(key => [key, data[key]]));
}
function pickPath(value: unknown) { return pick(ownCollectData(value), ["path", "contentHash"]); }

/** Serializer boundary: discard extra data fields, reject accessors/prototypes,
 * and use the same semantic validator. Never call caller toJSON/array methods.
 */
export function captureFragmentMetadataV3(metadata: FragmentMetadataV3): FragmentMetadataV3 {
	const result = guardCollectV3(() => {
		const data = ownCollectData(metadata), type = data.type;
		const identity = captureFragmentIdentityV3({ id: data.id, created: data.created });
		if (type !== "body" && type !== "fake-dictionary" && type !== "collision") refuseCollectV3("invalid-fragment-fields");
		const input = pick(data, [...baseKeys, ...(type === "body" ? [...bodyKeys, ...(data.hasManualEdits === true ? manualKeys : [])] : type === "fake-dictionary" ? dictionaryKeys : collisionKeys)]);
		input.text = "metadata"; // Validation-only sentinel; never becomes collected text.
		const vocabulary = ownCollectData(data.vocabulary);
		input.vocabulary = { ...pick(vocabulary, ["fingerprint", "drawMode"]), sources: ownCollectArray(vocabulary.sources, "invalid-vocabulary-sources").map(pickPath) };
		if (type !== "collision") input.target = pickPath(data.target);
		if (type === "body" && data.hasManualEdits === true) input.manualOverrides = ownCollectArray(data.manualOverrides, "invalid-manual-edits").map(item => pick(ownCollectData(item), ["tokenId", "kind", "localRevision"]));
		const captured = readCollectFragmentInputV3(input);
		if (!captured.ok) refuseCollectV3(captured.reason);
		return freezeCollectValue(copyFragmentMetadataV3(captured.value, identity));
	});
	if (!result.ok) throw new Error(result.reason);
	return result.value;
}
