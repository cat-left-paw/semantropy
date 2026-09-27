import { Modal, type App } from "obsidian";
import { CollisionSession, collisionMessage } from "./CollisionSession";
import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";

type RowUI = {
	root: HTMLElement; text: HTMLElement; pattern: HTMLElement; status: HTMLElement;
	selector: HTMLSelectElement; regenerate: HTMLButtonElement; cancel: HTMLButtonElement;
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
		const pattern = this.element(root, "p");
		const controls = this.element(root, "div"); controls.className = "semantropy-collision-controls";
		const selector = this.select(controls, () => ui().collision.regenerateWith, [{ id: "", label: () => ui().collision.samePattern }, ...this.recipes(this.session!.rowOptions())], labels);
		const change = () => this.session?.select(slot, selector.value === "" ? { kind: "same" } : { kind: "fixed", recipeId: selector.value });
		selector.addEventListener("change", change); off.push(() => selector.removeEventListener("change", change));
		const regenerate = this.button(controls, () => ui().collision.regenerate, () => { void this.session?.regenerate(slot); }, off, labels);
		const cancel = this.button(controls, () => ui().common.cancel, () => { this.session?.cancel(slot); regenerate.focus(); }, off, labels);
		const copy = this.button(controls, () => ui().common.copy, () => { void this.session?.write(slot, "copy"); }, off, labels);
		const collect = this.button(controls, () => ui().common.collect, () => { void this.session?.write(slot, "collect"); }, off, labels);
		const status = this.element(root, "p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
		return { root, text, pattern, selector, regenerate, cancel, copy, collect, status, off, labels };
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
			ui.selector.value = draft.selector.kind === "same" ? "" : draft.selector.recipeId;
			ui.selector.disabled = ui.regenerate.disabled = !!state?.generation.pending;
			ui.cancel.hidden = !draft.pending;
			ui.copy.disabled = ui.collect.disabled = !session.canWrite(row.rowSlotId);
			ui.root.setAttribute("aria-busy", String(draft.pending));
			const status = t.common.join([draft.pending ? t.collision.regenerating : localize(collisionMessage(draft.lastError) || session.rowFeedback(row.rowSlotId, row.committed.rowId)),
				draft.selector.kind === "fixed" && draft.selector.recipeId !== row.committed.recipeId ? t.collision.draft : "",
				row.committed.limited ? t.collision.limited : ""]);
			if (ui.status.textContent !== status) ui.status.textContent = status;
		}
	}
	onClose() {
		this.session?.dispose(); this.session = null;
		for (const row of this.rows.values()) { for (const off of row.off) off(); row.labels.clear(); }
		for (const off of this.off) off(); this.off = []; this.rows.clear(); this.labels.clear();
		this.contentEl.replaceChildren(); this.list = this.status = this.captured = null;
		this.generate = this.cancel = null;
		const closed = this.closed; this.closed = null; closed?.();
		if (this.origin?.isConnected) this.origin.focus(); this.origin = null;
	}
}
