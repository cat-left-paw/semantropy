import { describe, expect, it } from "vitest";
import {
	createFakeProverbAuthority,
	inspectFakeProverbAuthority,
	type FakeProverbAuthority,
} from "../src/fakeProverb/fakeProverbAuthority";
import { generateFakeProverbs, type FakeProverbGeneration } from "../src/fakeProverb/fakeProverbCore";
import type { CompiledFakeProverbRecipeSet } from "../src/fakeProverb/compileRecipeSet";
import { NA_STEM_EXCLUDED, naAdjectiveStems } from "../src/vocabulary/lexicalProjection";
import { deepFrozen } from "./automaticPosFixtures";
import { na, naStem } from "./fakeAlertCoreFixtures";
import { LEXICON, RICH_TEXT, compile, customInput, literal, mintOwner, noun, ok, reference, slot, recipeData2Set, token } from "./fakeProverbCoreFixtures";

/*
 * FAKE-PROVERB-NA1 (Recipe Schema 2, algorithm 2, `Docs/fake_proverb_na_amendment1.md`):
 * a ナ-adjective stem plus な as a modifier form and a stem plus に as the
 * adverbial slot. The stems come from the shared `naAdjectiveStems()`; the
 * authority adds only the fixed ending.
 */

const STEM_LEXICON = [...LEXICON, na, token("に", "助詞", "格助詞"), naStem("静か"), naStem("無慈悲"), naStem("かたくな"), ...NA_STEM_EXCLUDED.map(naStem), noun("机")];
const STEM_TEXT = `${RICH_TEXT}静かな猫。静かな犬。無慈悲な川。かたくなな月。${NA_STEM_EXCLUDED.map((stem) => `${stem}な鳥。`).join("")}机の星。`;

async function stemAuthority(recipeSet: CompiledFakeProverbRecipeSet = recipeData2Set(), drawMode: "uniform" | "frequency" = "uniform", text = STEM_TEXT) {
	const minted = await mintOwner([text], drawMode, STEM_LEXICON);
	const authority = ok(createFakeProverbAuthority({ vocabulary: minted.owner, recipeSet }));
	return { ...minted, recipeSet, authority };
}

const candidatesOf = (authority: FakeProverbAuthority, form: string) => authority.forms.find((entry) => entry.form === form)?.candidates ?? [];
const surfaces = (authority: FakeProverbAuthority, form: string) => candidatesOf(authority, form).map((candidate) => candidate.surface);

function generate(authority: FakeProverbAuthority, recipeSet: CompiledFakeProverbRecipeSet, nonce: number, count = 10): FakeProverbGeneration {
	return ok(generateFakeProverbs({ authority, recipeSet, drawMode: authority.provenance.drawMode, count, nonce }));
}

/** A set whose one proverb is `{a1}{v1}` after a noun: 猫は静かに歩く. Recipes with an adverbial slot are not in the standard data yet. */
function adverbialSet(): CompiledFakeProverbRecipeSet {
	return compile(customInput({
		proverbs: [{ id: "p-adv", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true), literal("wa"), slot("adverbial", "a1", "adv-p", true), slot("predicate", "v1", "pred-p", true)] }],
		glosses: [{ id: "g-adv", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n1" }, { kind: "adverbial", slotId: "a1" }, { kind: "predicate", slotId: "v1" }],
			parts: [reference("noun", "n1"), literal("to"), slot("noun", "g1", "noun-p"), literal("wa"), reference("adverbial", "a1"), reference("predicate", "v1")] }],
		extraProfiles: [{ id: "adv-p", kind: "adverbial", forms: [{ form: "na-stem-ni", weight: 1 }] }],
	}));
}

describe("the stem forms of the Fake Proverb authority", () => {
	it("offers each stem the shared list gives, plus な, with stem evidence and the stem's own counts and origins", async () => {
		const { owner, authority } = await stemAuthority(recipeData2Set(), "frequency");
		const stems = naAdjectiveStems(owner.snapshot);
		expect(stems.map((stem) => stem.surface)).toEqual(["無慈悲", "静か"]);
		expect(surfaces(authority, "na-stem-na")).toEqual(stems.map((stem) => `${stem.surface}な`));
		for (const candidate of candidatesOf(authority, "na-stem-na")) {
			const stem = stems.find((entry) => `${entry.surface}な` === candidate.surface)!;
			expect(candidate.evidence).toEqual([{ kind: "stem", stem: stem.surface, suffix: "な" }]);
			expect(candidate.frequency).toBe(stem.frequency);
			expect(candidate.origins).toEqual(stem.origins);
		}
		expect(candidatesOf(authority, "na-stem-na").find((candidate) => candidate.surface === "静かな")!.frequency).toBe(2);
		expect(deepFrozen(authority)).toBe(true);
	});

	it("never offers a 連体詞-like stem, a stem ending in な, or a plain noun with な or に", async () => {
		const { authority } = await stemAuthority(adverbialSet());
		const { authority: standard } = await stemAuthority();
		const offered = [...surfaces(standard, "na-stem-na"), ...surfaces(authority, "na-stem-ni")];
		for (const refused of [...NA_STEM_EXCLUDED.flatMap((stem) => [`${stem}な`, `${stem}に`]), "かたくなな", "かたくなに", "机な", "机に", "猫な"]) {
			expect(offered).not.toContain(refused);
		}
		expect(surfaces(authority, "na-stem-ni")).toEqual(["無慈悲に", "静かに"]);
		expect(candidatesOf(authority, "na-stem-ni").map((candidate) => candidate.evidence)).toEqual([
			[{ kind: "stem", stem: "無慈悲", suffix: "に" }], [{ kind: "stem", stem: "静か", suffix: "に" }],
		]);
	});

	it("keeps a stem a noun as well, as the Snapshot already does", async () => {
		const { authority } = await stemAuthority();
		expect(surfaces(authority, "independent-noun")).toEqual(expect.arrayContaining(["静か", "無慈悲"]));
	});

	it("derives a stem form only when the bound set uses it, and has none without a stem", async () => {
		const { authority: narrow } = await stemAuthority(compile(customInput()));
		expect(narrow.forms.map((entry) => entry.form)).toEqual(["independent-noun", "verb-basic"]);
		const { authority: plain } = await stemAuthority(adverbialSet(), "uniform", RICH_TEXT);
		expect(surfaces(plain, "na-stem-ni")).toEqual([]);
		expect(plain.forms.find((entry) => entry.form === "na-stem-ni")).toBeDefined();
	});

	it("re-derives the stem candidates in its full audit", async () => {
		const { authority, recipeSet } = await stemAuthority();
		expect(ok(inspectFakeProverbAuthority({ authority, recipeSet }))).toBe(true);
		const forged = JSON.parse(JSON.stringify(authority)) as { forms: { form: string; candidates: { surface: string }[] }[] };
		forged.forms.find((entry) => entry.form === "na-stem-na")!.candidates[0]!.surface = "こんなな";
		expect(inspectFakeProverbAuthority({ authority: forged as never, recipeSet }).ok).toBe(false);
	});
});

describe("drawing the stem forms", () => {
	it("draws a stem plus な in the standard plain-modifier and puts it before a noun", async () => {
		const { authority, recipeSet } = await stemAuthority();
		const drafts = Array.from({ length: 60 }, (_, nonce) => generate(authority, recipeSet, nonce).drafts).flat();
		const bindings = drafts.flatMap((draft) => [...draft.proverb.bindings, ...draft.gloss.bindings]);
		const stems = bindings.filter((binding) => binding.form === "na-stem-na");
		expect(stems.length).toBeGreaterThan(0);
		for (const binding of stems) {
			expect(["静かな", "無慈悲な"]).toContain(binding.surface);
			expect(binding.candidate.evidence.every((item) => item.kind === "stem")).toBe(true);
		}
		for (const draft of drafts) {
			for (const excluded of NA_STEM_EXCLUDED) expect(draft.canonicalText).not.toContain(`${excluded}な`);
			expect(draft.canonicalText).not.toContain("かたくなな");
		}
	});

	it("puts a stem plus に before the predicate of a test set with an adverbial slot", async () => {
		const { authority, recipeSet } = await stemAuthority(adverbialSet());
		const generation = generate(authority, recipeSet, 5, 6);
		expect(generation.drafts.length).toBeGreaterThan(0);
		for (const draft of generation.drafts) {
			const adverbial = draft.proverb.bindings.find((binding) => binding.form === "na-stem-ni")!;
			const predicate = draft.proverb.bindings.find((binding) => binding.kind === "predicate")!;
			expect(["静かに", "無慈悲に"]).toContain(adverbial.surface);
			expect(draft.proverb.text.endsWith(`${adverbial.surface}${predicate.surface}`)).toBe(true);
			// The gloss reference is the proverb's own binding.
			expect(draft.gloss.text).toContain(`${adverbial.surface}${predicate.surface}`);
			expect(draft.gloss.references.find((entry) => entry.slotId === "a1")!.binding).toBe(adverbial);
		}
	});

	it("leaves a recipe with an adverbial slot unusable without a stem, as any slot without a candidate", async () => {
		const { authority, recipeSet } = await stemAuthority(adverbialSet(), "uniform", RICH_TEXT);
		const answer = generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: 3, nonce: 1 });
		expect(answer.ok ? answer.value.drafts : []).toEqual([]);
	});

	// Algorithm 2 oracle for a Vocabulary with stems. Without a stem the draw is algorithm 1's (fakeProverbCore.test.ts pins it unchanged).
	it("pins algorithm 2's exact drafts for a Vocabulary with stems", async () => {
		const { authority, recipeSet } = await stemAuthority();
		expect(generate(authority, recipeSet, 2, 3).drafts.map((draft) => [draft.proverb.recipeId, draft.gloss.recipeId, draft.canonicalText])).toEqual([
			["pursuer", "mistaken-belief", "**静かを見る者は机を話さない**\n\n> 静かを静かなものと思い込むと、かえって猫を失うという教え。"],
			["offered-to", "mistaken-belief", "**静かにかたくな**\n\n> 静かを無慈悲なものと思い込むと、かえって川を失うという教え。"],
			["origin-of", "mistaken-belief", "**犬は静かのもと**\n\n> 犬を書くものと思い込むと、かえってこんなを失うという教え。"],
		]);
	});
});
