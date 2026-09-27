export declare const DETAIL_SLOT_COUNT: number;
export declare const SLOT_POS: number;
export declare const SLOT_DETAIL1: number;
export declare const SLOT_DETAIL2: number;
export declare const SLOT_DETAIL3: number;
export declare const SLOT_CONJUGATION_TYPE: number;
export declare const SLOT_CONJUGATION_FORM: number;
export declare const SLOT_BASE_FORM: number;
export declare const SLOT_READING: number;
export declare const SLOT_PRONUNCIATION: number;
export declare const UNSET_FIELD: string;
export declare const NOUN_POS: string;
export declare const TARGET_NOUN_DETAIL1: readonly string[];
export declare const ALWAYS_KEPT_SLOTS: readonly number[];
export declare const TARGET_NOUN_EXTRA_SLOTS: readonly number[];
export declare const VERB_POS: string;
export declare const ADJECTIVE_POS: string;
export declare const INDEPENDENT_DETAIL1: string;
export type CompactEntryClass =
	| "target-noun"
	| "independent-verb"
	| "independent-adjective"
	| "other";
export type CompactSlotScope = {
	readonly conjugationTypes: readonly string[];
	readonly conjugationForms: readonly string[];
};
export type CompactSlotRule =
	| readonly number[]
	| { readonly slots: readonly number[]; readonly scope: CompactSlotScope };
export type CompactSlotRules = Readonly<
	Record<CompactEntryClass, CompactSlotRule>
>;
export declare const ENTRY_CLASSES: readonly CompactEntryClass[];
export declare const COMPACT_DICTIONARY_POLICY: string;
export declare const LEGACY_NOUN_ONLY_SLOT_RULES: CompactSlotRules;
export declare const PRODUCTION_SLOT_RULES: CompactSlotRules;
export declare const MANUAL_MORPH_EXTRA_SLOTS: readonly number[];
export declare const MANUAL_MORPH1_CANDIDATE_SLOT_RULES: CompactSlotRules;
export declare const MANUAL_MORPH1_ALLOWLIST_SCOPE: Readonly<
	Record<"independent-verb" | "independent-adjective", CompactSlotScope>
>;
export declare const MANUAL_MORPH1_ALLOWLIST_FIVE_FIELD_SLOT_RULES: CompactSlotRules;
export declare const MANUAL_MORPH1_ALLOWLIST_TYPE_FORM_SLOT_RULES: CompactSlotRules;

export declare function isTargetNoun(pos: string, detail1: string): boolean;
export declare function classifyEntry(
	pos: string,
	detail1: string,
): CompactEntryClass;
export declare function keepsSlot(slot: number, targetNoun: boolean): boolean;
export declare function resolveSlotRules(
	rules: unknown,
): Map<
	CompactEntryClass,
	{
		kept: Set<number>;
		scope: { conjugationTypes: Set<string>; conjugationForms: Set<string> } | null;
	}
>;
export declare function splitWordRecord(
	payload: Buffer,
	entryIndex: number,
): Buffer[];
export declare function compactWordFields(
	fields: Buffer[],
	rules?: CompactSlotRules,
): {
	fields: Buffer[];
	targetNoun: boolean;
	entryClass: CompactEntryClass;
	keptExtraSlots: boolean;
};
export declare function buildCompactWords(
	words: Buffer,
	wordsIdx: Buffer,
	rules?: CompactSlotRules,
): {
	words: Buffer;
	wordsIdx: Buffer;
	entryCount: number;
	targetNounCount: number;
	entryClassCounts: Record<CompactEntryClass, number>;
	extendedEntryCounts: Record<CompactEntryClass, number>;
};
export declare function generateCompactDictionary(
	sourceDir: string,
	outDir: string,
): Promise<{
	outDir: string;
	entryCount: number;
	targetNounCount: number;
	full: { files: { fileName: string; bytes: number }[]; totalBytes: number };
	compact: { files: { fileName: string; bytes: number }[]; totalBytes: number };
}>;
