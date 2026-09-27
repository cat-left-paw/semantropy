import type { SourceSnapshot } from "../application/SourceSnapshot";
import { collectTransformableTextNodes } from "./collectTextNodes";
import { buildAnalysisDocument } from "./buildAnalysisDocument";
import { tokenizeAnalysisDocument, type LocatedAnalysisDocument } from "../analysis/locateTokens";
import { buildRubyVocabulary, chooseVocabularyCandidate, freezeAnalysis, type RubyVocabulary } from "../analysis/rubyVocabulary";
import { RubyBodyRenderer } from "./rubyBodyRenderer";
import { transformTokenSequences, type TransformResult } from "../transform/transformTokens";
import type { AnalyzedNote } from "../application/analyzeNoteTexts";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import type { BodySemantropy } from "../settings/bodySemantropy";

export const MARKDOWN_RENDER_ERROR_MESSAGE =
	"Could not render the note. Run Semantropy: Open again.";

export type MarkdownRenderOwner = {
	unload(): void;
};

export type MarkdownRenderHost = {
	createOwner: () => MarkdownRenderOwner;
	createContainer: () => HTMLElement;
	renderMarkdown: (input: {
		markdown: string;
		container: HTMLElement;
		sourcePath: string;
		owner: MarkdownRenderOwner;
	}) => Promise<void>;
};

export type MarkdownBodyStatus = "attached" | "stale" | "error";

/** A validated set of node writes, ready to be applied in one step. */
export type PreparedTextApplication = {
	/** Writes every prepared value, or none if the body moved since prepare. */
	commit: () => "applied" | "stale";
};

export class MarkdownBodyController {
	private owner: MarkdownRenderOwner | null = null;
	private readonly pendingOwners = new Set<MarkdownRenderOwner>();
	private container: HTMLElement | null = null;
	private textNodes: Text[] = [];
	private bodyGeneration = 0;
	private ruby: { renderer: RubyBodyRenderer; located: LocatedAnalysisDocument; vocabulary: RubyVocabulary; analysis: AnalyzedNote } | null = null;
	private sourceIdentity = { path: "", contentHash: "" };

	release(): void {
		this.bodyGeneration += 1;
		this.owner?.unload();
		this.owner = null;
		for (const pending of this.pendingOwners) {
			pending.unload();
		}
		this.pendingOwners.clear();
		this.container = null;
		this.textNodes = [];
		this.ruby = null;
	}

	getContainer(): HTMLElement | null {
		return this.container;
	}

	getTextNodes(): readonly Text[] {
		return this.ruby && this.container ? collectTransformableTextNodes(this.container) : this.textNodes;
	}

	getSequenceCount(): number { return this.ruby?.renderer.sequenceCount ?? this.textNodes.length; }

	async analyzeRuby(tokenizer: JapaneseTokenizer, isCurrent: () => boolean): Promise<AnalyzedNote | null> {
		const root = this.container;
		const generation = this.bodyGeneration;
		if (!root || !isCurrent()) return null;
		if (this.ruby) return this.ruby.analysis;
		const dom = buildAnalysisDocument(root);
		const located = freezeAnalysis(await tokenizeAnalysisDocument(dom.document, tokenizer));
		if (!isCurrent() || root !== this.container || generation !== this.bodyGeneration) return null;
		const tokenSequences = freezeAnalysis(located.runs.map((run) => run.tokens.map((item) => item.token)));
		const vocabulary = buildRubyVocabulary(located, this.sourceIdentity);
		const analysis = { tokenSequences, pool: vocabulary.automaticBody };
		const renderer = new RubyBodyRenderer(root, dom);
		this.ruby = { renderer, located, vocabulary, analysis };
		return analysis;
	}

	transformRuby(seed: number, level: BodySemantropy): TransformResult {
		if (!this.ruby) throw new Error("Ruby source analysis is unavailable.");
		const ruby = this.ruby;
		const result = transformTokenSequences(ruby.analysis.tokenSequences, ruby.analysis.pool, seed, level, true);
		const candidateSelections = ruby.located.runs.map((run, runIndex) => run.tokens.map((item, tokenIndex) => {
			const surface = result.tokenSurfaces![runIndex]![tokenIndex]!;
			return surface === item.token.surface ? null : chooseVocabularyCandidate({
				vocabulary: ruby.vocabulary, original: item.token, surface, seed, tokenId: item.tokenId,
			});
		}));
		return { ...result, candidateSelections: freezeAnalysis(candidateSelections), displaySeed: seed };
	}

	prepareRubyResult(generation: number, result: TransformResult, isCurrent: () => boolean = () => true): PreparedTextApplication | null {
		const ruby = this.ruby; const owner = this.owner;
		if (!ruby || !owner || generation !== this.bodyGeneration || !result.tokenSurfaces || !result.candidateSelections || result.displaySeed === undefined) return null;
		if (result.texts.length !== result.tokenSurfaces.length ||
			result.tokenSurfaces.some((surfaces, index) => surfaces.join("") !== result.texts[index])) return null;
		try {
			const commit = ruby.renderer.prepare({
				located: ruby.located, vocabulary: ruby.vocabulary, surfaces: result.tokenSurfaces, seed: result.displaySeed,
				selections: result.candidateSelections,
				isCurrent: () => isCurrent() && this.ruby === ruby && this.owner === owner && this.bodyGeneration === generation,
			});
			return commit ? { commit } : null;
		} catch { return null; }
	}

	applyRubyResult(generation: number, result: TransformResult, isCurrent: () => boolean = () => true): "applied" | "stale" | "mismatch" {
		if (generation !== this.bodyGeneration || !this.owner || !isCurrent()) return "stale";
		return this.prepareRubyResult(generation, result, isCurrent)?.commit() ?? "mismatch";
	}

	getBodyGeneration(): number {
		return this.bodyGeneration;
	}

	/**
	 * Validates a set of texts against the body as it stands and returns a
	 * commit step, or null when they cannot be applied at all.
	 *
	 * Splitting validation from the write lets a caller settle every
	 * "cannot apply" case before it does something it would have to undo — a
	 * settings write, for instance. Once prepare has succeeded, commit either
	 * writes every node or writes none.
	 */
	prepareTransformedTexts(
		generation: number,
		texts: readonly string[],
	): PreparedTextApplication | null {
		if (this.ruby || this.owner === null || generation !== this.bodyGeneration) {
			return null;
		}
		const nodes = this.textNodes;
		if (texts.length !== nodes.length) {
			return null;
		}
		// Paired up front, so the commit loop has nothing left to check and
		// cannot stop halfway through.
		const writes: { node: Text; value: string }[] = [];
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index];
			const next = texts[index];
			if (!node || next === undefined) {
				return null;
			}
			writes.push({ node, value: next });
		}

		return {
			commit: () => {
				if (
					this.owner === null ||
					generation !== this.bodyGeneration ||
					this.textNodes !== nodes
				) {
					return "stale";
				}
				for (const write of writes) {
					write.node.nodeValue = write.value;
				}
				return "applied";
			},
		};
	}

	applyTransformedTexts(
		generation: number,
		texts: readonly string[],
	): "applied" | "stale" | "mismatch" {
		if (this.owner === null || generation !== this.bodyGeneration) {
			return "stale";
		}
		const prepared = this.prepareTransformedTexts(generation, texts);
		if (!prepared) {
			return "mismatch";
		}
		return prepared.commit();
	}

	async renderIfCurrent(
		requestId: number,
		snapshot: Pick<SourceSnapshot, "text" | "sourcePath"> & Partial<Pick<SourceSnapshot, "contentHash">>,
		isCurrent: (requestId: number) => boolean,
		host: MarkdownRenderHost,
	): Promise<MarkdownBodyStatus> {
		const owner = host.createOwner();
		this.pendingOwners.add(owner);
		const container = host.createContainer();
		try {
			await host.renderMarkdown({
				markdown: snapshot.text,
				container,
				sourcePath: snapshot.sourcePath,
				owner,
			});
			if (!this.pendingOwners.has(owner)) {
				return "stale";
			}
			this.pendingOwners.delete(owner);
			if (!isCurrent(requestId)) {
				owner.unload();
				return "stale";
			}
			this.owner?.unload();
			this.bodyGeneration += 1;
			this.owner = owner;
			this.container = container;
			this.ruby = null;
			this.sourceIdentity = { path: snapshot.sourcePath, contentHash: snapshot.contentHash ?? "" };
			this.textNodes = collectTransformableTextNodes(container);
			return "attached";
		} catch {
			if (!this.pendingOwners.has(owner)) {
				return "stale";
			}
			this.pendingOwners.delete(owner);
			owner.unload();
			if (!isCurrent(requestId)) {
				return "stale";
			}
			this.owner?.unload();
			this.owner = null;
			this.container = null;
			this.ruby = null;
			this.textNodes = [];
			return "error";
		}
	}
}
