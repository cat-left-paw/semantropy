// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer } from "./support/manualMorphHarness";
import { ALL, NOUN, lexicon, ok, textOwner } from "./automaticPosFixtures";
import { bind } from "./manualAdverbFixtures";
import type { AutomaticPosBodyOwner } from "../src/render/automaticPosBodyOwner";
import { createManualAdverbAuthority, evaluateManualAdverbSlot, inspectManualAdverbAuthority } from "../src/transform/manualAdverbAuthority";
import { createManualAdverbController } from "../src/transform/manualAdverbController";
import { sha256Hex } from "../src/vocabulary/sha256";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { AutomaticPosCoordinator } from "../src/application/AutomaticPosCoordinator";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";
import { deferred } from "./refreshHarness";
import { transformWithVocabularySnapshot } from "../src/vocabulary/vocabularySnapshot";
import * as rendering from "../src/render/targetBodyController";
import { testScheduler } from "./support/testScheduler";
const OFF = { noun: false, verb: false, iAdjective: false, adverb: false };
const text = "猫ゆっくり歩く。犬じっくり書く。美しい。楽しい。";
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
function shared() {
	let disk: unknown = { schemaVersion: 3, bodySemantropy: 100 };
	const save = vi.fn(async (value: unknown) => { disk = structuredClone(value); });
	const store = new AutomaticPosSettingsStore({ load: async () => disk, save });
	const coordinator = new AutomaticPosCoordinator(store);
	const view = () => {
		const h = manualMorphHarness(lexiconTokenizer(lexicon), 35); h.state.level = assertBodySemantropy(100);
		h.host.automaticPosCoordinator = coordinator; h.host.getAutomaticPos = () => store.getSettings().automaticPos;
		return h;
	};
	return { store, coordinator, save, view, disk: () => disk };
}
describe("VIEW1 option transaction", () => {
	it.each(([false, true] as const).flatMap(selected => (["close", "disable", "source", "refresh", "apply"] as const).map(event => ({ selected, event }))))(
		"revokes adverb authority without adverb Target slots: $event selected=$selected", async ({ selected, event }) => {
			const s = shared(); await s.store.load(); const h = s.view(); await h.open("猫。犬。");
			if (selected) expect(await h.apply([text])).toBe("applied");
			expect(h.plan().slots.some(slot => slot.originalToken.pos === "副詞")).toBe(false);
			// Capture the actual View-owned authority; do not infer its lifetime from an Automatic result.
			const owners = Reflect.get(h.controller(), "automaticOwners") as Map<unknown, AutomaticPosBodyOwner>;
			expect(owners.size).toBe(1); const owner = [...owners.values()][0]!;
			expect((Reflect.get(owner, "manual") as Map<unknown, unknown>).size).toBe(0);
			expect(owner.authority.candidates.length).toBe(selected ? 2 : 0);
			expect(inspectManualAdverbAuthority(owner.authority)).toEqual({ ok: true, value: true });
			expect(ok(createManualAdverbAuthority({ vocabulary: owner.vocabulary }))).toBe(owner.authority);
			// A separately minted Target and controller stay outside the Body owner's empty controller map.
			const target = await textOwner(["ゆっくり歩く。"]), slot = bind(owner.authority, target.owner);
			const request = { authority: owner.authority, slot, currentSurface: "ゆっくり" };
			expect(evaluateManualAdverbSlot(request).ok).toBe(true);
			const delayed = ok(createManualAdverbController({ authority: owner.authority, slots: [{ slot, automaticSurface: "ゆっくり" }] }));
			const ticket = ok(delayed.prepare({ slot, action: "restore-original", nonce: 0 }));
			if (event === "close") await h.view.onClose();
			else if (event === "disable") h.view.disableAutomatic();
			else if (event === "source") h.view.notifyVocabularySourceEvent("target.md");
			else if (event === "refresh") {
				h.state.text += "猫。";
				expect(await h.view.refreshSource({ issueSeed: () => 8, hashText: async value => sha256Hex(value) })).toBe("refreshed");
			} else expect(await h.apply(["すぐ歩く。"])).toBe("applied");
			const released = { ok: false, reason: "released" };
			expect(inspectManualAdverbAuthority(owner.authority)).toEqual(released);
			expect(createManualAdverbAuthority({ vocabulary: owner.vocabulary })).toEqual(released);
			expect(evaluateManualAdverbSlot(request)).toEqual(released);
			expect(createManualAdverbController({ authority: owner.authority, slots: [] })).toEqual(released);
			expect(delayed.complete(ticket)).toEqual(released);
			expect(() => owner.release("view-close")).not.toThrow();
			if (event === "refresh" || event === "apply") expect(h.controller().isAutomaticCurrent()).toBe(true);
			await h.view.onClose();
		},
	);
	it.each(["load", "reshuffle"])("refuses Apply during %s and keeps the effective generation", async action => {
		const s = shared(); await s.store.load(); const h = s.view(); await h.open((text + "\n").repeat(4));
		const wait = deferred<void>(), reached = deferred<void>();
		h.host.scheduler = testScheduler({ onPaint: async () => { reached.resolve(); await wait.promise; } }).scheduler;
		const pending = action === "load" ? h.view.loadNextSection() : h.view.reshuffle(); await reached.promise;
		expect(await h.view.applyAutomaticPos(ALL)).not.toBe("committed"); expect(s.save).not.toHaveBeenCalled();
		wait.resolve(); await pending; expect(h.controller().getAutomaticOptions()).toEqual(NOUN); await h.view.onClose();
	});
	it("discards a prepared generation after close without publishing or saving it", async () => {
		const s = shared(); await s.store.load(); const h = s.view(); await h.open(text);
		const wait = deferred<void>(), reached = deferred<void>(), build = rendering.buildTargetDisplay;
		vi.spyOn(rendering, "buildTargetDisplay").mockImplementationOnce(async (...args) => {
			const built = await build(...args); reached.resolve(); await wait.promise; return built;
		});
		const pending = h.view.applyAutomaticPos(ALL); await reached.promise; await h.view.onClose(); wait.resolve();
		expect(await pending).not.toBe("committed"); expect(s.save).not.toHaveBeenCalled();
		expect(h.controller().getDisplaySlotPlan()).toBeNull(); expect(h.controller().getAutomaticProvenance()).toBeNull();
	});
	it("offers Restore and Use automatic even when no further adverb alternative exists", async () => {
		const s = shared(); await s.store.load(); const h = s.view(); await h.open("ゆっくり歩く。"); await h.apply(["じっくり歩く。"]);
		const action = (label: string) => {
			const slot = h.current("ゆっくり");
			const element = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(el => h.controller().getSlotForElement(el) === slot)!;
			element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			const menu = h.peek.contentEl.querySelector<HTMLElement>('[aria-label="Word actions"]')!;
			expect(menu.contains(document.activeElement)).toBe(true);
			const button = Array.from(menu.querySelectorAll("button")).find(button => button.textContent === label)!;
			expect(button.disabled).toBe(false); button.click();
		};
		action("Shuffle this word"); expect(h.current("ゆっくり").displaySurface).toBe("じっくり");
		action("Restore original"); expect(h.current("ゆっくり").displaySurface).toBe("ゆっくり");
		action("Use automatic result"); expect(h.current("ゆっくり").manualOverride).toBeNull();
		expect(h.controller().getAutomaticOptions()).toEqual(NOUN);
		expect(await h.view.applyAutomaticPos(ALL)).toBe("committed"); const current = h.current("ゆっくり");
		expect(current.manualAvailable).toBe(false); expect(current.manualEligible).toBe(true);
		expect(h.controller().restoreManual(current)).toBe("applied"); expect(h.current("ゆっくり").displaySurface).toBe("ゆっくり");
		expect(h.controller().useAutomatic(h.current("ゆっくり"))).toBe("applied"); expect(h.current("ゆっくり").displaySurface).toBe("じっくり");
		const origin = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(el => h.controller().getSlotForElement(el) === h.current("ゆっくり"))!;
		expect(h.controller().focusSlotElement(origin.cloneNode(true) as HTMLElement)).toBe(false);
		expect(h.controller().focusSlotElement(origin)).toBe(true); expect(document.activeElement).toBe(origin);
		// EXPERIENCE-TOKEN-UI1: the owned tabindex stays while the word holds focus (a browser would
		// otherwise move focus to the body), and goes with the first blur, leaving the display intact.
		expect(origin.getAttribute("tabindex")).toBe("-1"); expect(h.controller().isDisplayIntact()).toBe(true);
		h.peek.contentEl.querySelector<HTMLButtonElement>('[aria-label="Automatic parts of speech"]')!.focus();
		expect(origin.hasAttribute("tabindex")).toBe(false); expect(h.controller().isDisplayIntact()).toBe(true);
		origin.addEventListener("focus", () => { h.root().setAttribute("data-outside", "1"); }, { once: true });
		expect(h.controller().focusSlotElement(origin)).toBe(false); expect(h.controller().isDisplayIntact()).toBe(false);
		await h.view.onClose();
	});
	it.each(["uniform", "frequency"] as const)("all 16 options preserve independent surfaces and legacy noun Ruby: %s", async mode => {
		// MAX-VIEW1: level L <= 50 is Body 10's noun transform at 2L (level 50 = Body 10 at 100); above 50 the
		// profiles relax, so the legacy oracle applies to the strict half only. Option isolation is checked at every level.
		for (const selected of [false, true]) for (const level of [0, 25, 43, 50, 100]) {
			const s = shared(); await s.store.load(); const h = s.view(); h.state.level = assertBodySemantropy(level);
			await h.open("猫《ねこ》ゆっくり歩く。犬じっくり書く。美しい。楽しい。\n".repeat(3));
			if (selected) expect(await h.apply([text, "鳥《とり》すぐ描く。高い。"], mode)).toBe("applied");
			else { h.view.setVocabularyDraft({ mode: "current", paths: [], drawMode: mode }); expect(await h.view.applyVocabulary()).toBe("applied"); }
			const calls = h.calls.tokenizations.length, before = h.plan();
			if (level <= 50) {
				const legacy = transformWithVocabularySnapshot({ tokenSequences: before.runs.map(run => run.slots.map(slot => ({ tokenId: slot.tokenId, token: slot.originalToken }))),
					snapshot: h.controller().getVocabularySnapshot()!, bodySeed: 7, bodySemantropy: assertBodySemantropy(level * 2), algorithmVersion: 1 });
				expect(h.controller().getAutomaticProvenance()!.selections.map(run => run.map(selection => selection && { candidate: selection.candidate, rubyVariant: selection.rubyVariant })))
					.toEqual(legacy.selections);
				expect(h.plan().slots.map(slot => slot.displaySurface)).toEqual(legacy.tokenSurfaces.flat());
			}
			expect(await h.view.applyAutomaticPos(ALL)).toBe("committed");
			const all = h.plan().slots;
			for (let bits = 0; bits < 16; bits++) {
				const options = { noun: !!(bits & 1), verb: !!(bits & 2), iAdjective: !!(bits & 4), adverb: !!(bits & 8) };
				expect(await h.view.applyAutomaticPos(options)).toBe("committed");
				for (const [i, slot] of h.plan().slots.entries()) {
					const part = ({ "名詞": "noun", "動詞": "verb", "形容詞": "iAdjective", "副詞": "adverb" } as const)[slot.originalToken.pos as "名詞"];
					expect(slot.displaySurface).toBe(part && options[part] ? all[i]!.displaySurface : slot.originalToken.surface);
				}
				if (!bits) expect(h.plan().replacementCount).toBe(0);
			}
			expect(h.calls.tokenizations).toHaveLength(calls); expect(h.calls.collect).toEqual([]); expect(h.calls.copy).toEqual([]);
			expect(h.root().childNodes).toHaveLength(1); await h.view.onClose();
		}
	});
	it.each(["prepare", "save-before", "save-after"])("retains old generation on %s failure", async phase => {
		const s = shared(); await s.store.load(); const h = s.view(); await h.open(text); const plan = h.plan(), node = h.root().firstChild;
		if (phase === "prepare") vi.spyOn(rendering, "buildTargetDisplay").mockRejectedValueOnce(Error("private"));
		else { const write = s.save.getMockImplementation()!; s.save.mockImplementationOnce(async value => { if (phase === "save-after") await write(value); throw Error("private"); }); }
		expect(await h.view.applyAutomaticPos(ALL)).toBe("failed"); expect(h.plan()).toBe(plan); expect(h.root().firstChild).toBe(node);
		expect(s.store.getSettings().automaticPos).toEqual(NOUN); expect(h.controller().isAutomaticCurrent()).toBe(true);
		expect(s.save).toHaveBeenCalledTimes(phase === "prepare" ? 0 : 2); await h.view.onClose();
	});
	it.each([true, false])("keeps selection, scroll and Toolbar focus through different-length surfaces (native=%s)", async native => {
		const s = shared(); await s.store.load(); const h = s.view(); await h.open(text); await h.apply(["すぐ歩く。犬。楽しい。"]);
		const slot = h.current("ゆっくり"), element = Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(el => h.controller().getSlotForElement(el) === slot)!;
		const node = element.firstChild!, selection = document.getSelection()!;
		selection.setBaseAndExtent(node, node.textContent!.length, node, 0); document.dispatchEvent(new Event("selectionchange"));
		const focus = h.peek.contentEl.querySelector<HTMLButtonElement>('[aria-label="Automatic parts of speech"]')!;
		focus.focus(); if (native) selection.setBaseAndExtent(node, node.textContent!.length, node, 0); const scroll = h.peek.contentEl.querySelector<HTMLElement>(".semantropy-scroll")!; scroll.scrollTop = 103;
		expect(await h.view.applyAutomaticPos(ALL)).toBe("committed");
		expect(document.activeElement).toBe(focus); expect(scroll.scrollTop).toBe(103);
		if (native) { expect(h.controller().readSelectedSlot(selection)?.tokenId).toBe(slot.tokenId);
			expect(selection.anchorOffset).toBeGreaterThan(selection.focusOffset); }
		expect(await h.view.collectSelectedFragment()).toBe("created");
		expect(h.calls.collect.at(-1)).toMatchObject({ metadataVersion: 4, automaticPartsOfSpeech: ["noun", "verb", "i-adjective", "adverb"], algorithmVersion: 11 });
		await h.view.onClose();
	});
	it("loads only the next Chunk with current options without calling the tokenizer", async () => {
		const s = shared(); await s.store.load(); const h = s.view(); await h.open((text + "\n").repeat(5));
		expect(await h.view.applyAutomaticPos(OFF)).toBe("committed"); const node = h.root().firstChild, count = h.calls.tokenizations.length;
		h.state.failTokens = true; expect(await h.view.loadNextSection()).toBe("applied");
		expect(h.root().firstChild).toBe(node); expect(h.root().childNodes).toHaveLength(2); expect(h.calls.tokenizations).toHaveLength(count);
		expect(h.plan().slots.every(slot => slot.displaySurface === slot.originalToken.surface)).toBe(true); await h.view.onClose();
	});
	it("commits all Views, retains Manual overrides and never retokenizes on Apply", async () => {
		const s = shared(); await s.store.load(); const a = s.view(), b = s.view(); await a.open(text); await b.open(text);
		const calls = a.calls.tokenizations.length;
		expect(a.controller().shuffleManual(a.current("ゆっくり"))).toBe("applied");
		const manual = a.current("ゆっくり").manualOverride;
		expect(await a.view.applyAutomaticPos(ALL)).toBe("committed");
		for (const h of [a, b]) {
			expect(h.controller().getAutomaticOptions()).toEqual(ALL); expect(h.controller().isAutomaticCurrent()).toBe(true);
			const visible = h.root().cloneNode(true) as HTMLElement; visible.querySelectorAll("rt,rp").forEach(node => node.remove());
			expect(visible.textContent).toBe(h.plan().slots.map(slot => slot.displaySurface).join(""));
		}
		expect(a.current("ゆっくり").manualOverride).toBe(manual);
		expect(a.calls.tokenizations).toHaveLength(calls); expect(s.store.getSettings().automaticPos).toEqual(ALL);
		expect(await a.view.applyAutomaticPos(OFF)).toBe("committed");
		expect(a.controller().useAutomatic(a.current("ゆっくり"))).toBe("applied");
		expect(a.current("ゆっくり").displaySurface).toBe("ゆっくり");
		await a.view.onClose(); await b.view.onClose();
	});
	it.each(["before", "during", "after"])("rolls back all Views and disk on %s DOM failure", async phase => {
		const s = shared(); await s.store.load(); const a = s.view(), b = s.view(); await a.open(text); await b.open(text);
		expect(a.controller().shuffleManual(a.current("ゆっくり"))).toBe("applied");
		const manual = a.current("ゆっくり").manualOverride;
		const focus = a.peek.contentEl.querySelector<HTMLButtonElement>('[aria-label="Automatic parts of speech"]')!; focus.focus();
		const selected = Array.from(a.root().querySelectorAll<HTMLElement>(".semantropy-token")).find(el => a.controller().getSlotForElement(el) === a.current("ゆっくり"))!.firstChild!;
		const selection = document.getSelection()!; selection.setBaseAndExtent(selected, selected.textContent!.length, selected, 0);
		document.dispatchEvent(new Event("selectionchange"));
		const scrolls = [a, b].map(h => h.peek.contentEl.querySelector<HTMLElement>(".semantropy-scroll")!);
		scrolls.forEach((el, i) => { el.scrollTop = 73 + i; });
		const roots = [a.root(), b.root()], nodes = roots.map(root => Array.from(root.childNodes)), plans = [a.plan(), b.plan()];
		const original = b.root().replaceChildren.bind(b.root());
		vi.spyOn(b.root(), "replaceChildren").mockImplementation((...next) => {
			if (phase === "during") original(next[0]!); else if (phase === "after") original(...next);
			throw Error("private publication failure");
		});
		expect(await a.view.applyAutomaticPos(ALL)).toBe("failed");
		for (const [i, h] of [a, b].entries()) { expect(Array.from(h.root().childNodes)).toEqual(nodes[i]); expect(h.plan()).toBe(plans[i]); expect(h.controller().isAutomaticCurrent()).toBe(true); }
		expect(a.current("ゆっくり").manualOverride).toBe(manual); expect(document.activeElement).toBe(focus);
		expect(selection.anchorNode).toBe(selected); expect(selection.anchorOffset).toBe(selected.textContent!.length);
		expect(selection.focusNode).toBe(selected); expect(selection.focusOffset).toBe(0);
		expect(scrolls.map(el => el.scrollTop)).toEqual([73, 74]);
		expect(s.disk()).toMatchObject({ automaticPos: NOUN }); expect(s.store.getSettings().automaticPos).toEqual(NOUN);
		expect(s.save).toHaveBeenCalledTimes(2); await a.view.onClose(); await b.view.onClose();
	});
	it.each(["cancel", "close", "disable", "source"])("compensates a delayed save after %s", async event => {
		const s = shared(); await s.store.load(); const a = s.view(); await a.open(text);
		const pending = deferred<void>(), reached = deferred<void>();
		s.save.mockImplementationOnce(async () => { reached.resolve(); await pending.promise; });
		const result = a.view.applyAutomaticPos(ALL); await reached.promise;
		if (event === "cancel") a.view.cancelAutomaticPos();
		else if (event === "close") await a.view.onClose();
		else if (event === "disable") a.view.disableAutomatic();
		else a.view.notifyVocabularySourceEvent("target.md");
		pending.resolve(); expect(await result).not.toBe("committed");
		expect(s.store.getSettings().automaticPos).toEqual(NOUN); expect(s.disk()).toMatchObject({ automaticPos: NOUN });
		await a.view.onClose();
	});
});
