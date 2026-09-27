// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";
import { installObsidianDomHelpers } from "../support/obsidianDom";
import { manualMorphHarness } from "../support/manualMorphHarness";
import { MANUAL_DIAGNOSTIC_MESSAGES, toManualDiagnosticView } from "../../src/view/manualDiagnosticModel";

let tokenize: Tokenize, restore: () => void;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

const open = async (target: string, sources: readonly string[]) => {
	const h = manualMorphHarness({ tokenize: async text => tokenize(text) });
	await h.open(target);
	expect(await h.apply([...sources])).toBe("applied");
	return h;
};

describe("DIAGNOSTICS1 against the production five-field dictionary", () => {
	it("counts the distinct alternative surfaces a real adjective slot offers", async () => {
		const h = await open("空が青い。", ["海が赤い。花が美しい。空が青い。"]);
		const slot = h.current("青い");
		expect(slot.originalToken).toMatchObject({ pos: "形容詞", detail1: "自立", conjugationForm: "基本形", isUnknown: false });
		// 青い is observed in the Source too, and is excluded as the displayed form.
		expect(slot.manualDiagnostic).toEqual({
			status: "available", slotClass: "i-adjective", reason: null, alternativeSurfaceCount: 2, overridden: false,
		});
		expect(toManualDiagnosticView(slot.manualDiagnostic)).toEqual({
			message: "Manual Shuffle: 2 alternatives in the active Vocabulary.", available: true,
		});
		await h.view.onClose();
	});

	it("separates an empty compatible set from one holding only the displayed form", async () => {
		const none = await open("空が青い。", ["猫と犬と鳥。"]);
		expect(none.current("青い").manualDiagnostic).toMatchObject({ status: "unavailable", reason: "no-candidate" });
		await none.view.onClose();

		const same = await open("空が青い。", ["海も青い。"]);
		expect(same.current("青い").manualDiagnostic).toMatchObject({
			status: "unavailable", slotClass: "i-adjective", reason: "only-current-surface", alternativeSurfaceCount: 0,
		});
		expect(toManualDiagnosticView(same.current("青い").manualDiagnostic)?.message)
			.toBe(MANUAL_DIAGNOSTIC_MESSAGES["only-current-surface"]);
		await same.view.onClose();
	});

	it.each([
		["an irregular adjective", "天気がいい。", "いい", "unsupported-conjugation-type"],
		["an imperative verb form", "早く書け。", "書け", "unsupported-conjugation-form"],
		["a dependent verb", "字を書いている。", "いる", "unsupported-part-of-speech"],
		["a noun suffix", "子供たちと。", "たち", "unsupported-part-of-speech"],
	])("states %s as %s", async (_name, target, surface, reason) => {
		const h = await open(target, ["海が赤い。絵を描いて。"]);
		const slot = h.current(surface);
		expect(slot).toBeDefined();
		expect(slot.manualDiagnostic).toMatchObject({ status: "unavailable", reason, alternativeSurfaceCount: 0 });
		expect(slot.manualAvailable).toBe(false);
		expect(toManualDiagnosticView(slot.manualDiagnostic)?.available).toBe(false);
		await h.view.onClose();
	});

	it("keeps every automatic noun result and the Manual entry conditions unchanged", async () => {
		const h = await open("猫と犬。空が青い。", ["海が赤い。病院と鳥。"]);
		const before = h.plan().slots.map(slot => [slot.displaySurface, slot.manualEligible, slot.manualAvailable] as const);
		// Reading the diagnostic of every materialized slot changes nothing.
		const summary = h.plan().slots.map(slot => toManualDiagnosticView(slot.manualDiagnostic));
		expect(summary.every(view => view !== null)).toBe(true);
		expect(h.plan().slots.map(slot => [slot.displaySurface, slot.manualEligible, slot.manualAvailable] as const)).toEqual(before);
		// Availability and the sentence are one decision, never two.
		for (const slot of h.plan().slots) {
			expect(toManualDiagnosticView(slot.manualDiagnostic)!.available).toBe(slot.manualAvailable);
		}
		expect(h.calls.copy).toEqual([]);
		expect(h.calls.collect).toEqual([]);
		await h.view.onClose();
	});
});
