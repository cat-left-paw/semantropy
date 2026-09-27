// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readBodySelection } from "../src/view/readBodySelection";

function selectionOf(
	ranges: Array<{
		collapsed?: boolean;
		text?: string;
		commonAncestorContainer: Node;
		toString?: () => string;
	}>,
) {
	return {
		rangeCount: ranges.length,
		getRangeAt(index: number) {
			const range = ranges[index];
			if (!range) {
				throw new Error("No range at that index.");
			}
			return {
				collapsed: range.collapsed === true,
				commonAncestorContainer: range.commonAncestorContainer,
				toString: range.toString ?? (() => range.text ?? ""),
			};
		},
	};
}

function liveSelection(): {
	rangeCount: number;
	getRangeAt(index: number): Range;
} | null {
	return window.getSelection();
}

function selectContents(node: Node): Range {
	const range = document.createRange();
	range.selectNodeContents(node);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	return range;
}

describe("readBodySelection", () => {
	afterEach(() => {
		window.getSelection()?.removeAllRanges();
		document.body.replaceChildren();
	});

	it("reads a single range inside the committed body", () => {
		const root = document.createElement("div");
		root.textContent = "おかき的な自殺";
		document.body.appendChild(root);
		selectContents(root);

		expect(readBodySelection({ root, selection: liveSelection() })).toEqual({
			status: "selected",
			text: "おかき的な自殺",
		});
	});

	it("keeps outer whitespace and newlines", () => {
		const root = document.createElement("div");
		root.textContent = "  前\n後  ";
		document.body.appendChild(root);
		selectContents(root);

		expect(readBodySelection({ root, selection: liveSelection() })).toEqual({
			status: "selected",
			text: "  前\n後  ",
		});
	});

	it("refuses a collapsed selection, a missing range and whitespace-only text", () => {
		const root = document.createElement("div");
		root.textContent = "本文";
		document.body.appendChild(root);
		const text = root.firstChild as Text;

		const collapsed = document.createRange();
		collapsed.setStart(text, 1);
		collapsed.collapse(true);
		expect(
			readBodySelection({
				root,
				selection: selectionOf([
					{ collapsed: true, commonAncestorContainer: text, text: "" },
				]),
			}),
		).toEqual({ status: "empty" });

		expect(readBodySelection({ root, selection: selectionOf([]) })).toEqual({
			status: "empty",
		});
		expect(readBodySelection({ root, selection: null })).toEqual({
			status: "empty",
		});

		root.textContent = "  \n\t  ";
		selectContents(root);
		expect(readBodySelection({ root, selection: liveSelection() })).toEqual({
			status: "empty",
		});
	});

	it("refuses a selection that lives outside the body", () => {
		const root = document.createElement("div");
		root.textContent = "本文";
		const outside = document.createElement("div");
		outside.textContent = "外側";
		document.body.append(root, outside);
		selectContents(outside);

		expect(readBodySelection({ root, selection: liveSelection() })).toEqual({
			status: "empty",
		});
	});

	it("refuses a selection that spans the body and chrome", () => {
		const view = document.createElement("div");
		const chrome = document.createElement("button");
		chrome.textContent = "Copy";
		const root = document.createElement("div");
		root.textContent = "本文です";
		view.append(chrome, root);
		document.body.appendChild(view);

		const range = document.createRange();
		range.setStart(root.firstChild as Text, 0);
		range.setEnd(chrome.firstChild as Text, 4);
		expect(
			readBodySelection({
				root,
				selection: selectionOf([
					{
						commonAncestorContainer: range.commonAncestorContainer,
						text: range.toString(),
					},
				]),
			}),
		).toEqual({ status: "empty" });
	});

	it("refuses multiple ranges as ambiguous", () => {
		const root = document.createElement("div");
		root.textContent = "本文";
		document.body.appendChild(root);
		const text = root.firstChild as Text;

		expect(
			readBodySelection({
				root,
				selection: selectionOf([
					{ commonAncestorContainer: text, text: "本" },
					{ commonAncestorContainer: text, text: "文" },
				]),
			}),
		).toEqual({ status: "empty" });
	});

	it("reads an explicit selection inside a protected element", () => {
		const root = document.createElement("div");
		const link = document.createElement("a");
		link.className = "internal-link";
		link.textContent = "保護された語";
		root.appendChild(link);
		document.body.appendChild(root);
		selectContents(link);

		expect(readBodySelection({ root, selection: liveSelection() })).toEqual({
			status: "selected",
			text: "保護された語",
		});
	});

	it("refuses a selection that still sits in a detached previous body", () => {
		const oldBody = document.createElement("div");
		oldBody.textContent = "古い本文";
		const current = document.createElement("div");
		current.textContent = "新しい本文";
		document.body.append(oldBody, current);
		selectContents(oldBody);
		oldBody.remove();

		expect(
			readBodySelection({ root: oldBody, selection: liveSelection() }),
		).toEqual({ status: "empty" });
		expect(
			readBodySelection({ root: current, selection: liveSelection() }),
		).toEqual({ status: "empty" });
	});

	it("returns display text, not innerHTML", () => {
		const root = document.createElement("div");
		const paragraph = document.createElement("p");
		paragraph.append("前");
		const em = document.createElement("em");
		em.textContent = "強調";
		paragraph.append(em);
		root.appendChild(paragraph);
		document.body.appendChild(root);
		selectContents(root);

		const selected = readBodySelection({ root, selection: liveSelection() });
		expect(selected).toEqual({ status: "selected", text: "前強調" });
		if (selected.status === "selected") {
			expect(selected.text).not.toContain("<");
			expect(selected.text).not.toContain("em");
		}
	});
});
