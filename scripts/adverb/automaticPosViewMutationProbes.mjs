/** Executed only by the existing, checked temporary-copy mutation runner. */
const TEST = "tests/automaticPosView.test.ts", STORE = "src/settings/AutomaticPosSettingsStore.ts", COORDINATOR = "src/application/AutomaticPosCoordinator.ts";
export const probes = [
	[STORE, TEST, "no-compensation-save", "this.queue.recovery = savedBefore;\n\t\t\t\t\t\ttry { await this.persistence.save(savedBefore); this.queue.recovery = null; }", "this.queue.recovery = savedBefore;\n\t\t\t\t\t\ttry { this.queue.recovery = null; }", "retains old generation on save-after failure"],
	[COORDINATOR, TEST, "publish-only-first-view", "for (const prepared of operation.prepared) {", "for (const prepared of operation.prepared.slice(0, 1)) {", "commits all Views, retains Manual overrides"],
	[COORDINATOR, TEST, "commit-only-first-view", "for (const prepared of operation.prepared) prepared.commit();", "for (const prepared of operation.prepared.slice(0, 1)) prepared.commit();", "commits all Views, retains Manual overrides"],
	[COORDINATOR, TEST, "omit-dom-rollback", "prepared.rollback();", "/* defect: retained new DOM */", "rolls back all Views and disk on after DOM failure"],
	["src/render/chunkTargetBodyController.ts", TEST, "discard-manual-on-option-apply", "runtime.index.targetRevision, revision + 1, this.manualOverrides, options", "runtime.index.targetRevision, revision + 1, new Map(), options", "commits all Views, retains Manual overrides"],
	["src/render/chunkTargetBodyController.ts", TEST, "omit-selection-remap", "if (selection && selected) selectionMap.restore(selection, selected, backward);", "/* defect: collapsed selection */", "keeps selection, scroll and Toolbar focus through different-length surfaces"],
	["src/application/bodyFragmentFromAutomatic.ts", TEST, "collect-drops-generation-options", "automaticPartsOfSpeech: parts.value", "automaticPartsOfSpeech: []", "keeps selection, scroll and Toolbar focus through different-length surfaces"],
	["src/view/SemantropyView.ts", TEST, "unowned-keyboard-focus-attribute", "this.manualMenuKeyboard = keyboard;", "this.manualMenuKeyboard = keyboard; if (keyboard) origin.tabIndex = -1;", "offers Restore and Use automatic"],
	["src/render/automaticPosBodyOwner.ts", TEST, "retain-adverb-authority-without-slots", "releaseManualAdverbAuthority({ authority: this.authority, reason });", "/* defect: only materialized controllers release the authority */", "revokes adverb authority without adverb Target slots"],
];
