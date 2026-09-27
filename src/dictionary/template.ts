import {
	isFakeDictionaryPlaceholder,
	type FakeDictionaryPlaceholder,
} from "./placeholders";
import {
	OPTIONAL_CLAUSE_CATEGORIES,
	TEMPLATE_FAMILIES,
	type OptionalClauseCategory,
	type RawCoreTemplate,
	type RawOptionalClause,
	type TemplateFamily,
} from "./templateData";

export type TemplateTextSegment = {
	readonly kind: "text";
	readonly text: string;
};

export type TemplatePlaceholderSegment = {
	readonly kind: "placeholder";
	readonly placeholder: FakeDictionaryPlaceholder;
};

export type TemplateSegment = TemplateTextSegment | TemplatePlaceholderSegment;

export type CompiledCoreTemplate = {
	readonly id: string;
	readonly family: TemplateFamily;
	readonly segments: readonly TemplateSegment[];
	/** Distinct placeholders this template needs, in declaration order. */
	readonly requiredPlaceholders: readonly FakeDictionaryPlaceholder[];
};

export type CompiledOptionalClause = {
	readonly id: string;
	readonly category: OptionalClauseCategory;
	readonly segments: readonly TemplateSegment[];
	readonly requiredPlaceholders: readonly FakeDictionaryPlaceholder[];
};

export type CompiledTemplateSet = {
	readonly version: number;
	readonly coreTemplates: readonly CompiledCoreTemplate[];
	readonly optionalClauses: readonly CompiledOptionalClause[];
};

export type TemplateIssueCode =
	| "duplicate-template-id"
	| "duplicate-clause-id"
	| "unknown-placeholder"
	| "unclosed-placeholder"
	| "empty-placeholder"
	| "empty-core-definition"
	| "invalid-family"
	| "invalid-optional-category"
	| "invalid-id"
	| "required-placeholder-mismatch";

/**
 * One reason a template set was refused.
 *
 * `id` names the offending entry so a failing build says which one, and
 * `detail` carries only structural text — a placeholder name or a family name
 * from the template data itself. Nothing from a user's note reaches here;
 * templates are ours, so quoting them is safe.
 */
export type TemplateIssue = {
	readonly code: TemplateIssueCode;
	readonly id: string;
	readonly detail?: string;
};

export type TemplateCompileResult =
	| { readonly ok: true; readonly set: CompiledTemplateSet }
	| { readonly ok: false; readonly issues: readonly TemplateIssue[] };

type SegmentParse =
	| { readonly ok: true; readonly segments: readonly TemplateSegment[] }
	| { readonly ok: false; readonly code: TemplateIssueCode; readonly detail?: string };

const OPEN = "{{";
const CLOSE = "}}";

/**
 * Ids we mint and persist. Lowercase kebab-case, which every document id and
 * every clause id already satisfies.
 */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const FAMILIES: ReadonlySet<string> = new Set(TEMPLATE_FAMILIES);
const CATEGORIES: ReadonlySet<string> = new Set(OPTIONAL_CLAUSE_CATEGORIES);

/**
 * Splits template text into text and placeholder segments in a single forward
 * pass.
 *
 * The generator later walks these segments and concatenates. It never runs a
 * regular expression over a half-substituted string, which is what makes a
 * candidate containing `{{noun}}` — or `<b>`, or a `$&` — inert: by the time
 * any candidate exists, the structure has already been decided.
 */
export function parseTemplateSegments(source: string): SegmentParse {
	const segments: TemplateSegment[] = [];
	let index = 0;
	let literalStart = 0;

	while (index < source.length) {
		const open = source.indexOf(OPEN, index);
		if (open === -1) {
			break;
		}
		const close = source.indexOf(CLOSE, open + OPEN.length);
		if (close === -1) {
			return { ok: false, code: "unclosed-placeholder" };
		}
		const name = source.slice(open + OPEN.length, close);
		if (name === "") {
			return { ok: false, code: "empty-placeholder" };
		}
		if (name.includes(OPEN)) {
			// `{{ {{noun}}` — an opener inside a name is a malformed placeholder,
			// not a name that happens to contain braces.
			return { ok: false, code: "unclosed-placeholder" };
		}
		if (!isFakeDictionaryPlaceholder(name)) {
			return { ok: false, code: "unknown-placeholder", detail: name };
		}
		if (open > literalStart) {
			segments.push(
				Object.freeze({
					kind: "text",
					text: source.slice(literalStart, open),
				} as const),
			);
		}
		segments.push(
			Object.freeze({ kind: "placeholder", placeholder: name } as const),
		);
		index = close + CLOSE.length;
		literalStart = index;
	}

	if (literalStart < source.length) {
		segments.push(
			Object.freeze({
				kind: "text",
				text: source.slice(literalStart),
			} as const),
		);
	}
	return { ok: true, segments: Object.freeze(segments) };
}

/**
 * The distinct placeholders a segment list needs, precomputed once at compile
 * time so eligibility is a set lookup per template rather than a re-scan of
 * the text on every generation.
 */
export function requiredPlaceholdersOf(
	segments: readonly TemplateSegment[],
): readonly FakeDictionaryPlaceholder[] {
	const required: FakeDictionaryPlaceholder[] = [];
	for (const segment of segments) {
		if (segment.kind !== "placeholder") {
			continue;
		}
		if (!required.includes(segment.placeholder)) {
			required.push(segment.placeholder);
		}
	}
	return Object.freeze(required);
}

/** True when the segments hold at least one non-whitespace character. */
function hasContent(segments: readonly TemplateSegment[]): boolean {
	return segments.some((segment) =>
		segment.kind === "placeholder" ? true : segment.text.trim() !== "",
	);
}

/**
 * Compiles and validates a whole template set.
 *
 * Returns every issue found rather than stopping at the first, so one build
 * failure reports all the broken entries. The standard set is compiled through
 * this same function — there is no path that skips validation.
 */
export function compileTemplateSet(
	version: number,
	rawCoreTemplates: readonly RawCoreTemplate[],
	rawOptionalClauses: readonly RawOptionalClause[],
): TemplateCompileResult {
	const issues: TemplateIssue[] = [];
	const coreTemplates: CompiledCoreTemplate[] = [];
	const optionalClauses: CompiledOptionalClause[] = [];
	const seenIds = new Set<string>();

	for (const raw of rawCoreTemplates) {
		if (!ID_PATTERN.test(raw.id)) {
			issues.push({ code: "invalid-id", id: raw.id });
			continue;
		}
		if (seenIds.has(raw.id)) {
			issues.push({ code: "duplicate-template-id", id: raw.id });
			continue;
		}
		seenIds.add(raw.id);
		if (!FAMILIES.has(raw.family)) {
			issues.push({ code: "invalid-family", id: raw.id, detail: raw.family });
			continue;
		}
		const parsed = parseTemplateSegments(raw.text);
		if (!parsed.ok) {
			issues.push({ code: parsed.code, id: raw.id, detail: parsed.detail });
			continue;
		}
		if (!hasContent(parsed.segments)) {
			issues.push({ code: "empty-core-definition", id: raw.id });
			continue;
		}
		coreTemplates.push(
			Object.freeze({
				id: raw.id,
				family: raw.family as TemplateFamily,
				segments: parsed.segments,
				requiredPlaceholders: requiredPlaceholdersOf(parsed.segments),
			}),
		);
	}

	for (const raw of rawOptionalClauses) {
		if (!ID_PATTERN.test(raw.id)) {
			issues.push({ code: "invalid-id", id: raw.id });
			continue;
		}
		if (seenIds.has(raw.id)) {
			issues.push({ code: "duplicate-clause-id", id: raw.id });
			continue;
		}
		seenIds.add(raw.id);
		if (!CATEGORIES.has(raw.category)) {
			issues.push({
				code: "invalid-optional-category",
				id: raw.id,
				detail: raw.category,
			});
			continue;
		}
		const parsed = parseTemplateSegments(raw.text);
		if (!parsed.ok) {
			issues.push({ code: parsed.code, id: raw.id, detail: parsed.detail });
			continue;
		}
		optionalClauses.push(
			Object.freeze({
				id: raw.id,
				category: raw.category as OptionalClauseCategory,
				segments: parsed.segments,
				requiredPlaceholders: requiredPlaceholdersOf(parsed.segments),
			}),
		);
	}

	// The precomputed list must describe the segments it was built from. A
	// mismatch would mean a template is judged eligible on the wrong evidence,
	// so it fails the set rather than being repaired.
	for (const compiled of [...coreTemplates, ...optionalClauses]) {
		const recomputed = requiredPlaceholdersOf(compiled.segments);
		const same =
			recomputed.length === compiled.requiredPlaceholders.length &&
			recomputed.every(
				(placeholder, position) =>
					compiled.requiredPlaceholders[position] === placeholder,
			);
		if (!same) {
			issues.push({
				code: "required-placeholder-mismatch",
				id: compiled.id,
			});
		}
	}

	if (issues.length > 0) {
		return { ok: false, issues: Object.freeze(issues) };
	}
	return {
		ok: true,
		set: Object.freeze({
			version,
			coreTemplates: Object.freeze(coreTemplates),
			optionalClauses: Object.freeze(optionalClauses),
		}),
	};
}

/** Renders one issue as a single line for a build or test failure. */
export function describeTemplateIssue(issue: TemplateIssue): string {
	return issue.detail === undefined
		? `${issue.code} (${issue.id})`
		: `${issue.code} (${issue.id}: ${issue.detail})`;
}
