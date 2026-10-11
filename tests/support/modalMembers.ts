import * as ts from "typescript";

/*
 * DEFINE-DIALOG-FIX1: the names a subclass of Obsidian's `Modal` must not define itself.
 *
 * `FakeDefinitionModal` had a method `isOpen()`. Obsidian 1.14.4's `Modal` constructor assigns an
 * instance property of that name, which hides the subclass method, so `isOpen()` threw
 * "is not a function" in the application. The public typings (1.13.1) do not declare the property,
 * so type-checking and the tests (whose Modal stub did not have it either) passed.
 *
 * This list is what the class in the 1.14.4 application code (`obsidian-1.14.4.asar`, the class that
 * builds `createDiv("modal-container")` with a `modal-bg`, a `modal` and a `modal-header`) assigns or
 * defines, read by hand on 2026-10-08; it is not necessarily every name another version has. The
 * public typings' members of the same class are added when the guard runs, so a newer `obsidian`
 * package widens the list without an edit here.
 *
 * WORKBENCH-UI5 extends it to `SuggestModal` and `FuzzySuggestModal` (the target note picker is a
 * `FuzzySuggestModal`), read the same way from the same file: the constructor of the class that builds
 * `prompt-input-container` and `prompt-results`, and the class that scores items.
 */
export const OBSIDIAN_MODAL_INSTANCE_MEMBERS: readonly string[] = [
	// Assigned in the constructor.
	"win", "shouldAnimateOpen", "isOpen", "hasInitialInputFocus", "dimBackground", "bgOpacity", "app", "scope",
	"containerEl", "bgEl", "modalEl", "headerEl", "titleEl", "contentEl", "selection", "shouldRestoreSelection",
	// Assigned by `setCloseCallback()` and read by `close()`.
	"onCloseCallback",
];
export const OBSIDIAN_MODAL_PROTOTYPE_MEMBERS: readonly string[] = [
	"getRootEl", "doc", "canAnimate", "open", "animateOpen", "animateClose", "onHistoryBack", "close", "onOpen", "onClose",
	"onWindowClose", "onClickOutside", "canDismiss", "onEscapeKey",
	// The public setters (`setTitle`, `setContent`, `setCloseCallback` are in the typings; the other two are not).
	"setTitle", "setContent", "setBackgroundOpacity", "setCloseCallback", "setDimBackground",
];
/** `SuggestModal`: assigned in its constructor, and defined on its prototype (the abstract three are in SUGGEST_OVERRIDE_POINTS). */
export const OBSIDIAN_SUGGEST_MEMBERS: readonly string[] = [
	"limit", "emptyStateText", "inputEl", "clearButtonEl", "ctaEl", "resultContainerEl", "instructionsEl", "chooser",
	"setPlaceholder", "setInstructions", "onInput", "updateSuggestions", "onNoSuggestion", "selectSuggestion", "selectActiveSuggestion",
	"getSuggestions", "renderSuggestion", "onChooseSuggestion",
];
/** `FuzzySuggestModal`: its own prototype members; the three abstract ones are in FUZZY_OVERRIDE_POINTS. */
export const OBSIDIAN_FUZZY_MEMBERS: readonly string[] = ["sortSuggestions", "getItems", "getItemText", "onChooseItem"];

export type ModalBase = "Modal" | "SuggestModal" | "FuzzySuggestModal";
export const MODAL_BASES: readonly ModalBase[] = ["Modal", "SuggestModal", "FuzzySuggestModal"];

/** The documented points a subclass is meant to override. They are not clashes. */
export const MODAL_OVERRIDE_POINTS: readonly string[] = ["open", "close", "onOpen", "onClose"];
const SUGGEST_OVERRIDE_POINTS: readonly string[] = ["getSuggestions", "renderSuggestion", "onChooseSuggestion"];
const FUZZY_OVERRIDE_POINTS: readonly string[] = ["getItems", "getItemText", "onChooseItem", "renderSuggestion"];

/**
 * `SuggestModal` builds its prompt in an `onOpen()` of its own, so a subclass that defines `onOpen()` replaces it unless it calls
 * `super.onOpen()`: for these two it is not a free override point, and the guard asks for a look (review 2, P3 9).
 */
const SUGGEST_BASE_POINTS: readonly string[] = MODAL_OVERRIDE_POINTS.filter((name) => name !== "onOpen");

/** What each kind of subclass may override on purpose. */
export const OVERRIDE_POINTS: Readonly<Record<ModalBase, readonly string[]>> = {
	Modal: MODAL_OVERRIDE_POINTS,
	SuggestModal: [...SUGGEST_BASE_POINTS, ...SUGGEST_OVERRIDE_POINTS],
	FuzzySuggestModal: [...SUGGEST_BASE_POINTS, ...FUZZY_OVERRIDE_POINTS],
};

/** The members of one class the public typings declare, read from `node_modules/obsidian/obsidian.d.ts`. */
export function typedModalMembers(declarationText: string, className = "Modal"): string[] {
	const file = ts.createSourceFile("obsidian.d.ts", declarationText, ts.ScriptTarget.ES2021, true);
	const names = new Set<string>();
	for (const statement of file.statements) {
		if (!ts.isClassDeclaration(statement) || statement.name?.text !== className) continue;
		for (const member of statement.members) {
			const name = memberName(member);
			if (name !== null) names.add(name);
		}
	}
	return [...names];
}

const withoutOverrides = (names: readonly string[], base: ModalBase): ReadonlySet<string> =>
	new Set(names.filter((name) => !OVERRIDE_POINTS[base].includes(name) && name !== "constructor"));

export function modalMembersToGuard(typed: readonly string[]): ReadonlySet<string> {
	return withoutOverrides([...OBSIDIAN_MODAL_INSTANCE_MEMBERS, ...OBSIDIAN_MODAL_PROTOTYPE_MEMBERS, ...typed], "Modal");
}

/**
 * The names each kind of subclass must not define: `Modal`'s own, and for the suggestion modals the names of
 * every class above them too, less what each may override on purpose. `typed` is the declaration text.
 */
export function modalGuards(declarationText: string): Readonly<Record<ModalBase, ReadonlySet<string>>> {
	const modal = [...OBSIDIAN_MODAL_INSTANCE_MEMBERS, ...OBSIDIAN_MODAL_PROTOTYPE_MEMBERS, ...typedModalMembers(declarationText, "Modal")];
	const suggest = [...modal, ...OBSIDIAN_SUGGEST_MEMBERS, ...typedModalMembers(declarationText, "SuggestModal")];
	const fuzzy = [...suggest, ...OBSIDIAN_FUZZY_MEMBERS, ...typedModalMembers(declarationText, "FuzzySuggestModal")];
	return { Modal: withoutOverrides(modal, "Modal"), SuggestModal: withoutOverrides(suggest, "SuggestModal"), FuzzySuggestModal: withoutOverrides(fuzzy, "FuzzySuggestModal") };
}

export type SourceText = { readonly path: string; readonly text: string };
export type ModalClash = { readonly path: string; readonly className: string; readonly member: string };
export type ModalScan = {
	/** Every class that extends `Modal` (or a suggestion modal) from "obsidian", directly or through another class of the scanned files. */
	readonly classes: readonly { readonly path: string; readonly className: string; readonly base: ModalBase }[];
	readonly clashes: readonly ModalClash[];
	/** A class that extends another `*Modal` of "obsidian": its members are not in any list. */
	readonly unsupportedBases: readonly { readonly path: string; readonly className: string; readonly base: string }[];
};

/**
 * Finds the classes that extend Obsidian's `Modal` (or `SuggestModal` or `FuzzySuggestModal`) and the instance
 * members each declares itself (methods, properties, accessors and constructor parameter properties; `#private`
 * names and `static` members cannot hide an inherited instance member, so they are skipped).
 */
export function scanModalSubclasses(files: readonly SourceText[], guards: Readonly<Record<ModalBase, ReadonlySet<string>>>): ModalScan {
	type Candidate = { path: string; className: string; base: string; members: string[] };
	const candidates: Candidate[] = [];
	const importedBases = new Map<string, Map<string, ModalBase>>();
	const unsupportedBases: { path: string; className: string; base: string }[] = [];
	for (const { path, text } of files) {
		const file = ts.createSourceFile(path, text, ts.ScriptTarget.ES2021, true);
		// The local names under which this file imports a supported base, and the other `*Modal` classes of "obsidian".
		const local = new Map<string, ModalBase>();
		const otherModals = new Map<string, string>();
		for (const statement of file.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "obsidian") continue;
			const bindings = statement.importClause?.namedBindings;
			if (!bindings || !ts.isNamedImports(bindings)) continue;
			for (const element of bindings.elements) {
				const imported = (element.propertyName ?? element.name).text;
				if ((MODAL_BASES as readonly string[]).includes(imported)) local.set(element.name.text, imported as ModalBase);
				else if (imported.endsWith("Modal")) otherModals.set(element.name.text, imported);
			}
		}
		importedBases.set(path, local);
		const visit = (node: ts.Node): void => {
			if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
				const className = node.name?.text ?? "<anonymous>";
				const base = baseName(node);
				if (base !== null) {
					if (otherModals.has(base)) unsupportedBases.push({ path, className, base: otherModals.get(base)! });
					candidates.push({ path, className, base, members: declaredMembers(node) });
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(file);
	}
	// A class is a modal subclass when its base is an imported supported base of its own file, or another such class (by name).
	const kindOf = new Map<string, ModalBase>();
	const kind = (candidate: Candidate): ModalBase | undefined => importedBases.get(candidate.path)?.get(candidate.base) ?? kindOf.get(candidate.base);
	for (let changed = true; changed;) {
		changed = false;
		for (const candidate of candidates) {
			const found = kind(candidate);
			if (found && !kindOf.has(candidate.className)) { kindOf.set(candidate.className, found); changed = true; }
		}
	}
	const classes = candidates.flatMap((candidate) => {
		const found = kind(candidate);
		return found ? [{ ...candidate, found }] : [];
	});
	const clashes = classes.flatMap((candidate) => candidate.members
		.filter((member) => guards[candidate.found].has(member))
		.map((member) => ({ path: candidate.path, className: candidate.className, member })));
	return {
		classes: classes.map(({ path, className, found }) => ({ path, className, base: found })),
		clashes,
		unsupportedBases,
	};
}

function baseName(node: ts.ClassLikeDeclaration): string | null {
	for (const clause of node.heritageClauses ?? []) {
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
		const expression = clause.types[0]?.expression;
		if (expression && ts.isIdentifier(expression)) return expression.text;
	}
	return null;
}

function declaredMembers(node: ts.ClassLikeDeclaration): string[] {
	const names: string[] = [];
	for (const member of node.members) {
		if (ts.isConstructorDeclaration(member)) {
			// `constructor(private readonly host: Host)` declares an instance property.
			for (const parameter of member.parameters) {
				const isProperty = (ts.getCombinedModifierFlags(parameter) & (ts.ModifierFlags.Public | ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Readonly)) !== 0;
				if (isProperty && ts.isIdentifier(parameter.name)) names.push(parameter.name.text);
			}
			continue;
		}
		if (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) continue;
		const name = memberName(member);
		if (name !== null) names.push(name);
	}
	return names;
}

/** The identifier or string-literal name of a method, property or accessor; `#private` and computed names are skipped. */
function memberName(member: ts.ClassElement | ts.TypeElement): string | null {
	if (!(ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member))) return null;
	const name = member.name;
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
	return null;
}
