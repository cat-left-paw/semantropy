import { MarkdownView, Notice, Plugin, TFile, type Editor } from "obsidian";
import { SemantropySettingTab } from "./view/SemantropySettingTab";
import type { JapaneseTokenizer } from "./tokenizer/JapaneseTokenizer";
import { readCurrentSourceText } from "./application/currentSourceText";
import { dispatchSourceEvent } from "./application/dispatchSourceEvent";
import { SourceRevisionLog } from "./application/sourceRevisionLog";
import type { CollectFragmentInputV4 as CollectFragmentInput } from "./collect/v4/CollectedFragmentV4";
import {
	collectFragmentV4 as collectFragment,
	type CollectFragmentResultV4 as CollectFragmentResult,
} from "./collect/v4/CollectFragmentUseCaseV4";
import { COLLECT_MISSING_VIEW_MESSAGE } from "./collect/collectMessages";
import { MarkdownFragmentRepositoryV4 as MarkdownFragmentRepository } from "./collect/v4/FragmentRepositoryV4";
import {
	systemFragmentClock,
	webCryptoFragmentIdSource,
} from "./collect/fragmentIdentity";
import { createObsidianCollectionStorage } from "./collect/obsidianCollectionStorage";
import { COPY_MISSING_VIEW_MESSAGE } from "./copy/copyMessages";
import type { BodySemantropy } from "./settings/bodySemantropy";
import type { DictionarySemantropy } from "./settings/dictionarySemantropy";
import type { SemantropyDisplaySettings } from "./settings/displaySettings";
import { settingsOperationQueueFor } from "./settings/SemantropySettingsStore";
import { AutomaticPosSettingsStore } from "./settings/AutomaticPosSettingsStore";
import type { CollectAttributionKey } from "./settings/automaticPosSettings";
import { localCollectionDate } from "./collect/localCollectionDate";
import { AutomaticPosCoordinator } from "./application/AutomaticPosCoordinator";
import type { SourceCapture } from "./application/selectSourceText";
import {
	RESHUFFLE_ERROR_MESSAGE,
	RESHUFFLE_MISSING_VIEW_MESSAGE,
	RESHUFFLE_UNAVAILABLE_MESSAGE,
} from "./application/reshuffleNote";
import {
	DEFINE_MISSING_VIEW_MESSAGE,
} from "./application/fakeDictionaryMessages";
import {
	REFRESH_ERROR_MESSAGE,
	REFRESH_MISSING_VIEW_MESSAGE,
	REFRESH_UNAVAILABLE_MESSAGE,
} from "./application/refreshSource";
import { invokeSemantropyViewCommand } from "./application/selectSemantropyView";
import { invokeReshuffleCommand } from "./application/selectReshuffleView";
import {
	SEMANTROPY_VIEW_TYPE,
	SemantropyView,
} from "./view/SemantropyView";
import { EN_MESSAGES, ui } from "./i18n/catalog";
import { localize } from "./i18n/messages";
import { currentUiLanguage, setCurrentUiLanguage, type UiLanguage } from "./i18n/language";

/**
 * A tokenizer the plugin owns for its whole lifetime: lazily initialized on
 * the first tokenize request and released on unload.
 */
export type SemantropyTokenizerHost = JapaneseTokenizer & {
	isInitialized(): boolean;
	dispose(): void;
};

/**
 * Everything the plugin does apart from constructing its tokenizer. The
 * tokenizer is a build-time decision: the entry point subclasses this and
 * supplies exactly one implementation, so no runtime setting can select a
 * different analyzer or fall back to a simpler one.
 */
export abstract class SemantropyPlugin extends Plugin {
	private tokenizer: SemantropyTokenizerHost | null = null;
	/** Covers the window between capturing a body and a view watching it. */
	private readonly sourceRevisions = new SourceRevisionLog();
	private readonly settingsStore = new AutomaticPosSettingsStore({
		load: () => this.loadData() as Promise<unknown>,
		save: (data) => this.saveData(data),
	}, settingsOperationQueueFor(this.app));
	private readonly automaticCoordinator = new AutomaticPosCoordinator(this.settingsStore);
	/**
	 * One repository for the plugin's lifetime. Every view, button and
	 * command appends through this queue, so two explicit Collects cannot
	 * overwrite each other.
	 */
	private readonly fragmentRepository = new MarkdownFragmentRepository(
		createObsidianCollectionStorage(this.app.vault),
		() => this.settingsStore.getCollectionPath(),
		(created) => ({ ...this.settingsStore.getCollectAttribution(), uiLanguage: this.settingsStore.getUiLanguage(),
			localDate: localCollectionDate(created) }),
	);
	private readonly fragmentIdSource = webCryptoFragmentIdSource();
	private readonly fragmentClock = systemFragmentClock();
	private settingTab: SemantropySettingTab | null = null;
	/**
	 * The one ribbon button from the single `addRibbonIcon` call this load.
	 * Obsidian names that registration with the title and drops it on unload,
	 * so hiding the icon must reuse this element instead of registering again.
	 */
	private ribbonEl: HTMLElement | null = null;
	/** Where that one button returns when the setting is turned back on. */
	private ribbonParent: ParentNode | null = null;
	/** Only currently displayed fixed-message Notices need re-wording. */
	private readonly notices = new Map<Notice, string>();

	protected abstract createTokenizer(): SemantropyTokenizerHost;

	/**
	 * Views, commands and events are registered synchronously so nothing is
	 * missed; the stored settings are then read before Obsidian considers the
	 * plugin loaded.
	 */
	async onload(): Promise<void> {
		this.registerView(
			SEMANTROPY_VIEW_TYPE,
			(leaf) =>
				new SemantropyView(leaf, {
					automaticPosCoordinator: this.automaticCoordinator,
					getAutomaticPos: () => this.settingsStore.getSettings().automaticPos,
					getTokenizer: () => this.getTokenizer(),
					listVocabularyNotes: () => this.app.vault.getMarkdownFiles().map(file => file.path),
					isVocabularyViewActive: () => this.app.workspace.getActiveViewOfType(SemantropyView) === leaf.view,
					readCurrentText: (sourcePath) => this.readCurrentText(sourcePath),
					getBodySemantropy: () => this.settingsStore.getBodySemantropy(),
					setBodySemantropy: (value) => this.setBodySemantropy(value),
					waitForPendingSettings: () => this.settingsStore.whenSettled(),
					getDisplaySettings: () => this.settingsStore.getDisplaySettings(),
					setDisplaySettings: (patch) => this.setDisplaySettings(patch),
					getDictionarySemantropy: () =>
						this.settingsStore.getDictionarySemantropy(),
					setDictionarySemantropy: (value) =>
						this.setDictionarySemantropy(value, leaf.view),
					collectFragment: (input) => this.collectFragmentInput(input),
					writeClipboard: (text) => this.writeClipboard(text),
					showNotice: (message) => {
						this.notice(message);
					},
				}),
		);

		this.addCommand({
			id: "open",
			name: "Open",
			callback: () => {
				void this.openSemantropy();
			},
		});

		this.addCommand({
			// The id is part of the user's keymap; only the display name moved.
			id: "reshuffle",
			name: "Reshuffle text",
			callback: () => {
				void this.runReshuffleCommand();
			},
		});

		this.addCommand({
			// The id is part of the user's keymap; only the display name moved.
			id: "refresh-source",
			name: "Refresh target",
			callback: () => {
				void this.runRefreshSourceCommand();
			},
		});

		this.addCommand({
			id: "copy-selected-fragment",
			name: "Copy selected fragment",
			callback: () => {
				void this.runCopySelectedFragmentCommand();
			},
		});

		this.addCommand({
			id: "collect-selected-fragment",
			name: "Collect selected fragment",
			callback: () => {
				void this.runCollectSelectedFragmentCommand();
			},
		});

		this.addCommand({
			id: "define-selected-word",
			name: "Define selected word",
			callback: () => {
				void this.runDefineSelectedWordCommand();
			},
		});

		this.addCommand({
			id: "reshuffle-definition",
			name: "Reshuffle definition",
			callback: () => {
				this.runReshuffleDefinitionCommand();
			},
		});

		this.registerSourceEvents();

		await this.settingsStore.load();
		// The saved interface language, before the settings tab is built. A View
		// restored while the settings were loading is re-worded here too.
		this.applyUiLanguage(this.settingsStore.getUiLanguage());
		this.syncRibbon(this.settingsStore.getShowRibbonIcon());
		this.settingTab = new SemantropySettingTab(this.app, this, {
			getCollectionPath: () => this.getCollectionPath(),
			setCollectionPath: (value) => this.setCollectionPath(value),
			getUiLanguage: () => this.settingsStore.getUiLanguage(),
			setUiLanguage: (value) => this.setUiLanguage(value),
			getShowRibbonIcon: () => this.settingsStore.getShowRibbonIcon(),
			setShowRibbonIcon: (value) => this.setShowRibbonIcon(value),
			getCollectAttribution: () => this.settingsStore.getCollectAttribution(),
			setCollectAttribution: (key, value) => this.setCollectAttribution(key, value),
		});
		this.addSettingTab(this.settingTab);
	}

	/**
	 * LOCALE1: saves the interface language, then applies whatever the store
	 * now holds. A failed save leaves the stored — and so the shown — language
	 * unchanged; saves are queued, so the last one to complete is the one shown.
	 * Only fixed interface text changes: nothing is re-analyzed, regenerated,
	 * drawn or written to the Vault.
	 */
	private async setUiLanguage(value: UiLanguage): Promise<boolean> {
		const saved = await this.settingsStore.setUiLanguage(value);
		this.applyUiLanguage(this.settingsStore.getUiLanguage());
		return saved;
	}

	private applyUiLanguage(language: UiLanguage): void {
		if (language === currentUiLanguage()) return;
		setCurrentUiLanguage(language);
		for (const [notice, message] of this.notices) {
			if (!notice.containerEl.isConnected) { this.notices.delete(notice); continue; }
			notice.setMessage(localize(message));
		}
		for (const view of this.semantropyViews()) view.languageChanged();
		this.settingTab?.relabel();
		this.renameRibbon();
	}

	/**
	 * UI-POLISH1: saves the ribbon switch, then shows whatever the store holds.
	 * A failed save leaves the stored value, so the ribbon returns to it.
	 */
	private async setShowRibbonIcon(value: boolean): Promise<boolean> {
		const saved = await this.settingsStore.setShowRibbonIcon(value);
		this.syncRibbon(this.settingsStore.getShowRibbonIcon());
		return saved;
	}

	/** COLLECT-ATTRIBUTION1: a failed save leaves the stored item, so the toggle returns to it. */
	private setCollectAttribution(key: CollectAttributionKey, value: boolean): Promise<boolean> {
		return this.settingsStore.setCollectAttribution(key, value);
	}

	/**
	 * One Obsidian registration for this load. Off detaches that element so it
	 * is not shown, focused, or exposed to assistive tech. On puts the same
	 * element back. A second `addRibbonIcon` would keep the previous
	 * registration until unload, and a language change makes that a second icon.
	 */
	private syncRibbon(show: boolean): void {
		if (!show) { this.detachRibbon(); return; }
		if (!this.ribbonEl) {
			const el = this.addRibbonIcon("brain-circuit", ui().plugin.ribbon, () => { void this.openSemantropy(); });
			el.classList.add("semantropy-ribbon");
			el.dataset.icon = "brain-circuit";
			this.ribbonEl = el;
			this.ribbonParent = el.parentNode;
		}
		const el = this.ribbonEl;
		const parent = this.ribbonParent;
		if (!el.isConnected && parent) parent.appendChild(el);
		this.renameRibbon();
	}

	private renameRibbon(): void {
		const el = this.ribbonEl;
		if (!el) return;
		const label = ui().plugin.ribbon;
		if (el.getAttribute("aria-label") !== label) el.setAttribute("aria-label", label);
	}

	/** Leaves the Obsidian registration in place and takes the button out of the tree. */
	private detachRibbon(): void {
		const el = this.ribbonEl;
		if (!el) return;
		if (el.parentNode) this.ribbonParent = el.parentNode;
		el.remove();
	}

	private removeRibbon(): void {
		this.detachRibbon();
		this.ribbonEl = null;
		this.ribbonParent = null;
	}

	/** A Notice in the current language; an unknown message is shown as it is. */
	private notice(message: string): void {
		for (const notice of this.notices.keys()) if (!notice.containerEl.isConnected) this.notices.delete(notice);
		this.notices.set(new Notice(localize(message)), message);
	}

	onunload(): void {
		this.removeRibbon();
		this.automaticCoordinator.dispose();
		for (const view of this.semantropyViews()) view.disableAutomatic();
		for (const view of this.semantropyViews()) view.disableCollision();
		for (const view of this.semantropyViews()) view.disableFakeProverb();
		this.settingTab?.hide();
		this.settingTab = null;
		this.notices.clear();
		this.tokenizer?.dispose();
		this.tokenizer = null;
		// The language is module state; a later load starts from the stored value again.
		setCurrentUiLanguage("en");
	}

	/**
	 * Persists a new body value. The dictionary value is re-serialized
	 * unchanged, so the two settings can never overwrite each other.
	 */
	private async setBodySemantropy(value: BodySemantropy): Promise<boolean> {
		return await this.settingsStore.setBodySemantropy(value);
	}

	private async setDictionarySemantropy(
		value: DictionarySemantropy,
  source?: unknown,
	): Promise<boolean> {
  const saved = await this.settingsStore.setDictionarySemantropy(value);
  if (saved) await Promise.all(this.semantropyViews().filter(view => view !== source).map(view => view.dictionarySettingsChanged()));
  return saved;
	}

	/**
	 * Persists display settings once, then asks every view to catch up.
	 *
	 * The return value describes the *write*, not the screen: it is true when
	 * the setting reached disk. Awaiting this does not mean every body has
	 * already been redrawn. Each view is asked before this resolves, and a
	 * view that can act does so immediately, but one that is busy — a Collect
	 * in flight, a Reshuffle being prepared — deliberately defers its re-mark
	 * until the claim is released, and reports its own state through its
	 * Toolbar if it cannot re-mark at all. Convergence is eventual and
	 * per-view; each view re-reads the stored settings on every pass, so a
	 * burst of changes settles on the last one. A view that closes mid-flight
	 * simply stops applying, and the saved setting stands.
	 */
	private async setDisplaySettings(
		patch: Partial<SemantropyDisplaySettings>,
	): Promise<boolean> {
		const saved = await this.settingsStore.setDisplaySettings(patch);
		if (!saved) {
			console.error("[Semantropy] failed to save a display setting");
			return false;
		}
		await Promise.all(
			this.semantropyViews().map((view) =>
				view.applyStoredDisplaySettings().catch(() => {
					// One view's display failure never fails the stored setting
					// or the other views; it re-reads them on its next pass.
					console.error("[Semantropy] failed to apply a display setting");
				}),
			),
		);
		return true;
	}

	private getCollectionPath(): string {
		return this.settingsStore.getCollectionPath();
	}

	private async setCollectionPath(value: string): Promise<boolean> {
		return await this.settingsStore.setCollectionPath(value);
	}

	private getTokenizer(): SemantropyTokenizerHost {
		if (!this.tokenizer) {
			this.tokenizer = this.createTokenizer();
		}
		return this.tokenizer;
	}

	/**
	 * Source events are registered through `registerEvent`, so Obsidian
	 * detaches every one of them on unload.
	 */
	private registerSourceEvents(): void {
		this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
			for (const view of this.semantropyViews()) if (view.leaf !== leaf) view.cancelVocabularyPreparation();
		}));
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				const sourcePath = info?.file?.path;
				if (!sourcePath) {
					return;
				}
				// Captured synchronously with the event: this is the buffer that
				// just changed, before any later keystroke can move it.
				this.notifySourceChanged(sourcePath, readEditorValue(editor));
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					this.notifySourceChanged(file.path, null);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (_file, oldPath) => {
				this.notifySourceLost(oldPath);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.notifySourceLost(file.path);
			}),
		);
	}

	private notifySourceChanged(
		sourcePath: string,
		editorText: string | null,
	): void {
		// Recorded before dispatch, and whether or not any view is listening:
		// an Open in flight may have no view to notify yet.
		this.sourceRevisions.bump(sourcePath);
		for (const view of this.semantropyViews()) view.notifyVocabularySourceEvent(sourcePath);
		dispatchSourceEvent({
			event: { kind: "changed", sourcePath, editorText },
			views: this.semantropyViews(),
			getSourcePath: (view) => view.getSourcePath(),
			recheck: (view, text) => {
				void view.recheckSourceFreshness(text);
			},
			markLost: (view) => {
				view.markSourceLost();
			},
		});
	}

	private notifySourceLost(sourcePath: string): void {
		this.sourceRevisions.bump(sourcePath);
		for (const view of this.semantropyViews()) view.notifyVocabularySourceEvent(sourcePath, "missing");
		dispatchSourceEvent({
			event: { kind: "lost", sourcePath },
			views: this.semantropyViews(),
			getSourcePath: (view) => view.getSourcePath(),
			recheck: (view, text) => {
				void view.recheckSourceFreshness(text);
			},
			markLost: (view) => {
				view.markSourceLost();
			},
		});
	}

	/** Every Semantropy view, including the ones on inactive leaves. */
	private semantropyViews(): SemantropyView[] {
		return this.app.workspace
			.getLeavesOfType(SEMANTROPY_VIEW_TYPE)
			.map((leaf) => leaf.view)
			.filter((view): view is SemantropyView => view instanceof SemantropyView);
	}

	/**
	 * Current body for a Vault path. An open editor wins over the saved file
	 * wherever the note is displayed, so an unsaved edit is never judged
	 * against a stale disk copy.
	 */
	private readCurrentText(sourcePath: string): Promise<string> {
		return readCurrentSourceText(sourcePath, {
			readEditorText: (path) => this.readEditorText(path),
			readSavedText: async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					throw new Error("The source note is no longer available.");
				}
				return await this.app.vault.cachedRead(file);
			},
		});
	}

	private readEditorText(sourcePath: string): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== sourcePath) {
				continue;
			}
			const value = readEditorValue(view.editor);
			if (value !== null) {
				return value;
			}
		}
		return null;
	}

	private async runReshuffleCommand(): Promise<void> {
		const invoked = invokeReshuffleCommand({
			activeView: this.app.workspace.getActiveViewOfType(SemantropyView),
			existingViews: this.semantropyViews(),
			reshuffle: (view) => view.reshuffle(),
		});
		if (invoked.status === "missing") {
			this.notice(RESHUFFLE_MISSING_VIEW_MESSAGE);
			return;
		}
		const outcome = await invoked.outcome;
		if (outcome === "unavailable") {
			this.notice(RESHUFFLE_UNAVAILABLE_MESSAGE);
			return;
		}
		if (outcome === "failed") {
			this.notice(RESHUFFLE_ERROR_MESSAGE);
		}
	}

	/**
	 * Runs the same `refreshSource` method the button calls. It never creates a
	 * view and never adopts the active Markdown note as the refresh target.
	 */
	private async runRefreshSourceCommand(): Promise<void> {
		const invoked = invokeSemantropyViewCommand({
			activeView: this.app.workspace.getActiveViewOfType(SemantropyView),
			existingViews: this.semantropyViews(),
			run: (view) => view.refreshSource(),
		});
		if (invoked.status === "missing") {
			this.notice(REFRESH_MISSING_VIEW_MESSAGE);
			return;
		}
		const outcome = await invoked.outcome;
		if (outcome === "unavailable" || outcome === "busy") {
			this.notice(REFRESH_UNAVAILABLE_MESSAGE);
			return;
		}
		if (outcome === "failed") {
			this.notice(REFRESH_ERROR_MESSAGE);
		}
	}

	/**
	 * Runs the same `copySelectedFragment` method the button calls. It never
	 * creates a view and never reads the active Markdown editor's selection.
	 */
	private async runCopySelectedFragmentCommand(): Promise<void> {
		const invoked = invokeSemantropyViewCommand({
			activeView: this.app.workspace.getActiveViewOfType(SemantropyView),
			existingViews: this.semantropyViews(),
			run: (view) => view.copySelectedFragment(),
		});
		if (invoked.status === "missing") {
			this.notice(COPY_MISSING_VIEW_MESSAGE);
			return;
		}
		await invoked.outcome;
	}

	/**
	 * Runs the same `collectSelectedFragment` method the button calls. It never
	 * creates a view and never adopts the active Markdown note as the Collect
	 * target.
	 */
	private async runCollectSelectedFragmentCommand(): Promise<void> {
		const invoked = invokeSemantropyViewCommand({
			activeView: this.app.workspace.getActiveViewOfType(SemantropyView),
			existingViews: this.semantropyViews(),
			run: (view) => view.collectSelectedFragment(),
		});
		if (invoked.status === "missing") {
			this.notice(COLLECT_MISSING_VIEW_MESSAGE);
			return;
		}
		await invoked.outcome;
	}

	/**
	 * Runs the same `defineSelectedWord` method the command palette uses. It
	 * never creates a view and never reads the active Markdown editor.
	 */
	private async runDefineSelectedWordCommand(): Promise<void> {
		const invoked = invokeSemantropyViewCommand({
			activeView: this.app.workspace.getActiveViewOfType(SemantropyView),
			existingViews: this.semantropyViews(),
			run: (view) => view.defineSelectedWord(),
		});
		if (invoked.status === "missing") {
			this.notice(DEFINE_MISSING_VIEW_MESSAGE);
			return;
		}
		await invoked.outcome;
	}

	/**
	 * Runs the same `reshuffleDefinition` method the Modal button calls. It
	 * never creates a view and never falls back to the active Markdown note.
	 */
	private runReshuffleDefinitionCommand(): void {
		const invoked = invokeSemantropyViewCommand({
			activeView: this.app.workspace.getActiveViewOfType(SemantropyView),
			existingViews: this.semantropyViews(),
			run: (view) => view.reshuffleDefinition(),
		});
		if (invoked.status === "missing") {
			this.notice(DEFINE_MISSING_VIEW_MESSAGE);
			return;
		}
	}

	private collectFragmentInput(
		input: CollectFragmentInput,
	): Promise<CollectFragmentResult> {
		return collectFragment(input, {
			repository: this.fragmentRepository,
			newId: this.fragmentIdSource,
			now: this.fragmentClock,
		});
	}

	private writeClipboard(text: string): Promise<void> {
		return navigator.clipboard.writeText(text);
	}

	private captureActiveMarkdown(): {
		capture: SourceCapture;
		readCached: (sourcePath: string) => Promise<string>;
		capturedSourceChanged: () => boolean;
	} {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const capturedFile = markdownView?.file ?? null;
		let editorText: string | null = null;
		if (markdownView) {
			editorText = readEditorValue(markdownView.editor);
		}

		if (!markdownView || !capturedFile) {
			return {
				capture: { kind: "none" },
				readCached: async () => {
					throw new Error("No Markdown note was captured.");
				},
				capturedSourceChanged: () => false,
			};
		}

		// Taken in the same synchronous step as the editor body above, so any
		// later change to this note is visible as a revision bump.
		const capturedPath = capturedFile.path;
		const capturedRevision = this.sourceRevisions.current(capturedPath);

		return {
			capture: {
				kind: "markdown",
				note: {
					sourcePath: capturedFile.path,
					sourceName: capturedFile.name,
					editorText,
				},
			},
			readCached: async (sourcePath) => {
				if (capturedFile.path !== sourcePath) {
					throw new Error("Captured note is unavailable.");
				}
				return this.app.vault.cachedRead(capturedFile);
			},
			capturedSourceChanged: () =>
				this.sourceRevisions.changedSince(capturedPath, capturedRevision),
		};
	}

	private async revealSemantropyLeaf(): Promise<SemantropyView> {
		const existing = this.app.workspace.getLeavesOfType(SEMANTROPY_VIEW_TYPE);
		const leaf = existing[0] ?? this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: SEMANTROPY_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		if (!(leaf.view instanceof SemantropyView)) {
			throw new Error("Semantropy view was not created.");
		}
		return leaf.view;
	}

	private async openSemantropy(): Promise<void> {
		// The body is captured synchronously, but revealing the leaf is async.
		// `capturedSourceChanged` closes that gap: the view checks it before
		// publishing the snapshot as fresh.
		const { capture, readCached, capturedSourceChanged } =
			this.captureActiveMarkdown();
		try {
			const view = await this.revealSemantropyLeaf();
			await view.openCapture(capture, { readCached, capturedSourceChanged });
		} catch {
			this.notice(EN_MESSAGES.plugin.openFailed);
			console.error("[Semantropy] failed to open the view");
		}
	}
}

function readEditorValue(editor: Editor | undefined): string | null {
	try {
		return editor?.getValue() ?? null;
	} catch {
		return null;
	}
}
