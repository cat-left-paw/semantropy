/**
 * The hand-written schema of the standard Fake Dictionary template set.
 *
 * The entries themselves are not here. They live in
 * `resources/fake-dictionary/standard-templates.md`, which a human edits, and
 * reach the runtime as `./generated/standardTemplateEntries`, which a build
 * derives from that document and refuses to leave stale. What stays here is
 * what the document is checked against: the families and categories an entry
 * may name, and the shape a raw entry has.
 *
 * Nothing in this module may import the generated entries: the generator loads
 * this file to validate them, so the dependency runs one way only.
 */

/** The 30 core template families, in document order. */
export const TEMPLATE_FAMILIES = [
	"classification",
	"instrument",
	"action",
	"state",
	"quality",
	"person",
	"place",
	"organism",
	"medical",
	"institution",
	"custom",
	"food",
	"academic",
	"theory",
	"etymology",
	"archaic",
	"dialect",
	"slang",
	"figurative",
	"idiom",
	"technical",
	"measure",
	"calendar",
	"ritual",
	"culture",
	"history",
	"causal",
	"method",
	"organization",
	"uncertain",
] as const;

export type TemplateFamily = (typeof TEMPLATE_FAMILIES)[number];

/** The 6 Optional Clause categories, in document order. */
export const OPTIONAL_CLAUSE_CATEGORIES = [
	"etymology",
	"history",
	"region",
	"usage",
	"alternative-theory",
	"authority",
] as const;

export type OptionalClauseCategory = (typeof OPTIONAL_CLAUSE_CATEGORIES)[number];

/** An uncompiled core template, exactly as written in the document. */
export type RawCoreTemplate = {
	readonly id: string;
	readonly family: string;
	readonly text: string;
};

/** An uncompiled Optional Clause, exactly as written in the document. */
export type RawOptionalClause = {
	readonly id: string;
	readonly category: string;
	readonly text: string;
};
