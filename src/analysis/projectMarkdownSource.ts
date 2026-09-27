import {
	createAnalysisDocument, createProtectedRun, parseRubyAwareInlineRun,
	type AnalysisDocument, type AnalysisDocumentSegment, type InlineAnalysisInput,
	type HtmlRubyPartInput, type SourceTextInput, type Utf16Range,
} from "./rubyAnalysis";
import { freezeAnalysis } from "./rubyVocabulary";
import {
	hasActiveContinuationCloser, unclosedContinuations, type ContinuationCloser, markdownFenceOpener, isMarkdownFenceCloser,
} from "./activeContinuation";

export const SOURCE_PROJECTION_POLICY_VERSION = "source-projection-1";
/** 2: per-line recovery from local unsupported notation (FIX1); 1 was the SAFE-RENDER1 prototype. */
export const TARGET_PRESENTATION_POLICY_VERSION = "target-presentation-2";

/** Adapter-owned strings, just like DOM Text bindings, with exact raw offsets. */
export type MarkdownSourceBinding = SourceTextInput & { rawRange: Utf16Range };
export type PresentationItem =
	| { kind: "run"; runId: string }
	| { kind: "break"; rawRange: Utf16Range }
	| { kind: "static"; rawRange: Utf16Range; visibleRange: Utf16Range; text: string; tag: "span" | "code"; placeholder: boolean };
export type PresentationBlock = {
	rawRange: Utf16Range;
	tag: "p" | "pre" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
	items: PresentationItem[];
	/**
	 * Target only: the parser recognized this block as a closed leading
	 * frontmatter. It stays a protected block of the projection, with the same
	 * raw range, exclusion and protected run; only the display omits it.
	 */
	hidden?: "frontmatter";
};
export type PresentationDecoration = { rawRange: Utf16Range; tag: "em" | "strong" | "del" };
export type MarkdownSourceProjection = {
	policyVersion: typeof SOURCE_PROJECTION_POLICY_VERSION | typeof TARGET_PRESENTATION_POLICY_VERSION;
	document: AnalysisDocument;
	bindings: readonly MarkdownSourceBinding[];
	/** Raw Markdown ranges excluded from analysis (syntax AND protected content). */
	exclusions: readonly { range: Utf16Range; reason: "syntax" | "protected" }[];
	/** Emitted by the same lexical pass; never recovered from rendered strings. */
	presentation: { blocks: readonly PresentationBlock[]; decorations: readonly PresentationDecoration[] };
};

type Piece = { kind: "inline"; input: InlineAnalysisInput } |
	{ kind: "break"; start: number; end: number } |
	{ kind: "protected"; start: number; end: number; visibleStart: number; visibleEnd: number; tag: "span" | "code"; placeholder: boolean };
type Line = { start: number; end: number; next: number; text: string };

const HEADING = /^ {0,3}#{1,6} /;
/** Block constructs that own the rest of a paragraph block (Target recovery). */
const STRUCTURAL_START = /^(?: {4}|\t| {0,3}(?:>|[-+*]\s|\d+[.)]\s|[-=_]{3}))/u;
const STRUCTURAL_INTERRUPT = /^ {0,3}(?:>|[-+*]\s|\d+[.)]\s|[-=_]{3})/u;
/** An Aozora annotation such as `※［＃「口＋禺」、第3水準1-15-9］《ぐう》`, kept whole and inert. */
const AOZORA_ANNOTATION = /^※?［＃[^［］\r\n]*］(?:《[^《》｜\r\n]+》)?/u;
/** One line-local allowlist gate, shared by whole parsing and certified replay. */
function unsupportedTargetLine(text: string, heading: boolean): boolean {
	return (!heading && /^[ \t]/.test(text)) || /^\[/.test(text) || / $/.test(text);
}

const HAN_BASE = /^(?:\p{Script=Han}|[々〆ヶヵ])$/u;

/** End of the line that starts at `start`. Lines break at LF or CR in every mode. */
export function markdownLineEnd(markdown: string, start: number): number {
	let end = start;
	while (end < markdown.length && markdown[end] !== "\n" && markdown[end] !== "\r") end += 1;
	return end;
}

/**
 * Whether a document's first line opens frontmatter. Exported so Target Chunk
 * boundaries apply this exact rule instead of a copy of it.
 */
export function isFrontmatterOpenerLine(line: string): boolean {
	return /^\uFEFF?---\s*$/.test(line);
}

/** Parser-certified block fragment. Offsets are local to the supplied Chunk. */
export type TargetProjectionFragment = {
	readonly rawRange: Utf16Range;
	readonly tag: PresentationBlock["tag"] | "blank";
	/** A continued p starts with ordinary inline parsing, never block-opening parsing. */
	readonly continuesBefore: boolean;
	readonly continuesAfter: boolean;
	/** The final soft newline belongs to an analysis run in the whole projection. */
	readonly trailingAnalysis: boolean;
	/** Carried from the whole projection, which alone decides it; never re-derived from a slice. */
	readonly hidden?: "frontmatter";
};

type TargetFragmentWriter = {
	newBlock: (start: number, end: number, tag: PresentationBlock["tag"], hidden?: PresentationBlock["hidden"]) => void;
	syntax: (start: number, end: number) => void;
	protect: (start: number, end: number) => void;
	inline: (start: number, end: number) => Piece[] | null;
	rubyValid: (pieces: readonly Piece[]) => boolean;
	bind: (start: number, end: number) => SourceTextInput;
	emitPieces: (pieces: readonly Piece[], trailingAnalysis?: boolean) => void;
};

/** Internal replay seam. Callers must obtain fragments from a minted Target index. */
export function projectTargetFragments(markdown: string, fragments: readonly TargetProjectionFragment[]): MarkdownSourceProjection {
	return project(markdown, "target-prototype", ({ newBlock, syntax, protect, inline, rubyValid, bind, emitPieces }) => {
		// Replay only certified block fragments. No document/paragraph opener or
		// continuation scanner is re-run on a slice that is not a document start.
		for (const fragment of fragments) {
			const { start, end } = fragment.rawRange;
			if (fragment.tag === "blank") {
				for (let at = start; at < end;) {
					const lineEnd = markdownLineEnd(markdown, at);
					const next = lineEnd + (markdown.startsWith("\r\n", lineEnd) ? 2 : lineEnd < end ? 1 : 0);
					syntax(at, next); at = next;
				}
				continue;
			}
			newBlock(start, end, fragment.tag, fragment.hidden);
			if (fragment.tag === "pre") { protect(start, end); continue; }
			const pieces: Piece[] = [];
			let previousEnd = start;
			for (let at = start; at < end;) {
				const lineEnd = markdownLineEnd(markdown, at);
				const next = lineEnd + (markdown.startsWith("\r\n", lineEnd) ? 2 : lineEnd < end ? 1 : 0);
				const heading = at === start && !fragment.continuesBefore && fragment.tag !== "p"
					? HEADING.exec(markdown.slice(at, lineEnd)) : null;
				const contentStart = at + (heading?.[0].length ?? 0);
				if (at === start) syntax(at, contentStart);
				else pieces.push({ kind: "break", start: previousEnd, end: at },
					{ kind: "inline", input: { kind: "text", ...bind(previousEnd, at) } });
				const text = markdown.slice(at, lineEnd);
				const unsupported = unsupportedTargetLine(text, !!heading);
				const child = unsupported ? null : inline(contentStart, lineEnd);
				if (child && rubyValid(child)) pieces.push(...child);
				else pieces.push({ kind: "protected", start: at, end: lineEnd, visibleStart: at, visibleEnd: lineEnd, tag: "span", placeholder: false });
				previousEnd = lineEnd; at = next;
			}
			if (fragment.continuesAfter) pieces.push({ kind: "break", start: previousEnd, end },
				{ kind: "inline", input: { kind: "text", ...bind(previousEnd, end) } });
			else syntax(previousEnd, end);
			emitPieces(pieces, fragment.trailingAnalysis);
		}

	});
}

/** No rendering, URL resolution, file reads, entities, or Markdown extensions. */
export function projectMarkdownSource(markdown: string, mode: "source" | "target-prototype" = "source"): MarkdownSourceProjection {
	return project(markdown, mode);
}

function project(markdown: string, mode: "source" | "target-prototype", replay?: (writer: TargetFragmentWriter) => void): MarkdownSourceProjection {
	const bindings: MarkdownSourceBinding[] = [];
	const byId = new Map<string, MarkdownSourceBinding>();
	const exclusions: MarkdownSourceProjection["exclusions"][number][] = [];
	const segments: AnalysisDocumentSegment[] = [];
	const blocks: PresentationBlock[] = [];
	const decorations: PresentationDecoration[] = [];
	let block: PresentationBlock;
	const bind = (start: number, end: number): SourceTextInput => {
		const binding = { sourceId: `markdown:${bindings.length}`, text: markdown.slice(start, end), rawRange: { start, end } };
		bindings.push(binding);
		byId.set(binding.sourceId, binding);
		return binding;
	};
	const syntax = (start: number, end: number): void => {
		if (start < end) exclusions.push({ range: { start, end }, reason: "syntax" });
	};
	const protect = (start: number, end: number, visibleStart = start, visibleEnd = end, tag: "span" | "code" = "span", placeholder = false): void => {
		exclusions.push({ range: { start, end }, reason: "protected" });
		block.items.push({ kind: "static", rawRange: { start, end }, visibleRange: { start: visibleStart, end: visibleEnd }, tag, placeholder,
			text: placeholder ? "[Image / embed omitted]" : markdown.slice(visibleStart, visibleEnd) });
		// A resource with no visible text is still a boundary, but (as in the DOM
		// adapter) need not manufacture a core Text node or an empty protected run.
		if (visibleStart < visibleEnd) segments.push({ kind: "protected", run: createProtectedRun({
			runId: `run:${segments.length}`, sources: [bind(visibleStart, visibleEnd)], reason: "protected-dom",
		}) });
	};
	const newBlock = (start: number, end: number, tag: PresentationBlock["tag"], hidden?: PresentationBlock["hidden"]): void => {
		block = { rawRange: { start, end }, tag, items: [], ...(hidden ? { hidden } : {}) };
		blocks.push(block);
	};
	const flush = (inputs: InlineAnalysisInput[], retainWhitespaceAnalysis = false): void => {
		if (!inputs.length) return;
		const text = inputs.flatMap(i => i.kind === "text" ? [i.text] : i.parts.map(p => p.text)).join("");
		if (!text.trim() && !retainWhitespaceAnalysis) {
			for (const input of inputs) if (input.kind === "text") block.items.push({ kind: "static", rawRange: byId.get(input.sourceId)!.rawRange, visibleRange: byId.get(input.sourceId)!.rawRange, text: input.text, tag: "span", placeholder: false });
			return;
		}
		const runId = `run:${segments.length}`;
		block.items.push({ kind: "run", runId });
		const parsed = parseRubyAwareInlineRun({ runId, inputs });
		if (parsed.kind === "protected") {
			for (const part of parsed.run.sourceParts) {
				const binding = byId.get(part.source.sourceId)!;
				exclusions.push({ range: { start: binding.rawRange.start + part.source.range.start, end: binding.rawRange.start + part.source.range.end }, reason: "protected" });
			}
			segments.push(parsed);
			return;
		}
		// Obsidian's accepted Aozora ruby DOM contains base + reading, not the
		// delimiters. Validate with the shared parser first, then represent those
		// same virtual Text slices. Raw positions remain in adapter bindings.
		const normalized: InlineAnalysisInput[] = [];
		const annotationsAt = new Map(parsed.run.annotations.map(a => [a.originalRange.start, a]));
		for (let i = 0; i < parsed.run.sourceParts.length;) {
			const part = parsed.run.sourceParts[i]!;
			const annotation = annotationsAt.get(part.originalRange.start);
			const parts: HtmlRubyPartInput[] = [];
			const end = annotation?.originalRange.end ?? part.originalRange.end;
			do {
				const current = parsed.run.sourceParts[i]!;
				const binding = byId.get(current.source.sourceId)!;
				const start = binding.rawRange.start + current.source.range.start;
				const rawEnd = binding.rawRange.start + current.source.range.end;
				if (annotation && annotation.notation !== "html" && current.kind === "ruby-marker") syntax(start, rawEnd);
				else if (annotation) parts.push({ ...bind(start, rawEnd), role: current.kind === "ruby-base" ? "base" : current.kind === "ruby-reading" ? "reading" : "marker" });
				else normalized.push({ kind: "text", ...bind(start, rawEnd) });
				i += 1;
			} while (i < parsed.run.sourceParts.length && parsed.run.sourceParts[i]!.originalRange.start < end);
			if (annotation) normalized.push({ kind: "html-ruby", notation: annotation.notation, parts });
		}
		segments.push(parseRubyAwareInlineRun({ runId, inputs: normalized }));
	};
	/** Runs, breaks and protected spans of one block, in source order. */
	const emitPieces = (pieces: readonly Piece[], trailingAnalysis = false): void => {
		let pending: InlineAnalysisInput[] = [];
		for (const piece of pieces) {
			if (piece.kind === "inline") pending.push(piece.input);
			else {
				flush(pending); pending = [];
				if (piece.kind === "break") block.items.push({ kind: "break", rawRange: { start: piece.start, end: piece.end } });
				else protect(piece.start, piece.end, piece.visibleStart, piece.visibleEnd, piece.tag, piece.placeholder);
			}
		}
		flush(pending, trailingAnalysis);
	};
	/** Do not expose the middle of a malformed ruby separated by protected nodes as an ordinary run. */
	const rubyValid = (pieces: readonly Piece[]): boolean => {
		let pending: InlineAnalysisInput[] = [];
		const groups: InlineAnalysisInput[][] = [];
		for (const piece of pieces) {
			if (piece.kind === "inline") pending.push(piece.input);
			else { groups.push(pending); pending = []; }
		}
		groups.push(pending);
		return !groups.some(inputs => parseRubyAwareInlineRun({ runId: "validation", inputs }).kind === "protected");
	};

	/** Small allowlist, not a general HTML parser. No attributes or entities. */
	const htmlRuby = (start: number, limit: number): { input: InlineAnalysisInput; end: number } | null => {
		if (!markdown.startsWith("<ruby>", start)) return null;
		let cursor = start + 6;
		const parts: HtmlRubyPartInput[] = [];
		const tagRanges: Utf16Range[] = [{ start, end: cursor }];
		const take = (tag: string): boolean => {
			if (!markdown.startsWith(tag, cursor)) return false;
			tagRanges.push({ start: cursor, end: cursor + tag.length }); cursor += tag.length; return true;
		};
		const textPart = (role: HtmlRubyPartInput["role"]): boolean => {
			const from = cursor;
			while (cursor < limit && markdown[cursor] !== "<") cursor += 1;
			// HTML ruby children must be provably literal, not Markdown that a
			// renderer could turn into nested elements. Use a positive character
			// allowlist for base, rt AND rp; never unescape or strip inner syntax.
			// Keep exact UTF-16 spelling (including combining marks) for mapping.
			if (cursor === from || /[^\p{L}\p{M}\p{N} \u3000、。，．・「」『』（）()]/u.test(markdown.slice(from, cursor))) return false;
			parts.push({ ...bind(from, cursor), role }); return true;
		};
		const rb = take("<rb>");
		if (!textPart("base") || (rb && !take("</rb>"))) return null;
		if (take("<rp>")) { if (!textPart("marker") || !take("</rp>")) return null; }
		if (!take("<rt>") || !textPart("reading") || !take("</rt>")) return null;
		if (take("<rp>")) { if (!textPart("marker") || !take("</rp>")) return null; }
		if (!take("</ruby>")) return null;
		for (const r of tagRanges) syntax(r.start, r.end);
		return { input: { kind: "html-ruby", notation: "html", parts }, end: cursor };
	};

	/** Start of the code point that ends at `end` (surrogate-pair aware). */
	const codePointBefore = (end: number): number => {
		const low = markdown.charCodeAt(end - 1);
		if (low >= 0xdc00 && low <= 0xdfff && end >= 2) {
			const high = markdown.charCodeAt(end - 2);
			if (high >= 0xd800 && high <= 0xdbff) return end - 2;
		}
		return end - 1;
	};

	const inline = (start: number, end: number, depth = 0): Piece[] | null => {
		if (depth > 8) return null;
		const pieces: Piece[] = [];
		let cursor = start;
		let plainStart = start;
		const emit = (): void => {
			if (plainStart < cursor) pieces.push({ kind: "inline", input: { kind: "text", ...bind(plainStart, cursor) } });
		};
		while (cursor < end) {
			const c = markdown[cursor]!;
			const rest = markdown.slice(cursor, end);
			if (/^(?:https?:\/\/|ftp:\/\/|www\.)/i.test(rest) || c === "@") return null;
			// Target only: an Aozora annotation (for example an external-character
			// note with its reading) is one inert, protected span. Its description
			// and reading never reach the tokenizer, and it is a run boundary.
			if (mode === "target-prototype" && (c === "※" || c === "［")) {
				const annotation = AOZORA_ANNOTATION.exec(rest);
				if (annotation) {
					// A reading after the note belongs to the whole preceding kanji
					// base in Aozora notation, so that base is protected with it.
					let begin = cursor;
					if (annotation[0].endsWith("》")) {
						while (begin > plainStart) {
							const previous = codePointBefore(begin);
							if (!HAN_BASE.test(markdown.slice(previous, begin))) break;
							begin = previous;
						}
					}
					const annotationEnd = cursor + annotation[0].length;
					cursor = begin; emit();
					pieces.push({ kind: "protected", start: begin, end: annotationEnd, visibleStart: begin, visibleEnd: annotationEnd, tag: "span", placeholder: false });
					cursor = annotationEnd; plainStart = cursor; continue;
				}
			}
			if (c === "\\") {
				// Rendered explicit escapes lose markers in Obsidian 1.13.7. Until
				// a stable lexical/DOM equivalence policy exists, exclude the block.
				if (/^\\(?:｜|\(|\[)/.test(rest)) return null;
				if (/^\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(rest)) {
					emit(); syntax(cursor, cursor + 1);
					pieces.push({ kind: "inline", input: { kind: "text", ...bind(cursor + 1, cursor + 2) } });
					cursor += 2; plainStart = cursor; continue;
				}
				cursor += 1; continue;
			}
			if (c === "<") {
				emit(); const ruby = htmlRuby(cursor, end);
				if (!ruby) return null;
				pieces.push({ kind: "inline", input: ruby.input }); cursor = ruby.end; plainStart = cursor; continue;
			}
			if (c === "&" || c === "\t" || c === "\r" || c === "\n") return null;
			if (c === "*" || c === "_" || c === "~") {
				const match = /^(\*\*|__|~~|\*|_)([^\r\n]+?)\1/.exec(rest);
				if (!match || !match[2]!.trim() || /^\s|\s$/.test(match[2]!) || /[*_~]/.test(match[2]!) ||
					(c === "_" && ((cursor > start && /[\p{L}\p{N}]/u.test(markdown[cursor - 1]!)) ||
						/[\p{L}\p{N}]/u.test(markdown[cursor + match[0].length] ?? "")))) return null;
				emit(); const delimiter = match[1]!.length;
				const innerStart = cursor + delimiter, innerEnd = cursor + match[0].length - delimiter;
				const children = inline(innerStart, innerEnd, depth + 1);
				if (!children) return null;
				decorations.push({ rawRange: { start: innerStart, end: innerEnd }, tag: c === "~" ? "del" : delimiter === 2 ? "strong" : "em" });
				syntax(cursor, innerStart); syntax(innerEnd, cursor + match[0].length);
				pieces.push(...children); cursor += match[0].length; plainStart = cursor; continue;
			}
			if (c === "`" || c === "[" || (c === "!" && rest[1] === "[") || c === "$" || c === "#") {
				let match: RegExpExecArray | null = null;
				let contentStart = 0, contentEnd = 0;
				if (c === "`") {
					match = /^(`+)([^`\r\n]+)\1(?!`)/.exec(rest);
					if (match) {
						contentStart = match[1]!.length; contentEnd = contentStart + match[2]!.length;
						if (/^ .+ $/.test(match[2]!) && match[2]!.trim()) { contentStart += 1; contentEnd -= 1; }
					}
				} else if (c === "$" || c === "#") {
					match = c === "$" ? /^\$([^$\r\n]+)\$/.exec(rest) : /^#[^\s#]+/.exec(rest);
					if (match) { contentStart = c === "$" ? 1 : 0; contentEnd = match[0].length - (c === "$" ? 1 : 0); }
				} else {
					match = /^!?\[\[([^\]\r\n[]+)\]\]/.exec(rest);
					if (match) { contentStart = c === "!" ? 0 : 2; contentEnd = c === "!" ? 0 : match[0].length - 2; }
					else {
						match = /^!?\[([^\]\\\r\n[]*)\]\([^()\s\\]*\)/.exec(rest);
						if (match) { contentStart = c === "!" ? 0 : 1; contentEnd = c === "!" ? 0 : 1 + match[1]!.length; }
					}
				}
				if (!match) return null;
				emit(); pieces.push({ kind: "protected", start: cursor, end: cursor + match[0].length,
					visibleStart: cursor + contentStart, visibleEnd: cursor + contentEnd, tag: c === "`" ? "code" : "span", placeholder: c === "!" });
				cursor += match[0].length; plainStart = cursor; continue;
			}
			// Unmatched closers / table syntax / extensions are not ordinary text.
			if (c === "]" || c === "|" || rest.startsWith("%%") || rest.startsWith("==") || rest.startsWith("::")) return null;
			cursor += 1;
		}
		emit(); return pieces;
	};

	const lines: Line[] = [];
	for (let start = 0; !replay && start < markdown.length;) {
		const end = markdownLineEnd(markdown, start);
		const next = end + (markdown.startsWith("\r\n", end) ? 2 : end < markdown.length ? 1 : 0);
		lines.push({ start, end, next, text: markdown.slice(start, end) }); start = next;
	}

	/** First line at or after `from` with an active closer, or the last line when the construct never closes. */
	const lineClosing = (from: number, closer: ContinuationCloser): number => {
		for (let m = from; m < lines.length; m += 1) {
			if (hasActiveContinuationCloser(lines[m]!.text, closer)) return m;
		}
		return lines.length - 1;
	};
	/**
	 * Target recovery. A construct that is really still open at the end of line
	 * `k` protects the following lines up to its closer (or EOF); an HTML block
	 * or an unterminated tag owns the rest of its paragraph. Null means the
	 * failure is local to line `k`. Inert markers (escaped, code spans, already
	 * recognized protected notation) are not continuation.
	 */
	const continuationEnd = (k: number, blockLast: number): number | null => {
		const ends: number[] = [];
		for (const opener of unclosedContinuations(lines[k]!.text)) {
			if (opener.kind === "html-block") ends.push(blockLast);
			else if (opener.kind === "html-comment") ends.push(lineClosing(k + 1, "html-comment"));
			else if (opener.kind === "raw-html") ends.push(lineClosing(k + 1, { rawHtml: opener.tag }));
			else if (opener.kind === "display-math") ends.push(lineClosing(k + 1, "display-math"));
			else if (opener.kind === "obsidian-comment") ends.push(lineClosing(k + 1, "obsidian-comment"));
			else ends.push(lineClosing(k + 1, "ruby"));
		}
		return ends.length ? Math.max(k, ...ends) : null;
	};
	/** Lines `from..to` as one inert pre block. */
	const protectLines = (from: number, to: number): number => {
		newBlock(lines[from]!.start, lines[to]!.next, "pre");
		protect(lines[from]!.start, lines[to]!.next);
		return to + 1;
	};
	/**
	 * Target mode: one paragraph block (`i..j-1`, no blank line). Each soft line
	 * is analyzed or protected on its own, so a local unsupported construct no
	 * longer discards the lines before and after it. Returns the next line.
	 */
	const targetParagraph = (i: number, j: number): number => {
		let k = i;
		while (k < j) {
			const first = lines[k]!;
			const heading = HEADING.exec(first.text);
			if (!heading && STRUCTURAL_START.test(first.text)) {
				// Lists, quotes, indented code and thematic/setext lines own the
				// rest of the block; open constructs inside may extend further.
				let end = j - 1;
				for (let m = k; m < j; m += 1) end = Math.max(end, continuationEnd(m, j - 1) ?? m);
				k = protectLines(k, end);
				continue;
			}
			const pieces: Piece[] = [];
			let analyzed = false;
			let m = k;
			let region: { from: number; to: number } | null = null;
			for (; m < j; m += 1) {
				const line = lines[m]!;
				// An ATX heading is a single line; headings and block constructs
				// interrupt a paragraph.
				if (m > k && (heading || HEADING.test(line.text) || STRUCTURAL_INTERRUPT.test(line.text))) break;
				const contentStart = m === k ? line.start + (heading?.[0].length ?? 0) : line.start;
				const unsupported = unsupportedTargetLine(line.text, m === k && !!heading);
				const child = unsupported ? null : inline(contentStart, line.end);
				if (child && rubyValid(child)) {
					// A soft line is an explicit br boundary; no token or ruby spans it.
					if (m > k) pieces.push({ kind: "break", start: lines[m - 1]!.end, end: lines[m - 1]!.next },
						{ kind: "inline", input: { kind: "text", ...bind(lines[m - 1]!.end, lines[m - 1]!.next) } });
					pieces.push(...child);
					analyzed = true;
					continue;
				}
				const end = continuationEnd(m, j - 1);
				if (end !== null && end > m) { region = { from: m, to: end }; break; }
				if (m > k) pieces.push({ kind: "break", start: lines[m - 1]!.end, end: lines[m - 1]!.next },
					{ kind: "inline", input: { kind: "text", ...bind(lines[m - 1]!.end, lines[m - 1]!.next) } });
				pieces.push({ kind: "protected", start: line.start, end: line.end, visibleStart: line.start, visibleEnd: line.end, tag: "span", placeholder: false });
			}
			if (m > k) {
				const last = lines[m - 1]!;
				if (analyzed) {
					newBlock(first.start, last.next, heading ? (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[heading[0].trim().length - 1]! : "p");
					syntax(first.start, first.start + (heading?.[0].length ?? 0)); syntax(last.end, last.next);
					emitPieces(pieces);
				} else {
					// Nothing here could be analyzed: keep the plain protected block.
					protectLines(k, m - 1);
				}
			}
			k = region ? protectLines(region.from, region.to) : m;
		}
		return k;
	};

	if (replay) replay({ newBlock, syntax, protect, inline, rubyValid, bind, emitPieces });

	for (let i = 0; !replay && i < lines.length;) {
		const line = lines[i]!;
		if (!line.text.trim()) { syntax(line.start, line.next); i += 1; continue; }
		if ((i === 0 && isFrontmatterOpenerLine(line.text)) || markdownFenceOpener(line.text) !== null) {
			block = { rawRange: { start: line.start, end: line.next }, tag: "p", items: [] }; blocks.push(block);
			const frontmatter = i === 0 && isFrontmatterOpenerLine(line.text);
			const fence = markdownFenceOpener(line.text) ?? "";
			let j = i + 1, closed = false;
			while (j < lines.length) {
				const candidate = lines[j]!.text.trim();
				if (frontmatter ? /^(---|\.\.\.)$/.test(candidate) : isMarkdownFenceCloser(candidate, fence)) { j += 1; closed = true; break; }
				j += 1;
			}
			block.tag = "pre"; block.rawRange.end = lines[j - 1]!.next;
			// Only a frontmatter this parser saw close is metadata. An unclosed
			// opener keeps protecting to EOF, and hiding that would hide the note.
			if (frontmatter && closed && mode === "target-prototype") block.hidden = "frontmatter";
			protect(line.start, lines[j - 1]!.next); i = j; continue;
		}
		let j = i + 1;
		while (j < lines.length && lines[j]!.text.trim() && markdownFenceOpener(lines[j]!.text) === null) j += 1;
		if (mode === "target-prototype") { i = targetParagraph(i, j); continue; }
		// Source v1: single-line paragraphs and simple ATX headings. Soft/hard
		// wraps, lists, quotes, tables, indentation and extension blocks are
		// excluded whole, and a possible continuation protects to EOF.
		block = { rawRange: { start: line.start, end: line.next }, tag: "p", items: [] }; blocks.push(block);
		const last = lines[j - 1]!;
		block.rawRange.end = last.next;
		const heading = HEADING.exec(line.text);
		if (heading) block.tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[heading[0].trim().length - 1]!;
		const start = line.start + (heading?.[0].length ?? 0);
		const end = line.end;
		const blocked = j !== i + 1 || (!heading && /^[ \t]/.test(line.text)) ||
			/^(?: {4}|\t| {0,3}(?:>|[-+*]\s|\d+[.)]\s|\[|[-=_]{3}))/u.test(line.text) || / $/.test(line.text);
		let pieces = blocked ? null : inline(start, end);
		if (pieces && !rubyValid(pieces)) pieces = null;
		if (!pieces) {
			// An unsupported HTML opener can continue through blank lines. Protect
			// the remainder, never analyze text inside a script/style/HTML block.
			const raw = markdown.slice(line.start, last.end);
			let rubyDepth = 0;
			for (const c of raw) {
				if (c === "《") rubyDepth += 1;
				if (c === "》") rubyDepth = Math.max(0, rubyDepth - 1);
			}
			const canContinue = /<|\$|%%|｜/.test(raw) || rubyDepth > 0;
			block.tag = "pre"; block.rawRange.end = canContinue ? markdown.length : last.next;
			protect(line.start, canContinue ? markdown.length : last.next);
			if (canContinue) break;
		} else {
			syntax(line.start, start); syntax(last.end, last.next);
			emitPieces(pieces);
		}
		i = j;
	}
	return freezeAnalysis({ policyVersion: mode === "source" ? SOURCE_PROJECTION_POLICY_VERSION : TARGET_PRESENTATION_POLICY_VERSION,
		document: createAnalysisDocument(segments), bindings,
		presentation: { blocks, decorations },
		exclusions: exclusions.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end),
	});
}

export { targetBoundaryBarriers } from "./activeContinuation";
