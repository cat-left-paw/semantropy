import type {
	AnalysisDocument,
	AnalysisRun,
	Utf16Range,
} from "./rubyAnalysis";
import type {
	JapaneseToken,
	JapaneseTokenizer,
} from "../tokenizer/JapaneseTokenizer";

export type LocatedToken = {
	tokenId: string;
	range: Utf16Range;
	token: JapaneseToken;
};

export type LocatedAnalysisRun = {
	run: AnalysisRun;
	tokens: readonly LocatedToken[];
};

export type LocatedAnalysisDocument = {
	document: AnalysisDocument;
	runs: readonly LocatedAnalysisRun[];
};

export class TokenSurfaceCoverageError extends Error {
	constructor(runId: string) {
		super(`Tokenizer surface coverage did not match analysis run ${runId}.`);
		this.name = "TokenSurfaceCoverageError";
	}
}

/**
 * Assigns UTF-16 ranges by accumulation only. Lindera byte offsets and string
 * search are intentionally not part of this boundary.
 */
export function locateTokens(
	run: AnalysisRun,
	tokens: readonly JapaneseToken[],
): readonly LocatedToken[] {
	if (tokens.some((token) => token.surface.length === 0)) {
		throw new TokenSurfaceCoverageError(run.runId);
	}
	const covered = tokens.map((token) => token.surface).join("");
	if (covered !== run.analysisText) {
		throw new TokenSurfaceCoverageError(run.runId);
	}

	let cursor = 0;
	return tokens.map((token, tokenIndex) => {
		const start = cursor;
		cursor += token.surface.length;
		return {
			tokenId: `${run.runId}:token:${tokenIndex}`,
			range: { start, end: cursor },
			token,
		};
	});
}

/** Uses the existing tokenizer boundary and never tokenizes protected runs. */
export async function tokenizeAnalysisDocument(
	document: AnalysisDocument,
	tokenizer: JapaneseTokenizer,
): Promise<LocatedAnalysisDocument> {
	const runs: LocatedAnalysisRun[] = [];
	for (const run of document.runs) {
		const tokens = await tokenizer.tokenize(run.analysisText);
		runs.push({ run, tokens: locateTokens(run, tokens) });
	}
	return { document, runs };
}
