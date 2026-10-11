// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";
import { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import type { AutomaticPosBodyOwner } from "../src/render/automaticPosBodyOwner";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { AutomaticPosCoordinator } from "../src/application/AutomaticPosCoordinator";
import { defaultSemantropyDisplaySettings, type SemantropyDisplaySettings } from "../src/settings/displaySettings";
import type { AutomaticPosOptions } from "../src/transform/automaticPosOptions";
import type { ManualMorphVocabulary } from "../src/transform/manualMorphology";

/**
 * WORKBENCH-UI1 stage 0 (`Docs/release_0_2_0_plan.md` §3.4): before the View learns
 * to open without a Shuffle, pin that a ready body with zero materialized Chunks
 * already takes every operation it must offer — the Text level (also across two
 * Views), Automatic parts of speech, Vocabulary Apply, markers and the Fake
 * Dictionary level — and that the first Chunk made afterwards through the
 * existing Load next path is the body an open would have shown at once.
 *
 * The View here is unchanged; the controller's `deferFirstChunk` is injected for
 * the opens a test asks for, so nothing in this file depends on a host flag.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
let deferOpens = false;
beforeEach(() => {
	deferOpens = false;
	const open: ChunkTargetBodyController["open"] = Reflect.get(ChunkTargetBodyController.prototype, "open");
	vi.spyOn(ChunkTargetBodyController.prototype, "open").mockImplementation(function (this: ChunkTargetBodyController, input) {
		return open.call(this, deferOpens ? { ...input, deferFirstChunk: true } : input);
	});
});
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

const v = (surface: string, baseForm: string, conjugationType: string, conjugationForm: string) =>
	token({ surface, pos: "動詞", detail1: "自立", conjugationType, conjugationForm, baseForm });
const a = (surface: string, baseForm: string, conjugationForm: string, conjugationType = "形容詞・イ段") =>
	token({ surface, pos: "形容詞", detail1: "自立", conjugationType, conjugationForm, baseForm });
const adv = (surface: string, detail1 = "一般") => token({ surface, pos: "副詞", detail1, baseForm: "*" });
const LEXICON = [
	token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "鳥" }), token({ surface: "東京", detail1: "固有名詞", detail2: "地域" }),
	v("書く", "書く", "五段・カ行イ音便", "基本形"), v("書い", "書く", "五段・カ行イ音便", "連用タ接続"), v("歩く", "歩く", "五段・カ行イ音便", "基本形"),
	v("歩い", "歩く", "五段・カ行イ音便", "連用タ接続"), v("走っ", "走る", "五段・ラ行", "連用タ接続"), token({ surface: "た", pos: "助動詞", detail1: "*" }),
	a("美しい", "美しい", "基本形"), a("高かっ", "高い", "連用タ接続", "形容詞・アウオ段"), a("早い", "早い", "基本形", "形容詞・アウオ段"),
	adv("ゆっくり", "助詞類接続"), adv("じっくり"), adv("もっと"),
];
/** Several line Chunks at size 20, with every automatic part of speech and a verified Ruby. */
const TARGET = "猫《ねこ》ゆっくり歩く。\n犬じっくり書く。\n美しい。歩いた。\n走った。高かった。\n鳥もっと歩く。\n".repeat(2);
const SOURCES = ["書く。犬《いぬ》。東京。早い。もっと歩く。", "鳥じっくり歩いた。美しい。"];
const ALL: AutomaticPosOptions = { noun: true, verb: true, iAdjective: true, adverb: true };
const NONE: AutomaticPosOptions = { noun: false, verb: false, iAdjective: false, adverb: false };

type Harness = ReturnType<typeof manualMorphHarness> & { display: { value: SemantropyDisplaySettings } };
/** One plugin-wide store and coordinator, as the plugin wires every View to it. */
async function plugin(level: number, automaticPos: AutomaticPosOptions = ALL) {
	let disk: unknown = { schemaVersion: 4, bodySemantropy: level, dictionarySemantropy: 50, collectionPath: "Semantropy Collection.md",
		displayRubyVisible: true, displayMarkersVisible: true, automaticPos };
	const writes: unknown[] = [], hooks: { before?: (value: { bodySemantropy: number }) => Promise<void> | void } = {};
	const store = new AutomaticPosSettingsStore({ load: async () => disk, save: async value => { writes.push(structuredClone(value)); await hooks.before?.(value); disk = structuredClone(value); } });
	await store.load();
	const coordinator = new AutomaticPosCoordinator(store);
	const display = { value: defaultSemantropyDisplaySettings() };
	const view = (): Harness => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON), 20);
		h.host.automaticPosCoordinator = coordinator; h.host.getAutomaticPos = () => store.getSettings().automaticPos;
		h.host.getBodySemantropy = () => store.getBodySemantropy();
		h.host.getDisplaySettings = () => display.value;
		h.host.setDisplaySettings = async patch => { display.value = { ...display.value, ...patch }; return true; };
		return Object.assign(h, { display });
	};
	return { store, coordinator, display, view, writes, hooks };
}
async function open(h: Harness, defer: boolean, text = TARGET) {
	deferOpens = defer;
	try { await h.open(text); } finally { deferOpens = false; }
}
/** Everything a reader sees of the body and everything a later Copy, Collect or Reshuffle reads from it. */
function body(h: Harness) {
	const state = h.peek.session.getState();
	if (state.status !== "ready") throw Error("not ready");
	return {
		html: h.root().innerHTML,
		text: h.controller().getLogicalText(),
		slots: h.plan().slots.map(slot => ({ id: slot.tokenId, display: slot.displaySurface, automatic: slot.automaticSurface, ruby: slot.displayRuby?.variantId ?? null,
			replaced: slot.automaticReplaced, manual: slot.manualEligible, available: slot.manualAvailable, dictionary: slot.dictionaryAvailable })),
		provenance: h.controller().getAutomaticProvenance(),
		options: h.controller().getAutomaticOptions(),
		markers: h.controller().getMarkerVisibility(),
		dictionaryLevel: h.controller().getDictionarySemantropy(),
		session: { seed: state.bodySeed, level: state.bodySemantropy, replacements: state.replacementCount, replaceable: state.replaceableSlotCount,
			runs: state.tokenSequences.length, version: state.algorithmVersion },
		stats: h.controller().getChunkStats(),
	};
}
/** Zero Chunks: analysis and owner are ready, and nothing of any Chunk exists yet. */
function expectNoChunk(h: Harness) {
	const stats = h.controller().getChunkStats();
	expect(stats.chunks).toBe(0); expect(stats.totalChunks).toBeGreaterThan(2);
	expect(h.controller().hasNext()).toBe(true);
	expect(h.root().childNodes).toHaveLength(0);
	expect(h.root().isConnected).toBe(true);
	expect(h.plan().slots).toHaveLength(0);
	expect(h.peek.contentEl.querySelectorAll(".semantropy-token")).toHaveLength(0);
	expect(h.controller().getLogicalText()).toBe("");
	expect(h.controller().getVocabularyOwner()).not.toBeNull();
}
const owners = (h: Harness) => Reflect.get(h.controller(), "automaticOwners") as Map<ManualMorphVocabulary, AutomaticPosBodyOwner>;
const activeOwner = (h: Harness) => (h.view as unknown as { collisionVocabulary(): ManualMorphVocabulary | null }).collisionVocabulary();

describe("a deferred open", () => {
	it("analyzes the Target and prepares the Vocabulary owner, and builds no Chunk", async () => {
		const p = await plugin(100), now = p.view(), later = p.view();
		await open(now, false); await open(later, true);
		expectNoChunk(later);
		// The whole Target is analyzed once either way; the first Chunk only reads that analysis.
		expect(later.calls.tokenizations).toEqual(now.calls.tokenizations);
		expect(later.calls.reads).toEqual(now.calls.reads);
		expect(activeOwner(later)).toBe(later.controller().getVocabularyOwner());
		expect(later.controller().isAutomaticCurrent()).toBe(true);
		expect(body(later).session).toMatchObject({ seed: 7, level: 100, replacements: 0, replaceable: 0, runs: 0 });
		await now.view.onClose(); await later.view.onClose();
	});
	it("makes the first Chunk through Load next from the same owner, and it is the body an open shows at once", async () => {
		for (const level of [0, 25, 43, 50, 75, 100]) for (const mode of ["uniform", "frequency"] as const) {
			const p = await plugin(level), now = p.view(), later = p.view();
			await open(now, false); await open(later, true);
			if (mode === "frequency") for (const h of [now, later]) {
				h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: mode }); expect(await h.view.applyVocabulary()).toBe("applied");
			}
			const owner = later.controller().getVocabularyOwner(), automatic = [...owners(later).values()];
			expect(automatic).toHaveLength(1);
			expect(await later.view.loadNextSection()).toBe("applied");
			expect(body(later)).toEqual(body(now));
			// What is compared is a real body: tokens, the Target's Ruby at Off, and replacements from 50 up.
			expect(body(now).stats.chunks).toBe(1);
			expect(now.root().querySelectorAll(".semantropy-token").length).toBeGreaterThan(3);
			if (level === 0) expect(now.root().querySelector("rt")?.textContent).toBe("ねこ");
			if (level >= 50) expect(body(now).session.replacements).toBeGreaterThan(0);
			// The first Shuffle neither re-analyzes nor mints a new owner.
			expect(later.controller().getVocabularyOwner()).toBe(owner);
			expect(activeOwner(later)).toBe(owner);
			expect([...owners(later).values()]).toEqual(automatic);
			expect(later.calls.tokenizations).toEqual(now.calls.tokenizations);
			// Later Chunks and a Reshuffle continue exactly as from an immediate open.
			for (const h of [now, later]) expect(await h.view.loadNextSection()).toBe("applied");
			expect(body(later)).toEqual(body(now));
			for (const h of [now, later]) await h.view.reshuffle({ issueSeed: () => 9 });
			expect(body(later)).toEqual(body(now));
			await now.view.onClose(); await later.view.onClose();
		}
	});
});

describe("operations with zero Chunks", () => {
	it("a Text level change commits with no Chunk, and the first Chunk is an open at that level", async () => {
		for (const [from, to] of [[50, 100], [100, 25], [25, 0], [0, 75]] as const) {
			const p = await plugin(from), later = p.view();
			await open(later, true);
			expect(await later.view.setBodySemantropy(assertBodySemantropy(to))).toBe("applied");
			expectNoChunk(later);
			expect(body(later).session.level).toBe(to);
			expect(later.controller().getAutomaticProvenance()!.bodySemantropy).toBe(to);
			expect(p.store.getBodySemantropy()).toBe(to);
			const now = p.view(); await open(now, false);
			expect(await later.view.loadNextSection()).toBe("applied");
			expect(body(later)).toEqual(body(now));
			await now.view.onClose(); await later.view.onClose();
		}
	});
	it("a level change spans Views with and without Chunks, from either one, and saves once", async () => {
		const p = await plugin(50), empty = p.view(), shown = p.view(), other = p.view();
		await open(empty, true); await open(shown, false); await open(other, true);
		expect(await empty.view.setBodySemantropy(assertBodySemantropy(100))).toBe("applied");
		for (const h of [empty, shown, other]) expect(h.controller().getAutomaticProvenance()!.bodySemantropy).toBe(100);
		expectNoChunk(empty); expectNoChunk(other);
		expect(await shown.view.setBodySemantropy(assertBodySemantropy(75))).toBe("applied");
		for (const h of [empty, shown, other]) expect(body(h).session.level).toBe(75);
		expectNoChunk(empty); expectNoChunk(other);
		expect(p.writes.map(value => (value as { bodySemantropy: number }).bodySemantropy)).toEqual([100, 75]);
		const now = p.view(); await open(now, false);
		expect(body(shown)).toEqual(body(now));
		for (const h of [empty, other]) { expect(await h.view.loadNextSection()).toBe("applied"); expect(body(h)).toEqual(body(now)); }
		for (const h of [empty, shown, other, now]) await h.view.onClose();
	});
	it("a failed save or a publication failure with no Chunk rolls every View back, and Generate still gives the old level", async () => {
		const p = await plugin(50), empty = p.view(), shown = p.view(), idle = p.view();
		await open(empty, true); await open(shown, false); await open(idle, true);
		const before = [body(empty), body(shown), body(idle)];
		p.hooks.before = value => { if (value.bodySemantropy === 100) throw Error("disk"); };
		expect(await empty.view.setBodySemantropy(assertBodySemantropy(100))).toBe("failed");
		expect([body(empty), body(shown), body(idle)]).toEqual(before);
		// WORKBENCH-UI1 review 1 (P3): the first Generate right after the failed save, with the Target
		// still fresh, is the body an open at the old level shows at once.
		expect(await empty.view.loadNextSection()).toBe("applied");
		const now = p.view(); await open(now, false);
		expect(body(empty)).toEqual(body(now));
		expect([body(empty).session.level, body(empty).stats.chunks]).toEqual([50, 1]);
		await now.view.onClose();
		const generated = body(empty);
		// An owner made stale while the save waits rolls every View back too. Review 1 (WORKBENCH-UI2):
		// the View made stale is the one still without a Chunk, as before the P3 test generated `empty`.
		const entered = deferred<void>(), gate = deferred<void>();
		p.hooks.before = async value => { if (value.bodySemantropy === 25) { entered.resolve(); await gate.promise; } };
		const pending = shown.view.setBodySemantropy(assertBodySemantropy(25)); await entered.promise;
		idle.view.notifyVocabularySourceEvent("target.md"); gate.resolve();
		expect(await pending).toBe("failed");
		expect(body(shown)).toEqual(before[1]); expect(body(empty)).toEqual(generated);
		expect(body(idle)).toEqual(before[2]); expectNoChunk(idle);
		expect(p.store.getBodySemantropy()).toBe(50);
		for (const h of [empty, shown, idle]) await h.view.onClose();
	});
	it("Automatic parts of speech Apply commits with no Chunk, and the first Chunk is an open with those options", async () => {
		for (const options of [NONE, ALL, { noun: false, verb: true, iAdjective: true, adverb: false }]) {
			const p = await plugin(100, { noun: true, verb: false, iAdjective: false, adverb: false }), later = p.view(), shown = p.view();
			await open(later, true); await open(shown, false);
			expect(await later.view.applyAutomaticPos(options)).toBe("committed");
			expectNoChunk(later);
			expect(later.controller().getAutomaticOptions()).toEqual(options);
			expect(shown.controller().getAutomaticOptions()).toEqual(options);
			const now = p.view(); await open(now, false);
			expect(body(shown)).toEqual(body(now));
			expect(await later.view.loadNextSection()).toBe("applied");
			expect(body(later)).toEqual(body(now));
			for (const h of [later, shown, now]) await h.view.onClose();
		}
	});
	it("Vocabulary Apply commits with no Chunk, keeps that owner through the first Chunk, and equals an open then the same Apply", async () => {
		for (const mode of ["uniform", "frequency"] as const) {
			const p = await plugin(100), later = p.view(), now = p.view();
			await open(later, true); await open(now, false);
			const first = later.controller().getVocabularyOwner();
			for (const h of [later, now]) expect(await h.apply(SOURCES, mode)).toBe("applied");
			expectNoChunk(later);
			const applied = later.controller().getVocabularyOwner();
			expect(applied).not.toBe(first);
			expect(applied!.snapshot.sources.map(source => source.path)).toEqual(["source0.md", "source1.md"]);
			expect(activeOwner(later)).toBe(applied);
			// The replaced owner's automatic state went with it; only the applied owner's remains.
			expect([...owners(later).keys()]).toEqual([applied]);
			expect(await later.view.loadNextSection()).toBe("applied");
			expect(later.controller().getVocabularyOwner()).toBe(applied);
			expect(body(later)).toEqual(body(now));
			// Back to Current Note, still with no Chunk on a third View.
			const third = p.view(); await open(third, true);
			for (const h of [third, now]) { h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: mode }); expect(await h.view.applyVocabulary()).toBe("applied"); }
			expectNoChunk(third);
			expect(await third.view.loadNextSection()).toBe("applied");
			expect(body(third)).toEqual(body(now));
			for (const h of [later, now, third]) await h.view.onClose();
		}
	});
	it("marker and Fake Dictionary level changes commit with no Chunk, and the first Chunk shows them", async () => {
		const p = await plugin(100), later = p.view();
		await open(later, true);
		expect(await later.view.changeDisplaySettings({ showReplacementMarkers: false, showDictionaryMarkers: false })).toBe("applied");
		expectNoChunk(later);
		expect(later.controller().getMarkerVisibility()).toEqual({ replacement: false, manual: true, dictionary: false });
		// With no word on screen the Fake Dictionary dialog cannot be open, so its level reaches
		// this View the way a settings-tab change does: re-marked from the stored value.
		later.state.dictionary = assertDictionarySemantropy(75); await later.view.dictionarySettingsChanged();
		expectNoChunk(later);
		expect(later.controller().getDictionarySemantropy()).toBe(75);
		expect(later.view.getMarkerApplyError()).toBeNull();
		const now = p.view(); now.state.dictionary = assertDictionarySemantropy(75); await open(now, false);
		expect(await later.view.loadNextSection()).toBe("applied");
		expect(body(later)).toEqual(body(now));
		expect(later.root().querySelector(".semantropy-replaced")).toBeNull();
		// The markers come back on the Chunk already shown, and on the next one.
		expect(await later.view.changeDisplaySettings({ showReplacementMarkers: true, showDictionaryMarkers: true })).toBe("applied");
		await now.view.applyStoredDisplaySettings();
		for (const h of [later, now]) expect(await h.view.loadNextSection()).toBe("applied");
		expect(body(later)).toEqual(body(now));
		expect(later.root().querySelector(".semantropy-replaced")).not.toBeNull();
		await now.view.onClose(); await later.view.onClose();
	});
});
