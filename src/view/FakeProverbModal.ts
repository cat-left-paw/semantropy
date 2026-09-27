import { Modal, type App } from "obsidian";
import type { FakeProverbBatch } from "../fakeProverb/fakeProverbBatch";
import { FAKE_PROVERB_ROW_COUNT, FakeProverbSession, fakeProverbMessage } from "./FakeProverbSession";
import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";

type RowUI = {
	root: HTMLElement; proverb: HTMLElement; gloss: HTMLElement; status: HTMLElement;
	copy: HTMLButtonElement; collect: HTMLButtonElement; off: (() => void)[];
};

/** Exactly what a row shows: the node objects themselves, not only their text. */
type RowState = { proverb: readonly Node[]; gloss: readonly Node[]; hidden: boolean; empty: boolean };

/**
 * Ten rows, one per display position, built once when the Modal opens and
 * updated in place, so a commit never rebuilds the list, moves the scroll
 * position or takes focus away. Position i is the View's stable rowSlotId i
 * (BATCH1 keeps its rows in rowSlotId order); a Copy / Collect resolves the
 * rowSlotId from the published batch at click time.
 *
 * Generated text reaches the DOM only as a text node inside two plugin-owned
 * elements per row — the proverb and the gloss — never through
 * MarkdownRenderer or an HTML string. The bold proverb and the quoted gloss
 * are this plugin's styling, not Markdown.
 *
 * Row content changes only in `publishBatch()`, which applies a whole batch or
 * nothing. `sync()` updates status and availability, never row text.
 */
export class FakeProverbModal extends Modal {
	private rows: RowUI[] = [];
	private off: (() => void)[] = [];
	private list: HTMLElement | null = null;
	private status: HTMLElement | null = null;
	private captured: HTMLElement | null = null;
	private generate: HTMLButtonElement | null = null;
	private cancel: HTMLButtonElement | null = null;
	private origin: HTMLElement | null;
	/** LOCALE1: fixed texts of the dialog and its ten rows; generated text is never among them. */
	private labels = new UiLabels();
	constructor(app: App, private session: FakeProverbSession | null, private closed: (() => void) | null, origin: HTMLElement | null) {
		super(app); this.origin = origin;
	}
	private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = "") {
		const el = parent.ownerDocument.createElement(tag); if (text) el.textContent = text; parent.append(el); return el;
	}
	private button(parent: HTMLElement, text: () => string, action: () => void, off = this.off) {
		const el = this.element(parent, "button"); el.type = "button"; this.labels.text(el, text);
		el.addEventListener("click", action); off.push(() => el.removeEventListener("click", action)); return el;
	}
	/** LOCALE1: re-words the dialog in place. Row text, the published batch, focus and scroll stay. */
	relabel() {
		if (!this.session) return;
		this.labels.apply();
		this.sync();
	}
	onOpen() {
		this.labels.bind(() => this.setTitle(ui().fakeProverb.title)); this.modalEl.classList.add("semantropy-fake-proverb-modal");
		const session = this.session; if (!session) return;
		const controls = this.element(this.contentEl, "div"); controls.className = "semantropy-fake-proverb-controls";
		this.generate = this.button(controls, () => ui().common.generate, () => { void this.session?.generate(); });
		this.cancel = this.button(controls, () => ui().common.cancelGenerate, () => { this.session?.cancel(); this.generate?.focus(); });
		this.button(controls, () => ui().common.close, () => this.close());
		this.captured = this.element(this.contentEl, "p"); this.captured.className = "semantropy-fake-proverb-note";
		this.status = this.element(this.contentEl, "p"); this.status.setAttribute("role", "status");
		this.status.setAttribute("aria-live", "polite");
		this.list = this.element(this.contentEl, "ol"); this.list.className = "semantropy-fake-proverb-rows";
		for (let position = 0; position < FAKE_PROVERB_ROW_COUNT; position++) this.rows.push(this.row(position));
		for (const ui of this.rows) { ui.gloss.hidden = true; ui.root.classList.add("is-empty"); }
		session.attach(batch => this.publishBatch(batch), () => this.sync()); this.sync(); this.generate.focus();
	}
	private row(position: number): RowUI {
		const off: (() => void)[] = [];
		const root = this.element(this.list!, "li"); root.className = "semantropy-fake-proverb-row";
		const proverb = this.element(root, "p"); proverb.className = "semantropy-fake-proverb-proverb";
		const gloss = this.element(root, "blockquote"); gloss.className = "semantropy-fake-proverb-gloss";
		const controls = this.element(root, "div"); controls.className = "semantropy-fake-proverb-controls";
		// The slot is resolved at click time from the published batch at this position.
		const write = (kind: "copy" | "collect") => {
			const slot = this.session?.slotAt(position);
			if (slot) void this.session?.write(slot, kind);
		};
		// aria-disabled rather than disabled: a button that becomes unavailable keeps keyboard focus.
		const copy = this.button(controls, () => ui().common.copy, () => write("copy"), off);
		const collect = this.button(controls, () => ui().common.collect, () => write("collect"), off);
		const status = this.element(root, "p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
		return { root, proverb, gloss, copy, collect, status, off };
	}
	/** Sets status text only when it changes. */
	private text(el: HTMLElement, value: string) { if (el.textContent !== value) el.textContent = value; }
	private state(ui: RowUI): RowState {
		return { proverb: Array.from(ui.proverb.childNodes), gloss: Array.from(ui.gloss.childNodes), hidden: ui.gloss.hidden,
			empty: ui.root.classList.contains("is-empty") };
	}
	private matches(ui: RowUI, expected: RowState) {
		const same = (actual: NodeListOf<ChildNode>, nodes: readonly Node[]) =>
			actual.length === nodes.length && nodes.every((node, index) => actual[index] === node);
		return same(ui.proverb.childNodes, expected.proverb) && same(ui.gloss.childNodes, expected.gloss) &&
			ui.gloss.hidden === expected.hidden && ui.root.classList.contains("is-empty") === expected.empty;
	}
	/**
	 * Replaces an element's text as one text node. The way back is recorded
	 * before the element is touched, so a failure part-way through the change
	 * is still undone. An unchanged element keeps its node.
	 */
	private swapText(el: HTMLElement, value: string, undo: (() => void)[]) {
		if (el.textContent === value) return;
		const previous = Array.from(el.childNodes);
		undo.push(() => el.replaceChildren(...previous));
		el.replaceChildren(...(value ? [el.ownerDocument.createTextNode(value)] : []));
	}
	/**
	 * Shows a whole committed batch, or leaves the rows exactly as they were.
	 * Every undo step is recorded before its change is made; any failure runs
	 * them all in reverse and restores the scroll position and focus. Whether
	 * the rows really are as they were is then checked against a snapshot of
	 * the node objects, and only an exact match is "failed"; anything else is
	 * "broken", even if every undo step reported success.
	 */
	private publishBatch(batch: FakeProverbBatch): "published" | "failed" | "broken" {
		const doc = this.contentEl.ownerDocument, scroll = this.contentEl.scrollTop;
		const focused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
		const before = this.rows.map(ui => this.state(ui));
		const undo: (() => void)[] = [];
		try {
			if (batch.rows.length !== this.rows.length) throw Error();
			for (const [position, row] of batch.rows.entries()) {
				const ui = this.rows[position]!;
				const committed = row.committed;
				this.swapText(ui.proverb, committed?.proverbText ?? "", undo);
				this.swapText(ui.gloss, committed?.glossText ?? "", undo);
				const hidden = ui.gloss.hidden;
				if (hidden !== !committed) { undo.push(() => { ui.gloss.hidden = hidden; }); ui.gloss.hidden = !committed; }
				const empty = ui.root.classList.contains("is-empty");
				if (empty !== !committed) { undo.push(() => { ui.root.classList.toggle("is-empty", empty); }); ui.root.classList.toggle("is-empty", !committed); }
			}
			return "published";
		} catch {
			for (const step of undo.reverse()) {
				try { step(); } catch { /* the snapshot check below decides */ }
			}
			this.contentEl.scrollTop = scroll;
			if (focused?.isConnected && doc.activeElement !== focused) focused.focus();
			let restored = false;
			try { restored = this.rows.every((ui, position) => this.matches(ui, before[position]!)); } catch { restored = false; }
			return restored ? "failed" : "broken";
		}
	}
	sync() {
		const session = this.session, state = session?.read();
		if (!session || !this.list || !this.status || !this.captured) return;
		const batch = session.batch(), pending = session.pending(), broken = session.isBroken();
		if (this.generate) this.generate.setAttribute("aria-disabled", String(!session.canGenerate()));
		if (this.cancel) {
			if (!pending && this.cancel.ownerDocument.activeElement === this.cancel) this.generate?.focus();
			this.cancel.hidden = !pending;
		}
		// Session messages are English identities; they are shown in the current language.
		const t = ui();
		this.text(this.captured, batch ? session.isStale() ? t.fakeProverb.capturedStale : t.fakeProverb.captured : t.common.generateUsesActive);
		const summary = broken ? "" : batch
			? t.fakeProverb.summary(batch.status === "partial", batch.actualCount, batch.requestedCount, localize(fakeProverbMessage(batch.shortfallReason)))
			: t.common.noResults;
		const operation = pending ? t.common.generating : localize(session.error || fakeProverbMessage(state?.generation.lastError ?? null, !!batch));
		this.text(this.status, t.common.join([operation, summary]));
		this.list.setAttribute("aria-busy", String(pending));
		for (const [position, ui] of this.rows.entries()) {
			const row = batch?.rows[position];
			const slot = session.slotAt(position);
			const writable = !!slot && session.canWrite(slot);
			for (const button of [ui.copy, ui.collect]) button.setAttribute("aria-disabled", String(!writable));
			this.text(ui.status, broken ? "" : row?.committed ? localize(session.rowFeedback(row.rowSlotId, row.committed.rowId)) : batch ? t.fakeProverb.noResultHere : "");
		}
	}
	onClose() {
		// The session belongs to the View; closing the Modal only detaches this display.
		this.session?.detach(); this.session = null;
		for (const row of this.rows) for (const off of row.off) off();
		for (const off of this.off) off(); this.off = []; this.rows = []; this.labels.clear();
		this.contentEl.replaceChildren(); this.list = this.status = this.captured = null;
		this.generate = this.cancel = null;
		const closed = this.closed; this.closed = null; closed?.();
		if (this.origin?.isConnected) this.origin.focus(); this.origin = null;
	}
}
