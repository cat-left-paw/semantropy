import {
	invokeSemantropyViewCommand,
	selectSemantropyView,
	type ViewCommandResult,
} from "./selectSemantropyView";

export function selectReshuffleView<T>(input: {
	activeView: T | null | undefined;
	existingViews: readonly T[];
}): T | null {
	return selectSemantropyView(input);
}

export function invokeReshuffleCommand<T, TOutcome>(input: {
	activeView: T | null | undefined;
	existingViews: readonly T[];
	reshuffle: (view: T) => TOutcome;
}): ViewCommandResult<TOutcome> {
	return invokeSemantropyViewCommand({
		activeView: input.activeView,
		existingViews: input.existingViews,
		run: input.reshuffle,
	});
}
