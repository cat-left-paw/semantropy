import { cachedDefinitionCommit, DefinitionCache, definitionCacheKey } from "../application/definitionCache";
import { SnapshotPoolCache } from "../application/snapshotPoolCache";
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
import { EN_MESSAGES, ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";
import { CollisionModal } from "./CollisionModal";
import { FakeProverbSession } from "./FakeProverbSession";
import { FakeProverbModal } from "./FakeProverbModal";
import { RecomposePane } from "./RecomposePane";
import { RecomposeSession, type RecomposeHost } from "./RecomposeSession";
import { FakeAlertModal } from "./FakeAlertModal";
import { DictionaryHelpModal } from "./DictionaryHelpModal";
import { generateFakeAlert, type FakeAlertPage } from "../fakeAlert/fakeAlertCore";
import { ANALYZE_ERROR_MESSAGE } from "../application/analyzeNoteTexts";
import { bodyFragmentFromAutomatic } from "../application/bodyFragmentFromAutomatic";
import { collectVocabularyFromSnapshot } from "../application/collectVocabulary";
import {
	RESHUFFLE_ERROR_MESSAGE,
	RESHUFFLE_UNAVAILABLE_MESSAGE,
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
import { WorkbenchTabs, type WorkbenchTab } from "./workbenchTabs";
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
	OPEN_KEPT_MESSAGE,
	REFRESH_TO_GENERATE_MESSAGE,
	toolbarStatusWithoutBody,
	toToolbarStatusModel,
	type ToolbarStatusModel,
} from "./toolbarStatusModel";
import { ShuffleBar } from "./ShuffleBar";
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
 * WORKBENCH-UI5 (decision 17): a note the reader chose as the target, captured the way the Open command captures
 * the active note — the editor's text when the note is open in an editor, the saved file otherwise — so the View
 * opens it with the same `openCapture`.
 */
/** A Vocabulary applied with no note, put aside while an Open reads a note (see `SemantropyView.stashedStandalone`). */
type StashedStandalone = {
	readonly vocabulary: ManualMorphVocabulary;
	readonly selection: VocabularySelection;
	readonly draft: VocabularySelection;
	readonly stale: Map<string, VocabularySourceIssue["reason"]>;
};

export type TargetChoice = {
	capture: SourceCapture;
	readCached: (sourcePath: string) => Promise<string>;
	capturedSourceChanged: () => boolean;
};

/**
 * The adapters the view needs from the plugin. They are stable for the view's
 * lifetime and resolve against Obsidian at call time, so the view never
 * holds a `TFile`, an `Editor`, a `Vault`, or a `CollectionStorage`.
 */
export type SemantropyViewHost = {
	automaticPosCoordinator?: AutomaticPosCoordinator;
	/**
	 * 0.1.0 S5: false says this host has its own Recompose (the web page's panel), so the View offers neither the
	 * Recompose control nor the tab, even with `workbenchTabs`. The name is from the dialog WORKBENCH-UI4 removed;
	 * it stays so the web host, which passes it, does not change.
	 */
	recomposeDialog?: boolean;
	/**
	 * WORKBENCH-UI1 (`Docs/release_0_2_0_plan.md` §3): true opens a note with its
	 * analysis and Vocabulary owner ready but without a Shuffle; the body shows
	 * Generate until the first Shuffle. Absent or false shuffles at open, as
	 * before. A host decision, never a stored setting.
	 */
	deferInitialShuffle?: boolean;
	/**
	 * WORKBENCH-UI2 (`Docs/release_0_2_0_plan.md` §3.3): true splits the body area
	 * into [Shuffle] [Recompose] tabs over the one scrolling box, also while no note
	 * is open (WORKBENCH-UI4), and gives the Toolbar its Recompose control: the
	 * tab is the only entry to Recompose. Absent or false keeps the single body and
	 * has no Recompose. A host that has its own Recompose (`recomposeDialog: false`,
	 * the web page) gets no tabs either. A host decision, never a stored setting.
	 */
	workbenchTabs?: boolean;
	/**
	 * WORKBENCH-UI5: asks the reader for a Markdown note (the host's own chooser; the View imports nothing of
	 * Obsidian for it) and returns it captured for an Open, or null when none was chosen. The signal is aborted when
	 * the View closes or opens again: the host closes its chooser then. Absent: the Shuffle area offers no way to choose a target.
	 */
	chooseTarget?: (signal: AbortSignal) => Promise<TargetChoice | null>;
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

/** How many recent Fake Alert openings the next draw tries not to repeat (the core accepts up to 16). */
const FAKE_ALERT_RECENT_KEPT = 8;
/** How many recently shown words the next Fake Alert draws more rarely (the core accepts up to 48). */
const FAKE_ALERT_RECENT_WORDS_KEPT = 24;

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
	/**
	 * WORKBENCH-UI2 stage 3: Recompose lives in the View's Recompose pane over one
	 * session for the View's lifetime, so its output stays until the View closes.
	 * The pane is the screen of the current shell only.
	 */
	private recomposeSession: RecomposeSession | null = null;
	private recomposeScreen: RecomposePane | null = null;
	private fakeAlertModal: FakeAlertModal | null = null;
	/** WORKBENCH-UI5: the Fake Dictionary dialog (how to look a word up, the key, what the Vocabulary offers); at most one per View. */
	private dictionaryHelpModal: DictionaryHelpModal | null = null;
	/** The opening recipes of the last few Fake Alerts; the draw prefers others. Never persisted. */
	private fakeAlertRecent: string[] = [];
	/** The words of the last pages Fake Alert put on screen, newest last; the next draw makes them rarer. Never persisted. */
	private fakeAlertRecentWords: string[] = [];
	private vocabularyDraft = initialVocabularySelection();
	private vocabularyGeneration = 0;
	private vocabularyTask: { generation: number; paths: readonly string[]; token: number; dictionaryToken: number } | null = null;
	private staleSources = new Map<string, VocabularySourceIssue["reason"]>();
	private targetVocabularyChanged = false;
	/**
	 * WORKBENCH-UI5 (review 3, P3 1): a Vocabulary applied from Selected Notes with no note, put aside while an Open reads a note, so that
	 * the note's body is made from the note's own (new) selection. A read or an analysis that fails puts it back; a note that opens drops it.
	 */
	private stashedStandalone: StashedStandalone | null = null;
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
	/** WORKBENCH-UI1: Generate in place of a body opened without a Shuffle; built only when the host defers it. */
	private generateEl: HTMLElement | null = null;
	private generateButton: HTMLButtonElement | null = null;
	private unbindGenerate: (() => void) | null = null;
	/**
	 * WORKBENCH-UI2: the tab row and the two panes inside the scrolling box, built
	 * only on a host with tabs. Which tab is shown and each tab's scroll position
	 * belong to the shell: never persisted, and a new shell starts on Shuffle.
	 */
	private tabRow: WorkbenchTabs | null = null;
	/** WORKBENCH-UI5: the Shuffle tab's own area under the tab row (target, body state, actions); built with the tabs. */
	private shuffleBar: ShuffleBar | null = null;
	/** The host's chooser is open (this aborts it); a second request waits for it. */
	private chooser: AbortController | null = null;
	private shufflePane: HTMLElement | null = null;
	private recomposePane: HTMLElement | null = null;
	private activeTab: WorkbenchTab = "shuffle";
	private tabScroll: Record<WorkbenchTab, { top: number; left: number }> = { shuffle: { top: 0, left: 0 }, recompose: { top: 0, left: 0 } };
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
	/**
	 * WORKBENCH-UI2 review 1 (P2): advances whenever the View drops the selection on
	 * purpose (leaving Shuffle). A change that captured the selection earlier puts it
	 * back on commit or rollback only while this has not moved.
	 */
	private selectionEpoch = 0;
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
 /** FAKE-DICT-RECOMPOSE1: the pool of the Vocabulary a Recompose word is looked up in; kept under its Snapshot, weakly. */
 private readonly recomposePools = new SnapshotPoolCache();
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
		// or a hover would actually do. FAKE-DICT-RECOMPOSE1: the Recompose text's mark reads both gates too.
		this.lifecycle.busy.onChange(() => { this.syncTokenAffordance(); this.syncRecomposeAffordance(); });
		this.dictionaryBusy.onChange(() => { this.syncTokenAffordance(); this.syncRecomposeAffordance(); });
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
		this.vocabularyControls?.refit();
		this.shuffleBar?.refit();
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
		this.closeFakeAlert(); this.fakeAlertRecent = []; this.fakeAlertRecentWords = [];
		this.closeDictionaryHelp();
		this.closeChooser();
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
		this.closeFakeAlert(); this.fakeAlertRecent = []; this.fakeAlertRecentWords = [];
		this.closeDictionaryHelp();
		this.closeChooser();
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
	/** Ends the View's Recompose session: its output does not outlive the View. */
	closeRecompose(): void {
		this.recomposeScreen?.dispose(); this.recomposeScreen = null;
		this.recomposeSession?.dispose(); this.recomposeSession = null;
	}
	private recomposeHost(): RecomposeHost {
		return { active: () => this.collisionVocabulary(), nonce: () => issueUint32Seed(),
			paint: () => this.scheduler().paint(), copy: text => this.host.writeClipboard(text), collect: input => this.host.collectFragment(input),
			// The text on screen changed (a step ran, or Clear): a Popover on a word of the old one goes, and the words' mark follows.
			changed: () => { if (this.lifecycle.closed) return; this.dictionaryPopover?.validate(); this.syncRecomposeAffordance(); } };
	}
	/**
	 * FAKE-ALERT-VIEW1 (`Docs/fake_alert_policy1.md` §8, §9): one Fake Alert
	 * from the same active owner as Collision, at the Text Semantropy level.
	 * The whole Alert — the opening page and every page a button leads to — is
	 * made before the dialog opens, so pressing a button never draws. A real
	 * problem is a Notice and never a Fake Alert.
	 */
	openFakeAlert(): void {
		if (this.lifecycle.closed || this.fakeAlertModal) return;
		this.dictionaryPopover?.close(); this.closeManualMenu();
		const owner = this.collisionVocabulary();
		if (!owner) { this.notify(EN_MESSAGES.fakeAlert.noVocabulary); return; }
		let generation: ReturnType<typeof generateFakeAlert>;
		try {
			generation = generateFakeAlert({ owner, level: this.host.getBodySemantropy(), nonce: issueUint32Seed(), recent: this.fakeAlertRecent,
				recentWords: this.fakeAlertRecentWords });
		} catch {
			generation = { ok: false, reason: "invalid-request" };
		}
		if (!generation.ok) {
			this.notify(generation.reason === "insufficient-vocabulary" ? EN_MESSAGES.fakeAlert.insufficient : EN_MESSAGES.fakeAlert.failed);
			return;
		}
		const alert = generation.alert;
		this.fakeAlertRecent = [...this.fakeAlertRecent, alert.prompt.recipeId].slice(-FAKE_ALERT_RECENT_KEPT);
		const origin = this.modalOrigin();
		const modal = new FakeAlertModal(this.app, alert, () => {
			if (this.fakeAlertModal === modal) this.fakeAlertModal = null;
		}, origin, (shown) => this.rememberFakeAlertWords(shown));
		this.fakeAlertModal = modal; modal.open();
	}
	closeFakeAlert(): void { this.fakeAlertModal?.close(); this.fakeAlertModal = null; }
	/**
	 * WORKBENCH-UI5 (decision 20): the Fake Dictionary dialog, from the Toolbar. It shows how to look a word up,
	 * the hover modifier (the stored setting) and, folded, what the active Vocabulary offers; while it is open the
	 * View writes its diagnostics into the dialog, not into a row of the shell (a host with tabs builds none).
	 */
	openDictionaryHelp(): void {
		// Only a host with tabs has the button and the dialog (the web page's availability row stays its own).
		if (!this.tabbed() || this.lifecycle.closed || this.dictionaryHelpModal) return;
		this.dictionaryPopover?.close(); this.closeManualMenu();
		const origin = this.modalOrigin();
		const modal: DictionaryHelpModal = new DictionaryHelpModal(this.app, {
			modifier: () => this.displaySettings().dictionaryModifier,
			setModifier: value => { void this.changeDisplaySettings({ dictionaryModifier: value }); },
			bind: (status, counts) => { this.dictionaryDiagnosticEl = status; this.dictionaryCountsEl = counts; this.syncDictionaryDiagnostics(); },
			unbind: () => { this.dictionaryDiagnosticEl = null; this.dictionaryCountsEl = null; },
			closed: () => { if (this.dictionaryHelpModal === modal) this.dictionaryHelpModal = null; },
			// The shell may have been built again under the open dialog: focus goes back to the button that stands now.
			focusTarget: () => this.toolbar?.returnTarget(this.contentEl.querySelector<HTMLElement>(".semantropy-fake-dictionary-open")) ?? null,
		}, origin);
		this.dictionaryHelpModal = modal; modal.open();
	}
	closeDictionaryHelp(): void { const modal = this.dictionaryHelpModal; this.dictionaryHelpModal = null; modal?.close(); }
	/** FAKE-ALERT-VARIETY1: a page's words move to the newest end of the recent list, which keeps its last few. */
	private rememberFakeAlertWords(page: FakeAlertPage): void {
		if (this.lifecycle.closed) return;
		const shown = new Set(page.words.map((word) => word.surface));
		this.fakeAlertRecentWords = [...this.fakeAlertRecentWords.filter((word) => !shown.has(word)), ...shown].slice(-FAKE_ALERT_RECENT_WORDS_KEPT);
	}
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
			this.dictionaryBusy.isBusy() || this.pendingDefineId !== null || this.definitionModal?.isShowing()) return null;
		const token = this.lifecycle.busy.acquire(); if (token === null) return null;
		const dictionaryToken = this.dictionaryBusy.acquire()!;
		const task = this.beginBodyTask(change === "level" ? BODY_LEVEL_UPDATING_MESSAGE : "Applying automatic parts of speech…", false);
		const beforeSelection = this.selection, selectionEpoch = this.selectionEpoch;
		// The selection is put back only if nothing dropped it on purpose while this change waited.
		const restorable = () => this.selectionEpoch === selectionEpoch;
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
						if (beforeSelection?.owner === body && restorable()) {
							const mapped = staged.mapSelection(beforeSelection.snapshot.start, beforeSelection.snapshot.end);
							this.selection = mapped ? { ...beforeSelection, slot: beforeSelection.slot ? body.getDisplaySlot(beforeSelection.slot.tokenId) : null,
								snapshot: { ...beforeSelection.snapshot, ...mapped, displayRevision: body.getDisplayRevision() } } : null;
						}
					},
					rollback: () => { session.rollback(); staged.rollback(); if (!this.lifecycle.closed && this.targetBody === body && restorable()) this.selection = beforeSelection; },
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

	/** The Vocabulary applied with no note, to be put aside by an Open; null when there is none. */
	private stashStandalone(): StashedStandalone | null {
		const vocabulary = this.standaloneVocabulary;
		return vocabulary === null ? null : { vocabulary, selection: this.vocabularySelection, draft: this.vocabularyDraft, stale: new Map(this.staleSources) };
	}
	/** Puts back what an Open put aside (an Open that has been taken over, or a View that has closed, never gets here: it is no longer current). */
	private restoreStandalone(stash: StashedStandalone | null): void {
		if (stash === null) return;
		this.stashedStandalone = null;
		this.standaloneVocabulary = stash.vocabulary;
		this.vocabularySelection = stash.selection; this.vocabularyDraft = stash.draft;
		// A Source that changed while the note was being read is stale, whichever way the Open ended.
		for (const [path, reason] of stash.stale) if (this.staleSources.get(path) !== "missing") this.staleSources.set(path, reason);
	}

	/** `selection` is the one a reopened note's body was built from, so what the View shows is what was drawn. */
	private resetVocabulary(selection: VocabularySelection = this.initialSelection()): void {
		this.stashedStandalone = null;
		this.standaloneVocabulary = null;
		this.vocabularyDraft = this.vocabularySelection = selection;
		this.staleSources.clear(); this.targetVocabularyChanged = false; this.vocabularyError = null;
	}
	getVocabularyState() {
		return { selection: this.vocabularySelection, draft: this.vocabularyDraft, snapshot: this.targetBody.getVocabularySnapshot() ?? this.standaloneVocabulary?.snapshot ?? null,
			stale: this.staleSources.size > 0, staleSources: Array.from(this.staleSources, ([path, reason]) => ({ path, reason })), preparing: this.vocabularyTask !== null,
			progress: this.sourceProgress, error: this.vocabularyError, ready: !this.lifecycle.closed && this.session.getState().status !== "loading" &&
				(this.session.getState().status === "ready" || this.vocabularyDraft.mode === "selected"),
			applied: !this.lifecycle.closed && (this.session.getState().status === "ready" || this.standaloneVocabulary !== null),
			// WORKBENCH-UI5 (owner, 2026-10-08): the applied Vocabulary's notes, which the summary names.
			sources: this.appliedSourcePaths(),
			// The Vault's listing, for the marks of its list; read only when that list is opened.
			listedPaths: (): readonly string[] | null => this.host.listVocabularyNotes ? this.host.listVocabularyNotes() : null };
	}
	/**
	 * The Vault paths of the applied Vocabulary's Sources, in path order: the committed Selected Notes, or the Current Note when
	 * a note is open. It is the committed selection, not the Snapshot, so an Open that is still preparing its own body cannot
	 * make a Vocabulary applied with no note read as the note's. The committed selection keeps its paths as the picker gave them;
	 * `vocabularyPaths()` is what `prepareVocabulary()` and so the Snapshot's Sources are made with (normalized, once each, sorted).
	 */
	private appliedSourcePaths(): readonly string[] {
		if (this.vocabularySelection.mode === "selected") return vocabularyPaths(this.vocabularySelection.paths);
		const state = this.session.getState();
		return state.status === "ready" ? [state.snapshot.sourcePath] : [];
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
			// WORKBENCH-UI5 (review 1, P3 6): with no note and nothing applied there is no Current Note to start from.
			initial: () => this.session.getState().status !== "ready" && this.standaloneVocabulary === null
				? { ...this.vocabularySelection, mode: "selected" as const, paths: [] } : this.vocabularySelection,
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
		// The Vocabulary an Open put aside is not the active one, but it is the one that comes back if the Open fails.
		const aside = this.stashedStandalone;
		if (aside?.vocabulary.snapshot.sources.some(source => source.path === path) && aside.stale.get(path) !== "missing") aside.stale.set(path, reason);
		if (path === this.getSourcePath() || active?.sources.some(source => source.path === path)) {
			this.cancelAutomaticPos(); this.automaticController?.markStale(); this.targetBody.invalidateAutomatic("source-changed"); this.automaticToolbar?.sync();
		}
		if (this.vocabularyTask && (this.vocabularyTask.paths.includes(path) || path === this.getSourcePath())) this.cancelVocabularyPreparation();
		this.dictionaryPopover?.validate(); this.syncDictionaryDiagnostics();
		this.syncVocabularyChrome(); this.syncTokenAffordance(); this.syncRecomposeAffordance();
		this.collisionSession?.sourceChanged(path);
		this.fakeProverbSession?.sourceChanged(path);
		// WORKBENCH-UI5 (review 1, P3 2): Generate new in the Recompose pane waits for a fresh Vocabulary, as the dialogs do.
		this.recomposeScreen?.sync();
		// WORKBENCH-UI1: a moved Target stops Generate now, not at the next status change.
		// WORKBENCH-UI5 (review 1, P3 1): on a host with tabs the status line also says at once that a Vocabulary Source moved.
		if (this.ungenerated() || this.tabbed()) { this.toolbar?.sync(); this.shuffleBar?.sync(); this.syncLoadControl(); }
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
		const token = this.lifecycle.busy.acquire(); if (token === null || this.dictionaryBusy.isBusy() || this.pendingDefineId !== null || this.definitionModal?.isShowing()) { if (token !== null) this.lifecycle.busy.release(token); return "busy"; }
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

	/** WORKBENCH-UI1: whether this host opens a note without a Shuffle. */
	private defersShuffle(): boolean {
		return this.host.deferInitialShuffle === true;
	}

	/** WORKBENCH-UI2: whether this host splits the body area into tabs; never without the Recompose entry. */
	private tabbed(): boolean {
		return this.host.workbenchTabs === true && this.host.recomposeDialog !== false;
	}

	/**
	 * WORKBENCH-UI2: the Recompose pane is on screen, so the Shuffle body is
	 * hidden. While it is, nothing reads or acts on a selection in that body.
	 */
	private recomposeShown(): boolean {
		return this.activeTab === "recompose" && !!this.recomposePane;
	}

	/** WORKBENCH-UI2: the tab row before the scrolling box, and the Recompose pane beside the Shuffle one. */
	private buildTabs(root: HTMLElement, scroll: HTMLElement, shuffle: HTMLElement): void {
		const recompose = scroll.createDiv({ cls: "semantropy-pane semantropy-recompose-pane" });
		recompose.hidden = true;
		this.shufflePane = shuffle; this.recomposePane = recompose;
		this.recomposeSession ??= new RecomposeSession(this.recomposeHost());
		this.recomposeScreen = new RecomposePane(recompose, this.recomposeSession);
		this.tabRow = new WorkbenchTabs(root, scroll, { shuffle, recompose }, this.viewId, this.shellLabels, (tab, focus) => this.showTab(tab, focus));
		this.tabRow.sync(this.activeTab);
		// WORKBENCH-UI5: under the tab row, outside the scrolling box, so it does not scroll with the body.
		this.shuffleBar = new ShuffleBar(root, scroll, {
			model: () => this.viewModel(),
			status: () => this.statusModel(),
			target: () => {
				const state = this.session.getState();
				return state.status === "ready" ? { name: state.snapshot.sourceName, pending: false } : { name: null, pending: state.status === "loading" };
			},
			manual: () => { const slot = this.selectedManualSlot(); return { count: this.targetBody.getManualOverrideCount(), diagnostic: slot?.manualDiagnostic ?? null }; },
			generate: () => this.ungenerated(),
			...(this.host.chooseTarget ? { chooseTarget: () => { void this.chooseTarget(); } } : {}),
			reshuffle: () => { void this.reshuffle(); },
			refreshTarget: () => { void this.refreshSource(); },
			copy: () => { void this.copySelectedFragment(); },
			collect: () => { void this.collectSelectedFragment(); },
		});
		this.shuffleBar.setShown(this.activeTab === "shuffle");
	}

	/**
	 * WORKBENCH-UI2: shows one pane and hides the other. The scrolling box stays
	 * the one scroll for both, so each tab's position is kept when it is left and
	 * put back when it is shown again. Leaving Shuffle drops its selection, its
	 * word menu and its definition: a hidden body offers nothing to act on.
	 */
	private showTab(tab: WorkbenchTab, focus = false): void {
		const scroll = this.scrollEl, row = this.tabRow, shuffle = this.shufflePane, recompose = this.recomposePane;
		if (this.lifecycle.closed || !scroll || !row || !shuffle || !recompose) return;
		if (tab !== this.activeTab) {
			const leaving = this.activeTab === "shuffle" ? shuffle : recompose;
			const doc = this.contentEl.ownerDocument;
			this.tabScroll[this.activeTab] = { top: scroll.scrollTop, left: scroll.scrollLeft };
			if (this.activeTab === "shuffle") this.leaveShuffle(shuffle);
			// A Popover on a word of the Recompose text goes with the tab, as the Shuffle side's does.
			else this.dictionaryPopover?.close();
			// Focus inside the pane going away (or the area that goes with the Shuffle pane) moves to the tab that replaced it.
			if (leaving.contains(doc.activeElement) || (this.activeTab === "shuffle" && this.shuffleBar?.el.contains(doc.activeElement))) focus = true;
			this.activeTab = tab;
			shuffle.hidden = tab !== "shuffle";
			recompose.hidden = tab !== "recompose";
			// The area is shown (or hidden) BEFORE the scroll position is put back: the box is shorter by the area's height
			// with it, and a position set while the area was still hidden is cut to the taller box's range (review 2, P3 1).
			this.shuffleBar?.setShown(tab === "shuffle");
			const saved = this.tabScroll[tab];
			scroll.scrollTop = saved.top; scroll.scrollLeft = saved.left;
			row.sync(tab);
			this.updateChrome();
		}
		if (focus) row.focus(tab);
	}

	private leaveShuffle(pane: HTMLElement): void {
		this.closeManualMenu(); this.dictionaryPopover?.close();
		this.selection = null; this.selectionEpoch += 1; this.selectionGesture = false;
		const selection = this.contentEl.ownerDocument.getSelection();
		if (!selection) return;
		for (let index = 0; index < selection.rangeCount; index++) {
			if (selection.getRangeAt(index).intersectsNode(pane)) { selection.removeAllRanges(); return; }
		}
	}

	/**
	 * WORKBENCH-UI1: ready, opened without a Shuffle and not generated since —
	 * the body has Chunks to show and shows none. It is read from the body owner,
	 * never stored: the session states stay the four they were.
	 */
	private ungenerated(): boolean {
		return this.defersShuffle() && this.session.getState().status === "ready" && this.targetBody.awaitsFirstChunk();
	}

	/**
	 * WORKBENCH-UI3: the notice for a Reshuffle text command that returned
	 * `unavailable`. A body not generated whose Generate waits for Refresh target
	 * says so; every other case keeps the existing sentence.
	 */
	reshuffleUnavailableMessage(): string {
		return this.ungenerated() && this.generateBlocked() ? REFRESH_TO_GENERATE_MESSAGE : RESHUFFLE_UNAVAILABLE_MESSAGE;
	}

	/**
	 * WORKBENCH-UI1: Generate would show the snapshot taken at open. Once the
	 * Target has moved on from it, Generate waits for Refresh target.
	 */
	private generateBlocked(): boolean {
		const state = this.session.getState();
		return state.status !== "ready" || state.freshness !== "fresh" || this.targetVocabularyChanged;
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
		// WORKBENCH-UI5 (review 1, P3 5): with no note there is no body to act on. That is "unavailable" — the command says so in a
		// Notice; "aborted", which the abandoned-work check below would give, is silent — and the tab stays where it is.
		if (this.tabbed() && this.session.getState().status !== "ready") return "unavailable";
		// WORKBENCH-UI2: Reshuffle text acts on the Shuffle body, so that is the tab it shows.
		this.showTab("shuffle");
		// WORKBENCH-UI1: the first Shuffle of a body opened without one is Generate.
		if (this.ungenerated()) return await this.generateBody();

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
		// WORKBENCH-UI2: Refresh target rebuilds the Shuffle body, so that is the tab it shows (WORKBENCH-UI5: when there is one).
		if (this.session.getState().status === "ready") this.showTab("shuffle");
		if (this.host.waitForPendingSettings && this.pendingLevelSave) {
			const snapshot = this.session.getReadySnapshot(), owner = this.targetBody;
			await this.pendingLevelChange;
			if (this.lifecycle.closed || this.session.getReadySnapshot() !== snapshot || this.targetBody !== owner) return "aborted";
		}

		this.cancelBodyTask();
		// WORKBENCH-UI1: Refresh keeps what the body was. A generated body comes back
		// with its first Chunk, and one not generated yet stays that way.
		const ungenerated = this.ungenerated();
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
				const result = await this.prepareSnapshotBody(requestId, snapshot, bodySeed, bodySemantropy, staged, current, ungenerated);
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
		// WORKBENCH-UI1: with no Chunk shown yet the next section is the first one, under Generate's rule.
		if (this.ungenerated()) return await this.generateBody();
		return await this.loadSection("Loading next section…", false, "Could not load the next section. Try again.");
	}

	/**
	 * WORKBENCH-UI1: the first Shuffle of a body opened without one — from the
	 * empty body's Generate, Reshuffle text or its command. It is Load next for
	 * the first descriptor: the open's Vocabulary owner and Seed, at the level the
	 * body has now, with nothing re-read or re-analyzed and no other draw. A
	 * Target that moved since its snapshot waits for Refresh target.
	 */
	async generateBody(): Promise<"applied" | "busy" | "unavailable" | "aborted" | "failed"> {
		if (this.lifecycle.closed) return "aborted";
		if (!this.ungenerated() || this.generateBlocked()) return "unavailable";
		return await this.loadSection(EN_MESSAGES.view.generatingText, true, EN_MESSAGES.view.generateFailed);
	}

	private async loadSection(message: string, prominent: boolean, failure: string): Promise<"applied" | "busy" | "unavailable" | "aborted" | "failed"> {
		if (this.lifecycle.closed) return "aborted";
		const state = this.session.getState();
		if (state.status !== "ready" || !this.targetBody.hasNext()) return "unavailable";
		const token = this.lifecycle.busy.acquire();
		if (token === null) return "busy";
		const body = this.targetBody, scheduler = this.scheduler();
		const task = this.beginBodyTask(message, true, prominent);
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
			this.lifecycle.reshuffleNotice = failure;
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
		// WORKBENCH-UI2: the hidden Shuffle body is never what a Copy reads.
		const selected = this.recomposeShown() ? { status: "empty" as const } : this.resolveActionSelection(deps.selection);
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
		const selected = this.recomposeShown() ? { status: "empty" as const } : this.resolveActionSelection(deps.selection);
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
		if (selected.status !== "selected" || this.recomposeShown()) {
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
  const noBody = this.dictionaryWorld.getCurrent()?.snapshot === null && this.session.getState().status !== "ready";
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
   // FAKE-DICT-RECOMPOSE1: the definition of a word of a Recompose sentence, with no note open, has no body whose markers
   // follow the level; with a note open the body is made again as it always was.
   prepareDisplay: noBody ? undefined : async () => {
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

	/**
	 * WORKBENCH-UI5 (decision 17): the reader chooses a Vault note as the target. The host shows its own
	 * chooser; the note comes back captured as the Open command captures one, and opens by the same rules
	 * as that command (it starts not generated, the Vocabulary resets, and the note is watched for change).
	 * Nothing is read until a note is chosen.
	 */
	async chooseTarget(): Promise<"opened" | "cancelled" | "unavailable" | "busy" | "aborted"> {
		const choose = this.host.chooseTarget;
		if (this.lifecycle.closed) return "aborted";
		if (!choose) return "unavailable";
		if (this.chooser) return "busy";
		const request = new AbortController();
		this.chooser = request;
		this.toolbar?.closePopups(); this.dictionaryPopover?.close(); this.closeManualMenu();
		let choice: TargetChoice | null;
		try { choice = await choose(request.signal); } catch { choice = null; } finally { if (this.chooser === request) this.chooser = null; }
		// A chooser the View closed (it closed, or opened again) reports nothing, whatever the host answers late.
		if (this.lifecycle.closed || request.signal.aborted) return "aborted";
		if (!choice) return "cancelled";
		await this.openCapture(choice.capture, { readCached: choice.readCached, capturedSourceChanged: choice.capturedSourceChanged });
		// The Open of the first note builds the shell again, and the button the reader pressed went with it: focus goes to its successor.
		const doc = this.contentEl.ownerDocument;
		if (!this.lifecycle.closed && (!doc.activeElement || doc.activeElement === doc.body)) this.shuffleBar?.chooseButton()?.focus({ preventScroll: true });
		return "opened";
	}

	/** The host's chooser, if open, is told to close (the View closes or opens again): nothing it answers later is used. */
	private closeChooser(): void {
		const request = this.chooser;
		this.chooser = null;
		request?.abort();
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
		// WORKBENCH-UI5 (review 1, P3 7): a View that has been closed builds no shell, session or pane for an Open that arrives late.
		if (this.lifecycle.closed) return;
		// WORKBENCH-UI5: an Open with no note to take (run from the Semantropy pane itself, or from a view that is not
		// a Markdown note) only brings this View forward: it keeps the target, the body, the Vocabulary and the
		// Recompose text it has. With no note and no Vocabulary yet there is nothing to keep, and it is as it was.
		// Only on a host with tabs (review 2, P3 2): the web page never sends one, and its View keeps the rule it had.
		if (this.tabbed() && capture.kind === "none" && (this.session.getState().status !== "empty" || this.standaloneVocabulary !== null)) {
			// Nothing else would tell the reader why the command did nothing (review 2, P3 11).
			this.notify(OPEN_KEPT_MESSAGE);
			return;
		}
  if (this.session.getState().status === "ready" && this.targetBody.isDisplayIntact() && capture.kind === "markdown") {
   return this.replaceOpen(capture, deps);
  }
		// A Vocabulary applied from Selected Notes with no note belongs to no note, so an Open that fails leaves it as it was
		// (review 2, P3 3). The note's body is made from the note's own, new selection (review 3, P3 1: from the old one it took the weights and
		// the draw mode of Selected Notes), so the old one is put aside here and put back by a read or an analysis that fails.
		const stash = this.stashedStandalone ?? (this.tabbed() && capture.kind === "markdown" ? this.stashStandalone() : null);
		this.cancelVocabularyPreparation();
		this.resetVocabulary();
		this.stashedStandalone = stash;
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
			this.restoreStandalone(stash);
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
			this.restoreStandalone(stash);
			this.renderShell();
			return;
		}

		this.stashedStandalone = null;
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
  // WORKBENCH-UI2: an Open is about the Target, so it shows Shuffle, like a fresh shell does.
  this.showTab("shuffle");
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
   // REOPEN-VOCABULARY-OPTIONS1: the note's Vocabulary is built from the note's own selection (Current Note, the stored draw mode, no
   // weights) and with the enclosed-term delimiters, as a first Open builds it. The same selection is what the View shows afterwards.
   const selection = this.initialSelection();
   // WORKBENCH-UI1: an Open, even of another note, comes back not generated on a host that defers the Shuffle.
   const result = await staged.open({ snapshot: captured.snapshot, bodySeed: captured.bodySeed, bodySemantropy: this.host.getBodySemantropy(), automaticPos: this.host.getAutomaticPos?.(),
    drawMode: selection.drawMode, sourceWeights: selectionSourceWeights(selection), enclosedTerms: this.enclosedTerms(),
    dictionarySemantropy: this.dictionaryLevel(), markerVisibility: this.markerVisibility(), targetSize: this.host.targetChunkSize,
    targetRevision: request, getTokenizer: () => this.host.getTokenizer(), scheduler, isCurrent: current, ownerDocument: container.ownerDocument,
    ...(this.defersShuffle() ? { deferFirstChunk: true } : {}) });
   if (!current()) return;
   if (result.status !== "applied") { if (result.status !== "stale") this.lifecycle.reshuffleNotice = TARGET_RENDER_ERROR_MESSAGE; return; }
   const dom = targetDomTransaction(container, [staged.getContainer()!]);
   try { published = this.session.completeReady(request, captured.snapshot, captured.bodySeed, result.analysis, dom.publish); }
   finally { if (!published) dom.rollback(); }
   if (!published) return;
   this.targetBody = staged; this.resetVocabulary(selection); old.release(); this.dismissDefinition();
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
		/** WORKBENCH-UI1: an Open defers on a host that asks for it; a Refresh keeps what the body was. */
		deferFirstChunk = this.defersShuffle(),
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
			...(deferFirstChunk ? { deferFirstChunk: true } : {}),
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
		this.unbindGenerate?.();
		this.unbindGenerate = null;
	}

	private viewModel() {
		const ungenerated = this.ungenerated();
		return toSemantropyViewModel(this.session.getState(), {
			busy: this.lifecycle.busy.isBusy(),
			transforming: this.bodyTask?.cancellable === true,
			...(ungenerated ? { ungenerated, generateBlocked: this.generateBlocked() } : {}),
		});
	}

	/** The effective display settings; a host without them uses the defaults. */
	private displaySettings(): SemantropyDisplaySettings {
		return this.host.getDisplaySettings?.() ?? defaultSemantropyDisplaySettings();
	}

	private statusModel(): ToolbarStatusModel {
		const vocabulary = this.getVocabularyState(), ungenerated = this.ungenerated();
		return toToolbarStatusModel({
			sessionStatus: this.session.getState().status,
			...(ungenerated ? { ungenerated, generateBlocked: this.generateBlocked() } : {}),
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
			// WORKBENCH-UI5: with tabs the body's state is in the Shuffle area; the Toolbar says what every tab needs.
			status: () => this.tabbed() ? toolbarStatusWithoutBody(this.statusModel()) : this.statusModel(),
			display: () => this.displaySettings(),
			alert: () => this.markerApplyError,
			// One resolution of the exact one-token selection feeds both the
			// controls and the diagnostic sentence, so they cannot disagree. The
			// diagnostic is the one this plan already computed for that slot: no
			// Source read, tokenize, Snapshot scan or surface search happens here.
			manual: () => { const slot = this.selectedManualSlot(); return { selected: !!slot?.manualEligible,
				selectedShuffleable: slot?.manualDiagnostic.status === "available",
				selectedOverridden: !!slot && this.targetBody.hasManualOverride(slot),
				count: this.targetBody.getManualOverrideCount(), diagnostic: slot?.manualDiagnostic ?? null,
				// WORKBENCH-UI2 review 1: the hidden Shuffle body's changes are not cleared from the Recompose tab.
				clearable: !this.recomposeShown() }; },
			// WORKBENCH-UI5 (review 2, P3 5): with tabs the sentence about the selected word stands in the Shuffle area.
			...(this.tabbed() ? { manualDiagnosticId: () => this.shuffleBar?.diagnosticId ?? null } : {}),
			vocabularyHost: (entry, summary, adopt) => {
				// WORKBENCH-UI4: with tabs the Vocabulary can be chosen without a note, for Recompose and the phrase generators.
				if (!ready && !this.tabbed()) return;
				this.vocabularyControls = new VocabularyControls(entry, summary, {
					state: () => this.getVocabularyState(),
					open: () => this.openVocabularyPicker(),
					// WORKBENCH-UI5 (owner, 2026-10-08): a host with tabs names the notes in the summary; the web page's line stays as it was.
					...(this.tabbed() ? { names: { adopt } } : {}),
				});
			},
			// WORKBENCH-UI3: only a host with either flag tells the Toolbar what the body area shows.
			...(this.defersShuffle() || this.tabbed() ? { workbench: () => ({
				generate: this.ungenerated(), tabbed: this.tabbed(),
				recomposeShown: this.recomposeShown() }) } : {}),
			reshuffle: () => { void this.reshuffle(); },
			refreshTarget: () => { void this.refreshSource(); },
			copy: () => { void this.copySelectedFragment(); },
			collect: () => { void this.collectSelectedFragment(); },
			collision: () => this.openCollision(),
			fakeProverb: () => this.openFakeProverb(),
			...(this.tabbed() ? { fakeDictionary: () => this.openDictionaryHelp() } : {}),
			fakeAlert: () => this.openFakeAlert(),
			cancelVocabulary: () => { this.cancelVocabulary(); },
			setBodySemantropy: (value) => { this.onLevelSelected(value); },
			setDisplay: (patch) => { void this.changeDisplaySettings(patch); },
			resetDisplay: () => { void this.resetDisplaySettings(); },
			shuffleSelected: () => { this.runManual("shuffle", this.selectedManualSlot()); },
			restoreSelected: () => { this.runManual("restore", this.selectedManualSlot()); },
			useAutomaticSelected: () => { this.runManual("automatic", this.selectedManualSlot()); },
			clearManual: () => { if (!this.recomposeShown() && this.targetBody.clearManual() === "applied") { this.afterManualChange(); } },
		});
		this.mountAutomatic(this.toolbar.automaticHost);
		// WORKBENCH-UI5: a host with tabs shows this in the Fake Dictionary dialog instead (the Toolbar's button).
		if (!this.tabbed()) {
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
		}
  this.scrollEl = root.createDiv({ cls: "semantropy-scroll" });
  // Visual only: the status line above already announces the same state.
  this.busyEl = root.createDiv({ cls: "semantropy-busy", attr: { "aria-hidden": "true" } });
  this.busyEl.hidden = true;
  const busyCard = this.busyEl.createDiv({ cls: "semantropy-busy-card" });
  busyCard.createDiv({ cls: "semantropy-busy-spinner" });
  this.busyTextEl = busyCard.createDiv({ cls: "semantropy-busy-text" });
  this.busyDetailEl = busyCard.createDiv({ cls: "semantropy-busy-detail" });
		this.activeTab = "shuffle";
		this.tabScroll = { shuffle: { top: 0, left: 0 }, recompose: { top: 0, left: 0 } };
		// WORKBENCH-UI2: on a host with tabs the Shuffle side moves into its pane; every
		// other host builds it straight into the scrolling box, as before.
		const pane = this.tabbed() ? this.scrollEl.createDiv({ cls: "semantropy-pane semantropy-shuffle-pane" }) : this.scrollEl;
		if (ready) {
			// WORKBENCH-UI1: Generate stands where the body was not shuffled at open. Built only
			// on a host that defers the Shuffle, so every other host's shell is unchanged.
			if (this.defersShuffle()) {
				this.generateEl = pane.createDiv({ cls: "semantropy-generate" });
				this.generateButton = this.generateEl.createEl("button", {
					cls: "semantropy-action mod-cta semantropy-generate-button",
					attr: { type: "button" },
				});
				this.shellLabels.text(this.generateButton, () => ui().common.generate);
				this.unbindGenerate = bindExclusiveClick(this.unbindGenerate, this.generateButton, () => {
					void this.generateFromButton();
				});
			}
			this.bodyEl = pane.createDiv({ cls: SEMANTROPY_BODY_CLASS });
			this.loadButton = pane.createEl("button", {
				cls: "semantropy-action semantropy-load-next",
				attr: { type: "button" },
			});
			this.shellLabels.text(this.loadButton, () => ui().view.loadNext);
			this.unbindLoad = bindExclusiveClick(this.unbindLoad, this.loadButton, () => {
				void this.loadNextSection();
			});
			this.syncLoadControl();
			if (pane !== this.scrollEl) this.buildTabs(root, this.scrollEl, pane);
			this.bindBodySelection();
			this.bindManualActions();
   this.bindDictionaryPopover(root);
		} else if (this.tabbed()) {
			// WORKBENCH-UI4: the tabs stand without a note too. With no note the Shuffle tab says so, in the
			// sentence the status line uses; while a note is being read, or when it could not be, it stays empty
			// (the status line says why) and Recompose is the tab that can be used.
			if (this.session.getState().status === "empty") {
				this.shellLabels.text(pane.createDiv({ cls: "semantropy-shuffle-empty" }), () => localize(this.viewModel().message ?? ""));
			}
			this.buildTabs(root, this.scrollEl, pane);
			// FAKE-DICT-RECOMPOSE1: the Recompose text can be looked up with no note too, so the Popover is bound to it alone.
			this.bindDictionaryPopover(root);
		}
		this.applyBodyDisplayStyles();
		this.syncTokenAffordance();
		this.syncRecomposeAffordance();
		// An Open draws the shell and then waits for analysis without another chrome pass.
		this.syncBusyOverlay();
		// The Fake Dictionary dialog, if open, is bound to the sentence the diagnostics write: it follows the shell's new state
		// at once (a note being read is not "no Vocabulary chosen"). The availability row of a host without tabs is not touched here.
		if (this.dictionaryHelpModal) this.syncDictionaryDiagnostics();
	}

	/**
	 * Applies the display settings to the body alone (WORKBENCH-UI3: and the
	 * body's font and size to the Recompose pane's text).
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
		const stack = BODY_FONT_STACKS[display.bodyFontFamily];
		const size = display.bodyFontSizePx === null ? "" : `${display.bodyFontSizePx}px`;
		// WORKBENCH-UI3: the Recompose pane's text takes the body's font and size;
		// ruby and markers stay the Shuffle body's own.
		const recomposed = this.recomposeScreen?.outputElement();
		if (recomposed) {
			recomposed.style.setProperty("font-family", stack ?? "");
			recomposed.style.setProperty("font-size", size);
		}
		const body = this.bodyEl;
		if (!body) return;
		body.style.setProperty("font-family", stack ?? "");
		body.style.setProperty("font-size", size);
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
		this.dictionaryHelpModal?.sync();
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
		// WORKBENCH-UI5 (review 1, P3 1): with no note there is no body to be current; the Vocabulary being fresh again is what it waits for.
		// Only on a host with tabs: the web page's View keeps the rule it had (review 2, P3 2).
		const automaticCurrent = this.tabbed() && this.session.getState().status !== "ready" ? this.staleSources.size === 0 : this.targetBody.isAutomaticCurrent();
		if (!this.lifecycle.closed && this.automaticController?.read().status === "stale" && automaticCurrent && this.toolbar)
			this.mountAutomatic(this.toolbar.automaticHost);
		this.automaticToolbar?.setBlocked(this.lifecycle.busy.isBusy());
		this.collisionModal?.sync();
		this.fakeProverbModal?.sync();
		this.recomposeScreen?.sync();
  this.dictionaryPopover?.validate(); this.syncDictionaryDiagnostics();
		if (this.manualMenu && this.manualMenuRevision !== this.targetBody.getDisplayRevision()) this.closeManualMenu();
		this.syncVocabularyChrome();
		this.toolbar?.sync();
		this.shuffleBar?.sync();
		this.syncLoadControl();
		this.syncTokenAffordance();
		this.syncRecomposeAffordance();
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
		this.syncGenerateControl();
		if (!this.loadButton) return;
		// WORKBENCH-UI1: before the first Chunk, Generate is the way on, not Load next.
		const ungenerated = this.ungenerated();
		this.loadButton.hidden = !this.targetBody.hasNext() || ungenerated;
		this.loadButton.disabled = this.lifecycle.closed || this.lifecycle.busy.isBusy() || !this.targetBody.hasNext() || ungenerated;
	}

	/** WORKBENCH-UI1: Generate shows only while nothing is generated, and waits while busy or until Refresh. */
	private syncGenerateControl(): void {
		if (!this.generateEl || !this.generateButton) return;
		const ungenerated = this.ungenerated();
		this.generateEl.hidden = !ungenerated;
		this.generateButton.disabled = !ungenerated || this.lifecycle.closed || this.lifecycle.busy.isBusy() || this.generateBlocked();
	}

	/**
	 * The empty body's Generate. Its button leaves with the first Chunk, so
	 * keyboard focus that was on it moves to Reshuffle text, not to the page.
	 */
	private async generateFromButton(): Promise<void> {
		const button = this.generateButton, doc = this.contentEl.ownerDocument;
		if (await this.generateBody() !== "applied" || this.lifecycle.closed || !button) return;
		const active = doc.activeElement;
		if (active !== null && active !== button && active !== doc.body) return;
		this.toolbar?.returnTarget(this.contentEl.querySelector<HTMLElement>(".semantropy-reshuffle"))?.focus();
	}

	private syncActionControls(): void {
		this.syncLoadControl();
		this.syncTokenAffordance();
		this.toolbar?.sync();
		this.shuffleBar?.sync();
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
		// WORKBENCH-UI2: a selection change while the Shuffle body is hidden records nothing.
		if (this.lifecycle.closed || this.recomposeShown()) return;
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
		this.toolbar?.sync(); this.shuffleBar?.sync(); this.syncDictionaryDiagnostics();
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
		if (this.recomposeShown()) return null;
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
		if (!slot || this.lifecycle.busy.isBusy() || this.recomposeShown()) { this.closeManualMenu(); return; }
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
		if (this.definitionModal && this.definitionModal.isShowing()) {
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
  return !!this.definitionModal?.isShowing() || !!this.dictionaryPopover?.isOpen();
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
  // FAKE-DICT-RECOMPOSE1: a word of a Recompose sentence is looked up the same way, for a Vocabulary instead of a Target.
  if (this.recomposeScreen?.outputElement().contains(element)) return this.recomposeHoverTarget(element);
  const anchor = element.closest<HTMLElement>(".semantropy-token");
  if (!anchor || !this.bodyEl?.contains(anchor)) return null;
  const owner = this.targetBody, slot = owner.getSlotForElement(anchor), snapshot = owner.getVocabularySnapshot();
  if (!slot?.dictionaryAvailable || slot.dictionary.outcome !== "accepted" || !snapshot) return null;
  const world = this.dictionaryWorld, revision = owner.getDisplayRevision(), generation = owner.getBodyGeneration();
  const level = this.dictionaryLevel();
  return { slot, surface: slot.displaySurface, identified: slot.dictionary, noTarget: false, anchor, isCurrent: () => {
   return this.dictionaryLive() && !this.recomposeShown() && this.targetBody === owner && this.dictionaryWorld === world &&
    owner.getBodyGeneration() === generation && owner.getDisplayRevision() === revision && owner.getVocabularySnapshot() === snapshot &&
    owner.getSlotForElement(anchor) === slot && this.dictionaryLevel() === level;
  } };
 }
 /**
  * FAKE-DICT-RECOMPOSE1: a word of the Recompose text. It is current while the tab is shown, the text's Vocabulary is the active
  * one and ready (the session's `lookup`), the View is not preparing a Vocabulary, and the word is still where it was. The
  * dictionary level is not part of it: changing the level from this Popover must not close it.
  */
 private recomposeHoverTarget(element: Element): DictionaryHoverTarget | null {
  const pane = this.recomposeScreen, found = pane?.wordAt(element);
  if (!pane || !found || !this.recomposeLookupLive()) return null;
  const { word, anchor } = found, world = this.dictionaryWorld;
  return { slot: word, surface: word.headword.surface, identified: { outcome: "accepted", headword: word.headword }, noTarget: true, anchor,
   isCurrent: () => this.recomposeLookupLive() && this.dictionaryWorld === world && anchor.isConnected && this.recomposeScreen?.wordAt(anchor)?.word === word };
 }
 /** The View-wide half of a lookup in a Recompose sentence: the tab is shown, its text can be looked up, and no Vocabulary is being prepared. */
 private recomposeLookupLive(): boolean {
  return !this.lifecycle.closed && this.recomposeShown() && !this.vocabularyTask && (this.recomposeSession?.read().lookup ?? false);
 }
 /** Whether a lookup would act now, so the words carry their marker; the pointer is the sentence's own (a click chooses the branch point). */
 private syncRecomposeAffordance(): void {
  const output = this.recomposeScreen?.outputElement();
  if (!output) return;
  const marked = this.recomposeLookupLive() && !this.lifecycle.busy.isBusy() && !this.dictionaryBusy.isBusy() && this.displaySettings().showDictionaryMarkers;
  output.classList.toggle("is-dictionary-marked", marked);
 }
 private bindDictionaryPopover(root: HTMLElement): void {
  const recomposed = this.recomposeScreen?.outputElement();
  const bodies = [this.bodyEl, recomposed].filter((element): element is HTMLElement => !!element);
  if (bodies.length === 0 || !this.scrollEl) return;
  this.dictionaryPopover = new DictionaryPopoverController(root, bodies, recomposed ? [this.scrollEl, recomposed] : this.scrollEl, {
   wordSelector: ".semantropy-token,.semantropy-recompose-word",
   // A word of a Recompose sentence has no Target note to collect for.
   collectOffered: () => this.dictionaryPopover?.getTarget()?.noTarget !== true,
   modifier: () => this.displaySettings().dictionaryModifier,
   canStart: () => !this.lifecycle.closed && !this.lifecycle.busy.isBusy() && !this.dictionaryBusy.isBusy() && !this.vocabularyTask && !this.definitionModal?.isShowing() && !this.collisionModal && !this.fakeProverbModal && !this.fakeAlertModal,
   resolve: element => this.hoverTarget(element),
   begin: target => { this.closeManualMenu(); void this.defineHoverTarget(target); },
   closed: () => { this.pendingDefineId = null; this.definitionError = null; this.dictionaryWorld.invalidateDisplay(); },
   getModel: () => this.toDefinitionViewModel(),
   onCopy: () => { void this.copyDefinition(); }, onCollect: () => { void this.collectDefinition(); },
   onReshuffle: () => { this.reshuffleDefinition(); }, onSemantropyChange: value => { void this.setDictionarySemantropy(value); },
  });
 }
 /**
  * FAKE-DICT-RECOMPOSE1: the definition of a word of a Recompose sentence. The same steps as the Shuffle body's hover, for
  * the active Vocabulary alone: its pool comes from its Snapshot (made once), nothing is tokenized, no Target is read, and the
  * definition is committed with no Target. The cache is shared with the Shuffle side by the same key, but this side only reads
  * its result: it neither reads nor writes an entry's Target.
  */
 private async defineRecomposeWord(target: DictionaryHoverTarget): Promise<void> {
  const world = this.dictionaryWorld, owner = this.collisionVocabulary();
  if (!owner || !target.isCurrent()) return;
  // With a note open whose body was made from this very Snapshot, the body already holds this pool (the same function of the same
  // Snapshot): it is used as it is. Otherwise (no note, or a note whose Vocabulary is another) it is made once and kept under its Snapshot.
  const snapshot = owner.snapshot;
  const pool = (this.targetBody.getVocabularySnapshot() === snapshot ? this.targetBody.getDictionaryPool() : undefined) ?? this.recomposePools.poolOf(snapshot);
  const requestId = world.beginRequest();
  this.pendingDefineId = requestId; this.definitionError = null; this.dictionaryLevelError = null;
  const level = this.dictionaryLevel();
  try {
   const nonce = world.ensureSeed(issueUint32Seed);
   const current = () => target.isCurrent() && this.dictionaryPopover?.getTarget() === target && world.isCurrent(requestId) && world.getSeed() === nonce;
   const result = await runDefineSelectedWord({
    selection: target.surface, identified: target.identified, snapshot: null, tokenSequences: [], preparedPool: pool,
    dictionarySeed: nonce, dictionarySemantropy: level, getTokenizer: () => this.host.getTokenizer(),
    isCurrent: current, getSnapshotIdentity: () => null,
    generate: request => this.definitionCache.getForWorld(definitionCacheKey(request.headword, nonce, level, snapshot))?.result ?? generateFakeDefinition(request),
   });
   if (!current()) { this.dictionaryPopover?.validate(); return; }
   if (result.status === "ready") {
    world.commit(requestId, { headword: result.headword, pool, snapshot: null, vocabulary: collectVocabularyFromSnapshot(snapshot),
     dictionarySeed: result.result.outcome === "generated" ? result.result.dictionarySeed : nonce, dictionarySemantropy: level, result: result.result });
   } else if (result.status !== "stale") this.definitionError = DEFINE_GENERATION_ERROR_MESSAGE;
  } catch { if (target.isCurrent() && world.isCurrent(requestId)) this.definitionError = DEFINE_GENERATION_ERROR_MESSAGE; }
  if (world.isCurrent(requestId)) this.syncDefinitionModal();
 }
 private async defineHoverTarget(target: DictionaryHoverTarget): Promise<void> {
  if (target.noTarget) return this.defineRecomposeWord(target);
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
    selection: target.surface, identified: target.identified,
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
  // WORKBENCH-UI5: the Vocabulary in use, which with no note is the one applied from Selected Notes (it was the Target's only,
  // so a View without a note said "being prepared" for good). A host without tabs has no Vocabulary without a note.
  const snapshot = this.targetBody.getVocabularySnapshot() ?? this.standaloneVocabulary?.snapshot ?? null;
  if (snapshot !== this.diagnosticSnapshot) {
   this.diagnosticSnapshot = snapshot; this.diagnosticCounts = snapshot ? dictionaryDiagnostics(snapshot) : null;
  }
  const counts = this.diagnosticCounts;
  if (this.dictionaryDiagnosticEl) {
   const state = this.session.getState();
   const text = dictionaryDiagnosticMessage({ level: this.dictionaryLevel(), preparing: !!this.vocabularyTask,
    stale: !!this.staleSources.size || this.targetVocabularyChanged || (state.status === "ready" && state.freshness !== "fresh"), slot: this.selectedManualSlot(), counts,
    none: this.tabbed() && !snapshot && state.status !== "loading" });
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
		this.shuffleBar?.relabel();
		this.vocabularyModal?.relabel();
		this.definitionModal?.relabel();
		this.dictionaryPopover?.relabel();
		this.collisionModal?.relabel();
		this.fakeProverbModal?.relabel();
		this.recomposeScreen?.relabel();
		this.fakeAlertModal?.relabel();
		this.dictionaryHelpModal?.relabel();
		this.syncDictionaryDiagnostics();
	}

	private clearChromeRefs(): void {
  if (!this.dictionaryHelpModal) { this.dictionaryDiagnosticEl = null; this.dictionaryCountsEl = null; }
		this.loadButton = null;
		this.generateEl = null;
		this.generateButton = null;
		this.tabRow?.dispose(); this.tabRow = null;
		this.shuffleBar?.dispose(); this.shuffleBar = null;
		this.recomposeScreen?.dispose(); this.recomposeScreen = null;
		this.shufflePane = null;
		this.recomposePane = null;
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
