/**
 * WORKBENCH-UI5 probes for the shared temporary-copy runner
 * (`node scripts/adverb/verifyAdverbMutations.mjs --workbench`, after the earlier stages' probes in
 * `mutationProbes.mjs`). Each one breaks one branch of the Shuffle tab's own area, the target chooser, the Fake
 * Dictionary button and dialog, or one of the loose ends of WORKBENCH-UI4's independent review 1, and the named
 * assertion has to be what fails. The checkout is never written.
 *
 * Probes that repoint an earlier stage's probe (the code moved from the Toolbar into the area, or was reworded) are
 * here too; the earlier file keeps only the probes whose code is still where it was.
 */
const VIEW = "src/view/SemantropyView.ts";
const CONTROLS = "src/view/VocabularyControls.ts";
const BAR = "src/view/ShuffleBar.ts";
const TOOLBAR = "src/view/SemantropyToolbar.ts";
const TABS = "src/view/workbenchTabs.ts";
const PANE = "src/view/RecomposePane.ts";
const STATUS = "src/view/toolbarStatusModel.ts";
const VOCABULARY_CONTROLS = "src/view/VocabularyControls.ts";
const HELP = "src/view/DictionaryHelpModal.ts";
const PICKER = "src/TargetNotePicker.ts";
const PLUGIN = "src/SemantropyPlugin.ts";
const CSS = "styles.css";
const CATALOG = "src/i18n/catalog.ts";

const SUMMARY_TEST = "tests/workbenchUi5Summary.test.ts";
const BAR_TEST = "tests/workbenchUi5Bar.test.ts";
const TARGET_TEST = "tests/workbenchUi5Target.test.ts";
const DICT_TEST = "tests/workbenchUi5Dictionary.test.ts";
const REVIEW_TEST = "tests/workbenchUi5Review.test.ts";
const UI1_TEST = "tests/workbenchUi1.test.ts";
const TABS_TEST = "tests/workbenchUi2Tabs.test.ts";

// The area (decision 16).
const B_HOLDS = "holds Reshuffle text, Refresh target, Copy and Collect with the classes";
const B_TARGET = "shows the target's name, and a sentence when there is none";
const B_ACTS = "acts through the same View methods as the commands do";
const B_STATE ="says the body's state there, and leaves progress, errors and the Vocabulary";
const B_SHOWN = "is shown with the Shuffle tab only, so the tab row never moves";
const B_ROW = "is three items in one row";
const B_ORDER = "puts the choosing button, the target and the actions in the row in that order";
const B_TITLE = "gives a cut target name its whole as a tooltip";
const B_ICONS = "each tab has a glyph before its name";
// The chooser (decision 17).
const T_OFFER = "is offered only when the host can choose";
const T_READS = "reads nothing until a note is chosen";
const T_KEEPS = "keeps what a View with a note has, whatever it is showing";
const T_KEEPS_VOCABULARY = "keeps the Selected Notes Vocabulary a View with no note has";
const T_POPUPS = "closes a Toolbar popup that is open when the chooser opens";
const T_PLUGIN = "offers the choice to the View, lists paths and reads nothing";
const T_PICKER = "the chooser lists the notes' paths, settles a microtask after the modal closes";
// The Fake Dictionary button and dialog (decision 20).
const D_BUTTON = "stands in the Settings category, before Display settings";
const D_ROW = "takes the availability row away on a host with tabs";
const D_SAYS = "says how to look a word up, then the modifier, then the details";
const D_MODIFIER = "the modifier is the stored setting";
const D_READS = "reads the Vocabulary in use";
const D_POPUPS = "closes a Toolbar popup that is open when the dialog opens";
const D_STORED = "opens on the stored modifier";
const D_CLOSE ="is closed with the View, replaces nothing in the shell";
const D_WEB = "host never says it";
const D_CSS = "is a readable width on a narrow pane";
// The Vocabulary summary names the notes (owner change B).
const S_NAMES = "names the Current Note and one Selected Note by file name";
const S_SEVERAL = "names several by the first in path order, with ▶";
const S_TAIL = "keeps the draw mode, the weights and the unapplied, preparing and stale notes after the name";
const S_WEB = "is the plain line on a host without tabs, as it was";
const S_TEXT = "writes a note name as text only, and reads no note for it";
const S_POPUP = "is a Toolbar popup: closed to begin with";
const S_CLOSE = "closes on Escape";
const S_MARKS = "marks a note that changed or is gone as the picker does";
const S_QUIET = "a sync that changes nothing writes nothing";
const S_TITLE = "sets the tooltip when the name is cut";
const S_CSS = "is cut by the stylesheet, narrower in a narrow pane";
// Review 1's loose ends.
const R_STALE = "the status line says it is stale or missing, in both languages";
const R_PANE = "a Source change turns Generate new off at once";
const R_BARE = "a category with one control hidden and one shown stays in the row";
const R_ACTIONS ="say there is nothing to act on and leave the tab where it is";
const R_SUMMARY = "names no Vocabulary until one is applied, and the picker starts on Selected Notes";
const R_CLOSED = "builds no shell, no Recompose session and no pane";
// Earlier stages' tests whose probes were repointed.
const SELECTED = "with Selected Notes, a changed Target asks for Refresh target before Generate";
const TABS_FOCUS = "focus inside the pane going away moves to the tab that replaced it";
const REFRESH_SHUFFLE = "Refresh target shows Shuffle, then refreshes";

// Review 2's loose ends (P3 1, 2, 3, 5, 6, 8, 10, 11).
const REVIEW2_TEST = "tests/workbenchUi5Review2.test.ts";
const U_SCROLL = "a position read to the end is put back with the area in place";
const U_AUTOMATIC = "the Automatic control is not put back while a note is being read";
const U_NONE = "an Open with no note still starts the View again";
const U_RESHUFFLE = "Reshuffle text with no note is aborted";
const U_DIALOG_WEB = "dialog is the tabs";
const U_KEEPS = "keeps the Vocabulary, its summary and the Recompose text";
const U_OWN = "body is made from";
const U_HALF = "about half of the View high";
const REVIEW3_TEST = "tests/workbenchUi5Review3.test.ts";
const U_FIRST = "is written again when the Current Note is another note";
const U_CLASSES = "marks the status line as what the list hangs from";
const U_REGION = "is a polite status region";
const U_AUTO_LOAD = "is put back while a note is being read";
const U_AUTO_ERR = "comes back after a read that failed";
const U_ORDINARY = "an Open of a note into an empty View";
const U_MORE = "goes to the More button";
const U_ALIGN = "is aligned from its own container";
const U_TIP = "is set again after a language change";
const U_BUILD = "builds the list when it opens";
const U_SAME = "says it as the picker does";
const U_BACK = "puts back the weights";
const U_TAKEOVER = "takes over from another";
const U_SOURCE = "stale after a failed read";
const U_AREA = "says both in the area, refers to the sentence";
const U_CLOSES = "is told to close when the View closes";
const U_REOPENS = "is told to close when the View opens again";
const U_AGAIN = "can be asked for again and again";
const U_MENUS = "closes the word menu and the definition popover before it opens";
const U_FOCUS = "puts focus on the new choosing button";
const U_NEWER = "does not free the one that replaced it";
const U_ELSEWHERE = "leaves focus where the reader put it";
const U_PLUGIN = "chooser closes with the signal";
const U_DIALOG_LIFE = "the Fake Dictionary dialog is closed by a new lifetime";
const U_DIALOG_MENUS = "closes the word menu and the popover before the dialog opens";
const U_PREPARING = "says a Vocabulary is being prepared";
const U_REPLAN = "plans again once when the row overflows";
const U_KEPT = "says so once when it keeps";
const U_WAY_OUT = "is a sentence that names the way out";
const U_REFRESH_OWN = "Refresh target does not follow Reshuffle text";
const U_STALE_AREA = "a target that moved shows the stale sentence";
const U_SELECTION = "a selection change reaches the area";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	// The Vocabulary summary names the notes (owner change B).
	[VIEW, SUMMARY_TEST, "names-on-every-host",
		`...(this.tabbed() ? { names: { adopt } } : {}),`, `names: { adopt },`,
		S_WEB],
	[CONTROLS, SUMMARY_TEST, "name-of-the-draft",
		`const first = noteFileName(sources[0]!);`, `const first = noteFileName(state.draft.paths[0] ?? sources[0]!);`,
		S_NAMES],
	[CONTROLS, SUMMARY_TEST, "name-of-the-last",
		`const first = noteFileName(sources[0]!);`, `const first = noteFileName(sources[sources.length - 1]!);`,
		S_SEVERAL],
	[CONTROLS, SUMMARY_TEST, "one-note-reads-as-several",
		`const many = state.selection.mode === "selected" && sources.length > 1;`, `const many = state.selection.mode === "selected";`,
		S_NAMES],
	[CONTROLS, SUMMARY_TEST, "two-notes-read-as-one",
		`const many = state.selection.mode === "selected" && sources.length > 1;`, `const many = state.selection.mode === "selected" && sources.length > 2;`,
		S_TAIL],
	[CONTROLS, SUMMARY_TEST, "tail-dropped",
		`part("semantropy-vocabulary-tail", n.tail(drawText, note))`, `part("semantropy-vocabulary-tail", "")`,
		S_TAIL],
	[CONTROLS, SUMMARY_TEST, "name-written-as-html",
		`const part = (cls: string, text: string) => { const el = doc.createElement("span"); el.className = cls; el.textContent = text; return el; };`,
		`const part = (cls: string, text: string) => { const el = doc.createElement("span"); el.className = cls; el.innerHTML = text; return el; };`,
		S_TEXT],
	[TOOLBAR, SUMMARY_TEST, "list-not-a-toolbar-popup",
		`			this.summaryPopup = popup;
			this.addPopup(popup);`, `			this.summaryPopup = popup;`,
		S_POPUP],
	[TOOLBAR, SUMMARY_TEST, "list-button-does-nothing",
		`this.listen(button, "click", () => this.togglePopup(popup));`, ``,
		S_POPUP],
	[TOOLBAR, SUMMARY_TEST, "click-in-the-list-closes-it",
		` || popup.panel.contains(target)`, ``,
		S_CLOSE],
	[CONTROLS, SUMMARY_TEST, "list-without-marks",
		`({ path, mark: vocabularySourceMark(listed === null || listed.has(path), reasons.get(path)) })`, `({ path, mark: "" })`,
		S_MARKS],
	[CONTROLS, SUMMARY_TEST, "list-rewritten-every-sync",
		`  if (named.listKey === key) return;`, ``,
		S_QUIET],
	[CONTROLS, SUMMARY_TEST, "summary-rewritten-every-sync",
		`  if (named.key !== key) {`, `  if (true) {`,
		S_QUIET],
	[CONTROLS, SUMMARY_TEST, "focus-lost-on-rewrite",
		`   if (refocus && many) named.toggle.focus({ preventScroll: true });`, ``,
		S_QUIET],
	[CONTROLS, SUMMARY_TEST, "tooltip-never",
		`  if (cut && el.title !== named.fullName) el.title = named.fullName;`, `  if (false) el.title = named.fullName;`,
		S_TITLE],
	[CONTROLS, SUMMARY_TEST, "tooltip-kept-when-not-cut",
		`  else if (!cut && el.hasAttribute("title")) el.removeAttribute("title");`, ``,
		S_TITLE],
	[VIEW, SUMMARY_TEST, "resize-leaves-the-tooltip",
		`		this.vocabularyControls?.refit();`, ``,
		S_TITLE],
	[CSS, SUMMARY_TEST, "css-vocabulary-name-not-cut",
		`	text-overflow: ellipsis;
	white-space: nowrap;
	vertical-align: bottom;`, `	white-space: nowrap;
	vertical-align: bottom;`,
		S_CSS],
	[CSS, SUMMARY_TEST, "css-status-not-a-containing-block",
		`.semantropy-status.has-vocabulary-names {
	position: relative;
}`, `.semantropy-status.has-vocabulary-names {
}`,
		S_CSS],
	[CSS, SUMMARY_TEST, "css-narrow-name-same-width",
		`	.semantropy-vocabulary-name {
		max-width: 7rem;`, `	.semantropy-vocabulary-name {
		max-width: 12rem;`,
		S_CSS],
	// The area is a Shuffle-tab thing.
	[BAR, BAR_TEST, "bar-never-hidden",
		`if (this.el.hidden !== !shown) this.el.hidden = !shown;`, `if (this.el.hidden !== false) this.el.hidden = false;`,
		B_SHOWN],
	[VIEW, BAR_TEST, "bar-shown-on-every-tab",
		`this.shuffleBar?.setShown(tab === "shuffle");`, `this.shuffleBar?.setShown(true);`,
		B_SHOWN],
	[VIEW, BAR_TEST, "focus-left-in-the-hidden-bar",
		` || (this.activeTab === "shuffle" && this.shuffleBar?.el.contains(doc.activeElement))`, ``,
		B_SHOWN],
	[VIEW, TABS_TEST, "focus-left-in-the-hidden-pane",
		`\t\t\tif (leaving.contains(doc.activeElement) || (this.activeTab === "shuffle" && this.shuffleBar?.el.contains(doc.activeElement))) focus = true;\n`, ``,
		TABS_FOCUS],
	[TOOLBAR, BAR_TEST, "primary-group-on-a-tabbed-host",
		`const primary = tabbed ? null : this.group("is-primary", () => ui().toolbar.groups.primary);`, `const primary = this.group("is-primary", () => ui().toolbar.groups.primary);`,
		B_HOLDS],
	[CSS, BAR_TEST, "css-bar-row-wraps",
		`.semantropy-shuffle-bar-row {\n\tdisplay: grid;\n\tgrid-template-columns: auto minmax(0, 1fr) auto;`, `.semantropy-shuffle-bar-row {\n\tdisplay: flex;\n\tgrid-template-columns: auto minmax(0, 1fr) auto;`,
		B_ROW],
	[CSS, BAR_TEST, "css-narrow-target-on-the-first-line",
		`.semantropy-shuffle-bar-target {\n\t\tgrid-column: 1 / -1;\n\t\tgrid-row: 2;`, `.semantropy-shuffle-bar-target {\n\t\tgrid-column: 1 / -1;\n\t\tgrid-row: 1;`,
		B_ROW],
	[CSS, BAR_TEST, "css-narrow-actions-at-the-left",
		`\t\tjustify-self: end;`, `\t\tjustify-self: start;`,
		B_ROW],
	[CSS, BAR_TEST, "css-button-column-lost",
		`.semantropy-shuffle-bar-row > .semantropy-target-choose {\n\tgrid-column: 1;\n}`, `.semantropy-shuffle-bar-row > .semantropy-target-choose {\n}`,
		B_ROW],
	[CSS, BAR_TEST, "css-label-hidden-in-a-narrow-pane",
		`@container semantropy-view (max-width: 32rem) {\n\t.semantropy-shuffle-bar-row {\n\t\tgrid-template-columns: auto minmax(0, 1fr);`, `@container semantropy-view (max-width: 32rem) {\n\t.semantropy-target-label { position: absolute; }\n\t.semantropy-shuffle-bar-row {\n\t\tgrid-template-columns: auto minmax(0, 1fr);`,
		B_ROW],
	[BAR, BAR_TEST, "bar-tooltip-never",
		`if (cut && el.title !== this.fullName) el.title = this.fullName;`, `if (false) el.title = this.fullName;`,
		B_TITLE],
	[BAR, BAR_TEST, "bar-tooltip-kept-when-not-cut",
		`else if (!cut && el.hasAttribute("title")) el.removeAttribute("title");`, ``,
		B_TITLE],
	[BAR, BAR_TEST, "bar-name-written-without-a-check",
		`this.fullName = name; this.refit(); }`, `this.fullName = name; }`,
		B_TITLE],
	[VIEW, BAR_TEST, "resize-leaves-the-area-tooltip",
		`\t\tthis.shuffleBar?.refit();`, ``,
		B_TITLE],
	[BAR, BAR_TEST, "target-before-the-button",
		`\t\tconst target = this.child(row, "div", "semantropy-shuffle-bar-target");`, `\t\tconst target = this.child(row, "div", "semantropy-shuffle-bar-target"); row.insertBefore(target, row.firstChild);`,
		B_ORDER],
	[CSS, BAR_TEST, "css-name-not-cut",
		`\ttext-overflow: ellipsis;\n\twhite-space: nowrap;\n}\n.semantropy-target-name.is-none`, `\twhite-space: nowrap;\n}\n.semantropy-target-name.is-none`,
		B_ROW],
	[CSS, BAR_TEST, "css-bar-hidden-still-laid-out",
		`.semantropy-shuffle-bar[hidden] {\n\tdisplay: none;\n}`, `.semantropy-shuffle-bar[hidden] {\n\tdisplay: flex;\n}`,
		B_ROW],
	// Names and states of the four controls, and the target.
	[BAR, BAR_TEST, "generate-keeps-the-reshuffle-name",
		`return this.input.generate() ? ui().toolbar.workbench.generate.name : ui().toolbar.controls.reshuffle.name;`, `return ui().toolbar.controls.reshuffle.name;`,
		B_HOLDS],
	[BAR, BAR_TEST, "generate-keeps-the-reshuffle-description",
		`return this.input.generate() ? ui().toolbar.workbench.generate.description : ui().toolbar.controls.reshuffle.description;`, `return ui().toolbar.controls.reshuffle.description;`,
		B_HOLDS],
	[BAR, BAR_TEST, "refresh-is-named-generate",
		`this.button(actions, "refresh", () => ui().toolbar.controls.refresh.name,`, `this.button(actions, "refresh", () => this.reshuffleName(),`,
		B_HOLDS],
	[BAR, BAR_TEST, "refresh-is-described-as-generate",
		`() => ui().toolbar.controls.refresh.description, hidden, this.labels, () => this.input.refreshTarget()`, `() => this.reshuffleDescription(), hidden, this.labels, () => this.input.refreshTarget()`,
		B_HOLDS],
	[VIEW, BAR_TEST, "bar-never-says-generate",
		`generate: () => this.ungenerated(),`, `generate: () => false,`,
		B_HOLDS],
	[BAR, BAR_TEST, "copy-always-enabled",
		`this.setVisible("copy", model.showCopy, !model.copyEnabled);`, `this.setVisible("copy", model.showCopy, false);`,
		B_ACTS],
	[BAR, BAR_TEST, "collect-always-shown",
		`this.setVisible("collect", model.showCollect, !model.collectEnabled);`, `this.setVisible("collect", true, !model.collectEnabled);`,
		B_TARGET],
	[BAR, BAR_TEST, "no-note-reads-as-pending",
		`const name = target.name ?? (target.pending ? "" : ui().shuffleBar.noTarget);`, `const name = target.name ?? ui().shuffleBar.noTarget;`,
		B_TARGET],
	[BAR, BAR_TEST, "state-from-every-kind",
		`const mine = SHUFFLE_BAR_KINDS.includes(status.kind);`, `const mine = true;`,
		B_STATE],
	[BAR, BAR_TEST, "stale-not-flagged",
		`this.staleEl.classList.toggle("is-stale", stale);`, ``,
		B_STATE],
	// Tab glyphs (decision 19).
	[TABS, BAR_TEST, "shuffle-tab-wrong-glyph",
		`{ shuffle: "dices", recompose: "wand-sparkles" }`, `{ shuffle: "shuffle", recompose: "wand-sparkles" }`,
		B_ICONS],
	[TABS, BAR_TEST, "recompose-tab-wrong-glyph",
		`{ shuffle: "dices", recompose: "wand-sparkles" }`, `{ shuffle: "dices", recompose: "sparkles" }`,
		B_ICONS],
	// The chooser (decision 17).
	[BAR, TARGET_TEST, "chooser-always-offered",
		`if (choose) choose.hidden = this.input.chooseTarget === undefined;`, `if (choose) choose.hidden = false;`,
		T_OFFER],
	[VIEW, TARGET_TEST, "chooser-handed-to-every-host",
		`...(this.host.chooseTarget ? { chooseTarget: () => { void this.chooseTarget(); } } : {}),`, `chooseTarget: () => { void this.chooseTarget(); },`,
		T_OFFER],
	[VIEW, TARGET_TEST, "chooser-twice-at-once",
		`if (this.chooser) return "busy";`, ``,
		T_READS],
	[VIEW, TARGET_TEST, "chooser-closed-opens-anyway",
		`if (!choice) return "cancelled";`, ``,
		T_READS],
	[VIEW, TARGET_TEST, "chooser-leaves-popups-open",
		`this.toolbar?.closePopups(); this.dictionaryPopover?.close(); this.closeManualMenu();\n\t\tlet choice`, `let choice`,
		T_POPUPS],
	[VIEW, TARGET_TEST, "none-open-keeps-nothing-with-a-note",
		`capture.kind === "none" && (this.session.getState().status !== "empty" || this.standaloneVocabulary !== null)`, `capture.kind === "none" && this.standaloneVocabulary !== null`,
		T_KEEPS],
	[VIEW, TARGET_TEST, "none-open-keeps-no-vocabulary",
		`capture.kind === "none" && (this.session.getState().status !== "empty" || this.standaloneVocabulary !== null)`, `capture.kind === "none" && this.session.getState().status !== "empty"`,
		T_KEEPS_VOCABULARY],
	[VIEW, TARGET_TEST, "none-open-keeps-nothing",
		`capture.kind === "none" && (this.session.getState().status !== "empty" || this.standaloneVocabulary !== null)`, `false`,
		T_KEEPS],
	[PICKER, TARGET_TEST, "picker-settles-before-the-choice",
		`void Promise.resolve().then(() => settle(this.chosen));`, `settle(this.chosen);`,
		T_PICKER],
	[PICKER, TARGET_TEST, "picker-lists-names",
		`return note.path;`, `return note.name;`,
		T_PICKER],
	[PICKER, TARGET_TEST, "picker-forgets-the-choice",
		`this.chosen = note;`, ``,
		T_PICKER],
	[PLUGIN, TARGET_TEST, "plugin-ignores-the-open-editor",
		`this.captureMarkdownFile(note, this.readEditorText(note.path)) : null;`, `this.captureMarkdownFile(note, null) : null;`,
		T_PLUGIN],
	// The Fake Dictionary button and dialog (decision 20).
	[TOOLBAR, DICT_TEST, "button-in-the-text-category",
		`this.iconButton(this.item("fakeDictionary", this.settingsGroup)`, `this.iconButton(this.item("fakeDictionary", this.textGroup)`,
		D_BUTTON],
	[TOOLBAR, DICT_TEST, "button-after-display-settings",
		`		if (this.input.fakeDictionary) {
			this.iconButton(this.item("fakeDictionary", this.settingsGroup)`, `		this.buildOverflow();
		if (this.input.fakeDictionary) {
			this.iconButton(this.item("fakeDictionary", this.settingsGroup)`,
		D_BUTTON],
	[TOOLBAR, DICT_TEST, "phrase-group-renamed",
		`this.group("is-generation", () => ui().toolbar.groups.generation)`, `this.group("is-generation", () => ui().toolbar.groups.settings)`,
		D_BUTTON],
	[TOOLBAR, DICT_TEST, "button-wrong-glyph",
		`fakeDictionary: { ...CONTROL_TEXT.fakeDictionary, icon: "book-open" },`, `fakeDictionary: { ...CONTROL_TEXT.fakeDictionary, icon: "book" },`,
		D_BUTTON],
	[TOOLBAR, DICT_TEST, "button-leaves-popups-open",
		`this.closePopups(); this.input.fakeDictionary?.();`, `this.input.fakeDictionary?.();`,
		D_POPUPS],
	[VIEW, DICT_TEST, "button-on-every-host",
		`...(this.tabbed() ? { fakeDictionary: () => this.openDictionaryHelp() } : {}),`, `fakeDictionary: () => this.openDictionaryHelp(),`,
		D_BUTTON],
	[VIEW, DICT_TEST, "row-kept-on-a-tabbed-host",
		`\t\tif (!this.tabbed()) {\n  const diagnostics = root.createEl("details"`, `\t\tif (true) {\n  const diagnostics = root.createEl("details"`,
		D_ROW],
	[VIEW, DICT_TEST, "row-dropped-for-every-host",
		`\t\tif (!this.tabbed()) {\n  const diagnostics = root.createEl("details"`, `\t\tif (false) {\n  const diagnostics = root.createEl("details"`,
		D_ROW],
	[VIEW, DICT_TEST, "diagnostics-never-say-none",
		`none: this.tabbed() && !snapshot && state.status !== "loading" });`, `none: false });`,
		D_READS],
	[VIEW, DICT_TEST, "diagnostics-say-none-on-the-web",
		`none: this.tabbed() && !snapshot && state.status !== "loading" });`, `none: !snapshot && state.status !== "loading" });`,
		D_WEB],
	[VIEW, DICT_TEST, "diagnostics-read-the-target-only",
		`const snapshot = this.targetBody.getVocabularySnapshot() ?? this.standaloneVocabulary?.snapshot ?? null;\n  if (snapshot !== this.diagnosticSnapshot)`, `const snapshot = this.targetBody.getVocabularySnapshot() ?? null;\n  if (snapshot !== this.diagnosticSnapshot)`,
		D_READS],
	[VIEW, DICT_TEST, "second-dialog-over-the-first",
		`if (!this.tabbed() || this.lifecycle.closed || this.dictionaryHelpModal) return;`, `if (!this.tabbed() || this.lifecycle.closed) return;`,
		D_POPUPS],
	[VIEW, DICT_TEST, "dialog-leaves-the-binding",
		`unbind: () => { this.dictionaryDiagnosticEl = null; this.dictionaryCountsEl = null; },`, `unbind: () => { },`,
		D_CLOSE],
	[VIEW, DICT_TEST, "dialog-ignores-another-views-modifier",
		`this.dictionaryHelpModal?.sync();`, ``,
		D_MODIFIER],
	[HELP, DICT_TEST, "dialog-shows-no-modifier",
		`\t\tselect.value = host.modifier();\n\t\tconst change`, `\t\tconst change`,
		D_STORED],
	[HELP, DICT_TEST, "dialog-saves-no-modifier",
		`if (select.value === "alt" || select.value === "shift") host.setModifier(select.value);`, ``,
		D_MODIFIER],
	[HELP, DICT_TEST, "dialog-details-open",
		`const details = root.createEl("details", { cls: "semantropy-dictionary-diagnostics semantropy-dictionary-help-details" });`,
		`const details = root.createEl("details", { cls: "semantropy-dictionary-diagnostics semantropy-dictionary-help-details", attr: { open: "" } });`,
		D_SAYS],
	[HELP, DICT_TEST, "dialog-drops-the-focus",
		`if (target?.isConnected) target.focus();`, ``,
		D_CLOSE],
	[CSS, DICT_TEST, "css-dialog-fixed-width",
		`--dialog-width: min(32rem, 95vw);\n\twidth: min(32rem, 95vw);`, `--dialog-width: 32rem;\n\twidth: 32rem;`,
		D_CSS],
	// Review 1's loose ends (P3 1, 2, 5, 6, 7).
	[STATUS, REVIEW_TEST, "no-note-stale-not-said",
		`if (staleSources.length > 0) {`, `if (false) {`,
		R_STALE],
	[STATUS, REVIEW_TEST, "no-note-missing-said-as-stale",
		`message: staleSources.some((issue) => issue.reason === "missing") ? VOCABULARY_MISSING_MESSAGE : VOCABULARY_STALE_MESSAGE,`, `message: VOCABULARY_STALE_MESSAGE,`,
		R_STALE],
	[VIEW, REVIEW_TEST, "automatic-waits-for-a-note",
		`this.tabbed() && this.session.getState().status !== "ready" ? this.staleSources.size === 0 : this.targetBody.isAutomaticCurrent();`, `this.targetBody.isAutomaticCurrent();`,
		R_STALE],
	[VIEW, UI1_TEST, "source-event-leaves-generate-enabled",
		`\t\tif (this.ungenerated() || this.tabbed()) { this.toolbar?.sync(); this.shuffleBar?.sync(); this.syncLoadControl(); }\n`, ``,
		SELECTED],
	[VIEW, REVIEW_TEST, "source-event-silent-with-no-body",
		`if (this.ungenerated() || this.tabbed()) {`, `if (this.ungenerated()) {`,
		R_STALE],
	[VIEW, REVIEW_TEST, "source-event-leaves-the-pane-alone",
		`\t\t// WORKBENCH-UI5 (review 1, P3 2): Generate new in the Recompose pane waits for a fresh Vocabulary, as the dialogs do.\n\t\tthis.recomposeScreen?.sync();\n`, ``,
		R_PANE],
	[PANE, REVIEW_TEST, "pane-never-says-why",
		`this.unusable.hidden = state.available.generate || state.busy;`, `this.unusable.hidden = true;`,
		R_PANE],
	[PANE, REVIEW_TEST, "pane-says-why-while-a-step-runs",
		`this.unusable.hidden = state.available.generate || state.busy;`, `this.unusable.hidden = state.available.generate;`,
		R_PANE],
	[PANE, REVIEW_TEST, "pane-reason-hidden-from-assistive-technology",
		`this.unusable = this.element(root, "p", "semantropy-recompose-unusable");`, `this.unusable = this.element(root, "p", "semantropy-recompose-unusable"); this.unusable.setAttribute("aria-hidden", "true");`,
		R_PANE],
	[TOOLBAR, REVIEW_TEST, "bare-category-hidden-when-any-control-is",
		`(this.input.workbench !== undefined && home.every(el => el.hidden))`, `(this.input.workbench !== undefined && home.some(el => el.hidden))`,
		R_BARE],
	[PANE, REVIEW_TEST, "pane-reason-not-reworded",
		`this.labels.text(this.unusable, () => ui().recompose.noVocabulary);`, `this.unusable.textContent = ui().recompose.noVocabulary;`,
		R_PANE],
	[VIEW, REVIEW_TEST, "refresh-moves-to-shuffle-with-no-note",
		`if (this.session.getState().status === "ready") this.showTab("shuffle");\n\t\tif (this.host.waitForPendingSettings`, `this.showTab("shuffle");\n\t\tif (this.host.waitForPendingSettings`,
		R_ACTIONS],
	[VIEW, TABS_TEST, "refresh-stays-on-recompose",
		`\t\t// WORKBENCH-UI2: Refresh target rebuilds the Shuffle body, so that is the tab it shows (WORKBENCH-UI5: when there is one).\n\t\tif (this.session.getState().status === "ready") this.showTab("shuffle");\n`, ``,
		REFRESH_SHUFFLE],
	[VIEW, REVIEW_TEST, "reshuffle-moves-to-shuffle-with-no-note",
		`\t\tif (this.tabbed() && this.session.getState().status !== "ready") return "unavailable";\n\t\t// WORKBENCH-UI2: Reshuffle text acts on the Shuffle body`, `\t\t// WORKBENCH-UI2: Reshuffle text acts on the Shuffle body`,
		R_ACTIONS],
	[VOCABULARY_CONTROLS, REVIEW_TEST, "summary-names-a-draft",
		`const text = !state.applied ? "" :`, `const text = !state.ready ? "" :`,
		R_SUMMARY],
	[VIEW, REVIEW_TEST, "summary-names-a-vocabulary-with-no-note",
		`applied: !this.lifecycle.closed && (this.session.getState().status === "ready" || this.standaloneVocabulary !== null),`, `applied: !this.lifecycle.closed,`,
		R_SUMMARY],
	[VIEW, REVIEW_TEST, "picker-starts-on-the-current-note",
		`initial: () => this.session.getState().status !== "ready" && this.standaloneVocabulary === null`, `initial: () => false`,
		R_SUMMARY],
	[VIEW, REVIEW_TEST, "closed-view-builds-a-shell",
		`\t\tif (this.lifecycle.closed) return;\n\t\t// WORKBENCH-UI5: an Open with no note to take`, `\t\t// WORKBENCH-UI5: an Open with no note to take`,
		R_CLOSED],
	// Review 2's loose ends: P3 1 (the area before the scroll position), 2 (the three rules are a host with tabs' own).
	[VIEW, REVIEW2_TEST, "showtab-area-after-the-scroll",
		`\t\t\tthis.shuffleBar?.setShown(tab === "shuffle");\n\t\t\tconst saved = this.tabScroll[tab];\n\t\t\tscroll.scrollTop = saved.top; scroll.scrollLeft = saved.left;\n\t\t\trow.sync(tab);\n`,
		`\t\t\tconst saved = this.tabScroll[tab];\n\t\t\tscroll.scrollTop = saved.top; scroll.scrollLeft = saved.left;\n\t\t\trow.sync(tab);\n\t\t\tthis.shuffleBar?.setShown(tab === "shuffle");\n`,
		U_SCROLL],
	[VIEW, REVIEW2_TEST, "automatic-waits-for-a-note-on-every-host",
		`this.tabbed() && this.session.getState().status !== "ready" ? this.staleSources.size === 0 : this.targetBody.isAutomaticCurrent();`,
		`this.session.getState().status !== "ready" ? this.staleSources.size === 0 : this.targetBody.isAutomaticCurrent();`,
		U_AUTOMATIC],
	[VIEW, REVIEW2_TEST, "open-with-no-note-keeps-on-every-host",
		`if (this.tabbed() && capture.kind === "none" && (`, `if (capture.kind === "none" && (`,
		U_NONE],
	[VIEW, REVIEW2_TEST, "reshuffle-with-no-note-unavailable-on-every-host",
		`if (this.tabbed() && this.session.getState().status !== "ready") return "unavailable";`, `if (this.session.getState().status !== "ready") return "unavailable";`,
		U_RESHUFFLE],
	[VIEW, REVIEW2_TEST, "dictionary-dialog-on-every-host",
		`if (!this.tabbed() || this.lifecycle.closed || this.dictionaryHelpModal) return;`, `if (this.lifecycle.closed || this.dictionaryHelpModal) return;`,
		U_DIALOG_WEB],
	// P3 3: a Vocabulary applied from Selected Notes with no note survives a note that cannot be read.
	// Review 3, P3 1: the note's body is made from the note's own selection; the Vocabulary applied with no note is put aside and put back.
	[VIEW, REVIEW2_TEST, "open-keeps-selected-notes-selection-for-the-body",
		`\t\tthis.resetVocabulary();\n\t\tthis.stashedStandalone = stash;`, `\t\tif (stash === null) this.resetVocabulary();\n\t\tthis.stashedStandalone = stash;`,
		U_OWN],
	[VIEW, REVIEW2_TEST, "stash-kept-after-the-note-opened",
		`\t\tthis.stashedStandalone = null;\n\t\tthis.session.completeReady(`, `\t\tthis.session.completeReady(`,
		U_OWN],
	[VIEW, REVIEW2_TEST, "restore-forgets-the-owner",
		`		this.standaloneVocabulary = stash.vocabulary;
`, ``,
		U_KEEPS],
	[VIEW, REVIEW2_TEST, "read-failure-does-not-put-back",
		`this.sourceWatch.endRequest(requestId);\n\t\t\tthis.restoreStandalone(stash);`, `this.sourceWatch.endRequest(requestId);`,
		U_BACK],
	[VIEW, REVIEW2_TEST, "analysis-failure-does-not-put-back",
		`this.targetBody.release();\n\t\t\tthis.restoreStandalone(stash);`, `this.targetBody.release();`,
		U_BACK],
	[VIEW, REVIEW2_TEST, "stash-forgets-the-weights",
		`selection: this.vocabularySelection, draft: this.vocabularyDraft, stale: new Map(this.staleSources) };`, `selection: this.initialSelection(), draft: this.vocabularyDraft, stale: new Map(this.staleSources) };`,
		U_BACK],
	[VIEW, REVIEW2_TEST, "stash-forgets-the-draft",
		`selection: this.vocabularySelection, draft: this.vocabularyDraft, stale: new Map(this.staleSources) };`, `selection: this.vocabularySelection, draft: this.initialSelection(), stale: new Map(this.staleSources) };`,
		U_BACK],
	[HELP, REVIEW2_TEST, "dialog-listener-left-behind",
		`		for (const off of this.off.splice(0)) off();
`, ``,
		"leaves no listener behind"],
	[VIEW, REVIEW2_TEST, "second-open-forgets-the-stash",
		`const stash = this.stashedStandalone ?? (this.tabbed()`, `const stash = (this.tabbed()`,
		U_TAKEOVER],
	[VIEW, REVIEW2_TEST, "source-event-during-read-ignored",
		`if (aside?.vocabulary.snapshot.sources.some(source => source.path === path)`, `if (false && aside?.vocabulary.snapshot.sources.some(source => source.path === path)`,
		U_SOURCE],
	[VIEW, REVIEW2_TEST, "restore-drops-the-stale-marks",
		`\t\tfor (const [path, reason] of stash.stale) if (this.staleSources.get(path) !== "missing") this.staleSources.set(path, reason);\n`, ``,
		U_SOURCE],
	[VIEW, REVIEW2_TEST, "stash-keeps-a-missing-mark-over-a-changed-one",
		`if (aside?.vocabulary.snapshot.sources.some(source => source.path === path) && aside.stale.get(path) !== "missing") aside.stale.set(path, reason);`, `if (aside?.vocabulary.snapshot.sources.some(source => source.path === path)) aside.stale.set(path, reason);`,
		U_SOURCE],
	// P3 5: the manual count and the sentence about the selected word are the area's on a host with tabs.
	[TOOLBAR, REVIEW2_TEST, "toolbar-keeps-the-sentence-with-tabs",
		`\t\tif (!tabbed) {\n\t\t\tthis.manualEl = this.child(`, `\t\tif (true) {\n\t\t\tthis.manualEl = this.child(`,
		U_AREA],
	[TOOLBAR, REVIEW2_TEST, "word-control-described-by-nothing",
		`this.diagnosticEl?.id ?? this.input.manualDiagnosticId?.() ?? null;`, `this.diagnosticEl?.id ?? null;`,
		U_AREA],
	[VIEW, REVIEW2_TEST, "view-names-no-sentence-for-the-word-control",
		`\t\t\t...(this.tabbed() ? { manualDiagnosticId: () => this.shuffleBar?.diagnosticId ?? null } : {}),\n`, ``,
		U_AREA],
	[BAR, REVIEW2_TEST, "area-says-no-count",
		`this.write(this.manualEl, manual.count > 0 ? ui().toolbar.manualChanges(manual.count) : "");`, `this.write(this.manualEl, "");`,
		U_AREA],
	[BAR, REVIEW2_TEST, "area-says-no-sentence",
		`this.write(this.diagnosticEl, diagnostic === null ? "" : localize(diagnostic.message));`, `this.write(this.diagnosticEl, "");`,
		U_AREA],
	[BAR, REVIEW2_TEST, "area-not-re-worded-with-the-language",
		`\t\tthis.labels.apply();\n\t\tthis.sync();\n`, `\t\tthis.labels.apply();\n`,
		U_AREA],
	[VIEW, REVIEW2_TEST, "area-counts-nothing",
		`manual: () => { const slot = this.selectedManualSlot(); return { count: this.targetBody.getManualOverrideCount(), diagnostic: slot?.manualDiagnostic ?? null }; },`,
		`manual: () => { const slot = this.selectedManualSlot(); return { count: 0, diagnostic: slot?.manualDiagnostic ?? null }; },`,
		U_AREA],
	[VIEW, REVIEW2_TEST, "area-asks-nothing-of-the-selection",
		`manual: () => { const slot = this.selectedManualSlot(); return { count: this.targetBody.getManualOverrideCount(), diagnostic: slot?.manualDiagnostic ?? null }; },`,
		`manual: () => { return { count: this.targetBody.getManualOverrideCount(), diagnostic: null }; },`,
		U_SELECTION],
	[VIEW, REVIEW2_TEST, "selection-sync-skips-the-area",
		`this.toolbar?.sync(); this.shuffleBar?.sync(); this.syncDictionaryDiagnostics();`, `this.toolbar?.sync(); this.syncDictionaryDiagnostics();`,
		U_SELECTION],
	[BAR, REVIEW2_TEST, "area-sentence-state-dropped",
		`if ((this.diagnosticEl.dataset["manual"] ?? null) !== state) {`, `if (false) {`,
		U_AREA],
	// P3 6: pins for the rewrites the hand mutations left standing.
	[BAR, REVIEW2_TEST, "area-stale-line-never-says-stale",
		`const stale = mine && status.kind === "target-stale";`, `const stale = false;`,
		U_STALE_AREA],
	[BAR, REVIEW2_TEST, "area-detail-follows-message",
		`this.write(this.detailEl, stale ? "" : detail);`, `this.write(this.detailEl, detail);`,
		U_STALE_AREA],
	[BAR, REVIEW2_TEST, "area-refresh-follows-reshuffle",
		`this.setVisible("refresh", model.showRefresh, !model.refreshEnabled);`, `this.setVisible("refresh", model.showRefresh, !model.reshuffleEnabled);`,
		U_REFRESH_OWN],
	[BAR, REVIEW2_TEST, "area-reshuffle-follows-refresh",
		`this.setVisible("reshuffle", model.showReshuffle, !model.reshuffleEnabled);`, `this.setVisible("reshuffle", model.showReshuffle, !model.refreshEnabled);`,
		U_REFRESH_OWN],
	// P3 8: the chooser has the View's lifetime, and focus is not lost.
	[VIEW, REVIEW2_TEST, "chooser-open-after-the-view-closed",
		`\t\tthis.closeDictionaryHelp();\n\t\tthis.closeChooser();\n\t\tthis.closeVocabularyPicker();\n  this.dictionaryPopover?.dispose(); this.dictionaryPopover = null;`,
		`\t\tthis.closeDictionaryHelp();\n\t\tthis.closeVocabularyPicker();\n  this.dictionaryPopover?.dispose(); this.dictionaryPopover = null;`,
		U_CLOSES],
	[VIEW, REVIEW2_TEST, "chooser-open-after-the-view-opened-again",
		`\t\tthis.closeDictionaryHelp();\n\t\tthis.closeChooser();\n\t\tthis.closeVocabularyPicker();\n  this.definitionCache.clear();`,
		`\t\tthis.closeDictionaryHelp();\n\t\tthis.closeVocabularyPicker();\n  this.definitionCache.clear();`,
		U_REOPENS],
	[VIEW, REVIEW2_TEST, "late-choice-after-an-abort-is-used",
		`if (this.lifecycle.closed || request.signal.aborted) return "aborted";`, `if (this.lifecycle.closed) return "aborted";`,
		U_REOPENS],
	[VIEW, REVIEW2_TEST, "chooser-stays-busy-after-an-answer",
		`finally { if (this.chooser === request) this.chooser = null; }`, `finally { }`,
		U_AGAIN],
	[VIEW, REVIEW2_TEST, "chooser-clears-a-newer-chooser",
		`finally { if (this.chooser === request) this.chooser = null; }`, `finally { this.chooser = null; }`,
		U_NEWER],
	[VIEW, REVIEW2_TEST, "chooser-leaves-the-word-menu-open",
		`this.toolbar?.closePopups(); this.dictionaryPopover?.close(); this.closeManualMenu();\n\t\tlet choice`, `this.toolbar?.closePopups(); this.dictionaryPopover?.close();\n\t\tlet choice`,
		U_MENUS],
	[VIEW, REVIEW2_TEST, "chooser-leaves-the-popover-open",
		`this.toolbar?.closePopups(); this.dictionaryPopover?.close(); this.closeManualMenu();\n\t\tlet choice`, `this.toolbar?.closePopups(); this.closeManualMenu();\n\t\tlet choice`,
		U_MENUS],
	[VIEW, REVIEW2_TEST, "focus-not-handed-to-the-new-button",
		`this.shuffleBar?.chooseButton()?.focus({ preventScroll: true });`, `void 0;`,
		U_FOCUS],
	[VIEW, REVIEW2_TEST, "focus-taken-from-where-it-is",
		`(!doc.activeElement || doc.activeElement === doc.body)) this.shuffleBar?.chooseButton()`, `true) this.shuffleBar?.chooseButton()`,
		U_ELSEWHERE],
	[BAR, REVIEW2_TEST, "choosing-button-offered-while-hidden",
		`return button && !button.hidden ? button : undefined;`, `return button;`,
		U_ELSEWHERE],
	[PLUGIN, REVIEW2_TEST, "plugin-chooser-not-closed-by-the-signal",
		`\t\tsignal.addEventListener("abort", close);\n`, ``,
		U_PLUGIN],
	[PLUGIN, REVIEW2_TEST, "plugin-uses-a-late-choice",
		`return note && !signal.aborted ? this.captureMarkdownFile(note, this.readEditorText(note.path)) : null;`, `return note ? this.captureMarkdownFile(note, this.readEditorText(note.path)) : null;`,
		U_PLUGIN],
	[PLUGIN, REVIEW2_TEST, "plugin-opens-an-aborted-chooser",
		`\t\tif (signal.aborted) return null;\n\t\tconst picker`, `\t\tconst picker`,
		U_PLUGIN],
	[PLUGIN, REVIEW2_TEST, "plugin-keeps-the-abort-listener",
		`finally { signal.removeEventListener("abort", close); }`, `finally { }`,
		U_PLUGIN],
	[HELP, REVIEW2_TEST, "dialog-focus-goes-to-the-old-button",
		`const target = host?.focusTarget?.() ?? this.origin;`, `const target = this.origin;`,
		U_DIALOG_LIFE],
	[VIEW, REVIEW2_TEST, "dialog-focus-target-is-nothing",
		`focusTarget: () => this.toolbar?.returnTarget(this.contentEl.querySelector<HTMLElement>(".semantropy-fake-dictionary-open")) ?? null,`, `focusTarget: () => null,`,
		U_DIALOG_LIFE],
	[VIEW, REVIEW2_TEST, "dialog-leaves-the-word-menu-open",
		`if (!this.tabbed() || this.lifecycle.closed || this.dictionaryHelpModal) return;\n\t\tthis.dictionaryPopover?.close(); this.closeManualMenu();`, `if (!this.tabbed() || this.lifecycle.closed || this.dictionaryHelpModal) return;\n\t\tthis.dictionaryPopover?.close();`,
		U_DIALOG_MENUS],
	[VIEW, REVIEW2_TEST, "dialog-leaves-the-popover-open",
		`if (!this.tabbed() || this.lifecycle.closed || this.dictionaryHelpModal) return;\n\t\tthis.dictionaryPopover?.close(); this.closeManualMenu();`, `if (!this.tabbed() || this.lifecycle.closed || this.dictionaryHelpModal) return;\n\t\tthis.closeManualMenu();`,
		U_DIALOG_MENUS],
	[VIEW, REVIEW2_TEST, "dialog-diagnostics-wait-for-a-chrome-pass",
		`\t\tif (this.dictionaryHelpModal) this.syncDictionaryDiagnostics();\n`, ``,
		U_PREPARING],
	// P3 10: a Toolbar that still overflows is planned once more.
	[TOOLBAR, REVIEW2_TEST, "toolbar-planned-once",
		`if (again && this.root.scrollWidth > this.root.clientWidth) this.refreshLayout(true, false);`, ``,
		U_REPLAN],
	[TOOLBAR, REVIEW2_TEST, "toolbar-planned-forever",
		`this.refreshLayout(true, false);`, `this.refreshLayout(true, true);`,
		U_REPLAN],
	[TOOLBAR, REVIEW2_TEST, "toolbar-planned-again-when-it-fits",
		`if (again && this.root.scrollWidth > this.root.clientWidth)`, `if (again)`,
		U_REPLAN],
	// P3 11: an Open with no note to take says why nothing happened.
	[VIEW, REVIEW2_TEST, "open-kept-says-nothing",
		`\t\t\tthis.notify(OPEN_KEPT_MESSAGE);\n\t\t\treturn;`, `\t\t\treturn;`,
		U_KEPT],
	[VIEW, REVIEW2_TEST, "open-with-nothing-to-keep-says-it-too",
		`(this.session.getState().status !== "empty" || this.standaloneVocabulary !== null)) {`, `(true)) {`,
		U_KEPT],
	[VIEW, REVIEW2_TEST, "open-kept-ignores-the-vocabulary",
		`(this.session.getState().status !== "empty" || this.standaloneVocabulary !== null)) {`, `(this.session.getState().status !== "empty")) {`,
		U_KEPT],
	[CATALOG, REVIEW2_TEST, "open-kept-does-not-name-the-way-out",
		` Click a note first, or use “Choose target note”.",`, `",`,
		U_WAY_OUT],
	[CATALOG, REVIEW2_TEST, "open-kept-ja-does-not-name-the-way-out",
		`ノートをクリックしてから実行するか、「対象ノートを選ぶ」で選んでください。",`, `",`,
		U_WAY_OUT],
	[CSS, BAR_TEST, "css-bar-hidden-button-drawn",
		`.semantropy-shuffle-bar button[hidden] {\n\tdisplay: none;\n}`, `.semantropy-shuffle-bar button[hidden] {\n\tdisplay: inline-flex;\n}`,
		B_ROW],
	// The Display settings' note ("applies to the Shuffle tab only") stays on a host with tabs; its probe was dropped by mistake in the first round.
	[TOOLBAR, "tests/workbenchUi3.test.ts", "note-never-shown",
		`if (this.shuffleOnlyEl) this.shuffleOnlyEl.hidden = workbench?.recomposeShown !== true;`, `if (this.shuffleOnlyEl) this.shuffleOnlyEl.hidden = true;`,
		"on the Recompose tab the Shuffle area is hidden"],
	[CSS, REVIEW2_TEST, "css-unusable-sentence-always-drawn",
		`.semantropy-recompose-unusable[hidden] { display: none; }`, `.semantropy-recompose-unusable[hidden] { display: block; }`,
		"the stylesheet has its rule"],
	[CSS, REVIEW2_TEST, "css-unusable-sentence-unmuted",
		`.semantropy-recompose-unusable,\n.semantropy-recompose-note {`, `.semantropy-recompose-note {`,
		"the stylesheet has its rule"],
	// Review 3, owner decisions: a wide pane cuts no name that fits the line; the list is about half of the View high.
	[CSS, SUMMARY_TEST, "css-name-cut-in-a-wide-pane",
		`.semantropy-vocabulary-name {
	display: inline-block;
	max-width: 100%;`, `.semantropy-vocabulary-name {
	display: inline-block;
	max-width: 12rem;`,
		S_CSS],
	[CSS, SUMMARY_TEST, "css-summary-not-shrinkable",
		`.semantropy-status-vocabulary.is-named {
	min-width: 0;`, `.semantropy-status-vocabulary.is-named {
	min-width: auto;`,
		S_CSS],
	[CSS, SUMMARY_TEST, "css-list-has-its-own-height",
		`	width: max-content;
	max-width: min(28rem, 100cqw);
}`, `	width: max-content;
	max-width: min(28rem, 100cqw);
	max-height: min(20rem, 60vh);
}`,
		S_CSS],
	[CSS, SUMMARY_TEST, "css-list-as-wide-as-a-row-popup",
		`	width: max-content;
	max-width: min(28rem, 100cqw);`, `	max-width: min(28rem, 100cqw);`,
		S_CSS],
	[CSS, SUMMARY_TEST, "css-long-path-does-not-wrap",
		`.semantropy-vocabulary-sources-list li {
	overflow-wrap: anywhere;
`, `.semantropy-vocabulary-sources-list li {
`,
		S_CSS],
	[TOOLBAR, SUMMARY_TEST, "list-height-uncapped",
		`const cap = panel === this.summaryPopup?.panel ? Math.max(96, Math.floor(bounds.height / 2)) : Number.POSITIVE_INFINITY;`, `const cap = Number.POSITIVE_INFINITY;`,
		U_HALF],
	[TOOLBAR, SUMMARY_TEST, "every-popup-capped-to-half",
		`const cap = panel === this.summaryPopup?.panel ? Math.max(96, Math.floor(bounds.height / 2)) : Number.POSITIVE_INFINITY;`, `const cap = Math.max(96, Math.floor(bounds.height / 2));`,
		U_HALF],
	[TOOLBAR, SUMMARY_TEST, "list-as-high-as-the-view",
		`Math.max(96, Math.floor(bounds.height / 2)) : Number.POSITIVE_INFINITY`, `Math.max(96, Math.floor(bounds.height)) : Number.POSITIVE_INFINITY`,
		U_HALF],
	// Review 3, P3 5: pins for the rewrites review 2's hand mutations left standing.
	[CONTROLS, REVIEW3_TEST, "summary-not-rewritten-for-a-new-first-note",
		`const key = JSON.stringify([n.head, before, after, many, first, n.tail(drawText, note)]);`, `const key = JSON.stringify([n.head, before, after, many, n.tail(drawText, note)]);`,
		U_FIRST],
	[CONTROLS, REVIEW3_TEST, "status-line-not-a-containing-block",
		`line.classList.add("has-vocabulary-names"); line.append(panel);`, `line.append(panel);`,
		U_CLASSES],
	[CONTROLS, REVIEW3_TEST, "summary-not-marked-named",
		`   summary.classList.add("is-named");\n`, ``,
		U_CLASSES],
	[CONTROLS, REVIEW3_TEST, "list-has-no-role",
		`   panel.setAttribute("role", "group");\n`, ``,
		U_CLASSES],
	[BAR, REVIEW3_TEST, "area-sentence-not-a-status-region",
		`\t\tthis.diagnosticEl.setAttribute("role", "status");\n\t\tthis.diagnosticEl.setAttribute("aria-live", "polite");\n`, ``,
		U_REGION],
	[BAR, REVIEW3_TEST, "area-sentence-not-live",
		`\t\tthis.diagnosticEl.setAttribute("aria-live", "polite");\n`, ``,
		U_REGION],
	[VIEW, REVIEW3_TEST, "automatic-waits-only-for-an-empty-view",
		`const automaticCurrent = this.tabbed() && this.session.getState().status !== "ready" ?`, `const automaticCurrent = this.tabbed() && this.session.getState().status === "empty" ?`,
		U_AUTO_LOAD],
	[VIEW, REVIEW3_TEST, "automatic-waits-only-for-a-ready-view-after-a-failure",
		`const automaticCurrent = this.tabbed() && this.session.getState().status !== "ready" ?`, `const automaticCurrent = this.tabbed() && this.session.getState().status === "empty" ?`,
		U_AUTO_ERR],
	[VIEW, REVIEW3_TEST, "notice-for-a-note-into-a-ready-view",
		`  if (this.session.getState().status === "ready" && this.targetBody.isDisplayIntact() && capture.kind === "markdown") {\n`, `  if (this.session.getState().status === "ready" && this.targetBody.isDisplayIntact() && capture.kind === "markdown") { if (this.tabbed()) this.notify(OPEN_KEPT_MESSAGE);\n`,
		U_ORDINARY],
	[VIEW, REVIEW3_TEST, "dialog-focus-ignores-a-closed-more",
		`focusTarget: () => this.toolbar?.returnTarget(this.contentEl.querySelector<HTMLElement>(".semantropy-fake-dictionary-open")) ?? null,`, `focusTarget: () => this.contentEl.querySelector<HTMLElement>(".semantropy-fake-dictionary-open"),`,
		U_MORE],
	[TOOLBAR, REVIEW3_TEST, "list-aligned-like-a-row-popup",
		`if (panel === this.summaryPopup?.panel) {`, `if (false) {`,
		U_ALIGN],
	[BAR, REVIEW3_TEST, "relabel-leaves-the-tooltip",
		`\t\t// "Target:" is another width in another language, so a name may now be cut, or no longer.\n\t\tthis.refit();\n`, ``,
		U_TIP],
	// The list is built when it opens, from the Vault's listing, with the picker's own words.
	[CONTROLS, SUMMARY_TEST, "list-built-while-closed",
		`  if (named.panel.hidden && !open) { named.listKey = ""; return; }`, ``,
		U_BUILD],
	[CONTROLS, SUMMARY_TEST, "list-not-built-on-open",
		`   toggle.addEventListener("click", build); this.handlers.push(() => toggle.removeEventListener("click", build));\n`, ``,
		U_BUILD],
	[CONTROLS, SUMMARY_TEST, "list-ignores-the-listing",
		`vocabularySourceMark(listed === null || listed.has(path), reasons.get(path))`, `vocabularySourceMark(true, reasons.get(path))`,
		U_SAME],
	[VIEW, SUMMARY_TEST, "list-reads-no-listing",
		`listedPaths: (): readonly string[] | null => this.host.listVocabularyNotes ? this.host.listVocabularyNotes() : null };`, `listedPaths: (): readonly string[] | null => null };`,
		U_SAME],
	["src/view/VocabularyModal.ts", SUMMARY_TEST, "picker-mark-ignores-the-listing",
		`vocabularySourceMark(this.listed.has(path), stale.get(path))`, `vocabularySourceMark(true, stale.get(path))`,
		U_SAME],
	["src/view/vocabularySourceMark.ts", SUMMARY_TEST, "mark-forgets-the-vault",
		`const notes = [!listed ? v.notFound : "",`, `const notes = ["",`,
		U_SAME],
	[CATALOG, REVIEW2_TEST, "notice-says-a-note-is-open",
		`"The active pane is not a Markdown note, so the target stays as it is.`, `"No Markdown note is open, so the target stays as it is.`,
		U_WAY_OUT],
	[CONTROLS, REVIEW3_TEST, "clear-named-keeps-its-keys",
		`  named.key = ""; named.listKey = ""; named.nameEl = null; named.fullName = "";\n`, `  named.nameEl = null; named.fullName = "";\n`,
		"draws the same Vocabulary again"],
];
