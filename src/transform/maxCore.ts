import type { LocatedAnalysisRun } from "../analysis/locateTokens";
import { vocabularyDisplayFormId, type VerifiedRubyVariant } from "../analysis/rubyVocabulary";
import { adverbSurfaceEndsWithTo } from "../adverb/adverbFamily";
import { readAdverbBridge } from "./maxAdverbBridge";
import type { BodySemantropy } from "../settings/bodySemantropy";
import { createSeededRandom, type SeededRandom } from "../random/seededRandom";
import { sha256Hex } from "../vocabulary/sha256";
import { transformWithVocabularySnapshot, type VocabularySourceIdentity } from "../vocabulary/vocabularySnapshot";
import { evaluateManualMorphSlot, manualMorphConnection, readManualMorphVocabularySources, type ManualMorphCandidate,
	type ManualMorphSourceAnalysis, type ManualMorphVocabulary } from "./manualMorphology";
import { bindManualAdverbSlot, createManualAdverbAuthority, evaluateManualAdverbSlot, inspectManualAdverbOwner, readManualAdverbSlotContext,
	type ManualAdverbAuthority } from "./manualAdverbAuthority";
import { compare, fields, frozen, guarded, refuse, safeSurface, type AutomaticPosAnswer } from "./automaticPosGuard";
import type { AutomaticPosOptions } from "./automaticPosOptions";
import { isEligibleReplacementToken } from "./tokenPolicy";
import { isMaxLevel, isMaxSlotApplied, maxDomainBase, maxProfileAt, maxSlotHash, maxUnit, type MaxProfile } from "./maxLevel";
import { maxTargetFormKey, type MaxTargetFormKey } from "./maxRealizer";
import { MAX_BODY_ALGORITHM_VERSION, MAX_PROJECTION_VERSION, MAX_TRANSFORM_VERSION, requireMaxOwner, resolveMaxProjection,
	type MaxLexeme, type MaxProjection, type MaxReleaseReason } from "./maxProjection";
export type { AutomaticPosOptions } from "./automaticPosOptions";
export type { MaxProfile } from "./maxLevel";

/**
 * PRE-RELEASE-MAX-CORE1 generation: Body algorithm 11 / Snapshot transform 3.
 * Production-disconnected. No settings, DOM, commit, scheduler, tokenizer or
 * nonce issuer lives here, and no Source or generated surface is tokenized.
 *
 * Each slot takes one profile from the level (maxLevel.ts): application and
 * profile rank can only move forward as the level rises. Candidate sets are
 * not nested — Policy 1 §2.2 lets a surface change with the profile, and a
 * High / MAX verb or i-adjective pool is the closed realizer's safe set alone,
 * so a slot with a strict candidate but no safe one keeps its original text:
 *
 *   - strict is Body 10 exactly: the same authorities, the same legacy noun
 *     transform and the same per-part sequential surface streams, drawn for
 *     every strict-eligible slot whatever profile it ends up in, so level 50
 *     reproduces Body 10 at 100 surface for surface, identity for identity and
 *     Ruby for Ruby. (Within one part, a strict stream shifts exactly as Body
 *     10's does when that part's own eligible slots change.)
 *   - High / MAX slots draw in private per-slot domains keyed by the
 *     authenticated token identity, so they never shift another slot.
 */
type Part = "noun" | "verb" | "iAdjective" | "adverb";
export type MaxTarget = { readonly source: VocabularySourceIdentity; readonly runCount: number };
export type MaxRealizationEvidence = { readonly lexemeId: string; readonly formKey: MaxTargetFormKey };
export type MaxSelection = {
	readonly candidate: { readonly candidateId: string; readonly displayFormId: string; readonly surface: string };
	readonly rubyVariant: VerifiedRubyVariant | null;
	/** Present only when the surface was built by the closed realizer from this lexeme. */
	readonly realization: MaxRealizationEvidence | null;
};
export type MaxResult = {
	readonly bodyAlgorithmVersion: typeof MAX_BODY_ALGORITHM_VERSION;
	readonly algorithmVersion: typeof MAX_TRANSFORM_VERSION;
	readonly projectionVersion: typeof MAX_PROJECTION_VERSION;
	readonly vocabularyFingerprint: string;
	readonly vocabularySources: readonly VocabularySourceIdentity[];
	readonly targetSource: VocabularySourceIdentity;
	readonly drawMode: "uniform" | "frequency";
	readonly bodySemantropy: number;
	readonly runIds: readonly string[];
	readonly texts: readonly string[];
	readonly tokenSurfaces: readonly (readonly string[])[];
	readonly selections: readonly (readonly (MaxSelection | null)[])[];
	readonly replaceableSlotCount: number;
	readonly replacementCount: number;
};
type RecordLike = Pick<ManualMorphCandidate, "candidateId" | "displayFormId" | "surface" | "frequency" | "verifiedRubyVariants">;
type Entry = { readonly record: RecordLike; readonly lexeme: null } | { readonly record: null; readonly lexeme: MaxLexeme; readonly key: MaxTargetFormKey };
type Group = { readonly surface: string; readonly frequency: number; readonly entries: readonly Entry[] };
type Choice = { readonly surface: string; readonly frequency: number; readonly candidates: readonly ManualMorphCandidate[] };
type TargetState = { projection: MaxProjection; vocabulary: ManualMorphVocabulary; authority: ManualAdverbAuthority;
	source: ManualMorphSourceAnalysis; runs: readonly LocatedAnalysisRun[]; strict: Map<string, readonly Choice[]>;
	relaxed: Map<string, readonly Group[]>; latest: MaxResult | null };
const TARGETS = new WeakMap<MaxTarget, TargetState>();
const TARGET_CACHE = new WeakMap<MaxProjection, WeakMap<ManualMorphVocabulary, Map<string, MaxTarget>>>();
const RESULTS = new WeakMap<MaxResult, MaxTarget>();
const RESULT_SLOTS = new WeakMap<MaxResult, { eligible: readonly (readonly boolean[])[]; profiles: readonly (readonly (MaxProfile | null)[])[] }>();
const NOUN_POOLS = new WeakMap<MaxProjection, { groups: readonly Group[]; records: ReadonlyMap<string, RecordLike> }>();

const RELEASED_TARGETS = new WeakSet<MaxTarget>();
function targetState(projection: MaxProjection, target: MaxTarget): TargetState {
	resolveMaxProjection(projection);
	if (RELEASED_TARGETS.has(target)) refuse("released");
	const state = TARGETS.get(target); if (!state) refuse("invalid-owner");
	if (state.projection !== projection) refuse("provenance-mismatch");
	requireMaxOwner(state.vocabulary);
	const alive = inspectManualAdverbOwner({ authority: state.authority, vocabulary: state.vocabulary });
	if (!alive.ok) refuse(alive.reason === "released" ? "released" : "invalid-owner");
	return state;
}

/** Bind one genuinely analyzed Target Source. No per-token state is created here. */
export function bindMaxTarget(input: { projection: MaxProjection; targetVocabulary: ManualMorphVocabulary; source: ManualMorphSourceAnalysis }): AutomaticPosAnswer<MaxTarget> {
	return guarded(() => {
		const data = fields(input, ["projection", "targetVocabulary", "source"]), projection = data.projection as MaxProjection;
		resolveMaxProjection(projection);
		const vocabulary = requireMaxOwner(data.targetVocabulary);
		const source = readManualMorphVocabularySources(vocabulary)?.find(item => item.analysis === data.source);
		if (!source) refuse("invalid-owner");
		const authority = createManualAdverbAuthority({ vocabulary });
		if (!authority.ok) refuse(authority.reason === "released" ? "released" : "invalid-owner");
		const byOwner = TARGET_CACHE.get(projection) ?? new WeakMap<ManualMorphVocabulary, Map<string, MaxTarget>>();
		const bySource = byOwner.get(vocabulary) ?? new Map<string, MaxTarget>();
		const key = JSON.stringify(source.source), previous = bySource.get(key);
		if (previous) { targetState(projection, previous); return previous; }
		const handle: MaxTarget = frozen({ source: source.source, runCount: source.runs.length });
		TARGETS.set(handle, { projection, vocabulary, authority: authority.value, source: source.analysis, runs: source.runs,
			strict: new Map(), relaxed: new Map(), latest: null });
		bySource.set(key, handle); byOwner.set(vocabulary, bySource); TARGET_CACHE.set(projection, byOwner);
		return handle;
	});
}

/** Retire one bound Target without revoking its owner: its handle, results and caches stop being accepted, and a
 * later bind of the same Source mints a fresh handle. Owner-wide release stays `releaseMaxOwner`. */
export function releaseMaxTarget(input: { projection: MaxProjection; target: MaxTarget; reason: MaxReleaseReason }): AutomaticPosAnswer<true> {
	return guarded(() => {
		const data = fields(input, ["projection", "target", "reason"]), target = data.target as MaxTarget;
		const state = targetState(data.projection as MaxProjection, target);
		if (!["source-changed", "refresh", "apply", "view-close", "plugin-disable"].includes(data.reason as string)) refuse("invalid-request");
		RELEASED_TARGETS.add(target); TARGETS.delete(target); state.latest = null; state.strict.clear(); state.relaxed.clear();
		TARGET_CACHE.get(state.projection)?.get(state.vocabulary)?.delete(JSON.stringify(target.source));
		return true;
	});
}

/** Body 10's own domain derivation, reproduced so the strict profile is Body 10's draw exactly. */
function legacyDomain(nonce: number, part: Part, purpose: string): number {
	return parseInt(sha256Hex(JSON.stringify(["semantropy/automatic-pos-2", part, purpose, nonce])).slice(0, 8), 16);
}
function draw<T>(items: readonly T[], weight: (item: T) => number, random: SeededRandom): T {
	let value = random.next() * items.reduce((sum, item) => sum + weight(item), 0);
	for (const item of items) { value -= weight(item); if (value < 0) return item; }
	return items[items.length - 1]!;
}
/** The same weighted walk over a stateless unit value; weights are validated safe integers. */
function pick<T>(items: readonly T[], weight: (item: T) => number, unit: number): T {
	let value = unit * items.reduce((sum, item) => sum + weight(item), 0);
	for (const item of items) { value -= weight(item); if (value < 0) return item; }
	return items[items.length - 1]!;
}
function legacyRuby(record: RecordLike, random: SeededRandom): VerifiedRubyVariant | null {
	return record.verifiedRubyVariants.length ? draw(record.verifiedRubyVariants, variant => variant.frequency, random) : null;
}
function grouped(entries: readonly (Entry & { surface: string; weight: number })[]): readonly Group[] {
	const bySurface = new Map<string, { surface: string; frequency: number; entries: Entry[] }>();
	for (const entry of entries) {
		const group = bySurface.get(entry.surface) ?? { surface: entry.surface, frequency: 0, entries: [] };
		group.frequency += entry.weight;
		if (!Number.isSafeInteger(group.frequency)) refuse("invalid-projection");
		group.entries.push(entry.lexeme ? { record: null, lexeme: entry.lexeme, key: entry.key } : { record: entry.record, lexeme: null });
		bySurface.set(entry.surface, group);
	}
	return frozen([...bySurface.values()].sort((a, b) => compare(a.surface, b.surface)));
}

/** strict: Body 10's evaluation, delegated to the same Manual / Adverb authorities. */
function strictChoices(state: TargetState, run: LocatedAnalysisRun, index: number, part: Exclude<Part, "noun">, currentSurface: string,
	adverbContext: () => ReturnType<typeof adverbSlot>): readonly Choice[] {
	const { vocabulary, authority } = resolveMaxProjection(state.projection);
	if (part === "adverb") {
		const { slot, context } = adverbContext();
		if (!context.supported) return Object.freeze([]);
		const key = JSON.stringify(["adverb", context.observation.profile, currentSurface]);
		const previous = state.strict.get(key); if (previous) return previous;
		const evaluation = evaluateManualAdverbSlot({ authority, slot, currentSurface });
		if (!evaluation.ok) refuse(evaluation.reason === "released" ? "released" : "invalid-projection");
		const value = frozen(evaluation.value.alternatives.map(group => ({ surface: group.surface, frequency: group.frequency, candidates: group.candidates.map(candidate => candidate.record) })));
		state.strict.set(key, value); return value;
	}
	const token = run.tokens[index]!.token, next = run.tokens[index + 1]?.token ?? null;
	const key = JSON.stringify([token, next, currentSurface]);
	const previous = state.strict.get(key); if (previous) return previous;
	const evaluation = evaluateManualMorphSlot({ target: token, next, currentSurface, snapshot: vocabulary.snapshot, evidence: vocabulary.evidence });
	if (!evaluation.available && evaluation.reason === "invalid-evidence") refuse("invalid-projection");
	const value = evaluation.available && evaluation.slotClass === (part === "verb" ? "verb" : "i-adjective") ? groupRecords(evaluation.candidates) : Object.freeze([]);
	state.strict.set(key, value); return value;
}
function groupRecords(candidates: readonly ManualMorphCandidate[]): readonly Choice[] {
	const bySurface = new Map<string, { surface: string; frequency: number; candidates: ManualMorphCandidate[] }>();
	for (const candidate of candidates) {
		const group = bySurface.get(candidate.surface) ?? { surface: candidate.surface, frequency: 0, candidates: [] };
		group.frequency += candidate.frequency;
		if (!Number.isSafeInteger(group.frequency)) refuse("invalid-projection");
		group.candidates.push(candidate); bySurface.set(group.surface, group);
	}
	return frozen([...bySurface.values()].sort((a, b) => compare(a.surface, b.surface)));
}
function adverbSlot(state: TargetState, run: LocatedAnalysisRun, index: number) {
	const { authority } = resolveMaxProjection(state.projection);
	const slot = bindManualAdverbSlot({ authority, targetVocabulary: state.vocabulary, source: state.source, runId: run.run.runId, tokenIndex: index });
	if (!slot.ok) refuse(slot.reason === "released" ? "released" : "invalid-projection");
	const context = readManualAdverbSlotContext({ authority, slot: slot.value });
	if (!context.ok) refuse(context.reason === "released" ? "released" : "invalid-projection");
	return { slot: slot.value, context: context.value };
}

/**
 * High / MAX verb or i-adjective pool: the closed realizer's safe set and
 * nothing else (Level Policy 1 §3.2, Amendment 1 §3). A lexeme the realizer
 * builds for this Target key, with a surface other than the current one,
 * carries all its records' frequency to that surface, once. Strict candidates
 * are never re-injected: an observed form of an excluded lexeme (`あっ` of
 * `ある`) is a strict candidate only. With no safe candidate the slot keeps
 * its original surface.
 */
function morphRelaxed(state: TargetState, run: LocatedAnalysisRun, index: number, part: "verb" | "iAdjective", currentSurface: string,
	profile: Exclude<MaxProfile, "strict">): readonly Group[] {
	const token = run.tokens[index]!.token, next = run.tokens[index + 1]?.token ?? null;
	const memo = JSON.stringify([profile, token, next, currentSurface]);
	const previous = state.relaxed.get(memo); if (previous) return previous;
	const connection = manualMorphConnection(token, next), keyResult = maxTargetFormKey(connection);
	const pool = new Map<MaxLexeme, string>();
	if (connection.supported && keyResult.supported) {
		const family = connection.compatibility.slotClass === "verb" ? connection.compatibility.compatibilityFamily : null;
		for (const lexeme of state.projection[part].lexemes) {
			// High keeps the verified family (a verb's own class; the single regular i-adjective family). MAX drops it.
			if (profile === "high" && family !== null && lexeme.input.conjugationType !== family) continue;
			const realized = lexeme.realizations.find(item => item.key === keyResult.key);
			if (realized && realized.surface !== currentSurface) pool.set(lexeme, realized.surface);
		}
	}
	const entries: (Entry & { surface: string; weight: number })[] = [];
	for (const [lexeme, surface] of pool) entries.push({ surface, weight: lexeme.frequency, record: null, lexeme, key: (keyResult as { key: MaxTargetFormKey }).key });
	const value = grouped(entries);
	state.relaxed.set(memo, value); return value;
}
/**
 * High keeps the family and a genuine Source observation; MAX keeps only the safe Source-derived family. Neither reads the
 * Target's head or polarity: only `readAdverbBridge()`'s one following token, so the Target's own tokens stay and a candidate
 * ending in と never stands before a following と.
 */
function adverbRelaxed(state: TargetState, followedByTo: boolean, currentSurface: string, profile: Exclude<MaxProfile, "strict">): readonly Group[] {
	const memo = JSON.stringify(["adverb", profile, followedByTo, currentSurface]);
	const previous = state.relaxed.get(memo); if (previous) return previous;
	const entries = state.projection.adverb.family.filter(item => (profile === "max" || item.observed) && item.record.surface !== currentSurface &&
		!(followedByTo && adverbSurfaceEndsWithTo(item.identity.surface)))
		.map(item => ({ surface: item.record.surface, weight: item.record.frequency, record: item.record, lexeme: null }));
	const value = grouped(entries);
	state.relaxed.set(memo, value); return value;
}
/** Nouns: the whole authenticated automatic-body family. One pool per projection; the current surface is excluded at draw time. */
function nounPool(projection: MaxProjection, vocabulary: ManualMorphVocabulary) {
	const previous = NOUN_POOLS.get(projection); if (previous) return previous;
	const records = new Map(vocabulary.snapshot.projections.manual.candidates.map(record => [record.displayFormId, record as RecordLike]));
	const groups = frozen(projection.noun.family.map(surface => ({ surface: surface.surface, frequency: surface.frequency,
		entries: surface.candidates.map(ref => ({ record: records.get(ref.displayFormId)!, lexeme: null })) })));
	const value = { groups, records }; NOUN_POOLS.set(projection, value); return value;
}

/** Stateless draws over owned inputs, with a private latest-result seal. runCount is the requested canonical prefix. */
export function transformMax(input: { projection: MaxProjection; target: MaxTarget; runCount: number;
	options: AutomaticPosOptions; bodySemantropy: number; nonce: number; current?: MaxResult }): AutomaticPosAnswer<MaxResult> {
	return guarded(() => {
		const hasCurrent = input != null && Object.prototype.hasOwnProperty.call(input, "current");
		const data = fields(input, ["projection", "target", "runCount", "options", "bodySemantropy", "nonce", ...(hasCurrent ? ["current"] : [])]);
		const projection = data.projection as MaxProjection, target = data.target as MaxTarget;
		const state = targetState(projection, target), owned = resolveMaxProjection(projection);
		const options = fields(data.options, ["noun", "verb", "iAdjective", "adverb"]);
		if (Object.values(options).some(value => typeof value !== "boolean") || !Number.isInteger(data.nonce) ||
			(data.nonce as number) < 0 || (data.nonce as number) > 0xffffffff || !isMaxLevel(data.bodySemantropy) ||
			!Number.isSafeInteger(data.runCount) || (data.runCount as number) < 0 || (data.runCount as number) > state.runs.length) refuse("invalid-request");
		const nonce = data.nonce as number, level = data.bodySemantropy, runs = state.runs.slice(0, data.runCount as number);
		const current = hasCurrent ? data.current as MaxResult : null;
		if (hasCurrent && (!current || RESULTS.get(current) !== target)) refuse("provenance-mismatch");
		if (current && state.latest !== current) refuse("stale");
		// Starting a valid generation supersedes old prepared results, even if preparation subsequently fails.
		state.latest = null;
		const sequences = runs.map((run, i) => run.tokens.map((item, j) => ({ ...item, token: { ...item.token,
			surface: current?.tokenSurfaces[i]?.[j] ?? item.token.surface,
			isUnknown: item.token.isUnknown || !safeSurface(item.token.surface),
		} })));
		// Body 10's legacy noun transform at full application: every strict-eligible noun slot's surface, identity and Ruby.
		const nounStrict = options.noun ? transformWithVocabularySnapshot({ tokenSequences: sequences, snapshot: owned.vocabulary.snapshot,
			bodySeed: nonce, bodySemantropy: 100 as BodySemantropy, algorithmVersion: 1 }) : null;
		const surfaces = runs.map(run => run.tokens.map(item => item.token.surface));
		const selections = runs.map(run => run.tokens.map((): MaxSelection | null => null));
		const eligible = runs.map(run => run.tokens.map(() => false));
		const profiles = runs.map(run => run.tokens.map((): MaxProfile | null => null));
		const legacy = { verb: createSeededRandom(legacyDomain(nonce, "verb", "surface")),
			iAdjective: createSeededRandom(legacyDomain(nonce, "iAdjective", "surface")), adverb: createSeededRandom(legacyDomain(nonce, "adverb", "surface")) };
		const bases = new Map<Part, { profile: number; surface: number; identity: number; ruby: number }>();
		const base = (part: Part) => bases.get(part) ?? bases.set(part, { profile: maxDomainBase(nonce, part, "profile"),
			surface: maxDomainBase(nonce, part, "surface"), identity: maxDomainBase(nonce, part, "identity"), ruby: maxDomainBase(nonce, part, "ruby") }).get(part)!;
		const nouns = options.noun ? nounPool(projection, owned.vocabulary) : null;
		let replaceableSlotCount = 0, replacementCount = 0;
		for (const [i, run] of runs.entries()) for (const [j, item] of run.tokens.entries()) {
			const token = item.token;
			// Routing only: the Manual / Adverb authorities and the realizer decide eligibility.
			const part: Part | null = token.pos === "名詞" ? "noun" : token.pos === "動詞" ? "verb" : token.pos === "形容詞" ? "iAdjective" : token.pos === "副詞" ? "adverb" : null;
			if (!part || !options[part]) continue;
			const currentSurface = current?.tokenSurfaces[i]?.[j] ?? token.surface;
			let strictPick: { group: Choice } | null = null, strictEligible = false;
			let context: ReturnType<typeof adverbSlot> | null = null;
			const adverbContext = () => context ??= adverbSlot(state, run, j);
			if (part === "noun") {
				if (!isEligibleReplacementToken(sequences[i]![j]!.token)) continue;
				strictEligible = nounStrict!.selections[i]![j] !== null;
			} else {
				if (token.isUnknown || !safeSurface(token.surface)) continue;
				const strict = strictChoices(state, run, j, part, currentSurface, adverbContext);
				if (strict.length) {
					// Consumed for every strict-eligible slot in order, exactly as Body 10 does, whatever profile the slot takes.
					strictPick = { group: draw(strict, group => projection.drawMode === "frequency" ? group.frequency : 1, legacy[part]) };
					strictEligible = true;
				}
			}
			const profile = level > 50 ? maxProfileAt(level, maxUnit(maxSlotHash(base(part).profile, [item.tokenId]))) : "strict";
			// Recorded for every routed slot, eligible or not: the level contract is about the profile, not the candidate set.
			profiles[i]![j] = profile;
			let relaxed: { groups: readonly Group[]; exclude: string | null } | null = null;
			if (profile !== "strict") {
				if (part === "noun") relaxed = { groups: nouns!.groups, exclude: currentSurface };
				else if (part === "adverb") {
					const reading = readAdverbBridge(token, run.tokens[j + 1]?.token ?? null);
					relaxed = { groups: reading.supported ? adverbRelaxed(state, reading.followedByTo, currentSurface, profile) : [], exclude: null };
				} else relaxed = { groups: morphRelaxed(state, run, j, part, currentSurface, profile), exclude: null };
			}
			const exclude = relaxed?.exclude ?? null;
			// Morph and adverb pools already exclude the current surface; only the shared noun pool needs it here.
			const available = relaxed ? exclude === null ? relaxed.groups : relaxed.groups.filter(group => group.surface !== exclude) : null;
			if (available ? available.length === 0 : !strictEligible) continue;
			eligible[i]![j] = true; replaceableSlotCount++;
			if (!isMaxSlotApplied(nonce, { sequenceIndex: i, tokenIndex: j }, level)) continue;
			if (!available) {
				if (part === "noun") {
					surfaces[i]![j] = nounStrict!.tokenSurfaces[i]![j]!;
					selections[i]![j] = { ...nounStrict!.selections[i]![j]!, realization: null };
				} else {
					const identity = createSeededRandom(legacyDomain(nonce, part, JSON.stringify(["identity", item.tokenId])));
					const record = draw(strictPick!.group.candidates, () => 1, identity);
					const ruby = createSeededRandom(legacyDomain(nonce, part, JSON.stringify(["ruby", item.tokenId, record.displayFormId])));
					surfaces[i]![j] = record.surface;
					selections[i]![j] = { candidate: { candidateId: record.candidateId, displayFormId: record.displayFormId, surface: record.surface },
						rubyVariant: legacyRuby(record, ruby), realization: null };
				}
			} else {
				const domains = base(part);
				const group = pick(available, candidate => projection.drawMode === "frequency" ? candidate.frequency : 1,
					maxUnit(maxSlotHash(domains.surface, [item.tokenId, profile])));
				const entry = group.entries[Math.floor(maxUnit(maxSlotHash(domains.identity, [item.tokenId, group.surface])) * group.entries.length)]!;
				let record: RecordLike | null = entry.record, realization: MaxRealizationEvidence | null = null;
				if (entry.lexeme) {
					realization = { lexemeId: entry.lexeme.lexemeId, formKey: entry.key };
					// Ruby only from an observed record whose surface is exactly the realized one. Never synthesized from a reading.
					const observed = entry.lexeme.records.filter(candidate => candidate.surface === group.surface);
					record = observed.length ? observed[Math.floor(maxUnit(maxSlotHash(domains.identity, [item.tokenId, group.surface, entry.lexeme.lexemeId])) * observed.length)]! : null;
				}
				const candidate = record ? { candidateId: record.candidateId, displayFormId: record.displayFormId, surface: group.surface }
					: { candidateId: realization!.lexemeId, displayFormId: vocabularyDisplayFormId(realization!.lexemeId, group.surface), surface: group.surface };
				const variants = record?.verifiedRubyVariants ?? [];
				const rubyVariant = variants.length ? pick(variants, variant => variant.frequency, maxUnit(maxSlotHash(domains.ruby, [item.tokenId, candidate.displayFormId]))) : null;
				surfaces[i]![j] = group.surface;
				selections[i]![j] = { candidate, rubyVariant, realization };
			}
			replacementCount++;
		}
		targetState(projection, target);
		const result: MaxResult = frozen({ bodyAlgorithmVersion: MAX_BODY_ALGORITHM_VERSION, algorithmVersion: MAX_TRANSFORM_VERSION,
			projectionVersion: MAX_PROJECTION_VERSION, vocabularyFingerprint: projection.fingerprint, vocabularySources: projection.sources,
			targetSource: target.source, drawMode: projection.drawMode, bodySemantropy: level, runIds: runs.map(run => run.run.runId),
			texts: surfaces.map(run => run.join("")), tokenSurfaces: surfaces, selections, replaceableSlotCount, replacementCount });
		RESULTS.set(result, target); RESULT_SLOTS.set(result, frozen({ eligible, profiles })); state.latest = result;
		return result;
	});
}

/** A result is a prepared baseline, never a View commit. Recheck immediately before publication. */
export function inspectMaxResult(input: { projection: MaxProjection; target: MaxTarget; result: MaxResult }): AutomaticPosAnswer<true> {
	return guarded(() => {
		const data = fields(input, ["projection", "target", "result"]), target = data.target as MaxTarget;
		const state = targetState(data.projection as MaxProjection, target), result = data.result as MaxResult;
		if (RESULTS.get(result) !== target) refuse("provenance-mismatch");
		if (state.latest !== result) refuse("stale");
		return true;
	});
}
/** Read-only render seam: the exact analyzed runs and the eligibility / profile this result's own draw captured. */
export function readMaxResultSlots(input: { projection: MaxProjection; target: MaxTarget; result: MaxResult }) {
	return guarded(() => {
		const inspected = inspectMaxResult(input); if (!inspected.ok) refuse(inspected.reason);
		const state = targetState(input.projection, input.target), slots = RESULT_SLOTS.get(input.result)!;
		return frozen({ runs: state.runs.slice(0, input.result.runIds.length), eligible: slots.eligible, profiles: slots.profiles });
	});
}
export { createMaxProjection, inspectMaxProjection, releaseMaxOwner, type MaxProjection, type MaxReleaseReason } from "./maxProjection";
