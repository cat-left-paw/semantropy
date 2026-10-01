import type { VocabularyOrigin } from "../analysis/rubyVocabulary";

/**
 * 0.1.0 S3: per-Source draw weights (Docs/release_0_1_0_policy.md decision 11).
 *
 * A weight belongs to one Vocabulary Source and applies at every draw that
 * already honours the draw mode:
 *
 *   - Frequency: a candidate weighs Σ (its count in a Source × that Source's weight).
 *   - Uniform:   a candidate weighs the largest weight among the Sources it occurs in.
 *
 * When every Source is ×1 there is no weight at all: the Snapshot carries no
 * `sourceWeights`, its fingerprint is unchanged, and each draw site keeps its
 * existing code path, so results are identical to a build without weights.
 *
 * Weights are counted in quarter units (×0.25 = 1 … ×4 = 16) so a draw weight
 * stays a positive safe integer, which is what the existing weighted walks and
 * their validators expect.
 */
export const SOURCE_WEIGHT_CHOICES = [0.25, 0.5, 1, 2, 4] as const;
export type SourceWeight = (typeof SOURCE_WEIGHT_CHOICES)[number];
export const DEFAULT_SOURCE_WEIGHT: SourceWeight = 1;
const QUARTERS = 4;

export function isSourceWeight(value: unknown): value is SourceWeight {
	return SOURCE_WEIGHT_CHOICES.some((choice) => choice === value);
}

/**
 * The Snapshot field: one weight per Source, in the Snapshot's `sources` order,
 * or `null` when every Source is ×1. A path with no entry is ×1; an entry for a
 * path that is not a Source is ignored. An invalid weight returns `undefined`
 * so the caller can refuse the whole build.
 */
export function canonicalSourceWeights(
	paths: readonly string[],
	weights: Readonly<Record<string, unknown>> | null | undefined,
): readonly SourceWeight[] | null | undefined {
	if (weights === null || weights === undefined) return null;
	if (typeof weights !== "object") return undefined;
	const values: SourceWeight[] = [];
	for (const path of paths) {
		const value = Object.prototype.hasOwnProperty.call(weights, path) ? weights[path] : DEFAULT_SOURCE_WEIGHT;
		if (!isSourceWeight(value)) return undefined;
		values.push(value);
	}
	return values.every((value) => value === DEFAULT_SOURCE_WEIGHT) ? null : Object.freeze(values);
}

/** Quarter-unit weight by Source path, or `null` for the unweighted path. */
export type SourceWeightLookup = ReadonlyMap<string, number> | null;

/**
 * Reads the weights a Snapshot (or anything that copied its `sources` and
 * `sourceWeights`) carries. A malformed field is a programming error upstream,
 * so it throws rather than silently drawing unweighted.
 */
export function sourceWeightLookup(owner: {
	readonly sources: readonly { readonly path: string }[];
	readonly sourceWeights?: readonly number[] | undefined;
}): SourceWeightLookup {
	const weights = owner.sourceWeights;
	if (weights === undefined) return null;
	if (!Array.isArray(weights) || weights.length !== owner.sources.length || !weights.every(isSourceWeight)) {
		throw new Error("Invalid Vocabulary Source weights.");
	}
	return new Map(owner.sources.map((source, index) => [source.path, weights[index]! * QUARTERS]));
}

/** The weighted draw weight of one candidate, from every origin it was built from (a list may repeat a Source). */
export function weightedDrawWeight(
	mode: "uniform" | "frequency",
	lookup: ReadonlyMap<string, number>,
	origins: Iterable<VocabularyOrigin>,
): number {
	let total = 0;
	for (const origin of origins) {
		const weight = lookup.get(origin.path) ?? QUARTERS;
		total = mode === "frequency" ? total + origin.count * weight : Math.max(total, weight);
	}
	if (!Number.isSafeInteger(total) || total <= 0) throw new Error("Invalid Vocabulary Source weights.");
	return total;
}

/**
 * The draw weight a site uses. Without weights this is exactly the existing
 * expression (`frequency` for Frequency, `1` for Uniform), and `origins` is
 * not read (pass a function when collecting them has a cost).
 */
export function drawWeight(
	mode: "uniform" | "frequency",
	lookup: SourceWeightLookup,
	frequency: number,
	origins: Iterable<VocabularyOrigin> | (() => Iterable<VocabularyOrigin>),
): number {
	if (lookup === null) return mode === "frequency" ? frequency : 1;
	return weightedDrawWeight(mode, lookup, typeof origins === "function" ? origins() : origins);
}
