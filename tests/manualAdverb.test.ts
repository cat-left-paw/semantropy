import { afterEach, describe, expect, it, vi } from "vitest";
import * as morphology from "../src/transform/manualMorphology";
import * as observation from "../src/adverb/adverbObservation";
import { createManualAdverbAuthority, bindManualAdverbSlot, drawManualAdverbCandidate, evaluateManualAdverbCandidate,
	evaluateManualAdverbSlot, manualAdverbCapabilities, releaseManualAdverbAuthority } from "../src/transform/manualAdverbAuthority";
import { adverb, adjective, bind, bridge, build, candidate, comma, makeOwner, negative, sentence, token, unwrap, verb } from "./manualAdverbFixtures";

afterEach(() => vi.restoreAllMocks());
const evaluate = (authority: ReturnType<typeof build>, slot: ReturnType<typeof bind>, surface: string) =>
	unwrap(evaluateManualAdverbCandidate({ authority, slot, candidate: candidate(authority, surface) }));
async function fixture() {
	const { owner, calls } = await makeOwner([sentence(adverb("ゆっくり", "助詞類接続"), [bridge, verb]), sentence(adverb("じっくり")), sentence(adverb("すぐ", "助詞類接続"))]);
	const authority = build(owner), slot = bind(authority, owner);
	return { owner, authority, slot, calls };
}
function deepFrozen(value: unknown, seen = new Set<unknown>()) {
	if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;
	seen.add(value); expect(Object.isFrozen(value)).toBe(true);
	for (const key of Reflect.ownKeys(value)) deepFrozen(Object.getOwnPropertyDescriptor(value, key)?.value, seen);
}
describe("authenticated manual-morph-3", () => {
	it("accepts only minted owners and rejects snapshots clones spreads and hand-built indices", async () => {
		const { owner } = await fixture();
		for (const value of [owner.snapshot, { ...owner }, structuredClone(owner), {}, null]) {
			expect(createManualAdverbAuthority({ vocabulary: value as never })).toEqual({ ok: false, reason: "invalid-vocabulary" });
			expect(morphology.readManualMorphVocabularySources(value as never)).toBeNull();
		}
		expect(createManualAdverbAuthority({ vocabulary: owner, index: observation.buildAdverbObservationIndex([]) } as never)).toEqual({ ok: false, reason: "invalid-input" });
		expect(build(owner)).toBe(build(owner));
	});
	it("keeps authenticated runs immutable without retokenizing or changing snapshots", async () => {
		const { owner, authority, slot, calls } = await fixture(); const before = JSON.stringify(owner);
		const source = morphology.readManualMorphVocabularySources(owner)!;
		expect(source[0]!.analysis).toBe(owner.sources[0]);
		deepFrozen(source); deepFrozen(authority); deepFrozen(slot);
		for (let i = 0; i < 10; i++) evaluate(authority, slot, "じっくり");
		expect(calls()).toBe(3); expect(JSON.stringify(owner)).toBe(before);
		expect(authority.provenance.sources).toBe(owner.snapshot.sources);
		expect(authority.provenance.fingerprint).toBe(owner.snapshot.fingerprint);
		expect(authority.policyVersion).toBe("manual-morph-3"); expect(morphology.MANUAL_MORPH_POLICY_VERSION).toBe("manual-morph-2");
	});
	it("takes Ruby barriers from authenticated analysis and never accepts caller barriers", async () => {
		const analyzed = await morphology.analyzeManualMorphSource({ sourcePath: "ruby.md", text: "｜ゆっくり《ゆっくり》歩く。",
			tokenizer: { tokenize: () => Promise.resolve(sentence(adverb("ゆっくり", "助詞類接続"))) } });
		if (analyzed.status !== "ready") throw new Error("fixture");
		const owner = morphology.buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
		const authority = build(owner), slot = bind(authority, owner);
		expect(authority.candidates).toHaveLength(0);
		expect(unwrap(evaluateManualAdverbSlot({ authority, slot, currentSurface: "ゆっくり" })).diagnostic.reason).toBe("boundary-crossed");
		expect(evaluateManualAdverbSlot({ authority, slot, currentSurface: "ゆっくり", barriers: [] } as never)).toEqual({ ok: false, reason: "invalid-input" });
	});
	it("never creates observed profiles for adverbs before an unsupported head", async () => {
		const { owner } = await makeOwner([sentence(adverb("未観測"), [token("猫", "名詞", "一般")])]);
		const authority = build(owner);
		expect(authority.candidates).toHaveLength(0); expect(authority.observations.entries).toHaveLength(0);
		expect(unwrap(evaluateManualAdverbSlot({ authority, slot: bind(authority, owner), currentSurface: "未観測" })).diagnostic).toEqual({ available: false, reason: "unsupported-head", alternativeSurfaceCount: 0 });
	});
	it("refuses foreign candidates capabilities slots and cloned evidence", async () => {
		const a = await fixture(), b = await fixture();
		for (const value of [candidate(b.authority, "じっくり"), { ...candidate(a.authority, "じっくり") }, candidate(a.authority, "じっくり").identity]) {
			const input = { authority: a.authority, slot: a.slot, candidate: value as never };
			expect(evaluateManualAdverbCandidate(input)).toEqual({ ok: false, reason: "invalid-candidate" });
			expect(manualAdverbCapabilities(input)).toEqual({ ok: false, reason: "invalid-candidate" });
		}
		for (const slot of [b.slot, { ...a.slot }]) expect(evaluateManualAdverbSlot({ authority: a.authority, slot, currentSurface: "ゆっくり" })).toEqual({ ok: false, reason: "invalid-slot" });
		const source = morphology.readManualMorphVocabularySources(a.owner)![0]!;
		for (const targetVocabulary of [a.owner.snapshot, { ...a.owner }]) expect(bindManualAdverbSlot({ authority: a.authority, targetVocabulary: targetVocabulary as never, source: source.analysis, runId: source.runs[0]!.run.runId, tokenIndex: 0 }).ok).toBe(false);
	});
	it("refuses a different family before it can borrow an authentic candidate", async () => {
		const { authority, slot } = await fixture(), real = candidate(authority, "じっくり");
		expect(evaluateManualAdverbCandidate({ authority, slot, candidate: { ...real, identity: { ...real.identity, family: "noun" } } as never })).toEqual({ ok: false, reason: "invalid-candidate" });
		const target = await makeOwner([sentence(token("猫", "名詞", "一般"))]);
		expect(evaluate(authority, bind(authority, target.owner), "じっくり")).toEqual({ usable: false, stage: "target", reason: "unsupported-part-of-speech" });
	});
	it("rejects origins outside Vocabulary Sources independently of owner authentication", async () => {
		const { owner } = await makeOwner([sentence(adverb("じっくり"))]);
		const real = morphology.readManualMorphVocabularySources(owner)!;
		const spy = vi.spyOn(morphology, "readManualMorphVocabularySources");
		for (const changed of [{ path: "foreign.md" }, { projectionPolicy: "foreign-policy" }]) {
			spy.mockReturnValue(real.map(item => ({ ...item, source: { ...item.source, ...changed } })));
			expect(createManualAdverbAuthority({ vocabulary: owner })).toEqual({ ok: false, reason: "invalid-evidence" });
		}
		spy.mockRestore(); expect(build(owner).candidates).toHaveLength(1);
	});
	it("refuses mismatched run frequencies with no partial publication then permits a clean retry", async () => {
		const { owner } = await makeOwner([sentence(adverb("じっくり")), sentence(adverb("すぐ"))]);
		const real = morphology.readManualMorphVocabularySources(owner)!;
		const spy = vi.spyOn(morphology, "readManualMorphVocabularySources").mockReturnValue(real.map((item, i) => i ? { ...item, runs: [] } : item));
		expect(createManualAdverbAuthority({ vocabulary: owner })).toEqual({ ok: false, reason: "invalid-evidence" });
		spy.mockRestore(); expect(build(owner).candidates).toHaveLength(2);
	});
	it("checks record origins independently of the private owner registry", async () => {
		const { owner } = await makeOwner([sentence(adverb("じっくり"))]);
		const sources = morphology.readManualMorphVocabularySources(owner)!;
		const forged = structuredClone(owner);
		const record = forged.snapshot.projections.manual.candidates.find(item => item.morphology.pos === "副詞")!;
		(record.origins[0] as { path: string }).path = "FOREIGN.md";
		expect(createManualAdverbAuthority({ vocabulary: forged })).toEqual({ ok: false, reason: "invalid-vocabulary" });
		// Explicitly bypass origin authentication only in this test, so that a structural guard cannot pass for the wrong reason.
		vi.spyOn(morphology, "isManualMorphVocabulary").mockReturnValue(true);
		vi.spyOn(morphology, "readManualMorphVocabularySources").mockReturnValue(sources);
		expect(createManualAdverbAuthority({ vocabulary: forged })).toEqual({ ok: false, reason: "invalid-evidence" });
	});
	it("checks Source completeness and canonical publication", async () => {
		const { owner } = await makeOwner([sentence(adverb("先")), sentence(adverb("後"))]);
		const sources = morphology.readManualMorphVocabularySources(owner)!;
		const spy = vi.spyOn(morphology, "readManualMorphVocabularySources").mockReturnValue(sources.slice(0, 1));
		expect(createManualAdverbAuthority({ vocabulary: owner })).toEqual({ ok: false, reason: "invalid-evidence" });
		spy.mockRestore(); const normal = build(owner);
		const reversed = morphology.buildManualMorphVocabulary({ sources: [...owner.sources].reverse(), drawMode: "uniform" });
		expect(JSON.stringify(build(reversed))).toBe(JSON.stringify(normal));
	});
	it("never publishes a partial authority after an observation failure", async () => {
		const { owner } = await makeOwner([sentence(adverb("じっくり"))]);
		const spy = vi.spyOn(observation, "buildAdverbObservationIndex").mockImplementationOnce(() => { throw new Error("PRIVATE body surface path reading"); });
		expect(createManualAdverbAuthority({ vocabulary: owner })).toEqual({ ok: false, reason: "invalid-evidence" });
		spy.mockRestore(); expect(build(owner).candidates).toHaveLength(1);
	});
});
describe("SPIKE1 grammar is the only authority", () => {
	it("extends only the bridge for both directions of the to-optional profile", async () => {
		const { authority, slot } = await fixture();
		expect(evaluate(authority, slot, "じっくり")).toMatchObject({ usable: true, bridge: "to" });
		const other = await makeOwner([sentence(adverb("じっくり"))]);
		expect(evaluate(authority, bind(authority, other.owner), "ゆっくり")).toMatchObject({ usable: true, bridge: "none" });
		expect(unwrap(manualAdverbCapabilities({ authority, slot, candidate: candidate(authority, "じっくり") }))).toEqual({ none: true, to: true });
	});
	it("does not extend the bridge for a non-profiled candidate", async () => {
		const { authority, slot } = await fixture();
		expect(evaluate(authority, slot, "すぐ")).toEqual({ usable: false, stage: "candidate", reason: "bridge-not-capable" });
	});
	it("rejects duplicate to even when the exact external bridge was observed", async () => {
		const { owner } = await makeOwner([sentence(adverb("そっと"), [bridge, verb]), sentence(adverb("ゆっくり", "助詞類接続"), [bridge, verb])]);
		const authority = build(owner), slot = bind(authority, owner, 0, 1);
		expect(evaluate(authority, slot, "そっと")).toEqual({ usable: false, stage: "candidate", reason: "duplicate-to-bridge" });
	});
	it("does not invent unobserved heads or relax head equality", async () => {
		const { owner } = await makeOwner([sentence(adverb("じっくり"), [adjective]), sentence(adverb("ゆっくり", "助詞類接続"), [bridge, verb])]);
		const authority = build(owner), slot = bind(authority, owner, 0, 1);
		expect(evaluate(authority, slot, "じっくり")).toEqual({ usable: false, stage: "candidate", reason: "head-class-mismatch" });
		expect(unwrap(manualAdverbCapabilities({ authority, slot, candidate: candidate(authority, "じっくり") }))).toBeNull();
	});
	it("requires verb polarity equality even for a to-optional candidate", async () => {
		const { owner } = await makeOwner([sentence(adverb("じっくり"), negative), sentence(adverb("ゆっくり", "助詞類接続"), [bridge, verb])]);
		const authority = build(owner), slot = bind(authority, owner, 0, 1);
		expect(evaluate(authority, slot, "じっくり")).toEqual({ usable: false, stage: "candidate", reason: "polarity-mismatch" });
		expect(unwrap(manualAdverbCapabilities({ authority, slot, candidate: candidate(authority, "じっくり") }))).toBeNull();
	});
	it("keeps adjective not-applicable and never coerces it to verb polarity", async () => {
		const { owner } = await makeOwner([sentence(adverb("じっくり"), [adjective]), sentence(adverb("とても"), [adjective])]);
		const authority = build(owner);
		expect(evaluate(authority, bind(authority, owner, 0, 1), "じっくり")).toMatchObject({ usable: true, targetProfile: { headClass: "adjective-predicate", polarity: "not-applicable" } });
	});
	it("preserves the approved sentence modifier tradeoff and ignores the clause after comma", async () => {
		const { owner } = await makeOwner([sentence(adverb("決して"), [comma, ...negative]), sentence(adverb("もちろん"), [comma, verb]), sentence(adverb("じっくり"))]);
		const authority = build(owner), slot = bind(authority, owner, 0, 1);
		expect(evaluate(authority, slot, "決して")).toMatchObject({ usable: true, targetProfile: { headClass: "sentence-modifier", polarity: "not-applicable" } });
		expect(evaluate(authority, slot, "じっくり")).toMatchObject({ usable: false, reason: "head-class-mismatch" });
		const clause = token("秘密", "名詞", "一般");
		Object.defineProperty(clause, "isUnknown", { get: () => { throw new Error("must not read after comma"); } });
		// Prove the delegated grammar seam stops reading, rather than only testing equivalent output.
		expect(observation.observeAdverbSlot({ tokens: [adverb("もちろん"), comma, clause], index: 0 })).toMatchObject({ supported: true });
	});
	it("does not borrow another class's evidence for the same surface", async () => {
		const { owner } = await makeOwner([sentence(adverb("同じ", "一般")), sentence(adverb("同じ", "助詞類接続"), negative), sentence(adverb("別"))]);
		const authority = build(owner), slot = bind(authority, owner, 0, 2);
		expect(unwrap(evaluateManualAdverbCandidate({ authority, slot, candidate: candidate(authority, "同じ", "一般") }))).toMatchObject({ usable: true });
		expect(unwrap(evaluateManualAdverbCandidate({ authority, slot, candidate: candidate(authority, "同じ", "助詞類接続") }))).toMatchObject({ usable: false, reason: "polarity-mismatch" });
	});
});
describe("alternatives draws and lifecycle", () => {
	it("excludes current surface and counts distinct surfaces rather than records or frequency", async () => {
		const { owner } = await makeOwner([sentence(adverb("同じ")), sentence(adverb("同じ", "助詞類接続")), sentence(adverb("別")), sentence(adverb("別")), sentence(adverb("現在"))]);
		const authority = build(owner), slot = bind(authority, owner, 0, 4);
		const result = unwrap(evaluateManualAdverbSlot({ authority, slot, currentSurface: "現在" }));
		expect(result.diagnostic).toEqual({ available: true, reason: null, alternativeSurfaceCount: 2 });
		expect(result.alternatives.find(item => item.surface === "同じ")!.candidates).toHaveLength(2);
		expect(result.alternatives.map(item => item.frequency)).toEqual([2, 2]); deepFrozen(result);
	});
	it("counts a record once despite multiple observed profiles and duplicate Source handles", async () => {
		const { owner: original } = await makeOwner([[...sentence(adverb("じっくり")), ...sentence(adverb("じっくり"), [bridge, verb]), ...sentence(adverb("現在"))]], "frequency");
		const owner = morphology.buildManualMorphVocabulary({ sources: [...original.sources, ...original.sources], drawMode: "frequency" });
		const authority = build(owner), slot = bind(authority, owner, 7);
		const result = unwrap(evaluateManualAdverbSlot({ authority, slot, currentSurface: "現在" }));
		expect(result.alternatives).toHaveLength(1); expect(result.alternatives[0]!.frequency).toBe(2);
		expect(authority.observations.lookup(candidate(authority, "じっくり").identity.identityKey)!.profiles).toHaveLength(2);
	});
	it.each(["uniform", "frequency"] as const)("draws with Vocabulary %s mode without exposing the nonce", async drawMode => {
		const { owner } = await makeOwner([[...Array.from({ length: 9 }, () => sentence(adverb("多い"))).flat(), ...sentence(adverb("少ない")), ...sentence(adverb("現在"))]], drawMode);
		const authority = build(owner), slot = bind(authority, owner, 30);
		const evaluation = unwrap(evaluateManualAdverbSlot({ authority, slot, currentSurface: "現在" }));
		let frequent = 0;
		for (let nonce = 0; nonce < 1000; nonce++) {
			const chosen = unwrap(drawManualAdverbCandidate({ authority, evaluation, nonce }));
			if (chosen.record.surface === "多い") frequent++;
			expect(Object.keys(chosen).sort()).toEqual(["identity", "record"]);
		}
		expect(frequent).toBeGreaterThan(drawMode === "frequency" ? 830 : 400);
		expect(frequent).toBeLessThan(drawMode === "frequency" ? 970 : 600);
	});
	it("reports no-candidate only-current and unsupported without leaking context", async () => {
		const { owner } = await makeOwner([sentence(adverb("秘密"))]), authority = build(owner), slot = bind(authority, owner);
		expect(unwrap(evaluateManualAdverbSlot({ authority, slot, currentSurface: "秘密" })).diagnostic).toEqual({ available: false, reason: "only-current-surface", alternativeSurfaceCount: 0 });
		const target = await makeOwner([sentence(adverb("別"), [adjective])]);
		expect(unwrap(evaluateManualAdverbSlot({ authority, slot: bind(authority, target.owner), currentSurface: "別" })).diagnostic.reason).toBe("no-candidate");
	});
	it.each(["source-changed", "refresh", "apply", "view-close", "plugin-disable"] as const)("revokes the owner and delayed evaluations on %s", async reason => {
		const { owner, authority, slot } = await fixture();
		const evaluation = unwrap(evaluateManualAdverbSlot({ authority, slot, currentSurface: "ゆっくり" }));
		expect(releaseManualAdverbAuthority({ authority, reason })).toEqual({ ok: true, value: true });
		expect(createManualAdverbAuthority({ vocabulary: owner })).toEqual({ ok: false, reason: "released" });
		expect(drawManualAdverbCandidate({ authority, evaluation, nonce: 5 })).toEqual({ ok: false, reason: "released" });
		expect(evaluateManualAdverbSlot({ authority, slot, currentSurface: "ゆっくり" })).toEqual({ ok: false, reason: "released" });
		expect(morphology.isManualMorphVocabulary(owner)).toBe(true); // No cross-policy revocation.
	});
	it("rejects foreign and cloned evaluations while their owning authority is still live", async () => {
		const a = await fixture(), b = await fixture();
		const evaluation = unwrap(evaluateManualAdverbSlot({ authority: a.authority, slot: a.slot, currentSurface: "ゆっくり" }));
		for (const [authority, value] of [[b.authority, evaluation], [a.authority, { ...evaluation }]] as const)
			expect(drawManualAdverbCandidate({ authority, evaluation: value, nonce: 1 })).toEqual({ ok: false, reason: "invalid-evaluation" });
	});
	it.each([NaN, Infinity, -1, 0x100000000, 1.5, "private material"])("rejects invalid private nonce %s", async nonce => {
		const { authority, slot } = await fixture();
		const evaluation = unwrap(evaluateManualAdverbSlot({ authority, slot, currentSurface: "ゆっくり" }));
		expect(drawManualAdverbCandidate({ authority, evaluation, nonce: nonce as never })).toEqual({ ok: false, reason: "invalid-input" });
	});
	it("rejects released Target owners even with a still-live candidate authority", async () => {
		const a = await fixture(), b = await fixture(), slot = bind(a.authority, b.owner);
		releaseManualAdverbAuthority({ authority: b.authority, reason: "refresh" });
		expect(evaluateManualAdverbSlot({ authority: a.authority, slot, currentSurface: "ゆっくり" })).toEqual({ ok: false, reason: "released" });
	});
	it("returns fixed refusals for malformed envelopes throwing getters and forged states", async () => {
		const getter = Object.defineProperty({}, "vocabulary", { get: () => { throw new Error("PRIVATE"); } });
		for (const input of [null, undefined, 3, [], getter, new Proxy({}, { ownKeys: () => { throw new Error("PRIVATE"); } })]) {
			for (const api of [createManualAdverbAuthority, bindManualAdverbSlot, evaluateManualAdverbSlot, evaluateManualAdverbCandidate, manualAdverbCapabilities, drawManualAdverbCandidate, releaseManualAdverbAuthority]) {
				const result = api(input as never); expect(result.ok).toBe(false);
				expect(JSON.stringify(result)).toMatch(/^\{"ok":false,"reason":"invalid-(input|evidence)"\}$/);
			}
		}
		const { authority, slot } = await fixture();
		expect(evaluateManualAdverbSlot({ authority: structuredClone({ ...authority, observations: null }) as never, slot, currentSurface: "秘密" })).toEqual({ ok: false, reason: "invalid-authority" });
	});
	it("never inspects the prototype or properties of an attacker-thrown exception", () => {
		const thrown = new Proxy(new Error("PRIVATE"), { getPrototypeOf: () => { throw new Error("PRIVATE exception prototype"); }, get: () => { throw new Error("PRIVATE exception property"); } });
		const input = new Proxy({}, { ownKeys: () => { throw thrown; } });
		expect(createManualAdverbAuthority(input as never)).toEqual({ ok: false, reason: "invalid-evidence" });
	});
});
