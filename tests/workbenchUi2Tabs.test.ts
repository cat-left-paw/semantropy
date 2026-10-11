// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { COPY_EMPTY_SELECTION_MESSAGE } from "../src/copy/copyMessages";
import { COLLECT_EMPTY_SELECTION_MESSAGE } from "../src/collect/collectMessages";
import { DEFINE_EMPTY_SELECTION_MESSAGE } from "../src/application/fakeDictionaryMessages";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { AutomaticPosCoordinator } from "../src/application/AutomaticPosCoordinator";
import type { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import type { DisplaySlot } from "../src/analysis/displaySlots";

/**
 * WORKBENCH-UI2 stage 2 (`Docs/release_0_2_0_plan.md` §3.3, §3.4): a host flag
 * that splits the body area into [Shuffle] [Recompose] tabs. The one scrolling
 * box holds both panes as siblings; the hidden one keeps its scroll position,
 * and while the Recompose pane is shown nothing reads or acts on the hidden
 * Shuffle selection. Off (the default, and always on the web page) builds the
 * shell exactly as before.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const LEXICON = [token({ surface: "猫", reading: "ネコ" }), token({ surface: "犬", reading: "イヌ" }), token({ surface: "鳥" }), token({ surface: "港", detail1: "固有名詞", detail2: "地域" })];
const TARGET = "猫と犬。\n鳥と港。\n".repeat(6);
const OTHER = "犬と鳥。\n港と猫。\n".repeat(6);

type Flags = { tabs?: boolean; recomposeDialog?: boolean; defer?: boolean };
type Harness = ReturnType<typeof manualMorphHarness> & { notices: string[] };
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(flags: Flags = { tabs: true }, level = 100, size = 12): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), size);
	h.state.level = assertBodySemantropy(level);
	if (flags.tabs !== undefined) h.host.workbenchTabs = flags.tabs;
	if (flags.recomposeDialog !== undefined) h.host.recomposeDialog = flags.recomposeDialog;
	if (flags.defer !== undefined) h.host.deferInitialShuffle = flags.defer;
	const notices: string[] = [];
	h.host.showNotice = message => { notices.push(message); };
	const result = Object.assign(h, { notices });
	opened.push(result);
	return result;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const scroll = (h: Harness) => q(h, ".semantropy-scroll")!;
const tab = (h: Harness, name: "shuffle" | "recompose") => q<HTMLButtonElement>(h, `.semantropy-tab-${name}`)!;
const pane = (h: Harness, name: "shuffle" | "recompose") => q(h, `.semantropy-${name}-pane`)!;
const shown = (h: Harness) => ({ shuffle: !pane(h, "shuffle").hidden, recompose: !pane(h, "recompose").hidden,
	selected: [tab(h, "shuffle").getAttribute("aria-selected"), tab(h, "recompose").getAttribute("aria-selected")],
	stops: [tab(h, "shuffle").tabIndex, tab(h, "recompose").tabIndex] });
const ON_SHUFFLE = { shuffle: true, recompose: false, selected: ["true", "false"], stops: [0, -1] };
const ON_RECOMPOSE = { shuffle: false, recompose: true, selected: ["false", "true"], stops: [-1, 0] };
const key = (target: Element, value: string, init: KeyboardEventInit = {}) => {
	const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }); target.dispatchEvent(event); return event;
};
const refresh = (h: Harness) => h.view.refreshSource({ issueSeed: () => 7, hashText: async value => sha256Hex(value) });
async function reopen(h: Harness, sourcePath: string, text: string) {
	h.notes.set(sourcePath, text);
	await h.view.openCapture({ kind: "markdown", note: { sourcePath, sourceName: sourcePath.replace(/\.md$/u, ""), editorText: text } },
		{ readCached: async () => text, hashText: async value => sha256Hex(value), issueSeed: () => 7 });
}
/** The reader's own selection through the real document Selection, as the browser reports it. */
function select(range: Range | null): void {
	const selection = document.getSelection()!;
	selection.removeAllRanges();
	if (range) selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
}
const tokenOf = (h: Harness, slot: DisplaySlot) =>
	Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(element => h.controller().getSlotForElement(element) === slot)!;
function selectWord(h: Harness, surface: string): DisplaySlot {
	const slot = h.plan().slots.find(candidate => candidate.manualEligible && candidate.originalToken.surface === surface)!;
	const range = document.createRange(); range.selectNodeContents(tokenOf(h, slot)); select(range);
	return slot;
}
const manualButton = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-manual-shuffle-selected")!;
const normalized = (h: Harness) => h.peek.contentEl.innerHTML.replace(/semantropy-[a-z-]*\d+(-[a-z]+)*/gu, "id");

describe("WORKBENCH-UI2 tabs off (the default)", () => {
	it("absent, false, or on a host without the Recompose entry, builds the same shell as before", async () => {
		const shells: string[] = [];
		for (const flags of [{}, { tabs: false }, { tabs: true, recomposeDialog: false }, { recomposeDialog: false }] as Flags[]) {
			const h = harness(flags);
			await h.open(TARGET);
			expect(q(h, ".semantropy-tabs")).toBeNull();
			expect(q(h, ".semantropy-pane")).toBeNull();
			// The body and Load next stay direct children of the one scrolling box.
			expect(Array.from(scroll(h).children, child => child.classList.contains("semantropy-body") ? "body" : child.className)).toEqual(["body", "semantropy-action semantropy-load-next"]);
			expect(await h.view.reshuffle({ issueSeed: () => 9 })).toBe("applied");
			expect(await h.view.loadNextSection()).toBe("applied");
			shells.push(normalized(h));
		}
		// The flag changes nothing on a host with the Recompose entry, nor on one without it.
		expect(shells[1]).toBe(shells[0]);
		expect(shells[2]).toBe(shells[3]);
	});
	it("the web page leaves it off (the plugin turned it on in WORKBENCH-UI4: tests/workbenchUi4.test.ts)", () => {
		const web = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
			entry.isDirectory() ? web(path.join(dir, entry.name)) : /\.(ts|mjs|js)$/u.test(entry.name) ? [path.join(dir, entry.name)] : []);
		const files = web("web/src");
		expect(files.length).toBeGreaterThan(5);
		for (const file of files) expect(readFileSync(file, "utf8")).not.toContain("workbenchTabs");
	});
});

describe("WORKBENCH-UI2 tabs on: the row and the panes", () => {
	it("puts a tab row before the one scrolling box, which holds the two panes as siblings", async () => {
		const h = harness();
		await h.open(TARGET);
		const root = q(h, ".semantropy-root")!, row = q(h, ".semantropy-tabs")!;
		// WORKBENCH-UI5: the Shuffle tab's own area stands between the tab row and the box, outside it.
		const bar = q(h, ".semantropy-shuffle-bar")!;
		expect(row.nextElementSibling).toBe(bar);
		expect(bar.nextElementSibling).toBe(scroll(h));
		expect(scroll(h).contains(bar)).toBe(false);
		expect(row.parentElement).toBe(root);
		expect(row.getAttribute("role")).toBe("tablist");
		expect(row.getAttribute("aria-label")).toBe("Body");
		// Only one scrolling box: the panes are inside it, the row is not.
		expect(root.querySelectorAll(".semantropy-scroll")).toHaveLength(1);
		expect(Array.from(scroll(h).children)).toEqual([pane(h, "shuffle"), pane(h, "recompose")]);
		expect(Array.from(pane(h, "shuffle").children, child => child.classList.contains("semantropy-body") ? "body" : child.className)).toEqual(["body", "semantropy-action semantropy-load-next"]);
		expect(h.root().parentElement!.parentElement).toBe(pane(h, "shuffle"));
		for (const name of ["shuffle", "recompose"] as const) {
			expect(tab(h, name).getAttribute("role")).toBe("tab");
			expect(tab(h, name).type).toBe("button");
			expect(tab(h, name).getAttribute("aria-controls")).toBe(pane(h, name).id);
			expect(pane(h, name).getAttribute("role")).toBe("tabpanel");
			expect(pane(h, name).getAttribute("aria-labelledby")).toBe(tab(h, name).id);
		}
		expect([tab(h, "shuffle").textContent, tab(h, "recompose").textContent]).toEqual(["Shuffle", "Recompose"]);
		expect(shown(h)).toEqual(ON_SHUFFLE);
		// Generate, when the host defers the Shuffle, stands in the Shuffle pane.
		const waiting = harness({ tabs: true, defer: true });
		await waiting.open(TARGET);
		expect(q(waiting, ".semantropy-generate")!.parentElement).toBe(pane(waiting, "shuffle"));
	});
	it("ids are this View's own, so two Views never share a tab or a pane", async () => {
		const one = harness(), two = harness();
		await one.open(TARGET); await two.open(TARGET);
		const ids = [one, two].flatMap(h => [tab(h, "shuffle").id, tab(h, "recompose").id, pane(h, "shuffle").id, pane(h, "recompose").id]);
		expect(new Set(ids).size).toBe(8);
	});
	it("a click shows one pane and hides the other; Arrow keys, Home and End move and select", async () => {
		const h = harness();
		await h.open(TARGET);
		tab(h, "recompose").click();
		expect(shown(h)).toEqual(ON_RECOMPOSE);
		tab(h, "shuffle").click();
		expect(shown(h)).toEqual(ON_SHUFFLE);
		tab(h, "shuffle").focus();
		expect(key(tab(h, "shuffle"), "ArrowRight").defaultPrevented).toBe(true);
		expect(shown(h)).toEqual(ON_RECOMPOSE);
		expect(document.activeElement).toBe(tab(h, "recompose"));
		key(tab(h, "recompose"), "ArrowRight");
		expect([shown(h), document.activeElement]).toEqual([ON_SHUFFLE, tab(h, "shuffle")]);
		key(tab(h, "shuffle"), "ArrowLeft");
		expect([shown(h), document.activeElement]).toEqual([ON_RECOMPOSE, tab(h, "recompose")]);
		key(tab(h, "recompose"), "Home");
		expect([shown(h), document.activeElement]).toEqual([ON_SHUFFLE, tab(h, "shuffle")]);
		key(tab(h, "shuffle"), "End");
		expect([shown(h), document.activeElement]).toEqual([ON_RECOMPOSE, tab(h, "recompose")]);
		// Other keys are left alone.
		expect(key(tab(h, "recompose"), "Enter").defaultPrevented).toBe(false);
		expect(shown(h)).toEqual(ON_RECOMPOSE);
	});
	it("review 1: an arrow, Home or End with a modifier is left to whoever owns that shortcut", async () => {
		const h = harness();
		await h.open(TARGET);
		tab(h, "shuffle").focus();
		for (const [name, init] of [["ArrowRight", { ctrlKey: true, altKey: true }], ["ArrowRight", { metaKey: true }], ["ArrowLeft", { altKey: true }],
			["End", { shiftKey: true }], ["Home", { ctrlKey: true }], ["ArrowLeft", { shiftKey: true }]] as const) {
			expect(key(tab(h, "shuffle"), name, init).defaultPrevented).toBe(false);
			expect([shown(h), document.activeElement]).toEqual([ON_SHUFFLE, tab(h, "shuffle")]);
		}
		// The same key without a modifier still moves.
		expect(key(tab(h, "shuffle"), "ArrowRight").defaultPrevented).toBe(true);
		expect(shown(h)).toEqual(ON_RECOMPOSE);
	});
	it("re-words the row in place when the language changes", async () => {
		const h = harness();
		await h.open(TARGET);
		tab(h, "recompose").click();
		const row = q(h, ".semantropy-tabs")!;
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect([row.getAttribute("aria-label"), tab(h, "shuffle").textContent, tab(h, "recompose").textContent]).toEqual(["本文", "シャッフル", "再構成"]);
		expect(q(h, ".semantropy-tabs")).toBe(row);
		expect(shown(h)).toEqual(ON_RECOMPOSE);
	});
	it("keeps each tab's scroll position and puts it back when the tab is shown again", async () => {
		const h = harness();
		await h.open(TARGET);
		const box = scroll(h);
		box.scrollTop = 120; box.scrollLeft = 4;
		tab(h, "recompose").click();
		expect([box.scrollTop, box.scrollLeft]).toEqual([0, 0]);
		box.scrollTop = 30;
		tab(h, "shuffle").click();
		expect([box.scrollTop, box.scrollLeft]).toEqual([120, 4]);
		box.scrollTop = 140;
		tab(h, "recompose").click();
		expect([box.scrollTop, box.scrollLeft]).toEqual([30, 0]);
		tab(h, "shuffle").click();
		expect(box.scrollTop).toBe(140);
		// Showing the tab already shown moves nothing.
		tab(h, "shuffle").click();
		expect(box.scrollTop).toBe(140);
	});
	it("focus inside the pane going away moves to the tab that replaced it", async () => {
		const h = harness();
		await h.open(TARGET);
		const load = q<HTMLButtonElement>(h, ".semantropy-load-next")!;
		load.focus();
		tab(h, "recompose").click();
		expect(document.activeElement).toBe(tab(h, "recompose"));
		const outside = document.body.appendChild(document.createElement("button"));
		outside.focus();
		tab(h, "shuffle").click();
		expect(document.activeElement).toBe(outside);
	});
	it("the tab and the scroll positions are not kept: a new shell starts on Shuffle", async () => {
		const h = harness();
		await h.open(TARGET);
		tab(h, "recompose").click();
		scroll(h).scrollTop = 30;
		// Review 1: leave Recompose first, so its position is kept and a new shell has one to forget.
		tab(h, "shuffle").click();
		scroll(h).scrollTop = 120;
		tab(h, "recompose").click();
		expect(scroll(h).scrollTop).toBe(30);
		// A new shell while Recompose is shown: it starts on Shuffle, and no tab keeps an old position.
		await h.open(OTHER);
		expect(shown(h)).toEqual(ON_SHUFFLE);
		expect(scroll(h).scrollTop).toBe(0);
		tab(h, "recompose").click();
		expect(scroll(h).scrollTop).toBe(0);
		tab(h, "shuffle").click();
		expect(scroll(h).scrollTop).toBe(0);
	});
});

describe("WORKBENCH-UI2 tabs on: Target actions show Shuffle", () => {
	it.each(["toolbar", "command"] as const)("Reshuffle text from the %s shows Shuffle, then draws", async entry => {
		const h = harness();
		await h.open(TARGET);
		tab(h, "recompose").click();
		const before = h.peek.session.getState();
		if (entry === "toolbar") { q<HTMLButtonElement>(h, ".semantropy-reshuffle")!.click(); await vi.waitFor(() => expect(h.peek.session.getState()).not.toBe(before)); }
		else expect(await h.view.reshuffle({ issueSeed: () => 9 })).toBe("applied");
		expect(shown(h)).toEqual(ON_SHUFFLE);
		expect(h.peek.session.getState()).not.toBe(before);
	});
	it("Refresh target shows Shuffle, then refreshes", async () => {
		const h = harness();
		await h.open(TARGET);
		tab(h, "recompose").click();
		h.state.text = TARGET + "猫。\n";
		expect(await refresh(h)).toBe("refreshed");
		expect(shown(h)).toEqual(ON_SHUFFLE);
	});
	it("Reshuffle on a body not generated yet shows Shuffle, then generates", async () => {
		const h = harness({ tabs: true, defer: true });
		await h.open(TARGET);
		tab(h, "recompose").click();
		expect(await h.view.reshuffle({ issueSeed: () => 9 })).toBe("applied");
		expect(shown(h)).toEqual(ON_SHUFFLE);
		expect(h.controller().getChunkStats().chunks).toBe(1);
		expect(q(h, ".semantropy-generate")!.hidden).toBe(true);
	});
	it("an Open of another note into a ready View shows Shuffle", async () => {
		const h = harness();
		await h.open(TARGET);
		tab(h, "recompose").click();
		const row = q(h, ".semantropy-tabs");
		await reopen(h, "other.md", OTHER);
		expect(h.peek.session.getReadySnapshot()!.sourcePath).toBe("other.md");
		expect(q(h, ".semantropy-tabs")).toBe(row);
		expect(shown(h)).toEqual(ON_SHUFFLE);
	});
	it("the level, Automatic parts of speech and the Vocabulary leave the tab where it is", async () => {
		const h = harness();
		await h.open(TARGET);
		tab(h, "recompose").click();
		expect(await h.apply(["犬と鳥。港。"])).toBe("applied");
		const level = q<HTMLSelectElement>(h, ".semantropy-level-select")!;
		level.value = "50"; level.dispatchEvent(new Event("change", { bubbles: true }));
		await vi.waitFor(() => expect(h.peek.session.getState()).toMatchObject({ bodySemantropy: 50 }));
		expect(shown(h)).toEqual(ON_RECOMPOSE);
	});
});

describe("WORKBENCH-UI2 tabs on: nothing acts on the hidden Shuffle selection", () => {
	it("Copy, Collect and Define find nothing while Recompose is shown, even with a selection passed in", async () => {
		const h = harness({ tabs: true }, 0);
		await h.open(TARGET);
		expect(await h.apply(["犬と鳥。港と猫。"])).toBe("applied");
		selectWord(h, "猫");
		const range = document.getSelection()!.getRangeAt(0).cloneRange();
		tab(h, "recompose").click();
		const passed = { rangeCount: 1, getRangeAt: () => range };
		expect(await h.view.copySelectedFragment()).toBe("empty");
		expect(await h.view.copySelectedFragment({ selection: passed })).toBe("empty");
		expect(await h.view.collectSelectedFragment()).toBe("empty");
		expect(await h.view.collectSelectedFragment({ selection: passed })).toBe("empty");
		expect(await h.view.defineSelectedWord({ selection: passed })).toBe("empty");
		expect([h.calls.copy, h.calls.collect]).toEqual([[], []]);
		expect(h.notices).toEqual([COPY_EMPTY_SELECTION_MESSAGE, COPY_EMPTY_SELECTION_MESSAGE, COLLECT_EMPTY_SELECTION_MESSAGE,
			COLLECT_EMPTY_SELECTION_MESSAGE, DEFINE_EMPTY_SELECTION_MESSAGE]);
		expect(q(h, ".semantropy-definition-modal")).toBeNull();
		// Back on Shuffle the same passed selection is read again.
		tab(h, "shuffle").click();
		expect(await h.view.copySelectedFragment({ selection: passed })).toBe("copied");
		expect(h.calls.copy).toEqual(["猫"]);
	});
	it("leaving Shuffle drops the recorded and the live selection, so going back finds none", async () => {
		const h = harness({ tabs: true }, 0);
		await h.open(TARGET);
		expect(await h.apply(["犬と鳥。港と猫。"])).toBe("applied");
		selectWord(h, "猫");
		expect(manualButton(h).disabled).toBe(false);
		tab(h, "recompose").click();
		expect(document.getSelection()!.rangeCount).toBe(0);
		expect(manualButton(h).disabled).toBe(true);
		tab(h, "shuffle").click();
		expect(manualButton(h).disabled).toBe(true);
		expect(await h.view.copySelectedFragment()).toBe("empty");
		expect(h.calls.copy).toEqual([]);
		// A selection elsewhere in the document is not this pane's to drop.
		const outside = document.body.appendChild(document.createElement("p")); outside.textContent = "外";
		const range = document.createRange(); range.selectNodeContents(outside); select(range);
		tab(h, "recompose").click();
		expect(document.getSelection()!.toString()).toBe("外");
	});
	it("a selection made in the hidden body while Recompose is shown is not recorded", async () => {
		const h = harness({ tabs: true }, 0);
		await h.open(TARGET);
		expect(await h.apply(["犬と鳥。港と猫。"])).toBe("applied");
		tab(h, "recompose").click();
		selectWord(h, "猫");
		expect(manualButton(h).disabled).toBe(true);
		// Every Toolbar pass, not only the one a selection change makes, ignores the hidden body.
		await h.view.dictionarySettingsChanged();
		expect(manualButton(h).disabled).toBe(true);
		expect(q(h, ".semantropy-manual-diagnostic")!.hidden).toBe(true);
		document.getSelection()!.removeAllRanges();
		tab(h, "shuffle").click();
		expect(manualButton(h).disabled).toBe(true);
		expect(await h.view.copySelectedFragment()).toBe("empty");
	});
	it("review 1: Clear manual changes is off while Recompose is shown, and clears nothing even if reached", async () => {
		const h = harness({ tabs: true }, 0);
		await h.open(TARGET);
		expect(await h.apply(["犬と鳥。港と猫。"])).toBe("applied");
		selectWord(h, "猫");
		q<HTMLButtonElement>(h, ".semantropy-manual-shuffle-selected")!.click();
		expect(h.controller().getManualOverrideCount()).toBe(1);
		const clear = q<HTMLButtonElement>(h, ".semantropy-manual-clear")!;
		expect(clear.disabled).toBe(false);
		tab(h, "recompose").click();
		expect(clear.disabled).toBe(true);
		// The count of the hidden body's changes is still reported (WORKBENCH-UI5: it stands in the Shuffle area, which the tab hides with the body).
		expect(q(h, ".semantropy-manual-count")!.hidden).toBe(false);
		clear.disabled = false; clear.click();
		expect(h.controller().getManualOverrideCount()).toBe(1);
		tab(h, "shuffle").click();
		expect(clear.disabled).toBe(false);
		clear.click();
		expect(h.controller().getManualOverrideCount()).toBe(0);
	});
	it("the word menu closes, and a word action it still holds does nothing", async () => {
		const h = harness({ tabs: true }, 0);
		await h.open(TARGET);
		expect(await h.apply(["犬と鳥。港と猫。"])).toBe("applied");
		const slot = h.plan().slots.find(candidate => candidate.manualEligible && candidate.originalToken.surface === "猫")!;
		tokenOf(h, slot).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		const menu = q(h, ".semantropy-manual-menu")!;
		const item = menu.querySelector<HTMLButtonElement>("button")!;
		tab(h, "recompose").click();
		expect(q(h, ".semantropy-manual-menu")).toBeNull();
		const before = h.root().innerHTML;
		item.click();
		expect(h.root().innerHTML).toBe(before);
		expect(h.controller().getManualOverrideCount()).toBe(0);
	});
	it("a modifier hover over the hidden body opens no definition, and an open one closes", async () => {
		const h = harness({ tabs: true }, 0);
		await h.open(TARGET);
		const popover = () => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
		const slot = h.plan().slots.find(candidate => candidate.dictionaryAvailable)!;
		const hover = () => tokenOf(h, slot).dispatchEvent(new MouseEvent("pointerover", { bubbles: true, cancelable: true, altKey: true }));
		const wait = () => new Promise<void>(resolve => window.setTimeout(resolve, 145));
		hover(); await wait();
		expect(popover().isOpen()).toBe(true);
		tab(h, "recompose").click();
		expect(popover().isOpen()).toBe(false);
		hover(); await wait();
		expect(popover().isOpen()).toBe(false);
		expect(document.querySelector(".semantropy-dictionary-popover")).toBeNull();
	});
});

/**
 * Review 1 (P2): a Text level change or an Automatic parts-of-speech Apply claims every View
 * and, when it commits or rolls back, puts back the selection the View had when it was
 * claimed. Leaving Shuffle while it waits drops that selection on purpose, and nothing that
 * was already in flight may bring it back.
 */
describe("WORKBENCH-UI2 review 1: a change in flight never brings back a selection leaving Shuffle dropped", () => {
	/** One plugin-wide store and coordinator, as the plugin wires every View; `gate()` holds the next save. */
	async function plugin() {
		let disk: unknown = { schemaVersion: 4, bodySemantropy: 0, dictionarySemantropy: 50, collectionPath: "Semantropy Collection.md",
			displayRubyVisible: true, displayMarkersVisible: true, automaticPos: { noun: true, verb: false, iAdjective: false, adverb: false } };
		let hold: { entered: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>>; fail: boolean } | null = null;
		const store = new AutomaticPosSettingsStore({ load: async () => disk, save: async value => {
			const held = hold; hold = null;
			if (held) { held.entered.resolve(); await held.release.promise; if (held.fail) throw Error("disk"); }
			disk = structuredClone(value);
		} });
		await store.load();
		const coordinator = new AutomaticPosCoordinator(store);
		const view = async () => {
			const h = harness({ tabs: true }, 0);
			h.host.automaticPosCoordinator = coordinator; h.host.getAutomaticPos = () => store.getSettings().automaticPos;
			h.host.getBodySemantropy = () => store.getBodySemantropy();
			await h.open(TARGET);
			expect(await h.apply(["犬と鳥。港と猫。"])).toBe("applied");
			return h;
		};
		const gate = (fail: boolean) => { hold = { entered: deferred<void>(), release: deferred<void>(), fail }; return hold; };
		return { view, gate };
	}
	type Change = "level" | "automatic";
	const run = (h: Harness, change: Change) => change === "level"
		? h.view.setBodySemantropy(assertBodySemantropy(50))
		: h.view.applyAutomaticPos({ noun: true, verb: true, iAdjective: false, adverb: false });
	const outcomes = (change: Change, fail: boolean) => change === "level" ? (fail ? "failed" : "applied") : (fail ? "failed" : "committed");
	async function written(h: Harness) {
		return [await h.view.copySelectedFragment(), await h.view.collectSelectedFragment(), h.calls.copy.length, h.calls.collect.length];
	}

	it.each([
		["level", "the same View", false], ["level", "the same View", true], ["level", "another View", false], ["level", "another View", true],
		["automatic", "the same View", false], ["automatic", "the same View", true], ["automatic", "another View", false], ["automatic", "another View", true],
	] as const)("%s change from %s (fails: %s): Recompose shown while it waits, then Shuffle again, finds no selection", async (change, from, fail) => {
		const p = await plugin(), a = await p.view(), b = await p.view();
		selectWord(a, "猫");
		expect(manualButton(a).disabled).toBe(false);
		const held = p.gate(fail);
		const pending = run(from === "the same View" ? a : b, change);
		await held.entered.promise;
		tab(a, "recompose").click();
		held.release.resolve();
		expect(await pending).toBe(outcomes(change, fail));
		tab(a, "shuffle").click();
		expect(document.getSelection()!.rangeCount).toBe(0);
		expect(manualButton(a).disabled).toBe(true);
		expect(await written(a)).toEqual(["empty", "empty", 0, 0]);
	});
	it.each([["level", false], ["level", true], ["automatic", false], ["automatic", true]] as const)(
		"control: a %s change (fails: %s) on Shuffle alone keeps the selection, and leaving after it ends drops it", async (change, fail) => {
			const p = await plugin(), a = await p.view();
			selectWord(a, "猫");
			const held = p.gate(fail);
			const pending = run(a, change);
			await held.entered.promise;
			held.release.resolve();
			expect(await pending).toBe(outcomes(change, fail));
			// Kept across the change, as before the tabs: the recorded selection still copies.
			expect(await a.view.copySelectedFragment()).toBe("copied");
			tab(a, "recompose").click(); tab(a, "shuffle").click();
			expect(manualButton(a).disabled).toBe(true);
			expect(await written(a)).toEqual(["empty", "empty", 1, 0]);
		});
});
