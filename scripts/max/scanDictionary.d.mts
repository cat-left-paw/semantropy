export declare const VERB_POS: string;
export declare const ADJECTIVE_POS: string;
export declare const INDEPENDENT: string;
export declare const UNSET: string;

/** One dictionary entry: the nine IPADIC detail slots, decoded. */
export type ScannedEntry = readonly string[];

export declare function readEntries(directory: string): ScannedEntry[];
export declare function compactDir(root?: string): string;
export declare function fullDir(root?: string): string;

export type ScannedDistribution = {
	readonly total: number;
	/** 動詞 / 自立 and 形容詞 / 自立 entries. */
	readonly inflecting: number;
	readonly pos: Map<string, number>;
	readonly detail1: Map<string, number>;
	readonly detail2: Map<string, number>;
	readonly detail3: Map<string, number>;
	readonly conjugationType: Map<string, number>;
	readonly conjugationForm: Map<string, number>;
	readonly classForm: Map<string, number>;
	readonly verbTypeForm: Map<string, number>;
	readonly adjectiveTypeForm: Map<string, number>;
	readonly baseFormClasses: Map<string, string[]>;
	readonly representative: Map<string, string>;
};

export declare function scanDistribution(
	entries: readonly ScannedEntry[],
): ScannedDistribution;

export declare function baseFormSummary(distribution: ScannedDistribution): {
	readonly distinct: number;
	readonly multiClass: readonly {
		readonly pos: string;
		readonly base: string;
		readonly types: readonly string[];
	}[];
	readonly byType: Map<string, Set<string>>;
};

export declare function toObject(map: Map<string, number>): Record<string, number>;
