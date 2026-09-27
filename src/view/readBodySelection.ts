/**
 * A Range-shaped object. The real DOM Range matches this; tests can supply a
 * fake without constructing a live Selection.
 */
export type BodySelectionRange = {
	collapsed: boolean;
	toString(): string;
	commonAncestorContainer: Node;
	startContainer?: Node;
	endContainer?: Node;
	startOffset?: number;
	endOffset?: number;
	intersectsNode?(node: Node): boolean;
};

/**
 * A Selection-shaped object. The application never reads `window.getSelection()`
 * itself: the view injects one of these, so the containment rules can be
 * tested without a global DOM.
 */
export type BodySelectionSource = {
	rangeCount: number;
	getRangeAt(index: number): BodySelectionRange;
};

export type BodySelection =
	| { status: "empty" }
	| { status: "selected"; text: string };

/**
 * Reads the user's explicit selection out of the currently committed body.
 *
 * The only accepted selection is a single, non-collapsed range whose common
 * ancestor lives inside `root`. Collapsed carets, extra ranges, chrome, other
 * views, a detached previous body, and whitespace-only picks are all the
 * same refusal: there is nothing to copy or collect.
 *
 * The text is the selected DOM Text intervals, excluding rt/rp. `innerHTML`
 * is never consulted, so markup cannot leak into the saved string. Outer spaces
 * and newlines are kept: a non-empty pick is never trimmed, split or
 * summarized.
 *
 * The return value is only a status and a string. The Range, the Selection and
 * every DOM node stay behind this function; nothing here is fit to store on a
 * session or in `data.json`.
 */
export function readBodySelection(input: {
	root: HTMLElement | null;
	selection: BodySelectionSource | null;
}): BodySelection {
	const { root, selection } = input;
	if (root === null || !root.isConnected) {
		return { status: "empty" };
	}
	if (selection === null || selection.rangeCount !== 1) {
		return { status: "empty" };
	}

	let range: BodySelectionRange;
	try {
		range = selection.getRangeAt(0);
	} catch {
		return { status: "empty" };
	}
	if (range.collapsed) {
		return { status: "empty" };
	}
	if (!isNodeInside(root, range.commonAncestorContainer)) {
		return { status: "empty" };
	}

	let text: string;
	try { text = logicalRangeText(root, range); } catch { return { status: "empty" }; }
	if (text.trim().length === 0) {
		return { status: "empty" };
	}
	return { status: "selected", text };
}

/** Read only selected DOM Text intervals, excluding ruby annotations even when
 * the selection starts or ends inside rt/rp. Escapes are ordinary Text in the
 * committed renderer and are deliberately not filtered by their characters. */
function logicalRangeText(root: HTMLElement, range: BodySelectionRange): string {
	if (!range.intersectsNode || !range.startContainer || !range.endContainer) {
		return root.querySelector("rt, rp") ? "" : range.toString();
	}
	const walker = root.ownerDocument.createTreeWalker(root, 4);
	let node = walker.nextNode();
	let text = "";
	while (node) {
		if (!node.parentElement?.closest("rt, rp") && range.intersectsNode(node)) {
			const value = node.nodeValue ?? "";
			const start = node === range.startContainer ? range.startOffset ?? 0 : 0;
			const end = node === range.endContainer ? range.endOffset ?? value.length : value.length;
			text += value.slice(start, end);
		}
		node = walker.nextNode();
	}
	return text;
}

function isNodeInside(root: Node, node: Node): boolean {
	return node === root || root.contains(node);
}
