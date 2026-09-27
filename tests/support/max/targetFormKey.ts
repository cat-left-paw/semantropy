import type { JapaneseToken } from "../../../src/tokenizer/JapaneseTokenizer";
import { manualMorphConnection } from "../../../src/transform/manualMorphology";

/**
 * `PRE-RELEASE-MAX-REALIZATION-SPIKE1` prototype. Test support only: nothing in
 * `src/` imports this file, and `tests/maxRealizationDependencies.test.ts` pins
 * that. It is deliberately not an API CORE1 is expected to adopt as written.
 *
 * A `MaxTargetFormKey` is what the *Target position* requires, never what a
 * candidate happens to be. It is derived from the already-authenticated
 * `manualMorphConnection()` result — slot class, conjugation form and the
 * matched Target connection — so this module holds no second opinion about
 * which slots are eligible or which followers are allowed.
 *
 * Why the follower is part of the key
 * -----------------------------------
 * The realizer replaces the Target token and nothing else; the follower stays
 * in the text exactly as the writer wrote it. So a key that named only the
 * conjugation form would be a lie: the dictionary's 連用タ接続 stem of 泳ぐ is
 * `泳い`, which takes `だ`, while the 連用タ接続 stem of 書く is `書い`, which
 * takes `た`. Both are "連用タ接続"; substituting one for the other produces
 * `泳いた` or `書いだ`. The voicing of the preserved auxiliary is therefore a
 * Target requirement, and it splits that form into two keys.
 *
 * The same scan shows the reverse: two *different* form labels can be one
 * realization role. 一段 and 五段・サ行 have **zero** 連用タ接続 entries in the
 * shipped dictionary (`tests/distribution/maxRealization.test.ts` re-derives
 * that count), because their 連用形 is what `た` attaches to — `食べた`,
 * `話した`. So `verb-ta-stem-t` names a role that 一段 and サ行 reach through
 * 連用形 and the promotive classes reach through 連用タ接続. That is not an
 * assumption that labels are interchangeable: it is read off the dictionary's
 * own class x form distribution, which the distribution suite re-derives.
 *
 * Admission is decided by the closed realizer rules and that distribution. It
 * does **not** require full re-analysis agreement: every (key, class, lexeme,
 * follower) is additionally re-analysed through the production tokenizer and
 * 98.29% come back as the same lexeme and follower, with the remaining 1.71%
 * accepted as a known re-analysis difference.
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

export type MaxTargetFormRejection =
	| "not-a-morph-slot"
	| "unsupported-target-form";

export type MaxTargetFormResult =
	| { readonly supported: true; readonly key: MaxTargetFormKey }
	| { readonly supported: false; readonly reason: MaxTargetFormRejection };

/**
 * (slot class, conjugation form, Target connection) -> key.
 *
 * Every entry is a pair the Manual allowlist can actually produce, and a pair
 * absent here is `unsupported-target-form` — never a default. `null` is the
 * adjective basic form, the one slot whose contract states no follower
 * requirement.
 */
const KEYS = new Map<string, MaxTargetFormKey>([
	// 基本形: the base form is placed as it stands, whatever follows it.
	["verb\u001f基本形\u001fperiod", "verb-basic"],
	["verb\u001f基本形\u001fcomma", "verb-basic"],
	["verb\u001f基本形\u001fgeneral-noun", "verb-basic"],
	["verb\u001f基本形\u001fdependent-noun-koto", "verb-basic"],
	["verb\u001f基本形\u001fparticle-to", "verb-basic"],
	["verb\u001f基本形\u001fparticle-kara", "verb-basic"],
	// 未然形 + ない / ぬ: every regular class reaches it.
	["verb\u001f未然形\u001faux-nai", "verb-irrealis-negation"],
	["verb\u001f未然形\u001faux-nu", "verb-irrealis-negation"],
	// 未然形 + せる / れる is the 五段 causative and passive; 食べせる is not a word.
	["verb\u001f未然形\u001fsuffix-seru", "verb-irrealis-godan-suffix"],
	["verb\u001f未然形\u001fsuffix-reru", "verb-irrealis-godan-suffix"],
	// 未然形 + させる / られる is the 一段 one; 書かさせる is not a word.
	["verb\u001f未然形\u001fsuffix-saseru", "verb-irrealis-ichidan-suffix"],
	["verb\u001f未然形\u001fsuffix-rareru", "verb-irrealis-ichidan-suffix"],
	// 未然ウ接続 + う, for every regular class. This was written as 五段-only on
	// the assumption that a 一段 volitional is 食べ + よう; the dictionary says
	// otherwise — 食べよう is 食べよ (未然ウ接続) + う — so the one allowed
	// follower covers all ten classes, with 一段's 未然ウ接続 ending being よ.
	["verb\u001f未然ウ接続\u001faux-u", "verb-volitional-u"],
	// 連用形 before ます / たい / ながら: every regular class reaches it.
	["verb\u001f連用形\u001faux-masu", "verb-continuative"],
	["verb\u001f連用形\u001faux-tai", "verb-continuative"],
	["verb\u001f連用形\u001fparticle-nagara", "verb-continuative"],
	// The た-stem role, reached through 連用形 by 一段 / サ行 and through
	// 連用タ接続 by the promotive classes. Split by the preserved auxiliary.
	["verb\u001f連用形\u001faux-ta", "verb-ta-stem-t"],
	["verb\u001f連用形\u001fparticle-te", "verb-ta-stem-t"],
	["verb\u001f連用タ接続\u001faux-ta", "verb-ta-stem-t"],
	["verb\u001f連用タ接続\u001fparticle-te", "verb-ta-stem-t"],
	["verb\u001f連用タ接続\u001faux-da", "verb-ta-stem-d"],
	["verb\u001f連用タ接続\u001fparticle-de", "verb-ta-stem-d"],
	["verb\u001f仮定形\u001fparticle-ba", "verb-conditional-ba"],
	["i-adjective\u001f基本形\u001fnull", "adjective-basic"],
	["i-adjective\u001f連用テ接続\u001faux-nai", "adjective-continuative-ku"],
	["i-adjective\u001f連用テ接続\u001fparticle-te", "adjective-continuative-ku"],
	["i-adjective\u001f連用テ接続\u001fverb-naru", "adjective-continuative-ku"],
	["i-adjective\u001f連用タ接続\u001faux-ta", "adjective-past-katta"],
	["i-adjective\u001f仮定形\u001fparticle-ba", "adjective-conditional-kereba"],
]);

/** Read-only view of the mapping, for the record and the coverage fixture. */
export const MAX_TARGET_FORM_KEY_ENTRIES: readonly {
	readonly slotClass: string;
	readonly conjugationForm: string;
	readonly targetConnection: string | null;
	readonly key: MaxTargetFormKey;
}[] = Object.freeze(
	[...KEYS].map(([composite, key]) => {
		const [slotClass, conjugationForm, connection] = composite.split("\u001f");
		return Object.freeze({
			slotClass: slotClass!,
			conjugationForm: conjugationForm!,
			targetConnection: connection === "null" ? null : connection!,
			key,
		});
	}),
);

/**
 * The Target requirement at this position, or a fixed rejection. `next` is the
 * token that immediately follows in the same analysis run, or null at a run
 * end; it is read, never consumed or replaced.
 */
export function maxTargetFormKey(
	token: JapaneseToken,
	next: JapaneseToken | null,
): MaxTargetFormResult {
	const connection = manualMorphConnection(token, next);
	if (!connection.supported) {
		return { supported: false, reason: "not-a-morph-slot" };
	}
	const composite = [
		connection.compatibility.slotClass,
		connection.compatibility.conjugationForm,
		connection.compatibility.targetConnection ?? "null",
	].join("\u001f");
	const key = KEYS.get(composite);
	return key
		? { supported: true, key }
		: { supported: false, reason: "unsupported-target-form" };
}
