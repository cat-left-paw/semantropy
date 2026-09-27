import type { CollectManualOverrideRecord } from "../collect/collectProvenance";

export type LogicalCollectRange = {
	readonly start: number;
	readonly end: number;
};

export function logicalRangesOverlap(
	left: LogicalCollectRange,
	right: LogicalCollectRange,
): boolean {
	return left.start < right.end && right.start < left.end;
}

/**
 * Manual overrides that intersect a logical selection.
 *
 * Overlap is decided from token identity and display ranges, never by
 * searching for a surface in the selected string. A partially selected Manual
 * word still counts. Slot order is the caller's materialized plan order.
 */
export function collectManualOverridesForRange(input: {
	readonly range: LogicalCollectRange;
	readonly slotOrder: readonly string[];
	readonly slotRanges: ReadonlyMap<string, LogicalCollectRange>;
	readonly overrides: ReadonlyMap<
		string,
		{ readonly kind: CollectManualOverrideRecord["kind"]; readonly localRevision: number }
	>;
}): readonly CollectManualOverrideRecord[] {
	const records: CollectManualOverrideRecord[] = [];
	for (const tokenId of input.slotOrder) {
		const override = input.overrides.get(tokenId);
		const slotRange = input.slotRanges.get(tokenId);
		if (!override || !slotRange) {
			continue;
		}
		if (!logicalRangesOverlap(input.range, slotRange)) {
			continue;
		}
		records.push({
			tokenId,
			kind: override.kind,
			localRevision: override.localRevision,
		});
	}
	return records;
}
