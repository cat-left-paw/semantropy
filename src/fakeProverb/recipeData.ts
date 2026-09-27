/**
 * The hand-written schema of the standard Fake Proverb recipe set
 * (Recipe Schema 1).
 *
 * The entries themselves are not here. They live in
 * `resources/fake-proverb/standard-recipes.md`, which a human edits, and reach
 * later slices as `./generated/standardFakeProverbRecipeEntries`, which a build
 * derives from that document and refuses to leave stale. What stays here is
 * what the document is checked against: the closed recipe roles, part kinds,
 * slot kinds, candidate forms, limits, and the shape a raw entry has.
 *
 * This schema is Fake Proverb's own. It shares no version, id space, generated
 * module or lock with Collision or Fake Dictionary, and nothing here may import
 * the generated entries: the generator loads this file to validate them, so the
 * dependency runs one way only.
 */

export const FAKE_PROVERB_RECIPE_SCHEMA_VERSION = 1;

/**
 * Entry IDs (proverb, gloss, literal, profile) share one id space. Slot IDs are
 * recipe-local. Both are lowercase kebab-case; neither is ever shown to a user.
 */
export const FAKE_PROVERB_ID_MAX_LENGTH = 48;
export const FAKE_PROVERB_SLOT_ID_MAX_LENGTH = 16;

/**
 * Allowed fixed-literal grammar.
 *
 * A literal body is a finished Japanese surface: Hiragana, Katakana, Han, the
 * prolonged-sound mark `ー`, and the ideographic comma `、` and full stop `。`.
 * It must already be NFC, at most `FAKE_PROVERB_LITERAL_MAX_CODE_POINTS` long,
 * and contain no whitespace, Cc / Cf / Cs / Zl / Zp code point, ASCII,
 * Markdown delimiter, placeholder, JavaScript or regular-expression notation.
 * The canonical serializer alone adds `**`, a blank line and `> `; a literal
 * never carries Markdown.
 */
export const FAKE_PROVERB_LITERAL_MAX_CODE_POINTS = 24;

export const FAKE_PROVERB_RECIPE_ROLES = ["proverb", "gloss"] as const;
export type FakeProverbRecipeRole = (typeof FAKE_PROVERB_RECIPE_ROLES)[number];

/** Slot kinds: what a typed binding can hold. */
export const FAKE_PROVERB_SLOT_KINDS = ["noun", "modifier", "predicate"] as const;
export type FakeProverbSlotKind = (typeof FAKE_PROVERB_SLOT_KINDS)[number];

/** Every part kind. `reference` is gloss-only; `literal` names a fixed literal. */
export const FAKE_PROVERB_PART_KINDS = [...FAKE_PROVERB_SLOT_KINDS, "literal", "reference"] as const;
export type FakeProverbPartKind = (typeof FAKE_PROVERB_PART_KINDS)[number];

/**
 * The closed candidate forms a profile may allow, per slot kind.
 *
 * A form names candidate scope and one finished surface shape; it is not an
 * inflection rule. `independent-noun` is an observed safe independent noun.
 * `adjective-basic` and `verb-basic` are the realizer's basic forms,
 * `verb-past` its た/だ stem plus the matching ending, and `verb-negative` its
 * irrealis-negation stem plus ない. Lexeme safety and realization remain
 * TypeScript responsibilities of a later slice; adding a form here is a schema
 * change, never a Markdown edit.
 */
export const FAKE_PROVERB_CANDIDATE_FORMS = {
	noun: ["independent-noun"],
	modifier: ["adjective-basic", "verb-basic", "verb-past", "verb-negative"],
	predicate: ["adjective-basic", "verb-basic", "verb-negative"],
} as const satisfies Readonly<Record<FakeProverbSlotKind, readonly string[]>>;
export type FakeProverbCandidateForm =
	(typeof FAKE_PROVERB_CANDIDATE_FORMS)[FakeProverbSlotKind][number];

/** Upper bounds the compiler enforces. Exceeding one is a compile error, never a truncation. */
export const FAKE_PROVERB_LIMITS = {
	proverbs: 64,
	glosses: 64,
	literals: 128,
	profiles: 16,
	parts: { proverb: 10, gloss: 14 },
	slots: {
		proverb: { noun: 4, modifier: 2, predicate: 1 },
		gloss: { noun: 3, modifier: 2, predicate: 2 },
	},
	exports: 4,
	requires: 4,
	references: 6,
} as const;

/**
 * One part of a proverb or gloss, as raw document data.
 *
 * Deliberately untrusted strings; only the compiler narrows the closed
 * vocabulary. A slot part (`noun` / `modifier` / `predicate`) carries
 * `slotId`, `profileId` and `exported`; a `literal` part carries `literalId`;
 * a `reference` part carries `slotKind` and `slotId`. Any other field is
 * refused.
 */
export type RawFakeProverbPart = {
	readonly kind: string;
	readonly slotId?: string;
	readonly profileId?: string;
	readonly exported?: boolean;
	readonly literalId?: string;
	readonly slotKind?: string;
};

export type RawFakeProverbRequirement = {
	readonly kind: string;
	readonly slotId: string;
};

export type RawFakeProverbRecipe = {
	readonly id: string;
	readonly enabled: boolean;
	readonly weight: number;
	readonly parts: readonly RawFakeProverbPart[];
};

export type RawFakeProverbGloss = {
	readonly id: string;
	readonly enabled: boolean;
	readonly weight: number;
	readonly requires: readonly RawFakeProverbRequirement[];
	readonly parts: readonly RawFakeProverbPart[];
};

export type RawFakeProverbLiteral = {
	readonly id: string;
	readonly literal: string;
};

export type RawFakeProverbProfileForm = {
	readonly form: string;
	readonly weight: number;
};

export type RawFakeProverbProfile = {
	readonly id: string;
	readonly kind: string;
	readonly forms: readonly RawFakeProverbProfileForm[];
};
