// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { EN_MESSAGES, ui } from "../src/i18n/catalog";
import { SHUFFLE_BAR_KINDS, toolbarStatusWithoutBody, toToolbarStatusModel, VOCABULARY_STALE_MESSAGE, type ToolbarStatusModel } from "../src/view/toolbarStatusModel";
import { toSemantropyViewModel } from "../src/view/semantropyViewModel";

/**
 * WORKBENCH-UI5, decisions 16 and 17 of `Docs/release_0_2_0_plan.md` §3.2.2: on a host with tabs the Shuffle tab has
 * its own area under the tab row, outside the scrolling box. It holds the target (its name, and the button that
 * chooses another note), the body's state, and Reshuffle text (Generate text), Refresh target, Copy and Collect. The
 * Toolbar keeps what every tab needs. A host without tabs builds none of it.
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
const deps = { readCached: async () => TARGET, hashText: async (value: string) => sha256Hex(value), issueSeed: () => 7 };
const note = { kind: "markdown", note: { sourcePath: "notes/target.md", sourceName: "target.md", editorText: TARGET } } as const;

type Harness = ReturnType<typeof manualMorphHarness>;
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(flags: { tabs?: boolean; defer?: boolean; recomposeDialog?: boolean } = { tabs: true, defer: true }): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(100);
	h.state.text = TARGET;
	if (flags.tabs !== undefined) h.host.workbenchTabs = flags.tabs;
	if (flags.defer !== undefined) h.host.deferInitialShuffle = flags.defer;
	if (flags.recomposeDialog !== undefined) h.host.recomposeDialog = flags.recomposeDialog;
	opened.push(h);
	return h;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const bar = (h: Harness) => q(h, ".semantropy-shuffle-bar")!;
const button = (h: Harness, cls: string) => q<HTMLButtonElement>(h, `.semantropy-shuffle-bar .semantropy-${cls}`)!;
const tab = (h: Harness, name: "shuffle" | "recompose") => q<HTMLButtonElement>(h, `.semantropy-tab-${name}`)!;
const describedBy = (control: HTMLElement) => control.ownerDocument.getElementById(control.getAttribute("aria-describedby")!)!.textContent;
const toolbarStatus = (h: Harness) => q(h, ".semantropy-status")!;
const barStatus = (h: Harness) => bar(h).querySelector(".semantropy-shuffle-status")!;
/** The area is what one more sync of it would give: nothing it shows is waiting for a later sync. */
function barIsCurrent(h: Harness): boolean {
	const before = bar(h).outerHTML;
	(Reflect.get(h.view, "shuffleBar") as { sync(): void }).sync();
	return bar(h).outerHTML === before;
}

describe("WORKBENCH-UI5: the Shuffle tab's own area", () => {
	it("stands between the tab row and the scrolling box, outside it, and only on a host with tabs", async () => {
		const h = harness();
		await h.open(TARGET);
		const root = q(h, ".semantropy-root")!, row = q(h, ".semantropy-tabs")!, scroll = q(h, ".semantropy-scroll")!;
		expect([row.nextElementSibling, bar(h).nextElementSibling, bar(h).parentElement]).toEqual([bar(h), scroll, root]);
		expect(scroll.contains(bar(h))).toBe(false);
		// Named by reference, not by an aria-label (which would put a tooltip chip over the whole area).
		expect(bar(h).getAttribute("role")).toBe("group");
		expect(bar(h).hasAttribute("aria-label")).toBe(false);
		expect(document.getElementById(bar(h).getAttribute("aria-labelledby")!)!.textContent).toBe(ui().shuffleBar.name);
		// No other host builds it: no flag, defer only, tabs only without the Recompose entry (the web page's host).
		for (const flags of [{}, { defer: true }, { tabs: true, recomposeDialog: false }, { tabs: false }]) {
			const plain = harness(flags);
			await plain.open(TARGET);
			expect(q(plain, ".semantropy-shuffle-bar, .semantropy-target-choose"), JSON.stringify(flags)).toBeNull();
		}
	});

	it("holds Reshuffle text, Refresh target, Copy and Collect with the classes, names and descriptions the Toolbar's had; the Toolbar has none", async () => {
		const h = harness();
		await h.open(TARGET);
		const controls = EN_MESSAGES.toolbar.controls, words = EN_MESSAGES.toolbar.workbench;
		expect(Array.from(bar(h).querySelectorAll(".semantropy-shuffle-bar-actions button"), el => el.getAttribute("aria-label")))
			.toEqual([words.generate.name, controls.refresh.name, controls.copy.name, controls.collect.name]);
		for (const [cls, control] of [["refresh", controls.refresh], ["copy", controls.copy], ["collect", controls.collect]] as const) {
			const el = button(h, cls);
			expect([el.getAttribute("aria-label"), el.querySelector(".semantropy-action-label")!.textContent, describedBy(el), el.hasAttribute("title")])
				.toEqual([control.name, control.name, control.description, false]);
			expect(el.querySelector(".semantropy-icon")!.getAttribute("aria-hidden")).toBe("true");
		}
		expect(describedBy(button(h, "reshuffle"))).toBe(words.generate.description);
		expect(q(h, ".semantropy-toolbar .semantropy-reshuffle, .semantropy-toolbar .semantropy-refresh, .semantropy-toolbar .semantropy-copy, .semantropy-toolbar .semantropy-collect, .semantropy-toolbar-group.is-primary")).toBeNull();
		// One element per control, with ids no other View shares.
		const other = harness();
		await other.open(TARGET);
		const ids = (view: Harness) => Array.from(bar(view).querySelectorAll("[id]"), el => el.id);
		expect(new Set(ids(h)).size).toBe(ids(h).length);
		expect(ids(h).filter(id => ids(other).includes(id))).toEqual([]);
		for (const el of Array.from(bar(h).querySelectorAll("[aria-describedby]"))) expect(document.getElementById(el.getAttribute("aria-describedby")!)).not.toBeNull();
	});

	it("shows the target's name, and a sentence when there is none; nothing is claimed while a note is being read", async () => {
		const h = harness();
		await h.view.onOpen();
		const name = () => bar(h).querySelector(".semantropy-target-name")!;
		expect([name().textContent, name().classList.contains("is-none")]).toEqual([ui().shuffleBar.noTarget, true]);
		// With no note only the choosing button could be there; the four actions are not offered.
		expect(["reshuffle", "refresh", "copy", "collect"].map(cls => button(h, cls).hidden)).toEqual([true, true, true, true]);
		const gate = deferred<string>();
		const loading = h.view.openCapture({ kind: "markdown", note: { ...note.note, editorText: null } }, { ...deps, readCached: () => gate.promise });
		await vi.waitFor(() => expect(h.view.getVocabularyState().ready).toBe(false));
		expect([name().textContent, name().classList.contains("is-none")]).toEqual(["", true]);
		gate.resolve(TARGET); await loading;
		expect([name().textContent, name().classList.contains("is-none")]).toEqual(["target.md", false]);
		expect(bar(h).querySelector(".semantropy-target-label")!.textContent).toBe(ui().shuffleBar.targetLabel);
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(bar(h).querySelector(".semantropy-target-label")!.textContent).toBe("対象ノート:");
	});

	it("says the body's state there, and leaves progress, errors and the Vocabulary in the Toolbar's status line", async () => {
		const h = harness();
		await h.open(TARGET);
		// Not generated: the sentence is the area's; the Toolbar's line has neither it, nor the target, nor the count.
		expect(barStatus(h).textContent).toContain(EN_MESSAGES.status.notGenerated);
		expect(toolbarStatus(h).textContent).not.toContain(EN_MESSAGES.status.notGenerated);
		expect(toolbarStatus(h).textContent).not.toContain("Target:");
		expect(toolbarStatus(h).textContent).toContain("Text Semantropy: ");
		expect(toolbarStatus(h).textContent).toContain("Vocabulary: ");
		// Generated: the count is the area's.
		expect(await h.view.reshuffle()).toBe("applied");
		expect(barStatus(h).querySelector(".semantropy-replacements")!.textContent).toMatch(/^replacements: \d+$/u);
		expect(toolbarStatus(h).textContent).not.toContain("replacements:");
		expect(barStatus(h).querySelector(".semantropy-stale")!.classList.contains("is-stale")).toBe(false);
		// The Target moved on: the stale sentence is the area's too, and it is marked as one.
		h.view.markSourceLost();
		expect(barStatus(h).querySelector(".semantropy-stale")!.classList.contains("is-stale")).toBe(true);
		expect(barStatus(h).querySelector<HTMLElement>(".semantropy-stale")!.hidden).toBe(false);
		expect(barStatus(h).querySelector(".semantropy-stale")!.textContent).not.toBe("");
		expect(toolbarStatus(h).querySelector<HTMLElement>(".semantropy-stale")!.hidden).toBe(true);
		expect(toolbarStatus(h).querySelector(".semantropy-stale")!.textContent).toBe("");
		// A failure of an operation is an error, and errors are read on every tab: the Toolbar's line has it.
		const lifecycle = Reflect.get(h.view, "lifecycle") as { reshuffleNotice: string | null };
		lifecycle.reshuffleNotice = "Could not generate the text. Try again.";
		(Reflect.get(h.view, "updateChrome") as () => void).call(h.view);
		expect(toolbarStatus(h).querySelector(".semantropy-message")!.textContent).toBe("Could not generate the text. Try again.");
		expect(barStatus(h).querySelector(".semantropy-message")!.textContent).toBe("");
	});

	it("keeps the status model's own priority and only routes a message to one of the two places by its kind", () => {
		const ready = toSemantropyViewModel({ status: "empty" } as never);
		const model = (kind: ToolbarStatusModel["kind"]): ToolbarStatusModel => ({ kind, message: "m", detail: "d", sourceLabel: "Target: x", replacementLabel: "replacements: 1", showCancelVocabulary: false, showOnboarding: false });
		expect(SHUFFLE_BAR_KINDS).toEqual(["target-stale", "not-generated", "insufficient-pool", "ready"]);
		for (const kind of ["empty", "loading-target", "preparing-vocabulary", "vocabulary-stale", "error"] as const) {
			expect(toolbarStatusWithoutBody(model(kind)), kind).toEqual({ ...model(kind), sourceLabel: null, replacementLabel: null });
		}
		for (const kind of SHUFFLE_BAR_KINDS) {
			expect(toolbarStatusWithoutBody(model(kind)), kind).toEqual({ ...model(kind), sourceLabel: null, replacementLabel: null, message: null, detail: null });
		}
		// The whole model is unchanged: a host without tabs reads it as before.
		expect(toToolbarStatusModel({ sessionStatus: "empty", model: ready, taskMessage: null, noticeMessage: null,
			vocabulary: { preparing: false, progress: null, error: null, staleSources: [] } }).kind).toBe("empty");
	});

	it("acts through the same View methods as the commands do", async () => {
		const h = harness();
		await h.open(TARGET);
		const reshuffle = vi.spyOn(h.view, "reshuffle"), refresh = vi.spyOn(h.view, "refreshSource");
		const copy = vi.spyOn(h.view, "copySelectedFragment"), collect = vi.spyOn(h.view, "collectSelectedFragment");
		// Not generated: Reshuffle text is Generate text, and nothing can be copied or collected yet.
		expect([button(h, "reshuffle").disabled, button(h, "refresh").disabled, button(h, "copy").disabled, button(h, "collect").disabled]).toEqual([false, false, true, true]);
		button(h, "reshuffle").click();
		await vi.waitFor(() => expect(q(h, ".semantropy-generate")!.hidden).toBe(true));
		expect(reshuffle).toHaveBeenCalledTimes(1);
		expect(button(h, "reshuffle").getAttribute("aria-label")).toBe(EN_MESSAGES.toolbar.controls.reshuffle.name);
		expect([button(h, "copy").disabled, button(h, "collect").disabled]).toEqual([false, false]);
		button(h, "refresh").click();
		expect(refresh).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(button(h, "refresh").disabled).toBe(false));
		// With nothing selected Copy and Collect report it, as the commands do; nothing is written.
		button(h, "copy").click(); button(h, "collect").click();
		await vi.waitFor(() => expect([copy.mock.calls.length, collect.mock.calls.length]).toEqual([1, 1]));
		expect([h.calls.copy, h.calls.collect]).toEqual([[], []]);
	});

	it("hears at once that the target’s file changed: Generate waits for Refresh target, and the Toolbar’s line says why", async () => {
		const h = harness();
		await h.open(TARGET);
		expect([button(h, "reshuffle").disabled, barStatus(h).textContent]).toEqual([false, EN_MESSAGES.status.notGenerated]);
		h.view.notifyVocabularySourceEvent(h.view.getSourcePath()!);
		// The target is its own Source with the Current Note, so this is a stale Vocabulary: the sentence is the Toolbar’s,
		// and the area has the button that now waits.
		expect(button(h, "reshuffle").disabled).toBe(true);
		expect(toolbarStatus(h).querySelector(".semantropy-stale")!.textContent).toBe(VOCABULARY_STALE_MESSAGE);
		expect(await h.view.generateBody()).toBe("unavailable");
		expect(barIsCurrent(h)).toBe(true);
		// A generated body hears it as well: the area is already what a fresh sync of it would give.
		const generated = harness();
		await generated.open(TARGET);
		expect(await generated.view.reshuffle()).toBe("applied");
		generated.view.notifyVocabularySourceEvent(generated.view.getSourcePath()!);
		expect(barIsCurrent(generated)).toBe(true);
	});

	it("is shown with the Shuffle tab only, so the tab row never moves, and focus inside it goes to the tab that replaces it", async () => {
		const h = harness();
		await h.open(TARGET);
		// The same elements above the tab row, and the same status line (the Display settings popup's own note changes, but it is not on screen).
		const aboveTabs = () => [...Array.from(q(h, ".semantropy-root")!.children).slice(0, Array.from(q(h, ".semantropy-root")!.children).indexOf(q(h, ".semantropy-tabs")!)), toolbarStatus(h).textContent];
		const before = aboveTabs();
		expect(bar(h).hidden).toBe(false);
		button(h, "refresh").focus();
		tab(h, "recompose").click();
		expect(bar(h).hidden).toBe(true);
		expect(document.activeElement).toBe(tab(h, "recompose"));
		expect(aboveTabs()).toEqual(before);
		tab(h, "shuffle").click();
		expect(bar(h).hidden).toBe(false);
		expect(aboveTabs()).toEqual(before);
		// Every Open starts on Shuffle, with the area shown.
		tab(h, "recompose").click();
		await h.view.openCapture(note, deps);
		expect(bar(h).hidden).toBe(false);
	});

	it("is three items in one row — the button, the target, the actions — and in a narrow pane the target takes the line under them", () => {
		// The stylesheet with its whitespace collapsed, so a rule is compared as one line of declarations.
		const css = readFileSync("styles.css", "utf8").replace(/\s+/gu, " ");
		const has = (text: string) => expect(css, text).toContain(text);
		has(".semantropy-shuffle-bar { flex: 0 0 auto;");
		has(".semantropy-shuffle-bar-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto;");
		// Placed by column, so a row without the choosing button keeps the others where they are.
		has(".semantropy-shuffle-bar-row > .semantropy-target-choose { grid-column: 1; }");
		has(".semantropy-shuffle-bar-target { grid-column: 2; display: flex; flex-wrap: nowrap; align-items: center; gap: 0.3rem; min-width: 0; }");
		has(".semantropy-shuffle-bar-actions { grid-column: 3; display: flex; flex-wrap: nowrap;");
		has(".semantropy-target-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
		has(".semantropy-shuffle-bar[hidden] { display: none; }");
		// A hidden button of the area is not drawn, whatever the button styles say.
		has(".semantropy-shuffle-bar button[hidden] { display: none; }");
		// Owner change C: at 32rem the first line keeps the button and the actions, the target (label and name) takes the second.
		has("@container semantropy-view (max-width: 32rem) { .semantropy-shuffle-bar-row { grid-template-columns: auto minmax(0, 1fr); }");
		has(".semantropy-shuffle-bar-row > .semantropy-target-choose { grid-row: 1; }");
		has(".semantropy-shuffle-bar-actions { grid-column: 2; grid-row: 1; justify-self: end; }");
		has(".semantropy-shuffle-bar-target { grid-column: 1 / -1; grid-row: 2; }");
		// The word "Target:" is not dropped from sight any more: the name has a line to itself.
		expect(css).not.toContain(".semantropy-target-label { position: absolute;");
	});

	it("puts the choosing button, the target and the actions in the row in that order, whether or not the host can choose", async () => {
		for (const chooser of [true, false]) {
			const h = harness();
			if (chooser) h.host.chooseTarget = async () => null;
			await h.open(TARGET);
			const row = bar(h).querySelector(".semantropy-shuffle-bar-row")!;
			expect(Array.from(row.children, el => el.className.split(" ")[0] === "semantropy-action" ? el.className.split(" ")[1] : el.className), String(chooser))
				.toEqual(["semantropy-target-choose", "semantropy-shuffle-bar-target", "semantropy-shuffle-bar-actions"]);
			expect(Array.from(row.querySelector(".semantropy-shuffle-bar-target")!.children, el => el.className)).toEqual(["semantropy-target-label", "semantropy-target-name"]);
			expect(row.querySelector<HTMLElement>(".semantropy-target-choose")!.hidden).toBe(!chooser);
		}
	});

	it("gives a cut target name its whole as a tooltip, and a name that is not cut none", async () => {
		const h = harness();
		await h.open(TARGET);
		const name = bar(h).querySelector<HTMLElement>(".semantropy-target-name")!;
		expect(name.hasAttribute("title")).toBe(false);
		Object.defineProperty(name, "scrollWidth", { configurable: true, value: 300 });
		Object.defineProperty(name, "clientWidth", { configurable: true, value: 40 });
		h.view.onResize();
		expect(name.getAttribute("title")).toBe("target");
		// A new name is checked when it is written.
		await h.view.openCapture({ kind: "markdown", note: { sourcePath: "notes/long.md", sourceName: "a very long note name", editorText: TARGET } }, deps);
		expect(name.getAttribute("title")).toBe("a very long note name");
		Object.defineProperty(name, "scrollWidth", { configurable: true, value: 40 });
		h.view.onResize();
		expect(name.hasAttribute("title")).toBe(false);
		// With no note there is no name to carry.
		expect(name.textContent).not.toBe("");
	});
});

describe("WORKBENCH-UI5 (decisions 18 and 19): no Recompose in the Toolbar, and icons on the tabs", () => {
	it("the Toolbar has no Recompose control, in the row or in More, and its strings and code are gone", async () => {
		const h = harness();
		await h.open(TARGET);
		expect(q(h, ".semantropy-recompose-open")).toBeNull();
		expect(Object.keys(EN_MESSAGES.toolbar.controls)).not.toContain("recompose");
		expect(Object.keys(ui().toolbar.controls)).not.toContain("recompose");
		expect(Array.from(q(h, ".semantropy-toolbar")!.querySelectorAll("button"), el => el.getAttribute("aria-label"))).not.toContain("Recompose");
		// Where it stood, Phrase generation has its own three again (the Fake Dictionary button is in Settings, owner change A).
		expect(Array.from(q(h, ".semantropy-toolbar-group.is-generation")!.querySelectorAll(".semantropy-toolbar-items > .semantropy-toolbar-item > button"), el => el.getAttribute("aria-label")))
			.toEqual(["Collision", "Fake proverb", "Fake alert"]);
		const css = readFileSync("styles.css", "utf8");
		expect(css).not.toContain("semantropy-recompose-open");
	});

	it("each tab has a glyph before its name — dices for Shuffle, wand-sparkles for Recompose — hidden from assistive technology, and the names are the same", async () => {
		const h = harness();
		await h.open(TARGET);
		for (const [name, icon, text] of [["shuffle", "dices", "Shuffle"], ["recompose", "wand-sparkles", "Recompose"]] as const) {
			const el = tab(h, name);
			const glyph = el.querySelector(".semantropy-icon")!;
			expect([glyph.getAttribute("aria-hidden"), glyph.querySelector("svg")?.getAttribute("class")]).toEqual(["true", `svg-icon lucide-${icon}`]);
			expect(glyph.nextElementSibling!.textContent).toBe(text);
			expect([el.textContent, el.getAttribute("role"), el.hasAttribute("aria-label"), el.hasAttribute("title")]).toEqual([text, "tab", false, false]);
		}
		// The names follow the language; the glyph and the element stay.
		const glyph = tab(h, "shuffle").querySelector(".semantropy-icon");
		const element = tab(h, "shuffle");
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect([tab(h, "shuffle"), tab(h, "shuffle").querySelector(".semantropy-icon"), tab(h, "shuffle").textContent, tab(h, "recompose").textContent]).toEqual([element, glyph, "シャッフル", "再構成"]);
		// They stand on a shell with no note as well.
		await h.view.onOpen();
		expect(tab(h, "shuffle").querySelector(".semantropy-icon svg")).not.toBeNull();
		expect(readFileSync("styles.css", "utf8")).toMatch(/\.semantropy-tab \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*gap: 0\.4em;/u);
	});
});
