/**
 * Obsidian shows a tooltip for any control named by `aria-label`, and the
 * shared View relies on that for its icon-only buttons (it deliberately sets no
 * `title`). The web page has no such host behaviour, so this draws the same
 * kind of tooltip: after a short hover with a mouse, for a button whose visible
 * text does not already say its name. Touch input never shows it.
 */
const DELAY_MS = 450;

export function installTooltips(doc: Document): () => void {
	const tip = doc.createElement("div");
	tip.className = "sw-tooltip";
	tip.setAttribute("role", "presentation");
	tip.hidden = true;
	doc.body.appendChild(tip);
	let timer: number | null = null;
	let target: HTMLElement | null = null;

	const hide = (): void => {
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
		target = null;
		tip.hidden = true;
	};
	const show = (el: HTMLElement): void => {
		const name = el.getAttribute("aria-label");
		if (!name || !el.isConnected) return;
		tip.textContent = name;
		tip.hidden = false;
		const rect = el.getBoundingClientRect();
		const width = tip.offsetWidth;
		const height = tip.offsetHeight;
		const left = Math.min(Math.max(4, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 4);
		const below = rect.bottom + 6;
		const top = below + height > window.innerHeight - 4 ? rect.top - height - 6 : below;
		tip.style.setProperty("left", `${Math.round(left)}px`);
		tip.style.setProperty("top", `${Math.round(top)}px`);
	};
	const over = (event: PointerEvent): void => {
		if (event.pointerType !== "mouse") return;
		const el = event.target instanceof Element ? event.target.closest<HTMLElement>("button[aria-label], [role='button'][aria-label]") : null;
		if (el === target) return;
		hide();
		if (!el) return;
		const name = el.getAttribute("aria-label") ?? "";
		// A button that already shows its name needs no tooltip.
		if ((el.innerText ?? "").trim() === name.trim()) return;
		target = el;
		timer = window.setTimeout(() => show(el), DELAY_MS);
	};
	doc.addEventListener("pointerover", over);
	doc.addEventListener("pointerdown", hide, true);
	doc.addEventListener("keydown", hide, true);
	doc.addEventListener("scroll", hide, true);
	return () => {
		hide();
		doc.removeEventListener("pointerover", over);
		doc.removeEventListener("pointerdown", hide, true);
		doc.removeEventListener("keydown", hide, true);
		doc.removeEventListener("scroll", hide, true);
		tip.remove();
	};
}
