/**
 * The DOM helpers Obsidian adds to `HTMLElement.prototype` and to the global
 * scope, reduced to the calls Semantropy's shared View code makes:
 * `createDiv`, `createEl`, `createSpan`, `empty`, `setText` and `toggleClass`.
 *
 * The web build installs them once, before any shared module constructs DOM.
 * They only create ordinary elements under the element they are called on;
 * none of them parses HTML.
 */
export type DomElementInfo = {
	cls?: string | string[];
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null | undefined>;
	title?: string;
	value?: string;
	type?: string;
	placeholder?: string;
	href?: string;
	prepend?: boolean;
	parent?: Node;
};

type Callback<T extends HTMLElement> = (el: T) => void;

function applyInfo(el: HTMLElement, info?: string | DomElementInfo): void {
	if (info == null) return;
	if (typeof info === "string") {
		el.className = info;
		return;
	}
	if (info.cls !== undefined) {
		el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
	}
	if (info.text !== undefined) {
		if (typeof info.text === "string") el.textContent = info.text;
		else el.replaceChildren(info.text);
	}
	if (info.attr) {
		for (const [key, value] of Object.entries(info.attr)) {
			if (value === null || value === undefined || value === false) continue;
			el.setAttribute(key, value === true ? "" : String(value));
		}
	}
	if (info.title !== undefined) el.setAttribute("title", info.title);
	if (info.type !== undefined) el.setAttribute("type", info.type);
	if (info.placeholder !== undefined) el.setAttribute("placeholder", info.placeholder);
	if (info.href !== undefined) el.setAttribute("href", info.href);
	if (info.value !== undefined && "value" in el) {
		(el as HTMLElement & { value: string }).value = info.value;
	}
}

function create<K extends keyof HTMLElementTagNameMap>(
	doc: Document,
	tag: K,
	info?: string | DomElementInfo,
	callback?: Callback<HTMLElementTagNameMap[K]>,
): HTMLElementTagNameMap[K] {
	const el = doc.createElement(tag);
	applyInfo(el, info);
	if (typeof info === "object" && info?.parent) {
		if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild);
		else info.parent.appendChild(el);
	}
	callback?.(el);
	return el;
}

function attach<T extends HTMLElement>(parent: HTMLElement, el: T, info?: string | DomElementInfo): T {
	if (typeof info === "object" && info?.prepend) parent.insertBefore(el, parent.firstChild);
	else parent.appendChild(el);
	return el;
}

let installed = false;

export function installDomHelpers(): void {
	if (installed) return;
	installed = true;
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	const define = (name: string, value: unknown): void => {
		Object.defineProperty(proto, name, { value, configurable: true, writable: true });
	};
	define("createEl", function createEl(this: HTMLElement, tag: keyof HTMLElementTagNameMap, info?: string | DomElementInfo, callback?: Callback<HTMLElement>) {
		const el = create(this.ownerDocument, tag, typeof info === "object" ? { ...info, parent: undefined } : info);
		attach(this, el, info);
		callback?.(el);
		return el;
	});
	define("createDiv", function createDiv(this: HTMLElement, info?: string | DomElementInfo, callback?: Callback<HTMLDivElement>) {
		const el = create(this.ownerDocument, "div", typeof info === "object" ? { ...info, parent: undefined } : info);
		attach(this, el, info);
		callback?.(el);
		return el;
	});
	define("createSpan", function createSpan(this: HTMLElement, info?: string | DomElementInfo, callback?: Callback<HTMLSpanElement>) {
		const el = create(this.ownerDocument, "span", typeof info === "object" ? { ...info, parent: undefined } : info);
		attach(this, el, info);
		callback?.(el);
		return el;
	});
	define("empty", function empty(this: HTMLElement) {
		this.replaceChildren();
	});
	define("setText", function setText(this: HTMLElement, text: string | DocumentFragment) {
		if (typeof text === "string") this.textContent = text;
		else this.replaceChildren(text);
	});
	define("toggleClass", function toggleClass(this: HTMLElement, cls: string | string[], on: boolean) {
		for (const name of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(name, on);
	});
	define("addClass", function addClass(this: HTMLElement, ...cls: string[]) {
		this.classList.add(...cls);
	});
	define("removeClass", function removeClass(this: HTMLElement, ...cls: string[]) {
		this.classList.remove(...cls);
	});
	define("detach", function detach(this: HTMLElement) {
		this.remove();
	});
	const global = globalThis as unknown as Record<string, unknown>;
	global["createEl"] = (tag: keyof HTMLElementTagNameMap, info?: string | DomElementInfo, callback?: Callback<HTMLElement>) => create(document, tag, info, callback);
	global["createDiv"] = (info?: string | DomElementInfo, callback?: Callback<HTMLDivElement>) => create(document, "div", info, callback);
	global["createSpan"] = (info?: string | DomElementInfo, callback?: Callback<HTMLSpanElement>) => create(document, "span", info, callback);
	global["activeDocument"] = document;
	global["activeWindow"] = window;
}
