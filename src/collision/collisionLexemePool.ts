/**
 * `PRE-RELEASE-COLLISION-LEXEME1`: the transient Collision lexeme pool.
 *
 * One pure function turns an already-built Vocabulary Snapshot and one
 * validated, frozen slice of compiled Pattern Schema 2 data into finished
 * Noun, Modifier and Predicate candidates. It is not connected to a composer,
 * a batch, a Modal or production runtime, and it has no seam through which it
 * could be.
 *
 * What it does not do is as much of the contract as what it does:
 *
 *   - It never tokenizes. The Snapshot's own `projections.collision` and
 *     `projections.manual` are the only vocabulary inputs, so the Source text
 *     is analyzed exactly once, by whoever built the Snapshot.
 *   - It never reads a file, a resource, the network, the Clipboard or the
 *     Vault, and never writes settings, `data.json`, a Collection or a cache.
 *     A pool is a value the caller holds and drops.
 *   - It does not touch the Snapshot. The input is only read; the result owns
 *     every string, array and object it exposes and is deeply frozen.
 *   - It publishes all or nothing. A rejected build returns a fixed reason
 *     code and no pool; there is no partially built pool and no diagnostic
 *     carrying note text, a surface, a reading, a Vault path or an exception
 *     message.
 *
 * Weights are two separate systems and this slice mixes neither. Vocabulary
 * `frequency` is aggregated here because it is candidate provenance. The
 * Pattern Schema 2 modifier-form and noun-suffix weights are validated and
 * then left alone: they belong to the structural draw a later Core slice
 * performs, and multiplying them into a lexeme would silently fuse the two.
 */

import {
	freezeAnalysis,
	vocabularyCandidateId,
	vocabularyDisplayFormId,
	type VocabularyOrigin,
} from "../analysis/rubyVocabulary";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { isSourceWeight, type SourceWeight } from "../vocabulary/sourceWeights";
import {
	COLLISION_PROJECTION_POLICY_VERSION,
	MANUAL_PROJECTION_POLICY_VERSION,
	VOCABULARY_FINGERPRINT_VERSION,
	VOCABULARY_SNAPSHOT_POLICY_VERSION,
	type ManualVocabularyCandidate,
	type ProjectedVocabularySurface,
	type VocabularyCandidateReference,
	type VocabularyDrawMode,
	type VocabularySnapshot,
	type VocabularySourceIdentity,
} from "../vocabulary/vocabularySnapshot";
import {
	inspectCollisionLiteral,
	type CompiledCollisionPatternSet,
} from "./compilePatternSet";
import {
	COLLISION_MODIFIER_CANDIDATE_PROFILES,
	COLLISION_MODIFIER_FORMS,
	COLLISION_PATTERN_SCHEMA_VERSION,
	COLLISION_PREDICATE_CANDIDATE_PROFILES,
	type CollisionModifierCandidateProfile,
	type CollisionModifierVariant,
	type CollisionPredicateCandidateProfile,
} from "./patternData";
import {
	COLLISION_VERB_VARIANTS,
	inflectRegularVerb,
	isSafeCollisionSurface,
	regularAdjectiveBasicForm,
} from "./regularInflection";

export const COLLISION_LEXEME_POOL_POLICY_VERSION = "collision-lexeme-1";

/**
 * Lexeme-level Modifier classes.
 *
 * The first four are Pattern Schema 2's `COLLISION_MODIFIER_CLASSES`. The
 * fifth is not a schema class: a noun-derived Modifier is a Noun surface plus
 * one Markdown-authored `nounSuffixes` literal, so it is identified by that
 * suffix entry rather than by a class / variant pair.
 */
export const COLLISION_LEXEME_MODIFIER_CLASSES = Object.freeze([
	"i-adjective",
	"na-adjective",
	"verb",
	"sahen",
	"noun-suffix",
] as const);

export type CollisionLexemeModifierClass =
	(typeof COLLISION_LEXEME_MODIFIER_CLASSES)[number];

/** `"suffix"` marks a noun-derived Modifier, which has no schema variant. */
export type CollisionLexemeModifierFormVariant = CollisionModifierVariant | "suffix";

/**
 * The narrow, typed seam to Pattern Schema 2.
 *
 * The builder takes the compiled fields it actually needs and nothing else. It
 * never reads `resources/collision/standard-patterns.md`, never compiles
 * Markdown, and never imports the generated entries: connecting a particular
 * pattern set is the caller's decision, so this module cannot become a
 * production entry point by accident. The noun-suffix literals are taken from
 * here rather than duplicated into TypeScript, and the data is re-validated on
 * entry so a hand-built object is refused rather than trusted.
 */
export type CollisionLexemePatternData = Pick<
	CompiledCollisionPatternSet,
	"schemaVersion" | "dataVersion" | "modifierForms" | "nounSuffixes"
>;

/** What the pool is bound to. A pool is meaningless apart from this. */
export type CollisionLexemeProvenance = {
	readonly snapshotPolicyVersion: string;
	readonly collisionProjectionPolicyVersion: string;
	readonly manualProjectionPolicyVersion: string;
	readonly vocabularyFingerprint: string;
	readonly drawMode: VocabularyDrawMode;
	readonly sources: readonly VocabularySourceIdentity[];
	readonly patternSchemaVersion: number;
	readonly patternDataVersion: number;
};

/** One Snapshot record a finished surface was built from. */
export type CollisionLexemeBase = {
	readonly candidateId: string;
	readonly displayFormId: string;
	readonly surface: string;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
};

/**
 * The Source record one inflected surface was produced from.
 *
 * The three concatenating classes need no such evidence: their finished surface
 * is the base record's own surface plus a literal the pattern set supplies, so
 * it is re-derivable from the pool and that data alone. A verb or イ-adjective
 * form is not — it comes from the token's base form, which no other field here
 * carries — so the token itself is kept.
 *
 * Keeping the token rather than just its conjugation type and base form is what
 * ties the evidence to the vocabulary. `vocabularyCandidateId()` is minted from
 * exactly these fields, so `inspectCollisionLexemePool()` re-mints it and
 * requires it to be the `candidateId` the base record claims. Evidence that
 * describes a different word than the record it is attached to therefore cannot
 * pass, however consistently the surfaces are rewritten around it.
 */
export type CollisionModifierVariantRecord = {
	readonly variantId: string;
	readonly modifierClass: CollisionLexemeModifierClass;
	/** A `modifierForms` id for a schema class, a `nounSuffixes` id otherwise. */
	readonly formId: string;
	readonly formVariant: CollisionLexemeModifierFormVariant;
	/** Present exactly for the `verb` and `i-adjective` classes. */
	readonly morphology: JapaneseToken | null;
	readonly base: CollisionLexemeBase;
};

export type CollisionPredicateVariantRecord = {
	readonly variantId: string;
	readonly predicateClass: "regular-verb";
	readonly formVariant: "basic";
	readonly morphology: JapaneseToken;
	readonly base: CollisionLexemeBase;
};

export type CollisionNounCandidate = {
	readonly surface: string;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
	readonly candidates: readonly VocabularyCandidateReference[];
};

export type CollisionModifierCandidate = {
	readonly surface: string;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
	readonly candidates: readonly VocabularyCandidateReference[];
	readonly classes: readonly CollisionLexemeModifierClass[];
	readonly variants: readonly CollisionModifierVariantRecord[];
	readonly profiles: readonly CollisionModifierCandidateProfile[];
};

export type CollisionPredicateCandidate = {
	readonly surface: string;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
	readonly candidates: readonly VocabularyCandidateReference[];
	readonly variants: readonly CollisionPredicateVariantRecord[];
	readonly profiles: readonly CollisionPredicateCandidateProfile[];
};

export type CollisionLexemePool = {
	readonly policyVersion: typeof COLLISION_LEXEME_POOL_POLICY_VERSION;
	readonly provenance: CollisionLexemeProvenance;
	readonly nouns: readonly CollisionNounCandidate[];
	readonly modifiers: readonly CollisionModifierCandidate[];
	readonly predicates: readonly CollisionPredicateCandidate[];
	/** Recipe-facing views. `all` is every Modifier; membership is never re-derived from a surface. */
	readonly modifiersByProfile: Readonly<
		Record<CollisionModifierCandidateProfile, readonly CollisionModifierCandidate[]>
	>;
	readonly predicatesByProfile: Readonly<
		Record<CollisionPredicateCandidateProfile, readonly CollisionPredicateCandidate[]>
	>;
	/**
	 * 0.1.0 S3: the Snapshot's Source weights, one per `provenance.sources`
	 * entry, present only when the Snapshot has them. Kept outside `provenance`,
	 * which Collect copies field by field.
	 */
	readonly sourceWeights?: readonly SourceWeight[];
};

/**
 * Fixed rejection codes. They name the input class that failed and nothing
 * else: no path, note text, surface, reading, field value or exception.
 */
export type CollisionLexemePoolRejection =
	| "invalid-pattern-data"
	| "invalid-snapshot"
	| "invalid-candidate"
	| "inconsistent-projection";

export type CollisionLexemePoolResult =
	| { readonly ok: true; readonly pool: CollisionLexemePool }
	| { readonly ok: false; readonly reason: CollisionLexemePoolRejection };

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `Array.isArray` widens a `readonly T[]` to `any[]`, which would then flow
 * untyped through every field check below. This predicate keeps the declared
 * element type while still proving the value really is an array.
 */
function isList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function isPositiveCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

class RejectionError extends Error {
	readonly reason: CollisionLexemePoolRejection;

	constructor(reason: CollisionLexemePoolRejection) {
		super("collision-lexeme-pool");
		this.name = "CollisionLexemePoolRejection";
		this.reason = reason;
	}
}

function reject(reason: CollisionLexemePoolRejection): never {
	throw new RejectionError(reason);
}

function addCount(left: number, right: number): number {
	const total = left + right;
	if (!Number.isSafeInteger(total) || total <= 0) {
		return reject("invalid-candidate");
	}
	return total;
}

function compareOrigin(a: VocabularyOrigin, b: VocabularyOrigin): number {
	return compare(a.path, b.path) || compare(a.contentHash, b.contentHash);
}

/** Sums counts per Source, exactly as the Snapshot's own projection does. */
function mergeOrigins(
	groups: readonly (readonly VocabularyOrigin[])[],
): VocabularyOrigin[] {
	const merged = new Map<string, VocabularyOrigin>();
	for (const group of groups) {
		for (const origin of group) {
			if (
				typeof origin.path !== "string" ||
				typeof origin.contentHash !== "string" ||
				!isPositiveCount(origin.count)
			) {
				return reject("invalid-candidate");
			}
			const key = JSON.stringify([origin.path, origin.contentHash]);
			const previous = merged.get(key);
			merged.set(key, {
				path: origin.path,
				contentHash: origin.contentHash,
				count: previous ? addCount(previous.count, origin.count) : origin.count,
			});
		}
	}
	return [...merged.values()].sort(compareOrigin);
}

function compareReference(
	a: VocabularyCandidateReference,
	b: VocabularyCandidateReference,
): number {
	return (
		compare(a.candidateId, b.candidateId) ||
		compare(a.displayFormId, b.displayFormId)
	);
}

// --- Pattern Schema 2 seam ------------------------------------------------

type PatternSeam = {
	readonly formIds: ReadonlyMap<string, string>;
	readonly nounSuffixes: readonly { readonly id: string; readonly literal: string }[];
	readonly dataVersion: number;
};

function formKey(modifierClass: string, variant: string): string {
	return `${modifierClass}\0${variant}`;
}

/**
 * Re-validates the compiled slice this builder was handed.
 *
 * The compiler already checked all of this, but a pool must not depend on
 * having been called correctly: an object literal, a mutated array or a set
 * from a different schema version is refused here rather than trusted. The
 * frozen check is what distinguishes compiled, published data from a
 * hand-built look-alike; the remaining checks stand on their own even when it
 * passes.
 */
function readPatternData(data: CollisionLexemePatternData): PatternSeam {
	if (
		data === null ||
		typeof data !== "object" ||
		data.schemaVersion !== COLLISION_PATTERN_SCHEMA_VERSION ||
		!isPositiveCount(data.dataVersion) ||
		!isList(data.modifierForms) ||
		!isList(data.nounSuffixes) ||
		!Object.isFrozen(data.modifierForms) ||
		!Object.isFrozen(data.nounSuffixes)
	) {
		return reject("invalid-pattern-data");
	}

	const formIds = new Map<string, string>();
	const ids = new Set<string>();
	for (const form of data.modifierForms) {
		if (
			form === null ||
			typeof form !== "object" ||
			!Object.isFrozen(form) ||
			typeof form.id !== "string" ||
			form.id.length === 0 ||
			ids.has(form.id) ||
			!isPositiveCount(form.weight)
		) {
			return reject("invalid-pattern-data");
		}
		const key = formKey(form.class, form.variant);
		if (
			!COLLISION_MODIFIER_FORMS.some(
				(allowed) => formKey(allowed.class, allowed.variant) === key,
			) ||
			formIds.has(key)
		) {
			return reject("invalid-pattern-data");
		}
		ids.add(form.id);
		formIds.set(key, form.id);
	}
	if (formIds.size !== COLLISION_MODIFIER_FORMS.length) {
		return reject("invalid-pattern-data");
	}

	const suffixes: { id: string; literal: string }[] = [];
	const literals = new Set<string>();
	for (const suffix of data.nounSuffixes) {
		if (
			suffix === null ||
			typeof suffix !== "object" ||
			!Object.isFrozen(suffix) ||
			typeof suffix.id !== "string" ||
			suffix.id.length === 0 ||
			ids.has(suffix.id) ||
			!isPositiveCount(suffix.weight) ||
			typeof suffix.literal !== "string" ||
			literals.has(suffix.literal) ||
			inspectCollisionLiteral(suffix.literal) !== null
		) {
			return reject("invalid-pattern-data");
		}
		ids.add(suffix.id);
		literals.add(suffix.literal);
		suffixes.push({ id: suffix.id, literal: suffix.literal });
	}
	if (suffixes.length === 0) {
		return reject("invalid-pattern-data");
	}

	return {
		formIds,
		nounSuffixes: suffixes,
		dataVersion: data.dataVersion,
	};
}

function modifierFormId(
	seam: PatternSeam,
	modifierClass: string,
	variant: string,
): string {
	const id = seam.formIds.get(formKey(modifierClass, variant));
	if (id === undefined) {
		return reject("invalid-pattern-data");
	}
	return id;
}

// --- Snapshot seam --------------------------------------------------------

function readSnapshot(
	snapshot: VocabularySnapshot,
): readonly ManualVocabularyCandidate[] {
	if (snapshot === null || typeof snapshot !== "object") {
		return reject("invalid-snapshot");
	}
	const projections = snapshot.projections;
	if (
		snapshot.policyVersion !== VOCABULARY_SNAPSHOT_POLICY_VERSION ||
		(snapshot.drawMode !== "uniform" && snapshot.drawMode !== "frequency") ||
		typeof snapshot.fingerprint !== "string" ||
		!snapshot.fingerprint.startsWith(`${VOCABULARY_FINGERPRINT_VERSION}:`) ||
		!isList(snapshot.sources) ||
		snapshot.sources.length === 0 ||
		projections === null ||
		typeof projections !== "object" ||
		projections.collision?.policyVersion !== COLLISION_PROJECTION_POLICY_VERSION ||
		projections.manual?.policyVersion !== MANUAL_PROJECTION_POLICY_VERSION ||
		!isList(projections.collision.nouns) ||
		!isList(projections.collision.sahenNouns) ||
		!isList(projections.manual.candidates)
	) {
		return reject("invalid-snapshot");
	}
	for (const source of snapshot.sources) {
		if (
			typeof source.path !== "string" ||
			source.path.length === 0 ||
			typeof source.contentHash !== "string" ||
			source.contentHash.length === 0 ||
			typeof source.projectionPolicy !== "string" ||
			source.projectionPolicy.length === 0
		) {
			return reject("invalid-snapshot");
		}
	}
	return projections.manual.candidates;
}

function baseOf(candidate: ManualVocabularyCandidate): CollisionLexemeBase {
	if (
		typeof candidate.candidateId !== "string" ||
		candidate.candidateId.length === 0 ||
		typeof candidate.displayFormId !== "string" ||
		candidate.displayFormId.length === 0 ||
		typeof candidate.surface !== "string" ||
		candidate.surface.length === 0 ||
		!isPositiveCount(candidate.frequency) ||
		!isList(candidate.origins) ||
		candidate.origins.length === 0
	) {
		return reject("invalid-candidate");
	}
	return {
		candidateId: candidate.candidateId,
		displayFormId: candidate.displayFormId,
		surface: candidate.surface,
		frequency: candidate.frequency,
		origins: mergeOrigins([candidate.origins]),
	};
}

// --- Canonical surface accumulation ---------------------------------------

type Contribution = {
	readonly variantId: string;
	readonly base: CollisionLexemeBase;
};

type Accumulator<V extends Contribution> = {
	readonly surface: string;
	/** Variant id -> record. Every contributing (candidate, form) pair is kept. */
	readonly variants: Map<string, V>;
	/**
	 * Display-form id -> the one contribution that record makes to this
	 * surface. Keyed so a candidate reaching the same surface through two forms
	 * contributes its frequency and origins once, while both forms stay visible
	 * in `variants`.
	 */
	readonly bases: Map<string, CollisionLexemeBase>;
};

function accumulate<V extends Contribution>(
	into: Map<string, Accumulator<V>>,
	surface: string,
	record: V,
): void {
	const existing = into.get(surface);
	const entry: Accumulator<V> = existing ?? {
		surface,
		variants: new Map<string, V>(),
		bases: new Map<string, CollisionLexemeBase>(),
	};
	if (entry.variants.has(record.variantId)) {
		return reject("invalid-candidate");
	}
	entry.variants.set(record.variantId, record);
	entry.bases.set(record.base.displayFormId, record.base);
	if (!existing) {
		into.set(surface, entry);
	}
}

function aggregate<V extends Contribution>(
	entry: Accumulator<V>,
): {
	surface: string;
	frequency: number;
	origins: VocabularyOrigin[];
	candidates: VocabularyCandidateReference[];
	variants: V[];
} {
	const bases = [...entry.bases.values()].sort((a, b) =>
		compare(a.displayFormId, b.displayFormId),
	);
	return {
		surface: entry.surface,
		frequency: bases.reduce((total, base) => addCount(total, base.frequency), 0),
		origins: mergeOrigins(bases.map((base) => base.origins)),
		candidates: bases
			.map((base) => ({
				candidateId: base.candidateId,
				displayFormId: base.displayFormId,
			}))
			.sort(compareReference),
		variants: [...entry.variants.values()].sort((a, b) =>
			compare(a.variantId, b.variantId),
		),
	};
}

function variantId(parts: readonly string[]): string {
	return JSON.stringify([COLLISION_LEXEME_POOL_POLICY_VERSION, ...parts]);
}

// --- Nouns ----------------------------------------------------------------

/** One Manual projection record that carries a Collision role. */
type ManualRecord = CollisionLexemeBase & { readonly role: "noun" | "sahen" };

type NounAccumulator = {
	readonly surface: string;
	readonly frequencies: number[];
	readonly origins: (readonly VocabularyOrigin[])[];
	readonly references: Map<string, VocabularyCandidateReference>;
};

function sameOrigins(
	left: readonly VocabularyOrigin[],
	right: readonly VocabularyOrigin[],
): boolean {
	return (
		left.length === right.length &&
		left.every((origin, index) => {
			const other = right[index]!;
			return (
				origin.path === other.path &&
				origin.contentHash === other.contentHash &&
				origin.count === other.count
			);
		})
	);
}

/**
 * Verifies one Collision projection list against the Manual projection and
 * merges it into the Noun accumulator.
 *
 * Surface equality is not enough. The Collision and Manual projections are two
 * views of the same records, and a Noun that disagreed with the Modifier built
 * from the same lemma would publish two provenances for one word. So every
 * reference is resolved to its Manual record and checked for
 *
 *   - existence, and a matching `candidateId` for that `displayFormId`,
 *   - the Collision role this list is supposed to hold,
 *   - the surface the projection filed it under,
 *   - no second appearance anywhere in either list, and
 *   - aggregates the projection cannot have invented: its `frequency` must be
 *     the sum of the referenced records' frequencies, and its `origins` must be
 *     exactly their merge.
 *
 * Whatever the projection claims that its own records do not support is
 * `inconsistent-projection`, and no pool is published.
 */
function verifyAndMergeNouns(
	projected: readonly ProjectedVocabularySurface[],
	role: "noun" | "sahen",
	records: ReadonlyMap<string, ManualRecord>,
	claimed: Map<string, "noun" | "sahen">,
	merged: Map<string, NounAccumulator>,
): void {
	for (const surface of projected) {
		if (
			surface === null ||
			typeof surface !== "object" ||
			typeof surface.surface !== "string" ||
			!isPositiveCount(surface.frequency) ||
			!isList(surface.origins) ||
			!isList(surface.candidates) ||
			surface.candidates.length === 0
		) {
			return reject("invalid-candidate");
		}

		const resolved: ManualRecord[] = [];
		for (const reference of surface.candidates) {
			if (
				reference === null ||
				typeof reference !== "object" ||
				typeof reference.candidateId !== "string" ||
				typeof reference.displayFormId !== "string"
			) {
				return reject("invalid-candidate");
			}
			const record = records.get(reference.displayFormId);
			if (
				!record ||
				record.candidateId !== reference.candidateId ||
				record.role !== role ||
				record.surface !== surface.surface ||
				claimed.has(reference.displayFormId)
			) {
				return reject("inconsistent-projection");
			}
			claimed.set(reference.displayFormId, role);
			resolved.push(record);
		}

		const expectedFrequency = resolved.reduce(
			(total, record) => addCount(total, record.frequency),
			0,
		);
		const expectedOrigins = mergeOrigins(resolved.map((record) => record.origins));
		if (
			surface.frequency !== expectedFrequency ||
			!sameOrigins(surface.origins, expectedOrigins)
		) {
			return reject("inconsistent-projection");
		}

		// Only now, with the entry proven, does it reach the Noun pool. An unsafe
		// surface is dropped here and by the Modifier loop alike, so the two stay
		// in step.
		if (!isSafeCollisionSurface(surface.surface)) {
			continue;
		}
		const entry: NounAccumulator = merged.get(surface.surface) ?? {
			surface: surface.surface,
			frequencies: [],
			origins: [],
			references: new Map<string, VocabularyCandidateReference>(),
		};
		entry.frequencies.push(surface.frequency);
		entry.origins.push(expectedOrigins);
		for (const record of resolved) {
			entry.references.set(record.displayFormId, {
				candidateId: record.candidateId,
				displayFormId: record.displayFormId,
			});
		}
		merged.set(surface.surface, entry);
	}
}

function finishNouns(
	merged: ReadonlyMap<string, NounAccumulator>,
): CollisionNounCandidate[] {
	return [...merged.values()]
		.sort((a, b) => compare(a.surface, b.surface))
		.map((entry) => ({
			surface: entry.surface,
			frequency: entry.frequencies.reduce(
				(total, value) => addCount(total, value),
				0,
			),
			origins: mergeOrigins(entry.origins),
			candidates: [...entry.references.values()].sort(compareReference),
		}));
}

// --- Build ----------------------------------------------------------------

/** サ変接続 Modifier tails. Sahen passive (`された`) is deliberately absent. */
const SAHEN_TAILS: readonly (readonly [CollisionModifierVariant, string])[] = [
	["basic", "する"],
	["past", "した"],
	["progressive", "している"],
	["negative", "しない"],
];

function isIndependent(
	candidate: ManualVocabularyCandidate,
	pos: string,
): boolean {
	const token = candidate.morphology;
	return (
		token !== null &&
		typeof token === "object" &&
		token.isUnknown !== true &&
		token.pos === pos &&
		token.detail1 === "自立"
	);
}

/**
 * Builds the pool. Pure: no I/O, no tokenization, no randomness, no clock, no
 * persistence, and no mutation of the Snapshot or the pattern data.
 */
export function buildCollisionLexemePool(input: {
	readonly snapshot: VocabularySnapshot;
	readonly patternData: CollisionLexemePatternData;
}): CollisionLexemePoolResult {
	try {
		const seam = readPatternData(input.patternData);
		const snapshot = input.snapshot;
		const manual = readSnapshot(snapshot);

		// Pass 1: index the Manual records that carry a Collision role. This is
		// the authority the Collision projection is checked against, so it is
		// built before anything reads that projection.
		const records = new Map<string, ManualRecord>();
		for (const candidate of manual) {
			if (candidate === null || typeof candidate !== "object") {
				return reject("invalid-candidate");
			}
			const role = candidate.collisionRole;
			if (role !== null && role !== "noun" && role !== "sahen") {
				return reject("invalid-snapshot");
			}
			if (candidate.morphology === null || typeof candidate.morphology !== "object") {
				return reject("invalid-candidate");
			}
			if (role === null) {
				continue;
			}
			const base = baseOf(candidate);
			if (records.has(base.displayFormId)) {
				return reject("inconsistent-projection");
			}
			records.set(base.displayFormId, { ...base, role });
		}

		// Pass 2: verify both Collision projection lists against that index and
		// build the Noun pool from what they prove.
		const claimed = new Map<string, "noun" | "sahen">();
		const nounEntries = new Map<string, NounAccumulator>();
		verifyAndMergeNouns(
			snapshot.projections.collision.nouns,
			"noun",
			records,
			claimed,
			nounEntries,
		);
		verifyAndMergeNouns(
			snapshot.projections.collision.sahenNouns,
			"sahen",
			records,
			claimed,
			nounEntries,
		);
		// Every record with a Collision role appears in exactly one list, and the
		// lists hold nothing else. `verifyAndMergeNouns` already refused a second
		// appearance, so equal sizes close the set in both directions.
		if (claimed.size !== records.size) {
			return reject("inconsistent-projection");
		}
		const nouns = finishNouns(nounEntries);

		const modifiers = new Map<string, Accumulator<CollisionModifierVariantRecord>>();
		const predicates = new Map<string, Accumulator<CollisionPredicateVariantRecord>>();

		// Pass 3: finished Modifier and Predicate surfaces, from the same records.
		for (const candidate of manual) {
			const role = candidate.collisionRole;
			const token = candidate.morphology;

			if (role !== null) {
				const base = records.get(candidate.displayFormId)!;
				if (!isSafeCollisionSurface(base.surface)) {
					continue;
				}

				// Noun-derived Modifiers: a Noun surface plus one Markdown-authored
				// suffix literal. The literals are never spelled out in TypeScript.
				for (const suffix of seam.nounSuffixes) {
					const surface = `${base.surface}${suffix.literal}`;
					if (!isSafeCollisionSurface(surface)) {
						continue;
					}
					accumulate(modifiers, surface, {
						variantId: variantId(["noun-suffix", suffix.id, base.displayFormId]),
						modifierClass: "noun-suffix",
						formId: suffix.id,
						formVariant: "suffix",
						morphology: null,
						base,
					});
				}

				// 名詞 / 形容動詞語幹 takes the literal `な`, and nothing else does.
				if (token.detail1 === "形容動詞語幹") {
					const surface = `${base.surface}な`;
					if (isSafeCollisionSurface(surface)) {
						accumulate(modifiers, surface, {
							variantId: variantId(["na-adjective", "na", base.displayFormId]),
							modifierClass: "na-adjective",
							formId: modifierFormId(seam, "na-adjective", "na"),
							formVariant: "na",
							morphology: null,
							base,
						});
					}
				}

				// サ変接続 takes する / した / している / しない. `化された` is a
				// separate noun-suffix literal, not a sahen passive variant.
				if (role === "sahen") {
					for (const [variant, tail] of SAHEN_TAILS) {
						const surface = `${base.surface}${tail}`;
						if (!isSafeCollisionSurface(surface)) {
							continue;
						}
						accumulate(modifiers, surface, {
							variantId: variantId(["sahen", variant, base.displayFormId]),
							modifierClass: "sahen",
							formId: modifierFormId(seam, "sahen", variant),
							formVariant: variant,
							morphology: null,
							base,
						});
					}
				}
				continue;
			}

			if (isIndependent(candidate, "形容詞")) {
				const basic = regularAdjectiveBasicForm({
					conjugationType: token.conjugationType,
					baseForm: token.baseForm,
				});
				if (basic === null) {
					continue;
				}
				const base = baseOf(candidate);
				accumulate(modifiers, basic, {
					variantId: variantId(["i-adjective", "basic", base.displayFormId]),
					modifierClass: "i-adjective",
					formId: modifierFormId(seam, "i-adjective", "basic"),
					formVariant: "basic",
					morphology: { ...token },
					base,
				});
				continue;
			}

			if (isIndependent(candidate, "動詞")) {
				const forms = inflectRegularVerb({
					conjugationType: token.conjugationType,
					baseForm: token.baseForm,
				});
				if (forms === null) {
					continue;
				}
				const base = baseOf(candidate);
				for (const variant of COLLISION_VERB_VARIANTS) {
					accumulate(modifiers, forms[variant], {
						variantId: variantId(["verb", variant, base.displayFormId]),
						modifierClass: "verb",
						formId: modifierFormId(seam, "verb", variant),
						formVariant: variant,
						morphology: { ...token },
						base,
					});
				}
				// Predicate is a separate role, and only the basic form closes a
				// sentence. Past / progressive / negative Predicates, sahen
				// Predicates and irregular verbs are outside the initial scope.
				accumulate(predicates, forms.basic, {
					variantId: variantId(["regular-verb", "basic", base.displayFormId]),
					predicateClass: "regular-verb",
					formVariant: "basic",
					morphology: { ...token },
					base,
				});
			}
		}

		const modifierCandidates: CollisionModifierCandidate[] = [...modifiers.values()]
			.sort((a, b) => compare(a.surface, b.surface))
			.map((entry) => {
				const merged = aggregate(entry);
				const classes = COLLISION_LEXEME_MODIFIER_CLASSES.filter((name) =>
					merged.variants.some((variant) => variant.modifierClass === name),
				);
				// `sahen-basic` is exactly "has a sahen basic variant": never a
				// surface test, and never another sahen variant or a regular verb.
				const profiles = COLLISION_MODIFIER_CANDIDATE_PROFILES.filter(
					(profile) =>
						profile === "all" ||
						merged.variants.some(
							(variant) =>
								variant.modifierClass === "sahen" &&
								variant.formVariant === "basic",
						),
				);
				return { ...merged, classes: [...classes], profiles: [...profiles] };
			});

		const predicateCandidates: CollisionPredicateCandidate[] = [
			...predicates.values(),
		]
			.sort((a, b) => compare(a.surface, b.surface))
			.map((entry) => ({
				...aggregate(entry),
				profiles: [...COLLISION_PREDICATE_CANDIDATE_PROFILES],
			}));

		const modifiersByProfile = {} as Record<
			CollisionModifierCandidateProfile,
			readonly CollisionModifierCandidate[]
		>;
		for (const profile of COLLISION_MODIFIER_CANDIDATE_PROFILES) {
			modifiersByProfile[profile] = modifierCandidates.filter((candidate) =>
				candidate.profiles.includes(profile),
			);
		}

		const predicatesByProfile = {} as Record<
			CollisionPredicateCandidateProfile,
			readonly CollisionPredicateCandidate[]
		>;
		for (const profile of COLLISION_PREDICATE_CANDIDATE_PROFILES) {
			predicatesByProfile[profile] = predicateCandidates.filter((candidate) =>
				candidate.profiles.includes(profile),
			);
		}

		// Only here, with every part built, does a pool become visible — and it is
		// frozen through before it does.
		const pool = freezeAnalysis<CollisionLexemePool>({
			policyVersion: COLLISION_LEXEME_POOL_POLICY_VERSION,
			provenance: {
				snapshotPolicyVersion: snapshot.policyVersion,
				collisionProjectionPolicyVersion:
					snapshot.projections.collision.policyVersion,
				manualProjectionPolicyVersion: snapshot.projections.manual.policyVersion,
				vocabularyFingerprint: snapshot.fingerprint,
				drawMode: snapshot.drawMode,
				sources: snapshot.sources.map((source) => ({
					path: source.path,
					contentHash: source.contentHash,
					projectionPolicy: source.projectionPolicy,
				})),
				patternSchemaVersion: COLLISION_PATTERN_SCHEMA_VERSION,
				patternDataVersion: seam.dataVersion,
			},
			nouns,
			modifiers: modifierCandidates,
			predicates: predicateCandidates,
			modifiersByProfile,
			predicatesByProfile,
			...(snapshot.sourceWeights ? { sourceWeights: [...snapshot.sourceWeights] } : {}),
		});
		return { ok: true, pool };
	} catch (error) {
		if (error instanceof RejectionError) {
			return { ok: false, reason: error.reason };
		}
		// Nothing else is expected, and an exception message is never surfaced.
		return { ok: false, reason: "invalid-candidate" };
	}
}

// --- pool contract validator ----------------------------------------------

/**
 * Why a pool is not one this module could have produced.
 *
 * These name the invariant that failed and nothing else: no path, note text,
 * surface, reading, field value or exception message.
 */
export type CollisionLexemePoolViolation =
	| "not-frozen"
	| "invalid-policy"
	| "invalid-provenance"
	| "invalid-candidate"
	| "invalid-variant"
	| "invalid-ordering"
	| "invalid-aggregate"
	| "invalid-projection"
	| "invalid-pattern-binding"
	| "not-minted";

/** Pool / pattern-data pairs already proved structurally valid. Never pre-populated. */
const VALIDATED = new WeakMap<object, WeakSet<object>>();

const MODIFIER_FORM_PAIRS: ReadonlySet<string> = new Set(
	COLLISION_MODIFIER_FORMS.map((entry) =>
		JSON.stringify([entry.class, entry.variant]),
	),
);

const MODIFIER_FORM_VARIANTS: ReadonlySet<string> = new Set<string>([
	...COLLISION_MODIFIER_FORMS.map((entry) => entry.variant),
	"suffix",
]);

/** Deep frozen-ness, cycle safe: a forged pool may contain a cycle. */
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

function originsTotal(origins: readonly VocabularyOrigin[]): number | null {
	let total = 0;
	for (const origin of origins) {
		if (
			typeof origin.path !== "string" ||
			typeof origin.contentHash !== "string" ||
			!isPositiveCount(origin.count)
		) {
			return null;
		}
		total += origin.count;
		if (!Number.isSafeInteger(total)) {
			return null;
		}
	}
	return total;
}

function originsMatch(
	left: readonly VocabularyOrigin[],
	right: readonly VocabularyOrigin[],
): boolean {
	return (
		left.length === right.length &&
		left.every((origin, index) => {
			const other = right[index]!;
			return (
				origin.path === other.path &&
				origin.contentHash === other.contentHash &&
				origin.count === other.count
			);
		})
	);
}

function referencesMatch(
	left: readonly VocabularyCandidateReference[],
	right: readonly VocabularyCandidateReference[],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(reference, index) =>
				reference.candidateId === right[index]!.candidateId &&
				reference.displayFormId === right[index]!.displayFormId,
		)
	);
}

/** A base record carries full identity, a safe surface and settled provenance. */
function validBase(base: CollisionLexemeBase): boolean {
	if (
		base === null ||
		typeof base !== "object" ||
		typeof base.candidateId !== "string" ||
		base.candidateId.length === 0 ||
		typeof base.displayFormId !== "string" ||
		base.displayFormId.length === 0 ||
		typeof base.surface !== "string" ||
		!isSafeCollisionSurface(base.surface) ||
		!isPositiveCount(base.frequency) ||
		!isList(base.origins) ||
		base.origins.length === 0
	) {
		return false;
	}
	return (
		// The display form is minted from the candidate id and the surface, so a
		// record cannot keep one identity while presenting another surface.
		vocabularyDisplayFormId(base.candidateId, base.surface) ===
			base.displayFormId &&
		originsMatch(base.origins, [...base.origins].sort(compareOrigin)) &&
		originsTotal(base.origins) === base.frequency
	);
}

function sameBase(left: CollisionLexemeBase, right: CollisionLexemeBase): boolean {
	return (
		left.candidateId === right.candidateId &&
		left.surface === right.surface &&
		left.frequency === right.frequency &&
		originsMatch(left.origins, right.origins)
	);
}

type AggregateInput = {
	readonly surface: string;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
	readonly candidates: readonly VocabularyCandidateReference[];
};

/**
 * Re-derives the aggregate LEXEME1 computes for one entry and compares it.
 *
 * Every contributing record is counted once, keyed by display form, which is
 * the dedupe rule the builder applies. An entry whose published frequency,
 * origins or candidate list does not follow from its own variants is not one
 * the builder could have produced.
 */
function aggregateMatches(
	entry: AggregateInput,
	bases: readonly CollisionLexemeBase[],
): boolean {
	const byDisplayForm = new Map<string, CollisionLexemeBase>();
	for (const base of bases) {
		const previous = byDisplayForm.get(base.displayFormId);
		if (previous && !sameBase(previous, base)) {
			return false;
		}
		byDisplayForm.set(base.displayFormId, base);
	}
	const distinct = [...byDisplayForm.values()].sort((a, b) =>
		compare(a.displayFormId, b.displayFormId),
	);
	let frequency = 0;
	for (const base of distinct) {
		frequency += base.frequency;
		if (!Number.isSafeInteger(frequency)) {
			return false;
		}
	}
	const references = distinct
		.map((base) => ({
			candidateId: base.candidateId,
			displayFormId: base.displayFormId,
		}))
		.sort(compareReference);
	return (
		entry.frequency === frequency &&
		originsMatch(
			entry.origins,
			mergeOrigins(distinct.map((base) => base.origins)),
		) &&
		referencesMatch(entry.candidates, references)
	);
}

function validSurfaceEntry(entry: AggregateInput): boolean {
	return (
		typeof entry.surface === "string" &&
		isSafeCollisionSurface(entry.surface) &&
		isPositiveCount(entry.frequency) &&
		isList(entry.origins) &&
		entry.origins.length > 0 &&
		isList(entry.candidates) &&
		entry.candidates.length > 0
	);
}

/** Canonical ascending order by surface, with no repeated surface. */
function canonicallyOrdered(
	entries: readonly { readonly surface: string }[],
): boolean {
	for (let index = 1; index < entries.length; index += 1) {
		if (compare(entries[index - 1]!.surface, entries[index]!.surface) >= 0) {
			return false;
		}
	}
	return true;
}

/**
 * What one pool must agree with in the pattern set it was built from.
 *
 * A form id is meaningless on its own: it is the pattern set that says which
 * class and variant `verb-past` names, and which literal `noun-ka-shita`
 * appends. Without this binding a variant could keep its surface and claim a
 * different form, and a consumer would then weight and record it as that form.
 */
type PatternBinding = {
	readonly formIdOf: ReadonlyMap<string, string>;
	readonly suffixLiteralOf: ReadonlyMap<string, string>;
	readonly schemaVersion: number;
	readonly dataVersion: number;
};

function formKeyOf(modifierClass: string, variant: string): string {
	return JSON.stringify([modifierClass, variant]);
}

/** `null` when the pattern data is not something a pool may be bound to. */
function readPatternBinding(
	data: CollisionLexemePatternData,
): PatternBinding | null {
	if (
		data === null ||
		typeof data !== "object" ||
		!deeplyFrozen(data, new WeakSet<object>()) ||
		data.schemaVersion !== COLLISION_PATTERN_SCHEMA_VERSION ||
		!isPositiveCount(data.dataVersion) ||
		!isList(data.modifierForms) ||
		!isList(data.nounSuffixes)
	) {
		return null;
	}
	const formIdOf = new Map<string, string>();
	const ids = new Set<string>();
	for (const form of data.modifierForms) {
		const key = formKeyOf(form.class, form.variant);
		if (
			typeof form.id !== "string" ||
			form.id.length === 0 ||
			ids.has(form.id) ||
			!MODIFIER_FORM_PAIRS.has(key) ||
			formIdOf.has(key)
		) {
			return null;
		}
		ids.add(form.id);
		formIdOf.set(key, form.id);
	}
	if (formIdOf.size !== COLLISION_MODIFIER_FORMS.length) {
		return null;
	}
	const suffixLiteralOf = new Map<string, string>();
	for (const suffix of data.nounSuffixes) {
		if (
			typeof suffix.id !== "string" ||
			suffix.id.length === 0 ||
			ids.has(suffix.id) ||
			typeof suffix.literal !== "string" ||
			suffix.literal.length === 0
		) {
			return null;
		}
		ids.add(suffix.id);
		suffixLiteralOf.set(suffix.id, suffix.literal);
	}
	if (suffixLiteralOf.size === 0) {
		return null;
	}
	return {
		formIdOf,
		suffixLiteralOf,
		schemaVersion: data.schemaVersion,
		dataVersion: data.dataVersion,
	};
}

const SAHEN_TAIL_OF: ReadonlyMap<string, string> = new Map(SAHEN_TAILS);

/** Every origin must name a Source the pool's own provenance records. */
function originsWithinSources(
	origins: readonly VocabularyOrigin[],
	sources: ReadonlySet<string>,
): boolean {
	const seen = new Set<string>();
	for (const origin of origins) {
		const key = JSON.stringify([origin.path, origin.contentHash]);
		// A merged origin list names each Source once.
		if (seen.has(key) || !sources.has(key)) {
			return false;
		}
		seen.add(key);
	}
	return true;
}

function validReferences(
	references: readonly VocabularyCandidateReference[],
): boolean {
	const displayForms = new Set<string>();
	for (const reference of references) {
		if (
			reference === null ||
			typeof reference !== "object" ||
			typeof reference.candidateId !== "string" ||
			reference.candidateId.length === 0 ||
			typeof reference.displayFormId !== "string" ||
			reference.displayFormId.length === 0 ||
			displayForms.has(reference.displayFormId)
		) {
			return false;
		}
		displayForms.add(reference.displayFormId);
	}
	return referencesMatch(references, [...references].sort(compareReference));
}

/**
 * Whether this evidence describes the very record it is attached to.
 *
 * `vocabularyCandidateId()` is the central identity contract, minted from
 * exactly these token fields. Re-minting it and requiring the base record's own
 * `candidateId` closes the gap that checking only the inflection table would
 * leave: evidence naming another word cannot be attached to this record, even
 * when every surface around it is rewritten to agree with the evidence.
 */
function morphologyBinds(
	morphology: JapaneseToken | null,
	base: CollisionLexemeBase,
	pos: string,
): morphology is JapaneseToken {
	return (
		morphology !== null &&
		typeof morphology === "object" &&
		morphology.pos === pos &&
		morphology.detail1 === "自立" &&
		morphology.isUnknown !== true &&
		typeof morphology.conjugationType === "string" &&
		morphology.conjugationType.length > 0 &&
		typeof morphology.baseForm === "string" &&
		morphology.baseForm.length > 0 &&
		morphology.surface === base.surface &&
		vocabularyCandidateId(morphology) === base.candidateId
	);
}

/**
 * Whether this finished Modifier surface follows from its own record, its
 * declared form and the pattern set it claims to use.
 *
 * Every class is re-derived, never taken on trust. The three concatenating
 * classes append a literal the pattern set or this module owns. The two
 * inflected classes replay the closed inflection table against the dictionary
 * fields the variant carries, which is also what refuses a surface inflected
 * from a lexeme the table excludes.
 */
function surfaceFollows(
	entry: CollisionModifierCandidate,
	variant: CollisionModifierVariantRecord,
	binding: PatternBinding,
): boolean {
	const expectedFormId = (
		modifierClass: string,
		formVariant: string,
	): string | undefined => binding.formIdOf.get(formKeyOf(modifierClass, formVariant));

	switch (variant.modifierClass) {
		case "noun-suffix": {
			if (variant.formVariant !== "suffix" || variant.morphology !== null) {
				return false;
			}
			const literal = binding.suffixLiteralOf.get(variant.formId);
			return (
				literal !== undefined &&
				entry.surface === `${variant.base.surface}${literal}`
			);
		}
		case "na-adjective":
			return (
				variant.formVariant === "na" &&
				variant.morphology === null &&
				variant.formId === expectedFormId("na-adjective", "na") &&
				entry.surface === `${variant.base.surface}な`
			);
		case "sahen": {
			const tail = SAHEN_TAIL_OF.get(variant.formVariant);
			return (
				variant.morphology === null &&
				tail !== undefined &&
				variant.formId === expectedFormId("sahen", variant.formVariant) &&
				entry.surface === `${variant.base.surface}${tail}`
			);
		}
		case "i-adjective":
			return (
				variant.formVariant === "basic" &&
				morphologyBinds(variant.morphology, variant.base, "形容詞") &&
				variant.formId === expectedFormId("i-adjective", "basic") &&
				regularAdjectiveBasicForm(variant.morphology) === entry.surface
			);
		case "verb": {
			if (
				!morphologyBinds(variant.morphology, variant.base, "動詞") ||
				variant.formId !== expectedFormId("verb", variant.formVariant)
			) {
				return false;
			}
			const forms = inflectRegularVerb(variant.morphology);
			return (
				forms !== null &&
				COLLISION_VERB_VARIANTS.some(
					(name) =>
						name === variant.formVariant && forms[name] === entry.surface,
				)
			);
		}
	}
}

function checkModifier(
	entry: CollisionModifierCandidate,
	binding: PatternBinding,
	sources: ReadonlySet<string>,
): boolean {
	if (
		!validSurfaceEntry(entry) ||
		!validReferences(entry.candidates) ||
		!originsWithinSources(entry.origins, sources) ||
		!isList(entry.variants) ||
		entry.variants.length === 0 ||
		!isList(entry.classes) ||
		!isList(entry.profiles)
	) {
		return false;
	}
	for (const [index, variant] of entry.variants.entries()) {
		if (
			variant === null ||
			typeof variant !== "object" ||
			typeof variant.variantId !== "string" ||
			variant.variantId.length === 0 ||
			(index > 0 &&
				compare(entry.variants[index - 1]!.variantId, variant.variantId) >= 0) ||
			!COLLISION_LEXEME_MODIFIER_CLASSES.includes(variant.modifierClass) ||
			typeof variant.formId !== "string" ||
			variant.formId.length === 0 ||
			!MODIFIER_FORM_VARIANTS.has(variant.formVariant) ||
			!validBase(variant.base) ||
			!originsWithinSources(variant.base.origins, sources)
		) {
			return false;
		}
		// The variant id binds class, form and base identity together, so a
		// record cannot be re-labelled without minting a different id.
		const suffix = variant.modifierClass === "noun-suffix";
		if (
			variant.variantId !==
			variantId([
				variant.modifierClass,
				suffix ? variant.formId : variant.formVariant,
				variant.base.displayFormId,
			])
		) {
			return false;
		}
		// And the finished surface has to follow from that form and that record.
		if (!surfaceFollows(entry, variant, binding)) {
			return false;
		}
	}
	const classes = COLLISION_LEXEME_MODIFIER_CLASSES.filter((name) =>
		entry.variants.some((variant) => variant.modifierClass === name),
	);
	const profiles = COLLISION_MODIFIER_CANDIDATE_PROFILES.filter(
		(profile) =>
			profile === "all" ||
			entry.variants.some(
				(variant) =>
					variant.modifierClass === "sahen" && variant.formVariant === "basic",
			),
	);
	return (
		entry.classes.length === classes.length &&
		entry.classes.every((name, index) => name === classes[index]) &&
		entry.profiles.length === profiles.length &&
		entry.profiles.every((name, index) => name === profiles[index]) &&
		aggregateMatches(
			entry,
			entry.variants.map((variant) => variant.base),
		)
	);
}

function checkPredicate(
	entry: CollisionPredicateCandidate,
	sources: ReadonlySet<string>,
): boolean {
	if (
		!validSurfaceEntry(entry) ||
		!validReferences(entry.candidates) ||
		!originsWithinSources(entry.origins, sources) ||
		!isList(entry.variants) ||
		entry.variants.length === 0 ||
		!isList(entry.profiles) ||
		entry.profiles.length !== 1 ||
		entry.profiles[0] !== "regular-verb-basic"
	) {
		return false;
	}
	for (const [index, variant] of entry.variants.entries()) {
		if (
			variant === null ||
			typeof variant !== "object" ||
			variant.predicateClass !== "regular-verb" ||
			variant.formVariant !== "basic" ||
			typeof variant.variantId !== "string" ||
			(index > 0 &&
				compare(entry.variants[index - 1]!.variantId, variant.variantId) >= 0) ||
			!validBase(variant.base) ||
			!originsWithinSources(variant.base.origins, sources) ||
			!morphologyBinds(variant.morphology, variant.base, "動詞") ||
			variant.variantId !==
				variantId(["regular-verb", "basic", variant.base.displayFormId]) ||
			// A Predicate is the basic form of the same closed inflection table.
			inflectRegularVerb(variant.morphology)?.basic !== entry.surface
		) {
			return false;
		}
	}
	return aggregateMatches(
		entry,
		entry.variants.map((variant) => variant.base),
	);
}

/**
 * Whether this value is a pool `buildCollisionLexemePool()` could have
 * published from this pattern data, or the invariant that says it is not.
 *
 * This is the single statement of the pool contract. The builder's own output
 * is pinned against it by `tests/collisionLexemePool.test.ts`, and a consumer
 * validates a pool it was handed with the same function rather than a weaker
 * parallel check. Being deeply frozen is one of the invariants, never the proof
 * of origin on its own: identity, canonical ordering, safe surfaces, variant
 * minting, aggregate derivation, the profile projections, the binding to the
 * pattern set's own form ids and literals, and the binding of every origin to a
 * recorded Vocabulary Source are all re-derived here.
 *
 * The pattern data is part of the question, not context: a form id only means
 * something relative to the set that declares it, so the answer is memoized
 * per pool *and* per pattern data.
 */
export function inspectCollisionLexemePoolStructure(
	pool: CollisionLexemePool,
	patternData: CollisionLexemePatternData,
): CollisionLexemePoolViolation | null {
	try {
		if (pool === null || typeof pool !== "object") {
			return "invalid-policy";
		}
		// Memoized per pool and per pattern data, never pre-registered. A pair
		// reaches this map only by passing the whole check below, and both being
		// deeply frozen is one of the things that check proves — so neither value
		// behind a cached identity can have changed since. A later batch slice
		// can therefore regenerate one row without re-walking a large pool, and
		// the first call still pays for the full verification.
		if (VALIDATED.get(pool)?.has(patternData) === true) {
			return null;
		}
		const binding = readPatternBinding(patternData);
		if (binding === null) {
			return "invalid-pattern-binding";
		}
		if (!deeplyFrozen(pool, new WeakSet<object>())) {
			return "not-frozen";
		}
		if (pool.policyVersion !== COLLISION_LEXEME_POOL_POLICY_VERSION) {
			return "invalid-policy";
		}

		const provenance = pool.provenance;
		if (
			provenance === null ||
			typeof provenance !== "object" ||
			provenance.snapshotPolicyVersion !== VOCABULARY_SNAPSHOT_POLICY_VERSION ||
			provenance.collisionProjectionPolicyVersion !==
				COLLISION_PROJECTION_POLICY_VERSION ||
			provenance.manualProjectionPolicyVersion !==
				MANUAL_PROJECTION_POLICY_VERSION ||
			typeof provenance.vocabularyFingerprint !== "string" ||
			!provenance.vocabularyFingerprint.startsWith(
				`${VOCABULARY_FINGERPRINT_VERSION}:`,
			) ||
			(provenance.drawMode !== "uniform" && provenance.drawMode !== "frequency") ||
			!isList(provenance.sources) ||
			provenance.sources.length === 0 ||
			provenance.patternSchemaVersion !== binding.schemaVersion ||
			provenance.patternDataVersion !== binding.dataVersion
		) {
			return "invalid-provenance";
		}
		// The Source set every origin below must name. Paths are unique and in
		// canonical order, as the Snapshot records them.
		const sources = new Set<string>();
		let previousPath: string | null = null;
		for (const source of provenance.sources) {
			if (
				source === null ||
				typeof source !== "object" ||
				typeof source.path !== "string" ||
				source.path.length === 0 ||
				typeof source.contentHash !== "string" ||
				source.contentHash.length === 0 ||
				typeof source.projectionPolicy !== "string" ||
				source.projectionPolicy.length === 0 ||
				(previousPath !== null && compare(previousPath, source.path) >= 0)
			) {
				return "invalid-provenance";
			}
			previousPath = source.path;
			sources.add(JSON.stringify([source.path, source.contentHash]));
		}
		// Absent means every Source is ×1; present, it is one weight per Source and not all ×1.
		if (
			pool.sourceWeights !== undefined &&
			(!isList(pool.sourceWeights) ||
				pool.sourceWeights.length !== provenance.sources.length ||
				!pool.sourceWeights.every(isSourceWeight) ||
				pool.sourceWeights.every((weight) => weight === 1))
		) {
			return "invalid-provenance";
		}

		if (!isList(pool.nouns) || !isList(pool.modifiers) || !isList(pool.predicates)) {
			return "invalid-candidate";
		}
		for (const noun of pool.nouns) {
			if (
				noun === null ||
				typeof noun !== "object" ||
				!validSurfaceEntry(noun) ||
				!validReferences(noun.candidates) ||
				// Each reference's display form is minted from its candidate id
				// and this entry's surface, so a Noun cannot borrow a record that
				// belongs to a different surface.
				noun.candidates.some(
					(reference) =>
						vocabularyDisplayFormId(reference.candidateId, noun.surface) !==
						reference.displayFormId,
				) ||
				originsTotal(noun.origins) !== noun.frequency ||
				!originsMatch(noun.origins, [...noun.origins].sort(compareOrigin)) ||
				// An origin naming a Source this pool does not record would let
				// generated vocabulary disagree with the provenance a later
				// Collect uses for its conflict check.
				!originsWithinSources(noun.origins, sources)
			) {
				return "invalid-candidate";
			}
		}
		for (const modifier of pool.modifiers) {
			if (
				modifier === null ||
				typeof modifier !== "object" ||
				!checkModifier(modifier, binding, sources)
			) {
				return "invalid-variant";
			}
		}
		for (const predicate of pool.predicates) {
			if (
				predicate === null ||
				typeof predicate !== "object" ||
				!checkPredicate(predicate, sources)
			) {
				return "invalid-variant";
			}
		}

		if (
			!canonicallyOrdered(pool.nouns) ||
			!canonicallyOrdered(pool.modifiers) ||
			!canonicallyOrdered(pool.predicates)
		) {
			return "invalid-ordering";
		}

		// The profile maps are views of the root arrays, not separate pools.
		const modifierProfiles = pool.modifiersByProfile;
		const predicateProfiles = pool.predicatesByProfile;
		if (
			modifierProfiles === null ||
			typeof modifierProfiles !== "object" ||
			predicateProfiles === null ||
			typeof predicateProfiles !== "object" ||
			Object.keys(modifierProfiles).sort().join() !==
				[...COLLISION_MODIFIER_CANDIDATE_PROFILES].sort().join() ||
			Object.keys(predicateProfiles).sort().join() !==
				[...COLLISION_PREDICATE_CANDIDATE_PROFILES].sort().join()
		) {
			return "invalid-projection";
		}
		for (const profile of COLLISION_MODIFIER_CANDIDATE_PROFILES) {
			const view = modifierProfiles[profile];
			const expected = pool.modifiers.filter((entry) =>
				entry.profiles.includes(profile),
			);
			if (
				!isList(view) ||
				view.length !== expected.length ||
				view.some((entry, index) => entry !== expected[index])
			) {
				return "invalid-projection";
			}
		}
		for (const profile of COLLISION_PREDICATE_CANDIDATE_PROFILES) {
			const view = predicateProfiles[profile];
			const expected = pool.predicates.filter((entry) =>
				entry.profiles.includes(profile),
			);
			if (
				!isList(view) ||
				view.length !== expected.length ||
				view.some((entry, index) => entry !== expected[index])
			) {
				return "invalid-projection";
			}
		}
		const bound = VALIDATED.get(pool) ?? new WeakSet<object>();
		bound.add(patternData);
		VALIDATED.set(pool, bound);
		return null;
	} catch {
		// A forged pool may throw from a getter; that is a violation, not a crash.
		return "invalid-aggregate";
	}
}
