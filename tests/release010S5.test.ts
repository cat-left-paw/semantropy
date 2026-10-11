// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import {
	COLLECT_METADATA_VERSION_V4,
	COLLECT_METADATA_VERSION_V5,
	buildCollectedFragmentV4,
	captureFragmentMetadataV4,
	readCollectFragmentInputV4,
	type RecomposeFragmentInputV5,
} from "../src/collect/v4/CollectedFragmentV4";
import { RECOMPOSE_FRAGMENT_METADATA_KEY_ORDER_V5, serializeFragmentEntryV4 } from "../src/collect/v4/serializeFragmentV4";
import { collectAttributionSnapshot } from "../src/collect/v4/collectAttribution";
import { collectProtectedPaths } from "../src/collect/collectProvenance";
import { analyzeManualMorphSource, buildManualMorphVocabulary, readManualMorphSourceDocuments } from "../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../src/vocabulary/enclosedTerms";
import { recomposeCorpusFrom } from "../src/recompose/recompose";
import type { SemantropyViewHost } from "../src/view/SemantropyView";

/*
 * 0.1.0 S5 (Docs/release_0_1_0_policy.md decision 12): Recompose in Obsidian,
 * collected as Collect metadata 5.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => document.body.replaceChildren());

const IDENTITY = { id: "5b0f3c4e-8a3d-4a0e-9c1b-2f6d7e8a9b0c", created: "2026-10-01T00:00:00.000Z" };
const HASH = "a".repeat(64);
function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { metadataVersion: 5, type: "recompose", text: "猫が森を見た。\n\n犬が川を見た。", algorithmVersion: 1, method: "joint", leapMin: 50, leapMax: 50,
		vocabulary: { sources: [{ path: "a.md", contentHash: HASH }], fingerprint: `vocabulary-fingerprint-sha256-1:${"b".repeat(64)}`, drawMode: "uniform" },
		...overrides };
}

describe("0.1.0 S5 Collect metadata 5", () => {
	it("accepts a recompose entry as metadata 5 only, and leaves the other types at 4", () => {
		const read = readCollectFragmentInputV4(input());
		expect(read.ok).toBe(true);
		expect(Object.isFrozen(read.ok && read.value)).toBe(true);
		expect(readCollectFragmentInputV4(input({ metadataVersion: COLLECT_METADATA_VERSION_V4 }))).toEqual({ ok: false, reason: "invalid-metadata-version" });
		expect(COLLECT_METADATA_VERSION_V5).toBe(5);
		expect(readCollectFragmentInputV4({ metadataVersion: 5, type: "collision" })).toEqual({ ok: false, reason: "invalid-metadata-version" });
	});

	it("refuses a wrong method, leap, algorithm, text or an extra field", () => {
		const reason = (value: Record<string, unknown>) => { const read = readCollectFragmentInputV4(value); return read.ok ? null : read.reason; };
		expect(reason(input({ method: "markov" }))).toBe("invalid-recompose-method");
		for (const leapMin of [101, -1, 2.5, "50"]) expect(reason(input({ leapMin }))).toBe("invalid-recompose-leap");
		// The smallest leap may not exceed the largest; a mixed method is recorded as such; the old single leap is refused.
		expect(reason(input({ leapMin: 70, leapMax: 30 }))).toBe("invalid-recompose-leap");
		expect(reason(input({ method: "mixed", leapMin: 30, leapMax: 70 }))).toBeNull();
		expect(reason({ ...input(), leap: 50 })).toBe("invalid-fragment-fields");
		expect(reason(input({ algorithmVersion: 2 }))).toBe("invalid-algorithm-version");
		expect(reason(input({ text: "  " }))).toBe("empty-text");
		expect(reason({ ...input(), units: [] })).toBe("invalid-fragment-fields");
	});

	it("builds metadata in canonical order, writes the text literally, and protects its Sources", () => {
		const fragment = buildCollectedFragmentV4(input() as RecomposeFragmentInputV5, IDENTITY);
		expect(Object.keys(fragment.metadata)).toEqual([...RECOMPOSE_FRAGMENT_METADATA_KEY_ORDER_V5]);
		expect(captureFragmentMetadataV4(fragment.metadata)).toEqual(fragment.metadata);
		expect(collectProtectedPaths(fragment.metadata)).toEqual(["a.md"]);
		expect(serializeFragmentEntryV4(fragment)).toBe("- 猫が森を見た。\n\n  犬が川を見た。\n");
		const escaped = buildCollectedFragmentV4(input({ text: "**猫**が[森](x)を見た。" }) as RecomposeFragmentInputV5, IDENTITY);
		expect(serializeFragmentEntryV4(escaped)).not.toContain("**猫**");
		const attributed = serializeFragmentEntryV4(fragment, collectAttributionSnapshot({ feature: true, vocabulary: true, semantropy: true, target: true, uiLanguage: "ja" }));
		expect(attributed).toContain("生成機能: 再構成（継ぎ目、飛躍率 50）");
		const mixed = buildCollectedFragmentV4(input({ method: "mixed", leapMin: 30, leapMax: 70 }) as RecomposeFragmentInputV5, IDENTITY);
		expect(serializeFragmentEntryV4(mixed, collectAttributionSnapshot({ feature: true, uiLanguage: "ja" }))).toContain("生成機能: 再構成（混合、飛躍率 30〜70）");
		// English parentheses and commas are ASCII punctuation, escaped like every attribution value.
		expect(serializeFragmentEntryV4(mixed, collectAttributionSnapshot({ feature: true, uiLanguage: "en" })))
			.toMatch(/Generation feature: Recompose \\\(mixed\\?, leap 30–70\\\)/u);
		expect(attributed).toContain("語彙: a\\.md");
		expect(attributed).not.toContain("Semantropy");
	});
});

const LEXICON = [
	...["猫", "犬", "森", "川", "空", "猫又"].map((surface) => token({ surface })),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "と", pos: "助詞", detail1: "並立助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "た", pos: "助動詞", detail1: "*" }),
];

describe("0.1.0 S5 the corpus", () => {
	it("reads the Sources' analyzed documents and leaves enclosed-term marks out", async () => {
		const answer = await analyzeManualMorphSource({ text: "{{猫又}}が森を見た。", sourcePath: "v.md", tokenizer: lexiconTokenizer(LEXICON),
			mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
		if (answer.status !== "ready") throw new Error("fixture");
		const owner = buildManualMorphVocabulary({ sources: [answer.analysis], drawMode: "uniform" });
		const documents = readManualMorphSourceDocuments(owner)!;
		expect(documents.map((document) => document.source.path)).toEqual(["v.md"]);
		const corpus = recomposeCorpusFrom(documents.map((document) => ({ path: document.source.path, contentHash: document.source.contentHash,
			projection: document.projection, located: document.located })));
		expect(corpus.morphs.map((morph) => morph.surface).join("")).toBe("猫又が森を見た。");
		expect(readManualMorphSourceDocuments({ ...owner })).toBeNull();
	});
});

/*
 * The Recompose dialog these checks first ran against is gone (WORKBENCH-UI4): Recompose is the View's
 * Recompose tab. The dialog's five flow checks (generate / continue / branch / copy / collect, the keyboard and
 * stale or doubled steps, mixed methods and the leap range, no sentences, the chosen method and the end with
 * the View) were repeated on the pane in `tests/workbenchUi2Recompose.test.ts` in WORKBENCH-UI2 stage 3, and
 * run there on every commit since; this file keeps what is not about the screen: the Collect metadata 5
 * contract, the corpus, the tab's icon, and who is offered the entry. (WORKBENCH-UI5: the Toolbar's Recompose control
 * is gone too; the tab is the one entry.)
 */
describe("0.1.0 S5 the Recompose entry", () => {
	it("uses the wand-sparkles icon (owner decision), now on the tab", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		h.host.workbenchTabs = true;
		await h.open("猫。\n");
		expect(h.peek.contentEl.querySelector(".semantropy-tab-recompose .semantropy-icon svg")?.getAttribute("class")).toBe("svg-icon lucide-wand-sparkles");
		expect(h.peek.contentEl.querySelector(".semantropy-recompose-open")).toBeNull();
	});

	it("offers the entry only where there is a tab to show (the web page has its own panel)", async () => {
		const shown = manualMorphHarness(lexiconTokenizer(LEXICON));
		shown.host.workbenchTabs = true;
		await shown.open("猫。\n");
		expect(shown.peek.contentEl.querySelector(".semantropy-tab-recompose")).not.toBeNull();
		// A host without tabs has no Recompose at all: the dialog that used to stand in is gone.
		const plain = manualMorphHarness(lexiconTokenizer(LEXICON));
		await plain.open("猫。\n");
		expect(plain.peek.contentEl.querySelector(".semantropy-tab-recompose, .semantropy-recompose-open")).toBeNull();
		const hidden = manualMorphHarness(lexiconTokenizer(LEXICON));
		hidden.host.workbenchTabs = true;
		(Reflect.get(hidden.view, "host") as SemantropyViewHost).recomposeDialog = false;
		await hidden.open("猫。\n");
		expect(hidden.peek.contentEl.querySelector(".semantropy-tab-recompose, .semantropy-recompose-open")).toBeNull();
	});
});
