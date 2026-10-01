import type { LocatedAnalysisRun } from "../analysis/locateTokens";
import type { LocatedAnalysisDocument } from "../analysis/locateTokens";
import type { MarkdownSourceProjection } from "../analysis/projectMarkdownSource";
import { isTargetLineIndex, type TargetLineIndex, type TargetLineChunk } from "../analysis/targetChunkIr";
import { reuseTargetAnalysis } from "../analysis/reuseTargetAnalysis";
import {
	buildRubyVocabulary,
	freezeAnalysis,
	type RubyVocabulary,
	type VerifiedRubyVariant,
	type VocabularyOrigin,
	vocabularyCandidateId,
	vocabularyDisplayFormId,
} from "../analysis/rubyVocabulary";
import {
	SOURCE_ANALYSIS_ERROR_MESSAGE,
	analyzeSelectedSource,
} from "../application/analyzeSelectedSource";
import type {
	JapaneseToken,
	JapaneseTokenizer,
} from "../tokenizer/JapaneseTokenizer";
import {
	REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	REGULAR_VERB_CONJUGATION_TYPES,
} from "./regularConjugationTypes";
import { sha256Hex } from "../vocabulary/sha256";
import { ENCLOSED_TERM_POLICY_VERSION, enclosedTermTokenizer, type EnclosedTermDelimiter } from "../vocabulary/enclosedTerms";
import {
	buildVocabularySnapshot,
	type VocabularyDrawMode,
	type VocabularySnapshot,
	type VocabularySourceIdentity,
} from "../vocabulary/vocabularySnapshot";

/**
 * PRE-RELEASE-MANUAL-MORPH1 pure core: may a verb / イ-adjective slot be
 * manually shuffled, and with which Source-observed records?
 *
 * Connected to explicit production Manual actions by MORPH2. It performs no
 * inflection, generates no surface, and never guesses a missing field from
 * the surface, its ending or the base form: every decision reads dictionary
 * fields exactly as the tokenizer reported them, plus the one following token.
 *
 * Compatibility is allowlisted, never denylisted. A slot is supported only when
 *
 *   - pos / detail1 is 動詞 / 自立 or 形容詞 / 自立 (never 名詞 / 形容動詞語幹),
 *   - its conjugation type and form are both listed below, and
 *   - its Target follower matches the allowlist, except adjective basic forms.
 *
 * Verb candidates carry the same pos, detail1, conjugation type and form AND
 * have been observed in a Source followed by the same listed connection. The
 * second condition is what rejects, for example, あら (ある, 未然形, observed
 * before ず) as a replacement for 分から before ない: type and form agree, but
 * あらない is not Japanese, and no rule here could know that without an
 * observation. COVERAGE1 regular adjectives share an explicit compatibility
 * family: candidates need the same observed form, not a Source follower.
 *
 * Observations are never accepted as caller-supplied data. Sources enter only
 * through `analyzeManualMorphSource`, which analyzes the Source text itself;
 * `buildManualMorphVocabulary` then builds the Vocabulary Snapshot and its
 * evidence together from those registered analyses. Evidence is valid only
 * together with that same Snapshot object.
 */
export const MANUAL_MORPH_POLICY_VERSION = "manual-morph-2";

const UNSET = "*";

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export type ManualMorphSlotClass = "verb" | "i-adjective";

export type ManualMorphRejection =
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
 * One allowed following token, matched on pos, detail1 and — for function
 * words — an explicit, closed set of surfaces. Only those three fields are
 * used because only they survive every compact dictionary rule: a follower
 * such as て or ない is outside the verb / adjective classes, so its base form
 * and conjugation fields are `"*"` in the shipped dictionary. `surfaces: null`
 * (nouns, punctuation) states explicitly that any surface of that class is
 * accepted. Nothing here derives a surface; the lists are fixture-backed.
 */
export type ManualMorphConnection = {
	id: string;
	pos: string;
	detail1: string;
	surfaces: readonly string[] | null;
};

type FormRule = {
	conjugationForm: string;
	connections: readonly ManualMorphConnection[];
};

function connection(
	id: string,
	pos: string,
	detail1: string,
	surfaces: readonly string[] | null,
): ManualMorphConnection {
	return { id, pos, detail1, surfaces };
}

const PERIOD = connection("period", "記号", "句点", null);
const COMMA = connection("comma", "記号", "読点", null);
const GENERAL_NOUN = connection("general-noun", "名詞", "一般", null);
const PARTICLE_TE = connection("particle-te", "助詞", "接続助詞", ["て"]);
const PARTICLE_DE = connection("particle-de", "助詞", "接続助詞", ["で"]);
const PARTICLE_BA = connection("particle-ba", "助詞", "接続助詞", ["ば"]);
const AUX_TA = connection("aux-ta", "助動詞", "*", ["た", "たら"]);
const AUX_DA = connection("aux-da", "助動詞", "*", ["だ", "だら"]);
const AUX_NAI = connection("aux-nai", "助動詞", "*", [
	"ない",
	"なかっ",
	"なく",
	"なけれ",
]);

/**
 * The regular verb and イ-adjective classes, re-exported under this module's
 * established names. The definitions live in `./regularConjugationTypes` so
 * Collision imports the same allowlist instead of repeating it.
 */
export {
	REGULAR_VERB_CONJUGATION_TYPES as MANUAL_MORPH_VERB_CONJUGATION_TYPES,
	REGULAR_ADJECTIVE_CONJUGATION_TYPES as MANUAL_MORPH_ADJECTIVE_CONJUGATION_TYPES,
} from "./regularConjugationTypes";

const VERB_FORM_RULES: readonly FormRule[] = [
	{
		conjugationForm: "基本形",
		connections: [
			PERIOD,
			COMMA,
			GENERAL_NOUN,
			connection("dependent-noun-koto", "名詞", "非自立", ["こと"]),
			connection("particle-to", "助詞", "接続助詞", ["と"]),
			connection("particle-kara", "助詞", "接続助詞", ["から"]),
		],
	},
	{
		conjugationForm: "未然形",
		connections: [
			AUX_NAI,
			connection("aux-nu", "助動詞", "*", ["ず", "ぬ"]),
			connection("suffix-seru", "動詞", "接尾", ["せ", "せる"]),
			connection("suffix-saseru", "動詞", "接尾", ["させ", "させる"]),
			connection("suffix-reru", "動詞", "接尾", ["れ", "れる"]),
			connection("suffix-rareru", "動詞", "接尾", ["られ", "られる"]),
		],
	},
	{
		conjugationForm: "未然ウ接続",
		connections: [connection("aux-u", "助動詞", "*", ["う"])],
	},
	{
		conjugationForm: "連用形",
		connections: [
			connection("aux-masu", "助動詞", "*", ["ます", "まし", "ませ"]),
			connection("aux-tai", "助動詞", "*", ["たい", "たく", "たかっ"]),
			AUX_TA,
			PARTICLE_TE,
			connection("particle-nagara", "助詞", "接続助詞", ["ながら"]),
		],
	},
	{
		conjugationForm: "連用タ接続",
		connections: [AUX_TA, AUX_DA, PARTICLE_TE, PARTICLE_DE],
	},
	{ conjugationForm: "仮定形", connections: [PARTICLE_BA] },
];

const ADJECTIVE_FORM_RULES: readonly FormRule[] = [
	{
		conjugationForm: "基本形",
		// Empty means no Target follower requirement for this form only.
		connections: [],
	},
	{
		conjugationForm: "連用テ接続",
		connections: [
			AUX_NAI,
			PARTICLE_TE,
			connection("verb-naru", "動詞", "自立", [
				"なる",
				"なっ",
				"なら",
				"なり",
			]),
		],
	},
	{ conjugationForm: "連用タ接続", connections: [AUX_TA] },
	{ conjugationForm: "仮定形", connections: [PARTICLE_BA] },
];

type ClassRule = {
	slotClass: ManualMorphSlotClass;
	pos: string;
	detail1: string;
	conjugationTypes: ReadonlySet<string>;
	forms: ReadonlyMap<string, readonly ManualMorphConnection[]>;
};

function classRule(
	slotClass: ManualMorphSlotClass,
	pos: string,
	types: readonly string[],
	forms: readonly FormRule[],
): ClassRule {
	return {
		slotClass,
		pos,
		detail1: "自立",
		conjugationTypes: new Set(types),
		forms: new Map(forms.map((rule) => [rule.conjugationForm, rule.connections])),
	};
}

const CLASS_RULES: readonly ClassRule[] = [
	classRule("verb", "動詞", REGULAR_VERB_CONJUGATION_TYPES, VERB_FORM_RULES),
	classRule(
		"i-adjective",
		"形容詞",
		REGULAR_ADJECTIVE_CONJUGATION_TYPES,
		ADJECTIVE_FORM_RULES,
	),
];

/** Read-only view of the allowlist, for records and tests. */
export const MANUAL_MORPH_ALLOWLIST: Readonly<
	Record<
		ManualMorphSlotClass,
		{
			conjugationTypes: readonly string[];
			forms: Readonly<Record<string, {
				targetFollower: "any" | "allowlist";
				connections: readonly string[];
			}>>;
		}
	>
> = freezeAnalysis({
	verb: {
		conjugationTypes: [...REGULAR_VERB_CONJUGATION_TYPES],
		forms: Object.fromEntries(
			VERB_FORM_RULES.map((rule) => [
				rule.conjugationForm,
				{ targetFollower: "allowlist", connections: rule.connections.map((c) => c.id) },
			]),
		),
	},
	"i-adjective": {
		conjugationTypes: [...REGULAR_ADJECTIVE_CONJUGATION_TYPES],
		forms: Object.fromEntries(
			ADJECTIVE_FORM_RULES.map((rule) => [
				rule.conjugationForm,
				{ targetFollower: rule.conjugationForm === "基本形" ? "any" : "allowlist", connections: rule.connections.map((c) => c.id) },
			]),
		),
	},
});

function isPresent(value: string | undefined): value is string {
	return typeof value === "string" && value.length > 0 && value !== UNSET;
}

function matchesConnection(
	rule: ManualMorphConnection,
	next: JapaneseToken,
): boolean {
	return (
		!next.isUnknown &&
		next.pos === rule.pos &&
		next.detail1 === rule.detail1 &&
		(rule.surfaces === null || rule.surfaces.includes(next.surface))
	);
}

/** Target acceptance and Source observation are separate policy dimensions.
 * Keys are derived from this contract, never used to infer it from a surface. */
export type ManualMorphCompatibility = {
	policyVersion: typeof MANUAL_MORPH_POLICY_VERSION;
	slotClass: ManualMorphSlotClass;
	conjugationForm: string;
	compatibilityFamily: string;
	targetConnection: string | null;
	candidateObservation: "same-form" | "same-connection";
	candidateCompatibilityKey: string;
};

export type ManualMorphConnectionResult =
	| {
			supported: true;
			slotClass: ManualMorphSlotClass;
			connectionKey: string;
			compatibility: ManualMorphCompatibility;
	  }
	| { supported: false; reason: ManualMorphRejection };

/**
 * Classifies one token in its context. `next` is the token that immediately
 * follows it in the same analysis run, or null at the end of the run; a run
 * end is accepted only for regular adjective basic forms.
 */
export function manualMorphConnection(
	token: JapaneseToken,
	next: JapaneseToken | null,
): ManualMorphConnectionResult {
	return classifyMorphology(token, next, "target");
}

function classifyMorphology(
	token: JapaneseToken,
	next: JapaneseToken | null,
	role: "target" | "source",
): ManualMorphConnectionResult {
	if (token.isUnknown) {
		return { supported: false, reason: "unknown-token" };
	}
	const rule = CLASS_RULES.find(
		(candidate) =>
			token.pos === candidate.pos && token.detail1 === candidate.detail1,
	);
	if (!rule) {
		return { supported: false, reason: "unsupported-part-of-speech" };
	}
	if (
		!isPresent(token.surface) ||
		!isPresent(token.conjugationType) ||
		!isPresent(token.conjugationForm) ||
		!isPresent(token.baseForm)
	) {
		return { supported: false, reason: "missing-field" };
	}
	if (!rule.conjugationTypes.has(token.conjugationType)) {
		return { supported: false, reason: "unsupported-conjugation-type" };
	}
	const connections = rule.forms.get(token.conjugationForm);
	if (!connections) {
		return { supported: false, reason: "unsupported-conjugation-form" };
	}
	const matched = next
		? connections.find((candidate) => matchesConnection(candidate, next))
		: undefined;
	const adjective = rule.slotClass === "i-adjective";
	const requiresConnection = !adjective || (role === "target" && token.conjugationForm !== "基本形");
	if (requiresConnection && !matched) {
		return { supported: false, reason: "unsupported-connection" };
	}
	const compatibilityFamily = adjective ? "regular-i-adjective" : token.conjugationType;
	const targetConnection = requiresConnection ? matched!.id : null;
	const candidateCompatibilityKey = JSON.stringify([
		MANUAL_MORPH_POLICY_VERSION, rule.slotClass, compatibilityFamily,
		token.conjugationForm, adjective ? null : targetConnection,
	]);
	return {
		supported: true,
		slotClass: rule.slotClass,
		compatibility: {
			policyVersion: MANUAL_MORPH_POLICY_VERSION,
			slotClass: rule.slotClass,
			conjugationForm: token.conjugationForm,
			compatibilityFamily,
			targetConnection,
			candidateObservation: adjective ? "same-form" : "same-connection",
			candidateCompatibilityKey,
		},
		connectionKey: JSON.stringify([
			MANUAL_MORPH_POLICY_VERSION,
			rule.slotClass,
			token.pos,
			token.detail1,
			token.conjugationType,
			token.conjugationForm,
			targetConnection,
		]),
	};
}

export const MANUAL_MORPH_EVIDENCE_ERROR_MESSAGE =
	"Could not prepare manual morphology evidence.";

export type ManualMorphEvidenceErrorCode = "invalid-analysis" | "invalid-vocabulary";

/** Fixed diagnostics only: no Source path, note text, surface or reading. */
export class ManualMorphEvidenceError extends Error {
	readonly code: ManualMorphEvidenceErrorCode;

	constructor(code: ManualMorphEvidenceErrorCode) {
		super(MANUAL_MORPH_EVIDENCE_ERROR_MESSAGE);
		this.name = "ManualMorphEvidenceError";
		this.code = code;
	}
}

function fail(code: ManualMorphEvidenceErrorCode): never {
	throw new ManualMorphEvidenceError(code);
}

/**
 * An opaque, frozen handle to one Source this module analyzed itself. Its
 * visible fields are informational: validity lives only in this module's
 * private registry, so a hand-built, spread or cloned object is not one.
 */
export type ManualMorphSourceAnalysis = {
	readonly path: string;
	readonly contentHash: string;
	readonly projectionPolicy: string;
};

/**
 * An opaque handle to the observations of one Vocabulary Snapshot. Valid only
 * when this module minted it, and only together with that Snapshot object.
 */
export type ManualMorphEvidence = {
	readonly policyVersion: typeof MANUAL_MORPH_POLICY_VERSION;
	readonly vocabularyFingerprint: string;
};

/** A compatible, Source-observed record. Every nested value is a fresh copy. */
export type ManualMorphCandidate = {
	candidateId: string;
	displayFormId: string;
	surface: string;
	frequency: number;
	origins: readonly VocabularyOrigin[];
	verifiedRubyVariants: readonly VerifiedRubyVariant[];
};

type OwnedCandidate = ManualMorphCandidate & { morphology: JapaneseToken };

type AnalysisState = {
	source: VocabularySourceIdentity;
	runs: readonly LocatedAnalysisRun[];
	vocabulary: RubyVocabulary;
	full?: { text: string; projection: MarkdownSourceProjection; located: LocatedAnalysisDocument };
};

type EvidenceState = {
	snapshot: VocabularySnapshot;
	byCompatibility: ReadonlyMap<string, readonly OwnedCandidate[]>;
};

/** The only places analysis and evidence validity are recorded. Never exported. */
const ANALYZED = new WeakMap<object, AnalysisState>();
const MINTED = new WeakMap<object, EvidenceState>();
const VOCABULARIES = new WeakSet<object>();

/** One transient owner for the simultaneously minted outputs and their Source handles. */
export type ManualMorphVocabulary = {
	readonly snapshot: VocabularySnapshot;
	readonly evidence: ManualMorphEvidence;
	readonly sources: readonly ManualMorphSourceAnalysis[];
};

export function isManualMorphVocabulary(value: ManualMorphVocabulary): boolean {
	return VOCABULARIES.has(value) && MINTED.get(value.evidence)?.snapshot === value.snapshot;
}

/** Read-only ownership seam for later policies. No caller runs can enter it.
 * Unused exports are tree-shaken from the current manual-morph-2 production path. */
export function readManualMorphVocabularySources(value: ManualMorphVocabulary): readonly {
	readonly analysis: ManualMorphSourceAnalysis;
	readonly source: VocabularySourceIdentity;
	readonly runs: readonly LocatedAnalysisRun[];
}[] | null {
	if (!isManualMorphVocabulary(value)) return null;
	const sources = value.sources.map(analysis => {
		const state = ANALYZED.get(analysis);
		return state ? Object.freeze({ analysis, source: state.source, runs: state.runs }) : null;
	});
	if (sources.some(source => source === null)) return null;
	return Object.freeze(sources as NonNullable<(typeof sources)[number]>[]);
}

/**
 * 0.1.0 S5: each Source's projected and tokenized document, in the owner's
 * Source order, for Recompose. Nothing is read or tokenized again. `null` for a
 * handle this module did not mint, or a Source analyzed without its document.
 */
export function readManualMorphSourceDocuments(value: ManualMorphVocabulary): readonly {
	readonly source: VocabularySourceIdentity;
	readonly projection: MarkdownSourceProjection;
	readonly located: LocatedAnalysisDocument;
}[] | null {
	if (!isManualMorphVocabulary(value)) return null;
	const documents = value.sources.map(analysis => {
		const state = ANALYZED.get(analysis);
		return state?.full ? Object.freeze({ source: state.source, projection: state.full.projection, located: state.full.located }) : null;
	});
	if (documents.some(document => document === null)) return null;
	return Object.freeze(documents as NonNullable<(typeof documents)[number]>[]);
}

/** Read-only Source evidence, never a caller-supplied compatibility index. */
export function readManualMorphCandidateBuckets(value: ManualMorphVocabulary): readonly {
	readonly key: string;
	readonly slotClass: ManualMorphSlotClass;
	readonly candidates: readonly ManualMorphCandidate[];
}[] | null {
	if (!isManualMorphVocabulary(value)) return null;
	return freezeAnalysis([...MINTED.get(value.evidence)!.byCompatibility.entries()]
		.sort(([a], [b]) => compare(a, b))
		.map(([key, candidates]) => ({ key,
			slotClass: CLASS_RULES.find(rule => rule.pos === candidates[0]!.morphology.pos)!.slotClass,
			candidates: candidates.map(copyCandidate),
		})));
}

function copyOrigins(origins: readonly VocabularyOrigin[]): VocabularyOrigin[] {
	return origins.map((origin) => ({
		path: origin.path,
		contentHash: origin.contentHash,
		count: origin.count,
	}));
}

function copyCandidate(record: ManualMorphCandidate): ManualMorphCandidate {
	return {
		candidateId: record.candidateId,
		displayFormId: record.displayFormId,
		surface: record.surface,
		frequency: record.frequency,
		origins: copyOrigins(record.origins),
		verifiedRubyVariants: record.verifiedRubyVariants.map((variant) => ({
			variantId: variant.variantId,
			baseRangeInSurface: {
				start: variant.baseRangeInSurface.start,
				end: variant.baseRangeInSurface.end,
			},
			reading: variant.reading,
			sourceNotations: [...variant.sourceNotations],
			frequency: variant.frequency,
			origins: copyOrigins(variant.origins),
		})),
	};
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

/**
 * A private copy of exactly what vocabulary extraction and observation read:
 * run text, Ruby annotations and located tokens. Taken once, before either is
 * derived, so both come from the same bytes and nothing the caller holds can
 * change them afterwards. Token IDs and ranges are re-checked on the copy.
 */
function copyRuns(runs: readonly LocatedAnalysisRun[]): LocatedAnalysisRun[] {
	const runIds = new Set<string>();
	return runs.map((located) => {
		const run = located.run;
		if (runIds.has(run.runId)) {
			throw new Error("duplicate run");
		}
		runIds.add(run.runId);
		let cursor = 0;
		const tokens = located.tokens.map((item, index) => {
			const surface = item.token.surface;
			if (
				surface.length === 0 ||
				item.tokenId !== `${run.runId}:token:${index}` ||
				item.range.start !== cursor ||
				item.range.end !== cursor + surface.length ||
				run.analysisText.slice(item.range.start, item.range.end) !== surface
			) {
				throw new Error("invalid token");
			}
			cursor = item.range.end;
			return {
				tokenId: item.tokenId,
				range: { start: item.range.start, end: item.range.end },
				token: copyToken(item.token),
			};
		});
		if (cursor !== run.analysisText.length) {
			throw new Error("incomplete run");
		}
		return {
			run: {
				runId: run.runId,
				originalText: run.originalText,
				analysisText: run.analysisText,
				sourceParts: [],
				annotations: run.annotations.map((annotation) => ({
					annotationId: annotation.annotationId,
					baseRange: { start: annotation.baseRange.start, end: annotation.baseRange.end },
					reading: annotation.reading,
					notation: annotation.notation,
					originalRange: {
						start: annotation.originalRange.start,
						end: annotation.originalRange.end,
					},
					originalParts: [],
				})),
				mapping: [],
			},
			tokens,
		};
	});
}

export const MANUAL_MORPH_SOURCE_ANALYSIS_ERROR_MESSAGE = SOURCE_ANALYSIS_ERROR_MESSAGE;

/**
 * Analyzes one Source for manual morphology, through the production Source
 * analyzer, and registers the result. This is the only way runs enter this
 * module: callers never pass runs, tokens or observations, so a token order,
 * run boundary or adjacency the Source text does not produce cannot be
 * supplied. `contentHash` is computed here from `text` (UTF-8 SHA-256, the
 * same value `hashSourceText` produces), binding the Source identity to it.
 *
 * The tokenizer remains the root of trust for morphology, as it is for all
 * analysis; its output must still tile each projected run exactly.
 */
export async function analyzeManualMorphSource(input: {
	text: string;
	sourcePath: string;
	tokenizer: JapaneseTokenizer;
	mode?: "source" | "target-prototype";
	phase?: (name: "projection" | "tokenize" | "vocabulary") => void;
	isCurrent?: () => boolean;
	checkpoint?: () => Promise<boolean>;
	/**
	 * 0.1.0 S4: read the text as a Vocabulary Source, where each enclosed term
	 * is one noun. Never passed for a Target. A Source in which a term was
	 * recognized records the enclosed-term policy in its projection policy.
	 */
	enclosedTerms?: readonly EnclosedTermDelimiter[] | null;
}): Promise<
	| { status: "ready"; analysis: ManualMorphSourceAnalysis }
	| { status: "stale" }
	| { status: "error"; message: string }
> {
	const text = input.text;
	const contentHash = sha256Hex(text);
	// The shared analyzer freezes its owned token graph. Copy at this boundary
	// so a tokenizer retaining its returned objects remains caller-owned.
	const copying: JapaneseTokenizer = { tokenize: async text => (await input.tokenizer.tokenize(text)).map(copyToken) };
	const terms = input.enclosedTerms?.length ? enclosedTermTokenizer(copying, input.enclosedTerms) : null;
	const analyzed = await analyzeSelectedSource({
		text,
		sourcePath: input.sourcePath,
		contentHash,
		tokenizer: terms ?? copying,
		...(input.mode === undefined ? {} : { mode: input.mode }),
		...(input.phase === undefined ? {} : { phase: input.phase }),
		...(input.isCurrent === undefined ? {} : { isCurrent: input.isCurrent }),
		...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
	});
	if (analyzed.status !== "ready") {
		return analyzed;
	}
	try {
		const source = {
			path: input.sourcePath,
			contentHash,
			projectionPolicy: terms?.used()
				? `${analyzed.projection.policyVersion}+${ENCLOSED_TERM_POLICY_VERSION}`
				: analyzed.projection.policyVersion,
		};
		const runs = copyRuns(analyzed.located.runs);
		const document = {
			segments: runs.map((located) => ({ kind: "analysis" as const, run: located.run })),
			runs: runs.map((located) => located.run),
			protectedRuns: [],
		};
		const vocabulary = buildRubyVocabulary(
			freezeAnalysis({ document, runs }),
			{ path: source.path, contentHash },
		);
		const analysis: ManualMorphSourceAnalysis = Object.freeze({ ...source });
		ANALYZED.set(analysis, freezeAnalysis({ source, runs, vocabulary,
			full: { text, projection: analyzed.projection, located: analyzed.located } }));
		return { status: "ready", analysis };
	} catch {
		return { status: "error", message: SOURCE_ANALYSIS_ERROR_MESSAGE };
	}
}

/** VIEW1: replay a minted Target prefix from exact analyzed raw coordinates.
 * Only registered Source data and authenticated Chunk descriptors can mint it.
 * Vocabulary Sources keep their full analysis; this owner is Target-only. */
export function deriveManualMorphTarget(source: ManualMorphSourceAnalysis, index: TargetLineIndex, descriptors: readonly TargetLineChunk[]) {
	const state = ANALYZED.get(source);
	if (!state?.full || !isTargetLineIndex(index) || state.full.text !== index.rawText) throw Error("Invalid Target owner.");
	const chunks = reuseTargetAnalysis(state.full, index, descriptors);
	const runs = chunks.flatMap(chunk => chunk.located.runs.map(located => ({
		run: { ...located.run, runId: `${chunk.descriptor.chunkId}/${located.run.runId}` }, tokens: located.tokens,
	})));
	const document = { segments: runs.map(located => ({ kind: "analysis" as const, run: located.run })), runs: runs.map(located => located.run), protectedRuns: [] };
	const vocabulary = buildRubyVocabulary({ document, runs }, state.source);
	const analysis: ManualMorphSourceAnalysis = Object.freeze({ ...state.source });
	ANALYZED.set(analysis, freezeAnalysis({ source: state.source, runs, vocabulary }));
	return Object.freeze({ analysis, chunks: Object.freeze(chunks) });
}

/**
 * Builds the Vocabulary Snapshot and its manual morphology evidence together,
 * from analyses this module registered. There is no way to mint evidence for
 * a Snapshot built elsewhere, or from runs supplied separately: both outputs
 * derive from the same private copies. All or nothing — an unregistered
 * analysis or a Snapshot the core rejects throws a fixed-message error.
 */
export function buildManualMorphVocabulary(input: {
	sources: readonly ManualMorphSourceAnalysis[];
	drawMode: VocabularyDrawMode;
	/** 0.1.0 S3: weight by Source path (see `src/vocabulary/sourceWeights.ts`). Omitted or all ×1 is unweighted. */
	sourceWeights?: Readonly<Record<string, unknown>> | null;
}): ManualMorphVocabulary {
	if (!Array.isArray(input.sources)) {
		return fail("invalid-analysis");
	}
	const states: AnalysisState[] = [];
	for (const analysis of input.sources as readonly unknown[]) {
		const state =
			analysis !== null && typeof analysis === "object" ? ANALYZED.get(analysis) : undefined;
		if (!state) {
			return fail("invalid-analysis");
		}
		states.push(state);
	}

	let snapshot: VocabularySnapshot;
	try {
		snapshot = buildVocabularySnapshot({
			sources: states.map((state) => ({ source: state.source, vocabulary: state.vocabulary })),
			drawMode: input.drawMode,
			sourceWeights: input.sourceWeights ?? null,
		});
	} catch {
		return fail("invalid-vocabulary");
	}

	const records = new Map(
		snapshot.projections.manual.candidates.map((record) => [record.displayFormId, record]),
	);
	const observed = new Map<string, Set<string>>();
	for (const state of states) {
		for (const located of state.runs) {
			const tokens = located.tokens.map((item) => item.token);
			for (const [index, token] of tokens.entries()) {
				const result = classifyMorphology(token, tokens[index + 1] ?? null, "source");
				if (!result.supported) {
					continue;
				}
				const displayFormId = vocabularyDisplayFormId(
					vocabularyCandidateId(token),
					token.surface,
				);
				if (!records.has(displayFormId)) {
					return fail("invalid-vocabulary");
				}
				const key = result.compatibility.candidateCompatibilityKey;
				const forms = observed.get(key) ?? new Set<string>();
				forms.add(displayFormId);
				observed.set(key, forms);
			}
		}
	}

	const owned = new Map<string, OwnedCandidate>();
	const byCompatibility = new Map<string, readonly OwnedCandidate[]>();
	for (const [connectionKey, forms] of observed) {
		const list = [...forms].sort(compare).map((displayFormId) => {
			let copy = owned.get(displayFormId);
			if (!copy) {
				const record = records.get(displayFormId)!;
				copy = freezeAnalysis({ ...copyCandidate(record), morphology: copyToken(record.morphology) });
				owned.set(displayFormId, copy);
			}
			return copy;
		});
		byCompatibility.set(connectionKey, Object.freeze(list));
	}

	const evidence: ManualMorphEvidence = Object.freeze({
		policyVersion: MANUAL_MORPH_POLICY_VERSION,
		vocabularyFingerprint: snapshot.fingerprint,
	});
	MINTED.set(evidence, { snapshot, byCompatibility });
	const handles: readonly ManualMorphSourceAnalysis[] = input.sources;
	const vocabulary = Object.freeze({ snapshot, evidence, sources: Object.freeze([...handles]) });
	VOCABULARIES.add(vocabulary);
	return vocabulary;
}

export type ManualMorphSlotEvaluation =
	| {
			available: true;
			slotClass: ManualMorphSlotClass;
			connectionKey: string;
			compatibility: ManualMorphCompatibility;
			candidates: readonly ManualMorphCandidate[];
	  }
	| {
			available: false;
			reason: ManualMorphRejection;
			candidates: readonly ManualMorphCandidate[];
	  };

function unavailable(reason: ManualMorphRejection): ManualMorphSlotEvaluation {
	return freezeAnalysis({ available: false, reason, candidates: [] });
}

/**
 * Decides one Target slot against minted evidence. `currentSurface` is what
 * the slot displays now; a slot whose only compatible records show that same
 * surface is not available, because shuffling it could not change anything.
 *
 * Evidence that this module did not mint, or that was minted for a different
 * Snapshot object, yields `invalid-evidence` with no candidates. The Target
 * tokens and the Snapshot are only read; the result owns all of its values.
 */
export function evaluateManualMorphSlot(input: {
	target: JapaneseToken;
	next: JapaneseToken | null;
	currentSurface: string;
	snapshot: VocabularySnapshot;
	evidence: ManualMorphEvidence;
}): ManualMorphSlotEvaluation {
	const state =
		input.evidence !== null && typeof input.evidence === "object"
			? MINTED.get(input.evidence)
			: undefined;
	if (!state || state.snapshot !== input.snapshot) {
		return unavailable("invalid-evidence");
	}

	const connectionResult = manualMorphConnection(input.target, input.next);
	if (!connectionResult.supported) {
		return unavailable(connectionResult.reason);
	}

	// The private index was built only from checked, genuine Source records.
	// Selection visits one compatibility bucket, never the entire Snapshot.
	const compatible = state.byCompatibility.get(connectionResult.compatibility.candidateCompatibilityKey) ?? [];
	if (compatible.length === 0) {
		return unavailable("no-candidate");
	}

	const changing = compatible.filter(
		(record) => record.surface !== input.currentSurface,
	);
	if (changing.length === 0) {
		return unavailable("only-current-surface");
	}

	return freezeAnalysis({
		available: true,
		slotClass: connectionResult.slotClass,
		connectionKey: connectionResult.connectionKey,
		compatibility: connectionResult.compatibility,
		candidates: changing.map(copyCandidate),
	});
}
