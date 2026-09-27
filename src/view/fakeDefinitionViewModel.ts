import type { HeadwordIdentity } from "../dictionary/headword";
import {
	DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE,
	DEFINE_LOADING_MESSAGE,
	DEFINE_OFF_MESSAGE,
} from "../application/fakeDictionaryMessages";
import type {
	FakeDictionaryCurrent,
} from "../application/fakeDictionaryWorld";
import {
	dictionarySemantropyChoices,
	type DictionarySemantropy,
} from "../settings/dictionarySemantropy";

export type FakeDefinitionStatus =
	| "loading"
	| "off"
	| "ready"
	| "insufficient"
	| "error";

export type DictionaryLevelChoice = {
	value: DictionarySemantropy;
	label: string;
};

export type FakeDefinitionViewModel = {
	status: FakeDefinitionStatus;
	headword: string | null;
	reading: string | null;
	posLabel: string | null;
	dictionarySemantropy: DictionarySemantropy;
	levelChoices: readonly DictionaryLevelChoice[];
	definition: string | null;
	message: string | null;
	reshuffleEnabled: boolean;
	copyEnabled: boolean;
	collectEnabled: boolean;
	levelControlEnabled: boolean;
};

export function headwordPosLabel(identity: HeadwordIdentity): string {
	const parts = [identity.pos, identity.detail1];
	if (identity.detail2 !== "" && identity.detail2 !== "*") {
		parts.push(identity.detail2);
	}
	return parts.join(" · ");
}

export function toFakeDefinitionViewModel(input: {
	current: FakeDictionaryCurrent | null;
	dictionarySemantropy: DictionarySemantropy;
	pendingRequestId: number | null;
	isPendingCurrent: boolean;
	errorMessage: string | null;
	busy: boolean;
	levelError: string | null;
}): FakeDefinitionViewModel {
	const displayedSemantropy =
		input.current?.dictionarySemantropy ?? input.dictionarySemantropy;
	const levelChoices = dictionarySemantropyChoices(displayedSemantropy);
	const generated =
		input.current?.result.outcome === "generated"
			? input.current.result
			: null;
	const actionsEnabled = generated !== null && !input.busy;

	if (input.isPendingCurrent && input.errorMessage !== null) {
		return overlayLevelError(
			{
				status: "error",
				headword: null,
				reading: null,
				posLabel: null,
				dictionarySemantropy: displayedSemantropy,
				levelChoices,
				definition: null,
				message: input.errorMessage,
				reshuffleEnabled: false,
				copyEnabled: false,
				collectEnabled: false,
				levelControlEnabled: false,
			},
			null,
		);
	}

	const waitingOnPending =
		input.isPendingCurrent &&
		input.pendingRequestId !== null &&
		input.current?.requestId !== input.pendingRequestId;

	if (waitingOnPending) {
		return overlayLevelError(
			{
				status: "loading",
				headword: null,
				reading: null,
				posLabel: null,
				dictionarySemantropy: displayedSemantropy,
				levelChoices,
				definition: null,
				message: DEFINE_LOADING_MESSAGE,
				reshuffleEnabled: false,
				copyEnabled: false,
				collectEnabled: false,
				levelControlEnabled: false,
			},
			null,
		);
	}

	if (input.current?.result.outcome === "off") {
		return overlayLevelError(
			{
				status: "off",
				headword: input.current.headword.surface,
				reading: input.current.headword.identity.reading,
				posLabel: headwordPosLabel(input.current.headword.identity),
				dictionarySemantropy: input.current.dictionarySemantropy,
				levelChoices: dictionarySemantropyChoices(
					input.current.dictionarySemantropy,
				),
				definition: null,
				message: DEFINE_OFF_MESSAGE,
				reshuffleEnabled: false,
				copyEnabled: false,
				collectEnabled: false,
				levelControlEnabled: !input.busy,
			},
			input.levelError,
		);
	}

	if (input.current?.result.outcome === "insufficient-vocabulary") {
		return overlayLevelError(
			{
				status: "insufficient",
				headword: input.current.headword.surface,
				reading: input.current.headword.identity.reading,
				posLabel: headwordPosLabel(input.current.headword.identity),
				dictionarySemantropy: input.current.dictionarySemantropy,
				levelChoices: dictionarySemantropyChoices(
					input.current.dictionarySemantropy,
				),
				definition: null,
				message: DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE,
				reshuffleEnabled: false,
				copyEnabled: false,
				collectEnabled: false,
				levelControlEnabled: !input.busy,
			},
			input.levelError,
		);
	}

	if (generated && input.current) {
		return overlayLevelError(
			{
				status: "ready",
				headword: input.current.headword.surface,
				reading: input.current.headword.identity.reading,
				posLabel: headwordPosLabel(input.current.headword.identity),
				dictionarySemantropy: input.current.dictionarySemantropy,
				levelChoices: dictionarySemantropyChoices(
					input.current.dictionarySemantropy,
				),
				definition: generated.definition,
				message: null,
				reshuffleEnabled: actionsEnabled,
				copyEnabled: actionsEnabled,
				collectEnabled: actionsEnabled,
				levelControlEnabled: !input.busy,
			},
			input.levelError,
		);
	}

	return overlayLevelError(
		{
			status: "loading",
			headword: null,
			reading: null,
			posLabel: null,
			dictionarySemantropy: displayedSemantropy,
			levelChoices,
			definition: null,
			message: DEFINE_LOADING_MESSAGE,
			reshuffleEnabled: false,
			copyEnabled: false,
			collectEnabled: false,
			levelControlEnabled: false,
		},
		null,
	);
}

function overlayLevelError(
	model: FakeDefinitionViewModel,
	levelError: string | null,
): FakeDefinitionViewModel {
	if (levelError === null || model.status === "loading") {
		return model;
	}
	return { ...model, message: levelError };
}
