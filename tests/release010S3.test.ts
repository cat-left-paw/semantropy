// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphSourceAnalysis } from "../src/transform/manualMorphology";
import {
	canonicalSourceWeights,
	drawWeight,
	sourceWeightLookup,
	weightedDrawWeight,
} from "../src/vocabulary/sourceWeights";
import { transformWithVocabularySnapshot, type VocabularySnapshot } from "../src/vocabulary/vocabularySnapshot";
import { buildAuthenticatedCollisionLexemePool, inspectCollisionLexemePool } from "../src/collision/collisionVocabulary";
import { generateCollisionResults } from "../src/collision/collisionCore";
import { selectionSourceWeights } from "../src/application/prepareVocabulary";
import { nounRecipe, patterns } from "./collisionBatchFixtures";
import { prepareMax, v, period as maxPeriod } from "./maxCoreFixtures";
import { NOUN as NOUN_ONLY } from "./automaticPosFixtures";
import { harness, peek } from "./vocabularyIntegrationHarness";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { MAX } from "./readyAnalysis";
import type { SemantropyView, SemantropyViewHost } from "../src/view/SemantropyView";
import type { BodySemantropy } from "../src/settings/bodySemantropy";

/*
 * 0.1.0 S3 (Docs/release_0_1_0_policy.md decision 11): Vocabulary Source weights.
 *   - All ×1 is the absence of weights: the same Snapshot, fingerprint and draws.
 *   - Frequency weighs Σ (count in a Source × its weight); Uniform the largest weight among its Sources.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => document.body.replaceChildren());

const noun = (surface: string): JapaneseToken => ({ surface, pos: "名詞", detail1: "一般", detail2: "*", detail3: "*",
	conjugationType: "*", conjugationForm: "*", baseForm: surface, isUnknown: false });

async function analyze(path: string, words: readonly string[]): Promise<ManualMorphSourceAnalysis> {
	const text = words.join("");
	const answer = await analyzeManualMorphSource({ text, sourcePath: path, tokenizer: {
		tokenize: (input) => {
			if (input !== text) throw new Error("fixture-run");
			return Promise.resolve(words.map(noun));
		},
	} });
	if (answer.status !== "ready") throw new Error("fixture-analysis");
	return answer.analysis;
}

/** A.md holds 猫 three times, B.md 鳥 once. */
async function twoSources() {
	return [await analyze("A.md", ["猫", "猫", "猫"]), await analyze("B.md", ["鳥"])];
}

describe("0.1.0 S3 weight arithmetic", () => {
	it("stores nothing when every Source is ×1, one weight per Source otherwise, and refuses another value", () => {
		expect(canonicalSourceWeights(["A.md", "B.md"], undefined)).toBeNull();
		expect(canonicalSourceWeights(["A.md", "B.md"], { "A.md": 1, "B.md": 1, "gone.md": 4 })).toBeNull();
		expect(canonicalSourceWeights(["A.md", "B.md"], { "B.md": 4 })).toEqual([1, 4]);
		expect(canonicalSourceWeights(["A.md", "B.md"], { "B.md": 3 })).toBeUndefined();
		expect(canonicalSourceWeights(["A.md"], { "A.md": "4" })).toBeUndefined();
	});

	it("weighs Frequency by Σ count × weight and Uniform by the largest weight, in quarter units", () => {
		const lookup = new Map([["A.md", 1], ["B.md", 16]]); // ×0.25 and ×4
		const origins = [{ path: "A.md", contentHash: "a", count: 3 }, { path: "B.md", contentHash: "b", count: 2 }];
		expect(weightedDrawWeight("frequency", lookup, origins)).toBe(3 * 1 + 2 * 16);
		expect(weightedDrawWeight("uniform", lookup, origins)).toBe(16);
		// A Source with no entry is ×1.
		expect(weightedDrawWeight("uniform", lookup, [{ path: "C.md", contentHash: "c", count: 9 }])).toBe(4);
	});

	it("is exactly the unweighted expression without weights, and never reads origins then", () => {
		const origins = () => { throw new Error("read"); };
		expect(drawWeight("frequency", null, 7, origins)).toBe(7);
		expect(drawWeight("uniform", null, 7, origins)).toBe(1);
	});
});

describe("0.1.0 S3 the Vocabulary Snapshot", () => {
	it("is the same Snapshot and fingerprint when every weight is ×1", async () => {
		const sources = await twoSources();
		const plain = buildManualMorphVocabulary({ sources, drawMode: "frequency" }).snapshot;
		const ones = buildManualMorphVocabulary({ sources, drawMode: "frequency", sourceWeights: { "A.md": 1, "B.md": 1 } }).snapshot;
		expect(ones).toEqual(plain);
		expect(ones.fingerprint).toBe(plain.fingerprint);
		expect(Object.prototype.hasOwnProperty.call(ones, "sourceWeights")).toBe(false);
	});

	it("records weights in Source order, changes the fingerprint, and refuses an unknown weight", async () => {
		const sources = await twoSources();
		const plain = buildManualMorphVocabulary({ sources, drawMode: "uniform" }).snapshot;
		const weighted = buildManualMorphVocabulary({ sources: [...sources].reverse(), drawMode: "uniform", sourceWeights: { "B.md": 4 } }).snapshot;
		expect(weighted.sources.map((source) => source.path)).toEqual(["A.md", "B.md"]);
		expect(weighted.sourceWeights).toEqual([1, 4]);
		expect(Object.isFrozen(weighted.sourceWeights)).toBe(true);
		expect(weighted.fingerprint).not.toBe(plain.fingerprint);
		expect(() => buildManualMorphVocabulary({ sources, drawMode: "uniform", sourceWeights: { "B.md": 3 } })).toThrow();
		expect(sourceWeightLookup(weighted)).toEqual(new Map([["A.md", 4], ["B.md", 16]]));
		expect(sourceWeightLookup(plain)).toBeNull();
	});
});

/** How often the Target's one noun becomes 鳥 over many nonces. */
function birdShare(snapshot: VocabularySnapshot): number {
	let birds = 0;
	const runs = 2000;
	for (let seed = 0; seed < runs; seed += 1) {
		const result = transformWithVocabularySnapshot({ tokenSequences: [[{ tokenId: "t0", token: noun("空") }]], snapshot,
			bodySeed: seed, bodySemantropy: 100 as BodySemantropy, algorithmVersion: 1 });
		if (result.texts[0] === "鳥") birds += 1;
	}
	return birds / runs;
}

describe("0.1.0 S3 draws", () => {
	it("Body: all ×1 draws exactly as before, and weights move the odds as specified", async () => {
		const sources = await twoSources();
		for (const drawMode of ["uniform", "frequency"] as const) {
			const plain = buildManualMorphVocabulary({ sources, drawMode }).snapshot;
			const ones = buildManualMorphVocabulary({ sources, drawMode, sourceWeights: { "A.md": 1, "B.md": 1 } }).snapshot;
			for (let seed = 0; seed < 50; seed += 1) {
				const input = { tokenSequences: [[{ tokenId: "t0", token: noun("空") }]], bodySeed: seed,
					bodySemantropy: 100 as BodySemantropy, algorithmVersion: 1 as const };
				expect(transformWithVocabularySnapshot({ ...input, snapshot: ones })).toEqual(transformWithVocabularySnapshot({ ...input, snapshot: plain }));
			}
		}
		// Uniform: 猫 ×1 against 鳥 ×4 is 4 : 16. Frequency: 3 × 1 against 1 × 4 is 3 : 4.
		const uniform = birdShare(buildManualMorphVocabulary({ sources, drawMode: "uniform", sourceWeights: { "B.md": 4 } }).snapshot);
		const frequency = birdShare(buildManualMorphVocabulary({ sources, drawMode: "frequency", sourceWeights: { "B.md": 4 } }).snapshot);
		const unweighted = birdShare(buildManualMorphVocabulary({ sources, drawMode: "frequency" }).snapshot);
		expect(uniform).toBeGreaterThan(0.75); expect(uniform).toBeLessThan(0.85);
		expect(frequency).toBeGreaterThan(0.52); expect(frequency).toBeLessThan(0.62);
		expect(unweighted).toBeGreaterThan(0.2); expect(unweighted).toBeLessThan(0.3);
	});

	it("Collision: the pool carries the weights outside its provenance, and a noun draw follows them", async () => {
		const sources = await twoSources();
		const set = patterns([nounRecipe()]);
		const build = (weights?: Record<string, 1 | 4>) => {
			const owner = buildManualMorphVocabulary({ sources, drawMode: "uniform", ...(weights ? { sourceWeights: weights } : {}) });
			const built = buildAuthenticatedCollisionLexemePool({ vocabulary: owner, patternData: set });
			if (!built.ok) throw new Error(built.reason);
			return built.pool;
		};
		const plain = build(), ones = build({ "A.md": 1, "B.md": 1 }), weighted = build({ "B.md": 4 });
		expect(ones).toEqual(plain);
		expect(weighted.sourceWeights).toEqual([1, 4]);
		expect(Object.keys(weighted.provenance)).toEqual(Object.keys(plain.provenance));
		expect(inspectCollisionLexemePool(weighted, set)).toBeNull();
		const share = (pool: typeof plain) => {
			const result = generateCollisionResults({ pool, patternSet: set, drawMode: "uniform", request: { kind: "fixed", recipeId: "single" }, count: 1, nonce: 0 });
			let birds = 0;
			for (let nonce = 0; nonce < 1000; nonce += 1) {
				const next = generateCollisionResults({ pool, patternSet: set, drawMode: "uniform", request: { kind: "fixed", recipeId: "single" }, count: 1, nonce });
				if (next.ok && next.draft.results[0]?.text === "鳥") birds += 1;
			}
			return { first: result, share: birds / 1000 };
		};
		expect(share(ones).first).toEqual(share(plain).first);
		expect(share(plain).share).toBeGreaterThan(0.4); expect(share(plain).share).toBeLessThan(0.6);
		expect(share(weighted).share).toBeGreaterThan(0.75); expect(share(weighted).share).toBeLessThan(0.85);
	});
});

/** Analyzes fixed tokens as one Source (the tokenizer returns them verbatim). */
async function tokensSource(path: string, tokens: readonly JapaneseToken[]): Promise<ManualMorphSourceAnalysis> {
	const text = tokens.map((item) => item.surface).join("");
	const answer = await analyzeManualMorphSource({ text, sourcePath: path, tokenizer: {
		tokenize: (input) => { if (input !== text) throw new Error("fixture-run"); return Promise.resolve(tokens.map((item) => ({ ...item }))); },
	} });
	if (answer.status !== "ready") throw new Error("fixture-analysis");
	return answer.analysis;
}
const adjective = (surface: string): JapaneseToken => ({ surface, pos: "形容詞", detail1: "自立", detail2: "*", detail3: "*",
	conjugationType: "形容詞・アウオ段", conjugationForm: "基本形", baseForm: surface, isUnknown: false });

describe("0.1.0 S3 draws, per site (S3+S4 review P3)", () => {
	it("Collision modifiers: the chosen form's candidates follow the Source weights", async () => {
		const A = await tokensSource("A.md", [adjective("赤い"), noun("猫")]);
		const B = await tokensSource("B.md", [adjective("青い"), noun("犬")]);
		const recipe = { ...nounRecipe("modified"), parts: [{ kind: "modifier" as const, slotId: "m1", optional: false, profile: "all" }, { kind: "noun" as const, slotId: "n1", optional: false }] };
		const set = patterns([recipe]);
		const share = (weights?: Record<string, 1 | 4>) => {
			const owner = buildManualMorphVocabulary({ sources: [A, B], drawMode: "uniform", ...(weights ? { sourceWeights: weights } : {}) });
			const built = buildAuthenticatedCollisionLexemePool({ vocabulary: owner, patternData: set });
			if (!built.ok) throw new Error(built.reason);
			let blue = 0, adjectives = 0;
			for (let nonce = 0; nonce < 1500; nonce += 1) {
				const result = generateCollisionResults({ pool: built.pool, patternSet: set, drawMode: "uniform", request: { kind: "fixed", recipeId: "modified" }, count: 1, nonce });
				const text = result.ok ? result.draft.results[0]?.text ?? "" : "";
				if (text.startsWith("青い")) { blue += 1; adjectives += 1; } else if (text.startsWith("赤い")) adjectives += 1;
			}
			return blue / adjectives;
		};
		expect(share()).toBeGreaterThan(0.4); expect(share()).toBeLessThan(0.6);
		const weighted = share({ "B.md": 4 });
		expect(weighted).toBeGreaterThan(0.72); expect(weighted).toBeLessThan(0.88);
	});

	it("Body MAX strict verbs follow the Source weights", async () => {
		const kaku = (surface: string) => v(surface, surface, "五段・カ行イ音便", "基本形");
		const target = buildManualMorphVocabulary({ sources: [await tokensSource("T.md", [kaku("書く"), maxPeriod])], drawMode: "uniform" });
		const A = await tokensSource("A.md", [kaku("描く"), maxPeriod]);
		const B = await tokensSource("B.md", [kaku("磨く"), maxPeriod]);
		const share = (weights?: Record<string, 1 | 4>) => {
			const vocabulary = buildManualMorphVocabulary({ sources: [A, B], drawMode: "uniform", ...(weights ? { sourceWeights: weights } : {}) });
			const { run } = prepareMax(vocabulary, target);
			let polish = 0, replaced = 0;
			for (let nonce = 0; nonce < 1000; nonce += 1) {
				const text = run({ ...NOUN_ONLY, noun: false, verb: true }, nonce, 50).texts[0]!;
				if (text.startsWith("磨く")) { polish += 1; replaced += 1; } else if (text.startsWith("描く")) replaced += 1;
			}
			return { share: polish / replaced, replaced };
		};
		const plain = share(), weighted = share({ "B.md": 4 });
		expect(plain.replaced).toBe(1000);
		expect(plain.share).toBeGreaterThan(0.4); expect(plain.share).toBeLessThan(0.6);
		expect(weighted.share).toBeGreaterThan(0.72); expect(weighted.share).toBeLessThan(0.88);
	});
});

describe("0.1.0 S3 selection", () => {
	it("applies Selected Notes weights by normalized path, ignores ×1 and removed notes, and never weights Current Note", () => {
		expect(selectionSourceWeights({ mode: "selected", paths: ["./A.md", "B.md"], drawMode: "uniform", weights: { "./A.md": 2, "B.md": 1, "gone.md": 4 } }))
			.toEqual({ "A.md": 2 });
		expect(selectionSourceWeights({ mode: "selected", paths: ["A.md"], drawMode: "uniform", weights: { "A.md": 1 } })).toBeNull();
		expect(selectionSourceWeights({ mode: "current", paths: ["A.md"], drawMode: "uniform", weights: { "A.md": 4 } })).toBeNull();
	});
});

function external() {
	const h = harness(20, MAX);
	const notes = new Map<string, string>([["B.md", "森海。森森森。"], ["C.md", "空山。"]]);
	const host = Reflect.get(h.view, "host") as SemantropyViewHost;
	host.listVocabularyNotes = () => ["B.md", "C.md"];
	host.readCurrentText = async path => {
		const value = path === "fixture.md" ? h.control.source : notes.get(path);
		if (value === undefined) throw Error("PRIVATE path reading");
		return value;
	};
	return h;
}
const shell = (view: SemantropyView) => peek(view).contentEl;
const snapshotOf = (view: SemantropyView) =>
	(Reflect.get(view, "targetBody") as { getVocabularySnapshot(): VocabularySnapshot | null }).getVocabularySnapshot();

describe("0.1.0 S3 the Vocabulary dialog", () => {
	it("weights a selected note, applies it, reports it, and forgets it when the note is removed", async () => {
		const h = external();
		await h.open("猫犬。");
		shell(h.view).querySelector<HTMLButtonElement>(".semantropy-vocabulary-open")!.click();
		const root = Array.from(document.querySelectorAll<HTMLElement>(".semantropy-vocabulary-modal")).at(-1)!;
		// Opening resets the draft to the committed selection, so select again from the dialog.
		const source = root.querySelector<HTMLSelectElement>('select[aria-label="Vocabulary Source"]')!;
		source.value = "selected"; source.dispatchEvent(new Event("change"));
		for (const name of ["B.md", "C.md"]) {
			const box = Array.from(root.querySelectorAll<HTMLInputElement>('.semantropy-vocabulary-tree input[type="checkbox"]'))
				.find(b => b.parentElement?.textContent === name)!;
			box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true }));
		}
		const weight = root.querySelector<HTMLSelectElement>('select[aria-label="Weight of B.md"]')!;
		expect(Array.from(weight.options, option => option.textContent)).toEqual(["×0.25", "×0.5", "×1", "×2", "×4"]);
		expect(weight.value).toBe("1");
		weight.value = "4"; weight.dispatchEvent(new Event("change", { bubbles: true }));
		expect(shell(h.view).querySelector(".semantropy-vocabulary-status")!.textContent).toContain("unapplied");
		Array.from(root.querySelectorAll("button")).find(button => button.textContent === "Apply Vocabulary")!.click();
		for (let i = 0; i < 200 && snapshotOf(h.view)?.sources.length !== 2; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
		const snapshot = snapshotOf(h.view)!;
		expect(snapshot.sources.map(item => item.path)).toEqual(["B.md", "C.md"]);
		expect(snapshot.sourceWeights).toEqual([4, 1]);
		expect(shell(h.view).querySelector(".semantropy-vocabulary-status")!.textContent)
			.toBe("Vocabulary: Selected Notes (2) · Draw mode: Uniform, weighted");
		// Reloading the Target rebuilds the Vocabulary from the committed Sources and keeps their weights.
		const fingerprint = snapshot.fingerprint;
		expect(await h.view.refreshSource()).toBe("refreshed");
		expect(snapshotOf(h.view)!.sourceWeights).toEqual([4, 1]);
		expect(snapshotOf(h.view)!.fingerprint).toBe(fingerprint);

		// Reopen: the row shows the committed weight; removing the note drops its weight from the draft.
		shell(h.view).querySelector<HTMLButtonElement>(".semantropy-vocabulary-open")!.click();
		const again = Array.from(document.querySelectorAll<HTMLElement>(".semantropy-vocabulary-modal")).at(-1)!;
		expect(again.querySelector<HTMLSelectElement>('select[aria-label="Weight of B.md"]')!.value).toBe("4");
		again.querySelector<HTMLButtonElement>('button[aria-label="Remove B.md"]')!.click();
		const draft = (h.view as unknown as { vocabularyDraft: { weights?: object } }).vocabularyDraft;
		expect(draft.weights).toBeUndefined();
	});
});
