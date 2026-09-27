import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { CollectionEntryState, CollectionStorage, CreateCollectionResult, ProcessCollectionResult } from "../src/collect/CollectionStorage";
import { appendCollectionEntry, createCollectionDocument } from "../src/collect/collectionDocument";
import { escapeFragmentMarkdown } from "../src/collect/escapeFragmentMarkdown";
import { serializeFragmentEntryV3 } from "../src/collect/v3/serializeFragmentV3";
import { MarkdownFragmentRepositoryV4 } from "../src/collect/v4/FragmentRepositoryV4";
import { fragmentMetadataCommentV4, serializeFragmentEntryV4, serializeFragmentMetadataV4 } from "../src/collect/v4/serializeFragmentV4";
import { fakeProverbCanonicalText } from "../src/fakeProverb/fakeProverbText";
import { collectVocabulary } from "./collectFixtures";
import { fragmentV3 } from "./collectV3Fixtures";
import { FIXTURE_CANONICAL, fakeProverbV4, fragmentV4, inputsV4 } from "./collectV4Fixtures";

const LF = String.fromCharCode(10);
const pinned = JSON.parse(readFileSync("tests/fixtures/regression/collectV2.json", "utf8")) as { collection: string };

function memory(initial: string | null = null) {
	let contents = initial;
	const storage = {
		inspect: vi.fn(() => Promise.resolve<CollectionEntryState>({ status: contents === null ? "missing" : "markdown" })),
		create: vi.fn((_path: string, text: string) => { contents = text; return Promise.resolve<CreateCollectionResult>({ status: "created" }); }),
		process: vi.fn((_path: string, transform: (contents: string) => string) => { contents = transform(contents ?? ""); return Promise.resolve<ProcessCollectionResult>({ status: "processed" }); }),
	} satisfies CollectionStorage;
	return { storage, read: () => contents };
}

it("writes every new entry as Markdown only, on a new Collection and on an existing one", async () => {
	const unknown = `<!-- kept-tool: {"leave":true} -->${LF}- hand written <!-- semantropy: {"metadataVersion":99} -->`;
	const older = appendCollectionEntry(`${pinned.collection}${LF}${unknown}`, serializeFragmentEntryV3(fragmentV3()));
	expect(older).toContain("<!-- semantropy:");
	for (const input of inputsV4()) {
		const fragment = fragmentV4(input);
		const entry = serializeFragmentEntryV4(fragment);
		expect(entry, input.type).not.toContain("<!--");
		expect(entry, input.type).not.toContain(input.vocabulary.fingerprint);
		for (const source of input.vocabulary.sources) {
			expect(entry, `${input.type}:${source.path}`).not.toContain(source.path);
			expect(entry, `${input.type}:${source.contentHash}`).not.toContain(source.contentHash);
		}
		if ("target" in input) {
			expect(entry).not.toContain(input.target.path);
			expect(entry).not.toContain(input.target.contentHash);
		}
		expect(entry).not.toContain("nonce");
		const created = memory();
		expect(await new MarkdownFragmentRepositoryV4(created.storage, () => "collection.md").append(fragment)).toEqual({ status: "created" });
		expect(created.read()).toBe(createCollectionDocument(entry));
		expect(created.read()).toContain("semantropy-collection-version: 1");
		expect(created.read()).toContain("# Semantropy Fragments");
		expect(created.read()).not.toContain("<!--");
		const existing = memory(older);
		expect(await new MarkdownFragmentRepositoryV4(existing.storage, () => "collection.md").append(fragment)).toEqual({ status: "appended" });
		const after = existing.read()!;
		expect(Buffer.from(after).subarray(0, Buffer.byteLength(older))).toEqual(Buffer.from(older));
		expect(after.slice(older.length)).toBe(`${LF}${entry}`);
		expect(after.slice(older.length)).not.toContain("<!--");
	}
});

it("keeps fake-proverb Markdown and the literal escape of the other three types", () => {
	const proverb = fragmentV4();
	expect(serializeFragmentEntryV4(proverb)).toBe(`- **猫に小判**${LF}${LF}  > 猫が小判において月を見ることのたとえ。${LF}`);
	expect(serializeFragmentEntryV4(proverb)).toContain(FIXTURE_CANONICAL.split(LF)[0]!);
	const hostile = "**強調** > 引用 [[リンク]] #タグ <b>x</b>";
	for (const input of inputsV4()) if (input.type !== "fake-proverb") {
		const entry = serializeFragmentEntryV4(fragmentV4({ ...input, text: hostile }));
		expect(entry, input.type).toBe(`- ${escapeFragmentMarkdown(hostile)}${LF}`);
		expect(entry, input.type).not.toContain("<b>");
		expect(entry, input.type).not.toContain("<!--");
	}
	const canonical = fakeProverbCanonicalText("𠮷野家", "「月」が、星となる。");
	expect(serializeFragmentEntryV4(fragmentV4(fakeProverbV4({ text: canonical, canonicalText: canonical })))).toBe(`- **𠮷野家**${LF}${LF}  > 「月」が、星となる。${LF}`);
});

it("refuses a Collection that is a Target or Vocabulary Source before any storage call", async () => {
	for (const input of inputsV4()) {
		const paths = [...("target" in input ? [input.target.path] : []), ...input.vocabulary.sources.map(source => source.path)];
		for (const path of paths) {
			const file = memory("unchanged");
			expect(await new MarkdownFragmentRepositoryV4(file.storage, () => path).append(fragmentV4(input)), `${input.type}:${path}`).toEqual({ status: "conflict", reason: "source-note" });
			expect(file.storage.inspect).not.toHaveBeenCalled();
			expect(file.storage.create).not.toHaveBeenCalled();
			expect(file.storage.process).not.toHaveBeenCalled();
			expect(file.read()).toBe("unchanged");
		}
	}
});

it("keeps the historical comment serializers and the metadata capture", () => {
	const historical = serializeFragmentEntryV3(fragmentV3());
	expect(historical).toContain("<!-- semantropy:");
	expect(historical).toContain('"metadataVersion":3');
	const marked = fragmentV4(fakeProverbV4({ vocabulary: collectVocabulary(["a-->b&<c.md"]) }));
	const comment = fragmentMetadataCommentV4(marked.metadata);
	expect(comment).toBe(`<!-- semantropy: ${serializeFragmentMetadataV4(marked.metadata)} -->`);
	expect(comment.match(/<!--/gu)).toHaveLength(1);
	expect(comment.match(/-->/gu)).toHaveLength(1);
	expect(comment.slice("<!-- semantropy: ".length, -" -->".length)).not.toMatch(/[<>&]/u);
	expect(serializeFragmentEntryV4(marked)).not.toContain("<!--");
	expect(serializeFragmentEntryV4(marked)).not.toContain("a-->b");
	expect(() => serializeFragmentEntryV4({ text: "x", metadata: { ...fragmentV4().metadata, metadataVersion: 2 } as never })).toThrow("invalid-metadata-version");
	const proverb = fragmentV4();
	const contaminated = { ...proverb.metadata, nonce: 1, sourceText: "SOURCE-BODY" };
	expect(serializeFragmentMetadataV4(contaminated)).toBe(serializeFragmentMetadataV4(proverb.metadata));
	expect(serializeFragmentMetadataV4(contaminated)).not.toContain("SOURCE-BODY");
	const entry = serializeFragmentEntryV4({ text: proverb.text, metadata: contaminated });
	expect(entry).not.toContain("SOURCE-BODY");
	expect(entry).not.toContain("nonce");
	expect(entry).not.toContain("<!--");
});
