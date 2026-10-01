import { defaultAutomaticPosSettings, parseAutomaticPosSettings, serializeAutomaticPosSettings,
	validateAutomaticPosSettingsPatch, type AutomaticPosSettings, type CollectAttributionKey,
	type StoredAutomaticPosSettings } from "./automaticPosSettings";
import type { BodySemantropy } from "./bodySemantropy";
import { supportedDictionarySemantropy, type DictionarySemantropy } from "./dictionarySemantropy";
import { parseDisplaySettings, type SemantropyDisplaySettings } from "./displaySettings";
import type { UiLanguage } from "../i18n/language";
import type { EnclosedTermDelimiter } from "../text/enclosedTermDelimiters";

export type SettingsPublication = {
	current(): boolean;
	publish(): void;
	commit(): void;
	rollback(): void;
};

export type AutomaticPosSettingsPersistence = {
	load(): Promise<unknown>;
	save(data: StoredAutomaticPosSettings): Promise<void>;
};
/** Plugin-owned schema 7 persistence. Option commits use transact with the
 * all-View coordinator; ordinary display/path/language/ribbon/attribution fields use the same persistence queue. */
export class AutomaticPosSettingsStore {
	private settings = defaultAutomaticPosSettings();
	constructor(private readonly persistence: AutomaticPosSettingsPersistence,
		private readonly queue: { pending: Promise<unknown>; recovery?: StoredAutomaticPosSettings | null } = { pending: Promise.resolve() }) {}
	getSettings(): AutomaticPosSettings { return this.settings; }
	getBodySemantropy(): BodySemantropy { return this.settings.bodySemantropy; }
	/** A saved Off (or any unselectable value) reads as the default level; nothing is rewritten. */
	getDictionarySemantropy(): DictionarySemantropy { return supportedDictionarySemantropy(this.settings.dictionarySemantropy); }
	getCollectionPath(): string { return this.settings.collectionPath; }
	getUiLanguage(): UiLanguage { return this.settings.uiLanguage; }
	setUiLanguage(uiLanguage: UiLanguage) { return this.update({ uiLanguage }); }
	getShowRibbonIcon(): boolean { return this.settings.showRibbonIcon; }
	/** 0.1.0 S4: the extra enclosed-term delimiter pairs. */
	getEnclosedTermDelimiters(): readonly EnclosedTermDelimiter[] { return this.settings.enclosedTermDelimiters; }
	setEnclosedTermDelimiters(enclosedTermDelimiters: readonly EnclosedTermDelimiter[]) { return this.update({ enclosedTermDelimiters }); }
	setShowRibbonIcon(showRibbonIcon: boolean) { return this.update({ showRibbonIcon }); }
	getCollectAttribution() { return this.settings.collectAttribution; }
	/** Applies one item against the settings committed when this turn runs, so a queued change to another item is kept. */
	setCollectAttribution(key: CollectAttributionKey, value: boolean): Promise<boolean> {
		if (typeof value !== "boolean") return Promise.resolve(false);
		return this.enqueue(async () => {
			const savedBefore = serializeAutomaticPosSettings(this.settings);
			const collectAttribution = { ...this.settings.collectAttribution, [key]: value };
			const next = parseAutomaticPosSettings({ ...this.settings, collectAttribution });
			try { await this.persistence.save(serializeAutomaticPosSettings(next)); }
			catch {
				this.queue.recovery = savedBefore;
				try { await this.persistence.save(savedBefore); this.queue.recovery = null; }
				catch { /* Block later writes until the queue can repair data.json. */ }
				return false;
			}
			this.settings = next;
			return true;
		}).catch(() => false);
	}
	getDisplaySettings(): SemantropyDisplaySettings { return parseDisplaySettings(this.settings); }
	setBodySemantropy(bodySemantropy: BodySemantropy) { return this.update({ bodySemantropy }); }
	/** The request validator refuses Off, so this never saves 0. */
	setDictionarySemantropy(dictionarySemantropy: DictionarySemantropy) { return this.update({ dictionarySemantropy }); }
	setCollectionPath(collectionPath: string) { return this.update({ collectionPath }); }
	setDisplaySettings(patch: Partial<SemantropyDisplaySettings>) { return this.update(patch); }
	/** Option Apply and the Text level change (MAX-VIEW1) both commit here.
	 * All Views are locked by the coordinator until this operation (including
	 * compensation) settles. No new effective state before all publications pass.
	 * A save rejection may occur after writing; compensate that case too. */
	transact(raw: unknown, publication: SettingsPublication): Promise<boolean> {
		const patch = validateAutomaticPosSettingsPatch(raw);
		if (!patch) return Promise.resolve(false);
		return this.enqueue(async () => {
			if (!publication.current()) return false;
			const before = this.settings, savedBefore = serializeAutomaticPosSettings(before);
			const next = parseAutomaticPosSettings({ ...before, ...patch });
			let committed = false;
			try {
				await this.persistence.save(serializeAutomaticPosSettings(next));
				if (!publication.current()) return false;
				publication.publish();
				if (!publication.current()) return false;
				publication.commit();
				this.settings = next; committed = true; return true;
			} catch { return false; }
			finally {
				if (!committed) {
					try { publication.rollback(); }
					finally {
						this.queue.recovery = savedBefore;
						try { await this.persistence.save(savedBefore); this.queue.recovery = null; }
						catch { /* Keep the previous effective state and block writes until repair succeeds. */ }
					}
				}
			}
		});
	}
	isRecoveryRequired(): boolean { return this.queue.recovery != null; }
	load(): Promise<AutomaticPosSettings> {
		return this.enqueue(async () => {
			try { this.settings = parseAutomaticPosSettings(await this.persistence.load()); }
			catch { this.settings = defaultAutomaticPosSettings(); }
			return this.settings;
		});
	}
	update(raw: unknown): Promise<boolean> {
		const patch = validateAutomaticPosSettingsPatch(raw);
		if (!patch) return Promise.resolve(false);
		if (Object.keys(patch).length === 0) return Promise.resolve(true);
		return this.enqueue(async () => {
			const savedBefore = serializeAutomaticPosSettings(this.settings);
			const next = parseAutomaticPosSettings({ ...this.settings, ...patch });
			try { await this.persistence.save(serializeAutomaticPosSettings(next)); }
			catch {
				// A rejected save may already have reached data.json. Restore the
				// effective value before reporting failure, as transact does.
				this.queue.recovery = savedBefore;
				try { await this.persistence.save(savedBefore); this.queue.recovery = null; }
				catch { /* Block later writes until the queue can repair data.json. */ }
				return false;
			}
			this.settings = next;
			return true;
		}).catch(() => false);
	}
	async whenSettled(): Promise<void> {
		let pending: Promise<unknown>;
		do { pending = this.queue.pending; await pending; } while (pending !== this.queue.pending);
	}
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const guarded = async () => {
			if (this.queue.recovery) { await this.persistence.save(this.queue.recovery); this.queue.recovery = null; }
			return task();
		};
		const result = this.queue.pending.then(guarded, guarded);
		this.queue.pending = result.then(() => undefined, () => undefined);
		return result;
	}
}
