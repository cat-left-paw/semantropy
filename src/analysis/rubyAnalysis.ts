/** A half-open range measured in JavaScript UTF-16 code units. */
export type Utf16Range = {
	start: number;
	end: number;
};

export type SourceTextInput = {
	sourceId: string;
	text: string;
};

export type HtmlRubyPartInput = SourceTextInput & {
	role: "base" | "reading" | "marker";
};

export type RubyNotation = "aozora-short" | "aozora-explicit" | "html";

export type InlineAnalysisInput =
	| ({ kind: "text" } & SourceTextInput)
	| {
			kind: "html-ruby";
			notation: RubyNotation;
			parts: readonly HtmlRubyPartInput[];
	  };

export type SourcePartKind =
	| "text"
	| "ruby-base"
	| "ruby-reading"
	| "ruby-marker";

/** A reference back to a UTF-16 range in one adapter-owned source string. */
export type SourcePartRef = {
	partId: string;
	sourceId: string;
	range: Utf16Range;
};

export type SourcePart = {
	partId: string;
	kind: SourcePartKind;
	text: string;
	/** Range in AnalysisRun.originalText, including ruby readings and markers. */
	originalRange: Utf16Range;
	/** Range in the originating string (a DOM Text node in the DOM adapter). */
	source: SourcePartRef;
};

export type PositionSegment = {
	/** Range in AnalysisRun.originalText. */
	originalRange: Utf16Range;
	/** Range in AnalysisRun.analysisText. */
	analysisRange: Utf16Range;
	sourcePart: SourcePartRef;
};

export type RubyAnnotation = {
	annotationId: string;
	baseRange: Utf16Range;
	reading: string;
	notation: RubyNotation;
	/** Range in AnalysisRun.originalText. */
	originalRange: Utf16Range;
	originalParts: readonly SourcePartRef[];
};

export type AnalysisRun = {
	runId: string;
	/** Source text as represented by the rendered DOM, before ruby removal. */
	originalText: string;
	/** Parent text is present; ruby readings and markers are absent. */
	analysisText: string;
	sourceParts: readonly SourcePart[];
	annotations: readonly RubyAnnotation[];
	mapping: readonly PositionSegment[];
};

export type ProtectedRunReason =
	| "malformed-ruby"
	| "unsupported-ruby"
	| "invalid-html-ruby"
	| "protected-dom";

export type ProtectedRun = {
	runId: string;
	originalText: string;
	reason: ProtectedRunReason;
	sourceParts: readonly SourcePart[];
};

export type AnalysisDocumentSegment =
	| { kind: "analysis"; run: AnalysisRun }
	| { kind: "protected"; run: ProtectedRun };

export type AnalysisDocument = {
	segments: readonly AnalysisDocumentSegment[];
	runs: readonly AnalysisRun[];
	protectedRuns: readonly ProtectedRun[];
};

export type ParsedInlineRun = AnalysisDocumentSegment;

type AozoraNotation = "aozora-short" | "aozora-explicit";

type ParsedAozoraRuby = {
	notation: AozoraNotation;
	fullRange: Utf16Range;
	baseRange: Utf16Range;
	readingRange: Utf16Range;
	markerRanges: readonly Utf16Range[];
};

type InputSpan = {
	input: SourceTextInput;
	range: Utf16Range;
};

type ParsedTextGroup = {
	text: string;
	spans: readonly InputSpan[];
	rubies: readonly ParsedAozoraRuby[];
};

type ParseFailure = {
	reason: "malformed-ruby" | "unsupported-ruby";
};

const SHORT_BASE_CHARACTER = /^(?:\p{Script=Han}|[々〆ヶヵ])$/u;

function range(start: number, end: number): Utf16Range {
	return { start, end };
}

function hasLineBreak(text: string): boolean {
	return text.includes("\n") || text.includes("\r");
}

function isEmptyRubyText(text: string): boolean {
	return text.trim().length === 0;
}

function codePointStartBefore(text: string, end: number): number {
	const last = text.charCodeAt(end - 1);
	if (last >= 0xdc00 && last <= 0xdfff && end >= 2) {
		const preceding = text.charCodeAt(end - 2);
		if (preceding >= 0xd800 && preceding <= 0xdbff) {
			return end - 2;
		}
	}
	return end - 1;
}

function shortBaseStart(text: string, open: number): number {
	let cursor = open;
	while (cursor > 0) {
		const previous = codePointStartBefore(text, cursor);
		const character = text.slice(previous, cursor);
		if (!SHORT_BASE_CHARACTER.test(character)) {
			break;
		}
		cursor = previous;
	}
	return cursor;
}

function findClosingMarker(
	text: string,
	open: number,
): number | ParseFailure {
	for (let cursor = open + 1; cursor < text.length; cursor += 1) {
		const character = text[cursor];
		if (character === "\n" || character === "\r") {
			return { reason: "malformed-ruby" };
		}
		if (character === "《" || character === "｜") {
			return { reason: "malformed-ruby" };
		}
		if (character === "》") {
			return cursor;
		}
	}
	return { reason: "malformed-ruby" };
}

function asciiBarStartsRuby(text: string, start: number): boolean {
	for (let cursor = start + 1; cursor < text.length; cursor += 1) {
		const character = text[cursor];
		if (character === "\n" || character === "\r") {
			return false;
		}
		if (character === "《") {
			return true;
		}
	}
	return false;
}

function isEscapingBackslash(text: string, start: number): boolean {
	let count = 0;
	for (let cursor = start; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
		count += 1;
	}
	return count % 2 === 1;
}

/**
 * Returns the exclusive end of one complete, visibly escaped Aozora-shaped
 * expression. Its contents remain ordinary text; this only prevents the
 * marker-shaped suffix from being parsed again as ruby.
 */
function escapedAozoraEnd(text: string, slash: number): number | undefined {
	if (!isEscapingBackslash(text, slash)) {
		return undefined;
	}
	const marker = text[slash + 1];
	if (marker === "《") {
		const closing = findClosingMarker(text, slash + 1);
		return typeof closing === "number" ? closing + 1 : undefined;
	}
	if (marker !== "｜") {
		return undefined;
	}

	let open = slash + 2;
	while (open < text.length && text[open] !== "《") {
		const character = text[open];
		if (
			character === "\n" ||
			character === "\r" ||
			character === "》" ||
			character === "｜"
		) {
			return undefined;
		}
		open += 1;
	}
	if (open >= text.length) {
		return undefined;
	}
	const closing = findClosingMarker(text, open);
	return typeof closing === "number" ? closing + 1 : undefined;
}

function parseAozoraText(
	text: string,
): readonly ParsedAozoraRuby[] | ParseFailure {
	const rubies: ParsedAozoraRuby[] = [];
	let lastRubyEnd = 0;

	for (let cursor = 0; cursor < text.length; cursor += 1) {
		const character = text[cursor];
		if (character === "\\") {
			const escapedEnd = escapedAozoraEnd(text, cursor);
			if (escapedEnd !== undefined) {
				cursor = escapedEnd - 1;
				continue;
			}
		}
		if (character === "|" && asciiBarStartsRuby(text, cursor)) {
			return { reason: "unsupported-ruby" };
		}
		if (character === "｜") {
			if (cursor > 0 && isEscapingBackslash(text, cursor - 1)) {
				continue;
			}
			let open = cursor + 1;
			while (open < text.length && text[open] !== "《") {
				const baseCharacter = text[open];
				if (
					baseCharacter === "\n" ||
					baseCharacter === "\r" ||
					baseCharacter === "》" ||
					baseCharacter === "｜"
				) {
					return { reason: "malformed-ruby" };
				}
				open += 1;
			}
			if (open >= text.length) {
				return { reason: "malformed-ruby" };
			}
			const closing = findClosingMarker(text, open);
			if (typeof closing !== "number") {
				return closing;
			}
			const base = text.slice(cursor + 1, open);
			const reading = text.slice(open + 1, closing);
			if (isEmptyRubyText(base) || isEmptyRubyText(reading)) {
				return { reason: "malformed-ruby" };
			}
			rubies.push({
				notation: "aozora-explicit",
				fullRange: range(cursor, closing + 1),
				baseRange: range(cursor + 1, open),
				readingRange: range(open + 1, closing),
				markerRanges: [
					range(cursor, cursor + 1),
					range(open, open + 1),
					range(closing, closing + 1),
				],
			});
			lastRubyEnd = closing + 1;
			cursor = closing;
			continue;
		}
		if (character === "《") {
			if (cursor > 0 && isEscapingBackslash(text, cursor - 1)) {
				continue;
			}
			const baseStart = shortBaseStart(text, cursor);
			if (baseStart === cursor || baseStart < lastRubyEnd) {
				return { reason: "malformed-ruby" };
			}
			const closing = findClosingMarker(text, cursor);
			if (typeof closing !== "number") {
				return closing;
			}
			const reading = text.slice(cursor + 1, closing);
			if (isEmptyRubyText(reading)) {
				return { reason: "malformed-ruby" };
			}
			rubies.push({
				notation: "aozora-short",
				fullRange: range(baseStart, closing + 1),
				baseRange: range(baseStart, cursor),
				readingRange: range(cursor + 1, closing),
				markerRanges: [range(cursor, cursor + 1), range(closing, closing + 1)],
			});
			lastRubyEnd = closing + 1;
			cursor = closing;
			continue;
		}
		if (character === "》") {
			return { reason: "malformed-ruby" };
		}
	}

	return rubies;
}

function flattenTextInputs(inputs: readonly SourceTextInput[]): {
	text: string;
	spans: readonly InputSpan[];
} {
	let cursor = 0;
	const spans: InputSpan[] = [];
	for (const input of inputs) {
		const end = cursor + input.text.length;
		spans.push({ input, range: range(cursor, end) });
		cursor = end;
	}
	return {
		text: inputs.map((input) => input.text).join(""),
		spans,
	};
}

function parseTextGroup(
	inputs: readonly SourceTextInput[],
): ParsedTextGroup | ParseFailure {
	const flattened = flattenTextInputs(inputs);
	const parsed = parseAozoraText(flattened.text);
	if (isAozoraParseFailure(parsed)) {
		return parsed;
	}
	return { ...flattened, rubies: parsed };
}

function isAozoraParseFailure(
	value: readonly ParsedAozoraRuby[] | ParseFailure,
): value is ParseFailure {
	return "reason" in value;
}

function isParseFailure(
	value: ParsedTextGroup | ParseFailure,
): value is ParseFailure {
	return "reason" in value;
}

function isValidHtmlRuby(input: Extract<InlineAnalysisInput, { kind: "html-ruby" }>): boolean {
	const baseParts = input.parts.filter((part) => part.role === "base");
	const readingParts = input.parts.filter((part) => part.role === "reading");
	if (baseParts.length === 0 || readingParts.length !== 1) {
		return false;
	}
	const base = baseParts.map((part) => part.text).join("");
	const reading = readingParts[0]?.text ?? "";
	if (
		isEmptyRubyText(base) ||
		isEmptyRubyText(reading) ||
		hasLineBreak(base) ||
		hasLineBreak(reading)
	) {
		return false;
	}
	return input.parts.every((part) => !hasLineBreak(part.text));
}

function allSourceInputs(inputs: readonly InlineAnalysisInput[]): SourceTextInput[] {
	const sources: SourceTextInput[] = [];
	for (const input of inputs) {
		if (input.kind === "text") {
			sources.push(input);
		} else {
			sources.push(...input.parts);
		}
	}
	return sources;
}

function createProtectedSourceParts(
	runId: string,
	inputs: readonly SourceTextInput[],
): SourcePart[] {
	let originalCursor = 0;
	return inputs.map((input, index) => {
		const originalRange = range(
			originalCursor,
			originalCursor + input.text.length,
		);
		originalCursor = originalRange.end;
		const partId = `${runId}:part:${index}`;
		return {
			partId,
			kind: "text",
			text: input.text,
			originalRange,
			source: {
				partId,
				sourceId: input.sourceId,
				range: range(0, input.text.length),
			},
		};
	});
}

export function createProtectedRun(input: {
	runId: string;
	sources: readonly SourceTextInput[];
	reason: ProtectedRunReason;
}): ProtectedRun {
	return {
		runId: input.runId,
		originalText: input.sources.map((source) => source.text).join(""),
		reason: input.reason,
		sourceParts: createProtectedSourceParts(input.runId, input.sources),
	};
}

/**
 * Parses one uninterrupted inline flow. It is DOM-free: adapters supply
 * stable source IDs and strings, and retain any DOM references themselves.
 * A malformed/unsupported marker protects the complete inline run instead of
 * leaking a reading into tokenization as ordinary prose.
 */
export function parseRubyAwareInlineRun(input: {
	runId: string;
	inputs: readonly InlineAnalysisInput[];
}): ParsedInlineRun {
	for (const part of input.inputs) {
		if (part.kind === "html-ruby" && !isValidHtmlRuby(part)) {
			return {
				kind: "protected",
				run: createProtectedRun({
					runId: input.runId,
					sources: allSourceInputs(input.inputs),
					reason: "invalid-html-ruby",
				}),
			};
		}
	}

	const parsedTextGroups = new Map<number, ParsedTextGroup>();
	let groupStart = 0;
	while (groupStart < input.inputs.length) {
		const first = input.inputs[groupStart];
		if (first?.kind === "html-ruby") {
			groupStart += 1;
			continue;
		}
		let groupEnd = groupStart;
		const sources: SourceTextInput[] = [];
		while (groupEnd < input.inputs.length) {
			const current = input.inputs[groupEnd];
			if (!current || current.kind === "html-ruby") {
				break;
			}
			sources.push(current);
			groupEnd += 1;
		}
		const parsed = parseTextGroup(sources);
		if (isParseFailure(parsed)) {
			return {
				kind: "protected",
				run: createProtectedRun({
					runId: input.runId,
					sources: allSourceInputs(input.inputs),
					reason: parsed.reason,
				}),
			};
		}
		parsedTextGroups.set(groupStart, parsed);
		groupStart = groupEnd;
	}

	let originalText = "";
	let analysisText = "";
	const sourceParts: SourcePart[] = [];
	const mapping: PositionSegment[] = [];
	const annotations: RubyAnnotation[] = [];
	let partIndex = 0;
	let annotationIndex = 0;

	const appendSourceRange = (
		text: string,
		spans: readonly InputSpan[],
		selected: Utf16Range,
		kind: SourcePartKind,
		includeInAnalysis: boolean,
	): SourcePartRef[] => {
		const refs: SourcePartRef[] = [];
		for (const span of spans) {
			const start = Math.max(selected.start, span.range.start);
			const end = Math.min(selected.end, span.range.end);
			if (start >= end) {
				continue;
			}
			const sourceStart = start - span.range.start;
			const sourceEnd = end - span.range.start;
			const value = text.slice(start, end);
			const originalRange = range(
				originalText.length,
				originalText.length + value.length,
			);
			const partId = `${input.runId}:part:${partIndex}`;
			partIndex += 1;
			const sourceRef: SourcePartRef = {
				partId,
				sourceId: span.input.sourceId,
				range: range(sourceStart, sourceEnd),
			};
			const sourcePart: SourcePart = {
				partId,
				kind,
				text: value,
				originalRange,
				source: sourceRef,
			};
			sourceParts.push(sourcePart);
			refs.push(sourceRef);
			originalText += value;
			if (includeInAnalysis) {
				const analysisRange = range(
					analysisText.length,
					analysisText.length + value.length,
				);
				analysisText += value;
				mapping.push({ originalRange, analysisRange, sourcePart: sourceRef });
			}
		}
		return refs;
	};

	const appendParsedTextGroup = (group: ParsedTextGroup): void => {
		let cursor = 0;
		for (const ruby of group.rubies) {
			appendSourceRange(
				group.text,
				group.spans,
				range(cursor, ruby.fullRange.start),
				"text",
				true,
			);

			const annotationParts: SourcePartRef[] = [];
			const baseAnalysisStart = analysisText.length;
			const markerItems: Array<{
				range: Utf16Range;
				kind: SourcePartKind;
				analyzed: boolean;
			}> = ruby.markerRanges.map((markerRange) => ({
					range: markerRange,
					kind: "ruby-marker",
					analyzed: false,
				}));
			const orderedRanges: Array<{
				range: Utf16Range;
				kind: SourcePartKind;
				analyzed: boolean;
			}> = [
				...markerItems,
				{ range: ruby.baseRange, kind: "ruby-base", analyzed: true },
				{
					range: ruby.readingRange,
					kind: "ruby-reading",
					analyzed: false,
				},
			];
			orderedRanges.sort(
				(left, right) => left.range.start - right.range.start,
			);

			for (const item of orderedRanges) {
				annotationParts.push(
					...appendSourceRange(
						group.text,
						group.spans,
						item.range,
						item.kind,
						item.analyzed,
					),
				);
			}
			annotations.push({
				annotationId: `${input.runId}:ruby:${annotationIndex}`,
				baseRange: range(baseAnalysisStart, analysisText.length),
				reading: group.text.slice(
					ruby.readingRange.start,
					ruby.readingRange.end,
				),
				notation: ruby.notation,
				originalRange: range(
					originalText.length -
						(ruby.fullRange.end - ruby.fullRange.start),
					originalText.length,
				),
				originalParts: annotationParts,
			});
			annotationIndex += 1;
			cursor = ruby.fullRange.end;
		}
		appendSourceRange(
			group.text,
			group.spans,
			range(cursor, group.text.length),
			"text",
			true,
		);
	};

	let inputIndex = 0;
	while (inputIndex < input.inputs.length) {
		const current = input.inputs[inputIndex];
		if (!current) {
			break;
		}
		if (current.kind === "text") {
			const group = parsedTextGroups.get(inputIndex);
			if (!group) {
				throw new Error("Ruby parser lost an inline text group.");
			}
			appendParsedTextGroup(group);
			let consumed = 0;
			while (consumed < group.spans.length) {
				consumed += 1;
				inputIndex += 1;
			}
			continue;
		}

		const rubyOriginalStart = originalText.length;
		const rubyAnalysisStart = analysisText.length;
		const annotationParts: SourcePartRef[] = [];
		for (const part of current.parts) {
			const flattened = flattenTextInputs([part]);
			annotationParts.push(
				...appendSourceRange(
					flattened.text,
					flattened.spans,
					range(0, flattened.text.length),
					part.role === "base"
						? "ruby-base"
						: part.role === "reading"
							? "ruby-reading"
							: "ruby-marker",
					part.role === "base",
				),
			);
		}
		const reading = current.parts
			.filter((part) => part.role === "reading")
			.map((part) => part.text)
			.join("");
		annotations.push({
			annotationId: `${input.runId}:ruby:${annotationIndex}`,
			baseRange: range(rubyAnalysisStart, analysisText.length),
			reading,
			notation: current.notation,
			originalRange: range(rubyOriginalStart, originalText.length),
			originalParts: annotationParts,
		});
		annotationIndex += 1;
		inputIndex += 1;
	}

	return {
		kind: "analysis",
		run: {
			runId: input.runId,
			originalText,
			analysisText,
			sourceParts,
			annotations,
			mapping,
		},
	};
}

export function createAnalysisDocument(
	segments: readonly AnalysisDocumentSegment[],
): AnalysisDocument {
	return {
		segments: [...segments],
		runs: segments.flatMap((segment) =>
			segment.kind === "analysis" ? [segment.run] : [],
		),
		protectedRuns: segments.flatMap((segment) =>
			segment.kind === "protected" ? [segment.run] : [],
		),
	};
}
