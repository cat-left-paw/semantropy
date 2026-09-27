import { vocabularyCandidateId, vocabularyDisplayFormId, type VerifiedRubyVariant, type VocabularyOrigin } from "../analysis/rubyVocabulary";
import { classifyAdverbCandidate, type AdverbCandidateIdentity } from "../adverb/adverbFamily";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { sha256Hex } from "../vocabulary/sha256";
import type { ManualVocabularyCandidate, ProjectedVocabularySurface, VocabularySourceIdentity } from "../vocabulary/vocabularySnapshot";
import { MANUAL_MORPH_POLICY_VERSION, isManualMorphVocabulary, readManualMorphCandidateBuckets, readManualMorphVocabularySources,
	type ManualMorphCandidate, type ManualMorphVocabulary } from "./manualMorphology";
import { inspectManualAdverbOwner, type ManualAdverbAuthority } from "./manualAdverbAuthority";
import { compare, fields, frozen, guarded, refuse, safeSurface, type AutomaticPosAnswer } from "./automaticPosGuard";
import { MAX_REALIZER_RULES, MAX_TARGET_FORM_KEYS, maxLexemeIdentity, maxSlotClassOf, realizeMaxLexeme,
	type MaxRealizerInput, type MaxTargetFormKey } from "./maxRealizer";
import { MAX_BODY_ALGORITHM_VERSION, MAX_FINGERPRINT_VERSION, MAX_PROJECTION_VERSION, MAX_TRANSFORM_VERSION } from "./maxVersions";
export { MAX_BODY_ALGORITHM_VERSION, MAX_FINGERPRINT_VERSION, MAX_PROJECTION_VERSION, MAX_TRANSFORM_VERSION } from "./maxVersions";

/**
 * PRE-RELEASE-MAX-CORE1 Automatic Body projection 3. Production-disconnected.
 *
 * Minted only from a genuine Manual Morph Vocabulary owner and the Adverb
 * authority privately bound to that exact owner, like projection 2. It holds
 * the strict evidence Body 10 already uses, unchanged, and adds the evidence
 * High / MAX need, every piece re-derived here from the owner's own Snapshot:
 *
 *   - noun family: the union of the Snapshot's automatic-body buckets, nothing
 *     outside that projection (no pronoun, dependent noun, suffix or unknown);
 *   - verb / i-adjective lexemes: `[pos, detail1, conjugationType, baseForm]`,
 *     aggregating every contributing record once, with every candidate and
 *     display identity, observed (form, reading), origins, verified Ruby and the
 *     original token kept, plus the closed realizer's surface per key;
 *   - adverb family: every Source-derived regular-adverb record, observed or not.
 *
 * Authentication (private WeakMaps) and structure (re-derivation) are separate
 * questions. Neither a hash nor deep freezing stands in for either.
 */
type MorphBucket = NonNullable<ReturnType<typeof readManualMorphCandidateBuckets>>[number];
export type MaxLexemeRecord = {
	readonly candidateId: string;
	readonly displayFormId: string;
	readonly surface: string;
	readonly conjugationForm: string;
	readonly reading: string | null;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
	readonly verifiedRubyVariants: readonly VerifiedRubyVariant[];
	readonly morphology: JapaneseToken;
};
export type MaxLexeme = {
	readonly lexemeId: string;
	readonly slotClass: "verb" | "i-adjective";
	readonly input: MaxRealizerInput;
	readonly frequency: number;
	readonly origins: readonly VocabularyOrigin[];
	readonly records: readonly MaxLexemeRecord[];
	readonly realizations: readonly { readonly key: MaxTargetFormKey; readonly surface: string }[];
};
export type MaxAdverbRecord = { readonly identity: AdverbCandidateIdentity; readonly record: ManualVocabularyCandidate; readonly observed: boolean };
export type MaxProjection = {
	readonly policyVersion: typeof MAX_PROJECTION_VERSION;
	readonly transformVersion: typeof MAX_TRANSFORM_VERSION;
	readonly bodyAlgorithmVersion: typeof MAX_BODY_ALGORITHM_VERSION;
	readonly fingerprint: string;
	readonly sources: readonly VocabularySourceIdentity[];
	readonly drawMode: "uniform" | "frequency";
	readonly noun: { readonly strict: ManualMorphVocabulary["snapshot"]["projections"]["automaticBody"]["buckets"]; readonly family: readonly ProjectedVocabularySurface[] };
	readonly verb: { readonly strict: readonly MorphBucket[]; readonly lexemes: readonly MaxLexeme[] };
	readonly iAdjective: { readonly strict: readonly MorphBucket[]; readonly lexemes: readonly MaxLexeme[] };
	readonly adverb: { readonly strict: ManualAdverbAuthority["candidates"]; readonly family: readonly MaxAdverbRecord[];
		readonly evidence: ManualAdverbAuthority["observations"]["entries"]; readonly bridgeProfile: ManualAdverbAuthority["bridgeProfile"] };
	readonly realizerRules: typeof MAX_REALIZER_RULES;
};
type Ownership = { readonly vocabulary: ManualMorphVocabulary; readonly authority: ManualAdverbAuthority };
const PROJECTIONS = new WeakMap<MaxProjection, Ownership>();
const OWNERS = new WeakMap<ManualMorphVocabulary, MaxProjection>();
const REVOKED = new WeakMap<ManualMorphVocabulary, "stale" | "released">();
export type MaxReleaseReason = "source-changed" | "refresh" | "apply" | "view-close" | "plugin-disable";
const RELEASE_REASONS: readonly string[] = ["source-changed", "refresh", "apply", "view-close", "plugin-disable"];

/** Read-only seam shared with maxCore. Its own revocation registry: projection 2 is untouched. */
export function requireMaxOwner(value: unknown): ManualMorphVocabulary {
	if (!isManualMorphVocabulary(value as ManualMorphVocabulary)) refuse("invalid-owner");
	const owner = value as ManualMorphVocabulary, revoked = REVOKED.get(owner);
	if (revoked) refuse(revoked);
	return owner;
}
function checkBinding(vocabulary: ManualMorphVocabulary, authority: ManualAdverbAuthority) {
	const result = inspectManualAdverbOwner({ authority, vocabulary });
	if (!result.ok) refuse(result.reason === "released" ? "released" : "provenance-mismatch");
}
export function resolveMaxProjection(value: MaxProjection): Ownership {
	const state = PROJECTIONS.get(value); if (!state) refuse("invalid-projection");
	requireMaxOwner(state.vocabulary); checkBinding(state.vocabulary, state.authority);
	return state;
}
export function releaseMaxOwner(input: { vocabulary: ManualMorphVocabulary; reason: MaxReleaseReason }): AutomaticPosAnswer<true> {
	return guarded(() => {
		const data = fields(input, ["vocabulary", "reason"]), vocabulary = requireMaxOwner(data.vocabulary);
		if (!RELEASE_REASONS.includes(data.reason as string)) refuse("invalid-request");
		REVOKED.set(vocabulary, data.reason === "source-changed" ? "stale" : "released");
		OWNERS.delete(vocabulary);
		return true;
	});
}

const sourceKey = (source: { path: string; contentHash: string }) => JSON.stringify([source.path, source.contentHash]);
const count = (value: number) => { if (!Number.isSafeInteger(value) || value < 1) refuse("invalid-projection"); return value; };
function mergeOrigins(lists: readonly (readonly VocabularyOrigin[])[]): VocabularyOrigin[] {
	const merged = new Map<string, VocabularyOrigin>();
	for (const list of lists) for (const origin of list) {
		const key = sourceKey(origin), previous = merged.get(key);
		merged.set(key, { path: origin.path, contentHash: origin.contentHash, count: count((previous?.count ?? 0) + origin.count) });
	}
	return [...merged.entries()].sort(([a], [b]) => compare(a, b)).map(([, origin]) => origin);
}

/**
 * Independent provenance check of one Snapshot record: identity re-minted from
 * its own token, origins inside the recorded Sources and summing to its
 * frequency, Ruby variants inside its own surface and its own origins.
 */
function checkRecord(record: ManualVocabularyCandidate, sources: ReadonlySet<string>) {
	if (!safeSurface(record.surface) || record.surface !== record.morphology.surface || record.morphology.isUnknown) refuse("invalid-projection");
	if (record.candidateId !== vocabularyCandidateId(record.morphology) ||
		record.displayFormId !== vocabularyDisplayFormId(record.candidateId, record.surface)) refuse("invalid-projection");
	const origins = checkOrigins(record.origins, sources);
	if (count(record.frequency) !== origins) refuse("invalid-projection");
	const recordSources = new Set(record.origins.map(sourceKey));
	for (const variant of record.verifiedRubyVariants) {
		const { start, end } = variant.baseRangeInSurface;
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > record.surface.length || start >= end ||
			typeof variant.reading !== "string") refuse("invalid-projection");
		// Re-minted with the Vocabulary's own formula (verifiedVariantForToken): display form, base, reading and range all agree.
		if (variant.variantId !== JSON.stringify([record.displayFormId, record.surface.slice(start, end).normalize("NFC"),
			variant.reading.normalize("NFC"), start, end])) refuse("invalid-projection");
		if (checkOrigins(variant.origins, recordSources) !== count(variant.frequency)) refuse("invalid-projection");
	}
}
function checkOrigins(origins: readonly VocabularyOrigin[], sources: ReadonlySet<string>): number {
	const seen = new Set<string>(); let total = 0;
	for (const origin of origins) {
		const key = sourceKey(origin);
		if (!sources.has(key)) refuse("provenance-mismatch");
		if (seen.has(key)) refuse("invalid-projection");
		seen.add(key); total = count(total + count(origin.count));
	}
	return total;
}
const sameCandidate = (a: ManualMorphCandidate, b: ManualVocabularyCandidate) => a.candidateId === b.candidateId && a.surface === b.surface &&
	a.frequency === b.frequency && JSON.stringify(a.origins) === JSON.stringify(b.origins) &&
	JSON.stringify(a.verifiedRubyVariants) === JSON.stringify(b.verifiedRubyVariants);

type Content = Omit<MaxProjection, "fingerprint">;
/** Pure re-derivation from the owner's Snapshot and authority. Creation and inspection both run it. */
function derive(vocabulary: ManualMorphVocabulary, authority: ManualAdverbAuthority): Content {
	const snapshot = vocabulary.snapshot;
	const analyses = readManualMorphVocabularySources(vocabulary), morph = readManualMorphCandidateBuckets(vocabulary);
	if (!analyses || !morph) refuse("invalid-projection");
	const expected = new Set(snapshot.sources.map(source => JSON.stringify(source)));
	const seen = new Set<string>();
	for (const analysis of analyses) {
		if (!expected.has(JSON.stringify(analysis.source))) refuse("provenance-mismatch");
		seen.add(JSON.stringify(analysis.source));
	}
	if (seen.size !== expected.size) refuse("provenance-mismatch");
	const sources = new Set(snapshot.sources.map(sourceKey));
	const records = new Map(snapshot.projections.manual.candidates.map(record => [record.displayFormId, record]));
	const checked = new Set<ManualVocabularyCandidate>();
	const check = (record: ManualVocabularyCandidate) => { if (!checked.has(record)) { checkRecord(record, sources); checked.add(record); } return record; };
	const original = (record: ManualMorphCandidate) => {
		const found = records.get(record.displayFormId);
		if (!found || !sameCandidate(record, found)) refuse("invalid-projection");
		return check(found);
	};
	// Strict evidence: exactly Body 10's, cross-checked against the Snapshot record by record.
	for (const bucket of morph) for (const record of bucket.candidates) original(record);
	for (const item of authority.candidates) { if (item.record !== records.get(item.record.displayFormId)) refuse("invalid-projection"); check(item.record); }
	const family = new Map<string, { surface: string; frequency: number; origins: (readonly VocabularyOrigin[])[]; candidates: { candidateId: string; displayFormId: string }[] }>();
	for (const bucket of snapshot.projections.automaticBody.buckets) for (const surface of bucket.surfaces) {
		let frequency = 0;
		const group = family.get(surface.surface) ?? { surface: surface.surface, frequency: 0, origins: [], candidates: [] };
		for (const ref of surface.candidates) {
			const record = records.get(ref.displayFormId);
			if (!record || record.candidateId !== ref.candidateId || record.automaticBodyKey !== bucket.key || record.surface !== surface.surface) refuse("invalid-projection");
			check(record); frequency = count(frequency + record.frequency);
			group.frequency = count(group.frequency + record.frequency); group.origins.push(record.origins);
			group.candidates.push({ candidateId: record.candidateId, displayFormId: record.displayFormId });
		}
		if (frequency !== surface.frequency) refuse("invalid-projection");
		family.set(group.surface, group);
	}
	const nounFamily = [...family.values()].sort((a, b) => compare(a.surface, b.surface)).map(group => ({ surface: group.surface,
		frequency: group.frequency, origins: mergeOrigins(group.origins),
		candidates: group.candidates.sort((a, b) => compare(a.displayFormId, b.displayFormId)) }));
	// Lexemes: every known independent verb / i-adjective record, aggregated once per record.
	const byLexeme = new Map<string, { slotClass: "verb" | "i-adjective"; input: MaxRealizerInput; records: ManualVocabularyCandidate[] }>();
	const adverbs: MaxAdverbRecord[] = [];
	for (const record of snapshot.projections.manual.candidates) {
		const token = record.morphology;
		if (token.isUnknown) continue;
		const slotClass = maxSlotClassOf(token);
		if (slotClass) {
			// Every record is checked before the safe-set filter, so a rewritten record cannot hide by falling outside it.
			check(record);
			const input = { pos: token.pos, detail1: token.detail1, conjugationType: token.conjugationType, baseForm: token.baseForm, isUnknown: false };
			const id = maxLexemeIdentity(input), entry = byLexeme.get(id) ?? { slotClass, input, records: [] };
			entry.records.push(record); byLexeme.set(id, entry);
			continue;
		}
		const adverb = classifyAdverbCandidate(token);
		if (!adverb.supported) continue;
		check(record);
		if (adverb.identity.identityKey !== record.candidateId) refuse("invalid-projection");
		const observed = authority.observations.lookup(record.candidateId);
		if (observed && JSON.stringify(observed.identity) !== JSON.stringify(adverb.identity)) refuse("invalid-projection");
		adverbs.push({ identity: adverb.identity, record, observed: observed !== null });
	}
	adverbs.sort((a, b) => compare(a.record.displayFormId, b.record.displayFormId));
	const familyIds = new Set(adverbs.map(item => item.record.displayFormId));
	for (const item of authority.candidates) if (!familyIds.has(item.record.displayFormId)) refuse("invalid-projection");
	const lexemes: MaxLexeme[] = [];
	for (const [lexemeId, entry] of [...byLexeme].sort(([a], [b]) => compare(a, b))) {
		const realizations = MAX_TARGET_FORM_KEYS.flatMap(key => {
			const realized = realizeMaxLexeme(key, entry.input);
			return realized.realized ? [{ key, surface: realized.surface }] : [];
		});
		// Outside the safe set (irregular, unadmitted class, missing field): never a High / MAX candidate.
		if (!realizations.length) continue;
		const owned = entry.records.map(check).sort((a, b) => compare(a.displayFormId, b.displayFormId));
		let frequency = 0;
		for (const record of owned) frequency = count(frequency + record.frequency);
		lexemes.push({ lexemeId, slotClass: entry.slotClass, input: entry.input, frequency,
			origins: mergeOrigins(owned.map(record => record.origins)), realizations,
			records: owned.map(record => ({ candidateId: record.candidateId, displayFormId: record.displayFormId, surface: record.surface,
				conjugationForm: record.morphology.conjugationForm, reading: record.morphology.reading ?? null, frequency: record.frequency,
				origins: record.origins, verifiedRubyVariants: record.verifiedRubyVariants, morphology: record.morphology })) });
	}
	return { policyVersion: MAX_PROJECTION_VERSION, transformVersion: MAX_TRANSFORM_VERSION, bodyAlgorithmVersion: MAX_BODY_ALGORITHM_VERSION,
		sources: snapshot.sources, drawMode: snapshot.drawMode,
		noun: { strict: snapshot.projections.automaticBody.buckets, family: nounFamily },
		verb: { strict: morph.filter(bucket => bucket.slotClass === "verb").sort((a, b) => compare(a.key, b.key)), lexemes: lexemes.filter(item => item.slotClass === "verb") },
		iAdjective: { strict: morph.filter(bucket => bucket.slotClass === "i-adjective").sort((a, b) => compare(a.key, b.key)), lexemes: lexemes.filter(item => item.slotClass === "i-adjective") },
		adverb: { strict: authority.candidates, family: adverbs, evidence: authority.observations.entries, bridgeProfile: authority.bridgeProfile },
		realizerRules: MAX_REALIZER_RULES };
}
/** Format 3: a new envelope over the original Vocabulary fingerprint and every rule and evidence High / MAX read. */
function fingerprintOf(vocabulary: ManualMorphVocabulary, authority: ManualAdverbAuthority, content: Content): string {
	const sources = [...content.sources].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
	return `${MAX_FINGERPRINT_VERSION}:${sha256Hex(JSON.stringify([
		MAX_PROJECTION_VERSION, MAX_TRANSFORM_VERSION, MAX_BODY_ALGORITHM_VERSION, vocabulary.snapshot.fingerprint,
		sources, content.drawMode, MANUAL_MORPH_POLICY_VERSION, authority.policyVersion, content.realizerRules,
		authority.bridgeProfile, content.adverb.evidence, content.verb, content.iAdjective, content.noun.family,
		content.adverb.family.map(item => [item.record.displayFormId, item.observed]),
	]))}`;
}

export function createMaxProjection(input: { vocabulary: ManualMorphVocabulary; adverbAuthority: ManualAdverbAuthority }): AutomaticPosAnswer<MaxProjection> {
	return guarded(() => {
		const data = fields(input, ["vocabulary", "adverbAuthority"]);
		const vocabulary = requireMaxOwner(data.vocabulary), authority = data.adverbAuthority as ManualAdverbAuthority;
		checkBinding(vocabulary, authority);
		const previous = OWNERS.get(vocabulary); if (previous) { resolveMaxProjection(previous); return previous; }
		const content = derive(vocabulary, authority);
		const projection: MaxProjection = frozen({ ...content, fingerprint: fingerprintOf(vocabulary, authority, content) });
		requireMaxOwner(vocabulary); checkBinding(vocabulary, authority);
		PROJECTIONS.set(projection, Object.freeze({ vocabulary, authority })); OWNERS.set(vocabulary, projection);
		return projection;
	});
}
/** Origin (private mint, live owner) and structure (a fresh re-derivation reproduces it exactly), separately. */
export function inspectMaxProjection(input: { projection: MaxProjection }): AutomaticPosAnswer<true> {
	return guarded(() => {
		const projection = fields(input, ["projection"]).projection as MaxProjection;
		const { vocabulary, authority } = resolveMaxProjection(projection);
		const content = derive(vocabulary, authority);
		if (fingerprintOf(vocabulary, authority, content) !== projection.fingerprint ||
			JSON.stringify({ ...content, fingerprint: projection.fingerprint }) !== JSON.stringify(projection)) refuse("invalid-projection");
		return true;
	});
}
