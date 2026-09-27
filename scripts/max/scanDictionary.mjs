import { readFileSync } from "node:fs";
import path from "node:path";
import {
	DETAIL_SLOT_COUNT,
	SLOT_BASE_FORM,
	SLOT_CONJUGATION_FORM,
	SLOT_CONJUGATION_TYPE,
	SLOT_DETAIL1,
	SLOT_DETAIL2,
	SLOT_DETAIL3,
	SLOT_POS,
	splitWordRecord,
} from "../lindera/compactDictionary.mjs";
import {
	linderaCompactDictionaryDir,
	linderaFullDictionaryDir,
} from "../lindera/linderaSource.mjs";

/**
 * `PRE-RELEASE-MAX-REALIZATION-SPIKE1` read-only scan of the shipped compact
 * IPADIC.
 *
 * This module only *reads* `dict.words` / `dict.wordsidx` and returns plain
 * data. It builds no tokenizer, writes nothing, and reaches no production
 * module other than the build script's own slot constants — which is the point:
 * a distribution gate and a measurement tool must agree about what a slot is
 * without either of them re-deciding it.
 *
 * What a record does *not* contain is the surface. Lindera keeps the surface as
 * the trie key, so an inflected verb entry carries its 基本形 in slot 6 and
 * nothing that spells the inflected word. Every claim here is therefore about
 * (class, form, base form) — never about an ending read off a surface — and the
 * realizer round-trip is proved separately by tokenizing constructed text with
 * the production adapter.
 */

export const VERB_POS = "動詞";
export const ADJECTIVE_POS = "形容詞";
export const INDEPENDENT = "自立";
export const UNSET = "*";

export function readEntries(directory) {
	const words = readFileSync(path.join(directory, "dict.words"));
	const index = readFileSync(path.join(directory, "dict.wordsidx"));
	const decoder = new TextDecoder();
	const entries = [];
	for (let entry = 0; entry * 4 < index.length; entry += 1) {
		const offset = index.readUInt32LE(entry * 4);
		const length = words.readUInt32LE(offset);
		entries.push(
			splitWordRecord(
				words.subarray(offset + 4, offset + 4 + length),
				entry,
			).map((field) => decoder.decode(field)),
		);
	}
	return entries;
}

export function compactDir(root = process.cwd()) {
	return linderaCompactDictionaryDir(root);
}

export function fullDir(root = process.cwd()) {
	return linderaFullDictionaryDir(root);
}

function bump(map, key) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

function push(map, key, value) {
	const list = map.get(key);
	if (list) {
		list.push(value);
		return;
	}
	map.set(key, [value]);
}

/**
 * Every top-level aggregate SPIKE1 §1 asks for, over one dictionary.
 *
 * `classForm` is keyed `pos\u001fdetail1\u001ftype\u001fform` so a verb and an
 * adjective that happen to share a form name never merge, and
 * `baseFormClasses` records which (type, form) pairs each base form is seen
 * with — the evidence for "one lemma, many forms" and for a base form that
 * carries two conjugation classes at once.
 */
export function scanDistribution(entries) {
	const pos = new Map();
	const detail1 = new Map();
	const detail2 = new Map();
	const detail3 = new Map();
	const conjugationType = new Map();
	const conjugationForm = new Map();
	const classForm = new Map();
	const baseFormClasses = new Map();
	const verbTypeForm = new Map();
	const adjectiveTypeForm = new Map();
	const representative = new Map();
	let inflecting = 0;

	for (const entry of entries) {
		if (entry.length !== DETAIL_SLOT_COUNT) {
			throw new Error(`entry with ${entry.length} slots`);
		}
		const p = entry[SLOT_POS];
		const d1 = entry[SLOT_DETAIL1];
		bump(pos, p);
		bump(detail1, `${p}\u001f${d1}`);
		bump(detail2, `${p}\u001f${d1}\u001f${entry[SLOT_DETAIL2]}`);
		bump(detail3, `${p}\u001f${d1}\u001f${entry[SLOT_DETAIL3]}`);
		bump(conjugationType, entry[SLOT_CONJUGATION_TYPE]);
		bump(conjugationForm, entry[SLOT_CONJUGATION_FORM]);

		const independentVerb = p === VERB_POS && d1 === INDEPENDENT;
		const independentAdjective = p === ADJECTIVE_POS && d1 === INDEPENDENT;
		if (!independentVerb && !independentAdjective) {
			continue;
		}
		inflecting += 1;
		const type = entry[SLOT_CONJUGATION_TYPE];
		const form = entry[SLOT_CONJUGATION_FORM];
		const base = entry[SLOT_BASE_FORM];
		const key = `${type}\u001f${form}`;
		bump(classForm, `${p}\u001f${d1}\u001f${key}`);
		bump(independentVerb ? verbTypeForm : adjectiveTypeForm, key);
		if (!representative.has(`${p}\u001f${key}`)) {
			representative.set(`${p}\u001f${key}`, base);
		}
		push(baseFormClasses, `${p}\u001f${base}`, key);
	}

	return {
		total: entries.length,
		inflecting,
		pos,
		detail1,
		detail2,
		detail3,
		conjugationType,
		conjugationForm,
		classForm,
		verbTypeForm,
		adjectiveTypeForm,
		baseFormClasses,
		representative,
	};
}

/** Distinct base forms, and the ones carrying more than one conjugation class. */
export function baseFormSummary(distribution) {
	const distinct = new Set();
	const multiClass = [];
	const byType = new Map();
	for (const [key, pairs] of distribution.baseFormClasses) {
		const [pos, base] = key.split("\u001f");
		distinct.add(key);
		const types = new Set(pairs.map((pair) => pair.split("\u001f")[0]));
		for (const type of types) {
			const set = byType.get(type) ?? new Set();
			set.add(base);
			byType.set(type, set);
		}
		if (types.size > 1) {
			multiClass.push({ pos, base, types: [...types].sort() });
		}
	}
	multiClass.sort((a, b) =>
		a.base === b.base ? a.pos.localeCompare(b.pos) : a.base.localeCompare(b.base),
	);
	return { distinct: distinct.size, multiClass, byType };
}

export function toObject(map) {
	return Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
