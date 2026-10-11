/**
 * FAKE-ALERT-TEMPLATES1: the build-time owner of the standard Fake Alert
 * recipe document (`Docs/fake_alert_policy1.md` §4.5).
 *
 * `resources/fake-alert/standard-recipes.md` is the one document a human
 * edits. This module parses it, validates it through the product's own
 * `compileFakeAlertRecipeSet`, packs the compiled set into the compact form the
 * plugin restores, and renders the typed module a later slice will import.
 * Nothing here ships: the parser, `node:fs` and the Markdown itself stay
 * outside the plugin bundle.
 *
 * The design follows the reviewed Collision and Fake Proverb pipelines —
 * strict line-oriented parse, one shared compiler, canonical payload and
 * digest, a tracked version→digest lock outside the generated module, atomic
 * publication with rollback, and a fail-closed build guard — but every schema,
 * file, lock, version and command here is Fake Alert's own.
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
export const STANDARD_FAKE_ALERT_RECIPES_MARKDOWN = "resources/fake-alert/standard-recipes.md";
export const STANDARD_FAKE_ALERT_RECIPES_GENERATED = "src/fakeAlert/generated/standardFakeAlertRecipes.ts";
/**
 * Tracked version→digest authority for same-version meaning changes.
 * Regeneration may repair the generated TypeScript module; it must not treat
 * that module as proof of a previously approved meaning.
 */
export const STANDARD_FAKE_ALERT_RECIPES_LOCK = "resources/fake-alert/standard-recipes.lock.json";
/** The source validators the generator bundles; all are watch inputs. The first is the bundle's entry. */
export const FAKE_ALERT_RECIPE_VALIDATORS = [
	"src/fakeAlert/compileRecipeSet.ts",
	"src/fakeAlert/recipeData.ts",
	"src/fakeAlert/recipeSet.ts",
];

/** How to refresh the generated module; named by every staleness failure. */
export const GENERATE_COMMAND = "npm run generate:fake-alert-recipes";

// Shared compiler for the synchronous parser API. Build/watch re-load their root's
// compiler for each generation, so later edits never use a stale validator.
const sourceCompiler = await loadRecipeCompiler(fileURLToPath(new URL("../../", import.meta.url)));
export const FAKE_ALERT_RECIPE_SCHEMA_VERSION = sourceCompiler.FAKE_ALERT_RECIPE_SCHEMA_VERSION;

const ENTRY_KINDS = ["family", "prompt", "terminal", "outcome"];
/** Fields a kind may carry once, before any `line:`. Which are required is the compiler's rule, except these. */
const SCALAR_FIELDS = Object.freeze({
	family: ["stage", "weight", "drift", "on"],
	prompt: ["family", "enabled", "kind", "buttons", "weight"],
	terminal: ["family", "enabled", "kind", "weight"],
	outcome: ["family", "enabled", "kind", "weight"],
});
/** Fields the typed data cannot be built without. `on` and `buttons` are left to the compiler. */
const REQUIRED_FIELDS = Object.freeze({
	family: ["stage", "weight", "drift"],
	prompt: ["family", "enabled", "kind", "weight"],
	terminal: ["family", "enabled", "kind", "weight"],
	outcome: ["family", "enabled", "kind", "weight"],
});
const LISTS = Object.freeze({ family: "families", prompt: "prompts", terminal: "terminals", outcome: "outcomes" });
const METADATA_KEYS = ["schema-version", "data-version"];
const HEADING = /^## ([^ ]+) (.+)$/u;
const TITLE = /^# (.+)$/u;
const FIELD = /^([a-z][a-z0-9-]*): (.*)$/su;
const INTEGER = /^(0|[1-9][0-9]*)$/u;

function issue(code, line, detail) {
	return detail === undefined ? { code, line } : { code, line, detail };
}

export function describeFakeAlertSourceIssue(entry) {
	const where = entry.line === undefined ? "" : ` (line ${entry.line})`;
	return entry.detail === undefined ? `${entry.code}${where}` : `${entry.code}${where}: ${entry.detail}`;
}

export function describeFakeAlertSourceIssues(issues) {
	return issues.map(describeFakeAlertSourceIssue).join("; ");
}

function parseSafeInteger(value, minimum) {
	const numeric = Number(value);
	return INTEGER.test(value) && Number.isSafeInteger(numeric) && numeric >= minimum && String(numeric) === value
		? numeric : null;
}

/** Strict line syntax followed by the same semantic compiler used by generation. */
export function parseStandardFakeAlertRecipeMarkdown(markdown) {
	return parseWithCompiler(markdown, sourceCompiler);
}

function parseWithCompiler(markdown, compiler) {
	const issues = [];
	const lines = String(markdown).replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);
	const metadata = new Map();
	const entryLines = new Map();
	const parsed = { families: [], prompts: [], terminals: [], outcomes: [] };
	let sawTitle = false;
	let seenFirstEntry = false;
	let current = null;
	let state = "metadata";
	const finish = () => {
		if (current === null) return;
		const { kind, id, line, fields } = current;
		if (!ENTRY_KINDS.includes(kind)) {
			current = null;
			return;
		}
		for (const key of REQUIRED_FIELDS[kind]) {
			if (!fields.has(key)) issues.push(issue("missing-field", line, `${id}: ${key}`));
		}
		const weight = fields.has("weight") ? parseSafeInteger(fields.get("weight"), 1) : 0;
		if (weight === null) issues.push(issue("invalid-weight", line, id));
		if (kind === "family") {
			const drift = fields.has("drift") ? parseSafeInteger(fields.get("drift"), 0) : 0;
			if (drift === null) issues.push(issue("invalid-drift", line, id));
			if (current.lines.length > 0) issues.push(issue("unexpected-line", line, id));
			parsed.families.push({
				id, stage: fields.get("stage") ?? "", weight: weight ?? 0, drift: drift ?? 0,
				...(fields.has("on") ? { on: fields.get("on") } : {}),
			});
		} else {
			if (fields.has("enabled") && fields.get("enabled") !== "true" && fields.get("enabled") !== "false") {
				issues.push(issue("invalid-boolean", line, `${id}: enabled`));
			}
			parsed[LISTS[kind]].push({
				id, family: fields.get("family") ?? "", enabled: fields.get("enabled") === "true",
				kind: fields.get("kind") ?? "", weight: weight ?? 0,
				...(fields.has("buttons") ? { buttons: fields.get("buttons") } : {}),
				lines: current.lines,
			});
		}
		current = null;
	};
	for (const [index, raw] of lines.entries()) {
		const line = index + 1;
		if (raw === "") {
			if (state === "fields") state = "after-fields";
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
				current = { kind, id, line, fields: new Map(), lines: [], phase: "fields" };
				entryLines.set(id, line);
				state = "fields";
				continue;
			}
			if (TITLE.test(raw)) {
				if (seenFirstEntry) issues.push(issue("unexpected-title", line));
				else if (sawTitle) issues.push(issue("duplicate-title", line));
				sawTitle = true;
			} else {
				// A heading that is not an entry still ends the entry before it. What
				// follows is skipped up to the next entry, so one typo is one problem.
				issues.push(issue("unknown-heading", line));
				finish();
				if (state !== "metadata") {
					current = { kind: "", id: "", line, fields: new Map(), lines: [], phase: "fields" };
					state = "fields";
				}
			}
			continue;
		}
		if (state === "metadata") {
			const field = FIELD.exec(raw);
			if (!field) { issues.push(issue("orphan-content", line)); continue; }
			const [, key, value] = field;
			if (!METADATA_KEYS.includes(key)) { issues.push(issue("unknown-metadata", line, key)); continue; }
			if (metadata.has(key)) { issues.push(issue("duplicate-metadata", line, key)); continue; }
			const numeric = parseSafeInteger(value, 1);
			if (numeric === null) issues.push(issue("invalid-metadata", line, key));
			metadata.set(key, numeric ?? 0);
			entryLines.set(key, line);
			continue;
		}
		if (current === null) { issues.push(issue("orphan-content", line)); continue; }
		// The fields of an entry whose heading was refused are already accounted for.
		if (!ENTRY_KINDS.includes(current.kind)) continue;
		if (state !== "fields") { issues.push(issue("unexpected-content", line, current.id)); continue; }
		const field = FIELD.exec(raw);
		if (!field) { issues.push(issue("invalid-field", line, current.id)); continue; }
		const [, key, value] = field;
		if (key === "line" && current.kind !== "family") {
			// A template is taken as written: its text is the compiler's to judge.
			current.phase = "lines";
			current.lines.push(value);
			continue;
		}
		if (!SCALAR_FIELDS[current.kind].includes(key)) {
			issues.push(issue("unknown-field", line, `${current.id}: ${key}`)); continue;
		}
		if (current.phase !== "fields") { issues.push(issue("misplaced-field", line, `${current.id}: ${key}`)); continue; }
		if (current.fields.has(key)) { issues.push(issue("duplicate-field", line, `${current.id}: ${key}`)); continue; }
		current.fields.set(key, value);
	}
	finish();
	for (const key of METADATA_KEYS) {
		if (!metadata.has(key)) issues.push(issue("missing-metadata", 1, key));
	}
	if (!seenFirstEntry) issues.push(issue("no-entries", lines.length));
	if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
	const input = { schemaVersion: metadata.get("schema-version"), dataVersion: metadata.get("data-version"), ...parsed };
	const result = compiler.compileFakeAlertRecipeSet(input);
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
 * exactly the validator and the restore the product has — there is no second
 * implementation of "is this recipe set valid", and no path that reaches the
 * generated file without passing it. `compileRecipeSet.ts` depends only on the
 * hand-written schema and the set builder, never on the generated entries, so
 * loading it here cannot become circular.
 */
async function loadRecipeCompiler(rootDir) {
	const built = await esbuild.build({
		entryPoints: [path.join(rootDir, FAKE_ALERT_RECIPE_VALIDATORS[0])],
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

const KINDS = ["warning", "error", "confirmation", "information", "success"];
const BUTTON_SETS = ["ok", "ok-cancel", "yes-no", "retry-cancel", "retry-ignore"];
const STAGES = ["prompt", "terminal", "outcome"];
const ON = ["affirm", "deny", "any"];

function indexIn(list, value, what) {
	const index = list.indexOf(value);
	if (index === -1) throw new Error(`Cannot pack the Fake Alert recipes: unknown ${what}.`);
	return index;
}

/**
 * Packs a compiled set into the compact form `unpackFakeAlertRecipeSet()`
 * restores: each line becomes fixed-text indexes and slot tokens, and equal
 * fixed text is stored once, in first-use order.
 */
export function packFakeAlertRecipeSet(set) {
	const literals = [];
	const literalIndex = new Map();
	const families = set.families.map((family) =>
		[family.id, indexIn(STAGES, family.stage, "stage"), family.weight, family.drift, family.on === null ? -1 : indexIn(ON, family.on, "button role")]);
	const familyIndex = new Map(set.families.map((family, index) => [family.id, index]));
	const recipes = [...set.prompts, ...set.terminals, ...set.outcomes].map((recipe) => [
		recipe.id, familyIndex.get(recipe.family), recipe.enabled ? 1 : 0, indexIn(KINDS, recipe.kind, "kind"), recipe.weight,
		indexIn(BUTTON_SETS, recipe.buttons, "button set"),
		recipe.lines.map((line) => line.map((segment) => {
			if (typeof segment !== "string") return segment.token;
			if (!literalIndex.has(segment)) {
				literalIndex.set(segment, literals.length);
				literals.push(segment);
			}
			return literalIndex.get(segment);
		})),
	]);
	return { schemaVersion: set.schemaVersion, dataVersion: set.dataVersion, literals, families, recipes };
}

function renderRows(rows) {
	return rows.map((row) => `\t\t${JSON.stringify(row)},`);
}

/**
 * Renders the generated module.
 *
 * Byte-identical for the same parsed document: no timestamp, no absolute path,
 * no locale-dependent ordering and no random value. Entries keep the order the
 * document gives them, and `JSON.stringify` escapes each value without
 * touching its Japanese text.
 */
export function renderGeneratedFakeAlertRecipeModule(parsed, packed) {
	const count = (stage) => packed.recipes.filter((recipe) => packed.families[recipe[1]][1] === STAGES.indexOf(stage)).length;
	const lines = [
		`// Generated from ${STANDARD_FAKE_ALERT_RECIPES_MARKDOWN}. Do not edit this file.`,
		"//",
		`// Edit that document and run \`${GENERATE_COMMAND}\`. Every build re-derives`,
		"// this module from it and fails when the two disagree, so a hand edit here",
		"// cannot reach the artifact.",
		"",
		'import type { PackedFakeAlertRecipeSet } from "../recipeSet";',
		"",
		"/** The Recipe Schema this data was generated from. */",
		`export const STANDARD_FAKE_ALERT_RECIPE_SCHEMA_VERSION = ${parsed.schemaVersion};`,
		"",
		"/**",
		" * The recipe data version the document declares. Adding, removing,",
		" * reordering, reweighting or rewording an entry has to raise it.",
		" */",
		`export const STANDARD_FAKE_ALERT_RECIPE_DATA_VERSION = ${parsed.dataVersion};`,
		"",
		"/**",
		" * SHA-256 of `STANDARD_FAKE_ALERT_RECIPE_DATA_JSON`.",
		" *",
		" * Regeneration uses this digest and that JSON payload only to decide whether",
		" * a generated module is self-consistent enough to repair. Same-version",
		" * meaning changes are refused from the tracked lock, not from these fields.",
		" */",
		`export const STANDARD_FAKE_ALERT_RECIPE_DATA_DIGEST = "${fakeAlertRecipeDataDigest(parsed)}";`,
		"",
		"/**",
		" * Canonical recipe data as JSON: the document's entries as written.",
		" * Regeneration compares this payload with the digest so comments,",
		" * formatting and hand edits of the packed data can be restored from the",
		" * Markdown. It is not the version authority, and the plugin never reads it.",
		" */",
		`export const STANDARD_FAKE_ALERT_RECIPE_DATA_JSON = ${JSON.stringify(fakeAlertRecipeDataJson(parsed))};`,
		"",
		"/**",
		` * The compiled recipes in compact form: ${packed.families.length} families, ${count("prompt")} prompts,`,
		` * ${count("terminal")} terminals and ${count("outcome")} outcomes over ${packed.literals.length} pieces of fixed text.`,
		" * `unpackFakeAlertRecipeSet()` restores the set the compiler produced.",
		" */",
		"export const STANDARD_FAKE_ALERT_PACKED_RECIPES: PackedFakeAlertRecipeSet = {",
		`\tschemaVersion: ${packed.schemaVersion},`,
		`\tdataVersion: ${packed.dataVersion},`,
		`\tliterals: ${JSON.stringify(packed.literals)},`,
		"\tfamilies: [",
		...renderRows(packed.families),
		"\t],",
		"\trecipes: [",
		...renderRows(packed.recipes),
		"\t],",
		"};",
		"",
	];
	return lines.join("\n");
}

/**
 * The generated module is rendered with `\n`, but a checkout can hold it with
 * `\r\n` — Git's `core.autocrlf` does exactly that on Windows. Line endings are
 * the file's presentation, never its content: no fixed text contains one, so
 * normalising them before the comparison cannot hide a stale or edited entry,
 * while comparing raw bytes would call a perfectly good checkout stale.
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
 * handed to the compiler. The compiled set is packed, and the packed data is
 * restored with the product's own `unpackFakeAlertRecipeSet()` and compared
 * with the compiled set before anything is rendered, so a packing mistake
 * cannot reach the generated module. A missing document is reported as
 * missing, and any other read failure as unreadable with its cause.
 */
export async function generateStandardFakeAlertRecipes(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const markdown = options.markdown ?? (await readRequiredText(
		options.markdownPath ?? path.join(rootDir, STANDARD_FAKE_ALERT_RECIPES_MARKDOWN),
		STANDARD_FAKE_ALERT_RECIPES_MARKDOWN,
		(filePath) => readFile(filePath, "utf8"),
	));
	const compiler = await loadRecipeCompiler(rootDir);
	const parsed = parseWithCompiler(markdown, compiler);
	if (!parsed.ok) {
		throw new Error(
			`${STANDARD_FAKE_ALERT_RECIPES_MARKDOWN} is not a valid recipe document: ${describeFakeAlertSourceIssues(parsed.issues)}`,
		);
	}
	const data = canonicalFakeAlertRecipeData(parsed);
	const compiled = compiler.compileFakeAlertRecipeSet(data);
	if (!compiled.ok) {
		throw new Error(
			`${STANDARD_FAKE_ALERT_RECIPES_MARKDOWN} does not compile: ${compiled.issues
				.map(compiler.describeFakeAlertRecipeIssue)
				.join("; ")}`,
		);
	}
	const packed = packFakeAlertRecipeSet(compiled.set);
	if (JSON.stringify(compiler.unpackFakeAlertRecipeSet(packed)) !== JSON.stringify(compiled.set)) {
		throw new Error(`${STANDARD_FAKE_ALERT_RECIPES_MARKDOWN} could not be packed without changing its meaning.`);
	}
	return { parsed: data, compiled: compiled.set, packed, source: renderGeneratedFakeAlertRecipeModule(data, packed) };
}

/**
 * Fails unless the generated module and the tracked version lock both match
 * the document. Called by every build, so stale or hand-edited generated data
 * cannot be bundled, and a same-version meaning change cannot pass by rewriting
 * only the generated module. Destination absence is only ENOENT; any other
 * read failure is reported as unreadable and does not tell the caller to
 * regenerate. Nothing is ever written.
 */
export async function assertStandardFakeAlertRecipesGenerated(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { source, parsed } = await generateStandardFakeAlertRecipes(options);
	const generatedPath = options.generatedPath ?? path.join(rootDir, STANDARD_FAKE_ALERT_RECIPES_GENERATED);
	const lockFile = options.lockPath ?? path.join(rootDir, STANDARD_FAKE_ALERT_RECIPES_LOCK);
	const readText = options.readText ?? ((filePath) => readFile(filePath, "utf8"));
	const current = await readRequiredText(generatedPath, STANDARD_FAKE_ALERT_RECIPES_GENERATED, readText);
	if (normalizeLineEndings(current) !== normalizeLineEndings(source)) {
		throw new Error(
			`${STANDARD_FAKE_ALERT_RECIPES_GENERATED} does not match ${STANDARD_FAKE_ALERT_RECIPES_MARKDOWN}. Run \`${GENERATE_COMMAND}\`.`,
		);
	}
	const lockSource = await readRequiredText(lockFile, STANDARD_FAKE_ALERT_RECIPES_LOCK, readText);
	const lock = inspectRecipeLock(lockSource);
	if (!lock.ok) {
		throw new Error(
			`${STANDARD_FAKE_ALERT_RECIPES_LOCK} is not a trustworthy recipe lock (${lock.code}). Run \`${GENERATE_COMMAND}\`.`,
		);
	}
	if (lock.digest !== fakeAlertRecipeDataDigest(parsed) || lock.dataVersion !== parsed.dataVersion) {
		throw new Error(
			`${STANDARD_FAKE_ALERT_RECIPES_LOCK} does not record the current recipe data. Raise data-version and run \`${GENERATE_COMMAND}\`.`,
		);
	}
	return { schemaVersion: parsed.schemaVersion, dataVersion: parsed.dataVersion };
}

/**
 * The bundle-time guard.
 *
 * `prepareBundleInputs` checks the document once before a build starts, which
 * is enough for a one-shot build but not for a watching one. This plugin
 * repeats the check when every build and rebuild starts, so a stale generated
 * module or lock fails the next build, whatever triggered it.
 *
 * It registers the document, the lock and the source validators as watch files
 * when the generated module is loaded. Until a later slice imports that module
 * the plugin loads nothing, so editing only the Fake Alert document does not by
 * itself start a watch rebuild; nothing in the bundle depends on it yet, and
 * the next build of any kind still checks it. The entry point is deliberately
 * left alone: the Collision guard loads it and the Fake Proverb guard resolves
 * it, and a third hook there would take one of theirs. Neither hook here
 * regenerates anything. A failed start reports the caught Error as the esbuild
 * message `detail`, so an unreadable destination keeps its cause.
 */
export const FAKE_ALERT_GUARD_NAME = "semantropy-standard-fake-alert-recipes";

export function standardFakeAlertRecipesPlugin(rootDir, options = {}) {
	const generated = path.resolve(rootDir, STANDARD_FAKE_ALERT_RECIPES_GENERATED);
	const watchFiles = [
		path.resolve(rootDir, STANDARD_FAKE_ALERT_RECIPES_MARKDOWN),
		generated,
		path.resolve(rootDir, STANDARD_FAKE_ALERT_RECIPES_LOCK),
		...FAKE_ALERT_RECIPE_VALIDATORS.map((file) => path.resolve(rootDir, file)),
	];
	return {
		name: FAKE_ALERT_GUARD_NAME,
		setup(build) {
			build.onStart(async () => {
				try {
					await assertStandardFakeAlertRecipesGenerated({ rootDir, readText: options.readText });
					return null;
				} catch (error) {
					const failure = asError(error);
					return { errors: [{ text: failure.message, detail: failure }] };
				}
			});
			// esbuild compiles filters with Go's regexp engine, which has no `u` flag.
			build.onLoad({ filter: /standardFakeAlertRecipes\.ts$/ }, async (args) => {
				if (path.resolve(args.path) !== generated) return null;
				return { contents: await readFile(args.path, "utf8"), loader: "ts", watchFiles };
			});
		},
	};
}

const DIGEST_EXPORT = "STANDARD_FAKE_ALERT_RECIPE_DATA_DIGEST";
const PAYLOAD_EXPORT = "STANDARD_FAKE_ALERT_RECIPE_DATA_JSON";
const PAYLOAD_KEYS = ["schemaVersion", "dataVersion", "families", "prompts", "terminals", "outcomes"];
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
	const file = ts.createSourceFile("standardFakeAlertRecipes.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
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
	if (typeof value.dataVersion !== "number" || parseSafeInteger(String(value.dataVersion), 1) === null) return false;
	return ["families", "prompts", "terminals", "outcomes"].every((key) => Array.isArray(value[key]));
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

/** The document's entries as written, with one fixed key order, so the digest names the data and not its spelling. */
function canonicalFakeAlertRecipeData(parsed) {
	const recipe = (entry) => ({
		id: entry.id, family: entry.family, enabled: entry.enabled, kind: entry.kind, weight: entry.weight,
		...(entry.buttons === undefined ? {} : { buttons: entry.buttons }),
		lines: [...entry.lines],
	});
	return {
		schemaVersion: parsed.schemaVersion,
		dataVersion: parsed.dataVersion,
		families: parsed.families.map((entry) => ({
			id: entry.id, stage: entry.stage, weight: entry.weight, drift: entry.drift,
			...(entry.on === undefined ? {} : { on: entry.on }),
		})),
		prompts: parsed.prompts.map(recipe),
		terminals: parsed.terminals.map(recipe),
		outcomes: parsed.outcomes.map(recipe),
	};
}

function fakeAlertRecipeDataJson(parsed) {
	return JSON.stringify(canonicalFakeAlertRecipeData(parsed));
}

/**
 * SHA-256 of the document's typed recipe data, independent of generated
 * comments, formatting and TypeScript wrapping.
 */
export function fakeAlertRecipeDataDigest(parsed) {
	return createHash("sha256").update(fakeAlertRecipeDataJson(parsed)).digest("hex");
}

function renderStandardFakeAlertRecipeLock(parsed, previousVersions) {
	const versions = previousVersions.map((entry) => ({ dataVersion: entry.dataVersion, digest: entry.digest }));
	if (!versions.some((entry) => entry.dataVersion === parsed.dataVersion)) {
		const nextVersion = (versions.at(-1)?.dataVersion ?? 0) + 1;
		if (parsed.dataVersion !== nextVersion) {
			throw new Error(
				`${STANDARD_FAKE_ALERT_RECIPES_LOCK} must record contiguous versions starting at 1 (data-version-gap). Expected data-version ${nextVersion}; restore missing history instead of recreating it.`,
			);
		}
		versions.push({ dataVersion: parsed.dataVersion, digest: fakeAlertRecipeDataDigest(parsed) });
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
		`${STANDARD_FAKE_ALERT_RECIPES_GENERATED} ${detail} (${token}). The version lock is unchanged and remains the approved meaning. Restore a writable filesystem and run \`${GENERATE_COMMAND}\`.`,
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
export async function writeStandardFakeAlertRecipes(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { source, parsed } = await generateStandardFakeAlertRecipes(options);
	const outfile = options.generatedPath ?? path.join(rootDir, STANDARD_FAKE_ALERT_RECIPES_GENERATED);
	const lockFile = options.lockPath ?? path.join(rootDir, STANDARD_FAKE_ALERT_RECIPES_LOCK);
	const nextDigest = fakeAlertRecipeDataDigest(parsed);
	const readText = options.readText ?? ((filePath) => readFile(filePath, "utf8"));
	const previous = await readOptionalText(outfile, readText);
	const previousLock = await readOptionalText(lockFile, readText);
	const firstGeneration = previous === null && previousLock === null;
	let previousVersions = [];

	if (!firstGeneration) {
		if (previousLock === null) {
			throw new Error(
				`${STANDARD_FAKE_ALERT_RECIPES_LOCK} is missing. Revert the generated module, then run \`${GENERATE_COMMAND}\`.`,
			);
		}
		const lock = inspectRecipeLock(previousLock);
		if (!lock.ok) {
			throw new Error(
				`${STANDARD_FAKE_ALERT_RECIPES_LOCK} is not a trustworthy recipe lock (${lock.code}). Revert that lock, then run \`${GENERATE_COMMAND}\`.`,
			);
		}
		previousVersions = lock.versions;
		if (previous !== null) {
			const existing = inspectExistingGeneratedModule(previous);
			if (!existing.ok) {
				throw new Error(
					`${STANDARD_FAKE_ALERT_RECIPES_GENERATED} is not a trustworthy previous recipe module (${existing.code}). Revert that generated file, then run \`${GENERATE_COMMAND}\`.`,
				);
			}
		}
		if (parsed.dataVersion < lock.dataVersion || (lock.digest !== nextDigest && parsed.dataVersion === lock.dataVersion)) {
			throw new Error(
				`${STANDARD_FAKE_ALERT_RECIPES_MARKDOWN} changed its recipe data without raising data-version (data-version-unchanged). Raise data-version and run \`${GENERATE_COMMAND}\`.`,
			);
		}
	}

	const nextLock = renderStandardFakeAlertRecipeLock(parsed, previousVersions);
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
		outfile: STANDARD_FAKE_ALERT_RECIPES_GENERATED,
		schemaVersion: parsed.schemaVersion,
		dataVersion: parsed.dataVersion,
		families: parsed.families.length,
		prompts: parsed.prompts.length,
		terminals: parsed.terminals.length,
		outcomes: parsed.outcomes.length,
	};
}
