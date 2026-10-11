import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { snapshotDictionaryPool } from "../../src/application/prepareVocabulary";
import { generateFakeDefinition } from "../../src/dictionary/generateFakeDefinition";
import { validateHeadword } from "../../src/dictionary/headword";
import { STANDARD_TEMPLATE_SET } from "../../src/dictionary/standardTemplateSet";
import { compileTemplateSet, type CompiledTemplateSet } from "../../src/dictionary/template";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../../src/vocabulary/enclosedTerms";
import { NA_STEM_EXCLUDED } from "../../src/vocabulary/lexicalProjection";
import { TEMPLATE_SET_1 } from "../support/fakeDictionaryTemplateSet1";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";

/*
 * FAKE-DICT-LEXEME1 with the shipped dictionary and tokenizer. Stage A must
 * not move a single definition: the digest below is of 36,420 definitions
 * generated on `main` / `d6ccc6b`, before the lexical placeholders existed.
 * Stage B made the standard set template set 2, so the digest is now taken
 * with template set 1, which uses no lexical placeholder.
 */

let tokenize: Tokenize;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });

const PRESETS = ["kumono-ito", "yume-juya", "chumonno-oi-ryoriten"] as const;
// The realizer refuses these (suppletive or irregular classes); よい is a regular アウオ段 adjective and is kept.
const IRREGULAR = ["ある", "有る", "在る", "する", "来る", "くる", "行く", "いく", "いい"];

async function owners(drawMode: "uniform" | "frequency"): Promise<readonly [string, ManualMorphVocabulary][]> {
	return await Promise.all(PRESETS.map(async (preset) => {
		const text = readFileSync(`web/presets/${preset}.txt`, "utf8");
		const analyzed = await analyzeManualMorphSource({ text, sourcePath: `${preset}.md`, tokenizer: { tokenize: async (value) => tokenize(value) }, mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
		if (analyzed.status !== "ready") throw new Error("analysis");
		return [preset, buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode })] as [string, ManualMorphVocabulary];
	}));
}

type Generated = { preset: string; drawMode: string; headword: string; result: ReturnType<typeof generateFakeDefinition> };

/** Every accepted headword of each preset, three Seeds and five values, in both draw modes, through the production pool. */
async function allDefinitions(templateSet: CompiledTemplateSet): Promise<Generated[]> {
	const all: Generated[] = [];
	const lines: string[] = [];
	for (const preset of PRESETS) {
		for (const drawMode of ["uniform", "frequency"] as const) {
			const owner = (await owners(drawMode)).find(([name]) => name === preset)![1];
			const pool = snapshotDictionaryPool(owner.snapshot, templateSet);
			const seen = new Set<string>();
			for (const record of owner.snapshot.projections.manual.candidates) {
				const validated = validateHeadword(record.surface, [record.morphology]);
				if (validated.outcome !== "accepted" || seen.has(record.surface)) continue;
				seen.add(record.surface);
				for (const seed of [1, 12345, 4294967295]) for (const level of [1, 25, 50, 75, 100]) {
					const result = generateFakeDefinition({ headword: validated.headword, pool, dictionarySeed: seed, dictionarySemantropy: level, templateSet });
					all.push({ preset, drawMode, headword: record.surface, result });
					lines.push(JSON.stringify([preset, drawMode, record.surface, seed, level, result]));
				}
			}
		}
	}
	digests.set(templateSet, [lines.length, createHash("sha256").update(lines.join("\n")).digest("hex")]);
	return all;
}
const digests = new Map<CompiledTemplateSet, [number, string]>();
async function definitionsDigest(templateSet: CompiledTemplateSet): Promise<[number, string]> {
	await allDefinitions(templateSet);
	return digests.get(templateSet)!;
}

describe("Fake Dictionary lexical placeholders with the shipped dictionary (FAKE-DICT-LEXEME1)", () => {
	it("leaves every definition of the three web presets as it was on main, with template set 1", async () => {
		expect(await definitionsDigest(TEMPLATE_SET_1))
			.toEqual([36_420, "15e627ef79950e24ef80adf06e9bea6357fbaf3a80581576dc76b43b51c66d83"]);
	}, 300_000);

	it.each(PRESETS)("never puts an excluded stem, a stem ending in な or an irregular word into a lexical list for %s", async (preset) => {
		const uses = compileTemplateSet(1, [{ id: "classification-01", family: "classification", text: "{{verb}}{{noun}}、{{iAdjective}}{{noun}}、{{naStem}}な{{noun}}。" }], []);
		if (!uses.ok) throw new Error("set");
		for (const drawMode of ["uniform", "frequency"] as const) {
			const owner = (await owners(drawMode)).find(([name]) => name === preset)![1];
			const pool = snapshotDictionaryPool(owner.snapshot, uses.set);
			expect([pool.verb!.length, pool.iAdjective!.length, pool.naStem!.length].every((count) => count > 0)).toBe(true);
			for (const stem of pool.naStem!) {
				expect(NA_STEM_EXCLUDED).not.toContain(stem);
				expect(stem.endsWith("な")).toBe(false);
			}
			for (const word of [...pool.verb!, ...pool.iAdjective!]) expect(IRREGULAR).not.toContain(word);
		}
	}, 120_000);

	it("gives template set 2's definitions no excluded stem with an ending, and measures how many use a new template", async () => {
		const all = await allDefinitions(STANDARD_TEMPLATE_SET);
		const generated = all.filter((entry) => entry.result.outcome === "generated");
		expect(generated.length).toBe(all.filter((entry) => entry.result.outcome !== "off").length);
		const excluded = new RegExp(`(${NA_STEM_EXCLUDED.join("|")})[なにさだで]`, "u");
		let lexical = 0;
		const byPreset = new Map<string, [number, number]>();
		for (const entry of generated) {
			if (entry.result.outcome !== "generated") continue;
			expect(entry.result.definition).not.toMatch(excluded);
			expect(entry.result.templateSetVersion).toBe(2);
			const isNew = entry.result.templateId.endsWith("-04");
			if (isNew) lexical += 1;
			const [count, total] = byPreset.get(entry.preset) ?? [0, 0];
			byPreset.set(entry.preset, [count + (isNew ? 1 : 0), total + 1]);
		}
		// A measurement for the owner (record §6): with every kind present, 18 of 108 templates are new,
		// and each family is weighted as a whole, so about 18 / 30 x 1 / 4 = 15% of definitions are expected.
		expect(lexical / generated.length).toBeGreaterThan(0.08);
		expect(lexical / generated.length).toBeLessThan(0.22);
		expect([...byPreset.keys()]).toEqual([...PRESETS]);
	}, 300_000);

	it("still defines every word of a Vocabulary with no verb, adjective or stem", async () => {
		const analyzed = await analyzeManualMorphSource({ text: "猫は机の上の港。犬と京都と三本の沈黙。", sourcePath: "nouns.md", tokenizer: { tokenize: async (value) => tokenize(value) }, mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
		if (analyzed.status !== "ready") throw new Error("analysis");
		const owner = buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
		const pool = snapshotDictionaryPool(owner.snapshot);
		expect([pool.verb, pool.iAdjective, pool.naStem]).toEqual([[], [], []]);
		const validated = validateHeadword("猫", [owner.snapshot.projections.manual.candidates.find((record) => record.surface === "猫")!.morphology]);
		if (validated.outcome !== "accepted") throw new Error("headword");
		for (let seed = 0; seed < 200; seed += 1) {
			const result = generateFakeDefinition({ headword: validated.headword, pool, dictionarySeed: seed, dictionarySemantropy: 100 });
			expect(result.outcome).toBe("generated");
			if (result.outcome === "generated") expect(result.templateId.endsWith("-04")).toBe(false);
		}
	});
});
