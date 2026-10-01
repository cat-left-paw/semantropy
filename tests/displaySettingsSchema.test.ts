import { describe, expect, it } from "vitest";
import {
	SEMANTROPY_SETTINGS_SCHEMA_VERSION,
	defaultSemantropySettings,
	parseSemantropySettings,
	serializeSemantropySettings,
	type SemantropySettings,
	type StoredSemantropySettings,
} from "../src/settings/semantropySettings";
import {
	BODY_CONTRAST_WARNING,
	bodyContrastWarning,
	defaultSemantropyDisplaySettings,
	normalizeBodyColor,
	validateDisplaySettingsPatch,
} from "../src/settings/displaySettings";
import { SemantropySettingsStore } from "../src/settings/SemantropySettingsStore";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";

function settings(over: Partial<StoredSemantropySettings> = {}): StoredSemantropySettings {
	return { ...serializeSemantropySettings(defaultSemantropySettings()), ...over };
}

function storeWith(initial: unknown) {
	let stored = initial;
	const saves: StoredSemantropySettings[] = [];
	let fail = false;
	const store = new SemantropySettingsStore({
		load: async () => stored,
		save: async (data) => {
			if (fail) throw new Error("disk full");
			saves.push(data);
			stored = data;
		},
	});
	return {
		store,
		saves,
		read: () => stored as StoredSemantropySettings,
		failWrites: (value: boolean) => {
			fail = value;
		},
	};
}

/** Every key schema 3 writes. */
const SCHEMA_3_KEYS = [
	"bodyBackground",
	"bodyFontFamily",
	"bodyFontSizePx",
	"bodyForeground",
	"bodySemantropy",
	"collectionPath",
	"dictionaryModifier",
	"dictionarySemantropy",
	"schemaVersion",
	"showDictionaryMarkers",
	"showManualMarkers",
	"showReplacementMarkers",
	"showRuby",
	"vocabularyDrawMode",
];

describe("TOOLBAR1 settings schema 3 migration", () => {
	it("is schema 3 with the approved defaults", () => {
		expect(SEMANTROPY_SETTINGS_SCHEMA_VERSION).toBe(3);
		expect(defaultSemantropyDisplaySettings()).toEqual({
			vocabularyDrawMode: "uniform",
			bodyFontFamily: "theme",
			bodyFontSizePx: null,
			// 0.1.0 S2: the display defaults carry the theme; schema 3 itself still never stores it.
			bodyTheme: "default",
			bodyBackground: null,
			bodyForeground: null,
			showRuby: true,
			showReplacementMarkers: true,
			showManualMarkers: true,
			showDictionaryMarkers: true,
			dictionaryModifier: "alt",
		});
	});

	it("migrates schema 1: both Semantropy values kept, path and display defaulted", () => {
		expect(
			parseSemantropySettings({
				schemaVersion: 1,
				bodySemantropy: 37,
				dictionarySemantropy: 3,
				// Schema 1 never wrote either of these, so neither is adopted.
				collectionPath: "Kept.md",
				bodyFontFamily: "serif",
			}),
		).toEqual(settings({ bodySemantropy: 37, dictionarySemantropy: 3 }));
	});

	it("migrates schema 2: the three stored values kept, display defaulted", () => {
		expect(
			parseSemantropySettings({
				schemaVersion: 2,
				bodySemantropy: 25,
				dictionarySemantropy: 75,
				collectionPath: "Collected/Fragments.md",
				// Schema 2 never wrote a display field.
				showRuby: false,
				bodyFontSizePx: 20,
			}),
		).toEqual(
			settings({
				bodySemantropy: 25,
				dictionarySemantropy: 75,
				collectionPath: "Collected/Fragments.md",
			}),
		);
	});

	it("reads a valid schema 3 payload exactly as stored", () => {
		const stored = settings({
			bodySemantropy: 75,
			dictionarySemantropy: 25,
			collectionPath: "Collected/Fragments.md",
			vocabularyDrawMode: "frequency",
			bodyFontFamily: "sans-serif",
			bodyFontSizePx: 18,
			bodyBackground: "#101214",
			bodyForeground: "#e8e6e3",
			showRuby: false,
			showReplacementMarkers: false,
			showManualMarkers: true,
			showDictionaryMarkers: false,
			dictionaryModifier: "shift",
		});
		expect(parseSemantropySettings(stored)).toEqual(stored);
	});

	it.each([
		["vocabularyDrawMode", "rare", "uniform"],
		["bodyFontFamily", "Comic", "theme"],
		["bodyFontSizePx", 11, null],
		["bodyFontSizePx", 33, null],
		["bodyFontSizePx", 16.5, null],
		["bodyFontSizePx", "18", null],
		["bodyBackground", "red", null],
		["bodyBackground", "#12345", null],
		["bodyBackground", "var(--x)", null],
		["bodyForeground", 16777215, null],
		["showRuby", "true", true],
		["showReplacementMarkers", 1, true],
		["dictionaryModifier", "ctrl", "alt"],
	])("falls back per field: %s = %j", (key, bad, fallback) => {
		const parsed = parseSemantropySettings({
			...settings({ bodySemantropy: 25, dictionarySemantropy: 75 }),
			[key]: bad,
		});
		expect(parsed[key as keyof SemantropySettings]).toEqual(fallback);
		// One bad field never costs a sibling.
		expect(parsed.bodySemantropy).toBe(25);
		expect(parsed.dictionarySemantropy).toBe(75);
	});

	it("normalizes an accepted colour and refuses everything else", () => {
		expect(normalizeBodyColor("#AABBCC")).toBe("#aabbcc");
		expect(normalizeBodyColor(" #abc ")).toBe("#aabbcc");
		expect(normalizeBodyColor(null)).toBeNull();
		for (const bad of ["", "#", "#12", "#1234567", "rgb(0,0,0)", "black", 0, {}]) {
			expect(normalizeBodyColor(bad)).toBeUndefined();
		}
	});

	it("reads nothing from an unknown or missing schema version", () => {
		for (const raw of [
			{ schemaVersion: 4, bodySemantropy: 0, bodyFontFamily: "serif" },
			{ schemaVersion: 0, bodySemantropy: 0 },
			{ schemaVersion: "3", bodySemantropy: 0 },
			{ bodySemantropy: 0 },
			[],
			"3",
			null,
		]) {
			expect(parseSemantropySettings(raw)).toEqual(defaultSemantropySettings());
		}
	});

	it("drops unknown keys instead of carrying them forward", () => {
		const parsed = parseSemantropySettings({
			...settings({ bodySemantropy: 25 }),
			sourcePaths: ["folder/note.md"],
			vocabularySnapshot: { fingerprint: "abc" },
			tokenSequences: [["猫"]],
			shuffleNonce: 1170956989,
			manualOverrides: [{ tokenId: "c0/r0/t0" }],
			selectionCache: { start: 0, end: 4, text: "猫と犬。" },
			hoverCache: {},
		});
		expect(Object.keys(parsed).sort()).toEqual(SCHEMA_3_KEYS);
		const encoded = JSON.stringify(serializeSemantropySettings(parsed));
		expect(encoded).not.toMatch(
			/nonce|snapshot|token|pool|override|selection|hover|fingerprint|folder\/note/i,
		);
	});

	it("serializes exactly the schema 3 shape and key set", () => {
		const written = serializeSemantropySettings(
			parseSemantropySettings(settings({ bodyFontSizePx: 20 })),
		);
		expect(Object.keys(written).sort()).toEqual(SCHEMA_3_KEYS);
		expect(written.schemaVersion).toBe(3);
		expect(written.bodyFontSizePx).toBe(20);
		expect(JSON.stringify(written)).not.toMatch(
			/seed|hash|contentHash|pool|snapshot|sourcePath|text/i,
		);
	});

	it("refuses an invalid or unknown patch outright rather than correcting it", () => {
		expect(validateDisplaySettingsPatch({ bodyFontSizePx: 40 })).toBeNull();
		expect(validateDisplaySettingsPatch({ bodyBackground: "salmon" })).toBeNull();
		expect(
			validateDisplaySettingsPatch({ sourcePath: "note.md" } as never),
		).toBeNull();
		expect(validateDisplaySettingsPatch({ bodyBackground: "#ABC" })).toEqual({
			bodyBackground: "#aabbcc",
		});
	});

	it("warns on low contrast only when both colours are explicit", () => {
		expect(bodyContrastWarning({ bodyBackground: "#ffffff", bodyForeground: "#fefefe" })).toBe(
			BODY_CONTRAST_WARNING,
		);
		expect(
			bodyContrastWarning({ bodyBackground: "#ffffff", bodyForeground: "#1a1a1a" }),
		).toBeNull();
		expect(bodyContrastWarning({ bodyBackground: null, bodyForeground: "#fefefe" })).toBeNull();
		expect(BODY_CONTRAST_WARNING).not.toMatch(/#|rgb/);
	});
});

describe("TOOLBAR1 display settings persistence", () => {
	it("writes one display setting without disturbing the others", async () => {
		const { store, read } = storeWith(settings({ bodySemantropy: 25 }));
		await store.load();

		expect(await store.setDisplaySettings({ bodyFontSizePx: 18 })).toBe(true);
		expect(read()).toEqual(settings({ bodySemantropy: 25, bodyFontSizePx: 18 }));
		expect(store.getDisplaySettings().bodyFontSizePx).toBe(18);
		expect(store.getBodySemantropy()).toBe(25);
	});

	it("refuses an invalid change without writing anything", async () => {
		const { store, saves, read } = storeWith(settings());
		await store.load();

		expect(await store.setDisplaySettings({ bodyFontSizePx: 99 })).toBe(false);
		expect(await store.setDisplaySettings({ bodyBackground: "papayawhip" })).toBe(false);
		expect(saves).toEqual([]);
		expect(read()).toEqual(settings());
		expect(store.getDisplaySettings()).toEqual(defaultSemantropyDisplaySettings());
	});

	it("keeps the previous value when the write fails", async () => {
		const { store, failWrites } = storeWith(settings({ showRuby: true }));
		await store.load();
		failWrites(true);

		expect(await store.setDisplaySettings({ showRuby: false })).toBe(false);
		expect(store.getDisplaySettings().showRuby).toBe(true);

		failWrites(false);
		expect(await store.setDisplaySettings({ showRuby: false })).toBe(true);
		expect(store.getDisplaySettings().showRuby).toBe(false);
	});

	it("never persists a Source, Snapshot, token, nonce or selection through a display write", async () => {
		const { store, read } = storeWith(null);
		await store.load();
		await store.setDisplaySettings({
			bodyBackground: "#101214",
			bodyForeground: "#e8e6e3",
			bodyFontFamily: "serif",
		});

		expect(Object.keys(read()).sort()).toEqual(SCHEMA_3_KEYS);
		expect(JSON.stringify(read())).not.toMatch(
			/seed|nonce|snapshot|token|pool|override|selection|hover|sourcePath|contentHash/i,
		);
	});

	it("composes a display write with a concurrent Semantropy write", async () => {
		const { store, read } = storeWith(settings());
		await store.load();

		const [display, level] = await Promise.all([
			store.setDisplaySettings({ vocabularyDrawMode: "frequency" }),
			store.setBodySemantropy(0 as SemantropySettings["bodySemantropy"]),
		]);

		expect([display, level]).toEqual([true, true]);
		expect(read()).toEqual(
			settings({ vocabularyDrawMode: "frequency", bodySemantropy: 0 }),
		);
		expect(store.getDisplaySettings().vocabularyDrawMode).toBe("frequency");
	});

	it("keeps the Collection path's explicit Save contract untouched by display writes", async () => {
		const { store, saves, read } = storeWith(settings());
		await store.load();

		// A display write does not adopt a Collection path draft.
		await store.setDisplaySettings({ showManualMarkers: false });
		expect(read().collectionPath).toBe(DEFAULT_COLLECTION_PATH);

		expect(await store.setCollectionPath("notes/")).toBe(false);
		expect(saves).toHaveLength(1);
		expect(await store.setCollectionPath("Collected/Fragments.md")).toBe(true);
		expect(read()).toEqual(
			settings({ showManualMarkers: false, collectionPath: "Collected/Fragments.md" }),
		);
	});

	it("survives a plugin disable and re-enable through the stored payload alone", async () => {
		const first = storeWith(settings());
		await first.store.load();
		await first.store.setDisplaySettings({
			bodyFontFamily: "serif",
			bodyFontSizePx: 20,
			showRuby: false,
		});

		// A fresh store is what a re-enabled plugin builds; it reads disk only.
		const second = new SemantropySettingsStore({
			load: async () => first.read(),
			save: async () => undefined,
		});
		await second.load();
		expect(second.getDisplaySettings()).toEqual({
			...defaultSemantropyDisplaySettings(),
			bodyFontFamily: "serif",
			bodyFontSizePx: 20,
			showRuby: false,
		});
	});
});
