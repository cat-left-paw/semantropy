import { drawManualAdverbCandidate, evaluateManualAdverbSlot, inspectManualAdverbAuthority, releaseManualAdverbAuthority,
	type ManualAdverbAuthority, type ManualAdverbCandidate, type ManualAdverbReleaseReason, type ManualAdverbSlot } from "./manualAdverbAuthority";
import { array, fields, frozen, guarded, increment, refuse, text, type ManualAdverbResult } from "./manualAdverbGuard";

export type ManualAdverbAction = "shuffle" | "restore-original" | "use-automatic";
export type ManualAdverbRow = {
	readonly slot: ManualAdverbSlot;
	readonly automaticSurface: string;
	readonly committed: { readonly surface: string; readonly revision: number } & (
		{ readonly mode: "manual"; readonly candidate: ManualAdverbCandidate } |
		{ readonly mode: "automatic" | "original"; readonly candidate: null });
};
export type ManualAdverbState = { readonly rows: readonly ManualAdverbRow[] };
/** An owner-local capability, never a serializable result or a revision supplied by a caller. */
export type ManualAdverbTicket = { readonly action: ManualAdverbAction };
export type ManualAdverbController = {
	read(): ManualAdverbResult<ManualAdverbState>;
	prepare(input: { slot: ManualAdverbSlot; action: ManualAdverbAction; nonce: number }): ManualAdverbResult<ManualAdverbTicket>;
	preview(ticket: ManualAdverbTicket): ManualAdverbResult<ManualAdverbRow>;
	complete(ticket: ManualAdverbTicket): ManualAdverbResult<ManualAdverbState>;
	cancel(ticket: ManualAdverbTicket): ManualAdverbResult<true>;
	setAutomaticBaseline(input: { slot: ManualAdverbSlot; surface: string }): ManualAdverbResult<ManualAdverbState>;
	release(reason: ManualAdverbReleaseReason): ManualAdverbResult<true>;
};
function unwrap<T>(result: ManualAdverbResult<T>): T { if (!result.ok) refuse(result.reason); return result.value; }

/** No automatic generator: the caller supplies the baseline; explicit Manual is always available. */
export function createManualAdverbController(input: { authority: ManualAdverbAuthority;
	slots: readonly { slot: ManualAdverbSlot; automaticSurface: string }[] }): ManualAdverbResult<ManualAdverbController> {
	return guarded(() => {
		const data = fields(input, ["authority", "slots"]);
		let authority: ManualAdverbAuthority | null = data.authority as ManualAdverbAuthority;
		unwrap(inspectManualAdverbAuthority(authority));
		const unique = new Set<ManualAdverbSlot>();
		const rows = array(data.slots).map(value => {
			const entry = fields(value, ["slot", "automaticSurface"]), slot = entry.slot as ManualAdverbSlot;
			const surface = text(entry.automaticSurface);
			unwrap(evaluateManualAdverbSlot({ authority: authority!, slot, currentSurface: surface }));
			if (unique.has(slot)) refuse("invalid-slot"); unique.add(slot);
			return { slot, automaticSurface: surface, committed: { surface, mode: "automatic" as const, candidate: null, revision: 0 } };
		});
		let state: ManualAdverbState = frozen({ rows });
		let busy = false;
		const pending = new Map<ManualAdverbSlot, { ticket: ManualAdverbTicket; before: ManualAdverbRow; after: ManualAdverbRow }>();
		function live(): ManualAdverbAuthority {
			if (!authority) refuse("released"); unwrap(inspectManualAdverbAuthority(authority)); return authority;
		}
		function run<T>(work: () => T): ManualAdverbResult<T> {
			return guarded(() => {
				if (busy) refuse("busy"); busy = true;
				try { live(); return work(); } finally { busy = false; }
			});
		}
		function row(slot: unknown): ManualAdverbRow {
			const found = state.rows.find(item => item.slot === slot); if (!found) refuse("invalid-slot"); return found;
		}
		function ticket(value: ManualAdverbTicket) {
			const entry = [...pending.values()].find(item => item.ticket === value);
			if (!entry || row(entry.before.slot) !== entry.before) refuse("invalid-ticket");
			return entry;
		}
		function publish(before: ManualAdverbRow, after: ManualAdverbRow) {
			live();
			state = frozen({ rows: state.rows.map(item => item === before ? after : item) });
			pending.delete(before.slot); return state;
		}
		live();
		return Object.freeze({
			read: () => run(() => state),
			prepare: (input) => run(() => {
				const data = fields(input, ["slot", "action", "nonce"]), before = row(data.slot);
				if (!["shuffle", "restore-original", "use-automatic"].includes(data.action as string) ||
					!Number.isInteger(data.nonce) || (data.nonce as number) < 0 || (data.nonce as number) > 0xffffffff) refuse("invalid-input");
				// A new valid request supersedes this slot even when it has no alternative.
				pending.delete(before.slot);
				const action = data.action as ManualAdverbAction;
				let surface = action === "restore-original" ? before.slot.originalSurface : before.automaticSurface;
				let selection: ManualAdverbCandidate | null = null;
				if (action === "shuffle") {
					const evaluation = unwrap(evaluateManualAdverbSlot({ authority: live(), slot: before.slot, currentSurface: before.committed.surface }));
					selection = unwrap(drawManualAdverbCandidate({ authority: live(), evaluation, nonce: data.nonce as number }));
					surface = selection.record.surface;
				}
				const revision = increment(before.committed.revision);
				const committed: ManualAdverbRow["committed"] = selection ? { surface, revision, mode: "manual", candidate: selection }
					: { surface, revision, mode: action === "restore-original" ? "original" : "automatic", candidate: null };
				const after: ManualAdverbRow = frozen({ ...before, committed });
				const ticket = Object.freeze({ action });
				live(); pending.set(before.slot, { ticket, before, after }); return ticket;
			}),
			complete: (value) => run(() => {
				const entry = ticket(value);
				// Recheck Target lifetime, too; a separate Target authority may have been released.
				unwrap(evaluateManualAdverbSlot({ authority: live(), slot: entry.before.slot, currentSurface: entry.before.committed.surface }));
				return publish(entry.before, entry.after);
			}),
			preview: (value) => run(() => ticket(value).after),
			cancel: (value) => run(() => { const entry = ticket(value); pending.delete(entry.before.slot); return true as const; }),
			setAutomaticBaseline: (input) => run(() => {
				const data = fields(input, ["slot", "surface"]), before = row(data.slot), surface = text(data.surface);
				unwrap(evaluateManualAdverbSlot({ authority: live(), slot: before.slot, currentSurface: before.committed.surface }));
				return publish(before, frozen({ ...before, automaticSurface: surface, committed: before.committed.mode === "automatic"
					? { ...before.committed, surface, revision: increment(before.committed.revision) } : before.committed }));
			}),
			release: (reason) => guarded(() => {
				if (busy) refuse("busy");
				if (!authority) refuse("released");
				const released = releaseManualAdverbAuthority({ authority, reason });
				if (!released.ok && released.reason !== "released") refuse(released.reason);
				authority = null; pending.clear(); state = frozen({ rows: [] }); return true as const;
			}),
		} satisfies ManualAdverbController);
	});
}
