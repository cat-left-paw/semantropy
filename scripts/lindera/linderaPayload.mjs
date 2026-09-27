import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
	LINDERA_DICTIONARY_FILE_NAMES,
	LINDERA_NOTICE_FILE_NAME,
	assertDictionaryDir,
	linderaWasmPath,
} from "./linderaSource.mjs";
import { readRewrittenLinderaWasmGlue } from "./linderaWasmGlue.mjs";

export const LINDERA_WASM_MODULE_ID = "virtual:semantropy-lindera-wasm";
export const LINDERA_PAYLOAD_MODULE_ID = "virtual:semantropy-lindera-payload";

/**
 * Fixed compression settings. gzip level 9 with no mtime and no OS byte keeps
 * the payload a pure function of the input bytes, which is what makes two
 * builds byte-identical.
 */
const GZIP_OPTIONS = { level: 9, mtime: 0 };

function compress(bytes) {
	return gzipSync(bytes, GZIP_OPTIONS);
}

function encodeEntry(key, base64) {
	return `\t${JSON.stringify(key)}: ${JSON.stringify(base64)},\n`;
}

/**
 * Reads the WASM module and the nine compact dictionary files, gzips each one
 * and wraps it in base64.
 *
 * Nothing is inflated here and nothing is inflated at load time: the payload
 * stays compressed inside `main.js` until the first tokenize request. The
 * generated module depends on the input bytes alone — no paths, no
 * timestamps, no machine identity — so it is reproducible.
 */
export async function generateLinderaPayloadModule(rootDir, dictionaryDir) {
	await assertDictionaryDir(dictionaryDir, dictionaryDir, [
		...LINDERA_DICTIONARY_FILE_NAMES,
		LINDERA_NOTICE_FILE_NAME,
	]);

	const wasm = await readFile(linderaWasmPath(rootDir));
	const wasmGzip = compress(wasm);

	let dictionaryBody = "";
	const measurements = [];
	for (const fileName of LINDERA_DICTIONARY_FILE_NAMES) {
		const bytes = await readFile(path.join(dictionaryDir, fileName));
		const gzip = compress(bytes);
		dictionaryBody += encodeEntry(fileName, gzip.toString("base64"));
		measurements.push({
			fileName,
			bytes: bytes.byteLength,
			gzipBytes: gzip.byteLength,
		});
	}

	const source =
		"// Generated at build time from the pinned lindera-wasm module and the\n" +
		"// Semantropy-compact Lindera IPADIC. Values are base64 of gzip; nothing\n" +
		"// is inflated here.\n" +
		"export const LINDERA_WASM_GZIP_BASE64 = " +
		JSON.stringify(wasmGzip.toString("base64")) +
		";\n" +
		"export const LINDERA_DICTIONARY_GZIP_BASE64 = Object.freeze({\n" +
		dictionaryBody +
		"});\n";

	return {
		source,
		wasm: { bytes: wasm.byteLength, gzipBytes: wasmGzip.byteLength },
		dictionary: measurements,
	};
}

/**
 * Serves the rewritten wasm-pack glue and the generated payload as virtual
 * modules, so neither the rewritten glue nor the base64 ever lands on disk or
 * in Git.
 */
export function linderaPayloadPlugin(rootDir, dictionaryDir) {
	const NAMESPACE = "semantropy-lindera";
	return {
		name: NAMESPACE,
		setup(build) {
			build.onResolve(
				{ filter: /^virtual:semantropy-lindera-(wasm|payload)$/ },
				(args) => ({ path: args.path, namespace: NAMESPACE }),
			);
			build.onLoad({ filter: /.*/, namespace: NAMESPACE }, async (args) => {
				if (args.path === LINDERA_WASM_MODULE_ID) {
					return {
						contents: await readRewrittenLinderaWasmGlue(rootDir),
						loader: "js",
						resolveDir: path.dirname(
							path.join(rootDir, "node_modules", "lindera-wasm", "x"),
						),
					};
				}
				const generated = await generateLinderaPayloadModule(
					rootDir,
					dictionaryDir,
				);
				return { contents: generated.source, loader: "js" };
			});
		},
	};
}
