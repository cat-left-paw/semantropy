// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, morphToken, suffix, peekMorph } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import type { SemantropyView } from "../src/view/SemantropyView";
import type { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import type { DisplaySlot, ManualDiagnosticReason, ManualSlotDiagnostic } from "../src/analysis/displaySlots";
import { alternativeSurfaceCount } from "../src/analysis/displaySlots";
import {
	MANUAL_DIAGNOSTIC_MESSAGES,
	MANUAL_DIAGNOSTIC_UNKNOWN_REASON_MESSAGE,
	manualDiagnosticAlternativesMessage,
	toManualDiagnosticView,
} from "../src/view/manualDiagnosticModel";
import { assertDiagnosticReason } from "../src/analysis/manualDisplay";
import type { ManualMorphRejection } from "../src/transform/manualMorphology";

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

type Harness = ReturnType<typeof manualMorphHarness>;

/** Every reason the Manual Morph core can report, as the policy documents them. */
const ALL_REASONS: readonly ManualMorphRejection[] = [
	"unknown-token", "unsupported-part-of-speech", "missing-field",
	"unsupported-conjugation-type", "unsupported-conjugation-form",
	"unsupported-connection", "no-candidate", "only-current-surface", "invalid-evidence",
];

type Binding = { node: Text; presentation: { tokenId?: string }; logicalRange: unknown; nodeRange?: { start: number; end: number } };
const bindingsOf = (controller: ChunkTargetBodyController): readonly Binding[] =>
	(Reflect.get(controller, "bindings") as () => readonly Binding[]).call(controller);

/** A DOM Range covering exactly one slot's displayed characters, readings excluded. */
function slotRange(controller: ChunkTargetBodyController, slot: DisplaySlot): Range {
	const own = bindingsOf(controller).filter(b => b.logicalRange && b.presentation?.tokenId === slot.tokenId);
	if (own.length === 0) throw new Error("no binding for slot");
	const first = own[0]!, last = own.at(-1)!;
	const range = document.createRange();
	range.setStart(first.node, first.nodeRange?.start ?? 0);
	range.setEnd(last.node, last.nodeRange?.end ?? last.node.length);
	return range;
}

/** Makes the reader's own selection through the real document Selection. */
function select(range: Range | null): void {
	const selection = document.getSelection()!;
	selection.removeAllRanges();
	if (range) selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
}

const selectSlot = (h: Harness, slot: DisplaySlot) => select(slotRange(h.controller(), slot));
const shell = (view: SemantropyView) => peekMorph(view).contentEl;
const diagnosticEl = (view: SemantropyView) => shell(view).querySelector<HTMLElement>(".semantropy-manual-diagnostic")!;
const shown = (view: SemantropyView): string | null => {
	const element = diagnosticEl(view);
	return element.hidden ? null : element.textContent;
};
const control = (view: SemantropyView, name: string) =>
	shell(view).querySelector<HTMLButtonElement>(`.semantropy-manual-${name}`)!;
const buttonState = (view: SemantropyView) => ({
	shuffle: !control(view, "shuffle-selected").disabled,
	restore: !control(view, "restore-selected").disabled,
	automatic: !control(view, "automatic-selected").disabled,
	clear: !control(view, "clear").disabled,
});

const adjectives = () => lexiconTokenizer([
	morphToken("暑い", "形容詞・アウオ段", "基本形", "形容詞"),
	morphToken("高い", "形容詞・アウオ段", "基本形", "形容詞"),
	morphToken("美しい", "形容詞・イ段", "基本形", "形容詞"),
	morphToken("赤い", "形容詞・アウオ段", "基本形", "形容詞"),
	suffix("か", "助詞", "副助詞"), suffix("も", "助詞", "係助詞"),
	token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "鳥" }),
]);

describe("DIAGNOSTICS1 pure reason mapping", () => {
	it("gives every core rejection one distinct fixed sentence", () => {
		const messages = ALL_REASONS.map(reason => MANUAL_DIAGNOSTIC_MESSAGES[assertDiagnosticReason(reason)]);
		const adverbReasons: ManualDiagnosticReason[] = ["unsupported-adverb-class", "missing-surface", "no-head", "unsupported-head",
			"polarity-undetermined", "scan-limit-reached", "boundary-crossed", "no-observation", "candidate-identity-mismatch",
			"head-class-mismatch", "polarity-mismatch", "bridge-not-capable", "duplicate-to-bridge", "invalid-input", "invalid-vocabulary",
			"invalid-authority", "invalid-candidate", "invalid-slot", "invalid-evaluation", "invalid-ticket", "released", "busy", "revision-overflow"];
		expect(new Set(Object.keys(MANUAL_DIAGNOSTIC_MESSAGES))).toEqual(new Set([...ALL_REASONS, ...adverbReasons]));
		expect(adverbReasons.every(reason => MANUAL_DIAGNOSTIC_MESSAGES[reason].startsWith("Manual Shuffle"))).toBe(true);
		expect(messages.every(message => typeof message === "string" && message.length > 0)).toBe(true);
		expect(new Set(messages).size).toBe(ALL_REASONS.length);
		expect(MANUAL_DIAGNOSTIC_MESSAGES["no-candidate"]).toBe(
			"Manual Shuffle is unavailable: no compatible alternative was found in the active Vocabulary.");
		expect(MANUAL_DIAGNOSTIC_MESSAGES["only-current-surface"]).toBe(
			"Manual Shuffle is unavailable: the active Vocabulary contains only the currently displayed form.");
		expect(MANUAL_DIAGNOSTIC_MESSAGES["unsupported-part-of-speech"]).toBe(
			"Manual Shuffle is unavailable: this part of speech is not supported.");
		expect(MANUAL_DIAGNOSTIC_MESSAGES["unsupported-conjugation-type"]).toBe(
			"Manual Shuffle is unavailable: this conjugation type is not supported.");
		expect(MANUAL_DIAGNOSTIC_MESSAGES["unsupported-conjugation-form"]).toBe(
			"Manual Shuffle is unavailable: this word form is not supported.");
		expect(MANUAL_DIAGNOSTIC_MESSAGES["unsupported-connection"]).toBe(
			"Manual Shuffle is unavailable: this grammatical connection is not supported.");
		expect(MANUAL_DIAGNOSTIC_MESSAGES["missing-field"]).toBe(
			"Manual Shuffle is unavailable: the morphological information is incomplete.");
		expect(MANUAL_DIAGNOSTIC_MESSAGES["unknown-token"]).toBe(
			"Manual Shuffle is unavailable: this token could not be classified reliably.");
		expect(MANUAL_DIAGNOSTIC_MESSAGES["invalid-evidence"]).toBe(
			"Manual Shuffle diagnostics are unavailable. Refresh the Vocabulary and try again.");
	});

	it("never reports an unknown or missing reason as available", () => {
		for (const reason of [null, "future-reason", "", "available"]) {
			const view = toManualDiagnosticView({
				status: "unavailable", slotClass: "unsupported",
				reason: reason as ManualDiagnosticReason | null,
				alternativeSurfaceCount: 0, overridden: false,
			});
			expect(view).toEqual({ message: MANUAL_DIAGNOSTIC_UNKNOWN_REASON_MESSAGE, available: false });
		}
		// A status that claims availability without an alternative is still unavailable.
		expect(toManualDiagnosticView({
			status: "available", slotClass: "noun", reason: null, alternativeSurfaceCount: 0, overridden: false,
		})).toEqual({ message: MANUAL_DIAGNOSTIC_UNKNOWN_REASON_MESSAGE, available: false });
		expect(toManualDiagnosticView(null)).toBeNull();
	});

	it("keeps paths, note text, surfaces, readings and exception messages out of every sentence", () => {
		const all = [
			...Object.values(MANUAL_DIAGNOSTIC_MESSAGES),
			manualDiagnosticAlternativesMessage(1),
			manualDiagnosticAlternativesMessage(4),
		];
		for (const message of all) {
			// Plain printable ASCII only: no note text, no reading, no separator byte.
			expect(message).toMatch(/^[A-Za-z0-9 .,:;'"()-]+$/u);
			expect(message).not.toMatch(/\.md|\/|Error|undefined|connectionKey|candidateCompatibilityKey/u);
			expect(message).not.toMatch(/[぀-ヿ一-鿿]/u);
		}
	});

	it("counts distinct alternative surfaces, not records or frequency totals", () => {
		const records = [
			{ surface: "高い", frequency: 9 }, { surface: "高い", frequency: 4 },
			{ surface: "赤い", frequency: 1 }, { surface: "暑い", frequency: 7 },
		];
		expect(alternativeSurfaceCount(records, "暑い")).toBe(2);
		expect(alternativeSurfaceCount(records, "高い")).toBe(2);
		expect(alternativeSurfaceCount([{ surface: "暑い" }, { surface: "暑い" }], "暑い")).toBe(0);
		expect(alternativeSurfaceCount([], "暑い")).toBe(0);
		expect(toManualDiagnosticView({
			status: "available", slotClass: "i-adjective", reason: null, alternativeSurfaceCount: 3, overridden: false,
		})).toEqual({ message: "Manual Shuffle: 3 alternatives in the active Vocabulary.", available: true });
		expect(manualDiagnosticAlternativesMessage(1)).toBe("Manual Shuffle: 1 alternative in the active Vocabulary.");
	});
});

describe("DIAGNOSTICS1 slot diagnostics follow the core, not the surface", () => {
	const reasonOf = (h: Harness, surface: string): ManualSlotDiagnostic => h.current(surface).manualDiagnostic;

	it("reports an available adjective with its distinct alternative count", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。");
		expect(await h.apply(["高い猫。美しい犬。赤い鳥。高い犬。"])).toBe("applied");
		expect(reasonOf(h, "暑い")).toEqual({
			status: "available", slotClass: "i-adjective", reason: null, alternativeSurfaceCount: 3, overridden: false,
		});
		await h.view.onClose();
	});

	it.each([
		["a following adverbial particle", "暑いかも。"],
		["a basic form at a run end", "暑い"],
	])("keeps a basic-form adjective available with %s", async (_name, text) => {
		const h = manualMorphHarness(adjectives());
		await h.open(text);
		expect(await h.apply(["高い猫。美しい犬。赤い鳥。"])).toBe("applied");
		const diagnostic = reasonOf(h, "暑い");
		expect(diagnostic.status).toBe("available");
		expect(diagnostic.reason).toBeNull();
		expect(diagnostic.alternativeSurfaceCount).toBe(3);
		await h.view.onClose();
	});

	it("reports an available verb and an available noun", async () => {
		const h = manualMorphHarness(lexiconTokenizer([
			morphToken("書い"), morphToken("描い"), morphToken("歩い"), suffix("て"),
			token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "鳥" }),
		]));
		await h.open("書いて猫。");
		expect(await h.apply(["描いて犬。歩いて鳥。"])).toBe("applied");
		expect(reasonOf(h, "書い")).toMatchObject({ status: "available", slotClass: "verb", reason: null, alternativeSurfaceCount: 2 });
		expect(reasonOf(h, "猫")).toMatchObject({ status: "available", slotClass: "noun", reason: null });
		expect(reasonOf(h, "猫").alternativeSurfaceCount).toBeGreaterThan(0);
		await h.view.onClose();
	});

	it("separates an empty compatible set from one holding only the displayed form", async () => {
		const withoutAdjectives = manualMorphHarness(adjectives());
		await withoutAdjectives.open("暑い。");
		expect(await withoutAdjectives.apply(["猫犬鳥。"])).toBe("applied");
		expect(reasonOf(withoutAdjectives, "暑い")).toMatchObject({
			status: "unavailable", reason: "no-candidate", alternativeSurfaceCount: 0,
		});
		await withoutAdjectives.view.onClose();

		const sameOnly = manualMorphHarness(adjectives());
		await sameOnly.open("暑い。");
		expect(await sameOnly.apply(["暑い猫。暑い犬。"])).toBe("applied");
		expect(reasonOf(sameOnly, "暑い")).toMatchObject({
			status: "unavailable", slotClass: "i-adjective", reason: "only-current-surface", alternativeSurfaceCount: 0,
		});
		await sameOnly.view.onClose();
	});

	it.each([
		["an irregular adjective type", { conjugationType: "形容詞・イイ" }, "unsupported-conjugation-type"],
		["an unsupported verb form", { conjugationForm: "命令ｅ" }, "unsupported-conjugation-form"],
		["a dependent word", { detail1: "非自立" }, "unsupported-part-of-speech"],
		["a suffix", { pos: "名詞", detail1: "接尾" }, "unsupported-part-of-speech"],
		["a missing conjugation field", { conjugationType: "*" }, "missing-field"],
		["a missing base form", { baseForm: "*" }, "missing-field"],
		["an unknown token", { isUnknown: true }, "unknown-token"],
	] as const)("states %s as %s", async (_name, bad, reason) => {
		const original = { ...morphToken("書い"), ...bad };
		const h = manualMorphHarness(lexiconTokenizer([original, morphToken("描い"), suffix("て")]));
		await h.open("書いて。");
		expect(await h.apply(["描いて。"])).toBe("applied");
		expect(reasonOf(h, "書い")).toMatchObject({ status: "unavailable", reason, alternativeSurfaceCount: 0 });
		await h.view.onClose();
	});

	it("states an unsupported verb connection without blaming an adjective's follower", async () => {
		// 連用タ接続 allows て / で / た / だ, never a following noun.
		const verbs = manualMorphHarness(lexiconTokenizer([morphToken("書い"), morphToken("描い"), suffix("て"), token({ surface: "猫" })]));
		await verbs.open("書い猫。");
		expect(await verbs.apply(["描いて。"])).toBe("applied");
		expect(reasonOf(verbs, "書い")).toMatchObject({ status: "unavailable", reason: "unsupported-connection" });
		await verbs.view.onClose();

		// A basic-form adjective needs no follower at all under manual-morph-2,
		// so its follower can never become the stated reason.
		const adjective = manualMorphHarness(adjectives());
		await adjective.open("暑いかも。");
		expect(await adjective.apply(["猫犬鳥。"])).toBe("applied");
		expect(reasonOf(adjective, "暑い").reason).toBe("no-candidate");
		await adjective.view.onClose();
	});

	it("does not re-derive a reason in the presentation layer", async () => {
		const model = await readFile("src/view/manualDiagnosticModel.ts", "utf8");
		expect(model).not.toMatch(/conjugation(Type|Form)|detail1|baseForm|isUnknown/u);
		const toolbar = await readFile("src/view/SemantropyToolbar.ts", "utf8");
		expect(toolbar).not.toMatch(/unsupported-part-of-speech|no-candidate|only-current-surface/u);
	});
});

describe("DIAGNOSTICS1 exact-selection contract", () => {
	async function opened(text = "暑い。猫と犬。", sources = ["高い猫。美しい犬。赤い鳥。"]) {
		const h = manualMorphHarness(adjectives());
		await h.open(text);
		expect(await h.apply(sources)).toBe("applied");
		return h;
	}

	it("shows the sentence only for an exact one-token selection", async () => {
		const h = await opened();
		expect(shown(h.view)).toBeNull();

		selectSlot(h, h.current("暑い"));
		expect(shown(h.view)).toBe("Manual Shuffle: 3 alternatives in the active Vocabulary.");
		expect(diagnosticEl(h.view).dataset["manual"]).toBe("available");

		// Part of a token.
		const partial = slotRange(h.controller(), h.current("暑い"));
		partial.setEnd(partial.startContainer, partial.startOffset + 1);
		select(partial);
		expect(shown(h.view)).toBeNull();

		// Two tokens.
		const multi = slotRange(h.controller(), h.current("暑い"));
		const second = slotRange(h.controller(), h.current("猫"));
		multi.setEnd(second.endContainer, second.endOffset);
		select(multi);
		expect(shown(h.view)).toBeNull();

		// A caret, and no selection at all.
		const caret = slotRange(h.controller(), h.current("暑い"));
		caret.collapse(true);
		select(caret);
		expect(shown(h.view)).toBeNull();
		select(null);
		expect(shown(h.view)).toBeNull();
		await h.view.onClose();
	});

	it("reads a whole Ruby base and ignores a reading-only selection", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("｜暑い《あつい》猫。");
		expect(await h.apply(["高い猫。美しい犬。"])).toBe("applied");
		selectSlot(h, h.current("暑い"));
		expect(shown(h.view)).toMatch(/^Manual Shuffle: \d alternatives? in the active Vocabulary\.$/u);

		const reading = h.root().querySelector("rt")!;
		const readingRange = document.createRange();
		readingRange.selectNodeContents(reading);
		select(readingRange);
		expect(shown(h.view)).toBeNull();
		await h.view.onClose();
	});

	it("keeps two views' selections and diagnostics apart", async () => {
		const first = await opened();
		const second = await opened();
		selectSlot(first, first.current("暑い"));
		expect(shown(first.view)).not.toBeNull();
		expect(shown(second.view)).toBeNull();
		await first.view.onClose();
		await second.view.onClose();
	});

	it("releases the old view when the reader picks a word in another Semantropy body", async () => {
		const first = await opened();
		const second = await opened();
		selectSlot(first, first.current("暑い"));
		expect(shown(first.view)).not.toBeNull();
		expect(buttonState(first.view).shuffle).toBe(true);

		// One document has one selection: picking in the second body takes the
		// first view's highlight off the screen, so it must not keep offering
		// "selected word" actions for a word nobody can see selected there.
		selectSlot(second, second.current("暑い"));

		expect(shown(second.view)).not.toBeNull();
		expect(buttonState(second.view).shuffle).toBe(true);
		expect(shown(first.view)).toBeNull();
		expect(buttonState(first.view)).toEqual({ shuffle: false, restore: false, automatic: false, clear: false });
		expect(Reflect.get(first.view, "selection")).toBeNull();
		await first.view.onClose();
		await second.view.onClose();
	});

	it("keeps the recorded pick when a Toolbar control only takes focus", async () => {
		const h = await opened();
		selectSlot(h, h.current("暑い"));
		const message = shown(h.view);
		expect(message).not.toBeNull();

		// Reaching for a control replaces no selection: the browser drops or
		// collapses the highlight and focus moves. That is what the recorded
		// logical pick exists for.
		select(null);
		control(h.view, "shuffle-selected").focus();
		expect(shown(h.view)).toBe(message);
		expect(buttonState(h.view).shuffle).toBe(true);

		const caret = document.createRange();
		caret.selectNodeContents(shell(h.view).querySelector<HTMLElement>(".semantropy-status")!);
		caret.collapse(true);
		select(caret);
		expect(shown(h.view)).toBe(message);
		expect(buttonState(h.view).shuffle).toBe(true);
		await h.view.onClose();
	});

	it("releases it when the reader selects text in this view's own chrome", async () => {
		// EXPERIENCE-CONTROLS1 removed the large title; a category label is chrome text of the same kind.
		for (const selector of [".semantropy-toolbar .semantropy-display-label", ".semantropy-status", ".semantropy-toolbar-group-label"]) {
			const h = await opened();
			selectSlot(h, h.current("暑い"));
			expect(shown(h.view)).not.toBeNull();

			// A real, non-collapsed pick outside the body takes the body's
			// highlight off the screen. Manual must not keep acting on a word
			// nobody can see selected.
			const range = document.createRange();
			range.selectNodeContents(shell(h.view).querySelector<HTMLElement>(selector)!);
			select(range);

			expect(shown(h.view)).toBeNull();
			expect(buttonState(h.view)).toEqual({ shuffle: false, restore: false, automatic: false, clear: false });
			// TOOLBAR1's fragment contract is untouched: the recorded pick still
			// serves Copy, which is read-only and not scoped to one word.
			expect(Reflect.get(h.view, "selection")).not.toBeNull();
			expect(await h.view.copySelectedFragment()).toBe("copied");
			expect(h.calls.copy).toEqual(["暑い"]);
			await h.view.onClose();
		}
	});

	it("drops the diagnostic when the display revision moves on", async () => {
		const h = await opened();
		selectSlot(h, h.current("暑い"));
		expect(shown(h.view)).not.toBeNull();
		select(null);
		expect(shown(h.view)).not.toBeNull();
		expect(await h.view.setBodySemantropy(assertBodySemantropy(100))).toBe("applied");
		expect(shown(h.view)).toBeNull();
		await h.view.onClose();
	});

	it("builds no extra slot or diagnostic for an unloaded Chunk", async () => {
		const h = manualMorphHarness(adjectives(), 6);
		await h.open("暑い。\n\n高い。\n\n美しい。\n\n赤い。\n");
		expect(await h.apply(["高い猫。美しい犬。赤い鳥。"])).toBe("applied");
		const stats = h.controller().getChunkStats();
		expect(stats.chunks).toBeLessThan(stats.totalChunks);
		const loaded = h.plan().slots.length;
		selectSlot(h, h.current("暑い"));
		expect(shown(h.view)).not.toBeNull();
		expect(h.plan().slots).toHaveLength(loaded);
		expect(h.controller().getChunkStats().chunks).toBe(stats.chunks);
		await h.view.onClose();
	});
});

describe("DIAGNOSTICS1 button state agrees with the sentence", () => {
	it("enables Shuffle only when the Vocabulary offers another surface", async () => {
		const available = manualMorphHarness(adjectives());
		await available.open("暑い。");
		expect(await available.apply(["高い猫。"])).toBe("applied");
		selectSlot(available, available.current("暑い"));
		expect(shown(available.view)).toBe("Manual Shuffle: 1 alternative in the active Vocabulary.");
		expect(buttonState(available.view)).toEqual({ shuffle: true, restore: true, automatic: false, clear: false });
		await available.view.onClose();

		const sameOnly = manualMorphHarness(adjectives());
		await sameOnly.open("暑い。");
		expect(await sameOnly.apply(["暑い猫。"])).toBe("applied");
		selectSlot(sameOnly, sameOnly.current("暑い"));
		expect(shown(sameOnly.view)).toBe(MANUAL_DIAGNOSTIC_MESSAGES["only-current-surface"]);
		expect(buttonState(sameOnly.view).shuffle).toBe(false);
		await sameOnly.view.onClose();
	});

	it("keeps Shuffle disabled for a noun whose pool holds only the displayed surface", async () => {
		const h = manualMorphHarness(lexiconTokenizer([token({ surface: "猫" }), token({ surface: "犬" })]));
		await h.open("猫。");
		expect(await h.apply(["猫。"])).toBe("applied");
		const slot = h.current("猫");
		// Eligibility alone used to enable this control; an empty alternative set
		// must disable it and say why.
		expect(slot.manualEligible).toBe(true);
		expect(slot.manualDiagnostic).toMatchObject({ status: "unavailable", slotClass: "noun", reason: "only-current-surface" });
		selectSlot(h, slot);
		expect(shown(h.view)).toBe(MANUAL_DIAGNOSTIC_MESSAGES["only-current-surface"]);
		expect(buttonState(h.view).shuffle).toBe(false);
		expect(h.controller().shuffleManual(h.current("猫"))).toBe("unavailable");
		await h.view.onClose();
	});

	it("moves Use automatic and Clear with the override, and never disagrees with the words", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。");
		expect(await h.apply(["高い猫。美しい犬。"])).toBe("applied");
		selectSlot(h, h.current("暑い"));
		expect(buttonState(h.view)).toEqual({ shuffle: true, restore: true, automatic: false, clear: false });

		expect(h.controller().shuffleManual(h.current("暑い"))).toBe("applied");
		selectSlot(h, h.current("暑い"));
		const state = buttonState(h.view);
		expect(state).toEqual({ shuffle: true, restore: true, automatic: true, clear: true });
		expect(shown(h.view)?.startsWith("Manual Shuffle: ")).toBe(state.shuffle);
		expect(h.current("暑い").manualDiagnostic.overridden).toBe(true);

		expect(h.controller().useAutomatic(h.current("暑い"))).toBe("applied");
		selectSlot(h, h.current("暑い"));
		expect(buttonState(h.view)).toEqual({ shuffle: true, restore: true, automatic: false, clear: false });
		await h.view.onClose();
	});

	it("keeps the click menu's own entry conditions", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。");
		expect(await h.apply(["暑い猫。"])).toBe("applied");
		// No alternative means no manual marker and no menu, exactly as before.
		expect(h.root().querySelectorAll(".semantropy-manual-available")).toHaveLength(0);
		h.root().dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(shell(h.view).querySelector(".semantropy-manual-menu")).toBeNull();
		await h.view.onClose();
	});

	it("disables every Manual control when nothing is selected", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。");
		expect(await h.apply(["高い猫。"])).toBe("applied");
		expect(buttonState(h.view)).toEqual({ shuffle: false, restore: false, automatic: false, clear: false });
		expect(shown(h.view)).toBeNull();
		expect(control(h.view, "shuffle-selected").hasAttribute("aria-describedby")).toBe(false);
		await h.view.onClose();
	});
});

describe("DIAGNOSTICS1 lifecycle", () => {
	async function selected(level = 0) {
		const h = manualMorphHarness(adjectives());
		h.state.level = assertBodySemantropy(level);
		await h.open("暑い。猫と犬。");
		expect(await h.apply(["高い猫。美しい犬。赤い鳥。"])).toBe("applied");
		selectSlot(h, h.current("暑い"));
		expect(shown(h.view)).not.toBeNull();
		return h;
	}

	it.each(["shuffle-selected", "restore-selected", "automatic-selected"] as const)(
		"clears the diagnostic after a successful %s", async name => {
			const h = await selected();
			if (name !== "shuffle-selected") {
				expect(h.controller().shuffleManual(h.current("暑い"))).toBe("applied");
				selectSlot(h, h.current("暑い"));
			}
			const button = control(h.view, name);
			expect(button.disabled).toBe(false);
			button.click();
			expect(shown(h.view)).toBeNull();
			expect(buttonState(h.view).shuffle).toBe(false);
			await h.view.onClose();
		});

	it("drops the recorded selection and its diagnostic on Reshuffle, Refresh and Vocabulary Apply", async () => {
		const reshuffled = await selected(100);
		select(null);
		expect(await reshuffled.view.reshuffle({ issueSeed: () => 11 })).toBe("applied");
		expect(shown(reshuffled.view)).toBeNull();
		await reshuffled.view.onClose();

		const refreshed = await selected();
		select(null);
		// A no-op Refresh rebuilds nothing, so the Target must really change.
		refreshed.state.text = "暑い。猫と犬と鳥。";
		expect(await refreshed.view.refreshSource()).toBe("refreshed");
		expect(shown(refreshed.view)).toBeNull();
		await refreshed.view.onClose();

		const applied = await selected();
		select(null);
		expect(await applied.apply(["赤い鳥。"])).toBe("applied");
		expect(shown(applied.view)).toBeNull();
		await applied.view.onClose();
	});

	it("recomputes rather than repeats when the browser keeps a selection across a rebuild", async () => {
		// A DOM Range is live: a rebuild can leave it covering the same word in
		// the new body, and that selection is current, not stale. What must never
		// happen is the old sentence surviving the new Vocabulary.
		const h = await selected();
		expect(shown(h.view)).toBe("Manual Shuffle: 3 alternatives in the active Vocabulary.");
		expect(await h.apply(["赤い鳥。"])).toBe("applied");
		const after = shown(h.view);
		if (after !== null) {
			expect(after).toBe("Manual Shuffle: 1 alternative in the active Vocabulary.");
			// Whatever is on screen came from the plan committed now.
			expect(h.current("暑い").manualDiagnostic.alternativeSurfaceCount).toBe(1);
		}
		expect(h.controller().getManualOverrideCount()).toBe(0);
		await h.view.onClose();
	});

	it("keeps the old diagnostic when an operation fails or a stale slot is refused", async () => {
		const h = await selected();
		const before = shown(h.view);
		h.state.failTokens = true;
		expect(await h.view.refreshSource()).not.toBe("applied");
		expect(shown(h.view)).toBe(before);
		h.state.failTokens = false;

		const stale = h.current("暑い");
		expect(h.controller().shuffleManual({ ...stale })).toBe("stale");
		expect(shown(h.view)).toBe(before);
		await h.view.onClose();
	});

	it("keeps a still-valid selection's diagnostic across Load next", async () => {
		const h = manualMorphHarness(adjectives(), 6);
		await h.open("暑い。\n\n高い。\n\n美しい。\n");
		expect(await h.apply(["高い猫。美しい犬。赤い鳥。"])).toBe("applied");
		const slot = h.current("暑い");
		selectSlot(h, slot);
		const before = shown(h.view);
		expect(before).not.toBeNull();
		// Focus leaves the body, as pressing a Toolbar control does.
		select(null);

		expect(await h.view.loadNextSection()).toBe("applied");

		// The plan is rebuilt for the unchanged prefix, so object identity alone
		// would lose a selection the reader still has.
		expect(h.plan().slots.includes(slot)).toBe(false);
		expect(shown(h.view)).toBe(before);
		expect(buttonState(h.view).shuffle).toBe(true);
		await h.view.onClose();
	});

	it("releases the diagnostic and the selection on close", async () => {
		const h = await selected();
		await h.view.onClose();
		expect(shell(h.view).querySelector(".semantropy-manual-diagnostic")).toBeNull();
		expect(Reflect.get(h.view, "selection")).toBeNull();
		expect(Reflect.get(h.controller(), "runtime")).toBeNull();
	});

	it("shows only the newly selected slot's diagnostic after a retry", async () => {
		const h = await selected();
		const adjective = "Manual Shuffle: 3 alternatives in the active Vocabulary.";
		expect(shown(h.view)).toBe(adjective);
		selectSlot(h, h.current("猫"));
		const nounMessage = shown(h.view);
		expect(nounMessage).not.toBeNull();
		expect(nounMessage).not.toBe(adjective);
		selectSlot(h, h.current("暑い"));
		expect(shown(h.view)).toBe(adjective);
		await h.view.onClose();
	});
});

describe("DIAGNOSTICS1 provenance and non-regression", () => {
	it("adds no candidate for the sake of a diagnostic", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。");
		expect(await h.apply(["高い猫。"])).toBe("applied");
		const slot = h.current("暑い");
		expect(slot.manualDiagnostic.alternativeSurfaceCount).toBe(1);
		expect(slot.displaySurface).toBe("暑い");

		// A caller-shaped diagnostic is only data for the pure mapping: the plan
		// keeps its own, and nothing the view reports can widen the candidate set.
		const forged = { ...slot.manualDiagnostic, status: "available" as const, alternativeSurfaceCount: 9 };
		expect(toManualDiagnosticView(forged)?.available).toBe(true);
		expect(h.current("暑い").manualDiagnostic.alternativeSurfaceCount).toBe(1);
		selectSlot(h, h.current("暑い"));
		expect(shown(h.view)).toBe("Manual Shuffle: 1 alternative in the active Vocabulary.");
		await h.view.onClose();
	});

	it("leaves automatic results, Ruby, Copy, Collect and Source reads untouched by a selection", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。猫と犬。");
		expect(await h.apply(["高い猫。美しい犬。赤い鳥。"])).toBe("applied");
		const before = {
			surfaces: h.plan().slots.map(s => s.displaySurface),
			replacements: h.plan().replacementCount,
			replaceable: h.plan().replaceableSlotCount,
			ruby: h.plan().slots.map(s => s.displayRuby?.reading ?? null),
			text: h.controller().getLogicalText(),
			tokenizations: h.calls.tokenizations.length,
			reads: h.calls.reads.length,
			nodes: h.controller().getChunkStats().nodes,
		};
		for (let i = 0; i < 100; i += 1) {
			selectSlot(h, h.current(i % 2 === 0 ? "暑い" : "猫"));
			select(null);
		}
		expect(h.plan().slots.map(s => s.displaySurface)).toEqual(before.surfaces);
		expect(h.plan().replacementCount).toBe(before.replacements);
		expect(h.plan().replaceableSlotCount).toBe(before.replaceable);
		expect(h.plan().slots.map(s => s.displayRuby?.reading ?? null)).toEqual(before.ruby);
		expect(h.controller().getLogicalText()).toBe(before.text);
		// No tokenize, no Source read, no Snapshot rebuild for a selection change.
		expect(h.calls.tokenizations).toHaveLength(before.tokenizations);
		expect(h.calls.reads).toHaveLength(before.reads);
		expect(h.calls.copy).toEqual([]);
		expect(h.calls.collect).toEqual([]);
		// One status row and one set of Manual controls: nothing accumulates.
		expect(h.controller().getChunkStats().nodes).toBe(before.nodes);
		expect(shell(h.view).querySelectorAll(".semantropy-manual-diagnostic")).toHaveLength(1);
		expect(shell(h.view).querySelectorAll(".semantropy-manual-shuffle-selected")).toHaveLength(1);
		await h.view.onClose();
	});

	it("keeps the diagnostic out of the fingerprint, the Snapshot and every explicit payload", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。");
		expect(await h.apply(["高い猫。"])).toBe("applied");
		const fingerprint = h.controller().getVocabularySnapshot()!.fingerprint;
		selectSlot(h, h.current("暑い"));
		expect(JSON.stringify(h.controller().getVocabularySnapshot())).not.toMatch(/manualDiagnostic|alternativeSurfaceCount/u);
		expect(h.controller().getVocabularySnapshot()!.fingerprint).toBe(fingerprint);
		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(h.calls.copy).toEqual(["暑い"]);
		expect(h.calls.copy.join("")).not.toMatch(/Manual Shuffle|alternative/u);
		expect(h.calls.collect).toEqual([]);
		await h.view.onClose();
	});

	it("leaves the live region alone when a sync changes nothing", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。");
		expect(await h.apply(["高い猫。"])).toBe("applied");
		const element = diagnosticEl(h.view);
		selectSlot(h, h.current("暑い"));
		const message = element.textContent;

		const records: MutationRecord[] = [];
		const observer = new MutationObserver(list => records.push(...list));
		observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
		// sync() runs on selectionchange, pointerup, keyup and every status
		// change. Re-writing the same sentence into an aria-live region can make
		// a screen reader repeat it, so an unchanged diagnostic must not touch
		// the DOM at all.
		const sync = Reflect.get(h.view, "syncActionControls") as () => void;
		for (let i = 0; i < 20; i += 1) sync.call(h.view);
		document.dispatchEvent(new Event("selectionchange"));
		observer.takeRecords().forEach(record => records.push(record));
		observer.disconnect();

		expect(records).toHaveLength(0);
		expect(element.textContent).toBe(message);
		expect(element.hidden).toBe(false);
		await h.view.onClose();
	});

	it("marks the status row for assistive technology without relying on colour", async () => {
		const h = manualMorphHarness(adjectives());
		await h.open("暑い。");
		expect(await h.apply(["高い猫。"])).toBe("applied");
		const element = diagnosticEl(h.view);
		expect(element.getAttribute("role")).toBe("status");
		expect(element.getAttribute("aria-live")).toBe("polite");
		expect(element.hidden).toBe(true);
		expect(element.id).not.toBe("");
		selectSlot(h, h.current("暑い"));
		expect(element.hidden).toBe(false);
		expect(element.textContent).toContain("Manual Shuffle");
		expect(control(h.view, "shuffle-selected").getAttribute("aria-describedby")).toBe(element.id);
		// The description lives in the always-visible status line, never in the
		// collapsed overflow menu.
		expect(element.closest("[hidden]")).toBeNull();
		await h.view.onClose();
	});

	it("wraps onto its own status row instead of widening the toolbar", async () => {
		const css = await readFile("styles.css", "utf8");
		const { JSDOM } = (await import("node:module")).createRequire(import.meta.url)("jsdom") as {
			JSDOM: new (html: string) => { window: Window };
		};
		const dom = new JSDOM(
			`<style>${css}</style><div class="semantropy-status">` +
			`<div class="semantropy-manual-diagnostic">x</div>` +
			`<div class="semantropy-manual-diagnostic" hidden>y</div></div>`,
		);
		const rows = dom.window.document.querySelectorAll(".semantropy-manual-diagnostic");
		const visible = dom.window.getComputedStyle(rows[0]!);
		expect(visible.flexBasis).toBe("100%");
		expect(visible.overflowWrap).toBe("anywhere");
		expect(visible.minWidth).toBe("0px");
		// Hidden collapses the row rather than leaving an empty gap.
		expect(dom.window.getComputedStyle(rows[1]!).display).toBe("none");
		dom.window.close();
	});

	it("gives each open view its own diagnostic element id", async () => {
		const first = manualMorphHarness(adjectives());
		const second = manualMorphHarness(adjectives());
		await first.open("暑い。");
		await second.open("暑い。");
		expect(diagnosticEl(first.view).id).not.toBe(diagnosticEl(second.view).id);
		await first.view.onClose();
		await second.view.onClose();
	});
});
