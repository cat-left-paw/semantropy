import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";

export function token(
	partial: Pick<JapaneseToken, "surface"> & Partial<JapaneseToken>,
): JapaneseToken {
	return {
		pos: "名詞",
		detail1: "一般",
		detail2: "*",
		detail3: "*",
		conjugationType: "*",
		conjugationForm: "*",
		baseForm: partial.surface,
		isUnknown: false,
		...partial,
	};
}
