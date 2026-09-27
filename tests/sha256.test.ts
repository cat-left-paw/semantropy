import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/vocabulary/sha256";

describe("pure synchronous SHA-256", () => {
	it("matches standard ASCII and UTF-8 vectors", () => {
		expect(sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		expect(sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
		expect(
			sha256Hex(
				"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
			),
		).toBe(
			"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
		);
		expect(sha256Hex("日本語の本文\n空行のあと  空白。\n")).toBe(
			"c1cec59fd5b7b0c553941db904e551e890528fc0082b501eadb7477a547cc2c6",
		);
	});
});
