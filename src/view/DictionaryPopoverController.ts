import type { DisplaySlot } from "../analysis/displaySlots";
import type { DictionaryModifier } from "../settings/displaySettings";
import { FakeDefinitionPresenter, type FakeDefinitionPresenterHost } from "./FakeDefinitionPresenter";
import { overlayBounds, placeOverlay } from "./overlayPlacement";
import { ui } from "../i18n/catalog";

export type DictionaryHoverTarget = {
 readonly slot: DisplaySlot;
 readonly anchor: HTMLElement;
 /** Captures View, body, revision, slot, Snapshot, level and lifecycle ownership. */
 readonly isCurrent: () => boolean;
};
export type DictionaryPopoverHost = FakeDefinitionPresenterHost & {
 modifier: () => DictionaryModifier;
 resolve: (element: Element) => DictionaryHoverTarget | null;
 canStart: () => boolean;
 begin: (target: DictionaryHoverTarget) => void;
 closed: () => void;
};

/** One View, one overlay, delegated events only; no global registry or token listeners. */
export class DictionaryPopoverController {
 private hovered: DictionaryHoverTarget | null = null;
 private active: DictionaryHoverTarget | null = null;
 private timer: number | null = null;
 private bridgeTimer: number | null = null;
 private modifierDown = false;
 private dragging = false;
 private composing = false;
 private pointerInView = false;
 private disposed = false;
 private keyboardOrigin: HTMLElement | null = null;
 private panel: HTMLElement | null = null;
 private presenter: FakeDefinitionPresenter | null = null;
 private off: (() => void)[] = [];
 constructor(private readonly scope: HTMLElement, private readonly body: HTMLElement,
  scroll: HTMLElement, private readonly host: DictionaryPopoverHost) {
  const doc = scope.ownerDocument;
  this.listen(body, "pointerover", event => this.point(event as PointerEvent));
  this.listen(body, "pointermove", event => this.point(event as PointerEvent));
  this.listen(body, "pointerout", event => {
   const related = (event as PointerEvent).relatedTarget;
   if (!(related instanceof Node) || !body.contains(related)) {
    this.hovered = null; this.cancelTimer();
    if (related instanceof Node && this.panel?.contains(related)) this.cancelBridge();
    else this.startBridge();
   }
  });
  this.listen(doc, "pointerover", event => {
   const node = event.target;
   this.pointerInView = node instanceof Node && (scope.contains(node) || !!this.panel?.contains(node));
   if (!this.pointerInView) { this.hovered = null; this.cancelTimer(); }
   if (node instanceof Node && this.panel?.contains(node)) this.cancelBridge();
   else if (node instanceof Node && !body.contains(node) &&
    !(node.nodeType === Node.ELEMENT_NODE && (node as Element).closest(".semantropy-root,.semantropy-dictionary-popover") && !scope.contains(node))) this.startBridge();
  });
  this.listen(doc, "pointerout", event => {
   const next = (event as PointerEvent).relatedTarget;
   if (event.target instanceof Node && this.panel?.contains(event.target) &&
    (!(next instanceof Node) || !this.panel.contains(next))) this.startBridge();
  });
  this.listen(doc, "pointerdown", event => {
   if (!(event.target instanceof Element)) return;
   if (body.contains(event.target)) { this.dragging = true; this.close(); }
   else if (!this.panel?.contains(event.target)) {
    this.hovered = null; this.cancelTimer();
    // Another View's interaction belongs to that View, including its Escape.
    if (!event.target.closest(".semantropy-root,.semantropy-dictionary-popover") || scope.contains(event.target)) this.close();
   }
  });
  this.listen(doc, "pointerup", () => { this.dragging = false; });
  this.listen(doc, "pointercancel", event => {
   this.dragging = false;
   if (event.target instanceof Node && scope.contains(event.target)) this.close();
  });
  this.listen(doc, "keydown", event => this.key(event as KeyboardEvent, true));
  this.listen(doc, "keyup", event => this.key(event as KeyboardEvent, false));
  this.listen(doc, "compositionstart", event => {
   this.composing = true; this.cancelTimer();
   if (event.target instanceof Node && (scope.contains(event.target) || this.panel?.contains(event.target))) this.close();
  });
  this.listen(doc, "compositionend", () => { this.composing = false; });
  this.listen(scroll, "scroll", () => this.close());
  const win = doc.defaultView;
  if (win) { this.listen(win, "blur", () => { this.modifierDown = false; this.close(); }); this.listen(win, "resize", () => this.close()); }
 }
 private listen(target: EventTarget, type: string, action: (event: Event) => void): void {
  target.addEventListener(type, action); this.off.push(() => target.removeEventListener(type, action));
 }
 private editable(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("input,textarea,select,button,[contenteditable=true]");
 }
 private point(event: PointerEvent): void {
  this.pointerInView = true;
  if (event.buttons || this.dragging || this.composing || this.editable(event.target)) { this.cancelTimer(); return; }
  this.modifierDown = this.host.modifier() === "alt" ? event.altKey : event.shiftKey;
  const next = event.target instanceof Element ? this.host.resolve(event.target) : null;
  if (this.active) {
   if (next?.slot === this.active.slot) this.cancelBridge();
   else if (next || (event.target instanceof Element && event.target.closest(".semantropy-token,a,code,pre,rt,rp"))) this.close();
   else { this.hovered = null; this.cancelTimer(); this.startBridge(); return; }
  }
  if (this.hovered?.slot !== next?.slot || this.hovered?.anchor !== next?.anchor) { this.cancelTimer(); this.hovered = next; }
  this.schedule();
 }
 private key(event: KeyboardEvent, down: boolean): void {
  // The event path survives the first View tearing its panel down before the
  // next View's document listener runs; live ancestors would lose ownership.
  const focusedPanel = event.composedPath().find(part => part instanceof Element && part.classList.contains("semantropy-dictionary-popover"));
  // A focused dialog owns Escape before pointer hover does; otherwise an
  // external editor may keep focus while the pointer's View owns the popup.
  if (down && event.key === "Escape" && (focusedPanel ? focusedPanel === this.panel : this.pointerInView)) {
   if (this.panel) { event.preventDefault(); event.stopPropagation(); }
   this.close(true); return;
  }
  const key = this.host.modifier() === "alt" ? "Alt" : "Shift";
  if (event.key !== key) return;
  if (!down) { this.modifierDown = false; this.cancelTimer(); return; }
  // Hover deliberately leaves focus alone. The pointer's View, not the focused
  // editor/input/button, owns this modifier request. Never consume the key.
  if (!this.pointerInView || !this.hovered) return;
  this.modifierDown = true;
  if (!event.repeat && !event.isComposing) this.schedule();
 }
 private schedule(): void {
  if (this.disposed || this.timer !== null || this.active || !this.hovered || !this.pointerInView || !this.modifierDown ||
   this.dragging || this.composing || !this.host.canStart()) return;
  const selection = this.scope.ownerDocument.getSelection();
  if (selection && !selection.isCollapsed) return;
  const target = this.hovered;
  this.timer = this.scope.ownerDocument.defaultView!.setTimeout(() => {
   this.timer = null;
   if (this.hovered === target && this.pointerInView && this.modifierDown && !this.dragging && !this.composing && this.host.canStart() && target.isCurrent()) this.open(target);
  }, 125);
 }
 /** Optional keyboard entry accepts an already identified target and a real origin. */
 open(target: DictionaryHoverTarget, keyboardOrigin?: HTMLElement): void {
  if (this.disposed || !target.isCurrent() || !this.host.canStart()) return;
  this.close();
  this.active = target; this.keyboardOrigin = keyboardOrigin ?? null;
  const panel = this.scope.ownerDocument.body.createDiv();
  panel.className = "semantropy-dictionary-popover";
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", ui().dictionary.popoverTitle);
  const title = panel.createDiv(); title.textContent = ui().dictionary.popoverTitle; title.className = "semantropy-definition-title";
  panel.appendChild(title);
  const content = panel.createDiv();
  this.scope.ownerDocument.body.appendChild(panel); this.panel = panel;
  this.presenter = new FakeDefinitionPresenter(content, this.host);
  this.host.begin(target); this.sync();
  if (keyboardOrigin) (panel.querySelector<HTMLElement>("select:not(:disabled),button:not(:disabled)") ?? panel).focus();
 }
 isOpen(): boolean { return this.panel !== null; }
 /** LOCALE1: re-words the open Popover in place; its target, focus and definition stay. */
 relabel(): void {
  if (!this.panel || !this.active) return;
  const title = ui().dictionary.popoverTitle;
  this.panel.setAttribute("aria-label", title);
  const heading = this.panel.querySelector(".semantropy-definition-title");
  if (heading && heading.textContent !== title) heading.textContent = title;
  this.presenter?.relabel(); this.position();
 }
 getTarget(): DictionaryHoverTarget | null { return this.active; }
 validate(): void { if ((this.active && !this.active.isCurrent()) || (this.hovered && !this.hovered.isCurrent())) this.close(); }
 sync(): void {
  this.validate();
  if (!this.panel || !this.active) return;
  const keyboardPending = this.keyboardOrigin && this.scope.ownerDocument.activeElement === this.panel;
  this.presenter?.sync(); this.position();
  if (keyboardPending) this.panel.querySelector<HTMLElement>("select:not(:disabled),button:not(:disabled)")?.focus();
 }
 private position(): void {
  if (!this.panel || !this.active) return;
  // Horizontally inside this View's pane and the window; vertically inside the window.
  const viewport = overlayBounds(this.scope.ownerDocument.defaultView!, null), pane = this.scope.getBoundingClientRect();
  const bounds = { ...viewport, left: Math.max(viewport.left, pane.left), right: Math.min(viewport.right, pane.right || viewport.right) };
  this.panel.style.maxWidth = `${Math.max(0, bounds.right - bounds.left)}px`;
  this.panel.style.maxHeight = `${Math.max(0, bounds.bottom - bounds.top)}px`;
  const rect = this.panel.getBoundingClientRect(), anchor = this.active.anchor.getBoundingClientRect();
  const place = placeOverlay({ below: anchor, above: anchor, width: rect.width, height: rect.height, bounds });
  // Too tall for either side: shorter, scrolling inside, rather than over the word.
  this.panel.style.maxHeight = `${place.maxHeight}px`;
  this.panel.style.left = `${place.left}px`;
  this.panel.style.top = `${place.top}px`;
 }
 private cancelTimer(): void {
  if (this.timer !== null) this.scope.ownerDocument.defaultView!.clearTimeout(this.timer);
  this.timer = null;
 }
 private startBridge(): void {
  if (!this.active || this.bridgeTimer !== null || this.disposed) return;
  // One bounded grace period across the 4px positioning gap. Movement in the
  // intervening text does not extend it; entering the panel or origin cancels it.
  this.bridgeTimer = this.scope.ownerDocument.defaultView!.setTimeout(() => {
   this.bridgeTimer = null; this.close();
  }, 200);
 }
 private cancelBridge(): void {
  if (this.bridgeTimer !== null) this.scope.ownerDocument.defaultView!.clearTimeout(this.bridgeTimer);
  this.bridgeTimer = null;
 }
 close(restoreFocus = false): void {
  this.cancelTimer(); this.cancelBridge(); this.hovered = null;
  const wasOpen = !!this.panel, origin = this.keyboardOrigin;
  this.active = null; this.keyboardOrigin = null;
  this.presenter?.dispose(); this.presenter = null; this.panel?.remove(); this.panel = null;
  if (wasOpen) this.host.closed();
  if (restoreFocus && origin?.isConnected && this.scope.contains(origin)) origin.focus({ preventScroll: true });
 }
 dispose(): void { this.disposed = true; this.close(); for (const off of this.off) off(); this.off = []; }
}
