/**
 * Compiles a Collision pattern document into a frozen typed set.
 *
 * The Markdown parser is not enough: this is the product validator later
 * slices will share. The generator loads this module (never the generated
 * entries) so there is no path that turns a parsed document into bundled data
 * without passing here.
 */

import {
	COLLISION_CONNECTOR_FORMS,
	COLLISION_LITERAL_MAX_CODE_POINTS,
	COLLISION_LABEL_MAX_CODE_POINTS,
	COLLISION_PART_KINDS,
	COLLISION_PART_LIMITS,
	COLLISION_RECIPE_MAX_PARTS,
	COLLISION_MODIFIER_CANDIDATE_PROFILES,
	COLLISION_PREDICATE_CANDIDATE_PROFILES,
	COLLISION_MODIFIER_FORMS,
	COLLISION_PATTERN_SCHEMA_VERSION,
	type CollisionModifierCandidateProfile,
	type CollisionPredicateCandidateProfile,
	type RawCollisionConnector,
	type RawCollisionModifierForm,
	type RawCollisionLiteral,
	type RawCollisionPresence,
	type RawCollisionNounSuffix,
	type RawCollisionRecipe,
} from "./patternData";

// The build-time parser loads these with the compiler; no duplicate semantic rules.
export { COLLISION_PATTERN_SCHEMA_VERSION, COLLISION_LITERAL_MAX_CODE_POINTS } from "./patternData";

export type CompiledCollisionPart =
	| { readonly kind: "noun" | "connector"; readonly slotId: string; readonly optional: false }
	| { readonly kind: "modifier"; readonly slotId: string; readonly optional: boolean; readonly profile: CollisionModifierCandidateProfile }
	| { readonly kind: "predicate"; readonly slotId: string; readonly optional: false; readonly profile: CollisionPredicateCandidateProfile }
	| { readonly kind: "literal"; readonly slotId: string; readonly optional: false; readonly literalId: string };

export type CompiledCollisionRecipe = {
	readonly id: string;
	readonly label: string;
	readonly enabled: boolean;
	readonly selectable: boolean;
	readonly weight: number;
	readonly parts: readonly CompiledCollisionPart[];
	readonly presence: readonly RawCollisionPresence[];
};

export type CompiledCollisionConnector = {
	readonly id: string;
	readonly form: (typeof COLLISION_CONNECTOR_FORMS)[number];
	readonly weight: number;
	readonly literal: string | null;
};

export type CompiledCollisionModifierForm = {
	readonly id: string;
	readonly class: (typeof COLLISION_MODIFIER_FORMS)[number]["class"];
	readonly variant: (typeof COLLISION_MODIFIER_FORMS)[number]["variant"];
	readonly weight: number;
};

export type CompiledCollisionNounSuffix = {
	readonly id: string;
	readonly weight: number;
	readonly literal: string;
};

export type CompiledCollisionPatternSet = {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly recipes: readonly CompiledCollisionRecipe[];
	readonly literals: readonly RawCollisionLiteral[];
	readonly connectors: readonly CompiledCollisionConnector[];
	readonly modifierForms: readonly CompiledCollisionModifierForm[];
	readonly nounSuffixes: readonly CompiledCollisionNounSuffix[];
};

export type CollisionPatternIssueCode =
	| "unsupported-schema-version"
	| "invalid-data-version"
	| "invalid-id"
	| "duplicate-id"
	| "invalid-weight"
	| "unknown-field"
	| "invalid-label"
	| "duplicate-selectable-label"
	| "invalid-boolean"
	| "disabled-selectable-recipe"
	| "missing-recipe"
	| "invalid-part-kind"
	| "invalid-slot-id"
	| "duplicate-slot-id"
	| "invalid-optional"
	| "invalid-candidate-profile"
	| "dangling-literal-reference"
	| "missing-required-noun"
	| "part-limit"
	| "kind-limit"
	| "missing-presence"
	| "unexpected-presence"
	| "invalid-presence"
	| "duplicate-presence"
	| "unknown-presence-slot"
	| "required-presence-slot"
	| "invalid-connector-form"
	| "missing-empty-connector"
	| "unexpected-connector-literal"
	| "missing-connector-literal"
	| "duplicate-literal"
	| "invalid-literal"
	| "invalid-class"
	| "invalid-variant"
	| "duplicate-modifier-form"
	| "missing-modifier-form"
	| "missing-noun-suffix";

export type CollisionPatternIssue = {
	readonly code: CollisionPatternIssueCode;
	readonly id: string;
	readonly detail?: string;
};

export type CollisionPatternCompileResult =
	| { readonly ok: true; readonly set: CompiledCollisionPatternSet }
	| { readonly ok: false; readonly issues: readonly CollisionPatternIssue[] };

/** Ids we mint and persist. Lowercase kebab-case. */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const PART_KINDS: ReadonlySet<string> = new Set(COLLISION_PART_KINDS);
const MODIFIER_PROFILES: ReadonlySet<string> = new Set(COLLISION_MODIFIER_CANDIDATE_PROFILES);
const PREDICATE_PROFILES: ReadonlySet<string> = new Set(COLLISION_PREDICATE_CANDIDATE_PROFILES);
const CONNECTOR_FORMS: ReadonlySet<string> = new Set(COLLISION_CONNECTOR_FORMS);
const FORM_KEYS: ReadonlySet<string> = new Set(
	COLLISION_MODIFIER_FORMS.map((entry) => formKey(entry.class, entry.variant)),
);

const UNSAFE_LITERAL = /\{\{|\}\}|\$\{|`|<%|%>/;
/** Cc / Cf / Cs / Zl / Zp: controls, format, surrogates, line and paragraph separators. */
const DISALLOWED_CATEGORY = /\p{Cc}|\p{Cf}|\p{Cs}|\p{Zl}|\p{Zp}/u;
/**
 * Hiragana, Katakana, Han, and the prolonged-sound mark. ASCII, `/foo/`,
 * `()=>…` and other JavaScript or regexp notation are outside this grammar.
 */
const ALLOWED_LITERAL = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]+$/u;

function hasIsolatedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) {
				return true;
			}
			index += 1;
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

export type CompileCollisionPatternSetInput = {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly recipes: readonly RawCollisionRecipe[];
	readonly literals: readonly RawCollisionLiteral[];
	readonly connectors: readonly RawCollisionConnector[];
	readonly modifierForms: readonly RawCollisionModifierForm[];
	readonly nounSuffixes: readonly RawCollisionNounSuffix[];
};

function formKey(modifierClass: string, variant: string): string {
	return `${modifierClass}\0${variant}`;
}

function issue(
	code: CollisionPatternIssueCode,
	id: string,
	detail?: string,
): CollisionPatternIssue {
	return detail === undefined ? { code, id } : { code, id, detail };
}

function isPositiveSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 1 && String(value) === String(Math.trunc(value));
}

/**
 * A Connector or noun-suffix surface must be a finished Japanese literal:
 * NFC, the closed script grammar, no control / format / surrogate / separator
 * code points, no placeholder or code punctuation, and short enough that a
 * later composer can concatenate it blindly.
 */
export function inspectCollisionLiteral(value: string): CollisionPatternIssueCode | null {
	if (typeof value !== "string" || value === "") {
		return "invalid-literal";
	}
	if (value !== value.trim() || value !== value.normalize("NFC")) {
		return "invalid-literal";
	}
	if (
		hasIsolatedSurrogate(value) ||
		DISALLOWED_CATEGORY.test(value) ||
		UNSAFE_LITERAL.test(value) ||
		!ALLOWED_LITERAL.test(value)
	) {
		return "invalid-literal";
	}
	if ([...value].length > COLLISION_LITERAL_MAX_CODE_POINTS) {
		return "invalid-literal";
	}
	return null;
}

export function inspectCollisionLabel(value: string): CollisionPatternIssueCode | null {
	return typeof value !== "string" || value === "" || value !== value.trim() ||
		value !== value.normalize("NFC") || DISALLOWED_CATEGORY.test(value) ||
		[...value].length > COLLISION_LABEL_MAX_CODE_POINTS ? "invalid-label" : null;
}

function checkFields(value: object, allowed: readonly string[], id: string, issues: CollisionPatternIssue[]): void {
	for (const field of Object.keys(value)) {
		if (!allowed.includes(field)) issues.push(issue("unknown-field", id, field));
	}
}

function compileRecipe(
	raw: RawCollisionRecipe,
	literalIds: ReadonlySet<string>,
	issues: CollisionPatternIssue[],
): CompiledCollisionRecipe {
	checkFields(raw, ["id", "label", "enabled", "selectable", "weight", "parts", "presence"], raw.id, issues);
	if (inspectCollisionLabel(raw.label)) issues.push(issue("invalid-label", raw.id));
	if (typeof raw.enabled !== "boolean" || typeof raw.selectable !== "boolean") {
		issues.push(issue("invalid-boolean", raw.id));
	}
	if (raw.enabled === false && raw.selectable === true) issues.push(issue("disabled-selectable-recipe", raw.id));
	if (raw.parts.length === 0 || raw.parts.length > COLLISION_RECIPE_MAX_PARTS) issues.push(issue("part-limit", raw.id));
	const slots = new Set<string>();
	const optionalSlots = new Set<string>();
	const counts = { noun: 0, modifier: 0, connector: 0, predicate: 0 };
	let requiredNouns = 0;
	const parts: CompiledCollisionPart[] = [];
	for (const part of raw.parts) {
		const allowed = ["kind", "slotId", "optional"];
		if (part.kind === "modifier" || part.kind === "predicate") allowed.push("profile");
		if (part.kind === "literal") allowed.push("literalId");
		checkFields(part, allowed, raw.id, issues);
		if (typeof part.slotId !== "string" || part.slotId !== part.slotId.trim() || !ID_PATTERN.test(part.slotId) || part.slotId === "none") issues.push(issue("invalid-slot-id", raw.id));
		if (slots.has(part.slotId)) issues.push(issue("duplicate-slot-id", raw.id, part.slotId));
		slots.add(part.slotId);
		if (!PART_KINDS.has(part.kind)) {
			issues.push(issue("invalid-part-kind", raw.id));
			continue;
		}
		if (typeof part.optional !== "boolean" || (part.optional && part.kind !== "modifier")) {
			issues.push(issue("invalid-optional", raw.id, part.slotId));
		}
		if (part.kind === "modifier" && part.optional === true) optionalSlots.add(part.slotId);
		if (part.kind !== "literal") counts[part.kind as keyof typeof counts] += 1;
		if (part.kind === "noun" && part.optional === false) requiredNouns += 1;
		if (part.kind === "modifier" || part.kind === "predicate") {
			const profiles = part.kind === "modifier" ? MODIFIER_PROFILES : PREDICATE_PROFILES;
			if (part.profile === undefined || !profiles.has(part.profile)) issues.push(issue("invalid-candidate-profile", raw.id, part.slotId));
		}
		if (part.kind === "literal" && (part.literalId === undefined || !literalIds.has(part.literalId))) {
			issues.push(issue("dangling-literal-reference", raw.id, part.slotId));
		}
		// Only published if every check succeeds. Copy before freeze; never own caller objects.
		parts.push(Object.freeze({ ...part }) as CompiledCollisionPart);
	}
	for (const kind of Object.keys(counts) as (keyof typeof counts)[]) {
		if (counts[kind] > COLLISION_PART_LIMITS[kind]) issues.push(issue("kind-limit", raw.id, kind));
	}
	if (requiredNouns === 0) issues.push(issue("missing-required-noun", raw.id));
	if (optionalSlots.size > 0 && raw.presence.length === 0) issues.push(issue("missing-presence", raw.id));
	if (optionalSlots.size === 0 && raw.presence.length > 0) issues.push(issue("unexpected-presence", raw.id));
	const seenPresence = new Set<string>();
	const presence = raw.presence.map((entry) => {
		checkFields(entry, ["slots", "weight"], raw.id, issues);
		checkWeight(raw.id, entry.weight, issues);
		const active = new Set(entry.slots);
		if (active.size !== entry.slots.length) issues.push(issue("invalid-presence", raw.id));
		for (const slot of active) {
			if (!slots.has(slot)) issues.push(issue("unknown-presence-slot", raw.id));
			else if (!optionalSlots.has(slot)) issues.push(issue("required-presence-slot", raw.id));
		}
		// A presence is a set: canonicalize it in part order, retaining presence entry order.
		const ordered = [...optionalSlots].filter((slot) => active.has(slot));
		const key = JSON.stringify(ordered);
		if (seenPresence.has(key)) issues.push(issue("duplicate-presence", raw.id));
		seenPresence.add(key);
		return Object.freeze({ slots: Object.freeze(ordered), weight: entry.weight });
	});
	return Object.freeze({
		id: raw.id, label: raw.label, enabled: raw.enabled, selectable: raw.selectable, weight: raw.weight,
		parts: Object.freeze(parts), presence: Object.freeze(presence),
	});
}

function checkId(
	id: string,
	seenIds: Set<string>,
	issues: CollisionPatternIssue[],
): boolean {
	if (typeof id !== "string" || id !== id.trim() || !ID_PATTERN.test(id)) {
		issues.push(issue("invalid-id", id));
		return false;
	}
	if (seenIds.has(id)) {
		issues.push(issue("duplicate-id", id));
		return false;
	}
	seenIds.add(id);
	return true;
}

function checkWeight(id: string, weight: number, issues: CollisionPatternIssue[]): boolean {
	if (!isPositiveSafeInteger(weight)) {
		issues.push(issue("invalid-weight", id, String(weight)));
		return false;
	}
	return true;
}

/** Renders one issue as a single line for a build or test failure. */
export function describeCollisionPatternIssue(entry: CollisionPatternIssue): string {
	return entry.detail === undefined
		? `${entry.code} (${entry.id})`
		: `${entry.code} (${entry.id}: ${entry.detail})`;
}

/**
 * Compiles and validates a whole Collision pattern set.
 *
 * Returns every issue found rather than stopping at the first, so one build
 * failure reports all the broken entries. Document order is the canonical
 * order of the compiled arrays.
 */
export function compileCollisionPatternSet(
	input: CompileCollisionPatternSetInput,
): CollisionPatternCompileResult {
	const issues: CollisionPatternIssue[] = [];

	if (input.schemaVersion !== COLLISION_PATTERN_SCHEMA_VERSION) {
		issues.push(
			issue("unsupported-schema-version", "schema-version", String(input.schemaVersion)),
		);
	}
	if (!isPositiveSafeInteger(input.dataVersion)) {
		issues.push(issue("invalid-data-version", "data-version", String(input.dataVersion)));
	}

	checkFields(input, ["schemaVersion", "dataVersion", "recipes", "literals", "connectors", "modifierForms", "nounSuffixes"], "pattern-set", issues);
	const seenIds = new Set<string>();
	const literalIds = new Set<string>();
	const literalSurfaces = new Set<string>();
	const literals: RawCollisionLiteral[] = [];
	for (const raw of input.literals) {
		checkFields(raw, ["id", "literal"], raw.id, issues);
		checkId(raw.id, seenIds, issues);
		if (inspectCollisionLiteral(raw.literal)) issues.push(issue("invalid-literal", raw.id));
		if (literalSurfaces.has(raw.literal)) issues.push(issue("duplicate-literal", raw.id));
		literalIds.add(raw.id);
		literalSurfaces.add(raw.literal);
		literals.push(Object.freeze({ id: raw.id, literal: raw.literal }));
	}
	const recipes: CompiledCollisionRecipe[] = [];
	const selectableLabels = new Set<string>();
	for (const raw of input.recipes) {
		checkId(raw.id, seenIds, issues);
		checkWeight(raw.id, raw.weight, issues);
		recipes.push(compileRecipe(raw, literalIds, issues));
		if (raw.selectable === true && typeof raw.label === "string") {
			const label = raw.label.normalize("NFC");
			if (selectableLabels.has(label)) issues.push(issue("duplicate-selectable-label", raw.id));
			selectableLabels.add(label);
		}
	}
	if (recipes.length === 0) issues.push(issue("missing-recipe", "recipe"));

	const connectors: CompiledCollisionConnector[] = [];
	const connectorLiterals = new Set<string>();
	let emptyConnectors = 0;

	for (const raw of input.connectors) {
		checkFields(raw, ["id","form","weight","literal"], raw.id, issues);
		const usable = checkId(raw.id, seenIds, issues);
		checkWeight(raw.id, raw.weight, issues);
		if (!CONNECTOR_FORMS.has(raw.form)) {
			issues.push(issue("invalid-connector-form", raw.id, raw.form));
			continue;
		}
		if (raw.form === "empty") {
			if (raw.literal !== null) {
				issues.push(issue("unexpected-connector-literal", raw.id));
				continue;
			}
			if (connectorLiterals.has("")) {
				issues.push(issue("duplicate-literal", raw.id));
				continue;
			}
			connectorLiterals.add("");
			emptyConnectors += 1;
			if (!usable) {
				continue;
			}
			connectors.push(
				Object.freeze({
					id: raw.id,
					form: "empty",
					weight: raw.weight,
					literal: null,
				}),
			);
			continue;
		}
		if (raw.literal === null) {
			issues.push(issue("missing-connector-literal", raw.id));
			continue;
		}
		const literalIssue = inspectCollisionLiteral(raw.literal);
		if (literalIssue !== null) {
			issues.push(issue(literalIssue, raw.id));
			continue;
		}
		if (connectorLiterals.has(raw.literal)) {
			issues.push(issue("duplicate-literal", raw.id));
			continue;
		}
		connectorLiterals.add(raw.literal);
		if (!usable) {
			continue;
		}
		connectors.push(
			Object.freeze({
				id: raw.id,
				form: "literal",
				weight: raw.weight,
				literal: raw.literal,
			}),
		);
	}

	if (emptyConnectors === 0) {
		issues.push(issue("missing-empty-connector", "empty"));
	}

	const modifierForms: CompiledCollisionModifierForm[] = [];
	const seenForms = new Set<string>();

	for (const raw of input.modifierForms) {
		checkFields(raw, ["id","class","variant","weight"], raw.id, issues);
		const usable = checkId(raw.id, seenIds, issues);
		checkWeight(raw.id, raw.weight, issues);
		const key = formKey(raw.class, raw.variant);
		const knownClass = COLLISION_MODIFIER_FORMS.some((entry) => entry.class === raw.class);
		if (!knownClass) {
			issues.push(issue("invalid-class", raw.id, raw.class));
			continue;
		}
		if (!FORM_KEYS.has(key)) {
			issues.push(issue("invalid-variant", raw.id, raw.variant));
			continue;
		}
		if (seenForms.has(key)) {
			issues.push(issue("duplicate-modifier-form", raw.id, `${raw.class}/${raw.variant}`));
			continue;
		}
		seenForms.add(key);
		if (!usable) {
			continue;
		}
		modifierForms.push(
			Object.freeze({
				id: raw.id,
				class: raw.class as CompiledCollisionModifierForm["class"],
				variant: raw.variant as CompiledCollisionModifierForm["variant"],
				weight: raw.weight,
			}),
		);
	}

	for (const required of COLLISION_MODIFIER_FORMS) {
		if (!seenForms.has(formKey(required.class, required.variant))) {
			issues.push(issue("missing-modifier-form", `${required.class}/${required.variant}`));
		}
	}

	const nounSuffixes: CompiledCollisionNounSuffix[] = [];
	const suffixLiterals = new Set<string>();

	for (const raw of input.nounSuffixes) {
		checkFields(raw, ["id","weight","literal"], raw.id, issues);
		const usable = checkId(raw.id, seenIds, issues);
		checkWeight(raw.id, raw.weight, issues);
		const literalIssue = inspectCollisionLiteral(raw.literal);
		if (literalIssue !== null) {
			issues.push(issue(literalIssue, raw.id));
			continue;
		}
		if (suffixLiterals.has(raw.literal)) {
			issues.push(issue("duplicate-literal", raw.id));
			continue;
		}
		suffixLiterals.add(raw.literal);
		if (!usable) {
			continue;
		}
		nounSuffixes.push(
			Object.freeze({
				id: raw.id,
				weight: raw.weight,
				literal: raw.literal,
			}),
		);
	}

	if (nounSuffixes.length === 0) {
		issues.push(issue("missing-noun-suffix", "noun-suffix"));
	}

	if (issues.length > 0) {
		return { ok: false, issues: Object.freeze(issues) };
	}

	return {
		ok: true,
		set: Object.freeze({
			schemaVersion: input.schemaVersion,
			dataVersion: input.dataVersion,
			recipes: Object.freeze(recipes),
			literals: Object.freeze(literals),
			connectors: Object.freeze(connectors),
			modifierForms: Object.freeze(modifierForms),
			nounSuffixes: Object.freeze(nounSuffixes),
		}),
	};
}
