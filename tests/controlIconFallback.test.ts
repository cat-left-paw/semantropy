// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";

/*
 * 0.1.0 (owner report): `pencil-sparkles` drew nothing in Obsidian, whose bundled icon set lacked it.
 * An id with a fallback is redrawn with the older glyph when `setIcon()` leaves the span empty.
 */
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return {
		...actual,
		setIcon: (parent: HTMLElement, iconId: string) => {
			// A host without this glyph leaves the element empty, as Obsidian does for an unknown id.
			if (iconId === "wand-sparkles") { parent.replaceChildren(); return; }
			actual.setIcon(parent, iconId);
		},
	};
});

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());

describe("0.1.0 control icon fallback", () => {
	it("draws the fallback glyph when the host has no icon for the id, and leaves other ids alone", async () => {
		const { iconLabel } = await import("../src/view/controlIcon");
		const recompose = document.createElement("button");
		iconLabel(recompose, "wand-sparkles", "Recompose");
		expect(recompose.querySelector(".semantropy-icon svg")?.getAttribute("class")).toBe("svg-icon lucide-sparkles");
		expect(recompose.querySelector(".semantropy-action-label")?.textContent).toBe("Recompose");
		const copy = document.createElement("button");
		iconLabel(copy, "copy", "Copy");
		expect(copy.querySelector(".semantropy-icon svg")?.getAttribute("class")).toBe("svg-icon lucide-copy");
	});
});
