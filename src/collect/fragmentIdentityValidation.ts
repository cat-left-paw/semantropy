/** The existing UUID grammar: case-insensitive hex, without a new version restriction. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFragmentId(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Pure parsing of supplied data, never the current time. toISOString is the
 * issuer's canonical UTC representation, including expanded years and milliseconds.
 */
export function isFragmentCreated(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
