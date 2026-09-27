import { describe, expect, it } from "vitest";
import { analyzeManualMorphSource, buildManualMorphVocabulary, evaluateManualMorphSlot, manualMorphConnection } from "../src/transform/manualMorphology";
import { lexiconTokenizer, morphToken, suffix } from "./support/manualMorphHarness";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";

const hot = morphToken("暑い", "形容詞・アウオ段", "基本形", "形容詞");
const beautiful = morphToken("美しい", "形容詞・イ段", "基本形", "形容詞");
async function prepare(tokens: JapaneseToken[], text = tokens.map(t => t.surface).join("")) {
	const analyzed = await analyzeManualMorphSource({ text, sourcePath: "source.md", tokenizer: lexiconTokenizer(tokens) });
	if (analyzed.status !== "ready") throw Error(analyzed.status);
	return buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
}
describe("COVERAGE1 explicit adjective policy", () => {
	it.each([
		[{ isUnknown: true }, "unknown-token"],
		[{ pos: "助動詞", detail1: "*" }, "unsupported-part-of-speech"],
		[{ detail1: "接尾" }, "unsupported-part-of-speech"],
		[{ detail1: "非自立" }, "unsupported-part-of-speech"],
		[{ pos: "名詞", detail1: "形容動詞語幹" }, "unsupported-part-of-speech"],
		[{ conjugationType: "形容詞・イイ" }, "unsupported-conjugation-type"],
		[{ conjugationType: "不変化型" }, "unsupported-conjugation-type"],
		[{ conjugationType: "unknown" }, "unsupported-conjugation-type"],
		[{ conjugationType: "*" }, "missing-field"],
		[{ conjugationForm: "*" }, "missing-field"],
		[{ baseForm: "*" }, "missing-field"],
		[{ surface: "*" }, "missing-field"],
		[{ conjugationForm: "未然形" }, "unsupported-conjugation-form"],
	] as const)("rejects the occurrence by fields, as Target and candidate: %j", async (patch, reason) => {
		const rejected = { ...beautiful, ...patch };
		expect(manualMorphConnection(rejected, null)).toEqual({ supported: false, reason });
		const active = await prepare([rejected]);
		expect(evaluateManualMorphSlot({ target: hot, next: null, currentSurface: hot.surface, ...active })).toMatchObject({ available: false, reason: "no-candidate" });
	});
	it("does not blacklist the surface ない; occurrence morphology is authoritative", async () => {
		const independent = { ...beautiful, surface: "ない", baseForm: "ない", conjugationType: "形容詞・アウオ段" };
		const active = await prepare([independent]);
		expect(evaluateManualMorphSlot({ target: hot, next: null, currentSurface: hot.surface, ...active }).candidates.map(c => c.surface)).toEqual(["ない"]);
	});
	it("keeps Target requirements separate from candidate observation for every supported form", async () => {
		for (const [form, follower] of [["基本形", null], ["連用テ接続", suffix("て")], ["連用タ接続", suffix("た", "助動詞", "*")], ["仮定形", suffix("ば")]] as const) {
			const target = { ...hot, conjugationForm: form }, source = { ...beautiful, conjugationForm: form };
			const active = await prepare([source]); // Source run end, even for nonbasic forms.
			const result = evaluateManualMorphSlot({ target, next: follower, currentSurface: target.surface, ...active });
			expect(result).toMatchObject({ available: true, compatibility: { conjugationForm: form, compatibilityFamily: "regular-i-adjective", candidateObservation: "same-form" } });
			expect(result.candidates.map(c => c.surface)).toEqual([source.surface]);
			if (form !== "基本形") expect(evaluateManualMorphSlot({ target, next: null, currentSurface: target.surface, ...active })).toMatchObject({ reason: "unsupported-connection" });
		}
	});
	it("binds cloned/foreign evidence and Snapshot, current-surface exclusion, Ruby and protected Source", async () => {
		const active = await prepare([beautiful], "｜美しい《うつくしい》"), other = await prepare([beautiful]);
		const evaluate = (snapshot = active.snapshot, evidence = active.evidence, currentSurface = hot.surface) => evaluateManualMorphSlot({ target: hot, next: null, currentSurface, snapshot, evidence });
		expect(evaluate().candidates[0]?.verifiedRubyVariants.map(v => v.reading)).toEqual(["うつくしい"]);
		for (const evidence of [structuredClone(active.evidence), { ...active.evidence }, JSON.parse(JSON.stringify(active.evidence)) as typeof active.evidence, other.evidence]) expect(evaluate(active.snapshot, evidence)).toMatchObject({ reason: "invalid-evidence" });
		for (const snapshot of [structuredClone(active.snapshot), other.snapshot]) expect(evaluate(snapshot)).toMatchObject({ reason: "invalid-evidence" });
		expect(evaluate(active.snapshot, active.evidence, "美しい")).toMatchObject({ reason: "only-current-surface" });
		const hidden = await prepare([beautiful], "`美しい`\n\n```\n美しい\n```");
		expect(evaluateManualMorphSlot({ target: hot, next: null, currentSurface: hot.surface, ...hidden })).toMatchObject({ reason: "no-candidate" });
		expect(Object.isFrozen(hot)).toBe(false); expect(Object.isFrozen(beautiful)).toBe(false);
	});
});
