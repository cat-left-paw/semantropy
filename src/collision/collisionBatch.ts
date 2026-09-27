/**
 * Collision's in-memory transaction owner. No I/O, clock, entropy source or
 * scheduler: callers drive begin -> prepare -> complete, and lifecycle events.
 * Published values are immutable; tickets and completions are capabilities,
 * not serializable state. Retaining an old read() value cannot roll back this
 * owner's ticket frontier. A new owner requires fresh caller-supplied material.
 */
import { freezeAnalysis } from "../analysis/rubyVocabulary";
import { collectVocabularyFromSnapshot } from "../application/collectVocabulary";
import type { CollisionFragmentInput, CollectVocabularyProvenance } from "../collect/CollectedFragment";
import { isManualMorphVocabulary, type ManualMorphVocabulary } from "../transform/manualMorphology";
import { sha256Hex } from "../vocabulary/sha256";
import type { VocabularyDrawMode } from "../vocabulary/vocabularySnapshot";
import {
	COLLISION_ALGORITHM_VERSION,
	generateCollisionResults,
	viableCollisionRecipes,
	type CollisionGenerationDraft,
	type CollisionGenerationRejection,
	type CollisionRecipeRequest,
	type CollisionResultDraft,
	type CollisionShortfallReason,
} from "./collisionCore";
import type { CollisionLexemePool } from "./collisionLexemePool";
import { buildAuthenticatedCollisionLexemePool, type CollisionLexemePoolBuildRejection } from "./collisionVocabulary";
import type { CompiledCollisionPatternSet } from "./compilePatternSet";

export type CollisionBatchReason = CollisionGenerationRejection | CollisionLexemePoolBuildRejection |
	CollisionShortfallReason | "invalid-state" | "unknown-row" | "invalid-ticket" |
	"invalid-completion" | "already-prepared" | "recipe-not-selectable" |
	"identity-conflict" | "revision-overflow" | "busy" | "released" | "cancelled";
export type CollisionBatchResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: CollisionBatchReason };

export type CollisionRowSelector =
	| { readonly kind: "same" }
	| { readonly kind: "fixed"; readonly recipeId: string };
export type CollisionBatchRow = {
	readonly rowSlotId: string;
	readonly committed: CollisionResultDraft & {
		readonly rowId: string;
		readonly generationRevision: number;
	};
};
type Capture = {
	readonly vocabularyOwner: ManualMorphVocabulary;
	readonly vocabulary: CollectVocabularyProvenance;
	readonly pool: CollisionLexemePool;
	readonly patternSet: CompiledCollisionPatternSet;
	readonly patternSchemaVersion: number;
	readonly patternSetVersion: number;
	readonly drawMode: VocabularyDrawMode;
	readonly algorithmVersion: typeof COLLISION_ALGORITHM_VERSION;
};
export type CollisionBatch = Capture & {
	readonly batchId: string;
	readonly defaultPattern: CollisionRecipeRequest;
	readonly rows: readonly CollisionBatchRow[];
	readonly requestedCount: 10 | 20 | 50;
	readonly actualCount: number;
	readonly status: "complete" | "partial";
	readonly shortfallReason: CollisionShortfallReason | null;
	readonly limited: boolean;
};
type OperationStatus = {
	readonly pending: boolean;
	readonly lastError: CollisionBatchReason | null;
};
export type CollisionRowDraft = OperationStatus & {
	readonly rowSlotId: string;
	readonly selector: CollisionRowSelector;
};
export type CollisionBatchState = {
	readonly lifecycle: "open" | "closed" | "disposed";
	readonly batch: CollisionBatch | null;
	readonly generation: OperationStatus;
	readonly rowDrafts: readonly CollisionRowDraft[];
};
/** Opaque by identity, even though the public shape is deliberately harmless. */
export type CollisionOperationTicket = { readonly kind: "generate" | "regenerate" };
export type CollisionOperationCompletion = { readonly kind: "collision-completion" };
export type CollisionBatchGenerateInput = {
	readonly vocabulary: ManualMorphVocabulary;
	readonly patternSet: CompiledCollisionPatternSet;
	readonly count: 10 | 20 | 50;
	readonly defaultPattern: CollisionRecipeRequest;
	/** Private 256-bit hex material, supplied by the Collision caller. */
	readonly operationMaterial: string;
};
export type CollisionBatchController = {
	read(): CollisionBatchState;
	beginGenerate(input: CollisionBatchGenerateInput): CollisionBatchResult<CollisionOperationTicket>;
	select(input: { readonly rowSlotId: string; readonly selector: CollisionRowSelector }): CollisionBatchResult<CollisionBatchState>;
	beginRegenerate(input: { readonly rowSlotId: string; readonly operationMaterial: string }): CollisionBatchResult<CollisionOperationTicket>;
	prepare(ticket: CollisionOperationTicket): CollisionBatchResult<CollisionOperationCompletion>;
	complete(ticket: CollisionOperationTicket, completion: CollisionOperationCompletion): CollisionBatchResult<CollisionBatchState>;
	cancel(ticket: CollisionOperationTicket): CollisionBatchResult<CollisionBatchState>;
	close(): CollisionBatchResult<CollisionBatchState>;
	dispose(): CollisionBatchResult<CollisionBatchState>;
};

const BATCHES = new WeakSet<object>();
/** View options come from the same viability authority as regeneration. */
export function collisionBatchRecipeOptions(batch: CollisionBatch): CollisionBatchResult<readonly { readonly id: string; readonly label: string }[]> {
	return guarded(() => {
		if (BATCHES.has(batch) !== true) reject("invalid-state");
		const viable = viableCollisionRecipes(batch);
		if (!viable.ok) reject(viable.reason);
		return freezeAnalysis(batch.patternSet.recipes.filter(recipe => recipe.selectable &&
			viable.recipes.some(entry => entry.recipeId === recipe.id)).map(({ id, label }) => ({ id, label })));
	});
}
const IDLE: OperationStatus = Object.freeze({ pending: false, lastError: null });
const SAME: CollisionRowSelector = Object.freeze({ kind: "same" });
class Refusal extends Error {
	constructor(readonly reason: CollisionBatchReason) { super("collision-batch"); }
}
function reject(reason: CollisionBatchReason): never { throw new Refusal(reason); }
function guarded<T>(work: () => T): CollisionBatchResult<T> {
	try { return Object.freeze({ ok: true, value: work() }); }
	catch (error) {
		return Object.freeze({ ok: false, reason: error instanceof Refusal ? error.reason : "invalid-request" });
	}
}
/** Read inert own data once. Extra keys, accessors and prototype tricks are not inputs. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) reject("invalid-request");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).length !== keys.length) reject("invalid-request");
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const descriptor = descriptors[key];
		if (!descriptor || !("value" in descriptor)) reject("invalid-request");
		result[key] = descriptor.value;
	}
	return result;
}
/** Structural protection only; the core/compiler remains the semantic authority. */
function inertFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
	if (value === null || typeof value !== "object") return typeof value !== "function";
	if (seen.has(value)) return false;
	if (!Object.isFrozen(value)) return false;
	// Compiled data consists of plain records/arrays and string keys only.
	// Object.values alone would miss mutable payloads hidden behind Symbols.
	if (Object.getOwnPropertySymbols(value).length !== 0) return false;
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
	seen.add(value);
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
		if (!("value" in descriptor) || !inertFrozen(descriptor.value, seen)) return false;
	}
	seen.delete(value);
	return true;
}
function material(value: unknown): string {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) reject("invalid-request");
	return value;
}
function stringId(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) reject("invalid-request");
	return value;
}
function recipeRequest(value: unknown, row: false): CollisionRecipeRequest;
function recipeRequest(value: unknown, row: true): CollisionRowSelector;
function recipeRequest(value: unknown, row: boolean): CollisionRecipeRequest | CollisionRowSelector {
	// Descriptors, not a caller's getter, decide which exact shape to read.
	if (value === null || typeof value !== "object") reject("invalid-request");
	const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value as unknown;
	const read = fields(value, kind === "fixed" ? ["kind", "recipeId"] : ["kind"]);
	if (read.kind === "fixed") return Object.freeze({ kind: "fixed", recipeId: stringId(read.recipeId) });
	if (read.kind !== (row ? "same" : "random")) reject("invalid-request");
	return row ? SAME : Object.freeze({ kind: "random" });
}
/** Shared checked arithmetic for operation ordinals and committed revisions. */
export function advanceCollisionRevision(value: unknown): CollisionBatchResult<number> {
	return guarded(() => {
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) reject("revision-overflow");
		return value + 1;
	});
}
function advance(value: number): number {
	const result = advanceCollisionRevision(value);
	if (!result.ok) reject(result.reason);
	return result.value;
}
function explicitRecipe(capture: Capture, recipeId: string): void {
	const viable = viableCollisionRecipes(capture);
	if (!viable.ok) reject(viable.reason);
	const declared = capture.patternSet.recipes.find((recipe) => recipe.id === recipeId);
	if (!declared) reject("recipe-unknown");
	if (!declared.enabled) reject("recipe-disabled");
	if (!declared.selectable) reject("recipe-not-selectable");
	if (!viable.recipes.some((recipe) => recipe.recipeId === recipeId)) reject("recipe-not-viable");
}
type Stage = { readonly capture: Capture; readonly draft: CollisionGenerationDraft };
type Operation = {
	readonly ticket: CollisionOperationTicket;
	readonly key: string;
	readonly nonce: number;
	readonly input: Omit<CollisionBatchGenerateInput, "operationMaterial"> | null;
	readonly batch: CollisionBatch | null;
	readonly row: CollisionBatchRow | null;
	readonly request: CollisionRecipeRequest;
	completion: CollisionOperationCompletion | null;
	stage: CollisionBatchResult<Stage> | null;
};

/**
 * Call once per View-owned lifecycle, with fresh private identity material.
 * The returned closure is the sole transaction owner. State cannot be imported,
 * cloned back in or restored; all mutations are explicit in-memory transitions.
 */
export function createCollisionBatchController(input: { readonly identityMaterial: string }): CollisionBatchResult<CollisionBatchController> {
	return guarded(() => {
		let secret: string | null = material(fields(input, ["identityMaterial"]).identityMaterial);
		let ordinal = 0;
		let state: CollisionBatchState = freezeAnalysis({ lifecycle: "open", batch: null, generation: IDLE, rowDrafts: [] });
		const operations = new Map<CollisionOperationTicket, Operation>();
		const issued = new Set<string>();
		let transitioning = false;
		function transition<T>(work: () => T): CollisionBatchResult<T> {
			return guarded(() => {
				// Descriptor operations can run Proxy traps. Such a trap must not
				// re-enter this owner and change its frontier during validation.
				if (transitioning) reject("busy");
				transitioning = true;
				try { return work(); }
				finally { transitioning = false; }
			});
		}
		function open(): void { if (state.lifecycle !== "open") reject("released"); }
		function current(ticket: CollisionOperationTicket): Operation {
			open();
			const op = operations.get(ticket);
			if (!op) reject("invalid-ticket");
			return op;
		}
		function findRow(rowSlotId: string): CollisionBatchRow {
			const row = state.batch?.rows.find((entry) => entry.rowSlotId === rowSlotId);
			if (!row) reject("unknown-row");
			return row;
		}
		function publish(next: CollisionBatchState): CollisionBatchState {
			state = freezeAnalysis(next);
			return state;
		}
		function rowStatus(rowSlotId: string, status: OperationStatus, selector?: CollisionRowSelector): readonly CollisionRowDraft[] {
			return state.rowDrafts.map((draft) => draft.rowSlotId === rowSlotId
				? freezeAnalysis({ ...draft, ...status, selector: selector ?? draft.selector }) : draft);
		}
		function invalidateRow(rowSlotId: string): void {
			for (const [ticket, op] of operations) if (op.row?.rowSlotId === rowSlotId) operations.delete(ticket);
		}
		function operation(kind: CollisionOperationTicket["kind"], rawMaterial: unknown): Pick<Operation, "ticket" | "key" | "nonce" | "completion" | "stage"> {
			const supplied = material(rawMaterial);
			const next = advance(ordinal);
			const key = sha256Hex(JSON.stringify(["semantropy/collision/operation", secret, next, supplied]));
			const nonce = Number.parseInt(sha256Hex(JSON.stringify(["semantropy/collision/draw", key])).slice(0, 8), 16);
			ordinal = next;
			return { ticket: Object.freeze({ kind }), key, nonce, completion: null, stage: null };
		}
		function finish(op: Operation, reason: CollisionBatchReason | null): CollisionBatchState {
			operations.delete(op.ticket);
			const status = Object.freeze({ pending: false, lastError: reason });
			return publish(op.row
				? { ...state, rowDrafts: rowStatus(op.row.rowSlotId, status) }
				: { ...state, generation: status });
		}
		function identity(op: Operation, domain: string, index: number): string {
			return sha256Hex(JSON.stringify(["semantropy/collision/identity", domain, op.key, index]));
		}
		function register(batch: CollisionBatch, fresh: readonly string[]): void {
			if (new Set(fresh).size !== fresh.length || fresh.some((id) => issued.has(id))) reject("identity-conflict");
			for (const id of fresh) issued.add(id);
			BATCHES.add(batch);
		}
		const controller: CollisionBatchController = {
			read: () => state,
			beginGenerate: (raw) => transition(() => {
				open();
				const read = fields(raw, ["vocabulary", "patternSet", "count", "defaultPattern", "operationMaterial"]);
				const vocabulary = read.vocabulary as ManualMorphVocabulary;
				if (!isManualMorphVocabulary(vocabulary)) reject("invalid-vocabulary");
				const patternSet = read.patternSet as CompiledCollisionPatternSet;
				if (!inertFrozen(patternSet)) reject("invalid-pattern-set");
				const count = read.count;
				if (count !== 10 && count !== 20 && count !== 50) reject("invalid-request");
				const request = recipeRequest(read.defaultPattern, false);
				const op: Operation = { ...operation("generate", read.operationMaterial), input: { vocabulary, patternSet, count, defaultPattern: request }, batch: null, row: null, request };
				// A new batch request also invalidates operations on the old list.
				operations.clear();
				operations.set(op.ticket, op);
				publish({ ...state, generation: { pending: true, lastError: null }, rowDrafts: state.rowDrafts.map((draft) => freezeAnalysis({ ...draft, ...IDLE })) });
				return op.ticket;
			}),
			select: (raw) => transition(() => {
				open();
				if (state.generation.pending) reject("busy");
				const read = fields(raw, ["rowSlotId", "selector"]);
				const row = findRow(stringId(read.rowSlotId));
				const selector = recipeRequest(read.selector, true);
				if (selector.kind === "fixed") explicitRecipe(state.batch!, selector.recipeId);
				invalidateRow(row.rowSlotId);
				return publish({ ...state, rowDrafts: rowStatus(row.rowSlotId, IDLE, selector) });
			}),
			beginRegenerate: (raw) => transition(() => {
				open();
				if (state.generation.pending) reject("busy");
				const read = fields(raw, ["rowSlotId", "operationMaterial"]);
				const row = findRow(stringId(read.rowSlotId));
				advance(row.committed.generationRevision);
				const selector = state.rowDrafts.find((draft) => draft.rowSlotId === row.rowSlotId)!.selector;
				const request = Object.freeze({ kind: "fixed" as const, recipeId: selector.kind === "same" ? row.committed.recipeId : selector.recipeId });
				const op: Operation = { ...operation("regenerate", read.operationMaterial), input: null, batch: state.batch, row, request };
				invalidateRow(row.rowSlotId);
				operations.set(op.ticket, op);
				publish({ ...state, rowDrafts: rowStatus(row.rowSlotId, { pending: true, lastError: null }) });
				return op.ticket;
			}),
			prepare: (ticket) => transition(() => {
				const op = current(ticket);
				if (op.completion) reject("already-prepared");
				op.stage = guarded(() => {
					let capture: Capture;
					if (op.input) {
						const { vocabulary, patternSet } = op.input;
						const built = buildAuthenticatedCollisionLexemePool({ vocabulary, patternData: patternSet });
						if (!built.ok) reject(built.reason);
						capture = freezeAnalysis({ vocabularyOwner: vocabulary, vocabulary: collectVocabularyFromSnapshot(vocabulary.snapshot), pool: built.pool, patternSet,
							patternSchemaVersion: patternSet.schemaVersion, patternSetVersion: patternSet.dataVersion,
							drawMode: vocabulary.snapshot.drawMode, algorithmVersion: COLLISION_ALGORITHM_VERSION });
						if (op.request.kind === "fixed") explicitRecipe(capture, op.request.recipeId);
					} else capture = op.batch!;
					const index = op.batch?.rows.indexOf(op.row!) ?? 0;
					const generated = generateCollisionResults({ pool: capture.pool, patternSet: capture.patternSet, drawMode: capture.drawMode,
						count: op.input?.count ?? 1, request: op.request, nonce: op.nonce,
						...(op.batch ? { avoid: { texts: op.batch.rows.map((row) => row.committed.text),
							recentSignatures: op.batch.rows.slice(Math.max(0, index - 2), index).map((row) => row.committed.structureSignature) } } : {}) });
					if (!generated.ok) reject(generated.reason);
					if (generated.draft.generatedCount === 0) reject(generated.draft.shortfallReason ?? "invalid-state");
					return Object.freeze({ capture, draft: generated.draft });
				});
				op.completion = Object.freeze({ kind: "collision-completion" });
				return op.completion;
			}),
			complete: (ticket, completion) => transition(() => {
				const op = current(ticket);
				if (op.completion === null || op.completion !== completion || op.stage === null) reject("invalid-completion");
				if (!op.stage.ok) { finish(op, op.stage.reason); reject(op.stage.reason); }
				const { capture, draft } = op.stage.value;
				// Build the entire replacement before publishing any identity or row.
				const built = guarded(() => {
					if (op.row) {
						const batch = state.batch;
						if (!batch || batch.batchId !== op.batch!.batchId || findRow(op.row.rowSlotId) !== op.row) reject("invalid-ticket");
						const result = draft.results[0]!;
						// Other rows may have committed since prepare; never merge a new duplicate.
						if (batch.rows.some((row) => row.committed.text === result.text)) reject("duplicate-exhausted");
						const rowId = identity(op, "row", 0);
						const row = freezeAnalysis({ rowSlotId: op.row.rowSlotId, committed: { ...result, rowId, generationRevision: advance(op.row.committed.generationRevision) } });
						const rows = batch.rows.map((old) => old === op.row ? row : old);
						const next = freezeAnalysis({ ...batch, rows, limited: rows.some((item) => item.committed.limited) });
						register(next, [rowId]);
						return next;
					}
					const batchId = identity(op, "batch", 0);
					const rows = draft.results.map((result, index) => ({ rowSlotId: identity(op, "slot", index),
						committed: { ...result, rowId: identity(op, "row", index), generationRevision: 1 } }));
					const next: CollisionBatch = freezeAnalysis({ ...capture, batchId, defaultPattern: op.request, rows,
						requestedCount: op.input!.count, actualCount: draft.generatedCount, status: draft.status === "complete" ? "complete" : "partial",
						shortfallReason: draft.shortfallReason, limited: rows.some((row) => row.committed.limited) });
					register(next, [batchId, ...rows.flatMap((row) => [row.rowSlotId, row.committed.rowId])]);
					return next;
				});
				if (!built.ok) { finish(op, built.reason); reject(built.reason); }
				const batch = built.value;
				operations.delete(ticket);
				return publish(op.row ? { ...state, batch, rowDrafts: rowStatus(op.row.rowSlotId, IDLE) }
					: { ...state, batch, generation: IDLE, rowDrafts: batch.rows.map((row) => ({ rowSlotId: row.rowSlotId, selector: SAME, ...IDLE })) });
			}),
			cancel: (ticket) => transition(() => finish(current(ticket), "cancelled")),
			close: () => transition(() => release("closed")),
			dispose: () => transition(() => release("disposed")),
		};
		function release(lifecycle: "closed" | "disposed"): CollisionBatchState {
			operations.clear();
			issued.clear();
			secret = null;
			// Terminal, including close -> dispose; reopening needs a new owner.
			return publish({ lifecycle: state.lifecycle === "disposed" ? "disposed" : lifecycle, batch: null, generation: IDLE, rowDrafts: [] });
		}
		return Object.freeze(controller);
	});
}

/**
 * Pure writer input from a committed batch, never from selector/operation state.
 * VIEW1 must disable the target row's actions while its rowDraft.pending is true.
 * Previously obtained inputs stay immutable after regeneration or owner release.
 */
export function collisionFragmentFromBatch(input: { readonly batch: CollisionBatch; readonly rowSlotId: string }): CollisionBatchResult<CollisionFragmentInput> {
	return guarded(() => {
		const read = fields(input, ["batch", "rowSlotId"]);
		const batch = read.batch as CollisionBatch;
		if (!BATCHES.has(batch)) reject("invalid-state");
		const rowSlotId = stringId(read.rowSlotId);
		const row = batch.rows.find((entry) => entry.rowSlotId === rowSlotId);
		if (!row) reject("unknown-row");
		return freezeAnalysis({ type: "collision", text: row.committed.text, vocabulary: batch.vocabulary,
			algorithmVersion: batch.algorithmVersion, patternId: row.committed.recipeId, patternSetVersion: batch.patternSetVersion,
			batchId: batch.batchId, rowId: row.committed.rowId });
	});
}
