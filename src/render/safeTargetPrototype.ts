import type { Utf16Range } from "../analysis/rubyAnalysis";
import type { TargetDisplayPlan } from "../analysis/targetPresentation";
import type { BodySemantropy } from "../settings/bodySemantropy";
import { buildSafeTargetDom, planSafeTarget, type SafeTargetModel, type TargetDom } from "./safeTargetDom";

export {
	SAFE_TARGET_ERROR, analyzeSafeTarget, buildSafeTargetDom, buildSafeTargetDomIncremental, planSafeTarget,
	type SafeTargetModel, type TargetDom, type TargetDomBinding,
} from "./safeTargetDom";

/** Prototype-only owner. One root swap; no partial host patching or DOM reparse. */
export class SafeTargetPrototype {
	private root: HTMLElement | null;
	private displayed: TargetDom | null = null;
	private model: SafeTargetModel | null;
	private revision = 0;
	private nextId = 0;
	private readonly pending = new Map<number, { next: TargetDom; revision: number; signatures: string[]; nodes: Node[]; connected: boolean; parent: Node | null; current: () => boolean }>();
	constructor(ownerDocument: Document, model: SafeTargetModel) {
		this.root = ownerDocument.createElement("div"); this.model = model;
	}
	getRoot(): HTMLElement | null { return this.root; }
	getDisplay(): TargetDom | null { return this.displayed; }
	getRevision(): number { return this.revision; }
	getPendingCount(): number { return this.pending.size; }
	prepare(seed: number, level: BodySemantropy, current: () => boolean = () => true): { commit: () => "applied" | "stale" } | null {
		try {
			if (!this.model || !current()) return null;
			return this.preparePlan(planSafeTarget(this.model, seed, level), current);
		} catch { return null; }
	}
	preparePlan(plan: TargetDisplayPlan, current: () => boolean = () => true): { commit: () => "applied" | "stale" } | null {
		const root = this.root;
		try {
			if (!root || !current() || root !== this.root) return null;
			const next = buildSafeTargetDom(plan, root.ownerDocument);
			this.pending.clear(); // Only the latest preparation can own a commit.
			const id = ++this.nextId;
			const nodes = descendants(root);
			this.pending.set(id, { next, revision: this.revision, signatures: nodes.map(signature), nodes, connected: root.isConnected, parent: root.parentNode, current });
			return { commit: () => this.commit(id) }; // No DOM/model captured by caller-held ticket.
		} catch { return null; }
	}
	private commit(id: number): "applied" | "stale" {
		const staged = this.pending.get(id), root = this.root;
		this.pending.delete(id);
		if (!staged || !root) return "stale";
		try { if (!staged.current()) return "stale"; } catch { return "stale"; }
		// A guard may release/reenter this owner. Recheck after it returns.
		if (id !== this.nextId || root !== this.root || staged.revision !== this.revision || staged.connected !== root.isConnected || staged.parent !== root.parentNode) return "stale";
		const nodes = descendants(root);
		if (nodes.length !== staged.nodes.length || nodes.some((n, i) => n !== staged.nodes[i] || signature(n) !== staged.signatures[i])) return "stale";
		root.replaceChildren(staged.next.root);
		this.displayed = staged.next; this.revision += 1;
		return "applied";
	}
	/** Copy-equivalent pure selection; no Clipboard/Vault capability. */
	readLogicalRange(range: Utf16Range, revision: number): string | null {
		const text = this.displayed?.plan.logicalText;
		if (text === undefined || revision !== this.revision || !this.root?.contains(this.displayed!.root) ||
			this.displayed!.bindings.some(b => !this.displayed!.root.contains(b.node) || b.node.data !== b.presentation.text) ||
			!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.start >= range.end || range.end > text.length) return null;
		return text.slice(range.start, range.end);
	}
	/** Text endpoints only for this prototype; ambiguous element/UI endpoints fail closed. */
	readDomRange(range: Range, revision: number): string | null {
		const start = this.displayed?.bindings.find(b => b.node === range.startContainer);
		const end = this.displayed?.bindings.find(b => b.node === range.endContainer);
		if (!start?.logicalRange || !end?.logicalRange || range.startOffset > start.node.length || range.endOffset > end.node.length) return null;
		return this.readLogicalRange({ start: start.logicalRange.start + range.startOffset, end: end.logicalRange.start + range.endOffset }, revision);
	}
	release(): void {
		this.revision += 1; this.pending.clear(); this.model = null; this.displayed = null;
		this.root?.replaceChildren(); this.root?.remove(); this.root = null;
	}
}

function descendants(root: Node): Node[] {
	const result: Node[] = [];
	const visit = (node: Node): void => { result.push(node); node.childNodes.forEach(visit); };
	visit(root); return result;
}

function signature(node: Node): string {
	return JSON.stringify([node.nodeValue, node.childNodes.length, node.nodeType === 1 ? Array.from((node as Element).attributes, a => [a.name, a.value]) : []]);
}
