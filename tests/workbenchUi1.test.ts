// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { testScheduler } from "./support/testScheduler";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";
import { ALERT_LEXICON, RICH_TEXT as ALERT_TEXT } from "./fakeAlertCoreFixtures";
import { LEXICON as PROVERB_LEXICON, RICH_TEXT as PROVERB_TEXT } from "./fakeProverbCoreFixtures";
import { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import { sha256Hex } from "../src/vocabulary/sha256";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { AutomaticPosCoordinator } from "../src/application/AutomaticPosCoordinator";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import type { SemantropySessionState } from "../src/application/SemantropySession";
import { toSemantropyViewModel } from "../src/view/semantropyViewModel";
import { REFRESH_TO_GENERATE_MESSAGE, toToolbarStatusModel } from "../src/view/toolbarStatusModel";
import { EN_MESSAGES, UI_CATALOGS } from "../src/i18n/catalog";
import { setCurrentUiLanguage } from "../src/i18n/language";
import type { CollisionSession } from "../src/view/CollisionSession";
import type { FakeProverbSession } from "../src/view/FakeProverbSession";
import type { RecomposePane } from "../src/view/RecomposePane";
import type { FakeAlertModal } from "../src/view/FakeAlertModal";
import type { SemantropyView } from "../src/view/SemantropyView";
import type { AutomaticPosOptions } from "../src/transform/automaticPosOptions";
import type { ManualMorphVocabulary } from "../src/transform/manualMorphology";

/**
 * WORKBENCH-UI1 stage 1 (`Docs/release_0_2_0_plan.md` §3.2-§3.4): a host flag
 * that opens a note with its analysis and Vocabulary owner ready but without a
 * Shuffle. "Not generated" is a ready session whose body has no Chunk yet; the
 * first Shuffle is the existing Load next path. The flag is off by default, in
 * Obsidian and on the web page alike, and off changes nothing.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); setCurrentUiLanguage("en"); });

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
const TARGET = "猫《ねこ》ゆっくり歩く。\n犬じっくり書く。\n美しい。歩いた。\n走った。高かった。\n鳥もっと歩く。\n".repeat(2);
const OTHER = "鳥じっくり歩く。\n猫は東京。\n犬もっと書いた。\n美しい。\n".repeat(2);
const SOURCES = ["書く。犬《いぬ》。東京。早い。もっと歩く。", "鳥じっくり歩いた。美しい。"];
const ALL: AutomaticPosOptions = { noun: true, verb: true, iAdjective: true, adverb: true };

type Harness = ReturnType<typeof manualMorphHarness> & { notices: string[] };
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });
function harness(defer: boolean | undefined, level = 100, lexicon: Parameters<typeof lexiconTokenizer>[0] = LEXICON, size = 20): Harness {
	const h = manualMorphHarness(lexiconTokenizer(lexicon), size);
	h.state.level = assertBodySemantropy(level);
	if (defer !== undefined) h.host.deferInitialShuffle = defer;
	const notices: string[] = [];
	h.host.showNotice = message => { notices.push(message); };
	const result = Object.assign(h, { notices });
	opened.push(result);
	return result;
}
/** One plugin-wide store and coordinator, as the plugin wires every View. */
async function plugin(level: number, automaticPos: AutomaticPosOptions = ALL) {
	let disk: unknown = { schemaVersion: 4, bodySemantropy: level, dictionarySemantropy: 50, collectionPath: "Semantropy Collection.md",
		displayRubyVisible: true, displayMarkersVisible: true, automaticPos };
	const store = new AutomaticPosSettingsStore({ load: async () => disk, save: async value => { disk = structuredClone(value); } });
	await store.load();
	const coordinator = new AutomaticPosCoordinator(store);
	return { store, view: (defer: boolean | undefined) => {
		const h = harness(defer, level);
		h.host.automaticPosCoordinator = coordinator; h.host.getAutomaticPos = () => store.getSettings().automaticPos;
		h.host.getBodySemantropy = () => store.getBodySemantropy();
		return h;
	} };
}
/** An Open of a note into a View that already shows one: the plugin's `openCapture` without a fresh shell. */
async function reopen(h: Harness, sourcePath: string, text: string) {
	if (sourcePath === "target.md") h.state.text = text; else h.notes.set(sourcePath, text);
	await h.view.openCapture({ kind: "markdown", note: { sourcePath, sourceName: sourcePath.replace(/\.md$/u, ""), editorText: text } },
		{ readCached: async () => text, hashText: async value => sha256Hex(value), issueSeed: () => 7 });
}
const refresh = (h: Harness) => h.view.refreshSource({ issueSeed: () => 7, hashText: async value => sha256Hex(value) });
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const q = <T extends HTMLElement>(h: Harness, selector: string) => h.peek.contentEl.querySelector<T>(selector);
const generateButton = (h: Harness) => q<HTMLButtonElement>(h, ".semantropy-generate-button");
const toolbarButton = (h: Harness, name: "reshuffle" | "refresh" | "copy" | "collect") => q<HTMLButtonElement>(h, `.semantropy-${name}`)!;
const named = (h: Harness, label: string) => q<HTMLButtonElement>(h, `button[aria-label="${label}"]`)!;
const status = (h: Harness) => q(h, ".semantropy-status")!;
const message = (h: Harness) => q(h, ".semantropy-message")!.textContent;
const owner = (h: Harness) => (h.view as unknown as { collisionVocabulary(): ManualMorphVocabulary | null }).collisionVocabulary();
/** Everything a reader sees of the body and everything a later Copy, Collect or Reshuffle reads from it. */
function body(h: Harness) {
	const state = h.peek.session.getState();
	if (state.status !== "ready") throw Error("not ready");
	return {
		html: h.root().innerHTML,
		text: h.controller().getLogicalText(),
		slots: h.plan().slots.map(slot => [slot.tokenId, slot.displaySurface, slot.automaticSurface, slot.displayRuby?.variantId ?? null, slot.manualEligible, slot.dictionaryAvailable]),
		provenance: h.controller().getAutomaticProvenance(),
		session: [state.snapshot.sourcePath, state.snapshot.contentHash, state.bodySeed, state.bodySemantropy, state.replacementCount, state.replaceableSlotCount, state.tokenSequences.length],
		stats: h.controller().getChunkStats(),
	};
}
/** Ready, owner prepared, and nothing of any Chunk built. */
function expectUngenerated(h: Harness) {
	expect(h.peek.session.getState().status).toBe("ready");
	expect(h.controller().getChunkStats().chunks).toBe(0);
	expect(h.controller().getChunkStats().totalChunks).toBeGreaterThan(0);
	expect(h.root().childNodes).toHaveLength(0);
	expect(h.plan().slots).toHaveLength(0);
	expect(h.peek.contentEl.querySelectorAll(".semantropy-token")).toHaveLength(0);
	expect(h.controller().getVocabularyOwner()).not.toBeNull();
	expect(q(h, ".semantropy-generate")!.hidden).toBe(false);
	expect(q<HTMLButtonElement>(h, ".semantropy-load-next")!.hidden).toBe(true);
	expect(status(h).dataset["state"]).not.toBe("ready");
}
function expectGenerated(h: Harness) {
	expect(h.controller().getChunkStats().chunks).toBeGreaterThan(0);
	expect(q(h, ".semantropy-generate")!.hidden).toBe(true);
	expect(generateButton(h)!.disabled).toBe(true);
	expect(status(h).dataset["state"]).not.toBe("not-generated");
}

describe("WORKBENCH-UI1 off (the default)", () => {
	it("absent or false opens with the first Chunk and builds the same shell as before", async () => {
		const spy = vi.spyOn(ChunkTargetBodyController.prototype, "open");
		const shells: string[] = [];
		for (const defer of [undefined, false]) {
			const h = harness(defer);
			await h.open(TARGET);
			expect(h.controller().getChunkStats().chunks).toBe(1);
			expect(q(h, ".semantropy-generate")).toBeNull();
			expect(q<HTMLButtonElement>(h, ".semantropy-load-next")!.hidden).toBe(false);
			expect(status(h).dataset["state"]).toBe("ready");
			expect(toolbarButton(h, "copy").disabled).toBe(false);
			// Refresh and an Open into a ready View take their own paths; neither asks to defer.
			h.state.text = TARGET + "猫。\n"; expect(await refresh(h)).toBe("refreshed");
			await reopen(h, "other.md", OTHER);
			expect(h.controller().getChunkStats().chunks).toBe(1);
			expect(await h.view.reshuffle({ issueSeed: () => 9 })).toBe("applied");
			expect(await h.view.loadNextSection()).toBe("applied");
			expect(h.controller().getChunkStats().chunks).toBe(2);
			shells.push(h.peek.contentEl.innerHTML.replace(/semantropy-[a-z-]*\d+(-[a-z]+)*/gu, "id"));
		}
		expect(spy.mock.calls.length).toBeGreaterThanOrEqual(6);
		for (const [input] of spy.mock.calls) expect(input).not.toHaveProperty("deferFirstChunk");
		expect(shells[1]).toBe(shells[0]);
	});
	it("the web page leaves it off (the plugin turned it on in WORKBENCH-UI4: tests/workbenchUi4.test.ts)", () => {
		const web = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
			entry.isDirectory() ? web(path.join(dir, entry.name)) : /\.(ts|mjs|js)$/u.test(entry.name) ? [path.join(dir, entry.name)] : []);
		const files = web("web/src");
		expect(files.length).toBeGreaterThan(5);
		for (const file of files) expect(readFileSync(file, "utf8")).not.toContain("deferInitialShuffle");
	});
});

describe("WORKBENCH-UI1 on: opening without a Shuffle", () => {
	it("analyzes and prepares the owner, shows Generate, and offers no Copy or Collect", async () => {
		const h = harness(true); await h.open(TARGET);
		expectUngenerated(h);
		expect(owner(h)).toBe(h.controller().getVocabularyOwner());
		const button = generateButton(h)!;
		expect([button.textContent, button.disabled, button.type]).toEqual(["Generate", false, "button"]);
		expect(status(h).dataset["state"]).toBe("not-generated");
		expect(message(h)).toBe(EN_MESSAGES.status.notGenerated);
		expect(q(h, ".semantropy-replacements")!.hidden).toBe(true);
		// Reshuffle is Generate; Refresh, the level, Automatic and the Vocabulary stay usable.
		expect(toolbarButton(h, "reshuffle").disabled).toBe(false);
		expect(toolbarButton(h, "refresh").disabled).toBe(false);
		expect(toolbarButton(h, "copy").disabled).toBe(true);
		expect(toolbarButton(h, "collect").disabled).toBe(true);
		expect(q<HTMLSelectElement>(h, ".semantropy-level-select")!.disabled).toBe(false);
		expect(named(h, "Automatic parts of speech").disabled).toBe(false);
		expect(named(h, "Change vocabulary").disabled).toBe(false);
		// The commands find nothing to act on and write nothing.
		expect(await h.view.copySelectedFragment()).toBe("empty");
		expect(await h.view.collectSelectedFragment()).toBe("empty");
		expect([h.calls.copy, h.calls.collect]).toEqual([[], []]);
	});
	it.each(["button", "toolbar", "command", "load next"] as const)("Generate from the %s makes the first Chunk an open would have made, from the same owner", async entry => {
		const off = harness(false); await off.open(TARGET);
		const h = harness(true); await h.open(TARGET);
		const before = h.controller().getVocabularyOwner(), reads = h.calls.tokenizations.length;
		if (entry === "button") {
			generateButton(h)!.focus(); generateButton(h)!.click(); await settle();
			// The button leaves with the first Chunk; keyboard focus moves on to Reshuffle text.
			expect(document.activeElement).toBe(toolbarButton(h, "reshuffle"));
		} else if (entry === "toolbar") { toolbarButton(h, "reshuffle").click(); await settle(); }
		else if (entry === "command") expect(await h.view.reshuffle({ issueSeed: () => 99 })).toBe("applied");
		else expect(await h.view.loadNextSection()).toBe("applied");
		expectGenerated(h);
		expect(body(h)).toEqual(body(off));
		expect(h.controller().getVocabularyOwner()).toBe(before);
		expect(h.calls.tokenizations).toHaveLength(reads);
		expect(q<HTMLButtonElement>(h, ".semantropy-load-next")!.hidden).toBe(false);
		expect(toolbarButton(h, "copy").disabled).toBe(false);
		expect(status(h).dataset["state"]).toBe("ready");
		// From here on it is an ordinary body: Reshuffle draws, Load next appends, Copy copies.
		for (const view of [off, h]) expect(await view.view.reshuffle({ issueSeed: () => 9 })).toBe("applied");
		for (const view of [off, h]) expect(await view.view.loadNextSection()).toBe("applied");
		expect(body(h)).toEqual(body(off));
		const range = document.createRange(); range.selectNodeContents(h.root());
		document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(h.calls.copy).toEqual([h.controller().getLogicalText()]);
	});
	it("the level, Automatic parts of speech and Vocabulary set before Generate are what it uses", async () => {
		const p = await plugin(50, { noun: true, verb: false, iAdjective: false, adverb: false });
		const h = p.view(true); await h.open(TARGET);
		const select = q<HTMLSelectElement>(h, ".semantropy-level-select")!;
		select.value = "100"; select.dispatchEvent(new Event("change", { bubbles: true })); await settle();
		expect(p.store.getBodySemantropy()).toBe(100);
		expect(await h.view.applyAutomaticPos(ALL)).toBe("committed");
		expect(await h.apply(SOURCES)).toBe("applied");
		expectUngenerated(h);
		expect(await h.view.generateBody()).toBe("applied");
		const off = p.view(false); await off.open(TARGET); expect(await off.apply(SOURCES)).toBe("applied");
		expect(body(h)).toEqual(body(off));
		expect(h.controller().getAutomaticProvenance()!.bodySemantropy).toBe(100);
	});
	it("an empty note has no first Chunk to wait for and opens as before; a frontmatter-only one generates to the same empty body", async () => {
		const off = harness(false); await off.open("");
		const h = harness(true); await h.open("");
		expect([h.controller().getChunkStats().totalChunks, h.controller().awaitsFirstChunk()]).toEqual([0, false]);
		expect(q(h, ".semantropy-generate")!.hidden).toBe(true);
		expect([status(h).dataset["state"], message(h)]).toEqual([status(off).dataset["state"], message(off)]);
		expect(await h.view.generateBody()).toBe("unavailable");
		const frontmatter = "---\ntitle: x\n---\n";
		const shown = harness(false); await shown.open(frontmatter);
		const waiting = harness(true); await waiting.open(frontmatter);
		expect(waiting.controller().awaitsFirstChunk()).toBe(true);
		expect(await waiting.view.generateBody()).toBe("applied");
		expect(body(waiting)).toEqual(body(shown));
		expect([status(waiting).dataset["state"], message(waiting)]).toEqual([status(shown).dataset["state"], message(shown)]);
	});
	it("nothing of an unloaded Chunk exists before Generate, and Generate builds exactly the first", async () => {
		const build = vi.spyOn(await import("../src/render/targetBodyController"), "buildTargetDisplay");
		const h = harness(true); await h.open(TARGET);
		expect(build).not.toHaveBeenCalled();
		expect(Reflect.get(h.controller(), "runtime")).toMatchObject({ chunks: [] });
		expect(await h.view.generateBody()).toBe("applied");
		expect(build).toHaveBeenCalledTimes(1);
		expect(h.controller().getChunkStats().chunks).toBe(1);
		expect(await h.view.generateBody()).toBe("unavailable");
		expect(build).toHaveBeenCalledTimes(1);
	});
});

describe("WORKBENCH-UI1 on: Open, Refresh and a changed Target", () => {
	it("an Open of another note, or of the same note again, comes back not generated", async () => {
		const off = harness(false); await off.open(TARGET); await reopen(off, "other.md", OTHER);
		const h = harness(true); await h.open(TARGET);
		expect(await h.view.generateBody()).toBe("applied");
		await reopen(h, "other.md", OTHER);
		expectUngenerated(h);
		expect(h.peek.session.getReadySnapshot()!.sourcePath).toBe("other.md");
		expect(await h.view.generateBody()).toBe("applied");
		expect(body(h)).toEqual(body(off));
		await reopen(h, "other.md", OTHER);
		expectUngenerated(h);
	});
	it("Refresh keeps a generated body generated and a body not generated yet as it is", async () => {
		const changed = TARGET + "猫は東京。\n";
		// Token identity carries the Target revision a Refresh advances, so the comparison is a Refresh too.
		const off = harness(false); await off.open(TARGET);
		off.state.text = changed; expect(await refresh(off)).toBe("refreshed");
		const generated = harness(true); await generated.open(TARGET);
		expect(await generated.view.generateBody()).toBe("applied");
		expect(await generated.view.loadNextSection()).toBe("applied");
		generated.state.text = changed; expect(await refresh(generated)).toBe("refreshed");
		expectGenerated(generated);
		expect(body(generated)).toEqual(body(off));
		const waiting = harness(true); await waiting.open(TARGET);
		waiting.state.text = changed; expect(await refresh(waiting)).toBe("refreshed");
		expectUngenerated(waiting);
		expect(waiting.peek.session.getReadySnapshot()!.contentHash).toBe(sha256Hex(changed));
		expect(await waiting.view.generateBody()).toBe("applied");
		expect(body(waiting)).toEqual(body(off));
	});
	it("a changed Target stops Generate from every entry until Refresh target", async () => {
		const changed = TARGET + "犬は東京。\n";
		const off = harness(false); await off.open(TARGET);
		off.state.text = changed; expect(await refresh(off)).toBe("refreshed");
		const h = harness(true); await h.open(TARGET);
		h.state.text = changed;
		h.view.notifyVocabularySourceEvent("target.md");
		expect(generateButton(h)!.disabled).toBe(true);
		expect(toolbarButton(h, "reshuffle").disabled).toBe(true);
		// Current Note: the Target is the Vocabulary Source too, and the status line says so.
		expect(status(h).dataset["state"]).toBe("vocabulary-stale");
		expect(message(h)).toBe(EN_MESSAGES.status.notGenerated);
		for (const run of [() => h.view.generateBody(), () => h.view.reshuffle(), () => h.view.loadNextSection()]) expect(await run()).toBe("unavailable");
		// The freshness verdict arrives: the stale line now says so, and Generate still waits.
		await h.view.recheckSourceFreshness(changed, { hashText: async value => sha256Hex(value) });
		expect(status(h).dataset["state"]).toBe("target-stale");
		expect(generateButton(h)!.disabled).toBe(true);
		expect(await h.view.generateBody()).toBe("unavailable");
		expectUngenerated(h);
		// Refresh target remains usable, and afterwards Generate shows the note as it is now.
		expect(toolbarButton(h, "refresh").disabled).toBe(false);
		expect(await refresh(h)).toBe("refreshed");
		expect(generateButton(h)!.disabled).toBe(false);
		expect(await h.view.generateBody()).toBe("applied");
		expect(body(h)).toEqual(body(off));
	});
	it("with Selected Notes, a changed Target asks for Refresh target before Generate", async () => {
		const h = harness(true); await h.open(TARGET);
		expect(await h.apply(SOURCES)).toBe("applied");
		h.view.notifyVocabularySourceEvent("target.md");
		expect(status(h).dataset["state"]).toBe("not-generated");
		expect(q(h, ".semantropy-status-detail")!.textContent).toBe(REFRESH_TO_GENERATE_MESSAGE);
		expect(generateButton(h)!.disabled).toBe(true);
		expect(await h.view.generateBody()).toBe("unavailable");
		// The note is back as it was: the check finds it fresh, and Generate still waits for Refresh target.
		await h.view.recheckSourceFreshness(TARGET, { hashText: async value => sha256Hex(value) });
		expect(h.peek.session.getReadySnapshot() && (h.peek.session.getState() as { freshness: string }).freshness).toBe("fresh");
		expect(generateButton(h)!.disabled).toBe(true);
		expect(await refresh(h)).toBe("refreshed");
		expectUngenerated(h);
		expect(status(h).dataset["state"]).toBe("not-generated");
		expect(q(h, ".semantropy-status-detail")!.textContent).toBe("");
		expect(await h.view.generateBody()).toBe("applied");
	});
	it("a renamed or deleted Target stops Generate as well", async () => {
		const h = harness(true); await h.open(TARGET);
		h.view.markSourceLost();
		expect(generateButton(h)!.disabled).toBe(true);
		expect(await h.view.generateBody()).toBe("unavailable");
		expectUngenerated(h);
	});
});

describe("WORKBENCH-UI1 on: busy, close and supersession", () => {
	it("a second Generate is busy, the controls wait, and a close or a Refresh stops it from committing", async () => {
		for (const event of ["close", "refresh", "open"] as const) {
			const h = harness(true); await h.open(TARGET);
			const gate = deferred<void>(), reached = deferred<void>();
			let hold = true;
			h.host.scheduler = testScheduler({ onPaint: async () => { if (hold) { hold = false; reached.resolve(); await gate.promise; } } }).scheduler;
			const pending = h.view.generateBody(); await reached.promise;
			expect(generateButton(h)!.disabled).toBe(true);
			expect(toolbarButton(h, "reshuffle").disabled).toBe(true);
			expect(q(h, ".semantropy-busy")!.hidden).toBe(false);
			expect(await h.view.generateBody()).toBe("busy");
			if (event === "close") await h.view.onClose();
			else if (event === "refresh") expect(await refresh(h)).toBe("refreshed");
			else await reopen(h, "other.md", OTHER);
			gate.resolve();
			expect(await pending).toBe("aborted");
			if (event === "close") expect(h.controller().getChunkStats().chunks).toBe(0);
			else expectUngenerated(h);
		}
	});
});

describe("WORKBENCH-UI1 on: the other generators do not need the body", () => {
	const collisionWords = ["都市", "猫", "海", "星", "雲", "森", "犬", "机", "光", "夢", "雨", "鳥"];
	const collisionLexicon = [...collisionWords.map(surface => token({ surface })), token({ surface: "研究", detail1: "サ変接続" }),
		token({ surface: "眠る", pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形", baseForm: "眠る" })];
	const recomposeLexicon = [
		...["猫", "犬", "森", "川", "空"].map(surface => token({ surface })),
		token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
		token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
		token({ surface: "た", pos: "助動詞", detail1: "*" }),
	];
	const manyNouns = "山 川 海 空 森 林 花 草 木 石 岩 砂 雪 雨 風 雲 星 月 火 水 土 金 銀 鉄 紙 布 針 箱 鍵 扉 壁 床 庭 道 橋 駅 港 塔 城 村".split(" ");
	/** `tabs` gives the host the Recompose tab (WORKBENCH-UI4: the only entry to Recompose). */
	async function ungenerated(lexicon: Parameters<typeof lexiconTokenizer>[0], target: string, sources: string[], tabs = false) {
		const h = harness(true, 50, lexicon); if (tabs) h.host.workbenchTabs = true; await h.open(target);
		expect(await h.apply(sources)).toBe("applied");
		expectUngenerated(h);
		expect(owner(h)).toBe(h.controller().getVocabularyOwner());
		return h;
	}
	const read = <T>(view: SemantropyView, name: string) => Reflect.get(view, name) as T;
	it("Collision generates a batch", async () => {
		const h = await ungenerated(collisionLexicon, "猫は都市。\n", [collisionLexicon.map(word => word.surface).join("")]);
		h.view.openCollision();
		await read<CollisionSession>(h.view, "collisionSession").generate(10, "");
		expect(read<CollisionSession>(h.view, "collisionSession").read()!.batch!.rows.length).toBeGreaterThan(0);
		expectUngenerated(h);
	});
	it("Fake proverb generates a batch", async () => {
		const h = await ungenerated(PROVERB_LEXICON, "猫は夢。\n", [PROVERB_TEXT]);
		h.view.openFakeProverb();
		await read<FakeProverbSession>(h.view, "fakeProverbSession").generate();
		expect(read<FakeProverbSession>(h.view, "fakeProverbSession").batch()).not.toBeNull();
		expectUngenerated(h);
	});
	it("Recompose generates", async () => {
		const h = await ungenerated(recomposeLexicon, "猫と犬。\n", ["猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。"], true);
		q<HTMLButtonElement>(h, ".semantropy-tab-recompose")!.click();
		await read<RecomposePane>(h.view, "recomposeScreen").run("new");
		expect(q(h, ".semantropy-recompose-pane")!.querySelectorAll(".semantropy-recompose-unit").length).toBeGreaterThan(0);
		expectUngenerated(h);
	});
	it("Fake alert opens", async () => {
		const h = await ungenerated([...ALERT_LEXICON, ...manyNouns.map(surface => token({ surface }))], "猫は犬。\n", [ALERT_TEXT]);
		h.view.openFakeAlert();
		expect(read<FakeAlertModal | null>(h.view, "fakeAlertModal")).not.toBeNull();
		expect(h.notices).toEqual([]);
		expectUngenerated(h);
	});
});

describe("WORKBENCH-UI1 wording", () => {
	it("shows Generate and the not-generated status in Japanese, and re-words them in place", async () => {
		setCurrentUiLanguage("ja");
		const h = harness(true); await h.open(TARGET);
		expect(generateButton(h)!.textContent).toBe("生成");
		expect(message(h)).toBe(UI_CATALOGS.ja.status.notGenerated);
		const button = generateButton(h);
		setCurrentUiLanguage("en"); h.view.languageChanged();
		expect(generateButton(h)).toBe(button);
		expect(button!.textContent).toBe("Generate");
		expect(message(h)).toBe(EN_MESSAGES.status.notGenerated);
	});
	it("has every new string in both languages", () => {
		const { en, ja } = UI_CATALOGS;
		for (const [english, japanese] of [[en.status.notGenerated, ja.status.notGenerated], [en.status.refreshToGenerate, ja.status.refreshToGenerate],
			[en.view.generatingText, ja.view.generatingText], [en.view.generateFailed, ja.view.generateFailed]]) {
			expect(english).toMatch(/^[\x20-\x7e…]+$/u);
			expect(japanese).toMatch(/[぀-ヿ]/u);
		}
	});
});

describe("WORKBENCH-UI1 view and status models", () => {
	const snapshot = createSourceSnapshot({ sourcePath: "n.md", sourceName: "n", text: "猫。", contentHash: "a".repeat(64) });
	const ready = (bodySemantropy: number, replaceable: number): SemantropySessionState => ({ status: "ready", snapshot, bodySeed: 7, tokenSequences: [],
		pool: new Map(), replacementCount: 0, replaceableSlotCount: replaceable, bodySemantropy: assertBodySemantropy(bodySemantropy), algorithmVersion: 11, freshness: "fresh" });
	const vocabulary = { preparing: false, progress: null, error: null, staleSources: [] };
	it("without the option the models are exactly as before", () => {
		for (const state of [ready(0, 0), ready(50, 0), ready(50, 3)]) for (const busy of [false, true]) {
			expect(toSemantropyViewModel(state, { busy, ungenerated: false, generateBlocked: true })).toEqual(toSemantropyViewModel(state, { busy }));
			const model = toSemantropyViewModel(state, { busy });
			expect(toToolbarStatusModel({ sessionStatus: "ready", model, taskMessage: null, noticeMessage: null, vocabulary, ungenerated: false, generateBlocked: true }))
				.toEqual(toToolbarStatusModel({ sessionStatus: "ready", model, taskMessage: null, noticeMessage: null, vocabulary }));
		}
	});
	it("not generated: Generate at any level, no Copy or Collect, no count, and its own status", () => {
		for (const level of [0, 50, 100]) {
			const model = toSemantropyViewModel(ready(level, 0), { ungenerated: true });
			expect(model).toMatchObject({ reshuffleEnabled: true, copyEnabled: false, collectEnabled: false, refreshEnabled: true, levelControlEnabled: true,
				replacementLabel: null, message: EN_MESSAGES.status.notGenerated });
			expect(toSemantropyViewModel(ready(level, 0), { ungenerated: true, busy: true }).reshuffleEnabled).toBe(false);
			expect(toSemantropyViewModel(ready(level, 0), { ungenerated: true, generateBlocked: true })).toMatchObject({ reshuffleEnabled: false, refreshEnabled: true });
			const statusModel = (blocked: boolean) => toToolbarStatusModel({ sessionStatus: "ready", model, taskMessage: null, noticeMessage: null, vocabulary, ungenerated: true, generateBlocked: blocked });
			expect(statusModel(false)).toMatchObject({ kind: "not-generated", message: EN_MESSAGES.status.notGenerated, detail: null, replacementLabel: null });
			expect(statusModel(true)).toMatchObject({ kind: "not-generated", detail: REFRESH_TO_GENERATE_MESSAGE });
		}
	});
});
