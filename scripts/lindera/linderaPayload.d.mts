export declare const LINDERA_WASM_MODULE_ID: string;
export declare const LINDERA_PAYLOAD_MODULE_ID: string;
export declare function generateLinderaPayloadModule(
	rootDir: string,
	dictionaryDir: string,
): Promise<{
	source: string;
	wasm: { bytes: number; gzipBytes: number };
	dictionary: { fileName: string; bytes: number; gzipBytes: number }[];
}>;
export declare function linderaPayloadPlugin(
	rootDir: string,
	dictionaryDir: string,
): { name: string; setup(build: unknown): void };
