/**
 * Picks the Semantropy view a command should act on: the active one, else the
 * first existing one. It never creates a view and never falls back to the
 * active Markdown note.
 */
export function selectSemantropyView<TView>(input: {
	activeView: TView | null | undefined;
	existingViews: readonly TView[];
}): TView | null {
	if (input.activeView) {
		return input.activeView;
	}
	return input.existingViews[0] ?? null;
}

export type ViewCommandResult<TOutcome> =
	| { status: "missing" }
	| { status: "ran"; outcome: TOutcome };

/**
 * Runs one command against the selected view. `run` is the view method the
 * button also calls, so both entry points share a single implementation.
 */
export function invokeSemantropyViewCommand<TView, TOutcome>(input: {
	activeView: TView | null | undefined;
	existingViews: readonly TView[];
	run: (view: TView) => TOutcome;
}): ViewCommandResult<TOutcome> {
	const view = selectSemantropyView(input);
	if (!view) {
		return { status: "missing" };
	}
	return { status: "ran", outcome: input.run(view) };
}
