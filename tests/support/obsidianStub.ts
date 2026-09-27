/**
 * Stands in for the `obsidian` module under Vitest.
 *
 * The published package carries type declarations but no runnable entry — the
 * real implementation is supplied by the app at runtime and marked external by
 * every build here. Tests that exercise the plugin or the view need the base
 * classes to exist, so this provides the smallest versions that behave
 * correctly for `extends` and `instanceof`.
 *
 * Anything a test actually asserts on is overridden by that test. Methods left
 * here do nothing rather than pretending to succeed, and nothing in this file
 * reaches a filesystem, a Vault or the network.
 */

export class Component {
	load(): void {}
	unload(): void {}
	addChild<T>(child: T): T {
		return child;
	}
	removeChild<T>(child: T): T {
		return child;
	}
	register(): void {}
	registerEvent(): void {}
}

export class Events {
	on(): unknown {
		return {};
	}
	off(): void {}
	trigger(): void {}
}

export class ItemView extends Component {
	containerEl: unknown;
	constructor(public leaf: unknown) {
		super();
	}
	getViewType(): string {
		return "";
	}
	getDisplayText(): string {
		return "";
	}
}

export class Plugin extends Component {
	/**
	 * Obsidian keeps each `addRibbonIcon` registration, named with its title,
	 * until plugin unload. Removing the element does not drop the registration.
	 */
	readonly ribbonRegistrations: { title: string; el: HTMLElement }[] = [];
	private ribbonUnloaders: Array<() => void> = [];
	constructor(
		public app: unknown,
		public manifest: unknown,
	) {
		super();
	}
	addCommand<T>(command: T): T {
		return command;
	}
	register(callback?: () => void): void {
		if (callback) this.ribbonUnloaders.push(callback);
	}
	/** Runs `onunload`, then the ribbon registrations Obsidian drops only here. */
	unload(): void {
		(this as { onunload?: () => void }).onunload?.();
		for (const callback of this.ribbonUnloaders.splice(0)) callback();
	}
	registerView(): void {}
	addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
		const el = typeof document === "undefined" ? memoryRibbon(icon, title, callback) : ribbonButton(icon, title, callback);
		const registration = { title, el };
		this.ribbonRegistrations.push(registration);
		this.register(() => {
			const index = this.ribbonRegistrations.indexOf(registration);
			if (index >= 0) this.ribbonRegistrations.splice(index, 1);
			el.remove();
		});
		return el;
	}
	addSettingTab(): void {}
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(): Promise<void> {}
}

export class MarkdownView extends ItemView {
	file: unknown = null;
	editor: unknown = null;
}

export class Notice {
	containerEl: HTMLElement;
	messageEl: HTMLElement;
	constructor(public message: string) {
		if (typeof document === "undefined") {
			this.containerEl = { isConnected: false } as HTMLElement;
			this.messageEl = { textContent: message } as HTMLElement;
			return;
		}
		this.containerEl = document.createElement("div");
		this.messageEl = this.containerEl.appendChild(document.createElement("div"));
		this.messageEl.textContent = message;
		document.body.appendChild(this.containerEl);
	}
	setMessage(message: string): this { this.message = message; this.messageEl.textContent = message; return this; }
	hide(): void { this.containerEl.remove?.(); }
}

export class TFile {
	path = "";
	name = "";
	extension = "";
}

export class TFolder {
	path = "";
	name = "";
}

export class Modal {
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	contentEl: HTMLElement;
	titleEl: HTMLElement;

	constructor(public app: unknown) {
		if (typeof document !== "undefined") {
			this.containerEl = document.createElement("div");
			this.modalEl = this.containerEl;
			this.titleEl = document.createElement("div");
			this.contentEl = document.createElement("div");
			this.containerEl.appendChild(this.titleEl);
			this.containerEl.appendChild(this.contentEl);
		} else {
			this.containerEl = {} as HTMLElement;
			this.modalEl = this.containerEl;
			this.titleEl = this.containerEl;
			this.contentEl = this.containerEl;
		}
	}

	open(): void {
		if (typeof document !== "undefined") {
			document.body.appendChild(this.containerEl);
		}
		this.onOpen();
	}

	close(): void {
		this.onClose();
		if (this.containerEl.parentNode) {
			this.containerEl.remove();
		}
	}

	onOpen(): void {}

	onClose(): void {}

	setTitle(title: string): void {
		if ("textContent" in this.titleEl) {
			this.titleEl.textContent = title;
		}
	}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: HTMLElement;

	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
		if (typeof document !== "undefined") {
			this.containerEl = document.createElement("div");
		} else {
			this.containerEl = { empty() {} } as HTMLElement;
		}
	}

	display(): void {}

	hide(): void {}

	getSettingDefinitions(): unknown[] {
		return [];
	}
}

export class SettingGroup {
	listEl: HTMLElement;
	private headingEl: HTMLElement | null = null;

	constructor(containerEl: HTMLElement) {
		this.listEl = containerEl;
	}

	setHeading(text: string): this {
		if (!this.headingEl) {
			this.headingEl = this.listEl.ownerDocument.createElement("h3");
			this.headingEl.className = "setting-group-heading";
			this.listEl.prepend(this.headingEl);
		}
		this.headingEl.textContent = text;
		return this;
	}

	addClass(): this {
		return this;
	}

	addSetting(): this {
		return this;
	}

	addSearch(): this {
		return this;
	}

	addExtraButton(): this {
		return this;
	}
}

export class TextComponent {
	inputEl: HTMLInputElement;
	disabled = false;

	constructor(inputEl: HTMLInputElement) {
		this.inputEl = inputEl;
	}

	getValue(): string {
		return this.inputEl.value;
	}

	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.inputEl.disabled = disabled;
		return this;
	}

	onChange(callback: (value: string) => unknown): this {
		this.inputEl.addEventListener("input", () => {
			callback(this.inputEl.value);
		});
		return this;
	}
}

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	disabled = false;

	constructor(buttonEl: HTMLButtonElement) {
		this.buttonEl = buttonEl;
	}

	setButtonText(name: string): this {
		this.buttonEl.textContent = name;
		return this;
	}

	setCta(): this {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}

	setClass(cls: string): this {
		this.buttonEl.classList.add(cls);
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.buttonEl.disabled = disabled;
		return this;
	}

	onClick(callback: (evt: MouseEvent) => unknown): this {
		this.buttonEl.addEventListener("click", (event) => {
			void callback(event);
		});
		return this;
	}
}

export class DropdownComponent {
	selectEl: HTMLSelectElement;
	disabled = false;

	constructor(selectEl: HTMLSelectElement) {
		this.selectEl = selectEl;
	}

	addOption(value: string, display: string): this {
		const option = this.selectEl.createEl("option", { value, text: display });
		option.value = value;
		return this;
	}

	getValue(): string {
		return this.selectEl.value;
	}

	setValue(value: string): this {
		this.selectEl.value = value;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.selectEl.disabled = disabled;
		return this;
	}

	onChange(callback: (value: string) => unknown): this {
		this.selectEl.addEventListener("change", () => {
			void callback(this.selectEl.value);
		});
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	components: unknown[] = [];

	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
		this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.infoEl.createDiv({
			cls: "setting-item-description",
		});
		this.controlEl = this.settingEl.createDiv({
			cls: "setting-item-control",
		});
	}

	setName(name: string): this {
		this.nameEl.setText(name);
		return this;
	}

	setDesc(desc: string): this {
		this.descEl.setText(desc);
		return this;
	}

	setClass(cls: string): this {
		this.settingEl.classList.add(cls);
		return this;
	}

	addText(cb: (component: TextComponent) => unknown): this {
		const input = this.controlEl.createEl("input");
		input.type = "text";
		const component = new TextComponent(input);
		cb(component);
		this.components.push(component);
		return this;
	}

	addButton(cb: (component: ButtonComponent) => unknown): this {
		const button = this.controlEl.createEl("button", {
			attr: { type: "button" },
		});
		const component = new ButtonComponent(button);
		cb(component);
		this.components.push(component);
		return this;
	}

	addDropdown(cb: (component: DropdownComponent) => unknown): this {
		const component = new DropdownComponent(this.controlEl.createEl("select"));
		cb(component);
		this.components.push(component);
		return this;
	}

	addToggle(cb: (component: ToggleComponent) => unknown): this {
		const component = new ToggleComponent(this.controlEl);
		cb(component);
		this.components.push(component);
		return this;
	}
}

export class ToggleComponent {
	toggleEl: HTMLElement;
	private value = false;
	private change: ((value: boolean) => unknown) | null = null;

	constructor(containerEl: HTMLElement) {
		this.toggleEl = containerEl.ownerDocument.createElement("div");
		this.toggleEl.className = "checkbox-container";
		this.toggleEl.setAttribute("role", "switch");
		this.toggleEl.tabIndex = 0;
		this.toggleEl.addEventListener("click", () => {
			this.setValue(!this.value);
			void this.change?.(this.value);
		});
		this.toggleEl.addEventListener("keydown", (event) => {
			if (event.key !== " " && event.key !== "Enter") return;
			event.preventDefault();
			this.toggleEl.click();
		});
		containerEl.append(this.toggleEl);
		this.setValue(false);
	}

	getValue(): boolean { return this.value; }

	setValue(on: boolean): this {
		this.value = on;
		this.toggleEl.classList.toggle("is-enabled", on);
		this.toggleEl.setAttribute("aria-checked", on ? "true" : "false");
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.toggleEl.toggleAttribute("aria-disabled", disabled);
		return this;
	}

	onChange(callback: (value: boolean) => unknown): this {
		this.change = callback;
		return this;
	}
}

function ribbonButton(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
	const el = document.createElement("button");
	el.type = "button";
	el.className = "side-dock-ribbon-action";
	el.dataset.icon = icon;
	el.setAttribute("aria-label", title);
	el.addEventListener("click", (event) => { void callback(event); });
	document.body.append(el);
	return el;
}

/** A ribbon button for tests that have no document. */
function memoryRibbon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
	const attrs = new Map<string, string>([["aria-label", title]]);
	const listeners: { type: string; fn: (event: MouseEvent) => void }[] = [];
	const el = {
		isConnected: true,
		dataset: { icon },
		classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
		setAttribute(name: string, value: string) { attrs.set(name, value); },
		getAttribute(name: string) { return attrs.get(name) ?? null; },
		addEventListener(type: string, fn: (event: MouseEvent) => void) { listeners.push({ type, fn }); },
		removeEventListener() {},
		remove() { this.isConnected = false; listeners.length = 0; },
		click() { for (const listener of [...listeners]) if (listener.type === "click") listener.fn(new MouseEvent("click")); },
	};
	el.addEventListener("click", (event) => { void callback(event); });
	return el as unknown as HTMLElement;
}

export const Platform = {
	isDesktop: true,
	isDesktopApp: true,
	isMobile: false,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
	isPhone: false,
	isTablet: false,
	isMacOS: false,
	isWin: true,
	isLinux: false,
	isSafari: false,
};

export const MarkdownRenderer = {
	render: async (): Promise<void> => undefined,
};

export function normalizePath(value: string): string {
	return value;
}

/** Obsidian inserts one bundled SVG; the stub inserts an empty one with the same class. */
export function setIcon(parent: HTMLElement, iconId: string): void {
	const svg = parent.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", `svg-icon lucide-${iconId}`);
	parent.replaceChildren(svg);
}
