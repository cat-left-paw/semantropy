import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import {
	GENERATE_COMMAND,
	STANDARD_TEMPLATES_GENERATED,
	STANDARD_TEMPLATES_MARKDOWN,
	TEMPLATE_SCHEMA_VERSION,
	assertStandardTemplatesGenerated,
	describeTemplateSourceIssues,
	generateStandardTemplates,
	parseStandardTemplateMarkdown,
	renderGeneratedTemplateModule,
	standardTemplatesPlugin,
	writeStandardTemplates,
} from "../scripts/fakeDictionary/standardTemplates.mjs";
import {
	STANDARD_CORE_TEMPLATES,
	STANDARD_OPTIONAL_CLAUSES,
	STANDARD_TEMPLATE_DATA_VERSION,
	STANDARD_TEMPLATE_SCHEMA_VERSION,
} from "../src/dictionary/generated/standardTemplateEntries";
import {
	STANDARD_TEMPLATE_SET,
	STANDARD_TEMPLATE_SET_VERSION,
} from "../src/dictionary/standardTemplateSet";
import {
	OPTIONAL_CLAUSE_CATEGORIES,
	TEMPLATE_FAMILIES,
} from "../src/dictionary/templateData";
import {
	FAKE_DICTIONARY_ALGORITHM_VERSION,
	generateFakeDefinition,
	prepareFakeDictionaryGeneration,
	type FakeDefinitionResult,
} from "../src/dictionary/generateFakeDefinition";
import type { FakeDictionaryHeadword } from "../src/dictionary/headword";
import type { DictionaryVocabularyPool } from "../src/dictionary/vocabularyPool";
import { readPinnedFixture } from "./support/pinnedFixture";

type RawEntry = { id: string; family?: string; category?: string; text: string };
type CompiledEntry = {
	id: string;
	family?: string;
	category?: string;
	segments: unknown;
	requiredPlaceholders: readonly string[];
};
type Baseline = {
	raw: { coreTemplates: RawEntry[]; optionalClauses: RawEntry[] };
	compiled: {
		version: number;
		coreTemplates: CompiledEntry[];
		optionalClauses: CompiledEntry[];
	};
	pools: Record<string, DictionaryVocabularyPool>;
	headwords: FakeDictionaryHeadword[];
	definitions: {
		pool: string;
		headword: string;
		dictionarySemantropy: number;
		dictionarySeed: number;
		result: FakeDefinitionResult;
	}[];
};

/**
 * The template set exactly as it stood before the Markdown migration, captured
 * once from the hand-written data. It is recorded input and output, not Git
 * history: `readPinnedFixture` checks its SHA-256 and never regenerates it.
 */
const BASELINE = readPinnedFixture<Baseline>(
	"fakeDictionaryTemplates",
	"553ba3a3d1c59d97b1d0d7947136695b7d2a6ccdd9bfe76d1e966d3255ff1d07",
);

const markdown = async () => await readFile(STANDARD_TEMPLATES_MARKDOWN, "utf8");

/** A document built from parts, so one rule at a time can be broken. */
function document(options: {
	schema?: string | null;
	data?: string | null;
	entries?: readonly string[];
	extra?: string;
} = {}): string {
	const lines = ["# Templates", ""];
	if (options.schema !== null) lines.push(`schema-version: ${options.schema ?? "1"}`);
	if (options.data !== null) lines.push(`data-version: ${options.data ?? "1"}`);
	if (options.extra !== undefined) lines.push(options.extra);
	lines.push("");
	for (const entry of options.entries ?? [
		"## core classification-01\nfamily: classification\n\n{{noun}}の一種。",
	]) {
		lines.push(entry, "");
	}
	return lines.join("\n");
}

const codesOf = (source: string): readonly string[] => {
	const parsed = parseStandardTemplateMarkdown(source);
	return parsed.ok ? [] : parsed.issues.map((issue: { code: string }) => issue.code);
};

describe("the standard template document", () => {
	it("parses every core template and Optional Clause the plugin ships", async () => {
		const parsed = parseStandardTemplateMarkdown(await markdown());

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION);
		expect(parsed.dataVersion).toBe(1);
		expect(parsed.coreTemplates).toHaveLength(90);
		expect(parsed.optionalClauses).toHaveLength(31);
	});

	it("gives every family exactly three core templates and names only known families", async () => {
		const parsed = parseStandardTemplateMarkdown(await markdown());

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		for (const family of TEMPLATE_FAMILIES) {
			expect(
				parsed.coreTemplates.filter((entry: RawEntry) => entry.family === family),
			).toHaveLength(3);
		}
		const families = new Set(parsed.coreTemplates.map((entry: RawEntry) => entry.family));
		expect([...families].sort()).toEqual([...TEMPLATE_FAMILIES].sort());
		const categories = new Set(
			parsed.optionalClauses.map((entry: RawEntry) => entry.category),
		);
		expect([...categories].sort()).toEqual([...OPTIONAL_CLAUSE_CATEGORIES].sort());
	});

	it("keeps all 121 ids unique", async () => {
		const parsed = parseStandardTemplateMarkdown(await markdown());

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const ids = [
			...parsed.coreTemplates.map((entry: RawEntry) => entry.id),
			...parsed.optionalClauses.map((entry: RawEntry) => entry.id),
		];
		expect(ids).toHaveLength(121);
		expect(new Set(ids).size).toBe(121);
	});

	it("is read the same way whatever line endings the checkout uses", async () => {
		const source = await markdown();
		const lf = parseStandardTemplateMarkdown(source.replaceAll("\r\n", "\n"));
		const crlf = parseStandardTemplateMarkdown(source.replaceAll("\n", "\r\n"));
		const cr = parseStandardTemplateMarkdown(source.replaceAll("\n", "\r"));
		const bom = parseStandardTemplateMarkdown(`\uFEFF${source}`);

		expect(lf.ok).toBe(true);
		expect(JSON.stringify(crlf)).toBe(JSON.stringify(lf));
		expect(JSON.stringify(cr)).toBe(JSON.stringify(lf));
		expect(JSON.stringify(bom)).toBe(JSON.stringify(lf));
	});

	it("takes bodies verbatim and never reflows or trims them", () => {
		const parsed = parseStandardTemplateMarkdown(
			document({
				entries: ["## core classification-01\nfamily: classification\n\n{{noun}} の 一種 、また。"],
			}),
		);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.coreTemplates[0]?.text).toBe("{{noun}} の 一種 、また。");
	});
});

describe("the standard template document validator", () => {
	it.each([
		["a duplicate core id", ["## core classification-01\nfamily: classification\n\n{{noun}}。", "## core classification-01\nfamily: classification\n\n{{place}}。"], "duplicate-template-id"],
		["an unknown family", ["## core classification-01\nfamily: mystery\n\n{{noun}}。"], "invalid-family"],
		["an unknown placeholder", ["## core classification-01\nfamily: classification\n\n{{animal}}。"], "unknown-placeholder"],
		["an unclosed placeholder", ["## core classification-01\nfamily: classification\n\n{{nounの一種。"], "unclosed-placeholder"],
		["an empty placeholder", ["## core classification-01\nfamily: classification\n\n{{}}の一種。"], "empty-placeholder"],
		["an invalid id", ["## core Classification-01\nfamily: classification\n\n{{noun}}。"], "invalid-id"],
		["an invalid Optional Clause category", ["## core classification-01\nfamily: classification\n\n{{noun}}。", "## clause optional-x-01\ncategory: mystery\n\nそうである。"], "invalid-optional-category"],
		["a clause id colliding with a core id", ["## core etymology-01\nfamily: etymology\n\n{{noun}}。", "## clause etymology-01\ncategory: etymology\n\nそうである。"], "duplicate-clause-id"],
	])("refuses %s at generation time", async (_name, entries, code) => {
		await expect(
			generateStandardTemplates({ rootDir: process.cwd(), markdown: document({ entries }) }),
		).rejects.toThrow(new RegExp(code, "u"));
	});

	it.each([
		["a missing schema version", { schema: null }, "missing-metadata"],
		["a missing data version", { data: null }, "missing-metadata"],
		["a duplicate data version", { extra: "data-version: 2" }, "duplicate-metadata"],
		["a non-numeric data version", { data: "one" }, "invalid-metadata"],
		["an unknown metadata key", { extra: "author: someone" }, "unknown-metadata"],
		["a future schema version", { schema: "2" }, "unsupported-schema-version"],
		["content outside any entry", { extra: "just some prose" }, "orphan-content"],
	])("refuses %s", (_name, options, code) => {
		expect(codesOf(document(options))).toContain(code);
	});

	it.each([
		["zero", "0"],
		["a negative-looking value", "-1"],
		["a leading zero", "007"],
		["one past the safe integer range", "9007199254740993"],
		// Long enough that Number() returns Infinity rather than a number.
		["a value too large to represent", "9".repeat(400)],
		["a decimal", "1.0"],
		["a value with an exponent", "1e3"],
	])("refuses %s as a version, because the conversion would lose information", (_name, value) => {
		// The data version becomes STANDARD_TEMPLATE_SET_VERSION, which keys every
		// definition. A silently rounded or infinite version would key them to
		// something the document never said, and Infinity breaks the canonical
		// hash outright.
		expect(codesOf(document({ data: value }))).toContain("invalid-metadata");
		expect(codesOf(document({ schema: value }))).toContain("invalid-metadata");
	});

	it("accepts an ordinary version and keeps its exact value", () => {
		const parsed = parseStandardTemplateMarkdown(document({ data: "9007199254740991" }));

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.dataVersion).toBe(Number.MAX_SAFE_INTEGER);
		expect(Number.isSafeInteger(parsed.dataVersion)).toBe(true);
	});

	it.each([
		["an unknown field", "## core classification-01\nfamily: classification\nweight: 3\n\n{{noun}}。", "unknown-field"],
		["a duplicate field", "## core classification-01\nfamily: classification\nfamily: instrument\n\n{{noun}}。", "duplicate-field"],
		["a missing field", "## core classification-01\n\n{{noun}}。", "missing-field"],
		["a missing body", "## core classification-01\nfamily: classification", "missing-body"],
		["a second body line", "## core classification-01\nfamily: classification\n\n{{noun}}。\nもう一行。", "duplicate-body"],
		["a body with stray whitespace", "## core classification-01\nfamily: classification\n\n {{noun}}。", "body-whitespace"],
		["an unknown entry kind", "## macro classification-01\nfamily: classification\n\n{{noun}}。", "unknown-entry-kind"],
	])("refuses %s", (_name, entry, code) => {
		expect(codesOf(document({ entries: [entry] }))).toContain(code);
	});

	it("refuses a heading it does not recognise and an empty document", () => {
		expect(codesOf(document({ extra: "### section" }))).toContain("unknown-heading");
		expect(codesOf("")).toContain("no-entries");
	});

	it("reports every problem in document order rather than only the first", () => {
		const codes = codesOf(
			document({
				entries: [
					"## core classification-01\nweight: 3\n\n{{noun}}。",
					"## clause optional-usage-01\ncategory: usage\n\nそうである。\n余分な行。",
				],
			}),
		);

		expect(codes).toEqual([
			"unknown-field",
			"missing-field",
			"duplicate-body",
		]);
	});

	it("names the offending entry without leaking a path or note text", () => {
		const parsed = parseStandardTemplateMarkdown(
			document({ entries: ["## core classification-01\nfamily: classification"] }),
		);

		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		const described = describeTemplateSourceIssues(parsed.issues);
		expect(described).toBe("missing-body (line 6): classification-01");
		expect(described).not.toMatch(/\//u);
	});

	it("still refuses a document the structural parser accepts but the compiler does not", async () => {
		// The Markdown parser is not a second, weaker gate: everything it
		// produces is compiled by the product's own validator before a line of
		// generated data exists.
		const source = document({
			entries: ["## core classification-01\nfamily: classification\n\n{{animal}}の一種。"],
		});
		expect(parseStandardTemplateMarkdown(source).ok).toBe(true);
		await expect(
			generateStandardTemplates({ rootDir: process.cwd(), markdown: source }),
		).rejects.toThrow(/does not compile/u);
	});
});

describe("the generated template module", () => {
	it("carries the document's schema and data versions", () => {
		expect(STANDARD_TEMPLATE_SCHEMA_VERSION).toBe(TEMPLATE_SCHEMA_VERSION);
		expect(STANDARD_TEMPLATE_DATA_VERSION).toBe(1);
		expect(STANDARD_TEMPLATE_SET_VERSION).toBe(STANDARD_TEMPLATE_DATA_VERSION);
		expect(STANDARD_TEMPLATE_SET.version).toBe(1);
	});

	it("is exactly what the document implies, so stale data cannot be bundled", async () => {
		const { source } = await generateStandardTemplates({ rootDir: process.cwd() });
		const onDisk = await readFile(STANDARD_TEMPLATES_GENERATED, "utf8");

		expect(onDisk).toBe(source);
		await expect(
			assertStandardTemplatesGenerated({ rootDir: process.cwd() }),
		).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
	});

	it("says how to refresh itself when a hand edit makes it stale", async () => {
		const { parsed } = await generateStandardTemplates({ rootDir: process.cwd() });
		const edited = renderGeneratedTemplateModule({
			...parsed,
			coreTemplates: parsed.coreTemplates.slice(0, 89),
		});
		const onDisk = await readFile(STANDARD_TEMPLATES_GENERATED, "utf8");

		expect(edited).not.toBe(onDisk);
		expect(onDisk).toContain(GENERATE_COMMAND);
		expect(onDisk.startsWith(`// Generated from ${STANDARD_TEMPLATES_MARKDOWN}.`)).toBe(true);
	});

	it("renders byte-identical output every time", async () => {
		const first = await generateStandardTemplates({ rootDir: process.cwd() });
		const second = await generateStandardTemplates({ rootDir: process.cwd() });

		expect(second.source).toBe(first.source);
		// No timestamp, absolute path or random value can vary between runs.
		expect(first.source).not.toMatch(/\d{4}-\d{2}-\d{2}|[A-Za-z]:\\|\/Users\/|\/home\//u);
	});

	it("refuses a missing document instead of falling back to what is on disk", async () => {
		await expect(
			generateStandardTemplates({ rootDir: "/nonexistent-semantropy-root" }),
		).rejects.toThrow(/missing or unreadable/u);
	});

	it("accepts a CRLF checkout of the same module and still catches a real edit", async () => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-template-eol-"));
		try {
			const { source } = await generateStandardTemplates({ rootDir: process.cwd() });
			const crlf = path.join(scratch, "crlf.ts");
			const edited = path.join(scratch, "edited.ts");
			await writeFile(crlf, source.replaceAll("\n", "\r\n"), "utf8");
			await writeFile(
				edited,
				source.replace("classification-01", "classification-99").replaceAll("\n", "\r\n"),
				"utf8",
			);

			// Line endings are presentation: a Windows checkout is not stale.
			await expect(
				assertStandardTemplatesGenerated({ rootDir: process.cwd(), generatedPath: crlf }),
			).resolves.toEqual({ schemaVersion: 1, dataVersion: 1 });
			// Normalising them does not blunt the check itself.
			await expect(
				assertStandardTemplatesGenerated({ rootDir: process.cwd(), generatedPath: edited }),
			).rejects.toThrow(/does not match/u);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("pins LF for the generated module and the document", async () => {
		const attributes = await readFile(".gitattributes", "utf8");

		expect(attributes).toMatch(/src\/dictionary\/generated\/\*\.ts\s+text eol=lf/u);
		expect(attributes).toMatch(/standard-templates\.md\s+text eol=lf/u);
	});

	it("replaces the generated module atomically and leaves no staging file", async () => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-template-write-"));
		try {
			const outfile = path.join(scratch, "standardTemplateEntries.ts");
			const previous = "// the module that must survive a refused document\n";
			await writeFile(outfile, previous, "utf8");

			// A refused document must not touch the destination at all.
			await expect(
				generateStandardTemplates({
					rootDir: process.cwd(),
					markdown: "nothing here is a template",
				}),
			).rejects.toThrow(/not a valid template document/u);
			expect(await readFile(outfile, "utf8")).toBe(previous);

			const written = await writeStandardTemplates({
				rootDir: process.cwd(),
				generatedPath: outfile,
			});
			const { source } = await generateStandardTemplates({ rootDir: process.cwd() });
			expect(written.coreTemplates).toBe(90);
			expect(await readFile(outfile, "utf8")).toBe(source);
			// The sibling the write staged through is gone once it succeeded.
			expect(await readdir(scratch)).toEqual(["standardTemplateEntries.ts"]);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});
});

describe("the bundle-time guard", () => {
	/** Captures what the plugin registers, without running a real build. */
	function register() {
		const hooks: {
			start: (() => Promise<{ errors?: { text: string }[] } | null>)[];
			load: {
				filter: RegExp;
				callback: (args: { path: string }) => Promise<{
					contents: string;
					loader: string;
					watchFiles: string[];
				} | null>;
			}[];
		} = { start: [], load: [] };
		standardTemplatesPlugin(process.cwd()).setup({
			onStart: (callback: (typeof hooks.start)[number]) => hooks.start.push(callback),
			onLoad: (
				options: { filter: RegExp },
				callback: (typeof hooks.load)[number]["callback"],
			) => hooks.load.push({ filter: options.filter, callback }),
		});
		return hooks;
	}

	it("re-checks the document on every build, which is what a watch rebuild runs", async () => {
		const hooks = register();

		// One onStart hook, so the check is not tied to the first build only.
		expect(hooks.start).toHaveLength(1);
		expect(await hooks.start[0]!()).toBeNull();
	});

	it("reports a refused document as a build error rather than throwing past esbuild", async () => {
		const hooks: { start: (() => Promise<{ errors?: { text: string }[] } | null>)[] } = {
			start: [],
		};
		standardTemplatesPlugin("/nonexistent-semantropy-root").setup({
			onStart: (callback: (typeof hooks.start)[number]) => hooks.start.push(callback),
			onLoad: () => undefined,
		});

		const result = await hooks.start[0]!();
		expect(result?.errors?.[0]?.text).toMatch(/missing or unreadable/u);
	});

	it("makes the document a watch input, so editing it triggers a rebuild", async () => {
		const hooks = register();
		expect(hooks.load).toHaveLength(1);
		const { filter, callback } = hooks.load[0]!;
		// esbuild compiles filters with Go's regexp engine, which rejects `u`.
		expect(filter.flags).not.toContain("u");
		expect(filter.test(STANDARD_TEMPLATES_GENERATED)).toBe(true);

		const generated = path.resolve(process.cwd(), STANDARD_TEMPLATES_GENERATED);
		const loaded = await callback({ path: generated });
		expect(loaded?.loader).toBe("ts");
		expect(loaded?.watchFiles).toEqual([
			path.resolve(process.cwd(), STANDARD_TEMPLATES_MARKDOWN),
		]);
		expect(loaded?.contents).toBe(await readFile(generated, "utf8"));

		// It claims no other file.
		expect(await callback({ path: path.resolve("src/dictionary/template.ts") })).toBeNull();
	});
});

describe("the migrated template set equals the one it replaces", () => {
	it("keeps all 121 raw entries, their order, family, category and wording", () => {
		expect(STANDARD_CORE_TEMPLATES.map((entry) => ({ ...entry }))).toEqual(
			BASELINE.raw.coreTemplates,
		);
		expect(STANDARD_OPTIONAL_CLAUSES.map((entry) => ({ ...entry }))).toEqual(
			BASELINE.raw.optionalClauses,
		);
	});

	it("keeps every compiled segment list and required placeholder list", () => {
		expect(
			STANDARD_TEMPLATE_SET.coreTemplates.map((entry) => ({
				id: entry.id,
				family: entry.family,
				segments: entry.segments,
				requiredPlaceholders: entry.requiredPlaceholders,
			})),
		).toEqual(BASELINE.compiled.coreTemplates);
		expect(
			STANDARD_TEMPLATE_SET.optionalClauses.map((entry) => ({
				id: entry.id,
				category: entry.category,
				segments: entry.segments,
				requiredPlaceholders: entry.requiredPlaceholders,
			})),
		).toEqual(BASELINE.compiled.optionalClauses);
		expect(STANDARD_TEMPLATE_SET.version).toBe(BASELINE.compiled.version);
	});

	it("generates the same definition for every recorded headword, pool, value and nonce", () => {
		expect(BASELINE.definitions.length).toBe(180);
		const outcomes = new Set<string>();
		for (const recorded of BASELINE.definitions) {
			const headword = BASELINE.headwords.find(
				(entry) => entry.surface === recorded.headword,
			);
			expect(headword).toBeDefined();
			if (!headword) return;
			const result = generateFakeDefinition({
				headword,
				pool: BASELINE.pools[recorded.pool]!,
				dictionarySeed: recorded.dictionarySeed,
				dictionarySemantropy: recorded.dictionarySemantropy,
			});
			outcomes.add(result.outcome);
			expect(result).toEqual(recorded.result);
		}
		// Off, generated and insufficient-vocabulary are all exercised, so the
		// comparison is not only over the easy path.
		expect([...outcomes].sort()).toEqual([
			"generated",
			"insufficient-vocabulary",
			"off",
		]);
	});

	it("leaves the algorithm and template set versions where they were", () => {
		expect(FAKE_DICTIONARY_ALGORITHM_VERSION).toBe(1);
		expect(STANDARD_TEMPLATE_SET_VERSION).toBe(1);
		for (const recorded of BASELINE.definitions) {
			if (recorded.result.outcome !== "generated") continue;
			expect(recorded.result.templateSetVersion).toBe(1);
			expect(recorded.result.algorithmVersion).toBe(1);
		}
	});
});

describe("the template source stays out of the plugin", () => {
	it("keeps the parser, node:fs and the document itself off the runtime graph", async () => {
		for (const entryPoint of ["src/main.ts", "src/SemantropyPlugin.ts"]) {
			const result = await build({
				entryPoints: [entryPoint],
				bundle: true,
				write: false,
				metafile: true,
				platform: "neutral",
				format: "esm",
				external: ["obsidian", "virtual:semantropy-lindera-*"],
				legalComments: "none",
			});
			const inputs = Object.keys(result.metafile.inputs);

			expect(inputs).toContain(STANDARD_TEMPLATES_GENERATED);
			for (const name of inputs) {
				expect(name).not.toMatch(/scripts\/|\.md$|resources\//u);
			}
			const code = result.outputFiles[0]!.text;
			expect(code).not.toMatch(
				/node:fs|readFile\(|standard-templates\.md|parseStandardTemplateMarkdown/u,
			);
			// The one wording oracle is the document; its text ships as data.
			expect(code).toContain("classification-01");
		}
	});

	it("does not let the generated module import anything back from the generator", async () => {
		const generated = await readFile(STANDARD_TEMPLATES_GENERATED, "utf8");
		const schema = await readFile("src/dictionary/templateData.ts", "utf8");

		expect(generated).not.toMatch(/scripts\/|node:|esbuild/u);
		// The generator loads this schema to validate entries, so it must never
		// import the entries it validates. Prose may name them; code may not.
		const statements = schema.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
		expect(statements).not.toMatch(/\bimport\b|\brequire\b/u);
		expect(statements).not.toMatch(/STANDARD_CORE_TEMPLATES|STANDARD_OPTIONAL_CLAUSES/u);
	});
});

// HOVER-DICT1 uses eagerly prepared immutable pools. Pin that path to the same historical outputs.
it("rejects mutations of cached prepared pools without changing subsequent definitions", () => {
 const pools = Object.fromEntries(Object.entries(BASELINE.pools).map(([name, pool]) => [name,
  Object.freeze(Object.fromEntries(Object.entries(pool).map(([key, surfaces]) => [key, Object.freeze([...surfaces])]))) as DictionaryVocabularyPool]));
 for (const pool of Object.values(pools)) {
  const prepared = prepareFakeDictionaryGeneration(pool);
  expect(Reflect.set(prepared, "families", [])).toBe(false);
  expect(Reflect.set(prepared, "clauses", [])).toBe(false);
  expect(Reflect.set(prepared, "missing", [])).toBe(false);
  const arrays = [prepared.families, prepared.clauses, prepared.missing];
  for (const family of prepared.families) {
   expect(Object.isFrozen(family)).toBe(true);
   expect(Reflect.set(family, "family", "corrupted")).toBe(false);
   expect(Reflect.set(family, "templates", [])).toBe(false);
   expect(Object.isFrozen(family.templates)).toBe(true);
   expect(() => { Reflect.apply(Array.prototype.splice, family.templates, [0]); }).toThrow(TypeError);
  }
  for (const array of arrays) {
   expect(Object.isFrozen(array)).toBe(true);
   expect(() => { Reflect.apply(Array.prototype.splice, array, [0]); }).toThrow(TypeError);
  }
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(prepareFakeDictionaryGeneration(pool)).toBe(prepared);
 }
 // Compare with the independent, pinned oracle after every attempted mutation,
 // including all Semantropy buckets, optional clauses and insufficient pools.
 for (const item of BASELINE.definitions) {
  const headword = BASELINE.headwords.find(headword => headword.surface === item.headword)!;
  expect(generateFakeDefinition({ headword, pool: pools[item.pool]!, dictionarySeed: item.dictionarySeed, dictionarySemantropy: item.dictionarySemantropy })).toEqual(item.result);
 }
});

it("keeps all 180 definitions identical with immutable prepared pool memoization", () => {
 const pools = Object.fromEntries(Object.entries(BASELINE.pools).map(([name, pool]) => [name,
  Object.freeze(Object.fromEntries(Object.entries(pool).map(([key, surfaces]) => [key, Object.freeze([...surfaces])]))) as DictionaryVocabularyPool]));
 for (const item of BASELINE.definitions) {
  const headword = BASELINE.headwords.find(headword => headword.surface === item.headword)!;
  expect(generateFakeDefinition({ headword, pool: pools[item.pool]!, dictionarySeed: item.dictionarySeed, dictionarySemantropy: item.dictionarySemantropy })).toEqual(item.result);
 }
});
