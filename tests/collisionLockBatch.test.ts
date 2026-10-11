import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "../src/collision/collisionCore";
import { collisionFragmentFromBatch, type CollisionBatch } from "../src/collision/collisionBatch";
import { batchController, commit, patterns, privateMaterial, token, unwrap, vocabulary } from "./collisionBatchFixtures";

/*
 * COLLISION-LOCK1, the row layer. Regenerating a row with some of its words kept is one more way to begin the same
 * regeneration: the lifecycle, the replacement, the other rows and what Collect receives are the ones every row
 * regeneration has. These tests pin what is new (the entrance and its refusals) and that the rest did not move.
 */

afterEach(() => vi.restoreAllMocks());
const STANDARD = patterns();

async function ready(words?: string[], recipe = "named", count: 10 | 20 | 50 = 10) {
	const source = await vocabulary(words?.map((word) => token(word)));
	const controller = batchController();
	unwrap(commit(controller, unwrap(controller.beginGenerate({ vocabulary: source.owner, patternSet: STANDARD, count, defaultPattern: { kind: "fixed", recipeId: recipe }, operationMaterial: privateMaterial(2) }))));
	return { controller, batch: controller.read().batch!, source };
}
const lockedBegin = (controller: ReturnType<typeof batchController>, rowSlotId: string, lockedSlotIds: readonly string[], index = 4) =>
	controller.beginRegenerateWithLocks({ rowSlotId, lockedSlotIds, operationMaterial: privateMaterial(index) });
function assertFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	expect(Object.isFrozen(value)).toBe(true);
	Object.values(value).forEach((child) => assertFrozen(child, seen));
}
const collect = (batch: CollisionBatch, rowSlotId: string) => unwrap(collisionFragmentFromBatch({ batch, rowSlotId }));

describe("regenerating a row with some of its words kept", () => {
	it("asks the core for the row's own result with the kept names, and commits only that row, as every row regeneration does", async () => {
		const { controller, batch } = await ready();
		const row = batch.rows[3]!;
		const plain = vi.spyOn(core, "generateCollisionResults");
		const spy = vi.spyOn(core, "generateLockedCollisionResult");
		const ticket = unwrap(lockedBegin(controller, row.rowSlotId, ["n1"]));
		expect(ticket.kind).toBe("regenerate");
		expect(controller.read().rowDrafts[3]).toMatchObject({ pending: true });
		const done = unwrap(controller.prepare(ticket));
		expect(controller.read().batch).toBe(batch);
		expect(plain).not.toHaveBeenCalled();
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0]![0]).toMatchObject({ pool: batch.pool, patternSet: batch.patternSet, drawMode: batch.drawMode, locked: ["n1"],
			original: { recipeId: row.committed.recipeId, segments: row.committed.segments }, avoid: { texts: batch.rows.map((entry) => entry.committed.text) } });
		const next = unwrap(controller.complete(ticket, done)).batch!;
		const kept = row.committed.segments[0]!.text, joined = row.committed.segments[1]!.text;
		expect(next.rows[3]!.rowSlotId).toBe(row.rowSlotId);
		expect(next.rows[3]!.committed.text.startsWith(`${kept}${joined}`)).toBe(true);
		expect(next.rows[3]!.committed.text).not.toBe(row.committed.text);
		expect(next.rows[3]!.committed).toMatchObject({ recipeId: "named", generationRevision: 2 });
		expect(next.rows[3]!.committed.rowId).not.toBe(row.committed.rowId);
		expect(next.batchId).toBe(batch.batchId);
		next.rows.forEach((entry, index) => { if (index !== 3) expect(entry).toBe(batch.rows[index]); });
		expect(controller.read().rowDrafts[3]).toMatchObject({ pending: false, lastError: null });
		assertFrozen(controller.read());
		// What is committed is a row like any other: it can be kept again by the next regeneration.
		unwrap(commit(controller, unwrap(lockedBegin(controller, row.rowSlotId, ["n1"], 6))));
		const again = controller.read().batch!.rows[3]!;
		expect(again.committed.generationRevision).toBe(3);
		expect(again.committed.segments[0]!.text).toBe(kept);
	});

	it("keeps the eight values Collect receives, from the new text, and the Copy text is the text", async () => {
		const { controller, batch } = await ready();
		const slot = batch.rows[0]!.rowSlotId;
		const before = collect(batch, slot);
		unwrap(commit(controller, unwrap(lockedBegin(controller, slot, ["n1"]))));
		const next = controller.read().batch!;
		const input = collect(next, slot);
		expect(Object.keys(input).sort()).toEqual(["algorithmVersion", "batchId", "patternId", "patternSetVersion", "rowId", "text", "type", "vocabulary"]);
		expect(input).toMatchObject({ type: "collision", text: next.rows[0]!.committed.text, patternId: "named", batchId: batch.batchId, rowId: next.rows[0]!.committed.rowId });
		expect(input.vocabulary).toBe(before.vocabulary);
		expect(input.text).not.toBe(before.text);
	});

	it("leaves the previous batch when the core cannot answer: every alternative is in the batch already, or the row is refused", async () => {
		// Two nouns: keeping n1 leaves one alternative, which is the row's own text.
		const { controller, batch } = await ready(["猫", "犬"], "named", 10);
		expect(batch.rows).toHaveLength(2);
		const ticket = unwrap(lockedBegin(controller, batch.rows[0]!.rowSlotId, ["n1"]));
		expect(commit(controller, ticket)).toEqual({ ok: false, reason: "duplicate-exhausted" });
		expect(controller.read().batch).toBe(batch);
		expect(controller.read().rowDrafts[0]).toMatchObject({ pending: false, lastError: "duplicate-exhausted" });
		const refused = unwrap(lockedBegin(controller, batch.rows[0]!.rowSlotId, ["n1"], 7));
		vi.spyOn(core, "generateLockedCollisionResult").mockReturnValue({ ok: false, reason: "invalid-request" });
		expect(commit(controller, refused)).toEqual({ ok: false, reason: "invalid-request" });
		expect(controller.read().batch).toBe(batch);
	});

	it("rejects a concurrent row completion that now duplicates a committed row", async () => {
		const { controller, batch } = await ready();
		const real = core.generateLockedCollisionResult;
		let result: core.CollisionGenerationResult | null = null;
		vi.spyOn(core, "generateLockedCollisionResult").mockImplementation((input) => result ?? (result = real(input)));
		const a = unwrap(lockedBegin(controller, batch.rows[0]!.rowSlotId, ["n1"], 5));
		const b = unwrap(lockedBegin(controller, batch.rows[1]!.rowSlotId, ["n1"], 6));
		const ca = unwrap(controller.prepare(a));
		const cb = unwrap(controller.prepare(b));
		unwrap(controller.complete(a, ca));
		const current = controller.read().batch;
		expect(controller.complete(b, cb)).toEqual({ ok: false, reason: "duplicate-exhausted" });
		expect(controller.read().batch).toBe(current);
		expect(current!.rows[1]).toBe(batch.rows[1]);
	});

	it.each(["generate", "regenerate"] as const)("is cancelled and superseded like any regeneration: a %s retires it, and cancel keeps the batch", async (kind) => {
		const { controller, batch, source } = await ready();
		const slot = batch.rows[0]!.rowSlotId;
		const cancelled = unwrap(lockedBegin(controller, slot, ["n1"]));
		const done = unwrap(controller.prepare(cancelled));
		unwrap(controller.cancel(cancelled));
		expect(controller.read().batch).toBe(batch);
		expect(controller.read().rowDrafts[0]).toMatchObject({ pending: false, lastError: "cancelled" });
		expect(controller.complete(cancelled, done)).toEqual({ ok: false, reason: "invalid-ticket" });
		const old = unwrap(lockedBegin(controller, slot, ["n1"], 5));
		const late = unwrap(controller.prepare(old));
		const latest = kind === "generate"
			? unwrap(controller.beginGenerate({ vocabulary: source.owner, patternSet: STANDARD, count: 10, defaultPattern: { kind: "random" }, operationMaterial: privateMaterial(8) }))
			: unwrap(lockedBegin(controller, slot, ["n1"], 8));
		expect(controller.complete(old, late)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(controller.read().batch).toBe(batch);
		unwrap(commit(controller, latest));
		expect(controller.read().batch).not.toBe(batch);
		if (kind === "regenerate") expect(controller.read().batch!.rows[0]!.committed.generationRevision).toBe(2);
	});

	it("refuses a row, a name or a list the batch cannot honour, without starting anything", async () => {
		const { controller, batch } = await ready();
		const slot = batch.rows[0]!.rowSlotId;
		const before = controller.read();
		const refuse = (result: ReturnType<typeof lockedBegin>, reason: string) => { expect(result).toEqual({ ok: false, reason }); expect(controller.read()).toBe(before); };
		refuse(lockedBegin(controller, "no-such-row", ["n1"]), "unknown-row");
		refuse(lockedBegin(controller, slot, []), "invalid-request");
		refuse(lockedBegin(controller, slot, ["n9"]), "invalid-request");
		// The Connector-like and fixed-text parts of a row can never be kept; "named" has a literal l1.
		refuse(lockedBegin(controller, slot, ["l1"]), "invalid-request");
		refuse(lockedBegin(controller, slot, ["n1", "n1"]), "invalid-request");
		refuse(lockedBegin(controller, slot, ["n1", "n2"]), "invalid-request");
		refuse(lockedBegin(controller, slot, "n1" as never), "invalid-request");
		refuse(lockedBegin(controller, slot, [1 as never]), "invalid-request");
		refuse(controller.beginRegenerateWithLocks({ rowSlotId: slot, lockedSlotIds: ["n1"], operationMaterial: "short" }), "invalid-request");
		refuse(controller.beginRegenerateWithLocks({ rowSlotId: slot, lockedSlotIds: ["n1"] } as never), "invalid-request");
		refuse(controller.beginRegenerateWithLocks({ rowSlotId: slot, lockedSlotIds: ["n1"], operationMaterial: privateMaterial(4), extra: 1 } as never), "invalid-request");
		const accessor = { rowSlotId: slot, operationMaterial: privateMaterial(4) };
		Object.defineProperty(accessor, "lockedSlotIds", { get: () => ["n1"], enumerable: true });
		refuse(controller.beginRegenerateWithLocks(accessor as never), "invalid-request");
	});

	it("refuses a name given twice when the row has parts enough that the count alone would not refuse it", async () => {
		// triple-right has three nouns at least, so two names are fewer than the parts that can be kept: only the repeat is wrong.
		const { controller, batch } = await ready(undefined, "triple-right");
		const slot = batch.rows[0]!.rowSlotId;
		const lockable = batch.rows[0]!.committed.segments.filter((segment) => core.COLLISION_LOCKABLE_SEGMENT_KINDS.some((kind) => kind === segment.kind));
		expect(lockable.length).toBeGreaterThanOrEqual(3);
		const before = controller.read();
		expect(lockedBegin(controller, slot, ["n1", "n1"])).toEqual({ ok: false, reason: "invalid-request" });
		expect(controller.read()).toBe(before);
		unwrap(lockedBegin(controller, slot, ["n1", "n2"]));
	});

	it("keeps the names it was given as they were at the begin, whatever the caller does with its list afterwards", async () => {
		const { controller, batch } = await ready();
		const row = batch.rows[2]!;
		const names = ["n1"];
		const spy = vi.spyOn(core, "generateLockedCollisionResult");
		const ticket = unwrap(lockedBegin(controller, row.rowSlotId, names));
		names[0] = "n2"; names.push("n3");
		const done = unwrap(controller.prepare(ticket));
		expect(spy.mock.calls[0]![0].locked).toEqual(["n1"]);
		const next = unwrap(controller.complete(ticket, done)).batch!;
		expect(next.rows[2]!.committed.text.startsWith(row.committed.segments[0]!.text)).toBe(true);
	});

	it("refuses to begin while a Generate is pending, and a row whose draft selector is another pattern", async () => {
		const { controller, batch, source } = await ready();
		const slot = batch.rows[0]!.rowSlotId;
		unwrap(controller.select({ rowSlotId: slot, selector: { kind: "fixed", recipeId: "purpose" } }));
		const afterSelect = controller.read();
		expect(lockedBegin(controller, slot, ["n1"])).toEqual({ ok: false, reason: "invalid-request" });
		expect(controller.read()).toBe(afterSelect);
		unwrap(controller.select({ rowSlotId: slot, selector: { kind: "same" } }));
		// A selector for the row's own recipe is no obstacle.
		unwrap(controller.select({ rowSlotId: slot, selector: { kind: "fixed", recipeId: "named" } }));
		unwrap(commit(controller, unwrap(lockedBegin(controller, slot, ["n1"]))));
		unwrap(controller.beginGenerate({ vocabulary: source.owner, patternSet: STANDARD, count: 10, defaultPattern: { kind: "random" }, operationMaterial: privateMaterial(9) }));
		expect(lockedBegin(controller, slot, ["n1"], 10)).toEqual({ ok: false, reason: "busy" });
	});

	it("does not change the whole-row regeneration: it still redraws everything through the generation it always used", async () => {
		const { controller, batch } = await ready();
		const plain = vi.spyOn(core, "generateCollisionResults");
		const locked = vi.spyOn(core, "generateLockedCollisionResult");
		unwrap(commit(controller, unwrap(controller.beginRegenerate({ rowSlotId: batch.rows[0]!.rowSlotId, operationMaterial: privateMaterial(4) }))));
		expect(plain).toHaveBeenCalledTimes(1);
		expect(plain.mock.calls[0]![0]).toMatchObject({ count: 1, request: { kind: "fixed", recipeId: "named" } });
		expect(locked).not.toHaveBeenCalled();
		// A name list is not part of that entrance.
		expect(controller.beginRegenerate({ rowSlotId: batch.rows[0]!.rowSlotId, lockedSlotIds: ["n1"], operationMaterial: privateMaterial(5) } as never)).toEqual({ ok: false, reason: "invalid-request" });
	});

	it("keeps the captured vocabulary: a stale source still regenerates with the words it was made from", async () => {
		const { controller, batch } = await ready();
		await vocabulary([token("別世界")]);
		const spy = vi.spyOn(core, "generateLockedCollisionResult");
		unwrap(commit(controller, unwrap(lockedBegin(controller, batch.rows[0]!.rowSlotId, ["n1"]))));
		const next = controller.read().batch!;
		expect(next.pool).toBe(batch.pool);
		expect(next.vocabularyOwner).toBe(batch.vocabularyOwner);
		expect(spy.mock.calls[0]![0].pool).toBe(batch.pool);
		expect(next.vocabulary).toBe(batch.vocabulary);
	});
});
