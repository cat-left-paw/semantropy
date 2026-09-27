import { describe, expect, it, vi } from "vitest";
import { AUTOMATIC_POS_KEYS, AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION, DEFAULT_AUTOMATIC_POS, DEFAULT_COLLECT_ATTRIBUTION, defaultAutomaticPosSettings,
	parseAutomaticPosSettings, serializeAutomaticPosSettings, validateAutomaticPosOptions } from "../src/settings/automaticPosSettings";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { defaultSemantropySettings, parseSemantropySettings, serializeSemantropySettings, SEMANTROPY_SETTINGS_SCHEMA_VERSION } from "../src/settings/semantropySettings";

export const allOff = Object.freeze({ noun: false, verb: false, iAdjective: false, adverb: false });
const allOn = { noun: true, verb: true, iAdjective: true, adverb: true };
const customized = { bodySemantropy: 37, dictionarySemantropy: 9, collectionPath: "Collected/Fragments.md",
	vocabularyDrawMode: "frequency", bodyFontFamily: "serif", bodyFontSizePx: 23,
	bodyBackground: "#123456", bodyForeground: "#abcdef", showRuby: false,
	showReplacementMarkers: false, showManualMarkers: false, showDictionaryMarkers: false, dictionaryModifier: "shift",
	// LOCALE1: a schema 5 field; every older schema ignores it.
	uiLanguage: "en" };
const secrets = { seed: 123, nonce: 456, token: "secret", pool: ["word"], snapshot: {}, sourceSelection: ["private.md"], draft: allOn, manualOverrides: ["reading"] };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

// LOCALE1 added schema 5 (`uiLanguage`). UI-POLISH1 added schema 6 (`showRibbonIcon`).
// COLLECT-ATTRIBUTION1: the live contract is schema 7, schema 6 plus `collectAttribution`.
describe("disconnected schema 4", () => {
	it("defaults to nouns only without changing production schema 3", () => {
		expect(AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION).toBe(7);
		expect(DEFAULT_AUTOMATIC_POS).toEqual({ noun: true, verb: false, iAdjective: false, adverb: false });
		expect(SEMANTROPY_SETTINGS_SCHEMA_VERSION).toBe(3);
		expect(parseSemantropySettings({ schemaVersion: 4, ...customized })).toEqual(defaultSemantropySettings());
		expect(serializeSemantropySettings(defaultSemantropySettings())).not.toHaveProperty("automaticPos");
	});
	it.each([1, 2, 3])("migrates schema %s only from fields that schema owned", version => {
		const migrated = parseAutomaticPosSettings({ schemaVersion: version, ...customized, automaticPos: allOn });
		const legacy = parseSemantropySettings({ schemaVersion: version, ...customized });
		expect(migrated).toEqual({ ...legacy, schemaVersion: 7, automaticPos: DEFAULT_AUTOMATIC_POS, uiLanguage: "en", showRibbonIcon: true, collectAttribution: DEFAULT_COLLECT_ATTRIBUTION });
		expect(migrated.bodySemantropy).toBe(37); expect(migrated.dictionarySemantropy).toBe(9);
		expect(migrated.collectionPath).toBe(version === 1 ? defaultSemantropySettings().collectionPath : customized.collectionPath);
		expect(migrated.showRuby).toBe(version < 3); expect(migrated.automaticPos.verb).toBe(false);
	});
	it("ignores future options in schema 3", () => {
		expect(parseAutomaticPosSettings({ schemaVersion: 3, automaticPos: allOn }).automaticPos).toEqual(DEFAULT_AUTOMATIC_POS);
	});
	it("retains all OFF on save and restore", () => {
		const value = parseAutomaticPosSettings({ schemaVersion: 4, automaticPos: allOff });
		expect(serializeAutomaticPosSettings(value).automaticPos).toEqual(allOff);
		expect(parseAutomaticPosSettings(serializeAutomaticPosSettings(value)).automaticPos).toEqual(allOff);
	});
	it.each(Array.from({ length: 16 }, (_, mask) => mask))("canonical round trip for options %s", mask => {
		const options = { noun: !!(mask & 1), verb: !!(mask & 2), iAdjective: !!(mask & 4), adverb: !!(mask & 8) };
		const value = parseAutomaticPosSettings({ schemaVersion: 5, ...customized, automaticPos: options });
		const written = serializeAutomaticPosSettings(value);
		expect(written).toEqual({ schemaVersion: 7, ...customized, automaticPos: options, showRibbonIcon: true, collectAttribution: DEFAULT_COLLECT_ATTRIBUTION });
		expect(parseAutomaticPosSettings(written)).toEqual(value);
		expect(Object.keys(written.automaticPos)).toEqual([...AUTOMATIC_POS_KEYS]);
		expect(Object.keys(written)).toEqual([...Object.keys(serializeSemantropySettings(defaultSemantropySettings())), "automaticPos", "uiLanguage", "showRibbonIcon", "collectAttribution"]);
	});
	it.each(AUTOMATIC_POS_KEYS)("validates %s independently without truthy coercion", key => {
		for (const bad of ["false", "true", 0, 1, null, undefined, {}, []]) {
			const parsed = parseAutomaticPosSettings({ schemaVersion: 4, ...customized, automaticPos: { ...allOn, [key]: bad } });
			expect(parsed.automaticPos).toEqual({ ...allOn, [key]: DEFAULT_AUTOMATIC_POS[key] });
			expect(parsed.bodySemantropy).toBe(37);
		}
	});
	it("defaults all fields for unknown or missing schema", () => {
		for (const schemaVersion of [undefined, 0, 8, "4", "5", "6", null, NaN]) {
			expect(parseAutomaticPosSettings({ schemaVersion, ...customized, automaticPos: allOff })).toEqual(defaultAutomaticPosSettings());
		}
	});
	it("drops unknown and secret fields even at the serializer boundary", () => {
		const input = { ...defaultAutomaticPosSettings(), ...secrets, automaticPos: { ...allOff, ...secrets } };
		const output = serializeAutomaticPosSettings(input);
		expect(Object.keys(output)).toEqual([...Object.keys(defaultSemantropySettings()), "automaticPos", "uiLanguage", "showRibbonIcon", "collectAttribution"]);
		expect(output.automaticPos).toEqual(allOff);
		expect(JSON.stringify(output)).not.toMatch(/seed|nonce|token|pool|snapshot|sourceSelection|draft|manualOverrides|private|reading|secret/u);
	});
	it("does not invoke accessors or adopt prototype fields and confines throwing Proxies", () => {
		const getter = vi.fn(() => true);
		const flags = { ...allOff }; Object.defineProperty(flags, "verb", { get: getter });
		const raw = { schemaVersion: 4, bodySemantropy: 37, automaticPos: flags };
		expect(parseAutomaticPosSettings(raw).automaticPos).toEqual(allOff); expect(getter).not.toHaveBeenCalled();
		expect(parseAutomaticPosSettings(Object.create(raw))).toEqual(defaultAutomaticPosSettings());
		for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"]) {
			const value = new Proxy(raw, { [trap]: () => { throw new Error("private path"); } });
			expect(parseAutomaticPosSettings(value)).toEqual(defaultAutomaticPosSettings());
		}
		const copied = parseAutomaticPosSettings(new Proxy(raw, {}));
		raw.bodySemantropy = 0; expect(copied.bodySemantropy).toBe(37);
	});
	it("freezes both levels without freezing caller input", () => {
		const input = { schemaVersion: 4, automaticPos: { ...allOff } };
		const parsed = parseAutomaticPosSettings(input), output = serializeAutomaticPosSettings(parsed);
		for (const value of [parsed, parsed.automaticPos, output, output.automaticPos]) expect(Object.isFrozen(value)).toBe(true);
		expect(Object.isFrozen(input.automaticPos)).toBe(false);
	});
});

describe("schema 4 store", () => {
	it("rejects invalid requests without persistence", async () => {
		const save = vi.fn(async () => undefined), store = new AutomaticPosSettingsStore({ load: async () => null, save });
		for (const patch of [null, [], { unknown: 1 }, { bodySemantropy: "50" }, { dictionarySemantropy: 101 },
			{ collectionPath: "../x.md" }, { showRuby: 1 }, { automaticPos: { ...allOff, verb: "false" } },
			{ automaticPos: { ...allOff, secret: true } }, { automaticPos: { noun: true } },
			Object.defineProperty({}, "bodySemantropy", { get: () => 100 })]) {
			expect(await store.update(patch)).toBe(false);
		}
		expect(save).not.toHaveBeenCalled(); expect(store.getSettings()).toEqual(defaultAutomaticPosSettings());
		expect(validateAutomaticPosOptions(Object.defineProperty({ ...allOff }, "secret", { get: () => 1 }))).toBeNull();
	});
	it("commits effective settings only after persistence success", async () => {
		const gate = deferred(), save = vi.fn(async () => gate.promise);
		const store = new AutomaticPosSettingsStore({ load: async () => null, save }), previous = store.getSettings();
		const request = store.update({ automaticPos: allOff }); await flush();
		expect(save).toHaveBeenCalledTimes(1); expect(store.getSettings()).toBe(previous);
		gate.resolve(); expect(await request).toBe(true); expect(store.getSettings().automaticPos).toEqual(allOff);
	});
	it("keeps effective reference on persistence failure and recovers", async () => {
		const save = vi.fn().mockRejectedValueOnce(new Error("private path")).mockResolvedValue(undefined);
		const store = new AutomaticPosSettingsStore({ load: async () => null, save }), previous = store.getSettings();
		expect(await store.update({ automaticPos: allOff })).toBe(false); expect(store.getSettings()).toBe(previous);
		expect(await store.update({ automaticPos: allOff })).toBe(true);
	});
	it("composes queued fields from the last committed base", async () => {
		const first = deferred(), values: unknown[] = [];
		const store = new AutomaticPosSettingsStore({ load: async () => null, save: async value => { values.push(value); if (values.length === 1) await first.promise; } });
		const options = store.update({ automaticPos: allOff }), body = store.update({ bodySemantropy: 37 }), display = store.update({ showRuby: false });
		await flush(); expect(values).toHaveLength(1); first.resolve();
		expect(await Promise.all([options, body, display])).toEqual([true, true, true]);
		expect(store.getSettings()).toEqual({ ...defaultAutomaticPosSettings(), automaticPos: allOff, bodySemantropy: 37, showRuby: false });
		expect(values[2]).toEqual(store.getSettings());
	});
	it("copies queued input and retains successful fields across failed writes", async () => {
		const patch = { automaticPos: { noun: false, verb: false, iAdjective: false, adverb: false } }, gate = deferred(); let calls = 0;
		const store = new AutomaticPosSettingsStore({ load: async () => null, save: async () => { if (++calls === 1) await gate.promise; if (calls === 2) throw Error("failed"); } });
		const first = store.update(patch), second = store.update({ bodySemantropy: 100 }), third = store.update({ dictionarySemantropy: 9 });
		patch.automaticPos.noun = true; gate.resolve(); expect(await Promise.all([first, second, third])).toEqual([true, false, true]);
		expect(store.getSettings().automaticPos).toEqual(allOff); expect(store.getSettings().bodySemantropy).toBe(50); expect(store.getSettings().dictionarySemantropy).toBe(9);
	});
	it("loads defaults on failure and exposes no mutable internal state", async () => {
		const store = new AutomaticPosSettingsStore({ load: async () => { throw Error("private"); }, save: async () => undefined });
		expect(await store.load()).toEqual(defaultAutomaticPosSettings());
		expect(() => { (store.getSettings().automaticPos as { noun: boolean }).noun = false; }).toThrow();
		await store.whenSettled();
	});
});
