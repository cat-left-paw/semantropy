import { describe, expect, it } from "vitest";
import {
	toFakeDefinitionViewModel,
	type FakeDefinitionViewModel,
} from "../src/view/fakeDefinitionViewModel";
import {
	DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE,
	DEFINE_LOADING_MESSAGE,
	DEFINE_OFF_MESSAGE,
} from "../src/application/fakeDictionaryMessages";
import type { FakeDictionaryCurrent } from "../src/application/fakeDictionaryWorld";
import { collectVocabulary } from "./collectFixtures";
import { validateHeadword } from "../src/dictionary/headword";
import { buildDictionaryVocabularyPool } from "../src/dictionary/vocabularyPool";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { token } from "./tokenFixtures";

const CAT = token({ surface: "猫" });
const HEADWORD = (() => {
	const result = validateHeadword("猫", [CAT]);
	if (result.outcome !== "accepted") {
		throw new Error("fixture");
	}
	return result.headword;
})();
const POOL = buildDictionaryVocabularyPool([[CAT]]);

function current(
	result: FakeDictionaryCurrent["result"],
	semantropy = 50,
): FakeDictionaryCurrent {
	return {
		requestId: 1,
		headword: HEADWORD,
		pool: POOL,
		snapshot: { sourcePath: "n.md", contentHash: "ab".repeat(32) },
		vocabulary: collectVocabulary(["n.md"]),
		dictionarySeed: 3,
		dictionarySemantropy: assertDictionarySemantropy(semantropy),
		result,
	};
}

function expectNoDisplayedSeed(model: FakeDefinitionViewModel): void {
	expect(model).not.toHaveProperty("dictionarySeed");
	expect(JSON.stringify(model)).not.toMatch(/"dictionarySeed"|seed:/i);
}

describe("toFakeDefinitionViewModel", () => {
	it("shows Off as a dedicated state with the selector enabled", () => {
		const model = toFakeDefinitionViewModel({
			current: current({ outcome: "off" }, 0),
			dictionarySemantropy: assertDictionarySemantropy(0),
			pendingRequestId: 1,
			isPendingCurrent: true,
			errorMessage: null,
			busy: false,
			levelError: null,
		});
		expect(model.status).toBe("off");
		expect(model.message).toBe(DEFINE_OFF_MESSAGE);
		expect(model.definition).toBeNull();
		expect(model.reshuffleEnabled).toBe(false);
		expect(model.levelControlEnabled).toBe(true);
		expect(model.headword).toBe("猫");
		expectNoDisplayedSeed(model);
	});

	it("shows insufficient vocabulary as a dedicated non-error state", () => {
		const model = toFakeDefinitionViewModel({
			current: current({
				outcome: "insufficient-vocabulary",
				missingPlaceholders: ["place"],
			}),
			dictionarySemantropy: assertDictionarySemantropy(50),
			pendingRequestId: 1,
			isPendingCurrent: true,
			errorMessage: null,
			busy: false,
			levelError: null,
		});
		expect(model.status).toBe("insufficient");
		expect(model.message).toBe(DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE);
		expect(model.message).not.toContain("place");
		expect(model.reshuffleEnabled).toBe(false);
		expectNoDisplayedSeed(model);
	});

	it("shows loading while a newer request is in flight", () => {
		const model = toFakeDefinitionViewModel({
			current: current({ outcome: "off" }, 0),
			dictionarySemantropy: assertDictionarySemantropy(50),
			pendingRequestId: 2,
			isPendingCurrent: true,
			errorMessage: null,
			busy: false,
			levelError: null,
		});
		expect(model.status).toBe("loading");
		expect(model.message).toBe(DEFINE_LOADING_MESSAGE);
		expect(model.headword).toBeNull();
		expectNoDisplayedSeed(model);
	});

	it("shows a generated definition without a displayed Seed", () => {
		const model = toFakeDefinitionViewModel({
			current: current({
				outcome: "generated",
				definition: "幸福：通常三人以上では行わない移動方法。",
				templateId: "core-noun-1",
				family: "custom",
				optionalClauseIds: [],
				dictionarySeed: 3,
				dictionarySemantropy: 50,
				dictionaryBucket: "medium",
				algorithmVersion: 1,
				templateSetVersion: 1,
				definitionSeed: 1,
				headword: "猫",
				headwordIdentity: HEADWORD.identity,
			}),
			dictionarySemantropy: assertDictionarySemantropy(50),
			pendingRequestId: 1,
			isPendingCurrent: true,
			errorMessage: null,
			busy: false,
			levelError: null,
		});
		expect(model.status).toBe("ready");
		expect(model.definition).toBe("幸福：通常三人以上では行わない移動方法。");
		expect(model.reshuffleEnabled).toBe(true);
		expectNoDisplayedSeed(model);
	});

	it("shows an error without a displayed Seed", () => {
		const model = toFakeDefinitionViewModel({
			current: null,
			dictionarySemantropy: assertDictionarySemantropy(50),
			pendingRequestId: 1,
			isPendingCurrent: true,
			errorMessage: "Could not generate a definition.",
			busy: false,
			levelError: null,
		});
		expect(model.status).toBe("error");
		expect(model.message).toBe("Could not generate a definition.");
		expectNoDisplayedSeed(model);
	});
});
