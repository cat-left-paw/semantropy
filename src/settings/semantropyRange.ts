/** Every Semantropy value is an integer percentage of this range. */
export const SEMANTROPY_MIN = 0;
export const SEMANTROPY_MAX = 100;

/**
 * Shared range check for the body and dictionary values. They stay separate
 * branded types on purpose — only the validation is common.
 */
export function isSemantropyValue(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= SEMANTROPY_MIN &&
		value <= SEMANTROPY_MAX
	);
}

export function assertSemantropyValue(value: number, label: string): number {
	if (!isSemantropyValue(value)) {
		throw new RangeError(
			`${label} must be an integer between ${SEMANTROPY_MIN} and ${SEMANTROPY_MAX}.`,
		);
	}
	return value;
}
