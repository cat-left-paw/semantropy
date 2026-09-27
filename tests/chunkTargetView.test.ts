import { sha256Hex } from "../src/vocabulary/sha256";
// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { WorkspaceLeaf } from "obsidian";
import { SemantropyView, type SemantropyViewHost } from "../src/view/SemantropyView";
import type { SemantropySession } from "../src/application/SemantropySession";
import { SemantropySettingsStore } from "../src/settings/SemantropySettingsStore";
import { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import { TargetBodyController } from "../src/render/targetBodyController";
import { buildTargetLineIndex, planTargetLineChunks } from "../src/analysis/targetChunkIr";
import * as chunkIr from "../src/analysis/targetChunkIr";
import * as display from "../src/render/targetBodyController";
import { vocabularyPoolKey } from "../src/transform/tokenPolicy";
import { transformTokenSequences } from "../src/transform/transformTokens";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { immediateScheduler, testScheduler } from "./support/testScheduler";
import { token } from "./tokenFixtures";
import { OFF, MAX, MEDIUM } from "./readyAnalysis";
import type { BodySemantropy } from "../src/settings/bodySemantropy";
import { DEFAULT_DICTIONARY_SEMANTROPY } from "../src/settings/dictionarySemantropy";
import { deferred } from "./refreshHarness";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: Window } };
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
const tokenize = (text: string) => Array.from(text, surface => token({ surface,
	...(/[\p{Script=Han}]/u.test(surface) ? {} : { pos: "記号", isUnknown: true }) }));
type Peek = { targetBody: ChunkTargetBodyController; session: SemantropySession; contentEl: HTMLElement };
const peek = (v: SemantropyView) => v as unknown as Peek;
const body = (v: SemantropyView) => peek(v).targetBody;
const text = (v: SemantropyView) => body(v).getTextNodes().map(t => t.data).join("");
const ready = (v: SemantropyView) => { const s = peek(v).session.getState(); if (s.status !== "ready") throw Error("Not ready"); return s; };
const selection = (root: Node) => { const range = document.createRange(); range.selectNodeContents(root); return { rangeCount: 1, getRangeAt: () => range }; };
function harness(target = 30, level: BodySemantropy = OFF) {
	const control = { source: "", level, failTokens: false, failRead: false, failSave: false,
		readGate: null as Promise<void> | null, tokenGate: null as Promise<void> | null,
		scheduler: immediateScheduler() };
	const calls = { tokenize: [] as string[], copy: [] as string[], collect: [] as string[], save: [] as number[] };
	const host: SemantropyViewHost = {
		targetChunkSize: target, getTokenizer: () => ({ tokenize: async input => {
			calls.tokenize.push(input); await control.tokenGate;
			if (control.failTokens) throw Error("secret body /absolute/path"); return tokenize(input);
		} }),
		readCurrentText: async () => { await control.readGate; if (control.failRead) throw Error("private"); return control.source; },
		getBodySemantropy: () => control.level,
		setBodySemantropy: async value => { calls.save.push(value); if (control.failSave) return false; control.level = value; return true; },
		getDictionarySemantropy: () => DEFAULT_DICTIONARY_SEMANTROPY, setDictionarySemantropy: async () => false,
		writeClipboard: async t => { calls.copy.push(t); }, collectFragment: async i => { calls.collect.push(i.text); return { status: "created" }; }, showNotice: () => undefined,
		scheduler: { now: () => control.scheduler.now(), yieldTask: () => control.scheduler.yieldTask(), paint: () => control.scheduler.paint() },
	};
	const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
	peek(view).contentEl = document.createElement("div"); document.body.append(peek(view).contentEl);
	const open = async (md: string, seed = 7) => {
		control.source = md;
		await view.onOpen();
		await view.openCapture({ kind: "markdown", note: { sourcePath: "fixture.md", sourceName: "fixture.md", editorText: md } },
			{ readCached: async () => md, hashText: async text => sha256Hex(text), issueSeed: () => seed });
	};
	return { view, control, calls, open };
}
async function loadAll(view: SemantropyView) { while (body(view).hasNext()) expect(await view.loadNextSection()).toBe("applied"); }

describe("CHUNK-01: first Chunk and independent Current Note vocabulary", () => {
	it.each([3000, 5000])("materializes one prefix at target %i, retaining no unloaded analysis", async target => {
		for (const size of [2000, 20000, 100000]) {
			const h = harness(target);
			const md = ("猫".repeat(99) + "\n").repeat(size / 100);
			const project = vi.spyOn(chunkIr, "projectTargetLineChunk"), build = vi.spyOn(display, "buildTargetDisplay");
			await h.open(md);
			expect(project).toHaveBeenCalledTimes(1); expect(build).toHaveBeenCalledTimes(1);
			expect(body(h.view).getChunkStats()).toMatchObject({ chunks: 1, materializedUtf16: Math.min(size, target) });
			const runtime = Reflect.get(body(h.view), "runtime") as { index: object; descriptors: object[]; chunks: object[] };
			const keys: string[] = [];
			const walk = (v: unknown) => { if (v && typeof v === "object") for (const [k, child] of Object.entries(v)) { keys.push(k); walk(child); } };
			walk(runtime.index); walk(runtime.descriptors);
			expect(keys).not.toContain("document");
			expect(keys.join(" ")).not.toMatch(/tokens|located|annotations|displayPlan|bindings|listener|selection|hover|override/);
			expect(runtime.chunks).toHaveLength(1);
			expect(peek(h.view).contentEl.querySelector<HTMLButtonElement>(".semantropy-load-next")!.hidden).toBe(size <= target);
			// Separate host document reproduces Obsidian's button display rule.
			const button = peek(h.view).contentEl.querySelector(".semantropy-load-next")!;
			const styled = new JSDOM(`<style>button {display:inline-flex;}\n${readFileSync("styles.css", "utf8")}</style>${button.outerHTML}`);
			expect(styled.window.getComputedStyle(styled.window.document.querySelector("button")!).display === "none").toBe(size <= target);
			styled.window.close();
			expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]); expect(h.calls.save).toEqual([]);
			project.mockRestore(); build.mockRestore(); await h.view.onClose();
		}
	});
	it("uses a candidate found only after the first Chunk, including its verified Ruby", async () => {
		const h = harness(3, MAX); await h.open("猫\n".repeat(20) + "犬《いぬ》");
		expect(text(h.view)).toBe("犬\n");
		expect(body(h.view).getContainer()!.querySelector("rt")!.textContent).toBe("いぬ");
		expect(ready(h.view).pool.get(vocabularyPoolKey(token({ surface: "猫" })))).toEqual(["猫", "犬"]);
	});
});

describe("CHUNK-02: complete presentation and logical seams", () => {
	it.each(["\n", "\r\n", "\r"])("replays all Chunks exactly at Off with %j", async newline => {
		for (const md of [
			["# 題", "", ...Array<string>(20).fill("猫《ねこ》と犬。😀か\u3099"), "", "最後。"].join(newline),
			["前。", "", "<img src=x", "alt=y>", "", ...Array<string>(20).fill("後続。`code`[[link]]$math$%%comment%%"), "", "~~~", "猫《内部》", "~~~"].join(newline),
			["前。", "", "《未閉鎖", ...Array<string>(20).fill("後続。")].join(newline),
			"猫".repeat(16000),
		]) {
			const h = harness(); await h.open(md); await loadAll(h.view);
			const oracle = new TargetBodyController();
			await oracle.open({ snapshot: { text: md, sourcePath: "fixture.md", contentHash: "hash" }, bodySeed: 7, bodySemantropy: OFF,
				getTokenizer: () => ({ tokenize: async t => tokenize(t) }), isCurrent: () => true, scheduler: immediateScheduler(), ownerDocument: document });
			expect(text(h.view)).toBe(oracle.getTextNodes().map(t => t.data).join(""));
			expect(body(h.view).getContainer()!.querySelectorAll("br")).toHaveLength(oracle.getContainer()!.querySelectorAll("br").length);
			expect(await h.view.copySelectedFragment({ selection: selection(body(h.view).getContainer()!) })).toBe("copied");
			expect(h.calls.copy[0]).toBe(text(h.view));
			oracle.release(); await h.view.onClose();
		}
	});
});

describe("CHUNK-03 / 04: atomic append and prefix generation", () => {
	it("appends one Chunk, preserving nodes, selection, scroll and existing generation results", async () => {
		const h = harness(30, MAX); await h.open("猫犬鳥魚。\n".repeat(50));
		const root = body(h.view).getContainer()!, old = root.firstChild!, picked = selection(old), original = body(h.view).readSelection(picked);
		const scroller = peek(h.view).contentEl.firstElementChild!; scroller.scrollTop = 79;
		const before = old.textContent, project = vi.spyOn(chunkIr, "projectTargetLineChunk"), build = vi.spyOn(display, "buildTargetDisplay");
		const gate = deferred<void>(); h.control.tokenGate = gate.promise;
		const pending = h.view.loadNextSection(); expect(await h.view.loadNextSection()).toBe("busy");
		expect(root.childNodes).toHaveLength(1); gate.resolve(); expect(await pending).toBe("applied");
		expect(root.childNodes).toHaveLength(2); expect(root.firstChild).toBe(old); expect(old.textContent).toBe(before);
		expect(body(h.view).readSelection(picked)).toEqual(original); expect(scroller.scrollTop).toBe(79);
		expect(project).toHaveBeenCalledTimes(1); expect(build).toHaveBeenCalledTimes(1);
		const state = ready(h.view), drawn = transformTokenSequences(state.tokenSequences, state.pool, state.bodySeed, state.bodySemantropy, true);
		expect(state.replacementCount).toBe(drawn.replacementCount);
		expect(await h.view.copySelectedFragment({ selection: selection(root) })).toBe("copied");
		expect(await h.view.collectSelectedFragment({ selection: selection(root) })).toBe("created");
		expect(h.calls.copy[0]).toBe(text(h.view)); expect(h.calls.collect).toEqual(h.calls.copy);
		expect(h.calls.copy[0]).not.toContain("Load next");
	});
	it.each(["builder", "tampered", "detached", "close", "open", "refresh"])("discards append on %s without partial publication", async failure => {
		const h = harness(20); await h.open("猫犬。\n".repeat(50));
		const root = body(h.view).getContainer()!, first = root.firstChild!, oldText = text(h.view);

		if (failure === "builder") vi.spyOn(display, "buildTargetDisplay").mockRejectedValueOnce(Error("secret"));
		let interrupt: Promise<unknown> | null = null;
		h.control.scheduler = testScheduler({ tickMs: 9, onYield: () => {
			if (failure === "tampered") root.setAttribute("data-outside", "1");
			if (failure === "detached") root.remove();
			if (failure === "close") interrupt ??= h.view.onClose();
			if (failure === "open") interrupt ??= h.view.openCapture({ kind: "none" }, { readCached: async () => "" });
			if (failure === "refresh") { h.control.scheduler = immediateScheduler(); interrupt ??= h.view.refreshSource({ hashText: async () => "new" }); }
		} }).scheduler;
		const result = await h.view.loadNextSection(); await Promise.resolve(interrupt);
		expect(["failed", "aborted"]).toContain(result);
		if (!["close", "open", "refresh"].includes(failure)) { expect(root.childNodes).toHaveLength(1); expect(root.firstChild).toBe(first); expect(text(h.view)).toBe(oldText); }
	});
	it.each(["false", "throw"])("refuses session %s without publishing any part of Load next", async failure => {
		const h = harness(20); await h.open("猫犬。\n".repeat(20));
		const controller = body(h.view), root = controller.getContainer()!, first = root.firstChild!;
		const picked = selection(first), selected = controller.readSelection(picked);
		const scroller = peek(h.view).contentEl.firstElementChild!; scroller.scrollTop = 79;
		const before = { state: ready(h.view), runtime: Reflect.get(controller, "runtime") as unknown,
			ticket: Reflect.get(controller, "ticket") as unknown, stats: controller.getChunkStats(), text: text(h.view) };
		const append = vi.spyOn(root, "appendChild");
		const publish = vi.spyOn(peek(h.view).session, "updateMaterializedAnalysis").mockImplementation(() => {
			if (failure === "throw") throw Error("rejected session commit");
			return false;
		});
		expect(["aborted", "failed"]).toContain(await h.view.loadNextSection());
		expect(publish).toHaveBeenCalledOnce(); expect(append).not.toHaveBeenCalled();
		expect(root.childNodes).toHaveLength(1); expect(root.firstChild).toBe(first);
		expect(Reflect.get(controller, "runtime")).toBe(before.runtime);
		expect(Reflect.get(controller, "ticket")).toBe(before.ticket);
		expect(controller.getChunkStats()).toEqual(before.stats); expect(ready(h.view)).toBe(before.state);
		expect(text(h.view)).toBe(before.text); expect(scroller.scrollTop).toBe(79);
		expect(controller.readSelection(picked)).toEqual(selected);
		publish.mockRestore();
		expect(await h.view.loadNextSection()).toBe("applied");
		expect(root.childNodes).toHaveLength(2); expect(append).toHaveBeenCalledOnce();
	});
	it.each(["before", "after"])("rolls back an append exception %s insertion without changing the committed prefix", async failure => {
		const h = harness(20, MAX); await h.open("猫犬。\n".repeat(20));
		const controller = body(h.view), root = controller.getContainer()!, first = root.firstChild!;
		const picked = selection(first), selected = controller.readSelection(picked);
		const nativeSelection = document.getSelection()!; nativeSelection.addRange(picked.getRangeAt());
		const scroller = peek(h.view).contentEl.firstElementChild!; scroller.scrollTop = 79;
		const before = { state: ready(h.view), runtime: Reflect.get(controller, "runtime") as unknown,
			ticket: Reflect.get(controller, "ticket") as unknown, stats: controller.getChunkStats(), text: text(h.view) };
		const insert = root.appendChild.bind(root);
		const append = vi.spyOn(root, "appendChild").mockImplementation(node => {
			if (failure === "after") insert(node);
			throw Error("injected append failure");
		});
		expect(await h.view.loadNextSection()).toBe("failed");
		expect(append).toHaveBeenCalledOnce(); expect(root.childNodes).toHaveLength(1); expect(root.firstChild).toBe(first);
		expect(ready(h.view)).toBe(before.state);
		expect(Reflect.get(controller, "runtime")).toBe(before.runtime);
		expect(Reflect.get(controller, "ticket")).toBe(before.ticket);
		expect(controller.getChunkStats()).toEqual(before.stats); expect(controller.isDisplayIntact()).toBe(true);
		expect(text(h.view)).toBe(before.text); expect(scroller.scrollTop).toBe(79);
		expect(controller.readSelection(picked)).toEqual(selected);
		expect(controller.readSelection(nativeSelection)).toEqual(selected);
		append.mockRestore();
		expect(await h.view.loadNextSection()).toBe("applied");
		expect(root.childNodes).toHaveLength(2); expect(root.firstChild).toBe(first);
		expect(controller.getChunkStats().chunks).toBe(2);
		expect(ready(h.view).tokenSequences).toEqual((Reflect.get(controller, "runtime") as { analysis: { tokenSequences: unknown } }).analysis.tokenSequences);
	});
	it("publishes append analysis in the same commit before loadNext resolves", async () => {
		const h = harness(20); await h.open("猫犬。\n".repeat(20));
		const controller = body(h.view), load = controller.loadNext.bind(controller);
		vi.spyOn(controller, "loadNext").mockImplementation(async input => {
			const result = await load(input);
			if (result.status === "applied") expect(ready(h.view).tokenSequences).toEqual(result.analysis.tokenSequences);
			return result;
		});
		expect(await h.view.loadNextSection()).toBe("applied");
	});
	it("commits a level and session together even when Open supersedes the persistence return", async () => {
		const h = harness(20, MAX); await h.open("猫犬。\n".repeat(20));
		const host = Reflect.get(h.view, "host") as SemantropyViewHost;
		host.commitBodySemantropy = async (value, commit) => {
			expect(commit()).toBe(true);
			expect(ready(h.view).bodySemantropy).toBe(value);
			await h.open("鳥魚。\n".repeat(20), 99);
			return "applied";
		};
		expect(await h.view.setBodySemantropy(OFF)).toBe("applied");
		expect(ready(h.view).bodySeed).toBe(99);
		expect(ready(h.view).bodySemantropy).toBe(MAX);
	});
	it("reshuffles only materialized Chunks; a second Chunk failure rolls back all displays", async () => {
		const h = harness(30, MEDIUM); await h.open("猫犬鳥魚。\n".repeat(60)); await h.view.loadNextSection();
		const root = body(h.view).getContainer()!, old = Array.from(root.childNodes), state = ready(h.view);
		const implementation = display.buildTargetDisplay;
		const project = vi.spyOn(chunkIr, "projectTargetLineChunk"), build = vi.spyOn(display, "buildTargetDisplay");
		build.mockImplementationOnce(implementation).mockRejectedValueOnce(Error("second Chunk failed"));
		const calls = h.calls.tokenize.length;
		expect(await h.view.reshuffle({ issueSeed: () => 18 })).toBe("failed");
		expect(Array.from(root.childNodes)).toEqual(old); expect(ready(h.view)).toBe(state);
		expect(h.calls.tokenize.length).toBe(calls); expect(project).not.toHaveBeenCalled();
		build.mockRestore();
		expect(await h.view.reshuffle({ issueSeed: () => 19 })).toBe("applied");
		expect(ready(h.view).bodySeed).toBe(19); expect(project).not.toHaveBeenCalled();
		const prefix = text(h.view); expect(await h.view.loadNextSection()).toBe("applied"); expect(text(h.view).startsWith(prefix)).toBe(true);
	});
	it("persists a new level only after preparing the materialized prefix and uses it on later loads", async () => {
		const h = harness(30, MAX); await h.open("猫犬鳥魚。\n".repeat(60)); await h.view.loadNextSection();
		const root = body(h.view).getContainer()!, old = Array.from(root.childNodes);
		h.control.failSave = true; expect(await h.view.setBodySemantropy(OFF)).toBe("failed");
		expect(Array.from(root.childNodes)).toEqual(old); expect(ready(h.view).bodySemantropy).toBe(MAX);
		h.control.failSave = false; const calls = h.calls.tokenize.length;
		expect(await h.view.setBodySemantropy(OFF)).toBe("applied"); expect(h.calls.tokenize.length).toBe(calls);
		expect(await h.view.loadNextSection()).toBe("applied"); expect(text(h.view)).toBe("猫犬鳥魚。\n".repeat(15));
	});
});

describe("CHUNK-05: staged Refresh", () => {
	it.each(["read", "tokens", "source-change", "close", "open"])("keeps the previous snapshot on %s failure or cancellation", async failure => {
		const h = harness(); await h.open("猫犬。\n".repeat(30)); await h.view.loadNextSection();
		const owner = body(h.view), root = owner.getContainer()!, nodes = Array.from(root.childNodes), previous = ready(h.view);
		const picked = selection(nodes[0]!), logicalSelection = owner.readSelection(picked);
		const gate = deferred<void>(); h.control.readGate = gate.promise;
		h.control.source = "鳥魚。\n".repeat(60);
		if (failure === "read") h.control.failRead = true;
		if (failure === "tokens") h.control.failTokens = true;
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const pending = h.view.refreshSource({ issueSeed: () => 88, hashText: async () => "new" });
		expect(body(h.view)).toBe(owner); expect(ready(h.view)).toBe(previous); expect(Array.from(root.childNodes)).toEqual(nodes);
		if (failure === "source-change") h.view.markSourceLost();
		if (failure === "close") await h.view.onClose();
		if (failure === "open") await h.view.openCapture({ kind: "none" }, { readCached: async () => "" });
		gate.resolve(); expect(["failed", "aborted"]).toContain(await pending);
		if (failure === "close" || failure === "open") return;
		expect(body(h.view)).toBe(owner); expect(ready(h.view).snapshot).toBe(previous.snapshot);
		expect(Array.from(root.childNodes)).toEqual(nodes); expect(owner.readSelection(picked)).toEqual(logicalSelection);
	});
	it("commits a new owner and first Chunk only on success, releasing the old state", async () => {
		const h = harness(); await h.open("猫犬。\n".repeat(30)); await h.view.loadNextSection();
		const old = body(h.view); h.control.source = "鳥魚。\n".repeat(50);
		expect(await h.view.refreshSource({ issueSeed: () => 89, hashText: async () => "new" })).toBe("refreshed");
		expect(body(h.view)).not.toBe(old); expect(body(h.view).getChunkStats().chunks).toBe(1);
		expect(old.getContainer()).toBeNull(); expect(Reflect.get(old, "runtime")).toBeNull();
		expect(ready(h.view).bodySeed).toBe(89); expect(ready(h.view).snapshot.text).toBe(h.control.source);
	});
});

describe("ownership and lifecycle", () => {
	it("refuses cloned or foreign descriptors even at the same revision", async () => {
		for (const kind of ["clone", "foreign"]) {
			const h = harness(); await h.open("猫犬。\n".repeat(50));
			const controller = body(h.view), runtime = Reflect.get(controller, "runtime") as { descriptors: chunkIr.TargetLineChunk[]; index: chunkIr.TargetLineIndex };
			const bad = kind === "clone" ? { ...runtime.descriptors[1]! } : planTargetLineChunks(buildTargetLineIndex(runtime.index.rawText, runtime.index.targetRevision), 30)[1]!;
			Reflect.set(controller, "runtime", { ...runtime, descriptors: [runtime.descriptors[0], bad] });
			expect(await h.view.loadNextSection()).toBe("failed"); expect(controller.getChunkStats().chunks).toBe(1);
		}
	});
	it("releases controller data, observer, bindings and controls on close and starts clean on reopen", async () => {
		const h = harness(); await h.open("猫犬。\n".repeat(40)); const controller = body(h.view);
		await h.view.onClose(); expect(controller.getTextNodes()).toEqual([]);
		for (const key of ["runtime", "root", "observer", "lastReport"]) expect(Reflect.get(controller, key)).toBeNull();
		expect(peek(h.view).contentEl.childNodes).toHaveLength(0);
		await h.open("猫犬。\n".repeat(40)); expect(body(h.view).getChunkStats().chunks).toBe(1);
	});
});


describe("CHUNK-VIEW1 settings save is authoritative", () => {
	async function withStore(failSave = false) {
		const h = harness(20, MAX), gate = deferred<void>(), started = deferred<void>();
		const writes: number[] = [];
		const store = new SemantropySettingsStore({ load: async () => ({ schemaVersion: 2, bodySemantropy: MAX }), save: async value => {
			writes.push(value.bodySemantropy); started.resolve(); await gate.promise;
			if (failSave) throw Error("save failed");
		} });
		await store.load();
		const host = Reflect.get(h.view, "host") as SemantropyViewHost;
		host.getBodySemantropy = () => store.getBodySemantropy();
		host.setBodySemantropy = value => store.setBodySemantropy(value);
		host.commitBodySemantropy = (value, commit) => store.commitBodySemantropy(value, commit);
		host.waitForPendingSettings = () => store.whenSettled();
		await h.open("猫犬。\n".repeat(30));
		return { ...h, store, gate, started, writes, host };
	}
	it.each(["open", "refresh"])("%s waits for a pending save and re-reads the effective level", async operation => {
		const h = await withStore(); const before = ready(h.view);
		const level = h.view.setBodySemantropy(OFF); await h.started.promise;
		const tokens = h.calls.tokenize.length;
		let completed = false;
		const next = (operation === "open" ? h.view.openCapture({ kind: "markdown", note: { sourcePath: "next.md", sourceName: "next", editorText: "鳥魚。\n".repeat(30) } },
			{ readCached: async () => "", hashText: async () => "next" }) : h.view.refreshSource({ hashText: async () => "next" }))
			.then(result => { completed = true; return result; });
		await Promise.resolve(); expect(completed).toBe(false); expect(h.calls.tokenize.length).toBe(tokens);
		expect(h.store.getBodySemantropy()).toBe(MAX);
		h.gate.resolve();
		expect(await level).toBe(operation === "open" ? "aborted" : "applied"); await next;
		expect(ready(h.view).snapshot).not.toBe(before.snapshot);
		expect(ready(h.view).bodySemantropy).toBe(OFF); expect(h.store.getBodySemantropy()).toBe(OFF);
		expect(h.writes).toEqual([OFF]); expect(body(h.view).getChunkStats().chunks).toBe(1);
	});
	it.each(["success", "failure"])("close is immediate during save %s; next Open uses the committed setting", async outcome => {
		const h = await withStore(outcome === "failure"), controller = body(h.view);
		const level = h.view.setBodySemantropy(OFF); await h.started.promise;
		await h.view.onClose(); expect(controller.getContainer()).toBeNull();
		expect(peek(h.view).session.getState().status).toBe("empty");
		h.gate.resolve(); expect(await level).toBe(outcome === "success" ? "aborted" : "failed");
		expect(h.store.getBodySemantropy()).toBe(outcome === "success" ? OFF : MAX);
		expect(controller.getContainer()).toBeNull(); expect(h.writes).toEqual([OFF]);
		await h.open("鳥魚。\n".repeat(30));
		expect(ready(h.view).bodySemantropy).toBe(h.store.getBodySemantropy());
	});
	it("save failure alone retains the current nodes, session and effective setting", async () => {
		const h = await withStore(true), state = ready(h.view), root = body(h.view).getContainer()!, nodes = Array.from(root.childNodes);
		const level = h.view.setBodySemantropy(OFF); await h.started.promise; h.gate.resolve();
		expect(await level).toBe("failed"); expect(ready(h.view)).toBe(state);
		expect(Array.from(root.childNodes)).toEqual(nodes); expect(h.store.getBodySemantropy()).toBe(MAX); expect(h.writes).toEqual([OFF]);
	});
	it.each(["open", "refresh"])("%s waits for a save from another View's shared store", async operation => {
		const h = await withStore();
		const pending = h.store.commitBodySemantropy(OFF, () => false); await h.started.promise;
		let done = false;
		const next = (operation === "open" ? h.open("鳥魚。\n".repeat(30)) : h.view.refreshSource({ hashText: async () => "fresh" }))
			.then(() => { done = true; });
		await Promise.resolve(); expect(done).toBe(false); h.gate.resolve();
		expect(await pending).toBe("stale"); await next;
		expect(ready(h.view).bodySemantropy).toBe(OFF); expect(h.writes).toEqual([OFF]);
	});
	it("Refresh waiting for another save performs no source read or commit after close", async () => {
		const h = await withStore(), saved = h.store.commitBodySemantropy(OFF, () => false); await h.started.promise;
		const read = vi.spyOn(h.host, "readCurrentText");
		const pending = h.view.refreshSource(); await h.view.onClose();
		h.gate.resolve(); await saved; expect(await pending).toBe("aborted");
		expect(read).not.toHaveBeenCalled(); expect(body(h.view).getContainer()).toBeNull();
		expect(peek(h.view).session.getState().status).toBe("empty");
	});
	it("an Open waiting for settings cannot commit after close", async () => {
		const h = await withStore(), saved = h.store.commitBodySemantropy(OFF, () => false); await h.started.promise;
		const pending = h.view.openCapture({ kind: "markdown", note: { sourcePath: "next.md", sourceName: "next", editorText: "鳥魚" } }, { readCached: async () => "" });
		await h.view.onClose(); h.gate.resolve(); await saved; await pending;
		expect(body(h.view).getContainer()).toBeNull(); expect(peek(h.view).session.getState().status).toBe("empty");
		expect(h.store.getBodySemantropy()).toBe(OFF);
	});
});
