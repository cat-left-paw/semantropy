import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import type { SemantropyReadyAnalysis } from "../src/application/SemantropySession";
import {
	DEFAULT_BODY_SEMANTROPY,
	assertBodySemantropy,
} from "../src/settings/bodySemantropy";

/** Named levels, so tests state the value they mean rather than a bare number. */
export const OFF = assertBodySemantropy(0);
export const LOW = assertBodySemantropy(25);
export const MEDIUM = assertBodySemantropy(50);
export const HIGH = assertBodySemantropy(75);
export const MAX = assertBodySemantropy(100);

export function emptyReadyAnalysis(
	overrides: Partial<SemantropyReadyAnalysis> = {},
): SemantropyReadyAnalysis {
	return {
		tokenSequences: [],
		pool: new Map(),
		replacementCount: 0,
		replaceableSlotCount: 0,
		bodySemantropy: DEFAULT_BODY_SEMANTROPY,
		algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
		...overrides,
	};
}
