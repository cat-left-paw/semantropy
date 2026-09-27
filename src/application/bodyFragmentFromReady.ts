import type { BodyFragmentInput } from "../collect/CollectedFragment";
import type { CollectManualOverrideRecord } from "../collect/collectProvenance";
import { copyPathIdentity, copyVocabularyProvenance } from "../collect/collectProvenance";
import type { CollectVocabularyProvenance } from "../collect/collectProvenance";
import { MANUAL_ALGORITHM_VERSION } from "../analysis/manualDisplay";
import type { SemantropySessionState } from "./SemantropySession";

export type ReadySessionState = Extract<
	SemantropySessionState,
	{ status: "ready" }
>;

export type BodyCollectProvenance = {
	readonly vocabulary: CollectVocabularyProvenance;
	readonly manualOverrides?: readonly CollectManualOverrideRecord[];
};

/**
 * Builds the Collect input for a fragment taken from the displayed body.
 *
 * The text is whatever the user selected. Target identity comes from the
 * ready session as it stands — including a stale one, which still has the
 * snapshot and Semantropy value that produced the body on screen. Vocabulary
 * provenance is the Snapshot that produced that display, not a picker draft.
 *
 * Tokens, the vocabulary pool, freshness, the source file name, the original
 * note body and internal generation state are not fields of this input, so
 * they cannot be stored.
 */
export function bodyFragmentFromReadySession(
	state: ReadySessionState,
	text: string,
	provenance: BodyCollectProvenance,
): BodyFragmentInput {
	const target = copyPathIdentity({
		path: state.snapshot.sourcePath,
		contentHash: state.snapshot.contentHash,
	});
	const vocabulary = copyVocabularyProvenance(provenance.vocabulary);
	const manualOverrides = provenance.manualOverrides ?? [];
	const shared = {
		type: "body" as const,
		text,
		target,
		vocabulary,
		bodySemantropy: state.bodySemantropy,
		algorithmVersion: state.algorithmVersion,
	};
	if (manualOverrides.length === 0) {
		return {
			...shared,
			hasManualEdits: false,
		};
	}
	return {
		...shared,
		hasManualEdits: true,
		manualAlgorithmVersion: MANUAL_ALGORITHM_VERSION,
		manualOverrides: manualOverrides.map((override) => ({
			tokenId: override.tokenId,
			kind: override.kind,
			localRevision: override.localRevision,
		})),
	};
}
