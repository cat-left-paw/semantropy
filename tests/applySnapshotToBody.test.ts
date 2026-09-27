// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { SemantropySession } from "../src/application/SemantropySession";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import { applySnapshotToBody } from "../src/render/applySnapshotToBody";
import {
	MarkdownBodyController,
	type MarkdownRenderHost,
} from "../src/render/markdownBodyController";
import type { JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import { token } from "./tokenFixtures";
import { MAX } from "./readyAnalysis";

function snapshot(text: string) {
	return createSourceSnapshot({
		sourcePath: "note.md",
		sourceName: "note.md",
		text,
		contentHash: `hash(${text})`,
	});
}

function renderHost(html: string): MarkdownRenderHost {
	return {
		createOwner: () => ({ unload: vi.fn() }),
		createContainer: () => document.createElement("div"),
		renderMarkdown: async ({ container }) => {
			const parsed = new DOMParser().parseFromString(html, "text/html");
			container.replaceChildren(
				...Array.from(parsed.body.childNodes).map((node) =>
					container.ownerDocument.importNode(node, true),
				),
			);
		},
	};
}

function countingTokenizer(calls: string[]): JapaneseTokenizer {
	return {
		tokenize: async (text) => {
			calls.push(text);
			return [...text].map((surface) => token({ surface }));
		},
	};
}

describe("applySnapshotToBody", () => {
	it("tokenizes each transformable analysis run exactly once", async () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		const controller = new MarkdownBodyController();
		const calls: string[] = [];

		const result = await applySnapshotToBody({
			requestId,
			snapshot: snapshot("body"),
			bodySeed: 5,
			bodySemantropy: MAX,
			isCurrent: (id) => session.isCurrent(id),
			controller,
			renderHost: renderHost(
				"<p>猫犬</p><p>鳥魚</p><pre><code>虫貝</code></pre>",
			),
			getTokenizer: () => countingTokenizer(calls),
		});

		expect(result.status).toBe("applied");
		// The protected code block is neither collected nor tokenized.
		expect(calls).toEqual(["猫犬", "鳥魚"]);
		expect(controller.getSequenceCount()).toBe(2);
	});

	it("leaves protected link, code and math content untouched", async () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		const controller = new MarkdownBodyController();

		await applySnapshotToBody({
			requestId,
			snapshot: snapshot("body"),
			bodySeed: 5,
			bodySemantropy: MAX,
			isCurrent: (id) => session.isCurrent(id),
			controller,
			renderHost: renderHost(
				'<p>猫犬</p><a href="x.md">鳥魚</a><code>虫貝</code>',
			),
			getTokenizer: () => countingTokenizer([]),
		});

		const container = controller.getContainer();
		expect(container?.querySelector("a")?.textContent).toBe("鳥魚");
		expect(container?.querySelector("a")?.getAttribute("href")).toBe("x.md");
		expect(container?.querySelector("code")?.textContent).toBe("虫貝");
	});

	it("reports a superseded request as stale without completing the session", async () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		const controller = new MarkdownBodyController();
		session.beginLoading();

		const result = await applySnapshotToBody({
			requestId,
			snapshot: snapshot("body"),
			bodySeed: 5,
			bodySemantropy: MAX,
			isCurrent: (id) => session.isCurrent(id),
			controller,
			renderHost: renderHost("<p>猫犬</p>"),
			getTokenizer: () => countingTokenizer([]),
		});

		expect(result).toEqual({ status: "stale" });
		expect(controller.getContainer()).toBeNull();
	});

	it("separates a render failure from an analysis failure", async () => {
		const session = new SemantropySession();
		const controller = new MarkdownBodyController();

		const renderFailure = await applySnapshotToBody({
			requestId: session.beginLoading(),
			snapshot: snapshot("body"),
			bodySeed: 5,
			bodySemantropy: MAX,
			isCurrent: (id) => session.isCurrent(id),
			controller,
			renderHost: {
				createOwner: () => ({ unload: vi.fn() }),
				createContainer: () => document.createElement("div"),
				renderMarkdown: async () => {
					throw new Error("render blew up");
				},
			},
			getTokenizer: () => countingTokenizer([]),
		});
		expect(renderFailure).toEqual({ status: "render-error" });

		const analyzeFailure = await applySnapshotToBody({
			requestId: session.beginLoading(),
			snapshot: snapshot("body"),
			bodySeed: 5,
			bodySemantropy: MAX,
			isCurrent: (id) => session.isCurrent(id),
			controller,
			renderHost: renderHost("<p>猫犬</p>"),
			getTokenizer: () => ({
				tokenize: async () => {
					throw new Error("tokenizer down");
				},
			}),
		});
		expect(analyzeFailure).toEqual({ status: "analyze-error" });
	});

	it("never writes to the session itself", async () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		const controller = new MarkdownBodyController();

		await applySnapshotToBody({
			requestId,
			snapshot: snapshot("body"),
			bodySeed: 5,
			bodySemantropy: MAX,
			isCurrent: (id) => session.isCurrent(id),
			controller,
			renderHost: renderHost("<p>猫犬</p>"),
			getTokenizer: () => countingTokenizer([]),
		});

		// The caller decides what "applied" means; this stays loading.
		expect(session.getState()).toEqual({ status: "loading", requestId });
	});
});
