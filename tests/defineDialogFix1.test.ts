// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, peekMorph } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { ui } from "../src/i18n/catalog";
import type { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import type { AutomaticViewParticipant } from "../src/application/AutomaticPosCoordinator";
import type { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import type { BodySelectionSource } from "../src/view/readBodySelection";

/*
 * DEFINE-DIALOG-FIX1. On Obsidian 1.14.4 the Fake Dictionary dialog (the word menu's "Look up in
 * Fake Dictionary", and the Define command) showed its definition, but Reshuffle, Copy, Collect and
 * the level control did nothing: Obsidian's own `Modal` assigns an instance property `isOpen` in its
 * constructor, which hid the subclass method `isOpen()`, so `definitionModal.isOpen()` threw. The
 * hover Popover was not affected.
 *
 * These drive the real View and the real dialog from both entries and press the four controls. The
 * Modal stub now follows the real constructor and open() / close(), so the old name fails here with
 * the same "is not a function" the application raised.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
const live: ReturnType<typeof manualMorphHarness>[] = [];
afterEach(async () => {
	for (const h of live.splice(0)) await h.view.onClose();
	vi.restoreAllMocks();
	document.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
});

const lexicon = () => lexiconTokenizer([
	token({ surface: "猫", baseForm: "猫", reading: "ネコ" }),
	token({ surface: "犬", baseForm: "犬", reading: "イヌ" }),
]);
async function harness() {
	const h = manualMorphHarness(lexicon(), 5000);
	live.push(h);
	await h.open("猫犬。");
	return h;
}
type H = Awaited<ReturnType<typeof harness>>;
const ENTRIES = ["word menu", "selected word"] as const;
type Entry = (typeof ENTRIES)[number];

const shell = (h: H) => peekMorph(h.view).contentEl;
const world = (h: H) => Reflect.get(h.view, "dictionaryWorld") as FakeDictionaryWorld;
const popover = (h: H) => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
const dialogModal = (h: H) => Reflect.get(h.view, "definitionModal") as { isShowing(): boolean; close(): void } | null;
const dialog = () => document.querySelector<HTMLElement>(".semantropy-dictionary-modal");
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
async function until(check: () => unknown, label: string, limit = 2000): Promise<void> {
	const end = Date.now() + limit;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
		await wait(5);
	}
}
const tokenElement = (h: H, surface = "猫") => Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token"))
	.find((element) => h.controller().getSlotForElement(element) === h.current(surface))!;
const selectionOf = (element: HTMLElement): BodySelectionSource => {
	const range = element.ownerDocument.createRange();
	range.selectNodeContents(element);
	return { rangeCount: 1, getRangeAt: () => range };
};
const controls = () => {
	const root = dialog()!;
	return {
		reshuffle: root.querySelector<HTMLButtonElement>(".semantropy-reshuffle-definition")!,
		copy: root.querySelector<HTMLButtonElement>(".semantropy-copy-definition")!,
		collect: root.querySelector<HTMLButtonElement>(".semantropy-collect-definition")!,
		level: root.querySelector<HTMLSelectElement>(".semantropy-dictionary-level-select")!,
		headword: root.querySelector(".semantropy-definition-headword")!.textContent,
		definition: root.querySelector(".semantropy-definition-text")!.textContent,
	};
};
/** What Copy writes and Collect stores: the displayed headword, one LF, the definition. */
const shownText = () => `${controls().headword}\n${controls().definition}`;

async function openDialog(h: H, entry: Entry): Promise<void> {
	const origin = tokenElement(h);
	if (entry === "word menu") {
		document.getSelection()!.collapse(origin.firstChild, 0);
		origin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
		const lookUp = Array.from(shell(h).querySelectorAll<HTMLButtonElement>(".semantropy-manual-menu button"))
			.find((button) => button.textContent === ui().view.manualDefine);
		expect(lookUp, "the word menu offers the lookup").toBeDefined();
		expect(lookUp!.disabled).toBe(false);
		lookUp!.click();
	} else {
		expect(await h.view.defineSelectedWord({ selection: selectionOf(origin) })).toBe("ready");
	}
	await until(() => dialog()?.querySelector(".semantropy-definition-text")?.textContent, "a definition in the dialog");
	expect(dialogModal(h)?.isShowing()).toBe(true);
}

describe("DEFINE-DIALOG-FIX1: the definition dialog's controls work (word menu and Define selected word)", () => {
	it.each(ENTRIES)("opens with a definition and the four controls enabled (%s)", async (entry) => {
		const h = await harness();
		await openDialog(h, entry);
		const c = controls();
		expect(c.headword).toBe("猫");
		expect(c.definition.length).toBeGreaterThan(0);
		for (const control of [c.reshuffle, c.copy, c.collect, c.level]) expect(control.disabled).toBe(false);
		expect(document.querySelectorAll(".semantropy-dictionary-modal")).toHaveLength(1);
	});

	it.each(ENTRIES)("Reshuffle draws another definition (%s)", async (entry) => {
		const h = await harness();
		await openDialog(h, entry);
		const request = world(h).getCurrent()!.requestId;
		const reshuffle = vi.spyOn(h.view, "reshuffleDefinition");
		controls().reshuffle.click();
		expect(reshuffle).toHaveBeenCalledTimes(1);
		expect(reshuffle.mock.results[0]).toEqual({ type: "return", value: "applied" });
		expect(world(h).getCurrent()!.requestId).not.toBe(request);
		expect(controls().definition.length).toBeGreaterThan(0);
		expect(controls().reshuffle.disabled).toBe(false);
	});

	it.each(ENTRIES)("Copy writes the headword and the definition once (%s)", async (entry) => {
		const h = await harness();
		await openDialog(h, entry);
		const text = shownText();
		controls().copy.click();
		await until(() => h.calls.copy.length > 0, "the clipboard write");
		await wait(0);
		expect(h.calls.copy).toEqual([text]);
		expect(text.startsWith("猫\n")).toBe(true);
	});

	it.each(ENTRIES)("Collect stores one Fake Dictionary entry with the same text (%s)", async (entry) => {
		const h = await harness();
		await openDialog(h, entry);
		const text = shownText();
		controls().collect.click();
		await until(() => h.calls.collect.length > 0, "the Collection write");
		await wait(0);
		expect(h.calls.collect).toHaveLength(1);
		expect(h.calls.collect[0]).toMatchObject({ type: "fake-dictionary", text });
	});

	it.each(ENTRIES)("the level control changes the Fake Dictionary level and keeps the dialog open (%s)", async (entry) => {
		const h = await harness();
		await openDialog(h, entry);
		expect(controls().level.value).toBe("50");
		controls().level.value = "75";
		controls().level.dispatchEvent(new Event("change", { bubbles: true }));
		await until(() => Number(h.state.dictionary) === 75, "the level to be saved");
		await until(() => world(h).getCurrent()?.dictionarySemantropy === 75, "the definition at the new level");
		expect(controls().level.value).toBe("75");
		expect(controls().definition.length).toBeGreaterThan(0);
		expect(dialogModal(h)?.isShowing()).toBe(true);
	});

	it.each(ENTRIES)("the four controls work one after another in the same dialog (%s)", async (entry) => {
		const h = await harness();
		await openDialog(h, entry);
		const reshuffle = vi.spyOn(h.view, "reshuffleDefinition");
		controls().reshuffle.click();
		expect(reshuffle.mock.results[0]).toEqual({ type: "return", value: "applied" });
		// A control is disabled while an earlier action is still running, so each step waits for them to come back, as a person would.
		const idle = () => !controls().collect.disabled && !controls().copy.disabled && !controls().level.disabled;
		controls().copy.click();
		await until(() => h.calls.copy.length === 1 && idle(), "the clipboard write to finish");
		controls().collect.click();
		await until(() => h.calls.collect.length === 1 && idle(), "the Collection write to finish");
		controls().level.value = "100";
		controls().level.dispatchEvent(new Event("change", { bubbles: true }));
		await until(() => Number(h.state.dictionary) === 100, "the level to be saved");
		await until(() => !controls().reshuffle.disabled && world(h).getCurrent()?.dictionarySemantropy === 100, "the dialog to settle");
		controls().reshuffle.click();
		expect(reshuffle.mock.results[1]).toEqual({ type: "return", value: "applied" });
		expect(dialogModal(h)?.isShowing()).toBe(true);
	});
});

describe("DEFINE-DIALOG-FIX1: the View's other readings of the dialog's open state", () => {
	it("a second Define while the dialog is open reuses that dialog", async () => {
		const h = await harness();
		await openDialog(h, "word menu");
		const first = dialogModal(h);
		const request = world(h).getCurrent()!.requestId;
		expect(await h.view.defineSelectedWord({ selection: selectionOf(tokenElement(h, "犬")) })).toBe("ready");
		expect(dialogModal(h)).toBe(first);
		expect(document.querySelectorAll(".semantropy-dictionary-modal")).toHaveLength(1);
		expect(world(h).getCurrent()!.requestId).not.toBe(request);
		expect(controls().headword).toBe("犬");
	});

	it("while the dialog is open, hover, Apply and the automatic claim are refused; closing releases them", async () => {
		const errors: unknown[] = [];
		const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
		window.addEventListener("error", onError);
		try {
			const h = await harness();
			await openDialog(h, "word menu");
			// An empty selection ends the Define request but leaves the displayed definition and its dialog: the one state
			// in which the open dialog, and not a pending request, is what stops the others (the pending id is null).
			expect(await h.view.defineSelectedWord({ selection: null })).toBe("empty");
			expect(Reflect.get(h.view, "pendingDefineId")).toBeNull();
			expect(dialogModal(h)?.isShowing()).toBe(true);

			const origin = tokenElement(h);
			origin.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, cancelable: true, altKey: true }));
			await wait(145);
			expect(popover(h).isOpen()).toBe(false);
			expect(document.querySelector(".semantropy-dictionary-popover")).toBeNull();
			const participant = Reflect.get(h.view, "automaticParticipant") as AutomaticViewParticipant;
			expect(participant.claim("level")).toBeNull();
			expect(await h.apply(["犬猫。"])).toBe("busy");

			dialogModal(h)!.close();
			expect(dialogModal(h)).toBeNull();
			expect(document.querySelector(".semantropy-dictionary-modal")).toBeNull();
			const claim = participant.claim("level");
			expect(claim).not.toBeNull();
			claim!.release(false);
			origin.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, cancelable: true, altKey: true }));
			await wait(145);
			expect(popover(h).isOpen()).toBe(true);
			popover(h).close();
			expect(await h.apply(["犬猫。"])).toBe("applied");
			// None of that threw, in a listener or elsewhere.
			expect(errors).toEqual([]);
		} finally {
			window.removeEventListener("error", onError);
		}
	});

	it.each(ENTRIES)("after the dialog is closed, a later Define opens a working one (%s)", async (entry) => {
		const h = await harness();
		await openDialog(h, entry);
		dialogModal(h)!.close();
		expect(dialog()).toBeNull();
		await openDialog(h, entry);
		const reshuffle = vi.spyOn(h.view, "reshuffleDefinition");
		controls().reshuffle.click();
		expect(reshuffle.mock.results[0]).toEqual({ type: "return", value: "applied" });
		expect(document.querySelectorAll(".semantropy-dictionary-modal")).toHaveLength(1);
	});

	it("reads the dialog's state through a name Obsidian's Modal does not use, and tracks open and close", async () => {
		const h = await harness();
		await openDialog(h, "selected word");
		const modal = dialogModal(h)!;
		expect(modal.isShowing()).toBe(true);
		modal.close();
		expect(modal.isShowing()).toBe(false);
	});
});
