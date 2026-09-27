import { AUTOMATIC_POS_KEYS } from "../settings/automaticPosSettings";
import type { AutomaticPosToolbarPort } from "../settings/AutomaticPosSettingsController";
import type { AutomaticPosOptions } from "../transform/automaticPosOptions";
import { EN_MESSAGES, ui } from "../i18n/catalog";
import { UiLabels } from "../i18n/uiLabels";

export const AUTOMATIC_POS_SETTINGS_ERROR = EN_MESSAGES.automatic.error;
export const AUTOMATIC_POS_SETTINGS_STALE = EN_MESSAGES.automatic.stale;
let sequence = 0;

/** Chrome presenter. Mount explicitly in a Toolbar host outside
 * the body scroll region. No body/style input, persistence, or private tickets.
 * Native buttons/checkboxes supply Enter/Space/Tab behavior; Escape closes.
 * The host may `decorate` the toggle and menu (an icon, a popup class) and is
 * given this presenter's own close, so a host that closes the menu releases the
 * draft exactly as Escape here does. The presenter itself stays free of
 * Obsidian and of the Toolbar's layout. */
export class AutomaticPosToolbar {
	readonly root: HTMLElement;
	private readonly menu: HTMLElement;
	private readonly toggle: HTMLButtonElement;
	private readonly applyButton: HTMLButtonElement;
	private readonly message: HTMLElement;
	private readonly fields = new Map<keyof AutomaticPosOptions, HTMLInputElement>();
	private readonly listeners: (() => void)[] = [];
	/** LOCALE1: this presenter's fixed texts, re-applied in place by `relabel()`. */
	private readonly labels = new UiLabels();
	private failure: "error" | "stale" | null = null;
	private pending: object | null = null;
	private disposed = false;
	private blocked = false;
	setBlocked(blocked: boolean): void { this.blocked = blocked; this.sync(); }
	constructor(parent: HTMLElement, private readonly port: AutomaticPosToolbarPort, options: { decorate?: (toggle: HTMLButtonElement, menu: HTMLElement, close: (focus: boolean) => void) => void } = {}) {
		if (parent.closest(".semantropy-scroll, .semantropy-body")) throw new Error("Automatic options require a Toolbar host");
		const doc = parent.ownerDocument;
		this.root = doc.createElement("div");
		this.root.className = "semantropy-automatic-pos-toolbar";
		this.root.setAttribute("role", "group"); this.name(this.root, () => ui().automatic.group);
		// Local geometry; the popup remains outside the body scroll container.
		Object.assign(this.root.style, { display: "flex", flexWrap: "wrap", minWidth: "0", maxWidth: "100%", gap: "0.5em" });
		// A decorating host owns the toggle's text (an icon and its own name).
		this.toggle = this.button(this.root, () => ui().automatic.toggle, () => this.menu.hidden ? this.open() : this.close(), !options.decorate);
		this.menu = doc.createElement("div"); this.menu.className = "semantropy-automatic-pos-menu"; this.menu.id = `semantropy-automatic-pos-${++sequence}`;
		this.menu.setAttribute("role", "group"); this.name(this.menu, () => ui().automatic.options);
		Object.assign(this.menu.style, { minWidth: "0", maxWidth: "100%", maxHeight: "30vh", overflowY: "auto", overflowWrap: "anywhere" });
		this.menu.hidden = true; this.root.appendChild(this.menu);
		this.toggle.setAttribute("aria-controls", this.menu.id); this.toggle.setAttribute("aria-expanded", "false");
		for (const key of AUTOMATIC_POS_KEYS) {
			const label = doc.createElement("label"), input = doc.createElement("input");
			input.type = "checkbox"; input.id = `${this.menu.id}-${key}`; this.labels.attr(input, "aria-label", () => ui().automatic[key]);
			const text = doc.createTextNode(""); this.labels.text(text, () => ui().automatic[key]);
			label.htmlFor = input.id; label.append(input, text);
			Object.assign(label.style, { display: "inline-flex", alignItems: "center", flexWrap: "wrap", maxWidth: "100%" });
			this.menu.appendChild(label); this.fields.set(key, input);
			this.listen(input, "change", () => {
				const draft = this.port.read().draft;
				if (draft && !this.pending && !this.blocked) this.port.change(Object.freeze({ ...draft, [key]: input.checked }));
				this.sync();
			});
		}
		this.applyButton = this.button(this.menu, () => ui().common.apply, () => { void this.apply(); });
		this.button(this.menu, () => ui().common.cancel, () => this.close(true));
		this.message = doc.createElement("div"); this.message.setAttribute("role", "status"); this.message.setAttribute("aria-live", "polite");
		this.menu.appendChild(this.message);
		this.listen(this.root, "keydown", event => {
			if ((event as KeyboardEvent).key === "Escape" && !this.menu.hidden) { event.preventDefault(); this.close(true); }
		});
		this.listen(doc, "pointerdown", event => {
			if (!this.menu.hidden && event.target && !event.composedPath().includes(this.root)) this.close();
		});
		parent.appendChild(this.root); options.decorate?.(this.toggle, this.menu, focus => this.close(focus)); this.sync();
	}
	open(): void {
		if (this.disposed || this.blocked || !this.port.open()) return;
		this.menu.hidden = false; this.toggle.setAttribute("aria-expanded", "true"); this.setFailure(null);
		this.sync(); this.fields.get("noun")?.focus();
	}
	close(focus = false): void {
		if (this.disposed) return;
		this.pending = null; this.port.close(); this.menu.hidden = true;
		this.toggle.setAttribute("aria-expanded", "false"); this.setFailure(null);
		this.sync(); if (focus) this.toggle.focus();
	}
	sync(): void {
		if (this.disposed) return;
		const state = this.port.read(), options = state.draft ?? state.effective;
		const busy = this.blocked || state.status === "preparing" || state.status === "ready" || this.pending !== null;
		for (const [key, input] of this.fields) { input.checked = options[key]; input.disabled = busy || state.status !== "draft"; }
		this.applyButton.disabled = busy || state.status !== "draft";
		this.toggle.disabled = this.blocked || state.status === "disposed" || state.status === "stale";
		this.menu.setAttribute("aria-busy", String(busy));
	}
	/** LOCALE1: re-applies this presenter's texts in the current language; the draft and the open menu stay. */
	relabel(): void {
		if (this.disposed) return;
		this.labels.apply(); this.setFailure(this.failure);
	}
	dispose(): void {
		if (this.disposed) return;
		this.close(); this.disposed = true;
		for (const remove of this.listeners) remove();
		this.listeners.length = 0; this.fields.clear(); this.labels.clear(); this.root.remove();
	}
	private setFailure(failure: "error" | "stale" | null): void {
		this.failure = failure;
		this.message.textContent = failure === null ? "" : failure === "stale" ? ui().automatic.stale : ui().automatic.error;
	}
	/** A container's name, unless a host has named it by reference instead. */
	private name(element: HTMLElement, text: () => string): void {
		this.labels.bind(() => { if (!element.hasAttribute("aria-labelledby")) element.setAttribute("aria-label", text()); });
	}
	private async apply(): Promise<void> {
		if (this.disposed || this.blocked || this.pending || this.menu.hidden) return;
		const draft = this.port.read().draft; if (!draft) return;
		const operation = {}; this.pending = operation;
		const request = Object.freeze({ ...draft });
		try {
			const result = this.port.apply(request); this.sync();
			const outcome = await result;
			if (this.disposed || this.pending !== operation) return;
			this.pending = null;
			if (outcome === "committed") { this.close(true); return; }
			this.setFailure(outcome === "stale" || outcome === "disposed" ? "stale" : "error");
		} catch {
			if (this.disposed || this.pending !== operation) return;
			this.pending = null; this.setFailure("error");
		}
		this.sync();
	}
	private button(parent: HTMLElement, text: () => string, click: () => void, bind = true): HTMLButtonElement {
		const button = parent.ownerDocument.createElement("button"); button.type = "button";
		if (bind) { this.labels.text(button, text); this.labels.attr(button, "aria-label", text); }
		else { button.textContent = text(); button.setAttribute("aria-label", text()); }
		Object.assign(button.style, { maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" });
		parent.appendChild(button); this.listen(button, "click", click); return button;
	}
	private listen(target: EventTarget, name: string, handler: (event: Event) => void): void {
		target.addEventListener(name, handler); this.listeners.push(() => target.removeEventListener(name, handler));
	}
}
