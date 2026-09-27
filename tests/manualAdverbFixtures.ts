import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { analyzeManualMorphSource, buildManualMorphVocabulary, readManualMorphVocabularySources, type ManualMorphVocabulary } from "../src/transform/manualMorphology";
import { bindManualAdverbSlot, createManualAdverbAuthority, type ManualAdverbAuthority } from "../src/transform/manualAdverbAuthority";
import type { ManualAdverbResult } from "../src/transform/manualAdverbGuard";
export function unwrap<T>(result: ManualAdverbResult<T>): T { if (!result.ok) throw new Error(result.reason); return result.value; }
export function token(surface: string, pos = "副詞", detail1 = "一般", more: Partial<JapaneseToken> = {}): JapaneseToken {
	return { surface, pos, detail1, detail2: "*", detail3: "*", conjugationType: "*", conjugationForm: "*", baseForm: "*", isUnknown: false, ...more };
}
export const adverb = (surface: string, detail1 = "一般") => token(surface, "副詞", detail1);
export const bridge = token("と", "助詞", "副詞化");
export const comma = token("、", "記号", "読点");
export const period = token("。", "記号", "句点");
export const verb = token("歩く", "動詞", "自立", { baseForm: "歩く", conjugationType: "五段・カ行イ音便", conjugationForm: "基本形" });
export const negative = [token("歩か", "動詞", "自立", { ...verb, surface: "歩か", conjugationForm: "未然形" }), token("ない", "助動詞", "*")];
export const adjective = token("美しい", "形容詞", "自立", { baseForm: "美しい", conjugationType: "形容詞・イ段", conjugationForm: "基本形" });
export const sentence = (word: JapaneseToken, tail = [verb]) => [word, ...tail, period];
export async function makeOwner(sources: readonly (readonly JapaneseToken[])[], drawMode: "uniform" | "frequency" = "uniform") {
	let calls = 0;
	const analyzed = await Promise.all(sources.map(async (tokens, i) => {
		const text = tokens.map(item => item.surface).join("");
		const result = await analyzeManualMorphSource({ text, sourcePath: `private-source-${i}.md`, tokenizer: {
			tokenize: (input) => { calls++; if (input !== text) throw new Error("private-tokenizer-message"); return Promise.resolve(tokens.map(item => ({ ...item }))); },
		} });
		if (result.status !== "ready") throw new Error("fixture-analysis"); return result.analysis;
	}));
	return { owner: buildManualMorphVocabulary({ sources: analyzed, drawMode }), calls: () => calls };
}
export const build = (owner: ManualMorphVocabulary) => unwrap(createManualAdverbAuthority({ vocabulary: owner }));
export function bind(authority: ManualAdverbAuthority, targetVocabulary: ManualMorphVocabulary, tokenIndex = 0, sourceIndex = 0) {
	const source = readManualMorphVocabularySources(targetVocabulary)![sourceIndex]!;
	return unwrap(bindManualAdverbSlot({ authority, targetVocabulary, source: source.analysis, runId: source.runs[0]!.run.runId, tokenIndex }));
}
export function candidate(authority: ManualAdverbAuthority, surface: string, adverbClass?: string) {
	const result = authority.candidates.find(item => item.record.surface === surface && (!adverbClass || item.identity.adverbClass === adverbClass));
	if (!result) throw new Error("fixture-candidate"); return result;
}
