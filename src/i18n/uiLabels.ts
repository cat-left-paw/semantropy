/**
 * PRE-RELEASE-EXPERIENCE-LOCALE1: interface text that can be re-applied in place.
 *
 * A component registers how each of its elements gets its text; `apply()` runs
 * every registration again after the language changes. Nothing is rebuilt, so
 * focus, scroll, selection, open popups, drafts and committed results stay as
 * they are. Text that a component derives on every sync (status, diagnostics)
 * does not need registering: the component's own sync re-reads it.
 */
export class UiLabels {
	private readonly items: (() => void)[] = [];

	/** Runs `write` now and again on every `apply()`. */
	bind(write: () => void): void {
		write();
		this.items.push(write);
	}

	text(element: Node, text: () => string): void {
		this.bind(() => {
			const value = text();
			if (element.textContent !== value) element.textContent = value;
		});
	}

	attr(element: HTMLElement, name: string, text: () => string): void {
		this.bind(() => {
			const value = text();
			if (element.getAttribute(name) !== value) element.setAttribute(name, value);
		});
	}

	apply(): void {
		for (const write of this.items) write();
	}

	clear(): void {
		this.items.length = 0;
	}
}
