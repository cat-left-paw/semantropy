import { freezeAnalysis } from "../analysis/rubyVocabulary";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { classifyAdverbCandidate, type AdverbFamilyRejection } from "../adverb/adverbFamily";
import { isBridgeToken, type AdverbBridge } from "../adverb/adverbObservation";

/**
 * `PRE-RELEASE-MAX-CORE1`: the Target reading High / MAX need, and nothing more.
 * Production-disconnected.
 *
 * Semantropy Level Policy 1 §4.4 drops head class, polarity and bridge
 * capability at High / MAX, so those profiles must not depend on whether
 * `observeAdverbSlot()` can decide a head or a polarity. What they still need
 * is that the Target is a `regular-adverb` family member and what immediately
 * follows it: the Target's own tokens are kept, and the duplicate-`と` guard
 * must still stand. Strict keeps the full observation; this does not replace it.
 *
 * Nothing past the one following token is read. `followedByTo` is the guard's
 * input: the following token's surface is exactly `と`. That covers the 副詞化
 * bridge and the quotative `と` (`ゆっくりと言った`), which head / polarity no
 * longer screen out at High / MAX, and nothing else — `とても` is a different
 * word, so `意外ととても美しい` stays available (independent re-review 2).
 */
export type AdverbBridgeReading =
	| { readonly supported: true; readonly bridge: AdverbBridge; readonly followedByTo: boolean }
	| { readonly supported: false; readonly reason: AdverbFamilyRejection };

export function readAdverbBridge(token: JapaneseToken, next: JapaneseToken | null): AdverbBridgeReading {
	const family = classifyAdverbCandidate(token);
	if (!family.supported) return { supported: false, reason: family.reason };
	return freezeAnalysis({
		supported: true,
		bridge: next !== null && isBridgeToken(next) ? "to" : "none",
		followedByTo: next !== null && next.surface.normalize("NFC") === "と",
	});
}
