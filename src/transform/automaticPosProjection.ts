import type { VocabularySourceIdentity } from "../vocabulary/vocabularySnapshot";
import { sha256Hex } from "../vocabulary/sha256";
import { isManualMorphVocabulary, readManualMorphCandidateBuckets, readManualMorphVocabularySources,
	type ManualMorphVocabulary, type ManualMorphCandidate } from "./manualMorphology";
import { inspectManualAdverbOwner, type ManualAdverbAuthority } from "./manualAdverbAuthority";
import { compare, fields, frozen, guarded, refuse, safeSurface, type AutomaticPosAnswer } from "./automaticPosGuard";

import { AUTOMATIC_POS_PROJECTION_VERSION,
	AUTOMATIC_POS_TRANSFORM_VERSION, AUTOMATIC_POS_FINGERPRINT_VERSION } from "./automaticPosVersions";
export { AUTOMATIC_POS_BODY_ALGORITHM_VERSION, AUTOMATIC_POS_PROJECTION_VERSION,
	AUTOMATIC_POS_TRANSFORM_VERSION, AUTOMATIC_POS_FINGERPRINT_VERSION } from "./automaticPosVersions";
type MorphBucket = NonNullable<ReturnType<typeof readManualMorphCandidateBuckets>>[number];
export type AutomaticPosProjection = {
	readonly policyVersion: typeof AUTOMATIC_POS_PROJECTION_VERSION;
	readonly fingerprint: string;
	readonly sources: readonly VocabularySourceIdentity[];
	readonly drawMode: "uniform" | "frequency";
	readonly noun: ManualMorphVocabulary["snapshot"]["projections"]["automaticBody"]["buckets"];
	readonly verb: readonly MorphBucket[];
	readonly iAdjective: readonly MorphBucket[];
	readonly adverb: ManualAdverbAuthority["candidates"];
	readonly adverbEvidence: ManualAdverbAuthority["observations"]["entries"];
	readonly bridgeProfile: ManualAdverbAuthority["bridgeProfile"];
};
type Ownership = { readonly vocabulary: ManualMorphVocabulary; readonly authority: ManualAdverbAuthority };
const PROJECTIONS = new WeakMap<AutomaticPosProjection, Ownership>();
const OWNERS = new WeakMap<ManualMorphVocabulary, AutomaticPosProjection>();
const REVOKED = new WeakMap<ManualMorphVocabulary, "stale" | "released">();
export type AutomaticPosReleaseReason = "source-changed" | "refresh" | "apply" | "view-close" | "plugin-disable";

/** Internal read-only seam shared with the generation module. No mutable registry escapes. */
export function requireAutomaticPosOwner(value: unknown): ManualMorphVocabulary {
	if (!isManualMorphVocabulary(value as ManualMorphVocabulary)) refuse("invalid-owner");
	const owner = value as ManualMorphVocabulary;
	const revoked = REVOKED.get(owner); if (revoked) refuse(revoked);
	return owner;
}
function checkBinding(vocabulary: ManualMorphVocabulary, authority: ManualAdverbAuthority) {
	const result = inspectManualAdverbOwner({ authority, vocabulary });
	if (!result.ok) refuse(result.reason === "released" ? "released" : "provenance-mismatch");
}
/** Resolve only a minted projection. The returned ownership pair is frozen. */
export function resolveAutomaticPosProjection(value: AutomaticPosProjection): Ownership {
	const state = PROJECTIONS.get(value); if (!state) refuse("invalid-projection");
	requireAutomaticPosOwner(state.vocabulary); checkBinding(state.vocabulary, state.authority);
	return state;
}
export function releaseAutomaticPosOwner(input: { vocabulary: ManualMorphVocabulary; reason: AutomaticPosReleaseReason }): AutomaticPosAnswer<true> {
	return guarded(() => {
		const data = fields(input, ["vocabulary", "reason"]), vocabulary = requireAutomaticPosOwner(data.vocabulary);
		if (!["source-changed", "refresh", "apply", "view-close", "plugin-disable"].includes(data.reason as string)) refuse("invalid-request");
		REVOKED.set(vocabulary, data.reason === "source-changed" ? "stale" : "released");
		OWNERS.delete(vocabulary);
		return true;
	});
}

/** Independent structural/provenance check after authentication; no grammar rules here. */
function validateCandidate(record: ManualMorphCandidate, vocabulary: ManualMorphVocabulary) {
	if (!safeSurface(record.surface) || !Number.isSafeInteger(record.frequency) || record.frequency < 1) refuse("invalid-projection");
	let total = 0;
	const seen = new Set<string>();
	for (const origin of record.origins) {
		if (!vocabulary.snapshot.sources.some(source => source.path === origin.path && source.contentHash === origin.contentHash)) refuse("provenance-mismatch");
		const key = JSON.stringify([origin.path, origin.contentHash]);
		if (seen.has(key) || !Number.isSafeInteger(origin.count) || origin.count < 1) refuse("invalid-projection");
		seen.add(key); total += origin.count;
	}
	if (total !== record.frequency) refuse("invalid-projection");
}

export function createAutomaticPosProjection(input: { vocabulary: ManualMorphVocabulary; adverbAuthority: ManualAdverbAuthority }): AutomaticPosAnswer<AutomaticPosProjection> {
	return guarded(() => {
		const data = fields(input, ["vocabulary", "adverbAuthority"]);
		const vocabulary = requireAutomaticPosOwner(data.vocabulary), authority = data.adverbAuthority as ManualAdverbAuthority;
		checkBinding(vocabulary, authority);
		const previous = OWNERS.get(vocabulary); if (previous) { resolveAutomaticPosProjection(previous); return previous; }
		const sources = readManualMorphVocabularySources(vocabulary), morph = readManualMorphCandidateBuckets(vocabulary);
		if (!sources || !morph) refuse("invalid-projection");
		const seen = new Set<string>();
		for (const source of sources) {
			const identity = source.source;
			if (!vocabulary.snapshot.sources.some(item => JSON.stringify(item) === JSON.stringify(identity))) refuse("provenance-mismatch");
			seen.add(JSON.stringify(identity));
		}
		if (seen.size !== vocabulary.snapshot.sources.length) refuse("provenance-mismatch");
		const records = new Map(vocabulary.snapshot.projections.manual.candidates.map(record => [record.displayFormId, record]));
		const check = (record: ManualMorphCandidate) => {
			validateCandidate(record, vocabulary);
			const original = records.get(record.displayFormId);
			if (!original || original.morphology.isUnknown || record.candidateId !== original.candidateId ||
				record.surface !== original.surface || record.frequency !== original.frequency ||
				JSON.stringify(record.origins) !== JSON.stringify(original.origins) ||
				JSON.stringify(record.verifiedRubyVariants) !== JSON.stringify(original.verifiedRubyVariants)) refuse("invalid-projection");
		};
		for (const bucket of morph) for (const record of bucket.candidates) check(record);
		for (const item of authority.candidates) check(item.record);
		for (const bucket of vocabulary.snapshot.projections.automaticBody.buckets) for (const surface of bucket.surfaces) {
			let frequency = 0;
			for (const ref of surface.candidates) {
				const record = records.get(ref.displayFormId); if (!record || record.candidateId !== ref.candidateId || record.automaticBodyKey !== bucket.key || record.surface !== surface.surface) refuse("invalid-projection");
				check(record); frequency += record.frequency;
			}
			if (frequency !== surface.frequency) refuse("invalid-projection");
		}
		const verb = morph.filter(bucket => bucket.slotClass === "verb").sort((a, b) => compare(a.key, b.key));
		const iAdjective = morph.filter(bucket => bucket.slotClass === "i-adjective").sort((a, b) => compare(a.key, b.key));
		const fingerprint = `${AUTOMATIC_POS_FINGERPRINT_VERSION}:${sha256Hex(JSON.stringify([
			AUTOMATIC_POS_PROJECTION_VERSION, AUTOMATIC_POS_TRANSFORM_VERSION, vocabulary.snapshot.fingerprint,
			verb, iAdjective, authority.policyVersion, authority.bridgeProfile, authority.observations.entries,
		]))}`;
		const projection: AutomaticPosProjection = frozen({ policyVersion: AUTOMATIC_POS_PROJECTION_VERSION, fingerprint,
			sources: vocabulary.snapshot.sources, drawMode: vocabulary.snapshot.drawMode,
			noun: vocabulary.snapshot.projections.automaticBody.buckets, verb, iAdjective,
			adverb: authority.candidates, adverbEvidence: authority.observations.entries, bridgeProfile: authority.bridgeProfile });
		requireAutomaticPosOwner(vocabulary); checkBinding(vocabulary, authority);
		PROJECTIONS.set(projection, Object.freeze({ vocabulary, authority })); OWNERS.set(vocabulary, projection);
		return projection;
	});
}
