// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, type App } from "obsidian";
import { SemantropyPlugin, type SemantropyTokenizerHost } from "../src/SemantropyPlugin";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { parseAutomaticPosSettings, serializeAutomaticPosSettings, validateAutomaticPosSettingsPatch } from "../src/settings/automaticPosSettings";
import { VocabularyControls, type VocabularyControlsState } from "../src/view/VocabularyControls";
import type { VocabularySelection } from "../src/application/prepareVocabulary";
import { SemantropySettingTab } from "../src/view/SemantropySettingTab";
import { setCurrentUiLanguage } from "../src/i18n/language";
import type { UiLanguage } from "../src/i18n/language";
import { harness, peek } from "./vocabularyIntegrationHarness";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { deferred } from "./refreshHarness";

/**
 * PRE-RELEASE-EXPERIENCE-UI-POLISH1. jsdom does not apply flex layout or paint a
 * native select's focus ring, so the clip itself is measured in Chromium and
 * recorded separately. These tests pin the contract that measurement checks.
 */

const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(selector: string): string {
	return css.split("}").flatMap(block => {
		const [head = "", body] = block.split("{");
		if (!body || !head.split(",").some(part => part.trim() === selector)) return [];
		return [body];
	}).join("\n");
}

let restoreDom: () => void;
beforeAll(() => { restoreDom = installObsidianDomHelpers(); });
afterAll(() => restoreDom());
beforeEach(() => { setCurrentUiLanguage("en"); Platform.isMacOS = false; });
afterEach(() => {
	setCurrentUiLanguage("en");
	Platform.isMacOS = false;
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function selection(over: Partial<VocabularySelection> = {}): VocabularySelection {
	return { mode: "current", paths: [], drawMode: "uniform", ...over };
}

function state(over: Partial<VocabularyControlsState> & { selection?: VocabularySelection; draft?: VocabularySelection } = {}): VocabularyControlsState {
	const committed = over.selection ?? selection();
	return {
		selection: committed, draft: over.draft ?? { ...committed, paths: [...committed.paths] },
		stale: over.stale ?? false, staleSources: over.staleSources ?? [], preparing: over.preparing ?? false,
		progress: null, error: null, ready: true,
	};
}

function summaryOf(current: VocabularyControlsState): string {
	const parent = document.createElement("div");
	const summary = document.createElement("div");
	document.body.append(parent, summary);
	new VocabularyControls(parent, summary, { state: () => current, open: () => undefined });
	return summary.querySelector(".semantropy-vocabulary-status")!.textContent ?? "";
}

describe("Mac hover-modifier label", () => {
	it("shows Option（⌥） on macOS in both languages and Alt on Windows, with the stored value alt", async () => {
		const h = harness();
		await h.open("森。");
		const select = () => peek(h.view).contentEl.querySelector<HTMLSelectElement>(".semantropy-dictionary-diagnostics select")!;
		expect(Array.from(select().options).map(option => [option.value, option.textContent])).toEqual([["alt", "Alt"], ["shift", "Shift"]]);
		Platform.isMacOS = true;
		h.view.languageChanged();
		expect(select().options[0]!.textContent).toBe("Option（⌥）");
		expect(select().value).toBe("alt");
		setCurrentUiLanguage("ja");
		h.view.languageChanged();
		expect(peek(h.view).contentEl.querySelector(".semantropy-dictionary-diagnostics label")!.textContent).toContain("ホバー時の修飾キー");
		expect(select().options[0]!.textContent).toBe("Option（⌥）");
		expect(select().options[0]!.value).toBe("alt");
		expect(Array.from(select().options).map(option => option.value)).toEqual(["alt", "shift"]);
		Platform.isMacOS = false;
		h.view.languageChanged();
		expect(select().options[0]!.textContent).toBe("Alt");
		const controller = readFileSync("src/view/DictionaryPopoverController.ts", "utf8");
		expect(controller).toContain('this.host.modifier() === "alt" ? event.altKey : event.shiftKey');
		expect(controller).toContain('this.host.modifier() === "alt" ? "Alt" : "Shift"');
		await h.view.onClose();
	});
});

describe("vocabulary status summary", () => {
	it("names the committed draw mode and keeps unapplied, preparing and stale apart", () => {
		expect(summaryOf(state())).toBe("Vocabulary: Current Note · Draw mode: Uniform");
		expect(summaryOf(state())).not.toContain("active");
		expect(summaryOf(state({
			selection: selection({ mode: "selected", paths: ["B.md", "C.md"], drawMode: "frequency" }),
		}))).toBe("Vocabulary: Selected Notes (2) · Draw mode: Frequency");
		expect(summaryOf(state({
			draft: selection({ mode: "selected", paths: ["B.md"], drawMode: "frequency" }),
		}))).toBe("Vocabulary: Current Note · Draw mode: Uniform · unapplied");
		expect(summaryOf(state({
			draft: selection({ mode: "current", paths: ["leftover.md"] }),
		}))).toBe("Vocabulary: Current Note · Draw mode: Uniform");
		const selected = selection({ mode: "selected", paths: ["B.md", "C.md"], drawMode: "uniform" });
		expect(summaryOf(state({
			selection: selected, draft: selection({ mode: "selected", paths: ["C.md", "B.md"], drawMode: "uniform" }),
		}))).toBe("Vocabulary: Selected Notes (2) · Draw mode: Uniform");
		expect(summaryOf(state({
			selection: selected, draft: selection({ mode: "selected", paths: ["B.md"], drawMode: "uniform" }),
		}))).toBe("Vocabulary: Selected Notes (2) · Draw mode: Uniform · unapplied");
		expect(summaryOf(state({
			draft: selection({ mode: "selected", paths: ["B.md"], drawMode: "frequency" }), preparing: true,
		}))).toBe("Vocabulary: Current Note · Draw mode: Uniform · preparing");
		expect(summaryOf(state({
			staleSources: [{ path: "fixture.md", reason: "changed" }],
		}))).toBe("Vocabulary: Current Note · Draw mode: Uniform · stale: 1 Source");
		expect(summaryOf(state({
			draft: selection({ mode: "selected", paths: ["B.md"], drawMode: "uniform" }),
			staleSources: [{ path: "B.md", reason: "changed" }, { path: "C.md", reason: "missing" }],
		}))).toBe("Vocabulary: Current Note · Draw mode: Uniform · unapplied · stale: 2 Sources");
		expect(summaryOf(state({
			draft: selection({ mode: "selected", paths: ["B.md"], drawMode: "uniform" }), preparing: true,
			staleSources: [{ path: "fixture.md", reason: "changed" }],
		}))).toBe("Vocabulary: Current Note · Draw mode: Uniform · preparing · stale: 1 Source");
		setCurrentUiLanguage("ja");
		expect(summaryOf(state({
			selection: selection({ mode: "selected", paths: ["B.md"], drawMode: "frequency" }),
			staleSources: [{ path: "B.md", reason: "changed" }],
		}))).toBe("語彙: 選択したノート（1） · 抽選方式: 頻度 · 古い: 1件の語彙ソース");
		expect(summaryOf(state({
			draft: selection({ mode: "selected", paths: ["B.md"], drawMode: "frequency" }),
		}))).toBe("語彙: 現在のノート · 抽選方式: 均等 · 未適用");
		expect(summaryOf(state({ preparing: true }))).toBe("語彙: 現在のノート · 抽選方式: 均等 · 準備中");
	});

	it("shows the view's committed summary while a draft is unapplied, and preparing without calling it unapplied", async () => {
		const h = harness();
		await h.open("森。");
		const line = () => peek(h.view).contentEl.querySelector(".semantropy-vocabulary-status")!.textContent;
		expect(line()).toBe("Vocabulary: Current Note · Draw mode: Uniform");
		h.view.setVocabularyDraft({ mode: "selected", paths: ["B.md", "C.md"], drawMode: "frequency" });
		expect(line()).toBe("Vocabulary: Current Note · Draw mode: Uniform · unapplied");
		expect(h.view.getVocabularyState().selection).toMatchObject({ mode: "current", drawMode: "uniform" });
		h.view.cancelVocabulary();
		expect(line()).toBe("Vocabulary: Current Note · Draw mode: Uniform");
		const gate = deferred<void>();
		h.control.tokenGate = gate.promise;
		const pending = h.view.applyVocabulary();
		await vi.waitFor(() => expect(line()).toContain("preparing"));
		expect(line()).toBe("Vocabulary: Current Note · Draw mode: Uniform · preparing");
		gate.resolve();
		await pending;
		h.view.notifyVocabularySourceEvent("fixture.md", "changed");
		expect(line()).toBe("Vocabulary: Current Note · Draw mode: Uniform · stale: 1 Source");
		setCurrentUiLanguage("ja");
		h.view.languageChanged();
		expect(line()).toBe("語彙: 現在のノート · 抽選方式: 均等 · 古い: 1件の語彙ソース");
		await h.view.onClose();
	});
});

describe("select focus in the vocabulary and collision dialogs", () => {
	it("keeps a local block margin and a visible focus outline without changing dialog size or scroll", async () => {
		expect(declarations(".semantropy-vocabulary-modal select")).toMatch(/margin-block:\s*4px;/);
		expect(declarations(".semantropy-vocabulary-modal select")).toMatch(/scroll-margin-block:\s*4px;/);
		expect(declarations(".semantropy-collision-modal select")).toMatch(/margin-block:\s*4px;/);
		expect(declarations(".semantropy-collision-controls label")).toMatch(/align-items:\s*center;/);
		expect(declarations(".semantropy-vocabulary-modal select:focus-visible")).toMatch(/outline:\s*2px solid/);
		expect(declarations(".semantropy-collision-modal select:focus-visible")).toMatch(/outline-offset:\s*1px;/);
		expect(declarations(".semantropy-vocabulary-modal")).toMatch(/width:\s*min\(34rem,\s*95vw\);/);
		expect(declarations(".semantropy-vocabulary-modal")).toMatch(/max-height:\s*90vh;/);
		expect(declarations(".semantropy-collision-modal")).toMatch(/width:\s*min\(38rem,\s*95vw\);/);
		expect(declarations(".semantropy-collision-modal")).toMatch(/max-height:\s*90vh;/);
		expect(declarations(".semantropy-vocabulary-modal .modal-content")).toMatch(/overflow:\s*auto;/);
		expect(declarations(".semantropy-collision-modal .modal-content")).toMatch(/overflow:\s*auto;/);
		expect(declarations(".semantropy-vocabulary-actions")).toMatch(/flex:\s*0 0 auto;/);
		expect(declarations(".semantropy-vocabulary-selected")).toMatch(/max-height:\s*22vh;/);

		const h = harness();
		await h.open("森。");
		h.view.openVocabularyPicker();
		const vocabulary = document.querySelector<HTMLElement>(".semantropy-vocabulary-modal")!;
		const vocabularySelect = vocabulary.querySelector("select")!;
		vocabularySelect.focus();
		expect(document.activeElement).toBe(vocabularySelect);
		const apply = Array.from(vocabulary.querySelectorAll("button")).find(button => button.textContent === "Apply Vocabulary")!;
		const cancel = Array.from(vocabulary.querySelectorAll("button")).find(button => button.textContent === "Cancel")!;
		expect(apply.hidden).toBe(false);
		expect(cancel.hidden).toBe(false);
		apply.focus();
		expect(document.activeElement).toBe(apply);
		cancel.focus();
		expect(document.activeElement).toBe(cancel);

		h.view.openCollision();
		const collision = document.querySelector<HTMLElement>(".semantropy-collision-modal")!;
		const collisionSelect = collision.querySelector("select")!;
		collisionSelect.focus();
		expect(document.activeElement).toBe(collisionSelect);
		const generate = Array.from(collision.querySelectorAll("button")).find(button => button.textContent === "Generate")!;
		generate.focus();
		expect(document.activeElement).toBe(generate);
		expect(generate.hidden).toBe(false);
		h.view.closeCollision();
		h.view.closeVocabularyPicker();
		await h.view.onClose();
	});
});

describe("settings schema 6 showRibbonIcon", () => {
	const kept = { bodySemantropy: 40, dictionarySemantropy: 75, collectionPath: "Kept.md", uiLanguage: "en" as const };

	it("reads schema 1–5 as on, keeps a schema 6 boolean, and repairs only a bad schema 6 value", () => {
		for (const schemaVersion of [1, 2, 3, 4, 5]) {
			const parsed = parseAutomaticPosSettings({
				schemaVersion, bodySemantropy: 40, dictionarySemantropy: 75, collectionPath: "Kept.md",
				uiLanguage: "ja", showRibbonIcon: false,
			});
			expect(parsed.showRibbonIcon, `schema ${schemaVersion}`).toBe(true);
			expect(parsed.bodySemantropy).toBe(40);
			expect(parsed.dictionarySemantropy).toBe(75);
			expect(parsed.uiLanguage).toBe(schemaVersion >= 5 ? "ja" : "en");
			// Schema 1 never stored a collection path, so a stray one is not adopted.
			expect(parsed.collectionPath).toBe(schemaVersion === 1 ? "Semantropy Fragments.md" : "Kept.md");
		}
		expect(parseAutomaticPosSettings({ schemaVersion: 4, ...kept }).uiLanguage).toBe("en");
		expect(parseAutomaticPosSettings({ schemaVersion: 5, ...kept, uiLanguage: "ja", showRibbonIcon: false })).toMatchObject({
			uiLanguage: "ja", showRibbonIcon: true, bodySemantropy: 40, collectionPath: "Kept.md",
		});
		const off = parseAutomaticPosSettings({ schemaVersion: 6, ...kept, showRibbonIcon: false });
		expect(off.showRibbonIcon).toBe(false);
		expect(serializeAutomaticPosSettings(off)).toMatchObject({ schemaVersion: 7, showRibbonIcon: false, uiLanguage: "en", bodySemantropy: 40, collectionPath: "Kept.md" });
		for (const showRibbonIcon of ["option", "false", 0, 1, null, undefined]) {
			const parsed = parseAutomaticPosSettings({ schemaVersion: 6, ...kept, showRibbonIcon });
			expect(parsed.showRibbonIcon).toBe(true);
			expect(parsed.uiLanguage).toBe("en");
			expect(parsed.bodySemantropy).toBe(40);
			expect(parsed.collectionPath).toBe("Kept.md");
		}
		expect(parseAutomaticPosSettings({ schemaVersion: 6, ...kept, uiLanguage: "nope", showRibbonIcon: false })).toMatchObject({
			uiLanguage: "ja", showRibbonIcon: false, bodySemantropy: 40,
		});
		const reads: string[] = [];
		const raw = Object.defineProperty({ schemaVersion: 6, ...kept }, "showRibbonIcon", {
			get: () => { reads.push("get"); return false; }, enumerable: true,
		});
		expect(parseAutomaticPosSettings(raw).showRibbonIcon).toBe(true);
		expect(reads).toEqual([]);
		expect(validateAutomaticPosSettingsPatch({ showRibbonIcon: false })).toEqual({ showRibbonIcon: false });
		expect(validateAutomaticPosSettingsPatch({ showRibbonIcon: "option" })).toBeNull();
		expect(parseAutomaticPosSettings(null).showRibbonIcon).toBe(true);
	});
});

class RibbonProbePlugin extends SemantropyPlugin {
	protected createTokenizer(): SemantropyTokenizerHost {
		throw new Error("The ribbon tests do not tokenize.");
	}
}

function boot(initial: unknown, save?: (data: unknown) => Promise<void>) {
	const commands = new Map<string, () => void>();
	const tabs: SemantropySettingTab[] = [];
	let disk = initial;
	const app = {
		vault: { on: () => ({}), getAbstractFileByPath: () => null, getMarkdownFiles: () => [], cachedRead: async () => "" },
		workspace: { on: () => ({}), getLeavesOfType: () => [], getLeaf: () => null, getActiveViewOfType: () => null, setActiveLeaf: () => undefined },
	};
	const plugin = new RibbonProbePlugin(app as unknown as App, { id: "semantropy", dir: "plugins/semantropy" } as never);
	Object.assign(plugin, {
		registerView: () => undefined,
		addCommand: (command: { id: string; callback: () => void }) => { commands.set(command.id, command.callback); return command; },
		addSettingTab: (tab: SemantropySettingTab) => { tabs.push(tab); },
		registerEvent: () => undefined,
		loadData: async () => disk,
		saveData: async (data: unknown) => { if (save) await save(data); else disk = data; },
	});
	const store = () => (plugin as unknown as { settingsStore: AutomaticPosSettingsStore }).settingsStore;
	return { plugin, commands, tabs, store, disk: () => disk };
}

describe("ribbon icon", () => {
	it("shows one brain-circuit icon, removes it when off, and still opens from the command", async () => {
		const { plugin, commands, tabs, store } = boot(null);
		await plugin.onload();
		const icons = () => document.querySelectorAll<HTMLButtonElement>(".semantropy-ribbon");
		expect(icons()).toHaveLength(1);
		expect(icons()[0]!.dataset.icon).toBe("brain-circuit");
		expect(icons()[0]!.getAttribute("aria-label")).toBe("Semantropyを開く");
		expect(store().getShowRibbonIcon()).toBe(true);
		expect([...commands.keys()]).toContain("open");

		let opens = 0;
		(plugin as unknown as { openSemantropy: () => Promise<void> }).openSemantropy = async () => { opens += 1; };
		icons()[0]!.click();
		await Promise.resolve();
		expect(opens).toBe(1);

		const tab = tabs[0]!;
		tab.show();
		expect(await tab.changeShowRibbonIcon(false)).toBe(true);
		expect(icons()).toHaveLength(0);
		expect(store().getShowRibbonIcon()).toBe(false);
		commands.get("open")!();
		await Promise.resolve();
		expect(opens).toBe(2);

		expect(await tab.changeShowRibbonIcon(true)).toBe(true);
		expect(await tab.changeShowRibbonIcon(false)).toBe(true);
		expect(await tab.changeShowRibbonIcon(true)).toBe(true);
		expect(icons()).toHaveLength(1);
		icons()[0]!.click();
		await Promise.resolve();
		expect(opens).toBe(3);

		const setUiLanguage = Reflect.get(SemantropyPlugin.prototype, "setUiLanguage") as (this: RibbonProbePlugin, value: UiLanguage) => Promise<boolean>;
		expect(await setUiLanguage.call(plugin, "en")).toBe(true);
		expect(icons()[0]!.getAttribute("aria-label")).toBe("Open Semantropy");
		expect(await setUiLanguage.call(plugin, "ja")).toBe(true);
		expect(icons()[0]!.getAttribute("aria-label")).toBe("Semantropyを開く");
		expect(icons()).toHaveLength(1);

		const shown = icons()[0]!;
		plugin.unload();
		expect(shown.isConnected).toBe(false);
		expect(document.querySelector(".semantropy-ribbon")).toBeNull();
		shown.focus();
		expect(document.activeElement).not.toBe(shown);

		await plugin.onload();
		expect(document.querySelectorAll(".semantropy-ribbon")).toHaveLength(1);
		expect(commands.has("open")).toBe(true);
		plugin.unload();
	});

	it("keeps one Obsidian registration through a language change and off then on", async () => {
		const { plugin, tabs } = boot(null);
		await plugin.onload();
		const registered = () => (plugin as unknown as { ribbonRegistrations: { title: string; el: HTMLElement }[] }).ribbonRegistrations;
		expect(registered()).toHaveLength(1);
		expect(registered()[0]!.title).toBe("Semantropyを開く");

		const setUiLanguage = Reflect.get(SemantropyPlugin.prototype, "setUiLanguage") as (this: RibbonProbePlugin, value: UiLanguage) => Promise<boolean>;
		expect(await setUiLanguage.call(plugin, "en")).toBe(true);
		expect(registered()).toHaveLength(1);
		expect(registered().map(item => item.title)).toEqual(["Semantropyを開く"]);
		expect(document.querySelector(".semantropy-ribbon")!.getAttribute("aria-label")).toBe("Open Semantropy");

		const tab = tabs[0]!;
		tab.show();
		expect(await tab.changeShowRibbonIcon(false)).toBe(true);
		expect(document.querySelector(".semantropy-ribbon")).toBeNull();
		expect(registered()).toHaveLength(1);
		const held = registered()[0]!.el;
		expect(held.isConnected).toBe(false);
		held.focus();
		expect(document.activeElement).not.toBe(held);

		expect(await tab.changeShowRibbonIcon(true)).toBe(true);
		expect(document.querySelectorAll(".semantropy-ribbon")).toHaveLength(1);
		expect(document.querySelector(".semantropy-ribbon")).toBe(held);
		expect(held.getAttribute("aria-label")).toBe("Open Semantropy");
		expect(registered()).toHaveLength(1);
		let opens = 0;
		(plugin as unknown as { openSemantropy: () => Promise<void> }).openSemantropy = async () => { opens += 1; };
		held.click();
		await Promise.resolve();
		expect(opens).toBe(1);
		plugin.unload();
		expect(registered()).toHaveLength(0);
		expect(held.isConnected).toBe(false);
		expect(document.querySelector(".semantropy-ribbon")).toBeNull();
	});

	it("loads schema 1–5 as on, keeps schema 6 off across a restart, and reverts a failed save", async () => {
		const schema5 = boot({ schemaVersion: 5, uiLanguage: "en", bodySemantropy: 40, collectionPath: "Kept.md", showRibbonIcon: false });
		await schema5.plugin.onload();
		expect(schema5.store().getShowRibbonIcon()).toBe(true);
		expect(schema5.store().getUiLanguage()).toBe("en");
		expect(schema5.store().getBodySemantropy()).toBe(40);
		expect(document.querySelector(".semantropy-ribbon")).not.toBeNull();
		schema5.plugin.unload();

		const off = boot({ schemaVersion: 6, uiLanguage: "ja", bodySemantropy: 40, collectionPath: "Kept.md", showRibbonIcon: false });
		await off.plugin.onload();
		expect(document.querySelector(".semantropy-ribbon")).toBeNull();
		expect(off.store().getShowRibbonIcon()).toBe(false);
		off.plugin.unload();
		await off.plugin.onload();
		expect(off.store().getShowRibbonIcon()).toBe(false);
		expect(document.querySelector(".semantropy-ribbon")).toBeNull();
		expect(off.commands.has("open")).toBe(true);
		off.plugin.unload();

		let writes = 0;
		let disk: unknown = { schemaVersion: 6, uiLanguage: "ja", showRibbonIcon: true, bodySemantropy: 40, collectionPath: "Kept.md" };
		const failed = boot(disk, async data => {
			writes += 1;
			if (writes === 1) throw new Error("disk full");
			disk = data;
		});
		await failed.plugin.onload();
		const tab = failed.tabs[0]!;
		tab.show();
		const before = document.querySelector(".semantropy-ribbon");
		expect(before).not.toBeNull();
		expect(await tab.changeShowRibbonIcon(false)).toBe(false);
		expect(failed.store().getShowRibbonIcon()).toBe(true);
		expect(document.querySelector(".semantropy-ribbon")).toBe(before);
		expect(tab.containerEl.querySelector(".semantropy-ribbon-setting [role='switch']")?.getAttribute("aria-checked")).toBe("true");
		expect(tab.containerEl.querySelector(".semantropy-ribbon-status")?.textContent).toBe("リボンアイコンの設定を保存できませんでした。以前の設定のままです。");
		expect(disk).toMatchObject({ showRibbonIcon: true, bodySemantropy: 40, collectionPath: "Kept.md" });
		failed.plugin.unload();
	});
});
