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

/** The small subset of Obsidian's DOM helpers the view's chrome uses. */
export function installObsidianDomHelpers(): () => void {
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
	proto["toggleClass"] = function toggleClass(this: HTMLElement, cls: string, on: boolean) {
		this.classList.toggle(cls, on);
		return this;
	};
	proto["createDiv"] = function createDiv(this: HTMLElement, opts?: string | DomInfo) {
		const el = this.ownerDocument.createElement("div");
		applyDomInfo(el, opts);
		this.appendChild(el);
		return el;
	};
	proto["createEl"] = function createEl(this: HTMLElement, tag: string, opts?: string | DomInfo) {
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
	Reflect.set(globalThis, "createDiv", (opts?: string | DomInfo) => {
		const el = document.createElement("div");
		applyDomInfo(el, opts);
		return el;
	});
	return () => {
		proto["empty"] = previous.empty;
		proto["createSpan"] = previous.createSpan;
		proto["setText"] = previous.setText;
		proto["toggleClass"] = previous.toggleClass;
		proto["createDiv"] = previous.createDiv;
		proto["createEl"] = previous.createEl;
		if (previous.hasCreateDiv) {
			Reflect.set(globalThis, "createDiv", previous.createDivGlobal);
		} else {
			Reflect.deleteProperty(globalThis, "createDiv");
		}
	};
}
