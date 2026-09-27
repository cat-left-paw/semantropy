import type { TargetDom } from "./safeTargetDom";

/** Selection follows exact token/raw-coordinate bindings, never a text search. */
export function automaticSelection(before: readonly TargetDom[], after: readonly TargetDom[]) {
	const entries = (chunks: readonly TargetDom[]) => {
		let base = 0;
		return chunks.flatMap((chunk, index) => {
			const list = chunk.bindings.flatMap(binding => binding.logicalRange ? [{ binding,
				key: JSON.stringify([index, binding.presentation.tokenId ?? binding.presentation.rawRanges]),
				start: base + binding.logicalRange.start, end: base + binding.logicalRange.end }] : []);
			base += chunk.plan.logicalText.length; return list;
		});
	};
	const old = entries(before), next = entries(after), text = after.map(chunk => chunk.plan.logicalText).join("");
	const spans = (list: typeof old) => {
		const result = new Map<string, { start: number; end: number }>();
		for (const item of list) { const span = result.get(item.key); if (span) span.end = item.end; else result.set(item.key, { start: item.start, end: item.end }); }
		return result;
	};
	const oldSpans = spans(old), nextSpans = spans(next);
	const offset = (value: number, end: boolean) => {
		const item = old.find(item => end ? value > item.start && value <= item.end : value >= item.start && value < item.end);
		if (!item) return null;
		const a = oldSpans.get(item.key)!, b = nextSpans.get(item.key); if (!b) return null;
		return value === a.end ? b.end : b.start + Math.min(value - a.start, b.end - b.start);
	};
	const map = (start: number, end: number) => {
		const a = offset(start, false), b = offset(end, true);
		return a !== null && b !== null && b > a ? { start: a, end: b, text: text.slice(a, b) } : null;
	};
	const point = (value: number, end: boolean): [Text, number] | null => {
		const item = next.find(item => end ? value > item.start && value <= item.end : value >= item.start && value < item.end);
		return item ? [item.binding.node, (item.binding.nodeRange?.start ?? 0) + value - item.start] : null;
	};
	return { map, restore: (selection: Selection, range: { start: number; end: number }, backward: boolean) => {
		const mapped = map(range.start, range.end); if (!mapped) return;
		const start = point(mapped.start, false), end = point(mapped.end, true);
		if (start && end) { const [a, b] = backward ? [end, start] : [start, end]; selection.setBaseAndExtent(a[0], a[1], b[0], b[1]); }
	} };
}
