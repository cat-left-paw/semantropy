import { planAutomaticDisplaySlots, type DisplaySlot, type DisplaySlotChunkInput, type DisplaySlotPlan, type ManualOverride } from "../analysis/displaySlots";
import { applyManualDisplay, manualSeed } from "../analysis/manualDisplay";
import { freezeAnalysis } from "../analysis/rubyVocabulary";
import type { TargetLineChunk, TargetLineIndex } from "../analysis/targetChunkIr";
import { validateHeadword } from "../dictionary/headword";
import type { BodySemantropy } from "../settings/bodySemantropy";
import type { DictionarySemantropy } from "../settings/dictionarySemantropy";
import type { AutomaticPosOptions } from "../transform/automaticPosOptions";
import { bindMaxTarget, createMaxProjection, inspectMaxResult, releaseMaxOwner, transformMax } from "../transform/maxCore";
import { bindManualAdverbSlot, createManualAdverbAuthority, evaluateManualAdverbCandidate, evaluateManualAdverbSlot, readManualAdverbSlotContext, releaseManualAdverbAuthority,
	type ManualAdverbReleaseReason, type ManualAdverbSlot } from "../transform/manualAdverbAuthority";
import { createManualAdverbController, type ManualAdverbAction, type ManualAdverbController } from "../transform/manualAdverbController";
import { buildManualMorphVocabulary, deriveManualMorphTarget, type ManualMorphSourceAnalysis, type ManualMorphVocabulary } from "../transform/manualMorphology";

function value<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
	if (!result.ok) throw Error("Invalid automatic owner.");
	return result.value;
}

/** View-owned adapter. All candidate decisions remain in reviewed authorities:
 * MAX-CORE1 (Body 11 / projection 3 / transform 3 / fingerprint 3) is the only
 * automatic generator, and Manual Adverb stays the manual-morph-3 authority.
 * Full Vocabulary and Target analysis outlive individual materialized prefixes. */
export class AutomaticPosBodyOwner {
	readonly authority;
	readonly projection;
	private readonly prefixes = new Map<number, ReturnType<typeof deriveManualMorphTarget> & { owner: ManualMorphVocabulary }>();
	private readonly manual = new Map<string, { slot: ManualAdverbSlot; controller: ManualAdverbController; supported: boolean }>();
	private live = true;
	constructor(readonly vocabulary: ManualMorphVocabulary, private readonly source: ManualMorphSourceAnalysis,
		private readonly index: TargetLineIndex, private readonly descriptors: readonly TargetLineChunk[]) {
		this.authority = value(createManualAdverbAuthority({ vocabulary }));
		this.projection = value(createMaxProjection({ vocabulary, adverbAuthority: this.authority }));
	}
	prefix(count: number) {
		if (!this.live || !Number.isSafeInteger(count) || count < 0 || count > this.descriptors.length) throw Error("Invalid Target prefix.");
		let previous = this.prefixes.get(count);
		if (!previous) {
			const derived = deriveManualMorphTarget(this.source, this.index, this.descriptors.slice(0, count));
			previous = { ...derived, owner: buildManualMorphVocabulary({ sources: [derived.analysis], drawMode: this.vocabulary.snapshot.drawMode }) };
			this.prefixes.set(count, previous);
		}
		return previous;
	}
	draw(input: { chunks: readonly DisplaySlotChunkInput[]; options: AutomaticPosOptions; nonce: number; level: BodySemantropy;
		dictionaryLevel: DictionarySemantropy; targetRevision: number; displayRevision: number }) {
		const prefix = this.prefix(input.chunks.length);
		// Each preparation has its own Target owner: a failed draft cannot revoke
		// the committed result, or a preparation in another View.
		const targetVocabulary = buildManualMorphVocabulary({ sources: [prefix.analysis], drawMode: this.vocabulary.snapshot.drawMode });
		const target = value(bindMaxTarget({ projection: this.projection, targetVocabulary, source: prefix.analysis }));
		const result = value(transformMax({ projection: this.projection, target, runCount: target.runCount,
			options: input.options, bodySemantropy: input.level, nonce: input.nonce }));
		const current = () => this.live && inspectMaxResult({ projection: this.projection, target, result }).ok;
		const replan = (dictionaryLevel: DictionarySemantropy, displayRevision: number) => planAutomaticDisplaySlots({ targetRevision: input.targetRevision, displayRevision,
			chunks: input.chunks, dictionarySemantropy: dictionaryLevel, projection: this.projection, target, result });
		const plan = replan(input.dictionaryLevel, input.displayRevision);
		return { plan, result, current, replan, release: () => { releaseMaxOwner({ vocabulary: targetVocabulary, reason: "apply" }); } };
	}
	applyManual(plan: DisplaySlotPlan, overrides: ReadonlyMap<string, ManualOverride>, chunkCount: number) {
		const prefix = this.prefix(chunkCount);
		for (const slot of plan.slots) if (slot.originalToken.pos === "副詞" && !this.manual.has(slot.tokenId)) {
			const bound = value(bindManualAdverbSlot({ authority: this.authority, targetVocabulary: prefix.owner,
				source: prefix.analysis, runId: `${slot.chunkId}/${slot.runId}`, tokenIndex: slot.occurrence }));
			const controller = value(createManualAdverbController({ authority: this.authority, slots: [{ slot: bound, automaticSurface: slot.automaticSurface }] }));
			const context = value(readManualAdverbSlotContext({ authority: this.authority, slot: bound }));
			this.manual.set(slot.tokenId, { slot: bound, controller, supported: context.supported });
		}
		const legacy = applyManualDisplay(plan, this.vocabulary, new Map([...overrides].filter(([id]) => !this.manual.has(id))));
		const candidates = new Map(this.vocabulary.snapshot.candidates.map(candidate => [candidate.displayFormId, candidate]));
		const runs = legacy.runs.map(run => ({ ...run, slots: run.slots.map(slot => {
			const entry = this.manual.get(slot.tokenId); if (!entry) return slot;
			const override = overrides.get(slot.tokenId) ?? null;
			let surface = slot.automaticSurface, candidate = slot.automaticCandidate, ruby = slot.automaticRuby;
			if (override?.kind === "restore-original") { surface = slot.originalToken.surface; candidate = null; ruby = null; }
			if (override?.kind === "replacement") {
				const owned = this.authority.candidates.find(item => item.record.displayFormId === override.displayFormId && item.record.candidateId === override.candidateId && item.record.surface === override.surface);
				if (!owned || !value(evaluateManualAdverbCandidate({ authority: this.authority, slot: entry.slot, candidate: owned })).usable) throw Error("Invalid Manual candidate.");
				candidate = candidates.get(owned.record.displayFormId) ?? null;
				if (!candidate) throw Error("Invalid Manual candidate.");
				ruby = candidate.verifiedRubyVariants.find(variant => variant.variantId === override.rubyVariantId) ?? null;
				if (override.rubyVariantId !== null && !ruby) throw Error("Invalid Manual Ruby.");
				surface = candidate.surface;
			}
			const diagnostic = value(evaluateManualAdverbSlot({ authority: this.authority, slot: entry.slot, currentSurface: surface })).diagnostic;
			const dictionary = validateHeadword(surface, [candidate?.token ?? slot.originalToken]);
			return { ...slot, displaySurface: surface, displayCandidate: candidate, displayRuby: ruby, manualOverride: override,
				manualClass: "adverb" as const, manualEligible: entry.supported, manualAvailable: diagnostic.available,
				manualDiagnostic: { status: diagnostic.available ? "available" as const : "unavailable" as const, slotClass: "adverb" as const,
					reason: diagnostic.reason, alternativeSurfaceCount: diagnostic.alternativeSurfaceCount, overridden: override !== null },
				dictionary, dictionaryEligible: dictionary.outcome === "accepted", dictionaryAvailable: slot.dictionaryAvailable && dictionary.outcome === "accepted" };
		}) }));
		return freezeAnalysis({ ...legacy, runs, slots: runs.flatMap(run => run.slots) });
	}
	prepareManual(slot: DisplaySlot, action: ManualAdverbAction, nonce: number, revision: number) {
		const entry = this.manual.get(slot.tokenId); if (!entry) throw Error("Invalid Manual slot.");
		value(entry.controller.setAutomaticBaseline({ slot: entry.slot, surface: slot.automaticSurface }));
		if (!slot.manualOverride) {
			const reset = value(entry.controller.prepare({ slot: entry.slot, action: "use-automatic", nonce: 0 }));
			value(entry.controller.complete(reset));
		}
		const ticket = value(entry.controller.prepare({ slot: entry.slot, action,
			nonce: manualSeed(nonce, this.projection.fingerprint, slot.tokenId, revision, "manual-adverb-3") }));
		const row = value(entry.controller.preview(ticket));
		const selected = row.committed.mode === "manual" ? row.committed.candidate.record : null;
		// Adverb compact records have no generated reading. Only verified pairs may enter.
		const variants = selected?.verifiedRubyVariants ?? [];
		const ruby = variants.length ? variants[manualSeed(nonce, this.projection.fingerprint, slot.tokenId, revision, "manual-adverb-ruby") % variants.length]! : null;
		const override: ManualOverride | null = selected ? { kind: "replacement", candidateId: selected.candidateId,
			displayFormId: selected.displayFormId, surface: selected.surface, connectionKey: null, rubyVariantId: ruby?.variantId ?? null, localRevision: revision }
			: action === "restore-original" ? { kind: "restore-original", localRevision: revision } : null;
		return { override, commit: () => entry.controller.complete(ticket).ok, cancel: () => { entry.controller.cancel(ticket); } };
	}
	release(reason: ManualAdverbReleaseReason): void {
		if (!this.live) return; this.live = false;
		for (const entry of this.manual.values()) entry.controller.release(reason);
		this.manual.clear();
		// The authority belongs to this owner even when no adverb controller was materialized.
		releaseManualAdverbAuthority({ authority: this.authority, reason });
		for (const prefix of this.prefixes.values()) releaseMaxOwner({ vocabulary: prefix.owner, reason });
		this.prefixes.clear(); releaseMaxOwner({ vocabulary: this.vocabulary, reason });
	}
}
