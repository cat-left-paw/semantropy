import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, context as esbuildContext, type Plugin } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	DISTRIBUTION_FILE_NAMES,
	buildDistribution,
	buildProductionMain,
	bundleOptions,
	watchDevelopmentBuild,
} from "../../scripts/buildDistribution.mjs";
import {
	GENERATE_COMMAND,
	STANDARD_FAKE_PROVERB_RECIPES_GENERATED,
	STANDARD_FAKE_PROVERB_RECIPES_LOCK,
	STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN,
	assertStandardFakeProverbRecipesGenerated,
	generateStandardFakeProverbRecipes,
} from "../../scripts/fakeProverb/standardRecipes.mjs";
import { STANDARD_COLLISION_PATTERNS_MARKDOWN } from "../../scripts/collision/standardPatterns.mjs";
import { linderaCompactDictionaryDir } from "../../scripts/lindera/linderaSource.mjs";

/**
 * PRE-RELEASE-FAKE-PROVERB-TEMPLATES1 artifact contract: the recipe document,
 * its parser, lock and generated data are build inputs only. Production does
 * not import any of them, the artifact stays three files, and every build
 * entry refuses stale input before writing anything.
 */
const rootDir = process.cwd();
const outDir = path.join("dist", "semantropy-fake-proverb-recipes-test");
let bundle = "";

beforeAll(async () => {
	const built = await buildDistribution({ outDir });
	expect(built.files.map((file: { fileName: string }) => file.fileName)).toEqual(DISTRIBUTION_FILE_NAMES);
	bundle = await readFile(path.join(rootDir, outDir, "main.js"), "utf8");
}, 600_000);

afterAll(async () => {
	await rm(path.resolve(rootDir, outDir), { recursive: true, force: true });
});

describe("the shipped Fake Proverb recipe contract", () => {
	// Until COLLECT1 no recipe data shipped. FAKE-PROVERB-VIEW1 ships the typed generated recipes the runtime compiles;
	// the Markdown document, the lock, the parser, the generator and the canonical payload / digest stay build-time.
	it("ships three files with the typed recipes only, and no document, lock, parser, generator or canonical payload", async () => {
		expect(DISTRIBUTION_FILE_NAMES).toEqual(["main.js", "manifest.json", "styles.css"]);
		const { parsed } = await generateStandardFakeProverbRecipes({ rootDir });
		for (const marker of [
			STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, "standard-recipes.md", "standard-recipes.lock.json", "resources/fake-proverb",
			"parseStandardFakeProverbRecipeMarkdown", "standardFakeProverbRecipeEntries", GENERATE_COMMAND,
			"STANDARD_FAKE_PROVERB_RECIPE_DATA_JSON", "STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST", "1d329f91ba002ac0", "schemaVersion\\\":1",
		]) {
			expect(bundle).not.toContain(marker);
		}
		for (const entry of [...parsed.proverbs, ...parsed.glosses, ...parsed.literals, ...parsed.profiles]) expect(bundle).toContain(`"${entry.id}"`);
		expect(bundle).toContain("independent-noun");
	});

	it("keeps the guard inside every bundle, so a watch rebuild cannot skip it", () => {
		const plugins = bundleOptions(rootDir, { outfile: path.join(rootDir, outDir, "unused.js"), banner: "", dictionaryDir: undefined, minify: true, sourcemap: false })
			.plugins.map((plugin: { name: string }) => plugin.name);
		expect(plugins).toEqual([
			"semantropy-standard-templates", "semantropy-standard-collision-patterns", "semantropy-standard-fake-proverb-recipes", "semantropy-lindera",
		]);
	});

	// Regressions: the entry-point hook once returned watch files without a path, which esbuild
	// ignores and reports as a warning on every normal build; returning the path without an
	// explicit tsconfig then dropped the entry's "use strict" directive from main.js.
	it.each([true, false])("bundles the real definition (minify %s) without any warning and exactly as without the guard", async (minify) => {
		const options = bundleOptions(rootDir, { outfile: path.join(rootDir, outDir, "warning-check.js"), banner: "",
			dictionaryDir: linderaCompactDictionaryDir(rootDir), minify, sourcemap: false });
		const plugins = options.plugins as Plugin[];
		const result = await build({ ...options, plugins, write: false, logLevel: "silent" });
		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);
		// The pre-slice definition: no Fake Proverb guard, tsconfig discovered implicitly.
		const { tsconfig: _explicit, ...withoutTsconfig } = options;
		expect(_explicit).toBe(path.join(rootDir, "tsconfig.json"));
		const reference = await build({ ...withoutTsconfig, plugins: plugins.filter((plugin) => plugin.name !== "semantropy-standard-fake-proverb-recipes"),
			write: false, logLevel: "silent" });
		expect(result.outputFiles[0]!.text).toBe(reference.outputFiles[0]!.text);
		expect(result.outputFiles[0]!.text.slice(0, 40)).toContain('"use strict"');
		// Minified, it is the shipped code; only the licence banner (empty here) differs.
		if (minify) expect(bundle.endsWith(result.outputFiles[0]!.text)).toBe(true);
	});

	it("accepts the checkout, and refuses a stale generated module in a scratch copy without touching it", async () => {
		await expect(assertStandardFakeProverbRecipesGenerated({ rootDir })).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-proverb-stale-"));
		try {
			const stale = path.join(scratch, "standardFakeProverbRecipeEntries.ts");
			const { source } = await generateStandardFakeProverbRecipes({ rootDir });
			await writeFile(stale, source.replace("topic-object", "topic-object-x"));
			await expect(assertStandardFakeProverbRecipesGenerated({ rootDir, generatedPath: stale })).rejects.toThrow(/does not match/u);
			await writeFile(stale, source.replaceAll("\n", "\r\n"));
			await expect(assertStandardFakeProverbRecipesGenerated({ rootDir, generatedPath: stale })).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
			expect(await readFile(path.join(rootDir, STANDARD_FAKE_PROVERB_RECIPES_GENERATED), "utf8")).toBe(source);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
});

describe("every build entry refuses stale Fake Proverb input without publishing", () => {
	it.each(["production", "distribution", "watch"] as const)("checks %s before writing or reading dictionary input", async (kind) => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-proverb-build-refusal-"));
		try {
			await cp(path.join(rootDir, "src"), path.join(scratch, "src"), { recursive: true });
			await cp(path.join(rootDir, "resources"), path.join(scratch, "resources"), { recursive: true });
			await cp(path.join(rootDir, "tsconfig.json"), path.join(scratch, "tsconfig.json"));
			const sentinel = path.join(scratch, "main.js");
			await writeFile(sentinel, "previous artifact");
			const run = async () => {
				if (kind === "production") return await buildProductionMain({ rootDir: scratch });
				if (kind === "distribution") return await buildDistribution({ rootDir: scratch });
				const context = await watchDevelopmentBuild({ rootDir: scratch });
				await context.dispose();
				return context;
			};
			const markdownPath = path.join(scratch, STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN);
			const generatedPath = path.join(scratch, STANDARD_FAKE_PROVERB_RECIPES_GENERATED);
			const markdown = await readFile(markdownPath, "utf8");
			const generated = await readFile(generatedPath, "utf8");
			const sameVersionMeaning = markdown.replace("form: verb-basic 3", "form: verb-basic 4");
			const edits: [string, string, string, RegExp][] = [
				[markdownPath, markdown, sameVersionMeaning, /does not match/u],
				[markdownPath, markdown, markdown.replace("part: literal yori", "part: literal yori extra"), /invalid-part/u],
				[generatedPath, generated, `${generated}// hand edit\n`, /does not match/u],
				[path.join(scratch, STANDARD_FAKE_PROVERB_RECIPES_LOCK), await readFile(path.join(scratch, STANDARD_FAKE_PROVERB_RECIPES_LOCK), "utf8"), "{}", /malformed-lock/u],
			];
			for (const [file, before, edited, error] of edits) {
				await writeFile(file, edited);
				await expect(run()).rejects.toThrow(error);
				expect(await readFile(sentinel, "utf8")).toBe("previous artifact");
				expect(await readFile(file, "utf8")).toBe(edited);
				await writeFile(file, before);
			}
			// A same-version meaning change whose generated module was regenerated
			// consistently still fails: the lock is the version authority.
			await writeFile(markdownPath, sameVersionMeaning);
			await writeFile(generatedPath, (await generateStandardFakeProverbRecipes({ rootDir: scratch })).source);
			await expect(run()).rejects.toThrow(/does not record the current recipe data/u);
			expect(await readFile(sentinel, "utf8")).toBe("previous artifact");
		} finally { await rm(scratch, { recursive: true, force: true }); }
	}, 120_000);
});

describe("watching through the real bundle plugin list", () => {
	it("rebuilds on Fake Proverb and Collision document edits alike, and recovers", async () => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-fake-proverb-real-watch-"));
		let context: Awaited<ReturnType<typeof esbuildContext>> | undefined;
		let deliver: ((errors: readonly string[]) => void) | undefined;
		const event = async (action: () => Promise<unknown>): Promise<readonly string[]> => {
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const completed = new Promise<readonly string[]>((resolve, reject) => {
				timeout = setTimeout(() => reject(new Error("watch did not detect the file change")), 30_000);
				deliver = resolve;
			});
			try { await action(); return await completed; } finally { clearTimeout(timeout); deliver = undefined; }
		};
		try {
			await cp(path.join(rootDir, "src"), path.join(scratch, "src"), { recursive: true });
			await cp(path.join(rootDir, "resources"), path.join(scratch, "resources"), { recursive: true });
			await cp(path.join(rootDir, "tsconfig.json"), path.join(scratch, "tsconfig.json"));
			const options = bundleOptions(scratch, { outfile: path.join(scratch, "main.js"), banner: "", dictionaryDir: undefined, minify: false, sourcemap: false });
			// The real guards, in the real order. Only the dictionary payload is
			// left external; it has no hook on src/main.ts.
			const guards = options.plugins.filter((plugin: { name: string }) => plugin.name !== "semantropy-lindera") as Plugin[];
			expect(guards.map((plugin) => plugin.name)).toEqual(["semantropy-standard-templates", "semantropy-standard-collision-patterns", "semantropy-standard-fake-proverb-recipes"]);
			context = await esbuildContext({ ...options, banner: undefined, external: [...(options.external as string[]), "virtual:semantropy-lindera-*"], logLevel: "silent",
				plugins: [...guards, { name: "record-watch", setup(build) { build.onEnd((result) => {
					// Warnings travel with errors, so every clean rebuild is also warning-free.
					deliver?.([...result.errors.map((entry) => entry.text), ...result.warnings.map((entry) => `warning: ${entry.text}`)]);
				}); } }] });
			expect(await event(() => context!.watch())).toEqual([]);
			for (const [relative, mutate, error] of [
				[STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, (s: string) => s.replace("form: verb-basic 3", "form: verb-basic 4"), /standardFakeProverbRecipeEntries\.ts does not match/u],
				[STANDARD_FAKE_PROVERB_RECIPES_LOCK, () => "{}", /malformed-lock/u],
				[STANDARD_COLLISION_PATTERNS_MARKDOWN, (s: string) => s.replace("label: Standard", "label: Watch"), /standardCollisionPatternEntries\.ts does not match/u],
			] as const) {
				const file = path.join(scratch, relative);
				const source = await readFile(file, "utf8");
				const changed = mutate(source);
				expect(changed).not.toBe(source);
				expect((await event(() => writeFile(file, changed))).join("\n")).toMatch(error);
				expect(await event(() => writeFile(file, source))).toEqual([]);
			}
		} finally { await context?.dispose(); await rm(scratch, { recursive: true, force: true }); }
	}, 300_000);
});
