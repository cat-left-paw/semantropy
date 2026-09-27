export declare const GLUE_SPLIT_MARKER: string;
export declare const GLUE_TAIL_MARKER: string;
export declare function rewriteLinderaWasmGlue(source: string): string;
export declare function readRewrittenLinderaWasmGlue(
	rootDir: string,
): Promise<string>;
