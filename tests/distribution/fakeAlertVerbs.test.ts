import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAuthenticatedCollisionLexemePool } from "../../src/collision/collisionVocabulary";
import { compileCollisionPatternSet } from "../../src/collision/compilePatternSet";
import {
	STANDARD_COLLISION_CONNECTORS,
	STANDARD_COLLISION_LITERALS,
	STANDARD_COLLISION_MODIFIER_FORMS,
	STANDARD_COLLISION_NOUN_SUFFIXES,
	STANDARD_COLLISION_PATTERN_DATA_VERSION,
	STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
	STANDARD_COLLISION_RECIPES,
} from "../../src/collision/generated/standardCollisionPatternEntries";
import { fakeAlertWords, generateFakeAlert, standardFakeAlertRecipes } from "../../src/fakeAlert/fakeAlertCore";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../../src/vocabulary/enclosedTerms";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";

/*
 * FAKE-ALERT-VERB1, with the shipped dictionary: the verbs a Fake Alert may
 * show are the basic forms Collision already offers as Predicates, for the
 * three texts the web page ships, and a verb slot comes out in a place its
 * basic form can stand.
 */

let tokenize: Tokenize;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });

const PRESETS = ["kumono-ito", "yume-juya", "chumonno-oi-ryoriten"] as const;

async function ownerOf(preset: string): Promise<ManualMorphVocabulary> {
	const text = readFileSync(`web/presets/${preset}.txt`, "utf8");
	// The mode the View analyzes a Target with; its Current Note Vocabulary is what the web page starts from.
	const analyzed = await analyzeManualMorphSource({ text, sourcePath: `${preset}.md`, tokenizer: { tokenize: async (value) => tokenize(value) }, mode: "target-prototype" });
	if (analyzed.status !== "ready") throw new Error("analysis");
	return buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
}

/** A Vocabulary Source read with the standard `{{…}}` terms, as the plugin reads one. */
async function sourceOwner(text: string): Promise<ManualMorphVocabulary> {
	const analyzed = await analyzeManualMorphSource({ text, sourcePath: "source.md", tokenizer: { tokenize: async (value) => tokenize(value) }, mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
	if (analyzed.status !== "ready") throw new Error("analysis");
	return buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
}

function collisionPredicates(owner: ManualMorphVocabulary): string[] {
	const compiled = compileCollisionPatternSet({
		schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION, dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION,
		recipes: STANDARD_COLLISION_RECIPES, literals: STANDARD_COLLISION_LITERALS, connectors: STANDARD_COLLISION_CONNECTORS,
		modifierForms: STANDARD_COLLISION_MODIFIER_FORMS, nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES,
	});
	if (!compiled.ok) throw new Error("patterns");
	const built = buildAuthenticatedCollisionLexemePool({ vocabulary: owner, patternData: compiled.set });
	if (!built.ok) throw new Error(built.reason);
	return built.pool.predicates.map((candidate) => candidate.surface);
}

describe("Fake Alert verbs with the shipped dictionary (VERB1)", () => {
	it.each(PRESETS)("offers exactly Collision's Predicate basic forms for %s", async (preset) => {
		const owner = await ownerOf(preset);
		const verbs = fakeAlertWords(owner)!.verbs;
		expect(verbs.length).toBeGreaterThan(50);
		expect([...verbs].sort()).toEqual([...new Set(collisionPredicates(owner))].sort());
		// The irregular and unadmitted verbs these texts contain are not candidates.
		for (const refused of ["ある", "する", "来る", "行く", "くる", "いく", "ござる", "下さる", "くださる", "いらっしゃる"]) expect(verbs, refused).not.toContain(refused);
	});

	it("gives 蜘蛛の糸 far more verbs than sahen nouns, and shows a verb only where its basic form stands", async () => {
		const owner = await ownerOf("kumono-ito");
		const words = fakeAlertWords(owner)!;
		expect(words.sahen.length).toBeLessThan(10);
		expect(words.verbs.length).toBeGreaterThan(words.sahen.length * 10);
		const set = standardFakeAlertRecipes();
		const recipes = new Map([...set.prompts, ...set.terminals, ...set.outcomes].map((entry) => [entry.id, entry]));
		let verbWords = 0;
		for (const level of [0, 50, 100]) {
			for (let nonce = 1; nonce <= 400; nonce += 1) {
				const result = generateFakeAlert({ owner, level, nonce });
				if (!result.ok) throw new Error(result.reason);
				for (const page of [result.alert.prompt, ...Object.values(result.alert.outcomes)]) {
					const recipe = recipes.get(page.recipeId)!;
					// Each line is the recipe's fixed text with the page's words in its slots: nothing is inflected.
					expect(page.lines).toEqual(recipe.lines.map((line) => line.map((segment) =>
						typeof segment === "string" ? segment : page.words.find((word) => word.token === segment.token)!.surface).join("")));
					for (const word of page.words) {
						if (!word.token.replace("+", "").startsWith("v")) continue;
						verbWords += 1;
						expect(words.verbs, word.surface).toContain(word.surface);
					}
				}
			}
		}
		expect(verbWords).toBeGreaterThan(200);
	});

	it("keeps a verb for the verb slot when a {{…}} term spells the same word as a noun (independent review 1, P2)", async () => {
		// The reviewer's two Sources and draws, through the shipped tokenizer: a `{{…}}` term is a noun, 歩く is also a verb.
		const first = await sourceOwner("猫。{{歩く}}。歩く。");
		expect(fakeAlertWords(first)).toEqual({ nouns: ["歩く", "猫"], sahen: [], verbs: ["歩く"], adjectives: [], na: [] });
		const prompt = generateFakeAlert({ owner: first, level: 0, nonce: 5152 });
		if (!prompt.ok) throw new Error(prompt.reason);
		// It was 歩くが歩くおそれがあります。 (The nonces moved with recipe data 4; each of these gives the broken
		// sentence when the filter is removed, RECIPES2 independent review 1, P3.)
		expect([prompt.alert.prompt.recipeId, prompt.alert.prompt.lines]).toEqual(["notice-may", ["猫が歩くおそれがあります。", "続行しますか？"]]);
		const second = await sourceOwner("猫。犬。{{歩く}}。歩く。");
		expect(fakeAlertWords(second)).toEqual({ nouns: ["歩く", "犬", "猫"], sahen: [], verbs: ["歩く"], adjectives: [], na: [] });
		const outcome = generateFakeAlert({ owner: second, level: 100, nonce: 5639 });
		if (!outcome.ok) throw new Error(outcome.reason);
		// The いいえ side was 歩くは歩くことにしました。
		expect([outcome.alert.prompt.lines, outcome.alert.outcomes.no!.lines]).toEqual([["犬を信じますか？"], ["猫は歩くことにしました。"]]);
		// Over many draws, a page with one noun slot and one verb slot never shows 歩く twice.
		let pairs = 0;
		for (let nonce = 1; nonce <= 20000; nonce += 1) {
			const result = generateFakeAlert({ owner: first, level: nonce % 101, nonce });
			if (!result.ok) throw new Error(result.reason);
			const words = result.alert.prompt.words;
			if (words.length !== 2 || !words.some((word) => word.token === "v1")) continue;
			pairs += 1;
			expect(words.map((word) => word.surface).sort(), result.alert.prompt.lines.join("")).toEqual(["歩く", "猫"]);
		}
		expect(pairs).toBeGreaterThan(10);
	});
});
