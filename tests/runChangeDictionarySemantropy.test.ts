import { describe, expect, it } from "vitest";
import { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import { runChangeDictionarySemantropy } from "../src/application/runChangeDictionarySemantropy";
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

function commitGenerated(world: FakeDictionaryWorld) {
	const requestId = world.beginRequest();
	world.ensureSeed(() => 4);
	const result = generateFakeDefinition({
		headword: HEADWORD,
		pool: POOL,
		dictionarySeed: 4,
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
		dictionarySeed: 4,
		dictionarySemantropy: assertDictionarySemantropy(50),
		result,
	});
	return result;
}

describe("runChangeDictionarySemantropy", () => {
	it("prepares, persists, then commits the new definition", async () => {
		const world = new FakeDictionaryWorld();
		const first = commitGenerated(world);
		let persisted: number | null = null;
		const outcome = await runChangeDictionarySemantropy({
			world,
			next: assertDictionarySemantropy(75),
			persist: async (value) => {
				persisted = value;
				return true;
			},
			isAbandoned: () => false,
			modalOpen: true,
		});
		expect(outcome).toBe("applied");
		expect(persisted).toBe(75);
		const current = world.getCurrent();
		expect(current?.dictionarySemantropy).toBe(75);
		expect(current?.dictionarySeed).toBe(4);
		if (current?.result.outcome !== "generated") {
			throw new Error("expected generated");
		}
		expect(current.result.definition).not.toBe(first.definition);
		expect(
			generateFakeDefinition({
				headword: HEADWORD,
				pool: POOL,
				dictionarySeed: 4,
				dictionarySemantropy: 75,
			}),
		).toEqual(current.result);
	});

	it("does not change the display when persist fails", async () => {
		const world = new FakeDictionaryWorld();
		const first = commitGenerated(world);
		const outcome = await runChangeDictionarySemantropy({
			world,
			next: assertDictionarySemantropy(100),
			persist: async () => false,
			isAbandoned: () => false,
			modalOpen: true,
		});
		expect(outcome).toBe("failed");
		expect(world.getCurrent()?.dictionarySemantropy).toBe(50);
		expect(world.getCurrent()?.result).toEqual(first);
		expect(world.getSeed()).toBe(4);
	});

	it("does not apply a finished persist to a newer definition", async () => {
		const world = new FakeDictionaryWorld();
		commitGenerated(world);
		let finishPersist!: (ok: boolean) => void;
		const persist = new Promise<boolean>((resolve) => {
			finishPersist = resolve;
		});
		const pending = runChangeDictionarySemantropy({
			world,
			next: assertDictionarySemantropy(25),
			persist: async () => persist,
			isAbandoned: () => false,
			modalOpen: true,
		});
		world.beginRequest();
		finishPersist(true);
		expect(await pending).toBe("aborted");
		expect(world.getCurrent()?.dictionarySemantropy).toBe(50);
	});
});
