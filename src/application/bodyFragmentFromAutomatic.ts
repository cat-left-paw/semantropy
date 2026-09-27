import { bodyFragmentFromReadySession, type ReadySessionState } from "./bodyFragmentFromReady";
import type { BodyFragmentInputV4 } from "../collect/v4/CollectedFragmentV4";
import type { CollectManualOverrideRecord } from "../collect/collectProvenance";
import { automaticPartsOfSpeechFromOptions } from "../collect/v3/automaticPartsOfSpeech";
import type { AutomaticPosOptions } from "../transform/automaticPosOptions";
import type { MaxResult } from "../transform/maxCore";

/** The View supplies its committed generation, including when its Source is now stale. */
export function bodyFragmentFromAutomatic(state: ReadySessionState, text: string, result: MaxResult,
	options: AutomaticPosOptions, manualOverrides: readonly CollectManualOverrideRecord[]): BodyFragmentInputV4 {
	const parts = automaticPartsOfSpeechFromOptions(options);
	if (!parts.ok || state.algorithmVersion !== result.bodyAlgorithmVersion || state.bodySemantropy !== result.bodySemantropy ||
		state.snapshot.sourcePath !== result.targetSource.path || state.snapshot.contentHash !== result.targetSource.contentHash)
		throw Error("Invalid committed body.");
	return Object.freeze({ ...bodyFragmentFromReadySession(state, text, {
		vocabulary: { sources: result.vocabularySources, fingerprint: result.vocabularyFingerprint, drawMode: result.drawMode }, manualOverrides,
	}), metadataVersion: 4, automaticPartsOfSpeech: parts.value });
}
