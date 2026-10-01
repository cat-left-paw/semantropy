// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";

/*
 * 0.1.0 owner reports after the S5 review: Display settings on a phone, the
 * pressed switches after a tap, and the web Recompose output box.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => document.body.replaceChildren());

const LEXICON = [token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "と", pos: "助詞", detail1: "並立助詞" })];
/** The declarations of one exact selector list in a stylesheet. */
function block(css: string, selector: string): string {
	const start = css.indexOf(`${selector} {`);
	expect(start).toBeGreaterThanOrEqual(0);
	return css.slice(start, css.indexOf("}", start));
}

describe("0.1.0 Display settings fits a phone", () => {
	it("keeps the colour fields out of the layout until Custom, and puts the four switches two per row", async () => {
		const h = manualMorphHarness(lexiconTokenizer(LEXICON));
		await h.open("猫と犬。\n");
		const root = h.peek.contentEl;
		const fields = Array.from(root.querySelectorAll<HTMLInputElement>(".semantropy-color-input"));
		expect(fields.map((field) => [field.hidden, field.disabled])).toEqual([[true, true], [true, true]]);
		const toggles = root.querySelector(".semantropy-display-toggles")!;
		expect(Array.from(toggles.children, (child) => child.classList.contains("semantropy-display-toggle"))).toEqual([true, true, true, true]);
		const select = root.querySelector<HTMLSelectElement>("select.semantropy-color-bodyForeground")!;
		document.body.appendChild(root);
		select.value = "custom"; select.dispatchEvent(new Event("change"));
		const field = root.querySelector<HTMLInputElement>(".semantropy-color-input-bodyForeground")!;
		expect([field.hidden, field.disabled]).toEqual([false, false]);
		expect(document.activeElement).toBe(field);
	});

	it("lays the switches out in two columns and keeps a pressed switch coloured under a hover style", () => {
		const css = readFileSync("styles.css", "utf8");
		expect(block(css, ".semantropy-display-toggles")).toMatch(/grid-template-columns:\s*repeat\(2,/u);
		expect(css).toContain('button.semantropy-display-toggle[aria-pressed="true"]:hover:not(:disabled)');
	});
});

describe("0.1.0 web page styles", () => {
	it("applies hover colours only where a pointer can hover, and scrolls the Recompose output in its own box", () => {
		const css = readFileSync("web/styles/web.css", "utf8");
		// Each generic button hover rule appears once, directly inside a (hover: hover) query.
		for (const rule of ['button:hover:not(:disabled):not([aria-disabled="true"])', "button.mod-cta:hover:not(:disabled)"]) {
			expect(css.split(rule)).toHaveLength(2);
			expect(css).toContain(`@media (hover: hover) {\n\t${rule} {`);
		}
		const output = block(css, ".sw-rc-output");
		expect(output).toMatch(/max-height:/u);
		expect(output).toMatch(/overflow:\s*auto/u);
	});
});
