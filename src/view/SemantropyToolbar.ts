import {
	BODY_FONT_SIZE_MAX_PX,
	BODY_FONT_SIZE_MIN_PX,
	bodyContrastWarning,
	isBodyTheme,
	normalizeBodyColor,
	type BodyFontFamily,
	type SemantropyDisplaySettings,
} from "../settings/displaySettings";
import { bodySemantropyLabel, type BodySemantropy } from "../settings/bodySemantropy";
import type { SemantropyViewModel } from "./semantropyViewModel";
import type { ToolbarStatusModel } from "./toolbarStatusModel";
import type { ManualSlotDiagnostic } from "../analysis/displaySlots";
import { toManualDiagnosticView } from "./manualDiagnosticModel";
import { iconLabel } from "./controlIcon";
import { planToolbarOverflow } from "./toolbarOverflow";
import type { IconName } from "obsidian";
import { EN_MESSAGES, ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";

/** Fixed string; it never names the value that was refused. */
export const DISPLAY_COLOR_INVALID_MESSAGE = EN_MESSAGES.display.colorInvalid;
export const DISPLAY_SAVE_ERROR_MESSAGE = EN_MESSAGES.display.saveError;
/**
 * The write succeeded but this view could not rebuild its markers, so the
 * setting and the body really do differ. Fixed string: it names no note, no
 * word and no path.
 */
export const MARKER_APPLY_ERROR_MESSAGE = EN_MESSAGES.display.markerApplyError;

/**
 * EXPERIENCE-CONTROLS1: each Toolbar control's short name — its `aria-label`
 * and so its one tooltip — and the longer description reached through
 * `aria-describedby`. Names are short and tell the controls apart; Reshuffle
 * and Refresh differ in name and icon.
 *
 * LOCALE1: the names and descriptions here are the English catalog's; the
 * Toolbar shows `ui().toolbar.controls` in the current language.
 */
const CONTROL_TEXT = EN_MESSAGES.toolbar.controls;
export const TOOLBAR_CONTROLS = {
	reshuffle: { ...CONTROL_TEXT.reshuffle, icon: "dices" },
	refresh: { ...CONTROL_TEXT.refresh, icon: "refresh-cw" },
	copy: { ...CONTROL_TEXT.copy, icon: "copy" },
	collect: { ...CONTROL_TEXT.collect, icon: "inbox" },
	level: { ...CONTROL_TEXT.level, icon: "gauge" },
	automatic: { ...CONTROL_TEXT.automatic, icon: "list-checks" },
	vocabulary: { ...CONTROL_TEXT.vocabulary, icon: "library" },
	collision: { ...CONTROL_TEXT.collision, icon: "blend" },
	fakeProverb: { ...CONTROL_TEXT.fakeProverb, icon: "graduation-cap" },
	recompose: { ...CONTROL_TEXT.recompose, icon: "wand-sparkles" },
	display: { ...CONTROL_TEXT.display, icon: "sliders-horizontal" },
	more: { ...CONTROL_TEXT.more, icon: "ellipsis" },
} as const satisfies Record<keyof typeof CONTROL_TEXT, { name: string; icon: IconName; description: string }>;
export type ToolbarControlKey = keyof typeof TOOLBAR_CONTROLS;

/**
 * The order items leave the row for the More menu when the pane is narrow:
 * the highest rank goes first. The primary actions go last.
 */
const OVERFLOW_RANK: Readonly<Record<Exclude<ToolbarControlKey, "more">, number>> = {
	recompose: 11, fakeProverb: 10, collision: 9, display: 8, automatic: 7, vocabulary: 6, level: 5,
	collect: 4, copy: 3, refresh: 2, reshuffle: 1,
};

let TOOLBAR_SEQUENCE = 0;

export type ToolbarCallbacks = {
	reshuffle: () => void;
	refreshTarget: () => void;
	copy: () => void;
	collect: () => void;
	collision?: () => void;
	fakeProverb?: () => void;
	/** 0.1.0 S5. */
	recompose?: () => void;
	cancelVocabulary: () => void;
	setBodySemantropy: (value: BodySemantropy) => void;
	/** Persist first, then apply. The toolbar never mutates settings itself. */
	setDisplay: (patch: Partial<SemantropyDisplaySettings>) => void;
	resetDisplay: () => void;
	shuffleSelected: () => void;
	restoreSelected: () => void;
	useAutomaticSelected: () => void;
	clearManual: () => void;
};

export type ToolbarInput = ToolbarCallbacks & {
	model: () => SemantropyViewModel;
	status: () => ToolbarStatusModel;
	display: () => SemantropyDisplaySettings;
	/**
	 * Durable display state the view owns: non-null while the body is not
	 * showing a stored setting. It is re-read on every sync, so it survives
	 * opening and closing the menu and clears itself the moment the view
	 * reports the body has caught up.
	 */
	alert: () => string | null;
	/**
	 * The current exact one-token selection, as the view resolves it.
	 *
	 * `diagnostic` is present only while such a selection exists in this view's
	 * committed body; it is read on every sync and never latched, so it cannot
	 * outlive the selection it describes. `selectedShuffleable` comes from the
	 * same diagnostic, so the sentence and the Shuffle control always agree.
	 */
	manual: () => {
		selected: boolean;
		selectedShuffleable: boolean;
		selectedOverridden: boolean;
		count: number;
		diagnostic: ManualSlotDiagnostic | null;
	};
	/**
	 * Where the Vocabulary entry (a Toolbar item) and its one-line summary (in
	 * the status line) mount; the toolbar does not own either.
	 */
	vocabularyHost: (entry: HTMLElement, summary: HTMLElement) => void;
};

type ToolbarItem = { key: Exclude<ToolbarControlKey, "more">; el: HTMLElement; home: HTMLElement; rank: number; width: number };
/**
 * A category of Toolbar items: a small visible label that also names the group
 * (`aria-labelledby`, never an `aria-label`, so Obsidian shows no chip for it),
 * the row of items, and its headed section inside the More menu.
 */
type ToolbarGroup = { el: HTMLElement; label: HTMLElement; items: HTMLElement; name: () => string; labelWidth: number; section: HTMLElement | null; list: HTMLElement | null };
/**
 * One popup in the Toolbar's single open/close model. `close` is set when
 * another owner opens and closes the panel (Automatic parts of speech): the
 * Toolbar then closes it through that owner, so the owner's own state (its
 * draft) is released on every path the Toolbar closes it by.
 */
type ToolbarPopup = { button: HTMLButtonElement; panel: HTMLElement; container: HTMLElement; onClose?: () => void; close?: (restoreFocus: boolean) => void };

/**
 * The fixed Toolbar and the compact status line.
 *
 * It owns no body DOM and no scrolling region: the body scroll container is a
 * sibling created by the view, so scrolling the Target to its end can never
 * take these controls off screen.
 *
 * EXPERIENCE-CONTROLS1: one row of icon-only controls that never wraps. Each
 * control's short name is its `aria-label`, which Obsidian also shows as its
 * one tooltip; no control carries a `title`, and a longer description is a
 * visually hidden element referenced by `aria-describedby`. When the pane is
 * too narrow for the row, `planToolbarOverflow()` picks the items that move —
 * the same elements, never copies, so a control is one focus stop with one
 * state — into the More menu, where they show their names. The Text level,
 * body font and size are behind their own popups; the current level and the
 * Vocabulary summary are in the status line.
 *
 * DOM order is Tab order. No control carries a positive `tabindex`; toggles
 * carry `aria-pressed`, and a collapsed popup is `hidden`, so its items leave
 * the Tab order entirely instead of becoming invisible focus stops. Display
 * settings never reach these controls: their font, size and colours come from
 * Obsidian's own theme variables. Every id is prefixed per Toolbar, so two
 * open Views never share one.
 */
export class SemantropyToolbar {
	readonly root: HTMLElement;
	readonly statusEl: HTMLElement;
	/** Where the View mounts the Automatic parts of speech control. */
	readonly automaticHost: HTMLElement;
	private readonly doc: Document;
	/** Unique per Toolbar: two open Views must not share one element id. */
	private readonly menuId = `semantropy-display-menu-${(TOOLBAR_SEQUENCE += 1)}`;
	private readonly handlers: (() => void)[] = [];
	/** LOCALE1: every fixed text this Toolbar built, re-applied in place on a language change. */
	private readonly labels = new UiLabels();
	/** The adopted Automatic toggle's texts; replaced with the presenter. */
	private automaticLabels = new UiLabels();
	private readonly primary: HTMLElement;
	private readonly textGroup: HTMLElement;
	private readonly settingsGroup: HTMLElement;
	private readonly descriptions: HTMLElement;
	private readonly items: ToolbarItem[] = [];
	private readonly popups: ToolbarPopup[] = [];
	private readonly moreItem: HTMLElement;
	private readonly moreButton: HTMLButtonElement;
	private readonly morePanel: HTMLElement;
	private morePopup: ToolbarPopup | null = null;
	private automaticPopup: ToolbarPopup | null = null;
	/**
	 * Listeners on the current Automatic presenter's toggle and menu. They are
	 * released when a remounted presenter replaces it, so a View that remounts
	 * it many times holds no earlier toggle, menu, presenter or controller.
	 */
	private automaticHandlers: (() => void)[] = [];
	private readonly groups: ToolbarGroup[] = [];
	private descriptionSequence = 0;
	private readonly described = new Set<ToolbarControlKey>();
	private moreWidth = 0;
	private layoutSignature = "";
	private resizeObserver: ResizeObserver | null = null;
	private levelItem: HTMLElement | null = null;
	private levelSelect: HTMLSelectElement | null = null;
	private fontSelect: HTMLSelectElement | null = null;
	private sizeSelect: HTMLSelectElement | null = null;
	private themeSelect: HTMLSelectElement | null = null;
	private menuButton: HTMLButtonElement | null = null;
	private menu: HTMLElement | null = null;
	private displayItem: HTMLElement | null = null;
	private toggles = new Map<keyof SemantropyDisplaySettings, HTMLButtonElement>();
	private colorSelects = new Map<"bodyBackground" | "bodyForeground", HTMLSelectElement>();
	private colorInputs = new Map<"bodyBackground" | "bodyForeground", HTMLInputElement>();
	/**
	 * Colour rows whose reader has chosen Custom but not yet submitted a value.
	 * A stored setting is the authority for what the body shows; this draft is
	 * the authority for what the row offers, so re-syncing the Toolbar — which
	 * any status or message change does — cannot take the field away mid-entry.
	 */
	private colorDrafts = new Set<"bodyBackground" | "bodyForeground">();
	private contrastEl: HTMLElement | null = null;
	private menuMessageEl: HTMLElement | null = null;
	/**
	 * Transient validation feedback for the row being edited — a refused
	 * colour, a write that failed. It belongs to this visit to the menu and is
	 * dropped when the menu closes. Durable state never travels through it.
	 */
	private menuMessage: string | null = null;
	private alertEl: HTMLElement;
	private sourceEl: HTMLElement;
	private levelStatusEl: HTMLElement;
	private replacementsEl: HTMLElement;
	private manualEl: HTMLElement;
	private diagnosticEl: HTMLElement;
	private staleEl: HTMLElement;
	private messageEl: HTMLElement;
	private detailEl: HTMLElement;
	private feedbackEl: HTMLElement;
	private feedbackMessage: string | null = null;
	private cancelButton: HTMLButtonElement;
	private feedbackTimer: number | null = null;
	private reshuffleButton: HTMLButtonElement | null = null;
	private refreshButton: HTMLButtonElement | null = null;
	private copyButton: HTMLButtonElement | null = null;
	private collectButton: HTMLButtonElement | null = null;
	private manualShuffleButton: HTMLButtonElement | null = null;
	private manualRestoreButton: HTMLButtonElement | null = null;
	private manualAutomaticButton: HTMLButtonElement | null = null;
	private manualClearButton: HTMLButtonElement | null = null;

	constructor(parent: HTMLElement, private readonly input: ToolbarInput) {
		this.doc = parent.ownerDocument;
		this.root = this.el("div", "semantropy-toolbar");
		this.root.setAttribute("role", "toolbar");
		parent.appendChild(this.root);

		this.primary = this.group("is-primary", () => ui().toolbar.groups.primary);
		const vocabulary = this.group("is-vocabulary", () => ui().toolbar.groups.vocabulary);
		const generation = this.input.collision || this.input.fakeProverb || this.input.recompose ? this.group("is-generation", () => ui().toolbar.groups.generation) : null;
		// Generation settings sits with Settings at the row's end. More sections follow this same order.
		this.textGroup = this.group("is-text", () => ui().toolbar.groups.text);
		this.settingsGroup = this.group("is-settings", () => ui().toolbar.groups.settings);
		this.moreItem = this.child(this.root, "div", "semantropy-toolbar-more");
		this.descriptions = this.child(this.root, "div", "semantropy-visually-hidden");
		// The Toolbar's name, by reference: an aria-label would put a chip over the whole row.
		const name = this.child(this.descriptions, "div", "semantropy-toolbar-name");
		name.id = `${this.menuId}-name`;
		this.labels.text(name, () => ui().toolbar.name);
		this.root.setAttribute("aria-labelledby", name.id);

		this.statusEl = this.el("div", "semantropy-status");
		parent.appendChild(this.statusEl);
		this.sourceEl = this.child(this.statusEl, "div", "semantropy-meta");
		// The current Text level and the Vocabulary summary are status, not controls.
		this.levelStatusEl = this.child(this.statusEl, "div", "semantropy-meta semantropy-level-status");
		const vocabularySummary = this.child(this.statusEl, "div", "semantropy-status-vocabulary");
		this.replacementsEl = this.child(
			this.statusEl,
			"div",
			"semantropy-meta semantropy-replacements",
		);
		this.manualEl = this.child(this.statusEl, "div", "semantropy-meta semantropy-manual-count");
		// The Manual diagnostic for the selected word. It lives in the status
		// line rather than inside the overflow menu, so the reason a word cannot
		// be shuffled stays readable once the menu is closed. It is a separate
		// element from the manual-change count: one describes the selected word,
		// the other counts the whole loaded Target.
		this.diagnosticEl = this.child(this.statusEl, "div", "semantropy-manual-diagnostic");
		this.diagnosticEl.id = `${this.menuId}-manual-diagnostic`;
		this.diagnosticEl.setAttribute("role", "status");
		this.diagnosticEl.setAttribute("aria-live", "polite");
		this.diagnosticEl.hidden = true;
		this.staleEl = this.child(this.statusEl, "div", "semantropy-stale");
		this.messageEl = this.child(this.statusEl, "div", "semantropy-message");
		this.messageEl.setAttribute("role", "status");
		this.messageEl.setAttribute("aria-live", "polite");
		this.detailEl = this.child(this.statusEl, "div", "semantropy-status-detail");
		this.cancelButton = this.button(
			this.statusEl,
			() => ui().toolbar.cancelVocabulary,
			() => ui().toolbar.cancelVocabularyDescription,
			() => this.input.cancelVocabulary(),
		);
		this.cancelButton.classList.add("semantropy-cancel-vocabulary");
		this.feedbackEl = this.child(this.statusEl, "div", "semantropy-toolbar-feedback");
		this.feedbackEl.setAttribute("role", "status");
		this.feedbackEl.setAttribute("aria-live", "polite");
		// Durable display state lives in the status line, not inside the
		// overflow menu: a reader whose menu is closed — which is every reader
		// whose body was re-marked from another view — must still be told.
		this.alertEl = this.child(this.statusEl, "div", "semantropy-display-alert");
		this.alertEl.id = `${this.menuId}-alert`;
		this.alertEl.setAttribute("role", "status");
		this.alertEl.setAttribute("aria-live", "polite");
		this.alertEl.hidden = true;

		this.buildPrimary();
		this.buildLevel();
		this.automaticHost = this.item("automatic", this.textGroup);
		const vocabularyEntry = this.item("vocabulary", vocabulary);
		this.input.vocabularyHost(vocabularyEntry, vocabularySummary);
		const vocabularyButton = vocabularyEntry.querySelector<HTMLButtonElement>("button");
		if (vocabularyButton) this.describe(vocabularyButton, "vocabulary");
		if (generation && this.input.collision) {
			this.iconButton(this.item("collision", generation), "collision", () => {
				this.closePopups(); this.input.collision?.();
			}, "semantropy-collision-open");
		}
		if (generation && this.input.fakeProverb) {
			this.iconButton(this.item("fakeProverb", generation), "fakeProverb", () => {
				this.closePopups(); this.input.fakeProverb?.();
			}, "semantropy-fake-proverb-open");
		}
		if (generation && this.input.recompose) {
			this.iconButton(this.item("recompose", generation), "recompose", () => {
				this.closePopups(); this.input.recompose?.();
			}, "semantropy-recompose-open");
		}
		this.buildOverflow();

		this.moreButton = this.iconButton(this.moreItem, "more", () => { if (this.morePopup) this.togglePopup(this.morePopup); }, "semantropy-more-button");
		this.morePanel = this.child(this.moreItem, "div", "semantropy-toolbar-popup semantropy-more-menu");
		this.morePanel.id = `${this.menuId}-more`;
		this.morePanel.setAttribute("role", "group");
		this.morePanel.setAttribute("aria-labelledby", this.moreButton.id);
		this.moreItem.hidden = true;
		// One headed section per category, so moved controls stay grouped in More.
		for (const group of this.groups) {
			const section = this.child(this.morePanel, "div", "semantropy-more-section");
			const heading = this.child(section, "div", "semantropy-more-heading");
			heading.id = `${group.label.id}-more`;
			this.labels.text(heading, group.name);
			section.setAttribute("role", "group");
			section.setAttribute("aria-labelledby", heading.id);
			section.hidden = true;
			group.section = section;
			group.list = this.child(section, "div", "semantropy-more-items");
		}
		this.morePopup = { button: this.moreButton, panel: this.morePanel, container: this.moreItem };
		this.addPopup(this.morePopup);

		// An open popup closes on a click outside it. The listener only reads the
		// event's target and never calls preventDefault, so a drag, a
		// double-click or a caret placed in the body behaves exactly as before.
		const onPointerDown = (event: Event) => {
			const target = event.target;
			for (const popup of this.popups) {
				if (popup.panel.hidden) continue;
				if (target instanceof Node && popup.container.contains(target)) continue;
				this.closePopup(popup);
			}
		};
		this.doc.addEventListener("pointerdown", onPointerDown);
		this.handlers.push(() => this.doc.removeEventListener("pointerdown", onPointerDown));
		const Observer = this.doc.defaultView?.ResizeObserver;
		if (Observer) {
			this.resizeObserver = new Observer(() => this.refreshLayout());
			this.resizeObserver.observe(this.root);
		}
		this.sync();
	}

	/** Fixed-string feedback next to the actions; a Notice still carries the same words. */
	announce(message: string): void {
		this.feedbackMessage = message;
		this.feedbackEl.textContent = localize(message);
		const view = this.doc.defaultView;
		if (this.feedbackTimer !== null) view?.clearTimeout(this.feedbackTimer);
		this.feedbackTimer =
			view?.setTimeout(() => {
				this.feedbackMessage = null;
				this.feedbackEl.textContent = "";
				this.feedbackTimer = null;
			}, 4000) ?? null;
	}

	/**
	 * LOCALE1: re-applies every fixed text in the current language, in place.
	 * No element is rebuilt, so focus, open popups, the Custom colour draft and
	 * the typed value stay as they are; the row is then re-planned, because a
	 * category label's width depends on the language.
	 */
	relabel(): void {
		this.labels.apply();
		this.automaticLabels.apply();
		if (this.feedbackMessage !== null) this.feedbackEl.textContent = localize(this.feedbackMessage);
		this.sync();
		this.refreshLayout(true);
	}

	/**
	 * Transient feedback for the menu row in hand. Durable state belongs to
	 * `alert`, which the view owns and this reads on every sync.
	 */
	setMenuMessage(message: string | null): void {
		this.menuMessage = message;
		this.sync();
	}

	isMenuOpen(): boolean {
		return this.menu !== null && !this.menu.hidden;
	}

	closeMenu(restoreFocus = false): void {
		const popup = this.popups.find(p => p.panel === this.menu);
		if (popup && !popup.panel.hidden) this.closePopup(popup, restoreFocus);
	}

	/** Closes every Toolbar popup, the More menu included (a Modal is about to open). */
	closePopups(): void {
		for (const popup of this.popups) if (!popup.panel.hidden) this.closePopup(popup);
	}

	/**
	 * Where focus can go back to for a control that opened a Modal: the control
	 * itself when it is on screen, or the More button while the control sits in
	 * a closed More menu.
	 */
	returnTarget(element: HTMLElement | null): HTMLElement | null {
		if (!element || !element.isConnected) return element;
		if (this.morePanel.contains(element) && this.morePanel.hidden) return this.moreButton;
		return element;
	}

	/**
	 * The View mounts the Automatic parts of speech control into
	 * `automaticHost`; this gives its toggle the Toolbar's icon, name and
	 * description and makes its options a Toolbar popup. The presenter still
	 * opens the menu; `close` is the presenter's own close, so Escape (the
	 * innermost popup only), closing the More menu around it, opening another
	 * popup and a layout change all close it — and discard its draft — the
	 * way every other Toolbar popup is closed.
	 */
	adoptAutomatic(toggle: HTMLButtonElement, menu: HTMLElement, close: (restoreFocus: boolean) => void): void {
		toggle.classList.add("semantropy-action", "is-toolbar-icon");
		// A remounted presenter's toggle replaces the previous one's texts.
		this.automaticLabels = new UiLabels();
		this.controlText(toggle, "automatic", this.automaticLabels);
		toggle.id = `${this.menuId}-control-automatic`;
		this.describe(toggle, "automatic");
		menu.classList.add("semantropy-toolbar-popup");
		// Containers are named by reference, not by aria-label, so only the toggle shows a chip.
		for (const container of [toggle.parentElement, menu]) {
			if (!container || container === this.automaticHost) continue;
			container.removeAttribute("aria-label");
			container.setAttribute("aria-labelledby", toggle.id);
		}
		// A remounted presenter replaces the previous one: its entry and every
		// listener the Toolbar put on its toggle and menu are released.
		if (this.automaticPopup) this.popups.splice(this.popups.indexOf(this.automaticPopup), 1);
		for (const off of this.automaticHandlers.splice(0)) off();
		this.automaticPopup = { button: toggle, panel: menu, container: this.automaticHost, close };
		this.addPopup(this.automaticPopup, this.automaticHandlers);
		// The presenter opens its own menu; the Toolbar only places it and closes the others.
		const onClick = () => {
			if (menu.hidden) return;
			for (const popup of this.popups) if (!popup.panel.hidden && !popup.panel.contains(menu)) this.closePopup(popup);
			this.alignPopup(menu, toggle);
		};
		this.listen(toggle, "click", onClick, this.automaticHandlers);
		this.layoutSignature = "";
		this.refreshLayout();
	}

	dispose(): void {
		if (this.feedbackTimer !== null) {
			this.doc.defaultView?.clearTimeout(this.feedbackTimer);
			this.feedbackTimer = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		for (const off of this.automaticHandlers.splice(0)) off();
		this.automaticPopup = null;
		for (const off of this.handlers) off();
		this.handlers.length = 0;
		this.labels.clear();
		this.automaticLabels.clear();
	}

	sync(): void {
		const model = this.input.model();
		const status = this.input.status();
		const display = this.input.display();
		const manual = this.input.manual();

		this.setVisible(this.reshuffleButton, model.showReshuffle, !model.reshuffleEnabled);
		this.setVisible(this.refreshButton, model.showRefresh, !model.refreshEnabled);
		this.setVisible(this.copyButton, model.showCopy, !model.copyEnabled);
		this.setVisible(this.collectButton, model.showCollect, !model.collectEnabled);
		// Shuffle needs an alternative, not merely an eligible word: a slot whose
		// Vocabulary offers nothing else keeps the control disabled and says why.
		const diagnostic = toManualDiagnosticView(manual.diagnostic);
		if (this.manualShuffleButton) this.manualShuffleButton.disabled = !manual.selectedShuffleable;
		if (this.manualRestoreButton) this.manualRestoreButton.disabled = !manual.selected;
		if (this.manualAutomaticButton) this.manualAutomaticButton.disabled = !manual.selectedOverridden;
		if (this.manualClearButton) this.manualClearButton.disabled = manual.count === 0;
		// This row is an aria-live region and `sync()` runs on every
		// selectionchange, pointerup, keyup and status change. Writing the same
		// sentence again replaces the Text node, which a screen reader may announce
		// a second time, so the DOM is touched only when something really changed.
		const message = diagnostic === null ? "" : localize(diagnostic.message);
		const state = diagnostic === null ? null : diagnostic.available ? "available" : "unavailable";
		if (this.diagnosticEl.textContent !== message) this.diagnosticEl.textContent = message;
		if (this.diagnosticEl.hidden !== (diagnostic === null)) this.diagnosticEl.hidden = diagnostic === null;
		// State is carried by the words; the attribute only lets a theme reinforce it.
		if ((this.diagnosticEl.dataset["manual"] ?? null) !== state) {
			if (state === null) delete this.diagnosticEl.dataset["manual"];
			else this.diagnosticEl.dataset["manual"] = state;
		}
		// Never describe a control from a hidden subtree: the status line is the
		// visible owner of this sentence, and the reference goes with it.
		const describedBy = diagnostic === null ? null : this.diagnosticEl.id;
		if (this.manualShuffleButton && this.manualShuffleButton.getAttribute("aria-describedby") !== describedBy) {
			if (describedBy === null) this.manualShuffleButton.removeAttribute("aria-describedby");
			else this.manualShuffleButton.setAttribute("aria-describedby", describedBy);
		}

		if (this.levelSelect && this.levelItem) {
			this.levelItem.hidden = !model.showLevelControl;
			if (this.levelItem.hidden) this.closePopup(this.popupFor(this.levelItem));
			this.levelSelect.disabled = !model.levelControlEnabled;
			const value = String(model.bodySemantropy);
			if (
				model.bodySemantropy !== null &&
				model.levelControlEnabled &&
				this.levelSelect.value !== value
			) {
				this.levelSelect.value = value;
			}
		}
		const level = model.showLevelControl && model.bodySemantropy !== null
			? ui().toolbar.levelStatus(localize(model.levelChoices?.find(choice => choice.value === model.bodySemantropy)?.label ?? bodySemantropyLabel(model.bodySemantropy)))
			: null;
		if (this.levelStatusEl.textContent !== (level ?? "")) this.levelStatusEl.textContent = level ?? "";
		this.levelStatusEl.hidden = level === null;
		// Pure display settings stay usable while the body is busy.
		if (this.fontSelect) this.fontSelect.value = display.bodyFontFamily;
		if (this.sizeSelect)
			this.sizeSelect.value =
				display.bodyFontSizePx === null ? "" : String(display.bodyFontSizePx);
		if (this.themeSelect) this.themeSelect.value = display.bodyTheme;
		for (const [key, button] of this.toggles) {
			const on = display[key] === true;
			button.setAttribute("aria-pressed", on ? "true" : "false");
			button.classList.toggle("is-on", on);
		}
		for (const [key, select] of this.colorSelects) {
			const value = display[key];
			// 0.1.0 S2: a colour is either the theme's or a custom one; there are no presets.
			const custom = this.colorDrafts.has(key) || value !== null;
			select.value = custom ? "custom" : value === null ? "" : value;
			const field = this.colorInputs.get(key);
			if (field) {
				field.disabled = !custom;
				// 0.1.0 (owner report): the field takes a row only for Custom, so Display settings fits a phone.
				field.hidden = !custom;
				if (custom && field.value.trim() === "" && value !== null) {
					field.value = value;
				}
			}
		}
		if (this.contrastEl) {
			const warning = localize(bodyContrastWarning(display) ?? "");
			if (this.contrastEl.textContent !== warning) this.contrastEl.textContent = warning;
		}
		if (this.menuMessageEl) this.menuMessageEl.textContent = localize(this.menuMessage ?? "");
		// Derived, never latched: the view is the authority both for raising
		// this and for clearing it once the body has caught up.
		const alert = this.input.alert();
		this.alertEl.textContent = localize(alert ?? "");
		this.alertEl.hidden = alert === null;
		if (this.menuButton) {
			this.menuButton.classList.toggle("is-error", alert !== null);
			const description = `${this.menuId}-desc-display`;
			this.menuButton.setAttribute("aria-describedby", alert === null ? description : `${description} ${this.alertEl.id}`);
		}

		this.sourceEl.textContent = status.sourceLabel ?? "";
		this.sourceEl.hidden = status.sourceLabel === null;
		this.replacementsEl.textContent = status.replacementLabel ?? "";
		this.replacementsEl.hidden = status.replacementLabel === null;
		this.manualEl.textContent = manual.count > 0 ? ui().toolbar.manualChanges(manual.count) : "";
		this.manualEl.hidden = manual.count === 0;
		const stale =
			status.kind === "target-stale" || status.kind === "vocabulary-stale";
		// Status sentences are English message identities; they are shown in the current language.
		const statusMessage = localize(status.message ?? "");
		const statusDetail = localize(status.detail ?? "");
		this.staleEl.textContent = stale ? statusMessage : "";
		this.staleEl.classList.toggle("is-stale", stale);
		this.staleEl.hidden = !stale;
		this.messageEl.textContent = stale ? statusDetail : statusMessage;
		this.detailEl.textContent = stale ? "" : statusDetail;
		this.detailEl.hidden = this.detailEl.textContent === "";
		this.cancelButton.hidden = !status.showCancelVocabulary;
		this.statusEl.dataset["state"] = status.kind;
		this.refreshLayout(false);
	}

	/**
	 * Re-plans which items fit the row. It reads layout, so it runs on a resize
	 * and when an item appears or disappears, never on every selection sync.
	 */
	refreshLayout(force = true): void {
		for (const item of this.items) {
			const control = item.el.querySelector<HTMLElement>("button");
			if (item.key !== "level" && item.key !== "display") item.el.hidden = !control || control.hidden;
		}
		const signature = this.items.map(item => (item.el.hidden ? "0" : "1")).join("");
		if (!force && signature === this.layoutSignature) return;
		this.layoutSignature = signature;
		const view = this.doc.defaultView;
		const px = (value: string | undefined) => { const n = Number.parseFloat(value ?? ""); return Number.isFinite(n) ? n : 0; };
		const rootStyle = view?.getComputedStyle(this.root);
		const groupStyle = view?.getComputedStyle(this.primary);
		// A group is as wide as its label when the label is wider than its items;
		// a label the narrow-pane rule hides takes no room.
		for (const group of this.groups) {
			// A fully overflowed group is hidden. Measure its new language too,
			// otherwise its former label width can keep More open indefinitely.
			const wasHidden = group.el.hidden;
			if (wasHidden) group.el.hidden = false;
			const hiddenLabel = view?.getComputedStyle(group.label).display === "none";
			group.labelWidth = hiddenLabel ? 0 : group.label.getBoundingClientRect().width;
			if (wasHidden) group.el.hidden = true;
		}
		const groupBox = (group: ToolbarGroup) => {
			const style = view?.getComputedStyle(group.el);
			return px(style?.paddingLeft) + px(style?.paddingRight) + px(style?.borderLeftWidth) + px(style?.borderRightWidth);
		};
		for (const item of this.items) {
			if (item.el.parentElement === item.home && !item.el.hidden) {
				const width = item.el.getBoundingClientRect().width;
				if (width > 0) item.width = width;
			}
		}
		if (!this.moreItem.hidden) {
			const width = this.moreItem.getBoundingClientRect().width;
			if (width > 0) this.moreWidth = width;
		}
		const fallback = this.items.find(item => item.width > 0)?.width ?? 0;
		const homes = this.groups.map(group => group.items);
		const moved = new Set(planToolbarOverflow({
			available: this.root.clientWidth - px(rootStyle?.paddingLeft) - px(rootStyle?.paddingRight),
			groupGap: px(rootStyle?.columnGap),
			itemGap: px(groupStyle?.columnGap),
			moreWidth: this.moreWidth || fallback,
			items: this.items.map(item => ({ group: homes.indexOf(item.home), width: item.width, rank: item.rank, visible: !item.el.hidden })),
			groups: this.groups.map(group => ({ min: group.labelWidth, extra: groupBox(group) })),
		}).map(index => this.items[index]!));
		// Keep the contents of an open More menu until the user closes it.
		// The newly fitting controls return to the row on that close.
		if (this.morePopup && !this.morePopup.panel.hidden) {
			for (const item of this.items) if (item.el.parentElement !== item.home) moved.add(item);
		}
		this.place(moved);
	}

	private place(moved: ReadonlySet<ToolbarItem>): void {
		const active = this.doc.activeElement;
		const focusedControl = active instanceof HTMLElement && this.root.contains(active) ? active : null;
		const focusedItem = this.items.find(item => focusedControl && item.el.contains(focusedControl));
		const focusWasInMore = focusedControl !== null && this.moreItem.contains(focusedControl);
		const openPopups = this.popups.filter(popup => !popup.panel.hidden);
		let changed = false;
		const arrange = (container: HTMLElement, wanted: HTMLElement[]) => {
			const current = Array.from(container.children);
			if (current.length === wanted.length && current.every((child, i) => child === wanted[i])) return;
			container.append(...wanted);
			changed = true;
		};
		for (const group of this.groups) {
			const home = this.items.filter(item => item.home === group.items && !moved.has(item)).map(item => item.el);
			const away = this.items.filter(item => item.home === group.items && moved.has(item)).map(item => item.el);
			arrange(group.items, home);
			if (group.list) arrange(group.list, away);
			// A category with nothing left in the row takes no room; one with nothing in More shows no heading.
			if (group.el.hidden !== (home.length === 0)) group.el.hidden = home.length === 0;
			if (group.section && group.section.hidden !== (away.length === 0)) group.section.hidden = away.length === 0;
		}
		this.moreItem.hidden = moved.size === 0;
		if (!changed) return;
		// A language change can move an open control between the row and More.
		// Keep the same popup and draft; only its anchor and focus need updating.
		if (!this.moreItem.hidden && openPopups.some(popup => popup !== this.morePopup && this.morePanel.contains(popup.panel))) {
			this.morePanel.hidden = false;
			this.moreButton.setAttribute("aria-expanded", "true");
		}
		for (const popup of openPopups) {
			if (!popup.panel.hidden) this.alignPopup(popup.panel, popup.button);
		}
		// DOM reparenting drops focus even when the very same input survives.
		if (this.moreItem.hidden && focusWasInMore) {
			const target = focusedItem?.el.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
				this.items.map(item => !item.el.hidden && item.el.parentElement === item.home ?
					item.el.querySelector<HTMLButtonElement>("button:not(:disabled)") : null).find(button => button && !button.hidden);
			target?.focus({ preventScroll: true });
		} else if (focusedItem && moved.has(focusedItem) && this.morePanel.hidden &&
			!openPopups.some(popup => popup.container === focusedItem.el)) this.moreButton.focus({ preventScroll: true });
		else if (focusedControl?.isConnected && this.doc.activeElement !== focusedControl) focusedControl.focus({ preventScroll: true });
	}

	private buildPrimary(): void {
		this.reshuffleButton = this.iconButton(this.item("reshuffle", this.primary), "reshuffle", () => this.input.reshuffle(), "semantropy-reshuffle");
		this.refreshButton = this.iconButton(this.item("refresh", this.primary), "refresh", () => this.input.refreshTarget(), "semantropy-refresh");
		this.copyButton = this.iconButton(this.item("copy", this.primary), "copy", () => this.input.copy(), "semantropy-copy");
		this.collectButton = this.iconButton(this.item("collect", this.primary), "collect", () => this.input.collect(), "semantropy-collect");
	}

	private buildLevel(): void {
		const model = this.input.model();
		const item = this.item("level", this.textGroup);
		this.levelItem = item;
		const button = this.iconButton(item, "level", () => this.togglePopup(this.popupFor(item)), "semantropy-level-button");
		const panel = this.child(item, "div", "semantropy-toolbar-popup semantropy-level-popup");
		panel.id = `${this.menuId}-level`;
		panel.setAttribute("role", "group");
		panel.setAttribute("aria-labelledby", button.id);
		panel.hidden = true;
		const levelLabel = this.child(panel, "label", "semantropy-level-label");
		this.labels.text(levelLabel.appendChild(this.doc.createTextNode("")), () => ui().toolbar.levelLabel);
		const level = this.doc.createElement("select");
		level.className = "semantropy-level-select";
		this.labels.attr(level, "aria-label", () => ui().toolbar.controls.level.name);
		level.setAttribute("aria-describedby", `${this.menuId}-desc-level`);
		for (const choice of model.levelChoices ?? defaultLevelChoices()) {
			const option = this.doc.createElement("option");
			option.value = String(choice.value);
			this.labels.text(option, () => localize(choice.label));
			level.appendChild(option);
		}
		levelLabel.appendChild(level);
		this.levelSelect = level;
		this.listen(level, "change", () => {
			const raw = Number(level.value);
			if (Number.isInteger(raw)) this.input.setBodySemantropy(raw as BodySemantropy);
		});
		this.addPopup({ button, panel, container: item });
	}

	private buildOverflow(): void {
		const item = this.item("display", this.settingsGroup);
		this.displayItem = item;
		const button = this.iconButton(item, "display", () => this.togglePopup(this.popupFor(item)), "semantropy-display-menu-button");
		this.menuButton = button;

		const menu = this.child(item, "div", "semantropy-toolbar-popup semantropy-display-menu");
		menu.id = this.menuId;
		menu.setAttribute("role", "group");
		menu.setAttribute("aria-labelledby", button.id);
		// Hidden collapses the subtree, so nothing inside stays a focus stop.
		menu.hidden = true;
		this.menu = menu;
		this.addPopup({
			button, panel: menu, container: item,
			// One way to close, whichever control does it: the transient row
			// message and any unsubmitted Custom draft go with it.
			onClose: () => { this.colorDrafts.clear(); this.setMenuMessage(null); },
		});

		// Body font and size moved here from the Toolbar row.
		const themeDefault = () => ui().display.themeDefault;
		this.fontSelect = this.select(
			this.child(menu, "div", "semantropy-display-row"),
			() => ui().display.font,
			() => ui().display.fontName,
			"semantropy-font-family",
			[
				["theme", themeDefault],
				["serif", () => ui().display.serif],
				["sans-serif", () => ui().display.sansSerif],
			],
			(value) => this.input.setDisplay({ bodyFontFamily: value as BodyFontFamily }),
		);
		const sizes: [string, () => string][] = [["", themeDefault]];
		for (let px = BODY_FONT_SIZE_MIN_PX; px <= BODY_FONT_SIZE_MAX_PX; px += 1) {
			sizes.push([String(px), () => ui().display.px(px)]);
		}
		this.sizeSelect = this.select(
			this.child(menu, "div", "semantropy-display-row"),
			() => ui().display.size,
			() => ui().display.sizeName,
			"semantropy-font-size",
			sizes,
			(value) =>
				this.input.setDisplay({
					bodyFontSizePx: value === "" ? null : Number(value),
				}),
		);
		// 0.1.0 S2: one theme for text and background together, then optional custom colours.
		this.themeSelect = this.select(
			this.child(menu, "div", "semantropy-display-row"),
			() => ui().display.rowLabel(ui().display.theme),
			() => ui().display.theme,
			"semantropy-body-theme",
			[
				["default", () => ui().display.themeDefaultOption],
				["light", () => ui().display.themeLight],
				["dark", () => ui().display.themeDark],
			],
			(value) => { if (isBodyTheme(value)) this.input.setDisplay({ bodyTheme: value }); },
		);
		this.colorRow(menu, "bodyForeground", () => ui().display.foreground, []);
		this.colorRow(menu, "bodyBackground", () => ui().display.background, []);
		this.contrastEl = this.child(menu, "div", "semantropy-contrast-warning");
		this.contrastEl.setAttribute("role", "status");

		const d = () => ui().display;
		// 0.1.0 (owner report): the four switches sit two per row.
		const toggles = this.child(menu, "div", "semantropy-display-toggles");
		this.toggle(toggles, "showRuby", () => d().ruby, () => d().rubyDescription);
		this.toggle(toggles, "showReplacementMarkers", () => d().replacementMarker, () => d().replacementMarkerDescription);
		this.toggle(toggles, "showManualMarkers", () => d().manualMarker, () => d().manualMarkerDescription);
		this.toggle(toggles, "showDictionaryMarkers", () => d().dictionaryMarker, () => d().dictionaryMarkerDescription);
		this.button(menu, () => d().reset, () => d().resetDescription, () => this.input.resetDisplay(), "semantropy-display-reset");
		this.manualShuffleButton = this.button(menu, () => d().shuffleSelected, null, () => this.input.shuffleSelected(), "semantropy-manual-shuffle-selected");
		this.manualRestoreButton = this.button(menu, () => d().restoreSelected, null, () => this.input.restoreSelected(), "semantropy-manual-restore-selected");
		this.manualAutomaticButton = this.button(menu, () => d().useAutomaticSelected, () => d().useAutomaticSelectedDescription, () => this.input.useAutomaticSelected(), "semantropy-manual-automatic-selected");
		this.manualClearButton = this.button(menu, () => d().clearManual, () => d().clearManualDescription, () => this.input.clearManual(), "semantropy-manual-clear");
		this.menuMessageEl = this.child(menu, "div", "semantropy-display-message");
		this.menuMessageEl.setAttribute("role", "status");
	}

	private colorRow(
		parent: HTMLElement,
		key: "bodyBackground" | "bodyForeground",
		label: () => string,
		presets: readonly string[],
	): void {
		const row = this.child(parent, "div", "semantropy-display-row");
		const options: [string, () => string][] = [["", () => ui().display.themeDefault]];
		for (const preset of presets) options.push([preset, () => preset]);
		options.push(["custom", () => ui().display.custom]);
		const select = this.select(row, () => ui().display.rowLabel(label()), label, `semantropy-color-${key}`, options, (value) => {
			if (value === "custom") {
				// Nothing is stored yet: the row stays on Custom until a valid
				// value is submitted or the reader leaves it.
				this.colorDrafts.add(key);
				this.setMenuMessage(null);
				const field = this.colorInputs.get(key);
				if (field) { field.hidden = false; field.disabled = false; field.focus(); }
				return;
			}
			this.colorDrafts.delete(key);
			this.input.setDisplay({ [key]: value === "" ? null : value });
		});
		this.colorSelects.set(key, select);

		const field = this.doc.createElement("input");
		field.type = "text";
		field.className = `semantropy-color-input semantropy-color-input-${key}`;
		// The accepted form is stated in the accessible name, which Obsidian also
		// shows as the one tooltip, rather than a placeholder, so the hint reaches
		// a screen reader as well as the eye.
		this.labels.attr(field, "aria-label", () => ui().display.hexName(label()));
		field.disabled = true;
		field.hidden = true;
		row.appendChild(field);
		this.colorInputs.set(key, field);
		this.listen(field, "change", () => {
			const color = normalizeBodyColor(field.value.trim());
			if (color === undefined) {
				// A refused value keeps the row on Custom so it can be corrected.
				this.setMenuMessage(DISPLAY_COLOR_INVALID_MESSAGE);
				return;
			}
			this.colorDrafts.delete(key);
			this.setMenuMessage(null);
			this.input.setDisplay({ [key]: color });
		});
	}

	private toggle(
		parent: HTMLElement,
		key: keyof SemantropyDisplaySettings,
		label: () => string,
		description: () => string,
	): void {
		const button = this.button(parent, label, description, () => {
			this.input.setDisplay({ [key]: this.input.display()[key] !== true });
		});
		button.classList.add("semantropy-display-toggle", `semantropy-toggle-${key}`);
		button.setAttribute("aria-pressed", "false");
		this.toggles.set(key, button);
	}

	private addPopup(popup: ToolbarPopup, owner: (() => void)[] = this.handlers): void {
		popup.button.setAttribute("aria-expanded", "false");
		popup.button.setAttribute("aria-haspopup", "true");
		popup.button.setAttribute("aria-controls", popup.panel.id);
		popup.panel.hidden = true;
		this.popups.push(popup);
		this.listen(popup.panel, "keydown", (event) => {
			if ((event as KeyboardEvent).key !== "Escape") return;
			// The innermost popup takes Escape; the More menu around it stays open.
			event.preventDefault();
			event.stopPropagation();
			this.closePopup(popup, true);
		}, owner);
		this.listen(popup.button, "keydown", (event) => {
			if ((event as KeyboardEvent).key === "Escape" && !popup.panel.hidden) {
				event.preventDefault();
				event.stopPropagation();
				this.closePopup(popup, true);
			}
		}, owner);
	}

	private popupFor(container: HTMLElement): ToolbarPopup {
		return this.popups.find(popup => popup.container === container)!;
	}

	private togglePopup(popup: ToolbarPopup): void {
		if (!popup.panel.hidden) {
			this.closePopup(popup);
			return;
		}
		// Opening one popup closes the others, except the More menu it sits in.
		for (const other of this.popups) {
			if (other !== popup && !other.panel.hidden && !other.panel.contains(popup.panel)) this.closePopup(other);
		}
		popup.panel.hidden = false;
		popup.button.setAttribute("aria-expanded", "true");
		this.sync();
		this.alignPopup(popup.panel, popup.button);
		popup.panel.querySelector<HTMLElement>("select:not(:disabled),button:not(:disabled),input:not(:disabled)")?.focus();
	}

	private closePopup(popup: ToolbarPopup | undefined, restoreFocus = false): void {
		if (!popup || popup.panel.hidden) return;
		// Popups inside the one closing close with it.
		for (const inner of this.popups) if (inner !== popup && popup.panel.contains(inner.panel)) this.closePopup(inner);
		if (popup.close) popup.close(false);
		else {
			popup.panel.hidden = true;
			popup.button.setAttribute("aria-expanded", "false");
		}
		popup.onClose?.();
		if (restoreFocus) this.returnTarget(popup.button)?.focus();
		if (popup === this.morePopup) this.refreshLayout(true);
	}

	/**
	 * Places a row popup under the Toolbar, starting at its button and kept
	 * inside the Toolbar's width. Inside the More menu a popup flows in place.
	 */
	private alignPopup(panel: HTMLElement, anchor: HTMLElement): void {
		if (panel.hidden || this.morePanel.contains(panel) && panel !== this.morePanel) {
			panel.style.removeProperty("left");
			// A popup inside More scrolls with More, so More is what has to fit.
			if (!this.morePanel.hidden) {
				this.fitPopupHeight(this.morePanel);
				if (panel !== this.morePanel && !panel.hidden) this.revealInMore(panel);
			}
			return;
		}
		const root = this.root.getBoundingClientRect();
		const left = anchor.getBoundingClientRect().left - root.left;
		const room = Math.max(0, this.root.clientWidth - panel.offsetWidth);
		panel.style.left = `${Math.round(Math.min(Math.max(0, left), room))}px`;
		this.fitPopupHeight(panel);
	}

	/**
	 * 0.1.0 S1: an open popup never reaches past the bottom of the View (or the
	 * window), where the View's own clipping would hide its last controls; it
	 * scrolls inside that height instead.
	 */
	private fitPopupHeight(panel: HTMLElement): void {
		const view = this.root.parentElement;
		if (!view || panel.hidden) return;
		const bounds = view.getBoundingClientRect();
		// A layout-less document (no rendering) has nothing to fit.
		if (bounds.height === 0) return;
		const windowBottom = this.root.ownerDocument.defaultView?.innerHeight ?? bounds.bottom;
		const bottom = Math.min(bounds.bottom, windowBottom);
		const room = Math.max(96, Math.floor(bottom - panel.getBoundingClientRect().top - 8));
		// 0.1.0 (owner report): no fixed cap, so a tall phone screen shows the whole Display settings.
		panel.style.setProperty("max-height", `${room}px`);
	}

	/**
	 * 0.1.0: a popup opened inside More (Display settings on a narrow pane) is
	 * scrolled into More's visible area — just far enough to show its end,
	 * never past its start.
	 */
	private revealInMore(panel: HTMLElement): void {
		const more = this.morePanel.getBoundingClientRect(), inner = panel.getBoundingClientRect();
		if (inner.bottom <= more.bottom) return;
		this.morePanel.scrollTop += Math.max(0, Math.min(inner.bottom - more.bottom + 4, inner.top - more.top - 4));
	}

	private setVisible(
		element: HTMLButtonElement | null,
		visible: boolean,
		disabled: boolean,
	): void {
		if (!element) return;
		element.hidden = !visible;
		element.disabled = disabled;
	}

	/** A category: returns the row its items live in. */
	private group(cls: string, name: () => string): HTMLElement {
		const element = this.child(this.root, "div", `semantropy-toolbar-group ${cls}`);
		element.setAttribute("role", "group");
		const label = this.child(element, "div", "semantropy-toolbar-group-label");
		label.id = `${this.menuId}-group-${cls}`;
		this.labels.text(label, name);
		element.setAttribute("aria-labelledby", label.id);
		const items = this.child(element, "div", "semantropy-toolbar-items");
		this.groups.push({ el: element, label, items, name, labelWidth: 0, section: null, list: null });
		return items;
	}

	private item(key: Exclude<ToolbarControlKey, "more">, home: HTMLElement): HTMLElement {
		const el = this.child(home, "div", `semantropy-toolbar-item is-${key}`);
		this.items.push({ key, el, home, rank: OVERFLOW_RANK[key], width: 0 });
		return el;
	}

	/** An icon-only Toolbar control: short name as `aria-label`, long text as its description. */
	private iconButton(parent: HTMLElement, key: ToolbarControlKey, onClick: () => void, cls: string): HTMLButtonElement {
		const button = this.doc.createElement("button");
		button.type = "button";
		button.className = `semantropy-action ${cls} is-toolbar-icon`;
		button.id = `${this.menuId}-control-${key}`;
		this.controlText(button, key, this.labels);
		this.describe(button, key);
		parent.appendChild(button);
		this.listen(button, "click", onClick);
		return button;
	}

	/** A control's icon, its label (shown in More) and its accessible name, in the current language. */
	private controlText(button: HTMLElement, key: ToolbarControlKey, labels: UiLabels): void {
		const name = () => ui().toolbar.controls[key].name;
		iconLabel(button, TOOLBAR_CONTROLS[key].icon, name());
		const label = button.querySelector<HTMLElement>(".semantropy-action-label");
		if (label) labels.text(label, name);
		labels.attr(button, "aria-label", name);
	}

	private describe(button: HTMLElement, key: ToolbarControlKey): void {
		const id = `${this.menuId}-desc-${key}`;
		if (!this.described.has(key)) {
			this.described.add(key);
			const description = this.child(this.descriptions, "div", "semantropy-control-description");
			description.id = id;
			this.labels.text(description, () => ui().toolbar.controls[key].description);
		}
		button.setAttribute("aria-describedby", id);
	}

	private select(
		parent: HTMLElement,
		labelText: () => string,
		ariaLabel: () => string,
		cls: string,
		options: readonly [string, () => string][],
		onChange: (value: string) => void,
	): HTMLSelectElement {
		const label = this.child(parent, "label", "semantropy-display-label");
		this.labels.text(label.appendChild(this.doc.createTextNode("")), labelText);
		const select = this.doc.createElement("select");
		select.className = cls;
		this.labels.attr(select, "aria-label", ariaLabel);
		for (const [value, text] of options) {
			const option = this.doc.createElement("option");
			option.value = value;
			this.labels.text(option, text);
			select.appendChild(option);
		}
		label.appendChild(select);
		this.listen(select, "change", () => onChange(select.value));
		return select;
	}

	private button(
		parent: HTMLElement,
		text: () => string,
		description: (() => string) | null,
		onClick: () => void,
		cls?: string,
	): HTMLButtonElement {
		const button = this.doc.createElement("button");
		button.type = "button";
		button.className = cls ? `semantropy-action ${cls}` : "semantropy-action";
		this.labels.text(button, text);
		// The visible text is the name and the one chip; a longer text is a description.
		this.labels.attr(button, "aria-label", text);
		if (description !== null) {
			const note = this.child(this.descriptions, "div", "semantropy-control-description");
			note.id = `${this.menuId}-note-${(this.descriptionSequence += 1)}`;
			this.labels.text(note, description);
			button.setAttribute("aria-describedby", note.id);
		}
		parent.appendChild(button);
		this.listen(button, "click", onClick);
		return button;
	}

	private child(parent: HTMLElement, tag: string, cls: string): HTMLElement {
		const element = this.el(tag, cls);
		parent.appendChild(element);
		return element;
	}

	private el(tag: string, cls: string): HTMLElement {
		const element = this.doc.createElement(tag);
		element.className = cls;
		return element;
	}

	private listen(
		element: HTMLElement,
		type: string,
		handler: (event: Event) => void,
		owner: (() => void)[] = this.handlers,
	): void {
		element.addEventListener(type, handler);
		owner.push(() => element.removeEventListener(type, handler));
	}
}

/** Used only before a Target is ready, so the control keeps a stable shape. */
function defaultLevelChoices(): readonly { value: BodySemantropy; label: string }[] {
	return ([0, 25, 50, 75, 100] as BodySemantropy[]).map((value) => ({
		value,
		label: bodySemantropyLabel(value),
	}));
}
