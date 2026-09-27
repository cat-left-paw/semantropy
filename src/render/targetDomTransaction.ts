/** Exact endpoints (including backward selection), not live Range clones that move on removal. */
export function captureTargetInteraction(root: HTMLElement) {
 const selection = root.ownerDocument.getSelection();
 const direction = selection?.anchorNode && selection.focusNode ? { anchor: selection.anchorNode, anchorOffset: selection.anchorOffset, focus: selection.focusNode, focusOffset: selection.focusOffset } : null;
 const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => {
  const range = selection.getRangeAt(i);
  return { start: range.startContainer, startOffset: range.startOffset, end: range.endContainer, endOffset: range.endOffset };
 }) : [];
 const scroll: { node: HTMLElement; top: number; left: number }[] = [];
 for (let node: HTMLElement | null = root; node; node = node.parentElement) scroll.push({ node, top: node.scrollTop, left: node.scrollLeft });
 const restoreScroll = () => { for (const saved of scroll) { saved.node.scrollTop = saved.top; saved.node.scrollLeft = saved.left; } };
 return { restoreScroll, rollback: () => {
  if (selection) {
   selection.removeAllRanges();
   for (const saved of ranges) { const range = root.ownerDocument.createRange(); range.setStart(saved.start, saved.startOffset); range.setEnd(saved.end, saved.endOffset); selection.addRange(range); }
   if (ranges.length === 1 && direction) selection.setBaseAndExtent(direction.anchor, direction.anchorOffset, direction.focus, direction.focusOffset);
  }
  restoreScroll();
 } };
}

/** Synchronous replacement with exact-node rollback; selection/scroll snapshots live only for this commit. */
export function targetDomTransaction(root: HTMLElement, next: readonly Node[]) {
 const parent = root.parentNode, previous = Array.from(root.childNodes);
 const selection = root.ownerDocument.getSelection();
 const direction = selection?.anchorNode && selection.focusNode ? { anchor: selection.anchorNode, anchorOffset: selection.anchorOffset, focus: selection.focusNode, focusOffset: selection.focusOffset } : null;
 const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => {
  const r = selection.getRangeAt(i);
  return { range: r, start: r.startContainer, startOffset: r.startOffset, end: r.endContainer, endOffset: r.endOffset };
 }) : [];
 const logicalNodes = (): Text[] => {
  const nodes: Text[] = [], walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement?.closest("rt, rp")) nodes.push(node as Text);
  return nodes;
 };
 const previousText = direction && root.contains(direction.anchor) && root.contains(direction.focus) ? logicalNodes() : [];
 const textBefore = previousText.map(n => n.data).join("");
 const offsetOf = (node: Node, offset: number): number | null => {
  let total = 0;
  for (const text of previousText) { if (text === node) return total + offset; total += text.length; }
  return null;
 };
 const anchor = direction ? offsetOf(direction.anchor, direction.anchorOffset) : null;
 const focus = direction ? offsetOf(direction.focus, direction.focusOffset) : null;
 const scroll: { node: HTMLElement; top: number; left: number }[] = [];
 for (let node: HTMLElement | null = root; node; node = node.parentElement) scroll.push({ node, top: node.scrollTop, left: node.scrollLeft });
 const rollback = () => {
  if (root.parentNode !== parent) return;
  if (root.childNodes.length !== previous.length || previous.some((node, i) => root.childNodes[i] !== node)) {
   for (const node of Array.from(root.childNodes)) if (!previous.includes(node)) root.removeChild(node);
   for (let i = 0; i < previous.length; i++) if (root.childNodes[i] !== previous[i]) root.insertBefore(previous[i]!, root.childNodes[i] ?? null);
   if (selection) {
    selection.removeAllRanges();
    for (const saved of ranges) {
     const range = saved.range;
     range.setStart(saved.start, saved.startOffset); range.setEnd(saved.end, saved.endOffset); selection.addRange(range);
    }
    if (ranges.length === 1 && direction) selection.setBaseAndExtent(direction.anchor, direction.anchorOffset, direction.focus, direction.focusOffset);
   }
  }
  for (const saved of scroll) { saved.node.scrollTop = saved.top; saved.node.scrollLeft = saved.left; }
 };
 return { publish: () => {
  root.replaceChildren(...next);
  if (selection && anchor !== null && focus !== null) {
   const nodes = logicalNodes();
   if (nodes.map(n => n.data).join("") === textBefore) {
    const point = (offset: number): [Text, number] => {
     for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
     return [nodes.at(-1)!, nodes.at(-1)!.length];
    };
    const a = point(anchor), f = point(focus); selection.setBaseAndExtent(a[0], a[1], f[0], f[1]);
   }
  }
  for (const saved of scroll) { saved.node.scrollTop = saved.top; saved.node.scrollLeft = saved.left; }
 }, rollback };
}
