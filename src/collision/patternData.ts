/**
 * The hand-written schema of the standard Collision pattern set.
 *
 * The entries themselves are not here. They live in
 * `resources/collision/standard-patterns.md`, which a human edits, and reach
 * later runtime slices as `./generated/standardCollisionPatternEntries`, which
 * a build derives from that document and refuses to leave stale. What stays
 * here is what the document is checked against: the closed part kinds,
 * candidate profiles, connector forms, modifier class/variant pairs, and the shape a
 * raw entry has.
 *
 * Nothing in this module may import the generated entries: the generator loads
 * this file to validate them, so the dependency runs one way only.
 */

export const COLLISION_PATTERN_SCHEMA_VERSION = 2;

/** Unicode code-point cap for a Connector or noun-suffix literal. */
export const COLLISION_LITERAL_MAX_CODE_POINTS = 32;

/**
 * Allowed Connector and noun-suffix grammar.
 *
 * A body is a finished Japanese surface: one or more characters from Hiragana,
 * Katakana, or Han, plus the prolonged-sound mark `ー` (Script=Common). It must
 * already be NFC, at most `COLLISION_LITERAL_MAX_CODE_POINTS` long, and must
 * not contain Unicode general categories Cc / Cf / Cs / Zl / Zp, leading or
 * trailing whitespace, placeholders, ASCII, JavaScript, or regular-expression
 * notation. The compiler and the Markdown parser both enforce this; neither
 * silently strips or rewrites a body.
 */

export const COLLISION_LABEL_MAX_CODE_POINTS = 40;
export const COLLISION_RECIPE_MAX_PARTS = 12;
export const COLLISION_PART_LIMITS = { noun: 4, modifier: 3, connector: 2, predicate: 1 } as const;
export const COLLISION_PART_KINDS = ["noun", "modifier", "connector", "predicate", "literal"] as const;
export type CollisionPartKind = (typeof COLLISION_PART_KINDS)[number];

/** Candidate scope only. Lexeme safety and inflection remain TypeScript responsibilities. */
export const COLLISION_MODIFIER_CANDIDATE_PROFILES = ["all", "sahen-basic"] as const;
export type CollisionModifierCandidateProfile = (typeof COLLISION_MODIFIER_CANDIDATE_PROFILES)[number];
/** Verified regular independent verbs, basic form only; never sahen or irregular predicates. */
export const COLLISION_PREDICATE_CANDIDATE_PROFILES = ["regular-verb-basic"] as const;
export type CollisionPredicateCandidateProfile = (typeof COLLISION_PREDICATE_CANDIDATE_PROFILES)[number];

export const COLLISION_CONNECTOR_FORMS = ["empty", "literal"] as const;

export type CollisionConnectorForm = (typeof COLLISION_CONNECTOR_FORMS)[number];

export const COLLISION_MODIFIER_CLASSES = [
	"i-adjective",
	"na-adjective",
	"verb",
	"sahen",
] as const;

export type CollisionModifierClass = (typeof COLLISION_MODIFIER_CLASSES)[number];

/**
 * The closed modifier-form allowlist. Sahen passive and free-form conjugation
 * rules are intentionally absent: adding them is a TypeScript change, not a
 * Markdown edit.
 */
export const COLLISION_MODIFIER_FORMS = [
	{ class: "i-adjective", variant: "basic" },
	{ class: "na-adjective", variant: "na" },
	{ class: "verb", variant: "basic" },
	{ class: "verb", variant: "past" },
	{ class: "verb", variant: "progressive" },
	{ class: "verb", variant: "negative" },
	{ class: "sahen", variant: "basic" },
	{ class: "sahen", variant: "past" },
	{ class: "sahen", variant: "progressive" },
	{ class: "sahen", variant: "negative" },
] as const;

export type CollisionModifierFormPair = (typeof COLLISION_MODIFIER_FORMS)[number];
export type CollisionModifierVariant = CollisionModifierFormPair["variant"];

export type RawCollisionRecipe = {
	readonly id: string;
	readonly label: string;
	readonly enabled: boolean;
	readonly selectable: boolean;
	readonly weight: number;
	readonly parts: readonly RawCollisionPart[];
	readonly presence: readonly RawCollisionPresence[];
};

/** Deliberately untrusted strings; only the compiler narrows the closed vocabulary. */
export type RawCollisionPart = {
	readonly kind: string;
	readonly slotId: string;
	readonly optional: boolean;
	readonly profile?: string;
	readonly literalId?: string;
};

export type RawCollisionPresence = {
	readonly slots: readonly string[];
	readonly weight: number;
};

export type RawCollisionLiteral = {
	readonly id: string;
	readonly literal: string;
};

export type RawCollisionConnector = {
	readonly id: string;
	readonly form: string;
	readonly weight: number;
	readonly literal: string | null;
};

export type RawCollisionModifierForm = {
	readonly id: string;
	readonly class: string;
	readonly variant: string;
	readonly weight: number;
};

export type RawCollisionNounSuffix = {
	readonly id: string;
	readonly weight: number;
	readonly literal: string;
};
