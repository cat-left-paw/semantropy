import type { SourceSnapshot } from "./SourceSnapshot";

/**
 * Whether the displayed snapshot still matches the note it came from.
 *
 * `stale` is not an error: the snapshot, Seed, analysis and rendered body all
 * stay exactly as they are. Only an explicit Refresh replaces them.
 */
export type SourceFreshness = "fresh" | "stale";

export const STALE_SOURCE_MESSAGE =
	"Source changed. This view is based on an older snapshot. Use Refresh target.";

export type FreshnessCheckResult =
	| { status: "applied"; freshness: SourceFreshness }
	| { status: "ignored"; reason: FreshnessIgnoredReason };

export type FreshnessIgnoredReason =
	| "not-ready"
	| "superseded"
	| "snapshot-replaced"
	| "abandoned";

export type CheckSourceFreshnessInput = {
	/** Freshness generation issued when this check started. */
	generation: number;
	isCurrentGeneration: (generation: number) => boolean;
	/** The snapshot currently on screen, or null when nothing is ready. */
	getReadySnapshot: () => SourceSnapshot | null;
	readCurrentText: (sourcePath: string) => Promise<string>;
	hashText: (text: string) => Promise<string>;
	isAbandoned: () => boolean;
	/** Applies the verdict; the session rejects it if the snapshot moved on. */
	setFreshness: (
		snapshot: SourceSnapshot,
		freshness: SourceFreshness,
	) => boolean;
};

/**
 * Compares the note's current body against the snapshot's SHA-256 and records
 * the verdict. It never reads, tokenizes or renders anything else: a changed
 * note only earns a label.
 *
 * A body that cannot be read at all — renamed, deleted, or otherwise
 * unresolvable — is stale, never fresh. Guessing "unchanged" would hide a
 * change the user can no longer see.
 */
export async function checkSourceFreshness(
	input: CheckSourceFreshnessInput,
): Promise<FreshnessCheckResult> {
	const snapshot = input.getReadySnapshot();
	if (!snapshot) {
		return { status: "ignored", reason: "not-ready" };
	}

	let freshness: SourceFreshness;
	try {
		const text = await input.readCurrentText(snapshot.sourcePath);
		const abandonedDuringRead = abandonReason(input, snapshot);
		if (abandonedDuringRead) {
			return { status: "ignored", reason: abandonedDuringRead };
		}
		const contentHash = await input.hashText(text);
		const abandonedDuringHash = abandonReason(input, snapshot);
		if (abandonedDuringHash) {
			return { status: "ignored", reason: abandonedDuringHash };
		}
		freshness = contentHash === snapshot.contentHash ? "fresh" : "stale";
	} catch {
		freshness = "stale";
	}

	const abandoned = abandonReason(input, snapshot);
	if (abandoned) {
		return { status: "ignored", reason: abandoned };
	}
	if (!input.setFreshness(snapshot, freshness)) {
		return { status: "ignored", reason: "snapshot-replaced" };
	}
	return { status: "applied", freshness };
}

function abandonReason(
	input: CheckSourceFreshnessInput,
	snapshot: SourceSnapshot,
): FreshnessIgnoredReason | null {
	if (input.isAbandoned()) {
		return "abandoned";
	}
	if (!input.isCurrentGeneration(input.generation)) {
		return "superseded";
	}
	if (input.getReadySnapshot() !== snapshot) {
		return "snapshot-replaced";
	}
	return null;
}
