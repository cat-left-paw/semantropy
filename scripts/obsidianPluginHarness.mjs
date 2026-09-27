import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

/**
 * One Obsidian stub, shared by every harness that loads a built artifact: the
 * distribution artifact tests and the cold-load measurement script.
 *
 * It exists because those harnesses each had their own copy, and only one of
 * them was updated when the plugin started registering source events — the
 * cold-load script then failed on `this.app.workspace.on is not a function`
 * while the artifact test kept passing. Keeping a single stub means a new
 * lifecycle requirement can only break all of them at once, which is a
 * failure nobody can miss.
 *
 * The stub supplies exactly what `SemantropyPlugin.onload` needs, plus the
 * workspace and DOM surface required to drive `Semantropy: Open`:
 *
 *   Plugin.addCommand / registerView / registerEvent / loadData / saveData
 *   app.workspace.on / getActiveViewOfType / getLeavesOfType / getLeaf /
 *     setActiveLeaf
 *   app.vault.on / getAbstractFileByPath / cachedRead
 *
 * Everything a self-contained artifact must not touch is trapped rather than
 * implemented: `fetch` throws and is recorded, `getResourcePath` throws and is
 * recorded, vault write APIs are recorded, and any `require` other than
 * `obsidian` throws.
 */

export const OPEN_COMMAND_ID = "open";
export const DEFAULT_OPEN_MARKDOWN = "太郎は駅で花子を待っていた。";
export const DEFAULT_OPEN_SOURCE_PATH = "notes/smoke.md";
export const DEFAULT_OPEN_SOURCE_NAME = "smoke.md";

const DOM_GLOBALS = [
	"document",
	"window",
	"Node",
	"NodeFilter",
	"HTMLElement",
	"HTMLInputElement",
	"HTMLButtonElement",
	"Element",
	"Text",
	"Document",
	"DOMParser",
	"Comment",
	"DocumentFragment",
	"Range",
	"Selection",
];

export function createHarnessRecords() {
	return {
		notices: [],
		debugCalls: [],
		errorCalls: [],
		warnCalls: [],
		fetchCalls: [],
		markdownRenderCalls: [],
		resourcePathCalls: [],
		writeCalls: [],
		requiredModules: [],
		commands: new Map(),
		viewFactories: new Map(),
		leaves: [],
		activeLeaf: null,
		note: null,
		collection: null,
		registeredEvents: [],
		subscribedEvents: [],
		savedData: null,
		settingTabs: [],
	};
}

function applyDomInfo(el, opts) {
	if (opts == null) {
		return el;
	}
	if (typeof opts === "string") {
		el.className = opts;
		return el;
	}
	if (opts.cls) {
		el.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
	}
	if (opts.text != null) {
		el.textContent = opts.text;
	}
	if (opts.attr) {
		for (const [key, value] of Object.entries(opts.attr)) {
			el.setAttribute(key, String(value));
		}
	}
	if (opts.value != null && "value" in el) {
		el.value = opts.value;
	}
	return el;
}

function patchObsidianDom(HTMLElementCtor) {
	const proto = HTMLElementCtor.prototype;
	proto.empty = function empty() {
		this.replaceChildren();
		return this;
	};
	proto.setText = function setText(text) {
		this.textContent = text ?? "";
		return this;
	};
	proto.toggleClass = function toggleClass(cls, on) {
		this.classList.toggle(cls, on);
		return this;
	};
	proto.createDiv = function createDiv(opts) {
		const el = this.ownerDocument.createElement("div");
		applyDomInfo(el, opts);
		this.appendChild(el);
		return el;
	};
	proto.createSpan = function createSpan(opts) {
		const el = this.ownerDocument.createElement("span");
		applyDomInfo(el, opts);
		this.appendChild(el);
		return el;
	};
	proto.createEl = function createEl(tag, opts) {
		const el = this.ownerDocument.createElement(tag);
		applyDomInfo(el, opts);
		this.appendChild(el);
		return el;
	};
}

function snapshotGlobal(name) {
	return {
		present: Object.hasOwn(globalThis, name),
		value: Object.hasOwn(globalThis, name)
			? Reflect.get(globalThis, name)
			: undefined,
	};
}

function restoreGlobal(name, snapshot) {
	if (snapshot.present) {
		Reflect.set(globalThis, name, snapshot.value);
	} else {
		Reflect.deleteProperty(globalThis, name);
	}
}

function installHarnessDom() {
	const previous = {
		createDiv: snapshotGlobal("createDiv"),
	};
	for (const name of DOM_GLOBALS) {
		previous[name] = snapshotGlobal(name);
	}

	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "https://semantropy.test/",
		pretendToBeVisual: true,
	});
	const win = dom.window;
	for (const name of DOM_GLOBALS) {
		Reflect.set(globalThis, name, Reflect.get(win, name));
	}
	patchObsidianDom(win.HTMLElement);
	Reflect.set(globalThis, "createDiv", (opts) => {
		const el = win.document.createElement("div");
		applyDomInfo(el, opts);
		return el;
	});

	let restored = false;
	return () => {
		if (restored) {
			return;
		}
		restored = true;
		for (const name of DOM_GLOBALS) {
			restoreGlobal(name, previous[name]);
		}
		restoreGlobal("createDiv", previous.createDiv);
		dom.window.close();
	};
}

/** The `obsidian` module the bundle sees at runtime. */
export function createObsidianStub(records) {
	class StubComponent {
		addChild(child) {
			return child;
		}
		removeChild(child) {
			return child;
		}
	}
	class StubItemView extends StubComponent {
		constructor(leaf) {
			super();
			this.leaf = leaf;
			this.app = leaf?.app ?? null;
			if (typeof document !== "undefined" && document.createElement) {
				this.containerEl = document.createElement("div");
				this.contentEl = this.containerEl.createDiv
					? this.containerEl.createDiv({ cls: "view-content" })
					: document.createElement("div");
			} else {
				this.containerEl = { empty() {}, createDiv() { return this; }, createEl() { return this; } };
				this.contentEl = this.containerEl;
			}
		}
		getViewType() {
			return "";
		}
		getDisplayText() {
			return "";
		}
	}
	class StubPlugin {
		constructor(app, manifest) {
			this.app = app;
			this.manifest = manifest;
		}
		addCommand(command) {
			records.commands.set(command.id, command.callback);
		}
		registerView(type, factory) {
			records.viewFactories.set(type, factory);
		}
		// Every source event must arrive through registerEvent so Obsidian can
		// detach it on unload.
		registerEvent(reference) {
			records.registeredEvents.push(reference);
		}
		async loadData() {
			return records.savedData;
		}
		async saveData(data) {
			records.savedData = data;
		}
		addSettingTab(tab) {
			records.settingTabs.push(tab);
		}
		addRibbonIcon(icon, title, callback) {
			const doc = typeof document !== "undefined" ? document : null;
			if (!doc?.createElement) {
				const el = {
					isConnected: true,
					dataset: { icon },
					classList: { add() {}, remove() {}, contains() { return false; } },
					setAttribute() {},
					getAttribute(name) { return name === "aria-label" ? title : null; },
					addEventListener() {},
					remove() { this.isConnected = false; },
				};
				return el;
			}
			const el = doc.createElement("button");
			el.type = "button";
			el.className = "side-dock-ribbon-action";
			el.dataset.icon = icon;
			el.setAttribute("aria-label", title);
			el.addEventListener("click", (event) => { void callback(event); });
			doc.body.append(el);
			return el;
		}
		addChild() {}
		removeChild() {}
	}
	class StubNotice {
		constructor(message) {
			records.notices.push(message);
		}
	}
	class StubMarkdownView extends StubItemView {
		file = null;
		editor = null;
		getViewType() {
			return "markdown";
		}
	}
	class StubTFile {
		path = "";
		name = "";
		extension = "";
	}
	class StubTFolder {
		path = "";
		name = "";
	}
	class StubModal {
		constructor(app) {
			this.app = app;
			const doc = typeof document !== "undefined" ? document : null;
			if (doc && doc.createElement) {
				this.containerEl = doc.createElement("div");
				this.modalEl = this.containerEl;
				this.titleEl = this.containerEl.createDiv
					? this.containerEl.createDiv({ cls: "modal-title" })
					: doc.createElement("div");
				this.contentEl = this.containerEl.createDiv
					? this.containerEl.createDiv({ cls: "modal-content" })
					: doc.createElement("div");
			} else {
				this.containerEl = { empty() {}, createDiv() { return this; }, createEl() { return this; } };
				this.modalEl = this.containerEl;
				this.titleEl = this.containerEl;
				this.contentEl = this.containerEl;
			}
		}
		open() {
			if (typeof document !== "undefined" && this.containerEl.appendChild) {
				document.body.appendChild(this.containerEl);
			}
			this.onOpen();
		}
		close() {
			this.onClose();
			if (this.containerEl.parentNode) {
				this.containerEl.remove();
			}
		}
		onOpen() {}
		onClose() {}
		setTitle(title) {
			if (this.titleEl && "textContent" in this.titleEl) {
				this.titleEl.textContent = title;
			}
		}
	}
	class StubPluginSettingTab {
		constructor(app, plugin) {
			this.app = app;
			this.plugin = plugin;
			const doc = typeof document !== "undefined" ? document : null;
			if (doc && doc.createElement) {
				this.containerEl = doc.createElement("div");
			} else {
				this.containerEl = { empty() {} };
			}
		}
		display() {}
		hide() {}
		getSettingDefinitions() {
			return [];
		}
	}
	class StubSettingGroup {
		constructor(containerEl) {
			this.listEl = containerEl;
		}
		setHeading() {
			return this;
		}
		addClass() {
			return this;
		}
		addSetting() {
			return this;
		}
		addSearch() {
			return this;
		}
		addExtraButton() {
			return this;
		}
	}
	class StubTextComponent {
		constructor(inputEl) {
			this.inputEl = inputEl;
			this.disabled = false;
		}
		getValue() {
			return this.inputEl.value;
		}
		setValue(value) {
			this.inputEl.value = value;
			return this;
		}
		setPlaceholder(placeholder) {
			this.inputEl.placeholder = placeholder;
			return this;
		}
		setDisabled(disabled) {
			this.disabled = disabled;
			this.inputEl.disabled = disabled;
			return this;
		}
		onChange(callback) {
			this.inputEl.addEventListener("input", () => {
				callback(this.inputEl.value);
			});
			return this;
		}
	}
	class StubDropdownComponent {
		constructor(selectEl) {
			this.selectEl = selectEl;
			this.disabled = false;
		}
		addOption(value, display) {
			const option = this.selectEl.createEl("option", { text: display });
			option.value = value;
			return this;
		}
		getValue() {
			return this.selectEl.value;
		}
		setValue(value) {
			this.selectEl.value = value;
			return this;
		}
		setDisabled(disabled) {
			this.disabled = disabled;
			this.selectEl.disabled = disabled;
			return this;
		}
		onChange(callback) {
			this.selectEl.addEventListener("change", () => {
				void callback(this.selectEl.value);
			});
			return this;
		}
	}
	class StubButtonComponent {
		constructor(buttonEl) {
			this.buttonEl = buttonEl;
			this.disabled = false;
		}
		setButtonText(name) {
			this.buttonEl.textContent = name;
			return this;
		}
		setCta() {
			this.buttonEl.classList.add("mod-cta");
			return this;
		}
		setClass(cls) {
			this.buttonEl.classList.add(cls);
			return this;
		}
		setDisabled(disabled) {
			this.disabled = disabled;
			this.buttonEl.disabled = disabled;
			return this;
		}
		onClick(callback) {
			this.buttonEl.addEventListener("click", (event) => {
				void callback(event);
			});
			return this;
		}
	}
	class StubSetting {
		constructor(containerEl) {
			this.settingEl = containerEl.createDiv({ cls: "setting-item" });
			this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
			this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
			this.descEl = this.infoEl.createDiv({
				cls: "setting-item-description",
			});
			this.controlEl = this.settingEl.createDiv({
				cls: "setting-item-control",
			});
			this.components = [];
		}
		setName(name) {
			this.nameEl.setText(name);
			return this;
		}
		setDesc(desc) {
			this.descEl.setText(desc);
			return this;
		}
		setClass(cls) {
			this.settingEl.classList.add(cls);
			return this;
		}
		addText(cb) {
			const input = this.controlEl.createEl("input");
			input.type = "text";
			const component = new StubTextComponent(input);
			cb(component);
			this.components.push(component);
			return this;
		}
		addButton(cb) {
			const button = this.controlEl.createEl("button", {
				attr: { type: "button" },
			});
			const component = new StubButtonComponent(button);
			cb(component);
			this.components.push(component);
			return this;
		}
		addDropdown(cb) {
			const component = new StubDropdownComponent(this.controlEl.createEl("select"));
			cb(component);
			this.components.push(component);
			return this;
		}
		addToggle(cb) {
			const el = this.controlEl.createDiv({ cls: "checkbox-container" });
			el.setAttribute("role", "switch");
			const component = {
				toggleEl: el,
				value: false,
				setValue(on) {
					this.value = on;
					el.setAttribute("aria-checked", on ? "true" : "false");
					return this;
				},
				onChange(fn) { this.change = fn; return this; },
				getValue() { return this.value; },
				setDisabled() { return this; },
			};
			el.addEventListener("click", () => {
				component.setValue(!component.value);
				void component.change?.(component.value);
			});
			cb(component);
			this.components.push(component);
			return this;
		}
	}

	return {
		Component: StubComponent,
		ItemView: StubItemView,
		// The production Target is built without MarkdownRenderer. Any call
		// is recorded and refused, so an artifact that regresses to it fails.
		MarkdownRenderer: {
			render: async (_app, _markdown, _container, sourcePath) => {
				records.markdownRenderCalls.push(String(sourcePath));
				throw new Error("MarkdownRenderer is not available to the Target.");
			},
		},
		MarkdownView: StubMarkdownView,
		Notice: StubNotice,
		Plugin: StubPlugin,
		TFile: StubTFile,
		TFolder: StubTFolder,
		Modal: StubModal,
		PluginSettingTab: StubPluginSettingTab,
		Setting: StubSetting,
		SettingGroup: StubSettingGroup,
		TextComponent: StubTextComponent,
		ButtonComponent: StubButtonComponent,
		DropdownComponent: StubDropdownComponent,
		Platform: {
			isDesktop: true,
			isDesktopApp: true,
			isMobile: false,
			isMacOS: false,
			isWin: true,
			isLinux: false,
		},
		normalizePath: (value) => value,
		// Obsidian inserts one bundled SVG; the stub inserts an empty one with the same class.
		setIcon: (parent, iconId) => {
			const svg = parent.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("class", `svg-icon lucide-${iconId}`);
			parent.replaceChildren(svg);
		},
	};
}

/**
 * The `app` object. No dictionary directory is exposed, and the only route an
 * artifact could take to one — `getResourcePath` — throws instead of
 * answering. Vault write APIs are recorded so a production Open that rewrote
 * a source note cannot pass silently.
 */
export function createObsidianApp(records) {
	const subscribe = (prefix) => (name) => {
		records.subscribedEvents.push(`${prefix}:${name}`);
		return { name };
	};
	const recordWrite = (api) => () => {
		records.writeCalls.push(api);
		throw new Error(
			`A self-contained artifact must not write the source note via ${api}.`,
		);
	};

	let app;
	const createLeaf = () => {
		const leaf = {
			view: null,
			get app() {
				return app;
			},
			async setViewState(state) {
				const factory = records.viewFactories.get(state.type);
				if (typeof factory !== "function") {
					throw new Error(`No view registered for ${state.type}.`);
				}
				this.view = factory(this);
				// Obsidian opens a newly installed View. Registration/lifecycle
				// capabilities must be exercised before driving its commands.
				await this.view.onOpen?.();
			},
		};
		records.leaves.push(leaf);
		return leaf;
	};

	app = {
		vault: {
			adapter: {
				getResourcePath: (vaultPath) => {
					records.resourcePathCalls.push(vaultPath);
					throw new Error(
						"A self-contained artifact must not ask for a resource path.",
					);
				},
				write: recordWrite("adapter.write"),
				writeBinary: recordWrite("adapter.writeBinary"),
			},
			on: subscribe("vault"),
			getAbstractFileByPath: (vaultPath) => {
				if (records.note?.file.path === vaultPath) {
					return records.note.file;
				}
				return null;
			},
			cachedRead: async (file) => {
				if (
					records.note &&
					(file === records.note.file || file?.path === records.note.file.path)
				) {
					return records.note.text;
				}
				return "";
			},
			create: recordWrite("create"),
			modify: recordWrite("modify"),
			append: recordWrite("append"),
			process: recordWrite("process"),
			delete: recordWrite("delete"),
			rename: recordWrite("rename"),
		},
		workspace: {
			getActiveViewOfType: (ViewClass) => {
				const view = records.activeLeaf?.view;
				return view instanceof ViewClass ? view : null;
			},
			getLeavesOfType: (type) =>
				records.leaves.filter((leaf) => leaf.view?.getViewType?.() === type),
			getLeaf: () => createLeaf(),
			setActiveLeaf: (leaf) => {
				records.activeLeaf = leaf;
			},
			on: subscribe("workspace"),
		},
	};
	return app;
}

/**
 * Replaces `fetch` and `XMLHttpRequest` with recorders that throw, and returns
 * an idempotent restore function.
 *
 * The traps must outlive `onload`. Every tokenizer here initializes lazily, so
 * nothing touches a dictionary until the first tokenize request — which
 * arrives from an asynchronous Open long after `onload` resolved.
 * Traps that were lifted at the end of `onload` would leave exactly the
 * interesting window uncovered, and "no network at runtime" would be
 * unproven: an artifact could fetch from inside that callback and the harness
 * would record nothing.
 */
function installNetworkTraps(records) {
	const originalFetch = Reflect.get(globalThis, "fetch");
	const originalXhr = Reflect.get(globalThis, "XMLHttpRequest");

	Reflect.set(globalThis, "fetch", (input) => {
		records.fetchCalls.push(String(input));
		throw new Error("A self-contained artifact must not call fetch.");
	});
	Reflect.set(
		globalThis,
		"XMLHttpRequest",
		class {
			constructor() {
				records.fetchCalls.push("XMLHttpRequest");
				throw new Error(
					"A self-contained artifact must not use XMLHttpRequest.",
				);
			}
		},
	);

	let restored = false;
	return () => {
		if (restored) {
			return;
		}
		restored = true;
		Reflect.set(globalThis, "fetch", originalFetch);
		Reflect.set(globalThis, "XMLHttpRequest", originalXhr);
	};
}

/**
 * Evaluates a built `main.js` the way Obsidian would and loads the plugin.
 *
 * `require` answers only `obsidian` and records every identifier asked for, so
 * a bundle that still needs `fs`, `zlib` or anything else is caught rather
 * than silently satisfied by Node.
 *
 * `fetch` and `XMLHttpRequest` stay trapped after this resolves, and the
 * caller releases them by calling the returned `restore`. Doing it here would
 * end the trap before the tokenizer has initialized; see
 * `installNetworkTraps`. `restore` is idempotent, and it runs automatically if
 * loading throws.
 */
export async function loadPluginArtifact(outDir, options = {}) {
	const records = options.records ?? createHarnessRecords();
	const mainPath = path.join(outDir, "main.js");
	const source = await readFile(mainPath, "utf8");

	const restoreDom = installHarnessDom();
	const obsidian = createObsidianStub(records);
	const app = createObsidianApp(records);
	const moduleShim = { exports: {} };
	const consoleShim = {
		debug: (message, details) => records.debugCalls.push({ message, details }),
		error: (...args) => records.errorCalls.push(args),
		log: () => undefined,
		warn: (...args) => records.warnCalls.push(args),
	};

	const factory = vm.compileFunction(
		source,
		["require", "module", "exports", "console"],
		{ filename: mainPath },
	);

	const restoreNetwork = installNetworkTraps(records);
	let restored = false;
	const restore = () => {
		if (restored) {
			return;
		}
		restored = true;
		restoreNetwork();
		restoreDom();
	};

	let plugin;
	try {
		factory(
			(id) => {
				records.requiredModules.push(id);
				if (id === "obsidian") {
					return obsidian;
				}
				throw new Error(`Unexpected runtime require: ${id}`);
			},
			moduleShim,
			moduleShim.exports,
			consoleShim,
		);

		const PluginClass = moduleShim.exports.default;
		if (typeof PluginClass !== "function") {
			throw new Error("The artifact did not export a default plugin class.");
		}
		plugin = new PluginClass(app, { dir: options.manifestDir ?? "plugins/semantropy" });
		// onload registers synchronously, then awaits the stored settings.
		await plugin.onload();
	} catch (error) {
		// The traps outlive a successful load, but not a failed one: there is
		// no caller holding a `restore` to call.
		restore();
		throw error;
	}

	return { plugin, records, app, obsidian, restore };
}

/**
 * Lets Collect write one configured Collection Markdown in memory.
 *
 * Every other write API stays trapped: source notes, adapter.write, modify,
 * append, delete and rename still throw. Call this explicitly after load if a
 * test needs Collect; Open tests must not, or they would hide a source write.
 */
export function emulateCollectionMarkdown(loaded, options = {}) {
	const path = options.path ?? "Semantropy Fragments.md";
	const { app, obsidian, records } = loaded;
	const previous = {
		getAbstractFileByPath: app.vault.getAbstractFileByPath,
		create: app.vault.create,
		process: app.vault.process,
	};
	let file = null;
	let contents = null;

	const isCollection = (vaultPath) => vaultPath === path;

	app.vault.getAbstractFileByPath = (vaultPath) => {
		if (isCollection(vaultPath)) {
			return file;
		}
		return previous.getAbstractFileByPath(vaultPath);
	};

	app.vault.create = async (vaultPath, data) => {
		records.writeCalls.push("create");
		if (!isCollection(vaultPath)) {
			throw new Error(
				"A self-contained artifact must not write the source note via create.",
			);
		}
		file = new obsidian.TFile();
		file.path = vaultPath;
		file.name = vaultPath.slice(vaultPath.lastIndexOf("/") + 1);
		file.extension = "md";
		contents = data;
		records.collection = { path: vaultPath, contents };
		return file;
	};

	app.vault.process = async (target, transform) => {
		records.writeCalls.push("process");
		if (!isCollection(target?.path)) {
			throw new Error(
				"A self-contained artifact must not write the source note via process.",
			);
		}
		contents = transform(contents ?? "");
		records.collection = { path, contents };
		return contents;
	};

	records.collection = { path, contents };
	return {
		path,
		read: () => contents,
	};
}

export function installMarkdownSource(loaded, options = {}) {
	const { obsidian, app, records } = loaded;
	const file = new obsidian.TFile();
	file.path = options.sourcePath ?? DEFAULT_OPEN_SOURCE_PATH;
	file.name = options.sourceName ?? DEFAULT_OPEN_SOURCE_NAME;
	file.extension = "md";
	const text = options.markdown ?? DEFAULT_OPEN_MARKDOWN;
	records.note = { file, text };

	const leaf = {
		view: null,
		get app() {
			return app;
		},
		async setViewState() {},
	};
	const view = new obsidian.MarkdownView(leaf);
	view.file = file;
	view.editor = {
		getValue: () => records.note.text,
	};
	leaf.view = view;
	records.leaves.push(leaf);
	records.activeLeaf = leaf;
	return leaf;
}

function semantropyView(loaded) {
	return loaded.records.leaves
		.map((leaf) => leaf.view)
		.find((view) => view?.getViewType?.() === "semantropy-view");
}

/**
 * Drives the artifact's own `Semantropy: Open` command against a fixed
 * Markdown note and waits until the view session settles. This is where the
 * tokenizer actually initializes, so the network traps installed by
 * `loadPluginArtifact` stay in place throughout — including inside the
 * asynchronous Open that starts after `onload` resolved.
 */
export async function openHarnessNote(loaded, options = {}) {
	const { records } = loaded;
	installMarkdownSource(loaded, options);
	const command = records.commands.get(OPEN_COMMAND_ID);
	if (!command) {
		throw new Error("The artifact did not register the open command.");
	}

	const started = performance.now();
	command();

	const deadline = Date.now() + (options.timeoutMs ?? 120_000);
	for (;;) {
		const view = semantropyView(loaded);
		if (view?.containerEl && view.containerEl.parentNode !== document.body) {
			document.body.appendChild(view.containerEl);
		}
		const status = view?.session?.getState?.()?.status;
		if (status === "ready" || status === "error") {
			const state = view.session?.getState?.();
			const bodyText = (view.targetBody?.getTextNodes?.() ?? [])
				.map((node) => node.nodeValue ?? "")
				.join("");
			return {
				status,
				elapsedMs: performance.now() - started,
				view,
				message: view.contentEl?.textContent ?? "",
				replacementCount: state?.replacementCount ?? null,
				replaceableSlotCount: state?.replaceableSlotCount ?? null,
				bodyText,
				snapshotText: state?.snapshot?.text ?? null,
			};
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`Open did not settle within the timeout. Errors: ${JSON.stringify(records.errorCalls)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/**
 * Invokes a registered command and waits for a Notice whose text starts with
 * `prefix`. Used by the harness's own trap fixtures, which implement a
 * minimal Open callback rather than a real view.
 */
export async function runCommandUntilNotice(loaded, commandId, prefix, options = {}) {
	const { records } = loaded;
	const command = records.commands.get(commandId);
	if (!command) {
		throw new Error(`The artifact did not register the ${commandId} command.`);
	}
	const noticesBefore = records.notices.length;
	const started = performance.now();
	command();

	const deadline = Date.now() + (options.timeoutMs ?? 120_000);
	for (;;) {
		const notice = records.notices
			.slice(noticesBefore)
			.find((message) => message.startsWith(prefix));
		if (notice) {
			return {
				notice,
				elapsedMs: performance.now() - started,
			};
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`The ${commandId} command produced no notice within the timeout. Errors: ${JSON.stringify(records.errorCalls)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
