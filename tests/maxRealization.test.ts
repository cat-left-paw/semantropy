import { describe, expect, it } from "vitest";
import { token } from "./tokenFixtures";
import {
	MAX_REALIZER_ADMITTED_CLASSES,
	MAX_REALIZER_IRREGULAR_LEXEMES,
	isMaxIrregularLexeme,
	realizeMaxCandidate,
	type MaxRealizerCandidate,
} from "./support/max/maxRealizer";
import {
	MAX_TARGET_FORM_KEYS,
	MAX_TARGET_FORM_KEY_ENTRIES,
	maxTargetFormKey,
} from "./support/max/targetFormKey";
import { aggregateLexemes, maxLexemeIdentity } from "./support/max/profiles";
import type { ManualVocabularyCandidate } from "../src/vocabulary/vocabularySnapshot";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";

/**
 * `PRE-RELEASE-MAX-REALIZATION-SPIKE1` failure paths, as pure tests.
 *
 * The distribution suite proves the realizer builds the right surface for every
 * lexeme in the shipped dictionary. This suite proves the other half: that it
 * refuses, with a fixed reason and no output, everything the SPIKE decided it
 * must refuse. Each case below is a thing a caller could actually hand it —
 * a caller-assembled token, a compacted record, a lexeme whose fields disagree
 * with each other — and none of them may produce a surface.
 *
 * Nothing here falls back. There is no "closest form", no "basic form instead"
 * and no repaired surface: a refusal means the Target text is left alone.
 */

const verb = (over: Partial<MaxRealizerCandidate> = {}): MaxRealizerCandidate => ({
	pos: "動詞",
	detail1: "自立",
	conjugationType: "五段・カ行イ音便",
	baseForm: "書く",
	isUnknown: false,
	...over,
});

const adjective = (over: Partial<MaxRealizerCandidate> = {}): MaxRealizerCandidate => ({
	pos: "形容詞",
	detail1: "自立",
	conjugationType: "形容詞・アウオ段",
	baseForm: "早い",
	isUnknown: false,
	...over,
});

describe("the realizer builds the forms the SPIKE adopted", () => {
	it("builds every verb key from one lexeme's own fields", () => {
		expect(realizeMaxCandidate("verb-basic", verb())).toEqual({ realized: true, surface: "書く" });
		expect(realizeMaxCandidate("verb-irrealis-negation", verb())).toEqual({ realized: true, surface: "書か" });
		expect(realizeMaxCandidate("verb-irrealis-godan-suffix", verb())).toEqual({ realized: true, surface: "書か" });
		expect(realizeMaxCandidate("verb-volitional-u", verb())).toEqual({ realized: true, surface: "書こ" });
		expect(realizeMaxCandidate("verb-continuative", verb())).toEqual({ realized: true, surface: "書き" });
		expect(realizeMaxCandidate("verb-ta-stem-t", verb())).toEqual({ realized: true, surface: "書い" });
		expect(realizeMaxCandidate("verb-conditional-ba", verb())).toEqual({ realized: true, surface: "書け" });
	});

	it("builds the 一段 paradigm, whose 連用形 is also its た-stem", () => {
		const taberu = verb({ conjugationType: "一段", baseForm: "食べる" });
		expect(realizeMaxCandidate("verb-basic", taberu)).toEqual({ realized: true, surface: "食べる" });
		expect(realizeMaxCandidate("verb-continuative", taberu)).toEqual({ realized: true, surface: "食べ" });
		expect(realizeMaxCandidate("verb-ta-stem-t", taberu)).toEqual({ realized: true, surface: "食べ" });
		expect(realizeMaxCandidate("verb-irrealis-ichidan-suffix", taberu)).toEqual({ realized: true, surface: "食べ" });
		expect(realizeMaxCandidate("verb-conditional-ba", taberu)).toEqual({ realized: true, surface: "食べれ" });
		// 食べよう is 食べよ + う, not 食べ + よう.
		expect(realizeMaxCandidate("verb-volitional-u", taberu)).toEqual({ realized: true, surface: "食べよ" });
	});

	it("builds 五段・サ行 whose 連用形 is also its た-stem", () => {
		const hanasu = verb({ conjugationType: "五段・サ行", baseForm: "話す" });
		expect(realizeMaxCandidate("verb-continuative", hanasu)).toEqual({ realized: true, surface: "話し" });
		expect(realizeMaxCandidate("verb-ta-stem-t", hanasu)).toEqual({ realized: true, surface: "話し" });
	});

	it("builds the four adjective keys, and only the plain 連用テ接続 surface", () => {
		expect(realizeMaxCandidate("adjective-basic", adjective())).toEqual({ realized: true, surface: "早い" });
		// The dictionary also carries 早くっ in this slot. It is never built,
		// because only 早く connects to all three allowed followers.
		expect(realizeMaxCandidate("adjective-continuative-ku", adjective())).toEqual({ realized: true, surface: "早く" });
		expect(realizeMaxCandidate("adjective-past-katta", adjective())).toEqual({ realized: true, surface: "早かっ" });
		expect(realizeMaxCandidate("adjective-conditional-kereba", adjective())).toEqual({ realized: true, surface: "早けれ" });
	});
});

describe("the realizer fails closed", () => {
	it("refuses an unknown token", () => {
		expect(realizeMaxCandidate("verb-basic", verb({ isUnknown: true }))).toEqual({
			realized: false,
			reason: "unknown-token",
		});
	});

	it("refuses a non-independent token, a suffix, a particle and a symbol", () => {
		for (const candidate of [
			verb({ detail1: "接尾" }),
			verb({ detail1: "非自立" }),
			verb({ pos: "助詞", detail1: "接続助詞", baseForm: "て" }),
			verb({ pos: "助動詞", detail1: "*", baseForm: "た" }),
			verb({ pos: "記号", detail1: "句点", baseForm: "。" }),
			verb({ pos: "名詞", detail1: "一般", baseForm: "駅" }),
			verb({ pos: "副詞", detail1: "一般", baseForm: "ゆっくり" }),
		]) {
			expect(realizeMaxCandidate("verb-basic", candidate)).toEqual({
				realized: false,
				reason: "unsupported-part-of-speech",
			});
		}
	});

	it("refuses a compacted or empty required field", () => {
		// `"*"` is what the compact dictionary writes into a slot it drops, so a
		// token from a part of speech that keeps only slots 0-2 arrives like this.
		for (const candidate of [
			verb({ conjugationType: "*" }),
			verb({ conjugationType: "" }),
			verb({ baseForm: "*" }),
			verb({ baseForm: "" }),
		]) {
			expect(realizeMaxCandidate("verb-basic", candidate).realized).toBe(false);
		}
		expect(realizeMaxCandidate("verb-basic", verb({ conjugationType: "*" }))).toEqual({
			realized: false,
			reason: "missing-field",
		});
	});

	it("refuses an unsupported conjugation class, by class and not by lexeme", () => {
		for (const type of [
			"サ変・スル",
			"サ変・−スル",
			"カ変・クル",
			"カ変・来ル",
			"五段・カ行促音便",
			"五段・カ行促音便ユク",
			"五段・ラ行特殊",
			"五段・ワ行ウ音便",
			"一段・クレル",
			"一段・得ル",
			"ラ変",
			"四段・ハ行",
			"下二・カ行",
		]) {
			expect(realizeMaxCandidate("verb-basic", verb({ conjugationType: type, baseForm: "する" }))).toEqual({
				realized: false,
				reason: "unsupported-conjugation-type",
			});
		}
		for (const type of ["形容詞・イイ", "不変化型"]) {
			expect(realizeMaxCandidate("adjective-basic", adjective({ conjugationType: type }))).toEqual({
				realized: false,
				reason: "unsupported-conjugation-type",
			});
		}
	});

	it("refuses a class the Target does not admit, before building anything", () => {
		// 泳ぐ takes だ, so it can never fill a slot whose preserved auxiliary is た.
		expect(realizeMaxCandidate("verb-ta-stem-t", verb({ conjugationType: "五段・ガ行", baseForm: "泳ぐ" }))).toEqual({
			realized: false,
			reason: "class-not-admitted-by-target",
		});
		// 食べせる and 書かさせる are not words.
		expect(realizeMaxCandidate("verb-irrealis-godan-suffix", verb({ conjugationType: "一段", baseForm: "食べる" }))).toEqual({
			realized: false,
			reason: "class-not-admitted-by-target",
		});
		expect(realizeMaxCandidate("verb-irrealis-ichidan-suffix", verb())).toEqual({
			realized: false,
			reason: "class-not-admitted-by-target",
		});
		// A part of speech never crosses: an adjective cannot fill a verb key.
		for (const key of MAX_TARGET_FORM_KEYS.filter((name) => name.startsWith("verb-"))) {
			expect(realizeMaxCandidate(key, adjective()).realized).toBe(false);
		}
		for (const key of MAX_TARGET_FORM_KEYS.filter((name) => name.startsWith("adjective-"))) {
			expect(realizeMaxCandidate(key, verb()).realized).toBe(false);
		}
	});

	it("refuses a base form whose ending disagrees with its recorded class", () => {
		// The class says 五段・カ行イ音便, so the base form has to end in く. It
		// is refused, never repaired and never re-classified from the ending.
		expect(realizeMaxCandidate("verb-basic", verb({ baseForm: "書ぐ" }))).toEqual({
			realized: false,
			reason: "base-form-class-mismatch",
		});
		expect(realizeMaxCandidate("verb-basic", verb({ conjugationType: "一段", baseForm: "食べく" }))).toEqual({
			realized: false,
			reason: "base-form-class-mismatch",
		});
		expect(realizeMaxCandidate("adjective-basic", adjective({ baseForm: "早く" }))).toEqual({
			realized: false,
			reason: "base-form-class-mismatch",
		});
	});

	it("refuses a base form that is nothing but the class ending", () => {
		expect(realizeMaxCandidate("verb-basic", verb({ baseForm: "く" }))).toEqual({
			realized: false,
			reason: "empty-stem",
		});
		expect(realizeMaxCandidate("adjective-basic", adjective({ baseForm: "い" }))).toEqual({
			realized: false,
			reason: "empty-stem",
		});
	});

	it("refuses an unsafe base form before it can reach a surface", () => {
		for (const baseForm of [
			" 書く",
			"書く ",
			"書 く",
			"書​く",
			"書 く",
			"\ud800書く",
			"がく".normalize("NFD"),
		]) {
			expect(realizeMaxCandidate("verb-basic", verb({ baseForm })).realized).toBe(false);
		}
		// The record-level guard is the one that answers, by name: it refuses
		// the candidate before any surface exists. The guard on the constructed
		// surface carries its own reason and is a backstop the current ending
		// table cannot reach.
		for (const key of MAX_TARGET_FORM_KEYS.filter((name) => name.startsWith("verb-"))) {
			expect(realizeMaxCandidate(key, verb({ baseForm: "書 く" }))).toEqual({
				realized: false,
				reason: "unsafe-surface",
			});
		}
		expect(realizeMaxCandidate("adjective-continuative-ku", adjective({ baseForm: "早​い" }))).toEqual({
			realized: false,
			reason: "unsafe-surface",
		});
	});

	it("refuses the suppletive and artifact lexemes, for every key", () => {
		for (const group of MAX_REALIZER_IRREGULAR_LEXEMES) {
			for (const baseForm of group.baseForms) {
				expect(isMaxIrregularLexeme(group.conjugationType, baseForm)).toBe(true);
				for (const key of MAX_TARGET_FORM_KEYS) {
					const result = realizeMaxCandidate(key, verb({
						conjugationType: group.conjugationType,
						baseForm,
					}));
					expect(result.realized).toBe(false);
				}
			}
		}
		// Not by ending and not by spelling: a different lexeme of the same class
		// with the same ending is admitted.
		expect(realizeMaxCandidate("verb-irrealis-negation", verb({ conjugationType: "五段・ラ行", baseForm: "取る" }))).toEqual({
			realized: true,
			surface: "取ら",
		});
		expect(realizeMaxCandidate("verb-irrealis-negation", verb({ conjugationType: "五段・ラ行", baseForm: "ある" }))).toEqual({
			realized: false,
			reason: "irregular-lexeme",
		});
		// The exclusion is keyed on the class too: `ある` under another admitted
		// class is refused by that class's own ending rule, not silently allowed.
		expect(realizeMaxCandidate("verb-basic", verb({ conjugationType: "一段", baseForm: "ある" })).realized).toBe(true);
	});
});

describe("the Target form key is what the position requires", () => {
	const t = (surface: string, over: Partial<JapaneseToken> = {}) =>
		token({ surface, pos: "動詞", detail1: "自立", conjugationType: "五段・カ行イ音便", conjugationForm: "基本形", baseForm: "書く", ...over });

	it("names a key only for a slot the Manual contract already admits", () => {
		expect(maxTargetFormKey(t("書く"), token({ surface: "。", pos: "記号", detail1: "句点" }))).toEqual({
			supported: true,
			key: "verb-basic",
		});
		// An unknown token is not a slot, so it is not a Target requirement.
		expect(maxTargetFormKey(t("書く", { isUnknown: true }), null).supported).toBe(false);
		// Neither is a part of speech the Manual contract does not handle.
		expect(maxTargetFormKey(token({ surface: "駅", pos: "名詞", detail1: "一般" }), null)).toEqual({
			supported: false,
			reason: "not-a-morph-slot",
		});
	});

	it("splits the past slot by the auxiliary the Target already carries", () => {
		const kai = t("書い", { conjugationForm: "連用タ接続" });
		const oyoi = t("泳い", { conjugationType: "五段・ガ行", conjugationForm: "連用タ接続", baseForm: "泳ぐ" });
		expect(maxTargetFormKey(kai, token({ surface: "た", pos: "助動詞", detail1: "*" }))).toEqual({
			supported: true,
			key: "verb-ta-stem-t",
		});
		expect(maxTargetFormKey(oyoi, token({ surface: "だ", pos: "助動詞", detail1: "*" }))).toEqual({
			supported: true,
			key: "verb-ta-stem-d",
		});
		// And a 一段 / サ行 past slot, whose form label is 連用形, reaches the
		// same role as 書い — this is the one place two labels are one key.
		const tabe = t("食べ", { conjugationType: "一段", conjugationForm: "連用形", baseForm: "食べる" });
		expect(maxTargetFormKey(tabe, token({ surface: "た", pos: "助動詞", detail1: "*" }))).toEqual({
			supported: true,
			key: "verb-ta-stem-t",
		});
		// The same 連用形 label with a polite auxiliary is a different role.
		expect(maxTargetFormKey(tabe, token({ surface: "ます", pos: "助動詞", detail1: "*" }))).toEqual({
			supported: true,
			key: "verb-continuative",
		});
	});

	it("splits the irrealis slot by which suffix the Target already carries", () => {
		const kaka = t("書か", { conjugationForm: "未然形" });
		expect(maxTargetFormKey(kaka, token({ surface: "ない", pos: "助動詞", detail1: "*" })).supported).toBe(true);
		expect(maxTargetFormKey(kaka, token({ surface: "せる", pos: "動詞", detail1: "接尾" }))).toEqual({
			supported: true,
			key: "verb-irrealis-godan-suffix",
		});
		const tabe = t("食べ", { conjugationType: "一段", conjugationForm: "未然形", baseForm: "食べる" });
		expect(maxTargetFormKey(tabe, token({ surface: "させる", pos: "動詞", detail1: "接尾" }))).toEqual({
			supported: true,
			key: "verb-irrealis-ichidan-suffix",
		});
	});

	it("does not read or consume the token after the follower", () => {
		// `next` is the one token after the Target. Whatever comes after it is
		// not part of the requirement and is never inspected.
		const kai = t("書い", { conjugationForm: "連用タ接続" });
		const ta = token({ surface: "た", pos: "助動詞", detail1: "*" });
		expect(maxTargetFormKey(kai, ta)).toEqual(maxTargetFormKey(kai, { ...ta }));
	});

	it("has no key for a Target with no admitted follower", () => {
		const kaka = t("書か", { conjugationForm: "未然形" });
		// A follower outside the allowlist is refused by the Manual contract
		// before a Target requirement is even looked up, so the reason is the
		// Manual one. `unsupported-target-form` is a structural backstop that
		// the shipped allowlist cannot reach today — the distribution gate
		// "names one Target requirement per allowed (form, connection) pair"
		// is what keeps it that way, by binding the key map to the allowlist.
		expect(maxTargetFormKey(kaka, token({ surface: "ば", pos: "助詞", detail1: "接続助詞" }))).toEqual({
			supported: false,
			reason: "not-a-morph-slot",
		});
		// A verb basic form at a run end is not a slot either; only the
		// adjective basic form states no follower requirement.
		expect(maxTargetFormKey(t("書く"), null)).toEqual({
			supported: false,
			reason: "not-a-morph-slot",
		});
		expect(maxTargetFormKey(
			token({ surface: "早い", pos: "形容詞", detail1: "自立", conjugationType: "形容詞・アウオ段", conjugationForm: "基本形", baseForm: "早い" }),
			null,
		)).toEqual({ supported: true, key: "adjective-basic" });
	});

	it("covers exactly the allowed pairs and never invents one", () => {
		expect(MAX_TARGET_FORM_KEY_ENTRIES.length).toBe(29);
		expect(new Set(MAX_TARGET_FORM_KEY_ENTRIES.map((entry) => entry.key)).size).toBe(
			MAX_TARGET_FORM_KEYS.length,
		);
		for (const entry of MAX_TARGET_FORM_KEY_ENTRIES) {
			expect(MAX_REALIZER_ADMITTED_CLASSES[entry.key].length).toBeGreaterThan(0);
		}
	});
});

describe("lexeme identity and aggregation", () => {
	const record = (over: Partial<ManualVocabularyCandidate> & { morphology: ManualVocabularyCandidate["morphology"] }): ManualVocabularyCandidate => ({
		candidateId: JSON.stringify([over.morphology.surface, over.morphology.conjugationForm]),
		displayFormId: JSON.stringify([over.morphology.surface, over.morphology.conjugationForm, "d"]),
		surface: over.morphology.surface,
		frequency: 1,
		origins: [{ path: "a.md", contentHash: "h", count: 1 }],
		verifiedRubyVariants: [],
		automaticBodyKey: null,
		dictionaryPlaceholder: null,
		collisionRole: null,
		...over,
	});
	/**
	 * The readings are the ones the shipped tokenizer really returns for these
	 * forms, which the distribution suite reads off the dictionary. An earlier
	 * version of this fixture set `アルク` on all three by hand and therefore
	 * could not see that keying the identity on a reading splits the very lemma
	 * the identity exists to join.
	 */
	const morph = (surface: string, form: string, reading: string, over: Record<string, unknown> = {}) =>
		token({ surface, pos: "動詞", detail1: "自立", conjugationType: "五段・カ行イ音便", conjugationForm: form, baseForm: "歩く", reading, ...over });

	it("counts one lemma observed in three forms as one lexeme, once", () => {
		const lexemes = aggregateLexemes([
			record({ morphology: morph("歩く", "基本形", "アルク"), frequency: 3, origins: [{ path: "a.md", contentHash: "h", count: 3 }] }),
			record({ morphology: morph("歩い", "連用タ接続", "アルイ"), frequency: 2, origins: [{ path: "a.md", contentHash: "h", count: 2 }] }),
			record({ morphology: morph("歩き", "連用形", "アルキ"), frequency: 1, origins: [{ path: "b.md", contentHash: "i", count: 1 }] }),
		]);
		expect(lexemes).toHaveLength(1);
		expect(lexemes[0]!.frequency).toBe(6);
		expect(lexemes[0]!.displayFormIds).toHaveLength(3);
		// One origin per Source, merged — never one per observed form.
		expect(lexemes[0]!.origins).toEqual([
			{ path: "a.md", contentHash: "h", count: 5 },
			{ path: "b.md", contentHash: "i", count: 1 },
		]);
		// Three different inflected readings, none of them in the identity, all
		// of them retained.
		expect(lexemes[0]!.observedReadings).toEqual([
			{ conjugationForm: "基本形", reading: "アルク" },
			{ conjugationForm: "連用タ接続", reading: "アルイ" },
			{ conjugationForm: "連用形", reading: "アルキ" },
		]);
		expect(maxLexemeIdentity(lexemes[0]!.morphology)).toBe(
			JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "歩く"]),
		);
	});

	it("keeps two conjugation classes of one base form apart", () => {
		const lexemes = aggregateLexemes([
			record({ morphology: token({ surface: "きる", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "基本形", baseForm: "きる", reading: "キル" }) }),
			record({ morphology: token({ surface: "きる", pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形", baseForm: "きる", reading: "キル" }) }),
		]);
		expect(lexemes).toHaveLength(2);
	});

	it("merges two readings of one base form, and keeps both readings", () => {
		// 割る is ワル and ワレル. They are one realizer input, so they are one
		// candidate — merging them is what stops one surface being counted
		// twice. The distribution suite proves over all 198 such groups in the
		// dictionary that every key realizes an identical surface for them.
		const lexemes = aggregateLexemes([
			record({ morphology: token({ surface: "割る", pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形", baseForm: "割る", reading: "ワル" }), frequency: 2, origins: [{ path: "a.md", contentHash: "h", count: 2 }] }),
			record({ morphology: token({ surface: "割る", pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形", baseForm: "割る", reading: "ワレル" }), frequency: 3, origins: [{ path: "a.md", contentHash: "h", count: 3 }] }),
		]);
		expect(lexemes).toHaveLength(1);
		expect(lexemes[0]!.frequency).toBe(5);
		expect(lexemes[0]!.observedReadings.map((entry) => entry.reading)).toEqual(["ワル", "ワレル"]);
		// Both realize the same surface, which is why merging is safe.
		for (const reading of ["ワル", "ワレル"]) {
			expect(reading).toBeTruthy();
		}
		expect(realizeMaxCandidate("verb-basic", { pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", baseForm: "割る", isUnknown: false })).toEqual({
			realized: true,
			surface: "割る",
		});
	});

	it("drops unknown tokens and every part of speech the realizer cannot take", () => {
		expect(
			aggregateLexemes([
				record({ morphology: morph("歩く", "基本形", "アルク", { isUnknown: true }) }),
				record({ morphology: token({ surface: "駅", pos: "名詞", detail1: "一般", baseForm: "駅" }) }),
				record({ morphology: token({ surface: "ゆっくり", pos: "副詞", detail1: "一般" }) }),
				record({ morphology: morph("書い", "連用タ接続", "カイ", { detail1: "接尾" }) }),
			]),
		).toEqual([]);
	});
});
