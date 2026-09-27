import { beforeAll, describe, expect, it } from "vitest";
import { createFakeProverbAuthority, isFakeProverbSafeText, realizeFakeProverbForm } from "../../src/fakeProverb/fakeProverbAuthority";
import { FAKE_PROVERB_MAX_COUNT, generateFakeProverbs } from "../../src/fakeProverb/fakeProverbCore";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { isMaxIrregularLexeme } from "../../src/transform/maxRealizer";
import { TARGET_PARAGRAPHS } from "../support/max/corpus";
import { readLexemes } from "../support/max/roundTrip";
import { ok, standardSet } from "../fakeProverbCoreFixtures";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";

/**
 * PRE-RELEASE-FAKE-PROVERB-CORE1 against the shipped compact IPADIC and the
 * production tokenizer. The dictionary is hash-pinned by the distribution
 * gate, so every count here is exact.
 */
const VERB_FORMS = ["verb-basic", "verb-past", "verb-negative"] as const;
const FOLLOWERS: Readonly<Record<string, string>> = { "aux-ta": "た", "aux-da": "だ", "aux-nai": "ない" };
const input = (conjugationType: string, baseForm: string) =>
	({ pos: conjugationType.startsWith("形容詞") ? "形容詞" : "動詞", detail1: "自立", conjugationType, baseForm, isUnknown: false });

let tokenize: Tokenize;
beforeAll(async () => {
	await initLindera();
	tokenize = buildTokenize(compactDictionaryDir());
});

describe("Fake Proverb forms over the whole shipped dictionary", () => {
	const lexemes = readLexemes(compactDictionaryDir());

	it("realizes every admitted regular lexeme in every form of its class, and no irregular one", () => {
		expect(lexemes).toHaveLength(16_394);
		const counts: Record<string, number> = {};
		const keys: Record<string, number> = {};
		for (const lexeme of lexemes) {
			for (const form of ["adjective-basic", ...VERB_FORMS]) {
				const realized = realizeFakeProverbForm(form, input(lexeme.conjugationType, lexeme.baseForm));
				if (isMaxIrregularLexeme(lexeme.conjugationType, lexeme.baseForm)) expect(realized).toBeNull();
				if (realized === null) continue;
				expect(isFakeProverbSafeText(realized.surface)).toBe(true);
				counts[form] = (counts[form] ?? 0) + 1;
				keys[`${form}/${realized.key}/${String(realized.follower)}`] = (keys[`${form}/${realized.key}/${String(realized.follower)}`] ?? 0) + 1;
			}
		}
		// 15,775 lexemes in the twelve admitted classes = 14,000 verbs + 1,769 i-adjectives + 6 irregular base forms.
		expect(counts).toEqual({ "verb-basic": 14_000, "verb-past": 14_000, "verb-negative": 14_000, "adjective-basic": 1_769 });
		expect(keys).toEqual({
			"verb-basic/verb-basic/null": 14_000,
			"verb-past/verb-ta-stem-t/aux-ta": 12_797,
			"verb-past/verb-ta-stem-d/aux-da": 1_203,
			"verb-negative/verb-irrealis-negation/aux-nai": 14_000,
			"adjective-basic/adjective-basic/null": 1_769,
		});
	});

	it("measures how often the production tokenizer reads a realized form back as the same lexeme plus its follower", () => {
		// A measurement, not an admission rule: kana spellings are ambiguous (あった, あいた),
		// and the runtime never re-tokenizes its own output. SPIKE1 measured 98.29% for the keys alone.
		let agree = 0;
		let total = 0;
		for (const lexeme of lexemes) {
			for (const form of ["verb-past", "verb-negative"]) {
				const realized = realizeFakeProverbForm(form, input(lexeme.conjugationType, lexeme.baseForm));
				if (realized === null) continue;
				total += 1;
				const tokens = tokenize(realized.surface);
				// The tokens always tile the surface exactly.
				expect(tokens.map((token) => token.surface).join("")).toBe(realized.surface);
				if (tokens.length >= 2 && tokens[0]!.baseForm === lexeme.baseForm && tokens[0]!.conjugationType === lexeme.conjugationType &&
					tokens.slice(1).map((token) => token.surface).join("") === FOLLOWERS[realized.follower!] &&
					tokens.slice(1).every((token) => token.pos === "助動詞")) agree += 1;
			}
		}
		expect([agree, total]).toEqual([27_540, 28_000]);
	});
});

describe("Fake Proverb generation on analyzed prose", () => {
	it("generates ten safe, inseparable drafts from a real analysis without a shortfall", async () => {
		let calls = 0;
		const analyses = await Promise.all(TARGET_PARAGRAPHS.map(async (text, index) => {
			const answer = await analyzeManualMorphSource({ text, sourcePath: `corpus-${index}.md`,
				tokenizer: { tokenize: async (value) => { calls += 1; return await Promise.resolve(tokenize(value)); } } });
			if (answer.status !== "ready") throw new Error("analysis");
			return answer.analysis;
		}));
		const owner = buildManualMorphVocabulary({ sources: analyses, drawMode: "frequency" });
		const recipeSet = standardSet();
		const authority = ok(createFakeProverbAuthority({ vocabulary: owner, recipeSet }));
		const before = calls;
		const forms = new Set<string>();
		for (let nonce = 0; nonce < 20; nonce += 1) {
			const generation = ok(generateFakeProverbs({ authority, recipeSet, drawMode: "frequency", count: FAKE_PROVERB_MAX_COUNT, nonce }));
			expect([generation.drafts.length, generation.shortfall]).toEqual([FAKE_PROVERB_MAX_COUNT, null]);
			for (const draft of generation.drafts) {
				expect(isFakeProverbSafeText(draft.proverb.text) && isFakeProverbSafeText(draft.gloss.text)).toBe(true);
				expect(draft.canonicalText).toBe(`**${draft.proverb.text}**\n\n> ${draft.gloss.text}`);
				for (const entry of draft.gloss.references) expect(draft.proverb.bindings).toContain(entry.binding);
				for (const binding of [...draft.proverb.bindings, ...draft.gloss.bindings]) {
					forms.add(binding.form);
					for (const evidence of binding.candidate.evidence) {
						if (evidence.kind === "lexeme") expect(isMaxIrregularLexeme(evidence.conjugationType, evidence.baseForm)).toBe(false);
					}
				}
			}
		}
		expect([...forms].sort()).toEqual(["adjective-basic", "independent-noun", "verb-basic", "verb-negative", "verb-past"]);
		expect(calls).toBe(before);
	});
});
