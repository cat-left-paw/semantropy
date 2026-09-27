import { afterEach, describe, expect, it, vi } from "vitest";
import * as morphology from "../src/transform/manualMorphology";
import { transformWithVocabularySnapshot } from "../src/vocabulary/vocabularySnapshot";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { bodySlotScore } from "../src/transform/slotScore";
import { bindAutomaticPosTarget, inspectAutomaticPosResult, transformAutomaticPos } from "../src/transform/automaticPosCore";
import { releaseAutomaticPosOwner } from "../src/transform/automaticPosProjection";
import { releaseManualAdverbAuthority } from "../src/transform/manualAdverbAuthority";
import { ALL, NOUN, adj, adverb, bridge, comma, deepFrozen, lexicon, negative, noun, ok, period, prepare, sentence, textOwner, token, verb, walk } from "./automaticPosFixtures";
import { makeOwner } from "./manualAdverbFixtures";
afterEach(() => vi.restoreAllMocks());
const mixed = "猫歩く。美しい。ゆっくり歩く。犬書く。高い。じっくり書く。鳥描く。楽しい。すぐ描く。";
function nounComparable(value: ReturnType<ReturnType<typeof prepare>["run"]> | ReturnType<typeof transformWithVocabularySnapshot>) {
	return { texts: value.texts, tokenSurfaces: value.tokenSurfaces, selections: value.selections,
		replacementCount: value.replacementCount, replaceableSlotCount: value.replaceableSlotCount, bodySemantropy: value.bodySemantropy, drawMode: value.drawMode };
}
describe("Body 10 noun compatibility and isolated draws", () => {
	it.each(["uniform", "frequency"] as const)("matches legacy noun draws including exact Ruby for Current and Selected Notes: %s", async mode => {
		for (const selected of [false, true]) {
			const targetOwner = await textOwner(["｜猫《ねこ》犬鳥。猫。\n\n`犬`\n\n犬。"], lexicon, mode);
			const source = selected ? await textOwner(["｜星《ほし》星。｜鳥《とり》犬。", "｜猫《ねこ》猫｜猫《びょう》犬。"], lexicon, mode) : targetOwner;
			const prepared = prepare(source.owner, targetOwner.owner);
			const runs = morphology.readManualMorphVocabularySources(targetOwner.owner)![0]!.runs;
			let rubySelections = 0;
			for (const nonce of [0, 1, 7, 91, 0xffffffff]) for (const level of [0, 25, 50, 75, 100]) {
				const legacy = transformWithVocabularySnapshot({ tokenSequences: runs.map(run => run.tokens), snapshot: source.owner.snapshot,
					bodySeed: nonce, bodySemantropy: assertBodySemantropy(level), algorithmVersion: 1 });
				const result = prepared.run(NOUN, nonce, level);
				expect(nounComparable(result)).toEqual(nounComparable(legacy));
				rubySelections += result.selections.flat().filter(selection => selection?.rubyVariant).length;
			}
			expect(rubySelections).toBeGreaterThan(0);
		}
	});
	it.each(["uniform", "frequency"] as const)("all sixteen option combinations isolate every part: %s", async mode => {
		const { owner, calls } = await textOwner([mixed], lexicon, mode), p = prepare(owner);
		const beforeCalls = calls(), runs = morphology.readManualMorphVocabularySources(owner)![0]!.runs;
		for (const nonce of [0, 4, 91]) for (const level of [0, 43, 100]) {
			const full = p.run(ALL, nonce, level);
			for (let bits = 0; bits < 16; bits++) {
				const options = { noun: !!(bits & 1), verb: !!(bits & 2), iAdjective: !!(bits & 4), adverb: !!(bits & 8) };
				const result = p.run(options, nonce, level);
				for (const [i, run] of runs.entries()) for (const [j, item] of run.tokens.entries()) {
					const part = ({ "名詞": "noun", "動詞": "verb", "形容詞": "iAdjective", "副詞": "adverb" } as const)[item.token.pos as "名詞"];
					expect(result.tokenSurfaces[i]![j]).toBe(part && options[part] ? full.tokenSurfaces[i]![j] : item.token.surface);
					if (part && options[part]) expect(result.selections[i]![j]).toEqual(full.selections[i]![j]);
				}
				if (!bits) expect(result.replaceableSlotCount).toBe(0);
			}
		}
		expect(calls()).toBe(beforeCalls);
	});
	it.each(["uniform", "frequency"] as const)("candidate and slot counts in one part do not shift other surface draws: %s", async mode => {
		const target = await textOwner([mixed], lexicon, mode);
		const base = await textOwner([mixed], lexicon, mode), first = prepare(base.owner, target.owner);
		const extras = ["星星星。", "削く。削く。", "赤い。赤い。", "はっきり、はっきり、"];
		const extraTokens = [noun("星"), walk("削く"), adj("赤い"), adverb("はっきり"), comma];
		for (const [partIndex, extra] of extras.entries()) {
			const changed = await textOwner([mixed + extra], [...lexicon, ...extraTokens], mode);
			const p = prepare(changed.owner, target.owner);
			// Extra target slots precede all the original ones. At 100 the old positional level contract is irrelevant.
			const moreTarget = await textOwner([extra + mixed], [...lexicon, ...extraTokens], mode);
			const more = prepare(base.owner, moreTarget.owner);
			const offset = morphology.readManualMorphVocabularySources(moreTarget.owner)![0]!.runs[0]!.tokens.length - morphology.readManualMorphVocabularySources(target.owner)![0]!.runs[0]!.tokens.length;
			for (const nonce of [0, 13, 777]) {
				const expected = first.run(ALL, nonce), actual = p.run(ALL, nonce), extended = more.run(ALL, nonce);
				const tokens = morphology.readManualMorphVocabularySources(target.owner)![0]!.runs[0]!.tokens;
				for (const [i, item] of tokens.entries()) if (item.token.pos !== ["名詞", "動詞", "形容詞", "副詞"][partIndex]) {
					expect(actual.tokenSurfaces[0]![i]).toBe(expected.tokenSurfaces[0]![i]);
					expect(extended.tokenSurfaces[0]![i + offset]).toBe(expected.tokenSurfaces[0]![i]);
				}
			}
		}
	});
	it("canonicalizes Source order independently of completion and options", async () => {
		const { owner } = await textOwner([mixed, "猫猫。書く。じっくり書く。"]);
		const reversed = morphology.buildManualMorphVocabulary({ sources: [...owner.sources].reverse(), drawMode: "uniform" });
		const a = prepare(owner, owner), b = prepare(reversed, owner);
		expect(a.projection).toEqual(b.projection);
		for (const options of [ALL, NOUN, { ...ALL, noun: false }]) expect(a.run(options)).toEqual(b.run(options));
	});
	it("weights added parts by record frequency while Uniform weights distinct surfaces equally", async () => {
		const target = await textOwner(["歩く。美しい。ゆっくり歩く。"]);
		for (const mode of ["uniform", "frequency"] as const) {
			const source = await textOwner(["書く。高い。じっくり書く。".repeat(40) + "描く。楽しい。すぐ描く。"], lexicon, mode);
			const p = prepare(source.owner, target.owner), counts = [0, 0, 0];
			for (let nonce = 0; nonce < 128; nonce++) {
				const surfaces = p.run(ALL, nonce).tokenSurfaces[0]!;
				if (surfaces[0] === "書く") counts[0]!++;
				if (surfaces[2] === "高い") counts[1]!++;
				if (surfaces[4] === "じっくり") counts[2]!++;
			}
			for (const count of counts) { expect(count).toBeGreaterThan(mode === "frequency" ? 110 : 35); if (mode === "uniform") expect(count).toBeLessThan(95); }
		}
	});
	it("uses the existing positional Semantropy score and monotonic application", async () => {
		const { owner } = await textOwner([mixed]), p = prepare(owner);
		const full = p.run(), middle = p.run(ALL, 13, 47), zero = p.run(ALL, 13, 0);
		expect(zero.replacementCount).toBe(0); expect(zero.replaceableSlotCount).toBe(full.replaceableSlotCount);
		full.selections.forEach((run, i) => run.forEach((selection, j) => {
			const applied = bodySlotScore(13, { sequenceIndex: i, tokenIndex: j }) / 4294967296 < .47;
			expect(middle.selections[i]![j]).toEqual(applied ? selection : null);
		}));
	});
	it("excludes the current surface and refuses slots with no distinct alternative", async () => {
		const { owner } = await textOwner(["猫歩く。美しい。じっくり歩く。"]), p = prepare(owner);
		const result = p.run(); expect(result.replaceableSlotCount).toBe(0); expect(result.texts).toEqual(["猫歩く。美しい。じっくり歩く。"]);
		const varied = prepare((await textOwner([mixed])).owner);
		const runs = morphology.readManualMorphVocabularySources((await textOwner([mixed])).owner)![0]!.runs;
		for (const seed of [1, 9, 113]) varied.run(ALL, seed).selections.forEach((run, i) => run.forEach((selection, j) => {
			if (selection) expect(selection.candidate.surface).not.toBe(runs[i]!.tokens[j]!.token.surface);
		}));
	});
	it("excludes an authenticated displayed baseline on a repeated shuffle", async () => {
		const { owner } = await textOwner([mixed]), p = prepare(owner), current = p.run();
		const next = ok(transformAutomaticPos({ projection: p.projection, target: p.target, runCount: p.target.runCount, options: ALL, nonce: 13, bodySemantropy: 100, current }));
		next.selections.forEach((run, i) => run.forEach((selection, j) => {
			if (selection) expect(selection.candidate.surface).not.toBe(current.tokenSurfaces[i]![j]);
		}));
		expect(transformAutomaticPos({ projection: p.projection, target: p.target, runCount: p.target.runCount, options: ALL, nonce: 13, bodySemantropy: 100, current })).toEqual({ ok: false, reason: "stale" });
	});
});

describe("delegated morphology and adverb contracts", () => {
	it.each([
		["verb type", walk("書く", { conjugationType: "五段・ラ行" }), [walk("歩く"), period], false],
		["verb form", walk("書い", { conjugationForm: "連用タ接続" }), [walk("歩く"), period], false],
		["verb connection", walk("書く"), [walk("歩く"), token("ない", "助動詞", "*")], false],
		["adjective family", adj("高い", { conjugationType: "形容詞・アウオ段" }), [adj("美しい")], true],
		["adjective form", adj("高く", { conjugationForm: "連用テ接続" }), [adj("美しい")], false],
		["adjective follower", adj("高く", { conjugationForm: "連用テ接続" }), [adj("美しく", { conjugationForm: "連用テ接続" }), period], false],
		["non-independent", walk("書く", { detail1: "非自立" }), [walk("歩く"), period], false],
	] as const)("uses Manual authority for %s", async (_name, sourceToken, targetTokens, changes) => {
		const source = await makeOwner([[sourceToken, period]]), target = await makeOwner([targetTokens]);
		const result = prepare(source.owner, target.owner).run();
		expect(result.tokenSurfaces[0]![0]).toBe(changes ? sourceToken.surface : targetTokens[0].surface);
	});
	it("requires Source-observed verb connection, not merely matching morphology", async () => {
		const source = await makeOwner([[walk("あら", { conjugationType: "五段・ラ行", conjugationForm: "未然形" }), token("ず", "助動詞", "*")]]);
		const target = await makeOwner([[walk("分から", { conjugationType: "五段・ラ行", conjugationForm: "未然形" }), token("ない", "助動詞", "*")]]);
		expect(prepare(source.owner, target.owner).run().texts).toEqual(["分からない"]);
	});
	it.each([
		["family", token("じっくり", "名詞", "副詞可能"), [verb], adverb("ゆっくり", "助詞類接続"), [verb], false],
		["head", adverb("じっくり"), [adj("美しい")], adverb("ゆっくり", "助詞類接続"), [comma, verb], false],
		["polarity", adverb("じっくり"), negative, adverb("ゆっくり", "助詞類接続"), [verb], false],
		["bridge", adverb("すぐ", "助詞類接続"), [verb], adverb("ゆっくり", "助詞類接続"), [bridge, verb], false],
		["duplicate to", adverb("そっと"), [bridge, verb], adverb("ゆっくり", "助詞類接続"), [bridge, verb], false],
		["optional to", adverb("じっくり"), [verb], adverb("ゆっくり", "助詞類接続"), [bridge, verb], true],
		["optional none", adverb("ゆっくり", "助詞類接続"), [bridge, verb], adverb("じっくり"), [verb], true],
		["sentence amendment", adverb("決して"), [comma, ...negative], adverb("もちろん"), [comma, verb], true],
		["sentence head", adverb("決して"), [comma, ...negative], adverb("ゆっくり", "助詞類接続"), [verb], false],
	] as const)("uses the adverb authority for %s", async (_name, word, tail, targetWord, targetTail, changes) => {
		const source = await makeOwner([sentence(word, [...tail])]), target = await makeOwner([sentence(targetWord, [...targetTail])]);
		const result = prepare(source.owner, target.owner).run({ ...ALL, noun: false, verb: false, iAdjective: false });
		expect(result.tokenSurfaces[0]![0]).toBe(changes ? word.surface : targetWord.surface);
		expect(result.tokenSurfaces[0]!.slice(1)).toEqual([...targetTail, period].map(token => token.surface));
	});
	it("keeps unknown missing morphology protected text and Ruby readings out of automatic draws", async () => {
		const { owner, calls } = await textOwner(["`猫`\n\n｜犬《猫》鳥。\n\n```txt\n猫歩く。\n```\n\nゆっくり歩く。" ]);
		const source = await textOwner([mixed]); const p = prepare(source.owner, owner), before = calls();
		const result = p.run(); expect(result.runIds).toHaveLength(2); expect(calls()).toBe(before);
		expect(morphology.readManualMorphVocabularySources(owner)![0]!.runs.flatMap(run => run.tokens).filter(item => item.token.surface === "猫")).toHaveLength(0);
		for (const changed of [{ isUnknown: true }, { conjugationType: "*" }, { conjugationForm: "*" }, { baseForm: "*" }]) {
			const target = await makeOwner([[walk("歩く", changed), period]]);
			expect(prepare(source.owner, target.owner).run().texts).toEqual(["歩く。"]);
		}
		const unsafeTarget = await makeOwner([[walk("歩\u200bく"), period]]);
		expect(prepare(source.owner, unsafeTarget.owner).run().texts).toEqual(["歩\u200bく。"]);
	});
	it("uses only verified Source Ruby and never candidate reading as a Ruby pair", async () => {
		const target = await textOwner(["美しい。"]);
		const source = await textOwner(["｜高《たか》い。"], [adj("高い", { reading: "SECRET-READING" })]);
		const selected = prepare(source.owner, target.owner).run().selections[0]![0]!;
		expect(selected.rubyVariant?.reading).toBe("たか");
		const unverified = await textOwner(["高い。"], [adj("高い", { reading: "SECRET-READING" })]);
		expect(prepare(unverified.owner, target.owner).run().selections[0]![0]!.rubyVariant).toBeNull();
	});
});

describe("owned lifecycle and generation seals", () => {
	it("rejects forged Target handles and foreign projection bindings", async () => {
		const { owner } = await textOwner([mixed]), a = prepare(owner), b = prepare((await textOwner([mixed])).owner);
		const input = { projection: a.projection, target: a.target, options: ALL, nonce: 1, bodySemantropy: 100, runCount: a.target.runCount };
		for (const target of [{ ...a.target }, b.target, {}]) expect(transformAutomaticPos({ ...input, target: target as never }).ok).toBe(false);
		expect(bindAutomaticPosTarget({ projection: a.projection, targetVocabulary: { ...owner }, source: owner.sources[0]! })).toEqual({ ok: false, reason: "invalid-owner" });
		expect(bindAutomaticPosTarget({ projection: a.projection, targetVocabulary: owner, source: { ...owner.sources[0]! } })).toEqual({ ok: false, reason: "invalid-owner" });
	});
	it("normalizes equivalent source handles without confusing different Sources", async () => {
		const { owner } = await textOwner([mixed, mixed]); const p = prepare(owner);
		const other = ok(bindAutomaticPosTarget({ projection: p.projection, targetVocabulary: owner, source: owner.sources[1]! }));
		expect(other).not.toBe(p.target);
		expect(ok(bindAutomaticPosTarget({ projection: p.projection, targetVocabulary: owner, source: owner.sources[0]! }))).toBe(p.target);
	});
	it("refuses delayed results after supersession, foreign binding or cloning", async () => {
		const p = prepare((await textOwner([mixed])).owner), old = p.run(), latest = p.run(NOUN);
		expect(inspectAutomaticPosResult({ ...p, result: old }).ok).toBe(false); // extra envelope fields are not authority
		const check = (result: typeof old) => inspectAutomaticPosResult({ projection: p.projection, target: p.target, result });
		expect(check(old)).toEqual({ ok: false, reason: "stale" }); expect(check(latest)).toEqual({ ok: true, value: true });
		expect(check({ ...latest })).toEqual({ ok: false, reason: "provenance-mismatch" });
	});
	it.each(["source-changed", "refresh", "apply", "view-close", "plugin-disable"] as const)("rejects %s owners on generation and delayed inspection", async reason => {
		for (const releaseTarget of [false, true]) {
			const source = (await textOwner([mixed])).owner, targetOwner = (await textOwner([mixed])).owner, p = prepare(source, targetOwner), result = p.run();
			ok(releaseAutomaticPosOwner({ vocabulary: releaseTarget ? targetOwner : source, reason }));
			const expected = { ok: false, reason: reason === "source-changed" ? "stale" : "released" };
			expect(inspectAutomaticPosResult({ projection: p.projection, target: p.target, result })).toEqual(expected);
			expect(transformAutomaticPos({ projection: p.projection, target: p.target, runCount: p.target.runCount, options: ALL, bodySemantropy: 100, nonce: 1 })).toEqual(expected);
		}
	});
	it("honors independent adverb authority release even with Adverb OFF", async () => {
		const { owner } = await textOwner([mixed]), p = prepare(owner), result = p.run(NOUN);
		ok(releaseManualAdverbAuthority({ authority: p.authority, reason: "view-close" }));
		expect(inspectAutomaticPosResult({ projection: p.projection, target: p.target, result })).toEqual({ ok: false, reason: "released" });
	});
	it("has frozen private-material-free identities and evaluates only the requested prefix", async () => {
		const { owner } = await textOwner([mixed + "\n\n" + mixed]), p = prepare(owner), spy = vi.spyOn(morphology, "evaluateManualMorphSlot");
		const empty = p.run(ALL, 0, 100, 0); expect(empty.texts).toEqual([]); expect(spy).not.toHaveBeenCalled();
		const result = p.run(ALL, 0, 100, 1); expect(result.runIds).toHaveLength(1);
		expect(deepFrozen(p.projection) && deepFrozen(p.target) && deepFrozen(result)).toBe(true);
		expect(result).toMatchObject({ bodyAlgorithmVersion: 10, algorithmVersion: 2, projectionVersion: "automatic-body-projection-2" });
		expect(JSON.stringify(result)).not.toMatch(/"(?:nonce|seed|options|identityMaterial|automaticPartsOfSpeech)"/u);
	});
	it("rejects malformed requests without exposing errors or reading getters", async () => {
		const p = prepare((await textOwner([mixed])).owner);
		const input = { projection: p.projection, target: p.target, options: ALL, nonce: 1, bodySemantropy: 100, runCount: 1 };
		for (const change of [{ nonce: -1 }, { nonce: 2 ** 32 }, { bodySemantropy: 101 }, { bodySemantropy: NaN }, { options: {} }, { options: { ...ALL, adverb: 1 } }, { runCount: 2 }, { token: {} }])
			expect(transformAutomaticPos({ ...input, ...change } as never)).toEqual({ ok: false, reason: "invalid-request" });
		const getter = { ...input }; Object.defineProperty(getter, "nonce", { get: () => { throw new Error("PRIVATE"); } });
		expect(transformAutomaticPos(getter)).toEqual({ ok: false, reason: "invalid-request" });
	});
});
