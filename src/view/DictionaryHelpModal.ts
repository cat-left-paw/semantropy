import { Modal, Platform, type App } from "obsidian";
import { dictionaryAltLabel } from "./dictionaryModifierLabel";
import { ui } from "../i18n/catalog";
import { UiLabels } from "../i18n/uiLabels";

/**
 * WORKBENCH-UI5 (`Docs/release_0_2_0_plan.md` §3.2.2, decision 20): what the Fake Dictionary needs the reader to
 * know, in one dialog from the Toolbar's Fake Dictionary button. From the top: how to look a word up; the
 * modifier key (the same setting the line it replaces had); and, folded and closed to begin with, what the
 * active Vocabulary offers it (the sentence, the usable templates and the words of each Source).
 *
 * The View owns it, at most one per View. It owns no rule: the View computes the diagnostics and writes them
 * into the two elements it is given while the dialog is open, so the dialog shows what the View's own
 * status shows and nothing else. On a host with tabs the dialog replaces the "Dictionary availability" row
 * between the Toolbar and the body; the web page's host keeps that row.
 */
export type DictionaryHelpHost = {
	/** The stored hover modifier. */
	modifier: () => "alt" | "shift";
	setModifier: (value: "alt" | "shift") => void;
	/** The View writes the diagnostics into these while the dialog is open; `unbind` on close. */
	bind: (status: HTMLElement, counts: HTMLElement) => void;
	unbind: () => void;
	closed: () => void;
	/** Where focus goes when the dialog closes, asked then: the button that opened it may have been built again. */
	focusTarget?: () => HTMLElement | null;
};

export class DictionaryHelpModal extends Modal {
	private readonly labels = new UiLabels();
	private select: HTMLSelectElement | null = null;
	private off: (() => void)[] = [];
	private origin: HTMLElement | null;
	private host: DictionaryHelpHost | null;

	constructor(app: App, host: DictionaryHelpHost, origin: HTMLElement | null) {
		super(app);
		this.host = host;
		this.origin = origin;
	}

	onOpen(): void {
		const host = this.host;
		if (!host) return;
		this.labels.bind(() => this.setTitle(ui().dictionary.title));
		this.modalEl.classList.add("semantropy-dictionary-help-modal");
		const root = this.contentEl.createDiv({ cls: "semantropy-dictionary-help" });
		// 1. How to look a word up.
		this.labels.text(root.createEl("p", { cls: "semantropy-dictionary-help-how" }), () => ui().dictionary.help.how(ui().view.manualDefine));
		this.labels.text(root.createEl("p", { cls: "semantropy-dictionary-help-markers" }), () => ui().dictionary.help.markers);
		// 2. The modifier key: the same setting as before, saved when it is changed.
		const label = root.createEl("label", { cls: "semantropy-dictionary-help-modifier" });
		this.labels.text(label.appendChild(label.ownerDocument.createTextNode("")), () => ui().dictionary.hoverModifier);
		const select = this.select = label.createEl("select");
		this.labels.text(select.createEl("option", { value: "alt" }), () => dictionaryAltLabel(Platform.isMacOS));
		this.labels.text(select.createEl("option", { value: "shift" }), () => ui().dictionary.shift);
		select.value = host.modifier();
		const change = () => { if (select.value === "alt" || select.value === "shift") host.setModifier(select.value); };
		select.addEventListener("change", change);
		this.off.push(() => select.removeEventListener("change", change));
		// 3. What the active Vocabulary offers: folded, and closed to begin with.
		const details = root.createEl("details", { cls: "semantropy-dictionary-diagnostics semantropy-dictionary-help-details" });
		this.labels.text(details.createEl("summary"), () => ui().dictionary.details);
		const status = details.createDiv({ attr: { role: "status" } });
		const counts = details.createDiv();
		host.bind(status, counts);
		select.focus();
	}

	/** The stored modifier changed elsewhere (another View, the settings): the select follows it. */
	sync(): void {
		const host = this.host;
		if (host && this.select && this.select.value !== host.modifier()) this.select.value = host.modifier();
	}

	/** The interface language changed: fixed texts are re-worded in place; the select, the folding and focus stay. */
	relabel(): void {
		if (!this.host) return;
		this.labels.apply();
		this.sync();
	}

	onClose(): void {
		const host = this.host;
		this.host = null;
		for (const off of this.off.splice(0)) off();
		this.labels.clear();
		this.select = null;
		this.contentEl.replaceChildren();
		host?.unbind();
		host?.closed();
		const target = host?.focusTarget?.() ?? this.origin;
		if (target?.isConnected) target.focus();
		this.origin = null;
	}
}
