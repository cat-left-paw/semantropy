/**
 * Verbatim copy of projectMarkdownSource as it stood after
 * PRE-RELEASE-TARGET-SAFE-PRODUCTION1 (before FIX1). Test-only reference:
 * Source mode must stay byte-identical, and Target mode must be unchanged for
 * inputs the old recovery did not over-protect. Never imported by src/.
 */
import {
	createAnalysisDocument, createProtectedRun, parseRubyAwareInlineRun,
	type AnalysisDocumentSegment, type InlineAnalysisInput,
	type HtmlRubyPartInput, type SourceTextInput, type Utf16Range,
} from "../../src/analysis/rubyAnalysis";
import { freezeAnalysis } from "../../src/analysis/rubyVocabulary";

import { SOURCE_PROJECTION_POLICY_VERSION, type MarkdownSourceBinding, type MarkdownSourceProjection, type PresentationBlock, type PresentationDecoration } from "../../src/analysis/projectMarkdownSource";

/** The reference keeps its historical Target policy id. */
type ReferenceProjection = Omit<MarkdownSourceProjection, "policyVersion"> & { policyVersion: string };

type Piece = { kind: "inline"; input: InlineAnalysisInput } |
	{ kind: "break"; start: number; end: number } |
	{ kind: "protected"; start: number; end: number; visibleStart: number; visibleEnd: number; tag: "span" | "code"; placeholder: boolean };
type Line = { start: number; end: number; next: number; text: string };

/** No rendering, URL resolution, file reads, entities, or Markdown extensions. */
export function referenceProjectMarkdownSource(markdown: string, mode: "source" | "target-prototype" = "source"): ReferenceProjection {
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
	const flush = (inputs: InlineAnalysisInput[]): void => {
		if (!inputs.length) return;
		const text = inputs.flatMap(i => i.kind === "text" ? [i.text] : i.parts.map(p => p.text)).join("");
		if (!text.trim()) {
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
	for (let start = 0; start < markdown.length;) {
		let end = start;
		while (end < markdown.length && markdown[end] !== "\n" && markdown[end] !== "\r") end += 1;
		const next = end + (markdown.startsWith("\r\n", end) ? 2 : end < markdown.length ? 1 : 0);
		lines.push({ start, end, next, text: markdown.slice(start, end) }); start = next;
	}
	for (let i = 0; i < lines.length;) {
		const line = lines[i]!;
		if (!line.text.trim()) { syntax(line.start, line.next); i += 1; continue; }
		block = { rawRange: { start: line.start, end: line.next }, tag: "p", items: [] };
		blocks.push(block);
		if ((i === 0 && /^\uFEFF?---\s*$/.test(line.text)) || /^ {0,3}(`{3,}|~{3,})/.test(line.text)) {
			const frontmatter = i === 0 && /^\uFEFF?---\s*$/.test(line.text);
			const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line.text)?.[1] ?? "";
			let j = i + 1;
			while (j < lines.length) {
				const candidate = lines[j]!.text.trim();
				if (frontmatter ? /^(---|\.\.\.)$/.test(candidate) : candidate.length >= fence.length && [...candidate].every(c => c === fence[0])) { j += 1; break; }
				j += 1;
			}
			block.tag = "pre"; block.rawRange.end = lines[j - 1]!.next;
			protect(line.start, lines[j - 1]!.next); i = j; continue;
		}
		let j = i + 1;
		while (j < lines.length && lines[j]!.text.trim() && !/^ {0,3}(?:`{3,}|~{3,})/.test(lines[j]!.text)) j += 1;
		const last = lines[j - 1]!;
		block.rawRange.end = last.next;
		// V1: single-line paragraphs and simple ATX headings. Soft/hard wraps, lists,
		// quotes, tables, indentation and extension blocks are excluded whole.
		const heading = /^ {0,3}#{1,6} /.exec(line.text);
		if (heading) block.tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[heading[0].trim().length - 1]!;
		const start = line.start + (heading?.[0].length ?? 0);
		const end = line.end;
		const blocked = (j !== i + 1 && (mode === "source" || !!heading)) || (!heading && /^[ \t]/.test(line.text)) ||
			/^(?: {4}|\t| {0,3}(?:>|[-+*]\s|\d+[.)]\s|\[|[-=_]{3}))/u.test(line.text) || / $/.test(line.text);
		let pieces = blocked ? null : inline(start, end);
		// Target-only soft lines: explicit br boundaries, never a token/ruby
		// spanning the break. Source v1 remains single-line and fail-closed.
		if (pieces && mode === "target-prototype") for (let k = i + 1; k < j; k += 1) {
			const next = lines[k]!, previous = lines[k - 1]!;
			const child = /^(?:[ \t]|#{1,6} |>|[-+*]\s|\d+[.)]\s|\[|[-=_]{3})| $/.test(next.text) ? null : inline(next.start, next.end);
			if (!child) { pieces = null; break; }
			pieces.push({ kind: "break", start: previous.end, end: previous.next },
				{ kind: "inline", input: { kind: "text", ...bind(previous.end, previous.next) } }, ...child);
		}
		if (pieces) {
			let pending: InlineAnalysisInput[] = [];
			const groups: InlineAnalysisInput[][] = [];
			for (const piece of pieces) {
				if (piece.kind === "inline") pending.push(piece.input);
				else { groups.push(pending); pending = []; }
			}
			groups.push(pending);
			// Do not expose the middle of a malformed ruby separated by several
			// protected nodes as a new, apparently ordinary candidate run.
			if (groups.some(inputs => parseRubyAwareInlineRun({ runId: "validation", inputs }).kind === "protected")) pieces = null;
		}
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
			let pending: InlineAnalysisInput[] = [];
			for (const piece of pieces) {
				if (piece.kind === "inline") pending.push(piece.input);
				else {
					flush(pending); pending = [];
					if (piece.kind === "break") block.items.push({ kind: "break", rawRange: { start: piece.start, end: piece.end } });
					else protect(piece.start, piece.end, piece.visibleStart, piece.visibleEnd, piece.tag, piece.placeholder);
				}
			}
			flush(pending);
		}
		i = j;
	}
	return freezeAnalysis({ policyVersion: mode === "source" ? SOURCE_PROJECTION_POLICY_VERSION : "target-presentation-1",
		document: createAnalysisDocument(segments), bindings,
		presentation: { blocks, decorations },
		exclusions: exclusions.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end),
	});
}
