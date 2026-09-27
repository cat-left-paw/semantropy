/**
 * PRE-RELEASE-EXPERIENCE-VOCABULARY1: the Vocabulary picker's folder view.
 *
 * Pure and metadata-only. It groups the Vault paths the host already lists by
 * their folder segments; it never opens a note, never reads a note's text and
 * never decides what a Vocabulary is. Selecting a folder is not a Vocabulary
 * mode: a folder only groups the notes a reader may tick one by one.
 */
export type VocabularyFolder = {
	/** Last segment, or "" for the Vault root. */
	readonly name: string;
	/** Folder path without a trailing slash, or "" for the Vault root. */
	readonly path: string;
	readonly folders: readonly VocabularyFolder[];
	/** Full note paths directly in this folder, in code-unit order. */
	readonly notes: readonly string[];
	/** Notes in this folder and every descendant. */
	readonly count: number;
};

type MutableFolder = { name: string; path: string; folders: Map<string, MutableFolder>; notes: string[] };

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One pass over the listed paths; duplicates collapse, order never depends on the listing's order. */
export function buildVocabularyTree(paths: readonly string[]): VocabularyFolder {
	const root: MutableFolder = { name: "", path: "", folders: new Map(), notes: [] };
	for (const path of new Set(paths)) {
		if (typeof path !== "string" || path === "") continue;
		const segments = path.split("/");
		let folder = root;
		for (const segment of segments.slice(0, -1)) {
			let child = folder.folders.get(segment);
			if (!child) {
				child = { name: segment, path: folder.path === "" ? segment : `${folder.path}/${segment}`, folders: new Map(), notes: [] };
				folder.folders.set(segment, child);
			}
			folder = child;
		}
		folder.notes.push(path);
	}
	const freeze = (folder: MutableFolder): VocabularyFolder => {
		const folders = [...folder.folders.values()].sort((a, b) => byCodeUnit(a.name, b.name)).map(freeze);
		const notes = folder.notes.sort(byCodeUnit);
		return Object.freeze({ name: folder.name, path: folder.path, folders: Object.freeze(folders), notes: Object.freeze(notes),
			count: notes.length + folders.reduce((sum, child) => sum + child.count, 0) });
	};
	return freeze(root);
}

/** The display name of a note: its last path segment, as listed. */
export function vocabularyNoteName(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? path : path.slice(slash + 1);
}

/**
 * The same tree, keeping only notes whose full path contains `query`
 * (case-insensitive, locale-independent) and the folders that lead to them. An empty query returns
 * the tree itself. Filtering hides notes from view; it never changes a draft.
 */
export function filterVocabularyTree(tree: VocabularyFolder, query: string): VocabularyFolder {
	const needle = query.trim().toLowerCase();
	if (needle === "") return tree;
	const visit = (folder: VocabularyFolder): VocabularyFolder | null => {
		const folders = folder.folders.map(visit).filter((child): child is VocabularyFolder => child !== null);
		const notes = folder.notes.filter(path => path.toLowerCase().includes(needle));
		if (!folders.length && !notes.length && folder.path !== "") return null;
		return Object.freeze({ name: folder.name, path: folder.path, folders: Object.freeze(folders), notes: Object.freeze(notes),
			count: notes.length + folders.reduce((sum, child) => sum + child.count, 0) });
	};
	return visit(tree)!;
}
