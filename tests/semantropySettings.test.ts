import { describe, expect, it, vi } from "vitest";
import {
	SEMANTROPY_SETTINGS_SCHEMA_VERSION,
	defaultSemantropySettings,
	parseSemantropySettings,
	serializeSemantropySettings,
} from "../src/settings/semantropySettings";
import type { SemantropySettings, StoredSemantropySettings } from "../src/settings/semantropySettings";
import { SemantropySettingsStore } from "../src/settings/SemantropySettingsStore";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";

/**
 * The exact schema 3 payload, with the display defaults spelled out once. Each
 * test still states every value it cares about; nothing here is a wildcard.
 */
function storedSettings(
	over: Partial<StoredSemantropySettings> = {},
): StoredSemantropySettings {
	return {
		schemaVersion: 3,
		bodySemantropy: 50,
		dictionarySemantropy: 50,
		collectionPath: DEFAULT_COLLECTION_PATH,
		vocabularyDrawMode: "uniform",
		bodyFontFamily: "theme",
		bodyFontSizePx: null,
		bodyBackground: null,
		bodyForeground: null,
		showRuby: true,
		showReplacementMarkers: true,
		showManualMarkers: true,
		showDictionaryMarkers: true,
		dictionaryModifier: "alt",
		...over,
	};
}

/** Every key schema 3 writes, in sorted order. */
const STORED_KEYS = Object.keys(storedSettings()).sort();

/** The same payload as an effective settings value, for the serializer. */
function effectiveSettings(
	over: Partial<StoredSemantropySettings> = {},
): SemantropySettings {
	return storedSettings(over) as SemantropySettings;
}

function memoryPersistence(initial: unknown = null) {
	let stored = initial;
	return {
		saves: [] as StoredSemantropySettings[],
		load: async () => stored,
		save: async function (this: { saves: StoredSemantropySettings[] }, data: StoredSemantropySettings) {
			stored = data;
			this.saves.push(data);
		},
		read: () => stored,
	};
}

function storeWith(initial: unknown = null) {
	const persistence = memoryPersistence(initial);
	const store = new SemantropySettingsStore({
		load: persistence.load,
		save: (data) => persistence.save.call(persistence, data),
	});
	return { store, persistence };
}

describe("parseSemantropySettings", () => {
	it("returns the defaults when nothing is stored", () => {
		expect(parseSemantropySettings(null)).toEqual(storedSettings());
		expect(parseSemantropySettings(undefined)).toEqual(
			defaultSemantropySettings(),
		);
	});

	it("returns the defaults for a non-object payload", () => {
		for (const raw of ["", 7, true, [], [1, 2]]) {
			expect(parseSemantropySettings(raw)).toEqual(
				defaultSemantropySettings(),
			);
		}
	});

	it("falls back per field so one bad value does not lose the other", () => {
		expect(
			parseSemantropySettings({
				schemaVersion: 1,
				bodySemantropy: 999,
				dictionarySemantropy: 75,
			}),
		).toEqual(storedSettings({
			bodySemantropy: 50,
			dictionarySemantropy: 75,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));

		expect(
			parseSemantropySettings({
				schemaVersion: 1,
				bodySemantropy: 25,
				dictionarySemantropy: "high",
			}),
		).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 50,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
	});

	it("rejects fractions, negatives, NaN and Infinity within a supported schema", () => {
		for (const bad of [0.5, -1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				parseSemantropySettings({ schemaVersion: 1, bodySemantropy: bad })
					.bodySemantropy,
			).toBe(50);
		}
	});

	it("keeps a valid non-preset integer exactly as stored", () => {
		expect(
			parseSemantropySettings({ schemaVersion: 1, bodySemantropy: 37 })
				.bodySemantropy,
		).toBe(37);
		expect(
			parseSemantropySettings({ schemaVersion: 1, dictionarySemantropy: 3 })
				.dictionarySemantropy,
		).toBe(3);
	});

	it("drops unknown keys instead of carrying them forward", () => {
		const parsed = parseSemantropySettings({
			schemaVersion: 1,
			bodySemantropy: 25,
			dictionarySemantropy: 75,
			bodySeed: 1170956989,
			dictionarySeed: 4294967295,
			shuffleNonce: 42,
			sourcePath: "folder/note.md",
			contentHash: "hash",
			tokenSequences: [["猫"]],
		});

		expect(Object.keys(parsed).sort()).toEqual(STORED_KEYS);
		expect(JSON.stringify(parsed)).not.toContain("1170956989");
		expect(JSON.stringify(parsed)).not.toContain("4294967295");
		expect(JSON.stringify(parsed)).not.toContain("shuffleNonce");
		expect(parsed).not.toHaveProperty("bodySeed");
		expect(parsed).not.toHaveProperty("dictionarySeed");
		expect(JSON.stringify(parsed)).not.toContain("folder/note.md");
	});

	it("reads nothing from an unsupported schema", () => {
		// A future schema may give these keys different meanings, so the values
		// are not adopted just because they look like numbers in range.
		expect(
			parseSemantropySettings({
				schemaVersion: 99,
				bodySemantropy: 100,
				dictionarySemantropy: 0,
			}),
		).toEqual(defaultSemantropySettings());
	});

	it("reads nothing from a payload with no schema version", () => {
		expect(
			parseSemantropySettings({ bodySemantropy: 100, dictionarySemantropy: 0 }),
		).toEqual(defaultSemantropySettings());
		expect(
			parseSemantropySettings({
				schemaVersion: "1",
				bodySemantropy: 100,
			}),
		).toEqual(defaultSemantropySettings());
	});

	it("always reports the current schema version", () => {
		expect(
			parseSemantropySettings({ schemaVersion: 1, bodySemantropy: 25 })
				.schemaVersion,
		).toBe(SEMANTROPY_SETTINGS_SCHEMA_VERSION);
	});
});

describe("serializeSemantropySettings", () => {
	it("writes exactly the four settings keys and nothing derived from a note", () => {
		const written = serializeSemantropySettings(effectiveSettings({
			bodySemantropy: assertBodySemantropy(25),
			dictionarySemantropy: assertDictionarySemantropy(75),
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));

		expect(written).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 75,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
		const encoded = JSON.stringify(written);
		expect(encoded).not.toMatch(/seed|hash|token|pool|snapshot|source|text/i);
	});
});

describe("SemantropySettingsStore", () => {
	it("starts at the defaults before anything is loaded", () => {
		const { store } = storeWith();
		expect(store.getBodySemantropy()).toBe(50);
		expect(store.getDictionarySemantropy()).toBe(50);
	});

	it("loads stored values and keeps the defaults when data is missing", async () => {
		const { store } = storeWith({ schemaVersion: 1, bodySemantropy: 75 });
		await store.load();
		expect(store.getBodySemantropy()).toBe(75);
		expect(store.getDictionarySemantropy()).toBe(50);
	});

	it("falls back to the defaults when reading throws", async () => {
		const store = new SemantropySettingsStore({
			load: async () => {
				throw new Error("data.json unreadable");
			},
			save: async () => undefined,
		});
		await store.load();
		expect(store.getBodySemantropy()).toBe(50);
	});

	it("changing the body value leaves the dictionary value untouched", async () => {
		const { store, persistence } = storeWith({
			schemaVersion: 1,
			bodySemantropy: 50,
			dictionarySemantropy: 75,
		});
		await store.load();

		expect(await store.setBodySemantropy(assertBodySemantropy(0))).toBe(true);
		expect(store.getBodySemantropy()).toBe(0);
		expect(store.getDictionarySemantropy()).toBe(75);
		expect(persistence.read()).toEqual(storedSettings({
			bodySemantropy: 0,
			dictionarySemantropy: 75,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
	});

	it("changing the dictionary value leaves the body value untouched", async () => {
		const { store, persistence } = storeWith({
			schemaVersion: 1,
			bodySemantropy: 25,
			dictionarySemantropy: 50,
		});
		await store.load();

		expect(
			await store.setDictionarySemantropy(assertDictionarySemantropy(100)),
		).toBe(true);
		expect(store.getBodySemantropy()).toBe(25);
		expect(store.getDictionarySemantropy()).toBe(100);
		expect(persistence.read()).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 100,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
	});

	it("reports a failed write and keeps the value that is actually stored", async () => {
		const save = vi.fn(async () => {
			throw new Error("disk full");
		});
		const store = new SemantropySettingsStore({
			load: async () => ({ schemaVersion: 1, bodySemantropy: 50 }),
			save,
		});
		await store.load();

		expect(await store.setBodySemantropy(assertBodySemantropy(100))).toBe(
			false,
		);
		expect(store.getBodySemantropy()).toBe(50);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("never writes a Seed, body text, hash, tokens or a pool", async () => {
		const { store, persistence } = storeWith();
		await store.load();
		await store.setBodySemantropy(assertBodySemantropy(25));

		const encoded = JSON.stringify(persistence.read());
		expect(Object.keys(persistence.read() as object).sort()).toEqual(STORED_KEYS);
		expect(encoded).not.toMatch(/seed|hash|token|pool|snapshot|source/i);
	});

	it("keeps a non-preset stored value through a load and a save", async () => {
		const { store, persistence } = storeWith({
			schemaVersion: 1,
			bodySemantropy: 37,
			dictionarySemantropy: 3,
		});
		await store.load();
		expect(store.getBodySemantropy()).toBe(37);

		await store.setDictionarySemantropy(assertDictionarySemantropy(9));
		expect(persistence.read()).toEqual(storedSettings({
			bodySemantropy: 37,
			dictionarySemantropy: 9,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
	});
});

/** A persistence whose writes can be released one at a time, out of order. */
function gatedPersistence(initial: unknown) {
	let stored = initial;
	const pending: {
		data: StoredSemantropySettings;
		release: (ok: boolean) => void;
	}[] = [];
	return {
		read: () => stored,
		pending,
		load: async () => stored,
		save: (data: StoredSemantropySettings) =>
			new Promise<void>((resolve, reject) => {
				pending.push({
					data,
					release: (ok) => {
						if (!ok) {
							reject(new Error("disk full"));
							return;
						}
						stored = data;
						resolve();
					},
				});
			}),
	};
}

/** Lets queued microtasks run without touching real time. */
async function flush(turns = 6): Promise<void> {
	for (let turn = 0; turn < turns; turn += 1) {
		await Promise.resolve();
	}
}

describe("SemantropySettingsStore concurrent writes", () => {
	function openStore(initial = {
		schemaVersion: 1,
		bodySemantropy: 50,
		dictionarySemantropy: 50,
	}) {
		const persistence = gatedPersistence(initial);
		const store = new SemantropySettingsStore(persistence);
		return { store, persistence };
	}

	it("hands persistence one write at a time, in request order", async () => {
		const { store, persistence } = openStore();
		await store.load();

		const body = store.setBodySemantropy(assertBodySemantropy(25));
		const dictionary = store.setDictionarySemantropy(
			assertDictionarySemantropy(75),
		);
		await flush();

		// The second write cannot be in flight, so it cannot land out of order.
		expect(persistence.pending).toHaveLength(1);
		expect(persistence.pending[0]?.data).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 50,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));

		persistence.pending[0]?.release(true);
		expect(await body).toBe(true);
		await flush();

		// The queued write is built from what the first one actually committed.
		expect(persistence.pending).toHaveLength(2);
		expect(persistence.pending[1]?.data).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 75,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
		persistence.pending[1]?.release(true);
		expect(await dictionary).toBe(true);
	});

	it("leaves disk and memory in the same state after concurrent writes", async () => {
		const { store, persistence } = openStore();
		await store.load();

		const body = store.setBodySemantropy(assertBodySemantropy(25));
		const dictionary = store.setDictionarySemantropy(
			assertDictionarySemantropy(75),
		);

		await flush();
		persistence.pending[0]?.release(true);
		await flush();
		persistence.pending[1]?.release(true);
		expect(await Promise.all([body, dictionary])).toEqual([true, true]);

		// Neither setting was dropped, and nothing on disk is older than memory.
		expect(persistence.read()).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 75,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
		expect(persistence.read()).toEqual(storedSettings({
			bodySemantropy: store.getBodySemantropy(),
			dictionarySemantropy: store.getDictionarySemantropy(),
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
	});

	it("does not let a failed write roll back a later successful one", async () => {
		const { store, persistence } = openStore();
		await store.load();

		const failing = store.setBodySemantropy(assertBodySemantropy(0));
		const succeeding = store.setBodySemantropy(assertBodySemantropy(100));

		await flush();
		persistence.pending[0]?.release(false);
		expect(await failing).toBe(false);
		await flush();
		persistence.pending[1]?.release(true);
		expect(await succeeding).toBe(true);

		expect(store.getBodySemantropy()).toBe(100);
		expect(persistence.read()).toEqual(storedSettings({
			bodySemantropy: 100,
			dictionarySemantropy: 50,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
	});

	it("builds a write that follows a failure from the last committed state", async () => {
		const { store, persistence } = openStore();
		await store.load();

		const failing = store.setBodySemantropy(assertBodySemantropy(0));
		const dictionary = store.setDictionarySemantropy(
			assertDictionarySemantropy(25),
		);

		await flush();
		persistence.pending[0]?.release(false);
		expect(await failing).toBe(false);
		await flush();

		// The body value never reached disk, so it must not appear here.
		expect(persistence.pending[1]?.data).toEqual(storedSettings({
			bodySemantropy: 50,
			dictionarySemantropy: 25,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
		persistence.pending[1]?.release(true);
		expect(await dictionary).toBe(true);
		expect(store.getBodySemantropy()).toBe(50);
	});

	it("orders a load behind the writes already queued", async () => {
		const { store, persistence } = openStore();
		await store.load();

		const body = store.setBodySemantropy(assertBodySemantropy(75));
		const reload = store.load();

		await flush();
		persistence.pending[0]?.release(true);
		expect(await body).toBe(true);
		await reload;

		expect(store.getBodySemantropy()).toBe(75);
	});

	it("never reports a value the disk does not hold", async () => {
		const { store, persistence } = openStore();
		await store.load();

		const pendingWrite = store.setBodySemantropy(assertBodySemantropy(100));
		await flush();
		// In flight, not committed: readers still see what is stored.
		expect(store.getBodySemantropy()).toBe(50);

		persistence.pending[0]?.release(true);
		expect(await pendingWrite).toBe(true);
		expect(store.getBodySemantropy()).toBe(100);
	});
});
