/**
 * PRE-RELEASE-FAKE-PROVERB-COLLECT1: Collect metadata 4. Production-disconnected.
 *
 * Metadata 4 is a new writer contract, not a change to metadata 3: the v3 modules,
 * the live v3 writer and every stored v2 / v3 entry stay as they are.
 *
 *   - `body`, `fake-dictionary` and `collision` keep exactly their v3 semantic
 *     fields. They are validated and captured by delegating to the reviewed v3
 *     reader and serializer capture on a copy labelled 3, then relabelled 4, so
 *     there is no second validator for them and their key order is v3's.
 *   - `fake-proverb` is new: algorithm, recipe data version, the actual proverb
 *     and gloss recipe IDs, BATCH1's batch and row identity, the Vocabulary
 *     provenance and the canonical text. It has no Target, so a Target-less
 *     Selected Notes Vocabulary is the ordinary case. It never carries typed
 *     bindings, rowSlotId, counts, shortfall, draft, pool, token, nonce or
 *     Source text.
 *
 * Everything here is structural validation and detached capture. It never
 * proves that a value is a genuine, committed generation result: VIEW1 must
 * obtain the row from BATCH1 (`readFakeProverbRow()`) and pass that capture.
 */

import type {
	BodyFragmentInputV3,
	BodyFragmentMetadataV3,
	CollisionFragmentInputV3,
	CollisionFragmentMetadataV3,
	FakeDictionaryFragmentInputV3,
	FakeDictionaryFragmentMetadataV3,
} from "../v3/CollectedFragmentV3";
import {
	buildCollectedFragmentV3,
	captureFragmentIdentityV3,
	captureFragmentMetadataV3,
	readCollectFragmentInputV3,
	type FragmentMetadataV3,
} from "../v3/CollectedFragmentV3";
import {
	copyPathIdentity,
	freezeCollectValue,
	isCollectDrawMode,
	isCollectFingerprint,
	isPositiveSafeInteger,
	pathIdentityReason,
	type CollectPathIdentity,
	type CollectVocabularyProvenance,
} from "../collectProvenance";
import type { FragmentIdentity } from "../fragmentIdentity";
import type { FakeProverbRowRecord } from "../../fakeProverb/fakeProverbBatch";
import { fakeProverbCanonicalText, isFakeProverbSafeText } from "../../fakeProverb/fakeProverbText";
import { FAKE_PROVERB_ALGORITHM_VERSION } from "../../fakeProverb/fakeProverbVersions";
import { FAKE_PROVERB_ID_MAX_LENGTH, FAKE_PROVERB_RECIPE_SCHEMA_VERSION } from "../../fakeProverb/recipeData";
import {
	exactCollectFieldsV4,
	guardCollectV4,
	ownCollectArrayV4,
	ownCollectDataV4,
	refuseCollectV4,
	type CollectReadResultV4,
	type FragmentValidationReasonV4,
} from "./collectDataV4";

export type { FragmentValidationReasonV4 } from "./collectDataV4";

export const COLLECT_METADATA_VERSION_V4 = 4 as const;

type Version4<T> = T extends unknown ? Omit<T, "metadataVersion"> & { readonly metadataVersion: typeof COLLECT_METADATA_VERSION_V4 } : never;

export type BodyFragmentInputV4 = Version4<BodyFragmentInputV3>;
export type FakeDictionaryFragmentInputV4 = Version4<FakeDictionaryFragmentInputV3>;
export type CollisionFragmentInputV4 = Version4<CollisionFragmentInputV3>;
export type FakeProverbFragmentInputV4 = {
	readonly metadataVersion: typeof COLLECT_METADATA_VERSION_V4;
	readonly type: "fake-proverb";
	/** The Collection body: byte-identical to `canonicalText`. */
	readonly text: string;
	readonly algorithmVersion: typeof FAKE_PROVERB_ALGORITHM_VERSION;
	readonly recipeDataVersion: number;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly proverbRecipeId: string;
	readonly glossRecipeId: string;
	readonly batchId: string;
	readonly rowId: string;
	readonly canonicalText: string;
};
export type CollectFragmentInputV4 = BodyFragmentInputV4 | FakeDictionaryFragmentInputV4 | CollisionFragmentInputV4 | FakeProverbFragmentInputV4;

export type BodyFragmentMetadataV4 = Version4<BodyFragmentMetadataV3>;
export type FakeDictionaryFragmentMetadataV4 = Version4<FakeDictionaryFragmentMetadataV3>;
export type CollisionFragmentMetadataV4 = Version4<CollisionFragmentMetadataV3>;
export type FakeProverbFragmentMetadataV4 = FragmentIdentity & Omit<FakeProverbFragmentInputV4, "text">;
export type FragmentMetadataV4 = BodyFragmentMetadataV4 | FakeDictionaryFragmentMetadataV4 | CollisionFragmentMetadataV4 | FakeProverbFragmentMetadataV4;
export type CollectedFragmentV4 = { readonly text: string; readonly metadata: FragmentMetadataV4 };

/** Input fields of a fake-proverb value, in canonical order. */
const fakeProverbInputKeys = ["metadataVersion", "type", "text", "algorithmVersion", "recipeDataVersion", "vocabulary",
	"proverbRecipeId", "glossRecipeId", "batchId", "rowId", "canonicalText"] as const;
/** The same lowercase kebab-case grammar Recipe Schema 1 compiles entry IDs with. */
const RECIPE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
/** BATCH1 batch and row identities: domain-separated SHA-256, lowercase hex. */
const BATCH_IDENTITY = /^[0-9a-f]{64}$/u;
const V3_TYPES: readonly string[] = ["body", "fake-dictionary", "collision"];

function isRecipeId(value: unknown): value is string {
	return typeof value === "string" && value.length <= FAKE_PROVERB_ID_MAX_LENGTH && RECIPE_ID.test(value);
}

/**
 * The canonical text of one proverb and gloss, and nothing else: exactly what
 * CORE1's single serializer produces from two halves that each pass the Fake
 * Proverb safe text grammar. The grammar excludes `*`, `>` and every line
 * break, so the split below is unambiguous.
 */
function isFakeProverbCanonicalText(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const empty = fakeProverbCanonicalText("", "");
	const opening = empty.slice(0, 2);
	const separator = empty.slice(2);
	if (!value.startsWith(opening)) return false;
	const at = value.indexOf(separator, opening.length);
	if (at < 0) return false;
	const proverb = value.slice(opening.length, at);
	const gloss = value.slice(at + separator.length);
	return isFakeProverbSafeText(proverb) && isFakeProverbSafeText(gloss) && fakeProverbCanonicalText(proverb, gloss) === value;
}

function readPath(value: unknown): CollectPathIdentity {
	const data = ownCollectDataV4(value);
	exactCollectFieldsV4(data, ["path", "contentHash"]);
	const identity = data as CollectPathIdentity;
	const reason = pathIdentityReason(identity);
	if (reason) refuseCollectV4(reason);
	return copyPathIdentity(identity);
}

/** Non-empty, strictly path-ordered Sources, a Vocabulary fingerprint (format 1) and a draw mode. */
function readVocabulary(value: unknown): CollectVocabularyProvenance {
	const data = ownCollectDataV4(value);
	exactCollectFieldsV4(data, ["sources", "fingerprint", "drawMode"]);
	const sources = ownCollectArrayV4(data["sources"], "invalid-vocabulary-sources").map(readPath);
	if (sources.length === 0 || sources.some((source, index) => index > 0 && source.path <= sources[index - 1]!.path)) {
		refuseCollectV4("invalid-vocabulary-sources");
	}
	if (!isCollectFingerprint(data["fingerprint"])) refuseCollectV4("invalid-fingerprint");
	if (!isCollectDrawMode(data["drawMode"])) refuseCollectV4("invalid-draw-mode");
	return { sources, fingerprint: data["fingerprint"], drawMode: data["drawMode"] };
}

function readFakeProverb(data: Record<string, unknown>): FakeProverbFragmentInputV4 {
	exactCollectFieldsV4(data, fakeProverbInputKeys);
	const text = data["text"];
	if (typeof text !== "string" || !text.trim()) refuseCollectV4("empty-text");
	if (data["algorithmVersion"] !== FAKE_PROVERB_ALGORITHM_VERSION) refuseCollectV4("invalid-algorithm-version");
	if (!isPositiveSafeInteger(data["recipeDataVersion"])) refuseCollectV4("invalid-recipe-data-version");
	const vocabulary = readVocabulary(data["vocabulary"]);
	const proverbRecipeId = data["proverbRecipeId"];
	const glossRecipeId = data["glossRecipeId"];
	if (!isRecipeId(proverbRecipeId) || !isRecipeId(glossRecipeId)) refuseCollectV4("invalid-recipe-id");
	const batchId = data["batchId"];
	const rowId = data["rowId"];
	if (typeof batchId !== "string" || !BATCH_IDENTITY.test(batchId)) refuseCollectV4("invalid-batch-id");
	if (typeof rowId !== "string" || !BATCH_IDENTITY.test(rowId) || rowId === batchId) refuseCollectV4("invalid-row-id");
	const canonicalText = data["canonicalText"];
	// Root text, Collection body and canonicalText are one committed value, byte for byte.
	if (canonicalText !== text) refuseCollectV4("canonical-text-mismatch");
	if (!isFakeProverbCanonicalText(canonicalText)) refuseCollectV4("invalid-canonical-text");
	return freezeCollectValue({ metadataVersion: COLLECT_METADATA_VERSION_V4, type: "fake-proverb" as const, text, algorithmVersion: FAKE_PROVERB_ALGORITHM_VERSION,
		recipeDataVersion: data["recipeDataVersion"], vocabulary, proverbRecipeId, glossRecipeId, batchId, rowId, canonicalText });
}

/** Keeps a v3 reason: the v3 builders and capture throw an Error whose message is the fixed code. */
function refuseFromV3(error: unknown): never {
	const reason = error instanceof Error && /^[a-z]+(?:-[a-z]+)*$/u.test(error.message) ? error.message : "invalid-fragment-fields";
	return refuseCollectV4(reason as FragmentValidationReasonV4);
}

/**
 * Structural validation and detached capture, never evidence of an
 * authenticated or committed result.
 */
export function readCollectFragmentInputV4(input: unknown): CollectReadResultV4<CollectFragmentInputV4> {
	return guardCollectV4<CollectFragmentInputV4>(() => {
		const data = ownCollectDataV4(input);
		if (data["metadataVersion"] !== COLLECT_METADATA_VERSION_V4) refuseCollectV4("invalid-metadata-version");
		if (data["type"] === "fake-proverb") return readFakeProverb(data);
		if (!V3_TYPES.includes(data["type"] as string)) refuseCollectV4("invalid-fragment-fields");
		// v3 semantics, by the v3 reader itself, on a detached copy labelled 3.
		const read = readCollectFragmentInputV3({ ...data, metadataVersion: 3 });
		if (!read.ok) refuseCollectV4(read.reason);
		return freezeCollectValue({ ...read.value, metadataVersion: COLLECT_METADATA_VERSION_V4 });
	});
}

export function validateFragmentInputV4(input: unknown): FragmentValidationReasonV4 | null {
	const result = readCollectFragmentInputV4(input);
	return result.ok ? null : result.reason;
}

/** Exact whitelist in canonical metadata order. Input is already captured. */
function copyFragmentMetadataV4(input: CollectFragmentInputV4, identity: FragmentIdentity): FragmentMetadataV4 {
	if (input.type === "fake-proverb") {
		return {
			id: identity.id, metadataVersion: COLLECT_METADATA_VERSION_V4, type: input.type, created: identity.created,
			algorithmVersion: input.algorithmVersion, recipeDataVersion: input.recipeDataVersion,
			vocabulary: { sources: input.vocabulary.sources.map(copyPathIdentity), fingerprint: input.vocabulary.fingerprint, drawMode: input.vocabulary.drawMode },
			proverbRecipeId: input.proverbRecipeId, glossRecipeId: input.glossRecipeId, batchId: input.batchId, rowId: input.rowId,
			canonicalText: input.canonicalText,
		};
	}
	// The v3 builder decides key order and copies; only the version label differs.
	const v3 = buildCollectedFragmentV3({ ...input, metadataVersion: 3 }, identity);
	return { ...v3.metadata, metadataVersion: COLLECT_METADATA_VERSION_V4 };
}

/** Invalid programmer input throws a fixed code; the use case returns structured refusals. */
export function buildCollectedFragmentV4(input: CollectFragmentInputV4, identity: FragmentIdentity): CollectedFragmentV4 {
	const captured = readCollectFragmentInputV4(input);
	if (!captured.ok) throw new Error(captured.reason);
	return freezeCollectValue({ text: captured.value.text, metadata: copyFragmentMetadataV4(captured.value, captureFragmentIdentityV3(identity)) });
}

function pick(data: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
	return Object.fromEntries(keys.map((key) => [key, data[key]]));
}

/**
 * Serializer boundary: extra data fields are discarded, accessors and foreign
 * prototypes are refused, and the same validators run again. Caller toJSON and
 * array methods are never called.
 */
export function captureFragmentMetadataV4(metadata: FragmentMetadataV4): FragmentMetadataV4 {
	const result = guardCollectV4(() => {
		const data = ownCollectDataV4(metadata);
		if (data["metadataVersion"] !== COLLECT_METADATA_VERSION_V4) refuseCollectV4("invalid-metadata-version");
		if (V3_TYPES.includes(data["type"] as string)) {
			let v3: FragmentMetadataV3;
			try {
				v3 = captureFragmentMetadataV3({ ...data, metadataVersion: 3 } as unknown as FragmentMetadataV3);
			} catch (error) {
				return refuseFromV3(error);
			}
			return freezeCollectValue({ ...v3, metadataVersion: COLLECT_METADATA_VERSION_V4 });
		}
		if (data["type"] !== "fake-proverb") refuseCollectV4("invalid-fragment-fields");
		let identity: FragmentIdentity;
		try {
			identity = captureFragmentIdentityV3({ id: data["id"], created: data["created"] });
		} catch (error) {
			return refuseFromV3(error);
		}
		const input = pick(data, fakeProverbInputKeys);
		// Validation-only: the stored text is the canonical text itself.
		input["text"] = data["canonicalText"];
		const vocabulary = ownCollectDataV4(data["vocabulary"]);
		input["vocabulary"] = {
			...pick(vocabulary, ["fingerprint", "drawMode"]),
			sources: ownCollectArrayV4(vocabulary["sources"], "invalid-vocabulary-sources").map((source) => pick(ownCollectDataV4(source), ["path", "contentHash"])),
		};
		return freezeCollectValue(copyFragmentMetadataV4(readFakeProverb(input), identity));
	});
	if (!result.ok) throw new Error(result.reason);
	return result.value;
}

/**
 * Converts the plain record BATCH1's `readFakeProverbRow()` returns into a
 * fake-proverb input. Structural only: it reads own data descriptors, keeps
 * exactly the metadata fields, drops what metadata must not carry (the recipe
 * schema version, which the recipe data version implies, and each Source's
 * projection policy) and validates the result. It does not authenticate the
 * record; obtaining it from a committed batch is VIEW1's job.
 */
export function fakeProverbFragmentInputFromRow(record: FakeProverbRowRecord): CollectReadResultV4<FakeProverbFragmentInputV4> {
	return guardCollectV4<FakeProverbFragmentInputV4>(() => {
		const data = ownCollectDataV4(record);
		exactCollectFieldsV4(data, ["batchId", "rowId", "algorithmVersion", "recipeSchemaVersion", "recipeDataVersion",
			"proverbRecipeId", "glossRecipeId", "canonicalText", "provenance"]);
		if (data["recipeSchemaVersion"] !== FAKE_PROVERB_RECIPE_SCHEMA_VERSION) refuseCollectV4("invalid-fragment-fields");
		const provenance = ownCollectDataV4(data["provenance"]);
		exactCollectFieldsV4(provenance, ["vocabularyFingerprint", "drawMode", "sources"]);
		const sources = ownCollectArrayV4(provenance["sources"], "invalid-vocabulary-sources").map((source) => {
			const item = ownCollectDataV4(source);
			exactCollectFieldsV4(item, ["path", "contentHash", "projectionPolicy"]);
			return { path: item["path"], contentHash: item["contentHash"] };
		});
		const read = readCollectFragmentInputV4({
			metadataVersion: COLLECT_METADATA_VERSION_V4, type: "fake-proverb", text: data["canonicalText"],
			algorithmVersion: data["algorithmVersion"], recipeDataVersion: data["recipeDataVersion"],
			vocabulary: { sources, fingerprint: provenance["vocabularyFingerprint"], drawMode: provenance["drawMode"] },
			proverbRecipeId: data["proverbRecipeId"], glossRecipeId: data["glossRecipeId"],
			batchId: data["batchId"], rowId: data["rowId"], canonicalText: data["canonicalText"],
		});
		if (!read.ok) refuseCollectV4(read.reason);
		return read.value as FakeProverbFragmentInputV4;
	});
}
