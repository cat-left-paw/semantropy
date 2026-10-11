import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * COLLISION-LOCK1, the look of a word. A locked word is marked by a background and by a solid underline (so the state
 * does not rest on colour alone), and a word shows the pointer's mark only for a pointer that can hover: on a touch
 * screen a tapped word keeps :hover until something else is tapped, and would look pressed long after the tap.
 */

const css = readFileSync("styles.css", "utf8");

/** The text of the rule whose selector list is exactly `selector`, braces excluded. */
function ruleBody(source: string, selector: string): string {
	const start = source.indexOf(`${selector} {`);
	expect(start, `a rule for ${selector}`).toBeGreaterThanOrEqual(0);
	expect(source.indexOf(`${selector} {`, start + 1), `one rule for ${selector}`).toBe(-1);
	const open = source.indexOf("{", start), close = source.indexOf("}", open);
	return source.slice(open + 1, close);
}
const HOVER_BLOCK = /@media \(hover: hover\) \{[\s\S]*?\n\}/gu;

describe("the look of a word of a Collision row", () => {
	it("marks a locked word by a background and a solid underline, and an unlocked one by a faint dotted underline", () => {
		const locked = ruleBody(css, ".semantropy-collision-word.is-locked");
		expect(locked).toMatch(/background-color:\s*color-mix\(in srgb, var\(--interactive-accent\) 24%, transparent\)/u);
		expect(locked).toMatch(/text-decoration:\s*underline solid/u);
		expect(locked).toMatch(/text-decoration-color:\s*var\(--interactive-accent\)/u);
		expect(locked).toMatch(/text-decoration-thickness:\s*2px/u);
		const plain = ruleBody(css, ".semantropy-collision-word");
		expect(plain).toMatch(/text-decoration:\s*underline dotted/u);
		expect(plain).toMatch(/text-decoration-thickness:\s*1px/u);
		// The focus mark is not a hover rule: a keyboard user gets it on every device.
		expect(ruleBody(css, ".semantropy-collision-word:focus-visible")).toMatch(/outline:\s*2px solid var\(--interactive-accent\)/u);
		expect(ruleBody(css, ".semantropy-collision-word.is-locked:focus-visible")).toMatch(/color-mix\(in srgb, var\(--interactive-accent\) 38%/u);
	});

	it("shows the pointer's mark only where the pointer can hover, and the focus mark everywhere", () => {
		const inside = [...css.matchAll(HOVER_BLOCK)].map((match) => match[0]).filter((block) => block.includes(".semantropy-collision-word"));
		expect(inside.length).toBe(2);
		const outside = css.replace(HOVER_BLOCK, "");
		expect(outside).not.toContain(".semantropy-collision-word:hover");
		expect(outside).not.toContain(".semantropy-collision-word.is-locked:hover");
		expect(inside.join("\n")).toContain(".semantropy-collision-word:hover { background-color: var(--background-modifier-hover); }");
		expect(inside.join("\n")).toMatch(/\.semantropy-collision-word\.is-locked:hover \{ background-color: color-mix\(in srgb, var\(--interactive-accent\) 38%, transparent\); \}/u);
		expect(outside).toContain(".semantropy-collision-word:focus-visible {");
	});
});
