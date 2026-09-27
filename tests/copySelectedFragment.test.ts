// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
	COPY_COPIED_MESSAGE,
	COPY_EMPTY_SELECTION_MESSAGE,
	COPY_FAILED_MESSAGE,
} from "../src/copy/copyMessages";
import { copySelectedFragment } from "../src/copy/copySelectedFragment";

const SECRET = "秘密の選択文字列";

describe("copySelectedFragment", () => {
	it("writes the captured string to the clipboard exactly once", async () => {
		const writeText = vi.fn(async () => undefined);
		expect(await copySelectedFragment(SECRET, { writeText })).toBe("copied");
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText).toHaveBeenCalledWith(SECRET);
	});

	it("reports failure without a second write when the clipboard rejects", async () => {
		const writeText = vi.fn(async () => {
			throw new Error("clipboard denied");
		});
		expect(await copySelectedFragment(SECRET, { writeText })).toBe("failed");
		expect(writeText).toHaveBeenCalledTimes(1);
	});

	it("does not fall back to execCommand", async () => {
		const execCommand = vi.fn(() => true);
		(
			document as unknown as { execCommand?: (command: string) => boolean }
		).execCommand = execCommand;
		const writeText = vi.fn(async () => {
			throw new Error("no clipboard");
		});
		expect(await copySelectedFragment(SECRET, { writeText })).toBe("failed");
		expect(execCommand).not.toHaveBeenCalled();
	});

	it("keeps Copy notices free of the selected string", () => {
		expect(COPY_COPIED_MESSAGE).toBe("Copied.");
		expect(COPY_EMPTY_SELECTION_MESSAGE).toBe("Nothing is selected to copy.");
		expect(COPY_FAILED_MESSAGE).toBe("Could not copy the fragment.");
		expect(COPY_COPIED_MESSAGE).not.toContain(SECRET);
		expect(COPY_EMPTY_SELECTION_MESSAGE).not.toContain(SECRET);
		expect(COPY_FAILED_MESSAGE).not.toContain(SECRET);
		expect(COPY_COPIED_MESSAGE).not.toMatch(/%s|\$\{/);
		expect(COPY_FAILED_MESSAGE).not.toMatch(/%s|\$\{/);
	});
});
