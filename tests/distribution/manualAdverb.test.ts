import { beforeAll, expect, it } from "vitest";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { evaluateManualAdverbCandidate } from "../../src/transform/manualAdverbAuthority";
import { createManualAdverbController } from "../../src/transform/manualAdverbController";
import { bind, build, candidate, unwrap } from "../manualAdverbFixtures";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";
let tokenize: Tokenize;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); });

it.each([
	["ゆっくりと歩く。", "じっくり歩く。", "じっくり", "usable"],
	["じっくり歩く。", "ゆっくりと歩く。", "ゆっくり", "usable"],
	["ゆっくりと歩く。", "すぐ歩く。", "すぐ", "bridge-not-capable"],
	["ゆっくり歩く。", "じっくり歩かない。", "じっくり", "polarity-mismatch"],
	["もちろん、彼は来る。", "決して、彼は来ない。", "決して", "usable"],
	["とても美しい。", "かなり美しい。", "かなり", "usable"],
	["ゆっくりと歩く。", "そっと歩く。", "そっと", "duplicate-to-bridge"],
	["ゆっくり歩く。", "じっくりと歩く。", "じっくり", "unobserved"],
	["ゆっくりと歩く。", "意外とと歩く。", "意外と", "unobserved"],
])("authenticates real compact tokens: %s / %s", async (target, source, surface, expected) => {
	let calls = 0;
	async function owner(text: string, sourcePath: string) {
		const analyzed = await analyzeManualMorphSource({ text, sourcePath, tokenizer: {
			tokenize: input => { calls++; return Promise.resolve(tokenize(input)); },
		} });
		if (analyzed.status !== "ready") throw new Error("fixture-analysis");
		return buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "frequency" });
	}
	const targetOwner = await owner(target, "target.md"), sourceOwner = await owner(source, "source.md");
	const authority = build(sourceOwner), slot = bind(authority, targetOwner);
	if (expected === "unobserved") {
		// With these exact punctuated inputs the shipped tokenizer emits 格助詞/引用 と, not 副詞化 と.
		expect(sourceOwner.snapshot.projections.manual.candidates.some(item => item.surface === surface)).toBe(true);
		expect(authority.candidates).toHaveLength(0); expect(calls).toBe(2); return;
	}
	const result = unwrap(evaluateManualAdverbCandidate({ authority, slot, candidate: candidate(authority, surface) }));
	if (expected === "usable") {
		expect(result.usable).toBe(true);
		const controller = unwrap(createManualAdverbController({ authority, slots: [{ slot, automaticSurface: slot.originalSurface }] }));
		const committed = unwrap(controller.complete(unwrap(controller.prepare({ slot, action: "shuffle", nonce: 11 }))));
		expect(committed.rows[0]!.committed.surface).toBe(surface);
		expect(committed.rows[0]!.committed.candidate?.record.origins[0]!.path).toBe("source.md");
		expect(target.replace(slot.originalSurface, surface)).toBe(surface + target.slice(slot.originalSurface.length));
		unwrap(controller.release("view-close"));
	} else expect(result).toMatchObject({ usable: false, reason: expected });
	// Both initial analyses only; authority/evaluation/Manual never tokenize again.
		expect(calls).toBe(2);
});
