import type {
	CollectionEntryState,
	CollectionStorage,
	CreateCollectionResult,
	ProcessCollectionResult,
} from "../../../src/collect/CollectionStorage";

const STORAGE_KEY = "semantropy.web.collection.v1";

type Stored = Record<string, string>;

/**
 * Collect's storage port, kept in the browser. The shared v4 repository above
 * it decides what is written and refuses a Target or Vocabulary Source path, so
 * this adapter only has to keep the three operations honest: `create` reports
 * an existing file as `already-exists`, and `process` is one read-modify-write
 * that cannot interleave with another (the page is single-threaded and nothing
 * awaits in between).
 */
export class WebCollectionStorage implements CollectionStorage {
	private files: Stored;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly storage: Storage | null = safeLocalStorage()) {
		this.files = this.readStored();
	}

	inspect(path: string): Promise<CollectionEntryState> {
		if (!(path in this.files)) return Promise.resolve({ status: "missing" });
		return Promise.resolve(path.toLowerCase().endsWith(".md") ? { status: "markdown" } : { status: "non-markdown" });
	}

	create(path: string, contents: string): Promise<CreateCollectionResult> {
		if (path in this.files) return Promise.resolve({ status: "already-exists" });
		const next = { ...this.files, [path]: contents };
		if (!this.persist(next)) return Promise.resolve({ status: "failed" });
		return Promise.resolve({ status: "created" });
	}

	process(path: string, transform: (contents: string) => string): Promise<ProcessCollectionResult> {
		const current = this.files[path];
		if (current === undefined) return Promise.resolve({ status: "missing" });
		let updated: string;
		try {
			updated = transform(current);
		} catch {
			return Promise.resolve({ status: "failed" });
		}
		if (!this.persist({ ...this.files, [path]: updated })) return Promise.resolve({ status: "failed" });
		return Promise.resolve({ status: "processed" });
	}

	/** The Collection text for display and download; empty when nothing was collected. */
	read(path: string): string {
		return this.files[path] ?? "";
	}

	clear(path: string): boolean {
		if (!(path in this.files)) return true;
		const next = { ...this.files };
		delete next[path];
		return this.persist(next);
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private persist(next: Stored): boolean {
		if (this.storage) {
			try {
				this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				return false;
			}
		}
		this.files = next;
		for (const listener of this.listeners) listener();
		return true;
	}

	private readStored(): Stored {
		if (!this.storage) return {};
		try {
			const raw = this.storage.getItem(STORAGE_KEY);
			if (!raw) return {};
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
			const files: Stored = {};
			for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") files[key] = value;
			return files;
		} catch {
			return {};
		}
	}
}

export function safeLocalStorage(): Storage | null {
	try {
		const storage = window.localStorage;
		const probe = "semantropy.web.probe";
		storage.setItem(probe, "1");
		storage.removeItem(probe);
		return storage;
	} catch {
		return null;
	}
}
