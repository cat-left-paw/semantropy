/**
 * PRE-RELEASE-COLLISION-TEMPLATES1: the build-time owner of the standard
 * Collision pattern document.
 *
 * `resources/collision/standard-patterns.md` is the one document a human
 * edits. This module parses it, validates it through the product's own
 * `compileCollisionPatternSet`, and renders the typed data a later slice will
 * import. Nothing here ships: the parser, `node:fs` and the Markdown itself
 * stay outside the plugin bundle.
 *
 * The parse is line-oriented and never depends on how Markdown renders. It
 * refuses anything it does not recognise rather than skipping it, so an entry
 * cannot be lost to a typo, and it reports every problem it finds in document
 * order so one failing build names them all.
 */
import esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

/** Relative to the plugin root, in POSIX form, for messages and copy lists. */
export const STANDARD_COLLISION_PATTERNS_MARKDOWN = "resources/collision/standard-patterns.md";
export const STANDARD_COLLISION_PATTERNS_GENERATED =
	"src/collision/generated/standardCollisionPatternEntries.ts";
/**
 * Tracked version→digest authority for same-version meaning changes.
 * Regeneration may repair the generated TypeScript module; it must not treat
 * that module as proof of a previously approved meaning.
 */
export const STANDARD_COLLISION_PATTERNS_LOCK = "resources/collision/standard-patterns.lock.json";

/** How to refresh the generated module; named by every staleness failure. */
export const GENERATE_COMMAND = "npm run generate:collision-patterns";

// Shared compiler for the synchronous parser API. Build/watch re-load their root's
// compiler for each generation, so later edits never use a stale validator.
const sourceCompiler = await loadPatternCompiler(fileURLToPath(new URL("../../", import.meta.url)));
export const COLLISION_PATTERN_SCHEMA_VERSION = sourceCompiler.COLLISION_PATTERN_SCHEMA_VERSION;
export const COLLISION_LITERAL_MAX_CODE_POINTS = sourceCompiler.COLLISION_LITERAL_MAX_CODE_POINTS;

const ENTRY_FIELDS = Object.freeze({
	recipe: ["label", "enabled", "selectable", "weight", "part", "presence"],
	literal: [],
	connector: ["form", "weight"],
	"modifier-form": ["class", "variant", "weight"],
	"noun-suffix": ["weight"],
});
const METADATA_KEYS = ["schema-version", "data-version"];
const HEADING = /^## ([^ ]+) (.+)$/u;
const TITLE = /^# (.+)$/u;
const FIELD = /^([a-z][a-z0-9-]*): (.*)$/su;
const INTEGER = /^(0|[1-9][0-9]*)$/u;

function issue(code, line, detail) {
	return detail === undefined ? { code, line } : { code, line, detail };
}

export function describeCollisionSourceIssue(entry) {
	const where = entry.line === undefined ? "" : ` (line ${entry.line})`;
	return entry.detail === undefined ? `${entry.code}${where}` : `${entry.code}${where}: ${entry.detail}`;
}

export function describeCollisionSourceIssues(issues) {
	return issues.map(describeCollisionSourceIssue).join("; ");
}

function parsePositiveSafeInteger(value) {
	const numeric = Number(value);
	return INTEGER.test(value) && Number.isSafeInteger(numeric) && numeric >= 1 && String(numeric) === value
		? numeric : null;
}

function bodyPolicy(current) {
	if (["literal", "noun-suffix"].includes(current.kind)) return "required";
	if (current.kind === "connector") return current.fields.get("form") === "literal" ? "required" : "forbidden";
	return "forbidden";
}

function parsePart(value, line, id, issues) {
	const words = value.split(" ");
	const [kind, slotId, requirement, reference] = words;
	if (!["noun", "modifier", "connector", "predicate", "literal"].includes(kind)) {
		issues.push(issue("invalid-part-kind", line, id));
		return null;
	}
	const hasReference = ["modifier", "predicate", "literal"].includes(kind);
	if (words.some((word) => word === "") || words.length !== (hasReference ? 4 : 3)) {
		issues.push(issue("invalid-part", line, id));
		return null;
	}
	if (requirement !== "required" && requirement !== "optional") {
		issues.push(issue("invalid-optional", line, id));
		return null;
	}
	return {
		kind, slotId, optional: requirement === "optional",
		...(kind === "literal" ? { literalId: reference } : hasReference ? { profile: reference } : {}),
	};
}

function parsePresence(value, line, id, issues) {
	const match = /^([^ ]+) ([^ ]+)$/u.exec(value);
	if (!match) {
		issues.push(issue("invalid-presence", line, id));
		return null;
	}
	const weight = parsePositiveSafeInteger(match[2]);
	if (weight === null) issues.push(issue("invalid-weight", line, id));
	const slots = match[1] === "none" ? [] : match[1].split(",");
	if (slots.some((slot) => slot === "")) issues.push(issue("invalid-presence", line, id));
	return { slots, weight: weight ?? 0 };
}

/** Strict line syntax followed by the same semantic compiler used by generation. */
export function parseStandardCollisionPatternMarkdown(markdown) {
	return parseWithCompiler(markdown, sourceCompiler);
}

function parseWithCompiler(markdown, compiler) {
	const issues = [];
	const lines = String(markdown).replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);
	const metadata = new Map();
	const entryLines = new Map();
	const parsed = { recipes: [], literals: [], connectors: [], modifierForms: [], nounSuffixes: [] };
	let sawTitle = false;
	let seenFirstEntry = false;
	let current = null;
	let state = "metadata";
	const finish = () => {
		if (current === null) return;
		const { kind, id, line, fields, body } = current;
		for (const key of Object.hasOwn(ENTRY_FIELDS, kind) ? ENTRY_FIELDS[kind] : []) {
			if (key !== "presence" && key !== "part" && !fields.has(key)) issues.push(issue("missing-field", line, `${id}: ${key}`));
		}
		if (bodyPolicy(current) === "required" && body === null) issues.push(issue("missing-body", line, id));
		const weightText = fields.get("weight");
		const weight = weightText === undefined ? 0 : parsePositiveSafeInteger(weightText);
		if (weight === null) issues.push(issue("invalid-weight", line, id));
		if (kind === "recipe") {
			for (const key of ["enabled", "selectable"]) {
				if (fields.has(key) && fields.get(key) !== "true" && fields.get(key) !== "false") issues.push(issue("invalid-boolean", line, `${id}: ${key}`));
			}
			parsed.recipes.push({ id, label: fields.get("label") ?? "", enabled: fields.get("enabled") === "true",
				selectable: fields.get("selectable") === "true", weight: weight ?? 0, parts: current.parts, presence: current.presence });
		} else if (kind === "literal") parsed.literals.push({ id, literal: body ?? "" });
		else if (kind === "connector") parsed.connectors.push({ id, form: fields.get("form") ?? "", weight: weight ?? 0, literal: body });
		else if (kind === "modifier-form") parsed.modifierForms.push({ id, class: fields.get("class") ?? "", variant: fields.get("variant") ?? "", weight: weight ?? 0 });
		else if (kind === "noun-suffix") parsed.nounSuffixes.push({ id, weight: weight ?? 0, literal: body ?? "" });
		current = null;
	};
	for (const [index, raw] of lines.entries()) {
		const line = index + 1;
		if (raw === "") {
			if (state === "fields") state = bodyPolicy(current) === "required" ? "body" : "after-fields";
			continue;
		}
		if (raw === ">" || raw.startsWith("> ")) continue;
		if (raw.startsWith("#")) {
			const heading = HEADING.exec(raw);
			if (heading) {
				finish();
				seenFirstEntry = true;
				const [, kind, id] = heading;
				if (!Object.hasOwn(ENTRY_FIELDS, kind)) issues.push(issue("unknown-entry-kind", line, kind));
				current = { kind, id, line, fields: new Map(), body: null, parts: [], presence: [] };
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
			if (!field) { issues.push(issue("invalid-field", line, current.id)); continue; }
			const [, key, value] = field;
			if (!Object.hasOwn(ENTRY_FIELDS, current.kind) || !ENTRY_FIELDS[current.kind].includes(key)) {
				issues.push(issue("unknown-field", line, `${current.id}: ${key}`)); continue;
			}
			if (key === "part" || key === "presence") {
				const entry = key === "part" ? parsePart(value, line, current.id, issues) : parsePresence(value, line, current.id, issues);
				if (entry !== null) current[key === "part" ? "parts" : "presence"].push(entry);
				continue;
			}
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
	const result = compiler.compileCollisionPatternSet({ schemaVersion: metadata.get("schema-version"), dataVersion: metadata.get("data-version"), ...parsed });
	if (!result.ok) return { ok: false, issues: Object.freeze(result.issues.map((entry) =>
		issue(entry.code, entryLines.get(entry.id) ?? 1, entry.id)).sort((a, b) => a.line - b.line)) };
	return { ok: true, ...result.set };
}

/**
 * The product's own pattern compiler, loaded from source.
 *
 * It is bundled in memory and imported from a data URL, so the generator runs
 * exactly the validator later slices will run — there is no second
 * implementation of "is this pattern set valid", and no path that reaches the
 * generated file without passing it. `compilePatternSet.ts` depends only on
 * the hand-written schema, never on the generated entries, so loading it here
 * cannot become circular.
 */
async function loadPatternCompiler(rootDir) {
	const built = await esbuild.build({
		entryPoints: [path.join(rootDir, "src", "collision", "compilePatternSet.ts")],
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
 * document gives them, and `JSON.stringify` escapes each body without touching
 * its Japanese text.
 */
export function renderGeneratedCollisionPatternModule(parsed) {
	const lines = [
		`// Generated from ${STANDARD_COLLISION_PATTERNS_MARKDOWN}. Do not edit this file.`,
		"//",
		`// Edit that document and run \`${GENERATE_COMMAND}\`. Every build re-derives`,
		"// this module from it and fails when the two disagree, so a hand edit here",
		"// cannot reach the artifact.",
		"",
		"import type {",
		"\tRawCollisionConnector,",
		"\tRawCollisionModifierForm,",
		"\tRawCollisionLiteral,",
		"\tRawCollisionNounSuffix,",
		"\tRawCollisionRecipe,",
		'} from "../patternData";',
		"",
		"/** The document schema this data was generated from. */",
		`export const STANDARD_COLLISION_PATTERN_SCHEMA_VERSION = ${parsed.schemaVersion};`,
		"",
		"/**",
		" * The pattern data version the document declares.",
		" *",
		" * Later Collision Collect metadata uses this value as `patternSetVersion`.",
		" * Adding, removing or reweighting an entry has to raise it.",
		" */",
		`export const STANDARD_COLLISION_PATTERN_DATA_VERSION = ${parsed.dataVersion};`,
		"",
		"/**",
		" * SHA-256 of `STANDARD_COLLISION_PATTERN_DATA_JSON`.",
		" *",
		" * Regeneration uses this digest and that JSON payload only to decide whether",
		" * a generated module is self-consistent enough to repair. Same-version",
		" * meaning changes are refused from the tracked lock, not from these fields.",
		" */",
		`export const STANDARD_COLLISION_PATTERN_DATA_DIGEST = "${collisionPatternDataDigest(parsed)}";`,
		"",
		"/**",
		" * Canonical pattern data as JSON. Regeneration compares this payload with",
		" * the digest so array comments, multiline formatting, and entry-array hand",
		" * edits can be restored from the Markdown. It is not the version authority.",
		" */",
		`export const STANDARD_COLLISION_PATTERN_DATA_JSON = ${JSON.stringify(collisionPatternDataJson(parsed))};`,
		"",
		`/** ${parsed.recipes.length} recipes, in document order. */`,
		"export const STANDARD_COLLISION_RECIPES: readonly RawCollisionRecipe[] = [",
		...parsed.recipes.map((entry) =>
			renderEntry([
				["id", entry.id],
				["label", entry.label],
				["enabled", entry.enabled],
				["selectable", entry.selectable],
				["weight", entry.weight],
				["parts", entry.parts],
				["presence", entry.presence],
			]),
		),
		"];",
		"",
		`/** ${parsed.literals.length} fixed literals, in document order. */`,
		"export const STANDARD_COLLISION_LITERALS: readonly RawCollisionLiteral[] = [",
		...parsed.literals.map((entry) =>
			renderEntry([
				["id", entry.id],
				["literal", entry.literal],
			]),
		),
		"];",
		"",
		`/** ${parsed.connectors.length} connectors, in document order. */`,
		"export const STANDARD_COLLISION_CONNECTORS: readonly RawCollisionConnector[] = [",
		...parsed.connectors.map((entry) =>
			renderEntry([
				["id", entry.id],
				["form", entry.form],
				["weight", entry.weight],
				["literal", entry.literal],
			]),
		),
		"];",
		"",
		`/** ${parsed.modifierForms.length} modifier forms, in document order. */`,
		"export const STANDARD_COLLISION_MODIFIER_FORMS: readonly RawCollisionModifierForm[] = [",
		...parsed.modifierForms.map((entry) =>
			renderEntry([
				["id", entry.id],
				["class", entry.class],
				["variant", entry.variant],
				["weight", entry.weight],
			]),
		),
		"];",
		"",
		`/** ${parsed.nounSuffixes.length} noun suffixes, in document order. */`,
		"export const STANDARD_COLLISION_NOUN_SUFFIXES: readonly RawCollisionNounSuffix[] = [",
		...parsed.nounSuffixes.map((entry) =>
			renderEntry([
				["id", entry.id],
				["weight", entry.weight],
				["literal", entry.literal],
			]),
		),
		"];",
		"",
	];
	return lines.join("\n");
}

/** Reads the document, refusing a missing one with the path that is expected. */
async function readPatternMarkdown(file) {
	return await readRequiredText(file, STANDARD_COLLISION_PATTERNS_MARKDOWN, (filePath) => readFile(filePath, "utf8"));
}

/**
 * The generated module is rendered with `\n`, but a checkout can hold it with
 * `\r\n` — Git's `core.autocrlf` does exactly that on Windows. Line endings are
 * the file's presentation, never its content: no pattern literal contains one,
 * so normalising them before the comparison cannot hide a stale or edited
 * entry, while comparing raw bytes would call a perfectly good checkout stale.
 * `.gitattributes` pins `\n` as well; this is the belt to that's braces.
 */
function normalizeLineEndings(source) {
	return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/**
 * Parses and validates the document, and returns the module text it implies.
 *
 * Structural problems are reported first; only a document that parses is
 * handed to the compiler, so a build failure is not a pile of consequences of
 * one malformed heading.
 */
export async function generateStandardCollisionPatterns(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const markdown =
		options.markdown ??
		(await readPatternMarkdown(
			options.markdownPath ?? path.join(rootDir, STANDARD_COLLISION_PATTERNS_MARKDOWN),
		));
	const compiler = await loadPatternCompiler(rootDir);
	const parsed = parseWithCompiler(markdown, compiler);
	if (!parsed.ok) {
		throw new Error(
			`${STANDARD_COLLISION_PATTERNS_MARKDOWN} is not a valid pattern document: ${describeCollisionSourceIssues(parsed.issues)}`,
		);
	}
	const compiled = compiler.compileCollisionPatternSet({
		schemaVersion: parsed.schemaVersion,
		dataVersion: parsed.dataVersion,
		recipes: parsed.recipes,
		literals: parsed.literals,
		connectors: parsed.connectors,
		modifierForms: parsed.modifierForms,
		nounSuffixes: parsed.nounSuffixes,
	});
	if (!compiled.ok) {
		throw new Error(
			`${STANDARD_COLLISION_PATTERNS_MARKDOWN} does not compile: ${compiled.issues
				.map(compiler.describeCollisionPatternIssue)
				.join("; ")}`,
		);
	}
	return {
		parsed,
		compiled: compiled.set,
		source: renderGeneratedCollisionPatternModule(parsed),
	};
}

function errorCode(error) {
	if (
		typeof error === "object" &&
		error !== null &&
		typeof error.code === "string" &&
		error.code !== ""
	) {
		return error.code;
	}
	return undefined;
}

function errorHasCode(error, code) {
	return errorCode(error) === code;
}

async function readRequiredText(filePath, label, readText) {
	try {
		return await readText(filePath);
	} catch (error) {
		if (errorHasCode(error, "ENOENT")) {
			throw new Error(`${label} is missing. Run \`${GENERATE_COMMAND}\`.`);
		}
		throw new Error(
			`${label} is unreadable (${errorCode(error) ?? "unknown"}). Restore read access, then rebuild.`,
			{ cause: asError(error) },
		);
	}
}

/**
 * Fails unless the generated module and the tracked version lock both match
 * the document. Called by every build, so stale or hand-edited generated data
 * cannot be bundled, and a same-version meaning change cannot pass by rewriting
 * only the generated module. Destination absence is only ENOENT; any other
 * read failure is reported as unreadable and does not tell the caller to
 * regenerate.
 */
export async function assertStandardCollisionPatternsGenerated(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { source, parsed } = await generateStandardCollisionPatterns(options);
	const generatedPath =
		options.generatedPath ?? path.join(rootDir, STANDARD_COLLISION_PATTERNS_GENERATED);
	const lockFile = options.lockPath ?? path.join(rootDir, STANDARD_COLLISION_PATTERNS_LOCK);
	const readText = options.readText ?? ((filePath) => readFile(filePath, "utf8"));
	const current = await readRequiredText(
		generatedPath,
		STANDARD_COLLISION_PATTERNS_GENERATED,
		readText,
	);
	if (normalizeLineEndings(current) !== normalizeLineEndings(source)) {
		throw new Error(
			`${STANDARD_COLLISION_PATTERNS_GENERATED} does not match ${STANDARD_COLLISION_PATTERNS_MARKDOWN}. Run \`${GENERATE_COMMAND}\`.`,
		);
	}
	const lockSource = await readRequiredText(lockFile, STANDARD_COLLISION_PATTERNS_LOCK, readText);
	const lock = inspectPatternLock(lockSource);
	if (!lock.ok) {
		throw new Error(
			`${STANDARD_COLLISION_PATTERNS_LOCK} is not a trustworthy pattern lock (${lock.code}). Run \`${GENERATE_COMMAND}\`.`,
		);
	}
	if (
		lock.legacy || lock.digest !== collisionPatternDataDigest(parsed) ||
		lock.dataVersion !== parsed.dataVersion
	) {
		throw new Error(
			`${STANDARD_COLLISION_PATTERNS_LOCK} does not record the current pattern data. Raise data-version and run \`${GENERATE_COMMAND}\`.`,
		);
	}
	return { dataVersion: parsed.dataVersion, schemaVersion: parsed.schemaVersion };
}

/**
 * The bundle-time guard.
 *
 * `prepareBundleInputs` checks the document once before a build starts, which
 * is enough for a one-shot build but not for a watching one. This plugin
 * repeats the check on every build and rebuild. The generated module is not
 * imported by production this slice, so `onLoad` of that file would not run
 * during an ordinary watch; `src/main.ts` is therefore also a watch input so
 * that editing the document, the generated module, the version lock or either
 * source validator triggers a rebuild that then validates the current inputs.
 * Neither hook
 * regenerates anything by itself. A failed start reports the caught Error as
 * the esbuild message `detail`, so an unreadable destination keeps its cause.
 */
export function standardCollisionPatternsPlugin(rootDir, options = {}) {
	const generated = path.resolve(rootDir, STANDARD_COLLISION_PATTERNS_GENERATED);
	const markdown = path.resolve(rootDir, STANDARD_COLLISION_PATTERNS_MARKDOWN);
	const lockFile = path.resolve(rootDir, STANDARD_COLLISION_PATTERNS_LOCK);
	const mainEntry = path.resolve(rootDir, "src", "main.ts");
	const watchFiles = [
		markdown, generated, lockFile,
		path.resolve(rootDir, "src", "collision", "compilePatternSet.ts"),
		path.resolve(rootDir, "src", "collision", "patternData.ts"),
	];
	return {
		name: "semantropy-standard-collision-patterns",
		setup(build) {
			build.onStart(async () => {
				try {
					await assertStandardCollisionPatternsGenerated({
						rootDir,
						readText: options.readText,
					});
					return null;
				} catch (error) {
					const failure = asError(error);
					return {
						errors: [{ text: failure.message, detail: failure }],
					};
				}
			});
			// esbuild compiles filters with Go's regexp engine, which has no `u` flag.
			build.onLoad({ filter: /standardCollisionPatternEntries\.ts$/ }, async (args) => {
				if (path.resolve(args.path) !== generated) {
					return null;
				}
				return {
					contents: await readFile(args.path, "utf8"),
					loader: "ts",
					watchFiles,
				};
			});
			build.onLoad({ filter: /main\.ts$/ }, async (args) => {
				if (path.resolve(args.path) !== mainEntry) {
					return null;
				}
				return {
					contents: await readFile(args.path, "utf8"),
					loader: "ts",
					resolveDir: path.dirname(args.path),
					watchFiles,
				};
			});
		},
	};
}

const DIGEST_EXPORT = "STANDARD_COLLISION_PATTERN_DATA_DIGEST";
const PAYLOAD_EXPORT = "STANDARD_COLLISION_PATTERN_DATA_JSON";
const VALID_DIGEST = /^[0-9a-f]{64}$/;
const UNEVALUABLE = Symbol("unevaluable");

function isExportedVariableStatement(statement) {
	if (!ts.isVariableStatement(statement)) {
		return false;
	}
	const modifiers = ts.canHaveModifiers(statement)
		? ts.getModifiers(statement)
		: statement.modifiers;
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
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
		return value.text;
	}
	if (ts.isNumericLiteral(value)) {
		return Number(value.text);
	}
	if (value.kind === ts.SyntaxKind.TrueKeyword) {
		return true;
	}
	if (value.kind === ts.SyntaxKind.FalseKeyword) {
		return false;
	}
	if (value.kind === ts.SyntaxKind.NullKeyword) {
		return null;
	}
	if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken) {
		const operand = evaluateClosedLiteral(value.operand);
		return typeof operand === "number" ? -operand : UNEVALUABLE;
	}
	if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = evaluateClosedLiteral(value.left);
		const right = evaluateClosedLiteral(value.right);
		return typeof left === "string" && typeof right === "string" ? `${left}${right}` : UNEVALUABLE;
	}
	return UNEVALUABLE;
}

function collectExportedConstInitializers(source) {
	const file = ts.createSourceFile(
		"standardCollisionPatternEntries.ts",
		source,
		ts.ScriptTarget.ES2022,
		true,
		ts.ScriptKind.TS,
	);
	const byName = new Map();
	for (const statement of file.statements) {
		if (!isExportedVariableStatement(statement)) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name)) {
				continue;
			}
			const name = declaration.name.text;
			const list = byName.get(name) ?? [];
			list.push(declaration.initializer ?? null);
			byName.set(name, list);
		}
	}
	return byName;
}

function inspectNamedStringExport(byName, name, codePrefix) {
	const initializers = byName.get(name);
	if (initializers === undefined || initializers.length === 0) {
		return { ok: false, code: `missing-${codePrefix}` };
	}
	if (initializers.length > 1) {
		return { ok: false, code: `duplicate-${codePrefix}` };
	}
	const initializer = initializers[0];
	if (initializer === null) {
		return { ok: false, code: `malformed-${codePrefix}` };
	}
	const value = evaluateClosedLiteral(initializer);
	if (typeof value !== "string") {
		return { ok: false, code: `malformed-${codePrefix}` };
	}
	return { ok: true, value };
}

function isCanonicalPayload(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	if (
		parsePositiveSafeInteger(String(value.schemaVersion)) === null ||
		parsePositiveSafeInteger(String(value.dataVersion)) === null
	) {
		return false;
	}
	if (value.schemaVersion !== 1 && value.schemaVersion !== 2) return false;
	return ["recipes", value.schemaVersion === 1 ? "profiles" : "literals", "connectors", "modifierForms", "nounSuffixes"].every((key) =>
		Array.isArray(value[key]),
	);
}

function inspectPatternLock(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch {
		return { ok: false, code: "malformed-lock" };
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return { ok: false, code: "malformed-lock" };
	}
	const keys = Object.keys(value);
	// Read-only migration of Templates1's single-entry lock. Never emit this shape.
	const legacy = keys.length === 2 && keys.includes("dataVersion") && keys.includes("digest") && value.dataVersion === 1;
	if (!legacy && (keys.length !== 1 || keys[0] !== "versions")) return { ok: false, code: "malformed-lock" };
	const versions = legacy ? [value] : value.versions;
	if (!Array.isArray(versions) || versions.length === 0) return { ok: false, code: "malformed-lock" };
	let previous = 0;
	for (const entry of versions) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry) ||
			Object.keys(entry).length !== 2 || !Object.hasOwn(entry, "dataVersion") || !Object.hasOwn(entry, "digest") ||
			typeof entry.dataVersion !== "number" || parsePositiveSafeInteger(String(entry.dataVersion)) === null ||
			entry.dataVersion !== previous + 1 || typeof entry.digest !== "string" || !VALID_DIGEST.test(entry.digest)) {
			return { ok: false, code: "malformed-lock" };
		}
		previous = entry.dataVersion;
	}
	return { ok: true, legacy, versions, ...versions[versions.length - 1] };
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
	if (!digest.ok) {
		return digest;
	}
	if (!VALID_DIGEST.test(digest.value)) {
		return { ok: false, code: "malformed-digest" };
	}
	const payloadJson = inspectNamedStringExport(exports, PAYLOAD_EXPORT, "payload");
	if (!payloadJson.ok) {
		return payloadJson;
	}
	let payload;
	try {
		payload = JSON.parse(payloadJson.value);
	} catch {
		return { ok: false, code: "malformed-payload" };
	}
	if (!isCanonicalPayload(payload)) {
		return { ok: false, code: "malformed-payload" };
	}
	if (collisionPatternDataDigest(payload) !== digest.value) {
		return { ok: false, code: "digest-inconsistent" };
	}
	return {
		ok: true,
		digest: digest.value,
		dataVersion: payload.dataVersion,
	};
}

function canonicalCollisionPatternData(parsed) {
	return {
		schemaVersion: parsed.schemaVersion,
		dataVersion: parsed.dataVersion,
		recipes: parsed.recipes,
		...(parsed.schemaVersion === 1 ? { profiles: parsed.profiles } : { literals: parsed.literals }),
		connectors: parsed.connectors,
		modifierForms: parsed.modifierForms,
		nounSuffixes: parsed.nounSuffixes,
	};
}

function collisionPatternDataJson(parsed) {
	return JSON.stringify(canonicalCollisionPatternData(parsed));
}

/**
 * SHA-256 of the document's typed pattern data, independent of generated
 * comments, formatting and TypeScript wrapping.
 */
export function collisionPatternDataDigest(parsed) {
	return createHash("sha256").update(collisionPatternDataJson(parsed)).digest("hex");
}

function renderStandardCollisionPatternLock(parsed, previousVersions) {
	const versions = previousVersions.map((entry) => ({ ...entry }));
	if (!versions.some((entry) => entry.dataVersion === parsed.dataVersion)) {
		const nextVersion = (versions.at(-1)?.dataVersion ?? 0) + 1;
		if (parsed.dataVersion !== nextVersion) {
			throw new Error(
				`${STANDARD_COLLISION_PATTERNS_LOCK} must record contiguous versions starting at 1 (data-version-gap). Expected data-version ${nextVersion}; restore missing history instead of recreating it.`,
			);
		}
		versions.push({ dataVersion: parsed.dataVersion, digest: collisionPatternDataDigest(parsed) });
	}
	return `${JSON.stringify(
		{ versions },
		null,
		"\t",
	)}\n`;
}

async function readOptionalText(filePath, readText) {
	try {
		return await readText(filePath);
	} catch (error) {
		if (errorHasCode(error, "ENOENT")) {
			return null;
		}
		throw error;
	}
}

async function replaceAtomically(destination, contents, hooks = {}) {
	const staging = `${destination}.generating`;
	try {
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(staging, contents, "utf8");
		if (hooks.beforeRename !== undefined) {
			await hooks.beforeRename(staging, destination);
		}
		await rename(staging, destination);
	} catch (error) {
		const failures = [asError(error)];
		await collectRemove(staging, failures, hooks.beforeCleanup);
		if (failures.length === 1) {
			throw error;
		}
		throw new AggregateError(
			failures,
			`${destination} could not be replaced and its staging file could not be removed.`,
		);
	}
}

function asError(value) {
	return value instanceof Error ? value : new Error(String(value));
}

function appendFailures(failures, error) {
	if (error instanceof AggregateError) {
		for (const inner of error.errors) {
			appendFailures(failures, inner);
		}
		return;
	}
	failures.push(asError(error));
}

async function collectRemove(filePath, failures, beforeCleanup) {
	try {
		if (beforeCleanup !== undefined) {
			await beforeCleanup(filePath);
		}
		await rm(filePath, { force: true });
	} catch (error) {
		failures.push(asError(error));
	}
}

function publicationFailure(publicationError, failures, rollbackError) {
	if (failures.length === 1) {
		throw publicationError;
	}
	const token = rollbackError === null ? "cleanup-failed" : "rollback-failed";
	const detail =
		rollbackError === null
			? "publication failed after the generated module was restored where possible; staging files may remain"
			: "was published but could not be restored";
	throw new AggregateError(
		failures,
		`${STANDARD_COLLISION_PATTERNS_GENERATED} ${detail} (${token}). The version lock is unchanged and remains the approved meaning. Restore a writable filesystem and run \`${GENERATE_COMMAND}\`.`,
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
		if (options.beforePublish !== undefined) {
			await options.beforePublish("generated");
		}
		await rename(generatedStaging, options.outfile);
		generatedPublished = true;
		if (options.publishLock) {
			if (options.beforePublish !== undefined) {
				await options.beforePublish("lock");
			}
			await rename(lockStaging, options.lockFile);
		}
	} catch (error) {
		const failures = [asError(error)];
		await collectRemove(generatedStaging, failures, options.beforeCleanup);
		await collectRemove(lockStaging, failures, options.beforeCleanup);
		let rollbackError = null;
		if (generatedPublished) {
			try {
				if (options.beforeRollback !== undefined) {
					await options.beforeRollback();
				}
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
 * fail with ENOENT. Later versions must retain contiguous history from 1.
 * Any other read failure is propagated before staging begins and is never
 * reported as a missing file. An existing generated
 * module whose digest or canonical JSON payload is missing, malformed,
 * duplicated or inconsistent fails closed. Comment, format and entry-array
 * edits that leave a self-consistent payload are restored when the lock still
 * records the document. Same-version meaning changes are refused from the
 * lock, even if the generated payload and digest were rewritten together.
 *
 * When both destinations change, both are staged first, the generated module
 * is published, and the lock is the logical commit point. A failure before the
 * lock is published tries to restore the generated module to its starting
 * bytes (removing a newly created generated module) and leaves no staging
 * file. Staging cleanup failures are collected and do not skip rollback. If
 * rollback or cleanup cannot be performed, the error is an AggregateError
 * that names the publication failure and every later failure. The lock
 * still holds the previously approved meaning, the generated module may contain
 * unpublished bytes when rollback failed, and a later generate after the
 * filesystem is writable repairs the pair. A rollback write or rename failure
 * is kept even when removing that staging file also fails.
 */
export async function writeStandardCollisionPatterns(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { source, parsed } = await generateStandardCollisionPatterns(options);
	const outfile =
		options.generatedPath ?? path.join(rootDir, STANDARD_COLLISION_PATTERNS_GENERATED);
	const lockFile = options.lockPath ?? path.join(rootDir, STANDARD_COLLISION_PATTERNS_LOCK);
	const nextDigest = collisionPatternDataDigest(parsed);
	const readText = options.readText ?? ((filePath) => readFile(filePath, "utf8"));
	const previous = await readOptionalText(outfile, readText);
	const previousLock = await readOptionalText(lockFile, readText);
	const firstGeneration = previous === null && previousLock === null;
	let previousVersions = [];

	if (!firstGeneration) {
		if (previousLock === null) {
			throw new Error(
				`${STANDARD_COLLISION_PATTERNS_LOCK} is missing. Revert the generated module, then run \`${GENERATE_COMMAND}\`.`,
			);
		}
		const lock = inspectPatternLock(previousLock);
		if (!lock.ok) {
			throw new Error(
				`${STANDARD_COLLISION_PATTERNS_LOCK} is not a trustworthy pattern lock (${lock.code}). Revert that lock, then run \`${GENERATE_COMMAND}\`.`,
			);
		}
		previousVersions = lock.versions;
		if (previous !== null) {
			const existing = inspectExistingGeneratedModule(previous);
			if (!existing.ok) {
				throw new Error(
					`${STANDARD_COLLISION_PATTERNS_GENERATED} is not a trustworthy previous pattern module (${existing.code}). Revert that generated file, then run \`${GENERATE_COMMAND}\`.`,
				);
			}
		}
		if (parsed.dataVersion < lock.dataVersion || (lock.digest !== nextDigest && parsed.dataVersion === lock.dataVersion)) {
			throw new Error(
				`${STANDARD_COLLISION_PATTERNS_MARKDOWN} changed its pattern data without raising data-version (data-version-unchanged). Raise data-version and run \`${GENERATE_COMMAND}\`.`,
			);
		}
	}

	const nextLock = renderStandardCollisionPatternLock(parsed, previousVersions);
	const publishLock =
		previousLock === null ||
		normalizeLineEndings(previousLock) !== normalizeLineEndings(nextLock);
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
		outfile: STANDARD_COLLISION_PATTERNS_GENERATED,
		schemaVersion: parsed.schemaVersion,
		dataVersion: parsed.dataVersion,
		recipes: parsed.recipes.length,
		literals: parsed.literals.length,
		connectors: parsed.connectors.length,
		modifierForms: parsed.modifierForms.length,
		nounSuffixes: parsed.nounSuffixes.length,
	};
}
