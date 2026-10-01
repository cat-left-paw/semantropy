import { createIcon } from "../obsidian/icons";
import type { EngineLoadState } from "../engine/WorkerTokenizer";
import type { DocumentStore } from "../host/documentStore";
import type { PresetInfo } from "../host/WebLibrary";
import type { WebSemantropyHost } from "../host/WebSemantropyHost";
import { RecomposePanel } from "./RecomposePanel";
import { t } from "./webText";

type TabId = "texts" | "view" | "recompose" | "collection" | "about";

export type ShellOptions = {
	enginePackBytes: number;
	buildLabel: string;
	presets: readonly PresetInfo[];
	storageAvailable: boolean;
	documents: DocumentStore;
};

const LONG_TEXT_CHARS = 60_000;

/**
 * The page around the shared View: the Texts, Collection and About panels, the
 * tab bar and the header. Everything here writes text with `textContent`;
 * nothing a user pastes is ever parsed as HTML.
 */
export class Shell {
	private readonly labels: (() => void)[] = [];
	private readonly app: HTMLElement;
	private tab: TabId = "texts";
	private selectedPath: string | null = null;
	private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
	private engineStatus!: HTMLElement;
	private engineCard!: HTMLElement;
	private engineText!: HTMLElement;
	private engineDetail!: HTMLElement;
	private engineBar!: HTMLElement;
	private docSelect!: HTMLSelectElement;
	private textArea!: HTMLTextAreaElement;
	private charCount!: HTMLElement;
	private docNote!: HTMLElement;
	private credit!: HTMLElement;
	private openButton!: HTMLButtonElement;
	private duplicateButton!: HTMLButtonElement;
	private removeButton!: HTMLButtonElement;
	private collectionText!: HTMLElement;
	private collectionEmpty!: HTMLElement;
	private collectionActions: HTMLButtonElement[] = [];
	private viewHost!: HTMLElement;
	private editTimer: number | null = null;
	private saveTimer: number | null = null;
	private persistToggle!: HTMLInputElement;
	private opening = false;
	private recompose!: RecomposePanel;

	constructor(
		private readonly root: HTMLElement,
		private readonly host: WebSemantropyHost,
		private readonly options: ShellOptions,
	) {
		this.app = document.createElement("div");
		this.app.className = "sw-app";
	}

	async mount(): Promise<void> {
		this.root.replaceChildren(this.app);
		this.app.append(this.buildHeader(), this.buildTabs(), this.buildMain(), this.buildEngineCard());
		this.host.onLanguageChange(() => this.relabel());
		this.host.tokenizer.onLoadState((state) => this.showEngine(state));
		this.host.library.onEvent((event) => {
			if (event.kind === "listed") this.fillDocuments();
			this.scheduleSave();
		});
		this.host.collection.onChange(() => this.showCollection());
		if (this.host.library.list().length === 0) this.host.library.add(`${t().texts.newName}1`, "");
		this.fillDocuments();
		const docs = this.host.library.list();
		const first = docs.find((doc) => doc.kind === "user") ?? docs[0];
		if (first) await this.selectDocument(first.path);
		this.showCollection();
		this.showEngine(this.host.tokenizer.getLoadState());
		this.setTab("texts");
		this.relabel();
		await this.host.mountView(this.viewHost);
	}

	// ─── header and tabs ──────────────────────────────────────────────

	private buildHeader(): HTMLElement {
		const header = el("header", "sw-header");
		const brand = el("div", "sw-brand");
		const mark = el("span", "sw-brand-mark");
		mark.appendChild(createIcon("brain-circuit"));
		const name = el("span", "sw-brand-name");
		const suffix = el("span", "sw-brand-suffix");
		this.text(name, () => t().appName);
		this.text(suffix, () => t().appSuffix);
		brand.append(mark, name, suffix);
		this.engineStatus = el("div", "sw-engine-status");
		this.engineStatus.setAttribute("role", "status");
		this.engineStatus.setAttribute("aria-live", "polite");
		// 0.1.0 S1: the page is Japanese only (Semantropy works on Japanese text only), so no language switch.
		header.append(brand, this.engineStatus);
		return header;
	}

	private buildTabs(): HTMLElement {
		const nav = el("nav", "sw-tabs");
		nav.setAttribute("role", "tablist");
		this.attr(nav, "aria-label", () => t().tabsLabel);
		const icons: Record<TabId, string> = { texts: "file-plus", view: "brain-circuit", recompose: "wand-sparkles", collection: "inbox", about: "info" };
		for (const id of ["texts", "view", "recompose", "collection", "about"] as const) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = `sw-tab sw-tab-${id}`;
			button.setAttribute("role", "tab");
			button.id = `sw-tab-${id}`;
			button.setAttribute("aria-controls", `sw-panel-${id}`);
			const glyph = el("span", "sw-tab-icon");
			glyph.appendChild(createIcon(icons[id]));
			const label = el("span", "sw-tab-label");
			this.text(label, () => t().tabs[id]);
			button.append(glyph, label);
			button.addEventListener("click", () => this.setTab(id));
			this.tabButtons.set(id, button);
			nav.appendChild(button);
		}
		return nav;
	}

	private setTab(tab: TabId): void {
		this.tab = tab;
		this.app.dataset.tab = tab;
		for (const [id, button] of this.tabButtons) {
			const selected = id === tab;
			button.setAttribute("aria-selected", String(selected));
			button.tabIndex = selected ? 0 : -1;
		}
		if (tab === "view") this.host.getView()?.onResize();
		if (tab === "recompose") this.recompose.suggest(this.selectedPath);
	}

	// ─── panels ───────────────────────────────────────────────────────

	private buildMain(): HTMLElement {
		const main = el("main", "sw-main");
		main.append(this.buildTexts(), this.buildView(), this.buildRecompose(), this.buildCollection(), this.buildAbout());
		return main;
	}

	private panel(id: TabId): HTMLElement {
		const section = el("section", `sw-panel sw-panel-${id}`);
		section.id = `sw-panel-${id}`;
		section.setAttribute("role", "tabpanel");
		section.setAttribute("aria-labelledby", `sw-tab-${id}`);
		return section;
	}

	private buildTexts(): HTMLElement {
		const section = this.panel("texts");
		const intro = el("p", "sw-tagline");
		this.text(intro, () => t().tagline);

		const pickRow = el("div", "sw-row sw-doc-row");
		const pickLabel = el("label", "sw-field-label");
		pickLabel.htmlFor = "sw-doc-select";
		this.text(pickLabel, () => t().texts.document);
		this.docSelect = document.createElement("select");
		this.docSelect.id = "sw-doc-select";
		this.docSelect.className = "sw-doc-select";
		this.docSelect.addEventListener("change", () => void this.selectDocument(this.docSelect.value));
		const add = this.button("sw-add", "file-plus", () => t().texts.add, () => this.addDocument());
		pickRow.append(pickLabel, this.docSelect, add);

		this.credit = el("p", "sw-credit");
		this.textArea = document.createElement("textarea");
		this.textArea.className = "sw-editor";
		this.textArea.spellcheck = false;
		this.attr(this.textArea, "placeholder", () => t().texts.placeholder);
		this.attr(this.textArea, "aria-label", () => t().texts.document);
		this.textArea.addEventListener("input", () => this.onEdit());

		const meta = el("div", "sw-row sw-doc-meta");
		this.charCount = el("span", "sw-char-count");
		this.docNote = el("span", "sw-doc-note");
		this.duplicateButton = this.button("sw-duplicate", "copy", () => t().texts.duplicate, () => this.duplicateDocument());
		this.removeButton = this.button("sw-remove", "trash-2", () => t().texts.remove, () => this.removeDocument());
		meta.append(this.charCount, this.docNote, this.duplicateButton, this.removeButton);

		this.openButton = this.button("sw-open mod-cta", "brain-circuit", () => (this.opening ? t().texts.opening : t().texts.open), () => void this.openSelected(), true);
		const firstLoad = el("p", "sw-hint sw-first-load");
		this.text(firstLoad, () => t().engine.firstLoad((this.options.enginePackBytes / 1_000_000).toFixed(0)));
		const vocabulary = el("p", "sw-hint");
		this.text(vocabulary, () => t().texts.vocabularyHint);

		section.append(intro, pickRow, this.credit, this.textArea, meta, this.openButton, firstLoad, vocabulary, this.buildPersist());
		return section;
	}

	private buildPersist(): HTMLElement {
		const box = el("div", "sw-persist");
		const label = el("label", "sw-persist-label");
		this.persistToggle = document.createElement("input");
		this.persistToggle.type = "checkbox";
		this.persistToggle.checked = this.options.documents.isEnabled();
		this.persistToggle.disabled = !this.options.documents.isAvailable();
		const text = el("span", "");
		this.text(text, () => t().texts.persist);
		label.append(this.persistToggle, text);
		const hint = el("p", "sw-hint");
		this.text(hint, () => t().texts.persistHint);
		this.persistToggle.addEventListener("change", () => void this.setPersist(this.persistToggle.checked));
		box.append(label, hint);
		return box;
	}

	private async setPersist(enabled: boolean): Promise<void> {
		const store = this.options.documents;
		if (enabled) {
			if (!store.setEnabled(true)) {
				this.persistToggle.checked = false;
				this.host.notice(t().texts.persistFailed);
				return;
			}
			this.flushEdit();
			await this.saveNow();
			return;
		}
		if (!window.confirm(t().texts.persistOffConfirm)) {
			this.persistToggle.checked = true;
			return;
		}
		store.setEnabled(false);
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = null;
		try {
			await store.clear();
		} catch {
			this.host.notice(t().texts.persistClearFailed);
		}
	}

	private scheduleSave(): void {
		if (!this.options.documents.isEnabled()) return;
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => void this.saveNow(), 500);
	}

	private async saveNow(): Promise<void> {
		this.saveTimer = null;
		if (!this.options.documents.isEnabled()) return;
		try {
			await this.options.documents.saveAll(this.host.library.userDocuments());
		} catch {
			this.host.notice(t().texts.persistFailed);
		}
	}

	private buildView(): HTMLElement {
		const section = this.panel("view");
		this.viewHost = el("div", "sw-view-host");
		// Until the first Open, the page shows its own guidance instead of the
		// View's empty state, which is worded for Obsidian's command palette.
		const empty = el("div", "sw-view-empty");
		const message = el("p", "");
		this.text(message, () => t().view.empty);
		const go = this.button("sw-view-empty-go", "file-plus", () => t().view.chooseText, () => this.setTab("texts"));
		empty.append(message, go);
		section.append(empty, this.viewHost);
		return section;
	}

	private buildRecompose(): HTMLElement {
		const section = this.panel("recompose");
		this.recompose = new RecomposePanel(this.host, (name, text) => void this.openGenerated(name, text));
		section.appendChild(this.recompose.el);
		return section;
	}

	/** Recompose output becomes an ordinary document and opens as the Target. */
	private async openGenerated(name: string, text: string): Promise<void> {
		this.flushEdit();
		const path = this.host.library.add(name, text);
		await this.selectDocument(path);
		await this.openSelected();
	}

	private buildCollection(): HTMLElement {
		const section = this.panel("collection");
		const heading = el("h2", "sw-heading");
		this.text(heading, () => t().collection.heading);
		const stored = el("p", "sw-hint");
		this.text(stored, () => (this.options.storageAvailable ? t().collection.storedHere : t().errors.storageUnavailable));
		const actions = el("div", "sw-row sw-collection-actions");
		const copy = this.button("sw-collection-copy", "copy", () => t().collection.copy, () => void this.copyCollection());
		const download = this.button("sw-collection-download", "download", () => t().collection.download, () => this.downloadCollection());
		const clear = this.button("sw-collection-clear", "trash-2", () => t().collection.clear, () => this.clearCollection());
		this.collectionActions = [copy, download, clear];
		actions.append(copy, download, clear);
		this.collectionEmpty = el("p", "sw-empty");
		this.text(this.collectionEmpty, () => t().collection.empty);
		this.collectionText = el("pre", "sw-collection-text");
		section.append(heading, stored, actions, this.collectionEmpty, this.collectionText);
		return section;
	}

	private buildAbout(): HTMLElement {
		const section = this.panel("about");
		const heading = el("h2", "sw-heading");
		this.text(heading, () => t().about.heading);
		section.appendChild(heading);
		const body = el("div", "sw-about-body");
		this.labels.push(() => {
			body.replaceChildren(...t().about.body.map((paragraph) => textEl("p", paragraph)));
		});
		const steps = el("h3", "sw-subheading");
		this.text(steps, () => t().about.steps);
		const list = el("ol", "sw-steps");
		this.labels.push(() => list.replaceChildren(...t().about.stepList.map((item) => textEl("li", item))));
		const privacy = el("h3", "sw-subheading");
		this.text(privacy, () => t().about.privacy);
		const privacyBody = el("p", "");
		this.text(privacyBody, () => t().about.privacyBody);
		const obsidian = el("h3", "sw-subheading");
		this.text(obsidian, () => t().about.obsidian);
		const japaneseOnly = el("p", "sw-japanese-only");
		japaneseOnly.lang = "en";
		this.text(japaneseOnly, () => t().about.japaneseOnly);
		const obsidianBody = el("p", "");
		this.text(obsidianBody, () => t().about.obsidianBody);
		const repo = document.createElement("a");
		repo.href = "https://github.com/cat-left-paw/semantropy";
		repo.rel = "noopener";
		repo.textContent = "github.com/cat-left-paw/semantropy";
		const licenses = el("h3", "sw-subheading");
		this.text(licenses, () => t().about.licenses);
		const licenseLink = document.createElement("a");
		licenseLink.href = "licenses.txt";
		this.text(licenseLink, () => t().about.licensesLink);
		const credits = el("h3", "sw-subheading");
		this.text(credits, () => t().about.presetCredits);
		const creditList = el("ul", "sw-credits");
		for (const preset of this.options.presets) {
			const item = document.createElement("li");
			const title = textEl("strong", `${preset.author}「${preset.title}」`);
			const detail = textEl("pre", preset.credit);
			detail.className = "sw-credit-detail";
			item.append(title, detail);
			creditList.appendChild(item);
		}
		const build = el("p", "sw-build");
		this.text(build, () => t().about.build(this.options.buildLabel));
		section.append(body, japaneseOnly, steps, list, privacy, privacyBody, obsidian, obsidianBody, para(repo), licenses, para(licenseLink), credits, creditList, build);
		return section;
	}

	// ─── documents ────────────────────────────────────────────────────

	private fillDocuments(): void {
		const docs = this.host.library.list();
		const user = docs.filter((doc) => doc.kind === "user");
		const presets = docs.filter((doc) => doc.kind === "preset");
		const groups: HTMLOptGroupElement[] = [];
		const group = (label: string, items: typeof docs): void => {
			if (items.length === 0) return;
			const optgroup = document.createElement("optgroup");
			optgroup.label = label;
			for (const doc of items) {
				const option = document.createElement("option");
				option.value = doc.path;
				option.textContent = doc.name;
				optgroup.appendChild(option);
			}
			groups.push(optgroup);
		};
		group(t().texts.groupUser, user);
		group(t().texts.groupPreset, presets);
		this.docSelect.replaceChildren(...groups);
		if (this.selectedPath && this.host.library.has(this.selectedPath)) this.docSelect.value = this.selectedPath;
	}

	private async selectDocument(path: string): Promise<void> {
		this.flushEdit();
		const doc = this.host.library.get(path);
		if (!doc) return;
		this.selectedPath = path;
		this.docSelect.value = path;
		const preset = doc.kind === "preset";
		this.textArea.readOnly = preset;
		this.duplicateButton.hidden = !preset;
		this.removeButton.hidden = preset;
		this.credit.textContent = doc.preset ? doc.preset.credit.split("\n")[0] ?? "" : "";
		this.credit.hidden = !doc.preset;
		const known = this.host.library.peekText(path);
		if (known !== null) {
			this.showText(known);
			return;
		}
		this.textArea.value = "";
		this.docNote.textContent = t().texts.loadingPreset;
		this.openButton.disabled = true;
		try {
			const text = await this.host.library.readText(path);
			if (this.selectedPath === path) this.showText(text);
		} catch {
			if (this.selectedPath === path) this.docNote.textContent = t().texts.presetFailed;
		} finally {
			this.syncOpen();
		}
	}

	private showText(text: string): void {
		this.textArea.value = text;
		this.showMeta();
		this.syncOpen();
	}

	private showMeta(): void {
		const path = this.selectedPath;
		const doc = path ? this.host.library.get(path) : undefined;
		const text = this.textArea.value;
		this.charCount.textContent = t().texts.chars([...text].length);
		if (doc?.kind === "preset") this.docNote.textContent = t().texts.presetReadOnly;
		else if (text.length > LONG_TEXT_CHARS) this.docNote.textContent = t().texts.longWarning;
		else this.docNote.textContent = "";
	}

	private onEdit(): void {
		this.showMeta();
		this.syncOpen();
		if (this.editTimer !== null) window.clearTimeout(this.editTimer);
		this.editTimer = window.setTimeout(() => this.flushEdit(), 300);
	}

	private flushEdit(): void {
		if (this.editTimer !== null) window.clearTimeout(this.editTimer);
		this.editTimer = null;
		const path = this.selectedPath;
		if (path && this.host.library.get(path)?.kind === "user") this.host.library.setText(path, this.textArea.value);
	}

	private addDocument(): void {
		this.flushEdit();
		const count = this.host.library.list().filter((doc) => doc.kind === "user").length + 1;
		const path = this.host.library.add(`${t().texts.newName}${count}`, "");
		void this.selectDocument(path).then(() => this.textArea.focus());
	}

	private duplicateDocument(): void {
		const path = this.selectedPath;
		const doc = path ? this.host.library.get(path) : undefined;
		if (!path || !doc) return;
		const copy = this.host.library.add(doc.preset?.title ?? doc.name, this.textArea.value);
		void this.selectDocument(copy);
	}

	private removeDocument(): void {
		const path = this.selectedPath;
		if (!path || this.host.library.get(path)?.kind !== "user") return;
		if (!window.confirm(t().texts.removeConfirm)) return;
		this.host.library.remove(path);
		this.selectedPath = null;
		const next = this.host.library.list()[0];
		if (next) void this.selectDocument(next.path);
	}

	private syncOpen(): void {
		const empty = this.textArea.value.trim().length === 0;
		this.openButton.disabled = this.opening || empty;
		this.relabelButton(this.openButton);
	}

	private async openSelected(): Promise<void> {
		const path = this.selectedPath;
		if (!path || this.opening) return;
		this.flushEdit();
		this.opening = true;
		this.syncOpen();
		this.setTab("view");
		try {
			await this.host.openDocument(path);
			this.viewHost.classList.add("is-opened");
		} catch {
			this.host.notice(t().errors.openFailed);
		} finally {
			this.opening = false;
			this.syncOpen();
		}
	}

	// ─── collection ──────────────────────────────────────────────────

	private collectionPath(): string {
		return this.host.settings.getCollectionPath();
	}

	private showCollection(): void {
		const text = this.host.collection.read(this.collectionPath());
		const empty = text.trim().length === 0;
		this.collectionText.textContent = text;
		this.collectionText.hidden = empty;
		this.collectionEmpty.hidden = !empty;
		for (const button of this.collectionActions) button.disabled = empty;
	}

	private async copyCollection(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.host.collection.read(this.collectionPath()));
			this.host.notice(t().collection.copied);
		} catch {
			this.host.notice(t().errors.clipboardFailed);
		}
	}

	private downloadCollection(): void {
		const text = this.host.collection.read(this.collectionPath());
		const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = this.collectionPath().split("/").pop() ?? "Semantropy Fragments.md";
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	private clearCollection(): void {
		if (!window.confirm(t().collection.clearConfirm)) return;
		this.host.collection.clear(this.collectionPath());
	}

	// ─── engine status ───────────────────────────────────────────────

	/**
	 * 0.1.0 S1: the dictionary download is shown in the middle of the page, in
	 * the same card the View uses while it works; the header shows only a failure.
	 */
	private buildEngineCard(): HTMLElement {
		this.engineCard = el("div", "sw-engine-overlay");
		this.engineCard.hidden = true;
		this.engineCard.setAttribute("aria-hidden", "true");
		const card = el("div", "semantropy-busy-card");
		const spinner = el("div", "semantropy-busy-spinner");
		this.engineText = el("div", "semantropy-busy-text");
		const bar = el("div", "sw-engine-bar");
		this.engineBar = el("div", "sw-engine-bar-fill");
		bar.appendChild(this.engineBar);
		this.engineDetail = el("div", "semantropy-busy-detail");
		card.append(spinner, this.engineText, bar, this.engineDetail);
		this.engineCard.appendChild(card);
		return this.engineCard;
	}

	private showEngine(state: EngineLoadState): void {
		const status = this.engineStatus;
		status.dataset.state = state.status;
		status.textContent = state.status === "failed" ? t().engine.failed : state.status === "loading" ? t().engine.loading(percentOf(state)) : "";
		status.hidden = state.status !== "failed" && state.status !== "loading";
		const loading = state.status === "loading";
		this.engineCard.hidden = !loading;
		if (!loading) return;
		const percent = percentOf(state);
		this.engineText.textContent = t().engine.loading(percent);
		this.engineDetail.textContent = t().engine.loadingDetail((this.options.enginePackBytes / 1_000_000).toFixed(0));
		this.engineBar.style.setProperty("width", `${percent}%`);
	}

	// ─── labels ──────────────────────────────────────────────────────

	private relabel(): void {
		for (const apply of this.labels) apply();
		this.recompose?.relabel();
		this.fillDocuments();
		this.showMeta();
		this.showEngine(this.host.tokenizer.getLoadState());
		this.syncOpen();
	}

	private text(target: HTMLElement, value: () => string): void {
		const apply = (): void => {
			target.textContent = value();
		};
		apply();
		this.labels.push(apply);
	}

	private attr(target: HTMLElement, name: string, value: () => string): void {
		const apply = (): void => target.setAttribute(name, value());
		apply();
		this.labels.push(apply);
	}

	private readonly buttonLabels = new Map<HTMLButtonElement, () => string>();

	private button(cls: string, icon: string, label: () => string, action: () => void, withText = true): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `sw-button ${cls}`;
		const glyph = el("span", "sw-button-icon");
		glyph.appendChild(createIcon(icon));
		const text = el("span", "sw-button-label");
		button.append(glyph, text);
		if (!withText) text.hidden = true;
		this.buttonLabels.set(button, label);
		this.relabelButton(button);
		this.labels.push(() => this.relabelButton(button));
		button.addEventListener("click", () => {
			if (!button.disabled) action();
		});
		return button;
	}

	private relabelButton(button: HTMLButtonElement): void {
		const label = this.buttonLabels.get(button);
		if (!label) return;
		const value = label();
		const text = button.querySelector<HTMLElement>(".sw-button-label");
		if (text) text.textContent = value;
		button.setAttribute("aria-label", value);
	}
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) element.className = className;
	return element;
}

function textEl<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	element.textContent = text;
	return element;
}

function para(child: HTMLElement): HTMLElement {
	const p = document.createElement("p");
	p.appendChild(child);
	return p;
}

function percentOf(state: EngineLoadState): number {
	return state.status === "loading" && state.total > 0 ? Math.min(100, Math.floor((state.loaded / state.total) * 100)) : 0;
}
