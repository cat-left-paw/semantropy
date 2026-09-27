// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { FakeDefinitionModal } from "../src/view/FakeDefinitionModal";
import type { FakeDefinitionViewModel } from "../src/view/fakeDefinitionViewModel";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";

const MARKUP = '<b>bold</b><script>alert(1)</script>{{place}}';

type DomInfo = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
	value?: string;
};

function applyDomInfo(el: HTMLElement, opts?: string | DomInfo): HTMLElement {
	if (opts == null) {
		return el;
	}
	if (typeof opts === "string") {
		el.className = opts;
		return el;
	}
	if (opts.cls) {
		el.className = opts.cls;
	}
	if (opts.text != null) {
		el.textContent = opts.text;
	}
	if (opts.attr) {
		for (const [key, value] of Object.entries(opts.attr)) {
			el.setAttribute(key, value);
		}
	}
	if (opts.value != null && "value" in el) {
		(el as HTMLElement & { value: string }).value = opts.value;
	}
	return el;
}

function installObsidianDomHelpers(): () => void {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	const previous = {
		empty: proto["empty"],
		setText: proto["setText"],
		createDiv: proto["createDiv"],
		createEl: proto["createEl"],
		createSpan: proto["createSpan"],
	};
	proto["empty"] = function empty(this: HTMLElement) {
		this.replaceChildren();
		return this;
	};
	proto["setText"] = function setText(this: HTMLElement, text: string) {
		this.textContent = text ?? "";
		return this;
	};
	proto["createDiv"] = function createDiv(
		this: HTMLElement,
		opts?: string | DomInfo,
	) {
		const el = this.ownerDocument.createElement("div");
		applyDomInfo(el, opts);
		this.appendChild(el);
		return el;
	};
	proto["createEl"] = function createEl(
		this: HTMLElement,
		tag: string,
		opts?: string | DomInfo,
	) {
		const el = this.ownerDocument.createElement(tag);
		applyDomInfo(el, opts);
		this.appendChild(el);
		return el;
	};
	proto["createSpan"] = function createSpan(this: HTMLElement, opts?: string | DomInfo) {
		const el = this.ownerDocument.createElement("span");
		applyDomInfo(el, opts);
		this.appendChild(el);
		return el;
	};
	return () => {
		proto["empty"] = previous.empty;
		proto["setText"] = previous.setText;
		proto["createDiv"] = previous.createDiv;
		proto["createSpan"] = previous.createSpan;
		proto["createEl"] = previous.createEl;
	};
}

function readyModel(definition: string): FakeDefinitionViewModel {
	return {
		status: "ready",
		headword: "猫",
		reading: "ネコ",
		posLabel: "名詞 · 一般",
		dictionarySemantropy: assertDictionarySemantropy(50),
		levelChoices: [{ value: assertDictionarySemantropy(50), label: "Medium" }],
		definition,
		message: null,
		reshuffleEnabled: true,
		copyEnabled: true,
		collectEnabled: true,
		levelControlEnabled: true,
	};
}

function expectNoSeedDom(root: HTMLElement): void {
	expect(root.querySelector(".semantropy-definition-seed")).toBeNull();
	expect(root.textContent ?? "").not.toMatch(/seed:/i);
}

function openModal(model: FakeDefinitionViewModel): FakeDefinitionModal {
	const modal = new FakeDefinitionModal({} as App, {
		getModel: () => model,
		onReshuffle: () => undefined,
		onCopy: () => undefined,
		onCollect: () => undefined,
		onSemantropyChange: () => undefined,
		onClosed: () => undefined,
	});
	modal.open();
	return modal;
}

describe("FakeDefinitionModal", () => {
	let restoreDom: () => void;
	beforeAll(() => {
		restoreDom = installObsidianDomHelpers();
	});
	afterAll(() => {
		restoreDom();
	});

	it("marks the Modal element so its width rule does not apply to the Popover", () => {
		const modal = openModal(readyModel("定義"));
		expect(modal.modalEl.classList.contains("semantropy-dictionary-modal")).toBe(true);
		expect(modal.contentEl.querySelector(".semantropy-dictionary-popover")).toBeNull();
		modal.close();
	});

	it("renders an HTML-like definition as text, never as markup", () => {
		const modal = openModal(readyModel(MARKUP));
		const text = modal.contentEl.querySelector(".semantropy-definition-text");
		expect(text?.textContent).toBe(MARKUP);
		expect(text?.querySelector("b")).toBeNull();
		expect(text?.querySelector("script")).toBeNull();
		expect(modal.contentEl.innerHTML).toContain("&lt;b&gt;");
		expectNoSeedDom(modal.contentEl);
		modal.close();
	});

	it("does not display a Seed in any Fake Dictionary state", () => {
		const shared = {
			headword: "猫",
			reading: "ネコ",
			posLabel: "名詞 · 一般",
			dictionarySemantropy: assertDictionarySemantropy(50),
			levelChoices: [
				{ value: assertDictionarySemantropy(50), label: "Medium" },
			],
			reshuffleEnabled: false,
			copyEnabled: false,
			collectEnabled: false,
			levelControlEnabled: false,
		} as const;
		const states: FakeDefinitionViewModel[] = [
			{
				...shared,
				status: "loading",
				headword: null,
				reading: null,
				posLabel: null,
				definition: null,
				message: "Generating…",
			},
			{
				...shared,
				status: "off",
				definition: null,
				message: "Off",
				levelControlEnabled: true,
			},
			{
				...shared,
				status: "insufficient",
				definition: null,
				message: "Not enough vocabulary",
				levelControlEnabled: true,
			},
			{
				...shared,
				status: "ready",
				definition: "定義",
				message: null,
				reshuffleEnabled: true,
				copyEnabled: true,
				collectEnabled: true,
				levelControlEnabled: true,
			},
			{
				...shared,
				status: "error",
				headword: null,
				reading: null,
				posLabel: null,
				definition: null,
				message: "Could not generate a definition.",
			},
		];
		for (const model of states) {
			const modal = openModal(model);
			expectNoSeedDom(modal.contentEl);
			modal.close();
		}
	});
});
