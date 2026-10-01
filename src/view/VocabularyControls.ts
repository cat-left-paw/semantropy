import { selectionSourceWeights, selectionWeight, type VocabularySelection } from "../application/prepareVocabulary";
import { iconLabel } from "./controlIcon";
import { ui } from "../i18n/catalog";
export type VocabularySourceIssue = { path: string; reason: "changed" | "missing" };
export type VocabularyControlsState = {
 selection: VocabularySelection; draft: VocabularySelection; stale: boolean; staleSources: readonly VocabularySourceIssue[]; preparing: boolean;
 progress: { done: number; total: number } | null; error: string | null; ready: boolean;
};

/**
 * The Toolbar's part of the Vocabulary: the entry to the View-owned picker (an
 * icon-only Toolbar control) and one short summary line in the status line.
 * Nothing here grows with the number of notes or stale Sources, so selecting
 * Vocabulary never makes the Toolbar taller; the paths, reasons and controls
 * live in `VocabularyModal`.
 */
export class VocabularyControls {
 readonly button: HTMLButtonElement;
 private status: HTMLElement;
 private handlers: (() => void)[] = [];
 constructor(parent: HTMLElement, summary: HTMLElement, private input: { state: () => VocabularyControlsState; open: () => void }) {
  const doc = parent.ownerDocument;
  this.status = doc.createElement("div"); this.status.className = "semantropy-vocabulary-status";
  this.button = doc.createElement("button"); this.button.type = "button";
  this.button.className = "semantropy-action semantropy-vocabulary-open is-toolbar-icon";
  // An icon distinct from Reshuffle (shuffle) and Refresh (refresh-cw); the short name is the tooltip.
  iconLabel(this.button, "library", ui().toolbar.controls.vocabulary.name);
  this.button.setAttribute("aria-label", ui().toolbar.controls.vocabulary.name);
  this.button.setAttribute("aria-haspopup", "dialog");
  parent.append(this.button); summary.append(this.status);
  const open = () => input.open();
  this.button.addEventListener("click", open); this.handlers.push(() => this.button.removeEventListener("click", open));
  this.sync();
 }
 sync(): void {
  const state = this.input.state();
  const v = ui().vocabulary;
  // The line names the committed Vocabulary. A draft that has not been applied
  // is a separate note, and so is preparation or a stale Source.
  const notes: string[] = [];
  if (state.preparing) notes.push(v.preparing);
  else if (!sameCommittedVocabulary(state.selection, state.draft)) notes.push(v.unapplied);
  const stale = state.staleSources.length;
  if (stale > 0) notes.push(v.stale(stale));
  const draw = state.selection.drawMode === "uniform" ? v.uniform : v.frequency;
  const text = v.summary(state.selection.mode === "current" ? v.currentNote : v.selectedNotesCount(state.selection.paths.length),
   selectionSourceWeights(state.selection) ? v.weightedDraw(draw) : draw, notes.join(" · "));
  if (this.status.textContent !== text) this.status.textContent = text;
 }
 /** LOCALE1: the entry's name follows the language; the Toolbar re-applies it with its own texts. */
 relabel(): void {
  const name = ui().toolbar.controls.vocabulary.name;
  const label = this.button.querySelector(".semantropy-action-label");
  if (label && label.textContent !== name) label.textContent = name;
  if (this.button.getAttribute("aria-label") !== name) this.button.setAttribute("aria-label", name);
  this.sync();
 }
 dispose(): void { for (const off of this.handlers) off(); this.handlers = []; this.status.remove(); }
}

/**
 * The summary compares what Apply would commit. Current Note ignores paths.
 * Selected Notes compare the path set, so order alone is not an unapplied change.
 */
function sameCommittedVocabulary(committed: VocabularySelection, draft: VocabularySelection): boolean {
	if (committed.mode !== draft.mode || committed.drawMode !== draft.drawMode) return false;
	if (committed.mode === "current") return true;
	if (committed.paths.length !== draft.paths.length) return false;
	const left = [...committed.paths].sort(), right = [...draft.paths].sort();
	return left.every((path, index) => path === right[index] && selectionWeight(committed, path) === selectionWeight(draft, path));
}
