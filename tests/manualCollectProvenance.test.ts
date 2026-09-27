import { describe, expect, it } from "vitest";
import { collectManualOverridesForRange } from "../src/application/manualCollectProvenance";

describe("collectManualOverridesForRange", () => {
	const overrides = new Map([
		["a", { kind: "replacement" as const, localRevision: 2 }],
		["b", { kind: "restore-original" as const, localRevision: 0 }],
		["c", { kind: "replacement" as const, localRevision: 4 }],
	]);
	const slotRanges = new Map([
		["a", { start: 0, end: 2 }],
		["b", { start: 2, end: 4 }],
		["c", { start: 4, end: 7 }],
	]);

	it("includes only overrides that intersect the logical range", () => {
		expect(
			collectManualOverridesForRange({
				range: { start: 2, end: 4 },
				slotOrder: ["a", "b", "c"],
				slotRanges,
				overrides,
			}),
		).toEqual([{ tokenId: "b", kind: "restore-original", localRevision: 0 }]);
	});

	it("treats a partial Manual word as related", () => {
		expect(
			collectManualOverridesForRange({
				range: { start: 1, end: 2 },
				slotOrder: ["a", "b", "c"],
				slotRanges,
				overrides,
			}),
		).toEqual([{ tokenId: "a", kind: "replacement", localRevision: 2 }]);
	});

	it("keeps plan order and skips overrides outside the selection", () => {
		expect(
			collectManualOverridesForRange({
				range: { start: 0, end: 7 },
				slotOrder: ["c", "a", "b"],
				slotRanges,
				overrides,
			}),
		).toEqual([
			{ tokenId: "c", kind: "replacement", localRevision: 4 },
			{ tokenId: "a", kind: "replacement", localRevision: 2 },
			{ tokenId: "b", kind: "restore-original", localRevision: 0 },
		]);
		expect(
			collectManualOverridesForRange({
				range: { start: 4, end: 7 },
				slotOrder: ["a", "b", "c"],
				slotRanges,
				overrides,
			}).map((record) => record.tokenId),
		).toEqual(["c"]);
	});
});
