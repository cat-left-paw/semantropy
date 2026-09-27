import { escapeFragmentMarkdown } from "../escapeFragmentMarkdown";
import { captureFragmentMetadataV3, type CollectedFragmentV3, type FragmentMetadataV3 } from "./CollectedFragmentV3";
import { exactCollectFields, guardCollectV3, ownCollectData, refuseCollectV3 } from "./collectDataV3";

export const BODY_FRAGMENT_METADATA_KEY_ORDER_V3 = Object.freeze([
	"id", "metadataVersion", "type", "created", "algorithmVersion", "target", "vocabulary", "bodySemantropy",
	"automaticPartsOfSpeech", "hasManualEdits", "manualAlgorithmVersion", "manualOverrides",
] as const);
export const FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER_V3 = Object.freeze([
	"id", "metadataVersion", "type", "created", "algorithmVersion", "target", "vocabulary", "dictionarySemantropy", "templateId", "templateSetVersion",
] as const);
export const COLLISION_FRAGMENT_METADATA_KEY_ORDER_V3 = Object.freeze([
	"id", "metadataVersion", "type", "created", "algorithmVersion", "vocabulary", "patternId", "patternSetVersion", "batchId", "rowId",
] as const);

/** Typed metadata serialization is a whitelist, not a result authentication API. */
export function serializeFragmentMetadataV3(metadata: FragmentMetadataV3): string {
	const copy = captureFragmentMetadataV3(metadata);
	return JSON.stringify(copy).replace(/[<>&\u2028\u2029]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
export function fragmentMetadataCommentV3(metadata: FragmentMetadataV3): string {
	return `<!-- semantropy: ${serializeFragmentMetadataV3(metadata)} -->`;
}
export function serializeFragmentEntryV3(fragment: CollectedFragmentV3): string {
	const captured = guardCollectV3(() => {
		const data = ownCollectData(fragment);
		exactCollectFields(data, ["text", "metadata"]);
		if (typeof data.text !== "string" || !data.text.trim()) refuseCollectV3("empty-text");
		return { text: data.text, metadata: data.metadata as FragmentMetadataV3 };
	});
	if (!captured.ok) throw new Error(captured.reason);
	const [first = "", ...rest] = escapeFragmentMarkdown(captured.value.text).split("\n");
	return [first ? `- ${first}` : "-", ...rest.map(line => line ? `  ${line}` : ""), `  ${fragmentMetadataCommentV3(captured.value.metadata)}`].join("\n") + "\n";
}
