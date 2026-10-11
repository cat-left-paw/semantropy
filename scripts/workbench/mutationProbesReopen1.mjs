/**
 * REOPEN-VOCABULARY-OPTIONS1 probes for the shared temporary-copy runner
 * (`node scripts/adverb/verifyAdverbMutations.mjs --workbench`, after the earlier stages' probes). Each one takes away
 * one thing an Open into a View that already shows a note passes to the body it builds, and the named assertion has to
 * be what fails. The checkout is never written.
 */
const VIEW = "src/view/SemantropyView.ts";
const TEST = "tests/reopenVocabularyOptions1.test.ts";
const PASSED = "drawMode: selection.drawMode, sourceWeights: selectionSourceWeights(selection), enclosedTerms: this.enclosedTerms(),";

export const probes = [
	[VIEW, TEST, "reopen-drops-the-stored-draw-mode",
		PASSED, "sourceWeights: selectionSourceWeights(selection), enclosedTerms: this.enclosedTerms(),",
		"opening another note keeps the stored draw mode in the Snapshot the body is drawn from"],
	[VIEW, TEST, "reopen-drops-the-enclosed-terms",
		PASSED, "drawMode: selection.drawMode, sourceWeights: selectionSourceWeights(selection),",
		"opening another note reads its enclosed term as one noun"],
	[VIEW, TEST, "reopen-shows-a-selection-read-later",
		"this.targetBody = staged; this.resetVocabulary(selection); old.release();", "this.targetBody = staged; this.resetVocabulary(); old.release();",
		"shows the draw mode the reopened body was drawn with, when the stored mode changes while the note is analyzed"],
];
