import { describe, expect, it } from "vitest";
import { runTokenizerSmoke } from "../src/tokenizer/runTokenizerSmoke";
import type { TokenizerSmokeHost } from "../src/tokenizer/runTokenizerSmoke";
import { TOKENIZER_SMOKE_TEXT } from "../src/tokenizer/smokeText";
import { token } from "./tokenFixtures";

function createUi() {
	const notices: string[] = [];
	const errors: unknown[] = [];
	const debugs: unknown[] = [];
	return {
		notices,
		errors,
		debugs,
		ui: {
			showNotice: (message: string) => {
				notices.push(message);
			},
			logDebug: (_message: string, details: unknown) => {
				debugs.push(details);
			},
			logError: (_message: string, error: unknown) => {
				errors.push(error);
			},
		},
	};
}

describe("runTokenizerSmoke error handling", () => {
	it("reports a tokenizer that cannot even be constructed", async () => {
		const { notices, errors, ui } = createUi();

		await expect(
			runTokenizerSmoke(() => {
				throw new Error(
					"Embedded Lindera dictionary payload is incomplete: missing dict.trie.",
				);
			}, ui),
		).resolves.toBeUndefined();

		expect(notices).toEqual(["Tokenizer failed. See the developer console."]);
		expect(errors[0]).toBeInstanceOf(Error);
		expect((errors[0] as Error).message).toMatch(/payload is incomplete/);
	});

	it("reports a failed lazy initialization instead of rejecting", async () => {
		const { notices, errors, ui } = createUi();

		await expect(
			runTokenizerSmoke(
				() => ({
					isInitialized: () => false,
					tokenize: () =>
						Promise.reject(
							new Error("WebAssembly.instantiate is unavailable."),
						),
				}),
				ui,
			),
		).resolves.toBeUndefined();

		// The loading notice is shown first, then the failure. Nothing falls
		// back to a simpler analyzer.
		expect(notices).toEqual([
			"Loading tokenizer\u2026",
			"Tokenizer failed. See the developer console.",
		]);
		expect((errors[0] as Error).message).toBe(
			"WebAssembly.instantiate is unavailable.",
		);
	});

	it("does not show a loading notice when dictionary path resolution fails", async () => {
		const { notices, ui } = createUi();

		await runTokenizerSmoke(() => {
			throw new Error("Plugin directory is unavailable");
		}, ui);

		expect(notices).not.toContain("Loading tokenizer…");
		expect(notices).toEqual(["Tokenizer failed. See the developer console."]);
	});

	it("still reports tokenize failures after a tokenizer has been created", async () => {
		const { notices, errors, ui } = createUi();
		const tokenizer: TokenizerSmokeHost = {
			isInitialized: () => true,
			tokenize: async () => {
				throw new Error("analysis failed");
			},
		};

		await expect(runTokenizerSmoke(() => tokenizer, ui)).resolves.toBeUndefined();

		expect(notices).toEqual(["Tokenizer failed. See the developer console."]);
		expect((errors[0] as Error).message).toBe("analysis failed");
	});
});

describe("runTokenizerSmoke success path", () => {
	it("tokenizes the fixed smoke text and logs the token column for developers", async () => {
		const { notices, debugs, ui } = createUi();
		const tokenizer: TokenizerSmokeHost = {
			isInitialized: () => true,
			tokenize: async (text) => {
				expect(text).toBe(TOKENIZER_SMOKE_TEXT);
				return [
					token({ surface: "太郎", pos: "名詞", detail1: "固有名詞" }),
					token({ surface: "は", pos: "助詞", detail1: "係助詞" }),
					token({ surface: "駅", pos: "名詞", detail1: "一般" }),
				];
			},
		};

		await expect(runTokenizerSmoke(() => tokenizer, ui)).resolves.toBeUndefined();

		expect(notices).toEqual(["Tokenizer OK: 3 tokens, 2 nouns."]);
		expect(debugs[0]).toEqual([
			{ surface: "太郎", pos: "名詞", detail1: "固有名詞" },
			{ surface: "は", pos: "助詞", detail1: "係助詞" },
			{ surface: "駅", pos: "名詞", detail1: "一般" },
		]);
	});
});
