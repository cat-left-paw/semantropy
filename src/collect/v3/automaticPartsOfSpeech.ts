import type { AutomaticPosOptions } from "../../transform/automaticPosOptions";
import { exactCollectFields, guardCollectV3, ownCollectArray, ownCollectData, refuseCollectV3 } from "./collectDataV3";

export type AutomaticPartOfSpeech = "noun" | "verb" | "i-adjective" | "adverb";
export const AUTOMATIC_PARTS_OF_SPEECH = Object.freeze(["noun", "verb", "i-adjective", "adverb"] as const);
const optionKeys = ["noun", "verb", "iAdjective", "adverb"] as const satisfies readonly (keyof AutomaticPosOptions)[];

/** Conversion of captured generation options only; this does not authenticate a result. */
export function automaticPartsOfSpeechFromOptions(options: AutomaticPosOptions) {
	return guardCollectV3(() => {
		const data = ownCollectData(options);
		exactCollectFields(data, optionKeys);
		if (optionKeys.some(key => typeof data[key] !== "boolean")) refuseCollectV3("invalid-automatic-parts-of-speech");
		return Object.freeze(AUTOMATIC_PARTS_OF_SPEECH.filter((_, index) => data[optionKeys[index]!]));
	});
}
/** Strict canonical set, including the empty set. Copy before publication. */
export function readAutomaticPartsOfSpeech(value: unknown): readonly AutomaticPartOfSpeech[] {
	const items = ownCollectArray(value, "invalid-automatic-parts-of-speech");
	let previous = -1;
	for (const item of items) {
		const index = AUTOMATIC_PARTS_OF_SPEECH.indexOf(item as AutomaticPartOfSpeech);
		if (index < 0 || index <= previous) refuseCollectV3("invalid-automatic-parts-of-speech");
		previous = index;
	}
	return Object.freeze(items as AutomaticPartOfSpeech[]);
}
