/**
 * A change observed somewhere in the Vault, reduced to the two things a
 * Semantropy view cares about. Obsidian's `Editor`, `TFile` and workspace
 * objects stay on the plugin side of this boundary.
 */
export type SourceEvent =
	| {
			kind: "changed";
			sourcePath: string;
			/**
			 * Editor text captured synchronously with the event, when the event
			 * carried one. `null` means "look it up" — not "the note is empty".
			 */
			editorText: string | null;
	  }
	| {
			/** Renamed away, deleted, or no longer resolvable at this path. */
			kind: "lost";
			sourcePath: string;
	  };

export type DispatchSourceEventInput<TView> = {
	event: SourceEvent;
	/** Every Semantropy view, including ones on inactive leaves. */
	views: readonly TView[];
	/** The path this view's ready snapshot came from, or null. */
	getSourcePath: (view: TView) => string | null;
	recheck: (view: TView, editorText: string | null) => void;
	markLost: (view: TView) => void;
};

/**
 * Notifies only the views whose ready snapshot came from the changed path.
 * A change to another note reaches nobody, and an inactive leaf is notified
 * exactly like the focused one.
 */
export function dispatchSourceEvent<TView>(
	input: DispatchSourceEventInput<TView>,
): TView[] {
	const targets = input.views.filter(
		(view) => input.getSourcePath(view) === input.event.sourcePath,
	);
	for (const view of targets) {
		if (input.event.kind === "lost") {
			input.markLost(view);
			continue;
		}
		input.recheck(view, input.event.editorText);
	}
	return targets;
}
