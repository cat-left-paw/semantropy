import type { WorkspaceLeaf } from "obsidian";
import { SemantropyView, type SemantropyViewHost } from "../src/view/SemantropyView";
import type { SemantropySession } from "../src/application/SemantropySession";
import { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import { immediateScheduler } from "./support/testScheduler";
import { token } from "./tokenFixtures";
import { OFF } from "./readyAnalysis";
import type { BodySemantropy } from "../src/settings/bodySemantropy";
import { DEFAULT_DICTIONARY_SEMANTROPY } from "../src/settings/dictionarySemantropy";
const tokenize = (text: string) => Array.from(text, surface => token({ surface,
	...(/[\p{Script=Han}]/u.test(surface) ? {} : { pos: "記号", isUnknown: true }) }));
type Peek = { targetBody: ChunkTargetBodyController; session: SemantropySession; contentEl: HTMLElement };
export const peek = (v: SemantropyView) => v as unknown as Peek;
export const body = (v: SemantropyView) => peek(v).targetBody;
export const text = (v: SemantropyView) => body(v).getTextNodes().map(t => t.data).join("");
export const ready = (v: SemantropyView) => { const s = peek(v).session.getState(); if (s.status !== "ready") throw Error("Not ready"); return s; };
export const selection = (root: Node) => { const range = document.createRange(); range.selectNodeContents(root); return { rangeCount: 1, getRangeAt: () => range }; };
export function harness(target = 30, level: BodySemantropy = OFF) {
	const control = { source: "", level, failTokens: false, failRead: false, failSave: false,
		readGate: null as Promise<void> | null, tokenGate: null as Promise<void> | null,
		scheduler: immediateScheduler() };
	const calls = { tokenize: [] as string[], copy: [] as string[], collect: [] as string[], save: [] as number[] };
	const host: SemantropyViewHost = {
		targetChunkSize: target, getTokenizer: () => ({ tokenize: async input => {
			calls.tokenize.push(input); await control.tokenGate;
			if (control.failTokens) throw Error("secret body /absolute/path"); return tokenize(input);
		} }),
		readCurrentText: async () => { await control.readGate; if (control.failRead) throw Error("private"); return control.source; },
		getBodySemantropy: () => control.level,
		setBodySemantropy: async value => { calls.save.push(value); if (control.failSave) return false; control.level = value; return true; },
		getDictionarySemantropy: () => DEFAULT_DICTIONARY_SEMANTROPY, setDictionarySemantropy: async () => false,
		writeClipboard: async t => { calls.copy.push(t); }, collectFragment: async i => { calls.collect.push(i.text); return { status: "created" }; }, showNotice: () => undefined,
		scheduler: { now: () => control.scheduler.now(), yieldTask: () => control.scheduler.yieldTask(), paint: () => control.scheduler.paint() },
	};
	const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
	peek(view).contentEl = document.createElement("div"); document.body.append(peek(view).contentEl);
	const open = async (md: string, seed = 7) => {
		control.source = md;
		await view.onOpen();
		await view.openCapture({ kind: "markdown", note: { sourcePath: "fixture.md", sourceName: "fixture.md", editorText: md } },
			{ readCached: async () => md, hashText: async () => "hash", issueSeed: () => seed });
	};
	return { view, control, calls, open };
}
