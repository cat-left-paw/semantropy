import { sha256Hex } from "../src/vocabulary/sha256";
// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { SemantropyView, type SemantropyViewHost } from "../src/view/SemantropyView";
import { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import type { SemantropySession } from "../src/application/SemantropySession";
import { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import type { DisplaySlot } from "../src/analysis/displaySlots";
import * as slotsCore from "../src/analysis/displaySlots";
import * as transformCore from "../src/vocabulary/vocabularySnapshot";
import * as presentation from "../src/render/targetBodyController";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { immediateScheduler, testScheduler } from "./support/testScheduler";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
type Peek = { session: SemantropySession; targetBody: ChunkTargetBodyController; dictionaryWorld: FakeDictionaryWorld; contentEl: HTMLElement };
const peek = (view: SemantropyView) => view as unknown as Peek;
const body = (v: SemantropyView) => peek(v).targetBody;
const root = (v: SemantropyView) => body(v).getContainer()!;
const plan = (v: SemantropyView) => body(v).getDisplaySlotPlan()!;
const logical = (v: SemantropyView) => body(v).getTextNodes().map(n => n.data).join("");
const rangeSelection = (range: Range) => ({ rangeCount: 1, getRangeAt: () => range });
const whole = (node: Node) => { const r = document.createRange(); r.selectNodeContents(node); return rangeSelection(r); };
const elements = (v: SemantropyView) => Array.from(root(v).querySelectorAll<HTMLElement>(".semantropy-token"));
const parts = (v: SemantropyView, slot: DisplaySlot) => elements(v).filter(el => body(v).getSlotForElement(el)?.tokenId === slot.tokenId);
function pickSlot(v: SemantropyView, slot: DisplaySlot) {
 const p = parts(v, slot), r = document.createRange();
 r.setStart(p[0]!.firstChild!, 0); r.setEnd(p.at(-1)!.lastChild!, p.at(-1)!.lastChild!.textContent!.length);
 return rangeSelection(r);
}
const words = new Map([['猫ちゃん', 'ネコチャン'], ['東京都', 'トウキョウト'], ['病院', 'ビョウイン'], ['東京', 'トウキョウ'], ['猫', 'ネコ'], ['犬', 'イヌ'], ['鳥', 'トリ']]);
function tokenize(text: string) {
 const out = [];
 for (let i = 0; i < text.length;) {
  const word = [...words.keys()].find(w => text.startsWith(w, i));
  const surface = word ?? String.fromCodePoint(text.codePointAt(i)!);
  out.push(token({ surface, baseForm: surface, reading: word ? words.get(word) : undefined,
   ...(word ? {} : { pos: "助詞", detail1: "格助詞" }) }));
  i += surface.length;
 }
 return out;
}
function harness(size = 40, level = 100) {
 const state = { source: "", body: assertBodySemantropy(level), dictionary: assertDictionarySemantropy(50), scheduler: immediateScheduler(), failSave: false, failTokens: false };
 const calls = { tokens: [] as string[], read: 0, copy: [] as string[], collect: [] as string[], saves: [] as number[] };
 const host: SemantropyViewHost = {
  targetChunkSize: size, getTokenizer: () => ({ tokenize: async text => { calls.tokens.push(text); if (state.failTokens) throw Error("PRIVATE"); return tokenize(text); } }),
  readCurrentText: async () => { calls.read++; return state.source; }, getBodySemantropy: () => state.body,
  setBodySemantropy: async value => { if (state.failSave) return false; state.body = value; return true; },
  getDictionarySemantropy: () => state.dictionary, setDictionarySemantropy: async value => { calls.saves.push(value); if (state.failSave) return false; state.dictionary = value; return true; },
  writeClipboard: async text => { calls.copy.push(text); }, collectFragment: async input => { calls.collect.push(input.text); return { status: "created" }; }, showNotice: () => undefined,
  scheduler: { now: () => state.scheduler.now(), yieldTask: () => state.scheduler.yieldTask(), paint: () => state.scheduler.paint() },
 };
 const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
 peek(view).contentEl = document.createElement("div"); document.body.append(peek(view).contentEl);
 const reopen = async (text: string) => { state.source = text; await view.openCapture({ kind: "markdown", note: { sourcePath: "fixture.md", sourceName: "fixture.md", editorText: text } }, { readCached: async () => text, hashText: async text => sha256Hex(text), issueSeed: () => 7 }); };
 const open = async (text: string) => { await view.onOpen(); await reopen(text); };
 return { view, state, host, calls, open, reopen };
}
function capture(v: SemantropyView) {
 const controller = body(v), r = root(v), nodes = Array.from(r.childNodes), state = peek(v).session.getState(), slots = plan(v);
 const runtime: unknown = Reflect.get(controller, "runtime"), ticket: unknown = Reflect.get(controller, "ticket");
 const selected = document.getSelection()!, first = body(v).getTextNodes()[0]!;
 selected.setBaseAndExtent(first, first.length, first, 0);
 const text = logical(v), read = body(v).readSelection(selected), scroller = peek(v).contentEl;
 scroller.scrollTop = 73;
 return () => {
  expect(body(v)).toBe(controller); expect(root(v)).toBe(r); expect(Array.from(r.childNodes)).toEqual(nodes);
  expect(plan(v)).toBe(slots); expect(peek(v).session.getState()).toBe(state);
  expect(Reflect.get(controller, "runtime")).toBe(runtime); expect(Reflect.get(controller, "ticket")).toBe(ticket);
  expect(logical(v)).toBe(text); expect(controller.readSelection(selected)).toEqual(read);
  expect(selected.anchorNode).toBe(first); expect(selected.anchorOffset).toBe(first.length); expect(selected.focusOffset).toBe(0);
  expect(scroller.scrollTop).toBe(73); expect(controller.isDisplayIntact()).toBe(true);
 };
}

describe("TOKENS1 production slot identity and rendering", () => {
 it("runs automatic transform once per plan and independently marks replacement, Manual and Dictionary", async () => {
  const draw = vi.spyOn(transformCore, "transformWithVocabularySnapshot"), planning = vi.spyOn(slotsCore, "planAutomaticDisplaySlots");
  const h = harness(); await h.open("猫と犬。\n".repeat(40));
  expect(draw).toHaveBeenCalledTimes(1); expect(planning).toHaveBeenCalledTimes(1);
  expect(plan(h.view).runs.flatMap(r => r.slots)).toEqual(plan(h.view).slots);
  const marked = elements(h.view); expect(marked.length).toBeGreaterThan(0);
  for (const el of marked) {
   const slot = body(h.view).getSlotForElement(el)!;
   expect(el.classList.contains("semantropy-replaced")).toBe(slot.automaticReplaced);
   expect(el.classList.contains("semantropy-manual-available")).toBe(slot.manualAvailable);
   expect(el.classList.contains("semantropy-dictionary-available")).toBe(slot.dictionaryAvailable);
   // EXPERIENCE-TOKEN-UI1: what the word offers, independent of which markers are shown.
   expect(el.classList.contains("semantropy-manual-operable")).toBe(slot.manualEligible);
   expect(el.classList.contains("semantropy-dictionary-operable")).toBe(slot.dictionaryAvailable);
   expect(Array.from(el.attributes).map(a => a.name)).toEqual(["class"]);
   expect(el.tabIndex).toBe(-1);
  }
  expect(marked.some(el => ["semantropy-replaced", "semantropy-manual-available", "semantropy-dictionary-available"].every(name => el.classList.contains(name)))).toBe(true);
  expect(root(h.view).querySelectorAll("[data-token-id],[aria-hidden],rt .semantropy-token,rp .semantropy-token")).toHaveLength(0);
  await h.view.reshuffle({ issueSeed: () => 9 }); expect(draw).toHaveBeenCalledTimes(2);
 });
 it("merges unmarked particles, whitespace, symbols and surrogate pairs into plain Text", async () => {
  const h = harness(); await h.open("猫と😀は、 犬。\n");
  expect(body(h.view).getTextNodes().some(n => n.data === "と😀は、 ")).toBe(true);
  expect(plan(h.view).slots.find(s => s.originalToken.surface === "😀")!.originalRange).toEqual({ start: 2, end: 4 });
  expect(elements(h.view).every(el => ["猫", "犬"].includes(el.textContent))).toBe(true);
  expect(body(h.view).readSelection(whole(root(h.view)))).toEqual({ status: "selected", text: logical(h.view) });
 });
 it("keeps repeated occurrences distinct after a length-changing substitution", async () => {
  const h = harness(30); await h.open("猫 猫 犬\n病院 東京都\n".repeat(10));
  const cats = plan(h.view).slots.filter(s => s.originalToken.surface === "猫"); expect(cats.length).toBeGreaterThan(1);
  expect(new Set(cats.map(s => s.tokenId)).size).toBe(cats.length);
  for (const slot of plan(h.view).slots.filter(s => s.manualAvailable)) {
   const p = parts(h.view, slot); expect(p.map(n => n.textContent).join("")).toBe(slot.displaySurface);
   expect(body(h.view).readSelectedSlot(pickSlot(h.view, slot))).toBe(slot);
  }
  expect(parts(h.view, cats[0]!)[0]).not.toBe(parts(h.view, cats[1]!)[0]);
 });
 it("projects an inline-decorated word into multiple parts with a single token identity", async () => {
  const h = harness(100); await h.open("東**京**都と病院。\n");
  const slot = plan(h.view).slots.find(s => s.originalToken.surface === "東京都")!;
  expect(parts(h.view, slot).length).toBeGreaterThan(1);
  expect(parts(h.view, slot).map(el => el.textContent).join("")).toBe(slot.displaySurface);
  expect(body(h.view).readSelectedSlot(pickSlot(h.view, slot))).toBe(slot);
  expect(root(h.view).querySelector("strong .semantropy-token")).not.toBeNull();
 });
 it("uses the displayed candidate's morphology without tokenize, and retains arbitrary selection fallback", async () => {
  const h = harness(3); await h.open("猫\n病院《びょういん》\n");
  const slot = plan(h.view).slots.find(s => s.originalToken.surface === "猫")!;
  expect(slot.displaySurface).toBe("病院"); expect(slot.dictionary).toMatchObject({ outcome: "accepted", headword: { surface: "病院", identity: { baseForm: "病院", reading: "ビョウイン" } } });
  const before = h.calls.tokens.length;
  expect(await h.view.defineSelectedWord({ selection: pickSlot(h.view, slot), issueSeed: () => 2 })).toBe("ready");
  expect(h.calls.tokens).toHaveLength(before);
  expect(peek(h.view).dictionaryWorld.getCurrent()!.headword).toEqual(slot.dictionary.outcome === "accepted" ? slot.dictionary.headword : null);
  const partial = pickSlot(h.view, slot).getRangeAt(); partial.setEnd(partial.startContainer, 1);
  expect(body(h.view).readSelectedSlot(rangeSelection(partial))).toBeNull();
  await h.view.defineSelectedWord({ selection: rangeSelection(partial) }); expect(h.calls.tokens).toHaveLength(before + 1);
 });
 it("ignores rt/rp endpoints and carries only verified Ruby base through Copy/Collect", async () => {
  const h = harness(100); await h.open("猫《ねこ》と病院《びょういん》。\n");
  const reading = root(h.view).querySelector("rt")!;
  expect(body(h.view).readSelectedSlot(whole(reading))).toBeNull();
  expect(await h.view.copySelectedFragment({ selection: whole(root(h.view)) })).toBe("copied");
  expect(await h.view.collectSelectedFragment({ selection: whole(root(h.view)) })).toBe("created");
  expect(h.calls.copy).toEqual([logical(h.view)]); expect(h.calls.collect).toEqual(h.calls.copy);
  expect(h.calls.copy[0]).not.toMatch(/ねこ|びょういん|《|》/);
  expect(h.calls.tokens.join(" ")).not.toMatch(/ねこ|びょういん|《|》/);
 });
 it("invalidates a multi-token Ruby on partial replacement and restores it at automatic Off", async () => {
  // Partial application: Body 11 level 25 applies what Body 10 applied at 50.
  const h = harness(100, 25); await h.open("｜猫犬《まとめ》と鳥《とり》。");
  for (let seed = 1; seed < 60; seed++) {
   await h.view.reshuffle({ issueSeed: () => seed === 7 ? 70 : seed });
   const annotated = plan(h.view).slots.filter(s => s.rubyAnnotationIds.length && ["猫", "犬"].includes(s.originalToken.surface));
   if (annotated.filter(s => s.automaticReplaced).length === 1) break;
  }
  const annotated = plan(h.view).slots.filter(s => ["猫", "犬"].includes(s.originalToken.surface));
  expect(annotated.filter(s => s.automaticReplaced)).toHaveLength(1);
  expect(root(h.view).textContent).not.toContain("まとめ");
  expect(await h.view.setBodySemantropy(assertBodySemantropy(0))).toBe("applied");
  expect(Array.from(root(h.view).querySelectorAll("rt")).map(n => n.textContent)).toEqual(["まとめ", "とり"]);
 });
 it("projects a verified Ruby base and its suffix to the same slot", async () => {
  const h = harness(2); await h.open("犬\n猫《ねこ》ちゃん\n");
  const slot = plan(h.view).slots[0]!;
  expect(slot.displaySurface).toBe("猫ちゃん"); expect(slot.displayRuby!.baseRangeInSurface).toEqual({ start: 0, end: 1 });
  expect(root(h.view).querySelector("ruby .semantropy-token")!.textContent).toBe("猫");
  expect(parts(h.view, slot).map(el => el.textContent)).toEqual(["猫", "ちゃん"]);
  expect(body(h.view).readSelectedSlot(pickSlot(h.view, slot))).toBe(slot);
 });

 it("keeps protected text inert with no slots, markers, listeners or implicit output", async () => {
  const h = harness(1000); await h.open("猫と犬。\n\n`病院` [病院](url) $病院$ %%病院%% ![[病院]]\n\n<img src='https://invalid/x'>\n");
  expect(plan(h.view).slots.some(s => s.originalToken.surface === "病院")).toBe(false);
  expect(root(h.view).querySelector("code .semantropy-token,img,a,input,script")).toBeNull();
  expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]); expect(h.calls.saves).toEqual([]);
 });
});

describe("MANUAL-NOUN1 local override integration", () => {
	const structure = (v: SemantropyView, slot: DisplaySlot): string => {
		const runtime = Reflect.get(body(v), "runtime") as { chunks: { dom: { elements: Map<HTMLElement, string> } }[] };
		const owned = runtime.chunks.flatMap(chunk => [...chunk.dom.elements].filter(([, id]) => id === slot.tokenId).map(([element]) => element));
		const boundary = owned.find(element => owned.some(other => other !== element && element.contains(other))) ?? owned[0]!;
		const depth = (node: Element): number => 1 + Math.max(0, ...Array.from(node.children).map(depth));
		return `${boundary.querySelectorAll("*").length + 1}/${depth(boundary)}`;
	};
 it("rebuilds only the changed paragraph, advances on Shuffle, and keeps logical slot identity", async () => {
  const h = harness(100); await h.open("東**京**都と病院。猫と犬。\n\n鳥と病院。\n");
  const controller = body(h.view), beforePlan = plan(h.view);
  const target = beforePlan.slots.find(slot => slot.manualAvailable)!;
  const originalTarget = parts(h.view, target)[0]!;
  const changedParagraph = originalTarget.closest("p")!;
  const untouchedParagraph = Array.from(root(h.view).querySelectorAll("p")).find(p => p !== changedParagraph)!;
  const untouchedNodes = Array.from(untouchedParagraph.querySelectorAll<HTMLElement>(".semantropy-token"));
  const otherText = controller.getTextNodes().find(node => changedParagraph.contains(node) && !originalTarget.contains(node) && node.length > 0)!;
  const selection = document.getSelection()!; selection.setBaseAndExtent(otherText, 0, otherText, 1);
  const selectedBefore = controller.readLogicalSelection(selection);
  const tokenCalls = h.calls.tokens.length, revision = controller.getDisplayRevision();
  const original = target.displaySurface;

  expect(controller.shuffleManual(target)).toBe("applied");
  const shuffled = plan(h.view).slots.find(slot => slot.tokenId === target.tokenId)!;
  expect(shuffled.displaySurface).not.toBe(original);
  expect(shuffled.manualOverride).toMatchObject({ kind: "replacement", localRevision: 1 });
  expect(controller.getDisplayRevision()).toBe(revision + 1);
  expect(controller.getManualOverrideCount()).toBe(1);
  expect(h.calls.tokens).toHaveLength(tokenCalls);
  expect(changedParagraph.isConnected).toBe(false);
  expect(untouchedParagraph.isConnected).toBe(true);
  expect(untouchedNodes.every(element => element.isConnected && controller.getSlotForElement(element) !== null)).toBe(true);
  expect(plan(h.view).slots.every(slot => slot.manualEligible ? parts(h.view, slot).length > 0 : true)).toBe(true);
  expect(controller.readLogicalSelection(selection)).toEqual(selectedBefore);

  expect(controller.restoreManual(shuffled)).toBe("applied");
  const restored = plan(h.view).slots.find(slot => slot.tokenId === target.tokenId)!;
  expect(restored.displaySurface).toBe(restored.originalToken.surface);
  expect(restored.manualOverride).toMatchObject({ kind: "restore-original", localRevision: 1 });
  expect(controller.useAutomatic(restored)).toBe("applied");
  expect(plan(h.view).slots.find(slot => slot.tokenId === target.tokenId)!.manualOverride).toBeNull();
  expect(controller.getManualOverrideCount()).toBe(0);
 });

 it("rebuilds a long Ruby and hard-break paragraph on repeated Shuffle and Restore without replacing its sibling", async () => {
  const h = harness(5000, 0);
  await h.open(`${Array.from({ length: 30 }, () => "｜猫《ねこ》と犬。").join("\n")}\n\n鳥と病院。`);
  const controller = body(h.view), id = plan(h.view).slots.find(slot => slot.manualAvailable)!.tokenId;
  const paragraph = parts(h.view, controller.getDisplaySlot(id)!)[0]!.closest("p")!;
  const sibling = Array.from(root(h.view).querySelectorAll("p")).find(p => p !== paragraph)!;
  expect(paragraph.querySelectorAll("br")).toHaveLength(29);
  expect(paragraph.querySelectorAll("ruby")).toHaveLength(30);
  const calls = h.calls.tokens.length;
  let previous = paragraph;
  for (let i = 0; i < 5; i++) for (const action of ["shuffleManual", "restoreManual", "shuffleManual"] as const) {
   expect(controller[action](controller.getDisplaySlot(id)!)).toBe("applied");
   const current = parts(h.view, controller.getDisplaySlot(id)!)[0]!.closest("p")!;
   expect(current).not.toBe(previous);
   expect(previous.isConnected).toBe(false);
   expect(current.querySelectorAll("br")).toHaveLength(29);
   expect(current.querySelectorAll("ruby").length).toBeGreaterThanOrEqual(29);
   expect(sibling.isConnected).toBe(true);
   previous = current;
  }
  expect(h.calls.tokens).toHaveLength(calls);
 });

 it("keeps overrides for Text changes and clears them only after a successful Reshuffle", async () => {
  const h = harness(40, 0); await h.open("猫と犬と病院。\n");
  let slot = plan(h.view).slots.find(item => item.manualAvailable)!;
  expect(body(h.view).shuffleManual(slot)).toBe("applied");
  const manualSurface = plan(h.view).slots.find(item => item.tokenId === slot.tokenId)!.displaySurface;
  expect(await h.view.setBodySemantropy(assertBodySemantropy(100))).toBe("applied");
  slot = plan(h.view).slots.find(item => item.tokenId === slot.tokenId)!;
  expect(slot.displaySurface).toBe(manualSurface);
  expect(slot.manualOverride).not.toBeNull();
  expect(await h.view.reshuffle({ issueSeed: () => 991 })).toBe("applied");
  expect(body(h.view).getManualOverrideCount()).toBe(0);
  expect(plan(h.view).slots.every(item => item.manualOverride === null)).toBe(true);
 });

 it("copies and defines the current manual candidate rather than stale automatic text", async () => {
  const h = harness(40, 0); await h.open("猫と犬と病院。\n");
  const slot = plan(h.view).slots.find(item => item.manualAvailable)!;
  expect(body(h.view).shuffleManual(slot)).toBe("applied");
  const current = plan(h.view).slots.find(item => item.tokenId === slot.tokenId)!;
  expect(await h.view.copySelectedFragment({ selection: pickSlot(h.view, current) })).toBe("copied");
  expect(h.calls.copy.at(-1)).toBe(current.displaySurface);
  const tokenCalls = h.calls.tokens.length;
  expect(await h.view.defineSelectedWord({ selection: pickSlot(h.view, current), issueSeed: () => 3 })).toBe("ready");
  expect(h.calls.tokens).toHaveLength(tokenCalls);
  expect(peek(h.view).dictionaryWorld.getCurrent()!.headword.surface).toBe(current.displaySurface);
 });

	it("invalidates a related multi-token Ruby and restores it only with the original surface", async () => {
  const h = harness(100, 0); await h.open("｜猫犬《まとめ》と鳥。\n");
  let slot = plan(h.view).slots.find(item => item.originalToken.surface === "猫")!;
  expect(body(h.view).shuffleManual(slot)).toBe("applied");
  expect(Array.from(root(h.view).querySelectorAll("rt")).map(node => node.textContent)).not.toContain("まとめ");
  slot = plan(h.view).slots.find(item => item.tokenId === slot.tokenId)!;
  expect(body(h.view).restoreManual(slot)).toBe("applied");
		expect(Array.from(root(h.view).querySelectorAll("rt")).map(node => node.textContent)).toContain("まとめ");
	});

	it.each([["猫", "犬"], ["犬", "猫"]])("keeps a shared Ruby range exact across %s then %s Manual changes", async (first, second) => {
		const h = harness(200, 0); await h.open("｜猫犬《まとめ》と鳥と病院。");
		const controller = body(h.view), baselineHtml = root(h.view).innerHTML;
		const baselineSlots = plan(h.view).slots.map(({ displayRevision: _revision, ...slot }) => slot);
		const depth = (node: Element): number => 1 + Math.max(0, ...Array.from(node.children).map(depth));
		const baselineShape = `${root(h.view).querySelectorAll("*").length}/${depth(root(h.view))}`;
		const current = (surface: string) => plan(h.view).slots.find(slot => slot.originalToken.surface === surface)!;
		const exact = async () => {
			const expected = plan(h.view).runs.map(run => run.slots.map(slot => slot.displaySurface).join("")).join("");
			const clone = root(h.view).cloneNode(true) as HTMLElement; clone.querySelectorAll("rt,rp").forEach(node => node.remove());
			expect(logical(h.view)).toBe(expected); expect(clone.textContent).toBe(expected);
			expect(await h.view.copySelectedFragment({ selection: whole(root(h.view)) })).toBe("copied");
			expect(await h.view.collectSelectedFragment({ selection: whole(root(h.view)) })).toBe("created");
			expect(h.calls.copy.at(-1)).toBe(expected); expect(h.calls.collect.at(-1)).toBe(expected); expect(expected).not.toContain("まとめ");
		};

		expect(controller.shuffleManual(current(first))).toBe("applied"); await exact();
		expect(controller.shuffleManual(current(second))).toBe("applied"); await exact();
		expect(controller.restoreManual(current(first))).toBe("applied"); await exact();
		expect(controller.useAutomatic(current(second))).toBe("applied"); await exact();
		expect(controller.shuffleManual(current(second))).toBe("applied"); await exact();
		expect(controller.restoreManual(current(second))).toBe("applied"); await exact();
		expect(controller.shuffleManual(current(first))).toBe("applied"); await exact();
		expect(controller.clearManual()).toBe("applied");
		expect(root(h.view).innerHTML).toBe(baselineHtml); expect(`${root(h.view).querySelectorAll("*").length}/${depth(root(h.view))}`).toBe(baselineShape);
		expect(plan(h.view).slots.map(({ displayRevision: _revision, ...slot }) => slot)).toEqual(baselineSlots);
		expect(logical(h.view)).toBe("猫犬と鳥と病院。"); expect(controller.getManualOverrideCount()).toBe(0);
	});

	it.each([
		["Ruby", "猫《ねこ》と犬《いぬ》と鳥《とり》と病院《びょういん》。", "猫"],
		["multiple inline parts", "東**京**都と病院と猫と犬と鳥。", "東京都"],
	])("keeps the %s boundary element count and depth constant across 100 Shuffles", async (_kind, source, surface) => {
		const h = harness(200, 0); await h.open(source);
		let slot = plan(h.view).slots.find(item => item.originalToken.surface === surface)!;
		const shapes = new Set<string>();
		for (let i = 0; i < 100; i += 1) {
			expect(body(h.view).shuffleManual(slot)).toBe("applied");
			slot = plan(h.view).slots.find(item => item.tokenId === slot.tokenId)!;
			expect(body(h.view).restoreManual(slot)).toBe("applied");
			slot = plan(h.view).slots.find(item => item.tokenId === slot.tokenId)!;
			shapes.add(structure(h.view, slot));
		}
		expect(shapes.size).toBe(1);
	});

	it.each([false, true])("rolls back every Clear patch when the second replace throws (after=%s)", async after => {
		const h = harness(200, 0); await h.open("猫と犬。\n\n鳥と病院。");
		const controller = body(h.view), targets = ["猫", "鳥"].map(surface => plan(h.view).slots.find(item => item.originalToken.surface === surface)!);
		for (const target of targets) expect(controller.shuffleManual(plan(h.view).slots.find(item => item.tokenId === target.tokenId)!)).toBe("applied");
		const oldPlan = plan(h.view), oldRuntime: unknown = Reflect.get(controller, "runtime"), oldHtml = root(h.view).innerHTML;
		const oldRevision = controller.getDisplayRevision(), oldOverrides = controller.getManualOverrideCount();
		const replace = Object.getOwnPropertyDescriptor(Node.prototype, "replaceChild")!.value as (this: Node, next: Node, old: Node) => Node; let calls = 0;
		const fault = vi.spyOn(Node.prototype, "replaceChild").mockImplementation(function <T extends Node>(this: Node, newChild: T, oldChild: Node): T {
			calls += 1; if (calls === 2 && !after) throw Error("PRIVATE");
			const result = replace.call(this, newChild, oldChild) as T; if (calls === 2 && after) throw Error("PRIVATE"); return result;
		});
		expect(controller.clearManual()).toBe("failed"); fault.mockRestore();
		expect(root(h.view).innerHTML).toBe(oldHtml); expect(plan(h.view)).toBe(oldPlan); expect(Reflect.get(controller, "runtime")).toBe(oldRuntime);
		expect(controller.getDisplayRevision()).toBe(oldRevision); expect(controller.getManualOverrideCount()).toBe(oldOverrides);
		expect(plan(h.view).slots.filter(item => item.manualOverride)).toHaveLength(2); expect(controller.isDisplayIntact()).toBe(true);
		expect(controller.clearManual()).toBe("applied"); expect(controller.getManualOverrideCount()).toBe(0);
	});

 it("opens without changing, rejects double-click, and supports Escape with keyboard focus return", async () => {
  const h = harness(100, 0); await h.open("猫と犬と病院。\n");
  let slot = plan(h.view).slots.find(item => item.manualAvailable)!;
  let origin = parts(h.view, slot)[0]!, revision = body(h.view).getDisplayRevision();
  document.getSelection()!.collapse(origin.firstChild, 0);
  origin.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  let menu = peek(h.view).contentEl.querySelector<HTMLElement>(".semantropy-manual-menu")!;
  expect(menu).not.toBeNull(); expect(body(h.view).getDisplayRevision()).toBe(revision);
  const shuffle = Array.from(menu.querySelectorAll("button")).find(button => button.textContent === "Shuffle this word")!;
  shuffle.click(); expect(body(h.view).getDisplayRevision()).toBe(revision + 1);

  slot = plan(h.view).slots.find(item => item.tokenId === slot.tokenId)!; origin = parts(h.view, slot)[0]!;
  revision = body(h.view).getDisplayRevision(); origin.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
  expect(peek(h.view).contentEl.querySelector(".semantropy-manual-menu")).toBeNull();
  expect(body(h.view).getDisplayRevision()).toBe(revision);

  origin.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  menu = peek(h.view).contentEl.querySelector<HTMLElement>(".semantropy-manual-menu")!;
  expect(menu.contains(document.activeElement)).toBe(true);
  menu.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  expect(peek(h.view).contentEl.querySelector(".semantropy-manual-menu")).toBeNull();
  expect(document.activeElement).toBe(origin);
 });
});

describe("TOKENS1 marker-only replanning", () => {
 it("visibility changes reuse the exact plan and generation, preserve selection/scroll, and never draw", async () => {
  const h = harness(); await h.open("猫と犬。\n".repeat(20));
  await h.view.defineSelectedWord({ selection: pickSlot(h.view, plan(h.view).slots[0]!), issueSeed: () => 4 });
  const definition = peek(h.view).dictionaryWorld.getCurrent(); expect(definition).not.toBeNull();
  const slots = plan(h.view), state = peek(h.view).session.getState(), snapshot = body(h.view).getVocabularySnapshot(), revision = body(h.view).getDisplayRevision();
  const first = body(h.view).getTextNodes()[0]!, selection = document.getSelection()!; selection.setBaseAndExtent(first, 1, first, 0);
  const before = body(h.view).readSelection(selection); peek(h.view).contentEl.scrollTop = 71;
  const draw = vi.spyOn(transformCore, "transformWithVocabularySnapshot");
  for (const key of ["replacement", "manual", "dictionary"] as const) {
   expect(await h.view.setMarkerVisibility({ [key]: false })).toBe("applied");
   expect(plan(h.view)).toBe(slots); expect(peek(h.view).session.getState()).toBe(state);
   expect(peek(h.view).dictionaryWorld.getCurrent()).toBe(definition);
   expect(body(h.view).getDisplayRevision()).toBe(revision); expect(body(h.view).getVocabularySnapshot()).toBe(snapshot);
  }
  expect(root(h.view).querySelectorAll(".semantropy-replaced,.semantropy-manual-available,.semantropy-dictionary-available")).toHaveLength(0);
  expect(body(h.view).readSelection(selection)).toEqual(before); expect(peek(h.view).contentEl.scrollTop).toBe(71);
  expect(draw).not.toHaveBeenCalled();
  expect(await h.view.setMarkerVisibility({ replacement: true, manual: true, dictionary: true })).toBe("applied");
  expect(root(h.view).querySelector(".semantropy-replaced.semantropy-manual-available.semantropy-dictionary-available")).not.toBeNull();
 });
 it("DICTIONARY-LEVEL1: 0 is refused; a level change keeps availability without Source/tokenizer/body generation work", async () => {
  const h = harness(); await h.open("猫と犬。\n".repeat(20));
  await h.view.defineSelectedWord({ selection: pickSlot(h.view, plan(h.view).slots[0]!), issueSeed: () => 2 });
  const original = plan(h.view), state = peek(h.view).session.getState(), tokens = h.calls.tokens.length, text = logical(h.view);
  const persisted: number[] = [];
  expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(0), { persist: async value => { persisted.push(value); return true; } })).toBe("unavailable");
  expect(persisted).toEqual([]);
  expect(plan(h.view)).toEqual(original);
  expect(peek(h.view).dictionaryWorld.getCurrent()?.dictionarySemantropy).toBe(50);
  expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(75))).toBe("applied");
  expect(plan(h.view).slots.every(s => s.dictionaryAvailable === original.slots[plan(h.view).slots.indexOf(s)]!.dictionaryAvailable)).toBe(true);
  expect(root(h.view).querySelector(".semantropy-dictionary-available")).not.toBeNull();
  expect(root(h.view).querySelector(".semantropy-replaced.semantropy-manual-available")).not.toBeNull();
  expect(peek(h.view).session.getState()).toBe(state); expect(logical(h.view)).toBe(text);
  expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(50))).toBe("applied");
  expect(plan(h.view)).toEqual(original); expect(h.calls.tokens).toHaveLength(tokens); expect(h.calls.read).toBe(0);
 });
});

describe("TOKENS1 publication failures and lifetime", () => {
 it.each(["reshuffle", "text", "markers", "dictionary", "refresh", "open", "vocabulary"] as const)("%s rolls back replace-before/after exceptions and retries", async operation => {
  for (const after of [false, true]) {
   const h = harness(); await h.open("猫と犬。\n".repeat(30));
   if (operation === "dictionary") await h.view.defineSelectedWord({ selection: pickSlot(h.view, plan(h.view).slots[0]!) });
   const assertOld = capture(h.view);
   const parent = operation === "refresh" || operation === "open" ? root(h.view).parentElement! : root(h.view);
   const replace = parent.replaceChildren.bind(parent);
   const fault = vi.spyOn(parent, "replaceChildren").mockImplementation((...nodes) => { if (after) replace(...nodes); throw Error("PRIVATE"); });
   const act = () => operation === "reshuffle" ? h.view.reshuffle({ issueSeed: () => 22 }) : operation === "text" ? h.view.setBodySemantropy(assertBodySemantropy(0)) :
    operation === "markers" ? h.view.setMarkerVisibility({ dictionary: false }) : operation === "dictionary" ? h.view.setDictionarySemantropy(assertDictionarySemantropy(75)) :
    operation === "refresh" ? h.view.refreshSource({ hashText: async text => sha256Hex(text) }) : operation === "open" ? h.reopen("鳥と病院。\n".repeat(30)) : h.view.applyVocabulary();
   const result = await act(); if (operation !== "open") expect(result).toBe("failed"); assertOld();
   fault.mockRestore();
   const retry = await act(); if (operation !== "open") expect(retry).toBe(operation === "refresh" ? "refreshed" : "applied");
   expect(plan(h.view)).not.toBeNull(); await h.view.onClose();
  }
 });
 it.each(["false", "throw"])("session %s during transform preserves all states", async kind => {
  const h = harness(); await h.open("猫と犬。\n".repeat(30)); const assertOld = capture(h.view);
  const fault = vi.spyOn(peek(h.view).session, "updateReadyTransform").mockImplementation(() => { if (kind === "throw") throw Error("PRIVATE"); return false; });
  expect(await h.view.reshuffle({ issueSeed: () => 20 })).toBe(kind === "false" ? "aborted" : "failed"); assertOld();
  fault.mockRestore(); expect(await h.view.reshuffle({ issueSeed: () => 20 })).toBe("applied");
 });
 it.each([false, true])("append failure (after=%s) keeps plan/session/DOM and retry adds one Chunk", async after => {
  const h = harness(); await h.open("猫と犬。\n".repeat(30)); const assertOld = capture(h.view), r = root(h.view), append = r.appendChild.bind(r);
  const fault = vi.spyOn(r, "appendChild").mockImplementation(node => { if (after) append(node); throw Error("PRIVATE"); });
  expect(await h.view.loadNextSection()).toBe("failed"); assertOld(); fault.mockRestore();
  const nodes = Array.from(r.childNodes), selection = body(h.view).readSelection(document.getSelection());
  expect(await h.view.loadNextSection()).toBe("applied"); expect(body(h.view).getChunkStats().chunks).toBe(2);
  expect(r.firstChild).toBe(nodes[0]); expect(body(h.view).readSelection(document.getSelection())).toEqual(selection);
  expect(plan(h.view).slots.length).toBe(body(h.view).getChunkStats().tokens);
 });
 it("cancelled Vocabulary preparation preserves the plan even while read is unresolved", async () => {
  const h = harness(); await h.open("猫と犬。\n".repeat(30)); const assertOld = capture(h.view);
  const gate = deferred<string>(); h.host.readCurrentText = () => gate.promise;
  h.view.setVocabularyDraft({ mode: "selected", paths: ["other.md"], drawMode: "uniform" });
  const pending = h.view.applyVocabulary();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  h.view.cancelVocabulary(); assertOld();
  gate.resolve("鳥と病院"); expect(await pending).toBe("aborted"); assertOld();
 });
 it.each(["false", "throw"])("Dictionary save %s leaves the plan, DOM and definition unchanged", async mode => {
  const h = harness(); await h.open("猫と犬。\n".repeat(30));
  await h.view.defineSelectedWord({ selection: pickSlot(h.view, plan(h.view).slots[0]!) });
  const assertOld = capture(h.view), current = peek(h.view).dictionaryWorld.getCurrent();
  expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(75), { persist: async () => { if (mode === "throw") throw Error("PRIVATE"); return false; } })).toBe("failed");
  assertOld(); expect(peek(h.view).dictionaryWorld.getCurrent()).toBe(current);
 });
 it("failed ready Open keeps the prior plan and session, then succeeds on retry", async () => {
  const h = harness(); await h.open("猫と犬。\n".repeat(30)); const assertOld = capture(h.view);
  h.state.failTokens = true; await h.reopen("鳥と病院。\n".repeat(30)); assertOld();
  expect(peek(h.view).contentEl.querySelector(".semantropy-message")!.textContent).toContain("Could not render");
  h.state.failTokens = false; await h.reopen("鳥と病院。\n".repeat(30));
  expect(plan(h.view).slots.some(s => s.originalToken.surface === "鳥")).toBe(true);
 });

 it("Dictionary session rejection preserves the old plan and generated definition", async () => {
  for (const mode of ["false", "throw"] as const) {
   const h = harness(); await h.open("猫と犬。\n".repeat(30));
   await h.view.defineSelectedWord({ selection: pickSlot(h.view, plan(h.view).slots[0]!) });
   const assertOld = capture(h.view), world = peek(h.view).dictionaryWorld, definition = world.getCurrent();
   const fault = vi.spyOn(world, "commit").mockImplementation(() => { if (mode === "throw") throw Error("PRIVATE"); return false; });
   expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(75))).toBe(mode === "false" ? "aborted" : "failed");
   assertOld(); expect(world.getCurrent()).toBe(definition); fault.mockRestore();
   expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(75))).toBe("applied");
   await h.view.onClose();
  }
 });
 it("never logs note text, candidates, readings or paths on a plan failure", async () => {
  const h = harness(), logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await h.open("猫と病院《びょういん》。\n");
  vi.spyOn(slotsCore, "planAutomaticDisplaySlots").mockImplementationOnce(() => { throw Error("fixture.md 猫 病院 ビョウイン びょういん"); });
  expect(await h.view.reshuffle({ issueSeed: () => 20 })).toBe("failed");
  expect(JSON.stringify(logs.mock.calls)).not.toMatch(/fixture|猫|病院|ビョウイン|びょういん/);
  expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
 });

 it("has no unloaded slots/builds; prefix-only reshuffle, Text and Load use exact canonical owners", async () => {
  const h = harness(); const draw = vi.spyOn(slotsCore, "planAutomaticDisplaySlots"), build = vi.spyOn(presentation, "buildTargetDisplay");
  await h.open("猫と犬。\n".repeat(500)); expect(draw.mock.calls[0]![0].chunks).toHaveLength(1); expect(build).toHaveBeenCalledTimes(1);
  const first = root(h.view).firstChild;
  await h.view.loadNextSection(); expect(build).toHaveBeenCalledTimes(2); expect(root(h.view).firstChild).toBe(first);
  const count = h.calls.tokens.length;
  await h.view.reshuffle({ issueSeed: () => 24 }); await h.view.setBodySemantropy(assertBodySemantropy(0));
  expect(h.calls.tokens).toHaveLength(count); expect(build).toHaveBeenCalledTimes(6);
  expect(new Set(plan(h.view).slots.map(s => s.chunkId)).size).toBe(2);
 });
 it("rejects another View's same-revision prepared draw and cloned surface ownership", async () => {
  const a = harness(), b = harness(); await a.open("猫と犬。\n".repeat(20)); await b.open("猫と犬。\n".repeat(20));
  expect(plan(a.view).targetRevision).toBe(plan(b.view).targetRevision);
  const foreign = body(b.view).transform(12, assertBodySemantropy(100));
  expect((await body(a.view).prepare(body(a.view).getBodyGeneration(), foreign, { isCurrent: () => true, scheduler: immediateScheduler() })).status).toBe("failed");
  const local = body(a.view).transform(12, assertBodySemantropy(100));
  expect((await body(a.view).prepare(body(a.view).getBodyGeneration(), { ...local, tokenSurfaces: local.tokenSurfaces!.map(r => [...r]) }, { isCurrent: () => true, scheduler: immediateScheduler() })).status).toBe("failed");
  expect(body(a.view).getSlotForElement(elements(b.view)[0]!)).toBeNull();
 });
 it.each(["refresh", "open", "close"] as const)("late marker preparation cannot mutate a newer owner after %s", async action => {
  const h = harness(); await h.open("猫と犬。\n".repeat(30));
  const wait = deferred<void>(), entered = deferred<void>();
  h.state.scheduler = testScheduler({ tickMs: 9, onYield: () => { entered.resolve(); return wait.promise; } }).scheduler;
  const pending = h.view.setMarkerVisibility({ dictionary: false }); await entered.promise;
  h.state.scheduler = immediateScheduler();
  if (action === "close") await h.view.onClose();
  else if (action === "open") await h.reopen("鳥と病院。\n".repeat(30));
  else expect(await h.view.refreshSource({ hashText: async text => sha256Hex(text) })).toBe("refreshed");
  wait.resolve(); expect(await pending).toBe("aborted");
  if (action === "close") expect(body(h.view).getDisplaySlotPlan()).toBeNull();
  else if (action === "open") expect(body(h.view).getMarkerVisibility().dictionary).not.toBe(false);
 });
});
