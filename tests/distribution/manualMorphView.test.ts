// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";
import { installObsidianDomHelpers } from "../support/obsidianDom";
import { manualMorphHarness } from "../support/manualMorphHarness";
import { assertBodySemantropy } from "../../src/settings/bodySemantropy";
import { transformWithVocabularySnapshot } from "../../src/vocabulary/vocabularySnapshot";
let tokenize: Tokenize, restore: () => void;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

describe("MORPH2 five-field production dictionary + View", () => {
	it.each([
		["手紙を書いて。", "絵を描いて。", "書い", "描い"],
		["字を書いた。", "道を歩いた。", "書い", "歩い"],
		["海で泳いで。", "服を脱いで。", "泳い", "脱い"],
		["海で泳いだ。", "道を急いだ。", "泳い", "急い"],
		["彼を待って。", "荷物を持って。", "待っ", "持っ"],
		["酒を飲んだ。", "本を読んだ。", "飲ん", "読ん"],
		["子供が遊んで。", "鳥が飛んで。", "遊ん", "飛ん"],
		["字を書かない。", "絵を描かない。", "書か", "描か"],
		["字を書きます。", "絵を描きます。", "書き", "描き"],
		["字を書かせられなかった。", "絵を描かせる。", "書か", "描か"],
		["ご飯を食べない。", "服を着ない。", "食べ", "着"],
		["空が青い。", "海が赤い。", "青い", "赤い"],
		["空が青くて。", "海が赤くて。", "青く", "赤く"],
		["空が青くない。", "海が赤くない。", "青く", "赤く"],
		["空が青かった。", "海が赤かった。", "青かっ", "赤かっ"],
		["空が青ければ。", "海が赤ければ。", "青けれ", "赤けれ"],
		["花が美しい。", "服が新しい。", "美しい", "新しい"],
	])("uses only observed real forms: %s / %s", async (target, source, from, to) => {
		const h = manualMorphHarness({ tokenize: async text => tokenize(text) }); await h.open(target); expect(await h.apply([source])).toBe("applied");
		const slot = h.current(from); expect(slot).toBeDefined(); expect(slot.manualAvailable).toBe(true);
		expect(h.controller().shuffleManual(slot)).toBe("applied"); expect(h.current(from).displaySurface).toBe(to);
		expect(h.controller().getLogicalText()).toBe(target.replace(from, to)); expect(h.current(from).automaticSurface).toBe(from);
		expect(h.controller().restoreManual(h.current(from))).toBe("applied"); expect(h.controller().getLogicalText()).toBe(target);
		expect(h.controller().useAutomatic(h.current(from))).toBe("applied"); await h.view.onClose();
	});
	it("preserves automatic noun draws/counts on the strict half (level L = Body 10 at 2L) while morph slots stay manual-only", async () => {
		const h = manualMorphHarness({ tokenize: async text => tokenize(text) }); await h.open("猫と犬。字を書いて、絵を描いて。青い海と赤い花。\n".repeat(5));
		const snapshot = h.controller().getVocabularySnapshot()!, sequences = h.plan().runs.map(run => run.slots.map(slot => ({ tokenId: slot.tokenId, token: slot.originalToken })));
		// Nouns only (the default options): above 50 the relaxed profiles are MAX-CORE1's own, pinned in its suites.
		for (const level of [0, 12, 25, 37, 50]) {
			await h.view.setBodySemantropy(assertBodySemantropy(level));
			const expected = transformWithVocabularySnapshot({ tokenSequences: sequences, snapshot, bodySeed: 7, bodySemantropy: assertBodySemantropy(level * 2), algorithmVersion: 1 });
			expect(h.plan().runs.map(run => run.slots.map(slot => slot.automaticSurface))).toEqual(expected.tokenSurfaces);
			expect(h.plan().replacementCount).toBe(expected.replacementCount); expect(h.plan().replaceableSlotCount).toBe(expected.replaceableSlotCount);
			expect(h.plan().slots.filter(slot => slot.manualClass === "verb" || slot.manualClass === "i-adjective").every(slot => !slot.automaticReplaced && !slot.automaticReplaceable)).toBe(true);
		}
	});
});
