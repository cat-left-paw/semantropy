export declare function verifyManualMorphDictionary(root?: string): Promise<{
 policy: string; entries: number; verbs: number; adjectives: number; unchangedOther: number;
 fieldComparisons: number; empty: number; unset: number; entryOrderAndIndex: boolean; utf8AndNul: boolean; deterministic: boolean;
 fullHashes: Readonly<Record<string, string>>; compactHashes: Readonly<Record<string, string>>;
}>;
