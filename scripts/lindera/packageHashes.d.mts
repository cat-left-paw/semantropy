export declare const LINDERA_WASM_PACKAGE_SHA256: Readonly<
	Record<string, string>
>;
export declare const LINDERA_WASM_PACKAGE_FILE_NAMES: readonly string[];
export declare function measureLinderaWasmPackageHashes(
	packageDir: string,
): Promise<Record<string, string>>;
/**
 * Always compares against the pinned LINDERA_WASM_PACKAGE_SHA256; there is no
 * option to supply different expected hashes.
 */
export declare function assertLinderaWasmPackage(
	rootDir: string,
): Promise<Record<string, string>>;
