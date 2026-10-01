import type { RecomposeCorpus } from "./recomposeCorpus";

/**
 * RECOMPOSE: the contract every generation method keeps, so
 * methods can be added, compared or combined without touching their callers.
 *
 * A method builds an immutable model from a corpus once, then generates whole
 * sentences from it. Generation is stateless: everything needed to continue or
 * to branch is the list of units already produced, which the caller keeps.
 */
export type RecomposeMethodId = "joint" | "ngram";

/** One piece of output and where it came from. */
export type RecomposeUnit = {
	readonly text: string;
	/** Index into `corpus.sources`. */
	readonly source: number;
	/** `[start, end)` into `corpus.morphs`; the span this unit copies. */
	readonly start: number;
	readonly end: number;
	/** The method moved to another place in the corpus to produce this unit. */
	readonly jump: boolean;
	/** This unit ends a sentence. */
	readonly sentenceEnd: boolean;
};

export type RecomposeRequest = {
	/** Whole sentences to add. The unfinished sentence of a prefix counts as the first. */
	readonly sentences: number;
	/** 0 (stay close to the Source) … 100 (leap as often as possible). */
	readonly leap: number;
	/** Units already shown; generation continues after the last one. */
	readonly prefix?: readonly RecomposeUnit[];
};

export type RecomposeResult = {
	/** Only the new units, to append after the prefix. */
	readonly units: readonly RecomposeUnit[];
};

export type RecomposeRandom = { next(): number };

export type RecomposeMethod<TModel> = {
	readonly id: RecomposeMethodId;
	build(corpus: RecomposeCorpus): TModel;
	generate(model: TModel, request: RecomposeRequest, random: RecomposeRandom): RecomposeResult;
};

/** Picks one item by weight. Returns undefined for an empty list or zero total. */
export function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, random: RecomposeRandom): T | undefined {
	let total = 0;
	for (const item of items) total += Math.max(0, weight(item));
	if (!(total > 0)) return undefined;
	let draw = random.next() * total;
	for (const item of items) {
		draw -= Math.max(0, weight(item));
		if (draw < 0) return item;
	}
	return items[items.length - 1];
}

export function clampLeap(leap: number): number {
	return Number.isFinite(leap) ? Math.min(100, Math.max(0, leap)) : 50;
}
