import { afterEach, describe, expect, it, vi } from "vitest";
import * as guard from "../src/transform/manualAdverbGuard";
import { createManualAdverbController } from "../src/transform/manualAdverbController";
import { releaseManualAdverbAuthority } from "../src/transform/manualAdverbAuthority";
import { analyzeManualMorphSource, buildManualMorphVocabulary, readManualMorphVocabularySources } from "../src/transform/manualMorphology";
import { adverb, bind, bridge, build, makeOwner, sentence, unwrap, verb } from "./manualAdverbFixtures";
afterEach(() => vi.restoreAllMocks());
async function fixture(automaticSurface = "自動候補") {
	const { owner } = await makeOwner([sentence(adverb("ゆっくり", "助詞類接続"), [bridge, verb]), sentence(adverb("じっくり"))]);
	const authority = build(owner), slot = bind(authority, owner), other = bind(authority, owner, 0, 1);
	const controller = unwrap(createManualAdverbController({ authority, slots: [{ slot, automaticSurface }, { slot: other, automaticSurface: "じっくり" }] }));
	return { owner, authority, slot, other, controller };
}
async function repeatedAnalysis(paths: readonly string[]) {
	const tokens = [...sentence(adverb("ゆっくり")), ...sentence(adverb("じっくり"))];
	const text = tokens.map(item => item.surface).join("");
	const tokenizer = { tokenize: vi.fn(async (input: string) => {
		expect(input).toBe(text); return tokens.map(item => ({ ...item }));
	}) };
	const sources = await Promise.all(paths.map(async sourcePath => {
		const result = await analyzeManualMorphSource({ text, sourcePath, tokenizer });
		if (result.status !== "ready") throw new Error("fixture-analysis"); return result.analysis;
	}));
	expect(tokenizer.tokenize).toHaveBeenCalledTimes(paths.length);
	expect(sources[0]).not.toBe(sources[1]);
	const owner = buildManualMorphVocabulary({ sources, drawMode: "uniform" });
	const owned = readManualMorphVocabularySources(owner)!;
	expect(owned[0]!.runs[0]).not.toBe(owned[1]!.runs[0]);
	return { owner, authority: build(owner) };
}
describe("Manual adverb transactions", () => {
	it.each([[0, 1], [1, 0]])("canonicalizes separately analyzed same-source slots in bind order %i then %i", async (first, second) => {
		const { owner, authority } = await repeatedAnalysis(["same-target.md", "same-target.md"]);
		expect(owner.snapshot.sources).toHaveLength(1);
		const slot = bind(authority, owner, 0, first), duplicate = bind(authority, owner, 0, second);
		expect(duplicate).toBe(slot);
		expect(createManualAdverbController({ authority, slots: [
			{ slot, automaticSurface: slot.originalSurface }, { slot: duplicate, automaticSurface: duplicate.originalSurface },
		] })).toEqual({ ok: false, reason: "invalid-slot" });
		const next = bind(authority, owner, 3, second);
		expect(next).not.toBe(slot);
		expect(bind(authority, owner, 3, first)).toBe(next);
		const controller = unwrap(createManualAdverbController({ authority, slots: [
			{ slot, automaticSurface: slot.originalSurface }, { slot: next, automaticSurface: next.originalSurface },
		] }));
		expect(unwrap(controller.read()).rows).toHaveLength(2);
	});
	it("keeps identical run and token coordinates from different Source paths independent", async () => {
		const { owner, authority } = await repeatedAnalysis(["first-target.md", "second-target.md"]);
		expect(owner.snapshot.sources).toHaveLength(2);
		expect(owner.snapshot.sources[0]!.contentHash).toBe(owner.snapshot.sources[1]!.contentHash);
		const slot = bind(authority, owner), other = bind(authority, owner, 0, 1);
		expect(slot.tokenId).toBe(other.tokenId); expect(other).not.toBe(slot);
		const controller = unwrap(createManualAdverbController({ authority, slots: [
			{ slot, automaticSurface: slot.originalSurface }, { slot: other, automaticSurface: other.originalSurface },
		] }));
		const before = unwrap(controller.read());
		const a = unwrap(controller.prepare({ slot, action: "shuffle", nonce: 1 }));
		const b = unwrap(controller.prepare({ slot: other, action: "restore-original", nonce: 2 }));
		const first = unwrap(controller.complete(a));
		expect(first.rows[0]!.committed.surface).toBe("じっくり"); expect(first.rows[1]).toBe(before.rows[1]);
		const second = unwrap(controller.complete(b));
		expect(second.rows[0]).toBe(first.rows[0]);
		expect(second.rows[1]!.committed.surface).toBe("ゆっくり");
		expect(second.rows.map(row => row.committed.revision)).toEqual([1, 1]);
	});
	it("keeps Shuffle Restore original and Use automatic result distinct", async () => {
		const { controller, slot } = await fixture();
		const first = unwrap(controller.read()), other = first.rows[1];
		for (const [action, mode, surface] of [["shuffle", "manual", null], ["restore-original", "original", "ゆっくり"], ["use-automatic", "automatic", "自動候補"]] as const) {
			const before = unwrap(controller.read());
			const ticket = unwrap(controller.prepare({ slot, action, nonce: 3 }));
			expect(unwrap(controller.read())).toBe(before);
			const after = unwrap(controller.complete(ticket));
			expect(after.rows[0]!.committed.mode).toBe(mode);
			expect(after.rows[0]!.committed.revision).toBe(before.rows[0]!.committed.revision + 1);
			if (surface) expect(after.rows[0]!.committed.surface).toBe(surface);
			expect(after.rows[1]).toBe(other); expect(after.rows[0]!.automaticSurface).toBe("自動候補");
			expect(Object.isFrozen(after.rows[0]!.committed)).toBe(true);
		}
	});
	it("supports explicit Manual with Automatic Adverb OFF and distinguishes equal baselines", async () => {
		const { controller, slot, authority } = await fixture("ゆっくり");
		const ticket = unwrap(controller.prepare({ slot, action: "shuffle", nonce: 7 }));
		const committed = unwrap(controller.complete(ticket)).rows[0]!.committed;
		expect(committed.surface).toBe("じっくり");
		expect(committed.candidate).toBe(authority.candidates.find(candidate => candidate.record.surface === "じっくり"));
		const original = unwrap(controller.complete(unwrap(controller.prepare({ slot, action: "restore-original", nonce: 1 }))));
		const auto = unwrap(controller.complete(unwrap(controller.prepare({ slot, action: "use-automatic", nonce: 1 }))));
		expect(original.rows[0]!.committed).toMatchObject({ mode: "original", surface: "ゆっくり" });
		expect(auto.rows[0]!.committed).toMatchObject({ mode: "automatic", surface: "ゆっくり" });
		// Only the adverb surface is returned: the Target-owned bridge is unchanged.
		expect(`${"じっくり"}${bridge.surface}${verb.surface}`).toBe("じっくりと歩く");
	});
	it("preserves the complete previous state on failure and cancellation", async () => {
		const { owner } = await makeOwner([sentence(adverb("一つ"))]), authority = build(owner), slot = bind(authority, owner);
		const controller = unwrap(createManualAdverbController({ authority, slots: [{ slot, automaticSurface: "一つ" }] }));
		const before = unwrap(controller.read());
		expect(controller.prepare({ slot, action: "shuffle", nonce: 1 })).toEqual({ ok: false, reason: "only-current-surface" });
		expect(unwrap(controller.read())).toBe(before);
		const ticket = unwrap(controller.prepare({ slot, action: "restore-original", nonce: 1 }));
		expect(controller.cancel(ticket)).toEqual({ ok: true, value: true });
		expect(controller.complete(ticket)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(unwrap(controller.read())).toBe(before);
	});
	it("supersedes a pending operation even when the next valid Shuffle fails", async () => {
		const { owner } = await makeOwner([sentence(adverb("一つ"))]), authority = build(owner), slot = bind(authority, owner);
		const controller = unwrap(createManualAdverbController({ authority, slots: [{ slot, automaticSurface: "一つ" }] }));
		const ticket = unwrap(controller.prepare({ slot, action: "restore-original", nonce: 1 }));
		expect(controller.prepare({ slot, action: "shuffle", nonce: 1 }).ok).toBe(false);
		expect(controller.complete(ticket)).toEqual({ ok: false, reason: "invalid-ticket" });
	});
	it("rejects superseded duplicate consumed cloned and foreign tickets", async () => {
		const a = await fixture(), b = await fixture();
		const before = unwrap(a.controller.read());
		const old = unwrap(a.controller.prepare({ slot: a.slot, action: "shuffle", nonce: 1 }));
		const current = unwrap(a.controller.prepare({ slot: a.slot, action: "restore-original", nonce: 2 }));
		for (const ticket of [old, { ...current }, unwrap(b.controller.prepare({ slot: b.slot, action: "shuffle", nonce: 1 }))]) {
			expect(a.controller.preview(ticket)).toEqual({ ok: false, reason: "invalid-ticket" });
			expect(a.controller.complete(ticket)).toEqual({ ok: false, reason: "invalid-ticket" }); expect(unwrap(a.controller.read())).toBe(before);
		}
		const preview = unwrap(a.controller.preview(current));
		expect(Object.isFrozen(preview)).toBe(true); expect(Object.isFrozen(preview.committed)).toBe(true);
		expect(unwrap(a.controller.read())).toBe(before);
		expect(a.controller.complete(current).ok).toBe(true);
		expect(a.controller.preview(current)).toEqual({ ok: false, reason: "invalid-ticket" });
		expect(a.controller.complete(current)).toEqual({ ok: false, reason: "invalid-ticket" });
	});
	it("commits separate slots concurrently without losing another override", async () => {
		const { controller, slot, other } = await fixture();
		const before = unwrap(controller.read());
		const a = unwrap(controller.prepare({ slot, action: "shuffle", nonce: 1 }));
		const b = unwrap(controller.prepare({ slot: other, action: "restore-original", nonce: 2 }));
		const first = unwrap(controller.complete(a)); expect(first.rows[1]).toBe(before.rows[1]);
		const second = unwrap(controller.complete(b)); expect(second.rows[0]).toBe(first.rows[0]);
		expect(second.rows.map(row => row.committed.revision)).toEqual([1, 1]);
	});
	it("changes the caller baseline without overwriting a Manual override", async () => {
		const { controller, slot, other } = await fixture();
		const manual = unwrap(controller.complete(unwrap(controller.prepare({ slot, action: "shuffle", nonce: 1 }))));
		const after = unwrap(controller.setAutomaticBaseline({ slot, surface: "新自動" }));
		expect(after.rows[0]!.committed).toBe(manual.rows[0]!.committed); expect(after.rows[1]).toBe(manual.rows[1]);
		const restored = unwrap(controller.complete(unwrap(controller.prepare({ slot, action: "use-automatic", nonce: 1 }))));
		expect(restored.rows[0]!.committed.surface).toBe("新自動");
		const updated = unwrap(controller.setAutomaticBaseline({ slot: other, surface: "別自動" }));
		expect(updated.rows[1]!.committed.surface).toBe("別自動"); expect(updated.rows[0]).toBe(restored.rows[0]);
	});
	it.each(["source-changed", "refresh", "apply", "view-close", "plugin-disable"] as const)("rejects late commits after %s and releases controller state", async reason => {
		const { controller, slot } = await fixture();
		const ticket = unwrap(controller.prepare({ slot, action: "shuffle", nonce: 1 }));
		expect(controller.release(reason)).toEqual({ ok: true, value: true });
		expect(controller.preview(ticket)).toEqual({ ok: false, reason: "released" });
		expect(controller.complete(ticket)).toEqual({ ok: false, reason: "released" });
		expect(controller.read()).toEqual({ ok: false, reason: "released" });
	});
	it("checks separate Target lifetime before completing staged work", async () => {
		const a = await fixture(), b = await fixture(), slot = bind(a.authority, b.owner);
		const controller = unwrap(createManualAdverbController({ authority: a.authority, slots: [{ slot, automaticSurface: "ゆっくり" }] }));
		const ticket = unwrap(controller.prepare({ slot, action: "shuffle", nonce: 1 }));
		const before = unwrap(controller.read());
		releaseManualAdverbAuthority({ authority: b.authority, reason: "refresh" });
		expect(controller.complete(ticket)).toEqual({ ok: false, reason: "released" });
		expect(unwrap(controller.read())).toBe(before);
	});
	it("rejects repeated slot handles and malformed envelopes without partial construction", async () => {
		const { authority, owner, slot, controller } = await fixture();
		expect(bind(authority, owner)).toBe(slot);
		expect(createManualAdverbController({ authority, slots: [{ slot, automaticSurface: "a" }, { slot: bind(authority, owner), automaticSurface: "b" }] })).toEqual({ ok: false, reason: "invalid-slot" });
		for (const value of [null, {}, { ...slot }, Object.defineProperty({}, "slot", { get: () => { throw new Error("PRIVATE"); } })]) {
			expect(createManualAdverbController(value as never).ok).toBe(false);
			expect(controller.prepare(value as never).ok).toBe(false);
			expect(controller.setAutomaticBaseline(value as never).ok).toBe(false);
			expect(controller.complete(value as never).ok).toBe(false);
		}
	});
	it("rejects reentrant operations from hostile Proxy descriptors", async () => {
		const { controller, slot } = await fixture();
		const input = new Proxy({ slot, action: "restore-original", nonce: 1 }, { ownKeys: target => {
			expect(controller.release("view-close")).toEqual({ ok: false, reason: "busy" }); return Reflect.ownKeys(target);
		} });
		expect(controller.prepare(input as never).ok).toBe(true);
	});
	it("fails closed on revision overflow without publishing a staged row", async () => {
		const { controller, slot } = await fixture();
		const real = guard.increment;
		vi.spyOn(guard, "increment").mockImplementation(() => real(Number.MAX_SAFE_INTEGER));
		const before = unwrap(controller.read());
		expect(controller.prepare({ slot, action: "restore-original", nonce: 1 })).toEqual({ ok: false, reason: "revision-overflow" });
		expect(unwrap(controller.read())).toBe(before);
	});
});
