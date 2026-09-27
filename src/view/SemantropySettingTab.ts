import {
	PluginSettingTab,
	Setting,
	SettingGroup,
	type App,
	type ButtonComponent,
	type DropdownComponent,
	type Plugin,
	type SettingDefinitionItem,
	type SettingDefinitionRender,
	type TextComponent,
	type ToggleComponent,
} from "obsidian";
import {
	runSaveCollectionPathGuarded,
	type SaveCollectionPathOutcome,
} from "../application/saveCollectionPath";
import { DEFAULT_COLLECTION_PATH } from "../settings/collectionPath";
import { BusyGate } from "./busyGate";
import {
	toCollectionPathSettingsViewModel,
	type CollectionPathSettingsStatus,
} from "./collectionPathSettingsViewModel";
import { EN_MESSAGES, ui } from "../i18n/catalog";
import { localize } from "../i18n/messages";
import { isUiLanguage, type UiLanguage } from "../i18n/language";
import { COLLECT_ATTRIBUTION_KEYS, type CollectAttribution, type CollectAttributionKey } from "../settings/automaticPosSettings";

export type SemantropySettingTabHost = {
	getCollectionPath: () => string;
	setCollectionPath: (value: string) => Promise<boolean>;
	/** LOCALE1: the saved interface language. */
	getUiLanguage: () => UiLanguage;
	/** Saves it; the host applies the stored value to every View and this tab. */
	setUiLanguage: (value: UiLanguage) => Promise<boolean>;
	/** UI-POLISH1: whether the ribbon icon is shown. Default is on. */
	getShowRibbonIcon: () => boolean;
	/** Saves it; the host shows whatever the store then holds. */
	setShowRibbonIcon: (value: boolean) => Promise<boolean>;
	/** COLLECT-ATTRIBUTION1: which readable lines a new Collection entry includes. Default is all off. */
	getCollectAttribution: () => CollectAttribution;
	/** Saves one item; the host keeps whatever the store then holds. */
	setCollectAttribution: (key: CollectAttributionKey, value: boolean) => Promise<boolean>;
};

/** Indexed by Obsidian 1.13+ settings search. English identities; shown in the current language. */
export const COLLECTION_FILE_SETTING_NAME = EN_MESSAGES.settings.collectionName;
export const COLLECTION_FILE_SETTING_DESC = EN_MESSAGES.settings.collectionDescription;
export const UI_LANGUAGE_SETTING_NAME = EN_MESSAGES.settings.languageName;
export const RIBBON_ICON_SETTING_NAME = EN_MESSAGES.settings.ribbonName;
export const RIBBON_ICON_SETTING_DESC = EN_MESSAGES.settings.ribbonDescription;

/** Each language is named in itself, so a reader can find their own whichever is shown. */
const LANGUAGE_NAMES: readonly (readonly [UiLanguage, string])[] = [["ja", "日本語"], ["en", "English"]];

/**
 * The plugin's Settings tab. It owns one Collection path row: a text field
 * and an explicit Save. Drafts live only while this instance is displayed.
 *
 * It never reads or writes a Vault file. Collect creates the Markdown note
 * later, on an explicit Collect. Body and Dictionary Semantropy values are
 * not shown here.
 */
export class SemantropySettingTab extends PluginSettingTab {
	private readonly busy = new BusyGate();
	private generation = 0;
	private draft = "";
	private effective = "";
	private status: CollectionPathSettingsStatus = "idle";
	private pathInput: TextComponent | null = null;
	private saveButton: ButtonComponent | null = null;
	private statusEl: HTMLElement | null = null;
	private collectionSetting: Setting | null = null;
	private languageSetting: Setting | null = null;
	private languageDropdown: DropdownComponent | null = null;
	private languageStatusEl: HTMLElement | null = null;
	private languageFailed = false;
	private languageGeneration = 0;
	private ribbonSetting: Setting | null = null;
	private ribbonToggle: ToggleComponent | null = null;
	private ribbonStatusEl: HTMLElement | null = null;
	private ribbonFailed = false;
	private ribbonGeneration = 0;
	private attributionGroup: SettingGroup | null = null;
	private attributionGeneration = 0;
	private readonly attribution = new Map<CollectAttributionKey, {
		setting: Setting;
		toggle: ToggleComponent;
		statusEl: HTMLElement;
		failed: boolean;
		generation: number;
	}>();

	constructor(
		app: App,
		plugin: Plugin,
		private readonly host: SemantropySettingTabHost,
	) {
		super(app, plugin);
	}

	/**
	 * Registers Collection file for settings search. The row itself is still
	 * an explicit Save: a `SettingDefinitionRender` keeps the Text component
	 * and the Save button, and does not persist on each keystroke.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: ui().settings.languageName,
				desc: ui().settings.languageDescription,
				render: (setting, group) => this.renderLanguage(setting, group),
			},
			{
				name: ui().settings.ribbonName,
				desc: ui().settings.ribbonDescription,
				render: (setting, group) => this.renderRibbon(setting, group),
			},
			{
				name: ui().settings.collectionName,
				desc: ui().settings.collectionDescription,
				render: (setting, group) => this.renderCollectionPath(setting, group),
			},
			{
				type: "group",
				heading: ui().settings.attributionGroupName,
				cls: "semantropy-attribution-group",
				items: COLLECT_ATTRIBUTION_KEYS.map((key) => ({
					name: attributionName(key),
					desc: attributionDescription(key),
					render: (setting: Setting, group: SettingGroup) => this.renderAttribution(key, setting, group),
				})),
			},
		];
	}

	/**
	 * Rebuilds the tab from the current saved path. Tests and the artifact
	 * harness call this; Obsidian 1.13 renders `getSettingDefinitions()`
	 * instead of `display()`.
	 */
	show(): void {
		this.containerEl.empty();
		for (const item of this.getSettingDefinitions()) {
			if ("type" in item && item.type === "group") {
				const groupRoot = this.containerEl.createDiv({ cls: item.cls });
				const group = new SettingGroup(groupRoot);
				group.setHeading(item.heading ?? "");
				for (const child of item.items ?? []) {
					if (!hasRender(child)) continue;
					const setting = new Setting(group.listEl);
					setting.setName(child.name);
					if (typeof child.desc === "string") setting.setDesc(child.desc);
					child.render(setting, group);
				}
				continue;
			}
			if (!hasRender(item)) {
				continue;
			}
			const setting = new Setting(this.containerEl);
			setting.setName(item.name);
			if (typeof item.desc === "string") {
				setting.setDesc(item.desc);
			}
			item.render(setting, new SettingGroup(this.containerEl));
		}
	}

	/**
	 * LOCALE1: re-words the rows on screen in the current language. The typed
	 * Collection path draft, its status and focus stay.
	 */
	relabel(): void {
		const t = ui().settings;
		this.languageSetting?.setName(t.languageName).setDesc(t.languageDescription);
		this.ribbonSetting?.setName(t.ribbonName).setDesc(t.ribbonDescription);
		this.attributionGroup?.setHeading(t.attributionGroupName);
		for (const key of COLLECT_ATTRIBUTION_KEYS) {
			const row = this.attribution.get(key);
			row?.setting.setName(attributionName(key)).setDesc(attributionDescription(key));
			row?.toggle.setValue(this.host.getCollectAttribution()[key]);
		}
		this.collectionSetting?.setName(t.collectionName).setDesc(t.collectionDescription);
		this.saveButton?.setButtonText(t.save);
		this.languageDropdown?.setValue(this.host.getUiLanguage());
		this.ribbonToggle?.setValue(this.host.getShowRibbonIcon());
		this.syncLanguageStatus();
		this.syncRibbonStatus();
		for (const key of COLLECT_ATTRIBUTION_KEYS) this.syncAttributionStatus(key);
		this.syncStatus();
	}

	hide(): void {
		this.beginGeneration();
		this.languageGeneration += 1;
		this.ribbonGeneration += 1;
		this.pathInput = null;
		this.saveButton = null;
		this.statusEl = null;
		this.collectionSetting = this.languageSetting = this.ribbonSetting = null;
		this.languageDropdown = null;
		this.languageStatusEl = null;
		this.ribbonToggle = null;
		this.ribbonStatusEl = null;
		this.attributionGroup = null;
		this.attributionGeneration += 1;
		this.attribution.clear();
		this.containerEl.empty();
		super.hide();
	}

	/**
	 * The single entry point for the Save button. The typed string is captured
	 * before the first await, then validated, then persisted at most once.
	 */
	async saveCollectionPath(): Promise<SaveCollectionPathOutcome> {
		const generation = this.generation;
		const captured = this.pathInput?.getValue() ?? this.draft;
		this.draft = captured;
		const outcome = await runSaveCollectionPathGuarded({
			draft: captured,
			persist: (value) => this.host.setCollectionPath(value),
			isAbandoned: () => this.generation !== generation,
			busy: {
				acquire: () => {
					const token = this.busy.acquire();
					this.syncControls();
					return token;
				},
				release: (token) => {
					this.busy.release(token);
					if (this.generation === generation) {
						this.syncControls();
					}
				},
			},
		});
		if (this.generation !== generation) {
			return outcome;
		}
		const currentDraft = this.pathInput?.getValue() ?? this.draft;
		this.draft = currentDraft;
		if (outcome === "invalid") {
			this.status = currentDraft === captured ? "invalid" : "idle";
		} else if (outcome === "saved") {
			this.effective = captured;
			this.status = currentDraft === captured ? "saved" : "idle";
		} else if (outcome === "failed") {
			console.error("[Semantropy] failed to save the Collection file path");
			this.status = currentDraft === captured ? "failed" : "idle";
		}
		this.syncStatus();
		this.syncControls();
		return outcome;
	}

	private prepareDisplay(): void {
		this.beginGeneration();
		this.effective = this.host.getCollectionPath();
		this.draft = this.effective;
		this.status = "idle";
	}

	private beginGeneration(): void {
		this.generation += 1;
		this.busy.revoke();
	}

	/**
	 * The language row. A change is saved at once, like any Obsidian dropdown;
	 * the host then applies whatever the store holds, so a failed save keeps the
	 * previous language on screen and the dropdown returns to it.
	 */
	async changeUiLanguage(value: string): Promise<boolean> {
		if (!isUiLanguage(value)) {
			this.languageDropdown?.setValue(this.host.getUiLanguage());
			return false;
		}
		const generation = this.languageGeneration;
		let saved = false;
		try { saved = await this.host.setUiLanguage(value); }
		catch { /* A failed queue repair is a save failure for this control. */ }
		if (this.languageGeneration !== generation) return saved;
		if (!saved) console.error("[Semantropy] failed to save the interface language");
		this.languageFailed = !saved;
		this.languageDropdown?.setValue(this.host.getUiLanguage());
		this.syncLanguageStatus();
		return saved;
	}

	private renderLanguage(setting: Setting, group: SettingGroup): () => void {
		this.languageGeneration += 1;
		this.languageSetting = setting;
		this.languageFailed = false;
		setting.setClass("semantropy-language-setting");
		setting.addDropdown((dropdown) => {
			this.languageDropdown = dropdown;
			for (const [value, name] of LANGUAGE_NAMES) dropdown.addOption(value, name);
			dropdown.setValue(this.host.getUiLanguage());
			dropdown.onChange((value) => {
				void this.changeUiLanguage(value);
			});
		});
		this.languageStatusEl = group.listEl.createDiv({ cls: "semantropy-language-status" });
		this.syncLanguageStatus();
		return () => {
			this.languageSetting = null;
			this.languageDropdown = null;
			this.languageStatusEl = null;
		};
	}

	private syncLanguageStatus(): void {
		this.languageStatusEl?.setText(this.languageFailed ? ui().settings.languageSaveFailed : "");
	}

	/**
	 * The ribbon row. The toggle moves as the reader clicks; a failed save puts
	 * it back, and the host puts the ribbon back to the stored value.
	 */
	async changeShowRibbonIcon(value: boolean): Promise<boolean> {
		const generation = this.ribbonGeneration;
		let saved = false;
		try { saved = await this.host.setShowRibbonIcon(value); }
		catch { /* A failed queue repair is a save failure for this control. */ }
		if (this.ribbonGeneration !== generation) return saved;
		if (!saved) console.error("[Semantropy] failed to save the ribbon icon setting");
		this.ribbonFailed = !saved;
		this.ribbonToggle?.setValue(this.host.getShowRibbonIcon());
		this.syncRibbonStatus();
		return saved;
	}

	private renderRibbon(setting: Setting, group: SettingGroup): () => void {
		this.ribbonGeneration += 1;
		this.ribbonSetting = setting;
		this.ribbonFailed = false;
		setting.setClass("semantropy-ribbon-setting");
		setting.addToggle((toggle) => {
			this.ribbonToggle = toggle;
			toggle.setValue(this.host.getShowRibbonIcon());
			toggle.onChange((value) => { void this.changeShowRibbonIcon(value); });
		});
		this.ribbonStatusEl = group.listEl.createDiv({ cls: "semantropy-ribbon-status" });
		this.syncRibbonStatus();
		return () => {
			this.ribbonSetting = null;
			this.ribbonToggle = null;
			this.ribbonStatusEl = null;
		};
	}

	private syncRibbonStatus(): void {
		this.ribbonStatusEl?.setText(this.ribbonFailed ? ui().settings.ribbonSaveFailed : "");
	}

	/**
	 * One attribution row. The toggle moves as the reader clicks; a failed save
	 * puts it back. The label is re-worded in place, so focus and scroll stay.
	 */
	async changeCollectAttribution(key: CollectAttributionKey, value: boolean): Promise<boolean> {
		const row = this.attribution.get(key);
		const generation = row?.generation ?? 0;
		let saved = false;
		try { saved = await this.host.setCollectAttribution(key, value); }
		catch { /* A failed queue repair is a save failure for this control. */ }
		const current = this.attribution.get(key);
		if (!current || current.generation !== generation) return saved;
		if (!saved) console.error("[Semantropy] failed to save a Collection attribution setting");
		current.failed = !saved;
		current.toggle.setValue(this.host.getCollectAttribution()[key]);
		this.syncAttributionStatus(key);
		return saved;
	}

	private renderAttribution(key: CollectAttributionKey, setting: Setting, group: SettingGroup): () => void {
		const generation = ++this.attributionGeneration;
		this.attributionGroup = group;
		setting.setClass("semantropy-attribution-setting");
		let toggle!: ToggleComponent;
		setting.addToggle((component) => {
			toggle = component;
			toggle.setValue(this.host.getCollectAttribution()[key]);
			toggle.onChange((value) => { void this.changeCollectAttribution(key, value); });
		});
		const statusEl = group.listEl.createDiv({ cls: "semantropy-attribution-status" });
		this.attribution.set(key, { setting, toggle, statusEl, failed: false, generation });
		this.syncAttributionStatus(key);
		return () => {
			this.attribution.delete(key);
		};
	}

	private syncAttributionStatus(key: CollectAttributionKey): void {
		const row = this.attribution.get(key);
		row?.statusEl.setText(row.failed ? ui().settings.attributionSaveFailed : "");
	}

	private renderCollectionPath(
		setting: Setting,
		group: SettingGroup,
	): () => void {
		this.prepareDisplay();
		this.pathInput = null;
		this.saveButton = null;
		this.statusEl = null;
		this.collectionSetting = setting;

		setting.setClass("semantropy-collection-path-setting");
		setting.addText((text) => {
			this.pathInput = text;
			text.setPlaceholder(DEFAULT_COLLECTION_PATH);
			text.setValue(this.draft);
			text.onChange((value) => {
				this.draft = value;
				this.status = "idle";
				this.syncStatus();
			});
		});
		setting.addButton((button) => {
			this.saveButton = button;
			button.setClass("semantropy-collection-path-save");
			button.setButtonText(ui().settings.save);
			button.setCta();
			button.onClick(() => {
				void this.saveCollectionPath();
			});
		});

		this.statusEl = group.listEl.createDiv({
			cls: "semantropy-settings-status",
		});
		this.syncStatus();
		this.syncControls();
		return () => {
			this.pathInput = null;
			this.saveButton = null;
			this.statusEl = null;
			this.collectionSetting = null;
		};
	}

	private toModel() {
		return toCollectionPathSettingsViewModel({
			draft: this.draft,
			effective: this.effective,
			busy: this.busy.isBusy(),
			status: this.status,
		});
	}

	private syncControls(): void {
		const model = this.toModel();
		this.saveButton?.setDisabled(!model.saveEnabled);
	}

	private syncStatus(): void {
		const model = this.toModel();
		if (!this.statusEl) {
			return;
		}
		this.statusEl.setText(localize(model.message ?? ""));
	}
}

function hasRender(item: SettingDefinitionItem): item is SettingDefinitionRender {
	return "render" in item && typeof item.render === "function";
}

function attributionDescription(key: CollectAttributionKey): string {
	const settings = ui().settings;
	switch (key) {
		case "feature": return settings.attributionFeatureDescription;
		case "target": return settings.attributionTargetDescription;
		case "vocabulary": return settings.attributionVocabularyDescription;
		case "semantropy": return settings.attributionSemantropyDescription;
		case "date": return settings.attributionDateDescription;
	}
}

function attributionName(key: CollectAttributionKey): string {
	const settings = ui().settings;
	switch (key) {
		case "feature": return settings.attributionFeatureName;
		case "target": return settings.attributionTargetName;
		case "vocabulary": return settings.attributionVocabularyName;
		case "semantropy": return settings.attributionSemantropyName;
		case "date": return settings.attributionDateName;
	}
}
