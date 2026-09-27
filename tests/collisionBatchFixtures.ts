import { compileCollisionPatternSet } from "../src/collision/compilePatternSet";
import { STANDARD_COLLISION_CONNECTORS, STANDARD_COLLISION_LITERALS, STANDARD_COLLISION_MODIFIER_FORMS,
	STANDARD_COLLISION_NOUN_SUFFIXES, STANDARD_COLLISION_RECIPES } from "../src/collision/generated/standardCollisionPatternEntries";
import type { RawCollisionRecipe } from "../src/collision/patternData";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../src/transform/manualMorphology";
import { createCollisionBatchController, type CollisionBatchController, type CollisionBatchResult, type CollisionOperationTicket } from "../src/collision/collisionBatch";

export function unwrap<T>(result: CollisionBatchResult<T>): T {
	if (!result.ok) throw new Error(result.reason);
	return result.value;
}
export const privateMaterial = (index: number) => index.toString(16).padStart(64, "0");
export function batchController(index = 1) {
	return unwrap(createCollisionBatchController({ identityMaterial: privateMaterial(index) }));
}
export function commit(controller: CollisionBatchController, ticket: CollisionOperationTicket) {
	return controller.complete(ticket, unwrap(controller.prepare(ticket)));
}
export function patterns(recipes: readonly RawCollisionRecipe[] = STANDARD_COLLISION_RECIPES) {
	const compiled = compileCollisionPatternSet({ schemaVersion: 2, dataVersion: 2, recipes,
		literals: STANDARD_COLLISION_LITERALS, connectors: STANDARD_COLLISION_CONNECTORS,
		modifierForms: STANDARD_COLLISION_MODIFIER_FORMS, nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES });
	if (!compiled.ok) throw new Error("fixture-pattern");
	return compiled.set;
}
export function nounRecipe(id = "single", selectable = true, enabled = true): RawCollisionRecipe {
	return { id, label: id, enabled, selectable, weight: 1, presence: [], parts: [{ kind: "noun", slotId: "n1", optional: false }] };
}
export function token(surface: string, overrides: Partial<JapaneseToken> = {}): JapaneseToken {
	return { surface, pos: "名詞", detail1: "一般", detail2: "*", detail3: "*", conjugationType: "*",
		conjugationForm: "*", baseForm: surface, isUnknown: false, ...overrides };
}
export async function vocabulary(tokens: readonly JapaneseToken[] = ["都市", "猫", "海", "星", "雲", "森"].map((word) => token(word)), drawMode: "uniform" | "frequency" = "uniform") {
	const text = tokens.map((item) => item.surface).join("");
	let calls = 0;
	const analyzed = await analyzeManualMorphSource({ text, sourcePath: "synthetic.md", tokenizer: {
		tokenize: (input) => {
			calls += 1;
			if (input !== text) throw new Error("fixture-run");
			return Promise.resolve(tokens.map((item) => ({ ...item })));
		},
	} });
	if (analyzed.status !== "ready") throw new Error("fixture-analysis");
	const owner = buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode });
	return { owner, calls: () => calls };
}
export function scaleTokens(scale: number): JapaneseToken[] {
	const tokens = Array.from({ length: scale * 6 }, (_, i) => token(`名詞${i}`));
	for (let i = 0; i < scale; i += 1) {
		tokens.push(token(`変化${i}`, { detail1: "サ変接続" }), token(`静か${i}`, { detail1: "形容動詞語幹" }),
			token(`赤${i}い`, { pos: "形容詞", detail1: "自立", conjugationType: "形容詞・アウオ段", conjugationForm: "基本形" }),
			token(`眠${i}る`, { pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形" }));
	}
	return tokens;
}
