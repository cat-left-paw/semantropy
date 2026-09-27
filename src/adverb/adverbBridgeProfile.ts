import {
	type AdverbCandidateIdentity,
	type AdverbClass,
	ADVERB_CLASSES,
	ADVERB_FAMILY,
	adverbProfileIdentityKey,
	adverbSurfaceEndsWithTo,
} from "./adverbFamily";

/**
 * `to-optional` bridge profile, data version 1.
 *
 * Policy `PRE-RELEASE-AUTO-POS-POLICY1` §8.3 makes the external `と` a
 * *capability*, not an equality: a candidate may be placed before a Target's
 * external `と` when either the authenticated Sources observed it there, or
 * this reviewed profile says the `と` is optional for that lexeme. The profile
 * is the second half of that union and nothing else — it extends the bridge
 * dimension only, and can neither create a head class nor a polarity that was
 * never observed.
 *
 * ## What version 1 contains, and why so little
 *
 * Exactly the two entries the policy mandates: `ゆっくり` (助詞類接続) and
 * `じっくり` (一般). `すぐ` is excluded, also by the policy, and the test suite
 * pins its absence rather than trusting the list to stay short.
 *
 * No third entry is added here. Admitting a lexeme to this profile is a claim
 * that `と` is *naturally* optional after it, and the only evidence available
 * inside this repository is the dictionary — which says nothing about
 * naturalness. `すぐと歩く` tokenizes perfectly well as `すぐ` plus an external
 * `助詞 / 副詞化 と`; policy §8.5 records that tokenizability is not a proof of
 * naturalness, and this slice does not invent a substitute for the reviewed
 * evidence it does not have. Candidates that are genuinely used with `と` in a
 * writer's own Sources still reach `to` through the observation half of the
 * union, which needs no profile entry at all.
 *
 * Adding an entry, removing one, or changing what an identity key means is a
 * data version bump, because `PRE-RELEASE-AUTO-POS-POLICY1` §13 binds this
 * version into Snapshot / evidence identity: two different profile data sets
 * must never be mistaken for the same authenticated owner.
 *
 * ## Shape
 *
 * Typed, closed, deeply frozen, side-effect free and validated at module
 * initialization. No runtime download, no resource read, no regular
 * expression, no free-form JavaScript, no external API and no part-of-speech
 * guessing: an entry is a surface plus one of the two `副詞` classes the
 * shipped dictionary has, and its key is minted by the same identity function
 * a Source observation is filed under.
 */

export const ADVERB_BRIDGE_PROFILE_DATA_VERSION = 1;

export const ADVERB_BRIDGE_PROFILE_ID = "to-optional";

export type AdverbBridgeProfileEntry = {
	readonly surface: string;
	readonly adverbClass: AdverbClass;
	readonly identityKey: string;
};

export type AdverbBridgeProfile = {
	readonly profileId: typeof ADVERB_BRIDGE_PROFILE_ID;
	readonly dataVersion: number;
	readonly entries: readonly AdverbBridgeProfileEntry[];
};

/**
 * The authored data. Surface and class only — every other part of the identity
 * is the compact dictionary's fixed `副詞` shape and is minted, never authored,
 * so a typo cannot invent a morphology.
 *
 * `ゆっくり` is 助詞類接続 and `じっくり` is 一般 in the shipped dictionary;
 * that split is exactly why policy §6 needs one `regular-adverb` family, and
 * `tests/distribution/adverbSpike.test.ts` pins both classes against the real
 * bytes.
 */
const AUTHORED: readonly { surface: string; adverbClass: AdverbClass }[] = [
	{ surface: "ゆっくり", adverbClass: "助詞類接続" },
	{ surface: "じっくり", adverbClass: "一般" },
];

export class AdverbBridgeProfileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AdverbBridgeProfileError";
	}
}

/**
 * Builds and validates a profile. Exported so a test can feed it deliberately
 * broken data: the production value below is the only one this module builds,
 * and it is built through exactly this function.
 *
 * Every rule is a refusal, never a repair:
 *
 *   - the data version must be a positive safe integer;
 *   - at least one entry, no duplicate identity key, canonical surface order;
 *   - a surface must be non-empty and already NFC, so an authored string
 *     cannot mint a key different from the one it displays;
 *   - the class must be one the dictionary has;
 *   - a surface ending in `と` is refused. Such an entry could only ever grant
 *     `to`, and §8.4's duplicate-`と` guard refuses that placement anyway, so
 *     admitting one would advertise a capability the guard denies.
 */
export function buildAdverbBridgeProfile(input: {
	readonly dataVersion: number;
	readonly entries: readonly { surface: string; adverbClass: string }[];
}): AdverbBridgeProfile {
	if (
		!Number.isSafeInteger(input.dataVersion) ||
		input.dataVersion < 1
	) {
		throw new AdverbBridgeProfileError("invalid profile data version");
	}
	if (input.entries.length === 0) {
		throw new AdverbBridgeProfileError("empty profile");
	}
	const keys = new Set<string>();
	const entries: AdverbBridgeProfileEntry[] = [];
	let previous = "";
	for (const authored of input.entries) {
		const surface = authored.surface;
		if (typeof surface !== "string" || surface.length === 0) {
			throw new AdverbBridgeProfileError("invalid profile surface");
		}
		if (surface.normalize("NFC") !== surface) {
			throw new AdverbBridgeProfileError("profile surface is not NFC");
		}
		if (adverbSurfaceEndsWithTo(surface)) {
			throw new AdverbBridgeProfileError("profile surface already ends in と");
		}
		if (!(ADVERB_CLASSES as readonly string[]).includes(authored.adverbClass)) {
			throw new AdverbBridgeProfileError("invalid profile adverb class");
		}
		const adverbClass = authored.adverbClass as AdverbClass;
		const identityKey = adverbProfileIdentityKey(surface, adverbClass);
		if (keys.has(identityKey)) {
			throw new AdverbBridgeProfileError("duplicate profile entry");
		}
		keys.add(identityKey);
		if (previous !== "" && !(previous < identityKey)) {
			throw new AdverbBridgeProfileError("profile entries are not ordered");
		}
		previous = identityKey;
		entries.push(Object.freeze({ surface, adverbClass, identityKey }));
	}
	return Object.freeze({
		profileId: ADVERB_BRIDGE_PROFILE_ID,
		dataVersion: input.dataVersion,
		entries: Object.freeze(entries),
	});
}

function ordered(
	authored: readonly { surface: string; adverbClass: AdverbClass }[],
): readonly { surface: string; adverbClass: AdverbClass }[] {
	return [...authored].sort((a, b) => {
		const left = adverbProfileIdentityKey(a.surface, a.adverbClass);
		const right = adverbProfileIdentityKey(b.surface, b.adverbClass);
		return left < right ? -1 : left > right ? 1 : 0;
	});
}

/** The single reviewed profile this build ships. */
export const TO_OPTIONAL_ADVERB_BRIDGE_PROFILE: AdverbBridgeProfile =
	buildAdverbBridgeProfile({
		dataVersion: ADVERB_BRIDGE_PROFILE_DATA_VERSION,
		entries: ordered(AUTHORED),
	});

const PROFILE_ENTRIES: ReadonlyMap<string, AdverbBridgeProfileEntry> = new Map(
	TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.entries.map((entry) => [
		entry.identityKey,
		entry,
	]),
);

/**
 * Whether the profile declares `と` optional for this exact candidate identity.
 *
 * The key selects the entry, and then **every field must agree with it**: the
 * family, the surface and the class the entry was authored with. An earlier
 * revision matched on the key alone, which independent review found still
 * accepted `じっくり`'s genuine key carrying `すぐ`'s surface and class — the
 * same shape of forgery `evaluateAdverbCandidate()` had already been corrected
 * for. This function is a published seam for `PRE-RELEASE-ADVERB-MANUAL1`, so
 * it has to refuse that on its own rather than rely on its caller.
 *
 * A token whose morphology differs from the shipped `副詞` shape mints a
 * different key and simply is not in the profile.
 */
export function isToOptionalAdverb(identity: AdverbCandidateIdentity): boolean {
	if (identity === null || typeof identity !== "object") {
		return false;
	}
	const entry = PROFILE_ENTRIES.get(identity.identityKey);
	return (
		entry !== undefined &&
		identity.family === ADVERB_FAMILY &&
		identity.surface === entry.surface &&
		identity.adverbClass === entry.adverbClass
	);
}
