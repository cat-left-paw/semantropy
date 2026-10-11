import { selectionSourceWeights, selectionWeight, type VocabularySelection } from "../application/prepareVocabulary";
import { iconLabel } from "./controlIcon";
import { ui } from "../i18n/catalog";
import { vocabularySourceMark } from "./vocabularySourceMark";
export type VocabularySourceIssue = { path: string; reason: "changed" | "missing" };
export type VocabularyControlsState = {
 selection: VocabularySelection; draft: VocabularySelection; stale: boolean; staleSources: readonly VocabularySourceIssue[]; preparing: boolean;
 progress: { done: number; total: number } | null; error: string | null; ready: boolean;
 /** WORKBENCH-UI5: a Vocabulary is in force (a note is open, or Selected Notes was applied with none): the only time the line names one. */
 applied: boolean;
 /** WORKBENCH-UI5: the Vault paths of the applied Vocabulary's Sources, in path order (empty when none is applied). */
 sources: readonly string[];
 /**
  * WORKBENCH-UI5 (review 3, P3 4): the Vault's listing of Markdown paths, read only when the list of Sources is opened, so it can mark a
  * Source gone from the Vault as the picker does. Null (or absent) is a host with no listing: no Source is then called missing from it.
  */
 listedPaths?: () => readonly string[] | null;
};

/**
 * WORKBENCH-UI5 (owner, 2026-10-08): what a host with tabs gives the summary so it can name the notes. The list
 * of every Source is a Toolbar popup (aria-expanded, Escape and a click outside close it, one popup at a time),
 * opened from the status line; the Toolbar registers it.
 */
export type VocabularyNames = {
 adopt: (button: HTMLButtonElement, panel: HTMLElement, container: HTMLElement) => void;
};

let CONTROLS_SEQUENCE = 0;
/** Stands for the note's name in a template, so the text before and after it can be written around the name's own element. */
const NAME_MARK = "\u0001";
function aroundName(template: string): [string, string] {
 const at = template.indexOf(NAME_MARK);
 return [template.slice(0, at), template.slice(at + NAME_MARK.length)];
}

/** The file name of a Vault path, as written (with its extension). */
export function noteFileName(path: string): string {
 return path.slice(path.lastIndexOf("/") + 1);
}

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
 /** The summary with the notes' names (a host with tabs): the pieces it rewrites, and the list's button and panel. */
 private named: {
  toggle: HTMLButtonElement; panel: HTMLElement; list: HTMLUListElement; key: string; listKey: string; nameEl: HTMLElement | null; fullName: string;
 } | null = null;
 constructor(parent: HTMLElement, summary: HTMLElement, private input: { state: () => VocabularyControlsState; open: () => void; names?: VocabularyNames }) {
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
  if (input.names) {
   const id = `semantropy-vocabulary-sources-${(CONTROLS_SEQUENCE += 1)}`;
   summary.classList.add("is-named");
   const toggle = doc.createElement("button"); toggle.type = "button";
   toggle.className = "semantropy-vocabulary-sources-toggle"; toggle.id = `${id}-toggle`;
   toggle.textContent = "▶";
   const panel = doc.createElement("div");
   panel.className = "semantropy-toolbar-popup semantropy-vocabulary-sources"; panel.id = id;
   panel.setAttribute("role", "group");
   const list = doc.createElement("ul"); list.className = "semantropy-vocabulary-sources-list";
   panel.append(list);
   // The list hangs from the whole status line (which may wrap onto several lines), not from the summary, so the summary's own
   // text stays the summary; only a host with tabs makes the status line a containing block.
   const line = summary.parentElement ?? summary;
   line.classList.add("has-vocabulary-names"); line.append(panel);
   this.named = { toggle, panel, list, key: "", listKey: "", nameEl: null, fullName: "" };
   // The list is built when it opens (before the Toolbar's own handler places it): a closed list is not seen, and the Vault's
   // listing it marks Sources against is not read on every sync.
   const build = () => this.renderList(this.input.state(), true);
   toggle.addEventListener("click", build); this.handlers.push(() => toggle.removeEventListener("click", build));
   input.names.adopt(toggle, panel, summary);
  }
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
  const drawText = selectionSourceWeights(state.selection) ? v.weightedDraw(draw) : draw;
  // WORKBENCH-UI4: with no note and no Selected Notes applied there is no Vocabulary to name (the Current Note is nothing).
  // WORKBENCH-UI5 (review 1, P3 6): a draft that is not applied is not one either, so choosing Selected Notes in the picker names nothing yet.
  if (this.named && state.applied && state.sources.length > 0) { this.renderNamed(state, drawText, notes.join(" · ")); return; }
  this.clearNamed();
  const text = !state.applied ? "" : v.summary(state.selection.mode === "current" ? v.currentNote : v.selectedNotesCount(state.selection.paths.length),
   drawText, notes.join(" · "));
  if (this.status.textContent !== text) this.status.textContent = text;
 }
 /**
  * The summary with the notes' names (owner, 2026-10-08): `Vocabulary: Current Note "a.md"`, `Selected Notes "a.md"` for one
  * and `▶ Selected Notes (3) "a.md" and others` for several, where ▶ lists every Source. Only the applied Vocabulary is named.
  * The pieces are rewritten only when they change, so a sync that changes nothing writes nothing and keeps focus on ▶.
  */
 private renderNamed(state: VocabularyControlsState, drawText: string, note: string): void {
  const named = this.named!;
  const n = ui().vocabulary.named;
  const sources = state.sources;
  const first = noteFileName(sources[0]!);
  const many = state.selection.mode === "selected" && sources.length > 1;
  const [before, after] = aroundName(state.selection.mode === "current" ? n.current(NAME_MARK) : many ? n.selectedMany(sources.length, NAME_MARK) : n.selectedOne(NAME_MARK));
  const key = JSON.stringify([n.head, before, after, many, first, n.tail(drawText, note)]);
  if (named.key !== key) {
   const doc = this.status.ownerDocument;
   const refocus = doc.activeElement === named.toggle;
   const part = (cls: string, text: string) => { const el = doc.createElement("span"); el.className = cls; el.textContent = text; return el; };
   // "Selected Notes (3) “" + name + "” and others": the name is its own element so a narrow pane can cut it.
   const nameEl = part("semantropy-vocabulary-name", first);
   const pieces: Node[] = [part("semantropy-vocabulary-head", n.head)];
   if (many) {
    named.toggle.setAttribute("aria-label", n.toggle(sources.length));
    pieces.push(named.toggle);
   }
   pieces.push(part("semantropy-vocabulary-mode", before), nameEl, part("semantropy-vocabulary-mode", after),
    part("semantropy-vocabulary-tail", n.tail(drawText, note)));
   this.status.replaceChildren(...pieces);
   named.nameEl = nameEl; named.fullName = first; named.key = key;
   if (!many) this.closeList();
   if (refocus && many) named.toggle.focus({ preventScroll: true });
   this.refit();
  }
  this.renderList(state, false);
 }
 private renderList(state: VocabularyControlsState, open: boolean): void {
  const named = this.named!;
  const v = ui().vocabulary;
  // A closed list is rebuilt when it opens.
  if (named.panel.hidden && !open) { named.listKey = ""; return; }
  const reasons = new Map(state.staleSources.map(issue => [issue.path, issue.reason]));
  const listing = state.listedPaths?.() ?? null;
  const listed = listing === null ? null : new Set(listing);
  const rows = state.sources.map(path => ({ path, mark: vocabularySourceMark(listed === null || listed.has(path), reasons.get(path)) }));
  const key = JSON.stringify([v.named.list, rows]);
  if (named.listKey === key) return;
  named.listKey = key;
  const doc = named.list.ownerDocument;
  named.panel.setAttribute("aria-label", v.named.list);
  named.list.replaceChildren(...rows.map(row => {
   const item = doc.createElement("li");
   const path = doc.createElement("span"); path.className = "semantropy-vocabulary-sources-path"; path.textContent = row.path;
   item.append(path);
   if (row.mark) {
    const issue = doc.createElement("span"); issue.className = "semantropy-vocabulary-sources-issue"; issue.textContent = row.mark;
    item.append(issue);
   }
   return item;
  }));
 }
 private closeList(): void {
  const named = this.named!;
  if (named.panel.hidden) return;
  named.panel.hidden = true;
  named.toggle.setAttribute("aria-expanded", "false");
 }
 /** Back to the plain summary line: nothing applied, or a host that does not name the notes. */
 private clearNamed(): void {
  const named = this.named;
  if (!named || (named.key === "" && named.listKey === "")) return;
  this.closeList();
  named.toggle.remove();
  named.key = ""; named.listKey = ""; named.nameEl = null; named.fullName = "";
  named.list.replaceChildren();
  this.status.replaceChildren();
 }
 /**
  * The name is cut with an ellipsis in a narrow pane (the stylesheet); the cut name carries its whole self as a
  * tooltip, and an uncut one carries none. It reads layout, so it runs on a resize, never on every sync.
  */
 refit(): void {
  const named = this.named;
  const el = named?.nameEl;
  if (!named || !el) return;
  const cut = el.scrollWidth > el.clientWidth;
  if (cut && el.title !== named.fullName) el.title = named.fullName;
  else if (!cut && el.hasAttribute("title")) el.removeAttribute("title");
 }
 /** LOCALE1: the entry's name follows the language; the Toolbar re-applies it with its own texts. */
 relabel(): void {
  const name = ui().toolbar.controls.vocabulary.name;
  const label = this.button.querySelector(".semantropy-action-label");
  if (label && label.textContent !== name) label.textContent = name;
  if (this.button.getAttribute("aria-label") !== name) this.button.setAttribute("aria-label", name);
  this.sync();
 }
 dispose(): void {
  for (const off of this.handlers) off(); this.handlers = [];
  this.status.remove();
  this.named?.panel.remove(); this.named?.toggle.remove();
  this.named = null;
 }
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
