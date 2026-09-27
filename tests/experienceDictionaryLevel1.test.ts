import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_DICTIONARY_SEMANTROPY,
	DICTIONARY_SEMANTROPY_PRESETS,
	assertDictionarySemantropy,
	dictionarySemantropyChoices,
	isDictionarySemantropy,
	isSelectableDictionarySemantropy,
	supportedDictionarySemantropy,
} from "../src/settings/dictionarySemantropy";
import { BODY_SEMANTROPY_PRESETS } from "../src/settings/bodySemantropy";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION, parseAutomaticPosSettings, serializeAutomaticPosSettings, validateAutomaticPosSettingsPatch } from "../src/settings/automaticPosSettings";
import { FAKE_DICTIONARY_ALGORITHM_VERSION, generateFakeDefinition } from "../src/dictionary/generateFakeDefinition";
import { STANDARD_TEMPLATE_SET_VERSION } from "../src/dictionary/standardTemplateSet";
import { COLLECT_METADATA_VERSION_V4 } from "../src/collect/v4/CollectedFragmentV4";
import { dictionaryBucketOf } from "../src/dictionary/dictionaryBuckets";

/*
 * PRE-RELEASE-EXPERIENCE-DICTIONARY-LEVEL1: Off is not a Fake Dictionary level.
 * It is neither offered, chosen, saved by a request nor used; a saved Off reads as
 * Medium. The saved shape, Collect metadata and the generation algorithm are
 * unchanged, so no version moves. View-level behaviour (Hover, markers, the level
 * control, the refused transition) is covered in hoverDictionary, tokenAwareView,
 * semantropyViewDefine and experienceControls1.
 */
describe("DICTIONARY-LEVEL1: the level contract", () => {
	it("offers Low, Medium, High and MAX, with Medium as the default", () => {
		expect(DICTIONARY_SEMANTROPY_PRESETS.map(preset => [preset.id, preset.label, preset.value])).toEqual([
			["low", "Low", 25], ["medium", "Medium", 50], ["high", "High", 75], ["max", "MAX", 100],
		]);
		expect(DEFAULT_DICTIONARY_SEMANTROPY).toBe(50);
	});

	it("never re-inserts 0 into the choices, while a non-preset level is still kept", () => {
		const values = (current: number) => dictionarySemantropyChoices(assertDictionarySemantropy(current)).map(choice => choice.value);
		expect(values(0)).toEqual([25, 50, 75, 100]);
		expect(values(50)).toEqual([25, 50, 75, 100]);
		expect(values(37)).toEqual([25, 37, 50, 75, 100]);
		expect(values(1)).toEqual([1, 25, 50, 75, 100]);
	});

	it("selects 1..100 only and falls back to Medium for anything else", () => {
		expect([0, 1, 50, 100].map(value => isSelectableDictionarySemantropy(value))).toEqual([false, true, true, true]);
		expect([-1, 101, 1.5, "50", null].some(value => isSelectableDictionarySemantropy(value))).toBe(false);
		expect([0, -1, 101, "50", null].map(value => supportedDictionarySemantropy(value))).toEqual([50, 50, 50, 50, 50]);
		expect([1, 25, 37, 100].map(value => supportedDictionarySemantropy(value))).toEqual([1, 25, 37, 100]);
		// The range check itself is unchanged: settings parsing and Collect validation still accept 0..100.
		expect(isDictionarySemantropy(0)).toBe(true);
	});

	it("leaves Body Semantropy's Off alone", () => {
		expect(BODY_SEMANTROPY_PRESETS.map(preset => preset.value)).toEqual([0, 25, 50, 75, 100]);
		expect(BODY_SEMANTROPY_PRESETS[0]!.label).toBe("Off");
	});
});

describe("DICTIONARY-LEVEL1: settings — no migration, a fail-safe read, a refused write", () => {
	it("loads a saved Off unchanged (the saved shape is untouched) but reads it as Medium", async () => {
		const stored = serializeAutomaticPosSettings(parseAutomaticPosSettings({ schemaVersion: AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION, dictionarySemantropy: 0, bodySemantropy: 75 }));
		expect(stored.dictionarySemantropy).toBe(0);
		const save = vi.fn(async () => undefined);
		const store = new AutomaticPosSettingsStore({ load: async () => stored, save });
		await store.load();
		expect(store.getSettings().dictionarySemantropy).toBe(0);
		expect(store.getSettings().bodySemantropy).toBe(75);
		expect(store.getDictionarySemantropy()).toBe(50);
		expect(save).not.toHaveBeenCalled();
	});

	it("refuses a request to save Off by every write path, and accepts any selectable level", async () => {
		const save = vi.fn(async () => undefined);
		const store = new AutomaticPosSettingsStore({ load: async () => null, save });
		expect(validateAutomaticPosSettingsPatch({ dictionarySemantropy: 0 })).toBeNull();
		expect(await store.setDictionarySemantropy(assertDictionarySemantropy(0))).toBe(false);
		expect(await store.update({ dictionarySemantropy: 0 })).toBe(false);
		expect(await store.transact({ dictionarySemantropy: 0 }, { current: () => true, publish: () => undefined, commit: () => undefined, rollback: () => undefined })).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(await store.setDictionarySemantropy(assertDictionarySemantropy(75))).toBe(true);
		expect(store.getDictionarySemantropy()).toBe(75);
		expect(save).toHaveBeenCalledTimes(1);
	});
});

describe("DICTIONARY-LEVEL1: versions are unchanged, and the core keeps its defensive Off", () => {
	it("keeps settings schema 4, Collect metadata 4, Fake Dictionary algorithm 1 and template set 1", () => {
		// DICTIONARY-LEVEL1 changed none of these. LOCALE1 moved settings to schema 5. UI-POLISH1 moved them to schema 6. COLLECT-ATTRIBUTION1 moves the live schema to 7.
		expect([AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION, COLLECT_METADATA_VERSION_V4, FAKE_DICTIONARY_ALGORITHM_VERSION, STANDARD_TEMPLATE_SET_VERSION]).toEqual([7, 4, 1, 1]);
	});

	it("still maps 0 to the off bucket and outcome below the settings layer, which nothing above can reach", () => {
		expect(dictionaryBucketOf(0)).toBe("off");
		expect(dictionaryBucketOf(1)).toBe("low");
		expect(generateFakeDefinition({ headword: null as never, pool: null as never, dictionarySeed: 1, dictionarySemantropy: 0 })).toEqual({ outcome: "off" });
	});
});
