// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { deferred } from "./refreshHarness";
import { token } from "./tokenFixtures";
import { EN_MESSAGES, setUiOverrides, ui } from "../src/i18n/catalog";
import { localize, setMessageOverrides } from "../src/i18n/messages";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { ANALYZE_ERROR_MESSAGE } from "../src/application/analyzeNoteTexts";
import type { JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => {
	document.body.replaceChildren();
	setUiOverrides({});
	setMessageOverrides({});
	setCurrentUiLanguage("en");
});

const LEXICON = [token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "森" }), token({ surface: "と", pos: "助詞", detail1: "並立助詞" })];

/** A tokenizer that can be held at the next call, so a Target stays "being prepared". */
function gatedTokenizer() {
	const base = lexiconTokenizer(LEXICON);
	const control = { gate: null as Promise<void> | null };
	const tokenizer: JapaneseTokenizer = { tokenize: async (text) => { if (control.gate) await control.gate; return base.tokenize(text); } };
	return { tokenizer, control };
}

const busyOf = (h: ReturnType<typeof manualMorphHarness>) => h.peek.contentEl.querySelector<HTMLElement>(".semantropy-busy");

describe("0.1.0 S1 centred working card", () => {
	it("covers the body while the Target is opened and disappears once it is shown", async () => {
		const { tokenizer, control } = gatedTokenizer();
		const h = manualMorphHarness(tokenizer);
		const hold = deferred<void>();
		control.gate = hold.promise;
		const opening = h.open("猫と犬と森。\n");
		for (let i = 0; i < 20 && (busyOf(h)?.hidden ?? true); i += 1) await new Promise((r) => setTimeout(r, 0));
		const busy = busyOf(h)!;
		expect(busy.hidden).toBe(false);
		expect(busy.getAttribute("aria-hidden")).toBe("true");
		expect(busy.textContent).not.toBe("");
		control.gate = null;
		hold.resolve();
		await opening;
		expect(busyOf(h)!.hidden).toBe(true);
	});

	it("shows Reshuffle's own message while a reshuffle is prepared", async () => {
		const { tokenizer } = gatedTokenizer();
		const h = manualMorphHarness(tokenizer);
		// Level 0 turns transformation off, and Reshuffle is then unavailable.
		h.state.level = assertBodySemantropy(50);
		await h.open("猫と犬と森。\n");
		const busy = busyOf(h)!;
		const shown: string[] = [];
		// The test scheduler finishes within one task, so the card is seen through its records.
		const observer = new MutationObserver((records) => {
			for (const record of records) if (record.attributeName === "hidden" && record.oldValue !== null) shown.push("shown");
		});
		observer.observe(busy, { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
		expect(await h.view.reshuffle({ issueSeed: () => 9 })).toBe("applied");
		await new Promise((r) => setTimeout(r, 0));
		observer.disconnect();
		expect(shown.length).toBeGreaterThan(0);
		expect(busy.textContent).toContain("Reshuffling");
		expect(busy.hidden).toBe(true);
	});
});

describe("0.1.0 S1 review: the work card's layer", () => {
	it("sits above the body and below the Toolbar popups", () => {
		const css = readFileSync("styles.css", "utf8");
		const layer = (selector: string) => {
			const start = css.indexOf(`\n${selector} {`);
			return Number(/z-index: (\d+);/.exec(css.slice(start, css.indexOf("}", start)))?.[1]);
		};
		expect(layer(".semantropy-busy")).toBe(1);
		expect(layer(".semantropy-toolbar-popup")).toBeGreaterThan(layer(".semantropy-busy"));
	});
});

describe("0.1.0 S1 toolbar popups fit the View", () => {
	it("caps an open popup at the space left above the bottom of the View", async () => {
		const { tokenizer } = gatedTokenizer();
		const h = manualMorphHarness(tokenizer);
		await h.open("猫と犬と森。\n");
		const root = h.peek.contentEl.querySelector<HTMLElement>(".semantropy-root")!;
		root.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) });
		const display = Array.from(root.querySelectorAll<HTMLButtonElement>(".semantropy-toolbar button")).find((b) => b.getAttribute("aria-label") === "Display settings")!;
		const panel = document.getElementById(display.getAttribute("aria-controls")!)!;
		panel.getBoundingClientRect = () => ({ top: 300, bottom: 700, height: 400, left: 0, right: 200, width: 200, x: 0, y: 300, toJSON: () => ({}) });
		display.click();
		expect(panel.hidden).toBe(false);
		// 0.1.0 owner report: no fixed 28rem cap, so a tall screen shows the whole popup.
		expect(panel.style.maxHeight).toBe("192px");
	});

	it("scrolls a popup opened inside More into More's visible area, never past its start", async () => {
		const { tokenizer } = gatedTokenizer();
		const h = manualMorphHarness(tokenizer);
		await h.open("猫と犬と森。\n");
		const toolbar = Reflect.get(h.view, "toolbar") as object;
		const more = Reflect.get(toolbar, "morePanel") as HTMLElement;
		const inner = document.createElement("div");
		let scrollTop = 0;
		Object.defineProperty(more, "scrollTop", { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
		const rect = (top: number, bottom: number) => () => ({ top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) });
		const reveal = (Reflect.get(toolbar, "revealInMore") as (panel: HTMLElement) => void).bind(toolbar);
		more.getBoundingClientRect = rect(100, 500);
		inner.getBoundingClientRect = rect(400, 900);
		reveal(inner);
		// Just enough to show the end would be 404; the start stops it at 296.
		expect(scrollTop).toBe(296);
		inner.getBoundingClientRect = rect(150, 450);
		reveal(inner);
		expect(scrollTop).toBe(296);
	});
});

describe("0.1.0 S1 host wording", () => {
	it("lets a host replace a few Japanese entries and messages, and nothing else", () => {
		setCurrentUiLanguage("ja");
		const before = ui();
		setUiOverrides({ ja: { status: { source: (name: string) => `対象の文章: ${name}` }, vocabulary: { currentNote: "対象の文章" } } });
		expect(ui().status.source("夢")).toBe("対象の文章: 夢");
		expect(ui().vocabulary.currentNote).toBe("対象の文章");
		// Untouched entries, including siblings of a replaced one, stay the catalog's own.
		expect(ui().vocabulary.selectedNotes).toBe(before.vocabulary.selectedNotes);
		expect(ui().status.onboarding).toBe(before.status.onboarding);
		expect(Object.isFrozen(ui().status)).toBe(true);
		setMessageOverrides({ [ANALYZE_ERROR_MESSAGE]: "文章を解析できませんでした。" });
		expect(localize(ANALYZE_ERROR_MESSAGE)).toBe("文章を解析できませんでした。");
		setUiOverrides({});
		setMessageOverrides({});
		expect(ui()).toBe(before);
		expect(localize(ANALYZE_ERROR_MESSAGE)).not.toBe("文章を解析できませんでした。");
	});

	it("never changes English or the English message identities", () => {
		setUiOverrides({ ja: { vocabulary: { currentNote: "対象の文章" } } });
		setCurrentUiLanguage("en");
		expect(ui().vocabulary.currentNote).toBe(EN_MESSAGES.vocabulary.currentNote);
		expect(localize(ANALYZE_ERROR_MESSAGE)).toBe(ANALYZE_ERROR_MESSAGE);
	});
});
