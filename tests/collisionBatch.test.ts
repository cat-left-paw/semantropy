import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "../src/collision/collisionCore";
import * as hashing from "../src/vocabulary/sha256";
import { freezeAnalysis } from "../src/analysis/rubyVocabulary";
import { collectVocabularyFromSnapshot } from "../src/application/collectVocabulary";
import { validateFragmentInput } from "../src/collect/CollectedFragment";
import { buildAuthenticatedCollisionLexemePool } from "../src/collision/collisionVocabulary";
import { advanceCollisionRevision, collisionFragmentFromBatch, createCollisionBatchController,
	type CollisionBatch, type CollisionBatchGenerateInput, type CollisionOperationCompletion, type CollisionOperationTicket } from "../src/collision/collisionBatch";
import { batchController, commit, nounRecipe, patterns, privateMaterial, token, unwrap, vocabulary } from "./collisionBatchFixtures";

afterEach(() => vi.restoreAllMocks());
const STANDARD = patterns();
const random = { kind: "random" } as const;
async function ready(patternSet = STANDARD, words?: string[]) {
	const source = await vocabulary(words?.map((word) => token(word)));
	const controller = batchController();
	const input: CollisionBatchGenerateInput = { vocabulary: source.owner, patternSet, count: 10, defaultPattern: random, operationMaterial: privateMaterial(2) };
	const ticket = unwrap(controller.beginGenerate(input));
	unwrap(commit(controller, ticket));
	const batch = controller.read().batch!;
	return { controller, input, batch, source, slot: batch.rows[0]!.rowSlotId };
}
function assertFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	expect(Object.isFrozen(value)).toBe(true);
	Object.values(value).forEach((child) => assertFrozen(child, seen));
}
function collect(batch: CollisionBatch, rowSlotId = batch.rows[0]!.rowSlotId) {
	return unwrap(collisionFragmentFromBatch({ batch, rowSlotId }));
}

describe("Collision batch atomic generation", () => {
	it.each([10, 20, 50] as const)("commits all %i Random rows together, through one core call", async (count) => {
		const { owner } = await vocabulary();
		const controller = batchController();
		const spy = vi.spyOn(core, "generateCollisionResults");
		const ticket = unwrap(controller.beginGenerate({ vocabulary: owner, patternSet: STANDARD, count, defaultPattern: random, operationMaterial: privateMaterial(3) }));
		expect(controller.read().batch).toBeNull();
		const completion = unwrap(controller.prepare(ticket));
		expect(controller.read().batch).toBeNull();
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0]![0].count).toBe(count);
		const state = unwrap(controller.complete(ticket, completion));
		const batch = state.batch!;
		expect(batch.rows).toHaveLength(count);
		expect(batch.actualCount).toBe(count);
		expect(batch.status).toBe("complete");
		expect(batch.shortfallReason).toBeNull();
		expect(batch.vocabularyOwner).toBe(owner);
		expect(batch.patternSet).toBe(STANDARD);
		expect(batch.vocabulary).toEqual(collectVocabularyFromSnapshot(owner.snapshot));
		const generated = spy.mock.results[0]!.value as core.CollisionGenerationResult;
		if (!generated.ok) throw new Error(generated.reason);
		expect(batch.rows.map((row) => row.committed.recipeId)).toEqual(generated.draft.results.map((row) => row.recipeId));
		expect(new Set([batch.batchId, ...batch.rows.flatMap((row) => [row.rowSlotId, row.committed.rowId])]).size).toBe(1 + 2 * count);
		expect(batch.rows.every((row) => row.committed.generationRevision === 1)).toBe(true);
		assertFrozen(state);
	});
	it("replaces a previous batch only at completion and mints new batch/slot/result identities", async () => {
		const { controller, input, batch } = await ready();
		const ticket = unwrap(controller.beginGenerate(input));
		const completion = unwrap(controller.prepare(ticket));
		expect(controller.read().batch).toBe(batch);
		unwrap(controller.complete(ticket, completion));
		const next = controller.read().batch!;
		expect(next.batchId).not.toBe(batch.batchId);
		expect(next.rows[0]!.rowSlotId).not.toBe(batch.rows[0]!.rowSlotId);
		expect(next.rows[0]!.committed.rowId).not.toBe(batch.rows[0]!.committed.rowId);
		expect(next.rows[0]!.committed.generationRevision).toBe(1);
	});
	it("commits a nonzero partial batch atomically with fixed shortfall and limited information", async () => {
		const recipe = nounRecipe();
		const pair = { ...recipe, parts: [...recipe.parts, { kind: "noun", slotId: "n2", optional: false }] };
		const { controller, input, batch } = await ready();
		const { owner } = await vocabulary([token("都市")]);
		const ticket = unwrap(controller.beginGenerate({ ...input, vocabulary: owner, patternSet: patterns([pair]), count: 50 }));
		const done = unwrap(controller.prepare(ticket));
		expect(controller.read().batch).toBe(batch);
		const next = unwrap(controller.complete(ticket, done)).batch!;
		expect(next).toMatchObject({ requestedCount: 50, actualCount: 1, status: "partial", shortfallReason: "duplicate-exhausted", limited: true });
		expect(next.rows[0]!.committed).toMatchObject({ text: "都市都市", limited: true, limitedReason: "noun-repeated" });
	});
	it("does not commit zero-result insufficient", async () => {
		const { controller, input, batch } = await ready();
		const { owner } = await vocabulary([token("。", { pos: "記号", detail1: "句点" })]);
		const ticket = unwrap(controller.beginGenerate({ ...input, vocabulary: owner }));
		expect(commit(controller, ticket)).toEqual({ ok: false, reason: "no-noun" });
		expect(controller.read().batch).toBe(batch);
		expect(controller.read().generation).toEqual({ pending: false, lastError: "no-noun" });
	});
	it("uses fixed Default pattern on every row", async () => {
		const { controller, input } = await ready();
		unwrap(commit(controller, unwrap(controller.beginGenerate({ ...input, defaultPattern: { kind: "fixed", recipeId: "named" } }))));
		expect(controller.read().batch!.rows.every((row) => row.committed.recipeId === "named")).toBe(true);
	});
	it.each([
		["absent", "recipe-unknown"], ["disabled", "recipe-disabled"], ["hidden", "recipe-not-selectable"], ["predicate", "recipe-not-viable"],
	] as const)("never falls back from fixed %s", async (recipeId, reason) => {
		const { controller, input, batch } = await ready();
		const patternSet = patterns([nounRecipe(), nounRecipe("disabled", false, false), nounRecipe("hidden", false), {
			...nounRecipe("predicate"), parts: [...nounRecipe().parts, { kind: "predicate", slotId: "v", optional: false, profile: "regular-verb-basic" }],
		}]);
		const ticket = unwrap(controller.beginGenerate({ ...input, patternSet, defaultPattern: { kind: "fixed", recipeId } }));
		expect(commit(controller, ticket)).toEqual({ ok: false, reason });
		expect(controller.read().batch).toBe(batch);
	});
	it("preserves a previous commit on a core input refusal", async () => {
		const { controller, input, batch } = await ready();
		const ticket = unwrap(controller.beginGenerate(input));
		vi.spyOn(core, "generateCollisionResults").mockReturnValue({ ok: false, reason: "invalid-pool" });
		expect(commit(controller, ticket)).toEqual({ ok: false, reason: "invalid-pool" });
		expect(controller.read().batch).toBe(batch);
	});
});

describe("Collision row selector and captured regeneration", () => {
	it("rejects nonviable, disabled and unknown row selector drafts without changing state", async () => {
		const patternSet = patterns([nounRecipe(), nounRecipe("disabled", false, false), {
			...nounRecipe("predicate"), parts: [...nounRecipe().parts, { kind: "predicate", slotId: "v", optional: false, profile: "regular-verb-basic" }],
		}]);
		const { controller, slot } = await ready(patternSet);
		const before = controller.read();
		for (const [recipeId, reason] of [["absent", "recipe-unknown"], ["disabled", "recipe-disabled"], ["predicate", "recipe-not-viable"]]) {
			expect(controller.select({ rowSlotId: slot, selector: { kind: "fixed", recipeId: recipeId! } })).toEqual({ ok: false, reason });
			expect(controller.read()).toBe(before);
		}
	});
	it("changes only the selector draft, including Collect, then commits only its target row", async () => {
		const { controller, batch, slot } = await ready();
		const before = batch.rows.map((row) => collect(batch, row.rowSlotId));
		unwrap(controller.select({ rowSlotId: slot, selector: { kind: "fixed", recipeId: "named" } }));
		expect(controller.read().batch).toBe(batch);
		expect(collect(controller.read().batch!, slot)).toEqual(before[0]);
		expect(controller.read().rowDrafts[0]!.selector).toEqual({ kind: "fixed", recipeId: "named" });
		const spy = vi.spyOn(core, "generateCollisionResults");
		const ticket = unwrap(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(4) }));
		const done = unwrap(controller.prepare(ticket));
		expect(controller.read().batch).toBe(batch);
		expect(controller.read().rowDrafts[0]!.pending).toBe(true);
		expect(controller.read().rowDrafts.slice(1).every((draft) => !draft.pending)).toBe(true);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0]![0]).toMatchObject({ pool: batch.pool, patternSet: batch.patternSet, count: 1, request: { kind: "fixed", recipeId: "named" }, avoid: { texts: batch.rows.map((row) => row.committed.text), recentSignatures: [] } });
		const next = unwrap(controller.complete(ticket, done)).batch!;
		expect(next.batchId).toBe(batch.batchId);
		expect(next.rows[0]!.rowSlotId).toBe(slot);
		expect(next.rows[0]!.committed).toMatchObject({ generationRevision: 2, recipeId: "named" });
		expect(next.rows[0]!.committed.rowId).not.toBe(batch.rows[0]!.committed.rowId);
		expect(next.rows[0]!.committed.text).not.toBe(batch.rows[0]!.committed.text);
		for (let i = 1; i < batch.rows.length; i += 1) {
			expect(next.rows[i]).toBe(batch.rows[i]);
			expect(collect(next, next.rows[i]!.rowSlotId)).toEqual(before[i]);
		}
		expect(collect(next, slot)).toMatchObject({ patternId: "named", batchId: batch.batchId, rowId: next.rows[0]!.committed.rowId });
		assertFrozen(controller.read());
	});
	it("passes the preceding two structure signatures to CORE1", async () => {
		const { controller, batch } = await ready();
		const spy = vi.spyOn(core, "generateCollisionResults");
		const ticket = unwrap(controller.beginRegenerate({ rowSlotId: batch.rows[4]!.rowSlotId, operationMaterial: privateMaterial(7) }));
		unwrap(controller.prepare(ticket));
		expect(spy.mock.calls[0]![0].avoid!.recentSignatures).toEqual(batch.rows.slice(2, 4).map((row) => row.committed.structureSignature));
	});
	it("regenerates Random's hidden actual recipe through Same pattern but refuses explicit hidden selection", async () => {
		const patternSet = patterns([{ ...nounRecipe("hidden", false), parts: [{ kind: "noun", slotId: "n1", optional: false }, { kind: "noun", slotId: "n2", optional: false }] }]);
		const { controller, batch, slot } = await ready(patternSet);
		expect(controller.select({ rowSlotId: slot, selector: { kind: "fixed", recipeId: "hidden" } })).toEqual({ ok: false, reason: "recipe-not-selectable" });
		expect(controller.read().batch).toBe(batch);
		unwrap(commit(controller, unwrap(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(8) }))));
		expect(controller.read().batch!.rows[0]!.committed).toMatchObject({ recipeId: "hidden", generationRevision: 2 });
	});
	it("fails boundedly when every alternative is already in the batch", async () => {
		const { controller, batch, slot } = await ready(patterns([nounRecipe()]), ["都市"]);
		const ticket = unwrap(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(4) }));
		expect(commit(controller, ticket)).toEqual({ ok: false, reason: "duplicate-exhausted" });
		expect(controller.read().batch).toBe(batch);
		expect(controller.read().rowDrafts[0]).toMatchObject({ pending: false, lastError: "duplicate-exhausted" });
	});
	it("keeps captured owner, pool, patterns, Frequency and provenance after live source becomes stale", async () => {
		const source = await vocabulary(undefined, "frequency");
		const controller = batchController();
		unwrap(commit(controller, unwrap(controller.beginGenerate({ vocabulary: source.owner, patternSet: STANDARD, count: 10, defaultPattern: random, operationMaterial: privateMaterial(2) }))));
		const batch = controller.read().batch!;
		const beforeCalls = source.calls();
		// A new live vocabulary is available; no API supplies it to row regeneration.
		const live = await vocabulary([token("別世界")]);
		expect(live.owner.snapshot.fingerprint).not.toBe(batch.vocabulary.fingerprint);
		const spy = vi.spyOn(core, "generateCollisionResults");
		unwrap(commit(controller, unwrap(controller.beginRegenerate({ rowSlotId: batch.rows[0]!.rowSlotId, operationMaterial: privateMaterial(9) }))));
		const next = controller.read().batch!;
		expect(next.pool).toBe(batch.pool);
		expect(next.patternSet).toBe(batch.patternSet);
		expect(next.vocabularyOwner).toBe(source.owner);
		expect(next.vocabulary).toBe(batch.vocabulary);
		expect(spy.mock.calls[0]![0].drawMode).toBe("frequency");
		expect(source.calls()).toBe(beforeCalls);
	});
});

describe("Collision operation frontier", () => {
	it("cancels before preparation without building or drawing", async () => {
		const { controller, input, batch } = await ready();
		const spy = vi.spyOn(core, "generateCollisionResults");
		const ticket = unwrap(controller.beginGenerate(input));
		unwrap(controller.cancel(ticket));
		expect(controller.prepare(ticket)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(spy).not.toHaveBeenCalled();
		expect(controller.read().batch).toBe(batch);
	});
	it.each(["generate", "regenerate"] as const)("cancels %s without changing any committed reference", async (kind) => {
		const { controller, input, batch, slot } = await ready();
		const ticket = unwrap(kind === "generate" ? controller.beginGenerate(input) : controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(4) }));
		const done = unwrap(controller.prepare(ticket));
		unwrap(controller.cancel(ticket));
		expect(controller.read().batch).toBe(batch);
		expect(controller.complete(ticket, done)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(controller.read().batch).toBe(batch);
	});
	it.each(["generate", "regenerate"] as const)("supersedes older %s completions", async (kind) => {
		const { controller, input, batch, slot } = await ready();
		const begin = () => unwrap(kind === "generate" ? controller.beginGenerate(input) : controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(4) }));
		const old = begin();
		const late = unwrap(controller.prepare(old));
		const latest = begin();
		expect(controller.complete(old, late)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(controller.read().batch).toBe(batch);
		unwrap(commit(controller, latest));
		expect(controller.read().batch).not.toBe(batch);
		if (kind === "regenerate") expect(controller.read().batch!.rows[0]!.committed.generationRevision).toBe(2);
	});
	it("does not confuse different rows and merges their independent commits", async () => {
		const { controller, batch } = await ready();
		const a = unwrap(controller.beginRegenerate({ rowSlotId: batch.rows[0]!.rowSlotId, operationMaterial: privateMaterial(5) }));
		const b = unwrap(controller.beginRegenerate({ rowSlotId: batch.rows[4]!.rowSlotId, operationMaterial: privateMaterial(6) }));
		const ca = unwrap(controller.prepare(a));
		const cb = unwrap(controller.prepare(b));
		expect(controller.complete(a, cb)).toEqual({ ok: false, reason: "invalid-completion" });
		unwrap(controller.complete(a, ca));
		const first = controller.read().batch!.rows[0];
		unwrap(controller.complete(b, cb));
		expect(controller.read().batch!.rows[0]).toBe(first);
		expect(controller.read().batch!.rows[4]!.committed.generationRevision).toBe(2);
		expect(controller.read().batch!.rows[1]).toBe(batch.rows[1]);
	});
	it("rejects a concurrent row completion that now duplicates a committed row", async () => {
		const { controller, batch } = await ready();
		const real = core.generateCollisionResults;
		let result: core.CollisionGenerationResult | null = null;
		vi.spyOn(core, "generateCollisionResults").mockImplementation((input) => result ?? (result = real(input)));
		const a = unwrap(controller.beginRegenerate({ rowSlotId: batch.rows[0]!.rowSlotId, operationMaterial: privateMaterial(5) }));
		const b = unwrap(controller.beginRegenerate({ rowSlotId: batch.rows[1]!.rowSlotId, operationMaterial: privateMaterial(6) }));
		const ca = unwrap(controller.prepare(a));
		const cb = unwrap(controller.prepare(b));
		unwrap(controller.complete(a, ca));
		const current = controller.read().batch;
		expect(controller.complete(b, cb)).toEqual({ ok: false, reason: "duplicate-exhausted" });
		expect(controller.read().batch).toBe(current);
		expect(current!.rows[1]).toBe(batch.rows[1]);
	});
	it("selector changes invalidate only that row's in-flight operation", async () => {
		const { controller, batch, slot } = await ready();
		const ticket = unwrap(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(4) }));
		const completion = unwrap(controller.prepare(ticket));
		unwrap(controller.select({ rowSlotId: slot, selector: { kind: "same" } }));
		expect(controller.complete(ticket, completion)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(controller.read().batch).toBe(batch);
	});
	it("new Generate invalidates old row work even when cancelled", async () => {
		const { controller, input, batch, slot } = await ready();
		const row = unwrap(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(4) }));
		const done = unwrap(controller.prepare(row));
		const gen = unwrap(controller.beginGenerate(input));
		expect(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(5) })).toEqual({ ok: false, reason: "busy" });
		unwrap(controller.cancel(gen));
		expect(controller.complete(row, done)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(controller.read().batch).toBe(batch);
	});
	it.each(["close", "dispose"] as const)("%s releases captured state and refuses all late completion", async (action) => {
		const { controller, input, batch, slot } = await ready();
		const collected = collect(batch);
		const ticket = unwrap(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(5) }));
		const done = unwrap(controller.prepare(ticket));
		unwrap(controller[action]());
		expect(controller.read().batch).toBeNull();
		expect(controller.read().rowDrafts).toEqual([]);
		expect(controller.complete(ticket, done)).toEqual({ ok: false, reason: "released" });
		expect(controller.prepare(ticket)).toEqual({ ok: false, reason: "released" });
		expect(controller.beginGenerate(input)).toEqual({ ok: false, reason: "released" });
		expect(collect(batch)).toEqual(collected);
		unwrap(controller.dispose());
		unwrap(controller.close());
		expect(controller.read().lifecycle).toBe("disposed");
	});
	it("rejects replayed, cloned and cross-owner tickets/completions without consuming genuine work", async () => {
		const { controller, input } = await ready();
		const other = batchController(2);
		const ticket = unwrap(controller.beginGenerate(input));
		const done = unwrap(controller.prepare(ticket));
		expect(controller.prepare(ticket)).toEqual({ ok: false, reason: "already-prepared" });
		expect(controller.complete({ ...ticket }, done)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(other.complete(ticket, done)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(controller.complete(ticket, { ...done })).toEqual({ ok: false, reason: "invalid-completion" });
		unwrap(controller.complete(ticket, done));
		expect(controller.complete(ticket, done)).toEqual({ ok: false, reason: "invalid-ticket" });
	});
});

describe("Collision batch fail-closed and Collect seam", () => {
	it("refuses reentrant lifecycle transitions from a Proxy trap", async () => {
		const { controller, input, batch } = await ready();
		const reentered: unknown[] = [];
		const proxy = new Proxy(input, {
			ownKeys(target) {
				reentered.push(controller.close(), controller.dispose());
				return Reflect.ownKeys(target);
			},
		});
		const ticket = unwrap(controller.beginGenerate(proxy));
		expect(reentered).toEqual([{ ok: false, reason: "busy" }, { ok: false, reason: "busy" }]);
		expect(controller.read().batch).toBe(batch);
		expect(controller.read().lifecycle).toBe("open");
		unwrap(controller.cancel(ticket));
		unwrap(controller.dispose());
		expect(controller.read().lifecycle).toBe("disposed");
	});
	it("refuses raw/cloned vocabulary and a genuine pool supplied alongside a different owner", async () => {
		const { controller, input, batch } = await ready();
		for (const forged of [input.vocabulary.snapshot, { ...input.vocabulary }, structuredClone(input.vocabulary)]) {
			expect(controller.beginGenerate({ ...input, vocabulary: forged } as CollisionBatchGenerateInput)).toEqual({ ok: false, reason: "invalid-vocabulary" });
		}
		const another = await vocabulary([token("別世界")]);
		const built = buildAuthenticatedCollisionLexemePool({ vocabulary: another.owner, patternData: STANDARD });
		if (!built.ok) throw new Error(built.reason);
		expect(controller.beginGenerate({ ...input, pool: built.pool } as CollisionBatchGenerateInput)).toEqual({ ok: false, reason: "invalid-request" });
		const forged = freezeAnalysis({ ...batch, vocabularyOwner: another.owner, pool: built.pool });
		expect(collisionFragmentFromBatch({ batch: forged, rowSlotId: batch.rows[0]!.rowSlotId })).toEqual({ ok: false, reason: "invalid-state" });
		expect(controller.read().batch).toBe(batch);
	});
	it("refuses malformed and unfrozen pattern sets through the owning validators", async () => {
		const { controller, input, batch } = await ready();
		expect(controller.beginGenerate({ ...input, patternSet: { ...STANDARD } })).toEqual({ ok: false, reason: "invalid-pattern-set" });
		const patternSet = freezeAnalysis({ ...STANDARD, recipes: [{ ...STANDARD.recipes[0]!, id: "<script>" }] });
		const ticket = unwrap(controller.beginGenerate({ ...input, patternSet }));
		expect(commit(controller, ticket)).toEqual({ ok: false, reason: "invalid-pattern-set" });
		expect(controller.read().batch).toBe(batch);
	});
	it("refuses hidden mutable Symbol payloads and accessors in otherwise frozen patterns", async () => {
		const { controller, input, batch } = await ready();
		const hidden = Object.freeze({ ...STANDARD, [Symbol("hidden")]: { mutable: true } });
		const getter = Object.freeze({ ...STANDARD, get recipes(): typeof STANDARD.recipes { throw new Error("PRIVATE"); } });
		for (const patternSet of [hidden, getter]) {
			expect(controller.beginGenerate({ ...input, patternSet })).toEqual({ ok: false, reason: "invalid-pattern-set" });
		}
		expect(controller.read().batch).toBe(batch);
	});
	it("rejects forged batch state, duplicate identities and inconsistent revisions", async () => {
		const { batch, slot } = await ready();
		const first = batch.rows[0]!;
		const forgeries = [
			{ ...batch }, structuredClone(batch),
			{ ...batch, rows: [first, first] },
			{ ...batch, patternSet: patterns() },
			...[0, 2, Number.MAX_SAFE_INTEGER, Infinity].map((revision) => ({ ...batch, rows: [{ ...first, committed: { ...first.committed, generationRevision: revision } }] })),
		];
		for (const forged of forgeries) expect(collisionFragmentFromBatch({ batch: freezeAnalysis(forged), rowSlotId: slot })).toEqual({ ok: false, reason: "invalid-state" });
	});
	it("fails closed on identity collisions with no partial publication", async () => {
		const { controller, input, batch } = await ready();
		const ticket = unwrap(controller.beginGenerate(input));
		const done = unwrap(controller.prepare(ticket));
		vi.spyOn(hashing, "sha256Hex").mockReturnValue("0".repeat(64));
		expect(controller.complete(ticket, done)).toEqual({ ok: false, reason: "identity-conflict" });
		expect(controller.read().batch).toBe(batch);
	});
	it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, "1", null])("refuses revision overflow/malformed %s", (value) => {
		expect(advanceCollisionRevision(value)).toEqual({ ok: false, reason: "revision-overflow" });
	});
	it("increments safe revisions without wraparound", () => {
		expect(advanceCollisionRevision(0)).toEqual({ ok: true, value: 1 });
		expect(advanceCollisionRevision(Number.MAX_SAFE_INTEGER - 1)).toEqual({ ok: true, value: Number.MAX_SAFE_INTEGER });
	});
	it("rolls back the whole row commit when checked revision arithmetic refuses", async () => {
		const { controller, batch, slot } = await ready();
		const ticket = unwrap(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(4) }));
		const completion = unwrap(controller.prepare(ticket));
		vi.spyOn(Number, "isSafeInteger").mockReturnValue(false);
		expect(controller.complete(ticket, completion)).toEqual({ ok: false, reason: "revision-overflow" });
		expect(controller.read().batch).toBe(batch);
	});
	it("rejects an identity already issued to a prior result", async () => {
		const { controller, batch, slot } = await ready();
		const ticket = unwrap(controller.beginRegenerate({ rowSlotId: slot, operationMaterial: privateMaterial(4) }));
		const completion = unwrap(controller.prepare(ticket));
		vi.spyOn(hashing, "sha256Hex").mockReturnValue(batch.rows[0]!.committed.rowId);
		expect(controller.complete(ticket, completion)).toEqual({ ok: false, reason: "identity-conflict" });
		expect(controller.read().batch).toBe(batch);
	});
	it("keeps only the fixed Collect fields, actual recipe and committed identities", async () => {
		const { controller, batch, slot } = await ready();
		unwrap(controller.select({ rowSlotId: slot, selector: { kind: "fixed", recipeId: "named" } }));
		const input = collect(batch);
		expect(Object.keys(input).sort()).toEqual(["type", "text", "vocabulary", "algorithmVersion", "patternId", "patternSetVersion", "batchId", "rowId"].sort());
		expect(input).toMatchObject({ type: "collision", algorithmVersion: 1, patternSetVersion: 2, patternId: batch.rows[0]!.committed.recipeId, text: batch.rows[0]!.committed.text });
		expect(input.vocabulary).toBe(batch.vocabulary);
		expect(validateFragmentInput(input)).toBeNull();
		assertFrozen(input);
		expect(JSON.stringify(input)).not.toMatch(/requested|rowSlotId|generationRevision|nonce|Material|pool|morphology|operation|lastError/u);
	});
	it("exposes neither material nor nonce in state, tickets, completions or fixed failures", async () => {
		const { controller, input } = await ready();
		const ticket = unwrap(controller.beginGenerate(input));
		const done = unwrap(controller.prepare(ticket));
		const output = JSON.stringify([controller.read(), ticket, done]);
		expect(output).not.toContain(privateMaterial(1));
		expect(output).not.toContain(privateMaterial(2));
		expect(output).not.toMatch(/nonce|operationMaterial|identityMaterial/u);
	});
	it("refuses unknown slots and row Random without changing state", async () => {
		const { controller, slot } = await ready();
		const state = controller.read();
		expect(controller.select({ rowSlotId: "unknown", selector: { kind: "same" } })).toEqual({ ok: false, reason: "unknown-row" });
		expect(controller.beginRegenerate({ rowSlotId: "unknown", operationMaterial: privateMaterial(4) })).toEqual({ ok: false, reason: "unknown-row" });
		expect(controller.select({ rowSlotId: slot, selector: random as never })).toEqual({ ok: false, reason: "invalid-request" });
		expect(controller.read()).toBe(state);
	});
	it("refuses every malformed outer input and throwing getter without exposing its message", async () => {
		const { controller, input, batch, slot } = await ready();
		const bomb = { get vocabulary() { throw new Error("PRIVATE note path surface reading"); } };
		for (const bad of [null, undefined, 1, "text", [], {}, bomb, new Proxy({}, { ownKeys() { throw new Error("PRIVATE"); } })]) {
			const outcomes = [
				createCollisionBatchController(bad as never), controller.beginGenerate(bad as never), controller.select(bad as never),
				controller.beginRegenerate(bad as never), controller.prepare(bad as never), controller.cancel(bad as never),
				controller.complete(bad as CollisionOperationTicket, bad as CollisionOperationCompletion), collisionFragmentFromBatch(bad as never),
			];
			for (const outcome of outcomes) { expect(outcome.ok).toBe(false); expect(JSON.stringify(outcome)).not.toMatch(/PRIVATE|surface|reading|path/u); }
		}
		for (const count of [0, 1, 11, 200, NaN, Infinity]) expect(controller.beginGenerate({ ...input, count } as CollisionBatchGenerateInput).ok).toBe(false);
		expect(controller.beginGenerate({ ...input, operationMaterial: "private" })).toEqual({ ok: false, reason: "invalid-request" });
		expect(controller.select({ rowSlotId: slot, selector: { get kind() { throw new Error("PRIVATE"); } } as never }).ok).toBe(false);
		expect(controller.read().batch).toBe(batch);
	});
});
