// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MarkdownBodyController } from "../src/render/markdownBodyController";
import type { MarkdownRenderHost } from "../src/render/markdownBodyController";

function fillHtml(container: HTMLElement, html: string): void {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const imported = Array.from(parsed.body.childNodes).map((node) =>
		container.ownerDocument.importNode(node, true),
	);
	container.replaceChildren(...imported);
}

function createHost(
	renderMarkdown: MarkdownRenderHost["renderMarkdown"],
	unload = vi.fn(),
): {
	host: MarkdownRenderHost;
	unload: ReturnType<typeof vi.fn>;
	container: HTMLElement;
} {
	const container = document.createElement("div");
	return {
		unload,
		container,
		host: {
			createOwner: () => ({ unload }),
			createContainer: () => container,
			renderMarkdown,
		},
	};
}

/** A render host that fills the container with fixed markup. */
function htmlHost(html: string) {
	return createHost(async ({ container }) => {
		fillHtml(container, html);
	});
}

describe("MarkdownBodyController", () => {
	it("ignores a stale markdown render and unloads its owner", async () => {
		const controller = new MarkdownBodyController();
		let current = 0;
		const isCurrent = (requestId: number) => requestId === current;

		let finishFirst: (() => void) | undefined;
		const firstRender = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const first = createHost(async ({ container }) => {
			await firstRender;
			fillHtml(container, "<p>note A 駅</p>");
		});
		const second = createHost(async ({ container, sourcePath }) => {
			expect(sourcePath).toBe("b.md");
			fillHtml(container, "<p>note B 病院</p>");
		});

		current = 1;
		const firstJob = controller.renderIfCurrent(
			1,
			{ text: "A", sourcePath: "a.md" },
			isCurrent,
			first.host,
		);

		current = 2;
		controller.release();
		expect(first.unload).toHaveBeenCalledTimes(1);
		const secondStatus = await controller.renderIfCurrent(
			2,
			{ text: "B", sourcePath: "b.md" },
			isCurrent,
			second.host,
		);
		expect(secondStatus).toBe("attached");
		expect(controller.getContainer()?.textContent).toContain("note B 病院");

		finishFirst?.();
		await expect(firstJob).resolves.toBe("stale");
		expect(first.unload).toHaveBeenCalled();
		expect(controller.getContainer()?.textContent).toContain("note B 病院");
		expect(controller.getContainer()?.textContent).not.toContain("note A");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual([
			"note B 病院",
		]);
	});

	it("releases the previous owner and text node references on rerender", async () => {
		const controller = new MarkdownBodyController();
		const first = createHost(async ({ container }) => {
			fillHtml(container, "<p>first 駅</p>");
		});
		await controller.renderIfCurrent(
			1,
			{ text: "first", sourcePath: "a.md" },
			() => true,
			first.host,
		);
		const firstNodes = controller.getTextNodes();
		expect(firstNodes).toHaveLength(1);

		controller.release();
		expect(first.unload).toHaveBeenCalled();
		expect(controller.getContainer()).toBeNull();
		expect(controller.getTextNodes()).toEqual([]);

		const second = createHost(async ({ container }) => {
			fillHtml(container, "<p>second 花子</p>");
		});
		await controller.renderIfCurrent(
			2,
			{ text: "second", sourcePath: "b.md" },
			() => true,
			second.host,
		);
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual([
			"second 花子",
		]);
		expect(firstNodes[0]?.nodeValue).toBe("first 駅");
	});

	it("unloads the candidate owner and clears the body on render failure", async () => {
		const controller = new MarkdownBodyController();
		const failed = createHost(async () => {
			throw new Error("renderer exploded");
		});
		const status = await controller.renderIfCurrent(
			1,
			{ text: "secret body", sourcePath: "a.md" },
			() => true,
			failed.host,
		);
		expect(status).toBe("error");
		expect(failed.unload).toHaveBeenCalled();
		expect(controller.getContainer()).toBeNull();
		expect(controller.getTextNodes()).toEqual([]);
	});

	it("does not keep a previous body after a failed current render", async () => {
		const controller = new MarkdownBodyController();
		const first = createHost(async ({ container }) => {
			fillHtml(container, "<p>previous 駅</p>");
		});
		await controller.renderIfCurrent(
			1,
			{ text: "previous", sourcePath: "a.md" },
			() => true,
			first.host,
		);
		expect(controller.getContainer()?.textContent).toContain("previous 駅");

		const failed = createHost(async () => {
			throw new Error("renderer exploded");
		});
		const status = await controller.renderIfCurrent(
			2,
			{ text: "secret body", sourcePath: "b.md" },
			() => true,
			failed.host,
		);
		expect(status).toBe("error");
		expect(failed.unload).toHaveBeenCalled();
		expect(first.unload).toHaveBeenCalled();
		expect(controller.getContainer()).toBeNull();
		expect(controller.getTextNodes()).toEqual([]);
	});

	it("unloads an in-flight owner on release and ignores it when it finishes later", async () => {
		const controller = new MarkdownBodyController();
		let finishRender: (() => void) | undefined;
		const renderGate = new Promise<void>((resolve) => {
			finishRender = resolve;
		});
		const pending = createHost(async ({ container }) => {
			await renderGate;
			fillHtml(container, "<p>late 駅</p>");
		});

		const job = controller.renderIfCurrent(
			1,
			{ text: "late", sourcePath: "a.md" },
			() => true,
			pending.host,
		);
		expect(pending.unload).not.toHaveBeenCalled();

		controller.release();
		expect(pending.unload).toHaveBeenCalledTimes(1);
		expect(controller.getContainer()).toBeNull();
		expect(controller.getTextNodes()).toEqual([]);

		finishRender?.();
		await expect(job).resolves.toBe("stale");
		expect(controller.getContainer()).toBeNull();
		expect(controller.getTextNodes()).toEqual([]);
		expect(pending.unload).toHaveBeenCalledTimes(1);
	});

	it("applies transformed texts only to the current generation", async () => {
		const controller = new MarkdownBodyController();
		const host = createHost(async ({ container }) => {
			fillHtml(container, "<p>猫</p><p>犬</p>");
		});
		await controller.renderIfCurrent(
			1,
			{ text: "body", sourcePath: "a.md" },
			() => true,
			host.host,
		);
		const generation = controller.getBodyGeneration();
		expect(
			controller.applyTransformedTexts(generation, ["鳥", "猫"]),
		).toBe("applied");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual([
			"鳥",
			"猫",
		]);

		const staleNodes = [...controller.getTextNodes()];
		controller.release();
		expect(controller.applyTransformedTexts(generation, ["魚", "馬"])).toBe(
			"stale",
		);
		expect(staleNodes.map((node) => node.nodeValue)).toEqual(["鳥", "猫"]);
	});
});

describe("MarkdownBodyController prepare/commit", () => {
	it("validates without writing, then writes every node at once", async () => {
		const controller = new MarkdownBodyController();
		await controller.renderIfCurrent(
			1,
			{ text: "body", sourcePath: "note.md" },
			() => true,
			htmlHost("<p>猫</p><p>犬</p>").host,
		);
		const generation = controller.getBodyGeneration();

		const prepared = controller.prepareTransformedTexts(generation, [
			"鳥",
			"魚",
		]);
		expect(prepared).not.toBeNull();
		// Preparing must not have touched the body.
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual([
			"猫",
			"犬",
		]);

		expect(prepared?.commit()).toBe("applied");
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual([
			"鳥",
			"魚",
		]);
	});

	it("refuses a text count that does not match, without writing", async () => {
		const controller = new MarkdownBodyController();
		await controller.renderIfCurrent(
			1,
			{ text: "body", sourcePath: "note.md" },
			() => true,
			htmlHost("<p>猫</p><p>犬</p>").host,
		);

		expect(
			controller.prepareTransformedTexts(controller.getBodyGeneration(), [
				"鳥",
			]),
		).toBeNull();
		expect(
			controller.prepareTransformedTexts(controller.getBodyGeneration(), [
				"鳥",
				"魚",
				"虫",
			]),
		).toBeNull();
		expect(controller.getTextNodes().map((node) => node.nodeValue)).toEqual([
			"猫",
			"犬",
		]);
	});

	it("refuses a generation that has already moved on", async () => {
		const controller = new MarkdownBodyController();
		await controller.renderIfCurrent(
			1,
			{ text: "body", sourcePath: "note.md" },
			() => true,
			htmlHost("<p>猫</p>").host,
		);
		const stale = controller.getBodyGeneration() - 1;

		expect(controller.prepareTransformedTexts(stale, ["鳥"])).toBeNull();
	});

	it("commits nothing when the body was released after preparing", async () => {
		const controller = new MarkdownBodyController();
		await controller.renderIfCurrent(
			1,
			{ text: "body", sourcePath: "note.md" },
			() => true,
			htmlHost("<p>猫</p>").host,
		);
		const nodes = controller.getTextNodes();
		const prepared = controller.prepareTransformedTexts(
			controller.getBodyGeneration(),
			["鳥"],
		);

		controller.release();

		expect(prepared?.commit()).toBe("stale");
		expect(nodes.map((node) => node.nodeValue)).toEqual(["猫"]);
	});
});
