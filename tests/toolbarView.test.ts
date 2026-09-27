import { sha256Hex } from "../src/vocabulary/sha256";
// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { WorkspaceLeaf } from "obsidian";
import { SemantropyView, type SemantropyViewHost } from "../src/view/SemantropyView";
import type { SemantropySession } from "../src/application/SemantropySession";
import { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import { SemantropySettingsStore } from "../src/settings/SemantropySettingsStore";
import {
	defaultSemantropyDisplaySettings,
	type SemantropyDisplaySettings,
} from "../src/settings/displaySettings";
import type { StoredSemantropySettings } from "../src/settings/semantropySettings";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { DEFAULT_DICTIONARY_SEMANTROPY } from "../src/settings/dictionarySemantropy";
import * as slotsCore from "../src/analysis/displaySlots";
import * as snapshotCore from "../src/vocabulary/vocabularySnapshot";
import * as chunkIr from "../src/analysis/targetChunkIr";
import * as presentation from "../src/render/targetBodyController";
import { SELECTION_INVALIDATED_MESSAGE } from "../src/view/logicalSelection";
import { VOCABULARY_DRAW_MODE_SAVE_ERROR } from "../src/application/prepareVocabulary";
import { MARKER_APPLY_ERROR_MESSAGE } from "../src/view/SemantropyToolbar";
import { COPY_COPIED_MESSAGE } from "../src/copy/copyMessages";
import { COLLECT_SAVED_MESSAGE } from "../src/collect/collectMessages";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { immediateScheduler } from "./support/testScheduler";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
	JSDOM: new (html: string) => { window: Window };
};

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => {
	vi.restoreAllMocks();
	document.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
});

type Peek = {
	session: SemantropySession;
	targetBody: ChunkTargetBodyController;
	contentEl: HTMLElement;
	renderShell: () => void;
	updateChrome: () => void;
	lifecycle: { busy: { isBusy: () => boolean } };
	selection: unknown;
};
const peek = (view: SemantropyView) => view as unknown as Peek;
const body = (v: SemantropyView) => peek(v).targetBody;
const root = (v: SemantropyView) => body(v).getContainer()!;
const logical = (v: SemantropyView) => body(v).getTextNodes().map(n => n.data).join("");
const plan = (v: SemantropyView) => body(v).getDisplaySlotPlan()!;
const shell = (v: SemantropyView) => peek(v).contentEl;
const pick = <T extends HTMLElement>(v: SemantropyView, selector: string) =>
	shell(v).querySelector<T>(selector)!;
const ready = (v: SemantropyView) => {
	const state = peek(v).session.getState();
	if (state.status !== "ready") throw new Error("Not ready");
	return state;
};

const words = new Map([["猫", "ネコ"], ["犬", "イヌ"], ["鳥", "トリ"], ["病院", "ビョウイン"]]);
function tokenize(text: string) {
	const out = [];
	for (let i = 0; i < text.length; ) {
		const word = [...words.keys()].find(w => text.startsWith(w, i));
		const surface = word ?? String.fromCodePoint(text.codePointAt(i)!);
		out.push(token({
			surface, baseForm: surface, reading: word ? words.get(word) : undefined,
			...(word ? {} : { pos: "助詞", detail1: "格助詞" }),
		}));
		i += surface.length;
	}
	return out;
}

/** One settings store shared by every view the harness builds, as in the plugin. */
function persistence(initial: StoredSemantropySettings | null = null) {
	let stored: unknown = initial;
	const state = {
		fail: false, saves: 0,
		/** Held open by a test to reproduce a view abandoned mid-write. */
		gate: null as Promise<void> | null,
		/** Resolves the moment a write actually starts. */
		entered: null as (() => void) | null,
	};
	const store = new SemantropySettingsStore({
		load: async () => stored,
		save: async (data) => {
			state.entered?.();
			await state.gate;
			if (state.fail) throw new Error("disk full");
			state.saves += 1;
			stored = data;
		},
	});
	return { store, state, read: () => stored as StoredSemantropySettings };
}

function harness(size = 40, level = 100, shared = persistence()) {
	const views: SemantropyView[] = [];
	const control = {
		source: "", body: assertBodySemantropy(level), scheduler: immediateScheduler(),
		collectGate: null as Promise<void> | null,
	};
	const calls = { tokens: [] as string[], reads: 0, copy: [] as string[], collect: [] as string[], notices: [] as string[] };
	const host: SemantropyViewHost = {
		targetChunkSize: size,
		getTokenizer: () => ({ tokenize: async text => { calls.tokens.push(text); return tokenize(text); } }),
		readCurrentText: async () => { calls.reads += 1; return control.source; },
		getBodySemantropy: () => control.body,
		setBodySemantropy: async value => { control.body = value; return true; },
		getDictionarySemantropy: () => DEFAULT_DICTIONARY_SEMANTROPY,
		setDictionarySemantropy: async () => false,
		getDisplaySettings: () => shared.store.getDisplaySettings(),
		setDisplaySettings: async patch => {
			const saved = await shared.store.setDisplaySettings(patch);
			// The plugin brings every open view to the stored settings.
			if (saved) for (const view of views) await view.applyStoredDisplaySettings();
			return saved;
		},
		writeClipboard: async text => { calls.copy.push(text); },
		collectFragment: async input => {
			await control.collectGate;
			calls.collect.push(input.text);
			return { status: "created" };
		},
		showNotice: message => { calls.notices.push(message); },
		scheduler: {
			now: () => control.scheduler.now(),
			yieldTask: () => control.scheduler.yieldTask(),
			paint: () => control.scheduler.paint(),
		},
	};
	const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
	views.push(view);
	peek(view).contentEl = document.createElement("div");
	document.body.append(peek(view).contentEl);
	const open = async (text: string) => {
		control.source = text;
		await view.onOpen();
		await view.openCapture(
			{ kind: "markdown", note: { sourcePath: "fixture.md", sourceName: "fixture.md", editorText: text } },
			{ readCached: async () => text, hashText: async text => sha256Hex(text), issueSeed: () => 7 },
		);
	};
	return { view, views, host, control, calls, open, shared };
}

/** Lets queued microtasks run without touching real time. */
async function flush(turns = 12): Promise<void> {
	for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

/** Selects the whole committed body through the real document Selection. */
function selectBody(view: SemantropyView): void {
	const selection = document.getSelection()!;
	const range = document.createRange();
	range.selectNodeContents(root(view));
	selection.removeAllRanges();
	selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
}

/** Moves the DOM selection out of the body, as focusing a Toolbar control can. */
function selectToolbar(view: SemantropyView): void {
	const selection = document.getSelection()!;
	const label = pick<HTMLElement>(view, ".semantropy-toolbar .semantropy-display-label");
	const range = document.createRange();
	range.selectNodeContents(label);
	selection.removeAllRanges();
	selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
	pick<HTMLButtonElement>(view, ".semantropy-copy").focus();
}

/** Every element the keyboard can reach, in DOM order. */
function tabOrder(view: SemantropyView): HTMLElement[] {
	return Array.from(
		shell(view).querySelectorAll<HTMLElement>("button, select, input, [tabindex]"),
	).filter(el => !el.hidden && !el.closest("[hidden]") && el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
}

describe("TOOLBAR1 layout ownership (UI-01)", () => {
	it("gives the Toolbar, the status and the body scroll container separate owners", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(60));
		const shellRoot = pick<HTMLElement>(h.view, ".semantropy-root");
		const toolbar = pick<HTMLElement>(h.view, ".semantropy-toolbar");
		const status = pick<HTMLElement>(h.view, ".semantropy-status");
		const scroll = pick<HTMLElement>(h.view, ".semantropy-scroll");

		expect(toolbar.parentElement).toBe(shellRoot);
		expect(status.parentElement).toBe(shellRoot);
		expect(scroll.parentElement).toBe(shellRoot);
		expect(scroll.contains(toolbar)).toBe(false);
		expect(scroll.contains(status)).toBe(false);
		expect(scroll.contains(root(h.view))).toBe(true);
		// The Load control scrolls with the body it extends.
		expect(scroll.contains(pick(h.view, ".semantropy-load-next"))).toBe(true);
		expect(toolbar.querySelector(".semantropy-load-next")).toBeNull();
	});

	it("scrolls the body box only, with the root itself fixed", () => {
		const css = readFileSync("styles.css", "utf8");
		const dom = new JSDOM(
			`<style>${css}</style><div class="semantropy-root"><div class="semantropy-toolbar"></div>` +
			`<div class="semantropy-status"></div><div class="semantropy-scroll"><div class="semantropy-body"></div></div></div>`,
		);
		const style = (selector: string) =>
			dom.window.getComputedStyle(dom.window.document.querySelector(selector)!);
		expect(style(".semantropy-root").overflow).toBe("hidden");
		expect(style(".semantropy-root").display).toBe("flex");
		expect(style(".semantropy-root").flexDirection).toBe("column");
		expect(style(".semantropy-scroll").overflow).toBe("auto");
		expect(style(".semantropy-scroll").minHeight).toBe("0px");
		// Nothing here leans on sticky positioning to keep the Toolbar visible.
		expect(css.replace(/\/\*[\s\S]*?\*\//gu, "")).not.toMatch(/position:\s*sticky/);
		expect(style(".semantropy-toolbar").position).not.toBe("sticky");
		dom.window.close();
	});

	it("keeps the shell, the selection and the scroll position across a Chunk append", async () => {
		const h = harness(30); await h.open("猫と犬と鳥。\n".repeat(40));
		const toolbar = pick<HTMLElement>(h.view, ".semantropy-toolbar");
		const scroll = pick<HTMLElement>(h.view, ".semantropy-scroll");
		const first = root(h.view).firstChild;
		selectBody(h.view);
		const before = logical(h.view);
		scroll.scrollTop = 64;

		expect(await h.view.loadNextSection()).toBe("applied");

		expect(pick<HTMLElement>(h.view, ".semantropy-toolbar")).toBe(toolbar);
		expect(pick<HTMLElement>(h.view, ".semantropy-scroll")).toBe(scroll);
		expect(root(h.view).firstChild).toBe(first);
		expect(scroll.scrollTop).toBe(64);
		// The earlier prefix is unchanged, so the recorded selection still holds.
		expect(logical(h.view).startsWith(before)).toBe(true);
		selectToolbar(h.view);
		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(h.calls.copy).toEqual([before]);
	});
});

describe("TOOLBAR1 action hierarchy and accessibility (UI-02)", () => {
	it("orders the primary actions in the DOM and names each one distinctly", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const primary = Array.from(
			shell(h.view).querySelectorAll<HTMLButtonElement>(".semantropy-toolbar-group.is-primary button"),
		);
		expect(primary.map(b => b.textContent)).toEqual([
			"Reshuffle text", "Refresh target", "Copy selection", "Collect selection",
		]);
		const labels = primary.map(b => b.getAttribute("aria-label") ?? "");
		expect(new Set(labels).size).toBe(4);
		// One description per control: Obsidian's own tooltip reads aria-label, so
		// no `title` may add a second, native one (EXPERIENCE-DISPLAY1, UX-03).
		expect(labels.every((label, i) => label !== "" && !primary[i]!.hasAttribute("title"))).toBe(true);
		// Reshuffle, Refresh and the Vocabulary update read differently everywhere.
		expect(labels[0]).toContain("Reshuffle text");
		expect(labels[1]).toContain("Refresh target");
		expect(labels[0]).not.toBe(labels[1]);
		// EXPERIENCE-VOCABULARY1: the Vocabulary update is reached through its own entry.
		const change = Array.from(shell(h.view).querySelectorAll("button"))
			.find(b => b.textContent === "Change vocabulary");
		expect(change).toBeDefined();
		expect(labels).not.toContain(change!.getAttribute("aria-label"));

		const order = tabOrder(h.view);
		const indexOf = (el: HTMLElement) => order.indexOf(el);
		expect(indexOf(primary[0]!)).toBeLessThan(indexOf(primary[3]!));
		expect(order.every(el => el.tabIndex <= 0)).toBe(true);
		expect(shell(h.view).querySelector('[tabindex="1"]')).toBeNull();
	});

	it("classifies Collision as phrase generation and keeps later-slice operations absent", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const text = Array.from(shell(h.view).querySelectorAll("button, select, option, label"))
			.map(el => el.textContent ?? "").join(" | ");
		for (const present of ["Shuffle selected word", "Restore selected word", "Use automatic result for selected word", "Clear manual changes"]) {
			expect(text).toContain(present);
		}
		expect(text).toContain("Hover modifier");
		const collision = pick<HTMLButtonElement>(h.view, ".semantropy-collision-open");
		expect(collision.textContent).toBe("Collision");
		// EXPERIENCE-CONTROLS1: the group is named by its visible category label, not by an aria-label chip.
		const group = collision.closest<HTMLElement>('.semantropy-toolbar-group[role="group"]')!;
		expect(group.hasAttribute("aria-label")).toBe(false);
		expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toBe("Phrase generation");
		expect(collision.closest('[aria-label="Display settings"]')).toBeNull();
		expect(tabOrder(h.view)).toContain(collision);
		for (const absent of [
			"Vertical", "縦書き", "Recompose", "Seed",
		]) {
			expect(text).not.toContain(absent);
		}
	});

	it("keeps a collapsed overflow menu out of the Tab order and restores focus on Escape", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const button = pick<HTMLButtonElement>(h.view, ".semantropy-display-menu-button");
		const menu = pick<HTMLElement>(h.view, ".semantropy-display-menu");
		expect(menu.hidden).toBe(true);
		expect(button.getAttribute("aria-expanded")).toBe("false");
		expect(tabOrder(h.view).some(el => menu.contains(el))).toBe(false);

		button.click();
		expect(menu.hidden).toBe(false);
		expect(button.getAttribute("aria-expanded")).toBe("true");
		expect(tabOrder(h.view).some(el => menu.contains(el))).toBe(true);
		expect(pick<HTMLButtonElement>(h.view, ".semantropy-display-reset")).toBeDefined();

		menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(menu.hidden).toBe(true);
		expect(document.activeElement).toBe(button);
		expect(tabOrder(h.view).some(el => menu.contains(el))).toBe(false);

		// A click outside closes it too, without swallowing the click.
		button.click();
		expect(menu.hidden).toBe(false);
		const outside = new window.Event("pointerdown", { bubbles: true, cancelable: true });
		root(h.view).dispatchEvent(outside);
		expect(menu.hidden).toBe(true);
		expect(outside.defaultPrevented).toBe(false);

		// A click inside leaves it open.
		button.click();
		pick<HTMLElement>(h.view, ".semantropy-display-row")
			.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
		expect(menu.hidden).toBe(false);
	});

	it("keeps every primary action reachable in a narrow pane, sized by the view", () => {
		const css = readFileSync("styles.css", "utf8");
		// The narrow rule follows the view's own inline size, not the window's.
		expect(css).toMatch(/@container semantropy-view \(max-width/);
		expect(css).toMatch(/container: semantropy-view \/ inline-size/);
		expect(css).not.toMatch(/@media[^{]*max-width/);

		const dom = new JSDOM(
			`<style>${css}</style><div style="width:320px" class="semantropy-root">` +
			`<div class="semantropy-toolbar"><div class="semantropy-toolbar-group is-primary">` +
			`<button class="semantropy-action semantropy-reshuffle">Reshuffle text</button>` +
			`<button class="semantropy-action semantropy-refresh">Refresh target</button>` +
			`<button class="semantropy-action semantropy-copy">Copy</button>` +
			`<button class="semantropy-action semantropy-collect">Collect</button>` +
			`</div></div><div class="semantropy-scroll"></div></div>`,
		);
		const view = dom.window;
		for (const selector of [".semantropy-reshuffle", ".semantropy-refresh", ".semantropy-copy", ".semantropy-collect"]) {
			const style = view.getComputedStyle(view.document.querySelector(selector)!);
			expect(style.display).not.toBe("none");
			expect(style.visibility).not.toBe("hidden");
		}
		// EXPERIENCE-CONTROLS1: the row never wraps and never clips or scrolls sideways;
		// items that do not fit move to the More menu (tests/experienceControls1.test.ts).
		const toolbar = view.getComputedStyle(view.document.querySelector(".semantropy-toolbar")!);
		expect(toolbar.flexWrap).toBe("nowrap");
		expect(toolbar.overflow).not.toBe("hidden");
		expect(["auto", "scroll"]).not.toContain(toolbar.overflowX);
		view.close();
	});

	it("marks every display toggle with aria-pressed and keeps it usable while the body is busy", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		pick<HTMLButtonElement>(h.view, ".semantropy-display-menu-button").click();
		const ruby = pick<HTMLButtonElement>(h.view, ".semantropy-toggle-showRuby");
		expect(ruby.getAttribute("aria-pressed")).toBe("true");

		// A Collect in flight holds the view; a pure display change still lands.
		const gate = deferred<void>();
		h.control.collectGate = gate.promise;
		selectBody(h.view);
		const collecting = h.view.collectSelectedFragment();
		await flush();
		expect(pick<HTMLButtonElement>(h.view, ".semantropy-reshuffle").disabled).toBe(true);
		expect(ruby.disabled).toBe(false);

		ruby.click();
		await flush();
		expect(h.shared.store.getDisplaySettings().showRuby).toBe(false);
		expect(ruby.getAttribute("aria-pressed")).toBe("false");
		expect(pick<HTMLElement>(h.view, ".semantropy-body").classList.contains("is-ruby-hidden")).toBe(true);

		gate.resolve();
		expect(await collecting).toBe("created");
	});

	it("distinguishes empty, loading-target, ready, stale and error in the status line", async () => {
		const h = harness();
		await h.view.onOpen();
		const state = () => pick<HTMLElement>(h.view, ".semantropy-status").dataset["state"];
		expect(state()).toBe("empty");
		expect(pick<HTMLElement>(h.view, ".semantropy-status-detail").textContent)
			.toContain("Collect");

		await h.open("猫と犬。\n".repeat(20));
		expect(state()).toBe("ready");
		expect(pick<HTMLElement>(h.view, ".semantropy-replacements").textContent)
			.toBe(`replacements: ${ready(h.view).replacementCount}`);

		h.view.markSourceLost();
		expect(state()).toBe("target-stale");
		expect(pick<HTMLElement>(h.view, ".semantropy-stale").textContent).toContain("Refresh target");

		h.view.notifyVocabularySourceEvent("fixture.md", "missing");
		expect(pick<HTMLElement>(h.view, ".semantropy-message").getAttribute("aria-live")).toBe("polite");
	});

	it("gives Copy feedback through both the Notice and a live region", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		selectBody(h.view);
		expect(await h.view.copySelectedFragment()).toBe("copied");
		const feedback = pick<HTMLElement>(h.view, ".semantropy-toolbar-feedback");
		expect(h.calls.notices).toContain(COPY_COPIED_MESSAGE);
		expect(feedback.textContent).toBe(COPY_COPIED_MESSAGE);
		expect(feedback.getAttribute("aria-live")).toBe("polite");
		// Fixed wording only: no body, no path, no nonce.
		expect(feedback.textContent).not.toMatch(/猫|犬|fixture|hash/);
	});
});

describe("TOOLBAR1 display settings never change generation (UI-03)", () => {
	it("leaves the body string, plan, Snapshot and counts untouched for font, size and colour", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const before = {
			text: logical(h.view), plan: plan(h.view), state: peek(h.view).session.getState(),
			snapshot: body(h.view).getVocabularySnapshot(), revision: body(h.view).getDisplayRevision(),
			generation: body(h.view).getBodyGeneration(), nodes: Array.from(root(h.view).childNodes),
		};
		const draw = vi.spyOn(snapshotCore, "transformWithVocabularySnapshot");
		const planning = vi.spyOn(slotsCore, "planAutomaticDisplaySlots");
		const build = vi.spyOn(presentation, "buildTargetDisplay");
		const tokens = h.calls.tokens.length;

		for (const patch of [
			{ bodyFontFamily: "serif" }, { bodyFontSizePx: 20 },
			{ bodyBackground: "#101214" }, { bodyForeground: "#e8e6e3" },
		] as Partial<SemantropyDisplaySettings>[]) {
			expect(await h.view.changeDisplaySettings(patch)).toBe("applied");
		}

		expect(logical(h.view)).toBe(before.text);
		expect(plan(h.view)).toBe(before.plan);
		expect(peek(h.view).session.getState()).toBe(before.state);
		expect(body(h.view).getVocabularySnapshot()).toBe(before.snapshot);
		expect(body(h.view).getDisplayRevision()).toBe(before.revision);
		expect(body(h.view).getBodyGeneration()).toBe(before.generation);
		expect(Array.from(root(h.view).childNodes)).toEqual(before.nodes);
		expect(ready(h.view).replacementCount).toBe(before.state.status === "ready" ? before.state.replacementCount : -1);
		expect([draw, planning, build].every(spy => !spy.mock.calls.length)).toBe(true);
		expect(h.calls.tokens).toHaveLength(tokens);
		expect(h.calls.reads).toBe(0);

		const bodyEl = pick<HTMLElement>(h.view, ".semantropy-body");
		expect(bodyEl.style.fontFamily).toContain("serif");
		expect(bodyEl.style.fontSize).toBe("20px");
		expect(bodyEl.style.backgroundColor).not.toBe("");
		// The Toolbar keeps the interface font and colours.
		const toolbar = pick<HTMLElement>(h.view, ".semantropy-toolbar");
		expect(toolbar.style.fontFamily).toBe("");
		expect(toolbar.style.fontSize).toBe("");
		expect(toolbar.contains(bodyEl)).toBe(false);
	});

	it("hides only the reading when Ruby is Off, leaving the base, Copy and Collect equal", async () => {
		const h = harness(100); await h.open("猫《ねこ》と病院《びょういん》。\n");
		const bodyEl = pick<HTMLElement>(h.view, ".semantropy-body");
		const readings = Array.from(root(h.view).querySelectorAll("rt")).map(n => n.textContent);
		expect(readings.length).toBeGreaterThan(0);
		selectBody(h.view);
		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(await h.view.collectSelectedFragment()).toBe("created");
		const baseline = logical(h.view);

		expect(await h.view.changeDisplaySettings({ showRuby: false })).toBe("applied");
		expect(bodyEl.classList.contains("is-ruby-hidden")).toBe(true);
		expect(Array.from(root(h.view).querySelectorAll("rt")).map(n => n.textContent)).toEqual(readings);
		expect(logical(h.view)).toBe(baseline);
		selectBody(h.view);
		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(await h.view.collectSelectedFragment()).toBe("created");

		expect(await h.view.changeDisplaySettings({ showRuby: true })).toBe("applied");
		expect(bodyEl.classList.contains("is-ruby-hidden")).toBe(false);
		expect(logical(h.view)).toBe(baseline);
		expect(new Set(h.calls.copy)).toEqual(new Set([baseline]));
		expect(h.calls.collect).toEqual(h.calls.copy);
		expect(h.calls.copy.join("")).not.toMatch(/ねこ|びょういん|《|》/);
	});

	it("re-marks without a transform, a tokenize, a Source read or a draw", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const before = {
			text: logical(h.view), state: peek(h.view).session.getState(),
			snapshot: body(h.view).getVocabularySnapshot(), revision: body(h.view).getDisplayRevision(),
			count: ready(h.view).replacementCount,
		};
		const draw = vi.spyOn(snapshotCore, "transformWithVocabularySnapshot");
		const tokens = h.calls.tokens.length;

		expect(await h.view.changeDisplaySettings({
			showReplacementMarkers: false, showManualMarkers: false, showDictionaryMarkers: false,
		})).toBe("applied");

		expect(root(h.view).querySelectorAll(
			".semantropy-replaced,.semantropy-manual-available,.semantropy-dictionary-available",
		)).toHaveLength(0);
		expect(root(h.view).querySelectorAll(".semantropy-token").length).toBeGreaterThan(0);
		expect(logical(h.view)).toBe(before.text);
		expect(peek(h.view).session.getState()).toBe(before.state);
		expect(ready(h.view).replacementCount).toBe(before.count);
		expect(body(h.view).getVocabularySnapshot()).toBe(before.snapshot);
		expect(body(h.view).getDisplayRevision()).toBe(before.revision);
		expect(draw).not.toHaveBeenCalled();
		expect(h.calls.tokens).toHaveLength(tokens);
		expect(h.calls.reads).toBe(0);

		expect(await h.view.changeDisplaySettings({ showReplacementMarkers: true })).toBe("applied");
		expect(root(h.view).querySelector(".semantropy-replaced")).not.toBeNull();
	});

	it("builds no DOM, binding or slot for an unloaded Chunk when display settings change", async () => {
		const h = harness(30); await h.open("猫と犬と鳥。\n".repeat(60));
		const project = vi.spyOn(chunkIr, "projectTargetLineChunk");
		const build = vi.spyOn(presentation, "buildTargetDisplay");
		expect(body(h.view).hasNext()).toBe(true);
		const stats = body(h.view).getChunkStats();

		await h.view.changeDisplaySettings({ bodyFontSizePx: 18, showRuby: false });
		await h.view.changeDisplaySettings({ showManualMarkers: false });

		expect(project).not.toHaveBeenCalled();
		expect(build).toHaveBeenCalledTimes(1); // the marker change, loaded prefix only
		expect(body(h.view).getChunkStats()).toMatchObject({
			chunks: stats.chunks, totalChunks: stats.totalChunks, materializedUtf16: stats.materializedUtf16,
		});
		expect(new Set(plan(h.view).slots.map(s => s.chunkId)).size).toBe(1);
	});

	it("keeps Custom selected and its field usable until a value is submitted", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		pick<HTMLButtonElement>(h.view, ".semantropy-display-menu-button").click();
		const select = pick<HTMLSelectElement>(h.view, ".semantropy-color-bodyBackground");
		const field = pick<HTMLInputElement>(h.view, ".semantropy-color-input-bodyBackground");
		expect(field.disabled).toBe(true);

		select.value = "custom";
		select.dispatchEvent(new window.Event("change"));
		expect(field.disabled).toBe(false);
		expect(select.value).toBe("custom");

		// Anything that re-syncs the Toolbar must not take the field away: the
		// stored colour is still the theme default at this point.
		peek(h.view).updateChrome();
		h.view.markSourceLost();
		await flush();
		expect(field.disabled).toBe(false);
		expect(select.value).toBe("custom");
		expect(h.shared.store.getDisplaySettings().bodyBackground).toBeNull();

		// A refused value keeps the row on Custom so it can be corrected.
		field.value = "papayawhip";
		field.dispatchEvent(new window.Event("change"));
		await flush();
		expect(field.disabled).toBe(false);
		expect(select.value).toBe("custom");
		expect(pick<HTMLElement>(h.view, ".semantropy-display-message").textContent)
			.toContain("#RRGGBB");
		expect(h.shared.store.getDisplaySettings().bodyBackground).toBeNull();

		field.value = "#123456";
		field.dispatchEvent(new window.Event("change"));
		await flush();
		expect(h.shared.store.getDisplaySettings().bodyBackground).toBe("#123456");
		expect(select.value).toBe("custom");
		expect(field.disabled).toBe(false);
		expect(pick<HTMLElement>(h.view, ".semantropy-body").style.backgroundColor).not.toBe("");
	});

	it("cancels an unsubmitted Custom draft when the menu closes", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const menuButton = pick<HTMLButtonElement>(h.view, ".semantropy-display-menu-button");
		menuButton.click();
		const select = pick<HTMLSelectElement>(h.view, ".semantropy-color-bodyForeground");
		const field = pick<HTMLInputElement>(h.view, ".semantropy-color-input-bodyForeground");
		select.value = "custom";
		select.dispatchEvent(new window.Event("change"));
		expect(field.disabled).toBe(false);

		pick<HTMLElement>(h.view, ".semantropy-display-menu")
			.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		menuButton.click();
		expect(select.value).toBe("");
		expect(field.disabled).toBe(true);
		expect(h.shared.store.getDisplaySettings().bodyForeground).toBeNull();
	});

	it("gives each open view its own display-menu id", async () => {
		const shared = persistence();
		const a = harness(40, 100, shared), b = harness(40, 100, shared);
		await a.open("猫と犬。\n".repeat(20));
		await b.open("鳥と病院。\n".repeat(20));

		const menus = [a.view, b.view].map(view => pick<HTMLElement>(view, ".semantropy-display-menu"));
		const buttons = [a.view, b.view].map(view =>
			pick<HTMLButtonElement>(view, ".semantropy-display-menu-button"));
		expect(menus[0]!.id).not.toBe(menus[1]!.id);
		expect(new Set(menus.map(menu => menu.id)).size).toBe(2);
		expect(buttons.map(b2 => b2.getAttribute("aria-controls"))).toEqual(menus.map(menu => menu.id));
		// Each id resolves to exactly one element across both open views.
		for (const menu of menus) {
			expect(document.querySelectorAll(`[id="${menu.id}"]`)).toHaveLength(1);
		}
	});

	it("leaves the dictionary modifier alone when display settings are Reset", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		await h.shared.store.setDisplaySettings({ dictionaryModifier: "shift" });
		await h.view.changeDisplaySettings({ bodyFontSizePx: 24, showRuby: false });

		expect(await h.view.resetDisplaySettings()).toBe("applied");

		// The Toolbar offers no modifier control, so Reset must not change it.
		expect(h.shared.store.getDisplaySettings()).toEqual({
			...defaultSemantropyDisplaySettings(),
			dictionaryModifier: "shift",
		});
	});

	it("keeps the stored setting and the body together when the write is refused", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const bodyEl = pick<HTMLElement>(h.view, ".semantropy-body");
		h.shared.state.fail = true;

		expect(await h.view.changeDisplaySettings({ bodyFontSizePx: 20 })).toBe("failed");
		expect(bodyEl.style.fontSize).toBe("");
		expect(h.shared.store.getDisplaySettings().bodyFontSizePx).toBeNull();
		expect(pick<HTMLElement>(h.view, ".semantropy-display-message").textContent)
			.toContain("Could not save");

		// A refused value is neither written nor applied.
		h.shared.state.fail = false;
		expect(await h.view.changeDisplaySettings({ bodyFontSizePx: 40 })).toBe("failed");
		expect(h.shared.store.getDisplaySettings().bodyFontSizePx).toBeNull();

		expect(await h.view.changeDisplaySettings({ bodyFontSizePx: 20 })).toBe("applied");
		expect(bodyEl.style.fontSize).toBe("20px");
	});

	it("re-marks a busy view once it is free, ending on the latest stored value", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const markers = () => body(h.view).getMarkerVisibility();
		expect(markers().dictionary).toBe(true);

		// A Collect in flight holds the view, so the body cannot be re-marked yet.
		const gate = deferred<void>();
		h.control.collectGate = gate.promise;
		selectBody(h.view);
		const collecting = h.view.collectSelectedFragment();
		await flush();
		expect(peek(h.view).lifecycle.busy.isBusy()).toBe(true);

		expect(await h.view.changeDisplaySettings({ showDictionaryMarkers: false })).toBe("applied");
		// Saved and shown in the Toolbar, but the body is still held.
		expect(h.shared.store.getDisplaySettings().showDictionaryMarkers).toBe(false);
		expect(markers().dictionary).toBe(true);

		// A second change while still busy: the last one must win.
		expect(await h.view.changeDisplaySettings({ showManualMarkers: false })).toBe("applied");
		expect(markers().dictionary).toBe(true);

		gate.resolve();
		expect(await collecting).toBe("created");
		await flush(40);

		expect(markers()).toMatchObject({ replacement: true, manual: false, dictionary: false });
		expect(root(h.view).querySelectorAll(
			".semantropy-manual-available,.semantropy-dictionary-available")).toHaveLength(0);
		expect(root(h.view).querySelector(".semantropy-replaced")).not.toBeNull();
		// The stored settings and the body now describe the same thing.
		const stored = h.shared.store.getDisplaySettings();
		expect(markers()).toMatchObject({
			replacement: stored.showReplacementMarkers,
			manual: stored.showManualMarkers,
			dictionary: stored.showDictionaryMarkers,
		});
	});

	it("retries a refused marker rebuild within one pass and converges", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const controller = body(h.view);
		// Store the setting without applying it, so exactly one reconciliation
		// pass follows and the retry inside that pass is what must converge.
		expect(await h.shared.store.setDisplaySettings({ showDictionaryMarkers: false })).toBe(true);
		expect(controller.getMarkerVisibility().dictionary).toBe(true);
		const fault = vi.spyOn(controller, "prepareMarkers").mockImplementationOnce(
			async () => ({ status: "failed" }),
		);

		await h.view.applyStoredDisplaySettings();

		expect(fault).toHaveBeenCalledTimes(2);
		expect(controller.getMarkerVisibility().dictionary).toBe(false);
		expect(root(h.view).querySelector(".semantropy-dictionary-available")).toBeNull();
		expect(h.view.getMarkerApplyError()).toBeNull();
		expect(pick<HTMLElement>(h.view, ".semantropy-display-message").textContent).toBe("");
	});

	it.each(["failed", "commit-stale"] as const)(
		"says the body is not showing a saved marker setting when it cannot be redrawn (%s)",
		async (mode) => {
			const h = harness(); await h.open("猫と犬。\n".repeat(20));
			const controller = body(h.view);
			const before = {
				markers: { ...controller.getMarkerVisibility() },
				marked: root(h.view).querySelectorAll(".semantropy-dictionary-available").length,
				state: peek(h.view).session.getState(),
				text: logical(h.view),
				revision: controller.getDisplayRevision(),
			};
			expect(before.marked).toBeGreaterThan(0);
			// Every attempt inside the pass is refused: a preparation that fails,
			// or a prepared commit a newer owner invalidates.
			vi.spyOn(controller, "prepareMarkers").mockImplementation(async () =>
				mode === "failed"
					? { status: "failed" }
					: { status: "prepared", commit: () => "stale" },
			);

			expect(await h.view.changeDisplaySettings({ showDictionaryMarkers: false }))
				.toBe("saved-not-applied");

			// The setting really is stored, so the outcome is not a save failure.
			expect(h.shared.store.getDisplaySettings().showDictionaryMarkers).toBe(false);
			// The body kept the markers it had, and nothing else moved with it.
			expect(controller.getMarkerVisibility()).toEqual(before.markers);
			expect(root(h.view).querySelectorAll(".semantropy-dictionary-available"))
				.toHaveLength(before.marked);
			expect(peek(h.view).session.getState()).toBe(before.state);
			expect(logical(h.view)).toBe(before.text);
			expect(controller.getDisplayRevision()).toBe(before.revision);
			// And the reader is told, in fixed wording, rather than left with a
			// Toolbar that disagrees with the body in silence.
			expect(h.view.getMarkerApplyError()).toBe(MARKER_APPLY_ERROR_MESSAGE);
			const alert = pick<HTMLElement>(h.view, ".semantropy-display-alert");
			expect(alert.textContent).toBe(MARKER_APPLY_ERROR_MESSAGE);
			// Stated outside the overflow menu, so a closed menu still shows it.
			expect(alert.hidden).toBe(false);
			expect(alert.closest(".semantropy-display-menu")).toBeNull();
			expect(alert.getAttribute("aria-live")).toBe("polite");
			expect(MARKER_APPLY_ERROR_MESSAGE).not.toMatch(/猫|犬|fixture|hash/);

			// Once the body can be redrawn again, the next change converges it.
			vi.restoreAllMocks();
			expect(await h.view.changeDisplaySettings({ showManualMarkers: false })).toBe("applied");
			expect(controller.getMarkerVisibility()).toMatchObject({
				replacement: true, manual: false, dictionary: false,
			});
			expect(h.view.getMarkerApplyError()).toBeNull();
			expect(pick<HTMLElement>(h.view, ".semantropy-display-alert").hidden).toBe(true);
		},
	);

	it("keeps the marker warning while the menu is closed and reopened", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const controller = body(h.view);
		vi.spyOn(controller, "prepareMarkers").mockImplementation(async () => ({ status: "failed" }));

		expect(await h.view.changeDisplaySettings({ showDictionaryMarkers: false }))
			.toBe("saved-not-applied");

		const alert = pick<HTMLElement>(h.view, ".semantropy-display-alert");
		const menuButton = pick<HTMLButtonElement>(h.view, ".semantropy-display-menu-button");
		const menu = pick<HTMLElement>(h.view, ".semantropy-display-menu");
		expect(menu.hidden).toBe(true);
		expect(alert.hidden).toBe(false);
		expect(menuButton.classList.contains("is-error")).toBe(true);
		// EXPERIENCE-CONTROLS1: the alert joins the button's own description instead of replacing it.
		expect(menuButton.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);

		// Opening and closing the menu is transient; the mismatch is not.
		menuButton.click();
		expect(alert.textContent).toBe(MARKER_APPLY_ERROR_MESSAGE);
		menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(menu.hidden).toBe(true);
		expect(alert.hidden).toBe(false);
		expect(alert.textContent).toBe(MARKER_APPLY_ERROR_MESSAGE);
		expect(h.view.getMarkerApplyError()).toBe(MARKER_APPLY_ERROR_MESSAGE);

		// A transient row message clears with the menu; the durable one stays.
		menuButton.click();
		const field = pick<HTMLInputElement>(h.view, ".semantropy-color-input-bodyBackground");
		pick<HTMLSelectElement>(h.view, ".semantropy-color-bodyBackground").value = "custom";
		pick<HTMLSelectElement>(h.view, ".semantropy-color-bodyBackground")
			.dispatchEvent(new window.Event("change"));
		field.value = "not-a-colour";
		field.dispatchEvent(new window.Event("change"));
		expect(pick<HTMLElement>(h.view, ".semantropy-display-message").textContent)
			.toContain("#RRGGBB");
		menuButton.click();
		expect(pick<HTMLElement>(h.view, ".semantropy-display-message").textContent).toBe("");
		expect(alert.textContent).toBe(MARKER_APPLY_ERROR_MESSAGE);
	});

	it("shows a visible warning in the failing view when another view changes the setting", async () => {
		const shared = persistence();
		const a = harness(40, 100, shared), b = harness(40, 100, shared);
		a.views.push(b.view);
		b.views.push(a.view);
		await a.open("猫と犬。\n".repeat(20));
		await b.open("鳥と病院。\n".repeat(20));
		// b's menu is closed, as it is for any view the reader is not using.
		expect(pick<HTMLElement>(b.view, ".semantropy-display-menu").hidden).toBe(true);
		vi.spyOn(body(b.view), "prepareMarkers").mockImplementation(async () => ({ status: "failed" }));

		expect(await a.view.changeDisplaySettings({ showReplacementMarkers: false })).toBe("applied");

		// a caught up; b could not, and says so where a closed menu cannot hide it.
		expect(body(a.view).getMarkerVisibility().replacement).toBe(false);
		expect(body(b.view).getMarkerVisibility().replacement).toBe(true);
		expect(a.view.getMarkerApplyError()).toBeNull();
		expect(b.view.getMarkerApplyError()).toBe(MARKER_APPLY_ERROR_MESSAGE);
		const alert = pick<HTMLElement>(b.view, ".semantropy-display-alert");
		expect(alert.hidden).toBe(false);
		expect(alert.textContent).toBe(MARKER_APPLY_ERROR_MESSAGE);
		expect(alert.closest("[hidden]")).toBeNull();
		expect(pick<HTMLElement>(a.view, ".semantropy-display-alert").hidden).toBe(true);
	});

	it("clears the warning and its message when a later reconciliation succeeds", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const controller = body(h.view);
		const fault = vi.spyOn(controller, "prepareMarkers")
			.mockImplementation(async () => ({ status: "failed" }));
		expect(await h.view.changeDisplaySettings({ showManualMarkers: false }))
			.toBe("saved-not-applied");
		const alert = pick<HTMLElement>(h.view, ".semantropy-display-alert");
		const menuButton = pick<HTMLButtonElement>(h.view, ".semantropy-display-menu-button");
		expect(alert.hidden).toBe(false);

		// The body can be redrawn again; a background pass alone must clear it.
		fault.mockRestore();
		await h.view.applyStoredDisplaySettings();

		expect(h.view.getMarkerApplyError()).toBeNull();
		expect(alert.hidden).toBe(true);
		expect(alert.textContent).toBe("");
		expect(menuButton.classList.contains("is-error")).toBe(false);
		expect(menuButton.getAttribute("aria-describedby")?.split(" ")).not.toContain(alert.id);
		expect(controller.getMarkerVisibility().manual).toBe(false);
		expect(root(h.view).querySelector(".semantropy-manual-available")).toBeNull();
	});

	it("brings a second view to the same stored settings, and a closed one applies nothing", async () => {
		const shared = persistence();
		const a = harness(40, 100, shared);
		const b = harness(40, 100, shared);
		a.views.push(b.view);
		b.views.push(a.view);
		await a.open("猫と犬。\n".repeat(20));
		await b.open("鳥と病院。\n".repeat(20));

		expect(await a.view.changeDisplaySettings({ bodyFontSizePx: 22, showRuby: false })).toBe("applied");
		for (const view of [a.view, b.view]) {
			const element = pick<HTMLElement>(view, ".semantropy-body");
			expect(element.style.fontSize).toBe("22px");
			expect(element.classList.contains("is-ruby-hidden")).toBe(true);
		}

		await b.view.onClose();
		expect(await a.view.changeDisplaySettings({ bodyFontSizePx: 16 })).toBe("applied");
		expect(shared.store.getDisplaySettings().bodyFontSizePx).toBe(16);
		// The closed view applies nothing and the successful save still stands.
		expect(shell(b.view).querySelector(".semantropy-body")).toBeNull();
		expect(await b.view.applyStoredDisplaySettings()).toBeUndefined();

		// Re-opening reads the stored settings instead of the old display.
		await b.open("鳥と病院。\n".repeat(20));
		expect(pick<HTMLElement>(b.view, ".semantropy-body").style.fontSize).toBe("16px");
	});

	it("puts every display setting back with Reset without touching the draw mode", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		await h.view.changeDisplaySettings({
			bodyFontFamily: "serif", bodyFontSizePx: 24, bodyBackground: "#101214",
			bodyForeground: "#e8e6e3", showRuby: false, showManualMarkers: false,
		});
		h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: "frequency" });
		expect(await h.view.applyVocabulary()).toBe("applied");
		expect(h.shared.store.getDisplaySettings().vocabularyDrawMode).toBe("frequency");

		expect(await h.view.resetDisplaySettings()).toBe("applied");
		expect(h.shared.store.getDisplaySettings()).toEqual({
			...defaultSemantropyDisplaySettings(),
			vocabularyDrawMode: "frequency",
		});
		const bodyEl = pick<HTMLElement>(h.view, ".semantropy-body");
		expect([bodyEl.style.fontFamily, bodyEl.style.fontSize, bodyEl.style.backgroundColor]).toEqual(["", "", ""]);
	});
});

describe("TOOLBAR1 draw mode transaction", () => {
	it("stores a draw mode only when the Apply that used it commits", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const stored = () => h.shared.store.getDisplaySettings().vocabularyDrawMode;
		expect(stored()).toBe("uniform");

		// A draft alone changes neither the Snapshot nor the stored value.
		const snapshot = body(h.view).getVocabularySnapshot();
		h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: "frequency" });
		expect(stored()).toBe("uniform");
		expect(body(h.view).getVocabularySnapshot()).toBe(snapshot);

		h.view.cancelVocabulary();
		expect(stored()).toBe("uniform");
		expect(body(h.view).getVocabularySnapshot()).toBe(snapshot);

		h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: "frequency" });
		expect(await h.view.applyVocabulary()).toBe("applied");
		expect(stored()).toBe("frequency");
		expect(body(h.view).getVocabularySnapshot()!.drawMode).toBe("frequency");
	});

	it.each(["read", "save"] as const)(
		"never leaves a draw mode on disk for an Apply abandoned during the %s",
		async (stage) => {
			for (const abandon of ["close", "source-change", "cancel"] as const) {
				const h = harness(); await h.open("猫と犬と鳥。\n".repeat(20));
				const before = {
					snapshot: body(h.view).getVocabularySnapshot(), text: logical(h.view),
					revision: body(h.view).getDisplayRevision(), writes: h.shared.state.saves,
				};
				// "read" abandons while the Apply is still staging; "save" abandons
				// while the settings write itself is in flight — the only window in
				// which a write could outlive the Apply that asked for it.
				h.view.setVocabularyDraft({
					mode: stage === "read" ? "selected" : "current",
					paths: stage === "read" ? ["other.md"] : [],
					drawMode: "frequency",
				});

				const gate = deferred<void>();
				const entered = deferred<void>();
				if (stage === "read") {
					h.host.readCurrentText = () => {
						entered.resolve();
						return gate.promise.then(() => h.control.source);
					};
				} else {
					h.shared.state.gate = gate.promise;
					h.shared.state.entered = () => entered.resolve();
				}

				const pending = h.view.applyVocabulary();
				await entered.promise;
				if (abandon === "close") await h.view.onClose();
				else if (abandon === "source-change") h.view.notifyVocabularySourceEvent("fixture.md");
				else h.view.cancelVocabulary();
				gate.resolve();
				const outcome = await pending;
				await flush();
				h.shared.state.gate = null;
				h.shared.state.entered = null;

				const stored = h.shared.store.getDisplaySettings().vocabularyDrawMode;
				if (outcome === "applied") {
					// The commit happened before the abandonment, so the stored
					// mode may follow it; the two still describe the same Apply.
					expect(stored).toBe("frequency");
					if (!h.view.getVocabularyState().ready) continue;
					expect(body(h.view).getVocabularySnapshot()!.drawMode).toBe("frequency");
					continue;
				}
				// Abandoned before the commit: the body never changed, so the
				// disk must not have changed either.
				expect(stored).toBe("uniform");
				expect(h.shared.state.saves).toBe(before.writes);
				if (abandon !== "close") {
					expect(body(h.view).getVocabularySnapshot()).toBe(before.snapshot);
					expect(logical(h.view)).toBe(before.text);
					expect(body(h.view).getDisplayRevision()).toBe(before.revision);
				}
			}
		},
	);

	it("keeps the applied Snapshot and reports a draw-mode write that fails after the commit", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		const before = {
			snapshot: body(h.view).getVocabularySnapshot(), revision: body(h.view).getDisplayRevision(),
		};
		h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: "frequency" });
		h.shared.state.fail = true;

		// The commit already happened, so the body is what the reader asked for.
		expect(await h.view.applyVocabulary()).toBe("applied");
		expect(body(h.view).getVocabularySnapshot()).not.toBe(before.snapshot);
		expect(body(h.view).getVocabularySnapshot()!.drawMode).toBe("frequency");
		expect(body(h.view).getDisplayRevision()).not.toBe(before.revision);
		// The stored mode did not move, and the reader is told rather than
		// silently getting a different mode in the next session.
		expect(h.shared.store.getDisplaySettings().vocabularyDrawMode).toBe("uniform");
		// The message must describe the state that actually holds: the new
		// vocabulary is in use, only the stored draw mode did not move.
		expect(h.view.getVocabularyState().error).toBe(VOCABULARY_DRAW_MODE_SAVE_ERROR);
		expect(VOCABULARY_DRAW_MODE_SAVE_ERROR).toContain("in use for this session");
		expect(VOCABULARY_DRAW_MODE_SAVE_ERROR).not.toMatch(/previous vocabulary/i);

		h.shared.state.fail = false;
		expect(await h.view.applyVocabulary()).toBe("applied");
		expect(h.shared.store.getDisplaySettings().vocabularyDrawMode).toBe("frequency");
		expect(h.view.getVocabularyState().error).toBeNull();
	});

	it("seeds a new view's draft from the stored mode without re-reading a Source", async () => {
		const shared = persistence();
		await shared.store.load();
		await shared.store.setDisplaySettings({ vocabularyDrawMode: "frequency" });
		const h = harness(40, 100, shared);
		await h.open("猫と犬。\n".repeat(20));

		expect(h.view.getVocabularyState().draft.drawMode).toBe("frequency");
		expect(h.view.getVocabularyState().selection.mode).toBe("current");
		expect(h.view.getVocabularyState().selection.paths).toEqual([]);
		// Building the Toolbar re-reads nothing from the Vault.
		expect(h.calls.reads).toBe(0);
		peek(h.view).renderShell();
		expect(h.calls.reads).toBe(0);
	});
});

describe("TOOLBAR1 logical selection cache (UI-04)", () => {
	it("Copies and Collects a body selection after focus moves to the Toolbar", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		selectBody(h.view);
		const expected = logical(h.view);
		selectToolbar(h.view);

		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(await h.view.collectSelectedFragment()).toBe("created");
		expect(h.calls.copy).toEqual([expected]);
		expect(h.calls.collect).toEqual([expected]);
		expect(h.calls.notices).toContain(COLLECT_SAVED_MESSAGE);
	});

	it("never carries a reading, a Toolbar label or the Load control into the fragment", async () => {
		const h = harness(30); await h.open("猫《ねこ》と病院《びょういん》。\n" + "犬と鳥。\n".repeat(20));
		selectBody(h.view);
		selectToolbar(h.view);
		expect(await h.view.copySelectedFragment()).toBe("copied");

		const copied = h.calls.copy[0]!;
		expect(copied).toBe(logical(h.view));
		expect(copied).not.toMatch(/ねこ|びょういん|《|》/);
		expect(copied).not.toContain("Load next");
		expect(copied).not.toContain("Reshuffle");
		expect(copied).not.toContain("replacements:");
		expect(copied).not.toContain("Vocabulary");
	});

	it("refuses a reading-only selection rather than guessing a base", async () => {
		const h = harness(100); await h.open("猫《ねこ》と病院《びょういん》。\n");
		const reading = root(h.view).querySelector("rt")!;
		const selection = document.getSelection()!;
		const range = document.createRange();
		range.selectNodeContents(reading);
		selection.removeAllRanges();
		selection.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));

		expect(await h.view.copySelectedFragment()).toBe("empty");
		expect(h.calls.copy).toEqual([]);
		expect(peek(h.view).selection).toBeNull();
	});

	it("never uses another view's selection", async () => {
		const a = harness(); const b = harness();
		await a.open("猫と犬。\n".repeat(20));
		await b.open("鳥と病院。\n".repeat(20));
		selectBody(a.view);
		// b records nothing: the selection is not in b's body.
		document.dispatchEvent(new Event("selectionchange"));

		expect(await b.view.copySelectedFragment()).toBe("empty");
		expect(b.calls.copy).toEqual([]);
		expect(await a.view.copySelectedFragment()).toBe("copied");
		expect(a.calls.copy).toEqual([logical(a.view)]);
	});

	it.each(["reshuffle", "text", "refresh", "vocabulary"] as const)(
		"refuses a cache invalidated by %s and asks for a new selection",
		async (operation) => {
			const h = harness(); await h.open("猫と犬と鳥。\n".repeat(20));
			selectBody(h.view);
			selectToolbar(h.view);
			document.getSelection()!.removeAllRanges();

			if (operation === "reshuffle") expect(await h.view.reshuffle({ issueSeed: () => 31 })).toBe("applied");
			else if (operation === "text") expect(await h.view.setBodySemantropy(assertBodySemantropy(0))).toBe("applied");
			else if (operation === "refresh") expect(await h.view.refreshSource({ hashText: async text => sha256Hex(text) })).toBe("refreshed");
			else {
				h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: "frequency" });
				expect(await h.view.applyVocabulary()).toBe("applied");
			}

			expect(await h.view.copySelectedFragment()).toBe("empty");
			expect(await h.view.collectSelectedFragment()).toBe("empty");
			expect(h.calls.copy).toEqual([]);
			expect(h.calls.collect).toEqual([]);
			expect(h.calls.notices).toContain(SELECTION_INVALIDATED_MESSAGE);
			expect(SELECTION_INVALIDATED_MESSAGE).not.toMatch(/猫|犬|鳥|fixture/);
			expect(peek(h.view).selection).toBeNull();
		},
	);

	it("keeps the cache across a marker, colour or ruby change", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		selectBody(h.view);
		const expected = logical(h.view);
		selectToolbar(h.view);
		document.getSelection()!.removeAllRanges();

		await h.view.changeDisplaySettings({
			showDictionaryMarkers: false, showRuby: false,
			bodyBackground: "#101214", bodyFontSizePx: 18,
		});

		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(h.calls.copy).toEqual([expected]);
		expect(h.calls.notices).not.toContain(SELECTION_INVALIDATED_MESSAGE);
	});

	it("releases the cache and its listeners on close, and again after reopening", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		selectBody(h.view);
		const stale = root(h.view);
		await h.view.onClose();

		expect(peek(h.view).selection).toBeNull();
		expect(shell(h.view).childNodes).toHaveLength(0);
		// A late event on the old DOM must reach no listener and record nothing.
		document.dispatchEvent(new Event("selectionchange"));
		stale.dispatchEvent(new Event("pointerup", { bubbles: true }));
		expect(peek(h.view).selection).toBeNull();
		expect(await h.view.copySelectedFragment()).toBe("aborted");

		await h.open("鳥と病院。\n".repeat(20));
		selectBody(h.view);
		selectToolbar(h.view);
		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(h.calls.copy).toEqual([logical(h.view)]);
	});

	it("records a partial drag through the controller's own UTF-16 mapping", async () => {
		const h = harness(); await h.open("猫と犬と鳥。\n".repeat(20));
		const nodes = body(h.view).getTextNodes();
		const first = nodes[0]!, second = nodes[1] ?? nodes[0]!;
		const range = document.createRange();
		range.setStart(first, 1);
		range.setEnd(second, Math.min(2, second.length));
		const selection = document.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));

		const expected = body(h.view).readSelection({ rangeCount: 1, getRangeAt: () => range });
		expect(expected.status).toBe("selected");
		selectToolbar(h.view);
		document.getSelection()!.removeAllRanges();

		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(h.calls.copy).toEqual([expected.status === "selected" ? expected.text : ""]);
		// Whole-body and partial picks agree with the logical text.
		expect(logical(h.view)).toContain(h.calls.copy[0]!);
	});

	it("refuses a recorded interval whose text no longer matches, instead of guessing", async () => {
		const h = harness(30); await h.open("猫と犬と鳥。\n".repeat(40));
		selectBody(h.view);
		selectToolbar(h.view);
		document.getSelection()!.removeAllRanges();

		// A Chunk append keeps the loaded prefix, so the record stays usable.
		expect(await h.view.loadNextSection()).toBe("applied");
		const recorded = peek(h.view).selection as { snapshot: { text: string; end: number } };
		expect(await h.view.copySelectedFragment()).toBe("copied");

		// If the interval ever stopped covering the recorded string, nothing is
		// copied and nothing is searched for elsewhere.
		selectBody(h.view);
		const current = peek(h.view).selection as { snapshot: { text: string } };
		current.snapshot.text = `${recorded.snapshot.text}·`;
		document.getSelection()!.removeAllRanges();

		expect(await h.view.copySelectedFragment()).toBe("empty");
		expect(await h.view.collectSelectedFragment()).toBe("empty");
		expect(h.calls.copy).toHaveLength(1);
		expect(h.calls.collect).toEqual([]);
		expect(h.calls.notices).toContain(SELECTION_INVALIDATED_MESSAGE);
		expect(peek(h.view).selection).toBeNull();
	});

	it("clears the cache when the reader deselects inside the body", async () => {
		const h = harness(); await h.open("猫と犬。\n".repeat(20));
		selectBody(h.view);
		expect(peek(h.view).selection).not.toBeNull();

		const collapsed = document.createRange();
		const first = body(h.view).getTextNodes()[0]!;
		collapsed.setStart(first, 1);
		collapsed.collapse(true);
		document.getSelection()!.removeAllRanges();
		document.getSelection()!.addRange(collapsed);
		document.dispatchEvent(new Event("selectionchange"));

		expect(peek(h.view).selection).toBeNull();
		expect(await h.view.copySelectedFragment()).toBe("empty");
		expect(h.calls.copy).toEqual([]);
	});
});
