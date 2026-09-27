import { expect, it, vi } from "vitest";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { ALL, NOUN } from "./automaticPosFixtures";
import { deferred } from "./refreshHarness";

it("repairs a failed compensation before a queued write or a re-enabled store can read disk", async () => {
	let disk: unknown = { schemaVersion: 3 }, current = true;
	const wait = deferred<void>(), entered = deferred<void>();
	const save = vi.fn(async (value: unknown) => { disk = structuredClone(value); });
	const queue = { pending: Promise.resolve() }, persistence = { load: async () => disk, save };
	const store = new AutomaticPosSettingsStore(persistence, queue); await store.load();
	const publication = { current: () => current, publish: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
	const write = save.getMockImplementation()!;
	save.mockImplementationOnce(async data => { await write(data); entered.resolve(); await wait.promise; })
		.mockRejectedValueOnce(Error("compensation unavailable"));
	const result = store.transact({ automaticPos: ALL }, publication); await entered.promise; current = false; wait.resolve();
	expect(await result).toBe(false); expect(store.isRecoveryRequired()).toBe(true);
	expect(store.getSettings().automaticPos).toEqual(NOUN); expect(disk).toMatchObject({ automaticPos: ALL });
	expect(publication.publish).not.toHaveBeenCalled(); expect(publication.rollback).toHaveBeenCalledOnce();
	save.mockRejectedValueOnce(Error("still unavailable"));
	expect(await store.update({ collectionPath: "later.md" })).toBe(false);
	expect(store.isRecoveryRequired()).toBe(true);
	const reopened = new AutomaticPosSettingsStore(persistence, queue); await reopened.load();
	expect(reopened.getSettings().automaticPos).toEqual(NOUN); expect(disk).toMatchObject({ automaticPos: NOUN });
	expect(store.isRecoveryRequired()).toBe(false);
});

it("rolls back a state commit that throws after DOM publication", async () => {
	let disk: unknown = { schemaVersion: 3 }, body = "old";
	const store = new AutomaticPosSettingsStore({ load: async () => disk, save: async value => { disk = value; } }); await store.load();
	expect(await store.transact({ automaticPos: ALL }, { current: () => true, publish: () => { body = "new"; },
		commit: () => { throw Error("private"); }, rollback: () => { body = "old"; } })).toBe(false);
	expect(body).toBe("old"); expect(disk).toMatchObject({ automaticPos: NOUN }); expect(store.getSettings().automaticPos).toEqual(NOUN);
});
