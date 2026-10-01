import type { RecomposeMethodId } from "./recomposeTypes";

/**
 * 0.1.0 S5: the Recompose identifiers Collect validates against, in a pure leaf
 * so the Collect contract never pulls in the generator.
 */
export const RECOMPOSE_ALGORITHM_VERSION = 1;

export const RECOMPOSE_METHOD_IDS: readonly RecomposeMethodId[] = Object.freeze(["joint", "ngram"]);

/** Owner decision (2026-10-01), after comparing both on the presets: 継ぎ目（文節）. */
export const DEFAULT_RECOMPOSE_METHOD: RecomposeMethodId = "joint";

export function isRecomposeMethodId(value: unknown): value is RecomposeMethodId {
	return RECOMPOSE_METHOD_IDS.some((id) => id === value);
}

/** 0.1.0 S5 (owner decision): a text whose pieces came from more than one method is recorded as mixed. */
export const RECOMPOSE_MIXED_METHOD = "mixed";
export type RecomposeRecordedMethod = RecomposeMethodId | typeof RECOMPOSE_MIXED_METHOD;

export function isRecomposeRecordedMethod(value: unknown): value is RecomposeRecordedMethod {
	return value === RECOMPOSE_MIXED_METHOD || isRecomposeMethodId(value);
}
