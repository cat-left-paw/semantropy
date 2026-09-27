// @vitest-environment jsdom
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { buildTokenize, compactDictionaryDir, initLindera, type Tokenize } from "./linderaFixture";
import { installObsidianDomHelpers } from "../support/obsidianDom";
import { manualMorphHarness } from "../support/manualMorphHarness";
import { AutomaticPosSettingsStore } from "../../src/settings/AutomaticPosSettingsStore";
import { AutomaticPosCoordinator } from "../../src/application/AutomaticPosCoordinator";
import { assertBodySemantropy } from "../../src/settings/bodySemantropy";
import { ALL } from "../automaticPosFixtures";
let tokenize: Tokenize, restore: () => void;
beforeAll(async () => { await initLindera(); tokenize = buildTokenize(compactDictionaryDir()); restore = installObsidianDomHelpers(); });
afterAll(() => restore()); afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
it.each([
	["書いて。", "描いて。", "描いて。"], ["暑い。", "美しい。", "美しい。"],
	["ゆっくりと歩く。", "じっくり歩く。", "じっくりと歩く。"],
	["ゆっくりと歩く。", "すぐ歩く。", "ゆっくりと歩く。"],
	["ゆっくりと歩く。", "そっと歩く。", "ゆっくりと歩く。"],
	["ゆっくり歩く。", "じっくり歩かない。", "ゆっくり歩く。"],
	["もちろん、彼は来る。", "決して、彼は来ない。", "決して、彼は来る。"],
] as const)("real View uses the reviewed strict core at Medium (level 50 = Body 10 at 100): %s / %s", async (target, source, expected) => {
	const store = new AutomaticPosSettingsStore({ load: async () => ({}), save: async () => undefined });
	const coordinator = new AutomaticPosCoordinator(store), h = manualMorphHarness({ tokenize: async text => tokenize(text) });
	h.state.level = assertBodySemantropy(50); h.host.automaticPosCoordinator = coordinator; h.host.getAutomaticPos = () => store.getSettings().automaticPos;
	await h.open(target); expect(await h.apply([source])).toBe("applied"); const calls = h.calls.tokenizations.length;
	expect(await h.view.applyAutomaticPos({ ...ALL, noun: false })).toBe("committed");
	expect(h.controller().getLogicalText()).toBe(expected); expect(h.calls.tokenizations).toHaveLength(calls);
	expect(await h.view.collectSelectedFragment({ selection: (() => { const range = document.createRange(); range.selectNodeContents(h.root()); return { rangeCount: 1, getRangeAt: () => range }; })() })).toBe("created");
	expect(h.calls.collect.at(-1)).toMatchObject({ metadataVersion: 4, automaticPartsOfSpeech: ["verb", "i-adjective", "adverb"] });
	await h.view.onClose(); coordinator.dispose();
});
it.each([
	// MAX-VIEW1 at MAX (100), real tokenizer: relaxed profiles and the closed realizer, never an excluded lexeme.
	["ゆっくりと歩く。", "すぐ歩く。", "すぐと歩く。"],
	["ゆっくりと歩く。", "そっと歩く。", "ゆっくりと歩く。"],
	["書いて。", "食べる。", "食べて。"],
	["走った。", "あった。", "走った。"],
	["暑い。", "美しい。", "美しい。"],
] as const)("real View uses MAX-CORE1 at MAX: %s / %s", async (target, source, expected) => {
	const store = new AutomaticPosSettingsStore({ load: async () => ({}), save: async () => undefined });
	const coordinator = new AutomaticPosCoordinator(store), h = manualMorphHarness({ tokenize: async text => tokenize(text) });
	h.state.level = assertBodySemantropy(100); h.host.automaticPosCoordinator = coordinator; h.host.getAutomaticPos = () => store.getSettings().automaticPos;
	await h.open(target); expect(await h.apply([source])).toBe("applied"); const calls = h.calls.tokenizations.length;
	expect(await h.view.applyAutomaticPos({ ...ALL, noun: false })).toBe("committed");
	expect(h.controller().getLogicalText()).toBe(expected); expect(h.calls.tokenizations).toHaveLength(calls);
	expect(h.controller().getAutomaticProvenance()).toMatchObject({ bodyAlgorithmVersion: 11, bodySemantropy: 100 });
	await h.view.onClose(); coordinator.dispose();
});
