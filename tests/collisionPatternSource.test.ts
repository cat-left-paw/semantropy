import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, context as esbuildContext, type Plugin } from "esbuild";
import { describe, expect, it } from "vitest";
import {
	COLLISION_PATTERN_SCHEMA_VERSION,
	GENERATE_COMMAND,
	STANDARD_COLLISION_PATTERNS_GENERATED,
	STANDARD_COLLISION_PATTERNS_LOCK,
	STANDARD_COLLISION_PATTERNS_MARKDOWN,
	assertStandardCollisionPatternsGenerated,
	collisionPatternDataDigest,
	describeCollisionSourceIssues,
	generateStandardCollisionPatterns,
	parseStandardCollisionPatternMarkdown,
	renderGeneratedCollisionPatternModule,
	standardCollisionPatternsPlugin,
	writeStandardCollisionPatterns,
} from "../scripts/collision/standardPatterns.mjs";
import {
	compileCollisionPatternSet,
	inspectCollisionLiteral,
	type CompiledCollisionPatternSet,
	type CompileCollisionPatternSetInput,
} from "../src/collision/compilePatternSet";
import {
	COLLISION_MODIFIER_FORMS,
	COLLISION_PART_KINDS,
	type RawCollisionRecipe,
} from "../src/collision/patternData";
import {
	STANDARD_COLLISION_CONNECTORS,
	STANDARD_COLLISION_MODIFIER_FORMS,
	STANDARD_COLLISION_NOUN_SUFFIXES,
	STANDARD_COLLISION_PATTERN_DATA_DIGEST,
	STANDARD_COLLISION_PATTERN_DATA_VERSION,
	STANDARD_COLLISION_PATTERN_SCHEMA_VERSION,
	STANDARD_COLLISION_LITERALS,
	STANDARD_COLLISION_RECIPES,
} from "../src/collision/generated/standardCollisionPatternEntries";
import { readPinnedFixture } from "./support/pinnedFixture";

type PatternLock = { versions: { dataVersion: number; digest: string }[] };

type Fixture = {
	schemaVersion: number;
	dataVersion: number;
	recipes: typeof STANDARD_COLLISION_RECIPES;
	literals: typeof STANDARD_COLLISION_LITERALS;
	connectors: typeof STANDARD_COLLISION_CONNECTORS;
	modifierForms: typeof STANDARD_COLLISION_MODIFIER_FORMS;
	nounSuffixes: typeof STANDARD_COLLISION_NOUN_SUFFIXES;
};

const BASELINE = readPinnedFixture<Fixture>(
	"collisionPatterns",
	"4667d84a47110ffa35b5d61c883c2443be10d6b2e04ddb15f50382c98bc964c8",
);

const markdown = async () => await readFile(STANDARD_COLLISION_PATTERNS_MARKDOWN, "utf8");
// Synthetic Schema 2 data starts at version 1 only in isolated bootstrap tests.
const firstGenerationMarkdown = async () => (await markdown()).replace("data-version: 2", "data-version: 1");
const MEITA_SUFFIX = "\n## noun-suffix noun-meita\nweight: 2\n\nめいた\n";
const ARRAYS_EXPORT = "export const STANDARD_COLLISION_RECIPES";

async function isolatedWritePaths(
	label: string,
	options: { copyLock?: boolean } = {},
): Promise<{ scratch: string; outfile: string; lockPath: string }> {
	const scratch = await mkdtemp(path.join(tmpdir(), `semantropy-collision-${label}-`));
	const lockPath = path.join(scratch, "standard-patterns.lock.json");
	if (options.copyLock !== false) {
		await copyFile(STANDARD_COLLISION_PATTERNS_LOCK, lockPath);
	}
	return {
		scratch,
		outfile: path.join(scratch, "standardCollisionPatternEntries.ts"),
		lockPath,
	};
}

function interruptLockThenRollback(): {
	beforePublish: (phase: "generated" | "lock") => void;
	beforeRollback: () => void;
} {
	return {
		beforePublish: (phase) => {
			if (phase === "lock") {
				throw new Error("injected lock failure");
			}
		},
		beforeRollback: () => {
			throw new Error("injected rollback failure");
		},
	};
}

function expectRollbackFailed(error: unknown, publication: string, rollback: string): void {
	expectAggregatedFailure(error, "rollback-failed", [publication, rollback]);
}

function expectAggregatedFailure(
	error: unknown,
	token: string,
	messages: readonly string[],
): void {
	expect(error).toBeInstanceOf(AggregateError);
	const aggregate = error as AggregateError;
	expect(aggregate.message).toMatch(new RegExp(token, "u"));
	expect(aggregate.message).toMatch(/version lock is unchanged/u);
	expect(
		aggregate.errors.map((entry) => (entry instanceof Error ? entry.message : String(entry))),
	).toEqual([...messages]);
}

function expectAggregatedFailureContains(
	error: unknown,
	token: string,
	messages: readonly string[],
): void {
	expect(error).toBeInstanceOf(AggregateError);
	const aggregate = error as AggregateError;
	expect(aggregate.message).toMatch(new RegExp(token, "u"));
	expect(aggregate.message).toMatch(/version lock is unchanged/u);
	const actual = aggregate.errors.map((entry) =>
		entry instanceof Error ? entry.message : String(entry),
	);
	for (const message of messages) {
		expect(actual).toContain(message);
	}
}

function failLockStagingCleanup(filePath: string): void {
	if (filePath.endsWith("standard-patterns.lock.json.generating")) {
		throw new Error("injected cleanup failure");
	}
}

function injectedFsError(code: string): NodeJS.ErrnoException {
	const error = new Error(`injected ${code}`) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

function readTextWithFailures(
	failures: ReadonlyMap<string, NodeJS.ErrnoException>,
): (filePath: string) => Promise<string> {
	return async (filePath) => {
		const failure = failures.get(filePath);
		if (failure !== undefined) {
			throw failure;
		}
		return await readFile(filePath, "utf8");
	};
}

async function expectNoGeneratingFiles(scratch: string): Promise<void> {
	expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual([]);
}

function expectUnreadableFailure(error: unknown, label: string, code: string): void {
	expect(error).toBeInstanceOf(Error);
	const failure = error as Error;
	expect(failure.message).toContain(`${label} is unreadable (${code})`);
	expect(failure.message).not.toMatch(/is missing/u);
	expect(failure.message).not.toContain(GENERATE_COMMAND);
	expect((failure as { cause?: unknown }).cause).toMatchObject({
		code,
		message: `injected ${code}`,
	});
}

/** A document built from parts, so one rule at a time can be broken. */
function document(
	options: {
		schema?: string | null;
		data?: string | null;
		entries?: readonly string[];
		extra?: string;
	} = {},
): string {
	const lines = ["# Collision patterns", ""];
	if (options.schema !== null) lines.push(`schema-version: ${options.schema ?? "2"}`);
	if (options.data !== null) lines.push(`data-version: ${options.data ?? "2"}`);
	if (options.extra !== undefined) lines.push(options.extra);
	lines.push("");
	for (const entry of options.entries ?? [
		"## recipe noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 100",
	]) {
		lines.push(entry, "");
	}
	const entriesText = lines.join("\n");
	if (!entriesText.includes("## recipe ")) lines.push("## recipe test-recipe\nlabel: Test\nenabled: true\nselectable: true\nweight: 1\npart: noun n1 required", "");
	if (!entriesText.includes("## connector ")) lines.push("## connector empty\nform: empty\nweight: 1", "");
	if (!entriesText.includes("## modifier-form ")) {
		for (const form of COLLISION_MODIFIER_FORMS) lines.push(`## modifier-form ${form.class}-${form.variant}\nclass: ${form.class}\nvariant: ${form.variant}\nweight: 1`, "");
	}
	if (!entriesText.includes("## noun-suffix ")) lines.push("## noun-suffix noun-no\nweight: 1\n\nの", "");
	return lines.join("\n");
}

const codesOf = (source: string): readonly string[] => {
	const parsed = parseStandardCollisionPatternMarkdown(source);
	return parsed.ok ? [] : parsed.issues.map((entry: { code: string }) => entry.code);
};

async function copyPatternTree(scratch: string): Promise<void> {
	const files = [
		STANDARD_COLLISION_PATTERNS_MARKDOWN,
		STANDARD_COLLISION_PATTERNS_LOCK,
		STANDARD_COLLISION_PATTERNS_GENERATED,
		"src/collision/compilePatternSet.ts",
		"src/collision/patternData.ts",
		"src/main.ts",
	];
	for (const relative of files) {
		await mkdir(path.join(scratch, path.dirname(relative)), { recursive: true });
		await copyFile(relative, path.join(scratch, relative));
	}
}

async function expectRebuildToRefuse(
	buildContext: Awaited<ReturnType<typeof esbuildContext>>,
): Promise<void> {
	const pattern = new RegExp(GENERATE_COMMAND.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u");
	try {
		const result = await buildContext.rebuild();
		expect((result.errors ?? []).map((entry) => entry.text).join("\n")).toMatch(pattern);
	} catch (error) {
		expect(String(error)).toMatch(pattern);
	}
}

describe("the standard Collision pattern document", () => {
	it("parses every initial entry in document order with the recorded weights", async () => {
		const parsed = parseStandardCollisionPatternMarkdown(await markdown());

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.schemaVersion).toBe(COLLISION_PATTERN_SCHEMA_VERSION);
		expect(parsed.dataVersion).toBe(2);
		expect(parsed.recipes).toEqual(BASELINE.recipes);
		expect(parsed.literals).toEqual(BASELINE.literals);
		expect(parsed.connectors).toEqual(BASELINE.connectors);
		expect(parsed.modifierForms).toEqual(BASELINE.modifierForms);
		expect(parsed.nounSuffixes).toEqual(BASELINE.nounSuffixes);
		expect(parsed.recipes).toHaveLength(9);
		expect(parsed.literals).toHaveLength(7);
		expect(parsed.connectors).toHaveLength(20);
		expect(parsed.modifierForms).toHaveLength(10);
		expect(parsed.nounSuffixes).toHaveLength(6);
	});

	it("keeps 化した and 化された as noun suffixes, and has no sahen passive form", async () => {
		const parsed = parseStandardCollisionPatternMarkdown(await markdown());

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.nounSuffixes.map((entry) => entry.literal)).toEqual([
			"の",
			"的な",
			"のような",
			"っぽい",
			"化した",
			"化された",
		]);
		expect(
			parsed.modifierForms.map((entry) => `${entry.class}/${entry.variant}`),
		).not.toContain("sahen/passive");
		const allowlistedVariants: readonly string[] = COLLISION_MODIFIER_FORMS.map(
			(entry) => entry.variant,
		);
		expect(allowlistedVariants).not.toContain("passive");
	});

	it("keeps all 52 ids unique across kinds", async () => {
		const parsed = parseStandardCollisionPatternMarkdown(await markdown());

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const ids = [
			...parsed.recipes.map((entry) => entry.id),
			...parsed.literals.map((entry) => entry.id),
			...parsed.connectors.map((entry) => entry.id),
			...parsed.modifierForms.map((entry) => entry.id),
			...parsed.nounSuffixes.map((entry) => entry.id),
		];
		expect(ids).toHaveLength(52);
		expect(new Set(ids).size).toBe(52);
	});

	it("is read the same way whatever line endings the checkout uses", async () => {
		const source = await markdown();
		const lf = parseStandardCollisionPatternMarkdown(source.replaceAll("\r\n", "\n"));
		const crlf = parseStandardCollisionPatternMarkdown(source.replaceAll("\n", "\r\n"));
		const cr = parseStandardCollisionPatternMarkdown(source.replaceAll("\n", "\r"));
		const bom = parseStandardCollisionPatternMarkdown(`\uFEFF${source}`);

		expect(lf.ok).toBe(true);
		expect(JSON.stringify(crlf)).toBe(JSON.stringify(lf));
		expect(JSON.stringify(cr)).toBe(JSON.stringify(lf));
		expect(JSON.stringify(bom)).toBe(JSON.stringify(lf));
	});

	it("lets the generated module match the pinned oracle and the on-disk constants", async () => {
		expect(STANDARD_COLLISION_PATTERN_SCHEMA_VERSION).toBe(2);
		expect(STANDARD_COLLISION_PATTERN_DATA_VERSION).toBe(2);
		expect([...STANDARD_COLLISION_RECIPES]).toEqual(BASELINE.recipes);
		expect([...STANDARD_COLLISION_LITERALS]).toEqual(BASELINE.literals);
		expect([...STANDARD_COLLISION_CONNECTORS]).toEqual(BASELINE.connectors);
		expect([...STANDARD_COLLISION_MODIFIER_FORMS]).toEqual(BASELINE.modifierForms);
		expect([...STANDARD_COLLISION_NOUN_SUFFIXES]).toEqual(BASELINE.nounSuffixes);
		expect(STANDARD_COLLISION_PATTERN_DATA_DIGEST).toBe(collisionPatternDataDigest(BASELINE));
		expect((JSON.parse(await readFile(STANDARD_COLLISION_PATTERNS_LOCK, "utf8")) as PatternLock).versions.at(-1)).toEqual({
			dataVersion: 2,
			digest: collisionPatternDataDigest(BASELINE),
		});
		expect(COLLISION_PART_KINDS).toEqual(["noun", "modifier", "connector", "predicate", "literal"]);
	});
});

describe("the standard Collision pattern validator", () => {
	it.each([
		["a missing schema version", { schema: null }, "missing-metadata"],
		["a missing data version", { data: null }, "missing-metadata"],
		["a duplicate data version", { extra: "data-version: 2" }, "duplicate-metadata"],
		["a non-numeric data version", { data: "one" }, "invalid-metadata"],
		["an unknown metadata key", { extra: "author: someone" }, "unknown-metadata"],
		["a future schema version", { schema: "3" }, "unsupported-schema-version"],
		["content outside any entry", { extra: "just some prose" }, "orphan-content"],
	])("refuses %s", (_name, options, code) => {
		expect(codesOf(document(options))).toContain(code);
	});

	it.each([
		["zero", "0"],
		["a negative-looking value", "-1"],
		["a leading zero", "007"],
		["one past the safe integer range", "9007199254740993"],
		["a value too large to represent", "9".repeat(400)],
		["a decimal", "1.0"],
		["a value with an exponent", "1e3"],
	])("refuses %s as a version or weight, because the conversion would lose information", (_name, value) => {
		expect(codesOf(document({ data: value }))).toContain("invalid-metadata");
		expect(codesOf(document({ schema: value }))).toContain("invalid-metadata");
		expect(
			codesOf(
				document({
					entries: [
						`## recipe noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: ${value}`,
					],
				}),
			),
		).toContain("invalid-weight");
	});

	it.each([
		["an unknown field", "## recipe noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nnote: x\nweight: 1", "unknown-field"],
		["a duplicate field", "## recipe noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nlabel: Sahen\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 1", "duplicate-field"],
		["a missing field", "## recipe noun-pair\nweight: 1", "missing-field"],
		["an unknown entry kind", "## macro noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 1", "unknown-entry-kind"],
		["an invalid id", "## recipe NounPair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 1", "invalid-id"],
		["an empty-looking id", "## recipe -noun\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 1", "invalid-id"],
		["a retired shape field", "## recipe noun-pair\nshape: noun-noun\nweight: 1", "unknown-field"],
		["a retired placement entry", "## modifier-profile placement-none\nplacement: middle\nweight: 1", "unknown-entry-kind"],
		["an invalid connector form", "## connector empty\nform: blank\nweight: 1", "invalid-connector-form"],
		["an invalid class", "## modifier-form odd-basic\nclass: adverb\nvariant: basic\nweight: 1", "invalid-class"],
		["an invalid variant", "## modifier-form sahen-passive\nclass: sahen\nvariant: passive\nweight: 1", "invalid-variant"],
		["a forbidden recipe body", "## recipe noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 1\n\nbody", "unexpected-body"],
		["a missing literal body", "## connector no\nform: literal\nweight: 1", "missing-body"],
		["a forbidden empty-connector body", "## connector empty\nform: empty\nweight: 1\n\nの", "unexpected-body"],
		["a second body line", "## noun-suffix noun-no\nweight: 1\n\nの\n的な", "duplicate-body"],
		["a body with stray whitespace", "## noun-suffix noun-no\nweight: 1\n\n の", "body-whitespace"],
		["an empty id heading that is not a heading", "### section", "unknown-heading"],
	])("refuses %s", (_name, entry, code) => {
		expect(
			codesOf(
				typeof entry === "string" && entry.startsWith("###")
					? document({ extra: entry })
					: document({ entries: [entry] }),
			),
		).toContain(code);
	});

	it("refuses duplicate ids, duplicate literals, duplicate shapes, placements and forms", () => {
		expect(
			codesOf(
				document({
					entries: [
						"## recipe noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 1",
						"## recipe noun-pair\nlabel: Sahen\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 1",
					],
				}),
			),
		).toContain("duplicate-id");
		expect(
			codesOf(
				document({
					entries: [
						"## recipe noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 1",
						"## recipe other-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 2",
					],
				}),
			),
		).toContain("duplicate-selectable-label");
		expect(
			codesOf(
				document({
					entries: [
						"## modifier-profile placement-none\nplacement: none\nweight: 1",
						"## modifier-profile placement-none-2\nplacement: none\nweight: 2",
					],
				}),
			),
		).toContain("unknown-entry-kind");
		expect(
			codesOf(
				document({
					entries: [
						"## modifier-form verb-basic\nclass: verb\nvariant: basic\nweight: 1",
						"## modifier-form verb-basic-2\nclass: verb\nvariant: basic\nweight: 2",
					],
				}),
			),
		).toContain("duplicate-modifier-form");
		expect(
			codesOf(
				document({
					entries: [
						"## connector no\nform: literal\nweight: 1\n\nの",
						"## connector no-2\nform: literal\nweight: 2\n\nの",
					],
				}),
			),
		).toContain("duplicate-literal");
		expect(
			codesOf(
				document({
					entries: [
						"## noun-suffix noun-no\nweight: 1\n\nの",
						"## noun-suffix noun-no-2\nweight: 2\n\nの",
					],
				}),
			),
		).toContain("duplicate-literal");
	});

	it.each([
		["a placeholder", "{{noun}}"],
		["a template substitution", "${name}"],
		["a backtick", "化`した"],
		["an NFC-violating sequence", "\u304B\u3099"],
		["a NUL", "化\u0000した"],
		["an ASCII control character", "化\u0007した"],
		["a C1 next-line control", "化\u0085した"],
		["a line separator", "化\u2028した"],
		["a paragraph separator", "化\u2029した"],
		["a right-to-left override", "化\u202Eした"],
		["an isolated surrogate", "化\uD800した"],
		["a JavaScript arrow", "()=>alert(1)"],
		["a regular-expression literal", "/foo/"],
		["a literal longer than 32 code points", "あ".repeat(33)],
	])("refuses %s as a literal", (_name, literal) => {
		const codes = codesOf(
			document({
				entries: [`## noun-suffix noun-x\nweight: 1\n\n${literal}`],
			}),
		);
		expect(codes.some((code) => code === "invalid-literal" || code === "empty-literal")).toBe(
			true,
		);
		expect(inspectCollisionLiteral(literal)).toBe("invalid-literal");
	});

	it.each(["の", "的な", "のような", "っぽい", "化した", "化された", "めいた", "コーヒー"])(
		"accepts the closed Japanese literal %s",
		(literal) => {
			expect(inspectCollisionLiteral(literal)).toBeNull();
		},
	);

	it("names the offending entry without leaking a path or note text", () => {
		const parsed = parseStandardCollisionPatternMarkdown(
			document({ entries: ["## connector no\nform: literal\nweight: 1"] }),
		);

		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		const described = describeCollisionSourceIssues(parsed.issues);
		expect(described).toBe("missing-body (line 6): no");
		expect(described).not.toMatch(/\//u);
	});

	it("reports every problem in document order rather than only the first", () => {
		const codes = codesOf(
			document({
				entries: [
					"## recipe noun-pair\nnote: x\nweight: 1",
					"## noun-suffix noun-no\nweight: 1\n\nの\n的な",
				],
			}),
		);

		expect(codes).toEqual(["unknown-field", "missing-field", "missing-field", "missing-field", "duplicate-body"]);
	});

	it("shares missing required pool validation with the compiler", async () => {
		const source = document({
			entries: [
				"## recipe noun-pair\nlabel: Standard\nenabled: true\nselectable: true\npart: noun n1 required\nweight: 100",
			],
		});
		const incomplete = source.replace(/## modifier-form [\s\S]*?(?=## noun-suffix)/u, "");
		expect(codesOf(incomplete)).toContain("missing-modifier-form");
		await expect(
			generateStandardCollisionPatterns({ rootDir: process.cwd(), markdown: incomplete }),
		).rejects.toThrow(/missing-modifier-form/u);
	});

	it("allows a connector の and a noun-suffix の because they are different kinds", () => {
		const parsed = parseStandardCollisionPatternMarkdown(
			document({
				entries: [
					"## connector empty\nform: empty\nweight: 1",
					"## connector no\nform: literal\nweight: 1\n\nの",
					"## noun-suffix noun-no\nweight: 1\n\nの",
				],
			}),
		);
		expect(parsed.ok).toBe(true);
	});
});

describe("the generated Collision pattern module", () => {
	it("is exactly what the document implies, so stale data cannot be bundled", async () => {
		const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
		const onDisk = await readFile(STANDARD_COLLISION_PATTERNS_GENERATED, "utf8");

		expect(onDisk).toBe(source);
		await expect(
			assertStandardCollisionPatternsGenerated({ rootDir: process.cwd() }),
		).resolves.toEqual({ schemaVersion: 2, dataVersion: 2 });
	});

	it("says how to refresh itself when a hand edit makes it stale", async () => {
		const { parsed } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
		const edited = renderGeneratedCollisionPatternModule({
			...parsed,
			recipes: parsed.recipes.slice(0, 1),
		});
		const onDisk = await readFile(STANDARD_COLLISION_PATTERNS_GENERATED, "utf8");

		expect(edited).not.toBe(onDisk);
		expect(onDisk).toContain(GENERATE_COMMAND);
		expect(onDisk.startsWith(`// Generated from ${STANDARD_COLLISION_PATTERNS_MARKDOWN}.`)).toBe(
			true,
		);
	});

	it("renders byte-identical output every time", async () => {
		const first = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
		const second = await generateStandardCollisionPatterns({ rootDir: process.cwd() });

		expect(second.source).toBe(first.source);
		expect(first.source).not.toMatch(/\d{4}-\d{2}-\d{2}|[A-Za-z]:\\|\/Users\/|\/home\//u);
	});

	it("refuses a missing document instead of falling back to what is on disk", async () => {
		await expect(
			generateStandardCollisionPatterns({ rootDir: "/nonexistent-semantropy-root" }),
		).rejects.toThrow(/is missing/u);
	});

	it("accepts a CRLF checkout of the same module and still catches a real edit", async () => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-collision-eol-"));
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			const crlf = path.join(scratch, "crlf.ts");
			const edited = path.join(scratch, "edited.ts");
			await writeFile(crlf, source.replaceAll("\n", "\r\n"), "utf8");
			await writeFile(
				edited,
				source.replace("noun-pair", "noun-pair-x").replaceAll("\n", "\r\n"),
				"utf8",
			);

			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir: process.cwd(),
					generatedPath: crlf,
				}),
			).resolves.toEqual({ schemaVersion: 2, dataVersion: 2 });
			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir: process.cwd(),
					generatedPath: edited,
				}),
			).rejects.toThrow(/does not match/u);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("pins LF for the generated module, the document and the fixture", async () => {
		const attributes = await readFile(".gitattributes", "utf8");

		expect(attributes).toMatch(/src\/collision\/generated\/\*\.ts\s+text eol=lf/u);
		expect(attributes).toMatch(/standard-patterns\.md\s+text eol=lf/u);
		expect(attributes).toMatch(/standard-patterns\.lock\.json\s+text eol=lf/u);
		expect(attributes).toMatch(/tests\/fixtures\/regression\/\*\.json\s+text eol=lf/u);
	});

	it("replaces the generated module atomically and leaves no staging file", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("write");
		try {
			const previous = "// the module that must survive a refused document\n";
			await writeFile(outfile, previous, "utf8");

			await expect(
				generateStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: "nothing here is a pattern",
				}),
			).rejects.toThrow(/not a valid pattern document/u);
			expect(await readFile(outfile, "utf8")).toBe(previous);

			await rm(outfile);
			const written = await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				generatedPath: outfile,
				lockPath,
			});
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			expect(written.recipes).toBe(9);
			expect(written.nounSuffixes).toBe(6);
			expect(await readFile(outfile, "utf8")).toBe(source);
			expect((await readdir(scratch)).sort()).toEqual(
				["standard-patterns.lock.json", "standardCollisionPatternEntries.ts"].sort(),
			);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("writes the generated module and the version lock together on first generation", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("first-gen", {
			copyLock: false,
		});
		try {
			const { source, parsed } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
			});
			const written = await writeStandardCollisionPatterns({
				rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
				generatedPath: outfile,
				lockPath,
			});
			expect(written.dataVersion).toBe(1);
			expect(await readFile(outfile, "utf8")).toBe(source);
			expect((JSON.parse(await readFile(lockPath, "utf8")) as PatternLock).versions.at(-1)).toEqual({
				dataVersion: 1,
				digest: collisionPatternDataDigest(parsed),
			});
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it.each(["generated", "lock"] as const)(
		"leaves generated and lock byte-unchanged when %s publication fails during a version bump",
		async (phase) => {
			const { scratch, outfile, lockPath } = await isolatedWritePaths(`publish-fail-${phase}`);
			try {
				const { source } = await generateStandardCollisionPatterns({
					rootDir: process.cwd(),
				});
				await writeFile(outfile, source, "utf8");
				const lockBefore = await readFile(lockPath, "utf8");
				const mutated = (await markdown())
					.replace("data-version: 2", "data-version: 3")
					.concat(MEITA_SUFFIX);
				await expect(
					writeStandardCollisionPatterns({
						rootDir: process.cwd(),
						markdown: mutated,
						generatedPath: outfile,
						lockPath,
						beforePublish: (current) => {
							if (current === phase) {
								throw new Error(`injected ${phase} failure`);
							}
						},
					}),
				).rejects.toThrow(new RegExp(`injected ${phase} failure`, "u"));
				expect(await readFile(outfile, "utf8")).toBe(source);
				expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
				expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual(
					[],
				);
			} finally {
				await rm(scratch, { recursive: true, force: true });
			}
		},
	);

	it.each(["generated", "lock"] as const)(
		"removes a new generated module when first-generation %s publication fails",
		async (phase) => {
			const { scratch, outfile, lockPath } = await isolatedWritePaths(
				`first-gen-fail-${phase}`,
				{ copyLock: false },
			);
			try {
				await expect(
					writeStandardCollisionPatterns({
						rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
						generatedPath: outfile,
						lockPath,
						beforePublish: (current) => {
							if (current === phase) {
								throw new Error(`injected ${phase} failure`);
							}
						},
					}),
				).rejects.toThrow(new RegExp(`injected ${phase} failure`, "u"));
				await expect(readFile(outfile, "utf8")).rejects.toThrow(/ENOENT/u);
				await expect(readFile(lockPath, "utf8")).rejects.toThrow(/ENOENT/u);
				expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual(
					[],
				);
			} finally {
				await rm(scratch, { recursive: true, force: true });
			}
		},
	);

	it("reports a rollback failure after lock publication fails and keeps the previous lock", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rollback-fail");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			const mutated = (await markdown())
				.replace("data-version: 2", "data-version: 3")
				.concat(MEITA_SUFFIX);
			const { source: nextSource } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: mutated,
			});
			let caught: unknown;
			try {
				await writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
					...interruptLockThenRollback(),
				});
			} catch (error) {
				caught = error;
			}
			expectRollbackFailed(caught, "injected lock failure", "injected rollback failure");
			expect(await readFile(outfile, "utf8")).toBe(nextSource);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual([]);
			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/does not record the current pattern data/u);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("repairs a leftover generated module by completing the raised data-version", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rollback-repair-v2");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			const mutated = (await markdown())
				.replace("data-version: 2", "data-version: 3")
				.concat(MEITA_SUFFIX);
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
					...interruptLockThenRollback(),
				}),
			).rejects.toBeInstanceOf(AggregateError);
			const parsed = parseStandardCollisionPatternMarkdown(mutated);
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) return;
			const written = await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: mutated,
				generatedPath: outfile,
				lockPath,
			});
			expect(written.dataVersion).toBe(3);
			expect(await readFile(outfile, "utf8")).toContain("めいた");
			expect((JSON.parse(await readFile(lockPath, "utf8")) as PatternLock).versions.at(-1)).toEqual({
				dataVersion: 3,
				digest: collisionPatternDataDigest(parsed),
			});
			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
				}),
			).resolves.toEqual({ schemaVersion: 2, dataVersion: 3 });
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("repairs a leftover generated module by restoring the previous Markdown", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rollback-repair-v1");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			const mutated = (await markdown())
				.replace("data-version: 2", "data-version: 3")
				.concat(MEITA_SUFFIX);
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
					...interruptLockThenRollback(),
				}),
			).rejects.toBeInstanceOf(AggregateError);
			await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				generatedPath: outfile,
				lockPath,
			});
			expect(await readFile(outfile, "utf8")).toBe(source);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir: process.cwd(),
					generatedPath: outfile,
					lockPath,
				}),
			).resolves.toEqual({ schemaVersion: 2, dataVersion: 2 });
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("reports a first-generation removal failure and can be repaired after the leftover module is removed", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("first-gen-rollback-fail", {
			copyLock: false,
		});
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd(), markdown: await firstGenerationMarkdown() });
			let caught: unknown;
			try {
				await writeStandardCollisionPatterns({
					rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
					generatedPath: outfile,
					lockPath,
					...interruptLockThenRollback(),
				});
			} catch (error) {
				caught = error;
			}
			expectRollbackFailed(caught, "injected lock failure", "injected rollback failure");
			expect(await readFile(outfile, "utf8")).toBe(source);
			await expect(readFile(lockPath, "utf8")).rejects.toThrow(/ENOENT/u);
			expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual([]);
			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/standard-patterns\.lock\.json is missing/u);
			await rm(outfile);
			const written = await writeStandardCollisionPatterns({
				rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
				generatedPath: outfile,
				lockPath,
			});
			expect(written.dataVersion).toBe(1);
			expect(await readFile(outfile, "utf8")).toBe(source);
			expect((JSON.parse(await readFile(lockPath, "utf8")) as PatternLock).versions.at(-1)).toEqual({
				dataVersion: 1,
				digest: collisionPatternDataDigest(
					(await generateStandardCollisionPatterns({ rootDir: process.cwd(), markdown: await firstGenerationMarkdown() })).parsed,
				),
			});
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("still rolls generated back when lock publication and staging cleanup both fail", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("cleanup-fail-rollback");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			const mutated = (await markdown())
				.replace("data-version: 2", "data-version: 3")
				.concat(MEITA_SUFFIX);
			let caught: unknown;
			try {
				await writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
					beforePublish: (phase) => {
						if (phase === "lock") {
							throw new Error("injected lock failure");
						}
					},
					beforeCleanup: failLockStagingCleanup,
				});
			} catch (error) {
				caught = error;
			}
			expectAggregatedFailure(caught, "cleanup-failed", [
				"injected lock failure",
				"injected cleanup failure",
			]);
			expect(await readFile(outfile, "utf8")).toBe(source);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual([
				"standard-patterns.lock.json.generating",
			]);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("aggregates lock publication, staging cleanup and generated rollback failures", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("cleanup-and-rollback-fail");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			const mutated = (await markdown())
				.replace("data-version: 2", "data-version: 3")
				.concat(MEITA_SUFFIX);
			const { source: nextSource } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: mutated,
			});
			let caught: unknown;
			try {
				await writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
					...interruptLockThenRollback(),
					beforeCleanup: failLockStagingCleanup,
				});
			} catch (error) {
				caught = error;
			}
			expectAggregatedFailure(caught, "rollback-failed", [
				"injected lock failure",
				"injected cleanup failure",
				"injected rollback failure",
			]);
			expect(await readFile(outfile, "utf8")).toBe(nextSource);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual([
				"standard-patterns.lock.json.generating",
			]);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("aggregates first-generation removal and staging cleanup failures", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("first-gen-cleanup-fail", {
			copyLock: false,
		});
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd(), markdown: await firstGenerationMarkdown() });
			let caught: unknown;
			try {
				await writeStandardCollisionPatterns({
					rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
					generatedPath: outfile,
					lockPath,
					...interruptLockThenRollback(),
					beforeCleanup: failLockStagingCleanup,
				});
			} catch (error) {
				caught = error;
			}
			expectAggregatedFailure(caught, "rollback-failed", [
				"injected lock failure",
				"injected cleanup failure",
				"injected rollback failure",
			]);
			expect(await readFile(outfile, "utf8")).toBe(source);
			await expect(readFile(lockPath, "utf8")).rejects.toThrow(/ENOENT/u);
			expect((await readdir(scratch)).filter((name) => name.endsWith(".generating"))).toEqual([
				"standard-patterns.lock.json.generating",
			]);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("keeps the rollback rename failure when rollback staging cleanup also fails", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rollback-rename-cleanup");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			const mutated = (await markdown())
				.replace("data-version: 2", "data-version: 3")
				.concat(MEITA_SUFFIX);
			const { source: nextSource } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: mutated,
			});
			let caught: unknown;
			try {
				await writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
					beforePublish: (phase) => {
						if (phase === "lock") {
							throw new Error("injected lock failure");
						}
					},
					beforeRollbackRename: () => {
						throw new Error("injected rollback rename failure");
					},
					beforeCleanup: (filePath) => {
						if (filePath.endsWith("standardCollisionPatternEntries.ts.generating")) {
							throw new Error("injected generated staging cleanup failure");
						}
						if (filePath.endsWith("standard-patterns.lock.json.generating")) {
							throw new Error("injected lock staging cleanup failure");
						}
					},
				});
			} catch (error) {
				caught = error;
			}
			expectAggregatedFailureContains(caught, "rollback-failed", [
				"injected lock failure",
				"injected rollback rename failure",
				"injected generated staging cleanup failure",
				"injected lock staging cleanup failure",
			]);
			expect(await readFile(outfile, "utf8")).toBe(nextSource);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/does not record the current pattern data/u);
			const parsed = parseStandardCollisionPatternMarkdown(mutated);
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) return;
			await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: mutated,
				generatedPath: outfile,
				lockPath,
			});
			expect(await readFile(outfile, "utf8")).toContain("めいた");
			expect((JSON.parse(await readFile(lockPath, "utf8")) as PatternLock).versions.at(-1)).toEqual({
				dataVersion: 3,
				digest: collisionPatternDataDigest(parsed),
			});
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("refuses a same-version meaning change and leaves the existing module untouched", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("version");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");

			const mutated = `${await markdown()}${MEITA_SUFFIX}`;
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/data-version-unchanged/u);
			expect(await readFile(outfile, "utf8")).toBe(source);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("restores generated comment, multiline format, array comments and entry hand-edits from the Markdown at the same data-version", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("restore");
		try {
			const { source, parsed } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
			});
			const recipeLine =
				source.slice(source.indexOf(ARRAYS_EXPORT)).split("\n")[1]!.trim();
			const lockBefore = await readFile(lockPath, "utf8");
			await writeFile(outfile, source, "utf8");

			await writeFile(
				outfile,
				source.replace("Do not edit this file.", "hand-edited header comment"),
				"utf8",
			);
			await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				generatedPath: outfile,
				lockPath,
			});
			expect(await readFile(outfile, "utf8")).toBe(source);

			await writeFile(
				outfile,
				source.replace(
					"export const STANDARD_COLLISION_RECIPES: readonly RawCollisionRecipe[] = [",
					"export const STANDARD_COLLISION_RECIPES: readonly RawCollisionRecipe[] = [\n\t// hand-edited array comment",
				),
				"utf8",
			);
			await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				generatedPath: outfile,
				lockPath,
			});
			expect(await readFile(outfile, "utf8")).toBe(source);

			await writeFile(
				outfile,
				source.replace(
					recipeLine,
					recipeLine.replaceAll(', ', ',\n\t\t'),
				),
				"utf8",
			);
			await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				generatedPath: outfile,
				lockPath,
			});
			expect(await readFile(outfile, "utf8")).toBe(source);

			await writeFile(
				outfile,
				source.replace(
					recipeLine,
					recipeLine.replace('noun-pair', 'noun-pair-x'),
				),
				"utf8",
			);
			await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				generatedPath: outfile,
				lockPath,
			});
			expect(await readFile(outfile, "utf8")).toBe(source);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			expect(collisionPatternDataDigest(parsed)).toMatch(/^[0-9a-f]{64}$/u);
			expect(source).toContain(`STANDARD_COLLISION_PATTERN_DATA_DIGEST = "${collisionPatternDataDigest(parsed)}"`);
			expect(source).toContain("STANDARD_COLLISION_PATTERN_DATA_JSON = ");
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("refuses a same-version meaning change when the existing digest line is missing", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("missing-digest");
		try {
			const { source } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
			});
			const withoutDigest = source.replace(
				/^export const STANDARD_COLLISION_PATTERN_DATA_DIGEST = "[0-9a-f]{64}";\n/m,
				"",
			);
			expect(withoutDigest).not.toBe(source);
			await writeFile(outfile, withoutDigest, "utf8");
			const mutated = `${await markdown()}${MEITA_SUFFIX}`;
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/missing-digest/u);
			expect(await readFile(outfile, "utf8")).toBe(withoutDigest);
			expect(await readFile(outfile, "utf8")).not.toContain("めいた");
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("refuses a same-version meaning change when the existing digest is rewritten to the new meaning", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("rewritten-digest");
		try {
			const { source, parsed } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
			});
			const mutated = `${await markdown()}${MEITA_SUFFIX}`;
			const mutatedParsed = parseStandardCollisionPatternMarkdown(mutated);
			expect(mutatedParsed.ok).toBe(true);
			if (!mutatedParsed.ok) return;
			const rewritten = source.replace(
				collisionPatternDataDigest(parsed),
				collisionPatternDataDigest(mutatedParsed),
			);
			expect(rewritten).not.toBe(source);
			await writeFile(outfile, rewritten, "utf8");
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/digest-inconsistent/u);
			expect(await readFile(outfile, "utf8")).toBe(rewritten);
			expect(await readFile(outfile, "utf8")).not.toContain("めいた");
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("refuses a same-version meaning change when payload and digest are rewritten together", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("forged-payload-digest");
		try {
			const { source } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
			});
			const mutated = `${await markdown()}${MEITA_SUFFIX}`;
			const mutatedParsed = parseStandardCollisionPatternMarkdown(mutated);
			expect(mutatedParsed.ok).toBe(true);
			if (!mutatedParsed.ok) return;
			const newCanonical = renderGeneratedCollisionPatternModule(mutatedParsed);
			const forged =
				newCanonical.slice(0, newCanonical.indexOf(ARRAYS_EXPORT)) +
				source.slice(source.indexOf(ARRAYS_EXPORT));
			expect(forged).not.toBe(source);
			expect(forged).toContain(collisionPatternDataDigest(mutatedParsed));
			expect(forged.slice(forged.indexOf(ARRAYS_EXPORT))).not.toContain("めいた");
			await writeFile(outfile, forged, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");

			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/data-version-unchanged/u);
			expect(await readFile(outfile, "utf8")).toBe(forged);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);

			const bumped = mutated.replace("data-version: 2", "data-version: 3");
			const written = await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: bumped,
				generatedPath: outfile,
				lockPath,
			});
			const bumpedParsed = parseStandardCollisionPatternMarkdown(bumped);
			expect(bumpedParsed.ok).toBe(true);
			if (!bumpedParsed.ok) return;
			expect(written.dataVersion).toBe(3);
			expect(written.nounSuffixes).toBe(7);
			expect(await readFile(outfile, "utf8")).toContain("めいた");
			expect((JSON.parse(await readFile(lockPath, "utf8")) as PatternLock).versions.at(-1)).toEqual({
				dataVersion: 3,
				digest: collisionPatternDataDigest(bumpedParsed),
			});
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("does not let a matching generated module bypass a stale version lock", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("stale-lock-assert");
		try {
			const mutated = `${await markdown()}${MEITA_SUFFIX}`;
			const { source: newSource } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: mutated,
			});
			await writeFile(outfile, newSource, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			await expect(
				assertStandardCollisionPatternsGenerated({
					rootDir: process.cwd(),
					markdown: mutated,
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/does not record the current pattern data/u);
			expect(await readFile(outfile, "utf8")).toBe(newSource);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("refuses to regenerate when the version lock is missing", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("missing-lock", {
			copyLock: false,
		});
		try {
			const { source } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
			});
			await writeFile(outfile, source, "utf8");
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/standard-patterns\.lock\.json is missing/u);
			expect(await readFile(outfile, "utf8")).toBe(source);
			await expect(readFile(lockPath, "utf8")).rejects.toThrow();
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it.each(["EACCES", "EISDIR", "EIO"] as const)(
		"refuses a same-version change when generated and lock exist but reading them fails with %s",
		async (code) => {
			const { scratch, outfile, lockPath } = await isolatedWritePaths(
				`unreadable-both-${code.toLowerCase()}`,
			);
			try {
				const { source } = await generateStandardCollisionPatterns({
					rootDir: process.cwd(),
				});
				await writeFile(outfile, source, "utf8");
				const lockBefore = await readFile(lockPath, "utf8");
				const mutated = `${await markdown()}${MEITA_SUFFIX}`;
				const failure = injectedFsError(code);
				await expect(
					writeStandardCollisionPatterns({
						rootDir: process.cwd(),
						markdown: mutated,
						generatedPath: outfile,
						lockPath,
						readText: readTextWithFailures(
							new Map([
								[outfile, failure],
								[lockPath, failure],
							]),
						),
					}),
				).rejects.toMatchObject({ code, message: `injected ${code}` });
				expect(await readFile(outfile, "utf8")).toBe(source);
				expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
				await expectNoGeneratingFiles(scratch);
				await expect(
					writeStandardCollisionPatterns({
						rootDir: process.cwd(),
						markdown: mutated,
						generatedPath: outfile,
						lockPath,
					}),
				).rejects.toThrow(/data-version-unchanged/u);
				expect(await readFile(outfile, "utf8")).toBe(source);
				expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			} finally {
				await rm(scratch, { recursive: true, force: true });
			}
		},
	);

	it.each([
		{
			label: "generated is unreadable",
			failGenerated: true,
			failLock: false,
			writeGenerated: true,
			copyLock: true,
		},
		{
			label: "lock is unreadable",
			failGenerated: false,
			failLock: true,
			writeGenerated: true,
			copyLock: true,
		},
		{
			label: "generated is absent and lock is unreadable",
			failGenerated: false,
			failLock: true,
			writeGenerated: false,
			copyLock: true,
		},
		{
			label: "generated is unreadable and lock is absent",
			failGenerated: true,
			failLock: false,
			writeGenerated: true,
			copyLock: false,
		},
	] as const)("does not treat unreadability as absence when $label", async (scenario) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths(
			`unreadable-${scenario.label.replaceAll(" ", "-")}`,
			{ copyLock: scenario.copyLock },
		);
		try {
			const { source } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
			});
			if (scenario.writeGenerated) {
				await writeFile(outfile, source, "utf8");
			}
			const lockBefore = scenario.copyLock ? await readFile(lockPath, "utf8") : null;
			const failures = new Map<string, NodeJS.ErrnoException>();
			if (scenario.failGenerated) {
				failures.set(outfile, injectedFsError("EACCES"));
			}
			if (scenario.failLock) {
				failures.set(lockPath, injectedFsError("EACCES"));
			}
			let caught: unknown;
			try {
				await writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					markdown: `${await markdown()}${MEITA_SUFFIX}`,
					generatedPath: outfile,
					lockPath,
					readText: readTextWithFailures(failures),
				});
			} catch (error) {
				caught = error;
			}
			expect(caught).toMatchObject({ code: "EACCES", message: "injected EACCES" });
			expect(caught instanceof Error ? caught.message : String(caught)).not.toMatch(
				/is missing/u,
			);
			if (scenario.writeGenerated) {
				expect(await readFile(outfile, "utf8")).toBe(source);
			} else {
				await expect(readFile(outfile, "utf8")).rejects.toThrow(/ENOENT/u);
			}
			if (lockBefore === null) {
				await expect(readFile(lockPath, "utf8")).rejects.toThrow(/ENOENT/u);
			} else {
				expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			}
			await expectNoGeneratingFiles(scratch);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("allows first generation only when both destination reads are ENOENT", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("first-gen-enoent", {
			copyLock: false,
		});
		try {
			const { source, parsed } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
			});
			const written = await writeStandardCollisionPatterns({
				rootDir: process.cwd(), markdown: await firstGenerationMarkdown(),
				generatedPath: outfile,
				lockPath,
				readText: readTextWithFailures(
					new Map([
						[outfile, injectedFsError("ENOENT")],
						[lockPath, injectedFsError("ENOENT")],
					]),
				),
			});
			expect(written.dataVersion).toBe(1);
			expect(await readFile(outfile, "utf8")).toBe(source);
			expect((JSON.parse(await readFile(lockPath, "utf8")) as PatternLock).versions.at(-1)).toEqual({
				dataVersion: 1,
				digest: collisionPatternDataDigest(parsed),
			});
			await expectNoGeneratingFiles(scratch);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it.each(
		(["generated", "lock"] as const).flatMap((which) =>
			(["EACCES", "EISDIR", "EIO"] as const).map((code) => ({ which, code })),
		),
	)(
		"reports an unreadable $which as unreadable rather than missing during assert ($code)",
		async ({ which, code }) => {
			const { scratch, outfile, lockPath } = await isolatedWritePaths(
				`assert-unreadable-${which}-${code.toLowerCase()}`,
			);
			try {
				const { source } = await generateStandardCollisionPatterns({
					rootDir: process.cwd(),
				});
				await writeFile(outfile, source, "utf8");
				const target = which === "generated" ? outfile : lockPath;
				const label =
					which === "generated"
						? STANDARD_COLLISION_PATTERNS_GENERATED
						: STANDARD_COLLISION_PATTERNS_LOCK;
				let caught: unknown;
				try {
					await assertStandardCollisionPatternsGenerated({
						rootDir: process.cwd(),
						generatedPath: outfile,
						lockPath,
						readText: readTextWithFailures(new Map([[target, injectedFsError(code)]])),
					});
				} catch (error) {
					caught = error;
				}
				expectUnreadableFailure(caught, label, code);
			} finally {
				await rm(scratch, { recursive: true, force: true });
			}
		},
	);

	it("refuses a generated module whose digest is missing, malformed, duplicated or inconsistent with its payload", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("digest-closed");
		try {
			const { source } = await generateStandardCollisionPatterns({
				rootDir: process.cwd(),
			});

			const withoutDigest = source.replace(
				/^export const STANDARD_COLLISION_PATTERN_DATA_DIGEST = "[0-9a-f]{64}";\n/m,
				"",
			);
			await writeFile(outfile, withoutDigest, "utf8");
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/missing-digest/u);
			expect(await readFile(outfile, "utf8")).toBe(withoutDigest);

			const malformed = source.replace(
				/STANDARD_COLLISION_PATTERN_DATA_DIGEST = "[0-9a-f]{64}"/u,
				'STANDARD_COLLISION_PATTERN_DATA_DIGEST = "not-a-digest"',
			);
			await writeFile(outfile, malformed, "utf8");
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/malformed-digest/u);
			expect(await readFile(outfile, "utf8")).toBe(malformed);

			const duplicated = source.replace(
				/^export const STANDARD_COLLISION_PATTERN_DATA_DIGEST = "([0-9a-f]{64})";$/m,
				(line) => `${line}\n${line}`,
			);
			await writeFile(outfile, duplicated, "utf8");
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/duplicate-digest/u);
			expect(await readFile(outfile, "utf8")).toBe(duplicated);

			const inconsistent = source.replace('\\"id\\":\\"noun-pair\\"', '\\"id\\":\\"noun-pair-x\\"');
			await writeFile(outfile, inconsistent, "utf8");
			await expect(
				writeStandardCollisionPatterns({
					rootDir: process.cwd(),
					generatedPath: outfile,
					lockPath,
				}),
			).rejects.toThrow(/digest-inconsistent/u);
			expect(await readFile(outfile, "utf8")).toBe(inconsistent);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("reflects a future suffix addition without a TypeScript change when data-version is raised", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("add");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			const mutated = (await markdown())
				.replace("data-version: 2", "data-version: 3")
				.concat(MEITA_SUFFIX);
			const written = await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: mutated,
				generatedPath: outfile,
				lockPath,
			});
			const parsed = parseStandardCollisionPatternMarkdown(mutated);
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) return;
			expect(parsed.nounSuffixes.map((entry) => entry.literal)).toContain("めいた");
			expect(written.nounSuffixes).toBe(7);
			expect(written.dataVersion).toBe(3);
			expect(await readFile(outfile, "utf8")).toContain("めいた");
			expect((JSON.parse(await readFile(lockPath, "utf8")) as PatternLock).versions.at(-1)).toEqual({
				dataVersion: 3,
				digest: collisionPatternDataDigest(parsed),
			});
			expect((await readdir(scratch)).sort()).toEqual(
				["standard-patterns.lock.json", "standardCollisionPatternEntries.ts"].sort(),
			);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("reflects suffix deletion and weight changes when data-version is raised", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("edit");
		try {
			const { source } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
			await writeFile(outfile, source, "utf8");
			let mutated = (await markdown()).replace("data-version: 2", "data-version: 3");
			mutated = mutated.replace(
				"## noun-suffix noun-ka-shita\nweight: 5\n\n化した\n",
				"",
			);
			mutated = mutated.replace(
				"## noun-suffix noun-no\nweight: 30",
				"## noun-suffix noun-no\nweight: 31",
			);
			await writeStandardCollisionPatterns({
				rootDir: process.cwd(),
				markdown: mutated,
				generatedPath: outfile,
				lockPath,
			});
			const parsed = parseStandardCollisionPatternMarkdown(mutated);
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) return;
			expect(parsed.nounSuffixes.map((entry) => entry.literal)).not.toContain("化した");
			expect(parsed.nounSuffixes.find((entry) => entry.id === "noun-no")?.weight).toBe(31);
			const generated = await readFile(outfile, "utf8");
			expect(generated).not.toContain("化した");
			expect(generated).toContain("weight: 31");
			expect((JSON.parse(await readFile(lockPath, "utf8")) as PatternLock).versions.at(-1)).toEqual({
				dataVersion: 3,
				digest: collisionPatternDataDigest(parsed),
			});
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});
});

describe("the compiled Collision pattern set", () => {
	it("deep-freezes every container and stays unchanged after mutation attempts", async () => {
		const { compiled } = await generateStandardCollisionPatterns({ rootDir: process.cwd() });
		const set = compiled as CompiledCollisionPatternSet;

		expect(Object.isFrozen(set)).toBe(true);
		expect(Object.isFrozen(set.recipes)).toBe(true);
		expect(Object.isFrozen(set.recipes[0])).toBe(true);
		expect(Object.isFrozen(set.literals)).toBe(true);
		expect(Object.isFrozen(set.literals[0])).toBe(true);
		expect(Object.isFrozen(set.connectors)).toBe(true);
		expect(Object.isFrozen(set.connectors[0])).toBe(true);
		expect(Object.isFrozen(set.modifierForms)).toBe(true);
		expect(Object.isFrozen(set.modifierForms[0])).toBe(true);
		expect(Object.isFrozen(set.nounSuffixes)).toBe(true);
		expect(Object.isFrozen(set.nounSuffixes[0])).toBe(true);

		expect(Reflect.set(set, "recipes", [])).toBe(false);
		expect(Reflect.set(set.recipes[0]!, "id", "corrupted")).toBe(false);
		expect(() => {
			Reflect.apply(Array.prototype.splice, set.recipes, [0]);
		}).toThrow(TypeError);
		expect(() => {
			Reflect.apply(Array.prototype.splice, set.nounSuffixes, [0]);
		}).toThrow(TypeError);

		expect(set.nounSuffixes.map((entry) => entry.literal)).toEqual(
			BASELINE.nounSuffixes.map((entry) => entry.literal),
		);
		const compiledVariants: readonly string[] = set.modifierForms.map((entry) => entry.variant);
		expect(compiledVariants).not.toContain("passive");
	});

	it("does not freeze caller-owned input arrays", () => {
		const recipes = structuredClone(BASELINE.recipes);
		const result = compileCollisionPatternSet(
			compileInput({
				recipes,
			}),
		);
		expect(result.ok).toBe(true);
		expect(Object.isFrozen(recipes)).toBe(false);
	});

	it.each([
		["a C1 next-line control", "化\u0085した"],
		["a line separator", "化\u2028した"],
		["a paragraph separator", "化\u2029した"],
		["a right-to-left override", "化\u202Eした"],
		["an isolated surrogate", "化\uD800した"],
		["a JavaScript arrow", "()=>alert(1)"],
		["a regular-expression literal", "/foo/"],
	])("refuses %s as a compiled noun-suffix", (_name, literal) => {
		const result = compileCollisionPatternSet(
			compileInput({
				nounSuffixes: [{ id: "noun-x", weight: 1, literal }],
			}),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.map((entry) => entry.code)).toContain("invalid-literal");
	});

	it("accepts a closed Japanese suffix that is not in the standard document", () => {
		const result = compileCollisionPatternSet(
			compileInput({
				nounSuffixes: [{ id: "noun-meita", weight: 1, literal: "めいた" }],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.set.nounSuffixes.map((entry) => entry.literal)).toEqual(["めいた"]);
	});
});

function compileInput(
	overrides: Partial<CompileCollisionPatternSetInput> = {},
): CompileCollisionPatternSetInput {
	return { ...BASELINE, ...overrides };
}

describe("the bundle-time Collision pattern guard", () => {
	type StartResult = { errors?: { text: string; detail?: unknown }[] } | null;

	function register() {
		const hooks: {
			start: (() => Promise<StartResult>)[];
			load: {
				filter: RegExp;
				callback: (args: { path: string }) => Promise<{
					contents: string;
					loader: string;
					resolveDir?: string;
					watchFiles: string[];
				} | null>;
			}[];
		} = { start: [], load: [] };
		standardCollisionPatternsPlugin(process.cwd()).setup({
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
		expect(hooks.start).toHaveLength(1);
		expect(await hooks.start[0]!()).toBeNull();
	});

	it("reports a refused document as a build error rather than throwing past esbuild", async () => {
		const hooks: { start: (() => Promise<StartResult>)[] } = {
			start: [],
		};
		standardCollisionPatternsPlugin("/nonexistent-semantropy-root").setup({
			onStart: (callback: (typeof hooks.start)[number]) => hooks.start.push(callback),
			onLoad: () => undefined,
		});

		const result = await hooks.start[0]!();
		expect(result?.errors?.[0]?.text).toMatch(/is missing/u);
	});

	it.each(["generated", "lock"] as const)(
		"reports an unreadable %s as a build error, keeps the assert cause, and does not call it missing",
		async (which) => {
			const hooks: { start: (() => Promise<StartResult>)[] } = {
				start: [],
			};
			const generated = path.join(process.cwd(), STANDARD_COLLISION_PATTERNS_GENERATED);
			const lockFile = path.join(process.cwd(), STANDARD_COLLISION_PATTERNS_LOCK);
			const target = which === "generated" ? generated : lockFile;
			const label =
				which === "generated"
					? STANDARD_COLLISION_PATTERNS_GENERATED
					: STANDARD_COLLISION_PATTERNS_LOCK;
			standardCollisionPatternsPlugin(process.cwd(), {
				readText: readTextWithFailures(new Map([[target, injectedFsError("EACCES")]])),
			}).setup({
				onStart: (callback: (typeof hooks.start)[number]) => hooks.start.push(callback),
				onLoad: () => undefined,
			});

			const result = await hooks.start[0]!();
			const message = result?.errors?.[0];
			expect(message?.text).toContain(`${label} is unreadable (EACCES)`);
			expect(message?.text).not.toMatch(/is missing/u);
			expect(message?.text).not.toContain(GENERATE_COMMAND);
			expect(message?.detail).toBeInstanceOf(Error);
			expect((message?.detail as Error).message).toBe(message?.text);
			expect((message?.detail as { cause?: { code?: string } }).cause?.code).toBe("EACCES");
		},
	);

	it("makes the document a watch input without using a Go-invalid regexp flag", async () => {
		const hooks = register();
		expect(hooks.load).toHaveLength(2);
		for (const hook of hooks.load) {
			expect(hook.filter.flags).not.toContain("u");
		}

		const generated = path.resolve(process.cwd(), STANDARD_COLLISION_PATTERNS_GENERATED);
		const generatedHook = hooks.load.find((hook) =>
			hook.filter.test(STANDARD_COLLISION_PATTERNS_GENERATED),
		);
		const mainHook = hooks.load.find((hook) => hook.filter.test("src/main.ts"));
		expect(generatedHook).toBeDefined();
		expect(mainHook).toBeDefined();

		const loadedGenerated = await generatedHook!.callback({ path: generated });
		expect(loadedGenerated?.loader).toBe("ts");
		expect(loadedGenerated?.watchFiles).toEqual([
			path.resolve(process.cwd(), STANDARD_COLLISION_PATTERNS_MARKDOWN),
			generated,
			path.resolve(process.cwd(), STANDARD_COLLISION_PATTERNS_LOCK),
			path.resolve(process.cwd(), "src/collision/compilePatternSet.ts"),
			path.resolve(process.cwd(), "src/collision/patternData.ts"),
		]);
		expect(await generatedHook!.callback({ path: path.resolve("src/collision/patternData.ts") })).toBeNull();

		const loadedMain = await mainHook!.callback({
			path: path.resolve(process.cwd(), "src/main.ts"),
		});
		expect(loadedMain?.loader).toBe("ts");
		expect(loadedMain?.watchFiles).toEqual([
			path.resolve(process.cwd(), STANDARD_COLLISION_PATTERNS_MARKDOWN),
			generated,
			path.resolve(process.cwd(), STANDARD_COLLISION_PATTERNS_LOCK),
			path.resolve(process.cwd(), "src/collision/compilePatternSet.ts"),
			path.resolve(process.cwd(), "src/collision/patternData.ts"),
		]);
		expect(await mainHook!.callback({ path: path.resolve("src/SemantropyPlugin.ts") })).toBeNull();
	});
});

describe("the Collision pattern guard on repeated explicit builds", () => {
	it("refuses a generated-module edit and a Markdown edit, then succeeds after restore", async () => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-collision-watch-"));
		let buildContext: Awaited<ReturnType<typeof esbuildContext>> | undefined;
		try {
			await copyPatternTree(scratch);
			await writeFile(
				path.join(scratch, "entry.ts"),
				`import { STANDARD_COLLISION_PATTERN_DATA_VERSION } from "./${STANDARD_COLLISION_PATTERNS_GENERATED}";\nexport const version = STANDARD_COLLISION_PATTERN_DATA_VERSION;\n`,
				"utf8",
			);
			buildContext = await esbuildContext({
				absWorkingDir: scratch,
				entryPoints: ["entry.ts"],
				outfile: "out.js",
				bundle: true,
				logLevel: "silent",
				plugins: [standardCollisionPatternsPlugin(scratch) as Plugin],
			});
			const first = await buildContext.rebuild();
			expect(first.errors).toEqual([]);

			const generatedPath = path.join(scratch, STANDARD_COLLISION_PATTERNS_GENERATED);
			const markdownPath = path.join(scratch, STANDARD_COLLISION_PATTERNS_MARKDOWN);
			const originalGenerated = await readFile(generatedPath, "utf8");
			const originalMarkdown = await readFile(markdownPath, "utf8");

			await writeFile(
				generatedPath,
				originalGenerated.replace("Do not edit this file.", "hand-edited generated header"),
				"utf8",
			);
			await expectRebuildToRefuse(buildContext);

			await writeFile(generatedPath, originalGenerated, "utf8");
			const restoredGenerated = await buildContext.rebuild();
			expect(restoredGenerated.errors).toEqual([]);

			await writeFile(
				markdownPath,
				`${originalMarkdown}\n## noun-suffix noun-meita\nweight: 2\n\nめいた\n`,
				"utf8",
			);
			await expectRebuildToRefuse(buildContext);

			await writeFile(markdownPath, originalMarkdown, "utf8");
			const restoredMarkdown = await buildContext.rebuild();
			expect(restoredMarkdown.errors).toEqual([]);
		} finally {
			await buildContext?.dispose();
			await rm(scratch, { recursive: true, force: true });
		}
	}, 60_000);
});

describe("the Collision pattern source stays out of the plugin", () => {
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

			expect(inputs).toContain(STANDARD_COLLISION_PATTERNS_GENERATED);
			expect(result.metafile.inputs["src/view/CollisionSession.ts"]!.imports.map(input => input.path)).toContain(STANDARD_COLLISION_PATTERNS_GENERATED);
			expect(inputs).toContain("src/collision/compilePatternSet.ts");
			for (const name of inputs) {
				expect(name).not.toMatch(/scripts\/collision|\.md$|resources\/collision/u);
			}
			const code = result.outputFiles[0]!.text;
			expect(code).not.toMatch(
				/node:fs|readFile\(|standard-patterns\.md|parseStandardCollisionPatternMarkdown|STANDARD_COLLISION_PATTERN_DATA_JSON|STANDARD_COLLISION_PATTERN_DATA_DIGEST|generate:collision-patterns/u,
			);
		}
	});

	it("does not let the schema import the generated module", async () => {
		const generated = await readFile(STANDARD_COLLISION_PATTERNS_GENERATED, "utf8");
		const schema = await readFile("src/collision/patternData.ts", "utf8");

		expect(generated).not.toMatch(/scripts\/|node:|esbuild/u);
		const statements = schema.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
		expect(statements).not.toMatch(/\bimport\b|\brequire\b/u);
		expect(statements).not.toMatch(/STANDARD_COLLISION_/u);
	});
});

function recipe(overrides: Partial<RawCollisionRecipe> = {}): RawCollisionRecipe {
	return { id: "test-recipe", label: "Test", enabled: true, selectable: true, weight: 1,
		parts: [{ kind: "noun", slotId: "n1", optional: false }], presence: [], ...overrides };
}

function recipeText(raw: RawCollisionRecipe): string {
	return [`## recipe ${raw.id}`, `label: ${raw.label}`, `enabled: ${String(raw.enabled)}`,
		`selectable: ${String(raw.selectable)}`, `weight: ${raw.weight}`,
		...raw.parts.map((part) => `part: ${part.kind} ${part.slotId} ${part.optional ? "optional" : "required"}${part.profile === undefined ? "" : ` ${part.profile}`}${part.literalId === undefined ? "" : ` ${part.literalId}`}`),
		...raw.presence.map((entry) => `presence: ${entry.slots.length === 0 ? "none" : entry.slots.join(",")} ${entry.weight}`),
	].join("\n");
}

function recipeDocument(recipes: readonly RawCollisionRecipe[]): string {
	return document({ entries: [...recipes.map(recipeText), ...BASELINE.literals.map((entry) => `## literal ${entry.id}\n\n${entry.literal}`)] });
}

function compileCodes(input: CompileCollisionPatternSetInput): readonly string[] {
	const result = compileCollisionPatternSet(input);
	return result.ok ? [] : result.issues.map((entry) => entry.code);
}

const OPTIONAL_RECIPE = recipe({ parts: [
	{ kind: "modifier", slotId: "m1", optional: true, profile: "all" },
	{ kind: "noun", slotId: "n1", optional: false },
	{ kind: "modifier", slotId: "m2", optional: true, profile: "all" },
], presence: [{ slots: [], weight: 1 }, { slots: ["m1", "m2"], weight: 1 }] });

const MAX_PARTS_RECIPE = recipe({ parts: [
	...Array.from({ length: 4 }, (_, i) => ({ kind: "noun", slotId: `n${i}`, optional: false })),
	...Array.from({ length: 3 }, (_, i) => ({ kind: "modifier", slotId: `m${i}`, optional: false, profile: "all" })),
	...Array.from({ length: 2 }, (_, i) => ({ kind: "connector", slotId: `c${i}`, optional: false })),
	{ kind: "predicate", slotId: "v1", optional: false, profile: "regular-verb-basic" },
	{ kind: "literal", slotId: "l1", optional: false, literalId: "named-link" },
	{ kind: "literal", slotId: "l2", optional: false, literalId: "named-link" },
] });

describe("Schema 2 ordered recipe semantics", () => {
	const failures: [string, RawCollisionRecipe, string][] = [
		["unknown kind", recipe({ parts: [{ kind: "adverb", slotId: "x", optional: false }] }), "invalid-part-kind"],
		["duplicate slot across kinds", recipe({ parts: [{ kind: "noun", slotId: "n1", optional: false }, { kind: "connector", slotId: "n1", optional: false }] }), "duplicate-slot-id"],
		["reserved slot", recipe({ parts: [{ kind: "noun", slotId: "none", optional: false }] }), "invalid-slot-id"],
		["malformed slot", recipe({ parts: [{ kind: "noun", slotId: "N1", optional: false }] }), "invalid-slot-id"],
		["modifier profile", recipe({ parts: [...recipe().parts, { kind: "modifier", slotId: "m1", optional: false, profile: "custom" }] }), "invalid-candidate-profile"],
		["predicate profile", recipe({ parts: [...recipe().parts, { kind: "predicate", slotId: "v1", optional: false, profile: "all" }] }), "invalid-candidate-profile"],
		["dangling literal", recipe({ parts: [...recipe().parts, { kind: "literal", slotId: "l1", optional: false, literalId: "missing" }] }), "dangling-literal-reference"],
		["connector is not a fixed literal", recipe({ parts: [...recipe().parts, { kind: "literal", slotId: "l1", optional: false, literalId: "no" }] }), "dangling-literal-reference"],
		...["noun", "connector", "predicate", "literal"].map((kind): [string, RawCollisionRecipe, string] => [
			`optional ${kind}`, recipe({ parts: [...recipe().parts, { kind, slotId: "x", optional: true,
				...(kind === "predicate" ? { profile: "regular-verb-basic" } : {}), ...(kind === "literal" ? { literalId: "named-link" } : {}) }] }), "invalid-optional",
		]),
		["missing noun", recipe({ parts: [{ kind: "modifier", slotId: "m1", optional: false, profile: "sahen-basic" }] }), "missing-required-noun"],
		["no parts", recipe({ parts: [] }), "part-limit"],
		["13 parts", recipe({ parts: [...MAX_PARTS_RECIPE.parts, { kind: "literal", slotId: "l3", optional: false, literalId: "named-link" }] }), "part-limit"],
		...["noun", "modifier", "connector", "predicate"].map((kind): [string, RawCollisionRecipe, string] => [
			`${kind} cap`, recipe({ parts: [...MAX_PARTS_RECIPE.parts.slice(0, -2), { kind, slotId: "extra", optional: false,
				...(kind === "modifier" ? { profile: "all" } : {}), ...(kind === "predicate" ? { profile: "regular-verb-basic" } : {}) }] }), "kind-limit",
		]),
		["missing presence", recipe({ ...OPTIONAL_RECIPE, presence: [] }), "missing-presence"],
		["unexpected presence", recipe({ presence: [{ slots: [], weight: 1 }] }), "unexpected-presence"],
		["unknown presence slot", recipe({ ...OPTIONAL_RECIPE, presence: [{ slots: ["m3"], weight: 1 }] }), "unknown-presence-slot"],
		["required presence slot", recipe({ ...OPTIONAL_RECIPE, presence: [{ slots: ["n1"], weight: 1 }] }), "required-presence-slot"],
		["duplicate presence member", recipe({ ...OPTIONAL_RECIPE, presence: [{ slots: ["m1", "m1"], weight: 1 }] }), "invalid-presence"],
		["duplicate set in reverse order", recipe({ ...OPTIONAL_RECIPE, presence: [{ slots: ["m1", "m2"], weight: 1 }, { slots: ["m2", "m1"], weight: 2 }] }), "duplicate-presence"],
		["duplicate empty set", recipe({ ...OPTIONAL_RECIPE, presence: [{ slots: [], weight: 1 }, { slots: [], weight: 2 }] }), "duplicate-presence"],
		["zero presence weight", recipe({ ...OPTIONAL_RECIPE, presence: [{ slots: [], weight: 0 }] }), "invalid-weight"],
		["unsafe presence weight", recipe({ ...OPTIONAL_RECIPE, presence: [{ slots: [], weight: Number.MAX_SAFE_INTEGER + 1 }] }), "invalid-weight"],
		["zero recipe weight", recipe({ weight: 0 }), "invalid-weight"],
		["fractional recipe weight", recipe({ weight: 1.5 }), "invalid-weight"],
		["unsafe recipe weight", recipe({ weight: Number.MAX_SAFE_INTEGER + 1 }), "invalid-weight"],
		["disabled selectable", recipe({ enabled: false }), "disabled-selectable-recipe"],
	];
	it.each(failures)("refuses %s in both parser and compiler", (_name, raw, code) => {
		expect(compileCodes(compileInput({ recipes: [raw] }))).toContain(code);
		expect(codesOf(recipeDocument([raw]))).toContain(code);
	});

	it.each(["", " Leading", "Trailing ", "あ".repeat(41), "e\u0301", "x\0y", "x\u0085y", "x\u202Ey", "x\u2028y", "x\u2029y", "x\uD800y", "x\uDC00y"])("refuses unsafe label %j in both paths", (label) => {
		const raw = recipe({ label });
		expect(compileCodes(compileInput({ recipes: [raw] }))).toContain("invalid-label");
		expect(codesOf(recipeDocument([raw]))).toContain("invalid-label");
	});
	it.each(["x\ny", "x\ry", "x\r\ny"])("refuses multiline labels %j", (label) => {
		expect(compileCodes(compileInput({ recipes: [recipe({ label })] }))).toContain("invalid-label");
		expect(parseStandardCollisionPatternMarkdown(recipeDocument([recipe({ label })])).ok).toBe(false);
	});
	it.each(["TRUE", "False", "1", "yes", "", "true "])("refuses boolean spelling %j", (value) => {
		for (const key of ["enabled", "selectable"] as const) {
			const raw = recipe({ [key]: value as unknown as boolean });
			expect(compileCodes(compileInput({ recipes: [raw] }))).toContain("invalid-boolean");
			expect(codesOf(recipeDocument([raw]))).toContain("invalid-boolean");
		}
	});
	it.each(["part: noun n2 maybe", "part: noun n2", "part: modifier m1 optional", "part: predicate v1 required sahen-basic extra", "part: literal l1 required \"の\"", "part: noun n2 required conditional", "presence: none,m1 1", "presence: m1, 1", "presence: m1 01", "presence: m1 1e2", "presence: m1 m2 1"])("refuses malformed declaration %s", (line) => {
		expect(parseStandardCollisionPatternMarkdown(recipeDocument([OPTIONAL_RECIPE]).replace("presence: none 1", line)).ok).toBe(false);
	});
	it("rejects a nonboolean optional flag and extra raw fields without trusting typed callers", () => {
		for (const part of [
			{ kind: "noun", slotId: "n1", optional: "false" as unknown as boolean },
			{ kind: "noun", slotId: "n1", optional: false, profile: "all" },
			{ kind: "noun", slotId: "n1", optional: false, literalId: "named-link" },
		]) expect(compileCollisionPatternSet(compileInput({ recipes: [recipe({ parts: [part] })] })).ok).toBe(false);
	});
	it("rejects duplicate recipe and fixed literal IDs, same-kind surfaces, and selectable labels", () => {
		for (const recipes of [[recipe(), recipe()], [recipe({ label: "同じ" }), recipe({ id: "other", label: "同じ" })]]) {
			expect(compileCollisionPatternSet(compileInput({ recipes })).ok).toBe(false);
			expect(parseStandardCollisionPatternMarkdown(recipeDocument(recipes)).ok).toBe(false);
		}
		for (const literal of [{ id: "named-link", literal: "別名" }, { id: "other-link", literal: "という名の" }]) {
			expect(compileCollisionPatternSet(compileInput({ literals: [...BASELINE.literals, literal] })).ok).toBe(false);
			expect(parseStandardCollisionPatternMarkdown(recipeDocument([recipe()]) + `\n## literal ${literal.id}\n\n${literal.literal}\n`).ok).toBe(false);
		}
	});
	it("accepts enabled random-only, selectable and disabled entries while preserving flags", () => {
		const recipes = [recipe(), recipe({ id: "random-only", selectable: false }), recipe({ id: "disabled", enabled: false, selectable: false })];
		const result = compileCollisionPatternSet(compileInput({ recipes }));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.set.recipes).toEqual(recipes);
		expect(parseStandardCollisionPatternMarkdown(recipeDocument(recipes)).ok).toBe(true);
	});
	it("accepts exact caps, code-point boundaries, safe-integer weights and plain-text labels", () => {
		for (const label of ["𠮷".repeat(40), "<b>Plain *text*</b>"]) {
			const raw = recipe({ ...MAX_PARTS_RECIPE, label, weight: Number.MAX_SAFE_INTEGER });
			expect(compileCollisionPatternSet(compileInput({ recipes: [raw] })).ok).toBe(true);
			expect(parseStandardCollisionPatternMarkdown(recipeDocument([raw])).ok).toBe(true);
		}
		expect(inspectCollisionLiteral("𠮷".repeat(32))).toBeNull();
		expect(inspectCollisionLiteral("𠮷".repeat(33))).toBe("invalid-literal");
	});
	it("permits partial presence sets and canonicalizes their member order without changing digest", () => {
		const forward = recipe({ ...OPTIONAL_RECIPE, presence: [{ slots: ["m1", "m2"], weight: Number.MAX_SAFE_INTEGER }] });
		const reverse = recipe({ ...forward, presence: [{ slots: ["m2", "m1"], weight: Number.MAX_SAFE_INTEGER }] });
		const a = parseStandardCollisionPatternMarkdown(recipeDocument([forward]));
		const b = parseStandardCollisionPatternMarkdown(recipeDocument([reverse]));
		expect(a.ok && b.ok).toBe(true);
		if (a.ok && b.ok) expect(collisionPatternDataDigest(a)).toBe(collisionPatternDataDigest(b));
	});
	it("deep-freezes nested parts and presence without freezing or aliasing caller-owned data", () => {
		const raw = structuredClone(OPTIONAL_RECIPE);
		const result = compileCollisionPatternSet(compileInput({ recipes: [raw] }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const compiled = result.set.recipes[0]!;
		const snapshot = JSON.stringify(result.set);
		for (const value of [compiled.parts, ...compiled.parts, compiled.presence, ...compiled.presence, ...compiled.presence.map((p) => p.slots)]) {
			expect(Object.isFrozen(value)).toBe(true);
			expect(Reflect.set(value, "injected", true)).toBe(false);
		}
		expect(Object.isFrozen(raw.parts[0])).toBe(false);
		expect(Reflect.set(raw.parts[0]!, "profile", "corrupt")).toBe(true);
		expect(Reflect.set(raw.presence[1]!.slots, "0", "corrupt")).toBe(true);
		expect(JSON.stringify(result.set)).toBe(snapshot);
	});
	it("pins all nine Policy 3 structures as actual fixture data", () => {
		const structures = BASELINE.recipes.map((entry) => entry.parts.map((part) =>
			part.kind === "literal" ? BASELINE.literals.find((literal) => literal.id === part.literalId)!.literal :
			`${part.optional ? "[" : ""}${part.kind === "noun" ? "N" : part.kind === "connector" ? "C" : part.kind === "modifier" ? "M" : "V"}${part.slotId.slice(1)}${part.optional ? "]" : ""}`).join(" "));
		expect(structures).toEqual([
			"[M1] N1 C1 [M2] N2", "N1 C1 N2", "[M1] N1 C1 N2 C2 N3", "N1 C1 [M2] N2 C2 [M3] N3",
			"N1 という名の N2", "N1 は [M2] N2 の N3 を V1 か", "N1 は N2 ではない", "N1 のための N2", "M1 N1",
		]);
		expect(BASELINE.recipes.at(-1)!.parts[0]!.profile).toBe("sahen-basic");
		expect(BASELINE.recipes.find((r) => r.id === "question")!.parts.find((p) => p.kind === "predicate")!.profile).toBe("regular-verb-basic");
	});
});

const V1_FIXTURE = readPinnedFixture<Omit<Fixture, "recipes" | "literals"> & {
	recipes: readonly { id: string; shape: string; weight: number }[];
	profiles: readonly { id: string; placement: string; weight: number }[];
}>("collisionPatternsV1", "d961eb3a2f379f09d57596d3c292dd796a92f76374b4c6c4c4fd217ad1739d24");
const V1_LOCK_ENTRY = { dataVersion: 1, digest: "1451f3e07d47f9301b716a7167409e007d442aaa17e8ab8c438a743661eb1244" };

function legacyModule(): string {
	return `export const STANDARD_COLLISION_PATTERN_DATA_DIGEST = "${V1_LOCK_ENTRY.digest}";\nexport const STANDARD_COLLISION_PATTERN_DATA_JSON = ${JSON.stringify(JSON.stringify(V1_FIXTURE))};\n`;
}

describe("Schema 2 migration and retained lock authority", () => {
	it.each([
		{ label: "first generation after v1", dataVersion: 2, copyLock: false },
		{ label: "skipped version after v2", dataVersion: 4, copyLock: true },
	])("refuses $label before staging incomplete history", async ({ dataVersion, copyLock }) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("lock-gap", { copyLock });
		try {
			const lockBefore = copyLock ? await readFile(lockPath, "utf8") : null;
			const generated = await readFile(STANDARD_COLLISION_PATTERNS_GENERATED, "utf8");
			if (copyLock) await writeFile(outfile, generated);
			await expect(writeStandardCollisionPatterns({
				markdown: (await markdown()).replace("data-version: 2", `data-version: ${dataVersion}`),
				generatedPath: outfile,
				lockPath,
			})).rejects.toThrow(/data-version-gap/u);
			if (copyLock) {
				expect(await readFile(outfile, "utf8")).toBe(generated);
				expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			} else {
				await expect(readFile(outfile, "utf8")).rejects.toThrow(/ENOENT/u);
				await expect(readFile(lockPath, "utf8")).rejects.toThrow(/ENOENT/u);
			}
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
	it("preserves every v1 connector, modifier form and suffix without requiring private history", async () => {
		expect(BASELINE.connectors).toEqual(V1_FIXTURE.connectors);
		expect(BASELINE.modifierForms).toEqual(V1_FIXTURE.modifierForms);
		expect(BASELINE.nounSuffixes).toEqual(V1_FIXTURE.nounSuffixes);
		expect(JSON.parse(await readFile(STANDARD_COLLISION_PATTERNS_LOCK, "utf8"))).toEqual({ versions: [V1_LOCK_ENTRY, { dataVersion: 2, digest: collisionPatternDataDigest(BASELINE) }] });
	});
	it("migrates the legacy module and single-entry lock together, retaining v1", async () => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("schema-migration");
		try {
			await writeFile(outfile, legacyModule());
			await writeFile(lockPath, JSON.stringify(V1_LOCK_ENTRY));
			await writeStandardCollisionPatterns({ generatedPath: outfile, lockPath });
			expect(await readFile(outfile, "utf8")).toBe(await readFile(STANDARD_COLLISION_PATTERNS_GENERATED, "utf8"));
			expect(await readFile(lockPath, "utf8")).toBe(await readFile(STANDARD_COLLISION_PATTERNS_LOCK, "utf8"));
			await expect(assertStandardCollisionPatternsGenerated({ generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 2, dataVersion: 2 });
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
	it.each(["generated", "lock"] as const)("rolls Schema 1 migration back byte-for-byte on %s publication failure", async (phase) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("schema-migration-failure");
		try {
			const generated = legacyModule();
			const lock = JSON.stringify(V1_LOCK_ENTRY);
			await writeFile(outfile, generated);
			await writeFile(lockPath, lock);
			await expect(writeStandardCollisionPatterns({ generatedPath: outfile, lockPath, beforePublish: async (step) => {
				if (step === "generated") {
					expect(await readFile(`${outfile}.generating`, "utf8")).toContain("SCHEMA_VERSION = 2");
					expect((JSON.parse(await readFile(`${lockPath}.generating`, "utf8")) as PatternLock).versions).toHaveLength(2);
				}
				if (step === phase) throw new Error("migration publication failure");
			} })).rejects.toThrow(/migration publication failure/u);
			expect(await readFile(outfile, "utf8")).toBe(generated);
			expect(await readFile(lockPath, "utf8")).toBe(lock);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
	it.each([
		["label", (s: string) => s.replace("label: Standard", "label: Changed")],
		["enabled", (s: string) => s.replace("enabled: true\nselectable: true", "enabled: false\nselectable: false")],
		["selectable", (s: string) => s.replace("\nselectable: true\n", "\nselectable: false\n")],
		["weight", (s: string) => s.replace("weight: 100", "weight: 101")],
		["presence", (s: string) => s.replace("presence: none 45", "presence: none 46")],
		["profile", (s: string) => s.replace("m1 optional all", "m1 optional sahen-basic")],
		["order", (s: string) => s.replace("part: noun n1 required\npart: connector c1 required", "part: connector c1 required\npart: noun n1 required")],
		["addition", (s: string) => s + "\n" + recipeText(recipe()) + "\n"],
		["deletion", (s: string) => s.replace(/## recipe plain-pair[\s\S]*?(?=## recipe triple-left)/u, "")],
	] as const)("requires a new data version for recipe %s, then retains all prior lock entries", async (_name, mutate) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("recipe-version");
		try {
			const original = await readFile(STANDARD_COLLISION_PATTERNS_GENERATED, "utf8");
			const lockBefore = await readFile(lockPath, "utf8");
			await writeFile(outfile, original);
			const edited = mutate(await markdown());
			await expect(writeStandardCollisionPatterns({ markdown: edited, generatedPath: outfile, lockPath })).rejects.toThrow(/data-version-unchanged/u);
			expect(await readFile(outfile, "utf8")).toBe(original);
			expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
			const bumped = edited.replace("data-version: 2", "data-version: 3");
			await writeStandardCollisionPatterns({ markdown: bumped, generatedPath: outfile, lockPath });
			const after = JSON.parse(await readFile(lockPath, "utf8")) as PatternLock;
			expect(after.versions.slice(0, 2)).toEqual((JSON.parse(lockBefore) as PatternLock).versions);
			expect(after.versions.at(-1)!.dataVersion).toBe(3);
			await expect(assertStandardCollisionPatternsGenerated({ markdown: bumped, generatedPath: outfile, lockPath })).resolves.toEqual({ schemaVersion: 2, dataVersion: 3 });
			await expect(writeStandardCollisionPatterns({ generatedPath: outfile, lockPath })).rejects.toThrow(/data-version-unchanged/u);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
	it.each([
		{}, { versions: [] }, { versions: [V1_LOCK_ENTRY, V1_LOCK_ENTRY] },
		{ versions: [{ dataVersion: 2, digest: V1_LOCK_ENTRY.digest }, V1_LOCK_ENTRY] },
		{ versions: [{ dataVersion: "1", digest: V1_LOCK_ENTRY.digest }] },
		{ versions: [{ dataVersion: 1, digest: "invalid" }] },
		{ versions: [{ ...V1_LOCK_ENTRY, unknown: true }] }, { versions: [V1_LOCK_ENTRY], extra: true },
		{ dataVersion: 2, digest: V1_LOCK_ENTRY.digest },
		{ versions: [{ dataVersion: 2, digest: collisionPatternDataDigest(BASELINE) }] },
		{ versions: [V1_LOCK_ENTRY, { dataVersion: 3, digest: collisionPatternDataDigest(BASELINE) }] },
	])("refuses malformed or downgraded lock format %j before any write", async (lock) => {
		const { scratch, outfile, lockPath } = await isolatedWritePaths("invalid-lock-history");
		try {
			const generated = await readFile(STANDARD_COLLISION_PATTERNS_GENERATED, "utf8");
			await writeFile(outfile, generated);
			const lockText = JSON.stringify(lock);
			await writeFile(lockPath, lockText);
			await expect(writeStandardCollisionPatterns({ generatedPath: outfile, lockPath })).rejects.toThrow(/malformed-lock/u);
			await expect(assertStandardCollisionPatternsGenerated({ generatedPath: outfile, lockPath })).rejects.toThrow(/malformed-lock/u);
			expect(await readFile(outfile, "utf8")).toBe(generated);
			expect(await readFile(lockPath, "utf8")).toBe(lockText);
			await expectNoGeneratingFiles(scratch);
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
	it("rejects stale schema and unreadable Markdown without conflating it with missing", async () => {
		expect(codesOf((await markdown()).replace("schema-version: 2", "schema-version: 1"))).toContain("unsupported-schema-version");
		expect(compileCodes(compileInput({ schemaVersion: 1 }))).toContain("unsupported-schema-version");
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-collision-unreadable-document-"));
		try {
			const error: unknown = await generateStandardCollisionPatterns({ markdownPath: scratch }).catch((failure: unknown) => failure);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toMatch(/is unreadable/u);
			expect((error as Error).message).not.toMatch(/missing/u);
			expect((error as Error & { cause: NodeJS.ErrnoException }).cause.code).toBe("EISDIR");
		} finally { await rm(scratch, { recursive: true, force: true }); }
	});
	it.each(["の ", "の\u0000", "の\u0085", "の\u200D", "の\uD800", "の\u2028", "の\u2029", "か\u3099", "ASCII", "/の/", "()=>の", "${noun}", "{{noun}}", "あ".repeat(33)])("rejects unsafe fixed literal %j through parser and compiler", (literal) => {
		expect(compileCodes(compileInput({ literals: [{ id: "named-link", literal }] }))).toContain("invalid-literal");
		expect(parseStandardCollisionPatternMarkdown(document({ entries: [recipeText(recipe()), `## literal bad-literal\n\n${literal}`] })).ok).toBe(false);
	});
});

describe("automatic watch detection without relying on a Collision runtime import", () => {
	it.each([
		{ label: "recipe label", file: STANDARD_COLLISION_PATTERNS_MARKDOWN, mutate: (source: string) => source.replace("label: Standard", "label: Watch"), error: /does not match/u },
		{ label: "generated module", file: STANDARD_COLLISION_PATTERNS_GENERATED, mutate: (source: string) => source.replace("Do not edit this file.", "hand-edited generated header"), error: /does not match/u },
		{ label: "presence weight", file: STANDARD_COLLISION_PATTERNS_MARKDOWN, mutate: (source: string) => source.replace("presence: none 45", "presence: none 46"), error: /does not match/u },
		{ label: "malformed lock", file: STANDARD_COLLISION_PATTERNS_LOCK, mutate: () => "{}", error: /malformed-lock/u },
		{ label: "missing v1 history", file: STANDARD_COLLISION_PATTERNS_LOCK, mutate: (source: string) => JSON.stringify({ versions: (JSON.parse(source) as PatternLock).versions.slice(1) }), error: /malformed-lock/u },
		{ label: "compiler validator", file: "src/collision/compilePatternSet.ts", mutate: (source: string) => source.replace("input.schemaVersion !== COLLISION_PATTERN_SCHEMA_VERSION", "input.schemaVersion !== -1"), error: /unsupported-schema-version/u },
		{ label: "schema validator", file: "src/collision/patternData.ts", mutate: (source: string) => source.replace("COLLISION_PATTERN_SCHEMA_VERSION = 2", "COLLISION_PATTERN_SCHEMA_VERSION = 3"), error: /unsupported-schema-version/u },
	])("detects $label edits and recovery without a caller-triggered rebuild", async ({ file, mutate, error }) => {
		const scratch = await mkdtemp(path.join(tmpdir(), "semantropy-collision-auto-watch-"));
		let context: Awaited<ReturnType<typeof esbuildContext>> | undefined;
		let deliver: ((errors: readonly string[]) => void) | undefined;
		const watchEvent = async (action: () => Promise<unknown>): Promise<readonly string[]> => {
			let timeout: ReturnType<typeof setTimeout>;
			const completed = new Promise<readonly string[]>((resolve, reject) => {
				timeout = setTimeout(() => reject(new Error("watch did not detect the file change")), 15_000);
				deliver = resolve;
			});
			try { await action(); return await completed; }
			finally { clearTimeout(timeout!); deliver = undefined; }
		};
		try {
			await copyPatternTree(scratch);
			// Proves the guard is active even for an entry point with no generated import.
			await writeFile(path.join(scratch, "src/main.ts"), "export const unrelated = 1;\n");
			context = await esbuildContext({ absWorkingDir: scratch, entryPoints: ["src/main.ts"], outfile: "out.js", bundle: true, logLevel: "silent",
				plugins: [standardCollisionPatternsPlugin(scratch) as Plugin, { name: "record-watch", setup(build) {
					build.onEnd((result) => { deliver?.(result.errors.map((entry) => entry.text)); });
				} }] });
			expect(await watchEvent(() => context!.watch())).toEqual([]);
			const output = await readFile(path.join(scratch, "out.js"), "utf8");
			const sourcePath = path.join(scratch, file);
			const source = await readFile(sourcePath, "utf8");
			const changed = mutate(source);
			expect(changed).not.toBe(source);
			expect((await watchEvent(() => writeFile(sourcePath, changed))).join("\n")).toMatch(error);
			expect(await readFile(sourcePath, "utf8")).toBe(changed);
			expect(await watchEvent(() => writeFile(sourcePath, source))).toEqual([]);
			expect(await readFile(path.join(scratch, "out.js"), "utf8")).toBe(output);
		} finally { await context?.dispose(); await rm(scratch, { recursive: true, force: true }); }
	}, 60_000);
});

describe("raw compiler ID boundaries", () => {
	it.each(["\n", "\r", "\r\n"])("refuses terminal newline %j in entry and slot IDs", (ending) => {
		expect(compileCodes(compileInput({ recipes: [recipe({ id: `recipe${ending}` })] }))).toContain("invalid-id");
		expect(compileCodes(compileInput({ recipes: [recipe({ parts: [{ kind: "noun", slotId: `n1${ending}`, optional: false }] })] }))).toContain("invalid-slot-id");
	});
});
