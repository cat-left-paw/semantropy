import type { ReshuffleOutcome } from "../application/runReshuffle";
import { BusyGate } from "./busyGate";

export type SemantropyViewLifecycle = {
	closed: boolean;
	/** Owned, one-at-a-time claim over Reshuffle, Refresh, Copy and Collect. */
	busy: BusyGate;
	reshuffleNotice: string | null;
};

export function createViewLifecycle(): SemantropyViewLifecycle {
	return {
		closed: false,
		busy: new BusyGate(),
		reshuffleNotice: null,
	};
}

export function beginViewOpen(lifecycle: SemantropyViewLifecycle): void {
	lifecycle.closed = false;
	lifecycle.busy.revoke();
	lifecycle.reshuffleNotice = null;
}

export function beginViewClose(lifecycle: SemantropyViewLifecycle): void {
	lifecycle.closed = true;
	lifecycle.busy.revoke();
	lifecycle.reshuffleNotice = null;
}

export function closedReshuffleOutcome(
	lifecycle: SemantropyViewLifecycle,
): Extract<ReshuffleOutcome, "aborted"> | null {
	return lifecycle.closed ? "aborted" : null;
}
