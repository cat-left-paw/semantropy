import type { MarkdownSourceProjection } from "../analysis/projectMarkdownSource";
import type { LocatedAnalysisDocument } from "../analysis/locateTokens";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { isEnclosedTermDelimiterToken } from "../vocabulary/enclosedTerms";

/**
 * RECOMPOSE: the corpus every
 * Recompose method reads.
 *
 * A corpus is built from Sources that the shared analyzer has already
 * projected and tokenized (`analyzeSelectedSource`), so Markdown syntax,
 * protected regions, Aozora annotations and ruby readings never enter it.
 * Headings and code blocks are left out: they are not prose. Whitespace tokens
 * are dropped, and inline protected text is represented by 〓. What remains
 * is split into sentences at 。！？ (keeping closing brackets that follow), at
 * line breaks and at every paragraph end. Build it from the Target
 * presentation (`mode: "target-prototype"`), as Vocabulary Sources are
 * analyzed, so a local unsupported construct does not hide a whole paragraph.
 *
 * The corpus holds morphology and positions only. It is deeply frozen, and
 * every generated unit points back into it, so a result can always say which
 * Source and which span each piece came from.
 */
export const RECOMPOSE_CORPUS_VERSION = 1;

export type RecomposeSource = {
	readonly path: string;
	readonly contentHash: string;
	/** Relative draw weight when a method chooses among places to jump to. 1 is neutral. */
	readonly weight: number;
};

export type RecomposeMorph = Readonly<Pick<JapaneseToken,
	"surface" | "pos" | "detail1" | "detail2" | "conjugationType" | "conjugationForm" | "baseForm" | "isUnknown">>;

export type RecomposeSentence = {
	readonly source: number;
	/** `[start, end)` into `morphs`. */
	readonly start: number;
	readonly end: number;
};

export type RecomposeCorpus = {
	readonly version: typeof RECOMPOSE_CORPUS_VERSION;
	readonly sources: readonly RecomposeSource[];
	readonly morphs: readonly RecomposeMorph[];
	readonly sentences: readonly RecomposeSentence[];
	/** The sentence each morph belongs to. */
	readonly sentenceOf: readonly number[];
};

/** One analyzed Source, as `analyzeSelectedSource` returns it when ready. */
export type RecomposeSourceInput = {
	readonly path: string;
	readonly contentHash: string;
	readonly weight?: number;
	readonly projection: Pick<MarkdownSourceProjection, "presentation">;
	readonly located: LocatedAnalysisDocument;
};

export class RecomposeCorpusError extends Error {
	constructor(readonly code: "invalid-source" | "empty") {
		super(code === "empty" ? "The selected texts contain no sentences to recompose." : "A recompose source is invalid.");
		this.name = "RecomposeCorpusError";
	}
}

const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "．"]);
const CLOSING = new Set(["」", "』", "）", ")", "】", "〉", "》", "］", "”", "’"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Stands in for protected inline text, the way 〓 stands in for a missing glyph in print. */
const MISSING: RecomposeMorph = Object.freeze({
	surface: "〓", pos: "名詞", detail1: "一般", detail2: "*", conjugationType: "*", conjugationForm: "*", baseForm: "〓", isUnknown: true,
});

/** Whitespace, and the `{{` `}}` of an enclosed term (0.1.0 S4), which are markup rather than prose. */
function isBlank(token: JapaneseToken): boolean {
	return token.surface.trim().length === 0 || (token.pos === "記号" && token.detail1 === "空白") || isEnclosedTermDelimiterToken(token);
}

function morphOf(token: JapaneseToken): RecomposeMorph {
	return Object.freeze({
		surface: token.surface.normalize("NFC"),
		pos: token.pos,
		detail1: token.detail1,
		detail2: token.detail2,
		conjugationType: token.conjugationType,
		conjugationForm: token.conjugationForm,
		baseForm: token.baseForm,
		isUnknown: token.isUnknown,
	});
}

/** True when a sentence has at least one token that is not a symbol. */
function hasWords(morphs: readonly RecomposeMorph[], start: number, end: number): boolean {
	for (let i = start; i < end; i += 1) if (morphs[i]!.pos !== "記号") return true;
	return false;
}

export function buildRecomposeCorpus(inputs: readonly RecomposeSourceInput[]): RecomposeCorpus {
	const sources: RecomposeSource[] = [];
	const morphs: RecomposeMorph[] = [];
	const sentences: RecomposeSentence[] = [];
	const sentenceOf: number[] = [];
	const seen = new Set<string>();
	for (const input of inputs) {
		const weight = input.weight ?? 1;
		if (typeof input.path !== "string" || input.path.length === 0 || seen.has(input.path) || !(weight > 0) || !Number.isFinite(weight)) {
			throw new RecomposeCorpusError("invalid-source");
		}
		seen.add(input.path);
		const sourceIndex = sources.length;
		sources.push(Object.freeze({ path: input.path, contentHash: input.contentHash, weight }));
		const runs = new Map(input.located.runs.map((located) => [located.run.runId, located.tokens] as const));
		let start = morphs.length;
		const close = (): void => {
			const end = morphs.length;
			if (end > start && hasWords(morphs, start, end)) {
				const index = sentences.length;
				sentences.push(Object.freeze({ source: sourceIndex, start, end }));
				for (let i = start; i < end; i += 1) sentenceOf[i] = index;
			} else {
				morphs.length = start;
			}
			start = morphs.length;
		};
		// A sentence may run across inline protected text (an Aozora 外字 note,
		// inline code, a link) but never across a line break or a block.
		for (const block of input.projection.presentation.blocks) {
			if (HEADING_TAGS.has(block.tag) || block.tag === "pre" || block.hidden) continue;
			for (const item of block.items) {
				if (item.kind === "break") {
					close();
					continue;
				}
				if (item.kind === "static") {
					// Protected text is never copied; 〓 marks where it was.
					if (item.placeholder) close();
					else morphs.push(MISSING);
					continue;
				}
				const tokens = runs.get(item.runId) ?? [];
				for (let i = 0; i < tokens.length; i += 1) {
					const token = tokens[i]!.token;
					if (isBlank(token)) continue;
					morphs.push(morphOf(token));
					if (SENTENCE_END.has(token.surface)) {
						// Closing brackets and further end marks belong to this sentence.
						while (i + 1 < tokens.length) {
							const next = tokens[i + 1]!.token;
							if (!CLOSING.has(next.surface) && !SENTENCE_END.has(next.surface)) break;
							morphs.push(morphOf(next));
							i += 1;
						}
						close();
					}
				}
			}
			close();
		}
	}
	if (sentences.length === 0) throw new RecomposeCorpusError("empty");
	return Object.freeze({
		version: RECOMPOSE_CORPUS_VERSION,
		sources: Object.freeze(sources),
		morphs: Object.freeze(morphs),
		sentences: Object.freeze(sentences),
		sentenceOf: Object.freeze(sentenceOf),
	});
}
