/**
 * The web counterpart of a Vault: a small set of Markdown documents under
 * virtual paths. The shared View identifies a Target and every Vocabulary
 * Source by path, exactly as in Obsidian, so it needs no web-specific notion of
 * a document.
 *
 * Presets are listed immediately and fetched from the page's origin the first
 * time their text is needed. User documents live in memory; whether they are
 * also kept in the browser is the shell's decision, not the library's.
 */
export type PresetInfo = {
	id: string;
	title: string;
	author: string;
	/** Relative to the page. */
	url: string;
	/** Aozora Bunko credit lines shown with the text. */
	credit: string;
	chars: number;
};

export type LibraryDocument = {
	path: string;
	name: string;
	kind: "user" | "preset";
	preset?: PresetInfo;
};

export type LibraryEvent =
	| { kind: "changed"; path: string; text: string }
	| { kind: "lost"; path: string }
	| { kind: "listed" };

export const USER_FOLDER = "文章";
export const PRESET_FOLDER = "青空文庫";

export class WebLibrary {
	private readonly documents = new Map<string, LibraryDocument>();
	private readonly texts = new Map<string, string>();
	private readonly loading = new Map<string, Promise<string>>();
	private readonly listeners = new Set<(event: LibraryEvent) => void>();

	constructor(presets: readonly PresetInfo[]) {
		for (const preset of presets) {
			const path = `${PRESET_FOLDER}/${preset.author}/${preset.title}.md`;
			this.documents.set(path, { path, name: `${preset.author}「${preset.title}」`, kind: "preset", preset });
		}
	}

	list(): LibraryDocument[] {
		return [...this.documents.values()];
	}

	/** The reader's own documents, in order, for saving in the browser. */
	userDocuments(): { name: string; text: string }[] {
		return this.list()
			.filter((doc) => doc.kind === "user")
			.map((doc) => ({ name: doc.name, text: this.texts.get(doc.path) ?? "" }));
	}

	get(path: string): LibraryDocument | undefined {
		return this.documents.get(path);
	}

	has(path: string): boolean {
		return this.documents.has(path);
	}

	/** Text already in memory, or null when a preset has not been fetched yet. */
	peekText(path: string): string | null {
		return this.texts.get(path) ?? null;
	}

	async readText(path: string): Promise<string> {
		const known = this.texts.get(path);
		if (known !== undefined) return known;
		const doc = this.documents.get(path);
		if (!doc) throw new Error("The document is no longer available.");
		if (doc.kind !== "preset" || !doc.preset) return "";
		let pending = this.loading.get(path);
		if (!pending) {
			pending = fetchPreset(doc.preset).then(
				(text) => {
					this.loading.delete(path);
					if (this.documents.has(path) && !this.texts.has(path)) this.texts.set(path, text);
					return this.texts.get(path) ?? text;
				},
				(error: unknown) => {
					this.loading.delete(path);
					throw error;
				},
			);
			this.loading.set(path, pending);
		}
		return pending;
	}

	/** Adds a user document under a fresh path and returns that path. */
	add(name: string, text: string): string {
		const base = sanitizeName(name) || "無題";
		let path = `${USER_FOLDER}/${base}.md`;
		for (let n = 2; this.documents.has(path); n += 1) path = `${USER_FOLDER}/${base} ${n}.md`;
		const display = path.slice(USER_FOLDER.length + 1, -3);
		this.documents.set(path, { path, name: display, kind: "user" });
		this.texts.set(path, text);
		this.emit({ kind: "listed" });
		return path;
	}

	/** Replaces a user document's text. Presets are read-only. */
	setText(path: string, text: string): void {
		const doc = this.documents.get(path);
		if (!doc || doc.kind !== "user") return;
		if (this.texts.get(path) === text) return;
		this.texts.set(path, text);
		this.emit({ kind: "changed", path, text });
	}

	remove(path: string): void {
		const doc = this.documents.get(path);
		if (!doc || doc.kind !== "user") return;
		this.documents.delete(path);
		this.texts.delete(path);
		this.emit({ kind: "lost", path });
		this.emit({ kind: "listed" });
	}

	onEvent(listener: (event: LibraryEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: LibraryEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}

/** A path segment: no separators, no characters Markdown links treat specially, no control characters. */
function sanitizeName(name: string): string {
	const printable = [...name].map((char) => (char.charCodeAt(0) < 0x20 ? " " : char)).join("");
	return printable
		.replace(/[\\/:*?"<>|#^[\]]/gu, " ")
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, 60);
}

async function fetchPreset(preset: PresetInfo): Promise<string> {
	const response = await fetch(new URL(preset.url, document.baseURI), { credentials: "same-origin" });
	if (!response.ok) throw new Error("The preset could not be loaded.");
	return await response.text();
}
