import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
	STANDARD_FAKE_PROVERB_RECIPES_GENERATED,
	STANDARD_FAKE_PROVERB_RECIPES_LOCK,
	STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN,
	describeFakeProverbSourceIssues,
	parseStandardFakeProverbRecipeMarkdown,
} from "../../scripts/fakeProverb/standardRecipes.mjs";
import { createFakeProverbAuthority } from "../../src/fakeProverb/fakeProverbAuthority";
import { generateFakeProverbs, type FakeProverbDraft } from "../../src/fakeProverb/fakeProverbCore";
import type { CompiledFakeProverbRecipeSet } from "../../src/fakeProverb/compileRecipeSet";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../../src/vocabulary/enclosedTerms";
import { NA_STEM_EXCLUDED, naAdjectiveStems } from "../../src/vocabulary/lexicalProjection";
import { compile, ok, recipeData2Set, standardSet } from "../fakeProverbCoreFixtures";
import { buildFakeProverbPreview } from "../support/fakeProverbPreview";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";

/*
 * FAKE-PROVERB-RECIPES3 with the shipped dictionary and tokenizer, on the three web presets: recipe data 2 written in
 * the one-line format draws what recipe data 2 drew, recipe data 3 draws every one of its types, and the preview the
 * owner runs reads the document as it stands.
 */

let tokenize: Tokenize;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });

const PRESETS = ["kumono-ito", "yume-juya", "chumonno-oi-ryoriten"] as const;
const presetText = (preset: string) => readFileSync(`web/presets/${preset}.txt`, "utf8");

async function presetOwner(preset: string, drawMode: "uniform" | "frequency"): Promise<ManualMorphVocabulary> {
	const analyzed = await analyzeManualMorphSource({ text: presetText(preset), sourcePath: `${preset}.md`, tokenizer: { tokenize: async (value) => await Promise.resolve(tokenize(value)) },
		mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
	if (analyzed.status !== "ready") throw new Error("analysis");
	return buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode });
}
function batches(owner: ManualMorphVocabulary, recipeSet: CompiledFakeProverbRecipeSet, count: number) {
	const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
	return Array.from({ length: count }, (_, nonce) => ok(generateFakeProverbs({ authority, recipeSet, drawMode: authority.provenance.drawMode, count: 10, nonce })));
}
const told = (draft: FakeProverbDraft) => [draft.proverb.recipeId, draft.gloss.recipeId, draft.canonicalText,
	[...draft.proverb.bindings, ...draft.gloss.bindings].map((binding) => [binding.scope, binding.slotId, binding.profileId, binding.form, binding.surface])];

describe("recipe data 2 written in the one-line format (FAKE-PROVERB-RECIPES3)", () => {
	it("draws the same 12,000 drafts as the pinned recipe data 2, on the three presets and with both draw modes", async () => {
		const pinned = recipeData2Set();
		const parsed = parseStandardFakeProverbRecipeMarkdown(readFileSync("tests/fixtures/regression/fakeProverbRecipes2.format3.md", "utf8"));
		if (!parsed.ok) throw new Error(describeFakeProverbSourceIssues(parsed.issues));
		const rewritten = compile({ schemaVersion: parsed.schemaVersion, dataVersion: parsed.dataVersion, proverbs: parsed.proverbs, glosses: parsed.glosses, literals: parsed.literals, profiles: parsed.profiles });
		let compared = 0;
		for (const preset of PRESETS) {
			for (const drawMode of ["uniform", "frequency"] as const) {
				const owner = await presetOwner(preset, drawMode);
				const before = batches(owner, pinned, 200);
				const after = batches(owner, rewritten, 200);
				expect(before.every((generation) => generation.shortfall === null && generation.drafts.length === 10)).toBe(true);
				expect(after.map((generation) => generation.drafts.map(told))).toEqual(before.map((generation) => generation.drafts.map(told)));
				compared += before.reduce((sum, generation) => sum + generation.drafts.length, 0);
			}
		}
		expect(compared).toBe(12_000);
	});
});

describe("recipe data 4 on the three presets", () => {
	it.each(PRESETS)("draws all 63 proverbs and all 32 glosses for %s, never falls short, and never gives an excluded stem an ending", async (preset) => {
		const recipeSet = standardSet();
		expect([recipeSet.dataVersion, recipeSet.proverbs.length, recipeSet.glosses.length]).toEqual([4, 63, 32]);
		const owner = await presetOwner(preset, "uniform");
		const stems = naAdjectiveStems(owner.snapshot).map((stem) => stem.surface);
		const made = batches(owner, recipeSet, 300);
		expect(made.every((generation) => generation.shortfall === null && generation.drafts.length === 10)).toBe(true);
		const drafts = made.flatMap((generation) => generation.drafts);
		expect(new Set(drafts.map((draft) => draft.proverb.recipeId)).size).toBe(63);
		expect(new Set(drafts.map((draft) => draft.gloss.recipeId)).size).toBe(32);
		const forms = new Set<string>();
		for (const draft of drafts) {
			for (const binding of [...draft.proverb.bindings, ...draft.gloss.bindings]) {
				forms.add(binding.form);
				if (binding.form !== "na-stem-na" && binding.form !== "na-stem-ni") continue;
				// Recipe data 3 has fixed texts that start with な (なし, なり), so the stems are checked by their bindings, not in the text.
				const ending = binding.form === "na-stem-ni" ? "に" : "な";
				expect(binding.surface.endsWith(ending)).toBe(true);
				const stem = binding.surface.slice(0, -1);
				expect(stems).toContain(stem);
				expect(NA_STEM_EXCLUDED).not.toContain(stem);
				expect(stem.endsWith("な")).toBe(false);
				for (const evidence of binding.candidate.evidence) expect(evidence).toEqual({ kind: "stem", stem, suffix: ending });
			}
		}
		expect([...forms].sort()).toEqual(["adjective-basic", "independent-noun", "na-stem-na", "na-stem-ni", "verb-basic", "verb-negative", "verb-past"]);
		// A proverb without a noun comes with one of the four glosses that use its predicate alone.
		const nounless = drafts.filter((draft) => !draft.proverb.bindings.some((binding) => binding.kind === "noun"));
		expect(nounless.length).toBeGreaterThan(100);
		expect(new Set(nounless.map((draft) => draft.gloss.recipeId))).toEqual(new Set(["same-as-doing", "seems-to", "think-of-when", "thanks-to"]));
	});
});

describe("npm run preview:fake-proverb", () => {
	const sources = () => PRESETS.slice(0, 2).map((preset) => ({ title: preset, text: presetText(preset) }));
	const standard = () => readFileSync(STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, "utf8");

	it("shows every type with an example from each Vocabulary and counts how often an ending repeats, the same way each time", async () => {
		const first = await buildFakeProverbPreview({ markdown: standard(), sources: sources(), tokenize, batches: 200 });
		const second = await buildFakeProverbPreview({ markdown: standard(), sources: sources(), tokenize, batches: 200 });
		expect(first.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		expect(second.markdown).toBe(first.markdown);
		expect([first.dataVersion, first.proverbs, first.glosses]).toEqual([4, 63, 32]);
		for (const id of ["topic-object", "wins", "quiet-walker-lacks", "comes-to", "misplaced-purpose", "think-of-when", "in-turn"]) expect(first.markdown).toContain(`\`${id}\``);
		expect(first.markdown).toContain("`{m1:動}は易く、{v1:動}は難し`（weight 4）");
		expect(first.markdown).toContain("`{n1}は{n2}を{v1}`（weight 2）");
		expect(first.markdown).not.toContain("作った日時");
		for (const stats of first.stats) {
			expect([stats.drafts, stats.shortBatches, stats.proverbTypes]).toEqual([2000, 0, 63]);
			// With 63 proverbs a type seldom stands three times in ten, and the glosses' endings are spread over several expressions.
			expect(stats.sameProverb.meanMost).toBeLessThan(1.8);
			expect(stats.sameGloss.meanMost).toBeLessThan(2.4);
			expect(stats.proverbEnding.meanMost).toBeLessThan(2.8);
			expect(stats.glossEnding.meanMost).toBeLessThan(3.7);
			expect(stats.glossEnding.top.length).toBeGreaterThanOrEqual(7);
		}
	});

	it("reads the document as it stands: an unsaved edit is shown, with no generated module or lock written", async () => {
		const generated = readFileSync(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "utf8");
		const lock = readFileSync(STANDARD_FAKE_PROVERB_RECIPES_LOCK, "utf8");
		// A new proverb at the same data-version: the generator would refuse this until the version is raised.
		const edited = `${standard()}\n## proverb preview-only\nenabled: true\nweight: 400\nline: {n1}は{n2}の夜明け\n`;
		const preview = await buildFakeProverbPreview({ markdown: edited, sources: sources(), tokenize, batches: 20 });
		expect(preview.ok).toBe(true);
		if (!preview.ok) return;
		expect(preview.proverbs).toBe(64);
		const start = preview.markdown.indexOf("- `preview-only` `{n1}は{n2}の夜明け`（weight 400）");
		expect(start).toBeGreaterThan(0);
		expect(preview.markdown.slice(start).split("\n").slice(1, 3).every((line) => /^ {2}- .+は.+の夜明け$/u.test(line))).toBe(true);
		expect([readFileSync(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "utf8"), readFileSync(STANDARD_FAKE_PROVERB_RECIPES_LOCK, "utf8")]).toEqual([generated, lock]);
		// The builder has no way to write: it imports neither the file system nor the generator's writer.
		const builder = readFileSync("tests/support/fakeProverbPreview.ts", "utf8");
		expect(builder).not.toMatch(/node:fs|writeStandardFakeProverbRecipes|writeFile/u);
	});

	it("explains a mistake in Japanese instead of writing examples", async () => {
		const broken = standard().replace("line: {n1}より{n2}\n", "line: {n1}より{x2}\n");
		expect(broken).not.toBe(standard());
		const preview = await buildFakeProverbPreview({ markdown: broken, sources: sources(), tokenize, batches: 20 });
		expect(preview.ok).toBe(false);
		if (preview.ok) return;
		expect(preview.explanation).toContain("に、直すところがあります。");
		expect(preview.explanation).toContain("（proverb rather-than）: 穴 {x2} の書き方が違います。");
		expect(preview.explanation).toContain("(invalid-hole)");
	});
});
