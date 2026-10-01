import type { RecomposeCorpus, RecomposeMorph } from "../recomposeCorpus";
import { clampLeap, pickWeighted, type RecomposeMethod, type RecomposeRandom, type RecomposeRequest, type RecomposeResult, type RecomposeUnit } from "../recomposeTypes";

/**
 * 継ぎ目 (joint) method.
 *
 * Every sentence is cut into bunsetsu-like segments: a content word (with any
 * compound nouns, a prefix, a noun suffix) followed by its function tail —
 * particles, auxiliaries, dependent verbs and punctuation. The tail is the
 * segment's *joint*: 「を」「は、」「ていた。」. Where two segments meet in the
 * Source, the second one is recorded as a follower of the first one's joint.
 *
 * Generation walks the Source segment by segment. At each joint it either
 * keeps reading where it is, or leaps to a segment that followed the same
 * joint somewhere else in the corpus. The grammar at the seam is always one
 * the Source itself used; what is on either side of it need not belong
 * together. `leap` is the chance of leaping at a joint, and a copy limit
 * forces a leap after a few segments copied in a row.
 *
 * This is a heuristic segmentation from IPADIC parts of speech, not a parser,
 * and it is allowed to be wrong: a misplaced cut only produces a stranger seam.
 */
type Segment = {
	readonly start: number;
	readonly end: number;
	readonly sentence: number;
	/** Exact function tail, or a bare marker for a segment with none. */
	readonly joint: string;
	/** The same joint with less detail, used for bigger leaps. */
	readonly coarse: string;
	readonly last: boolean;
	readonly text: string;
};

export type JointModel = {
	readonly corpus: RecomposeCorpus;
	readonly segments: readonly Segment[];
	readonly starts: readonly number[];
	readonly followers: ReadonlyMap<string, readonly number[]>;
	readonly coarseFollowers: ReadonlyMap<string, readonly number[]>;
	readonly segmentAt: ReadonlyMap<number, number>;
};

type Kind = "content" | "function" | "suffix" | "prefix" | "opening";

const OPENING = new Set(["「", "『", "（", "(", "【", "〈", "《", "［", "“", "‘"]);
const INDEPENDENT_HEADS = new Set(["副詞", "連体詞", "接続詞", "感動詞"]);
const COMPLETE_WORDS = new Set(["副詞", "連体詞", "接続詞", "感動詞", "動詞", "形容詞"]);

function kindOf(morph: RecomposeMorph): Kind {
	if (morph.pos === "記号") {
		return OPENING.has(morph.surface) || morph.detail1 === "括弧開" ? "opening" : "function";
	}
	if (morph.pos === "助詞" || morph.pos === "助動詞") return "function";
	if ((morph.pos === "動詞" || morph.pos === "形容詞") && (morph.detail1 === "非自立" || morph.detail1 === "接尾")) return "function";
	if (morph.pos === "名詞" && (morph.detail1 === "接尾" || morph.detail1 === "非自立")) return "suffix";
	if (morph.pos === "接頭詞") return "prefix";
	return "content";
}

/** Whether `next` begins a new segment after the content word `previous`. */
function startsNewSegment(previous: RecomposeMorph, next: RecomposeMorph): boolean {
	if (INDEPENDENT_HEADS.has(next.pos)) return true;
	if (COMPLETE_WORDS.has(previous.pos)) return true;
	if (previous.pos === "名詞" && next.pos === "名詞") return false;
	if (previous.pos === "名詞" && previous.detail1 === "サ変接続" && next.pos === "動詞") return false;
	return true;
}

function bareJoint(content: RecomposeMorph | null, detailed: boolean): string {
	if (!content) return "∅";
	const form = detailed && content.conjugationForm !== "*" ? `:${content.conjugationForm}` : "";
	return `∅${content.pos}${form}`;
}

type Cut = { start: number; end: number; tail: number | null; content: RecomposeMorph | null };
type OpenCut = { start: number; tail: number | null; content: RecomposeMorph | null; prefix: boolean };

function segmentSentence(morphs: readonly RecomposeMorph[], from: number, to: number): Cut[] {
	const out: Cut[] = [];
	const state: { cur: OpenCut | null } = { cur: null };
	const open = (at: number, prefix = false): OpenCut => {
		const previous = state.cur;
		if (previous) out.push({ start: previous.start, end: at, tail: previous.tail, content: previous.content });
		const next: OpenCut = { start: at, tail: null, content: null, prefix };
		state.cur = next;
		return next;
	};
	for (let i = from; i < to; i += 1) {
		const morph = morphs[i]!;
		const segment = state.cur;
		switch (kindOf(morph)) {
			case "opening": {
				// An opening bracket starts the segment it introduces.
				if (!segment || segment.content || segment.tail !== null) open(i);
				break;
			}
			case "function": {
				const target = segment ?? open(i);
				if (target.tail === null) target.tail = i;
				break;
			}
			case "suffix": {
				// こと、の、さん…: part of the word before, and the tail starts again after it.
				const target = segment ?? open(i);
				target.tail = null;
				target.content = morph;
				break;
			}
			case "prefix": {
				if (!segment || segment.content || segment.tail !== null) open(i, true);
				else segment.prefix = true;
				break;
			}
			case "content": {
				let target = segment ?? open(i);
				if (target.tail !== null || (target.content && !target.prefix && startsNewSegment(target.content, morph))) target = open(i);
				target.content = morph;
				target.prefix = false;
				break;
			}
		}
	}
	const last = state.cur;
	if (last) out.push({ start: last.start, end: to, tail: last.tail, content: last.content });
	return out.filter((part) => part.end > part.start);
}

function tailKeys(morphs: readonly RecomposeMorph[], segment: { end: number; tail: number | null; content: RecomposeMorph | null }): { joint: string; coarse: string } {
	if (segment.tail === null) return { joint: bareJoint(segment.content, true), coarse: bareJoint(segment.content, false) };
	let joint = "";
	let coarse = "";
	for (let i = segment.tail; i < segment.end; i += 1) {
		const morph = morphs[i]!;
		joint += morph.surface;
		if (morph.pos !== "記号") coarse = morph.surface;
	}
	return { joint, coarse: coarse || joint };
}

function build(corpus: RecomposeCorpus): JointModel {
	const segments: Segment[] = [];
	const starts: number[] = [];
	const followers = new Map<string, number[]>();
	const coarseFollowers = new Map<string, number[]>();
	const segmentAt = new Map<number, number>();
	const add = (map: Map<string, number[]>, key: string, value: number) => {
		const list = map.get(key);
		if (list) list.push(value);
		else map.set(key, [value]);
	};
	corpus.sentences.forEach((sentence, sentenceIndex) => {
		const parts = segmentSentence(corpus.morphs, sentence.start, sentence.end);
		parts.forEach((part, index) => {
			const keys = tailKeys(corpus.morphs, part);
			const id = segments.length;
			let text = "";
			for (let i = part.start; i < part.end; i += 1) text += corpus.morphs[i]!.surface;
			segments.push(Object.freeze({ start: part.start, end: part.end, sentence: sentenceIndex, joint: keys.joint, coarse: keys.coarse, last: index === parts.length - 1, text }));
			segmentAt.set(part.start, id);
			if (index === 0) starts.push(id);
			else {
				const previous = segments[id - 1]!;
				add(followers, previous.joint, id);
				add(coarseFollowers, previous.coarse, id);
			}
		});
	});
	return Object.freeze({ corpus, segments: Object.freeze(segments), starts: Object.freeze(starts), followers, coarseFollowers, segmentAt });
}

/** leap 0 → rarely leap and copy up to six segments; 100 → leap at every joint. */
function leapPolicy(leap: number): { chance: number; maxCopy: number; coarse: boolean } {
	const value = clampLeap(leap);
	return {
		chance: 0.05 + 0.95 * (value / 100),
		maxCopy: value < 34 ? 6 : value < 67 ? 3 : 1,
		coarse: value >= 75,
	};
}

const MAX_SEGMENTS_PER_SENTENCE = 28;

function generate(model: JointModel, request: RecomposeRequest, random: RecomposeRandom): RecomposeResult {
	const { segments, corpus } = model;
	const policy = leapPolicy(request.leap);
	const weightOf = (id: number) => corpus.sources[corpus.sentences[segments[id]!.sentence]!.source]!.weight;
	const units: RecomposeUnit[] = [];
	const prefix = request.prefix ?? [];
	const lastPrefix = prefix[prefix.length - 1];
	let current: number | null = null;
	let copyRun = 0;
	let length = 0;
	if (lastPrefix && !lastPrefix.sentenceEnd) {
		// Continue the unfinished sentence, if its last unit is one of this model's segments.
		const found = model.segmentAt.get(lastPrefix.start);
		if (found !== undefined && segments[found]!.end === lastPrefix.end) {
			current = found;
			let copying = true;
			for (let i = prefix.length - 1; i >= 0; i -= 1) {
				if (i < prefix.length - 1 && prefix[i]!.sentenceEnd) break;
				length += 1;
				if (copying && !prefix[i]!.jump) copyRun += 1;
				else copying = false;
			}
		}
	}
	const emit = (id: number, jump: boolean) => {
		const segment = segments[id]!;
		units.push({ text: segment.text, source: corpus.sentences[segment.sentence]!.source, start: segment.start, end: segment.end, jump, sentenceEnd: segment.last });
		current = id;
		length += 1;
		copyRun = jump ? 0 : copyRun + 1;
	};
	const wanted = Math.max(1, Math.floor(request.sentences));
	let finished = 0;
	for (let guard = 0; finished < wanted && guard < wanted * (MAX_SEGMENTS_PER_SENTENCE * 2 + 4); guard += 1) {
		if (current === null || segments[current]!.last) {
			if (current !== null && units.length > 0) finished += 1;
			if (finished >= wanted) break;
			const start = pickWeighted(model.starts, weightOf, random);
			if (start === undefined) break;
			length = 0;
			copyRun = 0;
			emit(start, true);
			continue;
		}
		const here = segments[current]!;
		const natural = current + 1;
		const tooLong = length >= MAX_SEGMENTS_PER_SENTENCE;
		const wantLeap = tooLong || copyRun >= policy.maxCopy || random.next() < policy.chance;
		if (wantLeap) {
			const eligible = (list: readonly number[] | undefined) =>
				(list ?? []).filter((id) => id !== natural && id !== current && segments[id]!.text !== here.text && (!tooLong || segments[id]!.last));
			let candidates = policy.coarse ? eligible(model.coarseFollowers.get(here.coarse)) : eligible(model.followers.get(here.joint));
			if (candidates.length === 0 && !policy.coarse) candidates = eligible(model.coarseFollowers.get(here.coarse));
			const target = pickWeighted(candidates, weightOf, random);
			if (target !== undefined) {
				emit(target, true);
				continue;
			}
		}
		emit(natural, false);
	}
	return { units };
}

export const jointMethod: RecomposeMethod<JointModel> = Object.freeze({ id: "joint", build, generate });
