import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import type { ManualMorphVocabulary } from "../src/transform/manualMorphology";
import { createManualAdverbAuthority } from "../src/transform/manualAdverbAuthority";
import { bindMaxTarget, createMaxProjection, transformMax, type MaxResult } from "../src/transform/maxCore";
import type { AutomaticPosOptions } from "../src/transform/automaticPosOptions";
import { ALL, ok, prepare } from "./automaticPosFixtures";
import { token } from "./manualAdverbFixtures";
export { ALL, NOUN, ok, deepFrozen, textOwner, prepare } from "./automaticPosFixtures";
export { adverb, bridge, comma, makeOwner, negative, period, sentence, token } from "./manualAdverbFixtures";

/** Real-shaped dictionary tokens: every field the compact IPADIC keeps for an independent verb / i-adjective. */
export const v = (surface: string, baseForm: string, conjugationType: string, conjugationForm: string, more: Partial<JapaneseToken> = {}) =>
	token(surface, "動詞", "自立", { baseForm, conjugationType, conjugationForm, ...more });
export const a = (surface: string, baseForm: string, conjugationForm: string, conjugationType = "形容詞・イ段", more: Partial<JapaneseToken> = {}) =>
	token(surface, "形容詞", "自立", { baseForm, conjugationType, conjugationForm, ...more });
export const aux = (surface: string) => token(surface, "助動詞", "*");
export const particle = (surface: string, detail1 = "接続助詞") => token(surface, "助詞", detail1);
export const noun = (surface: string, detail1 = "一般", more: Partial<JapaneseToken> = {}) => token(surface, "名詞", detail1, more);
export const suffix = (surface: string) => token(surface, "動詞", "接尾");

export function prepareMax(vocabulary: ManualMorphVocabulary, targetVocabulary = vocabulary, sourceIndex = 0) {
	const authority = ok(createManualAdverbAuthority({ vocabulary }));
	const projection = ok(createMaxProjection({ vocabulary, adverbAuthority: authority }));
	const target = ok(bindMaxTarget({ projection, targetVocabulary, source: targetVocabulary.sources[sourceIndex]! }));
	const run = (options: AutomaticPosOptions = ALL, nonce = 13, bodySemantropy = 100, runCount = target.runCount, current?: MaxResult) =>
		ok(transformMax({ projection, target, options, nonce, bodySemantropy, runCount, ...(current ? { current } : {}) }));
	return { authority, projection, target, run };
}
/** Body 10 is the comparison oracle for strict. */
export const body10 = prepare;
/** The Body 10 selection shape, for exact comparison with a strict MAX selection. */
export function legacyShape(result: MaxResult) {
	return result.selections.map(run => run.map(selection => selection ? { candidate: selection.candidate, rubyVariant: selection.rubyVariant } : null));
}
export const options = (bits: number): AutomaticPosOptions => ({ noun: !!(bits & 1), verb: !!(bits & 2), iAdjective: !!(bits & 4), adverb: !!(bits & 8) });
