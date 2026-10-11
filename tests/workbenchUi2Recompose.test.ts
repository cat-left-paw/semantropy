// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { sha256Hex } from "../src/vocabulary/sha256";
import { readCollectFragmentInputV4, type RecomposeFragmentInputV5 } from "../src/collect/v4/CollectedFragmentV4";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { ui } from "../src/i18n/catalog";
import { collectVocabularyFromSnapshot } from "../src/application/collectVocabulary";
import type { RecomposePane } from "../src/view/RecomposePane";
import type { RecomposeSession } from "../src/view/RecomposeSession";

/**
 * WORKBENCH-UI2 stage 3 (`Docs/release_0_2_0_plan.md` §3.3): on a host with the
 * body tabs, Recompose is the Recompose pane — `RecomposePane` over one
 * `RecomposeSession` for the View's lifetime. The checks of the S5 dialog are
 * made here against the pane (the dialog itself is gone since WORKBENCH-UI4; its
 * file, `tests/release010S5.test.ts`, keeps the Collect metadata 5 and corpus
 * checks), and the contract that changed is pinned: the output stays until the
 * View closes, with a note when the Target or the Vocabulary changed.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const LEXICON = [
	...["猫", "犬", "森", "川", "空", "猫又"].map((surface) => token({ surface })),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "と", pos: "助詞", detail1: "並立助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "た", pos: "助動詞", detail1: "*" }),
];
const SOURCE = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。";

type Harness = ReturnType<typeof manualMorphHarness>;
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
async function tabbed(open = true): Promise<Harness> {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON));
	h.host.workbenchTabs = true;
	opened.push(h);
	if (open) { await h.open("猫と犬。\n"); expect(await h.apply([SOURCE])).toBe("applied"); }
	return h;
}
const screen = (h: Harness) => Reflect.get(h.view, "recomposeScreen") as RecomposePane | null;
const session = (h: Harness) => Reflect.get(h.view, "recomposeSession") as RecomposeSession | null;
const pane = (h: Harness) => h.peek.contentEl.querySelector<HTMLElement>(".semantropy-recompose-pane")!;
const tab = (h: Harness, name: "shuffle" | "recompose") => h.peek.contentEl.querySelector<HTMLButtonElement>(`.semantropy-tab-${name}`)!;
const button = (h: Harness, name: string) =>
	Array.from(pane(h).querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === name)!;
const units = (h: Harness) => Array.from(pane(h).querySelectorAll<HTMLElement>(".semantropy-recompose-unit"));
const paragraphs = (h: Harness) => Array.from(pane(h).querySelectorAll(".semantropy-recompose-output p:not(.semantropy-recompose-hint)"), (p) => p.textContent);
const statusText = (h: Harness) => pane(h).querySelector(".semantropy-recompose-status")!.textContent;
const note = (h: Harness) => pane(h).querySelector<HTMLElement>(".semantropy-recompose-note")!;
const output = (h: Harness) => pane(h).querySelector<HTMLElement>(".semantropy-recompose-output")!;
const key = (h: Harness, name: string) => output(h).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const refresh = (h: Harness) => h.view.refreshSource({ issueSeed: () => 7, hashText: async value => sha256Hex(value) });
/**
 * An Open into a View that is not ready: a fresh shell, in the same View lifetime (no `onOpen`). WORKBENCH-UI5: an Open
 * of a note into a ready View keeps its shell and an Open with no note leaves it alone, so the View is put in the state
 * such an Open finds when another Open is still reading (the session loading), and the next Open rebuilds the shell.
 */
async function openFresh(h: Harness, text: string) {
	h.leaveReady();
	expect(h.peek.session.getState().status).not.toBe("ready");
	h.state.text = text;
	await h.view.openCapture({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: text } },
		{ readCached: async () => text, hashText: async value => sha256Hex(value), issueSeed: () => 7 });
	expect(h.peek.session.getState().status).toBe("ready");
}
/** Holds the next paint only, so other work runs through while one Recompose step waits. */
function holdNextPaint(h: Harness): () => void {
	const base = h.host.scheduler!;
	let release: () => void = () => undefined, armed = true;
	h.host.scheduler = { ...base, paint: () => {
		if (!armed) return base.paint();
		armed = false; return new Promise<void>(resolve => { release = resolve; });
	} };
	return () => release();
}
async function reopen(h: Harness, sourcePath: string, text: string) {
	h.notes.set(sourcePath, text);
	await h.view.openCapture({ kind: "markdown", note: { sourcePath, sourceName: sourcePath.replace(/\.md$/u, ""), editorText: text } },
		{ readCached: async () => text, hashText: async value => sha256Hex(value), issueSeed: () => 7 });
}

describe("WORKBENCH-UI2 stage 3: the Recompose tab shows the pane", () => {
	it("shows the Recompose tab by its tab (no Toolbar control, and no dialog); a key on the tab row focuses the tab it selects", async () => {
		const h = await tabbed();
		expect(pane(h).hidden).toBe(true);
		// WORKBENCH-UI5: the Toolbar has no Recompose control, in the row or in More: the tab is the one entry.
		expect(h.peek.contentEl.querySelector(".semantropy-toolbar .semantropy-recompose-open")).toBeNull();
		tab(h, "recompose").click();
		expect(document.querySelector(".semantropy-recompose-modal")).toBeNull();
		expect(pane(h).hidden).toBe(false);
		expect(tab(h, "recompose").getAttribute("aria-selected")).toBe("true");
		tab(h, "shuffle").click();
		tab(h, "shuffle").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
		expect([pane(h).hidden, document.activeElement]).toEqual([false, tab(h, "recompose")]);
	});
	it("builds the dialog's screen into the pane: the same parts, names and classes, without the dialog (WORKBENCH-UI5: and no sentence about the Toolbar's Copy and Collect, which are no longer there)", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		expect(Array.from(pane(h).children, child => child.className)).toEqual(["semantropy-recompose-intro", "semantropy-recompose-controls",
			"semantropy-recompose-hint", "semantropy-recompose-actions", "semantropy-recompose-unusable", "semantropy-recompose-status", "semantropy-recompose-note",
			"semantropy-recompose-output", "semantropy-recompose-actions"]);
		expect(Array.from(pane(h).querySelectorAll("button"), item => item.getAttribute("aria-label"))).toEqual(
			[ui().recompose.generate, "Continue", "Branch from the chosen place", "Copy", "Collect", "Clear"]);
		expect(h.peek.contentEl.querySelector(".semantropy-recompose-modal")).toBeNull();
		expect(pane(h).querySelector(".semantropy-recompose-empty")!.textContent).toBe(ui().recompose.empty);
	});
	it("with no note open the pane is there as well (WORKBENCH-UI4), and its tab shows it", async () => {
		const h = await tabbed(false);
		await h.view.onOpen();
		expect(pane(h)).not.toBeNull();
		expect(pane(h).hidden).toBe(true);
		tab(h, "recompose").click();
		expect([pane(h).hidden, document.querySelector(".semantropy-recompose-modal")]).toEqual([false, null]);
	});
});

describe("WORKBENCH-UI2 stage 3: the S5 checks, in the pane", () => {
	it("generates, continues, branches, copies and collects from the active Vocabulary", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		expect(button(h, "Continue").disabled).toBe(true);
		button(h, ui().recompose.generate).click(); await settle();
		expect(units(h).length).toBeGreaterThan(0);
		expect(statusText(h)).toBe("1 Source, 4 sentences.");
		button(h, "Continue").click(); await settle();
		expect(paragraphs(h)).toHaveLength(2);
		expect(button(h, "Branch from the chosen place").disabled).toBe(true);
		units(h)[0]!.click();
		expect(units(h)[0]!.classList.contains("is-branch")).toBe(true);
		expect(button(h, "Branch from the chosen place").disabled).toBe(false);
		button(h, "Branch from the chosen place").click(); await settle();
		expect(units(h)[0]!.classList.contains("is-branch")).toBe(false);
		const shown = paragraphs(h).join("\n\n");
		button(h, "Copy").click(); await settle();
		expect(h.calls.copy.at(-1)).toBe(shown);
		button(h, "Collect").click(); await settle();
		const collected = h.calls.collect.at(-1)!;
		expect(collected).toMatchObject({ metadataVersion: 5, type: "recompose", text: shown, algorithmVersion: 1, method: "joint", leapMin: 50, leapMax: 50 });
		expect(readCollectFragmentInputV4(collected).ok).toBe(true);
		expect((collected as RecomposeFragmentInputV5).vocabulary.sources.map((source) => source.path)).toEqual(["source0.md"]);

		// Another Vocabulary: Continue and Branch wait for a new Generate; Collect keeps the provenance the text came from.
		expect(await h.apply(["犬が森を見た。"])).toBe("applied");
		expect(button(h, "Continue").disabled).toBe(true);
		expect(note(h).textContent).toContain("The Vocabulary changed");
		button(h, "Collect").click(); await settle();
		// The same path, another text: the provenance is the one the text came from, hash and fingerprint included.
		const again = (h.calls.collect.at(-1) as RecomposeFragmentInputV5).vocabulary;
		expect(again).toEqual((collected as RecomposeFragmentInputV5).vocabulary);
		expect(again.fingerprint).not.toBe(h.controller().getVocabularyOwner()!.snapshot.fingerprint);
	});
	it("chooses the branch point from the keyboard, branches across paragraphs, and refuses stale or doubled steps", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		const view = screen(h)!;
		await Promise.all([view.run("new"), view.run("new")]);
		expect(paragraphs(h)).toHaveLength(1);
		await view.run("more");
		const first = paragraphs(h)[0];
		expect(output(h).tabIndex).toBe(0);
		key(h, "ArrowRight");
		expect(units(h)[0]!.classList.contains("is-branch")).toBe(true);
		key(h, "End");
		const last = units(h).length - 1;
		expect(units(h)[last]!.classList.contains("is-branch")).toBe(true);
		key(h, "ArrowLeft");
		expect(units(h)[last - 1]!.classList.contains("is-branch")).toBe(true);
		key(h, "End");
		await view.run("branch");
		expect(paragraphs(h)[0]).toBe(first);
		expect(paragraphs(h)).toHaveLength(2);
		const before = paragraphs(h);
		expect(await h.apply(["犬が森を見た。"])).toBe("applied");
		await screen(h)!.run("more");
		expect(paragraphs(h)).toEqual(before);
	});
	it("records mixed methods and the leap range of the pieces on screen", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		const [method, sentences] = Array.from(pane(h).querySelectorAll<HTMLSelectElement>("select"));
		const leap = pane(h).querySelector<HTMLInputElement>('input[type="range"]')!;
		const choose = (id: string, value: number) => {
			method!.value = id; method!.dispatchEvent(new Event("change"));
			leap.value = String(value); leap.dispatchEvent(new Event("input"));
		};
		sentences!.value = "1"; sentences!.dispatchEvent(new Event("change"));
		choose("joint", 50);
		await screen(h)!.run("new");
		choose("ngram", 80);
		await screen(h)!.run("more");
		await screen(h)!.collect();
		expect(h.calls.collect.at(-1)).toMatchObject({ method: "mixed", leapMin: 50, leapMax: 80 });
		choose("joint", 50);
		key(h, "Home");
		await screen(h)!.run("branch");
		await screen(h)!.collect();
		expect(h.calls.collect.at(-1)).toMatchObject({ method: "joint", leapMin: 50, leapMax: 50 });
	});
	it("says so when the Vocabulary Sources have no sentence to recompose", async () => {
		const h = await tabbed(false);
		await h.open("猫と犬。\n");
		expect(await h.apply(["# 猫と犬\n"])).toBe("applied");
		tab(h, "recompose").click();
		await screen(h)!.run("new");
		expect(statusText(h)).toBe("The Vocabulary Sources have no sentences to recompose.");
		expect(units(h)).toHaveLength(0);
	});
	it("uses the method the reader chose, and ends with the View", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		const method = pane(h).querySelector<HTMLSelectElement>("select")!;
		expect(Array.from(method.options, (option) => option.value)).toEqual(["joint", "ngram"]);
		method.value = "ngram"; method.dispatchEvent(new Event("change"));
		await screen(h)!.run("new");
		await screen(h)!.collect();
		expect(h.calls.collect.at(-1)).toMatchObject({ method: "ngram" });
		const kept = session(h)!;
		await h.view.onClose();
		expect([screen(h), session(h), kept.isDisposed()]).toEqual([null, null, true]);
	});
	it("re-words the pane in place when the language changes", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		await screen(h)!.run("new");
		const shown = paragraphs(h), parts = Array.from(pane(h).children);
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(button(h, "新しく生成")).toBeTruthy();
		expect(pane(h).querySelector(".semantropy-recompose-intro")!.textContent).toBe(ui().recompose.intro);
		expect(paragraphs(h)).toEqual(shown);
		expect(Array.from(pane(h).children)).toEqual(parts);
	});
});

describe("WORKBENCH-UI2 stage 3: the output stays until the View closes", () => {
	it("survives tab switches, an Open of another note and a Refresh, with the settings and the branch point", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		const [method, sentences] = Array.from(pane(h).querySelectorAll<HTMLSelectElement>("select"));
		const leap = pane(h).querySelector<HTMLInputElement>('input[type="range"]')!;
		method!.value = "ngram"; method!.dispatchEvent(new Event("change"));
		leap.value = "70"; leap.dispatchEvent(new Event("input"));
		sentences!.value = "5"; sentences!.dispatchEvent(new Event("change"));
		await screen(h)!.run("new");
		units(h)[0]!.click();
		const shown = paragraphs(h), status = statusText(h), kept = session(h);
		tab(h, "shuffle").click(); tab(h, "recompose").click();
		expect(paragraphs(h)).toEqual(shown);
		// A fresh shell (an Open into a View that is not ready) builds a new pane over the same session.
		const before = pane(h);
		await openFresh(h, "猫と犬。\n");
		expect(pane(h)).not.toBe(before);
		expect(session(h)).toBe(kept);
		tab(h, "recompose").click();
		expect(paragraphs(h)).toEqual(shown);
		expect(units(h)[0]!.classList.contains("is-branch")).toBe(true);
		expect(statusText(h)).toBe(status);
		const [method2, sentences2] = Array.from(pane(h).querySelectorAll<HTMLSelectElement>("select"));
		expect([method2!.value, pane(h).querySelector<HTMLInputElement>('input[type="range"]')!.value, sentences2!.value]).toEqual(["ngram", "70", "5"]);
		// Another note into the ready View, and a Refresh: the output stays, and says the Vocabulary it came from is gone.
		await reopen(h, "other.md", "犬と猫。\n");
		tab(h, "recompose").click();
		expect(paragraphs(h)).toEqual(shown);
		expect(note(h).hidden).toBe(false);
		h.notes.set("other.md", "犬と猫と空。\n");
		expect(await refresh(h)).toBe("refreshed");
		tab(h, "recompose").click();
		expect(paragraphs(h)).toEqual(shown);
		expect(session(h)).toBe(kept);
	});
	it("keeps the output and notes it when the Target changes with the Current Note Vocabulary", async () => {
		const h = await tabbed(false);
		await h.open(SOURCE);
		tab(h, "recompose").click();
		await screen(h)!.run("new");
		const shown = paragraphs(h);
		expect(note(h).hidden).toBe(true);
		h.state.text = SOURCE + "空が森を見た。";
		expect(await refresh(h)).toBe("refreshed");
		tab(h, "recompose").click();
		expect(paragraphs(h)).toEqual(shown);
		expect(note(h).hidden).toBe(false);
		expect(button(h, "Continue").disabled).toBe(true);
		expect(button(h, "Collect").disabled).toBe(false);
		await screen(h)!.collect();
		expect((h.calls.collect.at(-1) as RecomposeFragmentInputV5).vocabulary.sources.map(source => source.path)).toEqual(["target.md"]);
		expect((h.calls.collect.at(-1) as RecomposeFragmentInputV5).text).toBe(shown.join("\n\n"));
	});
	it("a step in flight when the shell is rebuilt shows in the new pane; one in flight when the View closes publishes nothing", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		// Only the next paint waits, so the Open itself runs through.
		let release!: () => void, hold = true;
		const base = h.host.scheduler!;
		h.host.scheduler = { ...base, paint: () => {
			if (!hold) return base.paint();
			hold = false; return new Promise<void>(resolve => { release = resolve; });
		} };
		const step = screen(h)!.run("new");
		expect(button(h, ui().recompose.generate).disabled).toBe(true);
		await openFresh(h, "猫と犬。\n");
		expect(await h.apply([SOURCE])).toBe("applied");
		release(); await step;
		tab(h, "recompose").click();
		expect(units(h).length).toBeGreaterThan(0);
		expect(button(h, ui().recompose.generate).disabled).toBe(false);

		// With no output, a step that outlived its session would be the first to set one.
		screen(h)!.clear();
		hold = true;
		const late = screen(h)!.run("new");
		const kept = session(h)!;
		await h.view.onClose();
		release(); await late;
		expect(kept.isDisposed()).toBe(true);
		expect(kept.text()).toBe("");
	});
	it("a new View lifetime starts empty", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		await screen(h)!.run("new");
		const kept = session(h);
		await h.view.onClose();
		await h.open("猫と犬。\n");
		expect(await h.apply([SOURCE])).toBe("applied");
		tab(h, "recompose").click();
		expect(session(h)).not.toBe(kept);
		expect(units(h)).toHaveLength(0);
		expect(pane(h).querySelector(".semantropy-recompose-empty")).not.toBeNull();
	});
});

describe("WORKBENCH-UI2 review 1: the stage 3 branches the first tests left open", () => {
	it("a step keeps the Vocabulary it began with, and a new text after a change names the Vocabulary active then", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		const first = collectVocabularyFromSnapshot(h.controller().getVocabularyOwner()!.snapshot);
		const release = holdNextPaint(h);
		const step = screen(h)!.run("new");
		expect(await h.apply(["犬が森を見た。"])).toBe("applied");
		const second = collectVocabularyFromSnapshot(h.controller().getVocabularyOwner()!.snapshot);
		expect(second).not.toEqual(first);
		release(); await step;
		expect(units(h).length).toBeGreaterThan(0);
		expect(note(h).hidden).toBe(false);
		await screen(h)!.collect();
		expect((h.calls.collect.at(-1) as RecomposeFragmentInputV5).vocabulary).toEqual(first);
		await screen(h)!.run("new");
		expect(note(h).hidden).toBe(true);
		await screen(h)!.collect();
		expect((h.calls.collect.at(-1) as RecomposeFragmentInputV5).vocabulary).toEqual(second);
	});
	it("the pane's output scrolls itself (top for a new text, end for a continuation) and also brings the new text into view (WORKBENCH-UI3 review 1: its box scrolls on its own since stage 4)", async () => {
		const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
		const into: Element[] = [];
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: function (this: Element) { into.push(this); } });
		try {
			const t = await tabbed(); tab(t, "recompose").click();
			const out = output(t);
			Object.defineProperty(out, "scrollHeight", { configurable: true, get: () => 500 });
			out.scrollTop = 33;
			await screen(t)!.run("new");
			expect([out.scrollTop, into.at(-1)]).toEqual([0, out]);
			await screen(t)!.run("more");
			expect([out.scrollTop, into.at(-1)]).toEqual([500, units(t).at(-1)]);
		} finally {
			if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
			else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
		}
	});
	it("Clear while a step waits: the step generates nothing and the output stays cleared", async () => {
		const h = await tabbed();
		tab(h, "recompose").click();
		await screen(h)!.run("new");
		expect(units(h).length).toBeGreaterThan(0);
		const release = holdNextPaint(h);
		const step = screen(h)!.run("more");
		screen(h)!.clear();
		release(); await step;
		expect(units(h)).toHaveLength(0);
		expect(session(h)!.text()).toBe("");
		expect(statusText(h)).toBe("");
		expect(pane(h).querySelector(".semantropy-recompose-empty")).not.toBeNull();
	});
});
