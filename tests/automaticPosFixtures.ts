import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../src/transform/manualMorphology";
import { createManualAdverbAuthority } from "../src/transform/manualAdverbAuthority";
import { createAutomaticPosProjection } from "../src/transform/automaticPosProjection";
import { bindAutomaticPosTarget, transformAutomaticPos, type AutomaticPosOptions } from "../src/transform/automaticPosCore";
import { adverb, adjective, period, token, verb } from "./manualAdverbFixtures";
export { adverb, adjective, bridge, comma, negative, period, sentence, token, verb } from "./manualAdverbFixtures";
export function ok<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T { if (!result.ok) throw new Error(result.reason); return result.value; }
export const ALL: AutomaticPosOptions = { noun: true, verb: true, iAdjective: true, adverb: true };
export const NOUN: AutomaticPosOptions = { noun: true, verb: false, iAdjective: false, adverb: false };
export const noun = (surface: string) => token(surface, "名詞", "一般");
export const walk = (surface: string, more: Partial<JapaneseToken> = {}) => ({ ...verb, surface, baseForm: surface, ...more });
export const adj = (surface: string, more: Partial<JapaneseToken> = {}) => ({ ...adjective, surface, baseForm: surface, ...more });
export const lexicon = [noun("猫"), noun("犬"), noun("鳥"), noun("星"), walk("歩く"), walk("書く"), walk("描く"),
	adj("美しい"), adj("楽しい"), adj("高い", { conjugationType: "形容詞・アウオ段" }),
	adverb("ゆっくり", "助詞類接続"), adverb("じっくり"), adverb("すぐ", "助詞類接続"), period];
export async function textOwner(texts: readonly string[], tokens = lexicon, drawMode: "uniform" | "frequency" = "uniform", mode: "source" | "target-prototype" = "source") {
	let calls = 0;
	const sorted = [...tokens].sort((a, b) => b.surface.length - a.surface.length);
	const sources = await Promise.all(texts.map(async (text, i) => {
		const answer = await analyzeManualMorphSource({ text, mode, sourcePath: `note-${i}.md`, tokenizer: { tokenize: async input => {
			calls++; const result: JapaneseToken[] = [];
			for (let cursor = 0; cursor < input.length;) {
				const found = sorted.find(item => input.startsWith(item.surface, cursor));
				const next = found ? { ...found } : token(String.fromCodePoint(input.codePointAt(cursor)!), "記号", "*", { isUnknown: true });
				result.push(next); cursor += next.surface.length;
			}
			return result;
		} } });
		if (answer.status !== "ready") throw new Error("analysis failed"); return answer.analysis;
	}));
	return { owner: buildManualMorphVocabulary({ sources, drawMode }), calls: () => calls };
}
export function prepare(vocabulary: ManualMorphVocabulary, targetVocabulary = vocabulary, sourceIndex = 0) {
	const authority = ok(createManualAdverbAuthority({ vocabulary }));
	const projection = ok(createAutomaticPosProjection({ vocabulary, adverbAuthority: authority }));
	const target = ok(bindAutomaticPosTarget({ projection, targetVocabulary, source: targetVocabulary.sources[sourceIndex]! }));
	const run = (options = ALL, nonce = 13, bodySemantropy = 100, runCount = target.runCount) =>
		ok(transformAutomaticPos({ projection, target, options, nonce, bodySemantropy, runCount }));
	return { authority, projection, target, run };
}
export function deepFrozen(value: unknown, seen = new Set<unknown>()): boolean {
	if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return true;
	seen.add(value);
	if (!Object.isFrozen(value) || value instanceof Map || value instanceof Set) return false;
	return Reflect.ownKeys(value).every(key => deepFrozen(Object.getOwnPropertyDescriptor(value, key)?.value, seen));
}
