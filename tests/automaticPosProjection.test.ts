import { afterEach, describe, expect, it, vi } from "vitest";
import * as morphology from "../src/transform/manualMorphology";
import * as adverbs from "../src/transform/manualAdverbAuthority";
import * as profile from "../src/adverb/adverbBridgeProfile";
import { AUTOMATIC_BODY_PROJECTION_POLICY_VERSION, VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION, VOCABULARY_FINGERPRINT_VERSION } from "../src/vocabulary/vocabularySnapshot";
import { SEMANTROPY_ALGORITHM_VERSION } from "../src/random/seededRandom";
import { createAutomaticPosProjection, requireAutomaticPosOwner } from "../src/transform/automaticPosProjection";
import { deepFrozen, ok, prepare, textOwner, walk, period } from "./automaticPosFixtures";
import { makeOwner } from "./manualAdverbFixtures";
afterEach(() => vi.restoreAllMocks());
const make = () => textOwner(["猫歩く。美しい。じっくり歩く。", "犬書く。高い。ゆっくり書く。"]);
describe("Automatic projection 2 authenticated ownership", () => {
	it("authenticates the owner before any downstream structural seam", async () => {
		const { owner } = await make();
		expect(requireAutomaticPosOwner(owner)).toBe(owner);
		for (const value of [{ ...owner }, structuredClone(owner), {}, null]) expect(() => requireAutomaticPosOwner(value)).toThrow("invalid-owner");
	});
	it("never accepts raw Snapshot as origin proof", async () => {
		const { owner } = await make();
		expect(() => requireAutomaticPosOwner(owner.snapshot)).toThrow("invalid-owner");
		expect(morphology.readManualMorphCandidateBuckets(owner.snapshot as never)).toBeNull();
	});
	it("rejects clone owners raw snapshots and foreign adverb authorities", async () => {
		const { owner } = await make(), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		for (const value of [{ ...owner }, structuredClone(owner), owner.snapshot, null])
			expect(createAutomaticPosProjection({ vocabulary: value as never, adverbAuthority: authority })).toEqual({ ok: false, reason: "invalid-owner" });
		const equal = morphology.buildManualMorphVocabulary({ sources: owner.sources, drawMode: "uniform" });
		const foreign = ok(adverbs.createManualAdverbAuthority({ vocabulary: equal }));
		expect(foreign.provenance).toEqual(authority.provenance);
		expect(adverbs.inspectManualAdverbOwner({ authority: foreign, vocabulary: owner })).toEqual({ ok: false, reason: "invalid-vocabulary" });
		expect(createAutomaticPosProjection({ vocabulary: owner, adverbAuthority: foreign })).toEqual({ ok: false, reason: "provenance-mismatch" });
		expect(createAutomaticPosProjection({ vocabulary: owner, adverbAuthority: { ...authority } })).toEqual({ ok: false, reason: "provenance-mismatch" });
	});
	it("validates outside Source origins independently of authentic ownership", async () => {
		const { owner } = await make(), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		const real = morphology.readManualMorphCandidateBuckets(owner)!;
		const changed = structuredClone(real); changed[0]!.candidates[0]!.origins[0]!.path = "foreign.md";
		vi.spyOn(morphology, "readManualMorphCandidateBuckets").mockReturnValue(changed);
		expect(createAutomaticPosProjection({ vocabulary: owner, adverbAuthority: authority })).toEqual({ ok: false, reason: "provenance-mismatch" });
	});
	it("checks complete Source identities separately from candidate origins", async () => {
		const { owner } = await make(), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		const real = morphology.readManualMorphVocabularySources(owner)!;
		vi.spyOn(morphology, "readManualMorphVocabularySources").mockReturnValue(real.map(item => ({ ...item, source: { ...item.source, projectionPolicy: "foreign" } })));
		expect(createAutomaticPosProjection({ vocabulary: owner, adverbAuthority: authority })).toEqual({ ok: false, reason: "provenance-mismatch" });
	});
	it("rejects structurally consistent outside origins after test-only authentication bypass", async () => {
		const { owner } = await make(), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		const sources = morphology.readManualMorphVocabularySources(owner)!;
		const buckets = structuredClone(morphology.readManualMorphCandidateBuckets(owner)!);
		const forged = structuredClone(owner), record = buckets[0]!.candidates[0]!;
		record.origins[0]!.path = "foreign.md";
		const matching = forged.snapshot.projections.manual.candidates.find(item => item.displayFormId === record.displayFormId)!;
		(matching as { origins: typeof record.origins }).origins = record.origins;
		vi.spyOn(morphology, "isManualMorphVocabulary").mockReturnValue(true);
		vi.spyOn(adverbs, "inspectManualAdverbOwner").mockReturnValue({ ok: true, value: true });
		vi.spyOn(morphology, "readManualMorphVocabularySources").mockReturnValue(sources);
		vi.spyOn(morphology, "readManualMorphCandidateBuckets").mockReturnValue(buckets);
		expect(createAutomaticPosProjection({ vocabulary: forged, adverbAuthority: authority })).toEqual({ ok: false, reason: "provenance-mismatch" });
	});
	it("publishes all or nothing and permits a clean retry after missing evidence", async () => {
		const { owner } = await make(), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		vi.spyOn(morphology, "readManualMorphCandidateBuckets").mockReturnValueOnce(null);
		expect(createAutomaticPosProjection({ vocabulary: owner, adverbAuthority: authority })).toEqual({ ok: false, reason: "invalid-projection" });
		const projection = ok(createAutomaticPosProjection({ vocabulary: owner, adverbAuthority: authority }));
		expect(projection.verb.length).toBeGreaterThan(0); expect(projection.iAdjective.length).toBeGreaterThan(0);
		expect(projection.adverb.length).toBeGreaterThan(0); expect(deepFrozen(projection)).toBe(true);
	});
	it("refuses unsafe observed surfaces as a whole projection", async () => {
		const { owner } = await makeOwner([[walk("歩\u200bく"), period]]), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		expect(morphology.readManualMorphCandidateBuckets(owner)!.length).toBeGreaterThan(0);
		expect(createAutomaticPosProjection({ vocabulary: owner, adverbAuthority: authority })).toEqual({ ok: false, reason: "invalid-projection" });
	});
	it("binds the profile version and meaning into the new fingerprint", async () => {
		const first = prepare((await make()).owner).projection;
		const original = profile.TO_OPTIONAL_ADVERB_BRIDGE_PROFILE;
		// Simulate a future compiled product-data release, never a caller-provided profile.
		vi.spyOn(profile, "TO_OPTIONAL_ADVERB_BRIDGE_PROFILE", "get").mockReturnValue(Object.freeze({ ...original, dataVersion: original.dataVersion + 1 }));
		const second = prepare((await make()).owner).projection;
		expect(second.bridgeProfile.dataVersion).toBe(original.dataVersion + 1);
		expect(second.fingerprint).not.toBe(first.fingerprint);
		vi.spyOn(profile, "TO_OPTIONAL_ADVERB_BRIDGE_PROFILE", "get").mockReturnValue(Object.freeze({ ...original, entries: Object.freeze(original.entries.slice(0, 1)) }));
		const changedMeaning = prepare((await make()).owner).projection;
		expect(changedMeaning.bridgeProfile.dataVersion).toBe(original.dataVersion);
		expect(changedMeaning.fingerprint).not.toBe(first.fingerprint);
	});
	it("keeps the old version constants and snapshots unchanged", async () => {
		const { owner } = await make(), before = JSON.stringify(owner), p = prepare(owner);
		expect(SEMANTROPY_ALGORITHM_VERSION).toBe(9); expect(AUTOMATIC_BODY_PROJECTION_POLICY_VERSION).toBe("automatic-body-projection-1");
		expect(VOCABULARY_SNAPSHOT_TRANSFORM_ALGORITHM_VERSION).toBe(1); expect(VOCABULARY_FINGERPRINT_VERSION).toBe("vocabulary-fingerprint-sha256-1");
		expect(p.projection.fingerprint).toMatch(/^vocabulary-fingerprint-sha256-2:[0-9a-f]{64}$/u);
		expect(p.projection.fingerprint).not.toBe(owner.snapshot.fingerprint); expect(JSON.stringify(owner)).toBe(before);
		expect(morphology.readManualMorphCandidateBuckets({ ...owner })).toBeNull();
	});
	it("closes thrown hostile proxies into a fixed refusal", async () => {
		const { owner } = await make(), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error("PRIVATE"); }, get: () => { throw new Error("PRIVATE"); } });
		// Deliberate hostile thrown value: production must not inspect its prototype.
		// eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise hostile non-Error exceptions without reading them.
		vi.spyOn(morphology, "readManualMorphCandidateBuckets").mockImplementation(() => { throw hostile; });
		expect(createAutomaticPosProjection({ vocabulary: owner, adverbAuthority: authority })).toEqual({ ok: false, reason: "invalid-projection" });
	});
});
