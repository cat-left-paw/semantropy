export type DictionaryPrepareReport = {
 dictionaryPolicy: string;
	linderaWasmVersion: string;
	linderaWasmPackageVerifiedAgainstPinnedHashes: boolean;
	verifiedAgainstPinnedHashes: boolean;
	archive: {
		url: string;
		bytes: number;
		sha256: string;
		reusedCache: boolean;
	};
	extracted: { fileName: string; bytes: number }[];
	fullDictionary: {
		dir: string;
		files: { fileName: string; bytes: number; sha256: string }[];
		totalBytes: number;
	};
	compactDictionary: {
		dir: string;
		verifiedAgainstPinnedHashes: boolean;
		entryCount: number;
		targetNounCount: number;
		files: { fileName: string; bytes: number }[];
		totalBytes: number;
	};
};

export declare function prepareDictionary(options?: {
	rootDir?: string;
	allowDownload?: boolean;
	/** For tests: serves the archive without a network. Production leaves it unset. */
	fetchImpl?: typeof fetch;
	/** For tests: injects a failure into the moves that publish the cache. */
	renameImpl?: (from: string, to: string) => Promise<void>;
}): Promise<DictionaryPrepareReport>;
