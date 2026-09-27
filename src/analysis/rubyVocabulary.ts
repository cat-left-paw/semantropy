import type { LocatedAnalysisDocument, LocatedAnalysisRun } from "./locateTokens";
import type { RubyNotation, Utf16Range } from "./rubyAnalysis";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { createSeededRandom } from "../random/seededRandom";
import { isEligibleReplacementToken, vocabularyPoolKey } from "../transform/tokenPolicy";
import { buildVocabularyPool, type SelectedVocabularyCandidate, type VocabularyPool } from "../transform/transformTokens";

export type VocabularyOrigin = { path: string; contentHash: string; count: number };
export type VerifiedRubyVariant = {
	variantId: string;
	baseRangeInSurface: Utf16Range;
	reading: string;
	sourceNotations: readonly RubyNotation[];
	frequency: number;
	origins: readonly VocabularyOrigin[];
};
export type VocabularyCandidate = {
	candidateId: string;
	/** Canonical identity + exact raw surface; ranges belong to this form only. */
	displayFormId: string;
	surface: string;
	token: JapaneseToken;
	frequency: number;
	origins: readonly VocabularyOrigin[];
	verifiedRubyVariants: readonly VerifiedRubyVariant[];
};
export type RubyVocabulary = {
	candidates: readonly VocabularyCandidate[];
	fingerprint: string;
	/** Current Note's noun/surface projection in first-source-occurrence order. */
	automaticBody: VocabularyPool;
};

/** Canonical, unambiguous identity; never derived from display ruby readings. */
export function vocabularyCandidateId(token: JapaneseToken): string {
	return JSON.stringify([
		token.surface.normalize("NFC"), token.pos, token.detail1, token.detail2,
		token.detail3, token.conjugationType, token.conjugationForm,
		token.baseForm, token.reading ?? null, token.isUnknown,
	]);
}

export function vocabularyDisplayFormId(candidateId: string, surface: string): string {
	return JSON.stringify([candidateId, surface]);
}

export function rangesOverlap(a: Utf16Range, b: Utf16Range): boolean {
	return a.start < b.end && b.start < a.end;
}

export function verifiedVariantForToken(
	located: LocatedAnalysisRun,
	index: number,
	candidateId: string,
	origin: VocabularyOrigin,
): VerifiedRubyVariant | null {
	const item = located.tokens[index];
	if (!item) return null;
	const annotations = located.run.annotations.filter((a) => rangesOverlap(a.baseRange, item.range));
	const annotation = annotations[0];
	if (annotations.length !== 1 || !annotation) return null;
	const baseRangeInSurface = {
		start: annotation.baseRange.start - item.range.start,
		end: annotation.baseRange.end - item.range.start,
	};
	const surface = item.token.surface;
	const { start, end } = baseRangeInSurface;
	if (start < 0 || end > surface.length || start >= end) return null;
	if (located.tokens.some((other, i) => i !== index && rangesOverlap(other.range, annotation.baseRange))) return null;
	const base = located.run.analysisText.slice(annotation.baseRange.start, annotation.baseRange.end);
	if (surface.slice(start, end) !== base || surface.slice(0, start) + base + surface.slice(end) !== surface) return null;
	return {
		variantId: JSON.stringify([vocabularyDisplayFormId(candidateId, surface), base.normalize("NFC"), annotation.reading.normalize("NFC"), start, end]),
		baseRangeInSurface, reading: annotation.reading,
		sourceNotations: [annotation.notation], frequency: 1, origins: [{ ...origin, count: 1 }],
	};
}

/** Recursively freeze only pure snapshot records, never DOM or tokenizer instances. */
export function freezeAnalysis<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freezeAnalysis(child);
		Object.freeze(value);
	}
	return value;
}

export function buildRubyVocabulary(
	document: LocatedAnalysisDocument,
	source: { path: string; contentHash: string },
): RubyVocabulary {
	const records = new Map<string, VocabularyCandidate>();
	for (const run of document.runs) {
		for (const [index, item] of run.tokens.entries()) {
			const candidateId = vocabularyCandidateId(item.token);
			const displayFormId = vocabularyDisplayFormId(candidateId, item.token.surface);
			const origin = { ...source, count: 1 };
			const previous = records.get(displayFormId);
			const variants = [...(previous?.verifiedRubyVariants ?? [])];
			const found = verifiedVariantForToken(run, index, candidateId, origin);
			if (found) {
				const existingIndex = variants.findIndex((v) => v.variantId === found.variantId);
				const existing = variants[existingIndex];
				if (existing) {
					variants.splice(existingIndex, 1, {
						...existing, frequency: existing.frequency + 1,
						origins: [{ ...origin, count: existing.frequency + 1 }],
						sourceNotations: [...new Set([...existing.sourceNotations, ...found.sourceNotations])].sort(),
					});
				} else variants.push(found);
			}
			records.set(displayFormId, {
				candidateId, displayFormId, surface: item.token.surface, token: { ...item.token },
				frequency: (previous?.frequency ?? 0) + 1,
				origins: [{ ...origin, count: (previous?.frequency ?? 0) + 1 }],
				verifiedRubyVariants: variants.sort((a, b) => compare(a.variantId, b.variantId)),
			});
		}
	}
	const candidates = [...records.values()].sort((a, b) => compare(a.displayFormId, b.displayFormId));
	return freezeAnalysis({
		candidates,
		// Identity/frequency are canonical above; the legacy primary draw order
		// is a separate projection, not a second source of vocabulary records.
		automaticBody: buildVocabularyPool([[...records.values()].map((candidate) => candidate.token)]),
		fingerprint: JSON.stringify(["ruby-policy-2", "uniform", source.path, source.contentHash,
			candidates.map((c) => [c.candidateId, c.displayFormId, c.frequency, c.verifiedRubyVariants.map((v) => [v.variantId, v.frequency])])]),
	});
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

const FNV_OFFSET = 2166136261;

function fnv1a(state: number, value: string): number {
	let hash = state;
	for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
	return hash;
}

function derivedSeed(value: string): number {
	return fnv1a(FNV_OFFSET, value) >>> 0;
}

/**
 * FNV-1a is sequential, so hashing `JSON.stringify([...head, ...tail])` equals
 * continuing from the state after `JSON.stringify(head)` minus its "]" plus
 * ",". The head holds the large fingerprint; only the short tail is hashed per
 * token. Results are bit-identical to `derivedSeed(JSON.stringify([...]))`.
 */
function prefixState(head: readonly unknown[]): number {
	return fnv1a(FNV_OFFSET, `${JSON.stringify(head).slice(0, -1)},`);
}

function continueSeed(state: number, tail: readonly unknown[]): number {
	return fnv1a(state, JSON.stringify(tail).slice(1)) >>> 0;
}

type CandidateIndex = {
	bySurface: ReadonlyMap<string, readonly VocabularyCandidate[]>;
	byForm: ReadonlyMap<string, readonly VocabularyCandidate[]>;
};

/** Transient lookup over one frozen candidate array; never persisted or fingerprinted. */
const candidateIndexes = new WeakMap<readonly VocabularyCandidate[], CandidateIndex>();

function candidateIndex(candidates: readonly VocabularyCandidate[]): CandidateIndex {
	let index = candidateIndexes.get(candidates);
	if (!index) {
		const bySurface = new Map<string, VocabularyCandidate[]>();
		const byForm = new Map<string, VocabularyCandidate[]>();
		// Buckets keep canonical array order, so a filtered bucket equals the
		// same filter over the whole array.
		for (const candidate of candidates) {
			const surface = bySurface.get(candidate.surface);
			if (surface) surface.push(candidate); else bySurface.set(candidate.surface, [candidate]);
			const form = byForm.get(candidate.displayFormId);
			if (form) form.push(candidate); else byForm.set(candidate.displayFormId, [candidate]);
		}
		index = { bySurface, byForm };
		// Only frozen (immutable) arrays may be cached; a mutable test array is re-indexed.
		if (Object.isFrozen(candidates)) candidateIndexes.set(candidates, index);
	}
	return index;
}

/**
 * Per-(vocabulary, seed) draw state for one Reshuffle / level change. It only
 * caches the hash prefix of the existing secondary draw domains, so every
 * draw is identical to the context-free call.
 */
export type CandidateDrawContext = {
	readonly vocabulary: RubyVocabulary;
	readonly seed: number;
	readonly identityState: number;
	readonly variantState: number;
};

export function createCandidateDrawContext(vocabulary: RubyVocabulary, seed: number): CandidateDrawContext {
	return {
		vocabulary, seed,
		identityState: prefixState(["candidate-identity-1", seed, vocabulary.fingerprint]),
		variantState: prefixState(["ruby-variant-2", seed, vocabulary.fingerprint]),
	};
}

function drawContext(input: { vocabulary: RubyVocabulary; seed: number; context?: CandidateDrawContext }): CandidateDrawContext | null {
	if (!input.context) return null;
	if (input.context.vocabulary !== input.vocabulary || input.context.seed !== input.seed) {
		throw new Error("Candidate draw context does not match the draw.");
	}
	return input.context;
}

/** Independent identity draw among eligible records for the already-chosen raw surface. */
export function chooseVocabularyCandidate(input: {
	vocabulary: RubyVocabulary; original: JapaneseToken; surface: string; seed: number; tokenId: string;
	context?: CandidateDrawContext;
}): SelectedVocabularyCandidate {
	const context = drawContext(input);
	const bucket = candidateIndex(input.vocabulary.candidates).bySurface.get(input.surface) ?? [];
	const candidates = bucket.filter((c) => c.surface === input.surface && compatibleCandidate(c, input.original));
	if (!candidates.length) throw new Error("Replacement candidate provenance is missing.");
	const random = createSeededRandom(context
		? continueSeed(context.identityState, [input.tokenId, input.surface])
		: derivedSeed(JSON.stringify(["candidate-identity-1", input.seed, input.vocabulary.fingerprint, input.tokenId, input.surface])));
	const selected = candidates[Math.floor(random.next() * candidates.length)]!;
	return { candidateId: selected.candidateId, displayFormId: selected.displayFormId, surface: selected.surface };
}

function compatibleCandidate(candidate: VocabularyCandidate, original: JapaneseToken): boolean {
	return isEligibleReplacementToken(original) && isEligibleReplacementToken(candidate.token) &&
		vocabularyPoolKey(candidate.token) === vocabularyPoolKey(original);
}

/** Resolve the exact selected record, never another record with the same surface. */
export function resolveVocabularyCandidate(input: {
	vocabulary: RubyVocabulary; original: JapaneseToken; selection: SelectedVocabularyCandidate;
}): VocabularyCandidate {
	const bucket = candidateIndex(input.vocabulary.candidates).byForm.get(input.selection.displayFormId) ?? [];
	const candidate = bucket.find((c) =>
		c.candidateId === input.selection.candidateId && c.displayFormId === input.selection.displayFormId &&
		c.surface === input.selection.surface && compatibleCandidate(c, input.original));
	if (!candidate) throw new Error("Selected vocabulary candidate is invalid.");
	return candidate;
}

/** Variant draw stays inside the selected eligible identity AND exact display form. */
export function chooseRubyVariant(input: {
	vocabulary: RubyVocabulary; original: JapaneseToken; selection: SelectedVocabularyCandidate; seed: number; tokenId: string;
	context?: CandidateDrawContext;
}): VerifiedRubyVariant | null {
	const context = drawContext(input);
	const candidate = resolveVocabularyCandidate(input);
	const variants = candidate.verifiedRubyVariants;
	if (!variants.length) return null;
	const random = createSeededRandom(context
		? continueSeed(context.variantState, [input.tokenId, candidate.candidateId, candidate.displayFormId])
		: derivedSeed(JSON.stringify([
			"ruby-variant-2", input.seed, input.vocabulary.fingerprint, input.tokenId, candidate.candidateId, candidate.displayFormId,
		])));
	let draw = random.next() * variants.reduce((sum, v) => sum + v.frequency, 0);
	for (const variant of variants) {
		draw -= variant.frequency;
		if (draw < 0) return variant;
	}
	return variants[variants.length - 1] ?? null;
}
