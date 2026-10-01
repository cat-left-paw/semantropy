import type { LocatedAnalysisRun } from "../analysis/locateTokens";
import { vocabularyDisplayFormId } from "../analysis/rubyVocabulary";
import { classifyAdverbCandidate, type AdverbCandidateIdentity } from "../adverb/adverbFamily";
import { buildAdverbObservationIndex, observeAdverbSlot, type AdverbObservationIndex } from "../adverb/adverbObservation";
import { adverbBridgeCapabilities, evaluateAdverbCandidate } from "../adverb/adverbCapability";
import { TO_OPTIONAL_ADVERB_BRIDGE_PROFILE } from "../adverb/adverbBridgeProfile";
import { createSeededRandom } from "../random/seededRandom";
import { sha256Hex } from "../vocabulary/sha256";
import { drawWeight, sourceWeightLookup } from "../vocabulary/sourceWeights";
import type { ManualVocabularyCandidate, VocabularySourceIdentity } from "../vocabulary/vocabularySnapshot";
import { isManualMorphVocabulary, readManualMorphVocabularySources, type ManualMorphVocabulary, type ManualMorphSourceAnalysis } from "./manualMorphology";
import { count, fields, frozen, guarded, refuse, text, type ManualAdverbReason, type ManualAdverbResult } from "./manualAdverbGuard";

/** Isolated policy: the production manual-morph-2 export is unchanged. */
export const MANUAL_ADVERB_POLICY_VERSION = "manual-morph-3";
export type ManualAdverbCandidate = {
	readonly identity: AdverbCandidateIdentity;
	readonly record: ManualVocabularyCandidate;
};
export type ManualAdverbAuthority = {
	readonly policyVersion: typeof MANUAL_ADVERB_POLICY_VERSION;
	readonly bridgeProfile: typeof TO_OPTIONAL_ADVERB_BRIDGE_PROFILE;
	readonly provenance: { readonly fingerprint: string; readonly sources: readonly VocabularySourceIdentity[]; readonly drawMode: "uniform" | "frequency" };
	readonly candidates: readonly ManualAdverbCandidate[];
	readonly observations: AdverbObservationIndex;
};
export type ManualAdverbSlot = { readonly tokenId: string; readonly originalSurface: string };
export type ManualAdverbDiagnostic = {
	readonly available: boolean;
	readonly reason: ManualAdverbReason | null;
	readonly alternativeSurfaceCount: number;
};
export type ManualAdverbEvaluation = {
	readonly diagnostic: ManualAdverbDiagnostic;
	readonly alternatives: readonly { readonly surface: string; readonly frequency: number; readonly candidates: readonly ManualAdverbCandidate[] }[];
};
export type ManualAdverbReleaseReason = "source-changed" | "refresh" | "apply" | "view-close" | "plugin-disable";
type PreparedRun = ReturnType<typeof observationRun>;
type AuthorityState = { vocabulary: ManualMorphVocabulary; candidates: Set<ManualAdverbCandidate>;
	slots: Set<ManualAdverbSlot>; slotCache: WeakMap<ManualMorphVocabulary, Map<string, Map<number, ManualAdverbSlot>>>;
	runs: WeakMap<LocatedAnalysisRun, PreparedRun> };
type SlotState = { authority: ManualAdverbAuthority; targetVocabulary: ManualMorphVocabulary; run: PreparedRun; index: number };
const AUTHORITIES = new WeakMap<ManualAdverbAuthority, AuthorityState>();
const OWNERS = new WeakMap<ManualMorphVocabulary, ManualAdverbAuthority>();
const RELEASED = new WeakSet<ManualAdverbAuthority>();
const REVOKED = new WeakSet<ManualMorphVocabulary>();
const SLOTS = new WeakMap<ManualAdverbSlot, SlotState>();
const EVALUATIONS = new WeakMap<ManualAdverbEvaluation, { authority: ManualAdverbAuthority; slot: ManualAdverbSlot }>();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sourceKey = (source: { path: string; contentHash: string }) => JSON.stringify([source.path, source.contentHash]);

/** Ruby edges are observation barriers, including edges inside a token. No grammar lives here. */
function observationRun(located: LocatedAnalysisRun) {
	const edges = located.run.annotations.flatMap(annotation => [annotation.baseRange.start, annotation.baseRange.end]);
	const barriers = new Set<number>();
	for (let i = 0; i < located.tokens.length; i++) {
		const { range } = located.tokens[i]!;
		for (const edge of edges) {
			if (edge === range.start) barriers.add(i);
			if (edge > range.start && edge < range.end) { barriers.add(i); barriers.add(i + 1); }
			if (edge === range.end) barriers.add(i + 1);
		}
	}
	return frozen({ tokens: located.tokens.map(item => item.token), barriers: [...barriers].sort((a, b) => a - b) });
}
function owner(value: unknown): ManualMorphVocabulary {
	if (!isManualMorphVocabulary(value as ManualMorphVocabulary)) refuse("invalid-vocabulary");
	const vocabulary = value as ManualMorphVocabulary;
	if (REVOKED.has(vocabulary)) refuse("released");
	return vocabulary;
}
function authority(value: unknown): ManualAdverbAuthority {
	const handle = value as ManualAdverbAuthority;
	if (RELEASED.has(handle)) refuse("released");
	if (!AUTHORITIES.has(handle)) refuse("invalid-authority");
	return handle;
}
function slotState(handle: ManualAdverbAuthority, value: unknown): SlotState {
	const state = SLOTS.get(value as ManualAdverbSlot);
	if (!state || state.authority !== handle) refuse("invalid-slot");
	owner(state.targetVocabulary);
	return state;
}
function candidate(handle: ManualAdverbAuthority, value: unknown): ManualAdverbCandidate {
	if (!AUTHORITIES.get(handle)!.candidates.has(value as ManualAdverbCandidate)) refuse("invalid-candidate");
	return value as ManualAdverbCandidate;
}

/** Authentication precedes structure. Publication occurs only after every record and origin agrees. */
export function createManualAdverbAuthority(input: { vocabulary: ManualMorphVocabulary }): ManualAdverbResult<ManualAdverbAuthority> {
	return guarded(() => {
		const vocabulary = owner(fields(input, ["vocabulary"]).vocabulary);
		const previous = OWNERS.get(vocabulary); if (previous) return authority(previous);
		const sources = readManualMorphVocabularySources(vocabulary);
		if (!sources) refuse("invalid-evidence");
		const expected = new Map(vocabulary.snapshot.sources.map(source => [sourceKey(source), source]));
		const seen = new Set<string>();
		const runs: PreparedRun[] = [];
		const observedRecords = new Map<string, { frequency: number; origins: Map<string, number> }>();
		for (const source of sources) {
			const key = sourceKey(source.source);
			if (expected.get(key)?.projectionPolicy !== source.source.projectionPolicy) refuse("invalid-evidence");
			if (seen.has(key)) continue;
			seen.add(key);
			for (const located of source.runs) {
				runs.push(observationRun(located));
				for (const item of located.tokens) {
					const classified = classifyAdverbCandidate(item.token); if (!classified.supported) continue;
					const id = vocabularyDisplayFormId(classified.identity.identityKey, item.token.surface);
					const record = observedRecords.get(id) ?? { frequency: 0, origins: new Map<string, number>() };
					record.frequency = count(record.frequency + 1);
					record.origins.set(key, count((record.origins.get(key) ?? 0) + 1));
					observedRecords.set(id, record);
				}
			}
		}
		if (seen.size !== expected.size) refuse("invalid-evidence");
		const observations = buildAdverbObservationIndex(runs);
		const candidates: ManualAdverbCandidate[] = [];
		for (const record of vocabulary.snapshot.projections.manual.candidates) {
			const classified = classifyAdverbCandidate(record.morphology); if (!classified.supported) continue;
			const observed = observedRecords.get(record.displayFormId);
			if (!observed || classified.identity.identityKey !== record.candidateId || record.surface !== record.morphology.surface ||
				observed.frequency !== record.frequency || observed.origins.size !== record.origins.length) refuse("invalid-evidence");
			const originKeys = new Set<string>();
			for (const origin of record.origins) {
				if (originKeys.has(sourceKey(origin))) refuse("invalid-evidence");
				originKeys.add(sourceKey(origin));
				if (!expected.has(sourceKey(origin)) || observed.origins.get(sourceKey(origin)) !== origin.count) refuse("invalid-evidence");
			}
			observedRecords.delete(record.displayFormId);
			const entry = observations.lookup(record.candidateId);
			if (entry && JSON.stringify(entry.identity) !== JSON.stringify(classified.identity)) refuse("invalid-evidence");
			if (entry) candidates.push({ identity: entry.identity, record });
		}
		if (observedRecords.size !== 0) refuse("invalid-evidence");
		candidates.sort((a, b) => compare(a.record.displayFormId, b.record.displayFormId));
		const handle: ManualAdverbAuthority = frozen({ policyVersion: MANUAL_ADVERB_POLICY_VERSION,
			bridgeProfile: TO_OPTIONAL_ADVERB_BRIDGE_PROFILE, observations, candidates,
			provenance: { fingerprint: vocabulary.snapshot.fingerprint, sources: vocabulary.snapshot.sources, drawMode: vocabulary.snapshot.drawMode } });
		owner(vocabulary);
		AUTHORITIES.set(handle, { vocabulary, candidates: new Set(candidates), slots: new Set(), slotCache: new WeakMap(), runs: new WeakMap() });
		OWNERS.set(vocabulary, handle);
		return handle;
	});
}

/** Target handles also come from the existing analyzed-owner chain; raw runs are never accepted. */
export function bindManualAdverbSlot(input: { authority: ManualAdverbAuthority; targetVocabulary: ManualMorphVocabulary;
	source: ManualMorphSourceAnalysis; runId: string; tokenIndex: number }): ManualAdverbResult<ManualAdverbSlot> {
	return guarded(() => {
		const data = fields(input, ["authority", "targetVocabulary", "source", "runId", "tokenIndex"]);
		const handle = authority(data.authority), vocabulary = owner(data.targetVocabulary);
		const source = readManualMorphVocabularySources(vocabulary)?.find(item => item.analysis === data.source);
		const located = source?.runs.find(item => item.run.runId === text(data.runId));
		if (!source || !located || !Number.isSafeInteger(data.tokenIndex) || (data.tokenIndex as number) < 0) refuse("invalid-slot");
		const index = data.tokenIndex as number, token = located.tokens[index]; if (!token) refuse("invalid-slot");
		const state = AUTHORITIES.get(handle)!;
		// Authenticated analyses of the same Source share logical slots within this Target owner.
		// Source identity is essential: run/token coordinates repeat in different notes.
		const runKey = JSON.stringify([source.source.path, source.source.contentHash, source.source.projectionPolicy, located.run.runId]);
		const byRun = state.slotCache.get(vocabulary) ?? new Map<string, Map<number, ManualAdverbSlot>>();
		const byIndex = byRun.get(runKey) ?? new Map<number, ManualAdverbSlot>();
		const existing = byIndex.get(index); if (existing) return existing;
		const run = state.runs.get(located) ?? observationRun(located);
		const slot = frozen({ tokenId: token.tokenId, originalSurface: token.token.surface });
		SLOTS.set(slot, { authority: handle, targetVocabulary: vocabulary, run, index });
		byIndex.set(index, slot); byRun.set(runKey, byIndex); state.slotCache.set(vocabulary, byRun);
		state.runs.set(located, run); state.slots.add(slot);
		return slot;
	});
}
export function evaluateManualAdverbCandidate(input: { authority: ManualAdverbAuthority; slot: ManualAdverbSlot; candidate: ManualAdverbCandidate }) {
	return guarded(() => {
		const data = fields(input, ["authority", "slot", "candidate"]), handle = authority(data.authority);
		const state = slotState(handle, data.slot), selected = candidate(handle, data.candidate);
		return evaluateAdverbCandidate({ index: handle.observations, targetTokens: state.run.tokens,
			targetIndex: state.index, targetBarriers: state.run.barriers, candidate: selected.identity });
	});
}
/** Read-only observed context for policy consumers' memoization. No caller token/profile is accepted. */
export function readManualAdverbSlotContext(input: { authority: ManualAdverbAuthority; slot: ManualAdverbSlot }) {
	return guarded(() => {
		const data = fields(input, ["authority", "slot"]), handle = authority(data.authority);
		const state = slotState(handle, data.slot);
		return frozen(observeAdverbSlot({ ...state.run, index: state.index }));
	});
}
export function manualAdverbCapabilities(input: { authority: ManualAdverbAuthority; slot: ManualAdverbSlot; candidate: ManualAdverbCandidate }) {
	return guarded(() => {
		const data = fields(input, ["authority", "slot", "candidate"]), handle = authority(data.authority);
		const state = slotState(handle, data.slot), selected = candidate(handle, data.candidate);
		const observed = observeAdverbSlot({ ...state.run, index: state.index });
		if (!observed.supported) refuse(observed.reason);
		return adverbBridgeCapabilities({ index: handle.observations, candidate: selected.identity,
			headClass: observed.observation.profile.headClass, polarity: observed.observation.profile.polarity });
	});
}
export function evaluateManualAdverbSlot(input: { authority: ManualAdverbAuthority; slot: ManualAdverbSlot; currentSurface: string }): ManualAdverbResult<ManualAdverbEvaluation> {
	return guarded(() => {
		const data = fields(input, ["authority", "slot", "currentSurface"]), handle = authority(data.authority);
		const state = slotState(handle, data.slot), current = text(data.currentSurface);
		const observed = observeAdverbSlot({ ...state.run, index: state.index });
		const groups = new Map<string, { surface: string; frequency: number; candidates: ManualAdverbCandidate[] }>();
		let compatible = false;
		if (observed.supported) for (const candidate of handle.candidates) {
			const answer = evaluateAdverbCandidate({ index: handle.observations, targetTokens: state.run.tokens,
				targetIndex: state.index, targetBarriers: state.run.barriers, candidate: candidate.identity });
			if (!answer.usable) continue;
			compatible = true;
			if (candidate.record.surface === current) continue;
			const group = groups.get(candidate.record.surface) ?? { surface: candidate.record.surface, frequency: 0, candidates: [] };
			// One contribution per Snapshot record, never per observation profile.
			group.frequency = count(group.frequency + candidate.record.frequency);
			group.candidates.push(candidate); groups.set(group.surface, group);
		}
		const alternatives = [...groups.values()].sort((a, b) => compare(a.surface, b.surface));
		const evaluation: ManualAdverbEvaluation = frozen({ alternatives, diagnostic: {
			available: alternatives.length > 0, alternativeSurfaceCount: alternatives.length,
			reason: !observed.supported ? observed.reason : alternatives.length ? null : compatible ? "only-current-surface" : "no-candidate" } });
		EVALUATIONS.set(evaluation, { authority: handle, slot: data.slot as ManualAdverbSlot });
		return evaluation;
	});
}
export function drawManualAdverbCandidate(input: { authority: ManualAdverbAuthority; evaluation: ManualAdverbEvaluation; nonce: number }): ManualAdverbResult<ManualAdverbCandidate> {
	return guarded(() => {
		const data = fields(input, ["authority", "evaluation", "nonce"]), handle = authority(data.authority);
		const evaluation = data.evaluation as ManualAdverbEvaluation, state = EVALUATIONS.get(evaluation);
		if (!state || state.authority !== handle) refuse("invalid-evaluation");
		slotState(handle, state.slot);
		if (!Number.isInteger(data.nonce) || (data.nonce as number) < 0 || (data.nonce as number) > 0xffffffff) refuse("invalid-input");
		if (!evaluation.diagnostic.available) refuse(evaluation.diagnostic.reason ?? "invalid-evaluation");
		const seed = parseInt(sha256Hex(JSON.stringify(["semantropy/manual-adverb/draw", data.nonce])).slice(0, 8), 16);
		const random = createSeededRandom(seed);
		// 0.1.0 S3: the owner's Source weights; without them this is the existing weight exactly.
		const weights = sourceWeightLookup(AUTHORITIES.get(handle)!.vocabulary.snapshot);
		const weight = (group: ManualAdverbEvaluation["alternatives"][number]) => drawWeight(handle.provenance.drawMode, weights, group.frequency,
			() => group.candidates.flatMap(candidate => candidate.record.origins));
		const total = count(evaluation.alternatives.reduce((sum, group) => sum + weight(group), 0));
		let draw = random.next() * total;
		const group = evaluation.alternatives.find(item => { draw -= weight(item); return draw < 0; });
		if (!group) refuse("invalid-evaluation");
		// Like the existing Vocabulary draw, identity within the selected surface is uniform.
		return group.candidates[Math.floor(random.next() * group.candidates.length)]!;
	});
}
export function inspectManualAdverbAuthority(value: ManualAdverbAuthority): ManualAdverbResult<true> {
	return guarded(() => { authority(value); return true; });
}
/** Exact private ownership, not agreement of public provenance or fingerprint. */
export function inspectManualAdverbOwner(input: { authority: ManualAdverbAuthority; vocabulary: ManualMorphVocabulary }): ManualAdverbResult<true> {
	return guarded(() => {
		const data = fields(input, ["authority", "vocabulary"]);
		const handle = authority(data.authority), vocabulary = owner(data.vocabulary);
		if (AUTHORITIES.get(handle)!.vocabulary !== vocabulary) refuse("invalid-vocabulary");
		return true;
	});
}
export function releaseManualAdverbAuthority(input: { authority: ManualAdverbAuthority; reason: ManualAdverbReleaseReason }): ManualAdverbResult<true> {
	return guarded(() => {
		const data = fields(input, ["authority", "reason"]), handle = authority(data.authority);
		if (!["source-changed", "refresh", "apply", "view-close", "plugin-disable"].includes(data.reason as string)) refuse("invalid-input");
		const state = AUTHORITIES.get(handle)!;
		for (const slot of state.slots) SLOTS.delete(slot);
		REVOKED.add(state.vocabulary); OWNERS.delete(state.vocabulary); AUTHORITIES.delete(handle); RELEASED.add(handle);
		return true;
	});
}
