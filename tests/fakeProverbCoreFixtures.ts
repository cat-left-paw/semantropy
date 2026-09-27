import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../src/transform/manualMorphology";
import { compileFakeProverbRecipeSet, type CompiledFakeProverbRecipeSet, type CompileFakeProverbRecipeSetInput } from "../src/fakeProverb/compileRecipeSet";
import {
	STANDARD_FAKE_PROVERB_GLOSSES,
	STANDARD_FAKE_PROVERB_LITERALS,
	STANDARD_FAKE_PROVERB_PROFILES,
	STANDARD_FAKE_PROVERB_PROVERBS,
	STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION,
	STANDARD_FAKE_PROVERB_RECIPE_SCHEMA_VERSION,
} from "../src/fakeProverb/generated/standardFakeProverbRecipeEntries";
import type { RawFakeProverbPart } from "../src/fakeProverb/recipeData";

export function ok<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
	if (!result.ok) throw new Error(result.reason);
	return result.value;
}

export function token(surface: string, pos: string, detail1: string, more: Partial<JapaneseToken> = {}): JapaneseToken {
	return { surface, pos, detail1, detail2: "*", detail3: "*", conjugationType: "*", conjugationForm: "*", baseForm: "*", isUnknown: false, ...more };
}
export const noun = (surface: string) => token(surface, "名詞", "一般", { baseForm: surface });
export const verb = (surface: string, conjugationType: string, conjugationForm = "基本形", baseForm = surface) =>
	token(surface, "動詞", "自立", { baseForm, conjugationType, conjugationForm });
export const adjective = (surface: string, conjugationType = "形容詞・イ段") =>
	token(surface, "形容詞", "自立", { baseForm: surface, conjugationType, conjugationForm: "基本形" });
export const particle = (surface: string) => token(surface, "助詞", "格助詞");
export const period = token("。", "記号", "句点");

/** Real-shaped dictionary tokens: seven regular verb classes, both i-adjective classes, and two a realizer must refuse. */
export const LEXICON: readonly JapaneseToken[] = [
	noun("猫"), noun("犬"), noun("夢"), noun("骨"), noun("川"), noun("月"), noun("星"), noun("鳥"),
	verb("見る", "一段"), verb("見", "一段", "連用形", "見る"), token("た", "助動詞", "*"), verb("書く", "五段・カ行イ音便"), verb("泳ぐ", "五段・ガ行"), verb("読む", "五段・マ行"),
	verb("待つ", "五段・タ行"), verb("話す", "五段・サ行"), verb("買う", "五段・ワ行促音便"),
	// Suppletive under 五段・ラ行 and a class the realizer never admits.
	verb("ある", "五段・ラ行"), verb("する", "サ変・スル"),
	adjective("早い", "形容詞・アウオ段"), adjective("美しい"),
	particle("は"), particle("を"), particle("と"), period,
];

/** Mints a genuine Manual Morph Vocabulary owner through the production analyzer, with a counting tokenizer. */
export async function mintOwner(texts: readonly string[], drawMode: "uniform" | "frequency" = "uniform", lexicon = LEXICON) {
	let calls = 0;
	const sorted = [...lexicon].sort((a, b) => b.surface.length - a.surface.length);
	const analyses = await Promise.all(texts.map(async (text, index) => {
		const answer = await analyzeManualMorphSource({ text, sourcePath: `private-note-${index}.md`, tokenizer: { tokenize: async (input) => {
			calls += 1;
			const result: JapaneseToken[] = [];
			for (let cursor = 0; cursor < input.length;) {
				const found = sorted.find((item) => input.startsWith(item.surface, cursor));
				const next = found ? { ...found } : token(String.fromCodePoint(input.codePointAt(cursor)!), "記号", "*", { isUnknown: true });
				result.push(next);
				cursor += next.surface.length;
			}
			return await Promise.resolve(result);
		} } });
		if (answer.status !== "ready") throw new Error("fixture-analysis");
		return answer.analysis;
	}));
	return { owner: buildManualMorphVocabulary({ sources: analyses, drawMode }), calls: () => calls };
}

export const RICH_TEXT = "猫は夢を見る。犬は骨を書く。川と月を泳ぐ。星は鳥を読む。猫は月を待つ。犬は川を話す。鳥は星を買う。夢はある。骨をする。早い美しい。";

export function standardInput(): CompileFakeProverbRecipeSetInput {
	return {
		schemaVersion: STANDARD_FAKE_PROVERB_RECIPE_SCHEMA_VERSION,
		dataVersion: STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION,
		proverbs: STANDARD_FAKE_PROVERB_PROVERBS,
		glosses: STANDARD_FAKE_PROVERB_GLOSSES,
		literals: STANDARD_FAKE_PROVERB_LITERALS,
		profiles: STANDARD_FAKE_PROVERB_PROFILES,
	};
}
export function compile(input: CompileFakeProverbRecipeSetInput): CompiledFakeProverbRecipeSet {
	const result = compileFakeProverbRecipeSet(input);
	if (!result.ok) throw new Error(result.issues.map((entry) => entry.code).join(","));
	return result.set;
}
export const standardSet = (): CompiledFakeProverbRecipeSet => compile(standardInput());

export const slot = (kind: string, slotId: string, profileId: string, exported = false): RawFakeProverbPart => ({ kind, slotId, profileId, exported });
export const literal = (literalId: string): RawFakeProverbPart => ({ kind: "literal", literalId });
export const reference = (slotKind: string, slotId: string): RawFakeProverbPart => ({ kind: "reference", slotKind, slotId });

/** A minimal custom set: proverb `{n1}は{v1}`, gloss `{n1}と{g1}`; profile forms and weights configurable. */
export function customInput(options: {
	predicateForms?: readonly { form: string; weight: number }[];
	nounWeight?: number;
	proverbs?: CompileFakeProverbRecipeSetInput["proverbs"];
	glosses?: CompileFakeProverbRecipeSetInput["glosses"];
	extraProfiles?: CompileFakeProverbRecipeSetInput["profiles"];
} = {}): CompileFakeProverbRecipeSetInput {
	return {
		schemaVersion: 1,
		dataVersion: 1,
		proverbs: options.proverbs ?? [{ id: "p-one", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true), literal("wa"), slot("predicate", "v1", "pred-p", true)] }],
		glosses: options.glosses ?? [{ id: "g-one", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n1" }],
			parts: [reference("noun", "n1"), literal("to"), slot("noun", "g1", "noun-p")] }],
		literals: [{ id: "wa", literal: "は" }, { id: "to", literal: "と" }],
		profiles: [
			{ id: "noun-p", kind: "noun", forms: [{ form: "independent-noun", weight: options.nounWeight ?? 1 }] },
			{ id: "pred-p", kind: "predicate", forms: options.predicateForms ?? [{ form: "verb-basic", weight: 1 }] },
			...(options.extraProfiles ?? []),
		],
	};
}
