import { describe, expect, it } from "vitest";
import { SOURCE_PROJECTION_POLICY_VERSION } from "../src/analysis/projectMarkdownSource";
import {
	vocabularyCandidateId,
	vocabularyDisplayFormId,
	type RubyVocabulary,
	type VocabularyCandidate,
	type VocabularyOrigin,
} from "../src/analysis/rubyVocabulary";
import {
	COLLISION_LEXEME_MODIFIER_CLASSES,
	COLLISION_LEXEME_POOL_POLICY_VERSION,
	buildCollisionLexemePool,
	inspectCollisionLexemePoolStructure,
	type CollisionLexemePatternData,
	type CollisionLexemePool,
	type CollisionModifierCandidate,
	type CollisionNounCandidate,
} from "../src/collision/collisionLexemePool";
import { inspectCollisionLexemePool } from "../src/collision/collisionVocabulary";
import { compileCollisionPatternSet } from "../src/collision/compilePatternSet";
import {
	STANDARD_COLLISION_CONNECTORS,
	STANDARD_COLLISION_LITERALS,
	STANDARD_COLLISION_MODIFIER_FORMS,
	STANDARD_COLLISION_NOUN_SUFFIXES,
	STANDARD_COLLISION_PATTERN_DATA_VERSION,
	STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
	STANDARD_COLLISION_RECIPES,
} from "../src/collision/generated/standardCollisionPatternEntries";
import { COLLISION_PATTERN_SCHEMA_VERSION } from "../src/collision/patternData";
import {
	COLLISION_IRREGULAR_VERB_LEXEMES,
	COLLISION_REGULAR_ADJECTIVE_CONJUGATION_TYPES,
	COLLISION_REGULAR_VERB_CONJUGATION_TYPES,
	inflectRegularVerb,
	isCollisionIrregularLexeme,
	regularAdjectiveBasicForm,
} from "../src/collision/regularInflection";
import { COLLECTION_DOCUMENT_VERSION } from "../src/collect/collectionDocument";
import { COLLECT_METADATA_VERSION } from "../src/collect/collectProvenance";
import { FAKE_DICTIONARY_ALGORITHM_VERSION } from "../src/dictionary/generateFakeDefinition";
import { STANDARD_TEMPLATE_SET_VERSION } from "../src/dictionary/standardTemplateSet";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import { SEMANTROPY_SETTINGS_SCHEMA_VERSION } from "../src/settings/semantropySettings";
import {
	MANUAL_MORPH_ADJECTIVE_CONJUGATION_TYPES,
	MANUAL_MORPH_POLICY_VERSION,
	MANUAL_MORPH_VERB_CONJUGATION_TYPES,
	analyzeManualMorphSource,
	buildManualMorphVocabulary,
} from "../src/transform/manualMorphology";
import { buildVocabularyPool } from "../src/transform/transformTokens";
import type {
	JapaneseToken,
	JapaneseTokenizer,
} from "../src/tokenizer/JapaneseTokenizer";
import {
	COLLISION_PROJECTION_POLICY_VERSION,
	MANUAL_PROJECTION_POLICY_VERSION,
	VOCABULARY_FINGERPRINT_VERSION,
	VOCABULARY_SNAPSHOT_POLICY_VERSION,
	buildVocabularySnapshot,
	type AnalyzedVocabularySource,
	type VocabularySnapshot,
} from "../src/vocabulary/vocabularySnapshot";

/**
 * `PRE-RELEASE-COLLISION-LEXEME1` focused regressions.
 *
 * Every field below is a tokenizer field, not something derived from a
 * surface: the point of the slice is that the Collision pool reuses what the
 * Snapshot already recorded and adds one closed inflection table on top.
 */

const compiled = compileCollisionPatternSet({
	schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
	dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION,
	recipes: STANDARD_COLLISION_RECIPES,
	literals: STANDARD_COLLISION_LITERALS,
	connectors: STANDARD_COLLISION_CONNECTORS,
	modifierForms: STANDARD_COLLISION_MODIFIER_FORMS,
	nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES,
});
if (!compiled.ok) {
	throw new Error("the standard Collision pattern set must compile");
}
const PATTERN: CollisionLexemePatternData = compiled.set;

function tok(
	surface: string,
	overrides: Partial<JapaneseToken> = {},
): JapaneseToken {
	return {
		surface,
		pos: "名詞",
		detail1: "一般",
		detail2: "*",
		detail3: "*",
		conjugationType: "*",
		conjugationForm: "*",
		baseForm: surface,
		isUnknown: false,
		...overrides,
	};
}

const noun = (surface: string) => tok(surface);
const proper = (surface: string) =>
	tok(surface, { detail1: "固有名詞", detail2: "地域" });
const sahenNoun = (surface: string) => tok(surface, { detail1: "サ変接続" });
const naStem = (surface: string) => tok(surface, { detail1: "形容動詞語幹" });
const verb = (
	surface: string,
	conjugationType: string,
	baseForm = surface,
	conjugationForm = "基本形",
) =>
	tok(surface, {
		pos: "動詞",
		detail1: "自立",
		conjugationType,
		conjugationForm,
		baseForm,
	});
const adjective = (
	surface: string,
	conjugationType: string,
	baseForm = surface,
	conjugationForm = "基本形",
) =>
	tok(surface, {
		pos: "形容詞",
		detail1: "自立",
		conjugationType,
		conjugationForm,
		baseForm,
	});

/** One already-analyzed Source, in the shape the Snapshot core accepts. */
function analyzedSource(
	path: string,
	hash: string,
	tokens: readonly JapaneseToken[],
): AnalyzedVocabularySource {
	const records = new Map<string, VocabularyCandidate>();
	for (const item of tokens) {
		const candidateId = vocabularyCandidateId(item);
		const displayFormId = vocabularyDisplayFormId(candidateId, item.surface);
		const frequency = (records.get(displayFormId)?.frequency ?? 0) + 1;
		records.set(displayFormId, {
			candidateId,
			displayFormId,
			surface: item.surface,
			token: { ...item },
			frequency,
			origins: [{ path, contentHash: hash, count: frequency }],
			verifiedRubyVariants: [],
		});
	}
	const vocabulary: RubyVocabulary = {
		candidates: [...records.values()].sort((a, b) =>
			a.displayFormId < b.displayFormId ? -1 : 1,
		),
		fingerprint: "fixture-input-fingerprint",
		automaticBody: buildVocabularyPool([[...tokens]]),
	};
	return {
		source: {
			path,
			contentHash: hash,
			projectionPolicy: SOURCE_PROJECTION_POLICY_VERSION,
		},
		vocabulary,
	};
}

function snapshotOf(
	sources: readonly AnalyzedVocabularySource[],
	drawMode: "uniform" | "frequency" = "uniform",
): VocabularySnapshot {
	return buildVocabularySnapshot({ sources, drawMode });
}

function poolFrom(snapshot: VocabularySnapshot): CollisionLexemePool {
	const result = buildCollisionLexemePool({ snapshot, patternData: PATTERN });
	if (!result.ok) {
		throw new Error(`the pool was rejected: ${result.reason}`);
	}
	return result.pool;
}

function poolOf(tokens: readonly JapaneseToken[]): CollisionLexemePool {
	return poolFrom(snapshotOf([analyzedSource("a.md", "hash-a", tokens)]));
}

const surfaces = (
	entries: readonly { readonly surface: string }[],
): readonly string[] => entries.map((entry) => entry.surface);

function modifier(
	pool: CollisionLexemePool,
	surface: string,
): CollisionModifierCandidate {
	const found = pool.modifiers.find((entry) => entry.surface === surface);
	if (!found) {
		throw new Error(`no Modifier for ${surface}`);
	}
	return found;
}

/** One representative base form per allowed regular verb class. */
const VERB_CASES: readonly (readonly [string, string, readonly string[]])[] = [
	["一段", "壊れる", ["壊れる", "壊れた", "壊れている", "壊れない"]],
	["五段・カ行イ音便", "書く", ["書く", "書いた", "書いている", "書かない"]],
	["五段・ガ行", "泳ぐ", ["泳ぐ", "泳いだ", "泳いでいる", "泳がない"]],
	["五段・サ行", "話す", ["話す", "話した", "話している", "話さない"]],
	["五段・タ行", "打つ", ["打つ", "打った", "打っている", "打たない"]],
	["五段・ナ行", "死ぬ", ["死ぬ", "死んだ", "死んでいる", "死なない"]],
	["五段・バ行", "飛ぶ", ["飛ぶ", "飛んだ", "飛んでいる", "飛ばない"]],
	["五段・マ行", "読む", ["読む", "読んだ", "読んでいる", "読まない"]],
	["五段・ラ行", "眠る", ["眠る", "眠った", "眠っている", "眠らない"]],
	["五段・ワ行促音便", "買う", ["買う", "買った", "買っている", "買わない"]],
];

describe("the Collision Noun pool", () => {
	it("builds general, proper and sahen nouns from the Collision projection", () => {
		const pool = poolOf([noun("都市"), proper("東京"), sahenNoun("変化")]);
		expect(new Set(surfaces(pool.nouns))).toEqual(
			new Set(["都市", "東京", "変化"]),
		);
		// Identity and provenance come from the projection, not from a re-scan.
		const city = pool.nouns.find((entry) => entry.surface === "都市")!;
		expect(city.frequency).toBe(1);
		expect(city.candidates).toHaveLength(1);
		expect(city.candidates[0]!.candidateId).toBe(
			vocabularyCandidateId(noun("都市")),
		);
		expect(city.origins).toEqual([
			{ path: "a.md", contentHash: "hash-a", count: 1 },
		]);
	});

	it("also carries 名詞 / 形容動詞語幹, which the Collision projection already allows", () => {
		expect(surfaces(poolOf([naStem("静か")]).nouns)).toEqual(["静か"]);
	});

	it("promotes no pronoun, suffix, dependent, unknown or single symbol", () => {
		const pool = poolOf([
			tok("それ", { detail1: "代名詞" }),
			tok("的", { detail1: "接尾" }),
			tok("こと", { detail1: "非自立" }),
			tok("ほげ", { isUnknown: true }),
			tok("※"),
			tok("を", { pos: "助詞", detail1: "格助詞" }),
		]);
		expect(pool.nouns).toEqual([]);
		expect(pool.modifiers).toEqual([]);
		expect(pool.predicates).toEqual([]);
	});

	it("merges one surface that two records share into a single canonical entry", () => {
		const pool = poolOf([noun("愛"), proper("愛")]);
		expect(surfaces(pool.nouns)).toEqual(["愛"]);
		const merged = pool.nouns[0]!;
		expect(merged.frequency).toBe(2);
		expect(merged.candidates).toHaveLength(2);
	});
});

describe("the Collision Modifier pool", () => {
	it("takes the basic form of a regular independent イ-adjective", () => {
		const pool = poolOf([
			adjective("赤い", "形容詞・アウオ段"),
			adjective("美しい", "形容詞・イ段"),
		]);
		expect(new Set(surfaces(pool.modifiers))).toEqual(new Set(["赤い", "美しい"]));
		expect(modifier(pool, "赤い").variants[0]!.modifierClass).toBe("i-adjective");
		expect(modifier(pool, "赤い").variants[0]!.formId).toBe("i-adjective-basic");
	});

	it("reaches the basic form from a nonbasic observed adjective record", () => {
		const pool = poolOf([
			adjective("赤かっ", "形容詞・アウオ段", "赤い", "連用タ接続"),
		]);
		expect(surfaces(pool.modifiers)).toEqual(["赤い"]);
		expect(modifier(pool, "赤い").variants[0]!.base.surface).toBe("赤かっ");
	});

	it("refuses an adjective class outside the manual-morph-2 allowlist", () => {
		expect(
			regularAdjectiveBasicForm({
				conjugationType: "形容詞・イイ",
				baseForm: "いい",
			}),
		).toBeNull();
		expect(poolOf([adjective("いい", "形容詞・イイ")]).modifiers).toEqual([]);
	});

	it("adds な to 名詞 / 形容動詞語幹 and to nothing else", () => {
		const pool = poolOf([naStem("静か"), noun("都市")]);
		const na = modifier(pool, "静かな").variants.filter(
			(variant) => variant.modifierClass === "na-adjective",
		);
		expect(na).toHaveLength(1);
		expect(na[0]!.formId).toBe("na-adjective-na");
		expect(
			pool.modifiers.some((entry) => entry.surface === "都市な"),
		).toBe(false);
	});

	it("builds する / した / している / しない from a sahen noun", () => {
		const pool = poolOf([sahenNoun("変化")]);
		for (const [variant, surface] of [
			["basic", "変化する"],
			["past", "変化した"],
			["progressive", "変化している"],
			["negative", "変化しない"],
		] as const) {
			const record = modifier(pool, surface).variants.find(
				(entry) => entry.modifierClass === "sahen",
			)!;
			expect(record.formVariant).toBe(variant);
			expect(record.formId).toBe(`sahen-${variant}`);
		}
	});

	it("never generates a sahen passive", () => {
		const pool = poolOf([sahenNoun("変化")]);
		expect(surfaces(pool.modifiers)).not.toContain("変化される");
		expect(surfaces(pool.modifiers)).not.toContain("変化された");
		// 化された is a noun-suffix literal applied to the Noun surface, which is
		// a different construction from a sahen variant.
		const suffixed = modifier(pool, "変化化された");
		expect(suffixed.classes).toEqual(["noun-suffix"]);
		expect(
			pool.modifiers.every((entry) =>
				entry.variants.every(
					(variant) =>
						variant.modifierClass !== "sahen" ||
						["basic", "past", "progressive", "negative"].includes(
							variant.formVariant,
						),
				),
			),
		).toBe(true);
	});

	it("builds every standard noun suffix from the Markdown-authored literals", () => {
		const pool = poolOf([noun("都市")]);
		expect(STANDARD_COLLISION_NOUN_SUFFIXES.map((entry) => entry.literal)).toEqual([
			"の",
			"的な",
			"のような",
			"っぽい",
			"化した",
			"化された",
		]);
		for (const suffix of STANDARD_COLLISION_NOUN_SUFFIXES) {
			const entry = modifier(pool, `都市${suffix.literal}`);
			expect(entry.variants).toHaveLength(1);
			expect(entry.variants[0]!.modifierClass).toBe("noun-suffix");
			expect(entry.variants[0]!.formId).toBe(suffix.id);
			expect(entry.variants[0]!.formVariant).toBe("suffix");
		}
		expect(pool.modifiers).toHaveLength(
			STANDARD_COLLISION_NOUN_SUFFIXES.length,
		);
	});

	it("names only the five lexeme-level classes", () => {
		expect([...COLLISION_LEXEME_MODIFIER_CLASSES]).toEqual([
			"i-adjective",
			"na-adjective",
			"verb",
			"sahen",
			"noun-suffix",
		]);
	});
});

describe("the closed regular inflection table", () => {
	it("uses exactly the manual-morph-2 regular allowlists", () => {
		expect(COLLISION_REGULAR_VERB_CONJUGATION_TYPES).toEqual([
			...MANUAL_MORPH_VERB_CONJUGATION_TYPES,
		]);
		expect(COLLISION_REGULAR_ADJECTIVE_CONJUGATION_TYPES).toEqual([
			...MANUAL_MORPH_ADJECTIVE_CONJUGATION_TYPES,
		]);
	});

	for (const [conjugationType, baseForm, expected] of VERB_CASES) {
		it(`inflects ${conjugationType}`, () => {
			const forms = inflectRegularVerb({ conjugationType, baseForm });
			expect(forms).not.toBeNull();
			expect([
				forms!.basic,
				forms!.past,
				forms!.progressive,
				forms!.negative,
			]).toEqual([...expected]);
		});
	}

	it("covers every allowed class exactly once in those cases", () => {
		expect(VERB_CASES.map(([conjugationType]) => conjugationType)).toEqual([
			...COLLISION_REGULAR_VERB_CONJUGATION_TYPES,
		]);
	});

	it("produces the Policy 3 fixtures through the pool itself", () => {
		const pool = poolOf([verb("眠る", "五段・ラ行"), verb("壊れる", "一段")]);
		expect(new Set(surfaces(pool.modifiers))).toEqual(
			new Set([
				"眠る",
				"眠った",
				"眠っている",
				"眠らない",
				"壊れる",
				"壊れた",
				"壊れている",
				"壊れない",
			]),
		);
	});

	it("refuses a base form whose ending contradicts its conjugation type", () => {
		expect(
			inflectRegularVerb({ conjugationType: "五段・ラ行", baseForm: "書く" }),
		).toBeNull();
		expect(
			inflectRegularVerb({ conjugationType: "五段・マ行", baseForm: "眠る" }),
		).toBeNull();
		expect(
			inflectRegularVerb({ conjugationType: "一段", baseForm: "書く" }),
		).toBeNull();
		// Nothing is left in front of the ending, so there is no stem.
		expect(
			inflectRegularVerb({ conjugationType: "五段・ラ行", baseForm: "る" }),
		).toBeNull();
		const pool = poolOf([verb("書く", "五段・ラ行")]);
		expect(pool.modifiers).toEqual([]);
		expect(pool.predicates).toEqual([]);
	});

	it("fails closed on an unsupported conjugation type instead of guessing", () => {
		for (const conjugationType of [
			"サ変・スル",
			"カ変・クル",
			"五段・カ行促音便",
			"五段・ラ行特殊",
			"文語・ベシ",
			"*",
			"",
		]) {
			expect(
				inflectRegularVerb({ conjugationType, baseForm: "行く" }),
			).toBeNull();
		}
		const pool = poolOf([
			verb("する", "サ変・スル"),
			verb("来る", "カ変・クル"),
			verb("行く", "五段・カ行促音便"),
		]);
		expect(pool.modifiers).toEqual([]);
		expect(pool.predicates).toEqual([]);
	});

	it("excludes a lexeme whose regular class does not predict its real forms (review P1)", () => {
		// ある is recorded 五段・ラ行, so the paradigm would yield あらない, which
		// is not the Japanese negative. Not offering the lexeme and emitting a
		// broken form are different outcomes; only the first is in scope.
		for (const baseForm of ["ある", "有る", "在る"]) {
			expect(
				inflectRegularVerb({ conjugationType: "五段・ラ行", baseForm }),
			).toBeNull();
			expect(isCollisionIrregularLexeme("五段・ラ行", baseForm)).toBe(true);
		}

		// The whole candidate is dropped: no Modifier variant and no Predicate.
		const pool = poolOf([
			verb("ある", "五段・ラ行"),
			verb("あっ", "五段・ラ行", "ある", "連用タ接続"),
			verb("あら", "五段・ラ行", "ある", "未然形"),
			verb("眠る", "五段・ラ行"),
		]);
		expect(surfaces(pool.modifiers)).toEqual([
			"眠っている",
			"眠った",
			"眠らない",
			"眠る",
		].sort());
		expect(surfaces(pool.predicates)).toEqual(["眠る"]);
		for (const forbidden of ["あらない", "あっている", "あった", "ある"]) {
			expect(surfaces(pool.modifiers)).not.toContain(forbidden);
			expect(surfaces(pool.predicates)).not.toContain(forbidden);
		}
	});

	it("matches the exclusion on the recorded base form, not on a surface or ending", () => {
		// 眠る ends in る and is 五段・ラ行 like ある, and is not excluded.
		expect(isCollisionIrregularLexeme("五段・ラ行", "眠る")).toBe(false);
		// The same spelling under a class the set does not name is not excluded
		// here; it is refused by the allowlist instead.
		expect(isCollisionIrregularLexeme("一段", "ある")).toBe(false);
		expect(isCollisionIrregularLexeme("サ変・スル", "ある")).toBe(false);
		expect(COLLISION_IRREGULAR_VERB_LEXEMES).toEqual([
			{ conjugationType: "五段・ラ行", baseForms: ["ある", "在る", "有る"] },
		]);
		// Every excluded class is one the allowlist actually admits, or the entry
		// would be dead weight hiding a real gap.
		for (const entry of COLLISION_IRREGULAR_VERB_LEXEMES) {
			expect(COLLISION_REGULAR_VERB_CONJUGATION_TYPES).toContain(
				entry.conjugationType,
			);
		}
	});

	it("refuses an unset or unsafe base form", () => {
		const withControl = `眠${String.fromCharCode(0)}る`;
		for (const baseForm of ["", "*", " 眠る", "眠る ", withControl]) {
			expect(
				inflectRegularVerb({ conjugationType: "五段・ラ行", baseForm }),
			).toBeNull();
		}
	});
});

describe("the Collision Predicate pool", () => {
	it("holds regular independent verb basic forms only", () => {
		const pool = poolOf([
			verb("眠る", "五段・ラ行"),
			verb("壊れる", "一段"),
			verb("する", "サ変・スル"),
			verb("来る", "カ変・クル"),
			adjective("赤い", "形容詞・アウオ段"),
			sahenNoun("変化"),
			noun("都市"),
		]);
		expect(surfaces(pool.predicates)).toEqual(["壊れる", "眠る"]);
		for (const predicate of pool.predicates) {
			expect(predicate.variants.map((entry) => entry.predicateClass)).toEqual([
				"regular-verb",
			]);
			expect(predicate.variants.map((entry) => entry.formVariant)).toEqual([
				"basic",
			]);
		}
	});

	it("reaches a basic Predicate from a nonbasic observed verb record", () => {
		const pool = poolOf([verb("眠っ", "五段・ラ行", "眠る", "連用タ接続")]);
		expect(surfaces(pool.predicates)).toEqual(["眠る"]);
		expect(pool.predicates[0]!.variants[0]!.base.surface).toBe("眠っ");
	});
});

describe("the Collision candidate profiles", () => {
	const pool = poolOf([
		sahenNoun("変化"),
		verb("眠る", "五段・ラ行"),
		adjective("赤い", "形容詞・アウオ段"),
		naStem("静か"),
	]);

	it("exposes all Modifiers under `all`", () => {
		expect(pool.modifiersByProfile.all).toEqual(pool.modifiers);
		expect(pool.modifiers.every((entry) => entry.profiles.includes("all"))).toBe(
			true,
		);
	});

	it("exposes only the sahen basic variant under `sahen-basic`", () => {
		expect(surfaces(pool.modifiersByProfile["sahen-basic"])).toEqual(["変化する"]);
		for (const candidate of pool.modifiersByProfile["sahen-basic"]) {
			expect(
				candidate.variants.some(
					(variant) =>
						variant.modifierClass === "sahen" && variant.formVariant === "basic",
				),
			).toBe(true);
		}
		expect(surfaces(pool.modifiersByProfile["sahen-basic"])).not.toContain(
			"変化した",
		);
		expect(surfaces(pool.modifiersByProfile["sahen-basic"])).not.toContain("眠る");
	});

	it("exposes every Predicate under `regular-verb-basic`", () => {
		expect(pool.predicatesByProfile["regular-verb-basic"]).toEqual(
			pool.predicates,
		);
	});
});

describe("canonical surface dedupe", () => {
	it("merges two observed forms of one lemma without double counting it", () => {
		const pool = poolOf([
			verb("眠る", "五段・ラ行"),
			verb("眠る", "五段・ラ行"),
			verb("眠っ", "五段・ラ行", "眠る", "連用タ接続"),
			verb("眠っ", "五段・ラ行", "眠る", "連用タ接続"),
			verb("眠っ", "五段・ラ行", "眠る", "連用タ接続"),
		]);
		expect(surfaces(pool.modifiers).filter((entry) => entry === "眠る")).toEqual([
			"眠る",
		]);
		const basic = modifier(pool, "眠る");
		// Two Snapshot records reached the same finished surface: both stay
		// visible, and each contributes its frequency once.
		expect(basic.variants).toHaveLength(2);
		expect(new Set(basic.variants.map((entry) => entry.base.surface))).toEqual(
			new Set(["眠る", "眠っ"]),
		);
		expect(basic.frequency).toBe(5);
		expect(basic.candidates).toHaveLength(2);
		expect(basic.origins).toEqual([
			{ path: "a.md", contentHash: "hash-a", count: 5 },
		]);
		expect(pool.predicates[0]!.frequency).toBe(5);
	});

	it("keeps candidate, origin and frequency provenance across Sources", () => {
		const snapshot = snapshotOf([
			analyzedSource("a.md", "hash-a", [noun("都市"), noun("都市")]),
			analyzedSource("b.md", "hash-b", [noun("都市"), proper("都市")]),
		]);
		const pool = poolFrom(snapshot);
		const city = pool.nouns.find((entry) => entry.surface === "都市")!;
		expect(city.frequency).toBe(4);
		expect(city.candidates).toHaveLength(2);
		expect(city.origins).toEqual([
			{ path: "a.md", contentHash: "hash-a", count: 2 },
			{ path: "b.md", contentHash: "hash-b", count: 2 },
		]);
		const suffixed = modifier(pool, "都市の");
		expect(suffixed.frequency).toBe(4);
		expect(suffixed.variants).toHaveLength(2);
		expect(suffixed.origins).toEqual(city.origins);
	});

	it("counts one record once even when two forms of it meet on a surface", () => {
		// A pattern set may legitimately author a `な` noun suffix. The same
		// 形容動詞語幹 record then reaches 静かな twice: once as the na-adjective
		// form, once as a noun-derived Modifier. Both stay visible, and the
		// record's frequency and origins are still counted once.
		const patternData: CollisionLexemePatternData = {
			...PATTERN,
			nounSuffixes: Object.freeze([
				...PATTERN.nounSuffixes,
				Object.freeze({ id: "noun-na", weight: 1, literal: "な" }),
			]),
		};
		const snapshot = snapshotOf([
			analyzedSource("a.md", "hash-a", [naStem("静か"), naStem("静か")]),
		]);
		const result = buildCollisionLexemePool({ snapshot, patternData });
		if (!result.ok) {
			throw new Error(result.reason);
		}
		const na = modifier(result.pool, "静かな");
		expect(na.variants.map((entry) => entry.formId).sort()).toEqual([
			"na-adjective-na",
			"noun-na",
		]);
		expect(na.candidates).toHaveLength(1);
		expect(na.frequency).toBe(2);
		expect(na.origins).toEqual([
			{ path: "a.md", contentHash: "hash-a", count: 2 },
		]);
	});

	it("keeps class and variant provenance when two constructions meet", () => {
		// 変 is a 形容動詞語幹 Noun, so the noun suffix 化した reaches the same
		// finished surface as the sahen past of 変化.
		const pool = poolOf([naStem("変"), sahenNoun("変化")]);
		const shared = modifier(pool, "変化した");
		expect(shared.classes).toEqual(["sahen", "noun-suffix"]);
		expect(
			shared.variants.map((entry) => entry.formId).sort(),
		).toEqual(["noun-ka-shita", "sahen-past"].sort());
		expect(shared.candidates).toHaveLength(2);
		expect(shared.frequency).toBe(2);
	});
});

describe("pool ownership and determinism", () => {
	const tokens = [
		noun("都市"),
		proper("東京"),
		sahenNoun("変化"),
		naStem("静か"),
		verb("眠る", "五段・ラ行"),
		adjective("赤い", "形容詞・アウオ段"),
	];

	it("orders every list canonically and independently of input order", () => {
		const a = snapshotOf([
			analyzedSource("a.md", "hash-a", tokens),
			analyzedSource("b.md", "hash-b", [noun("庭"), verb("読む", "五段・マ行")]),
		]);
		const b = snapshotOf([
			analyzedSource("b.md", "hash-b", [verb("読む", "五段・マ行"), noun("庭")]),
			analyzedSource("a.md", "hash-a", [...tokens].reverse()),
		]);
		const first = poolFrom(a);
		const second = poolFrom(b);
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		for (const list of [first.nouns, first.modifiers, first.predicates]) {
			expect(surfaces(list)).toEqual([...surfaces(list)].sort());
		}
		for (const entry of first.modifiers) {
			expect(entry.variants.map((variant) => variant.variantId)).toEqual(
				[...entry.variants.map((variant) => variant.variantId)].sort(),
			);
		}
	});

	it("is deeply immutable once published", () => {
		const pool = poolOf(tokens);
		expect(Object.isFrozen(pool)).toBe(true);
		expect(() => {
			(pool.nouns as CollisionNounCandidate[]).push(pool.nouns[0]!);
		}).toThrow(TypeError);
		expect(() => {
			(pool.nouns[0] as { surface: string }).surface = "x";
		}).toThrow(TypeError);
		expect(() => {
			(pool.modifiers[0]!.variants as unknown[]).pop();
		}).toThrow(TypeError);
		expect(() => {
			(pool.modifiers[0]!.variants[0]!.base as { surface: string }).surface = "x";
		}).toThrow(TypeError);
		expect(() => {
			(pool.modifiers[0]!.variants[0]!.base.origins as VocabularyOrigin[]).push({
				path: "x",
				contentHash: "y",
				count: 1,
			});
		}).toThrow(TypeError);
		expect(() => {
			(pool.modifiers[0]!.classes as string[]).push("verb");
		}).toThrow(TypeError);
		expect(() => {
			(pool.provenance.sources as unknown[]).length = 0;
		}).toThrow(TypeError);
		expect(() => {
			(pool.modifiersByProfile as Record<string, unknown>)["all"] = [];
		}).toThrow(TypeError);
	});

	it("does not modify the input Snapshot", () => {
		const snapshot = snapshotOf([analyzedSource("a.md", "hash-a", tokens)]);
		const before = JSON.stringify(snapshot);
		const fingerprint = snapshot.fingerprint;
		poolFrom(snapshot);
		poolFrom(snapshot);
		expect(JSON.stringify(snapshot)).toBe(before);
		expect(snapshot.fingerprint).toBe(fingerprint);
	});

	it("binds the pool to the Snapshot fingerprint and Source provenance", () => {
		const snapshot = snapshotOf([analyzedSource("a.md", "hash-a", tokens)], "frequency");
		const pool = poolFrom(snapshot);
		expect(pool.policyVersion).toBe(COLLISION_LEXEME_POOL_POLICY_VERSION);
		expect(pool.provenance.vocabularyFingerprint).toBe(snapshot.fingerprint);
		expect(pool.provenance.vocabularyFingerprint.startsWith(
			`${VOCABULARY_FINGERPRINT_VERSION}:`,
		)).toBe(true);
		expect(pool.provenance.drawMode).toBe("frequency");
		expect(pool.provenance.sources).toEqual([
			{
				path: "a.md",
				contentHash: "hash-a",
				projectionPolicy: SOURCE_PROJECTION_POLICY_VERSION,
			},
		]);
		expect(pool.provenance.snapshotPolicyVersion).toBe(
			VOCABULARY_SNAPSHOT_POLICY_VERSION,
		);
		expect(pool.provenance.collisionProjectionPolicyVersion).toBe(
			COLLISION_PROJECTION_POLICY_VERSION,
		);
		expect(pool.provenance.manualProjectionPolicyVersion).toBe(
			MANUAL_PROJECTION_POLICY_VERSION,
		);
		expect(pool.provenance.patternSchemaVersion).toBe(
			COLLISION_PATTERN_SCHEMA_VERSION,
		);
		expect(pool.provenance.patternDataVersion).toBe(
			STANDARD_COLLISION_PATTERN_DATA_VERSION,
		);

		const other = snapshotOf([analyzedSource("a.md", "hash-b", tokens)], "frequency");
		expect(other.fingerprint).not.toBe(snapshot.fingerprint);
		expect(poolFrom(other).provenance.vocabularyFingerprint).toBe(
			other.fingerprint,
		);
	});
});

describe("fail-closed inputs", () => {
	const snapshot = snapshotOf([
		analyzedSource("a.md", "hash-a", [noun("都市"), verb("眠る", "五段・ラ行")]),
	]);

	function rejection(input: {
		snapshot: VocabularySnapshot;
		patternData: CollisionLexemePatternData;
	}): string {
		const result = buildCollisionLexemePool(input);
		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("expected a rejection");
		}
		// Fixed codes only: no message, path, surface, reading or exception.
		expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
		expect(JSON.stringify(result)).not.toContain("都市");
		expect(JSON.stringify(result)).not.toContain("a.md");
		return result.reason;
	}

	it("refuses pattern data from another schema version", () => {
		expect(
			rejection({
				snapshot,
				patternData: { ...PATTERN, schemaVersion: 1 },
			}),
		).toBe("invalid-pattern-data");
		expect(
			rejection({
				snapshot,
				patternData: { ...PATTERN, dataVersion: 0 },
			}),
		).toBe("invalid-pattern-data");
	});

	it("refuses unfrozen, hand-built pattern data", () => {
		expect(
			rejection({
				snapshot,
				patternData: {
					...PATTERN,
					nounSuffixes: [...PATTERN.nounSuffixes],
				},
			}),
		).toBe("invalid-pattern-data");
	});

	it("refuses an incomplete or unsafe modifier form and suffix set", () => {
		expect(
			rejection({
				snapshot,
				patternData: {
					...PATTERN,
					modifierForms: Object.freeze(PATTERN.modifierForms.slice(1)),
				},
			}),
		).toBe("invalid-pattern-data");
		expect(
			rejection({
				snapshot,
				patternData: { ...PATTERN, nounSuffixes: Object.freeze([]) },
			}),
		).toBe("invalid-pattern-data");
		for (const literal of ["${x}", "の の", "no", "{{x}}", ""]) {
			expect(
				rejection({
					snapshot,
					patternData: {
						...PATTERN,
						nounSuffixes: Object.freeze([
							Object.freeze({ id: "bad", weight: 1, literal }),
						]),
					},
				}),
			).toBe("invalid-pattern-data");
		}
	});

	it("refuses a Snapshot that is not one this core recognizes", () => {
		for (const broken of [
			{ ...snapshot, policyVersion: "vocabulary-snapshot-0" },
			{ ...snapshot, fingerprint: "sha256:whatever" },
			{ ...snapshot, drawMode: "weighted" },
			{ ...snapshot, sources: [] },
			{
				...snapshot,
				projections: {
					...snapshot.projections,
					collision: {
						...snapshot.projections.collision,
						policyVersion: "collision-projection-0",
					},
				},
			},
			{
				...snapshot,
				projections: {
					...snapshot.projections,
					manual: {
						...snapshot.projections.manual,
						policyVersion: "manual-projection-0",
					},
				},
			},
		]) {
			expect(
				rejection({
					snapshot: broken as unknown as VocabularySnapshot,
					patternData: PATTERN,
				}),
			).toBe("invalid-snapshot");
		}
	});

	it("refuses a malformed candidate record", () => {
		const candidates = snapshot.projections.manual.candidates.map((candidate) =>
			candidate.collisionRole === null
				? candidate
				: { ...candidate, frequency: 0 },
		);
		expect(
			rejection({
				snapshot: {
					...snapshot,
					projections: {
						...snapshot.projections,
						manual: { ...snapshot.projections.manual, candidates },
					},
				},
				patternData: PATTERN,
			}),
		).toBe("invalid-candidate");
	});

	/**
	 * Review P1: surface equality is not provenance equality. Each case below
	 * keeps every Collision projection surface exactly as the Snapshot built it
	 * and changes only what the projection claims about those surfaces.
	 */
	describe("provenance tampering that leaves every surface untouched", () => {
		const base = snapshotOf([
			analyzedSource("a.md", "hash-a", [
				noun("都市"),
				noun("都市"),
				proper("東京"),
				sahenNoun("変化"),
			]),
			analyzedSource("b.md", "hash-b", [noun("都市"), sahenNoun("変化")]),
		]);

		function withNouns(
			nouns: readonly unknown[],
			sahenNouns: readonly unknown[] = base.projections.collision.sahenNouns,
		): VocabularySnapshot {
			return {
				...base,
				projections: {
					...base.projections,
					collision: { ...base.projections.collision, nouns, sahenNouns },
				},
			} as unknown as VocabularySnapshot;
		}

		const nounList = base.projections.collision.nouns;
		const sahenList = base.projections.collision.sahenNouns;
		const city = nounList.find((entry) => entry.surface === "都市")!;

		it("accepts the untampered Snapshot", () => {
			const pool = poolFrom(base);
			expect(surfaces(pool.nouns)).toEqual(["東京", "変化", "都市"].sort());
			expect(pool.nouns.find((entry) => entry.surface === "都市")!.frequency).toBe(3);
		});

		it("refuses a rewritten candidateId", () => {
			expect(
				rejection({
					snapshot: withNouns(
						nounList.map((entry) =>
							entry.surface === "都市"
								? {
										...entry,
										candidates: entry.candidates.map((reference) => ({
											...reference,
											candidateId: "forged",
										})),
									}
								: entry,
						),
					),
					patternData: PATTERN,
				}),
			).toBe("inconsistent-projection");
		});

		it("refuses a rewritten displayFormId", () => {
			expect(
				rejection({
					snapshot: withNouns(
						nounList.map((entry) =>
							entry.surface === "都市"
								? {
										...entry,
										candidates: entry.candidates.map((reference) => ({
											...reference,
											displayFormId: `${reference.displayFormId}-forged`,
										})),
									}
								: entry,
						),
					),
					patternData: PATTERN,
				}),
			).toBe("inconsistent-projection");
		});

		it("refuses a frequency its own records do not sum to", () => {
			expect(
				rejection({
					snapshot: withNouns(
						nounList.map((entry) =>
							entry.surface === "都市"
								? { ...entry, frequency: entry.frequency + 7 }
								: entry,
						),
					),
					patternData: PATTERN,
				}),
			).toBe("inconsistent-projection");
		});

		it("refuses origins its own records do not merge to", () => {
			for (const origins of [
				[{ path: "a.md", contentHash: "hash-a", count: 3 }],
				[
					{ path: "a.md", contentHash: "hash-a", count: 2 },
					{ path: "b.md", contentHash: "hash-b", count: 99 },
				],
				[
					{ path: "a.md", contentHash: "hash-a", count: 2 },
					{ path: "c.md", contentHash: "hash-c", count: 1 },
				],
			]) {
				expect(
					rejection({
						snapshot: withNouns(
							nounList.map((entry) =>
								entry.surface === "都市" ? { ...entry, origins } : entry,
							),
						),
						patternData: PATTERN,
					}),
				).toBe("inconsistent-projection");
			}
		});

		it("refuses a record filed under the wrong Collision role", () => {
			// 変化 is サ変接続, so moving it into the noun list keeps every surface
			// while misreporting which pool its provenance belongs to.
			expect(
				rejection({
					snapshot: withNouns([...nounList, ...sahenList], []),
					patternData: PATTERN,
				}),
			).toBe("inconsistent-projection");
		});

		it("refuses a record claimed by both lists", () => {
			expect(
				rejection({
					snapshot: withNouns(nounList, [...sahenList, city]),
					patternData: PATTERN,
				}),
			).toBe("inconsistent-projection");
		});

		it("refuses a record the Collision projection drops entirely", () => {
			expect(
				rejection({
					snapshot: withNouns(
						nounList.filter((entry) => entry.surface !== "都市"),
					),
					patternData: PATTERN,
				}),
			).toBe("inconsistent-projection");
		});

		it("refuses a reference to a record that is not a Collision candidate", () => {
			// A verb record exists in the Manual projection but carries no role.
			const withVerb = snapshotOf([
				analyzedSource("a.md", "hash-a", [
					noun("都市"),
					verb("眠る", "五段・ラ行"),
				]),
			]);
			const verbRecord = withVerb.projections.manual.candidates.find(
				(candidate) => candidate.surface === "眠る",
			)!;
			expect(
				rejection({
					snapshot: {
						...withVerb,
						projections: {
							...withVerb.projections,
							collision: {
								...withVerb.projections.collision,
								nouns: withVerb.projections.collision.nouns.map((entry) => ({
									...entry,
									candidates: [
										...entry.candidates,
										{
											candidateId: verbRecord.candidateId,
											displayFormId: verbRecord.displayFormId,
										},
									],
								})),
							},
						},
					},
					patternData: PATTERN,
				}),
			).toBe("inconsistent-projection");
		});
	});

	it("refuses a Collision projection the Manual projection does not support", () => {
		expect(
			rejection({
				snapshot: {
					...snapshot,
					projections: {
						...snapshot.projections,
						collision: {
							...snapshot.projections.collision,
							nouns: [
								...snapshot.projections.collision.nouns,
								{
									surface: "幻",
									frequency: 1,
									origins: [
										{ path: "a.md", contentHash: "hash-a", count: 1 },
									],
									candidates: [
										{ candidateId: "ghost", displayFormId: "ghost-form" },
									],
								},
							],
						},
					},
				},
				patternData: PATTERN,
			}),
		).toBe("inconsistent-projection");
	});
});

describe("the pool contract validator", () => {
	/**
	 * `inspectCollisionLexemePoolStructure()` is the single statement of what a
	 * pool's content must be, and a consumer refuses a pool it rejects. If the
	 * builder and it ever disagreed, one of them would be wrong about the
	 * contract and the consumer's guarantee would be worth nothing, so the
	 * builder's own output is pinned against it here.
	 *
	 * Where a pool came from is a separate question this function cannot answer;
	 * `tests/collisionCore.test.ts` covers the authenticated path.
	 */
	const rich = [
		noun("都市"),
		proper("東京"),
		sahenNoun("変化"),
		naStem("静か"),
		verb("眠る", "五段・ラ行"),
		adjective("赤い", "形容詞・アウオ段"),
	];

	it("accepts every pool the builder publishes", () => {
		const pools: readonly CollisionLexemePool[] = [
			poolOf(rich),
			poolOf([noun("都市")]),
			poolOf([sahenNoun("変化")]),
			poolOf([naStem("静か")]),
			poolOf([verb("眠る", "五段・ラ行")]),
			poolOf([adjective("赤かっ", "形容詞・アウオ段", "赤い", "連用タ接続")]),
			poolOf([naStem("変"), sahenNoun("変化")]),
			poolOf([noun("愛"), proper("愛")]),
			poolOf([tok("それ", { detail1: "代名詞" })]),
			poolFrom(
				snapshotOf(
					[
						analyzedSource("a.md", "hash-a", [noun("都市"), noun("都市")]),
						analyzedSource("b.md", "hash-b", [noun("都市"), proper("都市")]),
					],
					"frequency",
				),
			),
		];
		for (const pool of pools) {
			expect(inspectCollisionLexemePoolStructure(pool, PATTERN)).toBeNull();
		}
	});

	it("memoizes by identity without letting a forgery inherit the answer", () => {
		const genuine = poolOf(rich);
		expect(inspectCollisionLexemePoolStructure(genuine, PATTERN)).toBeNull();
		// Repeating the question about the same frozen value is the only thing
		// the memo answers; it cannot change what that value is.
		expect(inspectCollisionLexemePoolStructure(genuine, PATTERN)).toBeNull();

		// A separate object with the same shape is a different value and is
		// checked from scratch, so a validated pool lends nothing to a forgery.
		const forged = Object.freeze({
			...genuine,
			nouns: Object.freeze([
				Object.freeze({ surface: "<script>", frequency: 1 }),
			]),
		}) as unknown as CollisionLexemePool;
		expect(inspectCollisionLexemePoolStructure(forged, PATTERN)).not.toBeNull();
		expect(inspectCollisionLexemePoolStructure(genuine, PATTERN)).toBeNull();
	});

	it("names the invariant that failed and nothing else", () => {
		const pool = poolOf(rich);
		const shallow = { ...pool };
		// Any value this module did not produce is refused on origin first,
		// whatever else is wrong with it.
		expect(inspectCollisionLexemePool(shallow, PATTERN)).toBe("not-minted");
		// The structural half still names the structural invariant.
		expect(inspectCollisionLexemePoolStructure(shallow, PATTERN)).toBe(
			"not-frozen",
		);
		expect(
			inspectCollisionLexemePoolStructure(
				{
					...pool,
					policyVersion: "collision-lexeme-0",
				} as unknown as CollisionLexemePool,
				PATTERN,
			),
		).toBe("not-frozen");
		// A violation is a fixed code: no path, surface, reading or exception.
		expect(
			JSON.stringify(inspectCollisionLexemePool(shallow, PATTERN)),
		).not.toContain("a.md");
	});

	it("does not authenticate a pool the pure builder produced", () => {
		// The pure builder takes an ordinary Snapshot and says nothing about
		// where that Snapshot came from, so its output satisfies the whole
		// structural contract and is still not an authenticated pool. That
		// separation is the point: authentication starts where the words do.
		const pool = poolOf(rich);
		expect(inspectCollisionLexemePoolStructure(pool, PATTERN)).toBeNull();
		expect(inspectCollisionLexemePool(pool, PATTERN)).toBe("not-minted");
	});
});

describe("the slice's isolation", () => {
	/** A tokenizer that records every call and never runs during a pool build. */
	function countingTokenizer(
		table: ReadonlyMap<string, JapaneseToken[]>,
		calls: string[],
	): JapaneseTokenizer {
		return {
			tokenize: (text) => {
				calls.push(text);
				const tokens = table.get(text);
				if (!tokens) {
					throw new Error("unexpected run");
				}
				return Promise.resolve(tokens.map((item) => ({ ...item })));
			},
		};
	}

	it("performs no tokenization while the pool is built", async () => {
		const run = [
			noun("都市"),
			verb("眠る", "五段・ラ行"),
			sahenNoun("変化"),
			adjective("赤い", "形容詞・アウオ段"),
		];
		const text = run.map((item) => item.surface).join("");
		const calls: string[] = [];
		const analyzed = await analyzeManualMorphSource({
			text,
			sourcePath: "source.md",
			tokenizer: countingTokenizer(new Map([[text, run]]), calls),
		});
		if (analyzed.status !== "ready") {
			throw new Error(analyzed.status);
		}
		const { snapshot } = buildManualMorphVocabulary({
			sources: [analyzed.analysis],
			drawMode: "uniform",
		});
		const analysisCalls = calls.length;
		expect(analysisCalls).toBeGreaterThan(0);

		const pool = poolFrom(snapshot);
		poolFrom(snapshot);
		expect(calls.length).toBe(analysisCalls);
		expect(surfaces(pool.nouns)).toEqual(["変化", "都市"].sort());
		expect(surfaces(pool.predicates)).toEqual(["眠る"]);
	});

	it("changes no other version contract", () => {
		expect(SEMANTROPY_ALGORITHM_VERSION).toBe(9);
		expect(MANUAL_MORPH_POLICY_VERSION).toBe("manual-morph-2");
		expect(FAKE_DICTIONARY_ALGORITHM_VERSION).toBe(1);
		expect(STANDARD_TEMPLATE_SET_VERSION).toBe(1);
		expect(SEMANTROPY_SETTINGS_SCHEMA_VERSION).toBe(3);
		expect(COLLECT_METADATA_VERSION).toBe(2);
		expect(COLLECTION_DOCUMENT_VERSION).toBe(1);
		expect(VOCABULARY_FINGERPRINT_VERSION).toBe(
			"vocabulary-fingerprint-sha256-1",
		);
		expect(COLLISION_PROJECTION_POLICY_VERSION).toBe("collision-projection-1");
		expect(STANDARD_COLLISION_PATTERN_SCHEMA_VERSION).toBe(2);
		expect(STANDARD_COLLISION_PATTERN_DATA_VERSION).toBe(2);
	});
});

describe("performance on a realistic Snapshot", () => {
	it("builds a pool from a large Snapshot well inside one interaction", () => {
		const tokens: JapaneseToken[] = [];
		for (let index = 0; index < 1800; index += 1) {
			tokens.push(noun(`名詞${index}`));
		}
		for (let index = 0; index < 400; index += 1) {
			tokens.push(sahenNoun(`変化${index}`));
		}
		for (let index = 0; index < 200; index += 1) {
			tokens.push(naStem(`静か${index}`));
		}
		for (const [conjugationType, baseForm] of VERB_CASES) {
			for (let index = 0; index < 40; index += 1) {
				tokens.push(verb(`${baseForm[0]}${index}${baseForm.slice(1)}`, conjugationType));
			}
		}
		for (let index = 0; index < 200; index += 1) {
			tokens.push(adjective(`赤${index}い`, "形容詞・アウオ段"));
		}
		const snapshot = snapshotOf([analyzedSource("a.md", "hash-a", tokens)]);
		const started = performance.now();
		const pool = poolFrom(snapshot);
		const elapsed = performance.now() - started;

		expect(pool.nouns).toHaveLength(2400);
		expect(pool.predicates).toHaveLength(400);
		// 2,400 nouns x 6 suffixes, 400 sahen x 4, 200 な, 400 verbs x 4, 200 basic.
		expect(pool.modifiers).toHaveLength(14400 + 1600 + 200 + 1600 + 200);
		expect(elapsed).toBeLessThan(3000);
	});
});
