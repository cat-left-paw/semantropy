/**
 * FAKE-PROVERB-RECIPES3 probes for the shared temporary-copy runner
 * (`node scripts/adverb/verifyAdverbMutations.mjs --fake-proverb-recipes3`).
 * Each one breaks one rule of the one-line recipe format, of the Japanese
 * explanation, or of what the slice changed in the product (a proverb without a
 * noun, the limits); the named assertion has to be what fails. The checkout is
 * never written. A test name is a regular expression to the runner, so the names
 * here hold no bracket, brace or plus sign.
 */
const PARSER = "scripts/fakeProverb/standardRecipes.mjs";
const COMPILER = "src/fakeProverb/compileRecipeSet.ts";
const SCHEMA = "src/fakeProverb/recipeData.ts";
const SOURCE_TEST = "tests/fakeProverbRecipeSource.test.ts";
const DATA_TEST = "tests/fakeProverbRecipes3.test.ts";
const GLOSS_HOLES = "reads a gloss's holes as requirements, references and new slots named g1, g2 … in order of appearance";
const FIXED_TEXT = "makes one literal of each run of fixed text, names it from the text, and shares equal text";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	// How a hole becomes a part.
	[PARSER, SOURCE_TEST, "minus-is-ignored",
		'profileId: profileOf(kind, hole[4], entry, piece.hole), exported: hole[1] !== "-" });', "profileId: profileOf(kind, hole[4], entry, piece.hole), exported: true });",
		"uses the kind's profile without a tag when a hole names none, and keeps a slot written with - from the gloss"],
	[PARSER, SOURCE_TEST, "the-same-new-word-is-a-second-slot",
		"if (locals.has(name)) {", "if (locals.has(`${name}!`)) {",
		GLOSS_HOLES],
	[PARSER, SOURCE_TEST, "requirements-are-not-collected",
		"			if (!required.has(name)) {\n				required.add(name);\n				requires.push({ kind, slotId: name });\n			}", "			required.add(name);",
		GLOSS_HOLES],
	[PARSER, SOURCE_TEST, "new-words-are-numbered-as-written",
		"const slotId = `g${locals.size + 1}`;", "const slotId = `g${hole[3]}`;",
		GLOSS_HOLES],
	[PARSER, SOURCE_TEST, "tag-is-ignored",
		'const id = byTag.get(kind).get(tag ?? "");', "const id = [...byTag.get(kind).values()][0];",
		"parses to recipe data 4, and the lock keeps the digests of all four versions"],
	[PARSER, SOURCE_TEST, "tag-accepted-on-a-proverb's-word",
		"			if (hole[4] !== undefined) { referenceTag(); continue; }\n			if (!required.has(name)) {", "			if (!required.has(name)) {",
		"refuses a tag on a proverb's word in a gloss"],
	[PARSER, SOURCE_TEST, "plus-accepted-in-a-proverb",
		'				if (hole[1] === "+") {\n					issues.push(issue("local-hole-in-proverb"', '				if (hole[1] === "?") {\n					issues.push(issue("local-hole-in-proverb"',
		"refuses a plus hole in a proverb"],
	[PARSER, SOURCE_TEST, "two-default-profiles-accepted",
		"			if (tags.has(key)) {", "			if (tags.has(key) && tag !== undefined) {",
		"refuses two default profiles of one kind"],
	// Fixed text.
	[PARSER, SOURCE_TEST, "equal-text-is-not-shared",
		"		if (!literalIds.has(text)) {", "		if (!literalIds.has(text) || text.length > 0) {",
		FIXED_TEXT],
	[PARSER, SOURCE_TEST, "literal-id-from-its-place",
		"			const id = fakeProverbLiteralId(text);", "			const id = fakeProverbLiteralId(String(literals.length));",
		FIXED_TEXT],
	[PARSER, SOURCE_TEST, "an-id-clash-is-not-named",
		"			if (clash !== undefined) {", "			if (clash !== undefined && text === \"\") {",
		"stops when two different fixed texts get the same id"],
	// The Japanese explanation.
	[PARSER, SOURCE_TEST, "explanation-names-the-compiler's-slot",
		'const hole = recipe?.holes.get(slotId ?? "") ?? (slotId === null ? "穴" : `{${slotId}}`);', 'const hole = slotId === null ? "穴" : `{${slotId}}`;',
		"shows a gloss's new word as it was written"],
	[PARSER, SOURCE_TEST, "a-problem-names-the-heading",
		"recipes.set(entry.id, { kind: entry.kind, line: entry.textLine ?? entry.line, holes });", "recipes.set(entry.id, { kind: entry.kind, line: entry.line, holes });",
		"reports every problem in document order with the line it is on"],
	[PARSER, SOURCE_TEST, "one-mistake-is-said-twice",
		"		const sentence = `${entry.line} 行目${where}: ${text}`;", "		const sentence = `${entry.line} 行目${where}: ${text}${entry.code}`;",
		"says one mistake once when the compiler reports it under two codes"],
	// The product: a proverb without a noun, and the limits.
	[COMPILER, SOURCE_TEST, "a-proverb-needs-a-noun-again",
		'	if (exports.length === 0) issues.push(issue("missing-export", id));', '	if (exports.length === 0 || slotCounts.noun === 0) issues.push(issue("missing-export", id));',
		"accepts a proverb without a noun slot"],
	[SCHEMA, DATA_TEST, "the-proverb-limit-is-64-again",
		"	proverbs: 128,", "	proverbs: 64,",
		"stays inside the raised limits"],
	[SCHEMA, DATA_TEST, "the-literal-limit-is-128-again",
		"	literals: 512,", "	literals: 128,",
		"keeps Recipe Schema 2 and algorithm 2, and binds every form the 14 profiles use"],
];
