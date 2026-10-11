import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { collectFragmentMessage } from "../collect/collectMessages";
import type { CollectVocabularyProvenance } from "../collect/collectProvenance";
import type { CollectFragmentResultV4 } from "../collect/v4/CollectFragmentUseCaseV4";
import { COLLECT_METADATA_VERSION_V5, type RecomposeFragmentInputV5 } from "../collect/v4/CollectedFragmentV4";
import { collectVocabularyFromSnapshot } from "../application/collectVocabulary";
import { createSeededRandom } from "../random/seededRandom";
import { RecomposeCorpusError } from "../recompose/recomposeCorpus";
import {
	DEFAULT_RECOMPOSE_METHOD,
	RECOMPOSE_ALGORITHM_VERSION,
	RECOMPOSE_MIXED_METHOD,
	createRecomposeModel,
	generateRecompose,
	isRecomposeMethodId,
	recomposeCorpusFrom,
	recomposeText,
	type RecomposeMethodId,
	type RecomposeModel,
	type RecomposeOutputUnit,
} from "../recompose/recompose";
import { readManualMorphSourceDocuments, type ManualMorphVocabulary } from "../transform/manualMorphology";
import { dictionaryPoolIsCallable } from "../analysis/displaySlots";
import { withRecomposeWords, type RecomposeShownUnit, type RecomposeWord } from "./recomposeWords";

export type RecomposeHost = {
	/** The View's active, fresh Vocabulary owner (the one Collision uses), or null. */
	active(): ManualMorphVocabulary | null;
	/** A fresh draw nonce for one step. Never persisted, logged or shown. */
	nonce(): number;
	/** Lets the screen paint before the synchronous model build. */
	paint(): Promise<void>;
	copy(text: string): Promise<void>;
	collect(input: RecomposeFragmentInputV5): Promise<CollectFragmentResultV4>;
	/** FAKE-DICT-RECOMPOSE1: the text on screen, or whether a step is running, changed; the View decides again what may be looked up in it. */
	changed?(): void;
};

export type RecomposeAction = "generate" | "more" | "branch" | "copy" | "collect" | "clear";
export type RecomposeMode = "new" | "more" | "branch";
export const RECOMPOSE_SENTENCE_CHOICES = [1, 3, 5, 10] as const;

/**
 * The screen a session shows itself on: at most one at a time. `render` puts
 * the output on screen again, and after a step names it so the screen can show
 * where the new text is; `sync` updates everything else; `status` only the
 * status line.
 */
export type RecomposeDisplay = {
	render(step: RecomposeMode | null): void;
	sync(): void;
	status(): void;
};

/**
 * What is on screen and where it came from. The Vocabulary owner is never
 * kept: Continue and Branch need the same owner, which is recognised by its
 * epoch number, and Copy and Collect need only the provenance, copied when the
 * text was made. FAKE-DICT-RECOMPOSE1: each piece also carries the words the
 * Fake Dictionary can look up (`recomposeWords.ts`), copied from the corpus when
 * the piece was made, so the corpus is not read again and no owner is held for
 * them.
 */
type Output = {
	epoch: number; vocabulary: CollectVocabularyProvenance; paragraphs: RecomposeShownUnit[][];
	/** Whether the Vocabulary this text came from has a pool that can fill a core Fake Dictionary template (the Shuffle body's own condition). A fact about the epoch, so a boolean is all that is kept. */
	callable: boolean;
};

/**
 * WORKBENCH-UI2 stage 3 (`Docs/release_0_2_0_plan.md` §3.3): the processing of
 * 0.1.0 S5's Recompose, apart from any screen — the settings, the model cache,
 * the output, the branch point, Copy, Collect and its own busy state.
 *
 * The Sources are the active Vocabulary's, with its Source weights, read from
 * the documents that were analyzed when the Vocabulary was applied: nothing is
 * read or tokenized again. Output keeps its units, so Continue and Branch hand
 * the core exactly what it produced. A View on a host with tabs keeps one
 * session for its lifetime, so the output stays until the View closes (the
 * 0.1.0 S5 dialog kept one only while it was open; WORKBENCH-UI4 removed it).
 */
export class RecomposeSession {
	private host: RecomposeHost | null;
	/** Owner → epoch. Weak, so an owner the View has let go is never held here. */
	private epochs = new WeakMap<ManualMorphVocabulary, number>();
	private nextEpoch = 0;
	/** One model per owner and method; dropped as soon as the active owner is another one. */
	private cache: { epoch: number; method: RecomposeMethodId; model: RecomposeModel } | null = null;
	/** The leap of the step that produced each piece; with each piece's own method this is what Collect records. */
	private leapOf = new WeakMap<RecomposeOutputUnit, number>();
	private output: Output | null = null;
	/** Index into the flattened units of the chosen branch point. */
	private branchAt: number | null = null;
	private busy = false;
	private message: (() => string) | null = null;
	private display: RecomposeDisplay | null = null;
	method: RecomposeMethodId = DEFAULT_RECOMPOSE_METHOD;
	leap = 50;
	sentences = 3;

	constructor(host: RecomposeHost) {
		this.host = host;
	}

	/** Shows the session on `display`, replacing any other screen it was on. */
	attach(display: RecomposeDisplay): void {
		this.display = display;
	}

	detach(display: RecomposeDisplay): void {
		if (this.display === display) this.display = null;
	}

	/** Terminal: a step still waiting publishes nothing, and nothing is kept. */
	dispose(): void {
		this.host = null; this.display = null;
		this.cache = null; this.output = null; this.branchAt = null; this.message = null;
	}

	isDisposed(): boolean {
		return this.host === null;
	}

	setMethod(value: string): void {
		this.method = isRecomposeMethodId(value) ? value : DEFAULT_RECOMPOSE_METHOD;
	}

	setLeap(value: number): void {
		this.leap = Number.isFinite(value) ? value : 50;
	}

	setSentences(value: number): void {
		this.sentences = (RECOMPOSE_SENTENCE_CHOICES as readonly number[]).includes(value) ? value : 3;
	}

	private epochOf(owner: ManualMorphVocabulary): number {
		let epoch = this.epochs.get(owner);
		if (epoch === undefined) { epoch = this.nextEpoch += 1; this.epochs.set(owner, epoch); }
		return epoch;
	}

	/**
	 * What a screen shows. Reading it also lets go of a model built for an owner
	 * that is no longer the active one, so a long-lived session never keeps an
	 * old Vocabulary's model.
	 */
	read() {
		const active = this.host?.active() ?? null;
		const epoch = active ? this.epochOf(active) : null;
		if (this.cache && this.cache.epoch !== epoch) this.cache = null;
		const output = this.output;
		const same = output !== null && output.epoch === epoch;
		const available: Record<RecomposeAction, boolean> = {
			generate: active !== null, more: same, branch: same && this.branchAt !== null,
			copy: output !== null, collect: output !== null, clear: output !== null,
		};
		for (const key of Object.keys(available) as RecomposeAction[]) available[key] &&= !this.busy;
		return {
			busy: this.busy, available, branchAt: this.branchAt,
			/** FAKE-DICT-RECOMPOSE1: the words of the text on screen can be looked up now: its Vocabulary is the active one (not stale, not being prepared), the pool can fill a template, and no step is running. */
			lookup: same && output.callable && !this.busy,
			paragraphs: output?.paragraphs ?? null,
			changed: output !== null && !same,
			message: this.message,
		};
	}

	private say(message: (() => string) | null): void {
		this.message = message;
		this.display?.status();
	}

	/** One model per Vocabulary owner and method, from the Sources' already analyzed documents. */
	private model(owner: ManualMorphVocabulary, epoch: number, method: RecomposeMethodId): RecomposeModel {
		if (this.cache?.epoch === epoch && this.cache.method === method) return this.cache.model;
		const documents = readManualMorphSourceDocuments(owner);
		if (!documents) throw new Error("vocabulary");
		const { sources, sourceWeights } = owner.snapshot;
		const weights = new Map(sources.map((source, index) => [source.path, sourceWeights?.[index] ?? 1]));
		const corpus = recomposeCorpusFrom([...documents].sort((a, b) => (a.source.path < b.source.path ? -1 : a.source.path > b.source.path ? 1 : 0))
			.map(document => ({ path: document.source.path, contentHash: document.source.contentHash, weight: weights.get(document.source.path) ?? 1,
				projection: document.projection, located: document.located })));
		const model = createRecomposeModel(corpus, method);
		this.cache = { epoch, method, model };
		return model;
	}

	async run(mode: RecomposeMode): Promise<void> {
		const host = this.host;
		if (this.busy || !host) return;
		const owner = host.active();
		if (!owner) { this.say(() => ui().recompose.noVocabulary); return; }
		const epoch = this.epochOf(owner);
		const output = this.output;
		if (mode !== "new" && output?.epoch !== epoch) { this.display?.sync(); return; }
		// Captured before the await: the branch point and the output are the ones the reader chose.
		const branchAt = this.branchAt;
		if (mode === "branch" && branchAt === null) return;
		this.busy = true;
		this.say(() => ui().recompose.preparing);
		this.display?.sync();
		host.changed?.();
		try {
			await host.paint();
			if (this.host !== host) return;
			// The output was cleared while this step waited: nothing to continue, and nothing is generated.
			if (this.output !== output) { this.say(null); return; }
			const method = this.method, leap = this.leap, sentences = this.sentences;
			const model = this.model(owner, epoch, method);
			const random = createSeededRandom(host.nonce());
			const shown = (units: RecomposeOutputUnit[]): RecomposeShownUnit[] => units.map(unit => withRecomposeWords(model.corpus, unit));
			let paragraphs: RecomposeShownUnit[][];
			if (mode === "new" || !output) paragraphs = [shown(generateRecompose(model, { sentences, leap }, random))];
			else if (mode === "more") paragraphs = [...output.paragraphs, shown(generateRecompose(model, { sentences, leap, prefix: output.paragraphs.flat() }, random))];
			else {
				// Keep everything up to the branch point, then continue that paragraph.
				const keep = branchAt! + 1;
				const kept: RecomposeShownUnit[][] = [];
				let count = 0;
				for (const paragraph of output.paragraphs) {
					if (count >= keep) break;
					kept.push(paragraph.slice(0, keep - count));
					count += paragraph.length;
				}
				const tail = shown(generateRecompose(model, { sentences, leap, prefix: kept.flat() }, random));
				kept[kept.length - 1] = [...kept[kept.length - 1]!, ...tail];
				paragraphs = kept;
			}
			for (const unit of paragraphs.flat()) if (!this.leapOf.has(unit)) this.leapOf.set(unit, leap);
			this.output = { epoch, vocabulary: output?.epoch === epoch ? output.vocabulary : collectVocabularyFromSnapshot(owner.snapshot), paragraphs, callable: dictionaryPoolIsCallable(owner.snapshot) };
			this.branchAt = null;
			// Numbers only: the message must not keep the model or its corpus.
			const sourceCount = model.corpus.sources.length, sentenceCount = model.corpus.sentences.length;
			this.say(() => ui().recompose.ready(sourceCount, sentenceCount));
		} catch (error) {
			this.say(error instanceof RecomposeCorpusError && error.code === "empty" ? () => ui().recompose.tooFew : () => ui().recompose.failed);
		} finally {
			this.busy = false;
			if (this.host === host) {
				this.display?.render(mode);
				this.display?.sync();
				host.changed?.();
			}
		}
	}

	/** Whether Copy or Collect has a text to write now. */
	writable(): boolean {
		return !!this.host && !this.busy && this.text() !== "";
	}

	/** The text on screen: paragraphs separated by one blank line. */
	text(): string {
		return this.output ? this.output.paragraphs.map(paragraph => recomposeText(paragraph)).join("\n\n") : "";
	}

	async copy(): Promise<void> {
		const host = this.host, text = this.text();
		if (!host || !text || this.busy) return;
		try { await host.copy(text); this.say(() => ui().recompose.copied); }
		catch { this.say(() => ui().recompose.copyFailed); }
	}

	/** Collects the text on screen with the provenance of the Vocabulary it came from, even if another is active now. */
	async collect(): Promise<void> {
		const host = this.host, output = this.output, text = this.text();
		if (!host || !output || !text || this.busy) return;
		try {
			const result = await host.collect({ metadataVersion: COLLECT_METADATA_VERSION_V5, type: "recompose", text,
				algorithmVersion: RECOMPOSE_ALGORITHM_VERSION, ...this.recorded(output), vocabulary: output.vocabulary });
			const message = collectFragmentMessage(result);
			this.say(() => localize(message));
		} catch {
			this.say(() => ui().recompose.collectFailed);
		} finally {
			if (this.host === host) this.display?.sync();
		}
	}

	/**
	 * What the text on screen was made with: one method, or `mixed` when its
	 * pieces came from more than one, and the smallest and largest leap used.
	 * A Branch keeps only the pieces before the branch point, so a step that
	 * contributed nothing to the text is not counted.
	 */
	private recorded(output: Output): Pick<RecomposeFragmentInputV5, "method" | "leapMin" | "leapMax"> {
		const units = output.paragraphs.flat();
		const methods = new Set(units.map(unit => unit.method));
		const leaps = units.map(unit => this.leapOf.get(unit) ?? 50);
		const [only] = methods;
		return { method: methods.size === 1 && only ? only : RECOMPOSE_MIXED_METHOD, leapMin: Math.min(...leaps), leapMax: Math.max(...leaps) };
	}

	clear(): void {
		this.output = null;
		this.branchAt = null;
		this.say(null);
		this.display?.render(null);
		this.display?.sync();
		this.host?.changed?.();
	}

	/** The branch point, an index into the flattened pieces, or null for none. */
	mark(index: number | null): void {
		this.branchAt = index;
	}

	/** A word of the text on screen, by its piece's index among the flattened pieces and its place in that piece; null when there is none now. */
	wordAt(unitIndex: number, wordIndex: number): RecomposeWord | null {
		return this.output?.paragraphs.flat()[unitIndex]?.words[wordIndex] ?? null;
	}
}
