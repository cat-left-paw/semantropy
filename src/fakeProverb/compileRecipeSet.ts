/**
 * Compiles a Fake Proverb recipe document (Recipe Schema 1) into a frozen
 * typed set.
 *
 * The Markdown parser is not enough: this is the product validator later
 * slices will share. The build-time generator loads this module (never the
 * generated entries), so there is no path that turns a parsed document into
 * generated data without passing here.
 *
 * A proverb is an ordered list of slots and fixed literals; a slot may be
 * `export`ed. A gloss first declares the typed `requires` it needs from a
 * proverb, then an ordered list of references, gloss-local slots and fixed
 * literals. Sharing between the two is explicit typed reference only: a gloss
 * reference names a required (kind, slot) pair or an earlier gloss-local slot,
 * never a surface, and nothing flows from a gloss back into a proverb.
 */

import {
	FAKE_PROVERB_CANDIDATE_FORMS,
	FAKE_PROVERB_ID_MAX_LENGTH,
	FAKE_PROVERB_LIMITS,
	FAKE_PROVERB_LITERAL_MAX_CODE_POINTS,
	FAKE_PROVERB_RECIPE_SCHEMA_VERSION,
	FAKE_PROVERB_SLOT_ID_MAX_LENGTH,
	FAKE_PROVERB_SLOT_KINDS,
	type FakeProverbCandidateForm,
	type FakeProverbRecipeRole,
	type FakeProverbSlotKind,
	type RawFakeProverbGloss,
	type RawFakeProverbLiteral,
	type RawFakeProverbProfile,
	type RawFakeProverbRecipe,
} from "./recipeData";

// The build-time parser loads these with the compiler; no duplicate semantic rules.
export {
	FAKE_PROVERB_LITERAL_MAX_CODE_POINTS,
	FAKE_PROVERB_RECIPE_SCHEMA_VERSION,
} from "./recipeData";

/** A typed (kind, slot) pair: an export signature entry or a requirement. */
export type FakeProverbSlotSignature = {
	readonly kind: FakeProverbSlotKind;
	readonly slotId: string;
};

export type CompiledFakeProverbSlotPart = {
	readonly kind: FakeProverbSlotKind;
	readonly slotId: string;
	readonly profileId: string;
	/** Always false in a gloss: a gloss never re-exports. */
	readonly exported: boolean;
};

export type CompiledFakeProverbLiteralPart = {
	readonly kind: "literal";
	readonly literalId: string;
};

export type CompiledFakeProverbReferencePart = {
	readonly kind: "reference";
	readonly slotKind: FakeProverbSlotKind;
	readonly slotId: string;
	/** `requirement`: a proverb export named by `requires`; `local`: an earlier gloss-local slot. */
	readonly source: "requirement" | "local";
};

export type CompiledFakeProverbPart =
	| CompiledFakeProverbSlotPart
	| CompiledFakeProverbLiteralPart
	| CompiledFakeProverbReferencePart;

export type CompiledFakeProverbRecipe = {
	readonly id: string;
	readonly enabled: boolean;
	readonly weight: number;
	readonly parts: readonly (CompiledFakeProverbSlotPart | CompiledFakeProverbLiteralPart)[];
	/** The typed export signature, in part order. */
	readonly exports: readonly FakeProverbSlotSignature[];
};

export type CompiledFakeProverbGloss = {
	readonly id: string;
	readonly enabled: boolean;
	readonly weight: number;
	/** The typed requirement signature, in document order. */
	readonly requires: readonly FakeProverbSlotSignature[];
	readonly parts: readonly CompiledFakeProverbPart[];
};

export type CompiledFakeProverbLiteral = {
	readonly id: string;
	readonly literal: string;
};

export type CompiledFakeProverbProfile = {
	readonly id: string;
	readonly kind: FakeProverbSlotKind;
	readonly forms: readonly { readonly form: FakeProverbCandidateForm; readonly weight: number }[];
};

export type CompiledFakeProverbRecipeSet = {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly proverbs: readonly CompiledFakeProverbRecipe[];
	readonly glosses: readonly CompiledFakeProverbGloss[];
	readonly literals: readonly CompiledFakeProverbLiteral[];
	readonly profiles: readonly CompiledFakeProverbProfile[];
};

export type FakeProverbRecipeIssueCode =
	| "unsupported-schema-version"
	| "invalid-data-version"
	| "invalid-structure"
	| "unknown-field"
	| "entry-limit"
	| "invalid-id"
	| "duplicate-id"
	| "invalid-weight"
	| "invalid-boolean"
	| "invalid-literal"
	| "duplicate-literal"
	| "unused-literal"
	| "dangling-literal"
	| "invalid-profile-kind"
	| "missing-form"
	| "invalid-form"
	| "duplicate-form"
	| "unknown-profile"
	| "unused-profile"
	| "unknown-part-kind"
	| "invalid-slot-id"
	| "duplicate-slot-id"
	| "shadowed-slot-id"
	| "duplicate-export"
	| "duplicate-require"
	| "type-mismatch"
	| "unknown-reference"
	| "unexported-reference"
	| "forward-reference"
	| "cyclic-reference"
	| "proverb-reference"
	| "gloss-export"
	| "unused-require"
	| "missing-noun"
	| "missing-export"
	| "missing-require"
	| "part-limit"
	| "kind-limit"
	| "export-limit"
	| "require-limit"
	| "reference-limit"
	| "missing-proverb"
	| "missing-gloss"
	| "unpaired-proverb"
	| "unpaired-gloss";

export type FakeProverbRecipeIssue = {
	readonly code: FakeProverbRecipeIssueCode;
	readonly id: string;
	readonly detail?: string;
};

export type FakeProverbRecipeCompileResult =
	| { readonly ok: true; readonly set: CompiledFakeProverbRecipeSet }
	| { readonly ok: false; readonly issues: readonly FakeProverbRecipeIssue[] };

export type CompileFakeProverbRecipeSetInput = {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly proverbs: readonly RawFakeProverbRecipe[];
	readonly glosses: readonly RawFakeProverbGloss[];
	readonly literals: readonly RawFakeProverbLiteral[];
	readonly profiles: readonly RawFakeProverbProfile[];
};

/** Lowercase kebab-case; used for entry IDs and recipe-local slot IDs alike. */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SLOT_KINDS: ReadonlySet<string> = new Set(FAKE_PROVERB_SLOT_KINDS);
/** Cc / Cf / Cs / Zl / Zp: controls, format, surrogates, line and paragraph separators. */
const DISALLOWED_CATEGORY = /\p{Cc}|\p{Cf}|\p{Cs}|\p{Zl}|\p{Zp}/u;
/**
 * Hiragana, Katakana, Han, the prolonged-sound mark and the ideographic comma
 * and full stop. ASCII — and with it every Markdown delimiter, `/re/`,
 * `()=>…`, `${…}` and `{{…}}` — is outside this grammar.
 */
const ALLOWED_LITERAL = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー、。]+$/u;

function issue(
	code: FakeProverbRecipeIssueCode,
	id: string,
	detail?: string,
): FakeProverbRecipeIssue {
	return detail === undefined ? { code, id } : { code, id, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
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

function isEntryId(value: unknown): value is string {
	return typeof value === "string" && value.length <= FAKE_PROVERB_ID_MAX_LENGTH && ID_PATTERN.test(value);
}

function isSlotId(value: unknown): value is string {
	return typeof value === "string" && value.length <= FAKE_PROVERB_SLOT_ID_MAX_LENGTH && ID_PATTERN.test(value);
}

function isSlotKind(value: unknown): value is FakeProverbSlotKind {
	return typeof value === "string" && SLOT_KINDS.has(value);
}

function label(value: unknown): string {
	return typeof value === "string" ? value : "?";
}

/**
 * A fixed literal must be a finished Japanese surface: NFC, the closed script
 * grammar, no control / format / surrogate / separator code points, and short
 * enough that a later composer can concatenate it blindly.
 */
export function inspectFakeProverbLiteral(value: unknown): "invalid-literal" | null {
	if (typeof value !== "string" || value === "") return "invalid-literal";
	if (value !== value.trim() || value !== value.normalize("NFC")) return "invalid-literal";
	if (hasIsolatedSurrogate(value) || DISALLOWED_CATEGORY.test(value) || !ALLOWED_LITERAL.test(value)) {
		return "invalid-literal";
	}
	return [...value].length > FAKE_PROVERB_LITERAL_MAX_CODE_POINTS ? "invalid-literal" : null;
}

/**
 * True when a proverb's typed exports satisfy every requirement of a gloss:
 * the same slot ID with the same kind, never a surface that happens to match.
 * The compiler uses this for its pairing check and a later composer must use
 * the same function, so "compatible" has one definition.
 */
export function isFakeProverbGlossCompatible(
	proverb: { readonly exports: readonly FakeProverbSlotSignature[] },
	gloss: { readonly requires: readonly FakeProverbSlotSignature[] },
): boolean {
	return gloss.requires.every((required) =>
		proverb.exports.some((entry) => entry.kind === required.kind && entry.slotId === required.slotId),
	);
}

/** Renders one issue as a single line for a build or test failure. */
export function describeFakeProverbRecipeIssue(entry: FakeProverbRecipeIssue): string {
	return entry.detail === undefined
		? `${entry.code} (${entry.id})`
		: `${entry.code} (${entry.id}: ${entry.detail})`;
}

type Context = {
	readonly issues: FakeProverbRecipeIssue[];
	readonly literals: ReadonlySet<string>;
	readonly profiles: ReadonlyMap<string, FakeProverbSlotKind>;
	readonly usedLiterals: Set<string>;
	readonly usedProfiles: Set<string>;
};

function checkFields(
	value: Record<string, unknown>,
	allowed: readonly string[],
	id: string,
	issues: FakeProverbRecipeIssue[],
): void {
	for (const field of Object.keys(value)) {
		if (!allowed.includes(field)) issues.push(issue("unknown-field", id, field));
	}
}

function checkWeight(id: string, weight: unknown, issues: FakeProverbRecipeIssue[]): void {
	if (!isPositiveSafeInteger(weight)) issues.push(issue("invalid-weight", id, String(weight)));
}

function checkEntryId(id: unknown, seen: Set<string>, issues: FakeProverbRecipeIssue[]): void {
	if (!isEntryId(id)) {
		issues.push(issue("invalid-id", label(id)));
		return;
	}
	if (seen.has(id)) issues.push(issue("duplicate-id", id));
	seen.add(id);
}

function asArray(value: unknown, id: string, issues: FakeProverbRecipeIssue[]): readonly unknown[] {
	if (Array.isArray(value)) return value;
	issues.push(issue("invalid-structure", id));
	return [];
}

/** A slot part in either role. Returns null when the part could not be read. */
function compileSlotPart(
	part: Record<string, unknown>,
	role: FakeProverbRecipeRole,
	recipeId: string,
	context: Context,
): CompiledFakeProverbSlotPart | null {
	const { issues } = context;
	checkFields(part, ["kind", "slotId", "profileId", "exported"], recipeId, issues);
	const kind = part["kind"] as FakeProverbSlotKind;
	const slotId = part["slotId"];
	if (!isSlotId(slotId)) {
		issues.push(issue("invalid-slot-id", recipeId, label(slotId)));
		return null;
	}
	if (typeof part["exported"] !== "boolean") issues.push(issue("invalid-boolean", recipeId, slotId));
	if (role === "gloss" && part["exported"] === true) issues.push(issue("gloss-export", recipeId, slotId));
	const profileId = part["profileId"];
	if (typeof profileId !== "string" || !context.profiles.has(profileId)) {
		issues.push(issue("unknown-profile", recipeId, `${slotId}: ${label(profileId)}`));
	} else {
		context.usedProfiles.add(profileId);
		if (context.profiles.get(profileId) !== kind) {
			issues.push(issue("type-mismatch", recipeId, `${slotId}: ${kind} slot, ${String(context.profiles.get(profileId))} profile`));
		}
	}
	return Object.freeze({
		kind,
		slotId,
		profileId: typeof profileId === "string" ? profileId : "",
		exported: part["exported"] === true,
	});
}

function compileLiteralPart(
	part: Record<string, unknown>,
	recipeId: string,
	context: Context,
): CompiledFakeProverbLiteralPart {
	checkFields(part, ["kind", "literalId"], recipeId, context.issues);
	const literalId = part["literalId"];
	if (typeof literalId !== "string" || !context.literals.has(literalId)) {
		context.issues.push(issue("dangling-literal", recipeId, label(literalId)));
	} else {
		context.usedLiterals.add(literalId);
	}
	return Object.freeze({ kind: "literal", literalId: typeof literalId === "string" ? literalId : "" });
}

function checkPartCounts(
	role: FakeProverbRecipeRole,
	recipeId: string,
	partCount: number,
	slotCounts: Readonly<Record<FakeProverbSlotKind, number>>,
	issues: FakeProverbRecipeIssue[],
): void {
	if (partCount === 0 || partCount > FAKE_PROVERB_LIMITS.parts[role]) issues.push(issue("part-limit", recipeId, String(partCount)));
	for (const kind of FAKE_PROVERB_SLOT_KINDS) {
		if (slotCounts[kind] > FAKE_PROVERB_LIMITS.slots[role][kind]) issues.push(issue("kind-limit", recipeId, kind));
	}
}

function compileProverb(
	raw: unknown,
	context: Context,
): CompiledFakeProverbRecipe | null {
	const { issues } = context;
	if (!isRecord(raw)) {
		issues.push(issue("invalid-structure", "proverb"));
		return null;
	}
	const id = label(raw["id"]);
	checkFields(raw, ["id", "enabled", "weight", "parts"], id, issues);
	if (typeof raw["enabled"] !== "boolean") issues.push(issue("invalid-boolean", id, "enabled"));
	checkWeight(id, raw["weight"], issues);
	const rawParts = asArray(raw["parts"], id, issues);
	const ownSlots = new Set<unknown>(rawParts.map((part) => (isRecord(part) && isSlotKind(part["kind"]) ? part["slotId"] : undefined)));
	const slotIds = new Set<string>();
	const exportedIds = new Set<string>();
	const exports: FakeProverbSlotSignature[] = [];
	const slotCounts = { noun: 0, modifier: 0, predicate: 0 };
	const parts: (CompiledFakeProverbSlotPart | CompiledFakeProverbLiteralPart)[] = [];
	for (const [index, part] of rawParts.entries()) {
		if (!isRecord(part)) {
			issues.push(issue("invalid-structure", id, `part ${index + 1}`));
			continue;
		}
		const kind = part["kind"];
		if (kind === "literal") {
			parts.push(compileLiteralPart(part, id, context));
			continue;
		}
		if (kind === "reference") {
			// A proverb resolves before its gloss. A reference to one of this
			// proverb's own slots is outside the closed model (`reference` is
			// gloss-only); anything else could only be satisfied by the gloss
			// that itself depends on this proverb, which is a cycle.
			const slotId = part["slotId"];
			if (typeof slotId === "string" && ownSlots.has(slotId)) issues.push(issue("proverb-reference", id, slotId));
			else issues.push(issue("cyclic-reference", id, label(slotId)));
			continue;
		}
		if (!isSlotKind(kind)) {
			issues.push(issue("unknown-part-kind", id, label(kind)));
			continue;
		}
		const compiled = compileSlotPart(part, "proverb", id, context);
		if (compiled === null) continue;
		slotCounts[kind] += 1;
		if (slotIds.has(compiled.slotId)) issues.push(issue("duplicate-slot-id", id, compiled.slotId));
		slotIds.add(compiled.slotId);
		if (compiled.exported) {
			if (exportedIds.has(compiled.slotId)) issues.push(issue("duplicate-export", id, compiled.slotId));
			exportedIds.add(compiled.slotId);
			exports.push(Object.freeze({ kind: compiled.kind, slotId: compiled.slotId }));
		}
		parts.push(compiled);
	}
	checkPartCounts("proverb", id, rawParts.length, slotCounts, issues);
	if (slotCounts.noun === 0) issues.push(issue("missing-noun", id));
	if (exports.length === 0) issues.push(issue("missing-export", id));
	if (exports.length > FAKE_PROVERB_LIMITS.exports) issues.push(issue("export-limit", id, String(exports.length)));
	return Object.freeze({
		id,
		enabled: raw["enabled"] === true,
		weight: raw["weight"] as number,
		parts: Object.freeze(parts),
		exports: Object.freeze(exports),
	});
}

type ProverbSlotIndex = {
	/** Every exported slot ID, with each kind some proverb exports it as. */
	readonly exportKinds: ReadonlyMap<string, ReadonlySet<FakeProverbSlotKind>>;
	/** Every slot ID any proverb declares, exported or not. */
	readonly declared: ReadonlySet<string>;
};

function indexProverbSlots(proverbs: readonly CompiledFakeProverbRecipe[]): ProverbSlotIndex {
	const exportKinds = new Map<string, Set<FakeProverbSlotKind>>();
	const declared = new Set<string>();
	for (const proverb of proverbs) {
		for (const part of proverb.parts) {
			if (part.kind !== "literal") declared.add(part.slotId);
		}
		for (const entry of proverb.exports) {
			const kinds = exportKinds.get(entry.slotId) ?? new Set<FakeProverbSlotKind>();
			kinds.add(entry.kind);
			exportKinds.set(entry.slotId, kinds);
		}
	}
	return { exportKinds, declared };
}

function compileGloss(
	raw: unknown,
	context: Context,
	proverbSlots: ProverbSlotIndex,
): CompiledFakeProverbGloss | null {
	const { issues } = context;
	if (!isRecord(raw)) {
		issues.push(issue("invalid-structure", "gloss"));
		return null;
	}
	const id = label(raw["id"]);
	checkFields(raw, ["id", "enabled", "weight", "requires", "parts"], id, issues);
	if (typeof raw["enabled"] !== "boolean") issues.push(issue("invalid-boolean", id, "enabled"));
	checkWeight(id, raw["weight"], issues);

	const requires: FakeProverbSlotSignature[] = [];
	const required = new Map<string, FakeProverbSlotKind>();
	const rawRequires = asArray(raw["requires"], id, issues);
	for (const [index, entry] of rawRequires.entries()) {
		if (!isRecord(entry)) {
			issues.push(issue("invalid-structure", id, `requires ${index + 1}`));
			continue;
		}
		checkFields(entry, ["kind", "slotId"], id, issues);
		const { kind, slotId } = entry;
		if (!isSlotKind(kind)) {
			issues.push(issue("unknown-part-kind", id, `requires ${label(kind)}`));
			continue;
		}
		if (!isSlotId(slotId)) {
			issues.push(issue("invalid-slot-id", id, label(slotId)));
			continue;
		}
		if (required.has(slotId)) {
			issues.push(issue("duplicate-require", id, slotId));
			continue;
		}
		// Name the precise reason a requirement cannot bind: the proverbs export
		// the ID only as another kind, declare it without exporting it, or do
		// not declare it at all.
		const exportedAs = proverbSlots.exportKinds.get(slotId);
		if (exportedAs === undefined) {
			issues.push(issue(proverbSlots.declared.has(slotId) ? "unexported-reference" : "unknown-reference", id, `${kind} ${slotId}`));
		} else if (!exportedAs.has(kind)) {
			issues.push(issue("type-mismatch", id, `requires ${kind} ${slotId}, exported as ${[...exportedAs].join(",")}`));
		}
		required.set(slotId, kind);
		requires.push(Object.freeze({ kind, slotId }));
	}
	if (rawRequires.length === 0) issues.push(issue("missing-require", id));
	if (rawRequires.length > FAKE_PROVERB_LIMITS.requires) issues.push(issue("require-limit", id, String(rawRequires.length)));

	const rawParts = asArray(raw["parts"], id, issues);
	// Local slot IDs are collected first so a reference to a later one is named
	// a forward reference rather than an unknown one.
	const laterLocals = new Map<string, unknown>();
	for (const part of rawParts) {
		if (isRecord(part) && isSlotKind(part["kind"]) && typeof part["slotId"] === "string") laterLocals.set(part["slotId"], part["kind"]);
	}
	const locals = new Map<string, FakeProverbSlotKind>();
	const referenced = new Set<string>();
	const slotCounts = { noun: 0, modifier: 0, predicate: 0 };
	let references = 0;
	const parts: CompiledFakeProverbPart[] = [];
	for (const [index, part] of rawParts.entries()) {
		if (!isRecord(part)) {
			issues.push(issue("invalid-structure", id, `part ${index + 1}`));
			continue;
		}
		const kind = part["kind"];
		if (kind === "literal") {
			parts.push(compileLiteralPart(part, id, context));
			continue;
		}
		if (kind === "reference") {
			references += 1;
			checkFields(part, ["kind", "slotKind", "slotId"], id, issues);
			const { slotKind, slotId } = part;
			if (!isSlotKind(slotKind)) {
				issues.push(issue("unknown-part-kind", id, `reference ${label(slotKind)}`));
				continue;
			}
			if (!isSlotId(slotId)) {
				issues.push(issue("invalid-slot-id", id, label(slotId)));
				continue;
			}
			const source = required.has(slotId) ? "requirement" : locals.has(slotId) ? "local" : null;
			if (source === null) {
				issues.push(issue(laterLocals.has(slotId) ? "forward-reference" : "unknown-reference", id, `${slotKind} ${slotId}`));
				continue;
			}
			const declaredKind = source === "requirement" ? required.get(slotId) : locals.get(slotId);
			if (declaredKind !== slotKind) {
				issues.push(issue("type-mismatch", id, `reference ${slotKind} ${slotId}, declared ${String(declaredKind)}`));
			}
			referenced.add(slotId);
			parts.push(Object.freeze({ kind: "reference", slotKind, slotId, source }));
			continue;
		}
		if (!isSlotKind(kind)) {
			issues.push(issue("unknown-part-kind", id, label(kind)));
			continue;
		}
		const compiled = compileSlotPart(part, "gloss", id, context);
		if (compiled === null) continue;
		slotCounts[kind] += 1;
		if (locals.has(compiled.slotId) || required.has(compiled.slotId)) {
			issues.push(issue("duplicate-slot-id", id, compiled.slotId));
		} else if (proverbSlots.declared.has(compiled.slotId)) {
			// A gloss-local slot is a separate binding; it may not wear the name
			// of a proverb slot it cannot see or overwrite.
			issues.push(issue("shadowed-slot-id", id, compiled.slotId));
		}
		locals.set(compiled.slotId, kind);
		parts.push(compiled);
	}
	for (const [slotId] of required) {
		if (!referenced.has(slotId)) issues.push(issue("unused-require", id, slotId));
	}
	checkPartCounts("gloss", id, rawParts.length, slotCounts, issues);
	if (references > FAKE_PROVERB_LIMITS.references) issues.push(issue("reference-limit", id, String(references)));
	return Object.freeze({
		id,
		enabled: raw["enabled"] === true,
		weight: raw["weight"] as number,
		requires: Object.freeze(requires),
		parts: Object.freeze(parts),
	});
}

function compileLiterals(
	rawLiterals: readonly unknown[],
	seenIds: Set<string>,
	issues: FakeProverbRecipeIssue[],
): CompiledFakeProverbLiteral[] {
	const surfaces = new Set<string>();
	const literals: CompiledFakeProverbLiteral[] = [];
	for (const raw of rawLiterals) {
		if (!isRecord(raw)) {
			issues.push(issue("invalid-structure", "literal"));
			continue;
		}
		const id = label(raw["id"]);
		checkFields(raw, ["id", "literal"], id, issues);
		checkEntryId(raw["id"], seenIds, issues);
		const literal = raw["literal"];
		if (inspectFakeProverbLiteral(literal) !== null) {
			issues.push(issue("invalid-literal", id));
			continue;
		}
		if (surfaces.has(literal as string)) issues.push(issue("duplicate-literal", id));
		surfaces.add(literal as string);
		literals.push(Object.freeze({ id, literal: literal as string }));
	}
	return literals;
}

function compileProfiles(
	rawProfiles: readonly unknown[],
	seenIds: Set<string>,
	issues: FakeProverbRecipeIssue[],
): CompiledFakeProverbProfile[] {
	const profiles: CompiledFakeProverbProfile[] = [];
	for (const raw of rawProfiles) {
		if (!isRecord(raw)) {
			issues.push(issue("invalid-structure", "profile"));
			continue;
		}
		const id = label(raw["id"]);
		checkFields(raw, ["id", "kind", "forms"], id, issues);
		checkEntryId(raw["id"], seenIds, issues);
		const kind = raw["kind"];
		const rawForms = asArray(raw["forms"], id, issues);
		if (!isSlotKind(kind)) {
			issues.push(issue("invalid-profile-kind", id, label(kind)));
			continue;
		}
		const allowed: readonly string[] = FAKE_PROVERB_CANDIDATE_FORMS[kind];
		const seenForms = new Set<string>();
		const forms: { readonly form: FakeProverbCandidateForm; readonly weight: number }[] = [];
		for (const entry of rawForms) {
			if (!isRecord(entry)) {
				issues.push(issue("invalid-structure", id, "form"));
				continue;
			}
			checkFields(entry, ["form", "weight"], id, issues);
			const { form, weight } = entry;
			checkWeight(id, weight, issues);
			if (typeof form !== "string" || !allowed.includes(form)) {
				issues.push(issue("invalid-form", id, `${kind} ${label(form)}`));
				continue;
			}
			if (seenForms.has(form)) issues.push(issue("duplicate-form", id, form));
			seenForms.add(form);
			forms.push(Object.freeze({ form: form as FakeProverbCandidateForm, weight: weight as number }));
		}
		if (rawForms.length === 0) issues.push(issue("missing-form", id));
		profiles.push(Object.freeze({ id, kind, forms: Object.freeze(forms) }));
	}
	return profiles;
}

/**
 * Compiles and validates a whole Fake Proverb recipe set.
 *
 * Returns every issue found rather than stopping at the first, so one build
 * failure reports all the broken entries. Document order is the canonical
 * order of every compiled array, and the result is deeply frozen fresh data
 * that never aliases the caller's input. Nothing is published unless every
 * check passes.
 */
export function compileFakeProverbRecipeSet(
	input: CompileFakeProverbRecipeSetInput,
): FakeProverbRecipeCompileResult {
	const issues: FakeProverbRecipeIssue[] = [];
	if (!isRecord(input)) {
		return { ok: false, issues: Object.freeze([issue("invalid-structure", "recipe-set")]) };
	}
	if (input.schemaVersion !== FAKE_PROVERB_RECIPE_SCHEMA_VERSION) {
		issues.push(issue("unsupported-schema-version", "schema-version", String(input.schemaVersion)));
	}
	if (!isPositiveSafeInteger(input.dataVersion)) {
		issues.push(issue("invalid-data-version", "data-version", String(input.dataVersion)));
	}
	checkFields(input, ["schemaVersion", "dataVersion", "proverbs", "glosses", "literals", "profiles"], "recipe-set", issues);
	const rawProverbs = asArray(input.proverbs, "proverbs", issues);
	const rawGlosses = asArray(input.glosses, "glosses", issues);
	const rawLiterals = asArray(input.literals, "literals", issues);
	const rawProfiles = asArray(input.profiles, "profiles", issues);
	for (const [name, list] of [["proverbs", rawProverbs], ["glosses", rawGlosses], ["literals", rawLiterals], ["profiles", rawProfiles]] as const) {
		if (list.length > FAKE_PROVERB_LIMITS[name]) issues.push(issue("entry-limit", name, String(list.length)));
	}

	const seenIds = new Set<string>();
	const literals = compileLiterals(rawLiterals, seenIds, issues);
	const profiles = compileProfiles(rawProfiles, seenIds, issues);
	const context: Context = {
		issues,
		literals: new Set(literals.map((entry) => entry.id)),
		profiles: new Map(profiles.map((entry) => [entry.id, entry.kind])),
		usedLiterals: new Set(),
		usedProfiles: new Set(),
	};

	const proverbs: CompiledFakeProverbRecipe[] = [];
	for (const raw of rawProverbs) {
		if (isRecord(raw)) checkEntryId(raw["id"], seenIds, issues);
		const compiled = compileProverb(raw, context);
		if (compiled !== null) proverbs.push(compiled);
	}
	const proverbSlots = indexProverbSlots(proverbs);
	const glosses: CompiledFakeProverbGloss[] = [];
	for (const raw of rawGlosses) {
		if (isRecord(raw)) checkEntryId(raw["id"], seenIds, issues);
		const compiled = compileGloss(raw, context, proverbSlots);
		if (compiled !== null) glosses.push(compiled);
	}

	for (const entry of literals) {
		if (!context.usedLiterals.has(entry.id)) issues.push(issue("unused-literal", entry.id));
	}
	for (const entry of profiles) {
		if (!context.usedProfiles.has(entry.id)) issues.push(issue("unused-profile", entry.id));
	}

	// Pairing is decided by signature alone: every enabled gloss must be
	// satisfiable by some enabled proverb, and every enabled proverb must have
	// some enabled gloss. Disabled entries are validated but never paired.
	const enabledProverbs = proverbs.filter((entry) => entry.enabled);
	const enabledGlosses = glosses.filter((entry) => entry.enabled);
	if (enabledProverbs.length === 0) issues.push(issue("missing-proverb", "proverb"));
	if (enabledGlosses.length === 0) issues.push(issue("missing-gloss", "gloss"));
	for (const gloss of enabledGlosses) {
		if (!enabledProverbs.some((proverb) => isFakeProverbGlossCompatible(proverb, gloss))) {
			issues.push(issue("unpaired-gloss", gloss.id));
		}
	}
	for (const proverb of enabledProverbs) {
		if (!enabledGlosses.some((gloss) => isFakeProverbGlossCompatible(proverb, gloss))) {
			issues.push(issue("unpaired-proverb", proverb.id));
		}
	}

	if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
	return {
		ok: true,
		set: Object.freeze({
			schemaVersion: input.schemaVersion,
			dataVersion: input.dataVersion,
			proverbs: Object.freeze(proverbs),
			glosses: Object.freeze(glosses),
			literals: Object.freeze(literals),
			profiles: Object.freeze(profiles),
		}),
	};
}
