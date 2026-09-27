import { projectMarkdownSource } from "../analysis/projectMarkdownSource";
import { locateTokens, type LocatedAnalysisRun } from "../analysis/locateTokens";
import { buildRubyVocabulary, freezeAnalysis } from "../analysis/rubyVocabulary";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";

export const SOURCE_ANALYSIS_ERROR_MESSAGE = "Could not analyze the selected source.";

/** Prepared text only: no read adapter, render owner, event subscription or I/O. */
export async function analyzeSelectedSource(input: {
	text: string; sourcePath: string; contentHash: string;
	tokenizer: JapaneseTokenizer;
	isCurrent?: () => boolean;
	checkpoint?: () => Promise<boolean>;
	mode?: "source" | "target-prototype";
	phase?: (name: "projection" | "tokenize" | "vocabulary") => void;
}) {
	const current = input.isCurrent ?? (() => true);
	try {
		if (!current() || (input.checkpoint && !(await input.checkpoint()))) return { status: "stale" as const };
		input.phase?.("projection");
		const projection = projectMarkdownSource(input.text, input.mode);
		const runs: LocatedAnalysisRun[] = [];
		for (const run of projection.document.runs) {
			if (!current() || (input.checkpoint && !(await input.checkpoint()))) return { status: "stale" as const };
			input.phase?.("tokenize");
			const tokens = await input.tokenizer.tokenize(run.analysisText);
			if (!current() || (input.checkpoint && !(await input.checkpoint()))) return { status: "stale" as const };
			runs.push({ run, tokens: locateTokens(run, tokens) });
		}
		if (!current() || (input.checkpoint && !(await input.checkpoint()))) return { status: "stale" as const };
		input.phase?.("vocabulary");
		const located = freezeAnalysis({ document: projection.document, runs });
		const extracted = buildRubyVocabulary(located, { path: input.sourcePath, contentHash: input.contentHash });
		const vocabulary = freezeAnalysis({ ...extracted, fingerprint: JSON.stringify([projection.policyVersion, extracted.fingerprint]) });
		if (!current() || (input.checkpoint && !(await input.checkpoint()))) return { status: "stale" as const };
		return { status: "ready" as const, projection, located, vocabulary };
	} catch {
		return { status: "error" as const, message: SOURCE_ANALYSIS_ERROR_MESSAGE };
	}
}
