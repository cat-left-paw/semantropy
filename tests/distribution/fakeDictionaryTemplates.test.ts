import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	DISTRIBUTION_FILE_NAMES,
	buildDistribution,
	bundleOptions,
} from "../../scripts/buildDistribution.mjs";
import {
	GENERATE_COMMAND,
	STANDARD_TEMPLATES_GENERATED,
	STANDARD_TEMPLATES_MARKDOWN,
	assertStandardTemplatesGenerated,
	generateStandardTemplates,
} from "../../scripts/fakeDictionary/standardTemplates.mjs";
import {
	STANDARD_CORE_TEMPLATES,
	STANDARD_OPTIONAL_CLAUSES,
} from "../../src/dictionary/generated/standardTemplateEntries";

/**
 * The shipped artifact, not the source tree: the templates have to arrive as
 * bundled data, with the document and the parser left behind.
 */
const rootDir = process.cwd();
const outDir = path.join("dist", "semantropy-templates-test");

let bundle = "";

/**
 * The minified bundle is ASCII, so its Japanese arrives as `\uXXXX` escapes.
 * Decoding them is what lets a template body be looked for as the text it is.
 */
const decodeEscapes = (source: string): string =>
	source.replaceAll(/\\u([0-9a-fA-F]{4})/gu, (_match, hex: string) =>
		String.fromCharCode(Number.parseInt(hex, 16)),
	);

beforeAll(async () => {
	const built = await buildDistribution({ outDir });
	expect(built.files.map((file: { fileName: string }) => file.fileName)).toEqual(
		DISTRIBUTION_FILE_NAMES,
	);
	bundle = decodeEscapes(
		await readFile(path.join(rootDir, outDir, "main.js"), "utf8"),
	);
}, 600_000);

afterAll(async () => {
	await rm(path.resolve(rootDir, outDir), { recursive: true, force: true });
});

describe("the shipped standard templates", () => {
	it("ships as three files, with no fourth resource file for the document", async () => {
		const built = await buildDistribution({ outDir });
		expect(built.files.map((file: { fileName: string }) => file.fileName)).toEqual([
			"main.js",
			"manifest.json",
			"styles.css",
		]);
	});

	it("carries every core template and Optional Clause as bundled data", () => {
		expect(STANDARD_CORE_TEMPLATES).toHaveLength(90);
		expect(STANDARD_OPTIONAL_CLAUSES).toHaveLength(31);
		for (const entry of [...STANDARD_CORE_TEMPLATES, ...STANDARD_OPTIONAL_CLAUSES]) {
			expect(bundle).toContain(entry.text);
			expect(bundle).toContain(entry.id);
		}
	});

	it("reads no Markdown, resource file or parser at runtime", () => {
		for (const marker of [
			STANDARD_TEMPLATES_MARKDOWN,
			"standard-templates.md",
			"parseStandardTemplateMarkdown",
			"schema-version:",
			"resources/fake-dictionary",
			GENERATE_COMMAND,
		]) {
			expect(bundle).not.toContain(marker);
		}
		// The bundle is a browser bundle: no filesystem entry point exists for a
		// template document to be read through.
		expect(bundle).not.toMatch(/require\("node:fs"\)|from"node:fs"/u);
	});

	it("refuses a stale generated module, without touching the checkout", async () => {
		// The stale copy lives in a temporary directory: a forced test kill must
		// never leave the working tree holding edited generated source.
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-templates-"));
		try {
			const stale = path.join(scratch, "standardTemplateEntries.ts");
			const { source } = await generateStandardTemplates({ rootDir });
			await writeFile(
				stale,
				source.replace("classification-01", "classification-99"),
				"utf8",
			);

			await expect(
				assertStandardTemplatesGenerated({ rootDir, generatedPath: stale }),
			).rejects.toThrow(
				new RegExp(GENERATE_COMMAND.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
			);
			await expect(
				assertStandardTemplatesGenerated({
					rootDir,
					generatedPath: path.join(scratch, "absent.ts"),
				}),
			).rejects.toThrow(/is missing/u);

			// The real module still matches, so the gate is a comparison and not a
			// latch, and the build that produced this artifact went through it.
			await expect(assertStandardTemplatesGenerated({ rootDir })).resolves.toEqual({
				schemaVersion: 1,
				dataVersion: 1,
			});
			expect(
				await readFile(path.join(rootDir, STANDARD_TEMPLATES_GENERATED), "utf8"),
			).toBe(source);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	}, 600_000);

	it("accepts the same module checked out with Windows line endings", async () => {
		// A CRLF checkout is a presentation difference, not a stale module.
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-templates-crlf-"));
		try {
			const crlf = path.join(scratch, "standardTemplateEntries.ts");
			const { source } = await generateStandardTemplates({ rootDir });
			await writeFile(crlf, source.replaceAll("\n", "\r\n"), "utf8");

			await expect(
				assertStandardTemplatesGenerated({ rootDir, generatedPath: crlf }),
			).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
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
			"semantropy-standard-templates",
		);
	});
});
