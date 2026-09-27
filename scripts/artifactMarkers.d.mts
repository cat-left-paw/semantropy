export declare const RUNTIME_DEPENDENCY_MARKERS: string[];
export declare const WASM_RUNTIME_DEPENDENCY_MARKERS: string[];
export declare const KUROMOJI_MARKERS: string[];
export declare function machineMarkers(rootDir: string): string[];
export declare function splitBanner(content: string): {
	banner: string;
	code: string;
};
export declare function maskBase64Literals(code: string, dictionaryFileNames?: readonly string[]): {
	masked: string;
	literals: { chars: number }[];
};
