import type { DisplaySlot, DisplayMarkerVisibility } from "../analysis/displaySlots";
import { locateTokens, type LocatedAnalysisDocument } from "../analysis/locateTokens";
import { projectMarkdownSource, type MarkdownSourceProjection } from "../analysis/projectMarkdownSource";
import { buildRubyVocabulary, chooseVocabularyCandidate, createCandidateDrawContext, freezeAnalysis, type RubyVocabulary } from "../analysis/rubyVocabulary";
import { planTargetDisplay, type PresentationElement, type PresentationNode, type PresentationText, type SafeTag, type TargetDisplayPlan } from "../analysis/targetPresentation";
import type { Utf16Range } from "../analysis/rubyAnalysis";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import type { BodySemantropy } from "../settings/bodySemantropy";
import { transformTokenSequences, type SelectedVocabularyCandidate } from "../transform/transformTokens";

/*
 * The approved PRE-RELEASE-TARGET-SAFE-RENDER1 analysis and inert DOM builder,
 * shared by the production Target controller and the prototype harness.
 * Receives only supplied text, a tokenizer and an ownerDocument: no Obsidian,
 * Vault, MarkdownRenderer, postprocessor, Component or resource capability.
 */

export const SAFE_TARGET_ERROR = "Could not prepare the safe Target prototype.";
export type SafeTargetModel = { projection: MarkdownSourceProjection; located: LocatedAnalysisDocument; vocabulary: RubyVocabulary };
export type TargetDomBinding = { node: Text; presentation: PresentationText; logicalRange: Utf16Range | null; nodeRange?: Utf16Range };
export type TargetDom = { root: HTMLElement; bindings: readonly TargetDomBinding[]; plan: TargetDisplayPlan; elements?: ReadonlyMap<HTMLElement, string> };
const TAGS: ReadonlySet<SafeTag> = new Set(["div", "p", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "span", "em", "strong", "del", "code", "br", "ruby", "rt"]);

export type TargetSlotMarkers = { slots: ReadonlyMap<string, DisplaySlot>; visibility: DisplayMarkerVisibility };

/** Fixed classes only. No token metadata attributes, listeners or resource capabilities. */
function createSafeDomBuilder(ownerDocument: Document, markers?: TargetSlotMarkers) {
 const elements = new Map<HTMLElement, string>();
	let offset = 0;
	const bindings: TargetDomBinding[] = [];
 const decorate = (span: HTMLElement, slot: DisplaySlot): void => {
  span.classList.add("semantropy-token");
  if (slot.automaticReplaced && markers?.visibility.replacement !== false) span.classList.add("semantropy-replaced");
  if (slot.manualAvailable && markers?.visibility.manual !== false) span.classList.add("semantropy-manual-available");
  if (slot.manualOverride && markers?.visibility.manual !== false) span.classList.add("semantropy-manual-changed");
  if (slot.dictionaryAvailable && markers?.visibility.dictionary !== false) span.classList.add("semantropy-dictionary-available");
  // What the reader can do with this word, independent of which markers are shown.
  // The View adds the pointer only while it would really act (see `syncTokenAffordance`).
  if (slot.manualEligible) span.classList.add("semantropy-manual-operable");
  if (slot.dictionaryAvailable) span.classList.add("semantropy-dictionary-operable");
  elements.set(span, slot.tokenId);
 };
 const append = (parent: Node, part: PresentationNode): void => {
  if (part.kind === "text") {
   const slot = part.logical && part.tokenId ? markers?.slots.get(part.tokenId) : undefined;
   const visual = slot && (slot.automaticReplaced || slot.manualAvailable || slot.dictionaryAvailable || slot.manualOverride);
   let container = parent;
   if (visual) {
    const span = ownerDocument.createElement("span");
    decorate(span, slot); parent.appendChild(span); container = span;
   }
   const previous = container.lastChild;
   // Only plain adjacent leaves coalesce. Binding intervals retain exact token identity.
   const node = markers && !visual && previous?.nodeType === 3 ? previous as Text : ownerDocument.createTextNode("");
   const start = node.length;
   node.appendData(part.text);
   if (node.parentNode !== container) container.appendChild(node);
   const logicalRange = part.logical ? { start: offset, end: offset + part.text.length } : null;
   if (logicalRange) offset = logicalRange.end;
   bindings.push({ node, presentation: part, logicalRange, nodeRange: { start, end: node.length } });
   return;
  }
  if (!TAGS.has(part.tag)) throw new Error(SAFE_TARGET_ERROR);
  const node = ownerDocument.createElement(part.tag);
  for (const child of part.children) append(node, child);
  parent.appendChild(node);
 };
 const build = (part: PresentationNode): Node => {
  const holder = ownerDocument.createDocumentFragment(); append(holder, part); return holder.firstChild!;
 };
 return { build, append, bindings, elements, offset: () => offset };
}

function installSlotBoundaries(root: HTMLElement, elements: Map<HTMLElement, string>): void {
	for (const id of new Set(elements.values())) {
		const marked = [...elements].filter(([, value]) => value === id).map(([element]) => element);
		const ruby = marked.length === 1 ? marked[0]!.closest("ruby") : null;
		let items: HTMLElement[] = [];
		if (ruby && root.contains(ruby)) {
			if (elements.has(ruby.parentElement!)) continue;
			items = [ruby];
		}
		else if (marked.length > 1) {
			let common: Node | null = marked[0]!.parentNode;
			while (common && !marked.every(element => common === element || common!.contains(element))) common = common.parentNode;
			if (common instanceof HTMLElement) {
				items = [...new Set(marked.map(element => { let node: HTMLElement = element; while (node.parentElement && node.parentElement !== common) node = node.parentElement; return node; }))];
			}
		}
		const first = items[0];
		if (!first?.parentNode || items.some(item => item.parentNode !== first.parentNode)) continue;
		const boundary = root.ownerDocument.createElement("span");
		first.parentNode.insertBefore(boundary, first);
		for (const item of items) boundary.appendChild(item);
		elements.set(boundary, id);
	}
}

/** Builds one controller-minted slot boundary off-screen. */
export function buildSafeTargetFragment(
	part: PresentationElement,
	ownerDocument: Document,
	markers: TargetSlotMarkers,
): TargetDom {
	const builder = createSafeDomBuilder(ownerDocument, markers);
	const root = builder.build(part) as HTMLElement;
	if (part.tokenId) builder.elements.set(root, part.tokenId);
	return { root, bindings: builder.bindings, plan: { root: part, logicalText: builder.bindings.filter(b => b.logicalRange).map(b => b.node.data.slice(b.nodeRange?.start ?? 0, b.nodeRange?.end ?? b.node.length)).join("") }, elements: builder.elements };
}

/** Synchronous detached block build with the same minted boundaries as initial materialization. */
export function buildSafeTargetBlock(part: PresentationElement, ownerDocument: Document, markers: TargetSlotMarkers): TargetDom {
	const builder = createSafeDomBuilder(ownerDocument, markers);
	const root = builder.build(part) as HTMLElement;
	installSlotBoundaries(root, builder.elements);
	return { root, bindings: builder.bindings,
		plan: { root: part, logicalText: builder.bindings.filter(b => b.logicalRange).map(b => b.node.data.slice(b.nodeRange?.start ?? 0, b.nodeRange?.end ?? b.node.length)).join("") },
		elements: builder.elements };
}

export function buildSafeTargetDom(plan: TargetDisplayPlan, ownerDocument: Document): TargetDom {
	const builder = createSafeDomBuilder(ownerDocument);
	const root = builder.build(plan.root) as HTMLElement;
	if (builder.offset() !== plan.logicalText.length) throw new Error(SAFE_TARGET_ERROR);
	return { root, bindings: builder.bindings, plan, elements: builder.elements };
}

/**
 * The same detached tree as `buildSafeTargetDom`, built one block at a time.
 * Returns null when `checkpoint` reports the work is no longer current; the
 * partial tree is never attached anywhere and is simply dropped.
 */
export async function buildSafeTargetDomIncremental(
	plan: TargetDisplayPlan, ownerDocument: Document, checkpoint: () => Promise<boolean>, markers?: TargetSlotMarkers,
): Promise<TargetDom | null> {
	const builder = createSafeDomBuilder(ownerDocument, markers);
	if (!TAGS.has(plan.root.tag)) throw new Error(SAFE_TARGET_ERROR);
	const root = ownerDocument.createElement(plan.root.tag);
	for (const child of plan.root.children) {
		builder.append(root, child);
		if (!(await checkpoint())) return null;
	}
	if (builder.offset() !== plan.logicalText.length) throw new Error(SAFE_TARGET_ERROR);
	if (markers) installSlotBoundaries(root, builder.elements);
	return { root, bindings: builder.bindings, plan, elements: builder.elements };
}

export type SafeTargetAnalysisPhase = "projection" | "tokenize" | "vocabulary";

/** Analyze supplied text only. Never reads a Vault, renders Markdown, or writes. */
export async function analyzeSafeTarget(input: {
	text: string; sourcePath: string; contentHash: string; tokenizer: JapaneseTokenizer; isCurrent?: () => boolean;
	/** Cooperative boundary between runs; false means the request was superseded. */
	checkpoint?: () => Promise<boolean>;
	/** Measurement hook: called when a phase begins. Receives no content. */
	phase?: (name: SafeTargetAnalysisPhase) => void;
}): Promise<{ status: "ready"; model: SafeTargetModel } | { status: "stale" } | { status: "error"; message: typeof SAFE_TARGET_ERROR }> {
	const current = input.isCurrent ?? (() => true);
	const checkpoint = input.checkpoint ?? (async () => true);
	try {
		if (!current()) return { status: "stale" };
		input.phase?.("projection");
		const projection = projectMarkdownSource(input.text, "target-prototype");
		const runs: LocatedAnalysisDocument["runs"][number][] = [];
		for (const run of projection.document.runs) {
			if (!current() || !(await checkpoint())) return { status: "stale" };
			input.phase?.("tokenize");
			const tokens = await input.tokenizer.tokenize(run.analysisText);
			if (!current()) return { status: "stale" };
			runs.push({ run, tokens: locateTokens(run, tokens) });
		}
		if (!(await checkpoint())) return { status: "stale" };
		input.phase?.("vocabulary");
		const located = freezeAnalysis({ document: projection.document, runs });
		const extracted = buildRubyVocabulary(located, { path: input.sourcePath, contentHash: input.contentHash });
		const vocabulary = { ...extracted, fingerprint: JSON.stringify([projection.policyVersion, extracted.fingerprint]) };
		if (!current()) return { status: "stale" };
		return { status: "ready", model: freezeAnalysis({ projection, located, vocabulary }) };
	} catch { return { status: "error", message: SAFE_TARGET_ERROR }; }
}

export function planSafeTarget(model: SafeTargetModel, seed: number, level: BodySemantropy): TargetDisplayPlan {
	const sequences = model.located.runs.map(r => r.tokens.map(t => t.token));
	const result = transformTokenSequences(sequences, model.vocabulary.automaticBody, seed, level, true);
	const surfaces = result.tokenSurfaces!;
	const context = createCandidateDrawContext(model.vocabulary, seed);
	const selections: (SelectedVocabularyCandidate | null)[][] = model.located.runs.map((run, r) => run.tokens.map((t, i) =>
		surfaces[r]![i] === t.token.surface ? null : chooseVocabularyCandidate({ vocabulary: model.vocabulary, original: t.token, surface: surfaces[r]![i]!, tokenId: t.tokenId, seed, context })));
	return planTargetDisplay({ ...model, surfaces, selections, seed, context });
}
