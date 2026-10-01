import { Modal, type App } from "obsidian";
import { iconLabel } from "./controlIcon";
import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";
import { collectFragmentMessage } from "../collect/collectMessages";
import type { CollectFragmentResultV4 } from "../collect/v4/CollectFragmentUseCaseV4";
import { COLLECT_METADATA_VERSION_V5, type RecomposeFragmentInputV5 } from "../collect/v4/CollectedFragmentV4";
import { collectVocabularyFromSnapshot } from "../application/collectVocabulary";
import { createSeededRandom } from "../random/seededRandom";
import { RecomposeCorpusError } from "../recompose/recomposeCorpus";
import {
	DEFAULT_RECOMPOSE_METHOD,
	RECOMPOSE_ALGORITHM_VERSION,
	RECOMPOSE_METHOD_IDS,
	RECOMPOSE_MIXED_METHOD,
	createRecomposeModel,
	generateRecompose,
	isRecomposeMethodId,
	recomposeCorpusFrom,
	recomposeText,
	type RecomposeMethodId,
	type RecomposeModel,
	type RecomposeOutputUnit,
} from "../recompose/recompose";
import { readManualMorphSourceDocuments, type ManualMorphVocabulary } from "../transform/manualMorphology";

export type RecomposeHost = {
	/** The View's active, fresh Vocabulary owner (the one Collision uses), or null. */
	active(): ManualMorphVocabulary | null;
	/** A fresh draw nonce for one step. Never persisted, logged or shown. */
	nonce(): number;
	/** Lets the dialog paint before the synchronous model build. */
	paint(): Promise<void>;
	copy(text: string): Promise<void>;
	collect(input: RecomposeFragmentInputV5): Promise<CollectFragmentResultV4>;
};

/** What is on screen and the Vocabulary owner it came from (Copy and Collect use its provenance). */
type Output = { owner: ManualMorphVocabulary; paragraphs: RecomposeOutputUnit[][] };

const SENTENCE_CHOICES = [1, 3, 5, 10] as const;

/**
 * 0.1.0 S5 (Docs/release_0_1_0_policy.md decision 12): Recompose in Obsidian.
 *
 * The Sources are the active Vocabulary's, with its Source weights, read from
 * the documents that were analyzed when the Vocabulary was applied: nothing is
 * read or tokenized again. Output keeps its units, so Continue and Branch hand
 * the core exactly what it produced; they need the same Vocabulary owner the
 * output came from, while Copy and Collect keep using that owner's provenance.
 * Generated text reaches the DOM only as text nodes. There is no "open as
 * Target" here, and nothing is kept after the dialog closes.
 */
export class RecomposeModal extends Modal {
	private off: (() => void)[] = [];
	private labels = new UiLabels();
	private cache: { owner: ManualMorphVocabulary; method: RecomposeMethodId; model: RecomposeModel } | null = null;
	/** The leap of the step that produced each piece; with each piece's own method this is what Collect records. */
	private leapOf = new WeakMap<RecomposeOutputUnit, number>();
	private output: Output | null = null;
	/** Index into the flattened units of the chosen branch point. */
	private branchAt: number | null = null;
	private busy = false;
	private disposed = false;
	private message: (() => string) | null = null;
	private method: HTMLSelectElement | null = null;
	private methodHint: HTMLElement | null = null;
	private leap: HTMLInputElement | null = null;
	private leapValue: HTMLElement | null = null;
	private sentences: HTMLSelectElement | null = null;
	private status: HTMLElement | null = null;
	private notice: HTMLElement | null = null;
	private body: HTMLElement | null = null;
	private readonly buttons = new Map<"generate" | "more" | "branch" | "copy" | "collect" | "clear", HTMLButtonElement>();

	constructor(app: App, private readonly host: RecomposeHost, private closed: (() => void) | null, private origin: HTMLElement | null) {
		super(app);
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
	private button(parent: HTMLElement, key: "generate" | "more" | "branch" | "copy" | "collect" | "clear", icon: string,
		name: () => string, action: () => void): void {
		const el = this.element(parent, "button", "semantropy-action");
		el.type = "button";
		iconLabel(el, icon, name());
		this.labels.attr(el, "aria-label", name);
		const label = el.querySelector<HTMLElement>(".semantropy-action-label");
		if (label) this.labels.text(label, name);
		this.listen(el, "click", () => { if (!el.disabled) action(); });
		this.buttons.set(key, el);
	}

	onOpen(): void {
		this.labels.bind(() => this.setTitle(ui().recompose.title));
		this.modalEl.classList.add("semantropy-recompose-modal");
		const root = this.contentEl;
		this.labels.text(this.element(root, "p", "semantropy-recompose-intro"), () => ui().recompose.intro);
		const controls = this.element(root, "div", "semantropy-recompose-controls");
		this.method = root.ownerDocument.createElement("select");
		for (const id of RECOMPOSE_METHOD_IDS) {
			const option = this.element(this.method, "option");
			option.value = id;
			this.labels.text(option, () => ui().recompose.methods[id]);
		}
		this.method.value = DEFAULT_RECOMPOSE_METHOD;
		this.field(controls, () => ui().recompose.method, this.method);
		this.leap = root.ownerDocument.createElement("input");
		Object.assign(this.leap, { type: "range", min: "0", max: "100", step: "5", value: "50" });
		this.leapValue = root.ownerDocument.createElement("span");
		this.field(controls, () => ui().recompose.leap, this.leap, this.leapValue);
		this.sentences = root.ownerDocument.createElement("select");
		for (const count of SENTENCE_CHOICES) {
			const option = this.element(this.sentences, "option");
			option.value = option.textContent = String(count);
		}
		this.sentences.value = "3";
		this.field(controls, () => ui().recompose.sentences, this.sentences);
		this.methodHint = this.element(root, "p", "semantropy-recompose-hint");
		for (const control of [this.method, this.leap]) this.listen(control, "input", () => this.sync());
		this.listen(this.method, "change", () => this.sync());

		const actions = this.element(root, "div", "semantropy-recompose-actions");
		this.button(actions, "generate", "dices", () => ui().recompose.generate, () => void this.run("new"));
		this.button(actions, "more", "list-plus", () => ui().recompose.more, () => void this.run("more"));
		this.button(actions, "branch", "git-branch", () => ui().recompose.branch, () => void this.run("branch"));
		this.status = this.element(root, "p", "semantropy-recompose-status");
		this.status.setAttribute("role", "status");
		this.status.setAttribute("aria-live", "polite");
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
		this.render();
		this.sync();
	}

	/** LOCALE1: re-words the dialog in place; the output, the choices and focus stay. */
	relabel(): void {
		if (this.disposed) return;
		this.labels.apply();
		this.render();
		this.sync();
	}

	onClose(): void {
		this.disposed = true;
		for (const off of this.off) off();
		this.off = [];
		this.labels.clear();
		this.cache = this.output = null;
		this.buttons.clear();
		this.contentEl.replaceChildren();
		const closed = this.closed; this.closed = null; closed?.();
		const origin = this.origin; this.origin = null;
		if (origin?.isConnected) origin.focus();
	}

	private say(message: (() => string) | null): void {
		this.message = message;
		if (this.status) this.status.textContent = message ? message() : "";
	}

	private selectedMethod(): RecomposeMethodId {
		const value = this.method?.value;
		return isRecomposeMethodId(value) ? value : DEFAULT_RECOMPOSE_METHOD;
	}

	/** One model per Vocabulary owner and method, from the Sources' already analyzed documents. */
	private model(owner: ManualMorphVocabulary, method: RecomposeMethodId): RecomposeModel {
		if (this.cache?.owner === owner && this.cache.method === method) return this.cache.model;
		const documents = readManualMorphSourceDocuments(owner);
		if (!documents) throw new Error("vocabulary");
		const { sources, sourceWeights } = owner.snapshot;
		const weights = new Map(sources.map((source, index) => [source.path, sourceWeights?.[index] ?? 1]));
		const corpus = recomposeCorpusFrom([...documents].sort((a, b) => (a.source.path < b.source.path ? -1 : a.source.path > b.source.path ? 1 : 0))
			.map(document => ({ path: document.source.path, contentHash: document.source.contentHash, weight: weights.get(document.source.path) ?? 1,
				projection: document.projection, located: document.located })));
		const model = createRecomposeModel(corpus, method);
		this.cache = { owner, method, model };
		return model;
	}

	async run(mode: "new" | "more" | "branch"): Promise<void> {
		if (this.busy || this.disposed) return;
		const owner = this.host.active();
		if (!owner) { this.say(() => ui().recompose.noVocabulary); return; }
		const output = this.output;
		if (mode !== "new" && output?.owner !== owner) { this.sync(); return; }
		// Captured before the await: the branch point and the output are the ones the reader chose.
		const branchAt = this.branchAt;
		if (mode === "branch" && branchAt === null) return;
		this.busy = true;
		this.say(() => ui().recompose.preparing);
		this.sync();
		try {
			await this.host.paint();
			if (this.disposed) return;
			// The output was cleared while this step waited: nothing to continue, and nothing is generated.
			if (this.output !== output) { this.say(null); return; }
			const method = this.selectedMethod(), leap = Number(this.leap?.value ?? 50), sentences = Number(this.sentences?.value ?? 3);
			const model = this.model(owner, method);
			const random = createSeededRandom(this.host.nonce());
			let paragraphs: RecomposeOutputUnit[][];
			if (mode === "new" || !output) paragraphs = [generateRecompose(model, { sentences, leap }, random)];
			else if (mode === "more") paragraphs = [...output.paragraphs, generateRecompose(model, { sentences, leap, prefix: output.paragraphs.flat() }, random)];
			else {
				// Keep everything up to the branch point, then continue that paragraph.
				const keep = branchAt! + 1;
				const kept: RecomposeOutputUnit[][] = [];
				let count = 0;
				for (const paragraph of output.paragraphs) {
					if (count >= keep) break;
					kept.push(paragraph.slice(0, keep - count));
					count += paragraph.length;
				}
				const tail = generateRecompose(model, { sentences, leap, prefix: kept.flat() }, random);
				kept[kept.length - 1] = [...kept[kept.length - 1]!, ...tail];
				paragraphs = kept;
			}
			for (const unit of paragraphs.flat()) if (!this.leapOf.has(unit)) this.leapOf.set(unit, leap);
			this.output = { owner, paragraphs };
			this.branchAt = null;
			const corpus = model.corpus;
			this.say(() => ui().recompose.ready(corpus.sources.length, corpus.sentences.length));
		} catch (error) {
			this.say(error instanceof RecomposeCorpusError && error.code === "empty" ? () => ui().recompose.tooFew : () => ui().recompose.failed);
		} finally {
			this.busy = false;
			if (!this.disposed) {
				this.render();
				// A new text starts at the top of the output box; a continuation or branch shows its new end.
				if (this.body) this.body.scrollTop = mode === "new" ? 0 : this.body.scrollHeight;
				this.sync();
			}
		}
	}

	private text(): string {
		return this.output ? this.output.paragraphs.map(paragraph => recomposeText(paragraph)).join("\n\n") : "";
	}

	async copy(): Promise<void> {
		const text = this.text();
		if (!text || this.busy) return;
		try { await this.host.copy(text); this.say(() => ui().recompose.copied); }
		catch { this.say(() => ui().recompose.copyFailed); }
	}

	/** Collects the text on screen with the provenance of the Vocabulary it came from, even if another is active now. */
	async collect(): Promise<void> {
		const output = this.output, text = this.text();
		if (!output || !text || this.busy) return;
		const collect = this.buttons.get("collect");
		if (collect) collect.disabled = true;
		try {
			const result = await this.host.collect({ metadataVersion: COLLECT_METADATA_VERSION_V5, type: "recompose", text,
				algorithmVersion: RECOMPOSE_ALGORITHM_VERSION, ...this.recorded(output),
				vocabulary: collectVocabularyFromSnapshot(output.owner.snapshot) });
			const message = collectFragmentMessage(result);
			this.say(() => localize(message));
		} catch {
			this.say(() => ui().recompose.collectFailed);
		} finally {
			if (!this.disposed) this.sync();
		}
	}

	/**
	 * What the text on screen was made with: one method, or `mixed` when its
	 * pieces came from more than one, and the smallest and largest leap used.
	 * A Branch keeps only the pieces before the branch point, so a step that
	 * contributed nothing to the text is not counted.
	 */
	private recorded(output: Output): Pick<RecomposeFragmentInputV5, "method" | "leapMin" | "leapMax"> {
		const units = output.paragraphs.flat();
		const methods = new Set(units.map(unit => unit.method));
		const leaps = units.map(unit => this.leapOf.get(unit) ?? 50);
		const [only] = methods;
		return { method: methods.size === 1 && only ? only : RECOMPOSE_MIXED_METHOD, leapMin: Math.min(...leaps), leapMax: Math.max(...leaps) };
	}

	clear(): void {
		this.output = null;
		this.branchAt = null;
		this.say(null);
		this.render();
		this.sync();
	}

	private pick(event: Event): void {
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".semantropy-recompose-unit") : null;
		if (!target || this.busy) return;
		const index = Number(target.dataset.index);
		this.mark(this.branchAt === index ? null : index);
	}

	/** Arrow keys move the branch point through the pieces; Home and End jump to the first and last. */
	private step(event: KeyboardEvent): void {
		const count = this.body?.querySelectorAll(".semantropy-recompose-unit").length ?? 0;
		if (this.busy || count === 0) return;
		const current = this.branchAt;
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
		this.branchAt = index;
		for (const span of Array.from(this.body?.querySelectorAll<HTMLElement>(".semantropy-recompose-unit") ?? [])) {
			const chosen = Number(span.dataset.index) === index;
			span.classList.toggle("is-branch", chosen);
			if (chosen) span.scrollIntoView?.({ block: "nearest" });
		}
		this.sync();
	}

	private render(): void {
		const body = this.body;
		if (!body) return;
		if (!this.output) {
			const empty = body.ownerDocument.createElement("p");
			empty.className = "semantropy-recompose-empty";
			empty.textContent = ui().recompose.empty;
			body.replaceChildren(empty);
			return;
		}
		let index = 0;
		const blocks = this.output.paragraphs.map(paragraph => {
			const p = body.ownerDocument.createElement("p");
			for (const unit of paragraph) {
				const span = this.element(p, "span", "semantropy-recompose-unit");
				span.textContent = unit.text;
				span.dataset.index = String(index);
				if (index === this.branchAt) span.classList.add("is-branch");
				index += 1;
			}
			return p;
		});
		const hint = body.ownerDocument.createElement("p");
		hint.className = "semantropy-recompose-hint";
		hint.textContent = ui().recompose.pickHint;
		body.replaceChildren(...blocks, hint);
	}

	/** Availability, the method hint, the leap value and the Vocabulary note; never the output text. */
	sync(): void {
		if (this.disposed || !this.status) return;
		const active = this.host.active();
		const output = this.output;
		const same = output !== null && output.owner === active;
		const set = (key: "generate" | "more" | "branch" | "copy" | "collect" | "clear", enabled: boolean) => {
			const button = this.buttons.get(key);
			if (button) button.disabled = this.busy || !enabled;
		};
		set("generate", active !== null);
		set("more", same);
		set("branch", same && this.branchAt !== null);
		set("copy", output !== null);
		set("collect", output !== null);
		set("clear", output !== null);
		if (this.leapValue && this.leap) this.leapValue.textContent = this.leap.value;
		if (this.methodHint) this.methodHint.textContent = ui().recompose.methodHints[this.selectedMethod()];
		if (this.notice) {
			this.notice.textContent = output !== null && !same ? ui().recompose.changed : "";
			this.notice.hidden = this.notice.textContent === "";
		}
		if (this.message) this.status.textContent = this.message();
	}
}
