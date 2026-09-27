import { describe, expect, it } from "vitest";
import { SOURCE_PROJECTION_POLICY_VERSION } from "../src/analysis/projectMarkdownSource";
import {
	vocabularyCandidateId,
	vocabularyDisplayFormId,
	type RubyVocabulary,
	type VocabularyCandidate,
} from "../src/analysis/rubyVocabulary";
import {
	COLLISION_ALGORITHM_VERSION,
	COLLISION_MAX_REQUESTED_COUNT,
	COLLISION_RESULT_ATTEMPT_LIMIT,
	COLLISION_SIGNATURE_ATTEMPT_LIMIT,
	COLLISION_SIGNATURE_RUN_LIMIT,
	generateCollisionResults,
	viableCollisionRecipes,
	type CollisionGenerationResult,
	type CollisionRecipeRequest,
} from "../src/collision/collisionCore";
import {
	buildCollisionLexemePool,
	inspectCollisionLexemePoolStructure,
	type CollisionLexemePatternData,
	type CollisionLexemePool,
} from "../src/collision/collisionLexemePool";
import {
	buildAuthenticatedCollisionLexemePool,
	inspectCollisionLexemePool,
} from "../src/collision/collisionVocabulary";
import {
	compileCollisionPatternSet,
	type CompiledCollisionPatternSet,
} from "../src/collision/compilePatternSet";
import {
	STANDARD_COLLISION_CONNECTORS,
	STANDARD_COLLISION_LITERALS,
	STANDARD_COLLISION_MODIFIER_FORMS,
	STANDARD_COLLISION_NOUN_SUFFIXES,
	STANDARD_COLLISION_PATTERN_DATA_VERSION,
	STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
	STANDARD_COLLISION_RECIPES,
} from "../src/collision/generated/standardCollisionPatternEntries";
import type {
	RawCollisionConnector,
	RawCollisionModifierForm,
	RawCollisionNounSuffix,
	RawCollisionRecipe,
} from "../src/collision/patternData";
import { COLLECT_METADATA_VERSION } from "../src/collect/collectProvenance";
import { COLLECTION_DOCUMENT_VERSION } from "../src/collect/collectionDocument";
import { FAKE_DICTIONARY_ALGORITHM_VERSION } from "../src/dictionary/generateFakeDefinition";
import { STANDARD_TEMPLATE_SET_VERSION } from "../src/dictionary/standardTemplateSet";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import { SEMANTROPY_SETTINGS_SCHEMA_VERSION } from "../src/settings/semantropySettings";
import { MANUAL_MORPH_POLICY_VERSION } from "../src/transform/manualMorphology";
import { buildVocabularyPool } from "../src/transform/transformTokens";
import type {
	JapaneseToken,
	JapaneseTokenizer,
} from "../src/tokenizer/JapaneseTokenizer";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import {
	buildVocabularySnapshot,
	transformWithVocabularySnapshot,
	VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
	type AnalyzedVocabularySource,
	type VocabularyDrawMode,
	type VocabularySnapshot,
} from "../src/vocabulary/vocabularySnapshot";
import {
	analyzeManualMorphSource,
	buildManualMorphVocabulary,
} from "../src/transform/manualMorphology";

/**
 * `PRE-RELEASE-COLLISION-CORE1` focused regressions.
 *
 * Every pattern set here is produced by the product's own compiler, so a
 * fixture cannot assert behaviour the compiler would never allow. Pools come
 * from the product's own lexeme builder for the same reason.
 */

// --- pattern sets ----------------------------------------------------------

type PatternOverrides = {
	recipes?: readonly RawCollisionRecipe[];
	connectors?: readonly RawCollisionConnector[];
	modifierForms?: readonly RawCollisionModifierForm[];
	nounSuffixes?: readonly RawCollisionNounSuffix[];
};

function patternWith(overrides: PatternOverrides = {}): CompiledCollisionPatternSet {
	const result = compileCollisionPatternSet({
		schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
		dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION,
		recipes: overrides.recipes ?? STANDARD_COLLISION_RECIPES,
		literals: STANDARD_COLLISION_LITERALS,
		connectors: overrides.connectors ?? STANDARD_COLLISION_CONNECTORS,
		modifierForms: overrides.modifierForms ?? STANDARD_COLLISION_MODIFIER_FORMS,
		nounSuffixes: overrides.nounSuffixes ?? STANDARD_COLLISION_NOUN_SUFFIXES,
	});
	if (!result.ok) {
		throw new Error(
			`the fixture pattern set must compile: ${result.issues
				.map((issue) => `${issue.code}/${issue.id}`)
				.join(", ")}`,
		);
	}
	return result.set;
}

const STANDARD = patternWith();

/** Only the empty Connector, so a Connector slot contributes nothing. */
const EMPTY_CONNECTOR_ONLY: readonly RawCollisionConnector[] = [
	{ id: "empty", form: "empty", weight: 1, literal: null },
];

/** One empty and one literal Connector, heavily skewed to the literal. */
const SKEWED_CONNECTORS: readonly RawCollisionConnector[] = [
	{ id: "empty", form: "empty", weight: 1, literal: null },
	{ id: "no", form: "literal", weight: 99, literal: "の" },
];

/** Two Connectors of equal weight: two structures for one recipe. */
const TWO_CONNECTORS: readonly RawCollisionConnector[] = [
	{ id: "empty", form: "empty", weight: 1, literal: null },
	{ id: "no", form: "literal", weight: 1, literal: "の" },
];

function modifierFormsWith(
	weights: Readonly<Record<string, number>>,
): readonly RawCollisionModifierForm[] {
	return STANDARD_COLLISION_MODIFIER_FORMS.map((form) => ({
		...form,
		weight: weights[form.id] ?? form.weight,
	}));
}

function nounSuffixesWith(
	weights: Readonly<Record<string, number>>,
): readonly RawCollisionNounSuffix[] {
	return STANDARD_COLLISION_NOUN_SUFFIXES.map((suffix) => ({
		...suffix,
		weight: weights[suffix.id] ?? suffix.weight,
	}));
}

const recipe = (
	partial: Pick<RawCollisionRecipe, "id" | "label" | "parts"> &
		Partial<RawCollisionRecipe>,
): RawCollisionRecipe => ({
	enabled: true,
	selectable: true,
	weight: 1,
	presence: [],
	...partial,
});

const NOUN = (slotId: string) => ({ kind: "noun", slotId, optional: false });
const CONNECTOR = (slotId: string) => ({ kind: "connector", slotId, optional: false });
const LITERAL = (slotId: string, literalId: string) => ({
	kind: "literal",
	slotId,
	optional: false,
	literalId,
});
const MODIFIER = (slotId: string, profile: string, optional = false) => ({
	kind: "modifier",
	slotId,
	optional,
	profile,
});

/** Three required nouns, nothing else: the cleanest view of the Noun rule. */
const THREE_NOUNS = recipe({
	id: "three-nouns",
	label: "Three nouns",
	parts: [NOUN("n1"), NOUN("n2"), NOUN("n3")],
});

/** Literal, noun, literal, literal: declared order with no draw ambiguity. */
const ORDERED_LITERALS = recipe({
	id: "ordered-literals",
	label: "Ordered literals",
	parts: [
		LITERAL("l1", "topic-link"),
		NOUN("n1"),
		LITERAL("l2", "object-link"),
		LITERAL("l3", "question-end"),
	],
});

/** One required Modifier from `all`, then a noun. */
const MODIFIER_FIRST = recipe({
	id: "modifier-first",
	label: "Modifier first",
	parts: [MODIFIER("m1", "all"), NOUN("n1")],
});

/** An optional sahen Modifier that may always be omitted. */
const OPTIONAL_SAHEN = recipe({
	id: "optional-sahen",
	label: "Optional sahen",
	parts: [MODIFIER("m1", "sahen-basic", true), NOUN("n1")],
	presence: [
		{ slots: [], weight: 1 },
		{ slots: ["m1"], weight: 1 },
	],
});

/** Two nouns joined by one Connector. */
const NOUN_PAIR = recipe({
	id: "pair",
	label: "Pair",
	parts: [NOUN("n1"), CONNECTOR("c1"), NOUN("n2")],
});

// --- vocabulary fixtures ---------------------------------------------------

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
const sahenNoun = (surface: string) => tok(surface, { detail1: "サ変接続" });
const naStem = (surface: string) => tok(surface, { detail1: "形容動詞語幹" });
const verb = (surface: string, conjugationType = "五段・ラ行") =>
	tok(surface, {
		pos: "動詞",
		detail1: "自立",
		conjugationType,
		conjugationForm: "基本形",
		baseForm: surface,
	});
const adjective = (surface: string) =>
	tok(surface, {
		pos: "形容詞",
		detail1: "自立",
		conjugationType: "形容詞・アウオ段",
		conjugationForm: "基本形",
		baseForm: surface,
	});

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
	tokens: readonly JapaneseToken[],
	drawMode: VocabularyDrawMode = "uniform",
): VocabularySnapshot {
	return buildVocabularySnapshot({
		sources: [analyzedSource("a.md", "hash-a", tokens)],
		drawMode,
	});
}

/** One analysis run whose tokens are exactly the fixture's, looked up whole. */
function tableTokenizer(
	text: string,
	tokens: readonly JapaneseToken[],
): JapaneseTokenizer {
	return {
		tokenize: (input) => {
			if (input !== text) {
				throw new Error("unexpected run");
			}
			return Promise.resolve(tokens.map((item) => ({ ...item })));
		},
	};
}

/**
 * A pool from the authenticated chain, which is the only way to get one a
 * consumer will accept.
 *
 * Source text enters through `analyzeManualMorphSource()`, which tokenizes it
 * and registers the analysis privately; `buildManualMorphVocabulary()` mints
 * one owner handle from those analyses; the Collision seam mints the pool from
 * that handle. Fixtures go the same way production will, so nothing here can
 * pass a Snapshot the product would not have produced.
 */
async function poolOf(
	tokens: readonly JapaneseToken[],
	patternData: CollisionLexemePatternData = STANDARD,
	drawMode: VocabularyDrawMode = "uniform",
): Promise<CollisionLexemePool> {
	const text = tokens.map((item) => item.surface).join("");
	const analyzed = await analyzeManualMorphSource({
		text,
		sourcePath: "a.md",
		tokenizer: tableTokenizer(text, tokens),
	});
	if (analyzed.status !== "ready") {
		throw new Error(analyzed.status);
	}
	const vocabulary = buildManualMorphVocabulary({
		sources: [analyzed.analysis],
		drawMode,
	});
	const built = buildAuthenticatedCollisionLexemePool({
		vocabulary,
		patternData,
	});
	if (!built.ok) {
		throw new Error(`the fixture pool must build: ${built.reason}`);
	}
	return built.pool;
}

/** A pool with every Collision role represented. */
const RICH_TOKENS: readonly JapaneseToken[] = [
	noun("都市"),
	noun("庭"),
	noun("鏡"),
	noun("記憶"),
	tok("東京", { detail1: "固有名詞", detail2: "地域" }),
	sahenNoun("変化"),
	sahenNoun("崩壊"),
	naStem("静か"),
	verb("眠る"),
	verb("壊れる", "一段"),
	adjective("赤い"),
	adjective("青い"),
];

function generate(input: {
	pool: CollisionLexemePool;
	patternSet?: CompiledCollisionPatternSet;
	drawMode?: VocabularyDrawMode;
	request?: CollisionRecipeRequest;
	count?: number;
	nonce?: number;
	avoid?: { texts: readonly string[]; recentSignatures: readonly string[] };
}): CollisionGenerationResult {
	return generateCollisionResults({
		pool: input.pool,
		patternSet: input.patternSet ?? STANDARD,
		drawMode: input.drawMode ?? "uniform",
		request: input.request ?? { kind: "random" },
		count: input.count ?? 10,
		nonce: input.nonce ?? 7,
		...(input.avoid === undefined ? {} : { avoid: input.avoid }),
	});
}

function draft(input: Parameters<typeof generate>[0]) {
	const result = generate(input);
	if (!result.ok) {
		throw new Error(`generation was refused: ${result.reason}`);
	}
	return result.draft;
}

function signatureParts(signature: string): {
	recipeId: string;
	presence: readonly string[];
	connectors: readonly string[];
	forms: readonly string[];
} {
	const [recipeId, presence, connectors, forms] = JSON.parse(signature) as [
		string,
		string[],
		string[],
		string[],
	];
	return { recipeId, presence, connectors, forms };
}

// --- recipes and composition ----------------------------------------------

describe("the ordered composer", () => {
	it("generates every standard recipe", async () => {
		const pool = await poolOf(RICH_TOKENS);
		const viable = viableCollisionRecipes({ pool, patternSet: STANDARD });
		if (!viable.ok) {
			throw new Error(viable.reason);
		}
		expect(viable.recipes.map((entry) => entry.recipeId).sort()).toEqual(
			STANDARD_COLLISION_RECIPES.map((entry) => entry.id).sort(),
		);
		for (const declared of STANDARD_COLLISION_RECIPES) {
			const built = draft({
				pool,
				request: { kind: "fixed", recipeId: declared.id },
				count: 5,
				nonce: 11,
			});
			expect(built.status).toBe("complete");
			expect(built.generatedCount).toBe(5);
			for (const result of built.results) {
				expect(result.recipeId).toBe(declared.id);
				expect(result.text.length).toBeGreaterThan(0);
			}
		}
	});

	it("joins two nouns through one Connector", async () => {
		const pattern = patternWith({
			recipes: [NOUN_PAIR],
			connectors: EMPTY_CONNECTOR_ONLY,
		});
		const pool = await poolOf([noun("都"), noun("市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 4, nonce: 3 });
		for (const result of built.results) {
			expect(result.text).toHaveLength(2);
			expect(new Set(result.text).size).toBe(2);
		}
	});

	it("joins three nouns in declared order", async () => {
		const pattern = patternWith({ recipes: [THREE_NOUNS] });
		const pool = await poolOf([noun("都"), noun("市"), noun("森")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 6, nonce: 5 });
		for (const result of built.results) {
			expect([...result.text].sort()).toEqual(["市", "森", "都"]);
			expect(result.limited).toBe(false);
		}
	});

	it("resolves a fixed literal by its ID and keeps declared order", async () => {
		const pattern = patternWith({ recipes: [ORDERED_LITERALS] });
		const pool = await poolOf([noun("都市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 1, nonce: 1 });
		// topic-link + noun + object-link + question-end, in that order.
		expect(built.results[0]!.text).toBe("は都市をか");
	});

	it("keeps the standard `という名の` recipe as a plain-text join", async () => {
		const pool = await poolOf(RICH_TOKENS);
		const built = draft({
			pool,
			request: { kind: "fixed", recipeId: "named" },
			count: 6,
			nonce: 21,
		});
		for (const result of built.results) {
			expect(result.text).toContain("という名の");
			const [left, right] = result.text.split("という名の");
			expect(left!.length).toBeGreaterThan(0);
			expect(right!.length).toBeGreaterThan(0);
		}
	});

	it("contributes nothing for an empty Connector", async () => {
		const pattern = patternWith({
			recipes: [NOUN_PAIR],
			connectors: EMPTY_CONNECTOR_ONLY,
		});
		const pool = await poolOf([noun("都"), noun("市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 4, nonce: 9 });
		for (const result of built.results) {
			expect(result.text).not.toContain("の");
			expect(signatureParts(result.structureSignature).connectors).toEqual([
				"empty",
			]);
		}
	});

	it("reaches every presence combination of an optional-Modifier recipe", async () => {
		const pool = await poolOf(RICH_TOKENS);
		const seen = new Set<string>();
		for (let nonce = 0; nonce < 120; nonce += 1) {
			const built = draft({
				pool,
				request: { kind: "fixed", recipeId: "noun-pair" },
				count: 4,
				nonce,
			});
			for (const result of built.results) {
				seen.add(JSON.stringify(signatureParts(result.structureSignature).presence));
			}
		}
		expect([...seen].sort()).toEqual(
			[
				JSON.stringify([]),
				JSON.stringify(["m1"]),
				JSON.stringify(["m1", "m2"]),
				JSON.stringify(["m2"]),
			].sort(),
		);
	});

	it("builds the Predicate recipe from regular verb basic forms only", async () => {
		const pool = await poolOf(RICH_TOKENS);
		const built = draft({
			pool,
			request: { kind: "fixed", recipeId: "question",
			},
			count: 8,
			nonce: 33,
		});
		const predicates = pool.predicatesByProfile["regular-verb-basic"].map(
			(entry) => entry.surface,
		);
		expect(predicates.sort()).toEqual(["壊れる", "眠る"]);
		for (const result of built.results) {
			expect(result.text.endsWith("か")).toBe(true);
			const body = result.text.slice(0, -1);
			expect(predicates.some((surface) => body.endsWith(surface))).toBe(true);
		}
	});

	it("draws the sahen profile through the sahen basic form, not a look-alike", async () => {
		// A pattern set may author a `する` noun suffix. 変化する is then reachable
		// twice from the same record: as the sahen basic form and as Noun plus
		// suffix. A `sahen-basic` slot must still draw the sahen basic form —
		// otherwise the profile is satisfied by coincidence of surface, and the
		// form id recorded in the signature describes the wrong construction.
		const pattern = patternWith({
			recipes: [
				recipe({
					id: "sahen-slot",
					label: "Sahen slot",
					parts: [MODIFIER("m1", "sahen-basic"), NOUN("n1")],
				}),
			],
			connectors: EMPTY_CONNECTOR_ONLY,
			nounSuffixes: [
				...STANDARD_COLLISION_NOUN_SUFFIXES,
				{ id: "noun-suru", weight: 9999, literal: "する" },
			],
		});
		const pool = await poolOf([sahenNoun("変化"), noun("都市")], pattern);
		const shared = pool.modifiersByProfile["sahen-basic"].find(
			(entry) => entry.surface === "変化する",
		)!;
		expect(shared.variants.map((entry) => entry.formId).sort()).toEqual([
			"noun-suru",
			"sahen-basic",
		]);
		for (let nonce = 0; nonce < 40; nonce += 1) {
			const built = draft({ pool, patternSet: pattern, count: 1, nonce });
			expect(signatureParts(built.results[0]!.structureSignature).forms).toEqual([
				"sahen-basic",
			]);
		}
	});

	it("builds the sahen recipe from sahen basic Modifiers only", async () => {
		const pool = await poolOf(RICH_TOKENS);
		const built = draft({
			pool,
			request: { kind: "fixed", recipeId: "sahen-noun" },
			count: 8,
			nonce: 44,
		});
		for (const result of built.results) {
			expect(
				result.text.startsWith("変化する") || result.text.startsWith("崩壊する"),
			).toBe(true);
			expect(signatureParts(result.structureSignature).forms).toEqual([
				"sahen-basic",
			]);
		}
	});
});

// --- weights ---------------------------------------------------------------

function countTexts(
	pool: CollisionLexemePool,
	patternSet: CompiledCollisionPatternSet,
	drawMode: VocabularyDrawMode,
	nonces: number,
): Map<string, number> {
	const counts = new Map<string, number>();
	for (let nonce = 0; nonce < nonces; nonce += 1) {
		const built = draft({ pool, patternSet, drawMode, count: 1, nonce });
		for (const result of built.results) {
			counts.set(result.text, (counts.get(result.text) ?? 0) + 1);
		}
	}
	return counts;
}

describe("weight separation", () => {
	it("draws Connectors by Connector weight", async () => {
		const pattern = patternWith({
			recipes: [NOUN_PAIR],
			connectors: SKEWED_CONNECTORS,
		});
		const pool = await poolOf([noun("都"), noun("市")], pattern);
		let withLiteral = 0;
		for (let nonce = 0; nonce < 200; nonce += 1) {
			const built = draft({ pool, patternSet: pattern, count: 1, nonce });
			if (signatureParts(built.results[0]!.structureSignature).connectors[0] === "no") {
				withLiteral += 1;
			}
		}
		// 99:1 in the data. A uniform draw would land near 100.
		expect(withLiteral).toBeGreaterThan(180);
	});

	it("draws Modifier forms by modifier-form and noun-suffix weight", async () => {
		const pattern = patternWith({
			recipes: [MODIFIER_FIRST],
			connectors: EMPTY_CONNECTOR_ONLY,
			nounSuffixes: nounSuffixesWith({ "noun-no": 999 }),
		});
		const pool = await poolOf([noun("都市"), adjective("赤い")], pattern);
		let nounNo = 0;
		for (let nonce = 0; nonce < 200; nonce += 1) {
			const built = draft({ pool, patternSet: pattern, count: 1, nonce });
			if (signatureParts(built.results[0]!.structureSignature).forms[0] === "noun-no") {
				nounNo += 1;
			}
		}
		expect(nounNo).toBeGreaterThan(180);
	});

	it("separates Vocabulary frequency from structural form weight", async () => {
		// 赤い is observed 60 times, 静か once. The two forms that carry them
		// have equal structural weight, and every other form is rare.
		const pattern = patternWith({
			recipes: [MODIFIER_FIRST],
			connectors: EMPTY_CONNECTOR_ONLY,
			modifierForms: modifierFormsWith({
				"i-adjective-basic": 100,
				"na-adjective-na": 100,
			}),
			nounSuffixes: nounSuffixesWith({
				"noun-no": 1,
				"noun-teki-na": 1,
				"noun-no-yo-na": 1,
				"noun-ppoi": 1,
				"noun-ka-shita": 1,
				"noun-ka-sareta": 1,
			}),
		});
		const tokens = [naStem("静か"), ...Array.from({ length: 60 }, () => adjective("赤い"))];
		const pool = await poolOf(tokens, pattern, "frequency");
		const counts = countTexts(pool, pattern, "frequency", 400);
		const red = counts.get("赤い静か") ?? 0;
		const quiet = counts.get("静かな静か") ?? 0;
		// Structural weights are equal, so the two forms are near-even even though
		// one lexeme is 60x more frequent. Multiplying the systems would push the
		// adjective above 95%.
		expect(red).toBeGreaterThan(120);
		expect(quiet).toBeGreaterThan(120);
		expect(Math.abs(red - quiet)).toBeLessThan(120);
	});

	it("weights a lexeme by the records that reach it through the drawn form", async () => {
		// 変 is a 形容動詞語幹 Noun seen once; 変化 is a sahen Noun seen 50 times.
		// The suffix 化した turns 変 into 変化した — the same surface the sahen
		// past of 変化 produces. The candidate's aggregate frequency therefore
		// counts both records, but only the 変 record reaches that surface
		// through the suffix form, so only it may weight this draw.
		const pattern = patternWith({
			recipes: [MODIFIER_FIRST],
			connectors: EMPTY_CONNECTOR_ONLY,
			modifierForms: modifierFormsWith({
				"i-adjective-basic": 1,
				"na-adjective-na": 1,
				"verb-basic": 1,
				"verb-past": 1,
				"verb-progressive": 1,
				"verb-negative": 1,
				"sahen-basic": 1,
				"sahen-past": 1,
				"sahen-progressive": 1,
				"sahen-negative": 1,
			}),
			nounSuffixes: nounSuffixesWith({
				"noun-no": 1,
				"noun-teki-na": 1,
				"noun-no-yo-na": 1,
				"noun-ppoi": 1,
				"noun-ka-shita": 100000,
				"noun-ka-sareta": 1,
			}),
		});
		const tokens = [
			naStem("変"),
			...Array.from({ length: 50 }, () => sahenNoun("変化")),
		];
		const pool = await poolOf(tokens, pattern, "frequency");
		const shared = pool.modifiers.find((entry) => entry.surface === "変化した")!;
		expect(shared.classes).toEqual(["sahen", "noun-suffix"]);
		expect(shared.frequency).toBe(51);

		const counts = countTexts(pool, pattern, "frequency", 300);
		// Through 化した the two candidates are 変 (1) against 変化 (50), so the
		// shorter surface is rare. Using the aggregate 51 instead would make it
		// roughly even.
		const viaSuffix = counts.get("変化した変") ?? 0;
		const viaSuffix2 = counts.get("変化した変化") ?? 0;
		const other = counts.get("変化化した変") ?? 0;
		const other2 = counts.get("変化化した変化") ?? 0;
		expect(viaSuffix + viaSuffix2).toBeLessThan(30);
		expect(other + other2).toBeGreaterThan(220);
	});

	it("applies Vocabulary frequency inside one form and Uniform does not", async () => {
		const pattern = patternWith({
			recipes: [MODIFIER_FIRST],
			connectors: EMPTY_CONNECTOR_ONLY,
			modifierForms: modifierFormsWith({ "i-adjective-basic": 10000 }),
		});
		const tokens = [
			noun("都市"),
			adjective("青い"),
			...Array.from({ length: 60 }, () => adjective("赤い")),
		];
		const frequency = countTexts(
			await poolOf(tokens, pattern, "frequency"),
			pattern,
			"frequency",
			300,
		);
		const uniform = countTexts(
			await poolOf(tokens, pattern, "uniform"),
			pattern,
			"uniform",
			300,
		);
		// Same pattern data, same lexemes: only the draw mode differs.
		expect(frequency.get("赤い都市") ?? 0).toBeGreaterThan(260);
		expect(uniform.get("赤い都市") ?? 0).toBeLessThan(200);
		expect(uniform.get("青い都市") ?? 0).toBeGreaterThan(100);
	});

	it("draws Nouns by Vocabulary weight", async () => {
		const pattern = patternWith({
			recipes: [recipe({ id: "one-noun", label: "One noun", parts: [NOUN("n1")] })],
		});
		const tokens = [noun("庭"), ...Array.from({ length: 40 }, () => noun("都市"))];
		const frequency = countTexts(
			await poolOf(tokens, pattern, "frequency"),
			pattern,
			"frequency",
			200,
		);
		const uniform = countTexts(
			await poolOf(tokens, pattern, "uniform"),
			pattern,
			"uniform",
			200,
		);
		expect(frequency.get("都市") ?? 0).toBeGreaterThan(180);
		expect(uniform.get("庭") ?? 0).toBeGreaterThan(70);
	});
});

// --- recipe selection ------------------------------------------------------

describe("recipe selection", () => {
	it("draws Random from viable enabled recipes by recipe weight", async () => {
		const pattern = patternWith({
			recipes: [
				recipe({ id: "heavy", label: "Heavy", weight: 99, parts: [NOUN("n1")] }),
				recipe({ id: "light", label: "Light", weight: 1, parts: [NOUN("n1"), NOUN("n2")] }),
			],
		});
		const pool = await poolOf([noun("都"), noun("市")], pattern);
		let heavy = 0;
		for (let nonce = 0; nonce < 200; nonce += 1) {
			const built = draft({ pool, patternSet: pattern, count: 1, nonce });
			if (built.results[0]!.recipeId === "heavy") {
				heavy += 1;
			}
		}
		expect(heavy).toBeGreaterThan(180);
	});

	it("renormalizes Random over viable recipes only", async () => {
		// The sahen recipe carries most of the weight but has no candidate.
		const pattern = patternWith({
			recipes: [
				recipe({
					id: "sahen-only",
					label: "Sahen only",
					weight: 990,
					parts: [MODIFIER("m1", "sahen-basic"), NOUN("n1")],
				}),
				recipe({ id: "plain", label: "Plain", weight: 10, parts: [NOUN("n1")] }),
			],
		});
		const pool = await poolOf([noun("都市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 20, nonce: 2 });
		expect(built.results.every((result) => result.recipeId === "plain")).toBe(true);
	});

	it("lets Random use an enabled recipe that is not selectable", async () => {
		const pattern = patternWith({
			recipes: [
				recipe({
					id: "hidden",
					label: "Hidden",
					selectable: false,
					parts: [NOUN("n1")],
				}),
			],
		});
		const pool = await poolOf([noun("都市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 1, nonce: 4 });
		expect(built.results[0]!.recipeId).toBe("hidden");
		const viable = viableCollisionRecipes({ pool, patternSet: pattern });
		if (!viable.ok) {
			throw new Error(viable.reason);
		}
		// Reported, not applied: hiding it from a selector is presentation.
		expect(viable.recipes).toEqual([{ recipeId: "hidden", selectable: false }]);
	});

	it("never falls back from a fixed recipe that is not viable", async () => {
		const pattern = patternWith({
			recipes: [
				recipe({
					id: "sahen-only",
					label: "Sahen only",
					parts: [MODIFIER("m1", "sahen-basic"), NOUN("n1")],
				}),
				recipe({ id: "plain", label: "Plain", parts: [NOUN("n1")] }),
			],
		});
		const pool = await poolOf([noun("都市")], pattern);
		const built = draft({
			pool,
			patternSet: pattern,
			request: { kind: "fixed", recipeId: "sahen-only" },
			count: 5,
		});
		expect(built.status).toBe("insufficient");
		expect(built.shortfallReason).toBe("recipe-not-viable");
		expect(built.generatedCount).toBe(0);
		expect(built.results).toEqual([]);
	});

	it("refuses an unknown and a disabled fixed recipe with distinct reasons", async () => {
		const pattern = patternWith({
			recipes: [
				recipe({
					id: "off",
					label: "Off",
					enabled: false,
					selectable: false,
					parts: [NOUN("n1")],
				}),
				recipe({ id: "plain", label: "Plain", parts: [NOUN("n1")] }),
			],
		});
		const pool = await poolOf([noun("都市")], pattern);
		expect(
			draft({
				pool,
				patternSet: pattern,
				request: { kind: "fixed", recipeId: "nope" },
			}).shortfallReason,
		).toBe("recipe-unknown");
		expect(
			draft({
				pool,
				patternSet: pattern,
				request: { kind: "fixed", recipeId: "off" },
			}).shortfallReason,
		).toBe("recipe-disabled");
	});

	it("never draws a disabled recipe under Random", async () => {
		const pattern = patternWith({
			recipes: [
				recipe({
					id: "off",
					label: "Off",
					enabled: false,
					selectable: false,
					weight: 9999,
					parts: [NOUN("n1")],
				}),
				recipe({ id: "plain", label: "Plain", parts: [NOUN("n1"), NOUN("n2")] }),
			],
		});
		const pool = await poolOf([noun("都"), noun("市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 20, nonce: 6 });
		expect(built.results.every((result) => result.recipeId === "plain")).toBe(true);
		const viable = viableCollisionRecipes({ pool, patternSet: pattern });
		if (!viable.ok) {
			throw new Error(viable.reason);
		}
		expect(viable.recipes.map((entry) => entry.recipeId)).toEqual(["plain"]);
	});
});

// --- fallback --------------------------------------------------------------

describe("vocabulary fallback", () => {
	it("returns structured insufficient when there is no Noun", async () => {
		const pool = await poolOf([verb("眠る")]);
		expect(pool.nouns).toEqual([]);
		const built = draft({ pool, count: 10 });
		expect(built.status).toBe("insufficient");
		expect(built.shortfallReason).toBe("no-noun");
		expect(built.results).toEqual([]);
		expect(built.algorithmVersion).toBe(1);
	});

	it("repeats a single Noun across slots and marks the result limited", async () => {
		const pattern = patternWith({ recipes: [THREE_NOUNS] });
		const pool = await poolOf([noun("都市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 1, nonce: 8 });
		expect(built.results[0]!.text).toBe("都市都市都市");
		expect(built.results[0]!.limited).toBe(true);
		expect(built.results[0]!.limitedReason).toBe("noun-repeated");
	});

	it("uses every distinct Noun before repeating one inside a row", async () => {
		const pattern = patternWith({ recipes: [THREE_NOUNS] });
		for (const [tokens, distinct] of [
			[[noun("都"), noun("市"), noun("森")], 3],
			[[noun("都"), noun("市")], 2],
		] as const) {
			const pool = await poolOf(tokens, pattern);
			for (let nonce = 0; nonce < 40; nonce += 1) {
				const built = draft({ pool, patternSet: pattern, count: 1, nonce });
				const result = built.results[0]!;
				expect(new Set(result.text).size).toBe(distinct);
				expect(result.limited).toBe(distinct < 3);
			}
		}
	});

	it("keeps a recipe viable when every optional Modifier can be omitted", async () => {
		const pattern = patternWith({ recipes: [OPTIONAL_SAHEN] });
		const pool = await poolOf([noun("都"), noun("市"), noun("森")], pattern);
		expect(pool.modifiersByProfile["sahen-basic"]).toEqual([]);
		const built = draft({ pool, patternSet: pattern, count: 3, nonce: 12 });
		expect(built.status).toBe("complete");
		for (const result of built.results) {
			// The only surviving presence entry is the empty one, so the slot is
			// omitted rather than filled from another profile.
			expect(signatureParts(result.structureSignature).presence).toEqual([]);
			expect(signatureParts(result.structureSignature).forms).toEqual([]);
			expect(["都", "市", "森"]).toContain(result.text);
		}
	});

	it("drops a recipe whose required Modifier profile is empty", async () => {
		const pattern = patternWith({
			recipes: [
				recipe({
					id: "sahen-only",
					label: "Sahen only",
					parts: [MODIFIER("m1", "sahen-basic"), NOUN("n1")],
				}),
				recipe({ id: "plain", label: "Plain", parts: [NOUN("n1")] }),
			],
		});
		const withoutSahen = viableCollisionRecipes({
			pool: await poolOf([noun("都市")], pattern),
			patternSet: pattern,
		});
		const withSahen = viableCollisionRecipes({
			pool: await poolOf([noun("都市"), sahenNoun("変化")], pattern),
			patternSet: pattern,
		});
		if (!withoutSahen.ok || !withSahen.ok) {
			throw new Error("viability must resolve");
		}
		expect(withoutSahen.recipes.map((entry) => entry.recipeId)).toEqual(["plain"]);
		expect(withSahen.recipes.map((entry) => entry.recipeId).sort()).toEqual([
			"plain",
			"sahen-only",
		]);
	});

	it("drops a Predicate recipe when no regular verb basic form exists", async () => {
		const withoutVerb = await poolOf([noun("都市"), sahenNoun("変化")]);
		expect(withoutVerb.predicatesByProfile["regular-verb-basic"]).toEqual([]);
		const viable = viableCollisionRecipes({
			pool: withoutVerb,
			patternSet: STANDARD,
		});
		if (!viable.ok) {
			throw new Error(viable.reason);
		}
		expect(viable.recipes.map((entry) => entry.recipeId)).not.toContain("question");
		expect(
			draft({
				pool: withoutVerb,
				request: { kind: "fixed", recipeId: "question" },
			}).shortfallReason,
		).toBe("recipe-not-viable");
		// Random never produces it either.
		const built = draft({ pool: withoutVerb, count: 30, nonce: 15 });
		expect(built.results.every((result) => result.recipeId !== "question")).toBe(true);
	});

	it("drops the sahen recipe when no sahen candidate exists", async () => {
		const withoutSahen = await poolOf([noun("都市"), verb("眠る")]);
		expect(withoutSahen.modifiersByProfile["sahen-basic"]).toEqual([]);
		const built = draft({ pool: withoutSahen, count: 30, nonce: 16 });
		expect(built.results.every((result) => result.recipeId !== "sahen-noun")).toBe(
			true,
		);
	});

	it("reports no viable recipe when nothing can be built", async () => {
		const pattern = patternWith({
			recipes: [
				recipe({
					id: "sahen-only",
					label: "Sahen only",
					parts: [MODIFIER("m1", "sahen-basic"), NOUN("n1")],
				}),
			],
		});
		const pool = await poolOf([noun("都市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 10 });
		expect(built.status).toBe("insufficient");
		expect(built.shortfallReason).toBe("no-viable-recipe");
	});

	it("reports no-noun first, and an empty Modifier profile only with an empty pool", async () => {
		// Pattern Schema 2 requires at least one noun suffix, so any Noun makes at
		// least six Modifiers, and a regular verb or adjective makes Modifiers
		// without being a Noun. An empty `all` profile therefore needs a pool with
		// no Noun, verb or adjective at all — and then `no-noun` is reported first.
		const verbOnly = await poolOf([verb("眠る")]);
		expect(verbOnly.nouns).toEqual([]);
		expect(verbOnly.modifiersByProfile.all.length).toBeGreaterThan(0);
		expect(draft({ pool: verbOnly }).shortfallReason).toBe("no-noun");

		const nounOnly = await poolOf([noun("都市")]);
		expect(nounOnly.modifiersByProfile.all).toHaveLength(
			STANDARD_COLLISION_NOUN_SUFFIXES.length,
		);

		const nothing = await poolOf([
			tok("それ", { detail1: "代名詞" }),
			tok("を", { pos: "助詞", detail1: "格助詞" }),
		]);
		expect(nothing.nouns).toEqual([]);
		expect(nothing.modifiersByProfile.all).toEqual([]);
		expect(nothing.predicatesByProfile["regular-verb-basic"]).toEqual([]);
		expect(draft({ pool: nothing }).shortfallReason).toBe("no-noun");
	});
});

// --- retry and termination -------------------------------------------------

describe("bounded retry and termination", () => {
	it("refuses exact duplicates instead of padding the count", async () => {
		const pattern = patternWith({
			recipes: [NOUN_PAIR],
			connectors: EMPTY_CONNECTOR_ONLY,
		});
		const pool = await poolOf([noun("都市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 10, nonce: 17 });
		// One Noun and one structure: exactly one distinct text exists.
		expect(built.generatedCount).toBe(1);
		expect(built.results[0]!.text).toBe("都市都市");
		expect(built.status).toBe("partial");
		expect(built.shortfallReason).toBe("duplicate-exhausted");
		expect(new Set(built.results.map((result) => result.text)).size).toBe(1);
	});

	it("honours an avoid context of already committed texts", async () => {
		const pattern = patternWith({
			recipes: [NOUN_PAIR],
			connectors: EMPTY_CONNECTOR_ONLY,
		});
		const pool = await poolOf([noun("都市")], pattern);
		const built = draft({
			pool,
			patternSet: pattern,
			count: 3,
			nonce: 18,
			avoid: { texts: ["都市都市"], recentSignatures: [] },
		});
		expect(built.generatedCount).toBe(0);
		expect(built.status).toBe("insufficient");
		expect(built.shortfallReason).toBe("duplicate-exhausted");
	});

	it("avoids a third consecutive identical structure when another exists", async () => {
		const pattern = patternWith({
			recipes: [NOUN_PAIR],
			connectors: TWO_CONNECTORS,
		});
		const pool = await poolOf([noun("都"), noun("市"), noun("森"), noun("鏡")], pattern);
		const first = draft({ pool, patternSet: pattern, count: 1, nonce: 19 });
		const repeated = first.results[0]!.structureSignature;
		for (let nonce = 0; nonce < 40; nonce += 1) {
			const built = draft({
				pool,
				patternSet: pattern,
				count: 1,
				nonce,
				avoid: { texts: [], recentSignatures: [repeated, repeated] },
			});
			expect(built.results[0]!.structureSignature).not.toBe(repeated);
		}
	});

	it("holds identical-signature runs far below chance inside one generation", async () => {
		// Two equally weighted Connectors: without suppression a quarter of all
		// positions would complete a three-run. The rule is a bounded preference,
		// not a guarantee, so what is asserted is the reduction it makes.
		const pattern = patternWith({
			recipes: [NOUN_PAIR],
			connectors: TWO_CONNECTORS,
		});
		const pool = await poolOf([noun("都"), noun("市"), noun("森"), noun("鏡")], pattern);
		let positions = 0;
		let runs = 0;
		for (let nonce = 0; nonce < 60; nonce += 1) {
			const built = draft({ pool, patternSet: pattern, count: 12, nonce });
			const signatures = built.results.map((result) => result.structureSignature);
			expect(new Set(signatures).size).toBe(2);
			for (let index = 2; index < signatures.length; index += 1) {
				positions += 1;
				if (
					signatures[index] === signatures[index - 1] &&
					signatures[index] === signatures[index - 2]
				) {
					runs += 1;
				}
			}
		}
		expect(positions).toBeGreaterThan(400);
		expect(runs / positions).toBeLessThan(0.02);
	});

	it("terminates finitely when no alternative structure exists", async () => {
		const pattern = patternWith({
			recipes: [NOUN_PAIR],
			connectors: EMPTY_CONNECTOR_ONLY,
		});
		const pool = await poolOf([noun("都"), noun("市"), noun("森")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 6, nonce: 20 });
		const signatures = new Set(
			built.results.map((result) => result.structureSignature),
		);
		// Only one structure is possible, so the run rule yields after its
		// attempt budget rather than looping.
		expect(signatures.size).toBe(1);
		expect(built.generatedCount).toBeGreaterThan(2);
	});

	it("names its retry bounds as constants", () => {
		expect(COLLISION_RESULT_ATTEMPT_LIMIT).toBe(12);
		expect(COLLISION_SIGNATURE_ATTEMPT_LIMIT).toBe(6);
		expect(COLLISION_SIGNATURE_RUN_LIMIT).toBe(3);
		expect(COLLISION_SIGNATURE_ATTEMPT_LIMIT).toBeLessThan(
			COLLISION_RESULT_ATTEMPT_LIMIT,
		);
	});

	it("reports a shortfall with a fixed reason rather than throwing", async () => {
		const pattern = patternWith({
			recipes: [THREE_NOUNS],
			connectors: EMPTY_CONNECTOR_ONLY,
		});
		const pool = await poolOf([noun("都"), noun("市")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 50, nonce: 22 });
		expect(built.requestedCount).toBe(50);
		expect(built.generatedCount).toBeLessThan(50);
		expect(built.generatedCount).toBeGreaterThan(0);
		expect(built.status).toBe("partial");
		expect(built.shortfallReason).toBe("duplicate-exhausted");
	});
});

// --- structure signature ---------------------------------------------------

describe("the structure signature", () => {
	it("carries recipe, presence, Connector and Modifier form and no surface", async () => {
		const pool = await poolOf(RICH_TOKENS);
		const built = draft({
			pool,
			request: { kind: "fixed", recipeId: "noun-pair" },
			count: 12,
			nonce: 23,
		});
		for (const result of built.results) {
			const parts = signatureParts(result.structureSignature);
			expect(parts.recipeId).toBe("noun-pair");
			// noun-pair declares exactly one Connector slot.
			expect(parts.connectors).toHaveLength(1);
			expect(
				STANDARD.connectors.some((entry) => entry.id === parts.connectors[0]),
			).toBe(true);
			expect(parts.forms).toHaveLength(parts.presence.length);
			for (const surface of [...pool.nouns, ...pool.modifiers].map(
				(entry) => entry.surface,
			)) {
				expect(result.structureSignature).not.toContain(surface);
			}
		}
	});

	it("is equal for two results of the same shape and different words", async () => {
		const pattern = patternWith({
			recipes: [THREE_NOUNS],
			connectors: EMPTY_CONNECTOR_ONLY,
		});
		const pool = await poolOf([noun("都"), noun("市"), noun("森"), noun("鏡")], pattern);
		const built = draft({ pool, patternSet: pattern, count: 4, nonce: 24 });
		const signatures = new Set(
			built.results.map((result) => result.structureSignature),
		);
		const texts = new Set(built.results.map((result) => result.text));
		expect(signatures.size).toBe(1);
		expect(texts.size).toBe(built.generatedCount);
	});
});

// --- inputs, determinism and isolation -------------------------------------

const ISOLATION_POOL = await poolOf(RICH_TOKENS);

describe("inputs and isolation", () => {
	const pool = ISOLATION_POOL;

	function rejection(
		input: Parameters<typeof generateCollisionResults>[0],
	): string {
		const result = generateCollisionResults(input);
		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("expected a refusal");
		}
		expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
		const serialized = JSON.stringify(result);
		for (const secret of ["都市", "a.md", "眠る", "collision-core", "Error"]) {
			expect(serialized).not.toContain(secret);
		}
		return result.reason;
	}

	const base = {
		pool,
		patternSet: STANDARD,
		drawMode: "uniform" as VocabularyDrawMode,
		request: { kind: "random" } as CollisionRecipeRequest,
		count: 5,
		nonce: 3,
	};

	it("refuses a pattern set from another schema version or shape", () => {
		expect(
			rejection({ ...base, patternSet: { ...STANDARD, schemaVersion: 1 } }),
		).toBe("invalid-pattern-set");
		expect(
			rejection({
				...base,
				patternSet: { ...STANDARD, recipes: [...STANDARD.recipes] },
			}),
		).toBe("invalid-pattern-set");
		expect(
			rejection({
				...base,
				patternSet: { ...STANDARD, connectors: Object.freeze([]) },
			}),
		).toBe("invalid-pattern-set");
		expect(
			rejection({
				...base,
				patternSet: {
					...STANDARD,
					// Every literal reference is now dangling.
					literals: Object.freeze([]),
				},
			}),
		).toBe("invalid-pattern-set");
		expect(
			rejection({
				...base,
				patternSet: {
					...STANDARD,
					modifierForms: Object.freeze(STANDARD.modifierForms.slice(1)),
				},
			}),
		).toBe("invalid-pattern-set");
	});

	it("refuses an unfrozen or hand-built pool", () => {
		expect(rejection({ ...base, pool: { ...pool } })).toBe("invalid-pool");
		expect(
			rejection({ ...base, pool: { ...pool, nouns: [...pool.nouns] } }),
		).toBe("invalid-pool");
		expect(
			rejection({
				...base,
				pool: { ...pool, policyVersion: "collision-lexeme-0" },
			} as unknown as Parameters<typeof generateCollisionResults>[0]),
		).toBe("invalid-pool");
	});

	it("refuses a pattern set and pool that do not share provenance", () => {
		const other = compileCollisionPatternSet({
			schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
			dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION + 1,
			recipes: STANDARD_COLLISION_RECIPES,
			literals: STANDARD_COLLISION_LITERALS,
			connectors: STANDARD_COLLISION_CONNECTORS,
			modifierForms: STANDARD_COLLISION_MODIFIER_FORMS,
			nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES,
		});
		if (!other.ok) {
			throw new Error("the fixture must compile");
		}
		expect(rejection({ ...base, patternSet: other.set })).toBe(
			"provenance-mismatch",
		);
		// The pool was built for uniform; a frequency request is not its pool.
		expect(rejection({ ...base, drawMode: "frequency" })).toBe(
			"provenance-mismatch",
		);
	});

	it("refuses an out-of-range count, nonce, draw mode or request", () => {
		for (const count of [0, -1, 1.5, COLLISION_MAX_REQUESTED_COUNT + 1, Number.NaN]) {
			expect(rejection({ ...base, count })).toBe("invalid-request");
		}
		for (const nonce of [-1, 2 ** 32, 1.5, Number.NaN]) {
			expect(rejection({ ...base, nonce })).toBe("invalid-request");
		}
		expect(
			rejection({
				...base,
				drawMode: "weighted" as unknown as VocabularyDrawMode,
			}),
		).toBe("invalid-request");
		expect(
			rejection({
				...base,
				request: { kind: "fixed", recipeId: "" },
			}),
		).toBe("invalid-request");
		expect(
			rejection({
				...base,
				request: { kind: "nearest" } as unknown as CollisionRecipeRequest,
			}),
		).toBe("invalid-request");
		expect(
			rejection({
				...base,
				avoid: { texts: [1], recentSignatures: [] } as unknown as {
					texts: readonly string[];
					recentSignatures: readonly string[];
				},
			}),
		).toBe("invalid-request");
	});

	it("returns the same drafts for the same inputs and nonce", () => {
		const first = draft({ pool, count: 20, nonce: 1234 });
		const second = draft({ pool, count: 20, nonce: 1234 });
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		const other = draft({ pool, count: 20, nonce: 1235 });
		expect(JSON.stringify(other)).not.toBe(JSON.stringify(first));
	});

	it("shares no PRNG stream with Body generation", () => {
		const snapshot = snapshotOf(RICH_TOKENS);
		const body = () =>
			transformWithVocabularySnapshot({
				tokenSequences: [
					[{ tokenId: "run:0:token:0", token: noun("都市") }],
					[{ tokenId: "run:0:token:1", token: noun("庭") }],
				],
				snapshot,
				bodySeed: 4242,
				bodySemantropy: assertBodySemantropy(100),
				algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
			});
		const before = JSON.stringify(body().texts);
		// The same number used as a Collision nonce must not disturb Body.
		const collision = draft({ pool, count: 15, nonce: 4242 });
		const after = JSON.stringify(body().texts);
		expect(after).toBe(before);
		// And interleaving Body draws must not disturb Collision.
		body();
		expect(JSON.stringify(draft({ pool, count: 15, nonce: 4242 }))).toBe(
			JSON.stringify(collision),
		);
	});

	it("does not modify the pool or the pattern set", () => {
		const poolBefore = JSON.stringify(pool);
		const patternBefore = JSON.stringify(STANDARD);
		const avoid = { texts: ["都市の庭"], recentSignatures: ["x"] };
		draft({ pool, count: 20, nonce: 55, avoid });
		expect(JSON.stringify(pool)).toBe(poolBefore);
		expect(JSON.stringify(STANDARD)).toBe(patternBefore);
		expect(avoid.texts).toEqual(["都市の庭"]);
		expect(avoid.recentSignatures).toEqual(["x"]);
	});

	it("publishes a deeply frozen draft", () => {
		const built = draft({ pool, count: 4, nonce: 56 });
		expect(Object.isFrozen(built)).toBe(true);
		expect(Object.isFrozen(built.results)).toBe(true);
		expect(Object.isFrozen(built.results[0])).toBe(true);
		expect(() => {
			(built.results as unknown[]).push({});
		}).toThrow(TypeError);
		expect(() => {
			(built.results[0] as { text: string }).text = "x";
		}).toThrow(TypeError);
		expect(() => {
			(built as { generatedCount: number }).generatedCount = 0;
		}).toThrow(TypeError);
	});

	it("mints no batch, row or revision identity and no Collect metadata", () => {
		const built = draft({ pool, count: 3, nonce: 57 });
		expect(Object.keys(built).sort()).toEqual([
			"algorithmVersion",
			"generatedCount",
			"requestedCount",
			"results",
			"shortfallReason",
			"status",
		]);
		expect(Object.keys(built.results[0]!).sort()).toEqual([
			"limited",
			"limitedReason",
			"recipeId",
			"structureSignature",
			"text",
		]);
		const serialized = JSON.stringify(built);
		for (const forbidden of [
			"batchId",
			"rowId",
			"rowSlotId",
			"generationRevision",
			"metadataVersion",
			"nonce",
			"seed",
			"patternSetVersion",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it("carries Collision algorithm version 1 and changes no other version", () => {
		expect(COLLISION_ALGORITHM_VERSION).toBe(1);
		expect(draft({ pool, count: 1 }).algorithmVersion).toBe(1);
		expect(SEMANTROPY_ALGORITHM_VERSION).toBe(9);
		expect(MANUAL_MORPH_POLICY_VERSION).toBe("manual-morph-2");
		expect(FAKE_DICTIONARY_ALGORITHM_VERSION).toBe(1);
		expect(STANDARD_TEMPLATE_SET_VERSION).toBe(1);
		expect(SEMANTROPY_SETTINGS_SCHEMA_VERSION).toBe(3);
		expect(COLLECT_METADATA_VERSION).toBe(2);
		expect(COLLECTION_DOCUMENT_VERSION).toBe(1);
		expect(STANDARD_COLLISION_PATTERN_SCHEMA_VERSION).toBe(2);
		expect(STANDARD_COLLISION_PATTERN_DATA_VERSION).toBe(2);
	});

	it("performs no tokenization while generating", async () => {
		const run = [noun("都市"), verb("眠る"), sahenNoun("変化"), adjective("赤い")];
		const text = run.map((item) => item.surface).join("");
		const calls: string[] = [];
		const tokenizer: JapaneseTokenizer = {
			tokenize: (input) => {
				calls.push(input);
				if (input !== text) {
					throw new Error("unexpected run");
				}
				return Promise.resolve(run.map((item) => ({ ...item })));
			},
		};
		const analyzed = await analyzeManualMorphSource({
			text,
			sourcePath: "source.md",
			tokenizer,
		});
		if (analyzed.status !== "ready") {
			throw new Error(analyzed.status);
		}
		const vocabulary = buildManualMorphVocabulary({
			sources: [analyzed.analysis],
			drawMode: "uniform",
		});
		const analysisCalls = calls.length;
		expect(analysisCalls).toBeGreaterThan(0);

		// Building the pool and generating from it add no further tokenization:
		// the Source was analyzed once, when it entered.
		const built = buildAuthenticatedCollisionLexemePool({
			vocabulary,
			patternData: STANDARD,
		});
		if (!built.ok) {
			throw new Error(built.reason);
		}
		draft({ pool: built.pool, count: 20, nonce: 99 });
		draft({ pool: built.pool, count: 20, nonce: 100 });
		expect(calls.length).toBe(analysisCalls);
	});
});

// --- forged inputs (review P1) ---------------------------------------------

function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) {
			deepFreeze(child);
		}
		Object.freeze(value);
	}
	return value;
}

type Mutable = Record<string, unknown>;

/**
 * A deeply frozen pattern set built by hand from the standard one.
 *
 * The point of every case below is that freezing is not provenance: each forged
 * set is as frozen as a compiled one and still has to be refused.
 */
function forgeSet(
	mutate: (set: Mutable) => void,
): CompiledCollisionPatternSet {
	const clone = deepClone(STANDARD) as unknown as Mutable;
	mutate(clone);
	return deepFreeze(clone) as unknown as CompiledCollisionPatternSet;
}

const GENUINE_POOL = await poolOf(RICH_TOKENS);

/**
 * A deeply frozen pool built by hand from a genuine one.
 *
 * The profile maps are rebuilt from the cloned root arrays, because the builder
 * publishes them as views of those arrays rather than as separate copies.
 */
function forgePool(mutate: (pool: Mutable) => void): CollisionLexemePool {
	const clone = deepClone(GENUINE_POOL) as unknown as Mutable;
	const modifiers = clone["modifiers"] as { profiles: string[] }[];
	const predicates = clone["predicates"] as { profiles: string[] }[];
	clone["modifiersByProfile"] = {
		all: modifiers.filter((entry) => entry.profiles.includes("all")),
		"sahen-basic": modifiers.filter((entry) =>
			entry.profiles.includes("sahen-basic"),
		),
	};
	clone["predicatesByProfile"] = {
		"regular-verb-basic": predicates.filter((entry) =>
			entry.profiles.includes("regular-verb-basic"),
		),
	};
	mutate(clone);
	return deepFreeze(clone) as unknown as CollisionLexemePool;
}

/**
 * A forged pool is refused twice over, and the test says so explicitly.
 *
 * The mint would refuse every hand-built value on its own, which would make
 * each structural regression below pass for a reason that has nothing to do
 * with what it is testing. So each one also asserts that the structural
 * contract catches its particular forgery.
 */
function refuseForgedPool(pool: CollisionLexemePool): void {
	expect(inspectCollisionLexemePoolStructure(pool, STANDARD)).not.toBeNull();
	expect(refuse({ pool })).toBe("invalid-pool");
}

function refuse(input: {
	pool?: CollisionLexemePool;
	patternSet?: CompiledCollisionPatternSet;
}): string {
	const result = generateCollisionResults({
		pool: input.pool ?? GENUINE_POOL,
		patternSet: input.patternSet ?? STANDARD,
		drawMode: "uniform",
		request: { kind: "random" },
		count: 5,
		nonce: 3,
	});
	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new Error("expected a refusal");
	}
	expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
	return result.reason;
}

describe("forged pattern sets (review P1)", () => {
	it("accepts the unmutated clone, so a refusal below is the mutation", async () => {
		// A pool is bound to the pattern data it was built from, so the control
		// builds one from this very clone.
		const clone = forgeSet(() => undefined);
		const result = generateCollisionResults({
			pool: await poolOf(RICH_TOKENS, clone),
			patternSet: clone,
			drawMode: "uniform",
			request: { kind: "random" },
			count: 3,
			nonce: 3,
		});
		expect(result.ok).toBe(true);
	});

	it("refuses an unsafe Connector, literal or noun-suffix body", () => {
		for (const unsafe of ["${x}", "no", "{{x}}", "の の", "あ​"]) {
			expect(
				refuse({
					patternSet: forgeSet((set) => {
						const connectors = set["connectors"] as Mutable[];
						connectors[1]!["literal"] = unsafe;
					}),
				}),
			).toBe("invalid-pattern-set");
			expect(
				refuse({
					patternSet: forgeSet((set) => {
						const literals = set["literals"] as Mutable[];
						literals[0]!["literal"] = unsafe;
					}),
				}),
			).toBe("invalid-pattern-set");
			expect(
				refuse({
					patternSet: forgeSet((set) => {
						const suffixes = set["nounSuffixes"] as Mutable[];
						suffixes[0]!["literal"] = unsafe;
					}),
				}),
			).toBe("invalid-pattern-set");
		}
	});

	it("refuses an ID that breaks the grammar or repeats across categories", () => {
		for (const id of ["Bad_Id", "-lead", "trail-", "", "a--b", "noun-no"]) {
			expect(
				refuse({
					patternSet: forgeSet((set) => {
						const forms = set["modifierForms"] as Mutable[];
						forms[0]!["id"] = id;
					}),
				}),
			).toBe("invalid-pattern-set");
		}
		// A Connector reusing a recipe id is a global collision, not a local one.
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const connectors = set["connectors"] as Mutable[];
					connectors[0]!["id"] = "noun-pair";
				}),
			}),
		).toBe("invalid-pattern-set");
	});

	it("refuses a recipe that exceeds the part or kind limits", () => {
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const recipes = set["recipes"] as Mutable[];
					const plain = recipes.find((entry) => entry["id"] === "plain-pair")!;
					const parts = plain["parts"] as Mutable[];
					// Five Nouns: one past the per-kind limit of four.
					plain["parts"] = [
						...parts,
						{ kind: "noun", slotId: "n3", optional: false },
						{ kind: "noun", slotId: "n4", optional: false },
						{ kind: "noun", slotId: "n5", optional: false },
					];
				}),
			}),
		).toBe("invalid-pattern-set");
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const recipes = set["recipes"] as Mutable[];
					const plain = recipes.find((entry) => entry["id"] === "plain-pair")!;
					plain["parts"] = Array.from({ length: 13 }, (_unused, index) => ({
						kind: "noun",
						slotId: `n${index}`,
						optional: false,
					}));
				}),
			}),
		).toBe("invalid-pattern-set");
	});

	it("refuses a duplicate selectable label and a bad weight", () => {
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const recipes = set["recipes"] as Mutable[];
					recipes[1]!["label"] = recipes[0]!["label"];
				}),
			}),
		).toBe("invalid-pattern-set");
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const recipes = set["recipes"] as Mutable[];
					recipes[0]!["weight"] = 0;
				}),
			}),
		).toBe("invalid-pattern-set");
	});

	it("refuses duplicate Connector literals and a missing empty Connector", () => {
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const connectors = set["connectors"] as Mutable[];
					connectors[2]!["literal"] = connectors[1]!["literal"];
				}),
			}),
		).toBe("invalid-pattern-set");
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const connectors = set["connectors"] as Mutable[];
					set["connectors"] = connectors.filter(
						(entry) => entry["form"] !== "empty",
					);
				}),
			}),
		).toBe("invalid-pattern-set");
	});

	it("refuses a non-canonical or duplicated presence set", () => {
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const recipes = set["recipes"] as Mutable[];
					const pair = recipes.find((entry) => entry["id"] === "noun-pair")!;
					const presence = pair["presence"] as Mutable[];
					// The compiler canonicalizes presence slots in part order.
					presence[3]!["slots"] = ["m2", "m1"];
				}),
			}),
		).toBe("invalid-pattern-set");
		expect(
			refuse({
				patternSet: forgeSet((set) => {
					const recipes = set["recipes"] as Mutable[];
					const pair = recipes.find((entry) => entry["id"] === "noun-pair")!;
					const presence = pair["presence"] as Mutable[];
					presence[1]!["slots"] = [];
				}),
			}),
		).toBe("invalid-pattern-set");
	});

	it("refuses a mutable nested array even when every object is frozen", () => {
		const recipes = STANDARD.recipes.map((entry, index) =>
			index === 0
				? Object.freeze({ ...entry, parts: [...entry.parts] })
				: entry,
		);
		expect(
			refuse({
				patternSet: Object.freeze({
					...STANDARD,
					recipes: Object.freeze(recipes),
				}),
			}),
		).toBe("invalid-pattern-set");
	});
});

describe("forged pools (review P1)", () => {
	it("clones the pool faithfully, so a structural refusal below is the mutation", () => {
		// The unmutated clone satisfies the whole structural contract, which is
		// what makes each structural assertion below attributable to its own
		// mutation. It is nevertheless refused, because a clone is not a pool
		// this module produced — see the minting tests.
		const clone = forgePool(() => undefined);
		expect(inspectCollisionLexemePoolStructure(clone, STANDARD)).toBeNull();
		expect(refuse({ pool: clone })).toBe("invalid-pool");
	});

	it("refuses a hand-built pool with a surface but no provenance", () => {
		// The exact probe the independent review reported: a deeply frozen pool
		// whose only Noun carries a surface and a frequency and nothing else.
		const forged = deepFreeze({
			policyVersion: GENUINE_POOL.policyVersion,
			provenance: deepClone(GENUINE_POOL.provenance),
			nouns: [{ surface: "<script>", frequency: 1 }],
			modifiers: [],
			predicates: [],
			modifiersByProfile: { all: [], "sahen-basic": [] },
			predicatesByProfile: { "regular-verb-basic": [] },
		}) as unknown as CollisionLexemePool;
		expect(refuse({ pool: forged })).toBe("invalid-pool");
	});

	it("refuses a Noun whose candidates or origins were removed", () => {
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					nouns[0]!["candidates"] = [];
				}));
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					nouns[0]!["origins"] = [];
				}));
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					const references = nouns[0]!["candidates"] as Mutable[];
					references[0]!["candidateId"] = "";
				}));
	});

	it("refuses an aggregate its own records do not support", () => {
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					nouns[0]!["frequency"] = (nouns[0]!["frequency"] as number) + 7;
				}));
		refuseForgedPool(forgePool((pool) => {
					const modifiers = pool["modifiers"] as Mutable[];
					modifiers[0]!["frequency"] = (modifiers[0]!["frequency"] as number) + 7;
				}));
		refuseForgedPool(forgePool((pool) => {
					const modifiers = pool["modifiers"] as Mutable[];
					modifiers[0]!["origins"] = [
						{ path: "elsewhere.md", contentHash: "x", count: 1 },
					];
				}));
	});

	it("refuses a re-labelled variant, because the variant id binds it", () => {
		refuseForgedPool(forgePool((pool) => {
					const modifiers = pool["modifiers"] as Mutable[];
					const variants = modifiers[0]!["variants"] as Mutable[];
					// Claiming a sahen basic form without minting its id.
					variants[0]!["modifierClass"] = "sahen";
					variants[0]!["formVariant"] = "basic";
				}));
		refuseForgedPool(forgePool((pool) => {
					const modifiers = pool["modifiers"] as Mutable[];
					const variants = modifiers[0]!["variants"] as Mutable[];
					const base = variants[0]!["base"] as Mutable;
					base["displayFormId"] = "forged";
				}));
	});

	it("refuses an unsafe or non-canonical surface", () => {
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					nouns[0]!["surface"] = " leading";
				}));
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					// Descending order is not the canonical one.
					pool["nouns"] = [...nouns].reverse();
				}));
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					nouns[1]!["surface"] = nouns[0]!["surface"];
				}));
	});

	it("refuses a profile view that is not the projection of the root pool", () => {
		refuseForgedPool(forgePool((pool) => {
					const modifiers = pool["modifiers"] as Mutable[];
					const profiles = pool["modifiersByProfile"] as Mutable;
					// A candidate that is not in the root array at all.
					profiles["sahen-basic"] = [deepClone(modifiers[0])];
				}));
		refuseForgedPool(forgePool((pool) => {
					const profiles = pool["modifiersByProfile"] as Mutable;
					profiles["all"] = (profiles["all"] as unknown[]).slice(1);
				}));
		refuseForgedPool(forgePool((pool) => {
					const profiles = pool["predicatesByProfile"] as Mutable;
					profiles["regular-verb-basic"] = [];
				}));
		refuseForgedPool(forgePool((pool) => {
					const profiles = pool["modifiersByProfile"] as Mutable;
					profiles["extra"] = [];
				}));
	});

	it("refuses a mutable nested array even when every object is frozen", () => {
		const nouns = GENUINE_POOL.nouns.map((entry, index) =>
			index === 0
				? Object.freeze({ ...entry, origins: [...entry.origins] })
				: entry,
		);
		refuseForgedPool(Object.freeze({
					...GENUINE_POOL,
					nouns: Object.freeze(nouns),
				}));
	});

	it("refuses forged provenance", () => {
		for (const mutate of [
			(pool: Mutable) => {
				(pool["provenance"] as Mutable)["vocabularyFingerprint"] = "sha256:x";
			},
			(pool: Mutable) => {
				(pool["provenance"] as Mutable)["sources"] = [];
			},
			(pool: Mutable) => {
				(pool["provenance"] as Mutable)["collisionProjectionPolicyVersion"] =
					"collision-projection-0";
			},
		]) {
			expect(refuse({ pool: forgePool(mutate) })).toBe("invalid-pool");
		}
	});
});

describe("pool / pattern binding and origin provenance (review P1)", () => {
	function firstVariant(
		pool: Mutable,
		predicate: (variant: Mutable) => boolean,
	): { entry: Mutable; variant: Mutable } {
		for (const entry of pool["modifiers"] as Mutable[]) {
			for (const variant of entry["variants"] as Mutable[]) {
				if (predicate(variant)) {
					return { entry, variant };
				}
			}
		}
		throw new Error("no matching variant in the fixture pool");
	}

	it("refuses a variant that claims another schema form id", () => {
		// The reported probe: keep the basic-form surface and relabel only the
		// form id. CORE1 indexes by that id, so this would weight a basic form
		// with past-form weight and record it as past in the signature.
		refuseForgedPool(forgePool((pool) => {
					const { variant } = firstVariant(
						pool,
						(entry) =>
							entry["modifierClass"] === "verb" &&
							entry["formVariant"] === "basic",
					);
					variant["formId"] = "verb-past";
				}));

		// The same relabel with the variant id recomputed is still refused,
		// because the surface no longer follows from the declared form.
		refuseForgedPool(forgePool((pool) => {
					const { variant } = firstVariant(
						pool,
						(entry) =>
							entry["modifierClass"] === "verb" &&
							entry["formVariant"] === "basic",
					);
					variant["formVariant"] = "past";
					variant["formId"] = "verb-past";
					variant["variantId"] = JSON.stringify([
						"collision-lexeme-1",
						"verb",
						"past",
						(variant["base"] as Mutable)["displayFormId"],
					]);
				}));
	});

	it("refuses a sahen or na-adjective form whose tail is not the declared one", () => {
		refuseForgedPool(forgePool((pool) => {
					const { entry, variant } = firstVariant(
						pool,
						(item) =>
							item["modifierClass"] === "sahen" &&
							item["formVariant"] === "basic",
					);
					// する became した without the variant saying so.
					entry["surface"] = `${(variant["base"] as Mutable)["surface"] as string}した`;
				}));
		refuseForgedPool(forgePool((pool) => {
					const { entry } = firstVariant(
						pool,
						(item) => item["modifierClass"] === "na-adjective",
					);
					entry["surface"] = `${entry["surface"] as string}い`;
				}));
	});

	it("refuses a noun suffix surface that is not base plus that suffix literal", () => {
		// `都市の` changed to another safe surface that still starts with the
		// base and is longer: length and prefix alone never proved anything.
		refuseForgedPool(forgePool((pool) => {
					const { entry, variant } = firstVariant(
						pool,
						(item) => item["formId"] === "noun-no",
					);
					entry["surface"] = `${(variant["base"] as Mutable)["surface"] as string}猫`;
				}));
		// And a suffix id the pattern set does not declare.
		refuseForgedPool(forgePool((pool) => {
					const { variant } = firstVariant(
						pool,
						(item) => item["formId"] === "noun-no",
					);
					variant["formId"] = "noun-unknown";
					variant["variantId"] = JSON.stringify([
						"collision-lexeme-1",
						"noun-suffix",
						"noun-unknown",
						(variant["base"] as Mutable)["displayFormId"],
					]);
				}));
	});

	it("refuses an inflected surface the closed table does not produce", () => {
		for (const mutate of [
			// The evidence says one thing and the surface says another.
			(pool: Mutable) => {
				const { variant } = firstVariant(
					pool,
					(item) => item["modifierClass"] === "verb",
				);
				(variant["morphology"] as Mutable)["baseForm"] = "書く";
			},
			// A conjugation type the allowlist does not name.
			(pool: Mutable) => {
				const { variant } = firstVariant(
					pool,
					(item) => item["modifierClass"] === "verb",
				);
				(variant["morphology"] as Mutable)["conjugationType"] = "サ変・スル";
			},
			// Evidence removed entirely.
			(pool: Mutable) => {
				const { variant } = firstVariant(
					pool,
					(item) => item["modifierClass"] === "verb",
				);
				variant["morphology"] = null;
			},
			// A concatenating class must not carry inflection evidence.
			(pool: Mutable) => {
				const { variant } = firstVariant(
					pool,
					(item) => item["modifierClass"] === "sahen",
				);
				variant["morphology"] = { pos: "動詞", detail1: "自立", conjugationType: "一段", baseForm: "見る", surface: "見る", detail2: "*", detail3: "*", conjugationForm: "基本形", isUnknown: false };
			},
			// An イ-adjective surface that is not its recorded base form.
			(pool: Mutable) => {
				const { entry } = firstVariant(
					pool,
					(item) => item["modifierClass"] === "i-adjective",
				);
				entry["surface"] = "黒い";
			},
		]) {
			expect(refuse({ pool: forgePool(mutate) })).toBe("invalid-pool");
		}
	});

	it("refuses a Predicate surface the closed table does not produce", () => {
		refuseForgedPool(forgePool((pool) => {
					const predicates = pool["predicates"] as Mutable[];
					const variant = (predicates[0]!["variants"] as Mutable[])[0]!;
					(variant["morphology"] as Mutable)["baseForm"] = "書く";
				}));
		refuseForgedPool(forgePool((pool) => {
					const predicates = pool["predicates"] as Mutable[];
					const variant = (predicates[0]!["variants"] as Mutable[])[0]!;
					variant["morphology"] = null;
				}));
	});

	it("refuses a pool bound to different pattern data than the one supplied", () => {
		// Same versions, but a suffix id the pool's variants do not use.
		const renamed = compileCollisionPatternSet({
			schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
			dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION,
			recipes: STANDARD_COLLISION_RECIPES,
			literals: STANDARD_COLLISION_LITERALS,
			connectors: STANDARD_COLLISION_CONNECTORS,
			modifierForms: STANDARD_COLLISION_MODIFIER_FORMS,
			nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES.map((entry) =>
				entry.id === "noun-no" ? { ...entry, id: "noun-renamed" } : entry,
			),
		});
		if (!renamed.ok) {
			throw new Error("the fixture must compile");
		}
		expect(refuse({ patternSet: renamed.set })).toBe("invalid-pool");
	});

	it("refuses an origin naming a Source the pool does not record", () => {
		// Frequency and canonical order are preserved; only the Source changes.
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					const origins = nouns[0]!["origins"] as Mutable[];
					origins[0]!["path"] = "elsewhere.md";
				}));
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					const origins = nouns[0]!["origins"] as Mutable[];
					// The recorded path with a content hash that was never recorded.
					origins[0]!["contentHash"] = "hash-forged";
				}));
		refuseForgedPool(forgePool((pool) => {
					const { variant } = firstVariant(pool, () => true);
					const origins = (variant["base"] as Mutable)["origins"] as Mutable[];
					origins[0]!["path"] = "elsewhere.md";
				}));
		refuseForgedPool(forgePool((pool) => {
					const predicates = pool["predicates"] as Mutable[];
					const origins = predicates[0]!["origins"] as Mutable[];
					origins[0]!["path"] = "elsewhere.md";
				}));
	});

	it("refuses provenance sources that are duplicated or out of canonical order", () => {
		refuseForgedPool(forgePool((pool) => {
					const provenance = pool["provenance"] as Mutable;
					const sources = provenance["sources"] as Mutable[];
					provenance["sources"] = [...sources, { ...sources[0] }];
				}));
		refuseForgedPool(forgePool((pool) => {
					const provenance = pool["provenance"] as Mutable;
					const sources = provenance["sources"] as Mutable[];
					provenance["sources"] = [
						{ ...sources[0], path: "z.md" },
						{ ...sources[0] },
					];
				}));
	});
});

describe("derivation evidence bound to candidate identity (review P1)", () => {
	/**
	 * The reported probe. A Source containing only `見る` yields a pool whose
	 * verb lexeme is 見る. Rewriting the evidence to another verb and rewriting
	 * every surface to agree with it leaves the pool internally consistent — the
	 * inflection table reproduces all four forms and the Predicate — while
	 * `candidateId` and `origins` still name the 見る record from the real
	 * Source. That is how a word the Source never contained could be generated
	 * and attributed to it.
	 */
	async function forgeVerbLexeme(options: {
		readonly conjugationType: string;
		readonly baseForm: string;
		readonly forms: Readonly<Record<string, string>>;
		readonly keepCandidateId: boolean;
	}): Promise<CollisionLexemePool> {
		const pool = await poolOf([verb("見る", "一段")]);
		const clone = deepClone(pool) as unknown as Mutable;
		const morphology = {
			surface: options.baseForm,
			pos: "動詞",
			detail1: "自立",
			detail2: "*",
			detail3: "*",
			conjugationType: options.conjugationType,
			conjugationForm: "基本形",
			baseForm: options.baseForm,
			isUnknown: false,
		};
		const candidateId = options.keepCandidateId
			? null
			: vocabularyCandidateId(morphology);

		const rewrite = (entries: Mutable[]): void => {
			for (const entry of entries) {
				for (const variant of entry["variants"] as Mutable[]) {
					variant["morphology"] = { ...morphology };
					const base = variant["base"] as Mutable;
					if (candidateId !== null) {
						base["candidateId"] = candidateId;
						base["surface"] = options.baseForm;
						base["displayFormId"] = vocabularyDisplayFormId(
							candidateId,
							options.baseForm,
						);
						variant["variantId"] = JSON.stringify([
							"collision-lexeme-1",
							variant["predicateClass"] === "regular-verb"
								? "regular-verb"
								: (variant["modifierClass"] as string),
							variant["formVariant"] as string,
							base["displayFormId"],
						]);
					}
					const formVariant = variant["formVariant"] as string;
					entry["surface"] = options.forms[formVariant]!;
					if (candidateId !== null) {
						entry["candidates"] = [
							{ candidateId, displayFormId: base["displayFormId"] },
						];
					}
				}
			}
			entries.sort((a, b) =>
				(a["surface"] as string) < (b["surface"] as string) ? -1 : 1,
			);
		};
		rewrite(clone["modifiers"] as Mutable[]);
		rewrite(clone["predicates"] as Mutable[]);

		const modifiers = clone["modifiers"] as { profiles: string[] }[];
		const predicates = clone["predicates"] as { profiles: string[] }[];
		clone["modifiersByProfile"] = {
			all: modifiers.filter((entry) => entry.profiles.includes("all")),
			"sahen-basic": modifiers.filter((entry) =>
				entry.profiles.includes("sahen-basic"),
			),
		};
		clone["predicatesByProfile"] = {
			"regular-verb-basic": predicates.filter((entry) =>
				entry.profiles.includes("regular-verb-basic"),
			),
		};
		return deepFreeze(clone) as unknown as CollisionLexemePool;
	}

	const KAKU = {
		conjugationType: "五段・カ行イ音便",
		baseForm: "書く",
		forms: {
			basic: "書く",
			past: "書いた",
			progressive: "書いている",
			negative: "書かない",
		},
	};

	it("accepts the untouched 見る pool, so a refusal below is the forgery", async () => {
		const pool = await poolOf([verb("見る", "一段")]);
		expect(inspectCollisionLexemePool(pool, STANDARD)).toBeNull();
		expect(pool.predicates.map((entry) => entry.surface)).toEqual(["見る"]);
	});

	it("refuses evidence that names a different word than the record it is on", async () => {
		const forged = await forgeVerbLexeme({ ...KAKU, keepCandidateId: true });
		// Internally consistent: the closed table really does produce these.
		expect(forged.modifiers.map((entry) => entry.surface).sort()).toEqual(
			Object.values(KAKU.forms).sort(),
		);
		// But the candidate identity still describes 見る, so it is refused and
		// nothing is generated from it.
		expect(inspectCollisionLexemePool(forged, STANDARD)).not.toBeNull();
		expect(refuse({ pool: forged })).toBe("invalid-pool");
	});

	it("refuses the same forgery for a Predicate", async () => {
		const forged = await forgeVerbLexeme({ ...KAKU, keepCandidateId: true });
		expect(forged.predicates.map((entry) => entry.surface)).toEqual(["書く"]);
		expect(refuse({ pool: forged })).toBe("invalid-pool");
	});

	it("refuses the same forgery for an イ-adjective", async () => {
		const pool = await poolOf([adjective("赤い")]);
		const forged = deepFreeze(
			((): Mutable => {
				const clone = deepClone(pool) as unknown as Mutable;
				const entry = (clone["modifiers"] as Mutable[])[0]!;
				const variant = (entry["variants"] as Mutable[])[0]!;
				variant["morphology"] = {
					surface: "青い",
					pos: "形容詞",
					detail1: "自立",
					detail2: "*",
					detail3: "*",
					conjugationType: "形容詞・アウオ段",
					conjugationForm: "基本形",
					baseForm: "青い",
					isUnknown: false,
				};
				entry["surface"] = "青い";
				clone["modifiersByProfile"] = {
					all: clone["modifiers"],
					"sahen-basic": [],
				};
				return clone;
			})(),
		) as unknown as CollisionLexemePool;
		expect(refuse({ pool: forged })).toBe("invalid-pool");
	});

	it("refuses the forgery even when every other field is realigned to it", async () => {
		// The strongest form of the probe: the base surface, display form,
		// variant ids and candidate references are all rewritten to agree with
		// the new evidence, so every other invariant holds. Only `candidateId`
		// still describes 見る — and that alone is enough to refuse, which is
		// what makes the evidence bound to the vocabulary rather than merely
		// self-consistent.
		const pool = await poolOf([verb("見る", "一段")]);
		const clone = deepClone(pool) as unknown as Mutable;
		const morphology = {
			surface: "書く",
			pos: "動詞",
			detail1: "自立",
			detail2: "*",
			detail3: "*",
			conjugationType: "五段・カ行イ音便",
			conjugationForm: "基本形",
			baseForm: "書く",
			isUnknown: false,
		};
		const realign = (entries: Mutable[]): void => {
			for (const entry of entries) {
				for (const variant of entry["variants"] as Mutable[]) {
					const base = variant["base"] as Mutable;
					variant["morphology"] = { ...morphology };
					base["surface"] = "書く";
					base["displayFormId"] = vocabularyDisplayFormId(
						base["candidateId"] as string,
						"書く",
					);
					variant["variantId"] = JSON.stringify([
						"collision-lexeme-1",
						variant["predicateClass"] === "regular-verb"
							? "regular-verb"
							: (variant["modifierClass"] as string),
						variant["formVariant"] as string,
						base["displayFormId"],
					]);
					entry["surface"] = (KAKU.forms as Record<string, string>)[
						variant["formVariant"] as string
					]!;
					entry["candidates"] = [
						{
							candidateId: base["candidateId"],
							displayFormId: base["displayFormId"],
						},
					];
				}
			}
			entries.sort((a, b) =>
				(a["surface"] as string) < (b["surface"] as string) ? -1 : 1,
			);
		};
		realign(clone["modifiers"] as Mutable[]);
		realign(clone["predicates"] as Mutable[]);
		clone["modifiersByProfile"] = {
			all: clone["modifiers"],
			"sahen-basic": [],
		};
		clone["predicatesByProfile"] = {
			"regular-verb-basic": clone["predicates"],
		};
		const forged = deepFreeze(clone) as unknown as CollisionLexemePool;
		expect(inspectCollisionLexemePool(forged, STANDARD)).not.toBeNull();
		expect(refuse({ pool: forged })).toBe("invalid-pool");
	});

	it("refuses a display form that was not minted from its own identity", () => {
		refuseForgedPool(forgePool((pool) => {
					const entry = (pool["modifiers"] as Mutable[])[0]!;
					const variant = (entry["variants"] as Mutable[])[0]!;
					const base = variant["base"] as Mutable;
					// Only the display form moves; the variant id and the entry's
					// references are recomputed so nothing else disagrees.
					base["displayFormId"] = vocabularyDisplayFormId(
						base["candidateId"] as string,
						"別",
					);
					variant["variantId"] = JSON.stringify([
						"collision-lexeme-1",
						variant["modifierClass"] as string,
						variant["modifierClass"] === "noun-suffix"
							? (variant["formId"] as string)
							: (variant["formVariant"] as string),
						base["displayFormId"],
					]);
					entry["candidates"] = [
						{
							candidateId: base["candidateId"],
							displayFormId: base["displayFormId"],
						},
					];
				}));
	});

	it("refuses a wholly self-consistent forgery, because structure is not provenance", async () => {
		// The same rewrite with the identity moved too describes 書く with no
		// internal disagreement at all: every identity is re-minted from the new
		// evidence, so the structural contract is satisfied.
		const consistent = await forgeVerbLexeme({ ...KAKU, keepCandidateId: false });
		expect(inspectCollisionLexemePoolStructure(consistent, STANDARD)).toBeNull();

		// And it is still refused. `vocabularyCandidateId()` is a public,
		// deterministic function, so a self-consistent identity is reproducible
		// by anyone; only the builder's own record says where a pool came from.
		expect(inspectCollisionLexemePool(consistent, STANDARD)).toBe("not-minted");
		expect(refuse({ pool: consistent })).toBe("invalid-pool");
	});

	it("refuses a base whose display form does not follow from its identity", () => {
		refuseForgedPool(forgePool((pool) => {
					const { variant } = ((): { variant: Mutable } => {
						const entry = (pool["modifiers"] as Mutable[])[0]!;
						return { variant: (entry["variants"] as Mutable[])[0]! };
					})();
					(variant["base"] as Mutable)["surface"] = "別";
				}));
		refuseForgedPool(forgePool((pool) => {
					const nouns = pool["nouns"] as Mutable[];
					const references = nouns[0]!["candidates"] as Mutable[];
					// A reference minted for another surface.
					references[0]!["displayFormId"] = vocabularyDisplayFormId(
						references[0]!["candidateId"] as string,
						"別",
					);
				}));
	});
});

describe("pool provenance is minted, not inferred (review P1)", () => {
	it("accepts only the object the builder actually produced", async () => {
		const pool = await poolOf(RICH_TOKENS);
		expect(inspectCollisionLexemePool(pool, STANDARD)).toBeNull();

		// A faithful deep clone is a different value with the same content, and
		// the structural contract cannot tell them apart. The record of origin
		// can, and that is the whole point. (`forgePool` rebuilds the profile
		// views, which a raw clone would otherwise break.)
		const clone = forgePool(() => undefined);
		expect(inspectCollisionLexemePoolStructure(clone, STANDARD)).toBeNull();
		expect(inspectCollisionLexemePool(clone, STANDARD)).toBe("not-minted");
	});

	it("binds a minted pool to the pattern data it was built from", async () => {
		const other = patternWith({
			nounSuffixes: nounSuffixesWith({ "noun-no": 7 }),
		});
		const pool = await poolOf(RICH_TOKENS, STANDARD);
		expect(inspectCollisionLexemePool(pool, STANDARD)).toBeNull();
		// Same versions and a valid set, but not the one this pool was built
		// from, so its form ids were never promised against it.
		expect(inspectCollisionLexemePool(pool, other)).toBe(
			"invalid-pattern-binding",
		);
		expect(refuse({ pool, patternSet: other })).toBe("invalid-pool");
	});

	it("refuses the reported probe: a word the Source never contained", async () => {
		// The Source is 都市 / 猫 / 海 / 見る. The forgery rewrites 見る into 書く
		// and re-mints every identity, display form, variant id and reference so
		// that nothing disagrees — the shape the previous round's check passed.
		const source = [noun("都市"), noun("猫"), noun("海"), verb("見る", "一段")];
		const pool = await poolOf(source);
		const clone = deepClone(pool) as unknown as Mutable;
		const morphology = {
			surface: "書く",
			pos: "動詞",
			detail1: "自立",
			detail2: "*",
			detail3: "*",
			conjugationType: "五段・カ行イ音便",
			conjugationForm: "基本形",
			baseForm: "書く",
			isUnknown: false,
		};
		const candidateId = vocabularyCandidateId(morphology);
		const displayFormId = vocabularyDisplayFormId(candidateId, "書く");
		const forms: Record<string, string> = {
			basic: "書く",
			past: "書いた",
			progressive: "書いている",
			negative: "書かない",
		};
		const rewrite = (entries: Mutable[]): void => {
			for (const entry of entries) {
				let touched = false;
				for (const variant of entry["variants"] as Mutable[]) {
					if (variant["morphology"] === null) {
						continue;
					}
					touched = true;
					variant["morphology"] = { ...morphology };
					const base = variant["base"] as Mutable;
					base["candidateId"] = candidateId;
					base["displayFormId"] = displayFormId;
					base["surface"] = "書く";
					variant["variantId"] = JSON.stringify([
						"collision-lexeme-1",
						variant["predicateClass"] === "regular-verb"
							? "regular-verb"
							: (variant["modifierClass"] as string),
						variant["formVariant"] as string,
						displayFormId,
					]);
					entry["surface"] = forms[variant["formVariant"] as string]!;
					entry["candidates"] = [{ candidateId, displayFormId }];
				}
				if (!touched) {
					continue;
				}
			}
			entries.sort((a, b) =>
				(a["surface"] as string) < (b["surface"] as string) ? -1 : 1,
			);
		};
		rewrite(clone["modifiers"] as Mutable[]);
		rewrite(clone["predicates"] as Mutable[]);
		const modifiers = clone["modifiers"] as { profiles: string[] }[];
		const predicates = clone["predicates"] as { profiles: string[] }[];
		clone["modifiersByProfile"] = {
			all: modifiers.filter((entry) => entry.profiles.includes("all")),
			"sahen-basic": modifiers.filter((entry) =>
				entry.profiles.includes("sahen-basic"),
			),
		};
		clone["predicatesByProfile"] = {
			"regular-verb-basic": predicates.filter((entry) =>
				entry.profiles.includes("regular-verb-basic"),
			),
		};
		const forged = deepFreeze(clone) as unknown as CollisionLexemePool;

		// The forgery is internally consistent and keeps the real fingerprint
		// and origins, which is exactly why structure alone cannot refuse it.
		expect(forged.provenance.vocabularyFingerprint).toBe(
			pool.provenance.vocabularyFingerprint,
		);
		expect(forged.predicates.map((entry) => entry.surface)).toEqual(["書く"]);

		expect(inspectCollisionLexemePool(forged, STANDARD)).toBe("not-minted");
		expect(refuse({ pool: forged })).toBe("invalid-pool");
	});

	it("refuses a real verb candidate injected into the Noun array", async () => {
		// The Noun entries carry no morphology, so nothing structural decides
		// that a record is a Noun rather than a verb. Origin does.
		const pool = await poolOf([noun("都市"), verb("見る", "一段")]);
		const clone = deepClone(pool) as unknown as Mutable;
		const variant = (
			(clone["predicates"] as Mutable[])[0]!["variants"] as Mutable[]
		)[0]!;
		const base = variant["base"] as Mutable;
		const nouns = clone["nouns"] as Mutable[];
		nouns.push({
			surface: base["surface"],
			frequency: base["frequency"],
			origins: deepClone(base["origins"]),
			candidates: [
				{
					candidateId: base["candidateId"],
					displayFormId: base["displayFormId"],
				},
			],
		});
		nouns.sort((a, b) =>
			(a["surface"] as string) < (b["surface"] as string) ? -1 : 1,
		);
		const injected = deepFreeze(clone) as unknown as CollisionLexemePool;
		expect(injected.nouns.map((entry) => entry.surface)).toContain("見る");
		expect(inspectCollisionLexemePool(injected, STANDARD)).toBe("not-minted");
		expect(refuse({ pool: injected })).toBe("invalid-pool");
	});

	it("refuses a pool built from a Snapshot that was not analyzed", async () => {
		// The reported probe. A genuine Snapshot is cloned and only its Manual
		// projection is rewritten — 見る becomes 書く — while the fingerprint,
		// the Source list and every origin stay as the real analysis left them.
		// The pure builder happily makes a pool from it, and that pool satisfies
		// the whole structural contract. Only where the Snapshot came from
		// separates it from a real one, and a value cannot answer that about
		// itself.
		const run = [noun("都市"), noun("猫"), noun("海"), verb("見る", "一段")];
		const text = run.map((item) => item.surface).join("");
		const analyzed = await analyzeManualMorphSource({
			text,
			sourcePath: "a.md",
			tokenizer: tableTokenizer(text, run),
		});
		if (analyzed.status !== "ready") {
			throw new Error(analyzed.status);
		}
		const vocabulary = buildManualMorphVocabulary({
			sources: [analyzed.analysis],
			drawMode: "uniform",
		});

		const forgedToken = {
			surface: "書く",
			pos: "動詞",
			detail1: "自立",
			detail2: "*",
			detail3: "*",
			conjugationType: "五段・カ行イ音便",
			conjugationForm: "基本形",
			baseForm: "書く",
			isUnknown: false,
		};
		const candidateId = vocabularyCandidateId(forgedToken);
		const snapshot = vocabulary.snapshot;
		const clone = deepClone(snapshot) as unknown as Mutable;
		const projections = clone["projections"] as Mutable;
		const manual = projections["manual"] as Mutable;
		manual["candidates"] = (manual["candidates"] as Mutable[]).map((candidate) =>
			candidate["surface"] === "見る"
				? {
						...candidate,
						candidateId,
						displayFormId: vocabularyDisplayFormId(candidateId, "書く"),
						surface: "書く",
						morphology: { ...forgedToken },
					}
				: candidate,
		);
		const rewritten = deepFreeze(clone) as unknown as VocabularySnapshot;

		// The fingerprint and Sources are exactly what the real analysis left.
		expect(rewritten.fingerprint).toBe(snapshot.fingerprint);

		// The pure builder has no opinion about Snapshot origin, so it builds.
		const pure = buildCollisionLexemePool({
			snapshot: rewritten,
			patternData: STANDARD,
		});
		if (!pure.ok) {
			throw new Error(pure.reason);
		}
		expect(pure.pool.predicates.map((entry) => entry.surface)).toEqual(["書く"]);
		expect(pure.pool.provenance.vocabularyFingerprint).toBe(
			snapshot.fingerprint,
		);
		expect(inspectCollisionLexemePoolStructure(pure.pool, STANDARD)).toBeNull();

		// And it is still refused, because that Snapshot never came from an
		// analysis this product performed.
		expect(inspectCollisionLexemePool(pure.pool, STANDARD)).toBe("not-minted");
		expect(refuse({ pool: pure.pool })).toBe("invalid-pool");
	});

	it("refuses a hand-built or cloned vocabulary handle", async () => {
		const run = [noun("都市"), verb("眠る", "五段・ラ行")];
		const text = run.map((item) => item.surface).join("");
		const analyzed = await analyzeManualMorphSource({
			text,
			sourcePath: "a.md",
			tokenizer: tableTokenizer(text, run),
		});
		if (analyzed.status !== "ready") {
			throw new Error(analyzed.status);
		}
		const vocabulary = buildManualMorphVocabulary({
			sources: [analyzed.analysis],
			drawMode: "uniform",
		});
		// The genuine handle works.
		expect(
			buildAuthenticatedCollisionLexemePool({
				vocabulary,
				patternData: STANDARD,
			}).ok,
		).toBe(true);
		// A spread copy carries the same Snapshot and evidence and is still not
		// the handle this product minted, so no pool is produced from it.
		const copied = buildAuthenticatedCollisionLexemePool({
			vocabulary: { ...vocabulary },
			patternData: STANDARD,
		});
		expect(copied).toEqual({ ok: false, reason: "invalid-vocabulary" });
	});

	it("fails closed for malformed authenticated-builder envelopes", () => {
		for (const malformed of [
			null,
			undefined,
			new Proxy(
				{},
				{
					get: () => {
						throw new Error("must not escape");
					},
				},
			),
		]) {
			expect(
				buildAuthenticatedCollisionLexemePool(
					malformed as Parameters<
						typeof buildAuthenticatedCollisionLexemePool
					>[0],
				),
			).toEqual({ ok: false, reason: "invalid-vocabulary" });
		}
	});

	it("keeps both halves load-bearing", async () => {
		// Minting cannot catch a builder defect, and structure cannot catch a
		// forgery. Each regression above relies on one of them, so neither is
		// decorative.
		const pool = await poolOf(RICH_TOKENS);
		const broken = forgePool((value) => {
			const nouns = value["nouns"] as Mutable[];
			nouns[0]!["frequency"] = (nouns[0]!["frequency"] as number) + 1;
		});
		expect(inspectCollisionLexemePoolStructure(pool, STANDARD)).toBeNull();
		expect(inspectCollisionLexemePoolStructure(broken, STANDARD)).not.toBeNull();
		expect(inspectCollisionLexemePool(broken, STANDARD)).toBe("not-minted");
	});
});

describe("shared provenance pre-check (review P2)", () => {
	const otherVersion = (() => {
		const compiledOther = compileCollisionPatternSet({
			schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
			dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION + 1,
			recipes: STANDARD_COLLISION_RECIPES,
			literals: STANDARD_COLLISION_LITERALS,
			connectors: STANDARD_COLLISION_CONNECTORS,
			modifierForms: STANDARD_COLLISION_MODIFIER_FORMS,
			nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES,
		});
		if (!compiledOther.ok) {
			throw new Error("the fixture must compile");
		}
		return compiledOther.set;
	})();

	it("reports provenance-mismatch from both public entry points", () => {
		const generated = generateCollisionResults({
			pool: GENUINE_POOL,
			patternSet: otherVersion,
			drawMode: "uniform",
			request: { kind: "random" },
			count: 5,
			nonce: 3,
		});
		expect(generated).toEqual({ ok: false, reason: "provenance-mismatch" });

		// The viable listing answers the same question, so it must answer it the
		// same way rather than calling the pool invalid.
		const viable = viableCollisionRecipes({
			pool: GENUINE_POOL,
			patternSet: otherVersion,
		});
		expect(viable).toEqual({ ok: false, reason: "provenance-mismatch" });
	});

	it("still refuses a genuinely invalid pool from both entry points", () => {
		const forged = forgePool((pool) => {
			const nouns = pool["nouns"] as Mutable[];
			nouns[0]!["candidates"] = [];
		});
		expect(refuse({ pool: forged })).toBe("invalid-pool");
		expect(
			viableCollisionRecipes({ pool: forged, patternSet: STANDARD }),
		).toEqual({ ok: false, reason: "invalid-pool" });
	});
});

// --- performance -----------------------------------------------------------

describe("performance on a realistic pool", () => {
	it("generates 10, 20 and 50 results well inside one interaction", async () => {
		const tokens: JapaneseToken[] = [];
		for (let index = 0; index < 1200; index += 1) {
			tokens.push(noun(`名詞${index}`));
		}
		for (let index = 0; index < 200; index += 1) {
			tokens.push(sahenNoun(`変化${index}`));
			tokens.push(naStem(`静か${index}`));
			tokens.push(verb(`眠${index}る`));
			tokens.push(adjective(`赤${index}い`));
		}
		const pool = await poolOf(tokens);
		expect(pool.nouns.length).toBe(1600);
		expect(pool.modifiers.length).toBeGreaterThan(9000);
		for (const count of [10, 20, 50]) {
			const started = performance.now();
			const built = draft({ pool, count, nonce: count });
			const elapsed = performance.now() - started;
			expect(built.generatedCount).toBe(count);
			expect(built.status).toBe("complete");
			expect(elapsed).toBeLessThan(2000);
		}
	});
});
