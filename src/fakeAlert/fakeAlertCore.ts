/**
 * FAKE-ALERT-CORE1: the pure Fake Alert generator (`Docs/fake_alert_policy1.md`
 * §5 and §6).
 *
 * One call makes one finished Alert from the View's active Vocabulary owner,
 * the Text Semantropy level and a private nonce. A dialog Alert is a Prompt and
 * an Outcome for each of its buttons, all drawn before anything is shown, so a
 * Modal never has to generate (or fail) while it is open. A terminal Alert is
 * one page closed by OK.
 *
 * The draw has two stages: a family first (its weight times the level table),
 * then a recipe inside it (its weight), so adding recipes never changes how
 * often a family appears. A 0 in the level table forbids a category; nothing
 * here relaxes it. When the rules leave no candidate, the call is refused with
 * a fixed reason instead — and the compiler (policy §7.1) is what keeps the
 * standard data from ever needing that.
 *
 * FAKE-ALERT-VARIETY1 (owner decision, policy §5 addendum): while the
 * Vocabulary has fewer than `FAKE_ALERT_SAHEN_FULL_POOL` sahen nouns, a recipe
 * that needs one counts at the square of that share of its weight, so a handful of sahen
 * nouns no longer fills a third of every page. Words the caller says were shown
 * recently are drawn at a fifth of their weight. Neither rule forbids anything,
 * and with enough sahen nouns and no recent words the draw is exactly as before.
 *
 * The words come only from the owner's own Snapshot: its Collision projection
 * already separates nouns and sahen nouns, and its Manual candidates give the
 * regular verbs and イ-adjectives, in their basic form, through the closed
 * realizer MAX and Fake Proverb use (FAKE-ALERT-VERB1, FAKE-ALERT-ADJ1), and
 * the ナ-adjective stems as the dictionary marks them. Since LEXEME-SHARE1 those
 * three lists come from `src/vocabulary/lexicalProjection.ts`. Nothing here reads a Source,
 * tokenizes, inflects or touches the DOM, and no pool can be passed in. A
 * result is deeply frozen and recorded, so a later Modal can refuse anything
 * this module did not make. The nonce is not a Seed: it reaches no result, log
 * or setting, and nothing promises the same Alert again.
 */

import type { VocabularyOrigin } from "../analysis/rubyVocabulary";
import { createSeededRandom, UINT32_MAX, type SeededRandom } from "../random/seededRandom";
import { isManualMorphVocabulary, type ManualMorphVocabulary } from "../transform/manualMorphology";
import { iAdjectiveBasicForms, naAdjectiveStems, regularVerbBasicForms } from "../vocabulary/lexicalProjection";
import { drawWeight, sourceWeightLookup, type SourceWeightLookup } from "../vocabulary/sourceWeights";
import type { VocabularyDrawMode } from "../vocabulary/vocabularySnapshot";
import {
	FAKE_ALERT_DRIFT_CURVES,
	FAKE_ALERT_INHERIT_PERCENT,
	FAKE_ALERT_LEVEL_SCALE,
	FAKE_ALERT_MATCH_EIGHTHS,
	FAKE_ALERT_ROLE_MISMATCH,
	FAKE_ALERT_SLOT_MISFIT,
	fakeAlertLevelValue,
	isFakeAlertLevel,
} from "./fakeAlertLevel";
import { FAKE_ALERT_ALGORITHM_VERSION } from "./fakeAlertVersions";
import { STANDARD_FAKE_ALERT_PACKED_RECIPES } from "./generated/standardFakeAlertRecipes";
import {
	FAKE_ALERT_BUTTON_ROLES,
	FAKE_ALERT_BUTTON_SETS,
	FAKE_ALERT_SLOT_KINDS,
	type FakeAlertButton,
	type FakeAlertKind,
	type FakeAlertRole,
	type FakeAlertSlotKind,
} from "./recipeData";
import {
	FAKE_ALERT_NEEDS,
	isFakeAlertRecipeSet,
	parseFakeAlertSlotToken,
	unpackFakeAlertRecipeSet,
	type FakeAlertFamily,
	type FakeAlertRecipe,
	type FakeAlertRecipeSet,
} from "./recipeSet";

export { FAKE_ALERT_ALGORITHM_VERSION } from "./fakeAlertVersions";

/** How many recent recipe IDs a caller may ask the draw to avoid. */
export const FAKE_ALERT_RECENT_MAX = 16;
/** How many recently shown words a caller may ask the draw to make rarer. */
export const FAKE_ALERT_RECENT_WORDS_MAX = 48;
/** A recently shown word keeps 1 / this of its weight when a new word is drawn. */
export const FAKE_ALERT_RECENT_WORD_DIVISOR = 5;
/**
 * With fewer sahen nouns than this, a recipe that needs one counts at
 * (sahen nouns / this)² of its weight, so a Vocabulary with a handful of them
 * does not show those few on a third of all pages. Squared, because the other
 * recipes are renormalized around it: a linear share only brought 6 sahen nouns
 * from about 32% of the words to 22%, while the square brings each of them close
 * to how often one word of a full pool appears. At this many or more, nothing changes.
 */
export const FAKE_ALERT_SAHEN_FULL_POOL = 20;
/** The same rule for a recipe that needs a verb while the Vocabulary has fewer verbs than this. */
export const FAKE_ALERT_VERB_FULL_POOL = 20;
/** The same rule for a recipe that needs an イ-adjective. */
export const FAKE_ALERT_ADJECTIVE_FULL_POOL = 20;
/** The same rule for a recipe that needs a ナ-adjective stem. */
export const FAKE_ALERT_NA_FULL_POOL = 20;

/** One drawn word and the slot it fills, in the order the page first uses it. */
export type FakeAlertWord = {
	readonly token: string;
	readonly surface: string;
};

/** One page of an Alert: finished text, the kind it shows and the buttons it offers, left to right. */
export type FakeAlertPage = {
	readonly recipeId: string;
	readonly family: string;
	readonly kind: FakeAlertKind;
	readonly buttons: readonly FakeAlertButton[];
	readonly lines: readonly string[];
	readonly words: readonly FakeAlertWord[];
};

export type FakeAlertProvenance = {
	readonly vocabularyFingerprint: string;
	readonly drawMode: VocabularyDrawMode;
	readonly sources: readonly { readonly path: string; readonly contentHash: string; readonly projectionPolicy: string }[];
};

/**
 * A finished Alert. `dialog`: `prompt` is answered by one of its buttons and
 * `outcomes` holds the page each button leads to. `terminal`: `prompt` is the
 * only page and `outcomes` is empty.
 */
export type FakeAlert = {
	readonly algorithmVersion: typeof FAKE_ALERT_ALGORITHM_VERSION;
	readonly recipeDataVersion: number;
	readonly level: number;
	readonly shape: "dialog" | "terminal";
	readonly prompt: FakeAlertPage;
	readonly outcomes: Readonly<Partial<Record<FakeAlertButton, FakeAlertPage>>>;
	/** Captured for a later Collect; nothing in this version writes it anywhere. */
	readonly provenance: FakeAlertProvenance;
};

/**
 * Fixed reasons, never carrying a path, a note's text, a word or an exception.
 * `invalid-vocabulary`: not a minted, live Vocabulary owner. `insufficient-vocabulary`:
 * the Vocabulary has no noun Fake Alert can show. `no-candidate`: the level's
 * rules leave no recipe for the opening page or for a button.
 */
export type FakeAlertRefusal = "invalid-request" | "invalid-vocabulary" | "invalid-recipes" | "insufficient-vocabulary" | "no-candidate";

export type FakeAlertGeneration =
	| { readonly ok: true; readonly alert: FakeAlert }
	| { readonly ok: false; readonly reason: FakeAlertRefusal };

export type GenerateFakeAlertInput = {
	readonly owner: ManualMorphVocabulary;
	/** Text Semantropy: an integer from 0 to 100. */
	readonly level: number;
	/** A fresh private uint32 for this one Alert. */
	readonly nonce: number;
	/** Recipe IDs shown recently; avoided when the family has another recipe. */
	readonly recent?: readonly string[];
	/** Words shown recently; a newly drawn word is one of them less often. A word a page keeps from the Prompt is not drawn. */
	readonly recentWords?: readonly string[];
	/** Tests only: a set the compiler made. Production uses the standard recipes. */
	readonly recipes?: FakeAlertRecipeSet;
};

const INPUT_KEYS = ["owner", "level", "nonce", "recent", "recentWords", "recipes"];
/** FNV-1a of this domain separates Fake Alert's stream from any other use of the same nonce. */
const DRAW_DOMAIN = "semantropy/fake-alert/algorithm-1";
/** Controls, format, unassigned and surrogate code points, separators and whitespace: never shown. */
const UNSHOWABLE = /[\p{C}\p{Z}\s]/u;

const ALERTS = new WeakSet<object>();

/** True only for an Alert `generateFakeAlert()` made. A same-shaped object made elsewhere is not one. */
export function isFakeAlert(value: unknown): value is FakeAlert {
	return typeof value === "object" && value !== null && ALERTS.has(value);
}

let standard: FakeAlertRecipeSet | null = null;

/** The standard recipes, restored once from the generated module. */
export function standardFakeAlertRecipes(): FakeAlertRecipeSet {
	standard ??= unpackFakeAlertRecipeSet(STANDARD_FAKE_ALERT_PACKED_RECIPES);
	return standard;
}

// --- Vocabulary ---------------------------------------------------------------

type Word = { readonly surface: string; readonly weight: number };

/**
 * Slot kinds as bits, for the pools a surface is in. The pools overlap: every
 * sahen noun and every ナ-adjective stem is also a noun, and the basic form of
 * a verb or an イ-adjective can be a noun's surface too.
 */
const KIND_BIT: Readonly<Record<FakeAlertSlotKind, number>> = { n: 1, s: 2, v: 4, i: 8, na: 16 };
/** Every nonempty group of slot kinds is a number from 1 to this. */
const ALL_KINDS = 31;

/**
 * The kinds of word a Vocabulary may lack, each with the recipe flag that says
 * a recipe needs it and the pool size from which such a recipe counts in full.
 */
const SCARCE = [
	["s", FAKE_ALERT_NEEDS.s, FAKE_ALERT_SAHEN_FULL_POOL],
	["v", FAKE_ALERT_NEEDS.v, FAKE_ALERT_VERB_FULL_POOL],
	["i", FAKE_ALERT_NEEDS.i, FAKE_ALERT_ADJECTIVE_FULL_POOL],
	["na", FAKE_ALERT_NEEDS.na, FAKE_ALERT_NA_FULL_POOL],
] as const;

type Pools = {
	/** The words each kind of slot draws from, in canonical order. */
	readonly words: Readonly<Record<FakeAlertSlotKind, readonly Word[]>>;
	/** The pools each surface is in, as bits of `KIND_BIT`. */
	readonly kinds: ReadonlyMap<string, number>;
	/** `room[group]`: how many surfaces the slot kinds in `group` can draw from between them, with no word used yet. */
	readonly room: readonly number[];
	readonly provenance: FakeAlertProvenance;
};

const POOLS = new WeakMap<ManualMorphVocabulary, Pools>();

function showable(surface: string): boolean {
	if (surface === "" || UNSHOWABLE.test(surface)) return false;
	for (let index = 0; index < surface.length; index += 1) {
		const code = surface.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = surface.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return false;
	}
	return true;
}

/**
 * Merges projected surfaces by surface: a surface counted as both a noun and a
 * sahen noun is one word, with both counts and every origin, so a Source is
 * weighed by everything it contributed.
 */
type Counted = { readonly surface: string; readonly frequency: number; readonly origins: readonly VocabularyOrigin[] };

function wordsOf(lists: readonly (readonly Counted[])[], drawMode: VocabularyDrawMode, weights: SourceWeightLookup): Word[] {
	const merged = new Map<string, { frequency: number; origins: VocabularyOrigin[] }>();
	for (const list of lists) {
		for (const entry of list) {
			if (!showable(entry.surface)) continue;
			const word = merged.get(entry.surface) ?? { frequency: 0, origins: [] };
			word.frequency += entry.frequency;
			word.origins.push(...entry.origins);
			merged.set(entry.surface, word);
		}
	}
	return [...merged].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([surface, word]) => Object.freeze({ surface, weight: drawWeight(drawMode, weights, word.frequency, word.origins) }));
}

/** Adds `by` to every group of slot kinds that can draw a word of these pools. */
function count(room: number[], kinds: number, by: number): void {
	for (let group = 1; group <= ALL_KINDS; group += 1) {
		if ((group & kinds) !== 0) room[group]! += by;
	}
}

function poolsOf(owner: ManualMorphVocabulary): Pools {
	const cached = POOLS.get(owner);
	if (cached !== undefined) return cached;
	const snapshot = owner.snapshot;
	const weights = sourceWeightLookup(snapshot);
	const collision = snapshot.projections.collision;
	const pool = (...lists: readonly (readonly Counted[])[]) => Object.freeze(wordsOf(lists, snapshot.drawMode, weights));
	const words = Object.freeze({
		// Every eligible noun, sahen nouns included: a sahen noun is a noun too.
		n: pool(collision.nouns, collision.sahenNouns),
		s: pool(collision.sahenNouns),
		// LEXEME-SHARE1: the shared lists, already one entry per basic form or stem; merging them again changes nothing.
		v: pool(regularVerbBasicForms(snapshot)),
		i: pool(iAdjectiveBasicForms(snapshot)),
		na: pool(naAdjectiveStems(snapshot)),
	});
	const kinds = new Map<string, number>();
	for (const kind of FAKE_ALERT_SLOT_KINDS) {
		for (const word of words[kind]) kinds.set(word.surface, (kinds.get(word.surface) ?? 0) | KIND_BIT[kind]);
	}
	const room = new Array<number>(ALL_KINDS + 1).fill(0);
	for (const kind of kinds.values()) count(room, kind, 1);
	const pools: Pools = Object.freeze({
		words,
		kinds,
		room: Object.freeze(room),
		provenance: Object.freeze({
			vocabularyFingerprint: snapshot.fingerprint,
			drawMode: snapshot.drawMode,
			sources: Object.freeze(snapshot.sources.map((source) =>
				Object.freeze({ path: source.path, contentHash: source.contentHash, projectionPolicy: source.projectionPolicy }))),
		}),
	});
	POOLS.set(owner, pools);
	return pools;
}

/**
 * The words Fake Alert can show for an owner, by slot kind, in canonical order.
 * For tests and measurements: `null` for anything but a live minted owner. A
 * sahen noun and a ナ-adjective stem are listed under nouns as well, as each
 * can fill a noun slot too.
 */
export function fakeAlertWords(owner: ManualMorphVocabulary): Readonly<Record<"nouns" | "sahen" | "verbs" | "adjectives" | "na", readonly string[]>> | null {
	if (!validOwner(owner)) return null;
	const { words } = poolsOf(owner);
	const surfaces = (list: readonly Word[]) => Object.freeze(list.map((word) => word.surface));
	return Object.freeze({ nouns: surfaces(words.n), sahen: surfaces(words.s), verbs: surfaces(words.v), adjectives: surfaces(words.i), na: surfaces(words.na) });
}

// --- drawing ------------------------------------------------------------------

function domainSeed(nonce: number): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < DRAW_DOMAIN.length; index += 1) {
		hash ^= DRAW_DOMAIN.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return (hash ^ nonce) >>> 0;
}

/** Picks one item by positive weight. Callers never pass a zero weight or an empty list. */
function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, random: SeededRandom): T {
	let total = 0;
	for (const item of items) total += weightOf(item);
	let draw = random.next() * total;
	for (const item of items) {
		draw -= weightOf(item);
		if (draw < 0) return item;
	}
	// Only reachable through floating-point rounding at the very top of the range.
	return items[items.length - 1]!;
}

type Context = {
	readonly set: FakeAlertRecipeSet;
	readonly level: number;
	readonly pools: Pools;
	readonly recent: ReadonlySet<string>;
	readonly recentWords: ReadonlySet<string>;
};

type Choice = { readonly recipe: FakeAlertRecipe; readonly weight: number };

/** Whether the Vocabulary has a word of every kind the recipe needs. */
function usable(recipe: FakeAlertRecipe, context: Context): boolean {
	return recipe.enabled && SCARCE.every(([kind, need]) => !recipe[need] || context.pools.words[kind].length > 0);
}

/** The squared share of a full pool a kind of word has: 1 from the full pool up. */
function poolShare(count: number, full: number): number {
	return count < full ? (count * count) / (full * full) : 1;
}

/**
 * How much of a usable recipe the Vocabulary can fill: 1, or less while a kind
 * of word it needs (sahen nouns, verbs, イ-adjectives, ナ-adjective stems) is
 * scarce. A recipe that needs several kinds counts at all their shares.
 */
function availability(recipe: FakeAlertRecipe, context: Context): number {
	let share = 1;
	for (const [kind, need, full] of SCARCE) {
		if (recipe[need]) share *= poolShare(context.pools.words[kind].length, full);
	}
	return share;
}

/**
 * The recipes one family draws from. A recipe shown recently is left out
 * while the family has another the Vocabulary can fully fill. A recipe counted
 * at a reduced availability is not such an alternative: if it were, avoiding a
 * repeat would leave only the sahen recipes and bring the few sahen nouns
 * straight back (VARIETY1 independent review 1, P2). With every recipe fully
 * available this is the earlier rule: the others when there are any.
 */
function drawable(choices: readonly Choice[], context: Context): readonly Choice[] {
	const fresh = choices.filter((choice) => !context.recent.has(choice.recipe.id));
	return fresh.some((choice) => availability(choice.recipe, context) === 1) ? fresh : choices;
}

/**
 * One family's entry in the first draw stage, over the recipes it will really
 * draw from. Those recipes count at their availability, and the family at the
 * share of their weight they keep, so the chance of each falls by its own
 * availability and no other. While every recipe is fully available the
 * family's weight and its recipes' weights are exactly what they were, so
 * adding recipes still never changes how often a family appears.
 */
function familyEntry(weight: number, choices: readonly Choice[], context: Context): { weight: number; choices: Choice[] } {
	let kept = 0, total = 0;
	const scaled = drawable(choices, context).map((choice) => {
		const share = availability(choice.recipe, context);
		total += choice.weight;
		kept += share === 1 ? choice.weight : choice.weight * share;
		return share === 1 ? choice : { recipe: choice.recipe, weight: choice.weight * share };
	});
	return { weight: kept === total ? weight : weight * (kept / total), choices: scaled };
}

function curve(family: FakeAlertFamily, level: number): number {
	return family.weight * fakeAlertLevelValue(FAKE_ALERT_DRIFT_CURVES[family.drift]!, level);
}

/** The slots a page still has to fill after the one being drawn, by kind. */
type Need = Record<FakeAlertSlotKind, number>;

/** A group of slot kinds that still have slots to fill, with how many slots that is. */
type Group = readonly [kinds: number, slots: number];

/**
 * Every group of the slot kinds that still have slots to fill. A group with a
 * kind that needs nothing can be left out: it has the slots of the group
 * without that kind and at least as many words.
 */
function groupsOf(need: Readonly<Need>): Group[] {
	let needed = 0;
	for (const kind of FAKE_ALERT_SLOT_KINDS) {
		if (need[kind] > 0) needed |= KIND_BIT[kind];
	}
	const groups: Group[] = [];
	for (let group = needed; group > 0; group = (group - 1) & needed) {
		let slots = 0;
		for (const kind of FAKE_ALERT_SLOT_KINDS) {
			if ((group & KIND_BIT[kind]) !== 0) slots += need[kind];
		}
		groups.push([group, slots]);
	}
	return groups;
}

/**
 * How many of the slots still to fill must go without a word of their own once
 * one more word of these pools is used: 0 when each can still take a word no
 * other slot has. The pools overlap, so this is the marriage condition for the
 * slot kinds: each group of kinds needs as many unused surfaces as it has
 * slots, and the largest gap is the number that cannot be filled.
 */
function shortfall(room: readonly number[], kinds: number, groups: readonly Group[]): number {
	let most = 0;
	for (const [group, slots] of groups) {
		const gap = slots - (room[group]! - ((group & kinds) !== 0 ? 1 : 0));
		if (gap > most) most = gap;
	}
	return most;
}

/**
 * One new word. A word already on this Alert is avoided outright while the
 * pool has another. Among the others, only those that leave the most later
 * slots of this page a word of their own are drawn from: a noun slot does not
 * take the only verb a verb slot needs. Without an overlap every word leaves
 * the same, so nothing is left out. A word shown recently only counts at a
 * fifth of its weight, so a small pool still works and a repeat stays
 * possible, just rarer.
 */
function drawWord(kind: FakeAlertSlotKind, need: Readonly<Need>, avoid: ReadonlySet<string>, context: Context, random: SeededRandom): string {
	const pools = context.pools;
	const pool = pools.words[kind];
	let unused = pool.filter((word) => !avoid.has(word.surface));
	const groups = unused.length > 1 ? groupsOf(need) : [];
	if (groups.length > 0) {
		const room = [...pools.room];
		for (const surface of avoid) {
			const kinds = pools.kinds.get(surface);
			if (kinds !== undefined) count(room, kinds, -1);
		}
		let least = Infinity;
		const short = unused.map((word) => {
			const value = shortfall(room, pools.kinds.get(word.surface)!, groups);
			if (value < least) least = value;
			return value;
		});
		unused = unused.filter((_word, index) => short[index] === least);
	}
	const recent = context.recentWords;
	const weightOf = recent.size === 0 ? (word: Word) => word.weight
		: (word: Word) => (recent.has(word.surface) ? word.weight / FAKE_ALERT_RECENT_WORD_DIVISOR : word.weight);
	return pickWeighted(unused.length > 0 ? unused : pool, weightOf, random).surface;
}

function kindOf(token: string): FakeAlertSlotKind {
	return parseFakeAlertSlotToken(token)!.kind;
}

/**
 * Draws a page's new words into `bindings`, adding each to `used`, the words
 * already on the Alert. Every draw avoids those words and leaves as many of
 * the slots still to come a word of their own as any choice can, so as many
 * slots as the Vocabulary allows get a word no other slot has: a page repeats
 * a word only when no assignment without a repeat exists (policy §4.3), and
 * then no more often than it must, whatever the order.
 *
 * The order is every sahen slot before every other slot, otherwise as written.
 * It no longer carries that guarantee; it is kept so that a Vocabulary whose
 * verbs are not also nouns draws exactly what it drew before.
 */
function drawWords(tokens: readonly string[], used: Set<string>, bindings: Map<string, string>, context: Context, random: SeededRandom): void {
	const kinds = tokens.map(kindOf);
	const order = [...tokens.keys()].sort((a, b) => Number(kinds[b] === "s") - Number(kinds[a] === "s"));
	const need: Need = { n: 0, s: 0, v: 0, i: 0, na: 0 };
	for (const kind of kinds) need[kind] += 1;
	for (const index of order) {
		const kind = kinds[index]!;
		need[kind] -= 1;
		const surface = drawWord(kind, need, used, context, random);
		bindings.set(tokens[index]!, surface);
		used.add(surface);
	}
}

function page(recipe: FakeAlertRecipe, bindings: ReadonlyMap<string, string>): FakeAlertPage {
	const words: FakeAlertWord[] = [];
	const lines = recipe.lines.map((line) => line.map((segment) => {
		if (typeof segment === "string") return segment;
		const surface = bindings.get(segment.token)!;
		if (!words.some((word) => word.token === segment.token)) words.push({ token: segment.token, surface });
		return surface;
	}).join(""));
	return {
		recipeId: recipe.id, family: recipe.family, kind: recipe.kind,
		buttons: FAKE_ALERT_BUTTON_SETS[recipe.buttons], lines, words,
	};
}

/** The first page: a family of the prompt or terminal stage, then one of its recipes, then its words. */
function opening(context: Context, random: SeededRandom): { recipe: FakeAlertRecipe; bindings: Map<string, string> } | null {
	const families = context.set.families
		.filter((family) => family.stage !== "outcome")
		.map((family) => familyEntry(curve(family, context.level),
			family.recipes.filter((recipe) => usable(recipe, context)).map((recipe) => ({ recipe, weight: recipe.weight })), context))
		.filter((entry) => entry.weight > 0 && entry.choices.length > 0);
	if (families.length === 0) return null;
	const { recipe } = pickWeighted(pickWeighted(families, (entry) => entry.weight, random).choices, (choice) => choice.weight, random);
	const bindings = new Map<string, string>();
	drawWords(recipe.sharedSlots, new Set(), bindings, context, random);
	return { recipe, bindings };
}

/**
 * The page one button leads to. A family answers the button's role in full, or
 * at the level's mismatch rate; a recipe that uses a shared slot the Prompt
 * lacks counts at the level's misfit rate. A shared slot keeps the Prompt's
 * word at the level's inheritance rate, decided once per slot; otherwise, and
 * for every Outcome-local slot, a new word is drawn, avoiding the words already
 * on this Alert's pages when the Vocabulary allows (`drawWords`).
 */
function outcome(role: FakeAlertRole, prompt: ReadonlyMap<string, string>, context: Context, random: SeededRandom): FakeAlertPage | null {
	const mismatch = fakeAlertLevelValue(FAKE_ALERT_ROLE_MISMATCH, context.level);
	const misfit = fakeAlertLevelValue(FAKE_ALERT_SLOT_MISFIT, context.level);
	const full = FAKE_ALERT_MATCH_EIGHTHS * FAKE_ALERT_LEVEL_SCALE;
	const families = context.set.families
		.filter((family) => family.stage === "outcome")
		.map((family) => familyEntry(curve(family, context.level) * (family.on === role || family.on === "any" ? full : mismatch),
			family.recipes.filter((recipe) => usable(recipe, context))
				.map((recipe) => ({ recipe, weight: recipe.weight * (recipe.sharedSlots.every((token) => prompt.has(token)) ? full : misfit) }))
				.filter((choice) => choice.weight > 0), context))
		.filter((entry) => entry.weight > 0 && entry.choices.length > 0);
	if (families.length === 0) return null;
	const { recipe } = pickWeighted(pickWeighted(families, (entry) => entry.weight, random).choices, (choice) => choice.weight, random);
	const keep = fakeAlertLevelValue(FAKE_ALERT_INHERIT_PERCENT, context.level);
	const bindings = new Map<string, string>();
	const fresh: string[] = [];
	for (const token of recipe.sharedSlots) {
		const inherited = prompt.get(token);
		if (inherited !== undefined && random.next() * 100 * FAKE_ALERT_LEVEL_SCALE < keep) bindings.set(token, inherited);
		else fresh.push(token);
	}
	drawWords([...fresh, ...recipe.localSlots], new Set(prompt.values()), bindings, context, random);
	return page(recipe, bindings);
}

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const inner of Object.values(value)) deepFreeze(inner);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRequest(input: unknown): input is GenerateFakeAlertInput {
	if (!isRecord(input) || Object.keys(input).some((key) => !INPUT_KEYS.includes(key))) return false;
	const { level, nonce, recent, recentWords } = input;
	if (!isFakeAlertLevel(level)) return false;
	if (typeof nonce !== "number" || !Number.isInteger(nonce) || nonce < 0 || nonce > UINT32_MAX) return false;
	const strings = (value: unknown, max: number) => value === undefined ||
		(Array.isArray(value) && value.length <= max && value.every((entry) => typeof entry === "string"));
	return strings(recent, FAKE_ALERT_RECENT_MAX) && strings(recentWords, FAKE_ALERT_RECENT_WORDS_MAX);
}

function validOwner(owner: unknown): owner is ManualMorphVocabulary {
	try {
		return isRecord(owner) && isManualMorphVocabulary(owner as ManualMorphVocabulary);
	} catch {
		return false;
	}
}

/**
 * Makes one Alert. Refused input, an owner that is not a live minted
 * Vocabulary, a Vocabulary with no showable noun and a level that leaves no
 * candidate each return a fixed reason; nothing is thrown for them.
 */
export function generateFakeAlert(input: GenerateFakeAlertInput): FakeAlertGeneration {
	if (!validRequest(input)) return { ok: false, reason: "invalid-request" };
	const set = input.recipes === undefined ? standardFakeAlertRecipes() : input.recipes;
	if (!isFakeAlertRecipeSet(set)) return { ok: false, reason: "invalid-recipes" };
	if (!validOwner(input.owner)) return { ok: false, reason: "invalid-vocabulary" };
	let pools: Pools;
	try {
		pools = poolsOf(input.owner);
	} catch {
		return { ok: false, reason: "invalid-vocabulary" };
	}
	if (pools.words.n.length === 0) return { ok: false, reason: "insufficient-vocabulary" };
	const context: Context = { set, level: input.level, pools, recent: new Set(input.recent ?? []), recentWords: new Set(input.recentWords ?? []) };
	const random = createSeededRandom(domainSeed(input.nonce));
	const first = opening(context, random);
	if (first === null) return { ok: false, reason: "no-candidate" };
	const prompt = page(first.recipe, first.bindings);
	const outcomes: Partial<Record<FakeAlertButton, FakeAlertPage>> = {};
	if (first.recipe.stage === "prompt") {
		// One stream per button, drawn in button order, so each Outcome is independent of the others.
		const streams = prompt.buttons.map((button) => [button, createSeededRandom(random.nextUint32())] as const);
		for (const [button, stream] of streams) {
			const next = outcome(FAKE_ALERT_BUTTON_ROLES[button], first.bindings, context, stream);
			if (next === null) return { ok: false, reason: "no-candidate" };
			outcomes[button] = next;
		}
	}
	const alert: FakeAlert = deepFreeze({
		algorithmVersion: FAKE_ALERT_ALGORITHM_VERSION,
		recipeDataVersion: set.dataVersion,
		level: input.level,
		shape: first.recipe.stage === "prompt" ? "dialog" : "terminal",
		prompt,
		outcomes,
		provenance: pools.provenance,
	});
	ALERTS.add(alert);
	return { ok: true, alert };
}
