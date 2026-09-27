import { FAKE_PROVERB_BATCH_SIZE, createFakeProverbBatchController, readFakeProverbRow, type FakeProverbBatch, type FakeProverbBatchController,
	type FakeProverbBatchReason, type FakeProverbOperationTicket } from "../fakeProverb/fakeProverbBatch";
import { compileFakeProverbRecipeSet, type CompiledFakeProverbRecipeSet } from "../fakeProverb/compileRecipeSet";
import { STANDARD_FAKE_PROVERB_RECIPE_SCHEMA_VERSION, STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION, STANDARD_FAKE_PROVERB_PROVERBS,
	STANDARD_FAKE_PROVERB_GLOSSES, STANDARD_FAKE_PROVERB_LITERALS, STANDARD_FAKE_PROVERB_PROFILES } from "../fakeProverb/generated/standardFakeProverbRecipeEntries";
import type { ManualMorphVocabulary } from "../transform/manualMorphology";
import type { CooperativeScheduler } from "../render/cooperativeScheduler";
import { fakeProverbFragmentInputFromRow, type FakeProverbFragmentInputV4 } from "../collect/v4/CollectedFragmentV4";
import type { CollectFragmentResultV4 } from "../collect/v4/CollectFragmentUseCaseV4";
import { collectFragmentMessage } from "../collect/collectMessages";

export type FakeProverbSessionHost = {
	/** The View's active, fresh Vocabulary owner, or null. Never a clone or a rebuilt Snapshot. */
	active(): ManualMorphVocabulary | null;
	/** Fresh private 256-bit hex material; never persisted, logged or shown. */
	material(): string;
	scheduler: CooperativeScheduler;
	copy(text: string): Promise<void>;
	collect(input: FakeProverbFragmentInputV4): Promise<CollectFragmentResultV4>;
};

/**
 * Puts a committed batch on screen as one transaction. "published": every row
 * shows it. "failed": nothing changed — every row, the scroll position and
 * focus are as before. "broken": the display could not be restored and may
 * mix batches.
 */
export type FakeProverbPublisher = (batch: FakeProverbBatch) => "published" | "failed" | "broken";

/** The fixed number of display positions: BATCH1's batch size. */
export const FAKE_PROVERB_ROW_COUNT = FAKE_PROVERB_BATCH_SIZE;

const RETAINED = "The previous results are retained.";
export const FAKE_PROVERB_PUBLISH_FAILED = `Could not display the new results. ${RETAINED}`;
export const FAKE_PROVERB_DISPLAY_BROKEN = "Could not display the results. Close and reopen Fake proverb.";

/** Presentation only: fixed English strings; a refusal never discloses its payload. */
export function fakeProverbMessage(reason: FakeProverbBatchReason | null, hasBatch = false): string {
	const retained = (message: string) => (hasBatch ? `${message} ${RETAINED}` : message);
	switch (reason) {
		case null:
		case "superseded": return "";
		case "insufficient-candidates": return retained("Insufficient vocabulary: not enough usable words.");
		case "no-compatible-gloss": return retained("Insufficient vocabulary: no explanation fits the generated proverbs.");
		case "duplicate-exhaustion": return retained("Not enough distinct results.");
		case "cancelled": return retained("Cancelled.");
		case "stale":
		case "released": return retained("The Vocabulary changed. Apply or refresh it before Generate.");
		default: return retained("Could not generate fake proverbs.");
	}
}

/**
 * The View's Fake Proverb state. It reads no Source, calls no tokenizer and has
 * no generator of its own: Generate is BATCH1's begin -> prepare -> complete,
 * and Copy / Collect read a committed row through `readFakeProverbRow()`,
 * never the DOM or a draft.
 *
 * One BATCH1 controller for the View's lifetime, so its ten rowSlotIds are the
 * View's stable display positions (Fake Proverb Policy 1 §7). The session holds
 * one Vocabulary owner at most, the current one. When Generate finds a different
 * active owner, BATCH1 is first told that the Vocabulary it knew is gone through
 * `sourceChanged()`, its only non-terminal release: every owner it knows is
 * revoked, its authority cache is emptied and pending tickets retire, while the
 * rowSlotIds and the committed batch stay. A Source change is forwarded to BATCH1
 * only for the current owner's Sources, after which the session drops that owner;
 * an earlier owner's Source never revokes the current one. Which owner produced
 * the published batch is remembered as an epoch number, never as the owner.
 *
 * A Modal attaches a display and detaches it on close. Closing the Modal
 * cancels a pending Generate but revokes nothing.
 *
 * BATCH1 commits a batch before the Modal can show it, so the session keeps its
 * own *published* batch: the one every row on screen shows. It advances only
 * when the publisher reports the whole batch on screen. Copy, Collect, the
 * summary and the stale notice all read the published batch, never BATCH1's
 * latest commit, so a failed publication leaves the batch, the display and the
 * write targets on the previous result together.
 */
export class FakeProverbSession {
	private controller: FakeProverbBatchController | null = null;
	/** The only Vocabulary owner this session holds: the one BATCH1 currently knows. */
	private currentOwner: ManualMorphVocabulary | null = null;
	/** Advances whenever the current owner is replaced or dropped. */
	private ownerEpoch = 0;
	/** The epoch of the owner that produced the published batch. */
	private publishedEpoch = -1;
	private recipes: CompiledFakeProverbRecipeSet | null = null;
	private host: FakeProverbSessionHost | null;
	private ticket: FakeProverbOperationTicket | null = null;
	/** The batch every row on screen shows; null until one is published. */
	private published: FakeProverbBatch | null = null;
	/** Set when a failed publication could not be restored exactly: nothing on screen can be trusted as one batch. */
	private broken = false;
	private writes = new Map<string, object>();
	private feedback = new Map<string, { rowId: string; message: string }>();
	private stale = false;
	changed: (() => void) | null = null;
	publisher: FakeProverbPublisher | null = null;
	error = "";
	constructor(host: FakeProverbSessionHost) {
		this.host = host;
		try {
			const compiled = compileFakeProverbRecipeSet({ schemaVersion: STANDARD_FAKE_PROVERB_RECIPE_SCHEMA_VERSION,
				dataVersion: STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION, proverbs: STANDARD_FAKE_PROVERB_PROVERBS,
				glosses: STANDARD_FAKE_PROVERB_GLOSSES, literals: STANDARD_FAKE_PROVERB_LITERALS, profiles: STANDARD_FAKE_PROVERB_PROFILES });
			const owner = createFakeProverbBatchController({ identityMaterial: host.material() });
			if (!compiled.ok || !owner.ok) throw Error();
			this.recipes = compiled.set; this.controller = owner.value;
		} catch { this.error = "Fake proverb is unavailable."; }
	}
	/** The View's BATCH1 state: ten stable rowSlotIds from the start. */
	read() { return this.controller?.read() ?? null; }
	/** The batch on screen, which Copy and Collect use. */
	batch() { return this.published; }
	/** The rowSlotId shown at a display position, or null for an empty position. */
	slotAt(position: number) {
		const row = this.published?.rows[position];
		return row?.committed ? row.rowSlotId : null;
	}
	isBroken() { return this.broken; }
	pending() { return !!this.read()?.generation.pending; }
	canGenerate() { return !!this.host && !!this.controller && !!this.recipes && !this.broken && !!this.host.active(); }
	isStale() {
		return !!this.published && (this.stale || this.publishedEpoch !== this.ownerEpoch || this.currentOwner !== this.host?.active());
	}
	/**
	 * A Vocabulary Source changed. Only the current owner's Sources reach BATCH1:
	 * its pending work goes stale and the owner is revoked there. The published
	 * batch and its provenance stay; if it came from that Source, it is marked stale.
	 */
	sourceChanged(path: string) {
		const has = (sources: readonly { readonly path: string }[] | undefined) => !!sources?.some(source => source.path === path);
		if (has(this.published?.provenance.sources)) this.stale = true;
		if (has(this.currentOwner?.snapshot.sources)) {
			this.controller?.sourceChanged();
			// BATCH1 has revoked and forgotten it; so does the session.
			this.currentOwner = null; this.ownerEpoch += 1; this.ticket = null;
		}
		this.changed?.();
	}
	/**
	 * Makes `vocabulary` the only owner BATCH1 knows. A different owner releases the
	 * previous one first: BATCH1 revokes it, drops its authority cache and retires its
	 * tickets, and keeps the View's rowSlotIds and committed batch.
	 */
	private adopt(controller: FakeProverbBatchController, vocabulary: ManualMorphVocabulary) {
		if (this.currentOwner === vocabulary) return;
		if (this.currentOwner) controller.sourceChanged();
		this.currentOwner = vocabulary; this.ownerEpoch += 1; this.ticket = null;
	}
	async generate(): Promise<void> {
		const host = this.host, owner = this.controller, recipeSet = this.recipes;
		const vocabulary = host?.active();
		if (!host || !owner || !recipeSet || !vocabulary || this.broken) {
			if (!this.broken) this.error = owner && recipeSet ? "Apply a fresh Vocabulary before Generate." : "Fake proverb is unavailable.";
			this.changed?.(); return;
		}
		let ticket: FakeProverbOperationTicket;
		try {
			this.adopt(owner, vocabulary);
			const begun = owner.beginGenerate({ vocabulary, recipeSet, operationMaterial: host.material() });
			if (!begun.ok) { this.error = fakeProverbMessage(begun.reason, !!this.published); this.changed?.(); return; }
			ticket = begun.value;
		} catch { this.error = fakeProverbMessage("invalid-request", !!this.published); this.changed?.(); return; }
		// A newer Generate supersedes this one inside BATCH1; only the latest ticket is followed here.
		this.ticket = ticket;
		const current = () => this.controller === owner && this.ticket === ticket;
		this.error = ""; this.changed?.(); // Busy DOM precedes the paint opportunity.
		try {
			await host.scheduler.paint(); await host.scheduler.yieldTask();
			if (!current()) return;
			if (host.active() !== vocabulary) { this.cancel(); return; }
			const prepared = owner.prepare(ticket); // Synchronous; cannot process events inside this call.
			await host.scheduler.yieldTask();
			if (!current()) return;
			if (host.active() !== vocabulary) { this.cancel(); return; }
			if (!prepared.ok) { owner.cancel(ticket); return; }
			const previous = this.read()?.batch ?? null;
			// A failed completion records its own fixed reason and keeps the previous batch.
			const completed = owner.complete(ticket, prepared.value);
			const batch = completed.ok ? completed.value.batch : null;
			if (batch && batch !== previous) this.publish(batch);
		} catch { if (current()) { owner.cancel(ticket); this.error = fakeProverbMessage("invalid-request", !!this.published); } }
		finally { if (current()) { this.ticket = null; this.changed?.(); } }
	}
	/** The publication boundary: the published batch moves only when the whole batch is on screen. */
	private publish(batch: FakeProverbBatch) {
		let outcome: ReturnType<FakeProverbPublisher>;
		try { outcome = this.publisher?.(batch) ?? "failed"; } catch { outcome = "broken"; }
		if (outcome === "published") {
			this.published = batch; this.publishedEpoch = this.ownerEpoch; this.stale = false; this.feedback.clear();
			return;
		}
		if (outcome === "broken") this.broken = true;
		this.error = outcome === "broken" ? FAKE_PROVERB_DISPLAY_BROKEN : FAKE_PROVERB_PUBLISH_FAILED;
	}
	cancel() {
		const ticket = this.ticket;
		if (ticket) this.controller?.cancel(ticket);
		this.ticket = null; this.changed?.();
	}
	/**
	 * A Modal attaches its display. The published batch, if any, is published
	 * again into the new rows through the same transaction; a display that
	 * cannot show it is broken, so nothing unseen can be copied or collected.
	 */
	attach(publisher: FakeProverbPublisher, changed: () => void) {
		this.publisher = publisher; this.changed = changed; this.broken = false; this.error = "";
		if (this.published) {
			let outcome: ReturnType<FakeProverbPublisher>;
			try { outcome = publisher(this.published); } catch { outcome = "broken"; }
			if (outcome !== "published") { this.broken = true; this.error = FAKE_PROVERB_DISPLAY_BROKEN; }
		}
	}
	/** The Modal closed: its display is gone and a pending Generate is cancelled. Nothing is revoked. */
	detach() {
		const ticket = this.ticket;
		this.publisher = null; this.changed = null; this.ticket = null;
		if (ticket) this.controller?.cancel(ticket);
	}
	/** Explicit Copy / Collect only, of a published row, never while a Generate is pending or the row is being written. */
	canWrite(slot: string) {
		return !!this.host && !this.broken && !this.pending() && !this.writes.has(slot) &&
			!!this.published?.rows.some(row => row.rowSlotId === slot && row.committed !== null);
	}
	rowFeedback(slot: string, rowId: string) {
		const value = this.feedback.get(slot); return value?.rowId === rowId ? value.message : "";
	}
	async write(slot: string, kind: "copy" | "collect"): Promise<void> {
		const host = this.host, batch = this.published;
		if (!host || !batch || !this.canWrite(slot)) return;
		// Captured before any await: the row on screen, never the DOM, a draft or an unpublished batch.
		const record = readFakeProverbRow({ batch, rowSlotId: slot });
		if (!record.ok) return;
		const operation = {}; this.writes.set(slot, operation); this.changed?.();
		let message: string;
		try {
			if (kind === "copy") { await host.copy(record.value.canonicalText); message = "Copied."; }
			else {
				const input = fakeProverbFragmentInputFromRow(record.value);
				message = input.ok ? collectFragmentMessage(await host.collect(input.value)) : "Could not collect fake proverb.";
			}
		} catch { message = kind === "copy" ? "Could not copy fake proverb." : "Could not collect fake proverb."; }
		if (this.host === host && this.writes.get(slot) === operation) {
			this.writes.delete(slot); this.feedback.set(slot, { rowId: record.value.rowId, message }); this.changed?.();
		}
	}
	dispose() {
		this.controller?.close(); this.controller?.dispose(); this.controller = null; this.currentOwner = null;
		this.host = null; this.recipes = null; this.changed = null; this.publisher = null; this.ticket = null;
		this.published = null; this.writes.clear(); this.feedback.clear();
	}
}
