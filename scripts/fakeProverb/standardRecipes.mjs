/**
 * PRE-RELEASE-FAKE-PROVERB-TEMPLATES1: the build-time owner of the standard
 * Fake Proverb recipe document.
 *
 * `resources/fake-proverb/standard-recipes.md` is the one document a human
 * edits. This module parses it, validates it through the product's own
 * `compileFakeProverbRecipeSet`, and renders the typed data a later slice will
 * import. Nothing here ships: the parser, `node:fs` and the Markdown itself
 * stay outside the plugin bundle.
 *
 * The design follows the reviewed Collision pattern pipeline — strict
 * line-oriented parse, one shared compiler, canonical payload and digest, a
 * tracked version→digest lock outside the generated module, atomic
 * publication with rollback, and a fail-closed build and watch guard — but
 * every schema, file, lock, version and command here is Fake Proverb's own.
 *
 * The parse never depends on how Markdown renders. It refuses anything it does
 * not recognise rather than skipping it, so an entry cannot be lost to a typo,
 * and it reports every problem it finds in document order so one failing build
 * names them all.
 */
import esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

/** Relative to the plugin root, in POSIX form, for messages and copy lists. */
export const STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN = "resources/fake-proverb/standard-recipes.md";
export const STANDARD_FAKE_PROVERB_RECIPES_GENERATED =
	"src/fakeProverb/generated/standardFakeProverbRecipeEntries.ts";
/**
 * Tracked version→digest authority for same-version meaning changes.
 * Regeneration may repair the generated TypeScript module; it must not treat
 * that module as proof of a previously approved meaning.
 */
export const STANDARD_FAKE_PROVERB_RECIPES_LOCK = "resources/fake-proverb/standard-recipes.lock.json";
/** The two source validators the generator bundles; both are watch inputs. */
export const FAKE_PROVERB_RECIPE_VALIDATORS = [
	"src/fakeProverb/compileRecipeSet.ts",
	"src/fakeProverb/recipeData.ts",
];

/** How to refresh the generated module; named by every staleness failure. */
export const GENERATE_COMMAND = "npm run generate:fake-proverb-recipes";

// Shared compiler for the synchronous parser API. Build/watch re-load their root's
// compiler for each generation, so later edits never use a stale validator.
const sourceCompiler = await loadRecipeCompiler(fileURLToPath(new URL("../../", import.meta.url)));
export const FAKE_PROVERB_RECIPE_SCHEMA_VERSION = sourceCompiler.FAKE_PROVERB_RECIPE_SCHEMA_VERSION;
export const FAKE_PROVERB_LITERAL_MAX_CODE_POINTS = sourceCompiler.FAKE_PROVERB_LITERAL_MAX_CODE_POINTS;

const ENTRY_KINDS = ["proverb", "gloss", "literal", "profile"];
const SCALAR_FIELDS = Object.freeze({
	proverb: ["enabled", "weight"],
	gloss: ["enabled", "weight"],
	literal: [],
	profile: ["kind"],
});
const SLOT_PART_KINDS = ["noun", "modifier", "predicate"];
const METADATA_KEYS = ["schema-version", "data-version"];
const HEADING = /^## ([^ ]+) (.+)$/u;
const TITLE = /^# (.+)$/u;
const FIELD = /^([a-z][a-z0-9-]*): (.*)$/su;
const INTEGER = /^(0|[1-9][0-9]*)$/u;

function issue(code, line, detail) {
	return detail === undefined ? { code, line } : { code, line, detail };
}

export function describeFakeProverbSourceIssue(entry) {
	const where = entry.line === undefined ? "" : ` (line ${entry.line})`;
	return entry.detail === undefined ? `${entry.code}${where}` : `${entry.code}${where}: ${entry.detail}`;
}

export function describeFakeProverbSourceIssues(issues) {
	return issues.map(describeFakeProverbSourceIssue).join("; ");
}

function parsePositiveSafeInteger(value) {
	const numeric = Number(value);
	return INTEGER.test(value) && Number.isSafeInteger(numeric) && numeric >= 1 && String(numeric) === value
		? numeric : null;
}

function splitWords(value) {
	const words = value.split(" ");
	return words.some((word) => word === "") ? null : words;
}

/**
 * One `part:` value. Slot parts take a slot ID, a profile ID and an optional
 * trailing `export`; a literal part takes one literal ID; a reference takes a
 * slot kind and a slot ID. Nothing else is accepted.
 */
function parsePart(value, line, id, issues) {
	const words = splitWords(value);
	if (words === null) {
		issues.push(issue("invalid-part", line, id));
		return null;
	}
	const [kind] = words;
	if (SLOT_PART_KINDS.includes(kind)) {
		if ((words.length !== 3 && words.length !== 4) || (words.length === 4 && words[3] !== "export")) {
			issues.push(issue("invalid-part", line, id));
			return null;
		}
		return { kind, slotId: words[1], profileId: words[2], exported: words.length === 4 };
	}
	if (kind === "literal") {
		if (words.length !== 2) {
			issues.push(issue("invalid-part", line, id));
			return null;
		}
		return { kind, literalId: words[1] };
	}
	if (kind === "reference") {
		if (words.length !== 3) {
			issues.push(issue("invalid-part", line, id));
			return null;
		}
		return { kind, slotKind: words[1], slotId: words[2] };
	}
	issues.push(issue("unknown-part-kind", line, id));
	return null;
}

function parseRequirement(value, line, id, issues) {
	const words = splitWords(value);
	if (words === null || words.length !== 2) {
		issues.push(issue("invalid-requires", line, id));
		return null;
	}
	return { kind: words[0], slotId: words[1] };
}

function parseForm(value, line, id, issues) {
	const words = splitWords(value);
	if (words === null || words.length !== 2) {
		issues.push(issue("invalid-form-line", line, id));
		return null;
	}
	const weight = parsePositiveSafeInteger(words[1]);
	if (weight === null) {
		issues.push(issue("invalid-weight", line, id));
		return null;
	}
	return { form: words[0], weight };
}

/** Strict line syntax followed by the same semantic compiler used by generation. */
export function parseStandardFakeProverbRecipeMarkdown(markdown) {
	return parseWithCompiler(markdown, sourceCompiler);
}

function parseWithCompiler(markdown, compiler) {
	const issues = [];
	const lines = String(markdown).replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);
	const metadata = new Map();
	const entryLines = new Map();
	const parsed = { proverbs: [], glosses: [], literals: [], profiles: [] };
	let sawTitle = false;
	let seenFirstEntry = false;
	let current = null;
	let state = "metadata";
	const finish = () => {
		if (current === null) return;
		const { kind, id, line, fields, body } = current;
		if (!ENTRY_KINDS.includes(kind)) {
			current = null;
			return;
		}
		for (const key of SCALAR_FIELDS[kind]) {
			if (!fields.has(key)) issues.push(issue("missing-field", line, `${id}: ${key}`));
		}
		const weight = fields.has("weight") ? parsePositiveSafeInteger(fields.get("weight")) : 0;
		if (weight === null) issues.push(issue("invalid-weight", line, id));
		if (fields.has("enabled") && fields.get("enabled") !== "true" && fields.get("enabled") !== "false") {
			issues.push(issue("invalid-boolean", line, `${id}: enabled`));
		}
		const enabled = fields.get("enabled") === "true";
		if (kind === "proverb") {
			parsed.proverbs.push({ id, enabled, weight: weight ?? 0, parts: current.parts });
		} else if (kind === "gloss") {
			parsed.glosses.push({ id, enabled, weight: weight ?? 0, requires: current.requires, parts: current.parts });
		} else if (kind === "literal") {
			if (body === null) issues.push(issue("missing-body", line, id));
			parsed.literals.push({ id, literal: body ?? "" });
		} else {
			parsed.profiles.push({ id, kind: fields.get("kind") ?? "", forms: current.forms });
		}
		current = null;
	};
	for (const [index, raw] of lines.entries()) {
		const line = index + 1;
		if (raw === "") {
			if (state === "fields") state = current.kind === "literal" ? "body" : "after-fields";
			continue;
		}
		if (raw === ">" || raw.startsWith("> ")) continue;
		if (raw.startsWith("#")) {
			const heading = HEADING.exec(raw);
			if (heading) {
				finish();
				seenFirstEntry = true;
				const [, kind, id] = heading;
				if (!ENTRY_KINDS.includes(kind)) issues.push(issue("unknown-entry-kind", line, kind));
				current = { kind, id, line, fields: new Map(), body: null, parts: [], requires: [], forms: [], phase: "fields" };
				entryLines.set(id, line);
				state = "fields";
				continue;
			}
			if (TITLE.test(raw)) {
				if (seenFirstEntry) issues.push(issue("unexpected-title", line));
				else if (sawTitle) issues.push(issue("duplicate-title", line));
				sawTitle = true;
			} else issues.push(issue("unknown-heading", line));
			continue;
		}
		if (state === "metadata") {
			const field = FIELD.exec(raw);
			if (!field) { issues.push(issue("orphan-content", line)); continue; }
			const [, key, value] = field;
			if (!METADATA_KEYS.includes(key)) { issues.push(issue("unknown-metadata", line, key)); continue; }
			if (metadata.has(key)) { issues.push(issue("duplicate-metadata", line, key)); continue; }
			const numeric = parsePositiveSafeInteger(value);
			if (numeric === null) issues.push(issue("invalid-metadata", line, key));
			metadata.set(key, numeric ?? 0);
			entryLines.set(key, line);
			continue;
		}
		if (current === null) { issues.push(issue("orphan-content", line)); continue; }
		if (state === "fields") {
			const field = FIELD.exec(raw);
			if (!field || !ENTRY_KINDS.includes(current.kind)) { issues.push(issue("invalid-field", line, current.id)); continue; }
			const [, key, value] = field;
			const recipe = current.kind === "proverb" || current.kind === "gloss";
			if (recipe && key === "part") {
				current.phase = "parts";
				const part = parsePart(value, line, current.id, issues);
				if (part !== null) current.parts.push(part);
				continue;
			}
			if (current.kind === "gloss" && key === "requires") {
				// Requirements precede every part: a gloss declares what it binds
				// before it can reference it.
				if (current.phase === "parts") { issues.push(issue("requires-after-part", line, current.id)); continue; }
				current.phase = "requires";
				const requirement = parseRequirement(value, line, current.id, issues);
				if (requirement !== null) current.requires.push(requirement);
				continue;
			}
			if (current.kind === "profile" && key === "form") {
				const form = parseForm(value, line, current.id, issues);
				if (form !== null) current.forms.push(form);
				continue;
			}
			if (!SCALAR_FIELDS[current.kind].includes(key)) {
				issues.push(issue("unknown-field", line, `${current.id}: ${key}`)); continue;
			}
			if (current.phase !== "fields") { issues.push(issue("misplaced-field", line, `${current.id}: ${key}`)); continue; }
			if (current.fields.has(key)) { issues.push(issue("duplicate-field", line, `${current.id}: ${key}`)); continue; }
			current.fields.set(key, value);
			continue;
		}
		if (state === "body") {
			if (raw !== raw.trim()) issues.push(issue("body-whitespace", line, current.id));
			current.body = raw;
			state = "after-body";
		} else issues.push(issue(state === "after-fields" ? "unexpected-body" : "duplicate-body", line, current.id));
	}
	finish();
	for (const key of METADATA_KEYS) {
		if (!metadata.has(key)) issues.push(issue("missing-metadata", 1, key));
	}
	if (!seenFirstEntry) issues.push(issue("no-entries", lines.length));
	if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
	const input = { schemaVersion: metadata.get("schema-version"), dataVersion: metadata.get("data-version"), ...parsed };
	const result = compiler.compileFakeProverbRecipeSet(input);
	if (!result.ok) {
		return { ok: false, issues: Object.freeze(result.issues.map((entry) =>
			issue(entry.code, entryLines.get(entry.id) ?? 1, entry.detail === undefined ? entry.id : `${entry.id}: ${entry.detail}`))
			.sort((a, b) => a.line - b.line)) };
	}
	return { ok: true, ...input };
}

/**
 * The product's own recipe compiler, loaded from source.
 *
 * It is bundled in memory and imported from a data URL, so the generator runs
 * exactly the validator later slices will run — there is no second
 * implementation of "is this recipe set valid", and no path that reaches the
 * generated file without passing it. `compileRecipeSet.ts` depends only on the
 * hand-written schema, never on the generated entries, so loading it here
 * cannot become circular.
 */
async function loadRecipeCompiler(rootDir) {
	const built = await esbuild.build({
		entryPoints: [path.join(rootDir, FAKE_PROVERB_RECIPE_VALIDATORS[0])],
		bundle: true,
		write: false,
		format: "esm",
		platform: "neutral",
		target: "es2021",
		legalComments: "none",
		logLevel: "silent",
	});
	const code = built.outputFiles[0].text;
	return await import(
		`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`
	);
}

function renderEntry(fields) {
	const body = fields.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
	return `\t{ ${body} },`;
}

/**
 * Renders the generated module.
 *
 * Byte-identical for the same parsed document: no timestamp, no absolute path,
 * no locale-dependent ordering and no random value. Entries keep the order the
 * document gives them, and `JSON.stringify` escapes each value without
 * touching its Japanese text.
 */
export function renderGeneratedFakeProverbRecipeModule(parsed) {
	const lines = [
		`// Generated from ${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN}. Do not edit this file.`,
		"//",
		`// Edit that document and run \`${GENERATE_COMMAND}\`. Every build re-derives`,
		"// this module from it and fails when the two disagree, so a hand edit here",
		"// cannot reach the artifact.",
		"",
		"import type {",
		"\tRawFakeProverbGloss,",
		"\tRawFakeProverbLiteral,",
		"\tRawFakeProverbProfile,",
		"\tRawFakeProverbRecipe,",
		'} from "../recipeData";',
		"",
		"/** The Recipe Schema this data was generated from. */",
		`export const STANDARD_FAKE_PROVERB_RECIPE_SCHEMA_VERSION = ${parsed.schemaVersion};`,
		"",
		"/**",
		" * The recipe data version the document declares.",
		" *",
		" * Later Fake Proverb Collect metadata uses this value as `recipeDataVersion`.",
		" * Adding, removing, reordering or reweighting an entry has to raise it.",
		" */",
		`export const STANDARD_FAKE_PROVERB_RECIPE_DATA_VERSION = ${parsed.dataVersion};`,
		"",
		"/**",
		" * SHA-256 of `STANDARD_FAKE_PROVERB_RECIPE_DATA_JSON`.",
		" *",
		" * Regeneration uses this digest and that JSON payload only to decide whether",
		" * a generated module is self-consistent enough to repair. Same-version",
		" * meaning changes are refused from the tracked lock, not from these fields.",
		" */",
		`export const STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST = "${fakeProverbRecipeDataDigest(parsed)}";`,
		"",
		"/**",
		" * Canonical recipe data as JSON. Regeneration compares this payload with the",
		" * digest so comments, formatting and entry-array hand edits can be restored",
		" * from the Markdown. It is not the version authority.",
		" */",
		`export const STANDARD_FAKE_PROVERB_RECIPE_DATA_JSON = ${JSON.stringify(fakeProverbRecipeDataJson(parsed))};`,
		"",
		`/** ${parsed.proverbs.length} proverb recipes, in document order. */`,
		"export const STANDARD_FAKE_PROVERB_PROVERBS: readonly RawFakeProverbRecipe[] = [",
		...parsed.proverbs.map((entry) =>
			renderEntry([
				["id", entry.id],
				["enabled", entry.enabled],
				["weight", entry.weight],
				["parts", entry.parts],
			]),
		),
		"];",
		"",
		`/** ${parsed.glosses.length} gloss recipes, in document order. */`,
		"export const STANDARD_FAKE_PROVERB_GLOSSES: readonly RawFakeProverbGloss[] = [",
		...parsed.glosses.map((entry) =>
			renderEntry([
				["id", entry.id],
				["enabled", entry.enabled],
				["weight", entry.weight],
				["requires", entry.requires],
				["parts", entry.parts],
			]),
		),
		"];",
		"",
		`/** ${parsed.literals.length} fixed literals, in document order. */`,
		"export const STANDARD_FAKE_PROVERB_LITERALS: readonly RawFakeProverbLiteral[] = [",
		...parsed.literals.map((entry) =>
			renderEntry([
				["id", entry.id],
				["literal", entry.literal],
			]),
		),
		"];",
		"",
		`/** ${parsed.profiles.length} candidate profiles, in document order. */`,
		"export const STANDARD_FAKE_PROVERB_PROFILES: readonly RawFakeProverbProfile[] = [",
		...parsed.profiles.map((entry) =>
			renderEntry([
				["id", entry.id],
				["kind", entry.kind],
				["forms", entry.forms],
			]),
		),
		"];",
		"",
	];
	return lines.join("\n");
}

/**
 * The generated module is rendered with `\n`, but a checkout can hold it with
 * `\r\n` — Git's `core.autocrlf` does exactly that on Windows. Line endings are
 * the file's presentation, never its content: no recipe literal contains one,
 * so normalising them before the comparison cannot hide a stale or edited
 * entry, while comparing raw bytes would call a perfectly good checkout stale.
 * `.gitattributes` pins `\n` as well.
 */
function normalizeLineEndings(source) {
	return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function errorCode(error) {
	if (typeof error === "object" && error !== null && typeof error.code === "string" && error.code !== "") {
		return error.code;
	}
	return undefined;
}

function asError(value) {
	return value instanceof Error ? value : new Error(String(value));
}

async function readRequiredText(filePath, label, readText) {
	try {
		return await readText(filePath);
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			throw new Error(`${label} is missing. Run \`${GENERATE_COMMAND}\`.`);
		}
		throw new Error(
			`${label} is unreadable (${errorCode(error) ?? "unknown"}). Restore read access, then rebuild.`,
			{ cause: asError(error) },
		);
	}
}

async function readOptionalText(filePath, readText) {
	try {
		return await readText(filePath);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return null;
		throw error;
	}
}

/**
 * Parses and validates the document, and returns the module text it implies.
 *
 * Structural problems are reported first; only a document that parses is
 * handed to the compiler, so a build failure is not a pile of consequences of
 * one malformed heading. A missing document is reported as missing, and any
 * other read failure as unreadable with its cause.
 */
export async function generateStandardFakeProverbRecipes(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const markdown = options.markdown ?? (await readRequiredText(
		options.markdownPath ?? path.join(rootDir, STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN),
		STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN,
		(filePath) => readFile(filePath, "utf8"),
	));
	const compiler = await loadRecipeCompiler(rootDir);
	const parsed = parseWithCompiler(markdown, compiler);
	if (!parsed.ok) {
		throw new Error(
			`${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN} is not a valid recipe document: ${describeFakeProverbSourceIssues(parsed.issues)}`,
		);
	}
	const data = canonicalFakeProverbRecipeData(parsed);
	const compiled = compiler.compileFakeProverbRecipeSet(data);
	if (!compiled.ok) {
		throw new Error(
			`${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN} does not compile: ${compiled.issues
				.map(compiler.describeFakeProverbRecipeIssue)
				.join("; ")}`,
		);
	}
	return { parsed: data, compiled: compiled.set, source: renderGeneratedFakeProverbRecipeModule(data) };
}

/**
 * Fails unless the generated module and the tracked version lock both match
 * the document. Called by every build, so stale or hand-edited generated data
 * cannot be bundled, and a same-version meaning change cannot pass by rewriting
 * only the generated module. Destination absence is only ENOENT; any other
 * read failure is reported as unreadable and does not tell the caller to
 * regenerate. Nothing is ever written.
 */
export async function assertStandardFakeProverbRecipesGenerated(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { source, parsed } = await generateStandardFakeProverbRecipes(options);
	const generatedPath = options.generatedPath ?? path.join(rootDir, STANDARD_FAKE_PROVERB_RECIPES_GENERATED);
	const lockFile = options.lockPath ?? path.join(rootDir, STANDARD_FAKE_PROVERB_RECIPES_LOCK);
	const readText = options.readText ?? ((filePath) => readFile(filePath, "utf8"));
	const current = await readRequiredText(generatedPath, STANDARD_FAKE_PROVERB_RECIPES_GENERATED, readText);
	if (normalizeLineEndings(current) !== normalizeLineEndings(source)) {
		throw new Error(
			`${STANDARD_FAKE_PROVERB_RECIPES_GENERATED} does not match ${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN}. Run \`${GENERATE_COMMAND}\`.`,
		);
	}
	const lockSource = await readRequiredText(lockFile, STANDARD_FAKE_PROVERB_RECIPES_LOCK, readText);
	const lock = inspectRecipeLock(lockSource);
	if (!lock.ok) {
		throw new Error(
			`${STANDARD_FAKE_PROVERB_RECIPES_LOCK} is not a trustworthy recipe lock (${lock.code}). Run \`${GENERATE_COMMAND}\`.`,
		);
	}
	if (lock.digest !== fakeProverbRecipeDataDigest(parsed) || lock.dataVersion !== parsed.dataVersion) {
		throw new Error(
			`${STANDARD_FAKE_PROVERB_RECIPES_LOCK} does not record the current recipe data. Raise data-version and run \`${GENERATE_COMMAND}\`.`,
		);
	}
	return { schemaVersion: parsed.schemaVersion, dataVersion: parsed.dataVersion };
}

/**
 * The bundle-time guard.
 *
 * `prepareBundleInputs` checks the document once before a build starts, which
 * is enough for a one-shot build but not for a watching one. This plugin
 * repeats the check on every build and rebuild. Production does not import the
 * generated module in this slice, so resolving the `src/main.ts` entry point
 * registers the document, the generated module, the lock and both source
 * validators as watch files.
 *
 * That hook is an entry-point `onResolve`, deliberately not an `onLoad`:
 * esbuild keeps the watch files of only one `onLoad` result per module, so a
 * second `onLoad` hook on `src/main.ts` would silently drop — or be dropped by
 * — the Collision guard's own `src/main.ts` hook depending on plugin order. The
 * hook returns the entry's own absolute path in the default file namespace
 * together with the watch files: esbuild ignores (and warns about) watch files
 * returned without a path, and resolving the entry to itself leaves loading to
 * the Collision guard or esbuild's own loader, in either plugin order. The
 * normal build therefore emits no warning. A plugin-resolved path gets the
 * project's tsconfig only when the build names it explicitly (otherwise the
 * entry silently loses `strict`), so the guard refuses to start without a
 * `tsconfig` build option; `bundleOptions` supplies one. Neither hook regenerates anything. A failed start reports the caught Error as the esbuild message
 * `detail`, so an unreadable destination keeps its cause.
 */
export const FAKE_PROVERB_GUARD_NAME = "semantropy-standard-fake-proverb-recipes";

export function standardFakeProverbRecipesPlugin(rootDir, options = {}) {
	const generated = path.resolve(rootDir, STANDARD_FAKE_PROVERB_RECIPES_GENERATED);
	const mainEntry = path.resolve(rootDir, "src", "main.ts");
	const watchFiles = [
		path.resolve(rootDir, STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN),
		generated,
		path.resolve(rootDir, STANDARD_FAKE_PROVERB_RECIPES_LOCK),
		...FAKE_PROVERB_RECIPE_VALIDATORS.map((file) => path.resolve(rootDir, file)),
	];
	return {
		name: FAKE_PROVERB_GUARD_NAME,
		setup(build) {
			const tsconfig = build.initialOptions?.tsconfig;
			build.onStart(async () => {
				// Resolving the entry here makes it plugin-resolved, and esbuild only
				// applies a tsconfig to such a path when the build names one; without
				// it the entry silently loses `strict` (its "use strict" directive).
				if (typeof tsconfig !== "string" || tsconfig === "") {
					return { errors: [{ text: `${FAKE_PROVERB_GUARD_NAME} requires an explicit \`tsconfig\` build option, so the entry it resolves keeps the project's TypeScript settings.` }] };
				}
				try {
					await assertStandardFakeProverbRecipesGenerated({ rootDir, readText: options.readText });
					return null;
				} catch (error) {
					const failure = asError(error);
					return { errors: [{ text: failure.message, detail: failure }] };
				}
			});
			// esbuild compiles filters with Go's regexp engine, which has no `u` flag.
			build.onLoad({ filter: /standardFakeProverbRecipeEntries\.ts$/ }, async (args) => {
				if (path.resolve(args.path) !== generated) return null;
				return { contents: await readFile(args.path, "utf8"), loader: "ts", watchFiles };
			});
			build.onResolve({ filter: /main\.ts$/ }, (args) => {
				if (args.kind !== "entry-point" || path.resolve(args.resolveDir, args.path) !== mainEntry) return null;
				// The entry resolves to itself in the default file namespace, so
				// loading is untouched; esbuild ignores watch files without a path.
				return { path: mainEntry, watchFiles };
			});
		},
	};
}

const DIGEST_EXPORT = "STANDARD_FAKE_PROVERB_RECIPE_DATA_DIGEST";
const PAYLOAD_EXPORT = "STANDARD_FAKE_PROVERB_RECIPE_DATA_JSON";
const PAYLOAD_KEYS = ["schemaVersion", "dataVersion", "proverbs", "glosses", "literals", "profiles"];
const VALID_DIGEST = /^[0-9a-f]{64}$/;
const UNEVALUABLE = Symbol("unevaluable");

function isExportedVariableStatement(statement) {
	if (!ts.isVariableStatement(statement)) return false;
	const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : statement.modifiers;
	return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function unwrapLiteral(node) {
	if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)) {
		return unwrapLiteral(node.expression);
	}
	if (typeof ts.isSatisfiesExpression === "function" && ts.isSatisfiesExpression(node)) {
		return unwrapLiteral(node.expression);
	}
	return node;
}

function evaluateClosedLiteral(node) {
	const value = unwrapLiteral(node);
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
	if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = evaluateClosedLiteral(value.left);
		const right = evaluateClosedLiteral(value.right);
		return typeof left === "string" && typeof right === "string" ? `${left}${right}` : UNEVALUABLE;
	}
	return UNEVALUABLE;
}

function collectExportedConstInitializers(source) {
	const file = ts.createSourceFile("standardFakeProverbRecipeEntries.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
	const byName = new Map();
	for (const statement of file.statements) {
		if (!isExportedVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name)) continue;
			const list = byName.get(declaration.name.text) ?? [];
			list.push(declaration.initializer ?? null);
			byName.set(declaration.name.text, list);
		}
	}
	return byName;
}

function inspectNamedStringExport(byName, name, codePrefix) {
	const initializers = byName.get(name);
	if (initializers === undefined || initializers.length === 0) return { ok: false, code: `missing-${codePrefix}` };
	if (initializers.length > 1) return { ok: false, code: `duplicate-${codePrefix}` };
	if (initializers[0] === null) return { ok: false, code: `malformed-${codePrefix}` };
	const value = evaluateClosedLiteral(initializers[0]);
	return typeof value === "string" ? { ok: true, value } : { ok: false, code: `malformed-${codePrefix}` };
}

function isCanonicalPayload(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	if (keys.length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((key, index) => keys[index] === key)) return false;
	if (value.schemaVersion !== 1) return false;
	if (typeof value.dataVersion !== "number" || parsePositiveSafeInteger(String(value.dataVersion)) === null) return false;
	return ["proverbs", "glosses", "literals", "profiles"].every((key) => Array.isArray(value[key]));
}

/**
 * The lock is `{ "versions": [{ "dataVersion": 1, "digest": … }, …] }`:
 * contiguous from 1, no gap, no repeat, no extra key and no legacy shape.
 * Anything else is untrustworthy and refused before a write.
 */
function inspectRecipeLock(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch {
		return { ok: false, code: "malformed-lock" };
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "malformed-lock" };
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "versions") return { ok: false, code: "malformed-lock" };
	const versions = value.versions;
	if (!Array.isArray(versions) || versions.length === 0) return { ok: false, code: "malformed-lock" };
	let previous = 0;
	for (const entry of versions) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry) ||
			Object.keys(entry).length !== 2 || !Object.hasOwn(entry, "dataVersion") || !Object.hasOwn(entry, "digest") ||
			typeof entry.dataVersion !== "number" || entry.dataVersion !== previous + 1 ||
			typeof entry.digest !== "string" || !VALID_DIGEST.test(entry.digest)) {
			return { ok: false, code: "malformed-lock" };
		}
		previous = entry.dataVersion;
	}
	return { ok: true, versions, ...versions[versions.length - 1] };
}

/**
 * Reads a generated module's digest and canonical JSON payload to decide
 * whether that file is self-consistent enough to repair. Comments, formatting
 * and TypeScript entry arrays are ignored. Missing, duplicate, malformed or
 * self-inconsistent fields fail closed: they are not first generation and
 * they are not the version authority.
 */
function inspectExistingGeneratedModule(source) {
	const exports = collectExportedConstInitializers(source);
	const digest = inspectNamedStringExport(exports, DIGEST_EXPORT, "digest");
	if (!digest.ok) return digest;
	if (!VALID_DIGEST.test(digest.value)) return { ok: false, code: "malformed-digest" };
	const payloadJson = inspectNamedStringExport(exports, PAYLOAD_EXPORT, "payload");
	if (!payloadJson.ok) return payloadJson;
	let payload;
	try {
		payload = JSON.parse(payloadJson.value);
	} catch {
		return { ok: false, code: "malformed-payload" };
	}
	if (!isCanonicalPayload(payload)) return { ok: false, code: "malformed-payload" };
	if (createHash("sha256").update(payloadJson.value).digest("hex") !== digest.value) {
		return { ok: false, code: "digest-inconsistent" };
	}
	return { ok: true, digest: digest.value, dataVersion: payload.dataVersion };
}

function canonicalFakeProverbRecipeData(parsed) {
	return {
		schemaVersion: parsed.schemaVersion,
		dataVersion: parsed.dataVersion,
		proverbs: parsed.proverbs,
		glosses: parsed.glosses,
		literals: parsed.literals,
		profiles: parsed.profiles,
	};
}

function fakeProverbRecipeDataJson(parsed) {
	return JSON.stringify(canonicalFakeProverbRecipeData(parsed));
}

/**
 * SHA-256 of the document's typed recipe data, independent of generated
 * comments, formatting and TypeScript wrapping.
 */
export function fakeProverbRecipeDataDigest(parsed) {
	return createHash("sha256").update(fakeProverbRecipeDataJson(parsed)).digest("hex");
}

function renderStandardFakeProverbRecipeLock(parsed, previousVersions) {
	const versions = previousVersions.map((entry) => ({ dataVersion: entry.dataVersion, digest: entry.digest }));
	if (!versions.some((entry) => entry.dataVersion === parsed.dataVersion)) {
		const nextVersion = (versions.at(-1)?.dataVersion ?? 0) + 1;
		if (parsed.dataVersion !== nextVersion) {
			throw new Error(
				`${STANDARD_FAKE_PROVERB_RECIPES_LOCK} must record contiguous versions starting at 1 (data-version-gap). Expected data-version ${nextVersion}; restore missing history instead of recreating it.`,
			);
		}
		versions.push({ dataVersion: parsed.dataVersion, digest: fakeProverbRecipeDataDigest(parsed) });
	}
	return `${JSON.stringify({ versions }, null, "\t")}\n`;
}

function appendFailures(failures, error) {
	if (error instanceof AggregateError) {
		for (const inner of error.errors) appendFailures(failures, inner);
		return;
	}
	failures.push(asError(error));
}

async function collectRemove(filePath, failures, beforeCleanup) {
	try {
		if (beforeCleanup !== undefined) await beforeCleanup(filePath);
		await rm(filePath, { force: true });
	} catch (error) {
		failures.push(asError(error));
	}
}

async function replaceAtomically(destination, contents, hooks = {}) {
	const staging = `${destination}.generating`;
	try {
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(staging, contents, "utf8");
		if (hooks.beforeRename !== undefined) await hooks.beforeRename(staging, destination);
		await rename(staging, destination);
	} catch (error) {
		const failures = [asError(error)];
		await collectRemove(staging, failures, hooks.beforeCleanup);
		if (failures.length === 1) throw error;
		throw new AggregateError(failures, `${destination} could not be replaced and its staging file could not be removed.`);
	}
}

function publicationFailure(publicationError, failures, rollbackError) {
	if (failures.length === 1) throw publicationError;
	const token = rollbackError === null ? "cleanup-failed" : "rollback-failed";
	const detail = rollbackError === null
		? "publication failed after the generated module was restored where possible; staging files may remain"
		: "was published but could not be restored";
	throw new AggregateError(
		failures,
		`${STANDARD_FAKE_PROVERB_RECIPES_GENERATED} ${detail} (${token}). The version lock is unchanged and remains the approved meaning. Restore a writable filesystem and run \`${GENERATE_COMMAND}\`.`,
	);
}

/**
 * Stages both outputs, publishes the generated module, then commits the lock.
 * The lock is the logical commit point. A later failure tries to restore the
 * generated module to its starting bytes (or remove it on first generation).
 * Staging cleanup failures are collected and never skip that rollback. If
 * rollback or cleanup fails, every error is reported and the lock stays at
 * the previously approved meaning.
 */
async function publishGeneratedAndLock(options) {
	const generatedStaging = `${options.outfile}.generating`;
	const lockStaging = `${options.lockFile}.generating`;
	let generatedPublished = false;
	try {
		await mkdir(path.dirname(options.outfile), { recursive: true });
		await writeFile(generatedStaging, options.source, "utf8");
		if (options.publishLock) {
			await mkdir(path.dirname(options.lockFile), { recursive: true });
			await writeFile(lockStaging, options.nextLock, "utf8");
		}
		if (options.beforePublish !== undefined) await options.beforePublish("generated");
		await rename(generatedStaging, options.outfile);
		generatedPublished = true;
		if (options.publishLock) {
			if (options.beforePublish !== undefined) await options.beforePublish("lock");
			await rename(lockStaging, options.lockFile);
		}
	} catch (error) {
		const failures = [asError(error)];
		await collectRemove(generatedStaging, failures, options.beforeCleanup);
		await collectRemove(lockStaging, failures, options.beforeCleanup);
		let rollbackError = null;
		if (generatedPublished) {
			try {
				if (options.beforeRollback !== undefined) await options.beforeRollback();
				if (options.previousGenerated === null) {
					await rm(options.outfile, { force: true });
				} else {
					await replaceAtomically(options.outfile, options.previousGenerated, {
						beforeRename: options.beforeRollbackRename,
						beforeCleanup: options.beforeCleanup,
					});
				}
			} catch (caught) {
				rollbackError = asError(caught);
				appendFailures(failures, caught);
				await collectRemove(generatedStaging, failures, options.beforeCleanup);
			}
		}
		publicationFailure(error, failures, rollbackError);
	}
}

/**
 * Writes the generated module and, when the approved meaning changes, the
 * tracked version lock.
 *
 * The document is parsed and compiled before anything is written, so a refused
 * document leaves the previous generated file and lock untouched. First
 * generation is allowed only at data-version 1 when both destination reads
 * fail with ENOENT. Later versions must extend contiguous history from 1. Any
 * other read failure is propagated before staging begins and is never
 * reported as a missing file. An existing generated module whose digest or
 * canonical JSON payload is missing, malformed, duplicated or inconsistent
 * fails closed. Comment, format and entry-array edits that leave a
 * self-consistent payload are restored when the lock still records the
 * document. Same-version meaning changes and version rollbacks are refused
 * from the lock, even if the generated payload and digest were rewritten
 * together.
 *
 * When both destinations change, both are staged first, the generated module
 * is published, and the lock is the logical commit point. A failure before the
 * lock is published tries to restore the generated module to its starting
 * bytes (removing a newly created generated module) and leaves no staging
 * file. Staging cleanup failures are collected and do not skip rollback. If
 * rollback or cleanup cannot be performed, the error is an AggregateError
 * that names the publication failure and every later failure; the lock still
 * holds the previously approved meaning, and a later generate after the
 * filesystem is writable repairs the pair.
 */
export async function writeStandardFakeProverbRecipes(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { source, parsed } = await generateStandardFakeProverbRecipes(options);
	const outfile = options.generatedPath ?? path.join(rootDir, STANDARD_FAKE_PROVERB_RECIPES_GENERATED);
	const lockFile = options.lockPath ?? path.join(rootDir, STANDARD_FAKE_PROVERB_RECIPES_LOCK);
	const nextDigest = fakeProverbRecipeDataDigest(parsed);
	const readText = options.readText ?? ((filePath) => readFile(filePath, "utf8"));
	const previous = await readOptionalText(outfile, readText);
	const previousLock = await readOptionalText(lockFile, readText);
	const firstGeneration = previous === null && previousLock === null;
	let previousVersions = [];

	if (!firstGeneration) {
		if (previousLock === null) {
			throw new Error(
				`${STANDARD_FAKE_PROVERB_RECIPES_LOCK} is missing. Revert the generated module, then run \`${GENERATE_COMMAND}\`.`,
			);
		}
		const lock = inspectRecipeLock(previousLock);
		if (!lock.ok) {
			throw new Error(
				`${STANDARD_FAKE_PROVERB_RECIPES_LOCK} is not a trustworthy recipe lock (${lock.code}). Revert that lock, then run \`${GENERATE_COMMAND}\`.`,
			);
		}
		previousVersions = lock.versions;
		if (previous !== null) {
			const existing = inspectExistingGeneratedModule(previous);
			if (!existing.ok) {
				throw new Error(
					`${STANDARD_FAKE_PROVERB_RECIPES_GENERATED} is not a trustworthy previous recipe module (${existing.code}). Revert that generated file, then run \`${GENERATE_COMMAND}\`.`,
				);
			}
		}
		if (parsed.dataVersion < lock.dataVersion || (lock.digest !== nextDigest && parsed.dataVersion === lock.dataVersion)) {
			throw new Error(
				`${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN} changed its recipe data without raising data-version (data-version-unchanged). Raise data-version and run \`${GENERATE_COMMAND}\`.`,
			);
		}
	}

	const nextLock = renderStandardFakeProverbRecipeLock(parsed, previousVersions);
	const publishLock = previousLock === null || normalizeLineEndings(previousLock) !== normalizeLineEndings(nextLock);
	await publishGeneratedAndLock({
		outfile,
		lockFile,
		source,
		nextLock,
		previousGenerated: previous,
		publishLock,
		beforePublish: options.beforePublish,
		beforeRollback: options.beforeRollback,
		beforeRollbackRename: options.beforeRollbackRename,
		beforeCleanup: options.beforeCleanup,
	});

	return {
		outfile: STANDARD_FAKE_PROVERB_RECIPES_GENERATED,
		schemaVersion: parsed.schemaVersion,
		dataVersion: parsed.dataVersion,
		proverbs: parsed.proverbs.length,
		glosses: parsed.glosses.length,
		literals: parsed.literals.length,
		profiles: parsed.profiles.length,
	};
}
