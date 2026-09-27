import {
	REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	REGULAR_VERB_CONJUGATION_TYPES,
	type RegularAdjectiveConjugationType,
	type RegularVerbConjugationType,
} from "../transform/regularConjugationTypes";

/**
 * The closed Collision inflection table.
 *
 * `PRE-RELEASE-COLLISION-POLICY3` §3.2 / §3.4 allows Collision to build
 * finished Modifier and Predicate surfaces from regular independent verbs and
 * regular independent イ-adjectives, and nothing else. This module is the only
 * place a surface is produced by rule rather than copied from the Source.
 *
 * Three properties matter more than coverage here:
 *
 *   - The classes are `manual-morph-2`'s regular allowlists, imported from
 *     `src/transform/regularConjugationTypes.ts`, which both modules share. The
 *     table is typed `Record<RegularVerbConjugationType, VerbRule>`, so a class
 *     the allowlist does not name, or one it names and the table omits, is a
 *     compile error in `npm run typecheck` — which every build runs. Collision
 *     cannot hold a looser allowlist.
 *
 *   - Every rule states the base-form ending its class requires. A record whose
 *     conjugation type and base form disagree is refused, not repaired: the
 *     tokenizer's fields, not the surface, decide the class, and nothing here
 *     infers a class from an ending.
 *
 *   - There is no best effort. An unsupported conjugation type, a lexeme in the
 *     irregular set below, a missing or unset field, an unsafe surface or a stem
 *     that would be empty returns `null`, and the caller drops the candidate
 *     entirely — from the Modifier pool and the Predicate pool alike. No
 *     fallback conjugation, no partial variant set, no guessed form.
 */

/** Cc / Cf / Cs / Zl / Zp: controls, format, surrogates, line and paragraph separators. */
const DISALLOWED_CATEGORY = /\p{Cc}|\p{Cf}|\p{Cs}|\p{Zl}|\p{Zp}/u;

function hasIsolatedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) {
				return true;
			}
			index += 1;
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

/**
 * A Source surface this slice is willing to carry into a finished Collision
 * lexeme. Unlike a pattern literal it is not restricted to one script: a
 * Source may legitimately contain a Latin or mixed proper noun. What it may
 * not contain is an unset field, whitespace at either end, a control, format
 * or separator code point, an isolated surrogate, or a non-NFC form that a
 * later concatenation would silently re-normalize.
 */
export function isSafeCollisionSurface(value: string): boolean {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value !== "*" &&
		value === value.trim() &&
		value === value.normalize("NFC") &&
		!DISALLOWED_CATEGORY.test(value) &&
		!hasIsolatedSurrogate(value)
	);
}

export type CollisionVerbVariant = "basic" | "past" | "progressive" | "negative";

export const COLLISION_VERB_VARIANTS = Object.freeze([
	"basic",
	"past",
	"progressive",
	"negative",
] as const);

export type CollisionVerbForms = Readonly<Record<CollisionVerbVariant, string>>;

type VerbRule = {
	/** The single code point every base form of this class ends with. */
	readonly baseEnding: string;
	/** What replaces `baseEnding` before `ない`. */
	readonly negativeStem: string;
	/** What replaces `baseEnding` for the plain past. */
	readonly past: string;
	/** What replaces `baseEnding` before `いる`. */
	readonly te: string;
};

/**
 * 一段 and the nine regular 五段 classes. The key type is the shared allowlist,
 * so this record is exhaustive and closed by construction: 五段・カ行促音便
 * (行く), サ変, カ変, 五段・ラ行特殊, 五段・ワ行ウ音便 and the archaic classes
 * are absent because the allowlist does not name them.
 */
const VERB_RULES: Readonly<Record<RegularVerbConjugationType, VerbRule>> = {
	一段: { baseEnding: "る", negativeStem: "", past: "た", te: "て" },
	"五段・カ行イ音便": { baseEnding: "く", negativeStem: "か", past: "いた", te: "いて" },
	"五段・ガ行": { baseEnding: "ぐ", negativeStem: "が", past: "いだ", te: "いで" },
	"五段・サ行": { baseEnding: "す", negativeStem: "さ", past: "した", te: "して" },
	"五段・タ行": { baseEnding: "つ", negativeStem: "た", past: "った", te: "って" },
	"五段・ナ行": { baseEnding: "ぬ", negativeStem: "な", past: "んだ", te: "んで" },
	"五段・バ行": { baseEnding: "ぶ", negativeStem: "ば", past: "んだ", te: "んで" },
	"五段・マ行": { baseEnding: "む", negativeStem: "ま", past: "んだ", te: "んで" },
	"五段・ラ行": { baseEnding: "る", negativeStem: "ら", past: "った", te: "って" },
	"五段・ワ行促音便": { baseEnding: "う", negativeStem: "わ", past: "った", te: "って" },
};

const VERB_RULE_BY_TYPE: ReadonlyMap<string, VerbRule> = new Map(
	Object.entries(VERB_RULES),
);

/** The table's classes, in allowlist order. */
export const COLLISION_REGULAR_VERB_CONJUGATION_TYPES: readonly string[] =
	REGULAR_VERB_CONJUGATION_TYPES;

/** Both regular イ-adjective classes end their base form in `い`. */
const ADJECTIVE_RULES: Readonly<
	Record<RegularAdjectiveConjugationType, { readonly baseEnding: string }>
> = {
	"形容詞・アウオ段": { baseEnding: "い" },
	"形容詞・イ段": { baseEnding: "い" },
};

const ADJECTIVE_RULE_BY_TYPE: ReadonlyMap<string, { readonly baseEnding: string }> =
	new Map(Object.entries(ADJECTIVE_RULES));

export const COLLISION_REGULAR_ADJECTIVE_CONJUGATION_TYPES: readonly string[] =
	REGULAR_ADJECTIVE_CONJUGATION_TYPES;

/**
 * Lexemes whose recorded class is regular and whose real inflection is not.
 *
 * A conjugation class is a claim about a paradigm, and a small number of
 * lexemes break it. `ある` is recorded as 五段・ラ行, so the paradigm predicts
 * `あらない` — which is not Japanese, because the negative of `ある` is the
 * suppletive `ない`. `src/transform/manualMorphology.ts` documents the same
 * lexeme as the reason its candidates need a Source observation rather than a
 * rule.
 *
 * Policy 2 refuses to present a broken form as strangeness, and Policy 3 §12
 * keeps irregular conjugation out of the initial scope. Failing to offer a
 * lexeme and emitting a wrong form for it are different outcomes, and only the
 * first is in scope, so the whole lexeme is excluded from every Collision pool.
 * This is a fail-closed exclusion, not an irregular inflector.
 *
 * Survey of the allowed classes, read from the shipped compact IPADIC's own
 * `dict.words` and pinned by `tests/distribution/collisionLexeme.test.ts`:
 *
 *   - 五段・ラ行: `ある` and its 有る / 在る writings are the one lexical
 *     exception found. Most honorific ラ行 verbs (なさる, 下さる, いらっしゃる,
 *     ござる) are 五段・ラ行特殊, which the allowlist excludes — but `おっしゃる`
 *     also carries a plain 五段・ラ行 entry, and it is regular in all four forms
 *     built here (おっしゃった / おっしゃっている / おっしゃらない). The kanji
 *     spellings 来る, する, いる and 居る additionally carry unrelated 五段・ラ行
 *     lexemes (きたる, 擦る, 要る, おる), which are likewise regular here.
 *   - 五段・ワ行促音便: `買う` and `言う` are regular here. `問う` carries both
 *     五段・ワ行ウ音便 and 五段・ワ行促音便, and `請う` carries only the
 *     promotive class, so both are admitted; the dictionary's own 連用タ接続
 *     entries for that class are what 問った / 請った follow. Only `乞う` is
 *     ウ音便 alone, and the allowlist excludes that class.
 *   - 五段・カ行イ音便: `行く` is 五段・カ行促音便 / 五段・カ行促音便ユク, neither
 *     of which the allowlist names.
 *   - 一段: `くれる` also carries 一段・クレル, an excluded class; under plain
 *     一段 it is irregular only in the imperative, which this slice never builds.
 *   - No lexical exception was found in the remaining classes for the four
 *     forms built here.
 *
 * This survey is a targeted check of named lexemes, not a proof of
 * completeness: nothing mechanical decides which of the dictionary's 129,855
 * independent-verb entries inflect suppletively. An earlier version of this
 * comment mis-stated the ワ行 classification, which is why the classification is
 * now a gate rather than prose.
 *
 * Adjectives need no equivalent set: `regularAdjectiveBasicForm()` returns the
 * recorded base form unchanged and constructs nothing, so it cannot emit a form
 * the dictionary did not already contain.
 */
const IRREGULAR_VERB_LEXEMES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["五段・ラ行", new Set(["ある", "有る", "在る"])],
]);

/** Read-only view of the exclusion set, for records and regressions. */
export const COLLISION_IRREGULAR_VERB_LEXEMES: readonly {
	readonly conjugationType: string;
	readonly baseForms: readonly string[];
}[] = Object.freeze(
	[...IRREGULAR_VERB_LEXEMES].map(([conjugationType, baseForms]) =>
		Object.freeze({
			conjugationType,
			baseForms: Object.freeze([...baseForms].sort()),
		}),
	),
);

/**
 * Whether this lexeme is excluded from Collision although its class is allowed.
 * Matching is on the exact recorded base form, never on a surface or an ending.
 */
export function isCollisionIrregularLexeme(
	conjugationType: string,
	baseForm: string,
): boolean {
	return IRREGULAR_VERB_LEXEMES.get(conjugationType)?.has(baseForm) === true;
}

/**
 * The stem of a base form whose class requires `ending`, or `null` when the
 * two disagree or nothing would be left in front of the ending.
 */
function stemOf(baseForm: string, ending: string): string | null {
	if (!isSafeCollisionSurface(baseForm) || !baseForm.endsWith(ending)) {
		return null;
	}
	const stem = baseForm.slice(0, baseForm.length - ending.length);
	return stem.length === 0 ? null : stem;
}

/**
 * The four Collision variants of one regular independent verb, or `null`.
 *
 * All four are produced together or none is: a caller can never publish a
 * lexeme that has a past form but no negative.
 */
export function inflectRegularVerb(input: {
	readonly conjugationType: string;
	readonly baseForm: string;
}): CollisionVerbForms | null {
	const rule = VERB_RULE_BY_TYPE.get(input.conjugationType);
	if (!rule || isCollisionIrregularLexeme(input.conjugationType, input.baseForm)) {
		return null;
	}
	const stem = stemOf(input.baseForm, rule.baseEnding);
	if (stem === null) {
		return null;
	}
	const forms = {
		basic: input.baseForm,
		past: `${stem}${rule.past}`,
		progressive: `${stem}${rule.te}いる`,
		negative: `${stem}${rule.negativeStem}ない`,
	};
	for (const value of Object.values(forms)) {
		if (!isSafeCollisionSurface(value)) {
			return null;
		}
	}
	return Object.freeze(forms);
}

/**
 * The basic form of one regular independent イ-adjective, or `null`. The base
 * form is returned unchanged; it is validated, never rebuilt from a stem.
 */
export function regularAdjectiveBasicForm(input: {
	readonly conjugationType: string;
	readonly baseForm: string;
}): string | null {
	const rule = ADJECTIVE_RULE_BY_TYPE.get(input.conjugationType);
	if (!rule) {
		return null;
	}
	return stemOf(input.baseForm, rule.baseEnding) === null ? null : input.baseForm;
}
