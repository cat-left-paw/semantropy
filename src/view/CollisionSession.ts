import { createCollisionBatchController, collisionFragmentFromBatch, collisionBatchRecipeOptions,
	type CollisionBatchController, type CollisionBatchReason, type CollisionOperationTicket,
	type CollisionRowSelector } from "../collision/collisionBatch";
import { compileCollisionPatternSet, type CompiledCollisionPatternSet } from "../collision/compilePatternSet";
import { STANDARD_COLLISION_PATTERN_SCHEMA_VERSION, STANDARD_COLLISION_PATTERN_DATA_VERSION,
	STANDARD_COLLISION_RECIPES, STANDARD_COLLISION_LITERALS, STANDARD_COLLISION_CONNECTORS,
	STANDARD_COLLISION_MODIFIER_FORMS, STANDARD_COLLISION_NOUN_SUFFIXES } from "../collision/generated/standardCollisionPatternEntries";
import type { ManualMorphVocabulary } from "../transform/manualMorphology";
import type { CooperativeScheduler } from "../render/cooperativeScheduler";
import type { CollisionFragmentInput } from "../collect/CollectedFragment";
import type { CollectFragmentResultV4 as CollectFragmentResult } from "../collect/v4/CollectFragmentUseCaseV4";
import { collectFragmentMessage } from "../collect/collectMessages";

export type CollisionSessionHost = {
	active(): ManualMorphVocabulary | null;
	material(): string;
	scheduler: CooperativeScheduler;
	copy(text: string): Promise<void>;
	collect(input: CollisionFragmentInput): Promise<CollectFragmentResult>;
};

/** Presentation only: unknown failures never disclose their payload. */
export function collisionMessage(reason: CollisionBatchReason | null): string {
	switch (reason) {
		case null: return "";
		case "no-noun": return "Insufficient vocabulary: no usable nouns.";
		case "no-viable-recipe": return "Insufficient vocabulary: no available pattern.";
		case "recipe-not-viable": return "Insufficient vocabulary for this pattern. Required modifiers or predicates may be unavailable.";
		case "duplicate-exhausted": return "Not enough distinct results.";
		case "cancelled": return "Cancelled. The previous results are retained.";
		default: return "Could not generate Collision. The previous results are retained.";
	}
}

/** One View-owned Modal lifecycle. No Source reads, tokenizer or alternate generator. */
export class CollisionSession {
	private controller: CollisionBatchController | null = null;
	private patterns: CompiledCollisionPatternSet | null = null;
	private host: CollisionSessionHost | null;
	private tickets = new Map<string, CollisionOperationTicket>();
	private writes = new Map<string, object>();
	private feedback = new Map<string, { rowId: string; message: string }>();
	private stale = false;
	private optionsBatch: string | null = null;
	private options: readonly { readonly id: string; readonly label: string }[] = [];
	changed: (() => void) | null = null;
	error = "";
	constructor(host: CollisionSessionHost) {
		this.host = host;
		try {
			const compiled = compileCollisionPatternSet({ schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
				dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION, recipes: STANDARD_COLLISION_RECIPES,
				literals: STANDARD_COLLISION_LITERALS, connectors: STANDARD_COLLISION_CONNECTORS,
				modifierForms: STANDARD_COLLISION_MODIFIER_FORMS, nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES });
			const owner = createCollisionBatchController({ identityMaterial: host.material() });
			if (!compiled.ok || !owner.ok) throw Error();
			this.patterns = compiled.set; this.controller = owner.value;
		} catch { this.error = "Collision is unavailable."; }
	}
	read() { return this.controller?.read() ?? null; }
	defaultOptions() { return this.patterns?.recipes.filter(recipe => recipe.enabled && recipe.selectable) ?? []; }
	rowOptions() {
		const batch = this.read()?.batch;
		if (batch && this.optionsBatch !== batch.batchId) {
			const result = collisionBatchRecipeOptions(batch);
			this.options = result.ok ? result.value : []; this.optionsBatch = batch.batchId;
		}
		return this.options;
	}
	canGenerate() { return !!this.controller && !!this.host?.active(); }
	isStale() {
		const batch = this.read()?.batch;
		return !!batch && (this.stale || batch.vocabularyOwner !== this.host?.active());
	}
	sourceChanged(path: string) {
		if (this.read()?.batch?.vocabulary.sources.some(source => source.path === path)) this.stale = true;
		this.changed?.();
	}
	select(slot: string, selector: CollisionRowSelector) {
		const result = this.controller?.select({ rowSlotId: slot, selector });
		if (result?.ok) this.tickets.delete(slot);
		else this.error = collisionMessage(result?.reason ?? "invalid-state");
		this.changed?.();
	}
	async generate(count: 10 | 20 | 50, recipe: string): Promise<void> {
		const host = this.host, owner = this.controller, patternSet = this.patterns;
		const vocabulary = host?.active();
		if (!host || !owner || !patternSet || !vocabulary) {
			this.error = "Apply a fresh Vocabulary before Generate."; this.changed?.(); return;
		}
		try {
			const begun = owner.beginGenerate({ vocabulary, patternSet, count,
				defaultPattern: recipe === "" ? { kind: "random" } : { kind: "fixed", recipeId: recipe }, operationMaterial: host.material() });
			if (!begun.ok) { this.error = collisionMessage(begun.reason); this.changed?.(); return; }
			this.tickets.clear(); this.tickets.set("generate", begun.value);
			await this.run("generate", begun.value, vocabulary);
		} catch { this.error = collisionMessage("invalid-request"); this.changed?.(); }
	}
	async regenerate(slot: string): Promise<void> {
		if (!this.host || !this.controller) return;
		try {
			const begun = this.controller.beginRegenerate({ rowSlotId: slot, operationMaterial: this.host.material() });
			if (!begun.ok) { this.error = collisionMessage(begun.reason); this.changed?.(); return; }
			this.tickets.set(slot, begun.value); await this.run(slot, begun.value);
		} catch { this.error = collisionMessage("invalid-request"); this.changed?.(); }
	}
	private async run(key: string, ticket: CollisionOperationTicket, vocabulary?: ManualMorphVocabulary) {
		const host = this.host!, owner = this.controller!;
		const current = () => this.controller === owner && this.tickets.get(key) === ticket;
		this.error = ""; this.changed?.(); // Busy DOM precedes the paint opportunity.
		try {
			await host.scheduler.paint(); await host.scheduler.yieldTask();
			if (!current()) return;
			if (vocabulary && host.active() !== vocabulary) { this.cancel(key); return; }
			const prepared = owner.prepare(ticket); // Synchronous; cannot process events inside this call.
			await host.scheduler.yieldTask();
			if (!current()) return;
			if (vocabulary && host.active() !== vocabulary) { this.cancel(key); return; }
			if (prepared.ok) {
				const completed = owner.complete(ticket, prepared.value);
				if (completed.ok && vocabulary) { this.stale = false; this.feedback.clear(); }
			} else owner.cancel(ticket);
		} catch { if (current()) { owner.cancel(ticket); this.error = collisionMessage("invalid-request"); } }
		finally { if (current()) { this.tickets.delete(key); this.changed?.(); } }
	}
	cancel(key: string) {
		const ticket = this.tickets.get(key);
		if (ticket) this.controller?.cancel(ticket);
		this.tickets.delete(key); this.changed?.();
	}
	canWrite(slot: string) {
		const state = this.read();
		return !!state?.batch?.rows.some(row => row.rowSlotId === slot) &&
			!state.rowDrafts.find(row => row.rowSlotId === slot)?.pending && !this.writes.has(slot);
	}
	rowFeedback(slot: string, rowId: string) {
		const value = this.feedback.get(slot); return value?.rowId === rowId ? value.message : "";
	}
	async write(slot: string, kind: "copy" | "collect"): Promise<void> {
		const host = this.host, batch = this.read()?.batch;
		if (!host || !batch || !this.canWrite(slot)) return;
		const row = batch.rows.find(row => row.rowSlotId === slot)!;
		const operation = {}; this.writes.set(slot, operation); this.changed?.();
		let message: string;
		try {
			if (kind === "copy") { await host.copy(row.committed.text); message = "Copied."; }
			else {
				const input = collisionFragmentFromBatch({ batch, rowSlotId: slot });
				message = input.ok ? collectFragmentMessage(await host.collect(input.value)) : "Could not collect Collision.";
			}
		} catch { message = kind === "copy" ? "Could not copy Collision." : "Could not collect Collision."; }
		if (this.host === host && this.writes.get(slot) === operation) {
			this.writes.delete(slot); this.feedback.set(slot, { rowId: row.committed.rowId, message }); this.changed?.();
		}
	}
	dispose() {
		this.controller?.close(); this.controller?.dispose(); this.controller = null;
		this.host = null; this.patterns = null; this.changed = null;
		this.tickets.clear(); this.writes.clear(); this.feedback.clear(); this.options = []; this.optionsBatch = null;
	}
}
