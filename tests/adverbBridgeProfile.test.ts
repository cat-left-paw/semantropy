import { describe, expect, it } from "vitest";
import {
	ADVERB_BRIDGE_PROFILE_DATA_VERSION,
	ADVERB_BRIDGE_PROFILE_ID,
	AdverbBridgeProfileError,
	buildAdverbBridgeProfile,
	isToOptionalAdverb,
	TO_OPTIONAL_ADVERB_BRIDGE_PROFILE,
} from "../src/adverb/adverbBridgeProfile";
import {
	type AdverbClass,
	ADVERB_FAMILY,
	adverbProfileIdentityKey,
} from "../src/adverb/adverbFamily";

/**
 * `to-optional` data version 1.
 *
 * The contents are a policy decision, so they are pinned exactly rather than
 * described: `PRE-RELEASE-AUTO-POS-POLICY1` §8.3 requires `ゆっくり` and
 * `じっくり` and excludes `すぐ`, and §13 binds the data version into
 * Snapshot / evidence identity. A change to any of it must fail here and be
 * reviewed as a data version bump, not absorbed as an edit.
 */

function identity(surface: string, adverbClass: AdverbClass) {
	return {
		family: ADVERB_FAMILY,
		adverbClass,
		surface,
		identityKey: adverbProfileIdentityKey(surface, adverbClass),
	} as const;
}

describe("the shipped to-optional profile", () => {
	it("is version 1 and contains exactly the reviewed entries", () => {
		expect(ADVERB_BRIDGE_PROFILE_DATA_VERSION).toBe(1);
		expect(TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.profileId).toBe(
			ADVERB_BRIDGE_PROFILE_ID,
		);
		expect(TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.dataVersion).toBe(1);
		expect(
			TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.entries.map((entry) => [
				entry.surface,
				entry.adverbClass,
			]),
			// Canonical identity-key order, not authoring order.
		).toEqual([
			["じっくり", "一般"],
			["ゆっくり", "助詞類接続"],
		]);
	});

	it("declares と optional for ゆっくり and じっくり and for nothing else", () => {
		expect(isToOptionalAdverb(identity("ゆっくり", "助詞類接続"))).toBe(true);
		expect(isToOptionalAdverb(identity("じっくり", "一般"))).toBe(true);
		// Excluded by policy: すぐ reaches `to` only through a real observation.
		expect(isToOptionalAdverb(identity("すぐ", "助詞類接続"))).toBe(false);
		expect(isToOptionalAdverb(identity("そっと", "一般"))).toBe(false);
	});

	it("is matched on the whole identity, never on the surface", () => {
		// The shipped classes are 助詞類接続 for ゆっくり and 一般 for じっくり.
		// The other class of the same surface is a different candidate and
		// inherits nothing.
		expect(isToOptionalAdverb(identity("ゆっくり", "一般"))).toBe(false);
		expect(isToOptionalAdverb(identity("じっくり", "助詞類接続"))).toBe(false);
		// A token carrying morphology the compact dictionary does not produce
		// for 副詞 mints a different key and misses the profile.
		expect(
			isToOptionalAdverb({
				family: ADVERB_FAMILY,
				adverbClass: "助詞類接続",
				surface: "ゆっくり",
				identityKey: JSON.stringify([
					"ゆっくり",
					"副詞",
					"助詞類接続",
					"*",
					"*",
					"*",
					"*",
					"*",
					"ユックリ",
					false,
				]),
			}),
		).toBe(false);
	});

	it("is deeply frozen", () => {
		expect(Object.isFrozen(TO_OPTIONAL_ADVERB_BRIDGE_PROFILE)).toBe(true);
		expect(Object.isFrozen(TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.entries)).toBe(true);
		for (const entry of TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.entries) {
			expect(Object.isFrozen(entry)).toBe(true);
		}
		expect(() => {
			(TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.entries as { length: number }).length = 0;
		}).toThrow();
		expect(TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.entries).toHaveLength(2);
	});
});

describe("profile validation", () => {
	const valid = [{ surface: "じっくり", adverbClass: "一般" }];

	it("refuses an invalid data version", () => {
		for (const dataVersion of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
			expect(() =>
				buildAdverbBridgeProfile({ dataVersion, entries: valid }),
			).toThrow(AdverbBridgeProfileError);
		}
	});

	it("refuses an empty profile", () => {
		expect(() =>
			buildAdverbBridgeProfile({ dataVersion: 1, entries: [] }),
		).toThrow(AdverbBridgeProfileError);
	});

	it("refuses an adverb class the dictionary does not have", () => {
		expect(() =>
			buildAdverbBridgeProfile({
				dataVersion: 1,
				entries: [{ surface: "じっくり", adverbClass: "副詞可能" }],
			}),
		).toThrow(AdverbBridgeProfileError);
	});

	it("refuses an absent or denormalized surface", () => {
		expect(() =>
			buildAdverbBridgeProfile({
				dataVersion: 1,
				entries: [{ surface: "", adverbClass: "一般" }],
			}),
		).toThrow(AdverbBridgeProfileError);
		// NFD `が` would mint a key different from the one it displays.
		expect(() =>
			buildAdverbBridgeProfile({
				dataVersion: 1,
				entries: [{ surface: "しっがり", adverbClass: "一般" }],
			}),
		).toThrow(AdverbBridgeProfileError);
	});

	it("refuses an entry whose surface already ends in と", () => {
		// It could only ever grant `to`, which the duplicate-と guard refuses.
		expect(() =>
			buildAdverbBridgeProfile({
				dataVersion: 1,
				entries: [{ surface: "そっと", adverbClass: "一般" }],
			}),
		).toThrow(AdverbBridgeProfileError);
	});

	it("refuses duplicates and unordered data", () => {
		expect(() =>
			buildAdverbBridgeProfile({
				dataVersion: 1,
				entries: [
					{ surface: "じっくり", adverbClass: "一般" },
					{ surface: "じっくり", adverbClass: "一般" },
				],
			}),
		).toThrow(AdverbBridgeProfileError);
		const ordered = TO_OPTIONAL_ADVERB_BRIDGE_PROFILE.entries.map((entry) => ({
			surface: entry.surface,
			adverbClass: String(entry.adverbClass),
		}));
		expect(() =>
			buildAdverbBridgeProfile({
				dataVersion: 1,
				entries: [...ordered].reverse(),
			}),
		).toThrow(AdverbBridgeProfileError);
	});
});
