import { describe, expect, it } from "vitest";
import {
	DEFAULT_COLLECTION_PATH,
	isCollectionPath,
} from "../src/settings/collectionPath";
import {
	SEMANTROPY_SETTINGS_SCHEMA_VERSION,
	defaultSemantropySettings,
	parseSemantropySettings,
	serializeSemantropySettings,
	type SemantropySettings,
	type StoredSemantropySettings,
} from "../src/settings/semantropySettings";
import { SemantropySettingsStore } from "../src/settings/SemantropySettingsStore";
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

function storeWith(initial: unknown) {
	let stored = initial;
	const store = new SemantropySettingsStore({
		load: async () => stored,
		save: async (data) => {
			stored = data;
		},
	});
	return { store, read: () => stored as StoredSemantropySettings };
}

/** A persistence whose writes are released one at a time, by the test. */
function gatedStore(initial: unknown) {
	let stored = initial;
	const pending: { data: StoredSemantropySettings; release: () => void }[] = [];
	const store = new SemantropySettingsStore({
		load: async () => stored,
		save: (data) =>
			new Promise<void>((resolve) => {
				pending.push({
					data,
					release: () => {
						stored = data;
						resolve();
					},
				});
			}),
	});
	return { store, pending, read: () => stored as StoredSemantropySettings };
}

async function flush(turns = 6): Promise<void> {
	for (let turn = 0; turn < turns; turn += 1) {
		await Promise.resolve();
	}
}

describe("isCollectionPath", () => {
	it("accepts a Vault-relative Markdown path", () => {
		for (const path of [
			DEFAULT_COLLECTION_PATH,
			"Fragments.md",
			"Collected/Semantropy Fragments.md",
			"a/b/c/断片.md",
		]) {
			expect(isCollectionPath(path)).toBe(true);
		}
	});

	it("rejects an empty or whitespace-only path", () => {
		for (const path of ["", " ", "\t", "\n", "   "]) {
			expect(isCollectionPath(path)).toBe(false);
		}
	});

	it("rejects anything that is not a Vault-relative file path", () => {
		for (const path of [
			"/Semantropy Fragments.md",
			"C:\\Vault\\Fragments.md",
			"folder\\Fragments.md",
			"../outside.md",
			"folder/../outside.md",
			"./Fragments.md",
			"folder/./Fragments.md",
			"folder//Fragments.md",
			"folder/Fragments.md/",
			"Fragments\0.md",
		]) {
			expect(isCollectionPath(path)).toBe(false);
		}
	});

	it("requires a real name with a .md extension", () => {
		for (const path of [
			"Fragments",
			"Fragments.txt",
			"Fragments.markdown",
			"Fragments.md.txt",
			".md",
			"folder/.md",
		]) {
			expect(isCollectionPath(path)).toBe(false);
		}
	});

	it("rejects non-string values", () => {
		for (const path of [null, undefined, 1, {}, [], true]) {
			expect(isCollectionPath(path)).toBe(false);
		}
	});

	it("defaults to a note in the Vault root", () => {
		expect(DEFAULT_COLLECTION_PATH).toBe("Semantropy Fragments.md");
		expect(isCollectionPath(DEFAULT_COLLECTION_PATH)).toBe(true);
	});
});

describe("settings schema 1 to 2 migration", () => {
	it("migrates schema 1 and keeps both Semantropy values", () => {
		expect(
			parseSemantropySettings({
				schemaVersion: 1,
				bodySemantropy: 25,
				dictionarySemantropy: 100,
			}),
		).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 100,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
	});

	it("returns each value to its own default when schema 1 stored a bad one", () => {
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
	});

	it("ignores a collection path that a schema 1 payload should not have", () => {
		// Schema 1 never held this key, so whatever is under it was not written
		// by this plugin. A valid-looking one is the dangerous case: adopting it
		// would silently make an unknown legacy field the Collect destination.
		expect(
			parseSemantropySettings({
				schemaVersion: 1,
				bodySemantropy: 25,
				collectionPath: "Unexpected.md",
			}).collectionPath,
		).toBe(DEFAULT_COLLECTION_PATH);

		for (const collectionPath of [
			"Unexpected.md",
			"Collected/Unexpected.md",
			"/absolute.md",
			"",
		]) {
			expect(
				parseSemantropySettings({
					schemaVersion: 1,
					bodySemantropy: 25,
					dictionarySemantropy: 75,
					collectionPath,
				}),
			).toEqual(storedSettings({
				bodySemantropy: 25,
				dictionarySemantropy: 75,
				collectionPath: DEFAULT_COLLECTION_PATH,
			}));
		}
	});

	it("does not let a schema 1 payload's own path reach the store or disk", async () => {
		const { store, read } = storeWith({
			schemaVersion: 1,
			bodySemantropy: 25,
			dictionarySemantropy: 75,
			collectionPath: "Unexpected.md",
		});
		await store.load();

		expect(store.getCollectionPath()).toBe(DEFAULT_COLLECTION_PATH);

		await store.setBodySemantropy(assertBodySemantropy(0));
		expect(read().collectionPath).toBe(DEFAULT_COLLECTION_PATH);
		expect(JSON.stringify(read())).not.toContain("Unexpected.md");
	});

	it("keeps reading a valid path from schema 2, where the key belongs", () => {
		expect(
			parseSemantropySettings({
				schemaVersion: 2,
				bodySemantropy: 25,
				collectionPath: "Unexpected.md",
			}).collectionPath,
		).toBe("Unexpected.md");
	});

	it("reads a schema 2 payload as stored", () => {
		expect(
			parseSemantropySettings(storedSettings({
				bodySemantropy: 0,
				dictionarySemantropy: 37,
				collectionPath: "Collected/Fragments.md",
			})),
		).toEqual(storedSettings({
			bodySemantropy: 0,
			dictionarySemantropy: 37,
			collectionPath: "Collected/Fragments.md",
		}));
	});

	it("falls back per field within schema 2", () => {
		expect(
			parseSemantropySettings({
				schemaVersion: 2,
				bodySemantropy: 75,
				dictionarySemantropy: "high",
				collectionPath: "Collected/Fragments.md",
			}),
		).toEqual(storedSettings({
			bodySemantropy: 75,
			dictionarySemantropy: 50,
			collectionPath: "Collected/Fragments.md",
		}));

		// A bad path costs the path, not the two values the user chose.
		expect(
			parseSemantropySettings(storedSettings({
				bodySemantropy: 75,
				dictionarySemantropy: 25,
				collectionPath: "notes/",
			})),
		).toEqual(storedSettings({
			bodySemantropy: 75,
			dictionarySemantropy: 25,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
	});

	it("reads nothing from an unknown or missing schema", () => {
		for (const raw of [
			{ schemaVersion: 4, bodySemantropy: 0, collectionPath: "Kept.md" },
			{ schemaVersion: 0, bodySemantropy: 0, collectionPath: "Kept.md" },
			{ schemaVersion: "3", bodySemantropy: 0, collectionPath: "Kept.md" },
			{ bodySemantropy: 0, collectionPath: "Kept.md" },
		]) {
			expect(parseSemantropySettings(raw)).toEqual(defaultSemantropySettings());
		}
	});

	it("always reports the current schema version", () => {
		expect(SEMANTROPY_SETTINGS_SCHEMA_VERSION).toBe(3);
		expect(
			parseSemantropySettings({ schemaVersion: 1 }).schemaVersion,
		).toBe(SEMANTROPY_SETTINGS_SCHEMA_VERSION);
	});
});

describe("collection path persistence", () => {
	it("writes exactly the four settings keys", () => {
		const written = serializeSemantropySettings(effectiveSettings({
			bodySemantropy: assertBodySemantropy(25),
			dictionarySemantropy: assertDictionarySemantropy(75),
			collectionPath: "Collected/Fragments.md",
		}));

		expect(Object.keys(written).sort()).toEqual(STORED_KEYS);
	});

	it("never persists a fragment, a Seed, a hash or any metadata", async () => {
		const { store, read } = storeWith(null);
		await store.load();
		await store.setCollectionPath("Collected/Fragments.md");

		const encoded = JSON.stringify(read());
		expect(encoded).not.toMatch(
			/seed|contentHash|token|pool|snapshot|fragment.?text|metadata|created/i,
		);
		expect(encoded).not.toContain("おかき的な自殺");
		expect(encoded).not.toContain("1170956989");
		expect(encoded).not.toContain("a".repeat(64));
	});

	it("migrates a stored schema 1 payload on load and saves schema 2", async () => {
		const { store, read } = storeWith({
			schemaVersion: 1,
			bodySemantropy: 25,
			dictionarySemantropy: 75,
		});
		await store.load();

		expect(store.getBodySemantropy()).toBe(25);
		expect(store.getDictionarySemantropy()).toBe(75);
		expect(store.getCollectionPath()).toBe(DEFAULT_COLLECTION_PATH);

		expect(await store.setCollectionPath("Collected/Fragments.md")).toBe(true);
		expect(read()).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 75,
			collectionPath: "Collected/Fragments.md",
		}));
	});

	it("refuses an invalid path and never writes one", async () => {
		const { store, read } = storeWith(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 75,
			collectionPath: "Collected/Fragments.md",
		}));
		await store.load();

		for (const path of ["", "   ", "/absolute.md", "notes/", "notes.txt"]) {
			expect(await store.setCollectionPath(path)).toBe(false);
		}
		expect(store.getCollectionPath()).toBe("Collected/Fragments.md");
		expect(read().collectionPath).toBe("Collected/Fragments.md");
	});

	it("changing the path leaves both Semantropy values untouched", async () => {
		const { store, read } = storeWith(storedSettings({
			bodySemantropy: 0,
			dictionarySemantropy: 100,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
		await store.load();

		await store.setCollectionPath("Collected/Fragments.md");

		expect(store.getBodySemantropy()).toBe(0);
		expect(store.getDictionarySemantropy()).toBe(100);
		expect(read()).toEqual(storedSettings({
			bodySemantropy: 0,
			dictionarySemantropy: 100,
			collectionPath: "Collected/Fragments.md",
		}));
	});

	it("loses no setting when all three are saved at once", async () => {
		const { store, pending, read } = gatedStore(storedSettings({
			bodySemantropy: 50,
			dictionarySemantropy: 50,
			collectionPath: DEFAULT_COLLECTION_PATH,
		}));
		await store.load();

		const writes = [
			store.setBodySemantropy(assertBodySemantropy(25)),
			store.setDictionarySemantropy(assertDictionarySemantropy(75)),
			store.setCollectionPath("Collected/Fragments.md"),
		];

		for (let index = 0; index < writes.length; index += 1) {
			await flush();
			// One in flight at a time, so none of them can land out of order.
			expect(pending).toHaveLength(index + 1);
			pending[index]?.release();
		}
		expect(await Promise.all(writes)).toEqual([true, true, true]);

		expect(read()).toEqual(storedSettings({
			bodySemantropy: 25,
			dictionarySemantropy: 75,
			collectionPath: "Collected/Fragments.md",
		}));
		expect(read()).toEqual(storedSettings({
			bodySemantropy: store.getBodySemantropy(),
			dictionarySemantropy: store.getDictionarySemantropy(),
			collectionPath: store.getCollectionPath(),
		}));
	});
});
