import { alternativeSurfaceCount, type DisplaySlot, type DisplaySlotPlan, type ManualDiagnosticReason, type ManualOverride } from "./displaySlots";
import { chooseRubyVariant, chooseVocabularyCandidate, freezeAnalysis, type VocabularyCandidate, type VocabularyOrigin } from "./rubyVocabulary";
import { drawWeight, sourceWeightLookup } from "../vocabulary/sourceWeights";
import { evaluateManualMorphSlot, isManualMorphVocabulary, type ManualMorphRejection, type ManualMorphVocabulary } from "../transform/manualMorphology";
import { isEligibleReplacementToken, vocabularyPoolKey } from "../transform/tokenPolicy";
import { createSeededRandom } from "../random/seededRandom";
import { snapshotRubyVocabulary } from "../application/prepareVocabulary";
import { validateHeadword } from "../dictionary/headword";

export const MANUAL_RANDOM_DOMAIN = "manual-1";
/** Manual random-domain version. Must stay 1 so established draws do not move. */
export const MANUAL_ALGORITHM_VERSION = 1;

export function manualSeed(generation: number, fingerprint: string, tokenId: string, revision: number, domain = MANUAL_RANDOM_DOMAIN): number {
	let hash = 2166136261;
	// Keep the established noun stream unchanged. Morph Ruby uses its own domain.
	const value = JSON.stringify(domain === MANUAL_RANDOM_DOMAIN ? [MANUAL_ALGORITHM_VERSION, generation, fingerprint, tokenId, revision] : [domain, generation, fingerprint, tokenId, revision]);
	for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
	return hash >>> 0;
}

/** Caller supplies one canonical run; never join adjacent Chunks or protected runs. */
export function morphChoices(active: ManualMorphVocabulary, run: readonly DisplaySlot[], slot: DisplaySlot, currentSurface: string) {
	const index = run.indexOf(slot);
	if (index < 0) throw Error("Invalid Manual slot.");
	return evaluateManualMorphSlot({ target: slot.originalToken, next: run[index + 1]?.originalToken ?? null,
		currentSurface, snapshot: active.snapshot, evidence: active.evidence });
}

/** Primary surface draw, followed by identity draw within that surface, only from the evaluator's records. */
export function drawManualOverride(active: ManualMorphVocabulary, run: readonly DisplaySlot[], slot: DisplaySlot, generation: number, localRevision: number): ManualOverride | null {
	const { snapshot } = active;
	const seed = manualSeed(generation, snapshot.fingerprint, slot.tokenId, localRevision), random = createSeededRandom(seed);
	const morph = slot.manualClass !== "noun" ? morphChoices(active, run, slot, slot.displaySurface) : null;
	if (morph && !morph.available) return null;
	const buckets = new Map<string, { surface: string; frequency: number; origins: (readonly VocabularyOrigin[])[] }>();
	const records = morph?.candidates ?? [];
	const input = morph ? records : snapshot.projections.automaticBody.buckets.find(b => b.key === vocabularyPoolKey(slot.originalToken))?.surfaces ?? [];
	for (const item of input) if (item.surface !== slot.displaySurface) {
		const old = buckets.get(item.surface);
		buckets.set(item.surface, { surface: item.surface, frequency: (old?.frequency ?? 0) + item.frequency, origins: [...old?.origins ?? [], item.origins] });
	}
	const choices = [...buckets.values()];
	if (!choices.length) return null;
	let chosen = choices[Math.floor(random.next() * choices.length)]!;
	// 0.1.0 S3: without Source weights both draws are exactly as before. With them, the second draw is weighted in either mode.
	const weights = sourceWeightLookup(snapshot);
	if (snapshot.drawMode === "frequency" || weights) {
		const weightOf = (item: (typeof choices)[number]) => drawWeight(snapshot.drawMode, weights, item.frequency, () => item.origins.flat());
		let draw = random.next() * choices.reduce((sum, item) => sum + weightOf(item), 0);
		for (const item of choices) { draw -= weightOf(item); if (draw < 0) { chosen = item; break; } }
	}
	if (!morph) {
		const vocabulary = snapshotRubyVocabulary(snapshot);
		const selection = chooseVocabularyCandidate({ vocabulary, original: slot.originalToken, surface: chosen.surface, seed, tokenId: slot.tokenId });
		const ruby = chooseRubyVariant({ vocabulary, original: slot.originalToken, selection, seed, tokenId: slot.tokenId });
		return { kind: "replacement", ...selection, connectionKey: null, rubyVariantId: ruby?.variantId ?? null, localRevision };
	}
	const matching = records.filter(record => record.surface === chosen.surface);
	const record = matching[Math.floor(random.next() * matching.length)]!;
	const variants = record.verifiedRubyVariants;
	const rubyRandom = createSeededRandom(manualSeed(generation, snapshot.fingerprint, slot.tokenId, localRevision, "manual-morph-ruby-1"));
	let ruby = variants.at(-1) ?? null, draw = rubyRandom.next() * variants.reduce((n, v) => n + v.frequency, 0);
	for (const variant of variants) { draw -= variant.frequency; if (draw < 0) { ruby = variant; break; } }
	if (!morph.available) throw Error("Invalid Manual connection.");
	return { kind: "replacement", candidateId: record.candidateId, displayFormId: record.displayFormId, surface: record.surface,
		connectionKey: morph.connectionKey, rubyVariantId: ruby?.variantId ?? null, localRevision };
}

/**
 * The only bridge between the Manual Morph core's structured rejection and the
 * display-only diagnostic. It is the identity function at runtime; its value is
 * that `tsc` rejects the build if the core ever adds a reason the display union
 * does not carry, so a new reason can never be silently dropped or shown as an
 * available slot.
 */
export function assertDiagnosticReason(reason: ManualMorphRejection): ManualDiagnosticReason {
	return reason;
}

/** Revalidate overrides against this exact active group on every application; automatic noun counts stay untouched. */
export function applyManualDisplay(automatic: DisplaySlotPlan, active: ManualMorphVocabulary, overrides: ReadonlyMap<string, ManualOverride>): DisplaySlotPlan {
	if (!isManualMorphVocabulary(active)) throw Error("Invalid Manual vocabulary.");
	const { snapshot } = active;
	const candidates = candidateIndex(active);
	const buckets = new Map(snapshot.projections.automaticBody.buckets.map(bucket => [bucket.key, bucket.surfaces]));
	const callable = automatic.slots.some(slot => slot.dictionaryAvailable);
	const runs = automatic.runs.map(run => ({ ...run, slots: run.slots.map(slot => {
		const override = overrides.get(slot.tokenId) ?? null;
		const noun = isEligibleReplacementToken(slot.originalToken);
		// Empty surface requests the full canonical compatible set, including an already displayed record.
		const morph = noun ? null : morphChoices(active, run.slots, slot, "");
		const manualClass = noun ? "noun" : morph?.available ? morph.slotClass : "unsupported";
		let candidate = slot.automaticCandidate, surface = slot.automaticSurface, ruby = slot.automaticRuby;
		if (override && manualClass === "unsupported") throw Error("Invalid Manual override.");
		if (override?.kind === "restore-original") { candidate = null; surface = slot.originalToken.surface; ruby = null; }
		else if (override?.kind === "replacement") {
			const found = candidates.get(override.displayFormId);
			if (!found || found.candidateId !== override.candidateId || found.surface !== override.surface) throw Error("Invalid Manual candidate.");
			if (noun ? override.connectionKey !== null || !isEligibleReplacementToken(found.token) || vocabularyPoolKey(found.token) !== vocabularyPoolKey(slot.originalToken)
				: !morph?.available || morph.connectionKey !== override.connectionKey || !morph.candidates.some(c => c.candidateId === override.candidateId && c.displayFormId === override.displayFormId && c.surface === override.surface)) throw Error("Invalid Manual connection.");
			const variants = noun ? found.verifiedRubyVariants : morph!.candidates.find(c => c.displayFormId === override.displayFormId)!.verifiedRubyVariants;
			ruby = variants.find(v => v.variantId === override.rubyVariantId) ?? null;
			if (override.rubyVariantId !== null ? !ruby : variants.length > 0) throw Error("Invalid Manual Ruby.");
			candidate = found; surface = found.surface;
		}
		// Snapshot values are immutable, but do not freeze a caller-owned graph as a side effect.
		const displayCandidate: VocabularyCandidate | null = candidate ? structuredClone(candidate) : null;
		// A MAX-realized surface has no record: the headword check sees the slot's own token with that surface.
		const dictionary = validateHeadword(surface, [displayCandidate?.token ?? (surface === slot.originalToken.surface ? slot.originalToken : { ...slot.originalToken, surface })]);
		// Distinct alternative surfaces, never record counts or frequency totals:
		// this is the number of outcomes a Shuffle could actually produce.
		const pool = noun ? buckets.get(vocabularyPoolKey(slot.originalToken)) ?? [] : morph?.available ? morph.candidates : [];
		const alternatives = alternativeSurfaceCount(pool, surface);
		const available = alternatives > 0;
		// The core owns every unavailability reason. The one case it cannot state
		// here is the one this layer measured itself: the empty-surface evaluation
		// above deliberately keeps the displayed record, so a compatible set that
		// could not change anything is resolved to the core's own wording here.
		const reason: ManualDiagnosticReason | null = available ? null
			: noun ? (pool.length > 0 ? "only-current-surface" : "no-candidate")
			: morph?.available ? "only-current-surface" : assertDiagnosticReason(morph?.reason ?? "invalid-evidence");
		const nextSlot: DisplaySlot = { ...slot, displayCandidate, displaySurface: surface, displayRuby: ruby ? structuredClone(ruby) : null,
			manualOverride: override, manualClass, manualEligible: noun || available || override !== null, manualAvailable: available,
			manualDiagnostic: { status: available ? "available" : "unavailable", slotClass: manualClass, reason,
				alternativeSurfaceCount: alternatives, overridden: override !== null },
			dictionary, dictionaryEligible: dictionary.outcome === "accepted", dictionaryAvailable: dictionary.outcome === "accepted" && callable,
			displayRevision: automatic.displayRevision };
		return nextSlot;
	}) }));
	return freezeAnalysis({ ...automatic, runs, slots: runs.flatMap(run => run.slots) });
}

// Object-owned cache: no repeated whole-Snapshot scan during local Shuffle.
// Weak ownership follows the transient active group and cannot keep it alive.
const CANDIDATE_INDEX = new WeakMap<ManualMorphVocabulary, ReadonlyMap<string, VocabularyCandidate>>();
function candidateIndex(active: ManualMorphVocabulary): ReadonlyMap<string, VocabularyCandidate> {
	let index = CANDIDATE_INDEX.get(active);
	if (!index) {
		index = new Map(active.snapshot.candidates.map(candidate => [candidate.displayFormId, candidate]));
		CANDIDATE_INDEX.set(active, index);
	}
	return index;
}
