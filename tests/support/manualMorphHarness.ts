import type { WorkspaceLeaf } from "obsidian";
import { SemantropyView, type SemantropyViewHost } from "../../src/view/SemantropyView";
import { ChunkTargetBodyController } from "../../src/render/chunkTargetBodyController";
import type { SemantropySession } from "../../src/application/SemantropySession";
import type { JapaneseToken, JapaneseTokenizer } from "../../src/tokenizer/JapaneseTokenizer";
import { assertBodySemantropy } from "../../src/settings/bodySemantropy";
import { assertDictionarySemantropy } from "../../src/settings/dictionarySemantropy";
import { immediateScheduler } from "./testScheduler";
import { token } from "../tokenFixtures";
import { sha256Hex } from "../../src/vocabulary/sha256";

export const morphToken = (surface: string, type = "五段・カ行イ音便", form = "連用タ接続", pos = "動詞") => token({ surface, pos, detail1: "自立", conjugationType: type, conjugationForm: form, baseForm: surface, reading: undefined });
export const suffix = (surface: string, pos = "助詞", detail1 = "接続助詞") => token({ surface, pos, detail1 });
export const period = suffix("。", "記号", "句点");
export function lexiconTokenizer(lexicon: readonly JapaneseToken[]): JapaneseTokenizer {
	const sorted = [...lexicon, period].sort((a, b) => b.surface.length - a.surface.length);
	return { tokenize: async text => {
		const tokens: JapaneseToken[] = [];
		for (let i = 0; i < text.length;) {
			const found = sorted.find(t => text.startsWith(t.surface, i));
			const next = found ? { ...found } : token({ surface: String.fromCodePoint(text.codePointAt(i)!), isUnknown: true, pos: "記号" });
			tokens.push(next); i += next.surface.length;
		}
		return tokens;
	} };
}
export type MorphPeek = { contentEl: HTMLElement; targetBody: ChunkTargetBodyController; session: SemantropySession };
export const peekMorph = (view: SemantropyView) => view as unknown as MorphPeek;
export function manualMorphHarness(tokenizer: JapaneseTokenizer, size = 5000) {
	const state = { text: "", level: assertBodySemantropy(0), dictionary: assertDictionarySemantropy(50), failTokens: false };
	const calls = { tokenizations: [] as string[], reads: [] as string[], copy: [] as string[], collect: [] as Parameters<SemantropyViewHost["collectFragment"]>[0][] };
	const notes = new Map<string, string>();
	const host: SemantropyViewHost = {
		targetChunkSize: size, getTokenizer: () => ({ tokenize: async text => { calls.tokenizations.push(text); if (state.failTokens) throw Error("private"); return tokenizer.tokenize(text); } }),
		readCurrentText: async path => { calls.reads.push(path); if (path === "target.md") return state.text; const value = notes.get(path); if (value === undefined) throw Error("private"); return value; },
		getBodySemantropy: () => state.level, setBodySemantropy: async value => { state.level = value; return true; },
		getDictionarySemantropy: () => state.dictionary, setDictionarySemantropy: async value => { state.dictionary = value; return true; },
		writeClipboard: async text => { calls.copy.push(text); }, collectFragment: async input => { calls.collect.push(input); return { status: "created" }; }, showNotice: () => undefined,
		scheduler: immediateScheduler(),
	};
	const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
	const peek = peekMorph(view); peek.contentEl = document.createElement("div"); document.body.appendChild(peek.contentEl);
	const controller = () => peek.targetBody;
	const plan = () => controller().getDisplaySlotPlan()!;
	const current = (surface: string) => plan().slots.find(slot => slot.originalToken.surface === surface)!;
	const root = () => controller().getContainer()!;
	const open = async (text: string) => {
		state.text = text; await view.onOpen();
		await view.openCapture({ kind: "markdown", note: { sourcePath: "target.md", sourceName: "target", editorText: text } }, { readCached: async () => text, hashText: async text => sha256Hex(text), issueSeed: () => 7 });
	};
	const apply = async (texts: string[], mode: "uniform" | "frequency" = "uniform") => {
		texts.forEach((text, i) => notes.set(`source${i}.md`, text));
		view.setVocabularyDraft({ mode: "selected", paths: texts.map((_, i) => `source${i}.md`), drawMode: mode });
		return view.applyVocabulary();
	};
	return { view, peek, host, state, calls, notes, controller, plan, current, root, open, apply };
}
