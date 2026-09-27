import { describe, expect, it, vi } from "vitest";
import { COLLECT_METADATA_VERSION } from "../src/collect/collectProvenance";
import { escapeFragmentMarkdown } from "../src/collect/escapeFragmentMarkdown";
import { COLLECT_METADATA_VERSION_V3, validateFragmentInputV3 } from "../src/collect/v3/CollectedFragmentV3";
import { serializeFragmentEntryV3, serializeFragmentMetadataV3 } from "../src/collect/v3/serializeFragmentV3";
import {
	COLLECT_METADATA_VERSION_V4,
	buildCollectedFragmentV4,
	captureFragmentMetadataV4,
	fakeProverbFragmentInputFromRow,
	readCollectFragmentInputV4,
	validateFragmentInputV4,
	type CollectedFragmentV4,
	type FakeProverbFragmentMetadataV4,
	type FragmentMetadataV4,
} from "../src/collect/v4/CollectedFragmentV4";
import { collectFragmentV4 } from "../src/collect/v4/CollectFragmentUseCaseV4";
import {
	BODY_FRAGMENT_METADATA_KEY_ORDER_V4,
	COLLISION_FRAGMENT_METADATA_KEY_ORDER_V4,
	FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER_V4,
	FAKE_PROVERB_FRAGMENT_METADATA_KEY_ORDER_V4,
	fragmentMetadataCommentV4,
	serializeFragmentEntryV4,
	serializeFragmentMetadataV4,
} from "../src/collect/v4/serializeFragmentV4";
import { createFakeProverbBatchController, readFakeProverbRow, type FakeProverbRowRecord } from "../src/fakeProverb/fakeProverbBatch";
import { fakeProverbCanonicalText } from "../src/fakeProverb/fakeProverbText";
import { collectVocabulary } from "./collectFixtures";
import { bodyV3, fragmentV3, inputsV3 } from "./collectV3Fixtures";
import { FIXTURE_BATCH_ID, FIXTURE_CANONICAL, FIXTURE_ROW_ID, fakeProverbV4, fragmentV4, identityV4, inputsV4, v3TypesV4 } from "./collectV4Fixtures";
import { RICH_TEXT, mintOwner, ok, standardSet } from "./fakeProverbCoreFixtures";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const HASH = "ab".repeat(32);
const badIds = ["not-a-uuid", "", " ", "a".repeat(32), `${identityV4.id}${LF}`, ` ${identityV4.id}`, 1, null];
const badCreated = ["not-a-time", "", "2026-09-05", "2026-09-05T12:34:56Z", "2026-09-05T21:34:56.000+09:00", "2026-02-30T00:00:00.000Z", `${identityV4.created}${LF}`, 0, null];
const V3_ORDERS = { body: BODY_FRAGMENT_METADATA_KEY_ORDER_V4, "fake-dictionary": FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER_V4, collision: COLLISION_FRAGMENT_METADATA_KEY_ORDER_V4 } as const;

function parsedComment(entry: string): Record<string, unknown> {
	const match = /<!-- semantropy: (.*) -->/u.exec(entry);
	return JSON.parse(match![1]!) as Record<string, unknown>;
}
/** The entry body as Markdown sees it: list marker and continuation indent removed. */
function collectionBody(entry: string): string {
	const lines = (entry.endsWith(LF) ? entry.slice(0, -1) : entry).split(LF);
	return lines.map((line) => line.slice(2)).join(LF);
}
/** Reads the stored comment back as a v4 input: the stored text of fake-proverb is its canonical text. */
function reread(metadata: Record<string, unknown>, text: string): ReturnType<typeof readCollectFragmentInputV4> {
	const { id: _id, created: _created, ...fields } = metadata;
	return readCollectFragmentInputV4({ ...fields, text });
}

describe("Collect metadata 4 versions and type union", () => {
	it("introduces only the separate metadata version 4", () => {
		expect(COLLECT_METADATA_VERSION).toBe(2);
		expect(COLLECT_METADATA_VERSION_V3).toBe(3);
		expect(COLLECT_METADATA_VERSION_V4).toBe(4);
		expect(inputsV4().map((input) => input.type)).toEqual(["body", "fake-dictionary", "collision", "fake-proverb"]);
		for (const input of inputsV4()) expect(fragmentV4(input).metadata.metadataVersion).toBe(4);
	});

	it("refuses every other metadata version, and v3 refuses 4", () => {
		for (const input of inputsV4()) for (const metadataVersion of [1, 2, 3, 5, "4", undefined]) {
			expect(validateFragmentInputV4({ ...input, metadataVersion }), `${input.type}:${String(metadataVersion)}`).toBe("invalid-metadata-version");
		}
		for (const input of v3TypesV4()) expect(validateFragmentInputV3(input)).toBe("invalid-metadata-version");
		expect(validateFragmentInputV3(fakeProverbV4())).not.toBeNull();
		expect(validateFragmentInputV4({ ...fakeProverbV4(), type: "proverb" })).toBe("invalid-fragment-fields");
	});
});

describe("the three v3 types keep their v3 semantics", () => {
	it("stores exactly the v3 metadata and entry bytes, relabelled 4", () => {
		for (const input of inputsV3()) {
			const v3 = fragmentV3(input);
			const v4 = fragmentV4({ ...input, metadataVersion: 4 });
			expect(v4.metadata).toEqual({ ...v3.metadata, metadataVersion: 4 });
			expect(Object.keys(v4.metadata)).toEqual(Object.keys(v3.metadata));
			const v3Json = serializeFragmentMetadataV3(v3.metadata);
			expect(serializeFragmentMetadataV4(v4.metadata)).toBe(v3Json.replace('"metadataVersion":3', '"metadataVersion":4'));
			const v3Entry = serializeFragmentEntryV3(v3);
			expect(v3Entry).toContain(`  <!-- semantropy: ${serializeFragmentMetadataV3(v3.metadata)} -->`);
			const v4Entry = serializeFragmentEntryV4(v4);
			expect(v4Entry).not.toContain("<!--");
			expect(v4Entry).toBe(v3Entry.replace(`\n  <!-- semantropy: ${serializeFragmentMetadataV3(v3.metadata)} -->\n`, "\n"));
			expect(Object.keys(JSON.parse(serializeFragmentMetadataV4(v4.metadata)) as object)).toEqual(
				input.type === "body" ? V3_ORDERS.body.slice(0, -2) : V3_ORDERS[input.type]);
		}
	});

	it("keeps the v3 fingerprint formats and Body algorithm 11", () => {
		const [body, dictionary, collision] = v3TypesV4();
		const format1 = collectVocabulary(["a.md"]).fingerprint;
		const format3 = bodyV3().vocabulary.fingerprint;
		expect(validateFragmentInputV4({ ...body, vocabulary: { ...body!.vocabulary, fingerprint: format1 } })).toBe("invalid-fingerprint");
		expect(validateFragmentInputV4({ ...body, algorithmVersion: 10 })).toBe("invalid-algorithm-version");
		for (const input of [dictionary!, collision!]) {
			expect(validateFragmentInputV4({ ...input, vocabulary: { ...input.vocabulary, fingerprint: format3 } })).toBe("invalid-fingerprint");
		}
		expect(validateFragmentInputV4(fakeProverbV4({ vocabulary: { ...fakeProverbV4().vocabulary, fingerprint: format3 } }))).toBe("invalid-fingerprint");
	});

	it("refuses fake-proverb fields on v3 types and cross-type fields", () => {
		const extras = { proverbRecipeId: "a", glossRecipeId: "b", recipeDataVersion: 1, canonicalText: FIXTURE_CANONICAL, rowSlotId: "s", nonce: 1, draft: {} };
		for (const input of v3TypesV4()) for (const [key, value] of Object.entries(extras)) {
			expect(validateFragmentInputV4({ ...input, [key]: value }), `${input.type}:${key}`).toBe("invalid-fragment-fields");
		}
	});

	it("keeps each v3 refusal reason", () => {
		const [body, dictionary, collision] = v3TypesV4();
		expect(validateFragmentInputV4({ ...body, automaticPartsOfSpeech: ["verb", "noun"] })).toBe("invalid-automatic-parts-of-speech");
		expect(validateFragmentInputV4({ ...body, bodySemantropy: 101 })).toBe("invalid-semantropy");
		expect(validateFragmentInputV4({ ...body, target: { path: "../n.md", contentHash: HASH } })).toBe("invalid-source-path");
		expect(validateFragmentInputV4({ ...dictionary, templateId: " " })).toBe("invalid-template-id");
		expect(validateFragmentInputV4({ ...collision, batchId: "" })).toBe("invalid-batch-id");
		expect(validateFragmentInputV4({ ...body, text: " " })).toBe("empty-text");
	});
});

describe("fake-proverb metadata", () => {
	it("writes the exact whitelist in canonical order, with no Target", () => {
		const fragment = fragmentV4();
		expect(Object.keys(fragment.metadata)).toEqual([...FAKE_PROVERB_FRAGMENT_METADATA_KEY_ORDER_V4]);
		expect(Object.keys(fragment)).toEqual(["text", "metadata"]);
		expect(Object.keys(fragment.metadata.vocabulary)).toEqual(["sources", "fingerprint", "drawMode"]);
		for (const source of fragment.metadata.vocabulary.sources) expect(Object.keys(source)).toEqual(["path", "contentHash"]);
		const json = JSON.parse(serializeFragmentMetadataV4(fragment.metadata)) as Record<string, unknown>;
		expect(Object.keys(json)).toEqual([...FAKE_PROVERB_FRAGMENT_METADATA_KEY_ORDER_V4]);
		expect(json).toEqual({
			id: identityV4.id, metadataVersion: 4, type: "fake-proverb", created: identityV4.created, algorithmVersion: 1, recipeDataVersion: 1,
			vocabulary: fakeProverbV4().vocabulary, proverbRecipeId: "offered-to", glossRecipeId: "misplaced-purpose",
			batchId: FIXTURE_BATCH_ID, rowId: FIXTURE_ROW_ID, canonicalText: FIXTURE_CANONICAL,
		});
		expect(fragment.metadata).not.toHaveProperty("target");
		expect(fragment.text).toBe(FIXTURE_CANONICAL);
	});

	it("round-trips every type through the historical comment serializer, and the entry omits it", () => {
		for (const input of inputsV4()) {
			const fragment = fragmentV4(input);
			const comment = fragmentMetadataCommentV4(fragment.metadata);
			const stored = parsedComment(comment);
			expect(stored).toEqual(JSON.parse(JSON.stringify(fragment.metadata)));
			const read = reread(stored, input.text);
			expect(read).toEqual({ ok: true, value: input });
			expect(buildCollectedFragmentV4(read.ok ? read.value : input, identityV4)).toEqual(fragment);
			const entry = serializeFragmentEntryV4(fragment);
			expect(entry).not.toContain("<!--");
			expect(entry).not.toContain(fragment.metadata.vocabulary.fingerprint);
			for (const source of fragment.metadata.vocabulary.sources) {
				expect(entry).not.toContain(source.path);
				expect(entry).not.toContain(source.contentHash);
			}
		}
	});

	it("round-trips a Target-less Selected Notes Vocabulary of one and of many Sources", () => {
		for (const paths of [["only.md"], ["a.md", "folder/b.md", "z.md"], Array.from({ length: 12 }, (_, index) => `note-${String(index).padStart(2, "0")}.md`)]) {
			const input = fakeProverbV4({ vocabulary: collectVocabulary(paths) });
			const fragment = fragmentV4(input);
			expect(fragment.metadata.vocabulary.sources.map((source) => source.path)).toEqual(paths);
			expect(reread(parsedComment(fragmentMetadataCommentV4(fragment.metadata)), input.text)).toEqual({ ok: true, value: input });
			expect(serializeFragmentEntryV4(fragment)).not.toContain("<!--");
		}
		for (const drawMode of ["uniform", "frequency"] as const) {
			expect(validateFragmentInputV4(fakeProverbV4({ vocabulary: { ...fakeProverbV4().vocabulary, drawMode } }))).toBeNull();
		}
	});

	it("requires the root text, the Collection body and canonicalText to be one value, byte for byte", () => {
		const other = fakeProverbCanonicalText("犬に小判", "犬が小判において月を見ることのたとえ。");
		for (const text of [other, `${FIXTURE_CANONICAL}${LF}`, `${LF}${FIXTURE_CANONICAL}`, FIXTURE_CANONICAL.replaceAll(LF, `${CR}${LF}`), FIXTURE_CANONICAL.normalize("NFD").replace("が", "か" + String.fromCharCode(0x3099))]) {
			expect(validateFragmentInputV4(fakeProverbV4({ text }))).toBe("canonical-text-mismatch");
			expect(validateFragmentInputV4(fakeProverbV4({ canonicalText: text }))).toBe("canonical-text-mismatch");
		}
		const fragment = fragmentV4();
		expect(() => serializeFragmentEntryV4({ text: other, metadata: fragment.metadata })).toThrow("canonical-text-mismatch");
		expect(() => serializeFragmentEntryV4({ text: `${FIXTURE_CANONICAL} `, metadata: fragment.metadata })).toThrow("canonical-text-mismatch");
		const entry = serializeFragmentEntryV4(fragment);
		expect(parsedComment(fragmentMetadataCommentV4(fragment.metadata))["canonicalText"]).toBe(fragment.text);
		// The Collection body is the canonical Markdown itself, the same bytes Copy uses.
		expect(entry).toBe([
			"- **猫に小判**", "", "  > 猫が小判において月を見ることのたとえ。",
		].join(LF) + LF);
		expect(entry).not.toContain("<!--");
		expect(collectionBody(entry)).toBe(FIXTURE_CANONICAL);
		expect(collectionBody(entry)).toBe(fragment.metadata.type === "fake-proverb" ? fragment.metadata.canonicalText : null);
		expect(entry).not.toContain(escapeFragmentMarkdown("**"));
	});

	it("accepts only a canonical proverb and gloss pair", () => {
		const bad = [
			"猫に小判", `**猫に小判**${LF}> 月`, `**猫に小判**${LF}${LF}${LF}> 月`, `**猫に小判**${LF}${LF}>月`, `*猫に小判*${LF}${LF}> 月`,
			fakeProverbCanonicalText("", "月"), fakeProverbCanonicalText("猫", ""), fakeProverbCanonicalText("猫 に", "月"), fakeProverbCanonicalText("猫", "月!"),
			fakeProverbCanonicalText("猫**", "月"), fakeProverbCanonicalText("猫", `月${LF}${LF}> 星`), fakeProverbCanonicalText("猫", "月>"),
			fakeProverbCanonicalText("か" + String.fromCharCode(0x3099), "月"), fakeProverbCanonicalText("猫", "月" + String.fromCharCode(0x200b)),
			fakeProverbCanonicalText("猫", "月" + String.fromCharCode(0xd800)),
		];
		for (const text of bad) expect(validateFragmentInputV4(fakeProverbV4({ text, canonicalText: text })), JSON.stringify(text)).toBe("invalid-canonical-text");
		for (const text of [fakeProverbCanonicalText("猫", "月"), fakeProverbCanonicalText("𠮷野家", "「月」が、星となる。")]) {
			expect(validateFragmentInputV4(fakeProverbV4({ text, canonicalText: text }))).toBeNull();
		}
	});

	it("validates versions, recipe IDs and batch / row identity", () => {
		const cases: [string, unknown, string][] = [
			["algorithmVersion", 2, "invalid-algorithm-version"], ["algorithmVersion", "1", "invalid-algorithm-version"], ["algorithmVersion", 0, "invalid-algorithm-version"],
			["recipeDataVersion", 0, "invalid-recipe-data-version"], ["recipeDataVersion", 1.5, "invalid-recipe-data-version"], ["recipeDataVersion", "1", "invalid-recipe-data-version"],
			["recipeDataVersion", -1, "invalid-recipe-data-version"], ["recipeDataVersion", Number.MAX_SAFE_INTEGER + 1, "invalid-recipe-data-version"],
			...["", "Upper", "a_b", "-a", "a-", "a--b", "1a", "a b", "a".repeat(49), 1, null].flatMap((id): [string, unknown, string][] =>
				[["proverbRecipeId", id, "invalid-recipe-id"], ["glossRecipeId", id, "invalid-recipe-id"]]),
			...["", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), `${"a".repeat(63)}${LF}`, 1].flatMap((id): [string, unknown, string][] =>
				[["batchId", id, "invalid-batch-id"], ["rowId", id, "invalid-row-id"]]),
			["rowId", FIXTURE_BATCH_ID, "invalid-row-id"],
		];
		for (const [field, value, reason] of cases) expect(validateFragmentInputV4(fakeProverbV4({ [field]: value })), `${field}:${JSON.stringify(value)}`).toBe(reason);
		expect(validateFragmentInputV4(fakeProverbV4({ recipeDataVersion: 7, proverbRecipeId: "a".repeat(48), glossRecipeId: "a1-b2" }))).toBeNull();
	});

	it("validates Vocabulary provenance", () => {
		const vocabulary = fakeProverbV4().vocabulary;
		const source = vocabulary.sources[0]!;
		const cases: [unknown, string][] = [
			[{ ...vocabulary, sources: [] }, "invalid-vocabulary-sources"], [{ ...vocabulary, sources: [...vocabulary.sources].reverse() }, "invalid-vocabulary-sources"],
			[{ ...vocabulary, sources: [source, source] }, "invalid-vocabulary-sources"], [{ ...vocabulary, sources: "a.md" }, "invalid-vocabulary-sources"],
			[{ ...vocabulary, sources: [{ path: "../a.md", contentHash: HASH }] }, "invalid-source-path"], [{ ...vocabulary, sources: [{ path: "/a.md", contentHash: HASH }] }, "invalid-source-path"],
			[{ ...vocabulary, sources: [{ path: "a.md", contentHash: "A".repeat(64) }] }, "invalid-content-hash"],
			[{ ...vocabulary, sources: [{ ...source, projectionPolicy: "p" }] }, "invalid-fragment-fields"], [{ ...vocabulary, sources: [{ path: "a.md" }] }, "invalid-fragment-fields"],
			[{ ...vocabulary, fingerprint: "bad" }, "invalid-fingerprint"], [{ ...vocabulary, fingerprint: HASH }, "invalid-fingerprint"],
			[{ ...vocabulary, drawMode: "weighted" }, "invalid-draw-mode"], [{ ...vocabulary, target: source }, "invalid-fragment-fields"], [null, "invalid-fragment-fields"],
		];
		for (const [value, reason] of cases) expect(validateFragmentInputV4(fakeProverbV4({ vocabulary: value })), JSON.stringify(value)).toBe(reason);
	});

	it("never accepts typed bindings, rowSlotId, counts, shortfall, draft, pool, token, nonce, Source text or a Target", () => {
		const forbidden = { rowSlotId: "s", bindings: [], typedBindings: {}, draft: {}, requestedCount: 10, actualCount: 9, status: "partial", shortfallReason: "x",
			pool: {}, token: {}, nonce: 1, seed: 1, sourceText: "SECRET", proverbText: "猫", glossText: "月", recipeSchemaVersion: 1, projectionPolicy: "p",
			target: { path: "t.md", contentHash: HASH }, bodySemantropy: 50, templateId: "t", patternId: "p", generationRevision: 1 };
		for (const [key, value] of Object.entries(forbidden)) expect(validateFragmentInputV4({ ...fakeProverbV4(), [key]: value }), key).toBe("invalid-fragment-fields");
		for (const key of ["text", "canonicalText", "batchId", "rowId", "vocabulary", "proverbRecipeId", "glossRecipeId", "recipeDataVersion", "algorithmVersion"]) {
			const { [key as keyof ReturnType<typeof fakeProverbV4>]: _removed, ...missing } = fakeProverbV4();
			expect(validateFragmentInputV4(missing), key).toBe("invalid-fragment-fields");
		}
	});

	it("serializes only the whitelist even with contaminated metadata", () => {
		for (const input of inputsV4()) {
			const metadata = fragmentV4(input).metadata;
			const extra = { rowSlotId: "SECRET", draft: "SECRET", bindings: "SECRET", nonce: 2, pool: "SECRET", token: "SECRET", sourceText: "SECRET", shortfallReason: "SECRET" };
			const contaminated = { ...metadata, ...extra, vocabulary: { ...metadata.vocabulary, ...extra, sources: metadata.vocabulary.sources.map((source) => ({ ...source, ...extra })) } } as FragmentMetadataV4;
			expect(serializeFragmentMetadataV4(contaminated)).toBe(serializeFragmentMetadataV4(metadata));
			expect(serializeFragmentMetadataV4(contaminated)).not.toMatch(/SECRET|nonce|rowSlotId|draft|bindings|shortfall/u);
		}
	});

	it("escapes the comment so the gloss marker and hostile paths cannot close it", () => {
		const fragment = fragmentV4(fakeProverbV4({ vocabulary: collectVocabulary(["a-->b&<c.md"]) }));
		const comment = fragmentMetadataCommentV4(fragment.metadata);
		expect(comment.match(/<!--/gu)).toHaveLength(1);
		expect(comment.match(/-->/gu)).toHaveLength(1);
		expect(comment.slice("<!--".length, -"-->".length)).not.toMatch(/[<>&]/u);
		expect(parsedComment(comment)).toHaveProperty("canonicalText", fragment.text);
		expect(parsedComment(comment)).toHaveProperty("vocabulary.sources.0.path", "a-->b&<c.md");
	});

	it("deep freezes the fragment without retaining caller values", () => {
		const input = fakeProverbV4();
		const fragment = fragmentV4(input);
		const before = serializeFragmentEntryV4(fragment);
		const check = (value: unknown): void => { if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(check); } };
		check(fragment);
		expect(Object.isFrozen(input.vocabulary.sources)).toBe(false);
		(input.vocabulary.sources[0] as { path: string }).path = "changed.md";
		(input as { canonicalText: string }).canonicalText = "changed";
		expect(serializeFragmentEntryV4(fragment)).toBe(before);
	});
});

describe("the Collection body of each type (review 1, P1)", () => {
	/** Every ASCII punctuation character: what escapeFragmentMarkdown neutralizes for the literal types. */
	const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/gu;

	it("writes fake-proverb as the canonical Markdown Copy uses, byte for byte", () => {
		for (const [proverb, gloss] of [["猫に小判", "猫が小判において月を見ることのたとえ。"], ["𠮷野家", "「月」が、星となる。"], ["ABC123", "ｘ＝１（全角）"]] as const) {
			const canonical = fakeProverbCanonicalText(proverb, gloss);
			const entry = serializeFragmentEntryV4(fragmentV4(fakeProverbV4({ text: canonical, canonicalText: canonical })));
			expect(collectionBody(entry)).toBe(canonical);
			expect(entry.split(LF).slice(0, 3)).toEqual([`- **${proverb}**`, "", `  > ${gloss}`]);
		}
	});

	it("contains no markup except the serializer's own bold and quote markers", () => {
		const body = collectionBody(serializeFragmentEntryV4(fragmentV4()));
		expect(body.match(ASCII_PUNCTUATION)).toEqual(["*", "*", "*", "*", ">"]);
		expect(body.split(LF).map((line) => line.replace(/[^!-/:-@[-`{-~]/gu, ""))).toEqual(["****", "", ">"]);
	});

	it("keeps the literal, escaped contract for body, fake-dictionary and collision", () => {
		const hostile = "**強調** > 引用 [[リンク]] #タグ <b>x</b> `c`";
		const [body, dictionary, collision] = v3TypesV4();
		const inputs = [{ ...body!, text: hostile }, { ...dictionary!, text: hostile }, { ...collision!, text: hostile }] as const;
		for (const input of inputs) {
			const entry = serializeFragmentEntryV4(fragmentV4(input));
			expect(collectionBody(entry)).toBe(escapeFragmentMarkdown(hostile));
			expect(collectionBody(entry)).not.toContain("**");
		}
	});

	it("refuses non-canonical Markdown before it can reach a Collection body", () => {
		const hostile = [
			fakeProverbCanonicalText("[[猫]]", "月"), fakeProverbCanonicalText("猫", "<b>月</b>"), fakeProverbCanonicalText("#猫", "月"),
			fakeProverbCanonicalText("猫", "![[月]]"), fakeProverbCanonicalText("猫", "`月`"), fakeProverbCanonicalText("猫", "==月=="),
			fakeProverbCanonicalText("猫", "%%月%%"), fakeProverbCanonicalText("猫", "$月$"), fakeProverbCanonicalText("猫", "月^abc"),
			fakeProverbCanonicalText("猫", "&lt;月"), fakeProverbCanonicalText("猫", "[月](x)"), fakeProverbCanonicalText("猫", `月${LF}# 見出し`),
			`**猫**${LF}${LF}> 月${LF}${LF}- 余分`, `# 猫${LF}${LF}> 月`,
		];
		const metadata = fragmentV4().metadata;
		for (const text of hostile) {
			expect(validateFragmentInputV4(fakeProverbV4({ text, canonicalText: text })), text).toBe("invalid-canonical-text");
			expect(() => serializeFragmentEntryV4({ text, metadata: { ...metadata, canonicalText: text } as FragmentMetadataV4 }), text).toThrow("invalid-canonical-text");
		}
	});
});

describe("identity and descriptor boundaries", () => {
	it("rejects invalid ids and created values at every serializer boundary, for every type", () => {
		for (const input of inputsV4()) for (const patch of [...badIds.map((id) => ({ id })), ...badCreated.map((created) => ({ created }))]) {
			const metadata = { ...fragmentV4(input).metadata, ...patch } as FragmentMetadataV4;
			expect(() => captureFragmentMetadataV4(metadata), `${input.type}:${JSON.stringify(patch)}`).toThrow("invalid-fragment-fields");
			expect(() => serializeFragmentMetadataV4(metadata)).toThrow("invalid-fragment-fields");
			expect(() => serializeFragmentEntryV4({ text: input.text, metadata })).toThrow("invalid-fragment-fields");
			expect(() => buildCollectedFragmentV4(input, { ...identityV4, ...patch } as typeof identityV4)).toThrow("invalid-fragment-fields");
		}
	});

	it("refuses getters, inherited fields, foreign prototypes, array holes and traps without evaluating getters", () => {
		const getter = vi.fn(() => { throw new Error("SECRET"); });
		const input = fakeProverbV4();
		const sparse: unknown[] = []; sparse.length = 1;
		class Shape { constructor(readonly value: unknown) {} }
		const hostile = [
			...(["text", "canonicalText", "batchId", "rowId", "vocabulary"] as const).map((field) => Object.defineProperty({ ...input }, field, { get: getter })),
			Object.assign(Object.create({ canonicalText: FIXTURE_CANONICAL }) as object, input),
			{ ...input, vocabulary: Object.defineProperty({ ...input.vocabulary }, "fingerprint", { get: getter }) },
			{ ...input, vocabulary: { ...input.vocabulary, sources: [Object.defineProperty({ ...input.vocabulary.sources[0]! }, "path", { get: getter })] } },
			{ ...input, vocabulary: { ...input.vocabulary, sources: Object.defineProperty([...input.vocabulary.sources], "0", { get: getter }) } },
			{ ...input, vocabulary: { ...input.vocabulary, sources: sparse } },
			{ ...input, vocabulary: { ...input.vocabulary, sources: Object.assign(Object.create(Array.prototype) as object, { length: 0 }) } },
			{ ...input, vocabulary: Object.assign(new Shape(1), input.vocabulary) },
			Object.assign(new Shape(1), input),
			{ ...input, [Symbol("nonce")]: 1 },
		];
		for (const value of hostile) expect(validateFragmentInputV4(value)).not.toBeNull();
		expect(getter).not.toHaveBeenCalled();
		const trap = vi.fn(() => { throw new Error("SECRET"); });
		expect(validateFragmentInputV4(new Proxy({}, { getOwnPropertyDescriptor: trap, ownKeys: trap }))).toBe("invalid-fragment-fields");
		// Proxy reflection necessarily invokes its trap; no property getter is read.
		expect(trap).toHaveBeenCalledTimes(1);
	});

	it("rejects serializer accessors, root getters and extra root fields without calling user code", () => {
		const getter = vi.fn(() => "SECRET");
		const fragment = fragmentV4();
		const metadata = fragment.metadata as FakeProverbFragmentMetadataV4;
		const toJSON = vi.fn(() => ({}));
		const hostileMetadata = [
			Object.defineProperty({ ...metadata }, "canonicalText", { get: getter }),
			{ ...metadata, vocabulary: { ...metadata.vocabulary, sources: [Object.defineProperty({ ...metadata.vocabulary.sources[0] }, "path", { get: getter })] } },
			Object.assign(Object.create({ nonce: "SECRET" }) as object, metadata),
		];
		for (const value of hostileMetadata) expect(() => serializeFragmentMetadataV4(value as FragmentMetadataV4)).toThrow("invalid-fragment-fields");
		expect(serializeFragmentMetadataV4({ ...metadata, toJSON } as FragmentMetadataV4)).toBe(serializeFragmentMetadataV4(metadata));
		for (const field of ["text", "metadata"] as const) {
			expect(() => serializeFragmentEntryV4(Object.defineProperty({ ...fragment }, field, { get: getter }))).toThrow("invalid-fragment-fields");
		}
		for (const root of [Object.create(fragment) as object, { text: fragment.text }, { metadata }, { ...fragment, rowSlotId: "s" }]) {
			expect(() => serializeFragmentEntryV4(root as CollectedFragmentV4)).toThrow("invalid-fragment-fields");
		}
		expect(getter).not.toHaveBeenCalled();
		expect(toJSON).not.toHaveBeenCalled();
	});
});

describe("the use case validates before issuing identity", () => {
	const malformed: [string, unknown, string][] = [
		["envelope", null, "invalid-fragment-fields"], ["text", fakeProverbV4({ text: " " }), "empty-text"],
		["version", { ...fakeProverbV4(), metadataVersion: 3 }, "invalid-metadata-version"], ["mismatch", fakeProverbV4({ text: fakeProverbCanonicalText("犬", "月") }), "canonical-text-mismatch"],
		["recipe", fakeProverbV4({ glossRecipeId: "Bad" }), "invalid-recipe-id"], ["row", fakeProverbV4({ rowId: "x" }), "invalid-row-id"],
		["binding", { ...fakeProverbV4(), bindings: [] }, "invalid-fragment-fields"], ["v3 body", bodyV3(), "invalid-metadata-version"],
	];
	it.each(malformed)("refuses %s without identity or repository calls", async (_, input, reason) => {
		const newId = vi.fn(() => identityV4.id), now = vi.fn(() => new Date(identityV4.created)), append = vi.fn();
		expect(await collectFragmentV4(input, { newId, now, repository: { append } })).toEqual({ status: "invalid", reason });
		expect(newId).not.toHaveBeenCalled(); expect(now).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
	});

	it("captures the input before identity callbacks, hands over one fragment and never retries", async () => {
		for (const throws of [false, true]) {
			const input = fakeProverbV4();
			const append = vi.fn((_fragment: CollectedFragmentV4) => { if (throws) throw new Error("SECRET"); return Promise.resolve({ status: "failed" as const }); });
			const newId = vi.fn(() => { (input as { canonicalText: string }).canonicalText = "changed"; (input.vocabulary.sources[0] as { path: string }).path = "changed.md"; return identityV4.id; });
			const now = vi.fn(() => new Date(identityV4.created));
			expect(await collectFragmentV4(input, { newId, now, repository: { append } })).toEqual({ status: "failed" });
			expect(append).toHaveBeenCalledTimes(1);
			expect(append.mock.calls[0]![0]).toEqual(fragmentV4(fakeProverbV4()));
		}
	});

	it("returns a fixed failure when identity cannot be issued", async () => {
		const append = vi.fn();
		expect(await collectFragmentV4(fakeProverbV4(), { newId: () => "bad", now: () => new Date(), repository: { append } })).toEqual({ status: "failed" });
		expect(append).not.toHaveBeenCalled();
		const created = vi.fn(() => Promise.resolve({ status: "created" as const }));
		expect(await collectFragmentV4(fakeProverbV4(), { newId: () => identityV4.id, now: () => new Date(identityV4.created), repository: { append: created } })).toEqual({ status: "created" });
	});
});

describe("a BATCH1 row record becomes a fake-proverb input", () => {
	async function committedRows() {
		const { owner } = await mintOwner([RICH_TEXT, `${RICH_TEXT}猫は川を読む。`]);
		const controller = ok(createFakeProverbBatchController({ identityMaterial: "c".repeat(64) }));
		const ticket = ok(controller.beginGenerate({ vocabulary: owner, recipeSet: standardSet(), operationMaterial: "d".repeat(64) }));
		const batch = ok(controller.complete(ticket, ok(controller.prepare(ticket)))).batch!;
		const records = batch.rows.filter((row) => row.committed).map((row) => ok(readFakeProverbRow({ batch, rowSlotId: row.rowSlotId })));
		return { controller, owner, batch, records };
	}

	it("keeps exactly the metadata fields of every committed row of a Target-less, two-Source batch", async () => {
		const { batch, records } = await committedRows();
		expect(records.length).toBeGreaterThan(0);
		expect(batch.provenance.sources.map((source) => source.path)).toEqual(["private-note-0.md", "private-note-1.md"]);
		for (const record of records) {
			const input = ok(fakeProverbFragmentInputFromRow(record));
			expect(input).toEqual({
				metadataVersion: 4, type: "fake-proverb", text: record.canonicalText, algorithmVersion: record.algorithmVersion,
				recipeDataVersion: record.recipeDataVersion,
				vocabulary: { sources: record.provenance.sources.map(({ path, contentHash }) => ({ path, contentHash })), fingerprint: record.provenance.vocabularyFingerprint, drawMode: record.provenance.drawMode },
				proverbRecipeId: record.proverbRecipeId, glossRecipeId: record.glossRecipeId, batchId: record.batchId, rowId: record.rowId, canonicalText: record.canonicalText,
			});
			const fragment = fragmentV4(input);
			const entry = serializeFragmentEntryV4(fragment);
			expect(entry).not.toMatch(/rowSlotId|projectionPolicy|recipeSchemaVersion|draft|binding|nonce|shortfall|actualCount|requestedCount/u);
			for (const row of batch.rows) expect(entry).not.toContain(row.rowSlotId);
			expect(entry).not.toContain(RICH_TEXT);
			expect(entry).not.toContain("<!--");
			expect(reread(parsedComment(fragmentMetadataCommentV4(fragment.metadata)), fragment.text)).toEqual({ ok: true, value: input });
		}
		expect(new Set(records.map((record) => record.rowId)).size).toBe(records.length);
	});

	it("writes every committed row's Collection body as exactly its canonical Markdown", async () => {
		const { records } = await committedRows();
		for (const record of records) {
			const entry = serializeFragmentEntryV4(fragmentV4(ok(fakeProverbFragmentInputFromRow(record))));
			expect(collectionBody(entry)).toBe(record.canonicalText);
			const [proverb, blank, gloss] = collectionBody(entry).split(LF);
			expect(blank).toBe("");
			expect(proverb!.replace(/^\*\*|\*\*$/gu, "")).not.toMatch(/[!-/:-@[-`{-~\s]/u);
			expect(gloss!.replace(/^> /u, "")).not.toMatch(/[!-/:-@[-`{-~\s]/u);
		}
	});

	it("keeps a read record convertible after the owner regenerates or is released", async () => {
		const { controller, owner, records } = await committedRows();
		const expected = records.map((record) => ok(fakeProverbFragmentInputFromRow(record)));
		const ticket = ok(controller.beginGenerate({ vocabulary: owner, recipeSet: standardSet(), operationMaterial: "e".repeat(64) }));
		ok(controller.complete(ticket, ok(controller.prepare(ticket))));
		controller.dispose();
		expect(records.map((record) => ok(fakeProverbFragmentInputFromRow(record)))).toEqual(expected);
	});

	it("refuses a record with extra, missing or accessor fields and a foreign recipe schema", async () => {
		const { records } = await committedRows();
		const record = records[0]!;
		const getter = vi.fn(() => { throw new Error("SECRET"); });
		const provenance = record.provenance;
		const hostile: unknown[] = [
			{ ...record, rowSlotId: "s" }, { ...record, draft: {} }, { ...record, recipeSchemaVersion: 2 },
			(({ rowId: _rowId, ...rest }) => rest)(record), { ...record, provenance: { ...provenance, target: null } },
			{ ...record, provenance: { ...provenance, sources: provenance.sources.map(({ path, contentHash }) => ({ path, contentHash })) } },
			{ ...record, provenance: { ...provenance, sources: provenance.sources.map((source) => ({ ...source, text: "SECRET" })) } },
			Object.defineProperty({ ...record }, "canonicalText", { get: getter }), Object.assign(Object.create(record) as object, {}), null,
		];
		hostile.forEach((value, index) => expect(fakeProverbFragmentInputFromRow(value as FakeProverbRowRecord).ok, String(index)).toBe(false));
		expect(fakeProverbFragmentInputFromRow({ ...record, canonicalText: "x" })).toEqual({ ok: false, reason: "invalid-canonical-text" });
		expect(getter).not.toHaveBeenCalled();
	});

	it("is structural validation, not authentication: a hand-made record of the same shape is accepted", () => {
		// VIEW1 must obtain the record from a committed batch through readFakeProverbRow().
		const forged: FakeProverbRowRecord = {
			batchId: FIXTURE_BATCH_ID, rowId: FIXTURE_ROW_ID, algorithmVersion: 1, recipeSchemaVersion: 1, recipeDataVersion: 1,
			proverbRecipeId: "offered-to", glossRecipeId: "misplaced-purpose", canonicalText: FIXTURE_CANONICAL,
			provenance: { vocabularyFingerprint: fakeProverbV4().vocabulary.fingerprint, drawMode: "uniform",
				sources: fakeProverbV4().vocabulary.sources.map((source) => ({ ...source, projectionPolicy: "p" })) },
		};
		expect(fakeProverbFragmentInputFromRow(forged)).toEqual({ ok: true, value: fakeProverbV4() });
	});
});
