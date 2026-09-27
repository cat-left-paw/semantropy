/** Shared pure type. Importing options must never load the Source analyzer. */
export type AutomaticPosOptions = {
	readonly noun: boolean;
	readonly verb: boolean;
	readonly iAdjective: boolean;
	readonly adverb: boolean;
};
