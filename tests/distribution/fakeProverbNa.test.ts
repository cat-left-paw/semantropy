import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createFakeProverbAuthority, type FakeProverbAuthority } from "../../src/fakeProverb/fakeProverbAuthority";
import { generateFakeProverbs, type FakeProverbDraft } from "../../src/fakeProverb/fakeProverbCore";
import type { CompiledFakeProverbRecipeSet } from "../../src/fakeProverb/compileRecipeSet";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../../src/vocabulary/enclosedTerms";
import { NA_STEM_EXCLUDED, naAdjectiveStems } from "../../src/vocabulary/lexicalProjection";
import { compile, customInput, literal, ok, reference, slot, recipeData2Set } from "../fakeProverbCoreFixtures";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";

/*
 * FAKE-PROVERB-NA1 with the shipped dictionary and tokenizer: the stem forms
 * are the shared ナ-adjective stems plus な or に, so a stem the dictionary
 * also lists as 連体詞 (こんな, 同じ …) or one ending in な never takes either.
 */

let tokenize: Tokenize;
/**
 * Recipe data 2, pinned: the measurements and the text check below were made for it (none of its fixed texts starts
 * with な). Recipe data 3 has なし and なり, and is checked by its bindings in `fakeProverbRecipes3.test.ts`.
 */
let STANDARD: CompiledFakeProverbRecipeSet;
let ADVERBIAL: CompiledFakeProverbRecipeSet;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); STANDARD = recipeData2Set(); ADVERBIAL = adverbialSet(); });

const PRESETS = ["kumono-ito", "yume-juya", "chumonno-oi-ryoriten"] as const;
const EXCLUDED_WITH_ENDING = new RegExp(`(${NA_STEM_EXCLUDED.join("|")})[なに]`, "u");
/** No literal starts with な, so this in a text can only be a stem form. (A noun こんな before the literal に is algorithm 1's, and stays.) */
const EXCLUDED_WITH_NA = new RegExp(`(${NA_STEM_EXCLUDED.join("|")})な`, "u");

async function ownerOf(text: string, path: string, drawMode: "uniform" | "frequency" = "frequency"): Promise<ManualMorphVocabulary> {
	const analyzed = await analyzeManualMorphSource({ text, sourcePath: path, tokenizer: { tokenize: async (value) => tokenize(value) }, mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
	if (analyzed.status !== "ready") throw new Error("analysis");
	return buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode });
}
const presetOwner = (preset: string, drawMode: "uniform" | "frequency" = "frequency") =>
	ownerOf(readFileSync(`web/presets/${preset}.txt`, "utf8"), `${preset}.md`, drawMode);

/** A test set with an adverbial slot before the predicate (the standard data has none yet). */
const adverbialSet = (): CompiledFakeProverbRecipeSet => compile(customInput({
	proverbs: [{ id: "p-adv", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true), literal("wa"), slot("adverbial", "a1", "adv-p"), slot("predicate", "v1", "pred-p", true)] }],
	glosses: [{ id: "g-adv", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n1" }], parts: [reference("noun", "n1"), literal("to"), slot("noun", "g1", "noun-p")] }],
	extraProfiles: [{ id: "adv-p", kind: "adverbial", forms: [{ form: "na-stem-ni", weight: 1 }] }],
}));

const surfaces = (authority: FakeProverbAuthority, form: string) =>
	authority.forms.find((entry) => entry.form === form)?.candidates.map((candidate) => candidate.surface) ?? [];

function drafts(authority: FakeProverbAuthority, recipeSet: CompiledFakeProverbRecipeSet, nonces: number): FakeProverbDraft[] {
	return Array.from({ length: nonces }, (_, nonce) =>
		ok(generateFakeProverbs({ authority, recipeSet, drawMode: authority.provenance.drawMode, count: 10, nonce })).drafts).flat();
}

function checkStems(draft: FakeProverbDraft): void {
	expect(draft.canonicalText).not.toMatch(EXCLUDED_WITH_NA);
	for (const binding of [...draft.proverb.bindings, ...draft.gloss.bindings]) {
		for (const evidence of binding.candidate.evidence) {
			if (evidence.kind !== "stem") continue;
			expect(NA_STEM_EXCLUDED).not.toContain(evidence.stem);
			expect(evidence.stem.endsWith("な")).toBe(false);
			expect(binding.surface).toBe(`${evidence.stem}${evidence.suffix}`);
		}
	}
}

describe("Fake Proverb stem forms with the shipped dictionary (FAKE-PROVERB-NA1)", () => {
	it.each(PRESETS)("offers exactly the shared stems plus な and plus に for %s, and never an excluded stem", async (preset) => {
		const owner = await presetOwner(preset);
		const stems = naAdjectiveStems(owner.snapshot).map((stem) => stem.surface);
		expect(stems.length).toBeGreaterThan(5);
		const standard = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: STANDARD }));
		const adverbial = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: ADVERBIAL }));
		expect(surfaces(standard, "na-stem-na")).toEqual(stems.map((stem) => `${stem}な`));
		expect(surfaces(adverbial, "na-stem-ni")).toEqual(stems.map((stem) => `${stem}に`));
		for (const surface of [...surfaces(standard, "na-stem-na"), ...surfaces(adverbial, "na-stem-ni")]) {
			expect(surface).not.toMatch(EXCLUDED_WITH_ENDING);
			expect(surface).not.toMatch(/な[なに]$/u);
		}
		for (const draft of drafts(standard, STANDARD, 30)) checkStems(draft);
		for (const draft of drafts(adverbial, ADVERBIAL, 10)) checkStems(draft);
	});

	it("never gives こんな, そんな, どんな or おんなじ an ending, even where the tokenizer reads them as stems", async () => {
		// Before なのに the shipped tokenizer reads each as 名詞 / 形容動詞語幹 (checked for this slice: おんなじ before だ
		// is 名詞 / 一般 here, and 同じ is a 連体詞 in every context tried). こんな, そんな and どんな also end in な;
		// おんなじ is kept out by the closed set alone.
		const owner = await ownerOf("こんななのに。そんななのに。どんななのに。おんなじなのに。静かだ。無慈悲な猫。かたくなな人。", "source.md");
		expect(owner.snapshot.projections.manual.candidates.filter((record) => record.morphology.detail1 === "形容動詞語幹").map((record) => record.surface))
			.toEqual(expect.arrayContaining(["おんなじ", "こんな", "そんな", "どんな"]));
		const standard = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: STANDARD }));
		const adverbial = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: ADVERBIAL }));
		expect(surfaces(standard, "na-stem-na")).toEqual(["無慈悲な", "静かな"]);
		expect(surfaces(adverbial, "na-stem-ni")).toEqual(["無慈悲に", "静かに"]);
		for (const draft of drafts(standard, STANDARD, 200)) checkStems(draft);
		for (const draft of drafts(adverbial, ADVERBIAL, 50)) checkStems(draft);
	});

	// A measurement for the owner, who tunes the weight (record §5): plain-modifier is adjective-basic 3, verb-basic 2,
	// verb-past 1, verb-negative 1 and na-stem-na 2; a form with no candidate is not drawn, so the share depends on the Vocabulary.
	it.each(PRESETS)("measures the share of stem plus な among plain-modifier draws for %s", async (preset) => {
		const owner = await presetOwner(preset);
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: STANDARD }));
		const all = drafts(authority, STANDARD, 200);
		const plain = all.flatMap((draft) => [...draft.proverb.bindings, ...draft.gloss.bindings]).filter((binding) => binding.profileId === "plain-modifier");
		const stem = plain.filter((binding) => binding.form === "na-stem-na").length;
		// With every form available the expected share is 2 / 9 (22.2%); measured 109 of 516 (21.1%) for each preset,
		// in 107 of 2,000 drafts (5.3%).
		expect(stem / plain.length).toBeGreaterThan(0.16);
		expect(stem / plain.length).toBeLessThan(0.28);
	});
});
