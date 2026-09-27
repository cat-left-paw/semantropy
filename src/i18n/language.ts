/**
 * PRE-RELEASE-EXPERIENCE-LOCALE1: the interface language.
 *
 * A closed pair. The saved setting (`uiLanguage`, settings schema 5) holds one of
 * these values; a new install uses Japanese, and settings saved by schema 1-4
 * read as English (see `automaticPosSettings.ts`). Only fixed interface text
 * follows it: Source text, generated text, paths, IDs, provenance and Collect
 * bytes never do.
 *
 * The current language is plugin-wide, set by the plugin from the stored setting
 * before any View opens and again after a successful change. Until then it is
 * English, so a component built outside the plugin (a test, a harness) reads the
 * same English text it always has.
 */
export type UiLanguage = "en" | "ja";

export const UI_LANGUAGES: readonly UiLanguage[] = Object.freeze(["en", "ja"]);
export const DEFAULT_UI_LANGUAGE: UiLanguage = "ja";

export function isUiLanguage(value: unknown): value is UiLanguage {
	return value === "en" || value === "ja";
}

let current: UiLanguage = "en";

export function currentUiLanguage(): UiLanguage {
	return current;
}

/** Sets the language every later `ui()` / `localize()` call reads. Invalid input is ignored. */
export function setCurrentUiLanguage(language: UiLanguage): void {
	if (isUiLanguage(language)) current = language;
}
