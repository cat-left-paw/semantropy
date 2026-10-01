import { describe, expect, it } from "vitest";
import { analyzeSelectedSource } from "../src/application/analyzeSelectedSource";
import type {
	JapaneseToken,
	JapaneseTokenizer,
} from "../src/tokenizer/JapaneseTokenizer";
import { buildRubyVocabulary } from "../src/analysis/rubyVocabulary";
import { hashSourceText } from "../src/application/hashSourceText";
import * as manualMorphology from "../src/transform/manualMorphology";
import {
	MANUAL_MORPH_ADJECTIVE_CONJUGATION_TYPES,
	MANUAL_MORPH_ALLOWLIST,
	MANUAL_MORPH_EVIDENCE_ERROR_MESSAGE,
	MANUAL_MORPH_POLICY_VERSION,
	MANUAL_MORPH_SOURCE_ANALYSIS_ERROR_MESSAGE,
	MANUAL_MORPH_VERB_CONJUGATION_TYPES,
	ManualMorphEvidenceError,
	analyzeManualMorphSource,
	buildManualMorphVocabulary,
	evaluateManualMorphSlot,
	manualMorphConnection,
	type ManualMorphEvidence,
	type ManualMorphSourceAnalysis,
} from "../src/transform/manualMorphology";
import { isEligibleReplacementToken } from "../src/transform/tokenPolicy";
import { sha256Hex } from "../src/vocabulary/sha256";
import {
	buildVocabularySnapshot,
	type VocabularySnapshot,
} from "../src/vocabulary/vocabularySnapshot";

/**
 * Field values below are copied from Lindera 6.0.0 with the full IPADIC
 * (tests/distribution/manualMorphology.test.ts checks the same cases against
 * the real tokenizer). Nothing here is derived from a surface.
 */
function morph(
	surface: string,
	pos: string,
	detail1: string,
	conjugationType: string,
	conjugationForm: string,
	baseForm: string,
	reading?: string,
): JapaneseToken {
	return {
		surface,
		pos,
		detail1,
		detail2: "*",
		detail3: "*",
		conjugationType,
		conjugationForm,
		baseForm,
		...(reading === undefined ? {} : { reading }),
		isUnknown: false,
	};
}

const verb = (s: string, type: string, form: string, base: string) =>
	morph(s, "動詞", "自立", type, form, base, "ヨミ");
const adjective = (s: string, type: string, form: string, base: string) =>
	morph(s, "形容詞", "自立", type, form, base, "ヨミ");
const fn = (s: string, pos: string, detail1: string) =>
	morph(s, pos, detail1, "*", "*", "*");

const TE = fn("て", "助詞", "接続助詞");
const DE = fn("で", "助詞", "接続助詞");
const TA = fn("た", "助動詞", "*");
const DA = fn("だ", "助動詞", "*");
const NAI = fn("ない", "助動詞", "*");
const ZU = fn("ず", "助動詞", "*");
const MASU = fn("ます", "助動詞", "*");
const SE = fn("せ", "動詞", "接尾");
const PERIOD = fn("。", "記号", "句点");

const 書い = verb("書い", "五段・カ行イ音便", "連用タ接続", "書く");
const 描い = verb("描い", "五段・カ行イ音便", "連用タ接続", "描く");
const 歩い = verb("歩い", "五段・カ行イ音便", "連用タ接続", "歩く");
const 泳い = verb("泳い", "五段・ガ行", "連用タ接続", "泳ぐ");
const 読ん = verb("読ん", "五段・マ行", "連用タ接続", "読む");
const 飲ん = verb("飲ん", "五段・マ行", "連用タ接続", "飲む");
const 飛ん = verb("飛ん", "五段・バ行", "連用タ接続", "飛ぶ");
const 待っ = verb("待っ", "五段・タ行", "連用タ接続", "待つ");
const 持っ = verb("持っ", "五段・タ行", "連用タ接続", "持つ");
const 買っ = verb("買っ", "五段・ワ行促音便", "連用タ接続", "買う");
const 分から = verb("分から", "五段・ラ行", "未然形", "分かる");
const 帰ら = verb("帰ら", "五段・ラ行", "未然形", "帰る");
const あら = verb("あら", "五段・ラ行", "未然形", "ある");
const 食べ未然 = verb("食べ", "一段", "未然形", "食べる");
const 食べ連用 = verb("食べ", "一段", "連用形", "食べる");
const 見未然 = verb("見", "一段", "未然形", "見る");
const 着未然 = verb("着", "一段", "未然形", "着る");
const 書か = verb("書か", "五段・カ行イ音便", "未然形", "書く");
const 描か = verb("描か", "五段・カ行イ音便", "未然形", "描く");
const 書き = verb("書き", "五段・カ行イ音便", "連用形", "書く");
const 焼き = verb("焼き", "五段・カ行イ音便", "連用形", "焼く");
const 青かっ = adjective("青かっ", "形容詞・アウオ段", "連用タ接続", "青い");
const 赤かっ = adjective("赤かっ", "形容詞・アウオ段", "連用タ接続", "赤い");
const 美しかっ = adjective("美しかっ", "形容詞・イ段", "連用タ接続", "美しい");
const 静か = morph("静か", "名詞", "形容動詞語幹", "*", "*", "静か", "シズカ");
const NA = fn("な", "助動詞", "*");

type Prepared = {
	snapshot: VocabularySnapshot;
	evidence: ManualMorphEvidence;
	analyses: ManualMorphSourceAnalysis[];
};

/** A fixed-table tokenizer: each analysis run is looked up whole. */
function tokenizerFor(table: ReadonlyMap<string, JapaneseToken[]>): JapaneseTokenizer {
	return {
		tokenize: (text) => {
			const tokens = table.get(text);
			if (!tokens) {
				throw new Error("unexpected run");
			}
			return Promise.resolve(tokens.map((token) => ({ ...token })));
		},
	};
}

function table(runs: JapaneseToken[][]): Map<string, JapaneseToken[]> {
	return new Map(runs.map((run) => [run.map((token) => token.surface).join(""), run]));
}

/**
 * Analyzes a Source through the manual morphology entry point. Each token run
 * is one paragraph, so the table tokenizer sees exactly those runs.
 */
async function analyze(
	path: string,
	runs: JapaneseToken[][],
	markdown?: string,
): Promise<ManualMorphSourceAnalysis> {
	const lookup = table(runs);
	const result = await analyzeManualMorphSource({
		text: markdown ?? [...lookup.keys()].join("\n\n"),
		sourcePath: path,
		tokenizer: tokenizerFor(lookup),
	});
	if (result.status !== "ready") {
		throw new Error(result.status);
	}
	return result.analysis;
}

async function prepare(...runs: JapaneseToken[][]): Promise<Prepared> {
	const analyses = [await analyze("source.md", runs)];
	return { ...buildManualMorphVocabulary({ sources: analyses, drawMode: "uniform" }), analyses };
}

function evaluate(
	target: JapaneseToken,
	next: JapaneseToken | null,
	prepared: Pick<Prepared, "snapshot" | "evidence">,
	currentSurface = target.surface,
) {
	return evaluateManualMorphSlot({
		target,
		next,
		currentSurface,
		snapshot: prepared.snapshot,
		evidence: prepared.evidence,
	});
}

function surfaces(result: ReturnType<typeof evaluate>): string[] {
	return result.candidates.map((candidate) => candidate.surface);
}

function evidenceError(action: () => unknown): string {
	try {
		action();
	} catch (error) {
		expect(error).toBeInstanceOf(ManualMorphEvidenceError);
		expect((error as Error).message).toBe(MANUAL_MORPH_EVIDENCE_ERROR_MESSAGE);
		return (error as ManualMorphEvidenceError).code;
	}
	throw new Error("expected a ManualMorphEvidenceError");
}

/** Plain, fully mutable deep copy. */
function thaw<T>(value: T): T {
	return structuredClone(value);
}

describe("manual morphology allowlist", () => {
	it("is an explicit allowlist of conjugation types, forms and connections", () => {
		expect(MANUAL_MORPH_POLICY_VERSION).toBe("manual-morph-2");
		expect([...MANUAL_MORPH_VERB_CONJUGATION_TYPES]).toEqual([
			"一段",
			"五段・カ行イ音便",
			"五段・ガ行",
			"五段・サ行",
			"五段・タ行",
			"五段・ナ行",
			"五段・バ行",
			"五段・マ行",
			"五段・ラ行",
			"五段・ワ行促音便",
		]);
		expect([...MANUAL_MORPH_ADJECTIVE_CONJUGATION_TYPES]).toEqual([
			"形容詞・アウオ段",
			"形容詞・イ段",
		]);
		expect(MANUAL_MORPH_ALLOWLIST).toEqual({
			verb: {
				conjugationTypes: [...MANUAL_MORPH_VERB_CONJUGATION_TYPES],
				forms: {
					基本形: { targetFollower: "allowlist", connections: ["period", "comma", "general-noun", "dependent-noun-koto", "particle-to", "particle-kara"] },
					未然形: { targetFollower: "allowlist", connections: ["aux-nai", "aux-nu", "suffix-seru", "suffix-saseru", "suffix-reru", "suffix-rareru"] },
					未然ウ接続: { targetFollower: "allowlist", connections: ["aux-u"] },
					連用形: { targetFollower: "allowlist", connections: ["aux-masu", "aux-tai", "aux-ta", "particle-te", "particle-nagara"] },
					連用タ接続: { targetFollower: "allowlist", connections: ["aux-ta", "aux-da", "particle-te", "particle-de"] },
					仮定形: { targetFollower: "allowlist", connections: ["particle-ba"] },
				},
			},
			"i-adjective": {
				conjugationTypes: [...MANUAL_MORPH_ADJECTIVE_CONJUGATION_TYPES],
				forms: {
					基本形: { targetFollower: "any", connections: [] },
					連用テ接続: { targetFollower: "allowlist", connections: ["aux-nai", "particle-te", "verb-naru"] },
					連用タ接続: { targetFollower: "allowlist", connections: ["aux-ta"] },
					仮定形: { targetFollower: "allowlist", connections: ["particle-ba"] },
				},
			},
		});
		expect(Object.isFrozen(MANUAL_MORPH_ALLOWLIST)).toBe(true);
		const basic = MANUAL_MORPH_ALLOWLIST["i-adjective"].forms["基本形"]!;
		expect(Object.isFrozen(basic)).toBe(true);
		expect(Object.isFrozen(basic.connections)).toBe(true);
		expect(manualMorphConnection(adjective("青い", "形容詞・アウオ段", "基本形", "青い"), null).supported).toBe(basic.targetFollower === "any");
		for (const rule of Object.values(MANUAL_MORPH_ALLOWLIST.verb.forms)) expect(rule.targetFollower).toBe("allowlist");
	});

	it("does not change the automatic body policy: verbs and adjectives stay out", () => {
		for (const token of [書い, 分から, 食べ連用, 青かっ, 美しかっ]) {
			expect(isEligibleReplacementToken(token)).toBe(false);
		}
		expect(isEligibleReplacementToken(静か)).toBe(true);
	});
});

describe("manualMorphConnection rejects what it cannot vouch for", () => {
	it("rejects unknown tokens", () => {
		expect(manualMorphConnection({ ...書い, isUnknown: true }, TE)).toEqual({
			supported: false,
			reason: "unknown-token",
		});
	});

	it("rejects 名詞 / 形容動詞語幹 instead of treating it as an イ-adjective", () => {
		expect(manualMorphConnection(静か, NA)).toEqual({
			supported: false,
			reason: "unsupported-part-of-speech",
		});
	});

	it("rejects a verb whose pos or detail1 alone differs", () => {
		expect(
			manualMorphConnection({ ...書い, detail1: "非自立" }, TE),
		).toMatchObject({ reason: "unsupported-part-of-speech" });
		// pos alone differs: an adjective record cannot carry a verb type.
		expect(
			manualMorphConnection({ ...書い, pos: "形容詞" }, TE),
		).toMatchObject({ reason: "unsupported-conjugation-type" });
		expect(
			manualMorphConnection({ ...書い, pos: "名詞" }, TE),
		).toMatchObject({ reason: "unsupported-part-of-speech" });
	});

	it.each([
		["conjugationType", "*"],
		["conjugationType", ""],
		["conjugationForm", "*"],
		["conjugationForm", ""],
		["baseForm", "*"],
		["baseForm", ""],
	] as const)("rejects %s = %j as a missing field", (field, value) => {
		expect(manualMorphConnection({ ...書い, [field]: value }, TE)).toEqual({
			supported: false,
			reason: "missing-field",
		});
	});

	it("rejects the compact dictionary's verb tokens, whose conjugation slots are '*'", () => {
		const compacted = {
			...書い,
			conjugationType: "*",
			conjugationForm: "*",
			baseForm: "*",
		};
		delete (compacted as Partial<JapaneseToken>).reading;
		expect(manualMorphConnection(compacted, TE)).toMatchObject({
			reason: "missing-field",
		});
	});

	it("rejects conjugation types and forms outside the allowlist", () => {
		expect(
			manualMorphConnection(verb("し", "サ変・スル", "連用形", "する"), MASU),
		).toMatchObject({ reason: "unsupported-conjugation-type" });
		expect(
			manualMorphConnection(verb("行っ", "五段・カ行促音便", "連用タ接続", "行く"), TE),
		).toMatchObject({ reason: "unsupported-conjugation-type" });
		expect(
			manualMorphConnection(adjective("いい", "形容詞・イイ", "基本形", "いい"), PERIOD),
		).toMatchObject({ reason: "unsupported-conjugation-type" });
		expect(
			manualMorphConnection(verb("書け", "五段・カ行イ音便", "命令ｅ", "書く"), PERIOD),
		).toMatchObject({ reason: "unsupported-conjugation-form" });
		expect(
			manualMorphConnection(verb("書きゃ", "五段・カ行イ音便", "仮定縮約１", "書く"), PERIOD),
		).toMatchObject({ reason: "unsupported-conjugation-form" });
	});

	it("rejects followers outside the listed connections, and the end of a run", () => {
		expect(manualMorphConnection(書い, null)).toMatchObject({
			reason: "unsupported-connection",
		});
		expect(manualMorphConnection(書い, NAI)).toMatchObject({
			reason: "unsupported-connection",
		});
		expect(manualMorphConnection(書い, { ...TE, isUnknown: true })).toMatchObject({
			reason: "unsupported-connection",
		});
		// Same surface, different class: で as a case particle is not the
		// conjunctive で that follows 連用タ接続.
		expect(
			manualMorphConnection(読ん, fn("で", "助詞", "格助詞")),
		).toMatchObject({ reason: "unsupported-connection" });
		// The whitespace token the Lindera adapter restores is unknown and '*'.
		expect(
			manualMorphConnection(書い, {
				...fn(" ", "*", "*"),
				isUnknown: true,
			}),
		).toMatchObject({ reason: "unsupported-connection" });
	});

	it("keys て and で, た and だ as different connections", () => {
		const keyOf = (token: JapaneseToken, next: JapaneseToken) => {
			const result = manualMorphConnection(token, next);
			if (!result.supported) {
				throw new Error(result.reason);
			}
			return result.connectionKey;
		};
		expect(keyOf(書い, TE)).not.toBe(keyOf(書い, DE));
		expect(keyOf(書い, TA)).not.toBe(keyOf(書い, DA));
		expect(JSON.parse(keyOf(読ん, DE))).toEqual([
			"manual-morph-2",
			"verb",
			"動詞",
			"自立",
			"五段・マ行",
			"連用タ接続",
			"particle-de",
		]);
	});
});

describe("evaluateManualMorphSlot (MAN-03-05 morphology core)", () => {
	it("MAN-03: offers a same-type, same-form verb observed before て", async () => {
		const result = evaluate(書い, TE, await prepare([描い, TE], [読ん, DE]));
		expect(result).toMatchObject({ available: true, slotClass: "verb" });
		expect(surfaces(result)).toEqual(["描い"]);
	});

	it("MAN-05 て/で: rejects イ音便 ガ行 for カ行 (no 書いで / 泳いて)", async () => {
		expect(evaluate(書い, TE, await prepare([泳い, DE]))).toEqual({
			available: false,
			reason: "no-candidate",
			candidates: [],
		});
		expect(evaluate(泳い, DE, await prepare([書い, TE]))).toMatchObject({
			reason: "no-candidate",
		});
	});

	it("MAN-05 た/だ: 撥音便 マ行 accepts マ行 only, never バ行 or a た-verb", async () => {
		const prepared = await prepare([飲ん, DA], [飛ん, DA], [書い, TA]);
		expect(surfaces(evaluate(読ん, DA, prepared))).toEqual(["飲ん"]);
	});

	it("MAN-05 促音便: タ行 does not take ワ行促音便 even though both end in っ", async () => {
		const prepared = await prepare([持っ, TE], [買っ, TE]);
		expect(surfaces(evaluate(待っ, TE, prepared))).toEqual(["持っ"]);
	});

	it("rejects conjugationType mismatch and conjugationForm mismatch", async () => {
		const 読ま = verb("読ま", "五段・マ行", "未然形", "読む");
		expect(evaluate(書か, SE, await prepare([読ま, SE]))).toMatchObject({
			reason: "no-candidate",
		});
		expect(evaluate(書か, NAI, await prepare([書き, MASU]))).toMatchObject({
			reason: "no-candidate",
		});
	});

	it("MAN-05 助動詞列: requires the candidate to have been seen with the same auxiliary", async () => {
		expect(evaluate(書か, SE, await prepare([描か, NAI]))).toMatchObject({
			reason: "no-candidate",
		});
		expect(surfaces(evaluate(書か, SE, await prepare([描か, SE])))).toEqual(["描か"]);
	});

	it("MAN-05 否定: rejects あら (seen only before ず) for 分から before ない", async () => {
		expect(surfaces(evaluate(分から, NAI, await prepare([あら, ZU], [帰ら, NAI])))).toEqual(["帰ら"]);
		expect(evaluate(分から, NAI, await prepare([あら, ZU]))).toMatchObject({
			reason: "no-candidate",
		});
	});

	it("MAN-05 丁寧形: 連用形 before ます", async () => {
		expect(surfaces(evaluate(書き, MASU, await prepare([焼き, MASU])))).toEqual(["焼き"]);
	});

	it("keeps same-surface records with different morphology as different identities", async () => {
		const 見連用 = verb("見", "一段", "連用形", "見る");
		const prepared = await prepare([見未然, NAI], [見連用, MASU], [食べ連用, MASU]);
		const result = evaluate(食べ未然, NAI, prepared);
		expect(result.available).toBe(true);
		expect(result.candidates).toHaveLength(1);
		const records = prepared.snapshot.projections.manual.candidates.filter(
			(record) => record.surface === "見",
		);
		expect(records).toHaveLength(2);
		const 未然 = records.find((record) => record.morphology.conjugationForm === "未然形");
		expect(result.candidates[0]?.candidateId).toBe(未然?.candidateId);
		expect(result.candidates[0]?.displayFormId).toBe(未然?.displayFormId);
	});

	it("MAN-04: a slot whose only compatible record shows the current surface is unavailable", async () => {
		expect(evaluate(書い, TE, await prepare([書い, TE]))).toEqual({
			available: false,
			reason: "only-current-surface",
			candidates: [],
		});
		const prepared = await prepare([書い, TE], [描い, TE]);
		expect(surfaces(evaluate(書い, TE, prepared, "描い"))).toEqual(["書い"]);
	});

	it("MAN-04: never generates a surface that the Source did not contain", async () => {
		const 描く = verb("描く", "五段・カ行イ音便", "基本形", "描く");
		expect(evaluate(書い, TE, await prepare([描く, PERIOD]))).toMatchObject({
			reason: "no-candidate",
		});
		const prepared = await prepare([焼き, MASU], [描く, PERIOD]);
		const sourceSurfaces = new Set(
			prepared.snapshot.candidates.map((candidate) => candidate.surface),
		);
		for (const surface of surfaces(evaluate(書き, MASU, prepared))) {
			expect(sourceSurfaces.has(surface)).toBe(true);
		}
	});

	it("offers both regular イ-adjective types in the same form family (COVERAGE1)", async () => {
		const prepared = await prepare([赤かっ, TA], [美しかっ, TA]);
		expect(surfaces(evaluate(青かっ, TA, prepared)).sort()).toEqual(["美しかっ", "赤かっ"]);
	});

	it("never offers 名詞 / 形容動詞語幹 to an イ-adjective slot", async () => {
		const 青い = adjective("青い", "形容詞・アウオ段", "基本形", "青い");
		const prepared = await prepare([静か, NA]);
		expect(evaluate(青い, PERIOD, prepared)).toMatchObject({ reason: "no-candidate" });
		expect(evaluate(静か, NA, prepared)).toMatchObject({
			reason: "unsupported-part-of-speech",
		});
	});

	it("rejects a Source record whose pos or detail1 alone differs, or whose required field is '*'", async () => {
		const prepared = await prepare(
			[{ ...描い, detail1: "非自立" }, TE],
			[{ ...歩い, conjugationType: "*" }, TE],
		);
		expect(evaluate(書い, TE, prepared)).toMatchObject({ reason: "no-candidate" });
	});

	it("returns canonical, deduplicated, frozen results", async () => {
		const 着連用 = verb("着", "一段", "連用形", "着る");
		const runs = [[着未然, NAI], [見未然, NAI, PERIOD], [着連用, MASU]];
		const forward = evaluate(食べ未然, NAI, await prepare(...runs));
		const reversed = evaluate(食べ未然, NAI, await prepare(...[...runs].reverse()));
		// Run order changes the Source text, hence its content hash in origins;
		// the offered records and their order do not change.
		const withoutOrigins = (result: typeof forward) =>
			result.candidates.map(({ origins: _origins, ...rest }) => rest);
		expect(withoutOrigins(forward)).toEqual(withoutOrigins(reversed));
		expect(forward.available && reversed.available && forward.connectionKey === reversed.connectionKey).toBe(true);
		expect(surfaces(forward).sort()).toEqual(["着", "見"]);
		expect(forward.candidates.map((c) => c.displayFormId)).toEqual(
			[...forward.candidates.map((c) => c.displayFormId)].sort(),
		);
		expect(Object.isFrozen(forward)).toBe(true);
		expect(Object.isFrozen(forward.candidates[0]?.origins)).toBe(true);
	});
});

describe("manual morphology evidence provenance (review P1)", () => {
	const INVALID = { available: false, reason: "invalid-evidence", candidates: [] };

	it("exposes no way to supply runs, tokens or observations", () => {
		expect(Object.keys(manualMorphology).sort()).toEqual([
			"MANUAL_MORPH_ADJECTIVE_CONJUGATION_TYPES",
			"MANUAL_MORPH_ALLOWLIST",
			"MANUAL_MORPH_EVIDENCE_ERROR_MESSAGE",
			"MANUAL_MORPH_POLICY_VERSION",
			"MANUAL_MORPH_SOURCE_ANALYSIS_ERROR_MESSAGE",
			"MANUAL_MORPH_VERB_CONJUGATION_TYPES",
			"ManualMorphEvidenceError",
			"analyzeManualMorphSource",
			"buildManualMorphVocabulary", "deriveManualMorphTarget",
			"evaluateManualMorphSlot",
			"isManualMorphVocabulary",
			"manualMorphConnection",
			// ADVERB-MANUAL1 reads only registered runs from a genuine owner; this does not accept caller runs.
			"readManualMorphCandidateBuckets",
			// 0.1.0 S5: Recompose reads each registered Source's analyzed document; nothing enters through it.
			"readManualMorphSourceDocuments",
			"readManualMorphVocabularySources",
		]);
	});

	it("binds the Source identity to the text and builds the same Snapshot as the production path", async () => {
		const runs = [[描い, TE], [読ん, DE]];
		const text = [...table(runs).keys()].join("\n\n");
		const prepared = await prepare(...runs);
		const contentHash = sha256Hex(text);
		expect(contentHash).toBe(await hashSourceText(text));
		expect(prepared.analyses[0]).toEqual({
			path: "source.md",
			contentHash,
			projectionPolicy: prepared.snapshot.sources[0]!.projectionPolicy,
		});
		expect(Object.isFrozen(prepared.analyses[0])).toBe(true);

		const production = await analyzeSelectedSource({
			text,
			sourcePath: "source.md",
			contentHash,
			tokenizer: tokenizerFor(table(runs)),
		});
		if (production.status !== "ready") throw new Error(production.status);
		const expected = buildVocabularySnapshot({
			sources: [{
				source: { path: "source.md", contentHash, projectionPolicy: production.projection.policyVersion },
				vocabulary: production.vocabulary,
			}],
			drawMode: "uniform",
		});
		expect(prepared.snapshot).toEqual(expected);
		expect(prepared.snapshot.fingerprint).toBe(expected.fingerprint);
	});

	it("cannot be fooled by reconstructing the review's runs: 描かない + せ is never 描かせ + ない", async () => {
		// The genuine Source: 描か before ない, and a separate run せ.
		const 描かない = [描か, NAI];
		const せ = [SE];
		const genuine = await prepare(描かない, せ);
		expect(evaluate(書か, SE, genuine)).toEqual({ available: false, reason: "no-candidate", candidates: [] });
		expect(surfaces(evaluate(書か, NAI, genuine))).toEqual(["描か"]);

		// The reviewer's reconstruction has the same tokens, counts and surface
		// coverage. Built elsewhere, it yields a Snapshot equal to the genuine one...
		const reconstructedRuns = [
			{ text: "描かせ", tokens: [描か, SE] },
			{ text: "ない", tokens: [NAI] },
		].map((run, runIndex) => {
			let cursor = 0;
			return {
				run: { runId: `run-${runIndex}`, originalText: run.text, analysisText: run.text, sourceParts: [], annotations: [], mapping: [] },
				tokens: run.tokens.map((token, index) => {
					const range = { start: cursor, end: cursor + token.surface.length };
					cursor = range.end;
					return { tokenId: `run-${runIndex}:token:${index}`, range, token: { ...token } };
				}),
			};
		});
		const forgedVocabulary = buildRubyVocabulary(
			{ document: { segments: [], runs: reconstructedRuns.map((r) => r.run), protectedRuns: [] }, runs: reconstructedRuns },
			{ path: "source.md", contentHash: genuine.analyses[0]!.contentHash },
		);
		const forgedSnapshot = buildVocabularySnapshot({
			sources: [{ source: genuine.snapshot.sources[0]!, vocabulary: forgedVocabulary }],
			drawMode: "uniform",
		});
		expect(forgedSnapshot.fingerprint).toBe(genuine.snapshot.fingerprint);
		// ...but there is no API that accepts those runs, and the genuine evidence
		// is not valid with that Snapshot.
		expect(evaluate(書か, SE, { snapshot: forgedSnapshot, evidence: genuine.evidence })).toEqual(INVALID);

		// Pretending the reconstructed runs are a registered analysis fails before
		// anything is minted.
		for (const handle of [
			{ ...genuine.analyses[0]! },
			JSON.parse(JSON.stringify(genuine.analyses[0])) as ManualMorphSourceAnalysis,
			{ path: "source.md", contentHash: genuine.analyses[0]!.contentHash, projectionPolicy: genuine.analyses[0]!.projectionPolicy, runs: reconstructedRuns },
		]) {
			expect(
				evidenceError(() => buildManualMorphVocabulary({ sources: [handle], drawMode: "uniform" })),
			).toBe("invalid-analysis");
		}

		// A tokenizer that returns the reconstruction for the genuine text cannot
		// tile the projected runs, so no analysis is registered.
		const reorderedTokenizer: JapaneseTokenizer = {
			tokenize: (text) => Promise.resolve(text === "描かない" ? [{ ...描か }, { ...SE }] : [{ ...NAI }]),
		};
		expect(
			await analyzeManualMorphSource({ text: "描かない\n\nせ", sourcePath: "source.md", tokenizer: reorderedTokenizer }),
		).toEqual({ status: "error", message: MANUAL_MORPH_SOURCE_ANALYSIS_ERROR_MESSAGE });
	});

	it("only adjacency the Source text produces is observed", async () => {
		// The same tokens as one run 描かせ + ない would have to come from that text.
		const other = await prepare([描か, SE], [NAI]);
		expect(surfaces(evaluate(書か, SE, other))).toEqual(["描か"]);
		const genuine = await prepare([描か, NAI], [SE]);
		expect(evaluate(書か, SE, { snapshot: genuine.snapshot, evidence: other.evidence })).toEqual(INVALID);
		expect(evaluate(書か, SE, { snapshot: other.snapshot, evidence: genuine.evidence })).toEqual(INVALID);
	});

	it("rejects hand-built, spread and JSON-cloned evidence with no partial candidates", async () => {
		const prepared = await prepare([描い, TE]);
		expect(evaluate(書い, TE, prepared).available).toBe(true);
		const forgeries: unknown[] = [
			{ policyVersion: "manual-morph-2", vocabularyFingerprint: prepared.snapshot.fingerprint },
			{ ...prepared.evidence },
			JSON.parse(JSON.stringify(prepared.evidence)),
			Object.freeze({ ...prepared.evidence }),
			Object.create(prepared.evidence),
			null,
			undefined,
			"manual-morph-2",
		];
		for (const evidence of forgeries) {
			expect(evaluate(書い, TE, { snapshot: prepared.snapshot, evidence: evidence as ManualMorphEvidence })).toEqual(INVALID);
		}
	});

	it("rejects evidence with another Snapshot, even one with identical content or swapped vocabulary", async () => {
		const first = await prepare([描い, TE]);
		const twin = await prepare([描い, TE]);
		const other = await prepare([歩い, TE]);
		expect(twin.snapshot).toEqual(first.snapshot);
		const swapped = {
			...first.snapshot,
			candidates: other.snapshot.candidates,
			projections: { ...first.snapshot.projections, manual: other.snapshot.projections.manual },
		} as VocabularySnapshot;
		for (const snapshot of [twin.snapshot, other.snapshot, swapped]) {
			expect(evaluate(書い, TE, { snapshot, evidence: first.evidence })).toEqual(INVALID);
		}
		expect(surfaces(evaluate(書い, TE, other))).toEqual(["歩い"]);
	});

	it("refuses unregistered analyses and fails without registering anything", async () => {
		const good = await analyze("a.md", [[描い, TE]]);
		expect(evidenceError(() => buildManualMorphVocabulary({ sources: [good, { ...good }], drawMode: "uniform" }))).toBe("invalid-analysis");
		expect(evidenceError(() => buildManualMorphVocabulary({ sources: null as never, drawMode: "uniform" }))).toBe("invalid-analysis");
		expect(evidenceError(() => buildManualMorphVocabulary({ sources: [], drawMode: "uniform" }))).toBe("invalid-vocabulary");
		expect(evidenceError(() => buildManualMorphVocabulary({ sources: [good], drawMode: "rare" as never }))).toBe("invalid-vocabulary");
	});

	it("builds multi-Source Snapshots only from registered analyses", async () => {
		const a = await analyze("a.md", [[描い, TE]]);
		const b = await analyze("b.md", [[歩い, TE]]);
		const { snapshot, evidence } = buildManualMorphVocabulary({ sources: [b, a], drawMode: "frequency" });
		expect(snapshot.sources.map((source) => source.path)).toEqual(["a.md", "b.md"]);
		expect(
			surfaces(evaluateManualMorphSlot({ target: 書い, next: TE, currentSurface: "書い", snapshot, evidence })).sort(),
		).toEqual(["描い", "歩い"]);
	});

	it("passes stale and failed analyses through without registering them", async () => {
		const lookup = table([[描い, TE]]);
		expect(
			await analyzeManualMorphSource({ text: "描いて", sourcePath: "s.md", tokenizer: tokenizerFor(lookup), isCurrent: () => false }),
		).toEqual({ status: "stale" });
		const throwing: JapaneseTokenizer = { tokenize: () => Promise.reject(new Error("secret text")) };
		expect(
			await analyzeManualMorphSource({ text: "描いて", sourcePath: "s.md", tokenizer: throwing }),
		).toEqual({ status: "error", message: MANUAL_MORPH_SOURCE_ANALYSIS_ERROR_MESSAGE });
	});
});

describe("manual morphology core never changes its inputs (review P2)", () => {
	it("keeps its own copy: later changes to tokenizer output do not reach the evidence", async () => {
		const tokens = [{ ...描い }, { ...TE }];
		const tokenizer: JapaneseTokenizer = { tokenize: () => Promise.resolve(tokens) };
		const result = await analyzeManualMorphSource({ text: "描いて", sourcePath: "s.md", tokenizer });
		if (result.status !== "ready") throw new Error(result.status);
		const { snapshot, evidence } = buildManualMorphVocabulary({ sources: [result.analysis], drawMode: "uniform" });
		// Tokenizer-owned values remain mutable; later relabeling cannot affect evidence.
		expect(Object.isFrozen(tokens)).toBe(false);
		expect(tokens.every(token => !Object.isFrozen(token))).toBe(true);
		tokens[1]!.surface = "で";
		expect(surfaces(evaluateManualMorphSlot({ target: 書い, next: TE, currentSurface: "書い", snapshot, evidence }))).toEqual(["描い"]);
	});

	it("does not freeze or change the sources array", async () => {
		const sources = [await analyze("a.md", [[描い, TE]])];
		buildManualMorphVocabulary({ sources, drawMode: "uniform" });
		expect(Object.isFrozen(sources)).toBe(false);
		expect(sources).toHaveLength(1);
	});

	it("never freezes or changes Target tokens, on success and on every rejection", async () => {
		const prepared = await prepare([描い, TE], [書い, TE]);
		const cases: [JapaneseToken, JapaneseToken | null, string][] = [
			[書い, TE, "書い"],
			[書い, TE, "描い"],
			[{ ...書い, isUnknown: true }, TE, "書い"],
			[静か, NA, "静か"],
			[{ ...書い, conjugationForm: "*" }, TE, "書い"],
			[書い, null, "書い"],
			[泳い, DE, "泳い"],
		];
		for (const [target, next, currentSurface] of cases) {
			const mutableTarget = thaw(target);
			const mutableNext = next && thaw(next);
			const targetBefore = structuredClone(mutableTarget);
			const nextBefore = structuredClone(mutableNext);
			for (const evidence of [prepared.evidence, { ...prepared.evidence }]) {
				evaluateManualMorphSlot({
					target: mutableTarget,
					next: mutableNext,
					currentSurface,
					snapshot: prepared.snapshot,
					evidence,
				});
			}
			expect(Object.isFrozen(mutableTarget)).toBe(false);
			expect(mutableNext === null || !Object.isFrozen(mutableNext)).toBe(true);
			expect(mutableTarget).toEqual(targetBefore);
			expect(mutableNext).toEqual(nextBefore);
		}
	});

	it("returns fresh copies, never the Snapshot's origin, variant or range objects", async () => {
		const 絵 = morph("絵", "名詞", "一般", "*", "*", "絵", "エ");
		const を = fn("を", "助詞", "格助詞");
		const analysis = await analyze("notes/source.md", [[絵, を, 描い, TE]], "絵を描《えが》いて");
		const { snapshot, evidence } = buildManualMorphVocabulary({ sources: [analysis], drawMode: "uniform" });
		const snapshotBefore = structuredClone(snapshot);

		const first = evaluateManualMorphSlot({ target: 書い, next: TE, currentSurface: "書い", snapshot, evidence });
		const second = evaluateManualMorphSlot({ target: 書い, next: TE, currentSurface: "書い", snapshot, evidence });
		const record = snapshot.projections.manual.candidates.find((c) => c.surface === "描い")!;
		const [offered] = first.candidates;

		expect(offered).toEqual({
			candidateId: record.candidateId,
			displayFormId: record.displayFormId,
			surface: "描い",
			frequency: 1,
			origins: record.origins,
			verifiedRubyVariants: record.verifiedRubyVariants,
		});
		expect(offered?.verifiedRubyVariants[0]).toMatchObject({
			reading: "えが",
			baseRangeInSurface: { start: 0, end: 1 },
		});
		expect(offered?.origins).not.toBe(record.origins);
		expect(offered?.origins[0]).not.toBe(record.origins[0]);
		expect(offered?.verifiedRubyVariants).not.toBe(record.verifiedRubyVariants);
		const variant = offered!.verifiedRubyVariants[0]!;
		const recordVariant = record.verifiedRubyVariants[0]!;
		expect(variant).not.toBe(recordVariant);
		expect(variant.baseRangeInSurface).not.toBe(recordVariant.baseRangeInSurface);
		expect(variant.sourceNotations).not.toBe(recordVariant.sourceNotations);
		expect(variant.origins).not.toBe(recordVariant.origins);
		expect(second.candidates[0]).not.toBe(offered);
		expect(second.candidates[0]?.origins).not.toBe(offered?.origins);
		expect(Object.isFrozen(first)).toBe(true);
		expect(snapshot).toEqual(snapshotBefore);
		expect(snapshot.projections.automaticBody.buckets.map((bucket) => bucket.key)).toEqual([
			"名詞\u001f一般",
		]);
	});
});
