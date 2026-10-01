// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { WebCollectionStorage } from "../src/host/webCollectionStorage";
import { WebLibrary, type LibraryEvent } from "../src/host/WebLibrary";

describe("WebCollectionStorage", () => {
	it("keeps the three CollectionStorage outcomes the repository relies on", async () => {
		const storage = new WebCollectionStorage(window.localStorage);
		const path = "Semantropy Fragments.md";
		storage.clear(path);
		expect(await storage.inspect(path)).toEqual({ status: "missing" });
		expect(await storage.process(path, (text) => text + "x")).toEqual({ status: "missing" });
		expect(await storage.create(path, "a")).toEqual({ status: "created" });
		expect(await storage.create(path, "b")).toEqual({ status: "already-exists" });
		expect(await storage.inspect(path)).toEqual({ status: "markdown" });
		expect(await storage.process(path, (text) => text + "\nb")).toEqual({ status: "processed" });
		expect(storage.read(path)).toBe("a\nb");
		expect(new WebCollectionStorage(window.localStorage).read(path)).toBe("a\nb");
		expect(await storage.create("notes.txt", "")).toEqual({ status: "created" });
		expect(await storage.inspect("notes.txt")).toEqual({ status: "non-markdown" });
	});

	it("reports a failed write and keeps the previous contents", async () => {
		const failing = { getItem: () => null, setItem: () => { throw new Error("quota"); } } as unknown as Storage;
		const storage = new WebCollectionStorage(failing);
		expect(await storage.create("c.md", "x")).toEqual({ status: "failed" });
		expect(await storage.inspect("c.md")).toEqual({ status: "missing" });
	});
});

describe("WebLibrary", () => {
	it("adds user documents under unique paths and reports edits and removals", () => {
		const library = new WebLibrary([]);
		const events: LibraryEvent[] = [];
		library.onEvent((event) => events.push(event));
		const first = library.add("メモ", "本文");
		const second = library.add("メモ", "");
		expect(first).toBe("文章/メモ.md");
		expect(second).toBe("文章/メモ 2.md");
		library.setText(first, "新しい本文");
		library.setText(first, "新しい本文");
		library.remove(second);
		expect(events.filter((event) => event.kind !== "listed")).toEqual([
			{ kind: "changed", path: first, text: "新しい本文" },
			{ kind: "lost", path: second },
		]);
	});

	it("never writes a separator, a link character or a control character into a path", () => {
		const library = new WebLibrary([]);
		expect(library.add("a/b[c]\u0001#d", "")).toBe("文章/a b c d.md");
	});

	it("fetches a preset once, on first read, and keeps it read-only", async () => {
		const fetchMock = vi.fn(async () => new Response("# 題\n\n本文"));
		vi.stubGlobal("fetch", fetchMock);
		try {
			const library = new WebLibrary([{ id: "p", title: "題", author: "著者", url: "presets/p.txt", credit: "", chars: 5 }]);
			const path = "青空文庫/著者/題.md";
			expect(library.peekText(path)).toBeNull();
			const [a, b] = await Promise.all([library.readText(path), library.readText(path)]);
			expect(a).toBe("# 題\n\n本文");
			expect(b).toBe(a);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			library.setText(path, "changed");
			library.remove(path);
			expect(library.peekText(path)).toBe(a);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
