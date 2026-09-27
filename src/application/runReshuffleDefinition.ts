import { assertUint32Seed } from "../random/seededRandom";
import {
	generateFakeDefinition,
	type FakeDefinitionResult,
} from "../dictionary/generateFakeDefinition";
import type { DefineGenerate } from "./defineSelectedWord";
import type { FakeDictionaryWorld } from "./fakeDictionaryWorld";

export type ReshuffleDefinitionOutcome =
	| "applied"
	| "busy"
	| "unavailable"
	| "aborted"
	| "failed";

export type RunReshuffleDefinitionInput = {
	world: FakeDictionaryWorld;
	modalOpen: boolean;
	issueSeed: () => number;
	isAbandoned: () => boolean;
	generate?: DefineGenerate;
};

/**
 * Issues one new dictionary Seed and redraws the current definition.
 *
 * It reuses the saved headword, the snapshot-derived pool and the stored
 * Dictionary Semantropy value. It does not tokenize, does not touch the body
 * Seed, the body DOM, the source snapshot or `data.json`, and it issues the
 * new Seed once — even if the draw returns the same uint32.
 */
export function runReshuffleDefinition(
	input: RunReshuffleDefinitionInput,
): ReshuffleDefinitionOutcome {
	if (input.isAbandoned()) {
		return "aborted";
	}
	if (!input.modalOpen) {
		return "unavailable";
	}

	const current = input.world.getCurrent();
	if (!current || current.result.outcome !== "generated") {
		return "unavailable";
	}

	const requestId = input.world.beginRequest();

	let nextSeed: number;
	try {
		nextSeed = assertUint32Seed(input.issueSeed());
	} catch {
		return "failed";
	}

	let result: FakeDefinitionResult;
	try {
		const generate = input.generate ?? generateFakeDefinition;
		result = generate({
			headword: current.headword,
			pool: current.pool,
			dictionarySeed: nextSeed,
			dictionarySemantropy: current.dictionarySemantropy,
		});
	} catch {
		return "failed";
	}

	if (
		input.isAbandoned() ||
		!input.modalOpen ||
		!input.world.isCurrent(requestId)
	) {
		return "aborted";
	}

	if (result.outcome !== "generated") {
		return "failed";
	}

	input.world.adoptSeed(nextSeed);
	const committed = input.world.commit(requestId, {
		headword: current.headword,
		pool: current.pool,
		snapshot: current.snapshot,
		vocabulary: current.vocabulary,
		dictionarySeed: nextSeed,
		dictionarySemantropy: current.dictionarySemantropy,
		result,
	});
	return committed ? "applied" : "aborted";
}
