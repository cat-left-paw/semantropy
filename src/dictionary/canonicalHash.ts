/**
 * Canonical serialization and hashing for Fake Dictionary determinism.
 *
 * Every value that feeds a definition Seed passes through here first. The
 * point is that two different inputs can never produce one serialization: a
 * delimiter-joined string would let `["a|b"]` and `["a", "b"]` collide, and a
 * colliding pair would silently hand two different headwords the same
 * definition.
 *
 * The scheme is length-prefixed rather than delimited. Each string is written
 * as its UTF-16 code-unit count, a colon, then the string itself; a reader
 * knows how many units to take and never has to look for a separator, so no
 * character in the payload can be mistaken for structure. Lists prefix their
 * own element count for the same reason.
 */

/** Marker for an absent optional value, distinct from the empty string `0:`. */
export const ABSENT_MARKER = "-:";

export function canonicalString(value: string): string {
	return `${value.length}:${value}`;
}

/** An optional string. `null` and `""` encode differently, on purpose. */
export function canonicalOptionalString(value: string | null): string {
	return value === null ? ABSENT_MARKER : canonicalString(value);
}

/**
 * A non-negative integer. Written through `canonicalString` so a number and a
 * string that looks like one cannot produce the same bytes.
 */
export function canonicalNumber(value: number): string {
	if (!Number.isInteger(value)) {
		throw new TypeError("Canonical numbers must be integers.");
	}
	return canonicalString(String(value));
}

/** A list, prefixed with its element count so nesting stays unambiguous. */
export function canonicalList(parts: readonly string[]): string {
	return `${parts.length}:${parts.join("")}`;
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/**
 * FNV-1a, 32-bit, over the UTF-8 bytes of `value`.
 *
 * The published algorithm, unmodified: start from offset basis 2166136261 and,
 * for each input byte, XOR it into the hash then multiply by prime 16777619,
 * keeping 32 bits. `Math.imul` gives the exact 32-bit product on every engine,
 * so the result is identical everywhere and across runs, and the known-vector
 * test can check it against the reference values rather than against itself.
 *
 * The input is encoded to UTF-8 first. Hashing UTF-16 code units instead would
 * still be deterministic, but it would not be FNV-1a of the string and no
 * external vector could confirm it.
 *
 * This is not a cryptographic hash and is not used as one. It is here because
 * it is short, self-contained, exactly specified and cheap.
 */
export function fnv1a32(value: string): number {
	let hash = FNV_OFFSET_BASIS_32 >>> 0;
	for (const byte of utf8Bytes(value)) {
		hash = Math.imul(hash ^ byte, FNV_PRIME_32) >>> 0;
	}
	return hash >>> 0;
}

/**
 * UTF-8 bytes of a string, computed here rather than through `TextEncoder` so
 * the hash has no dependency on a platform global. Lone surrogates — which a
 * template or a note can technically contain — become U+FFFD, exactly as
 * `TextEncoder` would render them, so no input can throw.
 */
function utf8Bytes(value: string): number[] {
	const bytes: number[] = [];
	for (const character of value) {
		let point = character.codePointAt(0) ?? 0xfffd;
		if (point >= 0xd800 && point <= 0xdfff) {
			point = 0xfffd;
		}
		if (point < 0x80) {
			bytes.push(point);
		} else if (point < 0x800) {
			bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
		} else if (point < 0x10000) {
			bytes.push(
				0xe0 | (point >> 12),
				0x80 | ((point >> 6) & 0x3f),
				0x80 | (point & 0x3f),
			);
		} else {
			bytes.push(
				0xf0 | (point >> 18),
				0x80 | ((point >> 12) & 0x3f),
				0x80 | ((point >> 6) & 0x3f),
				0x80 | (point & 0x3f),
			);
		}
	}
	return bytes;
}

/** Hashes an already-canonical list of parts to a uint32. `0` is a valid result. */
export function hashCanonical(parts: readonly string[]): number {
	return fnv1a32(canonicalList(parts));
}
