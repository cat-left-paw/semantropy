import { analyzeSelectedSource } from "../../../src/application/analyzeSelectedSource";
import { issueUint32Seed, createSeededRandom } from "../../../src/random/seededRandom";
import { RecomposeCorpusError, type RecomposeSourceInput } from "../../../src/recompose/recomposeCorpus";
import {
	DEFAULT_RECOMPOSE_METHOD,
	RECOMPOSE_METHOD_IDS,
	createRecomposeModel,
	generateRecompose,
	recomposeCorpusFrom,
	recomposeText,
	type RecomposeMethodId,
	type RecomposeModel,
	type RecomposeOutputUnit,
} from "../../../src/recompose/recompose";
import type { WebSemantropyHost } from "../host/WebSemantropyHost";
import { createIcon } from "../obsidian/icons";
import { t } from "./webText";

const WEIGHTS = [0.25, 0.5, 1, 2, 4] as const;

type Analyzed = { text: string; input: RecomposeSourceInput };

/**
 * The web page's Recompose panel. It chooses texts from the
 * page's library, analyzes them with the same analyzer and tokenizer the View
 * uses, and asks the shared `src/recompose/` core for sentences.
 *
 * Output is kept as units with provenance, so "Continue" and "Branch" hand the
 * core exactly what it produced. Everything is written with `textContent`.
 */
export class RecomposePanel {
	readonly el: HTMLElement;
	private readonly labels: (() => void)[] = [];
	private readonly selected = new Map<string, number>();
	private readonly analyses = new Map<string, Analyzed>();
	private model: RecomposeModel | null = null;
	private modelKey = "";
	private paragraphs: RecomposeOutputUnit[][] = [];
	/** Index into the flattened units of the chosen branch point, or null. */
	private branchAt: number | null = null;
	private busy = false;
	private sourceList!: HTMLElement;
	private methodSelect!: HTMLSelectElement;
	private methodHint!: HTMLElement;
	private leapInput!: HTMLInputElement;
	private leapValue!: HTMLElement;
	private sentencesSelect!: HTMLSelectElement;
	private status!: HTMLElement;
	private output!: HTMLElement;
	private seams!: HTMLInputElement;
	private readonly buttons = new Map<string, HTMLButtonElement>();

	constructor(
		private readonly host: WebSemantropyHost,
		private readonly openAsTarget: (name: string, text: string) => void,
	) {
		this.el = document.createElement("div");
		this.el.className = "sw-recompose";
		this.build();
		this.host.library.onEvent((event) => {
			if (event.kind === "listed") this.fillSources();
			if (event.kind === "lost") this.selected.delete(event.path);
			// The buttons follow the selection, so a pre-selected or lost text updates them at once.
			this.sync();
		});
	}

	/** Pre-selects a text when nothing is chosen yet. */
	suggest(path: string | null): void {
		if (path && this.selected.size === 0 && this.host.library.has(path)) {
			this.selected.set(path, 1);
			this.fillSources();
			this.sync();
		}
	}

	relabel(): void {
		for (const apply of this.labels) apply();
		this.fillSources();
		this.renderOutput();
		this.sync();
	}

	// ─── build ──────────────────────────────────────────────────────

	private build(): void {
		const heading = el("h2", "sw-heading");
		this.text(heading, () => t().recompose.heading);
		const intro = el("p", "sw-hint");
		this.text(intro, () => t().recompose.intro);

		const sourcesLabel = el("h3", "sw-subheading");
		this.text(sourcesLabel, () => t().recompose.sources);
		this.sourceList = el("ul", "sw-rc-sources");

		const controls = el("div", "sw-rc-controls");
		this.methodSelect = document.createElement("select");
		this.methodSelect.addEventListener("change", () => this.sync());
		this.methodHint = el("p", "sw-hint sw-rc-method-hint");
		this.leapInput = document.createElement("input");
		this.leapInput.type = "range";
		this.leapInput.min = "0";
		this.leapInput.max = "100";
		this.leapInput.step = "5";
		this.leapInput.value = "50";
		this.leapValue = el("span", "sw-rc-leap-value");
		this.leapInput.addEventListener("input", () => this.sync());
		this.sentencesSelect = document.createElement("select");
		for (const count of [1, 3, 5, 10]) {
			const option = document.createElement("option");
			option.value = String(count);
			option.textContent = String(count);
			this.sentencesSelect.appendChild(option);
		}
		this.sentencesSelect.value = "3";
		controls.append(
			this.field(() => t().recompose.method, this.methodSelect),
			this.methodHint,
			this.field(() => t().recompose.leap, this.leapInput, this.leapValue),
			this.field(() => t().recompose.sentences, this.sentencesSelect),
		);

		const actions = el("div", "sw-row sw-rc-actions");
		actions.append(
			this.button("generate", "sparkles", () => t().recompose.generate, () => void this.run("new"), "mod-cta"),
			this.button("more", "list-plus", () => t().recompose.more, () => void this.run("more")),
			this.button("branch", "git-branch", () => t().recompose.branch, () => void this.run("branch")),
		);
		const secondary = el("div", "sw-row sw-rc-actions");
		const seamsLabel = el("label", "sw-rc-seams");
		this.seams = document.createElement("input");
		this.seams.type = "checkbox";
		this.seams.addEventListener("change", () => this.output.classList.toggle("is-showing-seams", this.seams.checked));
		const seamsText = el("span", "");
		this.text(seamsText, () => t().recompose.showSeams);
		seamsLabel.append(this.seams, seamsText);
		secondary.append(
			this.button("copy", "copy", () => t().recompose.copy, () => void this.copy()),
			this.button("target", "file-input", () => t().recompose.openAsTarget, () => this.toTarget()),
			this.button("clear", "trash-2", () => t().recompose.clear, () => this.clear()),
			seamsLabel,
		);

		this.status = el("p", "sw-hint sw-rc-status");
		this.status.setAttribute("role", "status");
		this.output = el("div", "sw-rc-output");
		this.output.addEventListener("click", (event) => this.pick(event));

		this.el.append(heading, intro, sourcesLabel, this.sourceList, controls, actions, this.status, this.output, secondary);
		this.labels.push(() => {
			const current = this.methodSelect.value || DEFAULT_RECOMPOSE_METHOD;
			this.methodSelect.replaceChildren(...RECOMPOSE_METHOD_IDS.map((id) => {
				const option = document.createElement("option");
				option.value = id;
				option.textContent = t().recompose.methods[id];
				return option;
			}));
			this.methodSelect.value = current;
		});
		this.relabel();
	}

	private field(label: () => string, ...controls: HTMLElement[]): HTMLElement {
		const wrap = el("label", "sw-rc-field");
		const name = el("span", "sw-field-label");
		this.text(name, label);
		wrap.append(name, ...controls);
		return wrap;
	}

	private fillSources(): void {
		const items = this.host.library.list().map((doc) => {
			const item = document.createElement("li");
			const label = el("label", "sw-rc-source");
			const box = document.createElement("input");
			box.type = "checkbox";
			box.checked = this.selected.has(doc.path);
			const name = el("span", "sw-rc-source-name");
			name.textContent = doc.name;
			const weight = document.createElement("select");
			weight.className = "sw-rc-weight";
			weight.setAttribute("aria-label", `${t().recompose.weight}: ${doc.name}`);
			for (const value of WEIGHTS) {
				const option = document.createElement("option");
				option.value = String(value);
				option.textContent = `×${value}`;
				weight.appendChild(option);
			}
			weight.value = String(this.selected.get(doc.path) ?? 1);
			weight.disabled = !box.checked;
			box.addEventListener("change", () => {
				if (box.checked) this.selected.set(doc.path, Number(weight.value));
				else this.selected.delete(doc.path);
				weight.disabled = !box.checked;
				this.sync();
			});
			weight.addEventListener("change", () => {
				if (this.selected.has(doc.path)) this.selected.set(doc.path, Number(weight.value));
			});
			label.append(box, name);
			item.append(label, weight);
			return item;
		});
		this.sourceList.replaceChildren(...items);
	}

	// ─── generation ─────────────────────────────────────────────────

	private async run(mode: "new" | "more" | "branch"): Promise<void> {
		if (this.busy) return;
		if (this.selected.size === 0) {
			this.status.textContent = t().recompose.noSources;
			return;
		}
		this.busy = true;
		this.sync();
		try {
			const model = await this.ensureModel();
			if (!model) return;
			const sentences = Number(this.sentencesSelect.value);
			const leap = Number(this.leapInput.value);
			const random = createSeededRandom(issueUint32Seed());
			if (mode === "new") {
				this.paragraphs = [generateRecompose(model, { sentences, leap }, random)];
			} else if (mode === "more") {
				const prefix = this.paragraphs.flat();
				this.paragraphs.push(generateRecompose(model, { sentences, leap, prefix }, random));
			} else if (this.branchAt !== null) {
				const flat = this.paragraphs.flat();
				const keep = this.branchAt + 1;
				const prefix = flat.slice(0, keep);
				// Keep the paragraphs up to the branch point, then add the new tail to that paragraph.
				const kept: RecomposeOutputUnit[][] = [];
				let count = 0;
				for (const paragraph of this.paragraphs) {
					if (count >= keep) break;
					kept.push(paragraph.slice(0, keep - count));
					count += paragraph.length;
				}
				const tail = generateRecompose(model, { sentences, leap, prefix }, random);
				kept[kept.length - 1] = [...kept[kept.length - 1]!, ...tail];
				this.paragraphs = kept;
			}
			this.branchAt = null;
			this.renderOutput();
			// The output scrolls inside its own box: a new text starts at the top, a continuation shows its new end.
			this.output.scrollTop = mode === "new" ? 0 : this.output.scrollHeight;
		} catch (error) {
			this.status.textContent = error instanceof RecomposeCorpusError && error.code === "empty" ? t().recompose.tooFew : t().recompose.failed;
		} finally {
			this.busy = false;
			this.sync();
		}
	}

	private async ensureModel(): Promise<RecomposeModel | null> {
		const method = (this.methodSelect.value || DEFAULT_RECOMPOSE_METHOD) as RecomposeMethodId;
		const paths = [...this.selected.keys()].filter((path) => this.host.library.has(path)).sort();
		const inputs: RecomposeSourceInput[] = [];
		let done = 0;
		for (const path of paths) {
			this.status.textContent = t().recompose.preparing(done, paths.length);
			const text = await this.host.library.readText(path);
			let analyzed = this.analyses.get(path);
			if (!analyzed || analyzed.text !== text) {
				const result = await analyzeSelectedSource({ text, sourcePath: path, contentHash: String(hashCode(text)), tokenizer: this.host.tokenizer, mode: "target-prototype" });
				if (result.status !== "ready") throw new Error("analysis");
				analyzed = { text, input: { path, contentHash: String(hashCode(text)), projection: result.projection, located: result.located } };
				this.analyses.set(path, analyzed);
			}
			inputs.push({ ...analyzed.input, weight: this.selected.get(path) ?? 1 });
			done += 1;
		}
		const key = JSON.stringify([method, inputs.map((input) => [input.path, input.contentHash, input.weight])]);
		if (!this.model || this.modelKey !== key) {
			this.model = createRecomposeModel(recomposeCorpusFrom(inputs), method);
			this.modelKey = key;
		}
		this.status.textContent = t().recompose.ready(this.model.corpus.sources.length, this.model.corpus.sentences.length);
		return this.model;
	}

	// ─── output ─────────────────────────────────────────────────────

	private renderOutput(): void {
		if (this.paragraphs.length === 0) {
			const empty = el("p", "sw-empty");
			empty.textContent = t().recompose.empty;
			this.output.replaceChildren(empty);
			return;
		}
		let index = 0;
		const blocks = this.paragraphs.map((paragraph) => {
			const p = el("p", "sw-rc-paragraph");
			for (const unit of paragraph) {
				const span = el("span", "sw-rc-unit");
				span.textContent = unit.text;
				span.dataset.index = String(index);
				if (unit.jump) span.classList.add("is-jump");
				if (index === this.branchAt) span.classList.add("is-branch");
				p.appendChild(span);
				index += 1;
			}
			return p;
		});
		const hint = el("p", "sw-hint");
		hint.textContent = t().recompose.pickHint;
		this.output.replaceChildren(...blocks, hint);
	}

	private pick(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".sw-rc-unit") : null;
		if (!target || this.busy) return;
		const index = Number(target.dataset.index);
		this.branchAt = this.branchAt === index ? null : index;
		for (const span of this.output.querySelectorAll<HTMLElement>(".sw-rc-unit")) span.classList.toggle("is-branch", Number(span.dataset.index) === this.branchAt);
		this.sync();
	}

	private outputText(): string {
		return this.paragraphs.map((paragraph) => recomposeText(paragraph)).join("\n\n");
	}

	private async copy(): Promise<void> {
		const text = this.outputText();
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			this.host.notice(t().recompose.copied);
		} catch {
			this.host.notice(t().errors.clipboardFailed);
		}
	}

	private toTarget(): void {
		const text = this.outputText();
		if (text) this.openAsTarget(t().recompose.targetName, text);
	}

	private clear(): void {
		this.paragraphs = [];
		this.branchAt = null;
		this.renderOutput();
		this.sync();
	}

	private sync(): void {
		const hasOutput = this.paragraphs.length > 0;
		const set = (key: string, enabled: boolean) => {
			const button = this.buttons.get(key);
			if (button) button.disabled = this.busy || !enabled;
		};
		set("generate", this.selected.size > 0);
		set("more", hasOutput && this.selected.size > 0);
		set("branch", hasOutput && this.branchAt !== null && this.selected.size > 0);
		set("copy", hasOutput);
		set("target", hasOutput);
		set("clear", hasOutput);
		this.leapValue.textContent = t().recompose.leapValue(Number(this.leapInput.value));
		const method = (this.methodSelect.value || DEFAULT_RECOMPOSE_METHOD) as RecomposeMethodId;
		this.methodHint.textContent = t().recompose.methodHints[method];
	}

	// ─── helpers ────────────────────────────────────────────────────

	private text(target: HTMLElement, value: () => string): void {
		const apply = (): void => {
			target.textContent = value();
		};
		apply();
		this.labels.push(apply);
	}

	private button(key: string, icon: string, label: () => string, action: () => void, extra = ""): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `sw-button ${extra}`.trim();
		const glyph = el("span", "sw-button-icon");
		glyph.appendChild(createIcon(icon));
		const text = el("span", "sw-button-label");
		button.append(glyph, text);
		const apply = (): void => {
			text.textContent = label();
			button.setAttribute("aria-label", label());
		};
		apply();
		this.labels.push(apply);
		button.addEventListener("click", () => {
			if (!button.disabled) action();
		});
		this.buttons.set(key, button);
		return button;
	}
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) element.className = className;
	return element;
}

/** A cheap identity for cache keys; the analyzer's own hash is not needed here. */
function hashCode(text: string): number {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
	return hash >>> 0;
}
