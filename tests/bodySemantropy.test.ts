import { describe, expect, it } from "vitest";
import {
	BODY_SEMANTROPY_PRESETS,
	DEFAULT_BODY_SEMANTROPY,
	assertBodySemantropy,
	bodySemantropyChoices,
	bodySemantropyLabel,
	isBodySemantropy,
} from "../src/settings/bodySemantropy";
import {
	DEFAULT_DICTIONARY_SEMANTROPY,
	DICTIONARY_SEMANTROPY_PRESETS,
	assertDictionarySemantropy,
	dictionarySemantropyChoices,
	dictionarySemantropyLabel,
	isDictionarySemantropy,
} from "../src/settings/dictionarySemantropy";

describe("BodySemantropy", () => {
	it("names the five presets with their values", () => {
		expect(
			BODY_SEMANTROPY_PRESETS.map((preset) => [preset.label, preset.value]),
		).toEqual([
			["Off", 0],
			["Low", 25],
			["Medium", 50],
			["High", 75],
			["MAX", 100],
		]);
	});

	it("defaults to Medium", () => {
		expect(DEFAULT_BODY_SEMANTROPY).toBe(50);
		expect(bodySemantropyLabel(DEFAULT_BODY_SEMANTROPY)).toBe("Medium");
	});

	it("accepts any integer in range, not only the presets", () => {
		for (const value of [0, 1, 37, 99, 100]) {
			expect(isBodySemantropy(value)).toBe(true);
			expect(assertBodySemantropy(value)).toBe(value);
		}
	});

	it("rejects fractions, negatives, out-of-range, NaN and Infinity", () => {
		for (const value of [
			0.5,
			49.9,
			-1,
			-0.0001,
			101,
			1000,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]) {
			expect(isBodySemantropy(value)).toBe(false);
			expect(() => assertBodySemantropy(value)).toThrow(RangeError);
		}
	});

	it("rejects non-numbers", () => {
		for (const value of ["50", null, undefined, {}, [], true]) {
			expect(isBodySemantropy(value)).toBe(false);
		}
	});

	it("shows a non-preset value as its number rather than a nearby label", () => {
		expect(bodySemantropyLabel(assertBodySemantropy(37))).toBe("37");
	});

	it("offers the presets, plus the current value when it is not one", () => {
		expect(
			bodySemantropyChoices(DEFAULT_BODY_SEMANTROPY).map(
				(choice) => choice.value,
			),
		).toEqual([0, 25, 50, 75, 100]);

		const withCustom = bodySemantropyChoices(assertBodySemantropy(37));
		expect(withCustom.map((choice) => choice.value)).toEqual([
			0, 25, 37, 50, 75, 100,
		]);
		expect(withCustom.find((choice) => choice.value === 37)?.label).toBe("37");
	});
});

describe("DictionarySemantropy", () => {
	it("is validated the same way but stays a separate value", () => {
		expect(DEFAULT_DICTIONARY_SEMANTROPY).toBe(50);
		expect(isDictionarySemantropy(75)).toBe(true);
		expect(isDictionarySemantropy(75.5)).toBe(false);
		expect(() => assertDictionarySemantropy(-1)).toThrow(
			/dictionarySemantropy/,
		);
		expect(() => assertBodySemantropy(-1)).toThrow(/bodySemantropy/);
	});

	it("names the four Dictionary presets without sharing the body helper", () => {
		// PRE-RELEASE-EXPERIENCE-DICTIONARY-LEVEL1: Off is no longer a Fake Dictionary level.
		expect(
			DICTIONARY_SEMANTROPY_PRESETS.map((preset) => [
				preset.label,
				preset.value,
			]),
		).toEqual([
			["Low", 25],
			["Medium", 50],
			["High", 75],
			["MAX", 100],
		]);
		expect(dictionarySemantropyLabel(DEFAULT_DICTIONARY_SEMANTROPY)).toBe(
			"Medium",
		);
		expect(dictionarySemantropyLabel(assertDictionarySemantropy(37))).toBe(
			"37",
		);
		expect(
			dictionarySemantropyChoices(assertDictionarySemantropy(37)).map(
				(choice) => choice.value,
			),
		).toEqual([25, 37, 50, 75, 100]);
	});
});
