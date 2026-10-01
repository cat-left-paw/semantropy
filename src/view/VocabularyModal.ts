import { Modal, type App } from "obsidian";
import { selectionWeight, type VocabularySelection } from "../application/prepareVocabulary";
import { DEFAULT_SOURCE_WEIGHT, SOURCE_WEIGHT_CHOICES, isSourceWeight, type SourceWeight } from "../vocabulary/sourceWeights";
import type { VocabularyControlsState } from "./VocabularyControls";
import { buildVocabularyTree, filterVocabularyTree, vocabularyNoteName, type VocabularyFolder } from "./vocabularyTree";
import { EN_MESSAGES, ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";

export type VocabularyPickerInput = {
	state: () => VocabularyControlsState;
	/** Vault Markdown paths only. Read once per open; no note text is ever requested here. */
	paths: () => readonly string[];
	draft: (selection: VocabularySelection) => void;
	apply: () => Promise<unknown>;
	/** Drops the draft and any in-flight preparation; the committed Vocabulary stays. */
	cancel: () => void;
	/** The View forgets this Modal. */
	closed: () => void;
	/** Where focus goes back to once the Modal has closed. */
	returnFocus: () => HTMLElement | null;
};

/** Notes drawn per folder before a "Show more" row; a folder of 10,000 notes builds 200 rows. */
export const VOCABULARY_FOLDER_PAGE = 200;
/** Matching notes drawn while a filter is active, across the whole tree. */
export const VOCABULARY_FILTER_LIMIT = 500;

type FolderEntry = { folder: VocabularyFolder; item: HTMLLIElement };
type MoreEntry = { folder: VocabularyFolder; list: HTMLUListElement; item: HTMLLIElement };

/** What Current Note mode tells the reader: no file in the picker is part of the selection. English identity; shown in the current language. */
export const CURRENT_NOTE_ONLY = EN_MESSAGES.vocabulary.currentOnly;

/**
 * View-owned Vocabulary picker. The Toolbar only shows a summary and opens this.
 *
 * The draft is the View's; this Modal never holds its own copy of the selection,
 * so a filter or a collapsed folder hides a selected note without dropping it,
 * and every selected path — including one no longer in the Vault — stays listed
 * under "Selected notes" with its own Remove control. Only expanded folders have
 * rows, one delegated listener per region serves every row, and paths are only
 * ever written as Text nodes.
 *
 * Current Note does not present that file selection. The tree, the selected-note
 * list and Remove are concealed before they can paint, and they are inert so a
 * keyboard or screen reader cannot operate them. Paths stay on the draft across
 * a mode switch, so Selected Notes can show the same checks again before Apply.
 */

export class VocabularyModal extends Modal {
	private input: VocabularyPickerInput | null;
	private off: (() => void)[] = [];
	/** LOCALE1: the picker's fixed texts, re-applied in place by `relabel()`. */
	private labels = new UiLabels();
	/** Notes the current tree view matches; kept so the tree note can be re-worded. */
	private viewCount = 0;
	private tree: VocabularyFolder | null = null;
	private listed = new Set<string>();
	private expanded = new Set<string>();
	/** While a filter is active every folder starts open; these are the ones the reader closed. */
	private filterCollapsed = new Set<string>();
	private query = "";
	private folderButtons = new WeakMap<HTMLElement, FolderEntry>();
	private moreButtons = new WeakMap<HTMLElement, MoreEntry>();
	private boxes = new WeakMap<HTMLElement, string>();
	private removers = new WeakMap<HTMLElement, string>();
	/** 0.1.0 S3: the weight select of each selected row, by the path it weighs. */
	private weighers = new WeakMap<HTMLElement, string>();
	/** The note checkboxes that currently exist, so a draft change can update them in place. */
	private rendered = new Map<string, HTMLInputElement>();
	private filterRendered = 0;
	private source: HTMLSelectElement | null = null;
	private draw: HTMLSelectElement | null = null;
	private status: HTMLElement | null = null;
	private selectedList: HTMLUListElement | null = null;
	/** One row per selected path, kept in path order and updated in place. */
	private selectedRows = new Map<string, { item: HTMLLIElement; issue: HTMLSpanElement; weight: HTMLSelectElement; remove: HTMLButtonElement }>();
	private selectedEmpty: HTMLLIElement | null = null;
	private selectedPaths: readonly string[] | null = null;
	private selectedIssues = "";
	private filter: HTMLInputElement | null = null;
	private treeRoot: HTMLUListElement | null = null;
	private treeNote: HTMLElement | null = null;
	private applyButton: HTMLButtonElement | null = null;
	/** File-selection regions. Current Note conceals both before they are shown. */
	private selectedSection: HTMLElement | null = null;
	private browseSection: HTMLElement | null = null;
	/** Stays available while an error or progress replaces the idle status sentence. */
	private currentNote: HTMLElement | null = null;

	constructor(app: App, input: VocabularyPickerInput) {
		super(app);
		this.input = input;
	}

	private el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = ""): HTMLElementTagNameMap[K] {
		const element = parent.ownerDocument.createElement(tag);
		if (text) element.textContent = text;
		parent.append(element);
		return element;
	}
	private listen(element: HTMLElement, type: string, handler: (event: Event) => void): void {
		element.addEventListener(type, handler);
		this.off.push(() => element.removeEventListener(type, handler));
	}
	private select(parent: HTMLElement, name: () => string, entries: readonly [string, () => string][]): HTMLSelectElement {
		const label = this.el(parent, "label");
		this.labels.text(label.appendChild(parent.ownerDocument.createTextNode("")), name);
		const select = this.el(label, "select");
		this.labels.attr(select, "aria-label", name);
		for (const [value, text] of entries) {
			const option = this.el(select, "option");
			option.value = value;
			this.labels.text(option, text);
		}
		return select;
	}
	/** An element whose fixed text follows the language. */
	private fixed<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text: () => string): HTMLElementTagNameMap[K] {
		const element = this.el(parent, tag);
		this.labels.text(element, text);
		return element;
	}

	/**
	 * LOCALE1: re-words the open picker in the current language. Rows, the
	 * filter text, expanded folders, the draft and focus stay as they are.
	 */
	relabel(): void {
		if (!this.input) return;
		this.labels.apply();
		const v = ui().vocabulary;
		for (const [path, row] of this.selectedRows) {
			if (row.remove.textContent !== v.remove) row.remove.textContent = v.remove;
			row.remove.setAttribute("aria-label", v.removeName(path));
			row.weight.setAttribute("aria-label", v.weightName(path));
			row.weight.title = v.weight;
		}
		if (this.selectedEmpty) this.selectedEmpty.textContent = v.noneSelected;
		for (const more of Array.from(this.treeRoot?.querySelectorAll<HTMLButtonElement>("button.semantropy-vocabulary-more") ?? [])) {
			const entry = this.moreButtons.get(more);
			if (!entry) continue;
			const shown = entry.list.querySelectorAll(":scope > li.semantropy-vocabulary-note").length;
			more.textContent = this.moreText(entry.folder.notes.length - shown);
		}
		this.writeTreeNote();
		// Issue notes are re-worded by the next render of the selected rows.
		this.selectedPaths = null;
		this.sync();
	}

	onOpen(): void {
		const input = this.input;
		if (!input) return;
		this.labels.bind(() => this.setTitle(ui().vocabulary.title));
		this.modalEl.classList.add("semantropy-vocabulary-modal");
		// A picker always starts from what is applied; an older draft never survives a reopen.
		const state = input.state();
		input.draft(state.selection);
		const paths = input.paths();
		this.listed = new Set(paths);
		this.tree = buildVocabularyTree(paths);

		const controls = this.el(this.contentEl, "div");
		controls.className = "semantropy-vocabulary-controls";
		const v = () => ui().vocabulary;
		this.source = this.select(controls, () => v().source, [["current", () => v().currentNote], ["selected", () => v().selectedNotesMode]]);
		this.draw = this.select(controls, () => v().drawMode, [["uniform", () => v().uniform], ["frequency", () => v().frequency]]);
		for (const select of [this.source, this.draw]) this.listen(select, "change", () => this.changeDraft());

		this.status = this.el(this.contentEl, "p");
		this.status.className = "semantropy-vocabulary-picker-status";
		this.status.setAttribute("role", "status");
		this.status.setAttribute("aria-live", "polite");
		// Concealed before it is inserted, so opening on Current Note never paints the file selection.
		const files = state.selection.mode === "selected";
		// Hidden, but not inert: it is a sentence, and sync shows it when the status line cannot.
		this.currentNote = this.mount(this.contentEl, "p", "", "semantropy-vocabulary-current-note", true);
		this.labels.text(this.currentNote, () => v().currentOnly);
		this.currentNote.removeAttribute("inert");

		// Lists scroll inside this region. Apply and Cancel are appended after it,
		// so a short window shrinks the lists instead of moving the buttons off screen.
		const scroll = this.el(this.contentEl, "div");
		scroll.className = "semantropy-vocabulary-scroll";
		const selected = this.mount(scroll, "section", "", "semantropy-vocabulary-selected", !files);
		this.selectedSection = selected;
		this.labels.attr(selected, "aria-label", () => v().selectedNotes);
		this.fixed(selected, "h3", () => v().selectedNotes);
		this.selectedList = this.el(selected, "ul");
		this.listen(this.selectedList, "click", event => {
			if (!this.filesSelectable()) return;
			const target = event.target instanceof HTMLElement ? event.target.closest("button") : null;
			const path = target ? this.removers.get(target) : undefined;
			if (path === undefined) return;
			this.setPath(path, false);
			// The row is rebuilt; keep the reader in the list rather than losing focus to the body.
			(this.selectedList?.querySelector<HTMLButtonElement>("button") ?? this.filter)?.focus();
		});
		this.listen(this.selectedList, "change", event => {
			if (!this.filesSelectable() || !(event.target instanceof HTMLSelectElement)) return;
			const path = this.weighers.get(event.target);
			const weight = Number(event.target.value);
			if (path === undefined || !isSourceWeight(weight)) return;
			this.changeDraft(this.draftPaths(), { ...this.draftWeights(), [path]: weight });
		});

		const browse = this.mount(scroll, "section", "", "semantropy-vocabulary-browse", !files);
		this.browseSection = browse;
		this.labels.attr(browse, "aria-label", () => v().vaultNotes);
		const filterLabel = this.el(browse, "label");
		this.labels.text(filterLabel.appendChild(browse.ownerDocument.createTextNode("")), () => v().filter);
		this.filter = this.el(filterLabel, "input");
		this.filter.type = "search";
		this.labels.attr(this.filter, "aria-label", () => v().filterName);
		this.listen(this.filter, "input", () => {
			if (!this.filesSelectable()) return;
			this.query = this.filter?.value ?? "";
			this.filterCollapsed.clear();
			this.renderTree();
		});
		this.treeNote = this.el(browse, "p");
		this.treeNote.className = "semantropy-vocabulary-tree-note";
		this.treeRoot = this.el(browse, "ul");
		this.treeRoot.className = "semantropy-vocabulary-tree";
		this.labels.attr(this.treeRoot, "aria-label", () => v().tree);
		this.listen(this.treeRoot, "click", event => this.onTreeClick(event));
		this.listen(this.treeRoot, "change", event => {
			if (!this.filesSelectable()) return;
			const path = event.target instanceof HTMLInputElement ? this.boxes.get(event.target) : undefined;
			if (path !== undefined) this.setPath(path, (event.target as HTMLInputElement).checked);
		});

		const actions = this.el(this.contentEl, "div");
		actions.className = "semantropy-vocabulary-actions";
		this.applyButton = this.fixed(actions, "button", () => v().apply);
		this.applyButton.type = "button";
		this.listen(this.applyButton, "click", () => { void this.runApply(); });
		const cancel = this.fixed(actions, "button", () => ui().common.cancel);
		cancel.type = "button";
		this.listen(cancel, "click", () => this.close());

		this.renderTree();
		this.sync();
		this.source.focus();
	}

	private draftPaths(): readonly string[] {
		return this.input?.state().draft.paths ?? [];
	}

	/** Selected Notes is the only mode whose file tree is a selection. */
	private filesSelectable(): boolean {
		return this.input?.state().draft.mode === "selected";
	}

	/**
	 * Inserts an element that is already concealed when Current Note is active,
	 * so the file selection is never connected while it can paint.
	 */
	private mount<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text: string, className: string, conceal: boolean): HTMLElementTagNameMap[K] {
		const element = parent.ownerDocument.createElement(tag);
		if (text) element.textContent = text;
		if (className) element.className = className;
		// Class and concealment are set before the node is connected, so Current Note never paints the file selection.
		if (conceal) this.conceal(element);
		parent.append(element);
		return element;
	}

	/** `hidden` plus `inert`: not rendered, not in the tab order, and not in the accessibility tree. */
	private conceal(element: HTMLElement): void {
		element.hidden = true;
		element.setAttribute("inert", "");
	}

	private reveal(element: HTMLElement): void {
		element.hidden = false;
		element.removeAttribute("inert");
	}

	/**
	 * Shows or conceals the file selection for the mode the reader just chose.
	 * Called before the draft notification, so a switch to Current Note cannot
	 * paint the previous checks. The draft paths themselves are left alone.
	 */
	private presentFileSelection(show: boolean): void {
		for (const region of [this.selectedSection, this.browseSection]) {
			if (!region) continue;
			if (show) this.reveal(region);
			else this.conceal(region);
			for (const control of Array.from(region.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select"))) control.disabled = !show;
		}
	}

	private changeDraft(paths: readonly string[] = this.draftPaths(), weights: Readonly<Record<string, SourceWeight>> = this.draftWeights()): void {
		const input = this.input;
		if (!input || !this.source || !this.draw) return;
		const mode = this.source.value === "selected" ? "selected" : "current";
		// Conceal first. The draft callback syncs immediately, still in this turn.
		this.presentFileSelection(mode === "selected");
		// Only selected paths keep a weight, and ×1 is the absence of one, so removing a note forgets its weight.
		const kept = Object.fromEntries(paths.flatMap(path => {
			const weight = Object.prototype.hasOwnProperty.call(weights, path) ? weights[path] : undefined;
			return weight !== undefined && weight !== DEFAULT_SOURCE_WEIGHT ? [[path, weight]] : [];
		}));
		input.draft({
			mode,
			drawMode: this.draw.value === "frequency" ? "frequency" : "uniform",
			// A mode switch keeps the Selected Notes paths so they can be restored before Apply.
			paths: [...paths],
			...(Object.keys(kept).length ? { weights: kept } : {}),
		});
		this.sync();
	}

	private draftWeights(): Readonly<Record<string, SourceWeight>> {
		return this.input?.state().draft.weights ?? {};
	}

	private setPath(path: string, on: boolean): void {
		const paths = this.draftPaths().filter(existing => existing !== path);
		if (on) paths.push(path);
		this.changeDraft(paths);
	}

	/**
	 * The View's own `preparing` state disables Apply while one runs; this Modal
	 * keeps no flag of its own, so an Apply the View has already abandoned (a
	 * Source change, a newer Apply) can never keep the button disabled.
	 */
	private async runApply(): Promise<void> {
		const input = this.input;
		if (!input) return;
		const result = await input.apply();
		// A committed Apply closes the picker unless something still needs saying.
		if (result === "applied" && this.input === input && input.state().error === null) this.close();
		else this.sync();
	}

	private isOpenFolder(folder: VocabularyFolder): boolean {
		return this.query.trim() !== "" ? !this.filterCollapsed.has(folder.path) : this.expanded.has(folder.path);
	}

	private renderTree(): void {
		if (!this.treeRoot || !this.tree || !this.treeNote) return;
		this.rendered.clear();
		this.treeRoot.replaceChildren();
		this.filterRendered = 0;
		const view = filterVocabularyTree(this.tree, this.query);
		this.renderChildren(view, this.treeRoot);
		this.viewCount = view.count;
		this.writeTreeNote();
		this.sync();
	}

	private writeTreeNote(): void {
		if (!this.tree || !this.treeNote) return;
		const v = ui().vocabulary;
		const count = this.viewCount;
		const text = this.tree.count === 0 ? v.noNotes
			: this.query.trim() !== "" ? (count === 0 ? v.noMatch
				: count > this.filterRendered ? v.matchShowing(v.notes(count), this.filterRendered)
				: v.matchCount(v.notes(count), count))
			: v.total(v.notes(this.tree.count));
		if (this.treeNote.textContent !== text) this.treeNote.textContent = text;
	}

	private moreText(rest: number): string {
		return ui().vocabulary.showMore(Math.min(rest, VOCABULARY_FOLDER_PAGE), rest);
	}

	private renderChildren(folder: VocabularyFolder, list: HTMLUListElement): void {
		for (const child of folder.folders) {
			const item = this.el(list, "li");
			item.className = "semantropy-vocabulary-folder";
			const toggle = this.el(item, "button");
			toggle.type = "button";
			toggle.className = "semantropy-vocabulary-folder-toggle";
			this.el(toggle, "span", `${child.name}/`);
			this.el(toggle, "span", ` (${child.count})`).className = "semantropy-vocabulary-count";
			toggle.setAttribute("aria-expanded", "false");
			this.folderButtons.set(toggle, { folder: child, item });
			if (this.isOpenFolder(child)) this.expand(child, item, toggle);
		}
		this.renderNotes(folder, list, 0);
	}

	private renderNotes(folder: VocabularyFolder, list: HTMLUListElement, from: number): void {
		const filtering = this.query.trim() !== "";
		let end = Math.min(folder.notes.length, from + VOCABULARY_FOLDER_PAGE);
		if (filtering) end = Math.min(end, from + Math.max(0, VOCABULARY_FILTER_LIMIT - this.filterRendered));
		const draft = new Set(this.draftPaths());
		const disabled = !this.filesSelectable();
		for (let i = from; i < end; i += 1) {
			const path = folder.notes[i]!;
			const item = this.el(list, "li");
			item.className = "semantropy-vocabulary-note";
			const label = this.el(item, "label");
			const box = this.el(label, "input");
			box.type = "checkbox";
			box.checked = draft.has(path);
			box.disabled = disabled;
			this.el(label, "span", vocabularyNoteName(path));
			this.boxes.set(box, path);
			this.rendered.set(path, box);
		}
		if (filtering) this.filterRendered += end - from;
		const rest = folder.notes.length - end;
		if (rest > 0 && !(filtering && this.filterRendered >= VOCABULARY_FILTER_LIMIT)) {
			const item = this.el(list, "li");
			const more = this.el(item, "button", this.moreText(rest));
			more.type = "button";
			more.className = "semantropy-vocabulary-more";
			this.moreButtons.set(more, { folder, list, item });
		}
	}

	private expand(folder: VocabularyFolder, item: HTMLLIElement, toggle: HTMLButtonElement): void {
		toggle.setAttribute("aria-expanded", "true");
		const list = this.el(item, "ul");
		list.setAttribute("aria-label", folder.path);
		this.renderChildren(folder, list);
	}

	private onTreeClick(event: Event): void {
		if (!this.filesSelectable()) return;
		const button = event.target instanceof HTMLElement ? event.target.closest("button") : null;
		if (!button) return;
		const folderEntry = this.folderButtons.get(button);
		if (folderEntry) {
			const { folder, item } = folderEntry;
			const filtering = this.query.trim() !== "";
			if (this.isOpenFolder(folder)) {
				if (filtering) this.filterCollapsed.add(folder.path); else this.expanded.delete(folder.path);
				button.setAttribute("aria-expanded", "false");
				item.querySelector(":scope > ul")?.remove();
				// Rows that no longer exist are forgotten; the draft is untouched.
				for (const [path, box] of this.rendered) if (!box.isConnected) this.rendered.delete(path);
			} else {
				if (filtering) this.filterCollapsed.delete(folder.path); else this.expanded.add(folder.path);
				this.expand(folder, item, button);
			}
			return;
		}
		const more = this.moreButtons.get(button);
		if (more) {
			const shown = more.list.querySelectorAll(":scope > li.semantropy-vocabulary-note").length;
			more.item.remove();
			this.renderNotes(more.folder, more.list, shown);
			// Focus the first new row. A disabled one cannot take it, so fall back to
			// the next Show more row, then to the folder's own toggle.
			const first = more.list.querySelectorAll<HTMLInputElement>(":scope > li.semantropy-vocabulary-note input")[shown];
			const next = more.list.querySelector<HTMLButtonElement>(":scope > li > button.semantropy-vocabulary-more");
			const toggle = more.list.parentElement?.querySelector<HTMLButtonElement>(":scope > button.semantropy-vocabulary-folder-toggle");
			(first && !first.disabled ? first : next ?? toggle ?? this.filter)?.focus();
		}
	}

	/** Re-reads the View's state. Cheap: it touches only rows that exist. */
	sync(): void {
		const input = this.input;
		if (!input || !this.status || !this.source || !this.draw || !this.applyButton || !this.selectedList) return;
		const state = input.state();
		const draft = state.draft;
		const files = draft.mode === "selected";
		// Before any row update, so a Current Note sync cannot leave the tree visible for a frame.
		this.presentFileSelection(files);
		if (this.source.value !== draft.mode) this.source.value = draft.mode;
		if (this.draw.value !== draft.drawMode) this.draw.value = draft.drawMode;
		const currentOnly = ui().vocabulary.currentOnly;
		const idle = files ? ui().vocabulary.selectedCount(draft.paths.length) : currentOnly;
		const status = state.error !== null ? localize(state.error) : state.progress ? ui().status.preparing(state.progress.done, state.progress.total) : idle;
		if (this.status.textContent !== status) this.status.textContent = status;
		// The idle sentence already says it. Keep the sentence on screen when status is an error or progress.
		if (this.currentNote) this.currentNote.hidden = files || status === currentOnly;
		this.applyButton.disabled = !state.ready || state.preparing || (files && !draft.paths.length);
		const chosen = new Set(draft.paths);
		for (const [path, box] of this.rendered) {
			if (box.checked !== chosen.has(path)) box.checked = chosen.has(path);
			if (box.disabled !== !files) box.disabled = !files;
		}
		const issues = JSON.stringify(state.staleSources);
		if (draft.paths !== this.selectedPaths || issues !== this.selectedIssues) {
			this.selectedPaths = draft.paths;
			this.selectedIssues = issues;
			this.renderSelected(this.selectedList, draft.paths, new Map(state.staleSources.map(issue => [issue.path, issue.reason])));
		}
		for (const [path, row] of this.selectedRows) {
			const weight = String(selectionWeight(draft, path));
			if (row.weight.value !== weight) row.weight.value = weight;
		}
	}

	/**
	 * Adds and removes only the rows that changed, so ticking one note costs one
	 * row however many are already selected. Rows stay in path order.
	 */
	private renderSelected(list: HTMLUListElement, paths: readonly string[], stale: ReadonlyMap<string, string>): void {
		const wanted = [...new Set(paths)].sort();
		const keep = new Set(wanted);
		for (const [path, row] of this.selectedRows) if (!keep.has(path)) { row.item.remove(); this.selectedRows.delete(path); }
		if (!wanted.length) {
			this.selectedEmpty ??= this.el(list, "li", ui().vocabulary.noneSelected);
			return;
		}
		this.selectedEmpty?.remove();
		this.selectedEmpty = null;
		let cursor: ChildNode | null = list.firstChild;
		for (const path of wanted) {
			let row = this.selectedRows.get(path);
			if (!row) {
				const item = list.ownerDocument.createElement("li");
				this.el(item, "span", path).className = "semantropy-vocabulary-selected-path";
				const issue = this.el(item, "span");
				issue.className = "semantropy-vocabulary-selected-issue";
				const weight = this.el(item, "select");
				weight.className = "semantropy-vocabulary-weight";
				for (const choice of SOURCE_WEIGHT_CHOICES) {
					const option = this.el(weight, "option", `×${choice}`);
					option.value = String(choice);
				}
				weight.value = String(DEFAULT_SOURCE_WEIGHT);
				weight.disabled = !this.filesSelectable();
				weight.setAttribute("aria-label", ui().vocabulary.weightName(path));
				weight.title = ui().vocabulary.weight;
				this.weighers.set(weight, path);
				const remove = this.el(item, "button", ui().vocabulary.remove);
				remove.type = "button";
				remove.disabled = !this.filesSelectable();
				remove.setAttribute("aria-label", ui().vocabulary.removeName(path));
				this.removers.set(remove, path);
				list.insertBefore(item, cursor);
				row = { item, issue, weight, remove };
				this.selectedRows.set(path, row);
			} else cursor = row.item.nextSibling;
			// The stale reason is a code ("changed" / "missing"); only its label is shown.
			const v = ui().vocabulary;
			const reason = stale.get(path);
			const notes = [!this.listed.has(path) ? v.notFound : "", reason === "changed" ? v.issueChanged : reason === "missing" ? v.issueMissing : ""].filter(Boolean);
			const text = notes.length ? v.issues(notes) : "";
			if (row.issue.textContent !== text) row.issue.textContent = text;
		}
	}

	onClose(): void {
		const input = this.input;
		this.input = null;
		for (const off of this.off) off();
		this.off = [];
		this.labels.clear();
		this.rendered.clear();
		this.selectedRows.clear();
		this.selectedEmpty = null;
		this.contentEl.replaceChildren();
		this.tree = null;
		this.source = this.draw = null;
		this.status = this.treeNote = this.filter = this.currentNote = null;
		this.selectedList = this.treeRoot = null;
		this.selectedSection = this.browseSection = null;
		this.applyButton = null;
		if (!input) return;
		input.cancel();
		input.closed();
		const focus = input.returnFocus();
		if (focus?.isConnected) focus.focus();
	}
}
