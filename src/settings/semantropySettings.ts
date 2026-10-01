import {
	DEFAULT_BODY_SEMANTROPY,
	isBodySemantropy,
	type BodySemantropy,
} from "./bodySemantropy";
import {
	DEFAULT_COLLECTION_PATH,
	isCollectionPath,
} from "./collectionPath";
import {
	DEFAULT_DICTIONARY_SEMANTROPY,
	isDictionarySemantropy,
	type DictionarySemantropy,
} from "./dictionarySemantropy";
import {
	defaultSemantropyDisplaySettings,
	parseDisplaySettings,
	type BodyFontFamily,
	type DictionaryModifier,
	type SemantropyDisplaySettings,
} from "./displaySettings";
import type { VocabularyDrawMode } from "../vocabulary/vocabularySnapshot";

export const SEMANTROPY_SETTINGS_SCHEMA_VERSION = 3;

/** The two schemas this one migrates from. */
const SCHEMA_WITH_COLLECTION_PATH = 2;
const SCHEMA_SEMANTROPY_ONLY = 1;

const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [
	SCHEMA_SEMANTROPY_ONLY,
	SCHEMA_WITH_COLLECTION_PATH,
	SEMANTROPY_SETTINGS_SCHEMA_VERSION,
];

/**
 * Everything Semantropy persists. Nothing derived from a note goes here: no
 * body text, no fragment, no metadata, no tokens, no pool, no snapshot hash,
 * no Vocabulary Source selection, no manual override, no selection or hover
 * cache, and no generation nonce. Transient generation state is session-only
 * and is not a restoration feature.
 */
export type SemantropySettings = {
	schemaVersion: typeof SEMANTROPY_SETTINGS_SCHEMA_VERSION;
	bodySemantropy: BodySemantropy;
	dictionarySemantropy: DictionarySemantropy;
	collectionPath: string;
	// 0.1.0 S2: schema 3 never had a theme; schema 8 adds `bodyTheme` on top of this shape.
} & Omit<SemantropyDisplaySettings, "bodyTheme">;

/** The display fields schema 3 owns: everything except the schema 8 theme. */
function schema3Display(display: SemantropyDisplaySettings): Omit<SemantropyDisplaySettings, "bodyTheme"> {
	const { bodyTheme, ...owned } = display;
	void bodyTheme;
	return owned;
}

/** The exact shape written to `data.json`. */
export type StoredSemantropySettings = {
	schemaVersion: number;
	bodySemantropy: number;
	dictionarySemantropy: number;
	collectionPath: string;
	vocabularyDrawMode: VocabularyDrawMode;
	bodyFontFamily: BodyFontFamily;
	bodyFontSizePx: number | null;
	bodyBackground: string | null;
	bodyForeground: string | null;
	showRuby: boolean;
	showReplacementMarkers: boolean;
	showManualMarkers: boolean;
	showDictionaryMarkers: boolean;
	dictionaryModifier: DictionaryModifier;
};

export function defaultSemantropySettings(): SemantropySettings {
	return {
		schemaVersion: SEMANTROPY_SETTINGS_SCHEMA_VERSION,
		bodySemantropy: DEFAULT_BODY_SEMANTROPY,
		dictionarySemantropy: DEFAULT_DICTIONARY_SEMANTROPY,
		collectionPath: DEFAULT_COLLECTION_PATH,
		...schema3Display(defaultSemantropyDisplaySettings()),
	};
}

/**
 * Reads stored settings defensively.
 *
 * Three supported schemas are read. Schema 1 held the two Semantropy values
 * and nothing else; schema 2 added the collection path. Migrating either keeps
 * the values that schema really had and takes the defaults for everything it
 * did not — an upgrade must not cost the user a setting they already chose,
 * and equally must not adopt a key that schema never wrote. Schema 3 is read
 * as it stands.
 *
 * An unrecognised or missing `schemaVersion` means the fields may not mean
 * what this version thinks they mean, so nothing is read from them: the whole
 * payload falls back to the defaults. Within a supported schema, each field is
 * validated on its own, so a corrupted value falls back to its default without
 * discarding the others. Unknown keys are dropped rather than carried forward.
 */
export function parseSemantropySettings(raw: unknown): SemantropySettings {
	const defaults = defaultSemantropySettings();
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return defaults;
	}
	const stored = raw as Record<string, unknown>;
	const schemaVersion = stored["schemaVersion"];
	if (
		typeof schemaVersion !== "number" ||
		!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)
	) {
		return defaults;
	}

	const bodySemantropy = stored["bodySemantropy"];
	const dictionarySemantropy = stored["dictionarySemantropy"];
	// Only schema 2 and later have a collection path. A schema 1 payload that
	// carries one anyway is not a setting this plugin ever wrote, so it is not
	// adopted even when it looks valid — an unknown key must never become a
	// write target. The display fields are read the same way from schema 3.
	const collectionPath =
		schemaVersion >= SCHEMA_WITH_COLLECTION_PATH &&
		isCollectionPath(stored["collectionPath"])
			? stored["collectionPath"]
			: defaults.collectionPath;
	const display = schema3Display(
		schemaVersion === SEMANTROPY_SETTINGS_SCHEMA_VERSION
			? parseDisplaySettings(stored)
			: defaultSemantropyDisplaySettings(),
	);

	return {
		schemaVersion: SEMANTROPY_SETTINGS_SCHEMA_VERSION,
		bodySemantropy: isBodySemantropy(bodySemantropy)
			? bodySemantropy
			: defaults.bodySemantropy,
		dictionarySemantropy: isDictionarySemantropy(dictionarySemantropy)
			? dictionarySemantropy
			: defaults.dictionarySemantropy,
		collectionPath,
		...display,
	};
}

/** The exact object written to `data.json`; nothing else is persisted. */
export function serializeSemantropySettings(
	settings: SemantropySettings,
): StoredSemantropySettings {
	return {
		schemaVersion: SEMANTROPY_SETTINGS_SCHEMA_VERSION,
		bodySemantropy: settings.bodySemantropy,
		dictionarySemantropy: settings.dictionarySemantropy,
		collectionPath: settings.collectionPath,
		vocabularyDrawMode: settings.vocabularyDrawMode,
		bodyFontFamily: settings.bodyFontFamily,
		bodyFontSizePx: settings.bodyFontSizePx,
		bodyBackground: settings.bodyBackground,
		bodyForeground: settings.bodyForeground,
		showRuby: settings.showRuby,
		showReplacementMarkers: settings.showReplacementMarkers,
		showManualMarkers: settings.showManualMarkers,
		showDictionaryMarkers: settings.showDictionaryMarkers,
		dictionaryModifier: settings.dictionaryModifier,
	};
}
