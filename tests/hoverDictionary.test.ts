// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { defaultSemantropyDisplaySettings } from "../src/settings/displaySettings";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { DefinitionCache, cachedDefinitionCommit, definitionCacheKey } from "../src/application/definitionCache";
import { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import { DICTIONARY_DIAGNOSTICS, dictionaryDiagnosticMessage, dictionaryDiagnostics } from "../src/view/dictionaryDiagnosticModel";
import * as define from "../src/application/defineSelectedWord";
import { generateFakeDefinition } from "../src/dictionary/generateFakeDefinition";
import { prepareDictionaryPool } from "../src/dictionary/vocabularyPool";
import type { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import type { DisplaySlot } from "../src/analysis/displaySlots";
import { collectVocabulary, COLLECT_FIXTURE_HASH } from "./collectFixtures";
import { immediateScheduler } from "./support/testScheduler";

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
const live: ReturnType<typeof manualMorphHarness>[] = [];
afterEach(async () => { for (const h of live.splice(0)) await h.view.onClose(); vi.useRealTimers(); vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
const lexicon = () => lexiconTokenizer([
 token({ surface: "猫", baseForm: "猫", reading: "ネコ" }), token({ surface: "犬", baseForm: "犬", reading: "イヌ" }),
 token({ surface: "鳥", baseForm: "鳥", reading: undefined }), token({ surface: "港", detail1: "固有名詞", detail2: "地域" }),
 token({ surface: "研究", detail1: "サ変接続" }),
]);
async function harness(text = "猫犬鳥港研究。", size = 5000) {
 const h = manualMorphHarness(lexicon(), size); live.push(h); await h.open(text); return h;
}
type H = Awaited<ReturnType<typeof harness>>;
const panel = () => document.querySelector<HTMLElement>(".semantropy-dictionary-popover");
const popover = (h: H) => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
const world = (h: H) => Reflect.get(h.view, "dictionaryWorld") as FakeDictionaryWorld;
const cache = (h: H) => Reflect.get(h.view, "definitionCache") as DefinitionCache;
const element = (h: H, slot = h.current("猫")) => Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(el => h.controller().getSlotForElement(el) === slot)!;
const pointer = (el: Element, type = "pointerover", init: MouseEventInit = {}) => {
 const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(event); return event;
};
const key = (el: EventTarget, value: string, type = "keydown", init: KeyboardEventInit = {}) => {
 const event = new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true, ...init }); el.dispatchEvent(event); return event;
};
const wait = (ms = 145) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
async function hover(h: H, slot?: DisplaySlot) { pointer(element(h, slot), "pointerover", { altKey: true }); await wait(); expect(popover(h).isOpen()).toBe(true); }
const definition = () => panel()?.querySelector(".semantropy-definition-text")?.textContent;

describe("HOVER-DICT1 delegated DOM events (real timer and event ordering)", () => {
 it("modifier first opens at 125ms, never before, without taking focus or doing analysis/I/O", async () => {
  const h = await harness(); vi.useFakeTimers();
  const focus = document.createElement("button"); document.body.append(focus); focus.focus();
  const reads = h.calls.reads.length, tokens = h.calls.tokenizations.length;
  key(document, "Alt"); pointer(element(h), "pointerover", { altKey: true });
  await vi.advanceTimersByTimeAsync(124); expect(panel()).toBeNull();
  await vi.advanceTimersByTimeAsync(1); expect(panel()?.getAttribute("role")).toBe("dialog");
  expect(document.activeElement).toBe(focus); expect(h.calls.reads).toHaveLength(reads); expect(h.calls.tokenizations).toHaveLength(tokens);
  expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
  expect(h.root().querySelectorAll("[tabindex]")).toHaveLength(0);
 });
 it("EXPERIENCE-TOKEN-UI1: a pending Popover Copy / Collect turns the dictionary affordance off until it settles", async () => {
  const h = await harness(); await hover(h);
  const body = h.peek.contentEl.querySelector<HTMLElement>(".semantropy-body")!;
  const canStart = () => (Reflect.get(popover(h), "host") as { canStart: () => boolean }).canStart();
  expect(body.classList.contains("is-dictionary-live")).toBe(true); expect(canStart()).toBe(true);
  let copied!: () => void;
  h.host.writeClipboard = () => new Promise<void>(resolve => { copied = resolve; });
  const copying = h.view.copyDefinition();
  // Only the Popover path ran; nothing else resynchronised the body, yet hover and cursor agree.
  expect(canStart()).toBe(false); expect(body.classList.contains("is-dictionary-live")).toBe(false);
  expect(body.classList.contains("is-manual-live")).toBe(true);
  copied(); expect(await copying).toBe("copied");
  expect(canStart()).toBe(true); expect(body.classList.contains("is-dictionary-live")).toBe(true);
  let collected!: (value: { status: "created" }) => void;
  h.host.collectFragment = () => new Promise(resolve => { collected = resolve; });
  const collecting = h.view.collectDefinition();
  expect(canStart()).toBe(false); expect(body.classList.contains("is-dictionary-live")).toBe(false);
  collected({ status: "created" }); expect(await collecting).toBe("created");
  expect(body.classList.contains("is-dictionary-live")).toBe(true);
 });
 it("pointer first then Alt opens with native DOM keyboard events and real elapsed delay", async () => {
  const h = await harness(); pointer(element(h)); await wait(); expect(panel()).toBeNull();
  key(document.body, "Alt"); await wait(); expect(definition()).toBeTruthy();
 });
 it.each([['button', 'alt'], ['input', 'alt'], ['button', 'shift'], ['input', 'shift']] as const)("external %s focus: pointer-first %s opens only the pointer owner without a move", async (tag, modifier) => {
  const a = await harness(), b = await harness();
  for (const h of [a, b]) h.host.getDisplaySettings = () => ({ ...defaultSemantropyDisplaySettings(), dictionaryModifier: modifier });
  const focus = document.createElement(tag); a.peek.contentEl.querySelector(".semantropy-root")!.append(focus); focus.focus();
  pointer(element(a)); pointer(element(a), "pointerout", { relatedTarget: element(b) }); pointer(element(b));
  expect(document.activeElement).toBe(focus);
  expect(key(focus, modifier === "alt" ? "Alt" : "Shift").defaultPrevented).toBe(false);
  await wait(80); expect(popover(a).isOpen()).toBe(false); expect(popover(b).isOpen()).toBe(false);
  await wait(65); expect(popover(a).isOpen()).toBe(false); expect(popover(b).isOpen()).toBe(true);
  expect(document.activeElement).toBe(focus);
 });
 it("respects Shift setting and leaves Shift selection/default events alone", async () => {
  const h = await harness(); h.host.getDisplaySettings = () => ({ ...defaultSemantropyDisplaySettings(), dictionaryModifier: "shift" });
  pointer(element(h), "pointerover", { altKey: true }); await wait(); expect(panel()).toBeNull();
  pointer(element(h)); expect(key(document.body, "Shift").defaultPrevented).toBe(false); await wait(); expect(panel()).not.toBeNull();
  pointer(element(h), "pointerdown", { shiftKey: true, buttons: 1 });
  expect(panel()).toBeNull(); expect(key(element(h), "ArrowRight", "keydown", { shiftKey: true }).defaultPrevented).toBe(false);
 });
 it.each(["leave", "close", "slot", "release"])("cancels during delay on %s", async reason => {
  const h = await harness(); pointer(element(h), "pointerover", { altKey: true });
  if (reason === "leave") pointer(element(h), "pointerout", { relatedTarget: document.body });
  if (reason === "close") await h.view.onClose();
  if (reason === "slot") h.controller().shuffleManual(h.current("猫"));
  if (reason === "release") key(document.body, "Alt", "keyup");
  await wait(); expect(panel()).toBeNull(); expect(world(h).getCurrent()).toBeNull();
 });
 it("keeps a panel after crossing the gap and releasing Alt; Copy and Collect use committed result", async () => {
  const h = await harness(); await hover(h); const result = definition();
  const gap = h.root().querySelector("p")!;
  pointer(element(h), "pointerout", { relatedTarget: gap });
  pointer(gap, "pointerover", { altKey: true }); pointer(gap, "pointermove", { altKey: true });
  await wait(60); expect(popover(h).isOpen()).toBe(true);
  pointer(panel()!); await wait(230);
  key(document.body, "Alt", "keyup"); await wait(); expect(definition()).toBe(result);
  expect(await h.view.copyDefinition()).toBe("copied"); expect(h.calls.copy).toEqual([`猫
${result}`]);
  expect(await h.view.collectDefinition()).toBe("created"); expect(h.calls.collect).toHaveLength(1);
  const collected = h.calls.collect[0];
  expect(collected?.type).toBe("fake-dictionary");
  expect(collected).not.toHaveProperty("seed");
  expect(collected).toHaveProperty("metadataVersion", 4);
  if (collected?.type === "fake-dictionary") {
    expect(collected.vocabulary.fingerprint).toBe(h.controller().getVocabularySnapshot()!.fingerprint);
    expect(collected.vocabulary.drawMode).toBe(h.controller().getVocabularySnapshot()!.drawMode);
    expect(collected.templateSetVersion).toBe(1);
  }
 });
 it("bridge expires at 200ms without extending on body movement", async () => {
  const h = await harness(); await hover(h); vi.useFakeTimers();
  const gap = h.root().querySelector("p")!;
  pointer(gap, "pointerover", { altKey: true }); await vi.advanceTimersByTimeAsync(100);
  pointer(gap, "pointermove", { altKey: true }); await vi.advanceTimersByTimeAsync(99);
  expect(popover(h).isOpen()).toBe(true); await vi.advanceTimersByTimeAsync(1);
  expect(popover(h).isOpen()).toBe(false); expect(Reflect.get(popover(h), "bridgeTimer")).toBeNull();
 });
 it("returning to the origin cancels the bridge; another word closes immediately", async () => {
  const h = await harness(); await hover(h); const gap = h.root().querySelector("p")!;
  pointer(gap, "pointerover", { altKey: true }); await wait(50); pointer(element(h), "pointerover", { altKey: true });
  await wait(230); expect(popover(h).isOpen()).toBe(true);
  pointer(element(h, h.current("犬")), "pointerover", { altKey: true });
  expect(popover(h).isOpen()).toBe(false);
 });
 it.each(["scroll", "stale", "close"])("%s cancels a live bridge and leaves no timer", async boundary => {
  const h = await harness(); await hover(h); const controller = popover(h);
  pointer(h.root().querySelector("p")!, "pointermove", { altKey: true });
  expect(Reflect.get(controller, "bridgeTimer")).not.toBeNull();
  if (boundary === "scroll") h.peek.contentEl.querySelector(".semantropy-scroll")!.dispatchEvent(new Event("scroll"));
  if (boundary === "stale") { h.controller().shuffleManual(h.current("猫")); controller.validate(); }
  if (boundary === "close") await h.view.onClose();
  expect(controller.isOpen()).toBe(false); expect(Reflect.get(controller, "bridgeTimer")).toBeNull();
  await wait(230); expect(controller.isOpen()).toBe(false);
 });
 it("one View's bridge expiration cannot close another View's Popover", async () => {
  const a = await harness(), b = await harness(); await hover(a);
  pointer(a.root().querySelector("p")!, "pointermove", { altKey: true });
  await hover(b); await wait(100);
  expect(popover(a).isOpen()).toBe(false); expect(popover(b).isOpen()).toBe(true);
 });
 it.each(["keyup", "composition", "pointer-away"])("external-focus pending request cancels on %s", async boundary => {
  const h = await harness(); const focus = document.createElement("input"); document.body.append(focus); focus.focus();
  vi.useFakeTimers(); pointer(element(h)); key(focus, "Alt");
  await vi.advanceTimersByTimeAsync(124); expect(panel()).toBeNull();
  if (boundary === "keyup") key(focus, "Alt", "keyup");
  if (boundary === "composition") focus.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  if (boundary === "pointer-away") pointer(focus);
  await vi.advanceTimersByTimeAsync(1); expect(panel()).toBeNull();
 });
 it.each(["Escape", "outside", "scroll"])("closes on %s", async reason => {
  const h = await harness(); await hover(h);
  if (reason === "Escape") key(document.body, "Escape");
  if (reason === "outside") pointer(document.body, "pointerdown");
  if (reason === "scroll") h.peek.contentEl.querySelector(".semantropy-scroll")!.dispatchEvent(new Event("scroll"));
  expect(panel()).toBeNull(); expect(world(h).getCurrent()).toBeNull(); expect(await h.view.copyDefinition()).toBe("empty");
 });
 it("switches explicitly between Manual menu and Dictionary", async () => {
  const h = await harness(); document.getSelection()?.removeAllRanges();
  pointer(element(h), "click", { detail: 1 }); expect(h.peek.contentEl.querySelector(".semantropy-manual-menu")).not.toBeNull();
  await hover(h); expect(h.peek.contentEl.querySelector(".semantropy-manual-menu")).toBeNull();
  pointer(element(h), "click", { detail: 1 }); expect(panel()).toBeNull(); expect(h.peek.contentEl.querySelector(".semantropy-manual-menu")).not.toBeNull();
 });
 it("does not intercept drag, double-click selection or composition", async () => {
  const h = await harness(), el = element(h);
  expect(pointer(el, "pointerdown", { buttons: 1 }).defaultPrevented).toBe(false);
  pointer(el, "pointermove", { altKey: true, buttons: 1 }); await wait(); expect(panel()).toBeNull();
  pointer(el, "pointerup");
  const range = document.createRange(); range.selectNodeContents(el); document.getSelection()!.addRange(range);
  expect(pointer(el, "dblclick", { detail: 2 }).defaultPrevented).toBe(false);
  pointer(el, "pointerover", { altKey: true }); await wait(); expect(panel()).toBeNull();
  document.getSelection()!.removeAllRanges(); document.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  pointer(el, "pointerover", { altKey: true }); await wait(); expect(panel()).toBeNull();
  document.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await hover(h);
 });
 it("does not start from code, protected links, readings, or Toolbar inputs", async () => {
  const h = await harness("｜猫《ねこ》。`犬` [鳥](https://invalid.test) 港研究。");
  for (const el of Array.from(h.root().querySelectorAll("rt,code"))) { expect(pointer(el, "pointerover", { altKey: true }).defaultPrevented).toBe(false); await wait(); expect(panel()).toBeNull(); }
  const input = document.createElement("input"); h.peek.contentEl.append(input); pointer(element(h)); input.focus(); pointer(input);
  key(input, "Alt"); await wait(); expect(panel()).toBeNull();
  expect(h.root().querySelector("a")).toBeNull();
 });
 it("does not start from an eligible but unavailable slot", async () => {
  // DICTIONARY-LEVEL1: the View can no longer reach Off, so the unavailable state (an uncallable pool
  // in production) is published through the display layer below it, which still accepts 0 defensively.
  const h = await harness();
  const prepared = await h.controller().prepareMarkers(assertDictionarySemantropy(0), {}, { isCurrent: () => true, scheduler: immediateScheduler() });
  expect(prepared.status).toBe("prepared"); if (prepared.status === "prepared") expect(prepared.commit()).toBe("applied");
  expect(h.current("猫").dictionaryEligible).toBe(true); expect(h.current("猫").dictionaryAvailable).toBe(false);
  pointer(element(h), "pointerover", { altKey: true }); await wait(); expect(panel()).toBeNull();
 });
 it("Ruby base uses the dictionary reading, never the Ruby annotation; no-reading omits its field", async () => {
  const h = await harness("｜猫《ちがうよみ》犬鳥港研究。"); await hover(h);
  expect(panel()?.querySelector(".semantropy-definition-reading")?.textContent).toBe("ネコ");
  popover(h).close(); await hover(h, h.current("鳥")); expect(panel()?.querySelector(".semantropy-definition-reading")).toBeNull();
 });
 it("uses the current Manual candidate and refuses the old target", async () => {
  const h = await harness(); await hover(h); const old = popover(h).getTarget()!;
  expect(h.controller().shuffleManual(h.current("猫"))).toBe("applied");
  popover(h).validate(); expect(panel()).toBeNull(); expect(old.isCurrent()).toBe(false);
  await hover(h); const slot = h.current("猫");
  expect(panel()?.querySelector(".semantropy-definition-headword")?.textContent).toBe(slot.displaySurface);
  expect(world(h).getCurrent()?.headword).toEqual(slot.dictionary.outcome === "accepted" ? slot.dictionary.headword : null);
 });
 it("never commits a delayed result after Manual change (MAN-10) or close", async () => {
  const h = await harness(); const run = define.runDefineSelectedWord;
  let complete: (() => void) | undefined;
  vi.spyOn(define, "runDefineSelectedWord").mockImplementation(async input => {
   const result = await run(input); await new Promise<void>(resolve => { complete = resolve; }); return result;
  });
  pointer(element(h), "pointerover", { altKey: true }); await wait();
  expect(panel()).not.toBeNull(); expect(await h.view.copyDefinition()).toBe("empty"); expect(await h.view.collectDefinition()).toBe("empty");
  h.controller().shuffleManual(h.current("猫")); complete!(); await Promise.resolve(); await Promise.resolve();
  expect(panel()).toBeNull(); expect(cache(h).size).toBe(0); expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
 });
 it("stale Vocabulary and stale Target invalidate current and pending work", async () => {
  const h = await harness(); await hover(h); h.view.notifyVocabularySourceEvent("target.md"); expect(panel()).toBeNull();
  await h.view.refreshSource(); await hover(h); await h.view.recheckSourceFreshness("changed"); expect(panel()).toBeNull();
 });
 it("Refresh, Apply and close free panel and references; reopened View starts fresh", async () => {
  const h = await harness(); await hover(h); await h.view.refreshSource(); expect(panel()).toBeNull();
  await hover(h); expect(await h.apply(["犬猫鳥港研究。"])).toBe("applied"); expect(panel()).toBeNull();
  await hover(h); const controller = popover(h); await h.view.onClose();
  expect(panel()).toBeNull(); expect(controller.getTarget()).toBeNull(); expect(Reflect.get(controller, "off")).toEqual([]); expect(Reflect.get(controller, "timer")).toBeNull(); expect(cache(h).size).toBe(0);
  await h.open("猫犬鳥港研究。"); await hover(h);
 });
 it("same spelling in separate Chunks and Views retains exact slot ownership", async () => {
  const a = await harness("猫犬鳥港研究。\n猫犬鳥港研究。\n猫犬鳥港研究。", 9), b = await harness();
  const before = a.controller().getChunkStats(); expect(before.chunks).toBe(1);
  await hover(a); const aTarget = popover(a).getTarget()!;
  await hover(b); expect(popover(a).isOpen()).toBe(true); expect(popover(b).getTarget()?.slot).not.toBe(aTarget.slot);
  const bPanel = Array.from(document.querySelectorAll<HTMLElement>(".semantropy-dictionary-popover"))[1]!;
  pointer(bPanel.querySelector("button")!, "pointerdown"); expect(popover(a).isOpen()).toBe(true);
  pointer(element(b), "pointercancel"); expect(popover(a).isOpen()).toBe(true); await hover(b);
  element(b).dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); expect(popover(a).isOpen()).toBe(true);
  element(b).dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await hover(b);
  key(b.peek.contentEl.querySelector(".semantropy-root")!, "Escape"); expect(popover(b).isOpen()).toBe(false); expect(popover(a).isOpen()).toBe(true);
  b.peek.contentEl.querySelector(".semantropy-scroll")!.dispatchEvent(new Event("scroll")); expect(popover(a).isOpen()).toBe(true);
  expect(a.controller().getChunkStats()).toEqual(before);
  await a.view.loadNextSection(); popover(a).validate(); expect(popover(a).isOpen()).toBe(false);
  const repeated = a.plan().slots.filter(s => s.originalToken.surface === "猫"); expect(repeated).toHaveLength(2);
  await hover(a, repeated[1]); expect(popover(a).getTarget()?.slot).toBe(repeated[1]);
 });
 it("rehovers and body Reshuffle keep definitions; only explicit definition Reshuffle issues a new nonce", async () => {
  const h = await harness(); await hover(h); const first = world(h).getCurrent()!;
  popover(h).close(); await hover(h); expect(world(h).getCurrent()?.result).toBe(first.result);
  popover(h).close(); await h.view.reshuffle({ issueSeed: () => 99 }); await hover(h);
  expect(world(h).getCurrent()?.result).toBe(first.result);
  expect(h.view.reshuffleDefinition({ issueSeed: () => 123456 })).toBe("applied");
  expect(world(h).getCurrent()?.dictionarySeed).toBe(123456); const next = world(h).getCurrent()!.result;
  popover(h).close(); await hover(h); expect(world(h).getCurrent()?.result).toBe(next);
 });
 it("Dictionary level change closes obsolete anchor and preserves Manual override", async () => {
  const h = await harness(); h.controller().shuffleManual(h.current("猫")); await hover(h);
  expect(await h.view.setDictionarySemantropy(assertDictionarySemantropy(75))).toBe("applied");
  expect(panel()).toBeNull(); expect(h.controller().getManualOverrideCount()).toBe(1); await hover(h);
  expect(world(h).getCurrent()?.dictionarySemantropy).toBe(75);
 });
 it("keyboard opening returns focus only to a connected origin", async () => {
  const h = await harness(); await hover(h); const target = popover(h).getTarget()!; popover(h).close();
  const origin = h.peek.contentEl.querySelector<HTMLButtonElement>("button:not(:disabled)")!; origin.focus();
  popover(h).open(target, origin); await Promise.resolve(); await Promise.resolve();
  // Pending presentation has no enabled action; once ready the keyboard user can Tab into controls.
  panel()!.querySelector<HTMLButtonElement>("button:not(:disabled)")!.focus();
  key(document.activeElement!, "Escape"); expect(document.activeElement).toBe(origin);
  popover(h).open(target, origin); origin.remove(); key(panel()!, "Escape"); expect(document.activeElement).not.toBe(origin);
 });
 it("Escape in a focused keyboard panel does not close another View under the pointer", async () => {
  const a = await harness(), b = await harness(); await hover(a);
  const target = popover(a).getTarget()!; popover(a).close();
  const origin = a.peek.contentEl.querySelector<HTMLButtonElement>("button:not(:disabled)")!;
  popover(a).open(target, origin); const aPanel = panel()!;
  await hover(b); expect(aPanel.contains(document.activeElement)).toBe(true);
  key(document.activeElement!, "Escape");
  expect(popover(a).isOpen()).toBe(false); expect(popover(b).isOpen()).toBe(true);
  expect(document.activeElement).toBe(origin);
 });
 it("reshuffling one definition leaves another cached headword untouched", async () => {
  const h = await harness(); await hover(h); const cat = world(h).getCurrent()!.result;
  popover(h).close(); await hover(h, h.current("犬"));
  expect(h.view.reshuffleDefinition({ issueSeed: () => 123456 })).toBe("applied");
  popover(h).close(); await hover(h); expect(world(h).getCurrent()!.result).toBe(cat);
 });
 it.each(["close", "refresh", "vocabulary", "other-word", "other-view"])("rejects delayed completion across %s", async boundary => {
  const h = await harness(), other = boundary === "other-view" ? await harness() : null;
  const run = define.runDefineSelectedWord;
  let complete: (() => void) | undefined;
  vi.spyOn(define, "runDefineSelectedWord").mockImplementationOnce(async input => {
   const result = await run(input); await new Promise<void>(resolve => { complete = resolve; }); return result;
  });
  pointer(element(h), "pointerover", { altKey: true }); await wait(); expect(world(h).getCurrent()).toBeNull();
  if (boundary === "close") await h.view.onClose();
  if (boundary === "refresh") await h.view.refreshSource();
  if (boundary === "vocabulary") await h.apply(["犬猫鳥港研究。"]);
  if (boundary === "other-word") { popover(h).close(); await hover(h, h.current("犬")); }
  if (other) { await h.view.onClose(); await hover(other); }
  const otherResult = other ? world(other).getCurrent() : null;
  complete!(); await Promise.resolve(); await Promise.resolve();
  if (boundary === "other-word") expect(world(h).getCurrent()?.headword.surface).toBe("犬");
  else expect(world(h).getCurrent()).toBeNull();
  if (other) expect(world(other).getCurrent()).toBe(otherResult);
 });
 it("generation failure exposes only a fixed diagnostic and retains valid cache", async () => {
  const h = await harness(); await hover(h); const size = cache(h).size; popover(h).close();
  vi.spyOn(define, "runDefineSelectedWord").mockRejectedValueOnce(Error("private-source.md SECRET"));
  const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await hover(h, h.current("犬"));
  expect(panel()?.textContent).not.toMatch(/private-source|SECRET/u);
  expect(panel()?.querySelector(".semantropy-definition-message")?.textContent).toBeTruthy();
  expect(await h.view.copyDefinition()).toBe("empty"); expect(cache(h).size).toBe(size); expect(logs).not.toHaveBeenCalled();
 });
 it("explicit writes only; no runtime fetch/XHR or sensitive console output during hover operations", async () => {
  const h = await harness(); const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("network forbidden"));
  const xhr = vi.spyOn(XMLHttpRequest.prototype, "open");
  const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
  const settings = vi.spyOn(h.host, "setDictionarySemantropy");
  const snapshot = h.controller().getVocabularySnapshot(), source = h.state.text;
  await hover(h); popover(h).close(); await hover(h, h.current("鳥"));
  expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); for (const log of logs) expect(log).not.toHaveBeenCalled();
  expect(settings).not.toHaveBeenCalled(); expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
  expect(h.state.text).toBe(source); expect(h.controller().getVocabularySnapshot()).toBe(snapshot);
 });
 it("external Dictionary settings close stale panels and keep marker eligibility", async () => {
  const h = await harness(); await hover(h); h.state.dictionary = assertDictionarySemantropy(75);
  await h.view.dictionarySettingsChanged(); expect(panel()).toBeNull(); expect(h.current("猫").dictionaryAvailable).toBe(true);
  expect(h.peek.contentEl.querySelector(".semantropy-dictionary-diagnostics")?.textContent).not.toContain(DICTIONARY_DIAGNOSTICS.off);
 });
 it("DICTIONARY-LEVEL1: a saved Off reads as Medium, so Hover and the marker do not disappear", async () => {
  const h = await harness(); h.state.dictionary = assertDictionarySemantropy(0);
  await h.view.dictionarySettingsChanged(); await h.view.setMarkerVisibility({ dictionary: true });
  expect(h.current("猫").dictionaryAvailable).toBe(true);
  expect(h.root().querySelector(".semantropy-dictionary-available")).not.toBeNull();
  expect(h.peek.contentEl.querySelector(".semantropy-dictionary-diagnostics")?.textContent).not.toContain(DICTIONARY_DIAGNOSTICS.off);
  await hover(h);
  const select = panel()!.querySelector<HTMLSelectElement>(".semantropy-dictionary-level-select")!;
  expect(select.value).toBe("50");
  expect(Array.from(select.options).map(option => option.value)).toEqual(["25", "50", "75", "100"]);
  expect(panel()!.querySelector(".semantropy-definition-text")?.textContent).toBeTruthy();
 });

});

describe("cache, prepared pools and fixed diagnostics", () => {
 it("evicts exactly the least recently used entry at 65 and refreshes on read", () => {
  const cache = new DefinitionCache(), result = { outcome: "off" as const };
  const value = { result, target: { sourcePath: "n.md", contentHash: COLLECT_FIXTURE_HASH }, vocabulary: collectVocabulary(["n.md"]) };
  for (let i = 0; i < 64; i++) cache.set(String(i), value);
  expect(cache.size).toBe(64); cache.get("0"); cache.set("64", value);
  expect(cache.size).toBe(64); expect(cache.get("1")).toBeUndefined(); expect(cache.get("0")?.result).toBe(result);
  expect(Object.isFrozen(result)).toBe(false);
  for (let i = 2; i <= 64; i++) expect(cache.get(String(i))?.result).toBe(result);
  cache.clear(); expect(cache.size).toBe(0);
 });
 it("commits cached Target and Vocabulary together only on exact result identity", () => {
  const result = { outcome: "off" as const };
  const other = { outcome: "off" as const };
  const cached = { result, target: { sourcePath: "old.md", contentHash: COLLECT_FIXTURE_HASH }, vocabulary: collectVocabulary(["n.md"]) };
  expect(cachedDefinitionCommit(cached, result)).toEqual({ target: cached.target, vocabulary: cached.vocabulary });
  expect(cachedDefinitionCommit(cached, other)).toBeNull();
  expect(cachedDefinitionCommit(undefined, result)).toBeNull();
 });
 it("includes all dictionary world inputs, excluding body generation and occurrence", async () => {
  const h = await harness(), snapshot = h.controller().getVocabularySnapshot()!, slot = h.current("猫");
  if (slot.dictionary.outcome !== "accepted") throw Error(); const headword = slot.dictionary.headword;
  const key = definitionCacheKey(headword, 1, 50, snapshot);
  expect(JSON.parse(key)).toHaveLength(8);
  for (const other of [definitionCacheKey(headword, 2, 50, snapshot), definitionCacheKey(headword, 1, 75, snapshot),
   definitionCacheKey(headword, 1, 50, { ...snapshot, fingerprint: "new" }), definitionCacheKey(headword, 1, 50, { ...snapshot, drawMode: "frequency" })]) expect(other).not.toBe(key);
 });
 it("prepares immutable pool once; generation never sorts or reaggregates its candidates", async () => {
  const h = await harness(), pool = h.controller().getDictionaryPool()!;
  expect(prepareDictionaryPool(pool)).toBe(prepareDictionaryPool(pool));
  const slot = h.current("猫"); if (slot.dictionary.outcome !== "accepted") throw Error();
  const sorted = prepareDictionaryPool(pool).sorted;
  const sort = vi.spyOn(Array.prototype, "sort");
  generateFakeDefinition({ pool, headword: slot.dictionary.headword, dictionarySeed: 42, dictionarySemantropy: 50 });
  // The small template/family order remains canonical; no candidate list is sorted.
  expect(sort).not.toHaveBeenCalled();
  expect(Object.values(sorted).every(Object.isFrozen)).toBe(true);
 });
 it("reports Source counts as distinct surfaces, not frequency/record totals, with no paths", async () => {
  const h = await harness(); await h.apply(["猫猫犬港研究。", "猫鳥研究研究。"]);
  const counts = dictionaryDiagnostics(h.controller().getVocabularySnapshot()!);
  expect(counts.sources.map(s => s.counts.noun)).toEqual([2, 2]); expect(counts.sources.map(s => s.counts.sahen)).toEqual([1, 1]);
  expect(counts.core).toBeGreaterThan(0); expect(counts.totalCore).toBe(90); expect(counts.totalClauses).toBe(31);
  const text = h.peek.contentEl.querySelector(".semantropy-dictionary-diagnostics")!.textContent;
  expect(text).toContain("distinct surfaces"); expect(text).not.toContain("source0.md"); expect(text).not.toContain("ネコ");
 });
 it("distinguishes fixed reasons and unknown availability fails closed", async () => {
  const h = await harness(); const counts = dictionaryDiagnostics(h.controller().getVocabularySnapshot()!);
  const base = { counts, slot: h.current("猫"), level: 50, preparing: false, stale: false };
  expect(dictionaryDiagnosticMessage({ ...base, level: 0 })).toBe(DICTIONARY_DIAGNOSTICS.off);
  expect(dictionaryDiagnosticMessage({ ...base, preparing: true })).toBe(DICTIONARY_DIAGNOSTICS.preparing);
  expect(dictionaryDiagnosticMessage({ ...base, stale: true })).toBe(DICTIONARY_DIAGNOSTICS.stale);
  expect(dictionaryDiagnosticMessage({ ...base, slot: { ...base.slot, dictionaryEligible: false } })).toBe(DICTIONARY_DIAGNOSTICS.unsupported);
  expect(dictionaryDiagnosticMessage({ ...base, counts: { ...counts, core: 0 } })).toBe(DICTIONARY_DIAGNOSTICS.pool);
  expect(dictionaryDiagnosticMessage({ ...base, counts: { ...counts, core: 0, totalCore: 0 } })).toBe(DICTIONARY_DIAGNOSTICS.templates);
  expect(dictionaryDiagnosticMessage({ ...base, slot: { ...base.slot, dictionaryAvailable: false } })).toBe(DICTIONARY_DIAGNOSTICS.unknown);
  expect(new Set(Object.values(DICTIONARY_DIAGNOSTICS)).size).toBe(Object.keys(DICTIONARY_DIAGNOSTICS).length);
 });
});
