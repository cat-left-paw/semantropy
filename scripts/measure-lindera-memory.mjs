import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
	LINDERA_DICTIONARY_FILE_NAMES,
	linderaCompactDictionaryDir,
	linderaWasmPath,
} from "./lindera/linderaSource.mjs";
import { readRewrittenLinderaWasmGlue } from "./lindera/linderaWasmGlue.mjs";

/**
 * Measures what a Lindera tokenizer costs in WebAssembly linear memory, and
 * what a second one costs on top of it.
 *
 * lindera-wasm 6.0.0 does not release the dictionary a `TokenizerBuilder`
 * consumed: neither `Tokenizer.free()` nor `TokenizerBuilder.free()` returns
 * that memory, so each rebuild inside one module instance grows linear memory
 * again. Building through `new Tokenizer(dictionary, mode)` does release it.
 * Both are measured here, so the reason the product build constructs
 * `Tokenizer` directly is a recorded measurement rather than a claim.
 *
 * Loading a dictionary and freeing it directly is measured too, which is what
 * isolates the leak to the builder path rather than to the dictionary.
 *
 * The rewritten glue is imported from a data: URL so this runs the same
 * bytes-only loader the artifact ships, without a bundler.
 */
const ROUNDS = 3;

function megabytes(bytes) {
	return Number((bytes / 1_048_576).toFixed(1));
}

async function main() {
	const rootDir = process.argv[2] ?? process.cwd();
	const dictionaryDir = linderaCompactDictionaryDir(rootDir);

	const glue = await readRewrittenLinderaWasmGlue(rootDir);
	// eslint-disable-next-line no-unsanitized/method -- the imported text is the glue this repository just read from node_modules and rewrote itself, so no external or user-supplied input reaches it; importing it here rather than writing it to disk keeps the generated module out of the working tree
	const module = await import(
		`data:text/javascript;base64,${Buffer.from(glue, "utf8").toString("base64")}`
	);
	const init = module.default;
	const { Tokenizer, TokenizerBuilder, loadDictionaryFromBytes } = module;

	const exports = await init({
		module_or_path: new Uint8Array(await readFile(linderaWasmPath(rootDir))),
	});
	const wasmMemoryBytes = () => exports.memory.buffer.byteLength;
	const buffers = [];
	for (const fileName of LINDERA_DICTIONARY_FILE_NAMES) {
		buffers.push(await readFile(path.join(dictionaryDir, fileName)));
	}
	const loadDictionary = () =>
		loadDictionaryFromBytes(...buffers.map((buffer) => new Uint8Array(buffer)));

	const afterInitBytes = wasmMemoryBytes();

	const record = (label, build) => {
		const series = [];
		for (let round = 0; round < ROUNDS; round += 1) {
			build();
			series.push(wasmMemoryBytes());
		}
		return {
			label,
			wasmMemoryAfterEachRoundBytes: series,
			wasmMemoryAfterEachRoundMb: series.map(megabytes),
			firstBuildBytes: series[0] - afterInitBytes,
			growthPerExtraBuildBytes:
				series.length > 1
					? Math.round((series.at(-1) - series[0]) / (series.length - 1))
					: 0,
		};
	};

	const dictionaryOnly = record("loadDictionaryFromBytes + free", () => {
		const dictionary = loadDictionary();
		dictionary.free();
	});

	const constructorPath = record("new Tokenizer(dictionary) + free", () => {
		const tokenizer = new Tokenizer(loadDictionary(), "normal", undefined);
		tokenizer.tokenize("太郎は駅で花子を待っていた。");
		tokenizer.free();
	});

	const builderPath = record("TokenizerBuilder().build() + free", () => {
		const builder = new TokenizerBuilder();
		builder.setDictionaryInstance(loadDictionary());
		builder.setMode("normal");
		const tokenizer = builder.build();
		tokenizer.tokenize("太郎は駅で花子を待っていた。");
		tokenizer.free();
		builder.free();
	});

	process.stdout.write(
		JSON.stringify({
			rounds: ROUNDS,
			wasmMemoryAfterInitBytes: afterInitBytes,
			wasmMemoryAfterInitMb: megabytes(afterInitBytes),
			dictionaryOnly,
			constructorPath,
			builderPath,
			note:
				"Measured within one module instance, which is the whole scope of this measurement. Only the builder path grows linear memory on every rebuild; that is why the product build constructs Tokenizer directly. What Obsidian's plugin unload does to the JavaScript module and the WebAssembly instance is not established here, and has not been established elsewhere either. The direct-constructor path does not depend on it: its growth per rebuild inside a surviving module instance is zero.",
			processRssBytes: process.memoryUsage().rss,
		}),
	);
}

main().catch((error) => {
	process.stderr.write(String(error instanceof Error ? error.stack : error));
	process.exitCode = 1;
});
