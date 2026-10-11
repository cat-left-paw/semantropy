/**
 * Compiles a Fake Alert recipe document (Recipe Schema 1) into a frozen typed
 * set (`Docs/fake_alert_policy1.md` §4 and §7.1).
 *
 * The Markdown parser is not enough: this is the product validator. The
 * build-time generator loads this module (never the generated entries), so
 * there is no path that turns a parsed document into generated data without
 * passing here. It is used by the build and by tests only; the plugin restores
 * the generated compact data with `unpackFakeAlertRecipeSet()` and never
 * bundles this file.
 *
 * A document has families and three kinds of recipe. A `prompt` is answered by
 * a button and followed by an `outcome`; a `terminal` is shown once and closed.
 * Every Outcome can follow every Prompt: there is no pairing declaration. A
 * shared slot (`{n1}`) is a binding a Prompt and its Outcome share by name; a
 * local slot (`{+n1}`) exists only in an Outcome and is always a new draw.
 *
 * Besides each entry's own rules, the compiler checks that the standard data
 * always leaves a path at Text Semantropy 0 and for a Vocabulary with no sahen
 * noun and no verb, because the generator never relaxes a forbidden category to
 * make an Alert possible.
 */

import {
	FAKE_ALERT_ADJECTIVE_FOLLOWERS,
	FAKE_ALERT_BUTTON_ROLES,
	FAKE_ALERT_BUTTON_SETS,
	FAKE_ALERT_BUTTON_SET_IDS,
	FAKE_ALERT_CLOSING_BUTTON_SET,
	FAKE_ALERT_DRIFT_MAX,
	FAKE_ALERT_ID_MAX_LENGTH,
	FAKE_ALERT_KINDS,
	FAKE_ALERT_LIMITS,
	FAKE_ALERT_LITERAL_PATTERN,
	FAKE_ALERT_NA_FOLLOWERS,
	FAKE_ALERT_ON,
	FAKE_ALERT_RECIPE_SCHEMA_VERSION,
	FAKE_ALERT_ROLES,
	FAKE_ALERT_SAHEN_FOLLOWERS,
	FAKE_ALERT_STAGES,
	FAKE_ALERT_TERMINAL_DRIFT_MIN,
	FAKE_ALERT_VERB_FOLLOWERS,
	FAKE_ALERT_VERB_NOUN_TAILS,
	FAKE_ALERT_VERB_NOUNS,
	type FakeAlertButtonSet,
	type FakeAlertKind,
	type FakeAlertOn,
	type FakeAlertRole,
	type FakeAlertStage,
	type RawFakeAlertFamily,
	type RawFakeAlertRecipe,
} from "./recipeData";
import {
	FAKE_ALERT_NEEDS,
	buildFakeAlertRecipeSet,
	parseFakeAlertSlotToken,
	type FakeAlertRecipe,
	type FakeAlertRecipeSet,
	type ResolvedFakeAlertFamily,
	type ResolvedFakeAlertPart,
	type ResolvedFakeAlertRecipe,
} from "./recipeSet";

// The build-time parser loads these with the compiler; no duplicate semantic rules.
export { FAKE_ALERT_LIMITS, FAKE_ALERT_RECIPE_SCHEMA_VERSION } from "./recipeData";
export { unpackFakeAlertRecipeSet } from "./recipeSet";

export type FakeAlertRecipeIssueCode =
	| "unsupported-schema-version"
	| "invalid-data-version"
	| "invalid-structure"
	| "unknown-field"
	| "entry-limit"
	| "invalid-id"
	| "duplicate-id"
	| "invalid-weight"
	| "invalid-boolean"
	| "invalid-stage"
	| "invalid-drift"
	| "terminal-drift-zero"
	| "invalid-on"
	| "missing-on"
	| "unexpected-on"
	| "unused-family"
	| "unknown-family"
	| "stage-mismatch"
	| "invalid-kind"
	| "invalid-buttons"
	| "missing-buttons"
	| "unexpected-buttons"
	| "missing-line"
	| "line-limit"
	| "invalid-line"
	| "invalid-slot"
	| "local-slot-outside-outcome"
	| "invalid-literal"
	| "literal-limit"
	| "slot-limit"
	| "invalid-sahen-follower"
	| "invalid-verb-follower"
	| "invalid-adjective-follower"
	| "invalid-na-follower"
	| "duplicate-recipe"
	| "no-level-zero-prompt"
	| "no-level-zero-outcome"
	| "no-noun-only-outcome";

export type FakeAlertRecipeIssue = {
	readonly code: FakeAlertRecipeIssueCode;
	readonly id: string;
	readonly detail?: string;
};

export type FakeAlertRecipeCompileResult =
	| { readonly ok: true; readonly set: FakeAlertRecipeSet }
	| { readonly ok: false; readonly issues: readonly FakeAlertRecipeIssue[] };

export type CompileFakeAlertRecipeSetInput = {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly families: readonly RawFakeAlertFamily[];
	readonly prompts: readonly RawFakeAlertRecipe[];
	readonly terminals: readonly RawFakeAlertRecipe[];
	readonly outcomes: readonly RawFakeAlertRecipe[];
};

/** Lowercase kebab-case. */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Cc / Cf / Cs / Zl / Zp: controls, format, surrogates, line and paragraph separators. */
const DISALLOWED_CATEGORY = /\p{Cc}|\p{Cf}|\p{Cs}|\p{Zl}|\p{Zp}/u;
const INPUT_KEYS = ["schemaVersion", "dataVersion", "families", "prompts", "terminals", "outcomes"];
const FAMILY_KEYS = ["id", "stage", "weight", "drift", "on"];
const RECIPE_KEYS = ["id", "family", "enabled", "kind", "weight", "buttons", "lines"];
const RECIPE_LISTS = [["prompts", "prompt"], ["terminals", "terminal"], ["outcomes", "outcome"]] as const;

function issue(code: FakeAlertRecipeIssueCode, id: string, detail?: string): FakeAlertRecipeIssue {
	return detail === undefined ? { code, id } : { code, id, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
	return typeof value === "string" && (list as readonly string[]).includes(value);
}

function label(value: unknown): string {
	return typeof value === "string" ? value : "?";
}

function hasIsolatedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index += 1;
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

/** Renders one issue as a single line for a build or test failure. */
export function describeFakeAlertRecipeIssue(entry: FakeAlertRecipeIssue): string {
	return entry.detail === undefined ? `${entry.code} (${entry.id})` : `${entry.code} (${entry.id}: ${entry.detail})`;
}

/**
 * Fixed text must be finished Japanese: NFC, the closed script grammar, and no
 * control, format, surrogate or separator code point. Braces are not in the
 * grammar, so a stray or nested brace is refused here.
 */
export function inspectFakeAlertLiteral(value: unknown): "invalid-literal" | null {
	if (typeof value !== "string" || value === "") return "invalid-literal";
	if (value !== value.normalize("NFC") || hasIsolatedSurrogate(value)) return "invalid-literal";
	return DISALLOWED_CATEGORY.test(value) || !FAKE_ALERT_LITERAL_PATTERN.test(value) ? "invalid-literal" : null;
}

/**
 * Splits one authored line into fixed text and slot tokens, without judging
 * them: `{` opens a slot, the next `}` closes it. An unclosed `{` is the only
 * failure here; a stray `}` stays in the fixed text and fails its grammar.
 */
function splitLine(text: string): ResolvedFakeAlertPart[] | null {
	const parts: ResolvedFakeAlertPart[] = [];
	let rest = text;
	while (rest !== "") {
		const open = rest.indexOf("{");
		if (open === -1) {
			parts.push({ literal: rest });
			break;
		}
		if (open > 0) parts.push({ literal: rest.slice(0, open) });
		const close = rest.indexOf("}", open);
		if (close === -1) return null;
		parts.push({ slot: rest.slice(open + 1, close) });
		rest = rest.slice(close + 1);
	}
	return parts;
}

/** Whether a part is a noun slot, shared or local: the word a basic form or な may modify directly. */
function isNounSlot(part: ResolvedFakeAlertPart | undefined): boolean {
	return part !== undefined && "slot" in part && parseFakeAlertSlotToken(part.slot)?.kind === "n";
}

/** Whether text is a particle, だ, で or a mark onwards, or nothing at the end of the line. */
function isNounTail(rest: string, last: boolean): boolean {
	return rest === "" ? last : FAKE_ALERT_VERB_NOUN_TAILS.some((tail) => rest.startsWith(tail));
}

/**
 * Whether fixed text starts with a noun a basic form (or な) modifies. The noun
 * must end the line or be followed by a particle, だ, で or a mark, so its
 * spelling cannot be the start of another word (`{v1}わけます`), and it cannot
 * run into a slot (`{v1}の{n1}`).
 */
function startsWithModifiedNoun(text: string, last: boolean): boolean {
	return FAKE_ALERT_VERB_NOUNS.some((noun) => text.startsWith(noun) && isNounTail(text.slice(noun.length), last));
}

/**
 * Whether what follows a verb or イ-adjective slot takes a basic form: nothing
 * (the word ends the line), a noun slot it modifies (`{v1}{n1}`, `{i1}{n1}`),
 * fixed text starting with a word that takes a basic form directly, or fixed
 * text starting with a noun it modifies.
 */
function followsBasicForm(next: ResolvedFakeAlertPart | undefined, last: boolean, direct: readonly string[]): boolean {
	if (next === undefined || isNounSlot(next)) return true;
	if (!("literal" in next)) return false;
	const text = next.literal;
	return direct.some((word) => text.startsWith(word)) || startsWithModifiedNoun(text, last);
}

/** A noun, as fixed text, begins with a Han or Katakana character. */
const NOUN_START = /^[\p{Script=Han}\p{Script=Katakana}]/u;

/**
 * Whether what follows a ナ-adjective slot completes its stem: nothing (the
 * stem ends the line), fixed text starting with a listed word, な before a noun
 * (a noun slot, fixed text that begins like a noun, or a listed noun with its
 * tail), or さ, which makes the stem a noun, with a noun's tail.
 */
function followsNa(next: ResolvedFakeAlertPart | undefined, after: ResolvedFakeAlertPart | undefined, last: boolean): boolean {
	if (next === undefined) return true;
	if (!("literal" in next)) return false;
	const text = next.literal;
	if (FAKE_ALERT_NA_FOLLOWERS.some((word) => text.startsWith(word))) return true;
	const rest = text.slice(1);
	if (text.startsWith("な")) return rest === "" ? isNounSlot(after) : NOUN_START.test(rest) || startsWithModifiedNoun(rest, last);
	return text.startsWith("さ") && isNounTail(rest, last);
}

function compileLine(text: unknown, id: string, stage: FakeAlertStage, issues: FakeAlertRecipeIssue[]): ResolvedFakeAlertPart[] | null {
	const before = issues.length;
	const parts = typeof text === "string" && text !== "" ? splitLine(text) : null;
	if (parts === null) {
		issues.push(issue("invalid-line", id));
		return null;
	}
	let literalCodePoints = 0;
	let slots = 0;
	for (const [index, part] of parts.entries()) {
		if ("literal" in part) {
			if (inspectFakeAlertLiteral(part.literal) !== null) issues.push(issue("invalid-literal", id, part.literal));
			literalCodePoints += [...part.literal].length;
			continue;
		}
		slots += 1;
		const slot = parseFakeAlertSlotToken(part.slot);
		if (slot === null) {
			issues.push(issue("invalid-slot", id, part.slot));
			continue;
		}
		if (slot.local && stage !== "outcome") issues.push(issue("local-slot-outside-outcome", id, part.slot));
		const next = parts[index + 1];
		const last = index + 2 === parts.length;
		if (slot.kind === "s") {
			// A sahen noun is completed by fixed text, or stands at the end of the line.
			const follows = next === undefined ||
				("literal" in next && FAKE_ALERT_SAHEN_FOLLOWERS.some((prefix) => next.literal.startsWith(prefix)));
			if (!follows) issues.push(issue("invalid-sahen-follower", id, part.slot));
		}
		// A verb or an イ-adjective is a basic form: it ends the line, or a noun slot or fixed text that takes that form follows.
		if (slot.kind === "v" && !followsBasicForm(next, last, FAKE_ALERT_VERB_FOLLOWERS)) issues.push(issue("invalid-verb-follower", id, part.slot));
		if (slot.kind === "i" && !followsBasicForm(next, last, FAKE_ALERT_ADJECTIVE_FOLLOWERS)) issues.push(issue("invalid-adjective-follower", id, part.slot));
		// A ナ-adjective is a stem: it ends the line, or fixed text that completes it follows.
		if (slot.kind === "na" && !followsNa(next, parts[index + 2], last)) issues.push(issue("invalid-na-follower", id, part.slot));
	}
	if (literalCodePoints > FAKE_ALERT_LIMITS.lineLiteralCodePoints) issues.push(issue("literal-limit", id));
	if (slots > FAKE_ALERT_LIMITS.lineSlots) issues.push(issue("slot-limit", id));
	return issues.length === before ? parts : null;
}

function checkFields(value: Record<string, unknown>, allowed: readonly string[], id: string, issues: FakeAlertRecipeIssue[]): void {
	for (const field of Object.keys(value)) {
		if (!allowed.includes(field)) issues.push(issue("unknown-field", id, field));
	}
}

function checkEntryId(id: unknown, seen: Set<string>, issues: FakeAlertRecipeIssue[]): id is string {
	if (typeof id !== "string" || id.length > FAKE_ALERT_ID_MAX_LENGTH || !ID_PATTERN.test(id)) {
		issues.push(issue("invalid-id", label(id)));
		return false;
	}
	if (seen.has(id)) issues.push(issue("duplicate-id", id));
	seen.add(id);
	return true;
}

function compileFamily(value: unknown, seen: Set<string>, issues: FakeAlertRecipeIssue[]): ResolvedFakeAlertFamily | null {
	if (!isRecord(value)) {
		issues.push(issue("invalid-structure", "family"));
		return null;
	}
	const before = issues.length;
	const id = value["id"];
	if (!checkEntryId(id, seen, issues)) return null;
	checkFields(value, FAMILY_KEYS, id, issues);
	const stage = value["stage"];
	if (!isOneOf(FAKE_ALERT_STAGES, stage)) issues.push(issue("invalid-stage", id, label(stage)));
	if (!isPositiveSafeInteger(value["weight"])) issues.push(issue("invalid-weight", id, String(value["weight"])));
	const drift = value["drift"];
	const validDrift = typeof drift === "number" && Number.isInteger(drift) && drift >= 0 && drift <= FAKE_ALERT_DRIFT_MAX;
	if (!validDrift) issues.push(issue("invalid-drift", id, String(drift)));
	else if (stage === "terminal" && drift < FAKE_ALERT_TERMINAL_DRIFT_MIN) issues.push(issue("terminal-drift-zero", id));
	const on = value["on"];
	if (stage === "outcome") {
		if (on === undefined) issues.push(issue("missing-on", id));
		else if (!isOneOf(FAKE_ALERT_ON, on)) issues.push(issue("invalid-on", id, label(on)));
	} else if (on !== undefined) issues.push(issue("unexpected-on", id));
	if (issues.length !== before) return null;
	return {
		id, stage: stage as FakeAlertStage, weight: value["weight"] as number, drift: drift as number,
		on: stage === "outcome" ? (on as FakeAlertOn) : null,
	};
}

function compileRecipe(
	value: unknown,
	stage: FakeAlertStage,
	seen: Set<string>,
	families: ReadonlyMap<string, ResolvedFakeAlertFamily>,
	used: Set<string>,
	issues: FakeAlertRecipeIssue[],
): ResolvedFakeAlertRecipe | null {
	if (!isRecord(value)) {
		issues.push(issue("invalid-structure", stage));
		return null;
	}
	const before = issues.length;
	const id = value["id"];
	if (!checkEntryId(id, seen, issues)) return null;
	checkFields(value, RECIPE_KEYS, id, issues);
	const familyId = value["family"];
	const family = typeof familyId === "string" ? families.get(familyId) : undefined;
	if (family === undefined) issues.push(issue("unknown-family", id, label(familyId)));
	else {
		used.add(family.id);
		if (family.stage !== stage) issues.push(issue("stage-mismatch", id, family.id));
	}
	if (typeof value["enabled"] !== "boolean") issues.push(issue("invalid-boolean", id, "enabled"));
	const kind = value["kind"];
	if (!isOneOf(FAKE_ALERT_KINDS, kind)) issues.push(issue("invalid-kind", id, label(kind)));
	if (!isPositiveSafeInteger(value["weight"])) issues.push(issue("invalid-weight", id, String(value["weight"])));
	const buttons = value["buttons"];
	if (stage === "prompt") {
		if (buttons === undefined) issues.push(issue("missing-buttons", id));
		else if (!isOneOf(FAKE_ALERT_BUTTON_SET_IDS, buttons)) issues.push(issue("invalid-buttons", id, label(buttons)));
	} else if (buttons !== undefined) issues.push(issue("unexpected-buttons", id));
	const rawLines = value["lines"];
	const lines: ResolvedFakeAlertPart[][] = [];
	if (!Array.isArray(rawLines) || rawLines.length === 0) issues.push(issue("missing-line", id));
	else if (rawLines.length > FAKE_ALERT_LIMITS.lines) issues.push(issue("line-limit", id));
	else {
		for (const raw of rawLines as readonly unknown[]) {
			const line = compileLine(raw, id, stage, issues);
			if (line !== null) lines.push(line);
		}
	}
	if (issues.length !== before) return null;
	return {
		id, family: (family as ResolvedFakeAlertFamily).id, enabled: value["enabled"] as boolean, kind: kind as FakeAlertKind,
		weight: value["weight"] as number,
		buttons: stage === "prompt" ? (buttons as FakeAlertButtonSet) : FAKE_ALERT_CLOSING_BUTTON_SET,
		lines,
	};
}

function rolesOf(buttons: FakeAlertButtonSet): FakeAlertRole[] {
	return FAKE_ALERT_ROLES.filter((role) => FAKE_ALERT_BUTTON_SETS[buttons].some((button) => FAKE_ALERT_BUTTON_ROLES[button] === role));
}

/**
 * Policy §7.1: the paths the standard data must always leave open.
 *
 * A Vocabulary always has a noun, or no Alert is made, but it may lack any
 * other kind of word: sahen nouns, verbs, イ-adjectives, ナ-adjective stems.
 *
 * 1. A drift-0 prompt family has an enabled Prompt that needs none of those
 *    kinds.
 * 2. Every enabled Prompt of a drift-0 family has, for each role its buttons
 *    carry, an enabled Outcome in a drift-0 family that answers that role, uses
 *    no shared slot the Prompt lacks, and needs one of those kinds only if the
 *    Prompt does (a Prompt that could be drawn proves that kind of word
 *    exists). With 1, any Vocabulary that has a noun can generate at level 0.
 * 3. For each role, a drift-0 family has an enabled Outcome that answers it and
 *    needs neither, so above level 0 every button of every Prompt keeps a
 *    candidate whatever the Vocabulary lacks.
 */
function checkCoverage(set: FakeAlertRecipeSet, issues: FakeAlertRecipeIssue[]): void {
	const drift = new Map(set.families.map((family) => [family.id, family]));
	const plain = (recipe: FakeAlertRecipe) => recipe.enabled && drift.get(recipe.family)!.drift === 0;
	const answers = (recipe: FakeAlertRecipe, role: FakeAlertRole) => {
		const on = drift.get(recipe.family)!.on;
		return on === role || on === "any";
	};
	const prompts = set.prompts.filter(plain);
	const outcomes = set.outcomes.filter(plain);
	const needs = Object.values(FAKE_ALERT_NEEDS);
	const nounsOnly = (recipe: FakeAlertRecipe) => needs.every((need) => !recipe[need]);
	if (!prompts.some(nounsOnly)) issues.push(issue("no-level-zero-prompt", "prompt"));
	for (const prompt of prompts) {
		for (const role of rolesOf(prompt.buttons)) {
			const fits = outcomes.some((outcome) => answers(outcome, role) &&
				outcome.sharedSlots.every((slot) => prompt.sharedSlots.includes(slot)) &&
				needs.every((need) => prompt[need] || !outcome[need]));
			if (!fits) issues.push(issue("no-level-zero-outcome", prompt.id, role));
		}
	}
	for (const role of FAKE_ALERT_ROLES) {
		if (!outcomes.some((outcome) => answers(outcome, role) && nounsOnly(outcome))) issues.push(issue("no-noun-only-outcome", role));
	}
}

/**
 * Compiles untrusted document data. Every problem found is reported, in entry
 * order; a set is returned only when there is none.
 */
export function compileFakeAlertRecipeSet(input: CompileFakeAlertRecipeSetInput): FakeAlertRecipeCompileResult {
	const issues: FakeAlertRecipeIssue[] = [];
	const source: unknown = input;
	if (!isRecord(source)) return { ok: false, issues: [issue("invalid-structure", "document")] };
	checkFields(source, INPUT_KEYS, "document", issues);
	if (source["schemaVersion"] !== FAKE_ALERT_RECIPE_SCHEMA_VERSION) {
		issues.push(issue("unsupported-schema-version", "document", String(source["schemaVersion"])));
	}
	if (!isPositiveSafeInteger(source["dataVersion"])) issues.push(issue("invalid-data-version", "document", String(source["dataVersion"])));
	for (const key of ["families", "prompts", "terminals", "outcomes"] as const) {
		const list = source[key];
		if (!Array.isArray(list)) issues.push(issue("invalid-structure", key));
		else if (list.length > FAKE_ALERT_LIMITS[key]) issues.push(issue("entry-limit", key));
	}
	if (issues.length > 0) return { ok: false, issues };

	const seen = new Set<string>();
	const families = new Map<string, ResolvedFakeAlertFamily>();
	for (const value of source["families"] as readonly unknown[]) {
		const family = compileFamily(value, seen, issues);
		if (family !== null) families.set(family.id, family);
	}
	const used = new Set<string>();
	const recipes: ResolvedFakeAlertRecipe[] = [];
	const texts = new Map<string, string>();
	for (const [key, stage] of RECIPE_LISTS) {
		for (const value of source[key] as readonly unknown[]) {
			const recipe = compileRecipe(value, stage, seen, families, used, issues);
			if (recipe === null) continue;
			// The same Alert twice would only double its weight without saying so.
			const text = JSON.stringify([stage, recipe.kind, recipe.buttons, recipe.lines]);
			const first = texts.get(text);
			if (first !== undefined) issues.push(issue("duplicate-recipe", recipe.id, first));
			else texts.set(text, recipe.id);
			recipes.push(recipe);
		}
	}
	for (const family of families.values()) {
		if (!used.has(family.id)) issues.push(issue("unused-family", family.id));
	}
	if (issues.length > 0) return { ok: false, issues };

	const set = buildFakeAlertRecipeSet({
		schemaVersion: source["schemaVersion"] as number,
		dataVersion: source["dataVersion"] as number,
		families: [...families.values()],
		recipes,
	});
	checkCoverage(set, issues);
	return issues.length > 0 ? { ok: false, issues } : { ok: true, set };
}
