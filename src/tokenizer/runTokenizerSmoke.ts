import type { JapaneseTokenizer } from "./JapaneseTokenizer";
import { TOKENIZER_SMOKE_TEXT } from "./smokeText";

export type TokenizerSmokeHost = JapaneseTokenizer & {
	isInitialized(): boolean;
};

export type TokenizerSmokeUi = {
	showNotice: (message: string) => void;
	logDebug: (message: string, details: unknown) => void;
	logError: (message: string, error: unknown) => void;
};

export async function runTokenizerSmoke(
	getTokenizer: () => TokenizerSmokeHost,
	ui: TokenizerSmokeUi,
): Promise<void> {
	try {
		const tokenizer = getTokenizer();
		if (!tokenizer.isInitialized()) {
			ui.showNotice("Loading tokenizer…");
		}

		const tokens = await tokenizer.tokenize(TOKENIZER_SMOKE_TEXT);
		const nounCount = tokens.filter((token) => token.pos === "名詞").length;
		ui.showNotice(
			`Tokenizer OK: ${tokens.length} tokens, ${nounCount} nouns.`,
		);
		ui.logDebug(
			"[Semantropy] tokenizer smoke tokens",
			tokens.map((token) => ({
				surface: token.surface,
				pos: token.pos,
				detail1: token.detail1,
			})),
		);
	} catch (error) {
		ui.showNotice("Tokenizer failed. See the developer console.");
		ui.logError(
			"[Semantropy] tokenizer initialization or analysis failed",
			error,
		);
	}
}
