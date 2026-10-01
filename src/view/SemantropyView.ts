import { cachedDefinitionCommit, DefinitionCache, definitionCacheKey } from "../application/definitionCache";
import type { AutomaticPosCoordinator, AutomaticSettingsChange, AutomaticViewParticipant, AutomaticViewClaim } from "../application/AutomaticPosCoordinator";
import { AutomaticPosSettingsController } from "../settings/AutomaticPosSettingsController";
import { DEFAULT_AUTOMATIC_POS } from "../settings/automaticPosSettings";
import type { AutomaticPosOptions } from "../transform/automaticPosOptions";
import { AutomaticPosToolbar } from "./AutomaticPosToolbar";
import { generateFakeDefinition } from "../dictionary/generateFakeDefinition";
import { DictionaryPopoverController, type DictionaryHoverTarget } from "./DictionaryPopoverController";
import { dictionaryDiagnostics, dictionaryDiagnosticMessage, type DictionaryDiagnostics } from "./dictionaryDiagnosticModel";
import type { VocabularySnapshot } from "../vocabulary/vocabularySnapshot";
import type { DisplayMarkerVisibility, DisplaySlot } from "../analysis/displaySlots";
import { targetDomTransaction } from "../render/targetDomTransaction";
import { prepareVocabulary, initialVocabularySelection, selectionSourceWeights, vocabularyPaths, VOCABULARY_DRAW_MODE_SAVE_ERROR, VOCABULARY_PREPARATION_ERROR, VOCABULARY_REFRESH_REQUIRED, type VocabularySelection } from "../application/prepareVocabulary";
import { enclosedTermSyntax, type EnclosedTermDelimiter } from "../vocabulary/enclosedTerms";
import { dictionaryAltLabel } from "./dictionaryModifierLabel";
import { VocabularyControls, type VocabularySourceIssue } from "./VocabularyControls";
import { VocabularyModal } from "./VocabularyModal";
import { overlayBounds, placeOverlay } from "./overlayPlacement";
import { CooperativeSlice } from "../render/cooperativeScheduler";
import { ItemView, Platform, type IconName, type WorkspaceLeaf } from "obsidian";
import type { ManualMorphVocabulary } from "../transform/manualMorphology";
import { CollisionSession } from "./CollisionSession";
import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";
import { CollisionModal } from "./CollisionModal";
import { FakeProverbSession } from "./FakeProverbSession";
import { FakeProverbModal } from "./FakeProverbModal";
import { RecomposeModal } from "./RecomposeModal";
import { ANALYZE_ERROR_MESSAGE } from "../application/analyzeNoteTexts";
import { bodyFragmentFromAutomatic } from "../application/bodyFragmentFromAutomatic";
import { collectVocabularyFromSnapshot } from "../application/collectVocabulary";
import {
	RESHUFFLE_ERROR_MESSAGE,
	RESHUFFLING_MESSAGE,
} from "../application/reshuffleNote";
import {
	BODY_LEVEL_ERROR_MESSAGE,
	BODY_LEVEL_UPDATING_MESSAGE,
	runChangeBodySemantropyGuarded,
	type BodyLevelChangeOutcome,
} from "../application/changeBodySemantropy";
import { runReshuffleGuarded, type ReshuffleOutcome } from "../application/runReshuffle";
import {
	runRefreshTarget,
	REFRESH_ERROR_MESSAGE,
	type BusyGuard,
	type RefreshOutcome,
} from "../application/refreshSource";
import {
	checkSourceFreshness,
	type FreshnessCheckResult,
} from "../application/sourceFreshness";
import { SourceChangeWatch } from "../application/sourceChangeWatch";
import {
	runDefineSelectedWord,
	type DefineGenerate,
} from "../application/defineSelectedWord";
import { fakeDictionaryCanonicalText, fakeDictionaryFragmentFromCurrent } from "../application/fakeDictionaryFragmentFromReady";
import {
	COPY_DEFINITION_EMPTY_MESSAGE,
	COPY_DEFINITION_FAILED_MESSAGE,
	COLLECT_DEFINITION_EMPTY_MESSAGE,
	DEFINE_ANALYZE_ERROR_MESSAGE,
	DEFINE_EMPTY_SELECTION_MESSAGE,
	DEFINE_GENERATION_ERROR_MESSAGE,
	DEFINE_MISSING_MODAL_MESSAGE,
	DICTIONARY_LEVEL_ERROR_MESSAGE,
	RESHUFFLE_DEFINITION_UNAVAILABLE_MESSAGE,
	headwordRejectionMessage,
} from "../application/fakeDictionaryMessages";
import {
	dictionarySnapshotIdentityOf,
	FakeDictionaryWorld,
} from "../application/fakeDictionaryWorld";
import {
	runChangeDictionarySemantropyGuarded,
	type DictionaryLevelChangeOutcome,
} from "../application/runChangeDictionarySemantropy";
import {
	runReshuffleDefinition,
	type ReshuffleDefinitionOutcome,
} from "../application/runReshuffleDefinition";
import type { CollectFragmentInputV4 as CollectFragmentInput } from "../collect/v4/CollectedFragmentV4";
import type { CollectFragmentResultV4 as CollectFragmentResult } from "../collect/v4/CollectFragmentUseCaseV4";
import {
	COLLECT_EMPTY_SELECTION_MESSAGE,
	COLLECT_FAILED_MESSAGE,
	collectFragmentMessage,
} from "../collect/collectMessages";
import {
	COPY_COPIED_MESSAGE,
	COPY_EMPTY_SELECTION_MESSAGE,
	COPY_FAILED_MESSAGE,
} from "../copy/copyMessages";
import { copySelectedFragment as writeClipboardText } from "../copy/copySelectedFragment";
import {
	TARGET_RENDER_ERROR_MESSAGE,
	type TargetOpenResult,
	type TargetPhaseRecorder,
} from "../render/targetBodyController";
import {
	createWindowScheduler,
	type CooperativeScheduler,
} from "../render/cooperativeScheduler";
import {
	captureSourceSnapshot,
	SemantropySession,
	type OpenSourceDependencies,
} from "../application/SemantropySession";
import type { SourceSnapshot } from "../application/SourceSnapshot";
import type { SourceCapture } from "../application/selectSourceText";
import { hashSourceText } from "../application/hashSourceText";
import { issueUint32Seed } from "../random/seededRandom";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import {
	isBodySemantropy,
	type BodySemantropy,
} from "../settings/bodySemantropy";
import { isSelectableDictionarySemantropy, supportedDictionarySemantropy, type DictionarySemantropy } from "../settings/dictionarySemantropy";
import { BusyGate } from "./busyGate";
import { bindExclusiveClick } from "./bindExclusiveClick";
import { FakeDefinitionModal } from "./FakeDefinitionModal";
import { toFakeDefinitionViewModel } from "./fakeDefinitionViewModel";
import type { BodySelection, BodySelectionSource } from "./readBodySelection";
import {
	beginViewClose,
	beginViewOpen,
	closedReshuffleOutcome,
	createViewLifecycle,
} from "./semantropyViewLifecycle";
import { toSemantropyViewModel } from "./semantropyViewModel";

import { ChunkTargetBodyController, PROVISIONAL_TARGET_CHUNK_SIZE } from "../render/chunkTargetBodyController";
import {
	BODY_FONT_STACKS,
	BODY_THEME_PALETTES,
	defaultSemantropyDisplaySettings,
	type SemantropyDisplaySettings,
} from "../settings/displaySettings";
import {
	DISPLAY_SAVE_ERROR_MESSAGE,
	MARKER_APPLY_ERROR_MESSAGE,
	SemantropyToolbar,
} from "./SemantropyToolbar";
import {
	toToolbarStatusModel,
	type ToolbarStatusModel,
} from "./toolbarStatusModel";
import {
	resolveLogicalSelection,
	SELECTION_INVALIDATED_MESSAGE,
	type LogicalSelectionSnapshot,
} from "./logicalSelection";

export const SEMANTROPY_VIEW_TYPE = "semantropy-view";

export type CopySelectedFragmentOutcome =
	| "copied"
	| "empty"
	| "failed"
	| "busy"
	| "aborted";

export type CollectSelectedFragmentOutcome =
	| "created"
	| "appended"
	| "empty"
	| "invalid-path"
	| "conflict"
	| "failed"
	| "busy"
	| "aborted";

export type DefineSelectedWordOutcome =
	| "empty"
	| "rejected"
	| "error"
	| "ready"
	| "aborted";

export type CopyDefinitionOutcome =
	| "copied"
	| "empty"
	| "failed"
	| "busy"
	| "aborted";

export type CollectDefinitionOutcome = CollectSelectedFragmentOutcome;

/**
 * The adapters the view needs from the plugin. They are stable for the view's
 * lifetime and resolve against Obsidian at call time, so the view never
 * holds a `TFile`, an `Editor`, a `Vault`, or a `CollectionStorage`.
 */
export type SemantropyViewHost = {
	automaticPosCoordinator?: AutomaticPosCoordinator;
	/** 0.1.0 S5: false leaves out the Recompose dialog entry (the web page has its own Recompose panel). */
	recomposeDialog?: boolean;
	/** 0.1.0 S4: extra enclosed-term delimiter pairs from settings. The standard `{{` `}}` is always on. */
	getEnclosedTermDelimiters?: () => readonly EnclosedTermDelimiter[];
	getAutomaticPos?: () => AutomaticPosOptions;
	getTokenizer: () => JapaneseTokenizer;
	/** Current body for a Vault path: editor buffer first, saved text second. */
	readCurrentText: (sourcePath: string) => Promise<string>;
	/** The effective body Semantropy value at the moment it is read. */
	getBodySemantropy: () => BodySemantropy;
	/** Persists a new body value; false means the write failed. */
	setBodySemantropy: (value: BodySemantropy) => Promise<boolean>;
	/** Open / Refresh wait before reading the effective level. Close never waits. */
	waitForPendingSettings?: () => Promise<void>;
	commitBodySemantropy?: (value: BodySemantropy, commit: () => boolean) => Promise<"applied" | "stale" | "failed">;
	/** The effective Dictionary Semantropy value at the moment it is read. */
	getDictionarySemantropy: () => DictionarySemantropy;
	/** Persists a new Dictionary value; false means the write failed. */
	setDictionarySemantropy: (value: DictionarySemantropy) => Promise<boolean>;
	/** Saves one fragment through the plugin-owned repository. */
	collectFragment: (
		input: CollectFragmentInput,
	) => Promise<CollectFragmentResult>;
	/** Clipboard write; the only Copy destination. */
	writeClipboard: (text: string) => Promise<void>;
	/** Fixed-string Notice. Never interpolate a selection into `message`. */
	showNotice: (message: string) => void;
	/**
	 * The event-loop seam for long body work. Production omits it and uses
	 * the view's own window; tests supply a deterministic scheduler.
	 */
	scheduler?: CooperativeScheduler;
	/** Provisional evaluation seam, e.g. 3000 or 5000 UTF-16 units. Not persisted. */
	targetChunkSize?: number;
	listVocabularyNotes?: () => readonly string[];
	isVocabularyViewActive?: () => boolean;
	/** Effective display settings. Absent hosts fall back to the defaults. */
	getDisplaySettings?: () => SemantropyDisplaySettings;
	/**
	 * Persists display settings. It must reach disk before any view applies
	 * the change, and it returns false when nothing was written.
	 */
	setDisplaySettings?: (
		patch: Partial<SemantropyDisplaySettings>,
	) => Promise<boolean>;
};

/**
 * The body container's class. It is how a selection is recognised as belonging
 * to some Semantropy body rather than to Toolbar or status chrome, including a
 * body owned by a different open view, which this view cannot otherwise see.
 */
const SEMANTROPY_BODY_CLASS = "semantropy-body";

let VIEW_SEQUENCE = 0;

/**
 * How many times one reconciliation pass re-tries a refused re-mark before it
 * reports the body as not showing the stored settings. A bound, not a policy
 * of giving up: an unbounded retry against a display that cannot be rebuilt
 * would spin instead of telling the reader anything.
 */
const MARKER_RECONCILE_ATTEMPTS = 3;

export class SemantropyView extends ItemView {
	private automaticController: AutomaticPosSettingsController | null = null;
	private automaticToolbar: AutomaticPosToolbar | null = null;
	private unregisterAutomatic: (() => void) | null = null;
	private automaticRequest = false;
	private readonly automaticParticipant: AutomaticViewParticipant = { claim: change => this.claimAutomatic(change) };
	private vocabularySelection = initialVocabularySelection();
	private standaloneVocabulary: ManualMorphVocabulary | null = null;
	private collisionSession: CollisionSession | null = null;
	private collisionModal: CollisionModal | null = null;
	private collisionDisabled = false;
	private fakeProverbSession: FakeProverbSession | null = null;
	private fakeProverbModal: FakeProverbModal | null = null;
	private fakeProverbDisabled = false;
	private recomposeModal: RecomposeModal | null = null;
	private vocabularyDraft = initialVocabularySelection();
	private vocabularyGeneration = 0;
	private vocabularyTask: { generation: number; paths: readonly string[]; token: number; dictionaryToken: number } | null = null;
	private staleSources = new Map<string, VocabularySourceIssue["reason"]>();
	private targetVocabularyChanged = false;
	private sourceProgress: { done: number; total: number } | null = null;
	private vocabularyError: string | null = null;
	private vocabularyControls: VocabularyControls | null = null;
	/** The View-owned Vocabulary picker; at most one per View, never shared. */
	private vocabularyModal: VocabularyModal | null = null;
	private readonly session = new SemantropySession();
	private targetBody = new ChunkTargetBodyController();
	/**
	 * The Reshuffle or Text-level change being prepared off-screen, if any.
	 * Refresh may supersede a cancellable task (Reshuffle); a Text-level
	 * change keeps Refresh blocked, as it always has. Open and close
	 * supersede both.
	 */
	private bodyTask: { id: number; message: string; cancellable: boolean; prominent: boolean } | null = null;
	private bodyTaskCount = 0;
	private pendingLevelChange: Promise<BodyLevelChangeOutcome> | null = null;
	private pendingLevelSave = false;
	/**
	 * Development measurement seam (native probes). Receives counts and
	 * milliseconds only; unset in normal use, and nothing is logged.
	 */
	phaseRecorder: TargetPhaseRecorder | null = null;
	private bodyEl: HTMLElement | null = null;
	/** The only scrolling region: the Toolbar and the status line stay put. */
	private scrollEl: HTMLElement | null = null;
	/** 0.1.0 S1: the centred "working" card over the body while the Target or the Vocabulary is being prepared. */
	private busyEl: HTMLElement | null = null;
	private busyTextEl: HTMLElement | null = null;
	private busyDetailEl: HTMLElement | null = null;
	private toolbar: SemantropyToolbar | null = null;
	private loadButton: HTMLButtonElement | null = null;
	private unbindLoad: (() => void) | null = null;
	private readonly viewId = `semantropy-view-${(VIEW_SEQUENCE += 1)}`;
	/**
	 * The last explicit body selection, recorded logically so moving focus to
	 * the Toolbar cannot lose it. It is bound to this view, this body owner,
	 * this body generation and this display revision, and carries offsets and
	 * the displayed string only — never a node, a Range or any metadata.
	 */
	private selection: {
		owner: ChunkTargetBodyController;
		snapshot: LogicalSelectionSnapshot;
		slot: DisplaySlot | null;
	} | null = null;
	private manualMenu: HTMLElement | null = null;
	/** LOCALE1: the open Manual menu's item names. */
	private manualMenuLabels: UiLabels | null = null;
	/** LOCALE1: fixed texts of the shell outside the Toolbar (diagnostics, Load next); rebuilt with the shell. */
	private shellLabels = new UiLabels();
	private manualMenuOrigin: HTMLElement | null = null;
	private manualMenuRevision = -1;
	private manualMenuKeyboard = false;
	/** Scroll / resize tracking that keeps an open Manual menu beside its word; empty while closed. */
	private manualMenuTrack: (() => void)[] = [];
	private manualOutside: ((event: Event) => void) | null = null;
	private unbindSelection: (() => void)[] = [];
	/**
	 * A primary pointer went down in this body and has not yet come up.
	 *
	 * While a drag is extending the selection, the browser re-hit-tests the same
	 * pointer position against the current layout on every move. The Manual
	 * diagnostic and the Dictionary availability line sit above the body, so
	 * showing or hiding them moves the body under a still pointer: the next hit
	 * lands on another line, the exact one-token selection is lost, the line
	 * hides, the body moves back, and the diagnostic flickers at pointer-move
	 * rate. Those selection-driven lines are therefore brought up to date once,
	 * when the gesture ends. The logical selection itself is still recorded on
	 * every change, and keyboard selection is never held back.
	 */
	private selectionGesture = false;
	private displayError: string | null = null;
	/** A re-mark pass is running; it re-reads the stored settings each time. */
	private markerReconciling = false;
	/** A re-mark was owed while the view was busy, and is taken on release. */
	private markerRetryPending = false;
	/**
	 * Non-null while the committed body could not be brought to the stored
	 * marker settings. The setting is saved; the body is not showing it.
	 */
	private markerApplyError: string | null = null;
	private readonly lifecycle = createViewLifecycle();
	private readonly sourceWatch = new SourceChangeWatch();
	private dictionaryWorld = new FakeDictionaryWorld();
 private readonly definitionCache = new DefinitionCache();
 private dictionaryPopover: DictionaryPopoverController | null = null;
 private dictionaryDiagnosticEl: HTMLElement | null = null;
 private dictionaryCountsEl: HTMLElement | null = null;
 private diagnosticSnapshot: VocabularySnapshot | null = null;
 private diagnosticCounts: DictionaryDiagnostics | null = null;
	private readonly dictionaryBusy = new BusyGate();
	private definitionModal: FakeDefinitionModal | null = null;
	private pendingDefineId: number | null = null;
	private definitionError: string | null = null;
	private dictionaryLevelError: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: SemantropyViewHost,
	) {
		super(leaf);
		// Every busy transition, from any operation (including an async Popover
		// Copy / Collect), keeps the pointer affordance in step with what a click
		// or a hover would actually do.
		this.lifecycle.busy.onChange(() => this.syncTokenAffordance());
		this.dictionaryBusy.onChange(() => this.syncTokenAffordance());
	}

	getViewType(): string {
		return SEMANTROPY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Semantropy";
	}

	/** The view tab. Obsidian's bundled brain-circuit; no plugin asset. */
	getIcon(): IconName {
		return "brain-circuit";
	}

	getState(): Record<string, unknown> {
		return {};
	}

	/**
	 * Obsidian calls this when the leaf changes size. The Toolbar re-plans which
	 * items fit its one row; its own ResizeObserver does the same for any other
	 * width change.
	 */
	onResize(): void {
		this.toolbar?.refreshLayout();
		// The Toolbar may have changed height; the work card follows the body's top edge.
		this.syncBusyOverlay();
	}

	async onOpen(): Promise<void> {
		this.unregisterAutomatic?.();
		this.unregisterAutomatic = this.host.automaticPosCoordinator?.register(this.automaticParticipant) ?? null;
		this.closeCollision();
		this.collisionDisabled = false;
		this.closeFakeProverb();
		this.fakeProverbDisabled = false;
		this.closeRecompose();
		this.closeVocabularyPicker();
  this.definitionCache.clear();
		this.cancelVocabularyPreparation();
		this.resetVocabulary();
		this.selection = null;
		this.displayError = null;
		beginViewOpen(this.lifecycle);
		this.bodyTask = null;
		this.dictionaryBusy.revoke();
		this.dictionaryWorld = new FakeDictionaryWorld();
		this.pendingDefineId = null;
		this.definitionError = null;
		this.dictionaryLevelError = null;
		this.sourceWatch.reset();
		this.renderShell();
	}

	async onClose(): Promise<void> {
		this.unregisterAutomatic?.(); this.unregisterAutomatic = null;
		this.automaticController?.dispose(); this.automaticController = null;
		this.automaticToolbar?.dispose(); this.automaticToolbar = null;
		this.closeCollision();
		this.closeFakeProverb();
		this.closeRecompose();
		this.closeVocabularyPicker();
  this.dictionaryPopover?.dispose(); this.dictionaryPopover = null;
  this.definitionCache.clear(); this.diagnosticSnapshot = null; this.diagnosticCounts = null;
		this.closeManualMenu();
		this.resetVocabulary();
		this.cancelVocabularyPreparation(); this.vocabularyControls?.dispose(); this.vocabularyControls = null;
		this.toolbar?.dispose(); this.toolbar = null;
		this.unbindBodySelection(); this.selection = null; this.displayError = null;
		this.markerRetryPending = false; this.markerApplyError = null;
		beginViewClose(this.lifecycle);
		// Any body work in flight stops at its next checkpoint and never commits.
		this.bodyTask = null;
		this.dismissDefinition();
		this.dictionaryWorld.dispose();
		this.dictionaryBusy.revoke();
		this.sourceWatch.reset();
		this.unbindActions();
		this.targetBody.release();
		this.session.dispose();
		this.clearChromeRefs();
		this.contentEl.empty();
	}

	/** Mode and paths are session-only; the persisted draw mode seeds the draft. */
	/** The delimiter pairs a Vocabulary Source is read with: the standard pair plus the host's valid extras. */
	private enclosedTerms(): readonly EnclosedTermDelimiter[] {
		return enclosedTermSyntax(this.host.getEnclosedTermDelimiters?.() ?? []);
	}

	private initialSelection(): VocabularySelection {
		return { ...initialVocabularySelection(), drawMode: this.displaySettings().vocabularyDrawMode };
	}
	/** Active owner, never a clone or a rebuilt Snapshot. Captured row work bypasses this getter. */
	private collisionVocabulary(): ManualMorphVocabulary | null {
		if (this.lifecycle.closed || this.vocabularyTask || this.staleSources.size) return null;
		const owner = this.targetBody.getVocabularyOwner() ?? this.standaloneVocabulary;
		const state = this.session.getState();
		if (state.status === "loading") return null;
		if (state.status === "ready" && owner?.snapshot.sources.some(source => source.path === state.snapshot.sourcePath) &&
			(state.freshness !== "fresh" || this.targetVocabularyChanged)) return null;
		return owner;
	}
	openCollision(): void {
		if (this.lifecycle.closed || this.collisionDisabled || this.collisionModal) return;
		this.dictionaryPopover?.close(); this.closeManualMenu();
		const doc = this.contentEl.ownerDocument;
		const origin = this.modalOrigin();
		const session = new CollisionSession({ active: () => this.collisionVocabulary(), scheduler: this.scheduler(),
			material: () => {
				const bytes = new Uint8Array(32); doc.defaultView!.crypto.getRandomValues(bytes);
				return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
			}, copy: text => this.host.writeClipboard(text), collect: input => this.host.collectFragment({ ...input, metadataVersion: 4 }) });
		this.collisionSession = session;
		const modal = new CollisionModal(this.app, session, () => {
			if (this.collisionModal === modal) { this.collisionModal = null; this.collisionSession = null; }
		}, origin);
		this.collisionModal = modal; modal.open();
	}
	closeCollision(): void {
		this.collisionModal?.close(); this.collisionSession?.dispose();
		this.collisionModal = null; this.collisionSession = null;
	}
	/**
	 * The control a Modal returns focus to. Toolbar popups close first, so a
	 * control opened from the More menu hands focus back to the More button.
	 */
	private modalOrigin(): HTMLElement | null {
		const active = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
		this.toolbar?.closePopups();
		return this.toolbar?.returnTarget(active) ?? active;
	}
	disableCollision(): void { this.collisionDisabled = true; this.closeCollision(); }
	/** Fresh private 256-bit material from the window's Web Crypto; never persisted, logged or shown. */
	private privateMaterial(): string {
		const bytes = new Uint8Array(32); this.contentEl.ownerDocument.defaultView!.crypto.getRandomValues(bytes);
		return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
	}
	/**
	 * Uses the same active owner as Collision; a Target is never required. The
	 * session and its BATCH1 owner live as long as the View: a Modal close keeps
	 * the owner usable and the published batch, a View close disposes both.
	 */
	openFakeProverb(): void {
		if (this.lifecycle.closed || this.fakeProverbDisabled || this.fakeProverbModal) return;
		this.dictionaryPopover?.close(); this.closeManualMenu();
		const origin = this.modalOrigin();
		const session = this.fakeProverbSession ??= new FakeProverbSession({ active: () => this.collisionVocabulary(), scheduler: this.scheduler(),
			material: () => this.privateMaterial(), copy: text => this.host.writeClipboard(text), collect: input => this.host.collectFragment(input) });
		const modal = new FakeProverbModal(this.app, session, () => {
			if (this.fakeProverbModal === modal) this.fakeProverbModal = null;
		}, origin);
		this.fakeProverbModal = modal; modal.open();
	}
	closeFakeProverb(): void {
		this.fakeProverbModal?.close(); this.fakeProverbSession?.dispose();
		this.fakeProverbModal = null; this.fakeProverbSession = null;
	}
	disableFakeProverb(): void { this.fakeProverbDisabled = true; this.closeFakeProverb(); }
	/**
	 * 0.1.0 S5: Recompose over the same active owner as Collision and Fake
	 * proverb. The dialog keeps its output only while it is open.
	 */
	openRecompose(): void {
		if (this.lifecycle.closed || this.recomposeModal) return;
		this.dictionaryPopover?.close(); this.closeManualMenu();
		const origin = this.modalOrigin();
		const modal = new RecomposeModal(this.app, { active: () => this.collisionVocabulary(), nonce: () => issueUint32Seed(),
			paint: () => this.scheduler().paint(), copy: text => this.host.writeClipboard(text), collect: input => this.host.collectFragment(input) }, () => {
			if (this.recomposeModal === modal) this.recomposeModal = null;
		}, origin);
		this.recomposeModal = modal; modal.open();
	}
	closeRecompose(): void { this.recomposeModal?.close(); this.recomposeModal = null; }
	disableAutomatic(): void { this.targetBody.invalidateAutomatic("plugin-disable"); void this.onClose(); }

	private mountAutomatic(parent: HTMLElement): void {
		this.automaticToolbar?.dispose(); this.automaticController?.dispose();
		const coordinator = this.host.automaticPosCoordinator;
		const controller = new AutomaticPosSettingsController({
			prepare: async (options, current) => {
				this.automaticRequest = true;
				return await coordinator?.prepare(this.automaticParticipant, options, current) ?? false;
			},
			commit: async (options, current) => await coordinator?.commit(this.automaticParticipant, options, current) ?? false,
		}, this.host.getAutomaticPos?.() ?? DEFAULT_AUTOMATIC_POS);
		this.automaticController = controller;
		const port = controller.toolbarPort();
		this.automaticToolbar = new AutomaticPosToolbar(parent, { ...port,
			apply: async options => { try { return await port.apply(options); } finally { this.automaticRequest = false; } },
			close: () => { port.close(); if (this.automaticRequest) coordinator?.cancel(); },
		}, { decorate: (toggle, menu, close) => this.toolbar?.adoptAutomatic(toggle, menu, close) });
	}
	/** The same controller port as the Toolbar; useful to keyboard adapters/tests. */
	async applyAutomaticPos(options: AutomaticPosOptions) {
		const port = this.automaticController?.toolbarPort();
		if (!port?.open() || !port.change(options)) return "invalid-request" as const;
		try { return await port.apply(options); } finally { this.automaticRequest = false; this.automaticToolbar?.sync(); }
	}
	cancelAutomaticPos(): void { this.automaticController?.cancel(); if (this.automaticRequest) this.host.automaticPosCoordinator?.cancel(); }
	private claimAutomatic(change: AutomaticSettingsChange): AutomaticViewClaim | null {
		const state = this.session.getState(), body = this.targetBody;
		if (this.lifecycle.closed || state.status === "loading" || this.staleSources.size || this.targetVocabularyChanged ||
			(state.status === "ready" && (state.freshness !== "fresh" || !body.isAutomaticCurrent())) ||
			this.dictionaryBusy.isBusy() || this.pendingDefineId !== null || this.definitionModal?.isOpen()) return null;
		const token = this.lifecycle.busy.acquire(); if (token === null) return null;
		const dictionaryToken = this.dictionaryBusy.acquire()!;
		const task = this.beginBodyTask(change === "level" ? BODY_LEVEL_UPDATING_MESSAGE : "Applying automatic parts of speech…", false);
		const beforeSelection = this.selection;
		this.automaticToolbar?.setBlocked(true);
		const current = () => !this.lifecycle.closed && this.targetBody === body && this.session.getState() === state &&
			!this.staleSources.size && !this.targetVocabularyChanged && this.isBodyTaskCurrent(task);
		this.updateChrome();
		return {
			prepare: async (options, operationCurrent, level) => {
				const owned = () => current() && operationCurrent();
				await this.scheduler().paint(); if (!owned()) return null;
				if (state.status !== "ready") return { current: owned, publish: () => undefined, commit: () => undefined, rollback: () => undefined, dispose: () => undefined };
				const staged = await body.prepareAutomatic(options, { isCurrent: owned, scheduler: this.scheduler() }, level);
				if (!staged) return null;
				const session = this.session.prepareMaterializedAnalysis(state.snapshot, staged.analysis);
				if (!session) { staged.dispose(); return null; }
				return { current: () => owned() && staged.current() && session.current(), publish: staged.publish,
					commit: () => {
						staged.commit(); session.commit();
						if (beforeSelection?.owner === body) {
							const mapped = staged.mapSelection(beforeSelection.snapshot.start, beforeSelection.snapshot.end);
							this.selection = mapped ? { ...beforeSelection, slot: beforeSelection.slot ? body.getDisplaySlot(beforeSelection.slot.tokenId) : null,
								snapshot: { ...beforeSelection.snapshot, ...mapped, displayRevision: body.getDisplayRevision() } } : null;
						}
					},
					rollback: () => { session.rollback(); staged.rollback(); if (!this.lifecycle.closed && this.targetBody === body) this.selection = beforeSelection; },
					dispose: staged.dispose,
				};
			},
			release: committed => {
				this.lifecycle.busy.release(token); this.dictionaryBusy.release(dictionaryToken); this.endBodyTask(task);
				if (this.lifecycle.closed) return;
				if (committed) {
					this.automaticController?.adoptEffective(this.host.getAutomaticPos?.() ?? DEFAULT_AUTOMATIC_POS);
					this.captureBodySelection(); this.dictionaryPopover?.validate();
				}
				this.updateChrome(); this.automaticToolbar?.setBlocked(false);
			},
		};
	}

	private resetVocabulary(): void {
		this.standaloneVocabulary = null;
		this.vocabularyDraft = this.vocabularySelection = this.initialSelection();
		this.staleSources.clear(); this.targetVocabularyChanged = false; this.vocabularyError = null;
	}
	getVocabularyState() {
		return { selection: this.vocabularySelection, draft: this.vocabularyDraft, snapshot: this.targetBody.getVocabularySnapshot() ?? this.standaloneVocabulary?.snapshot ?? null,
			stale: this.staleSources.size > 0, staleSources: Array.from(this.staleSources, ([path, reason]) => ({ path, reason })), preparing: this.vocabularyTask !== null,
			progress: this.sourceProgress, error: this.vocabularyError, ready: !this.lifecycle.closed && this.session.getState().status !== "loading" &&
				(this.session.getState().status === "ready" || this.vocabularyDraft.mode === "selected") };
	}
	setVocabularyDraft(selection: VocabularySelection): void {
		this.cancelVocabularyPreparation();
		this.vocabularyDraft = { ...selection, paths: [...selection.paths] }; this.vocabularyError = null; this.syncVocabularyChrome();
	}
	cancelVocabularyPreparation(): void {
		this.vocabularyGeneration += 1;
		if (this.vocabularyTask) { this.lifecycle.busy.release(this.vocabularyTask.token); this.dictionaryBusy.release(this.vocabularyTask.dictionaryToken); }
		this.vocabularyTask = null; this.sourceProgress = null;
		this.updateChrome(); this.syncDefinitionModal();
	}
	/**
	 * Opens this View's Vocabulary picker. It lists Vault paths only; note text is
	 * read solely by an explicit Apply, exactly as before.
	 */
	openVocabularyPicker(): void {
		if (this.lifecycle.closed || this.vocabularyModal) return;
		this.dictionaryPopover?.close(); this.closeManualMenu(); this.toolbar?.closePopups();
		const modal: VocabularyModal = new VocabularyModal(this.app, {
			state: () => this.getVocabularyState(),
			paths: () => this.host.listVocabularyNotes?.() ?? [],
			draft: (selection) => this.setVocabularyDraft(selection),
			apply: () => this.applyVocabulary(),
			cancel: () => this.cancelVocabulary(),
			closed: () => { if (this.vocabularyModal === modal) this.vocabularyModal = null; },
			// The entry may sit in a closed More menu by then; its More button takes focus instead.
			returnFocus: () => this.toolbar?.returnTarget(this.vocabularyControls?.button ?? null) ?? null,
		});
		this.vocabularyModal = modal; modal.open();
	}
	closeVocabularyPicker(): void {
		const modal = this.vocabularyModal; this.vocabularyModal = null; modal?.close();
	}
	private syncVocabularyChrome(): void {
		this.vocabularyControls?.sync(); this.vocabularyModal?.sync();
	}
	cancelVocabulary(): void {
		this.cancelVocabularyPreparation(); this.vocabularyDraft = this.vocabularySelection;
		this.vocabularyError = null; this.updateChrome();
	}
	notifyVocabularySourceEvent(path: string, reason: VocabularySourceIssue["reason"] = "changed"): void {
		if (path === this.getSourcePath()) this.targetVocabularyChanged = true;
		const active = this.getVocabularyState().snapshot;
		if (active?.sources.some(source => source.path === path) && this.staleSources.get(path) !== "missing") this.staleSources.set(path, reason);
		if (path === this.getSourcePath() || active?.sources.some(source => source.path === path)) {
			this.cancelAutomaticPos(); this.automaticController?.markStale(); this.targetBody.invalidateAutomatic("source-changed"); this.automaticToolbar?.sync();
		}
		if (this.vocabularyTask && (this.vocabularyTask.paths.includes(path) || path === this.getSourcePath())) this.cancelVocabularyPreparation();
		this.dictionaryPopover?.validate(); this.syncDictionaryDiagnostics();
		this.syncVocabularyChrome(); this.syncTokenAffordance();
		this.collisionSession?.sourceChanged(path);
		this.fakeProverbSession?.sourceChanged(path);
	}
	async applyVocabulary(): Promise<"applied" | "aborted" | "failed" | "busy" | "refresh-required"> {
  this.dictionaryPopover?.close();
		this.cancelVocabularyPreparation();
		const state = this.session.getState(), body = this.targetBody;
		if (this.lifecycle.closed || state.status === "loading") return "aborted";
		const target = state.status === "ready" ? state.snapshot : null;
		if (!target && this.vocabularyDraft.mode !== "selected") return "aborted";
		let selection: VocabularySelection;
		// Current Note reads the open note only. Paths stay on the draft until this
		// Apply succeeds, so switching back to Selected Notes can restore them;
		// the committed selection then keeps none, and a later reopen cannot.
		try {
			selection = this.vocabularyDraft.mode === "current"
				? { ...this.vocabularyDraft, paths: [] }
				: { ...this.vocabularyDraft, paths: vocabularyPaths(this.vocabularyDraft.paths) };
		}
		catch { this.vocabularyError = VOCABULARY_PREPARATION_ERROR; this.syncVocabularyChrome(); return "failed"; }
		const paths = selection.mode === "current" ? [target!.sourcePath] : selection.paths;
		if (state.status === "ready" && paths.includes(state.snapshot.sourcePath) && (state.freshness !== "fresh" || this.targetVocabularyChanged)) {
			this.vocabularyError = VOCABULARY_REFRESH_REQUIRED; this.syncVocabularyChrome(); return "refresh-required";
		}
		const token = this.lifecycle.busy.acquire(); if (token === null || this.dictionaryBusy.isBusy() || this.pendingDefineId !== null || this.definitionModal?.isOpen()) { if (token !== null) this.lifecycle.busy.release(token); return "busy"; }
		const dictionaryToken = this.dictionaryBusy.acquire()!;
		const generation = ++this.vocabularyGeneration;
		this.vocabularyTask = { generation, paths, token, dictionaryToken }; this.vocabularyError = null;
		const current = () => !this.lifecycle.closed && this.vocabularyGeneration === generation && this.targetBody === body &&
			this.session.getReadySnapshot() === target && (this.host.isVocabularyViewActive?.() ?? true);
		const scheduler = this.scheduler(), slice = new CooperativeSlice(scheduler, current);
		let world: FakeDictionaryWorld | null = null;
		try {
			this.updateChrome(); this.syncDefinitionModal(); await scheduler.paint(); if (!current()) return "aborted";
			const prepared = await prepareVocabulary({ selection, target,
				readText: path => this.host.readCurrentText(path),
				tokenizer: this.host.getTokenizer(), isCurrent: current, checkpoint: () => slice.checkpoint(),
				progress: (done, total) => { if (current()) { this.sourceProgress = { done, total }; this.syncVocabularyChrome(); } },
				enclosedTerms: this.enclosedTerms() });
			if (!prepared || !current()) return "aborted";
			const staged = target ? await body.prepareVocabulary(prepared, { scheduler, isCurrent: current }) : null;
			world = new FakeDictionaryWorld();
			if (!current()) return "aborted";
			if (target) {
				if (!staged?.commit((analysis, publishDom) => current() && this.session.updateMaterializedAnalysis(target, analysis, publishDom))) return "aborted";
			} else this.standaloneVocabulary = prepared;
			const oldWorld = this.dictionaryWorld;
			this.vocabularySelection = selection; this.vocabularyDraft = selection;
			this.definitionCache.clear(); this.dictionaryPopover?.close();
   this.staleSources.clear(); this.vocabularyError = null; this.dictionaryWorld = world; world = null;
			oldWorld.dispose(); this.pendingDefineId = null; this.definitionError = null; this.dictionaryLevelError = null;
			// Only a committed Apply stores its draw mode. Writing before the
			// commit would leave a new mode on disk for an Apply that a close,
			// a Source change or a Refresh then abandoned. A write that fails
			// after the commit keeps the applied Snapshot and the old stored
			// mode, and says so: the body is what the reader asked for, and
			// nothing changes silently for the next session.
			if (!(await this.persistDrawMode(selection.drawMode)) && !this.lifecycle.closed) {
				this.vocabularyError = VOCABULARY_DRAW_MODE_SAVE_ERROR;
			}
			return "applied";
		} catch {
			if (!current()) return "aborted";
			this.vocabularyError = VOCABULARY_PREPARATION_ERROR; return "failed";
		} finally {
			world?.dispose();
			// A superseded operation must not touch the newer operation's controls.
			if (this.vocabularyTask?.generation === generation) this.cancelVocabularyPreparation();
		}
	}

	/**
	 * Attempts to store the draw mode after an Apply has committed. A draft
	 * change alone never reaches here, and neither does an Apply abandoned before
	 * commit. A successful save makes the stored mode match the active Snapshot;
	 * a failed save leaves the new Snapshot active for this session and keeps the
	 * previous stored mode for the next session.
	 */
	private async persistDrawMode(drawMode: VocabularySelection["drawMode"]): Promise<boolean> {
		const save = this.host.setDisplaySettings;
		if (!save || this.displaySettings().vocabularyDrawMode === drawMode) return true;
		return await save({ vocabularyDrawMode: drawMode });
	}

	/**
	 * The note this view is bound to, for source-event routing. It keeps
	 * answering while an Open or a Refresh is in flight, so a change landing
	 * mid-request is not silently dropped.
	 */
	getSourcePath(): string | null {
		return (
			this.sourceWatch.pendingSourcePath((id) => this.session.isCurrent(id)) ??
			this.session.getReadySnapshot()?.sourcePath ??
			null
		);
	}

	/**
	 * Draws a new body Seed. The current body stays on screen while the next
	 * one is prepared in slices; it is swapped in only when complete.
	 */
	async reshuffle(deps: { issueSeed?: () => number } = {}): Promise<ReshuffleOutcome> {
		const closed = closedReshuffleOutcome(this.lifecycle);
		if (closed) {
			return closed;
		}

		const scheduler = this.scheduler();
		let task: number | null = null;
		const current = (): boolean => task !== null && this.isBodyTaskCurrent(task);
		const outcome = await runReshuffleGuarded({
			busy: this.actionBusyGuard(),
			begin: async () => {
				task = this.beginBodyTask(RESHUFFLING_MESSAGE, true);
				// The status and disabled controls get a frame before any heavy work.
				await scheduler.paint();
			},
			session: this.session,
			host: {
				getBodyGeneration: () => this.targetBody.getBodyGeneration(),
				getTextNodeCount: () => this.targetBody.getSequenceCount(),
				prepareResult: (generation, result) =>
					this.targetBody.prepare(generation, result, { isCurrent: current, scheduler }),
			},
			issueSeed: deps.issueSeed ?? issueUint32Seed,
			transform: (_tokens, _pool, seed, level) => this.targetBody.transform(seed, level),
			isAbandoned: () =>
				this.lifecycle.closed ||
				this.session.getState().status !== "ready" ||
				(task !== null && !this.isBodyTaskCurrent(task)),
		});
		if (task !== null) {
			this.endBodyTask(task);
		}
		if (this.lifecycle.closed) {
			return outcome;
		}
		if (outcome === "applied") {
			this.lifecycle.reshuffleNotice = null;
		} else if (outcome === "failed") {
			this.lifecycle.reshuffleNotice = RESHUFFLE_ERROR_MESSAGE;
		}
		this.updateChrome();
		if (outcome === "applied") {
			await this.emitPhaseReport(scheduler);
		}
		return outcome;
	}

	/**
	 * Re-reads the note this session was built from and rebuilds the snapshot,
	 * hash, Seed, analysis and body. The single entry point for both the
	 * Refresh source button and the command. It supersedes a Reshuffle that
	 * is still being prepared. A Text-level change is not superseded: while
	 * preparation is in flight, Refresh reports busy. Pending settings saves
	 * settle before Refresh reads the effective level. Open, close and disable
	 * invalidate the old display immediately; successful saves remain committed.
	 */
	async refreshSource(
		deps: {
			issueSeed?: () => number;
			hashText?: (text: string) => Promise<string>;
		} = {},
	): Promise<RefreshOutcome> {
		this.cancelVocabularyPreparation();
		if (this.lifecycle.closed) {
			return "aborted";
		}
		if (this.host.waitForPendingSettings && this.pendingLevelSave) {
			const snapshot = this.session.getReadySnapshot(), owner = this.targetBody;
			await this.pendingLevelChange;
			if (this.lifecycle.closed || this.session.getReadySnapshot() !== snapshot || this.targetBody !== owner) return "aborted";
		}

		this.cancelBodyTask();
		let watchToken = 0;
		let task: number | null = null;
		const oldBody = this.targetBody, oldRoot = oldBody.getContainer(), bodyEl = this.bodyEl;
		const parent = bodyEl?.parentNode;
		return await runRefreshTarget({
			busy: this.actionBusyGuard(), session: this.session,
			readCurrentText: async path => {
				await this.host.waitForPendingSettings?.();
				if (this.lifecycle.closed || this.targetBody !== oldBody || this.bodyEl !== bodyEl) return "";
				return await this.host.readCurrentText(path);
			}, hashText: deps.hashText ?? hashSourceText,
			issueSeed: deps.issueSeed ?? issueUint32Seed, bodySemantropy: this.host.getBodySemantropy(),
			beginRequest: sourcePath => {
				const requestId = this.session.beginRefresh();
				watchToken = this.sourceWatch.beginRequest(requestId, sourcePath);
				task = this.beginBodyTask("Refreshing target…", false);
				return requestId;
			},
			sourceChangedDuringRequest: () => this.sourceWatch.changedSince(watchToken),
			prepareSnapshot: async ({ requestId, snapshot, bodySeed }) => {
				const bodySemantropy = this.host.getBodySemantropy();
				const staged = new ChunkTargetBodyController();
				const current = () => !this.lifecycle.closed && this.session.isCurrent(requestId) &&
					!this.sourceWatch.changedSince(watchToken) && this.targetBody === oldBody && this.bodyEl === bodyEl &&
					!!bodyEl?.isConnected && bodyEl.parentNode === parent && oldRoot?.parentNode === bodyEl && oldBody.isDisplayIntact();
				const result = await this.prepareSnapshotBody(requestId, snapshot, bodySeed, bodySemantropy, staged, current);
				if (result.status !== "applied") { staged.release(); return null; }
				return { analysis: result.analysis, discard: () => staged.release(), commit: accept => {
					if (!current()) return false;
					const dom = targetDomTransaction(bodyEl!, [staged.getContainer()!]);
     let accepted = false;
     try { accepted = accept ? accept(dom.publish) : (dom.publish(), true); if (!accepted) return false; }
     finally { if (!accepted) dom.rollback(); }
					this.targetBody = staged; this.targetVocabularyChanged = false;
     if (this.vocabularySelection.mode === "current") this.staleSources.clear();
     oldBody.release(); this.dismissDefinition();
					return true;
				} };
			},
			isAbandoned: () => this.lifecycle.closed,
			settle: (requestId, outcome) => {
				this.sourceWatch.endRequest(requestId);
				if (task !== null) this.endBodyTask(task);
				if (this.lifecycle.closed || !this.session.isCurrent(requestId)) return;
				if (outcome === "failed") {
					console.error("[Semantropy] failed to refresh the source note");
					this.lifecycle.reshuffleNotice = REFRESH_ERROR_MESSAGE;
				} else if (outcome === "refreshed") this.lifecycle.reshuffleNotice = null;
				this.updateChrome();
				if (outcome === "refreshed") void this.emitPhaseReport(this.scheduler());
			},
		});
	}

	/** Adds exactly the next canonical descriptor, keeping all committed nodes in place. */
	async loadNextSection(): Promise<"applied" | "busy" | "unavailable" | "aborted" | "failed"> {
		if (this.lifecycle.closed) return "aborted";
		const state = this.session.getState();
		if (state.status !== "ready" || !this.targetBody.hasNext()) return "unavailable";
		const token = this.lifecycle.busy.acquire();
		if (token === null) return "busy";
		const body = this.targetBody, scheduler = this.scheduler();
		const task = this.beginBodyTask("Loading next section…", true, false);
		const current = () => this.isBodyTaskCurrent(task) && this.targetBody === body && this.session.getReadySnapshot() === state.snapshot;
		try {
			await scheduler.paint();
			if (!current()) return "aborted";
			const result = await body.loadNext({ seed: state.bodySeed, level: state.bodySemantropy,
				getTokenizer: () => this.host.getTokenizer(), isCurrent: current, scheduler,
				onCommit: (analysis, publishDom) => this.session.updateMaterializedAnalysis(state.snapshot, analysis, publishDom) });
			if (!current() || result.status === "stale") return "aborted";
			if (result.status === "applied") {
				this.lifecycle.reshuffleNotice = null;
				return "applied";
			}
			this.lifecycle.reshuffleNotice = "Could not load the next section. Try again.";
			return "failed";
		} finally {
			this.endBodyTask(task); this.lifecycle.busy.release(token);
			if (!this.lifecycle.closed) this.updateChrome();
			void this.emitPhaseReport(scheduler);
		}
	}

	/**
	 * Copies the explicit selection in this view's committed body. The single
	 * entry point for the Copy button and the command.
	 */
	async copySelectedFragment(
		deps: { selection?: BodySelectionSource | null } = {},
	): Promise<CopySelectedFragmentOutcome> {
		if (this.lifecycle.closed) {
			return "aborted";
		}
		const selected = this.resolveActionSelection(deps.selection);
		if (selected.status !== "selected") {
			this.notify(selected.message ?? COPY_EMPTY_SELECTION_MESSAGE);
			return "empty";
		}
		const token = this.lifecycle.busy.acquire();
		this.syncActionControls();
		if (token === null) {
			return "busy";
		}
		try {
			const result = await writeClipboardText(selected.text, {
				writeText: (text) => this.host.writeClipboard(text),
			});
			if (result === "copied") {
				this.notify(COPY_COPIED_MESSAGE);
				return "copied";
			}
			this.notify(COPY_FAILED_MESSAGE);
			return "failed";
		} finally {
			this.lifecycle.busy.release(token);
			if (!this.lifecycle.closed) {
				this.syncActionControls();
			}
		}
	}

	/**
	 * Collects the explicit selection in this view's committed body. The
	 * single entry point for the Collect button and the command.
	 */
	async collectSelectedFragment(
		deps: { selection?: BodySelectionSource | null } = {},
	): Promise<CollectSelectedFragmentOutcome> {
		if (this.lifecycle.closed) {
			return "aborted";
		}
		const selected = this.resolveActionSelection(deps.selection);
		if (selected.status !== "selected") {
			this.notify(selected.message ?? COLLECT_EMPTY_SELECTION_MESSAGE);
			return "empty";
		}
		const state = this.session.getState();
		if (state.status !== "ready") {
			this.notify(COLLECT_EMPTY_SELECTION_MESSAGE);
			return "empty";
		}
		const generation = this.targetBody.getAutomaticProvenance();
		if (!generation) { this.notify(COLLECT_FAILED_MESSAGE); return "failed"; }
		const range = this.collectLogicalRange(deps.selection);
		const input = bodyFragmentFromAutomatic(state, selected.text, generation, this.targetBody.getAutomaticOptions(),
			range ? this.targetBody.manualOverridesForLogicalRange(range.start, range.end) : []);
		const token = this.lifecycle.busy.acquire();
		this.syncActionControls();
		if (token === null) {
			return "busy";
		}
		try {
			const result = await this.host.collectFragment(input);
			this.notify(collectFragmentMessage(result));
			return collectOutcome(result);
		} catch {
			this.notify(COLLECT_FAILED_MESSAGE);
			return "failed";
		} finally {
			this.lifecycle.busy.release(token);
			if (!this.lifecycle.closed) {
				this.syncActionControls();
			}
		}
	}

	/**
	 * Defines the explicit single-word selection in this view's committed body.
	 * The single entry point for `Semantropy: Define selected word`.
	 */
	async defineSelectedWord(
		deps: {
			selection?: BodySelectionSource | null;
			issueSeed?: () => number;
			generate?: DefineGenerate;
		} = {},
	): Promise<DefineSelectedWordOutcome> {
  this.dictionaryPopover?.close(); this.closeManualMenu();
		if (this.vocabularyTask) return "aborted";
		if (this.lifecycle.closed) {
			return "aborted";
		}

		const requestId = this.dictionaryWorld.beginRequest();
		const selected = this.readCommittedBodySelection(deps.selection);
		if (selected.status !== "selected") {
			this.settleCancelledDefine();
			this.host.showNotice(DEFINE_EMPTY_SELECTION_MESSAGE);
			return "empty";
		}

		const state = this.session.getState();
		if (state.status !== "ready") {
			this.settleCancelledDefine();
			this.host.showNotice(DEFINE_EMPTY_SELECTION_MESSAGE);
			return "empty";
		}

		let dictionarySeed: number;
		try {
			dictionarySeed = this.dictionaryWorld.ensureSeed(
				deps.issueSeed ?? issueUint32Seed,
			);
		} catch {
			this.host.showNotice(DEFINE_GENERATION_ERROR_MESSAGE);
			return "error";
		}

		const snapshot = dictionarySnapshotIdentityOf(state.snapshot);
		const dictionarySemantropy = this.dictionaryLevel();
		this.pendingDefineId = requestId;
		this.definitionError = null;
		this.dictionaryLevelError = null;
		this.ensureDefinitionModal();
		this.syncDefinitionModal();

		const bodyOwner = this.targetBody, displayRevision = bodyOwner.getDisplayRevision();
  const outcome = await runDefineSelectedWord({
			selection: selected.text,
   identified: this.targetBody.readSelectedSlot(deps.selection !== undefined ? deps.selection : this.contentEl.ownerDocument.getSelection())?.dictionary,
			snapshot,
			tokenSequences: state.tokenSequences,
			preparedPool: this.targetBody.getDictionaryPool(),
			dictionarySeed,
			dictionarySemantropy,
			getTokenizer: () => this.host.getTokenizer(),
			isCurrent: () =>
				!this.lifecycle.closed && this.dictionaryWorld.isCurrent(requestId) && this.targetBody === bodyOwner && bodyOwner.getDisplayRevision() === displayRevision,
			getSnapshotIdentity: () => {
				const current = this.session.getState();
				return current.status === "ready"
					? dictionarySnapshotIdentityOf(current.snapshot)
					: null;
			},
   generate: deps.generate ?? (request => {
    const vocabulary = bodyOwner.getVocabularySnapshot();
    const cached = vocabulary ? this.definitionCache.getForWorld(definitionCacheKey(request.headword, dictionarySeed, dictionarySemantropy, vocabulary)) : undefined;
    return cached?.result ?? generateFakeDefinition(request);
   }),
		});

		if (
			this.lifecycle.closed ||
			!this.dictionaryWorld.isCurrent(requestId)
		) {
			return "aborted";
		}

		if (outcome.status === "stale") {
			return "aborted";
		}

		if (outcome.status === "rejected") {
			this.definitionError = headwordRejectionMessage(outcome.reason);
			this.syncDefinitionModal();
			return "rejected";
		}

		if (outcome.status === "error") {
			this.definitionError =
				outcome.kind === "analyze"
					? DEFINE_ANALYZE_ERROR_MESSAGE
					: DEFINE_GENERATION_ERROR_MESSAGE;
			console.error("[Semantropy] failed to define the selected word");
			this.syncDefinitionModal();
			return "error";
		}

		const vocabularySnapshot = bodyOwner.getVocabularySnapshot();
		if (!vocabularySnapshot) {
			return "aborted";
		}
		const cached = this.definitionCache.getForWorld(
			definitionCacheKey(outcome.headword, outcome.result.outcome === "generated" ? outcome.result.dictionarySeed : dictionarySeed, dictionarySemantropy, vocabularySnapshot),
		);
		const provenance = cachedDefinitionCommit(cached, outcome.result);
		const committed = this.dictionaryWorld.commit(requestId, {
			headword: outcome.headword,
			pool: outcome.pool,
			snapshot: provenance?.target ?? outcome.snapshot,
			vocabulary: provenance?.vocabulary ?? collectVocabularyFromSnapshot(vocabularySnapshot),
			dictionarySeed: outcome.result.outcome === "generated" ? outcome.result.dictionarySeed : dictionarySeed,
			dictionarySemantropy,
			result: outcome.result,
		});
		if (!committed) {
			return "aborted";
		}
		this.definitionError = null;
		this.syncDefinitionModal();
		return "ready";
	}

	/**
	 * Issues a new dictionary Seed and redraws the current Fake Definition.
	 * The single entry point for the Modal button and the command.
	 */
	reshuffleDefinition(
		deps: { issueSeed?: () => number; generate?: DefineGenerate } = {},
	): ReshuffleDefinitionOutcome {
		if (this.lifecycle.closed) {
			return "aborted";
		}
		if (!this.definitionIsOpen()) {
			this.host.showNotice(DEFINE_MISSING_MODAL_MESSAGE);
			return "unavailable";
		}
		const token = this.dictionaryBusy.acquire();
		if (token === null) {
			return "busy";
		}
		this.syncDefinitionModal();
		try {
			const outcome = runReshuffleDefinition({
				world: this.dictionaryWorld,
				modalOpen: this.definitionIsOpen(),
				issueSeed: deps.issueSeed ?? issueUint32Seed,
				isAbandoned: () =>
					this.lifecycle.closed || !this.definitionIsOpen(),
				generate: deps.generate,
			});
			if (outcome === "unavailable") {
				this.host.showNotice(RESHUFFLE_DEFINITION_UNAVAILABLE_MESSAGE);
			}
			if (outcome === "applied") {
				this.dictionaryLevelError = null;
			}
			this.syncDefinitionModal();
			return outcome;
		} finally {
			this.dictionaryBusy.release(token);
			if (!this.lifecycle.closed) {
				this.syncDefinitionModal();
			}
		}
	}

	/**
	 * Copies the Fake Definition currently on screen. The single entry point
	 * for the Modal's Copy definition button.
	 */
	async copyDefinition(): Promise<CopyDefinitionOutcome> {
  if (this.dictionaryBusy.isBusy()) return "busy";
		if (this.lifecycle.closed) {
			return "aborted";
		}
		if (!this.definitionIsOpen()) {
			this.host.showNotice(DEFINE_MISSING_MODAL_MESSAGE);
			return "empty";
		}
		const current = this.dictionaryWorld.getCurrent();
		// The same canonical text Collect writes, from the same committed current.
		const text = current && this.toDefinitionViewModel().copyEnabled ? fakeDictionaryCanonicalText(current) : null;
		if (text === null) {
			this.host.showNotice(COPY_DEFINITION_EMPTY_MESSAGE);
			return "empty";
		}
		const token = this.dictionaryBusy.acquire();
		if (token === null) {
			return "busy";
		}
		this.syncDefinitionModal();
		try {
			const result = await writeClipboardText(text, {
				writeText: (value) => this.host.writeClipboard(value),
			});
			if (result === "copied") {
				this.host.showNotice(COPY_COPIED_MESSAGE);
				return "copied";
			}
			this.host.showNotice(COPY_DEFINITION_FAILED_MESSAGE);
			return "failed";
		} finally {
			this.dictionaryBusy.release(token);
			if (!this.lifecycle.closed) {
				this.syncDefinitionModal();
			}
		}
	}

	/**
	 * Collects the Fake Definition currently on screen. The single entry point
	 * for the Modal's Collect definition button.
	 */
	async collectDefinition(): Promise<CollectDefinitionOutcome> {
  if (this.dictionaryBusy.isBusy()) return "busy";
		if (this.lifecycle.closed) {
			return "aborted";
		}
		if (!this.definitionIsOpen()) {
			this.host.showNotice(DEFINE_MISSING_MODAL_MESSAGE);
			return "empty";
		}
		const current = this.dictionaryWorld.getCurrent();
		const input = current && this.toDefinitionViewModel().collectEnabled
			? fakeDictionaryFragmentFromCurrent(current)
			: null;
		if (input === null) {
			this.host.showNotice(COLLECT_DEFINITION_EMPTY_MESSAGE);
			return "empty";
		}
		const token = this.dictionaryBusy.acquire();
		if (token === null) {
			return "busy";
		}
		this.syncDefinitionModal();
		try {
			const result = await this.host.collectFragment({ ...input, metadataVersion: 4 });
			this.host.showNotice(collectFragmentMessage(result));
			return collectOutcome(result);
		} catch {
			this.host.showNotice(COLLECT_FAILED_MESSAGE);
			return "failed";
		} finally {
			this.dictionaryBusy.release(token);
			if (!this.lifecycle.closed) {
				this.syncDefinitionModal();
			}
		}
	}

	/**
	 * The Fake Dictionary level this View uses. A host value that is not a
	 * selectable level (a saved Off) reads as the default, so Hover and the
	 * Dictionary marker never disappear because of it.
	 */
	private dictionaryLevel(): DictionarySemantropy {
		return supportedDictionarySemantropy(this.host.getDictionarySemantropy());
	}

	/**
	 * Regenerates the current Fake Definition at a new Dictionary Semantropy
	 * value. The single entry point for the Modal's Dictionary level control.
	 */
	async setDictionarySemantropy(
		next: DictionarySemantropy,
		deps: {
			persist?: (value: DictionarySemantropy) => Promise<boolean>;
			generate?: DefineGenerate;
		} = {},
	): Promise<DictionaryLevelChangeOutcome> {
		if (this.lifecycle.closed) {
			return "aborted";
		}
		// Off is not a Fake Dictionary level: no operation may move the dictionary to 0.
		if (!isSelectableDictionarySemantropy(next)) return "unavailable";
  const bodyToken = this.lifecycle.busy.acquire();
  if (bodyToken === null) return "busy";
  const owner = this.targetBody;
  const current = () => !this.lifecycle.closed && this.targetBody === owner;
  this.updateChrome();
  let outcome: DictionaryLevelChangeOutcome;
  try {
  outcome = await runChangeDictionarySemantropyGuarded({
			busy: {
				acquire: () => {
					const token = this.dictionaryBusy.acquire();
					this.syncDefinitionModal();
					return token;
				},
				release: (token) => {
					this.dictionaryBusy.release(token);
					this.syncDefinitionModal();
				},
			},
			world: this.dictionaryWorld,
			next,
			persist:
				deps.persist ??
				((value) => this.host.setDictionarySemantropy(value)),
			isAbandoned: () => !current(),
   prepareDisplay: async () => {
    const prepared = await owner.prepareMarkers(next, owner.getMarkerVisibility(), { isCurrent: current, scheduler: this.scheduler() });
    return prepared.status === "prepared" ? prepared : null;
   },
			modalOpen:
				this.definitionIsOpen(),
			generate: deps.generate,
		});
  } finally { this.lifecycle.busy.release(bodyToken); if (!this.lifecycle.closed) this.updateChrome(); }
		if (this.lifecycle.closed) {
			return outcome;
		}
		if (outcome === "applied") {
			this.dictionaryLevelError = null;
		} else if (outcome === "failed") {
			console.error("[Semantropy] failed to change the Dictionary level");
			this.dictionaryLevelError = DICTIONARY_LEVEL_ERROR_MESSAGE;
		}
		this.syncDefinitionModal();
		return outcome;
	}

 /** Toolbar seam only; no persistence, generation, candidate draw or Dictionary mutation. */
 async setMarkerVisibility(visibility: DisplayMarkerVisibility): Promise<"applied" | "busy" | "aborted" | "failed"> {
  if (this.lifecycle.closed) return "aborted";
  const token = this.lifecycle.busy.acquire(); if (token === null) return "busy";
  const owner = this.targetBody;
  const task = this.beginBodyTask("Updating markers…", true, false);
  const current = () => this.isBodyTaskCurrent(task) && this.targetBody === owner;
  try {
   this.updateChrome();
   const staged = await owner.prepareMarkers(this.dictionaryLevel(), { ...owner.getMarkerVisibility(), ...visibility }, { isCurrent: current, scheduler: this.scheduler() });
   if (staged.status === "failed") return "failed";
   if (staged.status !== "prepared" || !current()) return "aborted";
   return staged.commit() === "applied" ? "applied" : "aborted";
  } catch { return current() ? "failed" : "aborted"; }
  finally { this.endBodyTask(task); this.lifecycle.busy.release(token); if (!this.lifecycle.closed) this.updateChrome(); }
 }

	/**
	 * Re-transforms the displayed note at a new Semantropy value.
	 *
	 * The single entry point for the level control. It reuses the stored token
	 * sequences, pool and body Seed, so nothing is re-read, re-hashed,
	 * re-rendered or re-tokenized, and the snapshot keeps its identity and its
	 * freshness — a stale view stays stale at the new level. The current body
	 * stays on screen until the next one is complete.
	 */
	async setBodySemantropy(
		next: BodySemantropy,
		deps: { persist?: (value: BodySemantropy) => Promise<boolean> } = {},
	): Promise<BodyLevelChangeOutcome> {
		if (this.lifecycle.closed) {
			return "aborted";
		}
		if (this.pendingLevelChange) return "busy";
		const pending = this.changeBodyLevel(next, deps);
		this.pendingLevelChange = pending;
		try { return await pending; }
		finally { if (this.pendingLevelChange === pending) this.pendingLevelChange = null; }
	}

	private async changeBodyLevel(
		next: BodySemantropy,
		deps: { persist?: (value: BodySemantropy) => Promise<boolean> },
	): Promise<BodyLevelChangeOutcome> {
		const coordinator = this.host.automaticPosCoordinator;
		// The plugin's Text level is one setting shown by every open View, so it
		// changes through the same all-View transaction as option Apply.
		if (coordinator && !deps.persist) return await this.changeBodyLevelTogether(coordinator, next);
		const scheduler = this.scheduler();
		let task: number | null = null;
		const current = (): boolean => task !== null && this.isBodyTaskCurrent(task);
		const outcome = await runChangeBodySemantropyGuarded({
			busy: this.actionBusyGuard(),
			begin: async () => {
				task = this.beginBodyTask(BODY_LEVEL_UPDATING_MESSAGE, false);
				await scheduler.paint();
			},
			session: this.session,
			next,
			persist: deps.persist ?? ((value) => this.host.setBodySemantropy(value)),
			persistAndCommit: deps.persist || !this.host.commitBodySemantropy ? undefined : async (value, commit) => {
				this.pendingLevelSave = true;
				try { return await this.host.commitBodySemantropy!(value, commit); }
				finally { this.pendingLevelSave = false; }
			},
			host: {
				getBodyGeneration: () => this.targetBody.getBodyGeneration(),
				getTextNodeCount: () => this.targetBody.getSequenceCount(),
				prepareResult: (generation, result) =>
					this.targetBody.prepare(generation, result, { isCurrent: current, scheduler }),
			},
			isAbandoned: () =>
				this.lifecycle.closed || (task !== null && !this.isBodyTaskCurrent(task)),
			transform: (_tokens, _pool, seed, level) => this.targetBody.transform(seed, level),
		});
		if (task !== null) {
			this.endBodyTask(task);
		}
		if (this.lifecycle.closed) {
			return outcome;
		}
		if (outcome === "applied") {
			this.lifecycle.reshuffleNotice = null;
		} else if (outcome === "failed") {
			console.error("[Semantropy] failed to change the Text level");
			this.lifecycle.reshuffleNotice = BODY_LEVEL_ERROR_MESSAGE;
		}
		// Chrome only: a level change must not rebuild the shell, or the
		// committed body would be detached from the view.
		this.updateChrome();
		if (outcome === "applied") {
			await this.emitPhaseReport(scheduler);
		}
		return outcome;
	}

	/**
	 * Every registered View is claimed and prepares its materialized Chunks at
	 * `next`; only then is the level saved, every View published and committed.
	 * A stale owner, a failed save or a failed publication rolls every View back
	 * and compensates the save, so no View keeps an old body under a new setting.
	 */
	private async changeBodyLevelTogether(coordinator: AutomaticPosCoordinator, next: BodySemantropy): Promise<BodyLevelChangeOutcome> {
		const state = this.session.getState();
		if (this.lifecycle.closed) return "aborted";
		if (state.status !== "ready") return "unavailable";
		if (state.bodySemantropy === next) return "unchanged";
		const scheduler = this.scheduler(), options = this.host.getAutomaticPos?.() ?? DEFAULT_AUTOMATIC_POS;
		const current = () => !this.lifecycle.closed;
		let outcome: BodyLevelChangeOutcome;
		if (!(await coordinator.prepare(this.automaticParticipant, options, current, next))) outcome = this.lifecycle.closed ? "aborted" : "failed";
		else outcome = await coordinator.commit(this.automaticParticipant, options, current) ? "applied" : this.lifecycle.closed ? "aborted" : "failed";
		if (this.lifecycle.closed) return outcome;
		if (outcome === "applied") this.lifecycle.reshuffleNotice = null;
		else if (outcome === "failed") {
			console.error("[Semantropy] failed to change the Text level");
			this.lifecycle.reshuffleNotice = BODY_LEVEL_ERROR_MESSAGE;
		}
		this.updateChrome();
		if (outcome === "applied") await this.emitPhaseReport(scheduler);
		return outcome;
	}

	/**
	 * Compares the note against the snapshot hash and records the verdict. It
	 * never re-reads the snapshot, re-tokenizes, or touches the body: a changed
	 * note is labelled, not applied.
	 */
	async recheckSourceFreshness(
		editorText: string | null = null,
		deps: { hashText?: (text: string) => Promise<string> } = {},
	): Promise<FreshnessCheckResult> {
		// Recorded before anything else: even when nothing is ready yet, the
		// request in flight must learn that the note moved.
		this.sourceWatch.notifyChanged();
		const generation = this.session.beginFreshnessCheck();
		const result = await checkSourceFreshness({
			generation,
			isCurrentGeneration: (id) => this.session.isCurrentFreshnessCheck(id),
			getReadySnapshot: () => this.session.getReadySnapshot(),
			// Text captured with the event beats a second read: it is the exact
			// buffer that changed, and re-reading could race the next keystroke.
			readCurrentText: (sourcePath) =>
				editorText === null
					? this.host.readCurrentText(sourcePath)
					: Promise.resolve(editorText),
			hashText: deps.hashText ?? hashSourceText,
			isAbandoned: () => this.lifecycle.closed,
			setFreshness: (snapshot, freshness) =>
				{ const applied = this.session.setSourceFreshness(snapshot, freshness); if (applied && freshness !== "fresh") { this.cancelAutomaticPos(); this.automaticController?.markStale(); this.targetBody.invalidateAutomatic("source-changed"); } this.dictionaryPopover?.validate(); return applied; },
		});
		if (result.status === "applied" && !this.lifecycle.closed) {
			this.updateChrome();
		}
		return result;
	}

	/**
	 * Marks the view stale because the note was renamed or deleted. It does not
	 * follow the note to its new path, and never adopts a different file.
	 */
	markSourceLost(): void {
		this.cancelAutomaticPos(); this.automaticController?.markStale(); this.targetBody.invalidateAutomatic("source-changed");
		if (this.lifecycle.closed) {
			return;
		}
		this.sourceWatch.notifyChanged();
		if (this.session.markSourceStale()) {
			this.updateChrome();
		}
	}

	async openCapture(
		capture: SourceCapture,
		deps: Pick<OpenSourceDependencies, "readCached"> &
			Partial<OpenSourceDependencies> & {
				/**
				 * True when the note changed between the caller capturing the
				 * body and this view starting to watch it. The view cannot see
				 * that window itself: on a first open it does not exist yet.
				 */
				capturedSourceChanged?: () => boolean;
			},
	): Promise<void> {
  if (this.session.getState().status === "ready" && this.targetBody.isDisplayIntact() && capture.kind === "markdown") {
   return this.replaceOpen(capture, deps);
  }
		this.cancelVocabularyPreparation();
		this.resetVocabulary();
		const requestId = this.session.beginLoading();
		// Open supersedes anything in flight, including a Refresh that may never
		// settle; it must not inherit that operation's claim on the actions.
		this.lifecycle.busy.revoke();
		this.bodyTask = null;
		const watchToken = this.sourceWatch.beginRequest(
			requestId,
			capture.kind === "markdown" ? capture.note.sourcePath : null,
		);
		this.lifecycle.reshuffleNotice = null;
		this.dismissDefinition();
		this.targetBody.release();
		this.renderShell();
		if (this.host.waitForPendingSettings) {
			await this.host.waitForPendingSettings();
			if (this.lifecycle.closed || !this.session.isCurrent(requestId)) return;
		}

		const captured = await captureSourceSnapshot(
			this.session,
			requestId,
			capture,
			{
				readCached: deps.readCached,
				hashText: deps.hashText ?? hashSourceText,
				issueSeed: deps.issueSeed ?? issueUint32Seed,
			},
		);
		if (!this.session.isCurrent(requestId)) {
			return;
		}
		if (!captured) {
			this.sourceWatch.endRequest(requestId);
			this.renderShell();
			return;
		}

		const applied = await this.prepareSnapshotBody(
			requestId,
			captured.snapshot,
			captured.bodySeed,
			this.host.getBodySemantropy(),
		);

		if (!this.session.isCurrent(requestId) || applied.status === "stale") {
			return;
		}
		this.sourceWatch.endRequest(requestId);
		if (applied.status !== "applied") {
			if (applied.status === "analyze-error") {
				console.error("[Semantropy] failed to analyze the note");
			}
			this.session.completeError(
				requestId,
				applied.status === "render-error"
					? TARGET_RENDER_ERROR_MESSAGE
					: ANALYZE_ERROR_MESSAGE,
			);
			this.targetBody.release();
			this.renderShell();
			return;
		}

		this.session.completeReady(
			requestId,
			captured.snapshot,
			captured.bodySeed,
			applied.analysis,
		);
		if (
			this.sourceWatch.changedSince(watchToken) ||
			deps.capturedSourceChanged?.() === true
		) {
			// Same rule as Refresh, extended back to the moment the body was
			// captured: a note that moved at any point during the Open does not
			// get to be published as fresh.
			this.session.setSourceFreshness(captured.snapshot, "stale");
		}
		this.renderShell();
		this.attachRenderedBody();
		await this.emitPhaseReport(this.scheduler());
	}

 /** Reopening a ready View stages a distinct owner; failure keeps the complete previous result. */
 private async replaceOpen(capture: SourceCapture, deps: Pick<OpenSourceDependencies, "readCached"> & Partial<OpenSourceDependencies> & { capturedSourceChanged?: () => boolean }): Promise<void> {
  this.cancelVocabularyPreparation(); this.lifecycle.busy.revoke(); this.bodyTask = null;
  const previous = this.session.getReadySnapshot(), old = this.targetBody, container = this.bodyEl;
  if (!previous || !container) return;
  const request = this.session.beginRefresh();
  const watch = this.sourceWatch.beginRequest(request, capture.kind === "markdown" ? capture.note.sourcePath : null);
  const parent = container.parentNode;
  const current = () => !this.lifecycle.closed && this.session.isCurrent(request) && this.session.getReadySnapshot() === previous &&
   this.targetBody === old && this.bodyEl === container && container.parentNode === parent && container.isConnected && old.isDisplayIntact();
  const task = this.beginBodyTask("Opening target…", true);
  const staged = new ChunkTargetBodyController();
  let published = false;
  try {
   await this.host.waitForPendingSettings?.(); if (!current()) return;
   const captureSession = new SemantropySession(), id = captureSession.beginLoading();
   const captured = await captureSourceSnapshot(captureSession, id, capture, { readCached: deps.readCached, hashText: deps.hashText ?? hashSourceText, issueSeed: deps.issueSeed ?? issueUint32Seed });
   if (!current()) return;
   if (!captured) { this.lifecycle.reshuffleNotice = TARGET_RENDER_ERROR_MESSAGE; return; }
   const scheduler = this.scheduler(); await scheduler.paint(); if (!current()) return;
   const result = await staged.open({ snapshot: captured.snapshot, bodySeed: captured.bodySeed, bodySemantropy: this.host.getBodySemantropy(), automaticPos: this.host.getAutomaticPos?.(),
    dictionarySemantropy: this.dictionaryLevel(), markerVisibility: this.markerVisibility(), targetSize: this.host.targetChunkSize,
    targetRevision: request, getTokenizer: () => this.host.getTokenizer(), scheduler, isCurrent: current, ownerDocument: container.ownerDocument });
   if (!current()) return;
   if (result.status !== "applied") { if (result.status !== "stale") this.lifecycle.reshuffleNotice = TARGET_RENDER_ERROR_MESSAGE; return; }
   const dom = targetDomTransaction(container, [staged.getContainer()!]);
   try { published = this.session.completeReady(request, captured.snapshot, captured.bodySeed, result.analysis, dom.publish); }
   finally { if (!published) dom.rollback(); }
   if (!published) return;
   this.targetBody = staged; this.resetVocabulary(); old.release(); this.dismissDefinition();
   if (this.sourceWatch.changedSince(watch) || deps.capturedSourceChanged?.()) this.session.setSourceFreshness(captured.snapshot, "stale");
   this.lifecycle.reshuffleNotice = null;
  } catch { if (current()) this.lifecycle.reshuffleNotice = TARGET_RENDER_ERROR_MESSAGE; }
  finally {
   if (!published) staged.release();
   this.sourceWatch.endRequest(request); this.endBodyTask(task);
   if (!this.lifecycle.closed && this.session.isCurrent(request)) this.updateChrome();
  }
  if (published) await this.emitPhaseReport(this.scheduler());
 }

	/**
	 * Builds the Target body for one snapshot, for Open and Refresh alike:
	 * safe projection only, a new detached body, and no reuse of the previous
	 * analysis. The loading shell gets a frame before any tokenizing.
	 */
	private async prepareSnapshotBody(
		requestId: number,
		snapshot: SourceSnapshot,
		bodySeed: number,
		bodySemantropy: BodySemantropy,
		controller = this.targetBody,
		extraCurrent: () => boolean = () => true,
	): Promise<TargetOpenResult> {
		const scheduler = this.scheduler();
		const container = this.contentEl, parent = container.parentNode, connected = container.isConnected;
		const isCurrent = (): boolean =>
			!this.lifecycle.closed && this.session.isCurrent(requestId) && extraCurrent() &&
			this.contentEl === container && container.parentNode === parent && container.isConnected === connected;
		await scheduler.paint();
		if (!isCurrent()) {
			return { status: "stale" };
		}
		return await controller.open({
			automaticPos: this.host.getAutomaticPos?.(),
			vocabularySources: this.vocabularySelection.mode === "selected" ? this.targetBody.getVocabularySources() : undefined,
			drawMode: this.vocabularySelection.drawMode,
			sourceWeights: selectionSourceWeights(this.vocabularySelection),
			enclosedTerms: this.enclosedTerms(),
			targetSize: this.host.targetChunkSize ?? PROVISIONAL_TARGET_CHUNK_SIZE,
			targetRevision: requestId,
			snapshot,
			bodySeed,
			bodySemantropy,
   dictionarySemantropy: this.dictionaryLevel(),
   markerVisibility: this.markerVisibility(),
			getTokenizer: () => this.host.getTokenizer(),
			isCurrent,
			scheduler,
			ownerDocument: this.contentEl.ownerDocument,
		});
	}

	private scheduler(): CooperativeScheduler {
		return (
			this.host.scheduler ??
			createWindowScheduler(this.contentEl.ownerDocument.defaultView ?? window)
		);
	}

	/** One claim over Reshuffle, Refresh, level changes, Copy and Collect. */
	private actionBusyGuard(): BusyGuard {
		return {
			acquire: () => {
				const token = this.lifecycle.busy.acquire();
				this.syncActionControls();
				return token;
			},
			release: (token) => {
				this.lifecycle.busy.release(token);
				if (!this.lifecycle.closed) {
					this.syncActionControls();
				}
			},
		};
	}

	/** `prominent: false` keeps a quick, local task (the next section, markers) out of the centred card. */
	private beginBodyTask(message: string, cancellable: boolean, prominent = true): number {
		this.bodyTaskCount += 1;
		this.bodyTask = { id: this.bodyTaskCount, message, cancellable, prominent };
		this.updateChrome();
		return this.bodyTaskCount;
	}

	private isBodyTaskCurrent(id: number): boolean {
		return !this.lifecycle.closed && this.bodyTask?.id === id;
	}

	private endBodyTask(id: number): void {
		if (this.bodyTask?.id === id) {
			this.bodyTask = null;
		}
	}

	/**
	 * Cancels a cancellable body task and frees its claim. The work notices at
	 * its next checkpoint, and its commit refuses even if it gets that far.
	 */
	private cancelBodyTask(): void {
		if (this.bodyTask?.cancellable !== true) {
			return;
		}
		this.bodyTask = null;
		this.lifecycle.busy.revoke();
	}

	private async emitPhaseReport(scheduler: CooperativeScheduler): Promise<void> {
		const recorder = this.phaseRecorder;
		const report = this.targetBody.takePhaseReport();
		if (!recorder || !report) {
			return;
		}
		const started = scheduler.now();
		await scheduler.paint();
		report.phases.paintAfterCommit = scheduler.now() - started;
		try {
			recorder(report);
		} catch {
			// Instrumentation never affects the view.
		}
	}

	private attachRenderedBody(): void {
		const rendered = this.targetBody.getContainer();
		if (this.bodyEl && rendered) {
			this.bodyEl.appendChild(rendered);
   this.syncDictionaryDiagnostics();
		}
		// The shell was drawn before the body joined it, when nothing was operable yet.
		this.syncTokenAffordance();
	}

	private unbindActions(): void {
		this.unbindLoad?.();
		this.unbindLoad = null;
	}

	private viewModel() {
		return toSemantropyViewModel(this.session.getState(), {
			busy: this.lifecycle.busy.isBusy(),
			transforming: this.bodyTask?.cancellable === true,
		});
	}

	/** The effective display settings; a host without them uses the defaults. */
	private displaySettings(): SemantropyDisplaySettings {
		return this.host.getDisplaySettings?.() ?? defaultSemantropyDisplaySettings();
	}

	private statusModel(): ToolbarStatusModel {
		const vocabulary = this.getVocabularyState();
		return toToolbarStatusModel({
			sessionStatus: this.session.getState().status,
			model: this.viewModel(),
			taskMessage: this.bodyTask?.message ?? null,
			noticeMessage: this.lifecycle.reshuffleNotice ?? null,
			vocabulary: {
				preparing: vocabulary.preparing,
				progress: vocabulary.progress,
				error: vocabulary.error,
				staleSources: vocabulary.staleSources,
			},
		});
	}

	/**
	 * Builds the view's three regions and their ownership.
	 *
	 *   root            flex column, overflow hidden
	 *     Toolbar       never scrolls
	 *     status        never scrolls
	 *     scroll        min-height: 0; overflow: auto — the only scrolling box
	 *       body        the committed Target DOM
	 *       Load next   inside the scrolling box, after the body
	 *
	 * Scrolling a long Target to its end therefore cannot take the Toolbar off
	 * screen, with no dependence on `position: sticky`. Adding a Chunk does not
	 * come through here: it appends into the committed body and leaves the
	 * shell, the selection and the scroll position alone.
	 */
	private renderShell(): void {
  this.dictionaryPopover?.dispose(); this.dictionaryPopover = null;
		this.closeManualMenu();
		this.vocabularyControls?.dispose(); this.vocabularyControls = null;
		this.toolbar?.dispose(); this.toolbar = null;
		this.unbindActions();
		this.unbindBodySelection();
		this.selection = null;
		this.contentEl.empty();
		this.clearChromeRefs();
		this.shellLabels.clear();
		const ready = this.session.getState().status === "ready";
		const root = this.contentEl.createDiv({ cls: "semantropy-root" });
		this.toolbar = new SemantropyToolbar(root, {
			model: () => this.viewModel(),
			status: () => this.statusModel(),
			display: () => this.displaySettings(),
			alert: () => this.markerApplyError,
			// One resolution of the exact one-token selection feeds both the
			// controls and the diagnostic sentence, so they cannot disagree. The
			// diagnostic is the one this plan already computed for that slot: no
			// Source read, tokenize, Snapshot scan or surface search happens here.
			manual: () => { const slot = this.selectedManualSlot(); return { selected: !!slot?.manualEligible,
				selectedShuffleable: slot?.manualDiagnostic.status === "available",
				selectedOverridden: !!slot && this.targetBody.hasManualOverride(slot),
				count: this.targetBody.getManualOverrideCount(), diagnostic: slot?.manualDiagnostic ?? null }; },
			vocabularyHost: (entry, summary) => {
				if (!ready) return;
				this.vocabularyControls = new VocabularyControls(entry, summary, {
					state: () => this.getVocabularyState(),
					open: () => this.openVocabularyPicker(),
				});
			},
			reshuffle: () => { void this.reshuffle(); },
			refreshTarget: () => { void this.refreshSource(); },
			copy: () => { void this.copySelectedFragment(); },
			collect: () => { void this.collectSelectedFragment(); },
			collision: () => this.openCollision(),
			fakeProverb: () => this.openFakeProverb(),
			...(this.host.recomposeDialog === false ? {} : { recompose: () => this.openRecompose() }),
			cancelVocabulary: () => { this.cancelVocabulary(); },
			setBodySemantropy: (value) => { this.onLevelSelected(value); },
			setDisplay: (patch) => { void this.changeDisplaySettings(patch); },
			resetDisplay: () => { void this.resetDisplaySettings(); },
			shuffleSelected: () => { this.runManual("shuffle", this.selectedManualSlot()); },
			restoreSelected: () => { this.runManual("restore", this.selectedManualSlot()); },
			useAutomaticSelected: () => { this.runManual("automatic", this.selectedManualSlot()); },
			clearManual: () => { if (this.targetBody.clearManual() === "applied") { this.afterManualChange(); } },
		});
		this.mountAutomatic(this.toolbar.automaticHost);
		const diagnostics = root.createEl("details", { cls: "semantropy-dictionary-diagnostics" });
  this.shellLabels.text(diagnostics.createEl("summary"), () => ui().dictionary.availability);
  this.dictionaryDiagnosticEl = diagnostics.createDiv({ attr: { role: "status" } });
  this.dictionaryCountsEl = diagnostics.createDiv();
  const modifierLabel = diagnostics.createEl("label");
  this.shellLabels.text(modifierLabel.appendChild(modifierLabel.ownerDocument.createTextNode("")), () => ui().dictionary.hoverModifier);
  const modifier = modifierLabel.createEl("select");
  this.shellLabels.text(modifier.createEl("option", { value: "alt" }), () => dictionaryAltLabel(Platform.isMacOS));
  this.shellLabels.text(modifier.createEl("option", { value: "shift" }), () => ui().dictionary.shift);
  modifier.value = this.displaySettings().dictionaryModifier;
  modifier.addEventListener("change", () => {
   if (modifier.value === "alt" || modifier.value === "shift") void this.changeDisplaySettings({ dictionaryModifier: modifier.value });
  });
  this.scrollEl = root.createDiv({ cls: "semantropy-scroll" });
  // Visual only: the status line above already announces the same state.
  this.busyEl = root.createDiv({ cls: "semantropy-busy", attr: { "aria-hidden": "true" } });
  this.busyEl.hidden = true;
  const busyCard = this.busyEl.createDiv({ cls: "semantropy-busy-card" });
  busyCard.createDiv({ cls: "semantropy-busy-spinner" });
  this.busyTextEl = busyCard.createDiv({ cls: "semantropy-busy-text" });
  this.busyDetailEl = busyCard.createDiv({ cls: "semantropy-busy-detail" });
		if (ready) {
			this.bodyEl = this.scrollEl.createDiv({ cls: SEMANTROPY_BODY_CLASS });
			this.loadButton = this.scrollEl.createEl("button", {
				cls: "semantropy-action semantropy-load-next",
				attr: { type: "button" },
			});
			this.shellLabels.text(this.loadButton, () => ui().view.loadNext);
			this.unbindLoad = bindExclusiveClick(this.unbindLoad, this.loadButton, () => {
				void this.loadNextSection();
			});
			this.syncLoadControl();
			this.bindBodySelection();
			this.bindManualActions();
   this.bindDictionaryPopover(root);
		}
		this.applyBodyDisplayStyles();
		this.syncTokenAffordance();
		// An Open draws the shell and then waits for analysis without another chrome pass.
		this.syncBusyOverlay();
	}

	/**
	 * Applies the display settings to the body alone.
	 *
	 * Font, size and colours are set on the body element, and ruby visibility
	 * is a class on it, so none of them reaches the Toolbar, the status line or
	 * the Load control, and none of them re-runs a transform, a tokenize, a
	 * Source read or a candidate draw. Hiding ruby removes the reading from
	 * view without touching the base text, the token identity or what Copy and
	 * Collect return: readings were never part of the logical text.
	 */
	private applyBodyDisplayStyles(): void {
		const display = this.displaySettings();
		// 0.1.0 S2: the theme and the custom colours belong to the whole preview
		// region, so the space below the text matches it; the Toolbar keeps the host's.
		const scroll = this.scrollEl;
		if (scroll) {
			scroll.classList.toggle("semantropy-theme-light", display.bodyTheme === "light");
			scroll.classList.toggle("semantropy-theme-dark", display.bodyTheme === "dark");
			const palette = display.bodyTheme === "default" ? null : BODY_THEME_PALETTES[display.bodyTheme];
			for (const name of Object.keys(BODY_THEME_PALETTES.light)) scroll.style.setProperty(name, palette?.[name] ?? "");
			scroll.style.setProperty("background-color", display.bodyBackground ?? "");
			scroll.style.setProperty("color", display.bodyForeground ?? "");
		}
		const body = this.bodyEl;
		if (!body) return;
		const stack = BODY_FONT_STACKS[display.bodyFontFamily];
		body.style.setProperty("font-family", stack ?? "");
		body.style.setProperty(
			"font-size",
			display.bodyFontSizePx === null ? "" : `${display.bodyFontSizePx}px`,
		);
		body.classList.toggle("is-ruby-hidden", !display.showRuby);
	}

	/** The marker visibility the current display settings ask for. */
	private markerVisibility(): DisplayMarkerVisibility {
		const display = this.displaySettings();
		return {
			replacement: display.showReplacementMarkers,
			manual: display.showManualMarkers,
			dictionary: display.showDictionaryMarkers,
		};
	}

	/**
	 * Changes one or more display settings.
	 *
	 * The order is fixed: persist, then apply. A refused or failed write leaves
	 * the stored settings and every view exactly as they were and reports a
	 * fixed message, so the reader is never shown a body that disagrees with
	 * what was saved. A successful write is authoritative even if this view
	 * closes before its own body can be re-marked; the setting is applied to
	 * every open view, and a view that opens later reads it at build time.
	 *
	 * `saved-not-applied` is the honest outcome for the one case where the two
	 * really can differ: the write succeeded, but this view could not re-mark
	 * its body. It is reported rather than reduced to `applied`, and it is not
	 * `failed` either — the setting is stored, and saying otherwise would send
	 * the reader looking for a write that did happen.
	 */
	async changeDisplaySettings(
		patch: Partial<SemantropyDisplaySettings>,
	): Promise<"applied" | "unchanged" | "failed" | "aborted" | "saved-not-applied"> {
		if (this.lifecycle.closed) return "aborted";
		const current = this.displaySettings();
		const changed = Object.entries(patch).filter(
			([key, value]) => current[key as keyof SemantropyDisplaySettings] !== value,
		);
		if (changed.length === 0) return "unchanged";
		const save = this.host.setDisplaySettings;
		if (!save) return "failed";
		const saved = await save(Object.fromEntries(changed));
		if (!saved) {
			if (!this.lifecycle.closed) {
				this.displayError = DISPLAY_SAVE_ERROR_MESSAGE;
				this.toolbar?.setMenuMessage(this.displayError);
			}
			return "failed";
		}
		if (this.lifecycle.closed) return "aborted";
		this.displayError = null;
		this.toolbar?.setMenuMessage(null);
		await this.applyStoredDisplaySettings();
		if (this.lifecycle.closed) return "aborted";
		// The Toolbar reads `markerApplyError` itself on every sync, so there
		// is nothing to push here: the outcome only names what happened.
		return this.markerApplyError === null ? "applied" : "saved-not-applied";
	}

	/**
	 * Puts the display settings this Toolbar offers back to their defaults, in
	 * one explicit write.
	 *
	 * Two stored fields are deliberately outside its reach. The draw mode is a
	 * Vocabulary Snapshot input, so a display Reset must never re-draw the
	 * body. The dictionary modifier has no control in this slice, so resetting
	 * it would silently change a future Hover behaviour the reader never
	 * touched here.
	 */
	async resetDisplaySettings(): Promise<
		"applied" | "unchanged" | "failed" | "aborted" | "saved-not-applied"
	> {
		const {
			vocabularyDrawMode: _drawMode,
			dictionaryModifier: _modifier,
			...display
		} = defaultSemantropyDisplaySettings();
		return await this.changeDisplaySettings(display);
	}

	/**
	 * Re-reads the stored display settings and brings this view's body to
	 * them. The plugin calls it on every open view after a successful save, so
	 * two views never disagree about what is stored.
	 */
	async applyStoredDisplaySettings(): Promise<void> {
		if (this.lifecycle.closed) return;
  this.dictionaryPopover?.close();
  const modifier = this.contentEl.querySelector<HTMLSelectElement>(".semantropy-dictionary-diagnostics select");
  if (modifier) modifier.value = this.displaySettings().dictionaryModifier;
		this.applyBodyDisplayStyles();
		this.updateChrome();
		await this.reconcileMarkerVisibility();
	}

	/** True while this view's body is not showing the stored marker settings. */
	getMarkerApplyError(): string | null {
		return this.markerApplyError;
	}

	/** True while the committed body already shows the stored marker settings. */
	private markersMatchStoredSettings(): boolean {
		const wanted = this.markerVisibility();
		const current = this.targetBody.getMarkerVisibility();
		return (
			this.targetBody.getDictionarySemantropy() === this.dictionaryLevel() &&
   current.replacement === wanted.replacement &&
			current.manual === wanted.manual &&
			current.dictionary === wanted.dictionary
		);
	}

	/**
	 * Brings the committed body to the stored marker settings, latest wins.
	 *
	 * The stored settings are the only description of what should be on
	 * screen, and they are re-read on every pass, so a burst of changes
	 * settles on the last one rather than on whichever re-mark happened to
	 * finish last. A view that is busy — a Collect in flight, a Reshuffle
	 * being prepared — cannot re-mark at that moment, so it records that a
	 * pass is owed and takes it when the claim is released.
	 *
	 * A preparation that fails, or a commit a newer owner invalidates, is
	 * retried a bounded number of times; the bound is what keeps a body that
	 * cannot be re-marked at all — a tampered display, for one — from spinning
	 * forever. When the bound is reached the body is left showing the previous
	 * markers and the view says so in a fixed message, because the setting is
	 * saved and silently showing something else is the state this must not
	 * settle into. The next explicit display change, or the next Open, reads
	 * the stored settings again.
	 */
	private async reconcileMarkerVisibility(): Promise<void> {
		if (this.markerReconciling) {
			// The running pass re-reads the stored settings, so it will pick
			// this change up; a retry is only owed if it has already stopped.
			this.markerRetryPending = true;
			return;
		}
		this.markerReconciling = true;
		try {
			let attempts = 0;
			while (
				!this.lifecycle.closed &&
				this.session.getState().status === "ready" &&
				!this.markersMatchStoredSettings()
			) {
				if (this.lifecycle.busy.isBusy()) {
					this.markerRetryPending = true;
					return;
				}
				if (attempts >= MARKER_RECONCILE_ATTEMPTS) {
					this.markerApplyError = MARKER_APPLY_ERROR_MESSAGE;
					return;
				}
				attempts += 1;
				const outcome = await this.setMarkerVisibility(this.markerVisibility());
				if (outcome === "busy") {
					this.markerRetryPending = true;
					return;
				}
				// "failed" and "aborted" both fall through to another attempt:
				// the loop condition re-reads the stored settings and the
				// committed body, so a newer owner that already carries them
				// ends the pass instead of being re-marked.
			}
			this.markerApplyError = null;
		} finally {
			this.markerReconciling = false;
			// The pass settles the durable state either way, so the chrome is
			// redrawn from it here — a background reconciliation that succeeds
			// must take the warning down, not leave it behind.
			if (!this.lifecycle.closed) this.updateChrome();
		}
	}

	/** Takes an owed re-mark once the view is free again. */
	private retryMarkerVisibility(): void {
		if (
			!this.markerRetryPending ||
			this.markerReconciling ||
			this.lifecycle.closed ||
			this.lifecycle.busy.isBusy()
		) {
			return;
		}
		this.markerRetryPending = false;
		void this.reconcileMarkerVisibility();
	}

	private updateChrome(): void {
		if (!this.lifecycle.closed && this.automaticController?.read().status === "stale" && this.targetBody.isAutomaticCurrent() && this.toolbar)
			this.mountAutomatic(this.toolbar.automaticHost);
		this.automaticToolbar?.setBlocked(this.lifecycle.busy.isBusy());
		this.collisionModal?.sync();
		this.fakeProverbModal?.sync();
		this.recomposeModal?.sync();
  this.dictionaryPopover?.validate(); this.syncDictionaryDiagnostics();
		if (this.manualMenu && this.manualMenuRevision !== this.targetBody.getDisplayRevision()) this.closeManualMenu();
		this.syncVocabularyChrome();
		this.toolbar?.sync();
		this.syncLoadControl();
		this.syncTokenAffordance();
		this.syncBusyOverlay();
		this.retryMarkerVisibility();
	}

	/**
	 * Shows the centred card while the Target is being opened, analyzed,
	 * reshuffled, refreshed or re-levelled, or while the Vocabulary is being
	 * prepared. It reads the same status model as the status line, so the two
	 * never disagree; the committed body stays underneath, dimmed.
	 */
	private syncBusyOverlay(): void {
		const overlay = this.busyEl;
		if (!overlay || !this.busyTextEl || !this.busyDetailEl) return;
		const status = this.statusModel();
		const show = !this.lifecycle.closed && (status.kind === "preparing-vocabulary"
			|| (status.kind === "loading-target" && this.bodyTask?.prominent !== false));
		if (!show) {
			if (!overlay.hidden) overlay.hidden = true;
			return;
		}
		const text = status.message ? localize(status.message) : "";
		const detail = status.detail ? localize(status.detail) : "";
		if (this.busyTextEl.textContent !== text) this.busyTextEl.textContent = text;
		if (this.busyDetailEl.textContent !== detail) this.busyDetailEl.textContent = detail;
		this.busyDetailEl.hidden = detail === "";
		// Cover the scrolling body only: the Toolbar and its Cancel stay usable.
		const top = this.scrollEl ? this.scrollEl.offsetTop : 0;
		overlay.style.setProperty("top", `${top}px`);
		if (overlay.hidden) overlay.hidden = false;
	}

	/**
	 * The pointer affordance of operable words follows what a click or a hover
	 * would really do right now. Tokens carry what they can offer
	 * (`semantropy-manual-operable`, `semantropy-dictionary-operable`); this View
	 * says whether it will act, with one class per kind on its body element — no
	 * per-token state or listener. Unloaded Chunks have no tokens to mark.
	 */
	private syncTokenAffordance(): void {
		const body = this.bodyEl;
		if (!body) return;
		const idle = this.tokenActionIdle();
		body.classList.toggle("is-manual-live", idle);
		body.classList.toggle("is-dictionary-live", idle && this.dictionaryActionable());
	}

	private tokenActionIdle(): boolean {
		return !this.lifecycle.closed && !this.lifecycle.busy.isBusy() && this.targetBody.isDisplayIntact();
	}

	/** Whether looking a word up would act now; the dictionary cursor and the word menu's item share it. */
	private dictionaryActionable(): boolean {
		return this.dictionaryLive() && !this.dictionaryBusy.isBusy() && !this.vocabularyTask;
	}

	/** The View-wide half of a Fake Dictionary hover's currency; the target checks the rest. */
	private dictionaryLive(): boolean {
		const state = this.session.getState();
		return !this.lifecycle.closed && state.status === "ready" && state.freshness === "fresh" && !this.staleSources.size && !this.targetVocabularyChanged;
	}

	/**
	 * Reads the selected value and applies it. A selection equal to the current
	 * value settles as "unchanged" in the coordinator and touches nothing.
	 */
	private onLevelSelected(raw: number): void {
		if (!isBodySemantropy(raw)) {
			// The options are generated from validated values, so this can only
			// mean the control was tampered with; put it back and do nothing.
			this.syncActionControls();
			return;
		}
		void this.setBodySemantropy(raw);
	}

	private syncLoadControl(): void {
		if (!this.loadButton) return;
		this.loadButton.hidden = !this.targetBody.hasNext();
		this.loadButton.disabled = this.lifecycle.closed || this.lifecycle.busy.isBusy() || !this.targetBody.hasNext();
	}

	private syncActionControls(): void {
		this.syncLoadControl();
		this.syncTokenAffordance();
		this.toolbar?.sync();
		this.automaticToolbar?.setBlocked(this.lifecycle.busy.isBusy());
		this.retryMarkerVisibility();
	}

	/**
	 * Records the reader's explicit body selection logically.
	 *
	 * Only this view's committed body is read, through the controller's own
	 * UTF-16 binding map; `Range.toString()` and re-searching the text are
	 * never the authority. Ruby readings, `rp`, the Toolbar, the status line,
	 * the Load control and anything outside the body cannot contribute,
	 * because none of them is part of the body's logical text. Nothing here
	 * calls `preventDefault`, so ordinary drag, double-click, Shift+arrow and
	 * form input keep working.
	 */
	private captureBodySelection(): void {
		if (this.lifecycle.closed) return;
		const owner = this.targetBody;
		const selection = this.contentEl.ownerDocument.getSelection();
		const logical = owner.readLogicalSelection(selection);
		if (logical) {
			const slot = owner.readSelectedSlot(selection);
			this.selection = {
				owner,
				slot,
				snapshot: {
					viewId: this.viewId,
					bodyGeneration: owner.getBodyGeneration(),
					displayRevision: owner.getDisplayRevision(),
					...logical,
				},
			};
		} else {
			// Collapsing the selection inside this body is a deliberate deselect.
			//
			// A document has exactly one selection, so an explicit pick inside another
			// Semantropy body takes this view's highlight off the screen: what this
			// view recorded is then nothing the reader can see or act on here, and
			// keeping it would leave two views offering "selected word" actions at
			// once. Chrome inside this view — the Toolbar, the status line, the title
			// — is not a body: the record survives it, so that reaching for a control
			// still leaves Copy and Collect a fragment, which is the whole point of
			// recording it logically. Manual actions make their own, stricter decision
			// in `selectedManualSlot`.
			const anchor = selection?.anchorNode ?? null;
			const container = owner.getContainer();
			const element = anchor ? (anchor.nodeType === 1 ? anchor as Element : anchor.parentElement) : null;
			const body = element?.closest(`.${SEMANTROPY_BODY_CLASS}`) ?? null;
			const ownDeselect = !!anchor && !!container && (anchor === container || container.contains(anchor));
			const otherBody = !!body && !(container && body.contains(container));
			if (ownDeselect || otherBody) this.selection = null;
		}
		// Every selection change can change what the Manual controls may act on,
		// even when the record itself is untouched, so the Toolbar is always
		// re-derived. A sync that changes nothing writes nothing. During a pointer
		// drag in the body it waits for the release (see `selectionGesture`).
		if (this.selectionGesture) return;
		this.toolbar?.sync(); this.syncDictionaryDiagnostics();
	}

	/**
	 * The exact one-token selection this view acts on, or null.
	 *
	 * A live selection in this view's committed body wins. Only when there is
	 * none does the recorded logical selection apply, and only while the reader
	 * has not explicitly picked something else instead, and only after it has
	 * been re-validated against this view, this owner, this body generation and
	 * this display revision. The slot is then taken from the plan on screen by
	 * token identity: appending a Chunk rebuilds the plan for the unchanged
	 * prefix, so comparing object identity would silently drop a selection the
	 * reader still has, and would in any case never return an object the Manual
	 * entry points accept.
	 */
	private selectedManualSlot(): DisplaySlot | null {
		const selection = this.contentEl.ownerDocument.getSelection();
		const live = this.targetBody.readSelectedSlot(selection);
		if (live) return live;
		if (this.hasSelectionElsewhere(selection)) return null;
		const selected = this.selection;
		if (!selected?.slot || resolveLogicalSelection({ snapshot: selected.snapshot, owner: selected.owner, currentOwner: this.targetBody, viewId: this.viewId }).status !== "selected") return null;
		return this.targetBody.getDisplaySlot(selected.slot.tokenId);
	}

	/**
	 * Is there an explicit selection this body does not own?
	 *
	 * A document has one selection. Text picked in the Toolbar, the status line
	 * or anywhere else has taken the body's highlight off the screen, so Manual
	 * — which changes one word the reader can see selected — yields to it and
	 * offers nothing. A collapsed caret or a control merely taking focus
	 * replaces no selection and leaves the recorded pick in charge, which is
	 * exactly what lets these actions survive reaching for the Toolbar.
	 *
	 * Copy and Collect keep their own TOOLBAR1 contract and still read the
	 * recorded fragment here: they are read-only and not scoped to one word.
	 */
	private hasSelectionElsewhere(selection: ReturnType<Document["getSelection"]>): boolean {
		if (!selection || selection.rangeCount === 0) return false;
		// More than one range is never this view's single exact pick.
		if (selection.rangeCount > 1) return true;
		try {
			const range = selection.getRangeAt(0);
			if (range.collapsed) return false;
			const container = this.targetBody.getContainer();
			const node = range.commonAncestorContainer;
			return !(container && (node === container || container.contains(node)));
		} catch { return false; }
	}

	private bindManualActions(): void {
		const body = this.bodyEl;
		if (!body) return;
		const open = (event: Event, keyboard: boolean) => {
			const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".semantropy-token") : null;
			if (!target || !body.contains(target)) return;
			const slot = this.targetBody.getSlotForElement(target);
			// 0.1.0 S1: a word that offers only the Fake Dictionary opens the same menu with that one item,
			// and only while looking it up would act (the same rule as its cursor).
			if (!slot?.manualEligible && !(slot?.dictionaryAvailable && this.tokenActionIdle() && this.dictionaryActionable())) return;
			if (!keyboard) {
				const mouse = event as MouseEvent;
				if (mouse.detail !== 1 || !this.contentEl.ownerDocument.getSelection()?.isCollapsed) return;
			}
			this.openManualMenu(target, slot, keyboard);
		};
		const click = (event: Event) => open(event, false);
		const key = (event: Event) => { const value = event as KeyboardEvent; if (value.key === "Enter" || value.key === " ") { value.preventDefault(); open(event, true); } };
		body.addEventListener("click", click); body.addEventListener("keydown", key);
		this.unbindSelection.push(() => body.removeEventListener("click", click), () => body.removeEventListener("keydown", key));
	}

	private openManualMenu(origin: HTMLElement, slot: DisplaySlot, keyboard: boolean): void {
  this.dictionaryPopover?.close();
		this.closeManualMenu();
		const root = this.contentEl.querySelector<HTMLElement>(".semantropy-root"); if (!root) return;
		const labels = new UiLabels();
		const menu = root.createDiv({ cls: "semantropy-manual-menu", attr: { role: "menu" } });
		labels.attr(menu, "aria-label", () => ui().view.manualMenu);
		const add = (label: () => string, action: "shuffle" | "restore" | "automatic", disabled = false) => {
			const button = menu.createEl("button", { attr: { type: "button", role: "menuitem" } }); button.disabled = disabled;
			labels.text(button, label);
			button.addEventListener("click", () => this.runManual(action, slot));
		};
		if (slot.manualEligible) {
			add(() => ui().view.manualShuffle, "shuffle", !slot.manualAvailable); add(() => ui().view.manualRestore, "restore"); add(() => ui().view.manualAutomatic, "automatic", !this.targetBody.hasManualOverride(slot));
		}
		if (slot.dictionaryAvailable) {
			// 0.1.0 S1: the Fake Dictionary without a modifier key or the command palette.
			// The word's own span is the selection, so the page's selection is left alone
			// and defineSelectedWord applies exactly its one-word checks.
			const define = menu.createEl("button", { attr: { type: "button", role: "menuitem" } });
			define.disabled = !this.dictionaryActionable();
			labels.text(define, () => ui().view.manualDefine);
			define.addEventListener("click", () => {
				const range = origin.ownerDocument.createRange();
				range.selectNodeContents(origin);
				void this.defineSelectedWord({ selection: { rangeCount: 1, getRangeAt: () => range } });
			});
		}
		this.manualMenuLabels = labels;
		menu.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); this.closeManualMenu(true); } });
		this.manualMenu = menu; this.manualMenuOrigin = origin;
		this.manualMenuRevision = this.targetBody.getDisplayRevision();
		this.manualMenuKeyboard = keyboard;
		// Placed beside the word before focus moves into it, then kept there while the
		// body scrolls or the pane resizes. One View-owned set of listeners per open menu.
		const doc = this.contentEl.ownerDocument, win = doc.defaultView, scroll = this.scrollEl;
		const follow = () => this.positionManualMenu();
		scroll?.addEventListener("scroll", follow); win?.addEventListener("resize", follow);
		const observer = win?.ResizeObserver ? new win.ResizeObserver(follow) : null; observer?.observe(root);
		this.manualMenuTrack = [() => scroll?.removeEventListener("scroll", follow), () => win?.removeEventListener("resize", follow), () => observer?.disconnect()];
		this.positionManualMenu();
		if (keyboard) menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
		this.manualOutside = (event: Event) => { if (this.manualMenu && event.target instanceof Node && !menu.contains(event.target) && !origin.contains(event.target)) this.closeManualMenu(); };
		doc.addEventListener("pointerdown", this.manualOutside);
	}

	/**
	 * Puts the open Manual menu next to its word: below the word's last line,
	 * or above its first line when there is no room below, clamped into this
	 * View's root and the window. A word scrolled out of the body box closes
	 * the menu instead of leaving it floating beside nothing; keyboard focus
	 * then goes back to the word without scrolling it into view again.
	 */
	private positionManualMenu(): void {
		const menu = this.manualMenu, origin = this.manualMenuOrigin, root = menu?.parentElement, win = this.contentEl.ownerDocument.defaultView;
		if (!menu || !origin || !root || !win) return;
		if (!origin.isConnected) { this.closeManualMenu(); return; }
		const rects = Array.from(origin.getClientRects());
		const first = rects[0], last = rects[rects.length - 1];
		if (!first || !last) return;
		const pane = root.getBoundingClientRect(), bounds = overlayBounds(win, pane);
		// The word must still be on screen: inside the body box, and inside this View and the
		// window (a Toolbar taller than a tiny pane can push the body box itself out of view).
		const box = this.scrollEl?.getBoundingClientRect();
		const outside = (top: number, bottom: number) => last.bottom <= top || first.top >= bottom;
		if ((box && box.height > 0 && outside(box.top, box.bottom)) || (bounds.bottom > bounds.top && outside(bounds.top, bounds.bottom))) {
			this.closeManualMenu(menu.contains(this.contentEl.ownerDocument.activeElement), true); return;
		}
		menu.style.maxWidth = `${Math.max(0, bounds.right - bounds.left)}px`;
		menu.style.maxHeight = `${Math.max(0, bounds.bottom - bounds.top)}px`;
		const size = menu.getBoundingClientRect();
		const place = placeOverlay({ below: last, above: first, width: size.width, height: size.height, bounds });
		// Too tall for either side of the word: shorter, scrolling inside, never over the word.
		menu.style.maxHeight = `${place.maxHeight}px`;
		menu.style.left = `${place.left - pane.left}px`;
		menu.style.top = `${place.top - pane.top}px`;
		menu.classList.toggle("is-above", place.flipped);
	}

	private closeManualMenu(restore = false, preventScroll = false): void {
		const origin = this.manualMenuOrigin, keyboard = this.manualMenuKeyboard;
		if (this.manualOutside) this.contentEl.ownerDocument.removeEventListener("pointerdown", this.manualOutside);
		for (const off of this.manualMenuTrack) off();
		this.manualMenuTrack = [];
		this.manualOutside = null; this.manualMenu?.remove(); this.manualMenu = null; this.manualMenuLabels = null; this.manualMenuOrigin = null; this.manualMenuRevision = -1;
		this.manualMenuKeyboard = false;
		if (restore && keyboard && origin) this.targetBody.focusSlotElement(origin, preventScroll);
	}

	private runManual(action: "shuffle" | "restore" | "automatic", slot: DisplaySlot | null): void {
		if (!slot || this.lifecycle.busy.isBusy()) { this.closeManualMenu(); return; }
		const result = action === "shuffle" ? this.targetBody.shuffleManual(slot) : action === "restore" ? this.targetBody.restoreManual(slot) : this.targetBody.useAutomatic(slot);
		this.closeManualMenu();
		if (result === "applied") this.afterManualChange();
	}

	private afterManualChange(): void {
		this.selection = null; this.dismissDefinition(); this.updateChrome();
	}

	private bindBodySelection(): void {
		this.unbindBodySelection();
		const body = this.bodyEl;
		const doc = this.contentEl.ownerDocument;
		if (!body) return;
		const capture = () => { this.captureBodySelection(); };
		const begin = (event: Event) => { if ((event as PointerEvent).button === 0) this.selectionGesture = true; };
		// The gesture ends wherever the pointer is released, and a lost release
		// (focus left the window, a cancelled pointer, a move with no button held)
		// ends it too, so the lines can never stay held back.
		const end = () => { if (!this.selectionGesture) return; this.selectionGesture = false; this.captureBodySelection(); };
		const move = (event: Event) => { if (this.selectionGesture && (event as PointerEvent).buttons === 0) end(); };
		const view = doc.defaultView;
		for (const [target, type, handler] of [
			[doc, "selectionchange", capture],
			[body, "pointerup", capture],
			[body, "keyup", capture],
			[body, "pointerdown", begin],
			[doc, "pointerup", end],
			[doc, "pointercancel", end],
			[doc, "pointermove", move],
			...(view ? [[view, "blur", end] as const] : []),
		] as const) {
			target.addEventListener(type, handler);
			this.unbindSelection.push(() => target.removeEventListener(type, handler));
		}
	}

	private unbindBodySelection(): void {
		for (const off of this.unbindSelection) off();
		this.unbindSelection = [];
		this.selectionGesture = false;
	}

	/**
	 * The committed body is the only place a Copy or Collect may look. The
	 * active Markdown editor is never consulted, even when this view is stale.
	 */
	/**
	 * The selection a Copy or a Collect acts on.
	 *
	 * A live selection in this view's committed body always wins and refreshes
	 * the record. Only when there is none does the recorded logical selection
	 * apply, and only while it still belongs to this view, this body owner,
	 * this generation and this display revision, and still covers exactly the
	 * string it covered when it was made. A record that fails any of those is
	 * dropped without saving anything, and the reader is asked to select
	 * again rather than being given a guess.
	 */
	private resolveActionSelection(
		selection?: BodySelectionSource | null,
	): BodySelection & { message?: string } {
		const live = this.readCommittedBodySelection(selection);
		if (live.status === "selected") {
			if (selection === undefined) this.captureBodySelection();
			return live;
		}
		const recorded = this.selection;
		if (!recorded) return { status: "empty" };
		const resolved = resolveLogicalSelection({
			snapshot: recorded.snapshot,
			owner: recorded.owner,
			currentOwner: this.targetBody,
			viewId: this.viewId,
		});
		if (resolved.status === "selected") return { status: "selected", text: resolved.text };
		this.selection = null;
		return { status: "empty", message: SELECTION_INVALIDATED_MESSAGE };
	}

	/** One fixed string to the Notice and to the Toolbar's live region, in the current language. */
	private notify(message: string): void {
		this.host.showNotice(message);
		if (!this.lifecycle.closed) this.toolbar?.announce(message);
	}

	private readCommittedBodySelection(
		selection?: BodySelectionSource | null,
	): BodySelection {
		return this.targetBody.readSelection(
			selection !== undefined
				? selection
				: this.contentEl.ownerDocument.getSelection(),
		);
	}

	/**
	 * Logical offsets for Collect Manual overlap. Live mapped selection wins;
	 * otherwise the recorded Toolbar-safe snapshot, once it still matches.
	 * Surfaces are never searched.
	 */
	private collectLogicalRange(
		selection?: BodySelectionSource | null,
	): { start: number; end: number } | null {
		const live = this.targetBody.readLogicalSelection(
			selection !== undefined
				? selection
				: this.contentEl.ownerDocument.getSelection(),
		);
		if (live) {
			return live;
		}
		const recorded = this.selection;
		if (!recorded) {
			return null;
		}
		const resolved = resolveLogicalSelection({
			snapshot: recorded.snapshot,
			owner: recorded.owner,
			currentOwner: this.targetBody,
			viewId: this.viewId,
		});
		return resolved.status === "selected"
			? { start: recorded.snapshot.start, end: recorded.snapshot.end }
			: null;
	}

	private dismissDefinition(): void {
  this.dictionaryPopover?.close();
		this.pendingDefineId = null;
		this.definitionError = null;
		this.dictionaryLevelError = null;
		this.dictionaryWorld.invalidateDisplay();
		this.closeDefinitionModal();
	}

	/**
	 * An empty or unready Define still advances request generation so an
	 * in-flight tokenize cannot commit later, but it must also leave the Modal
	 * in a settled state: keep a displayed definition, or close a loading-only
	 * Modal rather than freeze it on "Generating a definition."
	 */
	private settleCancelledDefine(): void {
		this.pendingDefineId = null;
		this.definitionError = null;
		if (this.dictionaryWorld.getCurrent() === null) {
			this.closeDefinitionModal();
			return;
		}
		this.syncDefinitionModal();
	}

	private closeDefinitionModal(): void {
		this.dictionaryBusy.revoke();
		const modal = this.definitionModal;
		this.definitionModal = null;
		modal?.close();
	}

	private ensureDefinitionModal(): FakeDefinitionModal {
		if (this.definitionModal && this.definitionModal.isOpen()) {
			return this.definitionModal;
		}
		const modal = new FakeDefinitionModal(this.app, {
			getModel: () => this.toDefinitionViewModel(),
			onReshuffle: () => {
				this.reshuffleDefinition();
			},
			onCopy: () => {
				void this.copyDefinition();
			},
			onCollect: () => {
				void this.collectDefinition();
			},
			onSemantropyChange: (value) => {
				void this.setDictionarySemantropy(value);
			},
			onClosed: () => {
				if (this.definitionModal === modal) {
					this.definitionModal = null;
					this.pendingDefineId = null;
					this.definitionError = null;
					this.dictionaryLevelError = null;
					this.dictionaryWorld.invalidateDisplay();
					this.dictionaryBusy.revoke();
				}
			},
		});
		this.definitionModal = modal;
		modal.open();
		return modal;
	}

	private toDefinitionViewModel() {
		const pending = this.pendingDefineId;
		return toFakeDefinitionViewModel({
			current: this.dictionaryWorld.getCurrent(),
			dictionarySemantropy: this.dictionaryLevel(),
			pendingRequestId: pending,
			isPendingCurrent:
				pending !== null && this.dictionaryWorld.isCurrent(pending),
			errorMessage: this.definitionError,
			busy: this.dictionaryBusy.isBusy(),
			levelError: this.dictionaryLevelError,
		});
	}

	private syncDefinitionModal(): void {
  this.rememberDefinition();
  this.dictionaryPopover?.sync();
  this.definitionModal?.sync();
	}

 async dictionarySettingsChanged(): Promise<void> {
  if (this.lifecycle.closed) return;
  this.dismissDefinition(); this.updateChrome(); await this.reconcileMarkerVisibility();
 }
 private definitionIsOpen(): boolean {
  this.dictionaryPopover?.validate();
  return !!this.definitionModal?.isOpen() || !!this.dictionaryPopover?.isOpen();
 }
 private rememberDefinition(): void {
  const current = this.dictionaryWorld.getCurrent();
  if (current?.result.outcome === "generated" && this.dictionaryWorld.isCurrent(current.requestId))
   this.definitionCache.set(definitionCacheKey(current.headword, current.dictionarySeed, current.dictionarySemantropy, current.vocabulary), {
    result: current.result, target: current.snapshot, vocabulary: current.vocabulary,
   });
 }
 private hoverTarget(element: Element): DictionaryHoverTarget | null {
  if (element.closest("rt,rp,a,code,pre,input,textarea,select,button,[contenteditable=true]")) return null;
  const anchor = element.closest<HTMLElement>(".semantropy-token");
  if (!anchor || !this.bodyEl?.contains(anchor)) return null;
  const owner = this.targetBody, slot = owner.getSlotForElement(anchor), snapshot = owner.getVocabularySnapshot();
  if (!slot?.dictionaryAvailable || slot.dictionary.outcome !== "accepted" || !snapshot) return null;
  const world = this.dictionaryWorld, revision = owner.getDisplayRevision(), generation = owner.getBodyGeneration();
  const level = this.dictionaryLevel();
  return { slot, anchor, isCurrent: () => {
   return this.dictionaryLive() && this.targetBody === owner && this.dictionaryWorld === world &&
    owner.getBodyGeneration() === generation && owner.getDisplayRevision() === revision && owner.getVocabularySnapshot() === snapshot &&
    owner.getSlotForElement(anchor) === slot && this.dictionaryLevel() === level;
  } };
 }
 private bindDictionaryPopover(root: HTMLElement): void {
  if (!this.bodyEl || !this.scrollEl) return;
  this.dictionaryPopover = new DictionaryPopoverController(root, this.bodyEl, this.scrollEl, {
   modifier: () => this.displaySettings().dictionaryModifier,
   canStart: () => !this.lifecycle.closed && !this.lifecycle.busy.isBusy() && !this.dictionaryBusy.isBusy() && !this.vocabularyTask && !this.definitionModal?.isOpen() && !this.collisionModal && !this.fakeProverbModal && !this.recomposeModal,
   resolve: element => this.hoverTarget(element),
   begin: target => { this.closeManualMenu(); void this.defineHoverTarget(target); },
   closed: () => { this.pendingDefineId = null; this.definitionError = null; this.dictionaryWorld.invalidateDisplay(); },
   getModel: () => this.toDefinitionViewModel(),
   onCopy: () => { void this.copyDefinition(); }, onCollect: () => { void this.collectDefinition(); },
   onReshuffle: () => { this.reshuffleDefinition(); }, onSemantropyChange: value => { void this.setDictionarySemantropy(value); },
  });
 }
 private async defineHoverTarget(target: DictionaryHoverTarget): Promise<void> {
  const world = this.dictionaryWorld, owner = this.targetBody;
  const state = this.session.getState(), snapshot = owner.getVocabularySnapshot(), pool = owner.getDictionaryPool();
  if (state.status !== "ready" || !snapshot || !pool || !target.isCurrent()) return;
  const requestId = world.beginRequest();
  this.pendingDefineId = requestId; this.definitionError = null; this.dictionaryLevelError = null;
  const level = this.dictionaryLevel();
  try {
   const nonce = world.ensureSeed(issueUint32Seed);
   const current = () => target.isCurrent() && this.dictionaryPopover?.getTarget() === target &&
    world.isCurrent(requestId) && world.getSeed() === nonce;
   const result = await runDefineSelectedWord({
    selection: target.slot.displaySurface, identified: target.slot.dictionary,
    snapshot: dictionarySnapshotIdentityOf(state.snapshot), tokenSequences: state.tokenSequences, preparedPool: pool,
    dictionarySeed: nonce, dictionarySemantropy: level, getTokenizer: () => this.host.getTokenizer(),
    isCurrent: current, getSnapshotIdentity: () => {
     const ready = this.session.getReadySnapshot(); return ready ? dictionarySnapshotIdentityOf(ready) : null;
    },
    generate: request => {
     const key = definitionCacheKey(request.headword, nonce, level, snapshot);
     return this.definitionCache.getForWorld(key)?.result ?? generateFakeDefinition(request);
    },
   });
   if (!current()) { this.dictionaryPopover?.validate(); return; }
   if (result.status === "ready") {
    const cached = this.definitionCache.getForWorld(definitionCacheKey(result.headword, result.result.outcome === "generated" ? result.result.dictionarySeed : nonce, level, snapshot));
    const provenance = cachedDefinitionCommit(cached, result.result);
    world.commit(requestId, { headword: result.headword, pool, snapshot: provenance?.target ?? result.snapshot,
     vocabulary: provenance?.vocabulary ?? collectVocabularyFromSnapshot(snapshot),
     dictionarySeed: result.result.outcome === "generated" ? result.result.dictionarySeed : nonce, dictionarySemantropy: level, result: result.result });
   } else if (result.status !== "stale") this.definitionError = DEFINE_GENERATION_ERROR_MESSAGE;
  } catch { if (target.isCurrent() && world.isCurrent(requestId)) this.definitionError = DEFINE_GENERATION_ERROR_MESSAGE; }
  if (world.isCurrent(requestId)) this.syncDefinitionModal();
 }
 private syncDictionaryDiagnostics(): void {
  const snapshot = this.targetBody.getVocabularySnapshot();
  if (snapshot !== this.diagnosticSnapshot) {
   this.diagnosticSnapshot = snapshot; this.diagnosticCounts = snapshot ? dictionaryDiagnostics(snapshot) : null;
  }
  const counts = this.diagnosticCounts;
  if (this.dictionaryDiagnosticEl) {
   const state = this.session.getState();
   const text = dictionaryDiagnosticMessage({ level: this.dictionaryLevel(), preparing: !!this.vocabularyTask,
    stale: !!this.staleSources.size || this.targetVocabularyChanged || (state.status === "ready" && state.freshness !== "fresh"), slot: this.selectedManualSlot(), counts });
   const shown = localize(text);
   if (this.dictionaryDiagnosticEl.textContent !== shown) this.dictionaryDiagnosticEl.textContent = shown;
  }
  if (this.dictionaryCountsEl) {
   // Placeholder names are template codes and stay as written.
   const d = ui().dictionary;
   const text = counts ? [
    d.usable(counts.core, counts.totalCore, counts.families, counts.clauses, counts.totalClauses),
    d.candidatesNote,
    ...counts.sources.map(source => d.sourceCounts(source.ordinal, Object.entries(source.counts).map(([name, count]) => `${name}: ${count}`).join(", "))),
   ].join("\n") : "";
   if (this.dictionaryCountsEl.textContent !== text) this.dictionaryCountsEl.textContent = text;
  }
 }

	/**
	 * LOCALE1: the interface language changed. Every fixed text this View shows —
	 * the Toolbar, its popups, the status line, the Vocabulary picker, the Fake
	 * Dictionary Modal and Popover, Collision, Fake proverb, the Manual menu and
	 * the diagnostics — is re-worded in place. Nothing is rebuilt, re-analyzed,
	 * regenerated or written: focus, scroll, open dialogs, drafts, in-flight work
	 * and committed results stay exactly as they are.
	 */
	languageChanged(): void {
		if (this.lifecycle.closed) return;
		this.shellLabels.apply();
		this.manualMenuLabels?.apply();
		this.automaticToolbar?.relabel();
		this.vocabularyControls?.relabel();
		this.toolbar?.relabel();
		this.vocabularyModal?.relabel();
		this.definitionModal?.relabel();
		this.dictionaryPopover?.relabel();
		this.collisionModal?.relabel();
		this.fakeProverbModal?.relabel();
		this.recomposeModal?.relabel();
		this.syncDictionaryDiagnostics();
	}

	private clearChromeRefs(): void {
  this.dictionaryDiagnosticEl = null; this.dictionaryCountsEl = null;
		this.loadButton = null;
		this.bodyEl = null;
		this.scrollEl = null;
		this.busyEl = null;
		this.busyTextEl = null;
		this.busyDetailEl = null;
	}
}

function collectOutcome(
	result: CollectFragmentResult,
): CollectSelectedFragmentOutcome {
	switch (result.status) {
		case "created":
		case "appended":
		case "invalid-path":
		case "failed":
			return result.status;
		case "conflict":
			return "conflict";
		case "invalid":
			return result.reason === "empty-text" ? "empty" : "failed";
	}
}
