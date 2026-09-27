// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, peekMorph } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { TOOLBAR_CONTROLS, type SemantropyToolbar } from "../src/view/SemantropyToolbar";
import type { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import { setCurrentUiLanguage } from "../src/i18n/language";

/*
 * PRE-RELEASE-EXPERIENCE-TOOLBAR-FINISH1: Generation settings moves to the right,
 * beside Settings, and four Obsidian icons change. The same controls move into
 * More. Fake Dictionary's definition reshuffle keeps its own icon.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
const live: ReturnType<typeof manualMorphHarness>[] = [];
afterEach(async () => {
	for (const h of live.splice(0)) await h.view.onClose();
	setCurrentUiLanguage("en");
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

const lexicon = () => lexiconTokenizer([
	token({ surface: "猫", baseForm: "猫", reading: "ネコ" }),
	token({ surface: "犬", baseForm: "犬", reading: "イヌ" }),
]);
async function harness() {
	const h = manualMorphHarness(lexicon(), 5000);
	live.push(h);
	await h.open("猫犬。");
	return h;
}
const shell = (h: Awaited<ReturnType<typeof harness>>) => peekMorph(h.view).contentEl;
const toolbarOf = (h: Awaited<ReturnType<typeof harness>>) => Reflect.get(h.view, "toolbar") as SemantropyToolbar;

describe("PRE-RELEASE-EXPERIENCE-TOOLBAR-FINISH1", () => {
	it("pins the view tab and the three toolbar icons, and does not retitle the definition reshuffle", async () => {
		const h = await harness();
		expect(h.view.getIcon()).toBe("brain-circuit");
		expect(TOOLBAR_CONTROLS.reshuffle.icon).toBe("dices");
		expect(TOOLBAR_CONTROLS.collision.icon).toBe("blend");
		expect(TOOLBAR_CONTROLS.fakeProverb.icon).toBe("graduation-cap");
		const bar = shell(h).querySelector<HTMLElement>(".semantropy-toolbar")!;
		expect(bar.querySelector(".semantropy-reshuffle .semantropy-icon svg")?.getAttribute("class")).toBe("svg-icon lucide-dices");
		expect(bar.querySelector(".semantropy-collision-open .semantropy-icon svg")?.getAttribute("class")).toBe("svg-icon lucide-blend");
		expect(bar.querySelector(".semantropy-fake-proverb-open .semantropy-icon svg")?.getAttribute("class")).toBe("svg-icon lucide-graduation-cap");
		expect(bar.querySelectorAll("[title]")).toHaveLength(0);
		expect(bar.querySelector(".semantropy-reshuffle")?.getAttribute("aria-label")).toBe("Reshuffle text");
		const el = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(item => h.controller().getSlotForElement(item) === h.current("猫"))!;
		el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, altKey: true }));
		await new Promise<void>(resolve => window.setTimeout(resolve, 145));
		const panel = document.querySelector<HTMLElement>(".semantropy-dictionary-popover")!;
		expect((Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController).isOpen()).toBe(true);
		expect(panel.querySelector(".semantropy-reshuffle-definition .semantropy-icon svg")?.getAttribute("class")).toBe("svg-icon lucide-shuffle");
		expect(panel.querySelector(".semantropy-reshuffle-definition")?.hasAttribute("title")).toBe(false);
	});

	it("places Generation settings beside Settings, and keeps that end when the group is in More", async () => {
		const h = await harness();
		const bar = shell(h).querySelector<HTMLElement>(".semantropy-toolbar")!;
		expect(Array.from(bar.querySelectorAll(":scope > .semantropy-toolbar-group")).map(group => Array.from(group.classList).find(name => name.startsWith("is-"))))
			.toEqual(["is-primary", "is-vocabulary", "is-generation", "is-text", "is-settings"]);
		const css = readFileSync("styles.css", "utf8");
		const block = (selector: string) => {
			const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
		};
		expect(block(".semantropy-toolbar-group.is-text")).toMatch(/margin-left:\s*auto/);
		expect(css).not.toMatch(/\.semantropy-toolbar-group\.is-settings\s*\{[^}]*margin-left:\s*auto/u);
		expect(css).toMatch(/\.semantropy-toolbar-group\.is-text\[hidden\] \+ \.semantropy-toolbar-group\.is-settings,\s*\.semantropy-toolbar-group\.is-text\[hidden\] \+ \.semantropy-toolbar-group\.is-settings\[hidden\] \+ \.semantropy-toolbar-more \{\s*margin-left:\s*auto;/u);
		const text = bar.querySelector<HTMLElement>(".is-text")!;
		const settings = bar.querySelector<HTMLElement>(".is-settings")!;
		const level = bar.querySelector<HTMLButtonElement>(".semantropy-level-button")!;
		const automatic = bar.querySelector<HTMLButtonElement>(".semantropy-automatic-pos-toolbar > button")!;
		const display = bar.querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!;
		Object.defineProperty(bar, "clientWidth", { configurable: true, get: () => 160 });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const width = this.classList.contains("semantropy-toolbar-item") || this.classList.contains("semantropy-toolbar-more") ? 32 : 0;
			return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 32, width, height: 32, toJSON: () => ({}) };
		});
		toolbarOf(h).refreshLayout();
		expect(text.hidden).toBe(true);
		expect(level.parentElement?.closest(".semantropy-more-menu")).not.toBeNull();
		expect(automatic.parentElement?.closest(".semantropy-more-menu")).not.toBeNull();
		expect(bar.querySelectorAll(".semantropy-level-button")).toHaveLength(1);
		expect(bar.querySelectorAll(".semantropy-display-menu-button")).toHaveLength(1);
		const headings = Array.from(bar.querySelectorAll(".semantropy-more-heading")).filter(heading => !(heading.parentElement as HTMLElement).hidden).map(heading => heading.textContent);
		expect(headings.indexOf("Generation settings")).toBeLessThan(headings.indexOf("Settings"));
		expect(display.closest(".semantropy-more-section")?.querySelector(".semantropy-more-heading")?.textContent).toBe("Settings");
		Object.defineProperty(bar, "clientWidth", { configurable: true, get: () => 2000 });
		const moreButton = bar.querySelector<HTMLButtonElement>(".semantropy-more-button")!;
		if (!bar.querySelector<HTMLElement>(".semantropy-more-menu")!.hidden) moreButton.click();
		toolbarOf(h).refreshLayout();
		expect(text.hidden).toBe(false);
		expect(level.closest(".semantropy-toolbar-group.is-text")).toBe(text);
		expect(settings.hidden).toBe(false);
	});

	it("keeps an open More menu's focus, draft and enabled state across a language change", async () => {
		const h = await harness();
		const bar = shell(h).querySelector<HTMLElement>(".semantropy-toolbar")!;
		Object.defineProperty(bar, "clientWidth", { configurable: true, get: () => 180 });
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const width = this.classList.contains("semantropy-toolbar-item") || this.classList.contains("semantropy-toolbar-more") ? 32 : 0;
			return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 32, width, height: 32, toJSON: () => ({}) };
		});
		toolbarOf(h).refreshLayout();
		expect(bar.querySelector<HTMLElement>(".semantropy-toolbar-more")!.hidden).toBe(false);
		const moreButton = bar.querySelector<HTMLButtonElement>(".semantropy-more-button")!;
		moreButton.click();
		const display = bar.querySelector<HTMLButtonElement>(".semantropy-display-menu-button")!;
		display.click();
		const menu = bar.querySelector<HTMLElement>(".semantropy-display-menu")!;
		const color = menu.querySelector<HTMLSelectElement>(".semantropy-color-bodyBackground")!;
		color.value = "custom";
		color.dispatchEvent(new Event("change", { bubbles: true }));
		const field = menu.querySelector<HTMLInputElement>(".semantropy-color-input-bodyBackground")!;
		field.value = "#12";
		field.focus();
		menu.scrollTop = 18;
		const enabled = Array.from(bar.querySelectorAll<HTMLButtonElement>("button")).map(button => [button, button.disabled] as const);
		setCurrentUiLanguage("ja");
		h.view.languageChanged();
		expect(document.activeElement).toBe(field);
		expect(field.value).toBe("#12");
		expect(menu.scrollTop).toBe(18);
		expect(menu.hidden).toBe(false);
		expect(bar.querySelector<HTMLElement>(".semantropy-more-menu")!.hidden).toBe(false);
		for (const [button, disabled] of enabled) expect(button.disabled).toBe(disabled);
		expect(bar.querySelector(".semantropy-reshuffle")?.getAttribute("aria-label")).toBe("本文をシャッフル");
		expect(bar.querySelectorAll("[title]")).toHaveLength(0);
	});
});
