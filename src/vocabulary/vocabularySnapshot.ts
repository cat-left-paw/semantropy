import type { LocatedToken } from "../analysis/locateTokens";
import {
	chooseRubyVariant,
	chooseVocabularyCandidate,
	createCandidateDrawContext,
	freezeAnalysis,
	type RubyVocabulary,
	type VerifiedRubyVariant,
	type VocabularyCandidate,
	type VocabularyOrigin,
	vocabularyCandidateId,
	vocabularyDisplayFormId,
} from "../analysis/rubyVocabulary";
import {
	FAKE_DICTIONARY_PLACEHOLDERS,
	classifyPlaceholder,
	type FakeDictionaryPlaceholder,
} from "../dictionary/placeholders";
import { createSeededRandom } from "../random/seededRandom";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import { isSlotApplied } from "../transform/slotScore";
import {
	isEligibleReplacementToken,
	vocabularyPoolKey,
} from "../transform/tokenPolicy";
import type { SelectedVocabularyCandidate } from "../transform/transformTokens";
import { sha256Hex } from "./sha256";
import {
	canonicalSourceWeights,
	drawWeight,
	sourceWeightLookup,
	type SourceWeight,
	type SourceWeightLookup,
} from "./sourceWeights";

export type VocabularyDrawMode = "uniform" | "frequency";

export const VOCABULARY_SNAPSHOT_POLICY_VERSION = "vocabulary-snapshot-1";
export const AUTOMATIC_BODY_PROJECTION_POLICY_VERSION =
	"automatic-body-projection-1";
export const MANUAL_PROJECTION_POLICY_VERSION = "manual-projection-1";
export const DICTIONARY_PROJECTION_POLICY_VERSION =
	"dictionary-projection-1";
export const COLLISION_PROJECTION_POLICY_VERSION = "collision-projection-1";
export const VOCABULARY_FINGERPRINT_VERSION =
	"vocabulary-fingerprint-sha256-1";
export const VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION = 1;

export const VOCABULARY_SNAPSHOT_ERROR_MESSAGE =
	"Could not build the vocabulary snapshot.";
export const VOCABULARY_SNAPSHOT_TRANSFORM_ERROR_MESSAGE =
	"Could not transform with the vocabulary snapshot.";

export type VocabularySnapshotErrorCode =
	| "invalid-source"
	| "conflicting-source"
	| "invalid-candidate"
	| "conflicting-candidate";

/** Fixed diagnostics only: Source paths, note text and Ruby readings stay out. */
export class VocabularySnapshotError extends Error {
	readonly code: VocabularySnapshotErrorCode;

	constructor(code: VocabularySnapshotErrorCode) {
		super(VOCABULARY_SNAPSHOT_ERROR_MESSAGE);
		this.name = "VocabularySnapshotError";
		this.code = code;
	}
}

export type VocabularySourceIdentity = {
	path: string;
	contentHash: string;
	projectionPolicy: string;
};

/** One already-analyzed Source. This core never receives or reads note text. */
export type AnalyzedVocabularySource = {
	source: VocabularySourceIdentity;
	vocabulary: RubyVocabulary;
};

export type VocabularyCandidateReference = {
	candidateId: string;
	displayFormId: string;
};

export type ProjectedVocabularySurface = {
	surface: string;
	frequency: number;
	origins: readonly VocabularyOrigin[];
	candidates: readonly VocabularyCandidateReference[];
};

export type AutomaticBodyVocabularyBucket = {
	key: string;
	surfaces: readonly ProjectedVocabularySurface[];
};

export type AutomaticBodyVocabularyProjection = {
	policyVersion: typeof AUTOMATIC_BODY_PROJECTION_POLICY_VERSION;
	buckets: readonly AutomaticBodyVocabularyBucket[];
};

/**
 * Morphology-rich records for later slot policies. Presence here is not a
 * claim that a verb, adjective, unknown word or other record is shuffleable.
 */
export type ManualVocabularyCandidate = {
	candidateId: string;
	displayFormId: string;
	surface: string;
	morphology: JapaneseToken;
	frequency: number;
	origins: readonly VocabularyOrigin[];
	verifiedRubyVariants: readonly VerifiedRubyVariant[];
	automaticBodyKey: string | null;
	dictionaryPlaceholder: FakeDictionaryPlaceholder | null;
	collisionRole: "noun" | "sahen" | null;
};

export type ManualVocabularyProjection = {
	policyVersion: typeof MANUAL_PROJECTION_POLICY_VERSION;
	candidates: readonly ManualVocabularyCandidate[];
};

export type DictionaryVocabularyProjection = {
	policyVersion: typeof DICTIONARY_PROJECTION_POLICY_VERSION;
	byPlaceholder: Readonly<
		Record<FakeDictionaryPlaceholder, readonly ProjectedVocabularySurface[]>
	>;
};

export type CollisionVocabularyProjection = {
	policyVersion: typeof COLLISION_PROJECTION_POLICY_VERSION;
	nouns: readonly ProjectedVocabularySurface[];
	sahenNouns: readonly ProjectedVocabularySurface[];
};

export type VocabularySnapshot = {
	policyVersion: typeof VOCABULARY_SNAPSHOT_POLICY_VERSION;
	drawMode: VocabularyDrawMode;
	sources: readonly VocabularySourceIdentity[];
	/**
	 * 0.1.0 S3: one weight per Source in `sources` order. Present only when
	 * some Source is not ×1, so an unweighted Snapshot is unchanged.
	 */
	sourceWeights?: readonly SourceWeight[];
	candidates: readonly VocabularyCandidate[];
	fingerprint: string;
	projections: {
		automaticBody: AutomaticBodyVocabularyProjection;
		manual: ManualVocabularyProjection;
		dictionary: DictionaryVocabularyProjection;
		collision: CollisionVocabularyProjection;
	};
};

type PreparedSource = {
	source: VocabularySourceIdentity;
	candidates: readonly VocabularyCandidate[];
	automaticBody: readonly {
		key: string;
		surfaces: readonly string[];
	}[];
	signature: string;
};

type MutableCandidate = {
	candidateId: string;
	displayFormId: string;
	surface: string;
	token: JapaneseToken;
	frequency: number;
	origins: VocabularyOrigin[];
	verifiedRubyVariants: VerifiedRubyVariant[];
};

function fail(code: VocabularySnapshotErrorCode): never {
	throw new VocabularySnapshotError(code);
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareOrigin(a: VocabularyOrigin, b: VocabularyOrigin): number {
	return compare(a.path, b.path) || compare(a.contentHash, b.contentHash);
}

function isPositiveCount(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function addCount(left: number, right: number): number {
	const total = left + right;
	if (!Number.isSafeInteger(total) || total <= 0) {
		return fail("invalid-candidate");
	}
	return total;
}

function isNormalizedVaultPath(path: string): boolean {
	if (
		path.length === 0 ||
		path.includes("\\") ||
		path.includes("\0") ||
		path.startsWith("/") ||
		path.endsWith("/") ||
		/^[A-Za-z]:/u.test(path)
	) {
		return false;
	}
	return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function validateSourceIdentity(
	source: VocabularySourceIdentity,
): VocabularySourceIdentity {
	if (
		!isNormalizedVaultPath(source.path) ||
		source.contentHash.length === 0 ||
		source.projectionPolicy.length === 0
	) {
		return fail("invalid-source");
	}
	return {
		path: source.path,
		contentHash: source.contentHash,
		projectionPolicy: source.projectionPolicy,
	};
}

function tokenIdentity(token: JapaneseToken): string {
	return JSON.stringify([
		token.surface,
		token.pos,
		token.detail1,
		token.detail2,
		token.detail3,
		token.conjugationType,
		token.conjugationForm,
		token.baseForm,
		token.reading ?? null,
		token.isUnknown,
	]);
}

function mergeOrigins(
	left: readonly VocabularyOrigin[],
	right: readonly VocabularyOrigin[],
): VocabularyOrigin[] {
	const counts = new Map<string, VocabularyOrigin>();
	for (const origin of [...left, ...right]) {
		if (!isPositiveCount(origin.count)) {
			return fail("invalid-candidate");
		}
		const key = JSON.stringify([origin.path, origin.contentHash]);
		const previous = counts.get(key);
		counts.set(key, {
			path: origin.path,
			contentHash: origin.contentHash,
			count: previous ? addCount(previous.count, origin.count) : origin.count,
		});
	}
	return [...counts.values()].sort(compareOrigin);
}

function sourceOrigins(
	origins: readonly VocabularyOrigin[],
	source: VocabularySourceIdentity,
	expectedFrequency: number,
): VocabularyOrigin[] {
	let count = 0;
	for (const origin of origins) {
		if (
			origin.path !== source.path ||
			origin.contentHash !== source.contentHash ||
			!isPositiveCount(origin.count)
		) {
			return fail("invalid-candidate");
		}
		count = addCount(count, origin.count);
	}
	if (count !== expectedFrequency) {
		return fail("invalid-candidate");
	}
	return [{ path: source.path, contentHash: source.contentHash, count }];
}

function mergeVariants(
	left: readonly VerifiedRubyVariant[],
	right: readonly VerifiedRubyVariant[],
): VerifiedRubyVariant[] {
	const variants = new Map<string, VerifiedRubyVariant>();
	for (const variant of [...left, ...right]) {
		const previous = variants.get(variant.variantId);
		if (
			previous &&
			(previous.reading !== variant.reading ||
				previous.baseRangeInSurface.start !== variant.baseRangeInSurface.start ||
				previous.baseRangeInSurface.end !== variant.baseRangeInSurface.end)
		) {
			return fail("conflicting-candidate");
		}
		if (!previous) {
			variants.set(variant.variantId, {
				variantId: variant.variantId,
				baseRangeInSurface: { ...variant.baseRangeInSurface },
				reading: variant.reading,
				sourceNotations: [...new Set(variant.sourceNotations)].sort(compare),
				frequency: variant.frequency,
				origins: mergeOrigins([], variant.origins),
			});
			continue;
		}
		variants.set(variant.variantId, {
			...previous,
			sourceNotations: [
				...new Set([
					...previous.sourceNotations,
					...variant.sourceNotations,
				]),
			].sort(compare),
			frequency: addCount(previous.frequency, variant.frequency),
			origins: mergeOrigins(previous.origins, variant.origins),
		});
	}
	return [...variants.values()].sort((a, b) => compare(a.variantId, b.variantId));
}

function normalizeVariant(
	variant: VerifiedRubyVariant,
	source: VocabularySourceIdentity,
	displayFormId: string,
	surface: string,
): VerifiedRubyVariant {
	const { start, end } = variant.baseRangeInSurface;
	const base = surface.slice(start, end);
	const expectedId = JSON.stringify([
		displayFormId,
		base.normalize("NFC"),
		variant.reading.normalize("NFC"),
		start,
		end,
	]);
	if (
		variant.variantId.length === 0 ||
		variant.variantId !== expectedId ||
		variant.reading.length === 0 ||
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		end > surface.length ||
		start >= end ||
		!isPositiveCount(variant.frequency)
	) {
		return fail("invalid-candidate");
	}
	return {
		variantId: variant.variantId,
		baseRangeInSurface: { start, end },
		reading: variant.reading,
		sourceNotations: [...new Set(variant.sourceNotations)].sort(compare),
		frequency: variant.frequency,
		origins: sourceOrigins(variant.origins, source, variant.frequency),
	};
}

function mergeCandidate(
	records: Map<string, MutableCandidate>,
	candidate: VocabularyCandidate,
): void {
	const previous = records.get(candidate.displayFormId);
	if (
		previous &&
		(previous.candidateId !== candidate.candidateId ||
			previous.surface !== candidate.surface ||
			tokenIdentity(previous.token) !== tokenIdentity(candidate.token))
	) {
		return fail("conflicting-candidate");
	}
	if (!previous) {
		records.set(candidate.displayFormId, {
			candidateId: candidate.candidateId,
			displayFormId: candidate.displayFormId,
			surface: candidate.surface,
			token: { ...candidate.token },
			frequency: candidate.frequency,
			origins: [...candidate.origins],
			verifiedRubyVariants: [...candidate.verifiedRubyVariants],
		});
		return;
	}
	previous.frequency = addCount(previous.frequency, candidate.frequency);
	previous.origins = mergeOrigins(previous.origins, candidate.origins);
	previous.verifiedRubyVariants = mergeVariants(
		previous.verifiedRubyVariants,
		candidate.verifiedRubyVariants,
	);
}

function normalizeCandidates(
	input: readonly VocabularyCandidate[],
	source: VocabularySourceIdentity,
): readonly VocabularyCandidate[] {
	const records = new Map<string, MutableCandidate>();
	for (const candidate of input) {
		if (
			!isPositiveCount(candidate.frequency) ||
			candidate.candidateId !== vocabularyCandidateId(candidate.token) ||
			candidate.displayFormId !==
				vocabularyDisplayFormId(candidate.candidateId, candidate.surface) ||
			candidate.token.surface !== candidate.surface
		) {
			return fail("invalid-candidate");
		}
		const variants = mergeVariants(
			[],
			candidate.verifiedRubyVariants.map((variant) =>
				normalizeVariant(
					variant,
					source,
					candidate.displayFormId,
					candidate.surface,
				),
			),
		);
		const variantFrequency = variants.reduce(
			(total, variant) => addCount(total, variant.frequency),
			0,
		);
		if (variants.length > 0 && variantFrequency > candidate.frequency) {
			return fail("invalid-candidate");
		}
		mergeCandidate(records, {
			candidateId: candidate.candidateId,
			displayFormId: candidate.displayFormId,
			surface: candidate.surface,
			token: { ...candidate.token },
			frequency: candidate.frequency,
			origins: sourceOrigins(candidate.origins, source, candidate.frequency),
			verifiedRubyVariants: variants,
		});
	}
	return [...records.values()].sort((a, b) =>
		compare(a.displayFormId, b.displayFormId),
	);
}

function normalizeAutomaticBody(
	vocabulary: RubyVocabulary,
	candidates: readonly VocabularyCandidate[],
): readonly { key: string; surfaces: readonly string[] }[] {
	const expected = new Map<string, Set<string>>();
	for (const candidate of candidates) {
		if (!isEligibleReplacementToken(candidate.token)) {
			continue;
		}
		const key = vocabularyPoolKey(candidate.token);
		const surfaces = expected.get(key) ?? new Set<string>();
		surfaces.add(candidate.surface);
		expected.set(key, surfaces);
	}

	const normalized: { key: string; surfaces: readonly string[] }[] = [];
	for (const [key, sourceSurfaces] of vocabulary.automaticBody) {
		const unique = new Set(sourceSurfaces);
		const expectedSurfaces = expected.get(key);
		if (
			unique.size !== sourceSurfaces.length ||
			!expectedSurfaces ||
			unique.size !== expectedSurfaces.size ||
			[...unique].some((surface) => !expectedSurfaces.has(surface))
		) {
			return fail("invalid-candidate");
		}
		normalized.push({ key, surfaces: [...sourceSurfaces] });
	}
	if (
		normalized.length !== expected.size ||
		[...expected.keys()].some(
			(key) => !normalized.some((entry) => entry.key === key),
		)
	) {
		return fail("invalid-candidate");
	}
	return normalized.sort((a, b) => compare(a.key, b.key));
}

function candidateRecord(candidate: VocabularyCandidate): unknown {
	return [
		candidate.candidateId,
		candidate.displayFormId,
		candidate.surface,
		tokenIdentity(candidate.token),
		candidate.frequency,
		candidate.origins.map((origin) => [
			origin.path,
			origin.contentHash,
			origin.count,
		]),
		candidate.verifiedRubyVariants.map((variant) => [
			variant.variantId,
			variant.reading,
			variant.baseRangeInSurface.start,
			variant.baseRangeInSurface.end,
			variant.frequency,
			variant.sourceNotations,
			variant.origins.map((origin) => [
				origin.path,
				origin.contentHash,
				origin.count,
			]),
		]),
	];
}

function prepareSource(input: AnalyzedVocabularySource): PreparedSource {
	const source = validateSourceIdentity(input.source);
	const candidates = normalizeCandidates(input.vocabulary.candidates, source);
	const automaticBody = normalizeAutomaticBody(input.vocabulary, candidates);
	return {
		source,
		candidates,
		automaticBody,
		signature: JSON.stringify([
			candidates.map(candidateRecord),
			automaticBody.map((entry) => [entry.key, entry.surfaces]),
		]),
	};
}

function prepareSources(
	inputs: readonly AnalyzedVocabularySource[],
): readonly PreparedSource[] {
	if (inputs.length === 0) {
		return fail("invalid-source");
	}
	const byPath = new Map<string, PreparedSource>();
	for (const input of inputs) {
		const prepared = prepareSource(input);
		const previous = byPath.get(prepared.source.path);
		if (!previous) {
			byPath.set(prepared.source.path, prepared);
			continue;
		}
		if (
			previous.source.contentHash !== prepared.source.contentHash ||
			previous.source.projectionPolicy !==
				prepared.source.projectionPolicy ||
			previous.signature !== prepared.signature
		) {
			return fail("conflicting-source");
		}
	}
	return [...byPath.values()].sort((a, b) =>
		compare(a.source.path, b.source.path),
	);
}

function aggregateCandidates(
	sources: readonly PreparedSource[],
): readonly VocabularyCandidate[] {
	const records = new Map<string, MutableCandidate>();
	for (const source of sources) {
		for (const candidate of source.candidates) {
			mergeCandidate(records, candidate);
		}
	}
	return [...records.values()].sort((a, b) =>
		compare(a.displayFormId, b.displayFormId),
	);
}

function candidateReference(
	candidate: VocabularyCandidate,
): VocabularyCandidateReference {
	return {
		candidateId: candidate.candidateId,
		displayFormId: candidate.displayFormId,
	};
}

function projectSurfaces(
	candidates: readonly VocabularyCandidate[],
	preferredOrder?: readonly string[],
): readonly ProjectedVocabularySurface[] {
	const grouped = new Map<string, VocabularyCandidate[]>();
	for (const candidate of candidates) {
		const bucket = grouped.get(candidate.surface) ?? [];
		bucket.push(candidate);
		grouped.set(candidate.surface, bucket);
	}
	const surfaces = [
		...new Set([
			...(preferredOrder ?? []),
			...[...grouped.keys()].sort(compare),
		]),
	].filter((surface) => grouped.has(surface));
	return surfaces.map((surface) => {
		const records = grouped.get(surface) ?? [];
		return {
			surface,
			frequency: records.reduce(
				(total, candidate) => addCount(total, candidate.frequency),
				0,
			),
			origins: records.reduce<VocabularyOrigin[]>(
				(origins, candidate) => mergeOrigins(origins, candidate.origins),
				[],
			),
			candidates: records
				.map(candidateReference)
				.sort(
					(a, b) =>
						compare(a.candidateId, b.candidateId) ||
						compare(a.displayFormId, b.displayFormId),
				),
		};
	});
}

function automaticProjection(
	sources: readonly PreparedSource[],
	candidates: readonly VocabularyCandidate[],
): AutomaticBodyVocabularyProjection {
	const byKey = new Map<string, VocabularyCandidate[]>();
	for (const candidate of candidates) {
		if (!isEligibleReplacementToken(candidate.token)) {
			continue;
		}
		const key = vocabularyPoolKey(candidate.token);
		const bucket = byKey.get(key) ?? [];
		bucket.push(candidate);
		byKey.set(key, bucket);
	}
	const buckets = [...byKey.keys()].sort(compare).map((key) => {
		const order: string[] = [];
		for (const source of sources) {
			const entry = source.automaticBody.find((item) => item.key === key);
			for (const surface of entry?.surfaces ?? []) {
				if (!order.includes(surface)) {
					order.push(surface);
				}
			}
		}
		return {
			key,
			surfaces: projectSurfaces(byKey.get(key) ?? [], order),
		};
	});
	return { policyVersion: AUTOMATIC_BODY_PROJECTION_POLICY_VERSION, buckets };
}

function collisionRole(
	token: JapaneseToken,
): "noun" | "sahen" | null {
	if (!isEligibleReplacementToken(token)) {
		return null;
	}
	return token.detail1 === "サ変接続" ? "sahen" : "noun";
}

function manualProjection(
	candidates: readonly VocabularyCandidate[],
): ManualVocabularyProjection {
	return {
		policyVersion: MANUAL_PROJECTION_POLICY_VERSION,
		candidates: candidates.map((candidate) => ({
			candidateId: candidate.candidateId,
			displayFormId: candidate.displayFormId,
			surface: candidate.surface,
			morphology: { ...candidate.token },
			frequency: candidate.frequency,
			origins: candidate.origins,
			verifiedRubyVariants: candidate.verifiedRubyVariants,
			automaticBodyKey: isEligibleReplacementToken(candidate.token)
				? vocabularyPoolKey(candidate.token)
				: null,
			dictionaryPlaceholder: classifyPlaceholder(candidate.token),
			collisionRole: collisionRole(candidate.token),
		})),
	};
}

function dictionaryProjection(
	candidates: readonly VocabularyCandidate[],
): DictionaryVocabularyProjection {
	const projected = {} as Record<
		FakeDictionaryPlaceholder,
		readonly ProjectedVocabularySurface[]
	>;
	for (const placeholder of FAKE_DICTIONARY_PLACEHOLDERS) {
		projected[placeholder] = projectSurfaces(
			candidates.filter(
				(candidate) => classifyPlaceholder(candidate.token) === placeholder,
			),
		);
	}
	return {
		policyVersion: DICTIONARY_PROJECTION_POLICY_VERSION,
		byPlaceholder: projected,
	};
}

function collisionProjection(
	candidates: readonly VocabularyCandidate[],
): CollisionVocabularyProjection {
	return {
		policyVersion: COLLISION_PROJECTION_POLICY_VERSION,
		nouns: projectSurfaces(
			candidates.filter(
				(candidate) => collisionRole(candidate.token) === "noun",
			),
		),
		sahenNouns: projectSurfaces(
			candidates.filter(
				(candidate) => collisionRole(candidate.token) === "sahen",
			),
		),
	};
}

function fingerprint(
	drawMode: VocabularyDrawMode,
	sources: readonly VocabularySourceIdentity[],
	candidates: readonly VocabularyCandidate[],
	projections: VocabularySnapshot["projections"],
	sourceWeights: readonly SourceWeight[] | null,
): string {
	const payload: unknown[] = [
		VOCABULARY_SNAPSHOT_POLICY_VERSION,
		drawMode,
		sources.map((source) => [
			source.path,
			source.contentHash,
			source.projectionPolicy,
		]),
		candidates.map(candidateRecord),
		[
			projections.automaticBody.policyVersion,
			projections.automaticBody.buckets.map((bucket) => [
				bucket.key,
				bucket.surfaces.map((surface) => [
					surface.surface,
					surface.frequency,
					surface.candidates.map((candidate) => [
						candidate.candidateId,
						candidate.displayFormId,
					]),
				]),
			]),
		],
		projections.manual.policyVersion,
		projections.dictionary.policyVersion,
		projections.collision.policyVersion,
	];
	// Only a weighted Snapshot adds this, so every unweighted fingerprint is unchanged.
	if (sourceWeights) payload.push(["source-weights-1", sourceWeights]);
	return `${VOCABULARY_FINGERPRINT_VERSION}:${sha256Hex(JSON.stringify(payload))}`;
}

/**
 * Canonically and atomically aggregates already-analyzed Source vocabularies.
 * It performs no I/O, tokenization, logging, rendering or persistence.
 */
export function buildVocabularySnapshot(input: {
	sources: readonly AnalyzedVocabularySource[];
	drawMode: VocabularyDrawMode;
	/** 0.1.0 S3: weight by Source path; a missing path is ×1. */
	sourceWeights?: Readonly<Record<string, unknown>> | null;
}): VocabularySnapshot {
	if (input.drawMode !== "uniform" && input.drawMode !== "frequency") {
		return fail("invalid-source");
	}
	const prepared = prepareSources(input.sources);
	const sources = prepared.map((source) => source.source);
	const sourceWeights = canonicalSourceWeights(
		sources.map((source) => source.path),
		input.sourceWeights,
	);
	if (sourceWeights === undefined) {
		return fail("invalid-source");
	}
	const candidates = aggregateCandidates(prepared);
	const projections = {
		automaticBody: automaticProjection(prepared, candidates),
		manual: manualProjection(candidates),
		dictionary: dictionaryProjection(candidates),
		collision: collisionProjection(candidates),
	};
	return freezeAnalysis({
		policyVersion: VOCABULARY_SNAPSHOT_POLICY_VERSION,
		drawMode: input.drawMode,
		sources,
		...(sourceWeights ? { sourceWeights } : {}),
		candidates,
		fingerprint: fingerprint(
			input.drawMode,
			sources,
			candidates,
			projections,
			sourceWeights,
		),
		projections,
	});
}

export type VocabularySnapshotSelection = {
	candidate: SelectedVocabularyCandidate;
	rubyVariant: VerifiedRubyVariant | null;
};

export type VocabularySnapshotTransformResult = {
	texts: readonly string[];
	tokenSurfaces: readonly (readonly string[])[];
	selections: readonly (readonly (VocabularySnapshotSelection | null)[])[];
	replacementCount: number;
	replaceableSlotCount: number;
	bodySemantropy: BodySemantropy;
	drawMode: VocabularyDrawMode;
	vocabularyFingerprint: string;
	algorithmVersion: typeof VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION;
};

function drawSurface(
	choices: readonly ProjectedVocabularySurface[],
	mode: VocabularyDrawMode,
	random: ReturnType<typeof createSeededRandom>,
	weights: SourceWeightLookup = null,
): ProjectedVocabularySurface {
	if (weights === null && mode === "uniform") {
		return choices[Math.floor(random.next() * choices.length)]!;
	}
	// Unweighted, this is the Frequency walk exactly as before.
	const weightOf = (candidate: ProjectedVocabularySurface) =>
		drawWeight(mode, weights, candidate.frequency, candidate.origins);
	const total = choices.reduce(
		(sum, candidate) => addCount(sum, weightOf(candidate)),
		0,
	);
	let draw = random.next() * total;
	for (const choice of choices) {
		draw -= weightOf(choice);
		if (draw < 0) {
			return choice;
		}
	}
	return choices[choices.length - 1]!;
}

/**
 * Pure seam for the future View integration. Primary surface draws alone use
 * the sequential body RNG; identity and Ruby draws keep their existing
 * derived domains and never consume that stream.
 */
export function transformWithVocabularySnapshot(input: {
	tokenSequences: readonly (readonly Pick<LocatedToken, "tokenId" | "token">[])[];
	snapshot: VocabularySnapshot;
	bodySeed: number;
	bodySemantropy: BodySemantropy;
	algorithmVersion: typeof VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION;
}): VocabularySnapshotTransformResult {
	if (
		input.algorithmVersion !==
		VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION
	) {
		throw new Error(VOCABULARY_SNAPSHOT_TRANSFORM_ERROR_MESSAGE);
	}
	const random = createSeededRandom(input.bodySeed);
	const bucketByKey = new Map(
		input.snapshot.projections.automaticBody.buckets.map((bucket) => [
			bucket.key,
			bucket,
		]),
	);
	const provenance: RubyVocabulary = {
		candidates: input.snapshot.candidates,
		fingerprint: input.snapshot.fingerprint,
		automaticBody: new Map(),
	};
	const context = createCandidateDrawContext(provenance, input.bodySeed);
	const weights = sourceWeightLookup(input.snapshot);
	const texts: string[] = [];
	const tokenSurfaces: string[][] = [];
	const selections: (VocabularySnapshotSelection | null)[][] = [];
	let replacementCount = 0;
	let replaceableSlotCount = 0;

	for (const [sequenceIndex, sequence] of input.tokenSequences.entries()) {
		let text = "";
		const surfaces: string[] = [];
		const selected: (VocabularySnapshotSelection | null)[] = [];
		for (const [tokenIndex, item] of sequence.entries()) {
			const token = item.token;
			const bucket = isEligibleReplacementToken(token)
				? bucketByKey.get(vocabularyPoolKey(token))
				: undefined;
			const choices = (bucket?.surfaces ?? []).filter(
				(candidate) => candidate.surface !== token.surface,
			);
			if (choices.length === 0) {
				text += token.surface;
				surfaces.push(token.surface);
				selected.push(null);
				continue;
			}

			replaceableSlotCount += 1;
			const surface = drawSurface(
				choices,
				input.snapshot.drawMode,
				random,
				weights,
			).surface;
			const applied = isSlotApplied(
				input.bodySeed,
				{ sequenceIndex, tokenIndex },
				input.bodySemantropy,
			);
			if (!applied) {
				text += token.surface;
				surfaces.push(token.surface);
				selected.push(null);
				continue;
			}

			const candidate = chooseVocabularyCandidate({
				vocabulary: provenance,
				original: token,
				surface,
				seed: input.bodySeed,
				tokenId: item.tokenId,
				context,
			});
			const rubyVariant = chooseRubyVariant({
				vocabulary: provenance,
				original: token,
				selection: candidate,
				seed: input.bodySeed,
				tokenId: item.tokenId,
				context,
			});
			text += surface;
			surfaces.push(surface);
			selected.push({ candidate, rubyVariant });
			replacementCount += 1;
		}
		texts.push(text);
		tokenSurfaces.push(surfaces);
		selections.push(selected);
	}

	return freezeAnalysis({
		texts,
		tokenSurfaces,
		selections,
		replacementCount,
		replaceableSlotCount,
		bodySemantropy: input.bodySemantropy,
		drawMode: input.snapshot.drawMode,
		vocabularyFingerprint: input.snapshot.fingerprint,
		algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
	});
}
