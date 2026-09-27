import { isFragmentCreated, isFragmentId } from "./fragmentIdentityValidation";

/** Supplies the entry id. Injected so tests can pin it. */
export type FragmentIdSource = () => string;

/** Supplies the creation instant. Injected so tests can pin it. */
export type FragmentClock = () => Date;

export type FragmentIdentity = {
	readonly id: string;
	readonly created: string;
};

/**
 * Issues the id and timestamp for exactly one entry.
 *
 * This is the only place either is minted. The repository never invents one:
 * if a write has to be looked at again, the entry it carries is already fixed,
 * so nothing downstream can quietly produce a second identity for one Collect.
 *
 * A source that returns something other than a UUID, or a clock that returns
 * an unusable date, throws rather than being worked around. Both are broken
 * environments, and a guessed identity would be worse than a refused Collect.
 */
export function issueFragmentIdentity(
	newId: FragmentIdSource,
	now: FragmentClock,
): FragmentIdentity {
	const id = newId();
	if (!isFragmentId(id)) {
		throw new Error("The fragment id source did not return a UUID.");
	}
	const at = now();
	if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
		throw new Error("The fragment clock did not return a usable time.");
	}
	// Always UTC ISO 8601, whatever the machine's zone.
	const created = at.toISOString();
	if (!isFragmentCreated(created)) {
		throw new Error("The fragment clock did not return a usable time.");
	}
	return Object.freeze({ id, created });
}

export type RandomUuidSource = {
	randomUUID?: () => string;
};

function platformCrypto(): RandomUuidSource | undefined {
	return typeof crypto === "undefined" ? undefined : crypto;
}

/**
 * Production ids come from Web Crypto.
 *
 * There is no `Math.random()` fallback. A weak id would collide silently and
 * an entry's identity is the only thing distinguishing two Collects of the
 * same words, so an absent Web Crypto fails the Collect instead.
 */
export function webCryptoFragmentIdSource(
	source: RandomUuidSource | undefined = platformCrypto(),
): FragmentIdSource {
	return () => {
		if (typeof source?.randomUUID !== "function") {
			throw new Error(
				"Web Crypto randomUUID is unavailable; cannot issue a fragment id.",
			);
		}
		return source.randomUUID();
	};
}

export function systemFragmentClock(): FragmentClock {
	return () => new Date();
}
