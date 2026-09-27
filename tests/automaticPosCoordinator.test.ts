import { expect, it, vi } from "vitest";
import { AutomaticPosCoordinator, type AutomaticViewParticipant } from "../src/application/AutomaticPosCoordinator";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { ALL, NOUN } from "./automaticPosFixtures";
import { deferred } from "./refreshHarness";

function fixture() {
	let disk: unknown = { schemaVersion: 3 };
	const save = vi.fn(async (value: unknown) => { disk = value; });
	const store = new AutomaticPosSettingsStore({ load: async () => disk, save });
	const coordinator = new AutomaticPosCoordinator(store);
	const participant = () => {
		let body = "old", state = "old";
		const prepared = { current: () => true, publish: vi.fn(() => { body = "new"; }),
			commit: vi.fn(() => { state = "new"; }), rollback: vi.fn(() => { body = state = "old"; }), dispose: vi.fn() };
		const claim = { prepare: vi.fn(async () => prepared), release: vi.fn() };
		const view: AutomaticViewParticipant = { claim: () => claim };
		coordinator.register(view);
		return { view, claim, prepared, read: () => ({ body, state }) };
	};
	return { coordinator, store, save, participant, disk: () => disk };
}

it("cannot complete another View's operation or substitute equal option values", async () => {
	const f = fixture(), a = f.participant(), b = f.participant(); await f.store.load();
	expect(await f.coordinator.prepare(a.view, ALL, () => true)).toBe(true);
	expect(await f.coordinator.commit(b.view, ALL, () => true)).toBe(false);
	expect(f.save).not.toHaveBeenCalled();
	expect(await f.coordinator.commit(a.view, ALL, () => true)).toBe(true);
	expect(a.read()).toEqual({ body: "new", state: "new" }); expect(b.read()).toEqual(a.read());
	expect(await f.coordinator.prepare(a.view, NOUN, () => true)).toBe(true);
	expect(await f.coordinator.commit(a.view, { ...NOUN }, () => true)).toBe(false);
	expect(f.store.getSettings().automaticPos).toEqual(ALL);
});

it("supersedes prepared results and refuses reacquisition until an older save is compensated", async () => {
	const f = fixture(), a = f.participant(), b = f.participant(); await f.store.load();
	expect(await f.coordinator.prepare(a.view, ALL, () => true)).toBe(true);
	expect(await f.coordinator.prepare(b.view, NOUN, () => true)).toBe(true);
	expect(a.prepared.dispose).toHaveBeenCalledOnce();
	expect(await f.coordinator.commit(a.view, ALL, () => true)).toBe(false);
	expect(await f.coordinator.commit(b.view, NOUN, () => true)).toBe(true);
	const reached = deferred<void>(), wait = deferred<void>(), write = f.save.getMockImplementation()!;
	f.save.mockImplementationOnce(async data => { await write(data); reached.resolve(); await wait.promise; });
	expect(await f.coordinator.prepare(a.view, ALL, () => true)).toBe(true);
	const pending = f.coordinator.commit(a.view, ALL, () => true); await reached.promise;
	expect(await f.coordinator.prepare(b.view, NOUN, () => true)).toBe(false);
	wait.resolve(); expect(await pending).toBe(false);
	expect(f.disk()).toMatchObject({ automaticPos: NOUN });
	expect(await f.coordinator.prepare(b.view, ALL, () => true)).toBe(true);
	expect(await f.coordinator.commit(b.view, ALL, () => true)).toBe(true);
});

it("rolls back every View when the last session commit throws after all DOM publication", async () => {
	const f = fixture(), a = f.participant(), b = f.participant(); await f.store.load();
	b.prepared.commit.mockImplementationOnce(() => { throw Error("private session failure"); });
	expect(await f.coordinator.prepare(a.view, ALL, () => true)).toBe(true);
	expect(await f.coordinator.commit(a.view, ALL, () => true)).toBe(false);
	for (const v of [a, b]) {
		expect(v.prepared.publish).toHaveBeenCalledOnce(); expect(v.prepared.rollback).toHaveBeenCalledOnce();
		expect(v.read()).toEqual({ body: "old", state: "old" }); expect(v.claim.release).toHaveBeenCalledWith(false);
	}
	expect(f.disk()).toMatchObject({ automaticPos: NOUN });
});
