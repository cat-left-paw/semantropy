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
import type { RecomposeModal } from "../src/view/RecomposeModal";
import { TOOLBAR_CONTROLS } from "../src/view/SemantropyToolbar";
import { ui } from "../src/i18n/catalog";
import type { SemantropyView, SemantropyViewHost } from "../src/view/SemantropyView";

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
const SOURCE = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。";

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

const recompose = (view: SemantropyView) => Reflect.get(view, "recomposeModal") as RecomposeModal | null;
const button = (modal: RecomposeModal, name: string) =>
	Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === name)!;

describe("0.1.0 S5 the Recompose dialog", () => {
	it("generates, continues, branches, copies and collects from the active Vocabulary", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("猫と犬。\n");
		expect(await h.apply([SOURCE])).toBe("applied");
		h.peek.contentEl.querySelector<HTMLButtonElement>(".semantropy-recompose-open")!.click();
		const modal = recompose(h.view)!;
		expect(modal).toBeTruthy();
		expect(button(modal, "Continue").disabled).toBe(true);
		await modal.run("new");
		const units = () => Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".semantropy-recompose-unit"));
		expect(units().length).toBeGreaterThan(0);
		expect(modal.contentEl.querySelector(".semantropy-recompose-status")!.textContent).toBe("1 Source, 4 sentences.");
		await modal.run("more");
		expect(modal.contentEl.querySelectorAll(".semantropy-recompose-output p:not(.semantropy-recompose-hint)").length).toBe(2);
		expect(button(modal, "Branch from the chosen place").disabled).toBe(true);
		units()[0]!.click();
		expect(units()[0]!.classList.contains("is-branch")).toBe(true);
		expect(button(modal, "Branch from the chosen place").disabled).toBe(false);
		await modal.run("branch");
		expect(units()[0]!.classList.contains("is-branch")).toBe(false);
		const shown = Array.from(modal.contentEl.querySelectorAll(".semantropy-recompose-output p:not(.semantropy-recompose-hint)"), (p) => p.textContent).join("\n\n");
		await modal.copy();
		expect(h.calls.copy.at(-1)).toBe(shown);
		await modal.collect();
		const collected = h.calls.collect.at(-1)!;
		expect(collected).toMatchObject({ metadataVersion: 5, type: "recompose", text: shown, algorithmVersion: 1, method: "joint", leapMin: 50, leapMax: 50 });
		expect(readCollectFragmentInputV4(collected).ok).toBe(true);
		expect((collected as RecomposeFragmentInputV5).vocabulary.sources.map((source) => source.path)).toEqual(["source0.md"]);

		// Another Vocabulary: Continue and Branch wait for a new Generate; Collect keeps the provenance the text came from.
		expect(await h.apply(["犬が森を見た。"])).toBe("applied");
		modal.sync();
		expect(button(modal, "Continue").disabled).toBe(true);
		expect(modal.contentEl.querySelector(".semantropy-recompose-note")!.textContent).toContain("The Vocabulary changed");
		await modal.collect();
		expect((h.calls.collect.at(-1) as RecomposeFragmentInputV5).vocabulary.sources.map((source) => source.path)).toEqual(["source0.md"]);
		modal.close();
		expect(recompose(h.view)).toBeNull();
	});

	it("chooses the branch point from the keyboard, branches across paragraphs, and refuses stale or doubled steps (S5 review)", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("猫と犬。\n");
		await h.apply([SOURCE]);
		h.view.openRecompose();
		const modal = recompose(h.view)!;
		// A second step while one runs is ignored: one paragraph, not two.
		await Promise.all([modal.run("new"), modal.run("new")]);
		const paragraphs = () => Array.from(modal.contentEl.querySelectorAll(".semantropy-recompose-output p:not(.semantropy-recompose-hint)"), (p) => p.textContent);
		expect(paragraphs()).toHaveLength(1);
		await modal.run("more");
		const first = paragraphs()[0];
		const output = modal.contentEl.querySelector<HTMLElement>(".semantropy-recompose-output")!;
		expect(output.tabIndex).toBe(0);
		const units = () => Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".semantropy-recompose-unit"));
		const key = (name: string) => output.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
		key("ArrowRight");
		expect(units()[0]!.classList.contains("is-branch")).toBe(true);
		key("End");
		const last = units().length - 1;
		expect(units()[last]!.classList.contains("is-branch")).toBe(true);
		key("ArrowLeft");
		expect(units()[last - 1]!.classList.contains("is-branch")).toBe(true);
		// Branch from the last piece of the second paragraph: the first paragraph stays as it was.
		key("End");
		await modal.run("branch");
		expect(paragraphs()[0]).toBe(first);
		expect(paragraphs()).toHaveLength(2);

		// A Continue called directly after the Vocabulary changed generates nothing.
		const before = paragraphs();
		expect(await h.apply(["犬が森を見た。"])).toBe("applied");
		await modal.run("more");
		expect(paragraphs()).toEqual(before);
	});

	it("records mixed methods and the leap range of the pieces on screen (owner decision)", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("猫と犬。\n");
		await h.apply([SOURCE]);
		h.view.openRecompose();
		const modal = recompose(h.view)!;
		const [method, sentences] = Array.from(modal.contentEl.querySelectorAll<HTMLSelectElement>("select"));
		const leap = modal.contentEl.querySelector<HTMLInputElement>('input[type="range"]')!;
		const choose = (id: string, value: number) => {
			method!.value = id; method!.dispatchEvent(new Event("change"));
			leap.value = String(value); leap.dispatchEvent(new Event("input"));
		};
		sentences!.value = "1"; sentences!.dispatchEvent(new Event("change"));
		choose("joint", 50);
		await modal.run("new");
		choose("ngram", 80);
		await modal.run("more");
		await modal.collect();
		expect(h.calls.collect.at(-1)).toMatchObject({ method: "mixed", leapMin: 50, leapMax: 80 });
		// A branch that keeps only the first piece drops the n-gram step: one method and one leap again.
		choose("joint", 50);
		const output = modal.contentEl.querySelector<HTMLElement>(".semantropy-recompose-output")!;
		output.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
		await modal.run("branch");
		await modal.collect();
		expect(h.calls.collect.at(-1)).toMatchObject({ method: "joint", leapMin: 50, leapMax: 50 });
	});

	it("says so when the Vocabulary Sources have no sentence to recompose", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("猫と犬。\n");
		expect(await h.apply(["# 猫と犬\n"])).toBe("applied");
		h.view.openRecompose();
		const modal = recompose(h.view)!;
		await modal.run("new");
		expect(modal.contentEl.querySelector(".semantropy-recompose-status")!.textContent).toBe("The Vocabulary Sources have no sentences to recompose.");
		expect(modal.contentEl.querySelectorAll(".semantropy-recompose-unit")).toHaveLength(0);
	});

	it("uses the method the reader chose, and closes with the View", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("猫と犬。\n");
		await h.apply([SOURCE]);
		h.view.openRecompose();
		const modal = recompose(h.view)!;
		const method = modal.contentEl.querySelector<HTMLSelectElement>("select")!;
		expect(Array.from(method.options, (option) => option.value)).toEqual(["joint", "ngram"]);
		method.value = "ngram"; method.dispatchEvent(new Event("change"));
		await modal.run("new");
		await modal.collect();
		expect(h.calls.collect.at(-1)).toMatchObject({ method: "ngram" });
		await h.view.onClose();
		expect(recompose(h.view)).toBeNull();
	});

	it("uses the wand-sparkles icon and a plain title (owner decision)", async () => {
		expect(TOOLBAR_CONTROLS.recompose.icon).toBe("wand-sparkles");
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("猫。\n");
		expect(h.peek.contentEl.querySelector(".semantropy-recompose-open .semantropy-icon svg")?.getAttribute("class")).toBe("svg-icon lucide-wand-sparkles");
		expect(ui().recompose.title).toBe("Recompose");
	});

	it("offers the entry unless the host opts out (the web page has its own panel)", async () => {
		const shown = manualMorphHarness(lexiconTokenizer(LEXICON));
		await shown.open("猫。\n");
		expect(shown.peek.contentEl.querySelector(".semantropy-recompose-open")).not.toBeNull();
		const hidden = manualMorphHarness(lexiconTokenizer(LEXICON));
		(Reflect.get(hidden.view, "host") as SemantropyViewHost).recomposeDialog = false;
		await hidden.open("猫。\n");
		expect(hidden.peek.contentEl.querySelector(".semantropy-recompose-open")).toBeNull();
	});
});
