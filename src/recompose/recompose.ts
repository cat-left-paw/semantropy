import { buildRecomposeCorpus, type RecomposeCorpus, type RecomposeSourceInput } from "./recomposeCorpus";
import { jointMethod, type JointModel } from "./methods/jointMethod";
import { ngramMethod, type NgramModel } from "./methods/ngramMethod";
import type { RecomposeMethod, RecomposeMethodId, RecomposeRandom, RecomposeRequest, RecomposeUnit } from "./recomposeTypes";

/**
 * RECOMPOSE: the entry points a host
 * uses. A host builds a corpus from analyzed Sources, makes a model for one
 * method, and asks it for sentences. Every method sits behind the same
 * `RecomposeMethod` contract, so adding a method — or a hybrid of two — means
 * adding an entry to `RECOMPOSE_METHODS` and nothing else.
 *
 * Results are plain text with provenance. Nothing here reads a file, writes
 * anything, or keeps state between calls; randomness comes from the caller.
 */
export { DEFAULT_RECOMPOSE_METHOD, RECOMPOSE_ALGORITHM_VERSION, RECOMPOSE_METHOD_IDS, RECOMPOSE_MIXED_METHOD, isRecomposeMethodId } from "./recomposeVersions";

const METHODS = {
	joint: jointMethod,
	ngram: ngramMethod,
} as const satisfies Record<RecomposeMethodId, RecomposeMethod<unknown>>;

type ModelFor = { joint: JointModel; ngram: NgramModel };

/** An opaque, immutable model: one corpus, one method. */
export type RecomposeModel = {
	readonly method: RecomposeMethodId;
	readonly corpus: RecomposeCorpus;
	readonly state: ModelFor[RecomposeMethodId];
};

export function createRecomposeModel(corpus: RecomposeCorpus, method: RecomposeMethodId): RecomposeModel {
	const state = method === "joint" ? jointMethod.build(corpus) : ngramMethod.build(corpus);
	return Object.freeze({ method, corpus, state });
}

export type RecomposeOutputUnit = RecomposeUnit & { readonly method: RecomposeMethodId };

/**
 * Generates whole sentences after `request.prefix`. A prefix that ends in the
 * middle of a sentence written by a different method is not continued: the new
 * sentences start fresh.
 */
export function generateRecompose(model: RecomposeModel, request: RecomposeRequest & { prefix?: readonly RecomposeOutputUnit[] }, random: RecomposeRandom): RecomposeOutputUnit[] {
	const prefix = request.prefix ?? [];
	const last = prefix[prefix.length - 1];
	const continuable = !last || last.sentenceEnd || last.method === model.method;
	const effective: RecomposeRequest = { sentences: request.sentences, leap: request.leap, prefix: continuable ? prefix : [] };
	const units = model.method === "joint"
		? METHODS.joint.generate(model.state as JointModel, effective, random).units
		: METHODS.ngram.generate(model.state as NgramModel, effective, random).units;
	const tagged = units.map((unit) => ({ ...unit, method: model.method }));
	// Brackets are balanced over each whole sentence, including the prefix part of the first one.
	const carried = continuable && last && !last.sentenceEnd ? openBrackets(sentenceTail(prefix)) : [];
	return balanceBrackets(tagged, carried);
}

export function recomposeText(units: readonly RecomposeUnit[]): string {
	return units.map((unit) => unit.text).join("");
}

/** Builds a corpus straight from `analyzeSelectedSource` results. */
export function recomposeCorpusFrom(inputs: readonly RecomposeSourceInput[]): RecomposeCorpus {
	return buildRecomposeCorpus(inputs);
}

const PAIRS: ReadonlyMap<string, string> = new Map([
	["「", "」"], ["『", "』"], ["（", "）"], ["(", ")"], ["【", "】"], ["〈", "〉"], ["《", "》"], ["［", "］"], ["“", "”"], ["‘", "’"],
]);
const CLOSERS: ReadonlySet<string> = new Set(PAIRS.values());

function sentenceTail(units: readonly RecomposeUnit[]): RecomposeUnit[] {
	const out: RecomposeUnit[] = [];
	for (let i = units.length - 1; i >= 0; i -= 1) {
		if (i < units.length - 1 && units[i]!.sentenceEnd) break;
		out.unshift(units[i]!);
	}
	return out;
}

function openBrackets(units: readonly RecomposeUnit[]): string[] {
	const stack: string[] = [];
	for (const unit of units) {
		for (const char of unit.text) {
			const close = PAIRS.get(char);
			if (close) stack.push(close);
			else if (CLOSERS.has(char) && stack[stack.length - 1] === char) stack.pop();
		}
	}
	return stack;
}

/**
 * Within each sentence, drops a closing bracket that closes nothing and closes,
 * at the sentence's end, every bracket still open. Provenance is unchanged:
 * only the text of a unit is adjusted.
 */
function balanceBrackets<T extends RecomposeUnit>(units: readonly T[], carried: readonly string[]): T[] {
	const out: T[] = [];
	let stack = [...carried];
	for (const unit of units) {
		let text = "";
		for (const char of unit.text) {
			const close = PAIRS.get(char);
			if (close) {
				stack.push(close);
				text += char;
			} else if (CLOSERS.has(char)) {
				if (stack[stack.length - 1] === char) {
					stack.pop();
					text += char;
				}
			} else {
				text += char;
			}
		}
		if (unit.sentenceEnd && stack.length > 0) {
			text += stack.reverse().join("");
			stack = [];
		}
		// An emptied unit is dropped unless it carries the sentence end.
		if (text.length > 0 || unit.sentenceEnd) out.push({ ...unit, text });
		if (unit.sentenceEnd) stack = [];
	}
	return out;
}

export type { RecomposeCorpus, RecomposeSourceInput } from "./recomposeCorpus";
export type { RecomposeMethodId, RecomposeRandom, RecomposeUnit } from "./recomposeTypes";
