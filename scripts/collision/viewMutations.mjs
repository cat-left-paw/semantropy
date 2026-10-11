/** Development-only defect reintroductions. Executed by verifyBatchMutations --view
 * in its checked temporary copy, never against the current checkout.
 */
const session = "src/view/CollisionSession.ts", modal = "src/view/CollisionModal.ts";
const test = "tests/collisionView.test.ts", lockTest = "tests/collisionLockView.test.ts", styleTest = "tests/collisionLockStyle.test.ts";
export const viewMutations = [
	[session, test, "partial-wording", 'case "duplicate-exhausted": return "Not enough distinct results.";', 'case "duplicate-exhausted": return "Not enough distinct results. The previous results are retained.";', "commits a nonzero partial"],
	[modal, test, "applied-selector", 'draft.selector.kind === "fixed" && draft.selector.recipeId !== row.committed.recipeId', 'draft.selector.kind === "fixed"', "keeps selector changes draft-only"],
	[modal, test, "row-dom-identity", 'this.batchId !== (batch?.batchId ?? null)', 'batch !== null', "rebuilds the rows for a new batch"],
	[modal, test, "pending-controls", '!session.canWrite(row.rowSlotId)', 'false', "disables only the pending row writes"],
	[session, test, "pending-write-guard", 'if (!host || !batch || !this.canWrite(slot)) return;', 'if (!host || !batch) return;', "disables only the pending row writes"],
	[session, test, "active-at-complete", 'await host.scheduler.yieldTask();\n\t\t\tif (!current()) return;\n\t\t\tif (vocabulary && host.active() !== vocabulary) { this.cancel(key); return; }\n\t\t\tif (prepared.ok)', 'await host.scheduler.yieldTask();\n\t\t\tif (!current()) return;\n\t\t\tif (prepared.ok)', "refuses Generate completion when source"],
	[session, test, "close-release", 'this.controller = null;', '/* mutant retains released controller */', "rejects late completion after modal"],
	[session, test, "late-write-feedback", 'if (this.host === host && this.writes.get(slot) === operation)', 'if (true)', "drops write feedback after close"],
	["src/SemantropyPlugin.ts", test, "plugin-disable", 'for (const view of this.semantropyViews()) view.disableCollision();', '', "disables Collision by itself"],
	["src/view/SemantropyToolbar.ts", "tests/toolbarView.test.ts", "toolbar-classification", 'this.group("is-generation", () => ui().toolbar.groups.generation)', 'this.group("is-generation", () => ui().toolbar.groups.settings)', "classifies Collision as phrase generation"],
	// COLLISION-LOCK1: locking a word in the dialog.
	[modal, lockTest, "lock-text-always-rebuilt", "if (ui.rowId !== row.committed.rowId || ui.text.textContent !== row.committed.text) this.renderText(ui, row.committed);", "this.renderText(ui, row.committed);", "rebuilds nothing"],
	[modal, lockTest, "lock-mark-not-set", "if (word.getAttribute(\"aria-pressed\") !== String(on)) word.setAttribute(\"aria-pressed\", String(on));", "", "is a click on it and again to release"],
	[modal, lockTest, "regenerate-always-possible", "ui.regenerate.disabled = !!state?.generation.pending || !session.canRegenerate(row.rowSlotId);", "ui.regenerate.disabled = !!state?.generation.pending;", "cannot be pressed once every part that can be kept is locked"],
	[modal, lockTest, "space-does-not-lock", "if (key !== \"Enter\" && key !== \" \") return;", "if (key !== \"Enter\") return;", "is a click on it and again to release"],
	// A drag over the words is a click that ends with a new selection of this row's text (a selection made by the press).
	[modal, lockTest, "drag-guard-removed", "if (before !== null && !now.empty && text.contains(now.anchor) && !sameSelection(before, now)) return;", "", "is not a click on a word when the pointer press is followed by a new selection"],
	[modal, lockTest, "drag-guard-counts-old-selection", " && !sameSelection(before, now)", "", "is a click on a word when a selection was already there at the press"],
	[modal, lockTest, "drag-guard-counts-other-text", "!now.empty && text.contains(now.anchor) && ", "!now.empty && ", "is a click on a word when the new selection is not in this row text"],
	[modal, lockTest, "drag-guard-without-a-press", "if (before !== null && !now.empty", "if (!now.empty", "is a click on a word when the new selection is not in this row text"],
	[modal, lockTest, "drag-guard-on-keys", "if (event.type === \"click\") {\n\t\t\t\tconst before", "if (event.type === \"click\" || event.type === \"keydown\") {\n\t\t\t\tconst before", "is a click on a word when the new selection is not in this row text"],
	[modal, lockTest, "press-listener-stays", "text.removeEventListener(\"pointerdown\", press); ", "", "puts three listeners on a row text and none on its words"],
	// The look: the solid underline of a locked word, and the pointer's mark only for a pointer that can hover.
	["styles.css", styleTest, "locked-underline-gone", "\ttext-decoration: underline solid;\n", "", "marks a locked word by a background and a solid underline"],
	["styles.css", styleTest, "hover-mark-for-every-pointer", "@media (hover: hover) {\n\t.semantropy-collision-word:hover {", "@media all {\n\t.semantropy-collision-word:hover {", "shows the pointer's mark only where the pointer can hover"],
	[session, lockTest, "lock-while-pending", "return !!this.committedRow(slot) && !state?.generation.pending && !state?.rowDrafts.find(row => row.rowSlotId === slot)?.pending;", "return !!this.committedRow(slot);", "is not possible while that row, or the list, is being generated"],
	[session, lockTest, "locks-not-used", "const begun = kept.length > 0", "const begun = false", "keeps the locked word and the lock"],
];
