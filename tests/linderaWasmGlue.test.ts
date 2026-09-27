import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	GLUE_SPLIT_MARKER,
	GLUE_TAIL_MARKER,
	rewriteLinderaWasmGlue,
} from "../scripts/lindera/linderaWasmGlue.mjs";
import { linderaWasmGluePath } from "../scripts/lindera/linderaSource.mjs";

const installedGlue = readFileSync(
	linderaWasmGluePath(process.cwd()),
	"utf8",
);

describe("lindera-wasm glue rewrite", () => {
	it("removes every route the loader could take to acquire the module itself", () => {
		const rewritten = rewriteLinderaWasmGlue(installedGlue);

		// The shipped glue really does contain these; the point of the rewrite
		// is that the bundled copy does not.
		expect(installedGlue).toContain("fetch(");
		expect(installedGlue).toContain("import.meta");
		expect(installedGlue).toContain("instantiateStreaming");

		expect(rewritten).not.toContain("fetch(");
		expect(rewritten).not.toContain("import.meta");
		expect(rewritten).not.toContain("instantiateStreaming");
		expect(rewritten).not.toContain("XMLHttpRequest");
	});

	it("keeps the bindings and the imports table untouched", () => {
		const rewritten = rewriteLinderaWasmGlue(installedGlue);
		const kept = installedGlue.slice(
			0,
			installedGlue.indexOf(GLUE_SPLIT_MARKER),
		);
		expect(rewritten.startsWith(kept)).toBe(true);
		expect(rewritten).toContain("function __wbg_get_imports()");
		expect(rewritten).toContain("function __wbg_finalize_init(");
		expect(rewritten).toContain("export function loadDictionaryFromBytes(");
		expect(rewritten).toContain("export class TokenizerBuilder");
	});

	it("exports a default initializer that instantiates from bytes", () => {
		const rewritten = rewriteLinderaWasmGlue(installedGlue);
		expect(rewritten).toContain("WebAssembly.instantiate(module_or_path");
		expect(rewritten.trimEnd().endsWith("export { __wbg_init as default };")).toBe(
			true,
		);
	});

	it("is deterministic", () => {
		expect(rewriteLinderaWasmGlue(installedGlue)).toBe(
			rewriteLinderaWasmGlue(installedGlue),
		);
	});

	it("refuses to bundle glue whose loader it cannot locate", () => {
		const moved = installedGlue.replace(GLUE_SPLIT_MARKER, "\nasync function __wbg_load2(module, imports) {\n");
		expect(() => rewriteLinderaWasmGlue(moved)).toThrow(
			/could not be located exactly once/,
		);
	});

	it("refuses glue that does not end with the expected export line", () => {
		expect(() =>
			rewriteLinderaWasmGlue(`${installedGlue}export const extra = 1;\n`),
		).toThrow(/does not end with the expected export line/);
		expect(installedGlue.endsWith(GLUE_TAIL_MARKER)).toBe(true);
	});
});
