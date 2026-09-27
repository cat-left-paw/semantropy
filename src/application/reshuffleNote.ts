import { assertUint32Seed } from "../random/seededRandom";
import type { BodySemantropy } from "../settings/bodySemantropy";
import {
	transformTokenSequences,
	type TokenSequences,
	type TransformResult,
	type VocabularyPool,
} from "../transform/transformTokens";

export const MAX_DISTINCT_SEED_ATTEMPTS = 8;

export const RESHUFFLE_ERROR_MESSAGE = "Could not reshuffle. Try again.";
export const RESHUFFLING_MESSAGE = "Reshuffling…";
export const RESHUFFLE_MISSING_VIEW_MESSAGE = "Open a Semantropy view first.";
export const RESHUFFLE_UNAVAILABLE_MESSAGE =
	"Nothing to reshuffle yet.";
export const INSUFFICIENT_POOL_MESSAGE =
	"Not enough replaceable nouns in this note.";
/** Nothing outside frontmatter / protected content could be analyzed at all. */
export const NO_SUPPORTED_TEXT_MESSAGE =
	"No supported text to transform in this note. It is shown as written.";
export const TEXT_TRANSFORMATION_OFF_MESSAGE = "Text transformation is off.";

export type DistinctSeedResult =
	| { status: "ok"; seed: number }
	| { status: "same-seed" }
	| { status: "failed" };

export function issueDistinctUint32Seed(
	currentSeed: number,
	issueSeed: () => number,
	maxAttempts = MAX_DISTINCT_SEED_ATTEMPTS,
): DistinctSeedResult {
	try {
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			const seed = assertUint32Seed(issueSeed());
			if (seed !== currentSeed) {
				return { status: "ok", seed };
			}
		}
		return { status: "same-seed" };
	} catch {
		return { status: "failed" };
	}
}

/** The transform seam, so callers can inject a stub without a real pool. */
export type BodyTransform = (
	tokenSequences: TokenSequences,
	pool: VocabularyPool,
	bodySeed: number,
	bodySemantropy: BodySemantropy,
) => TransformResult;

export type PlannedReshuffle = {
	tokenSurfaces?: TransformResult["tokenSurfaces"];
	candidateSelections?: TransformResult["candidateSelections"];
	displaySeed?: number;
	bodySeed: number;
	texts: string[];
	replacementCount: number;
	replaceableSlotCount: number;
	bodySemantropy: BodySemantropy;
	algorithmVersion: number;
};

export type PlanReshuffleResult =
	| { status: "planned"; plan: PlannedReshuffle }
	| {
			status: "failed";
			reason: "seed" | "same-seed" | "transform" | "count-mismatch";
	  };

/**
 * Issues a new body Seed and re-transforms the stored analysis with it. The
 * Semantropy value is carried through unchanged: Reshuffle moves the Seed and
 * nothing else.
 */
export function planReshuffle(input: {
	tokenSequences: TokenSequences;
	pool: VocabularyPool;
	currentBodySeed: number;
	bodySemantropy: BodySemantropy;
	expectedNodeCount: number;
	issueSeed: () => number;
	transform?: BodyTransform;
}): PlanReshuffleResult {
	if (input.tokenSequences.length !== input.expectedNodeCount) {
		return { status: "failed", reason: "count-mismatch" };
	}

	const issued = issueDistinctUint32Seed(
		input.currentBodySeed,
		input.issueSeed,
	);
	if (issued.status !== "ok") {
		return {
			status: "failed",
			reason: issued.status === "same-seed" ? "same-seed" : "seed",
		};
	}

	try {
		const transform = input.transform ?? transformTokenSequences;
		const result = transform(
			input.tokenSequences,
			input.pool,
			issued.seed,
			input.bodySemantropy,
		);
		if (result.texts.length !== input.expectedNodeCount) {
			return { status: "failed", reason: "count-mismatch" };
		}
		return {
			status: "planned",
			plan: {
				...(result.tokenSurfaces ? { tokenSurfaces: result.tokenSurfaces, candidateSelections: result.candidateSelections, displaySeed: result.displaySeed } : {}),
				bodySeed: issued.seed,
				texts: result.texts,
				replacementCount: result.replacementCount,
				replaceableSlotCount: result.replaceableSlotCount,
				bodySemantropy: result.bodySemantropy,
				algorithmVersion: result.algorithmVersion,
			},
		};
	} catch {
		return { status: "failed", reason: "transform" };
	}
}
