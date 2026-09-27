import { sha256Hex } from "../src/vocabulary/sha256";
// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownRenderer } from "obsidian";
import { invokeSemantropyViewCommand } from "../src/application/selectSemantropyView";
import type { CollectFragmentInputV4 as CollectFragmentInput } from "../src/collect/v4/CollectedFragmentV4";
import {
	collectFragmentV4 as collectFragment,
	type CollectFragmentResultV4 as CollectFragmentResult,
} from "../src/collect/v4/CollectFragmentUseCaseV4";
import {
	COLLECT_EMPTY_SELECTION_MESSAGE,
	COLLECT_FAILED_MESSAGE,
	COLLECT_PATH_INVALID_MESSAGE,
	COLLECT_PATH_IS_FOLDER_MESSAGE,
	COLLECT_PATH_NOT_MARKDOWN_MESSAGE,
	COLLECT_PATH_PARENT_MISSING_MESSAGE,
	COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE,
	COLLECT_SAVED_MESSAGE,
} from "../src/collect/collectMessages";
import { MarkdownFragmentRepositoryV4 as MarkdownFragmentRepository } from "../src/collect/v4/FragmentRepositoryV4";
import type { CollectionStorage } from "../src/collect/CollectionStorage";
import {
	COPY_COPIED_MESSAGE,
	COPY_EMPTY_SELECTION_MESSAGE,
	COPY_FAILED_MESSAGE,
} from "../src/copy/copyMessages";
import { DEFAULT_BODY_SEMANTROPY } from "../src/settings/bodySemantropy";
import { DEFAULT_DICTIONARY_SEMANTROPY } from "../src/settings/dictionarySemantropy";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";
import type { JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import {
	SemantropyView,
	type SemantropyViewHost,
} from "../src/view/SemantropyView";
import type { BodySelectionSource } from "../src/view/readBodySelection";
import type { ChunkTargetBodyController } from "../src/render/chunkTargetBodyController";
import { collectVocabularyFromSnapshot } from "../src/application/collectVocabulary";
import type { SemantropySession } from "../src/application/SemantropySession";
import { token } from "./tokenFixtures";
import { deferred } from "./refreshHarness";

const NOTE_TEXT = "太郎は駅で花子を待っていた。";
const SOURCE_PATH = "notes/桜桃.md";
const HASH = sha256Hex(NOTE_TEXT);
const SELECTED = "おかき的な自殺";
const ABSOLUTE = "/Users/hidden/vault/notes/桜桃.md";

type DomInfo = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
	value?: string;
};

type ViewPeek = {
	session: SemantropySession;
	targetBody: ChunkTargetBodyController;
	lifecycle: { busy: { acquire(): number | null; isBusy(): boolean } };
	contentEl: HTMLElement;
	renderShell: () => void;
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

function characterTokenizer(): JapaneseTokenizer {
	return {
		tokenize: async (text) => [...text].map((surface) => token({ surface })),
	};
}

function selectionInBody(
	view: SemantropyView,
	text: string = SELECTED,
): BodySelectionSource {
	const root = peek(view).targetBody.getContainer();
	if (!root) {
		throw new Error("expected a committed body");
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

type HostSpies = {
	collectFragment: ReturnType<typeof vi.fn>;
	writeClipboard: ReturnType<typeof vi.fn>;
	showNotice: ReturnType<typeof vi.fn>;
	inputs: CollectFragmentInput[];
	clipboard: string[];
	notices: string[];
};

function createView(options: {
	collect?: (input: CollectFragmentInput) => Promise<CollectFragmentResult>;
	writeClipboard?: (text: string) => Promise<void>;
} = {}): { view: SemantropyView; host: HostSpies } {
	const inputs: CollectFragmentInput[] = [];
	const clipboard: string[] = [];
	const notices: string[] = [];
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
	const host: SemantropyViewHost = {
		getTokenizer: characterTokenizer,
		readCurrentText: async () => NOTE_TEXT,
		getBodySemantropy: () => DEFAULT_BODY_SEMANTROPY,
		setBodySemantropy: async () => true,
		getDictionarySemantropy: () => DEFAULT_DICTIONARY_SEMANTROPY,
		setDictionarySemantropy: async () => true,
		collectFragment,
		writeClipboard,
		showNotice,
	};
	const view = new SemantropyView({ app: {} } as unknown as WorkspaceLeaf, host);
	(view as unknown as { app: App }).app = {} as App;
	const contentEl = document.createElement("div");
	document.body.appendChild(contentEl);
	peek(view).contentEl = contentEl;
	return {
		view,
		host: {
			collectFragment,
			writeClipboard,
			showNotice,
			inputs,
			clipboard,
			notices,
		},
	};
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
			hashText: async text => sha256Hex(text),
			issueSeed: () => seed,
		},
	);
}

function bodyRoot(view: SemantropyView): HTMLElement {
	const root = peek(view).targetBody.getContainer();
	if (!root) {
		throw new Error("expected a committed body");
	}
	document.body.appendChild(root);
	return root;
}

function selectBody(view: SemantropyView): BodySelectionSource {
	const root = bodyRoot(view);
	const range = document.createRange();
	range.selectNodeContents(root);
	return {
		rangeCount: 1,
		getRangeAt: () => range,
	};
}

async function flush(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) {
		await Promise.resolve();
	}
}

function captureLogs(): { logs: unknown[][]; restore: () => void } {
	const logs: unknown[][] = [];
	const originalError = console.error;
	const originalWarn = console.warn;
	const originalDebug = console.debug;
	console.error = (...args: unknown[]) => logs.push(args);
	console.warn = (...args: unknown[]) => logs.push(args);
	console.debug = (...args: unknown[]) => logs.push(args);
	return {
		logs,
		restore: () => {
			console.error = originalError;
			console.warn = originalWarn;
			console.debug = originalDebug;
		},
	};
}

describe("SemantropyView Copy and Collect", () => {
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

	function expectNoSeedChrome(root: HTMLElement): void {
		expect(root.querySelector(".semantropy-seed")).toBeNull();
		expect(root.textContent ?? "").not.toMatch(/seed:/i);
	}

	it("does not display a Seed in empty, ready, or stale View chrome", async () => {
		const { view } = createView();
		await view.onOpen();
		expectNoSeedChrome(peek(view).contentEl);
		await openReady(view);
		expectNoSeedChrome(peek(view).contentEl);
		expect(peek(view).contentEl.querySelector(".semantropy-replacements")).not.toBeNull();
		view.markSourceLost();
		expectNoSeedChrome(peek(view).contentEl);
	});

	it("copies the selected display string once and never touches Collect", async () => {
		const { view, host } = createView();
		await openReady(view);
		const captured = captureLogs();
		expect(await view.copySelectedFragment({ selection: selectionInBody(view, SELECTED) })).toBe(
			"copied",
		);
		captured.restore();
		expect(host.clipboard).toEqual([SELECTED]);
		expect(host.collectFragment).not.toHaveBeenCalled();
		expect(host.notices).toEqual([COPY_COPIED_MESSAGE]);
		expect(JSON.stringify(host.notices)).not.toContain(SELECTED);
		expect(JSON.stringify(captured.logs)).not.toContain(SELECTED);
	});

	it("copies and collects only displayed Ruby bases through the production View", async () => {
		const previousRender = MarkdownRenderer.render.bind(MarkdownRenderer);
		const raw = "猫《ねこ》犬《いぬ》";
		MarkdownRenderer.render = async (_app, markdown, container) => {
			expect(markdown).toBe(raw);
			const p = document.createElement("p");
			for (const [base, reading] of [["猫", "ねこ"], ["犬", "いぬ"]]) {
				const ruby = document.createElement("ruby"); const rt = document.createElement("rt");
				ruby.append(base!); rt.textContent = reading!; ruby.append(rt); p.append(ruby);
			}
			container.append(p);
		};
		try {
			const { view, host } = createView();
			await view.onOpen();
			await view.openCapture({ kind: "markdown", note: { sourcePath: SOURCE_PATH, sourceName: "ruby.md", editorText: raw } }, {
				readCached: async () => raw, hashText: async text => sha256Hex(text), issueSeed: () => 7,
			});
			const { assertBodySemantropy } = await import("../src/settings/bodySemantropy");
			expect(await view.setBodySemantropy(assertBodySemantropy(100))).toBe("applied");
			expect(await view.reshuffle({ issueSeed: () => 9 })).toBe("applied");
			expect(host.clipboard).toEqual([]); expect(host.inputs).toEqual([]);
			expect(bodyRoot(view).querySelector("ruby")?.textContent).toBe("犬いぬ");
			expect(await view.copySelectedFragment({ selection: selectBody(view) })).toBe("copied");
			expect(await view.collectSelectedFragment({ selection: selectBody(view) })).toBe("created");
			expect(host.clipboard).toEqual(["犬猫"]);
			expect(host.inputs[0]?.text).toBe("犬猫");
			expect(peek(view).session.getReadySnapshot()?.text).toBe(raw);
			const reading = bodyRoot(view).querySelector("rt")!;
			const onlyReading = document.createRange(); onlyReading.selectNodeContents(reading);
			expect(await view.copySelectedFragment({ selection: { rangeCount: 1, getRangeAt: () => onlyReading } })).toBe("empty");
			expect(host.clipboard).toHaveLength(1);
		} finally { MarkdownRenderer.render = previousRender; }
	});

	it("does not write the clipboard when nothing is selected", async () => {
		const { view, host } = createView();
		await openReady(view);
		expect(await view.copySelectedFragment({ selection: null })).toBe("empty");
		expect(host.writeClipboard).not.toHaveBeenCalled();
		expect(host.collectFragment).not.toHaveBeenCalled();
		expect(host.notices).toEqual([COPY_EMPTY_SELECTION_MESSAGE]);
	});

	it("does not show a success notice when the clipboard fails", async () => {
		const { view, host } = createView({
			writeClipboard: async () => {
				throw new Error(`could not copy ${SELECTED}`);
			},
		});
		await openReady(view);
		expect(await view.copySelectedFragment({ selection: selectionInBody(view, SELECTED) })).toBe(
			"failed",
		);
		expect(host.notices).toEqual([COPY_FAILED_MESSAGE]);
		expect(host.notices).not.toContain(COPY_COPIED_MESSAGE);
		expect(host.collectFragment).not.toHaveBeenCalled();
	});

	it("uses the same Copy method from the button and the command", async () => {
		const { view, host } = createView();
		await openReady(view);
		const spy = vi.spyOn(view, "copySelectedFragment");
		peek(view).contentEl.querySelector<HTMLButtonElement>(".semantropy-copy")?.click();
		const invoked = invokeSemantropyViewCommand({
			activeView: view,
			existingViews: [view],
			run: (target) => target.copySelectedFragment({ selection: selectionInBody(view, SELECTED) }),
		});
		expect(invoked.status).toBe("ran");
		if (invoked.status === "ran") {
			await invoked.outcome;
		}
		expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(host.writeClipboard.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it("builds a body fragment from the ready session without Seed fields", async () => {
		const { view, host } = createView();
		await openReady(view, 0);
		expect(
			await view.collectSelectedFragment({ selection: selectionInBody(view, SELECTED) }),
		).toBe("created");
		expect(host.inputs).toEqual([
			{
				type: "body",
				text: SELECTED,
				target: { path: SOURCE_PATH, contentHash: HASH },
				vocabulary: { ...collectVocabularyFromSnapshot(peek(view).targetBody.getVocabularySnapshot()!), fingerprint: peek(view).targetBody.getAutomaticProvenance()!.vocabularyFingerprint },
				bodySemantropy: DEFAULT_BODY_SEMANTROPY,
				algorithmVersion: 11,
				metadataVersion: 4, automaticPartsOfSpeech: ["noun"],
				hasManualEdits: false,
			},
		]);
		expect(host.inputs[0]).not.toHaveProperty("bodySeed");
		expect(host.inputs[0]).not.toHaveProperty("seed");
		expect(host.inputs[0]).not.toHaveProperty("sourcePath");
		expect(JSON.stringify(host.inputs[0])).not.toMatch(/"seed"|"bodySeed"/);
		expect(JSON.stringify(host.inputs[0])).not.toContain(NOTE_TEXT);
		expect(JSON.stringify(host.inputs[0])).not.toContain(ABSOLUTE);
		expect(host.inputs[0]).not.toHaveProperty("tokenSequences");
		expect(host.inputs[0]).not.toHaveProperty("pool");
		expect(host.notices).toEqual([COLLECT_SAVED_MESSAGE]);
	});

	it("collects from a stale snapshot using the displayed metadata", async () => {
		const { view, host } = createView();
		await openReady(view, 11);
		view.markSourceLost();
		expect(peek(view).session.getState()).toMatchObject({ freshness: "stale" });
		expect(
			await view.collectSelectedFragment({ selection: selectionInBody(view, SELECTED) }),
		).toBe("created");
		expect(host.inputs[0]?.type).toBe("body");
		expect(host.inputs[0]).not.toHaveProperty("bodySeed");
		expect(host.inputs[0]).not.toHaveProperty("seed");
		expect(host.inputs[0]?.type === "body" && host.inputs[0].target.path).toBe(SOURCE_PATH);
		expect(host.inputs[0]?.type === "body" && host.inputs[0].target.contentHash).toBe(HASH);
		expect(host.inputs[0]?.type === "body" && host.inputs[0].vocabulary).toEqual(
			{ ...collectVocabularyFromSnapshot(peek(view).targetBody.getVocabularySnapshot()!), fingerprint: peek(view).targetBody.getAutomaticProvenance()!.vocabularyFingerprint },
		);
	});

	it("notifies created and appended as success, and maps every failure", async () => {
		const outcomes: CollectFragmentResult[] = [
			{ status: "created" },
			{ status: "appended" },
			{ status: "invalid", reason: "empty-text" },
			{ status: "invalid-path" },
			{ status: "conflict", reason: "folder" },
			{ status: "conflict", reason: "non-markdown" },
			{ status: "conflict", reason: "parent-missing" },
			{ status: "conflict", reason: "source-note" },
			{ status: "failed" },
		];
		const { view, host } = createView({
			collect: async () => outcomes.shift() ?? { status: "failed" },
		});
		await openReady(view);
		const notices: string[] = [];
		for (let i = 0; i < 9; i += 1) {
			await view.collectSelectedFragment({ selection: selectionInBody(view, SELECTED) });
			notices.push(host.notices[host.notices.length - 1] ?? "");
		}
		expect(notices).toEqual([
			COLLECT_SAVED_MESSAGE,
			COLLECT_SAVED_MESSAGE,
			COLLECT_EMPTY_SELECTION_MESSAGE,
			COLLECT_PATH_INVALID_MESSAGE,
			COLLECT_PATH_IS_FOLDER_MESSAGE,
			COLLECT_PATH_NOT_MARKDOWN_MESSAGE,
			COLLECT_PATH_PARENT_MISSING_MESSAGE,
			COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE,
			COLLECT_FAILED_MESSAGE,
		]);
	});

	it("saves one entry for a double click because busy is taken before the first await", async () => {
		const hang = deferred<CollectFragmentResult>();
		const { view, host } = createView({
			collect: async () => hang.promise,
		});
		await openReady(view);
		const first = view.collectSelectedFragment({
			selection: selectionInBody(view, SELECTED),
		});
		const second = view.collectSelectedFragment({
			selection: selectionInBody(view, SELECTED),
		});
		await flush();
		expect(host.collectFragment).toHaveBeenCalledTimes(1);
		hang.resolve({ status: "created" });
		expect(await first).toBe("created");
		expect(await second).toBe("busy");
		expect(host.collectFragment).toHaveBeenCalledTimes(1);
		expect(host.notices.filter((notice) => notice === COLLECT_SAVED_MESSAGE)).toEqual([
			COLLECT_SAVED_MESSAGE,
		]);
	});

	it("saves one entry when the button and the command race", async () => {
		const hang = deferred<CollectFragmentResult>();
		const { view, host } = createView({
			collect: async () => hang.promise,
		});
		await openReady(view);
		const fromButton = view.collectSelectedFragment({
			selection: selectionInBody(view, SELECTED),
		});
		const invoked = invokeSemantropyViewCommand({
			activeView: view,
			existingViews: [view],
			run: (target) =>
				target.collectSelectedFragment({ selection: selectionInBody(view, SELECTED) }),
		});
		expect(invoked.status).toBe("ran");
		await flush();
		expect(host.collectFragment).toHaveBeenCalledTimes(1);
		hang.resolve({ status: "appended" });
		expect(await fromButton).toBe("appended");
		if (invoked.status === "ran") {
			expect(await invoked.outcome).toBe("busy");
		}
	});

	it("keeps both views' Collects when they share one repository", async () => {
		const stored: string[] = [];
		let contents: string | null = null;
		const gates: (() => void)[] = [];
		const storage: CollectionStorage = {
			inspect: async () =>
				new Promise((resolve) => {
					gates.push(() =>
						resolve(
							contents === null
								? { status: "missing" }
								: { status: "markdown" },
						),
					);
				}),
			create: async (_path, initial) => {
				contents = initial;
				stored.push("created");
				return { status: "created" };
			},
			process: async (_path, transform) => {
				contents = transform(contents ?? "");
				stored.push("appended");
				return { status: "processed" };
			},
		};
		const repository = new MarkdownFragmentRepository(
			storage,
			() => DEFAULT_COLLECTION_PATH,
		);
		const collect = (input: CollectFragmentInput) =>
			collectFragment(input, {
				repository,
				newId: () => "11111111-2222-4333-8444-555555555555",
				now: () => new Date("2026-09-05T12:34:56.000Z"),
			});
		const first = createView({ collect });
		const second = createView({ collect });
		await openReady(first.view, 1);
		await openReady(second.view, 2);
		const runA = first.view.collectSelectedFragment({
			selection: selectionInBody(first.view, "一つ"),
		});
		const runB = second.view.collectSelectedFragment({
			selection: selectionInBody(second.view, "二つ"),
		});
		await flush();
		gates.shift()?.();
		await flush();
		gates.shift()?.();
		await flush();
		expect(await runA).toBe("created");
		expect(await runB).toBe("appended");
		expect(stored).toEqual(["created", "appended"]);
		expect(contents).toContain("一つ");
		expect(contents).toContain("二つ");
	});

	it("saves the captured string even if the DOM selection changes afterwards", async () => {
		const hang = deferred<CollectFragmentResult>();
		const { view, host } = createView({
			collect: async () => hang.promise,
		});
		await openReady(view);
		const root = bodyRoot(view);
		const captured = root.textContent ?? "";
		const original = selectBody(view);
		const pending = view.collectSelectedFragment({ selection: original });
		window.getSelection()?.removeAllRanges();
		root.textContent = "変更後";
		hang.resolve({ status: "created" });
		expect(await pending).toBe("created");
		expect(host.inputs[0]?.text).toBe(captured);
		expect(host.inputs[0]?.text).not.toBe("変更後");
	});

	it("disables every action while Collect is busy", async () => {
		const hang = deferred<CollectFragmentResult>();
		const { view } = createView({
			collect: async () => hang.promise,
		});
		await openReady(view);
		void view.collectSelectedFragment({ selection: selectionInBody(view, SELECTED) });
		await flush();
		const root = peek(view).contentEl;
		expect(root.querySelector<HTMLSelectElement>(".semantropy-level-select")?.disabled).toBe(
			true,
		);
		expect(root.querySelector<HTMLButtonElement>(".semantropy-reshuffle")?.disabled).toBe(
			true,
		);
		expect(root.querySelector<HTMLButtonElement>(".semantropy-refresh")?.disabled).toBe(
			true,
		);
		expect(root.querySelector<HTMLButtonElement>(".semantropy-copy")?.disabled).toBe(true);
		expect(root.querySelector<HTMLButtonElement>(".semantropy-collect")?.disabled).toBe(
			true,
		);
		hang.resolve({ status: "created" });
		await flush();
	});

	it("does not register a second Copy handler when the shell is rendered again", async () => {
		const { view, host } = createView();
		await openReady(view);
		peek(view).renderShell();
		peek(view).renderShell();
		const spy = vi.spyOn(view, "copySelectedFragment");
		peek(view).contentEl.querySelector<HTMLButtonElement>(".semantropy-copy")?.click();
		await flush();
		expect(spy).toHaveBeenCalledTimes(1);
		expect(host.writeClipboard.mock.calls.length).toBeLessThanOrEqual(1);
	});

	it("can Copy and Collect again after close then open", async () => {
		const { view, host } = createView();
		await openReady(view);
		await view.onClose();
		await openReady(view, 3);
		expect(
			await view.copySelectedFragment({ selection: selectionInBody(view, SELECTED) }),
		).toBe("copied");
		expect(
			await view.collectSelectedFragment({ selection: selectionInBody(view, SELECTED) }),
		).toBe("created");
		expect(host.clipboard).toEqual([SELECTED]);
		expect(host.inputs).toHaveLength(1);
	});

	it("does not apply chrome updates to a view that closed while Collect was in flight", async () => {
		const hang = deferred<CollectFragmentResult>();
		const { view, host } = createView({
			collect: async () => hang.promise,
		});
		await openReady(view);
		const pending = view.collectSelectedFragment({
			selection: selectionInBody(view, SELECTED),
		});
		await view.onClose();
		hang.resolve({ status: "created" });
		expect(await pending).toBe("created");
		expect(host.notices).toEqual([COLLECT_SAVED_MESSAGE]);
		expect(peek(view).contentEl.querySelector(".semantropy-copy")).toBeNull();
	});
});
