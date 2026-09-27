import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PRE-RELEASE-EXPERIENCE-MODAL-LAYOUT1. Layout contract only: the selected-note
 * list must not share the file tree's flex base, and each modal's width is its
 * own rule. Real pixel measurements live in the implementation record; jsdom
 * does not apply flex layout.
 */
const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const MODALS = [
	".semantropy-vocabulary-modal",
	".semantropy-collision-modal",
	".semantropy-fake-proverb-modal",
	".semantropy-dictionary-modal",
];

function declarations(selector: string): string {
	return css.split("}").flatMap(block => {
		const [head = "", body] = block.split("{");
		if (!body || !head.split(",").some(part => part.trim() === selector)) return [];
		return [body];
	}).join("\n");
}

describe("vocabulary dialog height", () => {
	it("keeps a short selected list at its content height, capped by the window, and gives the tree the rest", () => {
		const selected = declarations(".semantropy-vocabulary-selected");
		expect(selected).toMatch(/flex:\s*0 0 auto;/);
		expect(selected).toMatch(/max-height:\s*22vh;/);
		expect(selected).not.toMatch(/flex:\s*1 1 auto;/);
		const browse = declarations(".semantropy-vocabulary-browse");
		expect(browse).toMatch(/flex:\s*1 1 auto;/);
		expect(browse).toMatch(/min-height:\s*0;/);
		expect(browse).toMatch(/overflow:\s*hidden;/);
		expect(declarations(".semantropy-vocabulary-selected ul")).toMatch(/overflow-y:\s*auto;/);
		expect(declarations(".semantropy-vocabulary-tree")).toMatch(/overflow-y:\s*auto;/);
		expect(declarations(".semantropy-vocabulary-actions")).toMatch(/flex:\s*0 0 auto;/);
		expect(declarations(".semantropy-vocabulary-modal")).toMatch(/max-height:\s*90vh;/);
	});
});

describe("modal widths", () => {
	it("sets each dialog width on its own rule", () => {
		expect(declarations(".semantropy-vocabulary-modal")).toMatch(/width:\s*min\(34rem,\s*95vw\);/);
		expect(declarations(".semantropy-vocabulary-modal")).toMatch(/min-width:\s*0;/);
		expect(declarations(".semantropy-collision-modal")).toMatch(/width:\s*min\(38rem,\s*95vw\);/);
		expect(declarations(".semantropy-collision-modal")).toMatch(/--dialog-width:\s*min\(38rem,\s*95vw\);/);
		expect(declarations(".semantropy-collision-modal")).toMatch(/min-width:\s*0;/);
		expect(declarations(".semantropy-fake-proverb-modal")).toMatch(/width:\s*min\(36rem,\s*95vw\);/);
		expect(declarations(".semantropy-fake-proverb-modal")).toMatch(/min-width:\s*0;/);
		const dictionary = declarations(".semantropy-dictionary-modal");
		expect(dictionary).toMatch(/width:\s*fit-content;/);
		expect(dictionary).toMatch(/max-width:\s*min\(32rem,\s*95vw\);/);
		expect(dictionary).toMatch(/min-width:\s*min\(16rem,\s*95vw\);/);
		expect(declarations(".semantropy-dictionary-popover")).toMatch(/width:\s*24rem;/);
	});

	it("shrinks the level popup and the automatic parts-of-speech menu to their controls", () => {
		const level = declarations(".semantropy-toolbar-item > .semantropy-level-popup");
		expect(level).toMatch(/width:\s*fit-content;/);
		expect(level).toMatch(/max-width:\s*16rem;/);
		expect(declarations(".semantropy-level-popup .semantropy-level-select")).toMatch(/width:\s*auto;/);
		const automatic = declarations(".semantropy-automatic-pos-toolbar > .semantropy-automatic-pos-menu.semantropy-toolbar-popup");
		expect(automatic).toMatch(/width:\s*min\(14rem,\s*100%\);/);
		expect(automatic).toMatch(/max-width:\s*min\(14rem,\s*100%\);/);
		expect(declarations(".semantropy-toolbar-popup")).toMatch(/width:\s*min\(20rem,\s*100%\);/);
		expect(declarations(".semantropy-more-menu .semantropy-level-popup")).toMatch(/width:\s*auto;/);
	});

	it("does not give the four dialogs one shared width", () => {
		for (const block of css.split("}")) {
			const [head = "", body = ""] = block.split("{");
			if (!/width:/.test(body)) continue;
			const named = MODALS.filter(selector => head.split(",").some(part => part.trim() === selector));
			expect(named).toHaveLength(named.length > 1 ? 0 : named.length);
		}
	});
});
