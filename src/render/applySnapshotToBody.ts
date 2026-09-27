import type { SemantropyReadyAnalysis } from "../application/SemantropySession";
import type { SourceSnapshot } from "../application/SourceSnapshot";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import type {
	MarkdownBodyController,
	MarkdownRenderHost,
} from "./markdownBodyController";
import { transformDetachedBody } from "./transformDetachedBody";

export type SnapshotBodyResult =
	| { status: "applied"; analysis: SemantropyReadyAnalysis }
	| { status: "stale" }
	| { status: "render-error" }
	| { status: "analyze-error" };

/**
 * Renders one snapshot into a detached body and transforms it once.
 *
 * Open and Refresh share this so that a refreshed view is built exactly the
 * way a freshly opened one is: a new detached DOM, one tokenize pass per
 * transformable Text node, and no reuse of the previous analysis. It stops at
 * every await if the request was superseded, and never writes to the session —
 * the caller decides what a result means.
 */
export async function applySnapshotToBody(input: {
	requestId: number;
	snapshot: SourceSnapshot;
	bodySeed: number;
	bodySemantropy: BodySemantropy;
	isCurrent: (requestId: number) => boolean;
	controller: MarkdownBodyController;
	renderHost: MarkdownRenderHost;
	getTokenizer: () => JapaneseTokenizer;
}): Promise<SnapshotBodyResult> {
	const rendered = await input.controller.renderIfCurrent(
		input.requestId,
		input.snapshot,
		input.isCurrent,
		input.renderHost,
	);
	if (!input.isCurrent(input.requestId) || rendered === "stale") {
		return { status: "stale" };
	}
	if (rendered === "error") {
		return { status: "render-error" };
	}

	const transformed = await transformDetachedBody({
		requestId: input.requestId,
		isCurrent: input.isCurrent,
		controller: input.controller,
		bodyGeneration: input.controller.getBodyGeneration(),
		getTokenizer: input.getTokenizer,
		bodySeed: input.bodySeed,
		bodySemantropy: input.bodySemantropy,
	});
	if (!input.isCurrent(input.requestId) || transformed.status === "stale") {
		return { status: "stale" };
	}
	if (transformed.status === "error") {
		return { status: "analyze-error" };
	}

	return {
		status: "applied",
		analysis: {
			tokenSequences: transformed.analysis.tokenSequences,
			pool: transformed.analysis.pool,
			replacementCount: transformed.replacementCount,
			replaceableSlotCount: transformed.replaceableSlotCount,
			bodySemantropy: transformed.bodySemantropy,
			algorithmVersion: transformed.algorithmVersion,
		},
	};
}
