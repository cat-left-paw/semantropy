import type { DisplaySlotRunOutput } from "../analysis/displaySlots";
import type { TargetSlotMarkers } from "./safeTargetDom";
import type { SemantropyReadyAnalysis } from "../application/SemantropySession";
import type { SourceSnapshot } from "../application/SourceSnapshot";
import { chooseVocabularyCandidate, createCandidateDrawContext, freezeAnalysis } from "../analysis/rubyVocabulary";
import { assembleTargetPlan, createTargetPlanIndex, planTargetRun, planTargetSlotRun, type PresentationNode, type TargetPlanIndex, type TargetDisplayPlan } from "../analysis/targetPresentation";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import { transformTokenSequences, type TokenSequences, type TransformResult } from "../transform/transformTokens";
import type { BodySelection, BodySelectionSource } from "../view/readBodySelection";
import { CooperativeSlice, type CooperativeScheduler } from "./cooperativeScheduler";
import { analyzeSafeTarget, buildSafeTargetDomIncremental, type SafeTargetModel, type TargetDom } from "./safeTargetDom";

export const TARGET_RENDER_ERROR_MESSAGE =
	"Could not render the note. Run Semantropy: Open again.";

export type TargetPhase =
	| "projection" | "tokenize" | "vocabulary" | "surfaceTransform" | "candidateResolve"
	| "presentationPlan" | "domBuild" | "commit" | "paintAfterCommit";

/** Counts and milliseconds only. Never carries body text, readings, tokens or paths. */
export type TargetPhaseReport = {
	operation: "open" | "transform" | "load";
	utf16: number; blocks: number; runs: number; tokens: number; annotations: number;
	replacements: number; textNodes: number;
	/** First tokenize call of an Open; includes lazy tokenizer initialization when cold. */
	firstTokenizeMs: number | null;
	phases: Partial<Record<TargetPhase, number>>;
	yields: number; maxContinuousMs: number;
};
export type TargetPhaseRecorder = (report: TargetPhaseReport) => void;

export type TargetOpenResult =
	| { status: "applied"; analysis: SemantropyReadyAnalysis }
	| { status: "stale" }
	| { status: "render-error" }
	| { status: "analyze-error" };

/** A fully built next body, or why there is none. `commit` swaps it in all-or-nothing. */
export type PreparedTargetBody =
	| { status: "prepared"; commit: (accept?: (publishDom: () => void) => boolean) => "applied" | "stale" }
	| { status: "stale" }
	| { status: "failed" };

export type TargetModel = SafeTargetModel & { index: TargetPlanIndex; tokenSequences: TokenSequences; utf16: number };

export class PhaseTimer {
	readonly phases: Partial<Record<TargetPhase, number>> = {};
	private current: TargetPhase | null = null;
	private started = 0;
	constructor(private readonly now: () => number) {}
	begin(phase: TargetPhase): void {
		this.end();
		this.current = phase;
		this.started = this.now();
	}
	end(): void {
		if (this.current === null) return;
		this.phases[this.current] = (this.phases[this.current] ?? 0) + this.now() - this.started;
		this.current = null;
	}
	/** Waiting for the event loop is not attributed to the phase in progress. */
	async pause<T>(wait: () => Promise<T>): Promise<T> {
		const phase = this.current;
		this.end();
		try {
			return await wait();
		} finally {
			if (phase) this.begin(phase);
		}
	}
}

/**
 * The production Target display. Built only from the note string through the
 * approved safe projection: MarkdownRenderer, postprocessors, DOMParser,
 * HTML strings and note-derived attributes are unreachable from here.
 *
 * Long work (tokenize, candidate resolution, planning, DOM building) runs in
 * budgeted slices between cooperative yields. Every slice boundary re-checks
 * the caller's request and this controller's generation / ticket, and the
 * next body stays detached until one synchronous `replaceChildren` commit.
 */
export class TargetBodyController {
	private root: HTMLElement | null = null;
	private model: TargetModel | null = null;
	private displayed: TargetDom | null = null;
	private generation = 0;
	private revision = 0;
	private ticket = 0;
	private observer: MutationObserver | null = null;
	private tampered = false;
	private lastReport: TargetPhaseReport | null = null;

	/** Drops model, display, pending work and the root. Any in-flight work goes stale. */
	release(): void {
		this.generation += 1;
		this.ticket += 1;
		this.observer?.disconnect();
		this.observer = null;
		this.tampered = false;
		this.model = null;
		this.displayed = null;
		this.lastReport = null;
		this.root?.replaceChildren();
		this.root?.remove();
		this.root = null;
	}

	getBodyGeneration(): number {
		return this.generation;
	}

	/** The committed body root; the view attaches it. Null before an Open settles. */
	getContainer(): HTMLElement | null {
		return this.root;
	}

	/** Committed logical Text nodes (readings and placeholders excluded). */
	getTextNodes(): readonly Text[] {
		return this.displayed?.bindings.filter((b) => b.logicalRange).map((b) => b.node) ?? [];
	}

	getSequenceCount(): number {
		return this.model?.located.runs.length ?? 0;
	}

	getDisplayRevision(): number {
		return this.revision;
	}

	/** The latest completed operation's measurements, handed out once. */
	takePhaseReport(): TargetPhaseReport | null {
		const report = this.lastReport;
		this.lastReport = null;
		return report;
	}

	async open(input: {
		snapshot: Pick<SourceSnapshot, "text" | "sourcePath" | "contentHash">;
		bodySeed: number;
		bodySemantropy: BodySemantropy;
		getTokenizer: () => JapaneseTokenizer;
		isCurrent: () => boolean;
		scheduler: CooperativeScheduler;
		ownerDocument: Document;
	}): Promise<TargetOpenResult> {
		this.release();
		const generation = this.generation;
		const owned = (): boolean => input.isCurrent() && this.generation === generation;
		const slice = new CooperativeSlice(input.scheduler, owned);
		const timer = new PhaseTimer(() => input.scheduler.now());
		let tokenizer: JapaneseTokenizer;
		try {
			tokenizer = input.getTokenizer();
		} catch {
			return owned() ? { status: "analyze-error" } : { status: "stale" };
		}
		let firstTokenizeMs: number | null = null;
		const measured: JapaneseTokenizer = {
			tokenize: async (text) => {
				if (firstTokenizeMs !== null) return await tokenizer.tokenize(text);
				const started = input.scheduler.now();
				try {
					return await tokenizer.tokenize(text);
				} finally {
					firstTokenizeMs = input.scheduler.now() - started;
				}
			},
		};
		const analyzed = await analyzeSafeTarget({
			text: input.snapshot.text,
			sourcePath: input.snapshot.sourcePath,
			contentHash: input.snapshot.contentHash,
			tokenizer: measured,
			isCurrent: owned,
			checkpoint: () => timer.pause(() => slice.checkpoint()),
			phase: (name) => timer.begin(name),
		});
		timer.end();
		if (!owned() || analyzed.status === "stale") return { status: "stale" };
		if (analyzed.status === "error") return { status: "analyze-error" };
		const checkpoint = (): Promise<boolean> => timer.pause(() => slice.checkpoint());
		// Vocabulary, plan index and the surface draw are separate stretches.
		if (!(await checkpoint())) return { status: "stale" };

		let model: TargetModel;
		let result: TransformResult;
		try {
			timer.begin("presentationPlan");
			model = {
				...analyzed.model,
				index: createTargetPlanIndex(analyzed.model.projection, analyzed.model.located),
				tokenSequences: freezeAnalysis(analyzed.model.located.runs.map((run) => run.tokens.map((item) => item.token))),
				utf16: input.snapshot.text.length,
			};
			timer.end();
		} catch {
			return owned() ? { status: "analyze-error" } : { status: "stale" };
		}
		if (!(await checkpoint())) return { status: "stale" };
		try {
			timer.begin("surfaceTransform");
			result = transformTokenSequences(model.tokenSequences, model.vocabulary.automaticBody, input.bodySeed, input.bodySemantropy, true);
			timer.end();
		} catch {
			return owned() ? { status: "analyze-error" } : { status: "stale" };
		}
		if (!(await checkpoint())) return { status: "stale" };
		let dom: TargetDom | null;
		try {
			dom = await buildLegacyTargetDisplay(model, result.tokenSurfaces!, input.bodySeed, slice, timer, input.ownerDocument);
		} catch {
			return owned() ? { status: "render-error" } : { status: "stale" };
		}
		if (!dom || !owned()) return { status: "stale" };

		// Nothing was published before this point. The root is new and detached.
		timer.begin("commit");
		const root = input.ownerDocument.createElement("div");
		root.appendChild(dom.root);
		this.root = root;
		this.model = model;
		this.displayed = dom;
		this.revision += 1;
		this.observe(root);
		timer.end();
		this.lastReport = this.report("open", model, result.replacementCount, dom, timer, slice, firstTokenizeMs);
		return {
			status: "applied",
			analysis: {
				tokenSequences: model.tokenSequences,
				pool: model.vocabulary.automaticBody,
				replacementCount: result.replacementCount,
				replaceableSlotCount: result.replaceableSlotCount,
				bodySemantropy: result.bodySemantropy,
				algorithmVersion: result.algorithmVersion,
			},
		};
	}

	/** Primary surface draw only; candidate identities are resolved while preparing. */
	transform(seed: number, level: BodySemantropy): TransformResult {
		const model = this.model;
		if (!model) throw new Error("Target analysis is unavailable.");
		return { ...transformTokenSequences(model.tokenSequences, model.vocabulary.automaticBody, seed, level, true), displaySeed: seed };
	}

	/**
	 * Builds the next body off-screen in slices. The previous body stays on
	 * screen and untouched until the returned commit runs.
	 */
	async prepare(
		generation: number,
		result: Pick<TransformResult, "texts" | "tokenSurfaces" | "displaySeed" | "replacementCount">,
		input: { isCurrent: () => boolean; scheduler: CooperativeScheduler },
	): Promise<PreparedTargetBody> {
		const model = this.model, root = this.root, surfaces = result.tokenSurfaces, seed = result.displaySeed;
		// A released or replaced body means this work was superseded, not that it failed.
		if (!model || !root || generation !== this.generation) return { status: "stale" };
		if (!surfaces || seed === undefined || this.isTampered()) return { status: "failed" };
		if (surfaces.length !== model.located.runs.length || result.texts.length !== surfaces.length ||
			surfaces.some((run, index) => run.length !== model.located.runs[index]!.tokens.length || run.join("") !== result.texts[index])) {
			return { status: "failed" };
		}
		const ticket = ++this.ticket;
		const revision = this.revision;
		const parent = root.parentNode;
		const owned = (): boolean => input.isCurrent() && this.generation === generation && this.ticket === ticket && this.model === model;
		const slice = new CooperativeSlice(input.scheduler, owned);
		const timer = new PhaseTimer(() => input.scheduler.now());
		let dom: TargetDom | null;
		try {
			dom = await buildLegacyTargetDisplay(model, surfaces, seed, slice, timer, root.ownerDocument);
		} catch {
			return owned() ? { status: "failed" } : { status: "stale" };
		}
		if (!dom || !owned()) return { status: "stale" };
		const next = dom;
		return {
			status: "prepared",
			commit: () => {
				let current = false;
				try {
					current = input.isCurrent();
				} catch {
					current = false;
				}
				// The guard may have re-entered this controller: re-read everything after it.
				if (!current || ticket !== this.ticket || generation !== this.generation || revision !== this.revision ||
					model !== this.model || root !== this.root || root.parentNode !== parent || this.isTampered()) {
					return "stale";
				}
				timer.begin("commit");
				this.ticket += 1;
				root.replaceChildren(next.root);
				this.observer?.takeRecords();
				this.displayed = next;
				this.revision += 1;
				timer.end();
				this.lastReport = this.report("transform", model, result.replacementCount, next, timer, slice, null);
				return "applied";
			},
		};
	}

	/**
	 * Reads an explicit selection from the committed body as logical text:
	 * ruby readings and placeholder UI never contribute. A selection outside
	 * this body, from a replaced body, or over a body changed from outside is
	 * refused rather than guessed.
	 */
	readSelection(selection: BodySelectionSource | null): BodySelection {
		const root = this.root, displayed = this.displayed;
		if (!root || !displayed || !root.isConnected || this.isTampered()) return { status: "empty" };
		if (selection === null || selection.rangeCount !== 1) return { status: "empty" };
		let range;
		try {
			range = selection.getRangeAt(0);
		} catch {
			return { status: "empty" };
		}
		if (range.collapsed || !(range.commonAncestorContainer === root || root.contains(range.commonAncestorContainer))) {
			return { status: "empty" };
		}
		let text = "";
		try {
			if (!range.intersectsNode || !range.startContainer || !range.endContainer) {
				// Only a Range-shaped stand-in lacks these; refuse whenever the body
				// holds any non-logical text the plain string could include.
				if (displayed.bindings.some((b) => !b.logicalRange)) return { status: "empty" };
				text = range.toString();
			} else {
				for (const binding of displayed.bindings) {
					if (!binding.logicalRange || !range.intersectsNode(binding.node)) continue;
					const value = binding.node.data;
					const start = binding.node === range.startContainer ? range.startOffset ?? 0 : 0;
					const end = binding.node === range.endContainer ? range.endOffset ?? value.length : value.length;
					text += value.slice(start, end);
				}
			}
		} catch {
			return { status: "empty" };
		}
		return text.trim().length === 0 ? { status: "empty" } : { status: "selected", text };
	}


	private report(
		operation: TargetPhaseReport["operation"], model: TargetModel, replacements: number, dom: TargetDom,
		timer: PhaseTimer, slice: CooperativeSlice, firstTokenizeMs: number | null,
	): TargetPhaseReport {
		const stats = slice.stats();
		return {
			operation,
			utf16: model.utf16,
			blocks: model.projection.presentation.blocks.length,
			runs: model.located.runs.length,
			tokens: model.tokenSequences.reduce((sum, run) => sum + run.length, 0),
			annotations: model.located.runs.reduce((sum, run) => sum + run.run.annotations.length, 0),
			replacements,
			textNodes: dom.bindings.length,
			firstTokenizeMs,
			phases: { ...timer.phases },
			yields: stats.yields,
			maxContinuousMs: stats.maxContinuousMs,
		};
	}

	/** Any outside change to the committed body makes later commits and selections refuse. */
	private observe(root: HTMLElement): void {
		this.observer?.disconnect();
		this.tampered = false;
		const Observer = root.ownerDocument.defaultView?.MutationObserver;
		if (!Observer) {
			this.observer = null;
			return;
		}
		this.observer = new Observer(() => {
			this.tampered = true;
		});
		this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
	}

	private isTampered(): boolean {
		if (this.observer && this.observer.takeRecords().length > 0) this.tampered = true;
		return this.tampered;
	}
}

async function buildLegacyTargetDisplay(
	model: TargetModel, surfaces: readonly (readonly string[])[], seed: number,
	slice: CooperativeSlice, timer: PhaseTimer, ownerDocument: Document,
	adaptPlan: (plan: TargetDisplayPlan) => TargetDisplayPlan = plan => plan,
): Promise<TargetDom | null> {
	const checkpoint = (): Promise<boolean> => timer.pause(() => slice.checkpoint());
	timer.begin("candidateResolve");
	const context = createCandidateDrawContext(model.vocabulary, seed);
	const rendered = new Map<string, PresentationNode>();
	for (const [runIndex, sequence] of model.located.runs.entries()) {
		timer.begin("candidateResolve");
		const runSurfaces = surfaces[runIndex]!;
		const selections = sequence.tokens.map((item, index) => runSurfaces[index] === item.token.surface ? null : chooseVocabularyCandidate({
			vocabulary: model.vocabulary, original: item.token, surface: runSurfaces[index]!, seed, tokenId: item.tokenId, context,
		}));
		timer.begin("presentationPlan");
		rendered.set(sequence.run.runId, planTargetRun(model.index, runIndex, { vocabulary: model.vocabulary, surfaces: runSurfaces, selections, seed, context }));
		if (!(await checkpoint())) return null;
	}
	timer.begin("presentationPlan");
	const plan = adaptPlan(assembleTargetPlan(model.index, rendered));
	if (!(await checkpoint())) return null;
	timer.begin("domBuild");
	const dom = await buildSafeTargetDomIncremental(plan, ownerDocument, checkpoint);
	timer.end();
	return dom;
}

/** Slot draw is the production source of truth; no second candidate or Ruby draw. */
export async function buildTargetDisplay(
 model: TargetModel, runs: readonly DisplaySlotRunOutput[], markers: TargetSlotMarkers,
 slice: CooperativeSlice, timer: PhaseTimer, doc: Document,
 adaptPlan: (plan: TargetDisplayPlan) => TargetDisplayPlan = plan => plan,
): Promise<TargetDom | null> {
 const checkpoint = () => timer.pause(() => slice.checkpoint());
 const rendered = new Map<string, PresentationNode>();
 for (const [i, run] of runs.entries()) {
  timer.begin("presentationPlan");
  if (run.runId !== model.located.runs[i]?.run.runId) throw new Error(TARGET_RENDER_ERROR_MESSAGE);
  rendered.set(run.runId, planTargetSlotRun(model.index, i, run.slots));
  if (!(await checkpoint())) return null;
 }
 timer.begin("presentationPlan");
 const plan = adaptPlan(assembleTargetPlan(model.index, rendered));
 if (!(await checkpoint())) return null;
 timer.begin("domBuild");
 const dom = await buildSafeTargetDomIncremental(plan, doc, checkpoint, markers);
 timer.end(); return dom;
}
