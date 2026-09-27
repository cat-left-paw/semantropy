import {
	COLLECTION_PATH_INVALID_MESSAGE,
	COLLECTION_PATH_SAVE_FAILED_MESSAGE,
	COLLECTION_PATH_SAVED_MESSAGE,
} from "../application/collectionPathMessages";

export type CollectionPathSettingsStatus =
	| "idle"
	| "invalid"
	| "saved"
	| "failed";

export type CollectionPathSettingsViewModel = {
	draft: string;
	effective: string;
	message: string | null;
	saveEnabled: boolean;
};

/**
 * The Collection path row: the typed draft, the last saved value, and whether
 * Save is free. Messages are the fixed strings; the draft is never interpolated
 * into them.
 */
export function toCollectionPathSettingsViewModel(input: {
	draft: string;
	effective: string;
	busy: boolean;
	status: CollectionPathSettingsStatus;
}): CollectionPathSettingsViewModel {
	const status =
		input.status === "saved" && input.draft !== input.effective
			? "idle"
			: input.status;
	return {
		draft: input.draft,
		effective: input.effective,
		message: statusMessage(status),
		saveEnabled: !input.busy,
	};
}

function statusMessage(status: CollectionPathSettingsStatus): string | null {
	switch (status) {
		case "invalid":
			return COLLECTION_PATH_INVALID_MESSAGE;
		case "saved":
			return COLLECTION_PATH_SAVED_MESSAGE;
		case "failed":
			return COLLECTION_PATH_SAVE_FAILED_MESSAGE;
		case "idle":
			return null;
	}
}
