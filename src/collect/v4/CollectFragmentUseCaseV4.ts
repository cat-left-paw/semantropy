import { issueFragmentIdentity, type FragmentClock, type FragmentIdSource } from "../fragmentIdentity";
import type { AppendFragmentResult } from "../FragmentRepository";
import { buildCollectedFragmentV4, readCollectFragmentInputV4, type FragmentValidationReasonV4 } from "./CollectedFragmentV4";
import type { FragmentRepositoryV4 } from "./FragmentRepositoryV4";

export type CollectFragmentResultV4 = AppendFragmentResult | { status: "invalid"; reason: FragmentValidationReasonV4 };
export type CollectFragmentDependenciesV4 = { repository: FragmentRepositoryV4; newId: FragmentIdSource; now: FragmentClock };

/**
 * PRE-RELEASE-FAKE-PROVERB-COLLECT1 application seam. Production-disconnected.
 * The input is captured and validated before an identity is issued; a refused
 * input issues nothing and reaches no repository. Validation is structural,
 * not proof that a result is genuine or committed: the View adapter supplies
 * its committed capture (for Fake Proverb, a BATCH1 `readFakeProverbRow()` record).
 */
export async function collectFragmentV4(input: unknown, dependencies: CollectFragmentDependenciesV4): Promise<CollectFragmentResultV4> {
	const captured = readCollectFragmentInputV4(input);
	if (!captured.ok) return { status: "invalid", reason: captured.reason };
	try {
		const identity = issueFragmentIdentity(dependencies.newId, dependencies.now);
		return await dependencies.repository.append(buildCollectedFragmentV4(captured.value, identity));
	} catch {
		return { status: "failed" };
	}
}
