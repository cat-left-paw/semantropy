// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App, Plugin } from "obsidian";
import type { JapaneseToken, JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../src/transform/manualMorphology";
import {
	ENCLOSED_TERM_POLICY_VERSION,
	enclosedTermSyntax,
	enclosedTermTokenizer,
	extraEnclosedTermDelimiters,
	findEnclosedTerms,
	formatEnclosedTermDelimiterList,
	parseEnclosedTermDelimiterList,
	STANDARD_ENCLOSED_TERM_DELIMITER,
} from "../src/vocabulary/enclosedTerms";
// Vocabulary Sources and the Target are projected in target-prototype mode; the base policy is whatever that reports.
import { TARGET_PRESENTATION_POLICY_VERSION as BASE } from "../src/analysis/projectMarkdownSource";
import { parseAutomaticPosSettings, serializeAutomaticPosSettings, validateAutomaticPosSettingsPatch } from "../src/settings/automaticPosSettings";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { SemantropySettingTab } from "../src/view/SemantropySettingTab";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import type { VocabularySnapshot } from "../src/vocabulary/vocabularySnapshot";
import type { SemantropyView, SemantropyViewHost } from "../src/view/SemantropyView";

/*
 * 0.1.0 S4 (Docs/release_0_1_0_policy.md decision 10): in a Vocabulary Source,
 * `{{…}}` (and any extra pair from settings) is one noun. The Target is never read this way.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const STANDARD = enclosedTermSyntax([]);
const BRACKETS = enclosedTermSyntax([{ open: "【", close: "】" }]);

describe("0.1.0 S4 finding enclosed terms", () => {
	it("finds qualifying spans left to right and leaves the rest as text", () => {
		expect(findEnclosedTerms("{{猫又}}が{{月見草}}を見た", STANDARD).map((span) => span.term)).toEqual(["猫又", "月見草"]);
		// Empty, spaced, markup, nested and unclosed spans are ordinary text.
		for (const text of ["{{}}", "{{ 猫 }}", "{{猫 又}}", "{{*猫*}}", "{{猫", "猫}}", "{{a|b}}", "{{｜猫《ねこ》}}"]) {
			expect(findEnclosedTerms(text, STANDARD)).toEqual([]);
		}
		expect(findEnclosedTerms(`{{${"猫".repeat(64)}}}`, STANDARD)).toHaveLength(1);
		expect(findEnclosedTerms(`{{${"猫".repeat(65)}}}`, STANDARD)).toEqual([]);
		// `{{{猫}}}` skips the first brace and finds the inner pair.
		expect(findEnclosedTerms("{{{猫}}}", STANDARD).map((span) => [span.start, span.term])).toEqual([[1, "猫"]]);
		expect(findEnclosedTerms("【猫又】と{{犬神}}", BRACKETS).map((span) => span.term)).toEqual(["猫又", "犬神"]);
		expect(findEnclosedTerms("【猫又】", STANDARD)).toEqual([]);
	});

	it("stays linear on many unclosed or overlong marks (S3+S4 review)", () => {
		const syntax = enclosedTermSyntax([{ open: "【", close: "】" }]);
		const started = performance.now();
		expect(findEnclosedTerms(`${"{{a".repeat(30000)}}}`, syntax).map((span) => span.term)).toEqual(["a"]);
		expect(findEnclosedTerms("{".repeat(90000), syntax)).toEqual([]);
		expect(findEnclosedTerms(`${"【".repeat(50000)}${"x".repeat(40000)}】`, syntax)).toEqual([]);
		// Quadratic scanning took seconds on the first input; linear scanning takes milliseconds.
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("keeps the standard pair first and always, and only valid extra pairs", () => {
		expect(STANDARD).toEqual([STANDARD_ENCLOSED_TERM_DELIMITER]);
		const syntax = enclosedTermSyntax([{ open: "{{", close: "}}" }, { open: "【", close: "】" }, { open: "a", close: "b" },
			{ open: "【", close: "】" }, { open: "<<", close: ">>" }, null, "x", { open: "《", close: "》" }]);
		expect(syntax).toEqual([STANDARD_ENCLOSED_TERM_DELIMITER, { open: "【", close: "】" }]);
		expect(extraEnclosedTermDelimiters([{ open: "［［", close: "］］" }, { open: "{{", close: "}}" }])).toEqual([{ open: "［［", close: "］］" }]);
	});

	it("reads and writes the settings text", () => {
		expect(parseEnclosedTermDelimiterList("  【…】 ［［…］］  {{…}} 【…】 bad …x ")).toEqual({
			pairs: [{ open: "【", close: "】" }, { open: "［［", close: "］］" }], invalid: ["bad", "…x"] });
		expect(parseEnclosedTermDelimiterList("〔…〕 〈…〉 ［…］ ＜…＞ «…»").invalid).toEqual(["«…»"]);
		expect(formatEnclosedTermDelimiterList([{ open: "【", close: "】" }, { open: "［［", close: "］］" }])).toBe("【…】 ［［…］］");
	});
});

/** A lexicon tokenizer that also records every text it was asked for. */
function recording(lexicon: readonly JapaneseToken[]) {
	const base = lexiconTokenizer(lexicon), calls: string[] = [];
	const tokenizer: JapaneseTokenizer = { tokenize: async (text) => { calls.push(text); return await base.tokenize(text); } };
	return { tokenizer, calls };
}
const LEXICON = [token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "又" }),
	token({ surface: "と", pos: "助詞", detail1: "並立助詞" }), token({ surface: "。", pos: "記号", detail1: "句点" })];

describe("0.1.0 S4 the tokenizer wrapper", () => {
	it("tiles the text with delimiter, noun and delimiter tokens, and passes text without a term through in one call", async () => {
		const { tokenizer, calls } = recording(LEXICON);
		const wrapped = enclosedTermTokenizer(tokenizer, STANDARD);
		const tokens = await wrapped.tokenize("犬と{{猫又}}。");
		expect(tokens.map((item) => item.surface).join("")).toBe("犬と{{猫又}}。");
		expect(tokens.map((item) => [item.surface, item.pos, item.detail1])).toEqual([
			["犬", "名詞", "一般"], ["と", "助詞", "並立助詞"], ["{{", "記号", "括弧開"], ["猫又", "名詞", "一般"], ["}}", "記号", "括弧閉"], ["。", "記号", "句点"]]);
		expect(calls).toEqual(["犬と", "。"]);
		expect(wrapped.used()).toBe(true);
		const plain = enclosedTermTokenizer(tokenizer, STANDARD);
		await plain.tokenize("犬と猫。");
		expect(calls.at(-1)).toBe("犬と猫。");
		expect(plain.used()).toBe(false);
	});
});

async function source(text: string, enclosedTerms: ReturnType<typeof enclosedTermSyntax> | null) {
	const answer = await analyzeManualMorphSource({ text, sourcePath: "V.md", tokenizer: lexiconTokenizer(LEXICON), mode: "target-prototype", enclosedTerms });
	if (answer.status !== "ready") throw new Error("fixture-analysis");
	return answer.analysis;
}
const surfaces = (snapshot: VocabularySnapshot) => snapshot.projections.manual.candidates.map((record) => record.surface).sort();

describe("0.1.0 S4 a Vocabulary Source", () => {
	it("reads an enclosed term as one noun and records the enclosed-term policy", async () => {
		const analysis = await source("犬と{{猫又}}。", STANDARD);
		expect(analysis.projectionPolicy).toBe(`${BASE}+${ENCLOSED_TERM_POLICY_VERSION}`);
		const snapshot = buildManualMorphVocabulary({ sources: [analysis], drawMode: "uniform" }).snapshot;
		expect(surfaces(snapshot)).toContain("猫又");
		// The delimiters are symbols: recorded like `。`, but in no replaceable, dictionary or Collision pool.
		const body = snapshot.projections.automaticBody.buckets.flatMap((bucket) => bucket.surfaces.map((item) => item.surface));
		expect(body).toContain("猫又");
		const pools = [...body, ...Object.values(snapshot.projections.dictionary.byPlaceholder).flat().map((item) => item.surface),
			...snapshot.projections.collision.nouns.map((item) => item.surface)];
		expect(pools.filter((surface) => surface.includes("{") || surface.includes("}"))).toEqual([]);
	});

	it("is unchanged, policy and all, when the text has no term", async () => {
		const withTerms = buildManualMorphVocabulary({ sources: [await source("犬と猫。", STANDARD)], drawMode: "uniform" }).snapshot;
		const without = buildManualMorphVocabulary({ sources: [await source("犬と猫。", null)], drawMode: "uniform" }).snapshot;
		expect(withTerms).toEqual(without);
		expect(withTerms.sources[0]!.projectionPolicy).toBe(BASE);
	});
});

const snapshotOf = (view: SemantropyView) =>
	(Reflect.get(view, "targetBody") as { getVocabularySnapshot(): VocabularySnapshot | null }).getVocabularySnapshot();

describe("0.1.0 S4 the Target", () => {
	it("keeps the Target's own reading while the same note, as a Vocabulary Source, reads the term", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("犬と{{猫又}}。\n");
		// The Target: the text as written, tokenized as ordinary text.
		expect(h.peek.contentEl.querySelector(".semantropy-body")!.textContent).toContain("{{");
		const target = Reflect.get(Reflect.get(h.view, "targetBody") as object, "targetSource") as { projectionPolicy: string };
		expect(target.projectionPolicy).toBe(BASE);
		// Current Note: the same note as a Source has the term.
		const snapshot = snapshotOf(h.view)!;
		expect(surfaces(snapshot)).toContain("猫又");
		expect(snapshot.sources[0]!.projectionPolicy).toBe(`${BASE}+${ENCLOSED_TERM_POLICY_VERSION}`);
	});

	it("reads a term whose raw text carries emphasis the same way on Open as on Apply (S3+S4 review P2)", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("犬と{{**猫又**}}。\n");
		expect(surfaces(snapshotOf(h.view)!)).toContain("猫又");
	});

	it("reads the host's extra pairs on Apply, and a Target with no term is analyzed once", async () => {
		const { tokenizer, calls } = recording(LEXICON);
		const h = manualMorphHarness(tokenizer);
		const host = Reflect.get(h.view, "host") as SemantropyViewHost;
		host.getEnclosedTermDelimiters = () => [{ open: "【", close: "】" }];
		await h.open("犬と猫。\n");
		expect(calls.filter((text) => text.startsWith("犬と猫"))).toHaveLength(1);
		await h.apply(["犬と【猫又】と{{又猫}}。"]);
		expect(surfaces(snapshotOf(h.view)!)).toEqual(expect.arrayContaining(["猫又", "又猫"]));
	});
});

describe("0.1.0 S4 settings", () => {
	it("stores only valid extra pairs in schema 8, none before, and refuses a request that would drop one", () => {
		const parsed = parseAutomaticPosSettings({ schemaVersion: 8, enclosedTermDelimiters: [{ open: "【", close: "】" }, { open: "a", close: "b" }, { open: "{{", close: "}}" }] });
		expect(parsed.enclosedTermDelimiters).toEqual([{ open: "【", close: "】" }]);
		expect(parseAutomaticPosSettings(serializeAutomaticPosSettings(parsed)).enclosedTermDelimiters).toEqual([{ open: "【", close: "】" }]);
		expect(parseAutomaticPosSettings({ schemaVersion: 7, enclosedTermDelimiters: [{ open: "【", close: "】" }] }).enclosedTermDelimiters).toEqual([]);
		expect(parseAutomaticPosSettings({ schemaVersion: 8 }).enclosedTermDelimiters).toEqual([]);
		expect(validateAutomaticPosSettingsPatch({ enclosedTermDelimiters: [{ open: "【", close: "】" }] })).toEqual({ enclosedTermDelimiters: [{ open: "【", close: "】" }] });
		for (const bad of [[{ open: "a", close: "b" }], [{ open: "{{", close: "}}" }], "【…】", null]) {
			expect(validateAutomaticPosSettingsPatch({ enclosedTermDelimiters: bad })).toBeNull();
		}
	});

	it("saves the row by an explicit Save, and names an item that is not a pair without saving", async () => {
		let disk: unknown = null;
		const store = new AutomaticPosSettingsStore({ load: async () => disk, save: async (data) => { disk = data; } });
		await store.load();
		const set = vi.fn((pairs: Parameters<typeof store.setEnclosedTermDelimiters>[0]) => store.setEnclosedTermDelimiters(pairs));
		const tab = new SemantropySettingTab({ vault: {} } as unknown as App, {} as Plugin, {
			getCollectionPath: () => store.getCollectionPath(), setCollectionPath: async () => true,
			getUiLanguage: () => store.getUiLanguage(), setUiLanguage: async () => true,
			getShowRibbonIcon: () => store.getShowRibbonIcon(), setShowRibbonIcon: async () => true,
			getCollectAttribution: () => store.getCollectAttribution(), setCollectAttribution: async () => true,
			getEnclosedTermDelimiters: () => store.getEnclosedTermDelimiters(), setEnclosedTermDelimiters: set,
		});
		setCurrentUiLanguage("ja");
		tab.show();
		const row = tab.containerEl.querySelector(".semantropy-terms-setting")!;
		expect(row.querySelector(".setting-item-name")?.textContent).toBe("追加の囲み記号");
		const input = row.querySelector("input")!;
		const status = () => tab.containerEl.querySelector(".semantropy-terms-status")!.textContent;
		input.value = "【…】 x"; input.dispatchEvent(new Event("input"));
		expect(await tab.saveEnclosedTerms()).toBe("invalid");
		expect(set).not.toHaveBeenCalled();
		expect(status()).toBe("組として読めません: x。保存していません。");
		input.value = "【…】 ［［…］］"; input.dispatchEvent(new Event("input"));
		expect(await tab.saveEnclosedTerms()).toBe("saved");
		expect(store.getEnclosedTermDelimiters()).toEqual([{ open: "【", close: "】" }, { open: "［［", close: "］］" }]);
		expect((disk as { enclosedTermDelimiters: unknown }).enclosedTermDelimiters).toEqual([{ open: "【", close: "】" }, { open: "［［", close: "］］" }]);
		expect(status()).toBe("保存しました。");
		tab.hide();
	});
});
