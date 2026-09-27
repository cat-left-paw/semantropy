import type { DefineGenerate } from "../src/application/defineSelectedWord";
import type { LocatedAnalysisDocument } from "../src/analysis/locateTokens";
// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { harness, body, text, ready, peek, selection } from "./vocabularyIntegrationHarness";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { MAX, MEDIUM } from "./readyAnalysis";
import { deferred } from "./refreshHarness";
import type { SemantropyViewHost } from "../src/view/SemantropyView";
import * as vocabularyCore from "../src/vocabulary/vocabularySnapshot";
import { readCurrentSourceText } from "../src/application/currentSourceText";
import { testScheduler } from "./support/testScheduler";
import * as display from "../src/render/targetBodyController";
import { snapshotRubyVocabulary } from "../src/application/prepareVocabulary";
import { chooseRubyVariant, chooseVocabularyCandidate } from "../src/analysis/rubyVocabulary";
import { transformTokenSequences } from "../src/transform/transformTokens";
import * as sourceHash from "../src/vocabulary/sha256";
import * as manualMorph from "../src/transform/manualMorphology";
import { analyzeSelectedSource } from "../src/application/analyzeSelectedSource";
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
function external() {
 const h = harness(20, MAX), reads: string[] = [];
 const notes = new Map([["B.md", "森海。森森森。"], ["C.md", "空山。"]]);
 const host = Reflect.get(h.view, "host") as SemantropyViewHost;
 host.listVocabularyNotes = () => [...notes.keys()];
 host.readCurrentText = async path => { reads.push(path); const value = path === "fixture.md" ? h.control.source : notes.get(path); if (value === undefined) throw Error("PRIVATE path reading"); return value; };
 const draft = (paths = ["B.md"], drawMode: "uniform" | "frequency" = "uniform") => h.view.setVocabularyDraft({ mode: "selected", paths, drawMode });
 return { ...h, host, notes, reads, draft };
}
/** Opens the View-owned Vocabulary picker through its Toolbar entry. */
function openPicker(view: Parameters<typeof peek>[0]) {
 peek(view).contentEl.querySelector<HTMLButtonElement>(".semantropy-vocabulary-open")!.click();
 const root = document.querySelector<HTMLElement>(".semantropy-vocabulary-modal")!;
 return { root, selected: () => root.querySelector(".semantropy-vocabulary-selected")!.textContent ?? "",
  close: () => Array.from(root.querySelectorAll("button")).find(b => b.textContent === "Cancel")!.click() };
}
function capture(h: ReturnType<typeof external>) {
 const controller = body(h.view), root = controller.getContainer()!, nodes = Array.from(root.childNodes);
 const picked = selection(nodes[0]!), selected = controller.readSelection(picked);
 document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(picked.getRangeAt());
 const scroller = peek(h.view).contentEl.firstElementChild!; scroller.scrollTop = 79;
 const state = ready(h.view), runtime = Reflect.get(controller, "runtime") as unknown, ticket = Reflect.get(controller, "ticket") as unknown;
 const world = Reflect.get(h.view, "dictionaryWorld") as unknown, snapshot = h.view.getVocabularyState().snapshot;
 return { root, assertUnchanged: () => {
  expect(Array.from(root.childNodes)).toEqual(nodes); nodes.forEach((node, i) => expect(root.childNodes[i]).toBe(node));
  expect(ready(h.view)).toBe(state); expect(Reflect.get(controller, "runtime") as unknown).toBe(runtime); expect(Reflect.get(controller, "ticket") as unknown).toBe(ticket);
  expect(Reflect.get(h.view, "dictionaryWorld") as unknown).toBe(world); expect(h.view.getVocabularyState().snapshot).toBe(snapshot);
  expect(controller.readSelection(document.getSelection())).toEqual(selected); expect(scroller.scrollTop).toBe(79);
  expect(controller.isDisplayIntact()).toBe(true); expect(h.calls.save).toEqual([]); expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
 } };
}

describe("VOCAB1 production integration", () => {
 it.each(["event", "draft", "cancel"])("restores all actions immediately on %s with an unresolved Source read", async cause => {
  const h=external(); await h.open("猫犬。\n".repeat(40)); h.draft(); await h.view.applyVocabulary(); const old=capture(h);
  const actions=Array.from(peek(h.view).contentEl.querySelectorAll("button")).filter(b=>["Reshuffle text","Refresh target","Copy selection","Collect selection","Load next section"].includes(b.textContent));
  expect(actions).toHaveLength(5); expect(actions.every(b=>!b.disabled)).toBe(true);
  const first=deferred<string>(), entered=deferred<void>();
  vi.spyOn(h.host,"readCurrentText").mockImplementationOnce(async()=>{entered.resolve();return await first.promise;});
  h.draft(["C.md"]); const pending=h.view.applyVocabulary(); await entered.promise;
  expect(actions.every(b=>b.disabled)).toBe(true);
  if(cause==="event") h.view.notifyVocabularySourceEvent("C.md");
  if(cause==="draft") h.draft(["B.md"]);
  if(cause==="cancel") h.view.cancelVocabulary();
  // Assert before resolving first: waiting for finally would hide the defect.
  expect(actions.every(b=>!b.disabled)).toBe(true); old.assertUnchanged();
  expect(await h.view.loadNextSection()).toBe("applied");
  const next=deferred<string>(), nextEntered=deferred<void>();
  vi.spyOn(h.host,"readCurrentText").mockImplementationOnce(async()=>{nextEntered.resolve();return await next.promise;});
  h.draft(["C.md"]); const newer=h.view.applyVocabulary(); await nextEntered.promise;
  const session=ready(h.view), snapshot=h.view.getVocabularyState().snapshot, progress=h.view.getVocabularyState().progress;
  first.resolve("森海"); expect(await pending).toBe("aborted");
  expect(actions.every(b=>b.disabled)).toBe(true); expect(ready(h.view)).toBe(session);
  expect(h.view.getVocabularyState().snapshot).toBe(snapshot); expect(h.view.getVocabularyState().progress).toBe(progress); expect(h.view.getVocabularyState().error).toBeNull();
  h.view.cancelVocabulary(); expect(actions.every(b=>!b.disabled)).toBe(true); next.resolve("空山"); expect(await newer).toBe("aborted");
 });
 it("retains stale paths and reasons for active Sources until successful Apply", async()=>{
  const h=external();await h.open("猫犬。\n".repeat(20));h.draft(["B.md","C.md"]);await h.view.applyVocabulary();
  const snapshot=h.view.getVocabularyState().snapshot, logs=vi.spyOn(console,"error");
  h.draft(["draft-only.md"]);h.view.notifyVocabularySourceEvent("draft-only.md","missing");expect(h.view.getVocabularyState().staleSources).toEqual([]);
  h.view.notifyVocabularySourceEvent("B.md");h.view.notifyVocabularySourceEvent("C.md","missing");h.view.notifyVocabularySourceEvent("C.md");
  const expected=[{path:"B.md",reason:"changed"},{path:"C.md",reason:"missing"}];
  expect(h.view.getVocabularyState().staleSources).toEqual(expected);expect(ready(h.view).freshness).toBe("fresh");
  // EXPERIENCE-VOCABULARY1: the Toolbar keeps a short count; each path and reason is in the picker.
  const status=peek(h.view).contentEl.querySelector(".semantropy-vocabulary-status")!;
  expect(status.textContent).toContain("stale: 2 Sources");
  const picker=openPicker(h.view);expect(picker.selected()).toContain("B.md (changed)");expect(picker.selected()).toContain("C.md (missing)");picker.close();
  h.view.cancelVocabulary();expect(h.view.getVocabularyState().staleSources).toEqual(expected);
  h.notes.delete("C.md");h.draft(["B.md","C.md"]);expect(await h.view.applyVocabulary()).toBe("failed");expect(h.view.getVocabularyState().staleSources).toEqual(expected);
  expect(h.view.getVocabularyState().snapshot).toBe(snapshot);expect(JSON.stringify(snapshot)).not.toContain('"missing"');
  expect(await h.view.refreshSource()).toBe("refreshed");expect(h.view.getVocabularyState().staleSources).toEqual(expected);
  h.draft(["B.md"]);expect(await h.view.applyVocabulary()).toBe("applied");expect(h.view.getVocabularyState().staleSources).toEqual([]);expect(status.textContent).not.toContain("missing");
  expect(h.calls.save).toEqual([]);expect(h.calls.collect).toEqual([]);expect(logs).not.toHaveBeenCalled();
 });
 it("keeps stale Source details separate across Views and renders path as plain text",async()=>{
  const a=external(),b=external();await a.open("猫犬。");await b.open("猫犬。");
  const path='<img src=x>.md';a.notes.set(path,"森海");a.draft([path]);await a.view.applyVocabulary();
  a.view.notifyVocabularySourceEvent(path,"missing");
  expect(a.view.getVocabularyState().staleSources).toEqual([{path,reason:"missing"}]);expect(b.view.getVocabularyState().staleSources).toEqual([]);
  const status=peek(a.view).contentEl.querySelector(".semantropy-vocabulary-status")!;expect(status.textContent).toContain("stale: 1 Source");expect(status.querySelector("img")).toBeNull();
  const picker=openPicker(a.view);expect(picker.selected()).toContain(path);expect(picker.root.querySelector("img")).toBeNull();picker.close();
 });

 it("SRC-01/02 applies only external notes, deduplicates normalized paths and uses one immutable Snapshot", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(30)); await h.view.loadNextSection();
  const before = h.control.source, notes = [...h.notes], previousWorld = Reflect.get(h.view, "dictionaryWorld") as unknown;
  h.draft(["B.md", "./B.md", "C.md"]); expect(h.reads).toEqual([]);
  expect(await h.view.applyVocabulary()).toBe("applied"); expect(h.reads).toEqual(["B.md", "C.md"]);
  const snapshot = h.view.getVocabularyState().snapshot!;
  expect(snapshot.sources.map(s => s.path)).toEqual(["B.md", "C.md"]); expect(Object.isFrozen(snapshot)).toBe(true);
  expect(snapshot.projections.automaticBody.buckets.flatMap(b => b.surfaces).find(s => s.surface === "森")?.frequency).toBe(4);
  expect(text(h.view)).not.toMatch(/[猫犬]/u); expect(body(h.view).getChunkStats().chunks).toBe(2);
  expect(Reflect.get(h.view, "dictionaryWorld") as unknown).not.toBe(previousWorld);
  expect(h.control.source).toBe(before); expect([...h.notes]).toEqual(notes);
  expect(h.calls.save).toEqual([]); expect(h.calls.collect).toEqual([]); expect(h.calls.copy).toEqual([]);
 });
 it.each(["森", "猫"])("SRC-03 handles the single candidate %s without fallback", async word => {
  const h = external(); h.notes.set("B.md", word); await h.open("猫\n".repeat(30)); h.draft();
  expect(await h.view.applyVocabulary()).toBe("applied"); expect(text(h.view).replace(/\s/gu, "")).toBe(word.repeat(10));
  expect(ready(h.view).replacementCount).toBe(word === "猫" ? 0 : 10);
 });
 it("SRC-04 switches Uniform/Frequency and canonicalizes input order", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(100)); h.draft(["C.md", "B.md"]);
  expect(await h.view.applyVocabulary()).toBe("applied"); const uniform = h.view.getVocabularyState().snapshot;
  h.draft(["B.md", "C.md"]); expect(await h.view.applyVocabulary()).toBe("applied"); expect(h.view.getVocabularyState().snapshot).toEqual(uniform);
  h.draft(["B.md", "C.md"], "frequency"); expect(await h.view.applyVocabulary()).toBe("applied");
  expect(h.view.getVocabularyState().snapshot?.drawMode).toBe("frequency"); expect(h.view.getVocabularyState().snapshot?.fingerprint).not.toBe(uniform?.fingerprint);
 });
 it.each(["read", "hash", "tokenize", "snapshot", "build", "dom-before", "dom-after"])("SRC-05 rolls back %s and retries exactly once", async failure => {
  const h = external(); await h.open("猫犬。\n".repeat(40)); await h.view.loadNextSection(); const old = capture(h); h.draft(["B.md", "C.md"]);
  const spies: { mockRestore(): void }[] = [];
  if (failure === "read") spies.push(vi.spyOn(h.host, "readCurrentText").mockImplementation(async path => { if(path === "C.md") throw Error("PRIVATE"); return "森"; }));
  if (failure === "tokenize") h.control.failTokens = true;
  if (failure === "hash") spies.push(vi.spyOn(sourceHash, "sha256Hex").mockImplementationOnce(() => { throw Error("PRIVATE"); }));
  if (failure === "snapshot") spies.push(vi.spyOn(vocabularyCore, "buildVocabularySnapshot").mockImplementationOnce(() => { throw Error("PRIVATE"); }));
  if (failure === "build") spies.push(vi.spyOn(display, "buildTargetDisplay").mockRejectedValueOnce(Error("PRIVATE")));
  if (failure.startsWith("dom-")) { const replace = old.root.replaceChildren.bind(old.root); spies.push(vi.spyOn(old.root, "replaceChildren").mockImplementation((...nodes) => { if (failure === "dom-after") replace(...nodes); throw Error("PRIVATE"); })); }
  const logs = vi.spyOn(console, "error");
  expect(await h.view.applyVocabulary()).toBe("failed");
  old.assertUnchanged(); expect(logs).not.toHaveBeenCalled(); expect(h.view.getVocabularyState().error).not.toContain("PRIVATE");
  spies.forEach(s => s.mockRestore()); h.control.failTokens = false;
  const replace = vi.spyOn(old.root, "replaceChildren"); expect(await h.view.applyVocabulary()).toBe("applied"); expect(replace).toHaveBeenCalledOnce();
 });
 it.each(["cancel", "supersede", "event", "focus"])("SRC-05 discards %s preparation without partial Source publication", async operation => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); const old = capture(h), gate = deferred<string>(), entered = deferred<void>(); h.draft();
  const read = vi.spyOn(h.host, "readCurrentText").mockImplementationOnce(async () => { entered.resolve(); return await gate.promise; });
  const pending = h.view.applyVocabulary(); await entered.promise;
  if (operation === "cancel") h.view.cancelVocabulary();
  if (operation === "supersede") h.view.setVocabularyDraft({mode:"selected",paths:["C.md"],drawMode:"frequency"});
  if (operation === "event") h.view.notifyVocabularySourceEvent("B.md");
  if (operation === "focus") h.host.isVocabularyViewActive = () => false;
  gate.resolve("森海"); expect(await pending).toBe("aborted"); old.assertUnchanged(); read.mockRestore();
 });
 it("SRC-06 uses the active pool for Load/Reshuffle/Text/Dictionary without Source re-read", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(30)); h.draft(); expect(await h.view.applyVocabulary()).toBe("applied"); const reads = [...h.reads];
  expect(await h.view.loadNextSection()).toBe("applied"); expect(await h.view.reshuffle({issueSeed:()=>9})).toBe("applied");
  expect(await h.view.setBodySemantropy(MEDIUM)).toBe("applied"); expect(h.reads).toEqual(reads);
  const pool = body(h.view).getDictionaryPool()!; expect(Object.values(pool).flat()).toContain("森"); expect(Object.values(pool).flat()).not.toContain("猫");
 });
 it("reanalyzes Target text through the minting entrance and requires Refresh before mixing new editor text", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); const target = ready(h.view).snapshot; h.draft(["fixture.md", "B.md"]);
  const analyze = vi.spyOn(manualMorph, "analyzeManualMorphSource"); expect(await h.view.applyVocabulary()).toBe("applied");
  expect(h.reads).toEqual(["B.md"]); expect(analyze.mock.calls.map(([input]) => input.sourcePath)).toEqual(["B.md", "fixture.md"]); expect(ready(h.view).snapshot).toBe(target);
  expect(h.view.getVocabularyState().snapshot!.sources.find(s=>s.path==="fixture.md")?.contentHash).toBe(sourceHash.sha256Hex(target.text));
  h.view.notifyVocabularySourceEvent("fixture.md"); expect(await h.view.applyVocabulary()).toBe("refresh-required");
 });
 it("separates Target and Vocabulary stale, ignores draft-only events, and preserves selection on rename/delete", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); h.draft(); await h.view.applyVocabulary();
  h.view.setVocabularyDraft({mode:"selected",paths:["C.md"],drawMode:"uniform"}); h.view.notifyVocabularySourceEvent("C.md");
  expect(h.view.getVocabularyState().stale).toBe(false);
  h.view.notifyVocabularySourceEvent("B.md"); expect(h.view.getVocabularyState().stale).toBe(true); expect(ready(h.view).freshness).toBe("fresh");
  expect(h.view.getVocabularyState().selection.paths).toEqual(["B.md"]); h.view.markSourceLost(); expect(ready(h.view).freshness).toBe("stale");
 });
 it("picker opening and Cancel read metadata only", async () => {
  const h = external(); await h.open("猫犬。"); const snapshot = h.view.getVocabularyState().snapshot;
  const picker = openPicker(h.view);
  expect(h.reads).toEqual([]); expect(picker.root.querySelectorAll('.semantropy-vocabulary-tree input[type="checkbox"]')).toHaveLength(2);
  const cancel = Array.from(picker.root.querySelectorAll("button")).find(b=>b.textContent==="Cancel")!; cancel.click();
  expect(document.querySelector(".semantropy-vocabulary-modal")).toBeNull();
  expect(h.view.getVocabularyState().snapshot).toBe(snapshot); expect(h.reads).toEqual([]);
 });
 it("never shares Snapshot or generation across Views with the same path/hash", async () => {
  const a = external(), b = external(); await a.open("猫犬。"); await b.open("猫犬。");
  expect(a.view.getVocabularyState().snapshot).not.toBe(b.view.getVocabularyState().snapshot); a.draft(); await a.view.applyVocabulary();
  expect(b.view.getVocabularyState().selection.mode).toBe("current"); expect(text(b.view)).not.toContain("森");
 });
 it("documents the Current Note primary draw compatibility and Ruby fingerprint change", async () => {
  const h = external(); await h.open("猫《ねこ》猫《びょう》犬《いぬ》犬《けん》。\n".repeat(5));
  const analyzed = await analyzeSelectedSource({ text: ready(h.view).snapshot.text, sourcePath: "fixture.md", contentHash: sourceHash.sha256Hex(ready(h.view).snapshot.text), tokenizer: h.host.getTokenizer(), mode: "target-prototype" });
  if (analyzed.status !== "ready") throw Error("Expected source");
  const source = analyzed, snapshot = body(h.view).getVocabularySnapshot()!;
  const next = snapshotRubyVocabulary(snapshot), runtime = Reflect.get(body(h.view), "runtime") as { chunks: { model: { located: LocatedAnalysisDocument } }[] };
  let different = false;
  for (let seed = 0; seed < 20; seed++) {
   const transformed = body(h.view).transform(seed, MAX), legacy = transformTokenSequences(ready(h.view).tokenSequences, source.vocabulary.automaticBody, seed, MAX, true);
   expect(transformed.tokenSurfaces).toEqual(legacy.tokenSurfaces); expect(transformed.replacementCount).toBe(legacy.replacementCount); expect(transformed.replaceableSlotCount).toBe(legacy.replaceableSlotCount);
   for (const chunk of runtime.chunks) for (const run of chunk.model.located.runs) for (const item of run.tokens) {
    if(item.token.surface!=="猫") continue;
    const choose = (vocabulary: typeof next) => { const candidate=chooseVocabularyCandidate({vocabulary,original:item.token,surface:"犬",seed,tokenId:item.tokenId});return chooseRubyVariant({vocabulary,original:item.token,selection:candidate,seed,tokenId:item.tokenId})?.variantId; };
    different ||= choose(source.vocabulary)!==choose(next);
   }
  }
  expect(different).toBe(true); expect(ready(h.view).algorithmVersion).toBe(11);
 });
 it.each(["refresh", "open", "close"])("invalidates an Apply on Target %s", async operation => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); h.draft(); const gate = deferred<string>(), entered = deferred<void>();
  vi.spyOn(h.host, "readCurrentText").mockImplementationOnce(async () => { entered.resolve(); return await gate.promise; });
  const pending = h.view.applyVocabulary(); await entered.promise;
  if (operation === "refresh") expect(await h.view.refreshSource()).toBe("refreshed");
  if (operation === "open") await h.open("鳥魚。\n".repeat(20));
  if (operation === "close") await h.view.onClose();
  const committed = peek(h.view).session.getState(); gate.resolve("森海"); expect(await pending).toBe("aborted");
  expect(peek(h.view).session.getState()).toBe(committed); expect(h.view.getVocabularyState().selection.mode).toBe("current");
 });
 it("a second Apply supersedes a pending first Apply without sharing generation", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); h.draft(); const gate = deferred<string>(), entered = deferred<void>();
  vi.spyOn(h.host, "readCurrentText").mockImplementationOnce(async () => { entered.resolve(); return await gate.promise; });
  const first = h.view.applyVocabulary(); await entered.promise; h.draft(["C.md"]); expect(await h.view.applyVocabulary()).toBe("applied");
  const next = h.view.getVocabularyState().snapshot; gate.resolve("森海"); expect(await first).toBe("aborted"); expect(h.view.getVocabularyState().snapshot).toBe(next);
 });
 it("refresh reuses external captures and renews an explicitly selected Target from the same capture", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); h.draft(["B.md", "fixture.md"]); await h.view.applyVocabulary(); h.reads.length = 0;
  h.control.source = "鳥魚。\n".repeat(20); h.view.notifyVocabularySourceEvent("fixture.md");
  expect(await h.view.refreshSource({hashText:async()=>"new-target"})).toBe("refreshed"); expect(h.reads).toEqual(["fixture.md"]);
  expect(h.view.getVocabularyState().selection.paths).toEqual(["B.md", "fixture.md"]);
  expect(h.view.getVocabularyState().snapshot!.sources.find(s=>s.path==="fixture.md")?.contentHash).toBe(sourceHash.sha256Hex(h.control.source));
  expect(h.view.getVocabularyState().stale).toBe(true); h.draft(["fixture.md"]); expect(await h.view.applyVocabulary()).toBe("applied"); expect(h.view.getVocabularyState().stale).toBe(false);
 });
 it("uses an unsaved editor buffer, including empty text, before the saved Selected Note", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); const saved = vi.fn(async()=>"山空"); let editor = "森海";
  h.host.readCurrentText = path => readCurrentSourceText(path, { readEditorText:()=>editor, readSavedText:saved }); h.draft();
  expect(await h.view.applyVocabulary()).toBe("applied"); expect(saved).not.toHaveBeenCalled(); expect(text(h.view)).not.toMatch(/[山空]/u);
  editor = ""; expect(await h.view.applyVocabulary()).toBe("applied"); expect(saved).not.toHaveBeenCalled(); expect(ready(h.view).replacementCount).toBe(0);
 });
 it("cooperatively reports progress and cancels a multiline Source without publishing it", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); const old = capture(h); h.notes.set("B.md", "森海。\n".repeat(4000)); h.draft();
  const observed: number[] = [];
  h.control.scheduler = testScheduler({tickMs:9,onYield:()=>{ const progress=h.view.getVocabularyState().progress; if(progress) { observed.push(progress.total); h.view.cancelVocabulary(); } }}).scheduler;
  expect(await h.view.applyVocabulary()).toBe("aborted"); expect(observed).toContain(1); old.assertUnchanged();
 });
 it("RUBY-03/CHUNK-06 uses multiline Source Ruby bases and creates no unloaded Target metadata", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(100)); h.notes.set("B.md", "森《もり》。\n海《うみ》。\n山《やま》。"); h.draft();
  expect(await h.view.applyVocabulary()).toBe("applied"); const snapshot=h.view.getVocabularyState().snapshot!;
  expect(snapshot.candidates.map(c=>c.surface).filter(s=>/[森海山]/u.test(s))).toEqual(expect.arrayContaining(["森","海","山"]));
  for (const reading of ["もり", "うみ", "やま"]) expect(snapshot.projections.automaticBody.buckets.flatMap(b=>b.surfaces.map(s=>s.surface))).not.toContain(reading);
  expect(body(h.view).getChunkStats().chunks).toBe(1); expect(body(h.view).getContainer()!.querySelectorAll("ruby").length).toBeGreaterThan(0);
  const runtime=Reflect.get(body(h.view),"runtime") as {index:object;descriptors:object[];chunks:object[]};
  const keys: string[]=[]; const walk=(value:unknown)=>{if(value&&typeof value==="object") for(const [key,child] of Object.entries(value)){keys.push(key);walk(child);}};
  walk(runtime.index); walk(runtime.descriptors); expect(keys.join(" ")).not.toMatch(/tokens|document|displayPlan|bindings|listener|selection|hover/);
  expect(runtime.chunks).toHaveLength(1);
 });
 it("Source resources cannot invoke renderer, create active elements, fetch, or write", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); h.notes.set("B.md", '森。\n\n![image](https://invalid.example/a)\n\n<img src="https://invalid.example/b">\n\n海。'); h.draft();
  const fetch=vi.spyOn(globalThis,"fetch"); const create=vi.spyOn(document,"createElement");
  expect(await h.view.applyVocabulary()).toBe("applied"); expect(fetch).not.toHaveBeenCalled();
  for (const tag of ["img", "iframe", "script", "object", "embed", "video", "audio"]) expect(create.mock.calls.map(call=>call[0])).not.toContain(tag);
  expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]); expect(h.calls.save).toEqual([]);
 });
 it("Fake Dictionary receives only the same active Snapshot projection and never reanalyzes Sources", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); h.draft(); await h.view.applyVocabulary(); const reads=[...h.reads], beforeTokens=h.calls.tokenize.length;
  const node=body(h.view).getTextNodes().find(n=>n.data.trim())!; const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);
  const generate=vi.fn<DefineGenerate>(request=>{ expect(request.pool).toBe(body(h.view).getDictionaryPool()); expect(Object.values(request.pool).flat()).not.toContain("猫"); return {outcome:"insufficient-vocabulary",missingPlaceholders:["place"]}; });
  expect(await h.view.defineSelectedWord({selection:{rangeCount:1,getRangeAt:()=>range},issueSeed:()=>1,generate})).toBe("ready");
  expect(generate).toHaveBeenCalledOnce(); expect(h.reads).toEqual(reads); expect(h.calls.tokenize.length-beforeTokens).toBe(0);
  const request=generate.mock.calls[0]; expect(request).toBeDefined();
 });

 it.each(["false", "throw"])("keeps every state when the session rejects Apply: %s", async rejection => {
  const h=external(); await h.open("猫犬。\n".repeat(20)); const old=capture(h); h.draft();
  const session=peek(h.view).session;
  const reject=vi.spyOn(session,"updateMaterializedAnalysis").mockImplementationOnce(()=>{if(rejection==="throw") throw Error("PRIVATE");return false;});
  expect(await h.view.applyVocabulary()).toBe(rejection==="throw" ? "failed" : "aborted"); old.assertUnchanged();
  reject.mockRestore(); expect(await h.view.applyVocabulary()).toBe("applied");expect(body(h.view).getChunkStats().chunks).toBe(1);
 });
 it("releases Selected Notes and errors on close, then reopens with defaults", async () => {
  const h=external();await h.open("猫犬。\n".repeat(20));h.draft();await h.view.applyVocabulary();
  h.draft([]);expect(await h.view.applyVocabulary()).toBe("failed");
  await h.view.onClose();const closed=h.view.getVocabularyState();
  expect(closed.snapshot).toBeNull();expect(closed.selection).toEqual({mode:"current",paths:[],drawMode:"uniform"});expect(closed.error).toBeNull();
  await h.view.onOpen();expect(h.view.getVocabularyState().selection).toEqual(closed.selection);
 });
 it("restores a backward native selection on publication failure", async () => {
  const h = external(); await h.open("猫犬。\n".repeat(20)); const root=body(h.view).getContainer()!;
  const node=body(h.view).getTextNodes().find(n=>n.data.length>=1)!; const selected=document.getSelection()!;
  selected.setBaseAndExtent(node,1,node,0); const before=body(h.view).readSelection(selected);
  const replace=root.replaceChildren.bind(root); vi.spyOn(root,"replaceChildren").mockImplementation((...nodes)=>{replace(...nodes);throw Error("publication");});
  h.draft(); expect(await h.view.applyVocabulary()).toBe("failed");
  expect(selected.anchorNode).toBe(node); expect(selected.anchorOffset).toBe(1); expect(selected.focusNode).toBe(node); expect(selected.focusOffset).toBe(0);
  expect(body(h.view).readSelection(selected)).toEqual(before);
 });

});
