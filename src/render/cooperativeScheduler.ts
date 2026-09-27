/**
 * The event-loop seam for long Target work.
 *
 * Production yields with a one-shot MessageChannel task: unlike nested
 * timers it is not clamped to 4 ms, and unlike requestAnimationFrame it still
 * runs in a hidden window. A paint opportunity uses requestAnimationFrame
 * followed by one task, bounded by a timer so a hidden or minimized window
 * cannot hold an operation open indefinitely.
 */
export type CooperativeScheduler = {
	now(): number;
	/** Resolves in a later task. Never rejects and never waits for a frame. */
	yieldTask(): Promise<void>;
	/** Resolves after a frame had the chance to paint, or after a bounded fallback. */
	paint(): Promise<void>;
};

/** Longest planned stretch of Target work between two yields. */
export const TARGET_SLICE_BUDGET_MS = 8;
/** Upper bound for a paint wait when no frame is produced (hidden window). */
export const PAINT_FALLBACK_MS = 100;

export function createWindowScheduler(win: Window): CooperativeScheduler {
	const yieldTask = (): Promise<void> => new Promise<void>((resolve) => {
		if (typeof MessageChannel === "function") {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => {
				channel.port1.close();
				resolve();
			};
			channel.port2.postMessage(null);
			return;
		}
		win.setTimeout(resolve, 0);
	});
	return {
		now: () => win.performance.now(),
		yieldTask,
		paint: () => new Promise<void>((resolve) => {
			let settled = false;
			const finish = (): void => {
				if (settled) return;
				settled = true;
				win.clearTimeout(timer);
				resolve();
			};
			const timer = win.setTimeout(finish, PAINT_FALLBACK_MS);
			if (typeof win.requestAnimationFrame === "function") {
				win.requestAnimationFrame(() => {
					void yieldTask().then(finish);
				});
			}
		}),
	};
}

export type CooperativeSliceStats = { yields: number; maxContinuousMs: number };

/**
 * Splits one operation into budgeted stretches. Callers invoke `checkpoint`
 * between work units (a run or a block); it yields once the budget is spent
 * and reports whether the operation is still current afterwards.
 */
export class CooperativeSlice {
	private sliceStart: number;
	private yields = 0;
	private maxContinuousMs = 0;

	constructor(
		private readonly scheduler: CooperativeScheduler,
		private readonly isCurrent: () => boolean,
		private readonly budgetMs = TARGET_SLICE_BUDGET_MS,
	) {
		this.sliceStart = scheduler.now();
	}

	async checkpoint(): Promise<boolean> {
		if (!this.current()) return false;
		const now = this.scheduler.now();
		if (now - this.sliceStart >= this.budgetMs) {
			this.record(now);
			await this.scheduler.yieldTask();
			this.yields += 1;
			this.sliceStart = this.scheduler.now();
		}
		return this.current();
	}

	/** An explicit paint opportunity, e.g. after a busy status was rendered. */
	async paint(): Promise<boolean> {
		this.record(this.scheduler.now());
		await this.scheduler.paint();
		this.sliceStart = this.scheduler.now();
		return this.current();
	}

	stats(): CooperativeSliceStats {
		this.record(this.scheduler.now());
		return { yields: this.yields, maxContinuousMs: this.maxContinuousMs };
	}

	private record(now: number): void {
		this.maxContinuousMs = Math.max(this.maxContinuousMs, now - this.sliceStart);
	}

	private current(): boolean {
		try {
			return this.isCurrent();
		} catch {
			return false;
		}
	}
}
