/**
 * Verbatim copy of planTargetDisplay as approved in PRE-RELEASE-TARGET-SAFE-RENDER1
 * (commit 01b554b). Test-only reference: the production planner is optimized
 * and must produce structurally identical plans. Never imported by src/.
 */
import type { LocatedAnalysisDocument } from "../../src/analysis/locateTokens";
import type { MarkdownSourceProjection, PresentationDecoration } from "../../src/analysis/projectMarkdownSource";
import type { SourcePartRef, Utf16Range } from "../../src/analysis/rubyAnalysis";
import { chooseRubyVariant, freezeAnalysis, rangesOverlap, resolveVocabularyCandidate, type RubyVocabulary } from "../../src/analysis/rubyVocabulary";
import type { SelectedVocabularyCandidate } from "../../src/transform/transformTokens";

import type { SafeTag, PresentationText, PresentationElement, PresentationNode, TargetDisplayPlan } from "../../src/analysis/targetPresentation";
type Atom = { leaf: PresentationText; start: number; end: number; styles: readonly PresentationDecoration[] };
type DisplayRuby = { range: Utf16Range; reading: string; annotationId: string; notation: string; sourceParts?: readonly SourcePartRef[] };

function assert(value: unknown): asserts value {
	if (!value) throw new Error("Safe Target presentation mapping is invalid.");
}
const element = (tag: SafeTag, children: readonly PresentationNode[]): PresentationElement => ({ kind: "element", tag, children });
const literal = (text: string, logical = true, rawRanges: readonly Utf16Range[] = []): PresentationText =>
	({ kind: "text", text, logical, rawRanges, sourceParts: [] });

/** Pure display planning. Consumes the original parse and located tokens, never DOM. */
export function referencePlanTargetDisplay(input: {
	projection: MarkdownSourceProjection; located: LocatedAnalysisDocument; vocabulary: RubyVocabulary;
	surfaces: readonly (readonly string[])[]; selections: readonly (readonly (SelectedVocabularyCandidate | null)[])[]; seed: number;
}): TargetDisplayPlan {
	const { projection, located } = input;
	assert(located.document === projection.document && input.surfaces.length === located.runs.length && input.selections.length === located.runs.length);
	const bindings = new Map(projection.bindings.map(b => [b.sourceId, b]));
	const rendered = new Map<string, PresentationNode>();
	for (const [runIndex, sequence] of located.runs.entries()) {
		const { run, tokens } = sequence;
		const surfaces = input.surfaces[runIndex]!, selections = input.selections[runIndex]!;
		assert(surfaces.length === tokens.length && selections.length === tokens.length);
		assert(tokens.map(t => t.token.surface).join("") === run.analysisText);
		const changed = tokens.filter((t, i) => surfaces[i] !== t.token.surface);
		const atoms: Atom[] = [], rubies: DisplayRuby[] = [];
		const positions: { original: Utf16Range; display: Utf16Range }[] = [];
		let display = 0, mapIndex = 0, original = 0;
		for (const [i, token] of tokens.entries()) {
			const surface = surfaces[i]!, selection = selections[i];
			assert(typeof surface === "string" && surface.length > 0 && token.range.start === original && token.range.end === original + token.token.surface.length);
			original = token.range.end;
			const replacement = surface !== token.token.surface;
			if (replacement) {
				assert(selection && selection.surface === surface);
				resolveVocabularyCandidate({ vocabulary: input.vocabulary, original: token.token, selection });
				const multi = run.annotations.some(a => rangesOverlap(a.baseRange, token.range) && (a.baseRange.start < token.range.start || a.baseRange.end > token.range.end));
				const variant = multi ? null : chooseRubyVariant({ vocabulary: input.vocabulary, original: token.token, selection, seed: input.seed, tokenId: token.tokenId });
				if (variant) {
					assert(variant.baseRangeInSurface.start >= 0 && variant.baseRangeInSurface.start < variant.baseRangeInSurface.end && variant.baseRangeInSurface.end <= surface.length);
					rubies.push({ range: { start: display + variant.baseRangeInSurface.start, end: display + variant.baseRangeInSurface.end }, reading: variant.reading, annotationId: variant.variantId, notation: variant.sourceNotations[0] ?? "html" });
				}
			} else assert(selection === null);
			positions.push({ original: token.range, display: { start: display, end: display + surface.length } });
			let used = 0;
			while (mapIndex < run.mapping.length && run.mapping[mapIndex]!.analysisRange.end <= token.range.start) mapIndex += 1;
			for (let m = mapIndex; m < run.mapping.length; m += 1) {
				const mapping = run.mapping[m]!;
				if (mapping.analysisRange.start >= token.range.end) break;
				const start = Math.max(token.range.start, mapping.analysisRange.start), end = Math.min(token.range.end, mapping.analysisRange.end);
				const ref = mapping.sourcePart, binding = bindings.get(ref.sourceId)!;
				assert(binding && end > start);
				const sourceStart = ref.range.start + start - mapping.analysisRange.start;
				const rawRange = { start: binding.rawRange.start + sourceStart, end: binding.rawRange.start + sourceStart + end - start };
				assert(binding.text.slice(sourceStart, sourceStart + end - start) === run.analysisText.slice(start, end));
				let next = end === token.range.end ? surface.length : Math.min(surface.length, used + end - start);
				if (next > used && /[\uD800-\uDBFF]/u.test(surface[next - 1] ?? "")) next += 1;
				const text = surface.slice(used, next);
				if (text) atoms.push({ start: display + used, end: display + next,
					styles: projection.presentation.decorations.filter(d => d.rawRange.start <= rawRange.start && rawRange.end <= d.rawRange.end),
					leaf: { kind: "text", text, logical: true, runId: run.runId, tokenId: token.tokenId, replacement,
						analysisRange: replacement ? token.range : { start, end }, rawRanges: [rawRange],
						sourceParts: [{ ...ref, range: { start: sourceStart, end: sourceStart + end - start } }] } });
				used = next;
			}
			assert(used === surface.length); display += surface.length;
		}
		const offset = (position: number): number => {
			const item = positions.find(p => p.original.start <= position && position <= p.original.end);
			assert(item);
			return position === item.original.end ? item.display.end : item.display.start + position - item.original.start;
		};
		for (const annotation of run.annotations) if (!changed.some(t => rangesOverlap(t.range, annotation.baseRange))) {
			const partIds = new Set(annotation.originalParts.map(p => p.partId));
			rubies.push({ range: { start: offset(annotation.baseRange.start), end: offset(annotation.baseRange.end) }, reading: annotation.reading, annotationId: annotation.annotationId, notation: annotation.notation,
				sourceParts: run.sourceParts.filter(p => p.kind === "ruby-reading" && partIds.has(p.partId)).map(p => p.source) });
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
					const rawRanges = sourceParts.map(p => ({ start: bindings.get(p.sourceId)!.rawRange.start + p.range.start, end: bindings.get(p.sourceId)!.rawRange.start + p.range.end }));
					const reading = { ...literal(ruby.reading, false, rawRanges), sourceParts };
					children.push({ ...element("ruby", [...rubyChildren, element("rt", [reading])]), annotationId: ruby.annotationId, notation: ruby.notation });
					rubyChildren = []; rubyIndex += 1;
				}
				start = end;
			}
		}
		assert(rubyIndex === rubies.length);
		rendered.set(run.runId, element("span", children));
	}
	const blocks: PresentationNode[] = [];
	for (const [i, block] of projection.presentation.blocks.entries()) {
		if (i > 0) blocks.push(literal("\n\n"));
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
