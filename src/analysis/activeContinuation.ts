/**
 * Target-only continuation: decide whether a start marker on a failed line is
 * active ordinary text or inert (escaped, inside a closed code span, inside an
 * HTML attribute value, or inside already-recognized protected notation).
 * Source mode never imports this.
 *
 * Fail-closed: unrecognized text stays active. A genuine unclosed construct in
 * ordinary text still owns the rest of the note until its closer or EOF.
 * HTML tags and code spans are scanned in source order and do not borrow
 * delimiters from each other's interiors. A code span that started first
 * closes on the next matching backtick run even if that run later sits inside
 * HTML source text; the opener walk never starts a span from inside a tag.
 */

/** The same fence tokens and closer predicate used by the Markdown parser. */
export function markdownFenceOpener(line: string): string | null {
	return /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
}
export function isMarkdownFenceCloser(line: string, fence: string): boolean {
	const candidate = line.trim();
	return candidate.length >= fence.length && [...candidate].every(c => c === fence[0]);
}

/** HTML syntax void elements; parseHtmlTag already folds ASCII tag names to lowercase.
 * https://html.spec.whatwg.org/multipage/syntax.html#void-elements
 * Used only by the Chunk barrier scanner; production recovery policy is unchanged. */
const VOID_HTML = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/u;

const RAW_HTML = /^(script|style|pre|textarea)\b/iu;
/** Keep in sync with projectMarkdownSource: complete Aozora annotation. */
const AOZORA_ANNOTATION = /^※?［＃[^［］\r\n]*］(?:《[^《》｜\r\n]+》)?/u;

export type RawHtmlTag = "script" | "style" | "pre" | "textarea";
export type UnclosedContinuation =
	| { kind: "html-comment" }
	| { kind: "raw-html"; tag: RawHtmlTag }
	| { kind: "html-block" }
	| { kind: "display-math" }
	| { kind: "obsidian-comment" }
	| { kind: "ruby" };
export type ContinuationCloser =
	| "html-comment"
	| "display-math"
	| "obsidian-comment"
	| "ruby"
	| { readonly rawHtml: RawHtmlTag };

/** Exclusive end of a closed inline code span at `start`, matching delimiter length.
 * Once a span has started, later HTML is ordinary content, not a region to skip. */
export function closedCodeSpanEnd(text: string, start: number): number | null {
	if (text[start] !== "`") return null;
	let opener = 0;
	while (start + opener < text.length && text[start + opener] === "`") opener += 1;
	let cursor = start + opener;
	while (cursor < text.length) {
		if (text[cursor] !== "`") { cursor += 1; continue; }
		let n = 0;
		while (cursor + n < text.length && text[cursor + n] === "`") n += 1;
		if (n === opener) return cursor + n;
		cursor += n;
	}
	return null;
}

/** True when `index` can start a continuation construct (ordinary text). */
export function isActiveOpenerIndex(text: string, index: number): boolean {
	if (index < 0 || index >= text.length) return false;
	const lexical = lexicalInertMask(text);
	if (lexical[index]) return false;
	return closedPairInteriors(text, lexical)[index] !== 1;
}

export function unclosedContinuations(text: string): UnclosedContinuation[] {
	const lexical = lexicalInertMask(text);
	const interiors = closedPairInteriors(text, lexical);
	const found: UnclosedContinuation[] = [];
	if (unpairedDelimiter(text, "<!--", "-->", lexical, interiors)) found.push({ kind: "html-comment" });
	if (unpairedDelimiter(text, "$$", "$$", lexical, interiors)) found.push({ kind: "display-math" });
	if (unpairedDelimiter(text, "%%", "%%", lexical, interiors)) found.push({ kind: "obsidian-comment" });
	let rubyDepth = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (!plainActive(lexical, interiors, i)) continue;
		const raw = rawHtmlOpen(text, i, lexical, interiors);
		if (raw) {
			if (findToken(text, raw.end, `</${raw.tag}`, lexical, interiors, true) === null) {
				found.push({ kind: "raw-html", tag: raw.tag });
			}
			i = raw.end - 1;
			continue;
		}
		if (text[i] === "《") rubyDepth += 1;
		if (text[i] === "》") rubyDepth = Math.max(0, rubyDepth - 1);
	}
	if (rubyDepth > 0) found.push({ kind: "ruby" });
	if (htmlBlockOpens(text, lexical, interiors)) found.push({ kind: "html-block" });
	return found;
}

export function hasActiveContinuationCloser(text: string, closer: ContinuationCloser): boolean {
	const lexical = lexicalInertMask(text);
	const interiors = closedPairInteriors(text, lexical);
	if (closer === "html-comment") return findToken(text, 0, "-->", lexical, interiors) !== null;
	if (closer === "display-math") return findToken(text, 0, "$$", lexical, interiors) !== null;
	if (closer === "obsidian-comment") return findToken(text, 0, "%%", lexical, interiors) !== null;
	if (closer === "ruby") {
		for (let i = 0; i < text.length; i += 1) {
			if (plainActive(lexical, interiors, i) && text[i] === "》") return true;
		}
		return false;
	}
	return findToken(text, 0, `</${closer.rawHtml}`, lexical, interiors, true) !== null;
}

function lexicalInertMask(text: string): Uint8Array {
	const inert = new Uint8Array(text.length);
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\\" && i + 1 < text.length) {
			inert[i + 1] = 1;
			i += 2;
			continue;
		}
		if (text[i] === "<") {
			const tag = parseHtmlTag(text, i, (index) => inert[index] !== 1);
			if (tag) {
				for (const value of tag.values) fill(inert, value.start, value.end);
				i = Math.max(i + 1, tag.end);
				continue;
			}
		}
		if (text[i] === "`") {
			const end = closedCodeSpanEnd(text, i);
			if (end !== null) { fill(inert, i, end); i = end; continue; }
		}
		i += 1;
	}
	i = 0;
	while (i < text.length) {
		if (inert[i]) { i += 1; continue; }
		const end = closedRecognizedEnd(text, i);
		if (end !== null) { fill(inert, i, end); i = end; continue; }
		i += 1;
	}
	return inert;
}

function closedPairInteriors(text: string, lexical: Uint8Array): Uint8Array {
	const interiors = new Uint8Array(text.length);
	pairInteriors(text, "<!--", "-->", lexical, interiors);
	pairInteriors(text, "$$", "$$", lexical, interiors);
	pairInteriors(text, "%%", "%%", lexical, interiors);
	return interiors;
}

function pairInteriors(
	text: string, open: string, close: string, lexical: Uint8Array, interiors: Uint8Array,
): void {
	let i = 0;
	while (i < text.length) {
		if (!plainActive(lexical, interiors, i) || !tokenAt(text, i, open, lexical, interiors)) {
			i += 1;
			continue;
		}
		const closer = findToken(text, i + open.length, close, lexical, interiors);
		if (closer === null) { i += open.length; continue; }
		fill(interiors, i + open.length, closer);
		i = closer + close.length;
	}
}

function unpairedDelimiter(
	text: string, open: string, close: string, lexical: Uint8Array, interiors: Uint8Array,
): boolean {
	let i = 0;
	let unpaired = false;
	while (i < text.length) {
		if (!plainActive(lexical, interiors, i) || !tokenAt(text, i, open, lexical, interiors)) {
			i += 1;
			continue;
		}
		const closer = findToken(text, i + open.length, close, lexical, interiors);
		if (closer === null) { unpaired = true; i += open.length; continue; }
		i = closer + close.length;
	}
	return unpaired;
}

function closedRecognizedEnd(text: string, start: number): number | null {
	const rest = text.slice(start);
	const c = text[start]!;
	if (c === "$" && !rest.startsWith("$$")) {
		const match = /^\$([^$\r\n]+)\$/.exec(rest);
		if (match) return start + match[0].length;
	}
	if (c === "[" || (c === "!" && rest[1] === "[")) {
		const wiki = /^!?\[\[([^\]\r\n[]+)\]\]/.exec(rest);
		if (wiki) return start + wiki[0].length;
		const link = /^!?\[([^\]\\\r\n[]*)\]\([^()\s\\]*\)/.exec(rest);
		if (link) return start + link[0].length;
	}
	if (c === "※" || c === "［") {
		const annotation = AOZORA_ANNOTATION.exec(rest);
		if (annotation) return start + annotation[0].length;
	}
	return null;
}

function htmlBlockOpens(text: string, lexical: Uint8Array, interiors: Uint8Array): boolean {
	const active = (index: number): boolean => plainActive(lexical, interiors, index);
	if (hasUnterminatedHtmlTag(text, active)) return true;
	let i = 0;
	while (i < 3 && text[i] === " ") i += 1;
	const after = text[i + 1] ?? "";
	if (!active(i) || text[i] !== "<" || !/[A-Za-z!?/]/u.test(after)) return false;
	if (after === "!" || after === "?" || after === "/") return true;
	const tag = parseHtmlTag(text, i, active);
	if (!tag || !tag.complete) return true;
	if (tag.closing) return true;
	if (tag.selfClosing) return false;
	return !hasMatchingCloseTag(text, tag.end, tag.name, active);
}

type HtmlTag = {
	name: string;
	closing: boolean;
	selfClosing: boolean;
	complete: boolean;
	end: number;
	values: readonly { start: number; end: number }[];
};

/** Quote-aware tag. Attribute values (quoted or unquoted) are interiors; `>` inside quotes does not end the tag. */
function parseHtmlTag(text: string, start: number, active: (index: number) => boolean, multiline = false): HtmlTag | null {
	if (text[start] !== "<" || !active(start)) return null;
	if (text.startsWith("<!--", start) || text.startsWith("<?", start) || text.startsWith("<!", start)) return null;
	let i = start + 1;
	const closing = text[i] === "/";
	if (closing) i += 1;
	if (i >= text.length || !/[A-Za-z]/u.test(text[i]!)) return null;
	const nameStart = i;
	i += 1;
	while (i < text.length && /[A-Za-z0-9:-]/u.test(text[i]!)) i += 1;
	const name = text.slice(nameStart, i).toLowerCase();
	const values: { start: number; end: number }[] = [];
	// Chunk scanning spans raw lines and uses HTML ASCII whitespace at every
	// attribute boundary. Preserve the production line-recovery policy.
	const whitespace = multiline ? /[ \t\n\r\f]/u : /[ \t]/u;
	while (i < text.length) {
		while (i < text.length && whitespace.test(text[i]!)) i += 1;
		if (i >= text.length) return { name, closing, selfClosing: false, complete: false, end: text.length, values };
		if (!active(i)) { i += 1; continue; }
		if (text[i] === ">") return { name, closing, selfClosing: false, complete: true, end: i + 1, values };
		if (text[i] === "/" && text[i + 1] === ">") {
			return { name, closing, selfClosing: true, complete: true, end: i + 2, values };
		}
		if (!/[A-Za-z_:]/u.test(text[i]!)) {
			return { name, closing, selfClosing: false, complete: false, end: text.length, values };
		}
		i += 1;
		while (i < text.length && /[A-Za-z0-9_.:-]/u.test(text[i]!)) i += 1;
		while (i < text.length && whitespace.test(text[i]!)) i += 1;
		if (text[i] !== "=") continue;
		i += 1;
		while (i < text.length && whitespace.test(text[i]!)) i += 1;
		const quote = text[i];
		if (quote === "\"" || quote === "'") {
			i += 1;
			const valueStart = i;
			while (i < text.length && text[i] !== quote) i += 1;
			values.push({ start: valueStart, end: i });
			if (i >= text.length) return { name, closing, selfClosing: false, complete: false, end: text.length, values };
			i += 1;
			continue;
		}
		const valueStart = i;
		while (i < text.length && !whitespace.test(text[i]!) && !/["'=<>`]/u.test(text[i]!)) i += 1;
		if (valueStart < i) values.push({ start: valueStart, end: i });
	}
	return { name, closing, selfClosing: false, complete: false, end: text.length, values };
}

function hasUnterminatedHtmlTag(text: string, active: (index: number) => boolean): boolean {
	for (let i = 0; i < text.length; i += 1) {
		if (!active(i) || text[i] !== "<") continue;
		const tag = parseHtmlTag(text, i, active);
		if (tag && !tag.complete) return true;
	}
	return false;
}

function hasMatchingCloseTag(
	text: string, from: number, name: string, active: (index: number) => boolean,
): boolean {
	for (let i = from; i < text.length; i += 1) {
		if (!active(i) || text[i] !== "<") continue;
		const tag = parseHtmlTag(text, i, active);
		if (tag?.complete && tag.closing && tag.name === name) return true;
		if (tag?.complete) i = tag.end - 1;
	}
	return false;
}

function rawHtmlOpen(
	text: string, start: number, lexical: Uint8Array, interiors: Uint8Array,
): { tag: RawHtmlTag; end: number } | null {
	if (text[start] !== "<") return null;
	const match = RAW_HTML.exec(text.slice(start + 1));
	if (!match) return null;
	const end = start + 1 + match[0].length;
	for (let i = start; i < end; i += 1) if (!plainActive(lexical, interiors, i)) return null;
	return { tag: match[1]!.toLowerCase() as RawHtmlTag, end };
}

function findToken(
	text: string, from: number, token: string, lexical: Uint8Array, interiors: Uint8Array, htmlClose = false,
): number | null {
	for (let i = from; i < text.length; i += 1) {
		if (tokenAt(text, i, token, lexical, interiors) && (!htmlClose || htmlNameEnds(text, i + token.length))) {
			return i;
		}
	}
	return null;
}

function tokenAt(
	text: string, start: number, token: string, lexical: Uint8Array, interiors: Uint8Array,
): boolean {
	if (start + token.length > text.length) return false;
	for (let k = 0; k < token.length; k += 1) {
		if (!plainActive(lexical, interiors, start + k)) return false;
		if (text[start + k]!.toLowerCase() !== token[k]!.toLowerCase()) return false;
	}
	return true;
}

function htmlNameEnds(text: string, index: number): boolean {
	const next = text[index] ?? "";
	return next === "" || !/[A-Za-z0-9]/u.test(next);
}

function plainActive(lexical: Uint8Array, interiors: Uint8Array, index: number): boolean {
	return lexical[index] !== 1 && interiors[index] !== 1;
}

function fill(mask: Uint8Array, start: number, end: number): void {
	for (let i = start; i < end; i += 1) mask[i] = 1;
}

/**
 * Additional lexical barriers for Chunk boundaries. Uses the same code/tag
 * scanner as continuation recovery, over the raw snapshot rather than one
 * line. The production projection deliberately supports fewer inline forms;
 * an unsupported multiline form must still not be cut into independent
 * Chunks. This scanner only removes candidates; it never certifies one.
 * Unclosed constructs own the remaining snapshot. No text is retained.
 */
export function targetBoundaryBarriers(text: string, opaque: readonly { start: number; end: number }[] = []): readonly { start: number; end: number }[] {
	const barriers: { start: number; end: number }[] = [];
	const literal = (): boolean => true;
	const delimiterEnd = (from: number, delimiter: string): number => {
		for (let i = from; i < text.length; i += 1) {
			if (text[i] === "\\") { i += 1; continue; }
			if (text.startsWith(delimiter, i)) return i + delimiter.length;
		}
		return text.length;
	};
	const bracketsEnd = (start: number, opener: string, closer: string): number => {
		let depth = 1;
		for (let i = start + 1; i < text.length; i += 1) {
			if (text[i] === "\\") { i += 1; continue; }
			if (text[i] === opener) depth += 1;
			if (text[i] === closer && --depth === 0) return i + 1;
		}
		return text.length;
	};
	let region = 0;
	for (let i = 0; i < text.length;) {
		while (region < opaque.length && opaque[region]!.end <= i) region += 1;
		if (region < opaque.length && opaque[region]!.start === i) {
			i = opaque[region]!.end; continue;
		}
		if (text[i] === "\\") { i += 2; continue; }
		const fence = (i === 0 || text[i - 1] === "\n" || text[i - 1] === "\r") ? markdownFenceOpener(text.slice(i)) : null;
		if (fence) {
			const start = i;
			let at = i;
			while (at < text.length && text[at] !== "\n" && text[at] !== "\r") at += 1;
			at += text.startsWith("\r\n", at) ? 2 : at < text.length ? 1 : 0;
			while (at < text.length) {
				let end = at;
				while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
				const closes = isMarkdownFenceCloser(text.slice(at, end), fence);
				at = end + (text.startsWith("\r\n", end) ? 2 : end < text.length ? 1 : 0);
				if (closes) break;
			}
			barriers.push({ start, end: at }); i = at; continue;
		}
		const recognized = closedRecognizedEnd(text, i);
		if (recognized !== null) { i = recognized; continue; }
		const start = i;
		let end: number | null = null;
		if (text[i] === "`") end = closedCodeSpanEnd(text, i) ?? text.length;
		else if (text.startsWith("<!--", i)) end = delimiterEnd(i + 4, "-->");
		else if (text.startsWith("%%", i)) end = delimiterEnd(i + 2, "%%");
		else if (text[i] === "《" || text[i] === "｜") end = delimiterEnd(i + 1, "》");
		else if (text.startsWith("［＃", i)) {
			end = delimiterEnd(i + 2, "］");
			if (text[end] === "《") end = delimiterEnd(end + 1, "》");
		} else if (text[i] === "$") {
			const delimiter = text.startsWith("$$", i) ? "$$" : "$";
			end = delimiterEnd(i + delimiter.length, delimiter);
		} else if (text[i] === "[") {
			end = bracketsEnd(i, "[", "]");
			if (text[end] === "(") end = bracketsEnd(end, "(", ")");
		} else if (text[i] === "<") {
			const tag = parseHtmlTag(text, i, literal, true);
			if (tag) {
				end = tag.complete ? tag.end : text.length;
				if (tag.complete && !tag.selfClosing && !tag.closing && !VOID_HTML.test(tag.name)) {
					// Matching element, including nested elements of the same name.
					// Attribute values are consumed by the shared quote-aware scanner.
					let depth = 1;
					const rawText = RAW_HTML.test(tag.name);
					for (let at = tag.end; at < text.length;) {
						if (!rawText && text.startsWith("<!--", at)) {
							const close = text.indexOf("-->", at + 4);
							at = close < 0 ? text.length : close + 3; continue;
						}
						const child = text[at] === "<" ? parseHtmlTag(text, at, literal, true) : null;
						if (!child) { at += 1; continue; }
						if (child.name === tag.name && !child.selfClosing && (!rawText || child.closing)) depth += child.closing ? -1 : 1;
						at = child.end;
						if (!rawText && !child.closing && !child.selfClosing && RAW_HTML.test(child.name)) {
							while (at < text.length) {
								const closer = text[at] === "<" ? parseHtmlTag(text, at, literal, true) : null;
								if (closer?.closing && closer.name === child.name) { at = closer.end; break; }
								at += 1;
							}
						}
						if (depth === 0) { end = at; break; }
					}
					if (depth !== 0) end = text.length;
				}
			}
		}
		if (end !== null) { barriers.push({ start, end }); i = end; }
		else i += 1;
	}
	return barriers;
}
