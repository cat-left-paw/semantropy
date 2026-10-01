// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import {
	AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION,
	defaultAutomaticPosSettings,
	parseAutomaticPosSettings,
	serializeAutomaticPosSettings,
	validateAutomaticPosSettingsPatch,
} from "../src/settings/automaticPosSettings";
import { BODY_THEME_PALETTES, defaultSemantropyDisplaySettings, type SemantropyDisplaySettings } from "../src/settings/displaySettings";
import { parseSemantropySettings, serializeSemantropySettings } from "../src/settings/semantropySettings";

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => document.body.replaceChildren());

describe("0.1.0 S2 settings schema 8 `bodyTheme`", () => {
	it("is schema 8, a new install uses the host theme, and schema 3 never stores a theme", () => {
		expect(AUTOMATIC_POS_SETTINGS_SCHEMA_VERSION).toBe(8);
		expect(defaultAutomaticPosSettings().bodyTheme).toBe("default");
		expect(serializeSemantropySettings(parseSemantropySettings({ schemaVersion: 3, bodyTheme: "dark" }))).not.toHaveProperty("bodyTheme");
	});

	it("reads schema 1–7 as the host theme and keeps their body colours as the custom colours", () => {
		for (const schemaVersion of [3, 4, 5, 6, 7]) {
			const parsed = parseAutomaticPosSettings({ schemaVersion, bodyBackground: "#112233", bodyForeground: "#eeeeee", bodyTheme: "dark" });
			expect(parsed.bodyTheme).toBe("default");
			expect([parsed.bodyBackground, parsed.bodyForeground]).toEqual(["#112233", "#eeeeee"]);
		}
	});

	it("keeps a schema 8 theme, and repairs only a bad value on that field", () => {
		const dark = parseAutomaticPosSettings({ schemaVersion: 8, bodyTheme: "dark", bodySemantropy: 75 });
		expect([dark.bodyTheme, dark.bodySemantropy]).toEqual(["dark", 75]);
		expect(parseAutomaticPosSettings(serializeAutomaticPosSettings(dark)).bodyTheme).toBe("dark");
		for (const bad of ["sepia", 1, null, true, {}]) {
			const parsed = parseAutomaticPosSettings({ schemaVersion: 8, bodyTheme: bad, bodySemantropy: 75 });
			expect([parsed.bodyTheme, parsed.bodySemantropy]).toEqual(["default", 75]);
		}
	});

	it("accepts only the three themes in a request", () => {
		expect(validateAutomaticPosSettingsPatch({ bodyTheme: "light" })).toEqual({ bodyTheme: "light" });
		for (const bad of ["sepia", "", null, 0]) expect(validateAutomaticPosSettingsPatch({ bodyTheme: bad })).toBeNull();
	});
});

const LEXICON = [token({ surface: "猫" }), token({ surface: "犬" }), token({ surface: "と", pos: "助詞", detail1: "並立助詞" })];

async function openedView(display: Partial<SemantropyDisplaySettings>) {
	const h = manualMorphHarness(lexiconTokenizer(LEXICON));
	let settings: SemantropyDisplaySettings = { ...defaultSemantropyDisplaySettings(), ...display };
	h.host.getDisplaySettings = () => settings;
	h.host.setDisplaySettings = async (patch) => { settings = { ...settings, ...patch }; return true; };
	await h.open("猫と犬。\n");
	const scroll = h.peek.contentEl.querySelector<HTMLElement>(".semantropy-scroll")!;
	return { h, scroll, set: (next: Partial<SemantropyDisplaySettings>) => { settings = { ...settings, ...next }; } };
}

describe("0.1.0 S2 the preview region's theme", () => {
	it("sets the Dark palette and class on the preview only, and clears both for the host theme", async () => {
		const { h, scroll, set } = await openedView({ bodyTheme: "dark" });
		expect(scroll.classList.contains("semantropy-theme-dark")).toBe(true);
		expect(scroll.style.getPropertyValue("--background-primary")).toBe(BODY_THEME_PALETTES.dark["--background-primary"]);
		expect(scroll.style.getPropertyValue("--text-normal")).toBe(BODY_THEME_PALETTES.dark["--text-normal"]);
		// The Toolbar keeps the host theme.
		expect(h.peek.contentEl.querySelector<HTMLElement>(".semantropy-toolbar")!.style.getPropertyValue("--background-primary")).toBe("");
		set({ bodyTheme: "default" });
		await h.view.applyStoredDisplaySettings();
		expect(scroll.classList.contains("semantropy-theme-dark")).toBe(false);
		expect(scroll.style.getPropertyValue("--background-primary")).toBe("");
	});

	it("lets the custom colours win over the theme on the same element", async () => {
		const { scroll } = await openedView({ bodyTheme: "light", bodyBackground: "#102030", bodyForeground: "#f0f0f0" });
		expect(scroll.classList.contains("semantropy-theme-light")).toBe(true);
		expect(scroll.style.backgroundColor).toBe("rgb(16, 32, 48)");
		expect(scroll.style.color).toBe("rgb(240, 240, 240)");
		expect(scroll.querySelector<HTMLElement>(".semantropy-body")!.style.backgroundColor).toBe("");
	});

	it("sets and clears the same variables for Light and Dark (review P3)", () => {
		expect(Object.keys(BODY_THEME_PALETTES.dark).sort()).toEqual(Object.keys(BODY_THEME_PALETTES.light).sort());
	});

	it("offers the three themes, and colours as the theme's or custom only", async () => {
		const { h } = await openedView({});
		const theme = h.peek.contentEl.querySelector<HTMLSelectElement>("select.semantropy-body-theme")!;
		expect(Array.from(theme.options, (option) => option.value)).toEqual(["default", "light", "dark"]);
		for (const key of ["bodyForeground", "bodyBackground"]) {
			const select = h.peek.contentEl.querySelector<HTMLSelectElement>(`select.semantropy-color-${key}`)!;
			expect(Array.from(select.options, (option) => option.value)).toEqual(["", "custom"]);
		}
	});
});
