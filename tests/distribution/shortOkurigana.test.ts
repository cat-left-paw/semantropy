import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { SLOT_BASE_FORM, SLOT_CONJUGATION_FORM, SLOT_CONJUGATION_TYPE, SLOT_DETAIL1, SLOT_POS, SLOT_READING } from "../../scripts/lindera/compactDictionary.mjs";
import { compactDir, readEntries } from "../../scripts/max/scanDictionary.mjs";
import { buildAuthenticatedCollisionLexemePool } from "../../src/collision/collisionVocabulary";
import { compileCollisionPatternSet } from "../../src/collision/compilePatternSet";
import {
	STANDARD_COLLISION_CONNECTORS, STANDARD_COLLISION_LITERALS, STANDARD_COLLISION_MODIFIER_FORMS, STANDARD_COLLISION_NOUN_SUFFIXES,
	STANDARD_COLLISION_PATTERN_DATA_VERSION, STANDARD_COLLISION_PATTERN_SCHEMA_VERSION, STANDARD_COLLISION_RECIPES,
} from "../../src/collision/generated/standardCollisionPatternEntries";
import { COLLISION_IRREGULAR_VERB_LEXEMES, inflectRegularVerb, isCollisionIrregularLexeme } from "../../src/collision/regularInflection";
import { snapshotLexicalForms } from "../../src/dictionary/snapshotLexicalForms";
import { fakeAlertWords } from "../../src/fakeAlert/fakeAlertCore";
import { createFakeProverbAuthority } from "../../src/fakeProverb/fakeProverbAuthority";
import { createManualAdverbAuthority } from "../../src/transform/manualAdverbAuthority";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { createMaxProjection } from "../../src/transform/maxCore";
import { isMaxIrregularLexeme, MAX_REALIZER_RULES } from "../../src/transform/maxRealizer";
import { enclosedTermSyntax } from "../../src/vocabulary/enclosedTerms";
import { standardSet } from "../fakeProverbCoreFixtures";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";

/*
 * SHORT-OKURIGANA-EXCLUDE1 against the shipped compact IPADIC and the production tokenizer.
 *
 * The dictionary holds spellings with the okurigana left out as lexemes of their own: 恐る beside 恐れる, both 一段 and
 * both read オソレル. A 一段 verb is inflected by "the base form less る, plus the ending", so a spelling whose stem lacks
 * its last kana builds 恐た, 割ない and 流ます. Nothing in the data tells 恐る (the stem lacks レ) from 心得る (the stem
 * is whole): the five below were picked by reading each of the 82 independent 一段 verbs with a Han character directly
 * before る. This file holds that decision against the dictionary: all 82 are listed, so a dictionary that gains a verb
 * of this shape, or loses one, fails here and the decision is taken again.
 */

/** The five whose written stem does not carry the reading of its last mora (the stem is 恐 and the reading オソレ). */
const EXCLUDED = ["仕掛る", "割る", "恐る", "流る", "組み立る"];

/** The other 77: the stem is whole, or only an okurigana inside a compound is left out (申出る for 申し出る). */
const KEPT = [
	"うかび出る", "うかれ出る", "おどり出る", "かいま見る", "かち得る", "しゃしゃり出る", "とび出る", "にじみ出る",
	"はい出る", "はみ出る", "まかり出る", "もえ出る", "やむを得る", "ゆるぎ出る", "わき出る", "下卑る",
	"並み居る", "並居る", "似る", "出る", "出来る", "勝ち得る", "名乗り出る", "吹き出る",
	"垣間見る", "夢見る", "寝る", "射る", "居る", "届け出る", "届出る", "巫山戯る",
	"差し出る", "差出る", "干る", "得る", "心得る", "打ち見る", "打って出る", "打見る",
	"抜きん出る", "抜け出る", "揺出る", "時化る", "有り得る", "歴る", "洒落る", "流れ出る",
	"浮き出る", "湧き出る", "湿気る", "煮る", "獲る", "申し出る", "申出る", "盗み見る",
	"看る", "真似る", "着る", "突き出る", "簸る", "経る", "萌え出る", "見る",
	"視る", "観る", "診る", "走り出る", "躍り出る", "這出る", "進み出る", "鋳る",
	"願い出る", "願出る", "飛び出る", "飛出る", "魂消る",
];

/** Of the 82, the 20 that have a spelling with the same Han characters, the same reading and more kana (恐れる beside 恐る). */
const WITH_LONGER_SPELLING = [
	"並居る", "仕掛る", "割る", "届出る", "差し出る", "差出る", "心得る", "打見る", "揺出る", "洒落る",
	"流る", "申し出る", "申出る", "組み立る", "這出る", "願い出る", "願出る", "飛び出る", "飛出る", "恐る",
];

const HAN = /\p{Script=Han}/u;
const hanOf = (text: string) => [...text].filter((character) => HAN.test(character)).join("");
const kanaCount = (text: string) => [...text].filter((character) => /\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)).length;

type Ichidan = { readonly baseForm: string; readonly readings: ReadonlySet<string> };

describe("the 一段 verbs with a Han character directly before る, in the shipped dictionary", () => {
	const lexemes = new Map<string, { baseForm: string; readings: Set<string> }>();
	for (const entry of readEntries(compactDir())) {
		if (entry[SLOT_POS] !== "動詞" || entry[SLOT_DETAIL1] !== "自立" || entry[SLOT_CONJUGATION_TYPE] !== "一段") continue;
		const item = lexemes.get(entry[SLOT_BASE_FORM]!) ?? { baseForm: entry[SLOT_BASE_FORM]!, readings: new Set<string>() };
		if (entry[SLOT_CONJUGATION_FORM] === "基本形") item.readings.add(entry[SLOT_READING]!);
		lexemes.set(entry[SLOT_BASE_FORM]!, item);
	}
	const ichidan: readonly Ichidan[] = [...lexemes.values()];
	const shaped = ichidan.filter((item) => {
		const characters = [...item.baseForm];
		return characters.length >= 2 && characters[characters.length - 1] === "る" && HAN.test(characters[characters.length - 2]!);
	});

	it("lists all 82: the five excluded and the 77 kept, nothing else", () => {
		expect(ichidan.length).toBe(5_901);
		expect(shaped).toHaveLength(82);
		expect(EXCLUDED).toHaveLength(5);
		expect(KEPT).toHaveLength(77);
		expect(new Set([...EXCLUDED, ...KEPT]).size).toBe(82);
		expect(shaped.map((item) => item.baseForm).sort()).toEqual([...EXCLUDED, ...KEPT].sort());
	});

	it("excludes exactly the five from the realizer and from Collision, and none of the 77", () => {
		for (const word of EXCLUDED) {
			expect(isMaxIrregularLexeme("一段", word), word).toBe(true);
			expect(isCollisionIrregularLexeme("一段", word), word).toBe(true);
			expect(inflectRegularVerb({ conjugationType: "一段", baseForm: word }), word).toBeNull();
		}
		for (const word of KEPT) {
			expect(isMaxIrregularLexeme("一段", word), word).toBe(false);
			expect(isCollisionIrregularLexeme("一段", word), word).toBe(false);
			expect(inflectRegularVerb({ conjugationType: "一段", baseForm: word })?.past, word).toBe(`${word.slice(0, -1)}た`);
		}
		// The two lists name the same 一段 lexemes: the five and the three artifacts only the realizer used to name.
		expect(MAX_REALIZER_RULES.irregularLexemes.find(([type]) => type === "一段")?.[1]).toEqual([...EXCLUDED, "へるる", "のぼりつめるる", "上り詰めるる"].sort());
		expect(COLLISION_IRREGULAR_VERB_LEXEMES.find((item) => item.conjugationType === "一段")?.baseForms).toEqual([...EXCLUDED, "へるる", "のぼりつめるる", "上り詰めるる"].sort());
	});

	it("shows the five among the 20 that have a longer spelling of the same reading, and 62 that have none", () => {
		const longer = shaped.filter((item) => ichidan.some((other) => other !== item && hanOf(other.baseForm) === hanOf(item.baseForm) && kanaCount(other.baseForm) > kanaCount(item.baseForm) &&
			[...item.readings].some((reading) => other.readings.has(reading)))).map((item) => item.baseForm);
		expect(longer.sort()).toEqual([...WITH_LONGER_SPELLING].sort());
		expect(shaped.length - longer.length).toBe(62);
		for (const word of EXCLUDED) expect(WITH_LONGER_SPELLING, word).toContain(word);
	});

	it("reads the five as a stem that lacks its last kana: the base form's reading is longer than the stem's", () => {
		// The reading of the base form is オソレル, ナガレル, ワレル, シカケル, クミタテル; the written stem 恐 流 割 仕掛 組み立 ends in a
		// Han character (or a kana that is not the last mora), so the stem's last mora レ レ レ ケ テ has no character of its own.
		const reading = new Map(shaped.map((item) => [item.baseForm, [...item.readings]]));
		expect(reading.get("恐る")).toEqual(["オソレル"]);
		expect(reading.get("流る")).toEqual(["ナガレル"]);
		expect(reading.get("割る")).toEqual(["ワレル"]);
		expect(reading.get("仕掛る")).toEqual(["シカケル"]);
		expect(reading.get("組み立る")).toEqual(["クミタテル"]);
	});
});

describe("the production tokenizer and the lexemes behind 割る", () => {
	let tokenize: Tokenize;
	beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });
	const find = (sentence: string, surface: string) => tokenize(sentence).find((token) => token.surface === surface);

	it("reads the ordinary basic form 割る as the 一段 lexeme 割る, which is why it is excluded", () => {
		for (const sentence of ["卵を割る。", "窓ガラスを割る。", "薪を割る。", "約束を割る。", "彼は壺を割る。"]) {
			const token = find(sentence, "割る");
			expect(token, sentence).toBeDefined();
			expect([token!.pos, token!.detail1, token!.baseForm, token!.conjugationType, token!.conjugationForm], sentence).toEqual(["動詞", "自立", "割る", "一段", "基本形"]);
		}
	});

	it("reads 割った 割らない 割って 割ります as the 五段 lexeme 割る, which is not excluded", () => {
		for (const [sentence, surface] of [["卵を割った。", "割っ"], ["卵を割らない。", "割ら"], ["卵を割って食べる。", "割っ"], ["箱を割ります。", "割り"]] as const) {
			const token = find(sentence, surface);
			expect(token, sentence).toBeDefined();
			expect([token!.baseForm, token!.conjugationType], sentence).toEqual(["割る", "五段・ラ行"]);
		}
	});

	it("reads 割れば as the 一段 lexeme 割る, so a Source that writes it holds the excluded lexeme too", () => {
		// Found while checking the request: the request expected the 五段 verb here. 割れる (氷が割れる) is a lexeme of its own.
		const token = find("卵を割れば、中から雛が出る。", "割れ");
		expect([token!.baseForm, token!.conjugationType, token!.conjugationForm]).toEqual(["割る", "一段", "仮定形"]);
		expect(find("氷が割れる。", "割れる")?.baseForm).toBe("割れる");
	});

	it("reads 恐れば as the 一段 lexeme 恐る, and the older spelling 恐しい of 蜘蛛の糸 as 恐 plus しい", () => {
		expect(find("彼は恐れば。", "恐れ")?.baseForm).toBe("恐る");
		const text = readFileSync("web/presets/kumono-ito.txt", "utf8");
		const tokens = tokenize(text);
		const found = tokens.filter((token) => token.pos === "動詞" && token.conjugationType === "一段" && EXCLUDED.includes(token.baseForm));
		expect(found.map((token) => [token.surface, token.baseForm, token.conjugationForm])).toEqual([["恐", "恐る", "連用形"]]);
		for (const preset of ["yume-juya", "chumonno-oi-ryoriten"]) {
			const others = tokenize(readFileSync(`web/presets/${preset}.txt`, "utf8"));
			expect(others.filter((token) => token.pos === "動詞" && token.conjugationType === "一段" && EXCLUDED.includes(token.baseForm)), preset).toEqual([]);
		}
	});
});

describe("the three web presets with the five excluded", () => {
	let tokenize: Tokenize;
	beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });
	const compiledPatterns = () => {
		const compiled = compileCollisionPatternSet({
			schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION, dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION, recipes: STANDARD_COLLISION_RECIPES,
			literals: STANDARD_COLLISION_LITERALS, connectors: STANDARD_COLLISION_CONNECTORS, modifierForms: STANDARD_COLLISION_MODIFIER_FORMS, nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES,
		});
		if (!compiled.ok) throw new Error("patterns");
		return compiled.set;
	};
	// The verb counts the pools hold (independent regular verb lexemes): 蜘蛛の糸 had 92 before, with 恐る among them.
	it.each([["kumono-ito", 91], ["yume-juya", 414], ["chumonno-oi-ryoriten", 136]] as const)("holds none of the five in any pool of %s, and %i verbs in each", async (preset, verbs) => {
		const text = readFileSync(`web/presets/${preset}.txt`, "utf8");
		const analyzed = await analyzeManualMorphSource({ text, sourcePath: `${preset}.md`, tokenizer: { tokenize: async (value) => tokenize(value) }, mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
		if (analyzed.status !== "ready") throw new Error("analysis");
		const owner = buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
		const built = buildAuthenticatedCollisionLexemePool({ vocabulary: owner, patternData: compiledPatterns() });
		if (!built.ok) throw new Error(built.reason);
		const authority = createManualAdverbAuthority({ vocabulary: owner });
		if (!authority.ok) throw new Error("authority");
		const projection = createMaxProjection({ vocabulary: owner, adverbAuthority: authority.value });
		if (!projection.ok) throw new Error("projection");
		const proverb = createFakeProverbAuthority({ vocabulary: owner, recipeSet: standardSet() });
		if (!proverb.ok) throw new Error("proverb");
		const dictionary = snapshotLexicalForms(owner.snapshot, "verb").map((form) => form.surface);
		const alert = fakeAlertWords(owner)!.verbs;
		const predicates = built.pool.predicates.map((candidate) => candidate.surface);
		const modifiers = built.pool.modifiers.map((candidate) => candidate.surface);
		const lexemes = projection.value.verb.lexemes.map((lexeme) => lexeme.input.baseForm);
		const proverbBases = proverb.value.forms.flatMap((form) => form.candidates.flatMap((candidate) => candidate.evidence.flatMap((evidence) => evidence.kind === "lexeme" ? [evidence.baseForm] : [])));
		// What the five would have written: the four basic forms, and what stem plus ending makes of any of the five. 割る
		// itself can come from the 五段 verb 割った, so it is not looked for.
		const written = /^(?:(?:恐|流|割|仕掛|組み立)(?:た|ない|ている|だ|ます)|恐る|流る|仕掛る|組み立る)$/u;
		for (const [name, list] of [["dictionary", dictionary], ["alert", alert], ["predicates", predicates], ["modifiers", modifiers], ["MAX lexemes", lexemes], ["Fake Proverb", proverbBases]] as const)
			for (const word of list) expect(written.test(word) ? `${name}: ${word}` : "ok", name).toBe("ok");
		expect(new Set([dictionary.length, alert.length, predicates.length, lexemes.length]), preset).toEqual(new Set([verbs]));
	});
});
