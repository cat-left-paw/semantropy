import { describe, expect, it } from "vitest";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";

describe("createSourceSnapshot", () => {
	it("keeps sourcePath, sourceName, and text unchanged", () => {
		const snapshot = createSourceSnapshot({
			sourcePath: "folder/小説断片.md",
			sourceName: "小説断片.md",
			text: "# 見出し\n\n本文  ",
			contentHash: "abc",
		});

		expect(snapshot.sourcePath).toBe("folder/小説断片.md");
		expect(snapshot.sourceName).toBe("小説断片.md");
		expect(snapshot.text).toBe("# 見出し\n\n本文  ");
		expect(Object.keys(snapshot)).toEqual([
			"sourcePath",
			"sourceName",
			"text",
			"contentHash",
		]);
	});

	it("does not change after the input object is mutated", () => {
		const input = {
			sourcePath: "a.md",
			sourceName: "a.md",
			text: "original",
			contentHash: "hash-1",
		};
		const snapshot = createSourceSnapshot(input);
		input.sourcePath = "mutated.md";
		input.sourceName = "mutated.md";
		input.text = "changed";
		input.contentHash = "hash-2";

		expect(snapshot).toEqual({
			sourcePath: "a.md",
			sourceName: "a.md",
			text: "original",
			contentHash: "hash-1",
		});
	});

	it("does not retain Obsidian object fields", () => {
		const snapshot = createSourceSnapshot({
			sourcePath: "note.md",
			sourceName: "note.md",
			text: "body",
			contentHash: "hash",
		});
		const encoded = JSON.stringify(snapshot);
		expect(encoded).not.toMatch(/TFile|MarkdownView|Vault|Editor/);
		expect(snapshot).not.toHaveProperty("file");
		expect(snapshot).not.toHaveProperty("vault");
		expect(snapshot).not.toHaveProperty("editor");
	});
});
