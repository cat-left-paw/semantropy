import { freezeAnalysis } from "../analysis/rubyVocabulary";
import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";
import {
	type AdverbCandidateIdentity,
	type AdverbFamilyRejection,
	classifyAdverbCandidate,
} from "./adverbFamily";

/**
 * `PRE-RELEASE-ADVERB-SPIKE1`: the closed, bounded rule for reading what an
 * adverb occurrence modifies.
 *
 * Every rule below was fixed against the shipped compact IPADIC, not against a
 * grammar description, and `tests/distribution/adverbSpike.test.ts` re-derives
 * the token sequences and the form inventories from the real dictionary. There
 * is no parser, no dependency analysis, no semantics and no repair: the scan
 * reads a bounded window of the same analysis run and answers, or refuses.
 *
 * ## What is observed
 *
 * An occurrence is `(candidate identity, head class, polarity, bridge)`.
 * Nothing weaker is recorded, because policy §7 makes head class and polarity
 * hard constraints and §8 makes the bridge a capability: an observation filed
 * under a surface alone would lend `ちょっと`/一般 the evidence gathered for
 * `ちょっと`/助詞類接続.
 *
 * ## Bridge (policy §8.1)
 *
 * A bridge is *only* a separate `助詞 / 副詞化 / と` token immediately after
 * the adverb. The dictionary has exactly two `助詞 / 副詞化` entries, `と` and
 * `に`, so the surface test is not redundant. Three near-misses are all
 * distinguished from it by real tokenizer output:
 *
 *   - `ゆっくりと歩く`   -> ゆっくり + 助詞/副詞化 と       : bridge `to`
 *   - `そっと歩く`       -> そっと                          : bridge `none`, lexical `と`
 *   - `ゆっくりと言った` -> ゆっくり + 助詞/格助詞/引用 と  : *not* a bridge
 *
 * The quotative case is why a bare "next token is と" rule is unsafe. It falls
 * through to the head search, which refuses a 助詞 head.
 *
 * ## Head class
 *
 * The head is exactly the one token after the adverb (or after the bridge).
 * The scan never skips forward looking for a better candidate, because a skip
 * is a guess about which predicate an adverb belongs to.
 *
 *   - `動詞 / 自立` with its conjugation fields present -> `verb-predicate`
 *   - `形容詞 / 自立` with its conjugation fields present -> `adjective-predicate`
 *   - `名詞 / 形容動詞語幹` **followed by a closed copula** -> `adjective-predicate`
 *   - `記号 / 読点` -> `sentence-modifier`
 *   - anything else -> `unsupported-head`
 *
 * The copula requirement is what refuses `ゆっくりと丁寧に歩く`: there 丁寧 is
 * followed by `助詞 / 副詞化 に`, so the stem is not the head and the real head
 * is two tokens further on. Guessing that is out of scope, so the occurrence is
 * simply not observed.
 *
 * ### The sentence modifier rule, and the tradeoff it carries
 *
 * A `記号 / 読点` immediately after the adverb — or after its bridge — is a
 * sentence modifier, observed with `not-applicable` polarity. **Nothing past
 * the comma is read**: no predicate search, no polarity inference, no denylist,
 * no semantic classification.
 *
 * That has a consequence the project owner has weighed and accepted. Two clause
 * modifiers reduce to the same profile whatever their clauses do:
 *
 *     Source `決して、彼は来ない`  -> sentence-modifier / not-applicable / none
 *     Target `もちろん、彼は来る`  -> sentence-modifier / not-applicable / none
 *
 * so `決して` is usable at the affirmative Target and `決して、彼は来る` is
 * reachable. The first independent review raised exactly this as a P1 against
 * the policy as it then stood, and it was correct to: the policy made polarity
 * a hard constraint with no exception. The owner has since amended the policy
 * (`Docs/pre_release_adverb_sentence_modifier_amendment1.md`, approved
 * 2026-09-21) to prefer variation and implementation simplicity here over
 * polarity agreement in clause-modifier position. This is therefore an approved
 * contract, not a regression, and the reachability above is asserted by a test
 * so it stays a decision rather than an accident.
 *
 * The alternative — finding the clause's predicate past a subject, particles
 * and any number of other adjuncts — is the parsing policy §1 forbids, and the
 * amendment does not reopen it.
 *
 * ## Polarity
 *
 * Polarity is a verb-predicate question. An adjective predicate and a sentence
 * modifier get the explicit value `not-applicable`, never a silent
 * `nonnegative` — the two must not be interchangeable.
 *
 * For a verb predicate the tail scan walks a closed state machine over at most
 * `ADVERB_TAIL_SCAN_LIMIT` tokens:
 *
 *   - a negative auxiliary (`助動詞` with one of the closed surfaces below)
 *     ends the scan as `negative`;
 *   - a continuation (any other `助動詞`, a `動詞 / 非自立` or `動詞 / 接尾`
 *     helper, or `助詞 / 接続助詞` て / で) advances it;
 *   - a terminator — punctuation, a content word, the end of the run — ends it
 *     as `nonnegative`;
 *   - `名詞 / 非自立` (の, わけ, はず, とき) and `助詞 / 係助詞` end it as
 *     `polarity-undetermined`, because the clause negation in
 *     `歩くのではない` lives past them and its `ない` is `形容詞 / 自立`;
 *   - an unknown token, a caller barrier and the scan limit are all fail-closed.
 *
 * Two refinements come straight from the dictionary's behaviour:
 *
 *   - A head whose conjugation form cannot stand on its own
 *     (`ADVERB_STANDALONE_VERB_FORMS` is the allowlist; everything else is
 *     bound) must cross at least one continuation. Reaching a terminator or the
 *     run end without doing so means the text was cut inside the predicate, so
 *     polarity is undetermined rather than affirmative.
 *   - A negative auxiliary followed by `助詞 / 接続助詞` is undetermined, not
 *     negative, because `歩かなければ` and `歩かなくては` are the front half of
 *     an obligation. This is a closed structural rule, not a semantic one; it
 *     costs `歩かないで` as well, which is the conservative direction.
 *
 * `なければならない` reaching `negative` would be a real mis-observation, and
 * refusing it here is cheaper than any analysis that could tell the two apart.
 */

export type AdverbHeadClass =
	| "verb-predicate"
	| "adjective-predicate"
	| "sentence-modifier";

export type AdverbPolarity = "negative" | "nonnegative" | "not-applicable";

export type AdverbBridge = "none" | "to";

export type AdverbObservationRejection =
	| AdverbFamilyRejection
	| "no-head"
	| "unsupported-head"
	| "polarity-undetermined"
	| "scan-limit-reached"
	| "boundary-crossed";

/**
 * One observed modification context. `profileKey` is the equality the Target
 * and a candidate observation must share before bridge capability is even
 * considered (policy §8.3).
 */
export type AdverbObservationProfile = {
	readonly headClass: AdverbHeadClass;
	readonly polarity: AdverbPolarity;
	readonly bridge: AdverbBridge;
	readonly profileKey: string;
};

export type AdverbObservation = {
	readonly identity: AdverbCandidateIdentity;
	readonly profile: AdverbObservationProfile;
};

export type AdverbObservationResult =
	| { readonly supported: true; readonly observation: AdverbObservation }
	| { readonly supported: false; readonly reason: AdverbObservationRejection };

/** The bridge particle, as the dictionary classifies it. */
const BRIDGE_POS = "助詞";
const BRIDGE_DETAIL1 = "副詞化";
const BRIDGE_SURFACE = "と";

const UNSET = "*";

/**
 * How far past a verb head the polarity scan may walk. `歩きませんでした` is
 * three tokens of tail; six leaves room for a helper verb chain
 * (`歩いていられません`) without ever becoming an open search.
 */
export const ADVERB_TAIL_SCAN_LIMIT = 6;

/**
 * The `動詞 / 自立` conjugation forms that can stand at the end of a clause
 * with no following token: the plain terminal forms and the imperatives.
 *
 * This is an **allowlist**, and the rest of the dictionary's 19 independent
 * verb forms — every 未然, 連用, 仮定 and 体言接続 variant — are bound by being
 * absent from it. That direction matters: a dictionary that gained a form this
 * list does not name would make it bound, which fails closed. The distribution
 * suite pins the full 19-form inventory so such a change is noticed rather than
 * silently absorbed.
 *
 * An earlier revision listed the bound forms directly and named only the 未然
 * and 仮定 families, so a run ending at `ゆっくり歩い` (連用タ接続) or
 * `ゆっくり食べ` (連用形) — text cut inside the predicate, for instance by a
 * line boundary before its auxiliary — was read as `nonnegative`. Independent
 * review found that; inverting the list is what makes the omission impossible
 * to repeat.
 *
 * The conservative cost is 連用中止法: `ゆっくり歩き、考える` is affirmative and
 * is now `polarity-undetermined`, because 連用形 is bound and the 読点 arrives
 * before any continuation. Admitting it needs its own closed rule and evidence,
 * not a wider allowlist.
 */
export const ADVERB_STANDALONE_VERB_FORMS: readonly string[] = Object.freeze([
	"基本形",
	"文語基本形",
	"現代基本形",
	"命令ｅ",
	"命令ｉ",
	"命令ｒｏ",
	"命令ｙｏ",
]);

const STANDALONE_VERB_FORMS = new Set(ADVERB_STANDALONE_VERB_FORMS);

/**
 * Every `助動詞` surface that makes the predicate it attaches to negative.
 * Compaction drops the base form of every `助動詞` entry, so these are
 * surfaces, and each one is pinned to real tokenizer output by the
 * distribution suite.
 */
export const ADVERB_NEGATIVE_AUXILIARY_SURFACES: readonly string[] =
	Object.freeze([
		"ない",
		"なかっ",
		"なかろ",
		"なく",
		"なけれ",
		"ざる",
		"ず",
		"ぬ",
		"ね",
		"まい",
		"ん",
	]);

const NEGATIVE_AUXILIARY_SURFACES = new Set(ADVERB_NEGATIVE_AUXILIARY_SURFACES);

/**
 * The copulas that turn a `名詞 / 形容動詞語幹` into an adjectival predicate.
 * All are `助動詞`; `に` (`助詞 / 副詞化`) is deliberately absent, because it
 * makes the stem adverbial and moves the head elsewhere.
 */
export const ADVERB_COPULA_SURFACES: readonly string[] = Object.freeze([
	"だ",
	"だっ",
	"だろ",
	"で",
	"でし",
	"です",
	"な",
	"なら",
]);

const COPULA_SURFACES = new Set(ADVERB_COPULA_SURFACES);

const CONTINUATION_PARTICLE_SURFACES = new Set(["て", "で"]);

/**
 * The `助動詞` surfaces that can be the last token of a clause.
 *
 * Crossing a continuation does not make a predicate complete: the *last* thing
 * crossed has to be able to end it. An earlier revision only asked whether
 * anything had been crossed, so a run cut off at `ゆっくり歩いてい`,
 * `ゆっくり歩きまし` or `ゆっくり歩かせ` — each one a predicate truncated
 * mid-tail — was recorded as an affirmative observation. Independent review
 * found all three.
 *
 * Why this is a surface list, and why only `助動詞` is on it: compaction drops
 * slots 3-7 for `助動詞`, `動詞 / 非自立` and `動詞 / 接尾` alike, so none of
 * them carries a conjugation form or a base form at all. For an auxiliary the
 * surface is still decisive, because each of these is a distinct terminal form.
 * For a helper verb (`い` vs `いる`, `せ` vs `せる`) and for a 接続助詞 there is
 * nothing readable to decide on, so they are never clause-final here. That is a
 * limit of the shipped data, not a judgement about Japanese.
 *
 * The conservative cost is a run that ends at `ゆっくり歩いている` or
 * `ゆっくり歩いておく` with no punctuation: affirmative, but not observed. With
 * a 句点 or any other terminator the scan decides normally, because a
 * terminator proves where the predicate ended.
 *
 * Every surface here is pinned to real verb-tail tokenizer output by the
 * distribution suite.
 */
export const ADVERB_CLAUSE_FINAL_AUXILIARY_SURFACES: readonly string[] =
	Object.freeze(["う", "たい", "た", "ます", "らしい"]);

const CLAUSE_FINAL_AUXILIARY_SURFACES = new Set(
	ADVERB_CLAUSE_FINAL_AUXILIARY_SURFACES,
);

/** Whether this continuation, as the last token of a run, can end the clause. */
function isClauseFinalContinuation(token: JapaneseToken): boolean {
	return (
		token.pos === "助動詞" && CLAUSE_FINAL_AUXILIARY_SURFACES.has(token.surface)
	);
}

function isPresent(value: string | undefined): value is string {
	return typeof value === "string" && value.length > 0 && value !== UNSET;
}

function profileKey(
	headClass: AdverbHeadClass,
	polarity: AdverbPolarity,
	bridge: AdverbBridge,
): string {
	return JSON.stringify([headClass, polarity, bridge]);
}

/** A caller-declared cut: a Chunk or Ruby boundary the scan may not cross. */
function blocked(index: number, barriers: ReadonlySet<number>): boolean {
	return barriers.has(index);
}

/** Exported (unchanged) so MAX-CORE1's bridge reading shares this one definition. */
export function isBridgeToken(token: JapaneseToken): boolean {
	return (
		!token.isUnknown &&
		token.pos === BRIDGE_POS &&
		token.detail1 === BRIDGE_DETAIL1 &&
		token.surface === BRIDGE_SURFACE
	);
}

function isNegativeAuxiliary(token: JapaneseToken): boolean {
	return token.pos === "助動詞" && NEGATIVE_AUXILIARY_SURFACES.has(token.surface);
}

function isTailContinuation(token: JapaneseToken): boolean {
	if (token.pos === "助動詞") {
		return true;
	}
	if (token.pos === "動詞") {
		return token.detail1 === "非自立" || token.detail1 === "接尾";
	}
	return (
		token.pos === "助詞" &&
		token.detail1 === "接続助詞" &&
		CONTINUATION_PARTICLE_SURFACES.has(token.surface)
	);
}

/** Structures that can still carry a clause negation the tail scan cannot see. */
function isAmbiguousTail(token: JapaneseToken): boolean {
	return (
		(token.pos === "名詞" && token.detail1 === "非自立") ||
		(token.pos === "助詞" && token.detail1 === "係助詞")
	);
}

function isConnectiveParticle(token: JapaneseToken): boolean {
	return !token.isUnknown && token.pos === "助詞" && token.detail1 === "接続助詞";
}

type PolarityOutcome =
	| { readonly decided: true; readonly polarity: "negative" | "nonnegative" }
	| { readonly decided: false; readonly reason: AdverbObservationRejection };

function scanVerbPolarity(
	tokens: readonly JapaneseToken[],
	headIndex: number,
	barriers: ReadonlySet<number>,
): PolarityOutcome {
	const bound = !STANDALONE_VERB_FORMS.has(tokens[headIndex]!.conjugationForm);
	let crossed = 0;
	let clauseFinal = false;
	for (let index = headIndex + 1; ; index += 1) {
		if (blocked(index, barriers)) {
			return { decided: false, reason: "boundary-crossed" };
		}
		const token = tokens[index];
		if (!token) {
			// The end of the analysis run is a real text boundary, unlike a
			// caller barrier, so it decides — but only for a predicate that is
			// actually finished. With nothing crossed that means a standalone
			// head form; with something crossed it means the last token crossed
			// can itself end a clause. Anything else is a run that stopped
			// inside the predicate.
			const complete = crossed === 0 ? !bound : clauseFinal;
			return complete
				? { decided: true, polarity: "nonnegative" }
				: { decided: false, reason: "polarity-undetermined" };
		}
		if (token.isUnknown) {
			return { decided: false, reason: "polarity-undetermined" };
		}
		if (isNegativeAuxiliary(token)) {
			const next = tokens[index + 1];
			if (
				!blocked(index + 1, barriers) &&
				next !== undefined &&
				isConnectiveParticle(next)
			) {
				return { decided: false, reason: "polarity-undetermined" };
			}
			return { decided: true, polarity: "negative" };
		}
		if (isTailContinuation(token)) {
			crossed += 1;
			clauseFinal = isClauseFinalContinuation(token);
			if (crossed > ADVERB_TAIL_SCAN_LIMIT) {
				return { decided: false, reason: "scan-limit-reached" };
			}
			continue;
		}
		if (isAmbiguousTail(token)) {
			return { decided: false, reason: "polarity-undetermined" };
		}
		return bound && crossed === 0
			? { decided: false, reason: "polarity-undetermined" }
			: { decided: true, polarity: "nonnegative" };
	}
}

type HeadOutcome =
	| { readonly supported: true; readonly headClass: AdverbHeadClass }
	| { readonly supported: false; readonly reason: AdverbObservationRejection };

function classifyHead(
	tokens: readonly JapaneseToken[],
	headIndex: number,
	barriers: ReadonlySet<number>,
): HeadOutcome {
	if (blocked(headIndex, barriers)) {
		return { supported: false, reason: "boundary-crossed" };
	}
	const head = tokens[headIndex];
	if (!head) {
		return { supported: false, reason: "no-head" };
	}
	if (head.isUnknown) {
		return { supported: false, reason: "unsupported-head" };
	}
	if (head.pos === "記号" && head.detail1 === "読点") {
		// Owner-approved contract (amendment 1): a 読点 immediately after the
		// adverb or its bridge is a sentence modifier, observed with
		// `not-applicable` polarity. Nothing past the comma is read — no
		// predicate search, no polarity inference.
		return { supported: true, headClass: "sentence-modifier" };
	}
	const inflected =
		isPresent(head.conjugationType) &&
		isPresent(head.conjugationForm) &&
		isPresent(head.baseForm);
	if (head.pos === "動詞" && head.detail1 === "自立") {
		return inflected
			? { supported: true, headClass: "verb-predicate" }
			: { supported: false, reason: "unsupported-head" };
	}
	if (head.pos === "形容詞" && head.detail1 === "自立") {
		return inflected
			? { supported: true, headClass: "adjective-predicate" }
			: { supported: false, reason: "unsupported-head" };
	}
	if (head.pos === "名詞" && head.detail1 === "形容動詞語幹") {
		if (blocked(headIndex + 1, barriers)) {
			return { supported: false, reason: "boundary-crossed" };
		}
		const copula = tokens[headIndex + 1];
		if (
			copula !== undefined &&
			!copula.isUnknown &&
			copula.pos === "助動詞" &&
			COPULA_SURFACES.has(copula.surface)
		) {
			return { supported: true, headClass: "adjective-predicate" };
		}
		return { supported: false, reason: "unsupported-head" };
	}
	return { supported: false, reason: "unsupported-head" };
}

/**
 * Observes the adverb at `index` in one analysis run.
 *
 * `tokens` is a single run, in order; the scan never leaves it, so a line, a
 * protected region or a Chunk that the caller analyzed separately is already a
 * boundary. `barriers` cuts a run further — the indices a Ruby or Chunk
 * boundary falls on — and, unlike the end of the run, a barrier is fail-closed
 * rather than decisive.
 */
export function observeAdverbSlot(input: {
	tokens: readonly JapaneseToken[];
	index: number;
	barriers?: readonly number[];
}): AdverbObservationResult {
	const tokens = input.tokens;
	const token = tokens[input.index];
	if (!token) {
		return { supported: false, reason: "unknown-token" };
	}
	const family = classifyAdverbCandidate(token);
	if (!family.supported) {
		return { supported: false, reason: family.reason };
	}
	const barriers = new Set(input.barriers ?? []);

	const after = tokens[input.index + 1];
	const bridged =
		after !== undefined &&
		!blocked(input.index + 1, barriers) &&
		isBridgeToken(after);
	const bridge: AdverbBridge = bridged ? "to" : "none";
	const headIndex = input.index + (bridged ? 2 : 1);

	const head = classifyHead(tokens, headIndex, barriers);
	if (!head.supported) {
		return { supported: false, reason: head.reason };
	}

	let polarity: AdverbPolarity = "not-applicable";
	if (head.headClass === "verb-predicate") {
		const outcome = scanVerbPolarity(tokens, headIndex, barriers);
		if (!outcome.decided) {
			return { supported: false, reason: outcome.reason };
		}
		polarity = outcome.polarity;
	}

	return {
		supported: true,
		observation: freezeAnalysis({
			identity: family.identity,
			profile: {
				headClass: head.headClass,
				polarity,
				bridge,
				profileKey: profileKey(head.headClass, polarity, bridge),
			},
		}),
	};
}

/** One candidate identity and every distinct context it was observed in. */
export type AdverbObservationEntry = {
	readonly identity: AdverbCandidateIdentity;
	readonly profiles: readonly AdverbObservationProfile[];
};

/**
 * Every candidate identity observed across a set of analysis runs.
 *
 * Filed under `identityKey`, so two candidates that share a surface never share
 * evidence. The public shape is immutable and canonically ordered: `entries`
 * and `candidates` are deeply frozen arrays sorted by identity key, each
 * entry's profiles are sorted by profile key, and `lookup` is a frozen function
 * closing over a private map.
 *
 * An earlier revision exposed a plain `Map`, which independent review found was
 * still `clear()`-able after the root was frozen, and whose iteration order was
 * first-occurrence order rather than canonical — so two identical observation
 * sets read from runs in different orders produced different indexes. Arrays
 * and a closure fix both at once: there is no mutable collection to hand out.
 *
 * This slice stops here on purpose: the index is a value over runs the caller
 * supplies, with no minted owner, no Snapshot and no authentication.
 * `PRE-RELEASE-ADVERB-MANUAL1` owns binding it to an authenticated Vocabulary.
 */
export type AdverbObservationIndex = {
	readonly entries: readonly AdverbObservationEntry[];
	readonly candidates: readonly AdverbCandidateIdentity[];
	readonly lookup: (identityKey: string) => AdverbObservationEntry | null;
};

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function buildAdverbObservationIndex(
	runs: readonly {
		readonly tokens: readonly JapaneseToken[];
		readonly barriers?: readonly number[];
	}[],
): AdverbObservationIndex {
	const identities = new Map<string, AdverbCandidateIdentity>();
	const profiles = new Map<string, Map<string, AdverbObservationProfile>>();
	for (const run of runs) {
		for (let index = 0; index < run.tokens.length; index += 1) {
			const result = observeAdverbSlot({
				tokens: run.tokens,
				index,
				...(run.barriers === undefined ? {} : { barriers: run.barriers }),
			});
			if (!result.supported) {
				continue;
			}
			const { identity, profile } = result.observation;
			identities.set(identity.identityKey, identity);
			const seen =
				profiles.get(identity.identityKey) ??
				new Map<string, AdverbObservationProfile>();
			seen.set(profile.profileKey, profile);
			profiles.set(identity.identityKey, seen);
		}
	}

	const entries: AdverbObservationEntry[] = [...identities.values()]
		.sort((a, b) => compare(a.identityKey, b.identityKey))
		.map((identity) => {
			// An identity only reaches `identities` through a supported
			// observation, so its profile map is always present.
			const seen =
				profiles.get(identity.identityKey) ??
				new Map<string, AdverbObservationProfile>();
			return freezeAnalysis({
				identity,
				profiles: [...seen.values()].sort((a, b) =>
					compare(a.profileKey, b.profileKey),
				),
			});
		});

	// Private: the only mutable collection, and it never leaves this closure.
	const byKey = new Map(entries.map((entry) => [entry.identity.identityKey, entry]));
	const lookup = Object.freeze((identityKey: string): AdverbObservationEntry | null =>
		typeof identityKey === "string" ? (byKey.get(identityKey) ?? null) : null,
	);

	return Object.freeze({
		entries: Object.freeze(entries),
		candidates: Object.freeze(entries.map((entry) => entry.identity)),
		lookup,
	});
}
