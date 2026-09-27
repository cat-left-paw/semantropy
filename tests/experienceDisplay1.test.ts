// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer, morphToken, suffix, peekMorph } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { projectMarkdownSource } from "../src/analysis/projectMarkdownSource";
import { buildTargetLineIndex, planTargetLineChunks, projectTargetLineChunk } from "../src/analysis/targetChunkIr";
import type { SemantropyView } from "../src/view/SemantropyView";
import type { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import type { DisplaySlot } from "../src/analysis/displaySlots";

/*
 * PRE-RELEASE-EXPERIENCE-DISPLAY1 focused regressions:
 *   UX-06 a closed leading frontmatter is not displayed in the Target body;
 *   UX-07 the Manual diagnostic does not flicker during a pointer drag;
 *   UX-03 one description per Toolbar control (no `title` beside `aria-label`);
 *   UX-08 the Dictionary availability row is not squeezed by the body's content height.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

const tokenizer = () => lexiconTokenizer([
	morphToken("暑い", "形容詞・アウオ段", "基本形", "形容詞"),
	morphToken("高い", "形容詞・アウオ段", "基本形", "形容詞"),
	morphToken("美しい", "形容詞・イ段", "基本形", "形容詞"),
	suffix("か", "助詞", "副助詞"), suffix("も", "助詞", "係助詞"), suffix("は", "助詞", "係助詞"),
	token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "鳥" }),
]);
const FRONTMATTER = "---\ntitle: 猫\ntags: [犬, 鳥]\n---\n";
const shell = (view: SemantropyView) => peekMorph(view).contentEl;
const body = (h: ReturnType<typeof manualMorphHarness>) => h.root();
const hiddenBlocks = (text: string, mode: "source" | "target-prototype" = "target-prototype") =>
	projectMarkdownSource(text, mode).presentation.blocks.filter(block => block.hidden).map(block => block.rawRange);

describe("UX-06 parser: only a closed leading frontmatter is marked hidden, and only for the Target", () => {
	it("marks exactly the parser's frontmatter range, including its closing newline", () => {
		const text = `${FRONTMATTER}\n猫は暑いか。\n`;
		expect(hiddenBlocks(text)).toEqual([{ start: 0, end: FRONTMATTER.length }]);
		// Source (Vocabulary) projection is untouched: same exclusions, no display field.
		expect(hiddenBlocks(text, "source")).toEqual([]);
		const source = projectMarkdownSource(text, "source"), target = projectMarkdownSource(text, "target-prototype");
		// Both modes still exclude and protect the same frontmatter range: hiding is display-only.
		const frontmatterExclusion = { range: { start: 0, end: FRONTMATTER.length }, reason: "protected" };
		expect(source.exclusions.find(e => e.range.start === 0)).toEqual(frontmatterExclusion);
		expect(target.exclusions.find(e => e.range.start === 0)).toEqual(frontmatterExclusion);
		expect(target.document.segments.some(segment => segment.kind === "protected")).toBe(true);
	});

	it("keeps BOM, CRLF, a `...` closer and trailing blanks inside the parser's own rule", () => {
		const bom = `\uFEFF${FRONTMATTER}猫。\n`;
		expect(hiddenBlocks(bom)).toEqual([{ start: 0, end: FRONTMATTER.length + 1 }]);
		const crlf = "---\r\ntitle: 猫\r\n---\r\n\r\n猫は暑いか。\r\n";
		expect(hiddenBlocks(crlf)).toEqual([{ start: 0, end: "---\r\ntitle: 猫\r\n---\r\n".length }]);
		const dots = "---   \ntitle: 猫\n...\n猫。\n";
		expect(hiddenBlocks(dots)).toEqual([{ start: 0, end: "---   \ntitle: 猫\n...\n".length }]);
		const eof = "---\ntitle: 猫\n---";
		expect(hiddenBlocks(eof)).toEqual([{ start: 0, end: eof.length }]);
	});

	it("never hides an unclosed opener, a later rule, a code fence or a frontmatter that does not start the note", () => {
		// Unclosed: the parser still protects to EOF; hiding that would hide the note.
		expect(hiddenBlocks("---\n猫は暑いか。\n犬も高い。\n")).toEqual([]);
		expect(hiddenBlocks("猫は暑いか。\n\n---\ntitle: 猫\n---\n")).toEqual([]);
		expect(hiddenBlocks("```\n---\ntitle: 猫\n---\n```\n")).toEqual([]);
		expect(hiddenBlocks("\n---\ntitle: 猫\n---\n猫。\n")).toEqual([]);
		expect(hiddenBlocks(" ---\ntitle: 猫\n---\n猫。\n")).toEqual([]);
	});
});

describe("UX-06 Chunk planning: hidden text is not displayed size and never forms an empty Chunk", () => {
	const body = "猫は暑いか。\n\n".repeat(60);

	it("counts Chunk size from the first displayed block", () => {
		const without = planTargetLineChunks(buildTargetLineIndex(body, 1), 120);
		const withFm = planTargetLineChunks(buildTargetLineIndex(FRONTMATTER + body, 1), 120);
		expect(withFm.map(c => c.rawRange.end - FRONTMATTER.length)).toEqual(without.map(c => c.rawRange.end));
		// Documents without frontmatter plan exactly as before (nothing hidden, nothing moved).
		expect(withFm.map(c => c.chunkId)).toEqual(without.map(c => c.chunkId));
	});

	it("gives the first Chunk displayed text even when the frontmatter is longer than a Chunk", () => {
		const long = `---\n${"tag: 猫\n".repeat(200)}---\n\n${body}`;
		const index = buildTargetLineIndex(long, 1);
		const chunks = planTargetLineChunks(index, 120);
		const hiddenEnd = index.blocks[0]!.rawRange.end;
		expect(index.blocks[0]!.hidden).toBe("frontmatter");
		expect(chunks[0]!.rawRange.start).toBe(0);
		expect(chunks[0]!.rawRange.end).toBeGreaterThan(hiddenEnd + 2);
		const first = projectTargetLineChunk(index, chunks[0]!);
		expect(first.blockFragments[0]).toMatchObject({ blockIndex: 0, hidden: "frontmatter" });
		expect(first.blockFragments.some(fragment => !fragment.hidden)).toBe(true);
		// Chunks still partition the raw text exactly.
		chunks.forEach((chunk, i) => expect(chunk.rawRange.start).toBe(i === 0 ? 0 : chunks[i - 1]!.rawRange.end));
		expect(chunks.at(-1)!.rawRange.end).toBe(long.length);
	});

	it("keeps a single unbroken line after frontmatter in the first Chunk", () => {
		const text = `${FRONTMATTER}${"猫は暑いか。".repeat(80)}`;
		const index = buildTargetLineIndex(text, 1);
		const chunks = planTargetLineChunks(index, 60);
		expect(chunks[0]!.rawRange.end).toBeGreaterThan(FRONTMATTER.length);
	});
});

describe("UX-06 View: the Target body omits the frontmatter and keeps everything else", () => {
	const text = `${FRONTMATTER}\n猫は暑いか。\n\n---\n\n\`\`\`\n---\n\`\`\`\n\n犬も高い。\n`;

	it("renders no frontmatter text, element or leading separator, and leaves the note alone", async () => {
		const h = manualMorphHarness(tokenizer());
		await h.open(text);
		const root = body(h);
		expect(root.textContent).not.toContain("title");
		expect(root.textContent).not.toContain("tags");
		const logical = h.controller().getLogicalText();
		expect(logical.startsWith("猫は暑いか。")).toBe(true);
		// A later thematic break and a fenced `---` stay visible.
		expect(logical).toContain("---");
		expect(root.querySelectorAll("pre").length).toBe(2);
		expect(h.state.text).toBe(text);
		expect(h.calls.collect).toEqual([]);
	});

	it("maps every displayed token to its exact raw offset in the unchanged note", async () => {
		const h = manualMorphHarness(tokenizer());
		await h.open(text);
		const slots = h.plan().slots;
		expect(slots.length).toBeGreaterThan(0);
		type Binding = { node: Text; presentation: { tokenId?: string; rawRanges: readonly { start: number; end: number }[] }; logicalRange: unknown; nodeRange?: { start: number; end: number } };
		const bindings = (Reflect.get(h.controller(), "bindings") as () => readonly Binding[]).call(h.controller());
		for (const binding of bindings) {
			for (const range of binding.presentation.rawRanges) {
				expect(range.start).toBeGreaterThanOrEqual(FRONTMATTER.length);
			}
			if (binding.presentation.tokenId && binding.logicalRange) {
				const joined = binding.presentation.rawRanges.map(r => text.slice(r.start, r.end)).join("");
				expect(joined).toBe(binding.node.data.slice(binding.nodeRange?.start ?? 0, binding.nodeRange?.end ?? binding.node.length));
			}
		}
		// Manual stays available on the first word after the frontmatter.
		const adjective = h.current("暑い");
		expect(adjective.manualEligible).toBe(true);
	});

	it("copies a whole-body selection without the frontmatter", async () => {
		const h = manualMorphHarness(tokenizer());
		await h.open(text);
		const range = document.createRange();
		range.selectNodeContents(body(h));
		const selection = document.getSelection()!;
		selection.removeAllRanges(); selection.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(h.calls.copy[0]).toBe(h.controller().getLogicalText());
		expect(h.calls.copy[0]).not.toContain("title");
	});

	it("still shows an unclosed opener as protected text", async () => {
		const h = manualMorphHarness(tokenizer());
		const unclosed = "---\n猫は暑いか。\n";
		await h.open(unclosed);
		expect(body(h).textContent).toContain("---");
		expect(body(h).textContent).toContain("猫は暑いか。");
	});

	it("marks the paragraph a Chunk boundary splits, not a position shifted by the hidden block", async () => {
		const h = manualMorphHarness(tokenizer(), 60);
		await h.open(`${FRONTMATTER}${"猫は暑いか。\n".repeat(40)}`);
		const blocks = Array.from(body(h).querySelectorAll(":scope > div > *"));
		expect(blocks.map(block => block.tagName)).toEqual(["P"]);
		expect(blocks[0]!.classList.contains("semantropy-continued-block")).toBe(true);
		expect(await h.view.loadNextSection()).toBe("applied");
		expect(h.controller().getLogicalText()).not.toContain("title");
	});

	it("keeps the next Chunk unloaded and joins it with one seam after Load next", async () => {
		const long = `${FRONTMATTER}\n${"猫は暑いか。\n\n".repeat(40)}`;
		const h = manualMorphHarness(tokenizer(), 60);
		await h.open(long);
		const controller: ChunkTargetBodyController = h.controller();
		const before = controller.getChunkStats();
		expect(before.chunks).toBe(1);
		expect(before.totalChunks).toBeGreaterThan(2);
		const firstText = controller.getLogicalText();
		expect(firstText.startsWith("猫は暑いか。")).toBe(true);
		expect(await h.view.loadNextSection()).toBe("applied");
		expect(controller.getChunkStats().chunks).toBe(2);
		const joined = controller.getLogicalText();
		expect(joined.startsWith(firstText)).toBe(true);
		expect(joined.slice(firstText.length).startsWith("\n\n猫")).toBe(true);
		expect(joined).not.toContain("title");
	});
});

describe("UX-07 the Manual diagnostic follows the selection without flickering", () => {
	type H = ReturnType<typeof manualMorphHarness>;
	const diagnostic = (h: H) => shell(h.view).querySelector<HTMLElement>(".semantropy-manual-diagnostic")!;
	const shown = (h: H) => diagnostic(h).hidden ? null : diagnostic(h).textContent;
	const pointer = (target: EventTarget, type: string, init: { button?: number; buttons?: number } = {}) =>
		target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: init.button ?? 0, buttons: init.buttons ?? 0 }));
	function slotRange(h: H, slot: DisplaySlot): Range {
		type Binding = { node: Text; presentation: { tokenId?: string }; logicalRange: unknown; nodeRange?: { start: number; end: number } };
		const own = (Reflect.get(h.controller(), "bindings") as () => readonly Binding[]).call(h.controller())
			.filter(b => b.logicalRange && b.presentation.tokenId === slot.tokenId);
		const range = document.createRange();
		range.setStart(own[0]!.node, own[0]!.nodeRange?.start ?? 0);
		range.setEnd(own.at(-1)!.node, own.at(-1)!.nodeRange?.end ?? own.at(-1)!.node.length);
		return range;
	}
	const select = (range: Range | null) => {
		const selection = document.getSelection()!;
		selection.removeAllRanges();
		if (range) selection.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
	};
	/** The selection a drag produces when the body moved under a still pointer. */
	const overshoot = (h: H, slot: DisplaySlot): Range => {
		const range = slotRange(h, slot);
		const text = range.endContainer as Text;
		if (range.endOffset < text.length) range.setEnd(text, range.endOffset + 1);
		else range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
		return range;
	};
	/** A caret inside this body: the reader's own deselect. */
	const deselect = (h: H) => {
		const caret = document.createRange();
		caret.setStart(body(h).firstChild!, 0);
		select(caret);
	};
	const ready = async () => {
		const h = manualMorphHarness(tokenizer());
		await h.open("猫は暑いか。犬も高い。鳥は美しい。\n");
		await h.apply(["鳥美しい。猫は高い。暑い。"]);
		return h;
	};

	it("holds the status line still for the whole drag and settles once on release", async () => {
		const h = await ready();
		const slot = h.current("美しい");
		const status = shell(h.view).querySelector(".semantropy-status")!;
		const writes: MutationRecord[] = [];
		const observer = new MutationObserver(records => writes.push(...records));
		observer.observe(status, { subtree: true, childList: true, characterData: true, attributes: true });
		pointer(body(h), "pointerdown", { buttons: 1 });
		for (let i = 0; i < 6; i += 1) {
			select(slotRange(h, slot));
			select(overshoot(h, slot));
		}
		select(slotRange(h, slot));
		await Promise.resolve();
		expect(writes.filter(r => diagnostic(h).contains(r.target))).toEqual([]);
		expect(shown(h)).toBeNull();
		pointer(document, "pointerup");
		expect(shown(h)).toMatch(/^Manual Shuffle/);
		// Copy / Collect still see the selection recorded during the drag.
		expect(await h.view.copySelectedFragment()).toBe("copied");
		expect(h.calls.copy.at(-1)).toBe("美しい");
		observer.disconnect();
	});

	it("updates at once for keyboard selection, a real deselect and another word", async () => {
		const h = await ready();
		select(slotRange(h, h.current("暑い")));
		const first = shown(h);
		expect(first).toMatch(/^Manual Shuffle/);
		select(slotRange(h, h.current("猫")));
		expect(shown(h)).not.toBeNull();
		deselect(h);
		expect(shown(h)).toBeNull();
	});

	it("releases the hold on a lost release, a cancelled pointer or window blur, and ignores non-primary buttons", async () => {
		const h = await ready();
		const slot = h.current("暑い");
		for (const release of [
			() => pointer(document, "pointermove", { buttons: 0 }),
			() => pointer(document, "pointercancel"),
			() => window.dispatchEvent(new Event("blur")),
		]) {
			deselect(h);
			expect(shown(h)).toBeNull();
			pointer(body(h), "pointerdown", { buttons: 1 });
			select(slotRange(h, slot));
			expect(shown(h)).toBeNull();
			release();
			expect(shown(h)).toMatch(/^Manual Shuffle/);
		}
		deselect(h);
		pointer(body(h), "pointerdown", { button: 2, buttons: 2 });
		select(slotRange(h, slot));
		expect(shown(h)).toMatch(/^Manual Shuffle/);
		// A move that still holds the button does not end the drag.
		deselect(h);
		pointer(body(h), "pointerdown", { buttons: 1 });
		pointer(document, "pointermove", { buttons: 1 });
		select(slotRange(h, slot));
		expect(shown(h)).toBeNull();
		pointer(document, "pointerup");
		expect(shown(h)).toMatch(/^Manual Shuffle/);
	});

	it("keeps the recorded pick when a Toolbar control takes focus after the drag", async () => {
		const h = await ready();
		pointer(body(h), "pointerdown", { buttons: 1 });
		select(slotRange(h, h.current("暑い")));
		pointer(document, "pointerup");
		const message = shown(h);
		const button = shell(h.view).querySelector<HTMLButtonElement>(".semantropy-copy")!;
		pointer(button, "pointerdown", { buttons: 1 });
		button.focus();
		const selection = document.getSelection()!;
		selection.collapse(button, 0);
		document.dispatchEvent(new Event("selectionchange"));
		pointer(document, "pointerup");
		expect(shown(h)).toBe(message);
	});

	it("never takes the reason from the view: the sentence is the slot's own diagnostic", async () => {
		const h = await ready();
		const slot = h.current("暑い");
		pointer(body(h), "pointerdown", { buttons: 1 });
		select(slotRange(h, slot));
		pointer(document, "pointerup");
		const live = h.plan().slots.find(s => s.tokenId === slot.tokenId)!;
		expect(live.manualDiagnostic.status).toBe("available");
		expect(shown(h)).toBe(`Manual Shuffle: ${live.manualDiagnostic.alternativeSurfaceCount} alternative${live.manualDiagnostic.alternativeSurfaceCount === 1 ? "" : "s"} in the active Vocabulary.`);
		expect(diagnostic(h).getAttribute("aria-live")).toBe("polite");
	});
});

describe("UX-03 one description per control", () => {
	it("gives no chrome element a native title beside Obsidian's aria-label tooltip", async () => {
		const h = manualMorphHarness(tokenizer());
		await h.open("猫は暑いか。\n");
		const content = shell(h.view);
		expect(content.querySelectorAll("[title]").length).toBe(0);
		const reshuffle = content.querySelector<HTMLButtonElement>(".semantropy-reshuffle")!;
		// EXPERIENCE-CONTROLS1: the name (and so the one tooltip) is short; the longer text is a description.
		expect(reshuffle.getAttribute("aria-label")).toBe("Reshuffle text");
		expect(reshuffle.textContent).toBe("Reshuffle text");
		const described = (el: Element) => content.ownerDocument.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent;
		expect(described(reshuffle)).toBe("Draw another variation of the loaded Target.");
		for (const control of Array.from(content.querySelectorAll<HTMLElement>(".semantropy-toolbar button, .semantropy-toolbar select, .semantropy-toolbar input"))) {
			const name = control.getAttribute("aria-label") ?? (control.tagName === "BUTTON" ? control.textContent : control.closest("label")?.textContent) ?? "";
			expect(name.trim()).not.toBe("");
		}
		const level = content.querySelector<HTMLSelectElement>(".semantropy-level-select")!;
		expect(level.getAttribute("aria-label")).toBe("Text semantropy level");
		expect(described(level)).toBe("How much of the loaded Target is replaced.");
		const hex = content.querySelector<HTMLInputElement>(".semantropy-color-input-bodyBackground")!;
		expect(hex.getAttribute("aria-label")).toContain("#RRGGBB");
	});
});

describe("UX-08 Dictionary availability stays readable and reachable", () => {
	const css = readFileSync("styles.css", "utf8");
	const rule = (selector: string) => {
		const match = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
		return match?.[1] ?? null;
	};

	it("never lets the body's content height squeeze the row, and keeps its summary line", () => {
		// Root cause: the body scroll box had a content-sized basis, and flex shrink is
		// weighted by basis, so the row was cut to a sliver by the same ratio.
		const scroll = rule(".semantropy-scroll");
		expect(scroll).toMatch(/flex:\s*1 1 0;/);
		// TOOLBAR1's contract stays: the body box may shrink to nothing, never grow to its content.
		expect(scroll).toMatch(/min-height:\s*0;/);
		const declarations = rule(".semantropy-dictionary-diagnostics");
		expect(declarations).not.toBeNull();
		expect(declarations).toMatch(/min-height:\s*1\.5em/);
		expect(declarations).toMatch(/max-height:\s*min\(35vh, 12em\)/);
		expect(declarations).toMatch(/overflow-y:\s*auto/);
	});

	it("keeps its summary and modifier control in the Tab order", async () => {
		const h = manualMorphHarness(tokenizer());
		await h.open("猫は暑いか。\n");
		const details = shell(h.view).querySelector<HTMLDetailsElement>(".semantropy-dictionary-diagnostics")!;
		expect(details.querySelector("summary")?.textContent).toBe("Dictionary availability");
		const select = details.querySelector("select")!;
		expect(select.closest("label")?.textContent).toContain("Hover modifier");
		expect(select.tabIndex).toBeGreaterThanOrEqual(0);
	});
});
