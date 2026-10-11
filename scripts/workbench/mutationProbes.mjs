/**
 * WORKBENCH-UI1, WORKBENCH-UI2 and WORKBENCH-UI3 probes for the shared temporary-copy runner
 * (`node scripts/adverb/verifyAdverbMutations.mjs --workbench`). Each one
 * breaks one branch of the deferred first Shuffle — the host flag off, the
 * flag on, or the rule Generate follows — or of the body tabs, and the named
 * assertion has to be what fails. The checkout is never written.
 */
import { probes as ui5Probes } from "./mutationProbesUi5.mjs";
import { probes as recompose1Probes } from "./mutationProbesRecompose1.mjs";
import { probes as reopen1Probes } from "./mutationProbesReopen1.mjs";

const CONTROLLER = "src/render/chunkTargetBodyController.ts";
const VIEW = "src/view/SemantropyView.ts";
const MODEL = "src/view/semantropyViewModel.ts";
const STATUS = "src/view/toolbarStatusModel.ts";
const STAGE0 = "tests/workbenchUi1ZeroChunks.test.ts";
const TEST = "tests/workbenchUi1.test.ts";
const OFF = "absent or false opens with the first Chunk and builds the same shell as before";
const OPEN = "analyzes and prepares the owner, shows Generate, and offers no Copy or Collect";
const REOPEN = "an Open of another note, or of the same note again, comes back not generated";
const REFRESH = "Refresh keeps a generated body generated and a body not generated yet as it is";
const CHANGED = "a changed Target stops Generate from every entry until Refresh target";
const SELECTED = "with Selected Notes, a changed Target asks for Refresh target before Generate";
const LOST = "a renamed or deleted Target stops Generate as well";
const EMPTY = "an empty note has no first Chunk to wait for and opens as before";
// WORKBENCH-UI2 stage 2: the body tabs.
const TABS = "src/view/workbenchTabs.ts";
const TABS_TEST = "tests/workbenchUi2Tabs.test.ts";
const TABS_OFF = "absent, false, or on a host without the Recompose entry, builds the same shell as before";
const TABS_ROW = "puts a tab row before the one scrolling box, which holds the two panes as siblings";
const TABS_KEYS = "a click shows one pane and hides the other; Arrow keys, Home and End move and select";
const TABS_SCROLL = "keeps each tab's scroll position and puts it back when the tab is shown again";
const TABS_FRESH = "the tab and the scroll positions are not kept: a new shell starts on Shuffle";
const TABS_READ = "Copy, Collect and Define find nothing while Recompose is shown, even with a selection passed in";
const TABS_LEAVE = "leaving Shuffle drops the recorded and the live selection, so going back finds none";
const TABS_HIDDEN = "a selection made in the hidden body while Recompose is shown is not recorded";
const TABS_MENU = "the word menu closes, and a word action it still holds does nothing";
const TABS_HOVER = "a modifier hover over the hidden body opens no definition, and an open one closes";
// Review 1 (P2): a change in flight never brings back a selection leaving Shuffle dropped.
const TABS_IN_FLIGHT = "Recompose shown while it waits, then Shuffle again, finds no selection";
// Review 1 (P3).
const TOOLBAR = "src/view/SemantropyToolbar.ts";
const PANE = "src/view/RecomposePane.ts";
const TABS_CLEAR = "review 1: Clear manual changes is off while Recompose is shown, and clears nothing even if reached";
const TABS_MODIFIERS = "review 1: an arrow, Home or End with a modifier is left to whoever owns that shortcut";
// WORKBENCH-UI2 stage 3: Recompose as a session and a pane.
const SESSION = "src/view/RecomposeSession.ts";
const PANE_TEST = "tests/workbenchUi2Recompose.test.ts";
const RETENTION = "tests/recomposeSessionRetention.test.ts";
const SWITCHED = "after another owner becomes active, the earlier one, its Snapshot and analyses go, while the output and its provenance stay";
const S5_FLOW = "generates, continues, branches, copies and collects from the active Vocabulary";

/** [source file, test file, name, before, after, test name] */
// WORKBENCH-UI3 (stage 4): the body font in the Recompose pane, the Toolbar that follows the body area, the command's sentence.
const PLUGIN = "src/SemantropyPlugin.ts";
const UI3_TEST = "tests/workbenchUi3.test.ts";
const UI3_FONT = "font and size go to the Shuffle body and the Recompose text alike";
const UI3_GENERATE = "not generated, Reshuffle text is Generate text until the first Chunk";
const UI3_MESSAGE = "the View names the reason; every other unavailable Reshuffle keeps its sentence";
const UI3_PLUGIN = "the plugin's command shows the sentence the View gives";
const CSS = "styles.css";
const UI3_SENTENCES = "the sentences themselves, through the real View and the plugin's command";
const UI4_TEST = "tests/workbenchUi4.test.ts";
const UI4_PLUGIN = "the plugin passes both flags and leaves recomposeDialog alone";
const UI4_EMPTY = "both tabs are there; Shuffle says there is no note";
const UI4_USABLE = "Recompose is usable: the Vocabulary entry is there";
const UI4_LOADING = "while a note is being read and when it cannot be";
const UI3_CSS = "keeps the actions in reach, lets the tab row wrap";
const UI3_TOP = "a new text starts at the top however far the earlier one was read";

const baseProbes = [
	// The controller option itself (stage 0).
	[CONTROLLER, STAGE0, "open-ignores-defer",
		"			if (descriptors[0] && input.deferFirstChunk !== true) {", "			if (descriptors[0]) {",
		"analyzes the Target and prepares the Vocabulary owner, and builds no Chunk"],
	[CONTROLLER, TEST, "open-always-defers",
		"			if (descriptors[0] && input.deferFirstChunk !== true) {", "			if (descriptors[0] && false) {",
		OFF],
	// Review 1 (P3): the rollback of a failed save must leave the first Chunk where Generate finds it.
	[CONTROLLER, STAGE0, "rollback-drops-the-first-chunk",
		"if (this.root === root) { this.observer?.disconnect(); dom?.rollback(); this.observe(root); }",
		"if (this.root === root) { this.observer?.disconnect(); dom?.rollback(); this.observe(root); } this.targetDescriptors = this.targetDescriptors.slice(1);",
		"a failed save or a publication failure with no Chunk rolls every View back, and Generate still gives the old level"],
	[CONTROLLER, TEST, "empty-note-awaits-a-chunk",
		"this.runtime.chunks.length === 0 && this.runtime.descriptors.length > 0; }", "this.runtime.chunks.length === 0; }",
		EMPTY],
	// The host flag: off must change nothing, on must defer every Open.
	[VIEW, TEST, "flag-read-as-always-on",
		"		return this.host.deferInitialShuffle === true;", "		return true;",
		OFF],
	[VIEW, TEST, "flag-read-as-always-off",
		"		return this.host.deferInitialShuffle === true;", "		return false;",
		OPEN],
	[VIEW, TEST, "generate-shell-on-every-host",
		"			if (this.defersShuffle()) {\n				this.generateEl", "			if (true) {\n				this.generateEl",
		OFF],
	[VIEW, TEST, "open-never-defers",
		"			...(deferFirstChunk ? { deferFirstChunk: true } : {}),\n		});", "			...({}),\n		});",
		OPEN],
	[VIEW, TEST, "reopen-keeps-the-first-chunk",
		"    ...(this.defersShuffle() ? { deferFirstChunk: true } : {}) });", "    ...({}) });",
		REOPEN],
	[VIEW, TEST, "refresh-generates-a-waiting-body",
		"		const ungenerated = this.ungenerated();\n		let watchToken = 0;", "		const ungenerated = false;\n		let watchToken = 0;",
		REFRESH],
	[VIEW, TEST, "refresh-drops-a-generated-body",
		"		const ungenerated = this.ungenerated();\n		let watchToken = 0;", "		const ungenerated = this.defersShuffle();\n		let watchToken = 0;",
		REFRESH],
	// Generate's entries and rule.
	[VIEW, TEST, "reshuffle-is-not-generate",
		"		// WORKBENCH-UI1: the first Shuffle of a body opened without one is Generate.\n		if (this.ungenerated()) return await this.generateBody();\n", "",
		"Generate from the command makes the first Chunk"],
	[VIEW, TEST, "load-next-bypasses-the-rule",
		"		if (this.ungenerated()) return await this.generateBody();\n		return await this.loadSection(", "		return await this.loadSection(",
		CHANGED],
	[VIEW, TEST, "generate-ignores-a-changed-target",
		"		if (!this.ungenerated() || this.generateBlocked()) return \"unavailable\";", "		if (!this.ungenerated()) return \"unavailable\";",
		CHANGED],
	[VIEW, TEST, "changed-target-is-not-blocking",
		"state.freshness !== \"fresh\" || this.targetVocabularyChanged;", "state.freshness !== \"fresh\";",
		SELECTED],
	[VIEW, TEST, "stale-target-is-not-blocking",
		"state.freshness !== \"fresh\" || this.targetVocabularyChanged;", "this.targetVocabularyChanged;",
		LOST],
	[VIEW, TEST, "focus-left-on-the-removed-button",
		"		this.toolbar?.returnTarget(this.contentEl.querySelector<HTMLElement>(\".semantropy-reshuffle\"))?.focus();\n", "",
		"Generate from the button makes the first Chunk"],
	[VIEW, TEST, "load-next-shown-before-generate",
		"		this.loadButton.hidden = !this.targetBody.hasNext() || ungenerated;", "		this.loadButton.hidden = !this.targetBody.hasNext();",
		OPEN],
	[VIEW, TEST, "generate-shown-after-generate",
		"		this.generateEl.hidden = !ungenerated;", "		this.generateEl.hidden = false;",
		"Generate from the toolbar makes the first Chunk"],
	[VIEW, TEST, "generate-button-ignores-the-rule",
		"this.lifecycle.busy.isBusy() || this.generateBlocked();\n	}", "this.lifecycle.busy.isBusy();\n	}",
		CHANGED],
	// The models the Toolbar and the status line show.
	[MODEL, TEST, "copy-offered-before-generate",
		"				copyEnabled: !busy && !ungenerated,", "				copyEnabled: !busy,",
		OPEN],
	[MODEL, TEST, "reshuffle-needs-a-slot-before-generate",
		"				reshuffleEnabled: ungenerated\n					? !busy && options.generateBlocked !== true\n					: state.bodySemantropy",
		"				reshuffleEnabled: false\n					? !busy && options.generateBlocked !== true\n					: state.bodySemantropy",
		"Generate from the toolbar makes the first Chunk"],
	[MODEL, TEST, "reshuffle-ignores-the-rule",
		"					? !busy && options.generateBlocked !== true", "					? !busy",
		CHANGED],
	[MODEL, TEST, "status-reads-as-a-shortage",
		"				message: ungenerated ? EN_MESSAGES.status.notGenerated : readyMessage(", "				message: readyMessage(",
		OPEN],
	[STATUS, TEST, "not-generated-reads-as-insufficient-pool",
		"	if (input.ungenerated === true) {", "	if (false) {",
		OPEN],
	[STATUS, TEST, "refresh-detail-left-out",
		"			detail: input.generateBlocked === true ? REFRESH_TO_GENERATE_MESSAGE : null,", "			detail: null,",
		SELECTED],
	// WORKBENCH-UI2 stage 2: the host flag.
	[VIEW, TABS_TEST, "tabs-on-every-host",
		"		return this.host.workbenchTabs === true && this.host.recomposeDialog !== false;", "		return this.host.recomposeDialog !== false;",
		TABS_OFF],
	[VIEW, TABS_TEST, "tabs-on-the-web",
		"		return this.host.workbenchTabs === true && this.host.recomposeDialog !== false;", "		return this.host.workbenchTabs === true;",
		TABS_OFF],
	[VIEW, TABS_TEST, "tabs-never",
		"		return this.host.workbenchTabs === true && this.host.recomposeDialog !== false;", "		return false;",
		TABS_ROW],
	// Showing a pane.
	[VIEW, TABS_TEST, "shuffle-never-hidden",
		"			shuffle.hidden = tab !== \"shuffle\";", "			shuffle.hidden = false;",
		TABS_KEYS],
	[TABS, TABS_TEST, "every-tab-a-tab-stop",
		"			button.tabIndex = selected ? 0 : -1;", "			button.tabIndex = 0;",
		TABS_KEYS],
	[TABS, TABS_TEST, "keys-leave-focus-behind",
		"			select(ORDER[next]!, true);", "			select(ORDER[next]!, false);",
		TABS_KEYS],
	[TABS, TABS_TEST, "arrows-do-not-wrap",
		"key === \"ArrowRight\" ? (current + 1) % ORDER.length", "key === \"ArrowRight\" ? Math.min(current + 1, ORDER.length - 1)",
		TABS_KEYS],
	[VIEW, TABS_TEST, "scroll-not-saved",
		"			this.tabScroll[this.activeTab] = { top: scroll.scrollTop, left: scroll.scrollLeft };\n", "",
		TABS_SCROLL],
	[VIEW, TABS_TEST, "scroll-not-restored",
		"			scroll.scrollTop = saved.top; scroll.scrollLeft = saved.left;\n", "",
		TABS_SCROLL],
	[VIEW, TABS_TEST, "new-shell-keeps-the-tab",
		"		this.activeTab = \"shuffle\";\n		this.tabScroll = {", "		this.tabScroll = {",
		TABS_FRESH],
	// Target actions show Shuffle.
	[VIEW, TABS_TEST, "reshuffle-stays-on-recompose",
		"		// WORKBENCH-UI2: Reshuffle text acts on the Shuffle body, so that is the tab it shows.\n		this.showTab(\"shuffle\");\n", "",
		"Reshuffle text from the command shows Shuffle, then draws"],
	[VIEW, TABS_TEST, "open-stays-on-recompose",
		"  this.showTab(\"shuffle\");\n", "",
		"an Open of another note into a ready View shows Shuffle"],
	// Nothing acts on the hidden Shuffle selection.
	[VIEW, TABS_TEST, "copy-reads-the-hidden-body",
		"		const selected = this.recomposeShown() ? { status: \"empty\" as const } : this.resolveActionSelection(deps.selection);\n		if (selected.status !== \"selected\") {\n			this.notify(selected.message ?? COPY_EMPTY_SELECTION_MESSAGE);",
		"		const selected = this.resolveActionSelection(deps.selection);\n		if (selected.status !== \"selected\") {\n			this.notify(selected.message ?? COPY_EMPTY_SELECTION_MESSAGE);",
		TABS_READ],
	[VIEW, TABS_TEST, "collect-reads-the-hidden-body",
		"		const selected = this.recomposeShown() ? { status: \"empty\" as const } : this.resolveActionSelection(deps.selection);\n		if (selected.status !== \"selected\") {\n			this.notify(selected.message ?? COLLECT_EMPTY_SELECTION_MESSAGE);",
		"		const selected = this.resolveActionSelection(deps.selection);\n		if (selected.status !== \"selected\") {\n			this.notify(selected.message ?? COLLECT_EMPTY_SELECTION_MESSAGE);",
		TABS_READ],
	[VIEW, TABS_TEST, "define-reads-the-hidden-body",
		"		if (selected.status !== \"selected\" || this.recomposeShown()) {", "		if (selected.status !== \"selected\") {",
		TABS_READ],
	[VIEW, TABS_TEST, "leaving-keeps-the-record",
		"		this.selection = null; this.selectionEpoch += 1; this.selectionGesture = false;\n		const selection", "		this.selectionEpoch += 1; this.selectionGesture = false;\n		const selection",
		TABS_LEAVE],
	[VIEW, TABS_TEST, "leaving-keeps-the-live-selection",
		"			if (selection.getRangeAt(index).intersectsNode(pane)) { selection.removeAllRanges(); return; }", "			if (selection.getRangeAt(index).intersectsNode(pane)) { return; }",
		TABS_LEAVE],
	[VIEW, TABS_TEST, "manual-reads-the-hidden-body",
		"		if (this.recomposeShown()) return null;\n", "",
		TABS_HIDDEN],
	[VIEW, TABS_TEST, "hidden-selection-recorded",
		"		if (this.lifecycle.closed || this.recomposeShown()) return;", "		if (this.lifecycle.closed) return;",
		TABS_HIDDEN],
	[VIEW, TABS_TEST, "held-word-action-runs",
		"		if (!slot || this.lifecycle.busy.isBusy() || this.recomposeShown()) { this.closeManualMenu(); return; }", "		if (!slot || this.lifecycle.busy.isBusy()) { this.closeManualMenu(); return; }",
		TABS_MENU],
	[VIEW, TABS_TEST, "leaving-keeps-the-menu",
		"		this.closeManualMenu(); this.dictionaryPopover?.close();\n		this.selection = null; this.selectionEpoch += 1; this.selectionGesture = false;", "		this.dictionaryPopover?.close();\n		this.selection = null; this.selectionEpoch += 1; this.selectionGesture = false;",
		TABS_MENU],
	// FAKE-DICT-RECOMPOSE1: `leaving-keeps-the-definition` (the explicit close in `leaveShuffle`) is gone: the Shuffle target's `isCurrent` now also asks for the Shuffle tab, so an open Popover ends at the
	// same `updateChrome()` whether or not `leaveShuffle` closes it; the other half is probe `shuffle-target-current-ignores-the-tab`.
	[VIEW, TABS_TEST, "hover-over-the-hidden-body",
		"return this.dictionaryLive() && !this.recomposeShown() && this.targetBody === owner", "return this.dictionaryLive() && this.targetBody === owner",
		TABS_HOVER],
	[VIEW, TABS_TEST, "commit-restores-a-dropped-selection",
		"						if (beforeSelection?.owner === body && restorable()) {", "						if (beforeSelection?.owner === body) {",
		TABS_IN_FLIGHT],
	[VIEW, TABS_TEST, "rollback-restores-a-dropped-selection",
		"this.targetBody === body && restorable()) this.selection = beforeSelection; },", "this.targetBody === body) this.selection = beforeSelection; },",
		TABS_IN_FLIGHT],
	[VIEW, TABS_TEST, "leaving-keeps-the-selection-epoch",
		"		this.selection = null; this.selectionEpoch += 1; this.selectionGesture = false;", "		this.selection = null; this.selectionGesture = false;",
		TABS_IN_FLIGHT],
	// Review 1 (P3): Clear manual changes, modifier keys and the reset of the scroll positions.
	[VIEW, TABS_TEST, "clear-manual-offered-on-the-hidden-body",
		"				clearable: !this.recomposeShown() }; },", "				clearable: true }; },",
		TABS_CLEAR],
	[TOOLBAR, TABS_TEST, "toolbar-ignores-clearable",
		"this.manualClearButton.disabled = manual.count === 0 || manual.clearable === false;", "this.manualClearButton.disabled = manual.count === 0;",
		TABS_CLEAR],
	[VIEW, TABS_TEST, "clear-manual-acts-on-the-hidden-body",
		"			clearManual: () => { if (!this.recomposeShown() && this.targetBody.clearManual() === \"applied\")", "			clearManual: () => { if (this.targetBody.clearManual() === \"applied\")",
		TABS_CLEAR],
	[TABS, TABS_TEST, "modifier-keys-move-tabs",
		"			if (keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey || keyboard.shiftKey) return;\n", "",
		TABS_MODIFIERS],
	[VIEW, TABS_TEST, "new-shell-keeps-scroll-positions",
		"		this.tabScroll = { shuffle: { top: 0, left: 0 }, recompose: { top: 0, left: 0 } };\n", "",
		TABS_FRESH],
	// WORKBENCH-UI2 stage 3: the session keeps provenance, never the owner.
	[SESSION, RETENTION, "output-keeps-the-owner",
		"			this.output = { epoch, vocabulary:", "			this.output = { owner, epoch, vocabulary:",
		SWITCHED],
	[SESSION, RETENTION, "cache-kept-for-another-owner",
		"		if (this.cache && this.cache.epoch !== epoch) this.cache = null;\n", "",
		SWITCHED],
	[SESSION, RETENTION, "message-keeps-the-owner",
		"			this.say(() => ui().recompose.ready(sourceCount, sentenceCount));", "			this.say(() => ui().recompose.ready(owner.snapshot.sources.length, sentenceCount));",
		SWITCHED],
	[SESSION, PANE_TEST, "continue-from-another-owner",
		"		if (mode !== \"new\" && output?.epoch !== epoch) { this.display?.sync(); return; }", "		if (mode !== \"new\" && !output) { this.display?.sync(); return; }",
		"chooses the branch point from the keyboard, branches across paragraphs, and refuses stale or doubled steps"],
	[SESSION, PANE_TEST, "no-note-for-another-owner",
		"		const same = output !== null && output.epoch === epoch;", "		const same = output !== null;",
		S5_FLOW],
	[SESSION, PANE_TEST, "collect-from-the-active-owner",
		"algorithmVersion: RECOMPOSE_ALGORITHM_VERSION, ...this.recorded(output), vocabulary: output.vocabulary });",
		"algorithmVersion: RECOMPOSE_ALGORITHM_VERSION, ...this.recorded(output), vocabulary: collectVocabularyFromSnapshot(host.active()!.snapshot) });",
		S5_FLOW],
	[SESSION, PANE_TEST, "late-step-after-dispose",
		"			await host.paint();\n			if (this.host !== host) return;\n", "			await host.paint();\n",
		"a step in flight when the shell is rebuilt shows in the new pane; one in flight when the View closes publishes nothing"],
	// The View: one session for its lifetime, shown by the Toolbar's Recompose.
	[VIEW, PANE_TEST, "session-per-shell",
		"		this.recomposeSession ??= new RecomposeSession(this.recomposeHost());", "		this.recomposeSession = new RecomposeSession(this.recomposeHost());",
		"survives tab switches, an Open of another note and a Refresh, with the settings and the branch point"],
	[VIEW, PANE_TEST, "session-outlives-the-view",
		"		this.recomposeSession?.dispose(); this.recomposeSession = null;\n", "",
		"a new View lifetime starts empty"],
	// Review 1 (P3): the stage 3 branches the first tests left open.
	[SESSION, PANE_TEST, "step-takes-the-active-vocabulary",
		"collectVocabularyFromSnapshot(owner.snapshot), paragraphs, callable:", "collectVocabularyFromSnapshot((host.active() ?? owner).snapshot), paragraphs, callable:",
		"a step keeps the Vocabulary it began with, and a new text after a change names the Vocabulary active then"],
	[SESSION, PANE_TEST, "new-text-keeps-an-old-provenance",
		"vocabulary: output?.epoch === epoch ? output.vocabulary :", "vocabulary: output ? output.vocabulary :",
		"a step keeps the Vocabulary it began with, and a new text after a change names the Vocabulary active then"],
	// WORKBENCH-UI3 review 1 (P2): the output box scrolls itself; WORKBENCH-UI4 removed the dialog that did the same.
	[PANE, PANE_TEST, "pane-scrolls-the-wrong-way",
		"body.scrollTop = step === \"new\" ? 0 : body.scrollHeight;", "body.scrollTop = step === \"new\" ? body.scrollHeight : 0;",
		"the pane's output scrolls itself"],
	[PANE, PANE_TEST, "pane-shows-the-wrong-end",
		"const target = step === \"new\" ? body : units[units.length - 1] ?? body;", "const target = step === \"new\" ? units[units.length - 1] ?? body : body;",
		"the pane's output scrolls itself"],
	[SESSION, PANE_TEST, "cleared-step-still-generates",
		"			if (this.output !== output) { this.say(null); return; }\n", "",
		"Clear while a step waits: the step generates nothing and the output stays cleared"],
	// WORKBENCH-UI3 (stage 4).
	[VIEW, UI3_TEST, "pane-text-keeps-the-interface-font",
		"			recomposed.style.setProperty(\"font-family\", stack ?? \"\");\n", "",
		UI3_FONT],
	[VIEW, UI3_TEST, "pane-text-keeps-its-size",
		"			recomposed.style.setProperty(\"font-size\", size);\n", "",
		UI3_FONT],
	[PANE, UI3_TEST, "font-on-the-whole-pane",
		"		return this.body;\n	}\n\n	/** The controls", "		return this.root;\n	}\n\n	/** The controls",
		UI3_FONT],
	[TOOLBAR, UI3_TEST, "note-without-tabs",
		"if (this.input.workbench?.().tabbed === true) {\n			this.shuffleOnlyEl =", "if (this.input.workbench) {\n			this.shuffleOnlyEl =",
		UI3_GENERATE],
	[TOOLBAR, UI3_TEST, "names-not-reapplied",
		"		if (workbench) this.workbenchLabels.apply();\n", "",
		UI3_GENERATE],
	[TOOLBAR, UI3_TEST, "names-bound-once",
		"if (this.input.workbench && WORKBENCH_KEYS.has(key)) labels = this.workbenchLabels;", "",
		UI3_GENERATE],
	[VIEW, UI3_TEST, "message-ignores-the-block",
		"return this.ungenerated() && this.generateBlocked() ? REFRESH_TO_GENERATE_MESSAGE", "return this.ungenerated() ? REFRESH_TO_GENERATE_MESSAGE",
		UI3_MESSAGE],
	[VIEW, UI3_TEST, "message-always-the-old-one",
		"? REFRESH_TO_GENERATE_MESSAGE : RESHUFFLE_UNAVAILABLE_MESSAGE;", "? RESHUFFLE_UNAVAILABLE_MESSAGE : RESHUFFLE_UNAVAILABLE_MESSAGE;",
		UI3_MESSAGE],
	// Review 1 (P2): the Recompose pane's own box.
	[PANE, UI3_TEST, "pane-keeps-the-earlier-scroll",
		"		body.scrollTop = step === \"new\" ? 0 : body.scrollHeight;\n",
		"		if (step !== \"new\") body.scrollTop = body.scrollHeight;\n",
		UI3_TOP],
	[PANE, UI3_TEST, "pane-continuation-at-the-top",
		"		body.scrollTop = step === \"new\" ? 0 : body.scrollHeight;\n",
		"		body.scrollTop = 0;\n",
		UI3_TOP],
	// Stylesheet rules (the runner copies `styles.css` for `--workbench`): one focused test pins them.
	[CSS, UI3_TEST, "css-tabs-do-not-wrap",
		"	display: flex;\n	flex-wrap: wrap;\n	gap: 0.25rem;\n	margin-top: 0.25rem;", "	display: flex;\n	gap: 0.25rem;\n	margin-top: 0.25rem;",
		UI3_CSS],
	[CSS, UI3_TEST, "css-pane-text-does-not-scroll",
		"	min-height: 8rem;\n	max-height: none;\n	overflow: auto;", "	min-height: 8rem;\n	max-height: none;\n	overflow: visible;",
		UI3_CSS],
	[CSS, UI3_TEST, "css-pane-has-no-height",
		"	height: 100%;\n	padding-top: 0.5rem;", "	padding-top: 0.5rem;",
		UI3_CSS],
	[CSS, UI3_TEST, "css-no-theme-surfaces",
		".semantropy-scroll.semantropy-theme-dark .semantropy-pane {\n	--interactive-normal: var(--background-secondary);", ".semantropy-scroll.semantropy-theme-dark .semantropy-pane {\n	--interactive-normal: inherit;",
		UI3_CSS],
	[CSS, UI3_TEST, "css-pane-text-anchors",
		"	overflow-anchor: none;\n	font-family: var(--font-text);", "	font-family: var(--font-text);",
		UI3_CSS],
	// Review 1 (P3): the three rewrites that had survived.
	[VIEW, UI3_TEST, "message-for-any-blocked-target",
		"return this.ungenerated() && this.generateBlocked() ? REFRESH_TO_GENERATE_MESSAGE", "return this.generateBlocked() ? REFRESH_TO_GENERATE_MESSAGE",
		UI3_SENTENCES],
	// WORKBENCH-UI4 (stage 5): the tabs without a note, Recompose as the tab only, the plugin's host on.
	[VIEW, UI4_TEST, "tabs-only-with-a-note",
		"		} else if (this.tabbed()) {\n			// WORKBENCH-UI4", "		} else if (false) {\n			// WORKBENCH-UI4",
		UI4_EMPTY],
	[VIEW, UI4_TEST, "empty-notice-never-built",
		"			if (this.session.getState().status === \"empty\") {\n				this.shellLabels.text(pane.createDiv", "			if (false) {\n				this.shellLabels.text(pane.createDiv",
		UI4_EMPTY],
	[VIEW, UI4_TEST, "empty-notice-in-every-state",
		"			if (this.session.getState().status === \"empty\") {\n				this.shellLabels.text(pane.createDiv", "			if (this.session.getState().status !== \"ready\") {\n				this.shellLabels.text(pane.createDiv",
		UI4_LOADING],
	[VIEW, UI4_TEST, "empty-notice-not-reworded",
		"this.shellLabels.text(pane.createDiv({ cls: \"semantropy-shuffle-empty\" }), () => localize(this.viewModel().message ?? \"\"));",
		"pane.createDiv({ cls: \"semantropy-shuffle-empty\" }).textContent = localize(this.viewModel().message ?? \"\");",
		UI4_EMPTY],
	[VIEW, UI4_TEST, "vocabulary-entry-only-with-a-note",
		"				if (!ready && !this.tabbed()) return;", "				if (!ready) return;",
		UI4_USABLE],
	[PLUGIN, UI4_TEST, "plugin-host-without-defer",
		"					deferInitialShuffle: true,\n", "					deferInitialShuffle: false,\n",
		UI4_PLUGIN],
	[PLUGIN, UI4_TEST, "plugin-host-without-tabs",
		"					workbenchTabs: true,\n", "					workbenchTabs: false,\n",
		UI4_PLUGIN],
	[TOOLBAR, UI4_TEST, "bare-category-keeps-its-room",
		"(this.input.workbench !== undefined && home.every(el => el.hidden))", "false",
		"a category whose controls are all hidden takes no room with the workbench on"],
	[TOOLBAR, UI4_TEST, "bare-category-hidden-for-every-host",
		"(this.input.workbench !== undefined && home.every(el => el.hidden))", "home.every(el => el.hidden)",
		"a category whose controls are all hidden takes no room with the workbench on"],
	[TOOLBAR, UI4_TEST, "display-fit-class-never-set",
		"		if (input.workbench) this.root.classList.add(\"is-workbench\");", "",
		"Display settings fit a narrow pane with the workbench on"],
	[TOOLBAR, UI4_TEST, "display-fit-class-for-every-host",
		"		if (input.workbench) this.root.classList.add(\"is-workbench\");", "		this.root.classList.add(\"is-workbench\");",
		"Display settings fit a narrow pane with the workbench on"],
	[CSS, UI4_TEST, "css-display-select-cannot-shrink",
		".semantropy-toolbar.is-workbench .semantropy-display-label select {\n	min-width: 0;\n	max-width: 100%;", ".semantropy-toolbar.is-workbench .semantropy-display-label select {\n	max-width: 100%;",
		"Display settings fit a narrow pane with the workbench on"],
	[PLUGIN, UI3_TEST, "plugin-keeps-the-old-sentence",
		"this.notice(ran[0]?.reshuffleUnavailableMessage() ?? RESHUFFLE_UNAVAILABLE_MESSAGE);", "this.notice(RESHUFFLE_UNAVAILABLE_MESSAGE);",
		UI3_PLUGIN],
];

// WORKBENCH-UI5: the Shuffle tab's area, the target chooser, the Fake Dictionary dialog and review 1's loose ends (`mutationProbesUi5.mjs`).
// FAKE-DICT-RECOMPOSE1: the highlight fix and the Fake Dictionary inside Recompose sentences (`mutationProbesRecompose1.mjs`).
export const probes = [...baseProbes, ...ui5Probes, ...recompose1Probes, ...reopen1Probes];
