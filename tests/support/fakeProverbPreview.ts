import { explainFakeProverbSourceIssues, parseStandardFakeProverbRecipeMarkdown } from "../../scripts/fakeProverb/standardRecipes.mjs";
import { createFakeProverbAuthority } from "../../src/fakeProverb/fakeProverbAuthority";
import { generateFakeProverbs, type FakeProverbDraft } from "../../src/fakeProverb/fakeProverbCore";
import { compileFakeProverbRecipeSet, type CompiledFakeProverbPart, type CompiledFakeProverbRecipeSet } from "../../src/fakeProverb/compileRecipeSet";
import type { JapaneseToken } from "../../src/tokenizer/JapaneseTokenizer";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../../src/vocabulary/enclosedTerms";

/*
 * FAKE-PROVERB-RECIPES3: what `npm run preview:fake-proverb` writes. It reads the recipe document as it stands — no
 * generated module, no lock, no data-version bump — and shows, for the owner who edits it, what each proverb and each
 * gloss comes out as with real Vocabularies, and how often an ending repeats within ten results. It writes nothing
 * itself: the caller decides where the text goes.
 */

export type FakeProverbPreviewSource = { readonly title: string; readonly text: string };

export type FakeProverbPreviewCount = {
	/** The mean, over the batches, of how often the most frequent value stands in one batch of ten. */
	readonly meanMost: number;
	/** Percent of the batches in which one value stands three times or more, and four times or more. */
	readonly threeOrMore: number;
	readonly fourOrMore: number;
	/** The mean number of different values in one batch. */
	readonly meanDistinct: number;
	/** The most frequent values over all drafts, with their percent. */
	readonly top: readonly (readonly [string, number])[];
};

export type FakeProverbPreviewStats = {
	readonly title: string;
	readonly drafts: number;
	readonly shortBatches: number;
	readonly proverbTypes: number;
	readonly glossTypes: number;
	readonly sameProverb: FakeProverbPreviewCount;
	readonly sameGloss: FakeProverbPreviewCount;
	readonly proverbEnding: FakeProverbPreviewCount;
	readonly glossEnding: FakeProverbPreviewCount;
};

export type FakeProverbPreview =
	| { readonly ok: true; readonly markdown: string; readonly dataVersion: number; readonly proverbs: number; readonly glosses: number; readonly stats: readonly FakeProverbPreviewStats[] }
	/** The document has problems: `explanation` is the Japanese report the generator prints. */
	| { readonly ok: false; readonly explanation: string };

const KIND_JA: Readonly<Record<string, string>> = { noun: "名詞", modifier: "修飾の語", predicate: "述語", adverbial: "連用の修飾" };
const PROVERB_ENDINGS: readonly (readonly [RegExp, string])[] = [
	[/べからず$/u, "〜べからず"], [/べし$/u, "〜べし"], [/ことなかれ$/u, "〜ことなかれ"], [/ものなり$/u, "〜ものなり"], [/なり$/u, "〜なり"],
	[/(?:ことなし|ものはなし|なし)$/u, "〜なし"], [/(?:にあらず|知らず|選ばず|に如かず)$/u, "〜ず"], [/な$/u, "〜な（禁止）"],
];
const GLOSS_ENDINGS: readonly (readonly [RegExp, string])[] = [
	[/という戒め。$/u, "という戒め。"], [/という教え。$/u, "という教え。"], [/ということ。$/u, "ということ。"], [/たとえ。$/u, "たとえ。"],
	[/の意。$/u, "の意。"], [/ことをいう。$/u, "ことをいう。"], [/さま。$/u, "さま。"],
];

/** How a recipe ends: its last fixed text reduced to a known closing expression, the text itself, or the kind of word that closes it. */
export function fakeProverbEnding(set: CompiledFakeProverbRecipeSet, parts: readonly CompiledFakeProverbPart[], role: "proverb" | "gloss"): string {
	const last = parts.at(-1)!;
	if (last.kind !== "literal") return `（${KIND_JA[last.kind === "reference" ? last.slotKind : last.kind]}で終わる）`;
	const text = set.literals.find((entry) => entry.id === last.literalId)!.literal;
	for (const [pattern, name] of role === "proverb" ? PROVERB_ENDINGS : GLOSS_ENDINGS) if (pattern.test(text)) return name;
	return text;
}

function count(batches: readonly (readonly string[])[]): FakeProverbPreviewCount {
	const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
	const tally = (values: readonly string[]) => values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>());
	const most = batches.map((batch) => Math.max(0, ...tally(batch).values()));
	const share = (limit: number) => round((most.filter((value) => value >= limit).length / batches.length) * 100, 1);
	const all = batches.flat();
	return {
		meanMost: round(most.reduce((sum, value) => sum + value, 0) / batches.length, 2),
		threeOrMore: share(3),
		fourOrMore: share(4),
		meanDistinct: round(batches.reduce((sum, batch) => sum + new Set(batch).size, 0) / batches.length, 2),
		top: [...tally(all)].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, number]) => [value, round((number / all.length) * 100, 1)] as const),
	};
}

/**
 * Builds the preview from the document's text. Every Vocabulary is one source read as a Vocabulary Source is, drawn
 * with Uniform; batch `i` uses nonce `i`, so the same document and sources give the same preview.
 */
export async function buildFakeProverbPreview(input: {
	readonly markdown: string;
	readonly sources: readonly FakeProverbPreviewSource[];
	readonly tokenize: (text: string) => JapaneseToken[];
	/** Batches of ten for each source. */
	readonly batches: number;
	/** A line that says when the preview was made; left out when absent, so a test can compare whole outputs. */
	readonly made?: string;
}): Promise<FakeProverbPreview> {
	const parsed = parseStandardFakeProverbRecipeMarkdown(input.markdown);
	if (!parsed.ok) return { ok: false, explanation: explainFakeProverbSourceIssues(parsed.issues) };
	const compiled = compileFakeProverbRecipeSet({ schemaVersion: parsed.schemaVersion, dataVersion: parsed.dataVersion, proverbs: parsed.proverbs, glosses: parsed.glosses, literals: parsed.literals, profiles: parsed.profiles });
	if (!compiled.ok) throw new Error("The parser accepted a document the compiler refuses.");
	const set = compiled.set;
	const proverbOf = new Map(set.proverbs.map((entry) => [entry.id, entry]));
	const glossOf = new Map(set.glosses.map((entry) => [entry.id, entry]));

	const stats: FakeProverbPreviewStats[] = [];
	const proverbExamples = new Map<string, string[]>();
	const glossExamples = new Map<string, string[]>();
	const firstBatches: string[] = [];
	for (const source of input.sources) {
		const analyzed = await analyzeManualMorphSource({ text: source.text, sourcePath: `${source.title}.md`, tokenizer: { tokenize: async (value) => await Promise.resolve(input.tokenize(value)) },
			mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
		if (analyzed.status !== "ready") throw new Error("The preview could not analyze a source.");
		const vocabulary = buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
		const authority = createFakeProverbAuthority({ vocabulary, recipeSet: set });
		if (!authority.ok) throw new Error(`The preview could not prepare a Vocabulary (${authority.reason}).`);
		const made: (readonly FakeProverbDraft[])[] = [];
		let shortBatches = 0;
		for (let nonce = 0; nonce < input.batches; nonce += 1) {
			const generation = generateFakeProverbs({ authority: authority.value, recipeSet: set, drawMode: "uniform", count: 10, nonce });
			if (!generation.ok) throw new Error(`The preview could not generate (${generation.reason}).`);
			if (generation.value.shortfall !== null) shortBatches += 1;
			made.push(generation.value.drafts);
		}
		const drafts = made.flat();
		// One example of every type for each source: the first draft that used it.
		const seenProverbs = new Set<string>();
		const seenGlosses = new Set<string>();
		for (const draft of drafts) {
			if (!seenProverbs.has(draft.proverb.recipeId)) {
				seenProverbs.add(draft.proverb.recipeId);
				proverbExamples.set(draft.proverb.recipeId, [...(proverbExamples.get(draft.proverb.recipeId) ?? []), draft.proverb.text]);
			}
			if (!seenGlosses.has(draft.gloss.recipeId)) {
				seenGlosses.add(draft.gloss.recipeId);
				glossExamples.set(draft.gloss.recipeId, [...(glossExamples.get(draft.gloss.recipeId) ?? []), `${draft.gloss.text}（ことわざ: ${draft.proverb.text}）`]);
			}
		}
		firstBatches.push(`### ${source.title}`, "", ...(made[0] ?? []).map((draft) => `- **${draft.proverb.text}** ／ ${draft.gloss.text}`), "");
		stats.push({
			title: source.title, drafts: drafts.length, shortBatches, proverbTypes: seenProverbs.size, glossTypes: seenGlosses.size,
			sameProverb: count(made.map((batch) => batch.map((draft) => draft.proverb.recipeId))),
			sameGloss: count(made.map((batch) => batch.map((draft) => draft.gloss.recipeId))),
			proverbEnding: count(made.map((batch) => batch.map((draft) => fakeProverbEnding(set, proverbOf.get(draft.proverb.recipeId)!.parts, "proverb")))),
			glossEnding: count(made.map((batch) => batch.map((draft) => fakeProverbEnding(set, glossOf.get(draft.gloss.recipeId)!.parts, "gloss")))),
		});
	}

	const titles = input.sources.map((source) => source.title).join("、");
	const none = "（この回数では出なかった）";
	const lines = [
		"# 架空ことわざ: 型ごとの出力の例",
		"",
		...(input.made === undefined ? [] : [`* 作った日時: ${input.made}`]),
		`* レシピ: resources/fake-proverb/standard-recipes.md（data-version ${parsed.dataVersion}。ことわざ ${set.proverbs.length} 個、解説 ${set.glosses.length} 個）。ファイルをそのまま読んだもので、generate はしていなくてよい`,
		`* 語彙: ${titles}（それぞれを 1 つの語彙にした。抽選方式は均等）`,
		`* 作った数: 語彙ごとに、10 件を ${input.batches} 回`,
		"* 例は、語彙ごとに、その型が最初に出た 1 件。語彙の順に並べてある",
		"",
		"## 1. ことわざの型ごとの例",
		"",
		...set.proverbs.flatMap((entry) => [`- \`${entry.id}\`${entry.enabled ? "" : "（enabled: false）"} \`${parsed.authored[entry.id] ?? ""}\`（weight ${entry.weight}）`,
			...(proverbExamples.get(entry.id) ?? [none]).map((text) => `  - ${text}`)]),
		"",
		"## 2. 解説の型ごとの例",
		"",
		...set.glosses.flatMap((entry) => [`- \`${entry.id}\`${entry.enabled ? "" : "（enabled: false）"} \`${parsed.authored[entry.id] ?? ""}\`（weight ${entry.weight}）`,
			...(glossExamples.get(entry.id) ?? [none]).map((text) => `  - ${text}`)]),
		"",
		"## 3. 10 件の 1 回分",
		"",
		...firstBatches,
		"## 4. 10 件の中の重なり",
		"",
		"「最も多い回数」は、10 件の中で、同じものが最も多く出た回数の平均である。",
		"",
		"| 語彙 | 数えたもの | 最も多い回数（平均） | 3 回以上の回 | 4 回以上の回 | 10 件の中の種類（平均） |",
		"|---|---|---|---|---|---|",
		...stats.flatMap((entry) => ([["ことわざの型", entry.sameProverb], ["解説の型", entry.sameGloss], ["ことわざの結び", entry.proverbEnding], ["解説の結び", entry.glossEnding]] as const)
			.map(([name, value]) => `| ${entry.title} | ${name} | ${value.meanMost} | ${value.threeOrMore}% | ${value.fourOrMore}% | ${value.meanDistinct} |`)),
		"",
		...stats.flatMap((entry) => [
			`### ${entry.title}`,
			"",
			`* 作った件数: ${entry.drafts}。10 件に足りなかった回: ${entry.shortBatches}。出たことわざの型: ${entry.proverbTypes} / ${set.proverbs.length}。出た解説の型: ${entry.glossTypes} / ${set.glosses.length}`,
			`* 多いことわざの結び: ${entry.proverbEnding.top.map(([name, percent]) => `${name} ${percent}%`).join("、")}`,
			`* 多い解説の結び: ${entry.glossEnding.top.map(([name, percent]) => `${name} ${percent}%`).join("、")}`,
			"",
		]),
	];
	while (lines.at(-1) === "") lines.pop();
	return { ok: true, markdown: `${lines.join("\n")}\n`, dataVersion: parsed.dataVersion, proverbs: set.proverbs.length, glosses: set.glosses.length, stats };
}
