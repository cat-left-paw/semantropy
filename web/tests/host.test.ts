// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDomHelpers } from "../src/obsidian/domHelpers";
import { WebCollectionStorage } from "../src/host/webCollectionStorage";
import { WebLibrary } from "../src/host/WebLibrary";
import { WebSemantropyHost } from "../src/host/WebSemantropyHost";
import type { EngineLoadState, WebTokenizer } from "../src/engine/WorkerTokenizer";
import { token } from "../../tests/tokenFixtures";

/** Every Han character is a common noun; everything else is an unknown symbol. */
function fakeTokenizer(): WebTokenizer & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		tokenize: async (text) => {
			calls.push(text);
			return Array.from(text, (surface) => token({ surface, ...(/\p{Script=Han}/u.test(surface) ? {} : { pos: "記号", isUnknown: true }) }));
		},
		getLoadState: (): EngineLoadState => ({ status: "ready" }),
		onLoadState: () => () => undefined,
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(check: () => boolean): Promise<void> {
	for (let i = 0; i < 200 && !check(); i += 1) await settle();
	expect(check()).toBe(true);
}

beforeAll(() => installDomHelpers());
afterEach(() => {
	document.body.replaceChildren();
	window.localStorage.clear();
});

async function openHost(text: string) {
	const library = new WebLibrary([]);
	const path = library.add("駅", text);
	const host = new WebSemantropyHost(library, new WebCollectionStorage(window.localStorage), fakeTokenizer(), window.localStorage);
	await host.start();
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = await host.mountView(parent);
	await host.openDocument(path);
	await waitFor(() => (parent.querySelector(".semantropy-body")?.textContent ?? "").length > 0);
	return { host, library, path, parent, view };
}

describe("web host", () => {
	it("opens a document through the shared View without changing the document", async () => {
		const text = "駅前の森で猫と犬が雨を見た。";
		const { library, path, parent } = await openHost(text);
		expect(parent.querySelector(".workspace-leaf-content")?.getAttribute("data-type")).toBe("semantropy-view");
		expect(parent.querySelector(".semantropy-toolbar")).not.toBeNull();
		expect(parent.querySelector(".semantropy-body")?.textContent).toHaveLength(text.length);
		expect(library.peekText(path)).toBe(text);
	});

	it("marks the Target stale when its document is edited, as a note edit does in Obsidian", async () => {
		const { library, path, parent } = await openHost("駅前の森で猫を見た。");
		library.setText(path, "駅前の森で犬を見た。");
		await waitFor(() => (parent.querySelector(".semantropy-status")?.textContent ?? "").length > 0);
		await waitFor(() => parent.querySelector(".semantropy-root .is-stale, .semantropy-status .is-stale, [data-stale='true']") !== null
			|| /古い|stale/iu.test(parent.textContent ?? ""));
	});

	it("collects a selected fragment into the browser Collection", async () => {
		const { host, parent, view } = await openHost("駅前の森で猫を見た。");
		const bodyText = parent.querySelector(".semantropy-body p")!;
		const range = document.createRange();
		range.selectNodeContents(bodyText);
		const result = await view.collectSelectedFragment({ selection: { rangeCount: 1, getRangeAt: () => range } });
		expect(result).toBe("created");
		const stored = host.collection.read(host.settings.getCollectionPath());
		expect(stored).toContain("semantropy-collection-version: 1");
		expect(stored).toContain(bodyText.textContent!.trim());
	});

	it("opens a definition from the shared word menu's Fake Dictionary item", async () => {
		const { parent } = await openHost("駅前の森で猫と犬が雨を見た。駅前の森で猫と犬が雨を見た。");
		const word = parent.querySelector<HTMLElement>(".semantropy-body .semantropy-dictionary-operable");
		expect(word).not.toBeNull();
		word!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		const item = [...parent.querySelectorAll<HTMLButtonElement>(".semantropy-manual-menu button")].find((button) => button.textContent === "でたらめ辞書で引く");
		expect(item).toBeDefined();
		item!.click();
		await waitFor(() => document.querySelector(".semantropy-dictionary-modal .semantropy-definition-text")?.textContent !== "");
		expect(document.querySelector(".semantropy-dictionary-modal .semantropy-definition-headword")?.textContent).toBe(word!.textContent);
	});

	it("opens a Fake Alert from the shared Toolbar with drawn icons, and Escape closes it (FAKE-ALERT-VIEW1)", async () => {
		const { parent } = await openHost("駅前の森で猫と犬が雨を見た。");
		const entry = parent.querySelector<HTMLButtonElement>(".semantropy-fake-alert-open");
		expect(entry?.getAttribute("aria-label")).toBe("不条理警告");
		// An id the page does not bundle would render an empty glyph.
		expect(entry!.querySelector("svg")!.childElementCount).toBeGreaterThan(0);
		// As from the keyboard: focus, then activate (jsdom does not move focus on click).
		entry!.focus();
		entry!.click();
		const dialog = document.querySelector<HTMLElement>(".semantropy-fake-alert");
		expect(dialog).not.toBeNull();
		for (const selector of [".semantropy-fake-alert-icon svg", ".semantropy-fake-alert-brand-icon svg"]) {
			expect(dialog!.querySelector(selector)!.childElementCount, selector).toBeGreaterThan(0);
		}
		expect(dialog!.querySelectorAll(".semantropy-fake-alert-buttons button").length).toBeGreaterThan(0);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		expect(document.querySelector(".semantropy-fake-alert")).toBeNull();
		expect(document.activeElement).toBe(entry);
	});

	it("bundles every icon a Fake Alert can show", async () => {
		const { createIcon } = await import("../src/obsidian/icons");
		const { FAKE_ALERT_BRAND_ICON, FAKE_ALERT_KIND_ICONS } = await import("../../src/view/FakeAlertModal");
		for (const id of [FAKE_ALERT_BRAND_ICON, ...Object.values(FAKE_ALERT_KIND_ICONS), "message-square-warning"]) {
			expect(createIcon(id).childElementCount, id).toBeGreaterThan(0);
		}
	});
});
