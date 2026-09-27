import { describe, expect, it, vi } from "vitest";
import {
	buildCollectedFragment,
	validateFragmentInput,
	type BodyFragmentInput,
	type CollectFragmentInput,
	type CollectedFragment,
	type FakeDictionaryFragmentInput,
} from "../src/collect/CollectedFragment";
import {
	collectFragment,
	type CollectFragmentResult,
} from "../src/collect/CollectFragmentUseCase";
import {
	issueFragmentIdentity,
	webCryptoFragmentIdSource,
} from "../src/collect/fragmentIdentity";
import type {
	AppendFragmentResult,
	FragmentRepository,
} from "../src/collect/FragmentRepository";
import {
	bodyCollectInput,
	collisionCollectInput,
	collectPath,
	collectVocabulary,
	dictionaryCollectInput,
	COLLECT_FIXTURE_CREATED,
	COLLECT_FIXTURE_HASH,
	COLLECT_FIXTURE_ID,
} from "./collectFixtures";

const FIXED_ID = COLLECT_FIXTURE_ID;
const FIXED_CREATED = COLLECT_FIXTURE_CREATED;

const fixedId = () => FIXED_ID;
const fixedClock = () => new Date(FIXED_CREATED);

function bodyInput(
	overrides: Partial<BodyFragmentInput> = {},
): BodyFragmentInput {
	return bodyCollectInput({ algorithmVersion: 2, ...overrides });
}

function dictionaryInput(
	overrides: Partial<FakeDictionaryFragmentInput> = {},
): FakeDictionaryFragmentInput {
	return dictionaryCollectInput(overrides);
}

/** Records every append and answers with whatever the test asks for. */
function stubRepository(
	answer: () => Promise<AppendFragmentResult> = async () => ({
		status: "appended",
	}),
) {
	const appended: CollectedFragment[] = [];
	const append = vi.fn(async (fragment: CollectedFragment) => {
		appended.push(fragment);
		return await answer();
	});
	const repository: FragmentRepository = { append };
	return { repository, append, appended };
}

function collect(
	input: CollectFragmentInput,
	repository: FragmentRepository,
): Promise<CollectFragmentResult> {
	return collectFragment(input, {
		repository,
		newId: fixedId,
		now: fixedClock,
	});
}

describe("fragment model", () => {
	it("builds a body fragment with the shared metadata keys", () => {
		expect(validateFragmentInput(bodyInput())).toBeNull();

		const fragment = buildCollectedFragment(bodyInput(), {
			id: FIXED_ID,
			created: FIXED_CREATED,
		});

		expect(fragment.text).toBe("おかき的な自殺");
		expect(fragment.metadata).toEqual({
			id: FIXED_ID,
			metadataVersion: 2,
			type: "body",
			created: FIXED_CREATED,
			algorithmVersion: 2,
			target: collectPath("桜桃.md"),
			vocabulary: collectVocabulary(["桜桃.md"]),
			bodySemantropy: 50,
			hasManualEdits: false,
		});
		expect(fragment.metadata).not.toHaveProperty("seed");
		expect(fragment.metadata).not.toHaveProperty("bodySeed");
		expect(fragment.metadata).not.toHaveProperty("dictionarySeed");
		expect(fragment.metadata).not.toHaveProperty("semantropy");
		expect(fragment.metadata).not.toHaveProperty("sourcePath");
		expect(Object.isFrozen(fragment)).toBe(true);
		expect(Object.isFrozen(fragment.metadata)).toBe(true);
	});

	it("builds a fake-dictionary fragment from its own Semantropy value", () => {
		expect(validateFragmentInput(dictionaryInput())).toBeNull();

		const fragment = buildCollectedFragment(dictionaryInput(), {
			id: FIXED_ID,
			created: FIXED_CREATED,
		});

		expect(fragment.metadata).toEqual({
			id: FIXED_ID,
			metadataVersion: 2,
			type: "fake-dictionary",
			created: FIXED_CREATED,
			algorithmVersion: 1,
			target: collectPath("folder/note.md", "b".repeat(64)),
			vocabulary: collectVocabulary(["folder/note.md"], {
				sources: [collectPath("folder/note.md", "b".repeat(64))],
			}),
			dictionarySemantropy: 75,
			templateId: "core-noun-1",
			templateSetVersion: 1,
		});
		expect(fragment.metadata).not.toHaveProperty("seed");
		expect(fragment.metadata).not.toHaveProperty("bodySeed");
		expect(fragment.metadata).not.toHaveProperty("dictionarySeed");
		expect(fragment.metadata).not.toHaveProperty("semantropy");
		expect(fragment.metadata).not.toHaveProperty("sourcePath");
	});

	it("keeps a template id out of a body fragment", () => {
		// The union already forbids it; the cast is how a stray field would
		// actually arrive, and it must be refused rather than carried along.
		const contaminated = {
			...bodyInput(),
			templateId: "core-noun-1",
		} as unknown as BodyFragmentInput;

		expect(validateFragmentInput(contaminated)).toBe("invalid-template-id");

		const clean = buildCollectedFragment(bodyInput(), {
			id: FIXED_ID,
			created: FIXED_CREATED,
		});
		expect("templateId" in clean.metadata).toBe(false);
	});

	it("requires a non-empty template id for a fake-dictionary fragment", () => {
		for (const templateId of ["", "   ", "\n"]) {
			expect(validateFragmentInput(dictionaryInput({ templateId }))).toBe(
				"invalid-template-id",
			);
		}
		expect(
			validateFragmentInput(
				dictionaryInput({
					templateId: undefined as unknown as string,
				}),
			),
		).toBe("invalid-template-id");
	});

	it("rejects a fragment that is only whitespace", () => {
		for (const text of ["", " ", "\t", "\n", "\r\n", "  \n\t ", "　"]) {
			expect(validateFragmentInput(bodyInput({ text }))).toBe("empty-text");
		}
	});

	it("keeps a multi-line fragment whole, including its outer whitespace", () => {
		const text = " 彼女は海岸で\n\n昨日を飼っていた。 ";
		expect(validateFragmentInput(bodyInput({ text }))).toBeNull();

		const fragment = buildCollectedFragment(bodyInput({ text }), {
			id: FIXED_ID,
			created: FIXED_CREATED,
		});
		// Not summarized, not split into a sentence, not trimmed for tidiness.
		expect(fragment.text).toBe(text);
	});

	it("does not carry extra Seed properties into stored metadata", () => {
		const contaminatedBody = {
			...bodyInput(),
			bodySeed: 1170956989,
			dictionarySeed: 4294967295,
			seed: 3,
			nonce: 9,
			tokenSequences: ["秘密"],
			pool: { 猫: 1 },
			candidateId: "cand",
			displayFormId: "form",
			rubyReading: "よみ",
			sourcePath: "old.md",
			semantropy: 12,
		} as unknown as BodyFragmentInput;
		expect(validateFragmentInput(contaminatedBody)).toBeNull();
		const ownedVocabulary = contaminatedBody.vocabulary;
		const bodyFragment = buildCollectedFragment(contaminatedBody, {
			id: FIXED_ID,
			created: FIXED_CREATED,
		});
		expect(Object.isFrozen(ownedVocabulary)).toBe(false);
		expect(Object.isFrozen(ownedVocabulary.sources)).toBe(false);
		expect(JSON.stringify(bodyFragment.metadata)).not.toMatch(
			/"seed"|"bodySeed"|"dictionarySeed"|"nonce"|"tokenSequences"|"pool"|"candidateId"|"displayFormId"|"rubyReading"|"sourcePath"|"semantropy"/,
		);

		const contaminatedDictionary = {
			...dictionaryInput(),
			bodySeed: 1170956989,
			dictionarySeed: 4294967295,
			seed: 3,
		} as unknown as FakeDictionaryFragmentInput;
		expect(validateFragmentInput(contaminatedDictionary)).toBeNull();
		const dictionaryFragment = buildCollectedFragment(
			contaminatedDictionary,
			{ id: FIXED_ID, created: FIXED_CREATED },
		);
		expect(JSON.stringify(dictionaryFragment.metadata)).not.toMatch(
			/"seed"|"bodySeed"|"dictionarySeed"/,
		);
	});

	it("builds collision metadata without Target or Semantropy", () => {
		const input = collisionCollectInput();
		expect(validateFragmentInput(input)).toBeNull();
		const fragment = buildCollectedFragment(input, {
			id: FIXED_ID,
			created: FIXED_CREATED,
		});
		expect(fragment.metadata).toEqual({
			id: FIXED_ID,
			metadataVersion: 2,
			type: "collision",
			created: FIXED_CREATED,
			algorithmVersion: 1,
			vocabulary: collectVocabulary(["vocab-a.md", "vocab-b.md"]),
			patternId: "noun-sahen-1",
			patternSetVersion: 1,
			batchId: "batch-1",
			rowId: "row-1",
		});
		expect(fragment.metadata).not.toHaveProperty("target");
		expect(fragment.metadata).not.toHaveProperty("bodySemantropy");
		expect(fragment.metadata).not.toHaveProperty("dictionarySemantropy");
		expect(fragment.metadata).not.toHaveProperty("semantropy");
		expect(fragment.metadata).not.toHaveProperty("seed");
	});

	it("refuses cross-type fields on body, fake-dictionary and collision", () => {
		expect(
			validateFragmentInput({
				...bodyInput(),
				patternId: "x",
			} as unknown as BodyFragmentInput),
		).toBe("invalid-fragment-fields");
		expect(
			validateFragmentInput({
				...dictionaryInput(),
				hasManualEdits: true,
			} as unknown as FakeDictionaryFragmentInput),
		).toBe("invalid-manual-edits");
		expect(
			validateFragmentInput({
				...collisionCollectInput(),
				target: collectPath("target.md"),
			} as unknown as ReturnType<typeof collisionCollectInput>),
		).toBe("invalid-fragment-fields");
		expect(
			validateFragmentInput({
				...collisionCollectInput(),
				dictionarySemantropy: 50,
			} as unknown as ReturnType<typeof collisionCollectInput>),
		).toBe("invalid-fragment-fields");
	});

	it("requires Manual fields only when hasManualEdits is true", () => {
		expect(
			validateFragmentInput({
				...bodyInput(),
				hasManualEdits: false,
				manualAlgorithmVersion: 1,
			} as unknown as BodyFragmentInput),
		).toBe("invalid-manual-edits");
		expect(
			validateFragmentInput({
				...bodyInput(),
				hasManualEdits: true,
				manualAlgorithmVersion: 1,
				manualOverrides: [],
			}),
		).toBe("invalid-manual-edits");
		expect(
			validateFragmentInput({
				...bodyInput(),
				hasManualEdits: true,
				manualAlgorithmVersion: 1,
				manualOverrides: [
					{ tokenId: "token-1", kind: "replacement", localRevision: -1 },
				],
			} as unknown as BodyFragmentInput),
		).toBe("invalid-manual-edits");
		const withManual = bodyCollectInput({
			hasManualEdits: true,
			manualAlgorithmVersion: 1,
			manualOverrides: [
				{ tokenId: "token-1", kind: "replacement", localRevision: 2 },
			],
		});
		expect(validateFragmentInput(withManual)).toBeNull();
		const fragment = buildCollectedFragment(withManual, {
			id: FIXED_ID,
			created: FIXED_CREATED,
		});
		expect(fragment.metadata).toMatchObject({
			hasManualEdits: true,
			manualAlgorithmVersion: 1,
			manualOverrides: [
				{ tokenId: "token-1", kind: "replacement", localRevision: 2 },
			],
		});
		expect(JSON.stringify(fragment.metadata)).not.toMatch(
			/"candidateId"|"displayFormId"|"connectionKey"|"rubyVariantId"|"surface"/,
		);
	});

	it("rejects unknown metadata versions, broken Vocabulary provenance, and extra nested fields", async () => {
		expect(
			validateFragmentInput({
				...bodyInput(),
				metadataVersion: 1,
			} as unknown as BodyFragmentInput),
		).toBe("invalid-metadata-version");
		expect(
			validateFragmentInput(
				bodyInput({
					vocabulary: collectVocabulary([]),
				}),
			),
		).toBe("invalid-vocabulary-sources");
		expect(
			validateFragmentInput(
				bodyInput({
					vocabulary: collectVocabulary(["b.md", "a.md"], {
						sources: [collectPath("b.md"), collectPath("a.md")],
					}),
				}),
			),
		).toBe("invalid-vocabulary-sources");
		expect(
			validateFragmentInput(
				bodyInput({
					vocabulary: collectVocabulary(["a.md", "a.md"], {
						sources: [collectPath("a.md"), collectPath("a.md")],
					}),
				}),
			),
		).toBe("invalid-vocabulary-sources");
		expect(
			validateFragmentInput(
				bodyInput({
					vocabulary: collectVocabulary(["桜桃.md"], {
						fingerprint: COLLECT_FIXTURE_HASH,
					}),
				}),
			),
		).toBe("invalid-fingerprint");
		expect(
			validateFragmentInput(
				bodyInput({
					vocabulary: collectVocabulary(["桜桃.md"], {
						drawMode: "weighted" as never,
					}),
				}),
			),
		).toBe("invalid-draw-mode");
		expect(
			validateFragmentInput(
				collisionCollectInput({ patternId: "" }),
			),
		).toBe("invalid-pattern-id");
		expect(
			validateFragmentInput(
				collisionCollectInput({ patternSetVersion: 0 }),
			),
		).toBe("invalid-pattern-set-version");
		expect(
			validateFragmentInput(
				collisionCollectInput({ batchId: "  " }),
			),
		).toBe("invalid-batch-id");
		expect(
			validateFragmentInput(
				collisionCollectInput({ rowId: "" }),
			),
		).toBe("invalid-row-id");
		expect(
			validateFragmentInput({
				...bodyInput(),
				type: "mystery",
			} as never),
		).toBe("invalid-fragment-fields");

		const extraTarget = {
			...collectPath("桜桃.md"),
			seed: 9,
			candidateId: "leak",
		};
		const extraBody = bodyInput({
			target: extraTarget,
		});
		expect(validateFragmentInput(extraBody)).toBeNull();
		const built = buildCollectedFragment(extraBody, {
			id: FIXED_ID,
			created: FIXED_CREATED,
		});
		expect(JSON.stringify(built.metadata)).not.toMatch(
			/"seed"|"candidateId"/,
		);
		expect(Object.isFrozen(extraTarget)).toBe(false);
		expect(extraTarget.seed).toBe(9);

		const { repository, append } = stubRepository();
		const newId = vi.fn(() => FIXED_ID);
		expect(
			await collectFragment(
				bodyInput({
					vocabulary: collectVocabulary(["桜桃.md"], {
						fingerprint: "not-a-fingerprint",
					}),
				}),
				{ repository, newId, now: fixedClock },
			),
		).toEqual({ status: "invalid", reason: "invalid-fingerprint" });
		expect(newId).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
	});

	it("does not issue an identity when validation fails", async () => {
		const { repository, append } = stubRepository();
		const newId = vi.fn(() => FIXED_ID);
		expect(
			await collectFragment(bodyInput({ text: "   " }), {
				repository,
				newId,
				now: fixedClock,
			}),
		).toEqual({ status: "invalid", reason: "empty-text" });
		expect(newId).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
	});

	it("accepts only an integer Semantropy value in range", () => {
		for (const value of [0, 100, 37]) {
			expect(
				validateFragmentInput(
					bodyInput({ bodySemantropy: value as never }),
				),
			).toBeNull();
		}
		for (const value of [-1, 101, 0.5, Number.NaN, "high"]) {
			expect(
				validateFragmentInput(
					bodyInput({ bodySemantropy: value as never }),
				),
			).toBe("invalid-semantropy");
			expect(
				validateFragmentInput(
					dictionaryInput({ dictionarySemantropy: value as never }),
				),
			).toBe("invalid-semantropy");
		}
	});

	it("accepts only a lowercase 64-digit SHA-256 hex content hash", () => {
		expect(validateFragmentInput(bodyInput({ target: collectPath("桜桃.md", COLLECT_FIXTURE_HASH) }))).toBeNull();
		for (const contentHash of [
			"",
			"a".repeat(63),
			"a".repeat(65),
			"A".repeat(64),
			`${"a".repeat(63)}g`,
		]) {
			expect(validateFragmentInput(bodyInput({ target: collectPath("桜桃.md", contentHash) }))).toBe(
				"invalid-content-hash",
			);
		}
		expect(
			validateFragmentInput(
				bodyInput({
					target: { path: "桜桃.md", contentHash: undefined as unknown as string },
				}),
			),
		).toBe("invalid-content-hash");
	});

	it("accepts only a positive integer algorithm version", () => {
		for (const algorithmVersion of [1, 2, 99]) {
			expect(validateFragmentInput(bodyInput({ algorithmVersion }))).toBeNull();
		}
		for (const algorithmVersion of [0, -1, 1.5, Number.NaN]) {
			expect(validateFragmentInput(bodyInput({ algorithmVersion }))).toBe(
				"invalid-algorithm-version",
			);
		}
	});

	it("requires a Vault-relative target path", () => {
		for (const path of [
			"",
			"   ",
			"/absolute.md",
			"folder\\note.md",
			"../outside.md",
			"./note.md",
			"folder//note.md",
			"folder/",
			"note\0.md",
		]) {
			expect(validateFragmentInput(bodyInput({ target: collectPath(path) }))).toBe(
				"invalid-source-path",
			);
		}
		expect(
			validateFragmentInput(bodyInput({ target: collectPath("a/b/桜桃.md") })),
		).toBeNull();
	});
});

describe("fragment identity", () => {
	it("uses the injected id and clock, and never invents either", () => {
		const identity = issueFragmentIdentity(fixedId, fixedClock);
		expect(identity).toEqual({ id: FIXED_ID, created: FIXED_CREATED });
	});

	it("writes the creation time as UTC ISO 8601 whatever the offset", () => {
		const identity = issueFragmentIdentity(
			fixedId,
			() => new Date("2026-09-05T21:34:56+09:00"),
		);
		expect(identity.created).toBe("2026-09-05T12:34:56.000Z");
	});

	it("takes production ids from Web Crypto and fails without it", () => {
		const randomUUID = vi.fn(() => FIXED_ID);
		expect(webCryptoFragmentIdSource({ randomUUID })()).toBe(FIXED_ID);
		expect(randomUUID).toHaveBeenCalledTimes(1);

		// No Math.random fallback: an absent Web Crypto fails the Collect.
		expect(() => webCryptoFragmentIdSource({})()).toThrow();
		// The default really is the platform's Web Crypto, not a substitute.
		expect(webCryptoFragmentIdSource()()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it("refuses an id that is not a UUID and an unusable clock", () => {
		expect(() => issueFragmentIdentity(() => "not-a-uuid", fixedClock)).toThrow();
		expect(() =>
			issueFragmentIdentity(fixedId, () => new Date(Number.NaN)),
		).toThrow();
	});
});

describe("collectFragment", () => {
	it("stamps the injected id and time onto the stored entry", async () => {
		const { repository, appended } = stubRepository();

		expect(await collect(bodyInput(), repository)).toEqual({
			status: "appended",
		});
		expect(appended).toHaveLength(1);
		expect(appended[0]?.metadata.id).toBe(FIXED_ID);
		expect(appended[0]?.metadata.created).toBe(FIXED_CREATED);
	});

	it("appends exactly once per call and returns the repository's status", async () => {
		for (const status of ["created", "appended"] as const) {
			const { repository, append, appended } = stubRepository(async () => ({
				status,
			}));
			expect(await collect(bodyInput(), repository)).toEqual({ status });
			expect(append).toHaveBeenCalledTimes(1);
			expect(appended).toHaveLength(1);
		}

		const conflicted = stubRepository(async () => ({
			status: "conflict",
			reason: "folder",
		}));
		expect(await collect(bodyInput(), conflicted.repository)).toEqual({
			status: "conflict",
			reason: "folder",
		});
	});

	it("does not append at all when the input is invalid", async () => {
		const { repository, append } = stubRepository();
		expect(await collect(bodyInput({ text: "   " }), repository)).toEqual({
			status: "invalid",
			reason: "empty-text",
		});
		expect(append).not.toHaveBeenCalled();
	});

	it("never retries after the repository fails or throws", async () => {
		const failing = stubRepository(async () => ({ status: "failed" }));
		expect(await collect(bodyInput(), failing.repository)).toEqual({
			status: "failed",
		});
		expect(failing.append).toHaveBeenCalledTimes(1);

		const throwing = stubRepository(async () => {
			throw new Error("vault unavailable");
		});
		expect(await collect(bodyInput(), throwing.repository)).toEqual({
			status: "failed",
		});
		// One entry, one attempt: a resend could store the same id twice.
		expect(throwing.append).toHaveBeenCalledTimes(1);
	});

	it("collects the same text again as a separate entry", async () => {
		let issued = 0;
		const ids = [FIXED_ID, "99999999-8888-4777-8666-555555555555"];
		const { repository, appended } = stubRepository();

		for (let turn = 0; turn < 2; turn += 1) {
			await collectFragment(bodyInput(), {
				repository,
				newId: () => ids[issued++] ?? FIXED_ID,
				now: fixedClock,
			});
		}

		expect(appended).toHaveLength(2);
		expect(appended[0]?.text).toBe(appended[1]?.text);
		// Duplicates are the user's choice; only the identity separates them.
		expect(appended[0]?.metadata.id).not.toBe(appended[1]?.metadata.id);
	});

	it("fails the Collect when no id can be issued", async () => {
		const { repository, append } = stubRepository();
		const result = await collectFragment(bodyInput(), {
			repository,
			newId: webCryptoFragmentIdSource({}),
			now: fixedClock,
		});

		expect(result).toEqual({ status: "failed" });
		expect(append).not.toHaveBeenCalled();
	});
});

describe("collect messages", () => {
	it("uses one fixed message per outcome and leaks nothing", async () => {
		const {
			COLLECT_EMPTY_SELECTION_MESSAGE,
			COLLECT_FAILED_MESSAGE,
			COLLECT_PATH_NOT_MARKDOWN_MESSAGE,
			COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE,
			collectFragmentMessage,
		} = await import("../src/collect/collectMessages");

		expect(
			collectFragmentMessage({ status: "invalid", reason: "empty-text" }),
		).toBe(COLLECT_EMPTY_SELECTION_MESSAGE);
		expect(collectFragmentMessage({ status: "failed" })).toBe(
			COLLECT_FAILED_MESSAGE,
		);
		expect(
			collectFragmentMessage({ status: "conflict", reason: "non-markdown" }),
		).toBe(COLLECT_PATH_NOT_MARKDOWN_MESSAGE);
		expect(
			collectFragmentMessage({ status: "conflict", reason: "source-note" }),
		).toBe(COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE);

		const outcomes: CollectFragmentResult[] = [
			{ status: "created" },
			{ status: "appended" },
			{ status: "invalid", reason: "empty-text" },
			{ status: "invalid", reason: "invalid-content-hash" },
			{ status: "invalid-path" },
			{ status: "conflict", reason: "folder" },
			{ status: "conflict", reason: "non-markdown" },
			{ status: "conflict", reason: "parent-missing" },
			{ status: "conflict", reason: "source-note" },
			{ status: "failed" },
		];
		for (const outcome of outcomes) {
			const message = collectFragmentMessage(outcome);
			expect(message.length).toBeGreaterThan(0);
			expect(message).not.toMatch(/おかき|桜桃|1170956989|aaaa|\/Users\//);
		}
	});
});
