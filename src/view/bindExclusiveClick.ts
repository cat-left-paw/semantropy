/**
 * Replaces any previous binding before adding a new one, so a re-render never
 * leaves two handlers on the same control.
 */
export function bindExclusiveListener(
	previousUnbind: (() => void) | null,
	element: HTMLElement,
	type: string,
	handler: () => void,
): () => void {
	previousUnbind?.();
	element.addEventListener(type, handler);
	return () => {
		element.removeEventListener(type, handler);
	};
}

export function bindExclusiveClick(
	previousUnbind: (() => void) | null,
	element: HTMLElement,
	handler: () => void,
): () => void {
	return bindExclusiveListener(previousUnbind, element, "click", handler);
}
