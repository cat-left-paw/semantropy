import { UINT32_MAX } from "../random/seededRandom";

/**
 * Domain separation constant for body-transform slot scores: the ASCII bytes
 * of "SMTB" (SeMantropy Text Body). A future feature that scores slots for a
 * different purpose must use its own constant so the two never line up.
 */
export const BODY_SLOT_SCORE_DOMAIN = 0x534d5442;

/** Divisor that maps a uint32 onto [0, 1); 2^32, so 1 is never reached. */
export const UINT32_RANGE = UINT32_MAX + 1;

/**
 * MurmurHash3's 32-bit finalizer (fmix32), with its published constants. It is
 * not cryptographic; it is here because it avalanches well, is exactly
 * reproducible across engines, and needs no state.
 */
function fmix32(value: number): number {
	let mixed = value >>> 0;
	mixed ^= mixed >>> 16;
	mixed = Math.imul(mixed, 0x85ebca6b);
	mixed ^= mixed >>> 13;
	mixed = Math.imul(mixed, 0xc2b2ae35);
	mixed ^= mixed >>> 16;
	return mixed >>> 0;
}

/**
 * A slot's identity within one analysis: which text node it came from, and
 * where in that node's token sequence it sits. Stable for a fixed snapshot
 * and a fixed tokenization, and independent of the DOM.
 */
export type BodySlotIdentity = {
	sequenceIndex: number;
	tokenIndex: number;
};

/**
 * The slot's fixed uint32 score.
 *
 * Derived synchronously and purely from the body Seed, the slot identity and
 * the domain constant — never from `Math.random()`, Web Crypto, the clock, or
 * DOM identity. Because the score does not depend on the Semantropy value, the
 * set of applied slots can only grow as that value rises.
 */
export function bodySlotScore(
	bodySeed: number,
	slot: BodySlotIdentity,
): number {
	let hash = BODY_SLOT_SCORE_DOMAIN >>> 0;
	hash = fmix32((hash ^ (bodySeed >>> 0)) >>> 0);
	hash = fmix32((hash ^ (slot.sequenceIndex >>> 0)) >>> 0);
	hash = fmix32((hash ^ (slot.tokenIndex >>> 0)) >>> 0);
	return hash >>> 0;
}

/**
 * Whether a replaceable slot is transformed at this Semantropy value.
 *
 * The score is normalized to [0, 1) and compared against `bodySemantropy/100`.
 * The two endpoints need no special case and get none: at 0 nothing can be
 * below 0, and at 100 every normalized score is below 1.
 */
export function isSlotApplied(
	bodySeed: number,
	slot: BodySlotIdentity,
	bodySemantropy: number,
): boolean {
	const normalized = bodySlotScore(bodySeed, slot) / UINT32_RANGE;
	return normalized < bodySemantropy / 100;
}
