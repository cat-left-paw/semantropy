// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App, Plugin } from "obsidian";
import {
	COLLECTION_PATH_INVALID_MESSAGE,
	COLLECTION_PATH_SAVE_FAILED_MESSAGE,
	COLLECTION_PATH_SAVED_MESSAGE,
} from "../src/application/collectionPathMessages";
import { DEFAULT_BODY_SEMANTROPY } from "../src/settings/bodySemantropy";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";
import { DEFAULT_DICTIONARY_SEMANTROPY } from "../src/settings/dictionarySemantropy";
import { ui } from "../src/i18n/catalog";
import {
	COLLECTION_FILE_SETTING_DESC,
	UI_LANGUAGE_SETTING_NAME,
	RIBBON_ICON_SETTING_NAME,
	COLLECTION_FILE_SETTING_NAME,
	SemantropySettingTab,
} from "../src/view/SemantropySettingTab";

const NEXT_PATH = "Collected/Fragments.md";
const LEADING_SPACE = " Collected/Fragments.md";
const ABSOLUTE = "/Users/hidden/vault/Collected/Fragments.md";

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

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

async function flush(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) {
		await Promise.resolve();
	}
}

type HostState = {
	collectionPath: string;
	bodySemantropy: number;
	dictionarySemantropy: number;
	persisted: string[];
	persistCalls: number;
	vault: {
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		cachedRead: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		modify: ReturnType<typeof vi.fn>;
		process: ReturnType<typeof vi.fn>;
	};
};

function createTab(
	options: {
		collectionPath?: string;
		setCollectionPath?: (value: string) => Promise<boolean>;
	} = {},
): { tab: SemantropySettingTab; host: HostState } {
	const vault = {
		getAbstractFileByPath: vi.fn(),
		cachedRead: vi.fn(),
		create: vi.fn(),
		modify: vi.fn(),
		process: vi.fn(),
	};
	const host: HostState = {
		collectionPath: options.collectionPath ?? DEFAULT_COLLECTION_PATH,
		bodySemantropy: DEFAULT_BODY_SEMANTROPY,
		dictionarySemantropy: DEFAULT_DICTIONARY_SEMANTROPY,
		persisted: [],
		persistCalls: 0,
		vault,
	};
	const persist = async (value: string): Promise<boolean> => {
		host.persistCalls += 1;
		if (options.setCollectionPath) {
			return await options.setCollectionPath(value);
		}
		host.persisted.push(value);
		host.collectionPath = value;
		return true;
	};
	const tab = new SemantropySettingTab(
		{ vault } as unknown as App,
		{} as Plugin,
		{
			getCollectionPath: () => host.collectionPath,
			setCollectionPath: persist,
			getUiLanguage: () => "en",
			setUiLanguage: async () => true,
			getShowRibbonIcon: () => true,
			setShowRibbonIcon: async () => true,
			getCollectAttribution: () => ({ feature: false, target: false, vocabulary: false, semantropy: false, date: false }),
			setCollectAttribution: async () => true,
		},
	);
	return { tab, host };
}

function pathInput(tab: SemantropySettingTab): HTMLInputElement {
	const input = tab.containerEl.querySelector("input");
	if (!(input instanceof HTMLInputElement)) {
		throw new Error("expected the Collection path field");
	}
	return input;
}

function saveButton(tab: SemantropySettingTab): HTMLButtonElement {
	const button = tab.containerEl.querySelector(
		".semantropy-collection-path-save",
	);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error("expected the Save button");
	}
	return button;
}

function statusText(tab: SemantropySettingTab): string {
	return (
		tab.containerEl.querySelector(".semantropy-settings-status")?.textContent ??
		""
	);
}

function typePath(tab: SemantropySettingTab, value: string): void {
	const input = pathInput(tab);
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SemantropySettingTab", () => {
	let restoreDom: () => void;
	beforeAll(() => {
		restoreDom = installObsidianDomHelpers();
	});
	afterAll(() => {
		restoreDom();
	});
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("registers Collection file for Obsidian settings search", () => {
		const { tab } = createTab();
		const definitions = tab.getSettingDefinitions();
		// LOCALE1: the Interface language row comes first.
		expect(definitions.map(item => (item as { name?: string }).name)).toEqual([
			UI_LANGUAGE_SETTING_NAME,
			RIBBON_ICON_SETTING_NAME,
			COLLECTION_FILE_SETTING_NAME,
			undefined,
		]);
		const group = definitions[3];
		expect(group).toMatchObject({ type: "group", heading: ui().settings.attributionGroupName });
		if (group && "items" in group) {
			const items = (group as { items?: Array<{ name: string }> }).items;
			expect(items?.map(item => item.name)).toEqual([
				ui().settings.attributionFeatureName, ui().settings.attributionTargetName,
				ui().settings.attributionVocabularyName, ui().settings.attributionSemantropyName,
				ui().settings.attributionDateName,
			]);
		} else throw new Error("expected an attribution group");
		const definition = definitions[2];
		if (definition == null) {
			throw new Error("expected a Collection file setting definition");
		}
		expect(definition).toMatchObject({
			name: COLLECTION_FILE_SETTING_NAME,
			desc: COLLECTION_FILE_SETTING_DESC,
		});
		expect("render" in definition).toBe(true);
		expect(
			"searchable" in definition && definition.searchable === false,
		).toBe(false);
	});

	it("shows the saved Collection path in the text field", () => {
		const { tab } = createTab({ collectionPath: NEXT_PATH });
		tab.show();
		expect(pathInput(tab).value).toBe(NEXT_PATH);
		expect(tab.containerEl.textContent).toContain(COLLECTION_FILE_SETTING_NAME);
		expect(tab.containerEl.textContent).toContain("Vault-relative Markdown");
	});

	it("rereads the effective path when the tab is shown again", () => {
		const { tab, host } = createTab();
		tab.show();
		typePath(tab, "Unsaved.md");
		expect(pathInput(tab).value).toBe("Unsaved.md");
		host.collectionPath = NEXT_PATH;
		tab.show();
		expect(pathInput(tab).value).toBe(NEXT_PATH);
		expect(host.persisted).toEqual([]);
	});

	it("saves a valid Vault-relative Markdown path once, as typed", async () => {
		const { tab, host } = createTab();
		tab.show();
		typePath(tab, NEXT_PATH);
		expect(await tab.saveCollectionPath()).toBe("saved");
		expect(host.persisted).toEqual([NEXT_PATH]);
		expect(host.collectionPath).toBe(NEXT_PATH);
		expect(statusText(tab)).toBe(COLLECTION_PATH_SAVED_MESSAGE);
		expect(host.persistCalls).toBe(1);
	});

	it("does not persist an invalid path or rewrite it", async () => {
		const { tab, host } = createTab();
		tab.show();
		for (const draft of ["", "   ", "/absolute.md", "notes/", "notes.txt", ".md"]) {
			typePath(tab, draft);
			expect(await tab.saveCollectionPath()).toBe("invalid");
			expect(pathInput(tab).value).toBe(draft);
		}
		expect(host.persistCalls).toBe(0);
		expect(host.collectionPath).toBe(DEFAULT_COLLECTION_PATH);
		expect(statusText(tab)).toBe(COLLECTION_PATH_INVALID_MESSAGE);
	});

	it("does not trim, normalize or complete the typed path", async () => {
		const { tab, host } = createTab();
		tab.show();
		typePath(tab, LEADING_SPACE);
		expect(await tab.saveCollectionPath()).toBe("saved");
		expect(host.persisted).toEqual([LEADING_SPACE]);
		expect(host.persisted[0]).not.toBe("Collected/Fragments.md");
		typePath(tab, "Fragments.md ");
		expect(await tab.saveCollectionPath()).toBe("invalid");
		expect(host.persisted).toEqual([LEADING_SPACE]);
		expect(pathInput(tab).value).toBe("Fragments.md ");
	});

	it("keeps the effective path when persist fails, and allows a retry", async () => {
		let succeed = false;
		const { tab, host } = createTab({
			setCollectionPath: async (value) => {
				host.persisted.push(value);
				if (!succeed) {
					return false;
				}
				host.collectionPath = value;
				return true;
			},
		});
		tab.show();
		typePath(tab, NEXT_PATH);
		expect(await tab.saveCollectionPath()).toBe("failed");
		expect(host.collectionPath).toBe(DEFAULT_COLLECTION_PATH);
		expect(pathInput(tab).value).toBe(NEXT_PATH);
		expect(statusText(tab)).toBe(COLLECTION_PATH_SAVE_FAILED_MESSAGE);
		succeed = true;
		expect(await tab.saveCollectionPath()).toBe("saved");
		expect(host.collectionPath).toBe(NEXT_PATH);
		expect(host.persisted).toEqual([NEXT_PATH, NEXT_PATH]);
	});

	it("takes Busy before the first await so a double Save writes once", async () => {
		const hang = deferred<boolean>();
		const { tab, host } = createTab({
			setCollectionPath: async (value) => {
				host.persisted.push(value);
				host.collectionPath = value;
				return await hang.promise;
			},
		});
		tab.show();
		typePath(tab, NEXT_PATH);
		const first = tab.saveCollectionPath();
		const second = tab.saveCollectionPath();
		await flush();
		expect(saveButton(tab).disabled).toBe(true);
		expect(host.persistCalls).toBe(1);
		hang.resolve(true);
		expect(await first).toBe("saved");
		expect(await second).toBe("busy");
		expect(host.persisted).toEqual([NEXT_PATH]);
		expect(saveButton(tab).disabled).toBe(false);
	});

	it("clears the saved message when the draft is edited", async () => {
		const { tab } = createTab();
		tab.show();
		typePath(tab, NEXT_PATH);
		expect(await tab.saveCollectionPath()).toBe("saved");
		expect(statusText(tab)).toBe(COLLECTION_PATH_SAVED_MESSAGE);
		typePath(tab, "Other/Fragments.md");
		expect(pathInput(tab).value).toBe("Other/Fragments.md");
		expect(statusText(tab)).toBe("");
	});

	it("does not mark a newer unsaved draft as saved when an older Save finishes", async () => {
		const hang = deferred<boolean>();
		const { tab, host } = createTab({
			setCollectionPath: async (value) => {
				host.persisted.push(value);
				host.collectionPath = value;
				return await hang.promise;
			},
		});
		tab.show();
		typePath(tab, NEXT_PATH);
		const pending = tab.saveCollectionPath();
		await flush();
		typePath(tab, "Other/Fragments.md");
		expect(statusText(tab)).toBe("");
		hang.resolve(true);
		expect(await pending).toBe("saved");
		expect(host.persisted).toEqual([NEXT_PATH]);
		expect(host.collectionPath).toBe(NEXT_PATH);
		expect(pathInput(tab).value).toBe("Other/Fragments.md");
		expect(statusText(tab)).not.toBe(COLLECTION_PATH_SAVED_MESSAGE);
	});

	it("does not let an older Save overwrite a newer display", async () => {
		const hang = deferred<boolean>();
		const { tab, host } = createTab({
			setCollectionPath: async (value) => {
				host.persisted.push(value);
				host.collectionPath = value;
				return await hang.promise;
			},
		});
		tab.show();
		typePath(tab, NEXT_PATH);
		const pending = tab.saveCollectionPath();
		await flush();
		tab.hide();
		host.collectionPath = DEFAULT_COLLECTION_PATH;
		tab.show();
		typePath(tab, "Other/Fragments.md");
		hang.resolve(true);
		expect(await pending).toBe("aborted");
		expect(pathInput(tab).value).toBe("Other/Fragments.md");
		expect(statusText(tab)).not.toBe(COLLECTION_PATH_SAVED_MESSAGE);
	});

	it("does not change body or Dictionary Semantropy when the path is saved", async () => {
		const { tab, host } = createTab();
		tab.show();
		typePath(tab, NEXT_PATH);
		expect(await tab.saveCollectionPath()).toBe("saved");
		expect(host.bodySemantropy).toBe(DEFAULT_BODY_SEMANTROPY);
		expect(host.dictionarySemantropy).toBe(DEFAULT_DICTIONARY_SEMANTROPY);
		expect(host.collectionPath).toBe(NEXT_PATH);
	});

	it("does not read, write, create or process a Vault file", async () => {
		const { tab, host } = createTab();
		tab.show();
		typePath(tab, NEXT_PATH);
		expect(await tab.saveCollectionPath()).toBe("saved");
		typePath(tab, "notes/");
		expect(await tab.saveCollectionPath()).toBe("invalid");
		expect(host.vault.getAbstractFileByPath).not.toHaveBeenCalled();
		expect(host.vault.cachedRead).not.toHaveBeenCalled();
		expect(host.vault.create).not.toHaveBeenCalled();
		expect(host.vault.modify).not.toHaveBeenCalled();
		expect(host.vault.process).not.toHaveBeenCalled();
	});

	it("does not put the typed path, an absolute path or an exception in status or logs", async () => {
		const errors: unknown[][] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args);
		};
		try {
			const { tab } = createTab({
				setCollectionPath: async () => false,
			});
			tab.show();
			typePath(tab, ABSOLUTE);
			expect(await tab.saveCollectionPath()).toBe("invalid");
			expect(statusText(tab)).toBe(COLLECTION_PATH_INVALID_MESSAGE);
			typePath(tab, NEXT_PATH);
			expect(await tab.saveCollectionPath()).toBe("failed");
			expect(statusText(tab)).toBe(COLLECTION_PATH_SAVE_FAILED_MESSAGE);
			expect(JSON.stringify(errors)).not.toContain(NEXT_PATH);
			expect(JSON.stringify(errors)).not.toContain(ABSOLUTE);
			expect(JSON.stringify(statusText(tab))).not.toContain(NEXT_PATH);
			expect(tab.containerEl.textContent).not.toContain(ABSOLUTE);
		} finally {
			console.error = original;
		}
	});
});
