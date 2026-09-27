// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "obsidian";
import type { SemantropyView } from "../src/view/SemantropyView";
import { SemantropyPlugin } from "../src/SemantropyPlugin";
import { FAKE_PROVERB_DISPLAY_BROKEN, FAKE_PROVERB_PUBLISH_FAILED, type FakeProverbSession } from "../src/view/FakeProverbSession";
import type { FakeProverbModal } from "../src/view/FakeProverbModal";
import type { CooperativeScheduler } from "../src/render/cooperativeScheduler";
import * as core from "../src/fakeProverb/fakeProverbCore";
import { readFakeProverbRow, type FakeProverbBatch } from "../src/fakeProverb/fakeProverbBatch";
import { fakeProverbFragmentInputFromRow } from "../src/collect/v4/CollectedFragmentV4";
import { collectFragmentV4 } from "../src/collect/v4/CollectFragmentUseCaseV4";
import { MarkdownFragmentRepositoryV4 } from "../src/collect/v4/FragmentRepositoryV4";
import type { CollectionEntryState, CreateCollectionResult, ProcessCollectionResult } from "../src/collect/CollectionStorage";
import { COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE } from "../src/collect/collectMessages";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer } from "./support/manualMorphHarness";
import { immediateScheduler } from "./support/testScheduler";
import { LEXICON, RICH_TEXT, standardSet } from "./fakeProverbCoreFixtures";
import { createFakeProverbAuthority } from "../src/fakeProverb/fakeProverbAuthority";
import type { ManualMorphVocabulary } from "../src/transform/manualMorphology";

const LF = String.fromCharCode(10);
let restore: () => void;
const views: SemantropyView[] = [];
beforeAll(() => { restore = installObsidianDomHelpers(); });
beforeEach(() => {
	let entropy = 0;
	vi.spyOn(document.defaultView!.crypto, "getRandomValues").mockImplementation(array => {
		if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(++entropy % 256);
		return array;
	});
});
afterAll(() => restore());
afterEach(async () => {
	for (const view of views.splice(0)) await view.onClose();
	vi.restoreAllMocks(); document.body.replaceChildren();
});

const session = (view: SemantropyView) => Reflect.get(view, "fakeProverbSession") as FakeProverbSession;
const modal = (view: SemantropyView) => Reflect.get(view, "fakeProverbModal") as FakeProverbModal;
/** The batch on screen, which Copy and Collect use; BATCH1 may hold a newer, unpublished commit. */
const batch = (view: SemantropyView) => session(view).batch()!;
const rows = (view: SemantropyView) => Array.from(modal(view).contentEl.querySelectorAll<HTMLElement>(".semantropy-fake-proverb-row"));
function button(root: ParentNode, name: string) {
	const found = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === name);
	if (!found) throw Error(`Missing test button: ${name}`); return found;
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function stepping() {
	const waiting: { phase: string; done: () => void }[] = [];
	const hold = (phase: string) => new Promise<void>(done => waiting.push({ phase, done }));
	const scheduler: CooperativeScheduler = { now: () => performance.now(), paint: () => hold("paint"), yieldTask: () => hold("task") };
	return { scheduler, waiting, async step() { expect(waiting.length).toBeGreaterThan(0); waiting.shift()!.done(); await flush(); },
		async drain() { for (let i = 0; waiting.length && i < 30; i++) { waiting.shift()!.done(); await flush(); } expect(waiting).toHaveLength(0); } };
}
/** A real View over the real analyzer, with a Target (Current Note) or Target-less Selected Notes. */
async function harness(target = true, texts = [RICH_TEXT]) {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), 20); views.push(h.view);
	if (target) await h.open(texts[0]!);
	else { await h.view.onOpen(); expect(await h.apply(texts)).toBe("applied"); }
	return h;
}
function open(h: Awaited<ReturnType<typeof harness>>, scheduler?: CooperativeScheduler) {
	if (scheduler) h.host.scheduler = scheduler;
	h.view.openFakeProverb();
	expect(modal(h.view)).toBeTruthy();
}
async function generate(view: SemantropyView): Promise<FakeProverbBatch> {
	await session(view).generate(); expect(batch(view)).toBeTruthy(); return batch(view);
}
function memoryStorage(initial: string | null = null) {
	let contents = initial;
	const storage = {
		inspect: vi.fn(() => Promise.resolve<CollectionEntryState>({ status: contents === null ? "missing" : "markdown" })),
		create: vi.fn((_path: string, text: string) => { contents = text; return Promise.resolve<CreateCollectionResult>({ status: "created" }); }),
		process: vi.fn((_path: string, transform: (value: string) => string) => { contents = transform(contents ?? ""); return Promise.resolve<ProcessCollectionResult>({ status: "processed" }); }),
	};
	return { storage, read: () => contents };
}
/** The plugin's real metadata 4 writer, over an in-memory Collection. */
function realWriter(h: Awaited<ReturnType<typeof harness>>, destination: () => string, initial: string | null = null) {
	const file = memoryStorage(initial);
	const repository = new MarkdownFragmentRepositoryV4(file.storage, destination);
	h.host.collectFragment = input => collectFragmentV4(input, { repository, newId: () => "11111111-2222-4333-8444-555555555555", now: () => new Date("2026-09-24T00:00:00Z") });
	return file;
}
/** Real generated drafts, then cut to `count`: the only way to reach a partial or empty CORE1 result on demand. */
function limitDrafts(count: number, shortfall: "insufficient-candidates" | "no-compatible-gloss" | "duplicate-exhaustion") {
	const original = core.generateFakeProverbs;
	return vi.spyOn(core, "generateFakeProverbs").mockImplementation(input => {
		const real = original(input);
		if (!real.ok) return real;
		return Object.freeze({ ok: true as const, value: Object.freeze({ ...real.value, drafts: real.value.drafts.slice(0, count), shortfall }) });
	});
}

describe("Fake Proverb View: Generate through BATCH1", () => {
	it("opens from the Toolbar's Phrase generation group and generates ten rows with separate batch, slot and row identities", async () => {
		const h = await harness();
		const entry = h.view.contentEl.querySelector<HTMLButtonElement>(".semantropy-fake-proverb-open");
		expect(entry?.textContent).toBe("Fake proverb");
		expect(entry?.closest(".is-generation")).toBeTruthy();
		entry!.click(); expect(modal(h.view)).toBeTruthy();
		const reads = h.calls.reads.length, tokens = h.calls.tokenizations.length;
		// Ten stable display positions exist before any Generate (Policy 1 §7).
		const slots = session(h.view).read()!.rowSlotIds;
		expect(slots).toHaveLength(10); expect(new Set(slots).size).toBe(10);
		expect(rows(h.view)).toHaveLength(10);
		const first = await generate(h.view);
		expect(first.status).toBe("complete"); expect(first.actualCount).toBe(10);
		expect(first.rows.map(row => row.rowSlotId)).toEqual(slots);
		const rowIds = first.rows.map(row => row.committed!.rowId);
		expect(new Set([first.batchId, ...rowIds, ...slots]).size).toBe(21);
		const second = await generate(h.view);
		expect(second.batchId).not.toBe(first.batchId);
		expect(second.rows.map(row => row.rowSlotId)).toEqual(slots);
		expect(second.rows.some(row => rowIds.includes(row.committed!.rowId))).toBe(false);
		// Generation reads no Source and calls no tokenizer; nothing reaches the Clipboard or the Vault.
		expect(h.calls.reads).toHaveLength(reads); expect(h.calls.tokenizations).toHaveLength(tokens);
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
		expect(modal(h.view).contentEl.querySelector("[role=status]")!.textContent).toBe("10 / 10 results.");
	});

	it("generates from Target-less Selected Notes and captures every Source", async () => {
		const h = await harness(false, [RICH_TEXT, "猫は月を見る。犬は星を読む。"]);
		expect(h.view.getSourcePath()).toBeNull();
		open(h); const generated = await generate(h.view);
		expect(generated.provenance.sources.map(source => source.path)).toEqual(["source0.md", "source1.md"]);
		expect(generated.actualCount).toBe(10);
	});

	it("commits a nonzero partial with its actual count and fixed shortfall, and shows empty positions as unavailable", async () => {
		const h = await harness(); open(h);
		limitDrafts(3, "duplicate-exhaustion");
		const partial = await generate(h.view);
		expect(partial.status).toBe("partial"); expect(partial.actualCount).toBe(3); expect(partial.shortfallReason).toBe("duplicate-exhaustion");
		const text = modal(h.view).contentEl.textContent;
		expect(text).toContain("Partial batch generated: 3 / 10 results. Not enough distinct results.");
		expect(text).not.toContain("previous results are retained");
		const ui = rows(h.view);
		for (const [index, row] of ui.entries()) {
			expect(row.classList.contains("is-empty")).toBe(index >= 3);
			expect(button(row, "Copy").getAttribute("aria-disabled")).toBe(String(index >= 3));
		}
		expect(ui[5]!.textContent).toContain("No result in this position.");
		// The session contract itself, not only the positional button: an empty position is never writable.
		for (const row of partial.rows.slice(3)) expect(session(h.view).canWrite(row.rowSlotId)).toBe(false);
		for (const row of partial.rows.slice(0, 3)) expect(session(h.view).canWrite(row.rowSlotId)).toBe(true);
		button(ui[5]!, "Copy").click(); button(ui[5]!, "Collect").click(); await flush();
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
	});

	it.each([
		["insufficient-candidates", "Insufficient vocabulary: not enough usable words."],
		["no-compatible-gloss", "Insufficient vocabulary: no explanation fits the generated proverbs."],
		["duplicate-exhaustion", "Not enough distinct results."],
	] as const)("keeps the old batch, rows and text nodes on a zero result (%s)", async (reason, message) => {
		const h = await harness(); open(h); const old = await generate(h.view);
		const proverbNode = rows(h.view)[0]!.querySelector(".semantropy-fake-proverb-proverb")!.firstChild;
		limitDrafts(0, reason);
		await session(h.view).generate();
		expect(batch(h.view)).toBe(old);
		expect(rows(h.view)[0]!.querySelector(".semantropy-fake-proverb-proverb")!.firstChild).toBe(proverbNode);
		expect(modal(h.view).contentEl.textContent).toContain(`${message} The previous results are retained.`);
	});

	it("refuses Generate without a fresh active Vocabulary and keeps the previous batch", async () => {
		const h = await harness(); open(h); const old = await generate(h.view);
		h.view.notifyVocabularySourceEvent("target.md");
		await session(h.view).generate();
		expect(batch(h.view)).toBe(old);
		expect(modal(h.view).contentEl.textContent).toContain("Apply a fresh Vocabulary before Generate.");
		expect(button(modal(h.view).contentEl, "Generate").getAttribute("aria-disabled")).toBe("true");
	});
});

describe("Fake Proverb View: cancel, supersession, stale, close and disable", () => {
	it.each(["before", "after"])("cancels %s prepare, keeps the previous batch and ignores the late completion", async phase => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const seed = session(h.view).generate(); await gates.drain(); await seed; const retained = batch(h.view);
		const spy = vi.spyOn(core, "generateFakeProverbs");
		const task = session(h.view).generate();
		expect(modal(h.view).contentEl.textContent).toContain("Generating…");
		expect(batch(h.view)).toBe(retained);
		if (phase === "after") { await gates.step(); await gates.step(); expect(spy).toHaveBeenCalledOnce(); }
		button(modal(h.view).contentEl, "Cancel Generate").click();
		await gates.drain(); await task;
		expect(batch(h.view)).toBe(retained);
		if (phase === "before") expect(spy).not.toHaveBeenCalled();
		expect(modal(h.view).contentEl.textContent).toContain("Cancelled. The previous results are retained.");
		expect(session(h.view).read()!.generation.pending).toBe(false);
	});

	it("lets a newer Generate supersede an older one; only the newest commits", async () => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const spy = vi.spyOn(core, "generateFakeProverbs");
		const older = session(h.view).generate(); await gates.step();
		const newer = session(h.view).generate(); await gates.drain(); await Promise.all([older, newer]);
		expect(spy).toHaveBeenCalledOnce();
		expect(batch(h.view).actualCount).toBe(10);
		expect(session(h.view).read()!.generation).toEqual({ pending: false, lastError: null });
	});

	it("keeps Cancel Generate bound to the newest Generate after a supersession", async () => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const spy = vi.spyOn(core, "generateFakeProverbs");
		const older = session(h.view).generate(); await gates.step();
		const newer = session(h.view).generate();
		// Let the superseded Generate run to its end while the newer one waits at its first gate.
		await gates.step(); await gates.step(); await older;
		expect(session(h.view).pending()).toBe(true);
		button(modal(h.view).contentEl, "Cancel Generate").click();
		await gates.drain(); await newer;
		expect(spy).not.toHaveBeenCalled();
		expect(session(h.view).read()!.batch).toBeNull();
		expect(session(h.view).read()!.generation).toEqual({ pending: false, lastError: "cancelled" });
	});

	it("cancels a pending Generate whose owner stops being active through an Apply, and commits nothing from it", async () => {
		const h = await harness(false, [RICH_TEXT]); const gates = stepping(); open(h, gates.scheduler);
		const spy = vi.spyOn(core, "generateFakeProverbs");
		const pending = session(h.view).generate(); await gates.step();
		// A new Apply mints a new owner; no Source changed, so only the active-owner check can stop the old one.
		h.host.scheduler = immediateScheduler();
		expect(await h.apply([`${RICH_TEXT}猫は川を読む。`])).toBe("applied");
		await gates.drain(); await pending;
		expect(spy).not.toHaveBeenCalled();
		expect(session(h.view).read()!.batch).toBeNull();
		expect(session(h.view).read()!.generation.lastError).toBe("cancelled");
	});

	it("makes pending work stale on a Source change, keeps the committed batch and provenance, and requires a new owner", async () => {
		const h = await harness(false, [RICH_TEXT]); const gates = stepping(); open(h, gates.scheduler);
		const seed = session(h.view).generate(); await gates.drain(); await seed; const retained = batch(h.view);
		const provenance = retained.provenance;
		const pending = session(h.view).generate(); await gates.step();
		h.view.notifyVocabularySourceEvent("source0.md");
		// The Source change reached BATCH1 itself: the pending ticket is stale there, not merely cancelled here.
		expect(session(h.view).read()!.generation).toEqual({ pending: false, lastError: "stale" });
		await gates.drain(); await pending;
		expect(session(h.view).read()!.generation.lastError).toBe("stale");
		expect(modal(h.view).contentEl.textContent).toContain("The Vocabulary changed. Apply or refresh it before Generate. The previous results are retained.");
		expect(batch(h.view)).toBe(retained); expect(batch(h.view).provenance).toBe(provenance);
		expect(modal(h.view).contentEl.textContent).toContain("no longer active");
		// The committed rows stay usable, with the provenance captured at commit.
		const slot = retained.rows[0]!.rowSlotId;
		await session(h.view).write(slot, "copy");
		expect(h.calls.copy).toEqual([retained.rows[0]!.committed!.canonicalText]);
		// No fresh owner: Generate is refused and the batch is kept.
		await session(h.view).generate(); await gates.drain();
		expect(batch(h.view)).toBe(retained);
		// A new Apply mints a new owner, which Generate accepts.
		h.host.scheduler = immediateScheduler();
		expect(await h.apply([`${RICH_TEXT}猫は川を読む。`])).toBe("applied");
		const next = session(h.view).generate(); await gates.drain(); await next;
		expect(batch(h.view)).not.toBe(retained);
		expect(modal(h.view).contentEl.textContent).not.toContain("no longer active");
	});

	// Review 2 (P2): an old owner's Source must not revoke the current owner, and old owners are not kept.
	// Re-review 3 (P2): the ten rowSlotIds are the View's, whatever owner is current.
	it("keeps one BATCH1 lifecycle and its rowSlotIds across repeated Applies, releases earlier owners, and keeps an old Source change local", async () => {
		const h = await harness(false, [RICH_TEXT]); open(h);
		const controller = Reflect.get(session(h.view), "controller") as unknown;
		const slots = session(h.view).read()!.rowSlotIds;
		const earlier: ManualMorphVocabulary[] = [];
		const texts = [`${RICH_TEXT}猫は川を読む。`, `${RICH_TEXT}犬は月を待つ。`, `${RICH_TEXT}鳥は夢を見る。`];
		for (const text of texts) {
			const shown = await generate(h.view);
			expect(shown.rows.map(row => row.rowSlotId)).toEqual(slots);
			earlier.push(Reflect.get(h.view, "standaloneVocabulary") as ManualMorphVocabulary);
			h.notes.clear(); h.view.setVocabularyDraft({ mode: "selected", paths: [`next-${earlier.length}.md`], drawMode: "uniform" });
			h.notes.set(`next-${earlier.length}.md`, text);
			expect(await h.view.applyVocabulary()).toBe("applied");
		}
		const current = await generate(h.view);
		expect(Reflect.get(session(h.view), "controller")).toBe(controller);
		expect(session(h.view).read()!.rowSlotIds).toEqual(slots);
		expect(current.rows.map(row => row.rowSlotId)).toEqual(slots);
		// Every earlier owner was released in BATCH1 and revoked for Fake Proverb; only the current one is held.
		for (const owner of earlier) expect(createFakeProverbAuthority({ vocabulary: owner, recipeSet: standardSet() })).toEqual({ ok: false, reason: "stale" });
		expect(Reflect.get(session(h.view), "currentOwner")).toBe(Reflect.get(h.view, "standaloneVocabulary"));
		// The first Apply's Source changes: the current batch and owner are unaffected, and Generate still works.
		h.view.notifyVocabularySourceEvent("source0.md");
		expect(session(h.view).isStale()).toBe(false);
		expect(modal(h.view).contentEl.textContent).not.toContain("no longer active");
		const next = await generate(h.view);
		expect(next).not.toBe(current);
		expect(session(h.view).read()!.generation.lastError).toBeNull();
	});

	it("keeps an older published batch usable after the owner changes, and marks it stale only for its own Source", async () => {
		const h = await harness(false, [RICH_TEXT]); open(h); const fromA = await generate(h.view);
		h.notes.clear(); h.view.setVocabularyDraft({ mode: "selected", paths: ["b.md"], drawMode: "uniform" });
		h.notes.set("b.md", `${RICH_TEXT}猫は川を読む。`);
		expect(await h.view.applyVocabulary()).toBe("applied");
		// B's first Generate produces nothing: A's batch stays on screen from a closed lifecycle.
		limitDrafts(0, "insufficient-candidates");
		await session(h.view).generate();
		vi.restoreAllMocks();
		expect(session(h.view).batch()).toBe(fromA);
		button(rows(h.view)[1]!, "Copy").click(); await flush();
		expect(h.calls.copy).toEqual([fromA.rows[1]!.committed!.canonicalText]);
		// A's Source changing marks A's batch stale on screen but does not touch B's lifecycle.
		h.view.notifyVocabularySourceEvent("source0.md");
		expect(modal(h.view).contentEl.textContent).toContain("no longer active");
		expect(session(h.view).read()!.generation.lastError).not.toBe("stale");
		expect(await generate(h.view)).not.toBe(fromA);
	});

	it("ignores a Source change outside the batch and the owners it used", async () => {
		const h = await harness(false, [RICH_TEXT]); open(h); const retained = await generate(h.view);
		session(h.view).sourceChanged("unrelated.md");
		expect(batch(h.view)).toBe(retained);
		expect(session(h.view).isStale()).toBe(false);
		expect(await generate(h.view)).not.toBe(retained);
	});

	it("detaches on Modal close: cancels the pending Generate, revokes nothing, and republishes the kept batch on reopen", async () => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const seed = session(h.view).generate(); await gates.drain(); await seed;
		const owned = session(h.view), kept = batch(h.view), dialog = modal(h.view);
		const spy = vi.spyOn(core, "generateFakeProverbs");
		const pending = owned.generate(); await gates.step();
		dialog.close();
		await gates.drain(); await pending;
		expect(spy).not.toHaveBeenCalled();
		expect(dialog.contentEl.childNodes).toHaveLength(0);
		expect(Reflect.get(h.view, "fakeProverbModal")).toBeNull();
		// The View keeps its session, its BATCH1 owner and the published batch.
		expect(session(h.view)).toBe(owned); expect(owned.batch()).toBe(kept);
		expect(owned.read()!.generation).toEqual({ pending: false, lastError: "cancelled" });
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
		// Reopen: the kept batch is shown whole, and the same live owner still generates.
		h.view.openFakeProverb();
		expect(rows(h.view).map(row => row.querySelector(".semantropy-fake-proverb-proverb")!.textContent)).toEqual(kept.rows.map(row => row.committed!.proverbText));
		button(rows(h.view)[4]!, "Copy").click(); await flush();
		expect(h.calls.copy).toEqual([kept.rows[4]!.committed!.canonicalText]);
		const next = session(h.view).generate(); await gates.drain(); await next;
		expect(batch(h.view)).not.toBe(kept);
		expect(session(h.view).read()!.generation.lastError).toBeNull();
	});

	it.each(["view", "disable", "plugin"] as const)("releases everything on %s close and never publishes a late completion", async kind => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const seed = session(h.view).generate(); await gates.drain(); await seed;
		const owned = session(h.view), dialog = modal(h.view);
		const controller = Reflect.get(owned, "controller") as { read(): { lifecycle: string; batch: unknown } };
		const pending = owned.generate(); await gates.step(); await gates.step();
		const spy = vi.spyOn(owned, "changed" as never);
		if (kind === "view") await h.view.onClose();
		else if (kind === "disable") h.view.disableFakeProverb();
		// The plugin's own onunload, over a stub that owns just this View.
		else SemantropyPlugin.prototype.onunload.call({ automaticCoordinator: { dispose: () => undefined }, settingTab: null, tokenizer: null, notices: new Map(),
			removeRibbon: () => undefined, semantropyViews: () => [h.view] } as unknown as SemantropyPlugin);
		await gates.drain(); await pending;
		expect(owned.read()).toBeNull();
		// The View's BATCH1 owner itself is closed and has dropped its batch, not merely forgotten.
		expect(controller.read()).toMatchObject({ lifecycle: "disposed", batch: null });
		expect(Reflect.get(h.view, "fakeProverbSession")).toBeNull(); expect(Reflect.get(h.view, "fakeProverbModal")).toBeNull();
		expect(dialog.contentEl.childNodes).toHaveLength(0);
		expect(spy).not.toHaveBeenCalled();
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
		if (kind === "disable" || kind === "plugin") { h.view.openFakeProverb(); expect(modal(h.view)).toBeNull(); }
	});

	it("restores no batch after a View restart", async () => {
		const h = await harness(); open(h); await generate(h.view);
		await h.view.onClose(); await h.open(RICH_TEXT); h.view.openFakeProverb();
		expect(session(h.view).batch()).toBeNull(); expect(session(h.view).read()!.batch).toBeNull();
		expect(modal(h.view).contentEl.textContent).toContain("No results yet.");
	});

	it("keeps owners, tickets and display state separate between Views", async () => {
		const a = await harness(), b = await harness();
		const gatesA = stepping(); open(a, gatesA.scheduler); open(b);
		const bFirst = await generate(b.view);
		const pendingA = session(a.view).generate(); await gatesA.step();
		expect(session(b.view).pending()).toBe(false);
		const bSecond = await generate(b.view);
		expect(bSecond).not.toBe(bFirst);
		session(a.view).cancel(); await gatesA.drain(); await pendingA;
		expect(session(a.view).read()!.batch).toBeNull();
		expect(batch(b.view)).toBe(bSecond);
		expect(session(a.view).read()!.rowSlotIds).not.toEqual(session(b.view).read()!.rowSlotIds);
		expect(rows(a.view).every(row => row.classList.contains("is-empty") || row.textContent === "")).toBe(true);
	});
});

describe("Fake Proverb View: display", () => {
	it("keeps the list, rows, focus and scroll through a new batch, a cancel and a zero result", async () => {
		const h = await harness(); open(h); const first = await generate(h.view);
		const list = modal(h.view).contentEl.querySelector(".semantropy-fake-proverb-rows")!, ui = rows(h.view);
		const copy = button(ui[3]!, "Copy"); copy.focus();
		modal(h.view).contentEl.scrollTop = 120;
		const second = await generate(h.view);
		expect(second).not.toBe(first);
		expect(modal(h.view).contentEl.querySelector(".semantropy-fake-proverb-rows")).toBe(list);
		expect(rows(h.view)).toEqual(ui);
		expect(document.activeElement).toBe(copy);
		expect(modal(h.view).contentEl.scrollTop).toBe(120);
		expect(ui[3]!.querySelector(".semantropy-fake-proverb-proverb")!.textContent).toBe(second.rows[3]!.committed!.proverbText);
		limitDrafts(0, "insufficient-candidates"); await session(h.view).generate();
		expect(document.activeElement).toBe(copy); expect(batch(h.view)).toBe(second);
	});

	it("keeps focus on a row button while a Generate makes it unavailable", async () => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const seed = session(h.view).generate(); await gates.drain(); await seed;
		const copy = button(rows(h.view)[0]!, "Copy"); copy.focus();
		const pending = session(h.view).generate(); await flush();
		expect(copy.getAttribute("aria-disabled")).toBe("true"); expect(copy.disabled).toBe(false);
		expect(document.activeElement).toBe(copy);
		await gates.drain(); await pending;
		expect(copy.getAttribute("aria-disabled")).toBe("false"); expect(document.activeElement).toBe(copy);
	});

	it("moves focus from Cancel Generate to Generate when the operation ends", async () => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const pending = session(h.view).generate(); await flush();
		const root = modal(h.view).contentEl, cancel = button(root, "Cancel Generate");
		expect(cancel.hidden).toBe(false); cancel.focus();
		await gates.drain(); await pending;
		expect(cancel.hidden).toBe(true); expect(document.activeElement).toBe(button(root, "Generate"));
	});

	it("shows proverb and gloss as two separate text nodes whose logical text is the canonical Markdown without markers", async () => {
		const render = vi.spyOn(MarkdownRenderer, "render");
		const h = await harness(); open(h); const generated = await generate(h.view);
		for (const [index, row] of rows(h.view).entries()) {
			const committed = generated.rows[index]!.committed!;
			const proverb = row.querySelector(".semantropy-fake-proverb-proverb")!, gloss = row.querySelector(".semantropy-fake-proverb-gloss")!;
			for (const el of [proverb, gloss]) {
				expect(el.childNodes).toHaveLength(1);
				expect(el.firstChild!.nodeType).toBe(3);
				expect(el.children).toHaveLength(0);
			}
			expect(proverb.textContent).toBe(committed.proverbText); expect(gloss.textContent).toBe(committed.glossText);
			expect(committed.canonicalText).toBe(`**${proverb.textContent}**${LF}${LF}> ${gloss.textContent}`);
			expect(row.textContent).not.toMatch(/\*\*|> /u);
		}
		expect(render).not.toHaveBeenCalled();
	});
});

describe("Fake Proverb View: publication is one transaction (review 1, P1)", () => {
	/** Makes one element's replaceChildren throw on the given call numbers, delegating otherwise. */
	function failOn(el: Element, calls: number[], before: () => void = () => undefined) {
		let count = 0;
		el.replaceChildren = function (this: Element, ...nodes: (Node | string)[]) {
			count += 1;
			if (calls.includes(count)) { before(); throw Error("injected DOM failure"); }
			Element.prototype.replaceChildren.apply(this, nodes);
		};
		return () => { delete (el as { replaceChildren?: unknown }).replaceChildren; };
	}
	function snapshot(view: SemantropyView) {
		return rows(view).map(row => {
			const proverb = row.querySelector(".semantropy-fake-proverb-proverb")!, gloss = row.querySelector<HTMLElement>(".semantropy-fake-proverb-gloss")!;
			return { proverb: proverb.textContent, gloss: gloss.textContent, proverbNode: proverb.firstChild, glossNode: gloss.firstChild,
				hidden: gloss.hidden, empty: row.classList.contains("is-empty") };
		});
	}

	it("keeps the previous batch, rows, text nodes, focus, scroll and write targets when a row fails mid-publication", async () => {
		const h = await harness(); open(h); const old = await generate(h.view);
		const before = snapshot(h.view);
		const copy = button(rows(h.view)[2]!, "Copy"); copy.focus();
		modal(h.view).contentEl.scrollTop = 120;
		// jsdom has no layout, so the failing write itself drops focus and scroll the way a real reflow could.
		const restore = failOn(rows(h.view)[6]!.querySelector(".semantropy-fake-proverb-proverb")!, [1], () => {
			modal(h.view).contentEl.scrollTop = 0; copy.blur();
		});
		await session(h.view).generate();
		// BATCH1 committed a new batch, but it was never shown: the session keeps the old one.
		const committed = session(h.view).read()!.batch!;
		expect(committed).not.toBe(old);
		expect(session(h.view).batch()).toBe(old);
		expect(snapshot(h.view)).toEqual(before);
		expect(document.activeElement).toBe(copy);
		expect(modal(h.view).contentEl.scrollTop).toBe(120);
		expect(modal(h.view).contentEl.querySelector("[role=status]")!.textContent).toContain(FAKE_PROVERB_PUBLISH_FAILED);
		// Copy and Collect still act on what is on screen, never on the unpublished commit.
		button(rows(h.view)[2]!, "Copy").click(); await flush();
		expect(h.calls.copy).toEqual([old.rows[2]!.committed!.canonicalText]);
		button(rows(h.view)[7]!, "Collect").click(); await flush();
		expect(h.calls.collect[0]).toMatchObject({ batchId: old.batchId, rowId: old.rows[7]!.committed!.rowId });
		expect(JSON.stringify([h.calls.copy, h.calls.collect])).not.toContain(committed.batchId);
		// Once the display works again, the next batch is shown whole.
		restore();
		const next = await generate(h.view);
		expect(session(h.view).batch()).toBe(next);
		expect(snapshot(h.view).map(row => row.proverb)).toEqual(next.rows.map(row => row.committed!.proverbText));
		expect(document.activeElement).toBe(copy);
	});

	// Review 2 (P1): a failure after the DOM has already changed.
	it("undoes an element whose change completed before the failure, and allows writes only after an exact restore", async () => {
		const h = await harness(); open(h); const old = await generate(h.view);
		const before = snapshot(h.view);
		const el = rows(h.view)[4]!.querySelector(".semantropy-fake-proverb-proverb")!;
		// The first call really replaces the children, then throws.
		let calls = 0;
		el.replaceChildren = function (this: Element, ...nodes: (Node | string)[]) {
			calls += 1;
			Element.prototype.replaceChildren.apply(this, nodes);
			if (calls === 1) throw Error("injected failure after the change");
		};
		await session(h.view).generate();
		expect(session(h.view).batch()).toBe(old);
		expect(snapshot(h.view)).toEqual(before);
		expect(session(h.view).isBroken()).toBe(false);
		expect(modal(h.view).contentEl.querySelector("[role=status]")!.textContent).toContain(FAKE_PROVERB_PUBLISH_FAILED);
		button(rows(h.view)[4]!, "Copy").click(); await flush();
		expect(h.calls.copy).toEqual([old.rows[4]!.committed!.canonicalText]);
	});

	it("is broken when an element changed before the failure cannot be undone", async () => {
		const h = await harness(); open(h); await generate(h.view);
		const el = rows(h.view)[4]!.querySelector(".semantropy-fake-proverb-proverb")!;
		// Changes, then throws; every later call (the undo) throws before touching anything.
		let calls = 0;
		el.replaceChildren = function (this: Element, ...nodes: (Node | string)[]) {
			calls += 1;
			if (calls > 1) throw Error("injected undo failure");
			Element.prototype.replaceChildren.apply(this, nodes);
			throw Error("injected failure after the change");
		};
		await session(h.view).generate();
		expect(session(h.view).isBroken()).toBe(true);
		for (const row of rows(h.view)) button(row, "Copy").click();
		await flush();
		expect(h.calls.copy).toEqual([]);
	});

	it("decides by checking the rows, not by the undo log: damage outside the log is broken", async () => {
		const h = await harness(); open(h); await generate(h.view);
		const untouched = rows(h.view)[9]!.querySelector(".semantropy-fake-proverb-proverb")!;
		// Row 3 fails after corrupting row 9, which the publication has not reached and so never recorded.
		failOn(rows(h.view)[3]!.querySelector(".semantropy-fake-proverb-proverb")!, [1], () => {
			untouched.append(untouched.ownerDocument.createTextNode("stray"));
		});
		await session(h.view).generate();
		expect(session(h.view).isBroken()).toBe(true);
		expect(session(h.view).canWrite(session(h.view).batch()!.rows[0]!.rowSlotId)).toBe(false);
		expect(modal(h.view).contentEl.querySelector("[role=status]")!.textContent).toContain(FAKE_PROVERB_DISPLAY_BROKEN);
	});

	it("rolls back emptied positions of a failed partial publication", async () => {
		const h = await harness(); open(h); const old = await generate(h.view);
		const before = snapshot(h.view);
		limitDrafts(3, "duplicate-exhaustion");
		const restore = failOn(rows(h.view)[9]!.querySelector(".semantropy-fake-proverb-gloss")!, [1]);
		await session(h.view).generate();
		expect(session(h.view).read()!.batch!.status).toBe("partial");
		expect(session(h.view).batch()).toBe(old);
		expect(snapshot(h.view)).toEqual(before);
		expect(rows(h.view).every(row => !row.classList.contains("is-empty"))).toBe(true);
		expect(modal(h.view).contentEl.textContent).toContain("10 / 10 results.");
		expect(modal(h.view).contentEl.textContent).not.toContain("Partial batch generated");
		// Availability follows what is on screen, not the unpublished partial commit.
		for (const row of old.rows) expect(session(h.view).canWrite(row.rowSlotId)).toBe(true);
		expect(button(rows(h.view)[9]!, "Copy").getAttribute("aria-disabled")).toBe("false");
		button(rows(h.view)[9]!, "Copy").click(); await flush();
		expect(h.calls.copy).toEqual([old.rows[9]!.committed!.canonicalText]);
		restore();
	});

	it("keeps every text node when the same batch is published again", async () => {
		const h = await harness(); open(h); const shown = await generate(h.view);
		const before = snapshot(h.view);
		expect(session(h.view).publisher!(shown)).toBe("published");
		const after = snapshot(h.view);
		for (const [index, row] of after.entries()) {
			expect(row.proverbNode).toBe(before[index]!.proverbNode); expect(row.glossNode).toBe(before[index]!.glossNode);
		}
	});

	it("fails closed when the rollback itself fails: no Copy, Collect or Generate until reopened", async () => {
		const h = await harness(); open(h); await generate(h.view);
		// Row 1 accepts the new text, then refuses to be rolled back; row 8 fails the publication.
		failOn(rows(h.view)[1]!.querySelector(".semantropy-fake-proverb-proverb")!, [2]);
		failOn(rows(h.view)[8]!.querySelector(".semantropy-fake-proverb-proverb")!, [1]);
		await session(h.view).generate();
		expect(session(h.view).isBroken()).toBe(true);
		expect(modal(h.view).contentEl.querySelector("[role=status]")!.textContent).toContain(FAKE_PROVERB_DISPLAY_BROKEN);
		for (const row of rows(h.view)) {
			expect(button(row, "Copy").getAttribute("aria-disabled")).toBe("true");
			button(row, "Copy").click(); button(row, "Collect").click();
		}
		await flush();
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
		const spy = vi.spyOn(core, "generateFakeProverbs");
		await session(h.view).generate();
		expect(spy).not.toHaveBeenCalled();
		expect(button(modal(h.view).contentEl, "Generate").getAttribute("aria-disabled")).toBe("true");
		// Closing and reopening the Modal builds a new display and publishes the kept batch into it whole.
		const kept = session(h.view).batch()!;
		modal(h.view).close(); h.view.openFakeProverb();
		expect(session(h.view).isBroken()).toBe(false);
		expect(rows(h.view).map(row => row.querySelector(".semantropy-fake-proverb-proverb")!.textContent)).toEqual(kept.rows.map(row => row.committed!.proverbText));
		expect(session(h.view).canWrite(kept.rows[0]!.rowSlotId)).toBe(true);
		expect(await generate(h.view)).not.toBe(kept);
	});

	it("treats a publisher exception as a broken display", async () => {
		const h = await harness(); open(h); const old = await generate(h.view);
		session(h.view).publisher = () => { throw Error("injected"); };
		await session(h.view).generate();
		expect(session(h.view).batch()).toBe(old);
		expect(session(h.view).isBroken()).toBe(true);
		expect(session(h.view).canWrite(old.rows[0]!.rowSlotId)).toBe(false);
	});
});

describe("Fake Proverb View: Copy and Collect", () => {
	it("copies and collects only the committed row, never the DOM, a draft or a later batch", async () => {
		const h = await harness(); open(h); const generated = await generate(h.view);
		const slot = generated.rows[2]!.rowSlotId, ui = rows(h.view)[2]!;
		ui.querySelector(".semantropy-fake-proverb-proverb")!.textContent = "偽物";
		button(ui, "Copy").click(); await flush();
		const record = readFakeProverbRow({ batch: generated, rowSlotId: slot });
		if (!record.ok) throw Error("fixture");
		expect(h.calls.copy).toEqual([record.value.canonicalText]);
		button(ui, "Collect").click(); await flush();
		const expected = fakeProverbFragmentInputFromRow(record.value);
		if (!expected.ok) throw Error("fixture");
		expect(h.calls.collect).toEqual([expected.value]);
		expect(h.calls.collect[0]).toMatchObject({ metadataVersion: 4, type: "fake-proverb", batchId: generated.batchId,
			rowId: generated.rows[2]!.committed!.rowId, proverbRecipeId: generated.rows[2]!.committed!.proverbRecipeId,
			glossRecipeId: generated.rows[2]!.committed!.glossRecipeId, text: generated.rows[2]!.committed!.canonicalText });
		expect(JSON.stringify(h.calls.collect[0])).not.toMatch(/rowSlotId|draft|binding|nonce|shortfall|projectionPolicy/u);
		expect(ui.textContent).toContain("Collected.");
	});

	it("refuses Copy and Collect while a Generate runs and while the same row is being written", async () => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const seed = session(h.view).generate(); await gates.drain(); await seed; const old = batch(h.view);
		const slot = old.rows[0]!.rowSlotId, ui = rows(h.view)[0]!;
		const pending = session(h.view).generate(); await flush();
		expect(session(h.view).canWrite(slot)).toBe(false);
		button(ui, "Copy").click(); button(ui, "Collect").click(); await session(h.view).write(slot, "collect"); await flush();
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
		await gates.drain(); await pending;
		let release!: () => void;
		h.host.writeClipboard = () => new Promise<void>(resolve => { release = resolve; });
		const first = session(h.view).write(batch(h.view).rows[0]!.rowSlotId, "copy"); await flush();
		expect(session(h.view).canWrite(batch(h.view).rows[0]!.rowSlotId)).toBe(false);
		await session(h.view).write(batch(h.view).rows[0]!.rowSlotId, "copy");
		release(); await first; await flush();
		expect(rows(h.view)[0]!.textContent).toContain("Copied.");
	});

	it("writes every type as metadata 4 through the plugin's writer and keeps older entries byte for byte", async () => {
		const h = await harness(); open(h); const generated = await generate(h.view);
		const older = "- 以前の断片" + LF + "  <!-- semantropy: {\"metadataVersion\":3} -->" + LF + "<!-- other tool -->" + LF;
		const file = realWriter(h, () => "collection.md", older);
		await session(h.view).write(generated.rows[0]!.rowSlotId, "collect");
		expect(rows(h.view)[0]!.textContent).toContain("Collected.");
		h.view.closeFakeProverb();
		document.getSelection()!.removeAllRanges();
		const whole = document.createRange(); whole.selectNodeContents(h.root()); document.getSelection()!.addRange(whole);
		expect(await h.view.collectSelectedFragment()).toBe("appended");
		const text = file.read()!;
		expect(text.startsWith(older)).toBe(true);
		const added = text.slice(older.length);
		expect(added).not.toContain("<!--");
		const comments = [...text.matchAll(/<!-- semantropy: (\{.*\}) -->/gu)].map(match => JSON.parse(match[1]!) as { metadataVersion: number; type?: string });
		expect(comments.map(comment => [comment.metadataVersion, comment.type])).toEqual([[3, undefined]]);
		const committed = generated.rows[0]!.committed!;
		expect(text).toContain(`- **${committed.proverbText}**${LF}${LF}  > ${committed.glossText}${LF}`);
	});

	it("refuses every Target-less Vocabulary Source as the Collection before any storage call", async () => {
		const h = await harness(false, [RICH_TEXT, "猫は月を見る。", "犬は星を読む。"]); open(h); const generated = await generate(h.view);
		let destination = "";
		const file = realWriter(h, () => destination);
		for (const source of generated.provenance.sources) {
			destination = source.path;
			await session(h.view).write(generated.rows[0]!.rowSlotId, "collect");
			expect(rows(h.view)[0]!.textContent).toContain(COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE);
		}
		expect(generated.provenance.sources).toHaveLength(3);
		expect(file.storage.inspect).not.toHaveBeenCalled(); expect(file.storage.create).not.toHaveBeenCalled(); expect(file.storage.process).not.toHaveBeenCalled();
		destination = "collection.md";
		await session(h.view).write(generated.rows[0]!.rowSlotId, "collect");
		expect(file.storage.create).toHaveBeenCalledTimes(1);
	});

	it("never writes to the Clipboard or the Vault implicitly, and discloses no host error", async () => {
		const h = await harness(); const gates = stepping(); open(h, gates.scheduler);
		const pending = session(h.view).generate(); await gates.drain(); await pending;
		h.view.notifyVocabularySourceEvent("target.md");
		modal(h.view).close(); h.view.openFakeProverb(); h.view.closeFakeProverb();
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
		h.host.scheduler = immediateScheduler(); await h.open(RICH_TEXT); open(h); const generated = await generate(h.view);
		h.host.collectFragment = () => { throw Error("secret/path.md private surface"); };
		h.host.writeClipboard = () => Promise.reject(Error("secret/path.md"));
		await session(h.view).write(generated.rows[0]!.rowSlotId, "collect");
		expect(rows(h.view)[0]!.textContent).toContain("Could not collect fake proverb.");
		await session(h.view).write(generated.rows[1]!.rowSlotId, "copy");
		expect(rows(h.view)[1]!.textContent).toContain("Could not copy fake proverb.");
		expect(modal(h.view).contentEl.textContent).not.toMatch(/secret|private/u);
	});
});
