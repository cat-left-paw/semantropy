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
import { ui } from "../src/i18n/catalog";
import { localize } from "../src/i18n/messages";
import { DICTIONARY_DIAGNOSTICS } from "../src/view/dictionaryDiagnosticModel";
import { OPEN_KEPT_MESSAGE } from "../src/view/toolbarStatusModel";
import type { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import type { DisplaySlot } from "../src/analysis/displaySlots";
import type { TargetChoice } from "../src/view/SemantropyView";

/**
 * WORKBENCH-UI5, independent review 2 (`Docs/workbench_ui5_record.md`): the loose ends of review 1's fixes. The scroll position put
 * back after the area is shown; the three rules of the shared code that only a host with tabs follows; a failed read that keeps
 * a Vocabulary applied with no note; the manual count and the selected word's sentence in the area; the chooser's lifetime and
 * focus; the Toolbar's second pass; the Notice for an Open with no note; and a pin for each rewrite review 2's hand
 * mutations left standing.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const LEXICON = [token({ surface: "猫", reading: "ネコ" }), token({ surface: "犬", reading: "イヌ" }), token({ surface: "鳥" }), token({ surface: "港", detail1: "固有名詞", detail2: "地域" })];
const TARGET = "猫と犬。\n鳥と港。\n".repeat(6);
const SOURCE = "犬と鳥。港と猫。";

type Flags = { tabs?: boolean; defer?: boolean; recomposeDialog?: boolean };
type Harness = ReturnType<typeof manualMorphHarness> & { notices: string[]; saved: unknown[] };
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(flags: Flags = { tabs: true, defer: true }, level = 100): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(level);
	h.state.text = TARGET;
	if (flags.tabs !== undefined) h.host.workbenchTabs = flags.tabs;
	if (flags.defer !== undefined) h.host.deferInitialShuffle = flags.defer;
	if (flags.recomposeDialog !== undefined) h.host.recomposeDialog = flags.recomposeDialog;
	const notices: string[] = [], saved: unknown[] = [];
	h.host.showNotice = message => { notices.push(message); };
	h.host.setDisplaySettings = async patch => { saved.push(patch); return true; };
	const result = Object.assign(h, { notices, saved });
	opened.push(result);
	return result;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const tab = (h: Harness, name: "shuffle" | "recompose") => q<HTMLButtonElement>(h, `.semantropy-tab-${name}`)!;
const bar = (h: Harness) => q(h, ".semantropy-shuffle-bar")!;
const dialog = () => document.querySelector<HTMLElement>(".semantropy-dictionary-help-modal");
const deps = { hashText: async (value: string) => sha256Hex(value), issueSeed: () => 7 };
const markdown = (text: string | null) => ({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: text } }) as const;
const wait = (ms = 145) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
/** The reader’s own selection through the real document Selection. */
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
const choice = (path: string, text: string | null, read: () => Promise<string>): TargetChoice =>
	({ capture: { kind: "markdown", note: { sourcePath: path, sourceName: path.split("/").at(-1)!, editorText: text } }, readCached: read, capturedSourceChanged: () => false });
const good = (path = "notes/chosen.md") => choice(path, TARGET, async () => TARGET);
const unreadable = () => choice("x.md", null, async () => { throw new Error("gone"); });
const aboveTabs = (h: Harness) => {
	const children = Array.from(q(h, ".semantropy-root")!.children);
	return children.slice(0, children.findIndex(child => child.classList.contains("semantropy-tabs"))).map(child => child.textContent ?? "");
};

describe("review 2, P3 1: the area is shown before the scroll position is put back", () => {
	it("a position read to the end is put back with the area in place, not cut to the taller box", async () => {
		const h = harness();
		await h.open(TARGET);
		expect(await h.view.reshuffle()).toBe("applied");
		const log: string[] = [];
		const box = q(h, ".semantropy-scroll")!;
		let top = 0;
		Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top, set: (value: number) => { log.push(`scrollTop=${value}`); top = value; } });
		const area = Reflect.get(h.view, "shuffleBar") as { setShown(shown: boolean): void };
		const real = area.setShown.bind(area);
		vi.spyOn(area, "setShown").mockImplementation(shown => { log.push(`area ${shown ? "shown" : "hidden"}`); real(shown); });
		top = 400;
		tab(h, "recompose").click();
		tab(h, "shuffle").click();
		expect(log).toEqual(["area hidden", "scrollTop=0", "area shown", "scrollTop=400"]);
	});
});

describe("review 2, P3 2: three rules of the shared code are a host with tabs’ own; the web-shaped host keeps what it had", () => {
	const web = () => harness({ recomposeDialog: false });
	const toggle = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-automatic-pos-toolbar > button");

	it("the Automatic control is not put back while a note is being read (it was disabled, and stays so)", async () => {
		const h = web();
		await h.view.onOpen();
		const gate = deferred<string>();
		const loading = h.view.openCapture(markdown(null), { ...deps, readCached: () => gate.promise });
		await vi.waitFor(() => expect(h.peek.session.getState().status).toBe("loading"));
		expect(toggle(h)!.disabled).toBe(false);
		h.view.notifyVocabularySourceEvent("target.md");
		await h.view.applyStoredDisplaySettings();
		// The value of main (f4453ca) for the web page’s host.
		expect(toggle(h)!.disabled).toBe(true);
		gate.resolve(TARGET); await loading;
		expect(h.peek.session.getState().status).toBe("ready");
	});

	it("an Open with no note still starts the View again, as it did", async () => {
		const h = web();
		await h.open(TARGET);
		expect(h.peek.session.getState().status).toBe("ready");
		await h.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect([h.peek.session.getState().status, h.peek.contentEl.querySelectorAll(".semantropy-body").length, h.notices]).toEqual(["empty", 0, []]);
	});

	it("Reshuffle text with no note is aborted, not unavailable, as it was; Refresh target is unavailable", async () => {
		const h = web();
		await h.view.onOpen();
		expect([await h.view.reshuffle(), await h.view.refreshSource({ ...deps })]).toEqual(["aborted", "unavailable"]);
	});

	it("the Fake Dictionary dialog is the tabs’ host’s: the web page’s host opens none", async () => {
		const h = web();
		await h.open(TARGET);
		h.view.openDictionaryHelp();
		expect(dialog()).toBeNull();
		expect(q(h, ".semantropy-dictionary-diagnostics")).not.toBeNull();
	});
});

describe("review 2, P3 3: a Vocabulary applied with no note survives a note that cannot be read", () => {
	async function noNoteWithVocabulary() {
		const h = harness();
		await h.view.onOpen();
		expect(await h.apply([SOURCE])).toBe("applied");
		tab(h, "recompose").click();
		const generate = Array.from(q(h, ".semantropy-recompose-pane")!.querySelectorAll<HTMLButtonElement>("button")).find(el => el.getAttribute("aria-label") === ui().recompose.generate)!;
		generate.click();
		await vi.waitFor(() => expect(q(h, ".semantropy-recompose-unit")).not.toBeNull());
		return { h, generate };
	}

	it("keeps the Vocabulary, its summary and the Recompose text, and Generate new still works", async () => {
		const { h, generate } = await noNoteWithVocabulary();
		const before = h.view.getVocabularyState(), text = q(h, ".semantropy-recompose-pane")!.textContent;
		const summary = () => q(h, ".semantropy-status-vocabulary")!.textContent;
		expect(summary()).toBe("Vocabulary: Selected Notes “source0.md” · Draw mode: Uniform");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		h.host.chooseTarget = async () => unreadable();
		expect(await h.view.chooseTarget()).toBe("opened");
		expect(h.peek.session.getState().status).toBe("error");
		const after = h.view.getVocabularyState();
		expect([after.snapshot, after.selection, after.applied, after.sources]).toEqual([before.snapshot, before.selection, true, ["source0.md"]]);
		expect(summary()).toBe("Vocabulary: Selected Notes “source0.md” · Draw mode: Uniform");
		tab(h, "recompose").click();
		expect(q(h, ".semantropy-recompose-pane")!.textContent).toContain(text.slice(0, 20));
		const again = Array.from(q(h, ".semantropy-recompose-pane")!.querySelectorAll<HTMLButtonElement>("button")).find(el => el.getAttribute("aria-label") === ui().recompose.generate)!;
		expect(again.disabled).toBe(false);
		expect(generate.isConnected || again.isConnected).toBe(true);
	});

	it("is replaced by the note’s own once the note has opened", async () => {
		const { h } = await noNoteWithVocabulary();
		h.host.chooseTarget = async () => good();
		expect(await h.view.chooseTarget()).toBe("opened");
		const after = h.view.getVocabularyState();
		expect([after.selection.mode, after.applied, after.sources]).toEqual(["current", true, ["notes/chosen.md"]]);
		expect(q(h, ".semantropy-status-vocabulary")!.textContent).toBe("Vocabulary: Current Note “chosen.md” · Draw mode: Uniform");
	});

	/** Selected Notes with a weight and Frequency, applied with no note. */
	async function weightedWithNoNote() {
		const h = harness();
		await h.view.onOpen();
		h.notes.set("source0.md", SOURCE); h.notes.set("source1.md", `${SOURCE}。`);
		h.view.setVocabularyDraft({ mode: "selected", paths: ["source0.md", "source1.md"], drawMode: "frequency", weights: { "source0.md": 2 } });
		expect(await h.view.applyVocabulary()).toBe("applied");
		return h;
	}
	const fresh = (h: Harness) => { const snapshot = h.view.getVocabularyState().snapshot!; return { draw: snapshot.drawMode, weights: snapshot.sourceWeights ?? null, fingerprint: snapshot.fingerprint, sources: snapshot.sources.map(source => source.path) }; };

	it("the note’s body is made from the note’s own selection, not Selected Notes’ weights and draw mode: the same Snapshot, weights and fingerprint as a plain open", async () => {
		const h = await weightedWithNoNote();
		expect(fresh(h)).toMatchObject({ draw: "frequency", weights: [2, 1] });
		// One of the Sources is the note that is opened.
		h.host.chooseTarget = async () => choice("source0.md", TARGET, async () => TARGET);
		expect(await h.view.chooseTarget()).toBe("opened");
		const plain = harness();
		plain.host.chooseTarget = async () => choice("source0.md", TARGET, async () => TARGET);
		await plain.view.onOpen();
		expect(await plain.view.chooseTarget()).toBe("opened");
		expect(fresh(plain)).toMatchObject({ draw: "uniform", weights: null });
		expect(fresh(h)).toEqual(fresh(plain));
		const after = h.view.getVocabularyState();
		expect([after.selection.mode, after.selection.drawMode, after.selection.weights ?? null, after.sources]).toEqual(["current", "uniform", null, ["source0.md"]]);
		// Nothing is left aside once the note has opened.
		expect(Reflect.get(h.view, "stashedStandalone")).toBeNull();
	});

	it("a View closed while a note is being read gets nothing put back when the read fails", async () => {
		const h = await weightedWithNoNote();
		const gate = deferred<string>();
		const opening = h.view.openCapture({ kind: "markdown", note: { sourcePath: "notes/chosen.md", sourceName: "chosen.md", editorText: null } }, { ...deps, readCached: () => gate.promise });
		await wait(20);
		await h.view.onClose();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		gate.reject(new Error("gone"));
		await opening;
		expect([Reflect.get(h.view, "standaloneVocabulary"), Reflect.get(h.view, "stashedStandalone")]).toEqual([null, null]);
	});

	it("an Open that takes over from another still puts the Vocabulary back when it fails", async () => {
		const h = await weightedWithNoNote();
		const before = h.view.getVocabularyState();
		const slow = deferred<string>();
		const first = h.view.openCapture({ kind: "markdown", note: { sourcePath: "notes/slow.md", sourceName: "slow.md", editorText: null } }, { ...deps, readCached: () => slow.promise });
		await wait(20);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		h.host.chooseTarget = async () => unreadable();
		expect(await h.view.chooseTarget()).toBe("opened");
		slow.resolve(TARGET); await first;
		const now = h.view.getVocabularyState();
		expect([h.peek.session.getState().status, now.snapshot, now.selection, now.applied]).toEqual(["error", before.snapshot, before.selection, true]);
	});

	it("a read that fails puts back the weights and the draw mode as well, and an analysis that fails does the same", async () => {
		const h = await weightedWithNoNote();
		const before = h.view.getVocabularyState();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		h.host.chooseTarget = async () => unreadable();
		expect(await h.view.chooseTarget()).toBe("opened");
		let now = h.view.getVocabularyState();
		expect([h.peek.session.getState().status, now.snapshot, now.selection, now.draft]).toEqual(["error", before.snapshot, before.selection, before.draft]);
		expect([now.selection.drawMode, now.selection.weights]).toEqual(["frequency", { "source0.md": 2 }]);
		// The tokenizer fails after the note was read.
		h.state.failTokens = true;
		h.host.chooseTarget = async () => good();
		expect(await h.view.chooseTarget()).toBe("opened");
		now = h.view.getVocabularyState();
		expect([h.peek.session.getState().status, now.snapshot, now.selection, now.applied, now.sources]).toEqual(["error", before.snapshot, before.selection, true, ["source0.md", "source1.md"]]);
	});

	it("a Source that changes while the note is being read is stale after a failed read, and a change of the note itself is not lost after a good one", async () => {
		const h = await weightedWithNoNote();
		const gate = deferred<string>();
		const opening = h.view.openCapture({ kind: "markdown", note: { sourcePath: "notes/chosen.md", sourceName: "chosen.md", editorText: null } }, { ...deps, readCached: () => gate.promise });
		await wait(20);
		// A Vocabulary Source (put aside) and the note being read both change.
		h.view.notifyVocabularySourceEvent("source1.md", "missing");
		h.view.notifyVocabularySourceEvent("source1.md");
		h.view.notifyVocabularySourceEvent("notes/chosen.md");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		gate.reject(new Error("gone"));
		await opening;
		expect(h.peek.session.getState().status).toBe("error");
		expect(h.view.getVocabularyState().staleSources).toEqual([{ path: "source1.md", reason: "missing" }]);

		const second = await weightedWithNoNote();
		const late = deferred<string>();
		const reading = second.view.openCapture({ kind: "markdown", note: { sourcePath: "notes/chosen.md", sourceName: "chosen.md", editorText: null } }, { ...deps, readCached: () => late.promise });
		await wait(20);
		second.view.notifyVocabularySourceEvent("notes/chosen.md");
		late.resolve(TARGET);
		await reading;
		// The note opened, and it moved while it was read: Generate waits for Refresh target.
		expect(second.peek.session.getState().status).toBe("ready");
		expect(await second.view.generateBody()).toBe("unavailable");
	});
});

describe("review 2, P3 5: the manual changes and the selected word are the Shuffle body’s, and stand in its area", () => {
	it("says both in the area, refers to the sentence from the Shuffle word control, and leaves the tab row where it is", async () => {
		const h = harness({ tabs: true, defer: true }, 0);
		await h.open(TARGET);
		expect(await h.view.reshuffle()).toBe("applied");
		expect(await h.apply([SOURCE])).toBe("applied");
		// One element of each, and in the area (the Toolbar’s status line has none on a host with tabs).
		expect(h.peek.contentEl.querySelectorAll(".semantropy-manual-diagnostic")).toHaveLength(1);
		expect(h.peek.contentEl.querySelectorAll(".semantropy-manual-count")).toHaveLength(1);
		selectWord(h, "猫");
		const sentence = bar(h).querySelector<HTMLElement>(".semantropy-manual-diagnostic")!;
		expect(sentence.hidden).toBe(false);
		expect(sentence.textContent).not.toBe("");
		expect(["available", "unavailable"]).toContain(sentence.dataset["manual"]);
		// The sentence follows the interface language in place.
		const english = sentence.textContent;
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(sentence.textContent).not.toBe(english);
		expect(sentence.textContent).toMatch(/[぀-ヿ一-鿿]/);
		setCurrentUiLanguage("en"); h.view.languageChanged();
		expect(sentence.textContent).toBe(english);
		const shuffle = q<HTMLButtonElement>(h, ".semantropy-manual-shuffle-selected")!;
		expect(shuffle.getAttribute("aria-describedby")).toBe(sentence.id);
		shuffle.click();
		const count = bar(h).querySelector<HTMLElement>(".semantropy-manual-count")!;
		expect([count.hidden, count.textContent]).toEqual([false, ui().toolbar.manualChanges(1)]);
		// A word selected and a change made, and the tab row has the same things above it on both tabs.
		const before = aboveTabs(h);
		tab(h, "recompose").click();
		expect(aboveTabs(h)).toEqual(before);
		tab(h, "shuffle").click();
		expect(aboveTabs(h)).toEqual(before);
		// The selection goes: the sentence goes with it, in the area.
		document.getSelection()!.removeAllRanges();
		document.dispatchEvent(new Event("selectionchange"));
		expect([sentence.hidden, sentence.textContent, shuffle.hasAttribute("aria-describedby")]).toEqual([true, "", false]);
		expect(sentence.dataset["manual"]).toBeUndefined();
		expect(count.hidden).toBe(false);
	});

	it("a host without tabs keeps both in the Toolbar’s status line", async () => {
		const h = harness({}, 0);
		await h.open(TARGET);
		expect(await h.apply([SOURCE])).toBe("applied");
		selectWord(h, "猫");
		const sentence = q(h, ".semantropy-status .semantropy-manual-diagnostic")!;
		expect(sentence.textContent).not.toBe("");
		expect(q(h, ".semantropy-manual-shuffle-selected")!.getAttribute("aria-describedby")).toBe(sentence.id);
		expect(q(h, ".semantropy-shuffle-bar")).toBeNull();
	});
});

describe("review 2, P3 8: the chooser has the View’s lifetime, and focus is not lost", () => {
	it("is told to close when the View closes, and what the host answers late is not used", async () => {
		const h = harness();
		const gate = deferred<TargetChoice | null>();
		let signal: AbortSignal | undefined;
		h.host.chooseTarget = (given) => { signal = given; return gate.promise; };
		await h.open(TARGET);
		const open = vi.spyOn(h.view, "openCapture");
		const pending = h.view.chooseTarget();
		expect(signal!.aborted).toBe(false);
		await h.view.onClose();
		expect(signal!.aborted).toBe(true);
		gate.resolve(good());
		// A choice that arrives after the View closed is not opened, and says so.
		expect(await pending).toBe("aborted");
		expect(open).not.toHaveBeenCalled();
	});

	it("is told to close when the View opens again, and the next request is not busy", async () => {
		const h = harness();
		const signals: AbortSignal[] = [];
		const gate = deferred<TargetChoice | null>();
		h.host.chooseTarget = (given) => { signals.push(given); return signals.length === 1 ? gate.promise : Promise.resolve(null); };
		await h.view.onOpen();
		const first = h.view.chooseTarget();
		expect(await h.view.chooseTarget()).toBe("busy");
		await h.view.onOpen();
		expect(signals[0]!.aborted).toBe(true);
		gate.resolve(good());
		expect(await first).toBe("aborted");
		expect(await h.view.chooseTarget()).toBe("cancelled");
		expect(signals).toHaveLength(2);
	});

	it("an answer to a chooser the View closed does not free the one that replaced it", async () => {
		const h = harness();
		const gates = [deferred<TargetChoice | null>(), deferred<TargetChoice | null>()];
		let asked = 0;
		h.host.chooseTarget = () => gates[asked++]!.promise;
		await h.view.onOpen();
		const first = h.view.chooseTarget();
		await h.view.onOpen();
		const second = h.view.chooseTarget();
		gates[0]!.resolve(null);
		expect(await first).toBe("aborted");
		// The second chooser is still open, so another request waits for it.
		expect(await h.view.chooseTarget()).toBe("busy");
		gates[1]!.resolve(null);
		expect(await second).toBe("cancelled");
	});

	it("leaves focus where the reader put it, and offers no choosing button to a host with no chooser", async () => {
		const h = harness();
		h.host.chooseTarget = async () => good();
		await h.view.onOpen();
		const elsewhere = document.createElement("input"); document.body.appendChild(elsewhere); elsewhere.focus();
		expect(await h.view.chooseTarget()).toBe("opened");
		expect(document.activeElement).toBe(elsewhere);
		const none = harness();
		await none.view.onOpen();
		expect(q(none, ".semantropy-target-choose")!.hidden).toBe(true);
		expect((Reflect.get(none.view, "shuffleBar") as { chooseButton(): HTMLButtonElement | undefined }).chooseButton()).toBeUndefined();
	});

	it("can be asked for again and again: a chooser closed without a choice leaves nothing busy", async () => {
		const h = harness();
		h.host.chooseTarget = async () => null;
		await h.view.onOpen();
		expect([await h.view.chooseTarget(), await h.view.chooseTarget(), await h.view.chooseTarget()]).toEqual(["cancelled", "cancelled", "cancelled"]);
	});

	it("closes the word menu and the definition popover before it opens, as a Toolbar popup would", async () => {
		const h = harness({ tabs: true, defer: true }, 0);
		const gate = deferred<TargetChoice | null>();
		h.host.chooseTarget = () => gate.promise;
		await h.open(TARGET);
		expect(await h.view.reshuffle()).toBe("applied");
		const popover = () => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
		const slot = h.plan().slots.find(candidate => candidate.manualEligible && candidate.dictionaryAvailable)!;
		tokenOf(h, slot).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		expect(q(h, ".semantropy-manual-menu")).not.toBeNull();
		const first = h.view.chooseTarget();
		expect(q(h, ".semantropy-manual-menu")).toBeNull();
		gate.resolve(null); await first;
		tokenOf(h, slot).dispatchEvent(new MouseEvent("pointerover", { bubbles: true, cancelable: true, altKey: true }));
		await wait();
		expect(popover().isOpen()).toBe(true);
		const second = h.view.chooseTarget();
		expect(popover().isOpen()).toBe(false);
		gate.resolve(null); await second;
	});

	it("puts focus on the new choosing button when the first note builds the shell again under the one that was pressed", async () => {
		const h = harness();
		h.host.chooseTarget = async () => good();
		await h.view.onOpen();
		const pressed = q<HTMLButtonElement>(h, ".semantropy-target-choose")!;
		pressed.focus();
		expect(document.activeElement).toBe(pressed);
		expect(await h.view.chooseTarget()).toBe("opened");
		const now = q<HTMLButtonElement>(h, ".semantropy-target-choose")!;
		expect([pressed.isConnected, now === pressed, document.activeElement]).toEqual([false, false, now]);
	});

	it("the plugin’s chooser closes with the signal, answering nothing", async () => {
		const { TFile } = await import("obsidian");
		const { SemantropyPlugin } = await import("../src/SemantropyPlugin");
		class Probe extends SemantropyPlugin {
			protected createTokenizer(): never { throw new Error("not used"); }
		}
		const file = new TFile(); file.path = "a.md"; file.name = "a.md"; file.extension = "md";
		const app = {
			vault: { on: () => ({}), getAbstractFileByPath: () => null, getMarkdownFiles: () => [file], cachedRead: async () => "" },
			workspace: { on: () => ({}), getLeavesOfType: () => [], getLeaf: () => null, getActiveViewOfType: () => null, setActiveLeaf: () => undefined },
		};
		const plugin = new Probe(app as never, { id: "semantropy", dir: "plugins/semantropy" } as never);
		let create: ((leaf: unknown) => { host: { chooseTarget(signal: AbortSignal): Promise<TargetChoice | null> } }) | null = null;
		Object.assign(plugin, {
			registerView: (_type: string, factory: typeof create) => { create = factory; },
			addSettingTab: () => undefined, registerEvent: () => undefined, addRibbonIcon: () => document.createElement("div"),
			addCommand: (command: unknown) => command, loadData: async () => null, saveData: async () => undefined,
		});
		await plugin.onload();
		const host = Reflect.get(create!({ app }), "host");
		const controller = new AbortController();
		const picking = host.chooseTarget(controller.signal);
		expect(document.querySelector(".prompt, .modal-container, div")).not.toBeNull();
		const opened = document.body.children.length;
		controller.abort();
		expect(await picking).toBeNull();
		expect(document.body.children.length).toBeLessThan(opened);
		// A signal already aborted opens nothing.
		const late = new AbortController(); late.abort();
		const count = document.body.children.length;
		expect(await host.chooseTarget(late.signal)).toBeNull();
		expect(document.body.children.length).toBe(count);
		// A note chosen in the same tick as the abort is not opened either: the View does not want it any more.
		const { TargetNotePicker } = await import("../src/TargetNotePicker");
		vi.spyOn(TargetNotePicker.prototype, "pick").mockResolvedValue(file);
		const aborting = new AbortController();
		const chosen = host.chooseTarget(aborting.signal);
		aborting.abort();
		expect(await chosen).toBeNull();
		expect(await host.chooseTarget(new AbortController().signal)).not.toBeNull();
		// The listener goes once the chooser has answered: an abort after that closes nothing.
		const closes = vi.spyOn(TargetNotePicker.prototype, "close");
		const answered = new AbortController();
		await host.chooseTarget(answered.signal);
		answered.abort();
		expect(closes).not.toHaveBeenCalled();
		plugin.onunload();
	});

	it("the Fake Dictionary dialog is closed by a new lifetime, and gives focus to the button that stands when it closes", async () => {
		const h = harness();
		await h.open(TARGET);
		h.view.openDictionaryHelp();
		expect(dialog()).not.toBeNull();
		await h.view.onOpen();
		expect(dialog()).toBeNull();
		await h.open(TARGET);
		const old = q<HTMLButtonElement>(h, ".semantropy-fake-dictionary-open")!;
		old.focus();
		h.view.openDictionaryHelp();
		// The shell is built again under the open dialog (an Open into a View that is not ready).
		h.leaveReady();
		await h.view.openCapture(markdown(TARGET), { ...deps, readCached: async () => TARGET });
		const now = q<HTMLButtonElement>(h, ".semantropy-fake-dictionary-open")!;
		expect(old.isConnected).toBe(false);
		h.view.closeDictionaryHelp();
		expect(document.activeElement).toBe(now);
	});

	it("the dialog leaves no listener behind: a change on its select after it closed saves nothing", async () => {
		const h = harness();
		await h.open(TARGET);
		h.view.openDictionaryHelp();
		const select = dialog()!.querySelector<HTMLSelectElement>("select")!;
		select.value = "shift"; select.dispatchEvent(new Event("change"));
		await vi.waitFor(() => expect(h.saved).toEqual([{ dictionaryModifier: "shift" }]));
		h.view.closeDictionaryHelp();
		select.value = "shift"; select.dispatchEvent(new Event("change"));
		await wait(20);
		expect(h.saved).toEqual([{ dictionaryModifier: "shift" }]);
	});

	it("closes the word menu and the popover before the dialog opens", async () => {
		const h = harness({ tabs: true, defer: true }, 0);
		await h.open(TARGET);
		expect(await h.view.reshuffle()).toBe("applied");
		const popover = () => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
		const slot = h.plan().slots.find(candidate => candidate.manualEligible && candidate.dictionaryAvailable)!;
		tokenOf(h, slot).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		expect(q(h, ".semantropy-manual-menu")).not.toBeNull();
		h.view.openDictionaryHelp();
		expect(q(h, ".semantropy-manual-menu")).toBeNull();
		h.view.closeDictionaryHelp();
		tokenOf(h, slot).dispatchEvent(new MouseEvent("pointerover", { bubbles: true, cancelable: true, altKey: true }));
		await wait();
		expect(popover().isOpen()).toBe(true);
		h.view.openDictionaryHelp();
		expect(popover().isOpen()).toBe(false);
	});

	it("says a Vocabulary is being prepared, not that none was chosen, while a note is being read", async () => {
		const h = harness();
		await h.view.onOpen();
		h.view.openDictionaryHelp();
		const status = () => dialog()!.querySelector("details [role=status]")!.textContent;
		expect(status()).toBe(DICTIONARY_DIAGNOSTICS.none);
		const gate = deferred<string>();
		const loading = h.view.openCapture(markdown(null), { ...deps, readCached: () => gate.promise });
		await vi.waitFor(() => expect(h.peek.session.getState().status).toBe("loading"));
		expect(status()).toBe(DICTIONARY_DIAGNOSTICS.preparing);
		gate.resolve(TARGET); await loading;
	});
});

describe("review 2, P3 10: a Toolbar that still overflows is planned once more", () => {
	it("plans again once when the row overflows after it was placed, and not at all more when it fits", async () => {
		const h = harness();
		await h.open(TARGET);
		const toolbar = Reflect.get(h.view, "toolbar") as { place(moved: ReadonlySet<unknown>): void };
		const place = vi.spyOn(toolbar, "place");
		const root = q(h, ".semantropy-toolbar")!;
		Object.defineProperty(root, "clientWidth", { configurable: true, value: 300 });
		Object.defineProperty(root, "scrollWidth", { configurable: true, value: 300 });
		h.view.onResize();
		expect(place).toHaveBeenCalledTimes(1);
		place.mockClear();
		Object.defineProperty(root, "scrollWidth", { configurable: true, value: 340 });
		h.view.onResize();
		// Twice, however much it overflows: the second pass does not ask for a third.
		expect(place).toHaveBeenCalledTimes(2);
	});
});

describe("review 2, P3 11: an Open with no note to take says why nothing happened", () => {
	it("says so once when it keeps a note, a Vocabulary, a read in progress or an error; the first Open with nothing to keep says nothing", async () => {
		const h = harness();
		await h.view.onOpen();
		await h.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect(h.notices).toEqual([]);
		// A Vocabulary applied with no note.
		expect(await h.apply([SOURCE])).toBe("applied");
		await h.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect(h.notices).toEqual([OPEN_KEPT_MESSAGE]);
		// A read in progress is not interrupted.
		const gate = deferred<string>();
		const loading = h.view.openCapture(markdown(null), { ...deps, readCached: () => gate.promise });
		await vi.waitFor(() => expect(h.peek.session.getState().status).toBe("loading"));
		await h.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect([h.peek.session.getState().status, h.notices.length]).toEqual(["loading", 2]);
		gate.resolve(TARGET); await loading;
		// A note open.
		await h.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect([h.peek.session.getState().status, h.notices.length]).toEqual(["ready", 3]);
		// An error shell.
		const failing = harness();
		failing.state.failTokens = true;
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		await failing.view.onOpen();
		await failing.view.openCapture(markdown(TARGET), { ...deps, readCached: async () => TARGET });
		expect(failing.peek.session.getState().status).toBe("error");
		await failing.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect([failing.peek.session.getState().status, failing.notices]).toEqual(["error", [OPEN_KEPT_MESSAGE]]);
	});

	it("is a sentence that names the way out, in both languages, and the Toolbar announces it", async () => {
		// The condition is the active pane, not whether some note is open (a note beside it does not change that).
		expect(OPEN_KEPT_MESSAGE).toBe("The active pane is not a Markdown note, so the target stays as it is. Click a note first, or use “Choose target note”.");
		expect(ui().shuffleBar.choose.name).toBe("Choose target note");
		setCurrentUiLanguage("ja");
		expect(localize(OPEN_KEPT_MESSAGE)).toBe("いま選ばれているのがMarkdownノートではないので、対象ノートはそのままです。ノートをクリックしてから実行するか、「対象ノートを選ぶ」で選んでください。");
		expect(ui().shuffleBar.choose.name).toBe("対象ノートを選ぶ");
		setCurrentUiLanguage("en");
		const h = harness();
		await h.open(TARGET);
		await h.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect(q(h, ".semantropy-toolbar-feedback")!.textContent).toBe(OPEN_KEPT_MESSAGE);
	});

	it("a host without tabs says nothing: it starts the View again, as the web page does", async () => {
		const h = harness({ recomposeDialog: false });
		await h.open(TARGET);
		await h.view.openCapture({ kind: "none" }, { ...deps, readCached: async () => "" });
		expect(h.notices).toEqual([]);
	});
});

describe("review 2, P3 6: a pin for each rewrite the hand mutations left standing", () => {
	it("the area’s Refresh target does not follow Reshuffle text: with the target moved, Generate waits and Refresh is on", async () => {
		const h = harness();
		await h.open(TARGET);
		const reshuffle = bar(h).querySelector<HTMLButtonElement>(".semantropy-reshuffle")!, refresh = bar(h).querySelector<HTMLButtonElement>(".semantropy-refresh")!;
		expect([reshuffle.disabled, refresh.disabled]).toEqual([false, false]);
		h.view.notifyVocabularySourceEvent(h.view.getSourcePath()!);
		expect([reshuffle.disabled, refresh.disabled]).toEqual([true, false]);
	});

	it("a target that moved shows the stale sentence and the sentence that goes with it, both in the area", async () => {
		const h = harness({ tabs: true, defer: true }, 0);
		await h.open(TARGET);
		expect(await h.view.reshuffle()).toBe("applied");
		h.view.markSourceLost();
		const stale = bar(h).querySelector<HTMLElement>(".semantropy-stale")!, message = bar(h).querySelector<HTMLElement>(".semantropy-message")!;
		const now = (Reflect.get(h.view, "statusModel") as () => { kind: string; message: string | null; detail: string | null }).call(h.view);
		expect([now.kind, now.detail === null]).toEqual(["target-stale", false]);
		expect([stale.hidden, stale.textContent, message.textContent]).toEqual([false, localize(now.message ?? ""), localize(now.detail ?? "")]);
		expect(message.textContent).not.toBe("");
		// The sentence that goes with it is said once: the detail line is empty while the stale line takes the message line.
		const detailLine = bar(h).querySelector<HTMLElement>(".semantropy-status-detail")!;
		expect([detailLine.hidden, detailLine.textContent]).toEqual([true, ""]);
	});

	it("a selection change reaches the area (its sentence about the word) without any other sync", async () => {
		const h = harness({ tabs: true, defer: true }, 0);
		await h.open(TARGET);
		expect(await h.view.reshuffle()).toBe("applied");
		expect(await h.apply([SOURCE])).toBe("applied");
		const sentence = bar(h).querySelector<HTMLElement>(".semantropy-manual-diagnostic")!;
		expect(sentence.hidden).toBe(true);
		selectWord(h, "猫");
		expect(sentence.hidden).toBe(false);
	});

	it("the sentence that says why Generate new is off is drawn only when shown: the stylesheet has its rule, set like the pane's other sentences", () => {
		const css = readFileSync("styles.css", "utf8").replace(/\s+/gu, " ");
		expect(css).toContain(".semantropy-recompose-unusable[hidden] { display: none; }");
		expect(css).toContain(".semantropy-recompose-unusable, .semantropy-recompose-note { margin: 0; color: var(--text-muted); font-size: var(--font-ui-small); }");
	});
});
