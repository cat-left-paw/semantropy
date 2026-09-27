import { Modal, type App } from "obsidian";
import { FakeDefinitionPresenter, type FakeDefinitionPresenterHost } from "./FakeDefinitionPresenter";
import { ui } from "../i18n/catalog";
export type FakeDefinitionModalHost = FakeDefinitionPresenterHost & { onClosed: () => void };
/** Keyboard/selection alternative; rendering and action conditions are shared with the Popover. */
export class FakeDefinitionModal extends Modal {
 private opened = false;
 private presenter: FakeDefinitionPresenter | null = null;
 constructor(app: App, private readonly host: FakeDefinitionModalHost) { super(app); }
 isOpen(): boolean { return this.opened; }
 onOpen(): void {
  this.opened = true; this.modalEl.classList.add("semantropy-dictionary-modal"); this.setTitle(ui().dictionary.title);
  this.presenter = new FakeDefinitionPresenter(this.contentEl, this.host); this.sync();
 }
 onClose(): void { this.opened = false; this.presenter?.dispose(); this.presenter = null; this.host.onClosed(); }
 sync(): void { if (this.opened) this.presenter?.sync(); }
 /** LOCALE1: re-words the open Modal in place; the definition stays as generated. */
 relabel(): void { if (!this.opened) return; this.setTitle(ui().dictionary.title); this.presenter?.relabel(); }
}
