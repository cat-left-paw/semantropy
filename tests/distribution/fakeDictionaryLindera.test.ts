import { beforeAll, describe, expect, it } from "vitest";
import { generateFakeDefinition } from "../../src/dictionary/generateFakeDefinition";
import {
	headwordIdentity,
	validateHeadword,
} from "../../src/dictionary/headword";
import { runDefineSelectedWord } from "../../src/application/defineSelectedWord";
import { assertDictionarySemantropy } from "../../src/settings/dictionarySemantropy";
import {
	classifyPlaceholder,
	type FakeDictionaryPlaceholder,
} from "../../src/dictionary/placeholders";
import { buildDictionaryVocabularyPool } from "../../src/dictionary/vocabularyPool";
import {
	buildTokenize,
	compactDictionaryDir,
	initLindera,
	type Tokenize,
} from "./linderaFixture";

/**
 * The Fake Dictionary against the real compact IPADIC.
 *
 * Lindera is the source of record for classification: these expectations are
 * what the shipped dictionary actually returns, not what another analyzer
 * would. Nothing here compares against Kuromoji, and a difference from it is
 * not a defect.
 */
let tokenize: Tokenize;

beforeAll(async () => {
	await initLindera();
	tokenize = buildTokenize(compactDictionaryDir());
});

/** A sentence holding at least one word for every placeholder in use. */
const NOTE =
	"本日、太郎は東京でソニーの研究を三回した。猫が机にいる。";

describe("headword classification on the real dictionary", () => {
	const cases: readonly [string, FakeDictionaryPlaceholder][] = [
		["太郎", "person"],
		["東京", "place"],
		["ソニー", "organization"],
		["研究", "sahen"],
		["本日", "adverbialNoun"],
		["三", "number"],
		["猫", "noun"],
		["机", "noun"],
	];

	for (const [word, placeholder] of cases) {
		it(`classifies ${word} as ${placeholder}`, () => {
			const tokens = tokenize(word);

			expect(tokens).toHaveLength(1);
			const result = validateHeadword(word, tokens);
			expect(result.outcome).toBe("accepted");
			if (result.outcome !== "accepted") return;
			expect(result.headword.classification).toBe(placeholder);
			expect(classifyPlaceholder(tokens[0]!)).toBe(placeholder);
		});
	}
});

describe("identity on the real dictionary", () => {
	it("keeps the base form and reading the dictionary records", () => {
		expect(headwordIdentity(tokenize("研究")[0]!)).toEqual({
			baseForm: "研究",
			reading: "ケンキュウ",
			pos: "名詞",
			detail1: "サ変接続",
			detail2: "*",
		});
	});

	it("falls back to the surface where the compact dictionary keeps neither", () => {
		// 名詞-副詞可能 and 名詞-数 sit outside the four exchangeable noun
		// classes, so the compact build drops their base form and reading. The
		// headword must still work.
		for (const word of ["本日", "三"]) {
			const one = tokenize(word)[0]!;

			expect(one.baseForm).toBe("*");
			expect(one.reading).toBeUndefined();
			expect(headwordIdentity(one)).toMatchObject({
				baseForm: word,
				reading: null,
			});
		}
	});
});

describe("the vocabulary pool on the real dictionary", () => {
	it("fills each placeholder from one ordinary sentence", () => {
		const pool = buildDictionaryVocabularyPool([tokenize(NOTE)]);

		expect(pool.person).toEqual(["太郎"]);
		expect(pool.place).toEqual(["東京"]);
		expect(pool.organization).toEqual(["ソニー"]);
		expect(pool.sahen).toEqual(["研究"]);
		expect(pool.noun).toEqual(["猫", "机"]);
	});

	it("admits 副詞可能 and 数 even with no base form or reading", () => {
		const pool = buildDictionaryVocabularyPool([tokenize(NOTE)]);

		expect(pool.adverbialNoun).toEqual(["本日"]);
		expect(pool.number).toEqual(["三"]);
	});

	it("excludes the classes the standard templates rule out", () => {
		const pool = buildDictionaryVocabularyPool([tokenize(NOTE)]);
		const everything = Object.values(pool).flat();

		// 回 is 名詞-接尾-助数詞; particles, verbs and punctuation are not nouns.
		for (const excluded of ["回", "は", "で", "の", "を", "し", "た", "。", "、", "いる"]) {
			expect(everything).not.toContain(excluded);
		}
	});

	it("rejects an unknown word as a headword", () => {
		const invented = "ズヌガレポ";
		const tokens = tokenize(invented);

		const result = validateHeadword(invented, tokens);

		expect(result.outcome).toBe("rejected");
	});
});

describe("generation on the real dictionary", () => {
	it("produces a definition and repeats it exactly", () => {
		const pool = buildDictionaryVocabularyPool([tokenize(NOTE)]);
		const validated = validateHeadword("猫", tokenize("猫"));
		expect(validated.outcome).toBe("accepted");
		if (validated.outcome !== "accepted") return;

		const request = {
			headword: validated.headword,
			pool,
			dictionarySeed: 1170956989,
			dictionarySemantropy: 100,
		};
		const first = generateFakeDefinition(request);
		const second = generateFakeDefinition(request);

		expect(first.outcome).toBe("generated");
		if (first.outcome !== "generated") return;
		expect(second).toEqual(first);
		expect(first.definition).not.toContain("{{");
		expect(first.definition.length).toBeGreaterThan(0);
	});

	it("gives the same headword the same definition from a re-ordered note", () => {
		// The same three fragments, analysed in opposite orders — as a rebuilt
		// DOM would present them. The candidate sets are identical, so the
		// definition must be too, even though the pools list them differently.
		const fragments = ["猫が鳴く。", "机がある。", "本日、太郎は東京でソニーの研究を三回した。"];
		const forward = buildDictionaryVocabularyPool(fragments.map(tokenize));
		const reversed = buildDictionaryVocabularyPool(
			[...fragments].reverse().map(tokenize),
		);
		const validated = validateHeadword("太郎", tokenize("太郎"));
		expect(validated.outcome).toBe("accepted");
		if (validated.outcome !== "accepted") return;

		const of = (pool: typeof forward) =>
			generateFakeDefinition({
				headword: validated.headword,
				pool,
				dictionarySeed: 4242,
				dictionarySemantropy: 75,
			});

		expect(forward.noun).toEqual(["猫", "机"]);
		expect(reversed.noun).toEqual(["机", "猫"]);
		expect(of(reversed)).toEqual(of(forward));
	});

	it("reports insufficient vocabulary for a note with no usable noun", () => {
		const pool = buildDictionaryVocabularyPool([tokenize("それはこれである。")]);
		const validated = validateHeadword("猫", tokenize("猫"));
		expect(validated.outcome).toBe("accepted");
		if (validated.outcome !== "accepted") return;

		const result = generateFakeDefinition({
			headword: validated.headword,
			pool,
			dictionarySeed: 1,
			dictionarySemantropy: 50,
		});

		expect(result.outcome).toBe("insufficient-vocabulary");
	});
});

describe("Define coordinator on the real dictionary", () => {
	it("turns a selected word into a definition from snapshot sequences only", async () => {
		const snapshot = {
			sourcePath: "notes/smoke.md",
			contentHash: "ab".repeat(32),
		};
		const tokenSequences = [tokenize(NOTE)];
		let tokenizeCalls = 0;
		const result = await runDefineSelectedWord({
			selection: "猫",
			snapshot,
			tokenSequences,
			dictionarySeed: 1170956989,
			dictionarySemantropy: assertDictionarySemantropy(100),
			getTokenizer: () => ({
				tokenize: async (text) => {
					tokenizeCalls += 1;
					expect(text).toBe("猫");
					return tokenize(text);
				},
			}),
			isCurrent: () => true,
			getSnapshotIdentity: () => snapshot,
		});
		expect(tokenizeCalls).toBe(1);
		expect(result.status).toBe("ready");
		if (result.status !== "ready") {
			return;
		}
		expect(result.result.outcome).toBe("generated");
		if (result.result.outcome !== "generated") {
			return;
		}
		expect(result.result.definition.length).toBeGreaterThan(0);
		expect(result.result.templateId.length).toBeGreaterThan(0);
		expect(result.result.dictionarySeed).toBe(1170956989);
		expect(
			generateFakeDefinition({
				headword: result.headword,
				pool: result.pool,
				dictionarySeed: 1170956989,
				dictionarySemantropy: 100,
			}),
		).toEqual(result.result);
	});
});
