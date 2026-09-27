import { describe, expect, it, vi } from "vitest";
import { LazyTokenizer } from "../src/tokenizer/lazyTokenizer";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";

type FakeEngine = { id: number };

const token: JapaneseToken = {
	surface: "駅",
	pos: "名詞",
	detail1: "一般",
	detail2: "*",
	detail3: "*",
	conjugationType: "*",
	conjugationForm: "*",
	baseForm: "駅",
	isUnknown: false,
};

function run(engine: FakeEngine): JapaneseToken[] {
	return [{ ...token, baseForm: String(engine.id) }];
}

/**
 * The contract every Semantropy tokenizer shares, tested once on the base
 * class rather than once per engine.
 */
describe("LazyTokenizer", () => {
	it("does not build the engine until the first tokenize request", () => {
		const build = vi.fn(async () => ({ id: 1 }));
		const tokenizer = new LazyTokenizer(build, run);
		expect(build).not.toHaveBeenCalled();
		expect(tokenizer.isInitialized()).toBe(false);
	});

	it("shares one in-flight build across concurrent requests", async () => {
		let builds = 0;
		let finish: ((engine: FakeEngine) => void) | undefined;
		const tokenizer = new LazyTokenizer<FakeEngine>(
			() =>
				new Promise((resolve) => {
					builds += 1;
					finish = resolve;
				}),
			run,
		);

		const first = tokenizer.tokenize("駅");
		const second = tokenizer.tokenize("駅");
		finish?.({ id: 7 });
		await Promise.all([first, second]);

		expect(builds).toBe(1);
		expect(tokenizer.isInitialized()).toBe(true);
	});

	it("retries the build after a failure instead of caching the error", async () => {
		let builds = 0;
		const tokenizer = new LazyTokenizer<FakeEngine>(async () => {
			builds += 1;
			if (builds === 1) {
				throw new Error("dictionary unavailable");
			}
			return { id: builds };
		}, run);

		await expect(tokenizer.tokenize("駅")).rejects.toThrow(
			"dictionary unavailable",
		);
		expect(tokenizer.isInitialized()).toBe(false);
		await expect(tokenizer.tokenize("駅")).resolves.toHaveLength(1);
		expect(builds).toBe(2);
	});

	it("refuses an engine that finished after dispose, and releases it", async () => {
		let finish: ((engine: FakeEngine) => void) | undefined;
		const released: FakeEngine[] = [];
		const tokenizer = new LazyTokenizer<FakeEngine>(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
			run,
			(engine) => released.push(engine),
		);

		const pending = tokenizer.tokenize("駅");
		tokenizer.dispose();
		finish?.({ id: 3 });

		await expect(pending).rejects.toThrow(
			"Tokenizer was disposed during initialization.",
		);
		expect(tokenizer.isInitialized()).toBe(false);
		// The late engine is not adopted, and not leaked either.
		expect(released).toEqual([{ id: 3 }]);
	});

	it("releases the live engine on dispose", async () => {
		const released: FakeEngine[] = [];
		const tokenizer = new LazyTokenizer<FakeEngine>(
			async () => ({ id: 42 }),
			run,
			(engine) => released.push(engine),
		);

		await tokenizer.tokenize("駅");
		tokenizer.dispose();

		expect(released).toEqual([{ id: 42 }]);
		expect(tokenizer.isInitialized()).toBe(false);
	});

	it("builds again after dispose", async () => {
		let builds = 0;
		const tokenizer = new LazyTokenizer<FakeEngine>(async () => {
			builds += 1;
			return { id: builds };
		}, run);

		await tokenizer.tokenize("駅");
		tokenizer.dispose();
		const tokens = await tokenizer.tokenize("駅");

		expect(builds).toBe(2);
		expect(tokens[0]?.baseForm).toBe("2");
	});
});
