import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FuzzySuggestModal, Modal } from "./support/obsidianStub";
import {
	MODAL_OVERRIDE_POINTS,
	OBSIDIAN_FUZZY_MEMBERS,
	OBSIDIAN_MODAL_INSTANCE_MEMBERS,
	OBSIDIAN_MODAL_PROTOTYPE_MEMBERS,
	OBSIDIAN_SUGGEST_MEMBERS,
	OVERRIDE_POINTS,
	modalGuards,
	modalMembersToGuard,
	scanModalSubclasses,
	typedModalMembers,
	type SourceText,
} from "./support/modalMembers";

/*
 * DEFINE-DIALOG-FIX1. Obsidian 1.14.4's `Modal` constructor assigns the instance property
 * `isOpen = false`; `FakeDefinitionModal` had a method `isOpen()`, which that property hides, so
 * the definition dialog's Reshuffle, Copy, Collect and level controls threw. Neither the public
 * typings (1.13.1) nor the Modal stub knew the property, so every check passed.
 *
 * Two things are held here. (1) The stub's Modal behaves like the real one where a subclass can
 * collide with it. (2) No class in `src/` that extends Modal defines a member of that Modal itself,
 * other than the four documented override points (open, close, onOpen, onClose; FakeAlertModal
 * overrides `open()` on purpose). The scan reads the sources, so a new Modal subclass is covered
 * without an edit; the synthetic cases below hold the scan itself to what it claims.
 *
 * WORKBENCH-UI5: the same for `SuggestModal` and `FuzzySuggestModal`, which the target note picker
 * extends. A class that extends any other `*Modal` of obsidian is reported, not passed unchecked.
 */

const SRC = new URL("../src/", import.meta.url);

function sourceFiles(directory: URL = SRC, base = ""): SourceText[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = `${base}${entry.name}`;
		if (entry.isDirectory()) return sourceFiles(new URL(`${entry.name}/`, directory), `${path}/`);
		return entry.name.endsWith(".ts") ? [{ path: `src/${path}`, text: readFileSync(new URL(entry.name, directory), "utf8") }] : [];
	});
}

const DECLARATIONS = readFileSync(fileURLToPath(new URL("../node_modules/obsidian/obsidian.d.ts", import.meta.url)), "utf8");
const typings = typedModalMembers(DECLARATIONS);
const GUARDS = modalGuards(DECLARATIONS);
const GUARDED = GUARDS.Modal;
const scan = (text: string, path = "synthetic.ts") => scanModalSubclasses([{ path, text }], GUARDS);
const IMPORT = 'import { Modal } from "obsidian";\n';
const FUZZY = 'import { FuzzySuggestModal } from "obsidian";\n';

/** Held independently of the module that exports the list: the names read from Obsidian 1.14.4. */
const NAMES_OF_1_14_4 = [
	"win", "shouldAnimateOpen", "isOpen", "hasInitialInputFocus", "dimBackground", "bgOpacity", "app", "scope", "containerEl",
	"bgEl", "modalEl", "headerEl", "titleEl", "contentEl", "selection", "shouldRestoreSelection", "onCloseCallback",
	"getRootEl", "doc", "canAnimate", "animateOpen", "animateClose", "onHistoryBack", "onWindowClose", "onClickOutside",
	"canDismiss", "onEscapeKey", "setTitle", "setContent", "setBackgroundOpacity", "setCloseCallback", "setDimBackground",
];

describe("the Modal stub follows Obsidian 1.14.4 where a subclass can collide with it", () => {
	it("assigns isOpen = false in the constructor, as an own instance property", () => {
		const modal = new Modal({});
		expect(modal.isOpen).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(modal, "isOpen")).toBe(true);
	});

	it("open opens only when not open, and the flag is true before onOpen runs", () => {
		const seen: boolean[] = [];
		class Probe extends Modal { onOpen(): void { seen.push(this.isOpen); } }
		const modal = new Probe({});
		modal.open();
		expect(modal.isOpen).toBe(true);
		modal.open();
		expect(seen).toEqual([true]);
	});

	it("close closes only when open, and the flag is false before onClose runs", () => {
		const seen: boolean[] = [];
		class Probe extends Modal { onClose(): void { seen.push(this.isOpen); } }
		const modal = new Probe({});
		modal.close();
		expect(seen).toEqual([]);
		modal.open();
		modal.close();
		expect(modal.isOpen).toBe(false);
		modal.close();
		expect(seen).toEqual([false]);
		modal.open();
		expect(modal.isOpen).toBe(true);
	});

	it("hides a subclass method named isOpen, as the real constructor does (the defect, reproduced)", () => {
		// The stub declares the member, so the compiler itself refuses the clash that the public typings let through.
		// @ts-expect-error TS2425: the base class defines instance member property 'isOpen', the subclass a method.
		class Clashing extends Modal { isOpen(): boolean { return true; } }
		const modal = new Clashing({}) as unknown as { isOpen: unknown };
		expect(typeof modal.isOpen).toBe("boolean");
		expect(() => (modal.isOpen as () => boolean)()).toThrow(TypeError);
	});
});

describe("no Modal subclass in src/ defines a member of Obsidian's Modal", () => {
	it("scans the seven dialogs that exist and finds no clash", () => {
		const result = scanModalSubclasses(sourceFiles(), GUARDS);
		const names = result.classes.map((entry) => entry.className).sort();
		for (const expected of ["CollisionModal", "DictionaryHelpModal", "FakeAlertModal", "FakeDefinitionModal", "FakeProverbModal", "TargetNotePicker", "VocabularyModal"]) {
			expect(names, "the scan finds every dialog").toContain(expected);
		}
		expect(result.unsupportedBases).toEqual([]);
		expect(result.clashes).toEqual([]);
	});

	it("guards every name read from 1.14.4 and every name the public typings declare, except the override points", () => {
		for (const name of NAMES_OF_1_14_4) expect(GUARDED.has(name), name).toBe(true);
		expect(typings).toEqual(expect.arrayContaining(["app", "scope", "containerEl", "modalEl", "titleEl", "contentEl", "setTitle", "setContent"]));
		for (const name of typings) {
			expect(GUARDED.has(name), name).toBe(!MODAL_OVERRIDE_POINTS.includes(name) && name !== "constructor");
		}
		expect([...MODAL_OVERRIDE_POINTS]).toEqual(["open", "close", "onOpen", "onClose"]);
		for (const name of MODAL_OVERRIDE_POINTS) expect(GUARDED.has(name), name).toBe(false);
		// The module's pinned lists hold those names, and the override points among them.
		expect([...OBSIDIAN_MODAL_INSTANCE_MEMBERS, ...OBSIDIAN_MODAL_PROTOTYPE_MEMBERS]).toEqual(expect.arrayContaining([...NAMES_OF_1_14_4, ...MODAL_OVERRIDE_POINTS]));
	});
});

describe("the guard widens with the public typings", () => {
	it("adds whatever names the typings declare, so a newer obsidian package widens the guard", () => {
		const declared = typedModalMembers("export declare class Modal { constructor(app: App); brandNewMember: number; brandNewMethod(): void; open(): void; }");
		expect(declared).toEqual(["brandNewMember", "brandNewMethod", "open"]);
		const guarded = modalMembersToGuard(declared);
		expect(guarded.has("brandNewMember")).toBe(true);
		expect(guarded.has("brandNewMethod")).toBe(true);
		expect(guarded.has("open")).toBe(false);
		const widened = modalGuards("export declare class Modal { brandNewMethod(): void; }\nexport declare class SuggestModal { brandNewSuggest: number; }");
		expect(scanModalSubclasses([{ path: "synthetic.ts", text: `${IMPORT}class Dialog extends Modal { brandNewMethod(): void {} }` }], widened).clashes).toHaveLength(1);
		expect(widened.FuzzySuggestModal.has("brandNewSuggest")).toBe(true);
		expect(widened.Modal.has("brandNewSuggest")).toBe(false);
	});
});

describe("the scan holds itself to what it claims", () => {
	it.each(NAMES_OF_1_14_4)("flags a method, a property, a getter and a parameter property named %s", (name) => {
		for (const member of [`${name}(): void {}`, `${name} = 1;`, `get ${name}(): number { return 1; }`, `private ${name}!: number;`, `"${name}"(): void {}`]) {
			expect(scan(`${IMPORT}class Dialog extends Modal { ${member} }`).clashes, member).toEqual([{ path: "synthetic.ts", className: "Dialog", member: name }]);
		}
		expect(scan(`${IMPORT}class Dialog extends Modal { constructor(app: unknown, private readonly ${name}: number) { super(app); } }`).clashes).toHaveLength(1);
	});

	it("flags the original defect, a method named isOpen", () => {
		const result = scan(`${IMPORT}export class FakeDefinitionModal extends Modal {\n private opened = false;\n isOpen(): boolean { return this.opened; }\n}`);
		expect(result.clashes).toEqual([{ path: "synthetic.ts", className: "FakeDefinitionModal", member: "isOpen" }]);
	});

	it.each(MODAL_OVERRIDE_POINTS)("lets a subclass override %s()", (name) => {
		const result = scan(`${IMPORT}class Dialog extends Modal { ${name}(): void { super.${name}(); } }`);
		expect(result.classes).toHaveLength(1);
		expect(result.clashes).toEqual([]);
	});

	it("follows an alias of the import and a subclass of a subclass, in the same file or another", () => {
		expect(scan('import { Modal as ObsidianModal } from "obsidian";\nclass Dialog extends ObsidianModal { isOpen() {} }').clashes).toHaveLength(1);
		const files: SourceText[] = [
			{ path: "a.ts", text: `${IMPORT}export class Base extends Modal {}` },
			{ path: "b.ts", text: 'import { Base } from "./a";\nexport class Child extends Base { isOpen() {} }' },
		];
		const result = scanModalSubclasses(files, GUARDS);
		expect(result.classes.map((entry) => entry.className).sort()).toEqual(["Base", "Child"]);
		expect(result.clashes).toEqual([{ path: "b.ts", className: "Child", member: "isOpen" }]);
	});

	it("ignores what cannot hide an inherited member, and classes that are not Obsidian Modals", () => {
		expect(scan(`${IMPORT}class Dialog extends Modal { static isOpen(): boolean { return true; } #isOpen = 1; sync(): void {} private opened = false; }`).clashes).toEqual([]);
		expect(scan("class Modal {}\nclass Mine extends Modal { isOpen() {} }").classes).toEqual([]);
		expect(scan('import { Modal } from "./other";\nclass Mine extends Modal { isOpen() {} }').classes).toEqual([]);
		expect(scan(`${IMPORT}class Plain { isOpen() {} }`).classes).toEqual([]);
	});

	it("reports another *Modal of obsidian as unsupported instead of letting it pass unchecked", () => {
		const result = scan('import { ButtonModal } from "obsidian";\nclass Picker extends ButtonModal { getSuggestions() { return []; } }');
		expect(result.unsupportedBases).toEqual([{ path: "synthetic.ts", className: "Picker", base: "ButtonModal" }]);
	});
});

describe("the suggestion modals (WORKBENCH-UI5)", () => {
	const SUGGEST_NAMES = [...OBSIDIAN_SUGGEST_MEMBERS, ...OBSIDIAN_FUZZY_MEMBERS];
	it("a FuzzySuggestModal may override the three it exists to override, the Modal points and nothing else of its own", () => {
		// Named here, not read from the list under test: narrowing the list must fail this, not quietly shrink the loop.
		for (const name of ["getItems", "getItemText", "onChooseItem", "open", "close", "onClose"]) {
			expect(scan(`${FUZZY}class Picker extends FuzzySuggestModal<string> { ${name}(): void {} }`).clashes, name).toEqual([]);
		}
		// SuggestModal builds its prompt in an onOpen of its own: defining one is for a look (it must call super), not free.
		expect(scan(`${FUZZY}class Picker extends FuzzySuggestModal<string> { onOpen(): void {} }`).clashes).toHaveLength(1);
		expect(scan('import { SuggestModal } from "obsidian";\nclass Picker extends SuggestModal<string> { onOpen(): void {} }').clashes).toHaveLength(1);
		expect(scan(`${IMPORT}class Dialog extends Modal { onOpen(): void {} }`).clashes).toEqual([]);
		expect(OVERRIDE_POINTS.FuzzySuggestModal).toEqual(expect.arrayContaining(["getItems", "getItemText", "onChooseItem"]));
		const picker = scan(`${FUZZY}class Picker extends FuzzySuggestModal<string> { getItems() { return []; } getItemText() { return ""; } onChooseItem() {} onClose() {} }`);
		expect(picker.clashes).toEqual([]);
		expect(picker.classes).toEqual([{ path: "synthetic.ts", className: "Picker", base: "FuzzySuggestModal" }]);
		const own = SUGGEST_NAMES.filter((name) => !OVERRIDE_POINTS.FuzzySuggestModal.includes(name));
		expect(own).toEqual(expect.arrayContaining(["limit", "emptyStateText", "inputEl", "resultContainerEl", "instructionsEl", "chooser", "setPlaceholder", "selectSuggestion", "sortSuggestions"]));
		for (const name of own) {
			expect(scan(`${FUZZY}class Picker extends FuzzySuggestModal<string> { ${name}: unknown; }`).clashes, name).toEqual([{ path: "synthetic.ts", className: "Picker", member: name }]);
		}
	});

	it("also holds a FuzzySuggestModal to Modal's names (the defect that started this: an `isOpen` of its own)", () => {
		for (const name of NAMES_OF_1_14_4) {
			expect(scan(`${FUZZY}class Picker extends FuzzySuggestModal<string> { ${name}(): void {} }`).clashes, name).toHaveLength(1);
		}
	});

	it("a SuggestModal may override its three abstract methods, a Modal may not (they are not Modal's points)", () => {
		const suggest = 'import { SuggestModal } from "obsidian";\n';
		for (const name of ["getSuggestions", "renderSuggestion", "onChooseSuggestion"]) {
			expect(scan(`${suggest}class Picker extends SuggestModal<string> { ${name}(): void {} }`).clashes, name).toEqual([]);
			expect(scan(`${IMPORT}class Dialog extends Modal { ${name}(): void {} }`).clashes, name).toEqual([]);
		}
		expect(scan(`${suggest}class Picker extends SuggestModal<string> { onNoSuggestion(): void {} }`).clashes).toHaveLength(1);
		// What the constructor assigns is not an override point: a picker with a `limit` of its own would be hidden by it.
		for (const name of ["limit", "inputEl", "emptyStateText", "setPlaceholder"]) {
			expect(scan(`${suggest}class Picker extends SuggestModal<string> { ${name}: unknown; }`).clashes, name).toHaveLength(1);
		}
		// A name only a suggestion modal has is no clash for a plain Modal.
		expect(scan(`${IMPORT}class Dialog extends Modal { inputEl = 1; limit = 2; }`).clashes).toEqual([]);
	});

	it("follows a subclass of a suggestion modal, and uses its root's names", () => {
		const files: SourceText[] = [
			{ path: "a.ts", text: `${FUZZY}export class Base extends FuzzySuggestModal<string> {}` },
			{ path: "b.ts", text: 'import { Base } from "./a";\nexport class Child extends Base { inputEl = 1; }' },
		];
		const result = scanModalSubclasses(files, GUARDS);
		expect(result.classes).toEqual([{ path: "a.ts", className: "Base", base: "FuzzySuggestModal" }, { path: "b.ts", className: "Child", base: "FuzzySuggestModal" }]);
		expect(result.clashes).toEqual([{ path: "b.ts", className: "Child", member: "inputEl" }]);
	});

	it("keeps the stub's suggestion modals like Obsidian's: the constructor assigns the members, and a choice closes the modal first", () => {
		const events: string[] = [];
		class Probe extends FuzzySuggestModal<string> {
			getItems(): string[] { return ["a.md", "b.md"]; }
			getItemText(item: string): string { return item; }
			onChooseItem(item: string): void { events.push(`choose ${item}`); }
			onClose(): void { events.push("close"); }
		}
		const probe = new Probe({});
		expect([probe.limit, typeof probe.emptyStateText, probe.inputEl !== undefined, probe.resultContainerEl !== undefined]).toEqual([100, "string", true, true]);
		probe.open();
		expect(probe.getSuggestions("B").map((match) => match.item)).toEqual(["b.md"]);
		probe.selectSuggestion({ item: "b.md", match: { score: 0, matches: [] } }, new Event("click") as never);
		expect(events).toEqual(["close", "choose b.md"]);
	});
});
