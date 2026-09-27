import { describe, expect, it, vi } from "vitest";
import { readCurrentSourceText } from "../src/application/currentSourceText";

describe("readCurrentSourceText", () => {
	it("prefers the editor buffer over the saved contents", async () => {
		const readSavedText = vi.fn(async () => "saved body");
		const text = await readCurrentSourceText("note.md", {
			readEditorText: () => "unsaved body",
			readSavedText,
		});

		expect(text).toBe("unsaved body");
		expect(readSavedText).not.toHaveBeenCalled();
	});

	it("treats an empty editor buffer as a real body", async () => {
		const readSavedText = vi.fn(async () => "saved body");
		const text = await readCurrentSourceText("note.md", {
			readEditorText: () => "",
			readSavedText,
		});

		expect(text).toBe("");
		expect(readSavedText).not.toHaveBeenCalled();
	});

	it("reads the saved contents only when no editor holds the note", async () => {
		const readSavedText = vi.fn(async (path: string) => `saved:${path}`);
		const text = await readCurrentSourceText("folder/note.md", {
			readEditorText: () => null,
			readSavedText,
		});

		expect(text).toBe("saved:folder/note.md");
		expect(readSavedText).toHaveBeenCalledTimes(1);
		expect(readSavedText).toHaveBeenCalledWith("folder/note.md");
	});

	it("asks the editor for the same path it was given", async () => {
		const readEditorText = vi.fn(() => "body");
		await readCurrentSourceText("folder/小説断片.md", {
			readEditorText,
			readSavedText: async () => "unused",
		});

		expect(readEditorText).toHaveBeenCalledWith("folder/小説断片.md");
	});

	it("propagates an unresolvable path instead of inventing a body", async () => {
		await expect(
			readCurrentSourceText("gone.md", {
				readEditorText: () => null,
				readSavedText: async () => {
					throw new Error("The source note is no longer available.");
				},
			}),
		).rejects.toThrow(/no longer available/);
	});
});
