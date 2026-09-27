import { describe, expect, it } from "vitest";
import { fakeDictionaryFragmentFromCurrent } from "../src/application/fakeDictionaryFragmentFromReady";
import { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import { generateFakeDefinition } from "../src/dictionary/generateFakeDefinition";
import { validateHeadword } from "../src/dictionary/headword";
import { buildDictionaryVocabularyPool } from "../src/dictionary/vocabularyPool";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { token } from "./tokenFixtures";
import { collectPath, collectVocabulary } from "./collectFixtures";

const NOTE = "秘密の本文";
const CAT = token({ surface: "猫" });
const POOL = buildDictionaryVocabularyPool([[CAT, token({ surface: "机" })]]);
const HEADWORD = (() => {
	const result = validateHeadword("猫", [CAT]);
	if (result.outcome !== "accepted") {
		throw new Error("fixture");
	}
	return result.headword;
})();
const HASH = "ab".repeat(32);
const GENERATED_VOCABULARY = collectVocabulary(["folder/桜桃.md"], {
	sources: [collectPath("folder/桜桃.md", HASH)],
	drawMode: "frequency",
});
const LATER_VOCABULARY = collectVocabulary(["later.md"]);

describe("fakeDictionaryFragmentFromCurrent", () => {
	it("copies dictionary metadata only, never generation state or the note", () => {
		const world = new FakeDictionaryWorld();
		const requestId = world.beginRequest();
		world.ensureSeed(() => 4294967295);
		const result = generateFakeDefinition({
			headword: HEADWORD,
			pool: POOL,
			dictionarySeed: 4294967295,
			dictionarySemantropy: 75,
		});
		if (result.outcome !== "generated") {
			throw new Error(`expected generated, got ${result.outcome}`);
		}
		world.commit(requestId, {
			headword: HEADWORD,
			pool: POOL,
			snapshot: {
				sourcePath: "folder/桜桃.md",
				contentHash: HASH,
			},
			vocabulary: GENERATED_VOCABULARY,
			dictionarySeed: 4294967295,
			dictionarySemantropy: assertDictionarySemantropy(75),
			result,
		});
		const current = world.getCurrent();
		if (!current) {
			throw new Error("expected current");
		}
		const input = fakeDictionaryFragmentFromCurrent(current);
		// EXPERIENCE-DICTIONARY-OUTPUT1: the displayed headword, one LF, the definition.
		expect(input).toEqual({
			type: "fake-dictionary",
			text: `${HEADWORD.surface}
${result.definition}`,
			target: { path: "folder/桜桃.md", contentHash: HASH },
			vocabulary: GENERATED_VOCABULARY,
			dictionarySemantropy: 75,
			algorithmVersion: result.algorithmVersion,
			templateId: result.templateId,
			templateSetVersion: result.templateSetVersion,
		});
		expect(input).not.toHaveProperty("bodySeed");
		expect(input).not.toHaveProperty("dictionarySeed");
		expect(input).not.toHaveProperty("seed");
		expect(input).not.toHaveProperty("bodySemantropy");
		expect(input).not.toHaveProperty("pool");
		expect(input).not.toHaveProperty("tokenSequences");
		expect(JSON.stringify(input)).not.toContain(NOTE);
		expect(JSON.stringify(input)).not.toContain("/Users/");
		expect(input?.vocabulary).not.toEqual(LATER_VOCABULARY);
	});

	it("refuses Off and insufficient results", () => {
		const world = new FakeDictionaryWorld();
		const requestId = world.beginRequest();
		world.commit(requestId, {
			headword: HEADWORD,
			pool: POOL,
			snapshot: { sourcePath: "n.md", contentHash: HASH },
			vocabulary: collectVocabulary(["n.md"]),
			dictionarySeed: 1,
			dictionarySemantropy: assertDictionarySemantropy(0),
			result: { outcome: "off" },
		});
		expect(
			fakeDictionaryFragmentFromCurrent(world.getCurrent()!),
		).toBeNull();
	});
});
