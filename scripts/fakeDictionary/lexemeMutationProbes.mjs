/**
 * FAKE-DICT-LEXEME1 probes for the shared temporary-copy runner
 * (`node scripts/adverb/verifyAdverbMutations.mjs --fake-dict-lexeme`).
 * Each one breaks one rule of the lexical placeholders: which pools carry a
 * lexical list, what the fingerprint sees, which list fills a placeholder,
 * when a template is usable, and the build-time follower guard. The named
 * assertion has to be what fails. The checkout is never written.
 */
const TEMPLATE = "src/dictionary/template.ts";
const POOL = "src/dictionary/vocabularyPool.ts";
const FORMS = "src/dictionary/snapshotLexicalForms.ts";
const FOLLOWERS = "src/dictionary/lexicalFollowers.ts";
const GENERATOR = "scripts/fakeDictionary/standardTemplates.mjs";
const TEST = "tests/fakeDictionaryLexeme.test.ts";
const DISTRIBUTION = "tests/distribution/fakeDictionaryLexeme.test.ts";
const REFUSES = "refuses a";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	// Which pools carry a lexical list, and what the fingerprint sees.
	[TEMPLATE, TEST, "every-pool-carries-every-list",
		"FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS.filter((placeholder) => used.has(placeholder))",
		"FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS.filter(() => used.size >= 0)",
		"leaves out every lexical list for a set that uses none"],
	[TEMPLATE, DISTRIBUTION, "every-pool-carries-every-list-presets",
		"FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS.filter((placeholder) => used.has(placeholder))",
		"FAKE_DICTIONARY_LEXICAL_PLACEHOLDERS.filter(() => used.size >= 0)",
		"leaves every definition of the three web presets as it was on main"],
	[POOL, TEST, "fingerprint-ignores-lexical-lists",
		"for (const placeholder of [...FAKE_DICTIONARY_PLACEHOLDERS, ...presentLexical(pool)])",
		"for (const placeholder of [...FAKE_DICTIONARY_PLACEHOLDERS])",
		"adds the shared lists for exactly the lexical placeholders a set uses"],
	[FORMS, TEST, "stem-placeholder-reads-adjectives",
		"	naStem: naAdjectiveStems,", "	naStem: iAdjectiveBasicForms,",
		"adds the shared lists for exactly the lexical placeholders a set uses"],
	// When a template is usable.
	// Review 1: slot availability and the diagnostics read the lexical lists (here mutated to read them as empty).
	["src/analysis/displaySlots.ts", TEST, "availability-ignores-lexical-lists",
		"			if (snapshotPlaceholderSurfaces(snapshot, placeholder).length === 0) {",
		"			if ((placeholder in snapshot.projections.dictionary.byPlaceholder ? snapshotPlaceholderSurfaces(snapshot, placeholder) : []).length === 0) {",
		"marks a headword slot available when only a lexical template can be filled"],
	["src/view/dictionaryDiagnosticModel.ts", TEST, "diagnostics-ignore-lexical-lists",
		"required.every(key => snapshotPlaceholderSurfaces(snapshot, key).length > 0)",
		"required.every(key => key in projection && snapshotPlaceholderSurfaces(snapshot, key).length > 0)",
		"counts the one usable template in the diagnostics"],
	[POOL, TEST, "absent-list-counts-as-candidates",
		"	return poolCandidates(pool, placeholder).length > 0;",
		"	return pool[placeholder] === undefined || poolCandidates(pool, placeholder).length > 0;",
		"drops a template whose lexical list is empty"],
	// The follower guard.
	[FOLLOWERS, TEST, "lexical-at-the-end-accepted",
		'				issues.push({ code: "lexical-at-end", id: entry.id, detail: segment.placeholder });', "				void 0;", REFUSES],
	[FOLLOWERS, TEST, "anything-after-na",
		'		if (text.startsWith("な")) return nounFollows(text.slice(1), after);', '		if (text.startsWith("な")) return true;', REFUSES],
	[FOLLOWERS, TEST, "listed-noun-as-prefix",
		"(text.length === noun.length || tails.includes(text.charAt(noun.length)))", "true", REFUSES],
	[FOLLOWERS, TEST, "bare-stem-before-noun-placeholder",
		'		return placeholder !== "naStem" && isNounSegment(following);', "		return isNounSegment(following);", REFUSES],
	[FOLLOWERS, TEST, "bare-stem-before-han",
		'	if (placeholder === "naStem") {\n		if (text.startsWith("な"))',
		'	if (startsWithNoun(text)) return true;\n	if (placeholder === "naStem") {\n		if (text.startsWith("な"))', REFUSES],
	[FOLLOWERS, TEST, "sa-without-a-tail",
		"			return tails.includes(text.charAt(1));", "			return true;", REFUSES],
	[FOLLOWERS, TEST, "adjective-takes-verb-followers",
		'placeholder === "verb" ? VERB_FOLLOWERS : I_ADJECTIVE_FOLLOWERS', "VERB_FOLLOWERS", REFUSES],
	// Stage B: the standard templates (template set 2).
	["resources/fake-dictionary/standard-templates.md", "tests/fakeDictionaryTemplateSource.test.ts", "standard-template-bare-stem",
		"{{naStem}}な性質。", "{{naStem}}性質。", "is exactly what the document implies"],
	["src/application/prepareVocabulary.ts", DISTRIBUTION, "standard-pool-without-lexical-lists",
		"  ...lexicalPlaceholdersOf(templateSet).map(", "  ...lexicalPlaceholdersOf(templateSet).slice(3).map(",
		"measures how many use a new template"],
	[GENERATOR, TEST, "generator-skips-the-guard",
		"	if (followers.length > 0) {", "	if (followers.length < 0) {",
		"refuses a document whose lexical placeholder has an unaccepted follower"],
];
