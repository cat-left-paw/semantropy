import { describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import { MarkdownFragmentRepository } from "../src/collect/FragmentRepository";
import { createObsidianCollectionStorage } from "../src/collect/obsidianCollectionStorage";
import type { CollectedFragment } from "../src/collect/CollectedFragment";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";
import { bodyCollectMetadata, collectPath, COLLECT_FIXTURE_HASH } from "./collectFixtures";

const HASH = COLLECT_FIXTURE_HASH;
const SOURCE_PATH = "notes/桜桃.md";
const NESTED_COLLECTION = "Collected/Fragments.md";

function markdownFile(path: string, storedContents = ""): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.extension = "md";
	(file as TFile & { storedContents: string }).storedContents = storedContents;
	return file;
}

function otherFile(path: string, extension: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.extension = extension;
	return file;
}

function folder(path: string): TFolder {
	const entry = new TFolder();
	entry.path = path;
	entry.name = path.slice(path.lastIndexOf("/") + 1);
	return entry;
}

function fragment(text: string, sourcePath: string = SOURCE_PATH): CollectedFragment {
	return {
		text,
		metadata: bodyCollectMetadata({
			target: collectPath(sourcePath, HASH),
			vocabulary: {
				sources: [collectPath(sourcePath, HASH)],
				fingerprint: bodyCollectMetadata().vocabulary.fingerprint,
				drawMode: "uniform",
			},
		}),
	};
}

function recordingVault(options: {
	files?: Map<string, TFile | TFolder>;
	createThrows?: Error | null;
	createWritesThenThrows?: Error | null;
	processFails?: boolean;
}) {
	const files = options.files ?? new Map<string, TFile | TFolder>();
	const contents = new Map<string, string>();
	const calls: { method: string; path: string }[] = [];
	let createCount = 0;
	let processCount = 0;
	let lookupCount = 0;

	for (const [path, entry] of files) {
		if (entry instanceof TFile) {
			const stored = (entry as TFile & { storedContents?: string })
				.storedContents;
			if (typeof stored === "string") {
				contents.set(path, stored);
			}
		}
	}

	const vault = {
		getAbstractFileByPath: (path: string) => {
			lookupCount += 1;
			return files.get(path) ?? null;
		},
		create: async (path: string, data: string) => {
			createCount += 1;
			calls.push({ method: "create", path });
			if (options.createWritesThenThrows) {
				const file = markdownFile(path, data);
				files.set(path, file);
				contents.set(path, data);
				throw options.createWritesThenThrows;
			}
			if (options.createThrows) {
				throw options.createThrows;
			}
			const file = markdownFile(path, data);
			files.set(path, file);
			contents.set(path, data);
			return file;
		},
		process: async (file: TFile, fn: (data: string) => string) => {
			processCount += 1;
			calls.push({ method: "process", path: file.path });
			if (options.processFails) {
				throw new Error("process exploded");
			}
			const next = fn(contents.get(file.path) ?? "");
			contents.set(file.path, next);
			return next;
		},
	};

	return {
		vault,
		files,
		contents,
		calls,
		createCount: () => createCount,
		processCount: () => processCount,
		lookupCount: () => lookupCount,
	};
}

function storageFor(
	vault: ReturnType<typeof recordingVault>["vault"],
	normalize: (path: string) => string = (path) => path,
) {
	return createObsidianCollectionStorage(vault, normalize);
}

describe("createObsidianCollectionStorage", () => {
	it("classifies missing, markdown, folder and non-Markdown paths", async () => {
		const md = markdownFile(DEFAULT_COLLECTION_PATH, "# hi\n");
		const dir = folder("Collected");
		const png = otherFile("clip.png", "png");
		const files = new Map<string, TFile | TFolder>([
			[DEFAULT_COLLECTION_PATH, md],
			["Collected", dir],
			["clip.png", png],
		]);
		const recorded = recordingVault({
			files,
		});
		const storage = storageFor(recorded.vault);

		expect(await storage.inspect("missing.md")).toEqual({
			status: "missing",
		});
		expect(await storage.inspect(DEFAULT_COLLECTION_PATH)).toEqual({
			status: "markdown",
		});
		expect(await storage.inspect("Collected")).toEqual({ status: "folder" });
		expect(await storage.inspect("clip.png")).toEqual({
			status: "non-markdown",
		});
	});

	it("creates a collection at the vault root", async () => {
		const recorded = recordingVault({});
		const storage = storageFor(recorded.vault);
		expect(
			await storage.create(DEFAULT_COLLECTION_PATH, "# Semantropy Fragments\n"),
		).toEqual({ status: "created" });
		expect(recorded.createCount()).toBe(1);
		expect(recorded.calls).toEqual([
			{ method: "create", path: DEFAULT_COLLECTION_PATH },
		]);
		expect(recorded.contents.get(DEFAULT_COLLECTION_PATH)).toContain(
			"# Semantropy Fragments",
		);
	});

	it("refuses to create a nested file when the parent folder is missing", async () => {
		const recorded = recordingVault({});
		const storage = storageFor(recorded.vault);
		expect(await storage.create(NESTED_COLLECTION, "entry")).toEqual({
			status: "parent-missing",
		});
		expect(recorded.createCount()).toBe(0);
		expect(recorded.calls).toEqual([]);
	});

	it("reports already-exists only when the path is occupied before create", async () => {
		const existing = markdownFile(DEFAULT_COLLECTION_PATH, "already");
		const recorded = recordingVault({
			files: new Map([[DEFAULT_COLLECTION_PATH, existing]]),
			createThrows: new Error("completely unrelated wording"),
		});
		const storage = storageFor(recorded.vault);
		expect(await storage.create(DEFAULT_COLLECTION_PATH, "ignored")).toEqual({
			status: "already-exists",
		});
		expect(recorded.createCount()).toBe(0);
	});

	it("does not treat a create that writes then rejects as already-exists", async () => {
		const recorded = recordingVault({
			createWritesThenThrows: new Error("create landed, then rejected"),
		});
		const storage = storageFor(recorded.vault);
		expect(
			await storage.create(DEFAULT_COLLECTION_PATH, "# Semantropy Fragments\n"),
		).toEqual({ status: "failed" });
		expect(recorded.createCount()).toBe(1);
		expect(recorded.processCount()).toBe(0);
		expect(recorded.contents.has(DEFAULT_COLLECTION_PATH)).toBe(true);
	});

	it("appends through Vault.process as one atomic read-modify-write", async () => {
		const file = markdownFile(DEFAULT_COLLECTION_PATH, "start\n");
		const recorded = recordingVault({
			files: new Map([[DEFAULT_COLLECTION_PATH, file]]),
		});
		const storage = storageFor(recorded.vault);
		expect(
			await storage.process(DEFAULT_COLLECTION_PATH, (contents) =>
				`${contents}next\n`,
			),
		).toEqual({ status: "processed" });
		expect(recorded.processCount()).toBe(1);
		expect(recorded.contents.get(DEFAULT_COLLECTION_PATH)).toBe("start\nnext\n");
	});

	it("does not retry after process fails", async () => {
		const file = markdownFile(DEFAULT_COLLECTION_PATH, "start\n");
		const recorded = recordingVault({
			files: new Map([[DEFAULT_COLLECTION_PATH, file]]),
			processFails: true,
		});
		const storage = storageFor(recorded.vault);
		expect(
			await storage.process(DEFAULT_COLLECTION_PATH, (contents) =>
				`${contents}next\n`,
			),
		).toEqual({ status: "failed" });
		expect(recorded.processCount()).toBe(1);
		expect(recorded.contents.get(DEFAULT_COLLECTION_PATH)).toBe("start\n");
	});

	it("never writes a path other than the one it was given", async () => {
		const recorded = recordingVault({
			files: new Map([["Collected", folder("Collected")]]),
		});
		const storage = storageFor(recorded.vault);
		await storage.create(NESTED_COLLECTION, "entry");
		expect(recorded.calls.map((call) => call.path)).toEqual([NESTED_COLLECTION]);
		expect(recorded.calls.map((call) => call.path)).not.toContain(SOURCE_PATH);
	});

	it("does not log exceptions, vault paths or contents", async () => {
		const recorded = recordingVault({
			createThrows: new Error(`failed for ${DEFAULT_COLLECTION_PATH}`),
		});
		const storage = storageFor(recorded.vault);
		const logs: unknown[][] = [];
		const originalError = console.error;
		const originalWarn = console.warn;
		const originalDebug = console.debug;
		console.error = (...args: unknown[]) => logs.push(args);
		console.warn = (...args: unknown[]) => logs.push(args);
		console.debug = (...args: unknown[]) => logs.push(args);
		try {
			await storage.create(DEFAULT_COLLECTION_PATH, "secret-body");
			await storage.process(DEFAULT_COLLECTION_PATH, (text) => text);
		} finally {
			console.error = originalError;
			console.warn = originalWarn;
			console.debug = originalDebug;
		}
		expect(JSON.stringify(logs)).not.toContain(DEFAULT_COLLECTION_PATH);
		expect(JSON.stringify(logs)).not.toContain("secret-body");
		expect(logs).toEqual([]);
	});
});

describe("Obsidian storage through the shared repository", () => {
	it("writes only the configured collection path and never the source note", async () => {
		const recorded = recordingVault({});
		const repository = new MarkdownFragmentRepository(
			storageFor(recorded.vault),
			() => DEFAULT_COLLECTION_PATH,
		);
		expect(await repository.append(fragment("おかき的な自殺"))).toEqual({
			status: "created",
		});
		expect(recorded.calls).toEqual([
			{ method: "create", path: DEFAULT_COLLECTION_PATH },
		]);
		expect(recorded.contents.has(SOURCE_PATH)).toBe(false);
		expect(recorded.contents.get(DEFAULT_COLLECTION_PATH)).toContain(
			"おかき的な自殺",
		);
		expect(recorded.contents.get(DEFAULT_COLLECTION_PATH)).not.toContain(
			"/Users/",
		);
	});

	it("refuses when the collection path is the source note, without inspecting or writing", async () => {
		const recorded = recordingVault({});
		const repository = new MarkdownFragmentRepository(
			storageFor(recorded.vault),
			() => DEFAULT_COLLECTION_PATH,
		);
		expect(
			await repository.append(
				fragment("おかき的な自殺", DEFAULT_COLLECTION_PATH),
			),
		).toEqual({ status: "conflict", reason: "source-note" });
		expect(recorded.lookupCount()).toBe(0);
		expect(recorded.createCount()).toBe(0);
		expect(recorded.processCount()).toBe(0);
		expect(recorded.calls).toEqual([]);
		expect(recorded.contents.size).toBe(0);
	});

	it("does not append after a create that writes then rejects", async () => {
		const recorded = recordingVault({
			createWritesThenThrows: new Error("create landed, then rejected"),
		});
		const repository = new MarkdownFragmentRepository(
			storageFor(recorded.vault),
			() => DEFAULT_COLLECTION_PATH,
		);
		const saved = fragment("おかき的な自殺");
		expect(await repository.append(saved)).toEqual({ status: "failed" });
		expect(recorded.createCount()).toBe(1);
		expect(recorded.processCount()).toBe(0);
		const written = recorded.contents.get(DEFAULT_COLLECTION_PATH) ?? "";
		const ids = [...written.matchAll(/"id":"([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(ids).toEqual([saved.metadata.id]);
	});
});
