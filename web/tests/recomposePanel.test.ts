// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDomHelpers } from "../src/obsidian/domHelpers";
import { WebCollectionStorage } from "../src/host/webCollectionStorage";
import { WebLibrary } from "../src/host/WebLibrary";
import { WebSemantropyHost } from "../src/host/WebSemantropyHost";
import { RecomposePanel } from "../src/shell/RecomposePanel";
import type { EngineLoadState, WebTokenizer } from "../src/engine/WorkerTokenizer";

const tokenizer: WebTokenizer = {
	tokenize: async () => [],
	getLoadState: (): EngineLoadState => ({ status: "ready" }),
	onLoadState: () => () => undefined,
};

beforeAll(() => installDomHelpers());
afterEach(() => {
	document.body.replaceChildren();
	window.localStorage.clear();
});

describe("web Recompose panel", () => {
	it("enables Generate as soon as a text is pre-selected, without choosing it again (0.1.0 owner report)", () => {
		const library = new WebLibrary([]);
		const path = library.add("駅", "猫が森を見た。");
		const host = new WebSemantropyHost(library, new WebCollectionStorage(window.localStorage), tokenizer, window.localStorage);
		const panel = new RecomposePanel(host, () => undefined);
		document.body.appendChild(panel.el);
		const generate = (Reflect.get(panel, "buttons") as Map<string, HTMLButtonElement>).get("generate")!;
		expect(generate.disabled).toBe(true);
		panel.suggest(path);
		expect(Array.from(panel.el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter((box) => box.checked)).toHaveLength(1);
		expect(generate.disabled).toBe(false);
		// The heading carries no "experimental" label any more.
		expect(panel.el.querySelector("h2")?.textContent).toMatch(/^(再構成|Recompose)$/u);
	});
});
