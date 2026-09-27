import {
	LINDERA_DICTIONARY_FILE_NAMES,
	type LinderaDictionaryPayload,
} from "../../src/tokenizer/lindera/linderaPayload";

/**
 * Stands in for `virtual:semantropy-lindera-payload` under Vitest.
 *
 * The real module is generated during a build from the pinned WebAssembly
 * module and the prepared compact dictionary, so it exists only inside a
 * bundle. Unit tests that need `src/main.ts` to resolve — which entry point is
 * shipped, which tokenizer it constructs, when that tokenizer initializes —
 * get this instead.
 *
 * The values are the right shape and deliberately not real gzip: nothing here
 * can be inflated, so a test that accidentally reached the decode path would
 * fail rather than quietly tokenize against a stub dictionary. Tests that need
 * real analysis build their own payload or run against the built artifact.
 */
const PLACEHOLDER = "c2VtYW50cm9weS10ZXN0LXBsYWNlaG9sZGVy";

export const LINDERA_WASM_GZIP_BASE64 = PLACEHOLDER;

export const LINDERA_DICTIONARY_GZIP_BASE64: LinderaDictionaryPayload =
	Object.freeze(
		Object.fromEntries(
			LINDERA_DICTIONARY_FILE_NAMES.map((fileName) => [
				fileName,
				PLACEHOLDER,
			]),
		) as Record<(typeof LINDERA_DICTIONARY_FILE_NAMES)[number], string>,
	);
