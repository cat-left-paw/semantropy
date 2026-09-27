import { isCollectionPath } from "../settings/collectionPath";
import type { BusyGuard } from "./refreshSource";

export type SaveCollectionPathOutcome =
	| "saved"
	| "invalid"
	| "busy"
	| "failed"
	| "aborted";

export type SaveCollectionPathInput = {
	/** The typed path, captured before this function runs. Never rewritten. */
	draft: string;
	persist: (value: string) => Promise<boolean>;
	isAbandoned: () => boolean;
};

/**
 * Saves one Collection Markdown path the user explicitly confirmed.
 *
 * Validation happens before any persist. An invalid draft is refused as typed:
 * it is not trimmed, normalized, or given an extension. The body Semantropy
 * value, the dictionary Semantropy value and both Seeds are out of scope.
 */
export async function runSaveCollectionPath(
	input: SaveCollectionPathInput,
): Promise<SaveCollectionPathOutcome> {
	if (input.isAbandoned()) {
		return "aborted";
	}
	if (!isCollectionPath(input.draft)) {
		return "invalid";
	}

	let persisted: boolean;
	try {
		persisted = await input.persist(input.draft);
	} catch {
		return input.isAbandoned() ? "aborted" : "failed";
	}

	if (input.isAbandoned()) {
		return "aborted";
	}
	return persisted ? "saved" : "failed";
}

/**
 * Serializes an explicit Save. Invalid drafts never take the gate, so a
 * mistyped path cannot block a later valid one. A second click while a write
 * is in flight is refused rather than queued.
 */
export async function runSaveCollectionPathGuarded(
	input: SaveCollectionPathInput & { busy: BusyGuard },
): Promise<SaveCollectionPathOutcome> {
	if (input.isAbandoned()) {
		return "aborted";
	}
	if (!isCollectionPath(input.draft)) {
		return "invalid";
	}
	const token = input.busy.acquire();
	if (token === null) {
		return "busy";
	}
	try {
		return await runSaveCollectionPath(input);
	} finally {
		input.busy.release(token);
	}
}
