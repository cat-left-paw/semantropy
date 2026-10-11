import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { readEntries } from "../../scripts/max/scanDictionary.mjs";
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
import { parseFakeAlertSlotToken } from "../../src/fakeAlert/recipeSet";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../../src/vocabulary/enclosedTerms";
import { iAdjectiveBasicForms, NA_STEM_EXCLUDED, naAdjectiveStems, regularVerbBasicForms } from "../../src/vocabulary/lexicalProjection";
import { buildTokenize, compactDictionaryDir, fullDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";

/*
 * FAKE-ALERT-ADJ1, with the shipped dictionary: the イ-adjectives a Fake Alert
 * may show are the basic forms Collision already offers as Modifiers, its
 * ナ-adjective stems are the ones Collision offers with な less the few that
 * cannot take it, and that exclusion is what the dictionary itself says.
 */

let tokenize: Tokenize;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });

const PRESETS = ["kumono-ito", "yume-juya", "chumonno-oi-ryoriten"] as const;

async function ownerOf(text: string, path: string): Promise<ManualMorphVocabulary> {
	const analyzed = await analyzeManualMorphSource({ text, sourcePath: path, tokenizer: { tokenize: async (value) => tokenize(value) }, mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
	if (analyzed.status !== "ready") throw new Error("analysis");
	return buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
}
const presetOwner = (preset: string) => ownerOf(readFileSync(`web/presets/${preset}.txt`, "utf8"), `${preset}.md`);

/** The surfaces Collision offers as Modifiers of one class. */
function collisionModifiers(owner: ManualMorphVocabulary, modifierClass: "i-adjective" | "na-adjective"): string[] {
	const compiled = compileCollisionPatternSet({
		schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION, dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION,
		recipes: STANDARD_COLLISION_RECIPES, literals: STANDARD_COLLISION_LITERALS, connectors: STANDARD_COLLISION_CONNECTORS,
		modifierForms: STANDARD_COLLISION_MODIFIER_FORMS, nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES,
	});
	if (!compiled.ok) throw new Error("patterns");
	const built = buildAuthenticatedCollisionLexemePool({ vocabulary: owner, patternData: compiled.set });
	if (!built.ok) throw new Error(built.reason);
	return [...new Set(built.pool.modifiers.filter((candidate) => candidate.variants.some((variant) => variant.modifierClass === modifierClass)).map((candidate) => candidate.surface))].sort();
}

describe("Fake Alert adjectives with the shipped dictionary (ADJ1)", () => {
	it.each(PRESETS)("offers Collision's イ-adjective Modifiers, and its ナ-adjective Modifiers less the stems that take no な, for %s", async (preset) => {
		const owner = await presetOwner(preset);
		const words = fakeAlertWords(owner)!;
		expect(words.adjectives.length).toBeGreaterThan(10);
		expect([...words.adjectives].sort()).toEqual(collisionModifiers(owner, "i-adjective"));
		// Collision's surface is the stem with な; Fake Alert keeps the stem and leaves out the ones that cannot take it.
		const stems = collisionModifiers(owner, "na-adjective").map((surface) => surface.slice(0, -1));
		expect(words.na.length).toBeGreaterThan(5);
		expect([...words.na].sort()).toEqual(stems.filter((stem) => !stem.endsWith("な") && !NA_STEM_EXCLUDED.includes(stem)).sort());
		// A stem is a noun too, and the irregular いい is not an adjective here.
		for (const stem of words.na) expect(words.nouns, stem).toContain(stem);
		expect(words.adjectives).not.toContain("いい");
		// LEXEME-SHARE1: these are the shared lists, read from the same Snapshot.
		const surfaces = (list: readonly { surface: string }[]) => list.map((form) => form.surface);
		expect([surfaces(regularVerbBasicForms(owner.snapshot)), surfaces(iAdjectiveBasicForms(owner.snapshot)), surfaces(naAdjectiveStems(owner.snapshot))])
			.toEqual([words.verbs, words.adjectives, words.na]);
	});

	it("leaves out exactly the stems the dictionary also lists as 連体詞", () => {
		const stems = new Set<string>(), adnominals = new Set<string>();
		for (const entry of readEntries(fullDictionaryDir())) {
			if (entry[0] === "名詞" && entry[1] === "形容動詞語幹") stems.add(entry[6]!);
			if (entry[0] === "連体詞") adnominals.add(entry[6]!);
		}
		expect(stems.size).toBe(3310);
		expect([...stems].filter((stem) => adnominals.has(stem)).sort()).toEqual([...NA_STEM_EXCLUDED].sort());
		// The ones a final な rules out, of which three are in the closed set as well.
		expect([...stems].filter((stem) => stem.endsWith("な")).sort()).toEqual(["かたくな", "こなごな", "こんな", "そんな", "どんな", "へなへな", "人少な"].sort());
	});

	it("keeps こんな, そんな, どんな and おんなじ as nouns but never as stems, through the shipped tokenizer", async () => {
		// Before なのに (and おんなじ before だ) the tokenizer reads each as 名詞 / 形容動詞語幹; elsewhere it mostly
		// reads them as 連体詞, and 同じ was read as a stem in none of the contexts tried (the record lists them).
		const owner = await ownerOf("こんななのに。そんななのに。どんななのに。おんなじだ。静かだ。無慈悲な猫。", "source.md");
		const words = fakeAlertWords(owner)!;
		expect(words.na).toEqual(["無慈悲", "静か"].sort());
		expect(NA_STEM_EXCLUDED.filter((stem) => words.nouns.includes(stem)).sort()).toEqual(["おんなじ", "こんな", "そんな", "どんな"].sort());
		for (const stem of NA_STEM_EXCLUDED) expect(words.na).not.toContain(stem);
		// No Alert puts な after one of them, at any level.
		for (const level of [0, 50, 100]) {
			for (let nonce = 1; nonce <= 2000; nonce += 1) {
				const result = generateFakeAlert({ owner, level, nonce });
				if (!result.ok) throw new Error(result.reason);
				for (const page of [result.alert.prompt, ...Object.values(result.alert.outcomes)]) {
					for (const line of page.lines) expect(line).not.toMatch(/(こんな|そんな|どんな|おんなじ|同じ)な/u);
				}
			}
		}
	});

	it("shows an adjective or a stem only where its slot is, as the recipe writes it", async () => {
		const owner = await presetOwner("yume-juya");
		const words = fakeAlertWords(owner)!;
		const pools = { n: words.nouns, s: words.sahen, v: words.verbs, i: words.adjectives, na: words.na };
		const set = standardFakeAlertRecipes();
		const recipes = new Map([...set.prompts, ...set.terminals, ...set.outcomes].map((entry) => [entry.id, entry]));
		const seen = { i: 0, na: 0 };
		for (const level of [0, 50, 100]) {
			for (let nonce = 1; nonce <= 400; nonce += 1) {
				const result = generateFakeAlert({ owner, level, nonce });
				if (!result.ok) throw new Error(result.reason);
				for (const page of [result.alert.prompt, ...Object.values(result.alert.outcomes)]) {
					const recipe = recipes.get(page.recipeId)!;
					expect(page.lines).toEqual(recipe.lines.map((line) => line.map((segment) =>
						typeof segment === "string" ? segment : page.words.find((word) => word.token === segment.token)!.surface).join("")));
					for (const word of page.words) {
						const kind = parseFakeAlertSlotToken(word.token)!.kind;
						expect(pools[kind], `${word.token} ${word.surface}`).toContain(word.surface);
						if (kind === "i" || kind === "na") seen[kind] += 1;
					}
				}
			}
		}
		expect(seen.i).toBeGreaterThan(100);
		expect(seen.na).toBeGreaterThan(100);
	});
});
