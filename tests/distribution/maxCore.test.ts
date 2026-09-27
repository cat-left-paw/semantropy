import { beforeAll, describe, expect, it } from "vitest";
import { SLOT_BASE_FORM, SLOT_CONJUGATION_FORM, SLOT_CONJUGATION_TYPE, SLOT_DETAIL1, SLOT_POS, SLOT_READING } from "../../scripts/lindera/compactDictionary.mjs";
import { readEntries } from "../../scripts/max/scanDictionary.mjs";
import { analyzeManualMorphSource, buildManualMorphVocabulary, manualMorphConnection, readManualMorphVocabularySources,
	type ManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { MAX_TARGET_FORM_KEYS, maxTargetFormKey, realizeMaxLexeme } from "../../src/transform/maxRealizer";
import { readMaxResultSlots } from "../../src/transform/maxCore";
import { realizeMaxCandidate } from "../support/max/maxRealizer";
import { readLexemes } from "../support/max/roundTrip";
import { measureProfiles, prepareMeasurement } from "../support/max/profiles";
import { sourceTexts, targetText } from "../support/max/corpus";
import { ALL, body10, legacyShape, ok, options, prepareMax } from "../maxCoreFixtures";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";

/**
 * PRE-RELEASE-MAX-CORE1 against the shipped compact IPADIC and the production
 * tokenizer. SPIKE1's gate keeps pinning the dictionary itself; this suite pins
 * that the production realizer is that verified contract, over every lexeme the
 * dictionary holds, and that the connected core behaves on real analyses.
 */
const compact = readEntries(compactDictionaryDir());
const ENDINGS: Readonly<Record<string, string>> = { 一段: "る", "五段・カ行イ音便": "く", "五段・ガ行": "ぐ", "五段・サ行": "す", "五段・タ行": "つ",
	"五段・ナ行": "ぬ", "五段・バ行": "ぶ", "五段・マ行": "む", "五段・ラ行": "る", "五段・ワ行促音便": "う", "形容詞・アウオ段": "い", "形容詞・イ段": "い" };
const input = (conjugationType: string, baseForm: string) => ({ pos: conjugationType.startsWith("形容詞") ? "形容詞" : "動詞", detail1: "自立", conjugationType, baseForm, isUnknown: false });

describe("the production realizer over the whole shipped dictionary", () => {
	const lexemes = readLexemes(compactDictionaryDir());
	it("is the SPIKE1 prototype's answer for every lexeme and every key", () => {
		// SPIKE1 §2.5: 16,394 (pos, class, base form) lexemes, 15,775 of them in the twelve admitted classes.
		expect(lexemes).toHaveLength(16_394);
		expect(lexemes.filter(item => ENDINGS[item.conjugationType])).toHaveLength(15_775);
		let realized = 0;
		for (const lexeme of lexemes) for (const key of MAX_TARGET_FORM_KEYS) {
			const production = realizeMaxLexeme(key, input(lexeme.conjugationType, lexeme.baseForm));
			expect(production).toEqual(realizeMaxCandidate(key, input(lexeme.conjugationType, lexeme.baseForm)));
			if (production.realized) realized++;
		}
		expect(realized).toBeGreaterThan(100_000);
	});
	it("re-derives the artifact exclusion with the structural rule and refuses all six base forms for every key", () => {
		const byClass = new Map<string, Set<string>>();
		for (const lexeme of lexemes) (byClass.get(lexeme.conjugationType) ?? byClass.set(lexeme.conjugationType, new Set()).get(lexeme.conjugationType)!).add(lexeme.baseForm);
		const found: string[] = [];
		for (const [type, ending] of Object.entries(ENDINGS)) for (const base of byClass.get(type) ?? [])
			if (base.endsWith(ending) && byClass.get(type)!.has(base.slice(0, base.length - ending.length))) found.push(base);
		expect(found.sort()).toEqual(["のぼりつめるる", "へるる", "上り詰めるる"].sort());
		for (const [type, base] of [...found.map(base => ["一段", base] as const), ["五段・ラ行", "ある"], ["五段・ラ行", "有る"], ["五段・ラ行", "在る"]] as const)
			for (const key of MAX_TARGET_FORM_KEYS) expect(realizeMaxLexeme(key, input(type, base))).toMatchObject({ realized: false });
	});
	// SPIKE1 record §2.4 and Amendment 1 say "25 classes / 5,533 entries"; the shipped dictionary and SPIKE1's own
	// gate fixture (EXCLUDED_CLASS_ENTRIES) hold 26 classes / 5,523 entries. Exclusion is by allowlist, so every one is out.
	it("excludes every non-allowlisted class by class, and gives 一段 / 五段・サ行 no 連用タ接続 entry", () => {
		const classes = new Set(compact.filter(entry => (entry[SLOT_POS] === "動詞" || entry[SLOT_POS] === "形容詞") && entry[SLOT_DETAIL1] === "自立")
			.map(entry => entry[SLOT_CONJUGATION_TYPE]!).filter(type => type !== "*"));
		const excluded = [...classes].filter(type => !ENDINGS[type]);
		expect(excluded).toHaveLength(26);
		for (const type of excluded) for (const key of MAX_TARGET_FORM_KEYS) expect(realizeMaxLexeme(key, input(type, "書く")).realized).toBe(false);
		for (const type of ["一段", "五段・サ行"]) expect(compact.filter(entry => entry[SLOT_POS] === "動詞" && entry[SLOT_DETAIL1] === "自立" &&
			entry[SLOT_CONJUGATION_TYPE] === type && entry[SLOT_CONJUGATION_FORM] === "連用タ接続")).toHaveLength(0);
	});
	it("merges multi-reading base forms only where the production realizer cannot tell them apart", () => {
		const groups = new Map<string, Set<string>>();
		for (const entry of compact) {
			if (entry[SLOT_DETAIL1] !== "自立" || (entry[SLOT_POS] !== "動詞" && entry[SLOT_POS] !== "形容詞") || !ENDINGS[entry[SLOT_CONJUGATION_TYPE]!] || entry[SLOT_CONJUGATION_FORM] !== "基本形") continue;
			const key = JSON.stringify([entry[SLOT_POS], entry[SLOT_CONJUGATION_TYPE], entry[SLOT_BASE_FORM]]);
			(groups.get(key) ?? groups.set(key, new Set()).get(key)!).add(entry[SLOT_READING]!);
		}
		const several = [...groups].filter(([, readings]) => readings.size > 1);
		expect(several).toHaveLength(198);
		for (const [key] of several) {
			const [pos, type, base] = JSON.parse(key) as [string, string, string];
			for (const formKey of MAX_TARGET_FORM_KEYS) expect(new Set([0, 1].map(() => JSON.stringify(realizeMaxLexeme(formKey, { ...input(type, base), pos }))))).toHaveProperty("size", 1);
		}
	});
});

describe("MAX core on real analyses", () => {
	let tokenize: Tokenize;
	const tokenizer = { tokenize: async (text: string) => tokenize(text) };
	beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });
	async function owner(texts: readonly { path: string; text: string }[], drawMode: "uniform" | "frequency" = "uniform"): Promise<ManualMorphVocabulary> {
		const analyses = [];
		for (const item of texts) {
			const answer = await analyzeManualMorphSource({ text: item.text, sourcePath: item.path, tokenizer });
			if (answer.status !== "ready") throw new Error("analysis"); analyses.push(answer.analysis);
		}
		return buildManualMorphVocabulary({ sources: analyses, drawMode });
	}
	it("aggregates 歩く / 歩い / 歩き / 歩か / 歩け into one lexeme with every record, reading and origin", async () => {
		const vocabulary = await owner([{ path: "a.md", text: "歩く。歩いた。歩きます。" }, { path: "b.md", text: "歩かない。歩けば。" }]);
		const lexeme = prepareMax(vocabulary).projection.verb.lexemes.filter(item => item.input.baseForm === "歩く");
		expect(lexeme).toHaveLength(1);
		expect(lexeme[0]!.lexemeId).toBe(JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "歩く"]));
		expect(lexeme[0]!.frequency).toBe(5);
		expect(lexeme[0]!.origins.map(origin => [origin.path, origin.count])).toEqual([["a.md", 3], ["b.md", 2]]);
		expect(lexeme[0]!.records.map(record => [record.surface, record.conjugationForm, record.reading]).sort()).toEqual(
			[["歩い", "連用タ接続", "アルイ"], ["歩か", "未然形", "アルカ"], ["歩き", "連用形", "アルキ"], ["歩く", "基本形", "アルク"], ["歩け", "仮定形", "アルケ"]].sort());
	});
	it.each(["uniform", "frequency"] as const)("matches Body 10 at level 50 and realizes only verified keys at High / MAX, Current and Selected: %s", async mode => {
		const target = await owner([{ path: "target.md", text: targetText() }], mode);
		const selected = await owner(sourceTexts(), mode);
		const sources = [target, selected];
		for (const vocabulary of sources) {
			const legacy = body10(vocabulary, target), max = prepareMax(vocabulary, target);
			const runs = readManualMorphVocabularySources(target)![0]!.runs;
			for (const nonce of [0, 17, 4242]) for (const bits of [1, 2, 4, 8, 15]) {
				const expected = legacy.run(options(bits), nonce, 100), actual = max.run(options(bits), nonce, 50);
				expect(actual.tokenSurfaces).toEqual(expected.tokenSurfaces);
				expect(legacyShape(actual)).toEqual(expected.selections);
				expect(actual.replaceableSlotCount).toBe(expected.replaceableSlotCount);
			}
			const lexemes = new Map([...max.projection.verb.lexemes, ...max.projection.iAdjective.lexemes].map(item => [item.lexemeId, item]));
			for (const level of [62, 75, 88, 100]) for (const nonce of [1, 2]) {
				const result = max.run(ALL, nonce, level);
				expect(result.texts.join("")).not.toMatch(/泳いた|書いだ|食べせる|書かさせる|へるる/u);
				result.selections.forEach((run, i) => run.forEach((selection, j) => {
					if (!selection?.realization) return;
					const token = runs[i]!.tokens[j]!.token, next = runs[i]!.tokens[j + 1]?.token ?? null;
					const key = maxTargetFormKey(manualMorphConnection(token, next));
					expect(key).toEqual({ supported: true, key: selection.realization.formKey });
					const realized = realizeMaxLexeme(selection.realization.formKey, lexemes.get(selection.realization.lexemeId)!.input);
					expect(realized).toEqual({ realized: true, surface: selection.candidate.surface });
					// The preserved follower is never rewritten by this slot; it changes only as its own selected slot.
					if (next && !result.selections[i]![j + 1]) expect(result.tokenSurfaces[i]![j + 1]).toBe(next.surface);
				}));
			}
		}
	});
	it("reads only the following token at High / MAX: a quotative と refuses a lexical と too, on real analyses", async () => {
		const vocabulary = await owner([{ path: "s.md", text: "意外と早い。そっと歩いた。すぐ歩く。もっと猫。" }]);
		const target = await owner([{ path: "t.md", text: "ゆっくりと言った。" }]), p = prepareMax(vocabulary, target);
		const tokens = readManualMorphVocabularySources(target)![0]!.runs[0]!.tokens.map(item => [item.token.surface, item.token.pos, item.token.detail1]);
		expect(tokens.slice(0, 2)).toEqual([["ゆっくり", "副詞", "助詞類接続"], ["と", "助詞", "格助詞"]]);
		const seen = new Set<string>();
		for (const level of [50, 75, 100]) for (let nonce = 0; nonce < 60; nonce++) {
			const result = p.run({ noun: false, verb: false, iAdjective: false, adverb: true }, nonce, level);
			expect(result.tokenSurfaces[0]!.slice(1)).toEqual(tokens.slice(1).map(item => item[0]));
			expect(result.texts[0]).not.toMatch(/とと/u);
			if (level === 50) expect(result.tokenSurfaces[0]![0]).toBe("ゆっくり"); // strict: 引用 と is no observable head
			else seen.add(result.tokenSurfaces[0]![0]!);
		}
		expect(seen.has("すぐ")).toBe(true);
		for (const surface of ["意外と", "そっと"]) expect(seen.has(surface)).toBe(false);
	});
	it("lets a lexical と stand before とても, which is not the particle と, on real analyses", async () => {
		const vocabulary = await owner([{ path: "s.md", text: "意外と早い。そっと歩いた。" }]);
		const target = await owner([{ path: "t.md", text: "ゆっくりとても美しい。" }]), p = prepareMax(vocabulary, target);
		const tokens = readManualMorphVocabularySources(target)![0]!.runs[0]!.tokens.map(item => [item.token.surface, item.token.pos]);
		expect(tokens.slice(0, 2)).toEqual([["ゆっくり", "副詞"], ["とても", "副詞"]]);
		// とても is itself an adverb slot and may change too; the guard reads the Target's own following token.
		const seen = new Set<string>();
		for (let nonce = 0; nonce < 60; nonce++) seen.add(p.run({ noun: false, verb: false, iAdjective: false, adverb: true }, nonce, 100).tokenSurfaces[0]![0]!);
		expect([...seen].sort()).toEqual(["そっと", "意外と"].sort());
	});
	it("keeps the Target's external と and never places a lexical と before it, on real analyses", async () => {
		const vocabulary = await owner([{ path: "s.md", text: "意外と早い。そっと歩いた。ちょっと待つ。すぐ歩く。じっくり考える。もっと猫。" }]);
		const target = await owner([{ path: "t.md", text: "ゆっくりと歩く。" }]), p = prepareMax(vocabulary, target);
		const tokens = readManualMorphVocabularySources(target)![0]!.runs[0]!.tokens.map(item => [item.token.surface, item.token.pos, item.token.detail1]);
		expect(tokens.slice(0, 2)).toEqual([["ゆっくり", "副詞", "助詞類接続"], ["と", "助詞", "副詞化"]]);
		const seen = new Set<string>();
		for (const level of [50, 60, 75, 90, 100]) for (let nonce = 0; nonce < 60; nonce++) {
			const result = p.run({ noun: false, verb: false, iAdjective: false, adverb: true }, nonce, level);
			expect(result.tokenSurfaces[0]!.slice(1)).toEqual(["と", "歩く", "。"]);
			expect(result.texts[0]).not.toMatch(/とと/u);
			seen.add(result.tokenSurfaces[0]![0]!);
		}
		expect(seen.has("すぐ")).toBe(true); // High / MAX drop bridge capability; the external と stays
		for (const surface of ["意外と", "そっと", "ちょっと"]) expect(seen.has(surface)).toBe(false);
	});
	it("counts exactly SPIKE1's strict / High / MAX exchangeable slots on the SPIKE corpus", async () => {
		const measured = await prepareMeasurement({ target: targetText(), sources: sourceTexts(), tokenizer });
		const spike = measureProfiles(measured.targetTokens, measured.vocabulary).totals;
		const target = await owner([{ path: "target.md", text: targetText() }]), vocabulary = await owner(sourceTexts());
		const p = prepareMax(vocabulary, target), runs = readManualMorphVocabularySources(target)![0]!.runs;
		const counts = (level: number) => {
			const result = p.run(ALL, 5, level), eligible = ok(readMaxResultSlots({ projection: p.projection, target: p.target, result })).eligible;
			const byPart: Record<string, number> = { 名詞: 0, 動詞: 0, 形容詞: 0, 副詞: 0 };
			eligible.forEach((run, i) => run.forEach((value, j) => { if (value) byPart[runs[i]!.tokens[j]!.token.pos]! += 1; }));
			return { parts: [byPart.名詞!, byPart.動詞!, byPart.形容詞!, byPart.副詞!], eligible: eligible.flat() };
		};
		const strict = counts(50), high = counts(75), max = counts(100);
		const record = { strict: strict.parts, high: high.parts, max: max.parts };
		expect(record).toEqual(CORPUS_ELIGIBLE);
		// SPIKE1's model counted nouns + verbs + i-adjectives with realizer-only High / MAX pools, which is CORE1's contract too.
		expect([record.strict, record.high, record.max].map(row => row[0]! + row[1]! + row[2]!)).toEqual([spike.strictSlots, spike.highSlots, spike.maxSlots]);
		expect([spike.strictSlots, spike.highSlots, spike.maxSlots]).toEqual([93, 126, 127]);
	});
});
/** Eligible slots on the SPIKE corpus, [noun, verb, i-adjective, adverb], pinned from this suite's own measurement. */
const CORPUS_ELIGIBLE = { strict: [67, 18, 8, 0], high: [69, 46, 11, 0], max: [69, 47, 11, 0] };
