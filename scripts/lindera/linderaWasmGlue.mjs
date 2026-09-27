import { readFile } from "node:fs/promises";
import { linderaWasmGluePath } from "./linderaSource.mjs";

/**
 * wasm-pack's `web` target ships one loader that can also reach the network:
 * `__wbg_init` resolves an undefined argument to
 * `new URL('lindera_wasm_bg.wasm', import.meta.url)` and hands it to `fetch`,
 * and `__wbg_load` can call `WebAssembly.instantiateStreaming` on a `Response`.
 * The plugin never takes either path — it always passes bytes — but leaving
 * that code in the bundle would leave a `fetch` call and an `import.meta` in a
 * file that is supposed to have neither.
 *
 * So the loader is replaced at build time. Everything above `__wbg_load` (the
 * bindings, `__wbg_get_imports`, `__wbg_finalize_init`) is kept verbatim; the
 * loader block from `__wbg_load` to the end of the file is swapped for a
 * bytes-only initializer with the same call signature. The markers below are
 * matched exactly, so a lindera-wasm upgrade that moves this code fails the
 * build instead of silently shipping the fetching loader.
 */
export const GLUE_SPLIT_MARKER = "\nasync function __wbg_load(module, imports) {\n";
export const GLUE_TAIL_MARKER = "\nexport { initSync, __wbg_init as default };\n";

const REPLACEMENT_LOADER = `
/**
 * Replaces wasm-pack's network-capable loader (see
 * scripts/lindera/linderaWasmGlue.mjs). The module is compiled from bytes the
 * caller already holds. There is no URL form, no streaming form and no
 * fallback that could acquire the module some other way.
 */
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;

    if (module_or_path !== undefined && Object.getPrototypeOf(module_or_path) === Object.prototype) {
        ({module_or_path} = module_or_path);
    }
    if (module_or_path === undefined) {
        throw new Error("Lindera WebAssembly must be initialized with the embedded module bytes.");
    }

    const imports = __wbg_get_imports();
    const { instance, module } = await WebAssembly.instantiate(module_or_path, imports);
    return __wbg_finalize_init(instance, module);
}

export { __wbg_init as default };
`;

/**
 * Rewrites the shipped glue into its bytes-only form. Pure over the source
 * text, so two builds from the same installed package produce identical
 * output.
 */
export function rewriteLinderaWasmGlue(source) {
	const splitAt = source.indexOf(GLUE_SPLIT_MARKER);
	if (splitAt < 0 || source.indexOf(GLUE_SPLIT_MARKER, splitAt + 1) >= 0) {
		throw new Error(
			"lindera-wasm's loader could not be located exactly once; the pinned 6.0.0 glue is expected. Refusing to bundle a loader that can fetch.",
		);
	}
	if (!source.endsWith(GLUE_TAIL_MARKER)) {
		throw new Error(
			"lindera-wasm's glue does not end with the expected export line; the pinned 6.0.0 glue is expected.",
		);
	}

	const kept = source.slice(0, splitAt);
	const rewritten = kept + REPLACEMENT_LOADER;
	// The replacement exists to remove exactly these; assert it rather than
	// assume the marker split covered every occurrence.
	for (const forbidden of [
		"fetch(",
		"import.meta",
		"instantiateStreaming",
		"Response",
	]) {
		if (rewritten.includes(forbidden)) {
			throw new Error(
				`The rewritten lindera-wasm glue still contains "${forbidden}".`,
			);
		}
	}
	return rewritten;
}

export async function readRewrittenLinderaWasmGlue(rootDir) {
	return rewriteLinderaWasmGlue(
		await readFile(linderaWasmGluePath(rootDir), "utf8"),
	);
}
