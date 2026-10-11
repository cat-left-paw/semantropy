import { describe, expect, it } from "vitest";
import { snapshotLexicalForms } from "../src/dictionary/snapshotLexicalForms";
import { COLLISION_IRREGULAR_VERB_LEXEMES } from "../src/collision/regularInflection";
import { fakeAlertWords } from "../src/fakeAlert/fakeAlertCore";
import { createFakeProverbAuthority } from "../src/fakeProverb/fakeProverbAuthority";
import { MAX_REALIZER_RULES, MAX_TARGET_FORM_KEYS, isMaxIrregularLexeme, realizeMaxLexeme, type MaxRealizerInput } from "../src/transform/maxRealizer";
import { regularVerbBasicForms } from "../src/vocabulary/lexicalProjection";
import { ALL, a, aux, body10, legacyShape, makeOwner, period, prepareMax, v } from "./maxCoreFixtures";
import { LEXICON, mintOwner, ok, standardSet, verb as fakeProverbVerb } from "./fakeProverbCoreFixtures";

/*
 * SHORT-OKURIGANA-EXCLUDE1. The shipped dictionary holds spellings with the okurigana left out as lexemes of their own
 * (恐る beside 恐れる, both 一段). For five 一段 verbs the kana left out is the stem's last, so "the base form less る, plus
 * the ending" builds 恐た, 割ない and 流ます: words that do not exist. The five are taken out of what the realizer and
 * Collision inflect. `Docs/max_realization_amendment2.md`.
 */

const FIVE = ["恐る", "流る", "割る", "仕掛る", "組み立る"] as const;
const MAX_ARTIFACTS = ["へるる", "のぼりつめるる", "上り詰めるる"] as const;
const ICHIDAN_EXCLUDED = [...FIVE, ...MAX_ARTIFACTS].sort();
const verbInput = (conjugationType: string, baseForm: string): MaxRealizerInput => ({ pos: "動詞", detail1: "自立", conjugationType, baseForm, isUnknown: false });
const realized = (key: (typeof MAX_TARGET_FORM_KEYS)[number], input: MaxRealizerInput) => { const result = realizeMaxLexeme(key, input); return result.realized ? result.surface : result.reason; };

describe("the realizer and the five 一段 verbs written without their stem's last kana", () => {
	it("refuses each of the five for every Target form key, so 恐た 割ない 流ます 仕掛た 組み立ます cannot be built", () => {
		const admittingIchidan = new Set(MAX_REALIZER_RULES.admits.filter(([, classes]) => classes.includes("一段")).map(([key]) => key));
		// Of the 13 keys, the four i-adjective keys, the 五段 suffix key and the だ key do not take 一段.
		expect(admittingIchidan.size).toBe(MAX_TARGET_FORM_KEYS.length - 6);
		for (const word of FIVE) {
			expect(isMaxIrregularLexeme("一段", word), word).toBe(true);
			// A key that does not take 一段 at all says so first; every other key names the exclusion.
			for (const key of MAX_TARGET_FORM_KEYS)
				expect(realized(key, verbInput("一段", word)), `${word} ${key}`).toBe(admittingIchidan.has(key) ? "irregular-lexeme" : "class-not-admitted-by-target");
		}
	});

	it("names exactly the five, the three dictionary artifacts and ある 有る 在る, and nothing else", () => {
		expect(MAX_REALIZER_RULES.irregularLexemes).toEqual([
			["五段・ラ行", ["ある", "在る", "有る"].sort()],
			["一段", ICHIDAN_EXCLUDED],
		]);
		expect(ICHIDAN_EXCLUDED).toHaveLength(8);
	});

	it("excludes the lexeme, not the spelling: the same spelling under another class, and the longer spellings, are built", () => {
		// The production tokenizer reads 割った 割らない 割って 割ります as the 五段 verb 割る (割れば, as the 一段 one).
		expect(realized("verb-ta-stem-t", verbInput("五段・ラ行", "割る"))).toBe("割っ");
		expect(realized("verb-irrealis-negation", verbInput("五段・ラ行", "割る"))).toBe("割ら");
		expect(isMaxIrregularLexeme("五段・ラ行", "割る")).toBe(false);
		for (const [word, stem] of [["恐れる", "恐れ"], ["流れる", "流れ"], ["割れる", "割れ"], ["仕掛ける", "仕掛け"], ["組み立てる", "組み立て"]] as const) {
			expect(realized("verb-ta-stem-t", verbInput("一段", word)), word).toBe(stem);
			expect(realized("verb-irrealis-negation", verbInput("一段", word)), word).toBe(stem);
		}
		// The fifteen other 一段 verbs whose spelling has a longer sibling of the same reading and the same Han characters.
		for (const word of ["並居る", "届出る", "差し出る", "差出る", "心得る", "打見る", "揺出る", "洒落る", "申し出る", "申出る", "這出る", "願い出る", "願出る", "飛び出る", "飛出る"])
			expect(realized("verb-ta-stem-t", verbInput("一段", word)), word).toBe(word.slice(0, -1));
	});
});

/** A Target with a 一段 割る in its basic form and a 一段 流れる in the past, and a Source that holds the five and some regular verbs. */
const TARGET = [v("割る", "割る", "一段", "基本形"), period, v("流れ", "流れる", "一段", "連用形"), aux("た"), period];
const SOURCE = [
	v("書く", "書く", "五段・カ行イ音便", "基本形"), period, v("食べる", "食べる", "一段", "基本形"), period, v("話す", "話す", "五段・サ行", "基本形"), period,
	...FIVE.flatMap(word => [v(word, word, "一段", "基本形"), period]),
	a("美しい", "美しい", "基本形"), period,
];
const FORBIDDEN = /^(恐|流|割|仕掛|組み立)/u;
/** What "the base form less る, plus the ending" would write for the five: spellings of no word, and the excluded basic forms. */
const NOT_WORDS = new Set(FIVE.flatMap(word => { const stem = word.slice(0, -1); return [word, stem, ...["た", "だ", "ない", "ます", "て", "ば", "よう", "れば", "ず"].map(ending => stem + ending)]; }));

describe("the Shuffle at High and MAX", () => {
	it("never offers a form of the five, and keeps the Target's own 割る and 流れた in place as positions", async () => {
		const source = await makeOwner([SOURCE]), target = await makeOwner([TARGET]), p = prepareMax(source.owner, target.owner);
		expect(p.projection.verb.lexemes.map(item => item.input.baseForm).filter(base => FIVE.includes(base as never))).toEqual([]);
		for (const level of [75, 100]) {
			let replaced = 0;
			for (let nonce = 0; nonce < 120; nonce++) {
				const result = p.run(ALL, nonce, level);
				expect(result.replaceableSlotCount, `${level}`).toBe(2);
				for (const selection of result.selections[0]!) if (selection) { expect(selection.candidate.surface).not.toMatch(FORBIDDEN); replaced++; }
				expect(result.texts.join("")).not.toMatch(/割た|割ない|割ます|流た|流ない|恐た|恐ない|仕掛た|組み立た|組み立ない/u);
			}
			// Both positions were filled by another verb on every run: the exclusion removes candidates, never positions.
			expect(replaced, `${level}`).toBe(240);
		}
	});

	it("builds the 五段 lexeme 割る from a 割った in the Source: the lexeme is excluded, not the spelling", async () => {
		const source = await makeOwner([[...SOURCE, v("割っ", "割る", "五段・ラ行", "連用タ接続"), aux("た"), period]]);
		const target = await makeOwner([[v("書い", "書く", "五段・カ行イ音便", "連用タ接続"), aux("た"), period]]), p = prepareMax(source.owner, target.owner);
		const seen = new Set<string>();
		for (let nonce = 0; nonce < 120; nonce++) for (const selection of p.run(ALL, nonce, 100).selections[0]!) if (selection) seen.add(selection.candidate.surface);
		expect(seen.has("割っ")).toBe(true);
		for (const surface of seen) expect(surface === "割っ" || !FORBIDDEN.test(surface), surface).toBe(true);
	});

	it("is Body 10 at level 50 and below: a basic 割る of the Source is still used as written", async () => {
		const source = await makeOwner([SOURCE]), target = await makeOwner([TARGET]);
		const oracle = body10(source.owner, target.owner), max = prepareMax(source.owner, target.owner);
		const basics = new Set<string>();
		for (const nonce of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) {
			const expected = oracle.run(ALL, nonce, 100), actual = max.run(ALL, nonce, 50);
			expect(actual.tokenSurfaces).toEqual(expected.tokenSurfaces);
			expect(legacyShape(actual)).toEqual(expected.selections);
			for (const surface of actual.tokenSurfaces[0]!) basics.add(surface);
		}
		expect(basics.has("割る") || [...basics].some(surface => FIVE.includes(surface as never))).toBe(true);
	});
});

describe("the other generators", () => {
	const lexicon = [...LEXICON, ...FIVE.map(word => fakeProverbVerb(word, "一段")), fakeProverbVerb("割れる", "一段"), fakeProverbVerb("恐れる", "一段"), fakeProverbVerb("心得る", "一段")];
	const text = "猫は夢を見る。犬は骨を書く。川と月を泳ぐ。星は鳥を読む。猫は月を割る。犬は川を恐る。鳥は星を流る。夢は仕掛る。骨を組み立る。猫は月を割れる。犬は川を恐れる。鳥は星を心得る。";

	it("Fake Proverb builds no form of the five: no candidate of any form is one of their lexemes", async () => {
		const { owner } = await mintOwner([text], "uniform", lexicon);
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: standardSet() }));
		const bases = new Set<string>();
		for (const form of authority.forms) for (const candidate of form.candidates) {
			expect(NOT_WORDS.has(candidate.surface), `${candidate.form} ${candidate.surface}`).toBe(false);
			for (const evidence of candidate.evidence) if (evidence.kind === "lexeme") bases.add(evidence.baseForm);
		}
		// The control: the longer spellings of the same words are offered.
		expect([...bases].filter(base => ["割れる", "恐れる", "心得る"].includes(base)).sort()).toEqual(["割れる", "心得る", "恐れる"].sort());
		for (const word of FIVE) expect(bases.has(word), word).toBe(false);
	});

	it("Fake Alert and the Fake Dictionary list no one of the five as a verb, and the shared list keeps the longer spellings", async () => {
		const { owner } = await mintOwner([text], "uniform", lexicon);
		const shared = regularVerbBasicForms(owner.snapshot).map(form => form.surface);
		const alert = fakeAlertWords(owner)!.verbs;
		const dictionary = snapshotLexicalForms(owner.snapshot, "verb").map(form => form.surface);
		for (const list of [shared, alert, dictionary]) {
			for (const word of FIVE) expect(list, word).not.toContain(word);
			for (const word of ["割れる", "恐れる", "心得る", "書く", "見る"]) expect(list, word).toContain(word);
		}
		expect([...alert].sort()).toEqual([...shared].sort());
		expect([...dictionary].sort()).toEqual([...shared].sort());
	});
});

describe("Collision and the Shuffle exclude the same 一段 lexemes", () => {
	it("holds one list for both: the Collision exclusion set equals the realizer's", () => {
		expect(COLLISION_IRREGULAR_VERB_LEXEMES.map(item => [item.conjugationType, item.baseForms])).toEqual(MAX_REALIZER_RULES.irregularLexemes);
	});
});
