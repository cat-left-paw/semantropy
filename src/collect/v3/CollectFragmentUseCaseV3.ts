import { issueFragmentIdentity, type FragmentClock, type FragmentIdSource } from "../fragmentIdentity";
import type { AppendFragmentResult } from "../FragmentRepository";
import { buildCollectedFragmentV3, readCollectFragmentInputV3, type FragmentValidationReasonV3 } from "./CollectedFragmentV3";
import type { FragmentRepositoryV3 } from "./FragmentRepositoryV3";

export type CollectFragmentResultV3 = AppendFragmentResult | { status: "invalid"; reason: FragmentValidationReasonV3 };
export type CollectFragmentDependenciesV3 = { repository: FragmentRepositoryV3; newId: FragmentIdSource; now: FragmentClock };

/** Pure application seam. The trusted View adapter supplies its committed capture.
 * Validation is structural, not proof of an Automatic result's ownership or lifetime.
 */
export async function collectFragmentV3(input: unknown, dependencies: CollectFragmentDependenciesV3): Promise<CollectFragmentResultV3> {
	const captured = readCollectFragmentInputV3(input);
	if (!captured.ok) return { status: "invalid", reason: captured.reason };
	try {
		const identity = issueFragmentIdentity(dependencies.newId, dependencies.now);
		return await dependencies.repository.append(buildCollectedFragmentV3(captured.value, identity));
	} catch { return { status: "failed" }; }
}
