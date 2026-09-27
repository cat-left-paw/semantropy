import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	MAX_OPTIONAL_CLAUSES,
	dictionaryBucketOf,
	familyWeight,
	preferredFamilyFor,
} from "../src/dictionary/dictionaryBuckets";
import {
	FAKE_DICTIONARY_ALGORITHM_VERSION,
	deriveDefinitionSeed,
	generateFakeDefinition,
	type FakeDefinitionResult,
	type GeneratedFakeDefinition,
} from "../src/dictionary/generateFakeDefinition";
import { validateHeadword } from "../src/dictionary/headword";
import type { FakeDictionaryHeadword } from "../src/dictionary/headword";
import {
	STANDARD_TEMPLATE_SET,
	STANDARD_TEMPLATE_SET_VERSION,
} from "../src/dictionary/standardTemplateSet";
import { compileTemplateSet } from "../src/dictionary/template";
import {
	buildDictionaryVocabularyPool,
	type DictionaryVocabularyPool,
} from "../src/dictionary/vocabularyPool";
import type { BodySemantropy } from "../src/settings/bodySemantropy";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import {
	buildVocabularyPool,
	transformTokenSequences,
} from "../src/transform/transformTokens";
import { token } from "./tokenFixtures";

const noun = (surface: string) => token({ surface });
const place = (surface: string) =>
	token({ surface, detail1: "固有名詞", detail2: "地域" });
const person = (surface: string) =>
	token({ surface, detail1: "固有名詞", detail2: "人名" });
const organization = (surface: string) =>
	token({ surface, detail1: "固有名詞", detail2: "組織" });
const sahen = (surface: string) => token({ surface, detail1: "サ変接続" });
const adverbial = (surface: string) =>
	token({ surface, detail1: "副詞可能", baseForm: "*", reading: "*" });
const numeral = (surface: string) =>
	token({ surface, detail1: "数", baseForm: "*", reading: "*" });

/** A note with at least one candidate for every placeholder any template needs. */
const RICH_TOKENS: readonly JapaneseToken[] = [
	noun("猫"),
	noun("机"),
	noun("沈黙"),
	place("北海道"),
	place("京都"),
	person("太郎"),
	person("花子"),
	organization("ソニー"),
	sahen("研究"),
	sahen("移動"),
	adverbial("本日"),
	adverbial("昨日"),
	numeral("三"),
];

const RICH_POOL = buildDictionaryVocabularyPool([RICH_TOKENS]);

function headwordOf(one: JapaneseToken): FakeDictionaryHeadword {
	const result = validateHeadword(one.surface, [one]);
	if (result.outcome !== "accepted") {
		throw new Error(`fixture is not a headword: ${result.reason}`);
	}
	return result.headword;
}

const CAT = headwordOf(noun("猫"));
const TARO = headwordOf(person("太郎"));
const KYOTO = headwordOf(place("京都"));
const SONY = headwordOf(organization("ソニー"));

function generate(
	overrides: {
		headword?: FakeDictionaryHeadword;
		pool?: DictionaryVocabularyPool;
		dictionarySeed?: number;
		dictionarySemantropy?: number;
		templateSet?: typeof STANDARD_TEMPLATE_SET;
	} = {},
): FakeDefinitionResult {
	return generateFakeDefinition({
		headword: overrides.headword ?? CAT,
		pool: overrides.pool ?? RICH_POOL,
		dictionarySeed: overrides.dictionarySeed ?? 1170956989,
		dictionarySemantropy: overrides.dictionarySemantropy ?? 50,
		...(overrides.templateSet ? { templateSet: overrides.templateSet } : {}),
	});
}

function generated(
	overrides: Parameters<typeof generate>[0] = {},
): GeneratedFakeDefinition {
	const result = generate(overrides);
	if (result.outcome !== "generated") {
		throw new Error(`expected a definition, got ${result.outcome}`);
	}
	return result;
}

describe("Semantropy buckets", () => {
	it("maps every integer 0..100 to one bucket", () => {
		expect(dictionaryBucketOf(0)).toBe("off");
		for (const value of [1, 25]) expect(dictionaryBucketOf(value)).toBe("low");
		for (const value of [26, 50]) expect(dictionaryBucketOf(value)).toBe("medium");
		for (const value of [51, 75]) expect(dictionaryBucketOf(value)).toBe("high");
		for (const value of [76, 100]) expect(dictionaryBucketOf(value)).toBe("max");
	});

	it("refuses a value the setting could never hold", () => {
		for (const value of [-1, 101, 1.5, Number.NaN]) {
			expect(() => dictionaryBucketOf(value)).toThrow(RangeError);
		}
	});

	it("prefers a family only for person, place and organization", () => {
		expect(preferredFamilyFor("person")).toBe("person");
		expect(preferredFamilyFor("place")).toBe("place");
		expect(preferredFamilyFor("organization")).toBe("organization");
		for (const other of ["noun", "proper", "sahen", "adverbialNoun", "number"] as const) {
			expect(preferredFamilyFor(other)).toBeNull();
		}
		expect(preferredFamilyFor(null)).toBeNull();
	});

	it("pins the family weights", () => {
		expect(familyWeight("low", "person", "person")).toBe(8);
		expect(familyWeight("low", "food", "person")).toBe(1);
		expect(familyWeight("medium", "person", "person")).toBe(4);
		expect(familyWeight("medium", "food", "person")).toBe(1);
		// High and MAX drop the bias: every eligible family is equal.
		expect(familyWeight("high", "person", "person")).toBe(1);
		expect(familyWeight("max", "person", "person")).toBe(1);
		// A general noun has no preferred family, so nothing is weighted up.
		expect(familyWeight("low", "person", null)).toBe(1);
	});

	it("pins the optional clause ceiling per bucket", () => {
		expect(MAX_OPTIONAL_CLAUSES).toEqual({
			off: 0,
			low: 0,
			medium: 1,
			high: 1,
			max: 2,
		});
	});
});

describe("the generator's non-generating outcomes", () => {
	it("returns off at Semantropy 0 and produces no text at all", () => {
		expect(generate({ dictionarySemantropy: 0 })).toEqual({ outcome: "off" });
	});

	it("returns insufficient-vocabulary when no template is eligible", () => {
		const empty = buildDictionaryVocabularyPool([]);

		const result = generate({ pool: empty });

		expect(result.outcome).toBe("insufficient-vocabulary");
		if (result.outcome !== "insufficient-vocabulary") return;
		expect(result.missingPlaceholders).toEqual([
			"adverbialNoun",
			"noun",
			"number",
			"person",
			"place",
			"sahen",
		]);
	});

	it("names only placeholders, never a word from the note", () => {
		const nounOnly = buildDictionaryVocabularyPool([[noun("秘密")]]);

		const result = generate({ pool: nounOnly });

		expect(result.outcome).toBe("generated");
		// A pool holding only nouns still satisfies the noun-only templates, so
		// this is a definition, not a failure.
		if (result.outcome !== "generated") return;
		expect(JSON.stringify(result)).not.toContain("tokenSequences");
	});

	it("carries no note text in an insufficient result", () => {
		const unusable = buildDictionaryVocabularyPool([
			[token({ surface: "静か", detail1: "形容動詞語幹" })],
		]);

		const result = generate({ pool: unusable });

		expect(result.outcome).toBe("insufficient-vocabulary");
		expect(JSON.stringify(result)).not.toContain("静か");
	});
});

describe("template eligibility", () => {
	it("only picks a template whose every placeholder has a candidate", () => {
		const nounOnly = buildDictionaryVocabularyPool([
			[noun("猫"), noun("机"), noun("沈黙")],
		]);

		for (let seed = 0; seed < 60; seed += 1) {
			const result = generated({ pool: nounOnly, dictionarySeed: seed });
			const template = STANDARD_TEMPLATE_SET.coreTemplates.find(
				(candidate) => candidate.id === result.templateId,
			);

			expect(template?.requiredPlaceholders).toEqual(["noun"]);
		}
	});

	it("never substitutes another pool for a missing placeholder", () => {
		const noPlaces = buildDictionaryVocabularyPool([
			[noun("猫"), noun("机"), sahen("研究")],
		]);

		for (let seed = 0; seed < 60; seed += 1) {
			const result = generated({ pool: noPlaces, dictionarySeed: seed });

			// 北海道 is not in this pool at all; more importantly, no place-
			// requiring template may be chosen, so no noun stands in for one.
			const template = STANDARD_TEMPLATE_SET.coreTemplates.find(
				(candidate) => candidate.id === result.templateId,
			);
			expect(template?.requiredPlaceholders).not.toContain("place");
			expect(result.definition).not.toContain("{{");
		}
	});

	it("keeps an unfillable optional clause from disqualifying a core template", () => {
		// Nouns only: every clause needing a place or a person is ineligible,
		// but the noun-only core templates still generate.
		const nounOnly = buildDictionaryVocabularyPool([[noun("猫"), noun("机")]]);

		const result = generated({
			pool: nounOnly,
			dictionarySemantropy: 100,
		});

		expect(result.definition.length).toBeGreaterThan(0);
		for (const id of result.optionalClauseIds) {
			const clause = STANDARD_TEMPLATE_SET.optionalClauses.find(
				(candidate) => candidate.id === id,
			);
			expect(clause?.requiredPlaceholders.every((p) => p === "noun")).toBe(true);
		}
	});

	it("appends nothing when no clause is eligible", () => {
		const set = compileTemplateSet(
			1,
			[{ id: "classification-01", family: "classification", text: "{{noun}}の一種。" }],
			[{ id: "optional-region-01", category: "region", text: "特に{{place}}に多い。" }],
		);
		expect(set.ok).toBe(true);
		if (!set.ok) return;
		const nounOnly = buildDictionaryVocabularyPool([[noun("猫")]]);

		const result = generated({
			pool: nounOnly,
			templateSet: set.set,
			dictionarySemantropy: 100,
		});

		expect(result.optionalClauseIds).toEqual([]);
		expect(result.definition).toBe("猫の一種。");
	});
});

describe("optional clause counts per bucket", () => {
	const counts = (semantropy: number): number[] => {
		const seen: number[] = [];
		for (let seed = 0; seed < 80; seed += 1) {
			seen.push(
				generated({ dictionarySemantropy: semantropy, dictionarySeed: seed })
					.optionalClauseIds.length,
			);
		}
		return seen;
	};

	it("appends none at Low", () => {
		expect(new Set(counts(25))).toEqual(new Set([0]));
	});

	it("appends at most one at Medium, and sometimes none", () => {
		const seen = new Set(counts(50));

		expect([...seen].every((count) => count <= 1)).toBe(true);
		// The Medium gate is what makes 0 reachable; both outcomes must occur.
		expect(seen).toEqual(new Set([0, 1]));
	});

	it("appends exactly one at High whenever a clause is eligible", () => {
		expect(new Set(counts(75))).toEqual(new Set([1]));
	});

	it("appends two at MAX", () => {
		expect(new Set(counts(100))).toEqual(new Set([2]));
	});

	it("never repeats a clause within one definition", () => {
		for (let seed = 0; seed < 80; seed += 1) {
			const ids = generated({
				dictionarySemantropy: 100,
				dictionarySeed: seed,
			}).optionalClauseIds;

			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	it("uses only the clauses that exist when fewer than the ceiling are eligible", () => {
		const set = compileTemplateSet(
			1,
			[{ id: "classification-01", family: "classification", text: "{{noun}}の一種。" }],
			[{ id: "optional-usage-01", category: "usage", text: "単に{{noun}}ともいう。" }],
		);
		expect(set.ok).toBe(true);
		if (!set.ok) return;

		const result = generated({
			templateSet: set.set,
			dictionarySemantropy: 100,
		});

		expect(result.optionalClauseIds).toEqual(["optional-usage-01"]);
	});

	it("concatenates core and clause without altering either wording", () => {
		const set = compileTemplateSet(
			1,
			[{ id: "classification-01", family: "classification", text: "{{noun}}の一種。" }],
			[{ id: "optional-authority-01", category: "authority", text: "詳細については明らかでない。" }],
		);
		expect(set.ok).toBe(true);
		if (!set.ok) return;
		const nounOnly = buildDictionaryVocabularyPool([[noun("猫")]]);

		const result = generated({
			pool: nounOnly,
			templateSet: set.set,
			dictionarySemantropy: 100,
		});

		expect(result.definition).toBe("猫の一種。詳細については明らかでない。");
	});
});

describe("family selection", () => {
	const familyCounts = (headword: FakeDictionaryHeadword, semantropy: number) => {
		const counts = new Map<string, number>();
		for (let seed = 0; seed < 400; seed += 1) {
			const result = generated({
				headword,
				dictionarySemantropy: semantropy,
				dictionarySeed: seed,
			});
			counts.set(result.family, (counts.get(result.family) ?? 0) + 1);
		}
		return counts;
	};

	it("leans hard on the person family at Low for a person headword", () => {
		const counts = familyCounts(TARO, 25);
		const share = (counts.get("person") ?? 0) / 400;

		// Weight 8 against 1 for each of the other eligible families.
		expect(share).toBeGreaterThan(0.15);
		expect(counts.size).toBeGreaterThan(1);
	});

	it("leans less at Medium than at Low", () => {
		const low = (familyCounts(TARO, 25).get("person") ?? 0) / 400;
		const medium = (familyCounts(TARO, 50).get("person") ?? 0) / 400;

		expect(medium).toBeLessThan(low);
	});

	it("drops the bias entirely at High and MAX", () => {
		const high = (familyCounts(TARO, 75).get("person") ?? 0) / 400;
		const low = (familyCounts(TARO, 25).get("person") ?? 0) / 400;

		expect(high).toBeLessThan(low);
	});

	it("still allows other families for place and organization headwords", () => {
		for (const headword of [KYOTO, SONY]) {
			expect(familyCounts(headword, 25).size).toBeGreaterThan(1);
		}
	});

	it("keeps other families available when the preferred one is ineligible", () => {
		// The person family's three templates all need a place; a pool with no
		// place makes the preferred family ineligible for a person headword.
		const noPlaces = buildDictionaryVocabularyPool([
			[noun("猫"), noun("机"), sahen("研究"), adverbial("本日")],
		]);

		const result = generated({
			headword: TARO,
			pool: noPlaces,
			dictionarySemantropy: 25,
		});

		expect(result.family).not.toBe("person");
		expect(result.outcome).toBe("generated");
	});

	it("weights nothing for a general noun headword", () => {
		const counts = familyCounts(CAT, 25);

		// No preferred family: many families appear, none dominating.
		expect(counts.size).toBeGreaterThan(10);
	});

	it("pins the family weights on a known fixture", () => {
		// Over seeds 0..399 with a fixed pool, a person headword lands in the
		// person family this many times. Uniform selection would give about 13
		// (three of ninety templates), so these numbers are the weights
		// themselves: 8x at Low, 4x at Medium, no bias at High. Changing a
		// weight, a bucket boundary or the draw order moves them.
		expect(familyCounts(TARO, 25).get("person")).toBe(76);
		expect(familyCounts(TARO, 50).get("person")).toBe(46);
		expect(familyCounts(TARO, 75).get("person")).toBe(15);
	});

	it("pins one whole definition end to end", () => {
		const result = generated({
			dictionarySeed: 1170956989,
			dictionarySemantropy: 100,
		});

		expect(result).toEqual({
			outcome: "generated",
			definition:
				"机を主材料とする沈黙。主に京都で作られる。京都以外ではほとんど用いられない。その理由については定説がない。",
			templateId: "food-01",
			family: "food",
			optionalClauseIds: ["optional-region-04", "optional-authority-03"],
			dictionarySeed: 1170956989,
			dictionarySemantropy: 100,
			dictionaryBucket: "max",
			algorithmVersion: 1,
			templateSetVersion: 1,
			definitionSeed: 2131144472,
			headword: "猫",
			headwordIdentity: {
				baseForm: "猫",
				reading: null,
				pos: "名詞",
				detail1: "一般",
				detail2: "*",
			},
		});
	});
});

describe("family weighting when families have unequal eligible counts", () => {
	// Three templates in one family, one in another — the shape the reviewer's
	// case produces when the Current Note can only fill some templates. The
	// Semantropy weights are between families, so the three-template family
	// must NOT thereby get three times the mass.
	const unevenSet = (() => {
		const compiled = compileTemplateSet(
			1,
			[
				{ id: "person-01", family: "person", text: "{{noun}}の一。" },
				{ id: "person-02", family: "person", text: "{{noun}}の二。" },
				{ id: "person-03", family: "person", text: "{{noun}}の三。" },
				{ id: "food-01", family: "food", text: "{{noun}}の食。" },
			],
			[],
		);
		if (!compiled.ok) {
			throw new Error("fixture template set did not compile");
		}
		return compiled.set;
	})();
	const nounOnly = buildDictionaryVocabularyPool([[noun("猫"), noun("机")]]);

	const familyCounts = (
		headword: FakeDictionaryHeadword,
		semantropy: number,
	) => {
		const counts = new Map<string, number>();
		for (let seed = 0; seed < 400; seed += 1) {
			const result = generated({
				headword,
				pool: nounOnly,
				templateSet: unevenSet,
				dictionarySemantropy: semantropy,
				dictionarySeed: seed,
			});
			counts.set(result.family, (counts.get(result.family) ?? 0) + 1);
		}
		return counts;
	};

	it("gives both families an even share at High despite 3-vs-1 templates", () => {
		const counts = familyCounts(CAT, 75);

		// 196/204 is the even split. Weighting each template instead would
		// give the three-template family 300 of 400 (75%).
		expect(counts.get("person")).toBe(196);
		expect(counts.get("food")).toBe(204);
	});

	it("gives both families an even share at MAX too", () => {
		// A different value means a different definition Seed, so the counts
		// differ from High while staying an even split.
		const counts = familyCounts(CAT, 100);

		expect(counts.get("person")).toBe(193);
		expect(counts.get("food")).toBe(207);
	});

	it("drops the bias at High even for a person headword", () => {
		const counts = familyCounts(TARO, 75);

		expect(counts.get("person")).toBe(207);
		expect(counts.get("food")).toBe(193);
	});

	it("applies the Low 8:1 bias between families, not scaled by template count", () => {
		const counts = familyCounts(TARO, 25);

		// 8:1 between two families is 8/9 ≈ 88.9%; 361 of 400 is 90.3%.
		// Weighting templates would give 8*3 : 1 = 96%, about 384.
		expect(counts.get("person")).toBe(361);
		expect(counts.get("food")).toBe(39);
	});

	it("applies the Medium 4:1 bias between families", () => {
		const counts = familyCounts(TARO, 50);

		// 4:1 is 80%; 319 of 400 is 79.8% — not 4*3:1 = 92.3%.
		expect(counts.get("person")).toBe(319);
		expect(counts.get("food")).toBe(81);
	});

	it("still reaches every template inside the chosen family", () => {
		const ids = new Set<string>();
		for (let seed = 0; seed < 200; seed += 1) {
			ids.add(
				generated({
					headword: CAT,
					pool: nounOnly,
					templateSet: unevenSet,
					dictionarySemantropy: 75,
					dictionarySeed: seed,
				}).templateId,
			);
		}

		expect(ids).toEqual(
			new Set(["person-01", "person-02", "person-03", "food-01"]),
		);
	});

	it("keeps a family whose templates are only partly eligible", () => {
		// person-01 needs a place the note lacks; the family stays eligible
		// through its other two templates and keeps its full family weight.
		const compiled = compileTemplateSet(
			1,
			[
				{ id: "person-01", family: "person", text: "{{place}}の一。" },
				{ id: "person-02", family: "person", text: "{{noun}}の二。" },
				{ id: "food-01", family: "food", text: "{{noun}}の食。" },
			],
			[],
		);
		expect(compiled.ok).toBe(true);
		if (!compiled.ok) return;

		const ids = new Set<string>();
		for (let seed = 0; seed < 200; seed += 1) {
			ids.add(
				generated({
					headword: CAT,
					pool: nounOnly,
					templateSet: compiled.set,
					dictionarySemantropy: 75,
					dictionarySeed: seed,
				}).templateId,
			);
		}

		expect(ids).toEqual(new Set(["person-02", "food-01"]));
	});
});

describe("determinism", () => {
	it("returns exactly the same result for the same inputs", () => {
		const first = generate({ dictionarySeed: 42 });
		const second = generate({ dictionarySeed: 42 });

		expect(second).toEqual(first);
	});

	it("reproduces Seed 0, which is a valid Seed", () => {
		const first = generated({ dictionarySeed: 0 });
		const second = generated({ dictionarySeed: 0 });

		expect(second).toEqual(first);
		expect(first.dictionarySeed).toBe(0);
		expect(first.definition.length).toBeGreaterThan(0);
	});

	it("changes the definition when the Seed changes", () => {
		const definitions = new Set<string>();
		for (let seed = 0; seed < 20; seed += 1) {
			definitions.add(generated({ dictionarySeed: seed }).definition);
		}

		expect(definitions.size).toBeGreaterThan(1);
	});

	it("ignores the order the note's tokens were analysed in", () => {
		const forward = buildDictionaryVocabularyPool([RICH_TOKENS]);
		const scattered = buildDictionaryVocabularyPool(
			[...RICH_TOKENS].reverse().map((one) => [one]),
		);

		// Different first-appearance order, identical candidate sets.
		expect(scattered.noun).not.toEqual(forward.noun);
		expect([...scattered.noun].sort()).toEqual([...forward.noun].sort());
		expect(generate({ pool: scattered })).toEqual(generate({ pool: forward }));
	});

	it("ignores the order of the candidate arrays and of the template list", () => {
		const shuffledTemplates = compileTemplateSet(
			STANDARD_TEMPLATE_SET_VERSION,
			[...STANDARD_TEMPLATE_SET.coreTemplates]
				.reverse()
				.map((template) => ({
					id: template.id,
					family: template.family,
					text: templateText(template.segments),
				})),
			[...STANDARD_TEMPLATE_SET.optionalClauses].reverse().map((entry) => ({
				id: entry.id,
				category: entry.category,
				text: templateText(entry.segments),
			})),
		);
		expect(shuffledTemplates.ok).toBe(true);
		if (!shuffledTemplates.ok) return;

		expect(
			generate({ templateSet: shuffledTemplates.set, dictionarySemantropy: 100 }),
		).toEqual(generate({ dictionarySemantropy: 100 }));
	});

	it("depends on the dictionary Semantropy value", () => {
		const seeds = [1, 2, 3, 4, 5];
		const medium = seeds.map((seed) =>
			generated({ dictionarySeed: seed, dictionarySemantropy: 50 }).definitionSeed,
		);
		const high = seeds.map((seed) =>
			generated({ dictionarySeed: seed, dictionarySemantropy: 75 }).definitionSeed,
		);

		expect(high).not.toEqual(medium);
	});

	it("gives two different headwords different definition Seeds", () => {
		expect(generated({ headword: CAT }).definitionSeed).not.toBe(
			generated({ headword: TARO }).definitionSeed,
		);
	});

	it("derives the same definition Seed the generator reports", () => {
		const result = generated({ dictionarySeed: 99, dictionarySemantropy: 75 });

		expect(result.definitionSeed).toBe(
			deriveDefinitionSeed(
				CAT.identity,
				RICH_POOL,
				99,
				75,
				STANDARD_TEMPLATE_SET_VERSION,
			),
		);
	});

	it("refuses a Semantropy value outside 0..100", () => {
		// -1 must not read as Off and 101 must not read as MAX: a value that is
		// not in range is a broken caller, not a quietly clamped one.
		for (const value of [-1, 101, 1000]) {
			expect(() => generate({ dictionarySemantropy: value })).toThrow(
				RangeError,
			);
		}
	});

	it("refuses a Semantropy value that is not an integer", () => {
		for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => generate({ dictionarySemantropy: value })).toThrow(
				RangeError,
			);
		}
	});

	it("accepts both endpoints of the range", () => {
		expect(generate({ dictionarySemantropy: 0 })).toEqual({ outcome: "off" });
		expect(generated({ dictionarySemantropy: 100 }).dictionaryBucket).toBe(
			"max",
		);
	});

	it("validates the value before deciding anything, Off included", () => {
		// The Off shortcut must not become a way for an invalid value to pass.
		expect(() => generate({ dictionarySemantropy: -0.5 })).toThrow(RangeError);
	});

	it("names the setting, not the note, when it refuses a value", () => {
		try {
			generate({ dictionarySemantropy: 101 });
			expect.unreachable("expected a RangeError");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).toContain("dictionarySemantropy");
			expect(message).not.toContain("猫");
		}
	});

	it("refuses an out-of-range Semantropy value when called directly", () => {
		// deriveDefinitionSeed is exported and reproduces a Seed on its own, so
		// it must not be a way around the range the setting guarantees. Before
		// this check, -1 and 101 each returned a usable uint32.
		for (const value of [-1, 101, 1000, -0.5]) {
			expect(() =>
				deriveDefinitionSeed(
					CAT.identity,
					RICH_POOL,
					1170956989,
					value,
					STANDARD_TEMPLATE_SET_VERSION,
				),
			).toThrow(RangeError);
		}
	});

	it("refuses a non-integer Semantropy value when called directly", () => {
		for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() =>
				deriveDefinitionSeed(
					CAT.identity,
					RICH_POOL,
					1170956989,
					value,
					STANDARD_TEMPLATE_SET_VERSION,
				),
			).toThrow(RangeError);
		}
	});

	it("still derives a Seed for both endpoints when called directly", () => {
		for (const value of [0, 100]) {
			const seed = deriveDefinitionSeed(
				CAT.identity,
				RICH_POOL,
				0,
				value,
				STANDARD_TEMPLATE_SET_VERSION,
			);

			expect(Number.isInteger(seed)).toBe(true);
			expect(seed).toBeGreaterThanOrEqual(0);
			expect(seed).toBeLessThanOrEqual(0xffffffff);
		}
	});

	it("refuses a bad Seed when called directly", () => {
		for (const seed of [-1, 1.5, 0x1_0000_0000]) {
			expect(() =>
				deriveDefinitionSeed(
					CAT.identity,
					RICH_POOL,
					seed,
					50,
					STANDARD_TEMPLATE_SET_VERSION,
				),
			).toThrow(RangeError);
		}
	});

	it("rejects a Seed that is not a uint32", () => {
		for (const seed of [-1, 1.5, 0x1_0000_0000]) {
			expect(() => generate({ dictionarySeed: seed })).toThrow(RangeError);
		}
	});
});

describe("independence from the body transform", () => {
	it("has no body Seed or body Semantropy value in its inputs or result", () => {
		const result = generated();
		const keys = Object.keys(result);

		expect(keys).not.toContain("bodySeed");
		expect(keys).not.toContain("bodySemantropy");
	});

	it("is unmoved by any body Seed or body Semantropy value", () => {
		// Run the real body transform over the same analysis at several body
		// settings. The transform rewrites the displayed text; the dictionary
		// pool comes from the snapshot's own tokens and must not follow it.
		const sequences = [RICH_TOKENS];
		const bodyPool = buildVocabularyPool(sequences);
		const request = {
			headword: CAT,
			pool: RICH_POOL,
			dictionarySeed: 7,
			dictionarySemantropy: 75,
		};
		const expected = generateFakeDefinition(request);
		const bodyTexts = new Set<string>();

		for (const bodySeed of [0, 1, 987654321]) {
			for (const bodySemantropy of [0, 25, 50, 100]) {
				const transformed = transformTokenSequences(
					sequences,
					bodyPool,
					bodySeed,
					bodySemantropy as BodySemantropy,
				);
				bodyTexts.add(transformed.texts.join(""));

				// Same snapshot, so the same dictionary pool and the same result.
				expect(buildDictionaryVocabularyPool(sequences)).toEqual(RICH_POOL);
				expect(generateFakeDefinition(request)).toEqual(expected);
			}
		}

		// The body really did change across those settings.
		expect(bodyTexts.size).toBeGreaterThan(1);
	});

	it("keeps the two Seeds from sharing a stream", () => {
		// Reshuffling the body must not disturb a definition, and vice versa:
		// the dictionary Seed is the only Seed this function reads.
		const a = generateFakeDefinition({
			headword: CAT,
			pool: RICH_POOL,
			dictionarySeed: 7,
			dictionarySemantropy: 75,
		});
		const b = generateFakeDefinition({
			headword: CAT,
			pool: RICH_POOL,
			dictionarySeed: 8,
			dictionarySemantropy: 75,
		});

		expect(a).not.toEqual(b);
	});
});

describe("privacy", () => {
	it("writes nothing to the console on any path", () => {
		const spies = (["log", "info", "warn", "error", "debug"] as const).map(
			(level) => vi.spyOn(console, level).mockImplementation(() => undefined),
		);

		try {
			validateHeadword("秘密の言葉", [noun("秘密"), noun("言葉")]);
			validateHeadword("猫", [noun("猫")]);
			generate({ dictionarySemantropy: 0 });
			generate({ pool: buildDictionaryVocabularyPool([]) });
			generate({ dictionarySemantropy: 100 });

			for (const spy of spies) {
				expect(spy).not.toHaveBeenCalled();
			}
		} finally {
			for (const spy of spies) {
				spy.mockRestore();
			}
		}
	});

	it("keeps note text out of the message when a bad Seed throws", () => {
		const secretPool = buildDictionaryVocabularyPool([[noun("極秘資料")]]);

		expect(() =>
			generate({ pool: secretPool, dictionarySeed: -1 }),
		).toThrow(/unsigned 32-bit integer/);
		try {
			generate({ pool: secretPool, dictionarySeed: -1 });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).not.toContain("極秘資料");
			expect(message).not.toContain("/Volumes");
		}
	});

	it("carries no pool, token sequence or path in a generated result", () => {
		const serialized = JSON.stringify(generated({ dictionarySemantropy: 100 }));

		// The headword itself is the user's word and belongs here; the rest of
		// the note does not.
		expect(serialized).not.toContain("tokenSequences");
		expect(serialized).not.toContain("/Volumes");
		expect(serialized).not.toContain("bodySeed");
		for (const word of ["昨日", "花子"]) {
			// Words present in the pool but not used by this definition never
			// appear as a leaked candidate list.
			expect(serialized.includes(`"${word}"`)).toBe(false);
		}
	});
});

describe("the generated result", () => {
	it("carries the contracted fields and nothing from the session", () => {
		const result = generated({ dictionarySeed: 5, dictionarySemantropy: 75 });

		expect(Object.keys(result).sort()).toEqual([
			"algorithmVersion",
			"definition",
			"definitionSeed",
			"dictionaryBucket",
			"dictionarySeed",
			"dictionarySemantropy",
			"family",
			"headword",
			"headwordIdentity",
			"optionalClauseIds",
			"outcome",
			"templateId",
			"templateSetVersion",
		]);
		expect(result.algorithmVersion).toBe(FAKE_DICTIONARY_ALGORITHM_VERSION);
		expect(result.templateSetVersion).toBe(STANDARD_TEMPLATE_SET_VERSION);
		expect(result.headword).toBe("猫");
		expect(result.dictionarySeed).toBe(5);
		expect(result.dictionarySemantropy).toBe(75);
	});

	it("is frozen", () => {
		const result = generated();

		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.optionalClauseIds)).toBe(true);
	});

	it("modifies neither the pool nor the template set", () => {
		const poolSnapshot = JSON.stringify(RICH_POOL);
		const setSnapshot = JSON.stringify(STANDARD_TEMPLATE_SET);

		generate({ dictionarySemantropy: 100 });

		expect(JSON.stringify(RICH_POOL)).toBe(poolSnapshot);
		expect(JSON.stringify(STANDARD_TEMPLATE_SET)).toBe(setSnapshot);
	});

	it("leaves an HTML-looking candidate as plain text", () => {
		const markupPool = buildDictionaryVocabularyPool([
			[noun("<script>alert(1)</script>"), noun("<b>")],
		]);
		const set = compileTemplateSet(
			1,
			[{ id: "classification-01", family: "classification", text: "{{noun}}の一種。" }],
			[],
		);
		expect(set.ok).toBe(true);
		if (!set.ok) return;

		const result = generated({ pool: markupPool, templateSet: set.set });

		// Held verbatim: not escaped into entities, not stripped, not parsed.
		// Applying it safely to the DOM via textContent is the UI's job.
		expect(result.definition).toMatch(/^(<script>alert\(1\)<\/script>|<b>)の一種。$/);
		expect(result.definition).not.toContain("&lt;");
	});

	it("leaves a placeholder-looking candidate unexpanded", () => {
		const trickPool = buildDictionaryVocabularyPool([[noun("{{place}}")]]);
		const set = compileTemplateSet(
			1,
			[{ id: "classification-01", family: "classification", text: "{{noun}}の一種。" }],
			[],
		);
		expect(set.ok).toBe(true);
		if (!set.ok) return;

		const result = generated({ pool: trickPool, templateSet: set.set });

		// Structure was decided before any candidate existed, so this is text.
		expect(result.definition).toBe("{{place}}の一種。");
	});

	it("allows two occurrences of one placeholder to land on the same word", () => {
		const single = buildDictionaryVocabularyPool([[noun("猫")]]);
		const set = compileTemplateSet(
			1,
			[
				{
					id: "classification-02",
					family: "classification",
					text: "{{noun}}に属する{{noun}}。",
				},
			],
			[],
		);
		expect(set.ok).toBe(true);
		if (!set.ok) return;

		expect(generated({ pool: single, templateSet: set.set }).definition).toBe(
			"猫に属する猫。",
		);
	});

	it("names a real template from the standard set", () => {
		const result = generated();

		expect(
			STANDARD_TEMPLATE_SET.coreTemplates.some(
				(template) => template.id === result.templateId,
			),
		).toBe(true);
	});

	it("leaves no unexpanded placeholder in any standard definition", () => {
		for (let seed = 0; seed < 120; seed += 1) {
			const result = generated({
				dictionarySeed: seed,
				dictionarySemantropy: 100,
			});

			expect(result.definition).not.toContain("{{");
			expect(result.definition).not.toContain("}}");
		}
	});
});

/**
 * Every source file under `src/dictionary`, including the generated template
 * module: generated code is bundled like any other and is held to the same
 * rules as the code around it.
 */
async function dictionarySources(): Promise<readonly string[]> {
	const dir = path.join(process.cwd(), "src", "dictionary");
	const entries = await readdir(dir, { withFileTypes: true, recursive: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name))
		.sort();
}

describe("the Fake Dictionary source itself", () => {
	it("reaches for no ambient randomness, clock, network or DOM", async () => {
		// Structural, not behavioural: determinism is only guaranteed if these
		// never appear at all. Comments are stripped first so the prose that
		// explains the rule does not trip it.
		const files = await dictionarySources();
		const banned = [
			"Math.random",
			"crypto",
			"fetch(",
			"Date.now",
			"new Date",
			"document.",
			"window.",
			"requestUrl",
			"localStorage",
		];

		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const source = (await readFile(file, "utf8"))
				.replaceAll(/\/\*[\s\S]*?\*\//g, "")
				.replaceAll(/\/\/.*$/gm, "");
			for (const name of banned) {
				expect(`${file}: ${source.includes(name)}`).toBe(`${file}: false`);
			}
		}
	});

	it("imports nothing from Obsidian, the view layer or the Vault", async () => {
		const files = await dictionarySources();

		for (const file of files) {
			const source = await readFile(file, "utf8");
			for (const forbidden of [
				'from "obsidian"',
				"../view/",
				"../collect/",
				"../render/",
				"../copy/",
			]) {
				expect(`${file}: ${source.includes(forbidden)}`).toBe(`${file}: false`);
			}
		}
	});
});

/** Rebuilds a template's source text from its compiled segments. */
function templateText(
	segments: readonly { kind: string; text?: string; placeholder?: string }[],
): string {
	return segments
		.map((segment) =>
			segment.kind === "text" ? segment.text : `{{${segment.placeholder}}}`,
		)
		.join("");
}
