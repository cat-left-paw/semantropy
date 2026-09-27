/**
 * PRE-RELEASE-FAKE-PROVERB-BATCH1: Fake Proverb's in-memory batch owner.
 * Production-disconnected.
 *
 * No I/O, clock, entropy source, scheduler, DOM, Clipboard, Vault or network:
 * the caller drives begin -> prepare -> complete and lifecycle events, and
 * supplies fresh private material. Everything published is deeply frozen;
 * tickets and completions are owner-local capabilities, never serializable
 * state, and retaining an old `read()` value cannot roll this owner back.
 *
 * Identity is three separate things:
 *
 *   - `rowSlotId`: ten stable display positions, minted once per owner and
 *     unchanged by every Generate;
 *   - `batchId`: one per successfully committed batch;
 *   - `rowId`: one per committed result, the immutable identity of that
 *     proverb + gloss in that position.
 *
 * A Generate always asks CORE1 for exactly ten drafts. One to nine drafts
 * commit together as a `partial` batch with CORE1's fixed shortfall reason,
 * ten as `complete`. Zero drafts, a refused input, a CORE1 refusal, a cancel,
 * a superseded or stale ticket, or any failure while building the replacement
 * leaves the previously committed batch exactly as it was.
 *
 * The CORE1 authority is minted once per (Vocabulary owner, recipe set) and
 * reused by later Generates, so the Snapshot is derived once per owner rather
 * than once per Generate; CORE1 still checks origin, owner liveness and binding
 * on every generation.
 *
 * A Vocabulary owner may be held by more than one controller. Revoking it —
 * `sourceChanged()`, `close()` or `dispose()` on any holder — is owner-wide
 * (CORE1's registry), and `complete()` re-checks liveness immediately before
 * commit, so a draft prepared before another holder revoked the owner is
 * refused (`stale` / `released`) and the previous batch is kept.
 */

import { freezeAnalysis } from "../analysis/rubyVocabulary";
import { isManualMorphVocabulary, type ManualMorphVocabulary } from "../transform/manualMorphology";
import { sha256Hex } from "../vocabulary/sha256";
import type { CompiledFakeProverbRecipeSet } from "./compileRecipeSet";
import {
	checkFakeProverbAuthorityLive,
	createFakeProverbAuthority,
	exactFields,
	releaseFakeProverbOwner,
	type FakeProverbAuthority,
	type FakeProverbProvenance,
	type FakeProverbReason,
} from "./fakeProverbAuthority";
import {
	FAKE_PROVERB_MAX_COUNT,
	fakeProverbCanonicalText,
	generateFakeProverbs,
	type FakeProverbDraft,
	type FakeProverbShortfallReason,
} from "./fakeProverbCore";
import type { FAKE_PROVERB_ALGORITHM_VERSION } from "./fakeProverbVersions";

/** The fixed batch size and the number of stable display positions. */
export const FAKE_PROVERB_BATCH_SIZE = FAKE_PROVERB_MAX_COUNT;

export type FakeProverbBatchReason =
	| FakeProverbReason
	| FakeProverbShortfallReason
	| "invalid-state"
	| "invalid-ticket"
	| "invalid-completion"
	| "already-prepared"
	| "identity-conflict"
	| "revision-overflow"
	| "busy"
	| "closed"
	| "cancelled"
	| "superseded"
	| "unknown-row"
	| "empty-row";

export type FakeProverbBatchResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: FakeProverbBatchReason };

/** One committed proverb + gloss, never half of one. */
export type FakeProverbCommittedRow = {
	readonly rowId: string;
	readonly proverbRecipeId: string;
	readonly glossRecipeId: string;
	readonly proverbText: string;
	readonly glossText: string;
	/** `**{proverb}**\n\n> {gloss}`, from CORE1's single canonical serializer. */
	readonly canonicalText: string;
	/** CORE1's draft with its typed bindings. Runtime-transient: never Collect data. */
	readonly draft: FakeProverbDraft;
};

export type FakeProverbBatchRow = {
	readonly rowSlotId: string;
	/** Null for a position a partial batch did not fill. */
	readonly committed: FakeProverbCommittedRow | null;
};

export type FakeProverbBatch = {
	readonly batchId: string;
	readonly algorithmVersion: typeof FAKE_PROVERB_ALGORITHM_VERSION;
	readonly recipeSchemaVersion: number;
	readonly recipeDataVersion: number;
	/** The Vocabulary the drafts were generated from, captured at prepare. */
	readonly provenance: FakeProverbProvenance;
	readonly requestedCount: typeof FAKE_PROVERB_BATCH_SIZE;
	readonly actualCount: number;
	readonly status: "complete" | "partial";
	readonly shortfallReason: FakeProverbShortfallReason | null;
	/** Always ten, in rowSlotId order. */
	readonly rows: readonly FakeProverbBatchRow[];
};

export type FakeProverbGenerationStatus = {
	readonly pending: boolean;
	readonly lastError: FakeProverbBatchReason | null;
};

export type FakeProverbBatchState = {
	readonly lifecycle: "open" | "closed" | "disposed";
	/** Ten stable positions for this owner's lifetime; empty once released. */
	readonly rowSlotIds: readonly string[];
	readonly batch: FakeProverbBatch | null;
	readonly generation: FakeProverbGenerationStatus;
};

/** Opaque by identity; the visible shape is deliberately harmless. */
export type FakeProverbOperationTicket = { readonly kind: "fake-proverb-generate" };
export type FakeProverbOperationCompletion = { readonly kind: "fake-proverb-completion" };

export type FakeProverbBatchGenerateInput = {
	readonly vocabulary: ManualMorphVocabulary;
	readonly recipeSet: CompiledFakeProverbRecipeSet;
	/** Fresh private 256-bit hex material for this operation, supplied by the caller. */
	readonly operationMaterial: string;
};

export type FakeProverbBatchController = {
	read(): FakeProverbBatchState;
	beginGenerate(input: FakeProverbBatchGenerateInput): FakeProverbBatchResult<FakeProverbOperationTicket>;
	prepare(ticket: FakeProverbOperationTicket): FakeProverbBatchResult<FakeProverbOperationCompletion>;
	complete(ticket: FakeProverbOperationTicket, completion: FakeProverbOperationCompletion): FakeProverbBatchResult<FakeProverbBatchState>;
	cancel(ticket: FakeProverbOperationTicket): FakeProverbBatchResult<FakeProverbBatchState>;
	/** A Vocabulary Source changed: pending work is stale; the committed batch stays. */
	sourceChanged(): FakeProverbBatchResult<FakeProverbBatchState>;
	close(): FakeProverbBatchResult<FakeProverbBatchState>;
	dispose(): FakeProverbBatchResult<FakeProverbBatchState>;
};

/** Batches this module committed. A look-alike batch is not one. */
const BATCHES = new WeakSet<object>();

const IDLE: FakeProverbGenerationStatus = Object.freeze({ pending: false, lastError: null });

class Refusal extends Error {
	constructor(readonly reason: FakeProverbBatchReason) {
		super("fake-proverb-batch");
	}
}

function reject(reason: FakeProverbBatchReason): never {
	throw new Refusal(reason);
}

/** Fixed codes only: an exception that is not our own refusal never crosses this boundary. */
function guarded<T>(work: () => T): FakeProverbBatchResult<T> {
	try {
		return Object.freeze({ ok: true as const, value: work() });
	} catch (error) {
		return Object.freeze({ ok: false as const, reason: error instanceof Refusal ? error.reason : "invalid-request" });
	}
}

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
	try {
		return exactFields(value, keys);
	} catch {
		return reject("invalid-request");
	}
}

function material(value: unknown): string {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) reject("invalid-request");
	return value;
}

function advance(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) reject("revision-overflow");
	return value + 1;
}

type Stage = {
	readonly authority: FakeProverbAuthority;
	readonly drafts: readonly FakeProverbDraft[];
	readonly shortfall: FakeProverbShortfallReason | null;
};

type Operation = {
	readonly ticket: FakeProverbOperationTicket;
	readonly key: string;
	readonly nonce: number;
	readonly vocabulary: ManualMorphVocabulary;
	readonly recipeSet: CompiledFakeProverbRecipeSet;
	completion: FakeProverbOperationCompletion | null;
	stage: FakeProverbBatchResult<Stage> | null;
};

/**
 * Creates one owner per View-owned lifecycle, from fresh private identity
 * material. The returned object is the sole transaction owner; its state can
 * be read but not imported, cloned back in or restored. Closing or disposing
 * it is terminal: a new lifecycle needs a new owner and new material.
 */
export function createFakeProverbBatchController(input: { readonly identityMaterial: string }): FakeProverbBatchResult<FakeProverbBatchController> {
	return guarded(() => {
		let secret: string | null = material(fields(input, ["identityMaterial"])["identityMaterial"]);
		const slotSecret = secret;
		const rowSlotIds = Object.freeze(Array.from({ length: FAKE_PROVERB_BATCH_SIZE }, (_, index) =>
			sha256Hex(JSON.stringify(["semantropy/fake-proverb/slot", slotSecret, index]))));
		let ordinal = 0;
		let state: FakeProverbBatchState = freezeAnalysis({ lifecycle: "open", rowSlotIds, batch: null, generation: IDLE });
		const operations = new Map<FakeProverbOperationTicket, Operation>();
		// Why a ticket stopped being live, so a late call is told precisely. Holds no draft or material.
		const retired = new WeakMap<FakeProverbOperationTicket, FakeProverbBatchReason>();
		const issued = new Set<string>(rowSlotIds);
		// One authority per (owner, recipe set), so a later Generate does not derive the Snapshot again.
		let authorities = new Map<ManualMorphVocabulary, Map<CompiledFakeProverbRecipeSet, FakeProverbAuthority>>();
		// Owners whose Sources changed: a new Generate needs a freshly minted owner.
		const staleOwners = new WeakSet<ManualMorphVocabulary>();
		let transitioning = false;

		function transition<T>(work: () => T): FakeProverbBatchResult<T> {
			return guarded(() => {
				// A Proxy trap or getter reached during validation must not re-enter and move the frontier.
				if (transitioning) reject("busy");
				transitioning = true;
				try {
					return work();
				} finally {
					transitioning = false;
				}
			});
		}
		function open(): void {
			if (state.lifecycle !== "open") reject("closed");
		}
		function current(ticket: FakeProverbOperationTicket): Operation {
			open();
			const op = operations.get(ticket);
			if (!op) reject((ticket !== null && typeof ticket === "object" ? retired.get(ticket) : undefined) ?? "invalid-ticket");
			return op;
		}
		function publish(next: FakeProverbBatchState): FakeProverbBatchState {
			state = freezeAnalysis(next);
			return state;
		}
		function retire(reason: FakeProverbBatchReason): void {
			for (const ticket of operations.keys()) retired.set(ticket, reason);
			operations.clear();
		}
		function finish(op: Operation, reason: FakeProverbBatchReason): FakeProverbBatchState {
			operations.delete(op.ticket);
			retired.set(op.ticket, reason === "cancelled" ? "cancelled" : "invalid-ticket");
			return publish({ ...state, generation: Object.freeze({ pending: false, lastError: reason }) });
		}
		function identity(key: string, domain: "batch" | "row", index: number): string {
			return sha256Hex(JSON.stringify(["semantropy/fake-proverb/identity", domain, key, index]));
		}
		function authorityFor(op: Operation): FakeProverbAuthority {
			const byOwner = authorities.get(op.vocabulary);
			const cached = byOwner?.get(op.recipeSet);
			if (cached) return cached;
			const minted = createFakeProverbAuthority({ vocabulary: op.vocabulary, recipeSet: op.recipeSet });
			if (!minted.ok) reject(minted.reason);
			const next = byOwner ?? new Map<CompiledFakeProverbRecipeSet, FakeProverbAuthority>();
			next.set(op.recipeSet, minted.value);
			authorities.set(op.vocabulary, next);
			return minted.value;
		}
		/**
		 * Revokes, owner-wide, every Vocabulary owner this controller knows: those behind
		 * cached authorities and those of pending operations, prepared or not. Runs before
		 * any operation is discarded, so an owner known only through a begun ticket is
		 * revoked too. An owner another holder already revoked is simply left revoked.
		 */
		function revokeOwners(reason: "source-changed" | "view-close" | "plugin-disable"): void {
			const owners = new Set<ManualMorphVocabulary>([...authorities.keys(), ...[...operations.values()].map((op) => op.vocabulary)]);
			for (const owner of owners) {
				releaseFakeProverbOwner({ vocabulary: owner, reason });
				if (reason === "source-changed") staleOwners.add(owner);
			}
			authorities = new Map();
		}
		function release(lifecycle: "closed" | "disposed"): FakeProverbBatchState {
			revokeOwners(lifecycle === "closed" ? "view-close" : "plugin-disable");
			retire("closed");
			issued.clear();
			secret = null;
			// Terminal, including close -> dispose: the committed batch and every staged draft are dropped.
			return publish({ lifecycle: state.lifecycle === "disposed" ? "disposed" : lifecycle, rowSlotIds: [], batch: null, generation: IDLE });
		}

		const controller: FakeProverbBatchController = {
			read: () => state,
			beginGenerate: (raw) => transition(() => {
				open();
				const read = fields(raw, ["vocabulary", "recipeSet", "operationMaterial"]);
				const vocabulary = read["vocabulary"] as ManualMorphVocabulary;
				if (vocabulary === null || typeof vocabulary !== "object" || !isManualMorphVocabulary(vocabulary)) reject("invalid-vocabulary");
				if (staleOwners.has(vocabulary)) reject("stale");
				const recipeSet = read["recipeSet"] as CompiledFakeProverbRecipeSet;
				if (recipeSet === null || typeof recipeSet !== "object") reject("invalid-recipe-set");
				const supplied = material(read["operationMaterial"]);
				const next = advance(ordinal);
				const key = sha256Hex(JSON.stringify(["semantropy/fake-proverb/operation", secret, next, supplied]));
				const nonce = Number.parseInt(sha256Hex(JSON.stringify(["semantropy/fake-proverb/draw", key])).slice(0, 8), 16);
				ordinal = next;
				const op: Operation = { ticket: Object.freeze({ kind: "fake-proverb-generate" as const }), key, nonce, vocabulary, recipeSet, completion: null, stage: null };
				// A new Generate supersedes every older pending one.
				retire("superseded");
				operations.set(op.ticket, op);
				publish({ ...state, generation: Object.freeze({ pending: true, lastError: null }) });
				return op.ticket;
			}),
			prepare: (ticket) => transition(() => {
				const op = current(ticket);
				if (op.completion) reject("already-prepared");
				op.stage = guarded(() => {
					if (staleOwners.has(op.vocabulary)) reject("stale");
					const authority = authorityFor(op);
					const generated = generateFakeProverbs({ authority, recipeSet: op.recipeSet, drawMode: authority.provenance.drawMode,
						count: FAKE_PROVERB_BATCH_SIZE, nonce: op.nonce });
					if (!generated.ok) reject(generated.reason);
					// Zero drafts is never a batch; CORE1 always names why.
					if (generated.value.drafts.length === 0) reject(generated.value.shortfall ?? "insufficient-candidates");
					return Object.freeze({ authority, drafts: generated.value.drafts, shortfall: generated.value.shortfall });
				});
				op.completion = Object.freeze({ kind: "fake-proverb-completion" as const });
				return op.completion;
			}),
			complete: (ticket, completion) => transition(() => {
				const op = current(ticket);
				if (op.completion === null || op.completion !== completion || op.stage === null) reject("invalid-completion");
				if (!op.stage.ok) {
					finish(op, op.stage.reason);
					reject(op.stage.reason);
				}
				const { authority, drafts, shortfall } = op.stage.value;
				// The owner may have been revoked since prepare, by this controller or by any other holder of the
				// same Vocabulary owner (revocation is owner-wide). A prepared draft never outlives its owner.
				if (staleOwners.has(op.vocabulary)) {
					finish(op, "stale");
					reject("stale");
				}
				const live = checkFakeProverbAuthorityLive({ authority, recipeSet: op.recipeSet });
				if (!live.ok) {
					finish(op, live.reason);
					reject(live.reason);
				}
				// The whole replacement is built before any identity or row is published.
				const built = guarded(() => {
					const batchId = identity(op.key, "batch", 0);
					const rows = rowSlotIds.map((rowSlotId, index) => {
						const draft = drafts[index];
						if (draft === undefined) return { rowSlotId, committed: null };
						// One draft is one row: proverb, gloss and canonical text never come from different drafts.
						if (draft.canonicalText !== fakeProverbCanonicalText(draft.proverb.text, draft.gloss.text)) reject("invalid-state");
						return { rowSlotId, committed: { rowId: identity(op.key, "row", index), proverbRecipeId: draft.proverb.recipeId,
							glossRecipeId: draft.gloss.recipeId, proverbText: draft.proverb.text, glossText: draft.gloss.text,
							canonicalText: draft.canonicalText, draft } };
					});
					const fresh = [batchId, ...rows.flatMap((row) => (row.committed ? [row.committed.rowId] : []))];
					if (new Set(fresh).size !== fresh.length || fresh.some((id) => issued.has(id))) reject("identity-conflict");
					const batch: FakeProverbBatch = freezeAnalysis({
						batchId,
						algorithmVersion: authority.algorithmVersion,
						recipeSchemaVersion: authority.recipeSchemaVersion,
						recipeDataVersion: authority.recipeDataVersion,
						provenance: authority.provenance,
						requestedCount: FAKE_PROVERB_BATCH_SIZE,
						actualCount: drafts.length,
						status: drafts.length === FAKE_PROVERB_BATCH_SIZE ? "complete" : "partial",
						shortfallReason: shortfall,
						rows,
					});
					if (batch.status === "partial" && shortfall === null) reject("invalid-state");
					return { batch, fresh };
				});
				if (!built.ok) {
					finish(op, built.reason);
					reject(built.reason);
				}
				for (const id of built.value.fresh) issued.add(id);
				BATCHES.add(built.value.batch);
				operations.delete(ticket);
				retired.set(ticket, "invalid-ticket");
				return publish({ ...state, batch: built.value.batch, generation: IDLE });
			}),
			cancel: (ticket) => transition(() => finish(current(ticket), "cancelled")),
			sourceChanged: () => transition(() => {
				open();
				const hadPending = operations.size > 0;
				// Pending work was prepared, or would be, from Sources that no longer exist as they were.
				// Revoke first, while every pending owner is still known, then retire the tickets.
				revokeOwners("source-changed");
				retire("stale");
				// The committed batch, its rows, recipe IDs, canonical texts and provenance stay untouched.
				return publish({ ...state, generation: hadPending ? Object.freeze({ pending: false, lastError: "stale" as const }) : state.generation });
			}),
			close: () => transition(() => release("closed")),
			dispose: () => transition(() => release("disposed")),
		};
		return Object.freeze(controller);
	});
}

/**
 * The read seam a later Collect slice may use: one committed row of a batch
 * this module committed, as plain frozen data. It carries the result identity
 * (`batchId`, `rowId`), the actual recipe IDs, the canonical text, the version
 * set and the captured provenance, and nothing else — no typed binding, draft,
 * rowSlotId, count, shortfall, nonce or material. It is not Collect metadata;
 * metadata 4 belongs to COLLECT1. A value read here stays valid after the
 * owner regenerates, detects a Source change or is released.
 */
export type FakeProverbRowRecord = {
	readonly batchId: string;
	readonly rowId: string;
	readonly algorithmVersion: typeof FAKE_PROVERB_ALGORITHM_VERSION;
	readonly recipeSchemaVersion: number;
	readonly recipeDataVersion: number;
	readonly proverbRecipeId: string;
	readonly glossRecipeId: string;
	readonly canonicalText: string;
	readonly provenance: FakeProverbProvenance;
};

export function readFakeProverbRow(input: { readonly batch: FakeProverbBatch; readonly rowSlotId: string }): FakeProverbBatchResult<FakeProverbRowRecord> {
	return guarded(() => {
		const read = fields(input, ["batch", "rowSlotId"]);
		const batch = read["batch"];
		if (batch === null || typeof batch !== "object" || !BATCHES.has(batch)) reject("invalid-state");
		const committedBatch = batch as FakeProverbBatch;
		const row = committedBatch.rows.find((entry) => entry.rowSlotId === read["rowSlotId"]);
		if (!row) reject("unknown-row");
		if (!row.committed) reject("empty-row");
		return freezeAnalysis<FakeProverbRowRecord>({
			batchId: committedBatch.batchId,
			rowId: row.committed.rowId,
			algorithmVersion: committedBatch.algorithmVersion,
			recipeSchemaVersion: committedBatch.recipeSchemaVersion,
			recipeDataVersion: committedBatch.recipeDataVersion,
			proverbRecipeId: row.committed.proverbRecipeId,
			glossRecipeId: row.committed.glossRecipeId,
			canonicalText: row.committed.canonicalText,
			provenance: committedBatch.provenance,
		});
	});
}
