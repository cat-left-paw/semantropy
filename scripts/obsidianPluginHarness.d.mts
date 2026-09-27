export type HarnessRecords = {
	notices: string[];
	debugCalls: { message: string; details: unknown }[];
	errorCalls: unknown[];
	warnCalls: unknown[];
	fetchCalls: string[];
	/** Source paths of every MarkdownRenderer.render call; the Target makes none. */
	markdownRenderCalls: string[];
	resourcePathCalls: string[];
	writeCalls: string[];
	requiredModules: string[];
	commands: Map<string, () => void>;
	viewFactories: Map<string, (leaf: unknown) => unknown>;
	leaves: unknown[];
	activeLeaf: unknown;
	note: { file: { path: string; name: string }; text: string } | null;
	registeredEvents: unknown[];
	subscribedEvents: string[];
	savedData: unknown;
	settingTabs: unknown[];
	collection: { path: string; contents: string | null } | null;
};

export type LoadedPlugin = {
	plugin: { onload(): void | Promise<void>; onunload(): void };
	records: HarnessRecords;
	app: unknown;
	obsidian: Record<string, unknown>;
	/**
	 * Releases the `fetch` / `XMLHttpRequest` traps and the harness DOM.
	 * Idempotent. The caller must invoke it once it is done driving the plugin
	 * — the traps outlive `onload` on purpose, so that lazy initialization is
	 * covered too.
	 */
	restore: () => void;
};

export declare const OPEN_COMMAND_ID: string;
export declare const DEFAULT_OPEN_MARKDOWN: string;
export declare const DEFAULT_OPEN_SOURCE_PATH: string;
export declare const DEFAULT_OPEN_SOURCE_NAME: string;

export declare function createHarnessRecords(): HarnessRecords;
export declare function createObsidianStub(
	records: HarnessRecords,
): Record<string, unknown>;
export declare function createObsidianApp(
	records: HarnessRecords,
): Record<string, unknown>;
export declare function loadPluginArtifact(
	outDir: string,
	options?: { records?: HarnessRecords; manifestDir?: string },
): Promise<LoadedPlugin>;
export declare function emulateCollectionMarkdown(
	loaded: LoadedPlugin,
	options?: { path?: string },
): { path: string; read: () => string | null };
export declare function installMarkdownSource(
	loaded: LoadedPlugin,
	options?: { markdown?: string; sourcePath?: string; sourceName?: string },
): unknown;
export declare function openHarnessNote(
	loaded: LoadedPlugin,
	options?: {
		markdown?: string;
		sourcePath?: string;
		sourceName?: string;
		timeoutMs?: number;
	},
): Promise<{
	status: "ready" | "error";
	elapsedMs: number;
	view: unknown;
	message: string;
	replacementCount: number | null;
	replaceableSlotCount: number | null;
	bodyText: string;
	snapshotText: string | null;
}>;
export declare function runCommandUntilNotice(
	loaded: LoadedPlugin,
	commandId: string,
	prefix: string,
	options?: { timeoutMs?: number },
): Promise<{ notice: string; elapsedMs: number }>;
