import { expect, it } from "vitest";
import { deriveManualMorphTarget, buildManualMorphVocabulary, readManualMorphVocabularySources } from "../src/transform/manualMorphology";
import { buildTargetLineIndex, planTargetLineChunks } from "../src/analysis/targetChunkIr";
import { textOwner, prepare, ALL } from "./automaticPosFixtures";

it("replays only a requested Target prefix from authentic analysis without tokenizing again", async () => {
	const text = "猫《ねこ》ゆっくり歩く。\n犬じっくり書く。\n美しい鳥。\n楽しい星。";
	const source = await textOwner([text], undefined, "uniform", "target-prototype"), calls = source.calls();
	const index = buildTargetLineIndex(text, 1), descriptors = planTargetLineChunks(index, 14);
	expect(descriptors.length).toBeGreaterThan(1);
	for (let count = 1; count <= descriptors.length; count++) {
		const derived = deriveManualMorphTarget(source.owner.sources[0]!, index, descriptors.slice(0, count));
		expect(derived.chunks).toHaveLength(count);
		const target = buildManualMorphVocabulary({ sources: [derived.analysis], drawMode: "uniform" });
		const bound = prepare(source.owner, target);
		expect(bound.run(ALL).runIds).toEqual(readManualMorphVocabularySources(target)![0]!.runs.map(run => run.run.runId));
	}
	expect(source.calls()).toBe(calls);
	expect(() => deriveManualMorphTarget({ ...source.owner.sources[0]! }, index, descriptors)).toThrow("Invalid Target owner.");
	expect(() => deriveManualMorphTarget(source.owner.sources[0]!, index, [{ ...descriptors[0]! }])).toThrow();
	expect(() => deriveManualMorphTarget(source.owner.sources[0]!, buildTargetLineIndex(text + "犬", 1), descriptors)).toThrow();
	expect(() => deriveManualMorphTarget(source.owner.sources[0]!, { ...index }, [])).toThrow("Invalid Target owner.");
});
