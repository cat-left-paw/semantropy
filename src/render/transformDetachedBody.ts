import type { AnalyzedNote } from "../application/analyzeNoteTexts";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import type { MarkdownBodyController } from "./markdownBodyController";

export type DetachedBodyTransformResult =
	| {
			status: "applied";
			analysis: AnalyzedNote;
			replacementCount: number;
			replaceableSlotCount: number;
			bodySemantropy: BodySemantropy;
			algorithmVersion: number;
	  }
	| { status: "stale" }
	| { status: "error" };

export async function transformDetachedBody(input: {
	requestId: number;
	isCurrent: (requestId: number) => boolean;
	controller: MarkdownBodyController;
	bodyGeneration: number;
	getTokenizer: () => JapaneseTokenizer;
	bodySeed: number;
	bodySemantropy: BodySemantropy;
}): Promise<DetachedBodyTransformResult> {
	if (!isOwnedGeneration(input)) {
		return { status: "stale" };
	}

	try {
		const tokenizer = input.getTokenizer();
		const analyzed = await input.controller.analyzeRuby(tokenizer, () => isOwnedGeneration(input));
		if (!analyzed || !isOwnedGeneration(input)) {
			return { status: "stale" };
		}

		const transformed = input.controller.transformRuby(
			input.bodySeed,
			input.bodySemantropy,
		);
		const applied = input.controller.applyRubyResult(
			input.bodyGeneration,
			transformed,
			() => isOwnedGeneration(input),
		);
		if (applied === "stale") {
			return { status: "stale" };
		}
		if (applied === "mismatch") {
			return { status: "error" };
		}

		return {
			status: "applied",
			analysis: analyzed,
			replacementCount: transformed.replacementCount,
			replaceableSlotCount: transformed.replaceableSlotCount,
			bodySemantropy: transformed.bodySemantropy,
			algorithmVersion: transformed.algorithmVersion,
		};
	} catch {
		return { status: "error" };
	}
}

function isOwnedGeneration(input: {
	requestId: number;
	isCurrent: (requestId: number) => boolean;
	controller: MarkdownBodyController;
	bodyGeneration: number;
}): boolean {
	return (
		input.isCurrent(input.requestId) &&
		input.controller.getBodyGeneration() === input.bodyGeneration
	);
}
