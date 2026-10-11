// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { defaultSemantropyDisplaySettings, type SemantropyDisplaySettings } from "../src/settings/displaySettings";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { UI_CATALOGS, ui } from "../src/i18n/catalog";
import { localize } from "../src/i18n/messages";
import { DICTIONARY_DIAGNOSTICS, dictionaryDiagnosticMessage } from "../src/view/dictionaryDiagnosticModel";

/**
 * WORKBENCH-UI5, decision 20 of `Docs/release_0_2_0_plan.md` §3.2.2: on a host with tabs the "Dictionary
 * availability" row between the Toolbar and the body is a Toolbar button (a book, in the Phrase generation
 * group, where Recompose was) that opens a dialog: how to look a word up, the hover modifier, and — folded, closed
 * to begin with — what the active Vocabulary offers. The details read the Vocabulary in use, so a View with no
 * note and a Selected Notes Vocabulary no longer says "being prepared" for good. The web page's host keeps its row.
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
const deps = { readCached: async () => TARGET, hashText: async (value: string) => sha256Hex(value), issueSeed: () => 7 };

type Harness = ReturnType<typeof manualMorphHarness> & { display: { value: SemantropyDisplaySettings }; saved: Partial<SemantropyDisplaySettings>[] };
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(flags: { tabs?: boolean; defer?: boolean } = { tabs: true, defer: true }): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(100);
	h.state.text = TARGET;
	if (flags.tabs !== undefined) h.host.workbenchTabs = flags.tabs;
	if (flags.defer !== undefined) h.host.deferInitialShuffle = flags.defer;
	const state = { value: defaultSemantropyDisplaySettings() }, saved: Partial<SemantropyDisplaySettings>[] = [];
	h.host.getDisplaySettings = () => state.value;
	h.host.setDisplaySettings = async patch => { saved.push(patch); state.value = { ...state.value, ...patch }; return true; };
	const result = Object.assign(h, { display: state, saved });
	opened.push(result);
	return result;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const button = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-toolbar .semantropy-fake-dictionary-open")!;
const dialog = () => document.querySelector<HTMLElement>(".semantropy-dictionary-help-modal");
const details = () => dialog()!.querySelector<HTMLDetailsElement>("details")!;
const wait = (ms = 5) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

describe("WORKBENCH-UI5: the Fake Dictionary button", () => {
	it("stands in the Settings category, before Display settings, with a book, a name and a description, on a host with tabs only", async () => {
		const h = harness();
		await h.open(TARGET);
		const group = button(h).closest<HTMLElement>(".semantropy-toolbar-group")!;
		expect(Array.from(group.querySelectorAll(".semantropy-toolbar-items > .semantropy-toolbar-item > button"), el => el.getAttribute("aria-label"))).toEqual(["Fake dictionary", "Display settings"]);
		expect(document.getElementById(group.getAttribute("aria-labelledby")!)!.textContent).toBe("Settings");
		// Phrase generation is as it was before the button existed: its own name and its three.
		const phrases = q(h, ".semantropy-toolbar-group.is-generation")!;
		expect(Array.from(phrases.querySelectorAll(".semantropy-toolbar-items > .semantropy-toolbar-item > button"), el => el.getAttribute("aria-label"))).toEqual(["Collision", "Fake proverb", "Fake alert"]);
		expect(document.getElementById(phrases.getAttribute("aria-labelledby")!)!.textContent).toBe("Phrase generation");
		expect([button(h).getAttribute("aria-label"), button(h).hasAttribute("title"), button(h).querySelector(".semantropy-icon svg")!.getAttribute("class")]).toEqual(["Fake dictionary", false, "svg-icon lucide-book-open"]);
		expect(document.getElementById(button(h).getAttribute("aria-describedby")!)!.textContent).toBe(ui().toolbar.controls.fakeDictionary.description);
		for (const flags of [{}, { defer: true }, { tabs: true, defer: undefined }]) {
			const other = harness(flags);
			if (flags.tabs) other.host.recomposeDialog = false;
			await other.open(TARGET);
			expect(q(other, ".semantropy-fake-dictionary-open"), JSON.stringify(flags)).toBeNull();
			expect(document.getElementById(q(other, ".semantropy-toolbar-group.is-generation")!.getAttribute("aria-labelledby")!)!.textContent).toBe("Phrase generation");
			expect(q(other, ".semantropy-dictionary-diagnostics")).not.toBeNull();
		}
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(button(h).getAttribute("aria-label")).toBe("でたらめ辞書");
		expect(document.getElementById(phrases.getAttribute("aria-labelledby")!)!.textContent).toBe("フレーズ生成");
		expect(document.getElementById(button(h).closest<HTMLElement>(".semantropy-toolbar-group")!.getAttribute("aria-labelledby")!)!.textContent).toBe("設定");
	});

	it("closes a Toolbar popup that is open when the dialog opens, and opens exactly one dialog", async () => {
		const h = harness();
		await h.open(TARGET);
		const display = q<HTMLButtonElement>(h, ".semantropy-display-menu-button")!;
		display.click();
		expect(display.getAttribute("aria-expanded")).toBe("true");
		// The popup is already closed at the moment the dialog is asked for (a dialog taking focus would close it anyway).
		const seen: (string | null)[] = [];
		const spy = vi.spyOn(h.view, "openDictionaryHelp").mockImplementation(() => { seen.push(display.getAttribute("aria-expanded")); });
		button(h).click();
		expect(seen).toEqual(["false"]);
		spy.mockRestore();
		button(h).click(); button(h).click();
		expect(document.querySelectorAll(".semantropy-dictionary-help-modal")).toHaveLength(1);
	});

	it("takes the availability row away on a host with tabs, and a host without keeps it as it is", async () => {
		const h = harness();
		await h.open(TARGET);
		expect(q(h, ".semantropy-dictionary-diagnostics")).toBeNull();
		const plain = harness({});
		await plain.open(TARGET);
		const row = q<HTMLDetailsElement>(plain, ".semantropy-dictionary-diagnostics")!;
		expect([row.open, row.querySelector("summary")!.textContent, row.querySelector("label select")!.getAttribute("class")]).toEqual([false, "Dictionary availability", null]);
	});
});

describe("WORKBENCH-UI5: the Fake Dictionary dialog", () => {
	it("says how to look a word up, then the modifier, then the details — folded, and closed to begin with", async () => {
		const h = harness();
		await h.open(TARGET);
		button(h).click();
		const modal = dialog()!;
		expect(modal).not.toBeNull();
		const parts = Array.from(modal.querySelector(".semantropy-dictionary-help")!.children, child => child.className.split(" ")[0]);
		expect(parts).toEqual(["semantropy-dictionary-help-how", "semantropy-dictionary-help-markers", "semantropy-dictionary-help-modifier", "semantropy-dictionary-diagnostics"]);
		expect(modal.querySelector(".semantropy-dictionary-help-how")!.textContent).toBe(ui().dictionary.help.how(ui().view.manualDefine));
		expect(modal.querySelector(".semantropy-dictionary-help-how")!.textContent).toContain("Look up in Fake Dictionary");
		expect(details().open).toBe(false);
		expect(details().querySelector("summary")!.textContent).toBe("Details");
		// The details are what the availability row said: the sentence, the usable templates and the words of each Source.
		const status = details().querySelector("[role=status]")!, counts = details().children[2]!;
		expect(status.textContent).toBe(DICTIONARY_DIAGNOSTICS.ready);
		expect(counts.textContent).toMatch(/^Usable core templates: \d+\/\d+; families: \d+; optional clauses: \d+\/\d+\./u);
		expect(counts.textContent).toContain("Vocabulary source 1: noun:");
		// One dialog at a time, and it takes the dialog title of the Fake Dictionary.
		button(h).click();
		expect(document.querySelectorAll(".semantropy-dictionary-help-modal")).toHaveLength(1);
		expect(modal.querySelector(".modal-title, div")).not.toBeNull();
	});

	it("the modifier is the stored setting: it shows it, saves a change, follows another View's, and never touches the body", async () => {
		const h = harness();
		await h.open(TARGET);
		button(h).click();
		const select = dialog()!.querySelector<HTMLSelectElement>("select")!;
		expect([select.value, Array.from(select.options, option => option.value)]).toEqual(["alt", ["alt", "shift"]]);
		const html = h.root().innerHTML;
		select.value = "shift"; select.dispatchEvent(new Event("change"));
		await vi.waitFor(() => expect(h.saved).toEqual([{ dictionaryModifier: "shift" }]));
		expect(h.root().innerHTML).toBe(html);
		// Stored elsewhere (another View, the settings): the next time the View catches up the select follows.
		h.display.value = { ...h.display.value, dictionaryModifier: "alt" };
		await h.view.applyStoredDisplaySettings();
		expect(select.value).toBe("alt");
		// Hover still uses the stored modifier.
		expect(h.view.getVocabularyState().snapshot).not.toBeNull();
	});

	it("opens on the stored modifier, whichever it is", async () => {
		const h = harness();
		h.display.value = { ...h.display.value, dictionaryModifier: "shift" };
		await h.open(TARGET);
		button(h).click();
		expect(dialog()!.querySelector<HTMLSelectElement>("select")!.value).toBe("shift");
	});

	it("reads the Vocabulary in use: with no note and a Selected Notes Vocabulary it says what is offered, not that it is being prepared", async () => {
		const h = harness();
		await h.view.onOpen();
		button(h).click();
		// Nothing chosen at all: said so, not "being prepared".
		const status = () => details().querySelector("[role=status]")!.textContent;
		const counts = () => details().children[2]!.textContent;
		expect([status(), counts()]).toEqual([DICTIONARY_DIAGNOSTICS.none, ""]);
		expect(await h.apply([SOURCE])).toBe("applied");
		expect(status()).toBe(DICTIONARY_DIAGNOSTICS.ready);
		expect(counts()).toMatch(/^Usable core templates: \d+\/\d+/u);
		expect(counts()).toContain("Vocabulary source 1:");
		// A note opened over it: the Vocabulary resets to the Current Note, and the details follow.
		await h.view.openCapture({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: TARGET } }, deps);
		expect(status()).toBe(DICTIONARY_DIAGNOSTICS.ready);
		expect(counts()).toContain("Vocabulary source 1:");
		// The language changes in place: the same dialog, the folding kept.
		details().open = true;
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(dialog()!.querySelector(".semantropy-dictionary-help-how")!.textContent).toBe(UI_CATALOGS.ja.dictionary.help.how(UI_CATALOGS.ja.view.manualDefine));
		expect(status()).toBe(localize(DICTIONARY_DIAGNOSTICS.ready));
		expect(details().open).toBe(true);
		expect(details().querySelector("summary")!.textContent).toBe("詳細");
	});

	it("is closed with the View, replaces nothing in the shell, and gives focus back to the button", async () => {
		const h = harness();
		await h.open(TARGET);
		button(h).focus();
		button(h).click();
		expect(dialog()).not.toBeNull();
		(Reflect.get(h.view, "dictionaryHelpModal") as { close(): void }).close();
		expect(dialog()).toBeNull();
		expect(document.activeElement).toBe(button(h));
		// The View\x27s diagnostics are unbound with it.
		expect(Reflect.get(h.view, "dictionaryDiagnosticEl")).toBeNull();
		button(h).click();
		await h.view.onClose();
		expect(dialog()).toBeNull();
	});

	it("keeps its details through a shell rebuilt under it", async () => {
		const h = harness();
		await h.open(TARGET);
		button(h).click();
		const status = details().querySelector("[role=status]")!;
		// A Refresh keeps the shell; an Open into a View that is not ready rebuilds it.
		h.leaveReady();
		await h.view.openCapture({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: TARGET } }, deps);
		await wait();
		expect(dialog()).not.toBeNull();
		expect(status.isConnected).toBe(true);
		expect(status.textContent).toBe(DICTIONARY_DIAGNOSTICS.ready);
	});
});

describe("WORKBENCH-UI5: the diagnostics' own sentence for a View with no Vocabulary at all", () => {
	const input = { level: 50, preparing: false, stale: false, slot: null, counts: null };
	it("is said only when asked, and a Vocabulary on its way is still preparing", () => {
		expect(dictionaryDiagnosticMessage(input)).toBe(DICTIONARY_DIAGNOSTICS.preparing);
		expect(dictionaryDiagnosticMessage({ ...input, none: true })).toBe(DICTIONARY_DIAGNOSTICS.none);
		expect(dictionaryDiagnosticMessage({ ...input, none: true, preparing: true })).toBe(DICTIONARY_DIAGNOSTICS.preparing);
		expect(localize(DICTIONARY_DIAGNOSTICS.none)).toBe("Fake dictionary: no Vocabulary has been chosen yet.");
		setCurrentUiLanguage("ja");
		expect(localize(DICTIONARY_DIAGNOSTICS.none)).toBe("でたらめ辞書: まだ語彙が選ばれていません。");
	});

	it("the web page\x27s host never says it: with no note it shows no Vocabulary entry, and its row keeps the old sentence", async () => {
		const h = harness({});
		await h.view.onOpen();
		// Nothing writes the row until the View syncs; then, with no Vocabulary, it says what it always said.
		(Reflect.get(h.view, "updateChrome") as () => void).call(h.view);
		expect(q(h, ".semantropy-dictionary-diagnostics [role=status]")!.textContent).toBe(DICTIONARY_DIAGNOSTICS.preparing);
		expect(q(h, ".semantropy-vocabulary-open")).toBeNull();
	});
});

describe("WORKBENCH-UI5: the dialog's stylesheet", () => {
	it("is a readable width on a narrow pane and reuses the availability row's rules for the details", () => {
		const css = readFileSync("styles.css", "utf8");
		const rule = (selector: string) => {
			const at = css.indexOf(`\n${selector} {`);
			expect(at, selector).toBeGreaterThan(-1);
			return css.slice(at, css.indexOf("}", at));
		};
		expect(rule(".semantropy-dictionary-help-modal")).toMatch(/width: min\(32rem, 95vw\);[^}]*max-width: 95vw;/u);
		expect(rule(".semantropy-dictionary-help p")).toMatch(/overflow-wrap: anywhere;/u);
		expect(rule(".semantropy-dictionary-diagnostics")).toMatch(/overflow-y: auto;/u);
	});
});
