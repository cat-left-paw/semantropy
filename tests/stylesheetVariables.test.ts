import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BODY_THEME_PALETTES } from "../src/settings/displaySettings";

/**
 * FAKE-DICT-RECOMPOSE1 (the highlight fix): the replacement marker and the Recompose branch point took their
 * background from `--text-highlight-bg`, written without a fallback. Obsidian 1.14.4 does not define that name any
 * more (its `--highlight-background` is where the theme-override door survives: `var(--text-highlight-bg,
 * var(--highlight-background-yellow))`), so under the default body theme the declaration was invalid and the
 * background transparent. Semantropy's own Light and Dark themes set the name inline (the palette), and the web page's
 * stylesheet defines it, so only the default theme showed the defect.
 */
const CSS = readFileSync("styles.css", "utf8");

/** The order the chain is written in, at every place that uses it: the old name (older Obsidian, a theme's override), the 1.14 name, a fixed colour. */
const CHAIN = "var(--text-highlight-bg, var(--highlight-background, rgba(255, 208, 0, 0.4)))";

describe("the highlight background (default body theme under Obsidian 1.14)", () => {
	it("is never written without a fallback", () => {
		expect(CSS).not.toMatch(/var\(\s*--text-highlight-bg\s*\)/);
	});

	it("is the same chain, in the same order, at all three places that use it", () => {
		const uses = [...CSS.matchAll(/var\(\s*--text-highlight-bg\b[^;{}]*/g)].map(match => match[0]);
		expect(uses).toHaveLength(3);
		const [replaced, mixed, branch] = uses;
		expect(replaced).toBe(CHAIN);
		expect(mixed!.startsWith(CHAIN)).toBe(true);
		expect(branch!.startsWith(CHAIN)).toBe(true);
	});

	it("keeps the replacement marker's two declarations: the plain colour, then the softened one, each with the chain", () => {
		const block = CSS.match(/\.semantropy-body \.semantropy-replaced \{([^}]*)\}/)?.[1] ?? "";
		expect(block).toContain(`background-color: ${CHAIN};`);
		expect(block).toContain(`background-color: color-mix(in srgb, ${CHAIN} 50%, transparent);`);
		// The plain colour comes first, so a browser without color-mix keeps it.
		expect(block.indexOf(`background-color: ${CHAIN};`)).toBeLessThan(block.indexOf("color-mix"));
	});

	it("keeps the Recompose branch point's background and outline", () => {
		expect(CSS).toContain(`.semantropy-recompose-unit.is-branch { background-color: ${CHAIN}; outline: 1px solid var(--interactive-accent); }`);
	});

	it("is not gathered into one variable on an outer element, which the palette (set on the scrolling box) could not reach", () => {
		// A value resolved on `.semantropy-root` would be inherited with the default theme's colour; the palette sets
		// `--text-highlight-bg` on `.semantropy-scroll`, below it.
		expect(CSS).not.toMatch(/--semantropy-highlight[\w-]*\s*:/);
		expect(CSS).not.toMatch(/(^|[;{\s])--text-highlight-bg\s*:/);
	});

	it("leaves the Light and Dark palettes' own colour in front of the chain", () => {
		expect(BODY_THEME_PALETTES.light["--text-highlight-bg"]).toBe("rgba(255, 196, 0, 0.42)");
		expect(BODY_THEME_PALETTES.dark["--text-highlight-bg"]).toBe("rgba(255, 208, 0, 0.3)");
	});
});

/**
 * Variables `styles.css` uses with no fallback, which Obsidian defines itself. Checked against Obsidian 1.14.4's
 * `app.css` on 2026-10-08 (each name is declared there as `--name:`). A name a new rule adds is not in the list until
 * someone has looked it up in a current Obsidian's CSS and either given the rule a fallback or added the name here.
 */
const VERIFIED_IN_OBSIDIAN_1_14_4 = [
	"--background-modifier-border",
	"--background-modifier-hover",
	"--background-primary",
	"--background-secondary",
	"--font-bold",
	"--font-interface",
	"--font-monospace",
	"--font-text",
	"--font-text-size",
	"--font-ui-small",
	"--font-ui-smaller",
	"--interactive-accent",
	"--interactive-normal",
	"--layer-popover",
	"--radius-m",
	"--radius-s",
	"--shadow-s",
	"--size-4-2",
	"--size-4-3",
	"--text-accent",
	"--text-faint",
	"--text-muted",
	"--text-normal",
	"--text-on-accent",
] as const;

function withoutFallback(css: string): Set<string> {
	return new Set([...css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)].map(match => match[1]!));
}

function declared(css: string): Set<string> {
	return new Set([...css.matchAll(/(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g)].map(match => match[1]!));
}

describe("the variables styles.css uses without a fallback", () => {
	it("are each declared by styles.css or listed as verified in Obsidian 1.14.4", () => {
		const own = declared(CSS), verified = new Set<string>(VERIFIED_IN_OBSIDIAN_1_14_4);
		const unknown = [...withoutFallback(CSS)].filter(name => !own.has(name) && !verified.has(name)).sort();
		expect(unknown).toEqual([]);
	});

	it("finds the defect it exists for: the name Obsidian 1.14.4 dropped, written bare", () => {
		const own = declared(CSS), verified = new Set<string>(VERIFIED_IN_OBSIDIAN_1_14_4);
		const broken = `${CSS}\n.x { background-color: var(--text-highlight-bg); }\n`;
		const unknown = [...withoutFallback(broken)].filter(name => !own.has(name) && !verified.has(name));
		expect(unknown).toEqual(["--text-highlight-bg"]);
	});

	it("do not include the name the palette sets inline, which the default theme does not have", () => {
		expect(VERIFIED_IN_OBSIDIAN_1_14_4).not.toContain("--text-highlight-bg");
	});
});
