import { describe, expect, it } from "vitest";
import {
	runSaveCollectionPath,
	runSaveCollectionPathGuarded,
} from "../src/application/saveCollectionPath";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";
import { BusyGate } from "../src/view/busyGate";

describe("runSaveCollectionPath", () => {
	it("persists a valid Vault-relative Markdown path as typed", async () => {
		const persisted: string[] = [];
		const outcome = await runSaveCollectionPath({
			draft: "Collected/Fragments.md",
			persist: async (value) => {
				persisted.push(value);
				return true;
			},
			isAbandoned: () => false,
		});
		expect(outcome).toBe("saved");
		expect(persisted).toEqual(["Collected/Fragments.md"]);
	});

	it("refuses an invalid path without persisting or rewriting it", async () => {
		const persisted: string[] = [];
		for (const draft of [
			"",
			"   ",
			"/absolute.md",
			"notes/",
			"notes.txt",
			".md",
			"notes/../outside.md",
			"Fragments.md ",
		]) {
			const outcome = await runSaveCollectionPath({
				draft,
				persist: async (value) => {
					persisted.push(value);
					return true;
				},
				isAbandoned: () => false,
			});
			expect(outcome).toBe("invalid");
		}
		expect(persisted).toEqual([]);
	});

	it("does not trim, normalize or complete a draft that is already valid", async () => {
		const persisted: string[] = [];
		const draft = " Collected/Fragments.md";
		const outcome = await runSaveCollectionPath({
			draft,
			persist: async (value) => {
				persisted.push(value);
				return true;
			},
			isAbandoned: () => false,
		});
		expect(outcome).toBe("saved");
		expect(persisted).toEqual([draft]);
		expect(persisted[0]).not.toBe("Collected/Fragments.md");
		expect(persisted[0]).not.toBe(DEFAULT_COLLECTION_PATH);
	});

	it("does not treat a failed persist as saved", async () => {
		const outcome = await runSaveCollectionPath({
			draft: "Collected/Fragments.md",
			persist: async () => false,
			isAbandoned: () => false,
		});
		expect(outcome).toBe("failed");
	});

	it("abandons a finished persist that no longer belongs to the tab", async () => {
		let abandoned = false;
		let finish!: (ok: boolean) => void;
		const persist = new Promise<boolean>((resolve) => {
			finish = resolve;
		});
		const pending = runSaveCollectionPath({
			draft: "Collected/Fragments.md",
			persist: async () => persist,
			isAbandoned: () => abandoned,
		});
		abandoned = true;
		finish(true);
		expect(await pending).toBe("aborted");
	});

	it("does not take Busy for an invalid draft, and refuses a second valid Save", async () => {
		const persisted: string[] = [];
		const busy = new BusyGate();
		const invalid = await runSaveCollectionPathGuarded({
			draft: "notes/",
			persist: async (value) => {
				persisted.push(value);
				return true;
			},
			isAbandoned: () => false,
			busy: {
				acquire: () => busy.acquire(),
				release: (token) => {
					busy.release(token);
				},
			},
		});
		expect(invalid).toBe("invalid");
		expect(busy.isBusy()).toBe(false);

		let finish!: (ok: boolean) => void;
		const persist = new Promise<boolean>((resolve) => {
			finish = resolve;
		});
		const first = runSaveCollectionPathGuarded({
			draft: "Collected/Fragments.md",
			persist: async (value) => {
				persisted.push(value);
				return persist;
			},
			isAbandoned: () => false,
			busy: {
				acquire: () => busy.acquire(),
				release: (token) => {
					busy.release(token);
				},
			},
		});
		const second = runSaveCollectionPathGuarded({
			draft: "Other/Fragments.md",
			persist: async (value) => {
				persisted.push(value);
				return true;
			},
			isAbandoned: () => false,
			busy: {
				acquire: () => busy.acquire(),
				release: (token) => {
					busy.release(token);
				},
			},
		});
		expect(await second).toBe("busy");
		finish(true);
		expect(await first).toBe("saved");
		expect(persisted).toEqual(["Collected/Fragments.md"]);
	});
});
