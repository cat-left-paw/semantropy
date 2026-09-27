// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { SemantropySession } from "../src/application/SemantropySession";
import { runReshuffleGuarded } from "../src/application/runReshuffle";
import { RESHUFFLE_ERROR_MESSAGE } from "../src/application/reshuffleNote";
import { MarkdownBodyController } from "../src/render/markdownBodyController";
import type { MarkdownRenderHost } from "../src/render/markdownBodyController";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import {
	buildVocabularyPool,
	transformTokenSequences,
} from "../src/transform/transformTokens";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import {
	beginViewClose,
	beginViewOpen,
	closedReshuffleOutcome,
	createViewLifecycle,
} from "../src/view/semantropyViewLifecycle";
import { token } from "./tokenFixtures";
import { MAX } from "./readyAnalysis";

const particle = token({ surface: "は", pos: "助詞", detail1: "係助詞" });
const cat = token({ surface: "猫" });
const dog = token({ surface: "犬" });
const sequences = [[cat, particle, dog]] as const;
const pool = buildVocabularyPool(sequences);

function fillHtml(container: HTMLElement, html: string): void {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const imported = Array.from(parsed.body.childNodes).map((node) =>
		container.ownerDocument.importNode(node, true),
	);
	container.replaceChildren(...imported);
}

function createHost(html: string): MarkdownRenderHost {
	const container = document.createElement("div");
	return {
		createOwner: () => ({ unload: vi.fn() }),
		createContainer: () => container,
		renderMarkdown: async ({ container: target }) => {
			fillHtml(target, html);
		},
	};
}

function reshuffleLikeView(
	lifecycle: ReturnType<typeof createViewLifecycle>,
	session: SemantropySession,
	controller: MarkdownBodyController,
	issueSeed: () => number,
) {
	const closed = closedReshuffleOutcome(lifecycle);
	if (closed) {
		return Promise.resolve(closed);
	}
	return runReshuffleGuarded({
		busy: lifecycle.busy,
		session,
		host: {
			getBodyGeneration: () => controller.getBodyGeneration(),
			getTextNodeCount: () => controller.getTextNodes().length,
			prepareResult: (generation, result) =>
				controller.prepareTransformedTexts(generation, result.texts)?.commit ?? null,
		},
		issueSeed,
		isAbandoned: () =>
			lifecycle.closed || session.getState().status !== "ready",
	});
}

describe("SemantropyView lifecycle", () => {
	it("resets closed, busy, and notice on open after close", () => {
		const lifecycle = createViewLifecycle();
		lifecycle.busy.acquire();
		lifecycle.reshuffleNotice = RESHUFFLE_ERROR_MESSAGE;
		beginViewClose(lifecycle);
		expect(lifecycle.closed).toBe(true);
		expect(closedReshuffleOutcome(lifecycle)).toBe("aborted");

		beginViewOpen(lifecycle);
		expect(lifecycle.closed).toBe(false);
		expect(lifecycle.busy.isBusy()).toBe(false);
		expect(lifecycle.reshuffleNotice).toBeNull();
		expect(closedReshuffleOutcome(lifecycle)).toBeNull();
	});

	it("allows reshuffle again after close then open", async () => {
		const lifecycle = createViewLifecycle();
		beginViewOpen(lifecycle);
		const session = new SemantropySession();
		const controller = new MarkdownBodyController();
		await controller.renderIfCurrent(
			1,
			{ text: "body", sourcePath: "note.md" },
			() => true,
			createHost("<p>猫は犬</p>"),
		);
		const first = transformTokenSequences(sequences, pool, 0, MAX);
		controller.applyTransformedTexts(controller.getBodyGeneration(), first.texts);
		session.completeReady(session.beginLoading(), createSourceSnapshot({
			sourcePath: "note.md",
			sourceName: "note.md",
			text: "原文",
			contentHash: "hash",
		}), 0, {
			tokenSequences: sequences,
			pool,
			replacementCount: first.replacementCount,
			replaceableSlotCount: first.replaceableSlotCount,
			bodySemantropy: MAX,
			algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
		});

		expect(await reshuffleLikeView(lifecycle, session, controller, () => 1)).toBe(
			"applied",
		);

		beginViewClose(lifecycle);
		session.dispose();
		controller.release();
		expect(await reshuffleLikeView(lifecycle, session, controller, () => 2)).toBe(
			"aborted",
		);

		beginViewOpen(lifecycle);
		await controller.renderIfCurrent(
			2,
			{ text: "body", sourcePath: "note.md" },
			() => true,
			createHost("<p>猫は犬</p>"),
		);
		controller.applyTransformedTexts(
			controller.getBodyGeneration(),
			transformTokenSequences(sequences, pool, 0, MAX).texts,
		);
		session.completeReady(session.beginLoading(), createSourceSnapshot({
			sourcePath: "note.md",
			sourceName: "note.md",
			text: "原文",
			contentHash: "hash",
		}), 0, {
			tokenSequences: sequences,
			pool,
			replacementCount: first.replacementCount,
			replaceableSlotCount: first.replaceableSlotCount,
			bodySemantropy: MAX,
			algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
		});

		expect(await reshuffleLikeView(lifecycle, session, controller, () => 3)).toBe(
			"applied",
		);
		const state = session.getState();
		expect(state.status).toBe("ready");
		if (state.status === "ready") {
			expect(state.bodySeed).toBe(3);
		}
	});
});
