import type { VocabularyDrawMode } from "../vocabulary/vocabularySnapshot";

/**
 * The display half of settings schema 3.
 *
 * Every value here changes how the Target body is *shown*. None of them is a
 * generation input, with one deliberate exception: `vocabularyDrawMode` is the
 * draw policy of a Vocabulary Snapshot, so it is only ever persisted by a
 * successful explicit Apply, never by a draft change in the Toolbar.
 *
 * Nothing derived from a note belongs in this type: no Source selection, no
 * snapshot, no token, no pool, no Ruby map, no generation nonce, no manual
 * override and no selection cache.
 */

export type BodyFontFamily = "theme" | "serif" | "sans-serif";
/**
 * 0.1.0 S2: one theme for the body region — its text and background together.
 * "default" follows the host (Obsidian's theme; the web page's own). The two
 * custom colours below override it when set.
 */
export type BodyTheme = "default" | "light" | "dark";
export type DictionaryModifier = "alt" | "shift";

export type SemantropyDisplaySettings = {
	vocabularyDrawMode: VocabularyDrawMode;
	bodyFontFamily: BodyFontFamily;
	bodyFontSizePx: number | null;
	bodyTheme: BodyTheme;
	/** Custom background of the body region, `#rrggbb`, or null for the theme's. */
	bodyBackground: string | null;
	/** Custom text colour of the body region, `#rrggbb`, or null for the theme's. */
	bodyForeground: string | null;
	showRuby: boolean;
	showReplacementMarkers: boolean;
	showManualMarkers: boolean;
	showDictionaryMarkers: boolean;
	dictionaryModifier: DictionaryModifier;
};

/** Provisional evaluation range; step 1. Confirmed on hardware, not guessed here. */
export const BODY_FONT_SIZE_MIN_PX = 12;
export const BODY_FONT_SIZE_MAX_PX = 32;

/**
 * System fallbacks only. No font asset is added to the distribution, and the
 * generic family always terminates the stack so an absent face still renders.
 */
export const BODY_FONT_STACKS: Readonly<Record<BodyFontFamily, string | null>> =
	Object.freeze({
		theme: null,
		serif:
			'"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "MS PMincho", serif',
		"sans-serif":
			'"Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, Meiryo, sans-serif',
	});

/** Verified presets, offered alongside a `#RRGGBB` custom value and Reset. */
export const BODY_BACKGROUND_PRESETS: readonly string[] = Object.freeze([
	"#fdfaf3",
	"#f2f0e8",
	"#e8eef2",
	"#1c1c1e",
	"#12161b",
]);

export const BODY_FOREGROUND_PRESETS: readonly string[] = Object.freeze([
	"#1a1a1a",
	"#33302a",
	"#2a3440",
	"#e8e6e3",
	"#c8d0d8",
]);

export function defaultSemantropyDisplaySettings(): SemantropyDisplaySettings {
	return {
		vocabularyDrawMode: "uniform",
		bodyFontFamily: "theme",
		bodyFontSizePx: null,
		bodyTheme: "default",
		bodyBackground: null,
		bodyForeground: null,
		showRuby: true,
		showReplacementMarkers: true,
		showManualMarkers: true,
		showDictionaryMarkers: true,
		dictionaryModifier: "alt",
	};
}

export function isVocabularyDrawMode(value: unknown): value is VocabularyDrawMode {
	return value === "uniform" || value === "frequency";
}

export function isBodyFontFamily(value: unknown): value is BodyFontFamily {
	return (
		value === "theme" || value === "serif" || value === "sans-serif"
	);
}

/**
 * 0.1.0 S2: the Light and Dark palettes of the preview region, as the theme
 * variables the body and its markers read. The View sets them on the preview
 * element only; the Toolbar and the rest of the host keep the host's theme.
 */
export const BODY_THEME_PALETTES: Readonly<Record<Exclude<BodyTheme, "default">, Readonly<Record<string, string>>>> = Object.freeze({
	light: Object.freeze({
		"color-scheme": "light",
		"--background-primary": "#fbfaf7",
		"--background-secondary": "#f0eee8",
		"--background-modifier-border": "#dedad0",
		"--code-background": "#f0eee8",
		"--text-normal": "#1f1e1c",
		"--text-muted": "#625e55",
		"--text-faint": "#9a958a",
		"--text-accent": "#6a44d4",
		"--interactive-accent": "#7a52e0",
		"--text-highlight-bg": "rgba(255, 196, 0, 0.42)",
	}),
	dark: Object.freeze({
		"color-scheme": "dark",
		"--background-primary": "#1c1c20",
		"--background-secondary": "#26262b",
		"--background-modifier-border": "#3a3942",
		"--code-background": "#26262b",
		"--text-normal": "#e4e2dd",
		"--text-muted": "#a9a59c",
		"--text-faint": "#6f6c66",
		"--text-accent": "#b49cff",
		"--interactive-accent": "#8a66f0",
		"--text-highlight-bg": "rgba(255, 208, 0, 0.3)",
	}),
});

export function isBodyTheme(value: unknown): value is BodyTheme {
	return value === "default" || value === "light" || value === "dark";
}

export function isDictionaryModifier(value: unknown): value is DictionaryModifier {
	return value === "alt" || value === "shift";
}

/** `null` is the theme default; anything else must be an in-range integer. */
export function isBodyFontSizePx(value: unknown): value is number | null {
	return (
		value === null ||
		(typeof value === "number" &&
			Number.isInteger(value) &&
			value >= BODY_FONT_SIZE_MIN_PX &&
			value <= BODY_FONT_SIZE_MAX_PX)
	);
}

/**
 * Normalizes a colour to lower-case `#rrggbb`, or `null` for the theme
 * default. A three-digit shorthand is expanded; everything else — a named
 * colour, a function, a gradient, a CSS variable — is refused, so nothing a
 * note or a corrupted file carries can become a style value.
 */
export function normalizeBodyColor(value: unknown): string | null | undefined {
	if (value === null) {
		return null;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (/^#[0-9a-fA-F]{6}$/u.test(trimmed)) {
		return trimmed.toLowerCase();
	}
	if (/^#[0-9a-fA-F]{3}$/u.test(trimmed)) {
		const [r, g, b] = trimmed.slice(1).toLowerCase();
		return `#${r}${r}${g}${g}${b}${b}`;
	}
	return undefined;
}

/** WCAG relative luminance of a normalized `#rrggbb` value. */
function relativeLuminance(color: string): number {
	const channels = [1, 3, 5].map((index) => {
		const value = Number.parseInt(color.slice(index, index + 2), 16) / 255;
		return value <= 0.03928
			? value / 12.92
			: ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function contrastRatio(foreground: string, background: string): number {
	const a = relativeLuminance(foreground);
	const b = relativeLuminance(background);
	const [light, dark] = a >= b ? [a, b] : [b, a];
	return (light + 0.05) / (dark + 0.05);
}

/** The lowest ratio that keeps body text and its markers legible. */
export const BODY_CONTRAST_MINIMUM = 4.5;

/** Fixed string. It never names a colour value, a note or a path. */
export const BODY_CONTRAST_WARNING =
	"The chosen body colours have low contrast. Text and markers may be hard to read.";

/**
 * Warns only when both colours are explicit: with one side left at the theme
 * default the effective pair depends on the active theme, and guessing it
 * would produce a warning the reader cannot act on.
 */
export function bodyContrastWarning(
	settings: Pick<SemantropyDisplaySettings, "bodyBackground" | "bodyForeground">,
): string | null {
	const { bodyBackground: background, bodyForeground: foreground } = settings;
	if (background === null || foreground === null) {
		return null;
	}
	return contrastRatio(foreground, background) < BODY_CONTRAST_MINIMUM
		? BODY_CONTRAST_WARNING
		: null;
}

/**
 * Reads one stored display payload field by field. An invalid value falls back
 * to its own default and never discards a sibling that is still valid.
 */
export function parseDisplaySettings(
	stored: Record<string, unknown>,
): SemantropyDisplaySettings {
	const defaults = defaultSemantropyDisplaySettings();
	const background = normalizeBodyColor(stored["bodyBackground"]);
	const foreground = normalizeBodyColor(stored["bodyForeground"]);
	const flag = (
		key: "showRuby" | "showReplacementMarkers" | "showManualMarkers" | "showDictionaryMarkers",
	): boolean =>
		typeof stored[key] === "boolean" ? stored[key] : defaults[key];
	return {
		vocabularyDrawMode: isVocabularyDrawMode(stored["vocabularyDrawMode"])
			? stored["vocabularyDrawMode"]
			: defaults.vocabularyDrawMode,
		bodyFontFamily: isBodyFontFamily(stored["bodyFontFamily"])
			? stored["bodyFontFamily"]
			: defaults.bodyFontFamily,
		bodyFontSizePx: isBodyFontSizePx(stored["bodyFontSizePx"])
			? stored["bodyFontSizePx"]
			: defaults.bodyFontSizePx,
		bodyTheme: isBodyTheme(stored["bodyTheme"]) ? stored["bodyTheme"] : defaults.bodyTheme,
		bodyBackground: background === undefined ? defaults.bodyBackground : background,
		bodyForeground: foreground === undefined ? defaults.bodyForeground : foreground,
		showRuby: flag("showRuby"),
		showReplacementMarkers: flag("showReplacementMarkers"),
		showManualMarkers: flag("showManualMarkers"),
		showDictionaryMarkers: flag("showDictionaryMarkers"),
		dictionaryModifier: isDictionaryModifier(stored["dictionaryModifier"])
			? stored["dictionaryModifier"]
			: defaults.dictionaryModifier,
	};
}

/**
 * Validates a caller-supplied change. An invalid field is refused outright
 * rather than corrected: a silently adjusted colour or size is a setting the
 * user never chose.
 */
export function validateDisplaySettingsPatch(
	patch: Partial<SemantropyDisplaySettings>,
): Partial<SemantropyDisplaySettings> | null {
	const next: Partial<SemantropyDisplaySettings> = {};
	for (const [key, value] of Object.entries(patch) as [
		keyof SemantropyDisplaySettings,
		unknown,
	][]) {
		switch (key) {
			case "vocabularyDrawMode":
				if (!isVocabularyDrawMode(value)) return null;
				next.vocabularyDrawMode = value;
				break;
			case "bodyFontFamily":
				if (!isBodyFontFamily(value)) return null;
				next.bodyFontFamily = value;
				break;
			case "bodyFontSizePx":
				if (!isBodyFontSizePx(value)) return null;
				next.bodyFontSizePx = value;
				break;
			case "bodyTheme":
				if (!isBodyTheme(value)) return null;
				next.bodyTheme = value;
				break;
			case "bodyBackground":
			case "bodyForeground": {
				const color = normalizeBodyColor(value);
				if (color === undefined) return null;
				next[key] = color;
				break;
			}
			case "showRuby":
			case "showReplacementMarkers":
			case "showManualMarkers":
			case "showDictionaryMarkers":
				if (typeof value !== "boolean") return null;
				next[key] = value;
				break;
			case "dictionaryModifier":
				if (!isDictionaryModifier(value)) return null;
				next.dictionaryModifier = value;
				break;
			default:
				// An unknown key is never carried to the writer.
				return null;
		}
	}
	return next;
}
