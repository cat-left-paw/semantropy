import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	DETAIL_SLOT_COUNT,
	SLOT_BASE_FORM,
	SLOT_CONJUGATION_FORM,
	SLOT_CONJUGATION_TYPE,
	SLOT_DETAIL1,
	SLOT_DETAIL2,
	SLOT_DETAIL3,
	SLOT_POS,
	SLOT_PRONUNCIATION,
	SLOT_READING,
	splitWordRecord,
} from "../../scripts/lindera/compactDictionary.mjs";
import { vocabularyCandidateId } from "../../src/analysis/rubyVocabulary";
import { evaluateAdverbCandidate } from "../../src/adverb/adverbCapability";
import {
	ADVERB_CLASSES,
	ADVERB_POS,
	adverbProfileIdentityKey,
	classifyAdverbCandidate,
} from "../../src/adverb/adverbFamily";
import {
	ADVERB_CLAUSE_FINAL_AUXILIARY_SURFACES,
	ADVERB_COPULA_SURFACES,
	ADVERB_NEGATIVE_AUXILIARY_SURFACES,
	ADVERB_STANDALONE_VERB_FORMS,
	buildAdverbObservationIndex,
	observeAdverbSlot,
} from "../../src/adverb/adverbObservation";
import { TO_OPTIONAL_ADVERB_BRIDGE_PROFILE } from "../../src/adverb/adverbBridgeProfile";
import type { JapaneseToken } from "../../src/tokenizer/JapaneseTokenizer";
import {
	buildTokenize,
	compactDictionaryDir,
	fullDictionaryDir,
	initLindera,
	type Tokenize,
} from "./linderaFixture";

/**
 * `PRE-RELEASE-ADVERB-SPIKE1` against the shipped compact IPADIC.
 *
 * Two independent gates live here.
 *
 * **The survey.** Every closed set in `src/adverb/` claims something about the
 * dictionary — that `副詞` has exactly two subclasses, that compaction leaves a
 * `副詞` token with nothing but a surface and a class, that `助詞 / 副詞化` is
 * two entries. Prose cannot hold those claims honestly, so they are re-derived
 * from the shipped bytes on every run. A dictionary change that moves any of
 * them fails here and the survey is re-done rather than quietly becoming wrong.
 *
 * Adverb *surfaces* are not in `dict.words` at all: the surface is the trie
 * key, and compaction drops slot 6 for every `副詞` entry. The survey recovers
 * them from the untouched full dictionary's own 原形 slot, which is legitimate
 * only because compaction rewrites entries in place — the two dictionaries have
 * the same entry count and byte-identical slots 0-2 for all 392,126 entries,
 * which the first test proves before any surface is read.
 *
 * **The fixtures.** Policy §8.5 recorded a read-only dictionary probe and said
 * explicitly that it does not replace this suite. Each sentence is tokenized
 * here through the same adapter and the same construction the plugin uses, and
 * the observation rules are run over the result.
 */

const ENTRY_COUNT = 392_126;
const ADVERB_ENTRIES = 3_032;
const ADVERB_GENERAL_ENTRIES = 2_499;
const ADVERB_CONNECTIVE_ENTRIES = 533;
const ADVERB_SURFACES = 2_991;
const ADVERB_SURFACES_ENDING_IN_TO = 404;
const ADVERB_SURFACES_IN_BOTH_CLASSES = 33;

type Entry = readonly string[];

function readEntries(directory: string): Entry[] {
	const words = readFileSync(path.join(directory, "dict.words"));
	const index = readFileSync(path.join(directory, "dict.wordsidx"));
	const decoder = new TextDecoder();
	const entries: Entry[] = [];
	for (let entry = 0; entry * 4 < index.length; entry += 1) {
		const offset = index.readUInt32LE(entry * 4);
		const length = words.readUInt32LE(offset);
		entries.push(
			splitWordRecord(
				words.subarray(offset + 4, offset + 4 + length),
				entry,
			).map((field: Uint8Array) => decoder.decode(field)),
		);
	}
	return entries;
}

type AdverbEntry = {
	readonly surface: string;
	readonly adverbClass: string;
	readonly reading: string;
};

const compact = readEntries(compactDictionaryDir());
const full = readEntries(fullDictionaryDir());

const adverbs: AdverbEntry[] = [];
for (const [index, entry] of compact.entries()) {
	if (entry[SLOT_POS] === ADVERB_POS) {
		adverbs.push({
			surface: full[index]![SLOT_BASE_FORM]!,
			adverbClass: entry[SLOT_DETAIL1]!,
			reading: full[index]![SLOT_READING]!,
		});
	}
}

const bySurface = new Map<string, AdverbEntry[]>();
for (const entry of adverbs) {
	const list = bySurface.get(entry.surface) ?? [];
	list.push(entry);
	bySurface.set(entry.surface, list);
}

describe("the shipped compact dictionary, scanned in full", () => {
	it("is the same entry set as the untouched dictionary, slot for slot", () => {
		// The premise of recovering adverb surfaces from the full dictionary.
		expect(compact).toHaveLength(ENTRY_COUNT);
		expect(full).toHaveLength(ENTRY_COUNT);
		// 392,126 entries: collected first and asserted once, because a
		// per-entry matcher call is three orders of magnitude slower than the
		// comparison itself and would not say anything more.
		const disagreeing: number[] = [];
		for (const [index, entry] of compact.entries()) {
			const source = full[index]!;
			if (
				entry.length !== DETAIL_SLOT_COUNT ||
				entry[SLOT_POS] !== source[SLOT_POS] ||
				entry[SLOT_DETAIL1] !== source[SLOT_DETAIL1] ||
				entry[SLOT_DETAIL2] !== source[SLOT_DETAIL2]
			) {
				disagreeing.push(index);
			}
		}
		expect(disagreeing).toEqual([]);
	});

	it("has exactly the two 副詞 subclasses the family unites", () => {
		expect(adverbs).toHaveLength(ADVERB_ENTRIES);
		const classes = new Map<string, number>();
		for (const entry of adverbs) {
			classes.set(entry.adverbClass, (classes.get(entry.adverbClass) ?? 0) + 1);
		}
		expect(Object.fromEntries(classes)).toEqual({
			一般: ADVERB_GENERAL_ENTRIES,
			助詞類接続: ADVERB_CONNECTIVE_ENTRIES,
		});
		expect([...classes.keys()].sort()).toEqual([...ADVERB_CLASSES].sort());
	});

	it("leaves a 副詞 token with nothing but a surface and a class", () => {
		// This is why candidate identity cannot key on a base form or reading,
		// and why the two same-class homograph pairs below are indistinguishable.
		const dropped = [
			SLOT_DETAIL2,
			SLOT_DETAIL3,
			SLOT_CONJUGATION_TYPE,
			SLOT_CONJUGATION_FORM,
			SLOT_BASE_FORM,
			SLOT_READING,
			SLOT_PRONUNCIATION,
		];
		const carrying: number[] = [];
		const withoutSource: number[] = [];
		for (const [index, entry] of compact.entries()) {
			if (entry[SLOT_POS] !== ADVERB_POS) {
				continue;
			}
			if (dropped.some((slot) => entry[slot] !== "*")) {
				carrying.push(index);
			}
			// The untouched dictionary does have them, so this is compaction.
			if (full[index]![SLOT_BASE_FORM] === "*") {
				withoutSource.push(index);
			}
		}
		expect(carrying).toEqual([]);
		expect(withoutSource).toEqual([]);
	});

	it("proves a surface alone is not a candidate identity", () => {
		expect(bySurface.size).toBe(ADVERB_SURFACES);
		const bothClasses = [...bySurface].filter(
			([, list]) => new Set(list.map((entry) => entry.adverbClass)).size > 1,
		);
		expect(bothClasses).toHaveLength(ADVERB_SURFACES_IN_BOTH_CLASSES);
		// A representative one, used by the pure suite's isolation fixtures.
		expect(
			bySurface.get("ちょっと")?.map((entry) => entry.adverbClass).sort(),
		).toEqual(["一般", "助詞類接続"]);
	});

	it("records the homographs even (surface, class) cannot separate", () => {
		// Eight surfaces carry two entries in the same class, differing only by
		// a reading compaction drops. They collapse into one production
		// candidate; the key does not pretend otherwise.
		const collapsed = [...bySurface]
			.filter(([, list]) => {
				const classes = list.map((entry) => entry.adverbClass);
				return new Set(classes).size < classes.length;
			})
			.map(([surface]) => surface)
			.sort();
		expect(collapsed).toEqual([
			"大分",
			"如何",
			"早々",
			"何故",
			"正しく",
			"真に",
			"直に",
			"縦令",
		].sort());
		expect(
			bySurface.get("正しく")?.map((entry) => entry.reading).sort(),
		).toEqual(["タダシク", "マサシク"]);
	});

	it("counts the surfaces the duplicate-と guard has to consider", () => {
		const endingInTo = [...bySurface.keys()].filter((surface) =>
			surface.endsWith("と"),
		);
		expect(endingInTo).toHaveLength(ADVERB_SURFACES_ENDING_IN_TO);
		for (const surface of ["そっと", "意外と", "延々と", "一段と", "二度と"]) {
			expect(endingInTo).toContain(surface);
		}
	});

	it("has exactly two 助詞 / 副詞化 entries, と and に", () => {
		const bridging = compact
			.map((entry, index) => ({ entry, index }))
			.filter(
				({ entry }) =>
					entry[SLOT_POS] === "助詞" && entry[SLOT_DETAIL1] === "副詞化",
			);
		expect(bridging).toHaveLength(2);
		expect(
			bridging.map(({ index }) => full[index]![SLOT_BASE_FORM]).sort(),
		).toEqual(["と", "に"]);
	});

	it("gives the profile's entries the classes it claims", () => {
		for (const entry of TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.entries) {
			const found = bySurface.get(entry.surface);
			expect(found).toBeDefined();
			expect(found!.map((item) => item.adverbClass)).toEqual([
				entry.adverbClass,
			]);
		}
		// The policy's excluded lexeme is a real adverb, just not a profiled one.
		expect(bySurface.get("すぐ")?.map((entry) => entry.adverbClass)).toEqual([
			"助詞類接続",
		]);
	});
});

describe("the observation rules against the real tokenizer", () => {
	let tokenize: Tokenize;

	beforeAll(async () => {
		await initLindera();
		tokenize = buildTokenize(compactDictionaryDir());
	});

	function projection(token: JapaneseToken): string {
		return [token.surface, token.pos, token.detail1, token.detail2].join("/");
	}

	function observe(text: string, index = 0) {
		return observeAdverbSlot({ tokens: tokenize(text), index });
	}

	function profileOf(text: string) {
		const result = observe(text);
		if (!result.supported) {
			throw new Error(`${text}: expected an observation, got ${result.reason}`);
		}
		const { headClass, polarity, bridge } = result.observation.profile;
		return `${headClass}/${polarity}/${bridge}`;
	}

	function reasonOf(text: string) {
		const result = observe(text);
		if (result.supported) {
			throw new Error(`${text}: expected a rejection`);
		}
		return result.reason;
	}

	it("reproduces policy §8.5's probe from the shipped bytes", () => {
		expect(tokenize("ゆっくりと歩く").map(projection)).toEqual([
			"ゆっくり/副詞/助詞類接続/*",
			"と/助詞/副詞化/*",
			"歩く/動詞/自立/*",
		]);
		expect(tokenize("じっくりと考える").map(projection)).toEqual([
			"じっくり/副詞/一般/*",
			"と/助詞/副詞化/*",
			"考える/動詞/自立/*",
		]);
		// Tokenizable is not natural: policy §8.5 and this slice both refuse to
		// read this as evidence that `すぐと` is usable.
		expect(tokenize("すぐと歩く").map(projection)).toEqual([
			"すぐ/副詞/助詞類接続/*",
			"と/助詞/副詞化/*",
			"歩く/動詞/自立/*",
		]);
		for (const surface of ["そっと", "意外と", "延々と", "一段と", "二度と"]) {
			const tokens = tokenize(surface);
			expect(tokens).toHaveLength(1);
			expect(tokens[0]!.pos).toBe("副詞");
			expect(tokens[0]!.detail1).toBe("一般");
			expect(tokens[0]!.surface).toBe(surface);
		}
	});

	it("mints the same identity the Vocabulary Snapshot would", () => {
		for (const text of ["ゆっくりと歩く", "じっくりと考える", "そっと歩く"]) {
			for (const token of tokenize(text)) {
				const result = classifyAdverbCandidate(token);
				if (!result.supported) {
					continue;
				}
				expect(result.identity.identityKey).toBe(vocabularyCandidateId(token));
				expect(result.identity.identityKey).toBe(
					adverbProfileIdentityKey(
						result.identity.surface,
						result.identity.adverbClass,
					),
				);
			}
		}
	});

	it("separates an external bridge from a lexical と and from a quotative と", () => {
		expect(profileOf("ゆっくりと歩く")).toBe("verb-predicate/nonnegative/to");
		expect(profileOf("ゆっくり歩く")).toBe("verb-predicate/nonnegative/none");
		// `そっと` carries its own と; the bridge is still none.
		expect(profileOf("そっと歩く")).toBe("verb-predicate/nonnegative/none");
		// `ちょっとと歩く` really does tokenize with an external 副詞化 と.
		expect(tokenize("ちょっとと歩く").map(projection)).toEqual([
			"ちょっと/副詞/助詞類接続/*",
			"と/助詞/副詞化/*",
			"歩く/動詞/自立/*",
		]);
		expect(profileOf("ちょっとと歩く")).toBe("verb-predicate/nonnegative/to");
		// `そっとと歩く` does not: the tokenizer makes the second と quotative.
		expect(tokenize("そっとと歩く").map(projection)).toEqual([
			"そっと/副詞/一般/*",
			"と/助詞/格助詞/引用",
			"歩く/動詞/自立/*",
		]);
		expect(reasonOf("そっとと歩く")).toBe("unsupported-head");
		expect(reasonOf("ゆっくりと言った")).toBe("unsupported-head");
	});

	it("distinguishes the three head classes on real text", () => {
		expect(profileOf("ゆっくり歩く")).toBe("verb-predicate/nonnegative/none");
		expect(profileOf("意外と難しい")).toBe(
			"adjective-predicate/not-applicable/none",
		);
		expect(profileOf("ゆっくり静かだ")).toBe(
			"adjective-predicate/not-applicable/none",
		);
		expect(profileOf("もちろん、彼は来る")).toBe(
			"sentence-modifier/not-applicable/none",
		);
		// A 形容動詞語幹 turned adverbial by 助詞 / 副詞化 に is not the head.
		expect(reasonOf("ゆっくりと丁寧に歩く")).toBe("unsupported-head");
	});

	it("reads a clause adverb from the comma alone, tradeoff included", () => {
		// Owner-approved amendment 1: the comma is the whole rule, so both of
		// these reduce to one `sentence-modifier / not-applicable` profile and
		// `決して、彼は来る` is reachable. The first independent review raised
		// that as a P1 against the policy as it then stood; the owner has since
		// accepted it in exchange for variation and implementation simplicity.
		// It is asserted here so it stays a decision rather than an accident.
		expect(tokenize("決して、彼は来ない").map(projection)).toEqual([
			"決して/副詞/一般/*",
			"、/記号/読点/*",
			"彼/名詞/代名詞/一般",
			"は/助詞/係助詞/*",
			"来/動詞/自立/*",
			"ない/助動詞/*/*",
		]);
		expect(profileOf("決して、彼は来ない")).toBe(
			"sentence-modifier/not-applicable/none",
		);
		expect(profileOf("もちろん、彼は来る")).toBe(
			"sentence-modifier/not-applicable/none",
		);

		const source = tokenize("決して、彼は来ない");
		const candidate = classifyAdverbCandidate(source[0]!);
		expect(candidate.supported).toBe(true);
		if (!candidate.supported) {
			return;
		}
		const index = buildAdverbObservationIndex([{ tokens: source }]);
		expect(index.candidates).toHaveLength(1);
		expect(
			evaluateAdverbCandidate({
				index,
				targetTokens: tokenize("もちろん、彼は来る"),
				targetIndex: 0,
				candidate: candidate.identity,
			}),
		).toMatchObject({ usable: true, bridge: "none" });
		// Nothing past the comma is read, so a predicate Target still refuses.
		expect(
			evaluateAdverbCandidate({
				index,
				targetTokens: tokenize("ゆっくり歩く"),
				targetIndex: 0,
				candidate: candidate.identity,
			}),
		).toEqual({
			usable: false,
			stage: "candidate",
			reason: "head-class-mismatch",
		});
	});

	it("refuses a predicate the run cut short mid-continuation", () => {
		// The second independent review's P1: crossing any continuation was
		// enough to call a run end affirmative, so each of these truncations
		// entered Source evidence as an affirmative observation.
		for (const text of ["ゆっくり歩いてい", "ゆっくり歩きまし", "ゆっくり歩かせ"]) {
			expect(`${text}: ${reasonOf(text)}`).toBe(
				`${text}: polarity-undetermined`,
			);
		}
		// A helper verb and a 接続助詞 carry no conjugation slots at all here,
		// so they are never clause-final. That costs 〜ている / 〜ておく at a
		// bare run end, and a terminator still decides normally.
		for (const token of tokenize("ゆっくり歩いておく")) {
			if (token.pos === "動詞" && token.detail1 === "非自立") {
				expect(token.conjugationForm).toBe("*");
				expect(token.baseForm).toBe("*");
			}
		}
		for (const text of [
			"ゆっくり歩いている",
			"ゆっくり歩いておく",
			"ゆっくり歩いて",
		]) {
			expect(`${text}: ${reasonOf(text)}`).toBe(
				`${text}: polarity-undetermined`,
			);
			expect(`${text}。: ${profileOf(`${text}。`)}`).toBe(
				`${text}。: verb-predicate/nonnegative/none`,
			);
		}
	});

	it("pins every clause-final auxiliary in a real verb tail", () => {
		const closing: Readonly<Record<string, string>> = {
			た: "ゆっくり歩いた",
			ます: "ゆっくり歩きます",
			う: "ゆっくり歩こう",
			たい: "ゆっくり歩きたい",
			らしい: "ゆっくり歩くらしい",
		};
		expect(Object.keys(closing).sort()).toEqual(
			[...ADVERB_CLAUSE_FINAL_AUXILIARY_SURFACES].sort(),
		);
		for (const [surface, text] of Object.entries(closing)) {
			const tokens = tokenize(text);
			const last = tokens[tokens.length - 1]!;
			expect(`${text}: ${last.surface}/${last.pos}`).toBe(
				`${text}: ${surface}/助動詞`,
			);
			expect(`${text}: ${profileOf(text)}`).toBe(
				`${text}: verb-predicate/nonnegative/none`,
			);
		}
		// Chains still decide on their last token.
		for (const text of ["ゆっくり歩きました", "ゆっくり歩いています", "ゆっくり歩くだろう"]) {
			expect(`${text}: ${profileOf(text)}`).toBe(
				`${text}: verb-predicate/nonnegative/none`,
			);
		}
	});

	it("refuses a predicate the run cut short, in any bound form", () => {
		// The first independent review's second P1: the bound-form set named
		// only 未然 / 仮定, so these read as affirmative.
		for (const [text, form] of [
			["ゆっくり歩い", "連用タ接続"],
			["ゆっくり食べ", "連用形"],
			["ゆっくり読ん", "連用タ接続"],
			["ゆっくり歩き", "連用形"],
		] as const) {
			const tokens = tokenize(text);
			expect(`${text}: ${tokens[1]!.conjugationForm}`).toBe(`${text}: ${form}`);
			expect(`${text}: ${reasonOf(text)}`).toBe(
				`${text}: polarity-undetermined`,
			);
		}
		// 連用中止法 is the conservative cost of the allowlist and is recorded
		// as such: affirmative, but not observed.
		expect(reasonOf("ゆっくり歩き、考える")).toBe("polarity-undetermined");
	});

	it("pins every independent-verb conjugation form the dictionary has", () => {
		// The standalone list is an allowlist, so a form this inventory gains
		// would become bound — fail-closed — rather than silently standalone.
		const forms = new Set<string>();
		for (const entry of compact) {
			if (entry[SLOT_POS] === "動詞" && entry[SLOT_DETAIL1] === "自立") {
				forms.add(entry[SLOT_CONJUGATION_FORM]!);
			}
		}
		expect([...forms].sort()).toEqual(
			[
				"仮定形",
				"仮定縮約１",
				"体言接続",
				"体言接続特殊",
				"体言接続特殊２",
				"命令ｅ",
				"命令ｉ",
				"命令ｒｏ",
				"命令ｙｏ",
				"基本形",
				"文語基本形",
				"未然ウ接続",
				"未然ヌ接続",
				"未然レル接続",
				"未然形",
				"未然特殊",
				"現代基本形",
				"連用タ接続",
				"連用形",
			].sort(),
		);
		for (const form of ADVERB_STANDALONE_VERB_FORMS) {
			expect(forms).toContain(form);
		}
		expect(ADVERB_STANDALONE_VERB_FORMS).toHaveLength(7);
	});

	it("reads every closed negative auxiliary from real output", () => {
		const negative = [
			"ゆっくり歩かない",
			"ゆっくり歩かなかった",
			"ゆっくり歩かなく",
			"ゆっくり歩かなかろう",
			"ゆっくり歩きません",
			"ゆっくり歩くまい",
			"ゆっくり歩かざる",
			"全然食べぬ",
			"全然食べず",
			"ゆっくり歩かれない",
			"ゆっくり歩いていない",
		];
		for (const text of negative) {
			expect(`${text}: ${profileOf(text)}`).toBe(
				`${text}: verb-predicate/negative/none`,
			);
		}
		// Every surface in the closed set really is a 助動詞 here.
		const seen = new Set<string>();
		for (const text of [...negative, "ゆっくり歩かねば"]) {
			for (const token of tokenize(text)) {
				if (ADVERB_NEGATIVE_AUXILIARY_SURFACES.includes(token.surface)) {
					expect(token.pos).toBe("助動詞");
					seen.add(token.surface);
				}
			}
		}
		expect([...seen].sort()).toEqual(
			["ない", "なかっ", "なく", "なかろ", "ぬ", "ん", "ず", "ざる", "ね", "まい"].sort(),
		);
	});

	it("reads affirmatives only from a real terminator", () => {
		for (const text of [
			"ゆっくり歩く",
			"ゆっくり歩く。",
			"ゆっくり歩く人",
			"ゆっくり歩いた",
			"ゆっくり歩きます",
			// A 動詞 / 接尾 or 非自立 tail carries no conjugation slots, so it
			// needs a terminator rather than a bare run end.
			"ゆっくり歩かせる。",
			"ゆっくり歩いておく。",
			"ゆっくり歩こう",
		]) {
			expect(`${text}: ${profileOf(text)}`).toBe(
				`${text}: verb-predicate/nonnegative/none`,
			);
		}
	});

	it("fails closed on structures it cannot decide", () => {
		// The clause negation sits past a 名詞 / 非自立 and is a 形容詞 / 自立.
		expect(tokenize("ゆっくり歩くのではない").map(projection)).toContain(
			"ない/形容詞/自立/*",
		);
		expect(reasonOf("ゆっくり歩くのではない")).toBe("polarity-undetermined");
		expect(reasonOf("ゆっくり歩くわけがない")).toBe("polarity-undetermined");
		expect(reasonOf("ゆっくり歩くとき")).toBe("polarity-undetermined");
		// The front half of an obligation, not a negation.
		expect(reasonOf("ゆっくり歩かなければ")).toBe("polarity-undetermined");
		expect(reasonOf("ゆっくり歩かないで")).toBe("polarity-undetermined");
		// Nothing to modify at all.
		expect(reasonOf("ゆっくり")).toBe("no-head");
		expect(reasonOf("ゆっくりと")).toBe("no-head");
		expect(reasonOf("ゆっくり。")).toBe("unsupported-head");
	});

	it("treats a restored whitespace gap as an opaque boundary", () => {
		// lindera-wasm drops ASCII whitespace; the adapter restores it as an
		// unknown token, which both the head search and the tail scan refuse.
		const across = tokenize("ゆっくり 歩く");
		expect(across.map((token) => token.isUnknown)).toEqual([false, true, false]);
		expect(reasonOf("ゆっくり 歩く")).toBe("unsupported-head");
		expect(reasonOf("ゆっくり\n歩く")).toBe("unsupported-head");
		// A gap inside the predicate's tail is not read as "nothing follows".
		expect(reasonOf("ゆっくり歩く ")).toBe("polarity-undetermined");
	});

	it("never crosses a 句点 or a 読点 into the next clause", () => {
		const tokens = tokenize("ゆっくり歩く。走らない。");
		expect(tokens.map(projection)).toEqual([
			"ゆっくり/副詞/助詞類接続/*",
			"歩く/動詞/自立/*",
			"。/記号/句点/*",
			"走ら/動詞/自立/*",
			"ない/助動詞/*/*",
			"。/記号/句点/*",
		]);
		const result = observeAdverbSlot({ tokens, index: 0 });
		expect(result.supported).toBe(true);
		if (result.supported) {
			// The 走らない beyond the 句点 must not make this observation negative.
			expect(result.observation.profile.polarity).toBe("nonnegative");
		}
	});

	it("keeps the copula set honest", () => {
		for (const surface of ADVERB_COPULA_SURFACES) {
			const tokens = tokenize(`静か${surface}`);
			expect(tokens[0]!.detail1).toBe("形容動詞語幹");
			expect(tokens[1]!.pos).toBe("助動詞");
			expect(tokens[1]!.surface).toBe(surface);
		}
	});
});

describe("the capability matrix on real text", () => {
	let tokenize: Tokenize;

	beforeAll(async () => {
		await initLindera();
		tokenize = buildTokenize(compactDictionaryDir());
	});

	function identity(text: string) {
		const result = classifyAdverbCandidate(tokenize(text)[0]!);
		if (!result.supported) {
			throw new Error(`${text}: not a family member`);
		}
		return result.identity;
	}

	function evaluate(target: string, candidate: string, sources: string[]) {
		return evaluateAdverbCandidate({
			index: buildAdverbObservationIndex(
				sources.map((text) => ({ tokens: tokenize(text) })),
			),
			targetTokens: tokenize(target),
			targetIndex: 0,
			candidate: identity(candidate),
		});
	}

	it("carries じっくり both ways on the profile alone", () => {
		expect(
			evaluate("ゆっくりと歩く", "じっくり", ["じっくり考える"]),
		).toMatchObject({ usable: true, bridge: "to" });
		expect(
			evaluate("ゆっくり歩く", "じっくり", ["じっくりと考える"]),
		).toMatchObject({ usable: true, bridge: "none" });
	});

	it("refuses すぐと without evidence and allows it with evidence", () => {
		expect(evaluate("ゆっくり歩く", "すぐ", ["すぐ歩く"])).toMatchObject({
			usable: true,
			bridge: "none",
		});
		expect(evaluate("ゆっくりと歩く", "すぐ", ["すぐ歩く"])).toEqual({
			usable: false,
			stage: "candidate",
			reason: "bridge-not-capable",
		});
		expect(
			evaluate("ゆっくりと歩く", "すぐ", ["すぐ歩く", "すぐと歩く"]),
		).toMatchObject({ usable: true, bridge: "to" });
	});

	it("refuses そっとと and 意外とと in front of an external と", () => {
		expect(evaluate("ゆっくりと歩く", "そっと", ["そっと歩く"])).toEqual({
			usable: false,
			stage: "candidate",
			reason: "duplicate-to-bridge",
		});
		expect(
			evaluate("意外と難しい", "延々と", ["延々と続く"]),
		).toMatchObject({ usable: false, stage: "candidate" });
		// The guard survives a genuine Source observation of そっと with と.
		expect(
			evaluate("ゆっくりと歩く", "そっと", ["そっと歩く", "そっとと歩く"]),
		).toEqual({
			usable: false,
			stage: "candidate",
			reason: "duplicate-to-bridge",
		});
	});

	it("refuses a head class and a polarity mismatch", () => {
		expect(evaluate("ゆっくり歩く", "意外と", ["意外と難しい"])).toEqual({
			usable: false,
			stage: "candidate",
			reason: "head-class-mismatch",
		});
		// 決して, observed only before a negative predicate.
		expect(evaluate("ゆっくり歩く", "決して", ["決して行かない"])).toEqual({
			usable: false,
			stage: "candidate",
			reason: "polarity-mismatch",
		});
		expect(
			evaluate("ゆっくり歩かない", "決して", ["決して行かない"]),
		).toMatchObject({ usable: true, bridge: "none" });
		// And the other direction: an affirmative-only candidate at a negative
		// Target.
		expect(evaluate("ゆっくり歩かない", "じっくり", ["じっくり考える"])).toEqual({
			usable: false,
			stage: "candidate",
			reason: "polarity-mismatch",
		});
	});
});
