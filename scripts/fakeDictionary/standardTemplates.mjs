/**
 * PRE-RELEASE-FAKE-DICT-TEMPLATES1: the build-time owner of the standard Fake
 * Dictionary templates.
 *
 * `resources/fake-dictionary/standard-templates.md` is the one document a human
 * edits. This module parses it, validates it through the product's own
 * `compileTemplateSet`, and renders the typed data the runtime imports. Nothing
 * here ships: the parser, `node:fs` and the Markdown itself stay outside the
 * plugin bundle, which only ever sees the generated module.
 *
 * The parse is line-oriented and never depends on how Markdown renders. It
 * refuses anything it does not recognise rather than skipping it, so an entry
 * cannot be lost to a typo, and it reports every problem it finds in document
 * order so one failing build names them all.
 */
import esbuild from "esbuild";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Relative to the plugin root, in POSIX form, for messages and copy lists. */
export const STANDARD_TEMPLATES_MARKDOWN = "resources/fake-dictionary/standard-templates.md";
export const STANDARD_TEMPLATES_GENERATED = "src/dictionary/generated/standardTemplateEntries.ts";

/** How to refresh the generated module; named by every staleness failure. */
export const GENERATE_COMMAND = "npm run generate:templates";

export const TEMPLATE_SCHEMA_VERSION = 1;

const ENTRY_KINDS = Object.freeze({ core: "core", clause: "clause" });
/** Exactly the fields each entry kind may carry. Anything else is refused. */
const ENTRY_FIELDS = Object.freeze({ core: ["family"], clause: ["category"] });
const METADATA_KEYS = Object.freeze(["schema-version", "data-version"]);

const HEADING = /^##[ ]([^ ]+)[ ](.+)$/u;
const TITLE = /^#[ ](.+)$/u;
const FIELD = /^([a-z][a-z0-9-]*):[ ](.*)$/u;
const INTEGER = /^(0|[1-9][0-9]*)$/u;

/**
 * One reason the document was refused.
 *
 * `line` is a 1-based line number in that one document and `id` is an entry id
 * we wrote ourselves. No absolute path, note text, Vault path or token ever
 * reaches here: the only file this module reads is the template document.
 */
function issue(code, line, detail) {
	return detail === undefined ? { code, line } : { code, line, detail };
}

/** A single line for a build or test failure; stable for the same input. */
export function describeTemplateSourceIssue(entry) {
	const where = entry.line === undefined ? "" : ` (line ${entry.line})`;
	return entry.detail === undefined
		? `${entry.code}${where}`
		: `${entry.code}${where}: ${entry.detail}`;
}

export function describeTemplateSourceIssues(issues) {
	return issues.map(describeTemplateSourceIssue).join("; ");
}

/**
 * Parses the template document into raw entries.
 *
 * Line endings are normalised before anything else, so CRLF and LF checkouts
 * produce identical data; a leading byte-order mark is dropped. Body lines are
 * taken verbatim — nothing is trimmed, re-wrapped or re-punctuated — and a body
 * carrying leading or trailing whitespace is refused rather than silently
 * cleaned, so stray spacing can never reach a generated definition.
 */
export function parseStandardTemplateMarkdown(markdown) {
	const issues = [];
	const lines = String(markdown).replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);

	const metadata = new Map();
	let sawTitle = false;
	let seenFirstEntry = false;

	const coreTemplates = [];
	const optionalClauses = [];
	/** The entry being read: null until the first heading. */
	let current = null;
	/** "fields" | "body" | "after-body" */
	let state = "metadata";

	const finish = () => {
		if (current === null) {
			return;
		}
		for (const field of ENTRY_FIELDS[current.kind]) {
			if (!current.fields.has(field)) {
				issues.push(issue("missing-field", current.line, `${current.id}: ${field}`));
			}
		}
		if (current.body === null) {
			issues.push(issue("missing-body", current.line, current.id));
		}
		const text = current.body ?? "";
		if (current.kind === ENTRY_KINDS.core) {
			coreTemplates.push({
				id: current.id,
				family: current.fields.get("family") ?? "",
				text,
			});
		} else {
			optionalClauses.push({
				id: current.id,
				category: current.fields.get("category") ?? "",
				text,
			});
		}
		current = null;
	};

	for (const [index, raw] of lines.entries()) {
		const line = index + 1;

		if (raw === "") {
			// The one blank line after an entry's fields separates them from its
			// body. Blank lines are otherwise only spacing.
			if (state === "fields") {
				state = "body";
			}
			continue;
		}
		// A commentary line. Recognised explicitly, so it is not mistaken for a
		// body and not silently swallowed as unknown content.
		if (raw === ">" || raw.startsWith("> ")) {
			continue;
		}

		if (raw.startsWith("#")) {
			const heading = HEADING.exec(raw);
			if (heading) {
				finish();
				if (!seenFirstEntry) {
					seenFirstEntry = true;
					for (const key of METADATA_KEYS) {
						if (!metadata.has(key)) {
							issues.push(issue("missing-metadata", line, key));
						}
					}
				}
				const [, kind, id] = heading;
				if (kind !== ENTRY_KINDS.core && kind !== ENTRY_KINDS.clause) {
					issues.push(issue("unknown-entry-kind", line, kind));
					// Read it as a core entry so its own fields and body are still
					// checked instead of being reported as orphan content.
					current = { kind: ENTRY_KINDS.core, id, line, fields: new Map(), body: null };
				} else {
					current = { kind, id, line, fields: new Map(), body: null };
				}
				state = "fields";
				continue;
			}
			if (TITLE.test(raw)) {
				if (seenFirstEntry) {
					issues.push(issue("unexpected-title", line));
				} else if (sawTitle) {
					issues.push(issue("duplicate-title", line));
				}
				sawTitle = true;
				continue;
			}
			issues.push(issue("unknown-heading", line));
			continue;
		}

		if (state === "metadata") {
			const field = FIELD.exec(raw);
			if (!field) {
				issues.push(issue("orphan-content", line));
				continue;
			}
			const [, key, value] = field;
			if (!METADATA_KEYS.includes(key)) {
				issues.push(issue("unknown-metadata", line, key));
				continue;
			}
			if (metadata.has(key)) {
				issues.push(issue("duplicate-metadata", line, key));
				continue;
			}
			// A version is a small counting number. Digits alone are not enough:
			// `Number` turns a long run of digits into `Infinity` and rounds anything
			// past 2^53 to a neighbour, either of which would silently become the
			// template set version every definition is keyed by. The round trip is
			// what proves the conversion lost nothing.
			const numeric = Number(value);
			if (
				!INTEGER.test(value) ||
				!Number.isSafeInteger(numeric) ||
				numeric < 1 ||
				String(numeric) !== value
			) {
				issues.push(issue("invalid-metadata", line, key));
				continue;
			}
			metadata.set(key, numeric);
			continue;
		}

		if (current === null) {
			issues.push(issue("orphan-content", line));
			continue;
		}

		if (state === "fields") {
			const field = FIELD.exec(raw);
			if (!field) {
				issues.push(issue("invalid-field", line, current.id));
				continue;
			}
			const [, key, value] = field;
			if (!ENTRY_FIELDS[current.kind].includes(key)) {
				issues.push(issue("unknown-field", line, `${current.id}: ${key}`));
				continue;
			}
			if (current.fields.has(key)) {
				issues.push(issue("duplicate-field", line, `${current.id}: ${key}`));
				continue;
			}
			current.fields.set(key, value);
			continue;
		}

		if (state === "body") {
			if (raw !== raw.trim()) {
				issues.push(issue("body-whitespace", line, current.id));
				continue;
			}
			current.body = raw;
			state = "after-body";
			continue;
		}

		issues.push(issue("duplicate-body", line, current.id));
	}
	finish();

	if (!seenFirstEntry) {
		for (const key of METADATA_KEYS) {
			if (!metadata.has(key)) {
				issues.push(issue("missing-metadata", lines.length, key));
			}
		}
		issues.push(issue("no-entries", lines.length));
	}

	const schemaVersion = metadata.get("schema-version");
	if (schemaVersion !== undefined && schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
		issues.push(issue("unsupported-schema-version", 0, String(schemaVersion)));
	}

	if (issues.length > 0) {
		return { ok: false, issues: Object.freeze(issues) };
	}
	return {
		ok: true,
		schemaVersion: metadata.get("schema-version"),
		dataVersion: metadata.get("data-version"),
		coreTemplates: Object.freeze(coreTemplates),
		optionalClauses: Object.freeze(optionalClauses),
	};
}

/**
 * The product's own template compiler, loaded from source.
 *
 * It is bundled in memory and imported from a data URL, so the generator runs
 * exactly the validator the runtime runs — there is no second implementation
 * of "is this template set valid", and no path that reaches the generated file
 * without passing it. `template.ts` depends only on the hand-written schema
 * (families, categories, placeholders), never on the generated entries, so
 * loading it here cannot become circular.
 */
async function loadTemplateCompiler(rootDir) {
	const built = await esbuild.build({
		entryPoints: [path.join(rootDir, "src", "dictionary", "template.ts")],
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
export function renderGeneratedTemplateModule(parsed) {
	const lines = [
		`// Generated from ${STANDARD_TEMPLATES_MARKDOWN}. Do not edit this file.`,
		"//",
		`// Edit that document and run \`${GENERATE_COMMAND}\`. Every build re-derives`,
		"// this module from it and fails when the two disagree, so a hand edit here",
		"// cannot reach the artifact.",
		"",
		'import type { RawCoreTemplate, RawOptionalClause } from "../templateData";',
		"",
		"/** The document schema this data was generated from. */",
		`export const STANDARD_TEMPLATE_SCHEMA_VERSION = ${parsed.schemaVersion};`,
		"",
		"/**",
		" * The template data version the document declares.",
		" *",
		" * `STANDARD_TEMPLATE_SET_VERSION` is this value: it feeds every definition,",
		" * so adding, removing or rewording an entry has to raise it.",
		" */",
		`export const STANDARD_TEMPLATE_DATA_VERSION = ${parsed.dataVersion};`,
		"",
		`/** ${parsed.coreTemplates.length} core templates, in document order. */`,
		"export const STANDARD_CORE_TEMPLATES: readonly RawCoreTemplate[] = [",
		...parsed.coreTemplates.map((entry) =>
			renderEntry([
				["id", entry.id],
				["family", entry.family],
				["text", entry.text],
			]),
		),
		"];",
		"",
		`/** ${parsed.optionalClauses.length} Optional Clauses, in document order. */`,
		"export const STANDARD_OPTIONAL_CLAUSES: readonly RawOptionalClause[] = [",
		...parsed.optionalClauses.map((entry) =>
			renderEntry([
				["id", entry.id],
				["category", entry.category],
				["text", entry.text],
			]),
		),
		"];",
		"",
	];
	return lines.join("\n");
}

/** Reads the document, refusing a missing one with the path that is expected. */
async function readTemplateMarkdown(file) {
	try {
		return await readFile(file, "utf8");
	} catch {
		throw new Error(
			`The standard Fake Dictionary template document is missing or unreadable: ${STANDARD_TEMPLATES_MARKDOWN}.`,
		);
	}
}

/**
 * The generated module is rendered with `\n`, but a checkout can hold it with
 * `\r\n` — Git's `core.autocrlf` does exactly that on Windows. Line endings are
 * the file's presentation, never its content: no template body contains one, so
 * normalising them before the comparison cannot hide a stale or edited entry,
 * while comparing raw bytes would call a perfectly good checkout stale.
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
export async function generateStandardTemplates(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const markdown =
		options.markdown ??
		(await readTemplateMarkdown(
			options.markdownPath ?? path.join(rootDir, STANDARD_TEMPLATES_MARKDOWN),
		));
	const parsed = parseStandardTemplateMarkdown(markdown);
	if (!parsed.ok) {
		throw new Error(
			`${STANDARD_TEMPLATES_MARKDOWN} is not a valid template document: ${describeTemplateSourceIssues(parsed.issues)}`,
		);
	}
	const compiler = await loadTemplateCompiler(rootDir);
	const compiled = compiler.compileTemplateSet(
		parsed.dataVersion,
		parsed.coreTemplates,
		parsed.optionalClauses,
	);
	if (!compiled.ok) {
		throw new Error(
			`${STANDARD_TEMPLATES_MARKDOWN} does not compile: ${compiled.issues
				.map(compiler.describeTemplateIssue)
				.join("; ")}`,
		);
	}
	return { parsed, compiled: compiled.set, source: renderGeneratedTemplateModule(parsed) };
}

/**
 * Fails unless the generated module on disk is exactly what the document
 * implies. Called by every build, so stale or hand-edited generated data can
 * never be bundled, and there is no fallback to whatever is already there.
 */
export async function assertStandardTemplatesGenerated(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { source, parsed } = await generateStandardTemplates(options);
	const generatedPath =
		options.generatedPath ?? path.join(rootDir, STANDARD_TEMPLATES_GENERATED);
	let current;
	try {
		current = await readFile(generatedPath, "utf8");
	} catch {
		throw new Error(
			`${STANDARD_TEMPLATES_GENERATED} is missing. Run \`${GENERATE_COMMAND}\`.`,
		);
	}
	if (normalizeLineEndings(current) !== normalizeLineEndings(source)) {
		throw new Error(
			`${STANDARD_TEMPLATES_GENERATED} does not match ${STANDARD_TEMPLATES_MARKDOWN}. Run \`${GENERATE_COMMAND}\`.`,
		);
	}
	return { dataVersion: parsed.dataVersion, schemaVersion: parsed.schemaVersion };
}

/**
 * The bundle-time guard.
 *
 * `prepareBundleInputs` checks the document once before a build starts, which
 * is enough for a one-shot build but not for a watching one: a watch rebuilds
 * whenever a bundled file changes, so an edit to the generated module after the
 * watch began would otherwise reach `main.js` unverified, and an edit to the
 * document would not be noticed at all because Markdown is not part of the
 * bundle's dependency graph.
 *
 * This plugin closes both. `onStart` runs on every build and every rebuild, so
 * the generated module is re-derived from the document each time; and loading
 * the generated module registers the document as a watch input, so editing the
 * document triggers a rebuild that then fails until it is regenerated. Neither
 * hook regenerates anything by itself: the generated module stays something a
 * person refreshes deliberately.
 */
export function standardTemplatesPlugin(rootDir) {
	const generated = path.resolve(rootDir, STANDARD_TEMPLATES_GENERATED);
	const markdown = path.resolve(rootDir, STANDARD_TEMPLATES_MARKDOWN);
	return {
		name: "semantropy-standard-templates",
		setup(build) {
			build.onStart(async () => {
				try {
					await assertStandardTemplatesGenerated({ rootDir });
					return null;
				} catch (error) {
					return {
						errors: [{ text: error instanceof Error ? error.message : String(error) }],
					};
				}
			});
			// esbuild compiles filters with Go's regexp engine, which has no `u` flag.
			build.onLoad({ filter: /standardTemplateEntries\.ts$/ }, async (args) => {
				if (path.resolve(args.path) !== generated) {
					return null;
				}
				return {
					contents: await readFile(args.path, "utf8"),
					loader: "ts",
					watchFiles: [markdown],
				};
			});
		},
	};
}

/**
 * Writes the generated module.
 *
 * The document is parsed and compiled before anything is written, so a refused
 * document leaves the previous generated file untouched rather than replacing
 * it with a half-written one.
 */
export async function writeStandardTemplates(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { source, parsed } = await generateStandardTemplates(options);
	const outfile =
		options.generatedPath ?? path.join(rootDir, STANDARD_TEMPLATES_GENERATED);
	// Written beside the destination and moved into place, so an interrupted
	// write, a full disk or a killed process leaves the previous module intact
	// rather than a truncated tracked file. `rename` within one directory is
	// atomic on every platform this builds on.
	const staging = `${outfile}.generating`;
	try {
		await writeFile(staging, source, "utf8");
		await rename(staging, outfile);
	} catch (error) {
		await rm(staging, { force: true });
		throw error;
	}
	return {
		outfile: STANDARD_TEMPLATES_GENERATED,
		schemaVersion: parsed.schemaVersion,
		dataVersion: parsed.dataVersion,
		coreTemplates: parsed.coreTemplates.length,
		optionalClauses: parsed.optionalClauses.length,
	};
}
