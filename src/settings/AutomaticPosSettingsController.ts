import type { AutomaticPosOptions } from "../transform/automaticPosOptions";
import { DEFAULT_AUTOMATIC_POS, validateAutomaticPosOptions } from "./automaticPosSettings";

export type AutomaticPosSettingsStatus = "effective" | "draft" | "preparing" | "ready" | "committed" | "cancelled" | "stale" | "failed" | "disposed";
export type AutomaticPosSettingsFailure = "invalid-request" | "invalid-ticket" | "cancelled" | "stale" | "failed" | "disposed";
export type AutomaticPosSettingsOutcome = "committed" | AutomaticPosSettingsFailure;
declare const ticketBrand: unique symbol;
export type AutomaticPosSettingsTicket = { readonly [ticketBrand]: true };
export type AutomaticPosSettingsState = Readonly<{
	status: AutomaticPosSettingsStatus;
	effective: AutomaticPosOptions;
	draft: AutomaticPosOptions | null;
	error: AutomaticPosSettingsFailure | null;
}>;
export type AutomaticPosTransactionHost = {
	/** Detached work only; no settings write. Never receives a presenter. */
	prepare(options: AutomaticPosOptions, isCurrent: () => boolean): Promise<boolean>;
	/** VIEW1-owned save/publication transaction. Must recheck isCurrent at its
	 * own side-effect boundary and return true only after successful publication.
	 * An ordinary asynchronous store.update followed by DOM work is NOT atomic.
	 * This seam neither implements nor claims durable rollback across that gap. */
	commit(options: AutomaticPosOptions, isCurrent: () => boolean): Promise<boolean>;
};
export type AutomaticPosToolbarPort = {
	read(): AutomaticPosSettingsState;
	open(): boolean;
	change(options: AutomaticPosOptions): boolean;
	apply(options: AutomaticPosOptions): Promise<AutomaticPosSettingsOutcome>;
	close(): void;
};
type Pending = { options: AutomaticPosOptions; stage: "preparing" | "ready"; ended: AutomaticPosSettingsOutcome | null };

/** One controller per View lifetime. No body, settings store, or Source input.
 * Tickets authenticate completion; equal options never authenticate a ticket.
 * Host-level begin permits explicit supersession; the presenter blocks double
 * Apply while pending. Stale/disposed are terminal for this owner. */
export class AutomaticPosSettingsController {
	#effective: AutomaticPosOptions;
	#draft: AutomaticPosOptions | null = null;
	#status: AutomaticPosSettingsStatus = "effective";
	#error: AutomaticPosSettingsFailure | null = null;
	readonly #tickets = new WeakMap<AutomaticPosSettingsTicket, Pending>();
	#current: AutomaticPosSettingsTicket | null = null;
	#host: AutomaticPosTransactionHost | null;
	constructor(host: AutomaticPosTransactionHost, initial: AutomaticPosOptions = DEFAULT_AUTOMATIC_POS) {
		const options = validateAutomaticPosOptions(initial);
		if (!options) throw new Error("Invalid automatic options");
		this.#effective = options;
		this.#host = host;
	}
	read(): AutomaticPosSettingsState {
		return Object.freeze({ status: this.#status, effective: this.#effective, draft: this.#draft, error: this.#error });
	}
	/** Trusted shared-settings host notification after an all-View commit.
	 * An initiating ticket completes through its own API, never another View. */
	adoptEffective(raw: unknown): boolean {
		if (this.terminal() || this.#current) return false;
		const options = validateAutomaticPosOptions(raw); if (!options) return false;
		this.#effective = options; this.#draft = null; this.#status = "effective"; this.#error = null;
		return true;
	}
	/** Host-only ticket API. The presenter receives only toolbarPort(). */
	begin(raw: unknown): AutomaticPosSettingsTicket | null {
		if (this.terminal()) return null;
		const options = validateAutomaticPosOptions(raw);
		if (!options || this.terminal()) return null;
		this.invalidate("stale");
		const ticket = Object.freeze({}) as AutomaticPosSettingsTicket;
		this.#tickets.set(ticket, { options, stage: "preparing", ended: null });
		this.#current = ticket; this.#draft = options; this.#status = "preparing"; this.#error = null;
		return ticket;
	}
	prepared(ticket: AutomaticPosSettingsTicket): boolean {
		if (this.refusal(ticket)) return false;
		const pending = this.#tickets.get(ticket)!;
		if (pending.stage !== "preparing") return false;
		pending.stage = "ready"; this.#status = "ready";
		return true;
	}
	/** Called only by the trusted host after its save/publication succeeded. */
	complete(ticket: AutomaticPosSettingsTicket): AutomaticPosSettingsOutcome {
		const refusal = this.refusal(ticket); if (refusal) return refusal;
		const pending = this.#tickets.get(ticket)!;
		if (pending.stage !== "ready") return "invalid-ticket";
		this.#effective = pending.options;
		pending.ended = "committed"; this.#current = null; this.#draft = null;
		this.#status = "committed"; this.#error = null;
		return "committed";
	}
	cancel(): void {
		if (this.terminal()) return;
		if (!this.#current && !this.#draft) return;
		this.invalidate("cancelled"); this.#draft = null; this.#status = "cancelled"; this.#error = null;
	}
	markStale(): void {
		if (this.#status === "disposed") return;
		this.invalidate("stale"); this.#draft = null; this.#status = "stale"; this.#error = "stale";
	}
	dispose(): void {
		this.invalidate("disposed"); this.#draft = null; this.#status = "disposed"; this.#error = null; this.#host = null;
	}
	toolbarPort(): AutomaticPosToolbarPort {
		return Object.freeze({ read: () => this.read(), open: () => this.open(),
			change: (options: AutomaticPosOptions) => this.change(options),
			apply: (options: AutomaticPosOptions) => this.apply(options), close: () => this.cancel() });
	}
	private terminal(): boolean { return this.#status === "disposed" || this.#status === "stale"; }
	private refusal(ticket: AutomaticPosSettingsTicket): AutomaticPosSettingsFailure | null {
		const pending = this.#tickets.get(ticket);
		if (!pending) return "invalid-ticket";
		if (this.#status === "disposed") return "disposed";
		if (this.#status === "stale") return "stale";
		if (this.#current !== ticket || pending.ended !== null) return pending.ended === "cancelled" ? "cancelled" : "stale";
		return null;
	}
	private invalidate(reason: AutomaticPosSettingsOutcome): void {
		const pending = this.#current ? this.#tickets.get(this.#current) : null;
		if (pending) pending.ended = reason;
		this.#current = null;
	}
	private open(): boolean {
		if (this.terminal() || this.#current) return false;
		this.#draft = Object.freeze({ ...this.#effective }); this.#status = "draft"; this.#error = null;
		return true;
	}
	private change(raw: unknown): boolean {
		if (this.#status !== "draft") return false;
		const options = validateAutomaticPosOptions(raw);
		if (!options || this.#status !== "draft") return false;
		this.#draft = options;
		return true;
	}
	private async apply(raw: unknown): Promise<AutomaticPosSettingsOutcome> {
		if (this.#status !== "draft" || !this.#draft) return this.terminal() ? this.#status as "stale" | "disposed" : "invalid-request";
		const ticket = this.begin(raw), host = this.#host;
		if (!ticket || !host) return "invalid-request";
		const options = this.#tickets.get(ticket)!.options;
		const isCurrent = () => this.refusal(ticket) === null;
		try {
			const prepared = await host.prepare(options, isCurrent);
			const refused = this.refusal(ticket); if (refused) return refused;
			if (prepared !== true) return this.fail(ticket);
			if (!this.prepared(ticket)) return "stale";
			const committed = await host.commit(options, isCurrent);
			const late = this.refusal(ticket); if (late) return late;
			if (committed !== true) return this.fail(ticket);
			return this.complete(ticket);
		} catch { return this.refusal(ticket) ?? this.fail(ticket); }
	}
	private fail(ticket: AutomaticPosSettingsTicket): AutomaticPosSettingsOutcome {
		const refusal = this.refusal(ticket); if (refusal) return refusal;
		this.invalidate("failed"); this.#draft = null; this.#status = "failed"; this.#error = "failed";
		return "failed";
	}
}
