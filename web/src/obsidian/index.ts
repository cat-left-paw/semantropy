/**
 * The `obsidian` module as the web build sees it.
 *
 * Semantropy's shared View code imports a handful of Obsidian classes and
 * functions. The Obsidian build keeps them external and gets the real ones from
 * the app; the web build aliases `obsidian` to this file instead. Only the
 * members the shared code uses are implemented, and each behaves the way the
 * shared code relies on: an `ItemView` owns a `.workspace-leaf-content` with a
 * `.view-content`, a `Modal` is a dialog appended to `<body>` that Escape and
 * the backdrop close, and `setIcon` draws a bundled Lucide glyph.
 *
 * Nothing here reads files, opens a network connection or keeps note text.
 */
import { setIcon as drawIcon } from "./icons";

export type IconName = string;

export type App = { readonly web: true };

export type WorkspaceLeaf = {
	app: App;
	view: unknown;
};

export class Component {
	#cleanups: (() => void)[] = [];
	#children: Component[] = [];
	#loaded = false;

	load(): void {
		if (this.#loaded) return;
		this.#loaded = true;
		this.onload();
		for (const child of this.#children) child.load();
	}

	onload(): void {}

	unload(): void {
		if (!this.#loaded) return;
		this.#loaded = false;
		for (const child of this.#children.splice(0)) child.unload();
		for (const cleanup of this.#cleanups.splice(0).reverse()) {
			try {
				cleanup();
			} catch {
				// One failed cleanup must not keep the others from running.
			}
		}
		this.onunload();
	}

	onunload(): void {}

	addChild<T extends Component>(child: T): T {
		this.#children.push(child);
		if (this.#loaded) child.load();
		return child;
	}

	removeChild<T extends Component>(child: T): T {
		const index = this.#children.indexOf(child);
		if (index >= 0) {
			this.#children.splice(index, 1);
			child.unload();
		}
		return child;
	}

	register(cleanup: () => void): void {
		this.#cleanups.push(cleanup);
	}

	registerDomEvent<K extends keyof HTMLElementEventMap>(
		el: HTMLElement | Document | Window,
		type: K,
		callback: (event: HTMLElementEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void {
		const listener = callback as EventListener;
		el.addEventListener(type, listener, options);
		this.register(() => el.removeEventListener(type, listener, options));
	}

	registerInterval(id: number): number {
		this.register(() => window.clearInterval(id));
		return id;
	}
}

export abstract class ItemView extends Component {
	app: App;
	leaf: WorkspaceLeaf;
	containerEl: HTMLElement;
	contentEl: HTMLElement;
	navigation = true;

	constructor(leaf: WorkspaceLeaf) {
		super();
		this.leaf = leaf;
		this.app = leaf.app;
		const doc = document;
		this.containerEl = doc.createElement("div");
		this.containerEl.className = "workspace-leaf-content";
		const header = doc.createElement("div");
		header.className = "view-header";
		header.hidden = true;
		this.contentEl = doc.createElement("div");
		this.contentEl.className = "view-content";
		this.containerEl.append(header, this.contentEl);
	}

	abstract getViewType(): string;
	abstract getDisplayText(): string;

	getIcon(): IconName {
		return "file";
	}

	getState(): Record<string, unknown> {
		return {};
	}

	async onOpen(): Promise<void> {}

	async onClose(): Promise<void> {}

	onResize(): void {}
}

/** The open dialogs, innermost last; only the innermost answers Escape. */
const openModals: Modal[] = [];

export class Modal {
	app: App;
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	shouldRestoreSelection = false;
	readonly #bgEl: HTMLElement;
	#opened = false;
	#returnFocus: Element | null = null;
	readonly #onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
		if (openModals[openModals.length - 1] !== this) return;
		event.preventDefault();
		this.close();
	};

	constructor(app: App) {
		this.app = app;
		const doc = document;
		this.containerEl = doc.createElement("div");
		this.containerEl.className = "modal-container mod-dim";
		this.#bgEl = doc.createElement("div");
		this.#bgEl.className = "modal-bg";
		this.modalEl = doc.createElement("div");
		this.modalEl.className = "modal";
		this.modalEl.setAttribute("role", "dialog");
		this.modalEl.setAttribute("aria-modal", "true");
		this.modalEl.tabIndex = -1;
		const close = doc.createElement("button");
		close.type = "button";
		close.className = "modal-close-button";
		close.setAttribute("aria-label", "Close");
		drawIcon(close, "x");
		close.addEventListener("click", () => this.close());
		const header = doc.createElement("div");
		header.className = "modal-header";
		this.titleEl = doc.createElement("div");
		this.titleEl.className = "modal-title";
		this.titleEl.id = `semantropy-web-modal-title-${++modalSequence}`;
		this.modalEl.setAttribute("aria-labelledby", this.titleEl.id);
		header.appendChild(this.titleEl);
		this.contentEl = doc.createElement("div");
		this.contentEl.className = "modal-content";
		this.modalEl.append(close, header, this.contentEl);
		this.containerEl.append(this.#bgEl, this.modalEl);
		this.#bgEl.addEventListener("click", () => this.close());
	}

	open(): void {
		if (this.#opened) return;
		this.#opened = true;
		this.#returnFocus = document.activeElement;
		openModals.push(this);
		document.body.appendChild(this.containerEl);
		document.addEventListener("keydown", this.#onKeyDown);
		this.onOpen();
		if (!this.modalEl.contains(document.activeElement)) {
			this.modalEl.focus({ preventScroll: true });
		}
	}

	close(): void {
		if (!this.#opened) return;
		this.#opened = false;
		document.removeEventListener("keydown", this.#onKeyDown);
		const index = openModals.indexOf(this);
		if (index >= 0) openModals.splice(index, 1);
		try {
			this.onClose();
		} finally {
			this.containerEl.remove();
			const target = this.#returnFocus;
			this.#returnFocus = null;
			if (target instanceof HTMLElement && target.isConnected && !document.activeElement?.closest(".modal")) {
				target.focus({ preventScroll: true });
			}
		}
	}

	onOpen(): void {}

	onClose(): void {}

	setTitle(title: string): this {
		this.titleEl.textContent = title;
		return this;
	}

	setContent(content: string | DocumentFragment): this {
		if (typeof content === "string") this.contentEl.textContent = content;
		else this.contentEl.replaceChildren(content);
		return this;
	}
}

let modalSequence = 0;

/** Brief messages at the bottom of the page. */
export class Notice {
	noticeEl: HTMLElement;
	containerEl: HTMLElement;
	messageEl: HTMLElement;
	#timer: number | null = null;

	constructor(message: string | DocumentFragment, duration = 4500) {
		const doc = document;
		let region = doc.querySelector<HTMLElement>(".notice-container");
		if (!region) {
			region = doc.createElement("div");
			region.className = "notice-container";
			region.setAttribute("role", "status");
			region.setAttribute("aria-live", "polite");
			doc.body.appendChild(region);
		}
		this.containerEl = doc.createElement("div");
		this.containerEl.className = "notice";
		this.noticeEl = this.containerEl;
		this.messageEl = doc.createElement("div");
		this.messageEl.className = "notice-message";
		this.containerEl.appendChild(this.messageEl);
		this.setMessage(message);
		this.containerEl.addEventListener("click", () => this.hide());
		region.appendChild(this.containerEl);
		if (duration > 0) this.#timer = window.setTimeout(() => this.hide(), duration);
	}

	setMessage(message: string | DocumentFragment): this {
		if (typeof message === "string") this.messageEl.textContent = message;
		else this.messageEl.replaceChildren(message);
		return this;
	}

	hide(): void {
		if (this.#timer !== null) window.clearTimeout(this.#timer);
		this.#timer = null;
		this.containerEl.remove();
	}
}

function detectPlatform() {
	const nav: (Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }) | undefined =
		typeof navigator === "undefined" ? undefined : navigator;
	const data = nav?.userAgentData;
	const platform = (data?.platform ?? nav?.platform ?? "").toLowerCase();
	const agent = (nav?.userAgent ?? "").toLowerCase();
	const ios = /iphone|ipad|ipod/.test(agent) || (platform === "macintel" && (nav?.maxTouchPoints ?? 0) > 1);
	const android = agent.includes("android");
	const mac = !ios && (platform.startsWith("mac") || agent.includes("mac os"));
	const mobile = ios || android || data?.mobile === true;
	return {
		isDesktop: !mobile,
		isDesktopApp: false,
		isMobile: mobile,
		isMobileApp: false,
		isIosApp: false,
		isAndroidApp: false,
		isPhone: mobile,
		isTablet: false,
		isMacOS: mac || ios,
		isWin: platform.startsWith("win") || agent.includes("windows"),
		isLinux: platform.includes("linux") && !android,
		isSafari: agent.includes("safari") && !agent.includes("chrome") && !agent.includes("android"),
	};
}

export const Platform = detectPlatform();

export function setIcon(parent: HTMLElement, iconId: IconName): void {
	drawIcon(parent, iconId);
}
