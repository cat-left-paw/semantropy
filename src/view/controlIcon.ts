import { setIcon, type IconName } from "obsidian";

/**
 * PRE-RELEASE-EXPERIENCE-CONTROLS1: an icon beside a control's short label.
 *
 * The glyph comes from Obsidian's own bundled icon set through `setIcon()` —
 * no image asset, no download. It sits in its own `aria-hidden` span, because
 * `setIcon()` replaces a parent's first non-icon child; the label keeps its own
 * span, so the control's text is unchanged. The accessible name stays on the
 * control's `aria-label` (and so does Obsidian's single tooltip); nothing here
 * adds a `title`.
 */
export function iconLabel(control: HTMLElement, icon: IconName, label: string): void {
	control.empty();
	const glyph = control.createSpan({ cls: "semantropy-icon", attr: { "aria-hidden": "true" } });
	setIcon(glyph, icon);
	control.createSpan({ cls: "semantropy-action-label", text: label });
	control.classList.add("has-icon");
}
