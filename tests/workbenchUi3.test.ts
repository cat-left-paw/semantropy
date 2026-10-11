// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { BODY_FONT_STACKS, defaultSemantropyDisplaySettings, type SemantropyDisplaySettings } from "../src/settings/displaySettings";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { EN_MESSAGES, ui } from "../src/i18n/catalog";
import { RESHUFFLE_UNAVAILABLE_MESSAGE } from "../src/application/reshuffleNote";
import { REFRESH_TO_GENERATE_MESSAGE } from "../src/view/toolbarStatusModel";
import { SemantropyPlugin, type SemantropyTokenizerHost } from "../src/SemantropyPlugin";
import type { DisplaySlot } from "../src/analysis/displaySlots";
import type { RecomposePane } from "../src/view/RecomposePane";

/**
 * WORKBENCH-UI3, stage 4 of `Docs/release_0_2_0_plan.md` §3.4: on a host with
 * the body tabs the display settings' font reaches the Recompose text too, the
 * Toolbar follows what the body area shows, and Reshuffle text is Generate text
 * until the first Chunk. Off (the default, the plugin and the web page) builds
 * none of it.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const LEXICON = [
	...["猫", "犬", "森", "川", "空"].map((surface) => token({ surface, reading: "ヨミ" })),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "と", pos: "助詞", detail1: "並立助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "た", pos: "助動詞", detail1: "*" }),
];
const TARGET = "猫と犬。\n森と川。\n".repeat(6);
const SOURCE = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。";

type Flags = { tabs?: boolean; recomposeDialog?: boolean; defer?: boolean };
type Harness = ReturnType<typeof manualMorphHarness> & { notices: string[]; display: { value: SemantropyDisplaySettings } };
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(flags: Flags, display: Partial<SemantropyDisplaySettings> = {}): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(100);
	if (flags.tabs !== undefined) h.host.workbenchTabs = flags.tabs;
	if (flags.recomposeDialog !== undefined) h.host.recomposeDialog = flags.recomposeDialog;
	if (flags.defer !== undefined) h.host.deferInitialShuffle = flags.defer;
	const notices: string[] = [];
	h.host.showNotice = message => { notices.push(message); };
	const state = { value: { ...defaultSemantropyDisplaySettings(), ...display } };
	h.host.getDisplaySettings = () => state.value;
	h.host.setDisplaySettings = async patch => { state.value = { ...state.value, ...patch }; return true; };
	const result = Object.assign(h, { notices, display: state });
	opened.push(result);
	return result;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const button = (h: Harness, cls: string) => q<HTMLButtonElement>(h, `.semantropy-${cls}`)!;
const tab = (h: Harness, name: "shuffle" | "recompose") => q<HTMLButtonElement>(h, `.semantropy-tab-${name}`)!;
const output = (h: Harness) => q(h, ".semantropy-recompose-pane .semantropy-recompose-output")!;
const body = (h: Harness) => q(h, ".semantropy-body")!;
const describedBy = (control: HTMLElement) => control.ownerDocument.getElementById(control.getAttribute("aria-describedby")!.split(" ")[0]!)!.textContent;
const named = (control: HTMLElement) => [control.getAttribute("aria-label"), control.querySelector(".semantropy-action-label")!.textContent, describedBy(control)];
const MANUAL = ["manual-shuffle-selected", "manual-restore-selected", "manual-automatic-selected", "manual-clear"];
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

function select(range: Range | null): void {
	const selection = document.getSelection()!;
	selection.removeAllRanges();
	if (range) selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
}
function selectWord(h: Harness, surface: string): DisplaySlot {
	const slot = h.plan().slots.find(candidate => candidate.manualEligible && candidate.originalToken.surface === surface)!;
	const element = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(item => h.controller().getSlotForElement(item) === slot)!;
	const range = document.createRange(); range.selectNodeContents(element); select(range);
	return slot;
}

describe("WORKBENCH-UI3 off (the default): nothing of stage 4 is built", () => {
	it("names, descriptions, marks and the Display settings note stay as they were, and there is no Recompose to offer", async () => {
		for (const flags of [{}, { tabs: false }, { tabs: true, recomposeDialog: false }, { recomposeDialog: false }] as Flags[]) {
			const h = harness(flags, { bodyFontFamily: "serif", bodyFontSizePx: 20 });
			await h.open(TARGET);
			expect(named(button(h, "reshuffle"))).toEqual(["Reshuffle text", "Reshuffle text", EN_MESSAGES.toolbar.controls.reshuffle.description]);
			expect(named(button(h, "refresh"))).toEqual(["Refresh target", "Refresh target", EN_MESSAGES.toolbar.controls.refresh.description]);
			expect(describedBy(button(h, "copy"))).toBe(EN_MESSAGES.toolbar.controls.copy.description);
			expect(h.peek.contentEl.querySelector(".semantropy-display-note, .semantropy-shuffle-bar")).toBeNull();
			expect(body(h).style.fontFamily).toBe(BODY_FONT_STACKS.serif);
			// WORKBENCH-UI4: the entry to Recompose is the tab, so a host without tabs has none, and no dialog stands in.
			expect(q(h, ".semantropy-recompose-open")).toBeNull();
			expect(document.querySelector(".semantropy-recompose-modal")).toBeNull();
		}
	});
});

describe("WORKBENCH-UI3: the display settings reach the Recompose text", () => {
	it("font and size go to the Shuffle body and the Recompose text alike; ruby stays the body's, the controls keep theirs", async () => {
		const h = harness({ tabs: true });
		await h.open(TARGET);
		expect([output(h).style.fontFamily, output(h).style.fontSize]).toEqual(["", ""]);
		h.display.value = { ...h.display.value, bodyFontFamily: "serif", bodyFontSizePx: 22, showRuby: false };
		await h.view.applyStoredDisplaySettings();
		for (const element of [body(h), output(h)]) expect([element.style.fontFamily, element.style.fontSize]).toEqual([BODY_FONT_STACKS.serif, "22px"]);
		expect([body(h).classList.contains("is-ruby-hidden"), output(h).classList.contains("is-ruby-hidden")]).toEqual([true, false]);
		const pane = q(h, ".semantropy-recompose-pane")!;
		expect([pane.getAttribute("style"), q(h, ".semantropy-recompose-controls")!.getAttribute("style")]).toEqual([null, null]);
		h.display.value = defaultSemantropyDisplaySettings();
		await h.view.applyStoredDisplaySettings();
		for (const element of [body(h), output(h)]) expect([element.style.fontFamily, element.style.fontSize]).toEqual(["", ""]);
	});
	it("from the Toolbar's Display settings, while the Recompose tab is shown", async () => {
		const h = harness({ tabs: true });
		await h.open(TARGET);
		tab(h, "recompose").click();
		const family = q<HTMLSelectElement>(h, ".semantropy-font-family")!, size = q<HTMLSelectElement>(h, ".semantropy-font-size")!;
		family.value = "sans-serif"; family.dispatchEvent(new Event("change"));
		size.value = "18"; size.dispatchEvent(new Event("change"));
		await settle();
		expect([output(h).style.fontFamily, output(h).style.fontSize]).toEqual([BODY_FONT_STACKS["sans-serif"], "18px"]);
		expect([body(h).style.fontFamily, body(h).style.fontSize]).toEqual([BODY_FONT_STACKS["sans-serif"], "18px"]);
	});
	it("a new shell's pane takes them at once", async () => {
		const h = harness({ tabs: true }, { bodyFontFamily: "serif", bodyFontSizePx: 18 });
		await h.open(TARGET);
		const first = output(h);
		expect([first.style.fontFamily, first.style.fontSize]).toEqual([BODY_FONT_STACKS.serif, "18px"]);
		// An Open into a View that is not ready builds a new shell, in the same View lifetime. WORKBENCH-UI5: an Open with no note
		// leaves a ready View alone, so the View is put in the state such an Open finds (the session loading), and with no note
		// (a View that has none yet) it has the pane too.
		h.leaveReady();
		await h.view.openCapture({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: null } },
			{ readCached: async () => { throw new Error("unreadable"); }, hashText: async value => sha256Hex(value), issueSeed: () => 7 });
		expect(output(h)).not.toBe(first);
		expect([output(h).style.fontFamily, output(h).style.fontSize]).toEqual([BODY_FONT_STACKS.serif, "18px"]);
		await h.view.openCapture({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: TARGET } },
			{ readCached: async () => TARGET, hashText: async value => sha256Hex(value), issueSeed: () => 7 });
		expect(output(h)).not.toBe(first);
		expect([output(h).style.fontFamily, output(h).style.fontSize]).toEqual([BODY_FONT_STACKS.serif, "18px"]);
	});
});

describe("WORKBENCH-UI3: the Toolbar follows what the body area shows", () => {
	it("not generated, Reshuffle text is Generate text until the first Chunk, in both languages", async () => {
		const h = harness({ defer: true });
		await h.open(TARGET);
		const reshuffle = button(h, "reshuffle"), words = EN_MESSAGES.toolbar.workbench;
		expect(named(reshuffle)).toEqual([words.generate.name, words.generate.name, words.generate.description]);
		// Only Reshuffle text turns into Generate: Refresh target keeps its own name and description.
		const refresh = EN_MESSAGES.toolbar.controls.refresh;
		expect(named(button(h, "refresh"))).toEqual([refresh.name, refresh.name, refresh.description]);
		// No tabs: neither the mark nor the Display settings note nor the pane's reason is built.
		expect(h.peek.contentEl.querySelector(".is-to-shuffle, .semantropy-display-note, .semantropy-recompose-reason")).toBeNull();
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(named(reshuffle)).toEqual(["本文を生成", "本文を生成", ui().toolbar.workbench.generate.description]);
		expect(named(button(h, "refresh"))).toEqual(["対象ノートを再読込", "対象ノートを再読込", ui().toolbar.controls.refresh.description]);
		reshuffle.click();
		await vi.waitFor(() => expect(q(h, ".semantropy-generate")!.hidden).toBe(true));
		expect(button(h, "reshuffle")).toBe(reshuffle);
		expect(named(reshuffle)).toEqual(["本文をシャッフル", "本文をシャッフル", ui().toolbar.controls.reshuffle.description]);
	});
	it("on the Recompose tab the Shuffle area is hidden, the word actions are off and the Toolbar says which settings are the Shuffle tab's", async () => {
		const h = harness({ tabs: true });
		await h.open(TARGET);
		const words = EN_MESSAGES.toolbar.workbench, controls = EN_MESSAGES.toolbar.controls;
		const bar = q(h, ".semantropy-shuffle-bar")!;
		// WORKBENCH-UI5: Copy and Collect (and Reshuffle text and Refresh target) are in the Shuffle tab's own area, not in the Toolbar.
		expect(q(h, ".semantropy-toolbar .semantropy-reshuffle, .semantropy-toolbar .semantropy-refresh, .semantropy-toolbar .semantropy-copy, .semantropy-toolbar .semantropy-collect")).toBeNull();
		const note = q(h, ".semantropy-display-note")!;
		expect([bar.hidden, note.hidden, note.textContent]).toEqual([false, true, words.shuffleOnly]);
		// Nothing above the tab row changes when the tab is shown: not the Toolbar, not its status line.
		const aboveTabs = () => Array.from(h.peek.contentEl.querySelector(".semantropy-root")!.children)
			.slice(0, Array.from(h.peek.contentEl.querySelector(".semantropy-root")!.children).findIndex(child => child.classList.contains("semantropy-tabs")))
			.map(child => child.textContent ?? "");
		const before = aboveTabs();
		expect(before.length).toBeGreaterThan(1);
		tab(h, "recompose").click();
		expect(aboveTabs()).toEqual(before);
		tab(h, "shuffle").click();
		// With a word selected the word actions and Copy / Collect are on; the Recompose tab drops that selection and turns them off.
		selectWord(h, "猫");
		expect([button(h, "copy").disabled, button(h, "collect").disabled, button(h, "manual-shuffle-selected").disabled]).toEqual([false, false, false]);
		expect(describedBy(button(h, "copy"))).toBe(controls.copy.description);
		tab(h, "recompose").click();
		expect([bar.hidden, note.hidden]).toEqual([true, false]);
		expect(MANUAL.map(cls => button(h, cls).disabled)).toEqual([true, true, true, true]);
		// The display switches stay usable: they are settings every View shares.
		expect(Array.from(h.peek.contentEl.querySelectorAll<HTMLButtonElement>(".semantropy-display-toggle"), toggle => toggle.disabled)).toEqual([false, false, false, false]);
		// The reasons the stage 3 and 4 pieces gave for a Toolbar that followed the tab are gone with them.
		expect(h.peek.contentEl.querySelector(".is-to-shuffle, .semantropy-recompose-reason")).toBeNull();
		expect(h.peek.contentEl.textContent).not.toContain("(Shuffle tab)");
		expect(h.peek.contentEl.textContent).not.toContain("for the Shuffle tab");
		tab(h, "shuffle").click();
		expect([bar.hidden, note.hidden]).toEqual([false, true]);
		expect(aboveTabs()).toEqual(before);
	});
	it("not generated: the area's Reshuffle text is Generate text until the first Chunk, and the command from the Recompose tab shows Shuffle and generates", async () => {
		const h = harness({ tabs: true, defer: true });
		await h.open(TARGET);
		const words = EN_MESSAGES.toolbar.workbench;
		expect(named(button(h, "reshuffle"))).toEqual([words.generate.name, words.generate.name, words.generate.description]);
		// Refresh target is never Generate.
		const refresh = EN_MESSAGES.toolbar.controls.refresh;
		expect(named(button(h, "refresh"))).toEqual([refresh.name, refresh.name, refresh.description]);
		tab(h, "recompose").click();
		expect(q(h, ".semantropy-shuffle-bar")!.hidden).toBe(true);
		// The command (Reshuffle text) acts on the Shuffle body, so it shows that tab first and generates.
		expect(await h.view.reshuffle()).toBe("applied");
		expect(tab(h, "shuffle").getAttribute("aria-selected")).toBe("true");
		expect(q(h, ".semantropy-shuffle-bar")!.hidden).toBe(false);
		expect(q(h, ".semantropy-generate")!.hidden).toBe(true);
		expect(named(button(h, "reshuffle"))[0]).toBe(EN_MESSAGES.toolbar.controls.reshuffle.name);
	});
	it("re-words the Shuffle area and the Display settings note in place when the language changes", async () => {
		const h = harness({ tabs: true });
		await h.open(TARGET);
		const reshuffle = button(h, "reshuffle"), note = q(h, ".semantropy-display-note")!, bar = q(h, ".semantropy-shuffle-bar")!;
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(button(h, "reshuffle")).toBe(reshuffle);
		expect(q(h, ".semantropy-shuffle-bar")).toBe(bar);
		expect(named(reshuffle)).toEqual(["本文をシャッフル", "本文をシャッフル", ui().toolbar.controls.reshuffle.description]);
		expect(describedBy(button(h, "copy"))).toBe(ui().toolbar.controls.copy.description);
		expect(note.textContent).toBe(ui().toolbar.workbench.shuffleOnly);
	});
});

/**
 * Boots the plugin with `active` as the active Semantropy view and runs its Reshuffle text command: the
 * sentences the command puts in its Notices (English message identities, and as the Notice shows them).
 */
async function runReshuffleCommand(active: unknown): Promise<{ messages: string[]; shown: string[] }> {
	class Probe extends SemantropyPlugin {
		protected createTokenizer(): SemantropyTokenizerHost { throw new Error("not used"); }
	}
	const commands = new Map<string, () => void>();
	const app = {
		vault: { on: () => ({}), getAbstractFileByPath: () => null, getMarkdownFiles: () => [], cachedRead: async () => "" },
		workspace: { on: () => ({}), getLeavesOfType: () => [], getLeaf: () => null, getActiveViewOfType: () => active, setActiveLeaf: () => undefined },
	};
	const plugin = new Probe(app as unknown as App, { id: "semantropy", dir: "plugins/semantropy" } as never);
	Object.assign(plugin, {
		registerView: () => undefined, addSettingTab: () => undefined, registerEvent: () => undefined, addRibbonIcon: () => document.createElement("div"),
		addCommand: (command: { id: string; callback: () => void }) => { commands.set(command.id, command.callback); return command; },
		loadData: async () => null, saveData: async () => undefined,
	});
	await plugin.onload();
	commands.get("reshuffle")!();
	for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0));
	const notices = Reflect.get(plugin, "notices") as Map<{ message: string }, string>;
	const result = { messages: [...notices.values()], shown: [...notices.keys()].map(notice => notice.message) };
	plugin.onunload();
	return result;
}

describe("WORKBENCH-UI3: the Reshuffle text command when Generate waits for Refresh target", () => {
	it("the View names the reason; every other unavailable Reshuffle keeps its sentence", async () => {
		const h = harness({ defer: true });
		await h.open(TARGET);
		expect(await h.apply([SOURCE])).toBe("applied");
		expect(h.view.reshuffleUnavailableMessage()).toBe(RESHUFFLE_UNAVAILABLE_MESSAGE);
		h.view.notifyVocabularySourceEvent("target.md");
		expect(await h.view.reshuffle()).toBe("unavailable");
		expect(h.view.reshuffleUnavailableMessage()).toBe(REFRESH_TO_GENERATE_MESSAGE);
		// Off: a body at level 0 has nothing to reshuffle, and says so as before.
		const off = harness({});
		off.state.level = assertBodySemantropy(0);
		await off.open(TARGET);
		expect(await off.view.reshuffle()).toBe("unavailable");
		expect(off.view.reshuffleUnavailableMessage()).toBe(RESHUFFLE_UNAVAILABLE_MESSAGE);
	});
	it("the plugin's command shows the sentence the View gives", async () => {
		for (const message of [REFRESH_TO_GENERATE_MESSAGE, RESHUFFLE_UNAVAILABLE_MESSAGE]) {
			const active = { reshuffle: async () => "unavailable", reshuffleUnavailableMessage: () => message };
			expect((await runReshuffleCommand(active)).messages).toEqual([message]);
		}
	});
	it("the sentences themselves, through the real View and the plugin's command: only a body not generated that waits for Refresh target says so, in both languages", async () => {
		const UNAVAILABLE = ["Nothing to reshuffle yet.", "まだシャッフルするものがありません。"];
		const REFRESH = ["The target changed. Use Refresh target before Generate.", "対象ノートが変更されました。生成の前に「対象ノートを再読込」を使ってください。"];
		const asked = async (h: Harness) => { const out = await runReshuffleCommand(h.view); return [out.messages, out.shown]; };
		// WORKBENCH-UI5 (review 1, P3 5): with no note at all the command says so, rather than doing nothing.
		const noNote = harness({ tabs: true, defer: true });
		await noNote.view.onOpen();
		expect(await asked(noNote)).toEqual([[UNAVAILABLE[0]], [UNAVAILABLE[1]]]);
		// Flags off, nothing to reshuffle (level 0): the old sentence, and a changed Target does not change it.
		const off = harness({});
		off.state.level = assertBodySemantropy(0);
		await off.open(TARGET);
		expect(await asked(off)).toEqual([[UNAVAILABLE[0]], [UNAVAILABLE[1]]]);
		off.view.notifyVocabularySourceEvent("target.md");
		expect(await asked(off)).toEqual([[UNAVAILABLE[0]], [UNAVAILABLE[1]]]);
		await off.view.recheckSourceFreshness(TARGET + "犬は東京。\n", { hashText: async value => sha256Hex(value) });
		expect(await asked(off)).toEqual([[UNAVAILABLE[0]], [UNAVAILABLE[1]]]);
		// Not generated and the Target changed: the status line's sentence; before the change, Generate just runs.
		const waiting = harness({ defer: true });
		await waiting.open(TARGET);
		waiting.view.notifyVocabularySourceEvent("target.md");
		expect(await asked(waiting)).toEqual([[REFRESH[0]], [REFRESH[1]]]);
		const fresh = harness({ defer: true });
		await fresh.open(TARGET);
		expect(await asked(fresh)).toEqual([[], []]);
	});
});

describe("WORKBENCH-UI3: the stylesheet keeps the pane's layout to the pane", () => {
	it("keeps the actions in reach, lets the tab row wrap and gives both panes the theme's surfaces, and shares the output box's look", () => {
		const css = readFileSync("styles.css", "utf8");
		const rule = (selector: string) => {
			const at = css.indexOf(`\n${selector} {`);
			expect(at, selector).toBeGreaterThan(-1);
			return css.slice(at, css.indexOf("}", at));
		};
		expect(rule(".semantropy-recompose-pane")).toMatch(/height: 100%;/u);
		expect(rule(".semantropy-recompose-pane .semantropy-recompose-output")).toMatch(/flex: 1 1 auto;[^}]*min-height: 8rem;[^}]*overflow: auto;[^}]*font-family: var\(--font-text\);/u);
		// Review 1 (P3): the box keeps its position across hiding and showing the pane.
		expect(rule(".semantropy-recompose-pane .semantropy-recompose-output")).toMatch(/overflow-anchor: none;/u);
		// WORKBENCH-UI4: the dialog's own limits (45vh, 6rem) went with the dialog; the box's look is shared.
		expect(rule(".semantropy-recompose-output")).toMatch(/padding: 0.5rem 0.75rem;[^}]*line-height: 1.8;/u);
		expect(rule(".semantropy-recompose-output")).not.toMatch(/max-height|overflow:/u);
		expect(rule(".semantropy-tabs")).toMatch(/flex-wrap: wrap;/u);
		// WORKBENCH-UI5: the reason line for Copy and Collect went with the Toolbar's copies of them.
		expect(css).not.toContain("semantropy-recompose-reason");
		expect(css).not.toContain("is-to-shuffle");
		expect(rule(".semantropy-scroll.semantropy-theme-light .semantropy-pane,\n.semantropy-scroll.semantropy-theme-dark .semantropy-pane")).toMatch(/--interactive-normal: var\(--background-secondary\);/u);
	});
});

describe("WORKBENCH-UI3 review 1 (P2): the Recompose pane puts a new text at the top of its own box", () => {
	it("a new text starts at the top however far the earlier one was read, and a continuation or a branch shows its end", async () => {
		const h = harness({ tabs: true });
		await h.open(TARGET);
		expect(await h.apply([SOURCE])).toBe("applied");
		tab(h, "recompose").click();
		const screen = Reflect.get(h.view, "recomposeScreen") as RecomposePane, box = output(h);
		Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 800 });
		await screen.run("new");
		// The reader scrolled to the end of the first text; the next new text must not stay there.
		box.scrollTop = 800;
		await screen.run("new");
		expect(box.scrollTop).toBe(0);
		await screen.run("more");
		expect(box.scrollTop).toBe(800);
		box.scrollTop = 120;
		await screen.run("more");
		expect(box.scrollTop).toBe(800);
		// A branch from a chosen piece shows its new end too.
		q(h, ".semantropy-recompose-pane .semantropy-recompose-unit")!.click();
		box.scrollTop = 0;
		await screen.run("branch");
		expect(box.scrollTop).toBe(800);
		box.scrollTop = 800;
		await screen.run("new");
		expect(box.scrollTop).toBe(0);
	});
});
