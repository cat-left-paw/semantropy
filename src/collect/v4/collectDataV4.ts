import {
	exactCollectFields,
	guardCollectV3,
	ownCollectArray,
	ownCollectData,
	type FragmentValidationReasonV3,
} from "../v3/collectDataV3";

/**
 * PRE-RELEASE-FAKE-PROVERB-COLLECT1: fixed refusals for Collect metadata 4.
 * Production-disconnected. The descriptor readers are the reviewed v3 ones,
 * wrapped so a v3 refusal keeps its reason under the v4 guard.
 */
export type FragmentValidationReasonV4 =
	| FragmentValidationReasonV3
	| "invalid-recipe-data-version"
	| "invalid-recipe-id"
	| "invalid-canonical-text"
	| "canonical-text-mismatch"
	| "invalid-recompose-method"
	| "invalid-recompose-leap";

export type CollectReadResultV4<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: FragmentValidationReasonV4 };

const refusals = new WeakMap<object, FragmentValidationReasonV4>();

export function refuseCollectV4(reason: FragmentValidationReasonV4): never {
	const failure = new Error(reason);
	Object.freeze(failure);
	refusals.set(failure, reason);
	throw failure;
}

export function guardCollectV4<T>(read: () => T): CollectReadResultV4<T> {
	try {
		return { ok: true, value: read() };
	} catch (error) {
		const reason = error !== null && typeof error === "object" ? refusals.get(error) : undefined;
		return { ok: false, reason: reason ?? "invalid-fragment-fields" };
	}
}

/** Runs a v3 reader and re-raises its fixed reason as a v4 refusal. */
function viaV3<T>(read: () => T): T {
	const result = guardCollectV3(read);
	if (!result.ok) refuseCollectV4(result.reason);
	return result.value;
}

/** Own data descriptors only; never a getter, inherited field or Symbol key. */
export function ownCollectDataV4(value: unknown): Record<string, unknown> {
	return viaV3(() => ownCollectData(value));
}

export function exactCollectFieldsV4(data: Record<string, unknown>, keys: readonly string[]): void {
	viaV3(() => exactCollectFields(data, keys));
}

export function ownCollectArrayV4(value: unknown, reason: FragmentValidationReasonV3): unknown[] {
	return viaV3(() => ownCollectArray(value, reason));
}
