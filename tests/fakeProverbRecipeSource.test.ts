import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, context as esbuildContext, type Plugin } from "esbuild";
import { describe, expect, it } from "vitest";
import {
	FAKE_PROVERB_RECIPE_VALIDATORS,
	GENERATE_COMMAND,
	STANDARD_FAKE_PROVERB_RECIPES_GENERATED,
	STANDARD_FAKE_PROVERB_RECIPES_LOCK,
	STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN,
	assertStandardFakeProverbRecipesGenerated,
	describeFakeProverbSourceIssues,
	explainFakeProverbSourceIssues,
	fakeProverbLiteralId,
	fakeProverbRecipeDataDigest,
	generateStandardFakeProverbRecipes,
	parseStandardFakeProverbRecipeMarkdown,
	renderGeneratedFakeProverbRecipeModule,
	standardFakeProverbRecipesPlugin,
	writeStandardFakeProverbRecipes,
	type ParsedFakeProverbRecipeDocument,
} from "../scripts/fakeProverb/standardRecipes.mjs";
import {
	STANDARD_COLLISION_PATTERNS_GENERATED,
	STANDARD_COLLISION_PATTERNS_LOCK,
	STANDARD_COLLISION_PATTERNS_MARKDOWN,
	standardCollisionPatternsPlugin,
} from "../scripts/collision/standardPatterns.mjs";
import {
	compileFakeProverbRecipeSet,
	inspectFakeProverbLiteral,
	isFakeProverbGlossCompatible,
	type CompileFakeProverbRecipeSetInput,
} from "../src/fakeProverb/compileRecipeSet";
import {
	FAKE_PROVERB_CANDIDATE_FORMS,
	FAKE_PROVERB_LIMITS,
	FAKE_PROVERB_SLOT_KINDS,
	FAKE_PROVERB_RECIPE_SCHEMA_VERSION,
	type RawFakeProverbGloss,
	type RawFakeProverbPart,
	type RawFakeProverbRecipe,
} from "../src/fakeProverb/recipeData";
import {
	STANDARD_FAKE_PROVERB_GLOSSES,
	STANDARD_FAKE_PROVERB_LITERALS,
	STANDARD_FAKE_PROVERB_PROFILES,
	STANDARD_FAKE_PROVERB_PROVERBS,
	STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST,
	STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION,
	STANDARD_FAKE_PROVERB_RECIPE_SCHEMA_VERSION,
} from "../src/fakeProverb/generated/standardFakeProverbRecipeEntries";
import { bundleOptions } from "../scripts/buildDistribution.mjs";
import { readPinnedFixture } from "./support/pinnedFixture";
import { replaceFile } from "./support/replaceFile";

type RecipeLock = { versions: { dataVersion: number; digest: string }[] };
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

const BASELINE = readPinnedFixture<ParsedFakeProverbRecipeDocument & { origin: string }>(
	"fakeProverbRecipes",
	"0072d166810daa83102872b2c37b198f4cd470f481a74fee3eec726cfa735106",
);
const V1_DIGEST = "1d329f91ba002ac0bb70ac5df3b036efa9730107b4b01ea0e8a2b3da7b0b1af1";
/** FAKE-PROVERB-NA1: Recipe Schema 2 / data 2, the version 1 data plus the na-stem-na form in plain-modifier. */
const V2_DIGEST = "232aeb4381fcb41bc00c6002daeb8ca792eba8b159227ef175bd1a6dad6ea01a";
/**
 * FAKE-PROVERB-RECIPES3: data 3, written in the one-line format. 63 proverbs, 32 glosses and 14 profiles; fixed text has
 * no entry of its own, so the 136 literals are named by the parser. Recipe Schema stays 2.
 */
const V3_DIGEST = "4307f645377a64ea7d113516fbe110d28e66b76c4c13236ccaa22688f4484a25";
/**
 * CORRECTION-ROUND1 (B): data 4. One line differs from data 3: `heart-unknown` reads `{n1}の心、{n2}知らず`, so that a Han
 * word right after 心 is not read as one word with it. The proverb's fixed text `の心` becomes `の心、` and its id follows.
 */
const V4_DIGEST = "638321fc91a98542479f0804089c28b0d8fee4b0152a7289c76a9b04945063ac";
const HEART_V3 = "line: {n1}の心{n2}知らず\n";
const HEART_V4 = "line: {n1}の心、{n2}知らず\n";
const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const GENERATE_PATTERN = new RegExp(escapeRegExp(GENERATE_COMMAND), "u");

function dataOf(value: ParsedFakeProverbRecipeDocument): ParsedFakeProverbRecipeDocument {
	return { schemaVersion: value.schemaVersion, dataVersion: value.dataVersion, proverbs: value.proverbs, glosses: value.glosses, literals: value.literals, profiles: value.profiles };
}
const standardMarkdown = async (): Promise<string> => await readFile(STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, "utf8");
/** A same-kind semantic edit: one more proverb that pairs with the existing glosses. */
const EXTRA_PROVERB = "\n## proverb extra-pair\nenabled: true\nweight: 3\nline: {n1}と{n2}\n";
/** The next data version, which the edits below raise to; the checkout's lock records every version up to the current one. */
const NEXT = STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION + 1;
const bumped = (source: string, version: number): string => {
	expect(source.match(/^data-version: \d+$/gmu)).toHaveLength(1);
	return source.replace(/^data-version: \d+$/mu, `data-version: ${version}`);
};
/**
 * Replaces text that occurs exactly once. The document's notes show example lines, and an edit that found its text in a
 * note first would change nothing: every edit of the standard document names text the notes do not repeat.
 */
function once(source: string, before: string, after: string): string {
	expect(source.split(before), before).toHaveLength(2);
	return source.replace(before, after);
}

// ---------------------------------------------------------------------------
// A small valid recipe set, as raw typed data, and its Markdown rendering, so
// one mutation can be pushed through the compiler and the parser alike.

function slot(kind: string, slotId: string, profileId: string, exported = false): RawFakeProverbPart {
	return { kind, slotId, profileId, exported };
}
function literal(literalId: string): RawFakeProverbPart {
	return { kind: "literal", literalId };
}
function reference(slotKind: string, slotId: string): RawFakeProverbPart {
	return { kind: "reference", slotKind, slotId };
}

function baseInput(): Mutable<CompileFakeProverbRecipeSetInput> {
	return {
		schemaVersion: FAKE_PROVERB_RECIPE_SCHEMA_VERSION,
		dataVersion: 1,
		proverbs: [{
			id: "p-one", enabled: true, weight: 2,
			parts: [slot("noun", "n1", "noun-p", true), literal("wa"), slot("noun", "n2", "noun-p", true), literal("wo"), slot("predicate", "v1", "pred-p", true)],
		}],
		glosses: [{
			id: "g-one", enabled: true, weight: 1,
			requires: [{ kind: "noun", slotId: "n1" }, { kind: "predicate", slotId: "v1" }],
			parts: [reference("noun", "n1"), literal("wa"), slot("modifier", "g1", "mod-p"), slot("noun", "g2", "noun-p"), literal("wo"), reference("predicate", "v1"), literal("tatoe")],
		}],
		literals: [{ id: "wa", literal: "は" }, { id: "wo", literal: "を" }, { id: "tatoe", literal: "ことのたとえ。" }],
		profiles: [
			{ id: "noun-p", kind: "noun", forms: [{ form: "independent-noun", weight: 1 }] },
			{ id: "mod-p", kind: "modifier", forms: [{ form: "adjective-basic", weight: 2 }, { form: "verb-past", weight: 1 }] },
			{ id: "pred-p", kind: "predicate", forms: [{ form: "verb-basic", weight: 1 }] },
		],
	};
}

const TAGS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"];
const HOLE_LETTER: Readonly<Record<string, string>> = { noun: "n", modifier: "m", predicate: "v", adverbial: "a" };

/**
 * The document that says `input`, or null when the one-line format cannot say it: a slot whose id is not its kind's
 * letter and a number, a reference a proverb makes, two fixed texts in a row, a fixed text no line uses or one written
 * under two ids, requirements other than the proverb holes the gloss uses in order, a gloss-local slot not named `g`
 * and a number, one that is exported, or a reference to one before it stands. Every profile gets a tag, so each hole
 * names its profile; a gloss-local slot is written `+`, its kind's letter and a number, in order of appearance.
 *
 * `lenient` is for the position rules, which only read what follows a part: two fixed texts in a row are written as one
 * run, a gloss-local slot may have any name, and the requirements may be declared in any order. The document then says
 * a set with the same parts in the same places, not the same ids.
 */
function render(input: CompileFakeProverbRecipeSetInput, lenient = false): string | null {
	const tagOf = new Map(input.profiles.map((profile, index) => [profile.id, TAGS[index]!]));
	const textOf = new Map(input.literals.map((entry) => [entry.id, entry.literal]));
	const used = new Set<string>();
	let sayable = true;
	const no = (): string => { sayable = false; return ""; };
	const fixed = (part: RawFakeProverbPart, previous: RawFakeProverbPart | undefined): string => {
		const text = textOf.get(part.literalId ?? "");
		if (text === undefined || text === "" || (previous?.kind === "literal" && !lenient) || Object.keys(part).length !== 2) return no();
		used.add(part.literalId!);
		return text;
	};
	const hole = (prefix: string, name: string, profileId: unknown): string => {
		const tag = typeof profileId === "string" ? tagOf.get(profileId) : undefined;
		return tag === undefined ? no() : `{${prefix}${name}:${tag}}`;
	};
	const named = (kind: unknown, slotId: unknown): slotId is string =>
		typeof kind === "string" && typeof slotId === "string" && HOLE_LETTER[kind] !== undefined && new RegExp(`^${HOLE_LETTER[kind]}[1-9]$`, "u").test(slotId);
	const lines = ["# Test recipes", "", `schema-version: ${input.schemaVersion}`, `data-version: ${input.dataVersion}`, ""];
	for (const entry of input.proverbs) {
		const text = entry.parts.map((part, index) => {
			if (part === null || typeof part !== "object") return no();
			if (part.kind === "literal") return fixed(part, entry.parts[index - 1]);
			if (!named(part.kind, part.slotId) || typeof part.exported !== "boolean" || Object.keys(part).length !== 4) return no();
			return hole(part.exported ? "" : "-", part.slotId, part.profileId);
		}).join("");
		lines.push(`## proverb ${entry.id}`, `enabled: ${String(entry.enabled)}`, `weight: ${entry.weight}`, `line: ${text}`, "");
	}
	for (const entry of input.glosses) {
		const locals = new Map<string, { name: string; kind: string }>();
		const counts: Record<string, number> = {};
		const usedHoles: string[] = [];
		const text = entry.parts.map((part, index) => {
			if (part === null || typeof part !== "object") return no();
			if (part.kind === "literal") return fixed(part, entry.parts[index - 1]);
			if (part.kind === "reference") {
				if (Object.keys(part).length !== 3) return no();
				const local = locals.get(part.slotId ?? "");
				if (local !== undefined) return local.kind === part.slotKind ? `{+${local.name}}` : no();
				if (!named(part.slotKind, part.slotId)) return no();
				if (!usedHoles.includes(part.slotId)) usedHoles.push(part.slotId);
				return `{${part.slotId}}`;
			}
			const letter = HOLE_LETTER[part.kind];
			if (letter === undefined || typeof part.slotId !== "string" || (!lenient && !/^g[1-9]$/u.test(part.slotId)) || locals.has(part.slotId) || part.exported !== false) return no();
			counts[letter] = (counts[letter] ?? 0) + 1;
			const name = `${letter}${counts[letter]}`;
			locals.set(part.slotId, { name, kind: part.kind });
			return hole("+", name, part.profileId);
		}).join("");
		// The document's requirements are the proverb holes its line uses, in order of first appearance.
		const declared = entry.requires.map((required) => required.slotId);
		if (JSON.stringify(lenient ? [...declared].sort() : declared) !== JSON.stringify(lenient ? [...usedHoles].sort() : usedHoles) ||
			entry.requires.some((required) => !named(required.kind, required.slotId))) sayable = false;
		lines.push(`## gloss ${entry.id}`, `enabled: ${String(entry.enabled)}`, `weight: ${entry.weight}`, `line: ${text}`, "");
	}
	if (input.literals.some((entry) => !used.has(entry.id)) || new Set(input.literals.map((entry) => entry.literal)).size !== input.literals.length) sayable = false;
	// The document does not write a fixed text's id, so it cannot say that one collides with an entry's.
	const entryIds = new Set([...input.proverbs, ...input.glosses, ...input.profiles].map((entry) => entry.id));
	if (input.literals.some((entry) => entryIds.has(entry.id))) sayable = false;
	for (const [index, entry] of input.profiles.entries()) {
		lines.push(`## profile ${entry.id}`, `kind: ${entry.kind}`, `tag: ${TAGS[index]}`, ...entry.forms.map((form) => `form: ${form.form} ${form.weight}`), "");
	}
	return sayable ? lines.join("\n") : null;
}

/** `render()` for an input the format can say. */
function document(input: CompileFakeProverbRecipeSetInput, lenient = false): string {
	const source = render(input, lenient);
	if (source === null) throw new Error("the one-line format cannot say this input");
	return source;
}

/** The data with every literal id replaced by its text: what a recipe set means, whatever its literals are called. */
function meaning(data: Pick<CompileFakeProverbRecipeSetInput, "proverbs" | "glosses" | "literals" | "profiles">): unknown {
	const text = new Map(data.literals.map((entry) => [entry.id, entry.literal]));
	const parts = (list: readonly RawFakeProverbPart[]) => list.map((part) => (part.kind === "literal" ? { kind: "literal", text: text.get(part.literalId ?? "") } : part));
	return {
		proverbs: data.proverbs.map((entry) => ({ ...entry, parts: parts(entry.parts) })),
		glosses: data.glosses.map((entry) => ({ ...entry, parts: parts(entry.parts) })),
		literals: [...text.values()].sort(),
		profiles: data.profiles,
	};
}

function compileCodes(input: unknown): readonly string[] {
	const result = compileFakeProverbRecipeSet(input as CompileFakeProverbRecipeSetInput);
	return result.ok ? [] : result.issues.map((entry) => entry.code);
}

function markdownCodes(source: string): readonly string[] {
	const parsed = parseStandardFakeProverbRecipeMarkdown(source);
	return parsed.ok ? [] : parsed.issues.map((entry) => entry.code);
}

/** What the parser says of the document for `input`; null when the one-line format cannot say the input at all. */
function documentCodes(input: CompileFakeProverbRecipeSetInput): readonly string[] | null {
	const source = render(input);
	return source === null ? null : markdownCodes(source);
}

function withProverb(mutate: (proverb: Mutable<RawFakeProverbRecipe>) => void): Mutable<CompileFakeProverbRecipeSetInput> {
	const input = baseInput();
	const proverb = { ...input.proverbs[0]!, parts: [...input.proverbs[0]!.parts] };
	mutate(proverb);
	input.proverbs = [proverb];
	return input;
}

function withGloss(mutate: (gloss: Mutable<RawFakeProverbGloss>) => void): Mutable<CompileFakeProverbRecipeSetInput> {
	const input = baseInput();
	const gloss = { ...input.glosses[0]!, parts: [...input.glosses[0]!.parts], requires: [...input.glosses[0]!.requires] };
	mutate(gloss);
	input.glosses = [gloss];
	return input;
}

/** The structure a recipe renders to, with each slot or reference as `{id}`. */
function structure(parts: readonly RawFakeProverbPart[], literals: readonly { id: string; literal: string }[]): string {
	return parts.map((part) => part.kind === "literal"
		? literals.find((entry) => entry.id === part.literalId)!.literal
		: `{${part.slotId}}`).join("");
}

// ---------------------------------------------------------------------------
// Scratch-directory helpers for generator tests. The checkout is never edited.

async function isolatedWritePaths(label: string, options: { copyLock?: boolean; copyGenerated?: boolean } = {}):
Promise<{ scratch: string; outfile: string; lockPath: string }> {
	const scratch = await mkdtemp(path.join(tmpdir(), `semantropy-fake-proverb-${label}-`));
	const outfile = path.join(scratch, "standardFakeProverbRecipeEntries.ts");
	const lockPath = path.join(scratch, "standard-recipes.lock.json");
	if (options.copyLock !== false) await copyFile(STANDARD_FAKE_PROVERB_RECIPES_LOCK, lockPath);
	if (options.copyGenerated !== false && options.copyLock !== false) await copyFile(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, outfile);
	return { scratch, outfile, lockPath };
}

async function expectNoGeneratingFiles(scratch: string): Promise<void> {
	expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual([]);
}

function injectedFsError(code: string): NodeJS.ErrnoException {
	const error = new Error(`injected ${code}`) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

function readTextWithFailures(failures: ReadonlyMap<string, NodeJS.ErrnoException>): (filePath: string) => Promise<string> {
	return async (filePath) => {
		const failure = failures.get(filePath);
		if (failure !== undefined) throw failure;
		return await readFile(filePath, "utf8");
	};
}

function expectAggregated(error: unknown, token: string, messages: readonly string[]): void {
	expect(error).toBeInstanceOf(AggregateError);
	const aggregate = error as AggregateError;
	expect(aggregate.message).toContain(`(${token})`);
	expect(aggregate.message).toMatch(/version lock is unchanged/u);
	expect(aggregate.errors.map((entry) => (entry instanceof Error ? entry.message : String(entry)))).toEqual([...messages]);
}

async function caught(action: () => Promise<unknown>): Promise<unknown> {
	try {
		await action();
	} catch (error) {
		return error;
	}
	throw new Error("expected a failure");
}

// ===========================================================================

describe("the standard Fake Proverb recipe document", () => {
	it("parses to recipe data 4, and the lock keeps the digests of all four versions", async () => {
		const parsed = parseStandardFakeProverbRecipeMarkdown(await standardMarkdown());
		expect(parsed.ok, parsed.ok ? "" : describeFakeProverbSourceIssues(parsed.issues)).toBe(true);
		if (!parsed.ok) return;
		const data = dataOf(parsed);
		// The version 1 fixture stays the record of version 1: its digest is still the lock's first entry.
		const pinned = dataOf(BASELINE);
		expect([pinned.schemaVersion, pinned.dataVersion, fakeProverbRecipeDataDigest(pinned)]).toEqual([1, 1, V1_DIGEST]);
		// FAKE-PROVERB-RECIPES3 wrote data 3 in this format; CORRECTION-ROUND1 (B) raised it to 4 with one changed line.
		expect([data.schemaVersion, data.dataVersion]).toEqual([2, 4]);
		expect([data.proverbs.length, data.glosses.length, data.literals.length, data.profiles.length]).toEqual([63, 32, 136, 14]);
		expect(fakeProverbRecipeDataDigest(data)).toBe(V4_DIGEST);
		expect(JSON.parse(await readFile(STANDARD_FAKE_PROVERB_RECIPES_LOCK, "utf8"))).toEqual({
			versions: [{ dataVersion: 1, digest: V1_DIGEST }, { dataVersion: 2, digest: V2_DIGEST }, { dataVersion: 3, digest: V3_DIGEST }, { dataVersion: 4, digest: V4_DIGEST }],
		});
		expect([STANDARD_FAKE_PROVERB_RECIPE_SCHEMA_VERSION, STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION, STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST])
			.toEqual([2, 4, V4_DIGEST]);
		// Data 4 is data 3 and that one line: put the line back, and the version, and data 3's own digest comes out.
		const source = await standardMarkdown();
		expect(source.split(HEART_V4)).toHaveLength(2);
		const back = parseStandardFakeProverbRecipeMarkdown(bumped(source.replace(HEART_V4, HEART_V3), 3));
		expect(back.ok, back.ok ? "" : describeFakeProverbSourceIssues(back.issues)).toBe(true);
		if (back.ok) {
			expect(fakeProverbRecipeDataDigest(dataOf(back))).toBe(V3_DIGEST);
			const ids = (entries: readonly { readonly id: string }[]) => entries.map((entry) => entry.id);
			expect(ids(back.proverbs)).toEqual(ids(data.proverbs));
			expect(ids(back.glosses)).toEqual(ids(data.glosses));
			// The only fixed text that differs is the one next to 心, and its id is named from the text.
			expect(data.literals.filter((entry) => !back.literals.some((other) => other.id === entry.id)))
				.toEqual([{ id: fakeProverbLiteralId("の心、"), literal: "の心、" }]);
			expect(back.literals.filter((entry) => !data.literals.some((other) => other.id === entry.id)))
				.toEqual([{ id: fakeProverbLiteralId("の心"), literal: "の心" }]);
		}
		expect([STANDARD_FAKE_PROVERB_PROVERBS, STANDARD_FAKE_PROVERB_GLOSSES, STANDARD_FAKE_PROVERB_LITERALS, STANDARD_FAKE_PROVERB_PROFILES])
			.toEqual([data.proverbs, data.glosses, data.literals, data.profiles]);
		// The 15 recipes of versions 1 and 2 keep their ids, at the head of each list and in their order.
		expect(data.proverbs.slice(0, 9).map((entry) => entry.id)).toEqual(BASELINE.proverbs.map((entry) => entry.id));
		expect(data.glosses.slice(0, 6).map((entry) => entry.id)).toEqual(BASELINE.glosses.map((entry) => entry.id));
		expect(data.profiles.slice(0, 6).map((entry) => entry.id)).toEqual(BASELINE.profiles.map((entry) => entry.id));
		// Every fixed text is named from its text, and each recipe's line is returned as written, beside the data.
		for (const entry of data.literals) expect(entry.id).toBe(fakeProverbLiteralId(entry.literal));
		expect([parsed.authored["topic-object"], parsed.authored["misplaced-purpose"]])
			.toEqual(["{n1}は{n2}を{v1}", "{n1}が{n2}において{+n1}を{+v1:動}ことのたとえ。"]);
		expect(Object.keys(parsed.authored)).toHaveLength(63 + 32);
	});

	it("gives the four recipes with a variable verb after を or に half the weight of the others, and every gloss the same weight", async () => {
		const parsed = parseStandardFakeProverbRecipeMarkdown(await standardMarkdown());
		if (!parsed.ok) throw new Error("the standard document does not parse");
		expect(parsed.proverbs.filter((entry) => entry.weight !== 4).map((entry) => [entry.id, entry.weight]))
			.toEqual([["topic-object", 2], ["genitive-destination", 2], ["modified-topic", 2], ["pursuer", 2]]);
		expect(new Set(parsed.glosses.map((entry) => entry.weight))).toEqual(new Set([4]));
		expect([...parsed.proverbs, ...parsed.glosses].every((entry) => entry.enabled)).toBe(true);
	});

	it("pins every proverb and gloss structure as actual fixture data", () => {
		expect(BASELINE.proverbs.map((entry) => structure(entry.parts, BASELINE.literals))).toEqual([
			"{n1}は{n2}を{v1}", "{n1}の{n2}は{n3}に{v1}", "{n1}より{n2}", "{n1}に{n2}", "{m1}{n1}は{n2}を{v1}",
			"{n1}から出た{n2}", "{n1}を{m1}者は{n2}を{v1}", "{n1}の{n2}に{n3}", "{n1}は{n2}のもと",
		]);
		expect(BASELINE.glosses.map((entry) => structure(entry.parts, BASELINE.literals))).toEqual([
			"{n1}が{n2}において{g1}を{g2}ことのたとえ。", "{n1}と{n2}は、いずれ{g1}になるという戒め。",
			"{n1}でさえ{v1}のだから、{g1}はなおさらであるということ。", "{n1}の{n2}は、{n3}によってしか測れないということ。",
			"どれほどの{n2}も、{g1}のまえでは{g2}ということ。", "{n1}を{g1}ものと思い込むと、かえって{g2}を失うという教え。",
		]);
	});

	it("pairs every proverb with glosses by typed signature alone, and a proverb without a noun with the glosses that use its predicate alone", async () => {
		const { compiled } = await generateStandardFakeProverbRecipes({ rootDir: process.cwd() });
		const glossesOf = (id: string) => compiled.glosses.filter((gloss) => isFakeProverbGlossCompatible(compiled.proverbs.find((entry) => entry.id === id)!, gloss)).map((gloss) => gloss.id);
		const proverbsOf = (id: string) => compiled.proverbs.filter((proverb) => isFakeProverbGlossCompatible(proverb, compiled.glosses.find((entry) => entry.id === id)!)).map((proverb) => proverb.id);
		const nounless = compiled.proverbs.filter((proverb) => !proverb.parts.some((part) => part.kind === "noun")).map((proverb) => proverb.id);
		expect(nounless).toEqual(["wins", "easier-done", "easy-and-hard", "no-match-for-not"]);
		for (const id of nounless) expect(glossesOf(id)).toEqual(["same-as-doing", "seems-to", "think-of-when", "thanks-to"]);
		// Every proverb has several glosses to draw from, and every gloss several proverbs.
		expect(Math.min(...compiled.proverbs.map((proverb) => glossesOf(proverb.id).length))).toBe(4);
		expect(Math.min(...compiled.glosses.map((gloss) => proverbsOf(gloss.id).length))).toBe(2);
		// The three glosses that use three nouns pair with the two proverbs that export three: recipe data 3 exports
		// genitive-destination's third noun, which versions 1 and 2 kept from the glosses.
		const threeNouns = compiled.glosses.filter((gloss) => gloss.requires.length === 3).map((gloss) => gloss.id);
		expect(threeNouns).toEqual(["only-measure", "likewise-has", "in-turn"]);
		for (const id of threeNouns) expect(proverbsOf(id)).toEqual(["genitive-destination", "ear-prayer"]);
		expect(compiled.proverbs.find((entry) => entry.id === "genitive-destination")!.exports.map((entry) => entry.slotId)).toEqual(["n1", "n2", "n3", "v1"]);
		// The only slots a gloss does not get are the two modifiers versions 1 and 2 already kept back.
		expect(compiled.proverbs.flatMap((proverb) => proverb.parts.flatMap((part) => (part.kind !== "literal" && !part.exported ? [`${proverb.id}:${part.slotId}`] : []))))
			.toEqual(["modified-topic:m1", "pursuer:m1"]);
		expect(Math.max(...compiled.proverbs.map((proverb) => proverb.exports.length))).toBe(4);
	});

	it("is read the same way with LF, CRLF, CR and a byte-order mark", async () => {
		const source = await standardMarkdown();
		const expected = parseStandardFakeProverbRecipeMarkdown(source);
		for (const variant of [source.replaceAll("\n", "\r\n"), source.replaceAll("\n", "\r"), `\uFEFF${source}`]) {
			expect(parseStandardFakeProverbRecipeMarkdown(variant)).toEqual(expected);
		}
	});

	it("uses only closed forms, and every literal passes the literal grammar", () => {
		for (const profile of BASELINE.profiles) {
			const allowed: readonly string[] = FAKE_PROVERB_CANDIDATE_FORMS[profile.kind as keyof typeof FAKE_PROVERB_CANDIDATE_FORMS];
			for (const entry of profile.forms) expect(allowed).toContain(entry.form);
		}
		for (const entry of BASELINE.literals) expect(inspectFakeProverbLiteral(entry.literal)).toBeNull();
	});
});

describe("Markdown-only edits reach the typed data", () => {
	it.each([
		["a hole added to a line", (s: string) => once(s, "line: {n1}より{n2}\n", "line: {n1}より{m1}{n2}\n")],
		["a slot the gloss gets", (s: string) => once(s, "line: {-m1}{n1}は{n2}を{v1:否}", "line: {m1}{n1}は{n2}を{v1:否}")],
		["the proverb's word a gloss uses", (s: string) => once(s, "line: どれほどの{n2}も、", "line: どれほどの{n1}も、")],
		["fixed text", (s: string) => once(s, "line: {n1}は{n2}のもと", "line: {n1}は{n2}のはじまり")],
		["a hole's tag", (s: string) => once(s, "line: {n1}より先に{v1:動}べし", "line: {n1}より先に{v1:肯}べし")],
		["a recipe weight", (s: string) => once(s, "## proverb rather-than\nenabled: true\nweight: 4", "## proverb rather-than\nenabled: true\nweight: 5")],
		["a form weight", (s: string) => once(s, "## profile plain-modifier\nkind: modifier\nform: adjective-basic 3", "## profile plain-modifier\nkind: modifier\nform: adjective-basic 4")],
		["a disabled gloss", (s: string) => once(s, "## gloss only-measure\nenabled: true", "## gloss only-measure\nenabled: false")],
		["an added proverb", (s: string) => s + EXTRA_PROVERB],
	] as const)("changes the digest for %s, and a raised data-version generates and passes the guard", async (_name, mutate) => {
		const edited = bumped(mutate(await standardMarkdown()), NEXT);
		const parsed = parseStandardFakeProverbRecipeMarkdown(edited);
		expect(parsed.ok, parsed.ok ? "" : describeFakeProverbSourceIssues(parsed.issues)).toBe(true);
		if (!parsed.ok) return;
		expect(fakeProverbRecipeDataDigest(parsed)).not.toBe(V4_DIGEST);
		const { scratch, outfile, lockPath } = await isolatedWritePaths("markdown-edit");
		try {
			await writeStandardFakeProverbRecipes({ markdown: edited, generatedPath: outfile, lockPath });
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: edited, generatedPath: outfile, lockPath }))
				.resolves.toEqual({ schemaVersion: 2, dataVersion: NEXT });
			const lock = JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock;
			expect(lock.versions).toEqual([
				{ dataVersion: 1, digest: V1_DIGEST }, { dataVersion: 2, digest: V2_DIGEST }, { dataVersion: 3, digest: V3_DIGEST }, { dataVersion: 4, digest: V4_DIGEST }, { dataVersion: NEXT, digest: fakeProverbRecipeDataDigest(parsed) },
			]);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
});

describe("edits that are not data", () => {
	it("leaves the digest alone when only a tag or a note changes", async () => {
		const source = await standardMarkdown();
		const digest = (text: string) => {
			const parsed = parseStandardFakeProverbRecipeMarkdown(text);
			expect(parsed.ok, parsed.ok ? "" : describeFakeProverbSourceIssues(parsed.issues)).toBe(true);
			return parsed.ok ? fakeProverbRecipeDataDigest(parsed) : "";
		};
		// A tag is how a line names a profile; the data holds the profile's id.
		const retagged = once(source, "kind: predicate\ntag: 肯", "kind: predicate\ntag: 可").replaceAll(":肯}", ":可}");
		expect(retagged).not.toBe(source);
		expect(digest(retagged)).toBe(V4_DIGEST);
		expect(digest(`${source}\n> a note at the end\n`)).toBe(V4_DIGEST);
		expect(digest(once(source, "## proverb rather-than\n", "> a note before an entry\n\n## proverb rather-than\n"))).toBe(V4_DIGEST);
	});
});

describe("the Fake Proverb recipe compiler", () => {
	it("accepts the small reference set in both paths and deep-freezes fresh data", () => {
		const input = baseInput();
		const result = compileFakeProverbRecipeSet(input);
		expect(result.ok).toBe(true);
		// The document says exactly this set: only the ids of the fixed texts differ.
		const parsed = parseStandardFakeProverbRecipeMarkdown(document(input));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(meaning(parsed)).toEqual(meaning(input));
		if (!result.ok) return;
		const set = result.set;
		expect(set.proverbs[0]!.exports).toEqual([{ kind: "noun", slotId: "n1" }, { kind: "noun", slotId: "n2" }, { kind: "predicate", slotId: "v1" }]);
		expect(set.glosses[0]!.parts.filter((part) => part.kind === "reference").map((part) => part.kind === "reference" && part.source))
			.toEqual(["requirement", "requirement"]);
		const snapshot = JSON.stringify(set);
		const containers: object[] = [set, set.proverbs, set.glosses, set.literals, set.profiles];
		for (const proverb of set.proverbs) containers.push(proverb, proverb.parts, proverb.exports, ...proverb.parts, ...proverb.exports);
		for (const gloss of set.glosses) containers.push(gloss, gloss.parts, gloss.requires, ...gloss.parts, ...gloss.requires);
		for (const profile of set.profiles) containers.push(profile, profile.forms, ...profile.forms);
		for (const value of containers) {
			expect(Object.isFrozen(value)).toBe(true);
			expect(Reflect.set(value, "injected", true)).toBe(false);
		}
		// Caller-owned input is neither frozen nor aliased.
		expect(Object.isFrozen(input.proverbs[0]!.parts[0])).toBe(false);
		(input.proverbs[0]!.parts[0] as { slotId: string }).slotId = "corrupt";
		(input.literals[0] as { literal: string }).literal = "変";
		expect(JSON.stringify(set)).toBe(snapshot);
	});

	it("resolves a gloss reference to an earlier gloss-local slot as local", () => {
		const input = withGloss((gloss) => { gloss.parts.push(reference("noun", "g2")); });
		const result = compileFakeProverbRecipeSet(input);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.set.glosses[0]!.parts.at(-1)).toEqual({ kind: "reference", slotKind: "noun", slotId: "g2", source: "local" });
		expect(documentCodes(input)).toEqual([]);
	});

	/**
	 * The compiler's rules, by whether the one-line format can write an input that breaks them. A rule a document cannot
	 * break is still the compiler's: the generated data and a caller's own set pass through it, not through the parser.
	 */
	const DOCUMENT_REACH = {
		// The document says it, and the parser reports the compiler's code for it.
		sameCode: [
			"a requirement no proverb declares", "a duplicate proverb slot", "a duplicate export", "a gloss without requirements", "a proverb without exports",
			"an unused profile", "a form of another kind", "an unknown form", "a duplicate form", "a profile without forms", "an invalid entry id",
			"an unpaired proverb", "no enabled gloss", "no enabled proverb", "a zero weight", "a fractional weight", "an unsafe weight", "a zero form weight",
			"an unsupported schema version", "a future schema version", "too many proverb predicates", "too many gloss-local nouns", "too many exports",
			"too many requirements", "too many references", "too many proverbs",
		],
		// The format has no words for it: a hole's letter is its kind, a gloss's holes are its requirements and its
		// references, a new word is named by the parser, and fixed text has no id and no entry of its own.
		unsayable: [
			"an unknown gloss reference", "a requirement typed differently from the export", "a reference typed differently from its requirement",
			"a reference typed differently from its local slot", "a duplicate requirement", "a gloss-local slot reusing a requirement",
			"a duplicate gloss-local slot", "a gloss-local slot wearing a proverb slot ID", "a forward reference to a later local slot",
			"a proverb reference to a gloss slot (cycle)", "a proverb reference to its own slot", "a gloss re-export", "an unused requirement",
			"a dangling literal", "an unused literal", "a duplicate literal surface", "an unknown part kind", "an unknown requirement kind",
			"an unknown reference kind", "an unknown profile", "a duplicate id across kinds", "an invalid slot id", "an over-long slot id",
			// Two fixed texts in a row are one run of text in a line; a line with too many holes and texts is refused (the line syntax tests).
			"too many proverb parts", "too many gloss parts",
		],
		// The document says something close, and the parser names it its own way before the compiler sees it.
		otherCode: [
			["a slot whose profile has another kind", ["unknown-tag"]],
			["an unknown profile kind", ["unknown-tag", "unknown-tag", "unknown-tag"]],
			["an empty proverb", ["invalid-line"]],
		],
	};
	const failures: [string, Mutable<CompileFakeProverbRecipeSetInput>, string][] = [
		// references and signatures
		["an unknown gloss reference", withGloss((g) => { g.parts.push(reference("noun", "zz")); }), "unknown-reference"],
		["a requirement no proverb declares", withGloss((g) => { g.requires.push({ kind: "noun", slotId: "n9" }); g.parts.push(reference("noun", "n9")); }), "unknown-reference"],
		["a requirement typed differently from the export", withGloss((g) => { g.requires[1] = { kind: "noun", slotId: "v1" }; g.parts[5] = reference("noun", "v1"); }), "type-mismatch"],
		["a reference typed differently from its requirement", withGloss((g) => { g.parts[0] = reference("predicate", "n1"); }), "type-mismatch"],
		["a reference typed differently from its local slot", withGloss((g) => { g.parts.push(reference("modifier", "g2")); }), "type-mismatch"],
		["a slot whose profile has another kind", withProverb((p) => { p.parts[0] = slot("noun", "n1", "pred-p", true); }), "type-mismatch"],
		["a duplicate proverb slot", withProverb((p) => { p.parts.push(literal("wa"), slot("noun", "n1", "noun-p")); }), "duplicate-slot-id"],
		["a duplicate export", withProverb((p) => { p.parts.push(literal("wa"), slot("noun", "n1", "noun-p", true)); }), "duplicate-export"],
		["a duplicate requirement", withGloss((g) => { g.requires.push({ kind: "noun", slotId: "n1" }); }), "duplicate-require"],
		["a gloss-local slot reusing a requirement", withGloss((g) => { g.parts.push(slot("noun", "n1", "noun-p")); }), "duplicate-slot-id"],
		["a duplicate gloss-local slot", withGloss((g) => { g.parts.push(slot("noun", "g2", "noun-p")); }), "duplicate-slot-id"],
		["a gloss-local slot wearing a proverb slot ID", withGloss((g) => { g.parts[3] = slot("noun", "n2", "noun-p"); }), "shadowed-slot-id"],
		["a forward reference to a later local slot", withGloss((g) => { g.parts.splice(2, 0, reference("noun", "g2")); }), "forward-reference"],
		["a proverb reference to a gloss slot (cycle)", withProverb((p) => { p.parts.push(reference("noun", "g2")); }), "cyclic-reference"],
		["a proverb reference to its own slot", withProverb((p) => { p.parts.push(reference("noun", "n1")); }), "proverb-reference"],
		["a gloss re-export", withGloss((g) => { g.parts[3] = slot("noun", "g2", "noun-p", true); }), "gloss-export"],
		["an unused requirement", withGloss((g) => { g.parts.splice(5, 1); }), "unused-require"],
		["a gloss without requirements", withGloss((g) => { g.requires = []; g.parts = [slot("noun", "g2", "noun-p"), literal("tatoe")]; }), "missing-require"],
		["a proverb without exports", withProverb((p) => { p.parts = p.parts.map((part) => (part.kind === "literal" ? part : { ...part, exported: false })); }), "missing-export"],
		// literals and profiles
		["a dangling literal", withProverb((p) => { p.parts.push(literal("missing")); }), "dangling-literal"],
		["an unused literal", (() => { const input = baseInput(); input.literals.push({ id: "spare", literal: "余り" }); return input; })(), "unused-literal"],
		["a duplicate literal surface", (() => { const input = baseInput(); input.literals.push({ id: "wa-again", literal: "は" }); return input; })(), "duplicate-literal"],
		["an unknown part kind", withProverb((p) => { p.parts.push({ kind: "adverb", slotId: "a1", profileId: "noun-p", exported: false }); }), "unknown-part-kind"],
		["an unknown requirement kind", withGloss((g) => { g.requires.push({ kind: "adverb", slotId: "a1" }); }), "unknown-part-kind"],
		["an unknown reference kind", withGloss((g) => { g.parts.push(reference("adverb", "n1")); }), "unknown-part-kind"],
		["an unknown profile", withProverb((p) => { p.parts[0] = slot("noun", "n1", "missing-p", true); }), "unknown-profile"],
		["an unused profile", (() => { const input = baseInput(); input.profiles.push({ id: "spare-p", kind: "noun", forms: [{ form: "independent-noun", weight: 1 }] }); return input; })(), "unused-profile"],
		["an unknown profile kind", (() => { const input = baseInput(); input.profiles[0] = { ...input.profiles[0]!, kind: "adverb" }; return input; })(), "invalid-profile-kind"],
		["a form of another kind", (() => { const input = baseInput(); input.profiles[0] = { ...input.profiles[0]!, forms: [{ form: "verb-basic", weight: 1 }] }; return input; })(), "invalid-form"],
		["an unknown form", (() => { const input = baseInput(); input.profiles[1] = { ...input.profiles[1]!, forms: [{ form: "verb-causative", weight: 1 }] }; return input; })(), "invalid-form"],
		["a duplicate form", (() => { const input = baseInput(); input.profiles[1] = { ...input.profiles[1]!, forms: [{ form: "verb-past", weight: 1 }, { form: "verb-past", weight: 2 }] }; return input; })(), "duplicate-form"],
		["a profile without forms", (() => { const input = baseInput(); input.profiles[2] = { ...input.profiles[2]!, forms: [] }; return input; })(), "missing-form"],
		// ids, flags and pairing
		["a duplicate id across kinds", (() => { const input = baseInput(); input.profiles[0] = { ...input.profiles[0]!, id: "wa" }; input.proverbs[0] = { ...input.proverbs[0]!, parts: input.proverbs[0]!.parts.map((part) => part.profileId === "noun-p" ? { ...part, profileId: "wa" } : part) }; input.glosses[0] = { ...input.glosses[0]!, parts: input.glosses[0]!.parts.map((part) => part.profileId === "noun-p" ? { ...part, profileId: "wa" } : part) }; return input; })(), "duplicate-id"],
		["an invalid entry id", withProverb((p) => { p.id = "P-one"; }), "invalid-id"],
		["an invalid slot id", withProverb((p) => { p.parts[0] = slot("noun", "N1", "noun-p", true); }), "invalid-slot-id"],
		["an over-long slot id", withProverb((p) => { p.parts[0] = slot("noun", "n".repeat(17), "noun-p", true); }), "invalid-slot-id"],
		["an unpaired proverb", (() => { const input = baseInput(); input.proverbs.push({ id: "p-two", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true)] }); return input; })(), "unpaired-proverb"],
		["no enabled gloss", withGloss((g) => { g.enabled = false; }), "missing-gloss"],
		["no enabled proverb", withProverb((p) => { p.enabled = false; }), "missing-proverb"],
		["a zero weight", withProverb((p) => { p.weight = 0; }), "invalid-weight"],
		["a fractional weight", withGloss((g) => { g.weight = 1.5; }), "invalid-weight"],
		["an unsafe weight", withProverb((p) => { p.weight = Number.MAX_SAFE_INTEGER + 1; }), "invalid-weight"],
		["a zero form weight", (() => { const input = baseInput(); input.profiles[0] = { ...input.profiles[0]!, forms: [{ form: "independent-noun", weight: 0 }] }; return input; })(), "invalid-weight"],
		["an unsupported schema version", (() => { const input = baseInput(); input.schemaVersion = 1; return input; })(), "unsupported-schema-version"],
		["a future schema version", (() => { const input = baseInput(); input.schemaVersion = 3; return input; })(), "unsupported-schema-version"],
		// limits
		["too many proverb parts", withProverb((p) => { p.parts.push(...Array.from({ length: 6 }, () => literal("wa"))); }), "part-limit"],
		["too many gloss parts", withGloss((g) => { g.parts.push(...Array.from({ length: 8 }, () => literal("wa"))); }), "part-limit"],
		["an empty proverb", withProverb((p) => { p.parts = []; }), "part-limit"],
		["too many proverb predicates", withProverb((p) => { p.parts.push(literal("wa"), slot("predicate", "v2", "pred-p")); }), "kind-limit"],
		["too many gloss-local nouns", withGloss((g) => { g.parts.push(slot("noun", "g3", "noun-p"), slot("noun", "g4", "noun-p"), slot("noun", "g5", "noun-p")); }), "kind-limit"],
		["too many exports", withProverb((p) => { p.parts = [slot("noun", "n1", "noun-p", true), slot("noun", "n2", "noun-p", true), slot("noun", "n3", "noun-p", true), slot("noun", "n4", "noun-p", true), slot("predicate", "v1", "pred-p", true)]; }), "export-limit"],
		["too many requirements", withGloss((g) => { for (const id of ["n2", "n3", "n4"]) { g.requires.push({ kind: "noun", slotId: id }); g.parts.push(reference("noun", id)); } }), "require-limit"],
		["too many references", withGloss((g) => { g.parts.push(...Array.from({ length: 5 }, () => reference("noun", "n1"))); }), "reference-limit"],
		["too many proverbs", (() => { const input = baseInput(); input.proverbs = Array.from({ length: FAKE_PROVERB_LIMITS.proverbs + 1 }, (_, i) => ({ ...input.proverbs[0]!, id: `p-${i}` })); return input; })(), "entry-limit"],
	];
	it.each(failures)("refuses %s", (name, input, code) => {
		expect(compileCodes(input)).toContain(code);
		// Where the one-line format can say the input at all, the parser refuses its document too.
		const codes = documentCodes(input);
		if (codes !== null) expect(codes.length, name).toBeGreaterThan(0);
	});

	it("a document can break these rules, which it reports with the compiler's own code; it has no way to write the others", () => {
		const sameCode = failures.filter(([, input, code]) => documentCodes(input)?.includes(code) === true).map(([name]) => name);
		const unsayable = failures.filter(([, input]) => documentCodes(input) === null).map(([name]) => name);
		const otherCode = failures.filter(([name]) => !sameCode.includes(name) && !unsayable.includes(name)).map(([name, input]) => [name, documentCodes(input)]);
		expect({ sameCode, unsayable, otherCode }).toEqual(DOCUMENT_REACH);
	});

	it("accepts a proverb without a noun slot, which exports its predicate (FAKE-PROVERB-RECIPES3)", () => {
		const input = baseInput();
		input.proverbs.push({ id: "p-verb", enabled: true, weight: 1, parts: [slot("predicate", "v1", "pred-p", true), literal("wo")] });
		input.glosses.push({ id: "g-verb", enabled: true, weight: 1, requires: [{ kind: "predicate", slotId: "v1" }], parts: [reference("predicate", "v1"), literal("tatoe")] });
		const result = compileFakeProverbRecipeSet(input);
		expect(result.ok).toBe(true);
		expect(documentCodes(input)).toEqual([]);
		if (!result.ok) return;
		const verbOnly = result.set.proverbs[1]!;
		expect(verbOnly.parts.some((part) => part.kind === "noun")).toBe(false);
		expect(verbOnly.exports).toEqual([{ kind: "predicate", slotId: "v1" }]);
		// It pairs by what it exports: with the gloss that uses the predicate alone, not with the one that also uses a noun.
		expect(result.set.glosses.map((gloss) => [gloss.id, isFakeProverbGlossCompatible(verbOnly, gloss)])).toEqual([["g-one", false], ["g-verb", true]]);
		// It still has to hand the gloss something.
		const silent = baseInput();
		silent.proverbs.push({ id: "p-verb", enabled: true, weight: 1, parts: [slot("predicate", "v1", "pred-p", false), literal("wo")] });
		expect(compileCodes(silent)).toContain("missing-export");
		expect(documentCodes(silent)).toContain("missing-export");
		// And without the gloss that uses the predicate alone it has no gloss at all.
		const alone = baseInput();
		alone.proverbs.push({ id: "p-verb", enabled: true, weight: 1, parts: [slot("predicate", "v1", "pred-p", true), literal("wo")] });
		expect(compileCodes(alone)).toEqual(["unpaired-proverb"]);
	});

	it("names an unexported requirement and an unpaired gloss precisely", () => {
		const unexported = withProverb((p) => { p.parts[4] = slot("predicate", "v1", "pred-p", false); });
		expect(compileCodes(unexported)).toContain("unexported-reference");
		expect(documentCodes(unexported)).toContain("unexported-reference");
		// Two proverbs each export one of the two requirements; neither exports both.
		const split = baseInput();
		split.proverbs = [
			{ id: "p-a", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true)] },
			{ id: "p-b", enabled: true, weight: 1, parts: [slot("noun", "n2", "noun-p", true), literal("wa"), slot("predicate", "v1", "pred-p", true)] },
		];
		split.glosses = [
			{ ...split.glosses[0]!, id: "g-both", requires: [{ kind: "noun", slotId: "n1" }, { kind: "predicate", slotId: "v1" }] },
			{ id: "g-a", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n1" }], parts: [reference("noun", "n1"), literal("tatoe")] },
			{ id: "g-b", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n2" }], parts: [reference("noun", "n2"), literal("tatoe")] },
		];
		expect(compileCodes(split)).toEqual(["unpaired-gloss"]);
		expect(documentCodes(split)).toEqual(["unpaired-gloss"]);
		// Disabled entries are validated but never paired.
		split.glosses[0] = { ...split.glosses[0]!, enabled: false };
		expect(compileCodes(split)).toEqual([]);
	});

	it("pairs by kind as well as slot ID, never by an ID match alone", () => {
		// p-two exports v1 as a noun; the gloss requires v1 as a predicate, which only p-one exports.
		const input = baseInput();
		input.proverbs.push({ id: "p-two", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true), literal("wa"), slot("noun", "v1", "noun-p", true)] });
		expect(compileCodes(input)).toEqual(["unpaired-proverb"]);
		// A hole's letter is its kind, so no document gives the name v1 to a noun.
		expect(render(input)).toBeNull();
		const gloss = { requires: [{ kind: "noun", slotId: "n1" }, { kind: "predicate", slotId: "v1" }] } as const;
		expect(isFakeProverbGlossCompatible({ exports: [{ kind: "noun", slotId: "n1" }, { kind: "noun", slotId: "v1" }] }, gloss)).toBe(false);
		expect(isFakeProverbGlossCompatible({ exports: [{ kind: "noun", slotId: "n1" }, { kind: "predicate", slotId: "v1" }] }, gloss)).toBe(true);
		expect(isFakeProverbGlossCompatible({ exports: [{ kind: "noun", slotId: "n1" }] }, gloss)).toBe(false);
	});

	it.each(["", " は", "は ", "は　", "ha", "**", "> は", "は*", "#は", "は_", "[は]", "`は`", "<b>", "{{n1}}", "${n1}", "/は/", "()=>は",
		"は\u0000", "は\u0085", "は‍", "は‮", "は ", "は\uD800", "が", "＊", "あ".repeat(25)])("refuses unsafe literal %j in both paths", (body) => {
		const input = baseInput();
		input.literals[0] = { id: "wa", literal: body };
		expect(compileCodes(input)).toContain("invalid-literal");
		// An empty text is no text in a line; every other body is written into the line, and the document is refused.
		const source = render(input);
		if (body === "") expect(source).toBeNull();
		else expect(parseStandardFakeProverbRecipeMarkdown(source!).ok).toBe(false);
	});

	it("accepts the literal grammar boundaries", () => {
		for (const body of ["𠮷".repeat(24), "、", "。", "ー", "カタカナ", "漢字々"]) expect(inspectFakeProverbLiteral(body)).toBeNull();
		expect(inspectFakeProverbLiteral("𠮷".repeat(25))).toBe("invalid-literal");
	});

	it("accepts exact limits and the maximum safe weight", () => {
		const input = baseInput();
		input.proverbs[0] = { ...input.proverbs[0]!, weight: Number.MAX_SAFE_INTEGER, parts: [
			slot("modifier", "m1", "mod-p"), slot("noun", "n1", "noun-p", true), literal("wa"), slot("modifier", "m2", "mod-p"), slot("noun", "n2", "noun-p", true),
			literal("wo"), slot("noun", "n3", "noun-p", true), slot("noun", "n4", "noun-p"), slot("predicate", "v1", "pred-p", true), literal("tatoe"),
		] };
		expect(input.proverbs[0].parts).toHaveLength(FAKE_PROVERB_LIMITS.parts.proverb);
		expect(compileCodes(input)).toEqual([]);
		expect(documentCodes(input)).toEqual([]);
	});

	it("does not trust typed callers: wrong field types, extra fields and non-arrays are refused", () => {
		const cases: [unknown, string][] = [
			[withProverb((p) => { p.parts[0] = { ...slot("noun", "n1", "noun-p"), exported: "true" as unknown as boolean }; }), "invalid-boolean"],
			[withProverb((p) => { p.enabled = "true" as unknown as boolean; }), "invalid-boolean"],
			[withProverb((p) => { p.parts[0] = { ...slot("noun", "n1", "noun-p", true), literalId: "wa" }; }), "unknown-field"],
			[withProverb((p) => { p.parts[1] = { ...literal("wa"), slotId: "x" }; }), "unknown-field"],
			[withGloss((g) => { g.parts[0] = { ...reference("noun", "n1"), profileId: "noun-p" }; }), "unknown-field"],
			[{ ...withProverb(() => undefined), extra: true }, "unknown-field"],
			[{ ...baseInput(), proverbs: "p-one" }, "invalid-structure"],
			[withProverb((p) => { p.parts.push(null as unknown as RawFakeProverbPart); }), "invalid-structure"],
			[withGloss((g) => { g.weight = "1" as unknown as number; }), "invalid-weight"],
			[withGloss((g) => { g.weight = Number.NaN; }), "invalid-weight"],
			[withProverb((p) => { p.parts[0] = slot("noun", "n1\n", "noun-p", true); }), "invalid-slot-id"],
			[withProverb((p) => { p.id = "p-one\n"; }), "invalid-id"],
			[withProverb((p) => { p.id = "p".repeat(49); }), "invalid-id"],
			[{ ...baseInput(), dataVersion: 0 }, "invalid-data-version"],
			[{ ...baseInput(), dataVersion: 1.5 }, "invalid-data-version"],
		];
		for (const [input, code] of cases) expect(compileCodes(input)).toContain(code);
		expect(compileCodes(null)).toEqual(["invalid-structure"]);
		expect(compileCodes([])).toEqual(["invalid-structure"]);
	});
});

describe("Recipe Schema 2 positions: a stem plus な and the adverbial slot (FAKE-PROVERB-NA1)", () => {
	/** baseInput() with the gloss modifier profile allowing a stem plus な, and the given changes. */
	function withNa(mutate: (input: Mutable<CompileFakeProverbRecipeSetInput>) => void = () => undefined): Mutable<CompileFakeProverbRecipeSetInput> {
		const input = baseInput();
		input.profiles[1] = { ...input.profiles[1]!, forms: [...input.profiles[1]!.forms, { form: "na-stem-na", weight: 2 }] };
		mutate(input);
		return input;
	}
	/** The gloss with its local noun g2 replaced by one literal, after the na-capable modifier g1. */
	function naBefore(body: string): Mutable<CompileFakeProverbRecipeSetInput> {
		return withNa((input) => {
			input.literals.push({ id: "after", literal: body });
			input.glosses[0] = { ...input.glosses[0]!, parts: input.glosses[0]!.parts.map((part) => (part.kind === "noun" && part.slotId === "g2" ? literal("after") : part)) };
		});
	}
	const adverbialProfile = { id: "adv-p", kind: "adverbial", forms: [{ form: "na-stem-ni", weight: 1 }] };
	/** baseInput() with an adverbial slot a1 placed in the proverb at `index`. */
	function withAdverbial(index: number, mutate: (input: Mutable<CompileFakeProverbRecipeSetInput>) => void = () => undefined): Mutable<CompileFakeProverbRecipeSetInput> {
		const input = baseInput();
		input.profiles.push(adverbialProfile);
		const parts = [...input.proverbs[0]!.parts];
		parts.splice(index, 0, slot("adverbial", "a1", "adv-p"));
		input.proverbs[0] = { ...input.proverbs[0]!, parts };
		mutate(input);
		return input;
	}
	const both = (input: CompileFakeProverbRecipeSetInput) => [compileCodes(input), markdownCodes(document(input, true))];

	it("adds the two forms to their kinds and nothing else", () => {
		expect(FAKE_PROVERB_SLOT_KINDS).toEqual(["noun", "modifier", "predicate", "adverbial"]);
		expect(FAKE_PROVERB_CANDIDATE_FORMS.modifier).toContain("na-stem-na");
		expect(FAKE_PROVERB_CANDIDATE_FORMS.adverbial).toEqual(["na-stem-ni"]);
		expect(FAKE_PROVERB_CANDIDATE_FORMS.predicate).not.toContain("na-stem-na");
		expect([FAKE_PROVERB_LIMITS.slots.proverb.adverbial, FAKE_PROVERB_LIMITS.slots.gloss.adverbial]).toEqual([1, 1]);
	});

	it.each([
		["a noun slot", withNa()],
		["a Han literal", naBefore("者は")],
		["a Katakana literal", naBefore("ネコを")],
		["a listed noun with a particle", naBefore("ことは")],
		["a listed noun ending the literal", naBefore("もの")],
		["a listed noun with a mark", naBefore("ところ。")],
		["a noun reference", withNa((input) => {
			input.glosses[0] = { ...input.glosses[0]!, parts: [reference("noun", "n1"), literal("wa"), slot("modifier", "g1", "mod-p"), reference("noun", "n1"), literal("wo"), reference("predicate", "v1"), literal("tatoe")] };
		})],
	] as const)("lets a stem plus な stand before %s", (_name, input) => {
		expect(both(input)).toEqual([[], []]);
	});

	it.each([
		["a particle", naBefore("のは")],
		["a listed noun that only begins a word", naBefore("ものすごく")],
		["a listed noun followed by kana", naBefore("ことさら")],
		["a hiragana word", naBefore("ねこ")],
		["a predicate reference", withNa((input) => {
			input.glosses[0] = { ...input.glosses[0]!, parts: [reference("noun", "n1"), literal("wa"), slot("noun", "g2", "noun-p"), literal("wo"), slot("modifier", "g1", "mod-p"), reference("predicate", "v1"), literal("tatoe")] };
		})],
		["the end of the recipe", withNa((input) => {
			input.glosses[0] = { ...input.glosses[0]!, parts: [reference("noun", "n1"), literal("wa"), slot("noun", "g2", "noun-p"), literal("wo"), reference("predicate", "v1"), literal("tatoe"), slot("modifier", "g1", "mod-p")] };
		})],
		["a modifier", withNa((input) => {
			input.glosses[0] = { ...input.glosses[0]!, parts: [reference("noun", "n1"), literal("wa"), slot("modifier", "g1", "mod-p"), slot("modifier", "g3", "mod-p"), slot("noun", "g2", "noun-p"), literal("wo"), reference("predicate", "v1"), literal("tatoe")] };
		})],
		["a particle, through a reference to a local slot", withNa((input) => {
			input.glosses[0] = { ...input.glosses[0]!, parts: [...input.glosses[0]!.parts, reference("modifier", "g1"), literal("wa")] };
		})],
	] as const)("refuses a stem plus な before %s", (_name, input) => {
		for (const codes of both(input)) expect(codes).toContain("na-follower");
	});

	it("judges a required modifier by the profiles the proverbs export it with", () => {
		// The proverb exports m1 before a noun; the gloss references it before は.
		const exported = (forms: { form: string; weight: number }[]) => {
			const input = baseInput();
			input.profiles.push({ id: "pm-p", kind: "modifier", forms });
			input.proverbs[0] = { ...input.proverbs[0]!, parts: [slot("modifier", "m1", "pm-p", true), ...input.proverbs[0]!.parts] };
			input.glosses[0] = {
				...input.glosses[0]!, requires: [...input.glosses[0]!.requires, { kind: "modifier", slotId: "m1" }],
				parts: [...input.glosses[0]!.parts, reference("modifier", "m1"), literal("wa")],
			};
			return input;
		};
		expect(both(exported([{ form: "adjective-basic", weight: 1 }]))).toEqual([[], []]);
		for (const codes of both(exported([{ form: "adjective-basic", weight: 1 }, { form: "na-stem-na", weight: 1 }]))) {
			expect(codes).toEqual(["na-follower"]);
		}
	});

	it.each([
		["a predicate slot", withAdverbial(4)],
		["a modifier that cannot hold な", withAdverbial(0, (input) => {
			input.proverbs[0] = { ...input.proverbs[0]!, parts: [slot("adverbial", "a1", "adv-p"), slot("modifier", "m1", "mod-p"), ...input.proverbs[0]!.parts.slice(1)] };
		})],
		["a predicate reference", (() => {
			const input = baseInput();
			input.profiles.push(adverbialProfile);
			input.glosses[0] = { ...input.glosses[0]!, parts: [reference("noun", "n1"), literal("wa"), slot("modifier", "g1", "mod-p"), slot("noun", "g2", "noun-p"), literal("wo"), slot("adverbial", "a1", "adv-p"), reference("predicate", "v1"), literal("tatoe")] };
			return input;
		})()],
	] as const)("lets an adverbial slot stand before %s", (_name, input) => {
		expect(both(input)).toEqual([[], []]);
	});

	it.each([
		["a noun slot", withAdverbial(2)],
		["a literal", withAdverbial(1)],
		["the end of the recipe", withAdverbial(5)],
		["a modifier that may hold な", withAdverbial(0, (input) => {
			input.profiles[1] = { ...input.profiles[1]!, forms: [...input.profiles[1]!.forms, { form: "na-stem-na", weight: 1 }] };
			input.proverbs[0] = { ...input.proverbs[0]!, parts: [slot("adverbial", "a1", "adv-p"), slot("modifier", "m1", "mod-p"), ...input.proverbs[0]!.parts.slice(1)] };
		})],
	] as const)("refuses an adverbial slot before %s", (_name, input) => {
		for (const codes of both(input)) expect(codes).toContain("adverbial-follower");
	});

	it.each([
		["a second adverbial slot", withAdverbial(4, (input) => {
			const parts = [...input.proverbs[0]!.parts];
			parts.splice(4, 0, slot("adverbial", "a2", "adv-p"));
			input.proverbs[0] = { ...input.proverbs[0]!, parts };
		}), "kind-limit"],
		["an adverbial profile with a modifier form", (() => { const input = withAdverbial(4); input.profiles[3] = { ...adverbialProfile, forms: [{ form: "na-stem-na", weight: 1 }] }; return input; })(), "invalid-form"],
		["a modifier profile with the adverbial form", (() => { const input = baseInput(); input.profiles[1] = { ...input.profiles[1]!, forms: [{ form: "na-stem-ni", weight: 1 }] }; return input; })(), "invalid-form"],
		["an adverbial slot with a modifier profile", withAdverbial(4, (input) => {
			input.proverbs[0] = { ...input.proverbs[0]!, parts: input.proverbs[0]!.parts.map((part) => (part.kind === "adverbial" ? slot("adverbial", "a1", "mod-p") : part)) };
		}), "type-mismatch"],
	] as const)("refuses %s", (_name, input, code) => {
		expect(compileCodes(input)).toContain(code);
		// A hole's tag is looked up among the profiles of the hole's own kind, so a document that names another kind's
		// profile names a tag that kind does not have.
		expect(markdownCodes(document(input, true))).toContain(code === "type-mismatch" ? "unknown-tag" : code);
	});

	it("lets a gloss require and reference an exported adverbial slot", () => {
		const input = withAdverbial(4, (draft) => {
			draft.proverbs[0] = { ...draft.proverbs[0]!, parts: draft.proverbs[0]!.parts.map((part) => (part.kind === "adverbial" ? slot("adverbial", "a1", "adv-p", true) : part)) };
			draft.glosses[0] = {
				...draft.glosses[0]!, requires: [...draft.glosses[0]!.requires, { kind: "adverbial", slotId: "a1" }],
				parts: [reference("noun", "n1"), literal("wa"), slot("modifier", "g1", "mod-p"), slot("noun", "g2", "noun-p"), literal("wo"), reference("adverbial", "a1"), reference("predicate", "v1"), literal("tatoe")],
			};
		});
		expect(both(input)).toEqual([[], []]);
		const refused = { ...input, glosses: [{ ...input.glosses[0]!, parts: [...input.glosses[0]!.parts.slice(0, 5), reference("predicate", "v1"), reference("adverbial", "a1"), literal("tatoe")] }] };
		for (const codes of both(refused)) expect(codes).toContain("adverbial-follower");
	});
});

describe("the Fake Proverb recipe line syntax", () => {
	const valid = document(baseInput());
	const PROVERB = "line: {n1:甲}は{n2:甲}を{v1:丙}";
	const GLOSS = "line: {n1}は{+m1:乙}{+n1:甲}を{v1}ことのたとえ。";
	const parse = (source: string) => {
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		if (!parsed.ok) throw new Error(describeFakeProverbSourceIssues(parsed.issues));
		return parsed;
	};
	/** The reference document with every `{n…}` hole untagged and the noun profile the kind's default. */
	const untagged = valid.replace("kind: noun\ntag: 甲", "kind: noun").replaceAll(":甲}", "}");

	it("writes each recipe of the reference set as one line", () => {
		expect(valid.split("\n").filter((line) => line.startsWith("line: "))).toEqual([PROVERB, GLOSS]);
	});

	it("uses the kind's profile without a tag when a hole names none, and keeps a slot written with - from the gloss", () => {
		const slots = (source: string) => parse(source).proverbs[0]!.parts.filter((part) => part.kind !== "literal").map((part) => [part.kind, part.slotId, part.profileId, part.exported]);
		expect(slots(untagged)).toEqual([["noun", "n1", "noun-p", true], ["noun", "n2", "noun-p", true], ["predicate", "v1", "pred-p", true]]);
		expect(slots(untagged.replace("は{n2}を{v1:丙}", "は{-n2}を{v1:丙}"))).toEqual([["noun", "n1", "noun-p", true], ["noun", "n2", "noun-p", false], ["predicate", "v1", "pred-p", true]]);
		// The letter is the kind and the number is part of the name: m, v and a are the other three kinds.
		const kinds = parse(valid.replace(PROVERB, "line: {m1:乙}{n1:甲}は{n2:甲}を{v1:丙}")).proverbs[0]!.parts.filter((part) => part.kind !== "literal").map((part) => [part.kind, part.slotId]);
		expect(kinds).toEqual([["modifier", "m1"], ["noun", "n1"], ["noun", "n2"], ["predicate", "v1"]]);
	});

	it("reads a gloss's holes as requirements, references and new slots named g1, g2 … in order of appearance", () => {
		const gloss = parse(valid.replace(GLOSS, "line: {v1}なら{+n1:甲}は{n1}の{+m1:乙}{+n2:甲}、{+n1}ことのたとえ。")).glosses[0]!;
		// A proverb hole is a requirement in order of first appearance, however often the line uses it.
		expect(gloss.requires).toEqual([{ kind: "predicate", slotId: "v1" }, { kind: "noun", slotId: "n1" }]);
		expect(gloss.parts.filter((part) => part.kind !== "literal")).toEqual([
			{ kind: "reference", slotKind: "predicate", slotId: "v1" },
			{ kind: "noun", slotId: "g1", profileId: "noun-p", exported: false },
			{ kind: "reference", slotKind: "noun", slotId: "n1" },
			{ kind: "modifier", slotId: "g2", profileId: "mod-p", exported: false },
			{ kind: "noun", slotId: "g3", profileId: "noun-p", exported: false },
			// The same + name again is the same new word: a reference to the slot, not another slot.
			{ kind: "reference", slotKind: "noun", slotId: "g1" },
		]);
	});

	it("makes one literal of each run of fixed text, names it from the text, and shares equal text", () => {
		const parsed = parse(valid);
		// は stands in both recipes and is one literal; the three are in order of first appearance.
		expect(parsed.literals).toEqual(["は", "を", "ことのたとえ。"].map((text) => ({ id: fakeProverbLiteralId(text), literal: text })));
		expect(fakeProverbLiteralId("は")).toBe("l-de77c92e");
		for (const entry of parsed.literals) expect(entry.id).toMatch(/^l-[0-9a-f]{8}$/u);
		// The id is the text's own: it does not move when the text stands somewhere else or other text comes before it.
		const moved = parse(valid.replace(PROVERB, "line: {n1:甲}を{n2:甲}は{v1:丙}なり"));
		expect(moved.literals.map((entry) => entry.literal)).toEqual(["を", "は", "なり", "ことのたとえ。"]);
		for (const entry of moved.literals) expect(entry.id).toBe(fakeProverbLiteralId(entry.literal));
		// A run is everything between two holes, at the start of the line and at its end.
		const runs = parse(valid.replace(PROVERB, "line: 昔、{n1:甲}は{n2:甲}を{v1:丙}という。")).proverbs[0]!;
		expect(structure(runs.parts, parse(valid.replace(PROVERB, "line: 昔、{n1:甲}は{n2:甲}を{v1:丙}という。")).literals)).toBe("昔、{n1}は{n2}を{v1}という。");
		expect(runs.parts.map((part) => part.kind)).toEqual(["literal", "noun", "literal", "noun", "literal", "predicate", "literal"]);
	});

	it("stops when two different fixed texts get the same id, and says which two", () => {
		// Eight hexadecimal digits are 32 bits. きぱの and じてい are two of the pairs a search of 161,800 three-letter
		// texts found; either alone is an ordinary fixed text.
		expect([fakeProverbLiteralId("きぱの"), fakeProverbLiteralId("じてい")]).toEqual(["l-85f9640c", "l-85f9640c"]);
		for (const text of ["きぱの", "じてい"]) expect(parseStandardFakeProverbRecipeMarkdown(valid.replace(PROVERB, `line: {n1:甲}${text}{n2:甲}を{v1:丙}`)).ok).toBe(true);
		const source = valid.replace(PROVERB, "line: {n1:甲}きぱの{n2:甲}じてい{v1:丙}");
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.issues.map((entry) => [entry.code, entry.detail])).toContainEqual(["literal-id-collision", "p-one: l-85f9640c"]);
		expect(explainFakeProverbSourceIssues(parsed.issues)).toContain("（proverb p-one）: 固定の文字「じてい」と「きぱの」が、同じ id（l-85f9640c）になりました。");
	});

	it("returns each recipe's line as written, beside the data", () => {
		expect(parse(valid).authored).toEqual({ "p-one": PROVERB.slice(6), "g-one": GLOSS.slice(6) });
	});

	const refused: [string, string, string][] = [
		// the entry's own lines
		["a field after the line", valid.replace(`weight: 2\n${PROVERB}`, `${PROVERB}\nweight: 2`), "misplaced-field"],
		["a second line", valid.replace(`${PROVERB}\n`, `${PROVERB}\nline: {n1:甲}\n`), "duplicate-line"],
		["a recipe without a line", valid.replace(`${PROVERB}\n`, ""), "missing-line"],
		["an empty line", valid.replace(PROVERB, "line: "), "invalid-line"],
		["the old part field", valid.replace("weight: 2\n", "weight: 2\npart: noun n1 noun-p export\n"), "unknown-field"],
		["the old requires field", valid.replace(`weight: 1\n${GLOSS}`, `weight: 1\nrequires: noun n1\n${GLOSS}`), "unknown-field"],
		["an unknown field", valid.replace("weight: 2\n", "weight: 2\nlabel: Test\n"), "unknown-field"],
		["a tag in a recipe", valid.replace("weight: 2\n", "weight: 2\ntag: 甲\n"), "unknown-field"],
		["a duplicate field", valid.replace("weight: 2\n", "weight: 2\nweight: 3\n"), "duplicate-field"],
		["a missing weight", valid.replace("weight: 2\n", ""), "missing-field"],
		["a missing enabled flag", valid.replace("## proverb p-one\nenabled: true\n", "## proverb p-one\n"), "missing-field"],
		["a missing profile kind", valid.replace("kind: noun\n", ""), "missing-field"],
		["a boolean spelling", valid.replace("enabled: true", "enabled: TRUE"), "invalid-boolean"],
		["a leading-zero weight", valid.replace("weight: 2", "weight: 02"), "invalid-weight"],
		["an exponent weight", valid.replace("weight: 2", "weight: 2e0"), "invalid-weight"],
		["a negative weight", valid.replace("weight: 2", "weight: -2"), "invalid-weight"],
		["an unsafe weight", valid.replace("weight: 2", `weight: ${Number.MAX_SAFE_INTEGER + 1}`), "invalid-weight"],
		["a form weight word", valid.replace("form: verb-past 1", "form: verb-past high"), "invalid-weight"],
		["a form line with extra words", valid.replace("form: verb-past 1", "form: verb-past 1 always"), "invalid-form-line"],
		["a field after a form", valid.replace("kind: noun\ntag: 甲\nform: independent-noun 1", "kind: noun\nform: independent-noun 1\ntag: 甲"), "misplaced-field"],
		["a line that is not a field", valid.replace("weight: 2\n", "weight 2\n"), "invalid-field"],
		["a blank line inside a recipe", valid.replace("weight: 2\n", "weight: 2\n\n"), "unexpected-content"],
		["text under a recipe", valid.replace(`${PROVERB}\n`, `${PROVERB}\n\nことわざ\n`), "unexpected-content"],
		// holes
		["too many holes and fixed texts in a line", valid.replace(PROVERB, "line: 昔、{n1:甲}は{n2:甲}を{-n3:甲}に{-n4:甲}へ{v1:丙}という"), "part-limit"],
		["an unclosed hole", valid.replace(PROVERB, "line: {n1:甲}は{n2:甲}を{v1:丙"), "invalid-line"],
		["a hole of an unknown kind", valid.replace("{n2:甲}を", "{x2:甲}を"), "invalid-hole"],
		["a hole numbered zero", valid.replace("{n2:甲}を", "{n0:甲}を"), "invalid-hole"],
		["a hole with two digits", valid.replace("{n2:甲}を", "{n10:甲}を"), "invalid-hole"],
		["a hole with a word", valid.replace("{n2:甲}を", "{noun}を"), "invalid-hole"],
		["a hole with spaces", valid.replace("{n2:甲}を", "{ n2:甲 }を"), "invalid-hole"],
		["a hole without a number", valid.replace("{n2:甲}を", "{n:甲}を"), "invalid-hole"],
		["an empty hole", valid.replace("{n2:甲}を", "{}を"), "invalid-hole"],
		["a doubled brace", valid.replace("{n2:甲}を", "{{n2:甲}}を"), "invalid-hole"],
		["a plus hole in a proverb", valid.replace("{n2:甲}を", "{+n2:甲}を"), "local-hole-in-proverb"],
		["a minus hole in a gloss", valid.replace("line: {n1}は{+m1", "line: {-n1}は{+m1"), "private-hole-in-gloss"],
		["a tag on a proverb's word in a gloss", valid.replace("を{v1}ことのたとえ。", "を{v1:丙}ことのたとえ。"), "tag-on-reference"],
		["a tag on the second use of a new word", valid.replace("を{v1}ことのたとえ。", "を{v1}こと{+n1:甲}のたとえ。"), "tag-on-reference"],
		["an unknown tag", valid.replace("{n2:甲}を", "{n2:癸}を"), "unknown-tag"],
		["a tag of another kind's profile", valid.replace("{n2:甲}を", "{n2:丙}を"), "unknown-tag"],
		["a hole without a tag when its kind has no default profile", valid.replace("{n2:甲}を", "{n2}を"), "no-default-profile"],
		["an empty tag", valid.replace("{n2:甲}を", "{n2:}を"), "invalid-tag"],
		["a tag that is too long", valid.replace("{n2:甲}を", "{n2:甲乙丙丁戊}を"), "invalid-tag"],
		["an ASCII tag", valid.replace("{n2:甲}を", "{n2:a}を"), "invalid-tag"],
		// profiles
		["an ASCII profile tag", valid.replace("tag: 甲", "tag: A"), "invalid-tag"],
		["a tag used twice in one kind", `${valid}\n## profile noun-q\nkind: noun\ntag: 甲\nform: independent-noun 1\n`, "duplicate-tag"],
		["two default profiles of one kind", `${valid}\n## profile noun-q\nkind: noun\nform: independent-noun 1\n\n## profile noun-r\nkind: noun\nform: independent-noun 1\n`, "duplicate-default-profile"],
		// the entries and the head of the document
		["a literal entry, which the old format had", `${valid}\n## literal wa\n\nは\n`, "unknown-entry-kind"],
		["an unknown entry kind", valid.replace("## profile noun-p", "## template noun-p"), "unknown-entry-kind"],
		["an unknown heading", valid.replace("## profile noun-p", "### profile noun-p"), "unknown-heading"],
		["a second title", `${valid}\n# Another title\n`, "unexpected-title"],
		["orphan content", valid.replace("schema-version: 2", "schema-version: 2\nhello"), "orphan-content"],
		["an unknown metadata key", valid.replace("schema-version: 2", "schema-version: 2\nalgorithm-version: 1"), "unknown-metadata"],
		["a duplicate metadata key", valid.replace("data-version: 1", "data-version: 1\ndata-version: 1"), "duplicate-metadata"],
		["a missing data version", valid.replace("data-version: 1\n", ""), "missing-metadata"],
		["a non-integer data version", valid.replace("data-version: 1", "data-version: v1"), "invalid-metadata"],
		["a stale schema version", valid.replace("schema-version: 2", "schema-version: 1"), "unsupported-schema-version"],
		["a future schema version", valid.replace("schema-version: 2", "schema-version: 3"), "unsupported-schema-version"],
	];
	it.each(refused)("refuses %s", (_name, source, code) => {
		expect(source).not.toBe(valid);
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.issues.map((entry) => entry.code)).toContain(code);
		// Each of these is something a person can write into the document, and each is explained in Japanese.
		for (const entry of parsed.issues) expect(entry.ja, entry.code).toEqual(expect.any(String));
	});

	it("reports every problem in document order with the line it is on, without leaking a path", () => {
		const lineOf = (source: string, text: string) => source.split("\n").indexOf(text) + 1;
		const source = valid.replace("weight: 2", "weight: 0").replace("を{v1:丙}", "を{w1:丙}").replace("form: verb-past 1", "form: verb-past x");
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.issues.map((entry) => [entry.code, entry.line])).toEqual([
			["invalid-weight", lineOf(source, "weight: 0")], ["invalid-hole", lineOf(source, "line: {n1:甲}は{n2:甲}を{w1:丙}")], ["invalid-weight", lineOf(source, "form: verb-past x")],
		]);
		expect(describeFakeProverbSourceIssues(parsed.issues)).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//u);
		// Line syntax first; once it passes, a compiler issue names the recipe's `line:`, not its heading.
		const twice = valid.replace(PROVERB, "line: {n1:甲}は{n2:甲}を{n2:甲}{v1:丙}");
		const semantic = parseStandardFakeProverbRecipeMarkdown(twice);
		const line = lineOf(twice, "line: {n1:甲}は{n2:甲}を{n2:甲}{v1:丙}");
		expect(line).toBeGreaterThan(lineOf(twice, "## proverb p-one"));
		expect(semantic.ok ? [] : semantic.issues.map((entry) => [entry.code, entry.line, entry.entry])).toEqual([
			["duplicate-slot-id", line, "proverb p-one"], ["duplicate-export", line, "proverb p-one"],
		]);
		// A profile's problem names the profile's heading.
		const unused = `${valid}\n## profile spare-p\nkind: noun\ntag: 己\nform: independent-noun 1\n`;
		const spare = parseStandardFakeProverbRecipeMarkdown(unused);
		expect(spare.ok ? [] : spare.issues.map((entry) => [entry.code, entry.line, entry.entry])).toEqual([["unused-profile", lineOf(unused, "## profile spare-p"), "profile spare-p"]]);
	});

	it("has no inline executable data: regex, JavaScript or placeholders in a line are refused", () => {
		for (const body of ["/(は|が)/u", "function(){}", "{{noun}}", "${n1}", "[a-z]+", "<script>"]) {
			expect(parseStandardFakeProverbRecipeMarkdown(valid.replace("ことのたとえ。", body)).ok).toBe(false);
		}
	});
});

describe("the Japanese explanation of a document's problems", () => {
	const valid = document(baseInput());
	const explain = (source: string): string => {
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		if (parsed.ok) throw new Error("the document was accepted");
		return explainFakeProverbSourceIssues(parsed.issues);
	};
	const lineOf = (source: string, start: string) => source.split("\n").findIndex((line) => line.startsWith(start)) + 1;

	it("names the line, the entry, the hole as written and the code", () => {
		const source = valid.replace("を{v1:丙}", "を{w1:丙}");
		const text = explain(source);
		expect(text.split("\n")[0]).toBe(`${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN} に、直すところがあります。`);
		expect(text).toContain(`${lineOf(source, "line: {n1:甲}は")} 行目（proverb p-one）: 穴 {w1:丙} の書き方が違います。`);
		expect(text).toMatch(/\(invalid-hole\)$/u);
	});

	it("shows a gloss's new word as it was written, not as the slot the compiler names", () => {
		// The gloss's own modifier may hold a stem plus な, and here a particle follows it.
		const source = valid.replace("form: verb-past 1", "form: verb-past 1\nform: na-stem-na 2").replace("{+m1:乙}{+n1:甲}を", "{+m1:乙}を{+n1:甲}");
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		expect(parsed.ok ? [] : parsed.issues.map((entry) => [entry.code, entry.detail])).toEqual([["na-follower", "g-one: g1"]]);
		const text = explain(source);
		expect(text).toContain(`${lineOf(source, "line: {n1}は")} 行目（gloss g-one）: {+m1} の直後に置けません。`);
		expect(text).toContain("(na-follower)");
		expect(text).not.toContain("g1");
		// A proverb's word keeps its name.
		const exported = valid.replace("kind: noun\ntag: 甲", "kind: noun\ntag: 甲").replace("を{v1:丙}", "を{-v1:丙}");
		expect(explain(exported)).toContain("{v1} は、どのことわざも解説に渡していません");
	});

	it("says which characters may follow こと もの and the like after a modifier that can hold a stem plus な", () => {
		// 「ものなり」: もの is a listed noun, but its next character な is not one the tail list allows.
		const source = valid.replace("form: verb-past 1", "form: verb-past 1\nform: na-stem-na 2").replace("{+m1:乙}{+n1:甲}を", "{+m1:乙}ものなり{+n1:甲}を");
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		expect(parsed.ok ? [] : parsed.issues.map((entry) => [entry.code, entry.detail])).toEqual([["na-follower", "g-one: g1"]]);
		const text = explain(source);
		expect(text).toContain("{+m1} の直後に置けません。");
		expect(text).toContain("こと もの ところ ため はず わけ ほう");
		expect(text).toContain("次の字は、文字の終わりか、が を に は も で の と か だ 、 。 のどれかだけです（「ものなり」の「な」は使えません）。");
		// The same word followed by a listed character is accepted.
		const accepted = valid.replace("form: verb-past 1", "form: verb-past 1\nform: na-stem-na 2").replace("{+m1:乙}{+n1:甲}を", "{+m1:乙}ものを{+n1:甲}を");
		expect(parseStandardFakeProverbRecipeMarkdown(accepted).ok).toBe(true);
	});

	it("shows the fixed text itself, never the id the parser gave it", () => {
		const text = explain(valid.replace("ことのたとえ。", 'ことの"たとえ"。'));
		expect(text).toContain('固定の文字「ことの"たとえ"。」に、使えない字があるか、長すぎます。');
		expect(text).toContain("24 字まで");
		expect(text).not.toMatch(/l-[0-9a-f]{8}/u);
		expect(text).toContain("(invalid-literal)");
	});

	it("explains the limits with the schema's own numbers", () => {
		const many = valid.replace("line: {n1:甲}は{n2:甲}を{v1:丙}", "line: {n1:甲}{n2:甲}{n3:甲}{n4:甲}{n5:甲}は{v1:丙}");
		expect(explain(many)).toContain(`名詞の穴が多すぎます。ことわざでは、${FAKE_PROVERB_LIMITS.slots.proverb.noun} 個までです。`);
		expect(explain(many)).toContain(`解説に渡す穴が多すぎます（${FAKE_PROVERB_LIMITS.exports} 個まで）`);
	});

	it("says one mistake once when the compiler reports it under two codes", () => {
		// The same word twice in a proverb is a duplicate slot and a duplicate export.
		const source = valid.replace("line: {n1:甲}は{n2:甲}を{v1:丙}", "line: {n1:甲}は{n1:甲}を{v1:丙}");
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		expect(parsed.ok ? [] : parsed.issues.map((entry) => entry.code)).toEqual(["duplicate-slot-id", "duplicate-export"]);
		const text = explain(source);
		expect(text.split("\n").filter((line) => line !== "")).toEqual([
			`${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN} に、直すところがあります。`,
			`${lineOf(source, "line: {n1:甲}は")} 行目（proverb p-one）: 同じ穴 {n1:甲} を 2 回書いています。ことわざの中では、1 つの穴は 1 回だけ書けます。 (duplicate-slot-id, duplicate-export)`,
		]);
	});

	it("keeps the code alone for a problem no Japanese sentence is written for", () => {
		expect(explainFakeProverbSourceIssues([{ code: "invalid-structure", line: 1, detail: "proverbs" }]))
			.toContain("1 行目: （日本語の説明の無い誤りです: proverbs） (invalid-structure)");
	});

	it("is what a failed generation says after the line that names the codes", async () => {
		const error = await caught(() => generateStandardFakeProverbRecipes({ markdown: valid.replace("を{v1:丙}", "を{w1:丙}") }));
		const [first, , third] = (error as Error).message.split("\n");
		expect(first).toMatch(/^resources\/fake-proverb\/standard-recipes\.md is not a valid recipe document: invalid-hole \(line \d+\): p-one: \{w1:丙\}$/u);
		expect(third).toBe(`${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN} に、直すところがあります。`);
		expect((error as Error).message).toContain("(invalid-hole)");
	});
});

describe("the generated Fake Proverb recipe module", () => {
	it("is exactly what the document implies, and the guard accepts the checkout", async () => {
		const { source } = await generateStandardFakeProverbRecipes({ rootDir: process.cwd() });
		expect(await readFile(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "utf8")).toBe(source);
		await expect(assertStandardFakeProverbRecipesGenerated({ rootDir: process.cwd() })).resolves.toEqual({ schemaVersion: 2, dataVersion: STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION });
	});

	it("renders byte-identical output with no timestamp or absolute path", async () => {
		const first = await generateStandardFakeProverbRecipes({ rootDir: process.cwd() });
		const second = await generateStandardFakeProverbRecipes({ rootDir: process.cwd() });
		expect(second.source).toBe(first.source);
		expect(first.source).not.toMatch(/\d{4}-\d{2}-\d{2}|[A-Za-z]:\\|\/Users\/|\/home\//u);
		expect(first.source.startsWith(`// Generated from ${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN}.`)).toBe(true);
		expect(first.source).toContain(GENERATE_COMMAND);
		expect(renderGeneratedFakeProverbRecipeModule({ ...first.parsed, proverbs: first.parsed.proverbs.slice(1) })).not.toBe(first.source);
	});

	it("refuses a missing or unreadable document instead of falling back to what is on disk", async () => {
		await expect(generateStandardFakeProverbRecipes({ rootDir: "/nonexistent-semantropy-root" })).rejects.toThrow(/standard-recipes\.md is missing/u);
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-proverb-unreadable-"));
		try {
			const error = await caught(() => generateStandardFakeProverbRecipes({ markdownPath: scratch }));
			expect((error as Error).message).toMatch(/is unreadable \(EISDIR\)/u);
			expect((error as Error).message).not.toMatch(/missing/u);
			expect((error as Error & { cause: NodeJS.ErrnoException }).cause.code).toBe("EISDIR");
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("refuses a malformed document before anything is written", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("malformed");
		try {
			const generated = await readFile(outfile, "utf8");
			const lock = await readFile(lockPath, "utf8");
			await expect(writeStandardFakeProverbRecipes({ markdown: "nothing here is a recipe", generatedPath: outfile, lockPath }))
				.rejects.toThrow(/not a valid recipe document/u);
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual([generated, lock]);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("keeps generated data separate from Collision and Fake Dictionary", async () => {
		const generated = await readFile(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "utf8");
		const schema = await readFile("src/fakeProverb/recipeData.ts", "utf8");
		const compiler = await readFile("src/fakeProverb/compileRecipeSet.ts", "utf8");
		expect(generated).not.toMatch(/scripts\/|node:|esbuild|collision|dictionary/iu);
		expect(generated.match(/from "([^"]+)"/gu)).toEqual(['from "../recipeData"']);
		const statements = schema.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
		expect(statements).not.toMatch(/\bimport\b|\brequire\b|STANDARD_FAKE_PROVERB_/u);
		expect(compiler.match(/from "([^"]+)"/gu)).toEqual(['from "./recipeData"', 'from "./recipeData"']);
		expect(STANDARD_FAKE_PROVERB_RECIPES_LOCK).not.toBe(STANDARD_COLLISION_PATTERNS_LOCK);
		expect(FAKE_PROVERB_RECIPE_SCHEMA_VERSION).toBe(2);
	});
});

describe("Fake Proverb recipe generation, lock and publication", () => {
	it("allows first generation only at data-version 1 when both destinations are absent, then each next version on top", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("first", { copyLock: false });
		try {
			// The checkout's versions 1 and 2 were written in formats the parser no longer reads, so the history here is
			// the current document at data-version 1, an edit of it at 2, data 3 (the document with `heart-unknown` as
			// it read before CORRECTION-ROUND1) at 3, and the checkout's own module at version 4.
			const source = await standardMarkdown();
			const written = await writeStandardFakeProverbRecipes({ markdown: bumped(source, 1), generatedPath: outfile, lockPath });
			expect(written).toEqual({ outfile: STANDARD_FAKE_PROVERB_RECIPES_GENERATED, schemaVersion: 2, dataVersion: 1, proverbs: 63, glosses: 32, literals: 136, profiles: 14 });
			const first = (JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock).versions;
			expect(first.map((entry) => entry.dataVersion)).toEqual([1]);
			await writeStandardFakeProverbRecipes({ markdown: bumped(source, 2) + EXTRA_PROVERB, generatedPath: outfile, lockPath });
			const second = (JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock).versions;
			expect(second.map((entry) => entry.dataVersion)).toEqual([1, 2]);
			expect(second[0]).toEqual(first[0]);
			await writeStandardFakeProverbRecipes({ markdown: bumped(source.replace(HEART_V4, HEART_V3), 3), generatedPath: outfile, lockPath });
			const third = (JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock).versions;
			expect(third).toEqual([...second, { dataVersion: 3, digest: V3_DIGEST }]);
			await writeStandardFakeProverbRecipes({ generatedPath: outfile, lockPath });
			expect(await readFile(outfile, "utf8")).toBe(await readFile(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "utf8"));
			expect((JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock).versions).toEqual([...third, { dataVersion: 4, digest: V4_DIGEST }]);
			expect((await readdir(scratch)).sort()).toEqual(["standard-recipes.lock.json", "standardFakeProverbRecipeEntries.ts"]);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each([
		["first generation at version 2", { copyLock: false }, 2],
		["a skipped version after the lock's last", { copyLock: true }, NEXT + 1],
	] as const)("refuses %s before staging incomplete history", async (_name, options, version) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("gap", options);
		try {
			const before = options.copyLock === false ? null : [await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")];
			await expect(writeStandardFakeProverbRecipes({ markdown: bumped(await standardMarkdown(), version) + EXTRA_PROVERB, generatedPath: outfile, lockPath }))
				.rejects.toThrow(/data-version-gap/u);
			if (before === null) expect(await readdir(scratch)).toEqual([]);
			else expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual(before);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each([
		["fixed text", (s: string) => once(s, "line: {n1}は{n2}のもと", "line: {n1}は{n2}のはじまり")],
		["a weight", (s: string) => once(s, "form: verb-basic 3", "form: verb-basic 4")],
		["a slot the gloss gets", (s: string) => once(s, "line: {-m1}{n1}は{n2}を{v1:否}", "line: {m1}{n1}は{n2}を{v1:否}")],
		["the order of a line", (s: string) => once(s, "line: {n1}は{n2}のもと", "line: {n2}は{n1}のもと")],
		["the order of two entries", (s: string) => once(s, "## proverb rather-than\nenabled: true\nweight: 4\nline: {n1}より{n2}\n\n## proverb offered-to\nenabled: true\nweight: 4\nline: {n1}に{n2}\n",
			"## proverb offered-to\nenabled: true\nweight: 4\nline: {n1}に{n2}\n\n## proverb rather-than\nenabled: true\nweight: 4\nline: {n1}より{n2}\n")],
		["an added entry", (s: string) => s + EXTRA_PROVERB],
		["a deletion", (s: string) => s.replace(/## proverb offered-to[\s\S]*?(?=## proverb modified-topic)/u, "")],
	] as const)("refuses a same-version meaning change to %s, then accepts it at the next version while keeping history", async (_name, mutate) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("same-version");
		try {
			const generated = await readFile(outfile, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			const edited = mutate(await standardMarkdown());
			expect(parseStandardFakeProverbRecipeMarkdown(edited).ok).toBe(true);
			await expect(writeStandardFakeProverbRecipes({ markdown: edited, generatedPath: outfile, lockPath })).rejects.toThrow(/data-version-unchanged/u);
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: edited, generatedPath: outfile, lockPath })).rejects.toThrow(GENERATE_PATTERN);
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual([generated, lockBefore]);
			await writeStandardFakeProverbRecipes({ markdown: bumped(edited, NEXT), generatedPath: outfile, lockPath });
			const after = JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock;
			expect(after.versions[0]).toEqual({ dataVersion: 1, digest: V1_DIGEST });
			expect(after.versions.map((entry) => entry.dataVersion)).toEqual([1, 2, 3, 4, NEXT]);
			// The previous meaning is not re-approvable at a lower version either.
			await expect(writeStandardFakeProverbRecipes({ generatedPath: outfile, lockPath })).rejects.toThrow(/data-version-unchanged/u);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("refuses a same-version meaning change even when payload and digest are rewritten together", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("self-authenticated");
		try {
			const edited = (await standardMarkdown()) + EXTRA_PROVERB;
			const { source } = await generateStandardFakeProverbRecipes({ markdown: edited });
			await writeFile(outfile, source);
			const lockBefore = await readFile(lockPath, "utf8");
			await expect(writeStandardFakeProverbRecipes({ markdown: edited, generatedPath: outfile, lockPath })).rejects.toThrow(/data-version-unchanged/u);
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: edited, generatedPath: outfile, lockPath }))
				.rejects.toThrow(/does not record the current recipe data/u);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("restores comment, formatting and entry-array hand edits at the same version", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("restore");
		try {
			const original = await readFile(outfile, "utf8");
			const handEdited = original.replace("Do not edit this file.", "edited by hand")
				.replace('{ id: "rather-than"', '// comment\n\t{ id: "rather-than"')
				.replace(/\{ id: "origin-of".*\n/u, "");
			expect(handEdited).not.toBe(original);
			await writeFile(outfile, handEdited);
			await expect(assertStandardFakeProverbRecipesGenerated({ generatedPath: outfile, lockPath })).rejects.toThrow(/does not match/u);
			await writeStandardFakeProverbRecipes({ generatedPath: outfile, lockPath });
			expect(await readFile(outfile, "utf8")).toBe(original);
			await expect(assertStandardFakeProverbRecipesGenerated({ generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 2, dataVersion: STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION });
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each([
		["missing digest", (s: string) => s.replace(/export const STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST = .*\n/u, ""), "missing-digest"],
		["malformed digest", (s: string) => s.replace(/(DATA_DIGEST = ")[0-9a-f]{64}/u, "$1xyz"), "malformed-digest"],
		["duplicate digest", (s: string) => s.replace(/(export const STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST = .*\n)/u, "$1$1"), "duplicate-digest"],
		["computed digest", (s: string) => s.replace(/(DATA_DIGEST = )"[0-9a-f]{64}"/u, "$1String(1)"), "malformed-digest"],
		["missing payload", (s: string) => s.replace(/export const STANDARD_FAKE_PROVERB_RECIPE_DATA_JSON = .*\n/u, ""), "missing-payload"],
		["non-JSON payload", (s: string) => s.replace(/(DATA_JSON = )".*";\n/u, '$1"not json";\n'), "malformed-payload"],
		["non-canonical payload", (s: string) => s.replace(/(DATA_JSON = )".*";\n/u, `$1${JSON.stringify(JSON.stringify({ dataVersion: 1, schemaVersion: 1, proverbs: [], glosses: [], literals: [], profiles: [] }))};\n`), "malformed-payload"],
		["inconsistent digest", (s: string) => s.replace(/(DATA_DIGEST = ")[0-9a-f]{64}/u, `$1${"0".repeat(64)}`), "digest-inconsistent"],
	] as const)("refuses a previous generated module with a %s", async (_name, mutate, code) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("untrusted-generated");
		try {
			const edited = mutate(await readFile(outfile, "utf8"));
			await writeFile(outfile, edited);
			const lock = await readFile(lockPath, "utf8");
			await expect(writeStandardFakeProverbRecipes({ generatedPath: outfile, lockPath })).rejects.toThrow(new RegExp(`\\(${code}\\)`, "u"));
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual([edited, lock]);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	const V1 = { dataVersion: 1, digest: V1_DIGEST };
	it.each([
		{}, [], { versions: [] }, { versions: [V1, V1] }, { versions: [{ ...V1, dataVersion: 2 }] }, { versions: [{ ...V1, dataVersion: "1" }] },
		{ versions: [{ ...V1, digest: "invalid" }] }, { versions: [{ ...V1, extra: true }] }, { versions: [V1], extra: true }, V1,
		{ versions: [V1, { dataVersion: 3, digest: V1_DIGEST }] },
	])("refuses the malformed or history-breaking lock %j before any write, in both writer and guard", async (lock) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("bad-lock");
		try {
			const lockText = JSON.stringify(lock);
			await writeFile(lockPath, lockText);
			const generated = await readFile(outfile, "utf8");
			await expect(writeStandardFakeProverbRecipes({ generatedPath: outfile, lockPath })).rejects.toThrow(/malformed-lock/u);
			await expect(assertStandardFakeProverbRecipesGenerated({ generatedPath: outfile, lockPath })).rejects.toThrow(/malformed-lock/u);
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual([generated, lockText]);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("refuses a lock that has lost version 1, and a lock that is missing beside a generated module", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("lost-history");
		try {
			const next = bumped(await standardMarkdown(), NEXT) + EXTRA_PROVERB;
			await writeStandardFakeProverbRecipes({ markdown: next, generatedPath: outfile, lockPath });
			const lock = JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock;
			await writeFile(lockPath, JSON.stringify({ versions: lock.versions.slice(1) }));
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: next, generatedPath: outfile, lockPath })).rejects.toThrow(/malformed-lock/u);
			await expect(writeStandardFakeProverbRecipes({ markdown: next, generatedPath: outfile, lockPath })).rejects.toThrow(/malformed-lock/u);
			await rm(lockPath);
			await expect(writeStandardFakeProverbRecipes({ markdown: next, generatedPath: outfile, lockPath })).rejects.toThrow(/standard-recipes\.lock\.json is missing/u);
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: next, generatedPath: outfile, lockPath })).rejects.toThrow(/standard-recipes\.lock\.json is missing/u);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each(["generated", "lock"] as const)("propagates an unreadable %s before staging and never calls it missing", async (which) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("unreadable");
		try {
			const target = which === "generated" ? outfile : lockPath;
			const readText = readTextWithFailures(new Map([[target, injectedFsError("EACCES")]]));
			const before = [await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")];
			const markdown = bumped(await standardMarkdown(), NEXT) + EXTRA_PROVERB;
			const writeError = await caught(() => writeStandardFakeProverbRecipes({ markdown, generatedPath: outfile, lockPath, readText }));
			expect((writeError as NodeJS.ErrnoException).code).toBe("EACCES");
			const guardError = await caught(() => assertStandardFakeProverbRecipesGenerated({ generatedPath: outfile, lockPath, readText }));
			const label = which === "generated" ? STANDARD_FAKE_PROVERB_RECIPES_GENERATED : STANDARD_FAKE_PROVERB_RECIPES_LOCK;
			expect((guardError as Error).message).toContain(`${label} is unreadable (EACCES)`);
			expect((guardError as Error).message).not.toMatch(/is missing/u);
			expect((guardError as Error).message).not.toContain(GENERATE_COMMAND);
			expect((guardError as { cause?: { code?: string } }).cause?.code).toBe("EACCES");
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual(before);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each(["generated", "lock"] as const)("leaves generated and lock byte-unchanged when %s publication fails during a version bump", async (phase) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths(`publish-${phase}`);
		try {
			const before = [await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")];
			await expect(writeStandardFakeProverbRecipes({
				markdown: bumped(await standardMarkdown(), NEXT) + EXTRA_PROVERB, generatedPath: outfile, lockPath,
				beforePublish: (current) => { if (current === phase) throw new Error(`injected ${phase} failure`); },
			})).rejects.toThrow(`injected ${phase} failure`);
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual(before);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each(["generated", "lock"] as const)("removes a new generated module when first-generation %s publication fails", async (phase) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths(`first-fail-${phase}`, { copyLock: false });
		try {
			await expect(writeStandardFakeProverbRecipes({
				markdown: bumped(await standardMarkdown(), 1), generatedPath: outfile, lockPath,
				beforePublish: (current) => { if (current === phase) throw new Error(`injected ${phase} failure`); },
			})).rejects.toThrow(`injected ${phase} failure`);
			expect(await readdir(scratch)).toEqual([]);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("reports a rollback failure, keeps the previous lock, and is repaired by the next generate", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rollback");
		try {
			const lockBefore = await readFile(lockPath, "utf8");
			const next = bumped(await standardMarkdown(), NEXT) + EXTRA_PROVERB;
			const { source: nextSource } = await generateStandardFakeProverbRecipes({ markdown: next });
			const error = await caught(() => writeStandardFakeProverbRecipes({
				markdown: next, generatedPath: outfile, lockPath,
				beforePublish: (phase) => { if (phase === "lock") throw new Error("injected lock failure"); },
				beforeRollback: () => { throw new Error("injected rollback failure"); },
			}));
			expectAggregated(error, "rollback-failed", ["injected lock failure", "injected rollback failure"]);
			expect(await readFile(outfile, "utf8")).toBe(nextSource);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: next, generatedPath: outfile, lockPath })).rejects.toThrow(/does not record the current recipe data/u);
			await expectNoGeneratingFiles(scratch);
			await writeStandardFakeProverbRecipes({ markdown: next, generatedPath: outfile, lockPath });
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: next, generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 2, dataVersion: NEXT });
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("still rolls generated back when lock publication and staging cleanup both fail", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("cleanup");
		try {
			const before = [await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")];
			const error = await caught(async () => writeStandardFakeProverbRecipes({
				markdown: bumped(await standardMarkdown(), NEXT) + EXTRA_PROVERB, generatedPath: outfile, lockPath,
				beforePublish: (phase) => { if (phase === "lock") throw new Error("injected lock failure"); },
				beforeCleanup: (filePath) => { if (filePath.endsWith("standard-recipes.lock.json.generating")) throw new Error("injected cleanup failure"); },
			}));
			expectAggregated(error, "cleanup-failed", ["injected lock failure", "injected cleanup failure"]);
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual(before);
			expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual(["standard-recipes.lock.json.generating"]);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("keeps the rollback rename failure when rollback staging cleanup also fails", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rollback-rename");
		try {
			const error = await caught(async () => writeStandardFakeProverbRecipes({
				markdown: bumped(await standardMarkdown(), NEXT) + EXTRA_PROVERB, generatedPath: outfile, lockPath,
				beforePublish: (phase) => { if (phase === "lock") throw new Error("injected lock failure"); },
				beforeRollbackRename: () => { throw new Error("injected rollback rename failure"); },
				beforeCleanup: (filePath) => { if (filePath === `${outfile}.generating`) throw new Error("injected rollback cleanup failure"); },
			}));
			expect(error).toBeInstanceOf(AggregateError);
			const messages = (error as AggregateError).errors.map((entry) => (entry as Error).message);
			expect((error as AggregateError).message).toContain("(rollback-failed)");
			for (const message of ["injected lock failure", "injected rollback rename failure", "injected rollback cleanup failure"]) expect(messages).toContain(message);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("reports a first-generation removal failure and succeeds after the leftover is removed", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("first-rollback", { copyLock: false });
		try {
			const first = bumped(await standardMarkdown(), 1);
			const error = await caught(() => writeStandardFakeProverbRecipes({
				markdown: first, generatedPath: outfile, lockPath,
				beforePublish: (phase) => { if (phase === "lock") throw new Error("injected lock failure"); },
				beforeRollback: () => { throw new Error("injected rollback failure"); },
			}));
			expectAggregated(error, "rollback-failed", ["injected lock failure", "injected rollback failure"]);
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: first, generatedPath: outfile, lockPath })).rejects.toThrow(/standard-recipes\.lock\.json is missing/u);
			await rm(outfile);
			await writeStandardFakeProverbRecipes({ markdown: first, generatedPath: outfile, lockPath });
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: first, generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 2, dataVersion: 1 });
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
});

describe("the Fake Proverb recipe build guard", () => {
	it("accepts CRLF checkouts of the generated module and lock, and still catches a real edit", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("crlf");
		try {
			const generated = await readFile(outfile, "utf8");
			await writeFile(outfile, generated.replaceAll("\n", "\r\n"));
			await writeFile(lockPath, (await readFile(lockPath, "utf8")).replaceAll("\n", "\r\n"));
			const markdown = (await standardMarkdown()).replaceAll("\n", "\r\n");
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown, generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 2, dataVersion: STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION });
			// A same-version rewrite from a CRLF checkout is a no-op for the lock.
			const lockCrlf = await readFile(lockPath, "utf8");
			await writeStandardFakeProverbRecipes({ markdown, generatedPath: outfile, lockPath });
			expect(await readFile(lockPath, "utf8")).toBe(lockCrlf);
			await writeFile(outfile, generated.replace("topic-object", "topic-object-x").replaceAll("\n", "\r\n"));
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown, generatedPath: outfile, lockPath })).rejects.toThrow(/does not match/u);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("keeps LF in a real core.autocrlf=true checkout because .gitattributes pins it", async () => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-proverb-autocrlf-"));
		const files = [".gitattributes", STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, STANDARD_FAKE_PROVERB_RECIPES_LOCK, STANDARD_FAKE_PROVERB_RECIPES_GENERATED];
		const git = (...args: string[]) => {
			const result = spawnSync("git", ["-c", "core.autocrlf=true", "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: scratch, encoding: "utf8" });
			expect(result.status, result.stderr).toBe(0);
			return result.stdout;
		};
		try {
			for (const relative of files) {
				await mkdir(path.join(scratch, path.dirname(relative)), { recursive: true });
				await copyFile(relative, path.join(scratch, relative));
			}
			// Negative control: the same bytes at a path .gitattributes does not cover.
			await copyFile(STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, path.join(scratch, "control.md"));
			git("init", "--quiet");
			git("add", ".");
			git("commit", "--quiet", "-m", "fixture");
			for (const relative of [...files.slice(1), "control.md"]) await rm(path.join(scratch, relative));
			git("checkout", "--", ".");
			expect(await readFile(path.join(scratch, "control.md"), "utf8")).toContain("\r\n");
			for (const relative of files.slice(1)) {
				expect(git("check-attr", "eol", "--", relative).trim()).toBe(`${relative}: eol: lf`);
				expect(await readFile(path.join(scratch, relative), "utf8")).not.toContain("\r");
			}
			await expect(assertStandardFakeProverbRecipesGenerated({
				markdownPath: path.join(scratch, STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN),
				generatedPath: path.join(scratch, STANDARD_FAKE_PROVERB_RECIPES_GENERATED),
				lockPath: path.join(scratch, STANDARD_FAKE_PROVERB_RECIPES_LOCK),
			})).resolves.toEqual({ schemaVersion: 2, dataVersion: STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION });
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	type StartResult = { errors?: { text: string; detail?: unknown }[] } | null;
	type LoadResult = { contents?: string; loader?: string; watchFiles?: string[] } | null;
	type ResolveArgs = { path: string; kind: string; resolveDir: string };
	function register(rootDir: string, options: { readText?: (filePath: string) => Promise<string> } = {},
		initialOptions: { tsconfig?: string } | undefined = { tsconfig: path.resolve("tsconfig.json") }) {
		const hooks: {
			start: (() => Promise<StartResult>)[];
			load: { filter: RegExp; callback: (args: { path: string }) => Promise<LoadResult> }[];
			resolve: { filter: RegExp; callback: (args: ResolveArgs) => { path: string; watchFiles: string[] } | null }[];
		} = { start: [], load: [], resolve: [] };
		standardFakeProverbRecipesPlugin(rootDir, options).setup({
			initialOptions,
			onStart: (callback) => { hooks.start.push(callback); },
			onLoad: (options, callback) => { hooks.load.push({ filter: options.filter, callback }); },
			onResolve: (options, callback) => { hooks.resolve.push({ filter: options.filter, callback }); },
		});
		return hooks;
	}

	it("re-checks the document on every start and reports a refusal as a build error with its cause", async () => {
		expect(await register(process.cwd()).start[0]!()).toBeNull();
		expect((await register("/nonexistent-semantropy-root").start[0]!())?.errors?.[0]?.text).toMatch(/is missing/u);
		for (const [which, label] of [["generated", STANDARD_FAKE_PROVERB_RECIPES_GENERATED], ["lock", STANDARD_FAKE_PROVERB_RECIPES_LOCK]] as const) {
			const target = path.join(process.cwd(), which === "generated" ? STANDARD_FAKE_PROVERB_RECIPES_GENERATED : STANDARD_FAKE_PROVERB_RECIPES_LOCK);
			const result = await register(process.cwd(), { readText: readTextWithFailures(new Map([[target, injectedFsError("EACCES")]])) }).start[0]!();
			const message = result?.errors?.[0];
			expect(message?.text).toContain(`${label} is unreadable (EACCES)`);
			expect(message?.text).not.toMatch(/is missing/u);
			expect((message?.detail as { cause?: { code?: string } }).cause?.code).toBe("EACCES");
		}
	});

	it("refuses to start without an explicit tsconfig, because a plugin-resolved entry would lose it", async () => {
		const starts: (() => Promise<StartResult>)[] = [];
		// No initialOptions at all.
		standardFakeProverbRecipesPlugin(process.cwd()).setup({ onStart: (callback) => { starts.push(callback); }, onLoad: () => undefined, onResolve: () => undefined });
		expect((await starts[0]!())?.errors?.[0]?.text).toMatch(/requires an explicit `tsconfig` build option/u);
		for (const initialOptions of [{}, { tsconfig: "" }]) {
			const result = await register(process.cwd(), {}, initialOptions).start[0]!();
			expect(result?.errors?.[0]?.text).toMatch(/requires an explicit `tsconfig` build option/u);
		}
	});

	it("is given an explicit tsconfig by the real bundle definition, and fails that build closed without one", async () => {
		const options = bundleOptions(process.cwd(), { outfile: path.resolve("dist", "unused.js"), banner: "", dictionaryDir: undefined, minify: true, sourcemap: false });
		expect(options["tsconfig"]).toBe(path.resolve("tsconfig.json"));
		const { tsconfig: _dropped, ...withoutTsconfig } = options;
		const guard = (options.plugins as Plugin[]).filter((plugin) => plugin.name === "semantropy-standard-fake-proverb-recipes");
		expect(guard).toHaveLength(1);
		const refused = await build({ ...withoutTsconfig, plugins: guard, write: false, logLevel: "silent", external: [...(options["external"] as string[]), "virtual:semantropy-lindera-*"] })
			.then(() => [] as string[], (error: { errors?: { text: string }[] }) => (error.errors ?? []).map((entry) => entry.text));
		expect(refused.join(" ")).toMatch(/requires an explicit `tsconfig` build option/u);
	});

	it("registers watch files while resolving the src/main.ts entry, never by loading it, and loads the generated module itself", async () => {
		const hooks = register(process.cwd());
		expect(hooks.load).toHaveLength(1);
		expect(hooks.resolve).toHaveLength(1);
		for (const hook of [...hooks.load, ...hooks.resolve]) expect(hook.filter.flags).not.toContain("u");
		expect(hooks.load[0]!.filter.test("src/main.ts")).toBe(false);
		const watchFiles = [STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, STANDARD_FAKE_PROVERB_RECIPES_GENERATED, STANDARD_FAKE_PROVERB_RECIPES_LOCK, ...FAKE_PROVERB_RECIPE_VALIDATORS]
			.map((file) => path.resolve(file));
		expect(FAKE_PROVERB_RECIPE_VALIDATORS).toEqual(["src/fakeProverb/compileRecipeSet.ts", "src/fakeProverb/recipeData.ts"]);
		const resolve = hooks.resolve[0]!;
		// The entry resolves to its own absolute path, so loading is left to other plugins or esbuild;
		// esbuild ignores (and warns about) watch files returned without a path.
		const mainEntry = path.resolve("src/main.ts");
		expect(resolve.callback({ path: "src/main.ts", kind: "entry-point", resolveDir: process.cwd() })).toEqual({ path: mainEntry, watchFiles });
		expect(resolve.callback({ path: mainEntry, kind: "entry-point", resolveDir: "/elsewhere" })).toEqual({ path: mainEntry, watchFiles });
		expect(resolve.callback({ path: "./main.ts", kind: "import-statement", resolveDir: path.resolve("src") })).toBeNull();
		expect(resolve.callback({ path: "src/other/main.ts", kind: "entry-point", resolveDir: process.cwd() })).toBeNull();
		const generatedHook = hooks.load[0]!;
		const loaded = await generatedHook.callback({ path: path.resolve(STANDARD_FAKE_PROVERB_RECIPES_GENERATED) });
		expect(loaded).toMatchObject({ loader: "ts", watchFiles });
		expect(loaded?.contents).toBe(await readFile(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "utf8"));
	});
});

async function copyBuildTree(scratch: string): Promise<void> {
	for (const relative of [
		STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, STANDARD_FAKE_PROVERB_RECIPES_LOCK, STANDARD_FAKE_PROVERB_RECIPES_GENERATED, ...FAKE_PROVERB_RECIPE_VALIDATORS,
		STANDARD_COLLISION_PATTERNS_MARKDOWN, STANDARD_COLLISION_PATTERNS_LOCK, STANDARD_COLLISION_PATTERNS_GENERATED,
		"src/collision/compilePatternSet.ts", "src/collision/patternData.ts", "tsconfig.json",
	]) {
		await mkdir(path.join(scratch, path.dirname(relative)), { recursive: true });
		await copyFile(relative, path.join(scratch, relative));
	}
	// An entry with no Fake Proverb import proves the guard does not rely on one.
	await writeFile(path.join(scratch, "src/main.ts"), "export const unrelated = 1;\n");
}

type GuardOrder = "fake-proverb-first" | "collision-first";

/** Watches a copied tree with both guards; each rebuild's errors are delivered to the next awaited event. */
async function watchTree(scratch: string, order: GuardOrder) {
	let deliver: ((errors: readonly string[]) => void) | undefined;
	const guards = [standardFakeProverbRecipesPlugin(scratch) as Plugin, standardCollisionPatternsPlugin(scratch) as Plugin];
	const context = await esbuildContext({ absWorkingDir: scratch, entryPoints: ["src/main.ts"], outfile: "out.js", bundle: true, logLevel: "silent",
		format: "cjs", tsconfig: path.join(scratch, "tsconfig.json"),
		plugins: [...(order === "fake-proverb-first" ? guards : [...guards].reverse()), { name: "record-watch", setup(build) {
			// Warnings are delivered with errors, so every clean build also asserts a warning-free build.
			build.onEnd((result) => { deliver?.([...result.errors.map((entry) => entry.text), ...result.warnings.map((entry) => `warning: ${entry.text}`)]); });
		} }] });
	const event = async (action: () => Promise<unknown>): Promise<readonly string[]> => {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const completed = new Promise<readonly string[]>((resolve, reject) => {
			timeout = setTimeout(() => reject(new Error("watch did not detect the file change")), 15_000);
			deliver = resolve;
		});
		try { await action(); return await completed; } finally { clearTimeout(timeout); deliver = undefined; }
	};
	return { context, event };
}

describe("automatic watch detection, composed with the Collision guard that loads src/main.ts", () => {
	// Regressions: returning watch files without a path made esbuild warn that they do nothing, and
	// resolving the entry without an explicit tsconfig dropped its "use strict" directive.
	it.each(["collision-first", "fake-proverb-first"] as const)("builds without any warning and without changing the output (%s)", async (order) => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-proverb-warning-"));
		try {
			await copyBuildTree(scratch);
			const common = { absWorkingDir: scratch, bundle: true, write: false, format: "cjs", logLevel: "silent" } as const;
			for (const minify of [false, true]) {
				// The pre-slice definition: Collision guard only, tsconfig discovered implicitly.
				const reference = await build({ ...common, minify, entryPoints: ["src/main.ts"], plugins: [standardCollisionPatternsPlugin(scratch) as Plugin] });
				expect(reference.outputFiles[0]!.text).toContain("\"use strict\"");
				const guards = [standardFakeProverbRecipesPlugin(scratch) as Plugin, standardCollisionPatternsPlugin(scratch) as Plugin];
				for (const entryPoints of [["src/main.ts"], [path.join(scratch, "src", "main.ts")]]) {
					const result = await build({ ...common, minify, entryPoints, tsconfig: path.join(scratch, "tsconfig.json"),
						plugins: order === "fake-proverb-first" ? guards : [...guards].reverse() });
					expect(result.errors).toEqual([]);
					expect(result.warnings).toEqual([]);
					expect(result.outputFiles[0]!.text).toBe(reference.outputFiles[0]!.text);
				}
			}
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	const cases = [
		{ label: "a Markdown recipe", file: STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, mutate: (s: string) => once(s, "form: verb-basic 3", "form: verb-basic 4"), error: /does not match/u },
		{ label: "a malformed Markdown line", file: STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, mutate: (s: string) => once(s, "line: {n1}より{n2}\n", "line: {n1}より{n2\n"), error: /invalid-line/u },
		{ label: "the generated module", file: STANDARD_FAKE_PROVERB_RECIPES_GENERATED, mutate: (s: string) => s.replace("Do not edit this file.", "hand-edited"), error: /does not match/u },
		{ label: "a malformed lock", file: STANDARD_FAKE_PROVERB_RECIPES_LOCK, mutate: () => "{}", error: /malformed-lock/u },
		{ label: "the compiler validator", file: "src/fakeProverb/compileRecipeSet.ts", mutate: (s: string) => s.replace("input.schemaVersion !== FAKE_PROVERB_RECIPE_SCHEMA_VERSION", "input.schemaVersion !== -1"), error: /unsupported-schema-version/u },
		{ label: "the schema validator", file: "src/fakeProverb/recipeData.ts", mutate: (s: string) => s.replace('predicate: ["adjective-basic", "verb-basic", "verb-negative"]', 'predicate: ["adjective-basic", "verb-basic"]'), error: /invalid-form/u },
	];
	it.each([
		...cases.map((entry) => ({ ...entry, order: "collision-first" as const })),
		{ ...cases[0]!, order: "fake-proverb-first" as const },
		{ ...cases[4]!, order: "fake-proverb-first" as const },
	])("detects $label edits and recovery without a caller-triggered rebuild ($order)", async ({ file, mutate, error, order }) => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-proverb-watch-"));
		let watched: Awaited<ReturnType<typeof watchTree>> | undefined;
		try {
			await copyBuildTree(scratch);
			watched = await watchTree(scratch, order);
			expect(await watched.event(() => watched!.context.watch())).toEqual([]);
			const output = await readFile(path.join(scratch, "out.js"), "utf8");
			const sourcePath = path.join(scratch, file);
			const source = await readFile(sourcePath, "utf8");
			const changed = mutate(source);
			expect(changed).not.toBe(source);
			expect((await watched.event(() => replaceFile(sourcePath, changed))).join("\n")).toMatch(error);
			expect(await readFile(sourcePath, "utf8")).toBe(changed);
			expect(await watched.event(() => replaceFile(sourcePath, source))).toEqual([]);
			expect(await readFile(path.join(scratch, "out.js"), "utf8")).toBe(output);
		} finally { await watched?.context.dispose(); await rm(scratch, { recursive: true, force: true }); }
	}, 60_000);

	// Regression: a second `onLoad` hook on src/main.ts made esbuild drop one guard's watch files.
	it.each(["collision-first", "fake-proverb-first"] as const)("keeps the Collision guard's own watch inputs live (%s)", async (order) => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-proverb-collision-watch-"));
		let watched: Awaited<ReturnType<typeof watchTree>> | undefined;
		try {
			await copyBuildTree(scratch);
			watched = await watchTree(scratch, order);
			expect(await watched.event(() => watched!.context.watch())).toEqual([]);
			for (const relative of [STANDARD_COLLISION_PATTERNS_MARKDOWN, "src/collision/patternData.ts"]) {
				const file = path.join(scratch, relative);
				const source = await readFile(file, "utf8");
				const changed = relative.endsWith(".md") ? source.replace("label: Standard", "label: Watch") : source.replace("COLLISION_PATTERN_SCHEMA_VERSION = 2", "COLLISION_PATTERN_SCHEMA_VERSION = 3");
				expect(changed).not.toBe(source);
				expect((await watched.event(() => replaceFile(file, changed))).join("\n")).toMatch(/standardCollisionPatternEntries|unsupported-schema-version/u);
				expect(await watched.event(() => replaceFile(file, source))).toEqual([]);
			}
		} finally { await watched?.context.dispose(); await rm(scratch, { recursive: true, force: true }); }
	}, 60_000);
});

describe("the Fake Proverb recipe source stays out of the plugin", () => {
	// Production-disconnected through COLLECT1. FAKE-PROVERB-VIEW1 connects the typed generated entries and the
	// runtime modules only; the Markdown document, parser, generator, lock and canonical payload stay build-time.
	it("connects only the typed recipes to production, never the document, the parser, the lock or the payload", async () => {
		for (const entryPoint of ["src/main.ts", "src/SemantropyPlugin.ts"]) {
			const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
				external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
			const inputs = Object.keys(result.metafile.inputs);
			expect(inputs.filter((name) => /fakeProverb|fake-proverb/iu.test(name)).sort()).toEqual([
				"src/fakeProverb/compileRecipeSet.ts", "src/fakeProverb/fakeProverbAuthority.ts", "src/fakeProverb/fakeProverbBatch.ts",
				"src/fakeProverb/fakeProverbCore.ts", "src/fakeProverb/fakeProverbText.ts", "src/fakeProverb/fakeProverbVersions.ts",
				STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "src/fakeProverb/recipeData.ts", "src/view/FakeProverbModal.ts", "src/view/FakeProverbSession.ts",
			].sort());
			for (const name of inputs) expect(name).not.toMatch(/scripts\/|resources\/|\.md$|\.json$/u);
			const code = result.outputFiles[0]!.text;
			expect(code).not.toMatch(/standard-recipes|generate:fake-proverb-recipes|STANDARD_FAKE_PROVERB_RECIPE_DATA_JSON|STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST|1d329f91ba002ac0|"proverbs\\":/u);
			// The typed recipes and literals are runtime data now: a recipe id and a literal's id, which no source file spells.
			expect(code).toContain("misplaced-purpose");
			expect(code).toContain(fakeProverbLiteralId("ことのたとえ。"));
		}
	});

	it("gives the compiler a closed, pure graph", async () => {
		for (const [entry, expected] of [
			["src/fakeProverb/compileRecipeSet.ts", ["src/fakeProverb/compileRecipeSet.ts", "src/fakeProverb/recipeData.ts"]],
			["src/fakeProverb/recipeData.ts", ["src/fakeProverb/recipeData.ts"]],
			[STANDARD_FAKE_PROVERB_RECIPES_GENERATED, [STANDARD_FAKE_PROVERB_RECIPES_GENERATED]],
		] as const) {
			const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm", legalComments: "none" });
			expect(Object.keys(result.metafile.inputs).sort()).toEqual([...expected].sort());
			expect(result.outputFiles[0]!.text).not.toMatch(/Math\.random|Date\.now|new Date|crypto|fetch\(|document\.|window\.|node:fs|readFile|console\.|eval\(|new Function|new RegExp/u);
		}
	});

	// TEMPLATES1 added the recipe modules; CORE1 added the authority, core and versions leaf, which own algorithm 1.
	it("is imported by no other production module, keeps the recipe modules version-free and adds no Collect metadata version", async () => {
		const names = (await readdir("src", { recursive: true })).map((name) => `src/${name.replaceAll("\\", "/")}`).filter((name) => name.endsWith(".ts"));
		const recipeModules = ["src/fakeProverb/compileRecipeSet.ts", STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "src/fakeProverb/recipeData.ts"];
		expect(names.filter((name) => name.startsWith("src/fakeProverb/")).sort()).toEqual([
			...recipeModules, "src/fakeProverb/fakeProverbAuthority.ts", "src/fakeProverb/fakeProverbBatch.ts", "src/fakeProverb/fakeProverbCore.ts",
			"src/fakeProverb/fakeProverbText.ts", "src/fakeProverb/fakeProverbVersions.ts",
		].sort());
		for (const name of recipeModules) expect(await readFile(name, "utf8"), name).not.toMatch(/ALGORITHM_VERSION|algorithmVersion/u);
		// COLLECT1: the Collect metadata 4 contract owns the fake-proverb type. FAKE-PROVERB-VIEW1: the View-owned
		// session and Modal, the View that opens them and the Toolbar entry are the only other mentions.
		const mentions: string[] = [];
		for (const name of names.filter((entry) => !entry.startsWith("src/fakeProverb/") && !entry.startsWith("src/collect/v4/"))) {
			if (/fakeProverb|FAKE_PROVERB|fake-proverb/u.test(await readFile(name, "utf8"))) mentions.push(name);
		}
		// LOCALE1: the interface catalog holds the Fake proverb words (and nothing about recipes or versions).
		expect(mentions.sort()).toEqual(["src/i18n/attributionLabels.ts", "src/i18n/catalog.ts", "src/i18n/messages.ts", "src/view/FakeProverbModal.ts", "src/view/FakeProverbSession.ts", "src/view/SemantropyToolbar.ts", "src/view/SemantropyView.ts"]);
		const fakeProverbSources = await Promise.all(names.filter((name) => name.startsWith("src/fakeProverb/")).map((name) => readFile(name, "utf8")));
		for (const source of fakeProverbSources) expect(source).not.toMatch(/metadataVersion/u);
		expect(fakeProverbSources.filter((source) => /FAKE_PROVERB_ALGORITHM_VERSION = /u.test(source))).toHaveLength(1);
	});

	it("pins LF for the document, lock and generated module, and copies both inputs into the history-free check", async () => {
		const attributes = await readFile(".gitattributes", "utf8");
		expect(attributes).toMatch(/resources\/fake-proverb\/standard-recipes\.md\s+text eol=lf/u);
		expect(attributes).toMatch(/resources\/fake-proverb\/standard-recipes\.lock\.json\s+text eol=lf/u);
		expect(attributes).toMatch(/src\/fakeProverb\/generated\/\*\.ts\s+text eol=lf/u);
		const historyFree = await readFile("scripts/verifyHistoryFree.mjs", "utf8");
		expect(historyFree).toContain("STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN");
		expect(historyFree).toContain("STANDARD_FAKE_PROVERB_RECIPES_LOCK");
		const scripts = (JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
		expect(scripts["generate:fake-proverb-recipes"]).toBe("node scripts/fakeProverb/generate.mjs");
	});
});
