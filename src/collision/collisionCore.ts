/**
 * `PRE-RELEASE-COLLISION-CORE1`: the pure Collision generation core.
 *
 * One function turns a frozen `CollisionLexemePool`, a compiled Pattern
 * Schema 2 set, a draw mode, a recipe request, a result count and a private
 * generation nonce into generation drafts. It is not connected to a batch
 * controller, a Modal, a Toolbar, Copy or Collect, and it has no seam through
 * which it could be.
 *
 * The contract is as much about what it refuses to do:
 *
 *   - It never reads a Source, tokenizes, rebuilds a Snapshot, reads Markdown
 *     at runtime, touches the DOM, settings, the Clipboard, the Vault or the
 *     network, and it never issues a nonce from `crypto`. The nonce arrives as
 *     a plain uint32, so the core cannot consume another module's PRNG stream
 *     and the Body and Fake Dictionary streams stay untouched.
 *   - It mints no `batchId`, `rowId`, `rowSlotId` or `generationRevision`, and
 *     produces no Collect metadata. Identity and atomic lifecycle belong to
 *     `PRE-RELEASE-COLLISION-BATCH1`.
 *   - The nonce is not a public Seed. It never reaches a result, a diagnostic,
 *     a log, settings or a reproducibility promise.
 *   - Output is plain text. Nothing here renders or interprets Markdown or
 *     HTML, and a fixed literal is resolved by its literal ID rather than
 *     inlined.
 *   - Inputs are read, never mutated, and the published draft is deeply
 *     frozen. A malformed or provenance-mismatched input is refused whole; no
 *     partial batch is published, and a refusal carries a fixed code with no
 *     path, note text, surface, reading or exception message.
 *
 * Five weight systems meet here and none of them is multiplied into another:
 * Vocabulary Uniform / Frequency selects a base lexeme, recipe weight selects
 * a recipe under Random, presence weight selects which optional Modifier slots
 * are present, Connector weight selects a Connector, and the modifier-form and
 * noun-suffix weights select which finished Modifier form to use. See
 * `Docs/pre_release_collision_core1_record.md` §6.
 */

import { freezeAnalysis, type VocabularyOrigin } from "../analysis/rubyVocabulary";
import { createSeededRandom, UINT32_MAX } from "../random/seededRandom";
import type { VocabularyDrawMode } from "../vocabulary/vocabularySnapshot";
import { drawWeight, sourceWeightLookup, type SourceWeightLookup } from "../vocabulary/sourceWeights";
import {
	compileCollisionPatternSet,
	type CompiledCollisionPatternSet,
	type CompiledCollisionRecipe,
} from "./compilePatternSet";
import {
	type CollisionLexemePool,
	type CollisionModifierCandidate,
	type CollisionNounCandidate,
	type CollisionPredicateCandidate,
} from "./collisionLexemePool";
import { inspectCollisionLexemePool } from "./collisionVocabulary";
import {
	COLLISION_MODIFIER_CANDIDATE_PROFILES,
	COLLISION_MODIFIER_FORMS,
	COLLISION_PREDICATE_CANDIDATE_PROFILES,
	type CollisionModifierCandidateProfile,
	type CollisionPredicateCandidateProfile,
} from "./patternData";

/**
 * The Collision algorithm version, introduced by this slice.
 *
 * It identifies Collision generation meaning only. Body algorithm 9, Fake
 * Dictionary algorithm 1, template version 1, settings schema 3, Collect
 * metadata 2, the collection document version and Pattern schema / data
 * version 2 are separate identifiers and are unchanged.
 */
export const COLLISION_ALGORITHM_VERSION = 1;

/**
 * Attempts allowed for one accepted result.
 *
 * An attempt is one complete draw: recipe, presence, connectors, modifier
 * forms and lexemes. Termination does not depend on the pool: the work for one
 * requested result is bounded by this number, and generation stops as soon as
 * a result cannot be accepted within it.
 */
export const COLLISION_RESULT_ATTEMPT_LIMIT = 12;

/**
 * Of those attempts, how many also refuse a third consecutive identical
 * structure signature.
 *
 * The two rules have different strengths on purpose. An exact duplicate is
 * refused for every attempt, because padding a count with duplicates is what
 * Policy 3 §5 forbids. A signature run is a preference: when the pool admits
 * no other structure, every attempt produces the same signature, so after this
 * many tries the result is accepted rather than looping.
 */
export const COLLISION_SIGNATURE_ATTEMPT_LIMIT = 6;

/** How many identical consecutive signatures are refused while attempts remain. */
export const COLLISION_SIGNATURE_RUN_LIMIT = 3;

/** Upper bound on one request. The UI's 10 / 20 / 50 sit well inside it. */
export const COLLISION_MAX_REQUESTED_COUNT = 200;

/** Random draws a viable recipe; fixed refuses rather than falling back. */
export type CollisionRecipeRequest =
	| { readonly kind: "random" }
	| { readonly kind: "fixed"; readonly recipeId: string };

/**
 * Results a later batch slice wants this generation to differ from.
 *
 * `texts` are exact texts to refuse. `recentSignatures` are the structure
 * signatures immediately preceding this generation, oldest first, so a row
 * regenerated in place continues the run suppression of its neighbours. Both
 * are read-only inputs and neither is mutated or published.
 */
export type CollisionAvoidContext = {
	readonly texts: readonly string[];
	readonly recentSignatures: readonly string[];
};

/** Why one accepted result is weaker than a full draw. */
export type CollisionLimitedReason = "noun-repeated";

/** Why a generation produced fewer results than requested. Fixed codes only. */
export type CollisionShortfallReason =
	| "no-noun"
	| "no-viable-recipe"
	| "recipe-unknown"
	| "recipe-disabled"
	| "recipe-not-viable"
	| "duplicate-exhausted";

/**
 * Why an input was refused. These name the input class and nothing else: no
 * path, note text, surface, reading, field value or exception message.
 */
export type CollisionGenerationRejection =
	| "invalid-pattern-set"
	| "invalid-pool"
	| "provenance-mismatch"
	| "invalid-request";

/**
 * COLLISION-LOCK1: one part of a result, in the recipe's order. A row's text is
 * these `text`s joined, always; the parts it was built from stay so that a later
 * regeneration can keep some of them. A modifier slot the row does not have, in
 * a recipe where it is optional, has no segment. An empty Connector is a segment
 * with an empty `text`, because which Connector was drawn is what must be kept.
 */
export type CollisionSegment =
	| { readonly kind: "noun" | "predicate" | "literal"; readonly slotId: string; readonly text: string }
	| { readonly kind: "modifier"; readonly slotId: string; readonly text: string; readonly formId: string }
	| { readonly kind: "connector"; readonly slotId: string; readonly text: string; readonly connectorId: string };

/** The kinds of segment a writer may keep (lock) when a row is regenerated. */
export const COLLISION_LOCKABLE_SEGMENT_KINDS: readonly ("noun" | "modifier" | "predicate")[] = Object.freeze(["noun", "modifier", "predicate"] as const);

/** One generation draft. Identity and lifecycle are added by BATCH1. */
export type CollisionResultDraft = {
	/** The recipe actually used, which under Random is the drawn one. */
	readonly recipeId: string;
	readonly text: string;
	/** COLLISION-LOCK1: the parts `text` was joined from. */
	readonly segments: readonly CollisionSegment[];
	readonly structureSignature: string;
	readonly limited: boolean;
	readonly limitedReason: CollisionLimitedReason | null;
};

export type CollisionGenerationStatus = "complete" | "partial" | "insufficient";

export type CollisionGenerationDraft = {
	readonly algorithmVersion: typeof COLLISION_ALGORITHM_VERSION;
	readonly requestedCount: number;
	readonly generatedCount: number;
	readonly status: CollisionGenerationStatus;
	readonly shortfallReason: CollisionShortfallReason | null;
	readonly results: readonly CollisionResultDraft[];
};

export type CollisionGenerationResult =
	| { readonly ok: true; readonly draft: CollisionGenerationDraft }
	| { readonly ok: false; readonly reason: CollisionGenerationRejection };

// --- refusal plumbing ------------------------------------------------------

class RejectionError extends Error {
	readonly reason: CollisionGenerationRejection;

	constructor(reason: CollisionGenerationRejection) {
		super("collision-core");
		this.name = "CollisionGenerationRejection";
		this.reason = reason;
	}
}

function reject(reason: CollisionGenerationRejection): never {
	throw new RejectionError(reason);
}

/**
 * `Array.isArray` widens a `readonly T[]` to `any[]`; this keeps the declared
 * element type while still proving the value is an array.
 */
function isList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function isPositiveWeight(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Totals a weight list, refusing overflow and any non-finite contribution. */
function totalWeight<T>(
	items: readonly T[],
	weightOf: (item: T) => number,
	onInvalid: CollisionGenerationRejection,
): number {
	let total = 0;
	for (const item of items) {
		const weight = weightOf(item);
		if (!isPositiveWeight(weight)) {
			return reject(onInvalid);
		}
		total += weight;
		if (!Number.isSafeInteger(total) || total <= 0) {
			return reject(onInvalid);
		}
	}
	return total;
}

/**
 * One weighted draw. The caller has already proved the list is non-empty and
 * every weight is a positive safe integer.
 */
function pickWeighted<T>(
	items: readonly T[],
	weightOf: (item: T) => number,
	total: number,
	random: { next(): number },
): T {
	let draw = random.next() * total;
	for (const item of items) {
		draw -= weightOf(item);
		if (draw < 0) {
			return item;
		}
	}
	// Only reachable through floating-point rounding at the very top of the range.
	return items[items.length - 1]!;
}

// --- validated inputs ------------------------------------------------------

/** A finished Modifier form: a schema modifier form or a noun suffix. */
type ModifierFormEntry = {
	readonly formId: string;
	readonly weight: number;
};

/** One candidate reachable through one form, with that form's own provenance. */
type ModifierChoice = {
	readonly candidate: CollisionModifierCandidate;
	/**
	 * The Vocabulary frequency of just the records that reach this surface
	 * through this form. Using the candidate's aggregate would let provenance
	 * from another form's records steer this form's draw.
	 */
	readonly formFrequency: number;
	/** The origins of the same records, read only for Source weights (0.1.0 S3). */
	readonly formOrigins: readonly (readonly VocabularyOrigin[])[];
};

type PreparedPatternSet = {
	readonly set: CompiledCollisionPatternSet;
	readonly literals: ReadonlyMap<string, string>;
	readonly recipeById: ReadonlyMap<string, CompiledCollisionRecipe>;
	readonly connectorTotal: number;
	readonly allModifierForms: readonly ModifierFormEntry[];
	readonly sahenBasicForms: readonly ModifierFormEntry[];
};

type PreparedPool = {
	readonly pool: CollisionLexemePool;
	readonly nouns: readonly CollisionNounCandidate[];
	/** Per profile: form id -> the candidates reachable through that form. */
	readonly modifiersByForm: ReadonlyMap<
		CollisionModifierCandidateProfile,
		ReadonlyMap<string, readonly ModifierChoice[]>
	>;
	readonly predicates: ReadonlyMap<
		CollisionPredicateCandidateProfile,
		readonly CollisionPredicateCandidate[]
	>;
};

const SAHEN_BASIC_FORM = COLLISION_MODIFIER_FORMS.find(
	(entry) => entry.class === "sahen" && entry.variant === "basic",
)!;

/**
 * Structural deep frozen-ness, cycle safe.
 *
 * This is a shape utility, not a semantic rule: the meaning of a pattern set is
 * decided by the compiler below, and the meaning of a pool by the lexeme
 * module's own validator.
 */
function deeplyFrozen(value: unknown, seen: WeakSet<object>): boolean {
	if (value === null || typeof value !== "object") {
		return true;
	}
	if (seen.has(value)) {
		return true;
	}
	seen.add(value);
	if (!Object.isFrozen(value)) {
		return false;
	}
	return Object.values(value).every((child) => deeplyFrozen(child, seen));
}

/** Key-order-independent value identity, for comparing two compiled sets. */
function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalValue);
	}
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, canonicalValue(record[key])]),
		);
	}
	return value;
}

/**
 * Re-validates the compiled pattern set this core was handed, through the
 * compiler that defines what a valid one is.
 *
 * A core must not depend on having been called correctly, and it must not
 * answer "is this a legal pattern set?" with a second, weaker opinion. So the
 * set is compiled again by `compileCollisionPatternSet()` — the same function
 * the build-time generator and the Markdown parser share — and accepted only
 * when recompiling reproduces it exactly. That gets every semantic rule the
 * schema has (ID grammar and global ID uniqueness, label rules and duplicate
 * selectable labels, the closed literal grammar for literals, Connectors and
 * noun suffixes, per-recipe and per-kind part limits, duplicate Connector
 * literals, the single empty Connector, canonical presence sets and every
 * other check) without restating any of it here.
 *
 * Deep frozen-ness is checked separately, because value equality cannot see a
 * mutable nested array, and it is never the proof of origin on its own.
 */
function preparePatternSet(set: CompiledCollisionPatternSet): PreparedPatternSet {
	if (
		set === null ||
		typeof set !== "object" ||
		!isList(set.recipes) ||
		!isList(set.literals) ||
		!isList(set.connectors) ||
		!isList(set.modifierForms) ||
		!isList(set.nounSuffixes) ||
		!deeplyFrozen(set, new WeakSet<object>())
	) {
		return reject("invalid-pattern-set");
	}

	let recompiled;
	try {
		recompiled = compileCollisionPatternSet({
			schemaVersion: set.schemaVersion,
			dataVersion: set.dataVersion,
			recipes: set.recipes,
			literals: set.literals,
			connectors: set.connectors,
			modifierForms: set.modifierForms,
			nounSuffixes: set.nounSuffixes,
		});
	} catch {
		// A malformed set can make the compiler throw; that is a refusal.
		return reject("invalid-pattern-set");
	}
	if (
		!recompiled.ok ||
		JSON.stringify(canonicalValue(set)) !==
			JSON.stringify(canonicalValue(recompiled.set))
	) {
		return reject("invalid-pattern-set");
	}

	// Everything below is indexing, not validation: the compiler has spoken.
	const literals = new Map<string, string>();
	for (const literal of set.literals) {
		literals.set(literal.id, literal.literal);
	}

	// One id space, as the compiler mints it, so a signature's form id is
	// unambiguous between a modifier form and a noun suffix.
	const allModifierForms: ModifierFormEntry[] = [];
	let sahenBasic: ModifierFormEntry | null = null;
	for (const form of set.modifierForms) {
		const entry = { formId: form.id, weight: form.weight };
		allModifierForms.push(entry);
		if (
			form.class === SAHEN_BASIC_FORM.class &&
			form.variant === SAHEN_BASIC_FORM.variant
		) {
			sahenBasic = entry;
		}
	}
	if (sahenBasic === null) {
		return reject("invalid-pattern-set");
	}
	for (const suffix of set.nounSuffixes) {
		allModifierForms.push({ formId: suffix.id, weight: suffix.weight });
	}

	const recipeById = new Map<string, CompiledCollisionRecipe>();
	for (const recipe of set.recipes) {
		recipeById.set(recipe.id, recipe);
	}

	return {
		set,
		literals,
		recipeById,
		connectorTotal: totalWeight(
			set.connectors,
			(connector) => connector.weight,
			"invalid-pattern-set",
		),
		allModifierForms,
		sahenBasicForms: [sahenBasic],
	};
}

/**
 * Validates the pool through the lexeme module's own contract, then indexes it.
 *
 * `inspectCollisionLexemePool()` is the single statement of what a pool is, and
 * the builder's output is pinned against the same function. CORE1 therefore
 * cannot accept a deeply frozen forgery that the builder could never have
 * produced: identity, safe surfaces, canonical ordering, variant minting,
 * aggregate derivation and the profile projections are all re-derived there.
 */
/**
 * Whether the pool says it was built from a different pattern set.
 *
 * The pool validator binds every form id and literal to the set it is given, so
 * a mismatch would be refused there anyway. Naming it first, and identically
 * for every public entry point, keeps "this pool is not for this pattern set"
 * distinct from "this is not a pool". A provenance that is malformed rather
 * than merely different falls through to the validator, which owns that answer.
 */
function patternProvenanceDiffers(
	pool: CollisionLexemePool,
	set: CompiledCollisionPatternSet,
): boolean {
	const declared = (pool as Partial<CollisionLexemePool> | null)?.provenance;
	return (
		declared !== null &&
		declared !== undefined &&
		typeof declared === "object" &&
		typeof declared.patternSchemaVersion === "number" &&
		typeof declared.patternDataVersion === "number" &&
		(declared.patternSchemaVersion !== set.schemaVersion ||
			declared.patternDataVersion !== set.dataVersion)
	);
}

function preparePool(
	pool: CollisionLexemePool,
	patternSet: CompiledCollisionPatternSet,
): PreparedPool {
	if (inspectCollisionLexemePool(pool, patternSet) !== null) {
		return reject("invalid-pool");
	}

	// Everything below is indexing, not validation.
	const modifiersByForm = new Map<
		CollisionModifierCandidateProfile,
		ReadonlyMap<string, readonly ModifierChoice[]>
	>();
	for (const profile of COLLISION_MODIFIER_CANDIDATE_PROFILES) {
		const byForm = new Map<string, ModifierChoice[]>();
		for (const candidate of pool.modifiersByProfile[profile]) {
			// One record contributes to one form once; the pool's own dedupe
			// guarantees a display form appears at most once per (surface, form).
			const perForm = new Map<string, number>();
			const perFormOrigins = new Map<string, (readonly VocabularyOrigin[])[]>();
			for (const variant of candidate.variants) {
				const total = (perForm.get(variant.formId) ?? 0) + variant.base.frequency;
				if (!Number.isSafeInteger(total) || total <= 0) {
					return reject("invalid-pool");
				}
				perForm.set(variant.formId, total);
				perFormOrigins.set(variant.formId, [...(perFormOrigins.get(variant.formId) ?? []), variant.base.origins]);
			}
			for (const [formId, formFrequency] of perForm) {
				const list = byForm.get(formId) ?? [];
				list.push({ candidate, formFrequency, formOrigins: perFormOrigins.get(formId)! });
				byForm.set(formId, list);
			}
		}
		modifiersByForm.set(profile, byForm);
	}

	const predicates = new Map<
		CollisionPredicateCandidateProfile,
		readonly CollisionPredicateCandidate[]
	>();
	for (const profile of COLLISION_PREDICATE_CANDIDATE_PROFILES) {
		predicates.set(profile, pool.predicatesByProfile[profile]);
	}

	return { pool, nouns: pool.nouns, modifiersByForm, predicates };
}

/**
 * Which finished Modifier forms a candidate profile may draw.
 *
 * `all` admits every schema modifier form and every noun suffix. `sahen-basic`
 * admits only the sahen basic form: a candidate qualifies for that profile
 * because it has a sahen basic variant, so drawing any other form for the slot
 * would make the profile incidental. The switch is exhaustive, so adding a
 * profile to Pattern Schema 2 is a compile error here rather than a silent
 * widening.
 */
function admissibleForms(
	profile: CollisionModifierCandidateProfile,
	pattern: PreparedPatternSet,
): readonly ModifierFormEntry[] {
	switch (profile) {
		case "all":
			return pattern.allModifierForms;
		case "sahen-basic":
			return pattern.sahenBasicForms;
	}
}

/** The admissible forms that actually have a candidate in this pool. */
function eligibleForms(
	profile: CollisionModifierCandidateProfile,
	pattern: PreparedPatternSet,
	prepared: PreparedPool,
): readonly ModifierFormEntry[] {
	const byForm = prepared.modifiersByForm.get(profile);
	if (!byForm) {
		return reject("invalid-pool");
	}
	return admissibleForms(profile, pattern).filter((form) => {
		const choices = byForm.get(form.formId);
		return choices !== undefined && choices.length > 0;
	});
}

// --- viability -------------------------------------------------------------

type ViableRecipe = {
	readonly recipe: CompiledCollisionRecipe;
	/** Presence entries every slot of which has candidates. Empty when no optional slot exists. */
	readonly presence: readonly { readonly slots: readonly string[]; readonly weight: number }[];
};

/**
 * Whether this recipe can actually be generated from this pool.
 *
 * Nothing falls back to another profile, class or recipe: a recipe that cannot
 * be built is simply not viable, and the caller reports that rather than
 * quietly producing something else.
 */
function viability(
	recipe: CompiledCollisionRecipe,
	pattern: PreparedPatternSet,
	prepared: PreparedPool,
): ViableRecipe | null {
	if (!recipe.enabled || prepared.nouns.length === 0) {
		return null;
	}

	const optionalProfiles = new Map<string, CollisionModifierCandidateProfile>();
	for (const part of recipe.parts) {
		if (part.kind === "modifier") {
			if (part.optional) {
				optionalProfiles.set(part.slotId, part.profile);
				continue;
			}
			// A required Modifier slot whose profile has no candidate is fatal.
			if (eligibleForms(part.profile, pattern, prepared).length === 0) {
				return null;
			}
			continue;
		}
		if (part.kind === "predicate") {
			const candidates = prepared.predicates.get(part.profile);
			if (!candidates || candidates.length === 0) {
				return null;
			}
		}
	}

	if (optionalProfiles.size === 0) {
		return { recipe, presence: [] };
	}

	// A presence entry that wants a slot with no candidate is out of the draw.
	// The recipe stays viable as long as one entry survives — which is how an
	// optional Modifier is omitted when the Modifier pool is empty.
	const presence = recipe.presence.filter((entry) =>
		entry.slots.every((slot) => {
			const profile = optionalProfiles.get(slot);
			return (
				profile !== undefined &&
				eligibleForms(profile, pattern, prepared).length > 0
			);
		}),
	);
	return presence.length === 0 ? null : { recipe, presence };
}

// --- composition -----------------------------------------------------------

type Attempt = {
	readonly recipeId: string;
	readonly text: string;
	readonly segments: readonly CollisionSegment[];
	readonly structureSignature: string;
	readonly limited: boolean;
	readonly limitedReason: CollisionLimitedReason | null;
};

type DrawContext = {
	readonly pattern: PreparedPatternSet;
	readonly prepared: PreparedPool;
	readonly drawMode: VocabularyDrawMode;
	/** 0.1.0 S3: the pool's Source weights, or `null` for the unweighted draw. */
	readonly weights: SourceWeightLookup;
	readonly random: { next(): number };
};

/** Without Source weights, exactly the unweighted rule: 1 for Uniform, frequency for Frequency. */
function lexemeWeight(
	context: DrawContext,
	frequency: number,
	origins: readonly VocabularyOrigin[] | (() => Iterable<VocabularyOrigin>),
): number {
	return drawWeight(context.drawMode, context.weights, frequency, origins);
}

function drawNoun(
	context: DrawContext,
	used: Set<string>,
): { readonly surface: string; readonly repeated: boolean } {
	// Distinct surfaces are used up before any repetition inside one row.
	const remaining = context.prepared.nouns.filter(
		(noun) => !used.has(noun.surface),
	);
	const repeated = remaining.length === 0;
	const choices = repeated ? context.prepared.nouns : remaining;
	const weightOf = (noun: CollisionNounCandidate): number =>
		lexemeWeight(context, noun.frequency, noun.origins);
	const total = totalWeight(choices, weightOf, "invalid-pool");
	const picked = pickWeighted(choices, weightOf, total, context.random);
	used.add(picked.surface);
	return { surface: picked.surface, repeated };
}

function drawModifier(
	context: DrawContext,
	profile: CollisionModifierCandidateProfile,
): { readonly surface: string; readonly formId: string } {
	// Structure first: which finished form, by the pattern set's own weights.
	const forms = eligibleForms(profile, context.pattern, context.prepared);
	if (forms.length === 0) {
		return reject("invalid-pool");
	}
	const formTotal = totalWeight(
		forms,
		(form) => form.weight,
		"invalid-pattern-set",
	);
	const form = pickWeighted(forms, (entry) => entry.weight, formTotal, context.random);

	// Vocabulary second, over only the records that reach the surface through
	// that form. The two weight systems meet here and are never multiplied.
	const choices = context.prepared.modifiersByForm.get(profile)?.get(form.formId);
	if (!choices || choices.length === 0) {
		return reject("invalid-pool");
	}
	const weightOf = (choice: ModifierChoice): number =>
		lexemeWeight(context, choice.formFrequency, () => choice.formOrigins.flat());
	const total = totalWeight(choices, weightOf, "invalid-pool");
	const picked = pickWeighted(choices, weightOf, total, context.random);
	return { surface: picked.candidate.surface, formId: form.formId };
}

function drawPredicate(
	context: DrawContext,
	profile: CollisionPredicateCandidateProfile,
): string {
	const choices = context.prepared.predicates.get(profile);
	if (!choices || choices.length === 0) {
		return reject("invalid-pool");
	}
	const weightOf = (candidate: CollisionPredicateCandidate): number =>
		lexemeWeight(context, candidate.frequency, candidate.origins);
	const total = totalWeight(choices, weightOf, "invalid-pool");
	return pickWeighted(choices, weightOf, total, context.random).surface;
}

/**
 * Builds one result from one recipe.
 *
 * Parts are concatenated in declared order and the output is plain text: it is
 * never parsed, rendered or escaped as Markdown or HTML.
 */
function compose(viable: ViableRecipe, context: DrawContext): Attempt {
	const recipe = viable.recipe;

	let present: readonly string[] = [];
	if (viable.presence.length > 0) {
		const total = totalWeight(
			viable.presence,
			(entry) => entry.weight,
			"invalid-pattern-set",
		);
		present = pickWeighted(
			viable.presence,
			(entry) => entry.weight,
			total,
			context.random,
		).slots;
	}
	const presentSlots = new Set(present);

	const usedNouns = new Set<string>();
	const presenceSignature: string[] = [];
	const connectorSignature: string[] = [];
	const formSignature: string[] = [];
	const segments: CollisionSegment[] = [];
	let repeatedNoun = false;

	for (const part of recipe.parts) {
		switch (part.kind) {
			case "noun": {
				const drawn = drawNoun(context, usedNouns);
				segments.push({ kind: "noun", slotId: part.slotId, text: drawn.surface });
				repeatedNoun = repeatedNoun || drawn.repeated;
				break;
			}
			case "modifier": {
				if (part.optional && !presentSlots.has(part.slotId)) {
					break;
				}
				if (part.optional) {
					presenceSignature.push(part.slotId);
				}
				const drawn = drawModifier(context, part.profile);
				segments.push({ kind: "modifier", slotId: part.slotId, text: drawn.surface, formId: drawn.formId });
				formSignature.push(drawn.formId);
				break;
			}
			case "connector": {
				const connector = pickWeighted(
					context.pattern.set.connectors,
					(entry) => entry.weight,
					context.pattern.connectorTotal,
					context.random,
				);
				// An empty Connector contributes nothing but is a real choice.
				segments.push({ kind: "connector", slotId: part.slotId, text: connector.literal ?? "", connectorId: connector.id });
				connectorSignature.push(connector.id);
				break;
			}
			case "predicate":
				segments.push({ kind: "predicate", slotId: part.slotId, text: drawPredicate(context, part.profile) });
				break;
			case "literal": {
				const literal = context.pattern.literals.get(part.literalId);
				if (literal === undefined) {
					return reject("invalid-pattern-set");
				}
				segments.push({ kind: "literal", slotId: part.slotId, text: literal });
				break;
			}
		}
	}

	return finishAttempt(recipe, segments, presenceSignature, connectorSignature, formSignature, repeatedNoun);
}

/**
 * The one place an attempt is closed: the text is the segments joined, and the
 * signature is structure only. Surfaces and candidate identity are deliberately
 * absent from it: it describes the shape a result was built with, so run
 * suppression cannot be defeated by drawing different words into the same
 * shape. Fixed literals and part kinds follow from the recipe id.
 */
function finishAttempt(
	recipe: CompiledCollisionRecipe,
	segments: readonly CollisionSegment[],
	presenceSignature: readonly string[],
	connectorSignature: readonly string[],
	formSignature: readonly string[],
	repeatedNoun: boolean,
): Attempt {
	return {
		recipeId: recipe.id,
		text: segments.map((segment) => segment.text).join(""),
		segments,
		structureSignature: JSON.stringify([
			recipe.id,
			presenceSignature,
			connectorSignature,
			formSignature,
		]),
		limited: repeatedNoun,
		limitedReason: repeatedNoun ? "noun-repeated" : null,
	};
}

// --- generation ------------------------------------------------------------

function refusal(
	requestedCount: number,
	reason: CollisionShortfallReason,
): CollisionGenerationResult {
	return {
		ok: true,
		draft: freezeAnalysis<CollisionGenerationDraft>({
			algorithmVersion: COLLISION_ALGORITHM_VERSION,
			requestedCount,
			generatedCount: 0,
			status: "insufficient",
			shortfallReason: reason,
			results: [],
		}),
	};
}

function validateScalars(input: {
	readonly count: number;
	readonly nonce: number;
	readonly drawMode: VocabularyDrawMode;
}): void {
	if (
		!Number.isSafeInteger(input.count) ||
		input.count < 1 ||
		input.count > COLLISION_MAX_REQUESTED_COUNT ||
		!Number.isInteger(input.nonce) ||
		input.nonce < 0 ||
		input.nonce > UINT32_MAX ||
		(input.drawMode !== "uniform" && input.drawMode !== "frequency")
	) {
		return reject("invalid-request");
	}
}

function validateRequest(input: {
	readonly count: number;
	readonly nonce: number;
	readonly drawMode: VocabularyDrawMode;
	readonly request: CollisionRecipeRequest;
	readonly avoid?: CollisionAvoidContext | undefined;
}): void {
	validateScalars(input);
	const request = input.request;
	if (request === null || typeof request !== "object") {
		return reject("invalid-request");
	}
	if (request.kind === "fixed") {
		if (typeof request.recipeId !== "string" || request.recipeId.length === 0) {
			return reject("invalid-request");
		}
	} else if (request.kind !== "random") {
		return reject("invalid-request");
	}
	const avoid = input.avoid;
	if (avoid === undefined) {
		return;
	}
	if (
		avoid === null ||
		typeof avoid !== "object" ||
		!isList(avoid.texts) ||
		!isList(avoid.recentSignatures) ||
		avoid.texts.some((text) => typeof text !== "string") ||
		avoid.recentSignatures.some((entry) => typeof entry !== "string")
	) {
		return reject("invalid-request");
	}
}

type OpenedGeneration = {
	readonly pattern: PreparedPatternSet;
	readonly prepared: PreparedPool;
};

/**
 * The checks every generation starts with, shared by Random / fixed generation
 * and the regeneration that keeps a row's words: the pattern set, the pool and
 * what the pool says it was built from. Each refusal is thrown as a fixed code.
 */
function openGeneration(input: {
	readonly pool: CollisionLexemePool;
	readonly patternSet: CompiledCollisionPatternSet;
	readonly drawMode: VocabularyDrawMode;
}): OpenedGeneration {
	const pattern = preparePatternSet(input.patternSet);

	if (patternProvenanceDiffers(input.pool, pattern.set)) {
		return reject("provenance-mismatch");
	}

	const prepared = preparePool(input.pool, pattern.set);

	// The draw mode is a request input, so only the caller can disagree here.
	const provenance = prepared.pool.provenance;
	if (
		provenance.patternSchemaVersion !== pattern.set.schemaVersion ||
		provenance.patternDataVersion !== pattern.set.dataVersion ||
		provenance.drawMode !== input.drawMode
	) {
		return reject("provenance-mismatch");
	}
	return { pattern, prepared };
}

function drawContext(opened: OpenedGeneration, drawMode: VocabularyDrawMode, nonce: number): DrawContext {
	const provenance = opened.prepared.pool.provenance;
	return {
		pattern: opened.pattern,
		prepared: opened.prepared,
		drawMode,
		weights: sourceWeightLookup({ sources: provenance.sources, sourceWeights: opened.prepared.pool.sourceWeights }),
		random: createSeededRandom(nonce),
	};
}

/**
 * Generates Collision drafts.
 *
 * Deterministic: the same pool, pattern set, draw mode, request, count, nonce
 * and avoid context produce the same drafts. The nonce seeds a Collision-only
 * PRNG created here, so no other module's stream is consumed or advanced.
 */
export function generateCollisionResults(input: {
	readonly pool: CollisionLexemePool;
	readonly patternSet: CompiledCollisionPatternSet;
	readonly drawMode: VocabularyDrawMode;
	readonly request: CollisionRecipeRequest;
	readonly count: number;
	readonly nonce: number;
	readonly avoid?: CollisionAvoidContext;
}): CollisionGenerationResult {
	try {
		validateRequest(input);
		const opened = openGeneration(input);
		const { pattern, prepared } = opened;

		const requestedCount = input.count;
		if (prepared.nouns.length === 0) {
			return refusal(requestedCount, "no-noun");
		}

		// Viability is decided once per generation: the pool is frozen for the
		// whole call, so a recipe cannot become viable partway through.
		const viable: ViableRecipe[] = [];
		for (const recipe of pattern.set.recipes) {
			const checked = viability(recipe, pattern, prepared);
			if (checked) {
				viable.push(checked);
			}
		}

		let pick: (random: { next(): number }) => ViableRecipe;
		if (input.request.kind === "fixed") {
			const recipeId = input.request.recipeId;
			const declared = pattern.recipeById.get(recipeId);
			if (!declared) {
				return refusal(requestedCount, "recipe-unknown");
			}
			if (!declared.enabled) {
				return refusal(requestedCount, "recipe-disabled");
			}
			const chosen = viable.find((entry) => entry.recipe.id === recipeId);
			if (!chosen) {
				// A fixed recipe never falls back to another recipe.
				return refusal(requestedCount, "recipe-not-viable");
			}
			pick = () => chosen;
		} else {
			if (viable.length === 0) {
				return refusal(requestedCount, "no-viable-recipe");
			}
			// Random renormalizes recipe weight over the viable set only.
			// `selectable: false` stays eligible here; it only hides a recipe
			// from a later row selector.
			const total = totalWeight(
				viable,
				(entry) => entry.recipe.weight,
				"invalid-pattern-set",
			);
			pick = (random) =>
				pickWeighted(viable, (entry) => entry.recipe.weight, total, random);
		}

		const context = drawContext(opened, input.drawMode, input.nonce);
		const random = context.random;

		const avoidTexts = new Set(input.avoid?.texts ?? []);
		const signatureRun = [...(input.avoid?.recentSignatures ?? [])];
		const results: CollisionResultDraft[] = [];
		let shortfallReason: CollisionShortfallReason | null = null;

		for (let index = 0; index < requestedCount; index += 1) {
			let accepted: Attempt | null = null;
			// The best candidate seen that is not a duplicate but would extend a
			// structure run. Remembering it is what keeps the two rules from
			// competing: the structure preference never throws away an otherwise
			// valid result, and it never consumes the duplicate budget.
			let runExtending: Attempt | null = null;
			for (
				let attempt = 0;
				attempt < COLLISION_RESULT_ATTEMPT_LIMIT && accepted === null;
				attempt += 1
			) {
				const candidate = compose(pick(random), context);
				// An exact duplicate is refused on every attempt: a count is never
				// padded with repeats.
				if (avoidTexts.has(candidate.text)) {
					continue;
				}
				// A third consecutive identical structure is preferred against
				// while signature attempts remain. When the pool admits no other
				// structure, every attempt lands here and the remembered candidate
				// is used instead of looping or losing the result.
				if (
					attempt < COLLISION_SIGNATURE_ATTEMPT_LIMIT &&
					signatureRun.length >= COLLISION_SIGNATURE_RUN_LIMIT - 1 &&
					signatureRun
						.slice(-(COLLISION_SIGNATURE_RUN_LIMIT - 1))
						.every((entry) => entry === candidate.structureSignature)
				) {
					runExtending = runExtending ?? candidate;
					continue;
				}
				accepted = candidate;
			}

			accepted = accepted ?? runExtending;
			if (accepted === null) {
				// Every attempt produced a text that already exists. The count is
				// reported short rather than padded.
				shortfallReason = "duplicate-exhausted";
				break;
			}
			avoidTexts.add(accepted.text);
			signatureRun.push(accepted.structureSignature);
			results.push({
				recipeId: accepted.recipeId,
				text: accepted.text,
				segments: accepted.segments,
				structureSignature: accepted.structureSignature,
				limited: accepted.limited,
				limitedReason: accepted.limitedReason,
			});
		}

		const generatedCount = results.length;
		const status: CollisionGenerationStatus =
			generatedCount === 0
				? "insufficient"
				: generatedCount === requestedCount
					? "complete"
					: "partial";
		return {
			ok: true,
			draft: freezeAnalysis<CollisionGenerationDraft>({
				algorithmVersion: COLLISION_ALGORITHM_VERSION,
				requestedCount,
				generatedCount,
				status,
				shortfallReason: status === "complete" ? null : shortfallReason,
				results,
			}),
		};
	} catch (error) {
		if (error instanceof RejectionError) {
			return { ok: false, reason: error.reason };
		}
		// Nothing else is expected, and an exception message is never surfaced.
		return { ok: false, reason: "invalid-pool" };
	}
}

// --- COLLISION-LOCK1: regenerate a row and keep some of its words -----------

/** The row to regenerate: its recipe and the segments it was built from. */
export type CollisionLockedRow = {
	readonly recipeId: string;
	readonly segments: readonly CollisionSegment[];
};

type LockPlan = {
	readonly recipe: CompiledCollisionRecipe;
	/** The row's own segment for every part it has, by slot. */
	readonly bySlot: ReadonlyMap<string, CollisionSegment>;
	/** The slots whose words are kept. */
	readonly locked: ReadonlySet<string>;
};

const LOCKABLE_KINDS: ReadonlySet<string> = new Set(COLLISION_LOCKABLE_SEGMENT_KINDS);

/**
 * Reads one segment of an untrusted row into a fresh value of the shape this
 * module writes, or refuses. Nothing else of the object is kept.
 */
function readSegment(value: unknown): CollisionSegment {
	if (value === null || typeof value !== "object") {
		return reject("invalid-request");
	}
	const raw = value as Record<string, unknown>;
	const kind = raw.kind;
	const slotId = raw.slotId;
	const text = raw.text;
	if (typeof slotId !== "string" || slotId.length === 0 || typeof text !== "string") {
		return reject("invalid-request");
	}
	if (kind === "noun" || kind === "predicate" || kind === "literal") {
		return { kind, slotId, text };
	}
	if (kind === "modifier" && typeof raw.formId === "string") {
		return { kind, slotId, text, formId: raw.formId };
	}
	if (kind === "connector" && typeof raw.connectorId === "string") {
		return { kind, slotId, text, connectorId: raw.connectorId };
	}
	return reject("invalid-request");
}

/**
 * The row is as untrusted as every other input of this core. It is accepted
 * only when it is a row this pattern set and this pool could have produced:
 * its recipe is a usable recipe of the set; its segments are the recipe's parts
 * in order (an optional modifier may be absent, and the ones present are one
 * of the recipe's presence entries); its literals and Connectors are the set's
 * own; and every word that is kept is a candidate of this pool for that part.
 * The words that are not kept are never read for their value, because they are
 * drawn again. Every refusal is the fixed `invalid-request`.
 */
function planLock(
	input: { readonly original: CollisionLockedRow; readonly locked: readonly string[] },
	pattern: PreparedPatternSet,
	prepared: PreparedPool,
): LockPlan {
	let recipeId: unknown;
	let rawSegments: unknown;
	let rawLocked: unknown[] | null = null;
	const segments: CollisionSegment[] = [];
	try {
		const original = input.original as unknown;
		if (original === null || typeof original !== "object") {
			return reject("invalid-request");
		}
		recipeId = (original as { recipeId?: unknown }).recipeId;
		rawSegments = (original as { segments?: unknown }).segments;
		// The names are read once, here, into a list of our own: a list that throws when read is a bad request.
		const lockedInput = input.locked as unknown;
		if (isList(lockedInput)) {
			rawLocked = [];
			for (const name of lockedInput) {
				rawLocked.push(name);
			}
		}
		if (isList(rawSegments)) {
			for (const raw of rawSegments) {
				segments.push(readSegment(raw));
			}
		}
	} catch (error) {
		if (error instanceof RejectionError) {
			throw error;
		}
		return reject("invalid-request");
	}
	if (typeof recipeId !== "string" || !isList(rawSegments) || rawLocked === null) {
		return reject("invalid-request");
	}
	const recipe = pattern.recipeById.get(recipeId);
	if (recipe === undefined || !recipe.enabled) {
		return reject("invalid-request");
	}

	// The segments are the recipe's parts, in order.
	const bySlot = new Map<string, CollisionSegment>();
	const present = new Set<string>();
	let cursor = 0;
	for (const part of recipe.parts) {
		const next = segments[cursor];
		if (part.kind === "modifier" && part.optional && !(next?.kind === "modifier" && next.slotId === part.slotId)) {
			continue;
		}
		if (next === undefined || next.kind !== part.kind || next.slotId !== part.slotId) {
			return reject("invalid-request");
		}
		cursor += 1;
		bySlot.set(part.slotId, next);
		if (part.kind === "modifier" && part.optional) {
			present.add(part.slotId);
		}
		if (part.kind === "literal" && next.text !== pattern.literals.get(part.literalId)) {
			return reject("invalid-request");
		}
		if (part.kind === "connector") {
			const declared = next.kind === "connector"
				? pattern.set.connectors.find((entry) => entry.id === next.connectorId)
				: undefined;
			if (declared === undefined || next.text !== (declared.literal ?? "")) {
				return reject("invalid-request");
			}
		}
	}
	if (cursor !== segments.length) {
		return reject("invalid-request");
	}
	// Which optional modifiers are present must be a combination the recipe can draw.
	if (
		recipe.parts.some((part) => part.kind === "modifier" && part.optional) &&
		!recipe.presence.some((entry) => entry.slots.length === present.size && entry.slots.every((slot) => present.has(slot)))
	) {
		return reject("invalid-request");
	}

	// The words to keep: parts the row has, of a kind that can be kept, named once.
	const locked = new Set<string>();
	for (const name of rawLocked) {
		if (typeof name !== "string" || locked.has(name) || !bySlot.has(name)) {
			return reject("invalid-request");
		}
		locked.add(name);
	}
	const lockable = recipe.parts.filter((part) => LOCKABLE_KINDS.has(part.kind) && bySlot.has(part.slotId));
	// Nothing to keep is a different operation, and everything kept leaves nothing to draw.
	if (locked.size === 0 || locked.size >= lockable.length) {
		return reject("invalid-request");
	}
	for (const part of recipe.parts) {
		if (!locked.has(part.slotId)) {
			continue;
		}
		const kept = bySlot.get(part.slotId)!;
		if (!LOCKABLE_KINDS.has(part.kind)) {
			return reject("invalid-request");
		}
		// A kept word has to be one this pool offers for that part: a row built
		// from another Vocabulary, or by hand, cannot put its words into a result.
		let offered = false;
		if (part.kind === "noun") {
			offered = prepared.nouns.some((candidate) => candidate.surface === kept.text);
		} else if (part.kind === "modifier" && kept.kind === "modifier") {
			offered = admissibleForms(part.profile, pattern).some((form) => form.formId === kept.formId) &&
				(prepared.modifiersByForm.get(part.profile)?.get(kept.formId) ?? []).some((choice) => choice.candidate.surface === kept.text);
		} else if (part.kind === "predicate") {
			offered = (prepared.predicates.get(part.profile) ?? []).some((candidate) => candidate.surface === kept.text);
		}
		if (!offered) {
			return reject("invalid-request");
		}
	}
	return { recipe, bySlot, locked };
}

/** A fresh copy of a kept segment, so a result never shares an object with the row it came from. */
function copySegment(segment: CollisionSegment): CollisionSegment {
	switch (segment.kind) {
		case "modifier":
			return { kind: "modifier", slotId: segment.slotId, text: segment.text, formId: segment.formId };
		case "connector":
			return { kind: "connector", slotId: segment.slotId, text: segment.text, connectorId: segment.connectorId };
		default:
			return { kind: segment.kind, slotId: segment.slotId, text: segment.text };
	}
}

/**
 * One attempt of the regeneration that keeps a row's words: the row's recipe,
 * the modifiers it has and the Connectors it drew stay as they are; the words
 * that are kept stay as they are; every other noun, modifier and predicate is
 * drawn again by the same functions a Random generation draws with. The nouns
 * that are kept are counted as used before any other noun is drawn, so the new
 * nouns avoid them first.
 */
function composeLocked(plan: LockPlan, context: DrawContext): Attempt {
	const { recipe } = plan;
	const usedNouns = new Set<string>();
	for (const part of recipe.parts) {
		const kept = plan.bySlot.get(part.slotId);
		if (part.kind === "noun" && plan.locked.has(part.slotId) && kept !== undefined) {
			usedNouns.add(kept.text);
		}
	}
	const presenceSignature: string[] = [];
	const connectorSignature: string[] = [];
	const formSignature: string[] = [];
	const segments: CollisionSegment[] = [];

	for (const part of recipe.parts) {
		const original = plan.bySlot.get(part.slotId);
		if (original === undefined) {
			// An optional modifier the row does not have stays absent.
			continue;
		}
		const keep = plan.locked.has(part.slotId);
		switch (part.kind) {
			case "noun":
				segments.push(keep ? copySegment(original) : { kind: "noun", slotId: part.slotId, text: drawNoun(context, usedNouns).surface });
				break;
			case "modifier": {
				if (part.optional) {
					presenceSignature.push(part.slotId);
				}
				if (keep && original.kind === "modifier") {
					segments.push(copySegment(original));
					formSignature.push(original.formId);
					break;
				}
				const drawn = drawModifier(context, part.profile);
				segments.push({ kind: "modifier", slotId: part.slotId, text: drawn.surface, formId: drawn.formId });
				formSignature.push(drawn.formId);
				break;
			}
			case "connector":
				segments.push(copySegment(original));
				if (original.kind === "connector") {
					connectorSignature.push(original.connectorId);
				}
				break;
			case "predicate":
				segments.push(keep ? copySegment(original) : { kind: "predicate", slotId: part.slotId, text: drawPredicate(context, part.profile) });
				break;
			case "literal":
				segments.push(copySegment(original));
				break;
		}
	}
	const nouns = segments.filter((segment) => segment.kind === "noun").map((segment) => segment.text);
	return finishAttempt(recipe, segments, presenceSignature, connectorSignature, formSignature, new Set(nouns).size !== nouns.length);
}

/**
 * The texts a regeneration must not repeat, read once into a set of our own. No list at all is an empty set;
 * anything that is not a list of strings, or that throws when it is read, is null (a bad request).
 */
function readAvoidTexts(input: { readonly avoid?: { readonly texts: readonly string[] } }): Set<string> | null {
	try {
		const avoid = input.avoid;
		if (avoid === undefined) {
			return new Set();
		}
		if (avoid === null || typeof avoid !== "object") {
			return null;
		}
		const texts = avoid.texts as unknown;
		if (!isList(texts)) {
			return null;
		}
		const set = new Set<string>();
		for (const text of texts) {
			if (typeof text !== "string") {
				return null;
			}
			set.add(text);
		}
		return set;
	} catch {
		return null;
	}
}

/**
 * COLLISION-LOCK1: regenerates one row and keeps some of its words.
 *
 * The row is a result this core made (its recipe and its segments) and the
 * names are the slots whose words stay. The result has the row's recipe, the
 * modifiers the row has and the Connectors it drew; the kept words are copied
 * and every other noun, modifier and predicate is drawn again. The signature
 * run preference is not used, because keeping the shape is the point. A text in
 * `avoid` (the other rows', and the row's own) is never accepted; when the
 * attempts end on such texts the result is the same `duplicate-exhausted`
 * shortfall as for any other row.
 *
 * Deterministic for the same inputs. A generation that keeps nothing, keeps
 * everything, names a part the row does not have, or comes with a row this
 * pool and pattern set could not have produced is refused as `invalid-request`.
 */
export function generateLockedCollisionResult(input: {
	readonly pool: CollisionLexemePool;
	readonly patternSet: CompiledCollisionPatternSet;
	readonly drawMode: VocabularyDrawMode;
	readonly nonce: number;
	readonly original: CollisionLockedRow;
	readonly locked: readonly string[];
	readonly avoid?: { readonly texts: readonly string[] };
}): CollisionGenerationResult {
	try {
		validateScalars({ count: 1, nonce: input.nonce, drawMode: input.drawMode });
		const avoidTexts = readAvoidTexts(input);
		if (avoidTexts === null) {
			return { ok: false, reason: "invalid-request" };
		}
		const opened = openGeneration(input);
		const plan = planLock(input, opened.pattern, opened.prepared);
		if (opened.prepared.nouns.length === 0) {
			return refusal(1, "no-noun");
		}
		if (viability(plan.recipe, opened.pattern, opened.prepared) === null) {
			return refusal(1, "recipe-not-viable");
		}

		const context = drawContext(opened, input.drawMode, input.nonce);
		let accepted: Attempt | null = null;
		for (let attempt = 0; attempt < COLLISION_RESULT_ATTEMPT_LIMIT && accepted === null; attempt += 1) {
			const candidate = composeLocked(plan, context);
			if (!avoidTexts.has(candidate.text)) {
				accepted = candidate;
			}
		}
		if (accepted === null) {
			return refusal(1, "duplicate-exhausted");
		}
		return {
			ok: true,
			draft: freezeAnalysis<CollisionGenerationDraft>({
				algorithmVersion: COLLISION_ALGORITHM_VERSION,
				requestedCount: 1,
				generatedCount: 1,
				status: "complete",
				shortfallReason: null,
				results: [{
					recipeId: accepted.recipeId,
					text: accepted.text,
					segments: accepted.segments,
					structureSignature: accepted.structureSignature,
					limited: accepted.limited,
					limitedReason: accepted.limitedReason,
				}],
			}),
		};
	} catch (error) {
		if (error instanceof RejectionError) {
			return { ok: false, reason: error.reason };
		}
		// Nothing else is expected, and an exception message is never surfaced.
		return { ok: false, reason: "invalid-pool" };
	}
}

/**
 * The recipes that can be generated from this pool right now.
 *
 * A later row selector needs the viable set without generating anything; this
 * exposes it without a second copy of the viability rules. `selectable` is
 * reported rather than applied, because hiding a recipe from a selector is a
 * presentation decision.
 */
export function viableCollisionRecipes(input: {
	readonly pool: CollisionLexemePool;
	readonly patternSet: CompiledCollisionPatternSet;
}):
	| {
			readonly ok: true;
			readonly recipes: readonly {
				readonly recipeId: string;
				readonly selectable: boolean;
			}[];
	  }
	| { readonly ok: false; readonly reason: CollisionGenerationRejection } {
	try {
		const pattern = preparePatternSet(input.patternSet);
		if (patternProvenanceDiffers(input.pool, pattern.set)) {
			return { ok: false, reason: "provenance-mismatch" };
		}
		const prepared = preparePool(input.pool, pattern.set);
		const recipes: { recipeId: string; selectable: boolean }[] = [];
		for (const recipe of pattern.set.recipes) {
			if (viability(recipe, pattern, prepared)) {
				recipes.push({ recipeId: recipe.id, selectable: recipe.selectable });
			}
		}
		return freezeAnalysis({ ok: true as const, recipes });
	} catch (error) {
		if (error instanceof RejectionError) {
			return { ok: false, reason: error.reason };
		}
		return { ok: false, reason: "invalid-pool" };
	}
}
