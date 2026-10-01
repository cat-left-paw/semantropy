// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import type { AutomaticPosBodyOwner } from "../src/render/automaticPosBodyOwner";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { buildManualMorphVocabulary, type ManualMorphSourceAnalysis } from "../src/transform/manualMorphology";
import { createAutomaticPosProjection } from "../src/transform/automaticPosProjection";
import { bindAutomaticPosTarget, transformAutomaticPos } from "../src/transform/automaticPosCore";
import * as maxCore from "../src/transform/maxCore";
import { inspectMaxProjection } from "../src/transform/maxCore";
import { requireMaxOwner } from "../src/transform/maxProjection";
import { DisplaySlotError, planAutomaticDisplaySlots } from "../src/analysis/displaySlots";
import { morphChoices } from "../src/analysis/manualDisplay";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { AutomaticPosCoordinator } from "../src/application/AutomaticPosCoordinator";
import { readCollectFragmentInputV3 } from "../src/collect/v3/CollectedFragmentV3";
import { readCollectFragmentInputV4 } from "../src/collect/v4/CollectedFragmentV4";
import * as rendering from "../src/render/targetBodyController";
import * as dom from "../src/render/targetDomTransaction";
import { bodyV3 } from "./collectV3Fixtures";

/**
 * PRE-RELEASE-MAX-VIEW1: MAX-CORE1 (Body 11 / projection 3 / transform 3 /
 * fingerprint 3) is the production Body path. These tests drive the real View,
 * Chunk controller, settings coordinator and Collect v3 boundary; the core
 * remains the only authority for eligibility, realization and the adverb bridge.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

const v = (surface: string, baseForm: string, conjugationType: string, conjugationForm: string) =>
	token({ surface, pos: "動詞", detail1: "自立", conjugationType, conjugationForm, baseForm });
const a = (surface: string, baseForm: string, conjugationForm: string, conjugationType = "形容詞・イ段") =>
	token({ surface, pos: "形容詞", detail1: "自立", conjugationType, conjugationForm, baseForm });
const adv = (surface: string, detail1 = "一般") => token({ surface, pos: "副詞", detail1, baseForm: "*" });
const LEXICON = [
	token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "東京", detail1: "固有名詞", detail2: "地域" }), token({ surface: "彼", detail1: "代名詞" }),
	v("書く", "書く", "五段・カ行イ音便", "基本形"), v("書い", "書く", "五段・カ行イ音便", "連用タ接続"), v("歩く", "歩く", "五段・カ行イ音便", "基本形"),
	v("歩い", "歩く", "五段・カ行イ音便", "連用タ接続"), v("食べる", "食べる", "一段", "基本形"), v("走っ", "走る", "五段・ラ行", "連用タ接続"),
	v("あっ", "ある", "五段・ラ行", "連用タ接続"), token({ surface: "た", pos: "助動詞", detail1: "*" }),
	a("美しい", "美しい", "基本形"), a("高かっ", "高い", "連用タ接続", "形容詞・アウオ段"), a("早い", "早い", "基本形", "形容詞・アウオ段"),
	adv("ゆっくり", "助詞類接続"), adv("じっくり"), adv("もっと"),
];
const TARGET = "猫ゆっくり歩く。犬じっくり書く。美しい。歩いた。走った。高かった。";
const ALL = { noun: true, verb: true, iAdjective: true, adverb: true };
function harness(level: number, size = 5000) {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON), size); h.state.level = assertBodySemantropy(level);
	return h;
}
type Harness = ReturnType<typeof harness>;
async function withAll(h: Harness, target: string, sources?: string[], mode: "uniform" | "frequency" = "uniform") {
	// The View registers with the plugin-owned coordinator when it opens.
	const store = new AutomaticPosSettingsStore({ load: async () => ({ schemaVersion: 4, bodySemantropy: h.state.level, dictionarySemantropy: 50, collectionPath: "Semantropy Collection.md",
		displayRubyVisible: true, displayMarkersVisible: true, automaticPos: { noun: true, verb: false, iAdjective: false, adverb: false } }), save: async () => undefined });
	await store.load(); h.host.automaticPosCoordinator = new AutomaticPosCoordinator(store); h.host.getAutomaticPos = () => store.getSettings().automaticPos;
	// The Text level is the plugin's one setting; the View reads it back from the same store the coordinator commits.
	h.host.getBodySemantropy = () => store.getBodySemantropy();
	await h.open(target);
	if (sources) expect(await h.apply(sources, mode)).toBe("applied");
	else if (mode === "frequency") { h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: mode }); expect(await h.view.applyVocabulary()).toBe("applied"); }
	expect(await h.view.applyAutomaticPos(ALL)).toBe("committed");
	return store;
}
const surfaces = (h: Harness) => h.plan().slots.map(slot => slot.displaySurface);
function owner(h: Harness): AutomaticPosBodyOwner {
	const owners = Reflect.get(h.controller(), "automaticOwners") as Map<unknown, AutomaticPosBodyOwner>;
	return [...owners.values()].at(-1)!;
}
/** Body 10 over the very same View owner and materialized prefix, as the comparison oracle. */
function body10(h: Harness, level: number) {
	const o = owner(h), prefix = o.prefix(h.controller().getChunkStats().chunks) as { analysis: ManualMorphSourceAnalysis };
	const targetVocabulary = buildManualMorphVocabulary({ sources: [prefix.analysis], drawMode: o.vocabulary.snapshot.drawMode });
	const projection = ok(createAutomaticPosProjection({ vocabulary: o.vocabulary, adverbAuthority: o.authority }));
	const target = ok(bindAutomaticPosTarget({ projection, targetVocabulary, source: prefix.analysis }));
	return ok(transformAutomaticPos({ projection, target, runCount: target.runCount, options: ALL, bodySemantropy: level, nonce: 7 }));
}
function ok<T>(answer: { ok: true; value: T } | { ok: false; reason: string }): T { if (!answer.ok) throw Error(answer.reason); return answer.value; }

describe("MAX-VIEW1 level contract in the production View", () => {
	it("interprets every preset and intermediate level through Body 11 / transform 3 / fingerprint 3, never Body 10", async () => {
		const h = harness(50), store = await withAll(h, TARGET, ["書く。食べる。東京。早い。もっと猫。"]);
		const tokenized = h.calls.tokenizations.length;
		for (const level of [0, 1, 25, 37, 50, 51, 62, 75, 88, 99, 100]) {
			expect(await h.view.setBodySemantropy(assertBodySemantropy(level))).toBe("applied");
			const provenance = h.controller().getAutomaticProvenance()!;
			expect(provenance).toMatchObject({ bodyAlgorithmVersion: 11, algorithmVersion: 3, projectionVersion: "automatic-body-projection-3", bodySemantropy: level });
			expect(provenance.vocabularyFingerprint).toMatch(/^vocabulary-fingerprint-sha256-3:[0-9a-f]{64}$/u);
			expect(h.plan().algorithmVersion).toBe(3);
			if (level === 0) expect(h.plan().replacementCount).toBe(0);
			if (level >= 50) expect(h.plan().replacementCount).toBe(h.plan().replaceableSlotCount);
			expect(store.getBodySemantropy()).toBe(level);
		}
		expect(JSON.stringify(h.controller().getAutomaticProvenance())).not.toMatch(/"(?:nonce|seed|threshold|profile|options)"/u);
		expect(h.calls.tokenizations).toHaveLength(tokenized); // level changes reuse the authenticated analyses
		await h.view.onClose();
	});
	it.each([false, true].flatMap(selected => (["uniform", "frequency"] as const).map(mode => ({ selected, mode }))))("level 50 is Body 10 at 100 across all four parts (Selected Notes=$selected, $mode)", async ({ selected, mode }) => {
		const h = harness(50); await withAll(h, TARGET, selected ? ["書いた。食べる。東京猫。美しい。もっと猫。じっくり歩く。"] : undefined, mode);
		const oracle = body10(h, 100), provenance = h.controller().getAutomaticProvenance()!;
		expect(surfaces(h)).toEqual(oracle.tokenSurfaces.flat());
		expect(provenance.selections.map(run => run.map(item => item && { candidate: item.candidate, rubyVariant: item.rubyVariant }))).toEqual(oracle.selections);
		expect([provenance.replacementCount, provenance.replaceableSlotCount]).toEqual([oracle.replacementCount, oracle.replaceableSlotCount]);
		await h.view.onClose();
	});
});

describe("High / MAX in the View", () => {
	it("realizes verbs from basic-form Sources, keeps unsupported forms, and carries realization without a Snapshot record", async () => {
		const h = harness(50); await withAll(h, "歩いた。走った。", ["書く。あった。"]);
		// strict (level 50 = Body 10 at 100): only the observed exact form あっ + た fits 走っ + た.
		expect(surfaces(h)).toEqual(["歩い", "た", "。", "あっ", "た", "。"]);
		// High keeps each Target's verified class: 走っ (五段・ラ行) has only the excluded ある, so it keeps its text.
		expect(await h.view.setBodySemantropy(assertBodySemantropy(75))).toBe("applied");
		expect(surfaces(h)).toEqual(["書い", "た", "。", "走っ", "た", "。"]);
		expect(h.current("走っ").automaticReplaced).toBe(false);
		// MAX drops the class match: 書く realizes into the た-stem for 走っ too; ある never does.
		expect(await h.view.setBodySemantropy(assertBodySemantropy(100))).toBe("applied");
		expect(surfaces(h)).toEqual(["書い", "た", "。", "書い", "た", "。"]);
		const built = h.current("歩い");
		expect(built.automaticReplaced).toBe(true); expect(built.automaticCandidate).toBeNull(); expect(built.automaticRuby).toBeNull();
		expect(built.dictionary).toEqual({ outcome: "rejected", reason: "not-noun" });
		expect(h.controller().getAutomaticProvenance()!.selections[0]![0]!.realization).toEqual({
			lexemeId: JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "書く"]), formKey: "verb-ta-stem-t" });
		expect(h.root().querySelector(".semantropy-replaced")?.textContent).toBe("書い");
		const whole = document.createRange(); whole.selectNodeContents(h.root()); document.getSelection()!.addRange(whole);
		expect(await h.view.copySelectedFragment()).toBe("copied"); expect(h.calls.copy.at(-1)).toBe("書いた。書いた。");
		expect(await h.view.collectSelectedFragment()).toBe("created");
		expect(h.calls.collect.at(-1)).toMatchObject({ type: "body", text: "書いた。書いた。", algorithmVersion: 11, bodySemantropy: 100, metadataVersion: 4,
			automaticPartsOfSpeech: ["noun", "verb", "i-adjective", "adverb"], hasManualEdits: false });
		expect(readCollectFragmentInputV4(h.calls.collect.at(-1)).ok).toBe(true);
		expect(h.state.text).toBe("歩いた。走った。");
		await h.view.onClose();
	});
	it("relaxes nouns only within the automatic-body projection and adverbs without head / polarity, per part", async () => {
		const h = harness(50); await withAll(h, "猫。ゆっくり猫。", ["犬。東京。彼。じっくり歩く。もっと猫。"]);
		const seen = { noun: new Set<string>(), adverb: new Set<string>() };
		for (const level of [50, 75, 100]) {
			expect(["applied", "unchanged"]).toContain(await h.view.setBodySemantropy(assertBodySemantropy(level)));
			for (let seed = 1; seed < 40; seed++) {
				expect(await h.view.reshuffle({ issueSeed: () => seed })).toBe("applied");
				const [noun, , adverb] = surfaces(h);
				if (level === 50) { expect(["猫", "犬"]).toContain(noun); expect(adverb).toBe("ゆっくり"); }
				else { seen.noun.add(noun!); seen.adverb.add(adverb!); }
			}
		}
		expect([...seen.noun].sort()).toEqual(["東京", "犬"].sort()); // never the pronoun
		expect([...seen.adverb].sort()).toEqual(["じっくり", "もっと"].sort());
		await h.view.onClose();
	});
});

describe("Manual, Ruby and lazy Chunks", () => {
	it("keeps Manual candidates at manual-morph-3 for every level, and Use automatic returns to the current baseline", async () => {
		const h = harness(0); await withAll(h, "歩いた。", ["書いた。食べる。"]);
		const manualSet = () => {
			const run = h.plan().runs[0]!, slot = h.current("歩い");
			const choices = morphChoices(h.controller().getVocabularyOwner()!, run.slots, slot, "");
			return choices.available ? choices.candidates.map(item => item.surface).sort() : [];
		};
		const baseline = manualSet();
		expect(baseline).toEqual(["書い"]);
		for (const level of [25, 50, 75, 100]) {
			expect(await h.view.setBodySemantropy(assertBodySemantropy(level))).toBe("applied");
			expect(manualSet()).toEqual(baseline);
			const automatic = h.current("歩い").automaticSurface;
			if (h.current("歩い").manualAvailable) {
				expect(h.controller().shuffleManual(h.current("歩い"))).toBe("applied");
				expect(baseline).toContain(h.current("歩い").displaySurface); // never a realized-only 食べ
				expect(h.controller().useAutomatic(h.current("歩い"))).toBe("applied");
			}
			expect(h.current("歩い").displaySurface).toBe(automatic);
		}
		await h.view.onClose();
	});
	it("uses Ruby only from an observed record of exactly the realized surface", async () => {
		const withRuby = harness(100); await withAll(withRuby, "歩いた。", ["｜書《か》いた。"]);
		expect(surfaces(withRuby)[0]).toBe("書い"); expect(Array.from(withRuby.root().querySelectorAll("rt")).map(n => n.textContent)).toEqual(["か"]);
		await withRuby.view.onClose();
		const built = harness(100); await withAll(built, "歩いた。", ["｜書《か》く。"]);
		expect(surfaces(built)[0]).toBe("書い"); expect(built.root().querySelectorAll("rt")).toHaveLength(0);
		await built.view.onClose();
	});
	it("loads the next Chunk at MAX without tokenizing and without state for unloaded Chunks", async () => {
		const h = harness(100, 12); await withAll(h, "歩いた。美しい。\n".repeat(8), ["書く。早い。"]);
		const calls = h.calls.tokenizations.length, stats = h.controller().getChunkStats();
		expect(stats.chunks).toBeLessThan(stats.totalChunks);
		const materialized = h.plan().slots.length;
		expect(await h.view.loadNextSection()).toBe("applied");
		expect(h.calls.tokenizations).toHaveLength(calls);
		expect(h.plan().slots.length).toBeGreaterThan(materialized);
		expect(h.controller().getChunkStats().chunks).toBe(stats.chunks + 1);
		expect(h.plan().slots.every(slot => slot.chunkId <= h.plan().slots.at(-1)!.chunkId)).toBe(true);
		await h.view.onClose();
	});
});

describe("multi-View transaction and lifecycle at MAX", () => {
	function shared() {
		let disk: unknown = { schemaVersion: 4, bodySemantropy: 100, dictionarySemantropy: 50, collectionPath: "Semantropy Collection.md",
			displayRubyVisible: true, displayMarkersVisible: true, automaticPos: { noun: true, verb: false, iAdjective: false, adverb: false } };
		const save = vi.fn(async (value: unknown) => { disk = structuredClone(value); });
		const store = new AutomaticPosSettingsStore({ load: async () => disk, save });
		const coordinator = new AutomaticPosCoordinator(store);
		const view = () => { const h = harness(100); h.host.automaticPosCoordinator = coordinator; h.host.getAutomaticPos = () => store.getSettings().automaticPos; return h; };
		return { store, save, view, disk: () => disk };
	}
	it("commits every View together, and a publication failure in one keeps every old generation, setting and saved 100", async () => {
		const s = shared(); await s.store.load(); const x = s.view(), y = s.view();
		await x.open("歩いた。猫。"); await y.open("歩いた。犬。");
		expect(await x.apply(["書く。犬。"])).toBe("applied"); expect(await y.apply(["書く。猫。"])).toBe("applied");
		const before = [x.plan(), y.plan()], nodes = [x.root().firstChild, y.root().firstChild];
		vi.spyOn(rendering, "buildTargetDisplay").mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(Error("private"));
		expect(await x.view.applyAutomaticPos(ALL)).toBe("failed");
		expect([x.plan(), y.plan()]).toEqual(before); expect([x.root().firstChild, y.root().firstChild]).toEqual(nodes);
		expect(s.store.getSettings().automaticPos.verb).toBe(false);
		vi.restoreAllMocks();
		expect(await x.view.applyAutomaticPos(ALL)).toBe("committed");
		for (const h of [x, y]) { expect(h.current("歩い").displaySurface).toBe("書い"); expect(h.controller().getAutomaticProvenance()!.bodyAlgorithmVersion).toBe(11); }
		expect(s.disk()).toMatchObject({ schemaVersion: 8, bodySemantropy: 100, automaticPos: ALL, showRibbonIcon: true });
		await x.view.onClose(); await y.view.onClose();
	});
	it.each(["close", "disable", "source", "apply"] as const)("releases the MAX projection on %s and never republishes it", async event => {
		const h = harness(100); await withAll(h, "歩いた。猫。", ["書く。犬。"]);
		const o = owner(h), current = Reflect.get(Reflect.get(h.controller(), "runtime") as object, "automatic") as { current: () => boolean };
		expect(inspectMaxProjection({ projection: o.projection })).toEqual({ ok: true, value: true }); expect(current.current()).toBe(true);
		if (event === "close") await h.view.onClose();
		else if (event === "disable") h.view.disableAutomatic();
		else if (event === "source") h.view.notifyVocabularySourceEvent("source0.md");
		else expect(await h.apply(["食べる。犬。"])).toBe("applied");
		expect(inspectMaxProjection({ projection: o.projection }).ok).toBe(false);
		// The MAX owner itself is revoked, not only the Adverb authority it is bound to.
		expect(() => requireMaxOwner(o.vocabulary)).toThrow();
		expect(current.current()).toBe(false);
		if (event === "apply") expect(h.controller().isAutomaticCurrent()).toBe(true);
		await h.view.onClose();
	});
});

describe("slot planning trusts only the core's own realization evidence", () => {
	it("refuses a result whose realization names a lexeme or key that does not build the displayed surface", async () => {
		const bind = vi.spyOn(maxCore, "bindMaxTarget");
		const h = harness(100); await withAll(h, "歩いた。", ["書く。食べる。"]);
		const genuine = h.controller().getAutomaticProvenance()!, target = (bind.mock.results.at(-1)!.value as { ok: true; value: maxCore.MaxTarget }).value;
		const selection = genuine.selections[0]![0]!;
		expect(selection.realization).not.toBeNull(); expect(selection.candidate.surface).not.toBe("歩い");
		const runtime = Reflect.get(h.controller(), "runtime") as { chunks: { descriptor: { chunkId: string }; model: { located: { runs: { run: { runId: string; analysisText: string; annotations: unknown[] }; tokens: unknown[] }[] } } }[] };
		const chunks = runtime.chunks.map(chunk => ({ chunkId: chunk.descriptor.chunkId, runs: chunk.model.located.runs.map(({ run, tokens }) =>
			({ runId: run.runId, analysisText: run.analysisText, annotations: run.annotations, tokens })) })) as never;
		const original = maxCore.readMaxResultSlots;
		// Test-only bypass of result authentication, so the planner's own structural check is what refuses.
		vi.spyOn(maxCore, "readMaxResultSlots").mockImplementation(input => original({ ...input, result: genuine }));
		const plan = (result: maxCore.MaxResult) => planAutomaticDisplaySlots({ targetRevision: h.plan().targetRevision, displayRevision: 99, chunks,
			projection: owner(h).projection, target, result, dictionarySemantropy: assertDictionarySemantropy(50) });
		expect(plan(genuine).slots[0]!.displaySurface).toBe(selection.candidate.surface);
		const forge = (realization: { lexemeId: string; formKey: string }) => {
			const forged = structuredClone(genuine) as unknown as { selections: { candidate: { candidateId: string; displayFormId: string }; realization: unknown }[][] };
			const item = forged.selections[0]![0]!; item.realization = realization;
			if (!/"書い"\]$/u.test(item.candidate.displayFormId)) { item.candidate.candidateId = realization.lexemeId; item.candidate.displayFormId = JSON.stringify([realization.lexemeId, selection.candidate.surface]); }
			return forged as unknown as maxCore.MaxResult;
		};
		const other = selection.candidate.surface === "書い" ? JSON.stringify(["動詞", "自立", "一段", "食べる"]) : JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "書く"]);
		for (const realization of [{ lexemeId: other, formKey: selection.realization!.formKey }, { lexemeId: selection.realization!.lexemeId, formKey: "verb-basic" }]) {
			const forged = forge(realization);
			expect(() => plan(forged)).toThrow(DisplaySlotError);
		}
		await h.view.onClose();
	});
});

describe("Collect v3 at Body 11", () => {
	it("accepts Body 11 with fingerprint 3 only, without new fields or a new metadata version", () => {
		expect(readCollectFragmentInputV3(bodyV3()).ok).toBe(true);
		expect(readCollectFragmentInputV3(bodyV3({ algorithmVersion: 10 }))).toEqual({ ok: false, reason: "invalid-algorithm-version" });
		expect(readCollectFragmentInputV3(bodyV3({ vocabulary: { ...bodyV3().vocabulary, fingerprint: `vocabulary-fingerprint-sha256-2:${"ab".repeat(32)}` } })))
			.toEqual({ ok: false, reason: "invalid-fingerprint" });
		const accepted = readCollectFragmentInputV3(bodyV3());
		if (accepted.ok) expect(Object.keys(accepted.value).sort()).toEqual(["algorithmVersion", "automaticPartsOfSpeech", "bodySemantropy", "hasManualEdits", "metadataVersion", "target", "text", "type", "vocabulary"].sort());
	});
});

describe("the Text level is one all-View transaction", () => {
	const record = (h: Harness) => ({ plan: h.plan(), text: h.controller().getLogicalText(), provenance: h.controller().getAutomaticProvenance(), node: h.root().firstChild });
	/** Two Views over one store and coordinator, as the plugin wires them. `save` can be held or failed per write. */
	async function twoViews(level = 50) {
		let disk: unknown = { schemaVersion: 4, bodySemantropy: level, dictionarySemantropy: 50, collectionPath: "Semantropy Collection.md",
			displayRubyVisible: true, displayMarkersVisible: true, automaticPos: ALL };
		const writes: number[] = [], hooks: { before?: (value: { bodySemantropy: number }) => Promise<void> | void } = {};
		const store = new AutomaticPosSettingsStore({ load: async () => disk, save: async value => {
			writes.push(value.bodySemantropy); await hooks.before?.(value); disk = structuredClone(value);
		} });
		await store.load();
		const coordinator = new AutomaticPosCoordinator(store);
		const view = async (source: string) => {
			const h = harness(level); h.host.automaticPosCoordinator = coordinator;
			h.host.getAutomaticPos = () => store.getSettings().automaticPos; h.host.getBodySemantropy = () => store.getBodySemantropy();
			await h.open("歩いた。走った。猫。"); expect(await h.apply([source])).toBe("applied");
			return h;
		};
		const x = await view("書く。あった。犬。"), y = await view("書く。東京。");
		return { store, coordinator, x, y, writes, hooks, disk: () => disk as { bodySemantropy: number } };
	}
	it("publishes a level change to every open View together and saves it once", async () => {
		const t = await twoViews();
		const before = [record(t.x), record(t.y)];
		expect(await t.x.view.setBodySemantropy(assertBodySemantropy(100))).toBe("applied");
		for (const h of [t.x, t.y]) expect(h.controller().getAutomaticProvenance()).toMatchObject({ bodyAlgorithmVersion: 11, bodySemantropy: 100 });
		expect(t.y.plan()).not.toEqual(before[1]!.plan); // the other View no longer shows level 50
		expect(t.y.current("走っ").displaySurface).toBe("書い"); // MAX realization in the View that did not ask
		expect([t.store.getBodySemantropy(), t.disk().bodySemantropy, t.writes]).toEqual([100, 100, [100]]);
		// Either View can drive it; the other follows.
		expect(await t.y.view.setBodySemantropy(assertBodySemantropy(75))).toBe("applied");
		for (const h of [t.x, t.y]) expect(h.controller().getAutomaticProvenance()!.bodySemantropy).toBe(75);
		expect(t.writes).toEqual([100, 75]);
		await t.x.view.onClose(); await t.y.view.onClose();
	});
	it("a failed save keeps every View's body, DOM and provenance and the old setting", async () => {
		const t = await twoViews(), before = [record(t.x), record(t.y)];
		t.hooks.before = value => { if (value.bodySemantropy === 100) throw Error("disk"); };
		expect(await t.x.view.setBodySemantropy(assertBodySemantropy(100))).toBe("failed");
		expect([record(t.x), record(t.y)]).toEqual(before);
		expect([t.store.getBodySemantropy(), t.disk().bodySemantropy]).toEqual([50, 50]);
		await t.x.view.onClose(); await t.y.view.onClose();
	});
	it.each(["close", "source"] as const)("an owner made stale (%s) after the save rolls every View back and compensates the save", async event => {
		const t = await twoViews(), before = [record(t.x), record(t.y)];
		let entered!: () => void, release!: () => void;
		const saving = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
		t.hooks.before = async value => { if (value.bodySemantropy === 100) { entered(); await gate; } };
		const pending = t.x.view.setBodySemantropy(assertBodySemantropy(100)); await saving;
		if (event === "close") await t.y.view.onClose(); else t.y.view.notifyVocabularySourceEvent("source0.md");
		release();
		expect(await pending).toBe("failed");
		expect(record(t.x)).toEqual(before[0]);
		if (event === "source") expect(record(t.y)).toEqual(before[1]);
		// The new value reached disk before the owner went stale; the store wrote the old one back.
		expect([t.store.getBodySemantropy(), t.disk().bodySemantropy, t.writes]).toEqual([50, 50, [100, 50]]);
		await t.x.view.onClose(); await t.y.view.onClose();
	});
	it("a publication failure in one View rolls back the View already published and compensates the save", async () => {
		const t = await twoViews(), before = [record(t.x), record(t.y)];
		const real = dom.targetDomTransaction;
		let calls = 0;
		vi.spyOn(dom, "targetDomTransaction").mockImplementation((root, next) => {
			const transaction = real(root, next);
			return ++calls === 2 ? { ...transaction, publish: () => { throw Error("private"); } } : transaction;
		});
		expect(await t.x.view.setBodySemantropy(assertBodySemantropy(100))).toBe("failed");
		expect(calls).toBe(2);
		expect([record(t.x), record(t.y)]).toEqual(before);
		expect([t.store.getBodySemantropy(), t.disk().bodySemantropy, t.writes]).toEqual([50, 50, [100, 50]]);
		await t.x.view.onClose(); await t.y.view.onClose();
	});
	it("a second change while one is pending is busy, and a View that is not ready refuses without saving", async () => {
		const t = await twoViews();
		let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
		t.hooks.before = async () => { await gate; };
		const first = t.x.view.setBodySemantropy(assertBodySemantropy(100));
		expect(await t.x.view.setBodySemantropy(assertBodySemantropy(75))).toBe("busy");
		release(); expect(await first).toBe("applied");
		const idle = harness(50); idle.host.automaticPosCoordinator = t.coordinator; idle.host.getBodySemantropy = () => t.store.getBodySemantropy();
		expect(await idle.view.setBodySemantropy(assertBodySemantropy(25))).toBe("unavailable");
		expect(t.writes).toEqual([100]);
		await t.x.view.onClose(); await t.y.view.onClose();
	});
	it("a cancelled option Apply keeps the MAX body and publishes nothing late", async () => {
		const h = harness(100); await withAll(h, "歩いた。猫。", ["書く。犬。"]);
		const before = record(h);
		let unblock!: () => void, entered!: () => void;
		const wait = new Promise<void>(resolve => { unblock = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
		h.host.scheduler = { now: () => 0, paint: async () => { entered(); await wait; }, yieldTask: async () => undefined };
		const pending = h.view.applyAutomaticPos({ noun: true, verb: false, iAdjective: false, adverb: false }); await reached;
		h.view.cancelAutomaticPos(); unblock();
		expect(await pending).not.toBe("committed");
		expect(record(h)).toEqual(before);
		await h.view.onClose();
	});
});
