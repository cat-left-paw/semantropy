// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import * as morph from "../../src/transform/manualMorphology";
import { adjectiveBaseline, adjectiveTargets } from "../support/manualAdjectiveBaseline";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";
import { installObsidianDomHelpers } from "../support/obsidianDom";
import { manualMorphHarness } from "../support/manualMorphHarness";
import { transformWithVocabularySnapshot } from "../../src/vocabulary/vocabularySnapshot";
import { assertBodySemantropy } from "../../src/settings/bodySemantropy";

let tokenize: Tokenize, restore: () => void;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
async function prepare(core: typeof morph, text: string) {
	const result = await core.analyzeManualMorphSource({ text, sourcePath: "source.md", tokenizer: { tokenize: async text => tokenize(text) } });
	if (result.status !== "ready") throw Error(result.status);
	return core.buildManualMorphVocabulary({ sources: [result.analysis], drawMode: "uniform" });
}
function evaluate(core: typeof morph, text: string, active: morph.ManualMorphVocabulary) {
	const tokens = tokenize(text), target = tokens[0]!;
	return core.evaluateManualMorphSlot({ target, next: tokens[1] ?? null, currentSurface: target.surface, ...active });
}

it.each(adjectiveTargets)("real basic Target has no follower requirement: %s", async text => {
	const tokens = tokenize(text);
	expect(tokens.map(t => t.surface).join("")).toBe(text);
	const tails: Record<string, string[]> = { "とは": ["と", "は"], "のか": ["の", "か"], "のも": ["の", "も"], "と思う": ["と", "思う"] };
	const tail = text.slice("暑い".length);
	expect(tokens.map(t => t.surface)).toEqual(["暑い", ...(tails[tail] ?? (tail ? [tail] : []))]);
	expect(tokens[0]).toMatchObject({ surface: "暑い", pos: "形容詞", detail1: "自立", conjugationType: "形容詞・アウオ段", conjugationForm: "基本形", isUnknown: false });
	const active = await prepare(morph, "高い山。美しい景色。赤い");
	const result = evaluate(morph, text, active);
	expect(result).toMatchObject({ available: true, compatibility: { policyVersion: "manual-morph-2", slotClass: "i-adjective", conjugationForm: "基本形", compatibilityFamily: "regular-i-adjective", targetConnection: null, candidateObservation: "same-form" } });
	expect(result.candidates.map(c => c.surface).sort()).toEqual(["美しい", "赤い", "高い"].sort());
});

it.each([
	["暑いのに", "高い山", "暑い", "高い", "基本形"],
	["暑いかも", "美しい景色", "暑い", "美しい", "基本形"],
	["美しいの", "高い", "美しい", "高い", "基本形"],
	["暑くて", "高くない", "暑く", "高く", "連用テ接続"],
	["暑くて", "美しくない", "暑く", "美しく", "連用テ接続"],
	["暑かった", "美しかった", "暑かっ", "美しかっ", "連用タ接続"],
	["暑ければ", "美しければ", "暑けれ", "美しけれ", "仮定形"],
])("production Shuffle / Restore / automatic: %s from %s", async (target, source, from, to, form) => {
	expect(tokenize(target)[0]).toMatchObject({ surface: from, pos: "形容詞", detail1: "自立", conjugationForm: form });
	expect(tokenize(source)[0]).toMatchObject({ surface: to, pos: "形容詞", detail1: "自立", conjugationForm: form });
	const h = manualMorphHarness({ tokenize: async text => tokenize(text) }); await h.open(target); expect(await h.apply([source])).toBe("applied");
	expect(h.current(from).manualAvailable).toBe(true);
	expect(h.controller().shuffleManual(h.current(from))).toBe("applied"); expect(h.controller().getLogicalText()).toBe(target.replace(from, to));
	expect(h.current(from).displayRuby).toBeNull();
	expect(h.controller().restoreManual(h.current(from))).toBe("applied"); expect(h.controller().getLogicalText()).toBe(target);
	expect(h.controller().useAutomatic(h.current(from))).toBe("applied"); expect(h.controller().getLogicalText()).toBe(target);
	expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]); await h.view.onClose();
});

it("compares every real verb occurrence and rejection against the reviewed baseline", async () => {
	const { source, verbs } = adjectiveBaseline;
	const after = await prepare(morph, source), tokens = tokenize(source);
	let compared = 0, available = 0;
	const rejected: Record<string, number> = {};
	for (const [index, target] of tokens.entries()) if (target.pos === "動詞") {
		const input = { target, next: tokens[index + 1] ?? null, currentSurface: target.surface };
		const a = verbs[compared]!, b = morph.evaluateManualMorphSlot({ ...input, ...after });
		expect(JSON.stringify([index, target, input.next])).toBe(JSON.stringify([a.index, a.target, a.next]));
		expect(b.available).toBe(a.available); expect(b.candidates).toEqual(a.candidates);
		if (!a.available && !b.available) { expect(b.reason).toBe(a.reason); rejected[a.reason] = (rejected[a.reason] ?? 0) + 1; }
		if (a.available) available++;
		compared++;
	}
	expect(compared).toBe(verbs.length); expect(compared).toBe(30);
	process.stdout.write(`\n[COVERAGE1 verb baseline equality] ${JSON.stringify({ compared, available, rejected })}\n`);
	expect(evaluate(morph, "分からない", await prepare(morph, "あらず"))).toMatchObject({ available: false, reason: "no-candidate", candidates: [] });
});

it("records before/after Target acceptance and Source-context-independent record identities", async () => {
	const after = await prepare(morph, adjectiveBaseline.adjectiveSource);
	const rows = adjectiveBaseline.targets.map(({ text, tokens: expectedTokens, targetSupported, result }) => {
		const tokens = tokenize(text);
		expect(JSON.stringify(tokens)).toBe(JSON.stringify(expectedTokens));
		return { text, split: tokens.map(t => t.surface), targetBefore: targetSupported, before: result.candidates.length, after: evaluate(morph, text, after).candidates.length };
	});
	expect(rows.every(row => row.after === 3)).toBe(true);
	expect(rows.filter(row => row.before > 0)).toHaveLength(0);
	const a = evaluate(morph, "暑いか", await prepare(morph, "高い山")), b = evaluate(morph, "暑いか", await prepare(morph, "高いね"));
	expect(a.candidates.map(c => [c.candidateId, c.displayFormId, c.surface])).toEqual(b.candidates.map(c => [c.candidateId, c.displayFormId, c.surface]));
	process.stdout.write(`\n[COVERAGE1 Target counts] ${JSON.stringify(rows)}\n`);
});

it("retains nonbasic Target connection rejection even with observed compatible forms", async () => {
	const active = await prepare(morph, "高くない。美しかった。高ければ。");
	for (const text of ["暑く。", "暑かっ", "暑けれ"]) expect(evaluate(morph, text, active)).toMatchObject({ available: false, reason: "unsupported-connection" });
	expect(evaluate(morph, "暑い", active)).toMatchObject({ available: false, reason: "no-candidate" });
});

it("keeps Snapshot candidate order, noun surfaces/counts/draws/Ruby identical to baseline", async () => {
	const after = await prepare(morph, adjectiveBaseline.nounSource);
	expect(JSON.stringify(after.snapshot)).toBe(JSON.stringify(adjectiveBaseline.snapshot));
	const tokenSequences = [tokenize(adjectiveBaseline.nounTarget).map((token, i) => ({ tokenId: `token:${i}`, token }))];
	for (const { bodySeed, level, result } of adjectiveBaseline.draws) {
		const input = { tokenSequences, bodySeed, bodySemantropy: assertBodySemantropy(level), algorithmVersion: 1 as const };
		expect(JSON.stringify(transformWithVocabularySnapshot({ ...input, snapshot: after.snapshot }))).toBe(JSON.stringify(result));
	}
});

it.each(["uniform", "frequency"] as const)("%s only draws indexed same-form family records across multiple Sources", async mode => {
	const h = manualMorphHarness({ tokenize: async text => tokenize(text) }); await h.open("暑いかも");
	expect(await h.apply(["高い山。".repeat(12) + "高くない。", "美しい景色。赤い。いい。静かな。"], mode)).toBe("applied");
	const calls = h.calls.tokenizations.length, reads = h.calls.reads.length, seen = new Set<string>();
	for (let i = 0; i < 30; i++) {
		const slot = h.current("暑い"); expect(h.controller().shuffleManual(slot)).toBe("applied");
		const next = h.current("暑い"); expect(next.displaySurface).not.toBe(slot.displaySurface);
		expect(["高い", "美しい", "赤い"]).toContain(next.displaySurface); seen.add(next.displaySurface);
	}
	expect(seen).toEqual(new Set(["高い", "美しい", "赤い"]));
	expect(h.calls.tokenizations).toHaveLength(calls); expect(h.calls.reads).toHaveLength(reads);
	await h.view.onClose();
});

it.each([["暑い", "美しい"], ["美しい", "暑い"]])("newly eligible adjacent adjective Ruby: %s then %s without Restore", async (first, second) => {
	const h = manualMorphHarness({ tokenize: async text => tokenize(text) }); await h.open("｜暑い美しい《まとめ》かも。鳥。");
	expect(await h.apply(["高い山。赤い。"])).toBe("applied");
	const check = () => {
		const clone = h.root().cloneNode(true) as HTMLElement; clone.querySelectorAll("rt,rp").forEach(node => node.remove());
		expect(clone.textContent).toBe(h.controller().getLogicalText());
		expect(h.plan().runs.map(run => run.slots.map(slot => slot.displaySurface).join("")).join("")).toBe(h.controller().getLogicalText());
	};
	for (const word of [first, second]) { expect(h.controller().shuffleManual(h.current(word))).toBe("applied"); check(); }
	const shape = () => {
		const nodes = Array.from(h.root().querySelectorAll("*"));
		return [nodes.length, Math.max(...nodes.map(node => { let depth = 0; for (let p = node.parentElement; p && p !== h.root(); p = p.parentElement) depth++; return depth; }))];
	};
	const stable = shape();
	for (let i = 0; i < 30; i++) { expect(h.controller().shuffleManual(h.current(i % 2 ? first : second))).toBe("applied"); check(); expect(shape()).toEqual(stable); }
	expect(h.root().querySelector("rt")).toBeNull();
	const range = document.createRange(); range.selectNodeContents(h.root()); const selection = { rangeCount: 1, getRangeAt: () => range };
	expect(await h.view.copySelectedFragment({ selection })).toBe("copied");
	expect(await h.view.collectSelectedFragment({ selection })).toBe("created");
	expect(h.calls.copy.at(-1)).toBe(h.controller().getLogicalText());
	expect(h.calls.collect.at(-1)).toMatchObject({ text: h.controller().getLogicalText(), algorithmVersion: 11 });
	expect(h.controller().restoreManual(h.current(first))).toBe("applied"); check();
	expect(h.controller().useAutomatic(h.current(second))).toBe("applied"); check();
	expect(h.controller().clearManual()).toBe("applied"); check();
	expect(h.controller().getLogicalText()).toBe("暑い美しいかも。鳥。"); expect(h.root().querySelector("rt")?.textContent).toBe("まとめ");
	await h.view.onClose();
});
