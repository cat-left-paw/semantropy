import type { IconName } from "obsidian";
import type { ManualSlotDiagnostic } from "../analysis/displaySlots";
import { iconLabel } from "./controlIcon";
import { toManualDiagnosticView } from "./manualDiagnosticModel";
import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";
import type { SemantropyViewModel } from "./semantropyViewModel";
import { SHUFFLE_BAR_KINDS, type ToolbarStatusModel } from "./toolbarStatusModel";

/**
 * WORKBENCH-UI5 (`Docs/release_0_2_0_plan.md` §3.2.2, decisions 16 and 17): the Shuffle
 * tab's own area, between the tab row and the one scrolling box, outside the box. It
 * holds what acts on the Shuffle body: the target note (its name, and the button that
 * chooses another), the body's state, and Reshuffle text (Generate text while nothing is
 * generated), Refresh target, Copy selection and Collect selection. It does not scroll
 * with the body and is hidden while the Recompose tab is shown, so the tab row above it
 * never moves.
 *
 * Owner change C (2026-10-08): in a wide pane the row is one line (the button that chooses a note, then the target's name, then
 * the actions); in a narrow one (the stylesheet's 32rem) the name takes its own line under the button and the actions, with
 * its label, and a name that is still cut carries its whole as a tooltip.
 *
 * It is a host-with-tabs thing only: every other host builds the same Toolbar as before.
 * The View owns every rule (what is enabled, what is shown); this reads the View's own
 * models on every sync and reports clicks. The controls keep the classes the Toolbar's
 * had, and the commands keep acting through the same View methods.
 */
export type ShuffleBarTarget = {
	/** The note's name as written; null when there is none. */
	name: string | null;
	/** A note is being read or analyzed: its name is not known yet and "no note" would be wrong. */
	pending: boolean;
};

export type ShuffleBarInput = {
	model: () => SemantropyViewModel;
	status: () => ToolbarStatusModel;
	target: () => ShuffleBarTarget;
	/**
	 * What the Shuffle body's manual changes say (review 2, P3 5): how many are loaded, and why the selected word can or cannot be
	 * shuffled. Both are about the body, so they stand here and not above the tab row, where showing or hiding them moved it.
	 */
	manual: () => { count: number; diagnostic: ManualSlotDiagnostic | null };
	/** The body shows no Chunk yet: Reshuffle text acts as Generate and is named so. */
	generate: () => boolean;
	/** Absent on a host with no way to choose a note: the button is then not offered. */
	chooseTarget?: () => void;
	reshuffle: () => void;
	refreshTarget: () => void;
	copy: () => void;
	collect: () => void;
};

type Key = "choose" | "reshuffle" | "refresh" | "copy" | "collect";
const ICONS: Readonly<Record<Key, IconName>> = { choose: "file-search", reshuffle: "dices", refresh: "refresh-cw", copy: "copy", collect: "inbox" };
const CLASSES: Readonly<Record<Key, string>> = {
	choose: "semantropy-target-choose", reshuffle: "semantropy-reshuffle", refresh: "semantropy-refresh", copy: "semantropy-copy", collect: "semantropy-collect",
};

let BAR_SEQUENCE = 0;

export class ShuffleBar {
	readonly el: HTMLElement;
	private readonly doc: Document;
	private readonly id = `semantropy-shuffle-bar-${(BAR_SEQUENCE += 1)}`;
	private readonly handlers: (() => void)[] = [];
	/** Fixed texts, re-applied on a language change. */
	private readonly labels = new UiLabels();
	/** Names that follow the body's state (Generate text); re-applied on every sync, each written only when it changed. */
	private readonly dynamic = new UiLabels();
	private readonly buttons = new Map<Key, HTMLButtonElement>();
	private readonly nameEl: HTMLElement;
	private fullName = "";
	private readonly replacementsEl: HTMLElement;
	private readonly manualEl: HTMLElement;
	private readonly diagnosticEl: HTMLElement;
	private readonly staleEl: HTMLElement;
	private readonly messageEl: HTMLElement;
	private readonly detailEl: HTMLElement;

	constructor(parent: HTMLElement, before: HTMLElement, private readonly input: ShuffleBarInput) {
		this.doc = parent.ownerDocument;
		this.el = parent.createDiv({ cls: "semantropy-shuffle-bar" });
		this.el.setAttribute("role", "group");
		parent.insertBefore(this.el, before);
		const hidden = this.child(this.el, "div", "semantropy-visually-hidden");
		const name = this.child(hidden, "div", "semantropy-shuffle-bar-name");
		name.id = `${this.id}-name`;
		this.labels.text(name, () => ui().shuffleBar.name);
		// Named by reference, not by an aria-label, which would put a tooltip chip over the whole area.
		this.el.setAttribute("aria-labelledby", name.id);

		const row = this.child(this.el, "div", "semantropy-shuffle-bar-row");
		// Three items of the row: the choosing button, the target (label and name) and the actions. A narrow pane
		// moves the target to a line of its own.
		this.button(row, "choose", () => ui().shuffleBar.choose.name, () => ui().shuffleBar.choose.description, hidden, this.labels, () => this.input.chooseTarget?.());
		const choose = this.buttons.get("choose");
		if (choose) choose.hidden = this.input.chooseTarget === undefined;
		const target = this.child(row, "div", "semantropy-shuffle-bar-target");
		const label = this.child(target, "span", "semantropy-target-label");
		this.labels.text(label, () => ui().shuffleBar.targetLabel);
		this.nameEl = this.child(target, "span", "semantropy-target-name");
		const actions = this.child(row, "div", "semantropy-shuffle-bar-actions");
		this.button(actions, "reshuffle", () => this.reshuffleName(), () => this.reshuffleDescription(), hidden, this.dynamic, () => this.input.reshuffle());
		this.button(actions, "refresh", () => ui().toolbar.controls.refresh.name, () => ui().toolbar.controls.refresh.description, hidden, this.labels, () => this.input.refreshTarget());
		this.button(actions, "copy", () => ui().toolbar.controls.copy.name, () => ui().toolbar.controls.copy.description, hidden, this.labels, () => this.input.copy());
		this.button(actions, "collect", () => ui().toolbar.controls.collect.name, () => ui().toolbar.controls.collect.description, hidden, this.labels, () => this.input.collect());

		const status = this.child(this.el, "div", "semantropy-shuffle-status");
		this.replacementsEl = this.child(status, "div", "semantropy-meta semantropy-replacements");
		this.manualEl = this.child(status, "div", "semantropy-meta semantropy-manual-count");
		// The sentence about the selected word is a polite status; the Toolbar's Shuffle word control refers to it.
		this.diagnosticEl = this.child(status, "div", "semantropy-manual-diagnostic");
		this.diagnosticEl.id = `${this.id}-manual-diagnostic`;
		this.diagnosticEl.setAttribute("role", "status");
		this.diagnosticEl.setAttribute("aria-live", "polite");
		this.staleEl = this.child(status, "div", "semantropy-stale");
		this.messageEl = this.child(status, "div", "semantropy-message");
		this.messageEl.setAttribute("role", "status");
		this.messageEl.setAttribute("aria-live", "polite");
		this.detailEl = this.child(status, "div", "semantropy-status-detail");
		this.sync();
	}

	/** The Shuffle tab is shown: the area is; otherwise it is out of the layout and the tab order. */
	setShown(shown: boolean): void {
		if (this.el.hidden !== !shown) this.el.hidden = !shown;
	}

	/** The id of the sentence about the selected word, which the Toolbar's Shuffle word control is described by. */
	get diagnosticId(): string {
		return this.diagnosticEl.id;
	}

	/** The button that chooses a target note, when the host offers one: where focus goes after it opened the first note. */
	chooseButton(): HTMLButtonElement | undefined {
		const button = this.buttons.get("choose");
		return button && !button.hidden ? button : undefined;
	}

	sync(): void {
		const model = this.input.model(), status = this.input.status();
		this.dynamic.apply();
		this.setVisible("reshuffle", model.showReshuffle, !model.reshuffleEnabled);
		this.setVisible("refresh", model.showRefresh, !model.refreshEnabled);
		this.setVisible("copy", model.showCopy, !model.copyEnabled);
		this.setVisible("collect", model.showCollect, !model.collectEnabled);

		const target = this.input.target();
		const name = target.name ?? (target.pending ? "" : ui().shuffleBar.noTarget);
		if (this.nameEl.textContent !== name) { this.nameEl.textContent = name; this.fullName = name; this.refit(); }
		this.nameEl.classList.toggle("is-none", target.name === null);

		this.write(this.replacementsEl, status.replacementLabel ?? "");
		const manual = this.input.manual();
		this.write(this.manualEl, manual.count > 0 ? ui().toolbar.manualChanges(manual.count) : "");
		// The row is a live region: its text is touched only when the sentence really changed (write()).
		const diagnostic = toManualDiagnosticView(manual.diagnostic);
		this.write(this.diagnosticEl, diagnostic === null ? "" : localize(diagnostic.message));
		const state = diagnostic === null ? null : diagnostic.available ? "available" : "unavailable";
		if ((this.diagnosticEl.dataset["manual"] ?? null) !== state) {
			if (state === null) delete this.diagnosticEl.dataset["manual"];
			else this.diagnosticEl.dataset["manual"] = state;
		}
		// Only the persistent state of the body is said here; progress, errors and the Vocabulary are in the Toolbar's status line.
		const mine = SHUFFLE_BAR_KINDS.includes(status.kind);
		const stale = mine && status.kind === "target-stale";
		const message = mine ? localize(status.message ?? "") : "";
		const detail = mine ? localize(status.detail ?? "") : "";
		this.write(this.staleEl, stale ? message : "");
		this.staleEl.classList.toggle("is-stale", stale);
		this.write(this.messageEl, stale ? detail : message);
		this.write(this.detailEl, stale ? "" : detail);
	}

	/**
	 * A name that is cut with an ellipsis carries its whole as a tooltip, and one that is not carries none. It reads
	 * layout, so it runs when the name is written and on a resize, never on every sync.
	 */
	refit(): void {
		const el = this.nameEl;
		const cut = this.fullName !== "" && el.scrollWidth > el.clientWidth;
		if (cut && el.title !== this.fullName) el.title = this.fullName;
		else if (!cut && el.hasAttribute("title")) el.removeAttribute("title");
	}

	/** The interface language changed: fixed texts are re-worded in place; nothing is rebuilt. */
	relabel(): void {
		this.labels.apply();
		this.sync();
		// "Target:" is another width in another language, so a name may now be cut, or no longer.
		this.refit();
	}

	dispose(): void {
		for (const off of this.handlers.splice(0)) off();
		this.labels.clear();
		this.dynamic.clear();
		this.buttons.clear();
		this.el.remove();
	}

	private reshuffleName(): string {
		return this.input.generate() ? ui().toolbar.workbench.generate.name : ui().toolbar.controls.reshuffle.name;
	}

	private reshuffleDescription(): string {
		return this.input.generate() ? ui().toolbar.workbench.generate.description : ui().toolbar.controls.reshuffle.description;
	}

	/** An icon-only control: the short name is its `aria-label` (Obsidian's one tooltip); the longer text is its description. */
	private button(parent: HTMLElement, key: Key, name: () => string, description: () => string, descriptions: HTMLElement, labels: UiLabels, onClick: () => void): void {
		const button = parent.createEl("button", { cls: `semantropy-action ${CLASSES[key]} is-bar-icon` });
		button.type = "button";
		button.id = `${this.id}-control-${key}`;
		iconLabel(button, ICONS[key], name());
		const text = button.querySelector<HTMLElement>(".semantropy-action-label");
		if (text) labels.text(text, name);
		labels.attr(button, "aria-label", name);
		const note = this.child(descriptions, "div", "semantropy-control-description");
		note.id = `${this.id}-desc-${key}`;
		labels.text(note, description);
		button.setAttribute("aria-describedby", note.id);
		parent.appendChild(button);
		button.addEventListener("click", onClick);
		this.handlers.push(() => button.removeEventListener("click", onClick));
		this.buttons.set(key, button);
	}

	private setVisible(key: Key, visible: boolean, disabled: boolean): void {
		const button = this.buttons.get(key);
		if (!button) return;
		if (button.hidden !== !visible) button.hidden = !visible;
		if (button.disabled !== disabled) button.disabled = disabled;
	}

	/** The row is a polite status region, so its text is touched only when it really changed. */
	private write(element: HTMLElement, text: string): void {
		if (element.textContent !== text) element.textContent = text;
		if (element.hidden !== (text === "")) element.hidden = text === "";
	}

	private child(parent: HTMLElement, tag: "div" | "span", cls: string): HTMLElement {
		return parent.createEl(tag, { cls });
	}
}
