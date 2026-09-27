import type { LocatedAnalysisRun } from "../analysis/locateTokens";
import type { VerifiedRubyVariant } from "../analysis/rubyVocabulary";
import type { BodySemantropy } from "../settings/bodySemantropy";
import { createSeededRandom, type SeededRandom } from "../random/seededRandom";
import { sha256Hex } from "../vocabulary/sha256";
import { transformWithVocabularySnapshot, type VocabularySnapshotSelection, type VocabularySourceIdentity } from "../vocabulary/vocabularySnapshot";
import { evaluateManualMorphSlot, readManualMorphVocabularySources, type ManualMorphCandidate,
	type ManualMorphSourceAnalysis, type ManualMorphVocabulary } from "./manualMorphology";
import { bindManualAdverbSlot, createManualAdverbAuthority, evaluateManualAdverbSlot, inspectManualAdverbOwner, readManualAdverbSlotContext,
	type ManualAdverbAuthority } from "./manualAdverbAuthority";
import { AUTOMATIC_POS_BODY_ALGORITHM_VERSION, AUTOMATIC_POS_PROJECTION_VERSION, AUTOMATIC_POS_TRANSFORM_VERSION,
	requireAutomaticPosOwner, resolveAutomaticPosProjection, type AutomaticPosProjection } from "./automaticPosProjection";
import { compare, fields, frozen, guarded, refuse, safeSurface, type AutomaticPosAnswer } from "./automaticPosGuard";
import { isSlotApplied } from "./slotScore";
import { isEligibleReplacementToken, vocabularyPoolKey } from "./tokenPolicy";

import type { AutomaticPosOptions } from "./automaticPosOptions";
export type { AutomaticPosOptions } from "./automaticPosOptions";
type ExtraPart = "verb" | "iAdjective" | "adverb";
export type AutomaticPosTarget = { readonly source: VocabularySourceIdentity; readonly runCount: number };
type Choice = { readonly surface: string; readonly frequency: number; readonly candidates: readonly ManualMorphCandidate[] };
type TargetState = { projection: AutomaticPosProjection; vocabulary: ManualMorphVocabulary; authority: ManualAdverbAuthority;
	source: ManualMorphSourceAnalysis; runs: readonly LocatedAnalysisRun[];
	morphCache: Map<string, readonly Choice[]>; adverbCache: Map<string, readonly Choice[]>; latest: AutomaticPosResult | null };
const TARGETS = new WeakMap<AutomaticPosTarget, TargetState>();
const TARGET_CACHE = new WeakMap<AutomaticPosProjection, WeakMap<ManualMorphVocabulary, Map<string, AutomaticPosTarget>>>();
const RESULTS = new WeakMap<AutomaticPosResult, AutomaticPosTarget>();
const RESULT_SLOTS = new WeakMap<AutomaticPosResult, readonly (readonly boolean[])[]>();

function targetState(projection: AutomaticPosProjection, target: AutomaticPosTarget): TargetState {
	resolveAutomaticPosProjection(projection);
	const state = TARGETS.get(target); if (!state) refuse("invalid-owner");
	if (state.projection !== projection) refuse("provenance-mismatch");
	requireAutomaticPosOwner(state.vocabulary);
	const alive = inspectManualAdverbOwner({ authority: state.authority, vocabulary: state.vocabulary });
	if (!alive.ok) refuse(alive.reason === "released" ? "released" : "invalid-owner");
	return state;
}

/** Bind one genuinely analyzed Target Source. No per-token state is created here. */
export function bindAutomaticPosTarget(input: { projection: AutomaticPosProjection; targetVocabulary: ManualMorphVocabulary; source: ManualMorphSourceAnalysis }): AutomaticPosAnswer<AutomaticPosTarget> {
	return guarded(() => {
		const data = fields(input, ["projection", "targetVocabulary", "source"]), projection = data.projection as AutomaticPosProjection;
		resolveAutomaticPosProjection(projection);
		const vocabulary = requireAutomaticPosOwner(data.targetVocabulary);
		const source = readManualMorphVocabularySources(vocabulary)?.find(item => item.analysis === data.source);
		if (!source) refuse("invalid-owner");
		const authority = createManualAdverbAuthority({ vocabulary });
		if (!authority.ok) refuse(authority.reason === "released" ? "released" : "invalid-owner");
		const byOwner = TARGET_CACHE.get(projection) ?? new WeakMap<ManualMorphVocabulary, Map<string, AutomaticPosTarget>>();
		const bySource = byOwner.get(vocabulary) ?? new Map<string, AutomaticPosTarget>();
		const key = JSON.stringify(source.source), previous = bySource.get(key);
		if (previous) { targetState(projection, previous); return previous; }
		const handle = frozen({ source: source.source, runCount: source.runs.length });
		TARGETS.set(handle, { projection, vocabulary, authority: authority.value, source: source.analysis, runs: source.runs,
			morphCache: new Map(), adverbCache: new Map(), latest: null });
		bySource.set(key, handle); byOwner.set(vocabulary, bySource); TARGET_CACHE.set(projection, byOwner);
		return handle;
	});
}

function groups(candidates: readonly ManualMorphCandidate[]): readonly Choice[] {
	const bySurface = new Map<string, { surface: string; frequency: number; candidates: ManualMorphCandidate[] }>();
	for (const candidate of candidates) {
		const group = bySurface.get(candidate.surface) ?? { surface: candidate.surface, frequency: 0, candidates: [] };
		group.frequency += candidate.frequency;
		if (!Number.isSafeInteger(group.frequency)) refuse("invalid-projection");
		group.candidates.push(candidate); bySurface.set(group.surface, group);
	}
	return frozen([...bySurface.values()].sort((a, b) => compare(a.surface, b.surface)));
}
function choices(state: TargetState, run: LocatedAnalysisRun, index: number, part: ExtraPart, currentSurface: string): readonly Choice[] {
	const { vocabulary, authority } = resolveAutomaticPosProjection(state.projection);
	const item = run.tokens[index]!, token = item.token;
	if (part === "adverb") {
		const slot = bindManualAdverbSlot({ authority, targetVocabulary: state.vocabulary, source: state.source, runId: run.run.runId, tokenIndex: index });
		if (!slot.ok) refuse(slot.reason === "released" ? "released" : "invalid-projection");
		const context = readManualAdverbSlotContext({ authority, slot: slot.value });
		if (!context.ok) refuse(context.reason === "released" ? "released" : "invalid-projection");
		if (!context.value.supported) return Object.freeze([]);
		const key = JSON.stringify([context.value.observation.profile, currentSurface]);
		const previous = state.adverbCache.get(key); if (previous) return previous;
		const evaluation = evaluateManualAdverbSlot({ authority, slot: slot.value, currentSurface });
		if (!evaluation.ok) refuse(evaluation.reason === "released" ? "released" : "invalid-projection");
		const value = frozen(evaluation.value.alternatives.map(group => ({ surface: group.surface, frequency: group.frequency, candidates: group.candidates.map(candidate => candidate.record) })));
		state.adverbCache.set(key, value); return value;
	}
	const next = run.tokens[index + 1]?.token ?? null;
	// Exact authenticated tokens, including every field the authority can read. This is memoization, not classification.
	const key = JSON.stringify([token, next, currentSurface]);
	const previous = state.morphCache.get(key); if (previous) return previous;
	const evaluation = evaluateManualMorphSlot({ target: token, next, currentSurface, snapshot: vocabulary.snapshot, evidence: vocabulary.evidence });
	if (!evaluation.available && evaluation.reason === "invalid-evidence") refuse("invalid-projection");
	const expectedClass = part === "verb" ? "verb" : "i-adjective";
	const value = evaluation.available && evaluation.slotClass === expectedClass ? groups(evaluation.candidates) : Object.freeze([]);
	state.morphCache.set(key, value); return value;
}

// Noun's historical stream is owned by transformWithVocabularySnapshot. Each additional domain is private.
function domainNonce(nonce: number, part: ExtraPart, purpose: string): number {
	return parseInt(sha256Hex(JSON.stringify(["semantropy/automatic-pos-2", part, purpose, nonce])).slice(0, 8), 16);
}
function draw<T>(items: readonly T[], weight: (item: T) => number, random: SeededRandom): T {
	let value = random.next() * items.reduce((sum, item) => sum + weight(item), 0);
	for (const item of items) { value -= weight(item); if (value < 0) return item; }
	return items[items.length - 1]!;
}
function selectedRuby(record: ManualMorphCandidate, random: SeededRandom): VerifiedRubyVariant | null {
	// Only the exact selected record's verified Source pair. Never synthesize from token.reading.
	return record.verifiedRubyVariants.length ? draw(record.verifiedRubyVariants, variant => variant.frequency, random) : null;
}
export type AutomaticPosResult = {
	readonly bodyAlgorithmVersion: typeof AUTOMATIC_POS_BODY_ALGORITHM_VERSION;
	readonly algorithmVersion: typeof AUTOMATIC_POS_TRANSFORM_VERSION;
	readonly projectionVersion: typeof AUTOMATIC_POS_PROJECTION_VERSION;
	readonly vocabularyFingerprint: string;
	readonly vocabularySources: readonly VocabularySourceIdentity[];
	readonly targetSource: VocabularySourceIdentity;
	readonly drawMode: "uniform" | "frequency";
	readonly bodySemantropy: number;
	readonly runIds: readonly string[];
	readonly texts: readonly string[];
	readonly tokenSurfaces: readonly (readonly string[])[];
	readonly selections: readonly (readonly (VocabularySnapshotSelection | null)[])[];
	readonly replaceableSlotCount: number;
	readonly replacementCount: number;
};

/** Stateless draws over owned inputs, with a private latest-result seal for later View transactions.
 * runCount is the requested canonical prefix, not the full Vocabulary or unloaded Chunk range.
 * No settings, DOM, commit, scheduler, tokenizer, or nonce issuer lives in this module.
 */
export function transformAutomaticPos(input: { projection: AutomaticPosProjection; target: AutomaticPosTarget; runCount: number;
	options: AutomaticPosOptions; bodySemantropy: number; nonce: number; current?: AutomaticPosResult }): AutomaticPosAnswer<AutomaticPosResult> {
	return guarded(() => {
		const hasCurrent = input != null && Object.prototype.hasOwnProperty.call(input, "current");
		const data = fields(input, ["projection", "target", "runCount", "options", "bodySemantropy", "nonce", ...(hasCurrent ? ["current"] : [])]);
		const projection = data.projection as AutomaticPosProjection, target = data.target as AutomaticPosTarget;
		const state = targetState(projection, target), owned = resolveAutomaticPosProjection(projection);
		const options = fields(data.options, ["noun", "verb", "iAdjective", "adverb"]);
		if (Object.values(options).some(value => typeof value !== "boolean") || !Number.isInteger(data.nonce) ||
			(data.nonce as number) < 0 || (data.nonce as number) > 0xffffffff || !Number.isInteger(data.bodySemantropy) ||
			(data.bodySemantropy as number) < 0 || (data.bodySemantropy as number) > 100 || !Number.isSafeInteger(data.runCount) ||
			(data.runCount as number) < 0 || (data.runCount as number) > state.runs.length) refuse("invalid-request");
		const nonce = data.nonce as number, level = data.bodySemantropy as number, runs = state.runs.slice(0, data.runCount as number);
		const current = hasCurrent ? data.current as AutomaticPosResult : null;
		if (hasCurrent && (!current || RESULTS.get(current) !== target)) refuse("provenance-mismatch");
		if (current && state.latest !== current) refuse("stale");
		// Starting a valid generation supersedes old prepared results, even if preparation subsequently fails.
		state.latest = null;
		const sequences = runs.map((run, i) => run.tokens.map((item, j) => ({ ...item, token: { ...item.token,
			surface: current?.tokenSurfaces[i]?.[j] ?? item.token.surface,
			isUnknown: item.token.isUnknown || !safeSurface(item.token.surface),
		} })));
		const noun = options.noun ? transformWithVocabularySnapshot({ tokenSequences: sequences, snapshot: owned.vocabulary.snapshot,
			bodySeed: nonce, bodySemantropy: level as BodySemantropy, algorithmVersion: 1 }) : null;
		const surfaces = runs.map((run, i) => run.tokens.map((item, j) => noun?.selections[i]![j] ? noun.tokenSurfaces[i]![j]! : item.token.surface));
		const selections = runs.map((run, i) => noun ? [...noun.selections[i]!] : run.tokens.map((): VocabularySnapshotSelection | null => null));
		const nounBuckets = new Map(owned.vocabulary.snapshot.projections.automaticBody.buckets.map(bucket => [bucket.key, bucket.surfaces]));
		const eligible = sequences.map(run => run.map(item => !!options.noun && isEligibleReplacementToken(item.token) &&
			(nounBuckets.get(vocabularyPoolKey(item.token)) ?? []).some(candidate => candidate.surface !== item.token.surface)));
		let replaceableSlotCount = noun?.replaceableSlotCount ?? 0, replacementCount = noun?.replacementCount ?? 0;
		const random = { verb: createSeededRandom(domainNonce(nonce, "verb", "surface")),
			iAdjective: createSeededRandom(domainNonce(nonce, "iAdjective", "surface")), adverb: createSeededRandom(domainNonce(nonce, "adverb", "surface")) };
		for (const [sequenceIndex, run] of runs.entries()) for (const [tokenIndex, item] of run.tokens.entries()) {
			const token = item.token;
			if (token.isUnknown || !safeSurface(token.surface)) continue;
			// Routing only. The Manual authorities alone decide eligibility and compatibility.
			const part = token.pos === "動詞" ? "verb" : token.pos === "形容詞" ? "iAdjective" : token.pos === "副詞" ? "adverb" : null;
			if (!part || !options[part]) continue;
			const alternatives = choices(state, run, tokenIndex, part, current?.tokenSurfaces[sequenceIndex]?.[tokenIndex] ?? token.surface);
			if (!alternatives.length) continue;
			eligible[sequenceIndex]![tokenIndex] = true;
			replaceableSlotCount++;
			const group = draw(alternatives, group => projection.drawMode === "frequency" ? group.frequency : 1, random[part]);
			if (!isSlotApplied(nonce, { sequenceIndex, tokenIndex }, level)) continue;
			const identity = createSeededRandom(domainNonce(nonce, part, JSON.stringify(["identity", item.tokenId])));
			const record = draw(group.candidates, () => 1, identity);
			const ruby = createSeededRandom(domainNonce(nonce, part, JSON.stringify(["ruby", item.tokenId, record.displayFormId])));
			surfaces[sequenceIndex]![tokenIndex] = record.surface;
			selections[sequenceIndex]![tokenIndex] = { candidate: { candidateId: record.candidateId, displayFormId: record.displayFormId, surface: record.surface }, rubyVariant: selectedRuby(record, ruby) };
			replacementCount++;
		}
		targetState(projection, target);
		const result: AutomaticPosResult = frozen({ bodyAlgorithmVersion: AUTOMATIC_POS_BODY_ALGORITHM_VERSION, algorithmVersion: AUTOMATIC_POS_TRANSFORM_VERSION,
			projectionVersion: AUTOMATIC_POS_PROJECTION_VERSION, vocabularyFingerprint: projection.fingerprint, vocabularySources: projection.sources,
			targetSource: target.source, drawMode: projection.drawMode, bodySemantropy: level, runIds: runs.map(run => run.run.runId),
			texts: surfaces.map(run => run.join("")), tokenSurfaces: surfaces, selections, replaceableSlotCount, replacementCount });
		RESULTS.set(result, target); RESULT_SLOTS.set(result, frozen(eligible)); state.latest = result;
		return result;
	});
}

/** Read-only render seam: exact analyzed tokens and eligibility captured by this
 * result's own draw. A renderer never reclassifies morphology or trusts a clone. */
export function readAutomaticPosResultSlots(input: { projection: AutomaticPosProjection; target: AutomaticPosTarget; result: AutomaticPosResult }) {
	return guarded(() => {
		const inspected = inspectAutomaticPosResult(input); if (!inspected.ok) refuse(inspected.reason);
		const state = targetState(input.projection, input.target);
		return frozen({ runs: state.runs.slice(0, input.result.runIds.length), eligible: RESULT_SLOTS.get(input.result)! });
	});
}

/** A result is a prepared baseline, never a View commit. Recheck immediately before publication. */
export function inspectAutomaticPosResult(input: { projection: AutomaticPosProjection; target: AutomaticPosTarget; result: AutomaticPosResult }): AutomaticPosAnswer<true> {
	return guarded(() => {
		const data = fields(input, ["projection", "target", "result"]), target = data.target as AutomaticPosTarget;
		const state = targetState(data.projection as AutomaticPosProjection, target), result = data.result as AutomaticPosResult;
		if (RESULTS.get(result) !== target) refuse("provenance-mismatch");
		if (state.latest !== result) refuse("stale");
		return true;
	});
}
