import { automaticSelection } from "./automaticSelection";
import { type DisplaySlotPlan, type DisplaySlot, type DisplayMarkerVisibility, type ManualOverride } from "../analysis/displaySlots";
import { AutomaticPosBodyOwner } from "./automaticPosBodyOwner";
import { DEFAULT_AUTOMATIC_POS } from "../settings/automaticPosSettings";
import type { AutomaticPosOptions } from "../transform/automaticPosOptions";
import { MAX_BODY_ALGORITHM_VERSION } from "../transform/maxVersions";
import type { ManualAdverbReleaseReason } from "../transform/manualAdverbAuthority";
import { DEFAULT_DICTIONARY_SEMANTROPY, type DictionarySemantropy } from "../settings/dictionarySemantropy";
import { analyzeManualMorphSource, buildManualMorphVocabulary, isManualMorphVocabulary, type ManualMorphVocabulary, type ManualMorphSourceAnalysis } from "../transform/manualMorphology";
import { drawManualOverride } from "../analysis/manualDisplay";
import { snapshotRubyVocabulary, snapshotDictionaryPool } from "../application/prepareVocabulary";
import { type VocabularySnapshot, type VocabularyDrawMode } from "../vocabulary/vocabularySnapshot";
import { targetDomTransaction, captureTargetInteraction } from "./targetDomTransaction";
import type { SemantropyReadyAnalysis } from "../application/SemantropySession";
import type { SourceSnapshot } from "../application/SourceSnapshot";
import { buildTargetLineIndex, planTargetLineChunks, lineChunkRawRange, type TargetLineIndex, type TargetLineChunk, type TargetLineProjection } from "../analysis/targetChunkIr";
import { freezeAnalysis, type RubyVocabulary } from "../analysis/rubyVocabulary";
import { createTargetPlanIndex, planTargetSlotBlock, type PresentationElement, type PresentationNode } from "../analysis/targetPresentation";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import { type TransformResult } from "../transform/transformTokens";
import type { BodySelection, BodySelectionSource } from "../view/readBodySelection";
import { collectManualOverridesForRange } from "../application/manualCollectProvenance";
import type { CollectManualOverrideRecord } from "../collect/collectProvenance";
import { CooperativeSlice, type CooperativeScheduler } from "./cooperativeScheduler";
import { buildSafeTargetBlock, type TargetDom, type TargetDomBinding } from "./safeTargetDom";
import { buildTargetDisplay, PhaseTimer, type TargetModel, type TargetOpenResult, type PreparedTargetBody, type TargetPhaseReport } from "./targetBodyController";

/** Evaluation value, injectable by the host; not a public default or a setting. */
export const PROVISIONAL_TARGET_CHUNK_SIZE = 5000;
type ChunkModel = { index: TargetLineIndex; descriptor: TargetLineChunk; fragments: TargetLineProjection["blockFragments"]; model: TargetModel };
type MaterializedChunk = ChunkModel & { dom: TargetDom; displayRevision: number };
type AutomaticPrepared = ReturnType<AutomaticPosBodyOwner["draw"]>;
type SlotDraw = TransformResult & { plan: DisplaySlotPlan; automatic: AutomaticPrepared };
type SnapshotRuntime = {
 plan: DisplaySlotPlan;
 slots: ReadonlyMap<string, DisplaySlot>;
 dictionaryLevel: DictionarySemantropy;
 visibility: DisplayMarkerVisibility;
	index: TargetLineIndex;
	descriptors: readonly TargetLineChunk[];
	vocabulary: RubyVocabulary;
	vocabularySnapshot: VocabularySnapshot;
	activeVocabulary: ManualMorphVocabulary;
	dictionary: DictionaryVocabularyPool;
	chunks: readonly MaterializedChunk[];
	seed: number;
	level: BodySemantropy;
	analysis: SemantropyReadyAnalysis;
	options: AutomaticPosOptions;
	automatic: AutomaticPrepared;
};
import { type DictionaryVocabularyPool } from "../dictionary/vocabularyPool";

type Work = { isCurrent: () => boolean; scheduler: CooperativeScheduler };
export type TargetChunkLoadResult =
	| { status: "applied"; analysis: SemantropyReadyAnalysis }
	| { status: "stale" | "failed" | "complete" | "busy" };

/** Snapshot identity owns the canonical descriptors; only the committed prefix owns heavy state. */
export class ChunkTargetBodyController {
	private targetSource: ManualMorphSourceAnalysis | null = null;
	private targetIndex: TargetLineIndex | null = null;
	private targetDescriptors: readonly TargetLineChunk[] = [];
	private initialOptions: AutomaticPosOptions = DEFAULT_AUTOMATIC_POS;
	private readonly automaticOwners = new Map<ManualMorphVocabulary, AutomaticPosBodyOwner>();
	private preparedDraws = new WeakMap<object, { runtime: SnapshotRuntime; result: SlotDraw; seed: number; level: BodySemantropy; planningMs: number; clearManual: boolean }>();
	private readonly manualOverrides = new Map<string, ManualOverride>();
	private readonly manualRevisions = new Map<string, number>();
	private overrideOwners = new WeakMap<ManualOverride, { active: ManualMorphVocabulary; tokenId: string; targetRevision: number; generation: number }>();
 private root: HTMLElement | null = null;
	private runtime: SnapshotRuntime | null = null;
	private generation = 0;
	private revision = 0;
	private ticket = 0;
	private loading = false;
	private observer: MutationObserver | null = null;
	private tampered = false;
	private lastReport: TargetPhaseReport | null = null;
	/** Derived display-text lookups, discarded whenever the runtime changes. */
	private logicalCache: { runtime: SnapshotRuntime; text: string; nodes: Map<Text, { binding: TargetDomBinding; base: number }[]> | null } | null = null;

	release(reason: ManualAdverbReleaseReason = "view-close"): void {
		this.heldFocus?.();
		for (const owner of this.automaticOwners.values()) owner.release(reason);
		this.automaticOwners.clear(); this.targetSource = null; this.targetIndex = null; this.targetDescriptors = [];
		this.generation += 1; this.ticket += 1; this.loading = false;
		this.observer?.disconnect(); this.observer = null; this.tampered = false;
		this.runtime = null; this.lastReport = null; this.logicalCache = null;
		this.manualOverrides.clear(); this.manualRevisions.clear();
		this.overrideOwners = new WeakMap(); this.preparedDraws = new WeakMap();
		this.root?.remove(); this.root = null;
	}
	getDisplaySlotPlan(): DisplaySlotPlan | null { return this.runtime?.plan ?? null; }
	/**
	 * The slot this controller currently owns for one token id, or null when the
	 * committed plan no longer has it. Appending a Chunk rebuilds the plan without
	 * changing the loaded prefix, so a still-valid recorded selection is resolved
	 * by token identity here rather than by object identity, and the object handed
	 * back is always the one the Manual entry points will accept.
	 */
	getDisplaySlot(tokenId: string): DisplaySlot | null { return this.runtime?.slots.get(tokenId) ?? null; }
 getDictionarySemantropy(): DictionarySemantropy | null { return this.runtime?.dictionaryLevel ?? null; }
	/**
	 * Focus return is an owned, temporary attribute change, never a new binding.
	 *
	 * A browser moves focus away from an element that stops being focusable, so
	 * removing `tabindex` right after `focus()` sent focus to the document body.
	 * The word therefore keeps `tabindex="-1"` (focusable, never a Tab stop) only
	 * while it holds focus, and loses it on its first blur. Each change is this
	 * controller's own and is consumed from the observer as before; a word that
	 * has left the body meanwhile is simply cleaned up.
	 */
	focusSlotElement(element: HTMLElement, preventScroll = false): boolean {
		// Blur is not dispatched while the window lacks system focus, so an earlier word may
		// still hold its attribute: at most one word ever does, and it is released here.
		this.heldFocus?.();
		if (!this.getSlotForElement(element) || element.hasAttribute("tabindex")) return false;
		const consumeOwnAttribute = () => {
			const records = this.observer?.takeRecords() ?? [];
			if (records.length > 1 || records.some(record => record.type !== "attributes" || record.target !== element || record.attributeName !== "tabindex")) this.tampered = true;
		};
		const clear = () => {
			const owned = !!this.root?.contains(element);
			if (owned) this.isTampered();
			element.removeAttribute("tabindex");
			if (owned) consumeOwnAttribute();
		};
		element.setAttribute("tabindex", "-1"); consumeOwnAttribute();
		try { element.focus({ preventScroll }); }
		catch { clear(); return false; }
		if (element.ownerDocument.activeElement !== element) { clear(); return !this.isTampered(); }
		const release = () => { element.removeEventListener("blur", release); if (this.heldFocus === release) this.heldFocus = null; clear(); };
		element.addEventListener("blur", release); this.heldFocus = release;
		return !this.isTampered();
	}
	/** The one word currently keeping an owned `tabindex` for focus, released on blur or replacement. */
	private heldFocus: (() => void) | null = null;
 getMarkerVisibility(): DisplayMarkerVisibility { return this.runtime?.visibility ?? {}; }
 getSlotForElement(element: HTMLElement): DisplaySlot | null {
  if (!this.runtime || !this.root?.isConnected || !this.root.contains(element) || this.isTampered()) return null;
  for (const chunk of this.runtime.chunks) { const id = chunk.dom.elements?.get(element); if (id) return this.runtime.slots.get(id) ?? null; }
  return null;
 }
 getVocabularySnapshot(): VocabularySnapshot | null { return this.runtime?.vocabularySnapshot ?? null; }
	getVocabularyOwner(): ManualMorphVocabulary | null { return this.runtime?.activeVocabulary ?? null; }
	getAutomaticOptions(): AutomaticPosOptions { return this.runtime?.options ?? this.initialOptions; }
	getAutomaticProvenance() { return this.runtime?.automatic.result ?? null; }
	isAutomaticCurrent(): boolean { return this.runtime?.automatic.current() ?? false; }
	invalidateAutomatic(reason: ManualAdverbReleaseReason): void {
		this.ticket += 1;
		for (const owner of this.automaticOwners.values()) owner.release(reason);
	}
	getVocabularySources(): readonly ManualMorphSourceAnalysis[] | undefined { return this.runtime?.activeVocabulary.sources; }
	getDictionaryPool(): DictionaryVocabularyPool | undefined { return this.runtime?.dictionary; }
	getBodyGeneration(): number { return this.generation; }
	getContainer(): HTMLElement | null { return this.root; }
	getDisplayRevision(): number { return this.revision; }
	getManualOverrideCount(): number { return this.manualOverrides.size; }
	hasManualOverride(slot: DisplaySlot): boolean { return this.runtime?.slots.get(slot.tokenId) === slot && this.manualOverrides.has(slot.tokenId); }
	isDisplayIntact(): boolean { return !!this.root?.isConnected && !this.isTampered(); }
	getSequenceCount(): number { return this.runtime?.analysis.tokenSequences.length ?? 0; }
	getTextNodes(): readonly Text[] { return [...new Set(this.bindings().filter(b => b.logicalRange).map(b => b.node))]; }
	hasNext(): boolean { return !!this.runtime && this.runtime.chunks.length < this.runtime.descriptors.length; }
	takePhaseReport(): TargetPhaseReport | null { const result = this.lastReport; this.lastReport = null; return result; }
	/** Counts only, for automated and native evaluation; no note-derived strings. */
	getChunkStats(): { chunks: number; totalChunks: number; materializedUtf16: number; tokens: number; nodes: number } {
		return { chunks: this.runtime?.chunks.length ?? 0, totalChunks: this.runtime?.descriptors.length ?? 0,
			materializedUtf16: this.runtime?.chunks.at(-1)?.descriptor.rawRange.end ?? 0,
			tokens: this.runtime?.analysis.tokenSequences.reduce((n, r) => n + r.length, 0) ?? 0,
			nodes: this.root ? 1 + this.root.querySelectorAll("*").length + new Set(this.bindings().map(b => b.node)).size : 0 };
	}

	async open(input: Work & {
		snapshot: Pick<SourceSnapshot, "text" | "sourcePath" | "contentHash">;
		bodySeed: number; bodySemantropy: BodySemantropy; getTokenizer: () => JapaneseTokenizer;
		ownerDocument: Document; targetSize?: number; targetRevision?: number; dictionarySemantropy?: DictionarySemantropy; markerVisibility?: DisplayMarkerVisibility;
	vocabularySources?: readonly ManualMorphSourceAnalysis[]; drawMode?: VocabularyDrawMode;
	automaticPos?: AutomaticPosOptions;
	}): Promise<TargetOpenResult> {
		this.release();
		this.initialOptions = input.automaticPos ?? DEFAULT_AUTOMATIC_POS;
		const generation = this.generation;
		const owned = () => input.isCurrent() && this.generation === generation;
		const slice = new CooperativeSlice(input.scheduler, owned), timer = new PhaseTimer(() => input.scheduler.now());
		let phase: "analyze-error" | "render-error" = "analyze-error";
		let firstTokenizeMs: number | null = null;
		try {
			const tokenizer = input.getTokenizer();
			const measured: JapaneseTokenizer = { tokenize: async text => {
				const start = input.scheduler.now();
				try { return await tokenizer.tokenize(text); }
				finally { firstTokenizeMs ??= input.scheduler.now() - start; }
			} };
			timer.begin("projection");
			const index = buildTargetLineIndex(input.snapshot.text, input.targetRevision ?? generation);
			const descriptors = planTargetLineChunks(index, input.targetSize ?? PROVISIONAL_TARGET_CHUNK_SIZE);
			const checkpoint = () => timer.pause(() => slice.checkpoint());
			if (!(await checkpoint())) return { status: "stale" };
			const extracted = await analyzeManualMorphSource({ text: input.snapshot.text, sourcePath: input.snapshot.sourcePath,
				tokenizer: measured, isCurrent: owned, checkpoint, phase: name => timer.begin(name), mode: "target-prototype" });
			if (extracted.status === "error") return { status: "analyze-error" };
			if (extracted.status !== "ready" || !(await checkpoint())) return { status: "stale" };
			const sources = input.vocabularySources?.map(source => source.path === input.snapshot.sourcePath ? extracted.analysis : source) ?? [extracted.analysis];
			const activeVocabulary = buildManualMorphVocabulary({ sources, drawMode: input.drawMode ?? "uniform" });
			this.targetSource = extracted.analysis; this.targetIndex = index; this.targetDescriptors = descriptors;
			const vocabularySnapshot = activeVocabulary.snapshot;
			const vocabulary = snapshotRubyVocabulary(vocabularySnapshot);
			const models: ChunkModel[] = [];
			if (descriptors[0]) {
				const model = await this.materialize(index, descriptors[0], vocabulary, activeVocabulary, slice, timer);
				if (!model) return { status: "stale" };
				models.push(model);
			}
			timer.begin("surfaceTransform");
			const result = this.draw(models, activeVocabulary, input.bodySeed, input.bodySemantropy, input.dictionarySemantropy ?? DEFAULT_DICTIONARY_SEMANTROPY, index.targetRevision, this.revision + 1);
			phase = "render-error";
			const chunks = await this.display(models, result.plan, input.markerVisibility ?? {}, slice, timer, input.ownerDocument, 0);
			if (!chunks || !owned() || !result.automatic.current()) return { status: "stale" };
			timer.begin("commit");
			const root = input.ownerDocument.createElement("div");
			root.append(...chunks.map(c => c.dom.root));
			this.root = root;
			const analysis = this.analysis(models, vocabulary, result);
			this.runtime = { plan: result.plan, slots: this.slotMap(result.plan), dictionaryLevel: input.dictionarySemantropy ?? DEFAULT_DICTIONARY_SEMANTROPY, visibility: { ...input.markerVisibility }, index, descriptors, vocabulary, vocabularySnapshot, activeVocabulary, dictionary: snapshotDictionaryPool(vocabularySnapshot), chunks, seed: input.bodySeed, level: input.bodySemantropy, analysis, options: this.initialOptions, automatic: result.automatic };
			this.revision += 1; this.observe(root); timer.end();
			this.record("open", chunks, result, timer, slice, firstTokenizeMs);
			return { status: "applied", analysis };
		} catch { return owned() ? { status: phase } : { status: "stale" }; }
	}

	transform(seed: number, level: BodySemantropy): TransformResult {
		if (!this.runtime) throw new Error("Target analysis is unavailable.");
		const runtime = this.runtime, started = performance.now();
  const clearManual = seed !== runtime.seed;
  const result = this.draw(runtime.chunks, runtime.activeVocabulary, seed, level, runtime.dictionaryLevel, runtime.index.targetRevision, this.revision + 1, clearManual ? new Map() : this.manualOverrides);
  this.preparedDraws.set(result.tokenSurfaces!, { runtime, result, seed, level, planningMs: performance.now() - started, clearManual });
  return { ...result, displaySeed: seed };
	}

	/** Reversible participant in the plugin's all-View settings transaction.
	 * Preparation allocates only the already materialized prefix. Publication
	 * cannot advance runtime state; finalization follows every View's DOM check.
	 * A level change passes `level`; the Seed and Manual overrides are kept. */
	async prepareAutomatic(options: AutomaticPosOptions, input: Work, level?: BodySemantropy) {
		const runtime = this.runtime, root = this.root;
		if (!runtime || !root || !runtime.automatic.current()) return null;
		const ticket = this.ticket, revision = this.revision, parent = root.parentNode;
		const owned = () => input.isCurrent() && this.runtime === runtime && this.ticket === ticket;
		const slice = new CooperativeSlice(input.scheduler, owned), timer = new PhaseTimer(() => input.scheduler.now());
		let draw: SlotDraw | null = null;
		try {
			if (!(await slice.checkpoint())) return null;
			const nextLevel = level ?? runtime.level;
			draw = this.draw(runtime.chunks, runtime.activeVocabulary, runtime.seed, nextLevel, runtime.dictionaryLevel,
				runtime.index.targetRevision, revision + 1, this.manualOverrides, options);
			const prepared = draw;
			const chunks = await this.display(runtime.chunks, prepared.plan, runtime.visibility, slice, timer, root.ownerDocument, 0);
			const current = () => prepared.automatic.current() && this.canCommit(owned, root, parent, runtime, revision, ticket);
			if (!chunks || !current()) { prepared.automatic.release(); return null; }
			const next = { ...runtime, options, level: nextLevel, chunks, plan: prepared.plan, slots: this.slotMap(prepared.plan), automatic: prepared.automatic,
				analysis: this.analysis(chunks, runtime.vocabulary, prepared) };
			const selectionMap = automaticSelection(runtime.chunks.map(c => c.dom), chunks.map(c => c.dom));
			let dom: ReturnType<typeof targetDomTransaction> | null = null, committed = false;
			return { analysis: next.analysis, current, mapSelection: selectionMap.map,
				publish: () => {
					if (!current()) throw Error("Stale automatic publication.");
					const selection = root.ownerDocument.getSelection();
					const selected = this.readLogicalSelection(selection);
					const backward = !!selection && selection.rangeCount === 1 && selection.anchorNode === selection.getRangeAt(0).endContainer && selection.anchorOffset === selection.getRangeAt(0).endOffset;
					dom = targetDomTransaction(root, chunks.map(chunk => chunk.dom.root));
					this.observer?.disconnect();
					dom.publish();
					if (selection && selected) selectionMap.restore(selection, selected, backward);
					if (!current()) throw Error("Stale automatic publication.");
				},
				commit: () => {
					if (!current()) throw Error("Stale automatic publication.");
					this.runtime = next; this.ticket += 1; this.revision += 1; this.logicalCache = null; committed = true;
					this.observe(root);
				},
				rollback: () => {
					if (committed && this.runtime === next) { this.runtime = runtime; this.ticket = ticket; this.revision = revision; this.logicalCache = null; committed = false; }
					if (this.root === root) { this.observer?.disconnect(); dom?.rollback(); this.observe(root); }
				},
				dispose: () => { if (committed) runtime.automatic.release(); else prepared.automatic.release(); },
			};
		} catch { draw?.automatic.release(); return null; }
	}

	async prepare(generation: number,
		result: Pick<TransformResult, "texts" | "tokenSurfaces" | "displaySeed" | "replacementCount"> & { bodySemantropy?: BodySemantropy },
		input: Work): Promise<PreparedTargetBody> {
		const runtime = this.runtime, root = this.root;
		if (!runtime || !root || generation !== this.generation) return { status: "stale" };
		if (this.isTampered() || !result.tokenSurfaces || result.displaySeed === undefined) return { status: "failed" };
		const ticket = this.ticket, revision = this.revision, parent = root.parentNode;
		const owned = () => input.isCurrent() && this.runtime === runtime && this.ticket === ticket && this.generation === generation;
		const slice = new CooperativeSlice(input.scheduler, owned), timer = new PhaseTimer(() => input.scheduler.now());
		try {
			const draw = this.preparedDraws.get(result.tokenSurfaces);
   if (!draw || draw.runtime !== runtime || draw.seed !== result.displaySeed || (result.bodySemantropy !== undefined && result.bodySemantropy !== draw.level) || result.replacementCount !== draw.result.replacementCount ||
    result.texts.length !== draw.result.texts.length || result.texts.some((t, i) => t !== draw.result.texts[i])) return { status: "failed" };
   timer.phases.surfaceTransform = draw.planningMs;
   const chunks = await this.display(runtime.chunks, draw.result.plan, runtime.visibility, slice, timer, root.ownerDocument, 0);
			if (!chunks || !owned()) return { status: "stale" };
			return { status: "prepared", commit: accept => {
				if (!this.canCommit(owned, root, parent, runtime, revision, ticket) || !draw.result.automatic.current()) return "stale";
				timer.begin("commit");
    const dom = targetDomTransaction(root, chunks.map(c => c.dom.root));
    let accepted = false;
    try { accepted = accept ? accept(dom.publish) : (dom.publish(), true); if (!accepted) return "stale"; }
    finally { if (!accepted) dom.rollback(); this.observer?.takeRecords(); }
    this.ticket += 1; this.revision += 1;
    this.runtime = { ...runtime, chunks, plan: draw.result.plan, slots: this.slotMap(draw.result.plan),
     analysis: this.analysis(chunks, runtime.vocabulary, draw.result), seed: draw.seed, level: draw.level, automatic: draw.result.automatic };
				runtime.automatic.release();
				if (draw.clearManual) { this.manualOverrides.clear(); this.manualRevisions.clear(); this.overrideOwners = new WeakMap(); }
				timer.end(); this.record("transform", chunks, result, timer, slice, null);
				return "applied";
			} };
		} catch { return owned() ? { status: "failed" } : { status: "stale" }; }
	}

	/** onCommit must prepare session state, call publishDom synchronously once, then finalize by assignment. */
	async loadNext(input: Work & { seed: number; level: BodySemantropy; getTokenizer: () => JapaneseTokenizer; onCommit?: (analysis: SemantropyReadyAnalysis, publishDom: () => void) => boolean }): Promise<TargetChunkLoadResult> {
		if (this.loading) return { status: "busy" };
		const runtime = this.runtime, root = this.root;
		if (!runtime || !root || !root.isConnected) return { status: "stale" };
		const descriptor = runtime.descriptors[runtime.chunks.length];
		if (!descriptor) return { status: "complete" };
		if (this.isTampered()) return { status: "failed" };
		if (input.seed !== runtime.seed || input.level !== runtime.level) return { status: "stale" };
		this.loading = true;
		const ticket = this.ticket, generation = this.generation, revision = this.revision, parent = root.parentNode;
		const owned = () => input.isCurrent() && this.runtime === runtime && this.ticket === ticket && this.generation === generation;
		const slice = new CooperativeSlice(input.scheduler, owned), timer = new PhaseTimer(() => input.scheduler.now());
		try {
			const next = await this.materialize(runtime.index, descriptor, runtime.vocabulary, runtime.activeVocabulary, slice, timer);
			if (!next) return { status: "stale" };
			const models = [...runtime.chunks, next];
			timer.begin("surfaceTransform");
			const result = this.draw(models, runtime.activeVocabulary, input.seed, input.level, runtime.dictionaryLevel, runtime.index.targetRevision, this.revision);
			const chunks = await this.display(models, result.plan, runtime.visibility, slice, timer, root.ownerDocument, runtime.chunks.length);
			if (!chunks || !this.canCommit(owned, root, parent, runtime, revision, ticket) || !result.automatic.current()) return { status: "stale" };
			// Revalidate exact descriptor ownership immediately before append.
			lineChunkRawRange(runtime.index, descriptor, { start: 0, end: 0 });
			if (runtime.descriptors[runtime.chunks.length] !== descriptor) return { status: "stale" };
			const analysis = this.analysis(models, runtime.vocabulary, result);
			const committed = { ...runtime, plan: result.plan, slots: this.slotMap(result.plan), chunks: [...runtime.chunks, ...chunks], analysis, seed: input.seed, level: input.level, automatic: result.automatic };
			timer.begin("commit");
			const added = chunks[0]!.dom.root;
			let published = false;
			try {
				// The session prepares its next state, invokes this synchronous DOM step,
				// and only then finalizes state by assignment. No state is advanced if
				// append throws. Also undo an insertion whose wrapper throws afterwards.
				const publishDom = () => { root.appendChild(added); };
				if (input.onCommit) {
					if (!input.onCommit(analysis, publishDom)) return { status: "stale" };
				} else publishDom();
				published = true;
			} finally {
				if (!published && added.parentNode === root) root.removeChild(added);
				this.observer?.takeRecords();
			}
			this.ticket += 1;
			this.runtime = committed;
			runtime.automatic.release();
			timer.end(); this.record("load", chunks, result, timer, slice, null);
			return { status: "applied", analysis };
		} catch { return owned() ? { status: "failed" } : { status: "stale" }; }
		finally { if (this.generation === generation) this.loading = false; }
	}

	/** Stage only the loaded prefix. No runtime/ticket mutation until every publication succeeds. */
	async prepareVocabulary(activeVocabulary: ManualMorphVocabulary, input: Work): Promise<{
		analysis: SemantropyReadyAnalysis;
		commit: (accept: (analysis: SemantropyReadyAnalysis, publishDom: () => void) => boolean) => boolean;
	} | null> {
		const runtime = this.runtime, root = this.root;
		if (!runtime || !root || !isManualMorphVocabulary(activeVocabulary)) return null;
		const snapshot = activeVocabulary.snapshot;
		const ticket = this.ticket, revision = this.revision, parent = root.parentNode;
		const owned = () => input.isCurrent() && this.runtime === runtime && this.ticket === ticket;
		const slice = new CooperativeSlice(input.scheduler, owned), timer = new PhaseTimer(() => input.scheduler.now());
		const vocabulary = snapshotRubyVocabulary(snapshot), dictionary = snapshotDictionaryPool(snapshot);
		const models = runtime.chunks.map(chunk => ({ ...chunk, model: { ...chunk.model, vocabulary } }));
		const result = this.draw(models, activeVocabulary, runtime.seed, runtime.level, runtime.dictionaryLevel, runtime.index.targetRevision, this.revision + 1, new Map());
		const chunks = await this.display(models, result.plan, runtime.visibility, slice, timer, root.ownerDocument, 0);
		if (!chunks || !this.canCommit(owned, root, parent, runtime, revision, ticket)) return null;
		const analysis = this.analysis(models, vocabulary, result);
		const next = { ...runtime, plan: result.plan, slots: this.slotMap(result.plan), chunks, vocabulary, vocabularySnapshot: snapshot, activeVocabulary, dictionary, analysis, automatic: result.automatic };
		return { analysis, commit: accept => {
			if (!this.canCommit(owned, root, parent, runtime, revision, ticket) || !result.automatic.current()) return false;
			const dom = targetDomTransaction(root, chunks.map(chunk => chunk.dom.root));
			let accepted = false;
			try { accepted = accept(analysis, dom.publish); if (!accepted) return false; }
			finally { if (!accepted) dom.rollback(); this.observer?.takeRecords(); }
			this.runtime = next; this.ticket += 1; this.revision += 1; this.manualOverrides.clear(); this.manualRevisions.clear(); this.overrideOwners = new WeakMap();
			this.automaticOwners.get(runtime.activeVocabulary)?.release("apply"); this.automaticOwners.delete(runtime.activeVocabulary);
			return true;
		} };
	}

 private slotMap(plan: DisplaySlotPlan): ReadonlyMap<string, DisplaySlot> { return new Map(plan.slots.map(s => [s.tokenId, s])); }
 private automaticOwner(active: ManualMorphVocabulary): AutomaticPosBodyOwner {
  let owner = this.automaticOwners.get(active);
  if (!owner) {
   if (!this.targetSource || !this.targetIndex) throw Error("Invalid Target owner.");
   owner = new AutomaticPosBodyOwner(active, this.targetSource, this.targetIndex, this.targetDescriptors);
   this.automaticOwners.set(active, owner);
  }
  return owner;
 }
 private draw(chunks: readonly ChunkModel[], active: ManualMorphVocabulary, seed: number, level: BodySemantropy,
  dictionaryLevel: DictionarySemantropy, targetRevision: number, displayRevision: number,
  overrides: ReadonlyMap<string, ManualOverride> = this.manualOverrides, options = this.getAutomaticOptions()): SlotDraw {
  const automatic = this.automaticOwner(active).draw({ targetRevision, displayRevision, nonce: seed,
   level, dictionaryLevel, options,
   chunks: chunks.map(chunk => {
    lineChunkRawRange(chunk.index, chunk.descriptor, { start: 0, end: 0 });
    return { chunkId: chunk.descriptor.chunkId, runs: chunk.model.located.runs.map(({run, tokens}) =>
     ({ runId: run.runId, analysisText: run.analysisText, annotations: run.annotations, tokens })) };
   }) });
	  const plan = this.manualPlan(automatic.plan, active, overrides, chunks.length);
  const tokenSurfaces = plan.runs.map(run => run.slots.map(slot => slot.displaySurface));
  return { plan, automatic, tokenSurfaces, texts: tokenSurfaces.map(run => run.join("")),
   replacementCount: plan.replacementCount, replaceableSlotCount: plan.replaceableSlotCount,
   bodySemantropy: level, algorithmVersion: MAX_BODY_ALGORITHM_VERSION };
 }
	private manualPlan(plan: DisplaySlotPlan, active: ManualMorphVocabulary, overrides: ReadonlyMap<string, ManualOverride>, count = this.runtime?.chunks.length ?? 0): DisplaySlotPlan {
		for (const [tokenId, override] of overrides) {
			const owner = this.overrideOwners.get(override);
			if (!owner || owner.active !== active || owner.tokenId !== tokenId || owner.targetRevision !== plan.targetRevision || owner.generation !== this.generation) throw Error("Invalid Manual owner.");
		}
		return this.automaticOwner(active).applyManual(plan, overrides, count);
	}

	shuffleManual(slot: DisplaySlot): "applied" | "unavailable" | "stale" | "failed" {
		const runtime = this.runtime;
		if (!runtime || runtime.slots.get(slot.tokenId) !== slot || !slot.manualEligible || this.isTampered()) return "stale";
		if (slot.manualClass === "adverb") return slot.manualAvailable ? this.adverbManual(slot, "shuffle") : "unavailable";
		try {
			const localRevision = (this.manualRevisions.get(slot.tokenId) ?? 0) + 1;
			const run = runtime.plan.runs.find(run => run.chunkId === slot.chunkId && run.runId === slot.runId)!;
			const override = drawManualOverride(runtime.activeVocabulary, run.slots, slot, runtime.seed, localRevision);
			if (!override) return "unavailable";
			const result = this.setManual(slot, override);
			if (result === "applied") this.manualRevisions.set(slot.tokenId, localRevision);
			return result;
		} catch { return "failed"; }
	}

	restoreManual(slot: DisplaySlot): "applied" | "stale" | "failed" {
		if (this.runtime?.slots.get(slot.tokenId) !== slot || !slot.manualEligible) return "stale";
		if (slot.manualClass === "adverb") return this.adverbManual(slot, "restore-original");
		return this.setManual(slot, { kind: "restore-original", localRevision: this.manualRevisions.get(slot.tokenId) ?? 0 });
	}

	useAutomatic(slot: DisplaySlot): "applied" | "unavailable" | "stale" | "failed" {
		if (this.runtime?.slots.get(slot.tokenId) !== slot) return "stale";
		if (!this.manualOverrides.has(slot.tokenId)) return "unavailable";
		if (slot.manualClass === "adverb") return this.adverbManual(slot, "use-automatic");
		return this.setManual(slot, null);
	}

	clearManual(): "applied" | "unavailable" | "stale" | "failed" {
		if (!this.runtime || this.manualOverrides.size === 0) return "unavailable";
		const slots = [...this.manualOverrides.keys()].map(id => this.runtime!.slots.get(id)!);
		return this.commitManual(slots, new Map());
	}

	private adverbManual(slot: DisplaySlot, action: "shuffle" | "restore-original" | "use-automatic"): "applied" | "stale" | "failed" {
		const runtime = this.runtime;
		if (!runtime || !runtime.automatic.current()) return "stale";
		try {
			const revision = (this.manualRevisions.get(slot.tokenId) ?? 0) + 1;
			const prepared = this.automaticOwner(runtime.activeVocabulary).prepareManual(slot, action, runtime.seed, revision);
			const outcome = this.setManual(slot, prepared.override, prepared.commit);
			if (outcome === "applied") this.manualRevisions.set(slot.tokenId, revision); else prepared.cancel();
			return outcome;
		} catch { return "failed"; }
	}
	private setManual(slot: DisplaySlot, override: ManualOverride | null, accept?: () => boolean): "applied" | "stale" | "failed" {
		if (override && this.runtime) this.overrideOwners.set(override, { active: this.runtime.activeVocabulary, tokenId: slot.tokenId, targetRevision: slot.targetRevision, generation: this.generation });
		const next = new Map(this.manualOverrides);
		if (override) next.set(slot.tokenId, override); else next.delete(slot.tokenId);
		return this.commitManual([slot], next, accept);
	}

	private commitManual(slots: readonly DisplaySlot[], nextOverrides: ReadonlyMap<string, ManualOverride>, accept?: () => boolean): "applied" | "stale" | "failed" {
		const runtime = this.runtime, root = this.root;
		if (!runtime || !root || !slots.length || slots.some(slot => runtime.slots.get(slot.tokenId) !== slot || slot.displayRevision !== runtime.plan.displayRevision) || this.isTampered()) return "stale";
		try {
			const nextPlan = this.manualPlan({ ...runtime.plan, displayRevision: this.revision + 1 }, runtime.activeVocabulary, nextOverrides);
			const nextSlots = this.slotMap(nextPlan);
			const grouped = new Map<string, { i: number; blockIndex: number; part: PresentationElement; tokenIds: string[] }>();
			for (const slot of slots) {
				const i = runtime.chunks.findIndex(chunk => chunk.descriptor.chunkId === slot.chunkId);
				const chunk = runtime.chunks[i]; if (!chunk) throw Error();
				const blockIndex = chunk.model.index.projection.presentation.blocks.findIndex(block => block.items.some(item => item.kind === "run" && item.runId === slot.runId));
				if (blockIndex < 0) throw Error();
				const key = `${i}:${blockIndex}`;
				const prior = grouped.get(key);
				if (prior) prior.tokenIds.push(slot.tokenId);
				else {
					const runSlots = new Map(nextPlan.runs.filter(run => run.chunkId === slot.chunkId).map(run => [run.runId, run.slots] as const));
					const block = planTargetSlotBlock(chunk.model.index, runSlots, slot.runId); if (!block || block.blockIndex !== blockIndex) throw Error();
					grouped.set(key, { i, blockIndex, part: block.part, tokenIds: [slot.tokenId] });
				}
			}
			const patches = [...grouped.values()].map(group => {
				const chunk = runtime.chunks[group.i]!;
				const blocks = chunk.model.index.projection.presentation.blocks;
				const visibleIndex = blocks.slice(0, group.blockIndex).filter(block => !block.hidden).length;
				const old = chunk.dom.root.children.item(visibleIndex) as HTMLElement | null;
				if (!old?.parentNode || !root.contains(old) || old.tagName.toLowerCase() !== group.part.tag ||
					group.tokenIds.some(id => ![...chunk.dom.elements!].some(([element, owned]) => owned === id && old.contains(element)))) throw Error();
				const ranges = chunk.dom.bindings.flatMap(binding => old.contains(binding.node) && binding.logicalRange ? [binding.logicalRange] : []);
				if (!ranges.length) throw Error();
				const n = buildSafeTargetBlock(group.part, root.ownerDocument, { slots: nextSlots, visibility: runtime.visibility });
				if (old.classList.contains("semantropy-continued-block")) n.root.classList.add("semantropy-continued-block");
				const planIndex = chunk.dom.plan.root.children.findIndex((node, index) => node.kind === "element" &&
					chunk.dom.plan.root.children.slice(0, index).filter(child => child.kind === "element").length === visibleIndex);
				if (planIndex < 0) throw Error();
				return { i: group.i, o: old, a: Math.min(...ranges.map(range => range.start)), b: Math.max(...ranges.map(range => range.end)), n, planIndex };
			});
			const chunks = [...runtime.chunks];
			patches.sort((a, b) => b.i - a.i || b.a - a.a);
			for (const patch of patches) {
				const chunk = chunks[patch.i]!, start = patch.a, end = patch.b;
				const delta = patch.n.plan.logicalText.length - end + start;
				const inserted = patch.n.bindings.map(binding => ({ ...binding, logicalRange: binding.logicalRange ? { start: start + binding.logicalRange.start, end: start + binding.logicalRange.end } : null }));
				const first = chunk.dom.bindings.findIndex(binding => patch.o.contains(binding.node));
				const bindings = chunk.dom.bindings.filter(binding => !patch.o.contains(binding.node)).map(binding => binding.logicalRange && binding.logicalRange.start >= end
					? { ...binding, logicalRange: { start: binding.logicalRange.start + delta, end: binding.logicalRange.end + delta } } : binding);
				bindings.splice(first, 0, ...inserted);
				const elements = new Map(chunk.dom.elements); for (const element of elements.keys()) if (patch.o.contains(element)) elements.delete(element);
				for (const [element, id] of patch.n.elements ?? []) elements.set(element, id);
				const text = chunk.dom.plan.logicalText;
				const planChildren = [...chunk.dom.plan.root.children]; planChildren[patch.planIndex] = patch.n.plan.root;
				chunks[patch.i] = { ...chunk, dom: { ...chunk.dom, bindings, elements, plan: { root: { ...chunk.dom.plan.root, children: planChildren }, logicalText: text.slice(0, start) + patch.n.plan.logicalText + text.slice(end) } }, displayRevision: nextPlan.displayRevision };
			}
			const published: typeof patches = [];
			const selection = root.ownerDocument.getSelection();
			const selected = this.readLogicalSelection(selection);
			const range = selected && selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
			const changedIds = new Set(slots.map(slot => slot.tokenId));
			const touchesChangedSlot = !!range && runtime.chunks.some(chunk => [...chunk.dom.elements ?? []].some(([element, id]) => changedIds.has(id) && range.intersectsNode(element)));
			const backward = !!selection && selection.rangeCount === 1 && selection.anchorNode === selection.getRangeAt(0).endContainer && selection.anchorOffset === selection.getRangeAt(0).endOffset;
			const selectionMap = selected && !touchesChangedSlot ? automaticSelection(runtime.chunks.map(chunk => chunk.dom), chunks.map(chunk => chunk.dom)) : null;
			const interaction = captureTargetInteraction(root);
			this.observer?.disconnect();
			try {
				for (const patch of patches) try { patch.o.parentNode!.replaceChild(patch.n.root, patch.o); }
				finally { if (root.contains(patch.n.root)) published.push(patch); }
				if (selection && selected) selectionMap?.restore(selection, selected, backward);
				interaction.restoreScroll();
				if (!runtime.automatic.current() || (accept && !accept())) throw Error("Stale Manual publication.");
				for (const [id, value] of this.manualOverrides) if (nextOverrides.get(id) !== value) this.overrideOwners.delete(value);
				this.manualOverrides.clear(); for (const [id, value] of nextOverrides) this.manualOverrides.set(id, value);
				this.runtime = { ...runtime, plan: nextPlan, slots: nextSlots, chunks };
				this.ticket += 1; this.revision += 1; this.logicalCache = null; this.observe(root); return "applied";
			} catch {
				for (const patch of published.reverse()) {
					const parent = patch.n.root.parentNode;
					// Avoid the publication method on rollback: it may be the failing host hook.
					if (parent) { parent.insertBefore(patch.o, patch.n.root); parent.removeChild(patch.n.root); }
				}
				interaction.rollback();
				this.observe(root); return "failed";
			}
		} catch { return "failed"; }
	}

 /** Replan only availability for Dictionary changes; visibility alone reuses the exact plan. */
 async prepareMarkers(dictionaryLevel: DictionarySemantropy, visibility: DisplayMarkerVisibility, input: Work): Promise<PreparedTargetBody> {
  const runtime = this.runtime, root = this.root;
  if (!runtime || !root) return { status: "stale" };
  const ticket = this.ticket, revision = this.revision, parent = root.parentNode;
  const owned = () => input.isCurrent() && this.runtime === runtime && this.ticket === ticket;
  const slice = new CooperativeSlice(input.scheduler, owned), timer = new PhaseTimer(() => input.scheduler.now());
  try {
   timer.begin("surfaceTransform");
   const plan = dictionaryLevel === runtime.dictionaryLevel ? runtime.plan :
    this.manualPlan(runtime.automatic.replan(dictionaryLevel, runtime.plan.displayRevision), runtime.activeVocabulary, this.manualOverrides);
   const nextVisibility = { ...visibility };
   const chunks = await this.display(runtime.chunks, plan, nextVisibility, slice, timer, root.ownerDocument, 0);
   if (!chunks || !owned()) return { status: "stale" };
   return { status: "prepared", commit: accept => {
    if (!this.canCommit(owned, root, parent, runtime, revision, ticket)) return "stale";
    const dom = targetDomTransaction(root, chunks.map(c => c.dom.root));
    let accepted = false;
    try { accepted = accept ? accept(dom.publish) : (dom.publish(), true); if (!accepted) return "stale"; }
    finally { if (!accepted) dom.rollback(); this.observer?.takeRecords(); }
    this.runtime = { ...runtime, chunks, plan, slots: this.slotMap(plan), dictionaryLevel, visibility: nextVisibility };
    this.ticket += 1; return "applied";
   } };
  } catch { return owned() ? { status: "failed" } : { status: "stale" }; }
 }

	private analysis(chunks: readonly ChunkModel[], vocabulary: RubyVocabulary, result: TransformResult): SemantropyReadyAnalysis {
		return { tokenSequences: chunks.flatMap(c => c.model.tokenSequences), pool: vocabulary.automaticBody,
			replacementCount: result.replacementCount, replaceableSlotCount: result.replaceableSlotCount,
			bodySemantropy: result.bodySemantropy, algorithmVersion: result.algorithmVersion };
	}
	private async materialize(index: TargetLineIndex, descriptor: TargetLineChunk, vocabulary: RubyVocabulary,
		active: ManualMorphVocabulary, slice: CooperativeSlice, timer: PhaseTimer): Promise<ChunkModel | null> {
		const checkpoint = () => timer.pause(() => slice.checkpoint());
		if (!(await checkpoint())) return null;
		timer.begin("projection");
		const count = this.targetDescriptors.indexOf(descriptor) + 1;
		const prepared = this.automaticOwner(active).prefix(count).chunks[count - 1];
		if (!prepared) throw Error("Invalid Target prefix.");
		const { projection, blockFragments: fragments, located } = prepared, runs = located.runs;
		if (!(await checkpoint())) return null;
		const model: TargetModel = { projection, located, vocabulary, index: createTargetPlanIndex(projection, located),
			tokenSequences: freezeAnalysis(runs.map(r => r.tokens.map(t => t.token))), utf16: descriptor.rawRange.end - descriptor.rawRange.start };
		return { index, descriptor, fragments, model };
	}
	private async display(models: readonly ChunkModel[], plan: DisplaySlotPlan, visibility: DisplayMarkerVisibility,
		slice: CooperativeSlice, timer: PhaseTimer, doc: Document, from: number): Promise<MaterializedChunk[] | null> {
  const markers = { slots: this.slotMap(plan), visibility };
		let offset = 0;
		const output: MaterializedChunk[] = [];
		for (const [i, chunk] of models.entries()) {
			const size = chunk.model.located.runs.length, chunkRuns = plan.runs.slice(offset, offset + size);
   if (chunkRuns.length !== size || chunkRuns.some(r => r.chunkId !== chunk.descriptor.chunkId)) throw new Error("Invalid Target slots.");
			offset += size;
			if (i < from) continue;
			const absolute = (node: PresentationNode): PresentationNode => node.kind === "text"
				? { ...node, rawRanges: node.rawRanges.map(r => lineChunkRawRange(chunk.index, chunk.descriptor, r)) }
				: { ...node, children: node.children.map(absolute) };
			const dom = await buildTargetDisplay(chunk.model, chunkRuns, markers, slice, timer, doc,
				plan => ({ ...plan, root: { ...plan.root, children: plan.root.children.map(absolute) } }));
			if (!dom) return null;
			// Canonical block identity supplies the seam; no separator for a continued paragraph.
			// A hidden block (a closed leading frontmatter) has no element, so it neither
			// precedes a seam nor takes a position among this Chunk's block elements.
			const shown = chunk.fragments.filter(fragment => !fragment.hidden);
			const previous = models.slice(0, i).flatMap(c => c.fragments).filter(fragment => !fragment.hidden).at(-1);
			if (previous && shown[0] && previous.blockIndex !== shown[0].blockIndex) {
				const node = doc.createTextNode("\n\n"); dom.root.prepend(node);
				const prefix: TargetDomBinding = { node, logicalRange: { start: 0, end: 2 }, presentation: { kind: "text", text: "\n\n", logical: true, rawRanges: [], sourceParts: [] } };
				dom.bindings = [prefix, ...dom.bindings.map(b => ({ ...b, logicalRange: b.logicalRange ? { start: b.logicalRange.start + 2, end: b.logicalRange.end + 2 } : null }))];
				dom.plan = { root: { ...dom.plan.root, children: [prefix.presentation, ...dom.plan.root.children] }, logicalText: "\n\n" + dom.plan.logicalText };
			}
			const blocks = Array.from(dom.root.children);
			for (const [b, fragment] of shown.entries()) if (fragment.continuesAfter) blocks[b]!.classList.add("semantropy-continued-block");
			output.push({ ...chunk, dom, displayRevision: plan.displayRevision });
		}
		return output;
	}
	private bindings(): readonly TargetDomBinding[] { return this.runtime?.chunks.flatMap(c => c.dom.bindings) ?? []; }

	/**
	 * The displayed parent string of every materialized Chunk, in document
	 * order. Ruby readings and `rp` are not part of it, because they are not
	 * logical presentation text, and neither are Toolbar, status or Load
	 * controls, which live outside this controller's root entirely.
	 *
	 * It is recomputed only when the committed runtime changes, so recording a
	 * selection during a drag costs a map lookup rather than a rebuild.
	 */
	getLogicalText(): string {
		const runtime = this.runtime;
		if (!runtime) return "";
		if (this.logicalCache?.runtime !== runtime) {
			this.logicalCache = { runtime, text: runtime.chunks.map(chunk => chunk.dom.plan.logicalText).join(""), nodes: null };
		}
		return this.logicalCache.text;
	}

	/**
	 * Manual overrides whose displayed token range intersects a logical
	 * selection. Partial coverage still counts. Surfaces are not searched.
	 */
	manualOverridesForLogicalRange(start: number, end: number): readonly CollectManualOverrideRecord[] {
		if (!this.runtime || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) return [];
		const slotRanges = new Map<string, { start: number; end: number }>();
		for (const { binding, base } of this.globalBindings()) {
			const tokenId = binding.presentation.tokenId;
			const logical = binding.logicalRange;
			if (!tokenId || !logical) continue;
			const from = base + logical.start;
			const to = base + logical.end;
			const existing = slotRanges.get(tokenId);
			if (!existing) slotRanges.set(tokenId, { start: from, end: to });
			else slotRanges.set(tokenId, { start: Math.min(existing.start, from), end: Math.max(existing.end, to) });
		}
		return collectManualOverridesForRange({
			range: { start, end },
			slotOrder: this.runtime.plan.slots.map(slot => slot.tokenId),
			slotRanges,
			overrides: this.manualOverrides,
		});
	}

	/** Logical bindings by their Text node, built once per committed runtime. */
	private nodeIndex(): ReadonlyMap<Text, readonly { binding: TargetDomBinding; base: number }[]> {
		this.getLogicalText();
		const cache = this.logicalCache!;
		if (!cache.nodes) {
			const index = new Map<Text, { binding: TargetDomBinding; base: number }[]>();
			for (const entry of this.globalBindings()) {
				if (!entry.binding.logicalRange) continue;
				const existing = index.get(entry.binding.node);
				if (existing) existing.push(entry);
				else index.set(entry.binding.node, [entry]);
			}
			cache.nodes = index;
		}
		return cache.nodes;
	}

	/**
	 * The logical offset of one selection endpoint, or null when it cannot be
	 * mapped — a reading, a non-text container, a node this body does not own.
	 * A null is never approximated by the caller.
	 */
	private logicalOffsetAt(node: Node, offset: number, side: "start" | "end"): number | null {
		const entries = node.nodeType === 3 ? this.nodeIndex().get(node as Text) : undefined;
		if (!entries) return null;
		for (const { binding, base } of entries) {
			const logical = binding.logicalRange!;
			const from = binding.nodeRange?.start ?? 0;
			const to = binding.nodeRange?.end ?? binding.node.length;
			const inside = side === "start" ? offset >= from && offset < to : offset > from && offset <= to;
			if (inside || (offset === from && offset === to)) return base + logical.start + (offset - from);
		}
		// A caret exactly at the far edge of the last part is still on the body.
		const last = entries.at(-1);
		if (last && offset === (last.binding.nodeRange?.end ?? last.binding.node.length)) {
			return last.base + last.binding.logicalRange!.end;
		}
		return null;
	}

	/** Bindings paired with the offset of their Chunk inside the logical text. */
	private globalBindings(): readonly { binding: TargetDomBinding; base: number }[] {
		const output: { binding: TargetDomBinding; base: number }[] = [];
		let base = 0;
		for (const chunk of this.runtime?.chunks ?? []) {
			for (const binding of chunk.dom.bindings) output.push({ binding, base });
			base += chunk.dom.plan.logicalText.length;
		}
		return output;
	}

	/**
	 * Maps an explicit DOM selection onto the logical text, so it can outlive
	 * the exact Text nodes it was made in. The result is a half-open interval
	 * plus the string it covered; it carries no node, no Range and no metadata,
	 * and is refused outright when the mapped interval does not reproduce the
	 * displayed text exactly. `Range.toString()` is never the authority: a
	 * selection whose endpoints cannot be mapped is rejected, not guessed.
	 */
	readLogicalSelection(selection: BodySelectionSource | null): { start: number; end: number; text: string } | null {
		if (!this.runtime || !this.root?.isConnected || this.isTampered() || selection?.rangeCount !== 1) return null;
		try {
			const range = selection.getRangeAt(0);
			if (range.collapsed) return null;
			if (!(range.commonAncestorContainer === this.root || this.root.contains(range.commonAncestorContainer))) return null;
			// The common case — a drag or a Shift+arrow between two displayed
			// characters — is two endpoint lookups, with no walk over the body.
			if (range.startContainer && range.endContainer) {
				const from = this.logicalOffsetAt(range.startContainer, range.startOffset ?? 0, "start");
				const to = this.logicalOffsetAt(range.endContainer, range.endOffset ?? 0, "end");
				if (from !== null && to !== null && to > from) {
					const text = this.getLogicalText().slice(from, to);
					return text.trim() ? { start: from, end: to, text } : null;
				}
			}
			if (this.readSelection(selection).status !== "selected") return null;
			if (!range.intersectsNode || !range.startContainer || !range.endContainer) return null;
			let start: number | null = null, end = 0, text = "";
			for (const { binding, base } of this.globalBindings()) {
				const logical = binding.logicalRange;
				if (!logical || !range.intersectsNode(binding.node)) continue;
				const nodeStart = binding.nodeRange?.start ?? 0;
				const from = Math.max(nodeStart, binding.node === range.startContainer ? range.startOffset ?? 0 : 0);
				const to = Math.min(binding.nodeRange?.end ?? binding.node.length,
					binding.node === range.endContainer ? range.endOffset ?? binding.node.length : binding.node.length);
				if (to <= from) continue;
				const logicalFrom = base + logical.start + (from - nodeStart);
				if (start === null) start = logicalFrom;
				else if (logicalFrom !== end) return null;
				end = logicalFrom + (to - from);
				text += binding.node.data.slice(from, to);
			}
			if (start === null || !text.trim()) return null;
			return this.getLogicalText().slice(start, end) === text ? { start, end, text } : null;
		} catch { return null; }
	}

	/**
	 * Re-reads a recorded interval against the body on screen now. It returns
	 * the current string for that interval, or null when the interval no
	 * longer fits — the caller compares it with what was recorded and never
	 * searches for the text somewhere else.
	 */
	resolveLogicalRange(start: number, end: number): string | null {
		if (!this.runtime || !this.root?.isConnected || this.isTampered()) return null;
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
		const text = this.getLogicalText();
		return end <= text.length ? text.slice(start, end) : null;
	}

	readSelection(selection: BodySelectionSource | null): BodySelection {
		const root = this.root;
		if (!root || !root.isConnected || this.isTampered() || selection?.rangeCount !== 1) return { status: "empty" };
		try {
			const range = selection.getRangeAt(0);
			if (range.collapsed || !(range.commonAncestorContainer === root || root.contains(range.commonAncestorContainer))) return { status: "empty" };
			if (range.startContainer === root && range.endContainer === root && range.startOffset === 0 && range.endOffset === root.childNodes.length) {
    const text = this.runtime!.chunks.map(c => c.dom.plan.logicalText).join("");
    return text.trim() ? { status: "selected", text } : { status: "empty" };
   }
   const bindings = this.bindings();
			let text = "";
			if (!range.intersectsNode || !range.startContainer || !range.endContainer) {
				if (bindings.some(b => !b.logicalRange)) return { status: "empty" };
				text = range.toString();
			} else for (const b of bindings) {
				if (!b.logicalRange || !range.intersectsNode(b.node)) continue;
				const start = Math.max(b.nodeRange?.start ?? 0, b.node === range.startContainer ? range.startOffset ?? 0 : 0);
    const end = Math.min(b.nodeRange?.end ?? b.node.length, b.node === range.endContainer ? range.endOffset ?? b.node.length : b.node.length);
    if (end > start) text += b.node.data.slice(start, end);
			}
			return text.trim() ? { status: "selected", text } : { status: "empty" };
		} catch { return { status: "empty" }; }
	}
 /** Exact logical coverage of one contextual slot, including all of its inline/Ruby parts. */
 readSelectedSlot(selection: BodySelectionSource | null): DisplaySlot | null {
  if (!this.runtime || this.readSelection(selection).status !== "selected") return null;
  try {
   const range = selection!.getRangeAt(0);
   if (!range.intersectsNode || !range.startContainer || !range.endContainer) return null;
   const inReading = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest("rt, rp");
   if (inReading(range.startContainer) || inReading(range.endContainer)) return null;
   let id: string | undefined, length = 0;
   for (const b of this.bindings()) {
    if (!b.logicalRange || !range.intersectsNode(b.node)) continue;
    const start = Math.max(b.nodeRange?.start ?? 0, b.node === range.startContainer ? range.startOffset ?? 0 : 0);
    const end = Math.min(b.nodeRange?.end ?? b.node.length, b.node === range.endContainer ? range.endOffset ?? b.node.length : b.node.length);
    if (end <= start) continue;
    if (!b.presentation.tokenId || (id && id !== b.presentation.tokenId)) return null;
    id = b.presentation.tokenId; length += end - start;
   }
   const slot = id ? this.runtime.slots.get(id) : null;
   return slot && length === slot.displaySurface.length ? slot : null;
  } catch { return null; }
 }

	private canCommit(owned: () => boolean, root: HTMLElement, parent: Node | null, runtime: SnapshotRuntime, revision: number, ticket: number): boolean {
		try {
   if (!owned()) return false;
   for (const [i, chunk] of runtime.chunks.entries()) {
    if (chunk.index !== runtime.index || chunk.descriptor !== runtime.descriptors[i]) return false;
    lineChunkRawRange(runtime.index, chunk.descriptor, { start: 0, end: 0 });
   }
  } catch { return false; }
		return this.root === root && root.parentNode === parent && root.isConnected && this.runtime === runtime &&
			this.revision === revision && this.ticket === ticket && !this.isTampered();
	}
	private observe(root: HTMLElement): void {
		this.observer?.disconnect(); this.tampered = false;
		const Observer = root.ownerDocument.defaultView?.MutationObserver;
		if (Observer) { this.observer = new Observer(() => { this.tampered = true; });
			this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true }); }
	}
	private isTampered(): boolean {
		if (this.observer?.takeRecords().length) this.tampered = true;
		return this.tampered;
	}
	private record(operation: TargetPhaseReport["operation"], chunks: readonly MaterializedChunk[], result: { replacementCount: number },
		timer: PhaseTimer, slice: CooperativeSlice, firstTokenizeMs: number | null): void {
		this.lastReport = { operation, utf16: chunks.reduce((n, c) => n + c.model.utf16, 0),
			blocks: chunks.reduce((n, c) => n + c.fragments.length, 0), runs: chunks.reduce((n, c) => n + c.model.located.runs.length, 0),
			tokens: chunks.reduce((n, c) => n + c.model.tokenSequences.reduce((s, r) => s + r.length, 0), 0),
			annotations: chunks.reduce((n, c) => n + c.model.located.runs.reduce((s, r) => s + r.run.annotations.length, 0), 0),
			replacements: result.replacementCount, textNodes: chunks.reduce((n, c) => n + new Set(c.dom.bindings.map(b => b.node)).size, 0),
			firstTokenizeMs, phases: { ...timer.phases }, ...slice.stats() };
	}
}
