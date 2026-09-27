import type { VocabularySnapshot } from "../vocabulary/vocabularySnapshot";
import {
	copyVocabularyProvenance,
	type CollectVocabularyProvenance,
} from "../collect/collectProvenance";

/**
 * Collect provenance taken from the Snapshot that produced the displayed
 * result. Canonical Source order is the Snapshot's own `sources` order. The
 * picker draft and current file bytes are not consulted.
 */
export function collectVocabularyFromSnapshot(
	snapshot: VocabularySnapshot,
): CollectVocabularyProvenance {
	return copyVocabularyProvenance({
		sources: snapshot.sources.map((source) => ({
			path: source.path,
			contentHash: source.contentHash,
		})),
		fingerprint: snapshot.fingerprint,
		drawMode: snapshot.drawMode,
	});
}
