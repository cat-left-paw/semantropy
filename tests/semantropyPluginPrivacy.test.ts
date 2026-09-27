import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { SemantropyPlugin } from "../src/SemantropyPlugin";
import type { SemantropyTokenizerHost } from "../src/SemantropyPlugin";

const NOTE_TEXT = "秘密の本文・この内容はconsoleへ出さない";
const ABSOLUTE_PATH = "/Users/hidden/private-vault/秘密.md";

class PrivacyTestPlugin extends SemantropyPlugin {
	protected createTokenizer(): SemantropyTokenizerHost {
		throw new Error("Tokenizer is not used by this test.");
	}
}

function createPlugin(error: Error): SemantropyPlugin {
	const app = {
		vault: {
			getAbstractFileByPath: () => null,
			create: async () => {
				throw new Error("not used");
			},
			process: async () => {
				throw new Error("not used");
			},
		},
		workspace: {
			getActiveViewOfType: () => null,
			getLeavesOfType: () => [],
			getLeaf: () => ({
				setViewState: async () => {
					throw error;
				},
			}),
			setActiveLeaf: () => undefined,
		},
	} as unknown as App;
	return new PrivacyTestPlugin(app, { id: "semantropy" } as never);
}

describe("SemantropyPlugin Open privacy boundary", () => {
	it("logs only a fixed message when the outer Open catch receives sensitive error data", async () => {
		const plugin = createPlugin(
			new Error(`${NOTE_TEXT}\nfailed at ${ABSOLUTE_PATH}`),
		);
		const calls: unknown[][] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => {
			calls.push(args);
		};
		try {
			await (
				plugin as unknown as { openSemantropy(): Promise<void> }
			).openSemantropy();
		} finally {
			console.error = original;
		}

		expect(calls).toEqual([["[Semantropy] failed to open the view"]]);
		const serialized = JSON.stringify(calls);
		expect(serialized).not.toContain(NOTE_TEXT);
		expect(serialized).not.toContain(ABSOLUTE_PATH);
		expect(serialized).not.toContain("private-vault");
	});
});
