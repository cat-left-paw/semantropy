/**
 * The typed Fake Alert recipe set, and the two ways one is made.
 *
 * `buildFakeAlertRecipeSet()` turns already-resolved families and recipes into
 * the frozen set a generator reads. The compiler (`./compileRecipeSet`) calls
 * it after validating a document, and `unpackFakeAlertRecipeSet()` calls it
 * after restoring the generated module's compact form, so both arrive at the
 * same value through the same code: there is one definition of a recipe's
 * slots and of what Vocabulary it needs.
 *
 * The compact form exists for size (`Docs/fake_alert_policy1.md` §4.5): each
 * line is split into fixed text and slots at build time, and equal fixed text
 * is stored once. Unpacking is a restore, not a validation; the document was
 * validated when the generated module was written, and every build re-derives
 * that module and refuses a stale one. It still fails loudly on a value it
 * cannot place, rather than hand a generator a half-built recipe.
 *
 * This module is a pure leaf over the schema: no DOM, no Obsidian, no
 * tokenizer, and never the compiler or the generated entries.
 */

import {
	FAKE_ALERT_BUTTON_SET_IDS,
	FAKE_ALERT_CLOSING_BUTTON_SET,
	FAKE_ALERT_KINDS,
	FAKE_ALERT_ON,
	FAKE_ALERT_SLOT_TOKEN,
	FAKE_ALERT_STAGES,
	type FakeAlertButtonSet,
	type FakeAlertKind,
	type FakeAlertOn,
	type FakeAlertSlotKind,
	type FakeAlertStage,
} from "./recipeData";

/** One slot occurrence. `token` is its name inside one Alert: `n1`, `+s2`, … */
export type FakeAlertSlot = {
	readonly token: string;
	readonly kind: FakeAlertSlotKind;
	readonly index: number;
	/** True for `{+n1}`: local to an Outcome and always a new draw. */
	readonly local: boolean;
};

/** A line is fixed text and slots, in output order. A string is fixed text. */
export type FakeAlertSegment = string | FakeAlertSlot;

export type FakeAlertRecipe = {
	readonly id: string;
	readonly family: string;
	readonly stage: FakeAlertStage;
	readonly enabled: boolean;
	readonly kind: FakeAlertKind;
	readonly weight: number;
	/** A prompt's own set; always the closing set for a terminal or an outcome. */
	readonly buttons: FakeAlertButtonSet;
	readonly lines: readonly (readonly FakeAlertSegment[])[];
	/** Distinct shared slot tokens (`n1`, `s1`, …), in first-use order. */
	readonly sharedSlots: readonly string[];
	/** Distinct Outcome-local slot tokens (`+n1`, …), in first-use order. */
	readonly localSlots: readonly string[];
	/** True when any slot, shared or local, is a sahen noun. */
	readonly needsSahen: boolean;
	/** True when any slot, shared or local, is a verb. */
	readonly needsVerb: boolean;
	/** True when any slot, shared or local, is an イ-adjective. */
	readonly needsAdjective: boolean;
	/** True when any slot, shared or local, is a ナ-adjective stem. */
	readonly needsNa: boolean;
};

/**
 * The recipe flag for each kind of word a Vocabulary may lack: every slot kind
 * but the plain noun, without which no Alert is made at all.
 */
export const FAKE_ALERT_NEEDS = Object.freeze({
	s: "needsSahen", v: "needsVerb", i: "needsAdjective", na: "needsNa",
} as const satisfies Readonly<Record<Exclude<FakeAlertSlotKind, "n">, string>>);
export type FakeAlertNeed = (typeof FAKE_ALERT_NEEDS)[keyof typeof FAKE_ALERT_NEEDS];

export type FakeAlertFamily = {
	readonly id: string;
	readonly stage: FakeAlertStage;
	readonly weight: number;
	readonly drift: number;
	/** The button role an outcome family answers; `null` for a prompt or terminal family. */
	readonly on: FakeAlertOn | null;
	/** This family's recipes, in document order, enabled or not. */
	readonly recipes: readonly FakeAlertRecipe[];
};

export type FakeAlertRecipeSet = {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly families: readonly FakeAlertFamily[];
	readonly prompts: readonly FakeAlertRecipe[];
	readonly terminals: readonly FakeAlertRecipe[];
	readonly outcomes: readonly FakeAlertRecipe[];
};

/** One part of a resolved line: fixed text, or a slot token as written between braces. */
export type ResolvedFakeAlertPart = { readonly literal: string } | { readonly slot: string };

export type ResolvedFakeAlertFamily = {
	readonly id: string;
	readonly stage: FakeAlertStage;
	readonly weight: number;
	readonly drift: number;
	readonly on: FakeAlertOn | null;
};

export type ResolvedFakeAlertRecipe = {
	readonly id: string;
	readonly family: string;
	readonly enabled: boolean;
	readonly kind: FakeAlertKind;
	readonly weight: number;
	readonly buttons: FakeAlertButtonSet;
	readonly lines: readonly (readonly ResolvedFakeAlertPart[])[];
};

/**
 * Every set the builder made. The compiler and the restore both build through
 * it, so a hand-made object of the same shape is not a recipe set: a generator
 * can refuse it instead of trusting its shape.
 */
const SETS = new WeakSet<object>();

/** True only for a set `buildFakeAlertRecipeSet()` made (through the compiler or the restore). */
export function isFakeAlertRecipeSet(value: unknown): value is FakeAlertRecipeSet {
	return typeof value === "object" && value !== null && SETS.has(value);
}

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const inner of Object.values(value)) deepFreeze(inner);
	}
	return value;
}

function fail(reason: string): never {
	throw new Error(`Fake Alert recipe set: ${reason}`);
}

/** The slot a token names, or `null` when it is not a slot token. */
export function parseFakeAlertSlotToken(token: string): FakeAlertSlot | null {
	const match = FAKE_ALERT_SLOT_TOKEN.exec(token);
	if (!match) return null;
	return { token, kind: match[2] as FakeAlertSlotKind, index: Number(match[3]), local: match[1] === "+" };
}

function buildRecipe(recipe: ResolvedFakeAlertRecipe, stage: FakeAlertStage): FakeAlertRecipe {
	const sharedSlots: string[] = [];
	const localSlots: string[] = [];
	const needs: Record<FakeAlertNeed, boolean> = { needsSahen: false, needsVerb: false, needsAdjective: false, needsNa: false };
	const lines = recipe.lines.map((line) => line.map((part): FakeAlertSegment => {
		if ("literal" in part) return part.literal;
		const slot = parseFakeAlertSlotToken(part.slot) ?? fail(`"${recipe.id}" has an unknown slot`);
		const seen = slot.local ? localSlots : sharedSlots;
		if (!seen.includes(slot.token)) seen.push(slot.token);
		if (slot.kind !== "n") needs[FAKE_ALERT_NEEDS[slot.kind]] = true;
		return slot;
	}));
	return {
		id: recipe.id, family: recipe.family, stage, enabled: recipe.enabled, kind: recipe.kind, weight: recipe.weight,
		buttons: recipe.buttons, lines, sharedSlots, localSlots, ...needs,
	};
}

/**
 * Builds the frozen set from resolved data. Families and recipes keep the
 * order they are given; a recipe's stage is its family's.
 */
export function buildFakeAlertRecipeSet(input: {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly families: readonly ResolvedFakeAlertFamily[];
	readonly recipes: readonly ResolvedFakeAlertRecipe[];
}): FakeAlertRecipeSet {
	const stageOf = new Map(input.families.map((family) => [family.id, family.stage]));
	const recipes = input.recipes.map((recipe) =>
		buildRecipe(recipe, stageOf.get(recipe.family) ?? fail(`"${recipe.id}" names an unknown family`)));
	const families = input.families.map((family): FakeAlertFamily => ({
		id: family.id, stage: family.stage, weight: family.weight, drift: family.drift, on: family.on,
		recipes: recipes.filter((recipe) => recipe.family === family.id),
	}));
	const ofStage = (stage: FakeAlertStage) => recipes.filter((recipe) => recipe.stage === stage);
	const set: FakeAlertRecipeSet = deepFreeze({
		schemaVersion: input.schemaVersion,
		dataVersion: input.dataVersion,
		families,
		prompts: ofStage("prompt"),
		terminals: ofStage("terminal"),
		outcomes: ofStage("outcome"),
	});
	SETS.add(set);
	return set;
}

/**
 * The generated module's compact form.
 *
 * `families`: `[id, stage, weight, drift, on]`, where `stage` indexes
 * `FAKE_ALERT_STAGES` and `on` indexes `FAKE_ALERT_ON` (-1 for none).
 * `recipes`: `[id, family, enabled, kind, weight, buttons, lines]`, where
 * `family` indexes `families`, `enabled` is 1 or 0, `kind` indexes
 * `FAKE_ALERT_KINDS` and `buttons` indexes `FAKE_ALERT_BUTTON_SET_IDS`. In a
 * line, a number indexes `literals` and a string is a slot token.
 */
export type PackedFakeAlertFamily = readonly [id: string, stage: number, weight: number, drift: number, on: number];
export type PackedFakeAlertRecipe = readonly [
	id: string, family: number, enabled: number, kind: number, weight: number, buttons: number,
	lines: readonly (readonly (number | string)[])[],
];
export type PackedFakeAlertRecipeSet = {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly literals: readonly string[];
	readonly families: readonly PackedFakeAlertFamily[];
	readonly recipes: readonly PackedFakeAlertRecipe[];
};

function at<T>(list: readonly T[], index: number, what: string): T {
	const value = Number.isInteger(index) ? list[index] : undefined;
	return value === undefined ? fail(`the packed data has no such ${what}`) : value;
}

/** Restores the set the compiler produced from the document the packed data was generated from. */
export function unpackFakeAlertRecipeSet(packed: PackedFakeAlertRecipeSet): FakeAlertRecipeSet {
	const families = packed.families.map(([id, stage, weight, drift, on]): ResolvedFakeAlertFamily => ({
		id, stage: at(FAKE_ALERT_STAGES, stage, "stage"), weight, drift,
		on: on === -1 ? null : at(FAKE_ALERT_ON, on, "button role"),
	}));
	const recipes = packed.recipes.map(([id, family, enabled, kind, weight, buttons, lines]): ResolvedFakeAlertRecipe => ({
		id,
		family: at(families, family, "family").id,
		enabled: enabled === 1,
		kind: at(FAKE_ALERT_KINDS, kind, "kind"),
		weight,
		buttons: at(FAKE_ALERT_BUTTON_SET_IDS, buttons, "button set"),
		lines: lines.map((line) => line.map((part): ResolvedFakeAlertPart =>
			typeof part === "number" ? { literal: at(packed.literals, part, "fixed text") } : { slot: part })),
	}));
	for (const recipe of recipes) {
		const stage = families.find((family) => family.id === recipe.family)?.stage;
		if (stage !== "prompt" && recipe.buttons !== FAKE_ALERT_CLOSING_BUTTON_SET) fail(`"${recipe.id}" is not a prompt but has its own buttons`);
	}
	return buildFakeAlertRecipeSet({ schemaVersion: packed.schemaVersion, dataVersion: packed.dataVersion, families, recipes });
}
