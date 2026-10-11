import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import {
	FAKE_ALERT_ADJECTIVE_FULL_POOL,
	FAKE_ALERT_ALGORITHM_VERSION,
	FAKE_ALERT_NA_FULL_POOL,
	FAKE_ALERT_RECENT_MAX,
	FAKE_ALERT_RECENT_WORDS_MAX,
	FAKE_ALERT_SAHEN_FULL_POOL,
	FAKE_ALERT_VERB_FULL_POOL,
	fakeAlertWords,
	generateFakeAlert,
	isFakeAlert,
	standardFakeAlertRecipes,
	type FakeAlert,
	type FakeAlertPage,
	type GenerateFakeAlertInput,
} from "../src/fakeAlert/fakeAlertCore";
import {
	FAKE_ALERT_DRIFT_CURVES,
	FAKE_ALERT_INHERIT_PERCENT,
	FAKE_ALERT_ROLE_MISMATCH,
	FAKE_ALERT_SLOT_MISFIT,
	fakeAlertLevelValue,
} from "../src/fakeAlert/fakeAlertLevel";
import { FAKE_ALERT_BUTTON_ROLES } from "../src/fakeAlert/recipeData";
import { buildFakeAlertRecipeSet, parseFakeAlertSlotToken } from "../src/fakeAlert/recipeSet";
import { NA_STEM_EXCLUDED } from "../src/vocabulary/lexicalProjection";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../src/transform/manualMorphology";
import {
	ADJECTIVE_LEXICON, ALERT_LEXICON, MANY_ADJECTIVES, MANY_NA, MANY_VERBS, NO_NOUN_TEXT, ONE_NOUN_TEXT, REGULAR_VERBS, RICH_TEXT,
	fullOwner, manyVerbOwner, mintOwner, na, naStem, nounOnlyOwner, richOwner, sahen, verbOwner,
} from "./fakeAlertCoreFixtures";
import { noun, token, verb } from "./fakeProverbCoreFixtures";
import { baseInput, compiled, edited, recipe } from "./fakeAlertRecipeFixtures";
import { readPinnedFixture } from "./support/pinnedFixture";
import { FAKE_ALERT_VIEW1_ADDED } from "./support/experienceVocabularyGraph";
import { yieldToEventLoop } from "./support/eventLoop";

const WIDE_NOUNS = ["猫", "犬", "封筒", "病院", "冷蔵庫", "桜", "夕食", "時計", "鉛筆", "机", "窓", "傘"];
const WIDE_SAHEN = ["観察", "絶望", "信頼", "散歩", "記憶", "散策", "検討", "調査", "研究", "練習", "料理", "旅行"];
/** With WIDE_SAHEN, more sahen nouns than FAKE_ALERT_SAHEN_FULL_POOL: every sahen recipe is fully available. */
const MORE_SAHEN = ["運動", "勉強", "掃除", "洗濯", "説明", "計算", "記録", "報告", "相談", "準備", "確認", "整理"];

/** Twenty-four 一段 verbs: more than FAKE_ALERT_VERB_FULL_POOL. */
const WIDE_VERBS: readonly string[] = MANY_VERBS;

/** A Vocabulary of WIDE_NOUNS and the given 一段 verbs, each written once, with no sahen noun. */
async function ownerWithVerbs(verbs: readonly string[]): Promise<ManualMorphVocabulary> {
	const text = [...WIDE_NOUNS, ...verbs].map((surface) => `${surface}。`).join("");
	return (await mintOwner([text], "uniform", [...ALERT_LEXICON, ...WIDE_NOUNS.map(noun), ...verbs.map((surface) => verb(surface, "一段"))])).owner;
}

/** A Vocabulary of WIDE_NOUNS and the given sahen nouns, each written once. */
async function ownerWith(sahenNouns: readonly string[]): Promise<ManualMorphVocabulary> {
	const text = [...WIDE_NOUNS, ...sahenNouns].map((surface) => `${surface}。`).join("");
	return (await mintOwner([text], "uniform", [...ALERT_LEXICON, ...WIDE_NOUNS.map(noun), ...sahenNouns.map(sahen)])).owner;
}
const LEVELS = Array.from({ length: 101 }, (_value, index) => index);
const NONCES = Array.from({ length: 300 }, (_value, index) => (index * 2654435761) >>> 0);

function alert(input: GenerateFakeAlertInput): FakeAlert {
	const result = generateFakeAlert(input);
	if (!result.ok) throw new Error(result.reason);
	return result.alert;
}
const familyOf = (id: string) => standardFakeAlertRecipes().families.find((family) => family.id === id)!;
const recipeOf = (id: string) => {
	const set = standardFakeAlertRecipes();
	return [...set.prompts, ...set.terminals, ...set.outcomes].find((entry) => entry.id === id)!;
};
const pages = (value: FakeAlert): FakeAlertPage[] => [value.prompt, ...Object.values(value.outcomes)];

describe("the Fake Alert level table", () => {
	it("interpolates in integers, so a value is 0 only where the table writes 0", () => {
		const drift1 = FAKE_ALERT_DRIFT_CURVES[1]!;
		expect([0, 1, 24, 25, 26, 50, 100].map((level) => fakeAlertLevelValue(drift1, level))).toEqual([0, 6, 144, 150, 152, 200, 150]);
		expect([25, 26, 49, 50].map((level) => fakeAlertLevelValue(FAKE_ALERT_ROLE_MISMATCH, level))).toEqual([0, 1, 24, 25]);
		expect(fakeAlertLevelValue(FAKE_ALERT_SLOT_MISFIT, 0)).toBe(0);
		expect(fakeAlertLevelValue(FAKE_ALERT_SLOT_MISFIT, 1)).toBe(2);
		expect(fakeAlertLevelValue(FAKE_ALERT_INHERIT_PERCENT, 0)).toBe(2500);
		for (const value of [-1, 101, 1.5, Number.NaN]) expect(() => fakeAlertLevelValue(drift1, value)).toThrow(RangeError);
	});

	it("keeps the plain Alert at every level, and every other tier at 0 only at level 0", () => {
		for (const level of LEVELS) {
			expect(fakeAlertLevelValue(FAKE_ALERT_DRIFT_CURVES[0]!, level), String(level)).toBeGreaterThan(0);
			for (const drift of [1, 2]) expect(fakeAlertLevelValue(FAKE_ALERT_DRIFT_CURVES[drift]!, level) === 0, `${drift}@${level}`).toBe(level === 0);
		}
		// Drift 3 starts after 25, a button may be overruled only after 25, and the misfit and inheritance rows move at once.
		expect(LEVELS.filter((level) => fakeAlertLevelValue(FAKE_ALERT_DRIFT_CURVES[3]!, level) === 0)).toEqual(LEVELS.slice(0, 26));
		expect(LEVELS.filter((level) => fakeAlertLevelValue(FAKE_ALERT_ROLE_MISMATCH, level) === 0)).toEqual(LEVELS.slice(0, 26));
		expect(LEVELS.filter((level) => fakeAlertLevelValue(FAKE_ALERT_SLOT_MISFIT, level) === 0)).toEqual([0]);
		expect(LEVELS.filter((level) => fakeAlertLevelValue(FAKE_ALERT_INHERIT_PERCENT, level) === 2500)).toEqual([0]);
	});
});

describe("generating a Fake Alert", () => {
	it("makes a finished, frozen, recorded Alert from the owner's own words", async () => {
		const owner = await richOwner();
		const value = alert({ owner, level: 50, nonce: 7 });
		expect(isFakeAlert(value)).toBe(true);
		expect(isFakeAlert(JSON.parse(JSON.stringify(value)))).toBe(false);
		expect(isFakeAlert({ ...value })).toBe(false);
		expect([value.algorithmVersion, value.recipeDataVersion, value.level]).toEqual([FAKE_ALERT_ALGORITHM_VERSION, standardFakeAlertRecipes().dataVersion, 50]);
		expect(value.provenance).toEqual({
			vocabularyFingerprint: owner.snapshot.fingerprint, drawMode: owner.snapshot.drawMode,
			sources: owner.snapshot.sources.map((source) => ({ path: source.path, contentHash: source.contentHash, projectionPolicy: source.projectionPolicy })),
		});
		const surfaces = new Set([...owner.snapshot.projections.collision.nouns, ...owner.snapshot.projections.collision.sahenNouns].map((entry) => entry.surface));
		for (const item of pages(value)) {
			expect(Object.isFrozen(item) && Object.isFrozen(item.lines) && Object.isFrozen(item.words)).toBe(true);
			for (const line of item.lines) expect(line).not.toMatch(/[{}]/u);
			for (const word of item.words) expect(surfaces.has(word.surface), word.surface).toBe(true);
			// The lines are the recipe with its words in place: nothing else is added.
			const template = recipeOf(item.recipeId).lines.map((line) => line.map((segment) => (typeof segment === "string" ? segment : item.words.find((word) => word.token === segment.token)!.surface)).join(""));
			expect(item.lines).toEqual(template);
		}
		expect(Object.isFrozen(value) && Object.isFrozen(value.outcomes) && Object.isFrozen(value.provenance)).toBe(true);
	});

	it("is the same Alert for the same input, and varies with the nonce", async () => {
		const owner = await richOwner();
		expect(alert({ owner, level: 60, nonce: 42 })).toEqual(alert({ owner, level: 60, nonce: 42 }));
		const prompts = new Set(NONCES.slice(0, 60).map((nonce) => alert({ owner, level: 60, nonce }).prompt.lines.join("/")));
		expect(prompts.size).toBeGreaterThan(30);
	});

	it("gives a dialog one Outcome per button, closed by OK, and a terminal none", async () => {
		const owner = await richOwner();
		const shapes = new Set<string>();
		for (const nonce of NONCES) {
			const value = alert({ owner, level: 100, nonce });
			shapes.add(value.shape);
			if (value.shape === "terminal") {
				expect(Object.keys(value.outcomes)).toEqual([]);
				expect(value.prompt.buttons).toEqual(["ok"]);
				expect(recipeOf(value.prompt.recipeId).stage).toBe("terminal");
				continue;
			}
			expect(Object.keys(value.outcomes)).toEqual([...value.prompt.buttons]);
			for (const outcome of Object.values(value.outcomes)) {
				expect(outcome.buttons).toEqual(["ok"]);
				expect(recipeOf(outcome.recipeId).stage).toBe("outcome");
			}
		}
		expect([...shapes].sort()).toEqual(["dialog", "terminal"]);
	});

	it("keeps the level-0 contract: plain prompts, the answering family, and the prompt's own words", async () => {
		for (const owner of [await richOwner(), await nounOnlyOwner(), await verbOwner()]) {
			for (const nonce of NONCES) {
				const value = alert({ owner, level: 0, nonce });
				expect(value.shape).toBe("dialog");
				expect(familyOf(value.prompt.family).drift).toBe(0);
				for (const [button, outcome] of Object.entries(value.outcomes)) {
					const family = familyOf(outcome.family);
					expect(family.drift).toBe(0);
					expect([FAKE_ALERT_BUTTON_ROLES[button as keyof typeof FAKE_ALERT_BUTTON_ROLES], "any"]).toContain(family.on);
					for (const word of outcome.words) {
						expect(word.token.startsWith("+")).toBe(false);
						expect(value.prompt.words).toContainEqual(word);
					}
				}
			}
		}
	});

	it("never lets a button be overruled at 25 or below, and does at higher levels", async () => {
		const owner = await richOwner();
		const overruled = (level: number) => NONCES.filter((nonce) => {
			const value = alert({ owner, level, nonce });
			return Object.entries(value.outcomes).some(([button, outcome]) => {
				const on = familyOf(outcome.family).on;
				return on !== "any" && on !== FAKE_ALERT_BUTTON_ROLES[button as keyof typeof FAKE_ALERT_BUTTON_ROLES];
			});
		}).length;
		expect([1, 13, 25].map(overruled)).toEqual([0, 0, 0]);
		expect(overruled(100)).toBeGreaterThan(overruled(50));
		expect(overruled(50)).toBeGreaterThan(0);
	});

	it("loosens the Outcome's hold on the Prompt's words as the level rises", async () => {
		const owner = await richOwner();
		const changed = (level: number) => {
			let shared = 0, kept = 0, misfit = 0;
			for (const nonce of NONCES) {
				const value = alert({ owner, level, nonce });
				for (const outcome of Object.values(value.outcomes)) {
					for (const word of outcome.words.filter((entry) => !entry.token.startsWith("+"))) {
						const prompt = value.prompt.words.find((entry) => entry.token === word.token);
						if (prompt === undefined) { misfit += 1; continue; }
						shared += 1;
						if (prompt.surface === word.surface) kept += 1;
					}
				}
			}
			return { kept: kept / shared, misfit };
		};
		const low = changed(0), mid = changed(50), high = changed(100);
		expect([low.kept, low.misfit]).toEqual([1, 0]);
		expect(mid.kept).toBeLessThan(1);
		expect(high.kept).toBeLessThan(mid.kept);
		expect(high.misfit).toBeGreaterThan(0);
	});

	it("brings in sudden questions and one-shot Alerts only above 0, more often as the level rises", async () => {
		const owner = await richOwner();
		// Option C (data version 5) makes a one-shot Alert rare at 50 (under 1%), so 300 nonces could see none.
		const wide = Array.from({ length: 3000 }, (_value, index) => (index * 2654435761) >>> 0);
		const share = (level: number): [number, number] => {
			const values = wide.map((nonce) => alert({ owner, level, nonce }));
			return [values.filter((value) => value.shape === "terminal").length, values.filter((value) => value.prompt.family === "question").length];
		};
		const [t0, q0] = share(0), [t50, q50] = share(50), [t100, q100] = share(100);
		expect([t0, q0]).toEqual([0, 0]);
		expect(t100).toBeGreaterThan(t50);
		expect(t50).toBeGreaterThan(0);
		expect(q100).toBeGreaterThan(q0);
		expect(q50).toBeGreaterThan(0);
		// Each one-shot family appears: reports, refusals and prohibitions. (The very rare persona family, RECIPES2, may
		// or may not be among 300; its own test is below.)
		const families = new Set(NONCES.map((nonce) => alert({ owner, level: 100, nonce })).filter((value) => value.shape === "terminal").map((value) => value.prompt.family));
		expect([...families].filter((family) => family !== "persona").sort()).toEqual(["prohibition", "refusal", "report"]);
	});

	it("generates at every level for a Vocabulary with sahen nouns and for one without, using no sahen recipe in the second", async () => {
		const rich = await richOwner(), nouns = await nounOnlyOwner();
		expect(nouns.snapshot.projections.collision.sahenNouns).toEqual([]);
		for (const level of LEVELS) {
			for (const nonce of NONCES.slice(0, 6)) {
				expect(generateFakeAlert({ owner: rich, level, nonce }).ok, `rich ${level}`).toBe(true);
				const value = alert({ owner: nouns, level, nonce });
				for (const item of pages(value)) expect(recipeOf(item.recipeId).needsSahen, item.recipeId).toBe(false);
			}
		}
	});

	it("uses different words for different slots while the Vocabulary has them, and still finishes with one noun", async () => {
		// Twelve of each kind: more than one Alert can ever ask for, so no slot has to repeat a word.
		const plenty = [...WIDE_NOUNS, ...WIDE_SAHEN].map((surface) => `${surface}。`).join("");
		const owner = (await mintOwner([plenty], "uniform", [...ALERT_LEXICON, ...WIDE_NOUNS.map(noun), ...WIDE_SAHEN.map(sahen)])).owner;
		expect(owner.snapshot.projections.collision.sahenNouns).toHaveLength(WIDE_SAHEN.length);
		for (const nonce of NONCES) {
			const value = alert({ owner, level: 100, nonce });
			const prompt = value.prompt.words.map((word) => word.surface);
			expect(new Set(prompt).size, prompt.join(",")).toBe(prompt.length);
			for (const outcome of Object.values(value.outcomes)) {
				// A new word, local or re-drawn, avoids every word already on the Alert.
				const own = outcome.words.filter((word) => word.token.startsWith("+") || !value.prompt.words.some((entry) => entry.token === word.token && entry.surface === word.surface));
				for (const word of own) expect(prompt, word.token).not.toContain(word.surface);
				expect(new Set(outcome.words.map((word) => word.surface)).size).toBe(outcome.words.length);
			}
		}
		const lonely = (await mintOwner([ONE_NOUN_TEXT], "uniform", ALERT_LEXICON)).owner;
		for (const level of [0, 50, 100]) {
			for (const nonce of NONCES.slice(0, 20)) {
				for (const item of pages(alert({ owner: lonely, level, nonce }))) for (const word of item.words) expect(word.surface).toBe("猫");
			}
		}
	});

	it("draws by the Vocabulary's draw mode and Source weights, and an all-×1 weighting changes nothing", async () => {
		const text = "猫は封筒を観察する。猫は封筒を観察する。猫は封筒を観察する。猫は封筒を観察する。猫は封筒を観察する。猫は封筒を観察する。猫は封筒を観察する。猫は封筒を観察する。犬を絶望する。";
		const count = (owner: ManualMorphVocabulary, surface: string) => NONCES.filter((nonce) =>
			pages(alert({ owner, level: 0, nonce })).some((item) => item.words.some((word) => word.surface === surface))).length;
		const uniform = (await mintOwner([text], "uniform", ALERT_LEXICON)).owner;
		const frequency = (await mintOwner([text], "frequency", ALERT_LEXICON)).owner;
		expect(count(frequency, "猫")).toBeGreaterThan(count(uniform, "猫"));
		expect(count(frequency, "犬")).toBeLessThan(count(uniform, "犬"));
		// Two Sources: a ×4 weight on the second draws its only noun more often.
		const analyses = await Promise.all([["first.md", "猫は封筒。病院は桜。"], ["second.md", "時計は時計。"]].map(async ([sourcePath, value]) => {
			const answer = await analyzeManualMorphSource({ text: value!, sourcePath: sourcePath!, tokenizer: { tokenize: async (input) => {
				const sorted = [...ALERT_LEXICON].sort((a, b) => b.surface.length - a.surface.length);
				const out = [];
				for (let cursor = 0; cursor < input.length;) {
					const found = sorted.find((item) => input.startsWith(item.surface, cursor))!;
					out.push({ ...found });
					cursor += found.surface.length;
				}
				return await Promise.resolve(out);
			} } });
			if (answer.status !== "ready") throw new Error("analysis");
			return answer.analysis;
		}));
		const plain = buildManualMorphVocabulary({ sources: analyses, drawMode: "uniform" });
		const ones = buildManualMorphVocabulary({ sources: analyses, drawMode: "uniform", sourceWeights: { "first.md": 1, "second.md": 1 } });
		const heavy = buildManualMorphVocabulary({ sources: analyses, drawMode: "uniform", sourceWeights: { "second.md": 4 } });
		expect(NONCES.slice(0, 40).map((nonce) => alert({ owner: ones, level: 70, nonce }))).toEqual(NONCES.slice(0, 40).map((nonce) => alert({ owner: plain, level: 70, nonce })));
		expect(count(heavy, "時計")).toBeGreaterThan(count(plain, "時計"));
	});

	it("chooses a family before a recipe, so adding recipes to a family does not change how often it appears", async () => {
		// Enough sahen nouns that every recipe is fully available (VARIETY1 scales a family only while they are few).
		const owner = await ownerWith([...WIDE_SAHEN, ...MORE_SAHEN]);
		const base = compiled(baseInput());
		const crowded = compiled(edited((value) => {
			for (const index of [1, 2, 3, 4, 5]) value.terminals.push({ id: `t-more-${index}`, family: "blurt", enabled: true, kind: "information", weight: 9, lines: [`{n1}は${"一二三四五"[index - 1]}です。`] });
		}));
		const families = (recipes: typeof base) => NONCES.map((nonce) => alert({ owner, level: 100, nonce, recipes }).shape);
		expect(families(crowded)).toEqual(families(base));
		expect(families(base)).toContain("terminal");
	});

	it("treats a sahen noun as a noun too, and never shows a word that cannot be shown", async () => {
		const sahenOnly = (await mintOwner(["観察。絶望。"], "uniform", ALERT_LEXICON)).owner;
		expect(sahenOnly.snapshot.projections.collision.nouns).toEqual([]);
		for (const nonce of NONCES.slice(0, 30)) {
			for (const item of pages(alert({ owner: sahenOnly, level: 0, nonce }))) for (const word of item.words) expect(["観察", "絶望"]).toContain(word.surface);
		}
		const blank = "白\u3000黒";
		const spaced = (await mintOwner([`${blank}。猫。`], "uniform", [...ALERT_LEXICON, noun(blank)])).owner;
		expect(spaced.snapshot.projections.collision.nouns.map((entry) => entry.surface)).toContain(blank);
		for (const nonce of NONCES.slice(0, 60)) {
			for (const item of pages(alert({ owner: spaced, level: 100, nonce }))) for (const word of item.words) expect(word.surface).toBe("猫");
		}
		const onlyBlank = (await mintOwner([`${blank}。`], "uniform", [...ALERT_LEXICON, noun(blank)])).owner;
		expect(generateFakeAlert({ owner: onlyBlank, level: 50, nonce: 1 })).toEqual({ ok: false, reason: "insufficient-vocabulary" });
	});

	it("prefers a recipe not shown recently, and falls back to it when nothing else is usable", async () => {
		const recipes = compiled(baseInput());
		// Enough sahen nouns that the sahen prompt is a full alternative (see the VARIETY1 review test below for fewer).
		const full = await ownerWith([...WIDE_SAHEN, ...MORE_SAHEN]), nouns = await nounOnlyOwner();
		const prompts = (owner: ManualMorphVocabulary, recent: readonly string[]) =>
			new Set(NONCES.slice(0, 60).map((nonce) => alert({ owner, level: 0, nonce, recipes, recent }).prompt.recipeId));
		expect([...prompts(full, [])].sort()).toEqual(["p-act", "p-noun"]);
		expect([...prompts(full, ["p-noun"])]).toEqual(["p-act"]);
		expect([...prompts(full, ["p-act"])]).toEqual(["p-noun"]);
		// Without sahen nouns only the noun prompt is usable, recent or not.
		expect([...prompts(nouns, ["p-noun"])]).toEqual(["p-noun"]);
	});

	it("refuses input it cannot use with a fixed reason, and never throws for it", async () => {
		const owner = await richOwner();
		const reason = (input: unknown) => {
			const result = generateFakeAlert(input as GenerateFakeAlertInput);
			return result.ok ? "ok" : result.reason;
		};
		for (const input of [
			null, 1, [], { owner, level: 101, nonce: 1 }, { owner, level: -1, nonce: 1 }, { owner, level: 1.5, nonce: 1 }, { owner, level: "50", nonce: 1 },
			{ owner, level: 50, nonce: -1 }, { owner, level: 50, nonce: 2 ** 32 }, { owner, level: 50, nonce: 0.5 },
			{ owner, level: 50, nonce: 1, recent: "p-noun" }, { owner, level: 50, nonce: 1, recent: [1] },
			{ owner, level: 50, nonce: 1, recent: Array.from({ length: FAKE_ALERT_RECENT_MAX + 1 }, () => "x") },
			{ owner, level: 50, nonce: 1, recentWords: "猫" }, { owner, level: 50, nonce: 1, recentWords: [1] },
			{ owner, level: 50, nonce: 1, recentWords: Array.from({ length: FAKE_ALERT_RECENT_WORDS_MAX + 1 }, () => "猫") },
			{ owner, level: 50, nonce: 1, seed: 1 },
		]) expect(reason(input), JSON.stringify(input === null ? null : typeof input)).toBe("invalid-request");
		expect(reason({ owner, level: 50, nonce: 1, recent: Array.from({ length: FAKE_ALERT_RECENT_MAX }, () => "x") })).toBe("ok");
		expect(reason({ owner, level: 50, nonce: 1, recentWords: Array.from({ length: FAKE_ALERT_RECENT_WORDS_MAX }, () => "猫") })).toBe("ok");
		// A recipe set is one the builder made, never an object of the same shape.
		expect(reason({ owner, level: 50, nonce: 1, recipes: JSON.parse(JSON.stringify(standardFakeAlertRecipes())) as unknown })).toBe("invalid-recipes");
		expect(reason({ owner, level: 50, nonce: 1, recipes: { ...standardFakeAlertRecipes() } })).toBe("invalid-recipes");
		// An owner is a minted Vocabulary owner, never a copy of one.
		for (const forged of [{ ...owner }, { snapshot: owner.snapshot }, {}, "owner", null]) expect(reason({ owner: forged, level: 50, nonce: 1 })).toBe("invalid-vocabulary");
		const empty = (await mintOwner([NO_NOUN_TEXT], "uniform", ALERT_LEXICON)).owner;
		expect(reason({ owner: empty, level: 50, nonce: 1 })).toBe("insufficient-vocabulary");
	});

	it("refuses rather than relaxes when the level leaves no candidate", async () => {
		// A set the compiler would refuse (no noun-only prompt at level 0), built directly so the core's own rule shows.
		const input = edited((value) => {
			recipe(value, "p-noun").enabled = false;
			recipe(value, "t-one").lines = ["{n1}です。"];
		});
		const recipes = buildFakeAlertRecipeSet({
			schemaVersion: 1, dataVersion: 1,
			families: input.families.map((family) => ({ id: family.id, stage: family.stage as "prompt", weight: family.weight, drift: family.drift, on: (family.on ?? null) as null })),
			recipes: [...input.prompts, ...input.terminals, ...input.outcomes].map((entry) => ({
				id: entry.id, family: entry.family, enabled: entry.enabled, kind: entry.kind as "warning", weight: entry.weight,
				buttons: (entry.buttons ?? "ok") as "ok", lines: entry.lines.map((line) => line.split(/(\{[^}]*\})/u).filter((part) => part !== "")
					.map((part) => (part.startsWith("{") ? { slot: part.slice(1, -1) } : { literal: part }))),
			})),
		});
		const nouns = await nounOnlyOwner();
		// Level 0: the only usable prompt needs a sahen noun, and the terminal family is forbidden.
		expect(generateFakeAlert({ owner: nouns, level: 0, nonce: 1, recipes })).toEqual({ ok: false, reason: "no-candidate" });
		// Above 0 the terminal family is allowed, so the same set and Vocabulary can answer.
		expect(NONCES.slice(0, 40).some((nonce) => generateFakeAlert({ owner: nouns, level: 60, nonce, recipes }).ok)).toBe(true);
	});

	it("reads only the owner's Snapshot, changes nothing in it, and derives its words once per owner", async () => {
		const owner = await richOwner();
		const before = JSON.stringify(owner.snapshot);
		const first = alert({ owner, level: 50, nonce: 1 });
		const second = alert({ owner, level: 80, nonce: 2 });
		expect(JSON.stringify(owner.snapshot)).toBe(before);
		expect(second.provenance).toBe(first.provenance);
		// Another owner of the same text is another derivation.
		expect(alert({ owner: await richOwner(), level: 50, nonce: 1 }).provenance).not.toBe(first.provenance);
		expect(alert({ owner: await richOwner(), level: 50, nonce: 1 })).toEqual(first);
	});
});

describe("a different word for every slot whenever the Vocabulary allows one (independent review 1, P2)", () => {
	it("gives 猫を観察する。 the words 猫 and 観察, never 観察の観察", async () => {
		// The reviewer's input: the noun slot used to take the only sahen noun, and the sahen slot then repeated it.
		// VARIETY1 makes sahen recipes rarer for this one-sahen Vocabulary, so check every Prompt with both kinds.
		const owner = (await mintOwner(["猫を観察する。"], "uniform", ALERT_LEXICON)).owner;
		let checked = 0;
		for (const nonce of NONCES) {
			const value = alert({ owner, level: 0, nonce });
			const tokens = value.prompt.words.map((word) => word.token);
			if (!(tokens.includes("n1") && tokens.includes("s1"))) continue;
			checked += 1;
			expect(value.prompt.words.find((word) => word.token === "n1")!.surface, value.prompt.recipeId).toBe("猫");
			expect(value.prompt.words.find((word) => word.token === "s1")!.surface, value.prompt.recipeId).toBe("観察");
			// Level 0 keeps the Prompt's words, so the Outcomes no longer inherit a repeat either.
			for (const outcome of Object.values(value.outcomes)) for (const word of outcome.words) expect(value.prompt.words).toContainEqual(word);
		}
		expect(checked).toBeGreaterThan(0);
	});

	it.each([
		["one noun and one sahen noun", ["猫を観察する。"]],
		["two of each", ["猫を観察する。犬を絶望する。"]],
		["three nouns and one sahen noun", ["猫は犬の封筒を観察する。"]],
	] as const)("repeats a word on a page only when no assignment without a repeat exists (%s)", async (_name, texts) => {
		const owner = (await mintOwner(texts, "uniform", ALERT_LEXICON)).owner;
		const collision = owner.snapshot.projections.collision;
		const sahenWords = new Set(collision.sahenNouns.map((entry) => entry.surface));
		const nounWords = new Set([...collision.nouns.map((entry) => entry.surface), ...sahenWords]);
		const kind = (token: string) => (token.replace("+", "").startsWith("s") ? "s" : "n");
		// A page's new words fit without a repeat when the sahen slots fit the unused sahen nouns and all of them fit the unused nouns.
		const fits = (tokens: readonly string[], used: ReadonlySet<string>) => {
			const sahen = tokens.filter((token) => kind(token) === "s").length;
			const free = (words: ReadonlySet<string>) => [...words].filter((word) => !used.has(word)).length;
			return free(sahenWords) >= sahen && free(nounWords) >= tokens.length;
		};
		let checked = 0;
		for (const level of [0, 13, 26, 50, 75, 100]) {
			for (const nonce of NONCES.slice(0, 120)) {
				const value = alert({ owner, level, nonce });
				for (const word of [value.prompt, ...Object.values(value.outcomes)].flatMap((item) => item.words)) {
					expect((kind(word.token) === "s" ? sahenWords : nounWords).has(word.surface), word.token).toBe(true);
				}
				const prompt = value.prompt.words;
				if (fits(prompt.map((word) => word.token), new Set())) {
					checked += 1;
					expect(new Set(prompt.map((word) => word.surface)).size, prompt.map((word) => word.surface).join(",")).toBe(prompt.length);
				}
				const onPrompt = new Set(prompt.map((word) => word.surface));
				for (const outcome of Object.values(value.outcomes)) {
					const drawn = outcome.words.filter((word) => !prompt.some((entry) => entry.token === word.token && entry.surface === word.surface));
					if (!fits(drawn.map((word) => word.token), onPrompt)) continue;
					checked += 1;
					for (const word of drawn) expect(onPrompt.has(word.surface), word.surface).toBe(false);
					expect(new Set(drawn.map((word) => word.surface)).size).toBe(drawn.length);
				}
			}
		}
		expect(checked).toBeGreaterThan(200);
	});

	it("still finishes, repeating the one word, when the Vocabulary really is too small", async () => {
		const owner = (await mintOwner(["観察する。"], "uniform", ALERT_LEXICON)).owner;
		for (const level of [0, 50, 100]) {
			for (const nonce of NONCES.slice(0, 40)) {
				for (const item of pages(alert({ owner, level, nonce }))) for (const word of item.words) expect(word.surface).toBe("観察");
			}
		}
	});
});

describe("variety: recently shown words and few sahen nouns (FAKE-ALERT-VARIETY1)", () => {
	const isSahenSlot = (token: string) => token.replace("+", "").startsWith("s");

	it("draws exactly as before when no recent words are given", async () => {
		const owner = await richOwner();
		for (const level of [0, 50, 100]) {
			for (const nonce of NONCES.slice(0, 60)) expect(alert({ owner, level, nonce, recentWords: [] })).toEqual(alert({ owner, level, nonce }));
		}
	});

	it("draws a recently shown word about a fifth as often, and never touches a word an Outcome keeps from its Prompt", async () => {
		const owner = await ownerWith([...WIDE_SAHEN, ...MORE_SAHEN]);
		const recentWords = WIDE_NOUNS.slice(0, 6);
		// Recent against other WIDE_NOUNS, per word, over newly drawn words in noun slots only.
		const ratio = (words: readonly string[] | undefined) => {
			let recentDraws = 0, otherDraws = 0;
			for (const level of [50, 100]) {
				for (const nonce of NONCES) {
					const value = alert({ owner, level, nonce, ...(words === undefined ? {} : { recentWords: words }) });
					const kept = (word: { token: string; surface: string }) => value.prompt.words.some((entry) => entry.token === word.token && entry.surface === word.surface);
					const drawn = [...value.prompt.words, ...Object.values(value.outcomes).flatMap((item) => item.words.filter((word) => !kept(word)))];
					for (const word of drawn.filter((entry) => !isSahenSlot(entry.token))) {
						if (recentWords.includes(word.surface)) recentDraws += 1;
						else if (WIDE_NOUNS.includes(word.surface)) otherDraws += 1;
					}
				}
			}
			return recentDraws / otherDraws;
		};
		const plain = ratio(undefined), damped = ratio(recentWords);
		expect(plain).toBeGreaterThan(0.75);
		expect(plain).toBeLessThan(1.33);
		expect(damped).toBeGreaterThan(0);
		expect(damped).toBeLessThan(plain * 0.4);
		// Level 0 keeps every Prompt word on its Outcomes even when all of them were shown recently.
		const everything = [...WIDE_NOUNS, ...WIDE_SAHEN, ...MORE_SAHEN];
		for (const nonce of NONCES.slice(0, 80)) {
			const value = alert({ owner, level: 0, nonce, recentWords: everything });
			for (const item of Object.values(value.outcomes)) {
				for (const word of item.words) {
					const shared = value.prompt.words.find((entry) => entry.token === word.token);
					if (shared !== undefined) expect(word.surface).toBe(shared.surface);
				}
			}
		}
		// A recent word still appears when nothing else is left.
		const lonely = (await mintOwner([ONE_NOUN_TEXT], "uniform", ALERT_LEXICON)).owner;
		for (const item of pages(alert({ owner: lonely, level: 50, nonce: 7, recentWords: ["猫"] }))) for (const word of item.words) expect(word.surface).toBe("猫");
	});

	it("makes sahen recipes rarer while sahen nouns are few, never forbids them, and changes nothing from the full pool up", async () => {
		const one = await ownerWith(["観察"]), five = await ownerWith(WIDE_SAHEN.slice(0, 5));
		const full = await ownerWith([...WIDE_SAHEN, ...MORE_SAHEN.slice(0, FAKE_ALERT_SAHEN_FULL_POOL - WIDE_SAHEN.length)]);
		const more = await ownerWith([...WIDE_SAHEN, ...MORE_SAHEN]);
		expect(full.snapshot.projections.collision.sahenNouns).toHaveLength(FAKE_ALERT_SAHEN_FULL_POOL);
		expect(more.snapshot.projections.collision.sahenNouns.length).toBeGreaterThan(FAKE_ALERT_SAHEN_FULL_POOL);
		const share = (owner: ManualMorphVocabulary) => {
			let sahenPages = 0, total = 0;
			for (const level of [25, 50, 75, 100]) {
				for (const nonce of NONCES) {
					for (const item of pages(alert({ owner, level, nonce }))) {
						total += 1;
						if (recipeOf(item.recipeId).needsSahen) sahenPages += 1;
					}
				}
			}
			return sahenPages / total;
		};
		const [s1, s5, s20] = [share(one), share(five), share(full)];
		expect(s1).toBeGreaterThan(0);
		expect(s1).toBeLessThan(s5);
		expect(s5).toBeLessThan(s20);
		expect(s1).toBeLessThan(s20 / 4);
		// Squared, not linear: even five sahen nouns stay well under a quarter of a full pool's share.
		expect(s5).toBeLessThan(s20 / 4);
		// From the full pool up every recipe is fully available: 20 and 24 sahen nouns choose the same recipes.
		const recipes = (owner: ManualMorphVocabulary) => NONCES.slice(0, 150).map((nonce) => pages(alert({ owner, level: 60, nonce })).map((item) => item.recipeId));
		expect(recipes(more)).toEqual(recipes(full));
	});

	it("does not let the recent-recipe rule bring the few sahen nouns back (independent review 1, P2)", async () => {
		// The reviewer's input: one sahen noun, level 0, and the confirm family's two noun-only prompts shown recently.
		// The family's weight was computed over all four prompts and the draw then left only the two sahen ones:
		// 11,510 of 20,000 Alerts opened with a sahen confirm prompt, more than before VARIETY1.
		const one = (await mintOwner(["猫を観察する。"], "uniform", ALERT_LEXICON)).owner;
		const many = Array.from({ length: 4000 }, (_value, index) => index);
		const sahenPrompts = (owner: ManualMorphVocabulary, level: number, recent: readonly string[]) =>
			many.filter((nonce) => recipeOf(alert({ owner, level, nonce, recent }).prompt.recipeId).needsSahen).length / many.length;
		const without = sahenPrompts(one, 0, []);
		await yieldToEventLoop();
		const withRecent = sahenPrompts(one, 0, ["confirm-replace", "confirm-continue"]);
		expect(without).toBeLessThan(0.02);
		expect(withRecent).toBeLessThan(0.02);
		// Every noun-only opening recipe shown recently, at any level: still no way back for the sahen recipes.
		const set = standardFakeAlertRecipes();
		const nounOnly = [...set.prompts, ...set.terminals].filter((entry) => entry.enabled && !entry.needsSahen).map((entry) => entry.id);
		for (const level of [0, 50, 100]) {
			for (let start = 0; start < nounOnly.length; start += FAKE_ALERT_RECENT_MAX) {
				await yieldToEventLoop();
				expect(sahenPrompts(one, level, nounOnly.slice(start, start + FAKE_ALERT_RECENT_MAX)), `${level}/${start}`).toBeLessThan(0.02);
			}
		}
		// The Outcomes too: with the plain noun-only Outcomes recent, a button still does not lead to a sahen page.
		const plainOutcomes = set.outcomes.filter((entry) => entry.enabled && !entry.needsSahen).map((entry) => entry.id).slice(0, FAKE_ALERT_RECENT_MAX);
		let sahenOutcomes = 0, outcomes = 0;
		for (const nonce of many.slice(0, 1500)) {
			for (const item of Object.values(alert({ owner: one, level: 50, nonce, recent: plainOutcomes }).outcomes)) {
				outcomes += 1;
				if (recipeOf(item.recipeId).needsSahen) sahenOutcomes += 1;
			}
		}
		expect(sahenOutcomes / outcomes).toBeLessThan(0.02);
		// A recent recipe is still avoided while a fully available one remains: with five sahen nouns and the
		// noun prompt recent, the fixture's noun prompt comes back instead of the reduced sahen prompt taking over.
		const fixture = compiled(baseInput());
		const five = await ownerWith(WIDE_SAHEN.slice(0, 5));
		const ids = NONCES.slice(0, 200).map((nonce) => alert({ owner: five, level: 0, nonce, recipes: fixture, recent: ["p-noun"] }).prompt.recipeId);
		expect(ids.filter((id) => id === "p-noun").length).toBeGreaterThan(ids.filter((id) => id === "p-act").length * 4);
		expect(ids).toContain("p-act");
	}, 60_000); // About 8 s alone on Linux (TEST-STABILITY1).
});

describe("verb slots (FAKE-ALERT-VERB1)", () => {
	const kindOfToken = (name: string) => name.replace("+", "")[0];
	const verbPages = (owner: ManualMorphVocabulary, levels: readonly number[]) => {
		let withVerb = 0, total = 0;
		for (const level of levels) {
			for (const nonce of NONCES) {
				for (const item of pages(alert({ owner, level, nonce }))) {
					total += 1;
					if (recipeOf(item.recipeId).needsVerb) withVerb += 1;
				}
			}
		}
		return withVerb / total;
	};

	it("offers regular verbs in their basic form, one word per lexeme, and never an irregular one", async () => {
		const owner = await verbOwner(), rich = await richOwner();
		const words = fakeAlertWords(owner)!;
		// 歩く and 歩い are one word; ある, 来る, 行く and する are not candidates.
		expect(words.verbs).toEqual([...REGULAR_VERBS].sort());
		expect([words.nouns, words.sahen]).toEqual([fakeAlertWords(rich)!.nouns, fakeAlertWords(rich)!.sahen]);
		expect(fakeAlertWords(rich)!.verbs).toEqual([]);
		expect(Object.isFrozen(words) && Object.isFrozen(words.verbs)).toBe(true);
		for (const forged of [{ ...owner }, { snapshot: owner.snapshot }, null]) expect(fakeAlertWords(forged as ManualMorphVocabulary)).toBeNull();
		const drawn = new Set<string>();
		for (const level of [0, 50, 100]) {
			for (const nonce of NONCES) {
				for (const item of pages(alert({ owner, level, nonce }))) {
					for (const word of item.words) {
						// A verb slot holds a regular verb's basic form; a noun or sahen slot never holds a verb.
						if (kindOfToken(word.token) === "v") drawn.add(word.surface);
						else expect(REGULAR_VERBS, word.token).not.toContain(word.surface);
					}
				}
			}
		}
		expect([...drawn].sort()).toEqual([...REGULAR_VERBS].sort());
	});

	it("uses no verb recipe without a regular verb, and generates at every level with them", async () => {
		// The rich fixture's only verb is する, which the closed rule refuses.
		for (const owner of [await richOwner(), await nounOnlyOwner()]) {
			for (const level of [0, 25, 50, 75, 100]) {
				for (const nonce of NONCES.slice(0, 40)) {
					for (const item of pages(alert({ owner, level, nonce }))) expect(recipeOf(item.recipeId).needsVerb, item.recipeId).toBe(false);
				}
			}
		}
		// With verbs they appear at every level, level 0 included, and generation never fails.
		const owner = await verbOwner();
		expect(verbPages(owner, [0])).toBeGreaterThan(0);
		for (const level of LEVELS) for (const nonce of NONCES.slice(0, 6)) expect(generateFakeAlert({ owner, level, nonce }).ok, String(level)).toBe(true);
	});

	it("keeps a Prompt's verb on its Outcomes at level 0 and may replace it above", async () => {
		// A full pool of verbs, so verb recipes are drawn at their whole weight.
		const owner = await manyVerbOwner();
		const kept = (level: number) => {
			let shared = 0, same = 0;
			for (const nonce of NONCES) {
				const value = alert({ owner, level, nonce });
				for (const item of Object.values(value.outcomes)) {
					for (const word of item.words.filter((entry) => entry.token.startsWith("v"))) {
						const prompt = value.prompt.words.find((entry) => entry.token === word.token);
						if (prompt === undefined) continue;
						shared += 1;
						if (prompt.surface === word.surface) same += 1;
					}
				}
			}
			return { shared, rate: same / shared };
		};
		const low = kept(0), high = kept(100);
		expect(low.shared).toBeGreaterThan(20);
		expect(low.rate).toBe(1);
		expect(high.rate).toBeLessThan(1);
	});

	it("makes verb recipes rarer while regular verbs are few, never forbids them, and changes nothing from the full pool up", async () => {
		const one = await ownerWithVerbs(WIDE_VERBS.slice(0, 1)), five = await ownerWithVerbs(WIDE_VERBS.slice(0, 5));
		const full = await ownerWithVerbs(WIDE_VERBS.slice(0, FAKE_ALERT_VERB_FULL_POOL)), more = await ownerWithVerbs(WIDE_VERBS);
		expect([fakeAlertWords(full)!.verbs.length, fakeAlertWords(more)!.verbs.length]).toEqual([FAKE_ALERT_VERB_FULL_POOL, WIDE_VERBS.length]);
		const levels = [25, 50, 75, 100];
		const [v1, v5, v20] = [verbPages(one, levels), verbPages(five, levels), verbPages(full, levels)];
		expect(v1).toBeGreaterThan(0);
		expect(v1).toBeLessThan(v5);
		expect(v5).toBeLessThan(v20 / 4);
		const recipes = (owner: ManualMorphVocabulary) => NONCES.slice(0, 150).map((nonce) => pages(alert({ owner, level: 60, nonce })).map((item) => item.recipeId));
		expect(recipes(more)).toEqual(recipes(full));
	});

	it("counts every observed form of a verb towards its basic form in Frequency mode", async () => {
		const text = `${"猫は歩いた。".repeat(8)}犬は見る。桜は読む。`;
		const lexicon = [...ALERT_LEXICON, verb("歩い", "五段・カ行イ音便", "連用タ接続", "歩く"), verb("見る", "一段"), verb("読む", "五段・マ行"), token("た", "助動詞", "*")];
		const share = async (mode: "uniform" | "frequency") => {
			const owner = (await mintOwner([text], mode, lexicon)).owner;
			expect(fakeAlertWords(owner)!.verbs).toEqual(["歩く", "見る", "読む"].sort());
			let walk = 0, all = 0;
			for (const nonce of NONCES) {
				for (const item of pages(alert({ owner, level: 50, nonce }))) {
					for (const word of item.words.filter((entry) => kindOfToken(entry.token) === "v")) {
						all += 1;
						if (word.surface === "歩く") walk += 1;
					}
				}
			}
			return walk / all;
		};
		expect(await share("frequency")).toBeGreaterThan(await share("uniform") * 1.5);
	});
});

describe("a verb whose basic form is also a noun (VERB1 independent review 1, P2)", () => {
	// A `{{…}}` term is a noun whatever it spells, so 歩く can be both a noun and a verb.
	const VERBS = [verb("歩く", "五段・カ行イ音便"), verb("読む", "五段・マ行"), verb("待つ", "五段・タ行")];
	const overlapOwner = async (text: string) => (await mintOwner([text], "uniform", [...ALERT_LEXICON, ...VERBS], true)).owner;
	const kindOfToken = (name: string) => name.replace("+", "")[0] as "n" | "s" | "v";
	const wordOf = (words: readonly { token: string; surface: string }[], kind: string) => words.find((word) => kindOfToken(word.token) === kind)?.surface;
	/**
	 * An Outcome's words that differ from its Prompt's word of the same name: each was drawn anew. A slot that
	 * shows the Prompt's word again either kept it or had to repeat it, and adds no new word either way.
	 */
	const drawnOn = (outcome: FakeAlertPage, prompt: FakeAlertPage) =>
		outcome.words.filter((word) => !prompt.words.some((entry) => entry.token === word.token && entry.surface === word.surface));

	/**
	 * A few verbs make a verb recipe rare (VARIETY1's rule for a small pool). These recipes weigh the verb
	 * recipes up in every family alike, so most pages have a verb beside nouns, written in either order.
	 */
	const HEAVY = 4000;
	const heavyRecipes = compiled(edited((input) => {
		recipe(input, "p-noun").lines = ["{n1}を必要としていますか？"];
		for (const [id, line] of [
			["p-nv", "{n1}が{v1}おそれがあります。"], ["p-vn", "{v1}前に{n1}を確認しますか？"],
			["p-vnn", "{v1}前に{n1}と{n2}を確認しますか？"], ["p-nnv", "{n1}と{n2}が{v1}おそれがあります。"],
		] as const) {
			input.prompts.push({ id, family: "ask", enabled: true, kind: "confirmation", buttons: "yes-no", weight: HEAVY, lines: [line] });
		}
		for (const [id, family, line] of [
			["o-nv", "fine", "{n1}は{+v1}ことにしました。"], ["o-nnv", "fine", "{+n1}と{+n2}は{v1}ことにしました。"],
			["o-vn", "stop", "{+v1}前に{+n1}を確認しました。"], ["o-vv", "stop", "{n1}は{v1}代わりに{+v1}ことにしました。"],
		] as const) {
			input.outcomes.push({ id, family, enabled: true, kind: "information", weight: HEAVY, lines: [line] });
		}
	}));

	/** The most of these tokens that can each take an unused word of their own kind, all different: a plain search, not the core's rule. */
	function most(tokens: readonly string[], pools: Record<"n" | "s" | "v", readonly string[]>, used: ReadonlySet<string>): number {
		if (tokens.length === 0) return 0;
		const [first, ...rest] = tokens;
		let best = most(rest, pools, used);
		for (const word of pools[kindOfToken(first!)]) {
			if (!used.has(word)) best = Math.max(best, 1 + most(rest, pools, new Set([...used, word])));
		}
		return best;
	}

	it("gives the reviewer's two inputs a word of their own for every slot", async () => {
		// 名詞 {歩く, 猫}、動詞 {歩く}: the noun slot used to take 歩く and the verb slot then repeated it.
		const first = await overlapOwner("猫。{{歩く}}。歩く。");
		expect(fakeAlertWords(first)).toEqual({ nouns: ["歩く", "猫"], sahen: [], verbs: ["歩く"], adjectives: [], na: [] });
		// The reviewer's draw with the standard recipes: it was 歩くが歩くおそれがあります。 The nonces moved with recipe
		// data 4; these are chosen so that each draw gives the broken sentence when the filter is removed (RECIPES2
		// independent review 1, P3).
		expect(alert({ owner: first, level: 0, nonce: 5152 }).prompt.lines).toEqual(["猫が歩くおそれがあります。", "続行しますか？"]);
		let prompts = 0;
		for (const nonce of NONCES) {
			const words = alert({ owner: first, level: 0, nonce, recipes: heavyRecipes }).prompt.words;
			if (words.length !== 2 || wordOf(words, "v") === undefined) continue;
			prompts += 1;
			expect([wordOf(words, "n"), wordOf(words, "v")]).toEqual(["猫", "歩く"]);
		}
		expect(prompts).toBeGreaterThan(100);

		// 名詞 {歩く, 犬, 猫}、動詞 {歩く}: an Outcome's new noun used to take 歩く before its new verb was drawn.
		const second = await overlapOwner("猫。犬。{{歩く}}。歩く。");
		// The reviewer's draw with the standard recipes: the いいえ side was 歩くは歩くことにしました。
		const reported = alert({ owner: second, level: 100, nonce: 5639 });
		expect([reported.prompt.lines, reported.outcomes.no!.lines]).toEqual([["犬を信じますか？"], ["猫は歩くことにしました。"]]);
	});

	it("leaves a word out only when that gives a later slot a word of its own", async () => {
		// 名詞 {歩く, 猫}、動詞 {歩く}、slot は 名詞・名詞・動詞: two words for three slots, so one slot repeats whichever
		// noun is drawn first. Leaving 歩く out of the first draw would gain nothing, so both nouns are drawn there.
		const owner = await overlapOwner("猫。{{歩く}}。歩く。");
		const firsts = new Map<string, number>();
		for (const nonce of NONCES) {
			const prompt = alert({ owner, level: 0, nonce, recipes: heavyRecipes }).prompt;
			if (prompt.recipeId !== "p-nnv") continue;
			expect(new Set(prompt.words.map((word) => word.surface)).size, prompt.lines.join("")).toBe(2);
			const first = prompt.words.find((word) => word.token === "n1")!.surface;
			firsts.set(first, (firsts.get(first) ?? 0) + 1);
		}
		expect([...firsts.keys()].sort()).toEqual(["歩く", "猫"]);
		for (const times of firsts.values()) expect(times).toBeGreaterThan(10);
	});

	it.each([
		["one verb that is also a noun, and one other noun", "猫。{{歩く}}。歩く。"],
		["one verb that is also a noun, and two other nouns", "猫。犬。{{歩く}}。歩く。"],
		// Drawing the verb first is not enough here: the verb slot must leave 歩く to the noun slot.
		["the only noun is also a verb, and there is another verb", "{{歩く}}。歩く。読む。"],
		["two verbs, one also a noun, and one other noun", "猫。{{歩く}}。歩く。読む。"],
		// The words on the Prompt count: with 猫 and 読む there, a new noun must leave 歩く to the new verb.
		["two verbs, one also a noun, and two other nouns", "猫。犬。{{歩く}}。歩く。読む。"],
		["two verbs that are both nouns too, and one other noun", "猫。{{歩く}}。{{読む}}。歩く。読む。"],
		["three verbs, two also nouns, a sahen noun and a noun", "猫を観察する。{{歩く}}。{{読む}}。歩く。読む。待つ。"],
		["every noun is also a verb", "{{歩く}}。{{読む}}。歩く。読む。待つ。"],
	] as const)("gives as many slots a word of their own as the Vocabulary allows (%s)", async (_name, text) => {
		const owner = await overlapOwner(text);
		const words = fakeAlertWords(owner)!;
		const pools = { n: words.nouns, s: words.sahen, v: words.verbs };
		expect(words.verbs.some((surface) => words.nouns.includes(surface))).toBe(true);
		let full = 0, short = 0, withVerb = 0;
		for (const recipes of [heavyRecipes, standardFakeAlertRecipes()]) {
			for (const level of [0, 13, 26, 50, 75, 100]) {
				for (const nonce of NONCES.slice(0, 150)) {
					const value = alert({ owner, level, nonce, recipes });
					for (const word of pages(value).flatMap((item) => item.words)) expect(pools[kindOfToken(word.token)], word.token).toContain(word.surface);
					// The Prompt: as many different words as its slots can have. A repeat is only what the Vocabulary forces.
					const prompt = value.prompt.words;
					const promptMost = most(prompt.map((word) => word.token), pools, new Set());
					expect(new Set(prompt.map((word) => word.surface)).size, value.prompt.lines.join("")).toBe(promptMost);
					if (promptMost === prompt.length) full += 1; else short += 1;
					if (wordOf(prompt, "v") !== undefined) withVerb += 1;
					// An Outcome: as many new words, none of them on the Prompt, as its newly drawn slots can have.
					const onPrompt = new Set(prompt.map((word) => word.surface));
					for (const outcome of Object.values(value.outcomes)) {
						const drawn = drawnOn(outcome, value.prompt);
						const drawnMost = most(drawn.map((word) => word.token), pools, onPrompt);
						const fresh = new Set(drawn.map((word) => word.surface).filter((surface) => !onPrompt.has(surface)));
						expect(fresh.size, `${value.prompt.lines.join("")} → ${outcome.lines.join("")}`).toBe(drawnMost);
						if (drawnMost === drawn.length) full += 1; else short += 1;
						if (wordOf(drawn, "v") !== undefined) withVerb += 1;
					}
				}
			}
		}
		expect(full).toBeGreaterThan(500);
		expect(withVerb).toBeGreaterThan(100);
		// Pages that had to repeat a word are in the sample too, and repeated no more than they had to.
		expect(short).toBeGreaterThan(100);
	});
});

describe("adjective and ナ-adjective slots (FAKE-ALERT-ADJ1)", () => {
	const kindOf = (name: string) => parseFakeAlertSlotToken(name)!.kind;
	/** The share of pages whose recipe needs the given kind of word. */
	const pagesNeeding = (owner: ManualMorphVocabulary, need: "needsAdjective" | "needsNa", levels: readonly number[], nonces: readonly number[] = NONCES) => {
		let needing = 0, total = 0;
		for (const level of levels) {
			for (const nonce of nonces) {
				for (const item of pages(alert({ owner, level, nonce }))) {
					total += 1;
					if (recipeOf(item.recipeId)[need]) needing += 1;
				}
			}
		}
		return needing / total;
	};
	/** A Vocabulary of WIDE_NOUNS with the given イ-adjectives and ナ-adjective stems, each written once. */
	const ownerWithAdjectives = async (adjectives: readonly string[], stems: readonly string[]) => {
		const text = [...WIDE_NOUNS.map((surface) => `${surface}。`), ...adjectives.map((surface) => `${surface}猫。`), ...stems.map((surface) => `${surface}な猫。`)].join("");
		return (await mintOwner([text], "uniform", [...ALERT_LEXICON, ...WIDE_NOUNS.map(noun), ...ADJECTIVE_LEXICON])).owner;
	};

	it("offers regular イ-adjectives in their basic form and ナ-adjective stems as written, and never one that cannot be used", async () => {
		const lexicon = [
			...ALERT_LEXICON, na,
			// 高い is seen in two forms; いい is 形容詞・イイ, which the closed rule refuses; 白い is 非自立 here.
			token("高かっ", "形容詞", "自立", { baseForm: "高い", conjugationType: "形容詞・アウオ段", conjugationForm: "連用タ接続" }),
			token("高い", "形容詞", "自立", { baseForm: "高い", conjugationType: "形容詞・アウオ段", conjugationForm: "基本形" }),
			token("美しい", "形容詞", "自立", { baseForm: "美しい", conjugationType: "形容詞・イ段", conjugationForm: "基本形" }),
			token("いい", "形容詞", "自立", { baseForm: "いい", conjugationType: "形容詞・イイ", conjugationForm: "基本形" }),
			token("白い", "形容詞", "非自立", { baseForm: "白い", conjugationType: "形容詞・アウオ段", conjugationForm: "基本形" }),
			token("た", "助動詞", "*"),
			// 静か and 無慈悲 are stems; こんな, 同じ and かたくな cannot take な.
			naStem("静か"), naStem("無慈悲"), naStem("こんな"), naStem("そんな"), naStem("どんな"), naStem("同じ"), naStem("おんなじ"), naStem("かたくな"),
		];
		const text = "猫は高かった。高い犬。美しい桜。いい封筒。白い時計。静かな猫。無慈悲な犬。こんな。そんな。どんな。同じ。おんなじ。かたくな。";
		const owner = (await mintOwner([text], "uniform", lexicon)).owner;
		const words = fakeAlertWords(owner)!;
		expect(words.adjectives).toEqual(["美しい", "高い"].sort());
		expect(words.na).toEqual(["無慈悲", "静か"].sort());
		expect(NA_STEM_EXCLUDED).toEqual(["おんなじ", "こんな", "そんな", "どんな", "同じ"]);
		// Every stem stays a noun, the left-out ones included: only the な use is closed to them.
		for (const stem of ["静か", "無慈悲", "こんな", "そんな", "どんな", "同じ", "おんなじ", "かたくな"]) expect(words.nouns, stem).toContain(stem);
		for (const stem of words.na) expect(words.nouns).toContain(stem);
		expect([words.sahen, words.verbs]).toEqual([[], []]);
		expect(Object.isFrozen(words.adjectives) && Object.isFrozen(words.na)).toBe(true);
		const rich = fakeAlertWords(await richOwner())!;
		expect([rich.adjectives, rich.na]).toEqual([[], []]);
	});

	it("fills an adjective slot only with an adjective and a na slot only with a stem, at every level", async () => {
		const owner = await fullOwner();
		const words = fakeAlertWords(owner)!;
		expect([words.adjectives, words.na]).toEqual([[...MANY_ADJECTIVES].sort(), [...MANY_NA].sort()]);
		const pools = { n: words.nouns, s: words.sahen, v: words.verbs, i: words.adjectives, na: words.na };
		const drawn = { i: new Set<string>(), na: new Set<string>() };
		const recipes = new Set<string>();
		for (const level of [0, 25, 50, 75, 100]) {
			for (const nonce of NONCES) {
				for (const item of pages(alert({ owner, level, nonce }))) {
					const recipe = recipeOf(item.recipeId);
					if (recipe.needsAdjective || recipe.needsNa) recipes.add(item.recipeId);
					// Each line is the recipe's fixed text with the page's words in its slots: nothing is inflected.
					expect(item.lines).toEqual(recipe.lines.map((line) => line.map((segment) =>
						typeof segment === "string" ? segment : item.words.find((word) => word.token === segment.token)!.surface).join("")));
					for (const word of item.words) {
						const kind = kindOf(word.token);
						expect(pools[kind], `${word.token} ${word.surface}`).toContain(word.surface);
						if (kind === "i" || kind === "na") drawn[kind].add(word.surface);
						// A noun slot may hold a stem, which is a noun too, but never an adjective.
						if (kind === "n" || kind === "s" || kind === "v") expect(MANY_ADJECTIVES as readonly string[], word.token).not.toContain(word.surface);
					}
				}
			}
		}
		expect([[...drawn.i].sort(), [...drawn.na].sort()]).toEqual([[...MANY_ADJECTIVES].sort(), [...MANY_NA].sort()]);
		// Every standard recipe that needs one of the two kinds is drawn somewhere.
		const set = standardFakeAlertRecipes();
		const seeded = [...set.prompts, ...set.terminals, ...set.outcomes].filter((entry) => entry.needsAdjective || entry.needsNa).map((entry) => entry.id);
		expect(seeded).toHaveLength(37);
		// A one-shot recipe is rare below 100 since option C (data version 5): look further at 100 for the ones not yet seen.
		for (let nonce = 1; nonce <= 20000 && seeded.some((id) => !recipes.has(id)); nonce += 1) {
			for (const item of pages(alert({ owner, level: 100, nonce }))) {
				const recipe = recipeOf(item.recipeId);
				if (recipe.needsAdjective || recipe.needsNa) recipes.add(item.recipeId);
			}
		}
		expect(seeded.filter((id) => !recipes.has(id))).toEqual([]);
		expect([...recipes].sort()).toEqual([...seeded].sort());
		for (const level of LEVELS) for (const nonce of NONCES.slice(0, 6)) expect(generateFakeAlert({ owner, level, nonce }).ok, String(level)).toBe(true);
	});

	it("uses no adjective or na recipe without such a word, and draws exactly as before then", async () => {
		for (const owner of [await richOwner(), await nounOnlyOwner(), await manyVerbOwner()]) {
			for (const level of [0, 25, 50, 75, 100]) {
				for (const nonce of NONCES.slice(0, 40)) {
					for (const item of pages(alert({ owner, level, nonce }))) {
						expect([recipeOf(item.recipeId).needsAdjective, recipeOf(item.recipeId).needsNa], item.recipeId).toEqual([false, false]);
					}
				}
			}
		}
		// One kind without the other: only the recipes of the kind the Vocabulary has.
		const adjectivesOnly = await ownerWithAdjectives(MANY_ADJECTIVES, []), stemsOnly = await ownerWithAdjectives([], MANY_NA);
		expect([pagesNeeding(adjectivesOnly, "needsAdjective", [50]) > 0, pagesNeeding(adjectivesOnly, "needsNa", [50])]).toEqual([true, 0]);
		expect([pagesNeeding(stemsOnly, "needsAdjective", [50]), pagesNeeding(stemsOnly, "needsNa", [50]) > 0]).toEqual([0, true]);
		// Level 0 has them too, and its contract holds: plain families, and Outcomes that keep the Prompt's words.
		expect(pagesNeeding(await fullOwner(), "needsAdjective", [0])).toBeGreaterThan(0);
		expect(pagesNeeding(await fullOwner(), "needsNa", [0])).toBeGreaterThan(0);
	});

	it.each([
		["イ-adjectives", "needsAdjective", (count: number) => [MANY_ADJECTIVES.slice(0, count), []] as const, FAKE_ALERT_ADJECTIVE_FULL_POOL],
		["ナ-adjective stems", "needsNa", (count: number) => [[], MANY_NA.slice(0, count)] as const, FAKE_ALERT_NA_FULL_POOL],
	] as const)("makes recipes that need %s rarer while they are few, never forbids them, and changes nothing from the full pool up", async (_name, need, pick, full) => {
		expect(full).toBe(20);
		const owner = async (count: number) => {
			const [adjectives, stems] = pick(count);
			return ownerWithAdjectives(adjectives, stems);
		};
		const [one, five, twenty, more] = [await owner(1), await owner(5), await owner(full), await owner(24)];
		const levels = [25, 50, 75, 100];
		// One word counts at (1 / 20)², a few pages in ten thousand: 300 nonces could see none (recipe data 4 did).
		const nonces = Array.from({ length: 3000 }, (_value, index) => (index * 2654435761) >>> 0);
		const p1 = pagesNeeding(one, need, levels, nonces);
		await yieldToEventLoop();
		const p5 = pagesNeeding(five, need, levels, nonces);
		await yieldToEventLoop();
		const p20 = pagesNeeding(twenty, need, levels, nonces);
		expect(p1).toBeGreaterThan(0);
		expect(p1).toBeLessThan(p5);
		expect(p5).toBeLessThan(p20 / 4);
		const recipes = (value: ManualMorphVocabulary) => NONCES.slice(0, 150).map((nonce) => pages(alert({ owner: value, level: 60, nonce })).map((item) => item.recipeId));
		expect(recipes(more)).toEqual(recipes(twenty));
	}, 60_000); // About 4 s alone on Linux (TEST-STABILITY1).

	it("counts a recipe that needs two scarce kinds at both shares", async () => {
		// Two terminals of one family and equal weight: one needs stems, the other stems and sahen nouns.
		const recipes = compiled(edited((input) => {
			recipe(input, "t-one").lines = ["{n1}は{na1}すぎます。"];
			input.terminals.push({ id: "t-two", family: "blurt", enabled: true, kind: "information", weight: 1, lines: ["{na1}な{n1}が{na2}に{s1}しています。"] });
		}));
		// The rich fixture has five sahen nouns; the stems are a full pool, or ten.
		const owner = async (stems: number) =>
			(await mintOwner([RICH_TEXT + MANY_NA.slice(0, stems).map((surface) => `${surface}な猫。`).join("")], "uniform", [...ALERT_LEXICON, ...ADJECTIVE_LEXICON])).owner;
		const counts = (value: ManualMorphVocabulary) => {
			const seen = { "t-one": 0, "t-two": 0 };
			for (const level of [50, 75, 100]) {
				for (let nonce = 1; nonce <= 1500; nonce += 1) {
					const id = alert({ owner: value, level, nonce, recipes }).prompt.recipeId;
					if (id === "t-one" || id === "t-two") seen[id] += 1;
				}
			}
			return seen;
		};
		// A full pool of stems: the second recipe counts at the sahen share alone, (5 / 20)² = 1 / 16 of the first.
		const full = counts(await owner(24));
		expect(full["t-one"]).toBeGreaterThan(500);
		expect(full["t-two"] / full["t-one"]).toBeGreaterThan(0.03);
		expect(full["t-two"] / full["t-one"]).toBeLessThan(0.11);
		// Ten stems: both count at (10 / 20)², so their ratio is the same, and both are rarer than a noun-only prompt was.
		const half = counts(await owner(10));
		expect(half["t-one"]).toBeLessThan(full["t-one"]);
		expect(half["t-two"] / half["t-one"]).toBeGreaterThan(0.02);
		expect(half["t-two"] / half["t-one"]).toBeLessThan(0.13);
	});

	// A stem is always a noun as well, and a `{{…}}` term makes a noun of an adjective's or a verb's basic form.
	const VERBS = [verb("歩く", "五段・カ行イ音便"), verb("読む", "五段・マ行")];
	const overlapOwner = async (text: string) => (await mintOwner([text], "uniform", [...ALERT_LEXICON, ...VERBS, ...ADJECTIVE_LEXICON], true)).owner;
	const HEAVY = 4000;
	const heavyRecipes = compiled(edited((input) => {
		recipe(input, "p-noun").lines = ["{n1}を必要としていますか？"];
		for (const [id, line] of [
			["p-n-na", "{n1}は{na1}ですか？"], ["p-na-n", "{na1}な{n1}が見つかりました。"], ["p-n-i", "{n1}は{i1}ですか？"], ["p-i-n", "{i1}{n1}を削除しますか？"],
			["p-n-n-na", "{n1}と{n2}は{na1}ですか？"], ["p-na-n-na-n", "{na1}な{n1}は{na2}な{n2}ですか？"], ["p-i-n-v", "{i1}{n1}が{v1}おそれがあります。"],
			["p-n-na-i", "{n1}は{na1}で、{i1}ですか？"], ["p-v-n-na", "{v1}{n1}は{na1}ですか？"],
		] as const) {
			input.prompts.push({ id, family: "ask", enabled: true, kind: "confirmation", buttons: "yes-no", weight: HEAVY, lines: [line] });
		}
		for (const [id, family, line] of [
			["o-n-na", "fine", "{n1}は{+na1}です。"], ["o-i-n-na", "fine", "{+i1}{+n1}は{+na1}です。"],
			["o-v-n-i", "stop", "{+v1}{n1}は{+i1}です。"], ["o-na-n-na", "stop", "{na1}な{+n1}は{+na1}でした。"],
		] as const) {
			input.outcomes.push({ id, family, enabled: true, kind: "information", weight: HEAVY, lines: [line] });
		}
	}));
	type Kind = "n" | "s" | "v" | "i" | "na";
	/** The most of these tokens that can each take an unused word of their own kind, all different: a plain search, not the core's rule. */
	function most(tokens: readonly string[], pools: Record<Kind, readonly string[]>, used: ReadonlySet<string>): number {
		if (tokens.length === 0) return 0;
		const [first, ...rest] = tokens;
		let best = most(rest, pools, used);
		for (const word of pools[kindOf(first!)]) {
			if (!used.has(word)) best = Math.max(best, 1 + most(rest, pools, new Set([...used, word])));
		}
		return best;
	}

	it("counts the slots of several kinds together when their words are shared", async () => {
		// 動詞・名詞・語幹 の順に引く。動詞が 歩く を取ると、名詞の slot と語幹の slot に残るのは 静か だけになる。
		const owner = await overlapOwner("{{歩く}}。歩く。読む。静かな。");
		expect(fakeAlertWords(owner)).toEqual({ nouns: ["歩く", "静か"].sort(), sahen: [], verbs: ["歩く", "読む"].sort(), adjectives: [], na: ["静か"] });
		// Two verbs and one stem make this recipe count at (2 / 20)² × (1 / 20)², so it is weighed up far enough to be drawn.
		const recipes = compiled(edited((input) => {
			recipe(input, "p-noun").lines = ["{n1}を必要としていますか？"];
			input.prompts.push({ id: "p-v-n-na", family: "ask", enabled: true, kind: "confirmation", buttons: "yes-no", weight: 4_000_000, lines: ["{v1}{n1}は{na1}ですか？"] });
		}));
		let seen = 0;
		for (const nonce of NONCES) {
			const prompt = alert({ owner, level: 0, nonce, recipes }).prompt;
			if (prompt.recipeId !== "p-v-n-na") continue;
			seen += 1;
			expect(prompt.lines).toEqual(["読む歩くは静かですか？"]);
		}
		expect(seen).toBeGreaterThan(200);
	});

	it("keeps the only stem for the na slot although every stem is a noun too", async () => {
		// 名詞 {猫, 静か}、語幹 {静か}: the noun slot is written first and must leave 静か to the na slot.
		const owner = await overlapOwner("猫。静かな猫。");
		expect(fakeAlertWords(owner)).toEqual({ nouns: ["猫", "静か"].sort(), sahen: [], verbs: [], adjectives: [], na: ["静か"] });
		let seen = 0;
		for (const nonce of NONCES) {
			const prompt = alert({ owner, level: 0, nonce, recipes: heavyRecipes }).prompt;
			if (prompt.recipeId !== "p-n-na") continue;
			seen += 1;
			expect(prompt.lines).toEqual(["猫は静かですか？"]);
		}
		expect(seen).toBeGreaterThan(20);
	});

	it.each([
		["one stem and one other noun", "猫。静かな猫。"],
		["two stems and one other noun", "猫。静かな猫。無慈悲な猫。"],
		["every noun is a stem", "静かな。無慈悲な。容易な。"],
		["an adjective that is also a noun, and one other noun", "猫。{{高い}}。高い猫。"],
		// 名詞 {歩く, 静か}、語幹 {静か}、動詞 {歩く, 読む}: a verb slot must leave 歩く to the noun slot, because the noun
		// and na slots need two nouns between them. Neither kind alone shows that; only the two counted together do.
		["two nouns, one a stem and one also a verb, and another verb", "{{歩く}}。歩く。読む。静かな。"],
		["an adjective and a verb that are nouns too, a stem and a noun", "猫。{{高い}}。高い猫。{{歩く}}。歩く。静かな犬。"],
		["two adjectives, one also a noun, two stems, two verbs and a sahen noun", "猫を観察する。{{高い}}。高い。白い。静かな。無慈悲な。歩く。読む。"],
	] as const)("gives as many slots a word of their own as the Vocabulary allows, over five kinds (%s)", async (_name, text) => {
		const owner = await overlapOwner(text);
		const words = fakeAlertWords(owner)!;
		const pools = { n: words.nouns, s: words.sahen, v: words.verbs, i: words.adjectives, na: words.na };
		let full = 0, short = 0, scarce = 0;
		for (const recipes of [heavyRecipes, standardFakeAlertRecipes()]) {
			for (const level of [0, 13, 26, 50, 75, 100]) {
				for (const nonce of NONCES.slice(0, 150)) {
					const value = alert({ owner, level, nonce, recipes });
					for (const word of pages(value).flatMap((item) => item.words)) expect(pools[kindOf(word.token)], word.token).toContain(word.surface);
					const prompt = value.prompt.words;
					const promptMost = most(prompt.map((word) => word.token), pools, new Set());
					expect(new Set(prompt.map((word) => word.surface)).size, value.prompt.lines.join("")).toBe(promptMost);
					if (promptMost === prompt.length) full += 1; else short += 1;
					if (prompt.some((word) => kindOf(word.token) === "i" || kindOf(word.token) === "na")) scarce += 1;
					const onPrompt = new Set(prompt.map((word) => word.surface));
					for (const outcome of Object.values(value.outcomes)) {
						const drawn = outcome.words.filter((word) => !prompt.some((entry) => entry.token === word.token && entry.surface === word.surface));
						const drawnMost = most(drawn.map((word) => word.token), pools, onPrompt);
						const fresh = new Set(drawn.map((word) => word.surface).filter((surface) => !onPrompt.has(surface)));
						expect(fresh.size, `${value.prompt.lines.join("")} → ${outcome.lines.join("")}`).toBe(drawnMost);
						if (drawnMost === drawn.length) full += 1; else short += 1;
						if (drawn.some((word) => kindOf(word.token) === "i" || kindOf(word.token) === "na")) scarce += 1;
					}
				}
			}
		}
		expect(full).toBeGreaterThan(500);
		expect(short).toBeGreaterThan(100);
		expect(scarce).toBeGreaterThan(100);
	});
});

describe("the very rare persona terminals, slotless questions and repeat outcomes (FAKE-ALERT-RECIPES2)", () => {
	const PERSONA = ["わかりません。", "多分できません。", "私のせいではありません。", "いやです。", "……ごめん。"];
	const SLOTLESS = ["本当に？", "なぜですか？", "大丈夫ですか？"];
	// Hundreds of thousands of Alerts: the loops let the event loop run every YIELD_EVERY Alerts (TEST-STABILITY1).
	const YIELD_EVERY = 1000;
	const firstFamilies = async (owner: ManualMorphVocabulary, level: number, count: number, from = 1) => {
		const seen = new Map<string, number>();
		for (let nonce = from; nonce < from + count; nonce += 1) {
			if (nonce % YIELD_EVERY === 0) await yieldToEventLoop();
			const family = alert({ owner, level, nonce }).prompt.family;
			seen.set(family, (seen.get(family) ?? 0) + 1);
		}
		return seen;
	};

	it("weighs the first-stage families as option C chose, beside a persona family of weight 5 and drift 3", () => {
		const weightOf = (id: string) => [familyOf(id).weight, familyOf(id).drift];
		// Data version 3 had 10, 8, 6 and three terminal families of 1 at drift 2. Option C (owner decision, record §5):
		// the prompt families twice as heavy and the terminal families at drift 3, all three times over so that the
		// persona family keeps the share it had in data version 4 with a whole weight (5 instead of 1).
		expect(["confirm", "notice", "question", "report", "refusal", "prohibition"].map(weightOf)).toEqual([[600, 0], [480, 0], [360, 1], [30, 3], [30, 3], [30, 3]]);
		expect([familyOf("persona").stage, ...weightOf("persona")]).toEqual(["terminal", 5, 3]);
		expect(familyOf("persona").recipes.map((entry) => entry.lines.map((line) => line.map((segment) => typeof segment === "string" ? segment : `{${segment.token}}`).join("")).join("")))
			.toEqual(expect.arrayContaining(PERSONA));
		for (const entry of familyOf("persona").recipes) expect(entry.lines.flat().filter((segment) => typeof segment !== "string").map((slot) => slot.kind)).not.toContain("s");
		expect([familyOf("repeat").stage, familyOf("repeat").drift, familyOf("repeat").on]).toEqual(["outcome", 1, "affirm"]);
	});

	it("never shows a persona terminal at 25 or below, and shows one about as often as the table says above", async () => {
		const owner = await fullOwner();
		for (const level of [0, 10, 25]) expect((await firstFamilies(owner, level, 3000)).get("persona") ?? 0, String(level)).toBe(0);
		// Every recipe is fully available here, so the share is the table's: 40 / (1,200 + 960 + 2,160 + 720 + 40) ≈ 0.79%
		// at 100, 20 / 7,580 ≈ 0.26% at 75. Forty thousand Alerts keep more than three standard deviations inside these bounds.
		const at100 = ((await firstFamilies(owner, 100, 40000)).get("persona") ?? 0) / 40000;
		expect(at100).toBeGreaterThan(0.0063);
		expect(at100).toBeLessThan(0.0093);
		const at75 = ((await firstFamilies(owner, 75, 40000)).get("persona") ?? 0) / 40000;
		expect(at75).toBeGreaterThan(0.0019);
		expect(at75).toBeLessThan(0.0037);
		// The persona terminals of the owner's list appear, with no word in them.
		const shown = new Set<string>();
		for (let nonce = 1; shown.size < PERSONA.length && nonce < 400000; nonce += 1) {
			if (nonce % YIELD_EVERY === 0) await yieldToEventLoop();
			const value = alert({ owner, level: 100, nonce });
			if (value.prompt.family === "persona" && PERSONA.includes(value.prompt.lines.join(""))) {
				expect([value.shape, value.prompt.words, Object.keys(value.outcomes)]).toEqual(["terminal", [], []]);
				shown.add(value.prompt.lines.join(""));
			}
		}
		expect([...shown].sort()).toEqual([...PERSONA].sort());
	}, 120_000); // About 15 s alone on Linux and up to 28 s on Windows; more under load (TEST-STABILITY1).

	it("asks a question about nothing only above 0, with Yes and No, and answers it like any other prompt", async () => {
		const owner = await richOwner();
		const asked = (level: number) => NONCES.map((nonce) => alert({ owner, level, nonce })).filter((value) => SLOTLESS.includes(value.prompt.lines.join("")));
		expect(asked(0)).toEqual([]);
		const high = [...asked(50), ...asked(100)];
		expect(high.length).toBeGreaterThan(0);
		for (const value of high) {
			expect([value.prompt.family, value.prompt.kind, [...value.prompt.buttons].sort(), value.prompt.words]).toEqual(["question", "confirmation", ["no", "yes"], []]);
			expect(Object.keys(value.outcomes).sort()).toEqual(["no", "yes"]);
		}
	});

	it("repeats the same state only for an affirmative button above 0, keeping the Prompt's word at low levels", async () => {
		const owner = await richOwner();
		let repeats = 0;
		for (const level of [0, 25, 50, 100]) {
			for (const nonce of NONCES) {
				const value = alert({ owner, level, nonce });
				for (const [button, outcome] of Object.entries(value.outcomes)) {
					if (outcome.family !== "repeat") continue;
					expect(level, outcome.lines.join("")).toBeGreaterThan(0);
					expect(FAKE_ALERT_BUTTON_ROLES[button as keyof typeof FAKE_ALERT_BUTTON_ROLES] === "affirm" || level >= 50, button).toBe(true);
					repeats += 1;
				}
			}
		}
		expect(repeats).toBeGreaterThan(20);
		// 名詞が間違っています。 → また名詞が間違っています。: the same word comes back.
		// The pair must be found: an optional check here passed without running (RECIPES2 independent review 1, P3).
		let wrong: FakeAlert | undefined;
		for (let nonce = 1; wrong === undefined && nonce <= 50000; nonce += 1) {
			const value = alert({ owner, level: 25, nonce });
			if (value.prompt.recipeId === "notice-wrong" && value.outcomes.ok?.recipeId === "repeat-wrong") wrong = value;
		}
		expect(wrong).toBeDefined();
		expect(wrong!.outcomes.ok!.lines[0]).toBe(`また${wrong!.prompt.lines[0]}`);
		expect(wrong!.outcomes.ok!.words).toEqual(wrong!.prompt.words);
	});
});

describe("the pinned Fake Alert regression oracle", () => {
	type Case = { readonly vocabulary: "rich-frequency" | "noun-only" | "verbs-frequency" | "full-frequency"; readonly level: number; readonly nonce: number; readonly alert: unknown };
	// Regenerate only on purpose: when the standard recipe data version or the algorithm version changes.
	// FAKE-ALERT-VARIETY1 (owner decision, before any release of Fake Alert) changed algorithm 1's draw for a
	// Vocabulary with fewer sahen nouns than the full pool: 17 of the 21 rich cases (5 sahen nouns) moved; the 21
	// noun-only cases, which use no sahen recipe, did not. Previous pin: baf10fae…34dc.
	// FAKE-ALERT-VERB1 raised the recipe data to version 2 (verb recipes). The 42 earlier cases, whose Vocabularies
	// have no regular verb, did not move; 21 cases of a Vocabulary with a full pool of verbs were added.
	// Previous pin: 79e0a08d…3ad8.
	// FAKE-ALERT-ADJ1 raised the recipe data to version 3 (イ-adjective and ナ-adjective recipes). The 63 earlier
	// cases, whose Vocabularies have neither kind of word, did not move; 63 cases of a Vocabulary with a full pool
	// of every kind were added (nine nonces a level, so that recipes of the new kinds are among them).
	// Previous pin: 00a22fa2…c5bd.
	// FAKE-ALERT-RECIPES2 raised the recipe data to version 4 (more recipes in every family, the repeat and persona
	// families, and the first-stage family weights times ten). The case list is unchanged; 121 of the 126 cases
	// moved (rich 18 / 21, noun-only 20 / 21, verbs 20 / 21, full 63 / 63), because a family draws among more
	// recipes. Previous pin: 9d34c723…2e50.
	// Recipe data version 5 (option C, owner decision: the prompt families twice as heavy, the one-shot families at
	// drift 3, persona weight 5 to keep its share) changes only the first-stage family weights: 8 of the 126 cases
	// moved from version 4 (rich 1, noun-only 2, verbs 1, full 4). Previous pin: 165eae05…0b94.
	const FIXTURE = readPinnedFixture<{ readonly recipeDataVersion: number; readonly algorithmVersion: number; readonly cases: readonly Case[] }>(
		"fakeAlertCore", "ffaf90b18ad7584955baf3d95e9368257c048293b175d07c04cb64398dd11fbe");

	it("still draws exactly the recorded Alerts for the current data version and algorithm 1", async () => {
		expect([FIXTURE.recipeDataVersion, FIXTURE.algorithmVersion]).toEqual([standardFakeAlertRecipes().dataVersion, FAKE_ALERT_ALGORITHM_VERSION]);
		const owners = {
			"rich-frequency": await richOwner("frequency"), "noun-only": await nounOnlyOwner(),
			"verbs-frequency": await manyVerbOwner("frequency"), "full-frequency": await fullOwner("frequency"),
		};
		expect(new Set(FIXTURE.cases.map((entry) => entry.vocabulary))).toEqual(new Set(Object.keys(owners)));
		const shape = (value: FakeAlert) => ({
			shape: value.shape,
			pages: pages(value).map((item) => ({ recipeId: item.recipeId, kind: item.kind, buttons: item.buttons, lines: item.lines })),
		});
		for (const entry of FIXTURE.cases) {
			expect(shape(alert({ owner: owners[entry.vocabulary], level: entry.level, nonce: entry.nonce })), `${entry.vocabulary} ${entry.level} ${entry.nonce}`).toEqual(entry.alert);
		}
		expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(30);
		// The cases of the full Vocabulary hold recipes of the kinds FAKE-ALERT-ADJ1 added.
		const pinned = new Set(FIXTURE.cases.flatMap((entry) => (entry.alert as { pages: { recipeId: string }[] }).pages.map((item) => item.recipeId)));
		expect([...pinned].filter((id) => recipeOf(id).needsAdjective).length).toBeGreaterThanOrEqual(3);
		expect([...pinned].filter((id) => recipeOf(id).needsNa).length).toBeGreaterThanOrEqual(3);
	});
});

describe("the Fake Alert core stays pure, and only the View reaches it", () => {
	it("reaches no DOM, Obsidian, tokenizer engine, compiler or build script, and holds no clock or global randomness", async () => {
		const result = await build({ entryPoints: ["src/fakeAlert/fakeAlertCore.ts"], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm", legalComments: "none" });
		const inputs = Object.keys(result.metafile.inputs);
		expect(inputs.filter((name) => /obsidian|src\/view\/|src\/render\/|src\/tokenizer\/lindera|compileRecipeSet|scripts\/|resources\//u.test(name))).toEqual([]);
		expect(inputs.filter((name) => name.startsWith("src/fakeAlert/")).sort()).toEqual([
			"src/fakeAlert/fakeAlertCore.ts", "src/fakeAlert/fakeAlertLevel.ts", "src/fakeAlert/fakeAlertVersions.ts",
			"src/fakeAlert/generated/standardFakeAlertRecipes.ts", "src/fakeAlert/recipeData.ts", "src/fakeAlert/recipeSet.ts",
		]);
		// VERB1: of the MAX modules it reaches only the pure realizer leaf, for the `verb-basic` rule; and no Collision module.
		// LEXEME-SHARE1: it reaches that leaf through the shared lists, which it reads its verbs, イ-adjectives and stems from.
		expect(inputs.filter((name) => /src\/transform\/max[A-Z]/u.test(name))).toEqual(["src/transform/maxRealizer.ts"]);
		expect(inputs).toContain("src/vocabulary/lexicalProjection.ts");
		expect(inputs.filter((name) => name.startsWith("src/collision/"))).toEqual([]);
		const code = result.outputFiles[0]!.text;
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date\(|fetch\(|document\.|window\.|console\.|eval\(|new Function/u);
	});

	// CORE1 pinned that no plugin entry point reached the core. VIEW1 connects it, and only the View and its dialog import it.
	it("is reached from the plugin entry points only through the View and the Fake Alert dialog", async () => {
		for (const entryPoint of ["src/main.ts", "src/SemantropyPlugin.ts"]) {
			const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
				external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
			const inputs = result.metafile.inputs;
			expect(Object.keys(inputs).filter((name) => name.startsWith("src/fakeAlert/")).sort()).toEqual(
				FAKE_ALERT_VIEW1_ADDED.filter((name) => name.startsWith("src/fakeAlert/")).sort());
			const importers = Object.entries(inputs)
				.filter(([name, input]) => !name.startsWith("src/fakeAlert/") && input.imports.some((entry) => entry.path.startsWith("src/fakeAlert/")))
				.map(([name]) => name).sort();
			expect(importers).toEqual(["src/view/FakeAlertModal.ts", "src/view/SemantropyView.ts"]);
		}
		expect(await readFile("src/fakeAlert/fakeAlertVersions.ts", "utf8")).toMatch(/FAKE_ALERT_ALGORITHM_VERSION = 1;/u);
	});
});
