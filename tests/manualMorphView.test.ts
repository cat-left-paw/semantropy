// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, morphToken, suffix } from "./support/manualMorphHarness";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { type ManualMorphVocabulary, evaluateManualMorphSlot } from "../src/transform/manualMorphology";
import * as morph from "../src/transform/manualMorphology";
import { immediateScheduler } from "./support/testScheduler";
import { applyManualDisplay } from "../src/analysis/manualDisplay";
import type { ManualOverride } from "../src/analysis/displaySlots";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
const active = (h: ReturnType<typeof manualMorphHarness>) => (Reflect.get(h.controller(), "runtime") as { activeVocabulary: ManualMorphVocabulary }).activeVocabulary;
const whole = (root: Node) => { const range = document.createRange(); range.selectNodeContents(root); return { rangeCount: 1, getRangeAt: () => range }; };
const shape = (root: Element): string => {
	const depth = (el: Element): number => 1 + Math.max(0, ...Array.from(el.children).map(depth));
	return `${root.querySelectorAll("*").length}/${depth(root)}`;
};
const standard = () => lexiconTokenizer([morphToken("書い"), morphToken("描い"), morphToken("歩い"), suffix("て"), suffix("で"),
	morphToken("青い", "形容詞・アウオ段", "基本形", "形容詞"), morphToken("赤い", "形容詞・アウオ段", "基本形", "形容詞"),
	token({ surface: "猫" }), token({ surface: "犬" })]);

describe("MORPH2 production connection forms", () => {
	it.each([
		["書い", "描い", "五段・カ行イ音便", "連用タ接続", "て", "助詞", "動詞"],
		["書い", "歩い", "五段・カ行イ音便", "連用タ接続", "た", "助動詞", "動詞"],
		["泳い", "脱い", "五段・ガ行", "連用タ接続", "で", "助詞", "動詞"],
		["泳い", "急い", "五段・ガ行", "連用タ接続", "だ", "助動詞", "動詞"],
		["待っ", "持っ", "五段・タ行", "連用タ接続", "て", "助詞", "動詞"],
		["飲ん", "読ん", "五段・マ行", "連用タ接続", "だ", "助動詞", "動詞"],
		["遊ん", "飛ん", "五段・バ行", "連用タ接続", "で", "助詞", "動詞"],
		["書か", "描か", "五段・カ行イ音便", "未然形", "ない", "助動詞", "動詞"],
		["書き", "描き", "五段・カ行イ音便", "連用形", "ます", "助動詞", "動詞"],
		["書か", "描か", "五段・カ行イ音便", "未然形", "せ", "動詞", "動詞"],
		["書く", "描く", "五段・カ行イ音便", "基本形", "。", "記号", "動詞"],
		["食べ", "見", "一段", "未然形", "ない", "助動詞", "動詞"],
		["青い", "赤い", "形容詞・アウオ段", "基本形", "。", "記号", "形容詞"],
		["青く", "赤く", "形容詞・アウオ段", "連用テ接続", "て", "助詞", "形容詞"],
		["青く", "赤く", "形容詞・アウオ段", "連用テ接続", "ない", "助動詞", "形容詞"],
		["青かっ", "赤かっ", "形容詞・アウオ段", "連用タ接続", "た", "助動詞", "形容詞"],
		["青けれ", "赤けれ", "形容詞・アウオ段", "仮定形", "ば", "助詞", "形容詞"],
	])("supports %s → %s before %s/%s/%s", async (a, b, type, form, next, nextPos, pos) => {
		const tokenizer = lexiconTokenizer([morphToken(a, type, form, pos), morphToken(b, type, form, pos), suffix(next, nextPos, nextPos === "助動詞" ? "*" : nextPos === "動詞" ? "接尾" : nextPos === "記号" ? "句点" : "接続助詞")]);
		const h = manualMorphHarness(tokenizer); const tail = next === "せ" ? "せられなかった。" : next + (next === "。" ? "" : "。");
		await h.open(a + tail); expect(await h.apply([b + tail])).toBe("applied");
		const before = h.plan(), slot = h.current(a); expect(slot.manualClass).toBe(pos === "動詞" ? "verb" : "i-adjective");
		expect(slot.manualAvailable).toBe(true); expect(slot.automaticReplaceable).toBe(false); expect(before.replacementCount).toBe(0);
		const calls = h.calls.tokenizations.length;
		expect(h.controller().shuffleManual(slot)).toBe("applied"); expect(h.controller().getLogicalText()).toBe(b + tail);
		expect(h.current(a).manualOverride).toMatchObject({ kind: "replacement", displayFormId: h.current(a).displayCandidate!.displayFormId, surface: b, localRevision: 1 });
		expect(h.controller().restoreManual(h.current(a))).toBe("applied"); expect(h.controller().getLogicalText()).toBe(a + tail);
		expect(h.controller().useAutomatic(h.current(a))).toBe("applied"); expect(h.controller().getManualOverrideCount()).toBe(0);
		expect(h.calls.tokenizations).toHaveLength(calls); expect(h.plan().replaceableSlotCount).toBe(before.replaceableSlotCount);
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]); await h.view.onClose();
	});

	it.each([
		{ conjugationType: "*" }, { conjugationForm: "*" }, { baseForm: "*" }, { isUnknown: true },
		{ conjugationType: "カ変・クル" }, { conjugationForm: "命令ｅ" }, { pos: "名詞", detail1: "形容動詞語幹" },
	])("rejects unsupported morphology %j with no Manual marker or entry", async bad => {
		const original = { ...morphToken("書い"), ...bad };
		const h = manualMorphHarness(lexiconTokenizer([original, morphToken("描い"), suffix("て")]));
		await h.open("書いて。"); await h.apply(["描いて。"]);
		const slot = h.current("書い");
		// Noun-adjectival stems are not promoted into i-adjective Manual.
		expect(slot.manualClass).not.toBe("i-adjective"); expect(slot.manualAvailable).toBe(false);
		if (bad.pos !== "名詞") { expect(slot.manualEligible).toBe(false); expect(h.controller().shuffleManual(slot)).toBe("stale"); }
		expect(h.root().querySelectorAll(".semantropy-manual-available")).toHaveLength(0);
		h.root().dispatchEvent(new MouseEvent("click", { bubbles: true })); expect(h.peek.contentEl.querySelector(".semantropy-manual-menu")).toBeNull();
	});
	it.each(["書い", "書い`code`て。", "書い\n\nて。", "書いで。"])("never joins a missing or unsupported next token: %s", async target => {
		const h = manualMorphHarness(standard(), 3); await h.open(target); await h.apply(["描いて。"]);
		expect(h.current("書い").manualEligible).toBe(false); expect(h.current("書い").manualAvailable).toBe(false);
	});
});

describe("MORPH2 provenance, draw and exact identity", () => {
	it.each(["uniform", "frequency"] as const)("uses only observed evaluator candidates in %s, including Current Note and multiple Sources", async mode => {
		const h = manualMorphHarness(standard()); const analyzer = vi.spyOn(morph, "analyzeManualMorphSource");
		await h.open("書いて。描いて。青い。赤い。猫犬。");
		expect(analyzer).toHaveBeenCalledOnce(); expect(h.current("書い").manualAvailable).toBe(true);
		expect(await h.view.applyVocabulary()).toBe("applied"); expect(analyzer).toHaveBeenCalledTimes(2);
		expect(await h.apply(["描いて。描いて。描いて。歩いで。", "書いて。青い。赤い。"], mode)).toBe("applied");
		expect(analyzer.mock.calls.slice(-2).map(([input]) => input.sourcePath)).toEqual(["source0.md", "source1.md"]);
		const group = active(h), calls = h.calls.tokenizations.length;
		for (let i = 0; i < 20; i++) {
			const slot = h.current("書い"), run = h.plan().runs.find(r => r.slots.includes(slot))!;
			const choices = evaluateManualMorphSlot({ target: slot.originalToken, next: run.slots[slot.occurrence + 1]!.originalToken, currentSurface: slot.displaySurface, ...group });
			expect(h.controller().shuffleManual(slot)).toBe("applied"); expect(choices.candidates.map(c => c.surface)).toContain(h.current("書い").displaySurface);
			expect(h.current("書い").displaySurface).not.toBe("歩い");
		}
		expect(h.calls.tokenizations).toHaveLength(calls); expect(h.calls.reads).toEqual(["source0.md", "source1.md"]);
	});
	it("rejects clone/foreign Snapshot/evidence/group/slot/revision/override and releases its owner", async () => {
		const a = manualMorphHarness(standard()), b = manualMorphHarness(standard());
		await a.open("書いて。描いて。"); await b.open("書いて。描いて。");
		const old = a.current("書い"), group = active(a), other = active(b), work = { isCurrent: () => true, scheduler: immediateScheduler() };
		for (const forged of [{ ...group }, { ...group, snapshot: structuredClone(group.snapshot) }, { ...group, snapshot: other.snapshot }, { ...group, evidence: other.evidence }, { ...group, evidence: { ...group.evidence } }]) {
			expect(await a.controller().prepareVocabulary(forged, work)).toBeNull(); expect(active(a)).toBe(group);
		}
		expect(a.controller().shuffleManual({ ...old })).toBe("stale"); expect(a.controller().shuffleManual(b.current("書い"))).toBe("stale");
		expect(a.controller().shuffleManual(old)).toBe("applied"); expect(a.controller().shuffleManual(old)).toBe("stale");
		const overrides = Reflect.get(a.controller(), "manualOverrides") as Map<string, ManualOverride>, saved = overrides.get(old.tokenId)!;
		overrides.set(old.tokenId, { ...saved });
		expect(() => a.controller().transform(7, assertBodySemantropy(0))).toThrow("Invalid Manual owner"); overrides.set(old.tokenId, saved);
		expect(a.controller().shuffleManual(a.current("書い"))).toBe("applied");
		const latest = overrides.get(old.tokenId)!; overrides.set(old.tokenId, saved);
		expect(() => a.controller().transform(7, assertBodySemantropy(0))).toThrow("Invalid Manual owner"); overrides.set(old.tokenId, latest);
		await a.view.onClose(); expect(a.controller().getVocabularySources()).toBeUndefined(); expect(a.controller().getVocabularySnapshot()).toBeNull(); expect(a.controller().getManualOverrideCount()).toBe(0);
	});
	it("keeps distinct exact display forms sharing candidateId and revalidates Ruby/connection", async () => {
		const a = "がく", b = "か\u3099く";
		const tokenizer = lexiconTokenizer([morphToken(a, "五段・カ行イ音便", "基本形"), { ...morphToken(b, "五段・カ行イ音便", "基本形"), baseForm: a }]);
		const h = manualMorphHarness(tokenizer); await h.open(`${a}。${b}。`);
		const records = active(h).snapshot.candidates.filter(c => c.token.pos === "動詞");
		expect(records).toHaveLength(2); expect(records[0]!.candidateId).toBe(records[1]!.candidateId); expect(records[0]!.displayFormId).not.toBe(records[1]!.displayFormId);
		for (let i = 0; i < 10; i++) { expect(h.controller().shuffleManual(h.current(a))).toBe("applied"); expect(h.current(a).displaySurface).toBe(i % 2 === 0 ? b : a); }
		const slot = h.current(a), saved = slot.manualOverride!;
		if (saved.kind !== "replacement") throw Error();
		for (const changed of [{ surface: "unobserved" }, { displayFormId: "other" }, { connectionKey: "other" }, { rubyVariantId: "forged" }]) {
			expect(() => applyManualDisplay(h.plan(), active(h), new Map([[slot.tokenId, { ...saved, ...changed }]]))).toThrow();
		}
	});
	it("does not freeze or change caller-owned Tokens, Snapshot or evidence", async () => {
		const tokenizer = standard(), retained: object[] = [];
		const wrapped = { tokenize: async (text: string) => { const tokens = await tokenizer.tokenize(text); retained.push(tokens, ...tokens); return tokens; } };
		const h = manualMorphHarness(wrapped); await h.open("書いて。描いて。"); await h.apply(["描いて。"]);
		expect(retained.every(value => !Object.isFrozen(value))).toBe(true);
		const snapshot = structuredClone(active(h).snapshot), evidence = { ...active(h).evidence }, before = JSON.stringify([snapshot, evidence]);
		expect(evaluateManualMorphSlot({ target: h.current("書い").originalToken, next: suffix("て"), currentSurface: "書い", snapshot, evidence }).available).toBe(false);
		expect(JSON.stringify([snapshot, evidence])).toBe(before); expect(Object.isFrozen(snapshot)).toBe(false); expect(Object.isFrozen(evidence)).toBe(false);
	});
});

describe("MORPH2 Ruby, local transaction and lifecycle", () => {
	it.each([["書い", "描い", "て", "動詞"], ["青い", "赤い", "", "形容詞"]])("keeps candidate Ruby on returning to original surface %s, Restore alone restores Target Ruby", async (a, b, tail) => {
		const h = manualMorphHarness(standard()); await h.open(`｜${a}《もと》${tail}。`); await h.apply([`｜${a}《べつ》${tail}。｜${b}《こうほ》${tail}。`]);
		expect(h.controller().shuffleManual(h.current(a))).toBe("applied"); expect(h.root().querySelector("rt")!.textContent).toBe("こうほ");
		expect(h.controller().shuffleManual(h.current(a))).toBe("applied"); expect(h.current(a).displaySurface).toBe(a); expect(h.current(a).displayRuby?.reading).toBe("べつ"); expect(h.root().querySelector("rt")!.textContent).toBe("べつ");
		expect(h.controller().restoreManual(h.current(a))).toBe("applied"); expect(h.root().querySelector("rt")!.textContent).toBe("もと");
		expect(h.controller().useAutomatic(h.current(a))).toBe("applied"); expect(h.root().querySelector("rt")!.textContent).toBe("もと");
	});
	it.each([["書い", "青い"], ["青い", "書い"]])("shares a canonical Ruby boundary for %s then %s, mixed actions and Clear", async (first, second) => {
		const h = manualMorphHarness(standard()); await h.open("｜書いて青い《まとめ》。"); await h.apply(["書いて青い。描いて赤い。"]);
		const baseline = h.root().innerHTML, baselineShape = shape(h.root());
		const exact = async () => {
			const expected = h.plan().slots.map(s => s.displaySurface).join("");
			const clone = h.root().cloneNode(true) as HTMLElement; clone.querySelectorAll("rt,rp").forEach(el => el.remove());
			expect(clone.textContent).toBe(expected); expect(h.controller().getLogicalText()).toBe(expected);
			expect(await h.view.copySelectedFragment({ selection: whole(h.root()) })).toBe("copied"); expect(h.calls.copy.at(-1)).toBe(expected);
			expect(await h.view.collectSelectedFragment({ selection: whole(h.root()) })).toBe("created"); expect(h.calls.collect.at(-1)).toMatchObject({ text: expected, algorithmVersion: 11 });
			expect(expected).not.toContain("まとめ");
		};
		const shapes = new Set<string>();
		for (let i = 0; i < 30; i++) {
			expect(h.controller().shuffleManual(h.current(first))).toBe("applied"); await exact();
			expect(h.controller().shuffleManual(h.current(second))).toBe("applied"); await exact(); shapes.add(shape(h.root()));
			expect(h.controller().restoreManual(h.current(first))).toBe("applied"); await exact();
			expect(h.controller().useAutomatic(h.current(second))).toBe("applied"); await exact();
			expect(h.controller().shuffleManual(h.current(second))).toBe("applied");
			expect(h.controller().clearManual()).toBe("applied"); expect(h.root().innerHTML).toBe(baseline); expect(shape(h.root())).toBe(baselineShape);
		}
		expect(shapes.size).toBe(1);
	});
	it.each([false, true])("rolls back second Clear publication including selection and scroll (after=%s), then retries", async after => {
		const h = manualMorphHarness(standard()); await h.open("書いて。\n\n青い。"); await h.apply(["描いて。赤い。"]);
		for (const word of ["書い", "青い"]) expect(h.controller().shuffleManual(h.current(word))).toBe("applied");
		const before = h.plan(), group = active(h), runtime: unknown = Reflect.get(h.controller(), "runtime"), revision = h.controller().getDisplayRevision();
		const nodes = h.controller().getTextNodes(), selection = document.getSelection()!; selection.setBaseAndExtent(nodes.at(-1)!, 1, nodes[0]!, 0);
		const html = h.root().innerHTML, picked = h.controller().readLogicalSelection(selection); h.peek.contentEl.scrollTop = 83;
		const replace = Object.getOwnPropertyDescriptor(Node.prototype, "replaceChild")!.value as (this: Node, next: Node, old: Node) => Node; let calls = 0;
		const fault = vi.spyOn(Node.prototype, "replaceChild").mockImplementation(function <T extends Node>(this: Node, next: Node, old: T): T {
			calls++; if (calls === 2 && !after) throw Error("private"); const result = replace.call(this, next, old) as T;
			if (calls === 2 && after) throw Error("private"); return result;
		});
		expect(h.controller().clearManual()).toBe("failed"); fault.mockRestore();
		expect(h.root().innerHTML).toBe(html); expect(h.plan()).toBe(before); expect(active(h)).toBe(group); expect(Reflect.get(h.controller(), "runtime")).toBe(runtime);
		expect(h.controller().getDisplayRevision()).toBe(revision); expect(h.controller().getManualOverrideCount()).toBe(2); expect(h.controller().isDisplayIntact()).toBe(true);
		expect(h.controller().readLogicalSelection(selection)).toEqual(picked); expect(selection.anchorNode).toBe(nodes.at(-1)); expect(selection.focusNode).toBe(nodes[0]); expect(h.peek.contentEl.scrollTop).toBe(83);
		expect(h.controller().clearManual()).toBe("applied"); expect(h.controller().getManualOverrideCount()).toBe(0);
	});
	it("maps variable-length forms, preserves unrelated nodes and creates metadata only for loaded Chunks", async () => {
		const tokenizer = lexiconTokenizer([morphToken("食べ", "一段", "未然形"), morphToken("見", "一段", "未然形"), suffix("ない", "助動詞", "*")]);
		const evaluate = vi.spyOn(morph, "evaluateManualMorphSlot"), h = manualMorphHarness(tokenizer, 10);
		await h.open("食べない。\n".repeat(10)); await h.apply(["見ない。食べない。"]);
		expect(h.controller().getChunkStats().chunks).toBe(1); expect(h.plan().slots.length).toBe(h.controller().getChunkStats().tokens);
		expect(new Set(evaluate.mock.calls.map(([input]) => input.target.surface))).toEqual(new Set(["食べ", "ない", "。", "\n"]));
		await h.view.loadNextSection(); const second = h.root().childNodes[1], calls = h.calls.tokenizations.length, reads = h.calls.reads.length;
		expect(h.controller().shuffleManual(h.current("食べ"))).toBe("applied"); expect(h.root().childNodes[1]).toBe(second);
		const logical = h.controller().getLogicalText(); expect(logical.startsWith("見ない。")).toBe(true);
		expect(h.controller().readLogicalSelection(whole(h.root()))).toEqual({ start: 0, end: logical.length, text: logical });
		expect(h.controller().resolveLogicalRange(1, 3)).toBe("ない"); expect(h.calls.tokenizations).toHaveLength(calls); expect(h.calls.reads).toHaveLength(reads);
	});
	it.each(["reshuffle", "refresh", "apply"])("keeps overrides on failed %s, clears only after success", async operation => {
		const h = manualMorphHarness(standard()); await h.open("書いて。描いて。青い。赤い。猫犬。");
		expect(await h.view.setBodySemantropy(assertBodySemantropy(100))).toBe("applied"); h.controller().shuffleManual(h.current("書い"));
		const controller = h.controller(), plan = h.plan(), group = active(h);
		const parent = operation === "refresh" ? h.root().parentElement! : h.root(), replace = parent.replaceChildren.bind(parent);
		const fault = vi.spyOn(parent, "replaceChildren").mockImplementation((...nodes) => { replace(...nodes); throw Error("private"); });
		const act = () => operation === "reshuffle" ? h.view.reshuffle({ issueSeed: () => 99 }) : operation === "refresh" ? h.view.refreshSource() : h.view.applyVocabulary();
		expect(await act()).toBe("failed"); fault.mockRestore(); expect(h.controller()).toBe(controller); expect(h.plan()).toBe(plan); expect(active(h)).toBe(group); expect(controller.getManualOverrideCount()).toBe(1);
		expect(await act()).toBe(operation === "refresh" ? "refreshed" : "applied"); expect(h.controller().getManualOverrideCount()).toBe(0);
	});
	it("keeps overrides on Text/Off/Load/display/Dictionary, and during stale/cancelled Apply", async () => {
		const h = manualMorphHarness(standard(), 12); await h.open("書いて。描いて。青い。赤い。猫犬。\n".repeat(10));
		h.controller().shuffleManual(h.current("書い")); const expected = h.current("書い").displaySurface, group = active(h);
		for (const level of [100, 0]) { expect(await h.view.setBodySemantropy(assertBodySemantropy(level))).toBe("applied"); expect(h.current("書い").displaySurface).toBe(expected); }
		expect(await h.view.loadNextSection()).toBe("applied"); expect(await h.view.setMarkerVisibility({ manual: false })).toBe("applied");
		const dictionary = await h.controller().prepareMarkers(assertDictionarySemantropy(0), {}, { isCurrent: () => true, scheduler: immediateScheduler() });
		expect(dictionary.status).toBe("prepared"); if (dictionary.status === "prepared") expect(dictionary.commit()).toBe("applied");
		expect(h.current("書い").displaySurface).toBe(expected); expect(active(h)).toBe(group);
		for (const reason of ["cancel", "changed", "missing"] as const) {
			const gate = deferred<string>(), entered = deferred<void>(); h.host.readCurrentText = async () => { entered.resolve(); return gate.promise; };
			h.view.setVocabularyDraft({ mode: "selected", paths: ["new.md"], drawMode: "uniform" }); const pending = h.view.applyVocabulary(); await entered.promise;
			if (reason === "cancel") h.view.cancelVocabulary(); else h.view.notifyVocabularySourceEvent("new.md", reason);
			gate.resolve("描いて。"); expect(await pending).toBe("aborted"); expect(active(h)).toBe(group); expect(h.controller().getManualOverrideCount()).toBe(1);
		}
	});
});
