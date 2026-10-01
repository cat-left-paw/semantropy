import { Modal, type App } from "obsidian";
import { CollisionSession, collisionMessage } from "./CollisionSession";
import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";
import { iconLabel } from "./controlIcon";

type RowUI = {
	root: HTMLElement; text: HTMLElement; pattern: HTMLElement; status: HTMLElement;
	regenerate: HTMLButtonElement; cancel: HTMLButtonElement;
	copy: HTMLButtonElement; collect: HTMLButtonElement; off: (() => void)[]; labels: UiLabels;
};

/**
 * LOCALE1: a recipe's label in the current language. Labels are pattern data and
 * are not changed; a Japanese label is looked up by recipe ID, and an ID the
 * catalog does not know keeps the data label.
 */
export function collisionRecipeLabel(recipe: { id: string; label: string }): string {
	return Object.prototype.hasOwnProperty.call(ui().collision.recipeLabels, recipe.id) ? ui().collision.recipeLabels[recipe.id]! : recipe.label;
}
/**
 * 0.1.0: a row's "Regenerating…" note and its Cancel appear only when the work
 * outlasts this. A quick regeneration then changes the row's text alone, so the
 * rows below never jump for a moment (the owner saw a flicker). `aria-busy` is
 * still set at once.
 */
export const COLLISION_ROW_PENDING_DELAY_MS = 300;

/** Text-only, keyed rows. A row commit never reconstructs the dialog or scroll box. */
export class CollisionModal extends Modal {
	private rows = new Map<string, RowUI>();
	private off: (() => void)[] = [];
	private list: HTMLElement | null = null;
	private status: HTMLElement | null = null;
	private captured: HTMLElement | null = null;
	private generate: HTMLButtonElement | null = null;
	private cancel: HTMLButtonElement | null = null;
	private batchId: string | null = null;
	private origin: HTMLElement | null;
	/** LOCALE1: the dialog's fixed texts; each row keeps its own. */
	private labels = new UiLabels();
	/** When each row's pending work was first seen, and the one timer that re-syncs when a row's delay ends. */
	private pendingSince = new Map<string, number>();
	private pendingTimer: number | null = null;
	constructor(app: App, private session: CollisionSession | null, private closed: (() => void) | null, origin: HTMLElement | null) {
		super(app); this.origin = origin;
	}
	private element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = "") {
		const el = parent.ownerDocument.createElement(tag); el.textContent = text; parent.append(el); return el;
	}
	private button(parent: HTMLElement, text: () => string, action: () => void, off = this.off, labels = this.labels) {
		const el = this.element(parent, "button"); el.type = "button"; labels.text(el, text);
		el.addEventListener("click", action); off.push(() => el.removeEventListener("click", action)); return el;
	}
	/**
	 * 0.1.0 S1: a row action as an icon-only button. Its name is the `aria-label`
	 * (Obsidian's tooltip) and a label span that stays hidden except on touch screens.
	 */
	private iconButton(parent: HTMLElement, icon: string, name: () => string, action: () => void, off: (() => void)[], labels: UiLabels) {
		const el = this.element(parent, "button"); el.type = "button"; el.className = "semantropy-action semantropy-modal-row-action is-icon-only";
		iconLabel(el, icon, name());
		labels.attr(el, "aria-label", name);
		const label = el.querySelector<HTMLElement>(".semantropy-action-label");
		if (label) labels.text(label, name);
		el.addEventListener("click", action); off.push(() => el.removeEventListener("click", action)); return el;
	}
	private select(parent: HTMLElement, name: () => string, options: readonly { id: string; label: () => string }[], labels = this.labels) {
		const label = this.element(parent, "label");
		labels.text(label.appendChild(parent.ownerDocument.createTextNode("")), name);
		const select = this.element(label, "select"); labels.attr(select, "aria-label", name);
		for (const option of options) { const el = this.element(select, "option"); el.value = option.id; labels.text(el, option.label); }
		return select;
	}
	private recipes(recipes: readonly { id: string; label: string }[]) {
		return recipes.map(recipe => ({ id: recipe.id, label: () => collisionRecipeLabel(recipe) }));
	}
	/** LOCALE1: re-words the open dialog and every row in place; rows, focus, scroll and drafts stay. */
	relabel() {
		if (!this.session) return;
		this.labels.apply();
		for (const row of this.rows.values()) row.labels.apply();
		this.sync();
	}
	onOpen() {
		this.labels.bind(() => this.setTitle(ui().collision.title)); this.modalEl.classList.add("semantropy-collision-modal");
		const session = this.session; if (!session) return;
		const controls = this.element(this.contentEl, "div"); controls.className = "semantropy-collision-controls";
		const recipe = this.select(controls, () => ui().collision.defaultPattern, [{ id: "", label: () => ui().collision.random }, ...this.recipes(session.defaultOptions())]);
		const count = this.select(controls, () => ui().collision.count, [10, 20, 50].map(n => ({ id: String(n), label: () => String(n) })));
		this.generate = this.button(controls, () => ui().common.generate, () => {
			const n = Number(count.value); if (n === 10 || n === 20 || n === 50) void this.session?.generate(n, recipe.value);
		});
		this.cancel = this.button(controls, () => ui().common.cancelGenerate, () => { this.session?.cancel("generate"); this.generate?.focus(); });
		this.button(controls, () => ui().common.close, () => this.close());
		this.captured = this.element(this.contentEl, "p");
		this.status = this.element(this.contentEl, "p"); this.status.setAttribute("role", "status");
		this.status.setAttribute("aria-live", "polite");
		this.list = this.element(this.contentEl, "ol"); this.list.className = "semantropy-collision-rows";
		session.changed = () => this.sync(); this.sync(); recipe.focus();
	}
	private row(slot: string): RowUI {
		const off: (() => void)[] = [];
		const labels = new UiLabels();
		const root = this.element(this.list!, "li"); root.className = "semantropy-collision-row";
		const text = this.element(root, "p"); text.className = "semantropy-collision-text";
		// 0.1.0 S1: the pattern and the row's actions share one line; a row regenerates with its own pattern.
		const meta = this.element(root, "div"); meta.className = "semantropy-collision-meta";
		const pattern = this.element(meta, "span"); pattern.className = "semantropy-collision-pattern";
		const controls = this.element(meta, "div"); controls.className = "semantropy-modal-row-actions";
		const regenerate = this.iconButton(controls, "dices", () => ui().collision.regenerate, () => { void this.session?.regenerate(slot); }, off, labels);
		const cancel = this.iconButton(controls, "x", () => ui().common.cancel, () => { this.session?.cancel(slot); regenerate.focus(); }, off, labels);
		const copy = this.iconButton(controls, "copy", () => ui().common.copy, () => { void this.session?.write(slot, "copy"); }, off, labels);
		const collect = this.iconButton(controls, "inbox", () => ui().common.collect, () => { void this.session?.write(slot, "collect"); }, off, labels);
		const status = this.element(root, "p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
		return { root, text, pattern, regenerate, cancel, copy, collect, status, off, labels };
	}
	sync() {
		const session = this.session, state = session?.read();
		if (!session || !this.list || !this.status || !this.captured) return;
		const batch = state?.batch;
		if (this.generate) this.generate.disabled = !session.canGenerate();
		if (this.cancel) this.cancel.hidden = !state?.generation.pending;
		// Session messages are English identities; they are shown in the current language.
		const t = ui();
		const captured = batch ? session.isStale() ? t.collision.capturedStale : t.collision.captured : t.common.generateUsesActive;
		if (this.captured.textContent !== captured) this.captured.textContent = captured;
		const summary = batch ? t.collision.summary(batch.status === "partial", batch.actualCount, batch.requestedCount, batch.limited,
			batch.shortfallReason ? localize(collisionMessage(batch.shortfallReason)) : "") : t.common.noResults;
		const operation = state?.generation.pending ? t.common.generating : localize(session.error || collisionMessage(state?.generation.lastError ?? null));
		const status = t.common.join([operation, summary]);
		if (this.status.textContent !== status) this.status.textContent = status;
		if (this.batchId !== (batch?.batchId ?? null)) {
			for (const row of this.rows.values()) { for (const off of row.off) off(); row.labels.clear(); }
			this.rows.clear(); this.list.replaceChildren(); this.batchId = batch?.batchId ?? null;
		}
		for (const row of batch?.rows ?? []) {
			let ui = this.rows.get(row.rowSlotId);
			if (!ui) { ui = this.row(row.rowSlotId); this.rows.set(row.rowSlotId, ui); }
			const draft = state!.rowDrafts.find(draft => draft.rowSlotId === row.rowSlotId)!;
			if (ui.text.textContent !== row.committed.text) ui.text.textContent = row.committed.text;
			const pattern = t.collision.currentPattern(collisionRecipeLabel(batch!.patternSet.recipes.find(recipe => recipe.id === row.committed.recipeId)!));
			if (ui.pattern.textContent !== pattern) ui.pattern.textContent = pattern;
			ui.regenerate.disabled = !!state?.generation.pending;
			const shown = this.pendingShown(row.rowSlotId, draft.pending);
			ui.cancel.hidden = !shown;
			ui.copy.disabled = ui.collect.disabled = !session.canWrite(row.rowSlotId);
			ui.root.setAttribute("aria-busy", String(draft.pending));
			const status = t.common.join([draft.pending ? shown ? t.collision.regenerating : "" : localize(collisionMessage(draft.lastError) || session.rowFeedback(row.rowSlotId, row.committed.rowId)),
				draft.selector.kind === "fixed" && draft.selector.recipeId !== row.committed.recipeId ? t.collision.draft : "",
				row.committed.limited ? t.collision.limited : ""]);
			if (ui.status.textContent !== status) ui.status.textContent = status;
		}
	}
	/** Whether a row's pending work has lasted long enough to be shown; schedules a re-sync for when it will. */
	private pendingShown(slot: string, pending: boolean): boolean {
		if (!pending) { this.pendingSince.delete(slot); return false; }
		const now = Date.now(), since = this.pendingSince.get(slot) ?? now;
		this.pendingSince.set(slot, since);
		const remaining = since + COLLISION_ROW_PENDING_DELAY_MS - now;
		if (remaining <= 0) return true;
		const view = this.contentEl.ownerDocument.defaultView;
		if (view && this.pendingTimer === null) {
			this.pendingTimer = view.setTimeout(() => { this.pendingTimer = null; this.sync(); }, remaining);
		}
		return false;
	}
	onClose() {
		if (this.pendingTimer !== null) this.contentEl.ownerDocument.defaultView?.clearTimeout(this.pendingTimer);
		this.pendingTimer = null; this.pendingSince.clear();
		this.session?.dispose(); this.session = null;
		for (const row of this.rows.values()) { for (const off of row.off) off(); row.labels.clear(); }
		for (const off of this.off) off(); this.off = []; this.rows.clear(); this.labels.clear();
		this.contentEl.replaceChildren(); this.list = this.status = this.captured = null;
		this.generate = this.cancel = null;
		const closed = this.closed; this.closed = null; closed?.();
		if (this.origin?.isConnected) this.origin.focus(); this.origin = null;
	}
}
