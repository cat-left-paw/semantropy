import { freezeAnalysis } from "../analysis/rubyVocabulary";
import type { AdverbObservationRejection } from "../adverb/adverbObservation";
import type { AdverbCapabilityRejection } from "../adverb/adverbCapability";

export type ManualAdverbReason = AdverbObservationRejection | AdverbCapabilityRejection |
	"invalid-input" | "invalid-vocabulary" | "invalid-authority" | "invalid-evidence" |
	"invalid-candidate" | "invalid-slot" | "invalid-evaluation" | "invalid-ticket" |
	"no-candidate" | "only-current-surface" | "released" | "busy" | "revision-overflow";
export type ManualAdverbResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: ManualAdverbReason };
const REFUSALS = new WeakMap<object, ManualAdverbReason>();
class Refusal extends Error { constructor(reason: ManualAdverbReason) { super(reason); REFUSALS.set(this, reason); } }
export function refuse(reason: ManualAdverbReason): never { throw new Refusal(reason); }
export function guarded<T>(work: () => T): ManualAdverbResult<T> {
	try { return Object.freeze({ ok: true, value: work() }); }
	// WeakMap lookup never reads an attacker-thrown Proxy's prototype or fields.
	catch (error) { return Object.freeze({ ok: false, reason: REFUSALS.get(error as object) ?? "invalid-evidence" }); }
}
/** Own data fields only. Never invoke a getter or accept hidden extra authority. */
export function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) refuse("invalid-input");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !descriptors[key] || !("value" in descriptors[key]))) refuse("invalid-input");
	return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value as unknown]));
}
export function array(value: unknown): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse("invalid-input");
	const ds = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(value).length !== value.length + 1) refuse("invalid-input");
	return Array.from({ length: value.length }, (_, i) => {
		const entry = ds[String(i)]; if (!entry || !("value" in entry)) refuse("invalid-input"); return entry.value as unknown;
	});
}
export function text(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0")) refuse("invalid-input");
	return value;
}
export function count(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) refuse("invalid-evidence"); return value;
}
export function increment(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) refuse("revision-overflow");
	return value + 1;
}
export const frozen = freezeAnalysis;
