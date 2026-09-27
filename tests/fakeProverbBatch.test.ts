import { describe, expect, it } from "vitest";
import {
	FAKE_PROVERB_BATCH_SIZE,
	createFakeProverbBatchController,
	readFakeProverbRow,
	type FakeProverbBatch,
	type FakeProverbBatchController,
	type FakeProverbOperationCompletion,
	type FakeProverbOperationTicket,
} from "../src/fakeProverb/fakeProverbBatch";
import { fakeProverbCanonicalText } from "../src/fakeProverb/fakeProverbCore";
import { FAKE_PROVERB_ALGORITHM_VERSION } from "../src/fakeProverb/fakeProverbVersions";
import type { CompiledFakeProverbRecipeSet } from "../src/fakeProverb/compileRecipeSet";
import { deepFrozen } from "./automaticPosFixtures";
import { RICH_TEXT, compile, customInput, mintOwner, ok, standardSet } from "./fakeProverbCoreFixtures";

type Owner = Awaited<ReturnType<typeof mintOwner>>["owner"];

let materialCounter = 0;
/** Fresh 256-bit hex material per call, as a caller would issue from Web Crypto. */
const material = (): string => (++materialCounter).toString(16).padStart(64, "a");
const HEX64 = /^[0-9a-f]{64}$/u;

function controller(): FakeProverbBatchController {
	return ok(createFakeProverbBatchController({ identityMaterial: material() }));
}

function refused(answer: { ok: boolean; reason?: string }): string {
	expect(answer.ok).toBe(false);
	expect(Object.keys(answer).sort()).toEqual(["ok", "reason"]);
	return answer.reason!;
}

function begin(owner: FakeProverbBatchController, vocabulary: Owner, recipeSet: CompiledFakeProverbRecipeSet): FakeProverbOperationTicket {
	return ok(owner.beginGenerate({ vocabulary, recipeSet, operationMaterial: material() }));
}

/** begin -> prepare -> complete, returning the committed batch. */
function generate(owner: FakeProverbBatchController, vocabulary: Owner, recipeSet: CompiledFakeProverbRecipeSet): FakeProverbBatch {
	const ticket = begin(owner, vocabulary, recipeSet);
	const completion = ok(owner.prepare(ticket));
	return ok(owner.complete(ticket, completion)).batch!;
}

async function rich() {
	const { owner } = await mintOwner([RICH_TEXT]);
	return { vocabulary: owner, recipeSet: standardSet() };
}

describe("the Fake Proverb batch owner", () => {
	it("mints ten stable rowSlotIds from fresh 256-bit material and refuses anything else", () => {
		const owner = controller();
		const state = owner.read();
		expect(state.lifecycle).toBe("open");
		expect(state.batch).toBeNull();
		expect(state.rowSlotIds).toHaveLength(FAKE_PROVERB_BATCH_SIZE);
		expect(FAKE_PROVERB_BATCH_SIZE).toBe(10);
		expect(new Set(state.rowSlotIds).size).toBe(10);
		for (const id of state.rowSlotIds) expect(id).toMatch(HEX64);
		expect(controller().read().rowSlotIds).not.toEqual(state.rowSlotIds);
		for (const identityMaterial of ["", "A".repeat(64), "a".repeat(63), 1, null]) {
			expect(refused(createFakeProverbBatchController({ identityMaterial: identityMaterial as string }))).toBe("invalid-request");
		}
		expect(refused(createFakeProverbBatchController({ identityMaterial: material(), extra: 1 } as never))).toBe("invalid-request");
		expect(deepFrozen(state)).toBe(true);
	});

	it("commits a complete batch of ten atomic rows with separate batch, slot and row identities", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const batch = generate(owner, vocabulary, recipeSet);
		const state = owner.read();
		expect(state.batch).toBe(batch);
		expect(state.generation).toEqual({ pending: false, lastError: null });
		expect([batch.status, batch.actualCount, batch.requestedCount, batch.shortfallReason]).toEqual(["complete", 10, 10, null]);
		expect([batch.algorithmVersion, batch.recipeSchemaVersion, batch.recipeDataVersion]).toEqual([FAKE_PROVERB_ALGORITHM_VERSION, 1, 1]);
		expect(batch.provenance.vocabularyFingerprint).toBe(vocabulary.snapshot.fingerprint);
		expect(batch.provenance.sources.map((source) => source.path)).toEqual(["private-note-0.md"]);
		expect(batch.rows.map((row) => row.rowSlotId)).toEqual(state.rowSlotIds);
		const rowIds = batch.rows.map((row) => row.committed!.rowId);
		const all = [batch.batchId, ...rowIds, ...state.rowSlotIds];
		expect(new Set(all).size).toBe(all.length);
		for (const id of all) expect(id).toMatch(HEX64);
		for (const row of batch.rows) {
			const committed = row.committed!;
			// One draft is one row: proverb, gloss, recipe IDs and canonical text all come from it.
			expect(committed.canonicalText).toBe(fakeProverbCanonicalText(committed.proverbText, committed.glossText));
			expect(committed.canonicalText).toBe(committed.draft.canonicalText);
			expect([committed.proverbText, committed.glossText]).toEqual([committed.draft.proverb.text, committed.draft.gloss.text]);
			expect([committed.proverbRecipeId, committed.glossRecipeId]).toEqual([committed.draft.proverb.recipeId, committed.draft.gloss.recipeId]);
		}
		expect(new Set(batch.rows.map((row) => row.committed!.canonicalText)).size).toBe(10);
		expect(deepFrozen(batch)).toBe(true);
	});

	it("keeps rowSlotIds stable across Generates while every batch and row gets a new identity", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const first = generate(owner, vocabulary, recipeSet);
		const firstJson = JSON.stringify(first);
		const second = generate(owner, vocabulary, recipeSet);
		expect(second.rows.map((row) => row.rowSlotId)).toEqual(first.rows.map((row) => row.rowSlotId));
		expect(second.batchId).not.toBe(first.batchId);
		const firstRows = new Set(first.rows.map((row) => row.committed!.rowId));
		for (const row of second.rows) expect(firstRows.has(row.committed!.rowId)).toBe(false);
		// A value read before stays exactly what it was.
		expect(JSON.stringify(first)).toBe(firstJson);
	});

	it("never exposes identity or operation material, nonce or ticket state", async () => {
		const { vocabulary, recipeSet } = await rich();
		const identityMaterial = material();
		const owner = ok(createFakeProverbBatchController({ identityMaterial }));
		const operationMaterial = material();
		const ticket = ok(owner.beginGenerate({ vocabulary, recipeSet, operationMaterial }));
		expect(Object.keys(ticket)).toEqual(["kind"]);
		const completion = ok(owner.prepare(ticket));
		expect(Object.keys(completion)).toEqual(["kind"]);
		const json = JSON.stringify(ok(owner.complete(ticket, completion)));
		for (const secret of [identityMaterial, operationMaterial]) expect(json).not.toContain(secret);
		for (const key of ["nonce", "seed", "material", "ticket", "secret", "metadataVersion"]) expect(json).not.toContain(`"${key}"`);
	});
});

describe("partial, empty and refused Generates", () => {
	it("commits one to nine drafts together as a partial batch with CORE1's shortfall reason", async () => {
		const { owner: vocabulary } = await mintOwner(["猫は見る。"]);
		const recipeSet = compile(customInput());
		const owner = controller();
		const batch = generate(owner, vocabulary, recipeSet);
		expect([batch.status, batch.actualCount, batch.shortfallReason]).toEqual(["partial", 1, "duplicate-exhaustion"]);
		expect(batch.rows).toHaveLength(10);
		expect(batch.rows[0]!.committed!.canonicalText).toBe("**猫は見る**\n\n> 猫と猫");
		expect(batch.rows.slice(1).every((row) => row.committed === null)).toBe(true);
		expect(refused(readFakeProverbRow({ batch, rowSlotId: batch.rows[1]!.rowSlotId }))).toBe("empty-row");
	});

	it("keeps the previous batch when a Generate yields no draft", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const previous = generate(owner, vocabulary, recipeSet);
		const { owner: empty } = await mintOwner(["猫と犬。"]);
		const ticket = begin(owner, empty, compile(customInput()));
		expect(owner.read().generation.pending).toBe(true);
		const completion = ok(owner.prepare(ticket));
		expect(refused(owner.complete(ticket, completion))).toBe("insufficient-candidates");
		expect(owner.read().batch).toBe(previous);
		expect(owner.read().generation).toEqual({ pending: false, lastError: "insufficient-candidates" });
	});

	it.each([
		["a compatible-gloss shortfall", async () => ({ vocabulary: (await mintOwner(["猫と犬。"])).owner,
			recipeSet: compile(customInput({ proverbs: [{ id: "p-one", enabled: true, weight: 1, parts: [
				{ kind: "noun", slotId: "n1", profileId: "noun-p", exported: true }, { kind: "literal", literalId: "to" }, { kind: "noun", slotId: "n2", profileId: "noun-p", exported: false }] }],
			glosses: [{ id: "g-one", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n1" }], parts: [
				{ kind: "reference", slotKind: "noun", slotId: "n1" }, { kind: "literal", literalId: "wa" }, { kind: "predicate", slotId: "g1", profileId: "pred-p", exported: false }] }] })) }), "no-compatible-gloss"],
		["an unauthenticated recipe set", async () => ({ vocabulary: (await rich()).vocabulary, recipeSet: structuredClone(standardSet()) }), "invalid-recipe-set"],
	] as const)("keeps the previous batch on %s", async (_name, make, reason) => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const previous = generate(owner, vocabulary, recipeSet);
		const input = await make();
		const ticket = begin(owner, input.vocabulary, input.recipeSet);
		const completion = ok(owner.prepare(ticket));
		expect(refused(owner.complete(ticket, completion))).toBe(reason);
		expect(owner.read().batch).toBe(previous);
	});

	it("refuses an unauthenticated Vocabulary or malformed input before any operation starts", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		for (const bad of [vocabulary.snapshot, { ...vocabulary }, null]) {
			expect(refused(owner.beginGenerate({ vocabulary: bad as never, recipeSet, operationMaterial: material() }))).toBe("invalid-vocabulary");
		}
		expect(refused(owner.beginGenerate({ vocabulary, recipeSet, operationMaterial: "short" }))).toBe("invalid-request");
		expect(refused(owner.beginGenerate({ vocabulary, recipeSet, operationMaterial: material(), count: 10 } as never))).toBe("invalid-request");
		let ran = false;
		expect(refused(owner.beginGenerate({ recipeSet, operationMaterial: material(), get vocabulary() { ran = true; return vocabulary; } }))).toBe("invalid-request");
		expect(ran).toBe(false);
		expect(owner.read().generation).toEqual({ pending: false, lastError: null });
	});
});

describe("tickets and completions", () => {
	it("refuses forged, reused, foreign and out-of-order capabilities", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const other = controller();
		const ticket = begin(owner, vocabulary, recipeSet);
		const forgedTicket = { kind: "fake-proverb-generate" } as FakeProverbOperationTicket;
		const forgedCompletion = { kind: "fake-proverb-completion" } as FakeProverbOperationCompletion;
		expect(refused(owner.prepare(forgedTicket))).toBe("invalid-ticket");
		expect(refused(other.prepare(ticket))).toBe("invalid-ticket");
		expect(refused(owner.complete(ticket, forgedCompletion))).toBe("invalid-completion");
		const completion = ok(owner.prepare(ticket));
		expect(refused(owner.prepare(ticket))).toBe("already-prepared");
		expect(refused(owner.complete(ticket, forgedCompletion))).toBe("invalid-completion");
		expect(refused(owner.complete(forgedTicket, completion))).toBe("invalid-ticket");
		const committed = ok(owner.complete(ticket, completion)).batch;
		// A spent ticket cannot commit again, and the committed batch is unchanged.
		expect(refused(owner.complete(ticket, completion))).toBe("invalid-ticket");
		expect(refused(owner.cancel(ticket))).toBe("invalid-ticket");
		expect(owner.read().batch).toBe(committed);
	});

	it("lets a new Generate supersede an older pending one, before and after its prepare", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const previous = generate(owner, vocabulary, recipeSet);
		const older = begin(owner, vocabulary, recipeSet);
		const olderCompletion = ok(owner.prepare(older));
		const newer = begin(owner, vocabulary, recipeSet);
		expect(refused(owner.complete(older, olderCompletion))).toBe("superseded");
		expect(refused(owner.prepare(older))).toBe("superseded");
		expect(owner.read().batch).toBe(previous);
		const newest = begin(owner, vocabulary, recipeSet);
		expect(refused(owner.prepare(newer))).toBe("superseded");
		const committed = ok(owner.complete(newest, ok(owner.prepare(newest)))).batch!;
		expect(committed).not.toBe(previous);
		expect(committed.batchId).not.toBe(previous.batchId);
	});

	it("cancels without committing and keeps the previous batch", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const previous = generate(owner, vocabulary, recipeSet);
		const ticket = begin(owner, vocabulary, recipeSet);
		const completion = ok(owner.prepare(ticket));
		expect(ok(owner.cancel(ticket)).generation).toEqual({ pending: false, lastError: "cancelled" });
		expect(refused(owner.complete(ticket, completion))).toBe("cancelled");
		expect(refused(owner.cancel(ticket))).toBe("cancelled");
		expect(owner.read().batch).toBe(previous);
	});

	it("refuses re-entry from a Proxy trap during validation", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		let inner: string | undefined;
		const input = new Proxy({ vocabulary, recipeSet, operationMaterial: material() }, {
			getPrototypeOf(target) {
				inner = refused(owner.beginGenerate({ vocabulary, recipeSet, operationMaterial: material() }));
				return Reflect.getPrototypeOf(target);
			},
		});
		owner.beginGenerate(input);
		expect(inner).toBe("busy");
	});
});

describe("Source changes and release", () => {
	it("makes pending work stale while keeping every committed result and its provenance", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const committed = generate(owner, vocabulary, recipeSet);
		const before = JSON.stringify(committed);
		const ticket = begin(owner, vocabulary, recipeSet);
		const completion = ok(owner.prepare(ticket));
		const state = ok(owner.sourceChanged());
		expect(state.generation).toEqual({ pending: false, lastError: "stale" });
		expect(state.batch).toBe(committed);
		expect(JSON.stringify(state.batch)).toBe(before);
		expect(refused(owner.complete(ticket, completion))).toBe("stale");
		// A new Generate needs a live owner: the old one is stale for Fake Proverb.
		expect(refused(owner.beginGenerate({ vocabulary, recipeSet, operationMaterial: material() }))).toBe("stale");
		const { owner: fresh } = await mintOwner([RICH_TEXT]);
		const next = generate(owner, fresh, recipeSet);
		expect(next.batchId).not.toBe(committed.batchId);
		expect(next.rows.map((row) => row.rowSlotId)).toEqual(committed.rows.map((row) => row.rowSlotId));
		// The earlier row is still readable with the provenance it was generated from.
		const record = ok(readFakeProverbRow({ batch: committed, rowSlotId: committed.rows[0]!.rowSlotId }));
		expect(record.provenance.vocabularyFingerprint).toBe(vocabulary.snapshot.fingerprint);
	});

	it("marks an owner stale even when its Generate was begun but never prepared", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const ticket = begin(owner, vocabulary, recipeSet);
		ok(owner.sourceChanged());
		expect(refused(owner.prepare(ticket))).toBe("stale");
		expect(refused(owner.beginGenerate({ vocabulary, recipeSet, operationMaterial: material() }))).toBe("stale");
		expect(owner.read().batch).toBeNull();
	});

	it("leaves the generation status alone when a Source changes with nothing pending", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const committed = generate(owner, vocabulary, recipeSet);
		expect(ok(owner.sourceChanged()).generation).toEqual({ pending: false, lastError: null });
		expect(owner.read().batch).toBe(committed);
	});

	it.each(["close", "dispose"] as const)("releases everything on %s and refuses every late call", async (how) => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const committed = generate(owner, vocabulary, recipeSet);
		const ticket = begin(owner, vocabulary, recipeSet);
		const completion = ok(owner.prepare(ticket));
		const state = ok(owner[how]());
		expect(state).toEqual({ lifecycle: how === "close" ? "closed" : "disposed", rowSlotIds: [], batch: null, generation: { pending: false, lastError: null } });
		expect(refused(owner.complete(ticket, completion))).toBe("closed");
		expect(refused(owner.prepare(ticket))).toBe("closed");
		expect(refused(owner.cancel(ticket))).toBe("closed");
		expect(refused(owner.beginGenerate({ vocabulary, recipeSet, operationMaterial: material() }))).toBe("closed");
		expect(refused(owner.sourceChanged())).toBe("closed");
		// Terminal: close -> dispose ends disposed, dispose -> close stays disposed.
		expect(ok(owner.dispose()).lifecycle).toBe("disposed");
		expect(ok(owner.close()).lifecycle).toBe("disposed");
		// A value read before release stays valid and readable.
		expect(ok(readFakeProverbRow({ batch: committed, rowSlotId: committed.rows[0]!.rowSlotId })).rowId).toBe(committed.rows[0]!.committed!.rowId);
		// The released owner is revoked for Fake Proverb; a new lifecycle needs a new owner and a fresh Vocabulary owner.
		const next = controller();
		const retry = begin(next, vocabulary, recipeSet);
		expect(refused(next.complete(retry, ok(next.prepare(retry))))).toBe("released");
		const { owner: fresh } = await mintOwner([RICH_TEXT]);
		expect(generate(next, fresh, recipeSet).status).toBe("complete");
	});
});

// Review 1 (P1): a draft prepared by one controller survived another controller revoking the shared owner.
describe("a Vocabulary owner shared by two controllers", () => {
	it.each([
		["sourceChanged", "stale"],
		["close", "released"],
		["dispose", "released"],
	] as const)("refuses to commit a draft prepared before the other holder's %s, keeping the previous batch", async (how, reason) => {
		const { vocabulary, recipeSet } = await rich();
		const a = controller();
		const b = controller();
		generate(a, vocabulary, recipeSet);
		const previous = generate(b, vocabulary, recipeSet);
		const ticket = begin(b, vocabulary, recipeSet);
		const completion = ok(b.prepare(ticket));
		ok(a[how]());
		expect(refused(b.complete(ticket, completion))).toBe(reason);
		expect(b.read().batch).toBe(previous);
		expect(b.read().generation).toEqual({ pending: false, lastError: reason });
		// B's later Generates on that owner are refused too, and B still works with a freshly minted owner.
		const retry = begin(b, vocabulary, recipeSet);
		expect(refused(b.complete(retry, ok(b.prepare(retry))))).toBe(reason);
		expect(b.read().batch).toBe(previous);
		const { owner: fresh } = await mintOwner([RICH_TEXT]);
		expect(generate(b, fresh, recipeSet).status).toBe("complete");
	});

	// Re-review (P1): an owner A knew only through a begun, unprepared ticket was not revoked owner-wide.
	it.each([
		["sourceChanged", "stale"],
		["close", "released"],
		["dispose", "released"],
	] as const)("revokes owner-wide an owner A had only begun a Generate with, on A's %s", async (how, reason) => {
		const { vocabulary, recipeSet } = await rich();
		const a = controller();
		const withCache = controller();
		const previous = generate(withCache, vocabulary, recipeSet);
		const aTicket = begin(a, vocabulary, recipeSet);
		ok(a[how]());
		// A: its begun ticket is gone, and it cannot start again with that owner.
		expect(refused(a.prepare(aTicket))).toBe(how === "sourceChanged" ? "stale" : "closed");
		expect(refused(a.beginGenerate({ vocabulary, recipeSet, operationMaterial: material() }))).toBe(how === "sourceChanged" ? "stale" : "closed");
		// B without a cached authority: minting from the revoked owner is refused.
		const fresh = controller();
		const ticket = begin(fresh, vocabulary, recipeSet);
		expect(refused(fresh.complete(ticket, ok(fresh.prepare(ticket))))).toBe(reason);
		expect(fresh.read().batch).toBeNull();
		// B with a cached authority from before: generating from it is refused, and its batch is kept.
		const cachedTicket = begin(withCache, vocabulary, recipeSet);
		expect(refused(withCache.complete(cachedTicket, ok(withCache.prepare(cachedTicket))))).toBe(reason);
		expect(withCache.read().batch).toBe(previous);
		// A freshly minted owner over the same Source still works for B.
		const { owner: next } = await mintOwner([RICH_TEXT]);
		expect(generate(fresh, next, recipeSet).status).toBe("complete");
	});

	it("still commits normally when nobody revokes the shared owner", async () => {
		const { vocabulary, recipeSet } = await rich();
		const a = controller();
		const b = controller();
		generate(a, vocabulary, recipeSet);
		const ticket = begin(b, vocabulary, recipeSet);
		const completion = ok(b.prepare(ticket));
		generate(a, vocabulary, recipeSet);
		expect(ok(b.complete(ticket, completion)).batch!.status).toBe("complete");
	});
});

describe("the committed-row read seam", () => {
	it("gives result identity, actual recipe IDs, canonical text, versions and provenance, and nothing else", async () => {
		const { vocabulary, recipeSet } = await rich();
		const owner = controller();
		const batch = generate(owner, vocabulary, recipeSet);
		const row = batch.rows[3]!;
		const record = ok(readFakeProverbRow({ batch, rowSlotId: row.rowSlotId }));
		expect(Object.keys(record).sort()).toEqual(["algorithmVersion", "batchId", "canonicalText", "glossRecipeId", "provenance",
			"proverbRecipeId", "recipeDataVersion", "recipeSchemaVersion", "rowId"]);
		expect(record).toEqual({ batchId: batch.batchId, rowId: row.committed!.rowId, algorithmVersion: 1, recipeSchemaVersion: 1, recipeDataVersion: 1,
			proverbRecipeId: row.committed!.proverbRecipeId, glossRecipeId: row.committed!.glossRecipeId, canonicalText: row.committed!.canonicalText,
			provenance: batch.provenance });
		expect(JSON.stringify(record)).not.toMatch(/"(?:draft|bindings|rowSlotId|actualCount|shortfallReason|nonce)"/u);
		expect(deepFrozen(record)).toBe(true);
	});

	it("refuses a look-alike batch, an unknown slot and malformed input", async () => {
		const { vocabulary, recipeSet } = await rich();
		const batch = generate(controller(), vocabulary, recipeSet);
		expect(refused(readFakeProverbRow({ batch: structuredClone(batch), rowSlotId: batch.rows[0]!.rowSlotId }))).toBe("invalid-state");
		expect(refused(readFakeProverbRow({ batch: { ...batch }, rowSlotId: batch.rows[0]!.rowSlotId }))).toBe("invalid-state");
		expect(refused(readFakeProverbRow({ batch, rowSlotId: "missing" }))).toBe("unknown-row");
		expect(refused(readFakeProverbRow({ batch, rowSlotId: batch.rows[0]!.rowSlotId, extra: 1 } as never))).toBe("invalid-request");
	});
});
