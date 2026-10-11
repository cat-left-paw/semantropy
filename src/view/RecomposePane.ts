import { iconLabel } from "./controlIcon";
import { ui } from "../i18n/catalog";
import { UiLabels } from "../i18n/uiLabels";
import { RECOMPOSE_METHOD_IDS } from "../recompose/recompose";
import { RECOMPOSE_SENTENCE_CHOICES, type RecomposeAction, type RecomposeDisplay, type RecomposeMode, type RecomposeSession } from "./RecomposeSession";
import type { RecomposeShownUnit, RecomposeWord } from "./recomposeWords";

/**
 * WORKBENCH-UI2 stage 3: the screen of Recompose, built into the container the
 * View gives it (its Recompose pane). It holds no result of its own: every
 * control writes to the session, and every redraw reads from it, so a pane built
 * again over the same session shows the same settings, text, branch point and
 * message. Generated text reaches the DOM only as text nodes.
 *
 * The output scrolls inside its own box, and a new step also brings its text into
 * view in the View's one scrolling box, which scrolls the whole pane when the
 * View is too short for it. (Until WORKBENCH-UI4 the 0.1.0 S5 dialog held the same
 * screen with `contained: true`; the dialog is gone.)
 */
export class RecomposePane implements RecomposeDisplay {
	private off: (() => void)[] = [];
	private readonly labels = new UiLabels();
	private disposed = false;
	private readonly method: HTMLSelectElement;
	private readonly methodHint: HTMLElement;
	private readonly leap: HTMLInputElement;
	private readonly leapValue: HTMLElement;
	private readonly sentences: HTMLSelectElement;
	private readonly statusEl: HTMLElement;
	/** WORKBENCH-UI5 (review 1, P3): why Generate new is off — there is no usable Vocabulary — where the reader looks. */
	private readonly unusable: HTMLElement;
	private readonly notice: HTMLElement;
	private readonly body: HTMLElement;
	/** The sentence under the text, kept so a language change can re-word it without rebuilding the pieces. */
	private hintEl: HTMLElement | null = null;
	private readonly buttons = new Map<RecomposeAction, HTMLButtonElement>();

	constructor(private readonly root: HTMLElement, private readonly session: RecomposeSession) {
		this.labels.text(this.element(root, "p", "semantropy-recompose-intro"), () => ui().recompose.intro);
		const controls = this.element(root, "div", "semantropy-recompose-controls");
		this.method = root.ownerDocument.createElement("select");
		for (const id of RECOMPOSE_METHOD_IDS) {
			const option = this.element(this.method, "option");
			option.value = id;
			this.labels.text(option, () => ui().recompose.methods[id]);
		}
		this.method.value = session.method;
		this.field(controls, () => ui().recompose.method, this.method);
		this.leap = root.ownerDocument.createElement("input");
		Object.assign(this.leap, { type: "range", min: "0", max: "100", step: "5", value: String(session.leap) });
		this.leapValue = root.ownerDocument.createElement("span");
		this.field(controls, () => ui().recompose.leap, this.leap, this.leapValue);
		this.sentences = root.ownerDocument.createElement("select");
		for (const count of RECOMPOSE_SENTENCE_CHOICES) {
			const option = this.element(this.sentences, "option");
			option.value = option.textContent = String(count);
		}
		this.sentences.value = String(session.sentences);
		this.field(controls, () => ui().recompose.sentences, this.sentences);
		this.methodHint = this.element(root, "p", "semantropy-recompose-hint");
		for (const control of [this.method, this.leap, this.sentences]) {
			this.listen(control, "input", () => this.sync());
			this.listen(control, "change", () => this.sync());
		}

		const actions = this.element(root, "div", "semantropy-recompose-actions");
		this.button(actions, "generate", "dices", () => ui().recompose.generate, () => void this.run("new"));
		this.button(actions, "more", "list-plus", () => ui().recompose.more, () => void this.run("more"));
		this.button(actions, "branch", "git-branch", () => ui().recompose.branch, () => void this.run("branch"));
		this.unusable = this.element(root, "p", "semantropy-recompose-unusable");
		this.labels.text(this.unusable, () => ui().recompose.noVocabulary);
		this.statusEl = this.element(root, "p", "semantropy-recompose-status");
		this.statusEl.setAttribute("role", "status");
		this.statusEl.setAttribute("aria-live", "polite");
		this.notice = this.element(root, "p", "semantropy-recompose-note");
		this.body = this.element(root, "div", "semantropy-recompose-output");
		this.listen(this.body, "click", event => this.pick(event));
		// S5 review: the branch point is also chosen from the keyboard, with one Tab stop for the whole text.
		this.body.tabIndex = 0;
		this.labels.attr(this.body, "aria-label", () => ui().recompose.pickHint);
		this.listen(this.body, "keydown", event => this.step(event as KeyboardEvent));
		const secondary = this.element(root, "div", "semantropy-recompose-actions");
		this.button(secondary, "copy", "copy", () => ui().recompose.copy, () => void this.copy());
		this.button(secondary, "collect", "inbox", () => ui().recompose.collect, () => void this.collect());
		this.button(secondary, "clear", "x", () => ui().recompose.clear, () => this.clear());
		session.attach(this);
		this.render(null);
		this.sync();
	}

	private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = ""): HTMLElementTagNameMap[K] {
		const el = parent.ownerDocument.createElement(tag);
		if (className) el.className = className;
		parent.append(el);
		return el;
	}
	private listen(el: HTMLElement, type: string, action: (event: Event) => void): void {
		el.addEventListener(type, action);
		this.off.push(() => el.removeEventListener(type, action));
	}
	private field(parent: HTMLElement, name: () => string, control: HTMLElement, extra?: HTMLElement): void {
		const label = this.element(parent, "label", "semantropy-recompose-field");
		this.labels.text(this.element(label, "span"), name);
		label.append(control);
		if (extra) label.append(extra);
	}
	private button(parent: HTMLElement, key: RecomposeAction, icon: string, name: () => string, action: () => void): void {
		const el = this.element(parent, "button", "semantropy-action");
		el.type = "button";
		iconLabel(el, icon, name());
		this.labels.attr(el, "aria-label", name);
		const label = el.querySelector<HTMLElement>(".semantropy-action-label");
		if (label) this.labels.text(label, name);
		this.listen(el, "click", () => { if (!el.disabled) action(); });
		this.buttons.set(key, el);
	}

	/**
	 * WORKBENCH-UI3: the element the recomposed text is written in. The View
	 * gives it the body's font and size, so the two panes read alike; nothing
	 * else of the display settings reaches it.
	 */
	outputElement(): HTMLElement {
		return this.body;
	}

	/** The controls are what the reader set; the session takes them before it uses them. */
	private pull(): void {
		this.session.setMethod(this.method.value);
		this.session.setLeap(Number(this.leap.value));
		this.session.setSentences(Number(this.sentences.value));
	}

	/** LOCALE1: re-words the screen in place; the output, the choices and focus stay. */
	relabel(): void {
		if (this.disposed) return;
		this.labels.apply();
		// FAKE-DICT-RECOMPOSE1: a text on screen keeps its piece and word elements (a Fake Dictionary Popover may be
		// anchored to one); only the sentence under it is re-worded. The empty note has no pieces to keep.
		if (this.session.read().paragraphs === null) this.render(null);
		else if (this.hintEl) this.hintEl.textContent = ui().recompose.pickHint;
		this.sync();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.session.detach(this);
		for (const off of this.off) off();
		this.off = [];
		this.labels.clear();
		this.buttons.clear();
		this.root.replaceChildren();
	}

	run(mode: RecomposeMode): Promise<void> {
		if (this.disposed) return Promise.resolve();
		this.pull();
		return this.session.run(mode);
	}

	copy(): Promise<void> {
		return this.disposed ? Promise.resolve() : this.session.copy();
	}

	/** Collect stays off until its write settles; the session's sync turns it back on. */
	collect(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.session.writable()) {
			const collect = this.buttons.get("collect");
			if (collect) collect.disabled = true;
		}
		return this.session.collect();
	}

	clear(): void {
		if (!this.disposed) this.session.clear();
	}

	status(): void {
		if (this.disposed) return;
		const message = this.session.read().message;
		this.statusEl.textContent = message ? message() : "";
	}

	private pick(event: Event): void {
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".semantropy-recompose-unit") : null;
		const state = this.session.read();
		if (!target || state.busy) return;
		const index = Number(target.dataset.index);
		this.mark(state.branchAt === index ? null : index);
	}

	/** Arrow keys move the branch point through the pieces; Home and End jump to the first and last. */
	private step(event: KeyboardEvent): void {
		const count = this.body.querySelectorAll(".semantropy-recompose-unit").length;
		const state = this.session.read();
		if (state.busy || count === 0) return;
		const current = state.branchAt;
		let next: number;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") next = current === null ? 0 : Math.min(count - 1, current + 1);
		else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = current === null ? count - 1 : Math.max(0, current - 1);
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = count - 1;
		else return;
		event.preventDefault();
		this.mark(next);
	}

	private mark(index: number | null): void {
		this.session.mark(index);
		for (const span of Array.from(this.body.querySelectorAll<HTMLElement>(".semantropy-recompose-unit"))) {
			const chosen = Number(span.dataset.index) === index;
			span.classList.toggle("is-branch", chosen);
			if (chosen) span.scrollIntoView?.({ block: "nearest" });
		}
		this.sync();
	}

	/**
	 * A piece's text, with the words the Fake Dictionary can look up in `semantropy-recompose-word` spans (text nodes
	 * only). The piece's `textContent` is its text either way, so the branch point, the keys and the text Copy and
	 * Collect write do not see the words.
	 */
	private fill(span: HTMLElement, unit: RecomposeShownUnit): void {
		const doc = span.ownerDocument;
		let at = 0;
		unit.words.forEach((word, wordIndex) => {
			if (word.start < at || word.end > unit.text.length || word.end <= word.start) return;
			if (word.start > at) span.append(doc.createTextNode(unit.text.slice(at, word.start)));
			const element = this.element(span, "span", "semantropy-recompose-word");
			element.textContent = unit.text.slice(word.start, word.end);
			element.dataset.word = String(wordIndex);
			at = word.end;
		});
		if (at < unit.text.length) span.append(doc.createTextNode(unit.text.slice(at)));
	}

	/** The word an element of the output belongs to and the element that shows it; null for anything else (the session decides what is a word now). */
	wordAt(element: Element): { readonly word: RecomposeWord; readonly anchor: HTMLElement } | null {
		if (this.disposed) return null;
		const anchor = element.closest<HTMLElement>(".semantropy-recompose-word");
		if (!anchor || !this.body.contains(anchor)) return null;
		const unit = anchor.closest<HTMLElement>(".semantropy-recompose-unit");
		const word = unit ? this.session.wordAt(Number(unit.dataset.index), Number(anchor.dataset.word)) : null;
		return word ? { word, anchor } : null;
	}

	/**
	 * Puts the output on screen. After a step, a new text starts at the top of
	 * the output and a continuation or a branch shows its new end.
	 */
	render(step: RecomposeMode | null): void {
		if (this.disposed) return;
		const body = this.body;
		const state = this.session.read();
		if (!state.paragraphs) {
			const empty = body.ownerDocument.createElement("p");
			empty.className = "semantropy-recompose-empty";
			empty.textContent = ui().recompose.empty;
			body.replaceChildren(empty);
		} else {
			let index = 0;
			const blocks = state.paragraphs.map(paragraph => {
				const p = body.ownerDocument.createElement("p");
				for (const unit of paragraph) {
					const span = this.element(p, "span", "semantropy-recompose-unit");
					this.fill(span, unit);
					span.dataset.index = String(index);
					if (index === state.branchAt) span.classList.add("is-branch");
					index += 1;
				}
				return p;
			});
			const hint = body.ownerDocument.createElement("p");
			hint.className = "semantropy-recompose-hint";
			hint.textContent = ui().recompose.pickHint;
			this.hintEl = hint;
			body.replaceChildren(...blocks, hint);
		}
		if (!state.paragraphs) this.hintEl = null;
		if (step === null) return;
		// The output box scrolls itself: a new text starts at its top however far the earlier one was
		// read, a continuation or a branch shows its end.
		body.scrollTop = step === "new" ? 0 : body.scrollHeight;
		// The View's one scrolling box may have to move as well (a View too short to hold the pane).
		const units = body.querySelectorAll<HTMLElement>(".semantropy-recompose-unit");
		const target = step === "new" ? body : units[units.length - 1] ?? body;
		target.scrollIntoView?.({ block: "nearest" });
	}

	/** Availability, the method hint, the leap value and the Vocabulary note; never the output text. */
	sync(): void {
		if (this.disposed) return;
		this.pull();
		const state = this.session.read();
		for (const [key, button] of this.buttons) button.disabled = !state.available[key];
		// Off because there is no usable Vocabulary (not because a step is running): the sentence stands beside the button.
		this.unusable.hidden = state.available.generate || state.busy;
		this.leapValue.textContent = this.leap.value;
		this.methodHint.textContent = ui().recompose.methodHints[this.session.method];
		this.notice.textContent = state.changed ? ui().recompose.changed : "";
		this.notice.hidden = this.notice.textContent === "";
		if (state.message) this.statusEl.textContent = state.message();
	}
}
