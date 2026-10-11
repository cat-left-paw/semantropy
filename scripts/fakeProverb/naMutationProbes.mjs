/**
 * FAKE-PROVERB-NA1 probes for the shared temporary-copy runner
 * (`node scripts/adverb/verifyAdverbMutations.mjs --fake-proverb-na`).
 * Each one breaks one rule of Recipe Schema 2's position check or of the
 * stem candidates; the named assertion has to be what fails. The checkout
 * is never written.
 */
const COMPILER = "src/fakeProverb/compileRecipeSet.ts";
const SCHEMA = "src/fakeProverb/recipeData.ts";
const AUTHORITY = "src/fakeProverb/fakeProverbAuthority.ts";
const LEXICAL = "src/vocabulary/lexicalProjection.ts";
const RECIPES_TEST = "tests/fakeProverbRecipeSource.test.ts";
const NA_TEST = "tests/fakeProverbNa.test.ts";
const NA_DISTRIBUTION = "tests/distribution/fakeProverbNa.test.ts";
const NA_REFUSED = "refuses a stem plus な before";
const ADVERBIAL_REFUSED = "refuses an adverbial slot before";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	// The な follower check (compiler).
	[COMPILER, RECIPES_TEST, "na-follower-unchecked",
		'if (!fits) issues.push(issue("na-follower", id, slotId));', "void fits;", NA_REFUSED],
	[COMPILER, RECIPES_TEST, "na-before-any-literal",
		'(next?.kind === "literal" && startsWithNoun(literalText.get(next.literalId) ?? ""))', '(next?.kind === "literal")', NA_REFUSED],
	[COMPILER, RECIPES_TEST, "na-at-recipe-end",
		'const fits = nextClass === "noun" ||', 'const fits = next === undefined || nextClass === "noun" ||', NA_REFUSED],
	[COMPILER, RECIPES_TEST, "listed-noun-as-prefix",
		"(literal.length === noun.length || tails.includes(literal.charAt(noun.length)))", "true", NA_REFUSED],
	[COMPILER, RECIPES_TEST, "hiragana-as-noun",
		"/^[\\p{Script=Han}\\p{Script=Katakana}]/u", "/^[\\p{Script=Han}\\p{Script=Katakana}\\p{Script=Hiragana}]/u", NA_REFUSED],
	[COMPILER, RECIPES_TEST, "exported-na-modifier-forgotten",
		"naProfiles.has(part.profileId)) naExports.add(part.slotId);", "naProfiles.has(part.profileId)) void part;",
		"judges a required modifier by the profiles the proverbs export it with"],
	[COMPILER, RECIPES_TEST, "local-na-modifier-forgotten",
		"				localNa.add(part.slotId);\n", "", NA_REFUSED],
	// The adverbial follower check (compiler) and its limit (schema).
	[COMPILER, RECIPES_TEST, "adverbial-follower-unchecked",
		'issues.push(issue("adverbial-follower", id, slotId));', "void slotId;", ADVERBIAL_REFUSED],
	[COMPILER, RECIPES_TEST, "adverbial-before-na-modifier",
		'nextClass !== "predicate" && nextClass !== "modifier"', 'nextClass !== "predicate" && nextClass !== "modifier" && nextClass !== "na-modifier"', ADVERBIAL_REFUSED],
	[SCHEMA, RECIPES_TEST, "two-adverbials-in-a-proverb",
		"proverb: { noun: 4, modifier: 2, predicate: 1, adverbial: 1 },", "proverb: { noun: 4, modifier: 2, predicate: 1, adverbial: 2 },",
		"refuses a second adverbial slot"],
	// The stem candidates (authority).
	[AUTHORITY, NA_TEST, "stem-list-bypassed",
		"for (const stem of naAdjectiveStems(snapshot)) {",
		'for (const stem of snapshot.projections.manual.candidates.filter((record) => record.collisionRole === "noun" && record.morphology.detail1 === "形容動詞語幹")) {',
		"never offers a 連体詞-like stem"],
	[AUTHORITY, NA_TEST, "one-suffix-for-both-forms",
		"const surface = stem.surface + suffix;", 'const surface = stem.surface + "な";', "never offers a 連体詞-like stem"],
	[AUTHORITY, NA_TEST, "stem-counted-once",
		"positive(stem.frequency), mergeOrigins([stem.origins])", "positive(1), mergeOrigins([stem.origins])",
		"offers each stem the shared list gives"],
	[AUTHORITY, NA_TEST, "stem-evidence-names-the-surface",
		'{ kind: "stem", stem: stem.surface, suffix }', '{ kind: "stem", stem: surface, suffix }', "offers each stem the shared list gives"],
	// The shared exclusion, against the shipped dictionary and tokenizer.
	// こんな, そんな and どんな also end in な, which rules them out twice; おんなじ is ruled out by the set alone.
	[LEXICAL, NA_DISTRIBUTION, "onnaji-takes-na",
		'Object.freeze(["おんなじ", "こんな", "そんな", "どんな", "同じ"])', 'Object.freeze(["こんな", "そんな", "どんな", "同じ"])',
		"never gives こんな, そんな, どんな or おんなじ an ending"],
];
