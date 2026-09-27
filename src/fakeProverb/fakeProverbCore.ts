/**
 * PRE-RELEASE-FAKE-PROVERB-CORE1: the pure Fake Proverb generation core.
 * Production-disconnected; Fake Proverb algorithm 1.
 *
 * One function turns an authenticated Fake Proverb authority, the compiled
 * Recipe Schema 1 set it is bound to, a draw mode, a count and a private
 * uint32 nonce into drafts. Each draft is one inseparable proverb and gloss.
 *
 * What it refuses to do is as much the contract:
 *
 *   - It never reads or tokenizes a Source, reads Markdown at runtime, touches
 *     the DOM, settings, the Clipboard, the Vault or the network, and never
 *     issues a nonce. It scores nothing for meaning and looks nothing up.
 *   - It mints no `batchId`, `rowId` or `rowSlotId` and produces no Collect
 *     metadata; those belong to BATCH1 / COLLECT1. The nonce is not a public
 *     Seed and reaches no result.
 *   - A refusal is a fixed code with no path, note text, surface, reading or
 *     exception message. Inputs are only read; drafts are deeply frozen.
 *
 * Sharing is typed binding, never text: a proverb slot is drawn once and its
 * binding object is what a gloss `reference` resolves to, so the gloss uses
 * that exact surface, candidate and form. A gloss-local slot is a separate
 * draw with its own binding and never replaces a proverb binding.
 *
 * Four weight systems meet and none is multiplied into another: proverb recipe
 * weight picks a proverb, gloss recipe weight picks a compatible gloss, profile
 * form weight picks a form, and Vocabulary Uniform / Frequency picks a
 * candidate within that form. Each is its own draw.
 */

import { freezeAnalysis } from "../analysis/rubyVocabulary";
import { createSeededRandom, UINT32_MAX, type SeededRandom } from "../random/seededRandom";
import type { VocabularyDrawMode } from "../vocabulary/vocabularySnapshot";
import {
	isFakeProverbGlossCompatible,
	type CompiledFakeProverbGloss,
	type CompiledFakeProverbPart,
	type CompiledFakeProverbProfile,
	type CompiledFakeProverbRecipe,
	type CompiledFakeProverbRecipeSet,
	type CompiledFakeProverbSlotPart,
} from "./compileRecipeSet";
import {
	exactFields,
	guardFakeProverb,
	isFakeProverbSafeText,
	refuseFakeProverb,
	resolveFakeProverbAuthority,
	type FakeProverbAnswer,
	type FakeProverbAuthority,
	type FakeProverbCandidate,
	type FakeProverbProvenance,
} from "./fakeProverbAuthority";
import { fakeProverbCanonicalText } from "./fakeProverbText";
import { FAKE_PROVERB_ALGORITHM_VERSION } from "./fakeProverbVersions";

export { fakeProverbCanonicalText } from "./fakeProverbText";
import type { FakeProverbCandidateForm, FakeProverbSlotKind } from "./recipeData";

/** A batch never exceeds this; BATCH1 always asks for exactly this many. */
export const FAKE_PROVERB_MAX_COUNT = 10;
/** Attempts per requested result before the batch stops short as `duplicate-exhaustion`. */
export const FAKE_PROVERB_ATTEMPT_LIMIT = 12;

/** The FNV-1a hash of this domain separates the core's stream from any other use of the same nonce. */
const DRAW_DOMAIN = "semantropy/fake-proverb-1";

export type FakeProverbShortfallReason = "insufficient-candidates" | "no-compatible-gloss" | "duplicate-exhaustion";

/** One drawn slot. A gloss reference resolves to the same object, never to a copy. */
export type FakeProverbBinding = {
	readonly scope: "proverb" | "gloss";
	readonly slotId: string;
	readonly kind: FakeProverbSlotKind;
	readonly profileId: string;
	readonly form: FakeProverbCandidateForm;
	readonly surface: string;
	/** The authority's own candidate: identity, frequency, origins and realization evidence. */
	readonly candidate: FakeProverbCandidate;
};

export type FakeProverbDraft = {
	readonly proverb: {
		readonly recipeId: string;
		readonly text: string;
		readonly bindings: readonly FakeProverbBinding[];
	};
	readonly gloss: {
		readonly recipeId: string;
		readonly text: string;
		/** Gloss-local slots only. */
		readonly bindings: readonly FakeProverbBinding[];
		/** In part order; each `binding` is a proverb binding or an earlier gloss-local one. */
		readonly references: readonly { readonly slotId: string; readonly binding: FakeProverbBinding }[];
	};
	/** `**{proverb}**\n\n> {gloss}`, no terminal newline. */
	readonly canonicalText: string;
};

export type FakeProverbGeneration = {
	readonly algorithmVersion: typeof FAKE_PROVERB_ALGORITHM_VERSION;
	readonly recipeSchemaVersion: number;
	readonly recipeDataVersion: number;
	readonly provenance: FakeProverbProvenance;
	readonly requestedCount: number;
	readonly drafts: readonly FakeProverbDraft[];
	/** Null only when every requested draft was produced. */
	readonly shortfall: FakeProverbShortfallReason | null;
};

function domainSeed(nonce: number): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < DRAW_DOMAIN.length; index += 1) {
		hash ^= DRAW_DOMAIN.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return (hash ^ nonce) >>> 0;
}

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

type Prepared = {
	readonly set: CompiledFakeProverbRecipeSet;
	readonly drawMode: VocabularyDrawMode;
	readonly literals: ReadonlyMap<string, string>;
	readonly profiles: ReadonlyMap<string, CompiledFakeProverbProfile>;
	readonly candidates: ReadonlyMap<string, readonly FakeProverbCandidate[]>;
};

/** A profile can be drawn when at least one of its forms has a candidate. */
function viableForms(profile: CompiledFakeProverbProfile, prepared: Prepared) {
	return profile.forms.filter((entry) => (prepared.candidates.get(entry.form)?.length ?? 0) > 0);
}

function slotsViable(parts: readonly CompiledFakeProverbPart[], prepared: Prepared): boolean {
	return parts.every((part) => part.kind === "literal" || part.kind === "reference" ||
		viableForms(prepared.profiles.get(part.profileId)!, prepared).length > 0);
}

/**
 * Draws one slot: form by profile weight among viable forms, then a candidate
 * by the Vocabulary draw mode within that form. A surface already used in
 * this draft is avoided while another candidate of the chosen form remains.
 */
function drawSlot(part: CompiledFakeProverbSlotPart, scope: "proverb" | "gloss", prepared: Prepared,
	random: SeededRandom, used: Set<string>): FakeProverbBinding {
	const profile = prepared.profiles.get(part.profileId)!;
	const form = pickWeighted(viableForms(profile, prepared), (entry) => entry.weight, random).form;
	const all = prepared.candidates.get(form)!;
	const fresh = all.filter((candidate) => !used.has(candidate.surface));
	const pool = fresh.length > 0 ? fresh : all;
	const candidate = pickWeighted(pool, (entry) => (prepared.drawMode === "frequency" ? entry.frequency : 1), random);
	used.add(candidate.surface);
	return Object.freeze({ scope, slotId: part.slotId, kind: part.kind, profileId: part.profileId, form, surface: candidate.surface, candidate });
}

function compose(proverb: CompiledFakeProverbRecipe, gloss: CompiledFakeProverbGloss, prepared: Prepared, random: SeededRandom): FakeProverbDraft {
	const used = new Set<string>();
	const proverbBindings: FakeProverbBinding[] = [];
	const proverbText: string[] = [];
	for (const part of proverb.parts) {
		if (part.kind === "literal") {
			proverbText.push(prepared.literals.get(part.literalId)!);
			continue;
		}
		// Each proverb slot is drawn exactly once.
		const binding = drawSlot(part, "proverb", prepared, random, used);
		proverbBindings.push(binding);
		proverbText.push(binding.surface);
	}
	const exported = new Map(proverbBindings.filter((binding) =>
		proverb.exports.some((entry) => entry.slotId === binding.slotId && entry.kind === binding.kind)).map((binding) => [binding.slotId, binding]));
	const locals = new Map<string, FakeProverbBinding>();
	const glossBindings: FakeProverbBinding[] = [];
	const references: { slotId: string; binding: FakeProverbBinding }[] = [];
	const glossText: string[] = [];
	for (const part of gloss.parts) {
		if (part.kind === "literal") {
			glossText.push(prepared.literals.get(part.literalId)!);
		} else if (part.kind === "reference") {
			const binding = part.source === "requirement" ? exported.get(part.slotId) : locals.get(part.slotId);
			// Compatibility and compilation guarantee this; a miss is a contract breach, never a re-draw.
			if (!binding || binding.kind !== part.slotKind) refuseFakeProverb("invalid-authority");
			references.push({ slotId: part.slotId, binding });
			glossText.push(binding.surface);
		} else {
			const binding = drawSlot(part, "gloss", prepared, random, used);
			locals.set(binding.slotId, binding);
			glossBindings.push(binding);
			glossText.push(binding.surface);
		}
	}
	const proverbPlain = proverbText.join("");
	const glossPlain = glossText.join("");
	// Structural backstop: literals and candidate surfaces already pass the grammar, so their concatenation does.
	if (!isFakeProverbSafeText(proverbPlain) || !isFakeProverbSafeText(glossPlain)) refuseFakeProverb("invalid-authority");
	return {
		proverb: { recipeId: proverb.id, text: proverbPlain, bindings: proverbBindings },
		gloss: { recipeId: gloss.id, text: glossPlain, bindings: glossBindings, references },
		canonicalText: fakeProverbCanonicalText(proverbPlain, glossPlain),
	};
}

/**
 * Generates up to `count` distinct drafts. The batch is finite: every
 * requested draft gets `FAKE_PROVERB_ATTEMPT_LIMIT` attempts, an exact
 * canonical duplicate never counts, and a batch that cannot be filled stops
 * with a fixed shortfall reason instead of padding or looping.
 */
export function generateFakeProverbs(input: {
	readonly authority: FakeProverbAuthority;
	readonly recipeSet: CompiledFakeProverbRecipeSet;
	readonly drawMode: VocabularyDrawMode;
	readonly count: number;
	readonly nonce: number;
}): FakeProverbAnswer<FakeProverbGeneration> {
	return guardFakeProverb(() => {
		const data = exactFields(input, ["authority", "recipeSet", "drawMode", "count", "nonce"]);
		const count = data["count"];
		const nonce = data["nonce"];
		const drawMode = data["drawMode"];
		if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > FAKE_PROVERB_MAX_COUNT) refuseFakeProverb("invalid-request");
		if (typeof nonce !== "number" || !Number.isInteger(nonce) || nonce < 0 || nonce > UINT32_MAX) refuseFakeProverb("invalid-request");
		if (drawMode !== "uniform" && drawMode !== "frequency") refuseFakeProverb("invalid-request");
		const authority = data["authority"] as FakeProverbAuthority;
		// Origin, owner liveness and binding on every call; structure was proven at mint (no re-derivation).
		const { recipeSet: set } = resolveFakeProverbAuthority(authority, data["recipeSet"], false);
		// The draw mode is the one the Vocabulary was captured with; a different one is stale settings.
		if (drawMode !== authority.provenance.drawMode) refuseFakeProverb("provenance-mismatch");

		const prepared: Prepared = {
			set,
			drawMode,
			literals: new Map(set.literals.map((entry) => [entry.id, entry.literal])),
			profiles: new Map(set.profiles.map((entry) => [entry.id, entry])),
			candidates: new Map(authority.forms.map((entry) => [entry.form, entry.candidates])),
		};
		const proverbs = set.proverbs.filter((entry) => entry.enabled && slotsViable(entry.parts, prepared));
		const glosses = set.glosses.filter((entry) => entry.enabled && slotsViable(entry.parts, prepared));
		const pairs = proverbs
			.map((proverb) => ({ proverb, glosses: glosses.filter((gloss) => isFakeProverbGlossCompatible(proverb, gloss)) }))
			.filter((entry) => entry.glosses.length > 0);

		const drafts: FakeProverbDraft[] = [];
		let shortfall: FakeProverbShortfallReason | null = null;
		if (proverbs.length === 0) {
			shortfall = "insufficient-candidates";
		} else if (pairs.length === 0) {
			shortfall = "no-compatible-gloss";
		} else {
			const random = createSeededRandom(domainSeed(nonce));
			const seen = new Set<string>();
			for (let index = 0; index < count && shortfall === null; index += 1) {
				let accepted: FakeProverbDraft | null = null;
				for (let attempt = 0; attempt < FAKE_PROVERB_ATTEMPT_LIMIT && accepted === null; attempt += 1) {
					// Recipe weight, then gloss weight: two draws, never a product.
					const pair = pickWeighted(pairs, (entry) => entry.proverb.weight, random);
					const gloss = pickWeighted(pair.glosses, (entry) => entry.weight, random);
					const draft = compose(pair.proverb, gloss, prepared, random);
					if (!seen.has(draft.canonicalText)) accepted = draft;
				}
				if (accepted === null) {
					shortfall = "duplicate-exhaustion";
				} else {
					seen.add(accepted.canonicalText);
					drafts.push(accepted);
				}
			}
		}
		return freezeAnalysis<FakeProverbGeneration>({
			algorithmVersion: FAKE_PROVERB_ALGORITHM_VERSION,
			recipeSchemaVersion: authority.recipeSchemaVersion,
			recipeDataVersion: authority.recipeDataVersion,
			provenance: authority.provenance,
			requestedCount: count,
			drafts,
			shortfall,
		});
	}, "invalid-request");
}
