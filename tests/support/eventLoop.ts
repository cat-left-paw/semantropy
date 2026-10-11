import { setImmediate as realSetImmediate } from "node:timers";

/**
 * Lets the test worker's event loop run once (TEST-STABILITY1).
 *
 * Vitest's worker answers the main process over IPC, and each call it makes
 * (such as `onTaskUpdate`) fails with "Timeout calling" when no answer is
 * processed within 60 seconds. A run of synchronous work never lets the
 * answer in, so a long stretch of it fails the whole run although every test
 * passed. The runner itself does not yield between tests. Awaiting this gives
 * the poll phase, where the answer arrives, a turn. It uses Node's own timer
 * so fake timers and jsdom's window timers cannot hold it.
 */
export function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => {
		realSetImmediate(resolve);
	});
}
