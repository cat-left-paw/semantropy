// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ANALYZE_ERROR_MESSAGE } from "../src/application/analyzeNoteTexts";
import { SemantropySession } from "../src/application/SemantropySession";
import { MarkdownBodyController } from "../src/render/markdownBodyController";
import type { MarkdownRenderHost } from "../src/render/markdownBodyController";
import { transformDetachedBody } from "../src/render/transformDetachedBody";
import { transformTokenSequences } from "../src/transform/transformTokens";
import type {
	JapaneseToken,
	JapaneseTokenizer,
} from "../src/tokenizer/JapaneseTokenizer";
import { token } from "./tokenFixtures";
import { MAX } from "./readyAnalysis";

const particle = token({ surface: "は", pos: "助詞", detail1: "係助詞" });
const andParticle = token({ surface: "と", pos: "助詞", detail1: "並立助詞" });
const cat = token({ surface: "猫" });
const dog = token({ surface: "犬" });
const bird = token({ surface: "鳥" });
const unknown = token({ surface: "本文", isUnknown: true });
const linkLead = token({ surface: "内部リンク", isUnknown: true });

const lexicon: Record<string, JapaneseToken[]> = {
	猫は: [cat, particle],
	犬と鳥: [dog, andParticle, bird],
	本文: [unknown],
	内部リンク: [linkLead],
};

function tokenizerProvider(
	tokenize: (text: string) => Promise<JapaneseToken[]>,
): () => JapaneseTokenizer {
	return () => ({ tokenize });
}

function fillHtml(container: HTMLElement, html: string): void {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const imported = Array.from(parsed.body.childNodes).map((node) =>
		container.ownerDocument.importNode(node, true),
	);
	container.replaceChildren(...imported);
}

function createHost(
	renderMarkdown: MarkdownRenderHost["renderMarkdown"],
): MarkdownRenderHost {
	const container = document.createElement("div");
	return {
		createOwner: () => ({ unload: vi.fn() }),
		createContainer: () => container,
		renderMarkdown,
	};
}

const protectedHtml = `
<h1>猫は</h1>
<p>犬と鳥</p>
<p>内部リンク<a class="internal-link" href="小説断片.md" data-href="小説断片.md">内部</a></p>
<p>本文<code>code保護</code></p>
<a class="tag" href="#タグ">#タグ</a>
<span class="math math-inline">MATHINLINE</span>
<div class="internal-embed">EMBEDINTERNAL</div>
`;

async function renderProtectedBody(
	controller: MarkdownBodyController,
	requestId = 1,
): Promise<void> {
	const status = await controller.renderIfCurrent(
		requestId,
		{ text: "raw-markdown-secret", sourcePath: "note.md" },
		() => true,
		createHost(async ({ container }) => {
			fillHtml(container, protectedHtml);
		}),
	);
	expect(status).toBe("attached");
}

describe("transformDetachedBody", () => {
	it("tokenizes visible nodes, swaps nouns with one shared pool, and leaves protected DOM alone", async () => {
		const controller = new MarkdownBodyController();
		await renderProtectedBody(controller);
		const calls: string[] = [];
		const beforeHtml = controller.getContainer()?.innerHTML;
		const href = controller
			.getContainer()
			?.querySelector("a.internal-link")
			?.getAttribute("href");
		const dataHref = controller
			.getContainer()
			?.querySelector("a.internal-link")
			?.getAttribute("data-href");
		const result = await transformDetachedBody({
			requestId: 1,
			isCurrent: () => true,
			controller,
			bodyGeneration: controller.getBodyGeneration(),
			getTokenizer: tokenizerProvider(async (text) => {
				calls.push(text);
				const tokens = lexicon[text];
				if (!tokens) {
					throw new Error("unexpected text");
				}
				return tokens.map((item) => ({ ...item }));
			}),
			bodySeed: 1,
			bodySemantropy: MAX,
		});
		expect(result.status).toBe("applied");
		if (result.status !== "applied") {
			return;
		}
		expect(calls).toEqual(["猫は", "犬と鳥", "内部リンク", "本文"]);
		expect(calls.join("")).not.toContain("code保護");
		expect(calls.join("")).not.toContain("MATHINLINE");
		expect(calls.join("")).not.toContain("EMBEDINTERNAL");
		expect(calls).not.toContain("内部");
		expect(calls).not.toContain("#タグ");
		expect(calls).not.toContain("raw-markdown-secret");
		expect(result.analysis.tokenSequences).toHaveLength(4);
		expect([...result.analysis.pool.values()][0]).toEqual(["猫", "犬", "鳥"]);
		expect(result.replacementCount).toBe(3);
		expect(
			Array.from(controller.getContainer()!.querySelectorAll(".semantropy-analysis-run"), (run) => run.textContent),
		).toEqual(["鳥は", "猫と犬", "内部リンク", "本文"]);
		expect(
			controller.getContainer()?.querySelector("a.internal-link")?.textContent,
		).toBe("内部");
		expect(
			controller.getContainer()?.querySelector("a.internal-link")?.getAttribute("href"),
		).toBe(href);
		expect(
			controller
				.getContainer()
				?.querySelector("a.internal-link")
				?.getAttribute("data-href"),
		).toBe(dataHref);
		expect(controller.getContainer()?.querySelector("code")?.textContent).toBe(
			"code保護",
		);
		expect(controller.getContainer()?.querySelector(".tag")?.textContent).toBe(
			"#タグ",
		);
		expect(
			controller.getContainer()?.querySelector(".math-inline")?.textContent,
		).toBe("MATHINLINE");
		expect(
			controller.getContainer()?.querySelector(".internal-embed")?.textContent,
		).toBe("EMBEDINTERNAL");
		expect(controller.getContainer()?.querySelector("h1")).not.toBeNull();
		expect(controller.getContainer()?.querySelector("a.internal-link")).not.toBeNull();
		expect(beforeHtml).toContain('href="小説断片.md"');
		expect(result.analysis.tokenSequences[0]?.[0]?.surface).toBe("猫");
	});

	it("matches transformTokenSequences for the same tokens and seed", async () => {
		const controller = new MarkdownBodyController();
		await renderProtectedBody(controller);
		const result = await transformDetachedBody({
			requestId: 1,
			isCurrent: () => true,
			controller,
			bodyGeneration: controller.getBodyGeneration(),
			getTokenizer: tokenizerProvider(async (text) =>
				lexicon[text]!.map((item) => ({ ...item })),
			),
			bodySeed: 1,
			bodySemantropy: MAX,
		});
		expect(result.status).toBe("applied");
		if (result.status !== "applied") {
			return;
		}
		expect(
			transformTokenSequences(result.analysis.tokenSequences, result.analysis.pool, 1, MAX)
				.texts,
		).toEqual(["鳥は", "猫と犬", "内部リンク", "本文"]);
	});

	it("does not change any text node until every tokenize call has finished", async () => {
		const controller = new MarkdownBodyController();
		await renderProtectedBody(controller);
		let finishFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		let firstStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});
		const originals = controller.getTextNodes().map((node) => node.nodeValue);
		const job = transformDetachedBody({
			requestId: 1,
			isCurrent: () => true,
			controller,
			bodyGeneration: controller.getBodyGeneration(),
			getTokenizer: tokenizerProvider(async (text) => {
				if (text === "猫は") {
					firstStarted?.();
					await firstGate;
				}
				return lexicon[text]!.map((item) => ({ ...item }));
			}),
			bodySeed: 1,
			bodySemantropy: MAX,
		});
		await started;
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(
			originals,
		);
		finishFirst?.();
		await expect(job).resolves.toMatchObject({ status: "applied" });
	});

	it("does not partially transform when tokenize fails", async () => {
		const controller = new MarkdownBodyController();
		await renderProtectedBody(controller);
		const originals = controller.getTextNodes().map((node) => node.nodeValue);
		const result = await transformDetachedBody({
			requestId: 1,
			isCurrent: () => true,
			controller,
			bodyGeneration: controller.getBodyGeneration(),
			getTokenizer: tokenizerProvider(async (text) => {
				if (text === "犬と鳥") {
					throw new Error("tokenize failed");
				}
				return lexicon[text]!.map((item) => ({ ...item }));
			}),
			bodySeed: 1,
			bodySemantropy: MAX,
		});
		expect(result.status).toBe("error");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(
			originals,
		);
		expect(ANALYZE_ERROR_MESSAGE).toContain("Open again");
	});

	it("ignores a stale analysis after a newer request starts", async () => {
		const controller = new MarkdownBodyController();
		await renderProtectedBody(controller, 1);
		const firstGeneration = controller.getBodyGeneration();
		const firstNodes = [...controller.getTextNodes()];
		const originals = firstNodes.map((node) => node.nodeValue);
		let finishFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		let current = 1;
		const firstJob = transformDetachedBody({
			requestId: 1,
			isCurrent: (requestId) => requestId === current,
			controller,
			bodyGeneration: firstGeneration,
			getTokenizer: tokenizerProvider(async (text) => {
				if (text === "猫は") {
					await firstGate;
				}
				return lexicon[text]!.map((item) => ({ ...item }));
			}),
			bodySeed: 1,
			bodySemantropy: MAX,
		});

		current = 2;
		controller.release();
		await renderProtectedBody(controller, 2);
		const second = await transformDetachedBody({
			requestId: 2,
			isCurrent: (requestId) => requestId === current,
			controller,
			bodyGeneration: controller.getBodyGeneration(),
			getTokenizer: tokenizerProvider(async (text) =>
				lexicon[text]!.map((item) => ({ ...item })),
			),
			bodySeed: 1,
			bodySemantropy: MAX,
		});
		expect(second.status).toBe("applied");

		finishFirst?.();
		await expect(firstJob).resolves.toEqual({ status: "stale" });
		expect(firstNodes.map((node) => node.nodeValue)).toEqual(originals);
		expect(
			Array.from(controller.getContainer()!.querySelectorAll(".semantropy-analysis-run"), (run) => run.textContent),
		).toEqual(["鳥は", "猫と犬", "内部リンク", "本文"]);
	});

	it("does not change released nodes when a late analysis finishes", async () => {
		const controller = new MarkdownBodyController();
		await renderProtectedBody(controller);
		const generation = controller.getBodyGeneration();
		const releasedNodes = [...controller.getTextNodes()];
		const originals = releasedNodes.map((node) => node.nodeValue);
		let finish: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const job = transformDetachedBody({
			requestId: 1,
			isCurrent: () => true,
			controller,
			bodyGeneration: generation,
			getTokenizer: tokenizerProvider(async (text) => {
				if (text === "猫は") {
					await gate;
				}
				return lexicon[text]!.map((item) => ({ ...item }));
			}),
			bodySeed: 1,
			bodySemantropy: MAX,
		});
		controller.release();
		finish?.();
		await expect(job).resolves.toEqual({ status: "stale" });
		expect(releasedNodes.map((node) => node.nodeValue)).toEqual(originals);
		expect(controller.getTextNodes()).toEqual([]);
	});

	it("fails closed when transformed text count does not match text nodes", async () => {
		const controller = new MarkdownBodyController();
		await renderProtectedBody(controller);
		const originals = controller.getTextNodes().map((node) => node.nodeValue);
		const applied = controller.applyTransformedTexts(
			controller.getBodyGeneration(),
			["鳥は"],
		);
		expect(applied).toBe("mismatch");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(
			originals,
		);
	});

	it("keeps the rendered source text when replacementCount is 0", async () => {
		const controller = new MarkdownBodyController();
		const status = await controller.renderIfCurrent(
			1,
			{ text: "猫", sourcePath: "note.md" },
			() => true,
			createHost(async ({ container }) => {
				fillHtml(container, "<p>猫</p>");
			}),
		);
		expect(status).toBe("attached");
		const result = await transformDetachedBody({
			requestId: 1,
			isCurrent: () => true,
			controller,
			bodyGeneration: controller.getBodyGeneration(),
			getTokenizer: tokenizerProvider(async () => [token({ surface: "猫" })]),
			bodySeed: 1,
			bodySemantropy: MAX,
		});
		expect(result.status).toBe("applied");
		if (result.status !== "applied") {
			return;
		}
		expect(result.replacementCount).toBe(0);
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(["猫"]);
	});

	it("routes a synchronous tokenizer provider throw into the analysis error path", async () => {
		const session = new SemantropySession();
		const requestId = session.beginLoading();
		const controller = new MarkdownBodyController();
		await renderProtectedBody(controller);
		const originals = controller.getTextNodes().map((node) => node.nodeValue);

		await expect(
			transformDetachedBody({
				requestId,
				isCurrent: (id) => session.isCurrent(id),
				controller,
				bodyGeneration: controller.getBodyGeneration(),
				getTokenizer: () => {
					throw new Error("dictionary path is unavailable");
				},
				bodySeed: 1,
				bodySemantropy: MAX,
			}),
		).resolves.toEqual({ status: "error" });

		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(
			originals,
		);
		expect(session.getState().status).toBe("loading");

		if (session.isCurrent(requestId)) {
			session.completeError(requestId, ANALYZE_ERROR_MESSAGE);
			controller.release();
		}
		expect(session.getState()).toEqual({
			status: "error",
			message: ANALYZE_ERROR_MESSAGE,
		});
		expect(controller.getContainer()).toBeNull();
		expect(controller.getTextNodes()).toEqual([]);
	});
});
