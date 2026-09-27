import { afterEach, describe, expect, it, vi } from "vitest";
import * as morphology from "../src/transform/manualMorphology";
import * as adverbs from "../src/transform/manualAdverbAuthority";
import * as profile from "../src/adverb/adverbBridgeProfile";
import * as realizer from "../src/transform/maxRealizer";
import { AUTOMATIC_POS_BODY_ALGORITHM_VERSION, AUTOMATIC_POS_FINGERPRINT_VERSION, AUTOMATIC_POS_PROJECTION_VERSION, AUTOMATIC_POS_TRANSFORM_VERSION,
	releaseAutomaticPosOwner } from "../src/transform/automaticPosProjection";
import { MAX_BODY_ALGORITHM_VERSION, MAX_FINGERPRINT_VERSION, MAX_PROJECTION_VERSION, MAX_TRANSFORM_VERSION, createMaxProjection, inspectMaxProjection,
	releaseMaxOwner, requireMaxOwner } from "../src/transform/maxProjection";
import { inspectMaxResult, transformMax } from "../src/transform/maxCore";
import { ADVERB_BRIDGE_PROFILE_DATA_VERSION } from "../src/adverb/adverbBridgeProfile";
import { ALL, a, adverb, aux, body10, deepFrozen, makeOwner, noun, ok, period, prepareMax, sentence, textOwner, token, v } from "./maxCoreFixtures";
afterEach(() => vi.restoreAllMocks());

const mixed = "猫歩く。美しい。ゆっくり歩く。犬書く。高い。じっくり書く。鳥描く。楽しい。すぐ描く。";
const aruku = (surface: string, form: string, reading: string) => v(surface, "歩く", "五段・カ行イ音便", form, { reading });
/** Real readings of the inflected forms, as the shipped tokenizer reports them (distribution-pinned). */
const FIVE = { a: [aruku("歩く", "基本形", "アルク"), period, aruku("歩い", "連用タ接続", "アルイ"), aux("た"), period, aruku("歩き", "連用形", "アルキ"), aux("ます"), period],
	b: [aruku("歩か", "未然形", "アルカ"), aux("ない"), period, aruku("歩け", "仮定形", "アルケ"), token("ば", "助詞", "接続助詞"), period] };
const NO_ADVERB = [[...FIVE.a, noun("猫"), period, a("美しい", "美しい", "基本形"), period], [...FIVE.b, v("食べる", "食べる", "一段", "基本形"), period]];

describe("Automatic projection 3 ownership", () => {
	it("authenticates the exact minted owner and its own Adverb authority", async () => {
		const { owner } = await textOwner([mixed]), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		expect(requireMaxOwner(owner)).toBe(owner);
		for (const value of [{ ...owner }, structuredClone(owner), owner.snapshot, {}, null])
			expect(createMaxProjection({ vocabulary: value as never, adverbAuthority: authority })).toEqual({ ok: false, reason: "invalid-owner" });
		const equal = morphology.buildManualMorphVocabulary({ sources: owner.sources, drawMode: "uniform" });
		const foreign = ok(adverbs.createManualAdverbAuthority({ vocabulary: equal }));
		expect(createMaxProjection({ vocabulary: owner, adverbAuthority: foreign })).toEqual({ ok: false, reason: "provenance-mismatch" });
		expect(createMaxProjection({ vocabulary: owner, adverbAuthority: { ...authority } })).toEqual({ ok: false, reason: "provenance-mismatch" });
		const projection = ok(createMaxProjection({ vocabulary: owner, adverbAuthority: authority }));
		expect(ok(createMaxProjection({ vocabulary: owner, adverbAuthority: authority }))).toBe(projection);
		expect(inspectMaxProjection({ projection })).toEqual({ ok: true, value: true });
		for (const clone of [{ ...projection }, structuredClone(projection)]) expect(inspectMaxProjection({ projection: clone })).toEqual({ ok: false, reason: "invalid-projection" });
		expect(deepFrozen(projection)).toBe(true);
	});
	it("does not treat a Body 10 projection as projection 3, nor share its revocation", async () => {
		const { owner } = await textOwner([mixed]), legacy = body10(owner), max = prepareMax(owner), result = max.run();
		expect(inspectMaxProjection({ projection: legacy.projection as never })).toEqual({ ok: false, reason: "invalid-projection" });
		ok(releaseAutomaticPosOwner({ vocabulary: owner, reason: "apply" }));
		expect(inspectMaxResult({ projection: max.projection, target: max.target, result })).toEqual({ ok: true, value: true });
		ok(releaseMaxOwner({ vocabulary: owner, reason: "apply" }));
		expect(inspectMaxResult({ projection: max.projection, target: max.target, result })).toEqual({ ok: false, reason: "released" });
	});
	it("publishes all or nothing and permits a clean retry", async () => {
		const { owner } = await textOwner([mixed]), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		vi.spyOn(morphology, "readManualMorphCandidateBuckets").mockReturnValueOnce(null);
		expect(createMaxProjection({ vocabulary: owner, adverbAuthority: authority })).toEqual({ ok: false, reason: "invalid-projection" });
		const projection = ok(createMaxProjection({ vocabulary: owner, adverbAuthority: authority }));
		expect(projection.verb.lexemes.length).toBeGreaterThan(0); expect(projection.adverb.family.length).toBeGreaterThan(0);
	});
	it("closes hostile thrown values into a fixed refusal", async () => {
		const { owner } = await textOwner([mixed]), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error("PRIVATE"); }, get: () => { throw new Error("PRIVATE"); } });
		// eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise hostile non-Error exceptions without reading them.
		vi.spyOn(morphology, "readManualMorphCandidateBuckets").mockImplementation(() => { throw hostile; });
		expect(createMaxProjection({ vocabulary: owner, adverbAuthority: authority })).toEqual({ ok: false, reason: "invalid-projection" });
	});
	it("refuses an unsafe observed surface as a whole projection", async () => {
		const { owner } = await makeOwner([[v("歩​く", "歩く", "五段・カ行イ音便", "基本形"), period]]);
		const authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		expect(createMaxProjection({ vocabulary: owner, adverbAuthority: authority })).toEqual({ ok: false, reason: "invalid-projection" });
	});
});

describe("structural provenance behind a test-only authentication bypass", () => {
	async function forge(change: (snapshot: ReturnType<typeof structuredClone<morphology.ManualMorphVocabulary>>["snapshot"]) => void) {
		const { owner } = await makeOwner(NO_ADVERB), authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: owner }));
		expect(authority.candidates).toHaveLength(0);
		const sources = morphology.readManualMorphVocabularySources(owner)!, forged = structuredClone(owner);
		change(forged.snapshot);
		vi.spyOn(morphology, "isManualMorphVocabulary").mockReturnValue(true);
		vi.spyOn(adverbs, "inspectManualAdverbOwner").mockReturnValue({ ok: true, value: true });
		vi.spyOn(morphology, "readManualMorphVocabularySources").mockReturnValue(sources);
		// Strict buckets are Body 10's own evidence and are checked separately; keep them out of the way here.
		vi.spyOn(morphology, "readManualMorphCandidateBuckets").mockReturnValue([]);
		return createMaxProjection({ vocabulary: forged, adverbAuthority: authority });
	}
	type Record = morphology.ManualMorphVocabulary["snapshot"]["projections"]["manual"]["candidates"][number];
	const find = (snapshot: morphology.ManualMorphVocabulary["snapshot"], surface: string) => snapshot.projections.manual.candidates.find(item => item.surface === surface) as { -readonly [K in keyof Record]: Record[K] };
	it("accepts the unchanged clone, so each refusal below is the forgery's", async () => {
		expect((await forge(() => undefined)).ok).toBe(true);
	});
	it("accepts a structurally exact Ruby variant, so the id refusals are about exactness, not presence", async () => {
		expect((await forge(s => { find(s, "歩く").verifiedRubyVariants = [{ variantId: JSON.stringify([find(s, "歩く").displayFormId, "歩", "ある", 0, 1]),
			baseRangeInSurface: { start: 0, end: 1 }, reading: "ある", sourceNotations: [], frequency: 1, origins: find(s, "歩く").origins }]; })).ok).toBe(true);
	});
	it.each([
		["origin outside the Sources", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩い").origins = [{ path: "foreign.md", contentHash: "x", count: 1 }]; }, "provenance-mismatch"],
		["frequency not the origin sum", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩い").frequency = 2; }, "invalid-projection"],
		["duplicated origin", (s: morphology.ManualMorphVocabulary["snapshot"]) => { const r = find(s, "歩き"); r.origins = [r.origins[0]!, r.origins[0]!]; r.frequency = 2; }, "invalid-projection"],
		["form evidence rewritten under the same identity", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩か").morphology.conjugationForm = "連用形"; }, "invalid-projection"],
		["lexeme class rewritten under the same identity", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩け").morphology.conjugationType = "五段・ラ行"; }, "invalid-projection"],
		["surface detached from its token", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "食べる").surface = "食べた"; }, "invalid-projection"],
		["display identity of another surface", (s: morphology.ManualMorphVocabulary["snapshot"]) => { const r = find(s, "美しい"); r.displayFormId = find(s, "歩く").displayFormId; }, "invalid-projection"],
		["Ruby outside its surface", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩く").verifiedRubyVariants = [{ variantId: JSON.stringify([find(s, "歩く").displayFormId, find(s, "歩く").surface.slice(0, 9), "ある", 0, 9]), baseRangeInSurface: { start: 0, end: 9 }, reading: "ある", sourceNotations: [], frequency: 1, origins: find(s, "歩く").origins }]; }, "invalid-projection"],
		["Ruby of another record", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩く").verifiedRubyVariants = [{ variantId: JSON.stringify([find(s, "歩い").displayFormId, "歩", "ある", 0, 1]), baseRangeInSurface: { start: 0, end: 1 }, reading: "ある", sourceNotations: [], frequency: 1, origins: find(s, "歩く").origins }]; }, "invalid-projection"],
		["Ruby frequency above its origins", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩く").verifiedRubyVariants = [{ variantId: JSON.stringify([find(s, "歩く").displayFormId, "歩", "ある", 0, 1]), baseRangeInSurface: { start: 0, end: 1 }, reading: "ある", sourceNotations: [], frequency: 3, origins: find(s, "歩く").origins }]; }, "invalid-projection"],
		["Ruby id whose reading disagrees with the variant", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩く").verifiedRubyVariants = [{ variantId: JSON.stringify([find(s, "歩く").displayFormId, "歩", "ある", 0, 1]), baseRangeInSurface: { start: 0, end: 1 }, reading: "あ", sourceNotations: [], frequency: 1, origins: find(s, "歩く").origins }]; }, "invalid-projection"],
		["Ruby id whose base disagrees with the range", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "歩く").verifiedRubyVariants = [{ variantId: JSON.stringify([find(s, "歩く").displayFormId, "く", "ある", 0, 1]), baseRangeInSurface: { start: 0, end: 1 }, reading: "ある", sourceNotations: [], frequency: 1, origins: find(s, "歩く").origins }]; }, "invalid-projection"],
		["noun family reference to another bucket", (s: morphology.ManualMorphVocabulary["snapshot"]) => { find(s, "猫").automaticBodyKey = "名詞\u001f固有名詞"; }, "invalid-projection"],
	] as const)("refuses %s", async (_name, change, reason) => {
		expect(await forge(change)).toEqual({ ok: false, reason });
	});
	it("re-derives the whole published structure on inspection", async () => {
		const { owner } = await makeOwner(NO_ADVERB), p = prepareMax(owner);
		expect(inspectMaxProjection({ projection: p.projection })).toEqual({ ok: true, value: true });
		vi.spyOn(morphology, "readManualMorphCandidateBuckets").mockReturnValue([]);
		expect(inspectMaxProjection({ projection: p.projection })).toEqual({ ok: false, reason: "invalid-projection" });
	});
});

describe("lexeme identity, aggregation and Ruby evidence", () => {
	it("aggregates one lemma observed in five forms across two Sources into one lexeme, once per record", async () => {
		const { owner } = await makeOwner([FIVE.a, FIVE.b]), p = prepareMax(owner);
		const lexemes = p.projection.verb.lexemes.filter(item => item.input.baseForm === "歩く");
		expect(lexemes).toHaveLength(1);
		const lexeme = lexemes[0]!;
		expect(lexeme.lexemeId).toBe(JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "歩く"]));
		expect(lexeme.frequency).toBe(5);
		expect(lexeme.origins.map(origin => [origin.path, origin.count])).toEqual([["private-source-0.md", 3], ["private-source-1.md", 2]]);
		expect(lexeme.records.map(record => [record.surface, record.conjugationForm, record.reading]).sort()).toEqual([
			["歩い", "連用タ接続", "アルイ"], ["歩か", "未然形", "アルカ"], ["歩き", "連用形", "アルキ"], ["歩く", "基本形", "アルク"], ["歩け", "仮定形", "アルケ"]].sort());
		expect(new Set(lexeme.records.map(record => record.candidateId)).size).toBe(5);
		expect(new Set(lexeme.records.map(record => record.displayFormId)).size).toBe(5);
		for (const record of lexeme.records) expect(record.morphology.surface).toBe(record.surface);
		// カ行イ音便 is outside verb-irrealis-ichidan-suffix and verb-ta-stem-d: 7 of the 9 verb keys.
		expect(lexeme.realizations.map(item => item.key)).toEqual(["verb-basic", "verb-irrealis-negation", "verb-irrealis-godan-suffix", "verb-volitional-u", "verb-continuative", "verb-ta-stem-t", "verb-conditional-ba"]);
		expect(lexeme.realizations.find(item => item.key === "verb-ta-stem-t")?.surface).toBe("歩い");
	});
	it("merges several base readings into one realizer input without losing frequency, origins or Ruby", async () => {
		const hairu = v("入る", "入る", "五段・ラ行", "基本形", { reading: "ハイル" }), iru = v("入る", "入る", "五段・ラ行", "基本形", { reading: "イル" });
		const tokens = [hairu, iru, v("走っ", "走る", "五段・ラ行", "連用タ接続"), aux("た"), period];
		const source = await textOwner(["｜入《はい》る。"], tokens.filter(item => item !== iru));
		const other = await makeOwner([[iru, period, iru, period]]);
		const vocabulary = morphology.buildManualMorphVocabulary({ sources: [...source.owner.sources, ...other.owner.sources], drawMode: "frequency" });
		const target = await textOwner(["走った。"], tokens), p = prepareMax(vocabulary, target.owner);
		const lexeme = p.projection.verb.lexemes.find(item => item.input.baseForm === "入る")!;
		expect(lexeme.records.map(record => record.reading).sort()).toEqual(["イル", "ハイル"]);
		expect(lexeme.frequency).toBe(3); expect(lexeme.origins).toHaveLength(2);
		expect(lexeme.records.flatMap(record => record.verifiedRubyVariants).map(variant => variant.reading)).toEqual(["はい"]);
		const surfaces = new Set<string>(); let ruby = 0;
		for (let nonce = 0; nonce < 60; nonce++) {
			const selection = p.run(ALL, nonce, 100).selections[0]![0]!;
			surfaces.add(selection.candidate.surface);
			expect(selection.realization?.lexemeId).toBe(lexeme.lexemeId);
			if (selection.rubyVariant) { ruby++; expect(selection.candidate.displayFormId).toBe(lexeme.records.find(record => record.reading === "ハイル")!.displayFormId); }
		}
		expect([...surfaces]).toEqual(["入っ"]); expect(ruby).toBe(0); // no observed 入っ record: Ruby is never moved across surfaces
	});
	it("uses Ruby only from an observed record whose surface is the realized one", async () => {
		const tokens = [v("入る", "入る", "五段・ラ行", "基本形", { reading: "ハイル" }), v("入っ", "入る", "五段・ラ行", "連用タ接続", { reading: "ハイッ" }), v("走っ", "走る", "五段・ラ行", "連用タ接続"), aux("た"), period];
		const source = await textOwner(["｜入《はい》った。入る。"], tokens), target = await textOwner(["走った。"], tokens), p = prepareMax(source.owner, target.owner);
		const selection = p.run(ALL, 2, 100).selections[0]![0]!;
		expect(selection.candidate.surface).toBe("入っ"); expect(selection.rubyVariant?.reading).toBe("はい");
		expect(selection.candidate.candidateId).toContain("連用タ接続");
	});
});

describe("fingerprint format 3", () => {
	it("is a new envelope over the original Vocabulary fingerprint, canonical in Source order", async () => {
		const { owner } = await textOwner([mixed, "猫。書く。"]);
		const reversed = morphology.buildManualMorphVocabulary({ sources: [...owner.sources].reverse(), drawMode: "uniform" });
		const x = prepareMax(owner).projection, y = prepareMax(reversed).projection, legacy = body10(owner).projection;
		expect(x.fingerprint).toMatch(/^vocabulary-fingerprint-sha256-3:[0-9a-f]{64}$/u);
		expect(x.fingerprint).toBe(y.fingerprint);
		expect(x.fingerprint).not.toBe(owner.snapshot.fingerprint); expect(x.fingerprint).not.toBe(legacy.fingerprint);
		const frequency = morphology.buildManualMorphVocabulary({ sources: owner.sources, drawMode: "frequency" });
		expect(prepareMax(frequency).projection.fingerprint).not.toBe(x.fingerprint);
	});
	it("binds the bridge profile data and version and the closed realizer rules", async () => {
		const make = async () => prepareMax((await textOwner([mixed])).owner).projection.fingerprint;
		const first = await make(), original = profile.TO_OPTIONAL_ADVERB_BRIDGE_PROFILE;
		vi.spyOn(profile, "TO_OPTIONAL_ADVERB_BRIDGE_PROFILE", "get").mockReturnValue(Object.freeze({ ...original, dataVersion: original.dataVersion + 1 }));
		expect(await make()).not.toBe(first);
		vi.restoreAllMocks();
		vi.spyOn(profile, "TO_OPTIONAL_ADVERB_BRIDGE_PROFILE", "get").mockReturnValue(Object.freeze({ ...original, entries: Object.freeze(original.entries.slice(0, 1)) }));
		expect(await make()).not.toBe(first);
		vi.restoreAllMocks();
		const rules = realizer.MAX_REALIZER_RULES;
		vi.spyOn(realizer, "MAX_REALIZER_RULES", "get").mockReturnValue(Object.freeze({ ...rules, irregularLexemes: Object.freeze(rules.irregularLexemes.slice(0, 1)) }));
		expect(await make()).not.toBe(first);
		vi.restoreAllMocks();
		expect(await make()).toBe(first);
	});
});

describe("versions and non-interference", () => {
	it("introduces Body 11 / projection 3 / transform 3 / fingerprint 3 without moving production values", () => {
		expect([MAX_BODY_ALGORITHM_VERSION, MAX_PROJECTION_VERSION, MAX_TRANSFORM_VERSION, MAX_FINGERPRINT_VERSION])
			.toEqual([11, "automatic-body-projection-3", 3, "vocabulary-fingerprint-sha256-3"]);
		expect([AUTOMATIC_POS_BODY_ALGORITHM_VERSION, AUTOMATIC_POS_PROJECTION_VERSION, AUTOMATIC_POS_TRANSFORM_VERSION, AUTOMATIC_POS_FINGERPRINT_VERSION])
			.toEqual([10, "automatic-body-projection-2", 2, "vocabulary-fingerprint-sha256-2"]);
		expect(adverbs.MANUAL_ADVERB_POLICY_VERSION).toBe("manual-morph-3"); expect(morphology.MANUAL_MORPH_POLICY_VERSION).toBe("manual-morph-2");
		expect(ADVERB_BRIDGE_PROFILE_DATA_VERSION).toBe(1);
	});
	it("leaves Manual candidates, diagnostics and the Snapshot unchanged at every level", async () => {
		const source = await makeOwner([[...FIVE.a, adverb("じっくり"), v("書く", "書く", "五段・カ行イ音便", "基本形"), period, a("美しい", "美しい", "基本形"), period]]);
		const target = await makeOwner([sentence(adverb("ゆっくり", "助詞類接続"), [v("歩く", "歩く", "五段・カ行イ音便", "基本形")]).concat([a("高い", "高い", "基本形"), period])]);
		const snapshot = JSON.stringify(source.owner.snapshot), tokens = morphology.readManualMorphVocabularySources(target.owner)![0]!.runs[0]!.tokens;
		const authority = ok(adverbs.createManualAdverbAuthority({ vocabulary: source.owner }));
		const slot = ok(adverbs.bindManualAdverbSlot({ authority, targetVocabulary: target.owner, source: target.owner.sources[0]!,
			runId: morphology.readManualMorphVocabularySources(target.owner)![0]!.runs[0]!.run.runId, tokenIndex: 0 }));
		const manual = () => ({
			verb: morphology.evaluateManualMorphSlot({ target: tokens[1]!.token, next: tokens[2]!.token, currentSurface: tokens[1]!.token.surface, snapshot: source.owner.snapshot, evidence: source.owner.evidence }),
			adjective: morphology.evaluateManualMorphSlot({ target: tokens[3]!.token, next: tokens[4]!.token, currentSurface: tokens[3]!.token.surface, snapshot: source.owner.snapshot, evidence: source.owner.evidence }),
			adverb: adverbs.evaluateManualAdverbSlot({ authority, slot, currentSurface: "ゆっくり" }),
		});
		const before = JSON.stringify(manual()), p = prepareMax(source.owner, target.owner);
		for (let level = 0; level <= 100; level += 5) { p.run(ALL, level, level); expect(JSON.stringify(manual())).toBe(before); }
		expect(JSON.stringify(source.owner.snapshot)).toBe(snapshot);
		const verbs = (JSON.parse(before) as { verb: { candidates: { surface: string }[] } }).verb.candidates;
		expect(verbs.map(item => item.surface)).toEqual(["書く"]);
	});
});

describe("lifecycle", () => {
	it.each(["source-changed", "refresh", "apply", "view-close", "plugin-disable"] as const)("rejects %s Source and Target owners on generation and inspection", async reason => {
		for (const releaseTarget of [false, true]) {
			const source = (await textOwner([mixed])).owner, targetOwner = (await textOwner([mixed])).owner, p = prepareMax(source, targetOwner), result = p.run();
			ok(releaseMaxOwner({ vocabulary: releaseTarget ? targetOwner : source, reason }));
			const expected = { ok: false, reason: reason === "source-changed" ? "stale" : "released" };
			expect(inspectMaxResult({ projection: p.projection, target: p.target, result })).toEqual(expected);
			expect(transformMax({ projection: p.projection, target: p.target, runCount: p.target.runCount, options: ALL, bodySemantropy: 100, nonce: 1 })).toEqual(expected);
			expect(releaseMaxOwner({ vocabulary: releaseTarget ? targetOwner : source, reason })).toEqual(expected);
		}
	});
	it("honors an independent Adverb authority release, even with Adverb OFF", async () => {
		const { owner } = await textOwner([mixed]), p = prepareMax(owner), result = p.run({ noun: true, verb: false, iAdjective: false, adverb: false });
		ok(adverbs.releaseManualAdverbAuthority({ authority: p.authority, reason: "view-close" }));
		expect(inspectMaxResult({ projection: p.projection, target: p.target, result })).toEqual({ ok: false, reason: "released" });
		expect(inspectMaxProjection({ projection: p.projection })).toEqual({ ok: false, reason: "released" });
	});
	it("refuses a malformed release request without reading getters", async () => {
		const { owner } = await textOwner([mixed]);
		expect(releaseMaxOwner({ vocabulary: owner, reason: "other" as never })).toEqual({ ok: false, reason: "invalid-request" });
		const getter = { vocabulary: owner } as { vocabulary: typeof owner; reason: "apply" };
		Object.defineProperty(getter, "reason", { get: () => { throw new Error("PRIVATE"); }, enumerable: true });
		expect(releaseMaxOwner(getter)).toEqual({ ok: false, reason: "invalid-request" });
		expect(releaseMaxOwner({ vocabulary: { ...owner }, reason: "apply" })).toEqual({ ok: false, reason: "invalid-owner" });
	});
});
