/**
 * How Text Semantropy shapes a Fake Alert (`Docs/fake_alert_policy1.md` §6).
 *
 * This is the one place to tune by playing. Each row holds the value at Text
 * Semantropy 0, 25, 50, 75 and 100; a level between two anchors is linear
 * between them. The interpolation stays in integers — every value is returned
 * multiplied by 25 — so a value is 0 only where the table makes it exactly 0,
 * never by rounding. A 0 forbids that category at that level, and the
 * generator never lifts it to make an Alert possible.
 *
 * Kept out of the first version on purpose (policy §6, §13): putting an
 * ordinary noun in a sahen slot, and swapping the kind a recipe shows. Either
 * would be one more row here and one more step in the generator, with no
 * change to the recipe schema.
 */

export const FAKE_ALERT_LEVEL_MAX = 100;
/** The levels the rows are written at. */
export const FAKE_ALERT_LEVEL_ANCHORS = [0, 25, 50, 75, 100] as const;
/** Every interpolated value is this many times the table's value. */
export const FAKE_ALERT_LEVEL_SCALE = 25;

type Row = readonly [number, number, number, number, number];

/**
 * A family's weight multiplier by its drift. Drift 0 stays positive at every
 * level, so the plain Alert never disappears; drift 1 to 3 are 0 at level 0.
 */
export const FAKE_ALERT_DRIFT_CURVES: readonly Row[] = Object.freeze([
	Object.freeze([16, 12, 8, 4, 2] as const),
	Object.freeze([0, 6, 8, 8, 6] as const),
	Object.freeze([0, 1, 4, 8, 10] as const),
	Object.freeze([0, 0, 1, 4, 8] as const),
]);

/** Eighths: an outcome family that answers the pressed button counts 8. One that does not counts this. */
export const FAKE_ALERT_ROLE_MISMATCH: Row = Object.freeze([0, 0, 1, 3, 6] as const);

/** Eighths: an outcome that uses only slots the prompt has counts 8. One that does not counts this. */
export const FAKE_ALERT_SLOT_MISFIT: Row = Object.freeze([0, 2, 4, 6, 8] as const);

/** Percent: how often an outcome keeps the prompt's word for a shared slot. */
export const FAKE_ALERT_INHERIT_PERCENT: Row = Object.freeze([100, 95, 85, 65, 45] as const);

/** A full match, in the same eighths as the two rows above. */
export const FAKE_ALERT_MATCH_EIGHTHS = 8;

export function isFakeAlertLevel(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= FAKE_ALERT_LEVEL_MAX;
}

/** The row's value at `level`, times `FAKE_ALERT_LEVEL_SCALE`. Exact; 0 only where the row is 0. */
export function fakeAlertLevelValue(row: Row, level: number): number {
	if (!isFakeAlertLevel(level)) throw new RangeError("Text Semantropy must be an integer from 0 to 100.");
	if (level === FAKE_ALERT_LEVEL_MAX) return row[4] * FAKE_ALERT_LEVEL_SCALE;
	const index = Math.floor(level / FAKE_ALERT_LEVEL_SCALE);
	const offset = level - index * FAKE_ALERT_LEVEL_SCALE;
	return row[index]! * (FAKE_ALERT_LEVEL_SCALE - offset) + row[index + 1]! * offset;
}
