import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	DISTRIBUTION_FILE_NAMES,
	buildDistribution,
	buildProductionMain,
	watchDevelopmentBuild,
	bundleOptions,
} from "../../scripts/buildDistribution.mjs";
import {
	GENERATE_COMMAND,
	STANDARD_COLLISION_PATTERNS_GENERATED,
	STANDARD_COLLISION_PATTERNS_LOCK,
	STANDARD_COLLISION_PATTERNS_MARKDOWN,
	assertStandardCollisionPatternsGenerated,
	generateStandardCollisionPatterns,
} from "../../scripts/collision/standardPatterns.mjs";

const rootDir = process.cwd();
const outDir = path.join("dist", "semantropy-collision-patterns-test");

let bundle = "";

beforeAll(async () => {
	const built = await buildDistribution({ outDir });
	expect(built.files.map((file: { fileName: string }) => file.fileName)).toEqual(
		DISTRIBUTION_FILE_NAMES,
	);
	bundle = await readFile(path.join(rootDir, outDir, "main.js"), "utf8");
}, 600_000);

afterAll(async () => {
	await rm(path.resolve(rootDir, outDir), { recursive: true, force: true });
});

describe("the shipped Collision pattern contract", () => {
	it("ships as three files, with no fourth resource file for the document", async () => {
		const built = await buildDistribution({ outDir });
		expect(built.files.map((file: { fileName: string }) => file.fileName)).toEqual([
			"main.js",
			"manifest.json",
			"styles.css",
		]);
	});

	it("ships runtime typed pattern data but excludes Markdown, parser, generator and duplicate build data", () => {
		for (const marker of ["regular-verb-basic", "triple-left", "named-link", "noun-ka-shita"]) expect(bundle).toContain(marker);
		for (const marker of [
			STANDARD_COLLISION_PATTERNS_MARKDOWN,
			"standard-patterns.md",
			"standard-patterns.lock.json",
			"parseStandardCollisionPatternMarkdown",
			"STANDARD_COLLISION_PATTERN_DATA_VERSION",
			"STANDARD_COLLISION_PATTERN_DATA_DIGEST",
			"STANDARD_COLLISION_PATTERN_DATA_JSON",
			"standardCollisionPatternEntries",
			"resources/collision",
			GENERATE_COMMAND,
		]) {
			expect(bundle).not.toContain(marker);
		}
		expect(bundle).not.toMatch(/require\("node:fs"\)|from"node:fs"/u);
	});

	it("refuses a stale generated module, without touching the checkout", async () => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-collision-stale-"));
		try {
			const stale = path.join(scratch, "standardCollisionPatternEntries.ts");
			const { source } = await generateStandardCollisionPatterns({ rootDir });
			await writeFile(stale, source.replace("noun-pair", "noun-pair-x"), "utf8");

			await expect(
				assertStandardCollisionPatternsGenerated({ rootDir, generatedPath: stale }),
			).rejects.toThrow(
				new RegExp(GENERATE_COMMAND.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
			);
			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir,
					generatedPath: path.join(scratch, "absent.ts"),
				}),
			).rejects.toThrow(/is missing/u);

			await expect(assertStandardCollisionPatternsGenerated({ rootDir })).resolves.toEqual({
				schemaVersion: 2,
				dataVersion: 2,
			});
			expect(
				await readFile(path.join(rootDir, STANDARD_COLLISION_PATTERNS_GENERATED), "utf8"),
			).toBe(source);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	}, 600_000);

	it("accepts the same module checked out with Windows line endings", async () => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-collision-crlf-"));
		try {
			const crlf = path.join(scratch, "standardCollisionPatternEntries.ts");
			const { source } = await generateStandardCollisionPatterns({ rootDir });
			await writeFile(crlf, source.replaceAll("\n", "\r\n"), "utf8");

			await expect(
				assertStandardCollisionPatternsGenerated({ rootDir, generatedPath: crlf }),
			).resolves.toEqual({ schemaVersion: 2, dataVersion: 2 });
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("keeps the guard inside the bundle, so a watch rebuild cannot skip it", () => {
		const plugins = bundleOptions(rootDir, {
			outfile: path.join(rootDir, outDir, "unused.js"),
			banner: "",
			dictionaryDir: undefined,
			minify: true,
			sourcemap: false,
		}).plugins;

		expect(plugins.map((plugin: { name: string }) => plugin.name)).toContain(
			"semantropy-standard-collision-patterns",
		);
	});
});

describe("every build entry refuses stale Schema 2 input without publishing", () => {
	it.each(["production", "distribution", "watch"] as const)("checks %s before writing or attempting dictionary input", async (kind) => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-collision-build-refusal-"));
		try {
			await cp(path.join(rootDir, "src"), path.join(scratch, "src"), { recursive: true });
			await cp(path.join(rootDir, "resources"), path.join(scratch, "resources"), { recursive: true });
			const sentinel = path.join(scratch, "main.js");
			await writeFile(sentinel, "previous artifact");
			const run = async () => {
				if (kind === "production") return await buildProductionMain({ rootDir: scratch });
				if (kind === "distribution") return await buildDistribution({ rootDir: scratch });
				const context = await watchDevelopmentBuild({ rootDir: scratch });
				await context.dispose();
				return context;
			};
			for (const relative of [STANDARD_COLLISION_PATTERNS_MARKDOWN, STANDARD_COLLISION_PATTERNS_GENERATED, STANDARD_COLLISION_PATTERNS_LOCK]) {
				const file = path.join(scratch, relative);
				const before = await readFile(file, "utf8");
				const edited = relative === STANDARD_COLLISION_PATTERNS_MARKDOWN ? before.replace("label: Standard", "label: Stale") :
					relative === STANDARD_COLLISION_PATTERNS_LOCK ? "{}" : before + "// hand edit\n";
				await writeFile(file, edited);
				await expect(run()).rejects.toThrow(/standard-patterns|standardCollisionPatternEntries/u);
				expect(await readFile(sentinel, "utf8")).toBe("previous artifact");
				expect(await readFile(file, "utf8")).toBe(edited);
				await writeFile(file, before);
			}
		} finally { await rm(scratch, { recursive: true, force: true }); }
	}, 60_000);
});
