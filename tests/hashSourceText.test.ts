import { describe, expect, it } from "vitest";
import { hashSourceText, type DigestSource } from "../src/application/hashSourceText";

const JAPANESE_FIXTURE = "日本語の本文\n空行のあと  空白。\n";
const JAPANESE_FIXTURE_HASH =
	"c1cec59fd5b7b0c553941db904e551e890528fc0082b501eadb7477a547cc2c6";

describe("hashSourceText", () => {
	it("reproduces SHA-256 for the same Japanese text with newlines", async () => {
		const first = await hashSourceText(JAPANESE_FIXTURE);
		const second = await hashSourceText(JAPANESE_FIXTURE);
		expect(first).toBe(JAPANESE_FIXTURE_HASH);
		expect(second).toBe(first);
		expect(first).toMatch(/^[0-9a-f]{64}$/);
	});

	it("changes when a single character changes", async () => {
		const original = await hashSourceText(JAPANESE_FIXTURE);
		const changed = await hashSourceText("日本語の本文\n空行のあと  空白！\n");
		expect(changed).not.toBe(original);
	});

	it("fails explicitly when Web Crypto digest is unavailable", async () => {
		await expect(
			hashSourceText("text", {} as unknown as DigestSource),
		).rejects.toThrow(/Web Crypto digest is unavailable/);
	});
});
