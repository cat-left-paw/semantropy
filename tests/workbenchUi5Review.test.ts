// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { EN_MESSAGES, ui } from "../src/i18n/catalog";
import { VOCABULARY_MISSING_MESSAGE, VOCABULARY_STALE_MESSAGE } from "../src/view/toolbarStatusModel";
import type { SemantropyViewHost } from "../src/view/SemantropyView";

/**
 * WORKBENCH-UI5: the loose ends of WORKBENCH-UI4's independent review 1 (`Docs/workbench_ui4_record.md` §18, P3 1, 2, 3,
 * 5, 6, 7), and the owner's two judgments there: why Generate new is off in Recompose, and a picker that starts on
 * Selected Notes with no note.
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
const note = { kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: TARGET } } as const;

type Harness = ReturnType<typeof manualMorphHarness>;
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 12);
	h.state.level = assertBodySemantropy(100);
	h.state.text = TARGET;
	h.host.workbenchTabs = true;
	h.host.deferInitialShuffle = true;
	opened.push(h);
	return h;
}
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const tab = (h: Harness, name: "shuffle" | "recompose") => q<HTMLButtonElement>(h, `.semantropy-tab-${name}`)!;
const generateNew = (h: Harness) => Array.from(q(h, ".semantropy-recompose-pane")!.querySelectorAll<HTMLButtonElement>("button")).find(el => el.getAttribute("aria-label") === ui().recompose.generate)!;
const automaticToggle = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-automatic-pos-toolbar > button")!;
const status = (h: Harness) => q(h, ".semantropy-status")!;

describe("review 1, P3 1: a Selected Notes Vocabulary with no note goes stale like any other", () => {
	it("the status line says it is stale or missing, in both languages, and the Automatic parts of speech control comes back after Apply", async () => {
		const h = harness();
		await h.view.onOpen();
		expect(await h.apply([SOURCE])).toBe("applied");
		expect(status(h).dataset["state"]).toBe("empty");
		expect(automaticToggle(h).disabled).toBe(false);
		h.view.notifyVocabularySourceEvent("source0.md");
		// Before this change the line stayed "no note" and said nothing of the Vocabulary.
		expect(status(h).dataset["state"]).toBe("vocabulary-stale");
		expect(status(h).querySelector(".semantropy-stale")!.textContent).toBe(VOCABULARY_STALE_MESSAGE);
		expect(status(h).querySelector(".semantropy-message")!.textContent).toBe(EN_MESSAGES.status.openNote);
		expect(automaticToggle(h).disabled).toBe(true);
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(status(h).querySelector(".semantropy-stale")!.textContent).not.toBe(VOCABULARY_STALE_MESSAGE);
		setCurrentUiLanguage("en"); h.view.languageChanged();
		h.view.notifyVocabularySourceEvent("source0.md", "missing");
		expect(status(h).querySelector(".semantropy-stale")!.textContent).toBe(VOCABULARY_MISSING_MESSAGE);
		// Applying the Vocabulary again makes it fresh, and the control is back (it used to wait for a note).
		expect(await h.apply([SOURCE])).toBe("applied");
		expect(status(h).dataset["state"]).toBe("empty");
		expect(status(h).querySelector<HTMLElement>(".semantropy-stale")!.hidden).toBe(true);
		expect(automaticToggle(h).disabled).toBe(false);
	});

	it("a stale Vocabulary of one View is why another's level change is refused, and that View says so", async () => {
		const stale = harness(), other = harness();
		await stale.view.onOpen(); await other.view.onOpen();
		expect(await stale.apply([SOURCE])).toBe("applied");
		stale.view.notifyVocabularySourceEvent("source0.md");
		const claim = (Reflect.get(stale.view, "automaticParticipant") as { claim(change: string): unknown }).claim("level");
		expect(claim).toBeNull();
		expect(status(stale).querySelector(".semantropy-stale")!.textContent).toBe(VOCABULARY_STALE_MESSAGE);
	});
});

describe("review 1, P3 2 and the owner's judgment: the Recompose pane follows the Vocabulary and says why Generate new is off", () => {
	it("a Source change turns Generate new off at once and the pane says why; applying again turns it on and the sentence goes", async () => {
		const h = harness();
		await h.view.onOpen();
		tab(h, "recompose").click();
		const reason = () => q(h, ".semantropy-recompose-unusable")!;
		// No Vocabulary yet.
		expect([generateNew(h).disabled, reason().hidden, reason().textContent]).toEqual([true, false, ui().recompose.noVocabulary]);
		// The sentence is for everyone: it is not hidden from assistive technology (review 1, P3 3 iii, for the new sentence).
		expect([reason().hasAttribute("aria-hidden"), reason().closest("[aria-hidden]")]).toEqual([false, null]);
		expect(await h.apply([SOURCE])).toBe("applied");
		expect([generateNew(h).disabled, reason().hidden]).toEqual([false, true]);
		h.view.notifyVocabularySourceEvent("source0.md");
		expect([generateNew(h).disabled, reason().hidden]).toEqual([true, false]);
		expect(await h.apply([SOURCE])).toBe("applied");
		expect([generateNew(h).disabled, reason().hidden]).toEqual([false, true]);
		// A step in flight is not the reason: Generate new is off because the step runs, and the sentence stays away.
		const base = h.host.scheduler!;
		let release: () => void = () => undefined, armed = true;
		h.host.scheduler = { ...base, paint: () => {
			if (!armed) return base.paint();
			armed = false; return new Promise<void>(resolve => { release = resolve; });
		} };
		generateNew(h).click();
		await vi.waitFor(() => expect(generateNew(h).disabled).toBe(true));
		expect(reason().hidden).toBe(true);
		release();
		await vi.waitFor(() => expect(generateNew(h).disabled).toBe(false));
		expect(reason().hidden).toBe(true);
		// The sentence follows the language.
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		h.view.notifyVocabularySourceEvent("source0.md");
		expect(reason().textContent).toBe(ui().recompose.noVocabulary);
	});
});

describe("review 1, P3 3: the pieces a rewrite could break unseen", () => {
	it("a category with one control hidden and one shown stays in the row with no note (the rule hides only a category whose controls are all hidden)", async () => {
		const h = harness();
		await h.view.onOpen();
		// Generation settings: the Text level is hidden with no note, Automatic parts of speech is not.
		expect(q(h, ".semantropy-toolbar-item.is-level")!.hidden).toBe(true);
		expect(q(h, ".semantropy-toolbar-item.is-automatic")!.hidden).toBe(false);
		expect(q(h, ".semantropy-toolbar-group.is-text")!.hidden).toBe(false);
		// And Phrase generation, whose buttons are all there.
		expect(q(h, ".semantropy-toolbar-group.is-generation")!.hidden).toBe(false);
	});
});

describe("review 1, P3 5: Reshuffle text and Refresh target with no note", () => {
	it("say there is nothing to act on and leave the tab where it is", async () => {
		const h = harness();
		await h.view.onOpen();
		tab(h, "recompose").click();
		expect(await h.view.reshuffle()).toBe("unavailable");
		expect(tab(h, "recompose").getAttribute("aria-selected")).toBe("true");
		expect(await h.view.refreshSource()).toBe("unavailable");
		expect(tab(h, "recompose").getAttribute("aria-selected")).toBe("true");
		// With a note they still show Shuffle first.
		await h.view.openCapture(note, deps);
		tab(h, "recompose").click();
		expect(await h.view.reshuffle()).toBe("applied");
		expect(tab(h, "shuffle").getAttribute("aria-selected")).toBe("true");
		tab(h, "recompose").click();
		expect(await h.view.refreshSource()).toBe("refreshed");
		expect(tab(h, "shuffle").getAttribute("aria-selected")).toBe("true");
	});
});

describe("review 1, P3 6 and the owner's judgment: the Vocabulary wording with no note", () => {
	const summary = (h: Harness) => q(h, ".semantropy-status-vocabulary")!.textContent;
	const picker = () => document.querySelector<HTMLElement>(".semantropy-vocabulary-modal");
	const mode = () => picker()!.querySelector<HTMLSelectElement>("select")!.value;
	const apply = () => Array.from(picker()!.querySelectorAll<HTMLButtonElement>(".semantropy-vocabulary-actions button"))[0]!;

	it("names no Vocabulary until one is applied, and the picker starts on Selected Notes", async () => {
		const h = harness();
		(Reflect.get(h.view, "host") as SemantropyViewHost).listVocabularyNotes = () => ["source0.md", "target.md"];
		await h.view.onOpen();
		expect(summary(h)).toBe("");
		h.view.openVocabularyPicker();
		expect(mode()).toBe("selected");
		expect(picker()!.querySelector<HTMLElement>(".semantropy-vocabulary-browse")!.hidden).toBe(false);
		// Nothing is chosen: Apply waits; and the line still names nothing for a draft.
		expect(apply().disabled).toBe(true);
		expect(summary(h)).toBe("");
		(picker()!.querySelector(".semantropy-vocabulary-tree input[type=checkbox]") as HTMLInputElement).click();
		expect(apply().disabled).toBe(false);
		expect(summary(h)).toBe("");
		h.notes.set("source0.md", SOURCE);
		apply().click();
		await vi.waitFor(() => expect(summary(h)).toContain("Selected Notes “source0.md”"));
		expect(picker()).toBeNull();
	});

	it("with a note it starts on the Current Note, as it always did", async () => {
		const h = harness();
		(Reflect.get(h.view, "host") as SemantropyViewHost).listVocabularyNotes = () => ["source0.md", "target.md"];
		await h.open(TARGET);
		h.view.openVocabularyPicker();
		expect(mode()).toBe("current");
		expect(summary(h)).toContain("Current Note");
	});
});

describe("review 1, P3 7: a View that is closed draws nothing for an Open that arrives late", () => {
	it("builds no shell, no Recompose session and no pane", async () => {
		const h = harness();
		await h.view.onOpen();
		await h.view.onClose();
		const probe = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await h.view.openCapture(note, deps);
		await h.view.openCapture({ kind: "none" }, deps);
		expect(Reflect.get(h.view, "recomposeSession")).toBeNull();
		expect(Reflect.get(h.view, "recomposeScreen")).toBeNull();
		expect(h.peek.contentEl.childElementCount).toBe(0);
		expect(h.peek.session.getState().status).not.toBe("ready");
		expect(probe).not.toHaveBeenCalled();
	});
});
