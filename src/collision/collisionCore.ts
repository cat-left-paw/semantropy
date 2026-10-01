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

/** One generation draft. Identity and lifecycle are added by BATCH1. */
export type CollisionResultDraft = {
	/** The recipe actually used, which under Random is the drawn one. */
	readonly recipeId: string;
	readonly text: string;
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
	let text = "";
	let repeatedNoun = false;

	for (const part of recipe.parts) {
		switch (part.kind) {
			case "noun": {
				const drawn = drawNoun(context, usedNouns);
				text += drawn.surface;
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
				text += drawn.surface;
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
				text += connector.literal ?? "";
				connectorSignature.push(connector.id);
				break;
			}
			case "predicate":
				text += drawPredicate(context, part.profile);
				break;
			case "literal": {
				const literal = context.pattern.literals.get(part.literalId);
				if (literal === undefined) {
					return reject("invalid-pattern-set");
				}
				text += literal;
				break;
			}
		}
	}

	return {
		recipeId: recipe.id,
		text,
		// Structure only. Surfaces and candidate identity are deliberately
		// absent: the signature describes the shape a result was built with, so
		// run suppression cannot be defeated by drawing different words into the
		// same shape. Fixed literals and part kinds follow from the recipe id.
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

function validateRequest(input: {
	readonly count: number;
	readonly nonce: number;
	readonly drawMode: VocabularyDrawMode;
	readonly request: CollisionRecipeRequest;
	readonly avoid?: CollisionAvoidContext | undefined;
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
		const pattern = preparePatternSet(input.patternSet);

		if (patternProvenanceDiffers(input.pool, pattern.set)) {
			return { ok: false, reason: "provenance-mismatch" };
		}

		const prepared = preparePool(input.pool, pattern.set);

		// The draw mode is a request input, so only the caller can disagree here.
		const provenance = prepared.pool.provenance;
		if (
			provenance.patternSchemaVersion !== pattern.set.schemaVersion ||
			provenance.patternDataVersion !== pattern.set.dataVersion ||
			provenance.drawMode !== input.drawMode
		) {
			return { ok: false, reason: "provenance-mismatch" };
		}

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

		const random = createSeededRandom(input.nonce);
		const context: DrawContext = {
			pattern,
			prepared,
			drawMode: input.drawMode,
			weights: sourceWeightLookup({ sources: provenance.sources, sourceWeights: prepared.pool.sourceWeights }),
			random,
		};

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
