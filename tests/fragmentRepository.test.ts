import { describe, expect, it, vi } from "vitest";
import type {
	CollectedFragment,
	FragmentMetadata,
} from "../src/collect/CollectedFragment";
import type {
	CollectionEntryState,
	CollectionStorage,
	CreateCollectionResult,
	ProcessCollectionResult,
} from "../src/collect/CollectionStorage";
import { MarkdownFragmentRepository } from "../src/collect/FragmentRepository";
import { serializeFragmentEntry } from "../src/collect/serializeFragmentEntry";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";
import {
	bodyCollectMetadata,
	collisionCollectInput,
	collectPath,
	collectVocabulary,
	COLLECT_FIXTURE_HASH,
} from "./collectFixtures";
import { buildCollectedFragment } from "../src/collect/CollectedFragment";

const HASH = COLLECT_FIXTURE_HASH;
const SOURCE_PATH = "folder/桜桃.md";

function fragmentWith(
	text: string,
	id: string,
	sourcePath: string = SOURCE_PATH,
	vocabularyPaths: readonly string[] = [sourcePath],
): CollectedFragment {
	const metadata: FragmentMetadata = bodyCollectMetadata({
		id,
		target: collectPath(sourcePath, HASH),
		vocabulary: collectVocabulary(vocabularyPaths, {
			sources: vocabularyPaths.map((path) => collectPath(path, HASH)),
		}),
	});
	return { text, metadata };
}

type Call = { method: string; path: string };

/**
 * A Vault of one file, with every step individually gated.
 *
 * `process` is one atomic step, exactly as `Vault.process()` is: the transform
 * runs against the contents at the moment the step is released, so a test can
 * hold one append open and prove a later one cannot read past it.
 */
function fakeStorage(options: {
	initial?: string | null;
	state?: CollectionEntryState;
	create?: () => CreateCollectionResult;
	process?: () => ProcessCollectionResult;
	gated?: boolean;
}) {
	let contents: string | null = options.initial ?? null;
	const calls: Call[] = [];
	const gates: (() => void)[] = [];

	const step = async <T>(produce: () => T): Promise<T> => {
		if (options.gated) {
			await new Promise<void>((resolve) => gates.push(resolve));
		}
		return produce();
	};

	const storage: CollectionStorage = {
		inspect: async (path) => {
			calls.push({ method: "inspect", path });
			return await step(() =>
				options.state ??
				((contents === null
					? { status: "missing" }
					: { status: "markdown" }) as CollectionEntryState),
			);
		},
		create: async (path, initial) => {
			calls.push({ method: "create", path });
			return await step(() => {
				const outcome = options.create?.() ?? { status: "created" };
				if (outcome.status === "created") {
					contents = initial;
				}
				return outcome;
			});
		},
		process: async (path, transform) => {
			calls.push({ method: "process", path });
			return await step(() => {
				const outcome = options.process?.() ?? { status: "processed" };
				if (outcome.status === "processed") {
					contents = transform(contents ?? "");
				}
				return outcome;
			});
		},
	};

	return {
		storage,
		calls,
		read: () => contents,
		set: (value: string | null) => {
			contents = value;
		},
		/** Releases queued storage steps without touching real time. */
		release: async (steps = 1) => {
			for (let step = 0; step < steps; step += 1) {
				await flush();
				gates.shift()?.();
			}
			await flush();
		},
		pendingSteps: () => gates.length,
	};
}

/** Lets queued microtasks run without touching real time. */
async function flush(turns = 8): Promise<void> {
	for (let turn = 0; turn < turns; turn += 1) {
		await Promise.resolve();
	}
}

function repositoryFor(
	storage: CollectionStorage,
	path: string | (() => string) = DEFAULT_COLLECTION_PATH,
): MarkdownFragmentRepository {
	return new MarkdownFragmentRepository(
		storage,
		typeof path === "function" ? path : () => path,
	);
}

describe("MarkdownFragmentRepository", () => {
	it("creates the collection when nothing is there", async () => {
		const vault = fakeStorage({ initial: null });
		const repository = repositoryFor(vault.storage);

		expect(await repository.append(fragmentWith("おかき的な自殺", "id-1"))).toEqual(
			{ status: "created" },
		);
		expect(vault.calls.every((call) => call.path === DEFAULT_COLLECTION_PATH)).toBe(
			true,
		);
		expect(vault.calls.some((call) => call.path === SOURCE_PATH)).toBe(false);
		expect(vault.read()).toBe(
			"---\nsemantropy-collection-version: 1\n---\n\n# Semantropy Fragments\n\n" +
				serializeFragmentEntry(fragmentWith("おかき的な自殺", "id-1")),
		);
	});

	it("initializes an existing but empty file", async () => {
		const vault = fakeStorage({ initial: "" });
		const repository = repositoryFor(vault.storage);

		expect(await repository.append(fragmentWith("ひまの封筒", "id-1"))).toEqual({
			status: "appended",
		});
		expect(vault.read()).toContain("semantropy-collection-version: 1");
		expect(vault.read()).toContain("# Semantropy Fragments");
	});

	it("appends to an existing Markdown collection", async () => {
		const existing = "# Semantropy Fragments\n\n- 既存\n";
		const vault = fakeStorage({ initial: existing });
		const repository = repositoryFor(vault.storage);

		expect(await repository.append(fragmentWith("ひまの封筒", "id-1"))).toEqual({
			status: "appended",
		});
		expect(vault.read()).toBe(
			`${existing}\n${serializeFragmentEntry(fragmentWith("ひまの封筒", "id-1"))}`,
		);
	});

	it("preserves the existing contents byte for byte", async () => {
		const existing =
			"---\nmy: frontmatter\n---\n\n#  hand  written\n\n*\todd bullet\n   trailing spaces   ";
		const vault = fakeStorage({ initial: existing });

		await repositoryFor(vault.storage).append(fragmentWith("断片", "id-1"));

		expect(vault.read()?.startsWith(existing)).toBe(true);
	});

	it("handles a file ending with no newline, one, or several", async () => {
		for (const [suffix, padding] of [
			["", "\n\n"],
			["\n", "\n"],
			["\n\n", ""],
			["\n\n\n", ""],
		] as const) {
			const existing = `- 既存${suffix}`;
			const vault = fakeStorage({ initial: existing });
			await repositoryFor(vault.storage).append(fragmentWith("断片", "id-1"));

			expect(vault.read()).toBe(
				`${existing}${padding}${serializeFragmentEntry(fragmentWith("断片", "id-1"))}`,
			);
		}
	});

	it("stores a duplicate fragment twice", async () => {
		const vault = fakeStorage({ initial: null });
		const repository = repositoryFor(vault.storage);

		await repository.append(fragmentWith("同じ言葉", "id-1"));
		await repository.append(fragmentWith("同じ言葉", "id-2"));

		expect(vault.read()?.match(/^- 同じ言葉$/gm)).toHaveLength(2);
		expect(vault.read()).toContain('"id":"id-1"');
		expect(vault.read()).toContain('"id":"id-2"');
	});

	it("never touches anything but the configured path", async () => {
		const vault = fakeStorage({ initial: null });
		const repository = repositoryFor(vault.storage, "Collected/Fragments.md");

		await repository.append(fragmentWith("断片", "id-1"));
		await repository.append(fragmentWith("断片", "id-2"));

		expect(vault.calls.length).toBeGreaterThan(0);
		for (const call of vault.calls) {
			expect(call.path).toBe("Collected/Fragments.md");
		}
		// The source note is never a destination: it is not even mentioned.
		expect(vault.calls.some((call) => call.path === SOURCE_PATH)).toBe(false);
	});

	it("reads the collection path at append time", async () => {
		const vault = fakeStorage({ initial: null });
		let path = "First.md";
		const repository = repositoryFor(vault.storage, () => path);

		await repository.append(fragmentWith("断片", "id-1"));
		path = "Second.md";
		await repository.append(fragmentWith("断片", "id-2"));

		expect(vault.calls.map((call) => call.path)).toContain("First.md");
		expect(vault.calls.map((call) => call.path)).toContain("Second.md");
	});
});

describe("MarkdownFragmentRepository conflicts", () => {
	it("refuses a folder at the configured path", async () => {
		const vault = fakeStorage({ state: { status: "folder" } });
		expect(
			await repositoryFor(vault.storage).append(fragmentWith("断片", "id-1")),
		).toEqual({ status: "conflict", reason: "folder" });
		expect(vault.calls.map((call) => call.method)).toEqual(["inspect"]);
	});

	it("refuses a non-Markdown file at the configured path", async () => {
		const vault = fakeStorage({ state: { status: "non-markdown" } });
		expect(
			await repositoryFor(vault.storage).append(fragmentWith("断片", "id-1")),
		).toEqual({ status: "conflict", reason: "non-markdown" });
		expect(vault.calls.map((call) => call.method)).toEqual(["inspect"]);
	});

	it("reports a missing parent folder rather than creating one", async () => {
		const vault = fakeStorage({
			initial: null,
			create: () => ({ status: "parent-missing" }),
		});
		expect(
			await repositoryFor(vault.storage, "missing/folder/Fragments.md").append(
				fragmentWith("断片", "id-1"),
			),
		).toEqual({ status: "conflict", reason: "parent-missing" });
		expect(vault.read()).toBeNull();
	});

	it("refuses an invalid collection path without touching storage", async () => {
		for (const path of [
			"",
			"   ",
			"/absolute.md",
			"folder\\Fragments.md",
			"../outside.md",
			"folder/",
			"Fragments.txt",
			".md",
		]) {
			const vault = fakeStorage({ initial: null });
			expect(
				await repositoryFor(vault.storage, path).append(
					fragmentWith("断片", "id-1"),
				),
			).toEqual({ status: "invalid-path" });
			expect(vault.calls).toEqual([]);
		}
	});

	it("refuses when the collection path is the source note, without touching storage", async () => {
		const vault = fakeStorage({ initial: null });
		expect(
			await repositoryFor(vault.storage, DEFAULT_COLLECTION_PATH).append(
				fragmentWith("断片", "id-1", DEFAULT_COLLECTION_PATH),
			),
		).toEqual({ status: "conflict", reason: "source-note" });
		expect(vault.calls).toEqual([]);
		expect(vault.read()).toBeNull();
	});

	it("refuses when the collection path is the first Vocabulary Source, without touching storage", async () => {
		const vault = fakeStorage({ initial: null });
		expect(
			await repositoryFor(vault.storage, "vocab-a.md").append(
				fragmentWith("断片", "id-1", "target.md", ["vocab-a.md", "vocab-b.md"]),
			),
		).toEqual({ status: "conflict", reason: "source-note" });
		expect(vault.calls).toEqual([]);
	});

	it("refuses when the collection path is a later Vocabulary Source, without touching storage", async () => {
		const vault = fakeStorage({ initial: null });
		expect(
			await repositoryFor(vault.storage, "vocab-b.md").append(
				fragmentWith("断片", "id-1", "target.md", ["vocab-a.md", "vocab-b.md"]),
			),
		).toEqual({ status: "conflict", reason: "source-note" });
		expect(vault.calls).toEqual([]);
	});

	it("deduplicates a Target that is also a Vocabulary Source before refusing", async () => {
		const vault = fakeStorage({ initial: null });
		expect(
			await repositoryFor(vault.storage, "shared.md").append(
				fragmentWith("断片", "id-1", "shared.md", ["other.md", "shared.md"]),
			),
		).toEqual({ status: "conflict", reason: "source-note" });
		expect(vault.calls).toEqual([]);
		expect(vault.read()).toBeNull();
	});

	it("refuses a Target-less collision when a Vocabulary Source is the collection path", async () => {
		const vault = fakeStorage({ initial: null });
		const fragment = buildCollectedFragment(
			collisionCollectInput({
				vocabulary: collectVocabulary(["vocab-a.md", "vocab-b.md"]),
			}),
			{ id: "id-1", created: "2026-09-05T12:34:56.000Z" },
		);
		expect(
			await repositoryFor(vault.storage, "vocab-b.md").append(fragment),
		).toEqual({ status: "conflict", reason: "source-note" });
		expect(vault.calls).toEqual([]);
		expect(vault.read()).toBeNull();
	});

	it("appends after unknown metadata and Seed-era entries without rewriting them", async () => {
		const existing =
			"# hand written\n\n- 旧断片\n" +
			"  <!-- semantropy: {\"id\":\"old\",\"type\":\"body\",\"sourcePath\":\"桜桃.md\",\"seed\":1} -->\n\n" +
			"- 未知\n" +
			"  <!-- semantropy: {\"metadataVersion\":99,\"type\":\"mystery\"} -->\n";
		const vault = fakeStorage({ initial: existing });
		expect(
			await repositoryFor(vault.storage).append(fragmentWith("新規", "id-1")),
		).toEqual({ status: "appended" });
		expect(vault.read()?.startsWith(existing)).toBe(true);
		expect(vault.read()).toContain('"metadataVersion":2');
		expect(vault.read()).toContain('"seed":1');
		expect(vault.read()).toContain('"metadataVersion":99');
	});

	it("moves on to an atomic append when the create loses a race", async () => {
		const states: CollectionEntryState[] = [
			{ status: "missing" },
			{ status: "markdown" },
		];
		const inspect = vi.fn(
			async (): Promise<CollectionEntryState> =>
				states.shift() ?? { status: "markdown" },
		);
		const process = vi.fn(
			async (
				_path: string,
				transform: (contents: string) => string,
			): Promise<ProcessCollectionResult> => {
				stored = transform(stored);
				return { status: "processed" };
			},
		);
		let stored = "# Semantropy Fragments\n\n- 先客\n";
		const storage: CollectionStorage = {
			inspect,
			create: async () => ({ status: "already-exists" }),
			process,
		};

		expect(
			await repositoryFor(storage).append(fragmentWith("断片", "id-1")),
		).toEqual({ status: "appended" });
		// It looked again rather than assuming the winner wrote a collection.
		expect(inspect).toHaveBeenCalledTimes(2);
		expect(stored).toContain("- 断片");
	});

	it("re-checks the path after a create race and can still find a conflict", async () => {
		const states: CollectionEntryState[] = [
			{ status: "missing" },
			{ status: "folder" },
		];
		const storage: CollectionStorage = {
			inspect: async () => states.shift() ?? { status: "markdown" },
			create: async () => ({ status: "already-exists" }),
			process: async () => ({ status: "processed" }),
		};

		expect(
			await repositoryFor(storage).append(fragmentWith("断片", "id-1")),
		).toEqual({ status: "conflict", reason: "folder" });
	});

	it("does not read a general create error as already-exists", async () => {
		for (const create of [
			async () => ({ status: "failed" }) as CreateCollectionResult,
			async () => {
				throw new Error("EACCES /Users/someone/Vault/Fragments.md");
			},
		]) {
			const process = vi.fn(
				async (): Promise<ProcessCollectionResult> => ({
					status: "processed",
				}),
			);
			const storage: CollectionStorage = {
				inspect: async () => ({ status: "missing" }),
				create,
				process,
			};

			expect(
				await repositoryFor(storage).append(fragmentWith("断片", "id-1")),
			).toEqual({ status: "failed" });
			// An unknown failure must not be taken as "someone else made the file".
			expect(process).not.toHaveBeenCalled();
		}
	});

	it("never reports success when the atomic append fails", async () => {
		for (const outcome of [
			{ status: "failed" },
			{ status: "missing" },
		] as ProcessCollectionResult[]) {
			const vault = fakeStorage({
				initial: "# Semantropy Fragments\n",
				process: () => outcome,
			});
			expect(
				await repositoryFor(vault.storage).append(fragmentWith("断片", "id-1")),
			).toEqual({ status: "failed" });
			expect(vault.read()).toBe("# Semantropy Fragments\n");
		}

		const notAFile = fakeStorage({
			initial: "# Semantropy Fragments\n",
			process: () => ({ status: "not-a-file" }),
		});
		expect(
			await repositoryFor(notAFile.storage).append(fragmentWith("断片", "id-1")),
		).toEqual({ status: "conflict", reason: "non-markdown" });
	});

	it("keeps the user's words and the exception's text out of a failure", async () => {
		const storage: CollectionStorage = {
			inspect: async () => {
				throw new Error(
					"ENOENT /Users/someone/Vault/folder/桜桃.md while writing おかき的な自殺",
				);
			},
			create: async () => ({ status: "created" }),
			process: async () => ({ status: "processed" }),
		};

		const result = await repositoryFor(storage).append(
			fragmentWith("おかき的な自殺", "id-1"),
		);

		expect(result).toEqual({ status: "failed" });
		const encoded = JSON.stringify(result);
		expect(encoded).not.toContain("おかき的な自殺");
		expect(encoded).not.toContain(SOURCE_PATH);
		expect(encoded).not.toContain(HASH);
		expect(encoded).not.toMatch(/ENOENT|Users|1170956989/);
	});
});

describe("MarkdownFragmentRepository concurrency", () => {
	it("hands storage one append at a time, in request order", async () => {
		const vault = fakeStorage({
			initial: "# Semantropy Fragments\n",
			gated: true,
		});
		const repository = repositoryFor(vault.storage);

		const first = repository.append(fragmentWith("一つ目", "id-1"));
		const second = repository.append(fragmentWith("二つ目", "id-2"));
		await flush();

		// Only the first append has reached storage at all.
		expect(vault.calls).toEqual([
			{ method: "inspect", path: DEFAULT_COLLECTION_PATH },
		]);

		await vault.release(2);
		expect(await first).toEqual({ status: "appended" });

		// The second could not overtake: its first call comes after the first
		// append finished both of its own.
		expect(vault.calls.map((call) => call.method)).toEqual([
			"inspect",
			"process",
			"inspect",
		]);

		await vault.release(2);
		expect(await second).toEqual({ status: "appended" });
	});

	it("keeps every concurrent append, once each, in request order", async () => {
		const vault = fakeStorage({
			initial: "# Semantropy Fragments\n",
			gated: true,
		});
		const repository = repositoryFor(vault.storage);

		const texts = ["一つ目", "二つ目", "三つ目", "四つ目"];
		const appends = texts.map((text, index) =>
			repository.append(fragmentWith(text, `id-${index + 1}`)),
		);

		// Two gated storage steps per append, released only from the test.
		await vault.release(texts.length * 2);
		expect(await Promise.all(appends)).toEqual(
			texts.map(() => ({ status: "appended" })),
		);

		const stored = vault.read() ?? "";
		expect(stored.match(/^- /gm)).toHaveLength(texts.length);
		// Present, and in the order the appends were requested.
		expect(
			[...stored.matchAll(/^- (.+)$/gm)].map((match) => match[1]),
		).toEqual(texts);
		for (let index = 1; index <= texts.length; index += 1) {
			expect(stored.match(new RegExp(`"id":"id-${index}"`, "g"))).toHaveLength(
				1,
			);
		}
	});

	it("keeps serializing appends after one of them fails", async () => {
		let attempt = 0;
		const vault = fakeStorage({
			initial: "# Semantropy Fragments\n",
			process: () => {
				attempt += 1;
				return attempt === 1
					? { status: "failed" }
					: { status: "processed" };
			},
		});
		const repository = repositoryFor(vault.storage);

		const [first, second] = await Promise.all([
			repository.append(fragmentWith("失敗", "id-1")),
			repository.append(fragmentWith("成功", "id-2")),
		]);

		expect(first).toEqual({ status: "failed" });
		expect(second).toEqual({ status: "appended" });
		expect(vault.read()).toContain("- 成功");
		expect(vault.read()).not.toContain("- 失敗");
	});
});
