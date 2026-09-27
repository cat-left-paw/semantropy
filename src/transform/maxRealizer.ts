import type { ManualMorphConnectionResult } from "./manualMorphology";
import {
	REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	REGULAR_VERB_CONJUGATION_TYPES,
	type RegularAdjectiveConjugationType,
	type RegularVerbConjugationType,
} from "./regularConjugationTypes";

/**
 * PRE-RELEASE-MAX-CORE1 closed realizer: the verified contract of
 * PRE-RELEASE-MAX-REALIZATION-SPIKE1 and Max Realization Amendment 1, as a pure
 * production leaf. It reads a Target requirement and one lexeme's recorded
 * dictionary fields, and returns a finished surface or a fixed refusal. There
 * is no repair, no best effort and no fallback: a refusal leaves the Target as
 * the writer wrote it. It never reads a surface, a reading, a Snapshot or a
 * nonce, never tokenizes and never scans a dictionary at runtime.
 *
 * A `MaxTargetFormKey` is what the *Target position* requires, and it includes
 * the preserved follower (Amendment 1 §2): 泳い takes だ, 書い takes た, and
 * 未然形 before せる is 五段 while before させる it is 一段. Thirteen keys cover
 * all 29 (slot class, form, connection) pairs `manualMorphConnection()` can
 * present, so the key is derived from that authenticated answer and this module
 * holds no second opinion about which slots or followers are allowed.
 */
export const MAX_TARGET_FORM_KEYS = Object.freeze([
	"verb-basic",
	"verb-irrealis-negation",
	"verb-irrealis-godan-suffix",
	"verb-irrealis-ichidan-suffix",
	"verb-volitional-u",
	"verb-continuative",
	"verb-ta-stem-t",
	"verb-ta-stem-d",
	"verb-conditional-ba",
	"adjective-basic",
	"adjective-continuative-ku",
	"adjective-past-katta",
	"adjective-conditional-kereba",
] as const);
export type MaxTargetFormKey = (typeof MAX_TARGET_FORM_KEYS)[number];

/** [slot class, conjugation form, matched Target connection | null, key]. */
const KEY_ENTRIES: readonly (readonly [string, string, string | null, MaxTargetFormKey])[] = [
	["verb", "基本形", "period", "verb-basic"],
	["verb", "基本形", "comma", "verb-basic"],
	["verb", "基本形", "general-noun", "verb-basic"],
	["verb", "基本形", "dependent-noun-koto", "verb-basic"],
	["verb", "基本形", "particle-to", "verb-basic"],
	["verb", "基本形", "particle-kara", "verb-basic"],
	["verb", "未然形", "aux-nai", "verb-irrealis-negation"],
	["verb", "未然形", "aux-nu", "verb-irrealis-negation"],
	// 食べせる is not a word: せる / れる are the 五段 suffixes.
	["verb", "未然形", "suffix-seru", "verb-irrealis-godan-suffix"],
	["verb", "未然形", "suffix-reru", "verb-irrealis-godan-suffix"],
	// 書かさせる is not a word: させる / られる are the 一段 ones.
	["verb", "未然形", "suffix-saseru", "verb-irrealis-ichidan-suffix"],
	["verb", "未然形", "suffix-rareru", "verb-irrealis-ichidan-suffix"],
	// 食べよう is 食べよ + う in the shipped dictionary, so one follower serves every class.
	["verb", "未然ウ接続", "aux-u", "verb-volitional-u"],
	["verb", "連用形", "aux-masu", "verb-continuative"],
	["verb", "連用形", "aux-tai", "verb-continuative"],
	["verb", "連用形", "particle-nagara", "verb-continuative"],
	// 一段 / 五段・サ行 have no 連用タ接続 entry: their 連用形 is the た-stem.
	["verb", "連用形", "aux-ta", "verb-ta-stem-t"],
	["verb", "連用形", "particle-te", "verb-ta-stem-t"],
	["verb", "連用タ接続", "aux-ta", "verb-ta-stem-t"],
	["verb", "連用タ接続", "particle-te", "verb-ta-stem-t"],
	["verb", "連用タ接続", "aux-da", "verb-ta-stem-d"],
	["verb", "連用タ接続", "particle-de", "verb-ta-stem-d"],
	["verb", "仮定形", "particle-ba", "verb-conditional-ba"],
	["i-adjective", "基本形", null, "adjective-basic"],
	["i-adjective", "連用テ接続", "aux-nai", "adjective-continuative-ku"],
	["i-adjective", "連用テ接続", "particle-te", "adjective-continuative-ku"],
	["i-adjective", "連用テ接続", "verb-naru", "adjective-continuative-ku"],
	["i-adjective", "連用タ接続", "aux-ta", "adjective-past-katta"],
	["i-adjective", "仮定形", "particle-ba", "adjective-conditional-kereba"],
];
const KEYS: ReadonlyMap<string, MaxTargetFormKey> = new Map(
	KEY_ENTRIES.map(([slotClass, form, connection, key]) => [JSON.stringify([slotClass, form, connection]), key]),
);

export type MaxTargetFormResult =
	| { readonly supported: true; readonly key: MaxTargetFormKey }
	| { readonly supported: false; readonly reason: "not-a-morph-slot" | "unsupported-target-form" };

/** The Target requirement from an already-computed Manual connection answer. */
export function maxTargetFormKey(connection: ManualMorphConnectionResult): MaxTargetFormResult {
	if (!connection.supported) return { supported: false, reason: "not-a-morph-slot" };
	const { slotClass, conjugationForm, targetConnection } = connection.compatibility;
	const key = KEYS.get(JSON.stringify([slotClass, conjugationForm, targetConnection]));
	// Structural backstop: unreachable while KEY_ENTRIES covers the allowlist, which the tests pin.
	return key ? { supported: true, key } : { supported: false, reason: "unsupported-target-form" };
}

type VerbRule = {
	readonly baseEnding: string; readonly irrealis: string; readonly volitional: string;
	readonly continuative: string; readonly taStem: string; readonly taVoicing: "t" | "d"; readonly conditional: string;
};
/** Typed over the shared allowlist: a missing or extra class is a typecheck error. */
const VERB_RULES: Readonly<Record<RegularVerbConjugationType, VerbRule>> = {
	一段: { baseEnding: "る", irrealis: "", volitional: "よ", continuative: "", taStem: "", taVoicing: "t", conditional: "れ" },
	"五段・カ行イ音便": { baseEnding: "く", irrealis: "か", volitional: "こ", continuative: "き", taStem: "い", taVoicing: "t", conditional: "け" },
	"五段・ガ行": { baseEnding: "ぐ", irrealis: "が", volitional: "ご", continuative: "ぎ", taStem: "い", taVoicing: "d", conditional: "げ" },
	"五段・サ行": { baseEnding: "す", irrealis: "さ", volitional: "そ", continuative: "し", taStem: "し", taVoicing: "t", conditional: "せ" },
	"五段・タ行": { baseEnding: "つ", irrealis: "た", volitional: "と", continuative: "ち", taStem: "っ", taVoicing: "t", conditional: "て" },
	"五段・ナ行": { baseEnding: "ぬ", irrealis: "な", volitional: "の", continuative: "に", taStem: "ん", taVoicing: "d", conditional: "ね" },
	"五段・バ行": { baseEnding: "ぶ", irrealis: "ば", volitional: "ぼ", continuative: "び", taStem: "ん", taVoicing: "d", conditional: "べ" },
	"五段・マ行": { baseEnding: "む", irrealis: "ま", volitional: "も", continuative: "み", taStem: "ん", taVoicing: "d", conditional: "め" },
	"五段・ラ行": { baseEnding: "る", irrealis: "ら", volitional: "ろ", continuative: "り", taStem: "っ", taVoicing: "t", conditional: "れ" },
	"五段・ワ行促音便": { baseEnding: "う", irrealis: "わ", volitional: "お", continuative: "い", taStem: "っ", taVoicing: "t", conditional: "え" },
};
type AdjectiveRule = { readonly baseEnding: string; readonly continuative: string; readonly past: string; readonly conditional: string };
const ADJECTIVE_RULES: Readonly<Record<RegularAdjectiveConjugationType, AdjectiveRule>> = {
	"形容詞・アウオ段": { baseEnding: "い", continuative: "く", past: "かっ", conditional: "けれ" },
	"形容詞・イ段": { baseEnding: "い", continuative: "く", past: "かっ", conditional: "けれ" },
};
const VERB_RULE_BY_TYPE: ReadonlyMap<string, VerbRule> = new Map(Object.entries(VERB_RULES));
const ADJECTIVE_RULE_BY_TYPE: ReadonlyMap<string, AdjectiveRule> = new Map(Object.entries(ADJECTIVE_RULES));
const GODAN: readonly string[] = REGULAR_VERB_CONJUGATION_TYPES.filter(type => type !== "一段");
const voiced = (voicing: "t" | "d") => REGULAR_VERB_CONJUGATION_TYPES.filter(type => VERB_RULES[type].taVoicing === voicing);
/** Admission is per (key, class): a key-only table built 食べせる, 書かさせる and 泳いた. */
const ADMITS: Readonly<Record<MaxTargetFormKey, readonly string[]>> = {
	"verb-basic": REGULAR_VERB_CONJUGATION_TYPES,
	"verb-irrealis-negation": REGULAR_VERB_CONJUGATION_TYPES,
	"verb-irrealis-godan-suffix": GODAN,
	"verb-irrealis-ichidan-suffix": ["一段"],
	"verb-volitional-u": REGULAR_VERB_CONJUGATION_TYPES,
	"verb-continuative": REGULAR_VERB_CONJUGATION_TYPES,
	"verb-ta-stem-t": voiced("t"),
	"verb-ta-stem-d": voiced("d"),
	"verb-conditional-ba": REGULAR_VERB_CONJUGATION_TYPES,
	"adjective-basic": REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	"adjective-continuative-ku": REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	"adjective-past-katta": REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	"adjective-conditional-kereba": REGULAR_ADJECTIVE_CONJUGATION_TYPES,
};
/**
 * Amendment 1 §3: the closed, fail-closed lexeme exclusion, by exact recorded
 * base form. ある / 有る / 在る are suppletive under 五段・ラ行; へるる /
 * のぼりつめるる / 上り詰めるる are dictionary expansion artifacts, re-derived by
 * the distribution gate from the structural rule B = B' + E over every class.
 */
const IRREGULAR_LEXEMES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["五段・ラ行", new Set(["ある", "有る", "在る"])],
	["一段", new Set(["へるる", "のぼりつめるる", "上り詰めるる"])],
]);

/** Canonical, frozen description of every rule. Bound into fingerprint 3 in place of a realizer version. */
export const MAX_REALIZER_RULES = Object.freeze({
	keys: Object.freeze(KEY_ENTRIES.map(entry => Object.freeze(entry))),
	verbRules: Object.freeze(REGULAR_VERB_CONJUGATION_TYPES.map(type => Object.freeze([type, Object.freeze({ ...VERB_RULES[type] })] as const))),
	adjectiveRules: Object.freeze(REGULAR_ADJECTIVE_CONJUGATION_TYPES.map(type => Object.freeze([type, Object.freeze({ ...ADJECTIVE_RULES[type] })] as const))),
	admits: Object.freeze(MAX_TARGET_FORM_KEYS.map(key => Object.freeze([key, Object.freeze([...ADMITS[key]])] as const))),
	irregularLexemes: Object.freeze([...IRREGULAR_LEXEMES].map(([type, forms]) => Object.freeze([type, Object.freeze([...forms].sort())] as const))),
});
export function isMaxIrregularLexeme(conjugationType: string, baseForm: string): boolean {
	return IRREGULAR_LEXEMES.get(conjugationType)?.has(baseForm) === true;
}

/** Exactly the fields the realizer reads. Never a surface, never a reading. */
export type MaxRealizerInput = {
	readonly pos: string;
	readonly detail1: string;
	readonly conjugationType: string;
	readonly baseForm: string;
	readonly isUnknown: boolean;
};
export type MaxRealizerRejection = "unknown-token" | "unsupported-part-of-speech" | "missing-field" |
	"unsupported-conjugation-type" | "class-not-admitted-by-target" | "irregular-lexeme" |
	"base-form-class-mismatch" | "empty-stem" | "unsafe-surface" | "unsafe-realized-surface";
export type MaxRealizerResult =
	| { readonly realized: true; readonly surface: string }
	| { readonly realized: false; readonly reason: MaxRealizerRejection };

/** Controls, separators, whitespace, surrogates and Markdown-active characters are never placed. */
const UNSAFE = /[\p{C}\p{Z}\s<>`{}[\]|*\\]/u;
export function isSafeMaxSurface(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value !== "*" && value === value.normalize("NFC") && !UNSAFE.test(value);
}
/** The lexeme a realizer candidate is: reading, observed surface and form are deliberately absent. */
export function maxLexemeIdentity(input: MaxRealizerInput): string {
	return JSON.stringify([input.pos, input.detail1, input.conjugationType, input.baseForm]);
}
export function maxSlotClassOf(input: Pick<MaxRealizerInput, "pos" | "detail1">): "verb" | "i-adjective" | null {
	return input.detail1 !== "自立" ? null : input.pos === "動詞" ? "verb" : input.pos === "形容詞" ? "i-adjective" : null;
}
const present = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value !== "*";
const refuse = (reason: MaxRealizerRejection): MaxRealizerResult => ({ realized: false, reason });

export function realizeMaxLexeme(key: MaxTargetFormKey, candidate: MaxRealizerInput): MaxRealizerResult {
	if (candidate.isUnknown !== false) return refuse("unknown-token");
	const slotClass = maxSlotClassOf(candidate);
	if (!slotClass) return refuse("unsupported-part-of-speech");
	if (!present(candidate.conjugationType) || !present(candidate.baseForm)) return refuse("missing-field");
	if (!isSafeMaxSurface(candidate.baseForm)) return refuse("unsafe-surface");
	const verb = slotClass === "verb";
	const rule = verb ? VERB_RULE_BY_TYPE.get(candidate.conjugationType) : ADJECTIVE_RULE_BY_TYPE.get(candidate.conjugationType);
	if (!rule) return refuse("unsupported-conjugation-type");
	// The Target decides which classes it takes before any surface exists; this also refuses POS crossing.
	if (!ADMITS[key]?.includes(candidate.conjugationType)) return refuse("class-not-admitted-by-target");
	if (isMaxIrregularLexeme(candidate.conjugationType, candidate.baseForm)) return refuse("irregular-lexeme");
	// The class states the ending; a record whose two fields disagree is refused, never repaired.
	if (!candidate.baseForm.endsWith(rule.baseEnding)) return refuse("base-form-class-mismatch");
	const stem = candidate.baseForm.slice(0, candidate.baseForm.length - rule.baseEnding.length);
	if (!stem) return refuse("empty-stem");
	const surface = verb ? verbSurface(key, stem, rule as VerbRule, candidate.baseForm)
		: adjectiveSurface(key, stem, rule as AdjectiveRule, candidate.baseForm);
	if (surface === null) return refuse("class-not-admitted-by-target");
	// Backstop, unreachable for this ending table (plain hiragana that composes with nothing); named so a future table says so.
	if (!isSafeMaxSurface(surface)) return refuse("unsafe-realized-surface");
	return { realized: true, surface };
}
function verbSurface(key: MaxTargetFormKey, stem: string, rule: VerbRule, baseForm: string): string | null {
	switch (key) {
		case "verb-basic": return baseForm;
		case "verb-irrealis-negation": case "verb-irrealis-godan-suffix": case "verb-irrealis-ichidan-suffix": return stem + rule.irrealis;
		case "verb-volitional-u": return stem + rule.volitional;
		case "verb-continuative": return stem + rule.continuative;
		case "verb-ta-stem-t": case "verb-ta-stem-d": return stem + rule.taStem;
		case "verb-conditional-ba": return stem + rule.conditional;
		default: return null;
	}
}
function adjectiveSurface(key: MaxTargetFormKey, stem: string, rule: AdjectiveRule, baseForm: string): string | null {
	switch (key) {
		case "adjective-basic": return baseForm;
		// Only the plain 早く connects to all three allowed followers; 早くっ is never built.
		case "adjective-continuative-ku": return stem + rule.continuative;
		case "adjective-past-katta": return stem + rule.past;
		case "adjective-conditional-kereba": return stem + rule.conditional;
		default: return null;
	}
}
