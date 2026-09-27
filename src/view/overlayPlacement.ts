/**
 * Where a View-owned overlay (the Fake Dictionary Popover, the Manual menu)
 * goes next to the word it belongs to. Pure: it reads rectangles and returns
 * coordinates, so the rule is the same for both overlays and can be tested
 * without layout.
 *
 * The overlay goes below the word when it fits there, otherwise above it when
 * it fits there. When it fits on neither side it takes the side with more room
 * and its height is capped to that room (the caller scrolls inside it), so it
 * still never covers the word; clamping position alone would slide it back over
 * the word. Horizontally it starts at the word's left edge and is pulled back
 * so its right edge stays inside. A word that wraps over two lines gives its
 * last line for "below" and its first line for "above".
 */
export type PlacementRect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** The gap between the word and the overlay. */
export const OVERLAY_GAP = 4;

export function placeOverlay(input: {
	/** The line the overlay sits under (a wrapped word's last line). */
	below: PlacementRect;
	/** The line the overlay sits over when flipped (a wrapped word's first line). */
	above: PlacementRect;
	width: number;
	height: number;
	bounds: PlacementRect;
}): { left: number; top: number; flipped: boolean; maxHeight: number } {
	const { below, above, width, height, bounds } = input;
	const under = below.bottom + OVERLAY_GAP;
	const roomBelow = Math.max(0, bounds.bottom - under);
	const roomAbove = Math.max(0, above.top - OVERLAY_GAP - bounds.top);
	const flipped = height > roomBelow && (height <= roomAbove || roomAbove > roomBelow);
	const maxHeight = Math.min(height, flipped ? roomAbove : roomBelow);
	const anchor = flipped ? above : below;
	const left = Math.max(bounds.left, Math.min(anchor.left, bounds.right - width));
	const top = flipped ? above.top - OVERLAY_GAP - maxHeight : under;
	return { left, top, flipped, maxHeight };
}

/** The visible part of the window, less a margin, intersected with the pane when one is given. */
export function overlayBounds(win: Window, pane: PlacementRect | null, margin = 8): PlacementRect {
	const viewport = win.visualViewport;
	const width = viewport?.width ?? win.innerWidth, height = viewport?.height ?? win.innerHeight;
	const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
	return {
		left: Math.max(left + margin, pane?.left ?? -Infinity),
		right: Math.min(left + width - margin, pane?.right || left + width - margin),
		top: Math.max(top + margin, pane?.top ?? -Infinity),
		bottom: Math.min(top + height - margin, pane?.bottom || top + height - margin),
	};
}
