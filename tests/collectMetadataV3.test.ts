import { describe, expect, it, vi } from "vitest";
import { COLLECT_METADATA_VERSION } from "../src/collect/collectProvenance";
import { COLLECT_METADATA_VERSION_V3, buildCollectedFragmentV3, readCollectFragmentInputV3, validateFragmentInputV3, type CollectFragmentInputV3, type FragmentMetadataV3, type CollectedFragmentV3 } from "../src/collect/v3/CollectedFragmentV3";
import { automaticPartsOfSpeechFromOptions } from "../src/collect/v3/automaticPartsOfSpeech";
import { collectFragmentV3 } from "../src/collect/v3/CollectFragmentUseCaseV3";
import { BODY_FRAGMENT_METADATA_KEY_ORDER_V3, FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER_V3, COLLISION_FRAGMENT_METADATA_KEY_ORDER_V3,
	serializeFragmentEntryV3, serializeFragmentMetadataV3, fragmentMetadataCommentV3 } from "../src/collect/v3/serializeFragmentV3";
import { escapeFragmentMarkdown } from "../src/collect/escapeFragmentMarkdown";
import { bodyV3, inputsV3, fragmentV3, identityV3 } from "./collectV3Fixtures";

it("introduces only the separate metadata version 3", () => {
	expect(COLLECT_METADATA_VERSION).toBe(2); expect(COLLECT_METADATA_VERSION_V3).toBe(3);
	for (const input of inputsV3()) expect(fragmentV3(input).metadata.metadataVersion).toBe(3);
});
it.each(Array.from({ length: 16 }, (_, mask) => mask))("converts option combination %i to its canonical set", mask => {
	const values = [0, 1, 2, 3].map(bit => Boolean(mask & (1 << bit)));
	const result = automaticPartsOfSpeechFromOptions({ noun: values[0]!, verb: values[1]!, iAdjective: values[2]!, adverb: values[3]! });
	expect(result).toEqual({ ok: true, value: ["noun", "verb", "i-adjective", "adverb"].filter((_, index) => values[index]) });
	if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
});
it("round-trips all OFF as an empty set", () => {
	const result = automaticPartsOfSpeechFromOptions({ noun: false, verb: false, iAdjective: false, adverb: false });
	expect(result).toEqual({ ok: true, value: [] });
	if (!result.ok) throw new Error("fixture");
	const serialized = serializeFragmentMetadataV3(fragmentV3(bodyV3({ automaticPartsOfSpeech: result.value })).metadata);
	const metadata = JSON.parse(serialized) as Record<string, unknown>;
	expect(metadata.automaticPartsOfSpeech).toEqual([]);
	const { id: _id, created: _created, ...fields } = metadata;
	expect(readCollectFragmentInputV3({ ...fields, text: "本文" })).toMatchObject({ ok: true, value: { automaticPartsOfSpeech: [] } });
});
it("rejects a noncanonical parts order", () => {
	expect(validateFragmentInputV3(bodyV3({ automaticPartsOfSpeech: ["verb", "noun"] }))).toBe("invalid-automatic-parts-of-speech");
});
it("rejects duplicate parts", () => {
	expect(validateFragmentInputV3(bodyV3({ automaticPartsOfSpeech: ["noun", "noun"] }))).toBe("invalid-automatic-parts-of-speech");
});
it.each(["noun", { noun: true, verb: false, iAdjective: false, adverb: false }, ["unknown"], ["iAdjective"], null, ["adverb", "verb"]])("rejects malformed parts %j", parts => {
	expect(validateFragmentInputV3({ ...bodyV3(), automaticPartsOfSpeech: parts })).toBe("invalid-automatic-parts-of-speech");
});
it("writes the exact Body keys with automatic parts before Manual fields", () => {
	for (const input of [bodyV3(), bodyV3({ hasManualEdits: true, manualAlgorithmVersion: 1, manualOverrides: [{ tokenId: "t1", kind: "replacement", localRevision: 3 }, { tokenId: "t2", kind: "restore-original", localRevision: 0 }] })]) {
		const metadata = fragmentV3(input).metadata;
		const expected = input.hasManualEdits ? [...BODY_FRAGMENT_METADATA_KEY_ORDER_V3] : BODY_FRAGMENT_METADATA_KEY_ORDER_V3.slice(0, -2);
		expect(Object.keys(metadata)).toEqual(expected);
		expect(Object.keys(JSON.parse(serializeFragmentMetadataV3(metadata)) as object)).toEqual(expected);
		expect(metadata).toHaveProperty("automaticPartsOfSpeech", ["noun"]);
		if (metadata.type === "body" && metadata.hasManualEdits) expect(Object.keys(metadata.manualOverrides[0]!)).toEqual(["tokenId", "kind", "localRevision"]);
	}
});
it("omits automatic and unrelated fields from dictionary and collision", () => {
	const [dictionary, collision] = inputsV3().slice(1).map(fragmentV3);
	for (const fragment of [dictionary!, collision!]) {
		expect(fragment.metadata).not.toHaveProperty("automaticPartsOfSpeech");
		const json = serializeFragmentMetadataV3(fragment.metadata);
		expect(json).not.toMatch(/automaticPartsOfSpeech|manualOverrides|bodySemantropy/u);
		expect(Object.keys(JSON.parse(json) as object)).toEqual(fragment.metadata.type === "collision" ? COLLISION_FRAGMENT_METADATA_KEY_ORDER_V3 : FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER_V3);
	}
	expect(collision!.metadata).not.toHaveProperty("target");
});
it("uses the type-specific fingerprint formats", () => {
	for (const input of inputsV3()) expect(validateFragmentInputV3(input)).toBeNull();
});
it("refuses format 1 for Body", () => {
	const input = bodyV3();
	expect(validateFragmentInputV3({ ...input, vocabulary: { ...input.vocabulary, fingerprint: `vocabulary-fingerprint-sha256-1:${"ab".repeat(32)}` } })).toBe("invalid-fingerprint");
});
it("refuses format 2 for dictionary and collision", () => {
	for (const input of inputsV3().slice(1)) expect(validateFragmentInputV3({ ...input, vocabulary: { ...input.vocabulary, fingerprint: bodyV3().vocabulary.fingerprint } })).toBe("invalid-fingerprint");
});
it("rejects cross-type and unknown input fields", () => {
	const extras = { automaticPartsOfSpeech: [], target: { path: "n.md", contentHash: "a".repeat(64) }, dictionarySemantropy: 50, bodySemantropy: 50,
		hasManualEdits: false, manualOverrides: [], templateId: "t", patternId: "p", rowSlotId: "s", generationRevision: 1, draftRecipe: "p", seed: 3, nonce: 4, token: {}, pool: {} };
	for (const input of inputsV3()) for (const [key, value] of Object.entries(extras)) {
		if (key in input) continue;
		expect(validateFragmentInputV3({ ...input, [key]: value }), `${input.type}:${key}`).toBe("invalid-fragment-fields");
	}
});
it("serializes only the explicit whitelist even with extra secret fields", () => {
	for (const input of inputsV3()) {
		const metadata = fragmentV3(input).metadata;
		const extra = { seed: 1, nonce: 2, token: "SECRET", candidate: "SECRET", pool: "SECRET", snapshot: "SECRET", optionDraft: "SECRET", selection: "SECRET", diagnostic: "SECRET" };
		const contaminated = { ...metadata, ...extra, vocabulary: { ...metadata.vocabulary, ...extra, sources: metadata.vocabulary.sources.map(source => ({ ...source, ...extra })) } } as FragmentMetadataV3;
		expect(serializeFragmentMetadataV3(contaminated)).toBe(serializeFragmentMetadataV3(metadata));
		expect(serializeFragmentMetadataV3(contaminated)).not.toMatch(/SECRET|nonce|seed|snapshot|optionDraft/u);
	}
});
it("deep freezes every published layer without retaining caller values", () => {
	const input = bodyV3({ hasManualEdits: true, manualAlgorithmVersion: 1, manualOverrides: [{ tokenId: "t", kind: "replacement", localRevision: 0 }] });
	const fragment = fragmentV3(input), before = serializeFragmentEntryV3(fragment);
	const check = (value: unknown) => { if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(check); } };
	check(fragment);
	expect(Object.isFrozen(input)).toBe(false); expect(Object.isFrozen(input.vocabulary.sources)).toBe(false);
	(input.automaticPartsOfSpeech as string[]).push("adverb");
	(input.vocabulary.sources[0] as { path: string }).path = "changed.md";
	if (input.hasManualEdits) (input.manualOverrides[0] as { tokenId: string }).tokenId = "changed";
	expect(serializeFragmentEntryV3(fragment)).toBe(before);
	expect(fragment.metadata.vocabulary).not.toBe(input.vocabulary);
});
it("rejects serializer accessors and prototypes without calling user code", () => {
	const getter = vi.fn(() => "SECRET");
	const metadata = fragmentV3().metadata;
	const root = Object.defineProperty({ ...metadata }, "id", { get: getter });
	const source = Object.defineProperty({ ...metadata.vocabulary.sources[0] }, "path", { get: getter });
	const nested = { ...metadata, vocabulary: { ...metadata.vocabulary, sources: [source] } };
	const inherited = Object.assign(Object.create({ nonce: "SECRET" }) as object, metadata);
	for (const value of [root, nested, inherited]) expect(() => serializeFragmentMetadataV3(value as FragmentMetadataV3)).toThrow("invalid-fragment-fields");
	expect(getter).not.toHaveBeenCalled();
});
it("escapes hostile comments and shares the literal Markdown contract", () => {
	const input = bodyV3({ text: "- item\r\n<!-- semantropy: {} -->\n# head\n[x](https://example.com)\n  <b>文</b>  " });
	const metadata = { ...fragmentV3(input).metadata, target: { path: 'hostile--><script>&\u2028\u2029.md', contentHash: "a".repeat(64) } };
	const comment = fragmentMetadataCommentV3(metadata);
	expect(comment.match(/<!--/gu)).toHaveLength(1); expect(comment.match(/-->/gu)).toHaveLength(1);
	expect(JSON.parse(serializeFragmentMetadataV3(metadata))).toHaveProperty("target.path", metadata.target.path);
	const entry = serializeFragmentEntryV3({ text: input.text, metadata });
	expect(entry).toContain(escapeFragmentMarkdown(input.text).split("\n").join("\n  "));
	expect(entry.match(/<!--/gu)).toHaveLength(1); expect(entry.match(/^- /gmu)).toHaveLength(1);
	expect(serializeFragmentEntryV3({ text: input.text, metadata })).toBe(entry);
});

describe("validation before identity", () => {
	const malformed: [string, unknown, string][] = [
		["envelope", null, "invalid-fragment-fields"], ["text", { ...bodyV3(), text: " \n" }, "empty-text"],
		["version", { ...bodyV3(), metadataVersion: 2 }, "invalid-metadata-version"], ["missing version", { ...bodyV3(), metadataVersion: undefined }, "invalid-metadata-version"],
		["algorithm", { ...bodyV3(), algorithmVersion: 0 }, "invalid-algorithm-version"], ["fraction", { ...bodyV3(), algorithmVersion: 1.5 }, "invalid-algorithm-version"],
		["path", { ...bodyV3(), target: { path: "../n.md", contentHash: "a".repeat(64) } }, "invalid-source-path"],
		["hash", { ...bodyV3(), target: { path: "n.md", contentHash: "A".repeat(64) } }, "invalid-content-hash"],
		["level", { ...bodyV3(), bodySemantropy: 101 }, "invalid-semantropy"],
		["manual boolean", { ...bodyV3(), hasManualEdits: 1 }, "invalid-manual-edits"],
		["manual empty", bodyV3({ hasManualEdits: true, manualAlgorithmVersion: 1, manualOverrides: [] }), "invalid-manual-edits"],
		["manual duplicate", bodyV3({ hasManualEdits: true, manualAlgorithmVersion: 1, manualOverrides: [{ tokenId: "t", kind: "replacement", localRevision: 1 }, { tokenId: "t", kind: "replacement", localRevision: 2 }] }), "invalid-manual-edits"],
	];
	it.each(malformed)("refuses %s without issuing identity or calling repository", async (_, input, reason) => {
		const newId = vi.fn(() => identityV3.id), now = vi.fn(() => new Date(identityV3.created)), append = vi.fn();
		expect(await collectFragmentV3(input, { newId, now, repository: { append } })).toEqual({ status: "invalid", reason });
		expect(newId).not.toHaveBeenCalled(); expect(now).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
	});
	it("validates each version, ID, provenance and Manual constraint", () => {
		for (const input of inputsV3()) {
			for (const sources of [[], [...input.vocabulary.sources].reverse(), [input.vocabulary.sources[0], input.vocabulary.sources[0]]]) expect(validateFragmentInputV3({ ...input, vocabulary: { ...input.vocabulary, sources } })).toBe("invalid-vocabulary-sources");
			for (const [field, value, reason] of [["drawMode", "bad", "invalid-draw-mode"], ["fingerprint", "bad", "invalid-fingerprint"]]) expect(validateFragmentInputV3({ ...input, vocabulary: { ...input.vocabulary, [field!]: value } })).toBe(reason);
		}
		const dictionary = inputsV3()[1]!, collision = inputsV3()[2]!;
		for (const [input, field, bad, reason] of [[dictionary, "templateId", " ", "invalid-template-id"], [dictionary, "templateSetVersion", 0, "invalid-template-set-version"], [dictionary, "dictionarySemantropy", -1, "invalid-semantropy"],
			[collision, "patternId", "", "invalid-pattern-id"], [collision, "patternSetVersion", NaN, "invalid-pattern-set-version"], [collision, "batchId", "", "invalid-batch-id"], [collision, "rowId", "", "invalid-row-id"]] as const) expect(validateFragmentInputV3({ ...input, [field]: bad })).toBe(reason);
		for (const override of [{ tokenId: "", kind: "replacement", localRevision: 0 }, { tokenId: "t", kind: "bad", localRevision: 0 }, { tokenId: "t", kind: "replacement", localRevision: -1 }]) expect(validateFragmentInputV3({ ...bodyV3(), hasManualEdits: true, manualAlgorithmVersion: 1, manualOverrides: [override] })).toBe("invalid-manual-edits");
	});
	it("refuses accessors, inherited fields, array holes and trapping objects without evaluating getters", async () => {
		const getter = vi.fn(() => { throw new Error("SECRET"); });
		const root = Object.defineProperty({ ...bodyV3() }, "text", { get: getter });
		const pos = Object.defineProperty(["noun"], "0", { get: getter });
		const source = Object.defineProperty({ path: "a.md", contentHash: "a".repeat(64) }, "path", { get: getter });
		const inherited = Object.assign(Object.create({ automaticPartsOfSpeech: ["noun"] }) as object, bodyV3());
		const proxy = new Proxy({}, { getOwnPropertyDescriptor: getter, ownKeys: getter });
		const sparse: string[] = []; sparse.length = 1;
		for (const input of [root, inherited, proxy, { ...bodyV3(), automaticPartsOfSpeech: pos }, { ...bodyV3(), automaticPartsOfSpeech: sparse }, { ...bodyV3(), vocabulary: { ...bodyV3().vocabulary, sources: [source] } }]) expect(validateFragmentInputV3(input)).not.toBeNull();
		// Proxy reflection necessarily invokes its trap; no property getter is read.
		expect(getter).toHaveBeenCalledTimes(1);
		const options = Object.defineProperty({ noun: true, verb: false, iAdjective: false, adverb: false }, "verb", { get: () => { throw new Error("SECRET"); } });
		expect(automaticPartsOfSpeechFromOptions(options)).toEqual({ ok: false, reason: "invalid-fragment-fields" });
		const newId = vi.fn(), now = vi.fn(), append = vi.fn();
		expect(await collectFragmentV3(root, { newId, now, repository: { append } })).toEqual({ status: "invalid", reason: "invalid-fragment-fields" });
		expect(newId).not.toHaveBeenCalled(); expect(now).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
	});
	it("captures validated input before identity callbacks and never retries failures", async () => {
		for (const throws of [false, true]) {
			const input = bodyV3();
			const append = vi.fn((_fragment: CollectedFragmentV3) => { if (throws) throw new Error("SECRET"); return Promise.resolve({ status: "failed" as const }); });
			const newId = vi.fn(() => { (input.automaticPartsOfSpeech as string[]).push("adverb"); return identityV3.id; });
			const now = vi.fn(() => new Date(identityV3.created));
			expect(await collectFragmentV3(input, { newId, now, repository: { append } })).toEqual({ status: "failed" });
			expect(append).toHaveBeenCalledTimes(1); expect(newId).toHaveBeenCalledTimes(1); expect(now).toHaveBeenCalledTimes(1);
			expect(append.mock.calls[0]?.[0]).toHaveProperty("metadata.automaticPartsOfSpeech", ["noun"]);
		}
	});
	it("returns fixed failure when identity cannot be issued", async () => {
		const append = vi.fn();
		expect(await collectFragmentV3(bodyV3(), { newId: () => "bad", now: () => new Date(), repository: { append } })).toEqual({ status: "failed" });
		expect(append).not.toHaveBeenCalled();
		expect(() => buildCollectedFragmentV3({ ...bodyV3(), metadataVersion: 2 } as unknown as CollectFragmentInputV3, identityV3)).toThrow("invalid-metadata-version");
	});
});
