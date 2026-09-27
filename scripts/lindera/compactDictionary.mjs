import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	COMPACTED_FILE_NAMES,
	LINDERA_DICTIONARY_FILE_NAMES,
	LINDERA_NOTICE_FILE_NAME,
	assertDictionaryDir,
	measureDictionaryDir,
} from "./linderaSource.mjs";

/**
 * IPADIC carries nine detail slots per system-dictionary entry. Lindera stores
 * them in `dict.words` as one NUL-joined record per entry, addressed by the
 * u32 offsets in `dict.wordsidx`:
 *
 *   dict.wordsidx : u32 LE offset of each record, in entry order
 *   dict.words    : [u32 LE payload length][payload], records back to back
 *   payload       : nine UTF-8 fields joined by 0x00
 *
 * Slot order follows the IPADIC CSV, which is the order Lindera returns in
 * `token.details`:
 *
 *   0 part of speech        3 pos subcategory 3     6 base form
 *   1 pos subcategory 1     4 conjugation type      7 reading
 *   2 pos subcategory 2     5 conjugation form      8 pronunciation
 *
 * (metadata.json lists slots 4 and 5 as `conjugation_form` /
 * `conjugation_type`; the data itself is 活用型 then 活用形 — type then form,
 * e.g. 待っ → 五段・タ行, 連用タ接続. The slot numbers below follow the data,
 * never the metadata names. Production keeps both slots for independent
 * verbs and i-adjectives in this data order.)
 */
export const DETAIL_SLOT_COUNT = 9;

export const SLOT_POS = 0;
export const SLOT_DETAIL1 = 1;
export const SLOT_DETAIL2 = 2;
export const SLOT_DETAIL3 = 3;
export const SLOT_CONJUGATION_TYPE = 4;
export const SLOT_CONJUGATION_FORM = 5;
export const SLOT_BASE_FORM = 6;
export const SLOT_READING = 7;
export const SLOT_PRONUNCIATION = 8;

/** IPADIC's own "no value" marker, per metadata.json `default_field_value`. */
export const UNSET_FIELD = "*";

export const NOUN_POS = "名詞";

/**
 * The noun classes Semantropy exchanges. Only these entries keep more than the
 * three part-of-speech slots.
 */
export const TARGET_NOUN_DETAIL1 = Object.freeze([
	"一般",
	"固有名詞",
	"サ変接続",
	"形容動詞語幹",
]);

const TARGET_NOUN_DETAIL1_SET = new Set(TARGET_NOUN_DETAIL1);

/** Slots kept verbatim for every entry, whatever its part of speech. */
export const ALWAYS_KEPT_SLOTS = Object.freeze([
	SLOT_POS,
	SLOT_DETAIL1,
	SLOT_DETAIL2,
]);

/** Slots additionally kept for an exchangeable noun. */
export const TARGET_NOUN_EXTRA_SLOTS = Object.freeze([
	SLOT_DETAIL3,
	SLOT_BASE_FORM,
	SLOT_READING,
]);

export const VERB_POS = "動詞";
export const ADJECTIVE_POS = "形容詞";
export const INDEPENDENT_DETAIL1 = "自立";

/**
 * The entry classes the slot rules distinguish. Classification reads slots 0
 * and 1 only. `independent-adjective` is IPADIC's 形容詞 / 自立, i.e. the
 * inflecting イ-adjective class; 名詞 / 形容動詞語幹 is a noun and stays a
 * `target-noun`, so the two can never share a rule.
 */
export const ENTRY_CLASSES = Object.freeze([
	"target-noun",
	"independent-verb",
	"independent-adjective",
	"other",
]);

/** Full five-field policy for every independent verb and i-adjective. */
export const MANUAL_MORPH_EXTRA_SLOTS = Object.freeze([
 SLOT_DETAIL3, SLOT_CONJUGATION_TYPE, SLOT_CONJUGATION_FORM, SLOT_BASE_FORM, SLOT_READING,
]);

/** Production source of truth. No conjugation allowlist limits field retention. */
export const PRODUCTION_SLOT_RULES = Object.freeze({
 "target-noun": TARGET_NOUN_EXTRA_SLOTS,
 "independent-verb": MANUAL_MORPH_EXTRA_SLOTS,
 "independent-adjective": MANUAL_MORPH_EXTRA_SLOTS,
 other: Object.freeze([]),
});
export const COMPACT_DICTIONARY_POLICY = "semantropy-compact-five-field-1";

/** Historical measurement name; exact alias, never an independently maintained rule. */
export const MANUAL_MORPH1_CANDIDATE_SLOT_RULES = PRODUCTION_SLOT_RULES;

/** Comparison-only pre-Dictionary1 policy. Never used by preparation or runtime. */
export const LEGACY_NOUN_ONLY_SLOT_RULES = Object.freeze({
 "target-noun": TARGET_NOUN_EXTRA_SLOTS,
 "independent-verb": Object.freeze([]),
 "independent-adjective": Object.freeze([]),
 other: Object.freeze([]),
});

/**
 * The conjugation types and forms the MANUAL-MORPH1 compatibility core
 * (src/transform/manualMorphology.ts) allowlists, restated here because this
 * build script cannot import TypeScript. tests/linderaCompactDictionary.test.ts
 * keeps the two lists identical.
 */
export const MANUAL_MORPH1_ALLOWLIST_SCOPE = Object.freeze({
	"independent-verb": Object.freeze({
		conjugationTypes: Object.freeze([
			"一段",
			"五段・カ行イ音便",
			"五段・ガ行",
			"五段・サ行",
			"五段・タ行",
			"五段・ナ行",
			"五段・バ行",
			"五段・マ行",
			"五段・ラ行",
			"五段・ワ行促音便",
		]),
		conjugationForms: Object.freeze([
			"基本形",
			"未然形",
			"未然ウ接続",
			"連用形",
			"連用タ接続",
			"仮定形",
		]),
	}),
	"independent-adjective": Object.freeze({
		conjugationTypes: Object.freeze(["形容詞・アウオ段", "形容詞・イ段"]),
		conjugationForms: Object.freeze([
			"基本形",
			"連用テ接続",
			"連用タ接続",
			"仮定形",
		]),
	}),
});

function allowlistScopedRules(slots) {
	return Object.freeze({
		"target-noun": TARGET_NOUN_EXTRA_SLOTS,
		"independent-verb": Object.freeze({
			slots,
			scope: MANUAL_MORPH1_ALLOWLIST_SCOPE["independent-verb"],
		}),
		"independent-adjective": Object.freeze({
			slots,
			scope: MANUAL_MORPH1_ALLOWLIST_SCOPE["independent-adjective"],
		}),
		other: Object.freeze([]),
	});
}

/**
 * Owner-decision alternative C (measured only): the five morphology slots,
 * kept only for verb / adjective entries whose full-dictionary conjugation type
 * AND form are both in the allowlist. Every other entry is compacted exactly
 * as in the legacy noun-only dictionary.
 */
export const MANUAL_MORPH1_ALLOWLIST_FIVE_FIELD_SLOT_RULES =
	allowlistScopedRules(MANUAL_MORPH_EXTRA_SLOTS);

/** Owner-decision alternative D (measured only): as C, keeping slots 3-5 only. */
export const MANUAL_MORPH1_ALLOWLIST_TYPE_FORM_SLOT_RULES = allowlistScopedRules(
	Object.freeze([SLOT_DETAIL3, SLOT_CONJUGATION_TYPE, SLOT_CONJUGATION_FORM]),
);

const ALWAYS_KEPT_SET = new Set(ALWAYS_KEPT_SLOTS);
const TARGET_EXTRA_SET = new Set(TARGET_NOUN_EXTRA_SLOTS);

const NUL = Buffer.from([0]);
const UNSET_BYTES = Buffer.from(UNSET_FIELD, "utf8");

export function isTargetNoun(pos, detail1) {
	return pos === NOUN_POS && TARGET_NOUN_DETAIL1_SET.has(detail1);
}

/** Maps an entry's part of speech and first subcategory to its rule class. */
export function classifyEntry(pos, detail1) {
	if (isTargetNoun(pos, detail1)) {
		return "target-noun";
	}
	if (pos === VERB_POS && detail1 === INDEPENDENT_DETAIL1) {
		return "independent-verb";
	}
	if (pos === ADJECTIVE_POS && detail1 === INDEPENDENT_DETAIL1) {
		return "independent-adjective";
	}
	return "other";
}

/** Historical noun-only predicate, retained for comparison tests. */
export function keepsSlot(slot, targetNoun) {
	return ALWAYS_KEPT_SET.has(slot) || (targetNoun && TARGET_EXTRA_SET.has(slot));
}

function validateSlots(entryClass, slots) {
	if (!Array.isArray(slots)) {
		throw new Error(`Compaction slot rule ${entryClass} must be an array.`);
	}
	for (const slot of slots) {
		if (!Number.isInteger(slot) || slot < SLOT_DETAIL3 || slot > SLOT_READING) {
			throw new Error(
				`Compaction slot rule ${entryClass} may keep only slots ${SLOT_DETAIL3}-${SLOT_READING}; got ${String(slot)}.`,
			);
		}
	}
}

function validateScopeList(entryClass, name, values) {
	if (
		!Array.isArray(values) ||
		values.length === 0 ||
		values.some((value) => typeof value !== "string" || value.length === 0 || value === UNSET_FIELD) ||
		new Set(values).size !== values.length
	) {
		throw new Error(
			`Compaction slot rule ${entryClass} scope ${name} must be a non-empty list of distinct values.`,
		);
	}
	return new Set(values);
}

/**
 * Validates a rule table and returns, per class, the full set of kept slots.
 * A class rule is either an array of extra slots (every entry of the class) or
 * `{ slots, scope: { conjugationTypes, conjugationForms } }`, which keeps the
 * extra slots only for entries whose own slot 4 and slot 5 are both listed and
 * compacts every other entry of the class to slots 0-2, as the legacy noun-only policy did.
 * A table that names an unknown class, omits a class, keeps pronunciation or
 * a slot outside 3..7, or has a malformed scope is rejected: a malformed rule
 * must stop the build rather than silently keep or drop data.
 */
export function resolveSlotRules(rules) {
	if (rules === null || typeof rules !== "object") {
		throw new Error("Compaction slot rules must be an object.");
	}
	const names = Object.keys(rules).sort();
	if (JSON.stringify(names) !== JSON.stringify([...ENTRY_CLASSES].sort())) {
		throw new Error(
			`Compaction slot rules must name exactly ${ENTRY_CLASSES.join(", ")}.`,
		);
	}
	const resolved = new Map();
	for (const entryClass of ENTRY_CLASSES) {
		const rule = rules[entryClass];
		let slots = rule;
		let scope = null;
		if (rule !== null && typeof rule === "object" && !Array.isArray(rule)) {
			if (JSON.stringify(Object.keys(rule).sort()) !== JSON.stringify(["scope", "slots"])) {
				throw new Error(
					`Compaction slot rule ${entryClass} must be an array or { slots, scope }.`,
				);
			}
			slots = rule.slots;
			const ruleScope = rule.scope;
			if (
				ruleScope === null ||
				typeof ruleScope !== "object" ||
				JSON.stringify(Object.keys(ruleScope).sort()) !==
					JSON.stringify(["conjugationForms", "conjugationTypes"])
			) {
				throw new Error(
					`Compaction slot rule ${entryClass} scope must list conjugationTypes and conjugationForms.`,
				);
			}
			scope = {
				conjugationTypes: validateScopeList(entryClass, "conjugationTypes", ruleScope.conjugationTypes),
				conjugationForms: validateScopeList(entryClass, "conjugationForms", ruleScope.conjugationForms),
			};
		}
		validateSlots(entryClass, slots);
		resolved.set(entryClass, {
			kept: new Set([...ALWAYS_KEPT_SLOTS, ...slots]),
			scope,
		});
	}
	return resolved;
}

const PRODUCTION_RESOLVED = resolveSlotRules(PRODUCTION_SLOT_RULES);

function resolvedRules(rules) {
	return rules === PRODUCTION_SLOT_RULES
		? PRODUCTION_RESOLVED
		: resolveSlotRules(rules);
}

/**
 * Splits one record payload into its nine fields. A record with any other
 * field count is a malformed dictionary, not something to repair: the caller
 * stops the build.
 */
export function splitWordRecord(payload, entryIndex) {
	const fields = [];
	let start = 0;
	for (let cursor = 0; cursor <= payload.length; cursor += 1) {
		if (cursor === payload.length || payload[cursor] === 0) {
			fields.push(payload.subarray(start, cursor));
			start = cursor + 1;
		}
	}
	if (fields.length !== DETAIL_SLOT_COUNT) {
		throw new Error(
			`dict.words entry ${entryIndex} has ${fields.length} detail slots, expected ${DETAIL_SLOT_COUNT}.`,
		);
	}
	return fields;
}

/**
 * Rewrites one entry's nine fields. The slot count never varies: a dropped
 * slot becomes IPADIC's own `"*"`, so a consumer cannot tell a dropped slot
 * from an entry that never had a value, and no slot is silently filled with a
 * substitute such as the surface form. A kept slot is copied byte for byte.
 */
export function compactWordFields(fields, rules = PRODUCTION_SLOT_RULES) {
	return compactFieldsWith(fields, resolvedRules(rules));
}

function compactFieldsWith(fields, resolved) {
	const pos = fields[SLOT_POS].toString("utf8");
	const detail1 = fields[SLOT_DETAIL1].toString("utf8");
	const entryClass = classifyEntry(pos, detail1);
	const rule = resolved.get(entryClass);
	const inScope =
		rule.scope === null ||
		(rule.scope.conjugationTypes.has(fields[SLOT_CONJUGATION_TYPE].toString("utf8")) &&
			rule.scope.conjugationForms.has(fields[SLOT_CONJUGATION_FORM].toString("utf8")));
	const kept = inScope ? rule.kept : ALWAYS_KEPT_SET;
	const compacted = [];
	for (let slot = 0; slot < DETAIL_SLOT_COUNT; slot += 1) {
		compacted.push(kept.has(slot) ? fields[slot] : UNSET_BYTES);
	}
	return {
		fields: compacted,
		targetNoun: entryClass === "target-noun",
		entryClass,
		keptExtraSlots: kept.size > ALWAYS_KEPT_SET.size,
	};
}

function joinRecord(fields) {
	const parts = [];
	for (const [slot, field] of fields.entries()) {
		if (slot > 0) {
			parts.push(NUL);
		}
		parts.push(field);
	}
	const payload = Buffer.concat(parts);
	const record = Buffer.allocUnsafe(4 + payload.length);
	record.writeUInt32LE(payload.length, 0);
	payload.copy(record, 4);
	return record;
}

/**
 * Rebuilds `dict.words` and `dict.wordsidx` from the full pair.
 *
 * Every entry is visited in its original order and none is dropped, so word
 * IDs — which are indices into `dict.wordsidx` — keep pointing at the same
 * entry. `dict.trie`, `dict.vals` and `dict.valsidx` are therefore still
 * correct untouched, and surfaces, context IDs, word costs and the unknown-word
 * dictionary are all unchanged.
 *
 * The new index is derived from the new record lengths alone, so the output is
 * a deterministic function of the input bytes.
 */
export function buildCompactWords(
	words,
	wordsIdx,
	rules = PRODUCTION_SLOT_RULES,
) {
	const resolved = resolvedRules(rules);
	if (wordsIdx.length === 0 || wordsIdx.length % 4 !== 0) {
		throw new Error(
			`dict.wordsidx must be a non-empty multiple of 4 bytes; got ${wordsIdx.length}.`,
		);
	}
	const entryCount = wordsIdx.length / 4;

	const records = [];
	const outIdx = Buffer.allocUnsafe(wordsIdx.length);
	let cursor = 0;
	let targetNounCount = 0;
	const entryClassCounts = Object.fromEntries(
		ENTRY_CLASSES.map((entryClass) => [entryClass, 0]),
	);
	const extendedEntryCounts = Object.fromEntries(
		ENTRY_CLASSES.map((entryClass) => [entryClass, 0]),
	);
	let expectedOffset = 0;

	for (let entry = 0; entry < entryCount; entry += 1) {
		const offset = wordsIdx.readUInt32LE(entry * 4);
		if (offset !== expectedOffset) {
			throw new Error(
				`dict.wordsidx entry ${entry} points at offset ${offset}, but the previous record ends at ${expectedOffset}.`,
			);
		}
		if (offset + 4 > words.length) {
			throw new Error(
				`dict.wordsidx entry ${entry} points past the end of dict.words (${offset} of ${words.length}).`,
			);
		}
		const length = words.readUInt32LE(offset);
		if (offset + 4 + length > words.length) {
			throw new Error(
				`dict.words entry ${entry} claims ${length} bytes at offset ${offset}, past the end of the ${words.length}-byte file.`,
			);
		}
		const payload = words.subarray(offset + 4, offset + 4 + length);
		const { fields, targetNoun, entryClass, keptExtraSlots } = compactFieldsWith(
			splitWordRecord(payload, entry),
			resolved,
		);
		if (targetNoun) {
			targetNounCount += 1;
		}
		entryClassCounts[entryClass] += 1;
		if (keptExtraSlots) {
			extendedEntryCounts[entryClass] += 1;
		}
		const record = joinRecord(fields);
		outIdx.writeUInt32LE(cursor, entry * 4);
		cursor += record.length;
		records.push(record);
		expectedOffset = offset + 4 + length;
	}

	if (expectedOffset !== words.length) {
		throw new Error(
			`dict.words has ${words.length - expectedOffset} trailing bytes after the last indexed record.`,
		);
	}

	return {
		words: Buffer.concat(records),
		wordsIdx: outIdx,
		entryCount,
		targetNounCount,
		entryClassCounts,
		extendedEntryCounts,
	};
}

/**
 * Writes the derived dictionary into its own directory. The extracted archive
 * is only ever read: the two rewritten files are produced from its bytes and
 * every other file is copied unchanged.
 */
export async function generateCompactDictionary(sourceDir, outDir) {
	await assertDictionaryDir(sourceDir, sourceDir, [
		...LINDERA_DICTIONARY_FILE_NAMES,
		LINDERA_NOTICE_FILE_NAME,
	]);

	const words = await readFile(path.join(sourceDir, "dict.words"));
	const wordsIdx = await readFile(path.join(sourceDir, "dict.wordsidx"));
	const compact = buildCompactWords(words, wordsIdx);

	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "dict.words"), compact.words);
	await writeFile(path.join(outDir, "dict.wordsidx"), compact.wordsIdx);
	for (const fileName of [
		...LINDERA_DICTIONARY_FILE_NAMES,
		LINDERA_NOTICE_FILE_NAME,
	]) {
		if (COMPACTED_FILE_NAMES.includes(fileName)) {
			continue;
		}
		await copyFile(
			path.join(sourceDir, fileName),
			path.join(outDir, fileName),
		);
	}

	return {
		outDir,
		entryCount: compact.entryCount,
		targetNounCount: compact.targetNounCount,
		full: await measureDictionaryDir(sourceDir),
		compact: await measureDictionaryDir(outDir),
	};
}
