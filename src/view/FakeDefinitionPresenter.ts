import { isSelectableDictionarySemantropy, type DictionarySemantropy } from "../settings/dictionarySemantropy";
import type { FakeDefinitionViewModel } from "./fakeDefinitionViewModel";
import { iconLabel } from "./controlIcon";
import { ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { UiLabels } from "../i18n/uiLabels";

export type FakeDefinitionPresenterHost = {
 getModel: () => FakeDefinitionViewModel;
 onReshuffle: () => void;
 onCopy: () => void;
 onCollect: () => void;
 onSemantropyChange: (value: DictionarySemantropy) => void;
};
/**
 * Modal and Popover share all displayed fields and enabled conditions. Plain text only, stable controls.
 *
 * EXPERIENCE-CONTROLS1 layout: a header with the headword (large), reading and part of speech on the
 * left and one tool group on the right — the three icon-only actions and the Dictionary level select —
 * then the definition. A long headword or a narrow Popover moves the whole tool group to the next line,
 * so no control is hidden. The actions' accessible names say what they do (Copy and Collect write the
 * headword and the definition); the select has no visible label but keeps its accessible name. Only
 * layout and names changed: every field, enabled condition, level choice and handler is the one it was.
 */
export class FakeDefinitionPresenter {
 private readonly root: HTMLElement;
 private readonly headword: HTMLElement;
 private readonly reading: HTMLElement;
 private readonly pos: HTMLElement;
 private readonly definition: HTMLElement;
 private readonly message: HTMLElement;
 private readonly select: HTMLSelectElement;
 private readonly reshuffle: HTMLButtonElement;
 private readonly copy: HTMLButtonElement;
 private readonly collect: HTMLButtonElement;
 private choices = "";
 private off: (() => void)[] = [];
 /** LOCALE1: fixed names, re-applied in place; generated text, headword and part of speech are never translated. */
 private readonly labels = new UiLabels();
 constructor(container: HTMLElement, private readonly host: FakeDefinitionPresenterHost) {
  this.root = container.createDiv({ cls: "semantropy-definition" });
  const header = this.root.createDiv({ cls: "semantropy-definition-header" });
  const heading = header.createDiv({ cls: "semantropy-definition-heading" });
  this.headword = heading.createDiv({ cls: "semantropy-definition-headword" });
  this.reading = heading.createDiv({ cls: "semantropy-definition-reading" });
  this.pos = heading.createDiv({ cls: "semantropy-definition-pos" });
  const tools = header.createDiv({ cls: "semantropy-definition-tools" });
  const actions = tools.createDiv({ cls: "semantropy-definition-actions" });
  this.reshuffle = this.action(actions, "semantropy-reshuffle-definition", "shuffle", () => ui().dictionary.reshuffle);
  this.copy = this.action(actions, "semantropy-copy-definition", "copy", () => ui().dictionary.copy);
  this.collect = this.action(actions, "semantropy-collect-definition", "inbox", () => ui().dictionary.collect);
  this.select = tools.createEl("select", { cls: "semantropy-level-select semantropy-dictionary-level-select" });
  this.labels.attr(this.select, "aria-label", () => ui().dictionary.level);
  this.listen(this.reshuffle, "click", () => this.host.onReshuffle());
  this.listen(this.copy, "click", () => this.host.onCopy());
  this.listen(this.collect, "click", () => this.host.onCollect());
  const body = this.root.createDiv({ cls: "semantropy-definition-body" });
  this.definition = body.createDiv({ cls: "semantropy-definition-text" });
  this.message = body.createDiv({ cls: "semantropy-definition-message", attr: { role: "status" } });
  this.listen(this.select, "change", () => {
   const value = Number(this.select.value);
   // Only a selectable level (never Off) reaches the host; anything else redraws the current one.
   if (isSelectableDictionarySemantropy(value)) this.host.onSemantropyChange(value); else this.sync();
  });
 }
 /** Icon-only: the name is the `aria-label`, Obsidian's one tooltip, and the hidden label text. */
 private action(parent: HTMLElement, cls: string, icon: "shuffle" | "copy" | "inbox", name: () => string): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `semantropy-action ${cls} is-icon-only`, attr: { type: "button" } });
  this.labels.attr(button, "aria-label", name);
  iconLabel(button, icon, name());
  const label = button.querySelector<HTMLElement>(".semantropy-action-label");
  if (label) this.labels.text(label, name);
  return button;
 }
 /** LOCALE1: re-words names, level choices and the status message; the definition stays as generated. */
 relabel(): void {
  this.labels.apply();
  this.choices = "";
  this.sync();
 }
 private listen(element: HTMLElement, type: string, fn: () => void): void {
  element.addEventListener(type, fn); this.off.push(() => element.removeEventListener(type, fn));
 }
 private text(element: HTMLElement, value: string | null): void {
  element.hidden = value === null;
  if (element.textContent !== (value ?? "")) element.textContent = value ?? "";
 }
 sync(): void {
  const model = this.host.getModel();
  this.text(this.headword, model.headword); this.text(this.pos, model.posLabel);
  // Omit the reading node itself when absent, instead of inventing a surface reading.
  if (model.reading === null) this.reading.remove();
  else { this.headword.after(this.reading); this.text(this.reading, model.reading); }
  this.text(this.definition, model.definition); this.text(this.message, model.message === null ? null : localize(model.message));
  const choices = JSON.stringify(model.levelChoices);
  if (choices !== this.choices) {
   this.select.empty(); for (const choice of model.levelChoices) this.select.createEl("option", { value: String(choice.value), text: localize(choice.label) });
   this.choices = choices;
  }
  this.select.value = String(model.dictionarySemantropy); this.select.disabled = !model.levelControlEnabled;
  this.reshuffle.disabled = !model.reshuffleEnabled; this.copy.disabled = !model.copyEnabled; this.collect.disabled = !model.collectEnabled;
 }
 dispose(): void { for (const off of this.off) off(); this.off = []; this.labels.clear(); this.root.remove(); }
}
