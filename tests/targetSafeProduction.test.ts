import { sha256Hex } from "../src/vocabulary/sha256";
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownRenderer } from "obsidian";
import { NO_SUPPORTED_TEXT_MESSAGE, RESHUFFLE_ERROR_MESSAGE, RESHUFFLING_MESSAGE } from "../src/application/reshuffleNote";
import { BODY_LEVEL_UPDATING_MESSAGE } from "../src/application/changeBodySemantropy";
import type { SemantropySession } from "../src/application/SemantropySession";
import type { CollectFragmentInputV4 as CollectFragmentInput } from "../src/collect/v4/CollectedFragmentV4";
import type { CooperativeScheduler } from "../src/render/cooperativeScheduler";
import { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import { TargetBodyController, type TargetPhaseReport } from "../src/render/targetBodyController";
import { assertBodySemantropy, type BodySemantropy } from "../src/settings/bodySemantropy";
import { DEFAULT_DICTIONARY_SEMANTROPY } from "../src/settings/dictionarySemantropy";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { SemantropyView, type SemantropyViewHost } from "../src/view/SemantropyView";
import { denseRubyNovel, NOVEL_NOUNS, unsafeTargetFixtures } from "./fixtures/targetSafeFixtures";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { immediateScheduler, testScheduler } from "./support/testScheduler";
import { token } from "./tokenFixtures";
import { MAX, MEDIUM, OFF } from "./readyAnalysis";

const SOURCE_PATH = "notes/synthetic.md";
const WORDS = [...new Set([...NOVEL_NOUNS.map(([base]) => base), "漢字", "言葉", "東京", "都", "走る", "歩く"])]
	.sort((a, b) => b.length - a.length);
const VERIFIED_PAIRS = new Set(NOVEL_NOUNS.map(([base, reading]) => `${base}/${reading}`));

function novelTokenizer() {
	const calls: string[] = [];
	return {
		calls,
		tokenize: async (text: string): Promise<JapaneseToken[]> => {
			calls.push(text);
			const tokens: JapaneseToken[] = [];
			for (let i = 0; i < text.length;) {
				const word = WORDS.find((w) => text.startsWith(w, i));
				const surface = word ?? String.fromCodePoint(text.codePointAt(i)!);
				tokens.push(token({ surface, reading: "NOT-A-DISPLAY-READING", ...(word ? {} : { pos: "記号", isUnknown: true }) }));
				i += surface.length;
			}
			return tokens;
		},
	};
}

type Peek = {
	session: SemantropySession;
	targetBody: TargetBodyController;
	contentEl: HTMLElement;
};
const peek = (view: SemantropyView) => view as unknown as Peek;

function createView(options: { level?: BodySemantropy } = {}) {
	const tokenizer = novelTokenizer();
	const scheduler: { current: CooperativeScheduler } = { current: immediateScheduler() };
	const calls = { clipboard: [] as string[], collect: [] as CollectFragmentInput[], persist: [] as number[], reads: [] as string[], notices: [] as string[] };
	const source = { text: "" };
	let level = options.level ?? MEDIUM;
	const host: SemantropyViewHost = {
		getTokenizer: () => tokenizer,
		readCurrentText: async (path) => {
			calls.reads.push(path);
			return source.text;
		},
		getBodySemantropy: () => level,
		setBodySemantropy: async (value) => {
			calls.persist.push(value);
			level = value;
			return true;
		},
		getDictionarySemantropy: () => DEFAULT_DICTIONARY_SEMANTROPY,
		setDictionarySemantropy: async () => false,
		collectFragment: async (input) => {
			calls.collect.push(input);
			return { status: "created" };
		},
		writeClipboard: async (text) => {
			calls.clipboard.push(text);
		},
		showNotice: (message) => calls.notices.push(message),
		scheduler: {
			now: () => scheduler.current.now(),
			yieldTask: () => scheduler.current.yieldTask(),
			paint: () => scheduler.current.paint(),
		},
	};
	const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
	(view as unknown as { app: App }).app = {} as App;
	const contentEl = document.createElement("div");
	document.body.appendChild(contentEl);
	peek(view).contentEl = contentEl;
	return { view, tokenizer, scheduler, calls, source };
}

async function openNote(view: SemantropyView, text: string, seed = 7, sourcePath = SOURCE_PATH): Promise<void> {
	await view.onOpen();
	await view.openCapture(
		{ kind: "markdown", note: { sourcePath, sourceName: "synthetic.md", editorText: text } },
		{ readCached: async () => { throw new Error("no cached read expected"); }, hashText: async t => sha256Hex(t), issueSeed: () => seed },
	);
}

const root = (view: SemantropyView) => peek(view).targetBody.getContainer()!;
const logical = (view: SemantropyView) => peek(view).targetBody.getTextNodes().map((node) => node.data).join("");
const message = (view: SemantropyView) => peek(view).contentEl.querySelector(".semantropy-message")?.textContent ?? "";
const button = (view: SemantropyView, name: string) => peek(view).contentEl.querySelector<HTMLButtonElement>(`.semantropy-${name}`)!;
const levelSelect = (view: SemantropyView) => peek(view).contentEl.querySelector<HTMLSelectElement>(".semantropy-level-select")!;
const ready = (view: SemantropyView) => {
	const state = peek(view).session.getState();
	if (state.status !== "ready") throw new Error("expected a ready session");
	return state;
};
const rubyPairs = (element: Element) => Array.from(element.querySelectorAll("ruby"), (ruby) => {
	const base = Array.from(ruby.childNodes).filter((node) => node.nodeName !== "RT").map((node) => node.textContent).join("");
	return `${base}/${ruby.querySelector("rt")?.textContent ?? ""}`;
});
const wholeBody = (view: SemantropyView) => {
	const range = document.createRange();
	range.selectNodeContents(root(view));
	return { rangeCount: 1, getRangeAt: () => range };
};

let restoreDom: () => void;
const originalRender = MarkdownRenderer.render.bind(MarkdownRenderer);
const renderTrap = vi.fn(async () => { throw new Error("MarkdownRenderer must not be reached"); });
beforeAll(() => {
	restoreDom = installObsidianDomHelpers();
	MarkdownRenderer.render = renderTrap;
});
afterAll(() => {
	restoreDom();
	MarkdownRenderer.render = originalRender;
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
});

describe("production Target Open", () => {
	it("builds the body from the note string without MarkdownRenderer", async () => {
		const { view, calls } = createView();
		await openNote(view, "# 題名\n\n漢字《かんじ》と言葉《ことば》\n\n**猫**と犬");
		expect(peek(view).session.getState().status).toBe("ready");
		expect(renderTrap).not.toHaveBeenCalled();
		expect(root(view).querySelector("h1")?.textContent).toBe("題名");
		expect(root(view).querySelectorAll("ruby")).toHaveLength(2);
		expect(calls.reads).toEqual([]);
		expect(document.querySelector(".markdown-preview-view")).toBeNull();
	});

	it("gives the loading shell a frame before the first tokenize", async () => {
		const { view, tokenizer, scheduler } = createView();
		const seen: { message: string; tokenized: number }[] = [];
		scheduler.current = testScheduler({ onPaint: () => { seen.push({ message: message(view), tokenized: tokenizer.calls.length }); } }).scheduler;
		await openNote(view, "漢字《かんじ》と言葉");
		expect(seen[0]).toEqual({ message: "Analyzing…", tokenized: 0 });
	});

	it("yields while analyzing a long note and never publishes a superseded Open", async () => {
		const { view, tokenizer, scheduler } = createView({ level: OFF });
		const long = denseRubyNovel();
		const pending: { second: Promise<void> | null } = { second: null };
		const bodies: (Element | null)[] = [];
		scheduler.current = testScheduler({ tickMs: 1, onYield: () => {
			bodies.push(peek(view).contentEl.querySelector(".semantropy-body"));
			pending.second ??= view.openCapture({ kind: "markdown", note: { sourcePath: "notes/other.md", sourceName: "other.md", editorText: "猫と犬" } },
				{ readCached: async () => "", hashText: async () => "other", issueSeed: () => 9 });
		} }).scheduler;
		await openNote(view, long);
		await pending.second;
		expect(bodies[0]).toBeNull();
		expect(ready(view).snapshot.sourcePath).toBe("notes/other.md");
		expect(logical(view)).toBe("猫と犬");
		// The superseded analysis stopped early instead of tokenizing the whole note.
		expect(tokenizer.calls.length).toBeLessThan(long.split("\n\n").length);
	});

	it.each(unsafeTargetFixtures)("shows resource-bearing input inertly with no request, read, write or renderer: %s", async (md) => {
		const trap = vi.fn(() => { throw new Error("Forbidden capability"); });
		for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "Image", "Audio", "DOMParser", "Worker", "EventSource"]) vi.stubGlobal(name, trap);
		const { view, calls } = createView({ level: MAX });
		await openNote(view, md);
		expect(ready(view).replaceableSlotCount).toBe(0);
		for (const element of Array.from(root(view).querySelectorAll("*"))) {
			expect(element.attributes).toHaveLength(0);
			expect(["div", "p", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "span", "em", "strong", "del", "code", "br", "ruby", "rt"]).toContain(element.localName);
		}
		expect(await view.reshuffle()).toBe("unavailable");
		expect(trap).not.toHaveBeenCalled();
		expect(renderTrap).not.toHaveBeenCalled();
		expect(calls).toEqual({ clipboard: [], collect: [], persist: [], reads: [], notices: [] });
	});

	it("reports counts and timings only, separating the first tokenize", async () => {
		const { view } = createView();
		const reports: TargetPhaseReport[] = [];
		view.phaseRecorder = (report) => reports.push(report);
		await openNote(view, "漢字《かんじ》と言葉《ことば》の" + "猫と犬。".repeat(20));
		expect(await view.reshuffle({ issueSeed: () => 31 })).toBe("applied");
		expect(reports.map((r) => r.operation)).toEqual(["open", "transform"]);
		expect(reports[0]!.firstTokenizeMs).not.toBeNull();
		expect(Object.keys(reports[0]!.phases).sort()).toEqual(
			["commit", "domBuild", "paintAfterCommit", "presentationPlan", "projection", "surfaceTransform", "tokenize", "vocabulary"]);
		const serialized = JSON.stringify(reports);
		expect(serialized).not.toMatch(/[぀-ヿ一-鿿]/u);
		expect(serialized).not.toContain(SOURCE_PATH);
	});
});

describe("responsive Reshuffle", () => {
	it("shows Reshuffling… and disables competing actions before any heavy work", async () => {
		const { view, scheduler } = createView();
		await openNote(view, denseRubyNovel(3_000));
		const before = { text: logical(view), seed: ready(view).bodySeed };
		const transform = vi.spyOn(peek(view).targetBody, "transform");
		let release!: () => void;
		scheduler.current = testScheduler({ onPaint: () => new Promise<void>((resolve) => { release = resolve; }) }).scheduler;
		const pending = view.reshuffle({ issueSeed: () => 4242 });
		expect(message(view)).toBe(RESHUFFLING_MESSAGE);
		expect([button(view, "reshuffle").disabled, button(view, "copy").disabled, button(view, "collect").disabled, levelSelect(view).disabled]).toEqual([true, true, true, true]);
		// Refresh supersedes a Reshuffle instead of competing with it.
		expect(button(view, "refresh").disabled).toBe(false);
		expect(transform).not.toHaveBeenCalled();
		expect(logical(view)).toBe(before.text);
		release();
		expect(await pending).toBe("applied");
		expect(transform).toHaveBeenCalledOnce();
		expect(message(view)).toBe("");
		expect(button(view, "reshuffle").disabled).toBe(false);
		expect(ready(view).bodySeed).toBe(4242);
	});

	it("prepares a 23,000-character Ruby-dense body in many slices while the old body stays on screen", async () => {
		const { view, tokenizer, scheduler } = createView();
		const text = denseRubyNovel();
		expect(text.length).toBeGreaterThanOrEqual(23_000);
		await openNote(view, text);
		// Keep the original 23k stress assertion over the fully materialized prefix.
		while (await view.loadNextSection() === "applied") { /* Explicitly load every Chunk. */ }
		const before = { text: logical(view), seed: ready(view).bodySeed, count: ready(view).replacementCount, root: root(view).firstChild };
		const tokenized = tokenizer.calls.length;
		const during: boolean[] = [];
		const slices = testScheduler({ tickMs: 1, onYield: () => {
			during.push(logical(view) === before.text && ready(view).bodySeed === before.seed && root(view).firstChild === before.root && message(view) === RESHUFFLING_MESSAGE);
		} });
		scheduler.current = slices.scheduler;
		const reports: TargetPhaseReport[] = [];
		view.phaseRecorder = (report) => reports.push(report);
		expect(await view.reshuffle({ issueSeed: () => 99 })).toBe("applied");
		expect(slices.record.yields).toBeGreaterThanOrEqual(5);
		expect(during.length).toBe(slices.record.yields);
		expect(during.every(Boolean)).toBe(true);
		expect(reports[0]!.yields).toBe(slices.record.yields);
		expect(reports[0]!.annotations).toBeGreaterThan(1_000);
		expect(logical(view)).not.toBe(before.text);
		expect(tokenizer.calls.length).toBe(tokenized);
		// Every displayed pair is a verified Source pair; no reading is borrowed.
		expect(rubyPairs(root(view)).every((pair) => VERIFIED_PAIRS.has(pair))).toBe(true);
		expect(root(view).textContent).not.toContain("NOT-A-DISPLAY-READING");
	});

	it.each([
		["close", (view: SemantropyView): Promise<unknown> => view.onClose()],
		["Refresh", (view: SemantropyView): Promise<unknown> => view.refreshSource({ issueSeed: () => 777, hashText: async () => "refreshed" })],
		["a newer Open", (view: SemantropyView): Promise<unknown> => view.openCapture(
			{ kind: "markdown", note: { sourcePath: "notes/other.md", sourceName: "other.md", editorText: "猫と犬" } },
			{ readCached: async () => "", hashText: async () => "other", issueSeed: () => 555 })],
	] as const)("stops at the next yield after %s and never commits the old ticket", async (label, interrupt) => {
		const { view, scheduler, source } = createView();
		source.text = denseRubyNovel(6_000);
		await openNote(view, source.text);
		const pending: { followUp: Promise<unknown> | null } = { followUp: null };
		scheduler.current = testScheduler({ tickMs: 1, onYield: () => { pending.followUp ??= interrupt(view); } }).scheduler;
		expect(await view.reshuffle({ issueSeed: () => 4242 })).toBe("aborted");
		expect(pending.followUp).not.toBeNull();
		await pending.followUp;
		const state = peek(view).session.getState();
		if (label === "close") {
			expect(state.status).toBe("empty");
			expect(peek(view).targetBody.getContainer()).toBeNull();
			expect(peek(view).contentEl.childNodes).toHaveLength(0);
			return;
		}
		const [text, seed] = label === "Refresh" ? [source.text, 777] : ["猫と犬", 555];
		expect(ready(view).bodySeed).toBe(seed);
		expect(message(view)).not.toBe(RESHUFFLING_MESSAGE);
		// What is on screen is exactly the superseding body, with nothing from the reshuffle.
		expect(root(view).innerHTML).toBe(await freshBody(text, seed, MEDIUM));
	});

	it("keeps the old body, Seed and count when preparation fails, and settles the status", async () => {
		const { view, calls } = createView();
		await openNote(view, "漢字《かんじ》と言葉《ことば》と猫と犬");
		const before = { seed: ready(view).bodySeed, count: ready(view).replacementCount };
		// Something outside Semantropy edits the committed body.
		const first = peek(view).targetBody.getTextNodes()[0]!;
		first.data = "外部";
		expect(await view.reshuffle({ issueSeed: () => 12 })).toBe("failed");
		expect(message(view)).toBe(RESHUFFLE_ERROR_MESSAGE);
		expect(button(view, "reshuffle").disabled).toBe(false);
		expect([ready(view).bodySeed, ready(view).replacementCount]).toEqual([before.seed, before.count]);
		// An altered body is never read as a selection either.
		expect(await view.copySelectedFragment({ selection: wholeBody(view) })).toBe("empty");
		expect(calls.clipboard).toEqual([]);
	});

	it("never re-tokenizes across Reshuffles and matches a fresh Open at the same Seed", async () => {
		const { view, tokenizer } = createView();
		const text = denseRubyNovel(4_000);
		await openNote(view, text);
		const tokenized = tokenizer.calls.length;
		for (const seed of [11, 12, 13, 14, 15]) expect(await view.reshuffle({ issueSeed: () => seed })).toBe("applied");
		expect(tokenizer.calls.length).toBe(tokenized);
		const fresh = new ChunkTargetBodyController();
		const opened = await fresh.open({
			snapshot: { text, sourcePath: SOURCE_PATH, contentHash: `hash:${text.length}` }, bodySeed: 15, bodySemantropy: MEDIUM,
			getTokenizer: () => novelTokenizer(), isCurrent: () => true, scheduler: immediateScheduler(), ownerDocument: document,
		});
		expect(opened.status).toBe("applied");
		expect(opened.status === "applied" && opened.analysis.replacementCount).toBe(ready(view).replacementCount);
		expect(root(view).innerHTML).toBe(fresh.getContainer()!.innerHTML);
		fresh.release();
	});
});

describe("responsive Text level change", () => {
	it("keeps the old body while preparing, shows Updating text…, and keeps Refresh blocked", async () => {
		const { view, scheduler, calls } = createView();
		await openNote(view, denseRubyNovel(6_000));
		const before = logical(view);
		const during: string[] = [];
		let refresh: string | null = null;
		scheduler.current = testScheduler({ tickMs: 1, onYield: async () => {
			during.push(`${logical(view) === before}:${message(view)}:${button(view, "refresh").disabled}`);
			refresh ??= await view.refreshSource();
		} }).scheduler;
		expect(await view.setBodySemantropy(MAX)).toBe("applied");
		expect(new Set(during)).toEqual(new Set([`true:${BODY_LEVEL_UPDATING_MESSAGE}:true`]));
		expect(refresh).toBe("busy");
		expect(calls.persist).toEqual([MAX]);
		expect(ready(view).bodySemantropy).toBe(MAX);
		expect(logical(view)).not.toBe(before);
	});
});

async function freshBody(text: string, seed: number, level: BodySemantropy): Promise<string> {
	const fresh = new ChunkTargetBodyController();
	const opened = await fresh.open({
		snapshot: { text, sourcePath: SOURCE_PATH, contentHash: "fresh" }, bodySeed: seed, bodySemantropy: level,
		getTokenizer: () => novelTokenizer(), isCurrent: () => true, scheduler: immediateScheduler(), ownerDocument: document,
	});
	if (opened.status !== "applied") throw new Error(`open failed: ${opened.status}`);
	const html = fresh.getContainer()!.innerHTML;
	fresh.release();
	return html;
}

async function controllerFor(md: string, tokenizer = novelTokenizer()) {
	const controller = new TargetBodyController();
	const opened = await controller.open({
		snapshot: { text: md, sourcePath: SOURCE_PATH, contentHash: "hash" }, bodySeed: 1, bodySemantropy: OFF,
		getTokenizer: () => tokenizer, isCurrent: () => true, scheduler: immediateScheduler(), ownerDocument: document,
	});
	if (opened.status !== "applied") throw new Error(`open failed: ${opened.status}`);
	document.body.append(controller.getContainer()!);
	const apply = async (seed: number, level: BodySemantropy, edit?: (surfaces: string[][]) => void) => {
		const result = controller.transform(seed, level);
		const surfaces = result.tokenSurfaces!.map((run) => [...run]);
		edit?.(surfaces);
		const prepared = await controller.prepare(controller.getBodyGeneration(),
			{ ...result, tokenSurfaces: surfaces, texts: surfaces.map((run) => run.join("")) }, { isCurrent: () => true, scheduler: immediateScheduler() });
		if (prepared.status !== "prepared") throw new Error(`prepare ${prepared.status}`);
		return prepared.commit();
	};
	return { controller, apply, text: () => controller.getTextNodes().map((node) => node.data).join("") };
}

describe("Ruby pairs, provenance and UTF-16 in the production controller", () => {
	it("transplants verified pairs, shows plain candidates plainly, and restores at Off", async () => {
		for (const md of ["漢字《かんじ》と言葉《ことば》", "漢字《かんじ》と言葉"]) {
			const { controller, apply, text } = await controllerFor(md);
			const original = controller.getContainer()!.innerHTML;
			expect(await apply(1, MAX)).toBe("applied");
			expect(text()).toBe("言葉と漢字");
			const first = controller.getContainer()!.querySelector("span")!;
			expect(first.firstChild?.nodeName === "RUBY").toBe(md.endsWith("》"));
			expect(rubyPairs(controller.getContainer()!)).toEqual(md.endsWith("》") ? ["言葉/ことば", "漢字/かんじ"] : ["漢字/かんじ"]);
			expect(controller.getContainer()!.textContent).not.toContain("NOT-A-DISPLAY-READING");
			expect(await apply(1, OFF)).toBe("applied");
			expect(controller.getContainer()!.innerHTML).toBe(original);
			controller.release();
		}
	});

	it("drops a multi-token annotation on partial replacement and never transplants into it", async () => {
		const { controller, apply, text } = await controllerFor("｜東京都《とうきょうと》と言葉《ことば》");
		expect(await apply(1, OFF, (surfaces) => { surfaces[0]![0] = "言葉"; })).toBe("applied");
		expect(text()).toBe("言葉都と言葉");
		expect(rubyPairs(controller.getContainer()!)).toEqual(["言葉/ことば"]);
		expect(await apply(1, OFF)).toBe("applied");
		expect(rubyPairs(controller.getContainer()!)).toEqual(["東京都/とうきょうと", "言葉/ことば"]);
	});

	it("keeps NFC-equal display forms apart: composed plain vs decomposed verified pair", async () => {
		const tokenizer = { tokenize: async (text: string) => [token({ surface: text, baseForm: text.normalize("NFC"), reading: "same-NFC-identity" })] };
		const { controller, apply } = await controllerFor("猫\n\n<ruby>か\u3099<rt>が</rt></ruby>\n\nが", tokenizer as never);
		for (const surface of ["か\u3099", "が"]) {
			expect(await apply(1, OFF, (surfaces) => { surfaces[0]![0] = surface; })).toBe("applied");
			const first = controller.getContainer()!.querySelector("p")!;
			expect(first.querySelectorAll("ruby")).toHaveLength(surface.length === 2 ? 1 : 0);
			expect(Array.from(first.childNodes[0]!.childNodes, (n) => n.nodeName === "RUBY" ? n.firstChild!.textContent : n.textContent).join("")).toBe(surface);
		}
	});

	it("splits one replacement across inline decoration without duplicating or losing UTF-16 units", async () => {
		const { controller, apply } = await controllerFor("😀漢**字**と言葉🐈\n\n走《はし》ると歩《ある》く");
		const surfaces = controller.transform(1, MAX).tokenSurfaces![0]!;
		expect(surfaces[1]).not.toBe("漢字");
		expect(await apply(1, MAX)).toBe("applied");
		const first = controller.getContainer()!.querySelector("p")!;
		// Logical text (readings excluded) is exactly the drawn surfaces; a transplanted
		// verified pair such as 走《はし》る may add a reading beside it.
		expect(controller.getTextNodes().map((node) => node.data).join("").split("\n\n")[0]).toBe(surfaces.join(""));
		// 漢 stays outside and 字 inside strong: the replacement keeps that split.
		expect(first.querySelector("strong")?.textContent).toBe(surfaces[1]!.slice(1));
		for (const pair of rubyPairs(controller.getContainer()!)) expect(["走/はし", "歩/ある"]).toContain(pair);
	});

	it("never commits a released, superseded or replayed preparation", async () => {
		const { controller } = await controllerFor("漢字《かんじ》と言葉《ことば》");
		const options = { isCurrent: () => true, scheduler: immediateScheduler() };
		const before = controller.getContainer()!.innerHTML;
		const first = await controller.prepare(controller.getBodyGeneration(), controller.transform(1, MAX), options);
		const second = await controller.prepare(controller.getBodyGeneration(), controller.transform(2, MAX), options);
		expect(first.status === "prepared" && first.commit()).toBe("stale");
		expect(controller.getContainer()!.innerHTML).toBe(before);
		expect(second.status === "prepared" && second.commit()).toBe("applied");
		expect(second.status === "prepared" && second.commit()).toBe("stale");
		const late = await controller.prepare(controller.getBodyGeneration(), controller.transform(3, MAX), options);
		controller.release();
		expect(late.status === "prepared" && late.commit()).toBe("stale");
		expect(controller.getContainer()).toBeNull();
	});
});

describe("committed selection, Copy and Collect", () => {
	it("copies and collects logical text only: no reading, no placeholder UI, explicit writes only", async () => {
		const { view, calls } = createView({ level: OFF });
		await openNote(view, "漢字《かんじ》![x](https://semantropy.invalid/x)言葉");
		expect(root(view).textContent).toContain("[Image / embed omitted]");
		expect(calls.clipboard).toEqual([]);
		expect(await view.copySelectedFragment({ selection: wholeBody(view) })).toBe("copied");
		expect(await view.collectSelectedFragment({ selection: wholeBody(view) })).toBe("created");
		expect(calls.clipboard).toEqual(["漢字言葉"]);
		expect(calls.collect.map((input) => input.text)).toEqual(["漢字言葉"]);
		expect(ready(view).snapshot.text).toBe("漢字《かんじ》![x](https://semantropy.invalid/x)言葉");
		for (const selector of ["rt", "p > span:nth-child(2)"]) {
			const range = document.createRange();
			range.selectNodeContents(root(view).querySelector(selector)!);
			expect(await view.copySelectedFragment({ selection: { rangeCount: 1, getRangeAt: () => range } })).toBe("empty");
		}
		expect(calls.clipboard).toHaveLength(1);
	});

	it("refuses a Range taken from the body a Reshuffle replaced", async () => {
		const { view, calls } = createView();
		await openNote(view, "漢字《かんじ》と言葉《ことば》と猫と犬");
		const old = wholeBody(view);
		expect(await view.reshuffle({ issueSeed: () => 5 })).toBe("applied");
		expect(await view.copySelectedFragment({ selection: old })).toBe("empty");
		expect(await view.copySelectedFragment({ selection: wholeBody(view) })).toBe("copied");
		expect(calls.clipboard).toHaveLength(1);
	});
});

describe("theme independence", () => {
	it("generates no inline style or attribute in the body, and the stylesheet uses theme variables only", async () => {
		const { view } = createView({ level: MAX });
		await openNote(view, "# 題\n\n漢字《かんじ》と`code`と言葉\n\n```\n保護\n```");
		expect(await view.reshuffle({ issueSeed: () => 3 })).toBe("applied");
		for (const element of Array.from(root(view).querySelectorAll("*"))) {
   if (element.classList.contains("semantropy-token")) {
    expect(Array.from(element.attributes).map(a => a.name)).toEqual(["class"]);
    // EXPERIENCE-TOKEN-UI1 adds the two fixed operability classes; still no attribute or token metadata.
    for (const name of Array.from(element.classList)) expect(["semantropy-token", "semantropy-replaced", "semantropy-manual-available", "semantropy-dictionary-available",
     "semantropy-manual-operable", "semantropy-dictionary-operable"]).toContain(name);
   } else expect(element.attributes).toHaveLength(0);
  }
		const css = readFileSync("styles.css", "utf8");
		expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|:\s*(?:white|black)\b/iu);
		expect(assertBodySemantropy(100)).toBe(MAX);
	});
});

describe("production Target around local unsupported notation", () => {
	const note = "※［＃「木＋合」、第3水準1-1-1］《よみこ》";
	const md = `---\ntitle: x\n---\n漢字《かんじ》と言葉《ことば》。\n猫は${note}を見た。\n犬と東京。`;

	it("transforms around an external-character note with Ruby, Restore, Copy and Collect intact and no implicit write", async () => {
		const trap = vi.fn(() => { throw new Error("Forbidden capability"); });
		for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "Image", "Audio"]) vi.stubGlobal(name, trap);
		const { view, calls, tokenizer } = createView({ level: MAX });
		await openNote(view, md);
		const opened = ready(view);
		expect(opened.tokenSequences.length).toBeGreaterThanOrEqual(4);
		expect(opened.algorithmVersion).toBe(11);
		expect(opened.replaceableSlotCount).toBeGreaterThan(0);
		expect(root(view).textContent).toContain(note);
		expect(tokenizer.calls.join("|")).not.toMatch(/よみこ|木＋合|水準/u);
		expect(await view.reshuffle({ issueSeed: () => 21 })).toBe("applied");
		expect(rubyPairs(root(view)).every((pair) => VERIFIED_PAIRS.has(pair))).toBe(true);
		expect(root(view).textContent).toContain(note);
		expect(await view.setBodySemantropy(OFF)).toBe("applied");
		// Off restores the source annotations in source order.
		expect(rubyPairs(root(view))).toEqual(["漢字/かんじ", "言葉/ことば"]);
		expect(logical(view)).toContain("漢字と言葉。");
		expect(calls.clipboard).toEqual([]);
		expect(calls.collect).toEqual([]);
		expect(await view.copySelectedFragment({ selection: wholeBody(view) })).toBe("copied");
		expect(await view.collectSelectedFragment({ selection: wholeBody(view) })).toBe("created");
		expect(calls.clipboard[0]).not.toMatch(/かんじ|ことば/u);
		expect(calls.collect[0]?.text).toBe(calls.clipboard[0]);
		expect(calls.collect[0]?.type === "body" && calls.collect[0].algorithmVersion).toBe(11);
		expect(calls.persist).toEqual([OFF]);
		expect(calls.reads).toEqual([]);
		expect(ready(view).snapshot.text).toBe(md);
		expect(trap).not.toHaveBeenCalled();
		expect(renderTrap).not.toHaveBeenCalled();
	});

	it("is deterministic at algorithm version 4 for the same snapshot, projection, Seed and level", async () => {
		const bodies: string[] = [];
		for (let run = 0; run < 2; run += 1) {
			const { view } = createView({ level: MAX });
			await openNote(view, md, 5);
			expect(await view.reshuffle({ issueSeed: () => 99 })).toBe("applied");
			const state = ready(view);
			bodies.push(JSON.stringify([root(view).innerHTML, state.bodySeed, state.replacementCount, state.algorithmVersion]));
		}
		expect(bodies[0]).toBe(bodies[1]);
		expect(bodies[0]).toContain(",99,");
	});

	it("says a note with nothing analyzable has no supported text, not too few nouns", async () => {
		const { view } = createView();
		await openNote(view, "---\ntitle: x\n---\n```\n猫と犬\n```");
		expect(ready(view).tokenSequences).toHaveLength(0);
		expect(message(view)).toBe(NO_SUPPORTED_TEXT_MESSAGE);
		expect(Array.from(root(view).querySelectorAll("pre"), (pre) => pre.textContent).join("")).toContain("猫と犬");
	});
});
