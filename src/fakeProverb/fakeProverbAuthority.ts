/**
 * PRE-RELEASE-FAKE-PROVERB-CORE1: the authenticated Fake Proverb lexeme
 * authority. Production-disconnected.
 *
 * An authority is minted only from a genuine Manual Morph Vocabulary owner
 * (`buildManualMorphVocabulary()` over analyses `analyzeManualMorphSource()`
 * registered) and one compiled Recipe Schema 1 set, and it is bound to both
 * privately. It is not a Collision pool: `CollisionLexemePool` stays bound to
 * the Collision Pattern data that minted it, and nothing here reads, accepts or
 * weakens that binding. What is shared is the owner's authenticated Source
 * chain and two pure leaves: the Snapshot's own safe independent-noun
 * projection and the closed MAX realizer.
 *
 * Every candidate is re-derived from the owner's own Snapshot, never from the
 * Source (no re-read, no tokenize):
 *
 *   - `independent-noun`: the union of the Snapshot's automatic-body buckets —
 *     no pronoun, dependent noun, suffix or unknown word — grouped by surface.
 *   - verb / i-adjective forms: lexemes `[pos, detail1, conjugationType,
 *     baseForm]` realized by `realizeMaxLexeme()` with the one realizer key the
 *     form names, plus exactly the follower that key's own contract preserves
 *     (た for `verb-ta-stem-t`, だ for `verb-ta-stem-d`, ない for
 *     `verb-irrealis-negation`). No ending is inferred from a surface. An
 *     irregular lexeme, an unadmitted class or a missing field is refused by the
 *     realizer and never becomes a candidate.
 *
 * Only forms the bound recipe set's profiles use are derived. Every surface
 * must pass the Fake Proverb safe text grammar (no control / format /
 * separator / surrogate / whitespace, no ASCII punctuation, so no Markdown
 * delimiter). A candidate that fails is fail-closed: it is never placed.
 * A declared form with no binding to the realizer contract refuses the whole
 * authority (`unsupported-form`) instead of quietly contributing nothing.
 *
 * Origin (the private registry and a live owner) and structure (a fresh
 * re-derivation reproduces the authority exactly) are separate questions;
 * neither a hash nor deep freezing stands in for either.
 */

import {
	freezeAnalysis,
	vocabularyCandidateId,
	vocabularyDisplayFormId,
	type VocabularyOrigin,
} from "../analysis/rubyVocabulary";
import {
	isManualMorphVocabulary,
	readManualMorphVocabularySources,
	type ManualMorphVocabulary,
} from "../transform/manualMorphology";
import {
	MAX_REALIZER_RULES,
	maxLexemeIdentity,
	maxSlotClassOf,
	realizeMaxLexeme,
	type MaxRealizerInput,
	type MaxTargetFormKey,
} from "../transform/maxRealizer";
import type {
	ManualVocabularyCandidate,
	VocabularyDrawMode,
	VocabularySourceIdentity,
} from "../vocabulary/vocabularySnapshot";
import {
	compileFakeProverbRecipeSet,
	type CompiledFakeProverbPart,
	type CompiledFakeProverbRecipeSet,
	type CompileFakeProverbRecipeSetInput,
} from "./compileRecipeSet";
import { isFakeProverbSafeText } from "./fakeProverbText";
import { FAKE_PROVERB_ALGORITHM_VERSION, FAKE_PROVERB_AUTHORITY_POLICY_VERSION } from "./fakeProverbVersions";

// The text grammar lives in a pure leaf so Collect can validate without this module's graph.
export { isFakeProverbSafeText } from "./fakeProverbText";
import {
	FAKE_PROVERB_CANDIDATE_FORMS,
	FAKE_PROVERB_SLOT_KINDS,
	type FakeProverbCandidateForm,
	type RawFakeProverbPart,
} from "./recipeData";

// --- fixed refusals ---------------------------------------------------------

/** Fixed codes only. A refusal never carries a path, note text, surface, reading or exception message. */
export type FakeProverbReason =
	| "invalid-vocabulary"
	| "invalid-recipe-set"
	| "invalid-authority"
	| "recipe-binding-mismatch"
	| "provenance-mismatch"
	| "unsupported-form"
	| "stale"
	| "released"
	| "invalid-request";

export type FakeProverbAnswer<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: FakeProverbReason };

const REFUSALS = new WeakMap<object, FakeProverbReason>();

export function refuseFakeProverb(reason: FakeProverbReason): never {
	const error = new Error(reason);
	REFUSALS.set(error, reason);
	throw error;
}

/** Runs `work`; any exception that is not one of our own refusals becomes `fallback`. */
export function guardFakeProverb<T>(work: () => T, fallback: FakeProverbReason): FakeProverbAnswer<T> {
	try {
		return Object.freeze({ ok: true as const, value: work() });
	} catch (error) {
		const reason = error !== null && typeof error === "object" ? REFUSALS.get(error) : undefined;
		return Object.freeze({ ok: false as const, reason: reason ?? fallback });
	}
}

/** A plain object with exactly these own data properties. Getters are refused, never run. */
export function exactFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
		refuseFakeProverb("invalid-request");
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(value).length !== keys.length ||
		keys.some((key) => descriptors[key] === undefined || !("value" in descriptors[key]))) {
		refuseFakeProverb("invalid-request");
	}
	return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value as unknown]));
}

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// --- form binding to the closed realizer ------------------------------------

type SlotClass = "noun" | "verb" | "i-adjective";
type FollowerId = "aux-ta" | "aux-da" | "aux-nai";
type FormRealization = { readonly key: MaxTargetFormKey; readonly follower: FollowerId | null };
type FormSpec = { readonly slotClass: SlotClass; readonly realizations: readonly FormRealization[] };

/**
 * Each closed Recipe Schema 1 form, bound to the MAX realizer. `verb-past`
 * lists both た-stem keys because the realizer admits each regular class to
 * exactly one of them; the key that admits the lexeme also names its follower.
 */
const FORM_SPECS: Readonly<Record<string, FormSpec>> = Object.freeze({
	"independent-noun": { slotClass: "noun", realizations: [] },
	"adjective-basic": { slotClass: "i-adjective", realizations: [{ key: "adjective-basic", follower: null }] },
	"verb-basic": { slotClass: "verb", realizations: [{ key: "verb-basic", follower: null }] },
	"verb-past": { slotClass: "verb", realizations: [{ key: "verb-ta-stem-t", follower: "aux-ta" }, { key: "verb-ta-stem-d", follower: "aux-da" }] },
	"verb-negative": { slotClass: "verb", realizations: [{ key: "verb-irrealis-negation", follower: "aux-nai" }] },
});
const FOLLOWER_SURFACES: Readonly<Record<FollowerId, string>> = Object.freeze({ "aux-ta": "た", "aux-da": "だ", "aux-nai": "ない" });

/**
 * Whether a form is bound to the realizer's published contract: the key exists
 * for the form's slot class, and a follower is one that key's own Target
 * connections preserve (a basic form takes none). This reads the realizer's
 * rules; it holds no second opinion about which (key, follower) pairs exist.
 */
function isFormBound(form: string): boolean {
	const spec = Object.prototype.hasOwnProperty.call(FORM_SPECS, form) ? FORM_SPECS[form] : undefined;
	if (spec === undefined) return false;
	if (spec.slotClass === "noun") return spec.realizations.length === 0;
	if (spec.realizations.length === 0) return false;
	return spec.realizations.every((realization) => MAX_REALIZER_RULES.keys.some(([slotClass, conjugationForm, connection, key]) =>
		slotClass === spec.slotClass && key === realization.key &&
		(realization.follower === null ? conjugationForm === "基本形" : connection === realization.follower)));
}

/** Every form Recipe Schema 1 declares, whether or not a recipe set uses it. */
export const FAKE_PROVERB_DECLARED_FORMS: readonly FakeProverbCandidateForm[] = Object.freeze(
	[...new Set(FAKE_PROVERB_SLOT_KINDS.flatMap((kind) => [...FAKE_PROVERB_CANDIDATE_FORMS[kind]]))].sort(compareText),
);

export type FakeProverbFormRealization = {
	readonly surface: string;
	readonly key: MaxTargetFormKey;
	readonly follower: FollowerId | null;
};

/**
 * The finished surface one lexeme takes in one verb / i-adjective form, or
 * null when the realizer refuses it (irregular, unadmitted class, missing
 * field) or the result is outside the safe text grammar. The surface is the
 * realizer's answer for the form's key plus exactly that key's preserved
 * follower; nothing is inferred from an ending. An unbound form, or two keys
 * answering for one lexeme, refuses with `unsupported-form`.
 */
export function realizeFakeProverbForm(form: string, input: MaxRealizerInput): FakeProverbFormRealization | null {
	if (!isFormBound(form)) refuseFakeProverb("unsupported-form");
	const spec = FORM_SPECS[form]!;
	if (spec.slotClass === "noun" || maxSlotClassOf(input) !== spec.slotClass) return null;
	const realized = spec.realizations.flatMap((realization) => {
		const result = realizeMaxLexeme(realization.key, input);
		return result.realized ? [{ realization, stem: result.surface }] : [];
	});
	if (realized.length === 0) return null;
	// The realizer admits each class to one た-stem key; two answers would be a contract change.
	if (realized.length > 1) refuseFakeProverb("unsupported-form");
	const { realization, stem } = realized[0]!;
	const surface = realization.follower === null ? stem : stem + FOLLOWER_SURFACES[realization.follower];
	return isFakeProverbSafeText(surface) ? { surface, key: realization.key, follower: realization.follower } : null;
}

/** The forms whose realizer binding holds. Exported so tests can pin that none of the declared forms is unbound. */
export function fakeProverbUnboundForms(): readonly string[] {
	return FAKE_PROVERB_DECLARED_FORMS.filter((form) => !isFormBound(form));
}

// --- authority shape ---------------------------------------------------------

export type FakeProverbCandidateEvidence =
	| {
		readonly kind: "record";
		readonly candidateId: string;
		readonly displayFormId: string;
	}
	| {
		readonly kind: "lexeme";
		readonly lexemeId: string;
		readonly conjugationType: string;
		readonly baseForm: string;
		readonly realizerKey: MaxTargetFormKey;
		readonly follower: FollowerId | null;
		readonly records: readonly { readonly candidateId: string; readonly displayFormId: string }[];
	};

/** One placeable surface for one form, with every Vocabulary record behind it. */
export type FakeProverbCandidate = {
	readonly candidateKey: string;
	readonly form: FakeProverbCandidateForm;
	readonly surface: string;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
	readonly evidence: readonly FakeProverbCandidateEvidence[];
};

export type FakeProverbProvenance = {
	readonly vocabularyFingerprint: string;
	readonly drawMode: VocabularyDrawMode;
	readonly sources: readonly VocabularySourceIdentity[];
};

export type FakeProverbAuthority = {
	readonly policyVersion: typeof FAKE_PROVERB_AUTHORITY_POLICY_VERSION;
	readonly algorithmVersion: typeof FAKE_PROVERB_ALGORITHM_VERSION;
	readonly recipeSchemaVersion: number;
	readonly recipeDataVersion: number;
	readonly provenance: FakeProverbProvenance;
	/** Only the forms the bound recipe set's profiles use, sorted by form. */
	readonly forms: readonly { readonly form: FakeProverbCandidateForm; readonly candidates: readonly FakeProverbCandidate[] }[];
};

type Binding = { readonly owner: ManualMorphVocabulary; readonly recipeSet: CompiledFakeProverbRecipeSet };

/** The only records of which authorities, and which revoked owners, exist. Never exported. */
const AUTHORITIES = new WeakMap<object, Binding>();
const REVOKED = new WeakMap<object, "stale" | "released">();

export type FakeProverbReleaseReason = "source-changed" | "refresh" | "view-close" | "plugin-disable";
const RELEASE_REASONS: readonly string[] = ["source-changed", "refresh", "view-close", "plugin-disable"];

// --- recipe set authentication ----------------------------------------------

function deepFrozen(value: unknown, seen = new Set<unknown>()): boolean {
	if (value === null || typeof value !== "object" || seen.has(value)) return true;
	seen.add(value);
	if (!Object.isFrozen(value)) return false;
	return Reflect.ownKeys(value).every((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
		return "value" in descriptor && deepFrozen(descriptor.value, seen);
	});
}

function rawPart(part: CompiledFakeProverbPart): RawFakeProverbPart {
	if (part.kind === "literal") return { kind: part.kind, literalId: part.literalId };
	if (part.kind === "reference") return { kind: part.kind, slotKind: part.slotKind, slotId: part.slotId };
	return { kind: part.kind, slotId: part.slotId, profileId: part.profileId, exported: part.exported };
}

/** The raw document data a compiled set says it came from. */
function rawRecipeInput(set: CompiledFakeProverbRecipeSet): CompileFakeProverbRecipeSetInput {
	return {
		schemaVersion: set.schemaVersion,
		dataVersion: set.dataVersion,
		proverbs: set.proverbs.map((entry) => ({ id: entry.id, enabled: entry.enabled, weight: entry.weight, parts: entry.parts.map(rawPart) })),
		glosses: set.glosses.map((entry) => ({
			id: entry.id, enabled: entry.enabled, weight: entry.weight,
			requires: entry.requires.map((required) => ({ kind: required.kind, slotId: required.slotId })),
			parts: entry.parts.map(rawPart),
		})),
		literals: set.literals.map((entry) => ({ id: entry.id, literal: entry.literal })),
		profiles: set.profiles.map((entry) => ({ id: entry.id, kind: entry.kind, forms: entry.forms.map((form) => ({ form: form.form, weight: form.weight })) })),
	};
}

/**
 * A recipe set is accepted only when it is deeply frozen (so it cannot change
 * after an authority binds to it) and recompiling the raw data it describes
 * with `compileFakeProverbRecipeSet()` reproduces it exactly. There is no
 * second validator here, and a rewritten export, reference source or weight
 * does not survive recompilation.
 */
function requireRecipeSet(value: unknown): CompiledFakeProverbRecipeSet {
	if (value === null || typeof value !== "object" || !deepFrozen(value)) refuseFakeProverb("invalid-recipe-set");
	const set = value as CompiledFakeProverbRecipeSet;
	let matches = false;
	try {
		const recompiled = compileFakeProverbRecipeSet(rawRecipeInput(set));
		matches = recompiled.ok && JSON.stringify(recompiled.set) === JSON.stringify(set);
	} catch {
		// Not the shape of a compiled set at all (for example a Collision pattern set).
	}
	if (!matches) refuseFakeProverb("invalid-recipe-set");
	return set;
}

// --- Vocabulary record provenance ------------------------------------------

const sourceKey = (source: { readonly path: string; readonly contentHash: string }) => JSON.stringify([source.path, source.contentHash]);

function positive(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) refuseFakeProverb("invalid-vocabulary");
	return value;
}

function mergeOrigins(lists: readonly (readonly VocabularyOrigin[])[]): VocabularyOrigin[] {
	const merged = new Map<string, VocabularyOrigin>();
	for (const list of lists) {
		for (const origin of list) {
			const key = sourceKey(origin);
			const previous = merged.get(key);
			merged.set(key, { path: origin.path, contentHash: origin.contentHash, count: positive((previous?.count ?? 0) + origin.count) });
		}
	}
	return [...merged.entries()].sort(([a], [b]) => compareText(a, b)).map(([, origin]) => origin);
}

function originTotal(origins: readonly VocabularyOrigin[], sources: ReadonlySet<string>): number {
	const seen = new Set<string>();
	let total = 0;
	for (const origin of origins) {
		const key = sourceKey(origin);
		if (!sources.has(key)) refuseFakeProverb("provenance-mismatch");
		if (seen.has(key)) refuseFakeProverb("invalid-vocabulary");
		seen.add(key);
		total = positive(total + positive(origin.count));
	}
	return total;
}

/**
 * Independent provenance check of one Snapshot record: identity re-minted from
 * its own token, origins inside the recorded Sources and summing to its
 * frequency, and every verified Ruby variant re-minted in full.
 */
function checkRecord(record: ManualVocabularyCandidate, sources: ReadonlySet<string>): void {
	const token = record.morphology;
	if (typeof record.surface !== "string" || record.surface.length === 0 || record.surface !== token.surface || token.isUnknown) {
		refuseFakeProverb("invalid-vocabulary");
	}
	if (record.candidateId !== vocabularyCandidateId(token) ||
		record.displayFormId !== vocabularyDisplayFormId(record.candidateId, record.surface)) {
		refuseFakeProverb("invalid-vocabulary");
	}
	if (positive(record.frequency) !== originTotal(record.origins, sources)) refuseFakeProverb("invalid-vocabulary");
	const recordSources = new Set(record.origins.map(sourceKey));
	for (const variant of record.verifiedRubyVariants) {
		const { start, end } = variant.baseRangeInSurface;
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > record.surface.length || start >= end ||
			typeof variant.reading !== "string") refuseFakeProverb("invalid-vocabulary");
		if (variant.variantId !== JSON.stringify([record.displayFormId, record.surface.slice(start, end).normalize("NFC"),
			variant.reading.normalize("NFC"), start, end])) refuseFakeProverb("invalid-vocabulary");
		if (originTotal(variant.origins, recordSources) !== positive(variant.frequency)) refuseFakeProverb("invalid-vocabulary");
	}
}

// --- derivation --------------------------------------------------------------

type Group = { surface: string; frequency: number; origins: (readonly VocabularyOrigin[])[]; evidence: FakeProverbCandidateEvidence[] };
type Content = Omit<FakeProverbAuthority, never>;

function usedForms(set: CompiledFakeProverbRecipeSet): FakeProverbCandidateForm[] {
	return [...new Set(set.profiles.flatMap((profile) => profile.forms.map((entry) => entry.form)))].sort(compareText);
}

function addToGroup(groups: Map<string, Group>, surface: string, frequency: number,
	origins: readonly VocabularyOrigin[], evidence: FakeProverbCandidateEvidence): void {
	const group = groups.get(surface) ?? { surface, frequency: 0, origins: [], evidence: [] };
	group.frequency = positive(group.frequency + frequency);
	group.origins.push(origins);
	group.evidence.push(evidence);
	groups.set(surface, group);
}

/** Pure re-derivation from the owner's Snapshot and the bound recipe set. Minting and inspection both run it. */
function derive(owner: ManualMorphVocabulary, set: CompiledFakeProverbRecipeSet): Content {
	const snapshot = owner.snapshot;
	const analyses = readManualMorphVocabularySources(owner);
	if (!analyses) refuseFakeProverb("invalid-vocabulary");
	// Every Vocabulary Source the Snapshot records is one this owner analyzed, and the reverse.
	const expected = new Set(snapshot.sources.map((source) => JSON.stringify(source)));
	const analyzed = new Set(analyses.map((entry) => JSON.stringify(entry.source)));
	if (expected.size !== snapshot.sources.length || analyzed.size !== expected.size ||
		[...analyzed].some((source) => !expected.has(source))) refuseFakeProverb("provenance-mismatch");
	const sources = new Set(snapshot.sources.map(sourceKey));
	const records = new Map(snapshot.projections.manual.candidates.map((record) => [record.displayFormId, record]));
	if (records.size !== snapshot.projections.manual.candidates.length) refuseFakeProverb("invalid-vocabulary");
	const checked = new Set<ManualVocabularyCandidate>();
	const check = (record: ManualVocabularyCandidate) => {
		if (!checked.has(record)) {
			checkRecord(record, sources);
			checked.add(record);
		}
		return record;
	};

	const forms = usedForms(set);
	for (const form of forms) if (!isFormBound(form)) refuseFakeProverb("unsupported-form");
	const groups = new Map<string, Map<string, Group>>(forms.map((form) => [form, new Map()]));

	const nouns = groups.get("independent-noun");
	if (nouns) {
		for (const bucket of snapshot.projections.automaticBody.buckets) {
			for (const projected of bucket.surfaces) {
				let frequency = 0;
				const refs: ManualVocabularyCandidate[] = [];
				for (const ref of projected.candidates) {
					const record = records.get(ref.displayFormId);
					if (!record || record.candidateId !== ref.candidateId || record.automaticBodyKey !== bucket.key ||
						record.surface !== projected.surface) refuseFakeProverb("invalid-vocabulary");
					check(record);
					frequency = positive(frequency + record.frequency);
					refs.push(record);
				}
				if (frequency !== projected.frequency) refuseFakeProverb("invalid-vocabulary");
				// Fail-closed: a surface outside the safe text grammar is never placed.
				if (!isFakeProverbSafeText(projected.surface)) continue;
				for (const record of refs) {
					addToGroup(nouns, projected.surface, record.frequency, record.origins,
						{ kind: "record", candidateId: record.candidateId, displayFormId: record.displayFormId });
				}
			}
		}
	}

	const lexemeForms = forms.filter((form) => FORM_SPECS[form]!.slotClass !== "noun");
	if (lexemeForms.length > 0) {
		const lexemes = new Map<string, { slotClass: "verb" | "i-adjective"; input: MaxRealizerInput; records: ManualVocabularyCandidate[] }>();
		for (const record of snapshot.projections.manual.candidates) {
			const token = record.morphology;
			if (token.isUnknown) continue;
			const slotClass = maxSlotClassOf(token);
			if (!slotClass) continue;
			// Checked before any safety filter, so a rewritten record cannot hide by falling outside it.
			check(record);
			const input: MaxRealizerInput = { pos: token.pos, detail1: token.detail1, conjugationType: token.conjugationType, baseForm: token.baseForm, isUnknown: false };
			const lexemeId = maxLexemeIdentity(input);
			const entry = lexemes.get(lexemeId) ?? { slotClass, input, records: [] };
			entry.records.push(record);
			lexemes.set(lexemeId, entry);
		}
		for (const [lexemeId, entry] of [...lexemes].sort(([a], [b]) => compareText(a, b))) {
			const owned = [...entry.records].sort((a, b) => compareText(a.displayFormId, b.displayFormId));
			let frequency = 0;
			for (const record of owned) frequency = positive(frequency + record.frequency);
			const origins = mergeOrigins(owned.map((record) => record.origins));
			for (const form of lexemeForms) {
				// Irregular, unadmitted, malformed or unsafe: never a candidate.
				const realized = realizeFakeProverbForm(form, entry.input);
				if (realized === null) continue;
				addToGroup(groups.get(form)!, realized.surface, frequency, origins, {
					kind: "lexeme", lexemeId, conjugationType: entry.input.conjugationType, baseForm: entry.input.baseForm,
					realizerKey: realized.key, follower: realized.follower,
					records: owned.map((record) => ({ candidateId: record.candidateId, displayFormId: record.displayFormId })),
				});
			}
		}
	}

	return {
		policyVersion: FAKE_PROVERB_AUTHORITY_POLICY_VERSION,
		algorithmVersion: FAKE_PROVERB_ALGORITHM_VERSION,
		recipeSchemaVersion: set.schemaVersion,
		recipeDataVersion: set.dataVersion,
		provenance: {
			vocabularyFingerprint: snapshot.fingerprint,
			drawMode: snapshot.drawMode,
			sources: snapshot.sources.map((source) => ({ path: source.path, contentHash: source.contentHash, projectionPolicy: source.projectionPolicy })),
		},
		forms: forms.map((form) => ({
			form,
			candidates: [...groups.get(form)!.values()].sort((a, b) => compareText(a.surface, b.surface)).map((group) => ({
				candidateKey: JSON.stringify([form, group.surface]),
				form,
				surface: group.surface,
				frequency: group.frequency,
				origins: mergeOrigins(group.origins),
				evidence: group.evidence,
			})),
		})),
	};
}

// --- minting, inspection, release -------------------------------------------

function requireLiveOwner(value: unknown): ManualMorphVocabulary {
	if (value === null || typeof value !== "object" || !isManualMorphVocabulary(value as ManualMorphVocabulary)) {
		refuseFakeProverb("invalid-vocabulary");
	}
	const revoked = REVOKED.get(value);
	if (revoked) refuseFakeProverb(revoked);
	return value as ManualMorphVocabulary;
}

/**
 * Mints an authority from a genuine owner and a compiled recipe set. A raw or
 * cloned Snapshot, a look-alike owner, a Collision pool, a revoked owner, a
 * recompilation mismatch or an unbound form is refused whole and nothing is
 * minted.
 */
export function createFakeProverbAuthority(input: {
	readonly vocabulary: ManualMorphVocabulary;
	readonly recipeSet: CompiledFakeProverbRecipeSet;
}): FakeProverbAnswer<FakeProverbAuthority> {
	return guardFakeProverb(() => {
		const data = exactFields(input, ["vocabulary", "recipeSet"]);
		const owner = requireLiveOwner(data["vocabulary"]);
		const recipeSet = requireRecipeSet(data["recipeSet"]);
		const authority = freezeAnalysis<FakeProverbAuthority>(derive(owner, recipeSet));
		AUTHORITIES.set(authority, Object.freeze({ owner, recipeSet }));
		return authority;
	}, "invalid-vocabulary");
}

/**
 * Origin, liveness and recipe binding, and — for an audit — structure, in that
 * order. Shared with the core, which calls it on every generation.
 *
 * Structure is proven once, at mint: the authority *is* `derive()`'s output
 * for this owner and set, and all three are deeply frozen (the owner and its
 * Snapshot by `buildManualMorphVocabulary()`, the set by `requireRecipeSet()`,
 * the authority by `createFakeProverbAuthority()`), so a later re-derivation
 * cannot differ. Generation therefore skips it (PRE-RELEASE-FAKE-PROVERB-BATCH1:
 * it cost one full derivation per Generate), while origin, owner liveness and
 * binding are still checked on every call. `inspectFakeProverbAuthority()`
 * keeps the full re-derivation as an explicit audit.
 */
export function resolveFakeProverbAuthority(authority: unknown, recipeSet: unknown, audit = true): Binding {
	if (authority === null || typeof authority !== "object") refuseFakeProverb("invalid-authority");
	const binding = AUTHORITIES.get(authority);
	if (!binding) refuseFakeProverb("invalid-authority");
	requireLiveOwner(binding.owner);
	if (recipeSet !== binding.recipeSet) refuseFakeProverb("recipe-binding-mismatch");
	if (audit && JSON.stringify(derive(binding.owner, binding.recipeSet)) !== JSON.stringify(authority)) refuseFakeProverb("invalid-authority");
	return binding;
}

/**
 * The lightweight liveness check a batch owner runs immediately before commit:
 * origin, owner liveness and recipe binding, without re-derivation. Revocation
 * is owner-wide, so this refuses (`stale` / `released`) as soon as any holder of
 * the same Vocabulary owner has released it — including after a draft was
 * prepared from it.
 */
export function checkFakeProverbAuthorityLive(input: {
	readonly authority: FakeProverbAuthority;
	readonly recipeSet: CompiledFakeProverbRecipeSet;
}): FakeProverbAnswer<true> {
	return guardFakeProverb(() => {
		const data = exactFields(input, ["authority", "recipeSet"]);
		resolveFakeProverbAuthority(data["authority"], data["recipeSet"], false);
		return true as const;
	}, "invalid-authority");
}

export function inspectFakeProverbAuthority(input: {
	readonly authority: FakeProverbAuthority;
	readonly recipeSet: CompiledFakeProverbRecipeSet;
}): FakeProverbAnswer<true> {
	return guardFakeProverb(() => {
		const data = exactFields(input, ["authority", "recipeSet"]);
		resolveFakeProverbAuthority(data["authority"], data["recipeSet"]);
		return true as const;
	}, "invalid-authority");
}

/**
 * Revokes the authority's owner for Fake Proverb. Every authority minted from
 * that owner is refused afterwards (`stale` after a Source change, otherwise
 * `released`), and a new authority needs a freshly minted owner. Other
 * policies' use of the same owner is untouched.
 */
export function releaseFakeProverbAuthority(input: {
	readonly authority: FakeProverbAuthority;
	readonly reason: FakeProverbReleaseReason;
}): FakeProverbAnswer<true> {
	return guardFakeProverb(() => {
		const data = exactFields(input, ["authority", "reason"]);
		const authority = data["authority"];
		const binding = authority !== null && typeof authority === "object" ? AUTHORITIES.get(authority) : undefined;
		if (!binding) refuseFakeProverb("invalid-authority");
		revokeOwner(binding.owner, data["reason"]);
		return true as const;
	}, "invalid-authority");
}

function revokeOwner(owner: unknown, reason: unknown): void {
	if (!RELEASE_REASONS.includes(reason as string)) refuseFakeProverb("invalid-request");
	const live = requireLiveOwner(owner);
	REVOKED.set(live, reason === "source-changed" ? "stale" : "released");
}

/**
 * Revokes a Vocabulary owner for Fake Proverb without needing an authority
 * minted from it. A holder that has only begun a Generate with an owner — no
 * authority yet — uses this so that its Source change, close or dispose is
 * owner-wide exactly like a holder whose authority exists. Same effect and
 * refusals as `releaseFakeProverbAuthority()`.
 */
export function releaseFakeProverbOwner(input: {
	readonly vocabulary: ManualMorphVocabulary;
	readonly reason: FakeProverbReleaseReason;
}): FakeProverbAnswer<true> {
	return guardFakeProverb(() => {
		const data = exactFields(input, ["vocabulary", "reason"]);
		revokeOwner(data["vocabulary"], data["reason"]);
		return true as const;
	}, "invalid-vocabulary");
}
