import { describe, expect, it } from "vitest";
import { analyzeSelectedSource } from "../src/application/analyzeSelectedSource";
import type { JapaneseToken, JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import { createSeededRandom } from "../src/random/seededRandom";
import { buildRecomposeCorpus, RecomposeCorpusError } from "../src/recompose/recomposeCorpus";
import { createRecomposeModel, generateRecompose, recomposeText, type RecomposeOutputUnit } from "../src/recompose/recompose";
import { token } from "./tokenFixtures";

/**
 * A tiny lexicon tokenizer: longest match over known words, anything else is
 * a one-character unknown symbol. Enough to exercise segmentation without the
 * real dictionary.
 */
const LEXICON: readonly JapaneseToken[] = [
	token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "駅" }), token({ surface: "森" }),
	token({ surface: "雨" }), token({ surface: "窓" }), token({ surface: "少年" }), token({ surface: "少女" }),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "で", pos: "助詞", detail1: "格助詞" }), token({ surface: "は", pos: "助詞", detail1: "係助詞" }),
	token({ surface: "の", pos: "助詞", detail1: "連体化" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "走っ", pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "連用タ接続", baseForm: "走る" }),
	token({ surface: "た", pos: "助動詞", conjugationType: "特殊・タ", conjugationForm: "基本形", baseForm: "た" }),
	token({ surface: "。", pos: "記号", detail1: "句点" }), token({ surface: "、", pos: "記号", detail1: "読点" }),
	token({ surface: "「", pos: "記号", detail1: "括弧開" }), token({ surface: "」", pos: "記号", detail1: "括弧閉" }),
];

const tokenizer: JapaneseTokenizer = {
	tokenize: async (text) => {
		const sorted = [...LEXICON].sort((a, b) => b.surface.length - a.surface.length);
		const out: JapaneseToken[] = [];
		for (let i = 0; i < text.length;) {
			const found = sorted.find((t) => text.startsWith(t.surface, i));
			const next = found ? { ...found } : token({ surface: text[i]!, pos: "記号", detail1: /\s/u.test(text[i]!) ? "空白" : "一般", isUnknown: true });
			out.push(next);
			i += next.surface.length;
		}
		return out;
	},
};

async function source(path: string, text: string, weight?: number) {
	const analyzed = await analyzeSelectedSource({ text, sourcePath: path, contentHash: `h:${path}`, tokenizer, mode: "target-prototype" });
	if (analyzed.status !== "ready") throw new Error("analysis failed");
	return { path, contentHash: `h:${path}`, projection: analyzed.projection, located: analyzed.located, ...(weight === undefined ? {} : { weight }) };
}

const TEXT = "# 題\n\n少年は駅で猫を見た。少女は森で犬を見た。\n猫は窓で雨を見た。犬は駅で走った。\n\n「少年は猫を見た」少女は雨を見た。";

describe("Recompose corpus", () => {
	it("keeps prose sentences, leaves headings out and ends sentences at 。 and at line breaks", async () => {
		const corpus = buildRecomposeCorpus([await source("a.md", TEXT)]);
		const sentences = corpus.sentences.map((s) => corpus.morphs.slice(s.start, s.end).map((m) => m.surface).join(""));
		expect(sentences).toEqual([
			"少年は駅で猫を見た。", "少女は森で犬を見た。", "猫は窓で雨を見た。", "犬は駅で走った。", "「少年は猫を見た」少女は雨を見た。",
		]);
		expect(corpus.sentenceOf[0]).toBe(0);
		expect(Object.isFrozen(corpus.morphs)).toBe(true);
	});

	it("refuses an empty corpus and a duplicate or non-positive source", async () => {
		await expect(source("e.md", "# 見出しだけ")).resolves.toBeDefined();
		expect(() => buildRecomposeCorpus([])).toThrow(RecomposeCorpusError);
		const a = await source("a.md", TEXT);
		expect(() => buildRecomposeCorpus([a, a])).toThrow(RecomposeCorpusError);
		expect(() => buildRecomposeCorpus([{ ...a, weight: 0 }])).toThrow(RecomposeCorpusError);
	});
});

describe("Recompose generation", () => {
	for (const method of ["joint", "ngram"] as const) {
		it(`${method}: is reproducible for one nonce and writes only corpus text`, async () => {
			const corpus = buildRecomposeCorpus([await source("a.md", TEXT)]);
			const model = createRecomposeModel(corpus, method);
			const a = generateRecompose(model, { sentences: 4, leap: 60 }, createSeededRandom(42));
			const b = generateRecompose(model, { sentences: 4, leap: 60 }, createSeededRandom(42));
			expect(a).toEqual(b);
			expect(a.filter((unit) => unit.sentenceEnd)).toHaveLength(4);
			for (const unit of a) {
				const copied = corpus.morphs.slice(unit.start, unit.end).map((m) => m.surface).join("");
				expect(copied.replace(/[「」]/gu, "")).toContain(unit.text.replace(/[「」]/gu, ""));
				expect(unit.method).toBe(method);
			}
		});

		it(`${method}: continues an unfinished sentence and balances brackets over it`, async () => {
			const corpus = buildRecomposeCorpus([await source("a.md", TEXT)]);
			const model = createRecomposeModel(corpus, method);
			const first = generateRecompose(model, { sentences: 2, leap: 100 }, createSeededRandom(3));
			const cut = first.findIndex((unit) => !unit.sentenceEnd);
			const prefix = first.slice(0, cut + 1);
			const rest = generateRecompose(model, { sentences: 1, leap: 100, prefix }, createSeededRandom(9));
			expect(rest[rest.length - 1]!.sentenceEnd).toBe(true);
			expect(rest.filter((unit) => unit.sentenceEnd)).toHaveLength(1);
			let from = prefix.length - 1;
			while (from > 0 && !prefix[from - 1]!.sentenceEnd) from -= 1;
			const sentence = recomposeText([...prefix.slice(from), ...rest]);
			expect((sentence.match(/「/gu) ?? []).length).toBe((sentence.match(/」/gu) ?? []).length);
		});
	}

	it("joint at leap 0 copies at most six segments in a row", async () => {
		const long = Array.from({ length: 20 }, (_, i) => (i % 2 ? "少年は駅で猫を森で犬を窓で雨を見た。" : "少女は森で犬を駅で猫を雨で窓を走った。")).join("\n");
		const model = createRecomposeModel(buildRecomposeCorpus([await source("l.md", long)]), "joint");
		const units = generateRecompose(model, { sentences: 20, leap: 0 }, createSeededRandom(5));
		let run = 0;
		for (const unit of units) {
			run = unit.jump ? 0 : run + 1;
			expect(run).toBeLessThanOrEqual(6);
		}
	});

	it("draws sentence starts by source weight", async () => {
		const corpus = buildRecomposeCorpus([await source("a.md", "猫は駅で走った。", 4), await source("b.md", "犬は森で走った。", 0.25)]);
		const model = createRecomposeModel(corpus, "joint");
		let a = 0;
		for (let seed = 1; seed <= 200; seed += 1) {
			const [first] = generateRecompose(model, { sentences: 1, leap: 0 }, createSeededRandom(seed));
			if (first!.source === 0) a += 1;
		}
		expect(a).toBeGreaterThan(170);
	});

	it("starts fresh instead of continuing a sentence another method was writing", async () => {
		const corpus = buildRecomposeCorpus([await source("a.md", TEXT)]);
		const joint = generateRecompose(createRecomposeModel(corpus, "joint"), { sentences: 1, leap: 50 }, createSeededRandom(1));
		const unfinished: RecomposeOutputUnit[] = [{ ...joint[0]!, sentenceEnd: false }];
		const next = generateRecompose(createRecomposeModel(corpus, "ngram"), { sentences: 1, leap: 50, prefix: unfinished }, createSeededRandom(2));
		expect(next[0]!.jump).toBe(true);
		expect(next.filter((unit) => unit.sentenceEnd)).toHaveLength(1);
	});
});
