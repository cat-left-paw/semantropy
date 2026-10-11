// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { ui } from "../src/i18n/catalog";
import { localize } from "../src/i18n/messages";
import { SemantropyPlugin, type SemantropyTokenizerHost } from "../src/SemantropyPlugin";
import type { SemantropyView, SemantropyViewHost } from "../src/view/SemantropyView";
import type { RecomposePane } from "../src/view/RecomposePane";

/**
 * WORKBENCH-UI4, stage 5 of `Docs/release_0_2_0_plan.md` §3.4: the plugin's host turns the workbench on
 * (a note opens without a Shuffle; the body area is [Shuffle] [Recompose] tabs, also with no note open),
 * and Recompose is the tab: the 0.1.0 S5 dialog is gone. The web page's host keeps both flags off.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const LEXICON = [
	...["猫", "犬", "森", "川", "空"].map((surface) => token({ surface })),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "と", pos: "助詞", detail1: "並立助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "た", pos: "助動詞", detail1: "*" }),
];
const TARGET = "猫と犬。\n森と川。\n".repeat(6);
const SOURCE = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。";
const NO_NOTE = "Open a Markdown note, then run Semantropy: Open.";
const deps = { readCached: async () => TARGET, hashText: async (value: string) => sha256Hex(value), issueSeed: () => 7 };
const note = { kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: TARGET } } as const;

type Flags = { tabs?: boolean; recomposeDialog?: boolean; defer?: boolean };
type Harness = ReturnType<typeof manualMorphHarness>;
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(flags: Flags = { tabs: true, defer: true }): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(100);
	h.state.text = TARGET;
	if (flags.tabs !== undefined) h.host.workbenchTabs = flags.tabs;
	if (flags.recomposeDialog !== undefined) h.host.recomposeDialog = flags.recomposeDialog;
	if (flags.defer !== undefined) h.host.deferInitialShuffle = flags.defer;
	opened.push(h);
	return h;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const tab = (h: Harness, name: "shuffle" | "recompose") => q<HTMLButtonElement>(h, `.semantropy-tab-${name}`)!;
const panes = (h: Harness) => ({ shuffle: q(h, ".semantropy-shuffle-pane")!, recompose: q(h, ".semantropy-recompose-pane")! });
const selected = (h: Harness) => (["shuffle", "recompose"] as const).filter(name => tab(h, name).getAttribute("aria-selected") === "true");
const screen = (h: Harness) => Reflect.get(h.view, "recomposeScreen") as RecomposePane;
const units = (h: Harness) => q(h, ".semantropy-recompose-pane")!.querySelectorAll(".semantropy-recompose-unit").length;
const generateNew = (h: Harness) => Array.from(q(h, ".semantropy-recompose-pane")!.querySelectorAll<HTMLButtonElement>("button")).find(item => item.getAttribute("aria-label") === ui().recompose.generate)!;

/** Boots the plugin and returns the host its registered View factory gives a View. */
async function pluginViewHost(): Promise<SemantropyViewHost> {
	class Probe extends SemantropyPlugin {
		protected createTokenizer(): SemantropyTokenizerHost { throw new Error("not used"); }
	}
	const app = {
		vault: { on: () => ({}), getAbstractFileByPath: () => null, getMarkdownFiles: () => [], cachedRead: async () => "" },
		workspace: { on: () => ({}), getLeavesOfType: () => [], getLeaf: () => null, getActiveViewOfType: () => null, setActiveLeaf: () => undefined },
	};
	const plugin = new Probe(app as unknown as App, { id: "semantropy", dir: "plugins/semantropy" } as never);
	let create: ((leaf: unknown) => SemantropyView) | null = null;
	Object.assign(plugin, {
		registerView: (_type: string, factory: (leaf: unknown) => SemantropyView) => { create = factory; },
		addSettingTab: () => undefined, registerEvent: () => undefined, addRibbonIcon: () => document.createElement("div"),
		addCommand: (command: unknown) => command, loadData: async () => null, saveData: async () => undefined,
	});
	await plugin.onload();
	const view = create!({ app: {} });
	const host = Reflect.get(view, "host") as SemantropyViewHost;
	plugin.onunload();
	return host;
}

describe("WORKBENCH-UI4: the plugin's host turns the workbench on; the web page's host does not", () => {
	it("the plugin passes both flags and leaves recomposeDialog alone", async () => {
		const host = await pluginViewHost();
		expect([host.deferInitialShuffle, host.workbenchTabs, host.recomposeDialog]).toEqual([true, true, undefined]);
	});
	it("the web page's host passes neither flag and keeps recomposeDialog: false", () => {
		const web = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
			entry.isDirectory() ? web(path.join(dir, entry.name)) : /\.(ts|mjs|js)$/u.test(entry.name) ? [path.join(dir, entry.name)] : []);
		const files = web("web/src");
		expect(files.length).toBeGreaterThan(5);
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			expect([file, text.includes("deferInitialShuffle"), text.includes("workbenchTabs")]).toEqual([file, false, false]);
		}
		expect(readFileSync("web/src/host/WebSemantropyHost.ts", "utf8")).toContain("recomposeDialog: false");
	});
	it("the Recompose tab stands only where there are tabs: not without them, not on a host with its own Recompose; the Toolbar has no control for it (WORKBENCH-UI5)", async () => {
		const entry = async (flags: Flags) => { const h = harness(flags); await h.open(TARGET); expect(q(h, ".semantropy-recompose-open")).toBeNull(); return q(h, ".semantropy-tab-recompose") !== null; };
		expect([await entry({}), await entry({ tabs: false }), await entry({ tabs: true }), await entry({ tabs: true, recomposeDialog: false }), await entry({ recomposeDialog: false })])
			.toEqual([false, false, true, false, false]);
		// Without a tab there is nothing to show: no tab to ask, no pane, and no dialog exists to open.
		const plain = harness({}); await plain.open(TARGET);
		expect(q(plain, ".semantropy-tab-recompose")).toBeNull();
		expect(plain.peek.contentEl.querySelector(".semantropy-recompose-pane")).toBeNull();
		expect(document.querySelector(".semantropy-recompose-modal")).toBeNull();
	});
});

describe("WORKBENCH-UI4: the tabs stand with no note open", () => {
	it("both tabs are there; Shuffle says there is no note and builds none of the body, in both languages", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(q(h, ".semantropy-tabs")!.querySelectorAll("button")).toHaveLength(2);
		expect(selected(h)).toEqual(["shuffle"]);
		const { shuffle, recompose } = panes(h);
		expect([shuffle.hidden, recompose.hidden]).toEqual([false, true]);
		expect(shuffle.textContent).toBe(NO_NOTE);
		expect(shuffle.querySelector(".semantropy-shuffle-empty")!.textContent).toBe(NO_NOTE);
		expect(q(h, ".semantropy-body, .semantropy-generate, .semantropy-load-next")).toBeNull();
		// The tab row, then the Shuffle tab's own area, sit before the one scrolling box, as on a shell with a note.
		const children = Array.from(q(h, ".semantropy-root")!.children);
		expect(children.indexOf(q(h, ".semantropy-tabs")!)).toBe(children.indexOf(q(h, ".semantropy-scroll")!) - 2);
		expect(children.indexOf(q(h, ".semantropy-shuffle-bar")!)).toBe(children.indexOf(q(h, ".semantropy-scroll")!) - 1);
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(shuffle.textContent).toBe(localize(NO_NOTE));
		expect(shuffle.textContent).not.toBe(NO_NOTE);
		expect(tab(h, "recompose").textContent).toBe(ui().workbench.recompose);
	});
	it("Recompose is usable: the Vocabulary entry is there, a Selected Notes Vocabulary can be applied and generated from", async () => {
		const h = harness();
		await h.view.onOpen();
		const entry = q(h, ".semantropy-toolbar-item.is-vocabulary")!;
		expect(entry.hidden).toBe(false);
		expect(entry.querySelector(".semantropy-vocabulary-open")).not.toBeNull();
		// No Vocabulary yet, and no note to call a Current Note: nothing to generate from, and no summary that names one.
		tab(h, "recompose").click();
		expect(selected(h)).toEqual(["recompose"]);
		expect(generateNew(h).disabled).toBe(true);
		expect(q(h, ".semantropy-status-vocabulary")!.textContent).toBe("");
		expect(await h.apply([SOURCE])).toBe("applied");
		expect(generateNew(h).disabled).toBe(false);
		expect(q(h, ".semantropy-status-vocabulary")!.textContent).toContain("Selected Notes");
		await screen(h).run("new");
		expect(units(h)).toBeGreaterThan(0);
		await screen(h).copy();
		expect(h.calls.copy).toHaveLength(1);
		await screen(h).collect();
		expect(h.calls.collect.at(-1)).toMatchObject({ metadataVersion: 5, type: "recompose" });
	});
	it("the output stays through an Open of a note and another, and each Open of a note shows Shuffle; an Open with no note leaves everything as it is", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(await h.apply([SOURCE])).toBe("applied");
		tab(h, "recompose").click();
		await screen(h).run("new");
		const before = Array.from(q(h, ".semantropy-recompose-pane")!.querySelectorAll(".semantropy-recompose-output p:not(.semantropy-recompose-hint)"), p => p.textContent);
		expect(before).toHaveLength(1);
		// A note is opened: the shell is rebuilt, Shuffle is shown, and the Recompose text is still there.
		await h.view.openCapture(note, deps);
		expect(selected(h)).toEqual(["shuffle"]);
		expect(q(h, ".semantropy-generate")).not.toBeNull();
		tab(h, "recompose").click();
		expect(Array.from(q(h, ".semantropy-recompose-pane")!.querySelectorAll(".semantropy-recompose-output p:not(.semantropy-recompose-hint)"), p => p.textContent)).toEqual(before);
		// The Vocabulary went with the note (an Open resets it), and the pane says the text came from another one.
		expect(q(h, ".semantropy-recompose-pane .semantropy-recompose-note")!.textContent).toBe(ui().recompose.changed);
		// WORKBENCH-UI5: an Open that has no note to take (run from the Semantropy pane itself) only brings the View forward. It keeps the
		// note, its body, the tab that is shown and the Recompose text, and resets nothing.
		const shell = q(h, ".semantropy-root")!, ready = h.peek.session.getState();
		await h.view.openCapture({ kind: "none" }, deps);
		expect([q(h, ".semantropy-root"), h.peek.session.getState(), selected(h)]).toEqual([shell, ready, ["recompose"]]);
		expect(Array.from(q(h, ".semantropy-recompose-pane")!.querySelectorAll(".semantropy-recompose-output p:not(.semantropy-recompose-hint)"), p => p.textContent)).toEqual(before);
		expect(q(h, ".semantropy-recompose-pane .semantropy-recompose-note")!.textContent).toBe(ui().recompose.changed);
		tab(h, "shuffle").click();
		expect(q(h, ".semantropy-generate")).not.toBeNull();
		expect(q(h, ".semantropy-target-name")!.textContent).toBe("target");
	});
	it("an Open with no note changes nothing of a View that has a Vocabulary but no note, and starts a View that has neither as it always did", async () => {
		const h = harness();
		await h.view.onOpen();
		// Nothing to keep: the shell is drawn again, on Shuffle, as before.
		tab(h, "recompose").click();
		await h.view.openCapture({ kind: "none" }, deps);
		expect(selected(h)).toEqual(["shuffle"]);
		expect(panes(h).shuffle.textContent).toBe(NO_NOTE);
		// A Vocabulary applied from Selected Notes with no note is kept.
		expect(await h.apply([SOURCE])).toBe("applied");
		const shell = q(h, ".semantropy-root")!, state = h.view.getVocabularyState();
		tab(h, "recompose").click();
		await h.view.openCapture({ kind: "none" }, deps);
		expect([q(h, ".semantropy-root"), h.view.getVocabularyState().snapshot, h.view.getVocabularyState().selection, selected(h)]).toEqual([shell, state.snapshot, state.selection, ["recompose"]]);
		expect(state.snapshot).not.toBeNull();
		// A note is still opened by an Open that has one.
		await h.view.openCapture(note, deps);
		expect(h.peek.session.getState().status).toBe("ready");
	});
	it("while a note is being read and when it cannot be, the tabs stay and Shuffle says nothing of its own", async () => {
		const h = harness();
		await h.view.onOpen();
		const gate = deferred<string>();
		// Without the editor's text the note is read through `readCached`, which waits here.
		const loading = h.view.openCapture({ kind: "markdown", note: { ...note.note, editorText: null } }, { ...deps, readCached: () => gate.promise });
		await vi.waitFor(() => expect(h.view.getVocabularyState().ready).toBe(false));
		expect(q(h, ".semantropy-tabs")).not.toBeNull();
		expect(panes(h).shuffle.textContent).toBe("");
		expect(q(h, ".semantropy-status-vocabulary")!.textContent).toBe("");
		gate.resolve(TARGET); await loading;
		expect(q(h, ".semantropy-generate")).not.toBeNull();
		// A note that cannot be analyzed, opened into a View that has none yet: an error shell, with the tabs and an
		// empty Shuffle pane (the status line has the reason). Opened over a note it keeps the old body, as before.
		const failing = harness();
		failing.state.failTokens = true;
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		await failing.view.onOpen();
		await failing.view.openCapture(note, deps);
		expect(failing.peek.session.getState().status).toBe("error");
		expect(q(failing, ".semantropy-tabs")).not.toBeNull();
		expect(panes(failing).shuffle.textContent).toBe("");
		expect(q(failing, ".semantropy-status")!.textContent).not.toBe("");
	});
	it("a category whose controls are all hidden takes no room with the workbench on, and is as it was without it", async () => {
		const primary = (h: Harness) => q(h, ".semantropy-toolbar-group.is-primary");
		// WORKBENCH-UI5: with tabs the four text actions are not in the Toolbar at all (they stand in the Shuffle tab's
		// own area), so there is no category over nothing with no note, or over four buttons with one.
		const h = harness();
		await h.view.onOpen();
		expect(primary(h)).toBeNull();
		expect(q(h, ".semantropy-toolbar-group.is-vocabulary")!.hidden).toBe(false);
		await h.view.openCapture(note, deps);
		expect(primary(h)).toBeNull();
		// A host with neither flag keeps the empty category, as the web page's host does.
		const plain = harness({});
		await plain.view.onOpen();
		expect(primary(plain)!.hidden).toBe(false);
		// A host that only defers the Shuffle has no tabs: its Toolbar keeps the four, and hides the category with no note.
		const deferOnly = harness({ defer: true });
		await deferOnly.view.onOpen();
		expect(primary(deferOnly)!.hidden).toBe(true);
	});
	it("Display settings fit a narrow pane with the workbench on (a class on the Toolbar and the stylesheet rules that use it); a host without it keeps its look", async () => {
		const css = readFileSync("styles.css", "utf8");
		const rule = (selector: string) => {
			const at = css.indexOf(`\n${selector} {`);
			expect(at, selector).toBeGreaterThan(-1);
			return css.slice(at, css.indexOf("}", at));
		};
		expect(rule(".semantropy-toolbar.is-workbench .semantropy-display-label")).toMatch(/flex-wrap: wrap;[^}]*max-width: 100%;/u);
		expect(rule(".semantropy-toolbar.is-workbench .semantropy-display-label select")).toMatch(/min-width: 0;[^}]*max-width: 100%;/u);
		// The rules are under the class and nowhere else, so the web page (no flag) is not reached.
		expect(css.match(/\.semantropy-display-label select/gu)).toHaveLength(1);
		const toolbar = (h: Harness) => q(h, ".semantropy-toolbar")!;
		const on = harness(); await on.view.onOpen();
		const deferOnly = harness({ defer: true }); await deferOnly.view.onOpen();
		const off = harness({}); await off.view.onOpen();
		expect([toolbar(on).classList.contains("is-workbench"), toolbar(deferOnly).classList.contains("is-workbench"), toolbar(off).classList.contains("is-workbench")])
			.toEqual([true, true, false]);
	});
	it("a host without tabs shows what it always showed with no note: no tab row, no Vocabulary entry", async () => {
		const h = harness({});
		await h.view.onOpen();
		expect(q(h, ".semantropy-tabs, .semantropy-pane, .semantropy-shuffle-empty")).toBeNull();
		expect(q(h, ".semantropy-toolbar-item.is-vocabulary")!.hidden).toBe(true);
		expect(q(h, ".semantropy-vocabulary-open")).toBeNull();
	});
});
