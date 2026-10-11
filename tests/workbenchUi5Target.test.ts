// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { MarkdownView as StubMarkdownView } from "./support/obsidianStub";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { ui } from "../src/i18n/catalog";
import { SemantropyPlugin, type SemantropyTokenizerHost } from "../src/SemantropyPlugin";
import { TargetNotePicker } from "../src/TargetNotePicker";
import type { SemantropyView, SemantropyViewHost, TargetChoice } from "../src/view/SemantropyView";

/**
 * WORKBENCH-UI5, decision 17 of `Docs/release_0_2_0_plan.md` §3.2.2: the Shuffle area's button chooses a Vault
 * note as the target, also while no note is open. The host shows the chooser (the plugin: Obsidian's own file
 * chooser over the Markdown notes, paths only); the note is captured as the Open command captures one and
 * opens by the same rules. An Open that has no note to take only brings the View forward.
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
const FIRST = "猫と犬。\n森と川。\n".repeat(6);
const CHOSEN = "空と猫。\n川と森。\n".repeat(5);
const SOURCE = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。";

type Harness = ReturnType<typeof manualMorphHarness>;
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(chooser?: () => Promise<TargetChoice | null>): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(100);
	h.state.text = FIRST;
	h.host.workbenchTabs = true;
	h.host.deferInitialShuffle = true;
	if (chooser) h.host.chooseTarget = chooser;
	opened.push(h);
	return h;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const chooseButton = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-shuffle-bar .semantropy-target-choose")!;
const targetName = (h: Harness) => q(h, ".semantropy-target-name")!.textContent;
const tab = (h: Harness, name: "shuffle" | "recompose") => q<HTMLButtonElement>(h, `.semantropy-tab-${name}`)!;

/** A note captured the way the plugin captures one: the editor's text when there is one, else a saved read. */
function choice(path: string, text: string, editor: string | null = text): TargetChoice & { reads: string[] } {
	const reads: string[] = [];
	return { reads, capture: { kind: "markdown", note: { sourcePath: path, sourceName: path.split("/").at(-1)!, editorText: editor } },
		readCached: async (sourcePath) => { reads.push(sourcePath); return text; }, capturedSourceChanged: () => false };
}

describe("WORKBENCH-UI5: the Shuffle area's Choose target note", () => {
	it("is offered only when the host can choose, with a name, a description and an icon, also with no note open", async () => {
		const h = harness(async () => null);
		await h.view.onOpen();
		const button = chooseButton(h);
		expect([button.hidden, button.disabled, button.getAttribute("aria-label"), button.hasAttribute("title")]).toEqual([false, false, ui().shuffleBar.choose.name, false]);
		expect(button.ownerDocument.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe(ui().shuffleBar.choose.description);
		expect(button.querySelector(".semantropy-icon svg, .semantropy-icon")).not.toBeNull();
		// With a note open it is still there.
		await h.open(FIRST);
		expect([chooseButton(h).hidden, chooseButton(h).disabled]).toEqual([false, false]);
		// A host that cannot choose has no button to press.
		const without = harness();
		await without.view.onOpen();
		expect(chooseButton(without).hidden).toBe(true);
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(chooseButton(h).getAttribute("aria-label")).toBe("対象ノートを選ぶ");
	});

	it("opens the chosen note by the Open rules: not generated, Shuffle first, the Vocabulary reset, the name shown, and watched for change", async () => {
		const note = choice("notes/chosen.md", CHOSEN);
		const h = harness(async () => note);
		await h.open(FIRST);
		expect(await h.apply([SOURCE])).toBe("applied");
		tab(h, "recompose").click();
		chooseButton(h).click();
		await vi.waitFor(() => expect(targetName(h)).toBe("chosen.md"));
		await vi.waitFor(() => expect(h.peek.session.getState().status).toBe("ready"));
		const state = h.peek.session.getState();
		expect(state.status === "ready" && state.snapshot.sourcePath).toBe("notes/chosen.md");
		expect(state.status === "ready" && state.snapshot.text).toBe(CHOSEN);
		// Nothing was read: the capture carried the text (an editor had it).
		expect(note.reads).toEqual([]);
		// Not generated, on Shuffle, with the Vocabulary back to the Current Note.
		expect(q(h, ".semantropy-generate")!.hidden).toBe(false);
		expect(tab(h, "shuffle").getAttribute("aria-selected")).toBe("true");
		expect(h.view.getVocabularyState().selection.mode).toBe("current");
		expect(h.view.getSourcePath()).toBe("notes/chosen.md");
		// Watched: a change to the note is noticed, as for a note the Open command opened.
		expect(await h.view.reshuffle()).toBe("applied");
		h.view.markSourceLost();
		expect(q(h, ".semantropy-shuffle-bar .semantropy-stale")!.hidden).toBe(false);
	});

	it("works with no note open: the area shows no note, and the choice gives the View its first one", async () => {
		const note = choice("a.md", CHOSEN, null);
		const h = harness(async () => note);
		await h.view.onOpen();
		expect(targetName(h)).toBe(ui().shuffleBar.noTarget);
		expect(await h.view.chooseTarget()).toBe("opened");
		// The text was not in an editor, so it was read once, by the Open, through the capture's reader.
		expect(note.reads).toEqual(["a.md"]);
		expect([targetName(h), h.peek.session.getState().status]).toEqual(["a.md", "ready"]);
		expect(q(h, ".semantropy-generate")!.hidden).toBe(false);
	});

	it("reads nothing until a note is chosen, and a chooser closed without a choice, or one that fails, changes nothing", async () => {
		const gate = deferred<TargetChoice | null>();
		const h = harness(() => gate.promise);
		await h.open(FIRST);
		const reads = h.calls.reads.length, state = h.peek.session.getState(), shell = q(h, ".semantropy-root");
		const pending = h.view.chooseTarget();
		// While the chooser is open: no read, no tokenize, nothing replaced; a second request waits for it.
		expect(await h.view.chooseTarget()).toBe("busy");
		expect([h.calls.reads.length, h.peek.session.getState(), q(h, ".semantropy-root")]).toEqual([reads, state, shell]);
		gate.resolve(null);
		expect(await pending).toBe("cancelled");
		expect([h.calls.reads.length, h.peek.session.getState(), q(h, ".semantropy-root")]).toEqual([reads, state, shell]);
		const failing = harness(async () => { throw new Error("chooser failed"); });
		await failing.open(FIRST);
		const before = failing.peek.session.getState();
		expect(await failing.view.chooseTarget()).toBe("cancelled");
		expect(failing.peek.session.getState()).toBe(before);
		// A host with no chooser: nothing to do.
		const plain = harness();
		await plain.open(FIRST);
		expect(await plain.view.chooseTarget()).toBe("unavailable");
	});

	it("a note that cannot be read leaves the current target as it was, as an Open of a note does", async () => {
		const unreadable: TargetChoice = { capture: { kind: "markdown", note: { sourcePath: "x.md", sourceName: "x.md", editorText: null } },
			readCached: async () => { throw new Error("gone"); }, capturedSourceChanged: () => false };
		const h = harness(async () => unreadable);
		await h.open(FIRST);
		const before = h.peek.session.getState();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(await h.view.chooseTarget()).toBe("opened");
		expect(h.peek.session.getReadySnapshot()).toBe(before.status === "ready" ? before.snapshot : null);
		expect(targetName(h)).toBe("target");
	});

	it("reads a target that is also a Selected Notes source as the Open read it (0.1.0 S3 / S4 review P2)", async () => {
		const note = choice("both.md", CHOSEN);
		const h = harness(async () => note);
		await h.open(FIRST);
		// The note changed on disk after it was captured; Apply must use the text the target was opened with.
		h.notes.set("both.md", "鳥と魚。\n");
		const readCurrent = vi.spyOn(h.host, "readCurrentText");
		expect(await h.view.chooseTarget()).toBe("opened");
		h.view.setVocabularyDraft({ mode: "selected", paths: ["both.md"], drawMode: "uniform" });
		expect(await h.view.applyVocabulary()).toBe("applied");
		const snapshot = h.view.getVocabularyState().snapshot!;
		expect(snapshot.sources.map(source => [source.path, source.contentHash])).toEqual([["both.md", sha256Hex(CHOSEN)]]);
		expect(readCurrent.mock.calls.map(call => call[0])).not.toContain("both.md");
	});
});

describe("WORKBENCH-UI5: an Open that has no note to take", () => {
	it("keeps what a View with a note has, whatever it is showing", async () => {
		const h = harness(async () => null);
		await h.open(FIRST);
		expect(await h.apply([SOURCE])).toBe("applied");
		tab(h, "recompose").click();
		const shell = q(h, ".semantropy-root"), state = h.peek.session.getState(), vocabulary = h.view.getVocabularyState();
		await h.view.openCapture({ kind: "none" }, { readCached: async () => { throw new Error("not read"); } });
		expect([q(h, ".semantropy-root"), h.peek.session.getState(), h.view.getVocabularyState().snapshot, h.view.getVocabularyState().selection, tab(h, "recompose").getAttribute("aria-selected")])
			.toEqual([shell, state, vocabulary.snapshot, vocabulary.selection, "true"]);
		// While a note is still being read the read goes on.
		const gate = deferred<string>();
		const other = harness();
		await other.view.onOpen();
		const loading = other.view.openCapture({ kind: "markdown", note: { sourcePath: "t.md", sourceName: "t.md", editorText: null } }, { readCached: () => gate.promise, hashText: async value => sha256Hex(value), issueSeed: () => 7 });
		await vi.waitFor(() => expect(other.peek.session.getState().status).toBe("loading"));
		await other.view.openCapture({ kind: "none" }, { readCached: async () => "" });
		expect(other.peek.session.getState().status).toBe("loading");
		gate.resolve(FIRST); await loading;
		expect(other.peek.session.getState().status).toBe("ready");
	});

	it("keeps the Selected Notes Vocabulary a View with no note has, and what Recompose made from it", async () => {
		const h = harness(async () => null);
		await h.view.onOpen();
		expect(await h.apply([SOURCE])).toBe("applied");
		const shell = q(h, ".semantropy-root"), vocabulary = h.view.getVocabularyState();
		expect(vocabulary.applied).toBe(true);
		tab(h, "recompose").click();
		q<HTMLButtonElement>(h, ".semantropy-recompose-pane button[aria-label='" + ui().recompose.generate + "']")!.click();
		await vi.waitFor(() => expect(q(h, ".semantropy-recompose-unit")).not.toBeNull());
		const text = q(h, ".semantropy-recompose-pane")!.textContent;
		await h.view.openCapture({ kind: "none" }, { readCached: async () => { throw new Error("not read"); } });
		const after = h.view.getVocabularyState();
		expect([q(h, ".semantropy-root"), after.snapshot, after.selection, after.applied, q(h, ".semantropy-recompose-pane")!.textContent, tab(h, "recompose").getAttribute("aria-selected")])
			.toEqual([shell, vocabulary.snapshot, vocabulary.selection, true, text, "true"]);
	});

	it("closes a Toolbar popup that is open when the chooser opens, so the chooser is not under it", async () => {
		const gate = deferred<TargetChoice | null>();
		const h = harness(() => gate.promise);
		await h.open(FIRST);
		const display = q<HTMLButtonElement>(h, ".semantropy-display-menu-button")!;
		display.click();
		expect(display.getAttribute("aria-expanded")).toBe("true");
		const pending = h.view.chooseTarget();
		expect(display.getAttribute("aria-expanded")).toBe("false");
		gate.resolve(null);
		expect(await pending).toBe("cancelled");
	});
});

describe("WORKBENCH-UI5: the plugin's chooser", () => {
	const note = (path: string): TFile => {
		const file = new TFile();
		file.path = path; file.name = path.split("/").at(-1)!; file.extension = "md";
		return file;
	};
	/** The plugin's View host, over an app whose Vault and panes are fakes. */
	async function plugin(files: TFile[], editors: Record<string, string>) {
		class Probe extends SemantropyPlugin {
			protected createTokenizer(): SemantropyTokenizerHost { throw new Error("not used"); }
		}
		const cachedRead = vi.fn(async (file: TFile) => `saved:${file.path}`);
		const leaves = Object.entries(editors).map(([path, text]) => ({ view: Object.assign(Object.create(StubMarkdownView.prototype) as object, { file: files.find(file => file.path === path), editor: { getValue: () => text } }) }));
		const app = {
			vault: { on: () => ({}), getAbstractFileByPath: () => null, getMarkdownFiles: vi.fn(() => files), cachedRead },
			workspace: { on: () => ({}), getLeavesOfType: (type: string) => type === "markdown" ? leaves : [], getLeaf: () => null, getActiveViewOfType: () => null, setActiveLeaf: () => undefined },
		};
		const instance = new Probe(app as unknown as App, { id: "semantropy", dir: "plugins/semantropy" } as never);
		let create: ((leaf: unknown) => SemantropyView) | null = null;
		Object.assign(instance, {
			registerView: (_type: string, factory: (leaf: unknown) => SemantropyView) => { create = factory; },
			addSettingTab: () => undefined, registerEvent: () => undefined, addRibbonIcon: () => document.createElement("div"),
			addCommand: (command: unknown) => command, loadData: async () => null, saveData: async () => undefined,
		});
		await instance.onload();
		const view = create!({ app });
		const host = Reflect.get(view, "host") as unknown as SemantropyViewHost;
		return { host, app, cachedRead, instance };
	}

	it("offers the choice to the View, lists paths and reads nothing, and captures the chosen note like Open does", async () => {
		const a = note("notes/a.md"), b = note("b.md");
		const { host, app, cachedRead, instance } = await plugin([a, b], { "b.md": "unsaved edit of b" });
		expect(host.chooseTarget).toBeTypeOf("function");
		// Not open in an editor: the saved file is read, by the View, after the choice.
		const pick = vi.spyOn(TargetNotePicker.prototype, "pick").mockResolvedValueOnce(a);
		const first = (await host.chooseTarget!(new AbortController().signal))!;
		expect(pick).toHaveBeenCalledTimes(1);
		expect(app.vault.getMarkdownFiles).toHaveBeenCalled();
		expect(cachedRead).not.toHaveBeenCalled();
		expect(first.capture).toEqual({ kind: "markdown", note: { sourcePath: "notes/a.md", sourceName: "a.md", editorText: null } });
		expect(await first.readCached("notes/a.md")).toBe("saved:notes/a.md");
		await expect(first.readCached("other.md")).rejects.toThrow();
		expect(first.capturedSourceChanged()).toBe(false);
		// Open in an editor (in any pane): its text wins over the saved file.
		pick.mockResolvedValueOnce(b);
		expect((await host.chooseTarget!(new AbortController().signal))!.capture).toEqual({ kind: "markdown", note: { sourcePath: "b.md", sourceName: "b.md", editorText: "unsaved edit of b" } });
		// Closed without a choice: no target.
		pick.mockResolvedValueOnce(null);
		expect(await host.chooseTarget!(new AbortController().signal)).toBeNull();
		instance.onunload();
	});

	it("the chooser lists the notes' paths, settles a microtask after the modal closes, and gives null when it is closed without a choice", async () => {
		const notes = [note("x/one.md"), note("two.md")];
		const picker = new TargetNotePicker({} as App, notes);
		expect(picker.getItems().map(item => picker.getItemText(item))).toEqual(["x/one.md", "two.md"]);
		let settled: TFile | null | undefined;
		const picking = picker.pick().then(file => { settled = file; return file; });
		expect(document.body.contains(picker.containerEl)).toBe(true);
		// Obsidian's selectSuggestion closes the modal first and reports the choice after: the choice is still the result.
		picker.selectSuggestion({ item: notes[1]!, match: { score: 0, matches: [] } }, new Event("click") as never);
		expect(settled).toBeUndefined();
		expect(await picking).toBe(notes[1]);
		const closed = new TargetNotePicker({} as App, notes);
		const waiting = closed.pick();
		closed.close();
		expect(await waiting).toBeNull();
	});
});
