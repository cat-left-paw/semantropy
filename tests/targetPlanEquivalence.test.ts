import { describe, expect, it, vi } from "vitest";
import { analyzeSafeTarget, type SafeTargetModel } from "../src/render/safeTargetPrototype";
import { chooseRubyVariant, chooseVocabularyCandidate, createCandidateDrawContext } from "../src/analysis/rubyVocabulary";
import { createTargetPlanIndex, planTargetDisplay, planTargetSlotRun, type PresentationNode } from "../src/analysis/targetPresentation";
import type { DisplaySlot } from "../src/analysis/displaySlots";
import { transformTokenSequences, type SelectedVocabularyCandidate } from "../src/transform/transformTokens";
import type { BodySemantropy } from "../src/settings/bodySemantropy";
import { referencePlanTargetDisplay } from "./support/referenceTargetPresentation";
import { denseRubyNovel, NOVEL_NOUNS, safeTargetFixtures } from "./fixtures/targetSafeFixtures";
import { token } from "./tokenFixtures";
import { MAX, MEDIUM, OFF } from "./readyAnalysis";

const WORDS = [...NOVEL_NOUNS.map(([base]) => base), "走る", "歩く", "都"].sort((a, b) => b.length - a.length);

function tokenizer() {
	return { tokenize: vi.fn(async (text: string) => {
		const tokens = [];
		for (let i = 0; i < text.length;) {
			const word = WORDS.find(w => text.startsWith(w, i));
			const surface = word ?? String.fromCodePoint(text.codePointAt(i)!);
			tokens.push(token({ surface, reading: "NOT-A-DISPLAY-READING", ...(word ? {} : { pos: "記号", isUnknown: true }) }));
			i += surface.length;
		}
		return tokens;
	}) };
}

async function model(text: string): Promise<SafeTargetModel> {
	const result = await analyzeSafeTarget({ text, sourcePath: "synthetic.md", contentHash: "hash", tokenizer: tokenizer() });
	if (result.status !== "ready") throw new Error("Test model failed");
	return result.model;
}

function draws(m: SafeTargetModel, seed: number, level: BodySemantropy, withContext: boolean) {
	const surfaces = transformTokenSequences(m.located.runs.map(r => r.tokens.map(t => t.token)), m.vocabulary.automaticBody, seed, level, true).tokenSurfaces!;
	const context = withContext ? createCandidateDrawContext(m.vocabulary, seed) : undefined;
	const selections: (SelectedVocabularyCandidate | null)[][] = m.located.runs.map((run, r) => run.tokens.map((t, i) =>
		surfaces[r]![i] === t.token.surface ? null
			: chooseVocabularyCandidate({ vocabulary: m.vocabulary, original: t.token, surface: surfaces[r]![i]!, tokenId: t.tokenId, seed, context })));
	return { surfaces, selections, context };
}

describe("optimized Target planning is output-identical to the approved planner", () => {
	const inputs = [...safeTargetFixtures.map(f => f.md), denseRubyNovel(4_000), "漢字《かんじ》と言葉《ことば》\n\n｜東京都《とうきょうと》と言葉《ことば》\n\n**漢字**と*言葉*"];
	it.each(inputs.map((md, i) => [i, md] as const))("fixture %i: same selections and plan across seeds and levels", async (_i, md) => {
		const m = await model(md);
		const index = createTargetPlanIndex(m.projection, m.located);
		// The reference planner is the slow one being replaced; a long fixture gets fewer seeds.
		for (let seed = 0; seed < (md.length > 1_000 ? 2 : 12); seed += 1) for (const level of [OFF, MEDIUM, MAX]) {
			const plain = draws(m, seed, level, false), fast = draws(m, seed, level, true);
			expect(fast.selections).toEqual(plain.selections);
			const reference = referencePlanTargetDisplay({ ...m, surfaces: plain.surfaces, selections: plain.selections, seed });
			const optimized = planTargetDisplay({ ...m, surfaces: fast.surfaces, selections: fast.selections, seed, context: fast.context, index });
			expect(JSON.stringify(optimized)).toBe(JSON.stringify(reference));
			expect(JSON.stringify(planTargetDisplay({ ...m, surfaces: plain.surfaces, selections: plain.selections, seed }))).toBe(JSON.stringify(reference));
		}
	});
	it("keeps multi-token invalidation and manual selections identical", async () => {
		const m = await model("｜東京都《とうきょうと》と言葉《ことば》");
		const seq = m.located.runs[0]!, surfaces = seq.tokens.map(t => t.token.surface); surfaces[0] = "言葉";
		const selection = chooseVocabularyCandidate({ vocabulary: m.vocabulary, original: seq.tokens[0]!.token, surface: "言葉", seed: 1, tokenId: seq.tokens[0]!.tokenId });
		const selections = [[selection, ...surfaces.slice(1).map(() => null)]];
		expect(JSON.stringify(planTargetDisplay({ ...m, surfaces: [surfaces], selections, seed: 1, context: createCandidateDrawContext(m.vocabulary, 1) })))
			.toBe(JSON.stringify(referencePlanTargetDisplay({ ...m, surfaces: [surfaces], selections, seed: 1 })));
	});
	it("derives identical identity and variant draws with the cached hash prefix", async () => {
		const m = await model("言葉《ことば》言葉《げんよう》言葉《ことのは》と漢字《かんじ》と漢字\n\n猫《ねこ》と猫");
		const original = token({ surface: "東京" });
		for (let seed = 0; seed < 200; seed += 17) {
			const context = createCandidateDrawContext(m.vocabulary, seed);
			for (const surface of ["言葉", "漢字", "猫"]) for (let t = 0; t < 30; t += 1) {
				const tokenId = `run:${t % 3}:token:${t}`;
				const selection = chooseVocabularyCandidate({ vocabulary: m.vocabulary, original, surface, seed, tokenId });
				expect(chooseVocabularyCandidate({ vocabulary: m.vocabulary, original, surface, seed, tokenId, context })).toEqual(selection);
				expect(chooseRubyVariant({ vocabulary: m.vocabulary, original, selection, seed, tokenId, context }))
					.toEqual(chooseRubyVariant({ vocabulary: m.vocabulary, original, selection, seed, tokenId }));
			}
		}
	});
	it("refuses a draw context from another seed or vocabulary", async () => {
		const m = await model("漢字と言葉");
		const context = createCandidateDrawContext(m.vocabulary, 1);
		expect(() => chooseVocabularyCandidate({ vocabulary: m.vocabulary, original: token({ surface: "東京" }), surface: "言葉", seed: 2, tokenId: "t", context })).toThrow();
	});
	it("distinguishes a same-surface candidate Ruby from restore-original", async () => {
		const m = await model("猫《もと》"), sequence = m.located.runs[0]!, original = sequence.tokens[0]!;
		const base = { tokenId: original.tokenId, runId: sequence.run.runId, originalRange: original.range, originalToken: original.token,
			displaySurface: original.token.surface, automaticReplaced: false };
		const text = (node: PresentationNode): string => node.kind === "text" ? node.text : node.children.map(text).join("");
		const reading = (node: PresentationNode): string[] => node.kind === "text" ? [] : node.tag === "rt" ? [text(node)] : node.children.flatMap(reading);
		const candidate = { ...base, manualOverride: { kind: "replacement", candidateId: "same", localRevision: 1 },
			displayRuby: { variantId: "candidate", baseRangeInSurface: { start: 0, end: 1 }, reading: "べつ", sourceNotations: ["html"], frequency: 1, origins: [] } } as unknown as DisplaySlot;
		const restored = { ...base, manualOverride: { kind: "restore-original", localRevision: 1 }, displayRuby: null } as unknown as DisplaySlot;
		const index = createTargetPlanIndex(m.projection, m.located);
		expect(reading(planTargetSlotRun(index, 0, [candidate]))).toEqual(["べつ"]);
		expect(reading(planTargetSlotRun(index, 0, [restored]))).toEqual(["もと"]);
	});
});
