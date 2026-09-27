import { prepareFakeDictionaryGeneration } from "../dictionary/generateFakeDefinition";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphSourceAnalysis, type ManualMorphVocabulary } from "../transform/manualMorphology";
import type { SourceSnapshot } from "./SourceSnapshot";
import { type VocabularySnapshot, type VocabularyDrawMode } from "../vocabulary/vocabularySnapshot";
import type { JapaneseTokenizer } from "../tokenizer/JapaneseTokenizer";
import type { RubyVocabulary } from "../analysis/rubyVocabulary";
import type { DictionaryVocabularyPool } from "../dictionary/vocabularyPool";
import { FAKE_DICTIONARY_PLACEHOLDERS } from "../dictionary/placeholders";

export type VocabularySelection = { mode: "current" | "selected"; paths: readonly string[]; drawMode: VocabularyDrawMode };
export const initialVocabularySelection = (): VocabularySelection => ({ mode: "current", paths: [], drawMode: "uniform" });
export const VOCABULARY_PREPARATION_ERROR = "Could not prepare Vocabulary. Check selected notes and retry.";
export const VOCABULARY_REFRESH_REQUIRED = "Refresh target before using this note as Vocabulary.";
/**
 * The Apply itself committed: the new Vocabulary Snapshot is what this session
 * is using. Only storing the draw mode for the next session failed, so the
 * message says exactly that rather than claiming the old vocabulary is back.
 */
export const VOCABULARY_DRAW_MODE_SAVE_ERROR =
 "The new vocabulary is in use for this session, but the draw mode could not be saved for next time.";

export function vocabularyPaths(paths: readonly string[]): string[] {
 const normalized = paths.map(path => path.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/").replace(/^(\.\/)+/u, ""));
 if (normalized.some(path => !path || path.startsWith("/") || /^[A-Za-z]:/u.test(path) || path.includes("\0") || path.split("/").some(p => !p || p === "." || p === ".."))) throw Error(VOCABULARY_PREPARATION_ERROR);
 return [...new Set(normalized)].sort();
}

export function snapshotRubyVocabulary(snapshot: VocabularySnapshot): RubyVocabulary {
 return { candidates: snapshot.candidates, fingerprint: snapshot.fingerprint,
  automaticBody: new Map(snapshot.projections.automaticBody.buckets.map(b => [b.key, Object.freeze(b.surfaces.map(s => s.surface))])) };
}
export function snapshotDictionaryPool(snapshot: VocabularySnapshot): DictionaryVocabularyPool {
 const pool = Object.freeze(Object.fromEntries(FAKE_DICTIONARY_PLACEHOLDERS.map(p => [p,
  Object.freeze(snapshot.projections.dictionary.byPlaceholder[p].map(s => s.surface))])) as Record<typeof FAKE_DICTIONARY_PLACEHOLDERS[number], readonly string[]>);
 prepareFakeDictionaryGeneration(pool);
 return pool;
}

/** Sequential by design: at most one read/hash/analyzer runs for an Apply. No partial return. */
export async function prepareVocabulary(input: {
 selection: VocabularySelection; target: SourceSnapshot | null;
 readText: (path: string) => Promise<string>;
 tokenizer: JapaneseTokenizer; isCurrent: () => boolean; checkpoint: () => Promise<boolean>;
 progress: (done: number, total: number) => void;
}): Promise<ManualMorphVocabulary | null> {
 const paths = input.selection.mode === "current" ? (input.target ? [input.target.sourcePath] : []) : vocabularyPaths(input.selection.paths);
 if (!paths.length) throw Error(VOCABULARY_PREPARATION_ERROR);
 const sources: ManualMorphSourceAnalysis[] = [];
 input.progress(0, paths.length);
 for (const path of paths) {
  if (!input.isCurrent() || !(await input.checkpoint())) return null;
  {
   const text = input.target && path === input.target.sourcePath ? input.target.text : await input.readText(path);
   if (!input.isCurrent() || !(await input.checkpoint())) return null;
   const analyzed = await analyzeManualMorphSource({ text, sourcePath: path, tokenizer: input.tokenizer,
    isCurrent: input.isCurrent, checkpoint: input.checkpoint, mode: "target-prototype" });
   if (analyzed.status === "stale") return null;
   if (analyzed.status !== "ready") throw Error(VOCABULARY_PREPARATION_ERROR);
   sources.push(analyzed.analysis);
  }
  input.progress(sources.length, paths.length);
 }
 if (!input.isCurrent() || !(await input.checkpoint())) return null;
 const active = buildManualMorphVocabulary({ sources, drawMode: input.selection.drawMode });
 return input.isCurrent() ? active : null;
}
