// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { defaultSemantropyDisplaySettings, type SemantropyDisplaySettings } from "../src/settings/displaySettings";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { ui } from "../src/i18n/catalog";
import { definitionCacheKey, type DefinitionCache } from "../src/application/definitionCache";
import type { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import type { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import type { RecomposePane } from "../src/view/RecomposePane";

/**
 * FAKE-DICT-RECOMPOSE1, the hover: a word of the Recompose text is looked up with the dictionary modifier, in the same
 * Popover as a word of the Shuffle body, for the Vocabulary the text came from and with no Target note. Nothing here
 * changes what the Shuffle side does (`hoverDictionary.test.ts` and the other hover tests are untouched).
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());

const LEXICON = [
	...[["猫", "ネコ"], ["犬", "イヌ"], ["森", "モリ"], ["川", "カワ"], ["空", "ソラ"], ["駅", "エキ"]].map(([surface, reading]) => token({ surface: surface!, reading })),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "た", pos: "助動詞", detail1: "*" }),
];
const TARGET = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。駅が空を見た。";
const NOTES = ["猫が森を見た。犬が川を見た。", "空が猫を見た。森が犬を見た。駅が空を見た。"];

type Harness = ReturnType<typeof manualMorphHarness> & { display: { value: SemantropyDisplaySettings } };
const opened: Harness[] = [];
afterEach(async () => {
	for (const h of opened.splice(0)) await h.view.onClose();
	vi.useRealTimers(); vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); setCurrentUiLanguage("en");
});
function harness(): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 5000);
	h.state.text = TARGET;
	h.host.workbenchTabs = true;
	const display = { value: defaultSemantropyDisplaySettings() };
	h.host.getDisplaySettings = () => display.value;
	h.host.setDisplaySettings = async patch => { display.value = { ...display.value, ...patch }; return true; };
	const result = Object.assign(h, { display });
	opened.push(result);
	return result;
}
/** A note is open and its own text is the Vocabulary. */
async function withNote(): Promise<Harness> { const h = harness(); await h.open(TARGET); return h; }
/** No note: two notes are the Vocabulary (Selected Notes), applied from an empty View. */
async function withoutNote(): Promise<Harness> {
	const h = harness();
	await h.view.onOpen();
	expect(await h.apply(NOTES)).toBe("applied");
	return h;
}

const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const tab = (h: Harness, name: "shuffle" | "recompose") => q<HTMLButtonElement>(h, `.semantropy-tab-${name}`)!;
const screen = (h: Harness) => Reflect.get(h.view, "recomposeScreen") as RecomposePane;
const output = (h: Harness) => screen(h).outputElement();
const popover = (h: Harness) => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
const world = (h: Harness) => Reflect.get(h.view, "dictionaryWorld") as FakeDictionaryWorld;
const cache = (h: Harness) => Reflect.get(h.view, "definitionCache") as DefinitionCache;
const panel = () => document.querySelector<HTMLElement>(".semantropy-dictionary-popover");
const wordNamed = (h: Harness, surface: string) => Array.from(output(h).querySelectorAll<HTMLElement>(".semantropy-recompose-word")).find(el => el.textContent === surface)!;
const pointer = (el: Element, type = "pointerover", init: MouseEventInit = {}) => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(event); return event; };
const wait = (ms = 145) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const text = (selector: string) => panel()?.querySelector(selector)?.textContent;
const definition = () => text(".semantropy-definition-text");

/** Makes the Recompose text (joint method, enough pieces that every noun of the notes is somewhere in it) and shows the tab. */
async function recomposed(h: Harness): Promise<void> {
	tab(h, "recompose").click();
	const pane = screen(h);
	for (let seed = 0; seed < 30 && !["猫", "犬", "森", "川", "空", "駅"].every(surface => Array.from(output(h).querySelectorAll(".semantropy-recompose-word")).some(el => el.textContent === surface)); seed += 1) await pane.run(seed === 0 ? "new" : "more");
}
async function hover(h: Harness, surface = "猫"): Promise<HTMLElement> {
	const word = wordNamed(h, surface);
	pointer(word, "pointerover", { altKey: true });
	await wait();
	expect(popover(h).isOpen()).toBe(true);
	return word;
}
async function until(check: () => boolean, ms = 600): Promise<void> {
	for (let waited = 0; waited < ms && !check(); waited += 10) await wait(10);
}

describe("looking a word of the Recompose text up", () => {
	it("opens the Popover for a word with the modifier, with the headword, its reading and a definition, and no Collect", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		expect(text(".semantropy-definition-headword")).toBe("猫");
		expect(text(".semantropy-definition-reading")).toBe("ネコ");
		expect(definition()).toBeTruthy();
		expect(panel()!.querySelector<HTMLButtonElement>(".semantropy-reshuffle-definition")!.disabled).toBe(false);
		expect(panel()!.querySelector<HTMLButtonElement>(".semantropy-copy-definition")!.disabled).toBe(false);
		expect(panel()!.querySelector<HTMLButtonElement>(".semantropy-collect-definition")!.hidden).toBe(true);
		expect(world(h).getCurrent()!.snapshot).toBeNull();
		// Nothing was read or tokenized for it, and nothing was written.
		expect(h.calls.collect).toEqual([]);
	});

	it("opens it with no note open, for the Vocabulary of the applied notes", async () => {
		const h = await withoutNote();
		expect(q(h, ".semantropy-body")).toBeNull();
		await recomposed(h);
		const tokenizations = h.calls.tokenizations.length, reads = h.calls.reads.length;
		await hover(h, "犬");
		expect(text(".semantropy-definition-headword")).toBe("犬");
		expect(definition()).toBeTruthy();
		expect(world(h).getCurrent()!.snapshot).toBeNull();
		expect([h.calls.tokenizations.length, h.calls.reads.length]).toEqual([tokenizations, reads]);
	});

	it("gives a word the definition it has in the Shuffle body: one cache entry for both panes", async () => {
		const h = await withNote();
		// The Shuffle body first.
		const slot = h.current("猫");
		const token = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(el => h.controller().getSlotForElement(el) === slot)!;
		pointer(token, "pointerover", { altKey: true }); await wait();
		expect(popover(h).isOpen()).toBe(true);
		const shuffleSide = definition();
		popover(h).close();
		expect(cache(h).size).toBe(1);
		await recomposed(h);
		await hover(h);
		expect(definition()).toBe(shuffleSide);
		expect(cache(h).size).toBe(1);
	});

	it("does not open for text that is not a word, nor from the Shuffle tab, nor without the modifier", async () => {
		const h = await withNote();
		await recomposed(h);
		const unit = output(h).querySelector<HTMLElement>(".semantropy-recompose-unit")!;
		pointer(unit, "pointerover", { altKey: true }); await wait();
		expect(popover(h).isOpen()).toBe(false);
		pointer(wordNamed(h, "猫"), "pointerover"); await wait();
		expect(popover(h).isOpen()).toBe(false);
	});

	it("leaves the pointer and the branch point alone: a click on the word still chooses its piece, and closes the Popover", async () => {
		const h = await withNote();
		await recomposed(h);
		const word = await hover(h);
		pointer(word, "pointerdown", { button: 0 });
		expect(popover(h).isOpen()).toBe(false);
		word.click();
		expect(word.closest(".semantropy-recompose-unit")!.classList.contains("is-branch")).toBe(true);
		// There is no word cursor: the pointer is the sentence's own.
		const css = readFileSync("styles.css", "utf8");
		expect(css).not.toMatch(/semantropy-recompose-word[^{}]*\{[^}]*cursor/);
		expect(css).toMatch(/\.semantropy-recompose-unit \{ cursor: pointer;/);
	});
});

describe("the Popover on a Recompose word", () => {
	it("copies the headword and the definition, and Collect has nothing to write", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		const shown = definition();
		panel()!.querySelector<HTMLButtonElement>(".semantropy-copy-definition")!.click();
		await wait(20);
		expect(h.calls.copy.at(-1)).toBe(`猫\n${shown}`);
		expect(await h.view.collectDefinition()).toBe("empty");
		expect(h.calls.collect).toEqual([]);
	});

	it("reshuffles its definition without a Target, and stays open", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		const before = world(h).getCurrent()!;
		panel()!.querySelector<HTMLButtonElement>(".semantropy-reshuffle-definition")!.click();
		await wait(20);
		const after = world(h).getCurrent()!;
		expect(popover(h).isOpen()).toBe(true);
		expect(after.dictionarySeed).not.toBe(before.dictionarySeed);
		expect(after.snapshot).toBeNull();
		expect(definition()).toBe(after.result.outcome === "generated" ? after.result.definition : "");
	});

	it("changes the level, and with a note open makes the Shuffle body's markers again", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		const prepare = vi.spyOn(h.controller(), "prepareMarkers");
		expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(75))).toBe("applied");
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(world(h).getCurrent()).toMatchObject({ dictionarySemantropy: 75, snapshot: null });
		expect(popover(h).isOpen()).toBe(true);
		expect(h.state.dictionary).toBe(75);
	});

	it("changes the level with no note open, and makes no markers", async () => {
		const h = await withoutNote();
		await recomposed(h);
		await hover(h);
		const prepare = vi.spyOn(h.controller(), "prepareMarkers");
		expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(75))).toBe("applied");
		expect(prepare).not.toHaveBeenCalled();
		expect(world(h).getCurrent()).toMatchObject({ dictionarySemantropy: 75, snapshot: null });
		expect(popover(h).isOpen()).toBe(true);
	});

	it("closes with Escape and when either box scrolls: the Recompose text, or the View's", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(popover(h).isOpen()).toBe(false);
		await hover(h);
		output(h).dispatchEvent(new Event("scroll"));
		expect(popover(h).isOpen()).toBe(false);
		await hover(h);
		q(h, ".semantropy-scroll")!.dispatchEvent(new Event("scroll"));
		expect(popover(h).isOpen()).toBe(false);
	});

	it("is re-worded in place by a language change, with its word still the anchor", async () => {
		const h = await withNote();
		await recomposed(h);
		const word = await hover(h);
		const root = panel();
		setCurrentUiLanguage("ja");
		h.view.languageChanged();
		expect(popover(h).isOpen()).toBe(true);
		expect(panel()).toBe(root);
		expect(popover(h).getTarget()!.anchor).toBe(word);
		expect(word.isConnected).toBe(true);
		expect(text(".semantropy-definition-title")).toBe(ui().dictionary.popoverTitle);
	});
});

describe("when the words can no longer be looked up", () => {
	const marked = (h: Harness) => output(h).classList.contains("is-dictionary-marked");

	it("marks the words while they can, and not otherwise: the tab, the dictionary marker setting", async () => {
		const h = await withNote();
		await recomposed(h);
		expect(marked(h)).toBe(true);
		expect(await h.view.changeDisplaySettings({ showDictionaryMarkers: false })).toBe("applied");
		expect(marked(h)).toBe(false);
		expect(await h.view.changeDisplaySettings({ showDictionaryMarkers: true })).toBe("applied");
		expect(marked(h)).toBe(true);
		// The Shuffle tab is shown: the text is hidden and the mark goes with the lookup.
		tab(h, "shuffle").click();
		expect(marked(h)).toBe(false);
		tab(h, "recompose").click();
		expect(marked(h)).toBe(true);
	});

	it("takes away the mark and the Popover when the tab is left, and does not bring the Popover back", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		tab(h, "shuffle").click();
		expect(popover(h).isOpen()).toBe(false);
		expect(panel()).toBeNull();
		tab(h, "recompose").click();
		expect(popover(h).isOpen()).toBe(false);
	});

	it("takes them away when the text's Vocabulary is no longer the active one, and gives the mark back with it", async () => {
		const h = await withoutNote();
		await recomposed(h);
		await hover(h);
		expect(await h.apply([NOTES[0]!])).toBe("applied");
		expect(popover(h).isOpen()).toBe(false);
		expect(marked(h)).toBe(false);
		pointer(wordNamed(h, "猫"), "pointerover", { altKey: true }); await wait();
		expect(popover(h).isOpen()).toBe(false);
	});

	it("takes them away when a Source of the Vocabulary changed", async () => {
		const h = await withoutNote();
		await recomposed(h);
		await hover(h);
		h.view.notifyVocabularySourceEvent("source0.md");
		expect(popover(h).isOpen()).toBe(false);
		expect(marked(h)).toBe(false);
		pointer(wordNamed(h, "猫"), "pointerover", { altKey: true }); await wait();
		expect(popover(h).isOpen()).toBe(false);
	});

	it("takes them away while another piece of work holds the View, and gives the mark back after", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		const lifecycle = Reflect.get(h.view, "lifecycle") as { busy: { acquire(): unknown; release(token: unknown): void } };
		const busy = lifecycle.busy.acquire();
		(Reflect.get(h.view, "updateChrome") as () => void).call(h.view);
		expect(marked(h)).toBe(false);
		popover(h).close();
		pointer(wordNamed(h, "猫"), "pointerover", { altKey: true }); await wait();
		expect(popover(h).isOpen()).toBe(false);
		lifecycle.busy.release(busy);
		(Reflect.get(h.view, "updateChrome") as () => void).call(h.view);
		expect(marked(h)).toBe(true);
	});

	it("takes the Popover away when the View closes", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		await h.view.onClose();
		expect(panel()).toBeNull();
	});

	it("takes the Popover away when the words on screen are drawn again, though the text is the same", async () => {
		const h = await withNote();
		await recomposed(h);
		const word = await hover(h);
		// Nothing about the Vocabulary or the text changed; the element the Popover stands at is gone.
		screen(h).render(null);
		expect(word.isConnected).toBe(false);
		popover(h).validate();
		expect(popover(h).isOpen()).toBe(false);
		await hover(h);
	});

	it("takes them away when the text is made again or cleared", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		await screen(h).run("new");
		expect(popover(h).isOpen()).toBe(false);
		await recomposed(h);
		await hover(h);
		screen(h).clear();
		expect(popover(h).isOpen()).toBe(false);
		expect(marked(h)).toBe(false);
	});
});

describe("the definition cache and the Target note", () => {
	const entryOf = (h: Harness) => {
		const c = world(h).getCurrent()!;
		return cache(h).getForWorld(definitionCacheKey(c.headword, c.dictionarySeed, c.dictionarySemantropy, c.vocabulary))!;
	};
	const target = (hash: string) => ({ sourcePath: "target.md", contentHash: hash });
	async function shuffleHover(h: Harness, surface = "猫"): Promise<void> {
		tab(h, "shuffle").click();
		const slot = h.current(surface);
		const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(item => h.controller().getSlotForElement(item) === slot)!;
		pointer(el, "pointerover", { altKey: true });
		await until(() => popover(h).isOpen());
		expect(popover(h).isOpen()).toBe(true);
	}
	/** A note open whose Vocabulary is two other notes, so the Target can be reloaded without the Vocabulary changing. */
	async function withNoteAndNotes(): Promise<Harness> {
		const h = await withNote();
		expect(await h.apply(NOTES)).toBe("applied");
		return h;
	}

	it("made on the Shuffle side, met on the Recompose side: the entry keeps its Target and the Recompose definition has none", async () => {
		const h = await withNoteAndNotes();
		await shuffleHover(h);
		const hash = sha256Hex(TARGET);
		expect(world(h).getCurrent()!.snapshot).toEqual(target(hash));
		const made = entryOf(h);
		expect(made.target).toEqual(target(hash));
		popover(h).close();
		await recomposed(h);
		await hover(h);
		expect(world(h).getCurrent()!.snapshot).toBeNull();
		expect(entryOf(h)).toBe(made);
		expect(entryOf(h).target).toEqual(target(hash));
		expect(cache(h).size).toBe(1);
		// Still nothing to collect for the Recompose definition, though the entry has a Target.
		expect(await h.view.collectDefinition()).toBe("empty");
		expect(h.calls.collect).toEqual([]);
	});

	it("made on the Recompose side, met on the Shuffle side: committed with the Target it has now, written into the entry, and kept through a reload of the Target alone", async () => {
		const h = await withNoteAndNotes();
		await recomposed(h);
		await hover(h);
		const recomposedText = definition();
		expect(entryOf(h).target).toBeNull();
		popover(h).close();
		await shuffleHover(h);
		const first = target(sha256Hex(TARGET));
		expect(definition()).toBe(recomposedText);
		expect(world(h).getCurrent()!.snapshot).toEqual(first);
		expect(entryOf(h).target).toEqual(first);
		// From here on it is an entry the Shuffle side made: Collect pairs this definition with this Target.
		expect(await h.view.collectDefinition()).not.toBe("empty");
		expect(h.calls.collect.at(-1)).toMatchObject({ type: "fake-dictionary", target: { path: "target.md", contentHash: first.contentHash } });
		popover(h).close();
		// The Target alone is reloaded (the Vocabulary is the two notes, which did not change).
		h.state.text = `${TARGET}猫が駅を見た。`;
		expect(await h.view.refreshSource({ hashText: async () => "reloaded-hash" })).toBe("refreshed");
		await shuffleHover(h);
		expect(definition()).toBe(recomposedText);
		expect(world(h).getCurrent()!.snapshot).toEqual(first);
		expect(world(h).getCurrent()!.snapshot).not.toEqual(target("reloaded-hash"));
	});

	it("made and met on the Recompose side: the entry never gets a Target", async () => {
		const h = await withNoteAndNotes();
		await recomposed(h);
		await hover(h);
		const made = entryOf(h);
		expect(made.target).toBeNull();
		popover(h).close();
		await hover(h);
		expect(entryOf(h)).toEqual(made);
		expect(entryOf(h).target).toBeNull();
		expect(world(h).getCurrent()!.snapshot).toBeNull();
		expect(cache(h).size).toBe(1);
	});

	it("made and met on the Shuffle side: unchanged, and collected with its Target", async () => {
		const h = await withNoteAndNotes();
		await shuffleHover(h);
		const made = entryOf(h);
		popover(h).close();
		await shuffleHover(h);
		expect(entryOf(h)).toEqual(made);
		expect(await h.view.collectDefinition()).not.toBe("empty");
		expect(h.calls.collect.at(-1)).toMatchObject({ type: "fake-dictionary", target: { path: "target.md" } });
	});

	it("keeps a word's other definitions: reshuffling one word on the Recompose side does not touch another cached word", async () => {
		const h = await withNoteAndNotes();
		await recomposed(h);
		await hover(h, "猫");
		const catBefore = definition();
		popover(h).close();
		await hover(h, "犬");
		const dog = definition();
		const seedBefore = world(h).getCurrent()!.dictionarySeed;
		panel()!.querySelector<HTMLButtonElement>(".semantropy-reshuffle-definition")!.click();
		await wait(20);
		// The reshuffle drew a new nonce for the dictionary: a word looked up afterwards is found in the shared cache (it was made
		// with the old nonce), not made again with the new one. Compared with the definition from before the reshuffle (review 1, P3 4).
		expect(world(h).getCurrent()!.dictionarySeed).not.toBe(seedBefore);
		popover(h).close();
		await hover(h, "猫");
		const cat = definition();
		expect(cat).toBe(catBefore);
		popover(h).close();
		await hover(h, "猫");
		expect(definition()).toBe(cat);
		expect(dog).toBeTruthy();
	});
});

describe("the rest of the conditions", () => {
	const marked = (h: Harness) => output(h).classList.contains("is-dictionary-marked");

	it("takes them away while a Vocabulary is being prepared, and gives them back when that is cancelled", async () => {
		const h = await withoutNote();
		await recomposed(h);
		await hover(h);
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const read = h.host.readCurrentText;
		h.host.readCurrentText = async path => { await gate; return read(path); };
		h.view.setVocabularyDraft({ mode: "selected", paths: ["source0.md"], drawMode: "uniform" });
		const applying = h.view.applyVocabulary();
		expect(popover(h).isOpen()).toBe(false);
		expect(marked(h)).toBe(false);
		pointer(wordNamed(h, "猫"), "pointerover", { altKey: true }); await wait();
		expect(popover(h).isOpen()).toBe(false);
		h.view.cancelVocabulary();
		release();
		await applying;
		expect(marked(h)).toBe(true);
		await hover(h);
	});

	it("takes them away when the note the Vocabulary comes from changes", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		h.view.notifyVocabularySourceEvent("target.md");
		expect(popover(h).isOpen()).toBe(false);
		expect(marked(h)).toBe(false);
	});

	it("looks a word up and changes the level for a note opened without a Shuffle, making the body's markers", async () => {
		const h = harness();
		h.host.deferInitialShuffle = true;
		await h.open(TARGET);
		await recomposed(h);
		await hover(h);
		const prepare = vi.spyOn(h.controller(), "prepareMarkers");
		expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(25))).toBe("applied");
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(popover(h).isOpen()).toBe(true);
	});

	it("is the dictionary level the Shuffle side uses: a level changed there is the level of the next Recompose lookup", async () => {
		const h = await withNote();
		await recomposed(h);
		h.state.dictionary = assertDictionarySemantropy(75);
		await hover(h);
		expect(world(h).getCurrent()!.dictionarySemantropy).toBe(75);
		expect((panel()!.querySelector<HTMLSelectElement>(".semantropy-dictionary-level-select"))!.value).toBe("75");
	});

	it("writes nothing and tokenizes nothing: no Vault write, no Clipboard write, no extra read", async () => {
		const h = await withNote();
		await recomposed(h);
		const before = { tokenizations: h.calls.tokenizations.length, reads: h.calls.reads.length };
		await hover(h);
		panel()!.querySelector<HTMLButtonElement>(".semantropy-reshuffle-definition")!.click();
		await wait(20);
		expect({ tokenizations: h.calls.tokenizations.length, reads: h.calls.reads.length }).toEqual(before);
		expect([h.calls.copy, h.calls.collect]).toEqual([[], []]);
	});
});

describe("the stylesheet", () => {
	const css = readFileSync("styles.css", "utf8");
	const escaped = (value: string) => value.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
	const rule = (selector: string) => new RegExp(`(?:^|\\n)${escaped(selector)}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;

	it("marks a Recompose word with the very underline the Shuffle body's dictionary marker has", () => {
		const shuffle = rule(".semantropy-body .semantropy-dictionary-available");
		const recompose = rule(".semantropy-recompose-output.is-dictionary-marked .semantropy-recompose-word");
		expect(shuffle).not.toBeNull();
		expect(recompose!.trim()).toBe(shuffle!.trim());
	});

	it("marks only while the View says so, and gives a word no cursor of its own", () => {
		// No rule styles a word unconditionally: the only one is under the View's `is-dictionary-marked`.
		expect(css).not.toMatch(/(?:^|\n)\.semantropy-recompose-word\s*\{/);
		expect(Array.from(css.matchAll(/[^{}]*\.semantropy-recompose-word[^{}]*\{/g), match => match[0].trim().replace(/^\/\*[\s\S]*?\*\/\s*/, ""))).toEqual([
			".semantropy-recompose-output.is-dictionary-marked .semantropy-recompose-word {",
		]);
		expect(css).not.toMatch(/\.semantropy-recompose-word[^{}]*\{[^}]*cursor/);
		expect(css).toMatch(/\.semantropy-recompose-unit \{ cursor: pointer;/);
	});
});

describe("moving about the text", () => {
	it("closes the Popover at once for the next word, which opens after the delay", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h, "猫");
		pointer(wordNamed(h, "犬"), "pointerover", { altKey: true });
		expect(popover(h).isOpen()).toBe(false);
		await wait();
		expect(popover(h).isOpen()).toBe(true);
		expect(text(".semantropy-definition-headword")).toBe("犬");
	});
});

describe("the Display settings' note", () => {
	it("says the dictionary marker reaches the Recompose text, and the other markers and word changes do not", () => {
		setCurrentUiLanguage("en");
		const en = ui().toolbar.workbench.shuffleOnly;
		expect(en).toContain("replacement and manual markers");
		expect(en).toContain("Shuffle tab only");
		expect(en).toMatch(/dictionary marker also marks the words of the Recompose text/);
		setCurrentUiLanguage("ja");
		const ja = ui().toolbar.workbench.shuffleOnly;
		expect(ja).toContain("置換マーカーと手動マーカー");
		expect(ja).toMatch(/辞書マーカーは、再構成の文の中の、引ける語にも付きます/);
	});
});

/**
 * Review 1, P3 1: the Recompose text's mark reads both busy gates (the View's and the dictionary's), so it must follow them in
 * and out, whichever operation held them and wherever the tab was when it ended.
 */
describe("the mark follows the View's busy gates", () => {
	const marked = (h: Harness) => output(h).classList.contains("is-dictionary-marked");
	const flush = () => wait(10);
	/** Holds the Clipboard write of the next Copy until the returned function is called. */
	function holdClipboard(h: Harness): () => void {
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		h.host.writeClipboard = async value => { h.calls.copy.push(value); await gate; };
		return release;
	}
	async function noteAndNotes(): Promise<Harness> {
		const h = await withNote();
		expect(await h.apply(NOTES)).toBe("applied");
		return h;
	}
	async function shuffleSideHover(h: Harness, surface = "猫"): Promise<void> {
		tab(h, "shuffle").click();
		const slot = h.current(surface);
		const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(item => h.controller().getSlotForElement(item) === slot)!;
		pointer(el, "pointerover", { altKey: true });
		await until(() => popover(h).isOpen());
		expect(popover(h).isOpen()).toBe(true);
	}

	it("goes while a Recompose Popover's Copy is writing, and is back when it has written", async () => {
		const h = await noteAndNotes();
		await recomposed(h);
		await hover(h);
		expect(marked(h)).toBe(true);
		const release = holdClipboard(h);
		panel()!.querySelector<HTMLButtonElement>(".semantropy-copy-definition")!.click();
		await flush();
		expect(marked(h)).toBe(false);
		// The Popover itself stays: its own Copy must not close it.
		expect(popover(h).isOpen()).toBe(true);
		release();
		await until(() => marked(h));
		expect(marked(h)).toBe(true);
		expect(popover(h).isOpen()).toBe(true);
	});

	it("is back after a Vault file changed during that Copy (a)", async () => {
		const h = await noteAndNotes();
		await recomposed(h);
		await hover(h);
		const release = holdClipboard(h);
		panel()!.querySelector<HTMLButtonElement>(".semantropy-copy-definition")!.click();
		await flush();
		// A note outside the Vocabulary changes: the View syncs the mark once, while the gate is held.
		h.view.notifyVocabularySourceEvent("elsewhere.md");
		expect(marked(h)).toBe(false);
		release();
		await until(() => marked(h));
		expect(marked(h)).toBe(true);
	});

	it("is back when the Shuffle side's Copy ends after the tab was switched (b)", async () => {
		const h = await noteAndNotes();
		await recomposed(h);
		await shuffleSideHover(h);
		const release = holdClipboard(h);
		panel()!.querySelector<HTMLButtonElement>(".semantropy-copy-definition")!.click();
		await flush();
		tab(h, "recompose").click();
		expect(marked(h)).toBe(false);
		release();
		await until(() => marked(h));
		expect(marked(h)).toBe(true);
	});

	it("is back when a Refresh that began on the other tab fails (c)", async () => {
		const h = await noteAndNotes();
		await recomposed(h);
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const read = h.host.readCurrentText;
		h.host.readCurrentText = async path => { if (path === "target.md") await gate; return read(path); };
		h.state.failTokens = true;
		const refreshing = h.view.refreshSource({ hashText: async () => "reloaded-hash" });
		// Refresh shows the Shuffle tab; the reader goes back to the Recompose text while it works.
		tab(h, "recompose").click();
		expect(marked(h)).toBe(false);
		release();
		expect(await refreshing).not.toBe("refreshed");
		h.state.failTokens = false;
		await until(() => marked(h));
		expect(marked(h)).toBe(true);
	});
});

/** Review 1, P3 4: rules that were right in the product but that no test would have noticed losing. */
describe("rules the first tests left open", () => {
	const marked = (h: Harness) => output(h).classList.contains("is-dictionary-marked");
	const selectionOf = (element: HTMLElement) => {
		const range = element.ownerDocument.createRange();
		range.selectNodeContents(element);
		return { rangeCount: 1, getRangeAt: () => range };
	};

	it("the Define dialog, meeting an entry the Recompose side made, commits the Target it has now and writes it into the entry", async () => {
		const h = await withNote();
		expect(await h.apply(NOTES)).toBe("applied");
		await recomposed(h);
		await hover(h);
		const made = world(h).getCurrent()!;
		const key = definitionCacheKey(made.headword, made.dictionarySeed, made.dictionarySemantropy, made.vocabulary);
		expect(cache(h).getForWorld(key)!.target).toBeNull();
		popover(h).close();
		tab(h, "shuffle").click();
		const slot = h.current("猫");
		const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(item => h.controller().getSlotForElement(item) === slot)!;
		expect(await h.view.defineSelectedWord({ selection: selectionOf(el) })).toBe("ready");
		const target = { sourcePath: "target.md", contentHash: sha256Hex(TARGET) };
		expect(world(h).getCurrent()!.snapshot).toEqual(target);
		expect(world(h).getCurrent()!.result).toBe(made.result);
		expect(cache(h).getForWorld(key)!.target).toEqual(target);
	});

	it("a Recompose lookup is served from the shared cache: the very definition the Shuffle side made", async () => {
		const h = await withNote();
		expect(await h.apply(NOTES)).toBe("applied");
		const slot = h.current("猫");
		const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(item => h.controller().getSlotForElement(item) === slot)!;
		pointer(el, "pointerover", { altKey: true });
		await until(() => popover(h).isOpen());
		const made = world(h).getCurrent()!;
		popover(h).close();
		await recomposed(h);
		await hover(h);
		// The same object, not an equal one made again.
		expect(world(h).getCurrent()!.result).toBe(made.result);
	});

	it("a step that starts takes the mark and an open Popover away at once, before it has drawn anything", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		expect(marked(h)).toBe(true);
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const scheduler = h.host.scheduler!;
		h.host.scheduler = { ...scheduler, paint: () => gate };
		const running = screen(h).run("more");
		expect(marked(h)).toBe(false);
		expect(popover(h).isOpen()).toBe(false);
		release();
		await running;
		await until(() => marked(h));
		expect(marked(h)).toBe(true);
	});

	it("keeps an open Popover open while the pointer stays on its word, with the Shuffle body present", async () => {
		const h = await withNote();
		await recomposed(h);
		const word = await hover(h);
		// The pointer is still over the word: the 200 ms grace period for leaving it must never start.
		pointer(word, "pointerover", { altKey: true });
		await wait(260);
		expect(popover(h).isOpen()).toBe(true);
	});
});

/** Review 1, P3 6: with a note open whose body was made from the Vocabulary's own Snapshot, no second pool is made. */
describe("the pool of a Recompose lookup", () => {
	const pools = (h: Harness) => Reflect.get(Reflect.get(h.view, "recomposePools") as object, "pools") as WeakMap<object, unknown>;
	const snapshotOf = (h: Harness) => (Reflect.get(h.view, "collisionVocabulary") as () => { snapshot: object }).call(h.view).snapshot;

	it("is the body's own when the open note's body was made from this Vocabulary, and is not made a second time", async () => {
		const h = await withNote();
		await recomposed(h);
		await hover(h);
		expect(h.controller().getDictionaryPool()).toBeDefined();
		expect(world(h).getCurrent()!.pool).toBe(h.controller().getDictionaryPool());
		expect(pools(h).has(snapshotOf(h))).toBe(false);
	});

	it("is the body's own whichever Vocabulary the open note's body was made from, Selected Notes included", async () => {
		const h = await withNote();
		expect(await h.apply(NOTES)).toBe("applied");
		await recomposed(h);
		await hover(h);
		expect(world(h).getCurrent()!.pool).toBe(h.controller().getDictionaryPool());
		expect(pools(h).has(snapshotOf(h))).toBe(false);
	});

	it("is made once and kept under its Snapshot when no note is open", async () => {
		const h = await withoutNote();
		await recomposed(h);
		await hover(h);
		expect(world(h).getCurrent()!.pool).toBe(pools(h).get(snapshotOf(h)));
	});
});
