// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownRenderer } from "obsidian";
import { ANALYZE_ERROR_MESSAGE } from "../src/application/analyzeNoteTexts";
import type { TargetBodyController } from "../src/render/targetBodyController";
import type { SemantropySession } from "../src/application/SemantropySession";
import { DEFAULT_BODY_SEMANTROPY } from "../src/settings/bodySemantropy";
import { DEFAULT_DICTIONARY_SEMANTROPY } from "../src/settings/dictionarySemantropy";
import type { JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import {
	SemantropyView,
	type SemantropyViewHost,
} from "../src/view/SemantropyView";

const NOTE_TEXT = "秘密の本文・太郎は駅にいた";
const SOURCE_PATH = "notes/secret.md";
const ABSOLUTE_PATH = "/Users/hidden/vault/dict/ipadic";

type DomInfo = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
	value?: string;
};

type ViewPeek = {
	session: SemantropySession;
	targetBody: TargetBodyController;
	bodyEl: HTMLElement | null;
	contentEl: HTMLElement;
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
		toggleClass: proto["toggleClass"],
		createDiv: proto["createDiv"],
		createEl: proto["createEl"],
		createSpan: proto["createSpan"],
		createDivGlobal: Reflect.get(globalThis, "createDiv"),
		hasCreateDiv: Object.prototype.hasOwnProperty.call(globalThis, "createDiv"),
	};

	proto["empty"] = function empty(this: HTMLElement) {
		this.replaceChildren();
		return this;
	};
	proto["setText"] = function setText(this: HTMLElement, text: string) {
		this.textContent = text ?? "";
		return this;
	};
	proto["toggleClass"] = function toggleClass(
		this: HTMLElement,
		cls: string,
		on: boolean,
	) {
		this.classList.toggle(cls, on);
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
	Reflect.set(globalThis, "createDiv", (opts?: string | DomInfo) => {
		const el = document.createElement("div");
		applyDomInfo(el, opts);
		return el;
	});

	proto["createSpan"] = function createSpan(this: HTMLElement, opts?: string | DomInfo) {
		const el = this.ownerDocument.createElement("span");
		applyDomInfo(el, opts);
		this.appendChild(el);
		return el;
	};
	return () => {
		proto["empty"] = previous.empty;
		proto["setText"] = previous.setText;
		proto["toggleClass"] = previous.toggleClass;
		proto["createDiv"] = previous.createDiv;
		proto["createSpan"] = previous.createSpan;
		proto["createEl"] = previous.createEl;
		if (previous.hasCreateDiv) {
			Reflect.set(globalThis, "createDiv", previous.createDivGlobal);
		} else {
			Reflect.deleteProperty(globalThis, "createDiv");
		}
	};
}

function peek(view: SemantropyView): ViewPeek {
	return view as unknown as ViewPeek;
}

function createView(getTokenizer: SemantropyViewHost["getTokenizer"]): SemantropyView {
	const host: SemantropyViewHost = {
		getTokenizer,
		readCurrentText: async () => NOTE_TEXT,
		getBodySemantropy: () => DEFAULT_BODY_SEMANTROPY,
		setBodySemantropy: async () => true,
		getDictionarySemantropy: () => DEFAULT_DICTIONARY_SEMANTROPY,
		setDictionarySemantropy: async () => true,
		collectFragment: async () => ({ status: "failed" }),
		writeClipboard: async () => undefined,
		showNotice: () => undefined,
	};
	const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
	(view as unknown as { app: App }).app = {} as App;
	peek(view).contentEl = document.createElement("div");
	return view;
}

async function openNote(view: SemantropyView): Promise<void> {
	await view.openCapture(
		{
			kind: "markdown",
			note: {
				sourcePath: SOURCE_PATH,
				sourceName: "secret.md",
				editorText: NOTE_TEXT,
			},
		},
		{
			readCached: async () => NOTE_TEXT,
			hashText: async (text) => `hash(${text.length})`,
			issueSeed: () => 1,
		},
	);
}

function expectNoSensitiveLeak(values: unknown[]): void {
	const serialized = JSON.stringify(values);
	expect(serialized).not.toContain(NOTE_TEXT);
	expect(serialized).not.toContain(ABSOLUTE_PATH);
	expect(serialized).not.toContain("/Users/hidden");
}

describe("SemantropyView Open analysis failures", () => {
	let restoreDom: () => void;

	beforeAll(() => {
		restoreDom = installObsidianDomHelpers();
		MarkdownRenderer.render = async (_app, markdown, container) => {
			const paragraph = container.ownerDocument.createElement("p");
			paragraph.textContent = markdown;
			container.appendChild(paragraph);
		};
	});

	afterAll(() => {
		restoreDom();
	});

	async function expectAnalysisFailure(
		getTokenizer: SemantropyViewHost["getTokenizer"],
	): Promise<void> {
		const view = createView(getTokenizer);
		const internals = peek(view);
		const errors: unknown[][] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args);
		};
		const rejections: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			rejections.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);
		try {
			await expect(openNote(view)).resolves.toBeUndefined();
			await new Promise((resolve) => setImmediate(resolve));
			expect(rejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
			console.error = originalError;
		}

		expect(internals.session.getState()).toEqual({
			status: "error",
			message: ANALYZE_ERROR_MESSAGE,
		});
		expect(internals.targetBody.getContainer()).toBeNull();
		expect(internals.targetBody.getTextNodes()).toEqual([]);
		expect(internals.bodyEl).toBeNull();
		expect(internals.contentEl.querySelector(".semantropy-body")).toBeNull();
		expect(internals.contentEl.querySelector(".semantropy-seed")).toBeNull();
		expect(internals.contentEl.textContent ?? "").not.toMatch(/seed:/i);
		expect(
			internals.contentEl.querySelector(".semantropy-message")?.textContent,
		).toBe(ANALYZE_ERROR_MESSAGE);
		expect(errors).toEqual([["[Semantropy] failed to analyze the note"]]);
		expectNoSensitiveLeak(errors);
	}

	it("routes a synchronous tokenizer provider throw into the generic analysis error", async () => {
		await expectAnalysisFailure(() => {
			throw new Error(`dictionary missing at ${ABSOLUTE_PATH}`);
		});
	});

	it("routes a WASM / dictionary initialization reject into the generic analysis error", async () => {
		const tokenizer: JapaneseTokenizer = {
			tokenize: () =>
				Promise.reject(
					new Error(`WebAssembly.instantiate failed for ${ABSOLUTE_PATH}`),
				),
		};
		await expectAnalysisFailure(() => tokenizer);
	});

	it("routes a tokenize reject into the generic analysis error", async () => {
		const tokenizer: JapaneseTokenizer = {
			tokenize: async () => {
				throw new Error(`analysis failed for ${NOTE_TEXT}`);
			},
		};
		await expectAnalysisFailure(() => tokenizer);
	});
});
