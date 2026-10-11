import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { fakeAlertWords } from "../src/fakeAlert/fakeAlertCore";
import { iAdjectiveBasicForms, NA_STEM_EXCLUDED, naAdjectiveStems, regularVerbBasicForms, type LexicalForm } from "../src/vocabulary/lexicalProjection";
import { ALERT_LEXICON, ALERT_VERBS, mintOwner, na, naStem } from "./fakeAlertCoreFixtures";
import { adjective, noun, token, verb } from "./fakeProverbCoreFixtures";

/*
 * LEXEME-SHARE1: the shared lists of a Snapshot's regular verbs, イ-adjectives
 * and ナ-adjective stems (`src/vocabulary/lexicalProjection.ts`). Fake Alert
 * reads its three pools from here; the regression oracle in fakeAlertCore.test.ts
 * shows its draws did not move.
 */

const surfaces = (list: readonly LexicalForm[]) => list.map((form) => form.surface);
const unknown = (base: ReturnType<typeof token>) => ({ ...base, isUnknown: true });

describe("the regular verbs of a Snapshot", () => {
	it("gives each regular verb once, in its basic form, and never an irregular, unadmitted or unknown one", async () => {
		const lexicon = [...ALERT_LEXICON, ...ALERT_VERBS, verb("する", "サ変・スル"), unknown(verb("走る", "五段・ラ行"))];
		const { owner } = await mintOwner(["猫は歩く。犬は歩いた。封筒を見る。猫はある。犬は来る。桜は行く。猫をする。犬は走る。"], "frequency", lexicon);
		const verbs = regularVerbBasicForms(owner.snapshot);
		// ある (suppletive 五段・ラ行), 来る (カ変), 行く (促音便), する (サ変) and the unknown 走る are refused.
		expect(surfaces(verbs)).toEqual(["歩く", "見る"]);
		// 歩く and 歩い are one lexeme: one entry with both counts and both origins, in record order.
		const walk = verbs.find((form) => form.surface === "歩く")!;
		expect(walk.frequency).toBe(2);
		expect(walk.origins).toHaveLength(2);
	});

	it("puts the basic forms in surface order even when the observed forms sort the other way", async () => {
		// 見 (見る) sorts before 見せ (見せる), but 見せる sorts before 見る: the order is the basic forms', not the records'.
		const lexicon = [...ALERT_LEXICON, verb("見", "一段", "連用形", "見る"), verb("見せ", "一段", "連用形", "見せる"), token("た", "助動詞", "*")];
		const { owner } = await mintOwner(["猫は見た。犬は見せた。"], "uniform", lexicon);
		expect(surfaces(regularVerbBasicForms(owner.snapshot))).toEqual(["見せる", "見る"]);
	});

	it("keeps nothing that is not a verb, and is empty without a regular verb", async () => {
		const { owner } = await mintOwner(["猫は封筒を観察する。"], "uniform", ALERT_LEXICON);
		expect(regularVerbBasicForms(owner.snapshot)).toEqual([]);
	});
});

describe("the イ-adjectives of a Snapshot", () => {
	it("gives each regular イ-adjective once, in its basic form, and never いい, an unknown word or a 非自立 one", async () => {
		const lexicon = [
			...ALERT_LEXICON,
			token("高かっ", "形容詞", "自立", { baseForm: "高い", conjugationType: "形容詞・アウオ段", conjugationForm: "連用タ接続" }),
			adjective("高い", "形容詞・アウオ段"), adjective("美しい"),
			token("いい", "形容詞", "自立", { baseForm: "いい", conjugationType: "形容詞・イイ", conjugationForm: "基本形" }),
			token("白い", "形容詞", "非自立", { baseForm: "白い", conjugationType: "形容詞・アウオ段", conjugationForm: "基本形" }),
			unknown(adjective("青い", "形容詞・アウオ段")), token("た", "助動詞", "*"),
		];
		const { owner } = await mintOwner(["猫は高い。犬は高かった。桜は美しい。封筒はいい。病院は白い。時計は青い。"], "frequency", lexicon);
		const adjectives = iAdjectiveBasicForms(owner.snapshot);
		expect(surfaces(adjectives)).toEqual(["美しい", "高い"]);
		expect(adjectives.find((form) => form.surface === "高い")!.frequency).toBe(2);
		// A verb is never an adjective, nor the other way round.
		expect(surfaces(regularVerbBasicForms(owner.snapshot))).toEqual([]);
	});
});

describe("the ナ-adjective stems of a Snapshot", () => {
	it("gives the stems as written, less the five 連体詞, one ending in な and anything not a 形容動詞語幹", async () => {
		const excluded = NA_STEM_EXCLUDED.map(naStem);
		const lexicon = [...ALERT_LEXICON, na, naStem("静か"), naStem("無慈悲"), naStem("かたくな"), ...excluded, noun("机"), unknown(naStem("妙"))];
		const text = "静かな猫。静かな犬。無慈悲な桜。かたくなな猫。" + NA_STEM_EXCLUDED.map((stem) => `${stem}な猫。`).join("") + "机の猫。妙な犬。";
		const { owner } = await mintOwner([text], "frequency", lexicon);
		const stems = naAdjectiveStems(owner.snapshot);
		expect(surfaces(stems)).toEqual(["無慈悲", "静か"]);
		expect(stems.find((form) => form.surface === "静か")!.frequency).toBe(2);
		for (const stem of NA_STEM_EXCLUDED) expect(surfaces(stems)).not.toContain(stem);
		expect(NA_STEM_EXCLUDED).toEqual(["おんなじ", "こんな", "そんな", "どんな", "同じ"]);
		expect(Object.isFrozen(NA_STEM_EXCLUDED)).toBe(true);
	});
});

describe("the shape of the lists", () => {
	it("is deeply frozen and in canonical surface order, leaves the Snapshot as it was, and is what Fake Alert offers", async () => {
		const lexicon = [...ALERT_LEXICON, ...ALERT_VERBS, adjective("美しい"), adjective("高い", "形容詞・アウオ段"), na, naStem("静か"), naStem("元気")];
		const { owner } = await mintOwner(["猫は歩く。犬は読む。封筒を見る。桜は美しい。病院は高い。元気な猫。静かな犬。"], "frequency", lexicon);
		const before = JSON.stringify(owner.snapshot);
		const lists = [regularVerbBasicForms(owner.snapshot), iAdjectiveBasicForms(owner.snapshot), naAdjectiveStems(owner.snapshot)];
		for (const list of lists) {
			expect(Object.isFrozen(list)).toBe(true);
			for (const form of list) expect([Object.isFrozen(form), Object.isFrozen(form.origins)]).toEqual([true, true]);
			expect(surfaces(list)).toEqual([...surfaces(list)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
		}
		expect(JSON.stringify(owner.snapshot)).toBe(before);
		// Each call builds its lists anew: nothing is cached here (Fake Alert keeps its own pools per owner).
		expect(regularVerbBasicForms(owner.snapshot)).not.toBe(lists[0]);
		expect(regularVerbBasicForms(owner.snapshot)).toEqual(lists[0]);
		const words = fakeAlertWords(owner)!;
		expect([words.verbs, words.adjectives, words.na]).toEqual(lists.map(surfaces));
	});
});

describe("the shared lists stay a pure leaf", () => {
	it("reach only the realizer leaf, and nothing of Collision, Fake Alert, Fake Proverb, the Dictionary or the UI", async () => {
		const result = await build({ entryPoints: ["src/vocabulary/lexicalProjection.ts"], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm", legalComments: "none" });
		expect(Object.keys(result.metafile.inputs).sort()).toEqual([
			"src/transform/maxRealizer.ts", "src/transform/regularConjugationTypes.ts", "src/vocabulary/lexicalProjection.ts",
		]);
		expect(result.outputFiles[0]!.text).not.toMatch(/Math\.random|Date\.now|new Date\(|fetch\(|document\.|window\.|console\.|\.tokenize\(/u);
	});
});
