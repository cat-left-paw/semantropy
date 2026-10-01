import type { AutomaticPosOptions } from "../transform/automaticPosOptions";
import { isBodySemantropy } from "./bodySemantropy";
import { isSelectableDictionarySemantropy } from "./dictionarySemantropy";
import { isCollectionPath } from "./collectionPath";
import { isBodyTheme, validateDisplaySettingsPatch, type BodyTheme } from "./displaySettings";
import { extraEnclosedTermDelimiters, type EnclosedTermDelimiter } from "../text/enclosedTermDelimiters";
import { defaultSemantropySettings, parseSemantropySettings, serializeSemantropySettings,
	type SemantropySettings, type StoredSemantropySettings } from "./semantropySettings";
import { settingsData } from "./settingsData";
import { DEFAULT_UI_LANGUAGE, isUiLanguage, type UiLanguage } from "../i18n/language";

/**
 * Current production persistence contract; schema 1–3 migrate through the legacy
 * field authority. Schema 5 added `uiLanguage`. Schema 6 adds `showRibbonIcon`.
 * PRE-RELEASE-COLLECT-ATTRIBUTION1: schema 7 adds `collectAttribution`. A new
 * install (no stored data) is Japanese with the ribbon on and every attribution
 * item off. Schema 1–4 read as English; schema 5–7 keep a valid `uiLanguage`
 * and fall back to Japanese on that field alone. Schema 1–5 read the ribbon as
 * on. A schema 6 or 7 ribbon value that is not a boolean falls back to on, on
 * that field alone. Schema 1–6 ignore any stored attribution and read every item
 * as off. A schema 7 attribution value that is not a boolean falls back to off,
 * on that item alone. Every other field is kept. 0.1.0 S2: schema 8 adds
 * `bodyTheme`; schema 1–7 read it as "default", and a schema 8 value that is not
 * a theme falls back to "default" on that field alone. Their stored body colours
 * are kept as the custom colours. 0.1.0 S4: schema 8 also holds
 * `enclosedTermDelimiters`, the extra enclosed-term pairs (the standard `{{` `}}`
 * is never stored and always on); schema 1–7 read none, and a stored list keeps
 * only its valid pairs.
 */
export const AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION = 8;
export const AUTOMATIC_POS_KEYS = Object.freeze(["noun", "verb", "iAdjective", "adverb"] as const);
export const DEFAULT_AUTOMATIC_POS: AutomaticPosOptions = Object.freeze({ noun: true, verb: false, iAdjective: false, adverb: false });
export const COLLECT_ATTRIBUTION_KEYS = Object.freeze(["feature", "target", "vocabulary", "semantropy", "date"] as const);
export type CollectAttributionKey = (typeof COLLECT_ATTRIBUTION_KEYS)[number];
export type CollectAttribution = Readonly<Record<CollectAttributionKey, boolean>>;
export const DEFAULT_COLLECT_ATTRIBUTION: CollectAttribution = Object.freeze({
	feature: false, target: false, vocabulary: false, semantropy: false, date: false,
});
export type AutomaticPosSettings = Readonly<Omit<SemantropySettings, "schemaVersion"> & {
	schemaVersion: typeof AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION;
	bodyTheme: BodyTheme;
	enclosedTermDelimiters: readonly EnclosedTermDelimiter[];
	automaticPos: AutomaticPosOptions;
	uiLanguage: UiLanguage;
	showRibbonIcon: boolean;
	collectAttribution: CollectAttribution;
}>;
export type StoredAutomaticPosSettings = Readonly<Omit<StoredSemantropySettings, "schemaVersion"> & {
	schemaVersion: typeof AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION;
	bodyTheme: BodyTheme;
	enclosedTermDelimiters: readonly EnclosedTermDelimiter[];
	automaticPos: AutomaticPosOptions;
	uiLanguage: UiLanguage;
	showRibbonIcon: boolean;
	collectAttribution: CollectAttribution;
}>;
export type AutomaticPosSettingsPatch = { -readonly [K in Exclude<keyof AutomaticPosSettings, "schemaVersion">]?: AutomaticPosSettings[K] };

export function parseAutomaticPosOptions(raw: unknown): AutomaticPosOptions {
	const data = settingsData(raw);
	const flag = (key: keyof AutomaticPosOptions) => typeof data?.[key] === "boolean" ? data[key] : DEFAULT_AUTOMATIC_POS[key];
	return Object.freeze({ noun: flag("noun"), verb: flag("verb"), iAdjective: flag("iAdjective"), adverb: flag("adverb") });
}

/** Requests are stricter than stored-data recovery: exactly four real booleans. */
export function validateAutomaticPosOptions(raw: unknown): AutomaticPosOptions | null {
	const data = settingsData(raw);
	if (!data || Object.keys(data).length !== 4 || AUTOMATIC_POS_KEYS.some(key => typeof data[key] !== "boolean")) return null;
	try { if (Reflect.ownKeys(raw as object).length !== 4) return null; } catch { return null; }
	return parseAutomaticPosOptions(data);
}

export function defaultAutomaticPosSettings(): AutomaticPosSettings {
	return Object.freeze({ ...defaultSemantropySettings(), schemaVersion: AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION,
		automaticPos: DEFAULT_AUTOMATIC_POS, uiLanguage: DEFAULT_UI_LANGUAGE, showRibbonIcon: true,
		collectAttribution: DEFAULT_COLLECT_ATTRIBUTION, bodyTheme: "default", enclosedTermDelimiters: Object.freeze([]) });
}

/** Schema 6 and later keep a real boolean. Every older schema, and a bad value, is on. */
function parseShowRibbonIcon(version: unknown, value: unknown): boolean {
	return (version === 6 || version === 7 || version === 8) && typeof value === "boolean" ? value : true;
}

/** Schema 8 keeps a valid theme. Every older schema, and a bad value, is "default". */
function parseBodyTheme(version: unknown, value: unknown): BodyTheme {
	return version === 8 && isBodyTheme(value) ? value : "default";
}

/** Schema 7 and later keep each real boolean. Anything else, including schema 1–6, is off for that item. */
export function parseCollectAttribution(version: unknown, value: unknown): CollectAttribution {
	if (version !== 7 && version !== 8) return DEFAULT_COLLECT_ATTRIBUTION;
	const data = settingsData(value);
	const flag = (key: CollectAttributionKey) => data?.[key] === true;
	return Object.freeze({
		feature: flag("feature"), target: flag("target"), vocabulary: flag("vocabulary"),
		semantropy: flag("semantropy"), date: flag("date"),
	});
}

/** Requests are stricter than stored-data recovery: exactly five real booleans. */
export function validateCollectAttribution(raw: unknown): CollectAttribution | null {
	const data = settingsData(raw);
	if (!data || Object.keys(data).length !== COLLECT_ATTRIBUTION_KEYS.length
		|| COLLECT_ATTRIBUTION_KEYS.some((key) => typeof data[key] !== "boolean")) return null;
	try { if (Reflect.ownKeys(raw as object).length !== COLLECT_ATTRIBUTION_KEYS.length) return null; }
	catch { return null; }
	return parseCollectAttribution(8, data);
}

export function parseAutomaticPosSettings(raw: unknown): AutomaticPosSettings {
	const data = settingsData(raw), version = data?.schemaVersion;
	if (!data || (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8)) return defaultAutomaticPosSettings();
	// Reuse schema 3's field authority on a copied plain-data envelope. Old
	// schemas still go through their own migration: future fields stay ignored.
	const legacy = parseSemantropySettings({ ...data, schemaVersion: version >= 4 ? 3 : version });
	return Object.freeze({ ...legacy, schemaVersion: AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION,
		automaticPos: version >= 4 ? parseAutomaticPosOptions(data.automaticPos) : DEFAULT_AUTOMATIC_POS,
		// Settings written before schema 5 kept an English interface. Schema 5–8 recover a bad value field by field.
		uiLanguage: version >= 5 ? (isUiLanguage(data.uiLanguage) ? data.uiLanguage : DEFAULT_UI_LANGUAGE) : "en",
		showRibbonIcon: parseShowRibbonIcon(version, data.showRibbonIcon),
		collectAttribution: parseCollectAttribution(version, data.collectAttribution),
		// Schema 3's reader takes whatever display keys it finds; only schema 8 wrote a theme.
		bodyTheme: parseBodyTheme(version, data.bodyTheme),
		enclosedTermDelimiters: extraEnclosedTermDelimiters(version === 8 ? data.enclosedTermDelimiters : null) });
}

/** Exact canonical persistence shape, including when a caller adds extra keys. */
export function serializeAutomaticPosSettings(settings: AutomaticPosSettings): StoredAutomaticPosSettings {
	const canonical = parseAutomaticPosSettings(settings);
	const legacy = serializeSemantropySettings({ ...canonical, schemaVersion: 3 });
	return Object.freeze({ ...legacy, schemaVersion: AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION,
		automaticPos: parseAutomaticPosOptions(canonical.automaticPos), uiLanguage: canonical.uiLanguage,
		showRibbonIcon: canonical.showRibbonIcon,
		collectAttribution: parseCollectAttribution(8, canonical.collectAttribution),
		bodyTheme: canonical.bodyTheme,
		enclosedTermDelimiters: Object.freeze(canonical.enclosedTermDelimiters.map((pair) => Object.freeze({ open: pair.open, close: pair.close }))) });
}

/** Validate before enqueue; retain only primitives and our frozen four flags. */
export function validateAutomaticPosSettingsPatch(raw: unknown): AutomaticPosSettingsPatch | null {
	const data = settingsData(raw);
	if (!data) return null;
	// Unlike recovery, request accessors and unknown fields must not disappear.
	try { if (Reflect.ownKeys(raw as object).length !== Object.keys(data).length) return null; }
	catch { return null; }
	const next: AutomaticPosSettingsPatch = {};
	for (const [key, value] of Object.entries(data)) {
		switch (key) {
			case "automaticPos": {
				const options = validateAutomaticPosOptions(value); if (!options) return null;
				next.automaticPos = options; break;
			}
			case "bodySemantropy": if (!isBodySemantropy(value)) return null; next.bodySemantropy = value; break;
			// A request may not set Off (DICTIONARY-LEVEL1); loading still accepts 0..100, so a saved Off is kept, not reset.
			case "dictionarySemantropy": if (!isSelectableDictionarySemantropy(value)) return null; next.dictionarySemantropy = value; break;
			case "collectionPath": if (!isCollectionPath(value)) return null; next.collectionPath = value; break;
			case "uiLanguage": if (!isUiLanguage(value)) return null; next.uiLanguage = value; break;
			case "showRibbonIcon": if (typeof value !== "boolean") return null; next.showRibbonIcon = value; break;
			case "collectAttribution": {
				const attribution = validateCollectAttribution(value); if (!attribution) return null;
				next.collectAttribution = attribution; break;
			}
			case "enclosedTermDelimiters": {
				// Every requested pair must survive recovery unchanged: nothing is dropped silently here.
				const pairs = extraEnclosedTermDelimiters(value);
				if (!Array.isArray(value) || pairs.length !== value.length) return null;
				next.enclosedTermDelimiters = pairs; break;
			}
			default: {
				const display = validateDisplaySettingsPatch({ [key]: value });
				if (!display) return null;
				Object.assign(next, display);
			}
		}
	}
	return Object.freeze(next);
}
