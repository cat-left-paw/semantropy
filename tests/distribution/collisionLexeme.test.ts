import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	DETAIL_SLOT_COUNT,
	SLOT_BASE_FORM,
	SLOT_CONJUGATION_TYPE,
	SLOT_DETAIL1,
	SLOT_POS,
	splitWordRecord,
} from "../../scripts/lindera/compactDictionary.mjs";
import {
	COLLISION_IRREGULAR_VERB_LEXEMES,
	COLLISION_REGULAR_VERB_CONJUGATION_TYPES,
	inflectRegularVerb,
	isCollisionIrregularLexeme,
} from "../../src/collision/regularInflection";
import { compactDictionaryDir } from "./linderaFixture";

/**
 * `PRE-RELEASE-COLLISION-LEXEME1` against the shipped compact IPADIC.
 *
 * The exclusion set in `src/collision/regularInflection.ts` is justified by a
 * survey of which conjugation classes the dictionary actually assigns to
 * particular lexemes. The first independent re-review found that survey
 * inaccurate: 問う and 請う do carry 五段・ワ行促音便 entries, which the
 * allowlist admits, and the source comment claimed all three of 問う / 請う /
 * 乞う were 五段・ワ行ウ音便 only.
 *
 * Prose cannot hold that kind of claim honestly, so the claim is pinned here
 * against the real dictionary. If a dictionary change moves any of these
 * lexemes between classes, this gate fails and the survey is re-done rather
 * than quietly becoming wrong again.
 *
 * What this pins is the classification and its Collision consequence. It is
 * not a proof that the exclusion set is complete: no mechanical test can
 * decide which of 129,855 verb entries inflect suppletively. See
 * `Docs/pre_release_collision_lexeme1_record.md` §5.2.
 */

type Classification = ReadonlyMap<string, readonly string[]>;

/**
 * Every independent-verb conjugation class the dictionary records for each
 * requested base form. `dict.words` carries the nine detail slots directly, so
 * this reads the shipped bytes rather than inferring a class from a surface.
 */
function classify(baseForms: readonly string[]): Classification {
	const directory = compactDictionaryDir();
	const words = readFileSync(path.join(directory, "dict.words"));
	const index = readFileSync(path.join(directory, "dict.wordsidx"));
	const decoder = new TextDecoder();
	const wanted = new Set(baseForms);
	const found = new Map<string, Set<string>>();
	for (const baseForm of baseForms) {
		found.set(baseForm, new Set<string>());
	}
	for (let entry = 0; entry * 4 < index.length; entry += 1) {
		const offset = index.readUInt32LE(entry * 4);
		const length = words.readUInt32LE(offset);
		const fields = splitWordRecord(
			words.subarray(offset + 4, offset + 4 + length),
			entry,
		).map((field: Uint8Array) => decoder.decode(field));
		expect(fields).toHaveLength(DETAIL_SLOT_COUNT);
		const baseForm = fields[SLOT_BASE_FORM]!;
		if (
			!wanted.has(baseForm) ||
			fields[SLOT_POS] !== "動詞" ||
			fields[SLOT_DETAIL1] !== "自立"
		) {
			continue;
		}
		found.get(baseForm)!.add(fields[SLOT_CONJUGATION_TYPE]!);
	}
	return new Map(
		[...found].map(([baseForm, types]) => [baseForm, [...types].sort()]),
	);
}

/**
 * The recorded classes, exactly as the shipped dictionary has them. Every
 * lexeme the source comment or the record names appears here, including the
 * ones that corrected the original survey.
 */
const PINNED: Readonly<Record<string, readonly string[]>> = {
	// The exclusion set itself.
	ある: ["五段・ラ行"],
	有る: ["五段・ラ行"],
	在る: ["五段・ラ行"],
	// ワ行. 問う carries both classes and 請う only the promotive one, so the
	// allowlist does admit them; 乞う is ウ音便 only and never enters.
	問う: ["五段・ワ行ウ音便", "五段・ワ行促音便"],
	請う: ["五段・ワ行促音便"],
	乞う: ["五段・ワ行ウ音便"],
	言う: ["五段・ワ行ウ音便", "五段・ワ行促音便"],
	買う: ["五段・ワ行促音便"],
	// カ行. 行く is promotive-euphony, a class the allowlist does not name.
	行く: ["五段・カ行促音便", "五段・カ行促音便ユク"],
	// Honorific ラ行. おっしゃる also has a plain 五段・ラ行 entry, so "the
	// honorifics are all 五段・ラ行特殊" was wrong as well; its four Collision
	// forms are nevertheless the regular ones.
	なさる: ["五段・ラ行特殊"],
	下さる: ["五段・ラ行特殊"],
	くださる: ["五段・ラ行特殊"],
	いらっしゃる: ["五段・ラ行特殊"],
	おっしゃる: ["五段・ラ行", "五段・ラ行特殊"],
	ござる: ["五段・ラ行特殊"],
	御座る: ["五段・ラ行特殊"],
	// 一段 lexemes with a second, single-lemma class.
	くれる: ["一段", "一段・クレル"],
	// Kanji spellings that also carry an unrelated 五段・ラ行 lexeme.
	する: ["サ変・スル", "五段・ラ行"],
	来る: ["カ変・来ル", "五段・ラ行"],
	いる: ["一段", "五段・ラ行"],
	居る: ["一段", "五段・ラ行"],
};

describe("Collision lexeme classes in the shipped compact dictionary", () => {
	const recorded = classify(Object.keys(PINNED));

	it("records exactly the conjugation classes the survey claims", () => {
		expect(Object.fromEntries(recorded)).toEqual(PINNED);
	});

	it("admits 問う and 請う through the promotive class and never 乞う", () => {
		// The corrected fact: two of the three are reachable.
		for (const baseForm of ["問う", "請う"]) {
			expect(recorded.get(baseForm)).toContain("五段・ワ行促音便");
			expect(
				inflectRegularVerb({
					conjugationType: "五段・ワ行促音便",
					baseForm,
				}),
			).not.toBeNull();
		}
		expect(recorded.get("乞う")).toEqual(["五段・ワ行ウ音便"]);
		for (const conjugationType of recorded.get("乞う")!) {
			expect(COLLISION_REGULAR_VERB_CONJUGATION_TYPES).not.toContain(
				conjugationType,
			);
			expect(inflectRegularVerb({ conjugationType, baseForm: "乞う" })).toBeNull();
		}
	});

	it("excludes the suppletive ある family although its class is allowed", () => {
		for (const { conjugationType, baseForms } of COLLISION_IRREGULAR_VERB_LEXEMES) {
			// A rule that excluded a class the allowlist never admits would be
			// dead weight covering a gap that does not exist.
			expect(COLLISION_REGULAR_VERB_CONJUGATION_TYPES).toContain(conjugationType);
			for (const baseForm of baseForms) {
				expect(recorded.get(baseForm)).toContain(conjugationType);
				expect(isCollisionIrregularLexeme(conjugationType, baseForm)).toBe(true);
				expect(inflectRegularVerb({ conjugationType, baseForm })).toBeNull();
			}
		}
	});

	it("keeps the regular forms of the allowed classes these lexemes also carry", () => {
		// おっしゃる, くれる and the 五段・ラ行 readings of する / いる reach the
		// allowlist and are regular in all four Collision forms. They are not
		// exclusion candidates, and pinning that here is what makes the
		// exclusion set's scope reviewable.
		expect(
			inflectRegularVerb({ conjugationType: "五段・ラ行", baseForm: "おっしゃる" }),
		).toEqual({
			basic: "おっしゃる",
			past: "おっしゃった",
			progressive: "おっしゃっている",
			negative: "おっしゃらない",
		});
		expect(
			inflectRegularVerb({ conjugationType: "一段", baseForm: "くれる" }),
		).toEqual({
			basic: "くれる",
			past: "くれた",
			progressive: "くれている",
			negative: "くれない",
		});
		expect(
			inflectRegularVerb({ conjugationType: "五段・ラ行", baseForm: "いる" }),
		).toEqual({
			basic: "いる",
			past: "いった",
			progressive: "いっている",
			negative: "いらない",
		});
	});

	it("never reaches a class the allowlist does not name", () => {
		const admitted = new Set(COLLISION_REGULAR_VERB_CONJUGATION_TYPES);
		for (const [baseForm, types] of recorded) {
			for (const conjugationType of types) {
				if (admitted.has(conjugationType)) {
					continue;
				}
				expect(inflectRegularVerb({ conjugationType, baseForm })).toBeNull();
			}
		}
	});
});
