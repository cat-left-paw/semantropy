/**
 * Rewritten at build time by `scripts/lindera/linderaWasmGlue.mjs`. The module
 * is lindera-wasm 6.0.0's own wasm-bindgen glue with its network-capable
 * loader replaced by a bytes-only initializer; every other export is
 * unchanged, so the upstream types apply verbatim.
 */
declare module "virtual:semantropy-lindera-wasm" {
	export * from "lindera-wasm";
	export { default } from "lindera-wasm";
}

/**
 * Generated at build time by `scripts/lindera/linderaPayload.mjs`. Holds
 * base64 of the gzipped WASM module and of the nine gzipped
 * Semantropy-compact IPADIC files, and is never committed to Git.
 */
declare module "virtual:semantropy-lindera-payload" {
	export const LINDERA_WASM_GZIP_BASE64: string;
	export const LINDERA_DICTIONARY_GZIP_BASE64: import("../tokenizer/lindera/linderaPayload").LinderaDictionaryPayload;
}
