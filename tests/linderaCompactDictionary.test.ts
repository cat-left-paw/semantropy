import { describe, expect, it } from "vitest";
import {
	ALWAYS_KEPT_SLOTS,
	DETAIL_SLOT_COUNT,
	ENTRY_CLASSES,
	MANUAL_MORPH1_ALLOWLIST_FIVE_FIELD_SLOT_RULES,
	MANUAL_MORPH1_ALLOWLIST_SCOPE,
	MANUAL_MORPH1_ALLOWLIST_TYPE_FORM_SLOT_RULES,
	MANUAL_MORPH1_CANDIDATE_SLOT_RULES,
	MANUAL_MORPH_EXTRA_SLOTS,
	PRODUCTION_SLOT_RULES,
 LEGACY_NOUN_ONLY_SLOT_RULES,
	TARGET_NOUN_DETAIL1,
	TARGET_NOUN_EXTRA_SLOTS,
	UNSET_FIELD,
	buildCompactWords,
	classifyEntry,
	compactWordFields,
	isTargetNoun,
	keepsSlot,
	resolveSlotRules,
	splitWordRecord,
} from "../scripts/lindera/compactDictionary.mjs";
import { LINDERA_DICTIONARY_FILE_NAMES as SCRIPT_FILE_NAMES } from "../scripts/lindera/linderaSource.mjs";
import { LINDERA_DICTIONARY_FILE_NAMES } from "../src/tokenizer/lindera/linderaPayload";
import { MANUAL_MORPH_ALLOWLIST } from "../src/transform/manualMorphology";

/** Lindera joins an entry's nine detail slots with NUL inside one record. */
const SEPARATOR = "\u0000";

function toFields(values: string[]): Buffer[] {
	return values.map((value) => Buffer.from(value, "utf8"));
}

/** Builds one `dict.words` record the way Lindera stores it. */
function record(values: string[]): Buffer {
	const payload = Buffer.from(values.join(SEPARATOR), "utf8");
	const out = Buffer.allocUnsafe(4 + payload.length);
	out.writeUInt32LE(payload.length, 0);
	payload.copy(out, 4);
	return out;
}

function dictionary(entries: string[][]): { words: Buffer; wordsIdx: Buffer } {
	const records = entries.map(record);
	const wordsIdx = Buffer.allocUnsafe(records.length * 4);
	let offset = 0;
	for (const [index, buffer] of records.entries()) {
		wordsIdx.writeUInt32LE(offset, index * 4);
		offset += buffer.length;
	}
	return { words: Buffer.concat(records), wordsIdx };
}

function readEntries(words: Buffer, wordsIdx: Buffer): string[][] {
	const entries: string[][] = [];
	for (let index = 0; index < wordsIdx.length / 4; index += 1) {
		const offset = wordsIdx.readUInt32LE(index * 4);
		const length = words.readUInt32LE(offset);
		entries.push(
			words
				.subarray(offset + 4, offset + 4 + length)
				.toString("utf8")
				.split(SEPARATOR),
		);
	}
	return entries;
}

const targetNoun = [
	"名詞",
	"固有名詞",
	"人名",
	"名",
	"*",
	"*",
	"太郎",
	"タロウ",
	"タロー",
];
const generalNoun = ["名詞", "一般", "*", "*", "*", "*", "駅", "エキ", "エキ"];
const suffixNoun = ["名詞", "接尾", "一般", "*", "*", "*", "目", "メ", "メ"];
const verb = [
	"動詞",
	"自立",
	"*",
	"*",
	"五段・タ行",
	"連用タ接続",
	"待つ",
	"マッ",
	"マッ",
];

describe("compaction classification", () => {
	it("treats exactly the four exchangeable noun classes as targets", () => {
		expect([...TARGET_NOUN_DETAIL1]).toEqual([
			"一般",
			"固有名詞",
			"サ変接続",
			"形容動詞語幹",
		]);
		for (const detail1 of TARGET_NOUN_DETAIL1) {
			expect(isTargetNoun("名詞", detail1)).toBe(true);
		}
	});

	it("does not treat other nouns or other parts of speech as targets", () => {
		for (const detail1 of ["接尾", "代名詞", "数", "副詞可能", "非自立"]) {
			expect(isTargetNoun("名詞", detail1)).toBe(false);
		}
		expect(isTargetNoun("動詞", "一般")).toBe(false);
		expect(isTargetNoun("記号", "一般")).toBe(false);
	});

	it("keeps part of speech and its first two subcategories for every entry", () => {
		expect([...ALWAYS_KEPT_SLOTS]).toEqual([0, 1, 2]);
		for (const slot of ALWAYS_KEPT_SLOTS) {
			expect(keepsSlot(slot, true)).toBe(true);
			expect(keepsSlot(slot, false)).toBe(true);
		}
	});

	it("keeps subcategory 3, base form and reading only for target nouns", () => {
		expect([...TARGET_NOUN_EXTRA_SLOTS]).toEqual([3, 6, 7]);
		for (const slot of TARGET_NOUN_EXTRA_SLOTS) {
			expect(keepsSlot(slot, true)).toBe(true);
			expect(keepsSlot(slot, false)).toBe(false);
		}
	});

	it("historical noun-only predicate drops conjugation and pronunciation", () => {
		for (const slot of [4, 5, 8]) {
			expect(keepsSlot(slot, true)).toBe(false);
			expect(keepsSlot(slot, false)).toBe(false);
		}
	});
});

describe("compactWordFields", () => {
	it("rewrites a target noun to keep pos, subcategories 1-3, base form and reading", () => {
		const { fields, targetNoun: isTarget } = compactWordFields(
			toFields(targetNoun),
		);
		expect(isTarget).toBe(true);
		expect(fields.map((field) => field.toString("utf8"))).toEqual([
			"名詞",
			"固有名詞",
			"人名",
			"名",
			"*",
			"*",
			"太郎",
			"タロウ",
			"*",
		]);
	});

	it("keeps all morphology fields of an independent verb", () => {
		const { fields, targetNoun: isTarget } = compactWordFields(toFields(verb));
		expect(isTarget).toBe(false);
		expect(fields.map((field) => field.toString("utf8"))).toEqual([
			...verb.slice(0, 8), "*",
		]);
	});

	it("keeps a non-target noun's classification but drops its base form and reading", () => {
		const { fields } = compactWordFields(toFields(suffixNoun));
		expect(fields.slice(0, 3).map((field) => field.toString("utf8"))).toEqual([
			"名詞",
			"接尾",
			"一般",
		]);
		expect(fields[6]?.toString("utf8")).toBe(UNSET_FIELD);
		expect(fields[7]?.toString("utf8")).toBe(UNSET_FIELD);
	});

	it("always emits nine slots, whatever the entry", () => {
		for (const entry of [targetNoun, generalNoun, suffixNoun, verb]) {
			expect(compactWordFields(toFields(entry)).fields).toHaveLength(
				DETAIL_SLOT_COUNT,
			);
		}
	});
});

describe("buildCompactWords", () => {
	const entries = [targetNoun, generalNoun, suffixNoun, verb];

	it("rebuilds every entry, in order, with no entry dropped", () => {
		const source = dictionary(entries);
		const compact = buildCompactWords(source.words, source.wordsIdx);

		expect(compact.entryCount).toBe(entries.length);
		expect(compact.targetNounCount).toBe(2);
		expect(compact.wordsIdx).toHaveLength(source.wordsIdx.length);

		const rebuilt = readEntries(compact.words, compact.wordsIdx);
		expect(rebuilt).toHaveLength(entries.length);
		expect(rebuilt.every((fields) => fields.length === DETAIL_SLOT_COUNT)).toBe(
			true,
		);
		// Order is what keeps word IDs — indices into dict.wordsidx — valid, so
		// dict.trie and dict.vals stay correct untouched.
		expect(rebuilt.map((fields) => fields[0])).toEqual([
			"名詞",
			"名詞",
			"名詞",
			"動詞",
		]);
		expect(rebuilt.map((fields) => fields[1])).toEqual([
			"固有名詞",
			"一般",
			"接尾",
			"自立",
		]);
	});

	it("regenerates the index from the new record lengths, contiguously", () => {
		const source = dictionary(entries);
		const compact = buildCompactWords(source.words, source.wordsIdx);

		let expected = 0;
		for (let index = 0; index < compact.entryCount; index += 1) {
			expect(compact.wordsIdx.readUInt32LE(index * 4)).toBe(expected);
			expected += 4 + compact.words.readUInt32LE(expected);
		}
		expect(expected).toBe(compact.words.length);
	});

	it("is deterministic: the same input produces byte-identical output", () => {
		const source = dictionary(entries);
		const first = buildCompactWords(source.words, source.wordsIdx);
		const second = buildCompactWords(source.words, source.wordsIdx);
		expect(first.words.equals(second.words)).toBe(true);
		expect(first.wordsIdx.equals(second.wordsIdx)).toBe(true);
	});

	it("does not modify the input buffers", () => {
		const source = dictionary(entries);
		const wordsCopy = Buffer.from(source.words);
		const idxCopy = Buffer.from(source.wordsIdx);
		buildCompactWords(source.words, source.wordsIdx);
		expect(source.words.equals(wordsCopy)).toBe(true);
		expect(source.wordsIdx.equals(idxCopy)).toBe(true);
	});
});

describe("build stops on a malformed dictionary", () => {
	it("rejects an index that is not a whole number of u32 offsets", () => {
		const source = dictionary([generalNoun]);
		expect(() =>
			buildCompactWords(source.words, source.wordsIdx.subarray(0, 3)),
		).toThrow(/multiple of 4 bytes/);
	});

	it("rejects an empty index", () => {
		const source = dictionary([generalNoun]);
		expect(() => buildCompactWords(source.words, Buffer.alloc(0))).toThrow(
			/non-empty/,
		);
	});

	it("rejects an offset that does not follow the previous record", () => {
		const source = dictionary([generalNoun, verb]);
		const broken = Buffer.from(source.wordsIdx);
		broken.writeUInt32LE(9, 4);
		expect(() => buildCompactWords(source.words, broken)).toThrow(
			/previous record ends at/,
		);
	});

	it("rejects an offset past the end of dict.words", () => {
		const source = dictionary([generalNoun]);
		const broken = Buffer.from(source.wordsIdx);
		broken.writeUInt32LE(source.words.length + 8, 0);
		expect(() => buildCompactWords(source.words, broken)).toThrow(
			/previous record ends at|past the end/,
		);
	});

	it("rejects a record whose declared length runs past the file", () => {
		const source = dictionary([generalNoun]);
		const broken = Buffer.from(source.words);
		broken.writeUInt32LE(source.words.length * 4, 0);
		expect(() => buildCompactWords(broken, source.wordsIdx)).toThrow(
			/past the end/,
		);
	});

	it("rejects trailing bytes after the last indexed record", () => {
		const source = dictionary([generalNoun]);
		expect(() =>
			buildCompactWords(
				Buffer.concat([source.words, Buffer.from([0, 0, 0])]),
				source.wordsIdx,
			),
		).toThrow(/trailing bytes/);
	});

	it("rejects an entry that does not carry exactly nine detail slots", () => {
		const source = dictionary([["名詞", "一般", "*"]]);
		expect(() => buildCompactWords(source.words, source.wordsIdx)).toThrow(
			/3 detail slots, expected 9/,
		);
		expect(() =>
			splitWordRecord(Buffer.from(["名詞", "一般"].join(SEPARATOR), "utf8"), 7),
		).toThrow(/entry 7 has 2 detail slots/);
	});
});

const adjective = [
	"形容詞",
	"自立",
	"*",
	"*",
	"形容詞・アウオ段",
	"連用タ接続",
	"青い",
	"アオカッ",
	"アオカッ",
];
const adjectivalNoun = [
	"名詞",
	"形容動詞語幹",
	"*",
	"*",
	"*",
	"*",
	"静か",
	"シズカ",
	"シズカ",
];
const dependentVerb = [
	"動詞",
	"非自立",
	"*",
	"*",
	"一段",
	"連用形",
	"いる",
	"イ",
	"イ",
];
const auxiliary = ["助動詞", "*", "*", "*", "特殊・タ", "基本形", "た", "タ", "タ"];

function strings(fields: Buffer[]): string[] {
	return fields.map((field) => field.toString("utf8"));
}

describe("entry classification for the slot rules", () => {
	it("classifies by pos and detail1 only, keeping 形容動詞語幹 a noun", () => {
		expect([...ENTRY_CLASSES]).toEqual([
			"target-noun",
			"independent-verb",
			"independent-adjective",
			"other",
		]);
		expect(classifyEntry("動詞", "自立")).toBe("independent-verb");
		expect(classifyEntry("形容詞", "自立")).toBe("independent-adjective");
		expect(classifyEntry("名詞", "形容動詞語幹")).toBe("target-noun");
		for (const [pos, detail1] of [
			["動詞", "非自立"],
			["動詞", "接尾"],
			["形容詞", "非自立"],
			["形容詞", "接尾"],
			["助動詞", "*"],
			["名詞", "接尾"],
			["自立", "動詞"],
		] as const) {
			expect(classifyEntry(pos, detail1)).toBe("other");
		}
	});

	it("keeps the production rules exactly as the pinned dictionary was built", () => {
		expect(PRODUCTION_SLOT_RULES).toEqual({
			"target-noun": [3, 6, 7],
			"independent-verb": [3, 4, 5, 6, 7],
			"independent-adjective": [3, 4, 5, 6, 7],
			other: [],
		});
		for (const entry of [targetNoun, generalNoun, suffixNoun, verb, adjective, auxiliary]) {
			expect(strings(compactWordFields(toFields(entry)).fields)).toEqual(
				strings(compactWordFields(toFields(entry), PRODUCTION_SLOT_RULES).fields),
			);
		}
	});

	it("defines the MANUAL-MORPH1 candidate as the five morphology slots, never pronunciation", () => {
		expect(MANUAL_MORPH1_CANDIDATE_SLOT_RULES).toBe(PRODUCTION_SLOT_RULES);
		expect([...MANUAL_MORPH_EXTRA_SLOTS]).toEqual([3, 4, 5, 6, 7]);
		expect(MANUAL_MORPH1_CANDIDATE_SLOT_RULES).toEqual({
			"target-noun": [3, 6, 7],
			"independent-verb": [3, 4, 5, 6, 7],
			"independent-adjective": [3, 4, 5, 6, 7],
			other: [],
		});
	});
});

describe("compactWordFields with the MANUAL-MORPH1 candidate rules", () => {
	const rules = MANUAL_MORPH1_CANDIDATE_SLOT_RULES;

	it("keeps 動詞 / 自立 slots 0-7 verbatim and drops pronunciation", () => {
		const result = compactWordFields(toFields(verb), rules);
		expect(result.entryClass).toBe("independent-verb");
		expect(strings(result.fields)).toEqual([...verb.slice(0, 8), "*"]);
	});

	it("keeps 形容詞 / 自立 slots 0-7 verbatim and drops pronunciation", () => {
		const result = compactWordFields(toFields(adjective), rules);
		expect(result.entryClass).toBe("independent-adjective");
		expect(strings(result.fields)).toEqual([...adjective.slice(0, 8), "*"]);
	});

	it("leaves exchangeable nouns, including 形容動詞語幹, byte-identical to production", () => {
		for (const entry of [targetNoun, generalNoun, adjectivalNoun]) {
			expect(compactWordFields(toFields(entry), rules).fields).toEqual(
				compactWordFields(toFields(entry)).fields,
			);
		}
		expect(strings(compactWordFields(toFields(adjectivalNoun), rules).fields)).toEqual([
			"名詞",
			"形容動詞語幹",
			"*",
			"*",
			"*",
			"*",
			"静か",
			"シズカ",
			"*",
		]);
	});

	it("still reduces every other entry to its three part-of-speech slots", () => {
		for (const entry of [suffixNoun, dependentVerb, auxiliary]) {
			expect(strings(compactWordFields(toFields(entry), rules).fields)).toEqual([
				...entry.slice(0, 3),
				"*",
				"*",
				"*",
				"*",
				"*",
				"*",
			]);
		}
	});

	it("never back-fills a slot the full entry left empty or '*'", () => {
		const sparse = ["動詞", "自立", "*", "*", "", "*", "*", "", "カク"];
		expect(strings(compactWordFields(toFields(sparse), rules).fields)).toEqual([
			"動詞",
			"自立",
			"*",
			"*",
			"",
			"*",
			"*",
			"",
			"*",
		]);
	});

	it("builds deterministically, counts every entry class and keeps every entry in order", () => {
		const entries = [targetNoun, verb, adjective, adjectivalNoun, dependentVerb, auxiliary];
		const source = dictionary(entries);
		const first = buildCompactWords(source.words, source.wordsIdx, rules);
		const second = buildCompactWords(source.words, source.wordsIdx, rules);
		expect(first.words.equals(second.words)).toBe(true);
		expect(first.wordsIdx.equals(second.wordsIdx)).toBe(true);
		expect(first.entryClassCounts).toEqual({
			"target-noun": 2,
			"independent-verb": 1,
			"independent-adjective": 1,
			other: 2,
		});
		const rebuilt = readEntries(first.words, first.wordsIdx);
		expect(rebuilt.map((fields) => fields.slice(0, 2))).toEqual(
			entries.map((fields) => fields.slice(0, 2)),
		);
		const production = buildCompactWords(source.words, source.wordsIdx);
		expect(production.entryClassCounts).toEqual(first.entryClassCounts);
		expect(production.words.equals(first.words)).toBe(true);
  expect(buildCompactWords(source.words, source.wordsIdx, LEGACY_NOUN_ONLY_SLOT_RULES).words.equals(first.words)).toBe(false);
	});

	it("stops on the same malformed input as the production rules", () => {
		const source = dictionary([verb]);
		const broken = Buffer.from(source.words);
		broken.writeUInt32LE(source.words.length * 4, 0);
		expect(() => buildCompactWords(broken, source.wordsIdx, rules)).toThrow(
			/past the end/,
		);
		expect(() =>
			buildCompactWords(source.words, source.wordsIdx.subarray(0, 3), rules),
		).toThrow(/multiple of 4 bytes/);
		const short = dictionary([["動詞", "自立", "*"]]);
		expect(() => buildCompactWords(short.words, short.wordsIdx, rules)).toThrow(
			/3 detail slots, expected 9/,
		);
	});
});

describe("allowlist-scoped slot rules (owner alternatives C and D, measured only)", () => {
	const imperative = ["動詞", "自立", "*", "*", "五段・カ行イ音便", "命令ｅ", "書く", "カケ", "カケ"];
	const irregularAdjective = ["形容詞", "自立", "*", "*", "不変化型", "基本形", "ええ", "エエ", "エエ"];
	const garuAdjective = ["形容詞", "自立", "*", "*", "形容詞・アウオ段", "ガル接続", "青い", "アオ", "アオ"];

	it("restates exactly the conjugation types and forms the manual core allowlists", () => {
		expect(MANUAL_MORPH1_ALLOWLIST_SCOPE).toEqual({
			"independent-verb": {
				conjugationTypes: MANUAL_MORPH_ALLOWLIST.verb.conjugationTypes,
				conjugationForms: Object.keys(MANUAL_MORPH_ALLOWLIST.verb.forms),
			},
			"independent-adjective": {
				conjugationTypes: MANUAL_MORPH_ALLOWLIST["i-adjective"].conjugationTypes,
				conjugationForms: Object.keys(MANUAL_MORPH_ALLOWLIST["i-adjective"].forms),
			},
		});
	});

	it("keeps the rule's slots only for in-scope verbs and adjectives; everything else matches the historical noun-only policy", () => {
		for (const [rules, slots] of [
			[MANUAL_MORPH1_ALLOWLIST_FIVE_FIELD_SLOT_RULES, [3, 4, 5, 6, 7]],
			[MANUAL_MORPH1_ALLOWLIST_TYPE_FORM_SLOT_RULES, [3, 4, 5]],
		] as const) {
			const kept = new Set<number>([0, 1, 2, ...slots]);
			for (const entry of [verb, adjective]) {
				const result = compactWordFields(toFields(entry), rules);
				expect(result.keptExtraSlots).toBe(true);
				expect(strings(result.fields)).toEqual(
					entry.map((field, slot) => (kept.has(slot) ? field : "*")),
				);
			}
			for (const entry of [imperative, irregularAdjective, garuAdjective, dependentVerb, auxiliary, suffixNoun, targetNoun, adjectivalNoun]) {
				expect(compactWordFields(toFields(entry), rules).fields).toEqual(
					compactWordFields(toFields(entry), LEGACY_NOUN_ONLY_SLOT_RULES).fields,
				);
			}
		}
	});

	it("counts extended entries per class and builds deterministically", () => {
		const entries = [targetNoun, verb, imperative, adjective, irregularAdjective, auxiliary];
		const source = dictionary(entries);
		const first = buildCompactWords(source.words, source.wordsIdx, MANUAL_MORPH1_ALLOWLIST_FIVE_FIELD_SLOT_RULES);
		const second = buildCompactWords(source.words, source.wordsIdx, MANUAL_MORPH1_ALLOWLIST_FIVE_FIELD_SLOT_RULES);
		expect(first.words.equals(second.words)).toBe(true);
		expect(first.wordsIdx.equals(second.wordsIdx)).toBe(true);
		expect(first.entryClassCounts).toEqual({ "target-noun": 1, "independent-verb": 2, "independent-adjective": 2, other: 1 });
		expect(first.extendedEntryCounts).toEqual({ "target-noun": 1, "independent-verb": 1, "independent-adjective": 1, other: 0 });
		expect(buildCompactWords(source.words, source.wordsIdx, LEGACY_NOUN_ONLY_SLOT_RULES).extendedEntryCounts).toEqual({
			"target-noun": 1,
			"independent-verb": 0,
			"independent-adjective": 0,
			other: 0,
		});
	});

	it("rejects a malformed scope", () => {
		const base = { ...MANUAL_MORPH1_ALLOWLIST_TYPE_FORM_SLOT_RULES };
		const scope = MANUAL_MORPH1_ALLOWLIST_SCOPE["independent-verb"];
		const withVerb = (rule: unknown) => resolveSlotRules({ ...base, "independent-verb": rule });
		expect(() => withVerb({ slots: [3], scope, extra: true })).toThrow(/array or \{ slots, scope \}/);
		expect(() => withVerb({ slots: [3], scope: { conjugationTypes: scope.conjugationTypes } })).toThrow(/scope must list/);
		expect(() => withVerb({ slots: [3], scope: null })).toThrow(/scope must list/);
		expect(() => withVerb({ slots: [3], scope: { ...scope, conjugationForms: [] } })).toThrow(/non-empty list of distinct/);
		expect(() => withVerb({ slots: [3], scope: { ...scope, conjugationForms: ["基本形", "基本形"] } })).toThrow(/non-empty list of distinct/);
		expect(() => withVerb({ slots: [3], scope: { ...scope, conjugationTypes: ["*"] } })).toThrow(/non-empty list of distinct/);
		expect(() => withVerb({ slots: [8], scope })).toThrow(/only slots 3-7/);
		expect(() => withVerb({ slots: "3", scope })).toThrow(/must be an array/);
	});
});

describe("slot rule tables fail closed", () => {
	const valid = { ...MANUAL_MORPH1_CANDIDATE_SLOT_RULES };

	it("rejects a table that keeps pronunciation or a part-of-speech slot twice", () => {
		expect(() =>
			resolveSlotRules({ ...valid, "independent-verb": [3, 4, 5, 6, 7, 8] }),
		).toThrow(/only slots 3-7/);
		expect(() => resolveSlotRules({ ...valid, other: [0] })).toThrow(
			/only slots 3-7/,
		);
		expect(() => resolveSlotRules({ ...valid, other: [3.5] })).toThrow(
			/only slots 3-7/,
		);
	});

	it("rejects a table with a missing, extra or non-array class", () => {
		const { other: _omitted, ...missing } = valid;
		expect(() => resolveSlotRules(missing)).toThrow(/must name exactly/);
		expect(() => resolveSlotRules({ ...valid, adverb: [] })).toThrow(
			/must name exactly/,
		);
		expect(() => resolveSlotRules({ ...valid, other: "3" })).toThrow(
			/must be an array/,
		);
		expect(() => resolveSlotRules(null)).toThrow(/must be an object/);
		const source = dictionary([verb]);
		expect(() =>
			buildCompactWords(source.words, source.wordsIdx, missing as never),
		).toThrow(/must name exactly/);
	});
});

describe("dictionary file list", () => {
	it("is the same list in the build scripts and in the runtime payload", () => {
		expect([...SCRIPT_FILE_NAMES]).toEqual([...LINDERA_DICTIONARY_FILE_NAMES]);
	});
});
