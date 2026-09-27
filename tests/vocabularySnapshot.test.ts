import { describe, expect, it, vi } from "vitest";
import {
	type RubyVocabulary,
	type VerifiedRubyVariant,
	type VocabularyCandidate,
	vocabularyCandidateId,
	vocabularyDisplayFormId,
} from "../src/analysis/rubyVocabulary";
import type { RubyNotation, Utf16Range } from "../src/analysis/rubyAnalysis";
import { TARGET_PRESENTATION_POLICY_VERSION } from "../src/analysis/projectMarkdownSource";
import { SOURCE_PROJECTION_POLICY_VERSION } from "../src/analysis/projectMarkdownSource";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { buildVocabularyPool, transformTokenSequences } from "../src/transform/transformTokens";
import {
	VOCABULARY_SNAPSHOT_ERROR_MESSAGE,
	VOCABULARY_FINGERPRINT_VERSION,
	VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
	VocabularySnapshotError,
	buildVocabularySnapshot,
	transformWithVocabularySnapshot,
	type AnalyzedVocabularySource,
	type VocabularySnapshot,
} from "../src/vocabulary/vocabularySnapshot";
import { MAX } from "./readyAnalysis";
import { token } from "./tokenFixtures";

type RubyOccurrence = {
	range: Utf16Range;
	reading: string;
	notation?: RubyNotation;
};

type Occurrence = {
	token: JapaneseToken;
	ruby?: RubyOccurrence;
};

function variantId(
	displayFormId: string,
	surface: string,
	ruby: RubyOccurrence,
): string {
	const base = surface.slice(ruby.range.start, ruby.range.end);
	return JSON.stringify([
		displayFormId,
		base.normalize("NFC"),
		ruby.reading.normalize("NFC"),
		ruby.range.start,
		ruby.range.end,
	]);
}

function analyzedSource(input: {
	path: string;
	hash: string;
	policy?: string;
	occurrences: readonly Occurrence[];
}): AnalyzedVocabularySource {
	const records = new Map<string, VocabularyCandidate>();
	for (const occurrence of input.occurrences) {
		const candidateId = vocabularyCandidateId(occurrence.token);
		const displayFormId = vocabularyDisplayFormId(
			candidateId,
			occurrence.token.surface,
		);
		const previous = records.get(displayFormId);
		let variants = [...(previous?.verifiedRubyVariants ?? [])];
		if (occurrence.ruby) {
			const id = variantId(
				displayFormId,
				occurrence.token.surface,
				occurrence.ruby,
			);
			const at = variants.findIndex((variant) => variant.variantId === id);
			const existing = variants[at];
			const next: VerifiedRubyVariant = {
				variantId: id,
				baseRangeInSurface: { ...occurrence.ruby.range },
				reading: occurrence.ruby.reading,
				sourceNotations: [occurrence.ruby.notation ?? "aozora-short"],
				frequency: (existing?.frequency ?? 0) + 1,
				origins: [
					{
						path: input.path,
						contentHash: input.hash,
						count: (existing?.frequency ?? 0) + 1,
					},
				],
			};
			if (existing) {
				next.sourceNotations = [
					...new Set([
						...existing.sourceNotations,
						...next.sourceNotations,
					]),
				];
				variants.splice(at, 1, next);
			} else {
				variants.push(next);
			}
		}
		const frequency = (previous?.frequency ?? 0) + 1;
		records.set(displayFormId, {
			candidateId,
			displayFormId,
			surface: occurrence.token.surface,
			token: { ...occurrence.token },
			frequency,
			origins: [
				{ path: input.path, contentHash: input.hash, count: frequency },
			],
			verifiedRubyVariants: variants,
		});
	}
	const tokens = input.occurrences.map((occurrence) => occurrence.token);
	const vocabulary: RubyVocabulary = {
		candidates: [...records.values()].sort((a, b) =>
			a.displayFormId < b.displayFormId ? -1 : 1,
		),
		fingerprint: "fixture-input-fingerprint",
		automaticBody: buildVocabularyPool([tokens]),
	};
	return {
		source: {
			path: input.path,
			contentHash: input.hash,
			projectionPolicy:
				input.policy ?? SOURCE_PROJECTION_POLICY_VERSION,
		},
		vocabulary,
	};
}

function noun(surface: string, overrides: Partial<JapaneseToken> = {}): Occurrence {
	return { token: token({ surface, ...overrides }) };
}

function rubyNoun(
	surface: string,
	reading: string,
	overrides: Partial<JapaneseToken> = {},
	range: Utf16Range = { start: 0, end: surface.length },
	notation: RubyNotation = "aozora-short",
): Occurrence {
	return {
		token: token({ surface, ...overrides }),
		ruby: { range, reading, notation },
	};
}

function snapshot(
	sources: readonly AnalyzedVocabularySource[],
	drawMode: "uniform" | "frequency" = "uniform",
): VocabularySnapshot {
	return buildVocabularySnapshot({ sources, drawMode });
}

function targetToken(surface: string, tokenId = "run:0:token:0") {
	return [[{ tokenId, token: token({ surface }) }]] as const;
}

function transform(
	vocabulary: VocabularySnapshot,
	surface: string,
	seed: number,
) {
	return transformWithVocabularySnapshot({
		tokenSequences: targetToken(surface),
		snapshot: vocabulary,
		bodySeed: seed,
		bodySemantropy: MAX,
		algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
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

describe("Vocabulary Snapshot Source transaction", () => {
	it("builds one Current Note Snapshot without changing production policy", () => {
		const current = analyzedSource({
			path: "Novel/Current.md",
			hash: "current-hash",
			policy: TARGET_PRESENTATION_POLICY_VERSION,
			occurrences: [noun("猫"), noun("犬"), noun("鳥")],
		});
		const result = snapshot([current]);

		expect(result.sources).toEqual([
			{
				path: "Novel/Current.md",
				contentHash: "current-hash",
				projectionPolicy: "target-presentation-2",
			},
		]);
		expect(
			result.projections.automaticBody.buckets[0]?.surfaces.map(
				(candidate) => candidate.surface,
			),
		).toEqual(["猫", "犬", "鳥"]);

		const legacy = transformTokenSequences(
			[[token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "鳥" })]],
			current.vocabulary.automaticBody,
			7,
			MAX,
			true,
		);
		const core = transformWithVocabularySnapshot({
			tokenSequences: [[
				{ tokenId: "run:0:token:0", token: token({ surface: "猫" }) },
				{ tokenId: "run:0:token:1", token: token({ surface: "犬" }) },
				{ tokenId: "run:0:token:2", token: token({ surface: "鳥" }) },
			]],
			snapshot: result,
			bodySeed: 7,
			bodySemantropy: MAX,
			algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
		});
		expect(core.texts).toEqual(legacy.texts);
		expect(core.tokenSurfaces).toEqual(legacy.tokenSurfaces);
	});

	it("builds one Selected Note Snapshot with its own projection policy", () => {
		const selected = analyzedSource({
			path: "Sources/Selected.md",
			hash: "selected-hash",
			occurrences: [noun("病院")],
		});
		const result = snapshot([selected]);

		expect(result.sources[0]?.projectionPolicy).toBe("source-projection-1");
		expect(result.candidates.map((candidate) => candidate.surface)).toEqual([
			"病院",
		]);
	});

	it("aggregates frequency and canonical origins across multiple Sources", () => {
		const a = analyzedSource({
			path: "A.md",
			hash: "hash-a",
			occurrences: [noun("猫"), noun("猫")],
		});
		const b = analyzedSource({
			path: "B.md",
			hash: "hash-b",
			occurrences: [noun("猫"), noun("犬")],
		});
		const result = snapshot([b, a]);
		const cat = result.candidates.find((candidate) => candidate.surface === "猫")!;

		expect(result.sources.map((source) => source.path)).toEqual(["A.md", "B.md"]);
		expect(cat.frequency).toBe(3);
		expect(cat.origins).toEqual([
			{ path: "A.md", contentHash: "hash-a", count: 2 },
			{ path: "B.md", contentHash: "hash-b", count: 1 },
		]);
	});

	it("deduplicates an identical normalized path without double counting", () => {
		const source = analyzedSource({
			path: "Folder/Source.md",
			hash: "same-hash",
			occurrences: [noun("猫"), noun("猫")],
		});
		const result = snapshot([source, source]);

		expect(result.sources).toHaveLength(1);
		expect(result.candidates[0]?.frequency).toBe(2);
		expect(result.candidates[0]?.origins[0]?.count).toBe(2);
	});

	it("does not case-fold Vault paths", () => {
		const upper = analyzedSource({
			path: "Notes/Story.md",
			hash: "upper",
			occurrences: [noun("猫")],
		});
		const lower = analyzedSource({
			path: "notes/Story.md",
			hash: "lower",
			occurrences: [noun("犬")],
		});
		const result = snapshot([lower, upper]);

		expect(result.sources.map((source) => source.path)).toEqual([
			"Notes/Story.md",
			"notes/Story.md",
		]);
	});

	it("atomically rejects the same path with different content hashes", () => {
		const oldSource = analyzedSource({
			path: "Source.md",
			hash: "old-hash",
			occurrences: [noun("猫")],
		});
		const newSource = analyzedSource({
			path: "Source.md",
			hash: "new-hash",
			occurrences: [noun("犬")],
		});

		expect(() => snapshot([oldSource, newSource])).toThrow(
			VOCABULARY_SNAPSHOT_ERROR_MESSAGE,
		);
		try {
			snapshot([oldSource, newSource]);
		} catch (error) {
			expect(error).toBeInstanceOf(VocabularySnapshotError);
			expect((error as VocabularySnapshotError).code).toBe(
				"conflicting-source",
			);
		}
	});

	it("is identical when Source input and Map insertion orders are reversed", () => {
		const a = analyzedSource({
			path: "A.md",
			hash: "a",
			occurrences: [
				noun("東京", { detail1: "固有名詞", detail2: "地域" }),
				noun("猫"),
			],
		});
		const b = analyzedSource({
			path: "B.md",
			hash: "b",
			occurrences: [noun("病院"), noun("犬")],
		});
		const reversedMap = new Map([...a.vocabulary.automaticBody].reverse());
		const aWithReversedMap = {
			...a,
			vocabulary: { ...a.vocabulary, automaticBody: reversedMap },
		};

		const forward = snapshot([a, b]);
		const reversed = snapshot([b, aWithReversedMap]);
		expect(reversed).toEqual(forward);
		expect(reversed.fingerprint).toBe(forward.fingerprint);
		for (let seed = 0; seed < 32; seed += 1) {
			expect(transform(reversed, "猫", seed)).toEqual(
				transform(forward, "猫", seed),
			);
		}
	});
});

describe("candidate, Ruby and typed projection aggregation", () => {
	it("retains the same surface under distinct candidate identities", () => {
		const source = analyzedSource({
			path: "Source.md",
			hash: "hash",
			occurrences: [
				noun("言葉", { reading: "コトバ" }),
				noun("言葉", { reading: "ゲンヨウ" }),
			],
		});
		const result = snapshot([source]);
		const surface = result.projections.automaticBody.buckets[0]?.surfaces[0];

		expect(result.candidates).toHaveLength(2);
		expect(new Set(result.candidates.map((item) => item.candidateId)).size).toBe(2);
		expect(surface?.surface).toBe("言葉");
		expect(surface?.frequency).toBe(2);
		expect(surface?.candidates).toHaveLength(2);
	});

	it("keeps NFC-equivalent raw display forms and Ruby ranges separate", () => {
		const source = analyzedSource({
			path: "Source.md",
			hash: "hash",
			occurrences: [
				rubyNoun(
					"か\u3099",
					"が",
					{ baseForm: "が", reading: "ガ" },
					{ start: 0, end: 2 },
				),
				noun("が", { baseForm: "が", reading: "ガ" }),
			],
		});
		const result = snapshot([source]);

		expect(result.candidates).toHaveLength(2);
		expect(new Set(result.candidates.map((item) => item.candidateId)).size).toBe(1);
		expect(new Set(result.candidates.map((item) => item.displayFormId)).size).toBe(2);
		expect(
			result.candidates.find((candidate) => candidate.surface === "が")
				?.verifiedRubyVariants,
		).toEqual([]);
		expect(
			result.candidates.find((candidate) => candidate.surface.length === 2)
				?.verifiedRubyVariants[0]?.baseRangeInSurface,
		).toEqual({ start: 0, end: 2 });
	});

	it("aggregates Ruby frequency, origins and canonical notation without mixing pairs", () => {
		const a = analyzedSource({
			path: "A.md",
			hash: "a",
			occurrences: [
				rubyNoun("言葉", "ことば"),
				rubyNoun("言葉", "ことば"),
			],
		});
		const b = analyzedSource({
			path: "B.md",
			hash: "b",
			occurrences: [rubyNoun("言葉", "ことば", {}, undefined, "html")],
		});
		const result = snapshot([b, a]);
		const variant = result.candidates[0]?.verifiedRubyVariants[0];

		expect(variant?.frequency).toBe(3);
		expect(variant?.sourceNotations).toEqual(["aozora-short", "html"]);
		expect(variant?.origins).toEqual([
			{ path: "A.md", contentHash: "a", count: 2 },
			{ path: "B.md", contentHash: "b", count: 1 },
		]);
	});

	it("never lets a plain identity borrow another record's Ruby variant", () => {
		const source = analyzedSource({
			path: "Source.md",
			hash: "hash",
			occurrences: [
				noun("病院", { reading: "plain-record" }),
				rubyNoun("病院", "びょういん", { reading: "ruby-record" }),
			],
		});
		const result = snapshot([source]);
		const records = new Map(
			result.candidates.map((candidate) => [candidate.displayFormId, candidate]),
		);
		const seen = new Set<string>();
		for (let seed = 0; seed < 64; seed += 1) {
			const selected = transform(result, "猫", seed).selections[0]?.[0];
			expect(selected).not.toBeNull();
			const record = records.get(selected!.candidate.displayFormId)!;
			seen.add(record.token.reading ?? "");
			expect(selected!.rubyVariant).toEqual(
				record.verifiedRubyVariants[0] ?? null,
			);
		}
		expect(seen).toEqual(new Set(["plain-record", "ruby-record"]));
	});

	it("builds four distinct, data-bearing projections", () => {
		const source = analyzedSource({
			path: "Source.md",
			hash: "hash",
			occurrences: [
				noun("猫"),
				noun("研究", { detail1: "サ変接続" }),
				noun("本日", { detail1: "副詞可能" }),
				noun("未知", { isUnknown: true }),
				{ token: token({ surface: "歩く", pos: "動詞", detail1: "自立" }) },
			],
		});
		const result = snapshot([source]);

		expect(
			result.projections.automaticBody.buckets.flatMap((bucket) =>
				bucket.surfaces.map((candidate) => candidate.surface),
			).sort(),
		).toEqual(["猫", "研究"].sort());
		expect(
			result.projections.manual.candidates.find(
				(candidate) => candidate.surface === "歩く",
			)?.morphology,
		).toMatchObject({ pos: "動詞", detail1: "自立" });
		expect(
			result.projections.dictionary.byPlaceholder.adverbialNoun.map(
				(candidate) => candidate.surface,
			),
		).toEqual(["本日"]);
		expect(
			result.projections.collision.nouns.map((candidate) => candidate.surface),
		).toEqual(["猫"]);
		expect(
			result.projections.collision.sahenNouns.map(
				(candidate) => candidate.surface,
			),
		).toEqual(["研究"]);
	});

	it("rejects contradictory token and Ruby records without guessing", () => {
		const good = analyzedSource({
			path: "A.md",
			hash: "a",
			occurrences: [rubyNoun("言葉", "ことば")],
		});
		const badToken = structuredClone(good);
		badToken.source.path = "B.md";
		badToken.source.contentHash = "b";
		badToken.vocabulary.candidates[0]!.origins = [
			{ path: "B.md", contentHash: "b", count: 1 },
		];
		badToken.vocabulary.candidates[0]!.token.detail1 = "固有名詞";
		expect(() => snapshot([good, badToken])).toThrow(
			VOCABULARY_SNAPSHOT_ERROR_MESSAGE,
		);

		const badRuby = structuredClone(good);
		badRuby.source.path = "B.md";
		badRuby.source.contentHash = "b";
		badRuby.vocabulary.candidates[0]!.origins = [
			{ path: "B.md", contentHash: "b", count: 1 },
		];
		const ruby = badRuby.vocabulary.candidates[0]!.verifiedRubyVariants[0]!;
		ruby.origins = [{ path: "B.md", contentHash: "b", count: 1 }];
		ruby.reading = "矛盾する読み";
		expect(() => snapshot([good, badRuby])).toThrow(
			VOCABULARY_SNAPSHOT_ERROR_MESSAGE,
		);
	});
});

describe("Uniform / Frequency Snapshot transform seam", () => {
	it("does not increase Uniform surface probability for repeated records", () => {
		const balanced = snapshot([
			analyzedSource({
				path: "Source.md",
				hash: "balanced",
				occurrences: [noun("犬"), noun("病院")],
			}),
		]);
		const repeated = snapshot([
			analyzedSource({
				path: "Source.md",
				hash: "repeated",
				occurrences: [
					...Array.from({ length: 20 }, () => noun("犬")),
					noun("病院"),
				],
			}),
		]);

		for (let seed = 0; seed < 128; seed += 1) {
			expect(transform(repeated, "猫", seed).texts).toEqual(
				transform(balanced, "猫", seed).texts,
			);
		}
	});

	it("weights Frequency by total Source Set occurrence count", () => {
		const frequent = snapshot(
			[
				analyzedSource({
					path: "A.md",
					hash: "a",
					occurrences: Array.from({ length: 9 }, () => noun("犬")),
				}),
				analyzedSource({
					path: "B.md",
					hash: "b",
					occurrences: [noun("病院")],
				}),
			],
			"frequency",
		);
		let dogs = 0;
		for (let seed = 0; seed < 512; seed += 1) {
			if (transform(frequent, "猫", seed).texts[0] === "犬") {
				dogs += 1;
			}
		}
		expect(dogs).toBeGreaterThan(420);
	});

	it("replaces from one external candidate and preserves self-only input", () => {
		const vocabulary = snapshot([
			analyzedSource({
				path: "External.md",
				hash: "external",
				occurrences: [noun("病院")],
			}),
		]);

		expect(transform(vocabulary, "猫", 0)).toMatchObject({
			texts: ["病院"],
			replacementCount: 1,
			replaceableSlotCount: 1,
		});
		expect(transform(vocabulary, "病院", 0)).toMatchObject({
			texts: ["病院"],
			replacementCount: 0,
			replaceableSlotCount: 0,
		});
	});

	it("does not fallback for an unknown, ineligible or mismatched pool", () => {
		const vocabulary = snapshot([
			analyzedSource({
				path: "Source.md",
				hash: "hash",
				occurrences: [
					noun("病院"),
					noun("東京", { detail1: "固有名詞", detail2: "地域" }),
				],
			}),
		]);
		const tokenSequences = [[
			{ tokenId: "unknown", token: token({ surface: "未知", isUnknown: true }) },
			{ tokenId: "particle", token: token({ surface: "は", pos: "助詞" }) },
			{
				tokenId: "person",
				token: token({
					surface: "太郎",
					detail1: "固有名詞",
					detail2: "人名",
				}),
			},
		]];
		const result = transformWithVocabularySnapshot({
			tokenSequences,
			snapshot: vocabulary,
			bodySeed: 1,
			bodySemantropy: MAX,
			algorithmVersion: VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION,
		});

		expect(result.texts).toEqual(["未知は太郎"]);
		expect(result.replaceableSlotCount).toBe(0);
	});

	it("is deterministic for the same Snapshot, Seed, value and algorithm", () => {
		const vocabulary = snapshot(
			[
				analyzedSource({
					path: "Source.md",
					hash: "hash",
					occurrences: [noun("犬"), rubyNoun("病院", "びょういん")],
				}),
			],
			"frequency",
		);
		const first = transform(vocabulary, "猫", 27);
		const second = transform(vocabulary, "猫", 27);

		expect(second).toEqual(first);
		assertDeepFrozen(first);
	});
});

describe("fingerprint, immutability and privacy", () => {
	it("returns a fixed-length versioned digest without vocabulary plaintext", () => {
		const secretPath = "Private/SECRET-PATH.md";
		const secretSurface = "SECRET-SURFACE";
		const secretTokenReading = "SECRET-TOKEN-READING";
		const secretRubyReading = "SECRET-RUBY-READING";
		const one = snapshot([
			analyzedSource({
				path: secretPath,
				hash: "secret-hash",
				occurrences: [
					rubyNoun(secretSurface, secretRubyReading, {
						reading: secretTokenReading,
					}),
				],
			}),
		]);
		const many = snapshot([
			analyzedSource({
				path: "Many.md",
				hash: "many-hash",
				occurrences: Array.from({ length: 256 }, (_, index) =>
					noun(`candidate-${index}`),
				),
			}),
		]);
		const expectedPattern = new RegExp(
			`^${VOCABULARY_FINGERPRINT_VERSION}:[0-9a-f]{64}$`,
			"u",
		);

		expect(one.fingerprint).toMatch(expectedPattern);
		expect(many.fingerprint).toMatch(expectedPattern);
		expect(many.fingerprint).toHaveLength(one.fingerprint.length);
		for (const plaintext of [
			secretPath,
			secretSurface,
			secretTokenReading,
			secretRubyReading,
		]) {
			expect(one.fingerprint).not.toContain(plaintext);
		}
	});

	it("is the same digest for the same canonical input", () => {
		const source = analyzedSource({
			path: "Source.md",
			hash: "hash",
			occurrences: [rubyNoun("言葉", "ことば"), noun("犬")],
		});

		expect(snapshot([structuredClone(source)]).fingerprint).toBe(
			snapshot([source]).fingerprint,
		);
	});

	it("changes for draw mode, frequency, hash, identity and Ruby variant", () => {
		const base = analyzedSource({
			path: "Source.md",
			hash: "hash-a",
			occurrences: [rubyNoun("言葉", "ことば"), noun("犬")],
		});
		const uniform = snapshot([base]);
		const frequency = snapshot([base], "frequency");
		const repeated = snapshot([
			analyzedSource({
				path: "Source.md",
				hash: "hash-a",
				occurrences: [
					rubyNoun("言葉", "ことば"),
					noun("犬"),
					noun("犬"),
				],
			}),
		]);
		const changedHash = snapshot([
			analyzedSource({
				path: "Source.md",
				hash: "hash-b",
				occurrences: [rubyNoun("言葉", "ことば"), noun("犬")],
			}),
		]);
		const changedRuby = snapshot([
			analyzedSource({
				path: "Source.md",
				hash: "hash-a",
				occurrences: [rubyNoun("言葉", "げんよう"), noun("犬")],
			}),
		]);
		const changedIdentity = snapshot([
			analyzedSource({
				path: "Source.md",
				hash: "hash-a",
				occurrences: [
					rubyNoun("言葉", "ことば"),
					noun("犬", { reading: "イヌ別identity" }),
				],
			}),
		]);

		for (const changed of [
			frequency,
			repeated,
			changedHash,
			changedIdentity,
			changedRuby,
		]) {
			expect(changed.fingerprint).not.toBe(uniform.fingerprint);
		}
	});

	it("deep-freezes the result and never changes or freezes input records", () => {
		const source = analyzedSource({
			path: "Source.md",
			hash: "hash",
			occurrences: [rubyNoun("言葉", "ことば"), noun("犬")],
		});
		const before = structuredClone(source);
		const result = snapshot([source]);

		expect(source).toEqual(before);
		expect(Object.isFrozen(source)).toBe(false);
		expect(Object.isFrozen(source.vocabulary.candidates[0])).toBe(false);
		assertDeepFrozen(result);
	});

	it("uses fixed errors and never logs Source text, path or Ruby reading", () => {
		const secret = "SECRET-SOURCE-BODY-READING";
		const first = analyzedSource({
			path: "Private/Secret.md",
			hash: "old",
			occurrences: [rubyNoun("言葉", secret)],
		});
		const second = analyzedSource({
			path: "Private/Secret.md",
			hash: "new",
			occurrences: [rubyNoun("言葉", secret)],
		});
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		let caught: unknown;
		try {
			snapshot([first, second]);
		} catch (value) {
			caught = value;
		}
		expect(caught).toBeInstanceOf(VocabularySnapshotError);
		expect((caught as Error).message).toBe(VOCABULARY_SNAPSHOT_ERROR_MESSAGE);
		expect((caught as Error).message).not.toContain(secret);
		expect((caught as Error).message).not.toContain("Private/Secret.md");
		expect(error).not.toHaveBeenCalled();
		error.mockRestore();
	});
});
