import type { LocatedAnalysisDocument } from "../analysis/locateTokens";
import type { AnalysisRun, Utf16Range } from "../analysis/rubyAnalysis";
import { chooseRubyVariant, rangesOverlap, resolveVocabularyCandidate, type RubyVocabulary } from "../analysis/rubyVocabulary";
import type { SelectedVocabularyCandidate } from "../transform/transformTokens";
import type { DomAnalysisDocument } from "./buildAnalysisDocument";
import { isProtectedElement } from "./collectTextNodes";

type RunBinding = {
	run: AnalysisRun;
	host: HTMLSpanElement;
	template: HTMLSpanElement;
};

function textNodes(root: Node): Text[] {
	const walker = root.ownerDocument!.createTreeWalker(root, 4);
	const result: Text[] = [];
	let node = walker.nextNode();
	while (node) { result.push(node as Text); node = walker.nextNode(); }
	return result;
}

function assert(condition: unknown): asserts condition {
	if (!condition) throw new Error("Ruby display mapping is invalid.");
}

/** Logical UTF-16 ranges in an already-normalized detached inline fragment. */
function textRange(root: Node, range: Utf16Range): Range {
	assert(Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.start < range.end);
	const result = root.ownerDocument!.createRange();
	let cursor = 0;
	let started = false;
	for (const node of textNodes(root)) {
		const end = cursor + node.length;
		if (!started && range.start < end) { result.setStart(node, range.start - cursor); started = true; }
		if (started && range.end <= end) { result.setEnd(node, range.end - cursor); return result; }
		cursor = end;
	}
	throw new Error("Ruby display range is uncovered.");
}

function wrapRuby(root: Node, range: Utf16Range, reading: string, notation: string): void {
	const selected = textRange(root, range);
	const ruby = root.ownerDocument!.createElement("ruby");
	ruby.dataset.semantropyRuby = notation;
	ruby.append(selected.extractContents());
	const rt = root.ownerDocument!.createElement("rt");
	rt.textContent = reading;
	ruby.append(rt);
	selected.insertNode(ruby);
}

/**
 * Owns only ordinary inline runs. Protected nodes and their Obsidian render
 * owners/listeners are neither cloned nor replaced. All preparation is detached.
 */
export class RubyBodyRenderer {
	private readonly runs: RunBinding[];
	private revision = 0;

	constructor(private readonly root: HTMLElement, dom: DomAnalysisDocument) {
		assert(!root.isConnected);
		this.runs = [];
		// Reverse document order keeps the yet-to-be-extracted source bindings valid.
		for (const run of [...dom.document.runs].reverse()) {
			const ids = [...new Set(run.sourceParts.map((p) => p.source.sourceId))];
			const sources = ids.map((id) => dom.bindings.get(id)!.node);
			const first = sources[0]; const last = sources[sources.length - 1];
			assert(first && last && root.contains(first) && root.contains(last));
			const range = root.ownerDocument.createRange();
			const firstRuby = first.parentElement?.closest("ruby");
			const lastRuby = last.parentElement?.closest("ruby");
			if (firstRuby) range.setStartBefore(firstRuby); else range.setStart(first, 0);
			if (lastRuby) range.setEndAfter(lastRuby); else range.setEnd(last, last.length);
			const fragment = range.cloneContents();
			const copies = textNodes(fragment).filter((node) => node.length > 0);
			assert(copies.length === sources.length);
			const host = root.ownerDocument.createElement("span");
			host.className = "semantropy-analysis-run";
			host.append(fragment);
			// No live components, custom elements or protected descendants can enter
			// a commit fragment (their lifecycle callbacks could re-enter a commit).
			for (const element of Array.from(host.querySelectorAll("*"))) {
				assert(!isProtectedElement(element) && !element.localName.includes("-") && !element.hasAttribute("is"));
			}
			for (const [index, sourceId] of ids.entries()) {
				const copy = copies[index]!;
				assert(copy.data === sources[index]!.data);
				const parts = run.sourceParts.filter((p) => p.source.sourceId === sourceId);
				assert(parts.map((p) => p.text).join("") === copy.data);
				assert(parts.every((p) => copy.data.slice(p.source.range.start, p.source.range.end) === p.text));
				const replacement = root.ownerDocument.createDocumentFragment();
				for (const part of parts) {
					if (part.kind === "text" || part.kind === "ruby-base") replacement.append(part.text);
				}
				copy.replaceWith(replacement);
			}
			// Every ruby in an accepted run has already been classified by the IR.
			// Escaped explicit ruby is literal: its rt text was kept as kind=text.
			for (const element of Array.from(host.querySelectorAll("ruby, rb, rt, rp")).reverse()) {
				element.replaceWith(...Array.from(element.childNodes));
			}
			assert(host.textContent === run.analysisText);
			const template = host.cloneNode(true) as HTMLSpanElement;
			// Only the detached initial render is changed here. A failure never
			// publishes this root; the caller releases its render owner.
			range.deleteContents(); range.insertNode(host);
			this.runs.unshift({ run, host, template });
		}
	}

	get sequenceCount(): number { return this.runs.length; }

	prepare(input: {
		located: LocatedAnalysisDocument; vocabulary: RubyVocabulary;
		surfaces: readonly (readonly string[])[]; seed: number;
		selections: readonly (readonly (SelectedVocabularyCandidate | null)[])[];
		isCurrent: () => boolean;
	}): (() => "applied" | "stale") | null {
		if (!input.isCurrent() || input.surfaces.length !== this.runs.length || input.selections.length !== this.runs.length) return null;
		const revision = this.revision;
		const connected = this.root.isConnected;
		const patches = this.runs.map((binding, index) => {
			assert(this.root.contains(binding.host));
			const located = input.located.runs[index];
			const surfaces = input.surfaces[index];
			const selections = input.selections[index];
			assert(located?.run === binding.run && surfaces?.length === located.tokens.length && selections?.length === located.tokens.length);
			const copy = binding.template.cloneNode(true) as HTMLSpanElement;
			const changed = located.tokens.filter((item, i) => surfaces[i] !== item.token.surface);
			const operations: Array<{ range: Utf16Range; apply: () => void }> = [];
			for (const annotation of binding.run.annotations) {
				if (!changed.some((item) => rangesOverlap(item.range, annotation.baseRange))) {
					operations.push({ range: annotation.baseRange, apply: () => wrapRuby(copy, annotation.baseRange, annotation.reading, annotation.notation) });
				}
			}
			for (const [tokenIndex, item] of located.tokens.entries()) {
				const surface = surfaces[tokenIndex]!;
				const selection = selections[tokenIndex];
				if (surface === item.token.surface) { assert(selection === null); continue; }
				assert(selection && selection.surface === surface);
				resolveVocabularyCandidate({ vocabulary: input.vocabulary, original: item.token, selection });
				const overlapsMulti = binding.run.annotations.some((annotation) =>
					rangesOverlap(annotation.baseRange, item.range) &&
					(annotation.baseRange.start < item.range.start || annotation.baseRange.end > item.range.end));
				const variant = overlapsMulti ? null : chooseRubyVariant({
					vocabulary: input.vocabulary, original: item.token, selection, seed: input.seed, tokenId: item.tokenId,
				});
				operations.push({ range: item.range, apply: () => {
					const selected = textRange(copy, item.range);
					const fragment = selected.extractContents();
					const nodes = textNodes(fragment);
					assert(nodes.length > 0);
					// Preserve inline decoration. Distribute the replacement over the
					// original visual parts; the final part receives the remaining text.
					let cursor = 0;
					for (const [i, node] of nodes.entries()) {
						let end = i === nodes.length - 1 ? surface.length : Math.min(surface.length, cursor + node.length);
						if (end > cursor && /[\uD800-\uDBFF]/u.test(surface[end - 1] ?? "")) end += 1;
						const part = this.root.ownerDocument.createElement("span");
						part.dataset.semantropyToken = item.tokenId;
						part.textContent = surface.slice(cursor, end);
						node.replaceWith(part); cursor = end;
					}
					assert(fragment.textContent === surface);
					if (variant) wrapRuby(fragment, variant.baseRangeInSurface, variant.reading, variant.sourceNotations[0] ?? "html");
					selected.insertNode(fragment);
				} });
			}
			// Higher ranges are edited first, so lower UTF-16 coordinates stay valid.
			operations.sort((a, b) => b.range.start - a.range.start);
			for (const operation of operations) operation.apply();
			const fragment = this.root.ownerDocument.createDocumentFragment();
			fragment.append(...Array.from(copy.childNodes));
			return { host: binding.host, parent: binding.host.parentNode,
				children: Array.from(binding.host.childNodes), snapshot: binding.host.cloneNode(true), fragment };
		});
		return () => {
			if (!input.isCurrent() || revision !== this.revision || connected !== this.root.isConnected ||
				patches.some((p) => !this.root.contains(p.host) || p.host.parentNode !== p.parent ||
					!p.host.isEqualNode(p.snapshot) ||
					p.host.childNodes.length !== p.children.length || p.children.some((n, i) => p.host.childNodes[i] !== n))) return "stale";
			// All nodes and fragments are prevalidated standard DOM. No async work,
			// user callback or custom-element lifecycle occurs between these writes.
			for (const patch of patches) Element.prototype.replaceChildren.call(patch.host, patch.fragment);
			this.revision += 1;
			return "applied";
		};
	}
}
