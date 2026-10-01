/**
 * PRE-RELEASE-EXPERIENCE-VOCABULARY1 production graph delta, relative to the
 * FAKE-PROVERB-VIEW1 pin (`fakeProverbViewGraphs.json`, unchanged through
 * EXPERIENCE-DISPLAY1). The Vocabulary picker moved into a View-owned Modal
 * with a folder view; these are the only modules that adds, and none leave.
 */
export const EXPERIENCE_VOCABULARY_ADDED = [
	"src/view/VocabularyModal.ts",
	"src/view/vocabularyTree.ts",
] as const;

/**
 * PRE-RELEASE-EXPERIENCE-TOKEN-UI1 adds one pure module: the overlay placement
 * rule the Fake Dictionary Popover and the Manual menu now share. None leave.
 */
export const EXPERIENCE_TOKEN_UI_ADDED = [
	"src/view/overlayPlacement.ts",
] as const;

/**
 * PRE-RELEASE-EXPERIENCE-CONTROLS1 adds one module: the icon-plus-label helper
 * over Obsidian's own `setIcon()`. None leave.
 */
export const EXPERIENCE_CONTROLS_ADDED = [
	"src/view/controlIcon.ts",
	"src/view/toolbarOverflow.ts",
] as const;

/**
 * PRE-RELEASE-EXPERIENCE-LOCALE1 adds the interface language: the typed EN / JA
 * catalog, the plugin-wide current language, the English-to-Japanese pairing
 * of application message constants, and in-place re-labelling. None leave.
 */
export const EXPERIENCE_LOCALE_ADDED = [
	"src/i18n/catalog.ts",
	"src/i18n/language.ts",
	"src/i18n/messages.ts",
	"src/i18n/uiLabels.ts",
] as const;

/**
 * PRE-RELEASE-EXPERIENCE-UI-POLISH1 adds the macOS name of the saved "alt"
 * modifier. The ribbon and the vocabulary summary stay in modules already on
 * the graph. None leave.
 */
export const EXPERIENCE_UI_POLISH_ADDED = [
	"src/view/dictionaryModifierLabel.ts",
] as const;

/**
 * PRE-RELEASE-COLLECT-ATTRIBUTION1 adds the queue-time attribution lines.
 * The interface catalog and language were already on the graph. None leave.
 */
export const COLLECT_ATTRIBUTION_ADDED = [
	"src/collect/localCollectionDate.ts",
	"src/collect/v4/collectAttribution.ts",
	"src/i18n/attributionLabels.ts",
] as const;

/**
 * 0.1.0 S3 adds the Vocabulary Source weight arithmetic, a pure leaf the
 * Vocabulary Snapshot and every draw site import. None leave.
 */
export const RELEASE_010_S3_ADDED = [
	"src/vocabulary/sourceWeights.ts",
] as const;

/**
 * 0.1.0 S4 adds the enclosed-term reading of a Vocabulary Source, a pure leaf
 * the Source analyzer, the settings contract and the View import. None leave.
 */
export const RELEASE_010_S4_ADDED = [
	"src/text/enclosedTermDelimiters.ts",
	"src/vocabulary/enclosedTerms.ts",
] as const;

/**
 * 0.1.0 S5 connects Recompose: the core, its two methods, the versions leaf the
 * Collect contract validates against, and the View-owned dialog. None leave.
 */
export const RELEASE_010_S5_ADDED = [
	"src/recompose/methods/jointMethod.ts",
	"src/recompose/methods/ngramMethod.ts",
	"src/recompose/recompose.ts",
	"src/recompose/recomposeCorpus.ts",
	"src/recompose/recomposeTypes.ts",
	"src/recompose/recomposeVersions.ts",
	"src/view/RecomposeModal.ts",
] as const;

/** The current production graph: the FAKE-PROVERB-VIEW1 pin plus every EXPERIENCE1 and 0.1.0 delta so far. */
export function applyExperienceDelta(graph: readonly string[]): string[] {
	return [...graph, ...EXPERIENCE_VOCABULARY_ADDED, ...EXPERIENCE_TOKEN_UI_ADDED, ...EXPERIENCE_CONTROLS_ADDED, ...EXPERIENCE_LOCALE_ADDED, ...EXPERIENCE_UI_POLISH_ADDED, ...COLLECT_ATTRIBUTION_ADDED, ...RELEASE_010_S3_ADDED, ...RELEASE_010_S4_ADDED, ...RELEASE_010_S5_ADDED].sort();
}
