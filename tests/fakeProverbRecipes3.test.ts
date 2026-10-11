import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseStandardFakeProverbRecipeMarkdown, describeFakeProverbSourceIssues, fakeProverbLiteralId } from "../scripts/fakeProverb/standardRecipes.mjs";
import { createFakeProverbAuthority, type FakeProverbAuthority } from "../src/fakeProverb/fakeProverbAuthority";
import { createFakeProverbBatchController, readFakeProverbRow } from "../src/fakeProverb/fakeProverbBatch";
import { generateFakeProverbs, type FakeProverbDraft } from "../src/fakeProverb/fakeProverbCore";
import { isFakeProverbGlossCompatible, type CompiledFakeProverbRecipeSet, type CompileFakeProverbRecipeSetInput } from "../src/fakeProverb/compileRecipeSet";
import { FAKE_PROVERB_ALGORITHM_VERSION, FAKE_PROVERB_AUTHORITY_POLICY_VERSION } from "../src/fakeProverb/fakeProverbVersions";
import { FAKE_PROVERB_LIMITS, FAKE_PROVERB_RECIPE_SCHEMA_VERSION, type RawFakeProverbPart } from "../src/fakeProverb/recipeData";
import { fakeProverbFragmentInputFromRow, validateFragmentInputV4 } from "../src/collect/v4/CollectedFragmentV4";
import { NA_STEM_EXCLUDED } from "../src/vocabulary/lexicalProjection";
import { na, naStem } from "./fakeAlertCoreFixtures";
import { LEXICON, RECIPE_DATA_2_DIGEST, RICH_TEXT, compile, mintOwner, noun, ok, recipeData2Input, recipeData2Set, standardSet, token } from "./fakeProverbCoreFixtures";

/*
 * FAKE-PROVERB-RECIPES3 (`Docs/fake_proverb_recipes3_amendment1.md`): the one-line recipe format, proverbs without
 * a noun, and recipe data 3 (63 proverbs, 32 glosses). Recipe Schema and the algorithm stay 2: the same data draws the
 * same drafts, which the first block shows by writing recipe data 2 in the new format.
 */

const STEM_LEXICON = [...LEXICON, na, token("に", "助詞", "格助詞"), naStem("静か"), naStem("無慈悲"), naStem("かたくな"), ...NA_STEM_EXCLUDED.map(naStem), noun("机")];
const STEM_TEXT = `${RICH_TEXT}静かな猫。静かな犬。無慈悲な川。かたくなな月。${NA_STEM_EXCLUDED.map((stem) => `${stem}な鳥。`).join("")}机の星。`;

/** A set with every literal id replaced by its text: what the recipes mean, whatever their literals are called. */
function meaning(data: Pick<CompileFakeProverbRecipeSetInput, "proverbs" | "glosses" | "literals" | "profiles">): unknown {
	const text = new Map(data.literals.map((entry) => [entry.id, entry.literal]));
	const parts = (list: readonly RawFakeProverbPart[]) => list.map((part) => (part.kind === "literal" ? { kind: "literal", text: text.get(part.literalId ?? "") } : part));
	return {
		proverbs: data.proverbs.map((entry) => ({ ...entry, parts: parts(entry.parts) })),
		glosses: data.glosses.map((entry) => ({ ...entry, parts: parts(entry.parts) })),
		literals: [...text.values()].sort(),
		profiles: data.profiles,
	};
}

function data2InTheNewFormat(): CompileFakeProverbRecipeSetInput {
	const parsed = parseStandardFakeProverbRecipeMarkdown(readFileSync("tests/fixtures/regression/fakeProverbRecipes2.format3.md", "utf8"));
	if (!parsed.ok) throw new Error(describeFakeProverbSourceIssues(parsed.issues));
	return { schemaVersion: parsed.schemaVersion, dataVersion: parsed.dataVersion, proverbs: parsed.proverbs, glosses: parsed.glosses, literals: parsed.literals, profiles: parsed.profiles };
}

async function authorityFor(recipeSet: CompiledFakeProverbRecipeSet, text: string, drawMode: "uniform" | "frequency" = "uniform", lexicon: typeof LEXICON = STEM_LEXICON) {
	const { owner } = await mintOwner([text], drawMode, lexicon);
	return { owner, authority: ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet })) };
}
const drafts = (authority: FakeProverbAuthority, recipeSet: CompiledFakeProverbRecipeSet, nonces: number, first = 0): FakeProverbDraft[] =>
	Array.from({ length: nonces }, (_, index) => ok(generateFakeProverbs({ authority, recipeSet, drawMode: authority.provenance.drawMode, count: 10, nonce: first + index })).drafts).flat();
const told = (list: readonly FakeProverbDraft[]) => list.map((draft) => [draft.proverb.recipeId, draft.gloss.recipeId, draft.canonicalText,
	[...draft.proverb.bindings, ...draft.gloss.bindings].map((binding) => [binding.scope, binding.slotId, binding.profileId, binding.form, binding.surface])]);

describe("recipe data 2, written in the one-line format", () => {
	it("is compared with the payload the lock still names as version 2", () => {
		const lock = JSON.parse(readFileSync("resources/fake-proverb/standard-recipes.lock.json", "utf8")) as { versions: { dataVersion: number; digest: string }[] };
		expect(lock.versions[1]).toEqual({ dataVersion: 2, digest: RECIPE_DATA_2_DIGEST });
		// The fixture is the canonical payload itself: its bytes hash to that digest.
		expect(createHash("sha256").update(readFileSync("tests/fixtures/regression/fakeProverbRecipes2.json")).digest("hex")).toBe(RECIPE_DATA_2_DIGEST);
		const pinned = recipeData2Input();
		expect([pinned.schemaVersion, pinned.dataVersion, pinned.proverbs.length, pinned.glosses.length, pinned.literals.length, pinned.profiles.length]).toEqual([2, 2, 9, 6, 25, 6]);
	});

	it("says the same recipes: every slot, export, requirement, reference, profile, weight and order, and the same fixed texts", () => {
		const rewritten = data2InTheNewFormat();
		const pinned = recipeData2Input();
		expect([rewritten.schemaVersion, rewritten.dataVersion]).toEqual([pinned.schemaVersion, pinned.dataVersion]);
		expect(meaning(rewritten)).toEqual(meaning(pinned));
		// Only the names of the fixed texts differ: they were written by hand, and now come from the text.
		expect(pinned.literals.map((entry) => entry.id).slice(0, 3)).toEqual(["wa", "wo", "no"]);
		for (const entry of rewritten.literals) expect(entry.id).toBe(fakeProverbLiteralId(entry.literal));
		// The product compiler accepts both, as Recipe Schema 2.
		expect(compile(rewritten).proverbs.map((entry) => entry.exports)).toEqual(recipeData2Set().proverbs.map((entry) => entry.exports));
	});

	it.each([["uniform", RICH_TEXT], ["frequency", RICH_TEXT], ["uniform", STEM_TEXT], ["frequency", STEM_TEXT]] as const)(
		"draws the same drafts, word for word and binding for binding (%s)", async (drawMode, text) => {
			const before = recipeData2Set();
			const after = compile(data2InTheNewFormat());
			const first = await authorityFor(before, text, drawMode);
			const second = await authorityFor(after, text, drawMode);
			const expected = told(drafts(first.authority, before, 60));
			expect(expected).toHaveLength(600);
			expect(told(drafts(second.authority, after, 60))).toEqual(expected);
		});
});

/**
 * [the first draft, SHA-256 of all 200] for the uniform and the frequency draw (recipe data 4, algorithm 2). Data 3's
 * digests were a573c52a… and 7a20d818…; the first drafts are the same, and the next test says which drafts moved.
 */
const PINNED_DATA_4_DRAFTS: [string, string][] = [
	["**無慈悲に見る犬にこんななし**\n\n> 犬に頼りすぎると、夢まで待つことになるという戒め。", "efd38db75c6d3394f718f718392e3398727862b9bccbe440f17c6b7d91d63b0b"],
	["**無慈悲に見る静かに夢なし**\n\n> 静かに頼りすぎると、星まで待つことになるという戒め。", "468b844329ba526bbdf91be9177203fc00f7ac4a7be8df74b936edf28523e8b0"],
];

describe("recipe data 4 with the generator", () => {
	it("keeps Recipe Schema 2 and algorithm 2, and binds every form the 14 profiles use", async () => {
		const recipeSet = standardSet();
		expect([FAKE_PROVERB_RECIPE_SCHEMA_VERSION, FAKE_PROVERB_ALGORITHM_VERSION, FAKE_PROVERB_AUTHORITY_POLICY_VERSION]).toEqual([2, 2, "fake-proverb-authority-2"]);
		expect([recipeSet.schemaVersion, recipeSet.dataVersion, recipeSet.proverbs.length, recipeSet.glosses.length, recipeSet.literals.length, recipeSet.profiles.length])
			.toEqual([2, 4, 63, 32, 136, 14]);
		const { authority } = await authorityFor(recipeSet, STEM_TEXT);
		expect([authority.recipeSchemaVersion, authority.recipeDataVersion]).toEqual([2, 4]);
		// All seven declared forms are used now: the adverbial form had no recipe before.
		expect(authority.forms.map((entry) => entry.form)).toEqual(["adjective-basic", "independent-noun", "na-stem-na", "na-stem-ni", "verb-basic", "verb-negative", "verb-past"]);
		for (const entry of authority.forms) expect(entry.candidates.length, entry.form).toBeGreaterThan(0);
	});

	it("stays inside the raised limits, which are what the amendment names", () => {
		const recipeSet = standardSet();
		expect([FAKE_PROVERB_LIMITS.proverbs, FAKE_PROVERB_LIMITS.glosses, FAKE_PROVERB_LIMITS.literals, FAKE_PROVERB_LIMITS.profiles]).toEqual([128, 128, 512, 32]);
		// The limits of one recipe are the ones versions 1 and 2 had.
		expect([FAKE_PROVERB_LIMITS.parts, FAKE_PROVERB_LIMITS.slots, FAKE_PROVERB_LIMITS.exports, FAKE_PROVERB_LIMITS.requires, FAKE_PROVERB_LIMITS.references]).toEqual([
			{ proverb: 10, gloss: 14 }, { proverb: { noun: 4, modifier: 2, predicate: 1, adverbial: 1 }, gloss: { noun: 3, modifier: 2, predicate: 2, adverbial: 1 } }, 4, 4, 6,
		]);
		expect(Math.max(...recipeSet.proverbs.map((entry) => entry.parts.length))).toBe(7);
		expect(Math.max(...recipeSet.glosses.map((entry) => entry.parts.length))).toBe(8);
		expect(Math.max(...recipeSet.literals.map((entry) => [...entry.literal].length))).toBe(21);
	});

	it("draws every proverb and every gloss, each draft a proverb with a gloss that may follow it, and never falls short", async () => {
		const recipeSet = standardSet();
		const { authority } = await authorityFor(recipeSet, STEM_TEXT);
		const made = Array.from({ length: 120 }, (_, nonce) => ok(generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: 10, nonce })));
		expect(made.every((generation) => generation.shortfall === null && generation.drafts.length === 10)).toBe(true);
		const all = made.flatMap((generation) => generation.drafts);
		expect(new Set(all.map((draft) => draft.proverb.recipeId)).size).toBe(63);
		expect(new Set(all.map((draft) => draft.gloss.recipeId)).size).toBe(32);
		const proverbs = new Map(recipeSet.proverbs.map((entry) => [entry.id, entry]));
		const glosses = new Map(recipeSet.glosses.map((entry) => [entry.id, entry]));
		for (const draft of all) {
			expect(isFakeProverbGlossCompatible(proverbs.get(draft.proverb.recipeId)!, glosses.get(draft.gloss.recipeId)!)).toBe(true);
			// A gloss's word from the proverb is the proverb's own binding, never a second draw.
			for (const reference of draft.gloss.references) {
				if (!reference.slotId.startsWith("g")) expect(draft.proverb.bindings).toContain(reference.binding);
			}
		}
	});

	it("draws the pinned drafts of recipe data 4 with each draw mode", async () => {
		// What `npm test` remembers of the standard data's output: 200 drafts of each draw mode from one small Vocabulary,
		// as a digest of every recipe id, text and binding. An edit to the document's recipes, weights or order moves it,
		// and so would a change to the draw; the lock's digest and the recipe data 2 oracle say which of the two it was.
		const recipeSet = standardSet();
		const pinned: [string, string][] = [];
		for (const drawMode of ["uniform", "frequency"] as const) {
			const { authority } = await authorityFor(recipeSet, STEM_TEXT, drawMode);
			const made = drafts(authority, recipeSet, 20);
			expect(made).toHaveLength(200);
			pinned.push([made[0]!.canonicalText, createHash("sha256").update(JSON.stringify(told(made))).digest("hex")]);
		}
		expect(pinned).toEqual(PINNED_DATA_4_DRAFTS);
	});

	it("draws what recipe data 3 drew, apart from the proverb heart-unknown, whose fixed text gained a comma after 心", async () => {
		// Data 3 is data 4 with the one line put back: same recipe ids, weights and order, so the draw is the same draw.
		const markdown = readFileSync("resources/fake-proverb/standard-recipes.md", "utf8");
		expect(markdown.split("line: {n1}の心、{n2}知らず\n")).toHaveLength(2);
		const back = parseStandardFakeProverbRecipeMarkdown(markdown.replace("line: {n1}の心、{n2}知らず\n", "line: {n1}の心{n2}知らず\n").replace("data-version: 4", "data-version: 3"));
		if (!back.ok) throw new Error(describeFakeProverbSourceIssues(back.issues));
		const before = compile({ schemaVersion: back.schemaVersion, dataVersion: back.dataVersion, proverbs: back.proverbs, glosses: back.glosses, literals: back.literals, profiles: back.profiles });
		const after = standardSet();
		expect([before.dataVersion, after.dataVersion]).toEqual([3, 4]);
		let moved = 0, same = 0;
		for (const drawMode of ["uniform", "frequency"] as const) {
			const oldDrafts = told(drafts((await authorityFor(before, STEM_TEXT, drawMode)).authority, before, 80));
			const newDrafts = told(drafts((await authorityFor(after, STEM_TEXT, drawMode)).authority, after, 80));
			expect(newDrafts).toHaveLength(800);
			newDrafts.forEach((draft, index) => {
				const old = oldDrafts[index]!;
				if (draft[0] !== "heart-unknown") { expect(draft).toEqual(old); same++; return; }
				// The same proverb, gloss and words; only the proverb's text differs, by the comma.
				moved++;
				expect([draft[0], draft[1], draft[3]]).toEqual([old[0], old[1], old[3]]);
				expect(String(draft[2])).toContain("の心、");
				expect(String(draft[2]).replace("の心、", "の心")).toBe(old[2]);
			});
		}
		// Neither set of drafts is vacuous: heart-unknown came up, and so did every other kind of draft.
		expect(moved).toBeGreaterThan(5);
		expect(same).toBeGreaterThan(1000);
	});

	it("draws a proverb without a noun and gives it one of the four glosses that use its predicate alone", async () => {
		const recipeSet = standardSet();
		const { authority } = await authorityFor(recipeSet, STEM_TEXT);
		const nounless = drafts(authority, recipeSet, 120).filter((draft) => !draft.proverb.bindings.some((binding) => binding.kind === "noun"));
		expect(new Set(nounless.map((draft) => draft.proverb.recipeId))).toEqual(new Set(["wins", "easier-done", "easy-and-hard", "no-match-for-not"]));
		expect(new Set(nounless.map((draft) => draft.gloss.recipeId))).toEqual(new Set(["same-as-doing", "seems-to", "think-of-when", "thanks-to"]));
		for (const draft of nounless) {
			const predicate = draft.proverb.bindings.find((binding) => binding.kind === "predicate")!;
			expect(draft.gloss.references.map((entry) => entry.binding)).toEqual([predicate]);
			expect(draft.gloss.text.startsWith(predicate.surface)).toBe(true);
			// Two verbs in one proverb are two different words while another remains.
			expect(new Set(draft.proverb.bindings.map((binding) => binding.surface)).size).toBe(draft.proverb.bindings.length);
		}
		const win = nounless.find((draft) => draft.proverb.recipeId === "wins")!;
		expect(win.proverb.text).toBe(`${win.proverb.bindings[0]!.surface}が勝ち`);
	});

	it("gives a gloss that uses three nouns to the two proverbs that hand over three", async () => {
		const recipeSet = standardSet();
		const { authority } = await authorityFor(recipeSet, STEM_TEXT);
		const three = drafts(authority, recipeSet, 400).filter((draft) => ["only-measure", "likewise-has", "in-turn"].includes(draft.gloss.recipeId));
		expect(three.length).toBeGreaterThan(0);
		// Recipe data 3 exports genitive-destination's third noun; versions 1 and 2 kept it from the glosses.
		expect(new Set(three.map((draft) => draft.proverb.recipeId))).toEqual(new Set(["genitive-destination", "ear-prayer"]));
	});

	it("puts a stem plus に before the verb it modifies and a stem plus な before a noun", async () => {
		const recipeSet = standardSet();
		const { authority } = await authorityFor(recipeSet, STEM_TEXT);
		const all = drafts(authority, recipeSet, 120);
		const parts = new Map([...recipeSet.proverbs, ...recipeSet.glosses].map((entry) => [entry.id, entry.parts]));
		let adverbials = 0;
		let stems = 0;
		for (const draft of all) {
			for (const [scope, recipeId, bindings] of [["proverb", draft.proverb.recipeId, draft.proverb.bindings], ["gloss", draft.gloss.recipeId, draft.gloss.bindings]] as const) {
				const text = scope === "proverb" ? draft.proverb.text : draft.gloss.text;
				for (const binding of bindings) {
					if (binding.form !== "na-stem-ni" && binding.form !== "na-stem-na") continue;
					// The excluded stems (こんな, 同じ …) never take an ending.
					expect(NA_STEM_EXCLUDED.map((stem) => `${stem}${binding.form === "na-stem-ni" ? "に" : "な"}`)).not.toContain(binding.surface);
					expect(binding.surface).not.toBe("かたくなな");
					const index = parts.get(recipeId)!.findIndex((part) => part.kind !== "literal" && part.kind !== "reference" && part.slotId === binding.slotId);
					const next = parts.get(recipeId)![index + 1]!;
					expect(text).toContain(binding.surface);
					if (binding.form === "na-stem-ni") {
						adverbials += 1;
						expect(["predicate", "modifier"]).toContain(next.kind === "reference" ? next.slotKind : next.kind);
					} else {
						stems += 1;
						expect(next.kind === "noun" || next.kind === "literal" || (next.kind === "reference" && next.slotKind === "noun")).toBe(true);
					}
				}
			}
		}
		expect(adverbials).toBeGreaterThan(20);
		expect(stems).toBeGreaterThan(20);
	});

	it("says why it cannot fill a batch when the Vocabulary has verbs but no noun", async () => {
		const recipeSet = standardSet();
		const verbsOnly = "見る。書く。泳ぐ。読む。待つ。話す。買う。";
		const { authority } = await authorityFor(recipeSet, verbsOnly, "uniform", LEXICON);
		expect(authority.forms.find((entry) => entry.form === "independent-noun")!.candidates).toEqual([]);
		// The four proverbs without a noun could be drawn, but every gloss needs a new noun of its own.
		const generation = ok(generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: 10, nonce: 3 }));
		expect([generation.drafts.length, generation.shortfall]).toEqual([0, "no-compatible-gloss"]);
	});

	it("copies and collects a row whose proverb has no noun like any other row", async () => {
		const recipeSet = standardSet();
		const { owner } = await mintOwner([STEM_TEXT], "uniform", STEM_LEXICON);
		let counter = 0;
		const material = (): string => (++counter).toString(16).padStart(64, "b");
		const names = new Set(["wins", "easier-done", "easy-and-hard", "no-match-for-not"]);
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const controller = ok(createFakeProverbBatchController({ identityMaterial: material() }));
			const ticket = ok(controller.beginGenerate({ vocabulary: owner, recipeSet, operationMaterial: material() }));
			const batch = ok(controller.complete(ticket, ok(controller.prepare(ticket)))).batch!;
			const row = batch.rows.find((entry) => entry.committed !== null && names.has(entry.committed.proverbRecipeId));
			if (row === undefined) continue;
			const record = ok(readFakeProverbRow({ batch, rowSlotId: row.rowSlotId }));
			expect([record.algorithmVersion, record.recipeSchemaVersion, record.recipeDataVersion]).toEqual([2, 2, 4]);
			expect(record.canonicalText).toMatch(/^\*\*.+\*\*\n\n> .+$/u);
			const input = fakeProverbFragmentInputFromRow(record);
			expect(input.ok).toBe(true);
			if (input.ok) {
				expect(validateFragmentInputV4(input.value)).toBeNull();
				expect([input.value.text, input.value.recipeDataVersion, input.value.proverbRecipeId]).toEqual([record.canonicalText, 4, record.proverbRecipeId]);
			}
			return;
		}
		throw new Error("no batch held a proverb without a noun");
	});
});
