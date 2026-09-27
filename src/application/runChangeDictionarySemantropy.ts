import {
	generateFakeDefinition,
	type FakeDefinitionResult,
} from "../dictionary/generateFakeDefinition";
import type { DictionarySemantropy } from "../settings/dictionarySemantropy";
import type { BusyGuard } from "./refreshSource";
import type { DefineGenerate } from "./defineSelectedWord";
import {
	sameDictionarySnapshotIdentity,
	type FakeDictionaryWorld,
} from "./fakeDictionaryWorld";

export type DictionaryLevelChangeOutcome =
	| "applied"
	| "unchanged"
	| "busy"
	| "unavailable"
	| "aborted"
	| "failed";

export type ChangeDictionarySemantropyInput = {
	world: FakeDictionaryWorld;
	next: DictionarySemantropy;
	persist: (value: DictionarySemantropy) => Promise<boolean>;
	isAbandoned: () => boolean;
	modalOpen: boolean;
	generate?: DefineGenerate;
 prepareDisplay?: () => Promise<{ commit: (accept?: (publishDom: () => void) => boolean) => "applied" | "stale" } | null>;
};

/**
 * Prepares the next Fake Definition at a new Dictionary Semantropy value,
 * persists that value, then commits the display only if this request is still
 * current.
 *
 * The headword, pool and dictionary Seed stay the same. The body is not
 * reread, re-tokenized or rewritten. A failed persist leaves the displayed
 * value and the generated result untouched.
 */
export async function runChangeDictionarySemantropy(
	input: ChangeDictionarySemantropyInput,
): Promise<DictionaryLevelChangeOutcome> {
	if (input.isAbandoned()) {
		return "aborted";
	}
	if (!input.modalOpen) {
		return "unavailable";
	}

	const current = input.world.getCurrent();
	if (!current) {
		return "unavailable";
	}
	if (current.dictionarySemantropy === input.next) {
		return "unchanged";
	}

	const requestId = input.world.beginRequest();
	const snapshot = current.snapshot;
	const dictionarySeed = current.dictionarySeed;

	let prepared: FakeDefinitionResult;
	try {
		const generate = input.generate ?? generateFakeDefinition;
		prepared = generate({
			headword: current.headword,
			pool: current.pool,
			dictionarySeed,
			dictionarySemantropy: input.next,
		});
	} catch {
		return "failed";
	}

 let display;
 try { display = await input.prepareDisplay?.(); } catch { return "failed"; }
 if (input.prepareDisplay && !display) return input.isAbandoned() ? "aborted" : "failed";
 if (input.isAbandoned()) return "aborted";
	try { if (!(await input.persist(input.next))) return "failed"; }
 catch { return "failed"; }

	if (
		input.isAbandoned() ||
		!input.modalOpen ||
		!input.world.isCurrent(requestId)
	) {
		return "aborted";
	}

	const displayed = input.world.getCurrent();
	if (
		displayed === null ||
		displayed.dictionarySeed !== dictionarySeed ||
		!sameDictionarySnapshotIdentity(displayed.snapshot, snapshot) ||
		displayed.headword.identity.baseForm !== current.headword.identity.baseForm
	) {
		return "aborted";
	}

	const commit = (publishDom?: () => void) => input.world.commit(requestId, {
		headword: current.headword,
		pool: current.pool,
		snapshot,
		vocabulary: current.vocabulary,
		dictionarySeed,
		dictionarySemantropy: input.next,
		result: prepared,
	}, publishDom);
 let committed = false;
 try { committed = display ? display.commit(commit) === "applied" : commit(); } catch { return "failed"; }
	return committed ? "applied" : "aborted";
}

export async function runChangeDictionarySemantropyGuarded(
	input: ChangeDictionarySemantropyInput & { busy: BusyGuard },
): Promise<DictionaryLevelChangeOutcome> {
	const token = input.busy.acquire();
	if (token === null) {
		return "busy";
	}
	try {
		return await runChangeDictionarySemantropy(input);
	} finally {
		input.busy.release(token);
	}
}
