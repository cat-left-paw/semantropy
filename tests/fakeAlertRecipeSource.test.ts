import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, context as esbuildContext, type Plugin } from "esbuild";
import { describe, expect, it } from "vitest";
import {
	FAKE_ALERT_GUARD_NAME,
	FAKE_ALERT_RECIPE_VALIDATORS,
	GENERATE_COMMAND,
	STANDARD_FAKE_ALERT_RECIPES_GENERATED,
	STANDARD_FAKE_ALERT_RECIPES_LOCK,
	STANDARD_FAKE_ALERT_RECIPES_MARKDOWN,
	assertStandardFakeAlertRecipesGenerated,
	describeFakeAlertSourceIssues,
	fakeAlertRecipeDataDigest,
	generateStandardFakeAlertRecipes,
	packFakeAlertRecipeSet,
	parseStandardFakeAlertRecipeMarkdown,
	renderGeneratedFakeAlertRecipeModule,
	standardFakeAlertRecipesPlugin,
	writeStandardFakeAlertRecipes,
	type FakeAlertRecipeGuardBuild,
	type ParsedFakeAlertRecipeDocument,
} from "../scripts/fakeAlert/standardRecipes.mjs";
import {
	STANDARD_COLLISION_PATTERNS_GENERATED,
	STANDARD_COLLISION_PATTERNS_LOCK,
	STANDARD_COLLISION_PATTERNS_MARKDOWN,
	standardCollisionPatternsPlugin,
} from "../scripts/collision/standardPatterns.mjs";
import {
	FAKE_PROVERB_RECIPE_VALIDATORS,
	STANDARD_FAKE_PROVERB_RECIPES_GENERATED,
	STANDARD_FAKE_PROVERB_RECIPES_LOCK,
	STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN,
	standardFakeProverbRecipesPlugin,
} from "../scripts/fakeProverb/standardRecipes.mjs";
import { bundleOptions } from "../scripts/buildDistribution.mjs";
import { FAKE_ALERT_VIEW1_ADDED } from "./support/experienceVocabularyGraph";
import { FAKE_ALERT_RECIPE_SCHEMA_VERSION } from "../src/fakeAlert/recipeData";
import { unpackFakeAlertRecipeSet, type FakeAlertRecipe, type FakeAlertRecipeSet } from "../src/fakeAlert/recipeSet";
import {
	STANDARD_FAKE_ALERT_PACKED_RECIPES,
	STANDARD_FAKE_ALERT_RECIPE_DATA_DIGEST,
	STANDARD_FAKE_ALERT_RECIPE_DATA_JSON,
	STANDARD_FAKE_ALERT_RECIPE_DATA_VERSION,
	STANDARD_FAKE_ALERT_RECIPE_SCHEMA_VERSION,
} from "../src/fakeAlert/generated/standardFakeAlertRecipes";

import { baseInput, compiled, edited, recipe, render } from "./fakeAlertRecipeFixtures";
import { replaceFile } from "./support/replaceFile";

type RecipeLock = { versions: { dataVersion: number; digest: string }[] };

function markdownCodes(source: string): readonly string[] {
	const parsed = parseStandardFakeAlertRecipeMarkdown(source);
	return parsed.ok ? [] : parsed.issues.map((entry) => entry.code);
}

/** The digest of the first approved data, FAKE-ALERT-TEMPLATES1. The lock keeps it as version 1 for good. */
const V1_DIGEST = "9b4134012bc4b3b88fcb741871703d3033f22ddab5ff83eda7f719e1944b9e2b";
const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const GENERATE_PATTERN = new RegExp(escapeRegExp(GENERATE_COMMAND), "u");
const standardMarkdown = async (): Promise<string> => await readFile(STANDARD_FAKE_ALERT_RECIPES_MARKDOWN, "utf8");
const bumped = (source: string, version: number): string => source.replace(/^data-version: \d+$/mu, `data-version: ${version}`);
const EXTRA_OUTCOME = "\n## outcome extra-done\nfamily: done\nenabled: true\nkind: success\nweight: 3\nline: {n1}を終了しました。\n";

function standardSet(): FakeAlertRecipeSet {
	return unpackFakeAlertRecipeSet(STANDARD_FAKE_ALERT_PACKED_RECIPES);
}
/** A recipe as its authored lines: slots back in braces. */
function text(recipe: FakeAlertRecipe): string[] {
	return recipe.lines.map((line) => line.map((segment) => (typeof segment === "string" ? segment : `{${segment.token}}`)).join(""));
}

// ---------------------------------------------------------------------------
// Scratch-directory helpers for generator tests. The checkout is never edited.

async function isolatedWritePaths(label: string, options: { copyLock?: boolean } = {}): Promise<{ scratch: string; outfile: string; lockPath: string }> {
	const scratch = await mkdtemp(path.join(tmpdir(), `semantropy-fake-alert-${label}-`));
	const outfile = path.join(scratch, "standardFakeAlertRecipes.ts");
	const lockPath = path.join(scratch, "standard-recipes.lock.json");
	if (options.copyLock !== false) {
		await copyFile(STANDARD_FAKE_ALERT_RECIPES_LOCK, lockPath);
		await copyFile(STANDARD_FAKE_ALERT_RECIPES_GENERATED, outfile);
	}
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

async function caught(action: () => Promise<unknown>): Promise<unknown> {
	try {
		await action();
	} catch (error) {
		return error;
	}
	throw new Error("expected a failure");
}

// ===========================================================================

describe("the standard Fake Alert recipe document", () => {
	it("parses, compiles, and is the data the generated module and the lock record", async () => {
		const parsed = parseStandardFakeAlertRecipeMarkdown(await standardMarkdown());
		if (!parsed.ok) throw new Error(describeFakeAlertSourceIssues(parsed.issues));
		expect(parsed.schemaVersion).toBe(FAKE_ALERT_RECIPE_SCHEMA_VERSION);
		expect(STANDARD_FAKE_ALERT_RECIPE_SCHEMA_VERSION).toBe(parsed.schemaVersion);
		expect(STANDARD_FAKE_ALERT_RECIPE_DATA_VERSION).toBe(parsed.dataVersion);
		expect(fakeAlertRecipeDataDigest(parsed)).toBe(STANDARD_FAKE_ALERT_RECIPE_DATA_DIGEST);
		const lock = JSON.parse(await readFile(STANDARD_FAKE_ALERT_RECIPES_LOCK, "utf8")) as RecipeLock;
		expect(lock.versions[0]).toEqual({ dataVersion: 1, digest: V1_DIGEST });
		expect(lock.versions.at(-1)).toEqual({ dataVersion: parsed.dataVersion, digest: STANDARD_FAKE_ALERT_RECIPE_DATA_DIGEST });
		expect(lock.versions.map((entry) => entry.dataVersion)).toEqual(lock.versions.map((_entry, index) => index + 1));
	});

	it("is restored from the generated compact data to exactly what the compiler produces from the document", async () => {
		const { compiled: fromDocument, packed } = await generateStandardFakeAlertRecipes();
		const restored = standardSet();
		expect(restored).toEqual(fromDocument);
		expect(STANDARD_FAKE_ALERT_PACKED_RECIPES).toEqual(packed);
		expect(Object.isFrozen(restored) && Object.isFrozen(restored.families[0]) && Object.isFrozen(restored.outcomes[0]!.lines[0])).toBe(true);
		// The payload is the document's entries as written, and never the version authority.
		const payload = JSON.parse(STANDARD_FAKE_ALERT_RECIPE_DATA_JSON) as ParsedFakeAlertRecipeDocument;
		expect(compiled(payload)).toEqual(fromDocument);
	});

	it("is read the same way with LF, CRLF, CR and a byte-order mark", async () => {
		const source = await standardMarkdown();
		const reference = parseStandardFakeAlertRecipeMarkdown(source);
		for (const variant of [source.replaceAll("\n", "\r\n"), source.replaceAll("\n", "\r"), `\uFEFF${source}`]) {
			expect(parseStandardFakeAlertRecipeMarkdown(variant)).toEqual(reference);
		}
	});

	it("has the families the policy names, with the drift that keeps level 0 plain", () => {
		const families = new Map(standardSet().families.map((entry) => [entry.id, entry]));
		const shape = (id: string) => { const entry = families.get(id)!; return [entry.stage, entry.drift, entry.on]; };
		expect(shape("confirm")).toEqual(["prompt", 0, null]);
		expect(shape("notice")).toEqual(["prompt", 0, null]);
		expect(shape("question")).toEqual(["prompt", 1, null]);
		for (const id of ["report", "refusal", "prohibition"]) expect(shape(id)).toEqual(["terminal", 3, null]);
		expect(shape("done")).toEqual(["outcome", 0, "affirm"]);
		expect(shape("cancelled")).toEqual(["outcome", 0, "deny"]);
		expect(shape("overridden")).toEqual(["outcome", 3, "deny"]);
		expect([...families.values()].filter((entry) => entry.stage === "outcome").map((entry) => entry.id)).toEqual([
			"done", "cancelled", "failed", "partial", "running", "already", "busy", "missing", "cannot", "other-target", "other-action",
			"substituted", "changed", "failed-but", "mismatch-ok", "mismatch-ng", "no-problem", "overridden", "repeat",
		]);
		// A one-shot Alert and a sudden question never have a weight at level 0.
		for (const entry of families.values()) {
			if (entry.stage === "terminal") expect(entry.drift).toBeGreaterThanOrEqual(1);
			expect(entry.recipes.some((item) => item.enabled), entry.id).toBe(true);
		}
		// The three terminal families together stay rarer than any one prompt family.
		const weight = (stage: string) => [...families.values()].filter((entry) => entry.stage === stage).map((entry) => entry.weight);
		expect(weight("terminal").reduce((sum, value) => sum + value, 0)).toBeLessThan(Math.min(...weight("prompt")));
	});

	it("contains the sudden questions, reports, refusals and prohibitions the owner listed", () => {
		const set = standardSet();
		const linesOf = (familyId: string) => set.families.find((entry) => entry.id === familyId)!.recipes.flatMap(text);
		expect(linesOf("question")).toEqual(expect.arrayContaining(["{n1}は{n2}ですか？", "{n1}は正常ですか？", "{n1}を必要としていますか？"]));
		expect(linesOf("report")).toEqual(expect.arrayContaining([
			"{s1}しました。", "{s1}しませんでした。", "{n1}が{s1}しました。", "{n1}が{s1}しませんでした。", "{n1}でした。",
			"{n1}が{n2}でした。", "{n1}です。", "{n1}が{n2}です。", "{n1}が{n2}ではありません。", "{s1}中です。",
		]));
		expect(linesOf("refusal")).toEqual(expect.arrayContaining(["できません。", "できませんでした。", "{n1}を{s1}することはできません。", "{n1}には対応していません。"]));
		expect(linesOf("prohibition")).toEqual(expect.arrayContaining([
			"やめてください。", "{s1}しないでください。", "{n1}を{s1}しないでください。", "これ以上{s1}しないでください。", "{n1}を使用しないでください。",
		]));
		// Sudden questions are ordinary prompts: confirmation with Yes and No.
		for (const entry of set.families.find((item) => item.id === "question")!.recipes) expect([entry.kind, entry.buttons]).toEqual(["confirmation", "yes-no"]);
		for (const entry of [...set.terminals, ...set.outcomes]) expect(entry.buttons).toBe("ok");
	});

	it("leaves a path for a Vocabulary without sahen nouns in every stage, and a kind/text contradiction only where a recipe writes one", () => {
		const set = standardSet();
		const nounOnly = (list: readonly FakeAlertRecipe[]) => list.filter((entry) => entry.enabled && !entry.needsSahen);
		expect(nounOnly(set.prompts).length).toBeGreaterThanOrEqual(5);
		expect(nounOnly(set.terminals).length).toBeGreaterThanOrEqual(5);
		expect(nounOnly(set.outcomes).length).toBeGreaterThanOrEqual(set.outcomes.length / 3);
		for (const id of ["done", "cancelled"]) {
			expect(nounOnly(set.families.find((entry) => entry.id === id)!.recipes).length, id).toBeGreaterThanOrEqual(1);
		}
		expect(set.families.find((entry) => entry.id === "mismatch-ok")!.recipes.every((entry) => entry.kind === "error")).toBe(true);
		expect(set.families.find((entry) => entry.id === "mismatch-ng")!.recipes.every((entry) => entry.kind === "success")).toBe(true);
	});

	it("reaches the policy §7.2 counts (FAKE-ALERT-RECIPES2)", () => {
		const set = standardSet();
		const enabled = (list: readonly FakeAlertRecipe[]) => list.filter((entry) => entry.enabled);
		const inFamily = (id: string) => enabled(set.families.find((entry) => entry.id === id)!.recipes).length;
		expect(enabled(set.prompts).length).toBeGreaterThanOrEqual(40);
		expect(inFamily("question")).toBeGreaterThanOrEqual(10);
		expect(enabled(set.terminals).length).toBeGreaterThanOrEqual(20);
		expect([inFamily("report") >= 10, inFamily("refusal") >= 5, inFamily("prohibition") >= 5]).toEqual([true, true, true]);
		expect(enabled(set.outcomes).length).toBeGreaterThanOrEqual(100);
		for (const family of set.families.filter((entry) => entry.stage === "outcome")) expect(inFamily(family.id), family.id).toBeGreaterThanOrEqual(3);
		// A quarter of everything needs nouns alone: no sahen noun, verb, イ-adjective or ナ-adjective stem.
		const all = enabled([...set.prompts, ...set.terminals, ...set.outcomes]);
		const nounsOnly = all.filter((entry) => !entry.needsSahen && !entry.needsVerb && !entry.needsAdjective && !entry.needsNa);
		expect(nounsOnly.length * 4).toBeGreaterThanOrEqual(all.length);
	});
});

describe("the Fake Alert recipe line syntax", () => {
	const base = (): string => render(baseInput());
	it("hands the compiler exactly the typed data the document states", () => {
		const input = baseInput();
		const parsed = parseStandardFakeAlertRecipeMarkdown(render(input));
		if (!parsed.ok) throw new Error(describeFakeAlertSourceIssues(parsed.issues));
		const { ok: _ok, ...document } = parsed;
		expect(document).toEqual(input);
		expect(compiled(document)).toEqual(compiled(input));
	});

	it.each([
		["an unknown entry kind", (s: string) => s.replace("## terminal t-one", "## report t-one"), ["unknown-entry-kind"]],
		["an unknown field", (s: string) => s.replace("kind: information", "kind: information\nicon: info"), ["unknown-field"]],
		["a line in a family", (s: string) => s.replace("stage: terminal", "stage: terminal\nline: 猫です。"), ["unknown-field"]],
		["a field written twice", (s: string) => s.replace("kind: information", "kind: information\nkind: error"), ["duplicate-field"]],
		["a field after a line", (s: string) => s.replace("line: {s1}中です。", "line: {s1}中です。\nweight: 2"), ["misplaced-field"]],
		["a missing field", (s: string) => s.replace("kind: information\n", ""), ["missing-field"]],
		["a weight with a leading zero", (s: string) => s.replace("## family odd\nstage: outcome\nweight: 1", "## family odd\nstage: outcome\nweight: 01"), ["invalid-weight"]],
		["a drift that is not a number", (s: string) => s.replace("drift: 2\non: any", "drift: two\non: any"), ["invalid-drift"]],
		["enabled that is not true or false", (s: string) => s.replace("## terminal t-one\nfamily: blurt\nenabled: true", "## terminal t-one\nfamily: blurt\nenabled: yes"), ["invalid-boolean"]],
		["content after a blank line", (s: string) => s.replace("line: {s1}中です。\n", "line: {s1}中です。\n\nline: 猫です。\n"), ["unexpected-content"]],
		["a line that is not a field", (s: string) => s.replace("kind: information", "kind information"), ["invalid-field", "missing-field"]],
		["content before the first entry", (s: string) => s.replace("data-version: 1\n", "data-version: 1\nstray\n"), ["orphan-content"]],
		["unknown metadata", (s: string) => s.replace("data-version: 1\n", "data-version: 1\nauthor: 1\n"), ["unknown-metadata"]],
		["metadata written twice", (s: string) => s.replace("data-version: 1\n", "data-version: 1\ndata-version: 2\n"), ["duplicate-metadata"]],
		["missing metadata", (s: string) => s.replace("data-version: 1\n", ""), ["missing-metadata"]],
		["a heading that is not an entry", (s: string) => s.replace("## terminal t-one", "### terminal t-one"), ["unknown-heading"]],
		["a title after an entry", (s: string) => `${s}\n# Again\n`, ["unexpected-title"]],
		["no entries", () => "# Test recipes\n\nschema-version: 1\ndata-version: 1\n", ["no-entries"]],
	] as const)("refuses %s", (_name, mutate, codes) => {
		expect(markdownCodes(mutate(base()))).toEqual(codes);
	});

	it("reports compiler problems with the line of the entry, in document order, without a path", () => {
		const parsed = parseStandardFakeAlertRecipeMarkdown(base().replace("line: {s1}中です。", "line: {s9}中です。").replace("kind: success", "kind: victory"));
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.issues.map((entry) => entry.code)).toEqual(["invalid-slot", "invalid-kind"]);
		expect(parsed.issues[0]!.line).toBeLessThan(parsed.issues[1]!.line);
		const described = describeFakeAlertSourceIssues(parsed.issues);
		expect(described).toMatch(/^invalid-slot \(line \d+\): t-one: s9; invalid-kind \(line \d+\): o-fine: victory$/u);
		expect(described).not.toMatch(/[\\/]|resources|standard-recipes/u);
	});

	it("ignores notes and keeps a template exactly as written", () => {
		const noted = base().replace("## terminal t-one", "> a note\n>\n## terminal t-one");
		expect(parseStandardFakeAlertRecipeMarkdown(noted)).toEqual(parseStandardFakeAlertRecipeMarkdown(base()));
		// A trailing space is part of the template, so the compiler refuses it instead of the parser trimming it.
		expect(markdownCodes(base().replace("line: {s1}中です。", "line: {s1}中です。 "))).toEqual(["invalid-literal"]);
	});
});

describe("the generated Fake Alert recipe module", () => {
	it("is exactly what the document implies, and the guard accepts the checkout", async () => {
		const { source } = await generateStandardFakeAlertRecipes();
		expect(source).toBe((await readFile(STANDARD_FAKE_ALERT_RECIPES_GENERATED, "utf8")).replaceAll("\r\n", "\n"));
		expect(await assertStandardFakeAlertRecipesGenerated()).toEqual({ schemaVersion: 1, dataVersion: STANDARD_FAKE_ALERT_RECIPE_DATA_VERSION });
	});

	it("renders byte-identical output with no timestamp or absolute path", async () => {
		const first = await generateStandardFakeAlertRecipes();
		const second = await generateStandardFakeAlertRecipes({ rootDir: process.cwd() });
		expect(second.source).toBe(first.source);
		expect(renderGeneratedFakeAlertRecipeModule(first.parsed, first.packed)).toBe(first.source);
		expect(first.source).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\/|20\d\d-\d\d-\d\d/u);
	});

	it("stores equal fixed text once, and packs and restores any compiled set without changing it", () => {
		const packed = STANDARD_FAKE_ALERT_PACKED_RECIPES;
		expect(new Set(packed.literals).size).toBe(packed.literals.length);
		const used = new Set(packed.recipes.flatMap((entry) => entry[6].flat()).filter((part): part is number => typeof part === "number"));
		expect([...used].sort((a, b) => a - b)).toEqual(packed.literals.map((_value, index) => index));
		const small = compiled(baseInput());
		const repacked = packFakeAlertRecipeSet(small);
		expect(repacked.literals).toEqual(["は", "ですか？", "を", "しますか？", "中です。", "を完了しました。", "取り消しました。", "できませんでした。", "代わりに", "しました。"]);
		expect(unpackFakeAlertRecipeSet(repacked)).toEqual(small);
		// A disabled recipe and its family survive the round trip as written.
		const disabled = compiled(edited((input) => { recipe(input, "o-odd").enabled = false; }));
		expect(unpackFakeAlertRecipeSet(packFakeAlertRecipeSet(disabled))).toEqual(disabled);
	});

	it("fails loudly on packed data it cannot place, instead of building half a recipe", () => {
		const packed = packFakeAlertRecipeSet(compiled(baseInput()));
		const broken = (edit: (copy: { families: unknown[][]; recipes: unknown[][]; literals: string[] }) => void) => {
			const copy = JSON.parse(JSON.stringify(packed)) as { families: unknown[][]; recipes: unknown[][]; literals: string[] };
			edit(copy);
			return () => unpackFakeAlertRecipeSet(copy as never);
		};
		expect(broken((copy) => { copy.families[0]![1] = 9; })).toThrow(/no such stage/u);
		expect(broken((copy) => { copy.recipes[0]![1] = 99; })).toThrow(/no such family/u);
		expect(broken((copy) => { copy.recipes[0]![3] = -1; })).toThrow(/no such kind/u);
		expect(broken((copy) => { copy.recipes[0]![5] = 1.5; })).toThrow(/no such button set/u);
		expect(broken((copy) => { copy.literals.length = 1; })).toThrow(/no such fixed text/u);
		expect(broken((copy) => { (copy.recipes[0]![6] as unknown[][])[0]![0] = "n9"; })).toThrow(/unknown slot/u);
		expect(broken((copy) => { copy.recipes.at(-1)![5] = 2; })).toThrow(/not a prompt but has its own buttons/u);
	});

	it("refuses a missing or unreadable document instead of falling back to what is on disk", async () => {
		await expect(generateStandardFakeAlertRecipes({ rootDir: "/nonexistent-semantropy-root" })).rejects.toThrow(/standard-recipes\.md is missing/u);
		await expect(generateStandardFakeAlertRecipes({ markdownPath: process.cwd() })).rejects.toThrow(/is unreadable \(EISDIR\)/u);
	});

	it("refuses a malformed document before anything is written", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("malformed");
		try {
			const before = [await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")];
			const source = (await standardMarkdown()).replace("line: 続行しますか？", "line: 続行しますか?");
			await expect(writeStandardFakeAlertRecipes({ markdown: source, generatedPath: outfile, lockPath })).rejects.toThrow(/invalid-literal \(line \d+\): confirm-continue/u);
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual(before);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
});

describe("Fake Alert recipe generation, lock and publication", () => {
	it("allows first generation only at data-version 1 when both destinations are absent", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("first", { copyLock: false });
		try {
			const first = bumped(await standardMarkdown(), 1);
			const written = await writeStandardFakeAlertRecipes({ markdown: first, generatedPath: outfile, lockPath });
			expect(written).toMatchObject({ outfile: STANDARD_FAKE_ALERT_RECIPES_GENERATED, schemaVersion: 1, dataVersion: 1 });
			expect(written.families).toBe(standardSet().families.length);
			expect((await readdir(scratch)).sort()).toEqual(["standard-recipes.lock.json", "standardFakeAlertRecipes.ts"]);
			expect((JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock).versions).toHaveLength(1);
			await expect(assertStandardFakeAlertRecipesGenerated({ markdown: first, generatedPath: outfile, lockPath })).resolves.toMatchObject({ dataVersion: 1 });
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each([
		["first generation at version 2", { copyLock: false }],
		["a skipped version", { copyLock: true }],
	] as const)("refuses %s before staging incomplete history", async (_name, options) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("gap", options);
		try {
			const before = options.copyLock === false ? null : [await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")];
			const version = options.copyLock === false ? 2 : STANDARD_FAKE_ALERT_RECIPE_DATA_VERSION + 2;
			await expect(writeStandardFakeAlertRecipes({ markdown: bumped(await standardMarkdown(), version) + EXTRA_OUTCOME, generatedPath: outfile, lockPath }))
				.rejects.toThrow(/data-version-gap/u);
			if (before === null) expect(await readdir(scratch)).toEqual([]);
			else expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual(before);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it.each([
		["fixed text", (s: string) => s.replace("line: 続行しますか？", "line: 続けますか？")],
		["a family weight", (s: string) => s.replace("## family report\nstage: terminal\nweight: 30", "## family report\nstage: terminal\nweight: 20")],
		["a drift", (s: string) => s.replace("## family question\nstage: prompt\nweight: 360\ndrift: 1", "## family question\nstage: prompt\nweight: 360\ndrift: 2")],
		["a kind", (s: string) => s.replace("## terminal stop-bare\nfamily: prohibition\nenabled: true\nkind: warning", "## terminal stop-bare\nfamily: prohibition\nenabled: true\nkind: error")],
		["an enabled flag", (s: string) => s.replace("## outcome busy-noun\nfamily: busy\nenabled: true", "## outcome busy-noun\nfamily: busy\nenabled: false")],
		["an added entry", (s: string) => s + EXTRA_OUTCOME],
		["a deletion", (s: string) => s.replace(/## outcome no-problem-action[\s\S]*?(?=## outcome overridden-refused)/u, "")],
		["entry order", (s: string) => s.replace(/(## terminal report-did\n[\s\S]*?\n\n)(## terminal report-did-not\n[\s\S]*?\n\n)/u, "$2$1")],
	] as const)("refuses a same-version meaning change to %s, then accepts it at the next version while keeping history", async (_name, mutate) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("same-version");
		try {
			const generated = await readFile(outfile, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			const source = await standardMarkdown();
			const changed = mutate(source);
			expect(changed).not.toBe(source);
			expect(parseStandardFakeAlertRecipeMarkdown(changed).ok).toBe(true);
			await expect(writeStandardFakeAlertRecipes({ markdown: changed, generatedPath: outfile, lockPath })).rejects.toThrow(/data-version-unchanged/u);
			await expect(assertStandardFakeAlertRecipesGenerated({ markdown: changed, generatedPath: outfile, lockPath })).rejects.toThrow(GENERATE_PATTERN);
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual([generated, lockBefore]);
			const next = STANDARD_FAKE_ALERT_RECIPE_DATA_VERSION + 1;
			await writeStandardFakeAlertRecipes({ markdown: bumped(changed, next), generatedPath: outfile, lockPath });
			const after = JSON.parse(await readFile(lockPath, "utf8")) as RecipeLock;
			expect(after.versions[0]).toEqual({ dataVersion: 1, digest: V1_DIGEST });
			expect(after.versions.map((entry) => entry.dataVersion)).toEqual(Array.from({ length: next }, (_value, index) => index + 1));
			// The previous meaning is not re-approvable at a lower version either.
			await expect(writeStandardFakeAlertRecipes({ generatedPath: outfile, lockPath })).rejects.toThrow(/data-version-unchanged/u);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("refuses a same-version meaning change even when payload and digest are rewritten together", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("self-authenticated");
		try {
			const changed = (await standardMarkdown()) + EXTRA_OUTCOME;
			// A generated module that already claims the changed data cannot approve it: the lock does not.
			await writeFile(outfile, (await generateStandardFakeAlertRecipes({ markdown: changed })).source);
			await expect(writeStandardFakeAlertRecipes({ markdown: changed, generatedPath: outfile, lockPath })).rejects.toThrow(/data-version-unchanged/u);
			await expect(assertStandardFakeAlertRecipesGenerated({ markdown: changed, generatedPath: outfile, lockPath })).rejects.toThrow(/does not record the current recipe data/u);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("restores comment, formatting and packed-data hand edits at the same version", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("restore");
		try {
			const pristine = await readFile(outfile, "utf8");
			for (const mutate of [
				(s: string) => s.replace("Do not edit this file.", "Edited by hand."),
				(s: string) => s.replace('["confirm",0,600,0,-1]', '["confirm",0,99,0,-1]'),
				(s: string) => s.replaceAll("\t", "  "),
			]) {
				const handEdited = mutate(pristine);
				expect(handEdited).not.toBe(pristine);
				await writeFile(outfile, handEdited);
				await expect(assertStandardFakeAlertRecipesGenerated({ generatedPath: outfile, lockPath })).rejects.toThrow(/does not match/u);
				await writeStandardFakeAlertRecipes({ generatedPath: outfile, lockPath });
				expect(await readFile(outfile, "utf8")).toBe(pristine);
			}
			expect(await readFile(lockPath, "utf8")).toBe(await readFile(STANDARD_FAKE_ALERT_RECIPES_LOCK, "utf8"));
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("fails closed on a generated module whose digest or payload is missing, malformed or inconsistent", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("untrusted");
		try {
			const pristine = await readFile(outfile, "utf8");
			for (const [mutate, code] of [
				[(s: string) => s.replace(/export const STANDARD_FAKE_ALERT_RECIPE_DATA_DIGEST = "[0-9a-f]+";\n/u, ""), "missing-digest"],
				[(s: string) => s.replace(/DATA_DIGEST = "[0-9a-f]{8}/u, 'DATA_DIGEST = "zzzzzzzz'), "malformed-digest"],
				[(s: string) => s.replace(/DATA_DIGEST = "[0-9a-f]{8}/u, 'DATA_DIGEST = "00000000'), "digest-inconsistent"],
				[(s: string) => s.replace(/export const STANDARD_FAKE_ALERT_RECIPE_DATA_JSON = .*;\n/u, ""), "missing-payload"],
				[(s: string) => s.replace(/DATA_JSON = "\{/u, 'DATA_JSON = "['), "malformed-payload"],
			] as const) {
				await writeFile(outfile, mutate(pristine));
				await expect(writeStandardFakeAlertRecipes({ generatedPath: outfile, lockPath })).rejects.toThrow(new RegExp(`not a trustworthy previous recipe module \\(${code}\\)`, "u"));
			}
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("refuses a lock that has lost version 1, a malformed lock, and a lock that is missing beside a generated module", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("lock");
		try {
			for (const lock of ["{}", "[]", "not json", JSON.stringify({ versions: [] }), JSON.stringify({ versions: [{ dataVersion: 2, digest: V1_DIGEST }] }),
				JSON.stringify({ versions: [{ dataVersion: 1, digest: "abc" }] }), JSON.stringify({ versions: [{ dataVersion: 1, digest: V1_DIGEST, note: "x" }] })]) {
				await writeFile(lockPath, lock);
				await expect(writeStandardFakeAlertRecipes({ generatedPath: outfile, lockPath })).rejects.toThrow(/not a trustworthy recipe lock \(malformed-lock\)/u);
				await expect(assertStandardFakeAlertRecipesGenerated({ generatedPath: outfile, lockPath })).rejects.toThrow(/malformed-lock/u);
			}
			await rm(lockPath);
			await expect(writeStandardFakeAlertRecipes({ generatedPath: outfile, lockPath })).rejects.toThrow(/standard-recipes\.lock\.json is missing\. Revert the generated module/u);
			await expect(assertStandardFakeAlertRecipesGenerated({ generatedPath: outfile, lockPath })).rejects.toThrow(/lock\.json is missing/u);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("rolls the generated module back when the lock cannot be published, and is repaired by the next generate", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rollback");
		try {
			const generated = await readFile(outfile, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			const next = bumped((await standardMarkdown()) + EXTRA_OUTCOME, STANDARD_FAKE_ALERT_RECIPE_DATA_VERSION + 1);
			const failure = await caught(() => writeStandardFakeAlertRecipes({ markdown: next, generatedPath: outfile, lockPath,
				beforePublish: (phase) => { if (phase === "lock") throw new Error("injected lock publish failure"); } }));
			expect((failure as Error).message).toBe("injected lock publish failure");
			expect([await readFile(outfile, "utf8"), await readFile(lockPath, "utf8")]).toEqual([generated, lockBefore]);
			await expectNoGeneratingFiles(scratch);
			// A rollback that also fails reports both, and leaves the lock at the approved meaning.
			const both = await caught(() => writeStandardFakeAlertRecipes({ markdown: next, generatedPath: outfile, lockPath,
				beforePublish: (phase) => { if (phase === "lock") throw new Error("injected lock publish failure"); },
				beforeRollback: () => { throw new Error("injected rollback failure"); } }));
			expect(both).toBeInstanceOf(AggregateError);
			expect((both as AggregateError).message).toMatch(/\(rollback-failed\).*version lock is unchanged/u);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			await writeStandardFakeAlertRecipes({ markdown: next, generatedPath: outfile, lockPath });
			await expect(assertStandardFakeAlertRecipesGenerated({ markdown: next, generatedPath: outfile, lockPath })).resolves.toMatchObject({ dataVersion: STANDARD_FAKE_ALERT_RECIPE_DATA_VERSION + 1 });
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("reports an unreadable destination as unreadable, never as missing, before staging anything", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("unreadable");
		try {
			for (const target of [outfile, lockPath]) {
				const readText = readTextWithFailures(new Map([[target, injectedFsError("EACCES")]]));
				const failure = await caught(() => writeStandardFakeAlertRecipes({ generatedPath: outfile, lockPath, readText }));
				expect((failure as NodeJS.ErrnoException).code).toBe("EACCES");
				const checked = await caught(() => assertStandardFakeAlertRecipesGenerated({ generatedPath: outfile, lockPath, readText }));
				expect((checked as Error).message).toMatch(/is unreadable \(EACCES\)/u);
				expect((checked as Error).message).not.toMatch(/is missing/u);
				expect(((checked as Error & { cause?: unknown }).cause as NodeJS.ErrnoException).code).toBe("EACCES");
			}
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
});

type StartResult = { errors?: { text: string; detail?: unknown }[] } | null;
type LoadResult = { contents: string; loader: "ts"; watchFiles: string[] } | null;

function register(rootDir: string, options: { readText?: (filePath: string) => Promise<string> } = {}) {
	const start: (() => Promise<StartResult>)[] = [];
	const load: { filter: RegExp; callback: (args: { path: string }) => Promise<LoadResult> }[] = [];
	const setup: FakeAlertRecipeGuardBuild = {
		onStart: (callback) => { start.push(callback); },
		onLoad: (hook, callback) => { load.push({ filter: hook.filter, callback }); },
	};
	standardFakeAlertRecipesPlugin(rootDir, options).setup(setup);
	return { start, load };
}

async function copyBuildTree(scratch: string, entry: string): Promise<void> {
	for (const relative of [
		STANDARD_FAKE_ALERT_RECIPES_MARKDOWN, STANDARD_FAKE_ALERT_RECIPES_LOCK, STANDARD_FAKE_ALERT_RECIPES_GENERATED, ...FAKE_ALERT_RECIPE_VALIDATORS,
		STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, STANDARD_FAKE_PROVERB_RECIPES_LOCK, STANDARD_FAKE_PROVERB_RECIPES_GENERATED, ...FAKE_PROVERB_RECIPE_VALIDATORS,
		STANDARD_COLLISION_PATTERNS_MARKDOWN, STANDARD_COLLISION_PATTERNS_LOCK, STANDARD_COLLISION_PATTERNS_GENERATED,
		"src/collision/compilePatternSet.ts", "src/collision/patternData.ts", "tsconfig.json",
	]) {
		await mkdir(path.join(scratch, path.dirname(relative)), { recursive: true });
		await copyFile(relative, path.join(scratch, relative));
	}
	await writeFile(path.join(scratch, "src/main.ts"), entry);
}

describe("the Fake Alert recipe build guard", () => {
	it("accepts CRLF checkouts of the generated module and lock, and still catches a real edit", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("crlf");
		try {
			await writeFile(outfile, (await readFile(outfile, "utf8")).replaceAll("\n", "\r\n"));
			await writeFile(lockPath, (await readFile(lockPath, "utf8")).replaceAll("\n", "\r\n"));
			await expect(assertStandardFakeAlertRecipesGenerated({ generatedPath: outfile, lockPath })).resolves.toMatchObject({ schemaVersion: 1 });
			await writeFile(outfile, (await readFile(outfile, "utf8")).replace('["report",1,30,3,-1]', '["report",1,9,3,-1]'));
			await expect(assertStandardFakeAlertRecipesGenerated({ generatedPath: outfile, lockPath })).rejects.toThrow(/does not match/u);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	it("re-checks the document on every start and reports a refusal as a build error with its cause", async () => {
		expect(await register(process.cwd()).start[0]!()).toBeNull();
		expect((await register("/nonexistent-semantropy-root").start[0]!())?.errors?.[0]?.text).toMatch(/is missing/u);
		for (const label of [STANDARD_FAKE_ALERT_RECIPES_GENERATED, STANDARD_FAKE_ALERT_RECIPES_LOCK]) {
			const target = path.join(process.cwd(), label);
			const result = await register(process.cwd(), { readText: readTextWithFailures(new Map([[target, injectedFsError("EACCES")]])) }).start[0]!();
			const message = result?.errors?.[0];
			expect(message?.text).toContain(`${label} is unreadable (EACCES)`);
			expect(message?.text).not.toMatch(/is missing/u);
			expect((message?.detail as { cause?: { code?: string } }).cause?.code).toBe("EACCES");
		}
	});

	it("hooks only its own generated module, where it registers every input as a watch file", async () => {
		const hooks = register(process.cwd());
		expect(hooks.start).toHaveLength(1);
		expect(hooks.load).toHaveLength(1);
		const hook = hooks.load[0]!;
		expect(hook.filter.flags).not.toContain("u");
		for (const other of ["src/main.ts", "src/SemantropyPlugin.ts", STANDARD_FAKE_PROVERB_RECIPES_GENERATED]) expect(hook.filter.test(other)).toBe(false);
		expect(FAKE_ALERT_RECIPE_VALIDATORS).toEqual(["src/fakeAlert/compileRecipeSet.ts", "src/fakeAlert/recipeData.ts", "src/fakeAlert/recipeSet.ts"]);
		const watchFiles = [STANDARD_FAKE_ALERT_RECIPES_MARKDOWN, STANDARD_FAKE_ALERT_RECIPES_GENERATED, STANDARD_FAKE_ALERT_RECIPES_LOCK, ...FAKE_ALERT_RECIPE_VALIDATORS]
			.map((file) => path.resolve(file));
		const loaded = await hook.callback({ path: path.resolve(STANDARD_FAKE_ALERT_RECIPES_GENERATED) });
		expect(loaded).toMatchObject({ loader: "ts", watchFiles });
		expect(loaded?.contents).toBe(await readFile(STANDARD_FAKE_ALERT_RECIPES_GENERATED, "utf8"));
		// A file that merely has the same name somewhere else is not this guard's.
		expect(await hook.callback({ path: path.resolve("elsewhere/standardFakeAlertRecipes.ts") })).toBeNull();
		// The plugin object asks esbuild for nothing else: no entry resolver, no tsconfig requirement.
		const registered: string[] = [];
		standardFakeAlertRecipesPlugin(process.cwd()).setup(new Proxy({}, { get: (_target, name) => (...args: unknown[]) => { registered.push(String(name)); void args; } }) as never);
		expect(registered.sort()).toEqual(["onLoad", "onStart"]);
	});

	it("is in the real bundle definition exactly once, after the guards that own the entry point", () => {
		const options = bundleOptions(process.cwd(), { outfile: path.resolve("dist", "unused.js"), banner: "", dictionaryDir: undefined, minify: true, sourcemap: false });
		const names = (options.plugins as Plugin[]).map((plugin) => plugin.name);
		expect(names.filter((name) => name === FAKE_ALERT_GUARD_NAME)).toHaveLength(1);
		expect(names.indexOf(FAKE_ALERT_GUARD_NAME)).toBeGreaterThan(names.indexOf("semantropy-standard-fake-proverb-recipes"));
		expect(names.indexOf(FAKE_ALERT_GUARD_NAME)).toBeGreaterThan(names.indexOf("semantropy-standard-collision-patterns"));
	});

	it.each(["first", "last"] as const)("changes neither the output nor the warnings of a build that does not import the recipes (%s)", async (position) => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-alert-unchanged-"));
		try {
			await copyBuildTree(scratch, "export const unrelated = 1;\n");
			const common = { absWorkingDir: scratch, bundle: true, write: false as const, format: "cjs" as const, logLevel: "silent" as const, entryPoints: ["src/main.ts"], tsconfig: path.join(scratch, "tsconfig.json") };
			for (const minify of [false, true]) {
				const others = [standardCollisionPatternsPlugin(scratch) as Plugin, standardFakeProverbRecipesPlugin(scratch) as Plugin];
				const reference = await build({ ...common, minify, plugins: others });
				const guard = standardFakeAlertRecipesPlugin(scratch) as Plugin;
				const result = await build({ ...common, minify, plugins: position === "first" ? [guard, ...others] : [...others, guard] });
				expect(result.errors).toEqual([]);
				expect(result.warnings).toEqual([]);
				expect(result.outputFiles[0]!.text).toBe(reference.outputFiles[0]!.text);
				expect(result.outputFiles[0]!.text).toContain("\"use strict\"");
			}
			// The same build fails closed once the generated module is stale.
			const generated = path.join(scratch, STANDARD_FAKE_ALERT_RECIPES_GENERATED);
			await writeFile(generated, (await readFile(generated, "utf8")).replace("Do not edit this file.", "hand-edited"));
			const refused = await build({ ...common, plugins: [standardFakeAlertRecipesPlugin(scratch) as Plugin] })
				.then(() => [] as string[], (error: { errors?: { text: string }[] }) => (error.errors ?? []).map((entry) => entry.text));
			expect(refused.join(" ")).toMatch(/does not match .*Run `npm run generate:fake-alert-recipes`/u);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});

	const cases = [
		{ label: "a Markdown recipe", file: STANDARD_FAKE_ALERT_RECIPES_MARKDOWN, mutate: (s: string) => s.replace("line: 続行しますか？", "line: 続けますか？"), error: /does not match/u },
		{ label: "a malformed Markdown line", file: STANDARD_FAKE_ALERT_RECIPES_MARKDOWN, mutate: (s: string) => s.replace("line: やめてください。", "line: {やめてください。"), error: /invalid-line/u },
		{ label: "a malformed lock", file: STANDARD_FAKE_ALERT_RECIPES_LOCK, mutate: () => "{}", error: /malformed-lock/u },
		{ label: "the compiler", file: "src/fakeAlert/compileRecipeSet.ts", mutate: (s: string) => s.replace('source["schemaVersion"] !== FAKE_ALERT_RECIPE_SCHEMA_VERSION', 'source["schemaVersion"] !== -1'), error: /unsupported-schema-version/u },
		{ label: "the schema", file: "src/fakeAlert/recipeData.ts", mutate: (s: string) => s.replace('"retry-ignore": ["ignore", "retry"],', ""), error: /invalid-buttons/u },
		{ label: "the restore", file: "src/fakeAlert/recipeSet.ts", mutate: (s: string) => s.replace("enabled: enabled === 1,", "enabled: enabled === 2,"), error: /could not be packed without changing its meaning/u },
	];
	it.each(cases)("once the recipes are imported, a watch detects $label edits and recovery without a caller-triggered rebuild", async ({ file, mutate, error }) => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-alert-watch-"));
		let deliver: ((errors: readonly string[]) => void) | undefined;
		let context: Awaited<ReturnType<typeof esbuildContext>> | undefined;
		try {
			// What a later slice's entry does: it imports the generated module.
			await copyBuildTree(scratch, 'import { STANDARD_FAKE_ALERT_PACKED_RECIPES } from "./fakeAlert/generated/standardFakeAlertRecipes";\nexport const count = STANDARD_FAKE_ALERT_PACKED_RECIPES.recipes.length;\n');
			context = await esbuildContext({ absWorkingDir: scratch, entryPoints: ["src/main.ts"], outfile: "out.js", bundle: true, logLevel: "silent", format: "cjs",
				tsconfig: path.join(scratch, "tsconfig.json"),
				plugins: [standardCollisionPatternsPlugin(scratch) as Plugin, standardFakeProverbRecipesPlugin(scratch) as Plugin, standardFakeAlertRecipesPlugin(scratch) as Plugin,
					{ name: "record-watch", setup(buildApi) {
						buildApi.onEnd((result) => { deliver?.([...result.errors.map((entry) => entry.text), ...result.warnings.map((entry) => `warning: ${entry.text}`)]); });
					} }] });
			const event = async (action: () => Promise<unknown>): Promise<readonly string[]> => {
				let timeout: ReturnType<typeof setTimeout> | undefined;
				const completed = new Promise<readonly string[]>((resolve, reject) => {
					timeout = setTimeout(() => reject(new Error("watch did not detect the file change")), 15_000);
					deliver = resolve;
				});
				try { await action(); return await completed; } finally { clearTimeout(timeout); deliver = undefined; }
			};
			expect(await event(() => context!.watch())).toEqual([]);
			const output = await readFile(path.join(scratch, "out.js"), "utf8");
			const sourcePath = path.join(scratch, file);
			const source = await readFile(sourcePath, "utf8");
			const changed = mutate(source);
			expect(changed).not.toBe(source);
			expect((await event(() => replaceFile(sourcePath, changed))).join("\n")).toMatch(error);
			expect(await event(() => replaceFile(sourcePath, source))).toEqual([]);
			expect(await readFile(path.join(scratch, "out.js"), "utf8")).toBe(output);
		} finally { await context?.dispose(); await rm(scratch, { recursive: true, force: true }); }
	}, 60_000);
});

describe("the Fake Alert recipes reach the plugin as packed data only", () => {
	// VIEW1 connected Fake Alert. TEMPLATES1 and CORE1 pinned that nothing of it was reachable; now the
	// plugin carries the generator, the packed recipes and their restore, and the dialog, and still no
	// compiler, no Markdown document and no canonical payload or digest.
	it("reaches the plugin entry points through exactly the connected modules, without the compiler or the canonical payload", async () => {
		for (const entryPoint of ["src/main.ts", "src/SemantropyPlugin.ts"]) {
			const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm",
				external: ["obsidian", "virtual:semantropy-lindera-*"], legalComments: "none" });
			expect(Object.keys(result.metafile.inputs).filter((name) => /fakeAlert|fake-alert/iu.test(name)).sort()).toEqual([...FAKE_ALERT_VIEW1_ADDED].sort());
			expect(result.outputFiles[0]!.text).not.toMatch(/no-level-zero|invalid-sahen-follower|\\"families\\":|9b4134012bc4b3b8|ff56cf6780a45e29|c607549fd22d4e88|46d647ea2597b9ba|0e90c7762984b86d|generate:fake-alert-recipes|fake-alert\/standard-recipes/u);
		}
	});

	it("gives the compiler, the set builder and the generated data closed, pure graphs", async () => {
		for (const [entry, expected] of [
			["src/fakeAlert/compileRecipeSet.ts", FAKE_ALERT_RECIPE_VALIDATORS],
			["src/fakeAlert/recipeSet.ts", ["src/fakeAlert/recipeData.ts", "src/fakeAlert/recipeSet.ts"]],
			["src/fakeAlert/recipeData.ts", ["src/fakeAlert/recipeData.ts"]],
			[STANDARD_FAKE_ALERT_RECIPES_GENERATED, [STANDARD_FAKE_ALERT_RECIPES_GENERATED]],
		] as const) {
			const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral", format: "esm", legalComments: "none" });
			expect(Object.keys(result.metafile.inputs).sort()).toEqual([...expected].sort());
			expect(result.outputFiles[0]!.text).not.toMatch(/Math\.random|Date\.now|new Date|crypto|fetch\(|document\.|window\.|node:fs|readFile|console\.|eval\(|new Function|new RegExp/u);
		}
		// What a later slice will ship: the packed data and the restore, never the compiler or the canonical payload.
		const runtime = await build({ stdin: { contents: 'import { STANDARD_FAKE_ALERT_PACKED_RECIPES } from "./src/fakeAlert/generated/standardFakeAlertRecipes";\nimport { unpackFakeAlertRecipeSet } from "./src/fakeAlert/recipeSet";\nexport const set = unpackFakeAlertRecipeSet(STANDARD_FAKE_ALERT_PACKED_RECIPES);\n', resolveDir: process.cwd(), loader: "ts" },
			bundle: true, write: false, metafile: true, minify: true, platform: "neutral", format: "esm", legalComments: "none" });
		expect(Object.keys(runtime.metafile.inputs).filter((name) => name.startsWith("src/")).sort()).toEqual(
			[STANDARD_FAKE_ALERT_RECIPES_GENERATED, "src/fakeAlert/recipeData.ts", "src/fakeAlert/recipeSet.ts"].sort());
		expect(runtime.outputFiles[0]!.text).not.toMatch(/no-level-zero|invalid-sahen-follower|\\"families\\":|9b4134012bc4b3b8|ff56cf6780a45e29|c607549fd22d4e88|46d647ea2597b9ba|0e90c7762984b86d/u);
	});

	// TEMPLATES1 added the recipe modules; CORE1 added the generator, the level table and the versions leaf, which owns algorithm 1.
	// VIEW1 named it from the dialog, the View, the Toolbar and the interface catalog, and from nowhere else.
	it("is mentioned only by the View-side modules VIEW1 connected, keeps the recipe modules version-free, and adds no Collect or settings version", async () => {
		const names = (await readdir("src", { recursive: true })).map((name) => `src/${name.replaceAll("\\", "/")}`).filter((name) => name.endsWith(".ts"));
		const recipeModules = [...FAKE_ALERT_RECIPE_VALIDATORS, STANDARD_FAKE_ALERT_RECIPES_GENERATED];
		expect(names.filter((name) => name.startsWith("src/fakeAlert/")).sort()).toEqual(
			[...recipeModules, "src/fakeAlert/fakeAlertCore.ts", "src/fakeAlert/fakeAlertLevel.ts", "src/fakeAlert/fakeAlertVersions.ts"].sort());
		const owners: string[] = [];
		const mentions: string[] = [];
		for (const name of names) {
			const source = await readFile(name, "utf8");
			if (recipeModules.includes(name)) expect(source, name).not.toMatch(/ALGORITHM_VERSION|algorithmVersion/u);
			if (name.startsWith("src/fakeAlert/")) {
				expect(source, name).not.toMatch(/metadataVersion|settingsSchema/u);
				if (/FAKE_ALERT_ALGORITHM_VERSION = /u.test(source)) owners.push(name);
			} else if (/fakeAlert|FAKE_ALERT|fake-alert|FakeAlert/u.test(source)) mentions.push(name);
		}
		expect(owners).toEqual(["src/fakeAlert/fakeAlertVersions.ts"]);
		expect(mentions.sort()).toEqual(["src/i18n/catalog.ts", "src/view/FakeAlertModal.ts", "src/view/SemantropyToolbar.ts", "src/view/SemantropyView.ts"]);
		// No Copy, Collect or clipboard path in this version (policy §11): the dialog only shows and closes.
		expect(await readFile("src/view/FakeAlertModal.ts", "utf8")).not.toMatch(/collect|clipboard|writeText|Collect/u);
	});

	it("pins LF for the document, lock and generated module, copies both inputs into the history-free check, and has its generate command", async () => {
		const attributes = await readFile(".gitattributes", "utf8");
		expect(attributes).toMatch(/resources\/fake-alert\/standard-recipes\.md\s+text eol=lf/u);
		expect(attributes).toMatch(/resources\/fake-alert\/standard-recipes\.lock\.json\s+text eol=lf/u);
		expect(attributes).toMatch(/src\/fakeAlert\/generated\/\*\.ts\s+text eol=lf/u);
		const historyFree = await readFile("scripts/verifyHistoryFree.mjs", "utf8");
		expect(historyFree).toContain("STANDARD_FAKE_ALERT_RECIPES_MARKDOWN");
		expect(historyFree).toContain("STANDARD_FAKE_ALERT_RECIPES_LOCK");
		const scripts = (JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
		expect(scripts["generate:fake-alert-recipes"]).toBe("node scripts/fakeAlert/generate.mjs");
		expect(GENERATE_COMMAND).toBe("npm run generate:fake-alert-recipes");
		for (const file of ["scripts/buildDistribution.mjs", "web/tools/buildWeb.mjs"]) {
			expect(await readFile(file, "utf8"), file).toContain("await assertStandardFakeAlertRecipesGenerated({ rootDir });");
		}
	});
});
