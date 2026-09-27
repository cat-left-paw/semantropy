import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	DISPLAY_SLOT_ERROR_MESSAGE,
	DISPLAY_SLOT_POLICY_VERSION,
	DisplaySlotError,
	displayRangeOf,
	planDisplaySlots,
	resolveDisplayLayer,
	type DisplaySlotChunkInput,
	type DisplaySlotPlan,
	type PendingManualOverride,
} from "../src/analysis/displaySlots";
import { SOURCE_PROJECTION_POLICY_VERSION } from "../src/analysis/projectMarkdownSource";
import type { Utf16Range } from "../src/analysis/rubyAnalysis";
import {
	type RubyVocabulary,
	type VocabularyCandidate,
	vocabularyCandidateId,
	vocabularyDisplayFormId,
} from "../src/analysis/rubyVocabulary";
import { validateHeadword } from "../src/dictionary/headword";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { buildVocabularyPool } from "../src/transform/transformTokens";
import {
	VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
	buildVocabularySnapshot,
	type AnalyzedVocabularySource,
	type VocabularySnapshot,
} from "../src/vocabulary/vocabularySnapshot";
import type { BodySemantropy } from "../src/settings/bodySemantropy";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { MAX, OFF } from "./readyAnalysis";
import { token } from "./tokenFixtures";

type Occurrence = {
	token: JapaneseToken;
	ruby?: { range: Utf16Range; reading: string };
};

function noun(surface: string, overrides: Partial<JapaneseToken> = {}): JapaneseToken {
	return token({ surface, ...overrides });
}

function analyzedSource(
	path: string,
	hash: string,
	occurrences: readonly Occurrence[],
): AnalyzedVocabularySource {
	const records = new Map<string, VocabularyCandidate>();
	for (const occurrence of occurrences) {
		const candidateId = vocabularyCandidateId(occurrence.token);
		const displayFormId = vocabularyDisplayFormId(
			candidateId,
			occurrence.token.surface,
		);
		const previous = records.get(displayFormId);
		const variants = [...(previous?.verifiedRubyVariants ?? [])];
		if (occurrence.ruby) {
			const base = occurrence.token.surface.slice(
				occurrence.ruby.range.start,
				occurrence.ruby.range.end,
			);
			const variantId = JSON.stringify([
				displayFormId,
				base.normalize("NFC"),
				occurrence.ruby.reading.normalize("NFC"),
				occurrence.ruby.range.start,
				occurrence.ruby.range.end,
			]);
			variants.push({
				variantId,
				baseRangeInSurface: { ...occurrence.ruby.range },
				reading: occurrence.ruby.reading,
				sourceNotations: ["aozora-short"],
				frequency: 1,
				origins: [{ path, contentHash: hash, count: 1 }],
			});
		}
		const frequency = (previous?.frequency ?? 0) + 1;
		records.set(displayFormId, {
			candidateId,
			displayFormId,
			surface: occurrence.token.surface,
			token: { ...occurrence.token },
			frequency,
			origins: [{ path, contentHash: hash, count: frequency }],
			verifiedRubyVariants: variants,
		});
	}
	const tokens = occurrences.map((occurrence) => occurrence.token);
	const vocabulary: RubyVocabulary = {
		candidates: [...records.values()].sort((a, b) =>
			a.displayFormId < b.displayFormId ? -1 : 1,
		),
		fingerprint: "fixture-input-fingerprint",
		automaticBody: buildVocabularyPool([tokens]),
	};
	return {
		source: {
			path,
			contentHash: hash,
			projectionPolicy: SOURCE_PROJECTION_POLICY_VERSION,
		},
		vocabulary,
	};
}

function snapshot(occurrences: readonly Occurrence[]): VocabularySnapshot {
	return buildVocabularySnapshot({
		sources: [analyzedSource("Source.md", "hash", occurrences)],
		drawMode: "uniform",
	});
}

function locate(
	runId: string,
	tokens: readonly JapaneseToken[],
	chunkId: string,
): { analysisText: string; tokens: DisplaySlotChunkInput["runs"][number]["tokens"] } {
	let cursor = 0;
	const analysisText = tokens.map((item) => item.surface).join("");
	return {
		analysisText,
		tokens: tokens.map((item, index) => {
			const start = cursor;
			cursor += item.surface.length;
			return {
				tokenId: `${chunkId}/${runId}:token:${index}`,
				range: { start, end: cursor },
				token: item,
			};
		}),
	};
}

function chunkOf(
	chunkId: string,
	runId: string,
	tokens: readonly JapaneseToken[],
	annotations: DisplaySlotChunkInput["runs"][number]["annotations"] = [],
): DisplaySlotChunkInput {
	const located = locate(runId, tokens, chunkId);
	return {
		chunkId,
		runs: [
			{
				runId,
				analysisText: located.analysisText,
				annotations,
				tokens: located.tokens,
			},
		],
	};
}

function plan(
	chunks: readonly DisplaySlotChunkInput[],
	vocabulary: VocabularySnapshot,
	level: BodySemantropy = MAX,
	seed = 7,
	displayRevision = 1,
	targetRevision = 1,
	markerVisibility?: { replacement?: boolean; manual?: boolean; dictionary?: boolean },
	dictionarySemantropy = assertDictionarySemantropy(100),
): DisplaySlotPlan {
	return planDisplaySlots({
		targetRevision,
		displayRevision,
		chunks,
		snapshot: vocabulary,
		bodySeed: seed,
		bodySemantropy: level,
		dictionarySemantropy,
		algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
		...(markerVisibility ? { markerVisibility } : {}),
	});
}

function assertDeepFrozen(value: unknown): void {
	if (value === null || typeof value !== "object") {
		return;
	}
	expect(Object.isFrozen(value)).toBe(true);
	for (const child of Object.values(value)) {
		assertDeepFrozen(child);
	}
}

function expectRejected(
	run: () => unknown,
	code: "invalid-input" | "incompatible-transform" | "invalid-candidate",
): void {
	try {
		run();
		throw new Error("expected DisplaySlotError");
	} catch (error) {
		expect(error).toBeInstanceOf(DisplaySlotError);
		expect((error as DisplaySlotError).message).toBe(DISPLAY_SLOT_ERROR_MESSAGE);
		expect((error as DisplaySlotError).code).toBe(code);
	}
}

const CAT = noun("猫", { reading: "ネコ", baseForm: "猫" });
const HOSPITAL = noun("病院", { reading: "ビョウイン", baseForm: "病院" });
const PLACE = noun("北海道", { detail1: "固有名詞", detail2: "地域" });
const PERSON = noun("太郎", { detail1: "固有名詞", detail2: "人名" });
const ORG = noun("ソニー", { detail1: "固有名詞", detail2: "組織" });
const SAHEN = noun("研究", { detail1: "サ変接続" });
const ADVERB = noun("本日", { detail1: "副詞可能", baseForm: "*", reading: "*" });
const NUMBER = noun("三", { detail1: "数", baseForm: "*", reading: "*" });
const NA_ADJ = noun("静か", { detail1: "形容動詞語幹", reading: "シズカ" });
const CALM = noun("穏やか", { detail1: "形容動詞語幹", reading: "オダヤカ" });
const VERB = token({
	surface: "歩く",
	pos: "動詞",
	detail1: "自立",
	baseForm: "歩く",
	reading: "アルク",
});
const PARTICLE = token({ surface: "が", pos: "助詞", detail1: "格助詞", baseForm: "が" });
const UNKNOWN = noun("未知", { isUnknown: true });

const SWAP = snapshot([
	{ token: CAT },
	{ token: HOSPITAL },
	{ token: PLACE },
	{ token: PERSON },
	{ token: ORG },
	{ token: SAHEN },
	{ token: ADVERB },
	{ token: NUMBER },
]);

const SELF = snapshot([{ token: CAT }]);
const EMPTY_DICT = snapshot([{ token: VERB }]);
const NA_SWAP = snapshot([{ token: NA_ADJ }, { token: CALM }]);

describe("TOK-01 markers as independent data", () => {
	it("marks automatic replaced, replaceable-unapplied, eligible-without-candidate, and available", () => {
		const chunks = [chunkOf("chunk:1:0", "run:0", [CAT])];
		const replaced = plan(chunks, SWAP, MAX).slots[0]!;
		expect(replaced.automaticReplaced).toBe(true);
		expect(replaced.automaticReplaceable).toBe(true);
		expect(replaced.automaticSurface).toBe("病院");
		expect(replaced.displaySurface).toBe("病院");
		expect(replaced.manualEligible).toBe(true);
		expect(replaced.manualAvailable).toBe(true);

		const unapplied = plan(chunks, SWAP, OFF).slots[0]!;
		expect(unapplied.automaticReplaced).toBe(false);
		expect(unapplied.automaticReplaceable).toBe(true);
		expect(unapplied.automaticSurface).toBe("猫");
		expect(unapplied.manualEligible).toBe(true);
		expect(unapplied.manualAvailable).toBe(true);

		const none = plan(chunks, SELF, MAX).slots[0]!;
		expect(none.automaticReplaced).toBe(false);
		expect(none.automaticReplaceable).toBe(false);
		expect(none.manualEligible).toBe(true);
		expect(none.manualAvailable).toBe(false);
	});

	it("keeps dictionary eligible/available independent of Manual flags", () => {
		const chunks = [chunkOf("chunk:1:0", "run:0", [CAT])];
		const ready = plan(chunks, SWAP, MAX).slots[0]!;
		expect(ready.dictionaryEligible).toBe(true);
		expect(ready.dictionaryAvailable).toBe(true);
		expect(ready.dictionary.outcome).toBe("accepted");

		const insufficient = plan(chunks, EMPTY_DICT, MAX).slots[0]!;
		expect(insufficient.automaticReplaceable).toBe(false);
		expect(insufficient.manualEligible).toBe(true);
		expect(insufficient.dictionaryEligible).toBe(true);
		expect(insufficient.dictionaryAvailable).toBe(false);
	});

	it("sets dictionaryAvailable false when Dictionary Semantropy is Off", () => {
		const slot = plan(
			[chunkOf("chunk:1:0", "run:0", [CAT])],
			SWAP,
			MAX,
			7,
			1,
			1,
			undefined,
			assertDictionarySemantropy(0),
		).slots[0]!;
		expect(slot.dictionaryEligible).toBe(true);
		expect(slot.dictionary.outcome).toBe("accepted");
		expect(slot.dictionaryAvailable).toBe(false);
		expect(slot.automaticReplaced).toBe(true);
	});

	it("lets one slot satisfy replacement, manual, and dictionary together", () => {
		const slot = plan([chunkOf("chunk:1:0", "run:0", [CAT])], SWAP, MAX).slots[0]!;
		expect(slot.automaticReplaced).toBe(true);
		expect(slot.manualEligible).toBe(true);
		expect(slot.manualAvailable).toBe(true);
		expect(slot.dictionaryEligible).toBe(true);
		expect(slot.dictionaryAvailable).toBe(true);
	});

	it("does not change generation or slot identity when marker visibility is toggled", () => {
		const chunks = [chunkOf("chunk:1:0", "run:0", [CAT])];
		const shown = plan(chunks, SWAP, MAX, 7, 1, 1, {
			replacement: true,
			manual: true,
			dictionary: true,
		});
		const hidden = plan(chunks, SWAP, MAX, 7, 1, 1, {
			replacement: false,
			manual: false,
			dictionary: false,
		});
		expect(shown.slots[0]!.tokenId).toBe(hidden.slots[0]!.tokenId);
		expect(shown.slots[0]!.automaticSurface).toBe(hidden.slots[0]!.automaticSurface);
		expect(shown.slots[0]!.automaticReplaced).toBe(hidden.slots[0]!.automaticReplaced);
		expect(shown.slots[0]!.manualAvailable).toBe(hidden.slots[0]!.manualAvailable);
		expect(shown.slots[0]!.dictionaryAvailable).toBe(hidden.slots[0]!.dictionaryAvailable);
		expect(shown).toEqual(hidden);
	});

	it("keeps verb and i-adjective manual markers false", () => {
		const adjective = token({
			surface: "青い",
			pos: "形容詞",
			detail1: "自立",
			conjugationType: "形容詞・アウオ段",
			conjugationForm: "基本形",
			baseForm: "青い",
			reading: "アオイ",
		});
		const result = plan(
			[chunkOf("chunk:1:0", "run:0", [VERB, adjective, PARTICLE])],
			SWAP,
			MAX,
		);
		for (const slot of result.slots) {
			expect(slot.manualEligible).toBe(false);
			expect(slot.manualAvailable).toBe(false);
		}
	});
});

describe("TOK-02 Fake Dictionary headword from the displayed word", () => {
	it("uses 病院 morphology after 猫 -> 病院, never 猫 reading or baseForm", () => {
		const slot = plan([chunkOf("chunk:1:0", "run:0", [CAT])], SWAP, MAX).slots[0]!;
		expect(slot.displaySurface).toBe("病院");
		expect(slot.dictionary.outcome).toBe("accepted");
		if (slot.dictionary.outcome !== "accepted") {
			return;
		}
		expect(slot.dictionary.headword.surface).toBe("病院");
		expect(slot.dictionary.headword.identity.reading).toBe("ビョウイン");
		expect(slot.dictionary.headword.identity.baseForm).toBe("病院");
		expect(slot.displayCandidate?.token.reading).toBe("ビョウイン");
		expect(slot.originalToken.reading).toBe("ネコ");
		expect(slot.dictionary.headword.identity.reading).not.toBe("ネコ");
		expect(slot.dictionary.headword.identity.baseForm).not.toBe("猫");
	});

	it("keeps pairless candidates as plain display", () => {
		const slot = plan([chunkOf("chunk:1:0", "run:0", [CAT])], SWAP, MAX).slots[0]!;
		expect(slot.automaticRuby).toBeNull();
		expect(slot.displayRuby).toBeNull();
	});

	it("uses the selected candidate's verified Ruby variant", () => {
		const rubyHospital = snapshot([
			{ token: CAT },
			{
				token: HOSPITAL,
				ruby: { range: { start: 0, end: 2 }, reading: "びょういん" },
			},
			{ token: PLACE },
			{ token: SAHEN },
		]);
		const slot = plan([chunkOf("chunk:1:0", "run:0", [CAT])], rubyHospital, MAX)
			.slots[0]!;
		expect(slot.displaySurface).toBe("病院");
		expect(slot.displayRuby?.reading).toBe("びょういん");
		expect(slot.displayRuby?.reading).not.toBe("ビョウイン");
		expect(slot.displayRuby?.variantId).toBe(
			slot.displayCandidate?.verifiedRubyVariants[0]?.variantId,
		);
	});

	it("accepts 名詞-形容動詞語幹 as a headword and as a noun Manual slot", () => {
		const slot = plan([chunkOf("chunk:1:0", "run:0", [NA_ADJ])], NA_SWAP, MAX)
			.slots[0]!;
		expect(slot.displaySurface).toBe("穏やか");
		expect(slot.manualEligible).toBe(true);
		expect(slot.dictionary.outcome).toBe("accepted");
		if (slot.dictionary.outcome !== "accepted") {
			return;
		}
		expect(slot.dictionary.headword.identity.detail1).toBe("形容動詞語幹");
		expect(slot.dictionary.headword.identity.reading).toBe("オダヤカ");
	});

	it("rejects verbs, particles and unknown words as dictionary headwords", () => {
		const result = plan(
			[chunkOf("chunk:1:0", "run:0", [VERB, PARTICLE, UNKNOWN])],
			SWAP,
			MAX,
		);
		expect(result.slots.map((slot) => slot.dictionary)).toEqual([
			{ outcome: "rejected", reason: "not-noun" },
			{ outcome: "rejected", reason: "not-noun" },
			{ outcome: "rejected", reason: "unknown" },
		]);
		expect(result.slots.every((slot) => slot.dictionaryEligible === false)).toBe(
			true,
		);
	});

	it("binds the selected candidate identity when two records share a surface", () => {
		const first = noun("病院", { reading: "ビョウイン", baseForm: "病院", detail2: "一般" });
		const second = noun("病院", { reading: "ゲンヨウ", baseForm: "病院", detail2: "別" });
		const vocabulary = snapshot([{ token: CAT }, { token: first }, { token: second }]);
		const slot = plan([chunkOf("chunk:1:0", "run:0", [CAT])], vocabulary, MAX)
			.slots[0]!;
		expect(slot.displaySurface).toBe("病院");
		expect(slot.dictionary.outcome).toBe("accepted");
		if (slot.dictionary.outcome !== "accepted" || !slot.displayCandidate) {
			return;
		}
		expect(slot.dictionary.headword.identity.reading).toBe(
			slot.displayCandidate.token.reading ?? null,
		);
		expect(slot.displayCandidate.candidateId).toBe(
			vocabularyCandidateId(slot.displayCandidate.token),
		);
		const other = slot.displayCandidate.token.reading === "ビョウイン" ? second : first;
		expect(slot.dictionary.headword.identity.reading).not.toBe(other.reading);
		expect(validateHeadword(slot.displaySurface, [other]).outcome).toBe("accepted");
	});
});

describe("TOK-03 identity, UTF-16 ranges and coverage", () => {
	it("treats the same spelling in one run as distinct occurrences", () => {
		const result = plan(
			[chunkOf("chunk:1:0", "run:0", [CAT, PARTICLE, CAT])],
			SWAP,
			MAX,
		);
		expect(result.slots).toHaveLength(3);
		expect(result.slots[0]!.tokenId).not.toBe(result.slots[2]!.tokenId);
		expect(result.slots[0]!.occurrence).toBe(0);
		expect(result.slots[2]!.occurrence).toBe(2);
		expect(result.slots[0]!.originalRange).toEqual({ start: 0, end: 1 });
		expect(result.slots[2]!.originalRange).toEqual({ start: 2, end: 3 });
	});

	it("keeps the same spelling distinct across runs and chunks", () => {
		const sameChunk = {
			chunkId: "chunk:1:0",
			runs: [
				...chunkOf("chunk:1:0", "run:0", [CAT]).runs,
				...chunkOf("chunk:1:0", "run:1", [CAT]).runs,
			],
		};
		const acrossRuns = plan([sameChunk], SWAP, MAX);
		expect(acrossRuns.slots[0]!.runId).toBe("run:0");
		expect(acrossRuns.slots[1]!.runId).toBe("run:1");
		expect(acrossRuns.slots[0]!.tokenId).not.toBe(acrossRuns.slots[1]!.tokenId);

		const acrossChunks = plan(
			[chunkOf("chunk:1:0", "run:0", [CAT]), chunkOf("chunk:1:1", "run:0", [CAT])],
			SWAP,
			MAX,
		);
		expect(acrossChunks.slots[0]!.chunkId).toBe("chunk:1:0");
		expect(acrossChunks.slots[1]!.chunkId).toBe("chunk:1:1");
		expect(acrossChunks.slots[0]!.tokenId).not.toBe(acrossChunks.slots[1]!.tokenId);
	});

	it("keeps later token ids when an automatic replacement changes length", () => {
		const shorter = plan(
			[chunkOf("chunk:1:0", "run:0", [HOSPITAL, PARTICLE])],
			snapshot([{ token: HOSPITAL }, { token: CAT }]),
			MAX,
		);
		const longer = plan(
			[chunkOf("chunk:1:0", "run:0", [CAT, PARTICLE])],
			SWAP,
			MAX,
		);
		expect(shorter.slots[0]!.displaySurface).toBe("猫");
		expect(shorter.slots[1]!.tokenId).toBe("chunk:1:0/run:0:token:1");
		expect(displayRangeOf(shorter, shorter.slots[1]!.tokenId)).toEqual({
			start: 1,
			end: 2,
		});
		expect(longer.slots[0]!.displaySurface).toBe("病院");
		expect(longer.slots[1]!.tokenId).toBe("chunk:1:0/run:0:token:1");
		expect(displayRangeOf(longer, longer.slots[1]!.tokenId)).toEqual({
			start: 2,
			end: 3,
		});
		expect(longer.slots[1]!.originalRange).toEqual({ start: 1, end: 2 });
	});

	it("counts emoji and surrogate pairs in UTF-16 units", () => {
		const emoji = noun("😔");
		const rare = noun("𠮷");
		expect(emoji.surface.length).toBe(2);
		expect(rare.surface.length).toBe(2);
		const result = plan(
			[chunkOf("chunk:1:0", "run:0", [emoji, rare, CAT])],
			SWAP,
			OFF,
		);
		expect(result.slots[0]!.originalRange).toEqual({ start: 0, end: 2 });
		expect(result.slots[1]!.originalRange).toEqual({ start: 2, end: 4 });
		expect(result.slots[2]!.originalRange).toEqual({ start: 4, end: 5 });
		expect(displayRangeOf(result, result.slots[2]!.tokenId)).toEqual({
			start: 4,
			end: 5,
		});
	});

	it("keeps one slot when a token would span inline decoration", () => {
		const important = noun("重要");
		const result = plan(
			[chunkOf("chunk:1:0", "run:0", [important])],
			snapshot([{ token: important }, { token: noun("大事") }]),
			MAX,
		);
		expect(result.slots).toHaveLength(1);
		expect(result.slots[0]!.originalRange).toEqual({ start: 0, end: 2 });
	});

	it("records overlapping Ruby ids without assigning a multi-token pair to one word", () => {
		const tokyo = noun("東京");
		const to = noun("都");
		const yomi = noun("読ん");
		const da = token({ surface: "だ", pos: "助動詞", detail1: "*", baseForm: "だ" });
		const multi = chunkOf("chunk:1:0", "run:0", [tokyo, to], [
			{ annotationId: "run:0:ruby:0", baseRange: { start: 0, end: 3 } },
		]);
		const okuri = chunkOf("chunk:1:1", "run:1", [yomi, da], [
			{ annotationId: "run:1:ruby:0", baseRange: { start: 0, end: 1 } },
		]);
		const result = plan([multi, okuri], SWAP, OFF);
		expect(result.slots[0]!.rubyAnnotationIds).toEqual(["run:0:ruby:0"]);
		expect(result.slots[1]!.rubyAnnotationIds).toEqual(["run:0:ruby:0"]);
		expect(result.slots[0]!.displayRuby).toBeNull();
		expect(result.slots[1]!.displayRuby).toBeNull();
		expect(result.slots).toHaveLength(4);
		expect(result.slots[2]!.rubyAnnotationIds).toEqual(["run:1:ruby:0"]);
		expect(result.slots[3]!.rubyAnnotationIds).toEqual([]);
		expect(result.slots[2]!.originalRange).toEqual({ start: 0, end: 2 });
	});

	it("does not turn rt / rp / ruby markers into tokens or headwords", () => {
		const kanji = noun("漢字", { reading: "カンジ" });
		const result = plan(
			[
				chunkOf("chunk:1:0", "run:0", [kanji], [
					{ annotationId: "run:0:ruby:0", baseRange: { start: 0, end: 2 } },
				]),
			],
			snapshot([{ token: kanji }]),
			OFF,
		);
		expect(result.slots.map((slot) => slot.displaySurface)).toEqual(["漢字"]);
		expect(result.slots[0]!.dictionary.outcome).toBe("accepted");
	});

	it("covers tokens before and after a protected gap without inventing its tokens", () => {
		const before = chunkOf("chunk:1:0", "run:0", [CAT]);
		const after = chunkOf("chunk:1:0", "run:2", [HOSPITAL]);
		const result = plan(
			[{ chunkId: "chunk:1:0", runs: [...before.runs, ...after.runs] }],
			SWAP,
			OFF,
		);
		expect(result.slots.map((slot) => slot.runId)).toEqual(["run:0", "run:2"]);
		expect(result.slots.map((slot) => slot.displaySurface)).toEqual(["猫", "病院"]);
	});

	it("covers each run in UTF-16 without searching the source text", () => {
		const source = readFileSync(new URL("../src/analysis/displaySlots.ts", import.meta.url), "utf8");
		expect(source).not.toMatch(/\.indexOf\s*\(/u);
		expect(source).not.toMatch(/\.lastIndexOf\s*\(/u);
		const text = [CAT, PARTICLE, HOSPITAL].map((item) => item.surface).join("");
		const result = plan(
			[chunkOf("chunk:1:0", "run:0", [CAT, PARTICLE, HOSPITAL])],
			SWAP,
			OFF,
		);
		expect(
			result.slots.map((slot) =>
				text.slice(slot.originalRange.start, slot.originalRange.end),
			).join(""),
		).toBe(text);
	});
});

describe("provenance, freeze and atomic rejection", () => {
	it("does not restamp an external transform onto another Chunk or revision", () => {
		const oldChunks = [chunkOf("chunk:1:0", "run:0", [CAT], [
			{ annotationId: "old-ruby", baseRange: { start: 0, end: 1 } },
		])];
		const newChunks = [chunkOf("new-chunk", "new-run", [CAT], [
			{ annotationId: "new-ruby", baseRange: { start: 0, end: 1 } },
		])];
		const withStaleTransform = {
			targetRevision: 999,
			displayRevision: 1,
			chunks: newChunks,
			snapshot: SWAP,
			bodySeed: 7,
			bodySemantropy: OFF,
			dictionarySemantropy: assertDictionarySemantropy(100),
			algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
			transform: plan(oldChunks, SWAP, MAX),
		};
		const restamped = planDisplaySlots(
			withStaleTransform as Parameters<typeof planDisplaySlots>[0],
		);
		const expected = plan(newChunks, SWAP, OFF, 7, 1, 999);
		expect(restamped).toEqual(expected);
		expect(restamped.slots[0]!.targetRevision).toBe(999);
		expect(restamped.slots[0]!.chunkId).toBe("new-chunk");
		expect(restamped.slots[0]!.runId).toBe("new-run");
		expect(restamped.slots[0]!.rubyAnnotationIds).toEqual(["new-ruby"]);
		expect(restamped.slots[0]!.automaticSurface).toBe("猫");
		expect(restamped.slots[0]!.automaticReplaced).toBe(false);
		expect(plan(oldChunks, SWAP, MAX).slots[0]!.automaticSurface).toBe("病院");
	});

	it("rejects duplicate run IDs in one Chunk before display ranges concatenate", () => {
		const duplicateRuns: DisplaySlotChunkInput = {
			chunkId: "chunk:1:0",
			runs: [
				{
					runId: "run:0",
					analysisText: "猫",
					annotations: [],
					tokens: [
						{
							tokenId: "token:a",
							range: { start: 0, end: 1 },
							token: CAT,
						},
					],
				},
				{
					runId: "run:0",
					analysisText: "が",
					annotations: [],
					tokens: [
						{
							tokenId: "token:b",
							range: { start: 0, end: 1 },
							token: PARTICLE,
						},
					],
				},
			],
		};
		expectRejected(() => plan([duplicateRuns], SWAP, OFF), "invalid-input");
	});

	it("rejects empty or duplicate annotation IDs and ranges outside the run", () => {
		expectRejected(
			() =>
				plan(
					[
						chunkOf("chunk:1:0", "run:0", [CAT], [
							{ annotationId: "", baseRange: { start: 0, end: 1 } },
						]),
					],
					SWAP,
					OFF,
				),
			"invalid-input",
		);
		expectRejected(
			() =>
				plan(
					[
						{
							chunkId: "chunk:1:0",
							runs: [
								{
									runId: "run:0",
									analysisText: "猫が",
									annotations: [
										{ annotationId: "ruby:0", baseRange: { start: 0, end: 1 } },
										{ annotationId: "ruby:0", baseRange: { start: 1, end: 2 } },
									],
									tokens: locate("run:0", [CAT, PARTICLE], "chunk:1:0").tokens,
								},
							],
						},
					],
					SWAP,
					OFF,
				),
			"invalid-input",
		);
		expectRejected(
			() =>
				plan(
					[
						chunkOf("chunk:1:0", "run:0", [CAT], [
							{ annotationId: "ruby:0", baseRange: { start: 0, end: 2 } },
						]),
					],
					SWAP,
					OFF,
				),
			"invalid-input",
		);
	});

	it("rejects a mismatched algorithm version and an invalid Dictionary value", () => {
		expectRejected(
			() =>
				planDisplaySlots({
					targetRevision: 1,
					displayRevision: 1,
					chunks: [chunkOf("chunk:1:0", "run:0", [CAT])],
					snapshot: SWAP,
					bodySeed: 7,
					bodySemantropy: MAX,
					dictionarySemantropy: assertDictionarySemantropy(100),
					algorithmVersion: 0 as typeof VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
				}),
			"incompatible-transform",
		);
		expectRejected(
			() =>
				planDisplaySlots({
					targetRevision: 1,
					displayRevision: 1,
					chunks: [chunkOf("chunk:1:0", "run:0", [CAT])],
					snapshot: SWAP,
					bodySeed: 7,
					bodySemantropy: MAX,
					dictionarySemantropy: -1,
					algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
				}),
			"invalid-input",
		);
	});

	it("plans independently for equal-fingerprint Snapshots and a different fingerprint", () => {
		const chunks = [chunkOf("chunk:1:0", "run:0", [CAT])];
		const twin = snapshot([
			{ token: CAT },
			{ token: HOSPITAL },
			{ token: PLACE },
			{ token: PERSON },
			{ token: ORG },
			{ token: SAHEN },
			{ token: ADVERB },
			{ token: NUMBER },
		]);
		expect(twin.fingerprint).toBe(SWAP.fingerprint);
		expect(plan(chunks, twin, MAX)).toEqual(plan(chunks, SWAP, MAX));
		expect(plan(chunks, SELF, MAX).slots[0]!.automaticReplaced).toBe(false);
		expect(plan(chunks, SWAP, MAX).slots[0]!.automaticReplaced).toBe(true);
	});

	it("does not mutate or freeze inputs, and deep-freezes the plan", () => {
		const original = noun("猫", { reading: "ネコ" });
		const chunks = [chunkOf("chunk:1:0", "run:0", [original])];
		const before = JSON.stringify(original);
		expect(Object.isFrozen(original)).toBe(false);
		expect(Object.isFrozen(chunks[0]!.runs[0]!.tokens[0]!.range)).toBe(false);
		const result = plan(chunks, SWAP, MAX);
		expect(JSON.stringify(original)).toBe(before);
		expect(Object.isFrozen(original)).toBe(false);
		expect(Object.isFrozen(chunks[0]!.runs[0]!.tokens[0]!.range)).toBe(false);
		expect(Object.isFrozen(SWAP)).toBe(true);
		assertDeepFrozen(result);
		expect(result.slots[0]!.originalToken).not.toBe(original);
		expect(result.policyVersion).toBe(DISPLAY_SLOT_POLICY_VERSION);
	});

	it("returns the same slot order and values for the same input", () => {
		const chunks = [chunkOf("chunk:1:0", "run:0", [CAT, PARTICLE, CAT])];
		expect(plan(chunks, SWAP, MAX)).toEqual(plan(chunks, SWAP, MAX));
	});

	it("does not generate slots for unloaded Chunks", () => {
		const materialized = chunkOf("chunk:1:0", "run:0", [CAT, PARTICLE]);
		const unloadedRemainder = "猫".repeat(100_000);
		const result = plan([materialized], SWAP, OFF);
		expect(result.slots).toHaveLength(2);
		const seen: string[] = [];
		const walk = (value: unknown): void => {
			if (typeof value === "string") {
				seen.push(value);
				return;
			}
			if (value === null || typeof value !== "object") {
				return;
			}
			for (const child of Object.values(value)) {
				walk(child);
			}
		};
		walk(result);
		expect(seen.some((item) => item.length === unloadedRemainder.length)).toBe(
			false,
		);
		expect(result.slots.reduce((sum, slot) => sum + slot.originalRange.end - slot.originalRange.start, 0)).toBe(
			2,
		);
	});

	it("keeps display as the identity of automatic until Manual override exists", () => {
		const slot = plan([chunkOf("chunk:1:0", "run:0", [CAT])], SWAP, MAX).slots[0]!;
		const automatic = {
			candidate: slot.automaticCandidate,
			surface: slot.automaticSurface,
			ruby: slot.automaticRuby,
		};
		expect(resolveDisplayLayer(automatic, null)).toEqual(automatic);
		expect(slot.displaySurface).toBe(slot.automaticSurface);
		expect(slot.displayCandidate).toEqual(slot.automaticCandidate);
		expectRejected(
			() =>
				resolveDisplayLayer(
					automatic,
					{ kind: "replacement" } as unknown as PendingManualOverride,
				),
			"invalid-input",
		);
	});
});
