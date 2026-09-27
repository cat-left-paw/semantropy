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

type RecipeLock = { versions: { dataVersion: number; digest: string }[] };
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

const BASELINE = readPinnedFixture<ParsedFakeProverbRecipeDocument & { origin: string }>(
	"fakeProverbRecipes",
	"0072d166810daa83102872b2c37b198f4cd470f481a74fee3eec726cfa735106",
);
const V1_DIGEST = "1d329f91ba002ac0bb70ac5df3b036efa9730107b4b01ea0e8a2b3da7b0b1af1";
const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const GENERATE_PATTERN = new RegExp(escapeRegExp(GENERATE_COMMAND), "u");

function dataOf(value: ParsedFakeProverbRecipeDocument): ParsedFakeProverbRecipeDocument {
	return { schemaVersion: value.schemaVersion, dataVersion: value.dataVersion, proverbs: value.proverbs, glosses: value.glosses, literals: value.literals, profiles: value.profiles };
}
const standardMarkdown = async (): Promise<string> => await readFile(STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, "utf8");
/** A same-kind semantic edit: one more proverb that pairs with the existing glosses. */
const EXTRA_PROVERB = "\n## proverb extra-pair\nenabled: true\nweight: 3\npart: noun n1 plain-noun export\npart: literal to\npart: noun n2 plain-noun export\n";
const bumped = (source: string, version: number): string => source.replace("data-version: 1", `data-version: ${version}`);

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
		schemaVersion: 1,
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

function renderPart(part: RawFakeProverbPart): string {
	if (part.kind === "literal") return `part: literal ${part.literalId}`;
	if (part.kind === "reference") return `part: reference ${part.slotKind} ${part.slotId}`;
	return `part: ${part.kind} ${part.slotId} ${part.profileId}${part.exported === true ? " export" : ""}`;
}

function render(input: CompileFakeProverbRecipeSetInput): string {
	const lines = ["# Test recipes", "", `schema-version: ${input.schemaVersion}`, `data-version: ${input.dataVersion}`, ""];
	for (const entry of input.proverbs) {
		lines.push(`## proverb ${entry.id}`, `enabled: ${String(entry.enabled)}`, `weight: ${entry.weight}`, ...entry.parts.map(renderPart), "");
	}
	for (const entry of input.glosses) {
		lines.push(`## gloss ${entry.id}`, `enabled: ${String(entry.enabled)}`, `weight: ${entry.weight}`,
			...entry.requires.map((required) => `requires: ${required.kind} ${required.slotId}`), ...entry.parts.map(renderPart), "");
	}
	for (const entry of input.literals) lines.push(`## literal ${entry.id}`, "", entry.literal, "");
	for (const entry of input.profiles) {
		lines.push(`## profile ${entry.id}`, `kind: ${entry.kind}`, ...entry.forms.map((form) => `form: ${form.form} ${form.weight}`), "");
	}
	return lines.join("\n");
}

function compileCodes(input: unknown): readonly string[] {
	const result = compileFakeProverbRecipeSet(input as CompileFakeProverbRecipeSetInput);
	return result.ok ? [] : result.issues.map((entry) => entry.code);
}

function markdownCodes(source: string): readonly string[] {
	const parsed = parseStandardFakeProverbRecipeMarkdown(source);
	return parsed.ok ? [] : parsed.issues.map((entry) => entry.code);
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
	it("parses to the pinned version 1 data, whose digest the lock records", async () => {
		const parsed = parseStandardFakeProverbRecipeMarkdown(await standardMarkdown());
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const data = dataOf(parsed);
		const pinned = dataOf(BASELINE);
		expect(data).toEqual(pinned);
		expect([data.proverbs.length, data.glosses.length, data.literals.length, data.profiles.length]).toEqual([9, 6, 25, 6]);
		expect(fakeProverbRecipeDataDigest(data)).toBe(V1_DIGEST);
		expect(JSON.parse(await readFile(STANDARD_FAKE_PROVERB_RECIPES_LOCK, "utf8"))).toEqual({ versions: [{ dataVersion: 1, digest: V1_DIGEST }] });
		expect([STANDARD_FAKE_PROVERB_RECIPE_SCHEMA_VERSION, STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION, STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST])
			.toEqual([1, 1, V1_DIGEST]);
		expect([STANDARD_FAKE_PROVERB_PROVERBS, STANDARD_FAKE_PROVERB_GLOSSES, STANDARD_FAKE_PROVERB_LITERALS, STANDARD_FAKE_PROVERB_PROFILES])
			.toEqual([pinned.proverbs, pinned.glosses, pinned.literals, pinned.profiles]);
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

	it("pairs every enabled proverb with at least one gloss, by typed signature alone", async () => {
		const { compiled } = await generateStandardFakeProverbRecipes({ rootDir: process.cwd() });
		const matrix = Object.fromEntries(compiled.proverbs.map((proverb) => [proverb.id,
			compiled.glosses.filter((gloss) => isFakeProverbGlossCompatible(proverb, gloss)).map((gloss) => gloss.id)]));
		const common = ["misplaced-purpose", "eventual-sameness", "powerless-before", "mistaken-belief"];
		const withPredicate = ["misplaced-purpose", "eventual-sameness", "even-so", "powerless-before", "mistaken-belief"];
		expect(matrix).toEqual({
			"topic-object": withPredicate, "genitive-destination": withPredicate, "rather-than": common, "offered-to": common,
			"modified-topic": withPredicate, "born-of": common, pursuer: withPredicate,
			"ear-prayer": ["misplaced-purpose", "eventual-sameness", "only-measure", "powerless-before", "mistaken-belief"], "origin-of": common,
		});
		// genitive-destination declares n3 without exporting it, so only-measure cannot pair with it.
		expect(compiled.proverbs.find((entry) => entry.id === "genitive-destination")!.exports.map((entry) => entry.slotId)).toEqual(["n1", "n2", "v1"]);
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
		["a proverb part", (s: string) => s.replace("part: literal yori\n", "part: literal yori\npart: modifier m1 plain-modifier\n")],
		["an export", (s: string) => s.replace("part: noun n3 plain-noun\n", "part: noun n3 plain-noun export\n")],
		["a requirement", (s: string) => s.replace("requires: noun n2\npart: literal dorehodo-no", "requires: noun n1\npart: literal dorehodo-no").replace("part: reference noun n2\npart: literal mo-comma", "part: reference noun n1\npart: literal mo-comma")],
		["a literal body", (s: string) => s.replace("\nのもと\n", "\nのはじまり\n")],
		["a recipe weight", (s: string) => s.replace("weight: 10\npart: noun n1 plain-noun export\npart: literal yori", "weight: 11\npart: noun n1 plain-noun export\npart: literal yori")],
		["a form weight", (s: string) => s.replace("form: adjective-basic 3", "form: adjective-basic 4")],
		["a disabled gloss", (s: string) => s.replace("## gloss only-measure\nenabled: true", "## gloss only-measure\nenabled: false")],
		["an added proverb", (s: string) => s + EXTRA_PROVERB],
	] as const)("changes the digest for %s, and a raised data-version generates and passes the guard", async (_name, mutate) => {
		const edited = bumped(mutate(await standardMarkdown()), 2);
		const parsed = parseStandardFakeProverbRecipeMarkdown(edited);
		expect(parsed.ok, parsed.ok ? "" : describeFakeProverbSourceIssues(parsed.issues)).toBe(true);
		if (!parsed.ok) return;
		expect(fakeProverbRecipeDataDigest(parsed)).not.toBe(V1_DIGEST);
		const { scratch, outfile, lockPath } = await isolatedWritePaths("markdown-edit");
		try {
			await writeStandardFakeProverbRecipes({ markdown: edited, generatedPath: outfile, lockPath });
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: edited, generatedPath: outfile, lockPath }))
				.resolves.toEqual({ schemaVersion: 1, dataVersion: 2 });
			const lock = JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock;
			expect(lock.versions).toEqual([{ dataVersion: 1, digest: V1_DIGEST }, { dataVersion: 2, digest: fakeProverbRecipeDataDigest(parsed) }]);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
});

describe("the Fake Proverb recipe compiler", () => {
	it("accepts the small reference set in both paths and deep-freezes fresh data", () => {
		const input = baseInput();
		const result = compileFakeProverbRecipeSet(input);
		expect(result.ok).toBe(true);
		expect(parseStandardFakeProverbRecipeMarkdown(render(input)).ok).toBe(true);
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
		expect(markdownCodes(render(input))).toEqual([]);
	});

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
		["a proverb without a noun slot", withProverb((p) => { p.parts = [slot("predicate", "v1", "pred-p", true)]; }), "missing-noun"],
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
		["an unsupported schema version", (() => { const input = baseInput(); input.schemaVersion = 2; return input; })(), "unsupported-schema-version"],
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
	it.each(failures)("refuses %s in both the compiler and the parser", (_name, input, code) => {
		expect(compileCodes(input)).toContain(code);
		expect(markdownCodes(render(input))).toContain(code);
	});

	it("names an unexported requirement and an unpaired gloss precisely", () => {
		const unexported = withProverb((p) => { p.parts[4] = slot("predicate", "v1", "pred-p", false); });
		expect(compileCodes(unexported)).toContain("unexported-reference");
		expect(markdownCodes(render(unexported))).toContain("unexported-reference");
		// Two proverbs each export one of the two requirements; neither exports both.
		const split = baseInput();
		split.proverbs = [
			{ id: "p-a", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true)] },
			{ id: "p-b", enabled: true, weight: 1, parts: [slot("noun", "n2", "noun-p", true), literal("wa"), literal("wo"), slot("predicate", "v1", "pred-p", true)] },
		];
		split.glosses = [
			{ ...split.glosses[0]!, id: "g-both", requires: [{ kind: "noun", slotId: "n1" }, { kind: "predicate", slotId: "v1" }] },
			{ id: "g-a", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n1" }], parts: [reference("noun", "n1"), literal("tatoe")] },
			{ id: "g-b", enabled: true, weight: 1, requires: [{ kind: "noun", slotId: "n2" }], parts: [reference("noun", "n2"), literal("tatoe")] },
		];
		expect(compileCodes(split)).toEqual(["unpaired-gloss"]);
		expect(markdownCodes(render(split))).toEqual(["unpaired-gloss"]);
		// Disabled entries are validated but never paired.
		split.glosses[0] = { ...split.glosses[0]!, enabled: false };
		expect(compileCodes(split)).toEqual([]);
	});

	it("pairs by kind as well as slot ID, never by an ID match alone", () => {
		// p-two exports v1 as a noun; the gloss requires v1 as a predicate, which only p-one exports.
		const input = baseInput();
		input.proverbs.push({ id: "p-two", enabled: true, weight: 1, parts: [slot("noun", "n1", "noun-p", true), literal("wa"), slot("noun", "v1", "noun-p", true)] });
		expect(compileCodes(input)).toEqual(["unpaired-proverb"]);
		expect(markdownCodes(render(input))).toEqual(["unpaired-proverb"]);
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
		expect(parseStandardFakeProverbRecipeMarkdown(render(input)).ok).toBe(false);
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
		expect(markdownCodes(render(input))).toEqual([]);
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

describe("the Fake Proverb recipe line syntax", () => {
	const valid = render(baseInput());
	it.each([
		["requires after a part", valid.replace("requires: predicate v1\n", "").replace("part: literal tatoe", "part: literal tatoe\nrequires: predicate v1"), "requires-after-part"],
		["a field after a part", valid.replace("weight: 1\nrequires:", "requires:").replace("part: literal tatoe", "part: literal tatoe\nweight: 1"), "misplaced-field"],
		["a field after requires", valid.replace("weight: 1\nrequires: noun n1", "requires: noun n1\nweight: 1"), "misplaced-field"],
		["requires in a proverb", valid.replace("weight: 2\n", "weight: 2\nrequires: noun n1\n"), "unknown-field"],
		["an unknown field", valid.replace("weight: 2\n", "weight: 2\nlabel: Test\n"), "unknown-field"],
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
		["a slot with an unknown trailing word", valid.replace("part: noun n1 noun-p export", "part: noun n1 noun-p exported"), "invalid-part"],
		["a slot without a profile", valid.replace("part: noun n1 noun-p export", "part: noun n1"), "invalid-part"],
		["a slot with double spaces", valid.replace("part: noun n1 noun-p export", "part: noun  n1 noun-p export"), "invalid-part"],
		["a literal part with an inline body", valid.replace("part: literal wa\npart: noun n2", "part: literal wa \"は\"\npart: noun n2"), "invalid-part"],
		["a reference without a kind", valid.replace("part: reference noun n1", "part: reference n1"), "invalid-part"],
		["an unknown part kind", valid.replace("part: literal tatoe", "part: adverb a1 noun-p"), "unknown-part-kind"],
		["a conditional part", valid.replace("part: literal tatoe", "part: if n1 literal tatoe"), "unknown-part-kind"],
		["a malformed requirement", valid.replace("requires: noun n1", "requires: noun n1 optional"), "invalid-requires"],
		["an unknown entry kind", valid.replace("## literal wa", "## template wa"), "unknown-entry-kind"],
		["an unknown heading", valid.replace("## literal wa", "### literal wa"), "unknown-heading"],
		["a second title", `${valid}\n# Another title\n`, "unexpected-title"],
		["orphan content", valid.replace("schema-version: 1", "schema-version: 1\nhello"), "orphan-content"],
		["an unknown metadata key", valid.replace("schema-version: 1", "schema-version: 1\nalgorithm-version: 1"), "unknown-metadata"],
		["a duplicate metadata key", valid.replace("data-version: 1", "data-version: 1\ndata-version: 1"), "duplicate-metadata"],
		["a missing data version", valid.replace("data-version: 1\n", ""), "missing-metadata"],
		["a non-integer data version", valid.replace("data-version: 1", "data-version: v1"), "invalid-metadata"],
		["a missing literal body", valid.replace("\nは\n", "\n"), "missing-body"],
		["a literal body with padding", valid.replace("\nは\n", "\n は\n"), "body-whitespace"],
		["a second literal body", valid.replace("\nは\n", "\nは\nが\n"), "duplicate-body"],
		["a body under a recipe", valid.replace("part: literal tatoe\n", "part: literal tatoe\n\nことわざ\n"), "unexpected-body"],
		["a blank line inside recipe fields", valid.replace("weight: 2\n", "weight: 2\n\n"), "unexpected-body"],
		["a stale schema version", valid.replace("schema-version: 1", "schema-version: 2"), "unsupported-schema-version"],
	] as const)("refuses %s", (_name, source, code) => {
		expect(source).not.toBe(valid);
		expect(markdownCodes(source)).toContain(code);
	});

	it("reports every problem in document order with line numbers, without leaking a path", () => {
		const source = valid.replace("weight: 2", "weight: 0").replace("part: literal tatoe", "part: literal missing").replace("form: verb-past 1", "form: verb-past x");
		const parsed = parseStandardFakeProverbRecipeMarkdown(source);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		const lines = parsed.issues.map((entry) => entry.line);
		expect(lines).toEqual([...lines].sort((a, b) => a - b));
		expect(parsed.issues.map((entry) => entry.code)).toEqual(["invalid-weight", "invalid-weight"]);
		expect(describeFakeProverbSourceIssues(parsed.issues)).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//u);
		// Line syntax first; once it passes, compiler issues are mapped back to entry lines.
		const semantic = parseStandardFakeProverbRecipeMarkdown(valid.replace("weight: 2", "weight: 3").replace("part: literal tatoe", "part: literal missing"));
		expect(semantic.ok ? [] : semantic.issues.map((entry) => [entry.code, entry.line])).toEqual([["dangling-literal", valid.split("\n").indexOf("## gloss g-one") + 1], ["unused-literal", valid.split("\n").indexOf("## literal tatoe") + 1]]);
	});

	it("has no inline executable data: regex, JavaScript or placeholders in a body are refused", () => {
		for (const body of ["/(は|が)/u", "function(){}", "{{noun}}", "${n1}", "[a-z]+", "<script>"]) {
			expect(parseStandardFakeProverbRecipeMarkdown(valid.replace("\nことのたとえ。\n", `\n${body}\n`)).ok).toBe(false);
		}
	});
});

describe("the generated Fake Proverb recipe module", () => {
	it("is exactly what the document implies, and the guard accepts the checkout", async () => {
		const { source } = await generateStandardFakeProverbRecipes({ rootDir: process.cwd() });
		expect(await readFile(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "utf8")).toBe(source);
		await expect(assertStandardFakeProverbRecipesGenerated({ rootDir: process.cwd() })).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
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
		expect(FAKE_PROVERB_RECIPE_SCHEMA_VERSION).toBe(1);
	});
});

describe("Fake Proverb recipe generation, lock and publication", () => {
	it("allows first generation only at data-version 1 when both destinations are absent", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("first", { copyLock: false });
		try {
			const written = await writeStandardFakeProverbRecipes({ generatedPath: outfile, lockPath });
			expect(written).toEqual({ outfile: STANDARD_FAKE_PROVERB_RECIPES_GENERATED, schemaVersion: 1, dataVersion: 1, proverbs: 9, glosses: 6, literals: 25, profiles: 6 });
			expect(await readFile(outfile, "utf8")).toBe(await readFile(STANDARD_FAKE_PROVERB_RECIPES_GENERATED, "utf8"));
			expect(await readFile(lockPath, "utf8")).toBe(await readFile(STANDARD_FAKE_PROVERB_RECIPES_LOCK, "utf8"));
			expect((await readdir(scratch)).sort()).toEqual(["standard-recipes.lock.json", "standardFakeProverbRecipeEntries.ts"]);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each([
		["first generation at version 2", { copyLock: false }, 2],
		["a skipped version after 1", { copyLock: true }, 3],
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
		["a literal", (s: string) => s.replace("\nのもと\n", "\nのはじまり\n")],
		["a weight", (s: string) => s.replace("form: verb-basic 3", "form: verb-basic 4")],
		["an export flag", (s: string) => s.replace("part: noun n3 plain-noun\n", "part: noun n3 plain-noun export\n")],
		["part order", (s: string) => s.replace("part: literal wa\npart: noun n2 plain-noun export\npart: literal no-moto", "part: literal no-moto\npart: noun n2 plain-noun export\npart: literal wa")],
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
			await writeStandardFakeProverbRecipes({ markdown: bumped(edited, 2), generatedPath: outfile, lockPath });
			const after = JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock;
			expect(after.versions[0]).toEqual({ dataVersion: 1, digest: V1_DIGEST });
			expect(after.versions.map((entry) => entry.dataVersion)).toEqual([1, 2]);
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
			await expect(assertStandardFakeProverbRecipesGenerated({ generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
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
			const next = bumped(await standardMarkdown(), 2) + EXTRA_PROVERB;
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
			const markdown = bumped(await standardMarkdown(), 2) + EXTRA_PROVERB;
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
				markdown: bumped(await standardMarkdown(), 2) + EXTRA_PROVERB, generatedPath: outfile, lockPath,
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
				generatedPath: outfile, lockPath,
				beforePublish: (current) => { if (current === phase) throw new Error(`injected ${phase} failure`); },
			})).rejects.toThrow(`injected ${phase} failure`);
			expect(await readdir(scratch)).toEqual([]);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("reports a rollback failure, keeps the previous lock, and is repaired by the next generate", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rollback");
		try {
			const lockBefore = await readFile(lockPath, "utf8");
			const next = bumped(await standardMarkdown(), 2) + EXTRA_PROVERB;
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
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown: next, generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 1, dataVersion: 2 });
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("still rolls generated back when lock publication and staging cleanup both fail", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("cleanup");
		try {
			const before = [await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")];
			const error = await caught(async () => writeStandardFakeProverbRecipes({
				markdown: bumped(await standardMarkdown(), 2) + EXTRA_PROVERB, generatedPath: outfile, lockPath,
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
				markdown: bumped(await standardMarkdown(), 2) + EXTRA_PROVERB, generatedPath: outfile, lockPath,
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
			const error = await caught(() => writeStandardFakeProverbRecipes({
				generatedPath: outfile, lockPath,
				beforePublish: (phase) => { if (phase === "lock") throw new Error("injected lock failure"); },
				beforeRollback: () => { throw new Error("injected rollback failure"); },
			}));
			expectAggregated(error, "rollback-failed", ["injected lock failure", "injected rollback failure"]);
			await expect(assertStandardFakeProverbRecipesGenerated({ generatedPath: outfile, lockPath })).rejects.toThrow(/standard-recipes\.lock\.json is missing/u);
			await rm(outfile);
			await writeStandardFakeProverbRecipes({ generatedPath: outfile, lockPath });
			await expect(assertStandardFakeProverbRecipesGenerated({ generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
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
			await expect(assertStandardFakeProverbRecipesGenerated({ markdown, generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
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
			})).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
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
		{ label: "a Markdown recipe", file: STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, mutate: (s: string) => s.replace("form: verb-basic 3", "form: verb-basic 4"), error: /does not match/u },
		{ label: "a malformed Markdown line", file: STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, mutate: (s: string) => s.replace("part: literal yori", "part: literal yori extra"), error: /invalid-part/u },
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
			expect((await watched.event(() => writeFile(sourcePath, changed))).join("\n")).toMatch(error);
			expect(await readFile(sourcePath, "utf8")).toBe(changed);
			expect(await watched.event(() => writeFile(sourcePath, source))).toEqual([]);
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
				expect((await watched.event(() => writeFile(file, changed))).join("\n")).toMatch(/standardCollisionPatternEntries|unsupported-schema-version/u);
				expect(await watched.event(() => writeFile(file, source))).toEqual([]);
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
			// The typed recipes and literals are runtime data now.
			expect(code).toContain("koto-no-tatoe");
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
