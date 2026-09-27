import { describe, expect, it } from "vitest";
import { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
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

function generated(seed: number) {
	const result = generateFakeDefinition({
		headword: HEADWORD,
		pool: POOL,
		dictionarySeed: seed,
		dictionarySemantropy: 50,
	});
	if (result.outcome !== "generated") {
		throw new Error(`expected generated, got ${result.outcome}`);
	}
	return result;
}

describe("FakeDictionaryWorld", () => {
	it("issues the Seed once and reuses it, including 0", () => {
		const world = new FakeDictionaryWorld();
		expect(world.getSeed()).toBeNull();
		expect(world.ensureSeed(() => 0)).toBe(0);
		expect(world.ensureSeed(() => 99)).toBe(0);
		expect(world.getSeed()).toBe(0);
	});

	it("keeps the Seed when the display is invalidated", () => {
		const world = new FakeDictionaryWorld();
		const requestId = world.beginRequest();
		world.ensureSeed(() => 7);
		world.commit(requestId, {
			headword: HEADWORD,
			pool: POOL,
			snapshot: { sourcePath: "n.md", contentHash: "ab".repeat(32) },
			vocabulary: collectVocabulary(["n.md"]),
			dictionarySeed: 7,
			dictionarySemantropy: assertDictionarySemantropy(50),
			result: generated(7),
		});
		expect(world.getCurrent()).not.toBeNull();
		world.invalidateDisplay();
		expect(world.getCurrent()).toBeNull();
		expect(world.getSeed()).toBe(7);
		expect(world.isCurrent(requestId)).toBe(false);
	});

	it("drops a stale commit after a newer request starts", () => {
		const world = new FakeDictionaryWorld();
		const first = world.beginRequest();
		const second = world.beginRequest();
		world.ensureSeed(() => 1);
		expect(
			world.commit(first, {
				headword: HEADWORD,
				pool: POOL,
				snapshot: { sourcePath: "n.md", contentHash: "ab".repeat(32) },
				vocabulary: collectVocabulary(["n.md"]),
				dictionarySeed: 1,
				dictionarySemantropy: assertDictionarySemantropy(50),
				result: generated(1),
			}),
		).toBe(false);
		expect(
			world.commit(second, {
				headword: HEADWORD,
				pool: POOL,
				snapshot: { sourcePath: "n.md", contentHash: "ab".repeat(32) },
				vocabulary: collectVocabulary(["n.md"]),
				dictionarySeed: 1,
				dictionarySemantropy: assertDictionarySemantropy(50),
				result: generated(1),
			}),
		).toBe(true);
		expect(world.getCurrent()?.requestId).toBe(second);
	});

	it("forgets the Seed on dispose and refuses later commits", () => {
		const world = new FakeDictionaryWorld();
		const requestId = world.beginRequest();
		world.ensureSeed(() => 3);
		world.dispose();
		expect(world.getSeed()).toBeNull();
		expect(world.isCurrent(requestId)).toBe(false);
		expect(
			world.commit(requestId, {
				headword: HEADWORD,
				pool: POOL,
				snapshot: { sourcePath: "n.md", contentHash: "cd".repeat(32) },
				vocabulary: collectVocabulary(["n.md"]),
				dictionarySeed: 3,
				dictionarySemantropy: assertDictionarySemantropy(50),
				result: generated(3),
			}),
		).toBe(false);
	});
});
