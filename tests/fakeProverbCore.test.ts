import { describe, expect, it } from "vitest";
import { buildAuthenticatedCollisionLexemePool } from "../src/collision/collisionVocabulary";
import {
	STANDARD_COLLISION_CONNECTORS,
	STANDARD_COLLISION_LITERALS,
	STANDARD_COLLISION_MODIFIER_FORMS,
	STANDARD_COLLISION_NOUN_SUFFIXES,
	STANDARD_COLLISION_RECIPES,
} from "../src/collision/generated/standardCollisionPatternEntries";
import { compileCollisionPatternSet } from "../src/collision/compilePatternSet";
import {
	FAKE_PROVERB_DECLARED_FORMS,
	createFakeProverbAuthority,
	fakeProverbUnboundForms,
	inspectFakeProverbAuthority,
	isFakeProverbSafeText,
	releaseFakeProverbAuthority,
	releaseFakeProverbOwner,
	type FakeProverbAuthority,
} from "../src/fakeProverb/fakeProverbAuthority";
import {
	FAKE_PROVERB_ATTEMPT_LIMIT,
	FAKE_PROVERB_MAX_COUNT,
	fakeProverbCanonicalText,
	generateFakeProverbs,
	type FakeProverbDraft,
	type FakeProverbGeneration,
} from "../src/fakeProverb/fakeProverbCore";
import { FAKE_PROVERB_ALGORITHM_VERSION } from "../src/fakeProverb/fakeProverbVersions";
import type { CompiledFakeProverbRecipeSet } from "../src/fakeProverb/compileRecipeSet";
import { deepFrozen } from "./automaticPosFixtures";
import {
	RICH_TEXT,
	adjective,
	compile,
	customInput,
	literal,
	mintOwner,
	noun,
	ok,
	particle,
	period,
	reference,
	slot,
	standardInput,
	standardSet,
	verb,
} from "./fakeProverbCoreFixtures";

async function richAuthority(drawMode: "uniform" | "frequency" = "uniform", texts: readonly string[] = [RICH_TEXT]) {
	const minted = await mintOwner(texts, drawMode);
	const recipeSet = standardSet();
	const authority = ok(createFakeProverbAuthority({ vocabulary: minted.owner, recipeSet }));
	return { ...minted, recipeSet, authority };
}

const surfaces = (authority: FakeProverbAuthority, form: string) =>
	authority.forms.find((entry) => entry.form === form)?.candidates.map((candidate) => candidate.surface) ?? [];

function generate(authority: FakeProverbAuthority, recipeSet: CompiledFakeProverbRecipeSet, nonce = 7, count = FAKE_PROVERB_MAX_COUNT,
	drawMode: "uniform" | "frequency" = authority.provenance.drawMode): FakeProverbGeneration {
	return ok(generateFakeProverbs({ authority, recipeSet, drawMode, count, nonce }));
}

function refusal(answer: { ok: boolean; reason?: string }): string {
	expect(answer.ok).toBe(false);
	expect(Object.keys(answer).sort()).toEqual(["ok", "reason"]);
	return answer.reason!;
}

const NO_LEAK = /private-note|[猫犬夢骨川月星鳥]|見る|書く|Error|at /u;

describe("the Fake Proverb authority", () => {
	it("binds every declared Recipe Schema 1 form to the closed realizer, so none is silently dropped", () => {
		expect(FAKE_PROVERB_DECLARED_FORMS).toEqual(["adjective-basic", "independent-noun", "verb-basic", "verb-negative", "verb-past"]);
		expect(fakeProverbUnboundForms()).toEqual([]);
	});

	it("derives each used form from the owner's Snapshot through the realizer, with realizer key and preserved follower as evidence", async () => {
		const { authority } = await richAuthority();
		expect(authority.forms.map((entry) => entry.form)).toEqual(["adjective-basic", "independent-noun", "verb-basic", "verb-negative", "verb-past"]);
		expect(surfaces(authority, "independent-noun")).toEqual(["夢", "川", "星", "月", "犬", "猫", "骨", "鳥"]);
		expect(surfaces(authority, "adjective-basic")).toEqual(["早い", "美しい"]);
		expect(surfaces(authority, "verb-basic")).toEqual(["待つ", "書く", "泳ぐ", "見る", "話す", "読む", "買う"]);
		expect(surfaces(authority, "verb-past")).toEqual(["待った", "書いた", "泳いだ", "見た", "話した", "読んだ", "買った"]);
		expect(surfaces(authority, "verb-negative")).toEqual(["待たない", "書かない", "泳がない", "見ない", "話さない", "読まない", "買わない"]);
		const past = authority.forms.find((entry) => entry.form === "verb-past")!.candidates;
		const evidence = (surface: string) => past.find((candidate) => candidate.surface === surface)!.evidence[0]!;
		expect(evidence("泳いだ")).toMatchObject({ kind: "lexeme", realizerKey: "verb-ta-stem-d", follower: "aux-da", conjugationType: "五段・ガ行", baseForm: "泳ぐ" });
		expect(evidence("書いた")).toMatchObject({ kind: "lexeme", realizerKey: "verb-ta-stem-t", follower: "aux-ta", conjugationType: "五段・カ行イ音便" });
		expect(evidence("見た")).toMatchObject({ realizerKey: "verb-ta-stem-t", follower: "aux-ta", conjugationType: "一段" });
		const negative = authority.forms.find((entry) => entry.form === "verb-negative")!.candidates;
		for (const candidate of negative) expect(candidate.evidence).toEqual([expect.objectContaining({ realizerKey: "verb-irrealis-negation", follower: "aux-nai" })]);
	});

	it("never admits an irregular lexeme or an unadmitted class, in any form", async () => {
		const { authority } = await richAuthority();
		const all = authority.forms.flatMap((entry) => entry.candidates.map((candidate) => candidate.surface));
		for (const refused of ["ある", "あっ", "あった", "あらない", "する", "した", "しない", "さない"]) expect(all).not.toContain(refused);
	});

	it("derives only the forms the bound recipe set uses", async () => {
		const { owner } = await mintOwner([RICH_TEXT]);
		const narrow = compile(customInput({ predicateForms: [{ form: "verb-negative", weight: 1 }] }));
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: narrow }));
		expect(authority.forms.map((entry) => entry.form)).toEqual(["independent-noun", "verb-negative"]);
	});

	it("captures every Vocabulary Source, the fingerprint and the draw mode, and aggregates frequency and origins", async () => {
		const { owner, authority } = await richAuthority("frequency", [RICH_TEXT, "猫は猫を見た。"]);
		expect(authority.provenance).toEqual({ vocabularyFingerprint: owner.snapshot.fingerprint, drawMode: "frequency",
			sources: owner.snapshot.sources.map((source) => ({ ...source })) });
		expect(authority.provenance.sources.map((source) => source.path)).toEqual(["private-note-0.md", "private-note-1.md"]);
		const cat = authority.forms.find((entry) => entry.form === "independent-noun")!.candidates.find((candidate) => candidate.surface === "猫")!;
		expect(cat.frequency).toBe(4);
		expect(cat.origins.map((origin) => [origin.path, origin.count])).toEqual([["private-note-0.md", 2], ["private-note-1.md", 2]]);
		// 見る observed as 見る and 見 (連用形) is one lexeme: frequency and origins counted once per record.
		const see = authority.forms.find((entry) => entry.form === "verb-basic")!.candidates.find((candidate) => candidate.surface === "見る")!;
		expect(see.evidence).toHaveLength(1);
		expect(see.frequency).toBe(see.evidence[0]!.kind === "lexeme" ? owner.snapshot.projections.manual.candidates
			.filter((record) => record.morphology.baseForm === "見る").reduce((sum, record) => sum + record.frequency, 0) : -1);
		expect(deepFrozen(authority)).toBe(true);
	});

	it("never re-reads or re-tokenizes a Source to mint, inspect or generate", async () => {
		const { calls, authority, recipeSet } = await richAuthority();
		const before = calls();
		expect(ok(inspectFakeProverbAuthority({ authority, recipeSet }))).toBe(true);
		generate(authority, recipeSet);
		expect(calls()).toBe(before);
	});

	it("keeps unsafe surfaces out even when the Snapshot projects them", () => {
		for (const safe of ["猫", "ABC", "C3", "早い", "ことのたとえ。", "は、いずれ"]) expect(isFakeProverbSafeText(safe)).toBe(true);
		for (const unsafe of ["", "a*b", "a_b", "#猫", "[猫]", "猫>", "`猫`", "猫 犬", "猫\u3000", "猫\u200d", "猫\u0000", "猫\ud800", "か\u3099", "~~", "==", "$x$", "%%", "a|b", "a\\b", 3]) {
			expect(isFakeProverbSafeText(unsafe)).toBe(false);
		}
	});
});

describe("Fake Proverb authentication and forged input", () => {
	it("refuses a raw Snapshot, a spread or cloned owner and a Collision pool as the Vocabulary", async () => {
		const { owner, recipeSet } = await richAuthority();
		const patternSet = compileCollisionPatternSet({ schemaVersion: 2, dataVersion: 2, recipes: STANDARD_COLLISION_RECIPES, literals: STANDARD_COLLISION_LITERALS,
			connectors: STANDARD_COLLISION_CONNECTORS, modifierForms: STANDARD_COLLISION_MODIFIER_FORMS, nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES });
		expect(patternSet.ok).toBe(true);
		const pool = patternSet.ok ? buildAuthenticatedCollisionLexemePool({ vocabulary: owner, patternData: patternSet.set }) : null;
		expect(pool?.ok).toBe(true);
		for (const vocabulary of [owner.snapshot, { ...owner }, { ...owner, snapshot: structuredClone(owner.snapshot) }, pool?.ok ? pool.pool : null, null]) {
			expect(refusal(createFakeProverbAuthority({ vocabulary: vocabulary as never, recipeSet }))).toBe("invalid-vocabulary");
		}
	});

	it("refuses a recipe set that is not frozen or does not survive recompilation, and a Collision pattern set", async () => {
		const { owner } = await richAuthority();
		const set = standardSet();
		const rewritten = structuredClone(set) as unknown as { proverbs: { exports: { kind: string; slotId: string }[] }[] };
		rewritten.proverbs[0]!.exports.push({ kind: "noun", slotId: "n9" });
		const frozenRewrite = JSON.parse(JSON.stringify(rewritten)) as object;
		deepFreeze(frozenRewrite);
		const collision = compileCollisionPatternSet({ schemaVersion: 2, dataVersion: 2, recipes: STANDARD_COLLISION_RECIPES, literals: STANDARD_COLLISION_LITERALS,
			connectors: STANDARD_COLLISION_CONNECTORS, modifierForms: STANDARD_COLLISION_MODIFIER_FORMS, nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES });
		for (const recipeSet of [structuredClone(set), frozenRewrite, standardInput(), collision.ok ? collision.set : null]) {
			expect(refusal(createFakeProverbAuthority({ vocabulary: owner, recipeSet: recipeSet as never }))).toBe("invalid-recipe-set");
		}
	});

	it("refuses extra fields and never runs a getter", async () => {
		const { owner, recipeSet } = await richAuthority();
		let ran = false;
		const withGetter = { recipeSet, get vocabulary() { ran = true; return owner; } };
		expect(refusal(createFakeProverbAuthority(withGetter))).toBe("invalid-request");
		expect(ran).toBe(false);
		expect(refusal(createFakeProverbAuthority({ vocabulary: owner, recipeSet, extra: 1 } as never))).toBe("invalid-request");
	});

	it("refuses a cloned, rewritten or foreign authority, and an authority used with another recipe set", async () => {
		const { owner, authority, recipeSet } = await richAuthority();
		const clone = structuredClone(authority);
		const rewritten = JSON.parse(JSON.stringify(authority).replace("\"犬\"", "\"狼\"")) as FakeProverbAuthority;
		for (const forged of [clone, rewritten, { ...authority }]) {
			expect(refusal(inspectFakeProverbAuthority({ authority: forged, recipeSet }))).toBe("invalid-authority");
			expect(refusal(generateFakeProverbs({ authority: forged, recipeSet, drawMode: "uniform", count: 1, nonce: 1 }))).toBe("invalid-authority");
		}
		const otherSet = standardSet();
		expect(refusal(generateFakeProverbs({ authority, recipeSet: otherSet, drawMode: "uniform", count: 1, nonce: 1 }))).toBe("recipe-binding-mismatch");
		// A second authority from the same owner is its own binding.
		const second = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: otherSet }));
		expect(ok(generateFakeProverbs({ authority: second, recipeSet: otherSet, drawMode: "uniform", count: 1, nonce: 1 })).drafts).toHaveLength(1);
	});

	it("keeps refusals free of paths, note text, surfaces and exception messages", async () => {
		const { owner, authority, recipeSet } = await richAuthority();
		const answers = [
			createFakeProverbAuthority({ vocabulary: owner.snapshot as never, recipeSet }),
			generateFakeProverbs({ authority: structuredClone(authority), recipeSet, drawMode: "uniform", count: 1, nonce: 1 }),
			generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: 0, nonce: 1 }),
			generateFakeProverbs(null as never),
		];
		for (const answer of answers) expect(JSON.stringify(answer)).not.toMatch(NO_LEAK);
	});
});

describe("Fake Proverb release and staleness", () => {
	it.each([["refresh", "released"], ["view-close", "released"], ["plugin-disable", "released"], ["source-changed", "stale"]] as const)(
		"revokes the owner on %s, refusing generation, inspection and a new authority from it", async (reason, expected) => {
			const { owner, authority, recipeSet } = await richAuthority();
			expect(ok(releaseFakeProverbAuthority({ authority, reason }))).toBe(true);
			expect(refusal(generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: 1, nonce: 1 }))).toBe(expected);
			expect(refusal(inspectFakeProverbAuthority({ authority, recipeSet }))).toBe(expected);
			expect(refusal(createFakeProverbAuthority({ vocabulary: owner, recipeSet }))).toBe(expected);
			expect(refusal(releaseFakeProverbAuthority({ authority, reason }))).toBe(expected);
			// A freshly minted owner over the same Source is unaffected.
			const fresh = await richAuthority();
			expect(generate(fresh.authority, fresh.recipeSet).drafts).toHaveLength(FAKE_PROVERB_MAX_COUNT);
		});

	it.each([["refresh", "released"], ["source-changed", "stale"]] as const)(
		"revokes an owner directly, without an authority, on %s", async (reason, expected) => {
			const { owner } = await mintOwner([RICH_TEXT]);
			const recipeSet = standardSet();
			expect(ok(releaseFakeProverbOwner({ vocabulary: owner, reason }))).toBe(true);
			expect(refusal(createFakeProverbAuthority({ vocabulary: owner, recipeSet }))).toBe(expected);
			expect(refusal(releaseFakeProverbOwner({ vocabulary: owner, reason }))).toBe(expected);
		});

	it("refuses an owner-level release for a look-alike owner or an unknown reason", async () => {
		const { owner } = await mintOwner([RICH_TEXT]);
		expect(refusal(releaseFakeProverbOwner({ vocabulary: { ...owner }, reason: "refresh" }))).toBe("invalid-vocabulary");
		expect(refusal(releaseFakeProverbOwner({ vocabulary: owner.snapshot as never, reason: "refresh" }))).toBe("invalid-vocabulary");
		expect(refusal(releaseFakeProverbOwner({ vocabulary: owner, reason: "later" as never }))).toBe("invalid-request");
		expect(refusal(releaseFakeProverbOwner({ vocabulary: owner, reason: "refresh", extra: 1 } as never))).toBe("invalid-request");
		// Nothing was revoked by the refused calls.
		expect(ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: standardSet() })).forms.length).toBeGreaterThan(0);
	});

	it("refuses an unknown release reason and a forged authority without revoking anything", async () => {
		const { authority, recipeSet } = await richAuthority();
		expect(refusal(releaseFakeProverbAuthority({ authority, reason: "later" as never }))).toBe("invalid-request");
		expect(refusal(releaseFakeProverbAuthority({ authority: structuredClone(authority), reason: "refresh" }))).toBe("invalid-authority");
		expect(generate(authority, recipeSet).drafts).toHaveLength(FAKE_PROVERB_MAX_COUNT);
	});
});

function checkDraft(draft: FakeProverbDraft, recipeSet: CompiledFakeProverbRecipeSet): void {
	const literals = new Map(recipeSet.literals.map((entry) => [entry.id, entry.literal]));
	const proverb = recipeSet.proverbs.find((entry) => entry.id === draft.proverb.recipeId)!;
	const gloss = recipeSet.glosses.find((entry) => entry.id === draft.gloss.recipeId)!;
	// Every proverb slot is drawn exactly once, in part order.
	expect(draft.proverb.bindings.map((binding) => binding.slotId)).toEqual(proverb.parts.flatMap((part) => (part.kind === "literal" ? [] : [part.slotId])));
	let bindingIndex = 0;
	expect(draft.proverb.text).toBe(proverb.parts.map((part) => (part.kind === "literal" ? literals.get(part.literalId) : draft.proverb.bindings[bindingIndex++]!.surface)).join(""));
	let localIndex = 0;
	let referenceIndex = 0;
	expect(draft.gloss.text).toBe(gloss.parts.map((part) => {
		if (part.kind === "literal") return literals.get(part.literalId);
		if (part.kind === "reference") return draft.gloss.references[referenceIndex++]!.binding.surface;
		return draft.gloss.bindings[localIndex++]!.surface;
	}).join(""));
	for (const entry of draft.gloss.references) {
		// The very object the proverb drew: same identity, surface, candidate and form. Never a re-draw.
		const shared = draft.proverb.bindings.find((binding) => binding === entry.binding);
		expect(shared).toBeDefined();
		expect(proverb.exports.some((item) => item.slotId === entry.slotId && item.kind === entry.binding.kind)).toBe(true);
	}
	for (const binding of draft.gloss.bindings) {
		expect(binding.scope).toBe("gloss");
		expect(draft.proverb.bindings).not.toContain(binding);
	}
	for (const binding of [...draft.proverb.bindings, ...draft.gloss.bindings]) {
		expect(binding.surface).toBe(binding.candidate.surface);
		expect(binding.form).toBe(binding.candidate.form);
		const profile = recipeSet.profiles.find((entry) => entry.id === binding.profileId)!;
		expect(profile.kind).toBe(binding.kind);
		expect(profile.forms.map((entry) => entry.form)).toContain(binding.form);
	}
	expect(draft.canonicalText).toBe(`**${draft.proverb.text}**\n\n> ${draft.gloss.text}`);
	expect(draft.canonicalText.endsWith("\n")).toBe(false);
	expect(isFakeProverbSafeText(draft.proverb.text) && isFakeProverbSafeText(draft.gloss.text)).toBe(true);
}

describe("Fake Proverb generation", () => {
	it("composes ten inseparable proverb and gloss drafts whose references are the proverb's own bindings", async () => {
		const { authority, recipeSet } = await richAuthority();
		const generation = generate(authority, recipeSet);
		expect(generation.algorithmVersion).toBe(FAKE_PROVERB_ALGORITHM_VERSION);
		expect(FAKE_PROVERB_ALGORITHM_VERSION).toBe(1);
		expect([generation.recipeSchemaVersion, generation.recipeDataVersion, generation.requestedCount, generation.shortfall]).toEqual([1, 1, 10, null]);
		expect(generation.provenance).toBe(authority.provenance);
		expect(generation.drafts).toHaveLength(10);
		expect(new Set(generation.drafts.map((draft) => draft.canonicalText)).size).toBe(10);
		for (const draft of generation.drafts) checkDraft(draft, recipeSet);
		expect(deepFrozen(generation)).toBe(true);
	});

	it("never exposes a nonce, batch, row or Collect identity", async () => {
		const { authority, recipeSet } = await richAuthority();
		const nonce = 3_141_592_653;
		const json = JSON.stringify(generate(authority, recipeSet, nonce));
		for (const key of ["nonce", "seed", "batchId", "rowId", "rowSlotId", "metadataVersion", "collect", "generationRevision"]) expect(json).not.toContain(`"${key}"`);
		expect(json).not.toContain(String(nonce));
	});

	// Algorithm 1 oracle: a change to pairing, draw order, stream domain or composition changes these and needs a new algorithm version.
	it("pins algorithm 1's exact drafts for one Vocabulary, recipe set and nonce", async () => {
		const { authority, recipeSet } = await richAuthority();
		expect(generate(authority, recipeSet, 7, 3).drafts.map((draft) => [draft.proverb.recipeId, draft.gloss.recipeId, draft.canonicalText])).toEqual([
			["offered-to", "eventual-sameness", "**骨に犬**\n\n> 骨と犬は、いずれ月になるという戒め。"],
			["rather-than", "mistaken-belief", "**骨より星**\n\n> 骨を買うものと思い込むと、かえって月を失うという教え。"],
			["born-of", "misplaced-purpose", "**月から出た星**\n\n> 月が星において川を泳ぐことのたとえ。"],
		]);
	});

	it("is deterministic for one nonce and varies across nonces", async () => {
		const { authority, recipeSet } = await richAuthority();
		const texts = (nonce: number) => generate(authority, recipeSet, nonce).drafts.map((draft) => draft.canonicalText);
		expect(texts(11)).toEqual(texts(11));
		expect(new Set([11, 12, 13, 14].map((nonce) => JSON.stringify(texts(nonce)))).size).toBe(4);
	});

	it("realizes every profile form through the bound candidate, with the preserved follower", async () => {
		const { authority, recipeSet } = await richAuthority();
		const bindings = Array.from({ length: 30 }, (_, nonce) => generate(authority, recipeSet, nonce).drafts)
			.flat().flatMap((draft) => [...draft.proverb.bindings, ...draft.gloss.bindings]);
		const forms = new Set(bindings.map((binding) => binding.form));
		expect([...forms].sort()).toEqual(["adjective-basic", "independent-noun", "verb-basic", "verb-negative", "verb-past"]);
		for (const binding of bindings) {
			const evidence = binding.candidate.evidence;
			if (binding.form === "independent-noun") expect(evidence.every((item) => item.kind === "record")).toBe(true);
			if (binding.form === "verb-past") expect(binding.surface).toMatch(/[ただ]$/u);
			if (binding.form === "verb-negative") expect(binding.surface).toMatch(/ない$/u);
			if (binding.form !== "independent-noun") expect(evidence.every((item) => item.kind === "lexeme")).toBe(true);
		}
	});

	it("never lets a gloss reach an unexported proverb slot", async () => {
		const { authority, recipeSet } = await richAuthority();
		const drafts = Array.from({ length: 40 }, (_, nonce) => generate(authority, recipeSet, nonce).drafts).flat();
		const genitive = drafts.filter((draft) => draft.proverb.recipeId === "genitive-destination");
		expect(genitive.length).toBeGreaterThan(0);
		for (const draft of genitive) {
			expect(draft.gloss.recipeId).not.toBe("only-measure");
			expect(draft.gloss.references.map((entry) => entry.slotId)).not.toContain("n3");
		}
	});

	it("keeps gloss-local draws separate and avoids repeating a surface inside one draft while another remains", async () => {
		const { authority, recipeSet } = await richAuthority();
		for (const draft of Array.from({ length: 20 }, (_, nonce) => generate(authority, recipeSet, nonce).drafts).flat()) {
			const drawn = [...draft.proverb.bindings, ...draft.gloss.bindings].map((binding) => binding.surface);
			expect(new Set(drawn).size).toBe(drawn.length);
		}
	});

	it("does not mutate the authority or the recipe set", async () => {
		const { authority, recipeSet } = await richAuthority();
		const before = [JSON.stringify(authority), JSON.stringify(recipeSet)];
		generate(authority, recipeSet);
		expect([JSON.stringify(authority), JSON.stringify(recipeSet)]).toEqual(before);
		expect(ok(inspectFakeProverbAuthority({ authority, recipeSet }))).toBe(true);
	});

	it("refuses malformed requests and a draw mode other than the captured one", async () => {
		const { authority, recipeSet } = await richAuthority();
		for (const [count, nonce] of [[0, 1], [11, 1], [1.5, 1], [1, -1], [1, 2 ** 32], [1, 0.5], ["1", 1]] as const) {
			expect(refusal(generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: count as number, nonce }))).toBe("invalid-request");
		}
		expect(refusal(generateFakeProverbs({ authority, recipeSet, drawMode: "frequency", count: 1, nonce: 1 }))).toBe("provenance-mismatch");
		expect(refusal(generateFakeProverbs({ authority, recipeSet, drawMode: "sometimes" as never, count: 1, nonce: 1 }))).toBe("invalid-request");
		expect(refusal(generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: 1, nonce: 1, extra: true } as never))).toBe("invalid-request");
		expect(ok(generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: 1, nonce: 2 ** 32 - 1 })).drafts).toHaveLength(1);
	});
});

describe("weight separation", () => {
	const share = (values: readonly string[], value: string) => values.filter((item) => item === value).length / values.length;

	it("draws the form by profile weight, whatever the number of candidates behind each form", async () => {
		// 2 adjectives against 7 verbs, at 1 : 1 form weight: the form split stays near half.
		const { owner } = await mintOwner([RICH_TEXT]);
		const recipeSet = compile(customInput({ predicateForms: [{ form: "adjective-basic", weight: 1 }, { form: "verb-basic", weight: 1 }] }));
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
		const forms = Array.from({ length: 400 }, (_, nonce) => generate(authority, recipeSet, nonce, 1).drafts[0]!.proverb.bindings[1]!.form);
		expect(share(forms, "adjective-basic")).toBeGreaterThan(0.4);
		expect(share(forms, "adjective-basic")).toBeLessThan(0.6);
		// 9 : 1 form weight moves it; the candidate counts do not.
		const weighted = compile(customInput({ predicateForms: [{ form: "adjective-basic", weight: 9 }, { form: "verb-basic", weight: 1 }] }));
		const weightedAuthority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet: weighted }));
		const moved = Array.from({ length: 400 }, (_, nonce) => generate(weightedAuthority, weighted, nonce, 1).drafts[0]!.proverb.bindings[1]!.form);
		expect(share(moved, "adjective-basic")).toBeGreaterThan(0.8);
	});

	it("draws candidates by Vocabulary Uniform or Frequency without touching the form or recipe draw", async () => {
		const heavy = "月月月月月月月月月月月月月月月月月月月は見る。猫は見る。犬は見る。";
		const pick = async (drawMode: "uniform" | "frequency") => {
			const { owner } = await mintOwner([heavy], drawMode);
			const recipeSet = compile(customInput());
			const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
			return Array.from({ length: 300 }, (_, nonce) => generate(authority, recipeSet, nonce, 1).drafts[0]!.proverb.bindings[0]!.surface);
		};
		const uniform = await pick("uniform");
		const frequency = await pick("frequency");
		expect(share(uniform, "月")).toBeLessThan(0.5);
		expect(share(frequency, "月")).toBeGreaterThan(0.75);
	});

	it("draws the proverb by recipe weight and the gloss by gloss weight, as two draws", async () => {
		// p-heavy pairs with one gloss, p-light with three: how many glosses a proverb has must not weight the proverb.
		const { owner } = await mintOwner([RICH_TEXT]);
		const proverbs = [
			{ id: "p-heavy", enabled: true, weight: 3, parts: [slot("noun", "n1", "noun-p", true), literal("wa"), slot("predicate", "v1", "pred-p")] },
			{ id: "p-light", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true), literal("to"), slot("noun", "n2", "noun-p", true)] },
		];
		const glosses = [
			{ id: "g-shared", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n1" }], parts: [reference("noun", "n1"), literal("to"), slot("noun", "g1", "noun-p")] },
			{ id: "g-heavy", enabled: true, weight: 3, requires: [{ kind: "noun", slotId: "n2" }], parts: [reference("noun", "n2"), literal("wa"), slot("noun", "g1", "noun-p")] },
			{ id: "g-light", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n2" }], parts: [reference("noun", "n2"), literal("to"), slot("noun", "g1", "noun-p")] },
		];
		const recipeSet = compile(customInput({ proverbs, glosses }));
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
		const drafts = Array.from({ length: 600 }, (_, nonce) => generate(authority, recipeSet, nonce, 1).drafts[0]!);
		const proverbIds = drafts.map((draft) => draft.proverb.recipeId);
		expect(share(proverbIds, "p-heavy")).toBeGreaterThan(0.67);
		expect(share(proverbIds, "p-heavy")).toBeLessThan(0.83);
		// Within p-light the gloss weights 1 : 3 : 1 decide alone.
		const light = drafts.filter((draft) => draft.proverb.recipeId === "p-light").map((draft) => draft.gloss.recipeId);
		expect(share(light, "g-heavy")).toBeGreaterThan(0.45);
		expect(share(light, "g-heavy")).toBeLessThan(0.75);
		expect(drafts.filter((draft) => draft.proverb.recipeId === "p-heavy").every((draft) => draft.gloss.recipeId === "g-shared")).toBe(true);
	});
});

describe("duplicates, shortage and finite termination", () => {
	it("never pads with an exact duplicate and stops as duplicate-exhaustion", async () => {
		// One noun and one verb: exactly one distinct proverb + gloss pair exists.
		const { owner } = await mintOwner(["猫は見る。"]);
		const recipeSet = compile(customInput());
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
		const generation = generate(authority, recipeSet, 5, 3);
		expect(generation.drafts.map((draft) => draft.canonicalText)).toEqual(["**猫は見る**\n\n> 猫と猫"]);
		expect(generation.shortfall).toBe("duplicate-exhaustion");
		expect(FAKE_PROVERB_ATTEMPT_LIMIT).toBeGreaterThan(1);
	});

	it("returns insufficient-candidates, with no draft, when no proverb can be filled", async () => {
		const { owner } = await mintOwner(["猫と犬。"]);
		const recipeSet = compile(customInput());
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
		const generation = generate(authority, recipeSet);
		expect([generation.drafts.length, generation.shortfall]).toEqual([0, "insufficient-candidates"]);
	});

	it("returns no-compatible-gloss when proverbs can be filled but no compatible gloss can", async () => {
		const { owner } = await mintOwner(["猫と犬。"]);
		const recipeSet = compile(customInput({
			proverbs: [{ id: "p-one", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true), literal("to"), slot("noun", "n2", "noun-p")] }],
			glosses: [{ id: "g-one", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n1" }], parts: [reference("noun", "n1"), literal("wa"), slot("predicate", "g1", "pred-p")] }],
		}));
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
		const generation = generate(authority, recipeSet);
		expect([generation.drafts.length, generation.shortfall]).toEqual([0, "no-compatible-gloss"]);
	});

	it("uses an inviable profile form's sibling instead of failing the slot", async () => {
		// verb-negative has no candidate here (no verbs); adjective-basic does.
		const { owner } = await mintOwner(["猫は早い。"]);
		const recipeSet = compile(customInput({ predicateForms: [{ form: "verb-negative", weight: 100 }, { form: "adjective-basic", weight: 1 }] }));
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
		const generation = generate(authority, recipeSet, 1, 1);
		expect(generation.drafts[0]!.proverb.text).toBe("猫は早い");
	});

	it("terminates for a Vocabulary with no placeable word", async () => {
		const { owner } = await mintOwner(["。。"]);
		const recipeSet = standardSet();
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
		expect(authority.forms.every((entry) => entry.candidates.length === 0)).toBe(true);
		expect(generate(authority, recipeSet).shortfall).toBe("insufficient-candidates");
	});
});

describe("canonical text", () => {
	it("is **{proverb}**, a blank line and a quoted gloss, with no terminal newline", () => {
		expect(fakeProverbCanonicalText("猫に小判", "価値のわからないことのたとえ。")).toBe("**猫に小判**\n\n> 価値のわからないことのたとえ。");
	});
});

function deepFreeze(value: unknown): void {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
	for (const child of Object.values(value)) deepFreeze(child);
	Object.freeze(value);
}

// Keep fixture helpers referenced so a lexicon change is visible here.
void [adjective, noun, particle, period, verb];
