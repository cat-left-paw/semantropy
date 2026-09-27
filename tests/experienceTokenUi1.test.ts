// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, morphToken, suffix, peekMorph } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { OVERLAY_GAP, overlayBounds, placeOverlay, type PlacementRect } from "../src/view/overlayPlacement";
import type { SemantropyView } from "../src/view/SemantropyView";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";

/*
 * PRE-RELEASE-EXPERIENCE-TOKEN-UI1 focused regressions:
 *   UX-09 the Manual menu sits beside its word, flips and clamps, follows scroll / resize;
 *   UX-10 markers are quieter without touching the text;
 *   UX-12 a pointer affordance only where the View would act now.
 * jsdom has no layout: element rectangles are stubbed here, and the real layout is
 * measured separately in Chromium (see the implementation record).
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

const rect = (left: number, top: number, right: number, bottom: number): PlacementRect & DOMRect =>
	({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) });

describe("overlay placement rule", () => {
	const bounds = rect(8, 8, 408, 608);
	it("goes below the word's last line, from its left edge", () => {
		const word = rect(100, 100, 130, 120);
		expect(placeOverlay({ below: word, above: word, width: 150, height: 90, bounds })).toEqual({ left: 100, top: 120 + OVERLAY_GAP, flipped: false, maxHeight: 90 });
	});
	it("flips above the first line when there is no room below, and never covers a wrapped word", () => {
		const first = rect(300, 540, 400, 560), last = rect(10, 560, 60, 580);
		const place = placeOverlay({ below: last, above: first, width: 150, height: 90, bounds });
		expect(place.flipped).toBe(true);
		expect(place.top).toBe(540 - 90 - OVERLAY_GAP);
		expect(place.top + 90).toBeLessThanOrEqual(first.top);
		// Pulled back from the right edge, never past it.
		expect(place.left).toBe(408 - 150);
	});
	it("shortens an overlay that fits on neither side instead of sliding it over the word", () => {
		// Review case: bounds 8..200, word 100..120, overlay 110 high. Clamping alone put it at 8..118.
		const word = rect(100, 100, 140, 120), tight = rect(8, 8, 408, 200);
		const place = placeOverlay({ below: word, above: word, width: 150, height: 110, bounds: tight });
		expect(place).toEqual({ left: 100, top: 8, flipped: true, maxHeight: 100 - OVERLAY_GAP - 8 });
		expect(place.top + place.maxHeight).toBeLessThanOrEqual(word.top);
		// More room below than above: it stays below, shortened to that room.
		const low = placeOverlay({ below: rect(100, 40, 140, 60), above: rect(100, 40, 140, 60), width: 150, height: 300, bounds: tight });
		expect(low).toEqual({ left: 100, top: 60 + OVERLAY_GAP, flipped: false, maxHeight: 200 - 60 - OVERLAY_GAP });
		expect(low.top).toBeGreaterThanOrEqual(60);
	});
	it("clamps into narrow and short bounds instead of leaving the screen", () => {
		const narrow = rect(8, 8, 108, 60);
		const place = placeOverlay({ below: rect(50, 30, 70, 50), above: rect(50, 30, 70, 50), width: 150, height: 90, bounds: narrow });
		expect(place.left).toBe(8);
		// Neither side fits: the larger side (above, 18px) and a height capped to it, still inside the bounds.
		expect([place.top, place.maxHeight, place.flipped]).toEqual([8, 30 - OVERLAY_GAP - 8, true]);
	});
	it("intersects the visible window, less a margin, with the pane", () => {
		const win = { innerWidth: 1000, innerHeight: 700, visualViewport: null } as unknown as Window;
		expect(overlayBounds(win, rect(200, 50, 600, 900))).toEqual({ left: 200, right: 600, top: 50, bottom: 692 });
		expect(overlayBounds(win, null)).toEqual({ left: 8, right: 992, top: 8, bottom: 692 });
	});
});

const tokenizer = () => lexiconTokenizer([
	morphToken("暑い", "形容詞・アウオ段", "基本形", "形容詞"),
	morphToken("高い", "形容詞・アウオ段", "基本形", "形容詞"),
	morphToken("美しい", "形容詞・イ段", "基本形", "形容詞"),
	suffix("か", "助詞", "副助詞"), suffix("も", "助詞", "係助詞"), suffix("は", "助詞", "係助詞"),
	token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "鳥" }),
]);
type H = ReturnType<typeof manualMorphHarness>;
const shell = (view: SemantropyView) => peekMorph(view).contentEl;
const menuOf = (view: SemantropyView) => shell(view).querySelector<HTMLElement>(".semantropy-manual-menu");
const scrollOf = (view: SemantropyView) => shell(view).querySelector<HTMLElement>(".semantropy-scroll")!;
const rootOf = (view: SemantropyView) => shell(view).querySelector<HTMLElement>(".semantropy-root")!;
const bodyOf = (view: SemantropyView) => shell(view).querySelector<HTMLElement>(".semantropy-body")!;
function wordEl(h: H, surface: string): HTMLElement {
	return Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(el => el.textContent === surface)!;
}
/** A laid-out View: root 0..400 x 0..600, body box 100..600, the word where the test says. */
function layout(h: H, word: HTMLElement, place: { left: number; top: number }) {
	const box = { word: rect(place.left, place.top, place.left + 40, place.top + 20) };
	vi.spyOn(rootOf(h.view), "getBoundingClientRect").mockImplementation(() => rect(0, 0, 400, 600));
	vi.spyOn(scrollOf(h.view), "getBoundingClientRect").mockImplementation(() => rect(0, 100, 400, 600));
	vi.spyOn(word, "getClientRects").mockImplementation(() => [box.word] as unknown as DOMRectList);
	return { move: (left: number, top: number) => { box.word = rect(left, top, left + 40, top + 20); } };
}
function sizeMenu(view: SemantropyView) {
	const menu = menuOf(view)!;
	vi.spyOn(menu, "getBoundingClientRect").mockImplementation(() => rect(0, 0, 160, 110));
	return menu;
}
const click = (el: HTMLElement) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
const ready = async (size?: number, level = 0) => {
	const h = manualMorphHarness(tokenizer(), size);
	h.state.level = assertBodySemantropy(level);
	await h.open("猫は暑いか。犬も高い。鳥は美しい。\n");
	await h.apply(["鳥美しい。猫は高い。暑い。"]);
	return h;
};
/** Opens, then re-places once with the menu's own size known. */
function open(h: H, surface: string, at: { left: number; top: number }, keyboard = false) {
	const word = wordEl(h, surface);
	const geometry = layout(h, word, at);
	if (keyboard) word.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	else click(word);
	const menu = sizeMenu(h.view);
	scrollOf(h.view).dispatchEvent(new Event("scroll"));
	return { word, menu, geometry };
}
const px = (value: string) => Number(value.replace("px", ""));

describe("UX-09 the Manual menu sits beside its word", () => {
	it("opens below the clicked word inside its View, not at a fixed corner", async () => {
		const h = await ready();
		const { menu } = open(h, "暑い", { left: 120, top: 200 });
		expect(menu.parentElement).toBe(rootOf(h.view));
		expect([px(menu.style.left), px(menu.style.top)]).toEqual([120, 220 + OVERLAY_GAP]);
		expect(menu.classList.contains("is-above")).toBe(false);
	});

	it("is placed as it opens, before any scroll or resize", async () => {
		const h = await ready();
		const word = wordEl(h, "暑い");
		layout(h, word, { left: 90, top: 150 });
		const size = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
		const original = size.getMockImplementation();
		size.mockImplementation(function (this: HTMLElement) {
			if (this.classList.contains("semantropy-manual-menu")) return rect(0, 0, 160, 110);
			return original ? original.call(this) : rect(0, 0, 0, 0);
		});
		click(word);
		const menu = menuOf(h.view)!;
		expect([px(menu.style.left), px(menu.style.top)]).toEqual([90, 170 + OVERLAY_GAP]);
	});

	it("flips above near the bottom and clamps at the right edge", async () => {
		const h = await ready();
		const { menu } = open(h, "暑い", { left: 380, top: 560 });
		expect(menu.classList.contains("is-above")).toBe(true);
		expect(px(menu.style.top)).toBe(560 - 110 - OVERLAY_GAP);
		expect(px(menu.style.left)).toBe(400 - 160);
		expect(menu.style.maxWidth).not.toBe("");
	});

	it("follows the word on scroll and resize, and closes when the word leaves the body box", async () => {
		const h = await ready();
		const { menu, geometry } = open(h, "暑い", { left: 120, top: 200 });
		geometry.move(120, 300);
		scrollOf(h.view).dispatchEvent(new Event("scroll"));
		expect(px(menu.style.top)).toBe(320 + OVERLAY_GAP);
		geometry.move(60, 250);
		window.dispatchEvent(new Event("resize"));
		expect([px(menu.style.left), px(menu.style.top)]).toEqual([60, 270 + OVERLAY_GAP]);
		geometry.move(60, 60);
		scrollOf(h.view).dispatchEvent(new Event("scroll"));
		expect(menuOf(h.view)).toBeNull();
	});

	it("releases its scroll and resize listeners with the menu", async () => {
		const h = await ready();
		const scroll = scrollOf(h.view);
		const added = vi.spyOn(scroll, "addEventListener"), removed = vi.spyOn(scroll, "removeEventListener");
		const winAdded = vi.spyOn(window, "addEventListener"), winRemoved = vi.spyOn(window, "removeEventListener");
		open(h, "暑い", { left: 120, top: 200 });
		const scrolls = added.mock.calls.filter(([type]) => type === "scroll").map(([, handler]) => handler);
		const resizes = winAdded.mock.calls.filter(([type]) => type === "resize").map(([, handler]) => handler);
		expect(scrolls).toHaveLength(1); expect(resizes).toHaveLength(1);
		menuOf(h.view)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(menuOf(h.view)).toBeNull();
		expect(removed.mock.calls.some(([type, handler]) => type === "scroll" && handler === scrolls[0])).toBe(true);
		expect(winRemoved.mock.calls.some(([type, handler]) => type === "resize" && handler === resizes[0])).toBe(true);
	});

	it("keeps keyboard entry: focus moves in, Escape really returns it to the word", async () => {
		const h = await ready();
		const { word, menu } = open(h, "暑い", { left: 120, top: 200 }, true);
		expect(document.activeElement).toBe(menu.querySelector("button:not(:disabled)"));
		menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(menuOf(h.view)).toBeNull();
		// The word holds focus (a browser drops focus from an element that stops being focusable,
		// so the owned tabindex stays while focused), is never a Tab stop, and the display stays intact.
		expect(document.activeElement).toBe(word);
		expect(word.getAttribute("tabindex")).toBe("-1");
		expect(h.controller().isDisplayIntact()).toBe(true);
		// Leaving the word removes the owned attribute; the next keyboard entry works again.
		shell(h.view).querySelector<HTMLButtonElement>(".semantropy-copy")!.focus();
		expect(word.hasAttribute("tabindex")).toBe(false);
		expect(h.controller().isDisplayIntact()).toBe(true);
		word.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(menuOf(h.view)).not.toBeNull();
	});

	it("never leaves more than one word holding focus, even when no blur arrives", async () => {
		const h = await ready();
		const first = wordEl(h, "暑い"), second = wordEl(h, "高い");
		const blurless = (el: HTMLElement) => vi.spyOn(el, "addEventListener").mockImplementation(() => undefined);
		// A window without system focus dispatches no blur: simulate that by never registering one.
		blurless(first);
		expect(h.controller().focusSlotElement(first)).toBe(true);
		expect(first.getAttribute("tabindex")).toBe("-1");
		expect(h.controller().focusSlotElement(second)).toBe(true);
		expect(first.hasAttribute("tabindex")).toBe(false);
		expect(second.getAttribute("tabindex")).toBe("-1");
		expect(h.controller().isDisplayIntact()).toBe(true);
		blurless(second);
		await h.view.onClose();
		expect(second.hasAttribute("tabindex")).toBe(false);
	});

	it("does not stay open for a word pushed outside its View (a Toolbar taller than the pane)", async () => {
		const h = await ready();
		const word = wordEl(h, "暑い");
		// The body box starts inside the View but runs past its bottom; the word sits past it too.
		vi.spyOn(rootOf(h.view), "getBoundingClientRect").mockImplementation(() => rect(0, 0, 400, 300));
		vi.spyOn(scrollOf(h.view), "getBoundingClientRect").mockImplementation(() => rect(0, 250, 400, 600));
		vi.spyOn(word, "getClientRects").mockImplementation(() => [rect(30, 390, 70, 410)] as unknown as DOMRectList);
		click(word);
		expect(menuOf(h.view)).toBeNull();
	});

	it("shortens the menu in a pane too short for either side, never covering the word", async () => {
		const h = await ready();
		const word = wordEl(h, "暑い");
		const box = rect(100, 100, 140, 120);
		vi.spyOn(rootOf(h.view), "getBoundingClientRect").mockImplementation(() => rect(0, 0, 400, 200));
		vi.spyOn(scrollOf(h.view), "getBoundingClientRect").mockImplementation(() => rect(0, 40, 400, 200));
		vi.spyOn(word, "getClientRects").mockImplementation(() => [box] as unknown as DOMRectList);
		click(word);
		const menu = sizeMenu(h.view);
		scrollOf(h.view).dispatchEvent(new Event("scroll"));
		const top = px(menu.style.top), height = px(menu.style.maxHeight);
		expect(height).toBeLessThan(110);
		expect(top + height).toBeLessThanOrEqual(box.top - OVERLAY_GAP);
		expect(top).toBeGreaterThanOrEqual(8);
	});

	it("returns keyboard focus without scrolling when the word scrolls out", async () => {
		const h = await ready();
		const { word, geometry } = open(h, "暑い", { left: 120, top: 200 }, true);
		const focus = vi.spyOn(word, "focus");
		geometry.move(120, 700);
		scrollOf(h.view).dispatchEvent(new Event("scroll"));
		expect(menuOf(h.view)).toBeNull();
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("closes on a stale slot: Reshuffle, Vocabulary Apply, a Source change and View close", async () => {
		for (const cause of ["reshuffle", "apply", "source", "close"] as const) {
			const h = await ready(undefined, cause === "reshuffle" ? 100 : 0);
			open(h, "暑い", { left: 120, top: 200 });
			// At Text Off a Reshuffle changes nothing and the slot stays valid; at MAX it replaces the body.
			if (cause === "reshuffle") expect(await h.view.reshuffle({ issueSeed: () => 11 })).toBe("applied");
			if (cause === "apply") await h.apply(["猫美しい。"]);
			if (cause === "source") { h.view.notifyVocabularySourceEvent("source0.md"); expect(await h.view.refreshSource()).toBeDefined(); }
			if (cause === "close") await h.view.onClose();
			expect(menuOf(h.view)).toBeNull();
			document.body.replaceChildren();
		}
	});

	it("keeps a Load next from leaving a menu attached to a replaced word", async () => {
		const h = manualMorphHarness(tokenizer(), 12);
		await h.open("猫は暑いか。\n".repeat(20));
		await h.apply(["鳥美しい。猫は高い。暑い。"]);
		const { word, menu, geometry } = open(h, "暑い", { left: 120, top: 200 });
		const revision = h.controller().getDisplayRevision();
		expect(await h.view.loadNextSection()).toBe("applied");
		// Load next only appends: the revision, the word and so the menu stay, and it keeps following the word.
		expect(h.controller().getDisplayRevision()).toBe(revision);
		expect(menuOf(h.view)).toBe(menu);
		expect(h.root().contains(word)).toBe(true);
		geometry.move(150, 260);
		scrollOf(h.view).dispatchEvent(new Event("scroll"));
		expect([px(menu.style.left), px(menu.style.top)]).toEqual([150, 280 + OVERLAY_GAP]);
	});

	it("keeps two Views' menus in their own roots", async () => {
		const a = await ready(), b = await ready();
		const ma = open(a, "暑い", { left: 120, top: 200 }).menu;
		const mb = open(b, "高い", { left: 50, top: 300 }).menu;
		expect(ma.parentElement).toBe(rootOf(a.view));
		expect(mb.parentElement).toBe(rootOf(b.view));
		expect(menuOf(a.view)).toBe(ma);
		expect(px(mb.style.left)).toBe(50);
	});
});

describe("UX-12 affordance only where the View would act", () => {
	it("marks what each word offers, independent of marker visibility, and nothing else", async () => {
		const h = await ready();
		const tokens = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token"));
		expect(tokens.length).toBeGreaterThan(0);
		for (const el of tokens) {
			const slot = h.controller().getSlotForElement(el)!;
			expect(el.classList.contains("semantropy-manual-operable")).toBe(slot.manualEligible);
			expect(el.classList.contains("semantropy-dictionary-operable")).toBe(slot.dictionaryAvailable);
		}
		expect(h.root().querySelectorAll(".semantropy-manual-operable").length).toBeGreaterThan(0);
		// Operable words never gain a tab stop, attribute or listener of their own.
		for (const el of tokens) expect(Array.from(el.attributes).map(a => a.name)).toEqual(["class"]);
	});

	it("turns the View-wide affordance off while busy or closed, and the dictionary one while stale", async () => {
		const h = await ready();
		const body = bodyOf(h.view);
		expect(body.classList.contains("is-manual-live")).toBe(true);
		expect(body.classList.contains("is-dictionary-live")).toBe(true);
		const lifecycle = Reflect.get(h.view, "lifecycle") as { busy: { acquire: () => number | null; release: (token: number) => void } };
		const token = lifecycle.busy.acquire()!;
		(Reflect.get(h.view, "syncActionControls") as () => void).call(h.view);
		expect(body.classList.contains("is-manual-live")).toBe(false);
		expect(body.classList.contains("is-dictionary-live")).toBe(false);
		lifecycle.busy.release(token);
		(Reflect.get(h.view, "syncActionControls") as () => void).call(h.view);
		expect(body.classList.contains("is-manual-live")).toBe(true);
		h.view.notifyVocabularySourceEvent("source0.md");
		expect(body.classList.contains("is-dictionary-live")).toBe(false);
		expect(body.classList.contains("is-manual-live")).toBe(true);
		await h.view.onClose();
		expect(body.classList.contains("is-manual-live") && body.isConnected).toBe(false);
	});

	it("never marks a dictionary-only word as clickable, and a click there opens nothing", async () => {
		const h = manualMorphHarness(lexiconTokenizer([token({ surface: "三", detail1: "数" }), token({ surface: "五", detail1: "数" }),
			token({ surface: "猫" }), token({ surface: "犬" }), suffix("と", "助詞", "並立助詞")]));
		await h.open("猫と三。\n");
		await h.apply(["犬と五。"]);
		const numeral = wordEl(h, "三");
		const slot = h.controller().getSlotForElement(numeral)!;
		expect([slot.manualEligible, slot.dictionaryAvailable]).toEqual([false, true]);
		expect(numeral.classList.contains("semantropy-dictionary-operable")).toBe(true);
		expect(numeral.classList.contains("semantropy-manual-operable")).toBe(false);
		click(numeral);
		expect(menuOf(h.view)).toBeNull();
		expect(wordEl(h, "猫").classList.contains("semantropy-manual-operable")).toBe(true);
	});

	it("is live straight after a plain open, before any other chrome update", async () => {
		// The shell is drawn before the body joins it; the affordance must follow the attach.
		const h = manualMorphHarness(tokenizer());
		await h.open("猫は暑いか。\n");
		const body = bodyOf(h.view);
		expect(h.root().isConnected).toBe(true);
		expect(body.classList.contains("is-manual-live")).toBe(true);
		expect(body.classList.contains("is-dictionary-live")).toBe(true);
	});

	it("follows every busy transition of either gate, and only real transitions", async () => {
		const { BusyGate } = await import("../src/view/busyGate");
		const gate = new BusyGate(), calls: boolean[] = [];
		gate.onChange(() => calls.push(gate.isBusy()));
		const token = gate.acquire()!;
		expect(gate.acquire()).toBeNull();
		expect(gate.release(token + 1)).toBe(false);
		expect(gate.release(token)).toBe(true);
		gate.revoke();
		gate.acquire(); gate.revoke();
		expect(calls).toEqual([true, false, true, false]);
	});

	it("builds nothing for an unloaded Chunk", async () => {
		const h = manualMorphHarness(tokenizer(), 12);
		await h.open("猫は暑いか。\n".repeat(20));
		const stats = h.controller().getChunkStats();
		expect(stats.chunks).toBeLessThan(stats.totalChunks);
		const operable = h.root().querySelectorAll(".semantropy-manual-operable, .semantropy-dictionary-operable").length;
		expect(operable).toBeLessThanOrEqual(h.root().querySelectorAll(".semantropy-token").length);
		expect(h.root().textContent.length).toBeLessThan("猫は暑いか。\n".repeat(20).length);
	});
});

describe("UX-10 / UX-12 stylesheet contract", () => {
	const css = readFileSync("styles.css", "utf8");
	const rule = (selector: string) => {
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
	};
	it("softens marker backgrounds and lines only, never the text", () => {
		for (const selector of [".semantropy-body .semantropy-replaced", ".semantropy-body .semantropy-manual-available", ".semantropy-body .semantropy-dictionary-available"]) {
			const body = rule(selector);
			expect(body, selector).not.toBeNull();
			expect(body).toMatch(/color-mix\(in srgb, var\(--[a-z-]+\) \d+%, transparent\)/);
			expect(body).not.toMatch(/(?:^|[;\s])(?:opacity|color|filter)\s*:/);
		}
		// Each marker keeps its own shape, so none depends on colour alone.
		expect(rule(".semantropy-body .semantropy-manual-available")).toMatch(/dashed/);
		expect(rule(".semantropy-body .semantropy-dictionary-available")).toMatch(/dotted/);
	});
	it("gives the pointer only through the View's live state", () => {
		const rules = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).map(([, selector, body]) => ({ selector: selector!.replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: body! }));
		const tokenCursors = rules.filter(r => /semantropy-(?:token|manual-operable|dictionary-operable|manual-available|dictionary-available|replaced)/.test(r.selector) && /cursor\s*:/.test(r.body));
		expect(tokenCursors.map(r => r.selector)).toEqual([
			".semantropy-body.is-manual-live .semantropy-manual-operable",
			".semantropy-body.is-dictionary-live .semantropy-dictionary-operable:not(.semantropy-manual-operable)",
		]);
		expect(tokenCursors.map(r => r.body.trim())).toEqual(["cursor: pointer;", "cursor: help;"]);
	});
});
