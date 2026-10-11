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
 *
 * FAKE-PROVERB-RECIPES3 (`Docs/fake_proverb_recipes3_amendment1.md`): a recipe
 * is written as one `line:` of fixed text and holes (`{n1}は{n2}を{v1}`). The
 * parser turns it into the same Recipe Schema 2 parts as before; fixed text has
 * no entry of its own, and its id comes from the text. Problems are also
 * explained in Japanese for the owner, who edits the document.
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
// The schema's limits and closed forms, for the Japanese explanations only: the compiler alone decides what is valid.
const sourceSchema = await loadRecipeSchema(fileURLToPath(new URL("../../", import.meta.url)));
export const FAKE_PROVERB_RECIPE_SCHEMA_VERSION = sourceCompiler.FAKE_PROVERB_RECIPE_SCHEMA_VERSION;
export const FAKE_PROVERB_LITERAL_MAX_CODE_POINTS = sourceCompiler.FAKE_PROVERB_LITERAL_MAX_CODE_POINTS;

const ENTRY_KINDS = ["proverb", "gloss", "profile"];
/** Fields a kind may carry once, before its `line:` (a recipe) or its `form:` lines (a profile). */
const SCALAR_FIELDS = Object.freeze({
	proverb: ["enabled", "weight"],
	gloss: ["enabled", "weight"],
	profile: ["kind", "tag"],
});
const REQUIRED_FIELDS = Object.freeze({
	proverb: ["enabled", "weight"],
	gloss: ["enabled", "weight"],
	profile: ["kind"],
});
// The closed slot kinds come from the compiler, so the line syntax never disagrees with the schema.
const SLOT_KINDS = [...sourceCompiler.FAKE_PROVERB_SLOT_KINDS];
/** The letter that names a slot kind inside a hole: `{n1}`, `{m1}`, `{v1}`, `{a1}`. */
const HOLE_KINDS = Object.freeze({ n: "noun", m: "modifier", v: "predicate", a: "adverbial" });
if (JSON.stringify(Object.values(HOLE_KINDS)) !== JSON.stringify(SLOT_KINDS)) {
	throw new Error("The Fake Proverb hole letters do not cover the schema's slot kinds.");
}
const KIND_JA = Object.freeze({ noun: "名詞", modifier: "修飾", predicate: "述語", adverbial: "連用の修飾" });
const METADATA_KEYS = ["schema-version", "data-version"];
const HEADING = /^## ([^ ]+) (.+)$/u;
const TITLE = /^# (.+)$/u;
const FIELD = /^([a-z][a-z0-9-]*): (.*)$/su;
const INTEGER = /^(0|[1-9][0-9]*)$/u;
/** A hole: an optional `-` or `+`, a kind letter, a number 1 to 9, and an optional `:tag`. */
const HOLE = /^([-+]?)([nmva])([1-9])(?::(.*))?$/su;
/** A profile tag: one to four Hiragana, Katakana or Han characters. */
const TAG = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]{1,4}$/u;

/**
 * The id of a fixed literal, derived from its text: `l-` and the first eight hex
 * digits of the text's SHA-256 (UTF-8). The same text is the same literal
 * wherever and whenever it is written, so adding a recipe never renames another
 * recipe's literals. Two texts that meet in one id stop the build.
 */
export const FAKE_PROVERB_LITERAL_ID_HEX_DIGITS = 8;
export function fakeProverbLiteralId(text) {
	return `l-${createHash("sha256").update(String(text), "utf8").digest("hex").slice(0, FAKE_PROVERB_LITERAL_ID_HEX_DIGITS)}`;
}

/**
 * One problem. `code`, `line` and `detail` are what tests and records name;
 * `entry` (kind and id) and `ja` (a sentence for the person editing the
 * document) are for the Japanese report.
 */
function issue(code, line, detail, ja, entry) {
	return {
		code, line,
		...(detail === undefined ? {} : { detail }),
		...(entry === undefined ? {} : { entry }),
		...(ja === undefined ? {} : { ja }),
	};
}

export function describeFakeProverbSourceIssue(entry) {
	const where = entry.line === undefined ? "" : ` (line ${entry.line})`;
	return entry.detail === undefined ? `${entry.code}${where}` : `${entry.code}${where}: ${entry.detail}`;
}

export function describeFakeProverbSourceIssues(issues) {
	return issues.map(describeFakeProverbSourceIssue).join("; ");
}

/**
 * The same problems for the person who edits the document: the line, the entry,
 * a Japanese sentence where one is written, and the code in brackets. A problem
 * the document cannot cause by itself keeps its code alone. One mistake the
 * compiler reports under two codes (the same line, the same sentence) is said
 * once, with both codes.
 */
export function explainFakeProverbSourceIssues(issues) {
	const said = new Map();
	for (const entry of issues) {
		const where = entry.entry === undefined ? "" : `（${entry.entry}）`;
		const text = entry.ja ?? (entry.detail === undefined ? "（日本語の説明の無い誤りです）" : `（日本語の説明の無い誤りです: ${entry.detail}）`);
		const sentence = `${entry.line} 行目${where}: ${text}`;
		const codes = said.get(sentence) ?? [];
		if (!codes.includes(entry.code)) codes.push(entry.code);
		said.set(sentence, codes);
	}
	const lines = [`${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN} に、直すところがあります。`];
	for (const [sentence, codes] of said) lines.push("", `${sentence} (${codes.join(", ")})`);
	return lines.join("\n");
}

function parsePositiveSafeInteger(value) {
	const numeric = Number(value);
	return INTEGER.test(value) && Number.isSafeInteger(numeric) && numeric >= 1 && String(numeric) === value
		? numeric : null;
}

/** Splits one authored line into fixed text and holes: `{` opens a hole and the next `}` closes it. Null when a `{` is never closed. */
function splitLine(text) {
	const pieces = [];
	let rest = text;
	while (rest !== "") {
		const open = rest.indexOf("{");
		if (open === -1) {
			pieces.push({ literal: rest });
			break;
		}
		if (open > 0) pieces.push({ literal: rest.slice(0, open) });
		const close = rest.indexOf("}", open);
		if (close === -1) return null;
		pieces.push({ hole: rest.slice(open + 1, close) });
		rest = rest.slice(close + 1);
	}
	return pieces;
}

const WEIGHT_JA = "weight は、1 以上の整数で書きます（0、小数、先頭に 0 の付く数は使えません）。";
const HOLE_SHAPES_JA = "使える形は {n1} {m1} {v1} {a1} で、番号は 1 から 9 までです。";

/** Strict line syntax followed by the same semantic compiler used by generation. */
export function parseStandardFakeProverbRecipeMarkdown(markdown) {
	return parseWithCompiler(markdown, sourceCompiler, sourceSchema);
}

/**
 * Reads the document.
 *
 * A recipe is `enabled`, `weight` and one `line:` of fixed text and holes. From
 * the holes come the parts the compiler knows: a proverb hole is a slot named
 * by its letter and number and exported unless it starts with `-`; a gloss
 * hole without `+` is a reference to the proverb slot of that name, and a
 * requirement in order of first appearance; a gloss hole with `+` is a
 * gloss-local slot, named `g1`, `g2` … in order of first appearance, and the
 * same `+` name again is a reference to it. A tag after `:` picks the profile
 * of that kind that declares it; no tag picks the kind's profile without one.
 * Each run of fixed text is one literal part, and equal text is one literal.
 */
function parseWithCompiler(markdown, compiler, schema) {
	const issues = [];
	const lines = String(markdown).replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);
	const metadata = new Map();
	const metadataLines = new Map();
	const entries = [];
	let sawTitle = false;
	let current = null;
	let state = "metadata";
	const named = (entry) => `${entry.kind} ${entry.id}`;

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
				const [, kind, id] = heading;
				if (!ENTRY_KINDS.includes(kind)) {
					issues.push(issue("unknown-entry-kind", line, kind,
						kind === "literal"
							? "literal の項目は、いまの書式にはありません。固定の文字は、line: の文の中に直接書きます。"
							: `項目の種類「${kind}」はありません。使えるのは proverb、gloss、profile です。`));
				}
				current = { kind, id, line, fields: new Map(), fieldLines: new Map(), text: null, textLine: null, forms: [] };
				entries.push(current);
				state = "fields";
				continue;
			}
			if (TITLE.test(raw)) {
				if (entries.length > 0) issues.push(issue("unexpected-title", line, undefined, "題の行（# で始まる行）は、ファイルの最初に 1 つだけ書きます。"));
				else if (sawTitle) issues.push(issue("duplicate-title", line, undefined, "題の行（# で始まる行）が 2 つあります。"));
				sawTitle = true;
			} else {
				issues.push(issue("unknown-heading", line, undefined, "見出しの書き方が違います。「## proverb id」のように、## と種類と id を、半角の空白 1 つで区切ります。"));
				// What follows belongs to no entry the parser knows: skip it up to the next entry, so one typo is one problem.
				if (state !== "metadata") { current = { kind: "", id: "", line, fields: new Map(), fieldLines: new Map(), text: null, textLine: null, forms: [] }; state = "fields"; }
			}
			continue;
		}
		if (state === "metadata") {
			const field = FIELD.exec(raw);
			if (!field) { issues.push(issue("orphan-content", line, undefined, "どの項目にも入らない行です。注記にするなら、行の先頭に「> 」を付けます。")); continue; }
			const [, key, value] = field;
			if (!METADATA_KEYS.includes(key)) { issues.push(issue("unknown-metadata", line, key, `最初の項目より前に書けるのは、schema-version と data-version だけです。`)); continue; }
			if (metadata.has(key)) { issues.push(issue("duplicate-metadata", line, key, `${key} が 2 回書いてあります。`)); continue; }
			const numeric = parsePositiveSafeInteger(value);
			if (numeric === null) issues.push(issue("invalid-metadata", line, key, `${key} は、1 以上の整数で書きます。`));
			metadata.set(key, numeric ?? 0);
			metadataLines.set(key, line);
			continue;
		}
		if (current === null) { issues.push(issue("orphan-content", line)); continue; }
		// The lines of an entry whose heading was refused are already accounted for.
		if (!ENTRY_KINDS.includes(current.kind)) continue;
		if (state !== "fields") {
			issues.push(issue("unexpected-content", line, current.id, "項目の途中に空行があります。空行は、項目と項目のあいだにだけ置きます。", named(current)));
			continue;
		}
		const field = FIELD.exec(raw);
		if (!field) {
			issues.push(issue("invalid-field", line, current.id, "行の書き方が違います。「名前: 値」の形で、コロンの後ろに半角の空白を 1 つ置きます。", named(current)));
			continue;
		}
		const [, key, value] = field;
		const recipe = current.kind !== "profile";
		if (recipe && key === "line") {
			if (current.textLine !== null) { issues.push(issue("duplicate-line", line, current.id, "line: は、1 つの項目に 1 行だけ書きます。", named(current))); continue; }
			// The text is taken as written: its fixed text and holes are judged below.
			current.text = value;
			current.textLine = line;
			continue;
		}
		if (!recipe && key === "form") {
			const words = value.split(" ");
			if (words.length !== 2 || words[0] === "") {
				issues.push(issue("invalid-form-line", line, current.id, "form: は「形 出やすさ」と書きます（例: form: verb-basic 1）。", named(current)));
				continue;
			}
			const weight = parsePositiveSafeInteger(words[1]);
			if (weight === null) { issues.push(issue("invalid-weight", line, current.id, WEIGHT_JA.replace("weight", "form: の出やすさ"), named(current))); continue; }
			current.forms.push({ form: words[0], weight });
			continue;
		}
		if (!SCALAR_FIELDS[current.kind].includes(key)) {
			const old = recipe && (key === "part" || key === "requires");
			issues.push(issue("unknown-field", line, `${current.id}: ${key}`,
				old ? `${key}: は、古い書式です。型の文は、line: の 1 行に書きます（例: line: {n1}は{n2}を{v1}）。`
					: `${current.kind} の項目に、${key}: は書けません。`, named(current)));
			continue;
		}
		if (current.textLine !== null || current.forms.length > 0) {
			issues.push(issue("misplaced-field", line, `${current.id}: ${key}`, `${key}: は、${recipe ? "line:" : "form:"} より前に書きます。`, named(current)));
			continue;
		}
		if (current.fields.has(key)) { issues.push(issue("duplicate-field", line, `${current.id}: ${key}`, `${key}: が 2 回書いてあります。`, named(current))); continue; }
		current.fields.set(key, value);
		current.fieldLines.set(key, line);
	}
	for (const key of METADATA_KEYS) {
		if (!metadata.has(key)) issues.push(issue("missing-metadata", 1, key, `${key} の行がありません。最初の項目より前に書きます。`));
	}
	if (entries.length === 0) issues.push(issue("no-entries", lines.length, undefined, "項目が 1 つもありません。"));

	// Profiles first: a hole's tag is looked up in them, wherever in the document they stand.
	const profiles = [];
	const profileLines = new Map();
	const byTag = new Map(SLOT_KINDS.map((kind) => [kind, new Map()]));
	for (const entry of entries) {
		if (entry.kind !== "profile") continue;
		for (const key of REQUIRED_FIELDS.profile) {
			if (!entry.fields.has(key)) issues.push(issue("missing-field", entry.line, `${entry.id}: ${key}`, `${key}: の行がありません。`, named(entry)));
		}
		const kind = entry.fields.get("kind") ?? "";
		const tag = entry.fields.get("tag");
		if (tag !== undefined && !TAG.test(tag)) {
			issues.push(issue("invalid-tag", entry.fieldLines.get("tag"), `${entry.id}: ${tag}`, "tag は、ひらがな、カタカナ、漢字の 1 字から 4 字です。既定の profile にするなら、tag: の行を書きません。", named(entry)));
		} else if (byTag.has(kind)) {
			const tags = byTag.get(kind);
			const key = tag ?? "";
			if (tags.has(key)) {
				issues.push(tag === undefined
					? issue("duplicate-default-profile", entry.line, `${entry.id}: ${kind}`, `tag の無い profile（既定）が、kind: ${kind} に 2 つあります。既定は、種類ごとに 1 つまでです。`, named(entry))
					: issue("duplicate-tag", entry.fieldLines.get("tag"), `${entry.id}: ${kind} ${tag}`, `tag「${tag}」が、kind: ${kind} の profile に 2 回使われています。`, named(entry)));
			} else tags.set(key, entry.id);
		}
		profiles.push({ id: entry.id, kind, forms: entry.forms });
		profileLines.set(entry.id, entry.line);
	}

	const literals = [];
	const literalIds = new Map();
	const literalOrigins = new Map();
	const literalPart = (text, entry) => {
		if (!literalIds.has(text)) {
			const id = fakeProverbLiteralId(text);
			const clash = literalOrigins.get(id);
			if (clash !== undefined) {
				issues.push(issue("literal-id-collision", entry.textLine, `${entry.id}: ${id}`,
					`固定の文字「${text}」と「${clash.text}」が、同じ id（${id}）になりました。めったに起きません。どちらかの文字を、少し変えてください。`, named(entry)));
			}
			literalIds.set(text, id);
			literalOrigins.set(id, { text, line: entry.textLine, entry: named(entry) });
			literals.push({ id, literal: text });
			if (compiler.inspectFakeProverbLiteral(text) !== null) {
				issues.push(issue("invalid-literal", entry.textLine, `${entry.id}: ${text}`,
					`固定の文字「${text}」に、使えない字があるか、長すぎます。使えるのは、ひらがな、カタカナ、漢字、ー 、 。 だけで、穴と穴のあいだの 1 続きが ${compiler.FAKE_PROVERB_LITERAL_MAX_CODE_POINTS} 字までです。`, named(entry)));
			}
		}
		return { kind: "literal", literalId: literalIds.get(text) };
	};
	const profileOf = (kind, tag, entry, hole) => {
		if (tag !== undefined && !TAG.test(tag)) {
			issues.push(issue("invalid-tag", entry.textLine, `${entry.id}: {${hole}}`, `穴 {${hole}} の「:」の後ろには、profile の tag（1 字から 4 字）を書きます。`, named(entry)));
			return "";
		}
		const id = byTag.get(kind).get(tag ?? "");
		if (id === undefined) {
			issues.push(tag === undefined
				? issue("no-default-profile", entry.textLine, `${entry.id}: {${hole}}`, `穴 {${hole}} に使う、tag の無い profile（kind: ${kind} の既定）がありません。{${hole}:形} のように、tag を付けます。`, named(entry))
				: issue("unknown-tag", entry.textLine, `${entry.id}: {${hole}}`, `穴 {${hole}} の tag「${tag}」を持つ profile（kind: ${kind}）がありません。profile の項目の tag: を見てください。`, named(entry)));
			return "";
		}
		return id;
	};

	const proverbs = [];
	const glosses = [];
	/** Per recipe: where its `line:` is, and how each compiled slot id was written. */
	const recipes = new Map();
	const authored = {};
	for (const entry of entries) {
		if (entry.kind !== "proverb" && entry.kind !== "gloss") continue;
		for (const key of REQUIRED_FIELDS[entry.kind]) {
			if (!entry.fields.has(key)) issues.push(issue("missing-field", entry.line, `${entry.id}: ${key}`, `${key}: の行がありません。`, named(entry)));
		}
		const weight = entry.fields.has("weight") ? parsePositiveSafeInteger(entry.fields.get("weight")) : 0;
		if (weight === null) issues.push(issue("invalid-weight", entry.fieldLines.get("weight"), entry.id, WEIGHT_JA, named(entry)));
		const enabledText = entry.fields.get("enabled");
		if (enabledText !== undefined && enabledText !== "true" && enabledText !== "false") {
			issues.push(issue("invalid-boolean", entry.fieldLines.get("enabled"), `${entry.id}: enabled`, "enabled は、true か false と書きます。", named(entry)));
		}
		const enabled = enabledText === "true";
		const holes = new Map();
		recipes.set(entry.id, { kind: entry.kind, line: entry.textLine ?? entry.line, holes });
		if (entry.textLine === null) {
			issues.push(issue("missing-line", entry.line, entry.id, "line: の行がありません。型の文を、line: の後ろに 1 行で書きます。", named(entry)));
			continue;
		}
		authored[entry.id] = entry.text;
		const pieces = entry.text === "" ? null : splitLine(entry.text);
		if (pieces === null) {
			issues.push(issue("invalid-line", entry.textLine, entry.id,
				entry.text === "" ? "line: の文が空です。" : "line: の文に、閉じていない { があります。穴は {n1} のように、} で閉じます。", named(entry)));
			continue;
		}
		const parts = [];
		const badHole = (hole) => issues.push(issue("invalid-hole", entry.textLine, `${entry.id}: {${hole}}`, `穴 {${hole}} の書き方が違います。${HOLE_SHAPES_JA}`, named(entry)));
		if (entry.kind === "proverb") {
			for (const piece of pieces) {
				if ("literal" in piece) { parts.push(literalPart(piece.literal, entry)); continue; }
				const hole = HOLE.exec(piece.hole);
				if (!hole) { badHole(piece.hole); continue; }
				if (hole[1] === "+") {
					issues.push(issue("local-hole-in-proverb", entry.textLine, `${entry.id}: {${piece.hole}}`, `ことわざの中では、+ の付いた穴 {${piece.hole}} は使えません。+ は、解説だけの新しい語に使います。`, named(entry)));
					continue;
				}
				const kind = HOLE_KINDS[hole[2]];
				const slotId = `${hole[2]}${hole[3]}`;
				holes.set(slotId, `{${piece.hole}}`);
				parts.push({ kind, slotId, profileId: profileOf(kind, hole[4], entry, piece.hole), exported: hole[1] !== "-" });
			}
			proverbs.push({ id: entry.id, enabled, weight: weight ?? 0, parts });
			continue;
		}
		const requires = [];
		const required = new Set();
		const locals = new Map();
		for (const piece of pieces) {
			if ("literal" in piece) { parts.push(literalPart(piece.literal, entry)); continue; }
			const hole = HOLE.exec(piece.hole);
			if (!hole) { badHole(piece.hole); continue; }
			if (hole[1] === "-") {
				issues.push(issue("private-hole-in-gloss", entry.textLine, `${entry.id}: {${piece.hole}}`, `解説の中では、- の付いた穴 {${piece.hole}} は使えません。- は、ことわざの穴を解説に渡さないときに使います。`, named(entry)));
				continue;
			}
			const kind = HOLE_KINDS[hole[2]];
			const name = `${hole[2]}${hole[3]}`;
			const referenceTag = () => issues.push(issue("tag-on-reference", entry.textLine, `${entry.id}: {${piece.hole}}`,
				`穴 {${piece.hole}} には、「:」と tag を付けられません。ことわざの語を使う穴と、2 回目から後の + の穴の形は、最初に書いたところで決まっています。`, named(entry)));
			if (hole[1] === "+") {
				if (locals.has(name)) {
					// The same new word again: a reference to the gloss-local slot.
					if (hole[4] !== undefined) { referenceTag(); continue; }
					parts.push({ kind: "reference", slotKind: kind, slotId: locals.get(name) });
					continue;
				}
				const slotId = `g${locals.size + 1}`;
				locals.set(name, slotId);
				holes.set(slotId, `{+${name}}`);
				parts.push({ kind, slotId, profileId: profileOf(kind, hole[4], entry, piece.hole), exported: false });
				continue;
			}
			if (hole[4] !== undefined) { referenceTag(); continue; }
			if (!required.has(name)) {
				required.add(name);
				requires.push({ kind, slotId: name });
			}
			holes.set(name, `{${name}}`);
			parts.push({ kind: "reference", slotKind: kind, slotId: name });
		}
		glosses.push({ id: entry.id, enabled, weight: weight ?? 0, requires, parts });
	}

	if (issues.length > 0) return { ok: false, issues: Object.freeze([...issues].sort((a, b) => a.line - b.line)) };
	const input = { schemaVersion: metadata.get("schema-version"), dataVersion: metadata.get("data-version"), proverbs, glosses, literals, profiles };
	const result = compiler.compileFakeProverbRecipeSet(input);
	if (!result.ok) {
		const context = { recipes, profileLines, literalOrigins, metadataLines, limits: schema.FAKE_PROVERB_LIMITS, forms: schema.FAKE_PROVERB_CANDIDATE_FORMS, schemaVersion: compiler.FAKE_PROVERB_RECIPE_SCHEMA_VERSION };
		return { ok: false, issues: Object.freeze(result.issues.map((entry) => compiledIssue(entry, context)).sort((a, b) => a.line - b.line)) };
	}
	return { ok: true, ...input, authored: Object.freeze(authored) };
}

/** The slot id a compiler detail names: its first word, or the word after a kind (`noun n4`), without a trailing colon. */
function slotIdOf(detail) {
	if (typeof detail !== "string") return null;
	const words = detail.replace(/:.*$/su, "").split(" ");
	return words.at(-1) ?? null;
}

/** The Japanese sentence for a problem the compiler found in what the document says. Undefined when none is written. */
function explainCompiled(entry, recipe, context) {
	const { limits } = context;
	const role = recipe?.kind;
	const roleJa = role === "gloss" ? "解説" : "ことわざ";
	const slotId = slotIdOf(entry.detail);
	const hole = recipe?.holes.get(slotId ?? "") ?? (slotId === null ? "穴" : `{${slotId}}`);
	switch (entry.code) {
		case "na-follower":
			return `${hole} の直後に置けません。${hole} には「静かな」の形が入ることがあるので、直後は、名詞の穴か、名詞で始まる文字（漢字かカタカナで始まる語、または こと もの ところ ため はず わけ ほう）にします。こと もの などの次の字は、文字の終わりか、が を に は も で の と か だ 、 。 のどれかだけです（「ものなり」の「な」は使えません）。行の最後にも置けません。動詞や形容詞だけにするなら、tag で形を絞ります（例: {m1:活}）。`;
		case "adverbial-follower":
			return `${hole} の直後に置けません。連用の修飾（「静かに」の形）の直後は、述語の穴か、「静かな」の入らない修飾の穴にします。行の最後にも置けません。`;
		case "kind-limit": {
			const kind = entry.detail;
			const limit = limits.slots[role]?.[kind];
			return `${KIND_JA[kind] ?? kind}の穴が多すぎます。${role === "gloss" ? "解説だけの新しい語" : "ことわざ"}では、${limit} 個までです。`;
		}
		case "part-limit":
			return `穴と固定の文字を合わせた数が、多すぎます（${roleJa}は ${limits.parts[role]} 個まで）。`;
		case "export-limit":
			return `解説に渡す穴が多すぎます（${limits.exports} 個まで）。渡さなくてよい穴の前に、- を付けます（例: {-n3}）。`;
		case "require-limit":
			return `解説が使うことわざの穴が多すぎます（${limits.requires} 種類まで）。`;
		case "reference-limit":
			return `ことわざの語と、2 回目から後の + の穴を合わせた数が、多すぎます（${limits.references} 個まで）。`;
		case "duplicate-slot-id":
		case "duplicate-export":
			return `同じ穴 ${hole} を 2 回書いています。ことわざの中では、1 つの穴は 1 回だけ書けます。`;
		case "missing-export":
			return "解説に渡す穴が 1 つもありません。- を付けない穴が、1 つ以上要ります。";
		case "missing-require":
			return "ことわざの語を 1 つも使っていません。解説は、ことわざの穴（{n1} や {v1}）を 1 つ以上使います。";
		case "unknown-reference":
			return `${hole} を持つことわざが、1 つもありません。解説は、ことわざにある穴だけを使えます。`;
		case "unexported-reference":
			return `${hole} は、どのことわざも解説に渡していません（ことわざの側で、- が付いています）。`;
		case "unpaired-proverb":
			return "このことわざに付けられる解説が、1 つもありません。解説は、自分が使う穴を全部持っていることわざにだけ付きます。";
		case "unpaired-gloss":
			return "この解説が付くことわざが、1 つもありません。使っている穴を全部渡すことわざが要ります。";
		case "unused-profile":
			return "この profile を使う穴が、1 つもありません。使わない profile は、消します。";
		case "invalid-profile-kind":
			return "kind は、noun、modifier、predicate、adverbial のどれかです。";
		case "invalid-form": {
			const kind = String(entry.detail).split(" ")[0];
			const allowed = context.forms[kind];
			return `この種類の profile には書けない形です。${allowed === undefined ? "" : `kind: ${kind} に書ける形は、${allowed.join("、")} です。`}`;
		}
		case "duplicate-form":
			return `同じ形（${entry.detail}）を 2 回書いています。`;
		case "missing-form":
			return "form: の行が 1 つもありません。";
		case "invalid-id":
			return `id「${entry.id}」の書き方が違います。半角の英小文字で始め、英小文字と数字を、ハイフンでつなぎます（48 字まで）。`;
		case "duplicate-id":
			return `id「${entry.id}」が、2 回使われています。proverb、gloss、profile を通して、同じ id は 1 回だけです。`;
		default:
			return undefined;
	}
}

/** A compiler issue as a document issue: the line it comes from, the same detail as before, and a Japanese sentence. */
function compiledIssue(entry, context) {
	const detail = entry.detail === undefined ? entry.id : `${entry.id}: ${entry.detail}`;
	const recipe = context.recipes.get(entry.id);
	if (recipe !== undefined) return issue(entry.code, recipe.line, detail, explainCompiled(entry, recipe, context), `${recipe.kind} ${entry.id}`);
	if (context.profileLines.has(entry.id)) return issue(entry.code, context.profileLines.get(entry.id), detail, explainCompiled(entry, undefined, context), `profile ${entry.id}`);
	const literal = context.literalOrigins.get(entry.id);
	if (literal !== undefined) {
		return issue(entry.code, literal.line, detail,
			entry.code === "duplicate-id" ? `固定の文字「${literal.text}」の id（${entry.id}）が、項目の id と重なっています。項目の id を、別の名前にしてください。` : undefined, literal.entry);
	}
	if (context.metadataLines.has(entry.id)) {
		return issue(entry.code, context.metadataLines.get(entry.id), detail,
			entry.code === "unsupported-schema-version" ? `schema-version は、${context.schemaVersion} と書きます。` : `${entry.id} は、1 以上の整数で書きます。`);
	}
	const count = { proverbs: "ことわざ", glosses: "解説", literals: "固定の文字の種類", profiles: "profile" }[entry.id];
	if (entry.code === "entry-limit" && count !== undefined) {
		return issue(entry.code, 1, detail, `${count}の数（${entry.detail}）が、上限（${context.limits[entry.id]}）を超えています。`);
	}
	if (entry.code === "missing-proverb" || entry.code === "missing-gloss") {
		return issue(entry.code, 1, detail, `使う（enabled: true の）${entry.code === "missing-gloss" ? "解説" : "ことわざ"}が、1 つもありません。`);
	}
	return issue(entry.code, 1, detail);
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
	return await loadSourceModule(rootDir, FAKE_PROVERB_RECIPE_VALIDATORS[0]);
}

/** The hand-written schema, loaded the same way. Its limits and form lists are quoted in explanations, never used to judge. */
async function loadRecipeSchema(rootDir) {
	return await loadSourceModule(rootDir, FAKE_PROVERB_RECIPE_VALIDATORS[1]);
}

async function loadSourceModule(rootDir, file) {
	const built = await esbuild.build({
		entryPoints: [path.join(rootDir, file)],
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
	const parsed = parseWithCompiler(markdown, compiler, await loadRecipeSchema(rootDir));
	if (!parsed.ok) {
		// The first line is what tests and records read; the Japanese lines after it are for the person editing the document.
		throw new Error(
			`${STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN} is not a valid recipe document: ${describeFakeProverbSourceIssues(parsed.issues)}

${explainFakeProverbSourceIssues(parsed.issues)}`,
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
	// A previous module may predate the current schema (Schema 1 before FAKE-PROVERB-NA1), never follow it.
	if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1 || value.schemaVersion > FAKE_PROVERB_RECIPE_SCHEMA_VERSION) return false;
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
