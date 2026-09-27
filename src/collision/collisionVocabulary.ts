/**
 * The authenticated seam between an analyzed Source and a Collision pool.
 *
 * `buildCollisionLexemePool()` is a pure function over a Vocabulary Snapshot,
 * and it stays that way: it has no opinion about where its Snapshot came from,
 * which is what keeps it a leaf that never reaches the Source analyzer. That
 * purity is also its limit. A Snapshot is an ordinary value, so a caller can
 * build one, or clone a real one and rewrite its Manual projection while
 * keeping the original fingerprint and origins. Structural verification cannot
 * see the difference, because the pool and the Snapshot are the only evidence
 * and both are reproducible.
 *
 * So authentication starts where the words do. Source text enters the product
 * only through `analyzeManualMorphSource()`, which tokenizes it and registers
 * the result privately; `buildManualMorphVocabulary()` then mints one owner
 * handle whose Snapshot and evidence were derived together from those same
 * private copies. This module accepts only such a handle, and records the pool
 * it produced from it.
 *
 * The result is one unbroken chain: Source text -> tokenized analysis ->
 * minted vocabulary -> minted Collision pool. A consumer asks
 * `inspectCollisionLexemePool()` and gets an answer that rests on that chain
 * rather than on how convincing a value looks.
 */

import {
	isManualMorphVocabulary,
	type ManualMorphVocabulary,
} from "../transform/manualMorphology";
import {
	buildCollisionLexemePool,
	inspectCollisionLexemePoolStructure,
	type CollisionLexemePatternData,
	type CollisionLexemePool,
	type CollisionLexemePoolResult,
	type CollisionLexemePoolViolation,
} from "./collisionLexemePool";

/**
 * The only record of which pools came through the authenticated path.
 *
 * Module-private and never exposed: nothing outside this file can add to it,
 * so a value that is not in it did not come from here. The pattern data the
 * pool was built from is recorded with it, because a pool is only a pool for
 * that set.
 *
 * This is the same shape `src/transform/manualMorphology.ts` uses for its
 * analyses and evidence, and it is the same reason: a public, deterministic
 * identity function makes any self-consistent value reproducible, so origin
 * has to be recorded rather than inferred.
 */
const MINTED_POOLS = new WeakMap<object, object>();

export type CollisionVocabularyRejection =
	| "invalid-vocabulary"
	| CollisionLexemePoolViolation;

/** The pure builder's own refusals, plus the one this seam adds. */
export type CollisionLexemePoolBuildRejection =
	| "invalid-vocabulary"
	| Extract<CollisionLexemePoolResult, { ok: false }>["reason"];

export type CollisionLexemePoolBuild =
	| { readonly ok: true; readonly pool: CollisionLexemePool }
	| { readonly ok: false; readonly reason: CollisionLexemePoolBuildRejection };

/**
 * Builds a Collision lexeme pool from a minted Manual Morph vocabulary.
 *
 * The handle must be one `buildManualMorphVocabulary()` produced, together
 * with the Snapshot it minted: a hand-built, spread or cloned look-alike is
 * refused with `invalid-vocabulary` and nothing is minted. On success the pool
 * is recorded against the pattern data it was built from.
 *
 * This is the only function that mints a pool. Everything else about pool
 * construction stays in the pure builder.
 */
export function buildAuthenticatedCollisionLexemePool(input: {
	readonly vocabulary: ManualMorphVocabulary;
	readonly patternData: CollisionLexemePatternData;
}): CollisionLexemePoolBuild {
	try {
		if (input === null || typeof input !== "object") {
			return { ok: false, reason: "invalid-vocabulary" };
		}
		const vocabulary = input.vocabulary;
		if (
			vocabulary === null ||
			typeof vocabulary !== "object" ||
			!isManualMorphVocabulary(vocabulary)
		) {
			return { ok: false, reason: "invalid-vocabulary" };
		}
		const patternData = input.patternData;
		const built = buildCollisionLexemePool({
			snapshot: vocabulary.snapshot,
			patternData,
		});
		if (!built.ok) {
			return { ok: false, reason: built.reason };
		}
		MINTED_POOLS.set(built.pool, patternData);
		return { ok: true, pool: built.pool };
	} catch {
		// A malformed envelope or throwing getter is an authentication refusal;
		// exception details never cross this boundary and no pool is minted.
		return { ok: false, reason: "invalid-vocabulary" };
	}
}

/**
 * Whether this is a pool that came through the authenticated path with this
 * pattern data, and whether it still satisfies the whole contract.
 *
 * Two independent questions, both load-bearing and neither able to answer the
 * other:
 *
 *   - **Origin.** Did it come from `buildAuthenticatedCollisionLexemePool()`,
 *     for this pattern data? Only that function records it, and nothing outside
 *     this module can write the record. This is what refuses a hand-built pool,
 *     a clone, a pool whose identities were all re-minted to agree with forged
 *     evidence, and a pool built from a Snapshot that never came from analyzed
 *     Source text.
 *   - **Structure.** Does it satisfy `inspectCollisionLexemePoolStructure()`?
 *     Origin cannot decide this: it says where a value came from, not whether
 *     the builder is correct. Running it here keeps a builder defect from
 *     reaching a consumer, and it is the contract the builder's own output is
 *     pinned against.
 */
export function inspectCollisionLexemePool(
	pool: CollisionLexemePool,
	patternData: CollisionLexemePatternData,
): CollisionVocabularyRejection | null {
	if (pool === null || typeof pool !== "object") {
		return "invalid-policy";
	}
	const mintedWith = MINTED_POOLS.get(pool);
	if (mintedWith === undefined) {
		return "not-minted";
	}
	if (mintedWith !== patternData) {
		// Authenticated, but built for a different pattern set.
		return "invalid-pattern-binding";
	}
	return inspectCollisionLexemePoolStructure(pool, patternData);
}
