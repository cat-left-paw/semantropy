import type { DisplaySlot } from "./displaySlots";
import type { LocatedAnalysisDocument, LocatedToken } from "./locateTokens";
import type { MarkdownSourceBinding, MarkdownSourceProjection, PresentationDecoration } from "./projectMarkdownSource";
import type { SourcePartRef, Utf16Range } from "./rubyAnalysis";
import { chooseRubyVariant, freezeAnalysis, rangesOverlap, resolveVocabularyCandidate, type CandidateDrawContext, type RubyVocabulary, type VerifiedRubyVariant } from "./rubyVocabulary";
import type { SelectedVocabularyCandidate } from "../transform/transformTokens";

export type SafeTag = "div" | "p" | "pre" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "span" | "em" | "strong" | "del" | "code" | "br" | "ruby" | "rt";
export type PresentationText = {
	kind: "text"; text: string; logical: boolean;
	rawRanges: readonly Utf16Range[]; sourceParts: readonly SourcePartRef[];
	runId?: string; tokenId?: string; analysisRange?: Utf16Range;
	/** A replacement associates a whole original range, not a guessed character map. */
	replacement?: boolean;
};
export type PresentationElement = { kind: "element"; tag: SafeTag; children: readonly PresentationNode[]; annotationId?: string; notation?: string; tokenId?: string };
export type PresentationNode = PresentationText | PresentationElement;
export type TargetDisplayPlan = { root: PresentationElement; logicalText: string };
type Atom = { leaf: PresentationText; start: number; end: number; styles: readonly PresentationDecoration[] };
type DisplayRuby = { range: Utf16Range; reading: string; annotationId: string; notation: string; sourceParts?: readonly SourcePartRef[] };

/**
 * Static lookups for one Target analysis, built once and reused by every plan
 * of that analysis. They replace per-token whole-array scans; they never add
 * identity, provenance or persisted state.
 */
export type TargetPlanIndex = {
	readonly projection: MarkdownSourceProjection;
	readonly located: LocatedAnalysisDocument;
	readonly bindings: ReadonlyMap<string, MarkdownSourceBinding>;
	readonly runs: readonly {
		/** Decorations that can contain some raw range of this run, in parse order. */
		readonly decorations: readonly PresentationDecoration[];
		/** Per annotation (by index): its reading source parts, in sourceParts order. */
		readonly readingParts: readonly (readonly SourcePartRef[])[];
		/** Per token: overlapped by an annotation that extends beyond the token. */
		readonly multiTokenAnnotation: readonly boolean[];
	}[];
};

function assert(value: unknown): asserts value {
	if (!value) throw new Error("Safe Target presentation mapping is invalid.");
}
const element = (tag: SafeTag, children: readonly PresentationNode[]): PresentationElement => ({ kind: "element", tag, children });
const literal = (text: string, logical = true, rawRanges: readonly Utf16Range[] = []): PresentationText =>
	({ kind: "text", text, logical, rawRanges, sourceParts: [] });

/** First token whose range ends after `position`; tokens are contiguous and ordered. */
function firstTokenEndingAfter(tokens: readonly LocatedToken[], position: number): number {
	let low = 0, high = tokens.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (tokens[middle]!.range.end > position) high = middle; else low = middle + 1;
	}
	return low;
}

export function createTargetPlanIndex(projection: MarkdownSourceProjection, located: LocatedAnalysisDocument): TargetPlanIndex {
	assert(located.document === projection.document);
	const bindings = new Map(projection.bindings.map(b => [b.sourceId, b]));
	const runs = located.runs.map(({ run, tokens }) => {
		// Any decoration containing a (non-empty) raw range of this run overlaps
		// the run's raw extent, so filtering here keeps every per-atom result.
		let start = Infinity, end = -Infinity;
		for (const segment of run.mapping) {
			const binding = bindings.get(segment.sourcePart.sourceId);
			if (!binding) continue;
			start = Math.min(start, binding.rawRange.start + segment.sourcePart.range.start);
			end = Math.max(end, binding.rawRange.start + segment.sourcePart.range.end);
		}
		const decorations = projection.presentation.decorations.filter(d => d.rawRange.start < end && start < d.rawRange.end);
		const owners = new Map<string, Set<number>>();
		for (const [index, annotation] of run.annotations.entries()) {
			for (const part of annotation.originalParts) {
				const set = owners.get(part.partId) ?? new Set<number>();
				set.add(index); owners.set(part.partId, set);
			}
		}
		const readingParts: SourcePartRef[][] = run.annotations.map(() => []);
		for (const part of run.sourceParts) {
			if (part.kind !== "ruby-reading") continue;
			for (const index of owners.get(part.partId) ?? []) readingParts[index]!.push(part.source);
		}
		const multiTokenAnnotation = tokens.map(() => false);
		for (const annotation of run.annotations) {
			const base = annotation.baseRange;
			for (let i = firstTokenEndingAfter(tokens, base.start); i < tokens.length && tokens[i]!.range.start < base.end; i += 1) {
				const range = tokens[i]!.range;
				if (rangesOverlap(base, range) && (base.start < range.start || base.end > range.end)) multiTokenAnnotation[i] = true;
			}
		}
		return { decorations, readingParts, multiTokenAnnotation };
	});
	return { projection, located, bindings, runs };
}

/** Pure display planning of one analysis run. Consumes the original parse and located tokens, never DOM. */
export function planTargetRun(index: TargetPlanIndex, runIndex: number, input: {
	vocabulary: RubyVocabulary; surfaces: readonly string[]; selections: readonly (SelectedVocabularyCandidate | null)[];
	seed: number; context?: CandidateDrawContext;
}): PresentationElement {
 const tokens = index.located.runs[runIndex]!.tokens;
 const variants = tokens.map((token, i) => {
  const selection = input.selections[i];
  if (input.surfaces[i] === token.token.surface) { assert(selection === null); return null; }
  assert(selection && selection.surface === input.surfaces[i]);
  resolveVocabularyCandidate({ vocabulary: input.vocabulary, original: token.token, selection });
  return chooseRubyVariant({ vocabulary: input.vocabulary, original: token.token, selection, seed: input.seed, tokenId: token.tokenId, context: input.context });
 });
 return planRun(index, runIndex, input.surfaces, variants);
}

/** Production consumes the exact slot draw, including its already verified Ruby pair. */
export function planTargetSlotRun(index: TargetPlanIndex, runIndex: number, slots: readonly DisplaySlot[]): PresentationElement {
 const sequence = index.located.runs[runIndex];
 assert(sequence && slots.length === sequence.tokens.length);
 slots.forEach((slot, i) => {
  const token = sequence.tokens[i]!;
  assert(slot.tokenId === token.tokenId && slot.runId === sequence.run.runId &&
   slot.originalRange.start === token.range.start && slot.originalRange.end === token.range.end &&
   slot.originalToken.surface === token.token.surface);
 });
 return planRun(index, runIndex, slots.map(s => s.displaySurface), slots.map(s => s.displayRuby),
	 slots.map(s => s.manualOverride?.kind === "replacement" || (!s.manualOverride && s.automaticReplaced)));
}

function planRun(index: TargetPlanIndex, runIndex: number, surfaces: readonly string[], variants: readonly (VerifiedRubyVariant | null)[], semanticReplacements?: readonly boolean[]): PresentationElement {
	const sequence = index.located.runs[runIndex], info = index.runs[runIndex];
	assert(sequence && info);
	const { run, tokens } = sequence;
	assert(surfaces.length === tokens.length && variants.length === tokens.length);
	assert(tokens.map(t => t.token.surface).join("") === run.analysisText);
	const replaced = semanticReplacements ?? tokens.map((t, i) => surfaces[i] !== t.token.surface);
	const atoms: Atom[] = [], rubies: DisplayRuby[] = [];
	const positions: { original: Utf16Range; display: Utf16Range }[] = [];
	let display = 0, mapIndex = 0, original = 0;
	for (const [i, token] of tokens.entries()) {
		const surface = surfaces[i]!;
		assert(typeof surface === "string" && surface.length > 0 && token.range.start === original && token.range.end === original + token.token.surface.length);
		original = token.range.end;
		const replacement = replaced[i]!;
		if (replacement) {
			const variant = info.multiTokenAnnotation[i] ? null : variants[i];
			if (variant) {
				assert(variant.baseRangeInSurface.start >= 0 && variant.baseRangeInSurface.start < variant.baseRangeInSurface.end && variant.baseRangeInSurface.end <= surface.length);
				rubies.push({ range: { start: display + variant.baseRangeInSurface.start, end: display + variant.baseRangeInSurface.end }, reading: variant.reading, annotationId: variant.variantId, notation: variant.sourceNotations[0] ?? "html" });
			}
		}
		positions.push({ original: token.range, display: { start: display, end: display + surface.length } });
		let used = 0;
		while (mapIndex < run.mapping.length && run.mapping[mapIndex]!.analysisRange.end <= token.range.start) mapIndex += 1;
		for (let m = mapIndex; m < run.mapping.length; m += 1) {
			const mapping = run.mapping[m]!;
			if (mapping.analysisRange.start >= token.range.end) break;
			const start = Math.max(token.range.start, mapping.analysisRange.start), end = Math.min(token.range.end, mapping.analysisRange.end);
			const ref = mapping.sourcePart, binding = index.bindings.get(ref.sourceId)!;
			assert(binding && end > start);
			const sourceStart = ref.range.start + start - mapping.analysisRange.start;
			const rawRange = { start: binding.rawRange.start + sourceStart, end: binding.rawRange.start + sourceStart + end - start };
			assert(binding.text.slice(sourceStart, sourceStart + end - start) === run.analysisText.slice(start, end));
			let next = end === token.range.end ? surface.length : Math.min(surface.length, used + end - start);
			if (next > used && /[\uD800-\uDBFF]/u.test(surface[next - 1] ?? "")) next += 1;
			const text = surface.slice(used, next);
			if (text) atoms.push({ start: display + used, end: display + next,
				styles: info.decorations.filter(d => d.rawRange.start <= rawRange.start && rawRange.end <= d.rawRange.end),
				leaf: { kind: "text", text, logical: true, runId: run.runId, tokenId: token.tokenId, replacement,
					analysisRange: replacement ? token.range : { start, end }, rawRanges: [rawRange],
					sourceParts: [{ ...ref, range: { start: sourceStart, end: sourceStart + end - start } }] } });
			used = next;
		}
		assert(used === surface.length); display += surface.length;
	}
	// Same result as the first position whose original range contains `position`.
	const offset = (position: number): number => {
		let low = 0, high = positions.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (positions[middle]!.original.end >= position) high = middle; else low = middle + 1;
		}
		const item = positions[low];
		assert(item && item.original.start <= position && position <= item.original.end);
		return position === item.original.end ? item.display.end : item.display.start + position - item.original.start;
	};
	for (const [a, annotation] of run.annotations.entries()) {
		const base = annotation.baseRange;
		let changed = false;
		for (let i = firstTokenEndingAfter(tokens, base.start); !changed && i < tokens.length && tokens[i]!.range.start < base.end; i += 1) {
			changed = replaced[i]! && rangesOverlap(tokens[i]!.range, base);
		}
		if (changed) continue;
		rubies.push({ range: { start: offset(base.start), end: offset(base.end) }, reading: annotation.reading, annotationId: annotation.annotationId, notation: annotation.notation,
			sourceParts: info.readingParts[a]! });
	}
	rubies.sort((a, b) => a.range.start - b.range.start);
	assert(rubies.every((r, i) => r.range.start >= (rubies[i - 1]?.range.end ?? 0) && r.range.end <= display));
	const children: PresentationNode[] = [];
	let rubyIndex = 0;
	let rubyChildren: PresentationNode[] = [];
	for (const atom of atoms) {
		let start = atom.start;
		while (start < atom.end) {
			const ruby = rubies[rubyIndex];
			const inside = !!ruby && start >= ruby.range.start && start < ruby.range.end;
			const end = Math.min(atom.end, ruby ? inside ? ruby.range.end : ruby.range.start : atom.end);
			assert(end > start);
			const delta = start - atom.start, length = end - start;
			let leaf = { ...atom.leaf, text: atom.leaf.text.slice(delta, delta + length) };
			if (!leaf.replacement) leaf = { ...leaf,
				analysisRange: { start: leaf.analysisRange!.start + delta, end: leaf.analysisRange!.start + delta + length },
				rawRanges: leaf.rawRanges.map(r => ({ start: r.start + delta, end: r.start + delta + length })),
				sourceParts: leaf.sourceParts.map(p => ({ ...p, range: { start: p.range.start + delta, end: p.range.start + delta + length } })) };
			let node: PresentationNode = leaf;
			for (const style of atom.styles) node = element(style.tag, [node]);
			(inside ? rubyChildren : children).push(node);
			if (inside && end === ruby.range.end) {
				const sourceParts = ruby.sourceParts ?? [];
				const rawRanges = sourceParts.map(p => ({ start: index.bindings.get(p.sourceId)!.rawRange.start + p.range.start, end: index.bindings.get(p.sourceId)!.rawRange.start + p.range.end }));
				const reading = { ...literal(ruby.reading, false, rawRanges), sourceParts };
				children.push({ ...element("ruby", [...rubyChildren, element("rt", [reading])]), annotationId: ruby.annotationId, notation: ruby.notation });
				rubyChildren = []; rubyIndex += 1;
			}
			start = end;
		}
	}
	assert(rubyIndex === rubies.length);
	return element("span", children);
}

/** A detached canonical boundary for one slot and any Ruby relationship it owns. */
export function planTargetSlotFragment(
	index: TargetPlanIndex,
	runIndex: number,
	slots: readonly DisplaySlot[],
	tokenId: string,
): readonly [PresentationElement, ReadonlySet<string>] | null {
	const run = planTargetSlotRun(index, runIndex, slots);
	const ids = (node: PresentationNode, output = new Set<string>()): Set<string> => {
		if (node.kind === "text") { if (node.logical && node.tokenId) output.add(node.tokenId); }
		else for (const child of node.children) ids(child, output);
		return output;
	};
	const target = slots.find(slot => slot.tokenId === tokenId); if (!target) return null;
	const related = new Set([tokenId]);
	for (const annotation of index.located.runs[runIndex]!.run.annotations) if (rangesOverlap(annotation.baseRange, target.originalRange)) {
		for (const slot of slots) if (rangesOverlap(annotation.baseRange, slot.originalRange)) related.add(slot.tokenId);
	}
	const members = run.children.filter(node => { const found = ids(node); return found.has(tokenId) || [...found].some(id => related.has(id)); });
	if (related.size > 1 || members.length > 1 || (members.length === 1 && members[0]!.kind === "element" && members[0]!.tag === "ruby")) return [{ ...element("span", members), tokenId }, related];
	let found: PresentationNode | null = null;
	const visit = (node: PresentationNode): void => {
		if (found) return;
		if (node.kind === "text") { if (node.logical && node.tokenId === tokenId) found = node; return; }
		if (node.tokenId === tokenId) { found = node; return; }
		for (const child of node.children) visit(child);
	};
	visit(run);
	return found ? [{ ...element("span", [found]), tokenId }, related] : null;
}

/** Rebuilds only the source block containing a committed run from current slot draws. */
export function planTargetSlotBlock(index: TargetPlanIndex, runs: ReadonlyMap<string, readonly DisplaySlot[]>, runId: string): { blockIndex: number; part: PresentationElement } | null {
	const blockIndex = index.projection.presentation.blocks.findIndex(block => block.items.some(item => item.kind === "run" && item.runId === runId));
	if (blockIndex < 0) return null;
	const block = index.projection.presentation.blocks[blockIndex]!;
	if (block.hidden) return null;
	const children = block.items.map(item => {
		if (item.kind === "break") return element("br", []);
		if (item.kind === "static") return element(item.tag, [literal(item.text, !item.placeholder, item.placeholder ? [] : [item.visibleRange])]);
		const runIndex = index.located.runs.findIndex(run => run.run.runId === item.runId);
		const slots = runs.get(item.runId);
		assert(runIndex >= 0 && slots);
		return planTargetSlotRun(index, runIndex, slots);
	});
	return { blockIndex, part: element(block.tag, children) };
}

/**
 * Places planned runs into their blocks. Block-level static items come from the same parse.
 * A block the parser marked hidden (a closed leading frontmatter) gets no element, no
 * logical text and no separator; the analysis still excludes and protects it as before.
 */
export function assembleTargetPlan(index: TargetPlanIndex, rendered: ReadonlyMap<string, PresentationNode>): TargetDisplayPlan {
	const blocks: PresentationNode[] = [];
	for (const block of index.projection.presentation.blocks) {
		if (block.hidden) continue;
		if (blocks.length > 0) blocks.push(literal("\n\n"));
		blocks.push(element(block.tag, block.items.map(item => {
			if (item.kind === "break") return element("br", []);
			if (item.kind === "static") return element(item.tag, [literal(item.text, !item.placeholder, item.placeholder ? [] : [item.visibleRange])]);
			const result = rendered.get(item.runId); assert(result); return result;
		})));
	}
	const root = element("div", blocks);
	const logical: string[] = [];
	const walk = (node: PresentationNode): void => { if (node.kind === "text") { if (node.logical) logical.push(node.text); } else node.children.forEach(walk); };
	walk(root);
	return freezeAnalysis({ root, logicalText: logical.join("") });
}

/** Pure display planning. Consumes the original parse and located tokens, never DOM. */
export function planTargetDisplay(input: {
	projection: MarkdownSourceProjection; located: LocatedAnalysisDocument; vocabulary: RubyVocabulary;
	surfaces: readonly (readonly string[])[]; selections: readonly (readonly (SelectedVocabularyCandidate | null)[])[]; seed: number;
	context?: CandidateDrawContext; index?: TargetPlanIndex;
}): TargetDisplayPlan {
	const { projection, located } = input;
	assert(located.document === projection.document && input.surfaces.length === located.runs.length && input.selections.length === located.runs.length);
	const index = input.index ?? createTargetPlanIndex(projection, located);
	assert(index.projection === projection && index.located === located);
	const rendered = new Map<string, PresentationNode>();
	for (const [runIndex, sequence] of located.runs.entries()) {
		rendered.set(sequence.run.runId, planTargetRun(index, runIndex, {
			vocabulary: input.vocabulary, surfaces: input.surfaces[runIndex]!, selections: input.selections[runIndex]!,
			seed: input.seed, context: input.context,
		}));
	}
	return assembleTargetPlan(index, rendered);
}
