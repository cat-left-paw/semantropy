/**
 * Keeps the reader's own texts in this browser, only when they ask for it.
 *
 * The switch lives in localStorage and is off by default. While it is on, the
 * whole set of user documents is written to IndexedDB (one transaction, after
 * a short pause in typing); turning it off deletes what was stored. Presets
 * are never stored: they come with the page.
 */
export type StoredDocument = { name: string; text: string };

const SWITCH_KEY = "semantropy.web.persistTexts.v1";
const DB_NAME = "semantropy-web";
const DB_VERSION = 1;
const STORE = "documents";

export class DocumentStore {
	constructor(private readonly storage: Storage | null) {}

	isAvailable(): boolean {
		return this.storage !== null && typeof indexedDB !== "undefined";
	}

	isEnabled(): boolean {
		try {
			return this.storage?.getItem(SWITCH_KEY) === "1";
		} catch {
			return false;
		}
	}

	setEnabled(enabled: boolean): boolean {
		try {
			if (enabled) this.storage?.setItem(SWITCH_KEY, "1");
			else this.storage?.removeItem(SWITCH_KEY);
			return true;
		} catch {
			return false;
		}
	}

	async load(): Promise<StoredDocument[]> {
		const db = await openDatabase();
		try {
			const rows = await request<unknown[]>(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
			return rows
				.filter((row): row is { order: number; name: string; text: string } =>
					typeof row === "object" && row !== null && typeof (row as { name?: unknown }).name === "string" && typeof (row as { text?: unknown }).text === "string" && typeof (row as { order?: unknown }).order === "number")
				.sort((a, b) => a.order - b.order)
				.map(({ name, text }) => ({ name, text }));
		} finally {
			db.close();
		}
	}

	/** Replaces everything stored with `documents`, in one transaction. */
	async saveAll(documents: readonly StoredDocument[]): Promise<void> {
		const db = await openDatabase();
		try {
			const transaction = db.transaction(STORE, "readwrite");
			const store = transaction.objectStore(STORE);
			store.clear();
			documents.forEach((doc, order) => store.put({ order, name: doc.name, text: doc.text }));
			await done(transaction);
		} finally {
			db.close();
		}
	}

	async clear(): Promise<void> {
		const db = await openDatabase();
		try {
			const transaction = db.transaction(STORE, "readwrite");
			transaction.objectStore(STORE).clear();
			await done(transaction);
		} finally {
			db.close();
		}
	}
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open(DB_NAME, DB_VERSION);
		open.onupgradeneeded = () => {
			if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: "order" });
		};
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(new Error("The browser storage could not be opened."));
		open.onblocked = () => reject(new Error("The browser storage is in use."));
	});
}

function request<T>(req: IDBRequest): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result as T);
		req.onerror = () => reject(new Error("The browser storage could not be read."));
	});
}

function done(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(new Error("The browser storage could not be written."));
		transaction.onabort = () => reject(new Error("The browser storage could not be written."));
	});
}
