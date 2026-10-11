// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { noteFileName } from "../src/view/VocabularyControls";

/**
 * WORKBENCH-UI5 (owner change B, 2026-10-08): on a host with tabs the status line's Vocabulary summary names the applied
 * Vocabulary's notes: `Current Note “a.md”`, `Selected Notes “a.md”`, and `▶ Selected Notes (3) “a.md” and others`, where
 * ▶ lists every Source in a Toolbar popup. The web page's line stays as it was.
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

type Harness = ReturnType<typeof manualMorphHarness>;
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(tabs = true): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(100);
	h.state.text = TARGET;
	if (tabs) { h.host.workbenchTabs = true; h.host.deferInitialShuffle = true; }
	opened.push(h);
	return h;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const summaryEl = (h: Harness) => q(h, ".semantropy-status-vocabulary")!;
const summary = (h: Harness) => summaryEl(h).textContent;
const toggle = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-vocabulary-sources-toggle");
const panel = (h: Harness) => q(h, ".semantropy-vocabulary-sources")!;
const rows = (h: Harness) => Array.from(panel(h).querySelectorAll("li"), li => li.textContent);
/** Selected Notes from Vault paths, applied. */
async function applyPaths(h: Harness, paths: string[]) {
	for (const path of paths) h.notes.set(path, SOURCE);
	h.view.setVocabularyDraft({ mode: "selected", paths, drawMode: "uniform" });
	return h.view.applyVocabulary();
}

describe("WORKBENCH-UI5 (owner change B): the summary names the notes", () => {
	it("names the Current Note and one Selected Note by file name, and no more than the applied Vocabulary", async () => {
		const h = harness();
		await h.open(TARGET);
		expect(summary(h)).toBe("Vocabulary: Current Note “target.md” · Draw mode: Uniform");
		expect(toggle(h)).toBeNull();
		expect(await h.apply([SOURCE])).toBe("applied");
		expect(summary(h)).toBe("Vocabulary: Selected Notes “source0.md” · Draw mode: Uniform");
		// A draft is not the Vocabulary: the line still names the applied one and says the draft is unapplied.
		h.notes.set("draft.md", SOURCE);
		h.view.setVocabularyDraft({ mode: "selected", paths: ["draft.md"], drawMode: "frequency" });
		expect(summary(h)).toBe("Vocabulary: Selected Notes “source0.md” · Draw mode: Uniform · unapplied");
		expect(summary(h)).not.toContain("draft");
	});

	it("names several by the first in path order, with ▶, and says so in Japanese too", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(await applyPaths(h, ["zeta/z.md", "alpha/b.md", "alpha/a.md"])).toBe("applied");
		expect(summary(h)).toBe("Vocabulary: ▶Selected Notes (3) “a.md” and others · Draw mode: Uniform");
		expect(toggle(h)!.getAttribute("aria-label")).toBe("Show the 3 Vocabulary Sources");
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(summary(h)).toBe("語彙: ▶選択したノート（3）「a.md」他 · 抽選方式: 均等");
		expect(toggle(h)!.getAttribute("aria-label")).toBe("語彙ソースの3件を表示");
		// The list is built when it opens, in the language of the moment.
		toggle(h)!.click();
		expect(panel(h).getAttribute("aria-label")).toBe("語彙ソース");
	});

	it("the Japanese line for one note and for the Current Note", async () => {
		const h = harness();
		setCurrentUiLanguage("ja");
		await h.open(TARGET);
		expect(summary(h)).toBe("語彙: 現在のノート「target.md」 · 抽選方式: 均等");
		expect(await h.apply([SOURCE])).toBe("applied");
		expect(summary(h)).toBe("語彙: 選択したノート「source0.md」 · 抽選方式: 均等");
	});

	it("keeps the draw mode, the weights and the unapplied, preparing and stale notes after the name", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(await applyPaths(h, ["a.md", "b.md"])).toBe("applied");
		h.view.notifyVocabularySourceEvent("b.md");
		expect(summary(h)).toBe("Vocabulary: ▶Selected Notes (2) “a.md” and others · Draw mode: Uniform · stale: 1 Source");
	});

	it("is the plain line on a host without tabs, as it was", async () => {
		const h = harness(false);
		await h.open(TARGET);
		expect(summary(h)).toBe("Vocabulary: Current Note · Draw mode: Uniform");
		expect(summaryEl(h).classList.contains("is-named")).toBe(false);
		expect(toggle(h)).toBeNull();
		expect(await h.apply([SOURCE, SOURCE])).toBe("applied");
		expect(summary(h)).toBe("Vocabulary: Selected Notes (2) · Draw mode: Uniform");
		expect(q(h, ".semantropy-vocabulary-sources")).toBeNull();
	});

	it("writes a note name as text only, and reads no note for it", async () => {
		const h = harness();
		await h.view.onOpen();
		const reads = h.calls.reads.length;
		expect(await applyPaths(h, ["x/<b>bold.md", "y/<img src=x>.md"])).toBe("applied");
		expect(h.calls.reads.length - reads).toBe(2);
		expect(summary(h)).toContain("“<b>bold.md”");
		expect(summaryEl(h).querySelector("b, img")).toBeNull();
		// Opening the list reads nothing.
		const before = h.calls.reads.length;
		toggle(h)!.click();
		expect(h.calls.reads.length).toBe(before);
		expect(rows(h)).toEqual(["x/<b>bold.md", "y/<img src=x>.md"]);
		expect(panel(h).querySelector("b, img")).toBeNull();
	});

	it("takes the file name after the last slash and nothing else", () => {
		expect([noteFileName("a/b/c.md"), noteFileName("c.md"), noteFileName("桜桃.md"), noteFileName("a/")]).toEqual(["c.md", "c.md", "桜桃.md", ""]);
	});
});

describe("WORKBENCH-UI5 (owner change B): the list of the Vocabulary's notes", () => {
	async function several(): Promise<Harness> {
		const h = harness();
		await h.view.onOpen();
		expect(await applyPaths(h, ["notes/a.md", "notes/b.md", "c.md"])).toBe("applied");
		return h;
	}

	it("is a Toolbar popup: closed to begin with, aria-expanded, one list of every path, and it moves nothing", async () => {
		const h = await several();
		const button = toggle(h)!;
		expect([panel(h).hidden, button.getAttribute("aria-expanded"), button.getAttribute("aria-haspopup"), button.getAttribute("aria-controls")]).toEqual([true, "false", "true", panel(h).id]);
		expect(panel(h).classList.contains("semantropy-toolbar-popup")).toBe(true);
		const above = Array.from(q(h, ".semantropy-root")!.children).map(child => child.className);
		button.click();
		expect([panel(h).hidden, button.getAttribute("aria-expanded")]).toEqual([false, "true"]);
		expect(rows(h)).toEqual(["c.md", "notes/a.md", "notes/b.md"]);
		// The list hangs from the status line: no sibling is added, removed or reordered.
		expect(Array.from(q(h, ".semantropy-root")!.children).map(child => child.className)).toEqual(above);
		expect(q(h, ".semantropy-status")!.contains(panel(h))).toBe(true);
		expect(summaryEl(h).contains(panel(h))).toBe(false);
		button.click();
		expect([panel(h).hidden, button.getAttribute("aria-expanded")]).toEqual([true, "false"]);
	});

	it("closes on Escape (focus back on ▶) and on a click outside, and another popup closes it", async () => {
		const h = await several();
		const button = toggle(h)!;
		button.click(); button.focus();
		button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect([panel(h).hidden, document.activeElement]).toEqual([true, button]);
		button.click();
		panel(h).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(panel(h).hidden).toBe(true);
		button.click();
		document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		expect(panel(h).hidden).toBe(true);
		// A click inside the summary or the list does not close it; opening Display settings does.
		button.click();
		summaryEl(h).dispatchEvent(new Event("pointerdown", { bubbles: true }));
		panel(h).querySelector("li")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		expect(panel(h).hidden).toBe(false);
		q<HTMLButtonElement>(h, ".semantropy-display-menu-button")!.click();
		expect([panel(h).hidden, button.getAttribute("aria-expanded")]).toEqual([true, "false"]);
		// And a dialog about to open closes the Toolbar's popups, this one included.
		button.click();
		expect(panel(h).hidden).toBe(false);
		(Reflect.get(h.view, "toolbar") as { closePopups(): void }).closePopups();
		expect(panel(h).hidden).toBe(true);
	});

	it("builds the list when it opens (a closed list is not seen), with the Vault's listing read then and not on every sync", async () => {
		const h = await several();
		const listing = vi.fn(() => ["notes/a.md", "notes/b.md"]);
		h.host.listVocabularyNotes = listing;
		h.view.notifyVocabularySourceEvent("unrelated.md");
		h.view.setVocabularyDraft({ mode: "selected", paths: ["notes/a.md", "notes/b.md", "c.md"], drawMode: "uniform" });
		expect(listing).not.toHaveBeenCalled();
		expect(panel(h).querySelectorAll("li")).toHaveLength(0);
		toggle(h)!.click();
		expect(listing).toHaveBeenCalledTimes(1);
		expect(rows(h)).toEqual(["c.md (not found in the Vault)", "notes/a.md", "notes/b.md"]);
		// While it is open it follows the View, with the listing read again; closed again, it is left alone.
		h.view.notifyVocabularySourceEvent("notes/b.md");
		expect(listing.mock.calls.length).toBeGreaterThan(1);
		toggle(h)!.click();
		const closed = listing.mock.calls.length;
		h.view.notifyVocabularySourceEvent("notes/a.md");
		expect(listing.mock.calls.length).toBe(closed);
	});

	it("says it as the picker does: the same words for a Source gone from the Vault, changed, or missing", async () => {
		const h = await several();
		h.host.listVocabularyNotes = () => ["notes/a.md", "notes/b.md"];
		h.view.notifyVocabularySourceEvent("c.md", "missing");
		h.view.notifyVocabularySourceEvent("notes/b.md");
		toggle(h)!.click();
		const list = rows(h);
		expect(list).toEqual(["c.md (not found in the Vault, missing)", "notes/a.md", "notes/b.md (changed)"]);
		h.view.openVocabularyPicker();
		const items = Array.from(document.querySelectorAll<HTMLElement>(".semantropy-vocabulary-selected li"));
		const pickerMark = (path: string) => items.find(item => item.querySelector(".semantropy-vocabulary-selected-path")?.textContent === path)!.querySelector(".semantropy-vocabulary-selected-issue")!.textContent;
		expect([pickerMark("c.md"), pickerMark("notes/a.md"), pickerMark("notes/b.md")]).toEqual([" (not found in the Vault, missing)", "", " (changed)"]);
		// The summary's list says exactly the words the picker says after each path.
		expect(list).toEqual(["c.md" + pickerMark("c.md"), "notes/a.md" + pickerMark("notes/a.md"), "notes/b.md" + pickerMark("notes/b.md")]);
		h.view.closeVocabularyPicker();
	});

	it("marks a note that changed or is gone as the picker does, and follows a change while open", async () => {
		const h = await several();
		toggle(h)!.click();
		h.view.notifyVocabularySourceEvent("notes/b.md");
		h.view.notifyVocabularySourceEvent("c.md", "missing");
		expect(panel(h).hidden).toBe(false);
		expect(rows(h)).toEqual(["c.md (missing)", "notes/a.md", "notes/b.md (changed)"]);
		expect(panel(h).querySelectorAll(".semantropy-vocabulary-sources-issue")).toHaveLength(2);
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(rows(h)).toEqual(["c.md（見つかりません）", "notes/a.md", "notes/b.md（変更あり）"]);
		expect(panel(h).hidden).toBe(false);
	});

	it("goes away with one note, with a new Vocabulary of one, and with the note being replaced", async () => {
		const h = await several();
		toggle(h)!.click();
		expect(await applyPaths(h, ["only.md"])).toBe("applied");
		expect([toggle(h), panel(h).hidden, summary(h)]).toEqual([null, true, "Vocabulary: Selected Notes “only.md” · Draw mode: Uniform"]);
		expect(await applyPaths(h, ["notes/a.md", "notes/b.md"])).toBe("applied");
		expect(toggle(h)).not.toBeNull();
		await h.view.openCapture({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: TARGET } },
			{ readCached: async () => TARGET, hashText: async () => "h", issueSeed: () => 7 });
		expect([toggle(h), panel(h).hidden, summary(h)]).toEqual([null, true, "Vocabulary: Current Note “target.md” · Draw mode: Uniform"]);
	});

	it("a sync that changes nothing writes nothing and leaves ▶ in place with its focus", async () => {
		const h = await several();
		const button = toggle(h)!;
		// The list is built when it is open, so it is open here: a sync that changes nothing must leave it alone too.
		button.click();
		expect(panel(h).hidden).toBe(false);
		button.focus();
		const observer = new MutationObserver(() => undefined);
		// The summary and the list, which are what this checks (the rest of the status line is the Toolbar's own and rewrites its text).
		for (const target of [summaryEl(h), panel(h)]) observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
		const controls = Reflect.get(h.view, "vocabularyControls") as { sync(): void };
		controls.sync(); controls.sync();
		h.view.notifyVocabularySourceEvent("unrelated.md");
		expect(observer.takeRecords()).toEqual([]);
		observer.disconnect();
		expect([toggle(h), document.activeElement]).toEqual([button, button]);
		// A change that rewrites the line keeps focus on ▶.
		h.view.notifyVocabularySourceEvent("c.md");
		expect([toggle(h), document.activeElement]).toEqual([button, button]);
	});
});

describe("WORKBENCH-UI5 (owner change B): a narrow pane cuts the name and keeps it whole in a tooltip", () => {
	it("sets the tooltip when the name is cut, and removes it when it is not", async () => {
		const h = harness();
		await h.open(TARGET);
		const name = q(h, ".semantropy-vocabulary-name")!;
		expect(name.hasAttribute("title")).toBe(false);
		Object.defineProperty(name, "scrollWidth", { configurable: true, value: 200 });
		Object.defineProperty(name, "clientWidth", { configurable: true, value: 80 });
		h.view.onResize();
		expect(name.getAttribute("title")).toBe("target.md");
		Object.defineProperty(name, "scrollWidth", { configurable: true, value: 80 });
		h.view.onResize();
		expect(name.hasAttribute("title")).toBe(false);
	});

	it("is cut by the stylesheet, narrower in a narrow pane, and hangs the list from the status line", () => {
		const css = readFileSync("styles.css", "utf8");
		const rule = (selector: string) => {
			const at = css.indexOf(`\n${selector} {`);
			expect(at, selector).toBeGreaterThan(-1);
			return css.slice(at, css.indexOf("}", at));
		};
		// A wide pane cuts nothing the line has room for (owner, review 3); a narrow one cuts at 7rem.
		expect(rule(".semantropy-vocabulary-name")).toMatch(/max-width: 100%;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/u);
		expect(rule(".semantropy-status-vocabulary.is-named")).toMatch(/min-width: 0;[^}]*max-width: 100%;/u);
		expect(css).toMatch(/@container semantropy-view \(max-width: 32rem\) \{\s*\.semantropy-vocabulary-name \{\s*max-width: 7rem;/u);
		expect(rule(".semantropy-status.has-vocabulary-names")).toMatch(/position: relative;/u);
		expect(rule(".semantropy-toolbar-popup.semantropy-vocabulary-sources")).toMatch(/width: max-content;[^}]*max-width: min\(28rem, 100cqw\);/u);
		// Its height is the Toolbar's to set (half of the View), so the stylesheet carries no cap of its own that the inline one would override.
		expect(rule(".semantropy-toolbar-popup.semantropy-vocabulary-sources")).not.toMatch(/max-height/u);
		// A long path wraps inside the list.
		expect(rule(".semantropy-vocabulary-sources-list li")).toMatch(/overflow-wrap: anywhere;/u);
		// The rule that makes a popup hang from its container is the Toolbar's own; the list adds no other position.
		expect(rule(".semantropy-toolbar-popup")).toMatch(/position: absolute;[^}]*top: 100%;/u);
	});

	it("the list is about half of the View high and scrolls inside, whatever the number of notes; other popups keep the room down to the View's end", async () => {
		const h = harness();
		await h.view.onOpen();
		const paths = Array.from({ length: 50 }, (_, i) => `folder/note-${String(i).padStart(2, "0")}.md`);
		expect(await applyPaths(h, paths)).toBe("applied");
		// jsdom lays nothing out: the View is given a height of 600px for the Toolbar to fit its popups into.
		const view = q(h, ".semantropy-toolbar")!.parentElement!;
		const box = (bottom: number) => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom, width: 400, height: bottom, toJSON: () => ({}) });
		vi.spyOn(view, "getBoundingClientRect").mockReturnValue(box(600));
		toggle(h)!.click();
		expect(panel(h).hidden).toBe(false);
		expect(rows(h)).toHaveLength(50);
		expect(panel(h).style.maxHeight).toBe("300px");
		// A shorter View, a shorter list (it is fitted each time it opens, like the other popups).
		toggle(h)!.click();
		expect(panel(h).hidden).toBe(true);
		vi.spyOn(view, "getBoundingClientRect").mockReturnValue(box(240));
		toggle(h)!.click();
		expect(panel(h).style.maxHeight).toBe("120px");
		// Display settings keeps its own rule: all the room down to the View.
		q<HTMLButtonElement>(h, ".semantropy-display-menu-button")!.click();
		const display = q(h, ".semantropy-display-menu")!;
		expect(display.hidden).toBe(false);
		expect(display.style.maxHeight).toBe("232px");
	});
});
