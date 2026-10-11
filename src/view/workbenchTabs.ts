import type { IconName } from "obsidian";
import { iconLabel } from "./controlIcon";
import { ui } from "../i18n/catalog";
import type { UiLabels } from "../i18n/uiLabels";

/** WORKBENCH-UI2 (`Docs/release_0_2_0_plan.md` §3.3): the two panes of the body area. Never persisted. */
export type WorkbenchTab = "shuffle" | "recompose";

const ORDER: readonly WorkbenchTab[] = ["shuffle", "recompose"];

/** WORKBENCH-UI5: a glyph before each tab's name. It is decoration (hidden from assistive technology); the name is the text. */
const ICONS: Readonly<Record<WorkbenchTab, IconName>> = { shuffle: "dices", recompose: "wand-sparkles" };

/**
 * The tab row between the status chrome and the one scrolling box. It is a
 * tablist with automatic activation: only the selected tab is a Tab stop, and
 * Left / Right / Home / End move to another tab and select it. The row only
 * reports a choice; the View switches the panes, so the View alone decides
 * which tab is shown and every rule tied to it.
 */
export class WorkbenchTabs {
	private readonly row: HTMLElement;
	private readonly tabs: Readonly<Record<WorkbenchTab, HTMLButtonElement>>;
	private readonly listeners: (() => void)[] = [];

	constructor(parent: HTMLElement, before: HTMLElement, panes: Readonly<Record<WorkbenchTab, HTMLElement>>, idPrefix: string,
		labels: UiLabels, select: (tab: WorkbenchTab, focus: boolean) => void) {
		this.row = parent.createDiv({ cls: "semantropy-tabs", attr: { role: "tablist" } });
		parent.insertBefore(this.row, before);
		labels.attr(this.row, "aria-label", () => ui().workbench.tabs);
		const make = (tab: WorkbenchTab): HTMLButtonElement => {
			const button = this.row.createEl("button", { cls: `semantropy-tab semantropy-tab-${tab}`,
				attr: { type: "button", id: `${idPrefix}-tab-${tab}`, role: "tab", "aria-controls": `${idPrefix}-pane-${tab}` } });
			panes[tab].id = `${idPrefix}-pane-${tab}`;
			panes[tab].setAttribute("role", "tabpanel");
			panes[tab].setAttribute("aria-labelledby", button.id);
			iconLabel(button, ICONS[tab], ui().workbench[tab]);
			const text = button.querySelector<HTMLElement>(".semantropy-action-label");
			if (text) labels.text(text, () => ui().workbench[tab]);
			this.listen(button, "click", () => select(tab, false));
			return button;
		};
		this.tabs = { shuffle: make("shuffle"), recompose: make("recompose") };
		this.listen(this.row, "keydown", event => {
			const keyboard = event as KeyboardEvent, key = keyboard.key;
			// Review 1: a key with a modifier belongs to someone else (the app, the system, a shortcut).
			if (keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey || keyboard.shiftKey) return;
			const current = ORDER.findIndex(tab => this.tabs[tab] === event.target);
			if (current < 0) return;
			const next = key === "ArrowRight" ? (current + 1) % ORDER.length : key === "ArrowLeft" ? (current + ORDER.length - 1) % ORDER.length
				: key === "Home" ? 0 : key === "End" ? ORDER.length - 1 : -1;
			if (next < 0) return;
			event.preventDefault();
			select(ORDER[next]!, true);
		});
	}

	/** Marks `active` selected; it becomes the row's only Tab stop. */
	sync(active: WorkbenchTab): void {
		for (const tab of ORDER) {
			const button = this.tabs[tab], selected = tab === active;
			if (button.getAttribute("aria-selected") !== String(selected)) button.setAttribute("aria-selected", String(selected));
			button.tabIndex = selected ? 0 : -1;
			button.classList.toggle("is-active", selected);
		}
	}

	focus(tab: WorkbenchTab): void {
		this.tabs[tab].focus();
	}

	dispose(): void {
		for (const off of this.listeners.splice(0)) off();
	}

	private listen(target: HTMLElement, type: string, handler: (event: Event) => void): void {
		target.addEventListener(type, handler);
		this.listeners.push(() => target.removeEventListener(type, handler));
	}
}
