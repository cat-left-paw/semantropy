// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { buildAnalysisDocument } from "../src/render/buildAnalysisDocument";
import { tokenizeAnalysisDocument } from "../src/analysis/locateTokens";
import { buildRubyVocabulary, chooseRubyVariant, chooseVocabularyCandidate } from "../src/analysis/rubyVocabulary";
import { MarkdownBodyController } from "../src/render/markdownBodyController";
import { buildVocabularyPool, transformTokenSequences } from "../src/transform/transformTokens";
import { planReshuffle } from "../src/application/reshuffleNote";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { token } from "./tokenFixtures";
import { MAX, MEDIUM, OFF } from "./readyAnalysis";

type Occurrence = {
	surface: string;
	morph?: Partial<JapaneseToken>;
	ruby?: { start: number; end: number; reading: string };
};
const target: Occurrence = { surface: "猫", ruby: { start: 0, end: 1, reading: "ねこ" } };
const plain: Occurrence = { surface: "言葉", morph: { reading: "plain-identity" } };
const annotated: Occurrence = {
	surface: "言葉", morph: { reading: "ruby-identity" }, ruby: { start: 0, end: 2, reading: "ことば" },
};

async function source(occurrences: Occurrence[]) {
	const root = document.createElement("div");
	for (const item of occurrences) {
		const p = document.createElement("p");
		if (item.ruby) {
			const r = document.createElement("ruby"); const rt = document.createElement("rt");
			r.append(item.surface.slice(item.ruby.start, item.ruby.end));
			rt.textContent = item.ruby.reading; r.append(rt);
			p.append(item.surface.slice(0, item.ruby.start), r, item.surface.slice(item.ruby.end));
		} else p.append(item.surface);
		root.append(p);
	}
	const tokenizer = () => {
		let index = 0;
		return { tokenize: vi.fn(async (text: string) => {
			const item = occurrences[index++]!;
			expect(text).toBe(item.surface);
			return [token({ surface: item.surface, baseForm: item.surface.normalize("NFC"), reading: "morph", ...item.morph })];
		}) };
	};
	const located = await tokenizeAnalysisDocument(buildAnalysisDocument(root).document, tokenizer());
	const vocabulary = buildRubyVocabulary(located, { path: "source.md", contentHash: "hash" });
	const controller = new MarkdownBodyController();
	await controller.renderIfCurrent(1, { text: "fixture", sourcePath: "source.md", contentHash: "hash" }, () => true, {
		createContainer: () => root, createOwner: () => ({ unload: vi.fn() }), renderMarkdown: async () => undefined,
	});
	const analysis = (await controller.analyzeRuby(tokenizer(), () => true))!;
	const apply = (seed: number) => {
		const result = controller.transformRuby(seed, MAX);
		expect(controller.applyRubyResult(controller.getBodyGeneration(), result)).toBe("applied");
		return result;
	};
	return { root, controller, vocabulary, located, analysis, apply };
}

describe("selected Ruby candidate identity and exact display form", () => {
	it("retains the selected identity through transformation and rendering; plain never borrows Ruby", async () => {
		const h = await source([target, plain, annotated]);
		const records = h.vocabulary.candidates.filter((c) => c.surface === "言葉");
		expect(new Set(records.map((c) => c.candidateId)).size).toBe(2);
		const seen = new Set<string>();
		for (let seed = 0; seed < 64; seed += 1) {
			const result = h.apply(seed);
			const selection = result.candidateSelections![0]![0]!;
			expect(selection.surface).toBe("言葉");
			const record = records.find((c) => c.displayFormId === selection.displayFormId)!;
			expect(selection.candidateId).toBe(record.candidateId);
			seen.add(record.token.reading!);
			expect(h.root.querySelector("p")!.querySelector("rt")?.textContent ?? null).toBe(record.verifiedRubyVariants[0]?.reading ?? null);
			expect(h.controller.transformRuby(seed, MAX)).toEqual(result);
		}
		expect([...seen].sort()).toEqual(["plain-identity", "ruby-identity"]);
		const selection = records.find((c) => !c.verifiedRubyVariants.length)!;
		expect(chooseRubyVariant({ vocabulary: h.vocabulary, original: token({ surface: "猫" }), selection, seed: 1, tokenId: "target" })).toBeNull();
	});

	it.each([{ isUnknown: true }, { pos: "助詞" }])("never borrows the pair of an ineligible record: %j", async (morph) => {
		const h = await source([target, plain, { ...annotated, morph: { ...annotated.morph, ...morph } }]);
		const invalid = h.vocabulary.candidates.find((c) => c.verifiedRubyVariants.some((v) => v.reading === "ことば"))!;
		for (let seed = 0; seed < 32; seed += 1) {
			const selection = h.apply(seed).candidateSelections![0]![0]!;
			expect(selection.candidateId).not.toBe(invalid.candidateId);
			expect(h.root.querySelector("p")!.querySelector("rt")).toBeNull();
		}
		expect(() => chooseRubyVariant({ vocabulary: h.vocabulary, original: token({ surface: "猫" }), selection: invalid, seed: 1, tokenId: "target" })).toThrow("Selected vocabulary candidate is invalid.");
	});

	it.each([false, true])("separates NFC-equivalent UTF-16 spellings regardless of occurrence order: reverse=%s", async (reverse) => {
		const forms: Occurrence[] = [
			{ surface: "か\u3099", ruby: { start: 0, end: 2, reading: "が" } },
			{ surface: "が" },
		];
		const h = await source([target, ...(reverse ? [...forms].reverse() : forms)]);
		const records = h.vocabulary.candidates.filter((c) => c.surface.normalize("NFC") === "が");
		expect(records).toHaveLength(2);
		expect(new Set(records.map((c) => c.candidateId)).size).toBe(1);
		expect(new Set(records.map((c) => c.displayFormId)).size).toBe(2);
		expect(records.find((c) => c.surface === "が")!.verifiedRubyVariants).toEqual([]);
		expect(records.find((c) => c.surface.length === 2)!.verifiedRubyVariants[0]!.baseRangeInSurface).toEqual({ start: 0, end: 2 });
		const decomposed = records.find((c) => c.surface.length === 2)!;
		expect(() => chooseRubyVariant({ vocabulary: h.vocabulary, original: token({ surface: "猫" }),
			selection: { ...decomposed, surface: "が" }, seed: 1, tokenId: "target" })).toThrow("Selected vocabulary candidate is invalid.");
		const seen = new Set<string>();
		for (let seed = 0; seed < 32; seed += 1) {
			const selected = h.apply(seed).candidateSelections![0]![0]!;
			seen.add(selected.surface);
			const p = h.root.querySelector("p")!;
			if (selected.surface === "が") { expect(p.textContent).toBe("が"); expect(p.querySelector("ruby")).toBeNull(); }
			else { expect(p.querySelector("ruby")!.firstChild!.textContent).toBe("か\u3099"); expect(p.querySelector("rt")!.textContent).toBe("が"); }
		}
		expect(seen.size).toBe(2);
		const originalPool = buildVocabularyPool(h.analysis.tokenSequences);
		expect(h.analysis.pool).toEqual(originalPool);
	});

	it("keeps partial-base prefix/suffix ranges local to their exact NFC form", async () => {
		const h = await source([target,
			{ surface: "おか\u3099く", ruby: { start: 1, end: 3, reading: "が" } },
			{ surface: "おがく" },
		]);
		for (const record of h.vocabulary.candidates) for (const variant of record.verifiedRubyVariants) {
			expect(variant.baseRangeInSurface.end).toBeLessThanOrEqual(record.surface.length);
		}
		for (let seed = 0; seed < 16; seed += 1) {
			const result = h.apply(seed); const selected = result.candidateSelections![0]![0]!;
			const p = h.root.querySelector("p")!;
			if (selected.surface === "おか\u3099く") {
				expect(p.textContent).toBe("おか\u3099がく");
				expect(p.querySelector("ruby")!.firstChild!.textContent).toBe("か\u3099");
			} else expect(p.querySelector("rt")).toBeNull();
		}
	});

	it("does not change primary surfaces or replacement counts when candidate identity or variants change", async () => {
		const a = await source([target, plain, plain, { surface: "犬" }]);
		const b = await source([target, plain, annotated, { surface: "犬", morph: { reading: "different-identity" } }]);
		for (let seed = 0; seed < 48; seed += 1) for (const level of [OFF, MEDIUM, MAX]) {
			const left = a.controller.transformRuby(seed, level); const right = b.controller.transformRuby(seed, level);
			expect(right.tokenSurfaces).toEqual(left.tokenSurfaces);
			expect(right.texts).toEqual(left.texts);
			expect(right.replacementCount).toBe(left.replacementCount);
			expect(right.replaceableSlotCount).toBe(left.replaceableSlotCount);
			const legacy = transformTokenSequences(b.analysis.tokenSequences, buildVocabularyPool(b.analysis.tokenSequences), seed, level, true);
			expect(right.tokenSurfaces).toEqual(legacy.tokenSurfaces);
			expect(right.replacementCount).toBe(legacy.replacementCount);
		}
	});

	it("passes candidate selections through Reshuffle and refuses a mismatched form before DOM writes", async () => {
		const h = await source([target, plain, annotated]);
		const plan = planReshuffle({ tokenSequences: h.analysis.tokenSequences, pool: h.analysis.pool,
			currentBodySeed: 1, bodySemantropy: MAX, expectedNodeCount: 3, issueSeed: () => 2,
			transform: (_tokens, _pool, seed, level) => h.controller.transformRuby(seed, level),
		});
		expect(plan.status).toBe("planned"); if (plan.status !== "planned") return;
		expect(plan.plan.candidateSelections).toEqual(h.controller.transformRuby(2, MAX).candidateSelections);
		expect(h.controller.applyRubyResult(h.controller.getBodyGeneration(), plan.plan)).toBe("applied");
		const result = h.controller.transformRuby(3, MAX); const before = h.root.innerHTML;
		const selection = result.candidateSelections![0]![0]!;
		const wrong = { ...result, candidateSelections: [[{ ...selection, displayFormId: "unrelated-form" }], ...result.candidateSelections!.slice(1)] };
		expect(h.controller.applyRubyResult(h.controller.getBodyGeneration(), wrong)).toBe("mismatch");
		expect(h.root.innerHTML).toBe(before);
		expect(chooseVocabularyCandidate({ vocabulary: h.vocabulary, original: token({ surface: "猫" }), surface: "言葉", seed: 3, tokenId: "run:0:token:0" })).toEqual(selection);
	});
});
