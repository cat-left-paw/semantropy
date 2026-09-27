import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { CollectionStorage, CollectionEntryState, CreateCollectionResult, ProcessCollectionResult } from "../src/collect/CollectionStorage";
import { COLLECTION_DOCUMENT_VERSION, appendCollectionEntry, createCollectionDocument } from "../src/collect/collectionDocument";
import { serializeFragmentEntryV3 } from "../src/collect/v3/serializeFragmentV3";
import { MarkdownFragmentRepositoryV4 } from "../src/collect/v4/FragmentRepositoryV4";
import type { CollectedFragmentV4 } from "../src/collect/v4/CollectedFragmentV4";
import { serializeFragmentEntryV4 } from "../src/collect/v4/serializeFragmentV4";
import { fakeProverbCanonicalText } from "../src/fakeProverb/fakeProverbText";
import { collectVocabulary } from "./collectFixtures";
import { fragmentV3 } from "./collectV3Fixtures";
import { FIXTURE_CANONICAL, fakeProverbV4, fragmentV4, inputsV4 } from "./collectV4Fixtures";

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const pinned = JSON.parse(readFileSync("tests/fixtures/regression/collectV2.json", "utf8")) as { collection: string };

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
const repositoryAt = (file: ReturnType<typeof memory>, path = "collection.md") => new MarkdownFragmentRepositoryV4(file.storage, () => path);

it("keeps collection document version 1 when it creates the Collection", async () => {
	expect(COLLECTION_DOCUMENT_VERSION).toBe(1);
	for (const input of inputsV4()) {
		const file = memory(), fragment = fragmentV4(input);
		expect(await repositoryAt(file).append(fragment)).toEqual({ status: "created" });
		expect(file.read()).toBe(`---${LF}semantropy-collection-version: 1${LF}---${LF}${LF}# Semantropy Fragments${LF}${LF}${serializeFragmentEntryV4(fragment)}`);
	}
});

it("preserves v2 and v3 entries and unknown comments byte for byte before padding", async () => {
	const unknown = `<!-- another-tool: {"keep":true} -->${LF}- hand written <!-- semantropy: {"metadataVersion":99} -->`;
	const base = appendCollectionEntry(`${pinned.collection}${LF}${unknown}`, serializeFragmentEntryV3(fragmentV3()));
	for (const ending of ["", LF, `${LF}${LF}`, CRLF, `${CRLF}${CRLF}`]) for (const input of inputsV4()) {
		const before = base + ending, file = memory(before), fragment = fragmentV4(input);
		expect(await repositoryAt(file).append(fragment)).toEqual({ status: "appended" });
		const after = file.read()!;
		expect(Buffer.from(after).subarray(0, Buffer.byteLength(before))).toEqual(Buffer.from(before));
		expect(after.slice(before.length)).toMatch(/^\n{0,2}- /u);
		expect(after.endsWith(serializeFragmentEntryV4(fragment))).toBe(true);
		expect(after).toBe(appendCollectionEntry(before, serializeFragmentEntryV4(fragment)));
	}
});

it("writes fake-proverb canonical Markdown into a new and an existing Collection (review 1, P1)", async () => {
	const [proverb = "", blank = "", gloss = ""] = FIXTURE_CANONICAL.split(LF);
	const expectedBody = [`- ${proverb}`, blank, `  ${gloss}`].join(LF);
	const created = memory();
	expect(await repositoryAt(created).append(fragmentV4())).toEqual({ status: "created" });
	expect(created.read()).toContain(`${LF}${LF}${expectedBody}${LF}`);
	expect(created.read()).not.toContain("<!-- semantropy:");
	const existing = memory(serializeFragmentEntryV3(fragmentV3()));
	expect(await repositoryAt(existing).append(fragmentV4())).toEqual({ status: "appended" });
	expect(existing.read()!.startsWith(serializeFragmentEntryV3(fragmentV3()))).toBe(true);
	expect(existing.read()!.slice(serializeFragmentEntryV3(fragmentV3()).length)).not.toContain("<!-- semantropy:");
	expect(existing.read()).toContain(`${LF}${expectedBody}${LF}`);
});

it("refuses a hostile canonical text with no storage call", async () => {
	const fragment = fragmentV4();
	for (const text of [fakeProverbCanonicalText("[[猫]]", "月"), fakeProverbCanonicalText("猫", "<b>月</b>"), `**猫**${LF}${LF}> 月${LF}${LF}- 余分`]) {
		const file = memory(), path = vi.fn(() => "collection.md");
		const hostile = { text, metadata: { ...fragment.metadata, canonicalText: text } } as CollectedFragmentV4;
		expect(await new MarkdownFragmentRepositoryV4(file.storage, path).append(hostile)).toEqual({ status: "failed" });
		noStorage(file.storage); expect(path).not.toHaveBeenCalled();
	}
});

it("refuses every Target before any storage call", async () => {
	for (const input of inputsV4()) if ("target" in input) {
		const file = memory("unchanged");
		expect(await repositoryAt(file, input.target.path).append(fragmentV4(input))).toEqual({ status: "conflict", reason: "source-note" });
		noStorage(file.storage); expect(file.read()).toBe("unchanged");
	}
	expect(fakeProverbV4()).not.toHaveProperty("target");
});

it("refuses every Vocabulary Source of every type, including a Target-less Selected Notes set, before storage", async () => {
	const many = fakeProverbV4({ vocabulary: collectVocabulary(Array.from({ length: 8 }, (_, index) => `folder/note-${index}.md`)) });
	for (const input of [...inputsV4(), many]) for (const source of input.vocabulary.sources) {
		const file = memory("unchanged"), path = vi.fn(() => source.path);
		expect(await new MarkdownFragmentRepositoryV4(file.storage, path).append(fragmentV4(input))).toEqual({ status: "conflict", reason: "source-note" });
		noStorage(file.storage); expect(file.read()).toBe("unchanged"); expect(path).toHaveBeenCalledTimes(1);
	}
	// A path that is only similar is not a Source.
	const file = memory("unchanged");
	expect(await repositoryAt(file, "folder/note-0.md.md").append(fragmentV4(many))).toEqual({ status: "appended" });
});

it("captures bytes and protected paths together before enqueue", async () => {
	for (const input of inputsV4()) {
		const raw = structuredClone(fragmentV4(input)), file = memory("unchanged");
		const destination = raw.metadata.vocabulary.sources[2]!.path;
		const pending = repositoryAt(file, destination).append(raw);
		(raw.metadata.vocabulary.sources[2] as { path: string }).path = "different.md";
		expect(await pending).toEqual({ status: "conflict", reason: "source-note" }); noStorage(file.storage);
	}
	const raw = structuredClone(fragmentV4()), file = memory("");
	const expected = serializeFragmentEntryV4(raw), pending = repositoryAt(file).append(raw);
	const other = fakeProverbCanonicalText("犬に論語", "犬が論語において星を読むことのたとえ。");
	(raw as { text: string }).text = other;
	(raw.metadata as { canonicalText: string }).canonicalText = other;
	(raw.metadata as { rowId: string }).rowId = "f".repeat(64);
	expect(await pending).toEqual({ status: "appended" });
	expect(file.read()).toBe(createCollectionDocument(expected));
	expect(file.read()).toContain(FIXTURE_CANONICAL.split(LF)[0]!.slice(2, -2));
	expect(file.read()).not.toContain("f".repeat(64));
});

it("refuses a root text that differs from canonicalText, and invalid values, without storage", async () => {
	const fragment = fragmentV4();
	const invalid = [
		null, {}, { text: fakeProverbCanonicalText("犬", "月"), metadata: fragment.metadata }, { text: `${fragment.text}${LF}`, metadata: fragment.metadata },
		{ text: fragment.text, metadata: { ...fragment.metadata, rowSlotId: "s" } }, { text: fragment.text, metadata: { ...fragment.metadata, nonce: 1 } },
		{ text: fragment.text, metadata: { ...fragment.metadata, id: "bad" } }, { text: fragment.text, metadata: { ...fragment.metadata, metadataVersion: 3 } },
		{ ...fragment, draft: {} }, Object.defineProperty({ ...fragment }, "text", { get: () => { throw new Error("SECRET"); } }),
	];
	for (const value of invalid) {
		const file = memory(), path = vi.fn(() => "collection.md");
		expect(await new MarkdownFragmentRepositoryV4(file.storage, path).append(value as CollectedFragmentV4)).toEqual({ status: "failed" });
		noStorage(file.storage); expect(path).not.toHaveBeenCalled();
	}
	const file = memory();
	expect(await new MarkdownFragmentRepositoryV4(file.storage, () => { throw new Error("SECRET"); }).append(fragment)).toEqual({ status: "failed" });
	noStorage(file.storage);
});

it.each(["", "../collection.md", "/collection.md", "collection.txt"])("refuses invalid destination %s before storage", async (path) => {
	const file = memory(); expect(await repositoryAt(file, path).append(fragmentV4())).toEqual({ status: "invalid-path" }); noStorage(file.storage);
});

it.each(["folder", "non-markdown"] as const)("reports %s without writing", async (status) => {
	const file = memory(); vi.mocked(file.storage.inspect).mockResolvedValue({ status });
	expect(await repositoryAt(file).append(fragmentV4())).toEqual({ status: "conflict", reason: status });
	expect(file.storage.inspect).toHaveBeenCalledTimes(1); expect(file.storage.create).not.toHaveBeenCalled(); expect(file.storage.process).not.toHaveBeenCalled();
});

it("handles only a confirmed create race by reinspecting and appending once", async () => {
	for (const recheck of ["markdown", "folder", "non-markdown", "missing"] as const) {
		const file = memory();
		vi.mocked(file.storage.inspect).mockResolvedValueOnce({ status: "missing" }).mockResolvedValueOnce({ status: recheck });
		vi.mocked(file.storage.create).mockImplementation(() => { file.set(`other writer${CRLF}`); return Promise.resolve({ status: "already-exists" }); });
		const result = await repositoryAt(file).append(fragmentV4());
		expect(result).toEqual(recheck === "markdown" ? { status: "appended" } : recheck === "missing" ? { status: "failed" } : { status: "conflict", reason: recheck });
		expect(file.storage.inspect).toHaveBeenCalledTimes(2); expect(file.storage.create).toHaveBeenCalledTimes(1);
		expect(file.storage.process).toHaveBeenCalledTimes(recheck === "markdown" ? 1 : 0);
		if (recheck === "markdown") expect(file.read()).toBe(appendCollectionEntry(`other writer${CRLF}`, serializeFragmentEntryV4(fragmentV4())));
	}
});

it("never retries an uncertain inspect, create or process failure", async () => {
	for (const operation of ["inspect", "create", "process"] as const) for (const throws of [false, true]) {
		const file = memory(operation === "process" ? "existing" : null);
		if (throws) vi.mocked(file.storage[operation]).mockRejectedValue(new Error("SECRET"));
		else if (operation === "inspect") continue;
		else if (operation === "create") file.storage.create.mockResolvedValue({ status: "failed" });
		else file.storage.process.mockResolvedValue({ status: "failed" });
		expect(await repositoryAt(file).append(fragmentV4())).toEqual({ status: "failed" });
		expect(file.storage.inspect).toHaveBeenCalledTimes(1);
		expect(file.storage[operation]).toHaveBeenCalledTimes(1);
	}
});

it("reports parent missing and a file removed during process", async () => {
	const file = memory(); vi.mocked(file.storage.create).mockResolvedValue({ status: "parent-missing" });
	expect(await repositoryAt(file).append(fragmentV4())).toEqual({ status: "conflict", reason: "parent-missing" });
	for (const status of ["missing", "not-a-file"] as const) {
		const existing = memory("existing"); vi.mocked(existing.storage.process).mockResolvedValue({ status });
		expect(await repositoryAt(existing).append(fragmentV4())).toEqual(status === "missing" ? { status: "failed" } : { status: "conflict", reason: "non-markdown" });
		expect(existing.storage.create).not.toHaveBeenCalled();
	}
});

it("serializes concurrent appends of every type in request order and continues after a failure and a conflict", async () => {
	const file = memory("start");
	// The destination is read when each queued request runs; the fifth one is a Vocabulary Source.
	let calls = 0;
	const destination = vi.fn(() => (++calls === 5 ? "a.md" : "collection.md"));
	const repository = new MarkdownFragmentRepositoryV4(file.storage, destination);
	let release!: () => void;
	vi.mocked(file.storage.inspect).mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ status: "markdown" }); }));
	vi.mocked(file.storage.process).mockResolvedValueOnce({ status: "failed" });
	const rows = Array.from({ length: 16 }, (_, index) => fragmentV4(fakeProverbV4({ rowId: index.toString(16).padStart(64, "e") })));
	const fragments = [...rows.slice(0, 8), ...inputsV4().map((input) => fragmentV4(input)), ...rows.slice(8)];
	const pending = fragments.map((fragment) => repository.append(fragment));
	await Promise.resolve();
	expect(file.storage.inspect).toHaveBeenCalledTimes(1); expect(file.storage.process).not.toHaveBeenCalled(); expect(destination).toHaveBeenCalledTimes(1);
	release();
	const expectedResults = fragments.map((_, index) => (index === 0 ? { status: "failed" } : index === 4 ? { status: "conflict", reason: "source-note" } : { status: "appended" }));
	expect(await Promise.all(pending)).toEqual(expectedResults);
	const written = fragments.filter((_, index) => index !== 0 && index !== 4);
	expect(file.read()).toBe(written.reduce((text, fragment) => appendCollectionEntry(text, serializeFragmentEntryV4(fragment)), "start"));
	expect(file.storage.process).toHaveBeenCalledTimes(fragments.length - 1);
	expect(file.storage.inspect).toHaveBeenCalledTimes(fragments.length - 1);
});
