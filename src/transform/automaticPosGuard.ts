import { freezeAnalysis } from "../analysis/rubyVocabulary";

export type AutomaticPosReason = "invalid-owner" | "provenance-mismatch" | "stale" | "released" |
	"invalid-projection" | "invalid-request";
export type AutomaticPosAnswer<T> = { readonly ok: true; readonly value: T } |
	{ readonly ok: false; readonly reason: AutomaticPosReason };
const REFUSALS = new WeakMap<object, AutomaticPosReason>();
export function refuse(reason: AutomaticPosReason): never {
	const error = new Error(reason); REFUSALS.set(error, reason); throw error;
}
export function guarded<T>(work: () => T): AutomaticPosAnswer<T> {
	try { return Object.freeze({ ok: true, value: work() }); }
	catch (error) { return Object.freeze({ ok: false, reason: REFUSALS.get(error as object) ?? "invalid-projection" }); }
}
export function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) refuse("invalid-request");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !descriptors[key] || !("value" in descriptors[key]))) refuse("invalid-request");
	return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value as unknown]));
}
export const frozen = freezeAnalysis;
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Plain lexical surfaces only; no Markdown synthesis or control characters. */
export function safeSurface(value: string): boolean {
	return value.length > 0 && !/[\p{C}\s<>`{}[\]|*\\]/u.test(value);
}
