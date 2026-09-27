export declare const VERIFIED_DICTIONARY_FILE_NAMES: readonly string[];
export declare const FULL_DICTIONARY_SHA256: Readonly<Record<string, string>>;
export declare const COMPACT_DICTIONARY_SHA256: Readonly<Record<string, string>>;
export declare const REWRITTEN_FILE_NAMES: readonly string[];
export declare function measureDictionaryHashes(
	dir: string,
): Promise<Record<string, string>>;
export declare function assertDictionaryHashes(
	dir: string,
	expected: Readonly<Record<string, string>>,
	label: string,
): Promise<Record<string, string>>;
