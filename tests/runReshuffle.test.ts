// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { SemantropySession } from "../src/application/SemantropySession";
import {
	runReshuffle,
	runReshuffleGuarded,
	type ReshuffleHost,
} from "../src/application/runReshuffle";
import { MarkdownBodyController } from "../src/render/markdownBodyController";
import type { MarkdownRenderHost } from "../src/render/markdownBodyController";
import { BusyGate } from "../src/view/busyGate";
import {
	buildVocabularyPool,
	transformTokenSequences,
} from "../src/transform/transformTokens";
import { createSourceSnapshot } from "../src/application/SourceSnapshot";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import { token } from "./tokenFixtures";
import { MAX } from "./readyAnalysis";
import type { BodySemantropy } from "../src/settings/bodySemantropy";

const particle = token({ surface: "は", pos: "助詞", detail1: "係助詞" });
const andParticle = token({ surface: "と", pos: "助詞", detail1: "並立助詞" });
const cat = token({ surface: "猫" });
const dog = token({ surface: "犬" });
const bird = token({ surface: "鳥" });
const bodySequences = [
	[cat, particle],
	[dog, andParticle, bird],
] as const;
const protectedLead = token({ surface: "内部リンク", isUnknown: true });
const bodyUnknown = token({ surface: "本文", isUnknown: true });
const protectedSequences = [
	...bodySequences,
	[protectedLead],
	[bodyUnknown],
] as const;
const pool = buildVocabularyPool(bodySequences);

function fillHtml(container: HTMLElement, html: string): void {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const imported = Array.from(parsed.body.childNodes).map((node) =>
		container.ownerDocument.importNode(node, true),
	);
	container.replaceChildren(...imported);
}

function createHost(
	html: string,
	renderMarkdown = vi.fn(async ({ container }: { container: HTMLElement }) => {
		fillHtml(container, html);
	}),
): MarkdownRenderHost & { renderMarkdown: ReturnType<typeof vi.fn> } {
	const container = document.createElement("div");
	return {
		createOwner: () => ({ unload: vi.fn() }),
		createContainer: () => container,
		renderMarkdown,
	};
}

async function readyController(
	html = "<h1>猫は</h1><p>犬と鳥</p><p>内部リンク<a class=\"internal-link\" href=\"note.md\" data-href=\"note.md\">内部</a></p><p>本文<code>code保護</code></p>",
): Promise<MarkdownBodyController> {
	const controller = new MarkdownBodyController();
	const status = await controller.renderIfCurrent(
		1,
		{ text: "raw-markdown-secret", sourcePath: "note.md" },
		() => true,
		createHost(html),
	);
	expect(status).toBe("attached");
	return controller;
}

function readySession(
	bodySeed: number,
	replacementCount = 3,
	tokenSequences: readonly (readonly ReturnType<typeof token>[])[] = bodySequences,
	options: { replaceableSlotCount?: number; bodySemantropy?: BodySemantropy } = {},
) {
	const session = new SemantropySession();
	const requestId = session.beginLoading();
	session.completeReady(
		requestId,
		createSourceSnapshot({
			sourcePath: "folder/小説断片.md",
			sourceName: "小説断片.md",
			text: "原文スナップショット",
			contentHash: "hash-abc",
		}),
		bodySeed,
		{
			tokenSequences,
			pool,
			replacementCount,
			// Defaults to "there was something to work with", so a zero
			// replacement count still means a rerollable note.
			replaceableSlotCount:
				options.replaceableSlotCount ?? Math.max(replacementCount, 1),
			bodySemantropy: options.bodySemantropy ?? MAX,
			algorithmVersion: SEMANTROPY_ALGORITHM_VERSION,
		},
	);
	return session;
}

/**
 * The coordinator is agnostic about the body behind the prepare/commit
 * boundary. A Text-node body is a compact stand-in here; the production
 * Target controller is exercised through the view and the Refresh harness.
 */
function hostFrom(controller: MarkdownBodyController): ReshuffleHost {
	return {
		getBodyGeneration: () => controller.getBodyGeneration(),
		getTextNodeCount: () => controller.getTextNodes().length,
		prepareResult: (generation, result) =>
			controller.prepareTransformedTexts(generation, result.texts)?.commit ?? null,
	};
}

describe("runReshuffle", () => {
	it("reuses saved token sequences and pool, updates texts and seed, and never tokenizes", async () => {
		const tokenize = vi.fn();
		const renderMarkdown = vi.fn(async ({ container }: { container: HTMLElement }) => {
			fillHtml(
				container,
				"<h1>猫は</h1><p>犬と鳥</p><p>内部リンク<a class=\"internal-link\" href=\"note.md\" data-href=\"note.md\">内部</a></p><p>本文<code>code保護</code></p>",
			);
		});
		const readCached = vi.fn();
		const hashText = vi.fn();
		const controller = new MarkdownBodyController();
		await controller.renderIfCurrent(
			1,
			{ text: "raw-markdown-secret", sourcePath: "note.md" },
			() => true,
			createHost("", renderMarkdown),
		);
		const initial = transformTokenSequences(protectedSequences, pool, 0, MAX);
		expect(
			controller.applyTransformedTexts(
				controller.getBodyGeneration(),
				initial.texts,
			),
		).toBe("applied");
		const session = readySession(0, initial.replacementCount, protectedSequences);
		const snapshotBefore = session.getState();
		const hrefBefore = controller
			.getContainer()
			?.querySelector("a.internal-link")
			?.getAttribute("href");
		const expected = transformTokenSequences(protectedSequences, pool, 1, MAX);

		const outcome = await runReshuffle({
			session,
			host: hostFrom(controller),
			issueSeed: () => 1,
			isAbandoned: () => false,
		});

		expect(outcome).toBe("applied");
		expect(tokenize).not.toHaveBeenCalled();
		expect(renderMarkdown).toHaveBeenCalledTimes(1);
		expect(readCached).not.toHaveBeenCalled();
		expect(hashText).not.toHaveBeenCalled();
		const state = session.getState();
		expect(state.status).toBe("ready");
		if (state.status !== "ready") {
			return;
		}
		expect(state.bodySeed).toBe(1);
		expect(state.replacementCount).toBe(expected.replacementCount);
		expect(state.snapshot).toBe(
			snapshotBefore.status === "ready" ? snapshotBefore.snapshot : null,
		);
		expect(state.snapshot.contentHash).toBe("hash-abc");
		expect(state.snapshot.text).toBe("原文スナップショット");
		expect(state.tokenSequences).toBe(
			snapshotBefore.status === "ready" ? snapshotBefore.tokenSequences : null,
		);
		expect(state.pool).toBe(
			snapshotBefore.status === "ready" ? snapshotBefore.pool : null,
		);
		expect(controller.getTextNodes()[0]?.nodeValue).toBe(expected.texts[0]);
		expect(controller.getTextNodes()[1]?.nodeValue).toBe(expected.texts[1]);
		expect(
			controller.getContainer()?.querySelector("a.internal-link")?.textContent,
		).toBe("内部");
		expect(
			controller.getContainer()?.querySelector("a.internal-link")?.getAttribute("href"),
		).toBe(hrefBefore);
		expect(controller.getContainer()?.querySelector("code")?.textContent).toBe(
			"code保護",
		);
	});

	it("does not tokenize across multiple reshuffles and always starts from original tokens", async () => {
		const tokenize = vi.fn();
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		const first = transformTokenSequences(bodySequences, pool, 0, MAX);
		controller.applyTransformedTexts(controller.getBodyGeneration(), first.texts);
		const seeds = [1, 2, 3];
		for (const seed of seeds) {
			expect(
				await runReshuffle({
					session,
					host: hostFrom(controller),
					issueSeed: () => seed,
					isAbandoned: () => false,
				}),
			).toBe("applied");
			const state = session.getState();
			expect(state.status).toBe("ready");
			if (state.status !== "ready") {
				return;
			}
			expect(state.bodySeed).toBe(seed);
			expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(
				transformTokenSequences(bodySequences, pool, seed, MAX).texts,
			);
			expect(state.tokenSequences).toBe(bodySequences);
			expect(state.pool).toBe(pool);
		}
		expect(tokenize).not.toHaveBeenCalled();
	});

	it("keeps the previous seed and DOM when seed issuance fails", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		const first = transformTokenSequences(bodySequences, pool, 0, MAX);
		controller.applyTransformedTexts(controller.getBodyGeneration(), first.texts);
		const before = controller.getTextNodes().map((node) => node.nodeValue);
		expect(
			await runReshuffle({
				session,
				host: hostFrom(controller),
				issueSeed: () => {
					throw new Error("crypto unavailable");
				},
				isAbandoned: () => false,
			}),
		).toBe("failed");
		const state = session.getState();
		expect(state.status).toBe("ready");
		if (state.status === "ready") {
			expect(state.bodySeed).toBe(0);
		}
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(before);
	});

	it("does not partially update when transform throws", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		const first = transformTokenSequences(bodySequences, pool, 0, MAX);
		controller.applyTransformedTexts(controller.getBodyGeneration(), first.texts);
		const before = controller.getTextNodes().map((node) => node.nodeValue);
		expect(
			await runReshuffle({
				session,
				host: hostFrom(controller),
				issueSeed: () => 1,
				isAbandoned: () => false,
				transform: () => {
					throw new Error("transform exploded");
				},
			}),
		).toBe("failed");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(before);
	});

	it("does not update a stale body generation", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		const first = transformTokenSequences(bodySequences, pool, 0, MAX);
		controller.applyTransformedTexts(controller.getBodyGeneration(), first.texts);
		const before = controller.getTextNodes().map((node) => node.nodeValue);
		let generation = controller.getBodyGeneration();
		expect(
			await runReshuffle({
				session,
				host: {
					getBodyGeneration: () => generation,
					getTextNodeCount: () => controller.getTextNodes().length,
					prepareResult: (gen, result) =>
						controller.prepareTransformedTexts(gen, result.texts)?.commit ?? null,
				},
				issueSeed: () => {
					generation += 1;
					return 1;
				},
				isAbandoned: () => false,
			}),
		).toBe("aborted");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(before);
		const state = session.getState();
		if (state.status === "ready") {
			expect(state.bodySeed).toBe(0);
		}
	});

	it("does not partially update when text counts mismatch", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		const first = transformTokenSequences(bodySequences, pool, 0, MAX);
		controller.applyTransformedTexts(controller.getBodyGeneration(), first.texts);
		const before = controller.getTextNodes().map((node) => node.nodeValue);
		expect(
			await runReshuffle({
				session,
				host: {
					getBodyGeneration: () => controller.getBodyGeneration(),
					getTextNodeCount: () => controller.getTextNodes().length,
					prepareResult: () => null,
				},
				issueSeed: () => 1,
				isAbandoned: () => false,
			}),
		).toBe("failed");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(before);
		const state = session.getState();
		if (state.status === "ready") {
			expect(state.bodySeed).toBe(0);
		}
	});

	it("keeps Seed, count and body when the preparation was superseded", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		controller.applyTransformedTexts(controller.getBodyGeneration(), transformTokenSequences(bodySequences, pool, 0, MAX).texts);
		const before = controller.getTextNodes().map((node) => node.nodeValue);
		for (const prepared of [{ status: "stale" as const }, { status: "prepared" as const, commit: () => "stale" as const }]) {
			expect(await runReshuffle({
				session,
				host: { ...hostFrom(controller), prepareResult: async () => prepared },
				issueSeed: () => 5,
				isAbandoned: () => false,
			})).toBe("aborted");
		}
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(before);
		const state = session.getState();
		expect(state.status === "ready" ? [state.bodySeed, state.replacementCount] : null).toEqual([0, 3]);
	});

	it("never commits a preparation that finished after the session moved on", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		const commit = vi.fn(() => "applied" as const);
		expect(await runReshuffle({
			session,
			host: {
				...hostFrom(controller),
				prepareResult: async () => {
					// An Open lands while the next body is being prepared.
					session.beginLoading();
					return { status: "prepared", commit };
				},
			},
			issueSeed: () => 5,
			isAbandoned: () => false,
		})).toBe("aborted");
		expect(commit).not.toHaveBeenCalled();
	});

	it("does not apply after the view is abandoned", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		const first = transformTokenSequences(bodySequences, pool, 0, MAX);
		controller.applyTransformedTexts(controller.getBodyGeneration(), first.texts);
		const before = controller.getTextNodes().map((node) => node.nodeValue);
		expect(
			await runReshuffle({
				session,
				host: hostFrom(controller),
				issueSeed: () => 1,
				isAbandoned: () => true,
			}),
		).toBe("aborted");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(before);
	});

	it("leaves original rendering in place when no slot is replaceable", async () => {
		const controller = await readyController("<p>猫</p>");
		const session = readySession(3, 0, bodySequences, {
			replaceableSlotCount: 0,
		});
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(["猫"]);
		expect(
			await runReshuffle({
				session,
				host: hostFrom(controller),
				issueSeed: () => 1,
				isAbandoned: () => false,
			}),
		).toBe("unavailable");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual(["猫"]);
		const state = session.getState();
		if (state.status === "ready") {
			expect(state.bodySeed).toBe(3);
			expect(state.replacementCount).toBe(0);
		}
	});

	it("rejects reentry while a reshuffle is busy", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const session = readySession(0);
		controller.applyTransformedTexts(
			controller.getBodyGeneration(),
			transformTokenSequences(bodySequences, pool, 0, MAX).texts,
		);
		const busy = new BusyGate();
		const nested = vi.fn();
		const outcome = await runReshuffleGuarded({
			busy,
			session,
			host: {
				...hostFrom(controller),
				prepareResult: async (generation, result) => {
					nested(
						await runReshuffleGuarded({
							busy,
							session,
							host: hostFrom(controller),
							issueSeed: () => 2,
							isAbandoned: () => false,
						}),
					);
					return controller.prepareTransformedTexts(generation, result.texts)?.commit ?? null;
				},
			},
			issueSeed: () => 1,
			isAbandoned: () => false,
		});
		expect(outcome).toBe("applied");
		expect(nested).toHaveBeenCalledWith("busy");
		expect(busy.isBusy()).toBe(false);
	});

	it("runs the busy hook before any transform, and not at all when unavailable", async () => {
		const controller = await readyController("<h1>猫は</h1><p>犬と鳥</p>");
		const order: string[] = [];
		const busy = new BusyGate();
		const transform = vi.fn((...args: Parameters<typeof transformTokenSequences>) => {
			order.push("transform");
			return transformTokenSequences(...args);
		});
		expect(await runReshuffleGuarded({
			busy, session: readySession(0), host: hostFrom(controller), issueSeed: () => 1, isAbandoned: () => false,
			transform, begin: () => { order.push(busy.isBusy() ? "begin(busy)" : "begin"); },
		})).toBe("applied");
		expect(order).toEqual(["begin(busy)", "transform"]);
		const begin = vi.fn();
		expect(await runReshuffleGuarded({
			busy, session: readySession(0, 0, bodySequences, { replaceableSlotCount: 0 }), host: hostFrom(controller),
			issueSeed: () => 1, isAbandoned: () => false, begin,
		})).toBe("unavailable");
		expect(begin).not.toHaveBeenCalled();
	});

	it("keeps protected DOM identity after several reshuffles", async () => {
		const controller = await readyController();
		const initial = transformTokenSequences(protectedSequences, pool, 0, MAX);
		const session = readySession(0, initial.replacementCount, protectedSequences);
		controller.applyTransformedTexts(controller.getBodyGeneration(), initial.texts);
		const heading = controller.getContainer()?.querySelector("h1");
		const link = controller.getContainer()?.querySelector("a.internal-link");
		for (const seed of [1, 2, 3]) {
			await runReshuffle({
				session,
				host: hostFrom(controller),
				issueSeed: () => seed,
				isAbandoned: () => false,
			});
		}
		expect(controller.getContainer()?.querySelector("h1")).toBe(heading);
		expect(controller.getContainer()?.querySelector("a.internal-link")).toBe(link);
		expect(link?.getAttribute("data-href")).toBe("note.md");
		expect(controller.getContainer()?.querySelector("code")?.textContent).toBe(
			"code保護",
		);
	});
});
