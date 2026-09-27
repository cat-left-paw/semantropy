import type { JapaneseToken } from "../tokenizer/JapaneseTokenizer";

const ELIGIBLE_NOUN_DETAILS = new Set([
	"一般",
	"固有名詞",
	"サ変接続",
	"形容動詞語幹",
]);

const PROPER_NOUN_DETAIL = "固有名詞";

export function isSingleCodePointSymbol(surface: string): boolean {
	const codePoints = [...surface];
	const codePoint = codePoints[0];
	return (
		codePoints.length === 1 &&
		codePoint !== undefined &&
		/^[\p{P}\p{S}]$/u.test(codePoint)
	);
}

export function isEligibleReplacementToken(token: JapaneseToken): boolean {
	if (token.isUnknown) {
		return false;
	}
	if (token.pos !== "名詞") {
		return false;
	}
	if (!ELIGIBLE_NOUN_DETAILS.has(token.detail1)) {
		return false;
	}
	if (isSingleCodePointSymbol(token.surface)) {
		return false;
	}
	return true;
}

export function vocabularyPoolKey(token: JapaneseToken): string {
	if (
		token.pos === "名詞" &&
		token.detail1 === PROPER_NOUN_DETAIL &&
		token.detail2 !== "" &&
		token.detail2 !== "*"
	) {
		return `${token.pos}\u001f${token.detail1}\u001f${token.detail2}`;
	}
	return `${token.pos}\u001f${token.detail1}`;
}
