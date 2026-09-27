/**
 * What is at the configured path right now.
 *
 * A folder and a non-Markdown file are told apart because they are different
 * mistakes with different fixes, and neither may be written to.
 */
export type CollectionEntryState =
	| { status: "missing" }
	| { status: "markdown" }
	| { status: "folder" }
	| { status: "non-markdown" };

/**
 * Outcome of creating the file.
 *
 * `already-exists` is a distinct outcome, not an error string, because it is
 * the one failure the repository can recover from. A storage adapter must
 * report it only when it observed the path was already taken before it tried
 * to create the file. A reject from `create` whose effect is unknown has to
 * stay `failed`: treating that as `already-exists` would send the
 * repository on to append an entry the first attempt may already have written.
 */
export type CreateCollectionResult =
	| { status: "created" }
	| { status: "already-exists" }
	| { status: "parent-missing" }
	| { status: "failed" };

export type ProcessCollectionResult =
	| { status: "processed" }
	| { status: "missing" }
	| { status: "not-a-file" }
	| { status: "failed" };

/**
 * The only way Collect reaches storage.
 *
 * The port carries no note-writing ability of any kind: there is no method
 * that takes arbitrary content for an arbitrary path, and the repository above
 * it always passes the configured collection path. A source note is therefore
 * unreachable from here by construction, not by convention.
 *
 * `process` is a single atomic read-modify-write, not a read followed by a
 * separate write. That is what an Obsidian adapter implements with
 * `Vault.process()`, and stating it as one call is what keeps two appends from
 * reading the same contents and one overwriting the other.
 */
export interface CollectionStorage {
	inspect(path: string): Promise<CollectionEntryState>;
	create(path: string, contents: string): Promise<CreateCollectionResult>;
	process(
		path: string,
		transform: (contents: string) => string,
	): Promise<ProcessCollectionResult>;
}
