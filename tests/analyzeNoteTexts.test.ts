import { describe, expect, it } from "vitest";
import {
	analyzeNoteTexts,
	transformAnalyzedNote,
} from "../src/application/analyzeNoteTexts";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import {
	buildVocabularyPool,
	transformTokenSequences,
} from "../src/transform/transformTokens";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { token } from "./tokenFixtures";
import { MAX } from "./readyAnalysis";

const particle = token({ surface: "は", pos: "助詞", detail1: "係助詞" });
const andParticle = token({ surface: "と", pos: "助詞", detail1: "並立助詞" });
const cat = token({ surface: "猫" });
const dog = token({ surface: "犬" });
const bird = token({ surface: "鳥" });

const table: Record<string, JapaneseToken[]> = {
	猫は: [cat, particle],
	犬と鳥: [dog, andParticle, bird],
	猫: [cat],
};

class RecordingTokenizer {
	static constructed = 0;
	readonly calls: string[] = [];

	constructor(private readonly lexicon: Record<string, JapaneseToken[]>) {
		RecordingTokenizer.constructed += 1;
	}

	async tokenize(text: string): Promise<JapaneseToken[]> {
		this.calls.push(text);
		const tokens = this.lexicon[text];
		if (!tokens) {
			throw new Error("unexpected text");
		}
		return tokens.map((item) => ({ ...item }));
	}
}

describe("analyzeNoteTexts", () => {
	it("tokenizes each text once in document order", async () => {
		RecordingTokenizer.constructed = 0;
		const tokenizer = new RecordingTokenizer(table);
		const analyzed = await analyzeNoteTexts(
			["猫は", "犬と鳥"],
			(text) => tokenizer.tokenize(text),
		);
		expect(tokenizer.calls).toEqual(["猫は", "犬と鳥"]);
		expect(analyzed.tokenSequences).toEqual([
			[cat, particle],
			[dog, andParticle, bird],
		]);
		expect(RecordingTokenizer.constructed).toBe(1);
	});

	it("keeps document order when tokenization finishes out of order", async () => {
		let finishFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		let firstStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});
		const calls: string[] = [];
		const job = analyzeNoteTexts(["猫は", "犬と鳥"], async (text) => {
			calls.push(text);
			if (text === "猫は") {
				firstStarted?.();
				await firstGate;
			}
			return table[text]!.map((item) => ({ ...item }));
		});
		await started;
		finishFirst?.();
		const analyzed = await job;
		expect(calls).toEqual(["猫は", "犬と鳥"]);
		expect(analyzed.tokenSequences.map((sequence) => sequence[0]?.surface)).toEqual(
			["猫", "犬"],
		);
	});

	it("builds one Current Note pool across text nodes", async () => {
		const analyzed = await analyzeNoteTexts(
			["猫は", "犬と鳥"],
			async (text) => table[text]!.map((item) => ({ ...item })),
		);
		expect([...analyzed.pool.values()][0]).toEqual(["猫", "犬", "鳥"]);
	});

	it("keeps tokenSequences and pool as the first analysis result", async () => {
		const analyzed = await analyzeNoteTexts(
			["猫は", "犬と鳥"],
			async (text) => table[text]!.map((item) => ({ ...item })),
		);
		const transformed = transformAnalyzedNote(analyzed, 1, MAX);
		expect(analyzed.tokenSequences).toEqual([
			[cat, particle],
			[dog, andParticle, bird],
		]);
		expect([...analyzed.pool.values()][0]).toEqual(["猫", "犬", "鳥"]);
		expect(transformed.texts).toEqual(["鳥は", "猫と犬"]);
		expect(transformed.replacementCount).toBe(3);
		expect(transformed.algorithmVersion).toBe(SEMANTROPY_ALGORITHM_VERSION);
	});

	it("uses one PRNG stream for the whole document", async () => {
		const analyzed = await analyzeNoteTexts(
			["猫は", "犬と鳥"],
			async (text) => table[text]!.map((item) => ({ ...item })),
		);
		const shared = transformAnalyzedNote(analyzed, 1, MAX);
		expect(shared.texts).toEqual(
			transformTokenSequences(analyzed.tokenSequences, analyzed.pool, 1, MAX).texts,
		);
		const independent = [
			transformTokenSequences([analyzed.tokenSequences[0]!], analyzed.pool, 1, MAX)
				.texts[0],
			transformTokenSequences([analyzed.tokenSequences[1]!], analyzed.pool, 1, MAX)
				.texts[0],
		];
		expect(independent).toEqual(["鳥は", "鳥と猫"]);
		expect(shared.texts).not.toEqual(independent);
	});

	it("returns identical texts for the same snapshot, seed, and tokens", async () => {
		const tokenize = async (text: string) =>
			table[text]!.map((item) => ({ ...item }));
		const first = transformAnalyzedNote(
			await analyzeNoteTexts(["猫は", "犬と鳥"], tokenize),
			1,
			MAX,
		);
		const second = transformAnalyzedNote(
			await analyzeNoteTexts(["猫は", "犬と鳥"], tokenize),
			1,
			MAX,
		);
		expect(first).toEqual(second);
		expect(first.texts).toEqual(["鳥は", "猫と犬"]);
	});

	it("does not mutate source texts, tokens, or the pool", async () => {
		const originals = ["猫は", "犬と鳥"];
		const analyzed = await analyzeNoteTexts(
			originals,
			async (text) => table[text]!.map((item) => ({ ...item })),
		);
		const tokensBefore = structuredClone(analyzed.tokenSequences);
		const poolBefore = [...analyzed.pool.entries()].map(([key, surfaces]) => [
			key,
			[...surfaces],
		]);
		transformAnalyzedNote(analyzed, 1, MAX);
		expect(originals).toEqual(["猫は", "犬と鳥"]);
		expect(analyzed.tokenSequences).toEqual(tokensBefore);
		expect(
			[...analyzed.pool.entries()].map(([key, surfaces]) => [key, [...surfaces]]),
		).toEqual(poolBefore);
	});

	it("keeps original texts when the pool cannot replace anything", async () => {
		const analyzed = await analyzeNoteTexts(
			["猫"],
			async () => [token({ surface: "猫" })],
		);
		const transformed = transformAnalyzedNote(analyzed, 1, MAX);
		expect(transformed.replacementCount).toBe(0);
		expect(transformed.texts).toEqual(["猫"]);
		expect(buildVocabularyPool(analyzed.tokenSequences).get("名詞\u001f一般")).toEqual(
			["猫"],
		);
	});

	it("reuses one tokenizer instance across opens", async () => {
		RecordingTokenizer.constructed = 0;
		const tokenizer = new RecordingTokenizer(table);
		await analyzeNoteTexts(["猫は"], (text) => tokenizer.tokenize(text));
		await analyzeNoteTexts(["犬と鳥"], (text) => tokenizer.tokenize(text));
		expect(RecordingTokenizer.constructed).toBe(1);
		expect(tokenizer.calls).toEqual(["猫は", "犬と鳥"]);
	});
});
