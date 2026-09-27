import { describe, expect, it, vi } from "vitest";
import { SemantropySettingsStore, settingsOperationQueueFor } from "../src/settings/SemantropySettingsStore";
import { MAX, OFF } from "./readyAnalysis";
import { deferred } from "./refreshHarness";
import type { StoredSemantropySettings } from "../src/settings/semantropySettings";

describe("Chunk Text level persistence and commit", () => {
	it("persists before committing display and publishes the effective setting at save success", async () => {
		const events: string[] = [];
		const store = new SemantropySettingsStore({ load: async () => ({}), save: async () => { events.push("save"); } });
		expect(await store.commitBodySemantropy(MAX, () => { expect(store.getBodySemantropy()).toBe(MAX); events.push("commit"); return true; })).toBe("applied");
		expect(events).toEqual(["save", "commit"]); expect(store.getBodySemantropy()).toBe(MAX);
	});
	it("keeps an invalidated save committed and serializes later writes", async () => {
		const writes: StoredSemantropySettings[] = [], gate = deferred<void>();
		const store = new SemantropySettingsStore({ load: async () => ({}), save: async value => { writes.push(value); if (writes.length === 1) await gate.promise; } });
		const first = store.commitBodySemantropy(MAX, () => false);
		const later = store.setBodySemantropy(OFF);
		await Promise.resolve(); expect(writes).toHaveLength(1); gate.resolve();
		expect(await first).toBe("stale"); expect(await later).toBe(true);
		expect(writes.map(w => w.bodySemantropy)).toEqual([MAX, OFF]); expect(store.getBodySemantropy()).toBe(OFF);
	});
	it("does not commit display or effective settings after save failure", async () => {
		const store = new SemantropySettingsStore({ load: async () => ({}), save: async () => { throw Error("disk"); } });
		const previous = store.getSettings(); let called = false;
		expect(await store.commitBodySemantropy(MAX, () => { called = true; return true; })).toBe("failed");
		expect(called).toBe(false); expect(store.getSettings()).toBe(previous);
	});
	it("never attempts a compensating write after saving for a stale owner", async () => {
		let disk: StoredSemantropySettings | null = null, writes = 0;
		const store = new SemantropySettingsStore({ load: async () => ({}), save: async value => {
			if (++writes === 2) throw Error("disk unavailable during compensation");
			disk = value;
		} });
		const previous = store.getSettings();
		expect(await store.commitBodySemantropy(MAX, () => false)).toBe("stale");
		expect(store.getSettings()).toEqual({ ...previous, bodySemantropy: MAX });
		// The independently reproduced second-write failure is unreachable: save once.
		expect(writes).toBe(1);
		expect(disk).toEqual({ ...previous, bodySemantropy: MAX });
	});

	it("keeps disk and effective settings equal if the display callback throws", async () => {
		let disk: StoredSemantropySettings | null = null;
		const store = new SemantropySettingsStore({ load: async () => ({}), save: async value => { disk = value; } });
		expect(await store.commitBodySemantropy(MAX, () => { throw Error("closed display"); })).toBe("stale");
		expect(disk).toEqual(store.getSettings()); expect(store.getBodySemantropy()).toBe(MAX);
	});
	it("waits for saves queued during an earlier save, including failed saves", async () => {
		const first = deferred<void>(), second = deferred<void>(); let writes = 0, settled = false;
		const store = new SemantropySettingsStore({ load: async () => ({}), save: async () => {
			await (++writes === 1 ? first.promise : second.promise);
			if (writes === 2) throw Error("save failed");
		} });
		const saved = store.setBodySemantropy(MAX);
		const pending = store.whenSettled().then(() => { settled = true; });
		const failed = store.setBodySemantropy(OFF);
		first.resolve(); expect(await saved).toBe(true); expect(settled).toBe(false);
		second.resolve(); expect(await failed).toBe(false); await pending;
		expect(settled).toBe(true); expect(store.getBodySemantropy()).toBe(MAX);
	});

	it.each([false, true])("serializes a re-enabled plugin's load behind its predecessor's pending save (failure %s)", async fail => {
		const app = {}, gate = deferred<void>(), entered = deferred<void>();
		let disk: unknown = { schemaVersion: 2, bodySemantropy: MAX }, reads = 0;
		const persistence = { load: async () => { reads++; return disk; }, save: async (data: StoredSemantropySettings) => {
			entered.resolve(); await gate.promise; if (fail) throw Error("save failed"); disk = data;
		} };
		const old = new SemantropySettingsStore(persistence, settingsOperationQueueFor(app)); await old.load();
		const pending = old.commitBodySemantropy(OFF, () => false); await entered.promise;
		// Obsidian may evaluate the bundle again while the old plugin's save is still running.
		vi.resetModules();
		const fresh = await import("../src/settings/SemantropySettingsStore");
		const next = new fresh.SemantropySettingsStore(persistence, fresh.settingsOperationQueueFor(app));
		let loaded = false; const loading = next.load().then(() => { loaded = true; });
		const waiting = next.whenSettled(); await Promise.resolve();
		expect(loaded).toBe(false); expect(reads).toBe(1);
		gate.resolve(); expect(await pending).toBe(fail ? "failed" : "stale"); await loading; await waiting;
		expect(reads).toBe(2); expect(next.getBodySemantropy()).toBe(fail ? MAX : OFF);
		expect(Object.keys(app)).toEqual([]);
		expect(settingsOperationQueueFor({})).not.toBe(settingsOperationQueueFor(app));
	});

});
