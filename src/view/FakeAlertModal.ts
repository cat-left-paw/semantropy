import { Modal, setIcon, type App, type IconName } from "obsidian";
import { isFakeAlert, type FakeAlert, type FakeAlertPage } from "../fakeAlert/fakeAlertCore";
import type { FakeAlertButton, FakeAlertKind } from "../fakeAlert/recipeData";
import { ui } from "../i18n/catalog";

/** The icon each kind shows: present in Obsidian 1.13.7's bundled set and the web page's Lucide. */
export const FAKE_ALERT_KIND_ICONS: Readonly<Record<FakeAlertKind, IconName>> = Object.freeze({
	warning: "triangle-alert",
	error: "circle-x",
	confirmation: "circle-help",
	information: "info",
	success: "circle-check",
});
/** Semantropy's own mark: the same icon as its tab, so the dialog reads as Semantropy's, not the system's. */
export const FAKE_ALERT_BRAND_ICON: IconName = "brain-circuit";
/** The product name beside that icon. A name, so it is the same in both interface languages. */
export const FAKE_ALERT_BRAND_TEXT = "Semantropy";

let SEQUENCE = 0;

/**
 * FAKE-ALERT-VIEW1 (`Docs/fake_alert_policy1.md` §8, §9): one Fake Alert.
 *
 * It shows a finished Alert the core generated and nothing else: there is no
 * way to hand it text, a message or a reason, and an object the core did not
 * record is refused before anything is shown. A real problem (no Vocabulary,
 * nothing to draw) is the View's Notice and never reaches this dialog, so a
 * Fake Alert on screen is always fiction.
 *
 * The content is the fiction; the controls are real. Escape and the close
 * button always close it at once, and closing a Prompt shows no Outcome. A
 * Prompt's button turns the dialog into the page that button leads to, which
 * was drawn before the dialog opened; an Outcome's or a one-shot Alert's OK
 * closes it. Generated text is set only as `textContent` of plugin-owned
 * elements. The dialog keeps the ordinary dialog role — no `alertdialog` or
 * `role="alert"`, which belong to real warnings — and its accessible name
 * starts with Semantropy's brand, so a screen reader also hears that it is
 * Semantropy's joke.
 */
export class FakeAlertModal extends Modal {
	private readonly alert: FakeAlert;
	private page: FakeAlertPage;
	/** True once a Prompt's button has been pressed: every page from then on closes on OK. */
	private answered = false;
	private origin: HTMLElement | null;
	private titleText: HTMLElement | null = null;
	private brandName: HTMLElement | null = null;
	private icon: HTMLElement | null = null;
	private message: HTMLElement | null = null;
	private buttonRow: HTMLElement | null = null;
	private buttons: { button: FakeAlertButton; el: HTMLButtonElement }[] = [];

	/**
	 * `shown` hears each page as it is put on screen — the opening page, then the
	 * page a pressed button leads to — so the View can make those words rarer next
	 * time. A page a button would have led to but was never shown is not reported.
	 */
	constructor(app: App, alert: FakeAlert, private closed: (() => void) | null, origin: HTMLElement | null,
		private shown: ((page: FakeAlertPage) => void) | null = null) {
		super(app);
		// Policy §9: only an Alert the core made and recorded can be shown.
		if (!isFakeAlert(alert)) throw new Error("A Fake Alert dialog shows only a generated Fake Alert.");
		this.alert = alert;
		this.page = alert.prompt;
		this.origin = origin;
	}

	private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className: string): HTMLElementTagNameMap[K] {
		const el = parent.ownerDocument.createElement(tag);
		el.className = className;
		parent.append(el);
		return el;
	}

	/**
	 * Obsidian's `Modal.open()` runs `onOpen()` and then, with a physical
	 * keyboard, focuses the first control in the dialog — here the negative
	 * button. Policy §8 wants the affirmative one, so focus it again once the
	 * host has finished opening.
	 */
	open(): void {
		super.open();
		this.focusAffirmative();
	}

	private focusAffirmative(): void {
		const last = this.buttons.at(-1)?.el;
		if (last?.isConnected) last.focus();
	}

	onOpen(): void {
		const id = ++SEQUENCE;
		const modal = this.modalEl;
		modal.classList.add("semantropy-fake-alert");
		modal.setAttribute("role", "dialog");
		modal.setAttribute("aria-modal", "true");

		this.titleEl.replaceChildren();
		this.titleEl.classList.add("semantropy-fake-alert-heading");
		this.titleText = this.element(this.titleEl, "span", "semantropy-fake-alert-title");
		this.titleText.id = `semantropy-fake-alert-title-${id}`;
		// The brand's full name is read before the title and never shown; the visible mark is in the footer.
		this.brandName = this.element(this.titleEl, "span", "semantropy-visually-hidden");
		this.brandName.id = `semantropy-fake-alert-brand-${id}`;
		modal.setAttribute("aria-labelledby", `${this.brandName.id} ${this.titleText.id}`);

		const body = this.element(this.contentEl, "div", "semantropy-fake-alert-body");
		this.icon = this.element(body, "div", "semantropy-fake-alert-icon");
		this.icon.setAttribute("aria-hidden", "true");
		this.message = this.element(body, "div", "semantropy-fake-alert-message");
		this.message.id = `semantropy-fake-alert-message-${id}`;
		// A pressed button replaces the message in place; this makes the new page heard.
		this.message.setAttribute("aria-live", "polite");
		modal.setAttribute("aria-describedby", this.message.id);
		// Owner decision: Semantropy's mark sits small at the left of the button row. Its name is
		// already in the accessible name, so the mark itself is not read again.
		const footer = this.element(this.contentEl, "div", "semantropy-fake-alert-footer");
		const brand = this.element(footer, "div", "semantropy-fake-alert-brand");
		brand.setAttribute("aria-hidden", "true");
		setIcon(this.element(brand, "span", "semantropy-fake-alert-brand-icon"), FAKE_ALERT_BRAND_ICON);
		this.element(brand, "span", "semantropy-fake-alert-brand-text").textContent = FAKE_ALERT_BRAND_TEXT;
		this.buttonRow = this.element(footer, "div", "semantropy-fake-alert-buttons");

		this.show(this.page);
	}

	/** Puts one page on screen and gives the affirmative (rightmost) button focus. */
	private show(page: FakeAlertPage): void {
		this.page = page;
		this.modalEl.setAttribute("data-kind", page.kind);
		const icon = this.icon!;
		icon.replaceChildren();
		setIcon(icon, FAKE_ALERT_KIND_ICONS[page.kind]);
		const message = this.message!;
		message.replaceChildren(...page.lines.map((line) => {
			const el = message.ownerDocument.createElement("p");
			el.textContent = line;
			return el;
		}));
		const row = this.buttonRow!;
		row.replaceChildren();
		this.buttons = page.buttons.map((button, index) => {
			const el = this.element(row, "button", index === page.buttons.length - 1 ? "mod-cta" : "");
			el.type = "button";
			el.addEventListener("click", () => this.press(button));
			return { button, el };
		});
		this.relabel();
		this.focusAffirmative();
		this.shown?.(page);
	}

	private press(button: FakeAlertButton): void {
		const next = this.answered || this.alert.shape === "terminal" ? undefined : this.alert.outcomes[button];
		if (next === undefined) {
			this.close();
			return;
		}
		this.answered = true;
		this.show(next);
	}

	/** LOCALE1: the title, the buttons and the brand follow the interface language. Generated text does not. */
	relabel(): void {
		const text = ui().fakeAlert;
		if (this.titleText) this.titleText.textContent = text.kinds[this.page.kind];
		if (this.brandName) this.brandName.textContent = text.brand;
		for (const { button, el } of this.buttons) el.textContent = text.buttons[button];
	}

	onClose(): void {
		this.contentEl.replaceChildren();
		this.buttons = [];
		this.titleText = this.brandName = this.icon = this.message = this.buttonRow = null;
		const closed = this.closed;
		this.closed = null;
		this.shown = null;
		closed?.();
		if (this.origin?.isConnected) this.origin.focus();
		this.origin = null;
	}
}
