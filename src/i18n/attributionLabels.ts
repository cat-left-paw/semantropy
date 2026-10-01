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
	readonly recompose: string;
	/** 0.1.0 S5: the Recompose method and leap shown after its feature name. */
	readonly recomposeMethods: Readonly<Record<"joint" | "ngram" | "mixed", string>>;
	/** The leap is one value, or the smallest and largest when the steps differed. */
	readonly recomposeDetail: (name: string, method: string, leapMin: number, leapMax: number) => string;
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
		recompose: "Recompose",
		recomposeMethods: Object.freeze({ joint: "joints", ngram: "n-gram", mixed: "mixed" }),
		recomposeDetail: (name: string, method: string, leapMin: number, leapMax: number) =>
			`${name} (${method}, leap ${leapMin === leapMax ? leapMin : `${leapMin}–${leapMax}`})`,
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
		recompose: "再構成",
		recomposeMethods: Object.freeze({ joint: "継ぎ目", ngram: "nグラム", mixed: "混合" }),
		recomposeDetail: (name: string, method: string, leapMin: number, leapMax: number) =>
			`${name}（${method}、飛躍率 ${leapMin === leapMax ? leapMin : `${leapMin}〜${leapMax}`}）`,
	}),
});
