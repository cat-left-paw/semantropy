import { beforeAll, expect, it } from "vitest";
import { analyzeManualMorphSource, buildManualMorphVocabulary, readManualMorphVocabularySources } from "../../src/transform/manualMorphology";
import { transformWithVocabularySnapshot } from "../../src/vocabulary/vocabularySnapshot";
import { assertBodySemantropy } from "../../src/settings/bodySemantropy";
import { ALL, NOUN, prepare } from "../automaticPosFixtures";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";
let tokenize: Tokenize;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });
async function owner(text: string, path: string, mode: "uniform" | "frequency" = "uniform") {
	const analyzed = await analyzeManualMorphSource({ text, sourcePath: path, tokenizer: { tokenize: async text => tokenize(text) } });
	if (analyzed.status !== "ready") throw new Error("analysis");
	return buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: mode });
}
it.each([
	["歩く。", "書く。", "書く。"],
	["歩く。", "走る。", "歩く。"],
	["書いて。", "描いて。", "描いて。"],
	["暑い", "美しい。", "美しい"],
	["暑くて。", "高くない。", "高くて。"],
	["暑く。", "高くない。", "暑く。"],
	["ゆっくりと歩く。", "じっくり歩く。", "じっくりと歩く。"],
	["ゆっくりと歩く。", "すぐ歩く。", "ゆっくりと歩く。"],
	["ゆっくりと歩く。", "そっと歩く。", "ゆっくりと歩く。"],
	["ゆっくり歩く。", "じっくり歩かない。", "ゆっくり歩く。"],
	["もちろん、彼は来る。", "決して、彼は来ない。", "決して、彼は来る。"],
] as const)("real dictionary Automatic output: %s / %s", async (target, source, expected) => {
	const a = await owner(target, "target.md"), b = await owner(source, "source.md");
	expect(prepare(b, a).run({ ...ALL, noun: false }).texts.join("")).toBe(expected);
});
it.each(["uniform", "frequency"] as const)("real dictionary preserves noun and verified Ruby output: %s", async mode => {
	const a = await owner("｜猫《ねこ》と犬。猫と｜星《ほし》。美しい鳥がゆっくり歩く。", "target.md", mode);
	const b = await owner("｜鳥《とり》犬。｜猫《びょう》と｜猫《ねこ》。じっくり書く。高い山。", "source.md", mode);
	for (const vocabulary of [a, b]) {
		const p = prepare(vocabulary, a), tokenSequences = readManualMorphVocabularySources(a)![0]!.runs.map(run => run.tokens);
		for (const nonce of [0, 1, 11, 0xffffffff]) for (const level of [0, 37, 100]) {
			const old = transformWithVocabularySnapshot({ tokenSequences, snapshot: vocabulary.snapshot, bodySeed: nonce, bodySemantropy: assertBodySemantropy(level), algorithmVersion: 1 });
			const actual = p.run(NOUN, nonce, level);
			expect(actual.texts).toEqual(old.texts); expect(actual.tokenSurfaces).toEqual(old.tokenSurfaces); expect(actual.selections).toEqual(old.selections);
			expect(actual.replaceableSlotCount).toBe(old.replaceableSlotCount);
		}
	}
});
