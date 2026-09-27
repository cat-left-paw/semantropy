import {
	REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	REGULAR_VERB_CONJUGATION_TYPES,
	type RegularAdjectiveConjugationType,
	type RegularVerbConjugationType,
} from "../../../src/transform/regularConjugationTypes";
import { isSafeCollisionSurface } from "../../../src/collision/regularInflection";
import type { MaxTargetFormKey } from "./targetFormKey";

/**
 * `PRE-RELEASE-MAX-REALIZATION-SPIKE1` prototype realizer. Test support only.
 *
 * One function: given what a Target position requires and one candidate's own
 * recorded dictionary fields, produce the finished surface for that position —
 * or refuse. There is no best effort, no repair pass and no fallback. A refusal
 * means the caller leaves the Target text exactly as the writer wrote it.
 *
 * Three properties are the whole point:
 *
 *   - **The class decides, never the surface.** Every rule states the single
 *     code point its class's base form must end with, and a record whose
 *     conjugation type and base form disagree is refused rather than repaired.
 *     Nothing here inspects a Target surface, and nothing infers a class from
 *     an ending.
 *
 *   - **The table is closed by its key type.** `VERB_RULES` is typed
 *     `Record<RegularVerbConjugationType, VerbRule>` over the allowlist
 *     `src/transform/regularConjugationTypes.ts` exports, which
 *     `manual-morph-3` and Collision already share. A class the allowlist does
 *     not name, or one it names and this table omits, is a `npm run typecheck`
 *     error. The irregular, archaic and single-lemma classes (サ変, カ変,
 *     五段・カ行促音便, 五段・ラ行特殊, 五段・ワ行ウ音便, 一段・クレル, 文語)
 *     are absent because the allowlist does not name them.
 *
 *   - **Admission is per (key, class), not per key.** `ADMITS` is the scan's
 *     result, not a convenience: a key-only table would have produced
 *     食べせる, 書かさせる, 食べう and 泳いた.
 */

type VerbRule = {
	/** The one code point every base form of this class ends with. */
	readonly baseEnding: string;
	/** 未然形: what replaces `baseEnding`. */
	readonly irrealis: string;
	/**
	 * 未然ウ接続: what replaces `baseEnding`. 一段 is `よ`, not empty: the
	 * dictionary analyses 食べよう as 食べよ + う, so the volitional `う` is one
	 * auxiliary for every class and 一段 is admitted here like the rest.
	 */
	readonly volitional: string;
	/** 連用形: what replaces `baseEnding`. */
	readonly continuative: string;
	/** The stem the past auxiliary attaches to, reached through 連用形 or 連用タ接続. */
	readonly taStem: string;
	/** Whether that auxiliary is the voiced one. Decided by class, never by the Target surface. */
	readonly taVoicing: "t" | "d";
	/** 仮定形: what replaces `baseEnding`. */
	readonly conditional: string;
};

const VERB_RULES: Readonly<Record<RegularVerbConjugationType, VerbRule>> = {
	一段: { baseEnding: "る", irrealis: "", volitional: "よ", continuative: "", taStem: "", taVoicing: "t", conditional: "れ" },
	"五段・カ行イ音便": { baseEnding: "く", irrealis: "か", volitional: "こ", continuative: "き", taStem: "い", taVoicing: "t", conditional: "け" },
	"五段・ガ行": { baseEnding: "ぐ", irrealis: "が", volitional: "ご", continuative: "ぎ", taStem: "い", taVoicing: "d", conditional: "げ" },
	// サ行 has no 連用タ接続 entry at all: 話した is 話し + た, so its 連用形 is the た-stem.
	"五段・サ行": { baseEnding: "す", irrealis: "さ", volitional: "そ", continuative: "し", taStem: "し", taVoicing: "t", conditional: "せ" },
	"五段・タ行": { baseEnding: "つ", irrealis: "た", volitional: "と", continuative: "ち", taStem: "っ", taVoicing: "t", conditional: "て" },
	"五段・ナ行": { baseEnding: "ぬ", irrealis: "な", volitional: "の", continuative: "に", taStem: "ん", taVoicing: "d", conditional: "ね" },
	"五段・バ行": { baseEnding: "ぶ", irrealis: "ば", volitional: "ぼ", continuative: "び", taStem: "ん", taVoicing: "d", conditional: "べ" },
	"五段・マ行": { baseEnding: "む", irrealis: "ま", volitional: "も", continuative: "み", taStem: "ん", taVoicing: "d", conditional: "め" },
	"五段・ラ行": { baseEnding: "る", irrealis: "ら", volitional: "ろ", continuative: "り", taStem: "っ", taVoicing: "t", conditional: "れ" },
	"五段・ワ行促音便": { baseEnding: "う", irrealis: "わ", volitional: "お", continuative: "い", taStem: "っ", taVoicing: "t", conditional: "え" },
};

type AdjectiveRule = {
	readonly baseEnding: string;
	readonly continuative: string;
	readonly past: string;
	readonly conditional: string;
};

/** Both regular イ-adjective classes inflect identically in every adopted form. */
const ADJECTIVE_RULES: Readonly<
	Record<RegularAdjectiveConjugationType, AdjectiveRule>
> = {
	"形容詞・アウオ段": { baseEnding: "い", continuative: "く", past: "かっ", conditional: "けれ" },
	"形容詞・イ段": { baseEnding: "い", continuative: "く", past: "かっ", conditional: "けれ" },
};

const VERB_RULE_BY_TYPE: ReadonlyMap<string, VerbRule> = new Map(
	Object.entries(VERB_RULES),
);
const ADJECTIVE_RULE_BY_TYPE: ReadonlyMap<string, AdjectiveRule> = new Map(
	Object.entries(ADJECTIVE_RULES),
);

const GODAN: readonly string[] = REGULAR_VERB_CONJUGATION_TYPES.filter(
	(type) => type !== "一段",
);

function voiced(voicing: "t" | "d"): readonly string[] {
	return REGULAR_VERB_CONJUGATION_TYPES.filter(
		(type) => VERB_RULES[type].taVoicing === voicing,
	);
}

/**
 * The admitted candidate classes per Target requirement.
 *
 * Every set is a scan result: it follows from the closed rules above and from
 * the dictionary's own class x form distribution, both of which
 * `tests/distribution/maxRealization.test.ts` re-derives. Admission does **not**
 * require full re-analysis agreement. That suite additionally builds the
 * surface for each admitted pair, appends each allowed follower and tokenizes
 * the result with the production adapter; 98.29% of those probes come back as
 * the same lexeme and the same follower, and the remaining 1.71% are accepted
 * as a known re-analysis difference rather than removed from the admission.
 */
const ADMITS: Readonly<Record<MaxTargetFormKey, readonly string[]>> =
	Object.freeze({
		"verb-basic": REGULAR_VERB_CONJUGATION_TYPES,
		"verb-irrealis-negation": REGULAR_VERB_CONJUGATION_TYPES,
		// 食べせる / 食べれる (ら抜き) are not the 一段 causative or passive.
		"verb-irrealis-godan-suffix": GODAN,
		// 書かさせる / 書かられる are not the 五段 ones.
		"verb-irrealis-ichidan-suffix": ["一段"],
		// 食べよう is 食べよ + う, so the one allowed follower covers every class.
		"verb-volitional-u": REGULAR_VERB_CONJUGATION_TYPES,
		"verb-continuative": REGULAR_VERB_CONJUGATION_TYPES,
		"verb-ta-stem-t": voiced("t"),
		"verb-ta-stem-d": voiced("d"),
		"verb-conditional-ba": REGULAR_VERB_CONJUGATION_TYPES,
		"adjective-basic": REGULAR_ADJECTIVE_CONJUGATION_TYPES,
		"adjective-continuative-ku": REGULAR_ADJECTIVE_CONJUGATION_TYPES,
		"adjective-past-katta": REGULAR_ADJECTIVE_CONJUGATION_TYPES,
		"adjective-conditional-kereba": REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	});

/** Read-only view of the admission table, for the record and the coverage fixture. */
export const MAX_REALIZER_ADMITTED_CLASSES: Readonly<
	Record<MaxTargetFormKey, readonly string[]>
> = Object.freeze(
	Object.fromEntries(
		Object.entries(ADMITS).map(([key, classes]) => [
			key,
			Object.freeze([...classes]),
		]),
	),
) as Readonly<Record<MaxTargetFormKey, readonly string[]>>;

/**
 * Lexemes this realizer refuses although their recorded class is admitted.
 *
 * Two different problems, both fail-closed by exact recorded base form — never
 * by a surface, an ending or a spelling heuristic.
 *
 * **Suppletive paradigm.** A conjugation class is a claim about a paradigm, and
 * a small number of lexemes break it. `ある` is recorded 五段・ラ行, so the
 * paradigm predicts `あらない`, and the negative of `ある` is the suppletive
 * `ない`. Refusing the lexeme and emitting a wrong form for it are different
 * outcomes and only the first is in scope, so the whole lexeme goes — not only
 * its negative, because a pool that offered `あった` but not `あらない` would
 * still be a paradigm this table does not have. This is the closed set
 * `src/collision/regularInflection.ts` already carries.
 *
 * **Expansion artifact.** The shipped IPADIC contains three 一段 lexemes whose
 * base form is another 一段 base form with the class's own `る` appended:
 * `へるる`, `のぼりつめるる` and `上り詰めるる`, with 基本形 readings `ヘルル`,
 * `ノボリツメルル` and `ノボリツメルル`. Every one of their nine forms is
 * internally consistent, so nothing inside a single entry betrays them; what
 * betrays them is the other lexeme. They matter because they are *reachable*:
 * the tokenizer analyses the text `へる` as the 連用形 of `へるる`, so a Source
 * containing `へる` yields a candidate whose recorded base form is `へるる`,
 * and realizing its 基本形 would put `へるる` — not a Japanese word — into the
 * writer's text. Strict Body 10 never had this exposure, because it only ever
 * places a surface the Source itself contained; constructing one is what
 * introduces it.
 *
 * Neither set is prose. `tests/distribution/maxRealization.test.ts` re-derives
 * the artifact criterion — a base form that is another base form of the same
 * class plus that class's base ending — over all twelve admitted classes and
 * fails if the shipped dictionary yields any member this set does not name.
 */
const IRREGULAR_LEXEMES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["五段・ラ行", new Set(["ある", "有る", "在る"])],
	["一段", new Set(["へるる", "のぼりつめるる", "上り詰めるる"])],
]);

export const MAX_REALIZER_IRREGULAR_LEXEMES: readonly {
	readonly conjugationType: string;
	readonly baseForms: readonly string[];
}[] = Object.freeze(
	[...IRREGULAR_LEXEMES].map(([conjugationType, baseForms]) =>
		Object.freeze({
			conjugationType,
			baseForms: Object.freeze([...baseForms].sort()),
		}),
	),
);

export function isMaxIrregularLexeme(
	conjugationType: string,
	baseForm: string,
): boolean {
	return IRREGULAR_LEXEMES.get(conjugationType)?.has(baseForm) === true;
}

export type MaxRealizerRejection =
	| "unknown-token"
	| "unsupported-part-of-speech"
	| "missing-field"
	| "unsupported-conjugation-type"
	| "class-not-admitted-by-target"
	| "irregular-lexeme"
	| "base-form-class-mismatch"
	| "empty-stem"
	| "unsafe-surface"
	| "unsafe-realized-surface";

export type MaxRealizerResult =
	| { readonly realized: true; readonly surface: string }
	| { readonly realized: false; readonly reason: MaxRealizerRejection };

/**
 * The candidate fields the realizer reads. These are exactly the fields the
 * shipped compact dictionary keeps for an independent verb or i-adjective, and
 * they reach the realizer from the Snapshot's own Manual projection record —
 * never from a caller-assembled token, and never from a surface.
 */
export type MaxRealizerCandidate = {
	readonly pos: string;
	readonly detail1: string;
	readonly conjugationType: string;
	readonly baseForm: string;
	readonly isUnknown: boolean;
};

function present(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value !== "*";
}

function stemOf(baseForm: string, ending: string): string | null {
	if (!baseForm.endsWith(ending)) {
		return null;
	}
	const stem = baseForm.slice(0, baseForm.length - ending.length);
	return stem.length === 0 ? null : stem;
}

/** The finished surface for `key`, built from this candidate's own fields. */
export function realizeMaxCandidate(
	key: MaxTargetFormKey,
	candidate: MaxRealizerCandidate,
): MaxRealizerResult {
	if (candidate.isUnknown) {
		return { realized: false, reason: "unknown-token" };
	}
	const verb = candidate.pos === "動詞" && candidate.detail1 === "自立";
	const adjective = candidate.pos === "形容詞" && candidate.detail1 === "自立";
	if (!verb && !adjective) {
		return { realized: false, reason: "unsupported-part-of-speech" };
	}
	if (!present(candidate.conjugationType) || !present(candidate.baseForm)) {
		return { realized: false, reason: "missing-field" };
	}
	if (!isSafeCollisionSurface(candidate.baseForm)) {
		return { realized: false, reason: "unsafe-surface" };
	}
	const rule = verb
		? VERB_RULE_BY_TYPE.get(candidate.conjugationType)
		: ADJECTIVE_RULE_BY_TYPE.get(candidate.conjugationType);
	if (!rule) {
		return { realized: false, reason: "unsupported-conjugation-type" };
	}
	// The Target decides which classes it will take, before any surface exists.
	if (!ADMITS[key].includes(candidate.conjugationType)) {
		return { realized: false, reason: "class-not-admitted-by-target" };
	}
	if (isMaxIrregularLexeme(candidate.conjugationType, candidate.baseForm)) {
		return { realized: false, reason: "irregular-lexeme" };
	}
	const stem = stemOf(candidate.baseForm, rule.baseEnding);
	if (stem === null) {
		// Either the class's required ending is absent — the record's own two
		// fields disagree — or the whole base form is that ending.
		return candidate.baseForm.endsWith(rule.baseEnding)
			? { realized: false, reason: "empty-stem" }
			: { realized: false, reason: "base-form-class-mismatch" };
	}
	const surface = verb
		? verbSurface(key, stem, rule as VerbRule, candidate.baseForm)
		: adjectiveSurface(key, stem, rule as AdjectiveRule, candidate.baseForm);
	if (surface === null) {
		return { realized: false, reason: "class-not-admitted-by-target" };
	}
	// A backstop, and knowingly unreachable for the ending table above: every
	// ending is plain hiragana appended to a stem, and none of those code
	// points composes with what precedes it, so a base form that passed
	// `isSafeCollisionSurface` cannot produce a surface that fails it. It
	// carries its own reason rather than sharing `unsafe-surface`, so the
	// record-level guard is the one a mutation can be shown to need, and so a
	// future ending table that does make this reachable says so by name
	// instead of hiding behind the earlier check.
	if (!isSafeCollisionSurface(surface)) {
		return { realized: false, reason: "unsafe-realized-surface" };
	}
	return { realized: true, surface };
}

function verbSurface(
	key: MaxTargetFormKey,
	stem: string,
	rule: VerbRule,
	baseForm: string,
): string | null {
	switch (key) {
		case "verb-basic":
			// Returned unchanged, never rebuilt from the stem.
			return baseForm;
		case "verb-irrealis-negation":
		case "verb-irrealis-godan-suffix":
		case "verb-irrealis-ichidan-suffix":
			return `${stem}${rule.irrealis}`;
		case "verb-volitional-u":
			return `${stem}${rule.volitional}`;
		case "verb-continuative":
			return `${stem}${rule.continuative}`;
		case "verb-ta-stem-t":
		case "verb-ta-stem-d":
			return `${stem}${rule.taStem}`;
		case "verb-conditional-ba":
			return `${stem}${rule.conditional}`;
		default:
			return null;
	}
}

function adjectiveSurface(
	key: MaxTargetFormKey,
	stem: string,
	rule: AdjectiveRule,
	baseForm: string,
): string | null {
	switch (key) {
		case "adjective-basic":
			return baseForm;
		case "adjective-continuative-ku":
			// The dictionary carries two 連用テ接続 surfaces per lexeme, 早く and
			// the colloquial 早くっ. Only the plain one connects to all three
			// allowed followers (ない / て / なる), so it is the only one built.
			return `${stem}${rule.continuative}`;
		case "adjective-past-katta":
			return `${stem}${rule.past}`;
		case "adjective-conditional-kereba":
			return `${stem}${rule.conditional}`;
		default:
			return null;
	}
}
