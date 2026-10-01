/**
 * The web build's analysis thread. It fetches the engine pack from the page's
 * own origin once, checks its SHA-256 against the value the build pinned, and
 * builds the same Lindera engine the Obsidian plugin builds — through the same
 * `buildLinderaEngine`, the same bytes-only WebAssembly glue and the same token
 * conversion. Only the source of the compressed bytes differs.
 *
 * Messages carry note text in and plain `JapaneseToken` values out. Errors are
 * fixed strings; neither the text nor a token is ever logged.
 */
import { buildLinderaEngine, type LinderaEngine } from "../../../src/tokenizer/lindera/linderaEngine";
import { LINDERA_DICTIONARY_FILE_NAMES } from "../../../src/tokenizer/lindera/linderaPayload";
import { ENGINE_WASM_MEMBER, EnginePackError, verifyEnginePack, type EnginePackInfo } from "./enginePack";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

/** The two Worker-scope members this file uses; the DOM and WebWorker libs cannot share one program. */
const scope = self as unknown as {
	postMessage(message: WorkerResponse): void;
	addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
	location: Location;
};

const LOAD_ERROR = "The analysis engine could not be loaded.";
const TOKENIZE_ERROR = "The text could not be analyzed.";

let engine: Promise<LinderaEngine> | null = null;

function post(message: WorkerResponse): void {
	scope.postMessage(message);
}

async function fetchPack(info: EnginePackInfo): Promise<Uint8Array<ArrayBuffer>> {
	const response = await fetch(new URL(info.url, scope.location.href), { credentials: "same-origin" });
	if (!response.ok || !response.body) throw new EnginePackError(LOAD_ERROR);
	const total = info.bytes;
	const buffer = new Uint8Array(new ArrayBuffer(total));
	const reader = response.body.getReader();
	let loaded = 0;
	let lastReport = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		if (loaded + value.byteLength > total) throw new EnginePackError(LOAD_ERROR);
		buffer.set(value, loaded);
		loaded += value.byteLength;
		if (loaded - lastReport >= 256 * 1024 || loaded === total) {
			lastReport = loaded;
			post({ type: "progress", loaded, total });
		}
	}
	if (loaded !== total) throw new EnginePackError(LOAD_ERROR);
	return buffer;
}

async function buildEngine(info: EnginePackInfo): Promise<LinderaEngine> {
	const members = await verifyEnginePack(await fetchPack(info), info.sha256);
	const keys = [ENGINE_WASM_MEMBER, ...LINDERA_DICTIONARY_FILE_NAMES];
	if (keys.some((key) => !members.has(key))) throw new EnginePackError(LOAD_ERROR);
	// The payload names each member by key; the codec hands `buildLinderaEngine`
	// that member's gzip bytes, and its own inflate step does the rest.
	return buildLinderaEngine(
		{
			wasm: ENGINE_WASM_MEMBER,
			dictionary: Object.fromEntries(LINDERA_DICTIONARY_FILE_NAMES.map((name) => [name, name])) as Record<(typeof LINDERA_DICTIONARY_FILE_NAMES)[number], string>,
		},
		{ codec: { decode: (key) => members.get(key)! } },
	);
}

function obtainEngine(info: EnginePackInfo): Promise<LinderaEngine> {
	if (!engine) {
		engine = buildEngine(info).then(
			(built) => {
				post({ type: "ready" });
				return built;
			},
			(error: unknown) => {
				// A failed load is not cached: the next request tries again.
				engine = null;
				throw error;
			},
		);
	}
	return engine;
}

scope.addEventListener("message", (event) => {
	const request = event.data;
	if (request.type === "warm") {
		obtainEngine(request.pack).catch(() => post({ type: "error", id: null, message: LOAD_ERROR }));
		return;
	}
	if (request.type === "tokenize") {
		const { id, text, pack } = request;
		obtainEngine(pack).then(
			(ready) => {
				let tokens;
				try {
					tokens = ready.tokenize(text);
				} catch {
					post({ type: "error", id, message: TOKENIZE_ERROR });
					return;
				}
				post({ type: "result", id, tokens });
			},
			() => post({ type: "error", id, message: LOAD_ERROR }),
		);
	}
});
