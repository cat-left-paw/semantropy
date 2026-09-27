/**
 * 2: body Semantropy value. Replaceable slots pick a candidate exactly as in
 * version 1, but whether a slot is applied now comes from a stable per-slot
 * score compared against the Semantropy value.
 */
// 3: production analysis uses Ruby-aware inline runs (including formatting),
// and verified Source pairs have a separate deterministic variant draw.
// 4: the production Target is analyzed from the safe Markdown projection
// (target-presentation-2) instead of MarkdownRenderer DOM, so analysis runs,
// the vocabulary pool and same-Seed results can differ from version 3.
// 5: production uses VocabularySnapshot projections and Uniform/Frequency draws.
// Snapshot fingerprints replace the Current Note Ruby fingerprint in provenance draws.
// 6: five-field verb/adjective dictionary changes Snapshot fingerprints and thus
// verified Ruby variant draws, even when primary noun surfaces remain unchanged.
// 7: noun Manual overrides affect runtime display and Body Collect results.
// 8: observed, connection-verified Manual verb/i-adjective forms in production.
// 9: regular adjective family / observed-form Manual candidate coverage.
export const SEMANTROPY_ALGORITHM_VERSION = 9;
export const UINT32_MAX = 0xffffffff;

export type SeededRandom = {
	next(): number;
	nextUint32(): number;
};

export type Uint32RandomSource = {
	getRandomValues<T extends ArrayBufferView>(array: T): T;
};

function defaultRandomSource(): Uint32RandomSource | undefined {
	if (typeof crypto === "undefined") {
		return undefined;
	}
	return crypto;
}

export function assertUint32Seed(seed: number): number {
	if (!Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) {
		throw new RangeError(
			`Seed must be an unsigned 32-bit integer (0..${UINT32_MAX}).`,
		);
	}
	return seed;
}

export function createSeededRandom(seed: number): SeededRandom {
	let state = assertUint32Seed(seed) | 0;

	const nextUint32 = (): number => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return (t ^ (t >>> 14)) >>> 0;
	};

	return {
		nextUint32,
		next: (): number => nextUint32() / 4294967296,
	};
}

export function issueUint32Seed(
	randomSource: Uint32RandomSource | undefined = defaultRandomSource(),
): number {
	if (!randomSource?.getRandomValues) {
		throw new Error(
			"Web Crypto getRandomValues is unavailable; cannot issue a seed.",
		);
	}

	const bytes = new Uint32Array(1);
	randomSource.getRandomValues(bytes);
	const value = bytes[0];
	if (value === undefined) {
		throw new Error("Web Crypto did not return a uint32 seed.");
	}
	return value;
}
