import type { ManualDiagnosticReason, ManualSlotDiagnostic } from "../analysis/displaySlots";
import { EN_MESSAGES, ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";

/**
 * PRE-RELEASE-MANUAL-DIAGNOSTICS1: the only place a Manual Morph rejection
 * becomes a sentence.
 *
 * Every string here is fixed. None of them interpolates a Vault path, note
 * text, the selected surface, a reading, a raw connection key, a candidate
 * compatibility key, an exception message or a token dump; the one
 * interpolated value is a count of alternatives the reader could produce by
 * pressing Shuffle.
 *
 * The mapping is pure and total: it decides nothing about eligibility,
 * candidates or provenance, and it re-derives no reason from a surface. A
 * diagnostic whose reason it does not recognise falls back to the
 * "diagnostics are unavailable" sentence — never to an available slot.
 */

export const MANUAL_DIAGNOSTIC_ONE_ALTERNATIVE = EN_MESSAGES.manual.oneAlternative;

/** LOCALE1: in the current interface language. */
export function manualDiagnosticAlternativesMessage(count: number): string {
	return count === 1 ? ui().manual.oneAlternative : ui().manual.alternatives(count);
}

/**
 * The reader-facing meaning of each core rejection, in English; the view shows
 * it in the current language (LOCALE1). The key set is exhaustive
 * over `ManualDiagnosticReason`, which `assertDiagnosticReason` in
 * `manualDisplay.ts` ties to the core's own `ManualMorphRejection`, so a new
 * core reason fails the typecheck in both places rather than losing its
 * sentence here.
 */
export const MANUAL_DIAGNOSTIC_MESSAGES: Readonly<Record<ManualDiagnosticReason, string>> =
	Object.freeze({
		"unsupported-adverb-class": "Manual Shuffle is unavailable: this adverb class is not supported.",
		"missing-surface": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"no-head": "Manual Shuffle is unavailable: no supported modifier head was observed.",
		"unsupported-head": "Manual Shuffle is unavailable: this modifier head is not supported.",
		"polarity-undetermined": "Manual Shuffle is unavailable: the predicate polarity could not be verified.",
		"scan-limit-reached": "Manual Shuffle is unavailable: the supported modifier context is incomplete.",
		"boundary-crossed": "Manual Shuffle is unavailable: the modifier context crosses a protected boundary.",
		"no-observation": "Manual Shuffle is unavailable: no compatible Source observation was found.",
		"candidate-identity-mismatch": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"head-class-mismatch": "Manual Shuffle is unavailable: the modifier head classes differ.",
		"polarity-mismatch": "Manual Shuffle is unavailable: the predicate polarities differ.",
		"bridge-not-capable": "Manual Shuffle is unavailable: the candidate does not support this bridge.",
		"duplicate-to-bridge": "Manual Shuffle is unavailable: the bridge would be duplicated.",
		"invalid-input": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"invalid-vocabulary": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"invalid-authority": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"invalid-candidate": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"invalid-slot": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"invalid-evaluation": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"invalid-ticket": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"released": "Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
		"busy": "Manual Shuffle is unavailable while another operation is pending.",
		"revision-overflow": "Manual Shuffle diagnostics are unavailable. Reopen the Target and try again.",
		"unknown-token":
			"Manual Shuffle is unavailable: this token could not be classified reliably.",
		"unsupported-part-of-speech":
			"Manual Shuffle is unavailable: this part of speech is not supported.",
		"missing-field":
			"Manual Shuffle is unavailable: the morphological information is incomplete.",
		"unsupported-conjugation-type":
			"Manual Shuffle is unavailable: this conjugation type is not supported.",
		"unsupported-conjugation-form":
			"Manual Shuffle is unavailable: this word form is not supported.",
		"unsupported-connection":
			"Manual Shuffle is unavailable: this grammatical connection is not supported.",
		"no-candidate":
			"Manual Shuffle is unavailable: no compatible alternative was found in the active Vocabulary.",
		"only-current-surface":
			"Manual Shuffle is unavailable: the active Vocabulary contains only the currently displayed form.",
		"invalid-evidence":
			"Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.",
	});

/** Used when a diagnostic arrives without a reason this build can name. */
export const MANUAL_DIAGNOSTIC_UNKNOWN_REASON_MESSAGE =
	MANUAL_DIAGNOSTIC_MESSAGES["invalid-evidence"];

export type ManualDiagnosticView = {
	readonly message: string;
	/** Drives the Shuffle control as well, so words and controls cannot disagree. */
	readonly available: boolean;
};

/**
 * One exact-token selection becomes one sentence, or nothing at all when there
 * is no such selection. Availability is never taken from `status` alone: a
 * count of zero is unavailable whatever the status claims.
 */
export function toManualDiagnosticView(
	diagnostic: ManualSlotDiagnostic | null,
): ManualDiagnosticView | null {
	if (!diagnostic) {
		return null;
	}
	if (diagnostic.status === "available" && diagnostic.alternativeSurfaceCount > 0) {
		return {
			message: manualDiagnosticAlternativesMessage(diagnostic.alternativeSurfaceCount),
			available: true,
		};
	}
	const reason = diagnostic.reason;
	const known =
		reason !== null &&
		Object.prototype.hasOwnProperty.call(MANUAL_DIAGNOSTIC_MESSAGES, reason);
	return {
		message: localize(known
			? MANUAL_DIAGNOSTIC_MESSAGES[reason]
			: MANUAL_DIAGNOSTIC_UNKNOWN_REASON_MESSAGE),
		available: false,
	};
}
