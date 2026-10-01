// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawCollisionRecipe } from "../src/collision/patternData";
import { collisionBatchRecipeOptions, collisionFragmentFromBatch } from "../src/collision/collisionBatch";
import type { CollisionSession } from "../src/view/CollisionSession";
import { COLLISION_ROW_PENDING_DELAY_MS, type CollisionModal } from "../src/view/CollisionModal";
import type { SemantropyView } from "../src/view/SemantropyView";
import { SemantropyPlugin } from "../src/SemantropyPlugin";
import type { CooperativeScheduler } from "../src/render/cooperativeScheduler";
import type { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import * as core from "../src/collision/collisionCore";
import { collectFragmentV4 as collectFragment } from "../src/collect/v4/CollectFragmentUseCaseV4";
import { MarkdownFragmentRepositoryV4 as MarkdownFragmentRepository } from "../src/collect/v4/FragmentRepositoryV4";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer } from "./support/manualMorphHarness";
import { immediateScheduler } from "./support/testScheduler";
import { nounRecipe, token, unwrap } from "./collisionBatchFixtures";

// Generated data substitution is test-only; runtime exposes no pattern/pool injection.
const fixture = vi.hoisted(() => ({ recipes: null as readonly RawCollisionRecipe[] | null }));
vi.mock("../src/collision/generated/standardCollisionPatternEntries", async importOriginal => {
	const actual = await importOriginal<typeof import("../src/collision/generated/standardCollisionPatternEntries")>();
	return { ...actual, get STANDARD_COLLISION_RECIPES() { return fixture.recipes ?? actual.STANDARD_COLLISION_RECIPES; } };
});

let restore: () => void;
const views: SemantropyView[] = [];
beforeAll(() => { restore = installObsidianDomHelpers(); });
beforeEach(() => {
	let entropy = 0;
	vi.spyOn(document.defaultView!.crypto, "getRandomValues").mockImplementation(array => {
		if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(++entropy);
		return array;
	});
});
afterAll(() => restore());
afterEach(async () => {
	for (const view of views.splice(0)) await view.onClose();
	vi.restoreAllMocks(); fixture.recipes = null; document.body.replaceChildren();
});
const words = ["都市", "猫", "海", "星", "雲", "森", "犬", "机", "光", "夢", "雨", "鳥"];
const rich = [...words.map(word => token(word)), token("研究", { detail1: "サ変接続" }),
	token("眠る", { pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形" })];
const sourceText = rich.map(word => word.surface).join("");
const session = (view: SemantropyView) => Reflect.get(view, "collisionSession") as CollisionSession;
const modal = (view: SemantropyView) => Reflect.get(view, "collisionModal") as CollisionModal;
const batch = (view: SemantropyView) => session(view).read()!.batch!;
function button(root: ParentNode, name: string) {
	const found = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === name);
	if (!found) throw Error(`Missing test button: ${name}`); return found;
}
function select(root: ParentNode, name: string, value?: string) {
	const el = root.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;
	if (value !== undefined) { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); }
	return el;
}
const rows = (view: SemantropyView) => Array.from(modal(view).contentEl.querySelectorAll<HTMLElement>(".semantropy-collision-row"));
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function stepping() {
	const waiting: { phase: string; done: () => void }[] = [];
	const hold = (phase: string) => new Promise<void>(done => waiting.push({ phase, done }));
	const scheduler: CooperativeScheduler = { now: () => performance.now(), paint: () => hold("paint"), yieldTask: () => hold("task") };
	return { scheduler, waiting, async step() { expect(waiting.length).toBeGreaterThan(0); waiting.shift()!.done(); await flush(); },
		async drain() { for (let i = 0; waiting.length && i < 30; i++) { waiting.shift()!.done(); await flush(); } expect(waiting).toHaveLength(0); } };
}
async function harness(text = sourceText, target = true) {
	const h = manualMorphHarness(lexiconTokenizer(rich), 20); views.push(h.view);
	if (target) await h.open(text);
	else { await h.view.onOpen(); await h.apply([text]); }
	h.view.openCollision(); return h;
}
async function generate(view: SemantropyView, count: 10 | 20 | 50 = 10, recipe = "") {
	await session(view).generate(count, recipe); expect(batch(view)).toBeTruthy(); return batch(view);
}

describe("Collision production View transactions", () => {
	it.each([10, 20, 50] as const)("generates %i Random results through BATCH1 and captures the active owner once", async count => {
		const h = await harness(); const oldPlan = h.plan(), owner = h.controller().getVocabularyOwner();
		const reads = h.calls.reads.length, tokens = h.calls.tokenizations.length;
		const spy = vi.spyOn(core, "generateCollisionResults");
		const generated = await generate(h.view, count);
		expect(generated.actualCount).toBe(count); expect(generated.vocabularyOwner).toBe(owner);
		expect(spy).toHaveBeenCalledTimes(1); expect(spy.mock.calls[0]![0].count).toBe(count);
		expect(rows(h.view)).toHaveLength(count); expect(h.plan()).toBe(oldPlan);
		expect(h.calls.reads).toHaveLength(reads); expect(h.calls.tokenizations).toHaveLength(tokens);
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
	});
	it("offers default 10, Random or fixed patterns, and rows regenerate their own pattern without a selector", async () => {
		const h = await harness(); const root = modal(h.view).contentEl;
		expect(select(root, "Count").value).toBe("10");
		expect(Array.from(select(root, "Count").options).map(o => o.value)).toEqual(["10", "20", "50"]);
		expect(select(root, "Default pattern").value).toBe("");
		select(root, "Default pattern", "named"); button(root, "Generate").click(); await flush();
		expect(batch(h.view).rows.every(row => row.committed.recipeId === "named")).toBe(true);
		// 0.1.0 S1: no per-row pattern selector; the row's actions are icon buttons named by aria-label.
		expect(rows(h.view)[0]!.querySelector("select")).toBeNull();
		expect(Array.from(rows(h.view)[0]!.querySelectorAll(".semantropy-modal-row-action.is-icon-only")).map(b => b.getAttribute("aria-label")))
			.toEqual(["Regenerate", "Cancel", "Copy", "Collect"]);
	});
	it("generates from Selected Notes without a Target and preserves failed or cancelled Apply", async () => {
		const h = await harness(sourceText, false);
		expect(h.view.getSourcePath()).toBeNull(); expect(h.controller().getContainer()).toBeNull();
		const old = await generate(h.view); expect(old.vocabulary.sources.map(s => s.path)).toEqual(["source0.md"]);
		h.view.setVocabularyDraft({ mode: "selected", paths: ["missing.md"], drawMode: "frequency" });
		expect(await h.view.applyVocabulary()).toBe("failed"); expect(batch(h.view)).toBe(old);
		expect(h.view.getVocabularyState().snapshot).toBe(old.vocabularyOwner.snapshot);
		let deliver!: (text: string) => void;
		const pendingRead = new Promise<string>(resolve => { deliver = resolve; }); h.host.readCurrentText = () => pendingRead;
		const pending = h.view.applyVocabulary(); await flush(); h.view.cancelVocabulary();
		expect(h.view.getVocabularyState().snapshot).toBe(old.vocabularyOwner.snapshot);
		deliver(sourceText); expect(await pending).toBe("aborted");
	});
	it("commits a nonzero partial as a new batch and reports its shortfall without a rollback claim", async () => {
		fixture.recipes = [nounRecipe()]; const h = await harness();
		const old = await generate(h.view, 10, "single");
		expect(await h.apply(["猫"])).toBe("applied");
		const partial = await generate(h.view, 50, "single");
		expect(partial).not.toBe(old); expect(partial.status).toBe("partial"); expect(partial.actualCount).toBe(1);
		const text = modal(h.view).contentEl.textContent;
		expect(text).toContain("Partial batch generated: 1 / 50 results.");
		expect(text).toContain("Not enough distinct results."); expect(text).not.toContain("previous results are retained");
	});
	it("keeps the old batch on zero nouns and fixed nonviable recipes without fallback", async () => {
		const h = await harness(); const old = await generate(h.view);
		await h.apply(["猫犬"]); await session(h.view).generate(10, "question");
		expect(batch(h.view)).toBe(old); expect(modal(h.view).contentEl.textContent).toContain("Required modifiers or predicates may be unavailable");
		await h.apply(["。"]); await session(h.view).generate(10, "");
		expect(batch(h.view)).toBe(old); expect(modal(h.view).contentEl.textContent).toContain("no usable nouns");
	});
	it("regenerates only the chosen row with its own pattern and keeps every other row", async () => {
		const h = await harness(); const old = await generate(h.view, 10, "named");
		const first = old.rows[0]!, slot = first.rowSlotId, oldRows = rows(h.view), root = modal(h.view).contentEl;
		const list = root.querySelector<HTMLElement>(".semantropy-collision-rows")!; list.scrollTop = 85;
		await session(h.view).write(slot, "copy"); await session(h.view).write(slot, "collect");
		expect(h.calls.copy).toEqual([first.committed.text]);
		expect(h.calls.collect[0]).toMatchObject({ patternId: "named", rowId: first.committed.rowId, batchId: old.batchId });
		button(oldRows[0]!, "Regenerate").focus(); await session(h.view).regenerate(slot);
		const next = batch(h.view); expect(next.rows[0]!.committed.recipeId).toBe("named");
		expect(next.rows[0]!.rowSlotId).toBe(slot); expect(next.rows[0]!.committed.rowId).not.toBe(first.committed.rowId);
		expect(next.rows[0]!.committed.generationRevision).toBe(2);
		for (let i = 1; i < old.rows.length; i++) { expect(next.rows[i]).toBe(old.rows[i]); expect(rows(h.view)[i]).toBe(oldRows[i]); }
		expect(rows(h.view)[0]).toBe(oldRows[0]); expect(document.activeElement).toBe(button(oldRows[0]!, "Regenerate"));
		expect(list.scrollTop).toBe(85); expect(root).toBe(modal(h.view).contentEl);
		await session(h.view).write(slot, "collect");
		expect(h.calls.collect[1]).toMatchObject({ patternId: "named", rowId: next.rows[0]!.committed.rowId, batchId: old.batchId });
		expect(Object.keys(h.calls.collect[1]!).sort()).toEqual(["algorithmVersion", "batchId", "metadataVersion", "patternId", "patternSetVersion", "rowId", "text", "type", "vocabulary"]);
	});
	it("shows hidden Current pattern as text while omitting it from the default selector and regenerates Same pattern", async () => {
		fixture.recipes = [{ ...nounRecipe("hidden", false), label: '<b>hidden</b>' }, { ...nounRecipe("disabled", false, false) }];
		const h = await harness(); const old = await generate(h.view); const row = rows(h.view)[0]!;
		expect(row.textContent).toContain("Current pattern: <b>hidden</b>"); expect(row.querySelector("b")).toBeNull();
		expect(select(modal(h.view).contentEl, "Default pattern").options).toHaveLength(1);
		expect(row.querySelector("select")).toBeNull();
		await session(h.view).regenerate(old.rows[0]!.rowSlotId);
		expect(batch(h.view).rows[0]!.committed.generationRevision).toBe(2);
		expect(batch(h.view).rows[0]!.committed.recipeId).toBe("hidden");
	});
	it("returns frozen viable options only for genuine batches", async () => {
		const h = await harness("猫犬"); const current = await generate(h.view);
		const options = unwrap(collisionBatchRecipeOptions(current));
		expect(Object.isFrozen(options)).toBe(true); expect(options.every(Object.isFrozen)).toBe(true);
		expect(options.map(o => o.id)).not.toContain("question"); expect(options.map(o => o.id)).not.toContain("sahen-noun");
		expect(collisionBatchRecipeOptions({ ...current })).toEqual({ ok: false, reason: "invalid-state" });
		expect(collisionBatchRecipeOptions(null as never)).toEqual({ ok: false, reason: "invalid-state" });
	});
});

describe("Collision lifecycle and asynchronous boundaries", () => {
	it.each(["before", "after"])("keeps the previous batch on cancel %s prepare and ignores late completion", async phase => {
		const h = await harness(); const old = await generate(h.view); h.view.closeCollision();
		// Reopen with a controlled scheduler, then seed one batch using immediate scheduling.
		const gates = stepping(); h.host.scheduler = gates.scheduler; h.view.openCollision();
		const first = session(h.view).generate(10, "named"); await gates.drain(); await first;
		const retained = batch(h.view); expect(retained.batchId).not.toBe(old.batchId);
		const spy = vi.spyOn(core, "generateCollisionResults");
		const task = session(h.view).generate(20, ""); expect(modal(h.view).contentEl.textContent).toContain("Generating…");
		expect(batch(h.view)).toBe(retained); expect(spy).not.toHaveBeenCalled();
		if (phase === "after") { await gates.step(); await gates.step(); expect(spy).toHaveBeenCalledOnce(); }
		session(h.view).cancel("generate"); await gates.drain(); await task;
		expect(batch(h.view)).toBe(retained); expect(rows(h.view)).toHaveLength(10);
	});
	it("disables only the pending row writes, permits other rows, and merges separate row completions", async () => {
		const h = await harness(); h.view.closeCollision(); const gates = stepping(); h.host.scheduler = gates.scheduler; h.view.openCollision();
		const initial = session(h.view).generate(10, "named"); await gates.drain(); await initial;
		const old = batch(h.view), ui = rows(h.view), a = old.rows[0]!.rowSlotId, b = old.rows[1]!.rowSlotId;
		const first = session(h.view).regenerate(a);
		expect(button(ui[0]!, "Copy").disabled).toBe(true); expect(button(ui[0]!, "Collect").disabled).toBe(true);
		expect(button(ui[1]!, "Copy").disabled).toBe(false); expect(button(ui[1]!, "Collect").disabled).toBe(false);
		button(ui[0]!, "Copy").click(); await session(h.view).write(a, "collect"); expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
		button(ui[1]!, "Copy").click(); await flush(); expect(h.calls.copy).toEqual([old.rows[1]!.committed.text]);
		const second = session(h.view).regenerate(b); await gates.drain(); await Promise.all([first, second]);
		expect(batch(h.view).rows[0]!.committed.generationRevision).toBe(2); expect(batch(h.view).rows[1]!.committed.generationRevision).toBe(2);
		for (let i = 2; i < 10; i++) expect(batch(h.view).rows[i]).toBe(old.rows[i]);
		expect(button(ui[0]!, "Copy").disabled).toBe(false);
	});
	it("shows a row's Regenerating note and Cancel only when the work outlasts the delay, so a quick regenerate does not flicker (0.1.0)", async () => {
		const h = await harness(); h.view.closeCollision(); const gates = stepping(); h.host.scheduler = gates.scheduler; h.view.openCollision();
		const initial = session(h.view).generate(10, "named"); await gates.drain(); await initial;
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		try {
			const ui = rows(h.view)[0]!, a = batch(h.view).rows[0]!.rowSlotId;
			const status = ui.querySelector<HTMLElement>('p[role="status"]')!, cancel = button(ui, "Cancel");
			const seen: string[] = [];
			const observer = new MutationObserver(() => seen.push(status.textContent ?? "")); observer.observe(status, { childList: true, characterData: true, subtree: true });
			// Quick: the regeneration finishes inside the delay; the note never appears and Cancel stays hidden.
			const quick = session(h.view).regenerate(a);
			expect(ui.getAttribute("aria-busy")).toBe("true");
			expect([status.textContent, cancel.hidden]).toEqual(["", true]);
			await gates.drain(); await quick; await flush();
			expect(seen.some(text => text.includes("Regenerating"))).toBe(false);
			expect(cancel.hidden).toBe(true);
			// Slow: past the delay the note and Cancel appear, and go when the work ends.
			const slow = session(h.view).regenerate(a);
			vi.advanceTimersByTime(COLLISION_ROW_PENDING_DELAY_MS - 1);
			expect([status.textContent, cancel.hidden]).toEqual(["", true]);
			vi.advanceTimersByTime(1);
			expect(status.textContent).toBe("Regenerating…"); expect(cancel.hidden).toBe(false);
			await gates.drain(); await slow; await flush();
			expect(status.textContent).not.toContain("Regenerating"); expect(cancel.hidden).toBe(true);
			observer.disconnect();
		} finally { vi.useRealTimers(); }
	});
	it("supersedes old Generate and same-row regeneration without advancing the discarded revision", async () => {
		const h = await harness(); h.view.closeCollision(); const gates = stepping(); h.host.scheduler = gates.scheduler; h.view.openCollision();
		const oldGenerate = session(h.view).generate(10, "named"); await gates.step(); await gates.step();
		const newGenerate = session(h.view).generate(20, "purpose"); await gates.drain(); await Promise.all([oldGenerate, newGenerate]);
		expect(batch(h.view).actualCount).toBe(20); expect(batch(h.view).rows.every(r => r.committed.recipeId === "purpose")).toBe(true);
		const slot = batch(h.view).rows[0]!.rowSlotId;
		const oldRow = session(h.view).regenerate(slot); await gates.step(); await gates.step();
		const newRow = session(h.view).regenerate(slot); await gates.drain(); await Promise.all([oldRow, newRow]);
		expect(batch(h.view).rows[0]!.committed.generationRevision).toBe(2);
	});
	it("preserves old rows on generation failure and duplicate exhaustion", async () => {
		fixture.recipes = [nounRecipe()]; const h = await harness("猫"); const old = await generate(h.view);
		await session(h.view).regenerate(old.rows[0]!.rowSlotId); expect(batch(h.view)).toBe(old);
		const spy = vi.spyOn(core, "generateCollisionResults").mockImplementation(() => { throw Error("private body path surface nonce"); });
		await session(h.view).generate(20, ""); expect(batch(h.view)).toBe(old);
		await session(h.view).regenerate(old.rows[0]!.rowSlotId); expect(batch(h.view)).toBe(old);
		expect(modal(h.view).contentEl.textContent).not.toContain("private body path surface nonce"); spy.mockRestore();
	});
	it("uses captured vocabulary after stale and after Apply; only Generate captures the new owner", async () => {
		const h = await harness(); const old = await generate(h.view); const slot = old.rows[0]!.rowSlotId;
		h.view.notifyVocabularySourceEvent("target.md"); const counts = [h.calls.reads.length, h.calls.tokenizations.length];
		await session(h.view).regenerate(slot); expect(batch(h.view).vocabularyOwner).toBe(old.vocabularyOwner);
		expect([h.calls.reads.length, h.calls.tokenizations.length]).toEqual(counts);
		expect(modal(h.view).contentEl.textContent).toContain("Captured vocabulary is stale or no longer active");
		expect(modal(h.view).contentEl.textContent).not.toContain("target.md");
		const stale = batch(h.view); await session(h.view).generate(10, ""); expect(batch(h.view)).toBe(stale);
		expect(await h.apply(["猫犬机森雲海星夢"])).toBe("applied");
		await session(h.view).regenerate(slot); expect(batch(h.view).vocabularyOwner).toBe(old.vocabularyOwner);
		const fresh = await generate(h.view); expect(fresh.vocabularyOwner).toBe(h.controller().getVocabularyOwner());
		expect(fresh.vocabularyOwner).not.toBe(old.vocabularyOwner);
	});
	it.each(["source", "apply", "refresh"])("refuses Generate completion when %s changes after prepare", async change => {
		const h = await harness(); h.view.closeCollision(); const gates = stepping(); h.host.scheduler = gates.scheduler; h.view.openCollision();
		const initial = session(h.view).generate(10, "named"); await gates.drain(); await initial;
		const old = batch(h.view), pending = session(h.view).generate(20, "purpose"); await gates.step(); await gates.step();
		h.host.scheduler = immediateScheduler(); // Apply/Refresh proceed; the Collision session retains its own gate.
		if (change === "source") h.view.notifyVocabularySourceEvent("target.md");
		else if (change === "apply") expect(await h.apply(["猫犬星海"])).toBe("applied");
		else { h.state.text += "猫"; expect(await h.view.refreshSource()).toBe("refreshed"); }
		await gates.drain(); await pending; expect(batch(h.view)).toBe(old);
	});
	it("cancels a prepared row on selector change or explicit cancel and Generate supersedes every row", async () => {
		const h = await harness(); h.view.closeCollision(); const gates = stepping(); h.host.scheduler = gates.scheduler; h.view.openCollision();
		const initial = session(h.view).generate(10, "named"); await gates.drain(); await initial;
		const old = batch(h.view), slot = old.rows[0]!.rowSlotId;
		for (const cancel of [() => session(h.view).cancel(slot), () => session(h.view).select(slot, { kind: "fixed", recipeId: "purpose" })]) {
			const task = session(h.view).regenerate(slot); await gates.step(); await gates.step(); cancel(); await gates.drain(); await task;
			expect(batch(h.view)).toBe(old); expect(button(rows(h.view)[0]!, "Copy").disabled).toBe(false);
		}
		const a = session(h.view).regenerate(slot), b = session(h.view).regenerate(old.rows[1]!.rowSlotId);
		const replacement = session(h.view).generate(20, "purpose"); await gates.drain(); await Promise.all([a, b, replacement]);
		expect(batch(h.view).rows).toHaveLength(20); expect(batch(h.view).rows.every(row => row.committed.generationRevision === 1)).toBe(true);
	});
	it("rejects hidden or disabled fixed requests and fresh-material failures without leaking payloads", async () => {
		fixture.recipes = [nounRecipe(), nounRecipe("hidden", false), nounRecipe("disabled", false, false)];
		const spy = vi.spyOn(document.defaultView!.crypto, "getRandomValues");
		const h = await harness(), old = await generate(h.view, 10, "single");
		for (const recipe of ["hidden", "disabled"]) { await session(h.view).generate(10, recipe); expect(batch(h.view)).toBe(old); }
		const calls = spy.mock.calls.filter(([array]) => array?.byteLength === 32).map(([array]) => Array.from(new Uint8Array(array.buffer)).join(","));
		expect(calls.length).toBeGreaterThanOrEqual(4); expect(new Set(calls).size).toBe(calls.length);
		spy.mockImplementation(() => { throw Error("private nonce path source surface reading"); });
		await session(h.view).generate(20, ""); expect(batch(h.view)).toBe(old);
		expect(modal(h.view).contentEl.textContent).not.toContain("private nonce");
		h.view.closeCollision(); h.view.openCollision(); expect(modal(h.view).contentEl.textContent).toContain("Collision is unavailable.");
		expect(button(modal(h.view).contentEl, "Generate").disabled).toBe(true);
	});
	it.each(["modal", "view", "disable"])("rejects late completion after %s close, releases references and keeps another View independent", async how => {
		const a = await harness(), b = await harness(); await generate(b.view); const other = batch(b.view);
		a.view.closeCollision(); const gates = stepping(); a.host.scheduler = gates.scheduler; a.view.openCollision();
		const owner = session(a.view), ui = modal(a.view); const task = owner.generate(10, "named"); await gates.step(); await gates.step();
		if (how === "modal") ui.close();
		else if (how === "view") await a.view.onClose();
		else {
			// Invoke the production plugin disable hook with its actual View list.
			SemantropyPlugin.prototype.onunload.call({ automaticCoordinator: { dispose() {} }, semantropyViews: () => [a.view], settingTab: null, tokenizer: null, notices: new Map(), removeRibbon: () => undefined } as never);
			a.view.openCollision(); expect(modal(a.view)).toBeNull();
		}
		await gates.drain(); await task;
		expect(owner.read()).toBeNull(); expect(Reflect.get(owner, "host")).toBeNull(); expect(owner.changed).toBeNull();
		expect(ui.contentEl.children).toHaveLength(0); expect(batch(b.view)).toBe(other);
		expect(a.calls.copy).toEqual([]); expect(a.calls.collect).toEqual([]);
	});
	it("reopens with fresh identity and defaults, restores toolbar focus, and removes old event handlers", async () => {
		const h = await harness(); h.view.closeCollision(); const entry = h.peek.contentEl.querySelector<HTMLButtonElement>(".semantropy-collision-open")!;
		entry.focus(); entry.click(); const oldUi = modal(h.view), owner = session(h.view); await generate(h.view);
		const oldButton = button(rows(h.view)[0]!, "Copy"); select(oldUi.contentEl, "Count", "50");
		oldUi.close(); expect(document.activeElement).toBe(entry); oldButton.click(); expect(h.calls.copy).toEqual([]);
		entry.click(); expect(session(h.view)).not.toBe(owner); expect(session(h.view).read()!.batch).toBeNull();
		expect(select(modal(h.view).contentEl, "Count").value).toBe("10");
	});
});

describe("Collision write boundary", () => {
	it("refuses every captured Vocabulary Source before any storage call", async () => {
		const h = await harness(); await h.apply(["猫犬机森", "星雲海夢"]); const generated = await generate(h.view);
		const inspect = vi.fn(), create = vi.fn(), process = vi.fn(); let destination = "source0.md";
		const repository = new MarkdownFragmentRepository({ inspect, create, process }, () => destination);
		h.host.collectFragment = input => collectFragment(input, { repository, newId: () => "11111111-2222-4333-8444-555555555555", now: () => new Date("2026-09-21T00:00:00Z") });
		for (const source of generated.vocabulary.sources) {
			destination = source.path; await session(h.view).write(generated.rows[0]!.rowSlotId, "collect");
			expect(rows(h.view)[0]!.textContent).toContain("cannot be used as the Collection file");
		}
		expect(inspect).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(process).not.toHaveBeenCalled();
	});
	it("does not update a regenerated row with an old write completion or disclose host errors", async () => {
		const h = await harness(); const generated = await generate(h.view); const slot = generated.rows[0]!.rowSlotId;
		let done!: () => void; h.host.writeClipboard = () => new Promise<void>(resolve => { done = resolve; });
		const pending = session(h.view).write(slot, "copy"); await session(h.view).regenerate(slot); done(); await pending;
		expect(rows(h.view)[0]!.textContent).not.toContain("Copied.");
		h.host.collectFragment = () => { throw Error("secret/path.md private surface nonce"); };
		await session(h.view).write(slot, "collect"); expect(rows(h.view)[0]!.textContent).toContain("Could not collect Collision.");
		expect(modal(h.view).contentEl.textContent).not.toContain("secret/path.md");
	});
	it("drops write feedback after close and keeps other-row feedback through regeneration", async () => {
		const h = await harness(), old = await generate(h.view), owner = session(h.view);
		await owner.write(old.rows[1]!.rowSlotId, "collect"); const other = rows(h.view)[1]!.textContent;
		await owner.regenerate(old.rows[0]!.rowSlotId); expect(rows(h.view)[1]!.textContent).toBe(other);
		let done!: () => void; h.host.writeClipboard = () => new Promise<void>(resolve => { done = resolve; });
		const task = owner.write(old.rows[0]!.rowSlotId, "copy"); h.view.closeCollision(); done(); await task;
		expect(Reflect.get(owner, "feedback")).toEqual(new Map()); expect(owner.read()).toBeNull();
	});
	it("makes genuine Collect inputs only and never mutates the existing Body/Manual/Dictionary state", async () => {
		const h = await harness(); await h.apply([sourceText]);
		h.controller().shuffleManual(h.current("猫"));
		const range = document.createRange(); range.selectNodeContents(h.root().querySelector(".semantropy-token")!);
		expect(await h.view.defineSelectedWord({ selection: { rangeCount: 1, getRangeAt: () => range } })).toBe("ready");
		const dictionary = Reflect.get(h.view, "dictionaryWorld") as FakeDictionaryWorld, definition = dictionary.getCurrent();
		expect(definition).not.toBeNull();
		const plan = h.plan(), runtime: unknown = Reflect.get(h.controller(), "runtime");
		const cache: unknown = Reflect.get(h.view, "definitionCache"), root = h.root(), count = root.querySelectorAll("*").length;
		const changes: MutationRecord[] = [];
		const observer = new MutationObserver(records => changes.push(...records)); observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
		const current = await generate(h.view), slot = current.rows[0]!.rowSlotId;
		session(h.view).select(slot, { kind: "fixed", recipeId: "purpose" }); await session(h.view).regenerate(slot);
		const fragment = unwrap(collisionFragmentFromBatch({ batch: batch(h.view), rowSlotId: slot }));
		expect(fragment.algorithmVersion).toBe(1); expect(fragment.patternSetVersion).toBe(2);
		expect(h.plan()).toBe(plan); expect(Reflect.get(h.controller(), "runtime")).toBe(runtime);
		expect(Reflect.get(h.view, "dictionaryWorld")).toBe(dictionary); expect(Reflect.get(h.view, "definitionCache")).toBe(cache);
		expect(dictionary.getCurrent()).toBe(definition); changes.push(...observer.takeRecords()); observer.disconnect(); expect(changes).toEqual([]);
		expect(h.root()).toBe(root); expect(root.querySelectorAll("*")).toHaveLength(count);
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
	});
});
