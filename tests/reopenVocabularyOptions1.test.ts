// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { sha256Hex } from "../src/vocabulary/sha256";
import { setCurrentUiLanguage } from "../src/i18n/language";
import type { VocabularySnapshot } from "../src/vocabulary/vocabularySnapshot";
import { defaultSemantropyDisplaySettings } from "../src/settings/displaySettings";
import type { TargetChoice } from "../src/view/SemantropyView";

/*
 * REOPEN-VOCABULARY-OPTIONS1: an Open into a View that already shows a note (`replaceOpen`) builds the note's
 * Vocabulary as the first Open does: with the stored draw mode and with the enclosed-term delimiters.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const LEXICON = [token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "又" }),
	token({ surface: "と", pos: "助詞", detail1: "並立助詞" }), token({ surface: "。", pos: "記号", detail1: "句点" })];
const PLAIN = "犬と猫。\n";
const TERMED = "犬と{{猫又}}。\n";

type Harness = ReturnType<typeof manualMorphHarness>;
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.view.onClose(); });

/** A View whose stored draw mode is Frequency, as after a Vocabulary Apply with Frequency in an earlier session. */
function harness(flags: { tabs?: boolean } = {}): Harness {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON));
	const stored = { ...defaultSemantropyDisplaySettings(), vocabularyDrawMode: "frequency" as const };
	h.host.getDisplaySettings = () => stored;
	if (flags.tabs) { h.host.workbenchTabs = true; h.host.deferInitialShuffle = true; }
	opened.push(h);
	return h;
}
const deps = (text: string) => ({ readCached: async () => text, hashText: async (value: string) => sha256Hex(value), issueSeed: () => 7 });
const markdown = (path: string, text: string) => ({ kind: "markdown", note: { sourcePath: path, sourceName: path, editorText: text } }) as const;
const snapshot = (h: Harness): VocabularySnapshot => h.view.getVocabularyState().snapshot!;
const surfaces = (h: Harness) => snapshot(h).projections.manual.candidates.map((record) => record.surface).sort();
const choice = (path: string, text: string): TargetChoice =>
	({ capture: markdown(path, text), readCached: async () => text, capturedSourceChanged: () => false });

describe("an Open into a View that already shows a note", () => {
	it("the first Open uses the stored draw mode and reads an enclosed term (the reference)", async () => {
		const h = harness();
		await h.open(TERMED);
		expect(snapshot(h).drawMode).toBe("frequency");
		expect(h.view.getVocabularyState().selection.drawMode).toBe("frequency");
		expect(surfaces(h)).toContain("猫又");
	});

	it("opening another note keeps the stored draw mode in the Snapshot the body is drawn from", async () => {
		const h = harness();
		await h.open(PLAIN);
		const first = h.controller();
		await h.view.openCapture(markdown("other.md", PLAIN), deps(PLAIN));
		// The reopen path replaces the body controller; the first-open path keeps it.
		expect(h.controller()).not.toBe(first);
		expect(h.peek.session.getState().status).toBe("ready");
		// What the status line says, and what the body was drawn with.
		expect(h.view.getVocabularyState().selection.drawMode).toBe("frequency");
		expect(snapshot(h).drawMode).toBe("frequency");
	});

	it("opening the same note again keeps the stored draw mode", async () => {
		const h = harness();
		await h.open(PLAIN);
		const first = h.controller();
		await h.view.openCapture(markdown("target.md", PLAIN), deps(PLAIN));
		expect(h.controller()).not.toBe(first);
		expect(snapshot(h).drawMode).toBe("frequency");
	});

	it("opening another note reads its enclosed term as one noun", async () => {
		const h = harness();
		await h.open(PLAIN);
		const first = h.controller();
		await h.view.openCapture(markdown("other.md", TERMED), deps(TERMED));
		expect(h.controller()).not.toBe(first);
		expect(surfaces(h)).toContain("猫又");
	});

	it("the reopened note has the Snapshot a first Open of it has", async () => {
		const reopened = harness();
		await reopened.open(PLAIN);
		await reopened.view.openCapture(markdown("target.md", TERMED), deps(TERMED));
		const plain = harness();
		await plain.open(TERMED);
		expect(snapshot(reopened).fingerprint).toBe(snapshot(plain).fingerprint);
		expect(snapshot(reopened)).toEqual(snapshot(plain));
	});

	it("Refresh target after the reopen builds the Vocabulary as a first Open does (what puts it right without a fix)", async () => {
		const h = harness();
		await h.open(PLAIN);
		h.state.text = TERMED;
		await h.view.openCapture(markdown("target.md", TERMED), deps(TERMED));
		expect(await h.view.refreshSource({ issueSeed: () => 8, hashText: async (value) => sha256Hex(value) })).toBe("refreshed");
		expect(snapshot(h).drawMode).toBe("frequency");
		expect(surfaces(h)).toContain("猫又");
	});

	it("shows the draw mode the reopened body was drawn with, when the stored mode changes while the note is analyzed", async () => {
		const h = harness();
		let mode: "uniform" | "frequency" = "frequency";
		h.host.getDisplaySettings = () => ({ ...defaultSemantropyDisplaySettings(), vocabularyDrawMode: mode });
		await h.open(PLAIN);
		const getTokenizer = h.host.getTokenizer;
		h.host.getTokenizer = () => {
			const tokenizer = getTokenizer();
			return { tokenize: async (text) => { mode = "uniform"; return await tokenizer.tokenize(text); } };
		};
		await h.view.openCapture(markdown("other.md", PLAIN), deps(PLAIN));
		expect(mode).toBe("uniform");
		// One selection serves both: the status line never names a mode the body was not drawn with.
		expect(snapshot(h).drawMode).toBe("frequency");
		expect(h.view.getVocabularyState().selection.drawMode).toBe("frequency");
	});

	it("is the note's own selection: Selected Notes and their weights do not follow into the reopened note", async () => {
		const h = harness();
		await h.open(PLAIN);
		h.notes.set("source0.md", "犬と猫。"); h.notes.set("source1.md", "猫と又。");
		h.view.setVocabularyDraft({ mode: "selected", paths: ["source0.md", "source1.md"], drawMode: "frequency", weights: { "source0.md": 2 } });
		expect(await h.view.applyVocabulary()).toBe("applied");
		expect(snapshot(h).sources.map((source) => source.path)).toEqual(["source0.md", "source1.md"]);
		await h.view.openCapture(markdown("other.md", TERMED), deps(TERMED));
		const state = h.view.getVocabularyState();
		expect([state.selection.mode, state.selection.drawMode]).toEqual(["current", "frequency"]);
		expect(snapshot(h).sources.map((source) => source.path)).toEqual(["other.md"]);
		expect(snapshot(h).sourceWeights ?? null).toBeNull();
		expect(snapshot(h).drawMode).toBe("frequency");
		expect(surfaces(h)).toContain("猫又");
	});

	it("the Choose target note button takes the same path and gives the same Snapshot", async () => {
		const h = harness({ tabs: true });
		await h.open(PLAIN);
		const first = h.controller();
		h.host.chooseTarget = async () => choice("notes/chosen.md", TERMED);
		expect(await h.view.chooseTarget()).toBe("opened");
		expect(h.controller()).not.toBe(first);
		expect(snapshot(h).drawMode).toBe("frequency");
		expect(surfaces(h)).toContain("猫又");
	});
});
