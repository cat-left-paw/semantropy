import { TFile, TFolder, normalizePath } from "obsidian";
import type {
	CollectionEntryState,
	CollectionStorage,
	CreateCollectionResult,
	ProcessCollectionResult,
} from "./CollectionStorage";

/**
 * The Vault methods Collect is allowed to call. There is no `modify`,
 * `append`, `delete`, or any other way to aim at a source note: the adapter
 * only ever receives the path the repository already chose.
 */
export type CollectionVault = {
	getAbstractFileByPath(path: string): unknown;
	create(path: string, data: string): Promise<TFile>;
	process(
		file: TFile,
		fn: (data: string) => string,
	): Promise<string>;
};

/**
 * An Obsidian Vault as `CollectionStorage`.
 *
 * `process` is one `Vault.process()` call, which is the atomic
 * read-modify-write the repository is counting on. A failure is reported,
 * never retried: a second attempt could store an entry the first one may
 * already have written.
 *
 * `already-exists` is returned only when the path is already occupied before
 * `Vault.create()` is called. A reject after `create` is `failed`, even if a
 * Markdown file is then sitting at the path: that file may be the write that
 * just landed, and appending would store the same entry twice. Folder
 * creation is out of scope: a missing parent is `parent-missing`.
 *
 * Nothing here logs an exception, a Vault path, or file contents.
 */
export function createObsidianCollectionStorage(
	vault: CollectionVault,
	normalize: (path: string) => string = normalizePath,
): CollectionStorage {
	const inspect = async (path: string): Promise<CollectionEntryState> => {
		const found = vault.getAbstractFileByPath(normalize(path));
		if (found == null) {
			return { status: "missing" };
		}
		if (found instanceof TFolder) {
			return { status: "folder" };
		}
		if (found instanceof TFile && found.extension === "md") {
			return { status: "markdown" };
		}
		return { status: "non-markdown" };
	};

	return {
		inspect,
		async create(path, contents): Promise<CreateCollectionResult> {
			const normalized = normalize(path);
			if (parentIsMissing(vault, normalized, normalize)) {
				return { status: "parent-missing" };
			}
			const existing = await inspect(normalized);
			if (
				existing.status === "markdown" ||
				existing.status === "folder" ||
				existing.status === "non-markdown"
			) {
				return { status: "already-exists" };
			}
			try {
				await vault.create(normalized, contents);
				return { status: "created" };
			} catch {
				return { status: "failed" };
			}
		},
		async process(path, transform): Promise<ProcessCollectionResult> {
			const normalized = normalize(path);
			const found = vault.getAbstractFileByPath(normalized);
			if (found == null) {
				return { status: "missing" };
			}
			if (!(found instanceof TFile) || found.extension !== "md") {
				return { status: "not-a-file" };
			}
			try {
				await vault.process(found, transform);
				return { status: "processed" };
			} catch {
				return { status: "failed" };
			}
		},
	};
}

/** Vault-relative parent, or `null` when `path` itself sits at the vault root. */
function parentPath(path: string): string | null {
	const slash = path.lastIndexOf("/");
	if (slash === -1) {
		return null;
	}
	return path.slice(0, slash);
}

function parentIsMissing(
	vault: CollectionVault,
	path: string,
	normalize: (path: string) => string,
): boolean {
	const parent = parentPath(path);
	if (parent === null) {
		return false;
	}
	const found = vault.getAbstractFileByPath(normalize(parent));
	return !(found instanceof TFolder);
}
