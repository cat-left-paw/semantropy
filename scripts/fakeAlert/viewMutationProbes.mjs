/**
 * FAKE-ALERT-VIEW1 probes for the shared temporary-copy runner
 * (`node scripts/adverb/verifyAdverbMutations.mjs --fake-alert-view`).
 * Each one breaks one rule of the dialog or of its View entry; the named
 * assertion has to be what fails. The checkout is never written.
 */
const MODAL = "src/view/FakeAlertModal.ts";
const VIEW = "src/view/SemantropyView.ts";
const TEST = "tests/fakeAlertView1.test.ts";
const OPENS = "opens one Fake Alert from the active Vocabulary at the Text Semantropy level";
const NOTICE = "shows a Notice, never a Fake Alert";
const CLOSES = "closes with the View and with a plugin disable";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	// The dialog.
	[MODAL, TEST, "dialog-shows-a-forged-alert",
		'		if (!isFakeAlert(alert)) throw new Error("A Fake Alert dialog shows only a generated Fake Alert.");\n', "",
		"shows only an Alert the core made"],
	[MODAL, TEST, "dialog-is-an-alertdialog",
		'		modal.setAttribute("role", "dialog");', '		modal.setAttribute("role", "alertdialog");',
		"is an ordinary dialog named by Semantropy's brand"],
	[MODAL, TEST, "brand-left-out-of-the-name",
		'		modal.setAttribute("aria-labelledby", `${this.brandName.id} ${this.titleText.id}`);',
		'		modal.setAttribute("aria-labelledby", this.titleText.id);',
		"is an ordinary dialog named by Semantropy's brand"],
	[MODAL, TEST, "lines-parsed-as-html",
		"			el.textContent = line;", "			el.innerHTML = line;",
		"builds its DOM from text nodes only"],
	[MODAL, TEST, "first-button-focused",
		"		const last = this.buttons.at(-1)?.el;", "		const last = this.buttons[0]?.el;",
		"the affirmative one last, focused and primary"],
	// Independent review 1, P2: Obsidian focuses the first control after onOpen().
	[MODAL, "tests/fakeAlertHostFocus.test.ts", "focus-left-to-the-host",
		"	open(): void {\n		super.open();\n		this.focusAffirmative();\n	}", "	open(): void {\n		super.open();\n	}",
		"leaves the affirmative button focused once open"],
	// Independent review 1, P3: an Outcome drawn and removed while a Prompt closes.
	[MODAL, TEST, "outcome-flashed-while-closing",
		"	onClose(): void {\n		this.contentEl.replaceChildren();",
		"	onClose(): void {\n		const drawn = Object.values(this.alert.outcomes)[0];\n		if (drawn) this.show(drawn);\n		this.contentEl.replaceChildren();",
		"closes a Prompt at once on Close or Escape without showing an Outcome"],
	[MODAL, TEST, "prompt-button-closes",
		'		const next = this.answered || this.alert.shape === "terminal" ? undefined : this.alert.outcomes[button];',
		"		const next = undefined;",
		"turns a Prompt's button into the page drawn for it"],
	[MODAL, TEST, "outcome-ok-shows-another-page",
		'		const next = this.answered || this.alert.shape === "terminal" ? undefined : this.alert.outcomes[button];',
		'		const next = this.alert.shape === "terminal" ? undefined : this.alert.outcomes[button];',
		"closes on an Outcome's OK even when the Prompt itself had an OK button"],
	[MODAL, TEST, "focus-not-returned",
		"		if (this.origin?.isConnected) this.origin.focus();\n", "",
		"that page's OK closes the dialog and returns focus"],
	[MODAL, TEST, "closed-reported-twice",
		"		this.closed = null;\n		this.shown = null;\n		closed?.();", "		this.shown = null;\n		closed?.();",
		"closes a Prompt at once on Close or Escape without showing an Outcome"],
	[MODAL, TEST, "buttons-not-relabelled",
		"		for (const { button, el } of this.buttons) el.textContent = text.buttons[button];",
		"		for (const { button, el } of this.buttons) el.textContent ||= text.buttons[button];",
		"re-words the title, the brand and the buttons"],
	// The View entry.
	[VIEW, TEST, "stale-vocabulary-used",
		"		const owner = this.collisionVocabulary();\n		if (!owner) { this.notify(EN_MESSAGES.fakeAlert.noVocabulary); return; }",
		"		const owner = this.targetBody.getVocabularyOwner() ?? this.standaloneVocabulary;\n		if (!owner) { this.notify(EN_MESSAGES.fakeAlert.noVocabulary); return; }",
		NOTICE],
	[VIEW, TEST, "insufficient-reported-as-failure",
		'			this.notify(generation.reason === "insufficient-vocabulary" ? EN_MESSAGES.fakeAlert.insufficient : EN_MESSAGES.fakeAlert.failed);',
		"			this.notify(EN_MESSAGES.fakeAlert.failed);",
		NOTICE],
	[VIEW, TEST, "level-ignored",
		"level: this.host.getBodySemantropy(), nonce: issueUint32Seed()", "level: 0, nonce: issueUint32Seed()",
		OPENS],
	[VIEW, TEST, "second-dialog-opened",
		"		if (this.lifecycle.closed || this.fakeAlertModal) return;", "		if (this.lifecycle.closed) return;",
		OPENS],
	[VIEW, TEST, "recent-not-passed",
		"nonce: issueUint32Seed(), recent: this.fakeAlertRecent,", "nonce: issueUint32Seed(), recent: [],",
		"passes the recent openings so the next draw can avoid them"],
	[VIEW, TEST, "recent-unbounded",
		"		this.fakeAlertRecent = [...this.fakeAlertRecent, alert.prompt.recipeId].slice(-FAKE_ALERT_RECENT_KEPT);",
		"		this.fakeAlertRecent = [...this.fakeAlertRecent, alert.prompt.recipeId];",
		"passes the recent openings so the next draw can avoid them"],
	// The View's onClose (the other place with this line is the plugin-disable path). WORKBENCH-UI5 added the two closes between.
	[VIEW, TEST, "dialog-outlives-the-view",
		"		this.closeFakeAlert(); this.fakeAlertRecent = []; this.fakeAlertRecentWords = [];\n		this.closeDictionaryHelp();\n		this.closeChooser();\n		this.closeVocabularyPicker();\n  this.dictionaryPopover?.dispose();",
		"		this.closeDictionaryHelp();\n		this.closeChooser();\n		this.closeVocabularyPicker();\n  this.dictionaryPopover?.dispose();",
		CLOSES],
	[VIEW, TEST, "dialog-not-relabelled",
		"		this.fakeAlertModal?.relabel();\n", "",
		CLOSES],
	// FAKE-ALERT-VARIETY1: the words of the pages actually shown.
	[MODAL, TEST, "shown-page-not-reported",
		"		this.shown?.(page);\n", "",
		"reports each page as it is shown"],
	[MODAL, TEST, "unshown-outcomes-reported",
		"		this.shown?.(page);\n", "		this.shown?.(page);\n		if (page === this.alert.prompt) for (const other of Object.values(this.alert.outcomes)) this.shown?.(other);\n",
		"reports each page as it is shown"],
	[VIEW, TEST, "recent-words-not-passed",
		"				recentWords: this.fakeAlertRecentWords });", "				recentWords: [] });",
		"passes the words of the pages actually shown"],
	[VIEW, TEST, "recent-words-unbounded",
		"		this.fakeAlertRecentWords = [...this.fakeAlertRecentWords.filter((word) => !shown.has(word)), ...shown].slice(-FAKE_ALERT_RECENT_WORDS_KEPT);",
		"		this.fakeAlertRecentWords = [...this.fakeAlertRecentWords.filter((word) => !shown.has(word)), ...shown];",
		"passes the words of the pages actually shown"],
	[VIEW, TEST, "recent-words-repeated",
		"		this.fakeAlertRecentWords = [...this.fakeAlertRecentWords.filter((word) => !shown.has(word)), ...shown].slice(-FAKE_ALERT_RECENT_WORDS_KEPT);",
		"		this.fakeAlertRecentWords = [...this.fakeAlertRecentWords, ...shown].slice(-FAKE_ALERT_RECENT_WORDS_KEPT);",
		"passes the words of the pages actually shown"],
];
