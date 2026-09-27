import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { CollectionStorage, CollectionEntryState, CreateCollectionResult, ProcessCollectionResult } from "../src/collect/CollectionStorage";
import { MarkdownFragmentRepositoryV3 } from "../src/collect/v3/FragmentRepositoryV3";
import type { CollectedFragmentV3 } from "../src/collect/v3/CollectedFragmentV3";
import { serializeFragmentEntryV3 } from "../src/collect/v3/serializeFragmentV3";
import { buildCollectedFragment, type CollectFragmentInput } from "../src/collect/CollectedFragment";
import { serializeFragmentEntry } from "../src/collect/serializeFragmentEntry";
import { COLLECTION_DOCUMENT_VERSION, appendCollectionEntry, createCollectionDocument } from "../src/collect/collectionDocument";
import { bodyV3, fragmentV3, identityV3, inputsV3 } from "./collectV3Fixtures";

const pinned = JSON.parse(readFileSync("tests/fixtures/regression/collectV2.json", "utf8")) as {
	identity: typeof identityV3; entries: { input: CollectFragmentInput; bytes: string }[]; collection: string;
};
function memory(initial: string | null = null) {
	let contents = initial;
	const storage = {
		inspect: vi.fn(() => Promise.resolve<CollectionEntryState>({ status: contents === null ? "missing" : "markdown" })),
		create: vi.fn((_path: string, text: string) => { contents = text; return Promise.resolve<CreateCollectionResult>({ status: "created" }); }),
		process: vi.fn((_path: string, transform: (contents: string) => string) => { contents = transform(contents ?? ""); return Promise.resolve<ProcessCollectionResult>({ status: "processed" }); }),
	} satisfies CollectionStorage;
	return { storage, read: () => contents, set: (text: string) => { contents = text; } };
}
function noStorage(storage: ReturnType<typeof memory>["storage"]) {
	expect(storage.inspect).not.toHaveBeenCalled(); expect(storage.create).not.toHaveBeenCalled(); expect(storage.process).not.toHaveBeenCalled();
}
it("pins v2 automatic, Manual, dictionary and collision serializer bytes", () => {
	for (const entry of pinned.entries) {
		expect(serializeFragmentEntry(buildCollectedFragment(entry.input, pinned.identity))).toBe(entry.bytes);
		expect(entry.bytes).toContain('"metadataVersion":2');
		expect(entry.bytes).not.toContain("automaticPartsOfSpeech");
	}
});
it("keeps collection document version 1", async () => {
	expect(COLLECTION_DOCUMENT_VERSION).toBe(1);
	const file = memory(), fragment = fragmentV3();
	expect(await new MarkdownFragmentRepositoryV3(file.storage, () => "collection.md").append(fragment)).toEqual({ status: "created" });
	expect(file.read()).toBe(`---\nsemantropy-collection-version: 1\n---\n\n# Semantropy Fragments\n\n${serializeFragmentEntryV3(fragment)}`);
});
it("preserves mixed v2 entries and unknown comments byte for byte before padding", async () => {
	for (const ending of ["", "\n", "\n\n", "\r\n", "\r\n\r\n"]) {
		const before = pinned.collection + ending, file = memory(before), fragment = fragmentV3();
		expect(await new MarkdownFragmentRepositoryV3(file.storage, () => "collection.md").append(fragment)).toEqual({ status: "appended" });
		const after = file.read()!;
		expect(Buffer.from(after).subarray(0, Buffer.byteLength(before))).toEqual(Buffer.from(before));
		expect(after.slice(before.length)).toMatch(/^\n{0,2}- /u);
		expect(after.endsWith(serializeFragmentEntryV3(fragment))).toBe(true);
	}
});
it("refuses every Target before any storage call", async () => {
	for (const input of inputsV3()) if (input.type !== "collision") {
		const file = memory("unchanged"), repository = new MarkdownFragmentRepositoryV3(file.storage, () => input.target.path);
		expect(await repository.append(fragmentV3(input))).toEqual({ status: "conflict", reason: "source-note" });
		noStorage(file.storage); expect(file.read()).toBe("unchanged");
	}
});
it("refuses every Vocabulary Source of every type before storage", async () => {
	for (const input of inputsV3()) for (const source of input.vocabulary.sources) {
		const file = memory("unchanged"), repository = new MarkdownFragmentRepositoryV3(file.storage, () => source.path);
		expect(await repository.append(fragmentV3(input))).toEqual({ status: "conflict", reason: "source-note" });
		noStorage(file.storage); expect(file.read()).toBe("unchanged");
	}
});
it("captures bytes and protected paths together before enqueue", async () => {
	const raw = structuredClone(fragmentV3()), file = memory("unchanged");
	const destination = raw.metadata.vocabulary.sources[2]!.path;
	const pending = new MarkdownFragmentRepositoryV3(file.storage, () => destination).append(raw);
	(raw.metadata.vocabulary.sources[2] as { path: string }).path = "different.md";
	expect(await pending).toEqual({ status: "conflict", reason: "source-note" }); noStorage(file.storage);
	const raw2 = structuredClone(fragmentV3()), file2 = memory("");
	const expected = serializeFragmentEntryV3(raw2), pending2 = new MarkdownFragmentRepositoryV3(file2.storage, () => "collection.md").append(raw2);
	(raw2 as { text: string }).text = "changed";
	expect(await pending2).toEqual({ status: "appended" }); expect(file2.read()).toBe(createCollectionDocument(expected));
});
it("refuses invalid repository values without storage and catches path-source errors", async () => {
	const file = memory();
	const repository = new MarkdownFragmentRepositoryV3(file.storage, () => "collection.md");
	for (const input of [null, {}, { text: "a", metadata: { ...fragmentV3().metadata, nonce: 1 } }]) expect(await repository.append(input as CollectedFragmentV3)).toEqual({ status: "failed" });
	noStorage(file.storage);
	expect(await new MarkdownFragmentRepositoryV3(file.storage, () => { throw new Error("SECRET"); }).append(fragmentV3())).toEqual({ status: "failed" });
	noStorage(file.storage);
});
it.each(["", "../collection.md", "/collection.md", "collection.txt"])("refuses invalid destination %s before storage", async path => {
	const file = memory(); expect(await new MarkdownFragmentRepositoryV3(file.storage, () => path).append(fragmentV3())).toEqual({ status: "invalid-path" }); noStorage(file.storage);
});
it.each(["folder", "non-markdown"] as const)("reports %s without writing", async status => {
	const file = memory(); vi.mocked(file.storage.inspect).mockResolvedValue({ status });
	expect(await new MarkdownFragmentRepositoryV3(file.storage, () => "collection.md").append(fragmentV3())).toEqual({ status: "conflict", reason: status });
	expect(file.storage.inspect).toHaveBeenCalledTimes(1); expect(file.storage.create).not.toHaveBeenCalled(); expect(file.storage.process).not.toHaveBeenCalled();
});
it("handles only a confirmed create race by reinspecting and appending once", async () => {
	for (const recheck of ["markdown", "folder", "non-markdown", "missing"] as const) {
		const file = memory();
		vi.mocked(file.storage.inspect).mockResolvedValueOnce({ status: "missing" }).mockResolvedValueOnce({ status: recheck });
		vi.mocked(file.storage.create).mockImplementation(() => { file.set("other writer\r\n"); return Promise.resolve({ status: "already-exists" }); });
		const result = await new MarkdownFragmentRepositoryV3(file.storage, () => "collection.md").append(fragmentV3());
		expect(result).toEqual(recheck === "markdown" ? { status: "appended" } : recheck === "missing" ? { status: "failed" } : { status: "conflict", reason: recheck });
		expect(file.storage.inspect).toHaveBeenCalledTimes(2); expect(file.storage.create).toHaveBeenCalledTimes(1);
		expect(file.storage.process).toHaveBeenCalledTimes(recheck === "markdown" ? 1 : 0);
		if (recheck === "markdown") expect(file.read()).toBe(appendCollectionEntry("other writer\r\n", serializeFragmentEntryV3(fragmentV3())));
	}
});
it("never retries an uncertain create or process failure", async () => {
	for (const operation of ["inspect", "create", "process"] as const) for (const throws of [false, true]) {
		const file = memory(operation === "process" ? "existing" : null);
		if (throws) vi.mocked(file.storage[operation]).mockRejectedValue(new Error("SECRET"));
		else if (operation === "inspect") continue;
		else if (operation === "create") file.storage.create.mockResolvedValue({ status: "failed" });
		else file.storage.process.mockResolvedValue({ status: "failed" });
		expect(await new MarkdownFragmentRepositoryV3(file.storage, () => "collection.md").append(fragmentV3())).toEqual({ status: "failed" });
		expect(file.storage.inspect).toHaveBeenCalledTimes(1);
		expect(file.storage[operation]).toHaveBeenCalledTimes(1);
	}
});
it("reports parent missing and a file removed during process", async () => {
	const file = memory(); vi.mocked(file.storage.create).mockResolvedValue({ status: "parent-missing" });
	expect(await new MarkdownFragmentRepositoryV3(file.storage, () => "collection.md").append(fragmentV3())).toEqual({ status: "conflict", reason: "parent-missing" });
	for (const status of ["missing", "not-a-file"] as const) {
		const existing = memory("existing"); vi.mocked(existing.storage.process).mockResolvedValue({ status });
		expect(await new MarkdownFragmentRepositoryV3(existing.storage, () => "collection.md").append(fragmentV3())).toEqual(status === "missing" ? { status: "failed" } : { status: "conflict", reason: "non-markdown" });
		expect(existing.storage.create).not.toHaveBeenCalled();
	}
});
it("serializes concurrent appends in request order and recovers after a failure", async () => {
	const file = memory("start"), repository = new MarkdownFragmentRepositoryV3(file.storage, () => "collection.md");
	let release!: () => void;
	vi.mocked(file.storage.inspect).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ status: "markdown" }); }));
	const fragments = Array.from({ length: 20 }, (_, i) => fragmentV3(bodyV3({ text: `断片${i}` })));
	vi.mocked(file.storage.process).mockResolvedValueOnce({ status: "failed" });
	const pending = fragments.map(fragment => repository.append(fragment));
	await Promise.resolve(); expect(file.storage.inspect).toHaveBeenCalledTimes(1); expect(file.storage.process).not.toHaveBeenCalled();
	release();
	expect(await Promise.all(pending)).toEqual([{ status: "failed" }, ...fragments.slice(1).map(() => ({ status: "appended" }))]);
	expect(file.read()).toBe(fragments.slice(1).reduce((text, fragment) => appendCollectionEntry(text, serializeFragmentEntryV3(fragment)), "start"));
	expect(file.storage.process).toHaveBeenCalledTimes(20);
});
