import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	generateCollisionResults,
	generateLockedCollisionResult,
	type CollisionGenerationResult,
	type CollisionResultDraft,
	type CollisionSegment,
} from "../src/collision/collisionCore";
import type { CollisionLexemePool } from "../src/collision/collisionLexemePool";
import { buildAuthenticatedCollisionLexemePool } from "../src/collision/collisionVocabulary";
import { compileCollisionPatternSet, type CompiledCollisionPatternSet } from "../src/collision/compilePatternSet";
import {
	STANDARD_COLLISION_CONNECTORS,
	STANDARD_COLLISION_LITERALS,
	STANDARD_COLLISION_MODIFIER_FORMS,
	STANDARD_COLLISION_NOUN_SUFFIXES,
	STANDARD_COLLISION_PATTERN_DATA_VERSION,
	STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
	STANDARD_COLLISION_RECIPES,
} from "../src/collision/generated/standardCollisionPatternEntries";
import type { RawCollisionRecipe } from "../src/collision/patternData";
import type { JapaneseToken, JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../src/transform/manualMorphology";
import type { VocabularyDrawMode } from "../src/vocabulary/vocabularySnapshot";

/*
 * COLLISION-LOCK1, the generation layer. A result keeps the parts it was joined from; a row can be regenerated with some
 * of its words kept. The core trusts nothing it is handed, so a row it did not make is refused, and a generation that
 * keeps nothing is the generation it always was (the digest below was taken from the code before this slice).
 */

function patternWith(recipes: readonly RawCollisionRecipe[]): CompiledCollisionPatternSet {
	const result = compileCollisionPatternSet({
		schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
		dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION,
		recipes,
		literals: STANDARD_COLLISION_LITERALS,
		connectors: STANDARD_COLLISION_CONNECTORS,
		modifierForms: STANDARD_COLLISION_MODIFIER_FORMS,
		nounSuffixes: STANDARD_COLLISION_NOUN_SUFFIXES,
	});
	if (!result.ok) throw new Error(`the fixture pattern set must compile: ${result.issues.map((issue) => `${issue.code}/${issue.id}`).join(", ")}`);
	return result.set;
}
const recipe = (partial: Pick<RawCollisionRecipe, "id" | "parts"> & Partial<RawCollisionRecipe>): RawCollisionRecipe =>
	({ label: partial.id, enabled: true, selectable: true, weight: 1, presence: [], ...partial });
const NOUN = (slotId: string) => ({ kind: "noun", slotId, optional: false });
const CONNECTOR = (slotId: string) => ({ kind: "connector", slotId, optional: false });
const LITERAL = (slotId: string, literalId: string) => ({ kind: "literal", slotId, optional: false, literalId });
const MODIFIER = (slotId: string, profile: string, optional = false) => ({ kind: "modifier", slotId, optional, profile });
const PREDICATE = (slotId: string) => ({ kind: "predicate", slotId, optional: false, profile: "regular-verb-basic" });

/** The shapes the tests need: an optional modifier, two nouns with a Connector between, a literal and a predicate. */
const RICH = recipe({
	id: "rich",
	parts: [MODIFIER("m1", "all", true), NOUN("n1"), CONNECTOR("c1"), NOUN("n2"), LITERAL("l1", "topic-link"), PREDICATE("v1")],
	presence: [{ slots: [], weight: 1 }, { slots: ["m1"], weight: 1 }],
});
const PAIR = recipe({ id: "pair", parts: [NOUN("n1"), CONNECTOR("c1"), NOUN("n2")] });
const TRIPLE = recipe({ id: "triple", parts: [NOUN("n1"), NOUN("n2"), NOUN("n3")] });
const SINGLE = recipe({ id: "single", parts: [NOUN("n1")] });
const RICH_SET = patternWith([RICH]);
const PAIR_SET = patternWith([PAIR]);
const TRIPLE_SET = patternWith([TRIPLE]);
const STANDARD_SET = patternWith(STANDARD_COLLISION_RECIPES);

const tok = (surface: string, overrides: Partial<JapaneseToken> = {}): JapaneseToken =>
	({ surface, pos: "名詞", detail1: "一般", detail2: "*", detail3: "*", conjugationType: "*", conjugationForm: "*", baseForm: surface, isUnknown: false, ...overrides });
const verb = (surface: string, conjugationType = "五段・ラ行") =>
	tok(surface, { pos: "動詞", detail1: "自立", conjugationType, conjugationForm: "基本形", baseForm: surface });
const adjective = (surface: string) =>
	tok(surface, { pos: "形容詞", detail1: "自立", conjugationType: "形容詞・アウオ段", conjugationForm: "基本形", baseForm: surface });
const RICH_TOKENS = [tok("都市"), tok("庭"), tok("鏡"), tok("記憶"), tok("東京", { detail1: "固有名詞", detail2: "地域" }), tok("変化", { detail1: "サ変接続" }),
	tok("崩壊", { detail1: "サ変接続" }), tok("静か", { detail1: "形容動詞語幹" }), verb("眠る"), verb("壊れる", "一段"), adjective("赤い"), adjective("青い")];

async function poolOf(tokens: readonly JapaneseToken[], patternSet: CompiledCollisionPatternSet, drawMode: VocabularyDrawMode = "uniform"): Promise<CollisionLexemePool> {
	const text = tokens.map((item) => item.surface).join("");
	const tokenizer: JapaneseTokenizer = { tokenize: (input) => {
		if (input !== text) throw new Error("unexpected run");
		return Promise.resolve(tokens.map((item) => ({ ...item })));
	} };
	const analyzed = await analyzeManualMorphSource({ text, sourcePath: "a.md", tokenizer });
	if (analyzed.status !== "ready") throw new Error(analyzed.status);
	const vocabulary = buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode });
	const built = buildAuthenticatedCollisionLexemePool({ vocabulary, patternData: patternSet });
	if (!built.ok) throw new Error(`the fixture pool must build: ${built.reason}`);
	return built.pool;
}

function made(pool: CollisionLexemePool, patternSet: CompiledCollisionPatternSet, recipeId: string, nonce: number, drawMode: VocabularyDrawMode = "uniform"): CollisionResultDraft {
	const result = generateCollisionResults({ pool, patternSet, drawMode, request: { kind: "fixed", recipeId }, count: 1, nonce });
	if (!result.ok || result.draft.results.length !== 1) throw new Error("the fixture row must be made");
	return result.draft.results[0]!;
}
type Lock = Parameters<typeof generateLockedCollisionResult>[0];
function relock(pool: CollisionLexemePool, patternSet: CompiledCollisionPatternSet, original: { recipeId: string; segments: readonly unknown[] }, locked: readonly string[], nonce: number, extra: Partial<Lock> = {}): CollisionGenerationResult {
	return generateLockedCollisionResult({ pool, patternSet, drawMode: "uniform", nonce, original: original as Lock["original"], locked, ...extra });
}
function one(result: CollisionGenerationResult): CollisionResultDraft {
	if (!result.ok) throw new Error(`refused: ${result.reason}`);
	expect(result.draft.results).toHaveLength(1);
	return result.draft.results[0]!;
}
const word = (row: { segments: readonly CollisionSegment[] }, slotId: string) => row.segments.find((segment) => segment.slotId === slotId)?.text;
const shape = (row: { segments: readonly CollisionSegment[] }) => row.segments.map((segment) => `${segment.kind}:${segment.slotId}`).join(" ");

describe("a result keeps the parts it was joined from", () => {
	it("joins its segments into its text, in the recipe's order, for every recipe of the standard set", async () => {
		const pool = await poolOf(RICH_TOKENS, STANDARD_SET);
		let rows = 0;
		for (const drawMode of ["uniform", "frequency"] as const) {
			const result = generateCollisionResults({ pool: drawMode === "uniform" ? pool : await poolOf(RICH_TOKENS, STANDARD_SET, drawMode), patternSet: STANDARD_SET, drawMode, request: { kind: "random" }, count: 50, nonce: 11 });
			if (!result.ok) throw new Error(result.reason);
			for (const row of result.draft.results) {
				const declared = STANDARD_SET.recipes.find((entry) => entry.id === row.recipeId)!;
				expect(row.segments.map((segment) => segment.text).join("")).toBe(row.text);
				// The segments are the recipe's parts in order; an optional modifier the row does not have is missing.
				const expected = declared.parts.map((part) => `${part.kind}:${part.slotId}`);
				const actual = row.segments.map((segment) => `${segment.kind}:${segment.slotId}`);
				expect(actual.filter((entry) => !entry.startsWith("modifier:"))).toEqual(expected.filter((entry) => !entry.startsWith("modifier:")));
				for (const part of declared.parts) if (part.kind === "modifier" && !part.optional) expect(actual).toContain(`modifier:${part.slotId}`);
				rows += 1;
			}
		}
		expect(rows).toBeGreaterThan(80);
	});

	it("names the form of a modifier and the Connector drawn, and keeps an empty Connector as an empty segment", async () => {
		const pool = await poolOf(RICH_TOKENS, PAIR_SET);
		const connectors = new Map<string, string>();
		for (let nonce = 0; nonce < 80; nonce++) {
			const row = made(pool, PAIR_SET, "pair", nonce);
			const connector = row.segments.find((segment) => segment.kind === "connector")!;
			if (connector.kind !== "connector") throw new Error("a connector segment");
			connectors.set(connector.connectorId, connector.text);
		}
		// Most Connectors are literals; "empty" is a real choice and shows as an empty text.
		expect(connectors.get("empty")).toBe("");
		expect(connectors.get("no")).toBe("の");
		const modified = made(await poolOf(RICH_TOKENS, STANDARD_SET), STANDARD_SET, "sahen-noun", 3);
		const modifier = modified.segments[0]!;
		expect(modifier.kind).toBe("modifier");
		expect(modifier.kind === "modifier" && modifier.formId).toMatch(/^sahen-/u);
	});

	it("is deeply frozen and carries nothing but the parts", async () => {
		const pool = await poolOf(RICH_TOKENS, RICH_SET);
		const row = made(pool, RICH_SET, "rich", 5);
		expect(Object.isFrozen(row.segments) && row.segments.every((segment) => Object.isFrozen(segment))).toBe(true);
		for (const segment of row.segments) expect(Object.keys(segment).sort().join(",")).toMatch(/^(kind,slotId,text|connectorId,kind,slotId,text|formId,kind,slotId,text)$/u);
	});
});

/** What the generation made before this slice, taken from the code at `a2d5766` (origin/main, before this slice) for the inputs below. */
const BEFORE_THIS_SLICE = "46cef72201e67d006c59427e1c72fc29cec45f77f369d2f724420b1ed7d069c0";

describe("a generation that keeps nothing is the generation it always was", () => {
	it("makes the same recipes, texts, signatures and limits as before for the same pool, set, mode, count and nonce", async () => {
		const lines: string[] = [];
		for (const [label, tokens, patternSet] of [["rich", RICH_TOKENS, STANDARD_SET], ["few", RICH_TOKENS.slice(0, 3), STANDARD_SET], ["rich-set", RICH_TOKENS, RICH_SET]] as const) {
			for (const drawMode of ["uniform", "frequency"] as const) {
				const pool = await poolOf(tokens, patternSet, drawMode);
				for (const nonce of [0, 1, 2, 3, 7, 11, 57, 101, 4_000_000_000]) for (const count of [1, 10, 50]) {
					const result = generateCollisionResults({ pool, patternSet, drawMode, request: { kind: "random" }, count, nonce });
					if (!result.ok) { lines.push(`${label} ${drawMode} ${nonce} ${count} refused ${result.reason}`); continue; }
					lines.push([label, drawMode, nonce, count, result.draft.status, result.draft.shortfallReason,
						...result.draft.results.map((row) => [row.recipeId, row.text, row.structureSignature, row.limited, row.limitedReason].join("|"))].join(" "));
				}
			}
		}
		expect(lines).toHaveLength(162);
		expect(createHash("sha256").update(lines.join("\n")).digest("hex")).toBe(BEFORE_THIS_SLICE);
	});
});

describe("a row regenerated with some of its words kept", () => {
	it("keeps the words that are kept, the recipe, the modifiers the row has, the Connector it drew and the fixed text, and changes the others", async () => {
		const pool = await poolOf(RICH_TOKENS, RICH_SET);
		let withModifier = 0, withoutModifier = 0;
		const changed = new Set<string>();
		for (let nonce = 0; nonce < 60; nonce++) {
			const original = made(pool, RICH_SET, "rich", nonce);
			const keep = [original.segments.find((segment) => segment.kind === "noun")!.slotId];
			const next = one(relock(pool, RICH_SET, original, keep, nonce + 1000));
			expect(next.recipeId).toBe("rich");
			expect(shape(next)).toBe(shape(original));
			expect(next.segments.map((segment) => segment.text).join("")).toBe(next.text);
			for (const segment of next.segments) {
				const before = original.segments.find((entry) => entry.slotId === segment.slotId)!;
				if (keep.includes(segment.slotId) || segment.kind === "connector" || segment.kind === "literal") expect(segment).toEqual(before);
				else if (segment.text !== before.text) changed.add(segment.slotId);
			}
			if (original.segments[0]!.kind === "modifier") withModifier++; else withoutModifier++;
		}
		// Both presences were exercised, and the words that are not kept do change.
		expect(withModifier).toBeGreaterThan(5); expect(withoutModifier).toBeGreaterThan(5);
		expect([...changed].sort()).toEqual(["m1", "n2", "v1"]);
	});

	it("keeps a modifier together with its form, a predicate, and several words at once", async () => {
		const pool = await poolOf(RICH_TOKENS, RICH_SET);
		let checked = 0;
		for (let nonce = 0; nonce < 200 && checked < 12; nonce++) {
			const original = made(pool, RICH_SET, "rich", nonce);
			if (original.segments[0]!.kind !== "modifier") continue;
			const next = one(relock(pool, RICH_SET, original, ["m1", "v1"], nonce + 7));
			expect(next.segments[0]).toEqual(original.segments[0]);
			expect(word(next, "v1")).toBe(word(original, "v1"));
			expect(word(next, "m1")).toBe(word(original, "m1"));
			checked++;
		}
		expect(checked).toBe(12);
	});

	it("gives a result the structure signature its own parts make: the recipe, the modifiers present, the Connectors and the forms", async () => {
		const pool = await poolOf(RICH_TOKENS, RICH_SET);
		const signatureOf = (row: { recipeId: string; segments: readonly CollisionSegment[] }) => JSON.stringify([
			row.recipeId,
			row.segments.filter((segment) => segment.kind === "modifier").map((segment) => segment.slotId),
			row.segments.flatMap((segment) => (segment.kind === "connector" ? [segment.connectorId] : [])),
			row.segments.flatMap((segment) => (segment.kind === "modifier" ? [segment.formId] : [])),
		]);
		let withModifier = 0;
		for (let nonce = 0; nonce < 80; nonce++) {
			const original = made(pool, RICH_SET, "rich", nonce);
			expect(original.structureSignature).toBe(signatureOf(original));
			// Keeping the modifier (with its form) and the noun leaves the shape, so the signature is the row's own.
			if (original.segments[0]!.kind === "modifier") {
				withModifier++;
				const kept = one(relock(pool, RICH_SET, original, ["m1", "n1"], nonce + 300));
				expect(kept.structureSignature).toBe(original.structureSignature);
				const parts = JSON.parse(kept.structureSignature) as unknown[];
				expect(parts[1]).toEqual(["m1"]);
				expect(parts[3]).toEqual([(original.segments[0] as { formId: string }).formId]);
			}
			// A modifier that is drawn again may take another form; the signature follows the parts it has now.
			const redrawn = one(relock(pool, RICH_SET, original, ["n1"], nonce + 600));
			expect(redrawn.structureSignature).toBe(signatureOf(redrawn));
		}
		expect(withModifier).toBeGreaterThan(5);
	});

	it("draws a noun that is not kept apart from the nouns that are, first", async () => {
		const set = TRIPLE_SET;
		const pool = await poolOf(RICH_TOKENS, set);
		for (let nonce = 0; nonce < 60; nonce++) {
			const original = made(pool, set, "triple", nonce);
			const next = one(relock(pool, set, original, ["n2"], nonce + 500));
			const nouns = ["n1", "n2", "n3"].map((slot) => word(next, slot));
			expect(new Set(nouns).size, nouns.join("/")).toBe(3);
			expect(nouns[1]).toBe(word(original, "n2"));
			expect(next.limited).toBe(false);
		}
	});

	it("is the same for the same inputs, and does not read the signature run preference", async () => {
		const pool = await poolOf(RICH_TOKENS, RICH_SET);
		const original = made(pool, RICH_SET, "rich", 4);
		const a = relock(pool, RICH_SET, original, ["n1"], 99), b = relock(pool, RICH_SET, original, ["n1"], 99);
		expect(b).toEqual(a);
		expect(relock(pool, RICH_SET, original, ["n1"], 100)).not.toEqual(a);
		// The preference is a property of a list of rows; one row regenerated in place has no neighbours here.
		expect(Object.keys(a.ok ? a.draft.results[0]! : {}).sort()).toEqual(["limited", "limitedReason", "recipeId", "segments", "structureSignature", "text"]);
	});

	it("never accepts a text that is in the avoid list, own text included, and reports the shortfall when none is left", async () => {
		// Three nouns: keeping n1 leaves two possible n2, one of them the row's own.
		const pool = await poolOf([tok("猫"), tok("犬"), tok("鳥")], PAIR_SET);
		const original = made(pool, PAIR_SET, "pair", 3);
		const kept = original.segments[0]!.text, connector = original.segments[1]!.text;
		const others = ["猫", "犬", "鳥"].filter((noun) => noun !== kept && noun !== original.segments[2]!.text);
		expect(others).toHaveLength(1);
		const next = one(relock(pool, PAIR_SET, original, ["n1"], 1, { avoid: { texts: [original.text] } }));
		expect(next.text).toBe(`${kept}${connector}${others[0]}`);
		const exhausted = relock(pool, PAIR_SET, original, ["n1"], 1, { avoid: { texts: [original.text, next.text] } });
		expect(exhausted).toMatchObject({ ok: true, draft: { status: "insufficient", generatedCount: 0, shortfallReason: "duplicate-exhausted", results: [] } });
		// Without an avoid list the row's own text is an answer like any other.
		expect(one(relock(pool, PAIR_SET, original, ["n1"], 1)).text.startsWith(`${kept}${connector}`)).toBe(true);
	});

	it("marks the row limited only when its nouns repeat", async () => {
		// One noun: the unkept n2 has to repeat the kept n1.
		const pool = await poolOf([tok("猫")], PAIR_SET);
		const original = made(pool, PAIR_SET, "pair", 2);
		const next = one(relock(pool, PAIR_SET, original, ["n1"], 5, { avoid: { texts: [] } }));
		expect(next).toMatchObject({ limited: true, limitedReason: "noun-repeated" });
	});

	it("produces a frozen result that shares no object with the row it started from, and leaves the row as it was", async () => {
		const pool = await poolOf(RICH_TOKENS, RICH_SET);
		const original = made(pool, RICH_SET, "rich", 8);
		const snapshot = JSON.stringify(original);
		const next = one(relock(pool, RICH_SET, original, ["n1"], 3));
		expect(JSON.stringify(original)).toBe(snapshot);
		expect(Object.isFrozen(next) && Object.isFrozen(next.segments) && next.segments.every((segment) => Object.isFrozen(segment))).toBe(true);
		for (const segment of next.segments) expect(original.segments.includes(segment)).toBe(false);
	});
});

describe("the core does not trust the row it is handed", () => {
	async function fixture() {
		const pool = await poolOf(RICH_TOKENS, RICH_SET);
		let original = made(pool, RICH_SET, "rich", 0);
		for (let nonce = 1; original.segments[0]!.kind !== "modifier" && nonce < 100; nonce++) original = made(pool, RICH_SET, "rich", nonce);
		expect(original.segments[0]!.kind).toBe("modifier");
		return { pool, original };
	}
	const refused = (result: CollisionGenerationResult) => expect(result).toEqual({ ok: false, reason: "invalid-request" });
	const edited = (row: CollisionResultDraft, change: (segments: Record<string, unknown>[]) => unknown) => {
		const segments = row.segments.map((segment) => ({ ...segment })) as Record<string, unknown>[];
		const replaced = change(segments);
		return { recipeId: row.recipeId, segments: (replaced ?? segments) as unknown[] };
	};

	it("refuses a word that is kept but is not in this vocabulary, for a noun, a modifier and a predicate", async () => {
		const { pool, original } = await fixture();
		refused(relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.kind === "noun")!.text = "未知の語"; }), [original.segments.find((x) => x.kind === "noun")!.slotId], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s[0]!.text = "未知の語"; }), ["m1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.kind === "predicate")!.text = "未知の語"; }), ["v1"], 1));
		// A real noun in the wrong part is not a modifier, and a modifier text under another form is not offered either.
		refused(relock(pool, RICH_SET, edited(original, (s) => { s[0]!.text = "都市"; }), ["m1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s[0]!.formId = "sahen-basic"; }), ["m1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s[0]!.formId = "no-such-form"; }), ["m1"], 1));
	});

	it("refuses a form the part's profile never draws, although the word is a candidate of the pool", async () => {
		// "sahen-basic" draws only the sahen basic form. A noun suffix that happens to spell the same surface (here a suffix
		// する, so that 変化する is both 変化 with the sahen basic form and 変化 with that suffix) does not make the form drawable.
		const set = compileCollisionPatternSet({
			schemaVersion: STANDARD_COLLISION_PATTERN_SCHEMA_VERSION, dataVersion: STANDARD_COLLISION_PATTERN_DATA_VERSION,
			recipes: [recipe({ id: "sahen", parts: [MODIFIER("m1", "sahen-basic"), NOUN("n1"), NOUN("n2")] })],
			literals: STANDARD_COLLISION_LITERALS, connectors: STANDARD_COLLISION_CONNECTORS, modifierForms: STANDARD_COLLISION_MODIFIER_FORMS,
			nounSuffixes: [...STANDARD_COLLISION_NOUN_SUFFIXES, { id: "noun-suru", weight: 1, literal: "する" }],
		});
		if (!set.ok) throw new Error("the fixture pattern set must compile");
		const pool = await poolOf(RICH_TOKENS, set.set);
		const row = made(pool, set.set, "sahen", 1);
		expect(row.segments[0]).toMatchObject({ kind: "modifier", formId: "sahen-basic" });
		one(generateLockedCollisionResult({ pool, patternSet: set.set, drawMode: "uniform", nonce: 1, original: row, locked: ["m1"] }));
		// The pool does offer this surface under the suffix's form, for the profile: only the profile's own forms are refused.
		const forged = { recipeId: "sahen", segments: [{ ...row.segments[0]!, formId: "noun-suru" }, ...row.segments.slice(1)] };
		refused(generateLockedCollisionResult({ pool, patternSet: set.set, drawMode: "uniform", nonce: 1, original: forged, locked: ["m1"] }));
	});

	it("does not read the words that are not kept: they are drawn again", async () => {
		const { pool, original } = await fixture();
		const forged = edited(original, (s) => { s.find((x) => x.slotId === "n2")!.text = "未知の語"; s.find((x) => x.kind === "predicate")!.text = "未知の語"; });
		const next = one(relock(pool, RICH_SET, forged, ["n1"], 6));
		expect(JSON.stringify(next)).not.toContain("未知の語");
	});

	it("refuses a row of another recipe, a recipe that is not in the set or not enabled, and a segment list that is not the recipe's parts", async () => {
		const { pool, original } = await fixture();
		refused(relock(pool, RICH_SET, { ...edited(original, () => undefined), recipeId: "elsewhere" }, ["n1"], 1));
		refused(relock(pool, RICH_SET, { ...edited(original, () => undefined), recipeId: 7 as never }, ["n1"], 1));
		const disabled = patternWith([{ ...RICH, enabled: false, selectable: false }, SINGLE]);
		refused(generateLockedCollisionResult({ pool: await poolOf(RICH_TOKENS, disabled), patternSet: disabled, drawMode: "uniform", nonce: 1, original: edited(original, () => undefined) as Lock["original"], locked: ["n1"] }));
		refused(relock(pool, RICH_SET, edited(original, (s) => s.slice(0, -1)), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => [...s, { kind: "noun", slotId: "n9", text: "都市" }]), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => [s[1], s[0], ...s.slice(2)]), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.slotId === "n2")!.slotId = "n3"; }), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.slotId === "n2")!.kind = "predicate"; }), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { delete s.find((x) => x.slotId === "n2")!.text; }), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s[2] = null as never; }), ["n1"], 1));
		refused(relock(pool, RICH_SET, { recipeId: original.recipeId, segments: "not a list" as never }, ["n1"], 1));
		refused(relock(pool, RICH_SET, null as never, ["n1"], 1));
	});

	it("refuses a literal that is not the set's, a Connector that is not the set's or whose text is not its own, and a modifier combination the recipe cannot draw", async () => {
		const { pool, original } = await fixture();
		refused(relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.kind === "literal")!.text = "を"; }), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.kind === "connector")!.connectorId = "nowhere"; }), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.kind === "connector")!.text = "あやしい"; }), ["n1"], 1));
		refused(relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.kind === "connector")!.connectorId = 3; }), ["n1"], 1));
		// A recipe whose presence entries allow the modifier only together with a second one cannot have it alone.
		const both = patternWith([recipe({ id: "both", parts: [MODIFIER("m1", "all", true), MODIFIER("m2", "all", true), NOUN("n1"), NOUN("n2")],
			presence: [{ slots: [], weight: 1 }, { slots: ["m1", "m2"], weight: 1 }] })]);
		const bothPool = await poolOf(RICH_TOKENS, both);
		let row = made(bothPool, both, "both", 0);
		for (let nonce = 1; row.segments.length !== 4 && nonce < 100; nonce++) row = made(bothPool, both, "both", nonce);
		expect(row.segments.map((segment) => segment.slotId)).toEqual(["m1", "m2", "n1", "n2"]);
		one(generateLockedCollisionResult({ pool: bothPool, patternSet: both, drawMode: "uniform", nonce: 1, original: row, locked: ["n1"] }));
		refused(generateLockedCollisionResult({ pool: bothPool, patternSet: both, drawMode: "uniform", nonce: 1, original: { recipeId: "both", segments: row.segments.filter((segment) => segment.slotId !== "m2") }, locked: ["n1"] }));
	});

	it("refuses what it was asked to keep when that is nothing, everything, a part the row lacks, a part that cannot be kept, or a name twice", async () => {
		const { pool, original } = await fixture();
		const row = edited(original, () => undefined);
		refused(relock(pool, RICH_SET, row, [], 1));
		refused(relock(pool, RICH_SET, row, ["m1", "n1", "n2", "v1"], 1));
		refused(relock(pool, RICH_SET, row, ["n9"], 1));
		refused(relock(pool, RICH_SET, row, ["c1"], 1));
		refused(relock(pool, RICH_SET, row, ["l1"], 1));
		refused(relock(pool, RICH_SET, row, ["n1", "n1"], 1));
		refused(relock(pool, RICH_SET, row, [1 as never], 1));
		refused(relock(pool, RICH_SET, row, "n1" as never, 1));
		// A modifier the row does not have cannot be named.
		let plain = made(pool, RICH_SET, "rich", 0);
		for (let nonce = 1; plain.segments[0]!.kind === "modifier" && nonce < 100; nonce++) plain = made(pool, RICH_SET, "rich", nonce);
		expect(plain.segments[0]!.kind).not.toBe("modifier");
		refused(relock(pool, RICH_SET, plain, ["m1"], 1));
		one(relock(pool, RICH_SET, plain, ["n1"], 1));
	});

	it("refuses a nonce, a draw mode or an avoid list that is not one, and a pool or pattern set that does not go together, with the same fixed codes as every generation", async () => {
		const { pool, original } = await fixture();
		for (const nonce of [-1, 1.5, 2 ** 32, Number.NaN]) refused(relock(pool, RICH_SET, original, ["n1"], nonce));
		refused(generateLockedCollisionResult({ pool, patternSet: RICH_SET, drawMode: "other" as never, nonce: 1, original, locked: ["n1"] }));
		refused(relock(pool, RICH_SET, original, ["n1"], 1, { avoid: { texts: [1 as never] } }));
		refused(relock(pool, RICH_SET, original, ["n1"], 1, { avoid: { texts: "x" as never } }));
		expect(relock(pool, RICH_SET, original, ["n1"], 1, { drawMode: "frequency" })).toEqual({ ok: false, reason: "provenance-mismatch" });
		expect(relock({} as never, RICH_SET, original, ["n1"], 1)).toEqual({ ok: false, reason: "invalid-pool" });
		expect(relock(pool, { recipes: [] } as never, original, ["n1"], 1)).toEqual({ ok: false, reason: "invalid-pattern-set" });
	});

	it("refuses a list of names or of texts that throws when it is read as a bad request, not as a broken pool", async () => {
		const { pool, original } = await fixture();
		const secret = "READ-PRIVATE";
		const throwing = <T extends object>(target: T) => new Proxy(target, { get(inner, key) {
			if (key === Symbol.iterator || key === "length" || key === "some" || key === "map") throw new Error(secret);
			return Reflect.get(inner, key);
		} });
		const revoked = Proxy.revocable([] as string[], {}); revoked.revoke();
		for (const locked of [throwing(["n1"]), revoked.proxy]) {
			const result = relock(pool, RICH_SET, original, locked, 1);
			expect(result).toEqual({ ok: false, reason: "invalid-request" });
			expect(JSON.stringify(result)).not.toContain("PRIVATE");
		}
		const revokedAvoid = Proxy.revocable({ texts: [] as string[] }, {}); revokedAvoid.revoke();
		const getterAvoid = { get texts(): string[] { throw new Error(secret); } };
		const everythingThrows = new Proxy({}, { get() { throw new Error(secret); } });
		for (const avoid of [{ texts: throwing(["x"]) }, getterAvoid, revokedAvoid.proxy, everythingThrows]) {
			const result = relock(pool, RICH_SET, original, ["n1"], 1, { avoid: avoid as never });
			expect(result).toEqual({ ok: false, reason: "invalid-request" });
			expect(JSON.stringify(result)).not.toContain("PRIVATE");
		}
		// Lists that can be read still work: the same words and texts, as an array of our own and as one that is not frozen.
		one(relock(pool, RICH_SET, original, Object.freeze(["n1"]), 1, { avoid: { texts: Object.freeze([original.text]) } }));
	});

	it("names no path, note text, surface or exception in a refusal", async () => {
		const { pool, original } = await fixture();
		const secret = "未知の語-PRIVATE-秘密";
		const result = relock(pool, RICH_SET, edited(original, (s) => { s.find((x) => x.kind === "noun")!.text = secret; }), [original.segments.find((x) => x.kind === "noun")!.slotId], 1);
		expect(result).toEqual({ ok: false, reason: "invalid-request" });
		expect(JSON.stringify(result)).not.toContain("PRIVATE");
		const getter = { recipeId: "rich", get segments(): never { throw new Error(secret); } };
		const thrown = relock(pool, RICH_SET, getter, ["n1"], 1);
		expect(thrown).toEqual({ ok: false, reason: "invalid-request" });
		expect(JSON.stringify(thrown)).not.toContain("PRIVATE");
	});

	it("answers no-noun when the vocabulary has none, and recipe-not-viable when the row's recipe cannot be built from it", async () => {
		const pool = await poolOf(RICH_TOKENS, RICH_SET);
		// A vocabulary of verbs only: what a row keeps by predicate is offered, and no noun can be drawn.
		const verbsOnly = await poolOf([verb("眠る"), verb("壊れる", "一段")], RICH_SET);
		const original = made(pool, RICH_SET, "rich", 2);
		refused(relock(verbsOnly, RICH_SET, original, ["n1"], 1));
		expect(relock(verbsOnly, RICH_SET, original, ["v1"], 1)).toMatchObject({ ok: true, draft: { status: "insufficient", shortfallReason: "no-noun" } });
		// Nouns but no verb: the row's recipe needs a predicate, so it cannot be built, whatever noun is kept.
		const nounsOnly = await poolOf([tok("都市"), tok("庭"), tok("鏡")], RICH_SET);
		let row = made(pool, RICH_SET, "rich", 0);
		for (let nonce = 1; !["都市", "庭", "鏡"].includes(word(row, "n1") ?? "") && nonce < 400; nonce++) row = made(pool, RICH_SET, "rich", nonce);
		expect(["都市", "庭", "鏡"]).toContain(word(row, "n1"));
		expect(relock(nounsOnly, RICH_SET, row, ["n1"], 1)).toMatchObject({ ok: true, draft: { status: "insufficient", shortfallReason: "recipe-not-viable" } });
	});
});
