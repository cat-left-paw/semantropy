export type ArchiveVerification =
	| { ok: true; content: Buffer; bytes: number; sha256: string }
	| {
			ok: false;
			reason: "missing" | "size" | "sha256";
			expected?: string | number;
			actual?: string | number;
	  };

export declare const PREPARE_COMMAND: string;
export declare const DOWNLOAD_TIMEOUT_MS: number;
export declare const LINDERA_WASM_PACKAGE: string;
export declare const LINDERA_WASM_VERSION: string;
export declare const IPADIC_ARCHIVE: {
	name: string;
	url: string;
	bytes: number;
	sha256: string;
	rootEntry: string;
};
export declare const LINDERA_DICTIONARY_FILE_NAMES: readonly string[];
export declare const COMPACTED_FILE_NAMES: readonly string[];
export declare const LINDERA_NOTICE_FILE_NAME: string;

export declare function linderaCacheDir(rootDir: string): string;
export declare function linderaArchivePath(rootDir: string): string;
export declare function linderaFullDictionaryDir(rootDir: string): string;
export declare function linderaCompactDictionaryDir(rootDir: string): string;
export declare function linderaWasmPackageDir(rootDir: string): string;
export declare function linderaWasmPath(rootDir: string): string;
export declare function linderaWasmLicensePath(rootDir: string): string;
export declare function linderaWasmGluePath(rootDir: string): string;
export declare function sha256Hex(buffer: Uint8Array): string;
export declare function verifyArchive(
	archivePath: string,
): Promise<ArchiveVerification>;
export declare function describeArchiveMismatch(result: unknown): string;
export declare function ensureArchive(
	rootDir: string,
	options?: { allowDownload?: boolean; fetchImpl?: typeof fetch },
): Promise<{
	archivePath: string;
	downloaded: boolean;
	content: Buffer;
	bytes: number;
	sha256: string;
}>;
export declare function readZipEntries(
	archive: Buffer,
): { name: string; content: Buffer | null }[];
export declare function extractArchive(
	archive: Buffer,
	outDir: string,
): Promise<{ fileName: string; bytes: number }[]>;
export declare function assertDictionaryDir(
	dir: string,
	label: string,
	fileNames?: readonly string[],
): Promise<void>;
export declare function measureDictionaryDir(
	dir: string,
	fileNames?: readonly string[],
): Promise<{ files: { fileName: string; bytes: number }[]; totalBytes: number }>;
export declare function assertLinderaWasmVersion(
	rootDir: string,
): Promise<string>;
