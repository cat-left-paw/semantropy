import { describe, expect, it } from "vitest";
import { runDefineSelectedWord } from "../src/application/defineSelectedWord";
import { generateFakeDefinition } from "../src/dictionary/generateFakeDefinition";
import { buildDictionaryVocabularyPool } from "../src/dictionary/vocabularyPool";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import type { JapaneseToken, JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import { token } from "./tokenFixtures";

const SNAPSHOT = {
	sourcePath: "notes/桜桃.md",
	contentHash: "ab".repeat(32),
};
const CAT = token({ surface: "猫" });
const DESK = token({ surface: "机" });
const SEQUENCES = [[CAT, token({ surface: "と", pos: "助詞", detail1: "並立助詞" }), DESK]];
const SEMANTROPY = assertDictionarySemantropy(50);

function tokenizerFor(
	map: Record<string, JapaneseToken[]>,
	calls: string[],
): JapaneseTokenizer {
	return {
		tokenize: async (text) => {
			calls.push(text);
			const tokens = map[text];
			if (!tokens) {
				throw new Error(`unexpected tokenize: ${text}`);
			}
			return tokens;
		},
	};
}

describe("runDefineSelectedWord", () => {
	it("tokenizes only the selection and builds the pool from ready sequences", async () => {
		const calls: string[] = [];
		const result = await runDefineSelectedWord({
			selection: "猫",
			snapshot: SNAPSHOT,
			tokenSequences: SEQUENCES,
			dictionarySeed: 7,
			dictionarySemantropy: SEMANTROPY,
			getTokenizer: () => tokenizerFor({ 猫: [CAT] }, calls),
			isCurrent: () => true,
			getSnapshotIdentity: () => SNAPSHOT,
		});
		expect(calls).toEqual(["猫"]);
		expect(result.status).toBe("ready");
		if (result.status !== "ready") {
			return;
		}
		expect(result.pool).toEqual(buildDictionaryVocabularyPool(SEQUENCES));
		expect(result.result.outcome).toBe("generated");
		if (result.result.outcome !== "generated") {
			return;
		}
		expect(result.result.definition.length).toBeGreaterThan(0);
		expect(result.result.templateId.length).toBeGreaterThan(0);
		expect(result.result.dictionarySeed).toBe(7);
		const expected = generateFakeDefinition({
			headword: result.headword,
			pool: result.pool,
			dictionarySeed: 7,
			dictionarySemantropy: SEMANTROPY,
		});
		expect(result.result).toEqual(expected);
	});

	it("rejects surface mismatch, unknown words and non-nouns", async () => {
		const result = await runDefineSelectedWord({
			selection: "猫です",
			snapshot: SNAPSHOT,
			tokenSequences: SEQUENCES,
			dictionarySeed: 7,
			dictionarySemantropy: SEMANTROPY,
			getTokenizer: () => tokenizerFor({ 猫です: [CAT] }, []),
			isCurrent: () => true,
			getSnapshotIdentity: () => SNAPSHOT,
		});
		expect(result).toEqual({ status: "rejected", reason: "surface-mismatch" });
	});

	it("rejects multiple tokens without generating", async () => {
		const result = await runDefineSelectedWord({
			selection: "猫と机",
			snapshot: SNAPSHOT,
			tokenSequences: SEQUENCES,
			dictionarySeed: 7,
			dictionarySemantropy: SEMANTROPY,
			getTokenizer: () =>
				tokenizerFor({ "猫と机": [CAT, DESK] }, []),
			isCurrent: () => true,
			getSnapshotIdentity: () => SNAPSHOT,
		});
		expect(result).toEqual({ status: "rejected", reason: "multiple-tokens" });
	});

	it("treats getTokenizer throwing and tokenize rejecting as the same analyze error", async () => {
		const thrown = await runDefineSelectedWord({
			selection: "猫",
			snapshot: SNAPSHOT,
			tokenSequences: SEQUENCES,
			dictionarySeed: 7,
			dictionarySemantropy: SEMANTROPY,
			getTokenizer: () => {
				throw new Error("secret tokenizer path /Users/hidden/dict");
			},
			isCurrent: () => true,
			getSnapshotIdentity: () => SNAPSHOT,
		});
		const rejected = await runDefineSelectedWord({
			selection: "猫",
			snapshot: SNAPSHOT,
			tokenSequences: SEQUENCES,
			dictionarySeed: 7,
			dictionarySemantropy: SEMANTROPY,
			getTokenizer: () => ({
				tokenize: async () => {
					throw new Error("wasm exploded: 猫");
				},
			}),
			isCurrent: () => true,
			getSnapshotIdentity: () => SNAPSHOT,
		});
		expect(thrown).toEqual({ status: "error", kind: "analyze" });
		expect(rejected).toEqual({ status: "error", kind: "analyze" });
	});

	it("returns stale when a newer request wins during tokenize", async () => {
		let current = true;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pending = runDefineSelectedWord({
			selection: "猫",
			snapshot: SNAPSHOT,
			tokenSequences: SEQUENCES,
			dictionarySeed: 7,
			dictionarySemantropy: SEMANTROPY,
			getTokenizer: () => ({
				tokenize: async () => {
					await gate;
					return [CAT];
				},
			}),
			isCurrent: () => current,
			getSnapshotIdentity: () => SNAPSHOT,
		});
		current = false;
		release();
		expect(await pending).toEqual({ status: "stale" });
	});

	it("returns stale when the snapshot is replaced during tokenize", async () => {
		let identity = SNAPSHOT;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pending = runDefineSelectedWord({
			selection: "猫",
			snapshot: SNAPSHOT,
			tokenSequences: SEQUENCES,
			dictionarySeed: 7,
			dictionarySemantropy: SEMANTROPY,
			getTokenizer: () => ({
				tokenize: async () => {
					await gate;
					return [CAT];
				},
			}),
			isCurrent: () => true,
			getSnapshotIdentity: () => identity,
		});
		identity = { sourcePath: "other.md", contentHash: "cd".repeat(32) };
		release();
		expect(await pending).toEqual({ status: "stale" });
	});
});
