import type { FragmentValidationReason } from "../CollectedFragment";

export type FragmentValidationReasonV3 = FragmentValidationReason | "invalid-automatic-parts-of-speech";
export type CollectReadResult<T> = { readonly ok: true; readonly value: T } |
	{ readonly ok: false; readonly reason: FragmentValidationReasonV3 };
const refusals = new WeakMap<object, FragmentValidationReasonV3>();
export function refuseCollectV3(reason: FragmentValidationReasonV3): never {
	const failure = new Error(reason);
	Object.freeze(failure);
	refusals.set(failure, reason);
	throw failure;
}
export function guardCollectV3<T>(read: () => T): CollectReadResult<T> {
	try { return { ok: true, value: read() }; }
	catch (error) {
		const reason = error !== null && typeof error === "object" ? refusals.get(error) : undefined;
		return { ok: false, reason: reason ?? "invalid-fragment-fields" };
	}
}

/** Snapshot own data descriptors once; never evaluate a getter or inherited field. */
export function ownCollectData(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object") refuseCollectV3("invalid-fragment-fields");
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) refuseCollectV3("invalid-fragment-fields");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== "string") refuseCollectV3("invalid-fragment-fields");
		const descriptor = descriptors[key]!;
		if (!("value" in descriptor)) refuseCollectV3("invalid-fragment-fields");
		copy[key] = descriptor.value as unknown;
	}
	return copy;
}
export function exactCollectFields(data: Record<string, unknown>, keys: readonly string[]) {
	if (Object.keys(data).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(data, key)))
		refuseCollectV3("invalid-fragment-fields");
}
export function ownCollectArray(value: unknown, reason: FragmentValidationReasonV3): unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuseCollectV3(reason);
	const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value as object);
	const length: unknown = descriptors.length?.value;
	if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || Reflect.ownKeys(descriptors).length !== length + 1)
		refuseCollectV3(reason);
	const result: unknown[] = [];
	for (let index = 0; index < length; index++) {
		const descriptor = descriptors[String(index)];
		if (!descriptor || !("value" in descriptor)) refuseCollectV3(reason);
		result.push(descriptor.value as unknown);
	}
	return result;
}
