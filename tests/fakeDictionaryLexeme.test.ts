import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { generateStandardTemplates } from "../scripts/fakeDictionary/standardTemplates.mjs";
import { snapshotDictionaryPool } from "../src/application/prepareVocabulary";
import { generateFakeDefinition } from "../src/dictionary/generateFakeDefinition";
import { validateHeadword } from "../src/dictionary/headword";
import { checkLexicalFollowers } from "../src/dictionary/lexicalFollowers";
import {
	FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS,
	FAKE_DICTIONARY_PLACEHOLDERS,
	classifyPlaceholder,
	isFakeDictionaryPlaceholder,
	isFakeDictionaryTemplatePlaceholder,
} from "../src/dictionary/placeholders";
import { snapshotLexicalForms, snapshotPlaceholderSurfaces } from "../src/dictionary/snapshotLexicalForms";
import { STANDARD_TEMPLATE_SET } from "../src/dictionary/standardTemplateSet";
import { compileTemplateSet, lexicalPlaceholdersOf, type CompiledTemplateSet } from "../src/dictionary/template";
import { fingerprintDictionaryVocabularyPool, type DictionaryVocabularyPool } from "../src/dictionary/vocabularyPool";
import { iAdjectiveBasicForms, naAdjectiveStems, regularVerbBasicForms } from "../src/vocabulary/lexicalProjection";
import { fullOwner, nounOnlyOwner } from "./fakeAlertCoreFixtures";
import { TEMPLATE_SET_1 } from "./support/fakeDictionaryTemplateSet1";
import { adjective, mintOwner, noun, token } from "./fakeProverbCoreFixtures";
import { planDisplaySlots } from "../src/analysis/displaySlots";
import { VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION } from "../src/vocabulary/vocabularySnapshot";
import { dictionaryDiagnostics } from "../src/view/dictionaryDiagnosticModel";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { MAX } from "./readyAnalysis";

/*
 * FAKE-DICT-LEXEME1 stage A: the lexical placeholders {{verb}}, {{iAdjective}}
 * and {{naStem}} reach templates, pools and the generator, while every set that
 * uses none of them keeps its pools, fingerprints and definitions unchanged.
 */

function set(core: readonly string[], clauses: readonly string[] = [], version = 1): CompiledTemplateSet {
	const result = compileTemplateSet(version,
		core.map((text, index) => ({ id: `classification-0${index + 1}`, family: "classification", text })),
		clauses.map((text, index) => ({ id: `extra-0${index + 1}`, category: "usage", text })));
	if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join(","));
	return result.set;
}
const headword = () => {
	const validated = validateHeadword("猫", [noun("猫")]);
	if (validated.outcome !== "accepted") throw new Error("headword");
	return validated.headword;
};
const followerCodes = (core: readonly string[], clauses: readonly string[] = []) =>
	checkLexicalFollowers(set(core, clauses)).map((issue) => `${issue.code}:${issue.detail}`);

describe("the lexical placeholders", () => {
	it("are a second closed list beside the eight, which they never join or classify", () => {
		expect(FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS).toEqual(["verb", "iAdjective", "naStem"]);
		expect(FAKE_DICTIONARY_PLACEHOLDERS).toHaveLength(8);
		for (const placeholder of FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS) {
			expect(isFakeDictionaryPlaceholder(placeholder)).toBe(false);
			expect(isFakeDictionaryTemplatePlaceholder(placeholder)).toBe(true);
		}
		// A ナ-adjective stem still classifies as no placeholder: a headword never becomes {{naStem}}.
		expect(classifyPlaceholder({ ...noun("静か"), detail1: "形容動詞語幹" })).toBeNull();
	});

	it("compile in a template, and a set reports the ones it uses in declared order", () => {
		const compiled = set(["{{naStem}}な{{noun}}の一種。", "{{verb}}ための{{noun}}。"]);
		expect(compiled.coreTemplates.map((entry) => entry.requiredPlaceholders)).toEqual([["naStem", "noun"], ["verb", "noun"]]);
		expect(lexicalPlaceholdersOf(compiled)).toEqual(["verb", "naStem"]);
		expect(lexicalPlaceholdersOf(TEMPLATE_SET_1)).toEqual([]);
		expect(lexicalPlaceholdersOf(STANDARD_TEMPLATE_SET)).toEqual(["verb", "iAdjective", "naStem"]);
	});
});

describe("the pool of a Snapshot", () => {
	it("leaves out every lexical list for a set that uses none, so its fingerprint is the eight's", async () => {
		const owner = await fullOwner("frequency");
		const pool = snapshotDictionaryPool(owner.snapshot, TEMPLATE_SET_1);
		expect(Object.keys(pool).sort()).toEqual([...FAKE_DICTIONARY_PLACEHOLDERS].sort());
		const eight = Object.freeze(Object.fromEntries(FAKE_DICTIONARY_PLACEHOLDERS.map((key) => [key, pool[key]]))) as DictionaryVocabularyPool;
		expect(fingerprintDictionaryVocabularyPool(pool)).toBe(fingerprintDictionaryVocabularyPool(eight));
	});

	it("adds the shared lists for exactly the lexical placeholders a set uses, and they move the fingerprint", async () => {
		const owner = await fullOwner("frequency");
		const usesTwo = set(["{{iAdjective}}{{noun}}の一種。", "{{naStem}}に{{sahen}}すること。"]);
		const pool = snapshotDictionaryPool(owner.snapshot, usesTwo);
		expect(pool.iAdjective).toEqual(iAdjectiveBasicForms(owner.snapshot).map((form) => form.surface));
		expect(pool.naStem).toEqual(naAdjectiveStems(owner.snapshot).map((form) => form.surface));
		expect(pool.verb).toBeUndefined();
		expect(Object.isFrozen(pool.iAdjective)).toBe(true);
		expect(fingerprintDictionaryVocabularyPool(pool)).not.toBe(fingerprintDictionaryVocabularyPool(snapshotDictionaryPool(owner.snapshot, TEMPLATE_SET_1)));
		// An empty list still counts as carried: a set that uses a kind always fingerprints with it.
		const nouns = await nounOnlyOwner();
		const empty = snapshotDictionaryPool(nouns.snapshot, usesTwo);
		expect([empty.iAdjective, empty.naStem]).toEqual([[], []]);
		expect(fingerprintDictionaryVocabularyPool(empty)).not.toBe(fingerprintDictionaryVocabularyPool(snapshotDictionaryPool(nouns.snapshot, TEMPLATE_SET_1)));
	});

	it("reads the same words for availability and diagnostics as for the pool, and never changes the Snapshot", async () => {
		const owner = await fullOwner();
		const before = JSON.stringify(owner.snapshot);
		expect(snapshotPlaceholderSurfaces(owner.snapshot, "verb").map((form) => form.surface))
			.toEqual(regularVerbBasicForms(owner.snapshot).map((form) => form.surface));
		expect(snapshotPlaceholderSurfaces(owner.snapshot, "noun")).toBe(owner.snapshot.projections.dictionary.byPlaceholder.noun);
		expect(snapshotLexicalForms(owner.snapshot, "naStem")).toBe(snapshotLexicalForms(owner.snapshot, "naStem"));
		expect(JSON.stringify(owner.snapshot)).toBe(before);
		expect(Object.keys(owner.snapshot.projections.dictionary.byPlaceholder).sort()).toEqual([...FAKE_DICTIONARY_PLACEHOLDERS].sort());
	});
});

describe("generating with lexical placeholders", () => {
	it("fills a lexical placeholder from its own list only", async () => {
		const owner = await fullOwner();
		const templates = set(["{{iAdjective}}{{noun}}の一種。"]);
		const pool = snapshotDictionaryPool(owner.snapshot, templates);
		const adjectives = new Set(pool.iAdjective);
		for (let seed = 0; seed < 40; seed += 1) {
			const result = generateFakeDefinition({ headword: headword(), pool, dictionarySeed: seed, dictionarySemantropy: 100, templateSet: templates });
			if (result.outcome !== "generated") throw new Error(result.outcome);
			const used = [...adjectives].find((adjective) => result.definition.startsWith(adjective));
			expect(used, result.definition).toBeDefined();
		}
	});

	it("drops a template whose lexical list is empty, and names the placeholder when nothing is left", async () => {
		const owner = await nounOnlyOwner();
		const mixed = set(["{{verb}}ための{{noun}}。", "{{noun}}の一種。"]);
		const pool = snapshotDictionaryPool(owner.snapshot, mixed);
		for (let seed = 0; seed < 20; seed += 1) {
			const result = generateFakeDefinition({ headword: headword(), pool, dictionarySeed: seed, dictionarySemantropy: 100, templateSet: mixed });
			expect(result.outcome === "generated" && result.templateId).toBe("classification-02");
		}
		const only = set(["{{verb}}ための{{noun}}。"]);
		expect(generateFakeDefinition({ headword: headword(), pool: snapshotDictionaryPool(owner.snapshot, only), dictionarySeed: 1, dictionarySemantropy: 50, templateSet: only }))
			.toEqual({ outcome: "insufficient-vocabulary", missingPlaceholders: ["verb"] });
		// A pool built without the list (the old token-sequence path) reads it as empty, not as an error.
		const eight = snapshotDictionaryPool(owner.snapshot, TEMPLATE_SET_1);
		expect(generateFakeDefinition({ headword: headword(), pool: eight, dictionarySeed: 1, dictionarySemantropy: 50, templateSet: only }))
			.toEqual({ outcome: "insufficient-vocabulary", missingPlaceholders: ["verb"] });
	});
});

describe("the follower guard (build time only)", () => {
	it.each([
		["a verb before a noun placeholder", "{{verb}}{{noun}}の一種。"],
		["a verb before a Han noun", "{{verb}}者。"],
		["a verb before a listed noun and its tail", "{{verb}}ことの一種。"],
		["a verb before a listed noun ending the text", "{{verb}}こと"],
		["a verb before a follower", "{{verb}}ように見える{{noun}}。"],
		["a verb before べき", "{{verb}}べき{{noun}}。"],
		["an adjective before a noun placeholder", "{{iAdjective}}{{noun}}の一種。"],
		["an adjective before さま", "{{iAdjective}}さまを表す。"],
		["a stem before な and a noun placeholder", "{{naStem}}な{{noun}}の一種。"],
		["a stem before な and a Han noun", "{{naStem}}な性質。"],
		["a stem before な and a listed noun", "{{naStem}}なことの一種。"],
		["a stem before に", "{{naStem}}に{{sahen}}すること。"],
		["a stem before さ and a tail", "{{naStem}}さの度合い。"],
		["a stem before だ。", "{{noun}}が{{naStem}}だ。"],
		["a stem before である", "{{noun}}が{{naStem}}であること。"],
	] as const)("accepts %s", (_name, text) => {
		expect(followerCodes([text])).toEqual([]);
	});

	it.each([
		["a verb before ない", "{{verb}}ないこと。", "lexical-follower:verb"],
		["a verb before た", "{{verb}}た{{noun}}。", "lexical-follower:verb"],
		["a verb before a hiragana word", "{{verb}}ものすごい{{noun}}。", "lexical-follower:verb"],
		["a verb before another lexical placeholder", "{{verb}}{{iAdjective}}{{noun}}。", "lexical-follower:verb"],
		["an adjective before べき", "{{iAdjective}}べき{{noun}}。", "lexical-follower:iAdjective"],
		["an adjective before かった", "{{iAdjective}}かった{{noun}}。", "lexical-follower:iAdjective"],
		["a stem before a noun placeholder", "{{naStem}}{{noun}}の一種。", "lexical-follower:naStem"],
		["a stem before a Han noun", "{{naStem}}性の一種。", "lexical-follower:naStem"],
		["a stem before な and ない", "{{naStem}}ないこと。", "lexical-follower:naStem"],
		["a stem before な and a hiragana word", "{{naStem}}なりゆき。", "lexical-follower:naStem"],
		["a stem before さ with no tail", "{{naStem}}さ{{noun}}。", "lexical-follower:naStem"],
		["a stem before の", "{{naStem}}の{{noun}}。", "lexical-follower:naStem"],
		["a verb at the end of a template", "{{noun}}を{{verb}}", "lexical-at-end:verb"],
		["a stem at the end of a template", "{{noun}}が{{naStem}}", "lexical-at-end:naStem"],
	] as const)("refuses %s", (_name, text, code) => {
		expect(followerCodes([text])).toEqual([code]);
	});

	it("checks Optional Clauses too, and leaves the eight placeholders alone", () => {
		expect(followerCodes(["{{noun}}の一種。"], ["{{naStem}}{{noun}}とされる。"])).toEqual(["lexical-follower:naStem"]);
		expect(followerCodes(["{{noun}}{{place}}{{sahen}}"])).toEqual([]);
		expect(checkLexicalFollowers(STANDARD_TEMPLATE_SET)).toEqual([]);
	});
});

describe("the follower guard in the generator", () => {
	const doc = (text: string) => `# Templates\n\nschema-version: 2\ndata-version: 1\n\n## core classification-01\nfamily: classification\n\n${text}\n`;

	it("refuses a document whose lexical placeholder has an unaccepted follower, naming the entry", async () => {
		await expect(generateStandardTemplates({ markdown: doc("{{naStem}}{{noun}}の一種。") }))
			.rejects.toThrow(/lexical-follower \(classification-01: naStem\)/u);
		await expect(generateStandardTemplates({ markdown: doc("{{naStem}}な{{noun}}の一種。") })).resolves.toBeDefined();
	});

	it("never reaches the plugin", async () => {
		for (const entryPoint of ["src/main.ts", "src/SemantropyPlugin.ts"]) {
			const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
				external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
			expect(Object.keys(result.metafile.inputs)).not.toContain("src/dictionary/lexicalFollowers.ts");
			expect(Object.keys(result.metafile.inputs)).toContain("src/dictionary/snapshotLexicalForms.ts");
		}
	});
});

/*
 * Independent review 1 (P3): slot availability and the diagnostics read the
 * lexical lists too. A Vocabulary with only イ-adjectives fills no noun
 * placeholder, so only slang-04 ({{iAdjective}}ことの俗な言い方。) is usable.
 */
describe("availability and diagnostics with only lexical words", () => {
	const adjectiveOnly = async () => (await mintOwner(["高い。美しい。"], "uniform",
		[adjective("高い", "形容詞・アウオ段"), adjective("美しい"), token("。", "記号", "句点")])).owner;

	it("counts the one usable template in the diagnostics, and generates its definition", async () => {
		const owner = await adjectiveOnly();
		expect(FAKE_DICTIONARY_PLACEHOLDERS.every((key) => owner.snapshot.projections.dictionary.byPlaceholder[key].length === 0)).toBe(true);
		const counts = dictionaryDiagnostics(owner.snapshot);
		expect([counts.core, counts.totalCore, counts.families]).toEqual([1, 108, 1]);
		const pool = snapshotDictionaryPool(owner.snapshot);
		const result = generateFakeDefinition({ headword: headword(), pool, dictionarySeed: 3, dictionarySemantropy: 50 });
		expect(result.outcome === "generated" && [result.templateId, result.definition]).toEqual(["slang-04", "美しいことの俗な言い方。"]);
	});

	it("marks a headword slot available when only a lexical template can be filled", async () => {
		const slotFor = (snapshot: Parameters<typeof dictionaryDiagnostics>[0]) => planDisplaySlots({
			targetRevision: 1, displayRevision: 1, snapshot, bodySeed: 7, bodySemantropy: MAX,
			dictionarySemantropy: assertDictionarySemantropy(100), algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
			chunks: [{ chunkId: "chunk:1:0", runs: [{ runId: "run:0", analysisText: "猫", annotations: [],
				tokens: [{ tokenId: "chunk:1:0/run:0:token:0", range: { start: 0, end: 1 }, token: noun("猫") }] }] }],
		}).slots[0]!;
		const slot = slotFor((await adjectiveOnly()).snapshot);
		expect([slot.dictionaryEligible, slot.dictionaryAvailable]).toEqual([true, true]);
		// A Vocabulary with neither nouns nor lexical words leaves the same slot unavailable.
		const none = (await mintOwner(["。"], "uniform", [token("。", "記号", "句点")])).owner;
		expect(dictionaryDiagnostics(none.snapshot).core).toBe(0);
		expect(slotFor(none.snapshot).dictionaryAvailable).toBe(false);
	});
});
