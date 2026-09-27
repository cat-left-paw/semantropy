import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	LINDERA_TOKENIZER_MODE,
	LinderaTokenizer,
	buildLinderaEngine,
	type LinderaPayload,
	type LinderaRuntime,
} from "../src/tokenizer/lindera/linderaEngine";
import { LINDERA_DICTIONARY_FILE_NAMES } from "../src/tokenizer/lindera/linderaPayload";
import type { PayloadBytes } from "../src/tokenizer/lindera/inflatePayload";

const rootDir = process.cwd();

const PAYLOAD: LinderaPayload = {
	wasm: "d2FzbQ==",
	dictionary: Object.fromEntries(
		LINDERA_DICTIONARY_FILE_NAMES.map((fileName) => [fileName, "ZGF0YQ=="]),
	) as LinderaPayload["dictionary"],
};

/**
 * A codec that records every decode and inflate, so "nothing is touched until
 * the first tokenize request" is observable rather than assumed.
 */
function createCodec() {
	const decoded: string[] = [];
	const inflated: number[] = [];
	return {
		decoded,
		inflated,
		codec: {
			decode: (encoded: string): PayloadBytes => {
				decoded.push(encoded);
				return new Uint8Array([1, 2, 3]);
			},
			inflate: async (compressed: PayloadBytes): Promise<ArrayBuffer> => {
				inflated.push(compressed.length);
				return new ArrayBuffer(4);
			},
		},
	};
}

type FakeHandle = {
	free(): void;
	freeCount: number;
	__wbg_ptr: number;
};

function createHandle(pointer = 1): FakeHandle {
	const handle: FakeHandle = {
		freeCount: 0,
		__wbg_ptr: pointer,
		free() {
			handle.freeCount += 1;
			handle.__wbg_ptr = 0;
		},
	};
	return handle;
}

/**
 * Models lindera-wasm's ownership rules: `new Tokenizer(dictionary, ...)`
 * zeroes the dictionary wrapper's pointer as its first step, moving the
 * allocation into Rust. Everything after that point — including a throw from
 * the constructor body — leaves a spent dictionary handle behind.
 */
function createRuntime(
	options: {
		failAt?: "init" | "dictionary" | "assertClass" | "constructorBody";
		tokens?: unknown[];
	} = {},
) {
	const dictionaries: FakeHandle[] = [];
	const tokenizers: (FakeHandle & { tokenize(text: string): unknown[] })[] = [];
	const modes: (string | undefined)[] = [];

	const runtime: LinderaRuntime = {
		initWasm: async () => {
			if (options.failAt === "init") {
				throw new Error("wasm init failed");
			}
		},
		loadDictionary: () => {
			if (options.failAt === "dictionary") {
				throw new Error("dictionary load failed");
			}
			const handle = createHandle();
			dictionaries.push(handle);
			return handle;
		},
		createTokenizer: (dictionary) => {
			if (options.failAt === "assertClass") {
				// Rejected before ownership moves: the dictionary is still live.
				throw new Error("not a Dictionary");
			}
			(dictionary as unknown as FakeHandle).__wbg_ptr = 0;
			if (options.failAt === "constructorBody") {
				throw new Error("tokenizer_new returned an error");
			}
			modes.push(LINDERA_TOKENIZER_MODE);
			const handle = createHandle() as FakeHandle & {
				tokenize(text: string): unknown[];
			};
			handle.tokenize = () => options.tokens ?? [];
			tokenizers.push(handle);
			return handle;
		},
	};

	return { runtime, dictionaries, tokenizers, modes };
}

describe("the embedded Lindera engine", () => {
	it("touches nothing until the first tokenize request", async () => {
		const { codec, decoded, inflated } = createCodec();
		const { runtime } = createRuntime({ tokens: [] });
		const tokenizer = new LinderaTokenizer(PAYLOAD, { codec, runtime });

		expect(decoded).toEqual([]);
		expect(inflated).toEqual([]);
		expect(tokenizer.isInitialized()).toBe(false);

		await tokenizer.tokenize("駅");

		// The WebAssembly module plus all nine dictionary files, once each.
		expect(decoded).toHaveLength(1 + LINDERA_DICTIONARY_FILE_NAMES.length);
		expect(inflated).toHaveLength(1 + LINDERA_DICTIONARY_FILE_NAMES.length);
		expect(tokenizer.isInitialized()).toBe(true);
	});

	it("builds once for concurrent first requests", async () => {
		const { codec } = createCodec();
		const { runtime, tokenizers } = createRuntime();
		const tokenizer = new LinderaTokenizer(PAYLOAD, { codec, runtime });

		await Promise.all([
			tokenizer.tokenize("駅"),
			tokenizer.tokenize("駅"),
			tokenizer.tokenize("駅"),
		]);

		expect(tokenizers).toHaveLength(1);
	});

	it("retries after a failed build instead of caching the failure", async () => {
		const { codec } = createCodec();
		let attempts = 0;
		const runtime: LinderaRuntime = {
			initWasm: async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new Error("wasm init failed");
				}
			},
			loadDictionary: () => createHandle(),
			createTokenizer: (dictionary) => {
				(dictionary as unknown as FakeHandle).__wbg_ptr = 0;
				const handle = createHandle() as FakeHandle & {
					tokenize(text: string): unknown[];
				};
				handle.tokenize = () => [];
				return handle;
			},
		};
		const tokenizer = new LinderaTokenizer(PAYLOAD, { codec, runtime });

		await expect(tokenizer.tokenize("駅")).rejects.toThrow("wasm init failed");
		expect(tokenizer.isInitialized()).toBe(false);

		const tokens = await tokenizer.tokenize("駅");
		// The fake engine returns nothing, so the whole input comes back as one
		// restored coverage token: the adapter still accounts for every byte.
		expect(tokens.map((token) => token.surface).join("")).toBe("駅");
		expect(attempts).toBe(2);
		expect(tokenizer.isInitialized()).toBe(true);
	});

	it("releases, and does not adopt, an engine that finished after dispose", async () => {
		const { codec } = createCodec();
		const { runtime, tokenizers } = createRuntime();
		let releaseBuild!: () => void;
		// Created up front, so disposing before the build reaches this step
		// still leaves a gate to open.
		const gate = new Promise<void>((resolve) => {
			releaseBuild = () => {
				resolve();
			};
		});
		const gated: LinderaRuntime = { ...runtime, initWasm: () => gate };
		const tokenizer = new LinderaTokenizer(PAYLOAD, {
			codec,
			runtime: gated,
		});

		const pending = tokenizer.tokenize("駅");
		tokenizer.dispose();
		releaseBuild();

		await expect(pending).rejects.toThrow(/disposed during initialization/);
		expect(tokenizer.isInitialized()).toBe(false);
		expect(tokenizers).toHaveLength(1);
		expect(tokenizers[0]?.freeCount).toBe(1);
	});
});

describe("ownership of the WebAssembly handles", () => {
	it("moves the dictionary into the tokenizer and never frees it separately", async () => {
		const { codec } = createCodec();
		const { runtime, dictionaries, tokenizers, modes } = createRuntime();

		const engine = await buildLinderaEngine(PAYLOAD, { codec, runtime });

		expect(modes).toEqual(["normal"]);
		expect(dictionaries).toHaveLength(1);
		// Freeing it here would release memory the tokenizer now owns.
		expect(dictionaries[0]?.freeCount).toBe(0);

		engine.free();
		expect(tokenizers[0]?.freeCount).toBe(1);
	});

	it("frees the tokenizer exactly once however often dispose is called", async () => {
		const { codec } = createCodec();
		const { runtime, tokenizers } = createRuntime();
		const tokenizer = new LinderaTokenizer(PAYLOAD, { codec, runtime });

		await tokenizer.tokenize("駅");
		tokenizer.dispose();
		tokenizer.dispose();
		tokenizer.dispose();

		expect(tokenizers[0]?.freeCount).toBe(1);
	});

	it("frees the dictionary when the tokenizer constructor rejects it outright", async () => {
		const { codec } = createCodec();
		const { runtime, dictionaries } = createRuntime({ failAt: "assertClass" });

		await expect(
			buildLinderaEngine(PAYLOAD, { codec, runtime }),
		).rejects.toThrow("not a Dictionary");

		// Ownership never moved, so this side still had to release it.
		expect(dictionaries[0]?.freeCount).toBe(1);
	});

	it("does not double-free a dictionary the failing constructor already consumed", async () => {
		const { codec } = createCodec();
		const { runtime, dictionaries } = createRuntime({
			failAt: "constructorBody",
		});

		await expect(
			buildLinderaEngine(PAYLOAD, { codec, runtime }),
		).rejects.toThrow("tokenizer_new returned an error");

		expect(dictionaries[0]?.freeCount).toBe(0);
		expect(dictionaries[0]?.__wbg_ptr).toBe(0);
	});

	it("has nothing to release when the dictionary itself fails to load", async () => {
		const { codec } = createCodec();
		const { runtime, dictionaries, tokenizers } = createRuntime({
			failAt: "dictionary",
		});

		await expect(
			buildLinderaEngine(PAYLOAD, { codec, runtime }),
		).rejects.toThrow("dictionary load failed");

		expect(dictionaries).toEqual([]);
		expect(tokenizers).toEqual([]);
	});

	it("refuses an incomplete payload before building anything", async () => {
		const { codec, decoded } = createCodec();
		const { runtime } = createRuntime();
		const incomplete: LinderaPayload = {
			...PAYLOAD,
			dictionary: { ...PAYLOAD.dictionary, "dict.trie": "" },
		};

		await expect(
			buildLinderaEngine(incomplete, { codec, runtime }),
		).rejects.toThrow(/incomplete: missing dict\.trie/);
		expect(decoded).toEqual([]);
	});
});

/**
 * In lindera-wasm 6.0.0 a `TokenizerBuilder`-built tokenizer does not release
 * the dictionary it consumed: neither `Tokenizer.free()` nor
 * `TokenizerBuilder.free()` returns that linear memory, so each rebuild inside
 * one module instance grows WebAssembly memory by roughly the dictionary's
 * size. Constructing `Tokenizer` directly releases it. The product build
 * therefore must not reach the builder at all — including through a helper, a
 * re-export or a string lookup.
 */
describe("the product source never builds a tokenizer through TokenizerBuilder", () => {
	async function readSourceFiles(dir: string): Promise<[string, string][]> {
		const entries = await readdir(dir, { withFileTypes: true });
		const files: [string, string][] = [];
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...(await readSourceFiles(full)));
			} else if (entry.name.endsWith(".ts")) {
				files.push([
					path.relative(rootDir, full),
					await readFile(full, "utf8"),
				]);
			}
		}
		return files;
	}

	it("mentions TokenizerBuilder nowhere in src/ except as the rejected option", async () => {
		const offenders = (await readSourceFiles(path.join(rootDir, "src")))
			.filter(([, content]) => /\bTokenizerBuilder\b/.test(content))
			.filter(([, content]) => {
				// A comment explaining why it is not used is allowed; code is not.
				const withoutComments = content
					.replace(/\/\*[\s\S]*?\*\//g, "")
					.replace(/\/\/.*$/gm, "");
				return /\bTokenizerBuilder\b/.test(withoutComments);
			})
			.map(([file]) => file);

		expect(offenders).toEqual([]);
	});

	it("constructs Tokenizer directly, with the normal mode and no user dictionary", async () => {
		const engine = await readFile(
			path.join(rootDir, "src", "tokenizer", "lindera", "linderaEngine.ts"),
			"utf8",
		);

		// Imported straight from the WASM glue, not through a helper.
		expect(engine).toMatch(
			/import initLinderaWasm, \{[^}]*\bTokenizer\b[^}]*\} from "virtual:semantropy-lindera-wasm";/,
		);
		expect(engine).toMatch(
			/new Tokenizer\(\s*dictionary as unknown as Dictionary,\s*LINDERA_TOKENIZER_MODE,\s*undefined,\s*\)/,
		);
		expect(LINDERA_TOKENIZER_MODE).toBe("normal");
	});
});
