import type { CooperativeScheduler } from "../../src/render/cooperativeScheduler";

/**
 * Deterministic stand-in for the event-loop seam. The clock advances only by
 * `tickMs` per `now()` call, so how often a slice yields depends on the amount
 * of work, never on machine speed. `onYield` / `onPaint` let a test hold an
 * operation at an exact boundary.
 */
export function testScheduler(options: {
	tickMs?: number;
	onYield?: () => Promise<void> | void;
	onPaint?: () => Promise<void> | void;
} = {}): { scheduler: CooperativeScheduler; record: { yields: number; paints: number } } {
	let clock = 0;
	const record = { yields: 0, paints: 0 };
	return {
		record,
		scheduler: {
			now: () => (clock += options.tickMs ?? 0),
			yieldTask: async () => {
				record.yields += 1;
				await options.onYield?.();
			},
			paint: async () => {
				record.paints += 1;
				await options.onPaint?.();
			},
		},
	};
}

/** Never yields for budget reasons and resolves every wait at once. */
export function immediateScheduler(): CooperativeScheduler {
	return testScheduler().scheduler;
}
