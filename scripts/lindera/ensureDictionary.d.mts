import type { prepareDictionary } from "../prepareDictionary.mjs";

export declare function inspectCompactDictionary(
	compactDir: string,
): Promise<{ ok: true } | { ok: false; reason: string }>;

export declare function ensureBuildDictionary(
	rootDir: string,
	options?: {
		prepare?: typeof prepareDictionary;
		fetchImpl?: typeof fetch;
		log?: (line: string) => void;
	},
): Promise<{ source: "cache" | "prepared"; downloaded: boolean }>;
