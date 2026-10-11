/**
 * DEFINE-DIALOG-FIX1 probes for the shared temporary-copy runner
 * (`node scripts/adverb/verifyAdverbMutations.mjs --define-dialog`). Each one puts
 * back the defect (the View reading the dialog's open state through `isOpen`, the
 * name Obsidian 1.14.4's Modal assigns as an instance property) at one place, or
 * weakens the Modal stub or the member-name guard; the named assertion has to be
 * what fails. The checkout is never written.
 *
 * The dialog's rename touches the Modal and five reads in the View, and the runner
 * mutates one file per probe: so each read is put back on its own (a read that
 * throws "is not a function" is the original defect at that place), and the
 * Modal's own method is put back by two probes (the name only, and the name as an
 * extra method that the View does not call, which only the guard can see).
 *
 * Not here: the same read in the built bundle (`tests/distribution/artifact.test.ts`, "defines a selected word from
 * the artifact"). The runner's copy holds no build inputs, so that suite cannot run in it; it was put back by hand in
 * a full temporary copy instead (`Docs/define_dialog_fix1_record.md`).
 */
const VIEW = "src/view/SemantropyView.ts";
const MODAL = "src/view/FakeDefinitionModal.ts";
const STUB = "tests/support/obsidianStub.ts";
const SCAN = "tests/support/modalMembers.ts";
const DIALOG = "tests/defineDialogFix1.test.ts";
const GUARD = "tests/modalMemberNames.test.ts";

const RESHUFFLE = "Reshuffle draws another definition";
const REUSE = "a second Define while the dialog is open reuses that dialog";
const REFUSED = "while the dialog is open, hover, Apply and the automatic claim are refused";
const STUB_FLAG = "assigns isOpen = false in the constructor";
const STUB_OPEN = "opens only when not open";
const STUB_CLOSE = "closes only when open";
const STUB_ORDER = "the flag is true before onOpen runs";
const NO_CLASH = "scans the seven dialogs that exist and finds no clash";
const FLAGS_DEFECT = "flags the original defect, a method named isOpen";
const FLAGS_EACH = "flags a method, a property, a getter and a parameter property named";
const GUARDS_ALL = "guards every name read from 1.14.4 and every name the public typings declare";
const WIDENS = "adds whatever names the typings declare";
const FOLLOWS = "follows an alias of the import and a subclass of a subclass";
const IGNORES = "ignores what cannot hide an inherited member";
const FUZZY_HOLDS_MODAL = "also holds a FuzzySuggestModal to Modal's names";
const FUZZY_MAY = "a FuzzySuggestModal may override the three it exists to override";
const SUGGEST_POINTS = "a SuggestModal may override its three abstract methods";
const UNSUPPORTED = "reports another";
const STUB_SUGGEST = "keeps the stub's suggestion modals like Obsidian's";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	// The View's five reads of the dialog's open state, each back on the name the Modal's own property hides.
	[VIEW, DIALOG, "view-definition-is-open-reads-isOpen",
		"return !!this.definitionModal?.isShowing() || !!this.dictionaryPopover?.isOpen();",
		"return !!this.definitionModal?.isOpen() || !!this.dictionaryPopover?.isOpen();", RESHUFFLE],
	[VIEW, DIALOG, "view-ensure-modal-reads-isOpen",
		"if (this.definitionModal && this.definitionModal.isShowing()) {",
		"if (this.definitionModal && this.definitionModal.isOpen()) {", REUSE],
	[VIEW, DIALOG, "view-hover-can-start-reads-isOpen",
		"!this.definitionModal?.isShowing() && !this.collisionModal",
		"!this.definitionModal?.isOpen() && !this.collisionModal", REFUSED],
	[VIEW, DIALOG, "view-automatic-claim-reads-isOpen",
		"this.pendingDefineId !== null || this.definitionModal?.isShowing()) return null;",
		"this.pendingDefineId !== null || this.definitionModal?.isOpen()) return null;", REFUSED],
	[VIEW, DIALOG, "view-apply-vocabulary-reads-isOpen",
		"this.definitionModal?.isShowing()) { if (token !== null)",
		"this.definitionModal?.isOpen()) { if (token !== null)", REFUSED],
	// The Modal's own method, back on the clashing name.
	[MODAL, DIALOG, "modal-method-named-isOpen",
		" isShowing(): boolean { return this.opened; }",
		" isOpen(): boolean { return this.opened; }", RESHUFFLE],
	[MODAL, GUARD, "modal-keeps-an-isOpen-method-beside-the-new-one",
		" isShowing(): boolean { return this.opened; }",
		" isShowing(): boolean { return this.opened; }\n isOpen(): boolean { return this.opened; }", NO_CLASH],
	// The Modal stub, weakened: it must keep following Obsidian's constructor and open() / close().
	[STUB, GUARD, "stub-drops-the-isOpen-property", "\tisOpen = false;\n", "", STUB_FLAG],
	[STUB, GUARD, "stub-open-does-not-check-the-flag", "if (this.isOpen) {", "if (false) {", STUB_OPEN],
	[STUB, GUARD, "stub-close-does-not-check-the-flag", "if (!this.isOpen) {", "if (false) {", STUB_CLOSE],
	[STUB, GUARD, "stub-sets-the-flag-after-onOpen",
		'		this.isOpen = true;\n		if (typeof document !== "undefined") {\n			document.body.appendChild(this.containerEl);\n		}\n		this.onOpen();',
		'		if (typeof document !== "undefined") {\n			document.body.appendChild(this.containerEl);\n		}\n		this.onOpen();\n		this.isOpen = true;', STUB_ORDER],
	// The guard, weakened: the scan must keep seeing what it claims to see.
	[SCAN, GUARD, "scan-skips-methods",
		"if (!(ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member) ||",
		"if (!(ts.isPropertyDeclaration(member) ||", FLAGS_DEFECT],
	[SCAN, GUARD, "list-forgets-isOpen",
		'"win", "shouldAnimateOpen", "isOpen", "hasInitialInputFocus"',
		'"win", "shouldAnimateOpen", "hasInitialInputFocus"', FLAGS_DEFECT],
	[SCAN, GUARD, "scan-skips-parameter-properties",
		"if (isProperty && ts.isIdentifier(parameter.name)) names.push(parameter.name.text);",
		"if (false && isProperty && ts.isIdentifier(parameter.name)) names.push(parameter.name.text);", FLAGS_EACH],
	[SCAN, GUARD, "scan-skips-getters",
		"ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)))",
		"false))", FLAGS_EACH],
	[SCAN, GUARD, "scan-does-not-follow-subclasses",
		"?? kindOf.get(candidate.base);", "?? undefined;", FOLLOWS],
	[SCAN, GUARD, "scan-does-not-follow-the-import-alias",
		"local.set(element.name.text, imported as ModalBase);",
		"local.set(imported, imported as ModalBase);", FOLLOWS],
	[SCAN, GUARD, "scan-counts-static-members",
		"if (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) continue;",
		"if (false) continue;", IGNORES],
	[SCAN, GUARD, "scan-finds-no-class",
		"return found ? [{ ...candidate, found }] : [];",
		"return [];", NO_CLASH],
	[SCAN, GUARD, "override-points-widened",
		'export const MODAL_OVERRIDE_POINTS: readonly string[] = ["open", "close", "onOpen", "onClose"];',
		'export const MODAL_OVERRIDE_POINTS: readonly string[] = ["open", "close", "onOpen", "onClose", "isOpen"];', GUARDS_ALL],
	[SCAN, GUARD, "guard-ignores-the-public-typings",
		"...OBSIDIAN_MODAL_PROTOTYPE_MEMBERS, ...typed]",
		"...OBSIDIAN_MODAL_PROTOTYPE_MEMBERS]", WIDENS],
	// WORKBENCH-UI5: the target note picker is a FuzzySuggestModal, so the guard and the stub cover the suggestion modals too.
	[SCAN, GUARD, "fuzzy-forgets-the-suggest-names",
		"const fuzzy = [...suggest, ...OBSIDIAN_FUZZY_MEMBERS", "const fuzzy = [...OBSIDIAN_FUZZY_MEMBERS", FUZZY_HOLDS_MODAL],
	[SCAN, GUARD, "suggest-forgets-the-modal-names",
		"const suggest = [...modal, ...OBSIDIAN_SUGGEST_MEMBERS", "const suggest = [...OBSIDIAN_SUGGEST_MEMBERS", FUZZY_HOLDS_MODAL],
	[SCAN, GUARD, "fuzzy-points-narrowed",
		'["getItems", "getItemText", "onChooseItem", "renderSuggestion"];', '["getItems", "onChooseItem", "renderSuggestion"];', FUZZY_MAY],
	[SCAN, GUARD, "suggest-points-widened",
		'["getSuggestions", "renderSuggestion", "onChooseSuggestion"];', '["getSuggestions", "renderSuggestion", "onChooseSuggestion", "limit"];', SUGGEST_POINTS],
	[SCAN, GUARD, "scan-passes-another-obsidian-modal",
		"if (otherModals.has(base)) unsupportedBases.push(", "if (false) unsupportedBases.push(", UNSUPPORTED],
	[STUB, GUARD, "stub-suggestion-closes-after-the-choice",
		"\t\tthis.close();\n\t\tthis.onChooseSuggestion(value, evt);", "\t\tthis.onChooseSuggestion(value, evt);\n\t\tthis.close();", STUB_SUGGEST],
	[STUB, GUARD, "stub-suggestion-drops-limit",
		"\tlimit = 100;\n", "", STUB_SUGGEST],
	// WORKBENCH-UI5 review 2 (P3 9): SuggestModal builds its prompt in an onOpen of its own, so it is not a free override point there.
	[SCAN, GUARD, "suggest-onopen-a-free-override",
		'const SUGGEST_BASE_POINTS: readonly string[] = MODAL_OVERRIDE_POINTS.filter((name) => name !== "onOpen");',
		"const SUGGEST_BASE_POINTS: readonly string[] = MODAL_OVERRIDE_POINTS;", FUZZY_MAY],
	[SCAN, GUARD, "fuzzy-onopen-a-free-override",
		"FuzzySuggestModal: [...SUGGEST_BASE_POINTS, ...FUZZY_OVERRIDE_POINTS],",
		"FuzzySuggestModal: [...MODAL_OVERRIDE_POINTS, ...FUZZY_OVERRIDE_POINTS],", FUZZY_MAY],
	[SCAN, GUARD, "suggest-modal-onopen-a-free-override",
		"SuggestModal: [...SUGGEST_BASE_POINTS, ...SUGGEST_OVERRIDE_POINTS],",
		"SuggestModal: [...MODAL_OVERRIDE_POINTS, ...SUGGEST_OVERRIDE_POINTS],", FUZZY_MAY],
];
