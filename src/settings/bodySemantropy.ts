import { assertSemantropyValue, isSemantropyValue } from "./semantropyRange";

declare const BODY_SEMANTROPY_BRAND: unique symbol;

/**
 * How much of the body transformation to apply, as an integer 0..100.
 *
 * Branded so it cannot be swapped with the Fake Dictionary value: the two are
 * independent settings and must never be conflated, now or when a second
 * feature starts reading its own.
 */
export type BodySemantropy = number & {
	readonly [BODY_SEMANTROPY_BRAND]: true;
};

export function isBodySemantropy(value: unknown): value is BodySemantropy {
	return isSemantropyValue(value);
}

export function assertBodySemantropy(value: number): BodySemantropy {
	return assertSemantropyValue(value, "bodySemantropy") as BodySemantropy;
}

export type BodySemantropyPreset = {
	readonly id: string;
	readonly label: string;
	readonly value: BodySemantropy;
};

/**
 * The presets the view offers. The core accepts any integer in range, so a
 * future slider needs no change here; these are only the named stops.
 */
export const BODY_SEMANTROPY_PRESETS: readonly BodySemantropyPreset[] =
	Object.freeze([
		{ id: "off", label: "Off", value: assertBodySemantropy(0) },
		{ id: "low", label: "Low", value: assertBodySemantropy(25) },
		{ id: "medium", label: "Medium", value: assertBodySemantropy(50) },
		{ id: "high", label: "High", value: assertBodySemantropy(75) },
		{ id: "max", label: "MAX", value: assertBodySemantropy(100) },
	]);

export const DEFAULT_BODY_SEMANTROPY: BodySemantropy =
	assertBodySemantropy(50);

/**
 * The label to show for a value. A value between presets keeps its number
 * rather than being rounded to the nearest named stop.
 */
export function bodySemantropyLabel(value: BodySemantropy): string {
	const preset = BODY_SEMANTROPY_PRESETS.find(
		(candidate) => candidate.value === value,
	);
	return preset?.label ?? String(value);
}

/**
 * Choices for the level control: the presets, plus the current value when it
 * is not one of them, so loading a non-preset value never silently changes it.
 */
export function bodySemantropyChoices(
	current: BodySemantropy,
): readonly { value: BodySemantropy; label: string }[] {
	const choices = BODY_SEMANTROPY_PRESETS.map((preset) => ({
		value: preset.value,
		label: preset.label,
	}));
	if (choices.some((choice) => choice.value === current)) {
		return Object.freeze(choices);
	}
	const withCurrent = [...choices, { value: current, label: String(current) }];
	withCurrent.sort((left, right) => left.value - right.value);
	return Object.freeze(withCurrent);
}
