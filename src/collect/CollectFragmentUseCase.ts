import {
	buildCollectedFragment,
	validateFragmentInput,
	type CollectFragmentInput,
	type FragmentValidationReason,
} from "./CollectedFragment";
import {
	issueFragmentIdentity,
	type FragmentClock,
	type FragmentIdSource,
} from "./fragmentIdentity";
import type {
	CollectionPathConflict,
	FragmentRepository,
} from "./FragmentRepository";

export type CollectFragmentResult =
	| { status: "created" }
	| { status: "appended" }
	| { status: "invalid"; reason: FragmentValidationReason }
	| { status: "conflict"; reason: CollectionPathConflict }
	| { status: "invalid-path" }
	| { status: "failed" };

export type CollectFragmentDependencies = {
	repository: FragmentRepository;
	newId: FragmentIdSource;
	now: FragmentClock;
};

/**
 * Saves one fragment the user explicitly chose.
 *
 * The whole of its work is: check the input, issue one identity, build one
 * entry, ask the repository to append it once, and report what happened.
 *
 * It reads no selection, detects no sentences, touches no clipboard, shows no
 * notice, prints nothing, and never opens the source note — not to read it and
 * certainly not to write it. One call produces at most one entry, and a
 * repository failure is reported rather than retried, because a retry could
 * store a second copy of an entry the first attempt may already have written.
 */
export async function collectFragment(
	input: CollectFragmentInput,
	dependencies: CollectFragmentDependencies,
): Promise<CollectFragmentResult> {
	const reason = validateFragmentInput(input);
	if (reason) {
		return { status: "invalid", reason };
	}

	try {
		// Issued only once a valid input is in hand, so a rejected Collect never
		// consumes an identity.
		const identity = issueFragmentIdentity(
			dependencies.newId,
			dependencies.now,
		);
		return await dependencies.repository.append(
			buildCollectedFragment(input, identity),
		);
	} catch {
		return { status: "failed" };
	}
}
