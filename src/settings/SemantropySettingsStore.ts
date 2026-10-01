import type { BodySemantropy } from "./bodySemantropy";
import { isCollectionPath } from "./collectionPath";
import type { DictionarySemantropy } from "./dictionarySemantropy";
import {
	validateDisplaySettingsPatch,
	type SemantropyDisplaySettings,
} from "./displaySettings";
import {
	defaultSemantropySettings,
	parseSemantropySettings,
	serializeSemantropySettings,
	type SemantropySettings,
	type StoredSemantropySettings,
} from "./semantropySettings";

/**
 * The plugin's `data.json` access, injected so the store stays free of
 * Obsidian types and testable on its own.
 */
export type SemantropySettingsPersistence = {
	load: () => Promise<unknown>;
	save: (data: StoredSemantropySettings) => Promise<void>;
};

type SettingsOperationQueue = { pending: Promise<unknown> };
const SETTINGS_QUEUE = Symbol.for("semantropy.pending-settings-operations");

/** App lifetime, including plugin disable/re-enable and bundle reloads. No settings are retained here. */
export function settingsOperationQueueFor(owner: object): SettingsOperationQueue {
	const scoped = owner as { [SETTINGS_QUEUE]?: SettingsOperationQueue };
	if (!scoped[SETTINGS_QUEUE]) {
		Object.defineProperty(scoped, SETTINGS_QUEUE, { value: { pending: Promise.resolve() } });
	}
	return scoped[SETTINGS_QUEUE]!;
}

/**
 * Holds the effective settings for the plugin's lifetime.
 *
 * Writes are serialized and each one is built from the last state that
 * actually reached disk, never from whatever happened to be in memory when the
 * caller started. Several controls saving at once — the body level, the
 * dictionary level and the collection path — therefore compose instead of
 * overwriting each other, and a slow write finishing after a faster one cannot
 * put `data.json` back to an older state.
 *
 * Nothing is applied optimistically: the in-memory settings advance only when
 * a write succeeds. A successful explicit save is authoritative even when its
 * originating View closes before the prepared display can be committed.
 */
export class SemantropySettingsStore {
	private settings: SemantropySettings = defaultSemantropySettings();
	constructor(
		private readonly persistence: SemantropySettingsPersistence,
		private readonly queue: SettingsOperationQueue = { pending: Promise.resolve() },
	) {}

	getSettings(): SemantropySettings {
		return this.settings;
	}

	getBodySemantropy(): BodySemantropy {
		return this.settings.bodySemantropy;
	}

	getDictionarySemantropy(): DictionarySemantropy {
		return this.settings.dictionarySemantropy;
	}

	getCollectionPath(): string {
		return this.settings.collectionPath;
	}

	/** The display half of the effective settings; never a note-derived value. */
	getDisplaySettings(): SemantropyDisplaySettings {
		const {
			vocabularyDrawMode,
			bodyFontFamily,
			bodyFontSizePx,
			bodyBackground,
			bodyForeground,
			showRuby,
			showReplacementMarkers,
			showManualMarkers,
			showDictionaryMarkers,
			dictionaryModifier,
		} = this.settings;
		return {
			vocabularyDrawMode,
			bodyFontFamily,
			bodyFontSizePx,
			// Schema 3 has no theme (0.1.0 S2 adds it in schema 8).
			bodyTheme: "default",
			bodyBackground,
			bodyForeground,
			showRuby,
			showReplacementMarkers,
			showManualMarkers,
			showDictionaryMarkers,
			dictionaryModifier,
		};
	}

	/**
	 * Stores one or more display settings.
	 *
	 * An invalid field refuses the whole change without writing: a partially
	 * applied display payload would leave the reader's stored settings and
	 * what is on screen describing different things. A valid change reaches
	 * disk before any View is told to apply it, so a save failure leaves both
	 * the stored settings and every View exactly as they were.
	 */
	async setDisplaySettings(
		patch: Partial<SemantropyDisplaySettings>,
	): Promise<boolean> {
		const validated = validateDisplaySettingsPatch(patch);
		if (validated === null) {
			return false;
		}
		if (Object.keys(validated).length === 0) {
			return true;
		}
		return await this.write((base) => ({ ...base, ...validated }));
	}

	/** Reads stored settings; anything unreadable leaves the defaults in place. */
	async load(): Promise<SemantropySettings> {
		return await this.enqueue(async () => {
			try {
				this.settings = parseSemantropySettings(await this.persistence.load());
			} catch {
				this.settings = defaultSemantropySettings();
			}
			return this.settings;
		});
	}

	async setBodySemantropy(value: BodySemantropy): Promise<boolean> {
		return await this.write((base) => ({ ...base, bodySemantropy: value }));
	}

	/** Waits for pending settings writes, including writes queued while waiting. */
	async whenSettled(): Promise<void> {
		let pending: Promise<unknown>;
		do { pending = this.queue.pending; await pending; } while (pending !== this.queue.pending);
	}

	/** Persistence success commits the setting. Stale display owners never roll it back. */
	async commitBodySemantropy(value: BodySemantropy, commit: () => boolean): Promise<"applied" | "stale" | "failed"> {
		return await this.enqueue(async () => {
			const next = { ...this.settings, bodySemantropy: value };
			try { await this.persistence.save(serializeSemantropySettings(next)); }
			catch { return "failed"; }
			this.settings = next;
			try { return commit() ? "applied" : "stale"; }
			catch { return "stale"; }
		});
	}

	async setDictionarySemantropy(
		value: DictionarySemantropy,
	): Promise<boolean> {
		return await this.write((base) => ({
			...base,
			dictionarySemantropy: value,
		}));
	}

	/**
	 * Stores where Collect writes.
	 *
	 * An invalid path is refused outright rather than corrected: silently
	 * rewriting it would point Collect at a file the user never named.
	 */
	async setCollectionPath(value: string): Promise<boolean> {
		if (!isCollectionPath(value)) {
			return false;
		}
		return await this.write((base) => ({ ...base, collectionPath: value }));
	}

	private write(
		mutate: (base: SemantropySettings) => SemantropySettings,
	): Promise<boolean> {
		return this.enqueue(async () => {
			// Built when this write's turn comes, not when it was requested, so it
			// carries forward whatever the previous write committed.
			const next = mutate(this.settings);
			try {
				await this.persistence.save(serializeSemantropySettings(next));
			} catch {
				return false;
			}
			this.settings = next;
			return true;
		});
	}

	/** Runs tasks one at a time, in request order, whatever their outcome. */
	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = this.queue.pending.then(task, task);
		this.queue.pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
