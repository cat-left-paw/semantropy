import { FuzzySuggestModal, type App, type TFile } from "obsidian";
import { ui } from "./i18n/catalog";

/**
 * WORKBENCH-UI5 (`Docs/release_0_2_0_plan.md` §3.2.2, decision 17): Obsidian's own file chooser over the
 * Vault's Markdown notes, for the Shuffle area's "Choose target note". It lists paths only and reads nothing:
 * the note's text is read after the choice, by the same Open the command makes.
 *
 * Plugin-only, so the shared View (which the web page also runs) gains no Obsidian import for it. The
 * choice is a Promise: `null` when the chooser is closed without one. Obsidian's `selectSuggestion()`
 * closes the modal BEFORE it reports the choice, so the Promise is settled a microtask after the close.
 */
export class TargetNotePicker extends FuzzySuggestModal<TFile> {
	private chosen: TFile | null = null;
	private settle: ((file: TFile | null) => void) | null = null;

	constructor(app: App, private readonly notes: readonly TFile[]) {
		super(app);
	}

	/** Opens the chooser; resolves with the note picked, or null. */
	pick(): Promise<TFile | null> {
		return new Promise((resolve) => {
			this.settle = resolve;
			this.setPlaceholder(ui().shuffleBar.pickPlaceholder);
			this.open();
		});
	}

	getItems(): TFile[] {
		return [...this.notes];
	}

	getItemText(note: TFile): string {
		return note.path;
	}

	onChooseItem(note: TFile): void {
		this.chosen = note;
	}

	onClose(): void {
		super.onClose();
		const settle = this.settle;
		this.settle = null;
		if (!settle) return;
		// A choice follows the close within the same call; a microtask later it is known.
		void Promise.resolve().then(() => settle(this.chosen));
	}
}
