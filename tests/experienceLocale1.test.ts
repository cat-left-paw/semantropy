// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { DisplaySlot } from "../src/analysis/displaySlots";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, peekMorph } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { LEXICON as PROVERB_LEXICON, RICH_TEXT as PROVERB_TEXT } from "./fakeProverbCoreFixtures";
import { EN_MESSAGES, UI_CATALOGS, ui } from "../src/i18n/catalog";
import { japaneseMessagePairs, localize } from "../src/i18n/messages";
import { currentUiLanguage, DEFAULT_UI_LANGUAGE, setCurrentUiLanguage, type UiLanguage } from "../src/i18n/language";
import { AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION, defaultAutomaticPosSettings, parseAutomaticPosSettings,
	serializeAutomaticPosSettings, validateAutomaticPosSettingsPatch } from "../src/settings/automaticPosSettings";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { SemantropyPlugin } from "../src/SemantropyPlugin";
import { SemantropySettingTab } from "../src/view/SemantropySettingTab";
import { MANUAL_DIAGNOSTIC_MESSAGES } from "../src/view/manualDiagnosticModel";
import { DICTIONARY_DIAGNOSTICS } from "../src/view/dictionaryDiagnosticModel";
import { collisionMessage, type CollisionSession } from "../src/view/CollisionSession";
import { fakeProverbMessage, FAKE_PROVERB_DISPLAY_BROKEN, FAKE_PROVERB_PUBLISH_FAILED, type FakeProverbSession } from "../src/view/FakeProverbSession";
import type { CollisionModal } from "../src/view/CollisionModal";
import { FakeDefinitionModal } from "../src/view/FakeDefinitionModal";
import type { FakeProverbModal } from "../src/view/FakeProverbModal";
import type { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import type { SemantropyView, SemantropyViewHost } from "../src/view/SemantropyView";
import { STANDARD_COLLISION_RECIPES } from "../src/collision/generated/standardCollisionPatternEntries";
import * as collisionCore from "../src/collision/collisionCore";
import * as proverbCore from "../src/fakeProverb/fakeProverbCore";
import { Notice, type App, type Plugin } from "obsidian";
import type { CooperativeScheduler } from "../src/render/cooperativeScheduler";

/*
 * PRE-RELEASE-EXPERIENCE-LOCALE1 focused regressions (UX-01): an English / Japanese
 * interface. Only fixed interface text follows the language; Source text, generated
 * text, paths, IDs, provenance and Copy / Collect bytes never do, and a switch re-words
 * every open View in place without re-analysis, regeneration, a nonce or a Vault write.
 * jsdom has no layout; the Japanese layout is measured separately in Chromium.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
let randomSpy: MockInstance<Crypto["getRandomValues"]>;
beforeEach(() => {
	let entropy = 0;
	randomSpy = vi.spyOn(document.defaultView!.crypto, "getRandomValues").mockImplementation(array => {
		if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(++entropy % 256);
		return array;
	});
});
const live: ReturnType<typeof manualMorphHarness>[] = [];
afterEach(async () => {
	for (const h of live.splice(0)) await h.view.onClose();
	setCurrentUiLanguage("en");
	vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren();
});

const JAPANESE = /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u;
/** ASCII words that are names, not untranslated English: the product, keys, formats and Obsidian terms. */
const KEPT = new Set(["Semantropy", "MAX", "Alt", "Shift", "Open", "Markdown", "Vault", "Snapshot", "RRGGBB", "Obsidian"]);
/** Every ASCII word of three letters or more that is not a kept name. */
function englishWords(text: string): string[] {
	return (text.match(/[A-Za-z]{3,}/gu) ?? []).filter(word => !KEPT.has(word));
}
function pairsOf(root: unknown): [string[], unknown][] {
	const out: [string[], unknown][] = [];
	const walk = (value: unknown, path: string[]) => {
		if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
		else out.push([path, value]);
	};
	walk(root, []);
	return out;
}
/** Sample arguments for each template, so a template's output can be checked as well. */
function sample(fn: (...args: never[]) => string): string {
	const args = Array.from({ length: fn.length }, (_, i) => (i === 0 ? 3 : 2));
	try { return (fn as (...a: unknown[]) => string)(...args); }
	catch { return (fn as (...a: unknown[]) => string)(["一", "二"]); }
}

/**
 * Fixed interface text inside `root`: text nodes and names (aria-label, aria-description),
 * leaving out the data a View shows as it is — the Target body, generated rows, the
 * definition, paths and note names — so what remains is ours to translate.
 */
const DATA = [".semantropy-body", ".semantropy-collision-text", ".semantropy-fake-proverb-proverb", ".semantropy-fake-proverb-gloss",
	".semantropy-definition-headword", ".semantropy-definition-reading", ".semantropy-definition-pos", ".semantropy-definition-text",
	".semantropy-vocabulary-selected-path", ".semantropy-vocabulary-note", ".semantropy-vocabulary-folder-toggle",
	".semantropy-dictionary-diagnostics > div:not([role])"].join(",");
function fixedTexts(root: Element): string[] {
	const texts: string[] = [];
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.parentElement?.closest(DATA)) continue;
		const value = node.textContent?.trim() ?? "";
		if (value) texts.push(value);
	}
	for (const element of Array.from(root.querySelectorAll("[aria-label]"))) {
		// A folder list is named by its path, which is data.
		if (element.closest(DATA) || element.closest(".semantropy-vocabulary-tree ul")) continue;
		// A Remove button names its path; the path is data.
		texts.push((element.getAttribute("aria-label") ?? "").replace(/[\w/]+\.md/gu, ""));
	}
	for (const option of Array.from(root.querySelectorAll("option"))) texts.push(option.textContent ?? "");
	// Note and path names are data; hex colour presets are values.
	return texts.map(text => text.replace(/\b(?:target|source\d+)(?:\.md)?\b/gu, "").replace(/#[0-9a-f]{6}\b/giu, "")).filter(Boolean);
}
const untranslated = (root: Element) => fixedTexts(root).filter(text => englishWords(text).length > 0);

const nounLexicon = () => lexiconTokenizer([
	token({ surface: "猫", baseForm: "猫", reading: "ネコ" }), token({ surface: "犬", baseForm: "犬", reading: "イヌ" }),
	token({ surface: "鳥", baseForm: "鳥", reading: undefined }), token({ surface: "港", detail1: "固有名詞", detail2: "地域" }),
	token({ surface: "研究", detail1: "サ変接続" }),
]);
const words = ["都市", "猫", "海", "星", "雲", "森", "犬", "机", "光", "夢", "雨", "鳥"];
const collisionTokens = [...words.map(word => token({ surface: word, baseForm: word })), token({ surface: "研究", detail1: "サ変接続" }),
	token({ surface: "眠る", pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形", baseForm: "眠る" })];
async function harness(kind: "noun" | "collision" | "proverb" = "noun") {
	const tokenizer = kind === "noun" ? nounLexicon() : kind === "collision" ? lexiconTokenizer(collisionTokens) : lexiconTokenizer(PROVERB_LEXICON);
	const h = manualMorphHarness(tokenizer, kind === "noun" ? 5000 : 20); live.push(h);
	await h.open(kind === "noun" ? "猫犬鳥港研究。" : kind === "collision" ? collisionTokens.map(t => t.surface).join("") : PROVERB_TEXT);
	(Reflect.get(h.view, "host") as SemantropyViewHost).listVocabularyNotes = () => ["notes/source0.md", "target.md"];
	return h;
}
type H = Awaited<ReturnType<typeof harness>>;
const shell = (h: H) => peekMorph(h.view).contentEl;
const toolbar = (h: H) => shell(h).querySelector<HTMLElement>(".semantropy-toolbar")!;
const collisionModal = (h: H) => Reflect.get(h.view, "collisionModal") as CollisionModal;
const collisionSession = (h: H) => Reflect.get(h.view, "collisionSession") as CollisionSession;
const proverbModal = (h: H) => Reflect.get(h.view, "fakeProverbModal") as FakeProverbModal;
const proverbSession = (h: H) => Reflect.get(h.view, "fakeProverbSession") as FakeProverbSession;
const popover = (h: H) => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
const openManualMenu = (h: H, origin: HTMLElement, slot: DisplaySlot) =>
	(Reflect.get(h.view, "openManualMenu") as (this: SemantropyView, origin: HTMLElement, slot: DisplaySlot, keyboard: boolean) => void).call(h.view, origin, slot, true);
const wait = (ms = 145) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function hover(h: H) {
	const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(e => h.controller().getSlotForElement(e) === h.current("猫"))!;
	el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, altKey: true }));
	await wait(); expect(popover(h).isOpen()).toBe(true);
	return document.querySelector<HTMLElement>(".semantropy-dictionary-popover")!;
}
function switchTo(h: H | H[], language: UiLanguage) {
	setCurrentUiLanguage(language);
	for (const each of Array.isArray(h) ? h : [h]) each.view.languageChanged();
}
function stepping() {
	const waiting: (() => void)[] = [];
	const hold = () => new Promise<void>(done => waiting.push(done));
	const scheduler: CooperativeScheduler = { now: () => performance.now(), paint: hold, yieldTask: hold };
	return { scheduler, async drain() { for (let i = 0; waiting.length && i < 30; i++) { waiting.shift()!(); await flush(); } expect(waiting).toHaveLength(0); } };
}
function choose(select: HTMLSelectElement, value: string) {
	select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("the typed EN / JA catalog", () => {
	it("gives every Japanese entry Japanese text, and every template Japanese output", () => {
		const exempt = new Set(["levels.max", "dictionary.alt", "dictionary.shift", "dictionary.popoverTitle", "display.px", "display.rowLabel", "common.join", "vocabulary.total", "attribution.semantropy", "attribution.dictionary"]);
		for (const [path, value] of pairsOf(UI_CATALOGS.ja)) {
			if (exempt.has(path.join(".")) || path[0] === "collision" && path[1] === "recipeLabels") continue;
			const text = typeof value === "function" ? sample(value as (...args: never[]) => string) : String(value);
			expect(text, path.join(".")).toMatch(JAPANESE);
			expect(englishWords(text), path.join(".")).toEqual([]);
		}
	});

	it("has the same keys in both languages, and a Japanese label for every standard Collision recipe", () => {
		const keys = (root: unknown) => pairsOf(root).map(([path]) => path.join(".")).filter(key => !key.startsWith("collision.recipeLabels."));
		expect(keys(UI_CATALOGS.ja)).toEqual(keys(UI_CATALOGS.en));
		expect(EN_MESSAGES.collision.recipeLabels).toEqual({});
		for (const recipe of STANDARD_COLLISION_RECIPES) {
			expect(UI_CATALOGS.ja.collision.recipeLabels[recipe.id], recipe.id).toMatch(JAPANESE);
		}
	});

	it("never pairs one English message with two different Japanese ones", () => {
		const seen = new Map<string, string>();
		const diverged: string[] = [];
		for (const [en, ja] of japaneseMessagePairs()) {
			const previous = seen.get(en);
			if (previous === undefined) seen.set(en, ja);
			else if (previous !== ja) diverged.push(en);
		}
		// The toolbar action stays 本文をシャッフル. The Collection feature name is the
		// shorter 本文シャッフル. Both use the English toolbar name. localize() keeps the first.
		expect([...new Set(diverged)]).toEqual(["Reshuffle text"]);
		expect(seen.get("Reshuffle text")).toBe("本文をシャッフル");
		setCurrentUiLanguage("ja");
		expect(localize("Reshuffle text")).toBe("本文をシャッフル");
		setCurrentUiLanguage("en");
		expect(seen.size).toBeGreaterThan(250);
	});

	it("shows every message the application, sessions and diagnostics produce in Japanese", () => {
		setCurrentUiLanguage("ja");
		const messages = [
		...japaneseMessagePairs().map(([en]) => en).filter(en => !KEPT.has(en) && en !== UI_CATALOGS.en.dictionary.popoverTitle),
			...Object.values(MANUAL_DIAGNOSTIC_MESSAGES), ...Object.values(DICTIONARY_DIAGNOSTICS),
			FAKE_PROVERB_PUBLISH_FAILED, FAKE_PROVERB_DISPLAY_BROKEN,
			...(["no-noun", "no-viable-recipe", "recipe-not-viable", "duplicate-exhausted", "cancelled", "invalid-request"] as const).map(reason => collisionMessage(reason)),
			...(["insufficient-candidates", "no-compatible-gloss", "duplicate-exhaustion", "cancelled", "stale", "released", "invalid-request"] as const)
				.flatMap(reason => [fakeProverbMessage(reason), fakeProverbMessage(reason, true)]),
		].filter(Boolean);
		for (const message of messages) {
			const shown = localize(message);
			expect(shown, message).toMatch(JAPANESE);
			expect(englishWords(shown), message).toEqual([]);
		}
	});

	it("is the identity in English, and leaves text it does not know — generated text, paths — unchanged", () => {
		for (const [en] of japaneseMessagePairs()) expect(localize(en)).toBe(en);
		setCurrentUiLanguage("ja");
		for (const data of ["猫は研究する。", "notes/Source.md", "Reshuffle text!", ""]) expect(localize(data)).toBe(data);
		expect(ui()).toBe(UI_CATALOGS.ja);
		setCurrentUiLanguage("fr" as UiLanguage);
		expect(currentUiLanguage()).toBe("ja");
	});
});

describe("settings schema 5 `uiLanguage`", () => {
	const other = { bodySemantropy: 37, dictionarySemantropy: 9, collectionPath: "Collected/Fragments.md", showRuby: false,
		automaticPos: { noun: false, verb: true, iAdjective: false, adverb: true } };

	it("is Japanese on a new install, English for settings saved by schema 1-4", () => {
		expect(AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION).toBe(8);
		expect(DEFAULT_UI_LANGUAGE).toBe("ja");
		expect(parseAutomaticPosSettings(null).uiLanguage).toBe("ja");
		expect(parseAutomaticPosSettings(undefined).uiLanguage).toBe("ja");
		for (const schemaVersion of [1, 2, 3, 4]) {
			const parsed = parseAutomaticPosSettings({ schemaVersion, ...other, uiLanguage: "ja" });
			expect(parsed.uiLanguage, String(schemaVersion)).toBe("en");
			expect(parsed.bodySemantropy).toBe(37);
		}
		expect(parseAutomaticPosSettings({ schemaVersion: 4, ...other }).automaticPos).toEqual(other.automaticPos);
	});

	it("falls back to Japanese for an invalid schema 5 value on that field alone", () => {
		for (const bad of ["fr", "EN", "", 1, null, true, {}, ["ja"], undefined]) {
			const parsed = parseAutomaticPosSettings({ schemaVersion: 5, ...other, uiLanguage: bad });
			expect(parsed.uiLanguage, JSON.stringify(bad)).toBe("ja");
			expect(parsed).toMatchObject(other);
		}
		const getter = vi.fn(() => "en");
		expect(parseAutomaticPosSettings(Object.defineProperty({ schemaVersion: 5, ...other }, "uiLanguage", { get: getter, enumerable: true })).uiLanguage).toBe("ja");
		expect(getter).not.toHaveBeenCalled();
	});

	it("round-trips both languages and refuses an invalid request", () => {
		for (const uiLanguage of ["en", "ja"] as const) {
			const written = serializeAutomaticPosSettings(parseAutomaticPosSettings({ schemaVersion: 5, ...other, uiLanguage }));
			expect(written).toMatchObject({ schemaVersion: 8, uiLanguage, showRibbonIcon: true, ...other });
			expect(parseAutomaticPosSettings(JSON.parse(JSON.stringify(written))).uiLanguage).toBe(uiLanguage);
		}
		for (const bad of ["fr", 1, null, "JA"]) expect(validateAutomaticPosSettingsPatch({ uiLanguage: bad })).toBeNull();
		expect(validateAutomaticPosSettingsPatch({ uiLanguage: "en" })).toEqual({ uiLanguage: "en" });
	});

	it("is saved through the store, kept on failure, and restored on the next load", async () => {
		let disk: unknown = { schemaVersion: 4, ...other };
		let fail = false;
		const persistence = { load: async () => disk, save: async (data: unknown) => { if (fail) throw Error("private path"); disk = data; } };
		const store = new AutomaticPosSettingsStore(persistence);
		await store.load();
		expect(store.getUiLanguage()).toBe("en");
		fail = true;
		expect(await store.setUiLanguage("ja")).toBe(false);
		expect(store.getUiLanguage()).toBe("en");
		expect(disk).toMatchObject({ schemaVersion: 4 });
		fail = false;
		expect(await store.setUiLanguage("ja")).toBe(true);
		expect(disk).toMatchObject({ schemaVersion: 8, uiLanguage: "ja", showRibbonIcon: true, ...other });
		// A restart reads the saved language; nothing else moved.
		const restarted = new AutomaticPosSettingsStore(persistence);
		await restarted.load();
		expect(restarted.getUiLanguage()).toBe("ja");
		expect(restarted.getSettings()).toMatchObject(other);
		expect(await restarted.setUiLanguage("fr" as UiLanguage)).toBe(false);
		expect(defaultAutomaticPosSettings().uiLanguage).toBe("ja");
	});
});

describe("every surface in Japanese", () => {
	it("words the Toolbar, its popups, the status line and diagnostics with no English left", async () => {
		setCurrentUiLanguage("ja");
		const h = await harness();
		const bar = toolbar(h);
		expect(bar.querySelector(".semantropy-reshuffle")?.getAttribute("aria-label")).toBe("本文をシャッフル");
		expect(bar.querySelector(".semantropy-reshuffle .semantropy-action-label")?.textContent).toBe("本文をシャッフル");
		expect(Array.from(bar.querySelectorAll(".semantropy-toolbar-group-label")).map(el => el.textContent))
			.toEqual(["本文と断片", "語彙", "フレーズ生成", "生成設定", "設定"]);
		expect(Array.from(bar.querySelectorAll(".semantropy-more-heading")).map(el => el.textContent))
			.toEqual(["本文と断片", "語彙", "フレーズ生成", "生成設定", "設定"]);
		// One short name per control, never a title.
		expect(bar.querySelectorAll("[title]")).toHaveLength(0);
		bar.querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!.click();
		bar.querySelector<HTMLButtonElement>(".semantropy-level-button")!.click();
		bar.querySelector<HTMLButtonElement>(".semantropy-automatic-pos-toolbar > button")!.click();
		expect(untranslated(shell(h))).toEqual([]);
		expect(fixedTexts(shell(h)).join("\n")).toMatch(JAPANESE);
		expect(shell(h).querySelector(".semantropy-level-status")?.textContent).toMatch(/^本文Semantropy: /u);
		expect(shell(h).querySelector(".semantropy-status-vocabulary")?.textContent).toBe("語彙: 現在のノート · 抽選方式: 均等");
	});

	it("words the Manual menu, the Fake Dictionary Popover and Modal", async () => {
		setCurrentUiLanguage("ja");
		const h = await harness();
		const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(e => h.controller().getSlotForElement(e) === h.current("猫"))!;
		openManualMenu(h, el, h.current("猫"));
		const menu = shell(h).querySelector<HTMLElement>(".semantropy-manual-menu")!;
		expect(menu.getAttribute("aria-label")).toBe("語の操作");
		expect(Array.from(menu.querySelectorAll("button")).map(b => b.textContent)).toEqual(["この語をシャッフル", "元に戻す", "自動の結果を使う", "でたらめ辞書で引く"]);
		(Reflect.get(h.view, "closeManualMenu") as (this: SemantropyView) => void).call(h.view);
		const panel = await hover(h);
		expect(panel.getAttribute("aria-label")).toBe("Fake Dictionary");
		expect(Array.from(panel.querySelectorAll(".semantropy-definition-actions button")).map(b => b.getAttribute("aria-label")))
			.toEqual(["定義をシャッフル", "見出し語と定義をコピー", "見出し語と定義を収集"]);
		expect(panel.querySelector("select")?.getAttribute("aria-label")).toBe("でたらめ辞書のSemantropyレベル");
		expect(Array.from(panel.querySelectorAll("option")).map(o => o.textContent)).toEqual(["低", "中", "高", "MAX"]);
		expect(untranslated(panel).filter(text => text !== "Fake Dictionary")).toEqual([]);
	});

	it("words the Vocabulary picker, Collision and Fake proverb, including empty and partial states", async () => {
		setCurrentUiLanguage("ja");
		const h = await harness("collision");
		h.view.openVocabularyPicker();
		const picker = document.querySelector<HTMLElement>(".semantropy-vocabulary-modal")!;
		choose(picker.querySelector<HTMLSelectElement>("select")!, "selected");
		expect(picker.querySelector(".semantropy-vocabulary-picker-status")?.textContent).toBe("0件のノートを選択");
		expect(untranslated(picker)).toEqual([]);
		(Reflect.get(h.view, "vocabularyModal") as { close(): void }).close();

		h.view.openCollision();
		const collision = collisionModal(h).contentEl;
		// Empty state before Generate.
		expect(collision.querySelector("[role=status]")?.textContent).toBe("まだ結果はありません。");
		await collisionSession(h).generate(10, "");
		expect(collisionModal(h).contentEl.querySelectorAll(".semantropy-collision-row").length).toBeGreaterThan(0);
		expect(untranslated(collisionModal(h).modalEl)).toEqual([]);
		expect(collision.querySelector(".semantropy-collision-row .semantropy-collision-pattern")?.textContent).toMatch(/^現在のパターン: /u);
		collisionModal(h).close();

		const p = await harness("proverb");
		const original = proverbCore.generateFakeProverbs;
		vi.spyOn(proverbCore, "generateFakeProverbs").mockImplementation(input => {
			const real = original(input);
			if (!real.ok) return real;
			return Object.freeze({ ok: true as const, value: Object.freeze({ ...real.value, drafts: real.value.drafts.slice(0, 3), shortfall: "no-compatible-gloss" as const }) });
		});
		p.view.openFakeProverb();
		await proverbSession(p).generate();
		const proverb = proverbModal(p).contentEl;
		expect(proverb.querySelector("[role=status]")?.textContent).toBe("一部だけ生成しました: 3 / 10 件。語彙が不足しています: 生成したことわざに合う解説がありません。");
		expect(proverb.querySelectorAll(".semantropy-fake-proverb-row")[5]?.querySelector("[role=status]")?.textContent).toBe("この位置には結果がありません。");
		expect(untranslated(proverbModal(p).modalEl)).toEqual([]);
	});

	it("words the settings tab, and keeps a typed path and the language on relabel", async () => {
		setCurrentUiLanguage("ja");
		let language: UiLanguage = "ja";
		const tab = new SemantropySettingTab({ vault: {} } as unknown as App, {} as Plugin, {
			getCollectionPath: () => "Semantropy Collection.md", setCollectionPath: async () => true,
			getUiLanguage: () => language, setUiLanguage: async value => { language = value; return true; },
			getShowRibbonIcon: () => true, setShowRibbonIcon: async () => true,
			getCollectAttribution: () => ({ feature: false, target: false, vocabulary: false, semantropy: false, date: false }),
			setCollectAttribution: async () => true,
		});
		tab.show();
		expect(Array.from(tab.containerEl.querySelectorAll(".setting-item-name")).map(el => el.textContent)).toEqual(
			["表示言語", "リボンアイコンを表示", "収集ファイル", "生成の種類を記録", "対象ノートを記録", "語彙ソースを記録", "生成時のSemantropy値を記録", "収集した日付を記録"]);
		expect(tab.containerEl.querySelector(".semantropy-attribution-group .setting-group-heading")?.textContent).toBe("収集ノートに生成由来を記録");
		expect(tab.containerEl.querySelector(".semantropy-collection-path-save")?.textContent).toBe("保存");
		const dropdown = tab.containerEl.querySelector<HTMLSelectElement>(".semantropy-language-setting select")!;
		expect(Array.from(dropdown.options).map(o => [o.value, o.textContent])).toEqual([["ja", "日本語"], ["en", "English"]]);
		expect(dropdown.value).toBe("ja");
		const input = tab.containerEl.querySelector<HTMLInputElement>("input")!;
		input.value = "Draft/typed.md"; input.dispatchEvent(new Event("input"));
		input.focus();
		setCurrentUiLanguage("en"); language = "en"; tab.relabel();
		expect(Array.from(tab.containerEl.querySelectorAll(".setting-item-name")).map(el => el.textContent)).toEqual(
			["Interface language", "Show ribbon icon", "Collection file", "Record generation type", "Record Target note", "Record Vocabulary notes", "Record generation Semantropy level", "Record collection date"]);
		expect(tab.containerEl.querySelector(".semantropy-attribution-group .setting-group-heading")?.textContent).toBe("Record generation details in Collection");
		expect(tab.containerEl.querySelector(".semantropy-collection-path-save")?.textContent).toBe("Save");
		expect(input.value).toBe("Draft/typed.md");
		expect(document.activeElement === input || !input.isConnected || document.activeElement === document.body).toBe(true);
		expect(dropdown.value).toBe("en");
		tab.hide();
	});

	it("restores the settings dropdown if its host rejects", async () => {
		const tab = new SemantropySettingTab({ vault: {} } as unknown as App, {} as Plugin, {
			getCollectionPath: () => "Semantropy Collection.md", setCollectionPath: async () => true,
			getUiLanguage: () => "en", setUiLanguage: async () => { throw Error("queue repair rejected"); },
			getShowRibbonIcon: () => true, setShowRibbonIcon: async () => true,
			getCollectAttribution: () => ({ feature: false, target: false, vocabulary: false, semantropy: false, date: false }),
			setCollectAttribution: async () => true,
		});
		tab.show();
		const dropdown = tab.containerEl.querySelector<HTMLSelectElement>(".semantropy-language-setting select")!;
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		dropdown.value = "ja";
		expect(await tab.changeUiLanguage("ja")).toBe(false);
		expect(dropdown.value).toBe("en");
		expect(tab.containerEl.querySelector(".semantropy-language-status")?.textContent).toBe(EN_MESSAGES.settings.languageSaveFailed);
		expect(error).toHaveBeenCalled();
		tab.hide();
	});
});

describe("switching the language in an open View", () => {
	it("rewords a transient Toolbar notice without replacing its element or restarting its timeout", async () => {
		const h = await harness();
		const bar = Reflect.get(h.view, "toolbar") as { announce(message: string): void };
		const feedback = shell(h).querySelector<HTMLElement>(".semantropy-toolbar-feedback")!;
		bar.announce("Copied.");
		expect(feedback.textContent).toBe("Copied.");
		switchTo(h, "ja");
		expect(shell(h).querySelector(".semantropy-toolbar-feedback")).toBe(feedback);
		expect(feedback.textContent).toBe("コピーしました。");
		switchTo(h, "en");
		expect(feedback.textContent).toBe("Copied.");
	});

	it("round-trips every fixed text exactly back to English", async () => {
		const h = await harness();
		toolbar(h).querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!.click();
		const before = fixedTexts(shell(h));
		const labels = Array.from(shell(h).querySelectorAll("[aria-label]")).map(el => el.getAttribute("aria-label"));
		switchTo(h, "ja");
		expect(untranslated(shell(h))).toEqual([]);
		switchTo(h, "en");
		expect(fixedTexts(shell(h))).toEqual(before);
		expect(Array.from(shell(h).querySelectorAll("[aria-label]")).map(el => el.getAttribute("aria-label"))).toEqual(labels);
	});

	it("keeps the open display menu, a Custom colour draft, the Automatic draft and focus", async () => {
		const h = await harness();
		const bar = toolbar(h);
		bar.querySelector<HTMLButtonElement>(".semantropy-automatic-pos-toolbar > button")!.click();
		const verb = bar.querySelector<HTMLInputElement>(".semantropy-automatic-pos-menu input[id$='-verb']")!;
		verb.checked = true; verb.dispatchEvent(new Event("change"));
		bar.querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!.click();
		const color = bar.querySelector<HTMLSelectElement>(".semantropy-color-bodyBackground")!;
		choose(color, "custom");
		const field = bar.querySelector<HTMLInputElement>(".semantropy-color-input-bodyBackground")!;
		field.value = "#12"; field.focus();
		const menu = bar.querySelector<HTMLElement>(".semantropy-display-menu")!;
		const nodes = Array.from(bar.querySelectorAll("*"));
		const reads = h.calls.reads.length, tokens = h.calls.tokenizations.length, body = h.root().innerHTML;
		switchTo(h, "ja");
		expect(menu.hidden).toBe(false);
		expect(color.value).toBe("custom");
		expect(field.value).toBe("#12");
		expect(document.activeElement).toBe(field);
		expect(field.getAttribute("aria-label")).toBe("背景色のカスタム値（#RRGGBB形式）");
		// Nothing was rebuilt.
		expect(Array.from(bar.querySelectorAll("*"))).toEqual(nodes);
		expect(h.calls.reads).toHaveLength(reads); expect(h.calls.tokenizations).toHaveLength(tokens);
		expect(h.root().innerHTML).toBe(body);
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
	});

	it("re-plans a narrow Toolbar across languages without closing More or a moved display draft", async () => {
		const h = await harness();
		const bar = toolbar(h);
		const control = Reflect.get(h.view, "toolbar") as { refreshLayout(): void };
		Object.defineProperty(bar, "clientWidth", { configurable: true, value: 250 });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const width = this.classList.contains("semantropy-toolbar-group-label") ? (currentUiLanguage() === "en" ? 30 : 90)
				: this.classList.contains("semantropy-toolbar-item") ? 30 : 0;
			return { width, left: 0, right: width, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
		});
		control.refreshLayout();
		const more = bar.querySelector<HTMLButtonElement>(".semantropy-more-button")!;
		const display = bar.querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!;
		const menu = bar.querySelector<HTMLElement>(".semantropy-display-menu")!;
		const moreMenu = bar.querySelector<HTMLElement>(".semantropy-more-menu")!;
		expect(more.parentElement!.hidden).toBe(false);
		expect(display.closest(".semantropy-more-menu")).toBe(moreMenu);
		more.click(); display.click();
		const color = menu.querySelector<HTMLSelectElement>(".semantropy-color-bodyBackground")!;
		choose(color, "custom");
		const draft = menu.querySelector<HTMLInputElement>(".semantropy-color-input-bodyBackground")!;
		draft.value = "#12"; draft.focus(); menu.scrollTop = 37; moreMenu.scrollTop = 19;
		const before = Array.from(bar.querySelectorAll(".semantropy-more-items > .semantropy-toolbar-item")).map(el => el.className);
		switchTo(h, "ja");
		const after = Array.from(bar.querySelectorAll(".semantropy-more-items > .semantropy-toolbar-item")).map(el => el.className);
		expect(after).not.toEqual(before);
		expect(moreMenu.hidden).toBe(false); expect(menu.hidden).toBe(false);
		expect(more.getAttribute("aria-expanded")).toBe("true"); expect(display.getAttribute("aria-expanded")).toBe("true");
		expect(draft.value).toBe("#12"); expect(document.activeElement).toBe(draft);
		expect(menu.scrollTop).toBe(37); expect(moreMenu.scrollTop).toBe(19);
		expect(draft.getAttribute("aria-label")).toBe("背景色のカスタム値（#RRGGBB形式）");
	});

	it("keeps open More when shorter Japanese labels make overflow unnecessary", async () => {
		const h = await harness();
		const bar = toolbar(h);
		const control = Reflect.get(h.view, "toolbar") as { refreshLayout(): void };
		Object.defineProperty(bar, "clientWidth", { configurable: true, value: 360 });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const width = this.classList.contains("semantropy-toolbar-group-label") ?
				(this.closest<HTMLElement>(".semantropy-toolbar-group")?.hidden ? 0 : currentUiLanguage() === "en" ? 90 : 20)
				: this.classList.contains("semantropy-toolbar-item") ? 30 : 0;
			return { width, left: 0, right: width, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
		});
		control.refreshLayout();
		const moreItem = bar.querySelector<HTMLElement>(".semantropy-toolbar-more")!;
		const more = bar.querySelector<HTMLButtonElement>(".semantropy-more-button")!;
		const moreMenu = bar.querySelector<HTMLElement>(".semantropy-more-menu")!;
		const display = bar.querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!;
		const menu = bar.querySelector<HTMLElement>(".semantropy-display-menu")!;
		expect(moreItem.hidden).toBe(false);
		expect(moreMenu.contains(display)).toBe(true);
		more.click(); display.click();
		const color = menu.querySelector<HTMLSelectElement>(".semantropy-color-bodyBackground")!;
		choose(color, "custom");
		const draft = menu.querySelector<HTMLInputElement>(".semantropy-color-input-bodyBackground")!;
		draft.value = "#12"; draft.focus(); menu.scrollTop = 37; moreMenu.scrollTop = 19;
		switchTo(h, "ja");
		expect(moreItem.hidden).toBe(false);
		expect(moreMenu.hidden).toBe(false); expect(menu.hidden).toBe(false);
		expect(more.getAttribute("aria-expanded")).toBe("true"); expect(display.getAttribute("aria-expanded")).toBe("true");
		expect(document.activeElement).toBe(draft); expect(draft.value).toBe("#12");
		expect(menu.scrollTop).toBe(37); expect(moreMenu.scrollTop).toBe(19);
		// Once the user closes More, every control really does fit in Japanese.
		more.focus(); more.click();
		expect(moreItem.hidden).toBe(true);
		expect(menu.hidden).toBe(true);
		expect(display.closest(".semantropy-more-menu")).toBeNull();
		expect(bar.contains(document.activeElement)).toBe(true);
		expect(moreItem.contains(document.activeElement)).toBe(false);
	});

	it("keeps focus on an open More button until it closes after overflow disappears", async () => {
		const h = await harness();
		const bar = toolbar(h);
		const control = Reflect.get(h.view, "toolbar") as { refreshLayout(): void };
		Object.defineProperty(bar, "clientWidth", { configurable: true, value: 360 });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const width = this.classList.contains("semantropy-toolbar-group-label") ?
				(this.closest<HTMLElement>(".semantropy-toolbar-group")?.hidden ? 0 : currentUiLanguage() === "en" ? 90 : 20)
				: this.classList.contains("semantropy-toolbar-item") ? 30 : 0;
			return { width, left: 0, right: width, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
		});
		control.refreshLayout();
		const moreItem = bar.querySelector<HTMLElement>(".semantropy-toolbar-more")!;
		const more = bar.querySelector<HTMLButtonElement>(".semantropy-more-button")!;
		const menu = bar.querySelector<HTMLElement>(".semantropy-more-menu")!;
		more.click(); more.focus();
		switchTo(h, "ja");
		expect([moreItem.hidden, menu.hidden, document.activeElement]).toEqual([false, false, more]);
		more.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect([moreItem.hidden, menu.hidden]).toEqual([true, true]);
		expect(bar.contains(document.activeElement)).toBe(true);
		expect(moreItem.contains(document.activeElement)).toBe(false);
	});

	it("keeps Collision rows, focus and Copy / Collect bytes, and draws nothing", async () => {
		const h = await harness("collision");
		h.view.openCollision();
		await collisionSession(h).generate(10, "");
		const ui = collisionModal(h).contentEl;
		const rows = Array.from(ui.querySelectorAll<HTMLElement>(".semantropy-collision-row"));
		const texts = rows.map(row => row.querySelector(".semantropy-collision-text")!.textContent);
		const batch = collisionSession(h).read()!.batch!;
		const copy = Array.from(rows[1]!.querySelectorAll("button")).find(b => b.textContent === "Copy")!;
		copy.focus();
		await collisionSession(h).write(batch.rows[1]!.rowSlotId, "copy");
		await collisionSession(h).write(batch.rows[1]!.rowSlotId, "collect");
		const generate = vi.spyOn(collisionCore, "generateCollisionResults");
		const random = randomSpy.mock.calls.length;
		const reads = h.calls.reads.length, tokens = h.calls.tokenizations.length;
		switchTo(h, "ja");
		expect(Array.from(ui.querySelectorAll(".semantropy-collision-row"))).toEqual(rows);
		expect(rows.map(row => row.querySelector(".semantropy-collision-text")!.textContent)).toEqual(texts);
		expect(collisionSession(h).read()!.batch).toBe(batch);
		expect(rows[0]!.querySelector(".semantropy-collision-pattern")!.textContent).toMatch(/^現在のパターン: /u);
		expect(document.activeElement).toBe(copy);
		expect(copy.textContent).toBe("コピー");
		expect(rows[1]!.querySelector("[role=status]")?.textContent).toMatch(JAPANESE);
		expect(generate).not.toHaveBeenCalled();
		expect(randomSpy.mock.calls.length).toBe(random);
		expect(h.calls.reads).toHaveLength(reads); expect(h.calls.tokenizations).toHaveLength(tokens);
		await collisionSession(h).write(batch.rows[1]!.rowSlotId, "copy");
		await collisionSession(h).write(batch.rows[1]!.rowSlotId, "collect");
		expect(h.calls.copy).toHaveLength(2); expect(h.calls.copy[1]).toBe(h.calls.copy[0]);
		expect(h.calls.collect).toHaveLength(2); expect(h.calls.collect[1]).toEqual(h.calls.collect[0]);
	});

	it("lets an in-flight Generate finish, and words its result in the new language", async () => {
		const h = await harness("collision");
		const gates = stepping();
		h.host.scheduler = gates.scheduler;
		h.view.openCollision();
		const task = collisionSession(h).generate(10, "");
		await flush();
		const status = collisionModal(h).contentEl.querySelector("[role=status]")!;
		expect(status.textContent).toContain("Generating…");
		switchTo(h, "ja");
		expect(status.textContent).toContain("生成中…");
		await gates.drain(); await task;
		expect(collisionSession(h).read()!.batch).toBeTruthy();
		expect(status.textContent).toMatch(/^10 \/ 10 件。/u);
	});

	it("keeps the Fake proverb batch and Copy / Collect bytes", async () => {
		const h = await harness("proverb");
		h.view.openFakeProverb();
		await proverbSession(h).generate();
		const batch = proverbSession(h).batch()!;
		const rows = Array.from(proverbModal(h).contentEl.querySelectorAll<HTMLElement>(".semantropy-fake-proverb-row"));
		const nodes = rows.map(row => row.querySelector(".semantropy-fake-proverb-proverb")!.firstChild);
		const slot = proverbSession(h).slotAt(0)!;
		await proverbSession(h).write(slot, "copy"); await proverbSession(h).write(slot, "collect");
		const generate = vi.spyOn(proverbCore, "generateFakeProverbs");
		switchTo(h, "ja");
		expect(proverbSession(h).batch()).toBe(batch);
		expect(rows.map(row => row.querySelector(".semantropy-fake-proverb-proverb")!.firstChild)).toEqual(nodes);
		expect(proverbModal(h).contentEl.querySelector("[role=status]")?.textContent).toBe("10 / 10 件。");
		expect(rows[0]!.querySelector("[role=status]")?.textContent).toBe("収集しました。");
		expect(generate).not.toHaveBeenCalled();
		await proverbSession(h).write(slot, "copy"); await proverbSession(h).write(slot, "collect");
		expect(h.calls.copy[1]).toBe(h.calls.copy[0]);
		expect(h.calls.collect[1]).toEqual(h.calls.collect[0]);
	});

	it("keeps the Vocabulary picker's draft, filter and focus", async () => {
		const h = await harness();
		h.view.openVocabularyPicker();
		const picker = document.querySelector<HTMLElement>(".semantropy-vocabulary-modal")!;
		choose(picker.querySelector<HTMLSelectElement>("select")!, "selected");
		picker.querySelector<HTMLButtonElement>(".semantropy-vocabulary-folder-toggle")!.click();
		const box = picker.querySelector<HTMLInputElement>(".semantropy-vocabulary-tree input[type=checkbox]")!;
		box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true }));
		const filter = picker.querySelector<HTMLInputElement>("input[type=search]")!;
		filter.focus();
		switchTo(h, "ja");
		expect(picker.querySelector<HTMLSelectElement>("select")!.value).toBe("selected");
		expect(box.isConnected && box.checked).toBe(true);
		expect(document.activeElement).toBe(filter);
		expect(picker.querySelector(".semantropy-vocabulary-picker-status")?.textContent).toBe("1件のノートを選択");
		expect(picker.querySelector(".semantropy-vocabulary-selected button")?.textContent).toBe("外す");
		expect(untranslated(picker)).toEqual([]);
		expect(h.calls.reads.filter(path => path !== "target.md")).toEqual([]);
	});

	it("keeps the open Fake Dictionary Popover, its definition and its Copy bytes", async () => {
		const h = await harness();
		const panel = await hover(h);
		const definition = panel.querySelector(".semantropy-definition-text")!.textContent;
		expect(await h.view.copyDefinition()).toBe("copied");
		switchTo(h, "ja");
		expect(popover(h).isOpen()).toBe(true);
		expect(panel.isConnected).toBe(true);
		expect(panel.querySelector(".semantropy-definition-text")!.textContent).toBe(definition);
		expect(panel.querySelector(".semantropy-definition-title")?.textContent).toBe("Fake Dictionary");
		expect(Array.from(panel.querySelectorAll(".semantropy-definition-actions button")).map(b => b.getAttribute("aria-label")))
			.toEqual(["定義をシャッフル", "見出し語と定義をコピー", "見出し語と定義を収集"]);
		expect(Array.from(panel.querySelectorAll("option")).map(o => o.textContent)).toEqual(["低", "中", "高", "MAX"]);
		expect(await h.view.copyDefinition()).toBe("copied");
		expect(h.calls.copy[1]).toBe(h.calls.copy[0]);
	});

	it("re-words an open Manual menu in place and keeps its focus", async () => {
		const h = await harness();
		const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(e => h.controller().getSlotForElement(e) === h.current("猫"))!;
		openManualMenu(h, el, h.current("猫"));
		const menu = shell(h).querySelector<HTMLElement>(".semantropy-manual-menu")!;
		const restoreButton = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"))[1]!;
		restoreButton.focus();
		switchTo(h, "ja");
		expect(shell(h).querySelector(".semantropy-manual-menu")).toBe(menu);
		expect(menu.getAttribute("aria-label")).toBe("語の操作");
		expect(Array.from(menu.querySelectorAll("button")).map(b => b.textContent)).toEqual(["この語をシャッフル", "元に戻す", "自動の結果を使う", "でたらめ辞書で引く"]);
		expect(document.activeElement).toBe(restoreButton);
	});

	it("re-words an open Fake Dictionary Modal and keeps its definition", async () => {
		const model = { headword: "猫", reading: "ネコ", posLabel: "名詞 · 一般", definition: "猫科の架空の生き物。", message: null,
			levelChoices: [{ value: 25, label: "Low" }, { value: 50, label: "Medium" }], dictionarySemantropy: 50, levelControlEnabled: true,
			reshuffleEnabled: true, copyEnabled: true, collectEnabled: true };
		const modal = new FakeDefinitionModal({} as App, { getModel: () => model as never, onReshuffle() {}, onCopy() {}, onCollect() {}, onSemantropyChange() {}, onClosed() {} });
		modal.open();
		expect(modal.titleEl.textContent).toBe("Fake dictionary");
		const copy = modal.contentEl.querySelector<HTMLButtonElement>(".semantropy-copy-definition")!;
		copy.focus();
		setCurrentUiLanguage("ja"); modal.relabel();
		expect(modal.titleEl.textContent).toBe("でたらめ辞書");
		expect(copy.getAttribute("aria-label")).toBe("見出し語と定義をコピー");
		expect(Array.from(modal.contentEl.querySelectorAll("option")).map(o => o.textContent)).toEqual(["低", "中"]);
		expect(modal.contentEl.querySelector(".semantropy-definition-text")?.textContent).toBe("猫科の架空の生き物。");
		expect(document.activeElement).toBe(copy);
		modal.close();
	});
});

describe("the plugin applies the stored language to every View", () => {
	type Fake = { settingsStore: AutomaticPosSettingsStore; semantropyViews: () => SemantropyView[]; settingTab: SemantropySettingTab | null;
		applyUiLanguage: (language: UiLanguage) => void; renameRibbon: () => void; notices: Map<Notice, string> };
	const setUiLanguage = Reflect.get(SemantropyPlugin.prototype, "setUiLanguage") as (this: Fake, value: UiLanguage) => Promise<boolean>;
	function plugin(views: H[], persistence: { load: () => Promise<unknown>; save: (data: unknown) => Promise<void> }) {
		const store = new AutomaticPosSettingsStore(persistence);
		const fake: Fake = { settingsStore: store, semantropyViews: () => views.map(h => h.view), settingTab: null, notices: new Map(),
			applyUiLanguage: Reflect.get(SemantropyPlugin.prototype, "applyUiLanguage") as Fake["applyUiLanguage"], renameRibbon: () => undefined };
		fake.settingTab = new SemantropySettingTab({ vault: {} } as unknown as App, {} as Plugin, {
			getCollectionPath: () => store.getCollectionPath(), setCollectionPath: async () => true,
			getUiLanguage: () => store.getUiLanguage(), setUiLanguage: value => setUiLanguage.call(fake, value),
			getShowRibbonIcon: () => store.getShowRibbonIcon(), setShowRibbonIcon: async () => true,
			getCollectAttribution: () => store.getCollectAttribution(),
			setCollectAttribution: (key, value) => store.setCollectAttribution(key, value),
		});
		return { fake, store, set: (value: UiLanguage) => setUiLanguage.call(fake, value) };
	}
	const name = (h: H) => toolbar(h).querySelector(".semantropy-reshuffle")?.getAttribute("aria-label");

	it("re-words every open View and the settings tab after a successful save", async () => {
		const a = await harness(), b = await harness();
		let disk: unknown = { schemaVersion: 4 };
		const { fake, store, set } = plugin([a, b], { load: async () => disk, save: async data => { disk = data; } });
		await store.load(); fake.settingTab!.show();
		expect([name(a), name(b)]).toEqual(["Reshuffle text", "Reshuffle text"]);
		expect(await set("ja")).toBe(true);
		expect(currentUiLanguage()).toBe("ja");
		expect([name(a), name(b)]).toEqual(["本文をシャッフル", "本文をシャッフル"]);
		expect(fake.settingTab!.containerEl.querySelector(".setting-item-name")?.textContent).toBe("表示言語");
		expect(disk).toMatchObject({ schemaVersion: 8, uiLanguage: "ja", showRibbonIcon: true });
		fake.settingTab!.hide();
	});

	it("keeps the previous language on a failed save and says so", async () => {
		const a = await harness();
		const { fake, store } = plugin([a], { load: async () => ({ schemaVersion: 4 }), save: async () => { throw Error("private path"); } });
		await store.load(); fake.settingTab!.show();
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const dropdown = fake.settingTab!.containerEl.querySelector<HTMLSelectElement>(".semantropy-language-setting select")!;
		// The reader's own change: the dropdown shows Japanese until the save answers.
		choose(dropdown, "ja");
		expect(dropdown.value).toBe("ja");
		await store.whenSettled(); await flush();
		expect(await fake.settingTab!.changeUiLanguage("ja")).toBe(false);
		expect(currentUiLanguage()).toBe("en");
		expect(name(a)).toBe("Reshuffle text");
		expect(dropdown.value).toBe("en");
		expect(fake.settingTab!.containerEl.querySelector(".semantropy-language-status")?.textContent).toBe(EN_MESSAGES.settings.languageSaveFailed);
		expect(error.mock.calls.flat().join(" ")).not.toContain("private path");
		fake.settingTab!.hide();
	});

	it("compensates a write-then-reject and restarts in the effective language", async () => {
		const a = await harness();
		let disk: unknown = { schemaVersion: 4 }, writes = 0;
		const persistence = { load: async () => disk, save: async (data: unknown) => {
			disk = data;
			if (++writes === 1) throw Error("rejected after writing");
		} };
		const { store, set } = plugin([a], persistence);
		await store.load();
		expect(await set("ja")).toBe(false);
		expect(writes).toBe(2);
		expect(store.getUiLanguage()).toBe("en");
		expect(name(a)).toBe("Reshuffle text");
		expect(disk).toMatchObject({ schemaVersion: 8, uiLanguage: "en", showRibbonIcon: true });
		const restarted = new AutomaticPosSettingsStore(persistence);
		await restarted.load();
		expect(restarted.getUiLanguage()).toBe("en");
	});

	it("restores the dropdown and reports a failed queue recovery", async () => {
		const a = await harness();
		let writes = 0;
		const { fake, store } = plugin([a], { load: async () => ({ schemaVersion: 4 }), save: async () => {
			if (++writes !== 1) throw Error("recovery rejected");
		} });
		await store.load();
		expect(await store.transact({ uiLanguage: "ja" }, {
			current: () => true, publish: () => { throw Error("publication failed"); }, commit: () => undefined, rollback: () => undefined,
		})).toBe(false);
		expect(store.isRecoveryRequired()).toBe(true);
		fake.settingTab!.show();
		const dropdown = fake.settingTab!.containerEl.querySelector<HTMLSelectElement>(".semantropy-language-setting select")!;
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		choose(dropdown, "ja");
		await store.whenSettled(); await flush();
		expect(writes).toBe(3);
		expect(dropdown.value).toBe("en");
		expect(name(a)).toBe("Reshuffle text");
		expect(fake.settingTab!.containerEl.querySelector(".semantropy-language-status")?.textContent).toBe(EN_MESSAGES.settings.languageSaveFailed);
		expect(error).toHaveBeenCalled();
		expect(await store.setUiLanguage("ja")).toBe(false);
		expect(store.isRecoveryRequired()).toBe(true);
		fake.settingTab!.hide();
	});

	it("updates a displayed Obsidian Notice in place while leaving dismissed Notices alone", async () => {
		const a = await harness();
		const { fake, set } = plugin([a], { load: async () => ({ schemaVersion: 4 }), save: async () => undefined });
		const show = Reflect.get(SemantropyPlugin.prototype, "notice") as (this: Fake, message: string) => void;
		show.call(fake, "Copied.");
		const notice = [...fake.notices.keys()][0]!;
		const messageEl = notice.messageEl;
		expect(messageEl.textContent).toBe("Copied.");
		expect(await set("ja")).toBe(true);
		expect(notice.messageEl).toBe(messageEl);
		expect(messageEl.textContent).toBe("コピーしました。");
		notice.hide();
		expect(await set("en")).toBe(true);
		expect(fake.notices.size).toBe(0);
		expect(messageEl.textContent).toBe("コピーしました。");
	});

	it("shows the last completed save when saves overlap", async () => {
		const a = await harness();
		const gates: (() => void)[] = [];
		let disk: unknown = { schemaVersion: 4 };
		const { store, set } = plugin([a], { load: async () => disk, save: data => new Promise<void>(done => gates.push(() => { disk = data; done(); })) });
		await store.load();
		const first = set("ja"), second = set("en");
		await flush();
		expect(currentUiLanguage()).toBe("en");
		gates.shift()!(); await flush();
		expect(currentUiLanguage()).toBe("ja");
		expect(name(a)).toBe("本文をシャッフル");
		await flush(); gates.shift()!();
		expect(await Promise.all([first, second])).toEqual([true, true]);
		expect(currentUiLanguage()).toBe("en");
		expect(name(a)).toBe("Reshuffle text");
		expect(disk).toMatchObject({ uiLanguage: "en" });
	});
});
