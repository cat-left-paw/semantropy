import { assertSemantropyValue, isSemantropyValue } from "./semantropyRange";

declare const DICTIONARY_SEMANTROPY_BRAND: unique symbol;

/**
 * The Fake Dictionary value. It is a separate setting from the body value and
 * changing one must never move the other.
 */
export type DictionarySemantropy = number & {
	readonly [DICTIONARY_SEMANTROPY_BRAND]: true;
};

export function isDictionarySemantropy(
	value: unknown,
): value is DictionarySemantropy {
	return isSemantropyValue(value);
}

export function assertDictionarySemantropy(
	value: number,
): DictionarySemantropy {
	return assertSemantropyValue(
		value,
		"dictionarySemantropy",
	) as DictionarySemantropy;
}

/**
 * PRE-RELEASE-EXPERIENCE-DICTIONARY-LEVEL1: Off is not a Fake Dictionary level.
 * A level the reader can choose is 1..100. `isDictionarySemantropy` stays the
 * 0..100 range check the settings parser and Collect validation use, so the
 * saved shape and Collect metadata are unchanged; 0 is only no longer offered,
 * chosen or used.
 */
export function isSelectableDictionarySemantropy(
	value: unknown,
): value is DictionarySemantropy {
	return isDictionarySemantropy(value) && value !== 0;
}

export type DictionarySemantropyPreset = {
	readonly id: string;
	readonly label: string;
	readonly value: DictionarySemantropy;
};

/**
 * The presets the definition modal offers. Separate from the body presets so
 * the two UIs cannot share a type or a label helper.
 */
export const DICTIONARY_SEMANTROPY_PRESETS: readonly DictionarySemantropyPreset[] =
	Object.freeze([
		{ id: "low", label: "Low", value: assertDictionarySemantropy(25) },
		{ id: "medium", label: "Medium", value: assertDictionarySemantropy(50) },
		{ id: "high", label: "High", value: assertDictionarySemantropy(75) },
		{ id: "max", label: "MAX", value: assertDictionarySemantropy(100) },
	]);

export const DEFAULT_DICTIONARY_SEMANTROPY: DictionarySemantropy =
	assertDictionarySemantropy(50);

/**
 * The level actually used. A value that is not selectable — a saved Off, or a
 * value out of range — falls back to the default (Medium) instead of leaving
 * the level control blank or switching the dictionary off. No stored value is
 * rewritten here; this is a fail-safe on read, not a migration.
 */
export function supportedDictionarySemantropy(value: unknown): DictionarySemantropy {
	return isSelectableDictionarySemantropy(value) ? value : DEFAULT_DICTIONARY_SEMANTROPY;
}

/**
 * The label to show for a value. A value between presets keeps its number
 * rather than being rounded to the nearest named stop.
 */
export function dictionarySemantropyLabel(value: DictionarySemantropy): string {
	const preset = DICTIONARY_SEMANTROPY_PRESETS.find(
		(candidate) => candidate.value === value,
	);
	return preset?.label ?? String(value);
}

/**
 * Choices for the Dictionary level control: the presets, plus the current
 * value when it is not one of them, so loading a non-preset value never
 * silently changes it. A value that is not selectable (0) is never added: the
 * control then shows the presets and the caller uses the fail-safe level.
 */
export function dictionarySemantropyChoices(
	current: DictionarySemantropy,
): readonly { value: DictionarySemantropy; label: string }[] {
	const choices = DICTIONARY_SEMANTROPY_PRESETS.map((preset) => ({
		value: preset.value,
		label: preset.label,
	}));
	if (!isSelectableDictionarySemantropy(current) || choices.some((choice) => choice.value === current)) {
		return Object.freeze(choices);
	}
	const withCurrent = [
		...choices,
		{ value: current, label: String(current) },
	];
	withCurrent.sort((left, right) => left.value - right.value);
	return Object.freeze(withCurrent);
}
