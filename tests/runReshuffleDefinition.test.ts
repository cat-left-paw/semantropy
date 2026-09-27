import { describe, expect, it } from "vitest";
import { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import { runReshuffleDefinition } from "../src/application/runReshuffleDefinition";
import { generateFakeDefinition } from "../src/dictionary/generateFakeDefinition";
import { validateHeadword } from "../src/dictionary/headword";
import { buildDictionaryVocabularyPool } from "../src/dictionary/vocabularyPool";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { token } from "./tokenFixtures";
import { collectVocabulary } from "./collectFixtures";

const CAT = token({ surface: "猫" });
const POOL = buildDictionaryVocabularyPool([[CAT, token({ surface: "机" })]]);
const HEADWORD = (() => {
	const result = validateHeadword("猫", [CAT]);
	if (result.outcome !== "accepted") {
		throw new Error("fixture");
	}
	return result.headword;
})();
const SNAPSHOT = { sourcePath: "n.md", contentHash: "ab".repeat(32) };

function commitGenerated(world: FakeDictionaryWorld, seed: number) {
	const requestId = world.beginRequest();
	world.ensureSeed(() => seed);
	const result = generateFakeDefinition({
		headword: HEADWORD,
		pool: POOL,
		dictionarySeed: seed,
		dictionarySemantropy: 50,
	});
	if (result.outcome !== "generated") {
		throw new Error(`expected generated, got ${result.outcome}`);
	}
	world.commit(requestId, {
		headword: HEADWORD,
		pool: POOL,
		snapshot: SNAPSHOT,
		vocabulary: collectVocabulary(["n.md"]),
		dictionarySeed: seed,
		dictionarySemantropy: assertDictionarySemantropy(50),
		result,
	});
	return result;
}

describe("runReshuffleDefinition", () => {
	it("issues one new Seed and redraws without touching the saved pool", () => {
		const world = new FakeDictionaryWorld();
		const first = commitGenerated(world, 1);
		let issued = 0;
		const outcome = runReshuffleDefinition({
			world,
			modalOpen: true,
			issueSeed: () => {
				issued += 1;
				return 9;
			},
			isAbandoned: () => false,
		});
		expect(outcome).toBe("applied");
		expect(issued).toBe(1);
		expect(world.getSeed()).toBe(9);
		const current = world.getCurrent();
		expect(current?.result.outcome).toBe("generated");
		if (current?.result.outcome !== "generated") {
			return;
		}
		expect(current.dictionarySeed).toBe(9);
		expect(current.result.definition).not.toBe(first.definition);
		expect(current.pool).toBe(POOL);
		expect(current.snapshot).toEqual(SNAPSHOT);
		expect(
			generateFakeDefinition({
				headword: HEADWORD,
				pool: POOL,
				dictionarySeed: 9,
				dictionarySemantropy: 50,
			}),
		).toEqual(current.result);
	});

	it("is unavailable without a generated definition or an open modal", () => {
		const world = new FakeDictionaryWorld();
		expect(
			runReshuffleDefinition({
				world,
				modalOpen: true,
				issueSeed: () => 1,
				isAbandoned: () => false,
			}),
		).toBe("unavailable");
		commitGenerated(world, 1);
		expect(
			runReshuffleDefinition({
				world,
				modalOpen: false,
				issueSeed: () => 2,
				isAbandoned: () => false,
			}),
		).toBe("unavailable");
		expect(world.getSeed()).toBe(1);
	});
});
