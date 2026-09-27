// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownRenderer } from "obsidian";
import { invokeSemantropyViewCommand } from "../src/application/selectSemantropyView";
import type { CollectFragmentInputV4 as CollectFragmentInput } from "../src/collect/v4/CollectedFragmentV4";
import type { CollectFragmentResultV4 as CollectFragmentResult } from "../src/collect/v4/CollectFragmentUseCaseV4";
import { COLLECT_SAVED_MESSAGE } from "../src/collect/collectMessages";
import { COPY_COPIED_MESSAGE } from "../src/copy/copyMessages";
import {
	COPY_DEFINITION_FAILED_MESSAGE,
	DEFINE_EMPTY_SELECTION_MESSAGE,
	DEFINE_LOADING_MESSAGE,
	DEFINE_MISSING_MODAL_MESSAGE,
	DEFINE_MISSING_VIEW_MESSAGE,
	DEFINE_MULTIPLE_TOKENS_MESSAGE,
	DEFINE_NOT_NOUN_MESSAGE,
	DEFINE_OFF_MESSAGE,
	DEFINE_UNKNOWN_WORD_MESSAGE,
	DICTIONARY_LEVEL_ERROR_MESSAGE,
} from "../src/application/fakeDictionaryMessages";
import type { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";
import type { DefineGenerate } from "../src/application/defineSelectedWord";
import {
	generateFakeDefinition,
	type FakeDefinitionResult,
} from "../src/dictionary/generateFakeDefinition";
import type { SemantropySession } from "../src/application/SemantropySession";
import type { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import {
	DEFAULT_BODY_SEMANTROPY,
	assertBodySemantropy,
} from "../src/settings/bodySemantropy";
import {
	DEFAULT_DICTIONARY_SEMANTROPY,
	assertDictionarySemantropy,
} from "../src/settings/dictionarySemantropy";
import type { JapaneseToken, JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import {
	SemantropyView,
	type SemantropyViewHost,
} from "../src/view/SemantropyView";
import type { BodySelectionSource } from "../src/view/readBodySelection";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";

const NOTE_TEXT = "太郎と猫と机と北海道";
const SOURCE_PATH = "notes/桜桃.md";
const HASH = "ab".repeat(32);
const ABSOLUTE = "/Users/hidden/vault/notes/桜桃.md";
const MARKUP = "<b>bold</b><script>alert(1)</script>{{place}}";

const person = (surface: string) =>
	token({ surface, detail1: "固有名詞", detail2: "人名" });
const place = (surface: string) =>
	token({ surface, detail1: "固有名詞", detail2: "地域" });
const particle = (surface: string) =>
	token({ surface, pos: "助詞", detail1: "並立助詞" });
const verb = (surface: string) => token({ surface, pos: "動詞", detail1: "自立" });

const NOTE_TOKENS: JapaneseToken[] = [
	person("太郎"),
	particle("と"),
	token({ surface: "猫" }),
	particle("と"),
	token({ surface: "机" }),
	particle("と"),
	place("北海道"),
];

expect(NOTE_TOKENS.map((entry) => entry.surface).join("")).toBe(NOTE_TEXT);

type DomInfo = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
	value?: string;
};

type ViewPeek = {
	session: SemantropySession;
	targetBody: ChunkTargetBodyController;
	dictionaryWorld: FakeDictionaryWorld;
	contentEl: HTMLElement;
	definitionModal: {
		contentEl: HTMLElement;
		isOpen(): boolean;
		close(): void;
	} | null;
	dictionaryBusy: { isBusy(): boolean };
};

function definitionActions(view: SemantropyView) {
	const root = peek(view).definitionModal?.contentEl;
	return {
		reshuffle: root?.querySelector<HTMLButtonElement>(
			".semantropy-reshuffle-definition",
		),
		copy: root?.querySelector<HTMLButtonElement>(".semantropy-copy-definition"),
		collect: root?.querySelector<HTMLButtonElement>(
			".semantropy-collect-definition",
		),
		level: root?.querySelector<HTMLSelectElement>(
			".semantropy-dictionary-level-select",
		),
	};
}

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

function lexiconTokenizer(
	calls: string[],
	overrides: {
		tokenize?: (text: string) => Promise<JapaneseToken[]>;
	} = {},
): JapaneseTokenizer {
	const map: Record<string, JapaneseToken[]> = {
		[NOTE_TEXT]: NOTE_TOKENS,
		太郎: [person("太郎")],
		猫: [token({ surface: "猫" })],
		机: [token({ surface: "机" })],
		北海道: [place("北海道")],
		未知語xyz: [token({ surface: "未知語xyz", isUnknown: true })],
		走る: [verb("走る")],
		"猫と机": [token({ surface: "猫" }), token({ surface: "机" })],
	};
	return {
		tokenize: async (text) => {
			calls.push(text);
			if (overrides.tokenize) {
				return await overrides.tokenize(text);
			}
			const tokens = map[text];
			if (tokens) {
				return tokens;
			}
			return [...text].map((surface) => token({ surface }));
		},
	};
}

function selectionInBody(
	view: SemantropyView,
	text: string,
): BodySelectionSource {
	const root = peek(view).targetBody.getContainer();
	if (!root) {
		throw new Error("expected a committed body");
	}
	if (!root.isConnected) {
		document.body.appendChild(root);
	}
	return {
		rangeCount: 1,
		getRangeAt: () => ({
			collapsed: false,
			commonAncestorContainer: root,
			toString: () => text,
		}),
	};
}

function editorSelection(text: string): BodySelectionSource {
	const outside = document.createElement("div");
	document.body.appendChild(outside);
	outside.textContent = text;
	return {
		rangeCount: 1,
		getRangeAt: () => ({
			collapsed: false,
			commonAncestorContainer: outside,
			toString: () => text,
		}),
	};
}

type HostSpies = {
	collectFragment: ReturnType<typeof vi.fn>;
	writeClipboard: ReturnType<typeof vi.fn>;
	showNotice: ReturnType<typeof vi.fn>;
	setBodySemantropy: ReturnType<typeof vi.fn>;
	setDictionarySemantropy: ReturnType<typeof vi.fn>;
	inputs: CollectFragmentInput[];
	clipboard: string[];
	notices: string[];
	bodySemantropy: number;
	dictionarySemantropy: number;
	tokenizeCalls: string[];
};

function createView(
	options: {
		collect?: (input: CollectFragmentInput) => Promise<CollectFragmentResult>;
		writeClipboard?: (text: string) => Promise<void>;
		dictionarySemantropy?: number;
		setDictionarySemantropy?: (value: number) => Promise<boolean>;
		tokenize?: (text: string) => Promise<JapaneseToken[]>;
	} = {},
): { view: SemantropyView; host: HostSpies } {
	const tokenizeCalls: string[] = [];
	const inputs: CollectFragmentInput[] = [];
	const clipboard: string[] = [];
	const notices: string[] = [];
	const spies: HostSpies = {
		collectFragment: vi.fn(),
		writeClipboard: vi.fn(),
		showNotice: vi.fn(),
		setBodySemantropy: vi.fn(),
		setDictionarySemantropy: vi.fn(),
		inputs,
		clipboard,
		notices,
		bodySemantropy: DEFAULT_BODY_SEMANTROPY,
		dictionarySemantropy: options.dictionarySemantropy ?? DEFAULT_DICTIONARY_SEMANTROPY,
		tokenizeCalls,
	};
	const collectFragment = vi.fn(
		async (input: CollectFragmentInput): Promise<CollectFragmentResult> => {
			inputs.push(input);
			if (options.collect) {
				return await options.collect(input);
			}
			return { status: "created" };
		},
	);
	const writeClipboard = vi.fn(async (text: string) => {
		clipboard.push(text);
		if (options.writeClipboard) {
			await options.writeClipboard(text);
		}
	});
	const showNotice = vi.fn((message: string) => {
		notices.push(message);
	});
	const setBodySemantropy = vi.fn(async (value: number) => {
		spies.bodySemantropy = value;
		return true;
	});
	const setDictionarySemantropy = vi.fn(async (value: number) => {
		if (options.setDictionarySemantropy) {
			return await options.setDictionarySemantropy(value);
		}
		spies.dictionarySemantropy = value;
		return true;
	});
	spies.collectFragment = collectFragment;
	spies.writeClipboard = writeClipboard;
	spies.showNotice = showNotice;
	spies.setBodySemantropy = setBodySemantropy;
	spies.setDictionarySemantropy = setDictionarySemantropy;
	const host: SemantropyViewHost = {
		getTokenizer: () => lexiconTokenizer(tokenizeCalls, { tokenize: options.tokenize }),
		readCurrentText: async () => NOTE_TEXT,
		getBodySemantropy: () => assertBodySemantropy(spies.bodySemantropy),
		setBodySemantropy,
		getDictionarySemantropy: () =>
			assertDictionarySemantropy(spies.dictionarySemantropy),
		setDictionarySemantropy,
		collectFragment,
		writeClipboard,
		showNotice,
	};
	const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
	(view as unknown as { app: App }).app = {} as App;
	const contentEl = document.createElement("div");
	document.body.appendChild(contentEl);
	peek(view).contentEl = contentEl;
	return { view, host: spies };
}

async function openReady(view: SemantropyView, seed = 7): Promise<void> {
	await view.onOpen();
	await view.openCapture(
		{
			kind: "markdown",
			note: {
				sourcePath: SOURCE_PATH,
				sourceName: "桜桃.md",
				editorText: NOTE_TEXT,
			},
		},
		{
			readCached: async () => NOTE_TEXT,
			hashText: async () => HASH,
			issueSeed: () => seed,
		},
	);
}

async function defineWord(
	view: SemantropyView,
	word: string,
	deps: {
		issueSeed?: () => number;
		generate?: DefineGenerate;
	} = {},
) {
	return await view.defineSelectedWord({
		selection: selectionInBody(view, word),
		issueSeed: deps.issueSeed ?? (() => 11),
		generate: deps.generate,
	});
}

function definitionText(view: SemantropyView): string | null {
	return (
		peek(view).definitionModal?.contentEl.querySelector(
			".semantropy-definition-text",
		)?.textContent ?? null
	);
}

async function flush(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) {
		await Promise.resolve();
	}
}

describe("SemantropyView Fake Dictionary", () => {
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

	afterEach(() => {
		window.getSelection()?.removeAllRanges();
		document.body.replaceChildren();
	});

	it("defines a single committed-body selection and ignores the Markdown editor", async () => {
		const { view, host } = createView();
		await openReady(view);
		const tokenizeBefore = host.tokenizeCalls.length;
		expect(await defineWord(view, "猫")).toBe("ready");
		expect(host.tokenizeCalls.slice(tokenizeBefore)).toEqual(["猫"]);
		const current = peek(view).dictionaryWorld.getCurrent();
		expect(current?.result.outcome).toBe("generated");
		if (current?.result.outcome !== "generated") {
			return;
		}
		expect(current.result.definition.length).toBeGreaterThan(0);
		expect(current.result.templateId.length).toBeGreaterThan(0);
		expect(current.dictionarySeed).toBe(11);
		expect(current.snapshot).toEqual({
			sourcePath: SOURCE_PATH,
			contentHash: HASH,
		});
		expect(definitionText(view)).toBe(current.result.definition);
		expect(await view.defineSelectedWord({ selection: editorSelection("猫") })).toBe(
			"empty",
		);
		expect(host.notices).toContain(DEFINE_EMPTY_SELECTION_MESSAGE);
		expect(peek(view).dictionaryWorld.getCurrent()?.result).toEqual(current.result);
	});

	it("notices a missing view and empty or whitespace selections", async () => {
		const invoked = invokeSemantropyViewCommand({
			activeView: null,
			existingViews: [],
			run: (view: SemantropyView) => view.defineSelectedWord(),
		});
		expect(invoked).toEqual({ status: "missing" });
		expect(DEFINE_MISSING_VIEW_MESSAGE).toBe("Open a Semantropy view first.");
		const { view, host } = createView();
		await openReady(view);
		expect(await view.defineSelectedWord({ selection: null })).toBe("empty");
		expect(await defineWord(view, "   ")).toBe("empty");
		expect(host.notices).toEqual([
			DEFINE_EMPTY_SELECTION_MESSAGE,
			DEFINE_EMPTY_SELECTION_MESSAGE,
		]);
	});

	it("rejects multiple tokens, unknown words and non-nouns in the modal", async () => {
		const { view, host } = createView();
		await openReady(view);
		expect(await defineWord(view, "猫と机")).toBe("rejected");
		expect(
			peek(view).definitionModal?.contentEl.textContent,
		).toContain(DEFINE_MULTIPLE_TOKENS_MESSAGE);
		expect(await defineWord(view, "未知語xyz")).toBe("rejected");
		expect(
			peek(view).definitionModal?.contentEl.textContent,
		).toContain(DEFINE_UNKNOWN_WORD_MESSAGE);
		expect(await defineWord(view, "走る")).toBe("rejected");
		expect(
			peek(view).definitionModal?.contentEl.textContent,
		).toContain(DEFINE_NOT_NOUN_MESSAGE);
		expect(JSON.stringify(host.notices)).not.toContain("猫と机");
		expect(JSON.stringify(host.notices)).not.toContain("未知語xyz");
	});

	it("reuses the dictionary Seed across Modal close and a later Define", async () => {
		const { view } = createView();
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		expect(peek(view).dictionaryWorld.getSeed()).toBe(11);
		const modal = peek(view).definitionModal;
		expect(modal?.isOpen()).toBe(true);
		modal?.close();
		expect(peek(view).dictionaryWorld.getSeed()).toBe(11);
		expect(peek(view).dictionaryWorld.getCurrent()).toBeNull();
		expect(await defineWord(view, "太郎", { issueSeed: () => 99 })).toBe("ready");
		expect(peek(view).dictionaryWorld.getSeed()).toBe(11);
		expect(peek(view).dictionaryWorld.getCurrent()?.headword.surface).toBe(
			"太郎",
		);
	});

	it("lets only Reshuffle definition update dictionary generation", async () => {
		const { view } = createView();
		await openReady(view, 7);
		expect(await defineWord(view, "猫")).toBe("ready");
		const first = peek(view).dictionaryWorld.getCurrent();
		if (first?.result.outcome !== "generated") {
			throw new Error("expected generated");
		}
		const bodyBefore = peek(view).session.getState();
		expect(await view.reshuffle({ issueSeed: () => 8 })).toBe("applied");
		expect(peek(view).dictionaryWorld.getSeed()).toBe(11);
		expect(peek(view).dictionaryWorld.getCurrent()?.result).toEqual(first.result);
		expect(peek(view).session.getState()).toMatchObject({
			status: "ready",
			bodySeed: 8,
		});
		expect(await view.setBodySemantropy(assertBodySemantropy(75))).toBe(
			"applied",
		);
		expect(peek(view).dictionaryWorld.getCurrent()?.result).toEqual(first.result);
		expect(peek(view).session.getState()).toMatchObject({
			bodySeed: 8,
			bodySemantropy: 75,
		});
		const tokenizeBefore = (
			view as unknown as { host: { getTokenizer(): JapaneseTokenizer } }
		).host;
		void tokenizeBefore;
		expect(
			view.reshuffleDefinition({ issueSeed: () => 22 }),
		).toBe("applied");
		const reshuffled = peek(view).dictionaryWorld.getCurrent();
		expect(reshuffled?.dictionarySeed).toBe(22);
		if (reshuffled?.result.outcome !== "generated") {
			throw new Error("expected generated");
		}
		expect(reshuffled.result.definition).not.toBe(first.result.definition);
		expect(peek(view).session.getState()).toMatchObject({
			bodySeed: 8,
			bodySemantropy: 75,
			snapshot: (bodyBefore as { snapshot: unknown }).snapshot,
		});
		const after = peek(view).session.getState();
		expect(after.status).toBe("ready");
		if (after.status !== "ready" || bodyBefore.status !== "ready") {
			return;
		}
		expect(after.freshness).toBe(bodyBefore.freshness);
	});

	it("does not re-tokenize when reshuffling a definition", async () => {
		const { view, host } = createView();
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		const afterDefine = host.tokenizeCalls.length;
		expect(view.reshuffleDefinition({ issueSeed: () => 22 })).toBe("applied");
		expect(host.tokenizeCalls.length).toBe(afterDefine);
	});

	it("does not change the body when Dictionary Semantropy changes", async () => {
		const { view, host } = createView();
		await openReady(view, 7);
		expect(await defineWord(view, "猫")).toBe("ready");
		const bodyText = peek(view)
			.targetBody.getTextNodes()
			.map((node) => node.nodeValue)
			.join("");
		expect(await view.setDictionarySemantropy(assertDictionarySemantropy(75))).toBe(
			"applied",
		);
		expect(host.setBodySemantropy).not.toHaveBeenCalled();
		expect(peek(view).session.getState()).toMatchObject({
			bodySeed: 7,
			bodySemantropy: DEFAULT_BODY_SEMANTROPY,
		});
		expect(
			peek(view)
				.targetBody.getTextNodes()
				.map((node) => node.nodeValue)
				.join(""),
		).toBe(bodyText);
		expect(peek(view).dictionaryWorld.getCurrent()?.dictionarySemantropy).toBe(
			75,
		);
	});

	it("keeps the displayed definition when Dictionary Semantropy save fails", async () => {
		const { view, host } = createView({
			setDictionarySemantropy: async () => false,
		});
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		const first = peek(view).dictionaryWorld.getCurrent();
		expect(
			await view.setDictionarySemantropy(assertDictionarySemantropy(100)),
		).toBe("failed");
		expect(peek(view).dictionaryWorld.getCurrent()).toEqual(first);
		expect(host.dictionarySemantropy).toBe(DEFAULT_DICTIONARY_SEMANTROPY);
		expect(peek(view).definitionModal?.contentEl.textContent).toContain(
			DICTIONARY_LEVEL_ERROR_MESSAGE,
		);
		expect(definitionText(view)).toBe(
			first?.result.outcome === "generated" ? first.result.definition : null,
		);
	});

	it("defines a saved Off at Medium and shows insufficient as a dedicated state", async () => {
		// PRE-RELEASE-EXPERIENCE-DICTIONARY-LEVEL1: Off is not a level; a saved 0 reads as the default.
		const off = createView({ dictionarySemantropy: 0 });
		await openReady(off.view);
		expect(await defineWord(off.view, "猫")).toBe("ready");
		const current = peek(off.view).dictionaryWorld.getCurrent();
		expect(current?.result.outcome).toBe("generated");
		expect(current?.dictionarySemantropy).toBe(50);
		expect(peek(off.view).definitionModal?.contentEl.textContent).not.toContain(
			DEFINE_OFF_MESSAGE,
		);
		const select = peek(off.view).definitionModal?.contentEl.querySelector<HTMLSelectElement>(
			".semantropy-dictionary-level-select",
		);
		expect(select?.value).toBe("50");
		expect(Array.from(select?.options ?? []).map((option) => option.value)).not.toContain("0");
		const insufficient = createView();
		await openReady(insufficient.view);
		expect(
			await defineWord(insufficient.view, "猫", {
				generate: () => ({
					outcome: "insufficient-vocabulary",
					missingPlaceholders: ["place"],
				}),
			}),
		).toBe("ready");
		expect(
			peek(insufficient.view).dictionaryWorld.getCurrent()?.result.outcome,
		).toBe("insufficient-vocabulary");
		expect(peek(insufficient.view).definitionModal?.contentEl.textContent).toContain(
			"enough vocabulary",
		);
		expect(peek(insufficient.view).definitionModal?.contentEl.textContent).not.toContain(
			"place",
		);
	});

	it("does not let an older Define overwrite a newer one", async () => {
		const hang = deferred<JapaneseToken[]>();
		let gated = false;
		const { view } = createView({
			tokenize: async (text) => {
				if (text === "猫" && !gated) {
					gated = true;
					return await hang.promise;
				}
				if (text === NOTE_TEXT) {
					return NOTE_TOKENS;
				}
				if (text === "太郎") {
					return [person("太郎")];
				}
				if (text === "猫") {
					return [token({ surface: "猫" })];
				}
				return [...text].map((surface) => token({ surface }));
			},
		});
		await openReady(view);
		const first = defineWord(view, "猫");
		await flush();
		expect(await defineWord(view, "太郎")).toBe("ready");
		expect(peek(view).dictionaryWorld.getCurrent()?.headword.surface).toBe(
			"太郎",
		);
		hang.resolve([token({ surface: "猫" })]);
		expect(await first).toBe("aborted");
		expect(peek(view).dictionaryWorld.getCurrent()?.headword.surface).toBe(
			"太郎",
		);
		expect(definitionText(view)).not.toBeNull();
	});

	it("does not leave the Modal loading when an empty selection aborts an in-flight Define", async () => {
		const hang = deferred<JapaneseToken[]>();
		const { view } = createView({
			tokenize: async (text) => {
				if (text === "猫") {
					return await hang.promise;
				}
				return text === NOTE_TEXT
					? NOTE_TOKENS
					: [...text].map((surface) => token({ surface }));
			},
		});
		await openReady(view);
		const pending = defineWord(view, "猫");
		await flush();
		expect(peek(view).definitionModal?.isOpen()).toBe(true);
		expect(peek(view).definitionModal?.contentEl.textContent).toContain(
			DEFINE_LOADING_MESSAGE,
		);
		expect(await view.defineSelectedWord({ selection: null })).toBe("empty");
		hang.resolve([token({ surface: "猫" })]);
		expect(await pending).toBe("aborted");
		expect(peek(view).definitionModal).toBeNull();
		expect(document.body.textContent).not.toContain(DEFINE_LOADING_MESSAGE);
	});

	it("revokes dictionary Busy when the Modal closes so a later Define is operable", async () => {
		const hang = deferred<CollectFragmentResult>();
		const later = deferred<CollectFragmentResult>();
		let collectCalls = 0;
		const { view } = createView({
			collect: async () => {
				collectCalls += 1;
				return collectCalls === 1 ? hang.promise : later.promise;
			},
		});
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		const firstCollect = view.collectDefinition();
		await flush();
		expect(peek(view).dictionaryBusy.isBusy()).toBe(true);
		expect(definitionActions(view).collect?.disabled).toBe(true);
		peek(view).definitionModal?.close();
		expect(peek(view).dictionaryBusy.isBusy()).toBe(false);
		expect(await defineWord(view, "太郎")).toBe("ready");
		expect(definitionText(view)?.length).toBeGreaterThan(0);
		const afterRedefine = definitionActions(view);
		expect(afterRedefine.reshuffle?.disabled).toBe(false);
		expect(afterRedefine.copy?.disabled).toBe(false);
		expect(afterRedefine.collect?.disabled).toBe(false);
		expect(afterRedefine.level?.disabled).toBe(false);

		const secondCollect = view.collectDefinition();
		await flush();
		expect(peek(view).dictionaryBusy.isBusy()).toBe(true);
		hang.resolve({ status: "created" });
		expect(await firstCollect).toBe("created");
		expect(peek(view).dictionaryBusy.isBusy()).toBe(true);
		expect(definitionActions(view).collect?.disabled).toBe(true);
		later.resolve({ status: "created" });
		expect(await secondCollect).toBe("created");
		expect(peek(view).dictionaryBusy.isBusy()).toBe(false);
		expect(definitionActions(view).collect?.disabled).toBe(false);
	});

	it("closes the Modal on Refresh and ignores the in-flight Define", async () => {
		const hang = deferred<JapaneseToken[]>();
		const { view } = createView({
			tokenize: async (text) => {
				if (text === "猫") {
					return await hang.promise;
				}
				if (text === NOTE_TEXT) {
					return NOTE_TOKENS;
				}
				return [...text].map((surface) => token({ surface }));
			},
		});
		await openReady(view, 7);
		const pending = defineWord(view, "猫");
		await flush();
		expect(peek(view).definitionModal?.isOpen()).toBe(true);
		expect(await view.refreshSource({ issueSeed: () => 9, hashText: async () => HASH })).toBe(
			"refreshed",
		);
		expect(peek(view).definitionModal).toBeNull();
		expect(peek(view).dictionaryWorld.getCurrent()).toBeNull();
		expect(peek(view).dictionaryWorld.getSeed()).toBe(11);
		hang.resolve([token({ surface: "猫" })]);
		expect(await pending).toBe("aborted");
		expect(peek(view).definitionModal).toBeNull();
		expect(document.querySelector(".semantropy-definition-text")).toBeNull();
		expect(peek(view).session.getState()).toMatchObject({ bodySeed: 9 });
	});

	it("does not show an in-flight result after the Modal or View closes", async () => {
		const hang = deferred<JapaneseToken[]>();
		const first = createView({
			tokenize: async (text) => {
				if (text === "猫") {
					return await hang.promise;
				}
				return text === NOTE_TEXT
					? NOTE_TOKENS
					: [...text].map((surface) => token({ surface }));
			},
		});
		await openReady(first.view);
		const pendingModal = defineWord(first.view, "猫");
		await flush();
		peek(first.view).definitionModal?.close();
		hang.resolve([token({ surface: "猫" })]);
		expect(await pendingModal).toBe("aborted");
		expect(peek(first.view).definitionModal).toBeNull();
		expect(document.querySelector(".semantropy-definition-text")).toBeNull();

		const hangView = deferred<JapaneseToken[]>();
		const second = createView({
			tokenize: async (text) => {
				if (text === "猫") {
					return await hangView.promise;
				}
				return text === NOTE_TEXT
					? NOTE_TOKENS
					: [...text].map((surface) => token({ surface }));
			},
		});
		await openReady(second.view);
		const pendingView = defineWord(second.view, "猫");
		await flush();
		await second.view.onClose();
		hangView.resolve([token({ surface: "猫" })]);
		expect(await pendingView).toBe("aborted");
		expect(document.querySelector(".semantropy-definition")).toBeNull();
	});

	it("renders an HTML-like definition as text", async () => {
		const { view } = createView();
		await openReady(view);
		expect(
			await defineWord(view, "猫", {
				generate: (): FakeDefinitionResult => ({
					outcome: "generated",
					definition: MARKUP,
					templateId: "html-fixture",
					family: "custom",
					optionalClauseIds: [],
					dictionarySeed: 11,
					dictionarySemantropy: 50,
					dictionaryBucket: "medium",
					algorithmVersion: 1,
					templateSetVersion: 1,
					definitionSeed: 1,
					headword: "猫",
					headwordIdentity: {
						baseForm: "猫",
						reading: null,
						pos: "名詞",
						detail1: "一般",
						detail2: "*",
					},
				}),
			}),
		).toBe("ready");
		const text = peek(view).definitionModal?.contentEl.querySelector(
			".semantropy-definition-text",
		);
		expect(text?.textContent).toBe(MARKUP);
		expect(text?.querySelector("b")).toBeNull();
		expect(text?.querySelector("script")).toBeNull();
		expect(
			peek(view).definitionModal?.contentEl.querySelector(
				".semantropy-definition-seed",
			),
		).toBeNull();
		expect(peek(view).definitionModal?.contentEl.textContent ?? "").not.toMatch(
			/seed:/i,
		);
	});

	it("copies the full definition once and does not retry on failure", async () => {
		const { view, host } = createView();
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		const definition = definitionText(view);
		expect(definition).toBeTruthy();
		expect(await view.copyDefinition()).toBe("copied");
		// EXPERIENCE-DICTIONARY-OUTPUT1: the headword, one LF, the definition.
		expect(host.clipboard).toEqual([`猫
${definition}`]);
		expect(host.notices).toEqual([COPY_COPIED_MESSAGE]);
		const failing = createView({
			writeClipboard: async () => {
				throw new Error(`could not copy ${NOTE_TEXT}`);
			},
		});
		await openReady(failing.view);
		expect(await defineWord(failing.view, "猫")).toBe("ready");
		expect(await failing.view.copyDefinition()).toBe("failed");
		expect(failing.host.writeClipboard).toHaveBeenCalledTimes(1);
		expect(failing.host.notices).toEqual([COPY_DEFINITION_FAILED_MESSAGE]);
		expect(JSON.stringify(failing.host.notices)).not.toContain(NOTE_TEXT);
	});

	it("collects dictionary metadata only, one entry, without writing the source note", async () => {
		const { view, host } = createView();
		await openReady(view, 7);
		expect(await defineWord(view, "猫")).toBe("ready");
		const current = peek(view).dictionaryWorld.getCurrent();
		if (current?.result.outcome !== "generated") {
			throw new Error("expected generated");
		}
		expect(await view.collectDefinition()).toBe("created");
		expect(host.inputs).toEqual([
			{
				type: "fake-dictionary",
				metadataVersion: 4,
				text: `${current.headword.surface}
${current.result.definition}`,
				target: { path: SOURCE_PATH, contentHash: HASH },
				vocabulary: current.vocabulary,
				dictionarySemantropy: DEFAULT_DICTIONARY_SEMANTROPY,
				algorithmVersion: current.result.algorithmVersion,
				templateId: current.result.templateId,
				templateSetVersion: current.result.templateSetVersion,
			},
		]);
		expect(host.inputs[0]).not.toHaveProperty("bodySeed");
		expect(host.inputs[0]).not.toHaveProperty("dictionarySeed");
		expect(host.inputs[0]).not.toHaveProperty("seed");
		expect(host.inputs[0]).not.toHaveProperty("bodySemantropy");
		expect(JSON.stringify(host.inputs[0])).not.toContain(NOTE_TEXT);
		expect(JSON.stringify(host.inputs[0])).not.toContain(ABSOLUTE);
		expect(host.notices).toContain(COLLECT_SAVED_MESSAGE);
		expect(host.setBodySemantropy).not.toHaveBeenCalled();
	});

	it("takes busy before the first await so double click writes once", async () => {
		const hang = deferred<CollectFragmentResult>();
		const { view, host } = createView({
			collect: async () => hang.promise,
		});
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		const first = view.collectDefinition();
		const second = view.collectDefinition();
		await flush();
		expect(host.collectFragment).toHaveBeenCalledTimes(1);
		hang.resolve({ status: "created" });
		expect(await first).toBe("created");
		expect(await second).toBe("busy");
		expect(await view.copyDefinition()).toBe("copied");
		const copyHang = deferred<void>();
		const copying = createView({
			writeClipboard: async () => copyHang.promise,
		});
		await openReady(copying.view);
		expect(await defineWord(copying.view, "猫")).toBe("ready");
		const copyFirst = copying.view.copyDefinition();
		const copySecond = copying.view.copyDefinition();
		await flush();
		copyHang.resolve();
		expect(await copyFirst).toBe("copied");
		expect(await copySecond).toBe("busy");
		expect(copying.host.writeClipboard).toHaveBeenCalledTimes(1);
	});

	it("does not persist generation state, definition, headword or pool to View state", async () => {
		const { view, host } = createView();
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		expect(view.getState()).toEqual({});
		expect(host.setDictionarySemantropy).not.toHaveBeenCalled();
		expect(host.setBodySemantropy).not.toHaveBeenCalled();
	});

	it("uses the same View method from the Modal button and the command", async () => {
		const { view } = createView();
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		const spy = vi.spyOn(view, "reshuffleDefinition");
		peek(view)
			.definitionModal?.contentEl.querySelector<HTMLButtonElement>(
				".semantropy-reshuffle-definition",
			)
			?.click();
		const invoked = invokeSemantropyViewCommand({
			activeView: view,
			existingViews: [view],
			run: (target) => target.reshuffleDefinition({ issueSeed: () => 30 }),
		});
		expect(invoked.status).toBe("ran");
		expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("treats Reshuffle definition without a Modal as unavailable", async () => {
		const { view, host } = createView();
		await openReady(view);
		expect(view.reshuffleDefinition()).toBe("unavailable");
		expect(host.notices).toEqual([DEFINE_MISSING_MODAL_MESSAGE]);
		expect(await view.copyDefinition()).toBe("empty");
		expect(host.notices).toEqual([
			DEFINE_MISSING_MODAL_MESSAGE,
			DEFINE_MISSING_MODAL_MESSAGE,
		]);
	});

	it("matches generateFakeDefinition for the committed result", async () => {
		const { view } = createView();
		await openReady(view);
		expect(await defineWord(view, "猫")).toBe("ready");
		const current = peek(view).dictionaryWorld.getCurrent();
		if (current?.result.outcome !== "generated") {
			throw new Error("expected generated");
		}
		expect(
			generateFakeDefinition({
				headword: current.headword,
				pool: current.pool,
				dictionarySeed: current.dictionarySeed,
				dictionarySemantropy: current.dictionarySemantropy,
			}),
		).toEqual(current.result);
	});
});
