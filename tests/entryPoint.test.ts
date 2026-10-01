import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import SemantropyLinderaPlugin from "../src/main";
import { LinderaTokenizer } from "../src/tokenizer/lindera/linderaEngine";
import type { SemantropyTokenizerHost } from "../src/SemantropyPlugin";
import { SemantropyView } from "../src/view/SemantropyView";

const rootDir = process.cwd();

/**
 * The tokenizer is chosen at build time, not at runtime, so "which tokenizer
 * ships" is a property of the entry point itself. These tests read it directly
 * rather than inferring it from behaviour.
 */
type PluginInternals = {
	createTokenizer(): SemantropyTokenizerHost;
	onload(): Promise<void>;
	onunload(): void;
};

function createStubApp(records: { views: unknown[] }) {
	return {
		vault: {
			adapter: {
				getResourcePath: () => {
					throw new Error(
						"The production entry point must not ask for a resource path.",
					);
				},
			},
			on: () => ({}),
			getAbstractFileByPath: () => null,
			cachedRead: async () => "",
		},
		workspace: {
			getActiveViewOfType: () => null,
			getLeavesOfType: () => records.views,
			getLeaf: () => null,
			setActiveLeaf: () => undefined,
			on: () => ({}),
		},
	};
}

function createPlugin(): {
	plugin: PluginInternals;
	viewFactories: ((leaf: unknown) => unknown)[];
	commands: Map<string, () => void>;
	settingTabs: unknown[];
} {
	const viewFactories: ((leaf: unknown) => unknown)[] = [];
	const commands = new Map<string, () => void>();
	const settingTabs: unknown[] = [];
	const plugin = new SemantropyLinderaPlugin(
		createStubApp({ views: [] }) as never,
		{ dir: "plugins/semantropy" } as never,
	) as unknown as PluginInternals;

	Object.assign(plugin, {
		registerView: (_type: string, factory: (leaf: unknown) => unknown) => {
			viewFactories.push(factory);
		},
		addCommand: (command: { id: string; callback: () => void }) => {
			commands.set(command.id, command.callback);
		},
		addSettingTab: (tab: unknown) => {
			settingTabs.push(tab);
		},
		registerEvent: () => undefined,
		loadData: async () => null,
		saveData: async () => undefined,
	});

	return { plugin, viewFactories, commands, settingTabs };
}

describe("the shipped entry point", () => {
	it("constructs a LinderaTokenizer", () => {
		const { plugin } = createPlugin();
		expect(plugin.createTokenizer()).toBeInstanceOf(LinderaTokenizer);
	});

	it("hands the Semantropy view the same tokenizer instance the commands use", async () => {
		const { plugin, viewFactories, commands, settingTabs } = createPlugin();
		await plugin.onload();

		const [factory] = viewFactories;
		if (!factory) {
			throw new Error("onload registered no Semantropy view.");
		}
		// Enough of a leaf for ItemView's constructor.
		const view = factory({ view: null }) as {
			host: { getTokenizer(): SemantropyTokenizerHost };
		};
		expect(view).toBeInstanceOf(SemantropyView);

		// Open, Reshuffle and Refresh all reach the tokenizer through this
		// host. They must share one instance, or Open would build a second
		// copy of a 12 MB dictionary in WebAssembly memory.
		const fromView = view.host.getTokenizer();
		const fromViewAgain = view.host.getTokenizer();
		expect(fromView).toBeInstanceOf(LinderaTokenizer);
		expect(fromViewAgain).toBe(fromView);

		expect([...commands.keys()]).toEqual([
			"open",
			"reshuffle",
			"refresh-source",
			"copy-selected-fragment",
			"collect-selected-fragment",
			"define-selected-word",
			"reshuffle-definition",
		]);
		expect(commands.has("test-tokenizer")).toBe(false);
		expect(settingTabs).toHaveLength(1);
		const [settingTab] = settingTabs;
		if (settingTab == null) {
			throw new Error("onload registered no SettingTab.");
		}
		const definitions = (
			settingTab as {
				getSettingDefinitions(): Array<{
					name?: string;
					type?: string;
					heading?: string;
					items?: Array<{ name?: string; render?: unknown; searchable?: boolean | (() => boolean) }>;
					render?: unknown;
					searchable?: boolean | (() => boolean);
				}>;
			}
		).getSettingDefinitions();
		// LOCALE1: a new install (no stored settings) is Japanese, and the language row comes first.
		// 0.1.0 S4 adds the extra enclosed-term delimiters row before the attribution group.
		expect(definitions.map(item => item.name)).toEqual(["表示言語", "リボンアイコンを表示", "収集ファイル", "追加の囲み記号", undefined]);
		expect(definitions[4]).toMatchObject({ type: "group", heading: "収集ノートに生成由来を記録" });
		expect(definitions[4]?.items?.map(item => item.name)).toEqual([
			"生成の種類を記録", "対象ノートを記録", "語彙ソースを記録", "生成時のSemantropy値を記録", "収集した日付を記録",
		]);
		for (const definition of definitions.flatMap(item => item.items ?? [item])) {
			expect(typeof definition.render).toBe("function");
			expect(definition.searchable).not.toBe(false);
		}
		const fromPlugin = (
			plugin as unknown as { getTokenizer(): SemantropyTokenizerHost }
		).getTokenizer();
		expect(fromPlugin).toBe(fromView);

		plugin.onunload();
	});

	it("does not initialize the tokenizer during onload", async () => {
		const { plugin } = createPlugin();
		await plugin.onload();

		const tokenizer = (
			plugin as unknown as { getTokenizer(): SemantropyTokenizerHost }
		).getTokenizer();
		// Constructed, but nothing decoded, inflated or instantiated: the
		// embedded payload is not touched until a tokenize request arrives.
		expect(tokenizer.isInitialized()).toBe(false);

		plugin.onunload();
	});
});

describe("the shipped source tree", () => {
	it("has exactly one entry point, and it is the Lindera one", async () => {
		const main = await readFile(path.join(rootDir, "src", "main.ts"), "utf8");
		expect(main).toContain("virtual:semantropy-lindera-payload");
		expect(main).toContain("new LinderaTokenizer(");
		await expect(
			readFile(path.join(rootDir, "src", "mainEmbedded.ts"), "utf8"),
		).rejects.toThrow();
		await expect(
			readFile(path.join(rootDir, "src", "mainLinderaCompact.ts"), "utf8"),
		).rejects.toThrow();
	});

	it("does not import the development tokenizer smoke helper", async () => {
		const main = await readFile(path.join(rootDir, "src", "main.ts"), "utf8");
		const plugin = await readFile(
			path.join(rootDir, "src", "SemantropyPlugin.ts"),
			"utf8",
		);
		expect(main).not.toContain("runTokenizerSmoke");
		expect(plugin).not.toContain("runTokenizerSmoke");
		expect(plugin).not.toContain("test-tokenizer");
	});
});
