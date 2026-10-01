import { escapeFragmentMarkdown } from "../escapeFragmentMarkdown";
import {
	BODY_FRAGMENT_METADATA_KEY_ORDER_V3,
	COLLISION_FRAGMENT_METADATA_KEY_ORDER_V3,
	FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER_V3,
} from "../v3/serializeFragmentV3";
import { captureFragmentMetadataV4, type CollectedFragmentV4, type FragmentMetadataV4 } from "./CollectedFragmentV4";
import { exactCollectFieldsV4, guardCollectV4, ownCollectDataV4, refuseCollectV4 } from "./collectDataV4";
import { attributionMarkdown, type CollectAttributionSnapshot } from "./collectAttribution";

/** v4 keeps v3's key order for the three v3 types; only the version value differs. */
export const BODY_FRAGMENT_METADATA_KEY_ORDER_V4 = BODY_FRAGMENT_METADATA_KEY_ORDER_V3;
export const FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER_V4 = FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER_V3;
export const COLLISION_FRAGMENT_METADATA_KEY_ORDER_V4 = COLLISION_FRAGMENT_METADATA_KEY_ORDER_V3;
export const RECOMPOSE_FRAGMENT_METADATA_KEY_ORDER_V5 = Object.freeze([
	"id", "metadataVersion", "type", "created", "algorithmVersion", "method", "leapMin", "leapMax", "vocabulary",
] as const);
export const FAKE_PROVERB_FRAGMENT_METADATA_KEY_ORDER_V4 = Object.freeze([
	"id", "metadataVersion", "type", "created", "algorithmVersion", "recipeDataVersion", "vocabulary",
	"proverbRecipeId", "glossRecipeId", "batchId", "rowId", "canonicalText",
] as const);

/**
 * The same comment-safe escaping the v3 serializer applies: `<`, `>`, `&` and
 * the two JavaScript line separators become `\uXXXX` in the JSON, so metadata
 * can never close or open an HTML comment. Built from code points so no raw
 * separator character appears in this source.
 */
const COMMENT_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "gu");
const BACKSLASH = String.fromCharCode(92);
const NEWLINE = String.fromCharCode(10);

/** Typed metadata serialization is a whitelist, not a result authentication API. */
export function serializeFragmentMetadataV4(metadata: FragmentMetadataV4): string {
	const copy = captureFragmentMetadataV4(metadata);
	return JSON.stringify(copy).replace(COMMENT_UNSAFE, (character) => `${BACKSLASH}u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function fragmentMetadataCommentV4(metadata: FragmentMetadataV4): string {
	return `<!-- semantropy: ${serializeFragmentMetadataV4(metadata)} -->`;
}

/**
 * The Collection body of one entry.
 *
 * `body`, `fake-dictionary`, `collision` and `recompose` keep the existing
 * literal contract: every ASCII punctuation character is escaped, so the text is
 * shown as typed.
 *
 * `fake-proverb` is written as its canonical Markdown, the same bytes Copy uses
 * (Fake Proverb Policy 1 §5 and §8), so the Collection shows the proverb in bold
 * and the gloss as a quote. This is only safe because the value has already
 * passed `captureFragmentMetadataV4()`: it is exactly what CORE1's serializer
 * builds from two halves that each satisfy the Fake Proverb safe text grammar,
 * which admits no ASCII punctuation, whitespace, line break, control, format or
 * separator character. The only markup in it is therefore the serializer's own
 * `**`, blank line and `> `; no link, tag, embed, HTML, code, heading or list
 * can be formed from a half. Any other value was refused before this point.
 */
function entryBody(metadata: FragmentMetadataV4, text: string): string {
	return metadata.type === "fake-proverb" ? metadata.canonicalText : escapeFragmentMarkdown(text);
}

/**
 * One new Collection entry: the body as a list item, and no metadata comment.
 *
 * COLLECT-COMMENT1: `fragmentMetadataCommentV4` still builds the historical
 * comment, and this function still runs the metadata capture before writing.
 * The file receives the Markdown body, then only the attribution lines whose
 * items were on when this entry was queued. For fake-proverb that body must be
 * byte-identical to the metadata's canonical text. With no attribution lines
 * the bytes match COLLECT-COMMENT1.
 */
export function serializeFragmentEntryV4(fragment: CollectedFragmentV4, attribution?: CollectAttributionSnapshot): string {
	const captured = guardCollectV4(() => {
		const data = ownCollectDataV4(fragment);
		exactCollectFieldsV4(data, ["text", "metadata"]);
		if (typeof data["text"] !== "string" || !data["text"].trim()) refuseCollectV4("empty-text");
		return { text: data["text"], metadata: data["metadata"] as FragmentMetadataV4 };
	});
	if (!captured.ok) throw new Error(captured.reason);
	const metadata = captureFragmentMetadataV4(captured.value.metadata);
	if (metadata.type === "fake-proverb" && metadata.canonicalText !== captured.value.text) throw new Error("canonical-text-mismatch");
	const [first = "", ...rest] = entryBody(metadata, captured.value.text).split(NEWLINE);
	const item = [first ? `- ${first}` : "-", ...rest.map((line) => (line ? `  ${line}` : ""))].join(NEWLINE) + NEWLINE;
	const lines = attribution ? attributionMarkdown(metadata, attribution) : [];
	if (lines.length === 0) return item;
	// Explicit Markdown hard breaks keep each field separate even with Obsidian's
	// Strict line breaks enabled. The final line needs no break marker.
	return `${item}${NEWLINE}${lines.map((line, index) => `  ${line}${index < lines.length - 1 ? "  " : ""}`).join(NEWLINE)}${NEWLINE}`;
}
