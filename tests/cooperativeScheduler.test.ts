import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CooperativeSlice,
	createWindowScheduler,
	PAINT_FALLBACK_MS,
	TARGET_SLICE_BUDGET_MS,
} from "../src/render/cooperativeScheduler";
import { testScheduler } from "./support/testScheduler";

function fakeWindow(requestAnimationFrame: ((callback: () => void) => number) | undefined) {
	return {
		performance: { now: () => Date.now() },
		setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
		clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
		requestAnimationFrame,
	} as unknown as Window;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("window scheduler", () => {
	it("yields as a task, after microtasks already queued", async () => {
		const scheduler = createWindowScheduler(fakeWindow(undefined));
		const order: string[] = [];
		const yielded = scheduler.yieldTask().then(() => order.push("task"));
		void Promise.resolve().then(() => order.push("microtask"));
		await yielded;
		expect(order).toEqual(["microtask", "task"]);
	});

	it("does not wait forever for a frame in a hidden window", async () => {
		vi.useFakeTimers();
		const scheduler = createWindowScheduler(fakeWindow(() => 0));
		let painted = false;
		void scheduler.paint().then(() => { painted = true; });
		await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS - 1);
		expect(painted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(painted).toBe(true);
	});

	it("resolves after a frame and one task when frames are produced", async () => {
		const frames: (() => void)[] = [];
		const scheduler = createWindowScheduler(fakeWindow((callback) => { frames.push(callback); return frames.length; }));
		let painted = false;
		const paint = scheduler.paint().then(() => { painted = true; });
		expect(frames).toHaveLength(1);
		frames[0]!();
		await paint;
		expect(painted).toBe(true);
	});
});

describe("cooperative slice", () => {
	it("yields only once the budget is spent and reports the longest stretch", async () => {
		const { scheduler, record } = testScheduler({ tickMs: 1 });
		const slice = new CooperativeSlice(scheduler, () => true);
		for (let unit = 0; unit < 40; unit += 1) expect(await slice.checkpoint()).toBe(true);
		expect(record.yields).toBeGreaterThanOrEqual(3);
		expect(slice.stats().yields).toBe(record.yields);
		expect(slice.stats().maxContinuousMs).toBeGreaterThanOrEqual(TARGET_SLICE_BUDGET_MS);
	});

	it("reports superseded work after a yield, and treats a throwing guard as superseded", async () => {
		let current = true;
		const { scheduler } = testScheduler({ tickMs: TARGET_SLICE_BUDGET_MS, onYield: () => { current = false; } });
		expect(await new CooperativeSlice(scheduler, () => current).checkpoint()).toBe(false);
		expect(await new CooperativeSlice(testScheduler().scheduler, () => { throw new Error("本文 /private/path.md"); }).checkpoint()).toBe(false);
	});
});
