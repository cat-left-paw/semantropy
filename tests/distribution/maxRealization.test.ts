import { beforeAll, describe, expect, it } from "vitest";
import {
	SLOT_BASE_FORM,
	SLOT_CONJUGATION_FORM,
	SLOT_CONJUGATION_TYPE,
	SLOT_DETAIL1,
	SLOT_POS,
	SLOT_READING,
} from "../../scripts/lindera/compactDictionary.mjs";
import { readEntries, scanDistribution, toObject } from "../../scripts/max/scanDictionary.mjs";
import {
	REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	REGULAR_VERB_CONJUGATION_TYPES,
} from "../../src/transform/regularConjugationTypes";
import { MANUAL_MORPH_ALLOWLIST } from "../../src/transform/manualMorphology";
import {
	MAX_REALIZER_ADMITTED_CLASSES,
	MAX_REALIZER_IRREGULAR_LEXEMES,
	realizeMaxCandidate,
} from "../support/max/maxRealizer";
import {
	MAX_TARGET_FORM_KEYS,
	MAX_TARGET_FORM_KEY_ENTRIES,
} from "../support/max/targetFormKey";
import { KEY_FOLLOWERS, readLexemes, runRoundTrip } from "../support/max/roundTrip";
import { aggregateLexemes, maxLexemeIdentity, measureProfiles, prepareMeasurement } from "../support/max/profiles";
import { sourceTexts, targetText } from "../support/max/corpus";
import {
	buildTokenize,
	compactDictionaryDir,
	initLindera,
	type Tokenize,
} from "./linderaFixture";

/**
 * `PRE-RELEASE-MAX-REALIZATION-SPIKE1` against the shipped compact IPADIC.
 *
 * Everything the record claims about the dictionary is re-derived here on every
 * distribution run, because the previous slice learned the cost of writing a
 * dictionary survey as prose: `PRE-RELEASE-COLLISION-LEXEME1`'s first survey
 * was simply wrong about 問う and おっしゃる, and a gate is what caught it.
 *
 * Four things are pinned:
 *
 *   1. **The distribution.** Entry counts, part-of-speech totals, and the full
 *      conjugation class x form matrix for independent verbs and i-adjectives.
 *      A dictionary change that moves any of them fails here and the coverage
 *      decision is re-taken rather than quietly becoming wrong.
 *   2. **The asymmetries the realizer depends on.** 一段 and 五段・サ行 having
 *      no 連用タ接続 entry at all is not a curiosity; it is why `verb-ta-stem-t`
 *      is one role reached through two different form labels.
 *   3. **The exclusion sets.** The artifact criterion is re-run over every
 *      admitted class, so a dictionary that gains a fourth `へるる` fails here
 *      instead of putting a non-word into someone's note.
 *   4. **The realizer itself.** Every admitted (key, class, lexeme, follower)
 *      is re-analysed through the production tokenizer and measured: 98.29%
 *      come back as the same lexeme and the same follower, and the remaining
 *      1.71% are an accepted re-analysis difference. Full agreement is not an
 *      admission condition — admission follows from the closed realizer rules
 *      and the dictionary distribution above — so this pins a bound, not a pass.
 */

const ENTRY_COUNT = 392_126;
const INDEPENDENT_INFLECTING_ENTRIES = 156_806;

/** Top-level part of speech, over every entry. */
const POS_COUNTS: Readonly<Record<string, number>> = {
	その他: 2,
	フィラー: 19,
	副詞: 3_032,
	助動詞: 199,
	助詞: 237,
	動詞: 130_750,
	名詞: 229_690,
	形容詞: 27_210,
	感動詞: 252,
	接続詞: 171,
	接頭詞: 221,
	記号: 208,
	連体詞: 135,
};

/**
 * 動詞 / 自立 entries per (conjugation class, conjugation form), restricted to
 * the ten admitted classes and the six forms the Manual allowlist can present
 * as a Target. A `0` is as load-bearing as a count.
 */
const VERB_MATRIX: Readonly<Record<string, Readonly<Record<string, number>>>> = {
	一段: { 基本形: 5_973, 未然形: 5_973, 未然ウ接続: 5_973, 連用形: 5_973, 連用タ接続: 0, 仮定形: 5_973 },
	"五段・カ行イ音便": { 基本形: 943, 未然形: 943, 未然ウ接続: 943, 連用形: 943, 連用タ接続: 943, 仮定形: 943 },
	"五段・ガ行": { 基本形: 158, 未然形: 158, 未然ウ接続: 158, 連用形: 158, 連用タ接続: 158, 仮定形: 158 },
	"五段・サ行": { 基本形: 2_340, 未然形: 2_340, 未然ウ接続: 2_340, 連用形: 2_340, 連用タ接続: 0, 仮定形: 2_340 },
	"五段・タ行": { 基本形: 284, 未然形: 284, 未然ウ接続: 284, 連用形: 284, 連用タ接続: 284, 仮定形: 284 },
	"五段・ナ行": { 基本形: 6, 未然形: 6, 未然ウ接続: 6, 連用形: 6, 連用タ接続: 6, 仮定形: 6 },
	"五段・バ行": { 基本形: 119, 未然形: 119, 未然ウ接続: 119, 連用形: 119, 連用タ接続: 119, 仮定形: 119 },
	"五段・マ行": { 基本形: 935, 未然形: 935, 未然ウ接続: 935, 連用形: 935, 連用タ接続: 935, 仮定形: 935 },
	"五段・ラ行": { 基本形: 2_631, 未然形: 2_631, 未然ウ接続: 2_631, 連用形: 2_631, 連用タ接続: 2_631, 仮定形: 2_631 },
	"五段・ワ行促音便": { 基本形: 815, 未然形: 815, 未然ウ接続: 815, 連用形: 815, 連用タ接続: 815, 仮定形: 815 },
};

/**
 * 形容詞 / 自立 entries per (class, form) over the four Manual forms. The
 * doubled 連用テ接続 is the reason the realizer builds only the plain `く`:
 * every lexeme has two surfaces in that slot, 早く and the colloquial 早くっ.
 */
const ADJECTIVE_MATRIX: Readonly<Record<string, Readonly<Record<string, number>>>> = {
	"形容詞・アウオ段": { 基本形: 1_134, 連用テ接続: 2_268, 連用タ接続: 1_134, 仮定形: 1_134 },
	"形容詞・イ段": { 基本形: 662, 連用テ接続: 1_324, 連用タ接続: 662, 仮定形: 662 },
};

/** Conjugation classes outside the allowlist, with their entry counts. */
const EXCLUDED_CLASS_ENTRIES: Readonly<Record<string, number>> = {
	"カ変・クル": 20,
	"カ変・来ル": 20,
	"サ変・−スル": 4_000,
	"サ変・−ズル": 854,
	"サ変・スル": 15,
	ラ変: 6,
	"一段・クレル": 20,
	"一段・得ル": 4,
	"上二・ダ行": 9,
	"上二・ハ行": 6,
	"下二・カ行": 6,
	"下二・ガ行": 12,
	"下二・ダ行": 6,
	"下二・ハ行": 6,
	"下二・マ行": 6,
	"下二・得": 7,
	不変化型: 8,
	"五段・カ行促音便": 48,
	"五段・カ行促音便ユク": 140,
	"五段・ラ行特殊": 70,
	"五段・ワ行ウ音便": 182,
	"四段・サ行": 10,
	"四段・タ行": 10,
	"四段・ハ行": 50,
	"四段・バ行": 5,
	"形容詞・イイ": 3,
};

/** Distinct (class, base form) lexemes per admitted class. */
const LEXEMES_PER_CLASS: Readonly<Record<string, number>> = {
	一段: 5_901,
	"五段・カ行イ音便": 914,
	"五段・ガ行": 155,
	"五段・サ行": 2_323,
	"五段・タ行": 283,
	"五段・ナ行": 6,
	"五段・バ行": 117,
	"五段・マ行": 925,
	"五段・ラ行": 2_584,
	"五段・ワ行促音便": 798,
	"形容詞・アウオ段": 1_115,
	"形容詞・イ段": 654,
};

const TOTAL_LEXEMES = 16_394;
const BASE_FORMS_WITH_TWO_ADMITTED_CLASSES = 28;
const ROUND_TRIP_PROBES = 418_535;
const ADMITTED_LEXEME_GROUPS = 15_775;
const GROUPS_WITH_SEVERAL_BASE_READINGS = 198;

const ADMITTED_BASE_ENDING: Readonly<Record<string, string>> = {
	一段: "る",
	"五段・カ行イ音便": "く",
	"五段・ガ行": "ぐ",
	"五段・サ行": "す",
	"五段・タ行": "つ",
	"五段・ナ行": "ぬ",
	"五段・バ行": "ぶ",
	"五段・マ行": "む",
	"五段・ラ行": "る",
	"五段・ワ行促音便": "う",
	"形容詞・アウオ段": "い",
	"形容詞・イ段": "い",
};

const compact = readEntries(compactDictionaryDir());
const distribution = scanDistribution(compact);

function matrix(pos: string, forms: readonly string[]) {
	const counts = new Map<string, Map<string, number>>();
	for (const entry of compact) {
		if (entry[SLOT_POS] !== pos || entry[SLOT_DETAIL1] !== "自立") continue;
		const type = entry[SLOT_CONJUGATION_TYPE]!;
		const form = entry[SLOT_CONJUGATION_FORM]!;
		if (!forms.includes(form)) continue;
		const row = counts.get(type) ?? new Map<string, number>();
		row.set(form, (row.get(form) ?? 0) + 1);
		counts.set(type, row);
	}
	return counts;
}

describe("the shipped compact dictionary, scanned in full for MAX realization", () => {
	it("has the entry count and part-of-speech distribution the record states", () => {
		expect(compact).toHaveLength(ENTRY_COUNT);
		expect(toObject(distribution.pos)).toEqual(POS_COUNTS);
		expect(distribution.inflecting).toBe(INDEPENDENT_INFLECTING_ENTRIES);
	});

	it("has the independent-verb class x form matrix the realizer is built on", () => {
		const forms = Object.keys(MANUAL_MORPH_ALLOWLIST.verb.forms);
		expect(forms.sort()).toEqual(
			["基本形", "未然形", "未然ウ接続", "連用形", "連用タ接続", "仮定形"].sort(),
		);
		const counts = matrix("動詞", forms);
		const actual: Record<string, Record<string, number>> = {};
		for (const type of REGULAR_VERB_CONJUGATION_TYPES) {
			actual[type] = Object.fromEntries(
				forms.map((form) => [form, counts.get(type)?.get(form) ?? 0]),
			);
		}
		expect(actual).toEqual(VERB_MATRIX);
	});

	it("gives 一段 and 五段・サ行 no 連用タ接続 entry at all", () => {
		// The asymmetry `verb-ta-stem-t` exists for: those two classes reach the
		// past through 連用形 (食べた, 話した) while the promotive classes reach
		// it through 連用タ接続 (書いた). A realizer that treated the raw form
		// label as the role would leave both of them unable to fill a past slot.
		expect(VERB_MATRIX["一段"]!["連用タ接続"]).toBe(0);
		expect(VERB_MATRIX["五段・サ行"]!["連用タ接続"]).toBe(0);
		for (const type of REGULAR_VERB_CONJUGATION_TYPES) {
			if (type === "一段" || type === "五段・サ行") continue;
			expect(VERB_MATRIX[type]!["連用タ接続"]).toBeGreaterThan(0);
		}
	});

	it("has the independent-adjective matrix, including the doubled 連用テ接続", () => {
		const forms = Object.keys(MANUAL_MORPH_ALLOWLIST["i-adjective"].forms);
		const counts = matrix("形容詞", forms);
		const actual: Record<string, Record<string, number>> = {};
		for (const type of REGULAR_ADJECTIVE_CONJUGATION_TYPES) {
			actual[type] = Object.fromEntries(
				forms.map((form) => [form, counts.get(type)?.get(form) ?? 0]),
			);
		}
		expect(actual).toEqual(ADJECTIVE_MATRIX);
		// Exactly two surfaces per lexeme in that one slot, never three.
		for (const type of REGULAR_ADJECTIVE_CONJUGATION_TYPES) {
			expect(ADJECTIVE_MATRIX[type]!["連用テ接続"]).toBe(
				ADJECTIVE_MATRIX[type]!["基本形"]! * 2,
			);
		}
	});

	it("keeps every other conjugation class outside the allowlist", () => {
		const admitted = new Set<string>([
			...REGULAR_VERB_CONJUGATION_TYPES,
			...REGULAR_ADJECTIVE_CONJUGATION_TYPES,
		]);
		const excluded: Record<string, number> = {};
		for (const [type, count] of distribution.conjugationType) {
			if (type === "*" || admitted.has(type)) continue;
			excluded[type] = count;
		}
		expect(excluded).toEqual(EXCLUDED_CLASS_ENTRIES);
		// Named because the record names them: these are the lexemes a reader
		// asks about, and the answer is that the class, not a lexeme list,
		// keeps them out.
		expect(admitted.has("サ変・スル")).toBe(false);
		expect(admitted.has("カ変・クル")).toBe(false);
		expect(admitted.has("五段・カ行促音便")).toBe(false);
		expect(admitted.has("五段・ラ行特殊")).toBe(false);
		expect(admitted.has("五段・ワ行ウ音便")).toBe(false);
		expect(admitted.has("一段・クレル")).toBe(false);
		expect(admitted.has("形容詞・イイ")).toBe(false);
	});

	it("has the lexeme counts the coverage tables are computed over", () => {
		const lexemes = readLexemes(compactDictionaryDir());
		expect(lexemes).toHaveLength(TOTAL_LEXEMES);
		const perClass: Record<string, number> = {};
		for (const lexeme of lexemes) {
			if (ADMITTED_BASE_ENDING[lexeme.conjugationType] === undefined) continue;
			perClass[lexeme.conjugationType] = (perClass[lexeme.conjugationType] ?? 0) + 1;
		}
		expect(perClass).toEqual(LEXEMES_PER_CLASS);
	});

	it("proves a base form alone is not a lexeme identity", () => {
		const byBase = new Map<string, Set<string>>();
		const readings = new Map<string, Set<string>>();
		for (const entry of compact) {
			const pos = entry[SLOT_POS];
			if ((pos !== "動詞" && pos !== "形容詞") || entry[SLOT_DETAIL1] !== "自立") continue;
			const key = `${pos}${entry[SLOT_BASE_FORM]}`;
			const set = byBase.get(key) ?? new Set<string>();
			set.add(entry[SLOT_CONJUGATION_TYPE]!);
			byBase.set(key, set);
			if (entry[SLOT_CONJUGATION_FORM] === "基本形") {
				const r = readings.get(key) ?? new Set<string>();
				r.add(entry[SLOT_READING]!);
				readings.set(key, r);
			}
		}
		const twoAdmitted = [...byBase].filter(
			([, types]) => [...types].filter((t) => ADMITTED_BASE_ENDING[t] !== undefined).length > 1,
		);
		expect(twoAdmitted).toHaveLength(BASE_FORMS_WITH_TWO_ADMITTED_CLASSES);
		// きる is 一段 (着る) and 五段・ラ行 (切る); they inflect differently, so
		// the conjugation class has to be part of the identity.
		expect([...(byBase.get("動詞きる") ?? [])].sort()).toEqual(
			["一段", "五段・ラ行"].sort(),
		);
		// 割る carries two readings under one base form, so the reading has to
		// be part of it too.
		expect([...(readings.get("動詞割る") ?? [])].sort()).toEqual(
			["ワル", "ワレル"].sort(),
		);
	});

	it("re-derives the expansion-artifact exclusion over every admitted class", () => {
		const lexemes = readLexemes(compactDictionaryDir());
		const byClass = new Map<string, Set<string>>();
		for (const lexeme of lexemes) {
			const set = byClass.get(lexeme.conjugationType) ?? new Set<string>();
			set.add(lexeme.baseForm);
			byClass.set(lexeme.conjugationType, set);
		}
		const found: { conjugationType: string; baseForm: string }[] = [];
		for (const [conjugationType, ending] of Object.entries(ADMITTED_BASE_ENDING)) {
			for (const baseForm of byClass.get(conjugationType) ?? []) {
				const stripped = baseForm.slice(0, baseForm.length - ending.length);
				if (baseForm.endsWith(ending) && byClass.get(conjugationType)?.has(stripped)) {
					found.push({ conjugationType, baseForm });
				}
			}
		}
		expect(found.map((item) => item.baseForm).sort()).toEqual(
			["のぼりつめるる", "へるる", "上り詰めるる"].sort(),
		);
		expect(found.every((item) => item.conjugationType === "一段")).toBe(true);
		// Every one of them is refused by the realizer, for every key.
		for (const item of found) {
			for (const key of MAX_TARGET_FORM_KEYS) {
				const result = realizeMaxCandidate(key, {
					pos: "動詞",
					detail1: "自立",
					conjugationType: item.conjugationType,
					baseForm: item.baseForm,
					isUnknown: false,
				});
				expect(result.realized).toBe(false);
			}
		}
	});

	it("keeps the suppletive exclusion and states which classes it needed", () => {
		expect(MAX_REALIZER_IRREGULAR_LEXEMES).toEqual([
			{ conjugationType: "五段・ラ行", baseForms: ["ある", "在る", "有る"].sort() },
			{ conjugationType: "一段", baseForms: ["のぼりつめるる", "へるる", "上り詰めるる"].sort() },
		]);
		// The dictionary really does classify these as plain 五段・ラ行, which is
		// why the exclusion has to be by lexeme rather than by class.
		const raGyou = compact.filter(
			(entry) =>
				entry[SLOT_POS] === "動詞" &&
				entry[SLOT_DETAIL1] === "自立" &&
				entry[SLOT_CONJUGATION_TYPE] === "五段・ラ行" &&
				["ある", "有る", "在る"].includes(entry[SLOT_BASE_FORM]!),
		);
		expect(raGyou.length).toBeGreaterThan(0);
	});
});

describe("the closed realizer, re-analysed through the production tokenizer", () => {
	let tokenize: Tokenize;
	beforeAll(async () => {
		await initLindera();
		tokenize = buildTokenize(compactDictionaryDir());
	});

	it("names one Target requirement per allowed form and connection pair", () => {
		// Every pair the Manual allowlist can present, and nothing else. A form
		// or connection the allowlist gains without a decision here fails.
		const allowed: string[] = [];
		for (const [slotClass, rules] of Object.entries(MANUAL_MORPH_ALLOWLIST)) {
			for (const [form, rule] of Object.entries(rules.forms)) {
				if (rule.connections.length === 0) {
					allowed.push(`${slotClass}${form}null`);
					continue;
				}
				for (const connection of rule.connections) {
					allowed.push(`${slotClass}${form}${connection}`);
				}
			}
		}
		const named = MAX_TARGET_FORM_KEY_ENTRIES.map(
			(entry) => `${entry.slotClass}${entry.conjugationForm}${entry.targetConnection ?? "null"}`,
		);
		expect(named.sort()).toEqual([...new Set(allowed)].sort());
	});

	it("admits only classes whose base ending the realizer's table states", () => {
		for (const key of MAX_TARGET_FORM_KEYS) {
			for (const type of MAX_REALIZER_ADMITTED_CLASSES[key]) {
				expect(ADMITTED_BASE_ENDING[type]).toBeDefined();
			}
		}
		// The two asymmetric keys partition the verb classes; neither is empty
		// and neither overlaps the other.
		const t = new Set(MAX_REALIZER_ADMITTED_CLASSES["verb-ta-stem-t"]);
		const d = new Set(MAX_REALIZER_ADMITTED_CLASSES["verb-ta-stem-d"]);
		expect([...t].filter((type) => d.has(type))).toEqual([]);
		expect(t.size + d.size).toBe(REGULAR_VERB_CONJUGATION_TYPES.length);
		expect([...d].sort()).toEqual(
			["五段・ガ行", "五段・ナ行", "五段・バ行", "五段・マ行"].sort(),
		);
		// The causative and passive suffixes never share a key.
		expect(MAX_REALIZER_ADMITTED_CLASSES["verb-irrealis-ichidan-suffix"]).toEqual(["一段"]);
		expect(MAX_REALIZER_ADMITTED_CLASSES["verb-irrealis-godan-suffix"]).not.toContain("一段");
	});

	it("re-analyses most realized surfaces as the lexeme they claimed, and loses no character", () => {
		const lexemes = readLexemes(compactDictionaryDir());
		const { rows, failures, untiled } = runRoundTrip(lexemes, tokenize);
		const probes = rows.reduce((total, row) => total + row.probes, 0);
		expect(probes).toBe(ROUND_TRIP_PROBES);

		// The one property this harness genuinely establishes against the
		// tokenizer rather than against its own concatenation: every probe,
		// including the divergent ones, comes back as tokens that tile the
		// input exactly. The realizer never builds a string the tokenizer
		// drops or extends a character of.
		expect(untiled).toEqual([]);

		// Agreement is a measurement with a pinned bound, not a pass. It is
		// NOT evidence that the output is unambiguous or that it is "correct
		// Japanese"; the record states the exact figure and §4.1 states what
		// the divergence is. Text safety is structural — the caller writes the
		// realized surface in front of a follower it never touches and the
		// runtime never re-tokenizes its own output — so it is argued there,
		// not asserted here from a string this file built itself.
		expect(failures.length / probes).toBeLessThan(0.02);

		// Every divergence is a *segmentation* difference on an ambiguous
		// string, never a lost lexeme: the classes with the fewest ambiguous
		// kana spellings must be essentially clean.
		const perKey = new Map<string, { probes: number; divergent: number }>();
		for (const row of rows) {
			const entry = perKey.get(row.key) ?? { probes: 0, divergent: 0 };
			entry.probes += row.probes;
			perKey.set(row.key, entry);
		}
		for (const failure of failures) perKey.get(failure.key)!.divergent += 1;
		for (const key of MAX_TARGET_FORM_KEYS) {
			const entry = perKey.get(key)!;
			expect(entry.probes).toBeGreaterThan(0);
			expect(entry.divergent / entry.probes).toBeLessThan(0.05);
		}
	});

	it("probes every follower the Manual allowlist admits for each key", () => {
		for (const key of MAX_TARGET_FORM_KEYS) {
			expect(KEY_FOLLOWERS[key].length).toBeGreaterThan(0);
		}
		// The two た-keys carry the voiced and unvoiced auxiliaries and never
		// each other's, which is the whole reason they are two keys.
		expect(KEY_FOLLOWERS["verb-ta-stem-t"]).toEqual(["た", "たら", "て"]);
		expect(KEY_FOLLOWERS["verb-ta-stem-d"]).toEqual(["だ", "だら", "で"]);
	});

	it("builds 泳いだ and 書いた, and never 泳いた or 書いだ", () => {
		const oyogu = { pos: "動詞", detail1: "自立", conjugationType: "五段・ガ行", baseForm: "泳ぐ", isUnknown: false };
		const kaku = { pos: "動詞", detail1: "自立", conjugationType: "五段・カ行イ音便", baseForm: "書く", isUnknown: false };
		expect(realizeMaxCandidate("verb-ta-stem-d", oyogu)).toEqual({ realized: true, surface: "泳い" });
		expect(realizeMaxCandidate("verb-ta-stem-t", kaku)).toEqual({ realized: true, surface: "書い" });
		// The cross pairs are refused before a surface exists, not repaired.
		expect(realizeMaxCandidate("verb-ta-stem-t", oyogu)).toEqual({
			realized: false,
			reason: "class-not-admitted-by-target",
		});
		expect(realizeMaxCandidate("verb-ta-stem-d", kaku)).toEqual({
			realized: false,
			reason: "class-not-admitted-by-target",
		});
	});
});

describe("lexeme identity against the shipped dictionary", () => {
	let tokenize: Tokenize;
	let tokenizer: { tokenize: (text: string) => Promise<ReturnType<Tokenize>> };
	beforeAll(async () => {
		await initLindera();
		tokenize = buildTokenize(compactDictionaryDir());
		tokenizer = { tokenize: async (text: string) => tokenize(text) };
	});

	it("carries the reading of the inflected form, not of the lemma", () => {
		// The fact that makes a reading unusable as part of a lexeme identity.
		// It is read off the real tokenizer here, because the first version of
		// this suite asserted it from a hand-built fixture that set one reading
		// on all three forms and therefore could not see the problem.
		const readings = ["歩く。", "歩いた。", "歩きます。", "歩かない。", "歩けば。"].map((text) => {
			const head = tokenize(text)[0]!;
			return [head.surface, head.conjugationForm, head.baseForm, head.reading];
		});
		expect(readings).toEqual([
			["歩く", "基本形", "歩く", "アルク"],
			["歩い", "連用タ接続", "歩く", "アルイ"],
			["歩き", "連用形", "歩く", "アルキ"],
			["歩か", "未然形", "歩く", "アルカ"],
			["歩け", "仮定形", "歩く", "アルケ"],
		]);
		// Five distinct readings, one lemma.
		expect(new Set(readings.map((row) => row[3])).size).toBe(5);
	});

	it("aggregates one lemma observed in five real forms into one lexeme", async () => {
		const { vocabulary } = await prepareMeasurement({
			target: "歩く。",
			sources: [
				{ path: "a.md", text: "歩く。歩いた。歩きます。" },
				{ path: "b.md", text: "歩かない。歩けば。" },
			],
			tokenizer,
		});
		const lexemes = aggregateLexemes(vocabulary.snapshot.projections.manual.candidates);
		const aruku = lexemes.filter((lexeme) => lexeme.morphology.baseForm === "歩く");
		expect(aruku).toHaveLength(1);
		const lexeme = aruku[0]!;
		// Five observed forms, counted once each — not five candidates.
		expect(lexeme.frequency).toBe(5);
		expect(lexeme.displayFormIds).toHaveLength(5);
		// Three occurrences in one Source and two in the other, merged per
		// Source rather than per observed form.
		expect(lexeme.origins.map((origin) => [origin.path, origin.count])).toEqual([
			["a.md", 3],
			["b.md", 2],
		]);
		expect(lexeme.origins.every((origin) => origin.contentHash.length > 0)).toBe(true);
		// Nothing is lost: every observed (form, reading) pair is retained.
		expect(lexeme.observedReadings.map((entry) => entry.reading).sort()).toEqual(
			["アルイ", "アルカ", "アルキ", "アルク", "アルケ"].sort(),
		);
		// And the identity itself carries no reading at all.
		expect(maxLexemeIdentity(lexeme.morphology)).toBe(
			JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "歩く"]),
		);
	});

	it("merges reading variants only where the realizer cannot tell them apart", () => {
		// Dropping the reading merges base forms that carry two 基本形 readings
		// under one admitted class. That is sound rather than convenient: the
		// realizer's whole input is (part of speech, independence, class, base
		// form), so the members of such a group are one input tuple and produce
		// byte-identical surfaces for every key. This re-derives the groups from
		// the dictionary and checks exactly that, over all of them.
		const groups = new Map<string, Set<string>>();
		for (const entry of compact) {
			if (entry[SLOT_DETAIL1] !== "自立") continue;
			const pos = entry[SLOT_POS];
			if (pos !== "動詞" && pos !== "形容詞") continue;
			const type = entry[SLOT_CONJUGATION_TYPE]!;
			if (ADMITTED_BASE_ENDING[type] === undefined) continue;
			if (entry[SLOT_CONJUGATION_FORM] !== "基本形") continue;
			const key = [pos, "自立", type, entry[SLOT_BASE_FORM]].join("");
			const set = groups.get(key) ?? new Set<string>();
			set.add(entry[SLOT_READING]!);
			groups.set(key, set);
		}
		expect(groups.size).toBe(ADMITTED_LEXEME_GROUPS);
		const multiRead = [...groups].filter(([, readings]) => readings.size > 1);
		expect(multiRead).toHaveLength(GROUPS_WITH_SEVERAL_BASE_READINGS);
		// 入る is ハイル and イル; 傾ける is カタムケル and カタブケル.
		expect(multiRead.some(([key]) => key.endsWith("入る"))).toBe(true);

		for (const [key, readings] of multiRead) {
			const [pos, detail1, conjugationType, baseForm] = key.split("");
			// One realizer input for the whole group, whatever the readings are.
			const inputs = new Set(
				[...readings].map(() => JSON.stringify([pos, detail1, conjugationType, baseForm])),
			);
			expect(inputs.size).toBe(1);
			// And one surface per key, so the merge cannot change any output.
			for (const formKey of MAX_TARGET_FORM_KEYS) {
				const surfaces = new Set(
					[...readings].map(() =>
						JSON.stringify(
							realizeMaxCandidate(formKey, {
								pos: pos!,
								detail1: detail1!,
								conjugationType: conjugationType!,
								baseForm: baseForm!,
								isUnknown: false,
							}),
						),
					),
				);
				expect(surfaces.size).toBe(1);
			}
		}
	});
});

describe("strict / High / MAX on the SPIKE corpus", () => {
	let tokenizer: { tokenize: (text: string) => Promise<ReturnType<Tokenize>> };
	beforeAll(async () => {
		await initLindera();
		const sync = buildTokenize(compactDictionaryDir());
		tokenizer = { tokenize: async (text: string) => sync(text) };
	});

	it("separates the three profiles without widening the noun set", async () => {
		const { vocabulary, targetTokens } = await prepareMeasurement({
			target: targetText(),
			sources: sourceTexts(),
			tokenizer,
		});
		const { slots, totals } = measureProfiles(targetTokens, vocabulary);

		// Monotone: a profile never has fewer candidates or fewer exchangeable
		// slots than the one below it, in any slot.
		for (const slot of slots) {
			expect(slot.high).toBeGreaterThanOrEqual(slot.strict);
			expect(slot.max).toBeGreaterThanOrEqual(slot.high);
		}
		expect(totals.highCandidates).toBeGreaterThan(totals.strictCandidates);
		expect(totals.maxCandidates).toBeGreaterThan(totals.highCandidates);
		expect(totals.maxSlots).toBeGreaterThan(totals.strictSlots);

		// Policy 1 §4.1. High drops the fine sub-bucket match inside the safe
		// independent-noun family and MAX requires nothing beyond "safe noun",
		// so High and MAX coincide — but neither coincides with strict, which
		// keeps Body 10's own bucket. An earlier version of this suite asserted
		// strict === High === MAX and so pinned the defect rather than the
		// policy.
		const nouns = slots.filter((slot) => slot.kind === "noun");
		expect(nouns.length).toBeGreaterThan(0);
		for (const slot of nouns) {
			expect(slot.max).toBe(slot.high);
			expect(slot.high).toBeGreaterThanOrEqual(slot.strict);
		}
		expect(nouns.some((slot) => slot.high > slot.strict)).toBe(true);

		// The relaxation is a dropped constraint, not a wider candidate source:
		// every High noun surface is one the Snapshot's own automatic-body
		// projection already published, so no pronoun, dependent noun, suffix
		// or unknown word enters. Policy §4.1 forbids adding those.
		const published = new Set(
			vocabulary.snapshot.projections.automaticBody.buckets.flatMap((bucket) =>
				bucket.surfaces.map((entry) => entry.surface),
			),
		);
		for (const slot of nouns) {
			expect(slot.high).toBeLessThanOrEqual(published.size);
		}

		// Policy 1 §4.3 permits High and MAX to coincide for i-adjectives, and
		// on this corpus they do: one regular family, admitted by both.
		const adjectives = slots.filter((slot) => slot.kind === "i-adjective");
		expect(adjectives.length).toBeGreaterThan(0);
		for (const slot of adjectives) expect(slot.max).toBe(slot.high);

		// Verbs are where MAX earns its name, and where strict is genuinely
		// short: most verb slots have no strict candidate at all.
		const verbs = slots.filter((slot) => slot.kind === "verb");
		expect(verbs.filter((slot) => slot.strict === 0).length).toBeGreaterThan(
			verbs.filter((slot) => slot.strict > 0).length,
		);
		expect(verbs.filter((slot) => slot.max === 0)).toEqual([]);

		// No part of speech crosses into another: every realized verb candidate
		// came from a verb lexeme, which `measureProfiles` enforces by slot
		// class and the realizer enforces again by part of speech.
		for (const slot of slots) {
			if (slot.kind === "noun") expect(slot.targetKey).toBeNull();
			else expect(slot.targetKey === null || slot.targetKey.startsWith(slot.kind === "verb" ? "verb-" : "adjective-")).toBe(true);
		}
	});

	it("reaches every adopted Target form key at least once", async () => {
		const { vocabulary, targetTokens } = await prepareMeasurement({
			target: targetText(),
			sources: sourceTexts(),
			tokenizer,
		});
		const { slots } = measureProfiles(targetTokens, vocabulary);
		const reached = new Set(slots.map((slot) => slot.targetKey).filter(Boolean));
		for (const key of MAX_TARGET_FORM_KEYS) expect(reached).toContain(key);
	});
});
