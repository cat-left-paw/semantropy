// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, peekMorph } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { planToolbarOverflow } from "../src/view/toolbarOverflow";
import { TOOLBAR_CONTROLS, type SemantropyToolbar } from "../src/view/SemantropyToolbar";
import type { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import type { SemantropyView } from "../src/view/SemantropyView";

/*
 * PRE-RELEASE-EXPERIENCE-CONTROLS1 focused regressions (revised to the owner's UI policy):
 *   UX-02 one row of icon-only Toolbar controls; a short name is the aria-label and the one
 *         tooltip, a longer text is an aria-describedby description, never a title; the Text
 *         level, Automatic parts of speech, font and size sit behind popups; items that do not
 *         fit move — the same elements — into a reachable More menu;
 *   UX-13 the Fake Dictionary puts three icon-only actions and the level select in one tool
 *         group beside the headword, with no visible "Dictionary:" label.
 * jsdom has no layout: the overflow rule is a pure function tested here with numbers, and the DOM
 * move is driven with stubbed widths. Real layout is measured separately in Chromium.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
const live: ReturnType<typeof manualMorphHarness>[] = [];
afterEach(async () => { for (const h of live.splice(0)) await h.view.onClose(); vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

const lexicon = () => lexiconTokenizer([
	token({ surface: "猫", baseForm: "猫", reading: "ネコ" }), token({ surface: "犬", baseForm: "犬", reading: "イヌ" }),
	token({ surface: "鳥", baseForm: "鳥", reading: undefined }), token({ surface: "港", detail1: "固有名詞", detail2: "地域" }),
	token({ surface: "研究", detail1: "サ変接続" }),
]);
async function harness(text = "猫犬鳥港研究。") {
	const h = manualMorphHarness(lexicon(), 5000); live.push(h); await h.open(text); return h;
}
type H = Awaited<ReturnType<typeof harness>>;
const shell = (view: SemantropyView) => peekMorph(view).contentEl;
const toolbarOf = (view: SemantropyView) => Reflect.get(view, "toolbar") as SemantropyToolbar;
const popover = (h: H) => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
const wait = (ms = 145) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
async function hover(h: H) {
	const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(e => h.controller().getSlotForElement(e) === h.current("猫"))!;
	el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, altKey: true }));
	await wait(); expect(popover(h).isOpen()).toBe(true);
	return document.querySelector<HTMLElement>(".semantropy-dictionary-popover")!;
}
/** Tab stops: focusable controls not inside a hidden subtree. */
function tabStops(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>("button, select, input")).filter(el =>
		!(el as HTMLButtonElement).disabled && !el.closest("[hidden]") && el.tabIndex >= 0);
}
/** Controls on screen in DOM order, disabled ones included (not inside a hidden subtree). */
function visibleControls(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>("button, select, input")).filter(el => !el.hidden && !el.closest("[hidden]"));
}
/** The text of every element an `aria-describedby` names. */
function descriptionOf(control: Element): string | null {
	const ids = (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
	return ids.length ? ids.map(id => control.ownerDocument.getElementById(id)?.textContent ?? "").join(" ") : null;
}
const ROW_NAMES = [
	"Reshuffle text", "Refresh target", "Copy selection", "Collect selection",
	"Change vocabulary", "Collision", "Fake proverb", "Recompose",
	"Text semantropy level", "Automatic parts of speech", "Display settings",
];
const ROW: readonly [string, keyof typeof TOOLBAR_CONTROLS][] = [
	[".semantropy-reshuffle", "reshuffle"], [".semantropy-refresh", "refresh"],
	[".semantropy-copy", "copy"], [".semantropy-collect", "collect"],
	[".semantropy-level-button", "level"], [".semantropy-automatic-pos-toolbar > button", "automatic"],
	[".semantropy-vocabulary-open", "vocabulary"], [".semantropy-collision-open", "collision"],
	[".semantropy-fake-proverb-open", "fakeProverb"], [".semantropy-display-menu-button", "display"],
	[".semantropy-more-button", "more"],
];

describe("UX-02 one row of icon-only controls", () => {
	it("gives every control an Obsidian icon, a short name as its only tooltip, a description, and no title", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		const names = new Set<string>();
		for (const [selector, key] of ROW) {
			const button = toolbar.querySelector<HTMLButtonElement>(selector)!;
			expect(button, selector).not.toBeNull();
			const control = TOOLBAR_CONTROLS[key];
			expect(button.classList.contains("is-toolbar-icon"), selector).toBe(true);
			expect(button.querySelector(":scope > .semantropy-icon svg")?.getAttribute("class"), selector).toBe(`svg-icon lucide-${control.icon}`);
			expect(button.querySelector(":scope > .semantropy-icon")?.getAttribute("aria-hidden"), selector).toBe("true");
			expect(button.getAttribute("aria-label"), selector).toBe(control.name);
			// The hidden label carries the same name; it is shown only inside the More menu.
			expect(button.querySelector(":scope > .semantropy-action-label")?.textContent, selector).toBe(control.name);
			expect(descriptionOf(button)?.startsWith(control.description), selector).toBe(true);
			expect(button.hasAttribute("title"), selector).toBe(false);
			names.add(control.name);
		}
		expect(names.size).toBe(ROW.length);
		expect(shell(h.view).querySelectorAll("[title]")).toHaveLength(0);
		// Short names, and a description that adds to the name instead of repeating it.
		for (const control of Object.values(TOOLBAR_CONTROLS)) {
			expect(control.name.length).toBeLessThanOrEqual(26);
			expect(control.description.toLowerCase().startsWith(control.name.toLowerCase())).toBe(false);
		}
	});

	it("never makes Reshuffle, Refresh and the Vocabulary update look alike", () => {
		const { reshuffle, refresh, vocabulary } = TOOLBAR_CONTROLS;
		expect(new Set([reshuffle.icon, refresh.icon, vocabulary.icon]).size).toBe(3);
		expect(new Set([reshuffle.name, refresh.name, vocabulary.name]).size).toBe(3);
	});

	it("keeps selects and text out of the row: level, font and size sit behind popups, status reads the level", async () => {
		const h = await harness();
		const content = shell(h.view);
		const toolbar = content.querySelector<HTMLElement>(".semantropy-toolbar")!;
		const row = visibleControls(toolbar);
		expect(row.every(el => el.tagName === "BUTTON" && el.classList.contains("is-toolbar-icon"))).toBe(true);
		expect(row.map(el => el.getAttribute("aria-label"))).toEqual(ROW_NAMES);
		expect(toolbar.querySelector(".semantropy-level-select")!.closest(".semantropy-level-popup")).not.toBeNull();
		for (const selector of [".semantropy-font-family", ".semantropy-font-size"]) {
			expect(toolbar.querySelector(selector)!.closest(".semantropy-display-menu"), selector).not.toBeNull();
		}
		expect(content.querySelector(".semantropy-status .semantropy-level-status")!.textContent).toMatch(/^Text Semantropy: /u);
		expect(content.querySelector(".semantropy-status .semantropy-vocabulary-status")!.textContent).toMatch(/^Vocabulary: /u);
		const css = readFileSync("styles.css", "utf8");
		expect(css).toMatch(/\.semantropy-toolbar \.is-toolbar-icon \.semantropy-action-label \{\s*display: none;/u);
	});

	it("opens the level popup, keeps it out of the Tab order when closed, and returns focus on Escape", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		const button = toolbar.querySelector<HTMLButtonElement>(".semantropy-level-button")!;
		const popup = toolbar.querySelector<HTMLElement>(".semantropy-level-popup")!;
		expect([button.getAttribute("aria-expanded"), button.getAttribute("aria-controls"), popup.hidden]).toEqual(["false", popup.id, true]);
		expect(tabStops(toolbar).some(el => popup.contains(el))).toBe(false);
		button.click();
		expect([button.getAttribute("aria-expanded"), popup.hidden]).toEqual(["true", false]);
		expect(document.activeElement).toBe(popup.querySelector(".semantropy-level-select"));
		key(document.activeElement!, "Escape");
		expect([button.getAttribute("aria-expanded"), popup.hidden, document.activeElement]).toEqual(["false", true, button]);
		// One popup at a time; an outside click closes it without being swallowed.
		button.click();
		toolbar.querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!.click();
		expect(popup.hidden).toBe(true);
		const menu = toolbar.querySelector<HTMLElement>(".semantropy-display-menu")!;
		expect(menu.hidden).toBe(false);
		const outside = new Event("pointerdown", { bubbles: true, cancelable: true });
		document.body.dispatchEvent(outside);
		expect(menu.hidden).toBe(true);
		expect(outside.defaultPrevented).toBe(false);
	});

	it("keeps disabled and busy states on the icon buttons", async () => {
		const h = await harness();
		const refresh = shell(h.view).querySelector<HTMLButtonElement>(".semantropy-refresh")!;
		const lifecycle = Reflect.get(h.view, "lifecycle") as { busy: { acquire: () => number | null; release: (t: number) => void } };
		const ticket = lifecycle.busy.acquire()!;
		(Reflect.get(h.view, "syncActionControls") as () => void).call(h.view);
		expect(refresh.disabled).toBe(true);
		lifecycle.busy.release(ticket);
		(Reflect.get(h.view, "syncActionControls") as () => void).call(h.view);
		expect(refresh.disabled).toBe(false);
		expect(refresh.querySelector(".semantropy-icon")).not.toBeNull();
	});

	it("gives each open View its own popup and description ids, each resolving inside that View", async () => {
		const a = await harness(), b = await harness();
		const ids = (h: H) => Array.from(shell(h.view).querySelectorAll<HTMLElement>(".semantropy-toolbar [id]")).map(el => el.id);
		const first = ids(a), second = ids(b);
		expect(first.length).toBeGreaterThan(10);
		expect(new Set(first).size).toBe(first.length);
		expect(first.filter(id => second.includes(id))).toEqual([]);
		for (const h of [a, b]) {
			for (const el of Array.from(shell(h.view).querySelectorAll<HTMLElement>(".semantropy-toolbar [aria-describedby], .semantropy-toolbar [aria-controls]"))) {
				for (const id of `${el.getAttribute("aria-describedby") ?? ""} ${el.getAttribute("aria-controls") ?? ""}`.split(" ").filter(Boolean)) {
					expect(shell(h.view).querySelector(`#${id}`), id).not.toBeNull();
				}
			}
		}
	});
});

describe("UX-02 the row never wraps: planToolbarOverflow", () => {
	const items = (visible = true) => [
		{ group: 0, width: 32, rank: 1, visible }, { group: 0, width: 32, rank: 2, visible },
		{ group: 1, width: 32, rank: 5, visible }, { group: 1, width: 32, rank: 7, visible },
		{ group: 2, width: 32, rank: 9, visible }, { group: 2, width: 32, rank: 10, visible },
	];
	const plan = (available: number, list = items()) => planToolbarOverflow({ available, groupGap: 8, itemGap: 4, moreWidth: 32, items: list });
	it("keeps everything in the row when it fits, without a More button", () => {
		// 3 groups of 2: 3 × 68 + 2 × 8 = 220.
		expect(plan(220)).toEqual([]);
	});
	it("moves the highest ranks first and makes room for More", () => {
		// 219: drop group 2 (ranks 10, 9) and add More: 68 + 68 + 32 + 2 × 8 = 184.
		expect(plan(219)).toEqual([4, 5]);
		// 180: rank 7 goes too: 68 + 32 + 32 + 2 × 8 = 148.
		expect(plan(180)).toEqual([3, 4, 5]);
	});
	it("can move every item, leaving a reachable More button", () => {
		expect(plan(40)).toEqual([0, 1, 2, 3, 4, 5]);
	});
	it("ignores hidden items", () => {
		expect(plan(0, items(false))).toEqual([]);
	});
});

describe("UX-02 the More menu holds the same controls", () => {
	/** Stubs layout: each item and More 32px wide, the row `width` px. */
	function layout(toolbar: HTMLElement, width: number) {
		Object.defineProperty(toolbar, "clientWidth", { configurable: true, get: () => width });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const w = this.classList.contains("semantropy-toolbar-item") || this.classList.contains("semantropy-toolbar-more") ? 32 : 0;
			return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 32, width: w, height: 32, toJSON: () => ({}) };
		});
	}
	it("moves low-priority items into More, keeps one focus stop each, and brings them back", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		const more = toolbar.querySelector<HTMLElement>(".semantropy-toolbar-more")!;
		const moreButton = toolbar.querySelector<HTMLButtonElement>(".semantropy-more-button")!;
		const panel = toolbar.querySelector<HTMLElement>(".semantropy-more-menu")!;
		const collision = toolbar.querySelector<HTMLButtonElement>(".semantropy-collision-open")!;
		const display = toolbar.querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!;
		const home = collision.parentElement!.parentElement!;
		expect(more.hidden).toBe(true);
		layout(toolbar, 200);
		toolbarOf(h.view).refreshLayout();
		expect(more.hidden).toBe(false);
		expect([panel.contains(collision), panel.contains(display)]).toEqual([true, true]);
		// The same element, not a copy: one instance, one focus stop.
		expect(toolbar.querySelectorAll(".semantropy-collision-open")).toHaveLength(1);
		expect(tabStops(toolbar)).toContain(moreButton);
		expect(tabStops(toolbar)).not.toContain(collision);
		expect(visibleControls(toolbar).filter(el => el.classList.contains("semantropy-reshuffle"))).toHaveLength(1);
		// Open More: the moved controls are reachable and named.
		moreButton.click();
		expect([moreButton.getAttribute("aria-expanded"), panel.hidden]).toEqual(["true", false]);
		expect(tabStops(toolbar)).toContain(collision);
		// A popup inside More opens in place, and Escape closes only it.
		display.click();
		const menu = panel.querySelector<HTMLElement>(".semantropy-display-menu")!;
		expect([menu.hidden, panel.hidden]).toEqual([false, false]);
		key(menu, "Escape");
		expect([menu.hidden, panel.hidden, document.activeElement]).toEqual([true, false, display]);
		key(panel, "Escape");
		expect([panel.hidden, document.activeElement]).toEqual([true, moreButton]);
		// A Modal opened from More returns focus to the More button, not to a hidden control.
		expect(toolbarOf(h.view).returnTarget(collision)).toBe(moreButton);
		// Wide again: everything returns home in its order, More disappears.
		layout(toolbar, 2000);
		toolbarOf(h.view).refreshLayout();
		expect(more.hidden).toBe(true);
		expect(home.contains(collision)).toBe(true);
		expect(visibleControls(toolbar).map(el => el.getAttribute("aria-label"))).toEqual(ROW_NAMES);
		expect(toolbarOf(h.view).returnTarget(collision)).toBe(collision);
	});
	it("gives focus to More when the focused control moves into it", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		const fake = toolbar.querySelector<HTMLButtonElement>(".semantropy-fake-proverb-open")!;
		fake.focus();
		layout(toolbar, 300);
		// Obsidian's leaf-resize callback re-plans the row (a ResizeObserver does too, where one runs).
		h.view.onResize();
		expect(toolbar.querySelector(".semantropy-more-menu")!.contains(fake)).toBe(true);
		expect(document.activeElement).toBe(toolbar.querySelector(".semantropy-more-button"));
	});
	it("returns a Modal's focus to More when it was opened from there", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		layout(toolbar, 200);
		toolbarOf(h.view).refreshLayout();
		const moreButton = toolbar.querySelector<HTMLButtonElement>(".semantropy-more-button")!;
		moreButton.click();
		const fake = toolbar.querySelector<HTMLButtonElement>(".semantropy-fake-proverb-open")!;
		fake.focus();
		const origin = (Reflect.get(h.view, "modalOrigin") as () => HTMLElement | null).call(h.view);
		expect(toolbar.querySelector<HTMLElement>(".semantropy-more-menu")!.hidden).toBe(true);
		expect(origin).toBe(moreButton);
	});
});

describe("UX-02 Automatic parts of speech is part of the one popup model (review 1 P2)", () => {
	function layout(toolbar: HTMLElement, width: number) {
		Object.defineProperty(toolbar, "clientWidth", { configurable: true, get: () => width });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const w = this.classList.contains("semantropy-toolbar-item") || this.classList.contains("semantropy-toolbar-more") ? 32 : 0;
			return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 32, width: w, height: 32, toJSON: () => ({}) };
		});
	}
	type AutomaticState = { status: string; draft: { verb: boolean } | null };
	const automaticState = (view: SemantropyView) =>
		(Reflect.get(view, "automaticController") as { read: () => AutomaticState }).read();
	async function inMore() {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		layout(toolbar, 200);
		h.view.onResize();
		const panel = toolbar.querySelector<HTMLElement>(".semantropy-more-menu")!;
		const moreButton = toolbar.querySelector<HTMLButtonElement>(".semantropy-more-button")!;
		const toggle = toolbar.querySelector<HTMLButtonElement>(".semantropy-automatic-pos-toolbar > button")!;
		const menu = toolbar.querySelector<HTMLElement>(".semantropy-automatic-pos-menu")!;
		expect(panel.contains(toggle)).toBe(true);
		moreButton.click();
		toggle.focus();
		toggle.click();
		expect([menu.hidden, toggle.getAttribute("aria-expanded"), automaticState(h.view).status]).toEqual([false, "true", "draft"]);
		// A draft change that closing must discard.
		menu.querySelector<HTMLInputElement>('input[aria-label="Verbs"]')!.click();
		expect(automaticState(h.view).draft?.verb).toBe(true);
		return { h, toolbar, panel, moreButton, toggle, menu };
	}

	it("closes only the Automatic menu on Escape inside More, keeping More open", async () => {
		const { h, panel, toggle, menu } = await inMore();
		const inside = menu.querySelector<HTMLInputElement>('input[aria-label="Verbs"]')!;
		inside.focus();
		key(inside, "Escape");
		expect([menu.hidden, toggle.getAttribute("aria-expanded")]).toEqual([true, "false"]);
		expect(panel.hidden).toBe(false);
		expect(document.activeElement).toBe(toggle);
		expect(automaticState(h.view).status).not.toBe("draft");
	});

	it("closes the Automatic menu and discards its draft when More is closed from the keyboard", async () => {
		const { h, panel, moreButton, toggle, menu } = await inMore();
		// Escape on a More item outside the Automatic menu closes More, and the menu inside it.
		const collision = panel.querySelector<HTMLButtonElement>(".semantropy-collision-open")!;
		collision.focus();
		key(collision, "Escape");
		expect([panel.hidden, menu.hidden, toggle.getAttribute("aria-expanded")]).toEqual([true, true, "false"]);
		expect(automaticState(h.view).status).not.toBe("draft");
		expect(document.activeElement).toBe(moreButton);
		// Reopening starts from the effective options, not the abandoned draft.
		moreButton.click();
		toggle.click();
		expect(menu.querySelector<HTMLInputElement>('input[aria-label="Verbs"]')!.checked).toBe(false);
	});

	it("closes the Automatic menu and its draft when the More button's Escape closes More", async () => {
		const { h, panel, moreButton, menu } = await inMore();
		moreButton.focus();
		key(moreButton, "Escape");
		expect([panel.hidden, menu.hidden]).toEqual([true, true]);
		expect(automaticState(h.view).status).not.toBe("draft");
	});

	it("closes the Automatic menu when another popup is opened from the keyboard", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		const toggle = toolbar.querySelector<HTMLButtonElement>(".semantropy-automatic-pos-toolbar > button")!;
		const menu = toolbar.querySelector<HTMLElement>(".semantropy-automatic-pos-menu")!;
		toggle.click();
		expect(menu.hidden).toBe(false);
		// Enter / Space on a button is a click with no pointerdown before it.
		toolbar.querySelector<HTMLButtonElement>(".semantropy-level-button")!.click();
		expect([menu.hidden, toggle.getAttribute("aria-expanded"), automaticState(h.view).status === "draft"]).toEqual([true, "false", false]);
	});
});

describe("UX-02 a remounted Automatic presenter leaves nothing behind (re-review 2 P2)", () => {
	setFlagsFromString("--expose_gc");
	const gc = runInNewContext("gc") as () => void;
	const tick = () => new Promise(resolve => setTimeout(resolve, 0));
	async function collected(ref: WeakRef<object>): Promise<boolean> {
		for (let attempt = 0; attempt < 10; attempt++) {
			await tick(); gc(); await tick();
			if (ref.deref() === undefined) return true;
		}
		return false;
	}
	const remount = (h: H) => (Reflect.get(h.view, "mountAutomatic") as (parent: HTMLElement) => void).call(h.view, toolbarOf(h.view).automaticHost);

	it("keeps the Toolbar's listener and popup counts flat over repeated remounts", async () => {
		const h = await harness();
		const toolbar = toolbarOf(h.view);
		const counts = () => [
			(Reflect.get(toolbar, "handlers") as unknown[]).length,
			(Reflect.get(toolbar, "automaticHandlers") as unknown[]).length,
			(Reflect.get(toolbar, "popups") as unknown[]).length,
		];
		remount(h);
		const first = counts();
		for (let i = 0; i < 25; i++) remount(h);
		expect(counts()).toEqual(first);
		// The current presenter is still the one the Toolbar closes through.
		const toggle = shell(h.view).querySelector<HTMLButtonElement>(".semantropy-automatic-pos-toolbar > button")!;
		const menu = shell(h.view).querySelector<HTMLElement>(".semantropy-automatic-pos-menu")!;
		toggle.click();
		expect(menu.hidden).toBe(false);
		key(menu, "Escape");
		expect([menu.hidden, document.activeElement]).toEqual([true, toggle]);
		expect(shell(h.view).querySelectorAll(".semantropy-automatic-pos-toolbar")).toHaveLength(1);
	});

	it("lets earlier presenters, controllers, toggles and menus be collected while the View lives", async () => {
		const h = await harness();
		const refs = (() => {
			const presenter = Reflect.get(h.view, "automaticToolbar") as object;
			const controller = Reflect.get(h.view, "automaticController") as object;
			const toggle = shell(h.view).querySelector(".semantropy-automatic-pos-toolbar > button")!;
			const menu = shell(h.view).querySelector(".semantropy-automatic-pos-menu")!;
			return [presenter, controller, toggle, menu].map(target => new WeakRef(target));
		})();
		for (let i = 0; i < 3; i++) remount(h);
		for (const ref of refs) expect(await collected(ref)).toBe(true);
		// Control: the current ones are held.
		expect(await collected(new WeakRef(Reflect.get(h.view, "automaticToolbar") as object))).toBe(false);
	});
});

describe("Toolbar display: category labels, no container chips, no large title", () => {
	const GROUPS = [
		["is-primary", "Text and fragment actions"], ["is-vocabulary", "Vocabulary"],
		["is-generation", "Phrase generation"], ["is-text", "Generation settings"], ["is-settings", "Settings"],
	] as const;

	it("removes the large SEMANTROPY heading; Obsidian's own view title is untouched", async () => {
		const h = await harness();
		expect(shell(h.view).querySelector("h1, .semantropy-title")).toBeNull();
		expect(shell(h.view).textContent).not.toContain("SEMANTROPY");
		expect(h.view.getDisplayText()).toBe("Semantropy");
	});

	it("names the Toolbar and each group by reference, and shows each category label above its icons", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		const byId = (id: string | null) => (id ? toolbar.ownerDocument.getElementById(id) : null);
		expect(toolbar.hasAttribute("aria-label")).toBe(false);
		expect(byId(toolbar.getAttribute("aria-labelledby"))?.textContent).toBe("Semantropy actions");
		expect(byId(toolbar.getAttribute("aria-labelledby"))?.closest(".semantropy-visually-hidden")).not.toBeNull();
		for (const [cls, name] of GROUPS) {
			const group = toolbar.querySelector<HTMLElement>(`.semantropy-toolbar-group.${cls}`)!;
			const [label, items] = Array.from(group.children) as HTMLElement[];
			expect([group.getAttribute("role"), group.hasAttribute("aria-label")], cls).toEqual(["group", false]);
			expect(label!.className, cls).toBe("semantropy-toolbar-group-label");
			expect(label!.textContent, cls).toBe(name);
			expect(group.getAttribute("aria-labelledby"), cls).toBe(label!.id);
			expect(items!.className, cls).toBe("semantropy-toolbar-items");
			expect(items!.querySelector("button.is-toolbar-icon"), cls).not.toBeNull();
		}
	});

	it("puts a chip only on controls: no container in the Toolbar carries an aria-label", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		const labelled = Array.from(toolbar.querySelectorAll<HTMLElement>("[aria-label]"));
		expect(labelled.length).toBeGreaterThan(10);
		expect(labelled.filter(el => !["BUTTON", "SELECT", "INPUT"].includes(el.tagName)).map(el => el.className)).toEqual([]);
		// The popups and the Automatic presenter's containers are named by their buttons.
		for (const selector of [".semantropy-level-popup", ".semantropy-display-menu", ".semantropy-more-menu", ".semantropy-automatic-pos-menu", ".semantropy-automatic-pos-toolbar"]) {
			const panel = toolbar.querySelector<HTMLElement>(selector)!;
			const owner = toolbar.ownerDocument.getElementById(panel.getAttribute("aria-labelledby") ?? "");
			expect(owner?.tagName, selector).toBe("BUTTON");
		}
	});

	it("names menu buttons by their visible text and keeps the longer text as a description", async () => {
		const h = await harness();
		const menu = shell(h.view).querySelector<HTMLElement>(".semantropy-display-menu")!;
		const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
		expect(buttons.length).toBeGreaterThan(5);
		for (const button of buttons) expect(button.getAttribute("aria-label"), button.textContent).toBe(button.textContent);
		const ruby = menu.querySelector<HTMLButtonElement>(".semantropy-toggle-showRuby")!;
		expect(descriptionOf(ruby)).toBe("Show ruby readings above the base text");
	});

	it("heads each category in the More menu, showing only categories with moved items", async () => {
		const h = await harness();
		const toolbar = shell(h.view).querySelector<HTMLElement>(".semantropy-toolbar")!;
		Object.defineProperty(toolbar, "clientWidth", { configurable: true, get: () => 200 });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const w = this.classList.contains("semantropy-toolbar-item") || this.classList.contains("semantropy-toolbar-more") ? 32 : 0;
			return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 32, width: w, height: 32, toJSON: () => ({}) };
		});
		h.view.onResize();
		const panel = toolbar.querySelector<HTMLElement>(".semantropy-more-menu")!;
		const shown = Array.from(panel.querySelectorAll<HTMLElement>(":scope > .semantropy-more-section")).filter(section => !section.hidden);
		expect(shown.length).toBeGreaterThan(1);
		for (const section of shown) {
			const heading = section.querySelector<HTMLElement>(":scope > .semantropy-more-heading")!;
			expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
			const group = GROUPS.find(([, name]) => name === heading.textContent);
			expect(group, heading.textContent).toBeDefined();
			// Every control under the heading belongs to that category.
			for (const control of Array.from(section.querySelectorAll<HTMLElement>(".semantropy-toolbar-item"))) {
				expect(control.closest(".semantropy-more-section")).toBe(section);
			}
		}
		expect(Array.from(panel.querySelectorAll(".semantropy-more-heading")).map(el => el.textContent)).toEqual(GROUPS.map(([, name]) => name));
		const generation = shown.find(section => section.querySelector(".semantropy-more-heading")!.textContent === "Phrase generation")!;
		expect(generation.querySelector(".semantropy-collision-open")).not.toBeNull();
		// A category emptied from the row takes no room there.
		expect(toolbar.querySelector<HTMLElement>(".semantropy-toolbar-group.is-generation")!.hidden).toBe(true);
	});

	it("counts a category label and its separator in the row width", () => {
		const items = [{ group: 0, width: 32, rank: 1, visible: true }, { group: 1, width: 32, rank: 2, visible: true }];
		const base = { groupGap: 8, itemGap: 4, moreWidth: 32, items };
		// 32 + 32 + 8 = 72 without labels; a 60px label and a 10px separator make it 60 + 32 + 10 + 8 = 110.
		expect(planToolbarOverflow({ ...base, available: 72 })).toEqual([]);
		expect(planToolbarOverflow({ ...base, available: 109, groups: [{ min: 60, extra: 0 }, { min: 0, extra: 10 }] })).toEqual([1]);
		expect(planToolbarOverflow({ ...base, available: 110, groups: [{ min: 60, extra: 0 }, { min: 0, extra: 10 }] })).toEqual([]);
	});

	it("separates categories quietly and drops their labels in a narrow pane", () => {
		const css = readFileSync("styles.css", "utf8");
		expect(css).toMatch(/\.semantropy-toolbar-group \+ \.semantropy-toolbar-group \{\s*padding-left: 0\.6rem;\s*border-left: 1px solid var\(--background-modifier-border\);/u);
		expect(css).toMatch(/\.semantropy-toolbar-group-label \{\s*color: var\(--text-muted\);\s*font-size: var\(--font-ui-smaller\);/u);
		expect(css).toMatch(/@container semantropy-view \(max-width: 32rem\) \{\s*\.semantropy-toolbar-group-label \{\s*display: none;/u);
		expect(css).not.toMatch(/\.semantropy-title\b/u);
	});
});

describe("UX-13 Fake Dictionary: headword at the top left, one tool group beside it", () => {
	const ACTIONS = [
		["semantropy-reshuffle-definition", "Reshuffle definition", "svg-icon lucide-shuffle"],
		["semantropy-copy-definition", "Copy headword and definition", "svg-icon lucide-copy"],
		["semantropy-collect-definition", "Collect headword and definition", "svg-icon lucide-inbox"],
	] as const;
	function layoutOf(root: HTMLElement) {
		const definition = root.querySelector<HTMLElement>(".semantropy-definition")!;
		const header = definition.querySelector<HTMLElement>(".semantropy-definition-header")!;
		const tools = header.querySelector<HTMLElement>(":scope > .semantropy-definition-tools")!;
		return {
			definition, header, tools,
			order: Array.from(definition.children).map(child => child.className),
			headerOrder: Array.from(header.children).map(child => child.className),
			toolOrder: Array.from(tools.children).map(child => child.className),
			actions: Array.from(tools.querySelectorAll<HTMLButtonElement>(".semantropy-definition-actions > button")),
			select: tools.querySelector<HTMLSelectElement>(":scope > select")!,
		};
	}
	function assertLayout(root: HTMLElement) {
		const layout = layoutOf(root);
		expect(layout.order).toEqual(["semantropy-definition-header", "semantropy-definition-body"]);
		expect(layout.headerOrder).toEqual(["semantropy-definition-heading", "semantropy-definition-tools"]);
		expect(layout.toolOrder).toEqual(["semantropy-definition-actions", "semantropy-level-select semantropy-dictionary-level-select"]);
		expect(layout.actions.map(button => [
			ACTIONS.find(([cls]) => button.classList.contains(cls))?.[1], button.getAttribute("aria-label"),
			button.querySelector(".semantropy-icon svg")?.getAttribute("class"), button.classList.contains("is-icon-only"), button.hasAttribute("title"),
		])).toEqual(ACTIONS.map(([, name, icon]) => [name, name, icon, true, false]));
		expect(layout.select.getAttribute("aria-label")).toBe("Fake dictionary semantropy level");
		// No visible "Dictionary:" label; DICTIONARY-LEVEL1 removed Off from the levels.
		expect(layout.definition.textContent).not.toContain("Dictionary:");
		expect(layout.definition.querySelector("label")).toBeNull();
		expect(Array.from(layout.select.options).map(option => option.value)).toEqual(["25", "50", "75", "100"]);
		return layout;
	}

	it("lays out the Popover and keeps its title and dialog name", async () => {
		const h = await harness();
		const panel = await hover(h);
		assertLayout(panel);
		expect(panel.querySelector(".semantropy-definition-headword")!.textContent).toBe("猫");
		expect(panel.getAttribute("aria-label")).toBe("Fake Dictionary");
		expect(panel.querySelectorAll("[title]")).toHaveLength(0);
	});

	it("gives the Modal the same structure, names and enabled state as the Popover", async () => {
		const h = await harness();
		const panel = await hover(h);
		const state = (root: HTMLElement) => { const layout = layoutOf(root); return [...layout.actions.map(b => b.disabled), layout.select.disabled, layout.select.value]; };
		const popoverState = state(panel);
		popover(h).close();
		const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(e => h.controller().getSlotForElement(e) === h.current("猫"))!;
		const range = document.createRange(); range.selectNodeContents(el);
		document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
		expect(await h.view.defineSelectedWord({ issueSeed: () => 11 })).toBe("ready");
		const modal = document.querySelector<HTMLElement>(".semantropy-definition")!.parentElement!;
		assertLayout(modal);
		expect(state(modal)).toEqual(popoverState);
	});

	it("DICTIONARY-LEVEL1: a host Off reads as Medium, so the actions stay usable and 0 is never offered", async () => {
		const h = await harness();
		h.host.getDictionarySemantropy = () => 0 as never;
		const panel = await hover(h);
		const { actions, select } = layoutOf(panel);
		expect(actions.map(button => button.disabled)).toEqual([false, false, false]);
		expect(select.value).toBe("50");
		expect(Array.from(select.options).map(option => option.value)).not.toContain("0");
		// A select forced to 0 is not a level: nothing changes and nothing is saved.
		const option = select.ownerDocument.createElement("option");
		option.value = "0"; select.appendChild(option); select.value = "0";
		select.dispatchEvent(new Event("change"));
		await wait(10);
		expect(select.value).toBe("50");
		expect(h.calls.copy).toEqual([]);
	});

	it("still writes the headword and definition from the icon-only Copy and Collect", async () => {
		const h = await harness();
		const panel = await hover(h);
		const [, copy, collect] = layoutOf(panel).actions;
		copy!.click(); await wait(10);
		collect!.click(); await wait(10);
		const text = `${panel.querySelector(".semantropy-definition-headword")!.textContent}\n${panel.querySelector(".semantropy-definition-text")!.textContent}`;
		expect(h.calls.copy).toEqual([text]);
		expect(h.calls.collect.map(input => input.text)).toEqual([text]);
	});

	it("keeps keyboard entry: focus moves to the first enabled tool; Escape returns it", async () => {
		const h = await harness();
		await hover(h);
		const target = popover(h).getTarget()!;
		popover(h).close();
		const origin = shell(h.view).querySelector<HTMLButtonElement>(".semantropy-copy")!;
		origin.focus();
		popover(h).open(target, origin);
		await wait(20);
		const panel = document.querySelector<HTMLElement>(".semantropy-dictionary-popover")!;
		expect(document.activeElement).toBe(panel.querySelector(".semantropy-reshuffle-definition"));
		key(document.activeElement!, "Escape");
		expect(popover(h).isOpen()).toBe(false);
		expect(document.activeElement).toBe(origin);
	});
});

describe("UX-02 / UX-13 stylesheet contract", () => {
	const css = readFileSync("styles.css", "utf8");
	const rule = (selector: string) => {
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
	};
	it("keeps the row on one line with 2rem icon targets, and names shown only in More", () => {
		expect(rule(".semantropy-toolbar")).toMatch(/flex-wrap:\s*nowrap/);
		expect(rule(".semantropy-toolbar-items")).toMatch(/flex-wrap:\s*nowrap/);
		expect(rule(".semantropy-toolbar .semantropy-action.is-toolbar-icon")).toMatch(/width:\s*2rem;[\s\S]*min-width:\s*2rem/);
		expect(rule(".semantropy-toolbar .semantropy-more-menu .is-toolbar-icon .semantropy-action-label")).toMatch(/display:\s*inline/);
		expect(rule(".semantropy-toolbar-popup")).toMatch(/max-width:\s*100%/);
		expect(rule(".semantropy-visually-hidden")).toMatch(/clip-path:\s*inset\(50%\)/);
		// Found in Chromium: a side margin made a stretched popup overflow the More menu.
		expect(rule(".semantropy-more-menu .semantropy-toolbar-popup")).toMatch(/margin:\s*0\.25rem 0;/);
	});
	it("wraps the Fake Dictionary tool group as one unit and keeps text at the reader's size", () => {
		expect(rule(".semantropy-definition-header")).toMatch(/flex-wrap:\s*wrap/);
		expect(rule(".semantropy-definition-heading")).toMatch(/flex:\s*1 1 auto;[\s\S]*min-width:\s*0/);
		expect(rule(".semantropy-definition-tools")).toMatch(/flex-wrap:\s*wrap;[\s\S]*margin-left:\s*auto/);
		expect(rule(".semantropy-definition-actions .is-icon-only .semantropy-action-label")).toMatch(/display:\s*none/);
		expect(rule(".semantropy-definition-headword")).toMatch(/font-size:\s*calc\(var\(--font-text-size, 16px\) \* 1\.3\)/);
		expect(rule(".semantropy-definition-body")).toMatch(/font-size:\s*var\(--font-text-size, 16px\)/);
		expect(css).not.toMatch(/\btitle\s*=/);
	});
});
