import {
	freezeAnalysis,
	vocabularyCandidateId,
} from "../analysis/rubyVocabulary";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";

/**
 * `PRE-RELEASE-ADVERB-SPIKE1`: what the shipped compact IPADIC lets a
 * regular-adverb candidate *be*.
 *
 * This module answers one question — is this token a `regular-adverb` family
 * member, and which candidate is it? — and nothing else. It performs no
 * inflection, derives no adverb form from an adjective, composes no multi-token
 * phrase, and never repairs a field the tokenizer did not report.
 *
 * Two facts about the shipped dictionary shape everything here, and both are
 * pinned against the real bytes by `tests/distribution/adverbSpike.test.ts`
 * rather than asserted in prose:
 *
 *   - `副詞` has exactly two `detail1` values, 一般 (2,499 entries) and
 *     助詞類接続 (533), for 3,032 entries over 2,991 distinct surfaces. Policy
 *     `PRE-RELEASE-AUTO-POS-POLICY1` §6 unites them into one compatibility
 *     family, because `ゆっくり` is 助詞類接続 and `じっくり` is 一般.
 *   - Compaction keeps only slots 0-1 for every `副詞` entry. A production
 *     adverb token therefore carries `"*"` in detail2, detail3, conjugation
 *     type, conjugation form and base form, and no reading at all. The surface
 *     and the class are the *whole* of the morphology available, so a
 *     candidate key may not pretend to more.
 *
 * Surface alone is not an identity: 33 surfaces carry entries in both classes
 * (`ちょっと`, `また`, `一層`, ...), so `ちょっと`/助詞類接続 and
 * `ちょっと`/一般 are two candidates that must never share an observation.
 * Identity is therefore `vocabularyCandidateId()` — the same canonical function
 * the Vocabulary Snapshot mints its records with, imported rather than
 * re-implemented, so `PRE-RELEASE-ADVERB-MANUAL1` can bind these observations
 * to Snapshot records without a second opinion about what a candidate is.
 */

export const ADVERB_FAMILY = "regular-adverb";

/** IPADIC slot 0 for every member of the family. */
export const ADVERB_POS = "副詞";

/**
 * The two `副詞` detail1 values the shipped dictionary has, united by policy
 * into one compatibility family. Raw detail1 equality is deliberately *not*
 * required between a Target and a candidate.
 */
export const ADVERB_CLASSES = Object.freeze(["一般", "助詞類接続"] as const);

export type AdverbClass = (typeof ADVERB_CLASSES)[number];

/** IPADIC's own "no value" marker, as `linderaToken.ts` reports it. */
const UNSET = "*";

export type AdverbFamilyRejection =
	| "unknown-token"
	| "unsupported-part-of-speech"
	| "unsupported-adverb-class"
	| "missing-surface";

/**
 * One family member. `identityKey` is the canonical candidate identity and the
 * only key observations, profile entries and capability answers are filed
 * under; `surface` and `adverbClass` are the parts of it callers need to read,
 * both taken from the token, never from a caller-supplied string.
 */
export type AdverbCandidateIdentity = {
	readonly family: typeof ADVERB_FAMILY;
	readonly adverbClass: AdverbClass;
	readonly surface: string;
	readonly identityKey: string;
};

export type AdverbFamilyResult =
	| { readonly supported: true; readonly identity: AdverbCandidateIdentity }
	| { readonly supported: false; readonly reason: AdverbFamilyRejection };

function isPresent(value: string | undefined): value is string {
	return typeof value === "string" && value.length > 0 && value !== UNSET;
}

function isAdverbClass(value: string): value is AdverbClass {
	return (ADVERB_CLASSES as readonly string[]).includes(value);
}

/**
 * Classifies one token as a `regular-adverb` candidate.
 *
 * Fail-closed in every direction: an unknown token (including the whitespace
 * coverage gaps `linderaToken.ts` restores), a different part of speech, a
 * `副詞` subclass outside the two the dictionary has, or an absent surface all
 * return a fixed reason and no identity. Nothing is inferred from the surface
 * string: `そっと` is admitted because slot 0/1 say 副詞/一般, not because it
 * looks like an adverb, and `非常` is refused because the dictionary has no
 * `副詞` entry for it.
 */
export function classifyAdverbCandidate(token: JapaneseToken): AdverbFamilyResult {
	if (token.isUnknown) {
		return { supported: false, reason: "unknown-token" };
	}
	if (token.pos !== ADVERB_POS) {
		return { supported: false, reason: "unsupported-part-of-speech" };
	}
	if (!isAdverbClass(token.detail1)) {
		return { supported: false, reason: "unsupported-adverb-class" };
	}
	if (!isPresent(token.surface)) {
		return { supported: false, reason: "missing-surface" };
	}
	return {
		supported: true,
		identity: freezeAnalysis({
			family: ADVERB_FAMILY,
			adverbClass: token.detail1,
			surface: token.surface.normalize("NFC"),
			identityKey: vocabularyCandidateId(token),
		}),
	};
}

/**
 * The canonical identity a profile entry claims, minted from the morphology
 * the shipped compact dictionary actually produces for a `副詞` token: slots
 * 0-1 carry the class, every other slot is `"*"`, there is no reading, and the
 * token is known.
 *
 * A token that deviates — a restored reading, a base form a future dictionary
 * build kept — mints a different key and therefore simply misses the profile.
 * That is the intended failure: the profile is reviewed data about entries of
 * *this* build, so a different build must not inherit its capability silently.
 * Restoring those slots is a `to-optional` data version decision.
 */
export function adverbProfileIdentityKey(
	surface: string,
	adverbClass: AdverbClass,
): string {
	return vocabularyCandidateId({
		surface: surface.normalize("NFC"),
		pos: ADVERB_POS,
		detail1: adverbClass,
		detail2: UNSET,
		detail3: UNSET,
		conjugationType: UNSET,
		conjugationForm: UNSET,
		baseForm: UNSET,
		isUnknown: false,
	});
}

/**
 * Whether a candidate surface already ends in `と`.
 *
 * A literal final-character test over the NFC surface, and deliberately
 * nothing more: it is the whole of the `PRE-RELEASE-AUTO-POS-POLICY1` §8.4
 * guard against `そっとと` / `意外とと`, and is not a general statement about
 * Japanese grammar. 404 of the 2,991 adverb surfaces end in `と`.
 */
export function adverbSurfaceEndsWithTo(surface: string): boolean {
	return surface.normalize("NFC").endsWith("と");
}
