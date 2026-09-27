import { sha256Hex } from "../vocabulary/sha256";
import { isSlotApplied, type BodySlotIdentity } from "./slotScore";

/**
 * PRE-RELEASE-MAX-CORE1 level transition. Pure: no owner, no Snapshot, no DOM.
 *
 * Semantropy Level Policy 1 §2.2:
 *
 *   - 0..50: strict candidates only. The application rate rises from 0 to 100%.
 *     It is Body 10's own positional score (`isSlotApplied`) at `2 * level`, so
 *     level 25 applies exactly the slots Body 10 applied at 50, and level 50 is
 *     Body 10 at 100.
 *   - 50..75: every eligible slot is applied; each slot moves strict -> High once
 *     its private threshold falls under `(level - 50) / 25`.
 *   - 75..100: each slot moves High -> MAX under `(level - 75) / 25`.
 *
 * One stable threshold per slot, derived from the operation nonce and the
 * authenticated token identity in its own domain, so raising the level can
 * never return a slot to a lower profile, and the application score and the
 * profile threshold never share a stream. Neither value is ever returned.
 */
export type MaxProfile = "strict" | "high" | "max";
export const MAX_PROFILES = Object.freeze(["strict", "high", "max"] as const);
const RANK: Readonly<Record<MaxProfile, number>> = Object.freeze({ strict: 0, high: 1, max: 2 });
export const maxProfileRank = (profile: MaxProfile) => RANK[profile];

export function isMaxLevel(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}
/** The Body 10 application percentage this level reproduces. */
export function maxApplicationRate(level: number): number {
	return Math.min(100, level * 2);
}
export function isMaxSlotApplied(nonce: number, slot: BodySlotIdentity, level: number): boolean {
	return isSlotApplied(nonce, slot, maxApplicationRate(level));
}
/** `threshold` is a slot's stable unit value in [0, 1). */
export function maxProfileAt(level: number, threshold: number): MaxProfile {
	if (level <= 50) return "strict";
	if (level <= 75) return threshold < (level - 50) / 25 ? "high" : "strict";
	return threshold < (level - 75) / 25 ? "max" : "high";
}

/** MurmurHash3 fmix32, as slotScore uses it: reproducible, stateless, not cryptographic. */
function fmix32(value: number): number {
	let mixed = value >>> 0;
	mixed ^= mixed >>> 16; mixed = Math.imul(mixed, 0x85ebca6b);
	mixed ^= mixed >>> 13; mixed = Math.imul(mixed, 0xc2b2ae35);
	mixed ^= mixed >>> 16;
	return mixed >>> 0;
}
/** One private base per (part, purpose, nonce). Each purpose is its own domain. */
export function maxDomainBase(nonce: number, part: string, purpose: string): number {
	return parseInt(sha256Hex(JSON.stringify(["semantropy/automatic-pos-3", part, purpose, nonce])).slice(0, 8), 16);
}
/** A stateless per-slot uint32 under one base; length-prefixed so field boundaries cannot collide. */
export function maxSlotHash(base: number, fields: readonly string[]): number {
	let hash = base >>> 0;
	for (const field of fields) {
		hash = fmix32((hash ^ field.length) >>> 0);
		for (let i = 0; i < field.length; i++) hash = fmix32((hash ^ field.charCodeAt(i)) >>> 0);
	}
	return hash;
}
export const maxUnit = (hash: number) => hash / 4294967296;
