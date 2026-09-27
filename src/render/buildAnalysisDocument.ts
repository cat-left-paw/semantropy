import {
	createAnalysisDocument,
	createProtectedRun,
	parseRubyAwareInlineRun,
	type AnalysisDocument,
	type AnalysisDocumentSegment,
	type AnalysisRun,
	type HtmlRubyPartInput,
	type InlineAnalysisInput,
	type ProtectedRunReason,
	type RubyNotation,
	type SourceTextInput,
	type Utf16Range,
} from "../analysis/rubyAnalysis";
import { isProtectedElement } from "./collectTextNodes";

const BLOCK_TAGS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"dd",
	"div",
	"dl",
	"dt",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"section",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"ul",
]);

const INLINE_BOUNDARY_TAGS = new Set(["br", "hr", "wbr"]);

export type DomSourceBinding = {
	sourceId: string;
	node: Text;
};

export type DomAnalysisDocument = {
	document: AnalysisDocument;
	bindings: ReadonlyMap<string, DomSourceBinding>;
};

export type DomVisualPart = {
	partId: string;
	node: Text;
	sourceRange: Utf16Range;
	analysisRange: Utf16Range;
};

export class AnalysisMappingError extends Error {
	constructor(runId: string) {
		super(`Analysis mapping did not cover requested range in run ${runId}.`);
		this.name = "AnalysisMappingError";
	}
}

function isText(node: Node): node is Text {
	return node.nodeType === Node.TEXT_NODE;
}

function isElement(node: Node): node is Element {
	return node.nodeType === Node.ELEMENT_NODE;
}

function hasLineBreak(text: string): boolean {
	return text.includes("\n") || text.includes("\r");
}

function isMeaningful(inputs: readonly InlineAnalysisInput[]): boolean {
	const text = inputs
		.flatMap((input) =>
			input.kind === "text" ? [input.text] : input.parts.map((part) => part.text),
		)
		.join("");
	return text.trim().length > 0;
}

function hasTrailingEscapingBackslash(
	inputs: readonly InlineAnalysisInput[],
): boolean {
	const last = inputs.at(-1);
	if (!last || last.kind !== "text") {
		return false;
	}
	let count = 0;
	for (
		let cursor = last.text.length - 1;
		cursor >= 0 && last.text[cursor] === "\\";
		cursor -= 1
	) {
		count += 1;
	}
	return count % 2 === 1;
}

/**
 * Converts a rendered Markdown DOM into the pure Ruby-aware core model.
 * Production Open/Refresh calls this once on the detached source snapshot.
 * Reshuffle and Text-level changes reuse that immutable model.
 */
export function buildAnalysisDocument(root: HTMLElement): DomAnalysisDocument {
	const segments: AnalysisDocumentSegment[] = [];
	const bindings = new Map<string, DomSourceBinding>();
	let pending: InlineAnalysisInput[] = [];
	let sourceIndex = 0;
	let runIndex = 0;

	const sourceForNode = (node: Text): SourceTextInput => {
		const sourceId = `source:${sourceIndex}`;
		sourceIndex += 1;
		bindings.set(sourceId, { sourceId, node });
		return { sourceId, text: node.nodeValue ?? "" };
	};

	const flush = (): void => {
		if (pending.length === 0) {
			return;
		}
		const inputs = pending;
		pending = [];
		if (!isMeaningful(inputs)) {
			return;
		}
		segments.push(
			parseRubyAwareInlineRun({
				runId: `run:${runIndex}`,
				inputs,
			}),
		);
		runIndex += 1;
	};

	const protectElement = (
		element: Element,
		reason: ProtectedRunReason,
	): void => {
		flush();
		const sources: SourceTextInput[] = [];
		const walker = root.ownerDocument.createTreeWalker(
			element,
			root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? NodeFilter.SHOW_TEXT,
		);
		let current = walker.nextNode();
		while (current) {
			if (isText(current)) {
				sources.push(sourceForNode(current));
			}
			current = walker.nextNode();
		}
		if (sources.length > 0) {
			segments.push({
				kind: "protected",
				run: createProtectedRun({
					runId: `run:${runIndex}`,
					sources,
					reason,
				}),
			});
			runIndex += 1;
		}
		flush();
	};

	type HtmlRubyResult =
		| {
				status: "valid";
				input: Extract<InlineAnalysisInput, { kind: "html-ruby" }>;
				literalInputs: readonly SourceTextInput[];
		  }
		| { status: "invalid"; reason: ProtectedRunReason };

	const htmlRubyInput = (ruby: Element): HtmlRubyResult => {
		if (ruby.querySelector("ruby")) {
			return { status: "invalid", reason: "invalid-html-ruby" };
		}
		const directRt = Array.from(ruby.children).filter(
			(child) => child.tagName.toLowerCase() === "rt",
		);
		const directRb = Array.from(ruby.children).filter(
			(child) => child.tagName.toLowerCase() === "rb",
		);
		if (directRt.length !== 1 || directRb.length > 1) {
			return { status: "invalid", reason: "invalid-html-ruby" };
		}

		const pendingParts: Array<{
			node: Text;
			role: HtmlRubyPartInput["role"];
		}> = [];
		let annotationStarted = false;
		let rbSeen = false;
		for (const child of Array.from(ruby.childNodes)) {
			if (isText(child)) {
				if (
					annotationStarted ||
					rbSeen ||
					hasLineBreak(child.nodeValue ?? "") ||
					(child.nodeValue ?? "").length === 0
				) {
					return { status: "invalid", reason: "invalid-html-ruby" };
				}
				pendingParts.push({ node: child, role: "base" });
				continue;
			}
			if (!isElement(child)) {
				continue;
			}
			const tagName = child.tagName.toLowerCase();
			if (tagName === "rb") {
				if (
					annotationStarted ||
					rbSeen ||
					pendingParts.some((part) => part.role === "base") ||
					Array.from(child.childNodes).some((node) => !isText(node))
				) {
					return { status: "invalid", reason: "invalid-html-ruby" };
				}
				rbSeen = true;
				const textNodes = Array.from(child.childNodes).filter(isText);
				if (
					textNodes.length === 0 ||
					textNodes.some((node) => hasLineBreak(node.nodeValue ?? ""))
				) {
					return { status: "invalid", reason: "invalid-html-ruby" };
				}
				for (const textNode of textNodes) {
					pendingParts.push({ node: textNode, role: "base" });
				}
				continue;
			}
			if (tagName !== "rt" && tagName !== "rp") {
				return { status: "invalid", reason: "invalid-html-ruby" };
			}
			annotationStarted = true;
			if (Array.from(child.childNodes).some((node) => !isText(node))) {
				return { status: "invalid", reason: "invalid-html-ruby" };
			}
			const textNodes = Array.from(child.childNodes).filter(isText);
			if (tagName === "rt" && textNodes.length !== 1) {
				return { status: "invalid", reason: "invalid-html-ruby" };
			}
			for (const textNode of textNodes) {
				if (hasLineBreak(textNode.nodeValue ?? "")) {
					return { status: "invalid", reason: "invalid-html-ruby" };
				}
				pendingParts.push({
					node: textNode,
					role: tagName === "rt" ? "reading" : "marker",
				});
			}
		}

		const base = pendingParts
			.filter((part) => part.role === "base")
			.map((part) => part.node.nodeValue ?? "")
			.join("");
		const reading = pendingParts
			.filter((part) => part.role === "reading")
			.map((part) => part.node.nodeValue ?? "")
			.join("");
		if (base.trim().length === 0 || reading.trim().length === 0) {
			return { status: "invalid", reason: "invalid-html-ruby" };
		}
		let notation: RubyNotation = "html";
		const rawNotation = ruby.getAttribute("data-ruby-raw");
		if (rawNotation !== null) {
			const parsedRaw = parseRubyAwareInlineRun({
				runId: "rendered-ruby-validation",
				inputs: [
					{ kind: "text", sourceId: "data-ruby-raw", text: rawNotation },
				],
			});
			if (parsedRaw.kind === "protected") {
				return { status: "invalid", reason: parsedRaw.run.reason };
			}
			const annotation = parsedRaw.run.annotations[0];
			if (
				parsedRaw.run.annotations.length !== 1 ||
				!annotation ||
				parsedRaw.run.analysisText !== base ||
				annotation.reading !== reading ||
				annotation.originalRange.start !== 0 ||
				annotation.originalRange.end !== rawNotation.length
			) {
				return { status: "invalid", reason: "invalid-html-ruby" };
			}
			notation = annotation.notation;
		}

		const parts: HtmlRubyPartInput[] = pendingParts.map((part) => ({
			...sourceForNode(part.node),
			role: part.role,
		}));
		const input: Extract<InlineAnalysisInput, { kind: "html-ruby" }> = {
			kind: "html-ruby",
			notation,
			parts,
		};
		const validated = parseRubyAwareInlineRun({
			runId: "rendered-html-ruby-validation",
			inputs: [input],
		});
		if (validated.kind === "protected") {
			return { status: "invalid", reason: validated.run.reason };
		}
		return {
			status: "valid",
			input,
			literalInputs: parts.map(({ sourceId, text }) => ({ sourceId, text })),
		};
	};

	const visit = (node: Node, isRoot = false): void => {
		if (isText(node)) {
			pending.push({ kind: "text", ...sourceForNode(node) });
			return;
		}
		if (!isElement(node)) {
			return;
		}
		if (!isRoot && isProtectedElement(node)) {
			protectElement(node, "protected-dom");
			return;
		}

		const tagName = node.tagName.toLowerCase();
		if (tagName === "ruby") {
			const parsedRuby = htmlRubyInput(node);
			if (parsedRuby.status === "invalid") {
				protectElement(node, parsedRuby.reason);
				return;
			}
			// Obsidian 1.13.7 renders `\｜base《reading》` as a backslash
			// Text node followed by otherwise-valid Aozora ruby DOM. Preserve the
			// text nodes that actually exist, without inventing marker offsets.
			const rawNotation = node.getAttribute("data-ruby-raw");
			if (
				rawNotation?.startsWith("｜") === true &&
				hasTrailingEscapingBackslash(pending)
			) {
				pending.push(
					...parsedRuby.literalInputs.map((source) => ({
						kind: "text" as const,
						...source,
					})),
				);
				return;
			}
			pending.push(parsedRuby.input);
			return;
		}
		if (INLINE_BOUNDARY_TAGS.has(tagName)) {
			flush();
			return;
		}

		const isBlock = !isRoot && BLOCK_TAGS.has(tagName);
		if (isBlock) {
			flush();
		}
		for (const child of Array.from(node.childNodes)) {
			visit(child);
		}
		if (isBlock) {
			flush();
		}
	};

	if (isProtectedElement(root)) {
		protectElement(root, "protected-dom");
	} else {
		visit(root, true);
		flush();
	}

	return { document: createAnalysisDocument(segments), bindings };
}

/**
 * Projects a core range back to one or more DOM Text ranges. A token spanning
 * inline decoration or a ruby base plus okurigana consequently has several
 * visual parts with one token identity.
 */
export function projectAnalysisRangeToDomParts(
	run: AnalysisRun,
	selected: Utf16Range,
	bindings: ReadonlyMap<string, DomSourceBinding>,
): readonly DomVisualPart[] {
	if (
		selected.start < 0 ||
		selected.end <= selected.start ||
		selected.end > run.analysisText.length
	) {
		throw new AnalysisMappingError(run.runId);
	}

	const parts: DomVisualPart[] = [];
	let coveredUntil = selected.start;
	for (const segment of run.mapping) {
		const start = Math.max(selected.start, segment.analysisRange.start);
		const end = Math.min(selected.end, segment.analysisRange.end);
		if (start >= end) {
			continue;
		}
		if (start !== coveredUntil) {
			throw new AnalysisMappingError(run.runId);
		}
		const binding = bindings.get(segment.sourcePart.sourceId);
		if (!binding) {
			throw new AnalysisMappingError(run.runId);
		}
		const deltaStart = start - segment.analysisRange.start;
		const deltaEnd = end - segment.analysisRange.start;
		parts.push({
			partId: segment.sourcePart.partId,
			node: binding.node,
			sourceRange: {
				start: segment.sourcePart.range.start + deltaStart,
				end: segment.sourcePart.range.start + deltaEnd,
			},
			analysisRange: { start, end },
		});
		coveredUntil = end;
	}
	if (coveredUntil !== selected.end) {
		throw new AnalysisMappingError(run.runId);
	}
	return parts;
}
