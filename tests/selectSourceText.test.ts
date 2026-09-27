import { describe, expect, it, vi } from "vitest";
import { selectSourceText } from "../src/application/selectSourceText";

describe("selectSourceText", () => {
	it("prefers the editor string over disk contents", async () => {
		const readCached = vi.fn(async () => "disk text");
		const selected = await selectSourceText(
			{
				sourcePath: "note.md",
				sourceName: "note.md",
				editorText: "unsaved editor text",
			},
			readCached,
		);

		expect(selected.text).toBe("unsaved editor text");
		expect(readCached).not.toHaveBeenCalled();
	});

	it("does not fall back to disk when the editor string is empty", async () => {
		const readCached = vi.fn(async () => "disk text");
		const selected = await selectSourceText(
			{
				sourcePath: "note.md",
				sourceName: "note.md",
				editorText: "",
			},
			readCached,
		);

		expect(selected.text).toBe("");
		expect(readCached).not.toHaveBeenCalled();
	});

	it("calls the cached reader only when the editor value is unavailable", async () => {
		const readCached = vi.fn(async (sourcePath: string) => {
			expect(sourcePath).toBe("note.md");
			return "cached body";
		});
		const selected = await selectSourceText(
			{
				sourcePath: "note.md",
				sourceName: "note.md",
				editorText: null,
			},
			readCached,
		);

		expect(readCached).toHaveBeenCalledTimes(1);
		expect(readCached).toHaveBeenCalledWith("note.md");
		expect(selected).toEqual({
			sourcePath: "note.md",
			sourceName: "note.md",
			text: "cached body",
		});
	});

	it("preserves sourcePath, sourceName, and text exactly", async () => {
		const selected = await selectSourceText(
			{
				sourcePath: "folder/小説断片.md",
				sourceName: "小説断片.md",
				editorText: "# 見出し\n\n本文\t残す\n",
			},
			async () => "unused",
		);

		expect(selected.sourcePath).toBe("folder/小説断片.md");
		expect(selected.sourceName).toBe("小説断片.md");
		expect(selected.text).toBe("# 見出し\n\n本文\t残す\n");
	});
});
