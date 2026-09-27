// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, peekMorph } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { UI_CATALOGS, ui } from "../src/i18n/catalog";
import { japaneseMessagePairs, localize } from "../src/i18n/messages";
import { setCurrentUiLanguage, type UiLanguage } from "../src/i18n/language";
import { DEFINE_OFF_MESSAGE } from "../src/application/fakeDictionaryMessages";
import { DICTIONARY_DIAGNOSTICS } from "../src/view/dictionaryDiagnosticModel";
import { FakeDefinitionModal } from "../src/view/FakeDefinitionModal";
import type { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import type { CollisionSession } from "../src/view/CollisionSession";
import type { CollisionModal } from "../src/view/CollisionModal";
import type { SemantropyViewHost } from "../src/view/SemantropyView";
import type { CooperativeScheduler } from "../src/render/cooperativeScheduler";
import type { App } from "obsidian";

/*
 * PRE-RELEASE-EXPERIENCE-WORDING1: interface wording only.
 * The Popover heading stays "Fake Dictionary" in both languages. Japanese UI
 * elsewhere says でたらめ辞書 and 架空ことわざ. Status names the Target and the
 * Text Semantropy value. A language switch re-words in place.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
const live: ReturnType<typeof manualMorphHarness>[] = [];
afterEach(async () => {
	for (const h of live.splice(0)) await h.view.onClose();
	setCurrentUiLanguage("en");
	document.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
});

const nounLexicon = () => lexiconTokenizer([
	token({ surface: "猫", baseForm: "猫", reading: "ネコ" }),
	token({ surface: "犬", baseForm: "犬", reading: "イヌ" }),
]);
const collisionTokens = [
	token({ surface: "猫", baseForm: "猫" }),
	token({ surface: "研究", detail1: "サ変接続" }),
	token({ surface: "眠る", pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形", baseForm: "眠る" }),
];
async function harness(kind: "noun" | "collision" = "noun") {
	const h = manualMorphHarness(kind === "noun" ? nounLexicon() : lexiconTokenizer(collisionTokens), kind === "noun" ? 5000 : 20);
	live.push(h);
	await h.open(kind === "noun" ? "猫犬。" : collisionTokens.map(item => item.surface).join(""));
	(Reflect.get(h.view, "host") as SemantropyViewHost).listVocabularyNotes = () => ["notes/source0.md", "target.md"];
	return h;
}
const shell = (h: Awaited<ReturnType<typeof harness>>) => peekMorph(h.view).contentEl;
const popover = (h: Awaited<ReturnType<typeof harness>>) => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
const wait = (ms = 145) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
async function hover(h: Awaited<ReturnType<typeof harness>>) {
	const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(item => h.controller().getSlotForElement(item) === h.current("猫"))!;
	el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, altKey: true }));
	await wait();
	expect(popover(h).isOpen()).toBe(true);
	return document.querySelector<HTMLElement>(".semantropy-dictionary-popover")!;
}
function switchTo(h: Awaited<ReturnType<typeof harness>>, language: UiLanguage) {
	setCurrentUiLanguage(language);
	h.view.languageChanged();
}

describe("PRE-RELEASE-EXPERIENCE-WORDING1", () => {
	it("names the Target and Text Semantropy in the status, and Generation settings on the toolbar", () => {
		expect(UI_CATALOGS.en.status.source("小説断片.md")).toBe("Target: 小説断片.md");
		expect(UI_CATALOGS.ja.status.source("小説断片.md")).toBe("対象ノート: 小説断片.md");
		expect(UI_CATALOGS.en.toolbar.levelStatus("Medium")).toBe("Text Semantropy: Medium");
		expect(UI_CATALOGS.ja.toolbar.levelStatus("中")).toBe("本文Semantropy: 中");
		expect(UI_CATALOGS.en.toolbar.groups.text).toBe("Generation settings");
		expect(UI_CATALOGS.ja.toolbar.groups.text).toBe("生成設定");
		expect(UI_CATALOGS.en.automatic.group).toBe("Generation settings");
		expect(UI_CATALOGS.ja.automatic.group).toBe("生成設定");
		const catalogs = JSON.stringify(UI_CATALOGS) + japaneseMessagePairs().map(([, ja]) => ja).join("\n");
		expect(catalogs).not.toContain("偽辞書");
		expect(catalogs).not.toContain("偽ことわざ");
	});

	it("keeps the Popover heading as Fake Dictionary in both languages", async () => {
		expect(UI_CATALOGS.en.dictionary.popoverTitle).toBe("Fake Dictionary");
		expect(UI_CATALOGS.ja.dictionary.popoverTitle).toBe("Fake Dictionary");
		const h = await harness();
		const panel = await hover(h);
		expect(panel.querySelector(".semantropy-definition-title")?.textContent).toBe("Fake Dictionary");
		expect(panel.getAttribute("aria-label")).toBe("Fake Dictionary");
		switchTo(h, "ja");
		expect(popover(h).isOpen()).toBe(true);
		expect(panel.querySelector(".semantropy-definition-title")?.textContent).toBe("Fake Dictionary");
		expect(panel.getAttribute("aria-label")).toBe("Fake Dictionary");
		expect(panel.querySelector(".semantropy-definition-title")?.textContent).not.toBe("でたらめ辞書");
	});

	it("says でたらめ辞書 and 架空ことわざ outside that Popover heading", async () => {
		expect(UI_CATALOGS.ja.dictionary.title).toBe("でたらめ辞書");
		expect(UI_CATALOGS.en.dictionary.title).toBe("Fake dictionary");
		expect(UI_CATALOGS.ja.fakeProverb.title).toBe("架空ことわざ");
		expect(UI_CATALOGS.ja.toolbar.controls.fakeProverb.name).toBe("架空ことわざ");
		expect(DEFINE_OFF_MESSAGE).toBe("Fake Dictionary is off.");
		setCurrentUiLanguage("ja");
		expect(localize(DEFINE_OFF_MESSAGE)).toBe("でたらめ辞書はオフです。");
		expect(localize(DICTIONARY_DIAGNOSTICS.ready)).toBe("でたらめ辞書: 印の付いた語の上で、設定した修飾キーを押してください。");
		setCurrentUiLanguage("en");
		const h = await harness();
		expect(shell(h).querySelector(".semantropy-fake-proverb-open")?.getAttribute("aria-label")).toBe("Fake proverb");
		switchTo(h, "ja");
		expect(shell(h).querySelector(".semantropy-fake-proverb-open")?.getAttribute("aria-label")).toBe("架空ことわざ");
		const model = {
			headword: "猫", reading: "ネコ", posLabel: "名詞 · 一般", definition: "猫科の架空の生き物。", message: null,
			levelChoices: [{ value: 50, label: "Medium" }], dictionarySemantropy: 50, levelControlEnabled: true,
			reshuffleEnabled: true, copyEnabled: true, collectEnabled: true,
		};
		const modal = new FakeDefinitionModal({} as App, {
			getModel: () => model as never, onReshuffle() {}, onCopy() {}, onCollect() {}, onSemantropyChange() {}, onClosed() {},
		});
		modal.open();
		expect(modal.titleEl.textContent).toBe("でたらめ辞書");
		expect(modal.titleEl.textContent).not.toBe("Fake Dictionary");
		expect(modal.contentEl.querySelector(".semantropy-definition-title")).toBeNull();
		modal.close();
		expect(ui().dictionary.popoverTitle).toBe("Fake Dictionary");
	});

	it("re-words an open view without dropping focus, scroll or a vocabulary draft", async () => {
		const h = await harness();
		const source = shell(h).querySelector(".semantropy-status > .semantropy-meta")!;
		const level = shell(h).querySelector(".semantropy-level-status")!;
		expect(source.textContent?.startsWith("Target: ")).toBe(true);
		expect(level.textContent?.startsWith("Text Semantropy: ")).toBe(true);
		const note = (source.textContent ?? "").slice("Target: ".length);
		const levelName = (level.textContent ?? "").slice("Text Semantropy: ".length);
		const levelJa: Record<string, string> = { Off: "オフ", Low: "低", Medium: "中", High: "高", MAX: "MAX" };
		const scroll = shell(h).querySelector<HTMLElement>(".semantropy-scroll")!;
		scroll.scrollTop = 24;
		h.view.openVocabularyPicker();
		const picker = document.querySelector<HTMLElement>(".semantropy-vocabulary-modal")!;
		picker.querySelector<HTMLSelectElement>("select")!.value = "selected";
		picker.querySelector<HTMLSelectElement>("select")!.dispatchEvent(new Event("change", { bubbles: true }));
		picker.querySelector<HTMLButtonElement>(".semantropy-vocabulary-folder-toggle")!.click();
		const box = picker.querySelector<HTMLInputElement>(".semantropy-vocabulary-tree input[type=checkbox]")!;
		box.checked = true;
		box.dispatchEvent(new Event("change", { bubbles: true }));
		const filter = picker.querySelector<HTMLInputElement>("input[type=search]")!;
		filter.value = "source0";
		filter.focus();
		switchTo(h, "ja");
		expect(document.activeElement).toBe(filter);
		expect(scroll.scrollTop).toBe(24);
		expect(box.checked).toBe(true);
		expect(filter.value).toBe("source0");
		expect(source.textContent).toBe(`対象ノート: ${note}`);
		expect(level.textContent).toBe(`本文Semantropy: ${levelJa[levelName]}`);
		expect(Array.from(shell(h).querySelectorAll(".semantropy-toolbar-group-label")).map(el => el.textContent))
			.toContain("生成設定");
	});

	it("re-words an in-flight Generate and lets that Generate finish", async () => {
		const h = await harness("collision");
		const waiting: (() => void)[] = [];
		const scheduler: CooperativeScheduler = {
			now: () => performance.now(),
			paint: () => new Promise<void>(done => waiting.push(done)),
			yieldTask: () => new Promise<void>(done => waiting.push(done)),
		};
		h.host.scheduler = scheduler;
		h.view.openCollision();
		const task = (Reflect.get(h.view, "collisionSession") as CollisionSession).generate(10, "");
		for (let i = 0; i < 8; i++) await Promise.resolve();
		const modal = (Reflect.get(h.view, "collisionModal") as CollisionModal).contentEl;
		const status = modal.querySelector("[role=status]")!;
		expect(status.textContent).toContain("Generating…");
		const focused = document.activeElement;
		switchTo(h, "ja");
		expect(document.activeElement).toBe(focused);
		expect(status.textContent).toContain("生成中…");
		for (let i = 0; waiting.length && i < 30; i++) { waiting.shift()!(); for (let n = 0; n < 8; n++) await Promise.resolve(); }
		await task;
		expect((Reflect.get(h.view, "collisionSession") as CollisionSession).read()?.batch).toBeTruthy();
		expect(status.isConnected).toBe(true);
	});
});
