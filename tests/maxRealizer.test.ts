import { describe, expect, it } from "vitest";
import { MANUAL_MORPH_ALLOWLIST, manualMorphConnection } from "../src/transform/manualMorphology";
import { REGULAR_ADJECTIVE_CONJUGATION_TYPES, REGULAR_VERB_CONJUGATION_TYPES } from "../src/transform/regularConjugationTypes";
import { MAX_REALIZER_RULES, MAX_TARGET_FORM_KEYS, isMaxIrregularLexeme, isSafeMaxSurface, maxLexemeIdentity, maxTargetFormKey,
	realizeMaxLexeme, type MaxRealizerInput, type MaxTargetFormKey } from "../src/transform/maxRealizer";
import { isMaxLevel, maxApplicationRate, maxDomainBase, maxProfileAt, maxSlotHash, maxUnit } from "../src/transform/maxLevel";
// The SPIKE1 prototype is a comparison oracle only; nothing under src/ imports it.
import { realizeMaxCandidate } from "./support/max/maxRealizer";
import { MAX_TARGET_FORM_KEY_ENTRIES, MAX_TARGET_FORM_KEYS as SPIKE_KEYS } from "./support/max/targetFormKey";
import { MAX_REALIZER_ADMITTED_CLASSES, MAX_REALIZER_IRREGULAR_LEXEMES } from "./support/max/maxRealizer";
import { a, aux, token, v } from "./maxCoreFixtures";

const verb = (type: string, baseForm: string): MaxRealizerInput => ({ pos: "動詞", detail1: "自立", conjugationType: type, baseForm, isUnknown: false });
const adjective = (baseForm: string, type = "形容詞・イ段"): MaxRealizerInput => ({ pos: "形容詞", detail1: "自立", conjugationType: type, baseForm, isUnknown: false });
const surface = (key: MaxTargetFormKey, input: MaxRealizerInput) => { const result = realizeMaxLexeme(key, input); return result.realized ? result.surface : result.reason; };
const ENDINGS: Record<string, string> = { 一段: "る", "五段・カ行イ音便": "く", "五段・ガ行": "ぐ", "五段・サ行": "す", "五段・タ行": "つ", "五段・ナ行": "ぬ",
	"五段・バ行": "ぶ", "五段・マ行": "む", "五段・ラ行": "る", "五段・ワ行促音便": "う", "形容詞・アウオ段": "い", "形容詞・イ段": "い" };

describe("Target form keys", () => {
	it("maps every allowlisted (class, form, connection) pair to exactly one of the 13 keys", () => {
		const pairs: [slotClass: "verb" | "i-adjective", form: string, connection: string | null][] = [];
		for (const slotClass of ["verb", "i-adjective"] as const) for (const [form, entry] of Object.entries(MANUAL_MORPH_ALLOWLIST[slotClass].forms)) {
			if (entry.targetFollower === "any") pairs.push([slotClass, form, null]);
			else for (const id of entry.connections) pairs.push([slotClass, form, id]);
		}
		expect(pairs).toHaveLength(29);
		const keys = new Set<string>();
		for (const [slotClass, conjugationForm, targetConnection] of pairs) {
			const result = maxTargetFormKey({ supported: true, slotClass, connectionKey: "", compatibility: { policyVersion: "manual-morph-2", slotClass,
				conjugationForm, compatibilityFamily: "", targetConnection, candidateObservation: "same-form", candidateCompatibilityKey: "" } });
			expect(result.supported, `${slotClass} ${conjugationForm} ${targetConnection}`).toBe(true);
			if (result.supported) keys.add(result.key);
		}
		expect([...keys].sort()).toEqual([...MAX_TARGET_FORM_KEYS].sort());
		expect(MAX_REALIZER_RULES.keys).toHaveLength(29);
	});
	it("derives the key from the authenticated connection answer, follower included", () => {
		const key = (tokens: Parameters<typeof manualMorphConnection>) => { const result = maxTargetFormKey(manualMorphConnection(...tokens)); return result.supported ? result.key : result.reason; };
		expect(key([v("泳い", "泳ぐ", "五段・ガ行", "連用タ接続"), aux("だ")])).toBe("verb-ta-stem-d");
		expect(key([v("書い", "書く", "五段・カ行イ音便", "連用タ接続"), aux("た")])).toBe("verb-ta-stem-t");
		expect(key([v("食べ", "食べる", "一段", "連用形"), aux("た")])).toBe("verb-ta-stem-t");
		expect(key([v("書か", "書く", "五段・カ行イ音便", "未然形"), token("せる", "動詞", "接尾")])).toBe("verb-irrealis-godan-suffix");
		expect(key([v("食べ", "食べる", "一段", "未然形"), token("させる", "動詞", "接尾")])).toBe("verb-irrealis-ichidan-suffix");
		expect(key([a("高い", "高い", "基本形"), null])).toBe("adjective-basic");
		expect(key([v("書く", "書く", "五段・カ行イ音便", "基本形"), aux("まい")])).toBe("not-a-morph-slot");
		expect(maxTargetFormKey({ supported: false, reason: "unknown-token" })).toEqual({ supported: false, reason: "not-a-morph-slot" });
	});
	it("uses the same key map as the SPIKE1 prototype", () => {
		expect([...MAX_TARGET_FORM_KEYS]).toEqual([...SPIKE_KEYS]);
		expect(MAX_REALIZER_RULES.keys.map(([slotClass, form, connection, key]) => ({ slotClass, conjugationForm: form, targetConnection: connection, key })))
			.toEqual(MAX_TARGET_FORM_KEY_ENTRIES.map(entry => ({ ...entry })));
	});
});

describe("the closed realizer", () => {
	it("builds た / だ, せる / させる, the volitional, the 一段 / サ行 past and all four adjective forms", () => {
		expect(surface("verb-ta-stem-d", verb("五段・ガ行", "泳ぐ"))).toBe("泳い");
		expect(surface("verb-ta-stem-t", verb("五段・カ行イ音便", "書く"))).toBe("書い");
		expect(surface("verb-ta-stem-t", verb("五段・ガ行", "泳ぐ"))).toBe("class-not-admitted-by-target");
		expect(surface("verb-ta-stem-d", verb("五段・カ行イ音便", "書く"))).toBe("class-not-admitted-by-target");
		expect(surface("verb-ta-stem-t", verb("一段", "食べる"))).toBe("食べ");
		expect(surface("verb-ta-stem-t", verb("五段・サ行", "話す"))).toBe("話し");
		expect(surface("verb-ta-stem-t", verb("五段・ラ行", "走る"))).toBe("走っ");
		expect(surface("verb-ta-stem-t", verb("五段・ワ行促音便", "買う"))).toBe("買っ");
		expect(surface("verb-ta-stem-d", verb("五段・マ行", "読む"))).toBe("読ん");
		expect(surface("verb-irrealis-godan-suffix", verb("五段・カ行イ音便", "書く"))).toBe("書か");
		expect(surface("verb-irrealis-godan-suffix", verb("一段", "食べる"))).toBe("class-not-admitted-by-target");
		expect(surface("verb-irrealis-ichidan-suffix", verb("一段", "食べる"))).toBe("食べ");
		expect(surface("verb-irrealis-ichidan-suffix", verb("五段・カ行イ音便", "書く"))).toBe("class-not-admitted-by-target");
		expect(surface("verb-volitional-u", verb("一段", "食べる"))).toBe("食べよ");
		expect(surface("verb-volitional-u", verb("五段・ワ行促音便", "買う"))).toBe("買お");
		expect(surface("verb-irrealis-negation", verb("五段・ワ行促音便", "買う"))).toBe("買わ");
		expect(surface("verb-conditional-ba", verb("一段", "食べる"))).toBe("食べれ");
		expect(surface("verb-continuative", verb("五段・タ行", "待つ"))).toBe("待ち");
		expect(surface("verb-basic", verb("五段・ナ行", "死ぬ"))).toBe("死ぬ");
		expect(surface("adjective-basic", adjective("早い", "形容詞・アウオ段"))).toBe("早い");
		expect(surface("adjective-continuative-ku", adjective("美しい"))).toBe("美しく");
		expect(surface("adjective-past-katta", adjective("美しい"))).toBe("美しかっ");
		expect(surface("adjective-conditional-kereba", adjective("美しい"))).toBe("美しけれ");
	});
	it("admits per (key, class) exactly as SPIKE1 recorded, and never crosses parts of speech", () => {
		const admitted = Object.fromEntries(MAX_REALIZER_RULES.admits.map(([key, classes]) => [key, [...classes]]));
		expect(admitted).toEqual(Object.fromEntries(Object.entries(MAX_REALIZER_ADMITTED_CLASSES).map(([key, classes]) => [key, [...classes]])));
		for (const key of MAX_TARGET_FORM_KEYS) {
			const adjectiveKey = key.startsWith("adjective-");
			for (const type of REGULAR_VERB_CONJUGATION_TYPES) if (adjectiveKey) expect(surface(key, verb(type, `書${ENDINGS[type]}`))).toBe("class-not-admitted-by-target");
			for (const type of REGULAR_ADJECTIVE_CONJUGATION_TYPES) if (!adjectiveKey) expect(surface(key, adjective("美しい", type))).toBe("class-not-admitted-by-target");
		}
	});
	it("refuses the six-lexeme closed exclusion for every key", () => {
		expect(MAX_REALIZER_RULES.irregularLexemes).toEqual(MAX_REALIZER_IRREGULAR_LEXEMES.map(item => [item.conjugationType, item.baseForms]));
		for (const [type, forms] of [["五段・ラ行", ["ある", "有る", "在る"]], ["一段", ["へるる", "のぼりつめるる", "上り詰めるる"]]] as const)
			for (const form of forms) {
				expect(isMaxIrregularLexeme(type, form)).toBe(true);
				for (const key of MAX_TARGET_FORM_KEYS) expect(realizeMaxLexeme(key, verb(type, form)).realized).toBe(false);
			}
		expect(surface("verb-basic", verb("五段・ラ行", "ある"))).toBe("irregular-lexeme");
		expect(surface("verb-basic", verb("一段", "へるる"))).toBe("irregular-lexeme");
	});
	it("fails closed without guessing from a surface or ending", () => {
		expect(surface("verb-basic", { ...verb("一段", "食べる"), isUnknown: true })).toBe("unknown-token");
		for (const [pos, detail1] of [["動詞", "非自立"], ["動詞", "接尾"], ["名詞", "一般"], ["副詞", "一般"], ["助動詞", "*"], ["助詞", "格助詞"], ["記号", "句点"]] as const)
			expect(surface("verb-basic", { ...verb("一段", "食べる"), pos, detail1 })).toBe("unsupported-part-of-speech");
		for (const field of ["conjugationType", "baseForm"] as const) for (const value of ["*", ""])
			expect(surface("verb-basic", { ...verb("一段", "食べる"), [field]: value })).toBe("missing-field");
		expect(surface("verb-basic", verb("サ変・スル", "する"))).toBe("unsupported-conjugation-type");
		expect(surface("verb-basic", verb("五段・カ行促音便", "行く"))).toBe("unsupported-conjugation-type");
		expect(surface("adjective-basic", adjective("いい", "形容詞・イイ"))).toBe("unsupported-conjugation-type");
		expect(surface("verb-basic", verb("五段・カ行イ音便", "食べる"))).toBe("base-form-class-mismatch");
		expect(surface("verb-basic", verb("一段", "る"))).toBe("empty-stem");
		expect(surface("adjective-basic", adjective("い"))).toBe("empty-stem");
		for (const unsafe of ["食​べる", " 食べる", "食べる ", "食べ*る", "<食べる", "食\nべる", "\ud800る", "がる"])
			expect(surface("verb-basic", verb("一段", unsafe))).toBe("unsafe-surface");
	});
	it("agrees with the SPIKE1 prototype on every key, class and fixture base form", () => {
		const inputs: MaxRealizerInput[] = [];
		for (const type of REGULAR_VERB_CONJUGATION_TYPES) for (const stem of ["書", "食べ", "", "読み込"]) inputs.push(verb(type, `${stem}${ENDINGS[type]}`));
		for (const type of REGULAR_ADJECTIVE_CONJUGATION_TYPES) for (const base of ["美しい", "早い", "い"]) inputs.push(adjective(base, type));
		inputs.push(verb("五段・ラ行", "ある"), verb("一段", "へるる"), verb("サ変・スル", "する"), { ...verb("一段", "食べる"), isUnknown: true });
		for (const key of MAX_TARGET_FORM_KEYS) for (const input of inputs) expect(realizeMaxLexeme(key, input)).toEqual(realizeMaxCandidate(key, input));
	});
	it("identifies a lexeme without its reading, observed surface or form, and publishes frozen rules", () => {
		expect(maxLexemeIdentity(verb("五段・カ行イ音便", "歩く"))).toBe(JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "歩く"]));
		expect(Object.isFrozen(MAX_REALIZER_RULES) && Object.isFrozen(MAX_REALIZER_RULES.keys) && Object.isFrozen(MAX_REALIZER_RULES.admits[0])).toBe(true);
		expect(isSafeMaxSurface("書い")).toBe(true); expect(isSafeMaxSurface("書　い")).toBe(false);
	});
});

describe("level arithmetic", () => {
	it("accepts exactly the integers 0..100", () => {
		for (let level = 0; level <= 100; level++) expect(isMaxLevel(level)).toBe(true);
		for (const value of [-1, 101, 50.5, NaN, Infinity, "50", null, undefined]) expect(isMaxLevel(value)).toBe(false);
	});
	it("applies at twice the level up to 50 and profiles by interval with fixed presets", () => {
		expect([0, 1, 25, 49, 50, 51, 75, 100].map(maxApplicationRate)).toEqual([0, 2, 50, 98, 100, 100, 100, 100]);
		for (const threshold of [0, 0.25, 0.5, 0.999999]) {
			for (let level = 0; level <= 50; level++) expect(maxProfileAt(level, threshold)).toBe("strict");
			expect(maxProfileAt(75, threshold)).toBe("high"); expect(maxProfileAt(100, threshold)).toBe("max");
			let rank = 0;
			for (let level = 0; level <= 100; level++) {
				const next = ["strict", "high", "max"].indexOf(maxProfileAt(level, threshold));
				expect(next).toBeGreaterThanOrEqual(rank); rank = next;
			}
		}
		expect(maxProfileAt(60, 0.39)).toBe("high"); expect(maxProfileAt(60, 0.4)).toBe("strict");
		expect(maxProfileAt(90, 0.59)).toBe("max"); expect(maxProfileAt(90, 0.6)).toBe("high");
	});
	it("derives distinct private bases per part and purpose and stable per-slot units", () => {
		const bases = new Set<number>();
		for (const part of ["noun", "verb", "iAdjective", "adverb"]) for (const purpose of ["profile", "surface", "identity", "ruby"]) bases.add(maxDomainBase(7, part, purpose));
		expect(bases.size).toBe(16);
		expect(maxDomainBase(7, "verb", "surface")).not.toBe(maxDomainBase(8, "verb", "surface"));
		const u = maxUnit(maxSlotHash(123, ["r:token:1"]));
		expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1);
		expect(maxSlotHash(123, ["r:token:1"])).toBe(maxSlotHash(123, ["r:token:1"]));
		expect(maxSlotHash(123, ["ab", "c"])).not.toBe(maxSlotHash(123, ["a", "bc"]));
	});
});
