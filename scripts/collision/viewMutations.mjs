/** Development-only defect reintroductions. Executed by verifyBatchMutations --view
 * in its checked temporary copy, never against the current checkout.
 */
const session = "src/view/CollisionSession.ts", modal = "src/view/CollisionModal.ts";
const test = "tests/collisionView.test.ts";
export const viewMutations = [
	[session, test, "partial-wording", 'case "duplicate-exhausted": return "Not enough distinct results.";', 'case "duplicate-exhausted": return "Not enough distinct results. The previous results are retained.";', "commits a nonzero partial"],
	[modal, test, "applied-selector", 'draft.selector.kind === "fixed" && draft.selector.recipeId !== row.committed.recipeId', 'draft.selector.kind === "fixed"', "keeps selector changes draft-only"],
	[modal, test, "row-dom-identity", 'this.batchId !== (batch?.batchId ?? null)', 'batch !== null', "keeps selector changes draft-only"],
	[modal, test, "pending-controls", '!session.canWrite(row.rowSlotId)', 'false', "disables only the pending row writes"],
	[session, test, "pending-write-guard", 'if (!host || !batch || !this.canWrite(slot)) return;', 'if (!host || !batch) return;', "disables only the pending row writes"],
	[session, test, "active-at-complete", 'await host.scheduler.yieldTask();\n\t\t\tif (!current()) return;\n\t\t\tif (vocabulary && host.active() !== vocabulary) { this.cancel(key); return; }\n\t\t\tif (prepared.ok)', 'await host.scheduler.yieldTask();\n\t\t\tif (!current()) return;\n\t\t\tif (prepared.ok)', "refuses Generate completion when source"],
	[session, test, "close-release", 'this.controller = null;', '/* mutant retains released controller */', "rejects late completion after modal"],
	[session, test, "late-write-feedback", 'if (this.host === host && this.writes.get(slot) === operation)', 'if (true)', "drops write feedback after close"],
	["src/SemantropyPlugin.ts", test, "plugin-disable", 'for (const view of this.semantropyViews()) view.disableCollision();', '', "rejects late completion after disable"],
	["src/view/SemantropyToolbar.ts", "tests/toolbarView.test.ts", "toolbar-classification", 'this.group("is-generation", () => ui().toolbar.groups.generation)', 'this.group("is-generation", () => ui().toolbar.groups.settings)', "classifies Collision as phrase generation"],
];
