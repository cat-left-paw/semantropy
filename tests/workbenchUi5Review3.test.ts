// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { OPEN_KEPT_MESSAGE } from "../src/view/toolbarStatusModel";
import { VocabularyControls, type VocabularyControlsState } from "../src/view/VocabularyControls";
import type { TargetChoice } from "../src/view/SemantropyView";

/**
 * WORKBENCH-UI5, independent review 2 (`Docs/workbench_ui5_record.md` §23): a pin for each rewrite its hand mutations left standing
 * (P3 5): the summary's rewrite when only the first note changes, the classes and roles the list hangs on, the area's sentence as a
 * status region, the Automatic control's wait for the Vocabulary while a note is read or after one failed, no Notice for an
 * ordinary Open, the dialog's focus home when its button is in a closed More, the list's own alignment, and the tooltip after a
 * language change.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const LEXICON = [token({ surface: "猫", reading: "ネコ" }), token({ surface: "犬", reading: "イヌ" }), token({ surface: "鳥" }), token({ surface: "港", detail1: "固有名詞", detail2: "地域" })];
const TARGET = "猫と犬。\n鳥と港。\n".repeat(6);
const SOURCE = "犬と鳥。港と猫。";

type Flags = { tabs?: boolean; defer?: boolean; recomposeDialog?: boolean };
type Harness = ReturnType<typeof manualMorphHarness> & { notices: string[] };
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(flags: Flags = { tabs: true, defer: true }): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(0);
	h.state.text = TARGET;
	if (flags.tabs !== undefined) h.host.workbenchTabs = flags.tabs;
	if (flags.defer !== undefined) h.host.deferInitialShuffle = flags.defer;
	if (flags.recomposeDialog !== undefined) h.host.recomposeDialog = flags.recomposeDialog;
	const notices: string[] = [];
	h.host.showNotice = message => { notices.push(message); };
	h.host.setDisplaySettings = async () => true;
	const result = Object.assign(h, { notices });
	opened.push(result);
	return result;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const deps = { hashText: async (value: string) => sha256Hex(value), issueSeed: () => 7 };
const markdown = (text: string | null) => ({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: text } }) as const;
const summary = (h: Harness) => q(h, ".semantropy-status-vocabulary")!.textContent;
const toggle = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-vocabulary-sources-toggle");
const automatic = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-automatic-pos-toolbar > button");
const unreadable = (): TargetChoice => ({ capture: { kind: "markdown", note: { sourcePath: "x.md", sourceName: "x.md", editorText: null } }, readCached: async () => { throw new Error("gone"); }, capturedSourceChanged: () => false });
async function applyPaths(h: Harness, paths: string[]) {
	for (const path of paths) h.notes.set(path, SOURCE);
	h.view.setVocabularyDraft({ mode: "selected", paths, drawMode: "uniform" });
	return h.view.applyVocabulary();
}

describe("review 3, P3 5: the summary", () => {
	it("is written again when only the first of the same number of notes changes", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(await applyPaths(h, ["a/x.md", "z.md"])).toBe("applied");
		expect(summary(h)).toBe("Vocabulary: ▶Selected Notes (2) “x.md” and others · Draw mode: Uniform");
		expect(await applyPaths(h, ["b/y.md", "z.md"])).toBe("applied");
		expect(summary(h)).toBe("Vocabulary: ▶Selected Notes (2) “y.md” and others · Draw mode: Uniform");
	});

	it("is written again when the Current Note is another note, with nothing else changed", async () => {
		const h = harness();
		await h.open(TARGET);
		expect(summary(h)).toBe("Vocabulary: Current Note “target.md” · Draw mode: Uniform");
		await h.view.openCapture({ kind: "markdown", note: { sourcePath: "notes/other.md", sourceName: "other", editorText: TARGET } }, { ...deps, readCached: async () => TARGET });
		expect(summary(h)).toBe("Vocabulary: Current Note “other.md” · Draw mode: Uniform");
	});

	it("marks the status line as what the list hangs from and the summary as named, with the list a labelled group; the web page’s line is neither", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(await applyPaths(h, ["a.md", "b.md"])).toBe("applied");
		expect(q(h, ".semantropy-status")!.classList.contains("has-vocabulary-names")).toBe(true);
		expect(q(h, ".semantropy-status-vocabulary")!.classList.contains("is-named")).toBe(true);
		const panel = q(h, ".semantropy-vocabulary-sources")!;
		expect(panel.getAttribute("role")).toBe("group");
		expect(panel.parentElement).toBe(q(h, ".semantropy-status"));
		const web = harness({ recomposeDialog: false });
		await web.open(TARGET);
		expect([q(web, ".semantropy-status")!.classList.contains("has-vocabulary-names"), q(web, ".semantropy-status-vocabulary")!.classList.contains("is-named"), q(web, ".semantropy-vocabulary-sources")]).toEqual([false, false, null]);
	});
});

describe("review 3, P3 5: the area’s sentence about the selected word", () => {
	it("is a polite status region", async () => {
		const h = harness();
		await h.open(TARGET);
		const sentence = q(h, ".semantropy-shuffle-bar .semantropy-manual-diagnostic")!;
		expect([sentence.getAttribute("role"), sentence.getAttribute("aria-live")]).toEqual(["status", "polite"]);
	});
});

describe("review 3, P3 5: the Automatic control waits for the Vocabulary while a note is read and after one that failed", () => {
	it("is put back while a note is being read once no Source is stale (the web-shaped host keeps it off)", async () => {
		const h = harness();
		await h.view.onOpen();
		const gate = deferred<string>();
		const loading = h.view.openCapture(markdown(null), { ...deps, readCached: () => gate.promise });
		await vi.waitFor(() => expect(h.peek.session.getState().status).toBe("loading"));
		expect(automatic(h)!.disabled).toBe(false);
		h.view.notifyVocabularySourceEvent("target.md");
		await h.view.applyStoredDisplaySettings();
		expect(automatic(h)!.disabled).toBe(false);
		gate.resolve(TARGET); await loading;
		expect(h.peek.session.getState().status).toBe("ready");
	});

	it("comes back after a read that failed once a Vocabulary applied with no note is fresh again", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(await applyPaths(h, ["source0.md"])).toBe("applied");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		h.host.chooseTarget = async () => unreadable();
		expect(await h.view.chooseTarget()).toBe("opened");
		expect(h.peek.session.getState().status).toBe("error");
		h.view.notifyVocabularySourceEvent("source0.md");
		expect(h.view.getVocabularyState().stale).toBe(true);
		expect(automatic(h)!.disabled).toBe(true);
		expect(await h.view.applyVocabulary()).toBe("applied");
		expect(h.view.getVocabularyState().stale).toBe(false);
		expect(automatic(h)!.disabled).toBe(false);
	});
});

describe("review 3, P3 5: an ordinary Open says nothing", () => {
	it("an Open of a note into an empty View, a ready View or one that fails to read gives no Notice about a target that stays", async () => {
		const h = harness();
		await h.open(TARGET);
		await h.view.openCapture(markdown(TARGET), { ...deps, readCached: async () => TARGET });
		expect(h.peek.session.getState().status).toBe("ready");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		await h.view.openCapture(markdown(null), { ...deps, readCached: async () => { throw new Error("gone"); } });
		expect(h.notices).not.toContain(OPEN_KEPT_MESSAGE);
		expect(h.notices.filter(notice => notice.includes("stays as it is"))).toEqual([]);
		// And the one that does say it still does: nothing to read here, the View keeps what it has.
		await h.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect(h.notices.filter(notice => notice.includes("stays as it is"))).toHaveLength(1);
	});
});

describe("review 3, P3 5: focus after the dialog when its button is in a closed More", () => {
	it("goes to the More button, not to the hidden button inside it", async () => {
		const h = harness();
		await h.open(TARGET);
		const toolbar = q(h, ".semantropy-toolbar")!;
		Object.defineProperty(toolbar, "clientWidth", { configurable: true, get: () => 60 });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const w = this.classList.contains("semantropy-toolbar-item") || this.classList.contains("semantropy-toolbar-more") ? 32 : 0;
			return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 32, width: w, height: 32, toJSON: () => ({}) };
		});
		h.view.onResize();
		const more = q<HTMLButtonElement>(h, ".semantropy-more-button")!;
		const button = q<HTMLButtonElement>(h, ".semantropy-fake-dictionary-open")!;
		const panel = q(h, ".semantropy-more-menu")!;
		expect([panel.contains(button), panel.hidden]).toEqual([true, true]);
		h.view.openDictionaryHelp();
		expect(document.querySelector(".semantropy-dictionary-help-modal")).not.toBeNull();
		h.view.closeDictionaryHelp();
		expect(document.activeElement).toBe(more);
	});
});

describe("review 3, P3 5: the list hangs from the status line, and the name’s tooltip follows the language", () => {
	it("is aligned from its own container, not from the row’s", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(await applyPaths(h, ["a.md", "b.md", "c.md"])).toBe("applied");
		const panel = q(h, ".semantropy-vocabulary-sources")!, button = toggle(h)!;
		const rect = (left: number, right: number) => ({ x: left, y: 0, left, top: 0, right, bottom: 20, width: right - left, height: 20, toJSON: () => ({}) });
		const status = q(h, ".semantropy-status")!;
		Object.defineProperty(panel, "offsetParent", { configurable: true, get: () => status });
		vi.spyOn(q(h, ".semantropy-toolbar")!, "getBoundingClientRect").mockReturnValue(rect(0, 400));
		vi.spyOn(status, "getBoundingClientRect").mockReturnValue(rect(50, 400));
		vi.spyOn(button, "getBoundingClientRect").mockReturnValue(rect(150, 170));
		button.click();
		expect(panel.hidden).toBe(false);
		// From the status line (left 50), not the Toolbar’s own edge (0): 150 - 50.
		expect(panel.style.left).toBe("100px");
	});

	it("is set again after a language change, because another label is another width", async () => {
		const h = harness();
		await h.open(TARGET);
		const name = q(h, ".semantropy-shuffle-bar .semantropy-target-name")!;
		let cut = false;
		Object.defineProperty(name, "scrollWidth", { configurable: true, get: () => (cut ? 200 : 50) });
		Object.defineProperty(name, "clientWidth", { configurable: true, get: () => 100 });
		h.view.onResize();
		expect(name.hasAttribute("title")).toBe(false);
		// The other language’s label takes more room: the name is cut now, and carries its whole.
		cut = true;
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(name.getAttribute("title")).toBe("target");
	});
});

describe("review 3, P3 7: the summary goes back to the plain line and forgets what it drew", () => {
	it("draws the same Vocabulary again after the line was cleared", () => {
		const parent = document.createElement("div"), line = document.createElement("div"), summary = document.createElement("div");
		line.append(summary); document.body.append(parent, line);
		const selection = { mode: "selected" as const, paths: ["a.md", "b.md"], drawMode: "uniform" as const };
		let current: VocabularyControlsState = { selection, draft: selection, stale: false, staleSources: [], preparing: false, progress: null, error: null, ready: true, applied: true, sources: ["a.md", "b.md"] };
		const controls = new VocabularyControls(parent, summary, { state: () => current, open: () => undefined, names: { adopt: () => undefined } });
		const status = summary.querySelector<HTMLElement>(".semantropy-vocabulary-status")!;
		expect(status.textContent).toBe("Vocabulary: ▶Selected Notes (2) “a.md” and others · Draw mode: Uniform");
		current = { ...current, applied: false, sources: [] };
		controls.sync();
		expect([status.textContent, summary.querySelector(".semantropy-vocabulary-sources-toggle")]).toEqual(["", null]);
		current = { ...current, applied: true, sources: ["a.md", "b.md"] };
		controls.sync();
		expect(status.textContent).toBe("Vocabulary: ▶Selected Notes (2) “a.md” and others · Draw mode: Uniform");
		controls.dispose();
	});
});
