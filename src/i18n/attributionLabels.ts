/**
 * The Collection attribution labels, in both interface languages.
 *
 * They are part of the catalog (`ui().attribution`) and are also the only
 * interface text the Collect serializer reads. Keeping them in this leaf
 * means a new entry does not pull the rest of the interface catalog.
 */
export type AttributionLabels = {
	readonly feature: string;
	readonly target: string;
	readonly vocabulary: string;
	readonly semantropy: string;
	readonly date: string;
	readonly body: string;
	readonly dictionary: string;
	readonly collision: string;
	readonly fakeProverb: string;
};

export const ATTRIBUTION_LABELS: Readonly<Record<"en" | "ja", AttributionLabels>> = Object.freeze({
	en: Object.freeze({
		feature: "Generation feature",
		target: "Target",
		vocabulary: "Vocabulary",
		semantropy: "Semantropy",
		date: "Date",
		body: "Reshuffle text",
		dictionary: "Fake Dictionary",
		collision: "Collision",
		fakeProverb: "Fake proverb",
	}),
	ja: Object.freeze({
		feature: "生成機能",
		target: "対象ノート",
		vocabulary: "語彙",
		semantropy: "Semantropy",
		date: "日付",
		body: "本文シャッフル",
		dictionary: "Fake Dictionary",
		collision: "衝突フレーズ",
		fakeProverb: "架空ことわざ",
	}),
});
