import type { JapaneseToken, JapaneseTokenizer } from "../../../src/tokenizer/JapaneseTokenizer";
import {
	analyzeManualMorphSource,
	buildManualMorphVocabulary,
	manualMorphConnection,
	readManualMorphCandidateBuckets,
	type ManualMorphVocabulary,
} from "../../../src/transform/manualMorphology";
import type { ManualVocabularyCandidate } from "../../../src/vocabulary/vocabularySnapshot";
import { isEligibleReplacementToken, vocabularyPoolKey } from "../../../src/transform/tokenPolicy";
import { realizeMaxCandidate } from "./maxRealizer";
import { maxTargetFormKey, type MaxTargetFormKey } from "./targetFormKey";

/**
 * `PRE-RELEASE-MAX-REALIZATION-SPIKE1` measurement model. Test support only.
 *
 * It answers one question: for one Target and one Vocabulary, how many
 * candidates and how many exchangeable slots does each of the three profiles
 * actually produce? It is deliberately a *model*, not a draw: there is no
 * threshold, no nonce, no per-slot profile migration and no Ruby. Those belong
 * to CORE1, and pretending to have them here would make these numbers look
 * like a generation result rather than a coverage bound.
 *
 * strict is not re-implemented. It reads the real
 * `readManualMorphCandidateBuckets()` seam, keyed by the very
 * `candidateCompatibilityKey` production computes, so the strict column is
 * Body 10's own answer and not this module's opinion of it.
 */

/**
 * The unit High and MAX count in.
 *
 * `vocabularyCandidateId()` includes the inflected surface and the conjugation
 * form, so one lemma observed as 歩く, 歩い and 歩き is three candidate
 * identities — correct for strict, which places an observed surface, and wrong
 * for a realizer, which places a surface built from the lemma. Counting those
 * three separately would triple both the candidate count and the frequency of
 * a word the writer used once in three shapes.
 *
 * So a realizer candidate is a **lexeme**: part of speech, independence,
 * conjugation class and base form. Conjugation class is in because 28 base
 * forms carry two admitted classes at once — きる is both 一段 (着る) and
 * 五段・ラ行 (切る) — and they inflect differently, so they really are two
 * lexemes. Base form alone is not an identity.
 *
 * **Reading is deliberately not in it.** The reading a token carries is the
 * reading of the *inflected* form, not of the lemma: the shipped dictionary
 * gives 歩く / 歩い / 歩き the readings アルク / アルイ / アルキ, which the
 * distribution suite tokenizes and asserts. Keying on it would split exactly
 * the lemma this identity exists to join, and an earlier version of this module
 * did — hidden by a fixture that set one reading on all three forms by hand.
 *
 * Dropping it merges the base forms that carry two readings under one class:
 * 割る is both ワル and ワレル, 居る both イル and オル. That merge is sound
 * rather than merely convenient, because `realizeMaxCandidate()` is a function
 * of (part of speech, independence, class, base form) alone — it never reads a
 * reading — so two records that differ only there produce byte-identical
 * surfaces for every Target form key. The distribution suite proves that over
 * every such group in the whole dictionary rather than asserting it here.
 * Nothing is lost either: every observed (form, reading) pair is retained on
 * the aggregate, so CORE1 can key Ruby or diagnostics on them if it needs to.
 */
export function maxLexemeIdentity(token: JapaneseToken): string {
	return JSON.stringify([
		token.pos,
		token.detail1,
		token.conjugationType,
		token.baseForm,
	]);
}

export type MaxLexeme = {
	readonly identity: string;
	readonly morphology: JapaneseToken;
	/** Summed once per contributing record, never once per observed form. */
	readonly frequency: number;
	readonly origins: readonly { readonly path: string; readonly contentHash: string; readonly count: number }[];
	/** Every display form that contributed, so provenance stays inspectable. */
	readonly displayFormIds: readonly string[];
	/**
	 * Every (conjugation form, reading) pair observed for this lexeme, sorted
	 * and deduplicated. Held rather than reconstructed: this is what the
	 * tokenizer returned, not a katakana paradigm this slice invented.
	 */
	readonly observedReadings: readonly {
		readonly conjugationForm: string;
		readonly reading: string | null;
	}[];
};

/**
 * Aggregates the Snapshot's own Manual projection records into lexemes.
 *
 * Each record contributes its frequency and origins exactly once. Two observed
 * forms of one lemma are neither split nor double counted — the same rule the
 * Collision lexeme pool already applies to its own dedupe, restated here over
 * a different identity because the identity is the thing being decided.
 */
export function aggregateLexemes(
	candidates: readonly ManualVocabularyCandidate[],
): readonly MaxLexeme[] {
	const byIdentity = new Map<string, {
		morphology: JapaneseToken;
		frequency: number;
		origins: Map<string, { path: string; contentHash: string; count: number }>;
		displayFormIds: string[];
		readings: Map<string, { conjugationForm: string; reading: string | null }>;
	}>();
	for (const record of candidates) {
		const token = record.morphology;
		if (token.isUnknown) continue;
		const verb = token.pos === "動詞" && token.detail1 === "自立";
		const adjective = token.pos === "形容詞" && token.detail1 === "自立";
		if (!verb && !adjective) continue;
		const identity = maxLexemeIdentity(token);
		const entry = byIdentity.get(identity) ?? {
			morphology: token,
			frequency: 0,
			origins: new Map<string, { path: string; contentHash: string; count: number }>(),
			displayFormIds: [] as string[],
			readings: new Map<string, { conjugationForm: string; reading: string | null }>(),
		};
		entry.frequency += record.frequency;
		for (const origin of record.origins) {
			const key = `${origin.path}${origin.contentHash}`;
			const existing = entry.origins.get(key);
			if (existing) existing.count += origin.count;
			else entry.origins.set(key, { path: origin.path, contentHash: origin.contentHash, count: origin.count });
		}
		entry.displayFormIds.push(record.displayFormId);
		const reading = token.reading ?? null;
		entry.readings.set(`${token.conjugationForm}${reading ?? ""}`, {
			conjugationForm: token.conjugationForm,
			reading,
		});
		byIdentity.set(identity, entry);
	}
	return [...byIdentity]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([identity, entry]) => ({
			identity,
			morphology: entry.morphology,
			frequency: entry.frequency,
			origins: [...entry.origins.values()],
			displayFormIds: [...entry.displayFormIds].sort(),
			observedReadings: [...entry.readings.values()].sort((a, b) =>
				a.conjugationForm === b.conjugationForm
					? String(a.reading).localeCompare(String(b.reading))
					: a.conjugationForm.localeCompare(b.conjugationForm),
			),
		}));
}

export type SlotProfile = {
	readonly kind: "noun" | "verb" | "i-adjective";
	readonly surface: string;
	readonly targetKey: MaxTargetFormKey | null;
	readonly strict: number;
	readonly high: number;
	readonly max: number;
	/** Why MAX produced nothing, when it did not. */
	readonly maxRejection: string | null;
};

export type ProfileTotals = {
	readonly slots: number;
	readonly strictSlots: number;
	readonly highSlots: number;
	readonly maxSlots: number;
	readonly strictCandidates: number;
	readonly highCandidates: number;
	readonly maxCandidates: number;
	readonly unsupportedTargetForm: number;
	readonly noCandidate: number;
};

function surfacesExcludingCurrent(values: Iterable<string>, current: string): Set<string> {
	const set = new Set(values);
	set.delete(current);
	return set;
}

/**
 * Measures one Target token list against one minted Vocabulary.
 *
 * `strict` is the real bucket for this slot's compatibility key. `high` keeps
 * the verified regular family — the same `compatibilityFamily` the Manual
 * contract computes, which is the conjugation class for a verb and the single
 * `regular-i-adjective` family for an adjective — and drops the requirement
 * that the Source observed this form or this follower. `max` drops the family
 * too and admits any lexeme the realizer will build for this Target key.
 *
 * All three count **distinct surfaces other than the one already displayed**,
 * because a slot whose only candidate reproduces the current surface is not
 * exchangeable — the rule Policy 1 §3.2 states and the existing noun and
 * Manual paths already apply.
 */
export function measureProfiles(
	targetTokens: readonly JapaneseToken[],
	vocabulary: ManualMorphVocabulary,
): { readonly slots: readonly SlotProfile[]; readonly totals: ProfileTotals } {
	const buckets = new Map(
		(readManualMorphCandidateBuckets(vocabulary) ?? []).map((bucket) => [bucket.key, bucket]),
	);
	const lexemes = aggregateLexemes(vocabulary.snapshot.projections.manual.candidates);
	const nounBuckets = new Map(
		vocabulary.snapshot.projections.automaticBody.buckets.map((bucket) => [bucket.key, bucket]),
	);
	/** The whole safe independent-noun family, across every bucket. */
	const nounFamilySurfaces = new Set(
		vocabulary.snapshot.projections.automaticBody.buckets.flatMap((bucket) =>
			bucket.surfaces.map((entry) => entry.surface),
		),
	);

	const slots: SlotProfile[] = [];
	let unsupportedTargetForm = 0;

	for (const [index, token] of targetTokens.entries()) {
		const next = targetTokens[index + 1] ?? null;

		if (isEligibleReplacementToken(token)) {
			// Policy 1 §4.1. strict is Body 10's own bucket, keyed by
			// `vocabularyPoolKey()` — part of speech, detail1, and detail2 as
			// well for a 固有名詞. High drops that fine sub-bucket match inside
			// the safe independent-noun family, and MAX requires nothing beyond
			// "safe noun", so the two coincide; the policy says in as many
			// words that they may.
			//
			// The relaxed family is the union of the projection's own buckets
			// and nothing else. Every surface in it is already an eligible
			// replacement token of this Snapshot — `isEligibleReplacementToken()`
			// admits 一般 / 固有名詞 / サ変接続 / 形容動詞語幹 and no other
			// class — so relaxing merges 固有名詞's sub-buckets and the four
			// detail1 classes with each other, and adds no pronoun, dependent
			// noun, suffix or unknown word. Policy §4.1 forbids adding those to
			// make the columns differ, and the difference here comes entirely
			// from dropping a constraint.
			const strict = surfacesExcludingCurrent(
				(nounBuckets.get(vocabularyPoolKey(token))?.surfaces ?? []).map((entry) => entry.surface),
				token.surface,
			).size;
			const relaxed = surfacesExcludingCurrent(nounFamilySurfaces, token.surface).size;
			slots.push({
				kind: "noun",
				surface: token.surface,
				targetKey: null,
				strict,
				high: relaxed,
				max: relaxed,
				maxRejection: relaxed === 0 ? "no-candidate" : null,
			});
			continue;
		}

		const connection = manualMorphConnection(token, next);
		if (!connection.supported) continue;
		const slotClass = connection.compatibility.slotClass;
		const family = connection.compatibility.compatibilityFamily;

		const strict = surfacesExcludingCurrent(
			(buckets.get(connection.compatibility.candidateCompatibilityKey)?.candidates ?? []).map((c) => c.surface),
			token.surface,
		).size;

		const keyResult = maxTargetFormKey(token, next);
		if (!keyResult.supported) {
			// A Manual slot this realizer has no Target requirement for. It keeps
			// its strict candidates and gains nothing; it never falls back.
			unsupportedTargetForm += 1;
			slots.push({ kind: slotClass, surface: token.surface, targetKey: null, strict, high: strict, max: strict, maxRejection: "unsupported-target-form" });
			continue;
		}

		const high = new Set<string>();
		const max = new Set<string>();
		for (const lexeme of lexemes) {
			const morphology = lexeme.morphology;
			const lexemeClass = morphology.pos === "形容詞" ? "i-adjective" : "verb";
			if (lexemeClass !== slotClass) continue;
			const realized = realizeMaxCandidate(keyResult.key, morphology);
			if (!realized.realized) continue;
			max.add(realized.surface);
			const lexemeFamily = slotClass === "i-adjective" ? "regular-i-adjective" : morphology.conjugationType;
			if (lexemeFamily === family) high.add(realized.surface);
		}
		max.delete(token.surface);
		high.delete(token.surface);
		slots.push({
			kind: slotClass,
			surface: token.surface,
			targetKey: keyResult.key,
			strict,
			high: high.size,
			max: max.size,
			maxRejection: max.size === 0 ? "no-candidate" : null,
		});
	}

	return {
		slots,
		totals: {
			slots: slots.length,
			strictSlots: slots.filter((slot) => slot.strict > 0).length,
			highSlots: slots.filter((slot) => slot.high > 0).length,
			maxSlots: slots.filter((slot) => slot.max > 0).length,
			strictCandidates: slots.reduce((a, s) => a + s.strict, 0),
			highCandidates: slots.reduce((a, s) => a + s.high, 0),
			maxCandidates: slots.reduce((a, s) => a + s.max, 0),
			unsupportedTargetForm,
			noCandidate: slots.filter((slot) => slot.max === 0).length,
		},
	};
}

/** Analyses Sources and a Target through the production seams, once. */
export async function prepareMeasurement(input: {
	readonly target: string;
	readonly sources: readonly { readonly path: string; readonly text: string }[];
	readonly tokenizer: JapaneseTokenizer;
	readonly drawMode?: "uniform" | "frequency";
}): Promise<{ vocabulary: ManualMorphVocabulary; targetTokens: readonly JapaneseToken[] }> {
	const analyses = [];
	for (const source of input.sources) {
		const analysed = await analyzeManualMorphSource({
			text: source.text,
			sourcePath: source.path,
			tokenizer: input.tokenizer,
		});
		if (analysed.status !== "ready") throw new Error(`source ${source.path}: ${analysed.status}`);
		analyses.push(analysed.analysis);
	}
	const vocabulary = buildManualMorphVocabulary({
		sources: analyses,
		drawMode: input.drawMode ?? "uniform",
	});
	return { vocabulary, targetTokens: await input.tokenizer.tokenize(input.target) };
}
