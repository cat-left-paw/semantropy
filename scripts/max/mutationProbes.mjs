/** `PRE-RELEASE-MAX-REALIZATION-SPIKE1` mutation probes, run by
 * `scripts/adverb/verifyAdverbMutations.mjs --max` in a private temporary copy.
 * The checkout is never written. Never imported by production.
 *
 * Each probe reverts one decision this SPIKE took to the wrong implementation
 * the task or the policy names, then runs the single named assertion that is
 * supposed to notice. A probe that "passes" because the file no longer parses
 * is a survivor, not a catch: the named assertion has to be the thing that
 * fails.
 *
 * `REALIZER`, `KEYS` and `PROFILES` are the prototype; `ADVERB` is this
 * slice's own adverb *model*, not the production adverb path, which this slice
 * does not change. `DISTRIBUTION` is the gate itself — mutating its expected
 * counts is how the gate is shown to compare against the shipped dictionary
 * rather than against itself.
 */

const REALIZER = "tests/support/max/maxRealizer.ts";
const KEYS = "tests/support/max/targetFormKey.ts";
const PROFILES = "tests/support/max/profiles.ts";
const ADVERB = "tests/support/max/adverbProfiles.ts";
const PURE = "tests/maxRealization.test.ts";
const DISTRIBUTION = "tests/distribution/maxRealization.test.ts";
const ADVERB_TEST = "tests/distribution/maxAdverbProfiles.test.ts";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	[
		REALIZER,
		PURE,
		"irregular-exclusion-removed",
		'	if (isMaxIrregularLexeme(candidate.conjugationType, candidate.baseForm)) {\n		return { realized: false, reason: "irregular-lexeme" };\n	}\n',
		"",
		"refuses the suppletive and artifact lexemes, for every key",
	],
	[
		REALIZER,
		DISTRIBUTION,
		"artifact-lexemes-dropped-from-the-exclusion",
		'	["一段", new Set(["へるる", "のぼりつめるる", "上り詰めるる"])],\n',
		"",
		"re-derives the expansion-artifact exclusion over every admitted class",
	],
	[
		// `unsupported-target-form` is unreachable while the key map covers the
		// Manual allowlist exactly, so the load-bearing thing is that coverage,
		// not the branch. Removing one pair has to be caught.
		KEYS,
		DISTRIBUTION,
		"target-form-key-map-no-longer-covers-the-allowlist",
		'	["verb\\u001f連用タ接続\\u001faux-da", "verb-ta-stem-d"],\n',
		"",
		"names one Target requirement per allowed form and connection pair",
	],
	[
		// And a requirement is never invented for a pair the map does not name.
		// The fallback the task forbids is a fallback to a *positive* result,
		// which is what this probe installs.
		KEYS,
		PURE,
		"unsupported-target-form-falls-back-to-basic",
		'	const key = KEYS.get(composite);\n	return key\n		? { supported: true, key }\n		: { supported: false, reason: "unsupported-target-form" };',
		'	return { supported: true, key: "verb-basic" };',
		"splits the past slot by the auxiliary the Target already carries",
	],
	[
		REALIZER,
		PURE,
		"base-form-class-consistency-removed",
		"	if (!baseForm.endsWith(ending)) {\n		return null;\n	}",
		"	if (false) {\n		return null;\n	}",
		"refuses a base form whose ending disagrees with its recorded class",
	],
	[
		REALIZER,
		PURE,
		"required-field-check-removed",
		'	if (!present(candidate.conjugationType) || !present(candidate.baseForm)) {\n		return { realized: false, reason: "missing-field" };\n	}',
		'	if (false) {\n		return { realized: false, reason: "missing-field" };\n	}',
		"refuses a compacted or empty required field",
	],
	[
		KEYS,
		PURE,
		"target-follower-dropped-from-the-requirement",
		'		connection.compatibility.targetConnection ?? "null",',
		'		connection.compatibility.conjugationForm === "連用タ接続"\n			? "aux-ta"\n			: connection.compatibility.targetConnection ?? "null",',
		"splits the past slot by the auxiliary the Target already carries",
	],
	[
		REALIZER,
		PURE,
		"target-admission-check-removed",
		'	if (!ADMITS[key].includes(candidate.conjugationType)) {\n		return { realized: false, reason: "class-not-admitted-by-target" };\n	}',
		"	if (false) {\n		return { realized: false, reason: \"class-not-admitted-by-target\" };\n	}",
		"refuses a class the Target does not admit, before building anything",
	],
	[
		REALIZER,
		DISTRIBUTION,
		"ta-voicing-collapsed-into-one-key",
		'		"verb-ta-stem-t": voiced("t"),\n		"verb-ta-stem-d": voiced("d"),',
		"		\"verb-ta-stem-t\": REGULAR_VERB_CONJUGATION_TYPES,\n		\"verb-ta-stem-d\": REGULAR_VERB_CONJUGATION_TYPES,",
		"builds 泳いだ and 書いた, and never 泳いた or 書いだ",
	],
	[
		// Both halves of the surface guard at once. They overlap by design —
		// the first refuses the record, the second is the backstop on the
		// constructed string — so neither is removable alone in a way a test
		// could see, and the probe removes the guard rather than half of it.
		REALIZER,
		PURE,
		"unsafe-surface-guard-removed",
		'	if (!isSafeCollisionSurface(candidate.baseForm)) {\n		return { realized: false, reason: "unsafe-surface" };\n	}',
		'	if (false) {\n		return { realized: false, reason: "unsafe-surface" };\n	}',
		"refuses an unsafe base form before it can reach a surface",
	],
	[
		DISTRIBUTION,
		DISTRIBUTION,
		"coverage-fixture-count-changed",
		"	一段: { 基本形: 5_973, 未然形: 5_973, 未然ウ接続: 5_973, 連用形: 5_973, 連用タ接続: 0, 仮定形: 5_973 },",
		"	一段: { 基本形: 5_973, 未然形: 5_973, 未然ウ接続: 5_973, 連用形: 5_973, 連用タ接続: 5_973, 仮定形: 5_973 },",
		"has the independent-verb class x form matrix the realizer is built on",
	],
	[
		DISTRIBUTION,
		DISTRIBUTION,
		"coverage-fixture-class-changed",
		'	"形容詞・アウオ段": { 基本形: 1_134, 連用テ接続: 2_268, 連用タ接続: 1_134, 仮定形: 1_134 },',
		'	"形容詞・アウオ段": { 基本形: 1_134, 連用テ接続: 1_134, 連用タ接続: 1_134, 仮定形: 1_134 },',
		"has the independent-adjective matrix, including the doubled 連用テ接続",
	],
	[
		PROFILES,
		DISTRIBUTION,
		"high-and-max-collapsed-to-one-candidate-set",
		"			if (lexemeFamily === family) high.add(realized.surface);",
		"			high.add(realized.surface);",
		"separates the three profiles without widening the noun set",
	],
	[
		PROFILES,
		PURE,
		"lexeme-identity-splits-one-lemma-per-form",
		"		token.baseForm,\n	]);",
		"		token.baseForm,\n		token.conjugationForm,\n	]);",
		"counts one lemma observed in three forms as one lexeme, once",
	],
	[
		// The defect the second review found: the reading a token carries is the
		// reading of the inflected form (アルク / アルイ / アルキ), so keying on
		// it splits the very lemma the identity exists to join.
		PROFILES,
		PURE,
		"lexeme-identity-keys-on-the-inflected-reading",
		"		token.baseForm,\n	]);",
		"		token.baseForm,\n		token.reading ?? null,\n	]);",
		"counts one lemma observed in three forms as one lexeme, once",
	],
	[
		// And the same defect against the real tokenizer rather than a fixture.
		PROFILES,
		DISTRIBUTION,
		"lexeme-identity-keys-on-the-inflected-reading-in-real-text",
		"		token.baseForm,\n	]);",
		"		token.baseForm,\n		token.reading ?? null,\n	]);",
		"aggregates one lemma observed in five real forms into one lexeme",
	],
	[
		// Policy 1 §4.1: High drops the fine sub-bucket match for nouns. The
		// first version of this slice reused the strict bucket for all three.
		PROFILES,
		DISTRIBUTION,
		"noun-high-and-max-left-at-the-strict-bucket",
		"			const relaxed = surfacesExcludingCurrent(nounFamilySurfaces, token.surface).size;",
		"			const relaxed = strict;",
		"separates the three profiles without widening the noun set",
	],
	[
		// And the relaxation must stay a dropped constraint, never a wider
		// candidate source: pulling in Manual records would admit words the
		// automatic noun projection never published.
		PROFILES,
		DISTRIBUTION,
		"noun-relaxation-reaches-outside-the-automatic-projection",
		"	const nounFamilySurfaces = new Set(\n		vocabulary.snapshot.projections.automaticBody.buckets.flatMap((bucket) =>\n			bucket.surfaces.map((entry) => entry.surface),\n		),\n	);",
		"	const nounFamilySurfaces = new Set(\n		vocabulary.snapshot.projections.manual.candidates.map((record) => record.surface),\n	);",
		"separates the three profiles without widening the noun set",
	],
	[
		ADVERB,
		ADVERB_TEST,
		"adverb-duplicate-to-guard-removed",
		'	if (targetProfile.bridge === "to" && adverbSurfaceEndsWithTo(candidate.surface)) {\n		return { usable: false, reason: "duplicate-to-bridge" };\n	}\n',
		"",
		"refuses the duplicate external と at every level, including MAX",
	],
	[
		ADVERB,
		ADVERB_TEST,
		"adverb-high-drops-the-observation-requirement",
		'		if (entry === null || entry.profiles.length === 0) {\n			return { usable: false, reason: "no-observation" };\n		}',
		"		if (false) {\n			return { usable: false, reason: \"no-observation\" };\n		}",
		"still requires an observation at High and does not at MAX",
	],
];
