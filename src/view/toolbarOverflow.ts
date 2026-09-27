/**
 * PRE-RELEASE-EXPERIENCE-CONTROLS1: which Toolbar items leave the one-row
 * Toolbar for the More menu.
 *
 * Pure: widths in, item indices out, so the rule is testable without layout.
 * The row never wraps. When its visible items do not fit, the More button is
 * shown and items move out in `rank` order (highest first) until the row fits.
 * No item is pinned to the row: in a pane too narrow for anything else, the
 * row may hold the More button alone, which is still reachable. Hidden items
 * (width 0, `visible: false`) take no room and never move.
 */
export type ToolbarOverflowItem = { group: number; width: number; rank: number; visible: boolean };
export type ToolbarOverflowInput = {
	/** Inner width of the row. */
	available: number;
	/** Gap between groups (and before the More button). */
	groupGap: number;
	/** Gap between items inside one group. */
	itemGap: number;
	moreWidth: number;
	items: readonly ToolbarOverflowItem[];
	/**
	 * Per group (by index): `min`, the width its visible category label needs, and
	 * `extra`, its own padding and separator border. A group is at least as wide
	 * as its label.
	 */
	groups?: readonly { min: number; extra: number }[];
};

function rowWidth(input: ToolbarOverflowInput, inRow: readonly boolean[], more: boolean): number {
	const groups = new Map<number, { width: number; count: number }>();
	input.items.forEach((item, index) => {
		if (!item.visible || !inRow[index]) return;
		const group = groups.get(item.group) ?? { width: 0, count: 0 };
		group.width += item.width;
		group.count += 1;
		groups.set(item.group, group);
	});
	let width = 0;
	let parts = 0;
	for (const [index, group] of groups) {
		const box = input.groups?.[index];
		width += Math.max(group.width + input.itemGap * (group.count - 1), box?.min ?? 0) + (box?.extra ?? 0);
		parts += 1;
	}
	if (more) {
		width += input.moreWidth;
		parts += 1;
	}
	return width + input.groupGap * Math.max(0, parts - 1);
}

/** Returns the indices of the items that belong in the More menu (empty when everything fits). */
export function planToolbarOverflow(input: ToolbarOverflowInput): number[] {
	const inRow = input.items.map(() => true);
	// Half a pixel of slack absorbs sub-pixel rounding of measured widths.
	const fits = (more: boolean) => rowWidth(input, inRow, more) <= input.available + 0.5;
	if (fits(false)) return [];
	const order = input.items
		.map((item, index) => ({ item, index }))
		.filter(({ item }) => item.visible)
		.sort((a, b) => b.item.rank - a.item.rank || b.index - a.index);
	const moved: number[] = [];
	for (const { index } of order) {
		if (fits(true)) break;
		inRow[index] = false;
		moved.push(index);
	}
	return moved.sort((a, b) => a - b);
}
