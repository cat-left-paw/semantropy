import type { LocatedToken } from "./locateTokens";
import {
	freezeAnalysis,
	rangesOverlap,
	vocabularyDisplayFormId,
	type VerifiedRubyVariant,
	type VocabularyCandidate,
	type VocabularyOrigin,
} from "./rubyVocabulary";
import type { Utf16Range } from "./rubyAnalysis";
import { dictionaryBucketOf } from "../dictionary/dictionaryBuckets";
import {
	validateHeadword,
	type HeadwordValidation,
} from "../dictionary/headword";
import { STANDARD_TEMPLATE_SET } from "../dictionary/standardTemplateSet";
import type { DictionarySemantropy } from "../settings/dictionarySemantropy";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import {
	isEligibleReplacementToken,
	vocabularyPoolKey,
} from "../transform/tokenPolicy";
import {
	VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
	transformWithVocabularySnapshot,
	type VocabularyDrawMode,
	type VocabularySnapshot,
	type VocabularySnapshotSelection,
	type VocabularySnapshotTransformResult,
} from "../vocabulary/vocabularySnapshot";
import type { BodySemantropy } from "../settings/bodySemantropy";
import { readMaxResultSlots, type MaxResult, type MaxTarget } from "../transform/maxCore";
import { resolveMaxProjection, type MaxProjection } from "../transform/maxProjection";
import { MAX_TRANSFORM_VERSION } from "../transform/maxVersions";
import type { ManualAdverbReason } from "../transform/manualAdverbGuard";

/**
 * PRE-RELEASE-TOKENS1-CORE1: immutable DisplaySlot IR for materialized Target
 * Chunks. Used by the production Chunk controller. It does not render, patch
 * DOM, shuffle, or apply a Manual override.
 *
 * Layers this slice implements:
 *
 *   original -> automatic -> display
 *
 * `display` is the identity of `automatic`. MANUAL-NOUN1 inserts override
 * between those two layers through `resolveDisplayLayer`.
 *
 * Transform and slot planning are one atomic call. Callers cannot mint a
 * transform and later restamp it onto different Chunk / run / Ruby identity.
 */

export const DISPLAY_SLOT_POLICY_VERSION = "display-slots-1";

export const DISPLAY_SLOT_ERROR_MESSAGE = "Could not plan display slots.";

export type DisplaySlotErrorCode =
	| "invalid-input"
	| "incompatible-transform"
	| "invalid-candidate";

export class DisplaySlotError extends Error {
	readonly code: DisplaySlotErrorCode;

	constructor(code: DisplaySlotErrorCode) {
		super(DISPLAY_SLOT_ERROR_MESSAGE);
		this.name = "DisplaySlotError";
		this.code = code;
	}
}

export type ManualOverride =
	| { readonly kind: "replacement"; readonly candidateId: string; readonly displayFormId: string;
		readonly surface: string; readonly connectionKey: string | null; readonly rubyVariantId: string | null; readonly localRevision: number }
	| { readonly kind: "restore-original"; readonly localRevision: number };
export type PendingManualOverride = ManualOverride | null;

export type DisplayMarkerVisibility = {
	readonly replacement?: boolean;
	readonly manual?: boolean;
	readonly dictionary?: boolean;
};

/**
 * Why Manual Shuffle is unavailable for one slot, in the Manual Morph core's
 * own vocabulary.
 *
 * This pure layer never re-derives a reason from a surface, a reading or a
 * dictionary field: `applyManualDisplay` copies the core's structured
 * `ManualMorphRejection` verbatim, and `assertDiagnosticReason` there is the
 * typecheck bridge that fails the build if the core gains a reason this union
 * does not carry. Presentation strings live in the view layer, never here.
 */
export type ManualDiagnosticReason =
	| ManualAdverbReason
	| "unknown-token"
	| "unsupported-part-of-speech"
	| "missing-field"
	| "unsupported-conjugation-type"
	| "unsupported-conjugation-form"
	| "unsupported-connection"
	| "no-candidate"
	| "only-current-surface"
	| "invalid-evidence";

/**
 * Display-only diagnostic for exactly one materialized slot.
 *
 * `alternativeSurfaceCount` counts distinct surfaces that differ from what the
 * slot displays now — not candidate records, not a frequency total — so it is
 * the number of outcomes a Shuffle could actually produce. `status` is
 * therefore `"available"` if and only if that count is above zero, which is
 * also exactly when `manualAvailable` is true.
 *
 * It carries no path, no note text, no surface, no reading, no connection key
 * and no exception message; it is transient plan state and is never persisted,
 * hashed into a fingerprint or written to Collect metadata.
 */
export type ManualSlotDiagnostic = {
	readonly status: "available" | "unavailable";
	readonly slotClass: "noun" | "verb" | "i-adjective" | "adverb" | "unsupported";
	/** Null exactly when `status` is `"available"`. */
	readonly reason: ManualDiagnosticReason | null;
	readonly alternativeSurfaceCount: number;
	readonly overridden: boolean;
};

export type DisplaySlotAnnotation = {
	readonly annotationId: string;
	readonly baseRange: Utf16Range;
};

export type DisplaySlotRunInput = {
	readonly runId: string;
	readonly analysisText: string;
	readonly annotations: readonly DisplaySlotAnnotation[];
	readonly tokens: readonly LocatedToken[];
};

export type DisplaySlotChunkInput = {
	readonly chunkId: string;
	readonly runs: readonly DisplaySlotRunInput[];
};

export type DisplaySlot = {
	readonly tokenId: string;
	readonly targetRevision: number;
	readonly chunkId: string;
	readonly runId: string;
	readonly occurrence: number;
	readonly originalRange: Utf16Range;
	readonly originalToken: JapaneseToken;
	readonly automaticCandidate: VocabularyCandidate | null;
	readonly automaticSurface: string;
	readonly automaticRuby: VerifiedRubyVariant | null;
	readonly displayCandidate: VocabularyCandidate | null;
	readonly displaySurface: string;
	readonly displayRuby: VerifiedRubyVariant | null;
	readonly manualOverride: ManualOverride | null;
	readonly rubyAnnotationIds: readonly string[];
	readonly automaticReplaceable: boolean;
	readonly automaticReplaced: boolean;
	readonly manualEligible: boolean;
	readonly manualClass: "noun" | "verb" | "i-adjective" | "adverb" | "unsupported";
	readonly manualAvailable: boolean;
	readonly manualDiagnostic: ManualSlotDiagnostic;
	readonly dictionaryEligible: boolean;
	readonly dictionaryAvailable: boolean;
	readonly dictionary: HeadwordValidation;
	readonly displayRevision: number;
};

/** Canonical materialized run order; slots are the same objects as the flat plan. */
export type DisplaySlotRunOutput = {
 readonly chunkId: string;
 readonly runId: string;
 readonly slots: readonly DisplaySlot[];
};

export type DisplaySlotPlan = {
	readonly policyVersion: typeof DISPLAY_SLOT_POLICY_VERSION;
	readonly targetRevision: number;
	readonly displayRevision: number;
	readonly vocabularyFingerprint: string;
	readonly drawMode: VocabularyDrawMode;
	/** 1: legacy transform (comparison oracle); 3: MAX-CORE1 Snapshot transform, the production body path. */
	readonly algorithmVersion: 1 | typeof MAX_TRANSFORM_VERSION;
	readonly replacementCount: number;
 readonly replaceableSlotCount: number;
 readonly runs: readonly DisplaySlotRunOutput[];
	readonly slots: readonly DisplaySlot[];
};

export type AutomaticDisplayLayer = {
	readonly candidate: VocabularyCandidate | null;
	readonly surface: string;
	readonly ruby: VerifiedRubyVariant | null;
};

type MaterializedBatch = {
	readonly targetRevision: number;
	readonly chunks: readonly DisplaySlotChunkInput[];
};

function fail(code: DisplaySlotErrorCode): never {
	throw new DisplaySlotError(code);
}

function isIndex(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function copyToken(token: JapaneseToken): JapaneseToken {
	const copy: JapaneseToken = {
		surface: token.surface,
		pos: token.pos,
		detail1: token.detail1,
		detail2: token.detail2,
		detail3: token.detail3,
		conjugationType: token.conjugationType,
		conjugationForm: token.conjugationForm,
		baseForm: token.baseForm,
		isUnknown: token.isUnknown,
	};
	if (token.reading !== undefined) {
		copy.reading = token.reading;
	}
	return copy;
}

function copyOrigins(origins: readonly VocabularyOrigin[]): VocabularyOrigin[] {
	return origins.map((origin) => ({
		path: origin.path,
		contentHash: origin.contentHash,
		count: origin.count,
	}));
}

function copyRuby(variant: VerifiedRubyVariant): VerifiedRubyVariant {
	return {
		variantId: variant.variantId,
		baseRangeInSurface: {
			start: variant.baseRangeInSurface.start,
			end: variant.baseRangeInSurface.end,
		},
		reading: variant.reading,
		sourceNotations: [...variant.sourceNotations],
		frequency: variant.frequency,
		origins: copyOrigins(variant.origins),
	};
}

function copyCandidate(candidate: VocabularyCandidate): VocabularyCandidate {
	return {
		candidateId: candidate.candidateId,
		displayFormId: candidate.displayFormId,
		surface: candidate.surface,
		token: copyToken(candidate.token),
		frequency: candidate.frequency,
		origins: copyOrigins(candidate.origins),
		verifiedRubyVariants: candidate.verifiedRubyVariants.map(copyRuby),
	};
}

function copyRange(range: Utf16Range): Utf16Range {
	return { start: range.start, end: range.end };
}

function assertUtf16Range(range: Utf16Range, limit: number): Utf16Range {
	if (
		!Number.isSafeInteger(range.start) ||
		!Number.isSafeInteger(range.end) ||
		range.start < 0 ||
		range.end > limit ||
		range.start >= range.end
	) {
		return fail("invalid-input");
	}
	return copyRange(range);
}

function flattenRuns(
	chunks: readonly DisplaySlotChunkInput[],
): DisplaySlotRunInput[] {
	const runs: DisplaySlotRunInput[] = [];
	for (const chunk of chunks) {
		for (const run of chunk.runs) {
			runs.push(run);
		}
	}
	return runs;
}

function flattenTokens(
	chunks: readonly DisplaySlotChunkInput[],
): readonly (readonly LocatedToken[])[] {
	return flattenRuns(chunks).map((run) => run.tokens);
}

/**
 * Copies the caller batch into module-owned identity: Chunk, run, annotation,
 * range and Target revision cannot be restamped onto a later transform.
 */
function mintMaterializedBatch(
	chunks: readonly DisplaySlotChunkInput[],
	targetRevision: number,
): MaterializedBatch {
	if (!isIndex(targetRevision)) {
		return fail("invalid-input");
	}
	const tokenIds = new Set<string>();
	const chunkIds = new Set<string>();
	const copied: DisplaySlotChunkInput[] = [];
	for (const chunk of chunks) {
		if (chunk.chunkId.length === 0 || chunkIds.has(chunk.chunkId)) {
			return fail("invalid-input");
		}
		chunkIds.add(chunk.chunkId);
		const runIds = new Set<string>();
		const annotationIds = new Set<string>();
		const copiedRuns: DisplaySlotRunInput[] = [];
		for (const run of chunk.runs) {
			if (run.runId.length === 0 || runIds.has(run.runId)) {
				return fail("invalid-input");
			}
			runIds.add(run.runId);
			const copiedAnnotations: DisplaySlotAnnotation[] = [];
			for (const annotation of run.annotations) {
				if (
					annotation.annotationId.length === 0 ||
					annotationIds.has(annotation.annotationId)
				) {
					return fail("invalid-input");
				}
				annotationIds.add(annotation.annotationId);
				copiedAnnotations.push({
					annotationId: annotation.annotationId,
					baseRange: assertUtf16Range(
						annotation.baseRange,
						run.analysisText.length,
					),
				});
			}
			let cursor = 0;
			const copiedTokens: LocatedToken[] = [];
			for (let index = 0; index < run.tokens.length; index += 1) {
				const item = run.tokens[index]!;
				const surface = item.token.surface;
				const range = assertUtf16Range(
					item.range,
					run.analysisText.length,
				);
				if (
					item.tokenId.length === 0 ||
					tokenIds.has(item.tokenId) ||
					surface.length === 0 ||
					range.start !== cursor ||
					range.end !== cursor + surface.length ||
					run.analysisText.slice(range.start, range.end) !== surface
				) {
					return fail("invalid-input");
				}
				tokenIds.add(item.tokenId);
				copiedTokens.push({
					tokenId: item.tokenId,
					range,
					token: copyToken(item.token),
				});
				cursor = range.end;
			}
			if (cursor !== run.analysisText.length) {
				return fail("invalid-input");
			}
			copiedRuns.push({
				runId: run.runId,
				analysisText: run.analysisText,
				annotations: copiedAnnotations,
				tokens: copiedTokens,
			});
		}
		copied.push({ chunkId: chunk.chunkId, runs: copiedRuns });
	}
	return {
		targetRevision,
		chunks: copied,
	};
}

function hasOtherSurface(
	bucketByKey: ReadonlyMap<string, readonly { readonly surface: string }[]>,
	token: JapaneseToken,
	currentSurface: string,
): boolean {
	if (!isEligibleReplacementToken(token)) {
		return false;
	}
	const surfaces = bucketByKey.get(vocabularyPoolKey(token)) ?? [];
	for (const item of surfaces) {
		if (item.surface !== currentSurface) {
			return true;
		}
	}
	return false;
}

/**
 * Distinct surfaces in `items` that differ from `currentSurface`.
 *
 * Records may repeat a surface, so identity is the surface string itself; the
 * set is allocated only once an alternative is actually seen, which keeps the
 * common "no alternative" slot allocation-free.
 */
export function alternativeSurfaceCount(
	items: readonly { readonly surface: string }[],
	currentSurface: string,
): number {
	let seen: Set<string> | null = null;
	for (const item of items) {
		if (item.surface === currentSurface) {
			continue;
		}
		if (seen === null) {
			seen = new Set();
		}
		seen.add(item.surface);
	}
	return seen?.size ?? 0;
}

function dictionaryPoolIsCallable(snapshot: VocabularySnapshot): boolean {
	const byPlaceholder = snapshot.projections.dictionary.byPlaceholder;
	for (const template of STANDARD_TEMPLATE_SET.coreTemplates) {
		let fillable = true;
		for (const placeholder of template.requiredPlaceholders) {
			if (byPlaceholder[placeholder].length === 0) {
				fillable = false;
				break;
			}
		}
		if (fillable) {
			return true;
		}
	}
	return false;
}

function compatibleCandidate(
	candidate: VocabularyCandidate,
	original: JapaneseToken,
): boolean {
	return (
		isEligibleReplacementToken(original) &&
		isEligibleReplacementToken(candidate.token) &&
		vocabularyPoolKey(candidate.token) === vocabularyPoolKey(original)
	);
}

function resolveExactCandidate(
	snapshot: VocabularySnapshot,
	original: JapaneseToken,
	selection: VocabularySnapshotSelection,
	surface: string,
): VocabularyCandidate {
	const wanted = selection.candidate;
	if (wanted.surface !== surface) {
		return fail("invalid-candidate");
	}
	for (const candidate of snapshot.candidates) {
		if (
			candidate.candidateId === wanted.candidateId &&
			candidate.displayFormId === wanted.displayFormId &&
			candidate.surface === wanted.surface &&
			compatibleCandidate(candidate, original)
		) {
			return candidate;
		}
	}
	return fail("invalid-candidate");
}

function matchingRuby(
	candidate: VocabularyCandidate,
	selected: VerifiedRubyVariant | null,
): VerifiedRubyVariant | null {
	if (selected === null) {
		if (candidate.verifiedRubyVariants.length !== 0) {
			return fail("invalid-candidate");
		}
		return null;
	}
	for (const variant of candidate.verifiedRubyVariants) {
		if (
			variant.variantId === selected.variantId &&
			variant.reading === selected.reading &&
			variant.baseRangeInSurface.start === selected.baseRangeInSurface.start &&
			variant.baseRangeInSurface.end === selected.baseRangeInSurface.end
		) {
			return variant;
		}
	}
	return fail("invalid-candidate");
}

function overlappingAnnotationIds(
	annotations: readonly DisplaySlotAnnotation[],
	range: Utf16Range,
): string[] {
	const ids: string[] = [];
	for (const annotation of annotations) {
		if (rangesOverlap(annotation.baseRange, range)) {
			ids.push(annotation.annotationId);
		}
	}
	return ids;
}

function chunkIdOf(
	chunks: readonly DisplaySlotChunkInput[],
	sequenceIndex: number,
): string {
	let cursor = 0;
	for (const chunk of chunks) {
		const next = cursor + chunk.runs.length;
		if (sequenceIndex < next) {
			return chunk.chunkId;
		}
		cursor = next;
	}
	return fail("invalid-input");
}

function drawAutomatic(
	batch: MaterializedBatch,
	snapshot: VocabularySnapshot,
	bodySeed: number,
	bodySemantropy: BodySemantropy,
	algorithmVersion: typeof VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
): VocabularySnapshotTransformResult {
	try {
		return transformWithVocabularySnapshot({
			tokenSequences: flattenTokens(batch.chunks),
			snapshot,
			bodySeed,
			bodySemantropy,
			algorithmVersion,
		});
	} catch {
		return fail("incompatible-transform");
	}
}

/**
 * CORE1 display seam. Manual override is always `null`; a later slice inserts
 * the replacement / restore-original cases without changing slot identity.
 */
export function resolveDisplayLayer(
	automatic: AutomaticDisplayLayer,
	override: ManualOverride | null,
): AutomaticDisplayLayer {
	if (override !== null) {
		return fail("invalid-input");
	}
	return automatic;
}

/**
 * Atomically transforms materialized Chunks and plans DisplaySlots. The
 * automatic result never leaves this call as a rebindable object: Chunk
 * identity, run identity, Ruby annotations, UTF-16 ranges and Target revision
 * are copied first and used for both the draw and the slots.
 */
export function planDisplaySlots(input: {
	targetRevision: number;
	displayRevision: number;
	chunks: readonly DisplaySlotChunkInput[];
	snapshot: VocabularySnapshot;
	bodySeed: number;
	bodySemantropy: BodySemantropy;
	dictionarySemantropy: DictionarySemantropy | number;
	algorithmVersion: typeof VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION;
	markerVisibility?: DisplayMarkerVisibility;
}): DisplaySlotPlan {
	return planSlots(input);
}

type PreparedAutomatic = {
	readonly result: MaxResult;
	readonly eligible: readonly (readonly boolean[])[];
	/** MAX-CORE1's own realization evidence: does this lexeme build exactly this surface for this key? */
	readonly realizes: (lexemeId: string, formKey: string, surface: string) => boolean;
};

/** Only a genuine current MAX-CORE1 result can enter the production Automatic render seam.
 * Eligibility, realization and bridge decisions belong to the core; this layer never re-derives them. */
export function planAutomaticDisplaySlots(input: {
	targetRevision: number; displayRevision: number; chunks: readonly DisplaySlotChunkInput[];
	projection: MaxProjection; target: MaxTarget; result: MaxResult;
	dictionarySemantropy: DictionarySemantropy;
}): DisplaySlotPlan {
	const owned = readMaxResultSlots({ projection: input.projection, target: input.target, result: input.result });
	if (!owned.ok) return fail("incompatible-transform");
	const runs = input.chunks.flatMap(chunk => chunk.runs.map(run => ({ ...run, runId: `${chunk.chunkId}/${run.runId}` })));
	if (runs.length !== owned.value.runs.length || runs.some((run, index) => {
		const expected = owned.value.runs[index]!;
		return run.runId !== expected.run.runId || run.analysisText !== expected.run.analysisText ||
			JSON.stringify(run.tokens) !== JSON.stringify(expected.tokens) || JSON.stringify(run.annotations.map(a => [a.annotationId, a.baseRange])) !==
			JSON.stringify(expected.run.annotations.map(a => [a.annotationId, a.baseRange]));
	})) return fail("incompatible-transform");
	const { vocabulary } = resolveMaxProjection(input.projection);
	const realizations = new Map([...input.projection.verb.lexemes, ...input.projection.iAdjective.lexemes].map(lexeme => [lexeme.lexemeId, lexeme.realizations]));
	return planSlots({ ...input, snapshot: vocabulary.snapshot, bodySeed: 0,
		bodySemantropy: input.result.bodySemantropy as BodySemantropy, algorithmVersion: 1 },
		{ result: input.result, eligible: owned.value.eligible,
			realizes: (lexemeId, formKey, surface) => realizations.get(lexemeId)?.some(item => item.key === formKey && item.surface === surface) === true });
}

function planSlots(input: Parameters<typeof planDisplaySlots>[0], prepared?: PreparedAutomatic): DisplaySlotPlan {
	void input.markerVisibility;
	if (!isIndex(input.displayRevision)) {
		return fail("invalid-input");
	}
	let dictionaryOff = false;
	try {
		dictionaryOff = dictionaryBucketOf(input.dictionarySemantropy) === "off";
	} catch {
		return fail("invalid-input");
	}
	const batch = mintMaterializedBatch(input.chunks, input.targetRevision);
	const transform = prepared?.result ?? drawAutomatic(
		batch,
		input.snapshot,
		input.bodySeed,
		input.bodySemantropy,
		input.algorithmVersion,
	);
	const snapshot = input.snapshot;
	if (
		(!prepared && transform.vocabularyFingerprint !== snapshot.fingerprint) ||
		transform.drawMode !== snapshot.drawMode ||
		transform.algorithmVersion !== (prepared ? MAX_TRANSFORM_VERSION : VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION)
	) {
		return fail("incompatible-transform");
	}
	const runs = flattenRuns(batch.chunks);
	if (
		transform.texts.length !== runs.length ||
		transform.tokenSurfaces.length !== runs.length ||
		transform.selections.length !== runs.length
	) {
		return fail("incompatible-transform");
	}
	const bucketByKey = new Map(
		snapshot.projections.automaticBody.buckets.map((bucket) => [
			bucket.key,
			bucket.surfaces,
		]),
	);
	const dictionaryCallable = dictionaryPoolIsCallable(snapshot);
	const slots: DisplaySlot[] = [];
 const outputs: DisplaySlotRunOutput[] = [];
	let replaced = 0;
	let replaceable = 0;
	for (let sequence = 0; sequence < runs.length; sequence += 1) {
		const run = runs[sequence]!;
 const firstSlot = slots.length;
		const surfaces = transform.tokenSurfaces[sequence];
		const selections = transform.selections[sequence];
		const text = transform.texts[sequence];
		if (
			!surfaces ||
			!selections ||
			typeof text !== "string" ||
			surfaces.length !== run.tokens.length ||
			selections.length !== run.tokens.length
		) {
			return fail("incompatible-transform");
		}
		let joined = "";
		for (const surface of surfaces) {
			if (typeof surface !== "string" || surface.length === 0) {
				return fail("incompatible-transform");
			}
			joined += surface;
		}
		if (joined !== text) {
			return fail("incompatible-transform");
		}
		const chunkId = chunkIdOf(batch.chunks, sequence);
		for (let index = 0; index < run.tokens.length; index += 1) {
			const located = run.tokens[index]!;
			const surface = surfaces[index]!;
			const selection = selections[index]!;
			const original = located.token;
			let automaticCandidate: VocabularyCandidate | null = null;
			let automaticRuby: VerifiedRubyVariant | null = null;
			if (selection === null) {
				if (surface !== original.surface) {
					return fail("incompatible-transform");
				}
			} else {
				const record = prepared ? snapshot.candidates.find(candidate => candidate.displayFormId === selection.candidate.displayFormId &&
					candidate.candidateId === selection.candidate.candidateId && candidate.surface === surface) : null;
				const realization = prepared && "realization" in selection ? (selection as MaxResult["selections"][number][number] & object).realization : null;
				if (prepared && !record) {
					// A surface MAX-CORE1 built from a lexeme with no observed record of that exact surface.
					// It carries no Snapshot candidate and no Ruby, and is accepted only as the core's own realization.
					if (!realization || selection.rubyVariant !== null || selection.candidate.surface !== surface ||
						selection.candidate.candidateId !== realization.lexemeId ||
						selection.candidate.displayFormId !== vocabularyDisplayFormId(realization.lexemeId, surface) ||
						!prepared.realizes(realization.lexemeId, realization.formKey, surface)) return fail("invalid-candidate");
				} else {
					const resolved = record ?? resolveExactCandidate(
						snapshot,
						original,
						selection,
						surface,
					);
					automaticCandidate = copyCandidate(resolved);
					const ruby = matchingRuby(resolved, selection.rubyVariant);
					automaticRuby = ruby ? copyRuby(ruby) : null;
				}
				replaced += 1;
			}
			const automaticReplaced = selection !== null;
			const automatic: AutomaticDisplayLayer = {
				candidate: automaticCandidate,
				surface,
				ruby: automaticRuby,
			};
			const display = resolveDisplayLayer(automatic, null);
			// A realized surface has no Snapshot record; its headword check sees the Target slot's own
			// part of speech with the displayed surface, and nothing else is derived from it.
			const displayToken = display.candidate
				? copyToken(display.candidate.token)
				: automaticReplaced ? { ...copyToken(original), surface: display.surface } : copyToken(original);
			if (displayToken.surface !== display.surface) {
				return fail("invalid-candidate");
			}
			const dictionary = validateHeadword(displayToken.surface, [displayToken]);
			const dictionaryEligible = dictionary.outcome === "accepted";
			const manualEligible = isEligibleReplacementToken(original);
			// Nouns are the only class this pre-Manual layer can decide. The
			// Manual Morph layer replaces both the class and the diagnostic for
			// every other slot before the plan is ever displayed, so nothing
			// here guesses a morphological reason from a surface or a field.
			const nounBucket = manualEligible
				? bucketByKey.get(vocabularyPoolKey(original)) ?? []
				: [];
			const manualAlternatives = manualEligible
				? alternativeSurfaceCount(nounBucket, display.surface)
				: 0;
			const automaticReplaceable = prepared?.eligible[sequence]?.[index] ?? hasOtherSurface(
				bucketByKey,
				original,
				original.surface,
			);
			if (automaticReplaceable) {
				replaceable += 1;
			}
			slots.push({
				tokenId: located.tokenId,
				targetRevision: batch.targetRevision,
				chunkId,
				runId: run.runId,
				occurrence: index,
				originalRange: copyRange(located.range),
				originalToken: copyToken(original),
				automaticCandidate: automatic.candidate,
				automaticSurface: automatic.surface,
				automaticRuby: automatic.ruby,
				displayCandidate: display.candidate,
				displaySurface: display.surface,
				displayRuby: display.ruby,
				manualOverride: null,
				manualClass: manualEligible ? "noun" : "unsupported",
				rubyAnnotationIds: overlappingAnnotationIds(
					run.annotations,
					located.range,
				),
				automaticReplaceable,
				automaticReplaced,
				manualEligible,
				manualAvailable: manualAlternatives > 0,
				manualDiagnostic: {
					status: manualAlternatives > 0 ? "available" : "unavailable",
					slotClass: manualEligible ? "noun" : "unsupported",
					reason:
						manualAlternatives > 0
							? null
							: manualEligible
								? nounBucket.length > 0
									? "only-current-surface"
									: "no-candidate"
								: // No Manual Morph evidence reaches this layer, so a
									// non-noun slot states exactly that rather than a
									// morphological reason it has not evaluated.
									"invalid-evidence",
					alternativeSurfaceCount: manualAlternatives,
					overridden: false,
				},
				dictionaryEligible,
				dictionaryAvailable:
					dictionaryEligible && dictionaryCallable && !dictionaryOff,
				dictionary,
				displayRevision: input.displayRevision,
			});
		}
  outputs.push({ chunkId, runId: run.runId, slots: slots.slice(firstSlot) });
	}
	if (
		replaced !== transform.replacementCount ||
		replaceable !== transform.replaceableSlotCount
	) {
		return fail("incompatible-transform");
	}
	return freezeAnalysis({
		policyVersion: DISPLAY_SLOT_POLICY_VERSION,
		targetRevision: batch.targetRevision,
		displayRevision: input.displayRevision,
		vocabularyFingerprint: transform.vocabularyFingerprint,
		drawMode: snapshot.drawMode,
		algorithmVersion: prepared ? MAX_TRANSFORM_VERSION : VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
		replacementCount: transform.replacementCount,
  replaceableSlotCount: transform.replaceableSlotCount,
  runs: outputs,
		slots,
	});
}

/**
 * Display range inside one analysis run, in UTF-16 units of the concatenated
 * display surfaces. Identity does not change when a neighbour's length does.
 */
export function displayRangeOf(
	plan: DisplaySlotPlan,
	tokenId: string,
): Utf16Range {
	let target: DisplaySlot | null = null;
	for (const slot of plan.slots) {
		if (slot.tokenId === tokenId) {
			target = slot;
			break;
		}
	}
	if (!target) {
		return fail("invalid-input");
	}
	let start = 0;
	for (const slot of plan.slots) {
		if (slot.chunkId !== target.chunkId || slot.runId !== target.runId) {
			continue;
		}
		const end = start + slot.displaySurface.length;
		if (slot.tokenId === tokenId) {
			return freezeAnalysis({ start, end });
		}
		start = end;
	}
	return fail("invalid-input");
}
