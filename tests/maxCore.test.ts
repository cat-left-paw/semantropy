import { afterEach, describe, expect, it, vi } from "vitest";
import * as morphology from "../src/transform/manualMorphology";
import { bodySlotScore } from "../src/transform/slotScore";
import { maxProfileRank, type MaxProfile } from "../src/transform/maxLevel";
import { bindMaxTarget, inspectMaxProjection, inspectMaxResult, readMaxResultSlots, releaseMaxTarget, transformMax, type MaxResult } from "../src/transform/maxCore";
import { ALL, NOUN, a, adverb, aux, body10, bridge, comma, deepFrozen, legacyShape, makeOwner, negative, noun, ok, options, particle,
	period, prepareMax, sentence, textOwner, token, v } from "./maxCoreFixtures";
import { adj, lexicon, walk } from "./automaticPosFixtures";
afterEach(() => vi.restoreAllMocks());

const mixed = "猫歩く。美しい。ゆっくり歩く。犬書く。高い。じっくり書く。鳥描く。楽しい。すぐ描く。";
const RUBY_TARGET = "｜猫《ねこ》犬鳥。猫。\n\n`犬`\n\n犬。" + mixed;
type Part = "noun" | "verb" | "iAdjective" | "adverb";
const PARTS: Record<string, Part> = { 名詞: "noun", 動詞: "verb", 形容詞: "iAdjective", 副詞: "adverb" };
const partOf = (pos: string): Part | undefined => PARTS[pos];
function tokensOf(owner: morphology.ManualMorphVocabulary) { return morphology.readManualMorphVocabularySources(owner)![0]!.runs; }
function slots(p: ReturnType<typeof prepareMax>, result: MaxResult) { return ok(readMaxResultSlots({ projection: p.projection, target: p.target, result })); }

describe("level 50 is Body 10 at 100 (strict comparison oracle)", () => {
	it.each(["uniform", "frequency"] as const)("matches surfaces, slots, candidates and Ruby for Current and Selected Notes: %s", async mode => {
		let ruby = 0, compared = 0;
		for (const selected of [false, true]) {
			const target = await textOwner([RUBY_TARGET], lexicon, mode);
			const source = selected ? await textOwner(["｜星《ほし》星。｜鳥《とり》犬。書く。美しい。じっくり歩く。", "｜猫《ねこ》猫｜猫《びょう》犬。描く。楽しい。すぐ描く。"], lexicon, mode) : target;
			const oracle = body10(source.owner, target.owner), max = prepareMax(source.owner, target.owner);
			for (const nonce of [0, 1, 7, 91, 0xffffffff]) for (let bits = 0; bits < 16; bits++) {
				const expected = oracle.run(options(bits), nonce, 100), actual = max.run(options(bits), nonce, 50);
				expect(actual.tokenSurfaces).toEqual(expected.tokenSurfaces);
				expect(actual.texts).toEqual(expected.texts);
				expect(legacyShape(actual)).toEqual(expected.selections);
				expect(actual.replaceableSlotCount).toBe(expected.replaceableSlotCount);
				expect(actual.replacementCount).toBe(expected.replacementCount);
				expect(actual.selections.flat().every(selection => selection === null || selection.realization === null)).toBe(true);
				ruby += actual.selections.flat().filter(selection => selection?.rubyVariant).length; compared++;
			}
		}
		expect(compared).toBe(160); expect(ruby).toBeGreaterThan(0);
	});
	it("reproduces Body 10 at 2 x level on the strict half, slot for slot", async () => {
		const { owner } = await textOwner([mixed]), oracle = body10(owner), max = prepareMax(owner);
		for (const level of [0, 1, 13, 25, 37, 49, 50]) for (const nonce of [3, 44]) {
			const expected = oracle.run(ALL, nonce, level * 2), actual = max.run(ALL, nonce, level);
			expect(actual.tokenSurfaces).toEqual(expected.tokenSurfaces);
			expect(legacyShape(actual)).toEqual(expected.selections);
		}
	});
});

describe("level transition", () => {
	it("refuses invalid levels, nonces and options with a fixed code", async () => {
		const p = prepareMax((await textOwner([mixed])).owner);
		const input = { projection: p.projection, target: p.target, options: ALL, nonce: 1, bodySemantropy: 50, runCount: 1 };
		for (const change of [{ bodySemantropy: -1 }, { bodySemantropy: 101 }, { bodySemantropy: 50.5 }, { bodySemantropy: NaN }, { bodySemantropy: "50" },
			{ bodySemantropy: null }, { nonce: -1 }, { nonce: 2 ** 32 }, { nonce: 1.5 }, { options: {} }, { options: { ...ALL, adverb: 1 } }, { runCount: 2 }, { runCount: -1 }, { extra: 1 }])
			expect(transformMax({ ...input, ...change } as never)).toEqual({ ok: false, reason: "invalid-request" });
		const getter = { ...input }; Object.defineProperty(getter, "bodySemantropy", { get: () => { throw new Error("PRIVATE"); } });
		expect(transformMax(getter)).toEqual({ ok: false, reason: "invalid-request" });
		for (let level = 0; level <= 100; level++) expect(transformMax({ ...input, bodySemantropy: level }).ok).toBe(true);
	});
	it.each(["uniform", "frequency"] as const)("never lowers a slot's profile as the level rises, for every integer: %s", async mode => {
		const extra = [...lexicon, walk("書い", { baseForm: "書く", conjugationForm: "連用タ接続" }), adj("美しかっ", { baseForm: "美しい", conjugationForm: "連用タ接続" })];
		const source = await textOwner([mixed + "星。書い。美しかっ。", "｜猫《ねこ》猫犬。描く。楽しい。すぐ描く。"], extra, mode);
		const target = await textOwner([mixed + mixed], lexicon, mode), p = prepareMax(source.owner, target.owner);
		let moved = 0;
		for (const nonce of [0, 5, 77]) {
			let previous: { result: MaxResult; profiles: readonly (readonly (MaxProfile | null)[])[] } | null = null;
			for (let level = 0; level <= 100; level++) {
				const result = p.run(ALL, nonce, level), profiles = slots(p, result).profiles;
				if (level === 0) expect(result.replacementCount).toBe(0);
				if (level >= 50) expect(result.replacementCount).toBe(result.replaceableSlotCount);
				for (const run of profiles) for (const profile of run) if (profile) {
					if (level <= 50) expect(profile).toBe("strict");
					if (level === 75) expect(profile).toBe("high");
					if (level === 100) expect(profile).toBe("max");
				}
				if (previous) {
					const before = previous;
					// The contract is profile rank. Candidate sets are not nested, so a slot may lose its only candidate at High.
					before.profiles.forEach((run, i) => run.forEach((was, j) => {
						const now = profiles[i]![j];
						expect(now === null).toBe(was === null);
						if (was) {
							expect(maxProfileRank(now!)).toBeGreaterThanOrEqual(maxProfileRank(was));
							if (now !== was) moved++;
						}
					}));
				}
				previous = { result, profiles };
			}
		}
		expect(moved).toBeGreaterThan(0);
	});
	it("moves slots strict -> High across 50..75 and High -> MAX across 75..100, slot by slot", async () => {
		const { owner } = await textOwner([mixed.repeat(4)]), p = prepareMax(owner);
		const shares = [50, 55, 62, 70, 75, 80, 88, 95, 100].map(level => {
			const profiles = slots(p, p.run(ALL, 9, level)).profiles.flat().filter(Boolean);
			return { level, high: profiles.filter(item => item === "high").length / profiles.length, max: profiles.filter(item => item === "max").length / profiles.length };
		});
		expect(shares[0]).toEqual({ level: 50, high: 0, max: 0 });
		expect(shares[4]).toEqual({ level: 75, high: 1, max: 0 });
		expect(shares[8]).toEqual({ level: 100, high: 0, max: 1 });
		expect(shares[2]!.high).toBeGreaterThan(0); expect(shares[2]!.high).toBeLessThan(1);
		expect(shares[6]!.max).toBeGreaterThan(0); expect(shares[6]!.max).toBeLessThan(1);
	});
	it("uses Body 10's positional application score at twice the level", async () => {
		const { owner } = await textOwner([mixed]), p = prepareMax(owner);
		const full = p.run(ALL, 13, 50), quarter = p.run(ALL, 13, 25);
		full.selections.forEach((run, i) => run.forEach((selection, j) => {
			const applied = bodySlotScore(13, { sequenceIndex: i, tokenIndex: j }) / 4294967296 < .5;
			expect(legacyShape(quarter)[i]![j]).toEqual(applied && selection ? { candidate: selection.candidate, rubyVariant: selection.rubyVariant } : null);
		}));
	});
});

/** Verb / adjective Target covering every Target form key; Sources hold basic forms only. */
const TARGET_FORMS = [
	v("歩い", "歩く", "五段・カ行イ音便", "連用タ接続"), aux("た"), period,
	v("急い", "急ぐ", "五段・ガ行", "連用タ接続"), aux("だ"), period,
	v("歩か", "歩く", "五段・カ行イ音便", "未然形"), token("せる", "動詞", "接尾"), period,
	v("着", "着る", "一段", "未然形"), token("させる", "動詞", "接尾"), period,
	v("歩こ", "歩く", "五段・カ行イ音便", "未然ウ接続"), aux("う"), period,
	v("歩け", "歩く", "五段・カ行イ音便", "仮定形"), particle("ば"), period,
	v("歩き", "歩く", "五段・カ行イ音便", "連用形"), aux("ます"), period,
	v("歩く", "歩く", "五段・カ行イ音便", "基本形"), period,
	v("歩か", "歩く", "五段・カ行イ音便", "未然形"), aux("ない"), period,
	a("高く", "高い", "連用テ接続", "形容詞・アウオ段"), particle("て"), period,
	a("高かっ", "高い", "連用タ接続", "形容詞・アウオ段"), aux("た"), period,
	a("高けれ", "高い", "仮定形", "形容詞・アウオ段"), particle("ば"), period,
	a("高い", "高い", "基本形", "形容詞・アウオ段"), period,
];
const SLOT = { taT: 0, taD: 3, godan: 6, ichidan: 9, volitional: 12, conditional: 15, continuative: 18, basic: 21, negation: 23, ku: 26, katta: 29, kereba: 32, adjBasic: 35 };
const BASIC_SOURCE = [v("書く", "書く", "五段・カ行イ音便", "基本形"), period, v("食べる", "食べる", "一段", "基本形"), period, v("話す", "話す", "五段・サ行", "基本形"), period,
	v("泳ぐ", "泳ぐ", "五段・ガ行", "基本形"), period, v("飛ぶ", "飛ぶ", "五段・バ行", "基本形"), period, v("ある", "ある", "五段・ラ行", "基本形"), period,
	v("へる", "へるる", "一段", "連用形"), aux("た"), period, v("する", "する", "サ変・スル", "基本形"), period,
	a("美しい", "美しい", "基本形"), period, a("早い", "早い", "基本形", "形容詞・アウオ段"), period];
const ADJECTIVE_MAX = { ku: ["美しく", "早く"], katta: ["美しかっ", "早かっ"], kereba: ["美しけれ", "早けれ"], adjBasic: ["美しい", "早い"] };
const MAX_EXPECTED: Record<keyof typeof SLOT, string[]> = {
	taT: ["書い", "食べ", "話し"], taD: ["泳い", "飛ん"], godan: ["書か", "話さ", "泳が", "飛ば"], ichidan: ["食べ"],
	volitional: ["書こ", "食べよ", "話そ", "泳ご", "飛ぼ"], conditional: ["書け", "食べれ", "話せ", "泳げ", "飛べ"],
	continuative: ["書き", "食べ", "話し", "泳ぎ", "飛び"], basic: ["書く", "食べる", "話す", "泳ぐ", "飛ぶ"], negation: ["書か", "食べ", "話さ", "泳が", "飛ば"],
	...ADJECTIVE_MAX,
};
const HIGH_EXPECTED: Record<keyof typeof SLOT, string[]> = {
	taT: ["書い"], taD: ["泳い"], godan: ["書か"], ichidan: ["食べ"], volitional: ["書こ"], conditional: ["書け"], continuative: ["書き"],
	basic: ["書く"], negation: ["書か"], ...ADJECTIVE_MAX,
};
function produced(p: ReturnType<typeof prepareMax>, level: number, nonces = 160) {
	const seen = new Map<number, Set<string>>();
	for (let nonce = 0; nonce < nonces; nonce++) p.run(ALL, nonce, level).selections[0]!.forEach((selection, j) => {
		if (!selection) return;
		const set = seen.get(j) ?? new Set<string>(); set.add(selection.candidate.surface); seen.set(j, set);
	});
	return (slot: number) => [...(seen.get(slot) ?? [])].sort();
}
describe("verb and i-adjective profiles through the closed realizer", () => {
	it("builds every Target form key from basic-form Sources at MAX, and only the verified family at High", async () => {
		const source = await makeOwner([BASIC_SOURCE]), target = await makeOwner([TARGET_FORMS]), p = prepareMax(source.owner, target.owner);
		const max = produced(p, 100), high = produced(p, 75), strict = produced(p, 50, 16);
		for (const [name, index] of Object.entries(SLOT) as [keyof typeof SLOT, number][]) {
			expect(max(index), name).toEqual([...MAX_EXPECTED[name]].sort());
			expect(high(index), name).toEqual([...HIGH_EXPECTED[name]].sort());
		}
		// strict is Body 10: only observed basic forms before 。 match the Target's own basic forms exactly.
		expect(Object.values(SLOT).filter(index => strict(index).length)).toEqual([SLOT.basic, SLOT.adjBasic]);
		expect(strict(SLOT.basic)).toEqual(["書く"]);
	});
	it("never builds 泳いた / 書いだ / 食べせる / 書かさせる, the suppletive or artifact lexemes, or 〜くっ", async () => {
		const source = await makeOwner([BASIC_SOURCE]), target = await makeOwner([TARGET_FORMS]), p = prepareMax(source.owner, target.owner);
		for (let nonce = 0; nonce < 200; nonce++) {
			const result = p.run(ALL, nonce, 100), text = result.texts.join("");
			expect(text).not.toMatch(/泳いた|飛んた|書いだ|食べだ|話しだ|食べせる|書かさせる|へるる|あら|ある|あっ|くって/u);
			for (const selection of result.selections[0]!) if (selection) expect(selection.candidate.surface).not.toMatch(/くっ$|^へる|^あ/u);
		}
		const lexemes = p.projection.verb.lexemes.map(item => item.input.baseForm);
		expect(lexemes).not.toContain("ある"); expect(lexemes).not.toContain("へるる"); expect(lexemes).not.toContain("する");
	});
	it("never re-injects a strict candidate outside the safe set: High / MAX keep the original when no safe candidate exists", async () => {
		for (const [observed, base, type, form, follower, targetSurface, targetBase] of [
			["あっ", "ある", "五段・ラ行", "連用タ接続", "た", "走っ", "走る"], ["へる", "へるる", "一段", "連用形", "た", "食べ", "食べる"],
		] as const) {
			const source = await makeOwner([[v(observed, base, type, form), aux(follower), period]]);
			const target = await makeOwner([[v(targetSurface, targetBase, type, form), aux(follower), period]]), p = prepareMax(source.owner, target.owner);
			// strict is Body 10: the observed exact form with the same connection.
			expect(p.run(ALL, 3, 50).tokenSurfaces[0]![0]).toBe(observed);
			for (const level of [75, 88, 100]) for (const nonce of [1, 2, 3]) {
				const result = p.run(ALL, nonce, level);
				expect(result.tokenSurfaces[0]![0]).toBe(targetSurface);
				expect(result.replaceableSlotCount).toBe(0);
			}
		}
	});
	it("records the lexeme and form key, and takes identity and Ruby only from an exactly matching observed record", async () => {
		const tokens = [v("書い", "書く", "五段・カ行イ音便", "連用タ接続"), v("書く", "書く", "五段・カ行イ音便", "基本形"), v("歩い", "歩く", "五段・カ行イ音便", "連用タ接続"), aux("た"), period];
		const target = await textOwner(["歩いた。"], tokens);
		const observed = prepareMax((await textOwner(["｜書《か》いた。"], tokens)).owner, target.owner).run(ALL, 1, 100).selections[0]![0]!;
		expect(observed.candidate.surface).toBe("書い"); expect(observed.rubyVariant?.reading).toBe("か");
		expect(observed.realization).toEqual({ lexemeId: JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "書く"]), formKey: "verb-ta-stem-t" });
		expect(observed.candidate.candidateId).toContain("連用タ接続");
		const built = prepareMax((await textOwner(["｜書《か》く。"], tokens)).owner, target.owner).run(ALL, 1, 100).selections[0]![0]!;
		expect(built.candidate.surface).toBe("書い"); expect(built.rubyVariant).toBeNull();
		expect(built.candidate.candidateId).toBe(JSON.stringify(["動詞", "自立", "五段・カ行イ音便", "書く"]));
		expect(built.candidate.displayFormId).toBe(JSON.stringify([built.candidate.candidateId, "書い"]));
	});
	it("carries a strict record whose lexeme is realizable by that lexeme, never counting it twice", async () => {
		const source = await makeOwner([[v("書い", "書く", "五段・カ行イ音便", "連用タ接続"), aux("た"), period, v("食べる", "食べる", "一段", "基本形"), period]]);
		const target = await makeOwner([[v("歩い", "歩く", "五段・カ行イ音便", "連用タ接続"), aux("た"), period]]), p = prepareMax(source.owner, target.owner);
		for (let nonce = 0; nonce < 80; nonce++) {
			const selection = p.run(ALL, nonce, 100).selections[0]![0]!;
			expect(selection.realization, selection.candidate.surface).not.toBeNull();
		}
		expect(p.run(ALL, 1, 50).selections[0]![0]!.realization).toBeNull(); // strict: Body 10's observed record
	});
	it("draws each High / MAX slot from its own slot identity only", async () => {
		const source = await makeOwner([BASIC_SOURCE]);
		const eligibleFirst = await makeOwner([[v("歩い", "歩く", "五段・カ行イ音便", "連用タ接続"), aux("た"), period, v("歩く", "歩く", "五段・カ行イ音便", "基本形"), period]]);
		const ineligibleFirst = await makeOwner([[v("来", "来る", "カ変・来ル", "連用形"), aux("た"), period, v("歩く", "歩く", "五段・カ行イ音便", "基本形"), period]]);
		const x = prepareMax(source.owner, eligibleFirst.owner), y = prepareMax(source.owner, ineligibleFirst.owner);
		let differentFirst = 0;
		for (let nonce = 0; nonce < 60; nonce++) for (const level of [75, 100]) {
			const a = x.run(ALL, nonce, level), b = y.run(ALL, nonce, level);
			expect(b.selections[0]![0]).toBeNull();
			expect(b.selections[0]![3]).toEqual(a.selections[0]![3]);
			if (a.selections[0]![0]) differentFirst++;
		}
		expect(differentFirst).toBe(120);
	});
	it("weights realized lexemes by the frequency of every contributing record, once", async () => {
		const many = Array.from({ length: 30 }, () => [v("書く", "書く", "五段・カ行イ音便", "基本形"), period]).flat();
		const source = await makeOwner([[...many, v("食べる", "食べる", "一段", "基本形"), period]], "frequency");
		const target = await makeOwner([[v("歩い", "歩く", "五段・カ行イ音便", "連用タ接続"), aux("た"), period]]);
		const p = prepareMax(source.owner, target.owner); let written = 0;
		for (let nonce = 0; nonce < 200; nonce++) if (p.run(ALL, nonce, 100).tokenSurfaces[0]![0] === "書い") written++;
		expect(written).toBeGreaterThan(170);
	});
	it("never crosses parts of speech at any level", async () => {
		const source = await makeOwner([[...BASIC_SOURCE, noun("猫"), period, adverb("じっくり"), v("歩く", "歩く", "五段・カ行イ音便", "基本形"), period]]);
		const target = await makeOwner([[...TARGET_FORMS, noun("犬"), period, adverb("ゆっくり", "助詞類接続"), v("書く", "書く", "五段・カ行イ音便", "基本形"), period]]);
		const p = prepareMax(source.owner, target.owner), tokens = tokensOf(target.owner)[0]!.tokens;
		const adjectives = Object.values(ADJECTIVE_MAX).flat();
		const allowed: Record<Part, Set<string>> = { noun: new Set(["猫"]), adverb: new Set(["じっくり"]),
			verb: new Set([...Object.values(MAX_EXPECTED).flat().filter(surface => !adjectives.includes(surface)), "歩く"]), iAdjective: new Set(adjectives) };
		let checked = 0;
		for (const level of [50, 62, 75, 88, 100]) for (let nonce = 0; nonce < 40; nonce++) p.run(ALL, nonce, level).selections[0]!.forEach((selection, j) => {
			if (!selection) return;
			const part = partOf(tokens[j]!.token.pos)!;
			expect(allowed[part].has(selection.candidate.surface), `${part} ${selection.candidate.surface}`).toBe(true);
			checked++;
		});
		expect(checked).toBeGreaterThan(1000);
	});
});

describe("noun profiles", () => {
	const SOURCE = [noun("猫"), period, noun("東京", "固有名詞", { detail2: "地域" }), period, noun("勉強", "サ変接続"), period, noun("静か", "形容動詞語幹"), period,
		noun("彼", "代名詞"), period, noun("こと", "非自立"), period, noun("ｘ", "一般", { isUnknown: true }), period, noun("三", "数"), period, noun("的", "接尾"), period];
	it("keeps Body 10's bucket at strict and relaxes to the automatic-body family only, at High = MAX", async () => {
		const source = await makeOwner([SOURCE]), target = await makeOwner([[noun("犬"), period]]), p = prepareMax(source.owner, target.owner);
		const surfaces = (level: number) => [...new Set(Array.from({ length: 120 }, (_, nonce) => p.run(NOUN, nonce, level).tokenSurfaces[0]![0]))].sort();
		expect(surfaces(50)).toEqual(["猫"]);
		expect(surfaces(75)).toEqual(["勉強", "東京", "猫", "静か"].sort());
		expect(surfaces(100)).toEqual(surfaces(75));
		expect(p.projection.noun.family.map(item => item.surface).sort()).toEqual(["勉強", "東京", "猫", "静か"].sort());
		const projected = new Set(source.owner.snapshot.projections.automaticBody.buckets.flatMap(bucket => bucket.surfaces.map(item => item.surface)));
		for (const item of p.projection.noun.family) expect(projected.has(item.surface)).toBe(true);
	});
	it("does not treat an ineligible Target noun as a slot at any level", async () => {
		const source = await makeOwner([SOURCE]), target = await makeOwner([[noun("彼", "代名詞"), period, noun("こと", "非自立"), period, noun("三", "数"), period]]);
		const p = prepareMax(source.owner, target.owner);
		for (const level of [50, 75, 100]) expect(p.run(ALL, 1, level).replaceableSlotCount).toBe(0);
	});
});

describe("adverb profiles", () => {
	const ADVERB_ONLY = { noun: false, verb: false, iAdjective: false, adverb: true };
	const walkV = v("歩く", "歩く", "五段・カ行イ音便", "基本形");
	async function at(sources: readonly (readonly ReturnType<typeof token>[])[], target: readonly ReturnType<typeof token>[]) {
		const source = await makeOwner(sources), owner = await makeOwner([target]), p = prepareMax(source.owner, owner.owner);
		return (level: number) => [...new Set(Array.from({ length: 80 }, (_, nonce) => p.run(ADVERB_ONLY, nonce, level).tokenSurfaces[0]![0]))].sort();
	}
	it("strict keeps head class; High drops it; the Target keeps its own tokens", async () => {
		const surfaces = await at([sentence(adverb("じっくり"), [a("美しい", "美しい", "基本形")])], sentence(adverb("ゆっくり", "助詞類接続"), [walkV]));
		expect(surfaces(50)).toEqual(["ゆっくり"]); expect(surfaces(75)).toEqual(["じっくり"]); expect(surfaces(100)).toEqual(["じっくり"]);
	});
	it("High drops polarity and bridge capability; the external と stays and is never duplicated", async () => {
		const polarity = await at([sentence(adverb("じっくり"), negative)], sentence(adverb("ゆっくり", "助詞類接続"), [walkV]));
		expect(polarity(50)).toEqual(["ゆっくり"]); expect(polarity(75)).toEqual(["じっくり"]);
		const source = await makeOwner([sentence(adverb("すぐ", "助詞類接続"), [walkV]), sentence(adverb("そっと"), [walkV])]);
		const owner = await makeOwner([sentence(adverb("ゆっくり", "助詞類接続"), [bridge, walkV])]), p = prepareMax(source.owner, owner.owner);
		for (const level of [50, 75, 100]) for (let nonce = 0; nonce < 60; nonce++) {
			const result = p.run(ALL, nonce, level);
			expect(result.tokenSurfaces[0]!.slice(1)).toEqual(["と", "歩く", "。"]);
			expect(result.texts[0]).not.toContain("そっとと");
			expect(result.tokenSurfaces[0]![0]).toBe(level === 50 ? "ゆっくり" : "すぐ");
		}
	});
	it("High requires a genuine Source observation; MAX takes any safe Source-derived regular adverb", async () => {
		const surfaces = await at([sentence(adverb("じっくり"), [walkV]), [adverb("もっと"), noun("猫"), period]], sentence(adverb("ゆっくり", "助詞類接続"), [walkV]));
		expect(surfaces(75)).toEqual(["じっくり"]); expect(surfaces(100)).toEqual(["じっくり", "もっと"]);
	});
	it("keeps the approved sentence-modifier comma rule, and never promotes 名詞-副詞可能", async () => {
		const sentenceHead = await at([sentence(adverb("決して"), [comma, ...negative])], sentence(adverb("もちろん"), [comma, walkV]));
		expect(sentenceHead(50)).toEqual(["決して"]);
		const promoted = await at([sentence(token("じっくり", "名詞", "副詞可能"), [walkV])], sentence(adverb("ゆっくり", "助詞類接続"), [walkV]));
		for (const level of [50, 75, 100]) expect(promoted(level)).toEqual(["ゆっくり"]);
	});
	it("needs no head or polarity observation at High / MAX: only a safe adverb Target and its following token", async () => {
		const surfaces = await at([sentence(adverb("じっくり"), [walkV]), [adverb("もっと"), noun("猫"), period]], [adverb("ゆっくり", "助詞類接続"), noun("猫"), period]);
		expect(surfaces(50)).toEqual(["ゆっくり"]); // strict still requires the full observation
		expect(surfaces(75)).toEqual(["じっくり"]); expect(surfaces(100)).toEqual(["じっくり", "もっと"]);
	});
	it("refuses a lexical と only before a following token that is exactly と, so とても stays open", async () => {
		const source = await makeOwner([sentence(adverb("そっと"), [walkV]), [adverb("意外と"), noun("猫"), period]]);
		const target = await makeOwner([[adverb("ゆっくり", "助詞類接続"), adverb("とても"), a("美しい", "美しい", "基本形"), period]]);
		const p = prepareMax(source.owner, target.owner), seen = new Set<string>();
		for (const level of [75, 100]) for (let nonce = 0; nonce < 60; nonce++) {
			// とても is itself an adverb slot and may change too; the guard reads the Target's own following token.
			const result = p.run(ADVERB_ONLY, nonce, level);
			expect(result.tokenSurfaces[0]!.slice(2)).toEqual(["美しい", "。"]);
			seen.add(result.tokenSurfaces[0]![0]!);
		}
		expect([...seen].sort()).toEqual(["そっと", "意外と"].sort());
	});
	it("never places a lexical と before any following と, bridge or not, and keeps the Target's tokens", async () => {
		const quote = token("と", "助詞", "格助詞", { detail2: "引用" }), said = v("言っ", "言う", "五段・ワ行促音便", "連用タ接続");
		const source = await makeOwner([sentence(adverb("すぐ", "助詞類接続"), [walkV]), sentence(adverb("そっと"), [walkV]), [adverb("意外と"), noun("猫"), period]]);
		const target = await makeOwner([[adverb("ゆっくり", "助詞類接続"), quote, said, aux("た"), period]]), p = prepareMax(source.owner, target.owner);
		const seen = new Set<string>();
		for (const level of [50, 75, 100]) for (let nonce = 0; nonce < 60; nonce++) {
			const result = p.run(ADVERB_ONLY, nonce, level);
			expect(result.tokenSurfaces[0]!.slice(1)).toEqual(["と", "言っ", "た", "。"]);
			expect(result.texts[0]).not.toMatch(/とと/u);
			if (level === 50) expect(result.tokenSurfaces[0]![0]).toBe("ゆっくり"); else seen.add(result.tokenSurfaces[0]![0]!);
		}
		expect([...seen]).toEqual(["すぐ"]);
	});
});

describe("draw-domain isolation", () => {
	it.each(["uniform", "frequency"] as const)("every option combination changes only its own part, at every profile: %s", async mode => {
		const { owner, calls } = await textOwner([mixed + "星。"], lexicon, mode), p = prepareMax(owner), before = calls(), runs = tokensOf(owner);
		for (const level of [0, 25, 50, 60, 75, 88, 100]) for (const nonce of [0, 4]) {
			const full = p.run(ALL, nonce, level);
			for (let bits = 0; bits < 16; bits++) {
				const flags = options(bits), result = p.run(flags, nonce, level);
				for (const [i, run] of runs.entries()) for (const [j, item] of run.tokens.entries()) {
					const part = partOf(item.token.pos);
					expect(result.tokenSurfaces[i]![j]).toBe(part && flags[part] ? full.tokenSurfaces[i]![j] : item.token.surface);
					if (part && flags[part]) expect(result.selections[i]![j]).toEqual(full.selections[i]![j]);
				}
				if (!bits) expect(result.replaceableSlotCount).toBe(0);
			}
		}
		expect(calls()).toBe(before);
	});
	it.each(["uniform", "frequency"] as const)("candidate counts in one part never shift another part's application, profile, surface, identity or Ruby: %s", async mode => {
		const target = await textOwner([mixed], lexicon, mode), base = await textOwner([mixed], lexicon, mode), first = prepareMax(base.owner, target.owner);
		const extras: [string, ReturnType<typeof token>[]][] = [["星星星。", [noun("星")]], ["削く。削く。", [walk("削く")]], ["赤い。赤い。", [adj("赤い")]], ["はっきり、はっきり、", [adverb("はっきり"), comma]]];
		const tokens = tokensOf(target.owner)[0]!.tokens;
		for (const [partIndex, [extra, added]] of extras.entries()) {
			const changed = prepareMax((await textOwner([mixed + extra], [...lexicon, ...added], mode)).owner, target.owner);
			for (const level of [30, 50, 66, 75, 90, 100]) for (const nonce of [0, 13]) {
				const expected = first.run(ALL, nonce, level), actual = changed.run(ALL, nonce, level);
				const expectedProfiles = slots(first, expected).profiles[0]!, actualProfiles = slots(changed, actual).profiles[0]!;
				for (const [i, item] of tokens.entries()) if (item.token.pos !== ["名詞", "動詞", "形容詞", "副詞"][partIndex]) {
					expect(actual.selections[0]![i]).toEqual(expected.selections[0]![i]);
					expect(actualProfiles[i]).toBe(expectedProfiles[i]);
				}
			}
		}
	});
	it("keeps identity out of the High / MAX surface draw and never shifts another slot", async () => {
		// A second identity for an existing surface (a different reading) cannot move any surface in Uniform mode.
		const target = await makeOwner([[v("歩く", "歩く", "五段・カ行イ音便", "基本形"), period, v("読む", "読む", "五段・マ行", "基本形"), period]]);
		const plain = [v("描く", "描く", "五段・カ行イ音便", "基本形"), period, v("書く", "書く", "五段・カ行イ音便", "基本形"), period, v("飲む", "飲む", "五段・マ行", "基本形"), period];
		const one = prepareMax((await makeOwner([plain])).owner, target.owner);
		const two = prepareMax((await makeOwner([[...plain, v("描く", "描く", "五段・カ行イ音便", "基本形", { reading: "エガク" }), period]])).owner, target.owner);
		let identities = 0;
		for (let nonce = 0; nonce < 60; nonce++) for (const level of [75, 100]) {
			const x = one.run(ALL, nonce, level), y = two.run(ALL, nonce, level);
			expect(y.tokenSurfaces).toEqual(x.tokenSurfaces);
			y.selections[0]!.forEach((selection, j) => {
				const before = x.selections[0]![j];
				// Only the 描く evidence record may differ: one lexeme, two observed records with that exact surface.
				if (selection?.candidate.surface !== "描く") { expect(selection).toEqual(before); return; }
				expect(selection.realization).toEqual(before!.realization);
				if (selection.candidate.candidateId !== before!.candidate.candidateId) { identities++; expect(selection.candidate.candidateId).toContain("エガク"); }
			});
		}
		expect(identities).toBeGreaterThan(0);
	});
});

describe("Current Note, Selected Notes, Source order and run prefixes", () => {
	it.each(["uniform", "frequency"] as const)("produces canonical results regardless of Source arrival order: %s", async mode => {
		const { owner } = await textOwner([mixed, "猫猫。書く。じっくり書く。"], lexicon, mode);
		const reversed = morphology.buildManualMorphVocabulary({ sources: [...owner.sources].reverse(), drawMode: mode });
		const x = prepareMax(owner, owner), y = prepareMax(reversed, owner);
		expect(x.projection).toEqual(y.projection); expect(x.projection.fingerprint).toBe(y.projection.fingerprint);
		for (const level of [25, 50, 60, 75, 100]) for (const flags of [ALL, NOUN, { ...ALL, noun: false }]) expect(x.run(flags, 8, level)).toEqual(y.run(flags, 8, level));
	});
	it("extends a canonical run prefix without changing earlier runs or re-tokenizing", async () => {
		const { owner, calls } = await textOwner([`${mixed}\n\n${mixed}\n\n${mixed}`]), p = prepareMax(owner), before = calls();
		expect(p.target.runCount).toBe(3);
		for (const level of [20, 50, 70, 100]) {
			const full = p.run(ALL, 21, level);
			for (let count = 0; count <= 3; count++) {
				const prefix = p.run(ALL, 21, level, count);
				expect(prefix.runIds).toEqual(full.runIds.slice(0, count));
				expect(prefix.tokenSurfaces).toEqual(full.tokenSurfaces.slice(0, count));
				expect(prefix.selections).toEqual(full.selections.slice(0, count));
			}
		}
		const spy = vi.spyOn(morphology, "evaluateManualMorphSlot");
		expect(p.run(ALL, 0, 100, 0).texts).toEqual([]); expect(spy).not.toHaveBeenCalled();
		expect(calls()).toBe(before);
	});
	it("excludes the authenticated displayed surface on a repeated shuffle at every profile", async () => {
		const { owner } = await textOwner([mixed + mixed]), p = prepareMax(owner);
		for (const level of [50, 75, 100]) {
			const current = p.run(ALL, 13, level), next = p.run(ALL, 13, level, p.target.runCount, current);
			next.selections.forEach((run, i) => run.forEach((selection, j) => { if (selection) expect(selection.candidate.surface).not.toBe(current.tokenSurfaces[i]![j]); }));
			expect(transformMax({ projection: p.projection, target: p.target, runCount: p.target.runCount, options: ALL, nonce: 13, bodySemantropy: level, current })).toEqual({ ok: false, reason: "stale" });
		}
	});
});

describe("owned lifecycle and generation seals", () => {
	it("rejects forged, foreign and cloned Target handles, projections and results", async () => {
		const { owner } = await textOwner([mixed]), x = prepareMax(owner), y = prepareMax((await textOwner([mixed])).owner);
		const input = { projection: x.projection, target: x.target, options: ALL, nonce: 1, bodySemantropy: 100, runCount: x.target.runCount };
		for (const target of [{ ...x.target }, structuredClone(x.target), y.target, {}]) expect(transformMax({ ...input, target: target as never }).ok).toBe(false);
		expect(transformMax({ ...input, target: y.target })).toEqual({ ok: false, reason: "provenance-mismatch" });
		for (const projection of [{ ...x.projection }, structuredClone(x.projection)]) expect(transformMax({ ...input, projection })).toEqual({ ok: false, reason: "invalid-projection" });
		const old = x.run(), latest = x.run(NOUN), check = (result: MaxResult) => inspectMaxResult({ projection: x.projection, target: x.target, result });
		expect(check(old)).toEqual({ ok: false, reason: "stale" }); expect(check(latest)).toEqual({ ok: true, value: true });
		expect(check({ ...latest })).toEqual({ ok: false, reason: "provenance-mismatch" });
		expect(check(structuredClone(latest))).toEqual({ ok: false, reason: "provenance-mismatch" });
		expect(inspectMaxResult({ projection: y.projection, target: y.target, result: latest })).toEqual({ ok: false, reason: "provenance-mismatch" });
		expect(transformMax({ ...input, current: { ...latest } })).toEqual({ ok: false, reason: "provenance-mismatch" });
		expect(transformMax({ ...input, current: old })).toEqual({ ok: false, reason: "stale" });
	});
	it("retires one bound Target without revoking its owner, and rebinding mints a fresh handle", async () => {
		const { owner } = await textOwner([mixed, mixed]), p = prepareMax(owner), result = p.run();
		const other = ok(bindMaxTarget({ projection: p.projection, targetVocabulary: owner, source: owner.sources[1]! }));
		expect(releaseMaxTarget({ projection: p.projection, target: p.target, reason: "other" as never })).toEqual({ ok: false, reason: "invalid-request" });
		expect(releaseMaxTarget({ projection: p.projection, target: p.target, reason: "apply" })).toEqual({ ok: true, value: true });
		expect(inspectMaxResult({ projection: p.projection, target: p.target, result })).toEqual({ ok: false, reason: "released" });
		expect(transformMax({ projection: p.projection, target: p.target, runCount: 1, options: ALL, nonce: 1, bodySemantropy: 60 })).toEqual({ ok: false, reason: "released" });
		expect(releaseMaxTarget({ projection: p.projection, target: p.target, reason: "apply" })).toEqual({ ok: false, reason: "released" });
		const fresh = ok(bindMaxTarget({ projection: p.projection, targetVocabulary: owner, source: owner.sources[0]! }));
		expect(fresh).not.toBe(p.target);
		const again = ok(transformMax({ projection: p.projection, target: fresh, runCount: fresh.runCount, options: ALL, nonce: 13, bodySemantropy: 100 }));
		expect(again.tokenSurfaces).toEqual(result.tokenSurfaces);
		expect(transformMax({ projection: p.projection, target: other, runCount: 1, options: ALL, nonce: 1, bodySemantropy: 60 }).ok).toBe(true);
		expect(inspectMaxProjection({ projection: p.projection })).toEqual({ ok: true, value: true });
	});
	it("does not accept a Body 10 result, projection or Target in place of MAX ones", async () => {
		const { owner } = await textOwner([mixed]), legacy = body10(owner), max = prepareMax(owner), result = legacy.run();
		expect(transformMax({ projection: legacy.projection as never, target: max.target, options: ALL, nonce: 1, bodySemantropy: 50, runCount: 1 })).toEqual({ ok: false, reason: "invalid-projection" });
		expect(transformMax({ projection: max.projection, target: legacy.target, options: ALL, nonce: 1, bodySemantropy: 50, runCount: 1 })).toEqual({ ok: false, reason: "invalid-owner" });
		expect(inspectMaxResult({ projection: max.projection, target: max.target, result: result as never })).toEqual({ ok: false, reason: "provenance-mismatch" });
	});
	it("has frozen, private-material-free results", async () => {
		const p = prepareMax((await textOwner([mixed])).owner), result = p.run(ALL, 0, 88);
		expect(deepFrozen(p.projection) && deepFrozen(p.target) && deepFrozen(result)).toBe(true);
		expect(result).toMatchObject({ bodyAlgorithmVersion: 11, algorithmVersion: 3, projectionVersion: "automatic-body-projection-3" });
		expect(JSON.stringify(result)).not.toMatch(/"(?:nonce|seed|threshold|options|profile|automaticPartsOfSpeech)"/u);
		expect(p.projection.fingerprint).toMatch(/^vocabulary-fingerprint-sha256-3:[0-9a-f]{64}$/u);
	});
});
