/** COLLISION-LOCK1: development-only defect reintroductions for the generation and row layers. Executed by
 * `verifyBatchMutations.mjs` (without `--view`) in its checked temporary copy, never against the current checkout.
 * Never imported by production. The view layer's are in `viewMutations.mjs`.
 *
 * Each probe puts one rule of the regeneration that keeps a row's words back to the wrong implementation, then runs
 * the one assertion that is supposed to notice. A parse or import failure is not a catch: the named assertion has to
 * be what fails. A test name is a regular expression to the runner, so none holds a bracket, a brace or a plus sign.
 */
const core = "src/collision/collisionCore.ts", batch = "src/collision/collisionBatch.ts";
const coreTest = "tests/collisionLock1.test.ts", batchTest = "tests/collisionLockBatch.test.ts";
const forged = "refuses a word that is kept but is not in this vocabulary";
const shaped = "refuses a literal that is not the set's";
const foreign = "refuses a row of another recipe";
const nothing = "refuses what it was asked to keep when that is nothing";
const begins = "refuses a row, a name or a list the batch cannot honour";
const unreadable = "refuses a list of names or of texts that throws when it is read as a bad request";
const signed = "gives a result the structure signature its own parts make";
const twice = "refuses a name given twice when the row has parts enough";
const asks = "asks the core for the row's own result";

export const lockMutations = [
	// The row is not trusted: what is kept has to be something this pool offers for that part.
	[core, coreTest, "kept-noun-not-offered", "offered = prepared.nouns.some((candidate) => candidate.surface === kept.text);", "offered = true;", forged],
	[core, coreTest, "kept-predicate-not-offered", "offered = (prepared.predicates.get(part.profile) ?? []).some((candidate) => candidate.surface === kept.text);", "offered = true;", forged],
	[core, coreTest, "kept-modifier-not-offered", "(prepared.modifiersByForm.get(part.profile)?.get(kept.formId) ?? []).some((choice) => choice.candidate.surface === kept.text);", "true;", forged],
	[core, coreTest, "kept-modifier-form-any", "offered = admissibleForms(part.profile, pattern).some((form) => form.formId === kept.formId) &&", "offered = true &&",
		"refuses a form the part's profile never draws"],
	// ... and the row has to be a row of the set.
	[core, coreTest, "literal-not-compared", "if (part.kind === \"literal\" && next.text !== pattern.literals.get(part.literalId)) {", "if (false) {", shaped],
	[core, coreTest, "connector-text-not-compared", "if (declared === undefined || next.text !== (declared.literal ?? \"\")) {", "if (declared === undefined) {", shaped],
	[core, coreTest, "presence-not-compared", "!recipe.presence.some((entry) => entry.slots.length === present.size && entry.slots.every((slot) => present.has(slot)))", "false", shaped],
	[core, coreTest, "disabled-recipe-accepted", "if (recipe === undefined || !recipe.enabled) {", "if (recipe === undefined) {", foreign],
	[core, coreTest, "parts-order-not-checked", "if (next === undefined || next.kind !== part.kind || next.slotId !== part.slotId) {", "if (next === undefined) {", foreign],
	// ... and what is asked to be kept has to be some of its words, not all and not none.
	[core, coreTest, "keep-all-allowed", "if (locked.size === 0 || locked.size >= lockable.length) {", "if (locked.size === 0) {", nothing],
	[core, coreTest, "absent-part-named", "if (typeof name !== \"string\" || locked.has(name) || !bySlot.has(name)) {", "if (typeof name !== \"string\" || locked.has(name)) {", nothing],
	// The draw: the kept words stay, the others are drawn again, apart from the kept nouns, and a text already there is refused.
	[core, coreTest, "kept-nouns-not-counted-first", "usedNouns.add(kept.text);", "void kept;", "draws a noun that is not kept apart from the nouns that are"],
	[core, coreTest, "kept-words-redrawn", "const keep = plan.locked.has(part.slotId);", "const keep = false;", "keeps the words that are kept, the recipe"],
	[core, coreTest, "avoid-list-ignored", "if (!avoidTexts.has(candidate.text)) {", "if (true) {", "never accepts a text that is in the avoid list"],
	// The result: its text is its segments joined, and an empty Connector is a segment.
	[core, coreTest, "segments-not-joined", "text: segments.map((segment) => segment.text).join(\"\"),", "text: segments.map((segment) => segment.text).join(\"·\"),", "joins its segments into its text"],
	[core, coreTest, "empty-connector-no-segment", "segments.push({ kind: \"connector\", slotId: part.slotId, text: connector.literal ?? \"\", connectorId: connector.id });",
		"if (connector.literal !== null) segments.push({ kind: \"connector\", slotId: part.slotId, text: connector.literal, connectorId: connector.id });",
		"names the form of a modifier and the Connector drawn"],
	// The row layer.
	[batch, batchTest, "names-any-at-begin", "names.some((name) => !lockable.includes(name)) || ", "", begins],
	[batch, batchTest, "all-names-at-begin", " || names.length >= lockable.length) reject(\"invalid-request\");", ") reject(\"invalid-request\");", begins],
	[batch, batchTest, "whole-row-redrawn", "const generated = op.locks ? generateLockedCollisionResult(", "const generated = false ? generateLockedCollisionResult(", asks],
	[batch, batchTest, "names-dropped", "request, locks: names };", "request, locks: null };", asks],
	[batch, batchTest, "other-recipe-selector", "if (names && selector.kind === \"fixed\" && selector.recipeId !== row.committed.recipeId) reject(\"invalid-request\");", "",
		"refuses to begin while a Generate is pending, and a row whose draft selector"],
	// COLLISION-LOCK1 correction round: the lists a caller hands in are read once, into our own, and a bad one is a bad request.
	[core, coreTest, "locked-list-not-copied", "\t\t\trawLocked = [];\n\t\t\tfor (const name of lockedInput) {\n\t\t\t\trawLocked.push(name);\n\t\t\t}", "\t\t\trawLocked = lockedInput as unknown[];", unreadable],
	[core, coreTest, "avoid-read-error-escapes", "\t} catch {\n\t\treturn null;\n\t}\n}", "\t} catch (error) {\n\t\tthrow error;\n\t}\n}", unreadable],
	// ... and what the result's structure signature is made of.
	[core, coreTest, "signature-forgets-kept-form", "formSignature.push(original.formId);", "void original;", signed],
	[core, coreTest, "signature-forgets-presence", "\t\t\t\t\tpresenceSignature.push(part.slotId);\n\t\t\t\t}\n\t\t\t\tif (keep && original.kind", "\t\t\t\t\tvoid part;\n\t\t\t\t}\n\t\t\t\tif (keep && original.kind", signed],
	[core, coreTest, "signature-forgets-connector", "connectorSignature.push(original.connectorId);", "void original;", signed],
	// The row layer: a name twice, a list copied, and the other rows' texts handed to the core.
	[batch, batchTest, "names-twice-at-begin", "new Set(names).size !== names.length || ", "", twice],
	[batch, batchTest, "names-list-not-copied", "Object.freeze([...(raw as string[])])", "(raw as string[])", "keeps the names it was given as they were at the begin"],
	[batch, batchTest, "avoid-texts-dropped", "avoid: { texts: op.batch!.rows.map((row) => row.committed.text) } })", "avoid: { texts: [] } })", asks],
];

/** The hand check of a new probe (the text to replace occurs once, the named test fails) reads this name. */
export const probes = lockMutations;
