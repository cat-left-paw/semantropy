import {
	assertDictionarySemantropy,
	type DictionarySemantropy,
} from "../settings/dictionarySemantropy";
import type { FakeDictionaryPlaceholder } from "./placeholders";
import type { TemplateFamily } from "./templateData";

/**
 * The Fake Dictionary Semantropy buckets.
 *
 * Every integer 0..100 falls in exactly one. The value does not control how
 * much of anything is exchanged — that is the body value's job — but how far
 * the template family may drift from the headword's own IPADIC class, and how
 * many Optional Clauses are appended.
 *
 * These are the fixed contract, pinned by fixtures. Nothing reads a raw number
 * and compares it against a threshold inline.
 */
export type DictionaryBucket = "off" | "low" | "medium" | "high" | "max";

/**
 * The bucket for a value.
 *
 * The range is enforced here as well as at the generator's entry, so no caller
 * can get a bucket for a value the setting could never hold: -1 would
 * otherwise read as Off and 101 as MAX, both silently.
 */
export function dictionaryBucketOf(
	value: DictionarySemantropy | number,
): DictionaryBucket {
	const checked = assertDictionarySemantropy(value);
	if (checked === 0) {
		return "off";
	}
	if (checked <= 25) {
		return "low";
	}
	if (checked <= 50) {
		return "medium";
	}
	if (checked <= 75) {
		return "high";
	}
	return "max";
}

/**
 * The family a headword's own class prefers, or `null` for everything else.
 *
 * Only the three classes IPADIC states outright get a preference. A general
 * noun has no "correct" family and gets none — every eligible family is then
 * equally likely, which is the point of the feature. Note that this is an even
 * spread over families, so a family with one eligible template gives that
 * template a larger individual share than each of three in another family.
 */
export function preferredFamilyFor(
	classification: FakeDictionaryPlaceholder | null,
): TemplateFamily | null {
	switch (classification) {
		case "person":
			return "person";
		case "place":
			return "place";
		case "organization":
			return "organization";
		default:
			return null;
	}
}

/** Weight given to the preferred family, per bucket. */
export const PREFERRED_FAMILY_WEIGHT: Readonly<
	Record<DictionaryBucket, number>
> = Object.freeze({
	off: 1,
	low: 8,
	medium: 4,
	// High and MAX drop the bias entirely: every eligible family is equal.
	high: 1,
	max: 1,
});

/** Weight given to every other eligible family. Always 1. */
export const OTHER_FAMILY_WEIGHT = 1;

/**
 * The weight of one family at this bucket.
 *
 * The weight belongs to the family, not to its individual templates: the
 * generator groups eligible templates by family and applies this once per
 * family, so a family's share never scales with how many of its templates the
 * note happened to be able to fill.
 *
 * A preferred family that turns out to have no eligible template simply never
 * appears; the other families keep their weight and stay candidates. The bias
 * is a preference, never a requirement.
 */
export function familyWeight(
	bucket: DictionaryBucket,
	family: TemplateFamily,
	preferred: TemplateFamily | null,
): number {
	if (preferred !== null && family === preferred) {
		return PREFERRED_FAMILY_WEIGHT[bucket];
	}
	return OTHER_FAMILY_WEIGHT;
}

/** The most Optional Clauses a bucket may append. */
export const MAX_OPTIONAL_CLAUSES: Readonly<Record<DictionaryBucket, number>> =
	Object.freeze({
		off: 0,
		low: 0,
		medium: 1,
		high: 1,
		max: 2,
	});

/**
 * Medium alone gates its single clause on a deterministic score, so roughly
 * half of Medium definitions stay core-only. Low never appends, and High and
 * MAX always append what they can.
 */
export const MEDIUM_OPTIONAL_THRESHOLD = 0.5;

export function bucketWantsOptionalGate(bucket: DictionaryBucket): boolean {
	return bucket === "medium";
}
