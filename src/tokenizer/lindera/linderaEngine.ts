import initLinderaWasm, {
	Tokenizer,
	loadDictionaryFromBytes,
	type Dictionary,
} from "virtual:semantropy-lindera-wasm";
import type { JapaneseToken } from "../JapaneseTokenizer";
import { LazyTokenizer } from "../lazyTokenizer";
import {
	inflatePayloadEntry,
	type PayloadBytes,
	type PayloadCodec,
} from "./inflatePayload";
import {
	LINDERA_DICTIONARY_FILE_NAMES,
	assertLinderaDictionaryPayload,
	assertLinderaWasmPayload,
	type LinderaDictionaryPayload,
} from "./linderaPayload";
import {
	toJapaneseTokensFromLindera,
	type LinderaRawToken,
} from "./linderaToken";

/** The whole embedded payload: the WASM module plus the nine dictionary files. */
export type LinderaPayload = {
	wasm: string;
	dictionary: LinderaDictionaryPayload;
};

/**
 * The Lindera segmentation mode Semantropy uses. `"normal"` is the standard
 * dictionary-cost segmentation; `"decompose"` would split compounds and change
 * which nouns become exchangeable slots, so it is not a runtime option.
 */
export const LINDERA_TOKENIZER_MODE = "normal";

/**
 * A WebAssembly-backed object this adapter has to release by hand. Both of
 * Lindera's are structurally this, and Lindera-specific classes stop here:
 * `LinderaTokenizer` hands the application, transform and view layers plain
 * `JapaneseToken` values and nothing else.
 */
type WasmHandle = {
	free(): void;
};

type LinderaDictionaryHandle = WasmHandle;

type LinderaTokenizerHandle = WasmHandle & {
	tokenize(text: string): unknown[];
};

/**
 * The three WebAssembly-side calls the engine build makes, in one place so a
 * test can observe ownership and release without a real WASM module. The
 * production value is `EMBEDDED_LINDERA_RUNTIME` below, which is the only one
 * any bundle contains.
 */
export type LinderaRuntime = {
	initWasm(bytes: PayloadBytes): Promise<unknown>;
	loadDictionary(files: PayloadBytes[]): LinderaDictionaryHandle;
	/**
	 * Constructs the tokenizer. Ownership of `dictionary` moves into the
	 * returned tokenizer when this succeeds, so the caller must not release
	 * the dictionary afterwards.
	 */
	createTokenizer(dictionary: LinderaDictionaryHandle): LinderaTokenizerHandle;
};

export const EMBEDDED_LINDERA_RUNTIME: LinderaRuntime = {
	initWasm: (bytes) => initLinderaWasm({ module_or_path: bytes }),
	loadDictionary: (files) => {
		const [
			metadata,
			trie,
			valsIdx,
			vals,
			wordsIdx,
			words,
			matrix,
			charDef,
			unk,
		] = files as [
			PayloadBytes,
			PayloadBytes,
			PayloadBytes,
			PayloadBytes,
			PayloadBytes,
			PayloadBytes,
			PayloadBytes,
			PayloadBytes,
			PayloadBytes,
		];
		return loadDictionaryFromBytes(
			metadata,
			trie,
			valsIdx,
			vals,
			wordsIdx,
			words,
			matrix,
			charDef,
			unk,
		);
	},
	// The tokenizer is constructed directly rather than through
	// `TokenizerBuilder`. In lindera-wasm 6.0.0 a builder-built tokenizer does
	// not release the dictionary it consumed — neither `Tokenizer.free()` nor
	// `TokenizerBuilder.free()` returns that linear memory — so every rebuild
	// inside one module instance grows WebAssembly memory again. Constructing
	// `Tokenizer` directly releases it, measured at zero growth per rebuild.
	createTokenizer: (dictionary) =>
		// The handle is the `Dictionary` this module's `loadDictionary` just
		// returned; the local handle type is what keeps Lindera's classes from
		// leaking past this file, so the cast restores it for this one call.
		new Tokenizer(
			dictionary as unknown as Dictionary,
			LINDERA_TOKENIZER_MODE,
			undefined,
		),
};

export type LinderaEngine = {
	tokenize(text: string): JapaneseToken[];
	free(): void;
};

export type LinderaEngineOptions = {
	codec?: PayloadCodec;
	runtime?: LinderaRuntime;
};

function asRawToken(value: unknown): LinderaRawToken {
	const token = value as {
		surface?: unknown;
		isUnknown?: unknown;
		details?: unknown;
		byteStart?: unknown;
		byteEnd?: unknown;
	};
	return {
		surface: typeof token.surface === "string" ? token.surface : "",
		isUnknown: token.isUnknown === true,
		details: Array.isArray(token.details)
			? (token.details as unknown[]).map((entry) =>
					typeof entry === "string" ? entry : "*",
				)
			: [],
		byteStart: typeof token.byteStart === "number" ? token.byteStart : 0,
		byteEnd: typeof token.byteEnd === "number" ? token.byteEnd : 0,
	};
}

/**
 * Releases a handle this adapter still owns, and does nothing for one it does
 * not.
 *
 * `Tokenizer`'s constructor takes the dictionary by value: wasm-bindgen zeroes
 * the dictionary wrapper's pointer as its first step and hands the allocation
 * to Rust. So after the constructor has been entered — whether it then returns
 * or throws — the dictionary wrapper no longer owns anything, and calling
 * `free()` on it would be a second release of memory this side does not hold.
 * A zeroed pointer is therefore the signal to leave the handle alone. If the
 * constructor rejected its argument before that point, the pointer is still
 * live and the handle is released here.
 *
 * The `free()` call is guarded as well: releasing what is already released
 * must never turn a build failure into a different, more confusing one.
 */
function releaseHandle(handle: WasmHandle | null): void {
	if (!handle) {
		return;
	}
	const pointer = (handle as { __wbg_ptr?: unknown }).__wbg_ptr;
	if (pointer === 0) {
		return;
	}
	try {
		handle.free();
	} catch {
		// Already released, or never held anything: nothing left to do.
	}
}

/**
 * Builds a Lindera engine entirely from the bundled payload.
 *
 * The whole path is self-contained: base64 decode, gzip inflate, WebAssembly
 * instantiation from those bytes, `loadDictionaryFromBytes`, then
 * `new Tokenizer(dictionary, mode, undefined)`. There is no `fetch`, no OPFS,
 * no `XMLHttpRequest`, no Node `fs`, no Vault adapter, no `getResourcePath`,
 * no external URL fallback, and no substitute tokenizer to fall back to: if
 * any step fails, the failure is reported.
 *
 * Ownership is explicit throughout. The dictionary belongs to this function
 * until the tokenizer constructor takes it; the tokenizer then belongs to the
 * returned engine, whose `free` is idempotent. Anything this function still
 * owns when it fails is released before the error propagates.
 */
export async function buildLinderaEngine(
	payload: LinderaPayload,
	options: LinderaEngineOptions = {},
): Promise<LinderaEngine> {
	const codec = options.codec ?? {};
	const runtime = options.runtime ?? EMBEDDED_LINDERA_RUNTIME;

	assertLinderaWasmPayload(payload.wasm);
	assertLinderaDictionaryPayload(payload.dictionary);

	// The WASM module is instantiated from bytes the caller already holds.
	// `initWasm` is a no-op once the module is live, so several tokenizers in
	// one bundle share a single compiled module.
	await runtime.initWasm(
		await inflatePayloadEntry(payload.wasm, "lindera_wasm_bg.wasm", codec),
	);

	const files: PayloadBytes[] = [];
	for (const fileName of LINDERA_DICTIONARY_FILE_NAMES) {
		files.push(
			await inflatePayloadEntry(payload.dictionary[fileName], fileName, codec),
		);
	}

	let dictionary: LinderaDictionaryHandle | null = runtime.loadDictionary(files);
	let tokenizer: LinderaTokenizerHandle | null = null;
	try {
		tokenizer = runtime.createTokenizer(dictionary);
		// The constructor consumed it; from here the tokenizer owns it.
		dictionary = null;
		return createEngine(tokenizer);
	} catch (error) {
		releaseHandle(tokenizer);
		throw error;
	} finally {
		// Reached with a live handle only when the tokenizer was never
		// constructed, so this releases the dictionary exactly once.
		releaseHandle(dictionary);
	}
}

/** Wraps the tokenizer handle so `free` can be called more than once safely. */
function createEngine(tokenizer: LinderaTokenizerHandle): LinderaEngine {
	let released = false;
	return {
		tokenize: (text) =>
			toJapaneseTokensFromLindera(
				text,
				tokenizer.tokenize(text).map(asRawToken),
			),
		free: () => {
			if (released) {
				return;
			}
			released = true;
			releaseHandle(tokenizer);
		},
	};
}

/**
 * The Semantropy tokenizer. The engine is built once, lazily, from the
 * payload embedded in `main.js`:
 *
 *   - nothing is decoded, inflated or instantiated until the first tokenize
 *     request;
 *   - concurrent first requests share one build;
 *   - a failed build is not cached, so the next request retries;
 *   - a build that finishes after `dispose` is released rather than adopted;
 *   - `dispose` releases the WebAssembly-side tokenizer, and does so once.
 */
export class LinderaTokenizer extends LazyTokenizer<LinderaEngine> {
	constructor(payload: LinderaPayload, options: LinderaEngineOptions = {}) {
		super(
			() => buildLinderaEngine(payload, options),
			(engine, text) => engine.tokenize(text),
			(engine) => {
				engine.free();
			},
		);
	}
}
