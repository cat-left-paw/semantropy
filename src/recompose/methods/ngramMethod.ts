import type { RecomposeCorpus } from "../recomposeCorpus";
import { clampLeap, pickWeighted, type RecomposeMethod, type RecomposeRandom, type RecomposeRequest, type RecomposeResult, type RecomposeUnit } from "../recomposeTypes";

/**
 * 形態素 n-gram method.
 *
 * A classic Markov chain over morpheme surfaces. The context is the last one
 * to three morphemes of the sentence being written (sentence starts are padded
 * with a start marker), and the next morpheme is drawn from every place in the
 * corpus that followed the same context, so frequent continuations are more
 * likely. `leap` shortens the context — a shorter context has more places to go
 * — and tightens a copy limit: after several morphemes copied in a row from one
 * place, the chain must continue from somewhere else if the context allows it,
 * backing off to a shorter context to find one.
 */
const BOS = "\u0002";
/** A sentence end, stored as a negative number: -(sentence index + 1). */
type Next = number;

export type NgramModel = {
	readonly corpus: RecomposeCorpus;
	/** tables[c - 1]: context of `c` surfaces → the places that followed it. */
	readonly tables: readonly ReadonlyMap<string, readonly Next[]>[];
};

const MAX_CONTEXT = 3;
const SEP = "\u0001";

function contextKey(history: readonly string[], length: number): string {
	const out: string[] = [];
	for (let i = history.length - length; i < history.length; i += 1) out.push(i < 0 ? BOS : history[i]!);
	return out.join(SEP);
}

function build(corpus: RecomposeCorpus): NgramModel {
	const tables = Array.from({ length: MAX_CONTEXT }, () => new Map<string, Next[]>());
	corpus.sentences.forEach((sentence, sentenceIndex) => {
		const history: string[] = [];
		for (let position = sentence.start; position <= sentence.end; position += 1) {
			const next: Next = position < sentence.end ? position : -(sentenceIndex + 1);
			for (let c = 1; c <= MAX_CONTEXT; c += 1) {
				const key = contextKey(history, c);
				const table = tables[c - 1]!;
				const list = table.get(key);
				if (list) list.push(next);
				else table.set(key, [next]);
			}
			if (position < sentence.end) history.push(corpus.morphs[position]!.surface);
		}
	});
	return Object.freeze({ corpus, tables });
}

function leapPolicy(leap: number): { context: number; maxCopy: number } {
	const value = clampLeap(leap);
	if (value < 25) return { context: 3, maxCopy: 12 };
	if (value < 50) return { context: 2, maxCopy: 8 };
	if (value < 75) return { context: 1, maxCopy: 5 };
	return { context: 1, maxCopy: 3 };
}

const SOFT_LIMIT = 50;
const HARD_LIMIT = 90;
const END_MARKS = new Set(["。", "！", "？", "!", "?"]);

function generate(model: NgramModel, request: RecomposeRequest, random: RecomposeRandom): RecomposeResult {
	const { corpus } = model;
	const policy = leapPolicy(request.leap);
	const weightOf = (next: Next) => {
		const sentence = next >= 0 ? corpus.sentenceOf[next]! : -next - 1;
		return corpus.sources[corpus.sentences[sentence]!.source]!.weight;
	};
	const units: RecomposeUnit[] = [];
	const prefix = request.prefix ?? [];
	// The unfinished sentence at the end of the prefix, if any, is continued.
	const history: string[] = [];
	let previous = -1;
	let copyRun = 0;
	let copying = true;
	for (let i = prefix.length - 1; i >= 0; i -= 1) {
		const unit = prefix[i]!;
		if (unit.sentenceEnd) break;
		history.unshift(unit.text);
		if (i === prefix.length - 1) previous = unit.end - 1;
		if (copying && !unit.jump) copyRun += 1;
		else copying = false;
	}
	const wanted = Math.max(1, Math.floor(request.sentences));
	let finished = 0;
	const endSentence = () => {
		const last = units[units.length - 1];
		if (last) units[units.length - 1] = { ...last, sentenceEnd: true };
		finished += 1;
		history.length = 0;
		previous = -1;
		copyRun = 0;
	};
	for (let guard = 0; finished < wanted && guard < wanted * (HARD_LIMIT + 2); guard += 1) {
		if (history.length >= HARD_LIMIT) {
			const last = units[units.length - 1];
			if (last && !END_MARKS.has(last.text)) units[units.length - 1] = { ...last, text: `${last.text}。` };
			endSentence();
			continue;
		}
		let chosen: Next | undefined;
		for (let c = policy.context; c >= 1 && chosen === undefined; c -= 1) {
			let candidates = model.tables[c - 1]!.get(contextKey(history, c)) ?? [];
			// Too long a copied run: the next morpheme must come from somewhere else.
			if (copyRun >= policy.maxCopy && previous >= 0) candidates = candidates.filter((next) => next !== previous + 1);
			if (history.length >= SOFT_LIMIT) {
				const ending = candidates.filter((next) => next < 0 || END_MARKS.has(corpus.morphs[next]!.surface));
				if (ending.length > 0) candidates = ending;
			}
			chosen = pickWeighted(candidates, weightOf, random);
		}
		if (chosen === undefined) {
			if (history.length === 0) break;
			endSentence();
			continue;
		}
		if (chosen < 0) {
			if (history.length === 0) continue;
			endSentence();
			continue;
		}
		const morph = corpus.morphs[chosen]!;
		const jump = previous < 0 || chosen !== previous + 1;
		units.push({ text: morph.surface, source: corpus.sentences[corpus.sentenceOf[chosen]!]!.source, start: chosen, end: chosen + 1, jump, sentenceEnd: false });
		history.push(morph.surface);
		previous = chosen;
		copyRun = jump ? 0 : copyRun + 1;
	}
	return { units };
}

export const ngramMethod: RecomposeMethod<NgramModel> = Object.freeze({ id: "ngram", build, generate });
