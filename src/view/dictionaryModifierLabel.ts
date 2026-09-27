import { ui } from "../i18n/catalog";

/**
 * PRE-RELEASE-EXPERIENCE-UI-POLISH1: the words for the saved modifier `"alt"`.
 *
 * macOS shows one label in both interface languages. Windows keeps "Alt".
 * The stored value stays `"alt"`. This does not choose KeyboardEvent.altKey
 * or the DOM key name `"Alt"`, which hover still uses.
 */
export const MAC_ALT_MODIFIER_LABEL = "Option（⌥）";

export function dictionaryAltLabel(mac: boolean): string {
	return mac ? MAC_ALT_MODIFIER_LABEL : ui().dictionary.alt;
}
