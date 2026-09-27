import type { DisplaySlot } from "../analysis/displaySlots";
import { FAKE_DICTIONARY_PLACEHOLDERS } from "../dictionary/placeholders";
import { STANDARD_TEMPLATE_SET } from "../dictionary/standardTemplateSet";
import type { VocabularySnapshot } from "../vocabulary/vocabularySnapshot";

export const DICTIONARY_DIAGNOSTICS = Object.freeze({
 off: "Fake dictionary is Off.",
 preparing: "Fake dictionary: Vocabulary is being prepared.",
 unsupported: "Fake dictionary: this token is not a supported headword.",
 pool: "Fake dictionary: the Vocabulary pool cannot fill a definition template.",
 templates: "Fake dictionary: no usable template is available.",
 error: "Fake dictionary: definition generation failed.",
 stale: "Fake dictionary: the request is stale or cancelled.",
 unknown: "Fake dictionary availability could not be verified.",
 ready: "Fake dictionary: hold the configured modifier over a marked word.",
});
export type DictionaryDiagnostics = {
 readonly sources: readonly { readonly ordinal: number; readonly counts: Readonly<Record<typeof FAKE_DICTIONARY_PLACEHOLDERS[number], number>> }[];
 readonly core: number; readonly families: number; readonly clauses: number;
 readonly totalCore: number; readonly totalClauses: number;
};
/** Snapshot projection owns surface deduplication and origins. Never count frequency or candidate records. */
export function dictionaryDiagnostics(snapshot: VocabularySnapshot): DictionaryDiagnostics {
 const projection = snapshot.projections.dictionary.byPlaceholder;
 const usable = (required: readonly typeof FAKE_DICTIONARY_PLACEHOLDERS[number][]) => required.every(key => projection[key].length > 0);
 const core = STANDARD_TEMPLATE_SET.coreTemplates.filter(t => usable(t.requiredPlaceholders));
 return Object.freeze({
  sources: snapshot.sources.map((source, index) => ({ ordinal: index + 1, counts: Object.fromEntries(
   FAKE_DICTIONARY_PLACEHOLDERS.map(key => [key, projection[key].filter(surface => surface.origins.some(origin => origin.path === source.path && origin.contentHash === source.contentHash)).length])
  ) as Record<typeof FAKE_DICTIONARY_PLACEHOLDERS[number], number> })),
  core: core.length, families: new Set(core.map(t => t.family)).size,
  clauses: STANDARD_TEMPLATE_SET.optionalClauses.filter(t => usable(t.requiredPlaceholders)).length,
  totalCore: STANDARD_TEMPLATE_SET.coreTemplates.length, totalClauses: STANDARD_TEMPLATE_SET.optionalClauses.length,
 });
}
export function dictionaryDiagnosticMessage(input: { level: number; preparing: boolean; stale: boolean; slot: DisplaySlot | null; counts: DictionaryDiagnostics | null }): string {
 if (input.preparing || !input.counts) return DICTIONARY_DIAGNOSTICS.preparing;
 if (input.stale) return DICTIONARY_DIAGNOSTICS.stale;
 if (input.level === 0) return DICTIONARY_DIAGNOSTICS.off;
 if (input.slot && !input.slot.dictionaryEligible) return DICTIONARY_DIAGNOSTICS.unsupported;
 if (input.counts.totalCore === 0) return DICTIONARY_DIAGNOSTICS.templates;
 if (input.counts.core === 0) return DICTIONARY_DIAGNOSTICS.pool;
 if (input.slot && !input.slot.dictionaryAvailable) return DICTIONARY_DIAGNOSTICS.unknown;
 return DICTIONARY_DIAGNOSTICS.ready;
}
