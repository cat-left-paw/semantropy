import { describe, expect, it } from "vitest";
import { BusyGate } from "../src/view/busyGate";

describe("BusyGate", () => {
	it("starts free and admits one holder at a time", () => {
		const gate = new BusyGate();
		expect(gate.isBusy()).toBe(false);

		const first = gate.acquire();
		expect(first).not.toBeNull();
		expect(gate.isBusy()).toBe(true);
		expect(gate.acquire()).toBeNull();
	});

	it("frees the gate for its owner", () => {
		const gate = new BusyGate();
		const token = gate.acquire();
		if (token === null) {
			throw new Error("expected a claim");
		}
		expect(gate.release(token)).toBe(true);
		expect(gate.isBusy()).toBe(false);
	});

	it("ignores a release from an operation that no longer owns the gate", () => {
		const gate = new BusyGate();
		const stale = gate.acquire();
		if (stale === null) {
			throw new Error("expected a claim");
		}

		// An Open takes the view over and a new operation claims the gate.
		gate.revoke();
		const current = gate.acquire();
		expect(current).not.toBe(stale);

		// The superseded operation finally settles; it must not free the new one.
		expect(gate.release(stale)).toBe(false);
		expect(gate.isBusy()).toBe(true);

		if (current === null) {
			throw new Error("expected a claim");
		}
		expect(gate.release(current)).toBe(true);
		expect(gate.isBusy()).toBe(false);
	});

	it("leaves the gate free after revoking a holder that never settles", () => {
		const gate = new BusyGate();
		gate.acquire();
		gate.revoke();

		expect(gate.isBusy()).toBe(false);
		expect(gate.acquire()).not.toBeNull();
	});

	it("exposes a boolean guard whose release is still token-scoped", () => {
		const gate = new BusyGate();
		const changes: boolean[] = [];
		const guard = gate.guard(() => changes.push(gate.isBusy()));

		expect(guard.busy).toBe(false);
		guard.setBusy(true);
		expect(gate.isBusy()).toBe(true);

		// A revoke plus a new claim happens between claim and release.
		gate.revoke();
		const other = gate.acquire();
		guard.setBusy(false);
		expect(gate.isBusy()).toBe(true);

		if (other === null) {
			throw new Error("expected a claim");
		}
		gate.release(other);
		expect(gate.isBusy()).toBe(false);
		// The second callback still saw a busy gate: the guard's release was
		// refused because the new claim, not the guard, owned it.
		expect(changes).toEqual([true, true]);
	});

	it("reports busy through the guard while another operation holds the gate", () => {
		const gate = new BusyGate();
		gate.acquire();
		expect(gate.guard(() => undefined).busy).toBe(true);
	});
});
