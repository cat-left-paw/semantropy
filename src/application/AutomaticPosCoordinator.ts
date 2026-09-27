import type { AutomaticPosOptions } from "../transform/automaticPosOptions";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type { AutomaticPosSettingsStore, SettingsPublication } from "../settings/AutomaticPosSettingsStore";

export type AutomaticViewPreparation = SettingsPublication & { dispose(): void };
/** What an operation changes: the four Automatic options, or the Text level at the current options. */
export type AutomaticSettingsChange = "options" | "level";
export type AutomaticViewClaim = {
	/** `bodySemantropy` is present only for a level change; every View prepares its materialized Chunks at it. */
	prepare(options: AutomaticPosOptions, current: () => boolean, bodySemantropy?: BodySemantropy): Promise<AutomaticViewPreparation | null>;
	release(committed: boolean): void;
};
export type AutomaticViewParticipant = { claim(change: AutomaticSettingsChange): AutomaticViewClaim | null };
type Operation = { owner: AutomaticViewParticipant; current: () => boolean; claims: AutomaticViewClaim[];
	prepared: AutomaticViewPreparation[]; cancelled: boolean; committing: boolean; ready: boolean; revision: number; options: AutomaticPosOptions;
	bodySemantropy?: BodySemantropy };

/** One plugin-wide settings/publication owner. View capabilities are exact
 * registration identities, never option equality or another View's ticket.
 * Option Apply and the Text level change share it: every registered View is
 * claimed and prepared, and only then is the setting saved, every View
 * published and committed together; a stale owner or a failed publication
 * rolls back every View and compensates the save. */
export class AutomaticPosCoordinator {
	private readonly views = new Set<AutomaticViewParticipant>();
	private operation: Operation | null = null;
	private revision = 0;
	private disposed = false;
	constructor(private readonly store: AutomaticPosSettingsStore) {}
	register(view: AutomaticViewParticipant): () => void {
		if (this.disposed) return () => undefined;
		this.cancel(); this.revision += 1; this.views.add(view);
		return () => { if (this.views.delete(view)) { this.revision += 1; this.cancel(); } };
	}
	private alive(operation: Operation): boolean {
		return !this.disposed && !operation.cancelled && this.operation === operation && operation.revision === this.revision &&
			this.views.has(operation.owner) && operation.current();
	}
	private current(operation: Operation): boolean { return this.alive(operation) && operation.prepared.every(prepared => prepared.current()); }
	async prepare(owner: AutomaticViewParticipant, options: AutomaticPosOptions, current: () => boolean, bodySemantropy?: BodySemantropy): Promise<boolean> {
		if (this.disposed || !this.views.has(owner)) return false;
		this.cancel();
		// A pending save must finish compensation before another operation can
		// acquire its Views. A caller can retry; it cannot bypass that ownership.
		if (this.operation) return false;
		const operation: Operation = { owner, options, current, revision: this.revision, claims: [], prepared: [], cancelled: false, committing: false, ready: false,
			...(bodySemantropy === undefined ? {} : { bodySemantropy }) };
		const change: AutomaticSettingsChange = bodySemantropy === undefined ? "options" : "level";
		this.operation = operation;
		try {
			for (const view of this.views) {
				if (!this.current(operation)) return false;
				const claim = view.claim(change); if (!claim) return false;
				operation.claims.push(claim);
			}
			for (const claim of operation.claims) {
				if (!this.current(operation)) return false;
				const prepared = await (operation.bodySemantropy === undefined ? claim.prepare(options, () => this.alive(operation)) :
					claim.prepare(options, () => this.alive(operation), operation.bodySemantropy));
				if (!prepared) return false;
				operation.prepared.push(prepared);
			}
			if (!this.current(operation)) return false;
			operation.ready = true;
			return true;
		} catch { return false; }
		finally { if (!this.current(operation) || operation.prepared.length !== operation.claims.length || operation.claims.length !== this.views.size) this.finish(operation, false); }
	}
	async commit(owner: AutomaticViewParticipant, options: AutomaticPosOptions, current: () => boolean): Promise<boolean> {
		const operation = this.operation;
		if (!operation || operation.owner !== owner || operation.options !== options || operation.committing || !current() || !this.current(operation)) {
			if (operation?.owner === owner && !operation.committing) this.finish(operation, false);
			return false;
		}
		operation.committing = true;
		let committed = false;
		try {
			committed = await this.store.transact(operation.bodySemantropy === undefined ? { automaticPos: options } : { bodySemantropy: operation.bodySemantropy }, {
				current: () => current() && this.current(operation),
				publish: () => {
					for (const prepared of operation.prepared) {
						if (!current() || !this.current(operation)) throw Error("Stale automatic publication.");
						prepared.publish();
					}
				},
				commit: () => { for (const prepared of operation.prepared) prepared.commit(); },
				rollback: () => {
					let failed = false;
					for (const prepared of [...operation.prepared].reverse()) try { prepared.rollback(); } catch { failed = true; }
					if (failed) throw Error("Automatic rollback failed.");
				},
			});
			return committed;
		} catch { return false; }
		finally { this.finish(operation, committed); }
	}
	cancel(): void {
		const operation = this.operation; if (!operation) return;
		operation.cancelled = true;
		if (operation.ready && !operation.committing) this.finish(operation, false);
	}
	dispose(): void { this.disposed = true; this.cancel(); this.views.clear(); }
	private finish(operation: Operation, committed: boolean): void {
		if (this.operation !== operation) return;
		this.operation = null;
		for (const prepared of operation.prepared) prepared.dispose();
		for (const claim of operation.claims) claim.release(committed);
	}
}
