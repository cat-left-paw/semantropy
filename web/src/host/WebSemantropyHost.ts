/**
 * The web counterpart of `SemantropyPlugin`: it owns the settings store, the
 * Automatic coordinator, the Collect repository and the tokenizer, and it
 * builds the one `SemantropyView` the page shows.
 *
 * Every adapter mirrors the plugin's wiring in `src/SemantropyPlugin.ts`. The
 * differences are only where things come from: documents instead of Vault
 * notes, localStorage instead of `data.json`, and a browser Collection instead
 * of a Vault file. The View itself is the shared, unmodified class.
 */
import type { App, WorkspaceLeaf } from "obsidian";
import { Notice } from "obsidian";
import { AutomaticPosCoordinator } from "../../../src/application/AutomaticPosCoordinator";
import { dispatchSourceEvent } from "../../../src/application/dispatchSourceEvent";
import { SourceRevisionLog } from "../../../src/application/sourceRevisionLog";
import { systemFragmentClock, webCryptoFragmentIdSource } from "../../../src/collect/fragmentIdentity";
import { localCollectionDate } from "../../../src/collect/localCollectionDate";
import type { CollectFragmentInputV4 } from "../../../src/collect/v4/CollectedFragmentV4";
import { collectFragmentV4, type CollectFragmentResultV4 } from "../../../src/collect/v4/CollectFragmentUseCaseV4";
import { MarkdownFragmentRepositoryV4 } from "../../../src/collect/v4/FragmentRepositoryV4";
import { localize } from "../../../src/i18n/messages";
import { currentUiLanguage, setCurrentUiLanguage, type UiLanguage } from "../../../src/i18n/language";
import { AutomaticPosSettingsStore } from "../../../src/settings/AutomaticPosSettingsStore";
import type { CollectAttributionKey } from "../../../src/settings/automaticPosSettings";
import type { DictionarySemantropy } from "../../../src/settings/dictionarySemantropy";
import type { SemantropyDisplaySettings } from "../../../src/settings/displaySettings";
import { SEMANTROPY_VIEW_TYPE, SemantropyView } from "../../../src/view/SemantropyView";
import type { WebTokenizer } from "../engine/WorkerTokenizer";
import type { WebCollectionStorage } from "./webCollectionStorage";
import type { WebLibrary } from "./WebLibrary";

const SETTINGS_KEY = "semantropy.web.settings.v1";

export class WebSemantropyHost {
	readonly settings: AutomaticPosSettingsStore;
	private readonly coordinator: AutomaticPosCoordinator;
	private readonly repository: MarkdownFragmentRepositoryV4;
	private readonly sourceRevisions = new SourceRevisionLog();
	private readonly fragmentIdSource = webCryptoFragmentIdSource();
	private readonly fragmentClock = systemFragmentClock();
	private readonly app: App = { web: true };
	private view: SemantropyView | null = null;
	private readonly languageListeners = new Set<(language: UiLanguage) => void>();
	private readonly notices = new Map<Notice, string>();

	constructor(
		readonly library: WebLibrary,
		readonly collection: WebCollectionStorage,
		readonly tokenizer: WebTokenizer,
		private readonly storage: Storage | null,
	) {
		this.settings = new AutomaticPosSettingsStore({
			load: async () => this.loadSettings(),
			save: async (data) => this.saveSettings(data),
		});
		this.coordinator = new AutomaticPosCoordinator(this.settings);
		this.repository = new MarkdownFragmentRepositoryV4(
			collection,
			() => this.settings.getCollectionPath(),
			(created) => ({ ...this.settings.getCollectAttribution(), uiLanguage: this.settings.getUiLanguage(), localDate: localCollectionDate(created) }),
		);
		library.onEvent((event) => {
			if (event.kind === "changed") this.notifySourceChanged(event.path, event.text);
			else if (event.kind === "lost") this.notifySourceLost(event.path);
		});
	}

	async start(): Promise<void> {
		await this.settings.load();
		// 0.1.0 S1: the page is Japanese only, whatever a stored setting says.
		this.applyUiLanguage("ja");
		document.documentElement.lang = currentUiLanguage();
		this.applyPageTheme();
	}

	/** Builds the page's one View inside `parent` and opens it (empty). */
	async mountView(parent: HTMLElement): Promise<SemantropyView> {
		if (this.view) return this.view;
		const leaf: WorkspaceLeaf = { app: this.app, view: null };
		const view = new SemantropyView(leaf, {
			automaticPosCoordinator: this.coordinator,
			// The page has its own Recompose panel (with "open as Target"); the shared dialog stays Obsidian-only.
			recomposeDialog: false,
			getAutomaticPos: () => this.settings.getSettings().automaticPos,
			getTokenizer: () => this.tokenizer,
			listVocabularyNotes: () => this.library.list().map((doc) => doc.path),
			isVocabularyViewActive: () => true,
			readCurrentText: (path) => this.library.readText(path),
			getBodySemantropy: () => this.settings.getBodySemantropy(),
			setBodySemantropy: (value) => this.settings.setBodySemantropy(value),
			waitForPendingSettings: () => this.settings.whenSettled(),
			getDisplaySettings: () => this.settings.getDisplaySettings(),
			setDisplaySettings: (patch) => this.setDisplaySettings(patch),
			getDictionarySemantropy: () => this.settings.getDictionarySemantropy(),
			setDictionarySemantropy: (value) => this.setDictionarySemantropy(value),
			collectFragment: (input) => this.collectFragment(input),
			writeClipboard: (text) => navigator.clipboard.writeText(text),
			showNotice: (message) => this.notice(message),
		});
		leaf.view = view;
		view.containerEl.dataset.type = SEMANTROPY_VIEW_TYPE;
		parent.appendChild(view.containerEl);
		await view.onOpen();
		this.view = view;
		if (typeof ResizeObserver !== "undefined") {
			new ResizeObserver(() => view.onResize()).observe(view.containerEl);
		}
		return view;
	}

	getView(): SemantropyView | null {
		return this.view;
	}

	/** `Semantropy: Open` for a document: the text is captured synchronously, as the plugin captures an editor. */
	async openDocument(path: string): Promise<void> {
		const view = this.view;
		if (!view) return;
		const doc = this.library.get(path);
		if (!doc) return;
		const text = this.library.peekText(path) ?? (await this.library.readText(path));
		const revision = this.sourceRevisions.current(path);
		await view.openCapture(
			{ kind: "markdown", note: { sourcePath: path, sourceName: doc.name, editorText: text } },
			{
				readCached: (sourcePath) => this.library.readText(sourcePath),
				capturedSourceChanged: () => this.sourceRevisions.changedSince(path, revision),
			},
		);
	}

	async setUiLanguage(language: UiLanguage): Promise<boolean> {
		const saved = await this.settings.setUiLanguage(language);
		this.applyUiLanguage(this.settings.getUiLanguage());
		return saved;
	}

	setCollectAttribution(key: CollectAttributionKey, value: boolean): Promise<boolean> {
		return this.settings.setCollectAttribution(key, value);
	}

	onLanguageChange(listener: (language: UiLanguage) => void): () => void {
		this.languageListeners.add(listener);
		return () => this.languageListeners.delete(listener);
	}

	notice(message: string): void {
		for (const notice of this.notices.keys()) if (!notice.containerEl.isConnected) this.notices.delete(notice);
		this.notices.set(new Notice(localize(message)), message);
	}

	private applyUiLanguage(language: UiLanguage): void {
		if (language === currentUiLanguage()) return;
		setCurrentUiLanguage(language);
		document.documentElement.lang = language;
		for (const [notice, message] of this.notices) {
			if (!notice.containerEl.isConnected) {
				this.notices.delete(notice);
				continue;
			}
			notice.setMessage(localize(message));
		}
		this.view?.languageChanged();
		for (const listener of this.languageListeners) listener(language);
	}

	private async setDisplaySettings(patch: Partial<SemantropyDisplaySettings>): Promise<boolean> {
		const saved = await this.settings.setDisplaySettings(patch);
		if (!saved) return false;
		this.applyPageTheme();
		await this.view?.applyStoredDisplaySettings().catch(() => undefined);
		return true;
	}

	/** 0.1.0 S2: on the web the Display settings theme is the whole page's theme. */
	private applyPageTheme(): void {
		const theme = this.settings.getDisplaySettings().bodyTheme;
		if (theme === "default") delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = theme;
	}

	private setDictionarySemantropy(value: DictionarySemantropy): Promise<boolean> {
		return this.settings.setDictionarySemantropy(value);
	}

	private collectFragment(input: CollectFragmentInputV4): Promise<CollectFragmentResultV4> {
		return collectFragmentV4(input, { repository: this.repository, newId: this.fragmentIdSource, now: this.fragmentClock });
	}

	private notifySourceChanged(sourcePath: string, text: string | null): void {
		this.sourceRevisions.bump(sourcePath);
		const views = this.view ? [this.view] : [];
		for (const view of views) view.notifyVocabularySourceEvent(sourcePath);
		dispatchSourceEvent({
			event: { kind: "changed", sourcePath, editorText: text },
			views,
			getSourcePath: (view) => view.getSourcePath(),
			recheck: (view, editorText) => void view.recheckSourceFreshness(editorText),
			markLost: (view) => view.markSourceLost(),
		});
	}

	private notifySourceLost(sourcePath: string): void {
		this.sourceRevisions.bump(sourcePath);
		const views = this.view ? [this.view] : [];
		for (const view of views) view.notifyVocabularySourceEvent(sourcePath, "missing");
		dispatchSourceEvent({
			event: { kind: "lost", sourcePath },
			views,
			getSourcePath: (view) => view.getSourcePath(),
			recheck: (view, editorText) => void view.recheckSourceFreshness(editorText),
			markLost: (view) => view.markSourceLost(),
		});
	}

	private loadSettings(): unknown {
		if (!this.storage) return null;
		try {
			const raw = this.storage.getItem(SETTINGS_KEY);
			return raw ? (JSON.parse(raw) as unknown) : null;
		} catch {
			return null;
		}
	}

	private saveSettings(data: unknown): void {
		// With no storage the settings still apply for this visit.
		if (!this.storage) return;
		this.storage.setItem(SETTINGS_KEY, JSON.stringify(data));
	}
}
