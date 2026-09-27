export type BusyToken = number;

/**
 * One-at-a-time ownership of the view's actions.
 *
 * A plain boolean is not enough once Refresh can be superseded: an Open that
 * takes the view over would inherit the old Refresh's busy flag and leave
 * Reshuffle and Refresh disabled until — or unless — that Refresh ever
 * settles. Ownership is therefore a token, and a release only counts when the
 * releasing operation still holds the gate.
 */
export class BusyGate {
	private owner: BusyToken | null = null;
	private nextToken = 0;
	private changed: (() => void) | null = null;

	/**
	 * One owner-supplied callback, run after every change between idle and busy,
	 * whichever code path acquired, released or revoked the gate. It lets state
	 * that mirrors the gate (the View's pointer affordance) follow it without
	 * each operation having to remember to resynchronise.
	 */
	onChange(listener: (() => void) | null): void {
		this.changed = listener;
	}

	private set(owner: BusyToken | null): void {
		const was = this.owner !== null;
		this.owner = owner;
		if (was !== (owner !== null)) this.changed?.();
	}

	isBusy(): boolean {
		return this.owner !== null;
	}

	/** Claims the gate, or returns null when someone else already holds it. */
	acquire(): BusyToken | null {
		if (this.owner !== null) {
			return null;
		}
		this.nextToken += 1;
		this.set(this.nextToken);
		return this.nextToken;
	}

	/** Releases the gate only if this token is still the owner. */
	release(token: BusyToken): boolean {
		if (this.owner !== token) {
			return false;
		}
		this.set(null);
		return true;
	}

	/**
	 * Takes the gate away from whoever holds it. Open, close and reopen all
	 * supersede any operation in flight, so the new state starts unblocked.
	 */
	revoke(): void {
		this.set(null);
	}

	/**
	 * Boolean-flag view of the gate for the synchronous Reshuffle guard, which
	 * protects against re-entry within one tick. Release stays token-scoped.
	 */
	guard(onChange: () => void): {
		busy: boolean;
		setBusy: (busy: boolean) => void;
	} {
		let token: BusyToken | null = null;
		return {
			busy: this.isBusy(),
			setBusy: (busy) => {
				if (busy) {
					token = this.acquire();
				} else if (token !== null) {
					this.release(token);
					token = null;
				}
				onChange();
			},
		};
	}
}
