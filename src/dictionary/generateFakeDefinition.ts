import {
	assertUint32Seed,
	createSeededRandom,
	type SeededRandom,
} from "../random/seededRandom";
import {
	assertDictionarySemantropy,
	type DictionarySemantropy,
} from "../settings/dictionarySemantropy";
import {
	canonicalNumber,
	canonicalString,
	hashCanonical,
} from "./canonicalHash";
import {
	MAX_OPTIONAL_CLAUSES,
	MEDIUM_OPTIONAL_THRESHOLD,
	bucketWantsOptionalGate,
	dictionaryBucketOf,
	familyWeight,
	preferredFamilyFor,
	type DictionaryBucket,
} from "./dictionaryBuckets";
import type { FakeDictionaryHeadword, HeadwordIdentity } from "./headword";
import { headwordIdentityKey } from "./headword";
import type { FakeDictionaryPlaceholder } from "./placeholders";
import { STANDARD_TEMPLATE_SET } from "./standardTemplateSet";
import type {
	CompiledCoreTemplate,
	CompiledOptionalClause,
	CompiledTemplateSet,
	TemplateSegment,
} from "./template";
import type { TemplateFamily } from "./templateData";
import {
	fingerprintDictionaryVocabularyPool,
 prepareDictionaryPool,
	type DictionaryVocabularyPool,
} from "./vocabularyPool";

/**
 * 1: the first Fake Dictionary generator. Bump whenever the derivation of the
 * definition Seed, the selection rules, the bucket boundaries, the family
 * weights or the Optional Clause rules change — anything that would make the
 * same inputs produce different text. Rewording the templates themselves bumps
 * `STANDARD_TEMPLATE_SET_VERSION` instead.
 */
export const FAKE_DICTIONARY_ALGORITHM_VERSION = 1;

/** Domain label for the Seed of the whole definition. */
const DEFINITION_DOMAIN = "semantropy/fake-dictionary/definition";
/** Domain labels for the two independent draw streams. See `deriveStream`. */
const CORE_STREAM = "core";
const OPTIONAL_STREAM = "optional";

export type FakeDefinitionRequest = {
	readonly headword: FakeDictionaryHeadword;
	readonly pool: DictionaryVocabularyPool;
	readonly dictionarySeed: number;
	/**
	 * The Fake Dictionary value. Validated on entry, so a plain number is
	 * accepted from a caller that has not branded one yet — but only if it is
	 * genuinely an integer 0..100.
	 */
	readonly dictionarySemantropy: DictionarySemantropy | number;
	/** Defaults to the bundled standard set. */
	readonly templateSet?: CompiledTemplateSet;
};

export type GeneratedFakeDefinition = {
	readonly outcome: "generated";
	/** The definition text. Plain text: never HTML, never escaped, never markup. */
	readonly definition: string;
	readonly templateId: string;
	readonly family: TemplateFamily;
	readonly optionalClauseIds: readonly string[];
	readonly dictionarySeed: number;
	readonly dictionarySemantropy: number;
	readonly dictionaryBucket: DictionaryBucket;
	readonly algorithmVersion: number;
	readonly templateSetVersion: number;
	/** The uint32 this one definition was drawn from. Reproduces it exactly. */
	readonly definitionSeed: number;
	readonly headword: string;
	readonly headwordIdentity: HeadwordIdentity;
};

export type FakeDefinitionResult =
	| { readonly outcome: "off" }
	| {
			readonly outcome: "insufficient-vocabulary";
			/**
			 * Placeholders some template needs and the note supplies nothing for,
			 * sorted by name. Placeholder names only — never a candidate, a token,
			 * a line of the note or a path.
			 */
			readonly missingPlaceholders: readonly FakeDictionaryPlaceholder[];
	  }
	| GeneratedFakeDefinition;

/**
 * The uint32 Seed for one definition.
 *
 * Derived from the algorithm version, the dictionary Seed, the dictionary
 * Semantropy value, the headword's identity, the template set version and the
 * pool fingerprint — and from nothing else. The body Seed, the body Semantropy
 * value, the DOM, the note path and the clock are all absent, which is what
 * keeps a definition stable while the body around it is reshuffled.
 *
 * `0` is a perfectly good result and gets no special case.
 *
 * Both inputs that have a range are checked here, not only at the generator's
 * entry: this function is exported and reproduces a Seed on its own, so a
 * direct caller must not be able to derive one from a Semantropy value the
 * setting could never hold. Otherwise -1 and 101 would each yield a perfectly
 * usable uint32 that no real definition could ever correspond to.
 */
export function deriveDefinitionSeed(
	headwordIdentity: HeadwordIdentity,
	pool: DictionaryVocabularyPool,
	dictionarySeed: number,
	dictionarySemantropy: DictionarySemantropy | number,
	templateSetVersion: number,
): number {
	assertUint32Seed(dictionarySeed);
	assertDictionarySemantropy(dictionarySemantropy);
	return hashCanonical([
		canonicalString(DEFINITION_DOMAIN),
		canonicalNumber(FAKE_DICTIONARY_ALGORITHM_VERSION),
		canonicalNumber(dictionarySeed),
		canonicalNumber(dictionarySemantropy),
		canonicalString(headwordIdentityKey(headwordIdentity)),
		canonicalNumber(templateSetVersion),
		canonicalNumber(fingerprintDictionaryVocabularyPool(pool)),
	]);
}

/**
 * A named draw stream derived from the definition Seed.
 *
 * Core expansion and Optional Clause selection each get their own, so the
 * number of placeholders a core template happens to contain cannot shift which
 * clauses follow it — the two decisions stay independent and separately
 * testable.
 */
function deriveStream(definitionSeed: number, label: string): SeededRandom {
	return createSeededRandom(
		hashCanonical([
			canonicalNumber(definitionSeed),
			canonicalString(label),
		]),
	);
}

function isEligible(
	requiredPlaceholders: readonly FakeDictionaryPlaceholder[],
	pool: DictionaryVocabularyPool,
): boolean {
	return requiredPlaceholders.every(
		(placeholder) => pool[placeholder].length > 0,
	);
}

/** Sorted copy. The caller's array keeps its own order. */
function byId<T extends { readonly id: string }>(items: readonly T[]): T[] {
	return [...items].sort((left, right) =>
		left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
	);
}

/** The eligible templates of one family, in canonical id order. */
type EligibleFamily = {
	readonly family: TemplateFamily;
	readonly templates: readonly CompiledCoreTemplate[];
};

/**
 * Groups eligible templates by family, families in name order.
 *
 * This is the unit the Semantropy weights act on. Every family that survives
 * eligibility appears exactly once regardless of how many of its templates
 * did, so at High and MAX each eligible family really is equally likely, and
 * at Low and Medium the bias is exactly the stated ratio rather than that
 * ratio scaled by a family's surviving template count.
 *
 * The input list is already sorted by id and is not modified.
 */
function groupByFamily(
	templates: readonly CompiledCoreTemplate[],
): readonly EligibleFamily[] {
	const byFamily = new Map<TemplateFamily, CompiledCoreTemplate[]>();
	for (const template of templates) {
		const bucket = byFamily.get(template.family);
		if (bucket) {
			bucket.push(template);
		} else {
			byFamily.set(template.family, [template]);
		}
	}
	return Object.freeze([...byFamily.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([family, group]) => Object.freeze({ family, templates: Object.freeze(group) })));
}

/**
 * Picks one item by weight.
 *
 * `items` must already be in canonical order; the draw is a position in the
 * accumulated weight, so the same weights over the same canonical order always
 * pick the same item.
 */
function pickWeighted<T>(
	items: readonly T[],
	weightOf: (item: T) => number,
	random: SeededRandom,
): T | null {
	let total = 0;
	for (const item of items) {
		total += weightOf(item);
	}
	if (total <= 0) {
		return null;
	}
	let target = random.next() * total;
	for (const item of items) {
		target -= weightOf(item);
		if (target < 0) {
			return item;
		}
	}
	return items[items.length - 1] ?? null;
}

/**
 * Expands one segment list against the pool.
 *
 * Candidates come only from the placeholder's own pool: a template needing
 * `{{place}}` is never handed a `{{noun}}` because places ran out — such a
 * template was already ruled ineligible. Two occurrences of the same
 * placeholder draw independently and may well land on the same surface, which
 * is allowed.
 *
 * The result is a plain string, built by concatenation. Nothing is escaped and
 * nothing is interpreted: a candidate reading `<script>` stays those nine
 * characters. Putting the string safely on screen via `textContent` is the
 * UI's job; this function never produces HTML.
 */
function expandSegments(
	segments: readonly TemplateSegment[],
	pool: DictionaryVocabularyPool,
	random: SeededRandom,
): string {
	let text = "";
	for (const segment of segments) {
		if (segment.kind === "text") {
			text += segment.text;
			continue;
		}
		// Sorted copy: the note's first-appearance order must not decide which
		// candidate a Seed picks, or a re-rendered DOM could change a definition.
		const candidates = prepareDictionaryPool(pool).sorted[segment.placeholder];
		const chosen = candidates[Math.floor(random.next() * candidates.length)];
		text += chosen ?? "";
	}
	return text;
}

/**
 * The placeholders that block every template, for an insufficient-vocabulary
 * result: those some core template requires and the pool cannot supply.
 */
function missingPlaceholdersFor(
	templateSet: CompiledTemplateSet,
	pool: DictionaryVocabularyPool,
): readonly FakeDictionaryPlaceholder[] {
	const missing = new Set<FakeDictionaryPlaceholder>();
	for (const template of templateSet.coreTemplates) {
		for (const placeholder of template.requiredPlaceholders) {
			if (pool[placeholder].length === 0) {
				missing.add(placeholder);
			}
		}
	}
	return Object.freeze([...missing].sort());
}

type PreparedDefinitionPool = {
 readonly families: readonly EligibleFamily[];
 readonly clauses: readonly CompiledOptionalClause[];
 readonly missing: readonly FakeDictionaryPlaceholder[];
};
const preparedDefinitions = new WeakMap<DictionaryVocabularyPool, WeakMap<CompiledTemplateSet, PreparedDefinitionPool>>();
/** Eagerly called during Snapshot preparation. Canonical ordering and draw streams are unchanged. */
export function prepareFakeDictionaryGeneration(pool: DictionaryVocabularyPool, templateSet = STANDARD_TEMPLATE_SET): PreparedDefinitionPool {
 const cached = preparedDefinitions.get(pool)?.get(templateSet);
 if (cached) return cached;
 prepareDictionaryPool(pool);
 // Freeze the newly allocated containers before publishing the cached reference.
 // Compiled template entries and their segments are already frozen by the compiler.
 const prepared = Object.freeze({
  families: groupByFamily(byId(templateSet.coreTemplates).filter(template => isEligible(template.requiredPlaceholders, pool))),
  clauses: Object.freeze(byId(templateSet.optionalClauses).filter(clause => isEligible(clause.requiredPlaceholders, pool))),
  missing: missingPlaceholdersFor(templateSet, pool),
 });
 if (Object.isFrozen(pool) && Object.values(pool).every(Object.isFrozen) && templateSet === STANDARD_TEMPLATE_SET) {
  let sets = preparedDefinitions.get(pool);
  if (!sets) { sets = new WeakMap(); preparedDefinitions.set(pool, sets); }
  sets.set(templateSet, prepared);
 }
 return prepared;
}

/**
 * Generates one Fake Definition, or says why it did not.
 *
 * Pure: no DOM, no Vault, no clock, no `Math.random()`, no network. Given the
 * same headword, the same set of candidate words and the same Seed and value,
 * it returns exactly the same result — including when the note's text nodes
 * were analysed in a different order, or the caller's arrays are shuffled.
 *
 * Inputs are never modified.
 */
export function generateFakeDefinition(
	request: FakeDefinitionRequest,
): FakeDefinitionResult {
	const templateSet = request.templateSet ?? STANDARD_TEMPLATE_SET;
	// Checked before anything is decided. Out of range, fractional and NaN
	// values are refused here rather than silently bucketed — -1 must not read
	// as Off, 101 must not read as MAX, and 1.5 must not survive to fail later
	// as some unrelated error.
	const semantropy = assertDictionarySemantropy(request.dictionarySemantropy);
	const bucket = dictionaryBucketOf(semantropy);
	if (bucket === "off") {
		return Object.freeze({ outcome: "off" } as const);
	}

	const { pool, headword } = request;
	const prepared = prepareFakeDictionaryGeneration(pool, templateSet);
	if (prepared.families.length === 0) {
		return Object.freeze({
			outcome: "insufficient-vocabulary",
			missingPlaceholders: prepared.missing,
		} as const);
	}

	const definitionSeed = deriveDefinitionSeed(
		headword.identity,
		pool,
		request.dictionarySeed,
		semantropy,
		templateSet.version,
	);

	const preferred = preferredFamilyFor(headword.classification);
	const coreRandom = deriveStream(definitionSeed, CORE_STREAM);
	// Family first, then a template inside it. The weights are between
	// families, so they must be applied to families: weighting each template
	// individually would multiply a family's share by how many of its three
	// templates the note happens to be able to fill.
	const families = prepared.families;
	const family =
		pickWeighted(
			families,
			(candidate: EligibleFamily) =>
				familyWeight(bucket, candidate.family, preferred),
			coreRandom,
		) ?? families[0];
	const template =
		family?.templates[Math.floor(coreRandom.next() * family.templates.length)];
	if (!template) {
		return Object.freeze({
			outcome: "insufficient-vocabulary",
			missingPlaceholders: prepared.missing,
		} as const);
	}

	let definition = expandSegments(template.segments, pool, coreRandom);

	// One stream for the whole optional phase: the gate, the choice of clauses
	// and their expansion all draw from it in that order.
	const optionalRandom = deriveStream(definitionSeed, OPTIONAL_STREAM);
	const clauses = selectOptionalClauses(
		templateSet,
		pool,
		bucket,
		optionalRandom,
	);
	for (const clause of clauses) {
		// Concatenated as written. Neither side's wording is adjusted to fit.
		definition += expandSegments(clause.segments, pool, optionalRandom);
	}

	return Object.freeze({
		outcome: "generated",
		definition,
		templateId: template.id,
		family: template.family,
		optionalClauseIds: Object.freeze(clauses.map((clause) => clause.id)),
		dictionarySeed: request.dictionarySeed,
		dictionarySemantropy: semantropy,
		dictionaryBucket: bucket,
		algorithmVersion: FAKE_DICTIONARY_ALGORITHM_VERSION,
		templateSetVersion: templateSet.version,
		definitionSeed,
		headword: headword.surface,
		headwordIdentity: headword.identity,
	} as const);
}

/**
 * Chooses the Optional Clauses for one definition.
 *
 * A clause is a candidate only when the pool satisfies its own required
 * placeholders. A clause the note cannot fill is skipped; it never disqualifies
 * the core template it would have followed. No clause is used twice in one
 * definition, and a bucket that asks for more clauses than are eligible simply
 * gets the ones that exist.
 */
function selectOptionalClauses(
	templateSet: CompiledTemplateSet,
	pool: DictionaryVocabularyPool,
	bucket: DictionaryBucket,
	random: SeededRandom,
): readonly CompiledOptionalClause[] {
	const limit = MAX_OPTIONAL_CLAUSES[bucket];
	if (limit === 0) {
		return [];
	}
	if (
		bucketWantsOptionalGate(bucket) &&
		random.next() >= MEDIUM_OPTIONAL_THRESHOLD
	) {
		return [];
	}

	const remaining = [...prepareFakeDictionaryGeneration(pool, templateSet).clauses];
	const chosen: CompiledOptionalClause[] = [];
	while (chosen.length < limit && remaining.length > 0) {
		const index = Math.floor(random.next() * remaining.length);
		const [clause] = remaining.splice(index, 1);
		if (!clause) {
			break;
		}
		chosen.push(clause);
	}
	return chosen;
}
