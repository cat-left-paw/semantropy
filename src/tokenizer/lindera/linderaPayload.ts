/**
 * The nine Lindera IPADIC files, in the order `loadDictionaryFromBytes`
 * takes them. The order is part of the artifact contract: it keeps the
 * generated payload module byte-identical across builds from the same
 * dictionary, and it is the order the runtime hands the buffers back in.
 */
export const LINDERA_DICTIONARY_FILE_NAMES = [
	"metadata.json",
	"dict.trie",
	"dict.valsidx",
	"dict.vals",
	"dict.wordsidx",
	"dict.words",
	"matrix.mtx",
	"char_def.bin",
	"unk.bin",
] as const;

export type LinderaDictionaryFileName =
	(typeof LINDERA_DICTIONARY_FILE_NAMES)[number];

/** Base64 of the gzip bytes. Nothing is inflated until a tokenize request. */
export type LinderaDictionaryPayload = Readonly<
	Record<LinderaDictionaryFileName, string>
>;

export function findMissingDictionaryEntries(
	payload: Partial<Record<string, string>>,
): LinderaDictionaryFileName[] {
	return LINDERA_DICTIONARY_FILE_NAMES.filter((fileName) => {
		const encoded = payload[fileName];
		return typeof encoded !== "string" || encoded.length === 0;
	});
}

export function assertLinderaDictionaryPayload(
	payload: Partial<Record<string, string>>,
): void {
	const missing = findMissingDictionaryEntries(payload);
	if (missing.length > 0) {
		throw new Error(
			`Embedded Lindera dictionary payload is incomplete: missing ${missing.join(", ")}.`,
		);
	}
}

export function assertLinderaWasmPayload(encoded: unknown): void {
	if (typeof encoded !== "string" || encoded.length === 0) {
		throw new Error("Embedded Lindera WebAssembly payload is missing.");
	}
}
